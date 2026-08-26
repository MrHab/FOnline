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
        private GUIStyle _nameStyle;
        private GUIStyle _smallStyle;
        private GUIStyle _chipStyle;
        private GUIStyle _weaponStyle;

        public bool HasState { get { return !string.IsNullOrEmpty(_selfId); } }
        public bool CanvasDriven { get; set; }
        public string Name { get { return _name; } }
        public int Hp { get { return _hp; } }
        public int MaxHp { get { return _maxHp; } }
        public float Ap { get { return _ap; } }
        public int MaxAp { get { return _maxAp; } }
        public string DisplayName { get { return string.IsNullOrEmpty(_name) ? "\u0421\u0422\u0420\u0410\u041d\u041d\u0418\u041a" : _name.ToUpperInvariant(); } }
        public int Level { get { return _level; } }
        public int Xp { get { return _xp; } }
        public int XpNeeded { get { return _xpNeeded; } }
        public int PerkPoints { get { return _perkPoints; } }
        public int SkillPoints { get { return _skillPoints; } }
        public bool Dead { get { return _dead; } }
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
        }

        private void ApplyEquipmentAndSkills(JObject payload)
        {
            if (payload == null) return;

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
            _level = payload["level"]?.ToObject<int>() ?? _level;
            _xp = payload["xp"]?.ToObject<int>() ?? _xp;
            _xpNeeded = payload["xpNeeded"]?.ToObject<int>()
                ?? payload["xpToNext"]?.ToObject<int>() ?? _xpNeeded;
            _perkPoints = payload["perkPoints"]?.ToObject<int>() ?? _perkPoints;
            _skillPoints = payload["skillPoints"]?.ToObject<int>() ?? _skillPoints;

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

        private void OnGUI()
        {
            RoaUiTheme.Apply();
            if (CanvasDriven) return;
            if (RoaGameBootstrap.BlocksWorldHud) return;
            if (!HasState) return;

            BuildStyles();
            float width = Screen.width < 900
                ? Mathf.Min(Screen.width - 12f, 560f)
                : Mathf.Clamp(Screen.width * 0.41f, 610f, 820f);
            float height = width * (724f / 2172f);
            var area = RoaHudLayout.Resolve("status", new Rect(8f, 8f, width, height));

            if (_playerFrame != null)
                GUI.DrawTexture(area, _playerFrame, ScaleMode.StretchToFill, true);
            else
                GUI.Box(area, GUIContent.none);

            string ping = Socket != null && Socket.PingMs >= 0f
                ? Mathf.RoundToInt(Socket.PingMs) + "ms"
                : (Socket != null && Socket.ReconnectAttempt > 0 ? "LINK…" : "OFFLINE");
            int fps = Mathf.RoundToInt(1f / Mathf.Max(0.001f, _smoothedFrameSeconds));
            GUI.Label(Relative(area, 0.074f, 0.095f, 0.162f, 0.127f), "FPS " + fps + "  ·  " + ping, _smallStyle);

            string playerName = string.IsNullOrEmpty(_name) ? "СТРАННИК" : _name.ToUpperInvariant();
            GUI.Label(Relative(area, 0.261f, 0.325f, 0.565f, 0.18f), playerName, _nameStyle);

            bool flash = Time.time < _damageFlashUntil;
            DrawBar(Relative(area, 0.272f, 0.505f, 0.255f, 0.075f), "HP", _hp, _maxHp,
                flash ? new Color(1f, 0.35f, 0.3f) : RoaUiTheme.Red);
            DrawBar(Relative(area, 0.548f, 0.505f, 0.255f, 0.075f), "AP", Mathf.RoundToInt(_ap), _maxAp,
                RoaUiTheme.Green);

            string chips = "УРОВЕНЬ  <b>" + _level + "</b>     ОПЫТ  <b>" + _xp + "/" + _xpNeeded
                + "</b>     ПЕРКИ  <b>" + _perkPoints + "</b>     НАВЫКИ  <b>" + _skillPoints + "</b>";
            GUI.Label(Relative(area, 0.102f, 0.645f, 0.77f, 0.135f), chips, _chipStyle);

            string ammo = _magSize > 0 ? _loaded + "/" + _magSize + "  ·  ЗАПАС " + _reserveAmmo : "—";
            string weapon = string.IsNullOrEmpty(_weapon) ? "БЕЗ ОРУЖИЯ" : RoaItemData.Name(_weapon).ToUpperInvariant();
            string condition = _condition < 0.999f ? "  ·  " + Mathf.RoundToInt(_condition * 100f) + "%" : string.Empty;
            GUI.Label(Relative(area, 0.102f, 0.775f, 0.77f, 0.105f), weapon + "  ·  " + ammo + condition,
                _weaponStyle);

            if (_dead) GUI.Label(Relative(area, 0.69f, 0.33f, 0.14f, 0.16f), "ПОГИБ", _nameStyle);
            RoaHudLayout.HandleDrag("status", ref area, "Статус");
        }


        private void BuildStyles()
        {
            if (_nameStyle != null) return;
            _nameStyle = new GUIStyle(GUI.skin.label)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 18,
                alignment = TextAnchor.MiddleLeft,
                clipping = TextClipping.Clip
            };
            _nameStyle.normal.textColor = new Color(1f, 0.87f, 0.52f);
            _smallStyle = new GUIStyle(_nameStyle) { fontSize = 11, alignment = TextAnchor.MiddleCenter };
            _chipStyle = new GUIStyle(GUI.skin.label)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 10,
                alignment = TextAnchor.MiddleLeft,
                richText = true,
                clipping = TextClipping.Clip
            };
            _chipStyle.normal.textColor = new Color(0.84f, 0.89f, 0.64f);
            _weaponStyle = new GUIStyle(_chipStyle) { fontSize = 10 };
            _weaponStyle.normal.textColor = new Color(0.96f, 0.82f, 0.42f);
        }

        private static Rect Relative(Rect parent, float x, float y, float width, float height)
        {
            return new Rect(parent.x + parent.width * x, parent.y + parent.height * y,
                parent.width * width, parent.height * height);
        }

        private void DrawBar(Rect rect, string label, int value, int max, Color color)
        {
            GUI.Box(rect, GUIContent.none);
            float labelWidth = rect.width * 0.18f;
            GUI.Label(new Rect(rect.x + 4f, rect.y, labelWidth, rect.height), label, _smallStyle);
            Rect track = new Rect(rect.x + labelWidth, rect.y + rect.height * 0.24f,
                rect.width - labelWidth - 42f, rect.height * 0.52f);
            Color old = GUI.color;
            GUI.color = new Color(0.07f, 0.09f, 0.08f, 0.94f);
            GUI.DrawTexture(track, Texture2D.whiteTexture);
            if (max > 0)
            {
                GUI.color = color;
                float fill = Mathf.Clamp01(value / (float)max);
                GUI.DrawTexture(new Rect(track.x + 1f, track.y + 1f, (track.width - 2f) * fill,
                    track.height - 2f), Texture2D.whiteTexture);
            }
            GUI.color = old;
            GUI.Label(new Rect(rect.xMax - 42f, rect.y, 40f, rect.height), value + "/" + max, _smallStyle);
        }
    }
}
