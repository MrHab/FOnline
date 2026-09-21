using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Боевой HUD: здоровье, очки действия, оружие и патроны.
    ///
    /// Данные приходят из трёх источников, и это не избыточность, а устройство
    /// протокола:
    /// — HP, AP и уровень берутся из <c>snapshot</c>: своих витальных полей
    ///   в authoritativePlayerState нет, зато снимок комнаты включает и себя;
    /// — магазин и запас — из блока <c>combat</c> ack-ответов;
    /// — авторитетный урон — из <c>playerDamaged</c>, он приходит раньше
    ///   следующего снимка и не даёт полосе HP «запаздывать» на секунду.
    ///
    /// HUD использует IMGUI вместе с остальными окнами текущего Unity-клиента;
    /// его блоки можно перетаскивать и сохранять через редактор раскладки.
    /// </summary>
    public sealed class RoaHud : MonoBehaviour
    {
        public RoaSocketClient Socket;

        private string _selfId = string.Empty;

        private int _hp;
        private int _maxHp;
        private float _ap;
        private int _maxAp;
        private int _level;
        private int _xp;
        private int _xpNeeded = 100;
        private int _perkPoints;
        private int _skillPoints;
        private bool _dead;
        private string _name = string.Empty;
        private string _pvpMode = "peaceful";

        private string _weapon = string.Empty;
        private string _ammoType = string.Empty;
        private int _armorThreshold;
        private readonly System.Collections.Generic.Dictionary<string, int> _skillPercents =
            new System.Collections.Generic.Dictionary<string, int>();

        // Замер пинга — как web (05c_multiplayer_socket_room.js): networkPing
        // каждые 2 с, сглаживание 0.68/0.32 к последнему значению.
        private float _pingSmoothedMs = -1f;
        private float _nextPingAt;
        private bool _pingInFlight;
        private int _loaded;
        private int _magSize;
        private int _reserveAmmo;
        private float _condition = 1f;
        private float _cooldownEndsAt = -1f;

        /// <summary>Последний урон — чтобы подсветить полосу на мгновение.</summary>
        private float _damageFlashUntil;
        private float _smoothedFrameSeconds = 1f / 60f;
        private Texture2D _playerFrame;

        public bool HasState { get { return !string.IsNullOrEmpty(_selfId); } }
        public bool CanvasDriven { get; set; }
        public string Name { get { return _name; } }
        public int Hp { get { return _hp; } }
        public int MaxHp { get { return _maxHp; } }
        public float Ap { get { return _ap; } }
        public float Hydration { get; private set; } = 100f;
        private float _stimUntil, _wetUntil, _stunUntil;
        public string ArtifactStatus
        {
            get
            {
                string text = "Вода " + Hydration.ToString("0") + "%";
                if (_stimUntil > Time.unscaledTime) text += " · Стим " + Mathf.CeilToInt(_stimUntil - Time.unscaledTime) + "с";
                if (_wetUntil > Time.unscaledTime) text += " · Намокание";
                if (_stunUntil > Time.unscaledTime) text += " · Оглушение";
                return text;
            }
        }

        private void HandleArtifactRuntime(JObject payload)
        {
            if (!(payload?["artifactRuntime"] is JObject runtime)) return;
            Hydration = Mathf.Clamp(runtime["hydration"]?.Value<float>() ?? 100f, 0f, 100f);
            _stimUntil = Time.unscaledTime + (runtime["stimSeconds"]?.Value<float>() ?? 0f);
            _wetUntil = Time.unscaledTime + (runtime["wetSeconds"]?.Value<float>() ?? 0f);
            _stunUntil = Time.unscaledTime + (runtime["stunSeconds"]?.Value<float>() ?? 0f);
        }
        public int MaxAp { get { return _maxAp; } }
        public string DisplayName { get { return string.IsNullOrEmpty(_name) ? "\u0421\u0422\u0420\u0410\u041d\u041d\u0418\u041a" : _name.ToUpperInvariant(); } }
        public int Level { get { return _level; } }
        public int Xp { get { return _xp; } }
        public int XpNeeded { get { return _xpNeeded; } }
        public int PerkPoints { get { return _perkPoints; } }
        public int SkillPoints { get { return _skillPoints; } }
        public bool Dead { get { return _dead; } }
        public string PvpMode { get { return _pvpMode ?? "peaceful"; } }
        public int Loaded { get { return _loaded; } }
        public int MagSize { get { return _magSize; } }
        public int ReserveAmmo { get { return _reserveAmmo; } }
        public float Condition { get { return _condition; } }
        public float CooldownRemainingSeconds
        {
            get { return Mathf.Max(0f, _cooldownEndsAt - Time.unscaledTime); }
        }
        public bool DamageFlashActive { get { return Time.unscaledTime < _damageFlashUntil; } }
        public Texture2D PlayerFrame { get { return _playerFrame; } }
        /// <summary>Тип патронов активного оружия (ammo9, ammo556...). Пусто у ближнего боя.</summary>
        public string AmmoType { get { return _ammoType; } }

        /// <summary>Сглаженный RTT до сервера, мс; −1 — замера ещё нет.</summary>
        public int PingMs { get { return _pingSmoothedMs < 0f ? -1 : Mathf.RoundToInt(_pingSmoothedMs); } }

        /// <summary>Суммарный баллистический порог надетой брони и шлема.</summary>
        public int ArmorThreshold { get { return _armorThreshold; } }

        /// <summary>Процент профильного навыка активного оружия (для стоимости авто-режима).</summary>
        public int WeaponSkillPercent
        {
            get
            {
                string skill = RoaWeaponData.Get(WeaponId).WeaponSkill;
                int value;
                return skill != null && _skillPercents.TryGetValue(skill, out value) ? value : 0;
            }
        }

        /// <summary>Сырой id оружия (pistol, knife...) для каталога RoaWeaponData.</summary>
        public string WeaponId { get { return _weapon ?? string.Empty; } }

        public string WeaponName { get { return string.IsNullOrEmpty(_weapon) ? "\u0411\u0415\u0417 \u041e\u0420\u0423\u0416\u0418\u042f" : _weapon.ToUpperInvariant(); } }

        private void OnEnable()
        {
            _playerFrame = Resources.Load<Texture2D>("RealmUi/player-name-panel-transparent");
            if (Socket == null) return;
            Socket.OnJoined += HandleJoined;
            Socket.OnRoomSnapshot += HandleSnapshot;
            Socket.OnPlayerDamaged += HandleDamaged;
            Socket.OnPlayerHealed += HandleHealed;
            Socket.OnPlayerStatusEffect += HandleStatusEffect;
            Socket.OnServerRespawn += HandleServerTransfer;
            Socket.OnServerWorldTransfer += HandleServerTransfer;
            Socket.OnAuthoritativeSelf += HandleSelf;
            Socket.OnArtifactState += HandleArtifactRuntime;
            Socket.OnCombatState += ApplyCombat;
        }

        private void OnDisable()
        {
            if (Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnRoomSnapshot -= HandleSnapshot;
            Socket.OnPlayerDamaged -= HandleDamaged;
            Socket.OnPlayerHealed -= HandleHealed;
            Socket.OnPlayerStatusEffect -= HandleStatusEffect;
            Socket.OnServerRespawn -= HandleServerTransfer;
            Socket.OnServerWorldTransfer -= HandleServerTransfer;
            Socket.OnAuthoritativeSelf -= HandleSelf;
            Socket.OnArtifactState -= HandleArtifactRuntime;
            Socket.OnCombatState -= ApplyCombat;
        }

        private void HandleJoined(JoinAck ack)
        {
            _selfId = ack.Id ?? string.Empty;
            ApplyCombat(ack.Combat);

            // Экипировка и навыки есть уже в join-ответе; authoritativePlayerState
            // приходит только при изменениях, и без этого порог брони до первого
            // события оставался нулевым.
            ApplyEquipmentAndSkills(ack.Self);
            _pvpMode = ack.Self?["pvpMode"]?.ToString() ?? _pvpMode;
        }

        private void ApplyEquipmentAndSkills(JObject payload)
        {
            if (payload == null) return;
            HandleArtifactRuntime(payload);

            // Здоровье приходит уже в join-ответе, но до сих пор не читалось, а
            // снимок комнаты игрока про него самого не содержит никогда (сервер
            // шлёт только остальных). Из-за этого HUD жил с нулём до первого
            // попадания и рисовал «HP 0/1» — полоса красная, персонаж выглядит
            // мёртвым. Теперь витальные показатели берутся при входе.
            if (payload["maxHp"] != null) _maxHp = Mathf.RoundToInt(payload["maxHp"].ToObject<float>());
            if (payload["hp"] != null) _hp = Mathf.RoundToInt(payload["hp"].ToObject<float>());
            if (payload["dead"] != null) _dead = payload["dead"].ToObject<bool>();
            if (payload["level"] != null) _level = payload["level"].ToObject<int>();

            JObject equipment = payload["equipmentRuntime"] as JObject ?? payload["equipment"] as JObject;
            if (equipment != null)
            {
                _armorThreshold =
                    RoaArmorData.Threshold(RoaArmorData.BaseId(equipment["armor"]?.ToString()))
                    + RoaArmorData.Threshold(RoaArmorData.BaseId(equipment["helmet"]?.ToString()));
            }

            if (payload["skillRanks"] is JObject ranks)
            {
                foreach (System.Collections.Generic.KeyValuePair<string, JToken> row in ranks)
                    _skillPercents[row.Key] = row.Value?.ToObject<int>() ?? 0;
            }
        }

        private void HandleSnapshot(List<PublicPlayer> players)
        {
            if (players == null || string.IsNullOrEmpty(_selfId)) return;

            foreach (PublicPlayer player in players)
            {
                if (player == null || player.Id != _selfId) continue;

                _hp = player.Hp;
                _maxHp = player.MaxHp;
                _ap = player.Ap;
                _maxAp = player.MaxAp;
                _level = player.Level;
                _dead = player.Dead;
                _name = player.Name;
                if (!string.IsNullOrEmpty(player.Weapon)) _weapon = player.Weapon;
                return;
            }
        }

        /// <summary>
        /// Урон приходит адресно и раньше следующего снимка комнаты, поэтому
        /// полоса HP реагирует сразу, а не с задержкой до секунды.
        /// </summary>
        private void HandleDamaged(JObject payload)
        {
            if (payload == null) return;

            string id = payload["id"]?.ToString() ?? payload["targetId"]?.ToString();
            if (!string.IsNullOrEmpty(id) && id != _selfId) return;

            JToken hp = payload["hp"];
            if (hp != null) _hp = Mathf.RoundToInt(hp.ToObject<float>());

            _damageFlashUntil = Time.time + 0.25f;
        }

        private void HandleHealed(JObject payload)
        {
            if (payload == null) return;
            string id = payload["targetId"]?.ToString();
            if (!string.IsNullOrEmpty(id) && id != _selfId) return;
            if (payload["hp"] != null) _hp = Mathf.RoundToInt(payload["hp"].ToObject<float>());
            if (payload["maxHp"] != null) _maxHp = Mathf.RoundToInt(payload["maxHp"].ToObject<float>());
        }

        private void HandleStatusEffect(JObject payload)
        {
            if (payload == null) return;
            if (payload["hp"] != null) _hp = Mathf.RoundToInt(payload["hp"].ToObject<float>());
            if (payload["maxHp"] != null) _maxHp = Mathf.RoundToInt(payload["maxHp"].ToObject<float>());
            if ((payload["damage"]?.ToObject<float>() ?? 0f) > 0f)
                _damageFlashUntil = Time.time + 0.25f;
        }

        private void HandleServerTransfer(JObject payload)
        {
            if (payload == null) return;
            if (payload["hp"] != null) _hp = Mathf.RoundToInt(payload["hp"].ToObject<float>());
            if (payload["maxHp"] != null) _maxHp = Mathf.RoundToInt(payload["maxHp"].ToObject<float>());
            _pvpMode = payload["pvpMode"]?.ToString() ?? _pvpMode;
            _dead = false;
        }

        private void Update()
        {
            _smoothedFrameSeconds = Mathf.Lerp(_smoothedFrameSeconds,
                Mathf.Max(0.0001f, Time.unscaledDeltaTime), 0.08f);

            if (Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined)
            {
                _pingSmoothedMs = -1f;
                _pingInFlight = false;
                return;
            }

            if (_pingInFlight || Time.unscaledTime < _nextPingAt) return;

            _pingInFlight = true;
            float startedAt = Time.realtimeSinceStartup;

            Socket.EmitWithAck("networkPing",
                new System.Collections.Generic.Dictionary<string, object>
                {
                    ["clientTime"] = (long)(System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
                },
                ack =>
                {
                    _pingInFlight = false;
                    _nextPingAt = Time.unscaledTime + 2f;

                    if (ack == null || ack["ok"]?.ToObject<bool>() != true)
                    {
                        _pingSmoothedMs = -1f;
                        return;
                    }

                    float measured = Mathf.Clamp((Time.realtimeSinceStartup - startedAt) * 1000f, 0f, 9999f);
                    _pingSmoothedMs = _pingSmoothedMs < 0f
                        ? measured
                        : _pingSmoothedMs * 0.68f + measured * 0.32f;
                });
        }

        private void HandleSelf(JObject payload)
        {
            if (payload == null) return;
            HandleArtifactRuntime(payload);
            _level = payload["level"]?.ToObject<int>() ?? _level;
            _xp = payload["xp"]?.ToObject<int>() ?? _xp;
            _xpNeeded = payload["xpNeeded"]?.ToObject<int>()
                ?? payload["xpToNext"]?.ToObject<int>() ?? _xpNeeded;
            _perkPoints = payload["perkPoints"]?.ToObject<int>() ?? _perkPoints;
            _skillPoints = payload["skillPoints"]?.ToObject<int>() ?? _skillPoints;
            _pvpMode = payload["pvpMode"]?.ToString() ?? _pvpMode;

            ApplyEquipmentAndSkills(payload);
            ApplyCombat(payload["combat"] as JObject);
        }

        private void ApplyCombat(JObject combat)
        {
            if (combat == null) return;

            _weapon = combat["weapon"]?.ToString() ?? _weapon;
            _ammoType = combat["ammoType"]?.ToString() ?? _ammoType;
            _loaded = combat["loaded"]?.ToObject<int>() ?? _loaded;
            _magSize = combat["magSize"]?.ToObject<int>() ?? _magSize;
            _reserveAmmo = combat["reserveAmmo"]?.ToObject<int>() ?? _reserveAmmo;
            _condition = combat["condition"]?.ToObject<float>() ?? _condition;

            JToken cooldown = combat["cooldownRemainingMs"];
            if (cooldown != null)
                _cooldownEndsAt = Time.unscaledTime
                    + Mathf.Max(0f, cooldown.ToObject<float>()) / 1000f;

            JToken ap = combat["ap"];
            JToken maxAp = combat["maxAp"];
            if (ap != null) _ap = ap.ToObject<float>();
            if (maxAp != null) _maxAp = maxAp.ToObject<int>();
        }

    }
}
