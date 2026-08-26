using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Стрельба по врагам.
    ///
    /// Урон считает ТОЛЬКО сервер. Клиент выбирает цель, шлёт визуальное реле
    /// <c>shoot</c> для остальных игроков и авторитетный запрос <c>enemyHit</c>,
    /// а затем показывает то, что вернул ответ: попадание, промах, урон, смерть.
    /// Никакого локального расчёта урона нет и быть не должно —
    /// docs/wiki/SERVER_AUTHORITATIVE_RULES.md.
    ///
    /// Сервер окончательно проверяет локацию, дистанцию, ОД, магазин и темп.
    /// Клиент использует только последний authoritative ACK, чтобы не рисовать
    /// заранее известный ложный выстрел; любой новый результат всё равно решает сервер.
    /// </summary>
    public sealed class RoaCombat : MonoBehaviour
    {
        [Header("Связи")]
        public RoaSocketClient Socket;
        public RoaEnemies Enemies;
        public RoaRemotePlayers RemotePlayers;
        public RoaPlayerController Player;
        public RoaInteraction Interaction;
        public RoaPipboy Pipboy;
        public RoaInventory Inventory;
        public RoaCombatFx Fx;
        public RoaAudio Audio;
        public RoaHud Hud;
        public RoaFogOfWar Fog;
        public bool InputEnabled = true;

        [Header("Выбор цели")]
        [Tooltip("Радиус захвата цели вокруг курсора, м.")]
        public float TargetRadius = 2.5f;

        [Tooltip("Пауза между запросами, сек. Сервер всё равно режет по темпу оружия.")]
        public float MinRequestInterval = 0.12f;

        [Tooltip("Перезарядить активное оружие.")]
        public KeyCode ReloadKey = KeyCode.R;

        [Tooltip("Сменить режим: одиночный, прицельный, автоматический или парный.")]
        public KeyCode ModeKey = KeyCode.X;

        /// <summary>Set by RoaMobileControls to avoid synthetic mouse clicks from touch.</summary>
        public bool MobileInputMode { get; set; }

        public string FireMode { get { return _fireMode; } }
        public bool ReloadRequestPending { get { return _reloadRequestInFlight; } }
        public bool AttackRequestPending
        {
            get
            {
                return !string.IsNullOrEmpty(_pendingAttackToken)
                    && Time.unscaledTime < _attackRequestTimeoutAt;
            }
        }
        public int CurrentAttackApCost
        {
            get
            {
                return RoaCombatPreview.EffectiveApCost(
                    Socket?.Session?.Self, Socket?.Session?.Combat, _fireMode);
            }
        }
        public RoaWeaponReadiness.Frame WeaponReadiness
        {
            get { return EvaluateWeaponReadiness(); }
        }
        public float ReloadVisualRemaining
        {
            get { return Mathf.Max(0f, _reloadVisualEndsAt - Time.unscaledTime); }
        }
        public bool HasUsableRound
        {
            get
            {
                if (!HasAmmoWeapon()) return true;
                if (_fireMode == "dual" && HasDualPistolPair())
                    return LoadedRoundsForHand("weapon") > 0
                        || LoadedRoundsForHand("offhand") > 0;

                int loaded = LoadedRoundsForHand(ActiveHandSlot());
                return loaded >= 0
                    ? loaded > 0
                    : (Socket?.Session?.Combat?["loaded"]?.ToObject<int>() ?? 0) > 0;
            }
        }

        private float _nextRequestAt;
        private string _pendingAttackToken = string.Empty;
        private float _attackRequestTimeoutAt = -100f;
        private const float AttackRequestTimeoutSeconds = 1.5f;
        private string _meleePresentationToken = string.Empty;
        private float _meleeVisualStartedAt = -100f;
        private bool _reloadRequestInFlight;
        private float _reloadVisualEndsAt = -100f;
        private const float ReloadVisualSeconds = 0.82f;
        private int _shotSeq;
        private string _fireMode = "single";
        private string _modeWeapon = string.Empty;
        private JObject _hoverTarget;
        private Vector3 _hoverPosition;
        private float _nextHoverAt;
        private string _mobileAimTargetId = string.Empty;
        private Vector3 _mobileAimPosition;
        private RoaTargetingFeedback _targetingFeedback;
        private GUIStyle _targetHintStyle;

        /// <summary>Последние строки боевого журнала. Показываются в углу.</summary>
        private readonly List<string> _log = new List<string>();
        private const int LogLimit = 6;
        private string _lastLogRaw = string.Empty;
        private int _lastLogCount;
        public bool CanvasDriven { get; set; }
        public RoaCombatFeedbackCanvas FeedbackCanvas;
        public IReadOnlyList<string> LogLines { get { return _log; } }

        /// <summary>Всплывающий текст над целью: (текст, мир, до какого времени).</summary>
        private readonly List<FloatingText> _floating = new List<FloatingText>();
        private readonly List<HitConfirmation> _hitConfirmations = new List<HitConfirmation>();
        private const float RemotePlayerHitRadius = 0.58f;
        private const int HitConfirmationLimit = 12;

        private struct FloatingText
        {
            public string Text;
            public Vector3 World;
            public float Until;
            public Color Color;
        }

        private struct HitConfirmation
        {
            public Vector3 World;
            public float Started;
            public bool Critical;
            public bool Killed;
        }

        public int ActiveHitConfirmationCount
        {
            get
            {
                return CanvasDriven && FeedbackCanvas != null
                    ? FeedbackCanvas.ActiveMarkerCount : _hitConfirmations.Count;
            }
        }

        private void OnEnable()
        {
            if (Socket == null) return;
            Socket.OnEnemyAttack += HandleEnemyAttack;
            Socket.OnEnemyAttackMiss += HandleEnemyAttackMiss;
            Socket.OnPlayerDamaged += HandlePlayerDamaged;
            Socket.OnPlayerStatusEffect += HandlePlayerStatusEffect;
            Socket.OnEnemyKilled += HandleEnemyKilled;
        }

        private void OnDisable()
        {
            _pendingAttackToken = string.Empty;
            _attackRequestTimeoutAt = -100f;
            _meleePresentationToken = string.Empty;
            _meleeVisualStartedAt = -100f;
            if (Socket == null) return;
            Socket.OnEnemyAttack -= HandleEnemyAttack;
            Socket.OnEnemyAttackMiss -= HandleEnemyAttackMiss;
            Socket.OnPlayerDamaged -= HandlePlayerDamaged;
            Socket.OnPlayerStatusEffect -= HandlePlayerStatusEffect;
            Socket.OnEnemyKilled -= HandleEnemyKilled;
        }

        private void HandleEnemyAttack(JObject payload)
        {
            if (payload == null || Player == null) return;
            int damage = Mathf.Max(0, Mathf.RoundToInt(payload["damage"]?.ToObject<float>() ?? 0f));
            int absorbed = Mathf.Max(0, Mathf.RoundToInt(payload["absorbed"]?.ToObject<float>() ?? 0f));
            string name = payload["enemyName"]?.ToString() ?? "Противник";
            string type = payload["damageType"]?.ToString() ?? "ballistic";
            bool critical = payload["critical"]?.ToObject<bool>() == true;
            bool hasSource = payload["x"] != null && payload["z"] != null;
            Vector3 source = hasSource
                ? RoaCoords.ToUnity(payload["x"].ToObject<float>(), payload["z"].ToObject<float>())
                : Vector3.zero;
            if (hasSource) Player.View?.PlayHit(source, damage, critical);
            else Player.View?.PlayHit();
            Audio?.PlayHurt(damage);
            if (hasSource) Fx?.PlayDamagePulse(damage, Player.transform.position, source);
            else Fx?.PlayDamagePulse(damage);
            Float("-" + damage, Player.transform.position, new Color(1f, 0.36f, 0.29f));
            AddLog(name + " атакует (" + type + "): -" + damage + " HP"
                + (absorbed > 0 ? ", броня " + absorbed : string.Empty));
            if (payload["secondChance"]?.ToObject<bool>() == true)
                AddLog("Второй шанс: смертельный удар оставил 1 HP.");
        }

        private void HandlePlayerDamaged(JObject payload)
        {
            if (payload == null || Player == null || Socket?.Session == null) return;
            string targetId = payload["playerId"]?.ToString() ?? payload["targetId"]?.ToString();
            if (!string.Equals(targetId, Socket.Session.Id, StringComparison.Ordinal)) return;

            // Урон NPC уже приходит отдельным адресным enemyAttack с координатами.
            // Здесь нужен только PvP/взрыв игрока, иначе feedback проиграется дважды.
            if (!string.IsNullOrEmpty(payload["enemyId"]?.ToString())) return;
            string attackerId = payload["attackerId"]?.ToString();
            if (string.IsNullOrEmpty(attackerId)) return;

            int damage = Mathf.Max(0, Mathf.RoundToInt(payload["damage"]?.ToObject<float>() ?? 0f));
            int absorbed = Mathf.Max(0, Mathf.RoundToInt(payload["absorbed"]?.ToObject<float>() ?? 0f));
            string attacker = payload["attackerName"]?.ToString() ?? "Игрок";
            string type = payload["damageType"]?.ToString() ?? "ballistic";
            bool critical = payload["critical"]?.ToObject<bool>() == true;

            bool hasSource = TryDamageSource(payload, attackerId, out Vector3 source);
            if (hasSource) Player.View?.PlayHit(source, damage, critical);
            else Player.View?.PlayHit();
            Audio?.PlayHurt(damage);
            if (hasSource) Fx?.PlayDamagePulse(damage, Player.transform.position, source);
            else Fx?.PlayDamagePulse(damage);
            Float("-" + damage, Player.transform.position,
                critical ? new Color(1f, 0.72f, 0.2f) : new Color(1f, 0.36f, 0.29f));
            AddLog(attacker + (critical ? " наносит критический удар" : " атакует")
                + " (" + DamageTypeLabel(type) + "): -" + damage + " HP"
                + (absorbed > 0 ? ", броня " + absorbed : string.Empty));
            if (payload["secondChance"]?.ToObject<bool>() == true)
                AddLog("Второй шанс: смертельный удар оставил 1 HP.");
        }

        private bool TryDamageSource(JObject payload, string attackerId, out Vector3 source)
        {
            source = Vector3.zero;
            if (payload["sourceX"] != null && payload["sourceZ"] != null)
            {
                source = RoaCoords.ToUnity(payload["sourceX"].ToObject<float>(),
                                           payload["sourceZ"].ToObject<float>());
                return true;
            }
            return RemotePlayers != null && RemotePlayers.TryGetPosition(attackerId, out source);
        }

        private void HandleEnemyAttackMiss(JObject payload)
        {
            if (Player == null) return;
            string name = payload?["enemyName"]?.ToString() ?? "Противник";
            Float("Промах", Player.transform.position, new Color(0.85f, 0.82f, 0.7f));
            AddLog(name + " промахивается.");
        }

        private void HandlePlayerStatusEffect(JObject payload)
        {
            if (payload?["effect"]?.ToString() != "infection" || Player == null) return;
            int damage = Mathf.Max(0, payload["damage"]?.ToObject<int>() ?? 0);
            if (damage <= 0) return;
            Audio?.PlayHurt(damage);
            Fx?.PlayDamagePulse(damage);
            Float("-" + damage, Player.transform.position, new Color(0.62f, 0.81f, 0.45f));
            AddLog("Инфекция: -" + damage + " HP. Нужны антибиотики.");
        }

        private void HandleEnemyKilled(JObject payload)
        {
            if (payload == null || payload["killerId"]?.ToString() != Socket?.Session?.Id) return;
            float delay = PeekMeleePresentationDelay();
            if (delay > 0.001f)
            {
                StartCoroutine(PresentEnemyKillAfterDelay((JObject)payload.DeepClone(), delay));
                return;
            }
            PresentEnemyKill(payload);
        }

        private IEnumerator PresentEnemyKillAfterDelay(JObject payload, float delay)
        {
            yield return new WaitForSecondsRealtime(delay);
            PresentEnemyKill(payload);
        }

        private void PresentEnemyKill(JObject payload)
        {
            int xp = Mathf.Max(0, payload?["xp"]?.ToObject<int>() ?? 0);
            if (xp <= 0) return;
            Audio?.PlayKillConfirm();
            Vector3 position = RoaCoords.ToUnity(
                payload["x"]?.ToObject<float>() ?? 0f,
                payload["z"]?.ToObject<float>() ?? 0f);
            Float("+" + xp + " XP", position, new Color(0.89f, 0.77f, 0.42f));
        }

        private void Update()
        {
            if (Socket == null || Enemies == null || Player == null) return;
            if (Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;

            bool inputAllowed = InputAllowed();
            EnsureFireMode();
            if (inputAllowed && Input.GetKeyDown(ModeKey)) CycleFireMode();
            if (inputAllowed && Input.GetKeyDown(ReloadKey)) Reload();
            if (!MobileInputMode && inputAllowed && Input.GetMouseButton(0) && Time.time >= _nextRequestAt) Attack();
            UpdateHoverTarget(inputAllowed);
            UpdateTargetingFeedback(inputAllowed);

            for (int i = _floating.Count - 1; i >= 0; i--)
                if (Time.time > _floating[i].Until) _floating.RemoveAt(i);
            for (int i = _hitConfirmations.Count - 1; i >= 0; i--)
                if (RoaCombatConfirmation.Expired(
                    Time.unscaledTime - _hitConfirmations[i].Started,
                    _hitConfirmations[i].Killed)) _hitConfirmations.RemoveAt(i);
        }

        private bool InputAllowed()
        {
            return InputEnabled
                && (Interaction == null || !Interaction.IsPanelOpen)
                && (Pipboy == null || !Pipboy.PointerOverUi)
                && (Inventory == null || !Inventory.IsOpen);
        }

        private void UpdateHoverTarget(bool enabled)
        {
            if (!enabled)
            {
                _hoverTarget = null;
                return;
            }

            if (MobileInputMode)
            {
                RefreshMobileAimTarget();
                return;
            }

            if (Time.unscaledTime < _nextHoverAt) return;
            _nextHoverAt = Time.unscaledTime + 0.05f;
            Camera hoverCamera = Camera.main;
            if (hoverCamera == null)
            {
                _hoverTarget = null;
                return;
            }

            // Сначала показываем цель, которую выберет фактический выстрел:
            // экранная точка проходит тот же ray resolver, что и AttackAt.
            // Поэтому кольцо, процент и отправленный серверу targetId не спорят.
            if (TryScreenPointToWorld(Input.mousePosition, out Vector3 cursor)
                && TryResolvePrimaryTarget(cursor, out string resolvedEnemyId,
                    out Vector3 resolvedEnemyPosition, out PublicPlayer resolvedRemote,
                    out Vector3 resolvedRemotePosition))
            {
                if (resolvedRemote != null)
                {
                    SetRemoteAimTarget(resolvedRemote, resolvedRemotePosition);
                    return;
                }
                if (!string.IsNullOrEmpty(resolvedEnemyId)
                    && SetEnemyAimTarget(resolvedEnemyId, resolvedEnemyPosition)) return;
            }

            // Запасной hit-test сохраняет полезную подсказку по самой модели,
            // даже если она за пределами дальности текущего оружия.
            Ray hoverRay = hoverCamera.ScreenPointToRay(Input.mousePosition);
            bool hasEnemy = Enemies.TryFindTargetUnderCursor(hoverRay,
                out string enemyId, out Vector3 enemyPosition, out float enemyCursorDistance);
            PublicPlayer remote = null;
            Vector3 remotePosition = Vector3.zero;
            float remoteCursorDistance = float.PositiveInfinity;
            bool hasRemote = RemotePlayers != null && RemotePlayers.TryFindTargetUnderCursor(hoverRay,
                out remote, out remotePosition, out remoteCursorDistance);

            if (hasRemote && (!hasEnemy || remoteCursorDistance < enemyCursorDistance))
            {
                SetRemoteAimTarget(remote, remotePosition);
                return;
            }

            if (hasEnemy && SetEnemyAimTarget(enemyId, enemyPosition)) return;
            _hoverTarget = null;
        }

        /// <summary>
        /// Mobile auto-target supplies its intended point here. Combat resolves
        /// that point through the same line selector as a real shot, so a nearer
        /// actor intercepting the line is shown before the player presses fire.
        /// </summary>
        public void SetMobileAimTarget(string targetId, Vector3 position)
        {
            _mobileAimTargetId = targetId ?? string.Empty;
            _mobileAimPosition = position;
            if (MobileInputMode) RefreshMobileAimTarget();
        }

        public void ClearMobileAimTarget()
        {
            _mobileAimTargetId = string.Empty;
            if (MobileInputMode) _hoverTarget = null;
        }

        private void RefreshMobileAimTarget()
        {
            if (string.IsNullOrEmpty(_mobileAimTargetId))
            {
                _hoverTarget = null;
                return;
            }

            if (TryResolvePrimaryTarget(_mobileAimPosition, out string enemyId,
                out Vector3 enemyPosition, out PublicPlayer remote, out Vector3 remotePosition))
            {
                if (remote != null)
                {
                    SetRemoteAimTarget(remote, remotePosition);
                    return;
                }
                if (!string.IsNullOrEmpty(enemyId) && SetEnemyAimTarget(enemyId, enemyPosition)) return;
            }

            // The selected enemy can still be valid but outside this weapon's
            // range. Keep it visible as an explicit out-of-range target.
            if (!SetEnemyAimTarget(_mobileAimTargetId, _mobileAimPosition)) _hoverTarget = null;
        }

        private bool SetEnemyAimTarget(string enemyId, Vector3 position)
        {
            if (!Enemies.TryGetSnapshot(enemyId, out JObject snapshot)) return false;
            _hoverPosition = position;
            _hoverTarget = snapshot;
            return true;
        }

        private void SetRemoteAimTarget(PublicPlayer remote, Vector3 position)
        {
            _hoverPosition = position;
            _hoverTarget = new JObject
            {
                ["id"] = remote.Id ?? string.Empty,
                ["name"] = remote.Name ?? "Игрок",
                ["hp"] = remote.Hp,
                ["maxHp"] = Mathf.Max(1, remote.MaxHp),
                ["dead"] = remote.Dead,
                ["isRemotePlayer"] = true,
                ["worldFactionId"] = remote.WorldFactionId ?? remote.FactionId ?? string.Empty
            };
        }
        public bool TriggerAttackAt(Vector3 worldTarget)
        {
            if (Socket == null || Enemies == null || Player == null) return false;
            if (Socket.Phase != RoaSocketClient.ConnectionPhase.Joined || !InputAllowed()) return false;
            if (Time.time < _nextRequestAt) return false;
            EnsureFireMode();
            Player.AimAtWorld(worldTarget);
            AttackAt(worldTarget);
            return true;
        }

        /// <summary>
        /// Тот же экранный путь, что у аппаратного курсора. Публичный вход нужен
        /// также мобильному/диагностическому слою: экранная точка сначала
        /// проецируется на землю, затем проходит обычный выбор цели и server ack.
        /// </summary>
        public bool TriggerAttackAtScreenPoint(Vector2 screenPoint)
        {
            if (Socket == null || Enemies == null || Player == null) return false;
            if (Socket.Phase != RoaSocketClient.ConnectionPhase.Joined || !InputAllowed()) return false;
            if (Time.time < _nextRequestAt || !TryScreenPointToWorld(screenPoint, out Vector3 cursor)) return false;
            EnsureFireMode();
            AttackAt(cursor);
            return true;
        }

        /// <summary>Read-only проверка основного PvP target-selection для экранной точки.</summary>
        public bool TryResolveRemoteTargetAtScreenPoint(Vector2 screenPoint,
                                                         out PublicPlayer target,
                                                         out Vector3 targetPosition)
        {
            target = null;
            targetPosition = Vector3.zero;
            if (Player == null || !TryScreenPointToWorld(screenPoint, out Vector3 cursor)) return false;
            TryResolvePrimaryTarget(cursor, out _, out _, out target, out targetPosition);
            return target != null;
        }

        public void TriggerReload()
        {
            if (!InputAllowed()) return;
            EnsureFireMode();
            Reload();
        }

        public void TriggerCycleFireMode()
        {
            if (!InputAllowed()) return;
            EnsureFireMode();
            CycleFireMode();
        }

        private void Attack()
        {
            TriggerAttackAtScreenPoint(Input.mousePosition);
        }

        private RoaWeaponReadiness.Frame EvaluateWeaponReadiness()
        {
            JObject combat = Socket?.Session?.Combat;
            JObject self = Socket?.Session?.Self;
            float actionPoints = Hud != null
                ? Hud.Ap : self?["ap"]?.ToObject<float>() ?? 0f;
            int reserveAmmo = Hud != null
                ? Hud.ReserveAmmo : combat?["reserveAmmo"]?.ToObject<int>() ?? 0;
            float cooldown = Hud != null ? Hud.CooldownRemainingSeconds : 0f;
            return RoaWeaponReadiness.Evaluate(
                HasAmmoWeapon(), HasUsableRound, reserveAmmo,
                actionPoints, CurrentAttackApCost, cooldown,
                _reloadRequestInFlight, ReloadVisualRemaining, AttackRequestPending);
        }

        private bool BlockKnownImpossibleAttack()
        {
            RoaWeaponReadiness.Frame readiness = EvaluateWeaponReadiness();
            switch (readiness.Kind)
            {
                case RoaWeaponReadinessKind.AttackPending:
                    _nextRequestAt = Time.time + 0.04f;
                    return true;
                case RoaWeaponReadinessKind.Cooldown:
                    float cooldown = Hud != null ? Hud.CooldownRemainingSeconds : 0.08f;
                    _nextRequestAt = Time.time + Mathf.Clamp(cooldown, 0.035f, 0.12f);
                    return true;
                case RoaWeaponReadinessKind.LowActionPoints:
                    _nextRequestAt = Time.time + 0.24f;
                    AddLog(readiness.Label);
                    return true;
                default:
                    // Reloading is a cosmetic tail after the authoritative ACK:
                    // firing intentionally cancels it below. Empty magazines and
                    // a pending reload have their own tactile feedback above.
                    return false;
            }
        }

        private void BeginAttackRequest(string attackToken, bool melee, float visualStartedAt)
        {
            _pendingAttackToken = attackToken ?? string.Empty;
            _attackRequestTimeoutAt = Time.unscaledTime + AttackRequestTimeoutSeconds;
            _meleePresentationToken = melee ? _pendingAttackToken : string.Empty;
            _meleeVisualStartedAt = melee ? visualStartedAt : -100f;
        }

        /// <summary>
        /// Сколько ещё ждать до контактной позы уже начатого замаха. Серверный
        /// ACK и состояние игрока применяются сразу; задерживается только видимый
        /// результат на цели.
        /// </summary>
        public static float MeleePresentationDelay(float visualStartedAt, float now,
            float swingSeconds = RoaMeleeGrip.DefaultSwingSeconds)
        {
            return Mathf.Max(0f, visualStartedAt
                + RoaMeleeGrip.StrikeContactSeconds(swingSeconds) - now);
        }

        private float PeekMeleePresentationDelay()
        {
            if (string.IsNullOrEmpty(_meleePresentationToken)) return 0f;
            return MeleePresentationDelay(_meleeVisualStartedAt, Time.unscaledTime);
        }

        private bool TryTakeMeleePresentationDelay(string attackToken, out float delay)
        {
            delay = 0f;
            if (string.IsNullOrEmpty(attackToken)
                || !string.Equals(_meleePresentationToken, attackToken, StringComparison.Ordinal))
                return false;

            delay = MeleePresentationDelay(_meleeVisualStartedAt, Time.unscaledTime);
            _meleePresentationToken = string.Empty;
            _meleeVisualStartedAt = -100f;
            return true;
        }

        private void CompleteAttackRequest(string attackToken, JObject ack)
        {
            float retry = AuthoritativeRetrySeconds(ack);
            if (retry > 0f) _nextRequestAt = Mathf.Max(_nextRequestAt, Time.time + retry);
            if (!string.Equals(_pendingAttackToken, attackToken, StringComparison.Ordinal)) return;
            _pendingAttackToken = string.Empty;
            _attackRequestTimeoutAt = -100f;
        }

        public static float AuthoritativeRetrySeconds(JObject ack)
        {
            if (ack == null) return 0f;
            float retryMs = Mathf.Max(0f, ack["retryAfterMs"]?.ToObject<float>() ?? 0f);
            float cooldownMs = Mathf.Max(0f,
                ack["combat"]?["cooldownRemainingMs"]?.ToObject<float>() ?? 0f);
            return Mathf.Clamp(Mathf.Max(retryMs, cooldownMs) / 1000f, 0f, 5f);
        }
        private void AttackAt(Vector3 cursor)
        {
            string weapon = ActiveWeapon();
            if (_reloadRequestInFlight)
            {
                _nextRequestAt = Time.time + Mathf.Max(MinRequestInterval, 0.16f);
                AddLog("Перезарядка подтверждается сервером.");
                return;
            }
            if (Player != null && Player.View != null && Player.View.FireObstructed)
            {
                // IK уже поднял оружие у стены. Не отправляем заведомо
                // невозможный выстрел: игрок не теряет ОД/патроны, а другие
                // клиенты не увидят трассер сквозь препятствие.
                _nextRequestAt = Time.time + Mathf.Max(MinRequestInterval, 0.16f);
                Player.View.PlayBlockedFireContact();
                Audio?.PlayWeaponBlocked();
                AddLog("Ствол упирается в препятствие.");
                return;
            }

            if (HasAmmoWeapon() && !HasUsableRound)
            {
                _nextRequestAt = Time.time + Mathf.Max(MinRequestInterval, 0.18f);
                Player.View?.PlayAttack();
                Audio?.PlayDryFire();
                int reserve = Hud != null
                    ? Hud.ReserveAmmo : Socket?.Session?.Combat?["reserveAmmo"]?.ToObject<int>() ?? 0;
                AddLog(reserve > 0 ? "Магазин пуст — нажмите R." : "Боеприпасы закончились.");
                return;
            }

            if (BlockKnownImpossibleAttack()) return;

            if (_reloadVisualEndsAt > Time.unscaledTime)
            {
                _reloadVisualEndsAt = -100f;
                Player.View?.CancelReload();
            }

            _nextRequestAt = Time.time + MinRequestInterval;

            Vector3 self = Player.transform.position;
            Vector3 targetPosition = cursor;
            RoaCoords.ToServer(self, out float selfX, out float selfZ);
            RoaCoords.ToServer(targetPosition, out float targetX, out float targetZ);

            float angle = RoaCoords.YawDegToAngle(Player.transform.eulerAngles.y);

            // Замах проигрывается сразу, не дожидаясь ответа сервера: иначе
            // удар отставал бы от нажатия на величину задержки. Серверное
            // состояние применится сразу, а видимый результат ближнего удара
            // дождётся фактического контакта оружия.
            bool meleeAttack = !HasAmmoWeapon();
            float attackVisualStartedAt = Time.unscaledTime;
            if (Player.View != null) Player.View.PlayAttack();

            string attackToken = Guid.NewGuid().ToString("N");
            BeginAttackRequest(attackToken, meleeAttack, attackVisualStartedAt);
            SendAttackVisual(self, targetPosition, selfX, selfZ, targetX, targetZ, angle);

            if (weapon == "rocketLauncher")
            {
                SendExplosion(selfX, selfZ, targetX, targetZ, angle, targetPosition, attackToken);
                return;
            }

            if (weapon == "shotgun" || weapon == "flamethrower")
            {
                Vector3 shotDirection = cursor - self;
                shotDirection.y = 0f;
                List<RoaEnemies.ConeTarget> coneTargets =
                    Enemies.FindTargetsInCone(self, shotDirection, weapon);
                if (coneTargets.Count > 0)
                {
                    shotDirection.Normalize();
                    RoaCoords.ToServer(shotDirection, out float shotDirX, out float shotDirZ);
                    foreach (RoaEnemies.ConeTarget coneTarget in coneTargets)
                    {
                        RoaCoords.ToServer(coneTarget.Position, out float coneTargetX, out float coneTargetZ);
                        SendAuthoritativeHit(coneTarget.Id,
                            selfX, selfZ, coneTargetX, coneTargetZ, angle,
                            coneTarget.Position, attackToken,
                            true, coneTarget.Perp, coneTarget.Width, shotDirX, shotDirZ);
                    }
                    return;
                }
            }

            TryResolvePrimaryTarget(cursor, out string enemyId, out Vector3 enemyPosition,
                out PublicPlayer remote, out Vector3 remotePosition);

            if (remote != null)
            {
                RoaCoords.ToServer(remotePosition, out targetX, out targetZ);
                SendAuthoritativePlayerHit(remote, selfX, selfZ, targetX, targetZ, angle,
                    remotePosition, attackToken);
            }
            else if (!string.IsNullOrEmpty(enemyId))
            {
                RoaCoords.ToServer(enemyPosition, out targetX, out targetZ);
                SendAuthoritativeHit(enemyId, selfX, selfZ, targetX, targetZ, angle,
                    enemyPosition, attackToken);
            }
            else
            {
                SendUntargetedAttack(selfX, selfZ, angle, attackToken);
            }
        }

        private bool TryScreenPointToWorld(Vector2 screenPoint, out Vector3 cursor)
        {
            cursor = Vector3.zero;
            Camera camera = Camera.main;
            if (camera == null || Player == null) return false;
            var ground = new Plane(Vector3.up, new Vector3(0f, Player.transform.position.y - 0.9f, 0f));
            Ray ray = camera.ScreenPointToRay(screenPoint);
            if (!ground.Raycast(ray, out float rayDistance)) return false;
            cursor = ray.GetPoint(rayDistance);
            return true;
        }

        private bool TryResolvePrimaryTarget(Vector3 cursor,
                                             out string enemyId, out Vector3 enemyPosition,
                                             out PublicPlayer player, out Vector3 playerPosition)
        {
            enemyId = null;
            enemyPosition = Vector3.zero;
            player = null;
            playerPosition = Vector3.zero;
            if (Player == null || Enemies == null) return false;

            Vector3 origin = Player.transform.position;
            Vector3 direction = cursor - origin;
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) return false;
            float maxRange = RoaCombatPreview.EffectiveRange(
                Socket?.Session?.Self, Socket?.Session?.Combat, _fireMode);
            bool hasEnemy = Enemies.TryFindTargetAlongRay(origin, direction, maxRange,
                out enemyId, out enemyPosition, out _, out _);
            float playerProjection = float.PositiveInfinity;
            bool hasPlayer = RemotePlayers != null && RemotePlayers.TryFindTargetAlongRay(
                origin, direction, maxRange, RemotePlayerHitRadius,
                out player, out playerPosition, out playerProjection, out _);
            Vector3 enemyDelta = enemyPosition - origin;
            enemyDelta.y = 0f;
            float enemyDistance = hasEnemy ? enemyDelta.magnitude : float.PositiveInfinity;

            // Web compares the player's ray projection with the NPC's actual
            // planar distance, not its projection. Preserve that +5 cm tie break.
            if (hasPlayer && playerProjection <= enemyDistance + 0.05f)
            {
                enemyId = null;
                enemyPosition = Vector3.zero;
                return true;
            }
            if (hasEnemy)
            {
                player = null;
                playerPosition = Vector3.zero;
                return true;
            }

            player = null;
            playerPosition = Vector3.zero;
            return false;
        }

        /// <summary>
        /// Визуальное реле для остальных клиентов. Урон не наносит и намеренно
        /// volatile: потерянный пакет вспышки ничего не ломает (SOCKET_EVENTS.md).
        /// </summary>
        private void SendAttackVisual(Vector3 self, Vector3 target,
                                      float selfX, float selfZ, float targetX, float targetZ, float angle)
        {
            JObject combat = Socket.Session?.Combat;
            bool melee = string.IsNullOrEmpty(combat?["ammoType"]?.ToString())
                && (combat?["magSize"]?.ToObject<int>() ?? 0) <= 0;
            string weapon = combat?["weapon"]?.ToString() ?? string.Empty;

            if (melee)
            {
                Audio?.PlayMeleeSwing(Player.transform.position);
                Socket.Emit("melee", new Dictionary<string, object>
                {
                    ["targetX"] = targetX,
                    ["targetZ"] = targetZ,
                    ["angle"] = angle,
                    ["weapon"] = weapon,
                    ["deviceType"] = MobileInputMode ? "mobile" : "desktop",
                    ["controlType"] = MobileInputMode ? "touch" : "keyboard_mouse"
                });
                return;
            }

            var shots = new List<KeyValuePair<string, string>>();
            JObject equipment = EquipmentSnapshot();
            if (_fireMode == "dual" && HasDualPistolPair())
            {
                foreach (string handSlot in new[] { "weapon", "offhand" })
                {
                    if (LoadedRoundsForHand(handSlot) == 0) continue;
                    shots.Add(new KeyValuePair<string, string>(handSlot,
                        BaseItemId(equipment?[handSlot]?.ToString())));
                }
            }
            else
            {
                string handSlot = ActiveHandSlot();
                if (LoadedRoundsForHand(handSlot) != 0)
                {
                    string handWeapon = BaseItemId(equipment?[handSlot]?.ToString());
                    shots.Add(new KeyValuePair<string, string>(handSlot,
                        string.IsNullOrEmpty(handWeapon) ? weapon : handWeapon));
                }
            }

            // При пустых магазинах сервер вернёт честный отказ; клиент не рисует
            // ложный трассер и не отправляет визуальный пакет другим игрокам.
            if (shots.Count == 0) return;
            for (int i = 0; i < shots.Count; i++)
            {
                KeyValuePair<string, string> shot = shots[i];
                if (i == 0)
                    PlayRangedVisual(self, target, selfX, selfZ, targetX, targetZ,
                        angle, shot.Key, shot.Value, true);
                else
                    StartCoroutine(PlayDelayedRangedVisual(self, target, selfX, selfZ,
                        targetX, targetZ, angle, shot.Key, shot.Value));
            }
        }

        private IEnumerator PlayDelayedRangedVisual(Vector3 self, Vector3 target,
                                                     float selfX, float selfZ,
                                                     float targetX, float targetZ, float angle,
                                                     string handSlot, string weaponId)
        {
            yield return new WaitForSecondsRealtime(0.09f);
            PlayRangedVisual(self, target, selfX, selfZ, targetX, targetZ,
                angle, handSlot, weaponId, false);
        }

        private void PlayRangedVisual(Vector3 self, Vector3 target,
                                      float selfX, float selfZ, float targetX, float targetZ,
                                      float angle, string handSlot, string weaponId,
                                      bool addCameraImpulse)
        {
            if (Socket == null || Player == null) return;

            Vector3 dir = target - self;
            dir.y = 0f;
            if (dir.sqrMagnitude > 0.0001f) dir.Normalize();
            RoaCoords.ToServer(dir, out float dirX, out float dirZ);

            Vector3 start = Vector3.zero;
            bool exactMuzzle = Player.View != null
                && Player.View.TryGetMuzzle(handSlot, out start);
            if (!exactMuzzle)
            {
                float side = handSlot == "offhand" ? -0.34f : 0.34f;
                start = self + Player.transform.right * side
                    + Player.transform.forward * 0.24f + Vector3.up * 0.23f;
            }
            RoaCoords.ToServer(start, out float startX, out float startZ);

            Socket.Emit("shoot", new Dictionary<string, object>
            {
                ["shotSeq"] = ++_shotSeq,
                ["clientFiredAt"] = Mathf.RoundToInt(Time.realtimeSinceStartup * 1000f),
                ["startX"] = startX,
                ["startY"] = start.y,
                ["startZ"] = startZ,
                ["originX"] = selfX,
                ["originZ"] = selfZ,
                ["dirX"] = dirX,
                ["dirZ"] = dirZ,
                ["endX"] = targetX,
                ["endZ"] = targetZ,
                ["angle"] = angle,
                ["mode"] = _fireMode,
                ["handSlot"] = handSlot,
                ["deviceType"] = MobileInputMode ? "mobile" : "desktop",
                ["controlType"] = MobileInputMode ? "touch" : "keyboard_mouse"
            });

            if (Fx == null) return;
            Vector3 end = new Vector3(target.x, Mathf.Max(1.02f, target.y + 0.23f), target.z);
            Fx.PlayShot(start, end, weaponId, exactMuzzle);
            if (addCameraImpulse)
            {
                float impulse = RoaCombatFx.ImpulseFor(weaponId) * (MobileInputMode ? 0.6f : 1f);
                RoaGameBootstrap.Active?.CameraRig?.AddImpulse(impulse);
            }
        }
        private void SendAuthoritativeHit(string enemyId,
                                          float selfX, float selfZ,
                                          float targetX, float targetZ,
                                          float angle, Vector3 targetPosition,
                                          string attackToken,
                                          bool multiTarget = false,
                                          float conePerp = 0f,
                                          float coneWidth = 0f,
                                          float shotDirX = 0f,
                                          float shotDirZ = 0f)
        {
            Socket.EmitWithAck("enemyHit", new Dictionary<string, object>
            {
                ["attackToken"] = attackToken,
                ["enemyId"] = enemyId,
                ["x"] = selfX,
                ["z"] = selfZ,
                ["targetX"] = targetX,
                ["targetZ"] = targetZ,
                ["angle"] = angle,
                ["mode"] = _fireMode,
                ["handSlot"] = ActiveHandSlot(),
                ["weapon"] = ActiveWeapon(),
                ["weaponRuntimeId"] = ActiveWeaponRuntimeId(),
                ["equipment"] = EquipmentSnapshot(),
                ["multiTarget"] = multiTarget,
                ["conePerp"] = conePerp,
                ["coneWidth"] = coneWidth,
                ["shotDirX"] = shotDirX,
                ["shotDirZ"] = shotDirZ
            }, ack =>
            {
                CompleteAttackRequest(attackToken, ack);
                HandleHitResult(ack, targetPosition, RoaCoords.ToUnity(selfX, selfZ), attackToken);
            });
        }

        private void SendAuthoritativePlayerHit(PublicPlayer target,
                                                float selfX, float selfZ,
                                                float targetX, float targetZ,
                                                float angle, Vector3 targetPosition,
                                                string attackToken)
        {
            if (target == null || string.IsNullOrEmpty(target.Id)) return;
            Socket.EmitWithAck("playerHit", new Dictionary<string, object>
            {
                ["attackToken"] = attackToken,
                ["targetId"] = target.Id,
                ["x"] = selfX,
                ["z"] = selfZ,
                ["targetX"] = targetX,
                ["targetZ"] = targetZ,
                ["angle"] = angle,
                ["mode"] = _fireMode,
                ["handSlot"] = ActiveHandSlot(),
                ["weapon"] = ActiveWeapon(),
                ["weaponRuntimeId"] = ActiveWeaponRuntimeId(),
                ["equipment"] = EquipmentSnapshot()
            }, ack =>
            {
                CompleteAttackRequest(attackToken, ack);
                HandlePlayerHitResult(ack, target, targetPosition,
                    RoaCoords.ToUnity(selfX, selfZ), attackToken);
            });
        }

        private void SendUntargetedAttack(float selfX, float selfZ, float angle, string attackToken)
        {
            Socket.EmitWithAck("combatAttack", new Dictionary<string, object>
            {
                ["attackToken"] = attackToken,
                ["x"] = selfX,
                ["z"] = selfZ,
                ["angle"] = angle,
                ["mode"] = _fireMode,
                ["handSlot"] = ActiveHandSlot(),
                ["weapon"] = ActiveWeapon(),
                ["weaponRuntimeId"] = ActiveWeaponRuntimeId(),
                ["equipment"] = EquipmentSnapshot()
            }, ack =>
            {
                CompleteAttackRequest(attackToken, ack);
                TryTakeMeleePresentationDelay(attackToken, out float unusedPresentationDelay);
                if (ack == null) return;
                Socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    AddLog(ack["error"]?.ToString() ?? "Атака отклонена.");
                    return;
                }
                ApplyResolvedMode(ack);
            });
        }

        private void SendExplosion(float selfX, float selfZ, float impactX, float impactZ,
                                   float angle, Vector3 impactPosition, string attackToken)
        {
            Socket.EmitWithAck("explosionAttack", new Dictionary<string, object>
            {
                ["attackToken"] = attackToken,
                ["weapon"] = ActiveWeapon(),
                ["weaponRuntimeId"] = ActiveWeaponRuntimeId(),
                ["handSlot"] = ActiveHandSlot(),
                ["mode"] = _fireMode,
                ["impactX"] = impactX,
                ["impactZ"] = impactZ,
                ["x"] = selfX,
                ["z"] = selfZ,
                ["angle"] = angle,
                ["equipment"] = EquipmentSnapshot()
            }, ack =>
            {
                CompleteAttackRequest(attackToken, ack);
                HandleExplosionResult(ack, impactPosition);
            });
        }

        private void HandleHitResult(JObject ack, Vector3 targetPosition, Vector3 sourcePosition,
                                     string attackToken)
        {
            bool meleePresentation = TryTakeMeleePresentationDelay(
                attackToken, out float presentationDelay);
            if (ack == null) return;
            Socket.ApplyGameplayAck(ack);
            ApplyResolvedMode(ack);

            bool accepted = ack["ok"]?.ToObject<bool>() == true;
            if (accepted && meleePresentation && presentationDelay > 0.001f)
            {
                StartCoroutine(PresentHitResultAfterDelay((JObject)ack.DeepClone(),
                    targetPosition, sourcePosition, attackToken, presentationDelay));
                return;
            }

            PresentHitResult(ack, targetPosition, sourcePosition, attackToken);
        }

        private IEnumerator PresentHitResultAfterDelay(JObject ack, Vector3 targetPosition,
                                                        Vector3 sourcePosition, string attackToken,
                                                        float delay)
        {
            yield return new WaitForSecondsRealtime(delay);
            PresentHitResult(ack, targetPosition, sourcePosition, attackToken);
        }

        private void PresentHitResult(JObject ack, Vector3 targetPosition, Vector3 sourcePosition,
                                      string attackToken)
        {
            bool accepted = ack["ok"]?.ToObject<bool>() == true;
            bool hit = accepted && (ack["hit"]?.ToObject<bool>() ?? true);
            int damage = Mathf.Max(0, Mathf.RoundToInt(ack["damage"]?.ToObject<float>() ?? 0f));
            bool critical = ack["critical"]?.ToObject<bool>() ?? false;
            JObject enemy = ack["enemy"] as JObject;
            if (enemy != null)
            {
                if (hit) Enemies.ApplyPublicEnemyHit(enemy, sourcePosition, damage, critical);
                else Enemies.ApplyPublicEnemy(enemy);
            }

            if (!accepted)
            {
                // Отказы сервера уже на русском и пригодны для показа игроку:
                // мало ОД, пустой магазин, мирная локация, цель недоступна.
                string error = ack["error"]?.ToString();
                if (!string.IsNullOrEmpty(error)) AddLog(error);
                return;
            }

            if (!hit)
            {
                float chance = ack["chance"]?.ToObject<float>() ?? 0f;
                string missWeapon = ack["weapon"]?.ToString() ?? ActiveWeapon();
                if (!string.IsNullOrEmpty(RoaWeaponData.Get(missWeapon).AmmoType))
                {
                    float targetScale = Mathf.Max(0.72f, enemy?["scale"]?.ToObject<float>() ?? 1f);
                    Vector3 missPoint = RoaCombatFx.ResolveMissPoint(
                        sourcePosition, targetPosition, attackToken, targetScale);
                    Fx?.PlayMiss(missPoint, sourcePosition, missWeapon);
                }
                Float("мимо", targetPosition, new Color(0.72f, 0.72f, 0.72f));
                AddLog("Промах, шанс был " + Mathf.RoundToInt(chance) + "%");
                return;
            }

            bool dead = enemy?["dead"]?.ToObject<bool>() ?? false;
            string weapon = ack["weapon"]?.ToString() ?? ActiveWeapon();
            if (string.IsNullOrEmpty(RoaWeaponData.Get(weapon).AmmoType))
                Audio?.PlayMeleeImpact(targetPosition, critical);
            Audio?.PlayHitConfirm(critical);
            Fx?.PlayConfirmedHit(targetPosition, sourcePosition, weapon, critical, dead);
            ConfirmHit(targetPosition, critical, dead);

            Float((critical ? "КРИТ " : "") + damage, targetPosition,
                critical ? new Color(1f, 0.85f, 0.25f) : new Color(1f, 0.45f, 0.4f));

            string name = enemy?["name"]?.ToString() ?? "цель";
            AddLog(name + ": " + damage + (critical ? " (крит)" : "") + (dead ? " — убит" : ""));
        }

        private void HandlePlayerHitResult(JObject ack, PublicPlayer target, Vector3 targetPosition,
                                           Vector3 sourcePosition, string attackToken)
        {
            bool meleePresentation = TryTakeMeleePresentationDelay(
                attackToken, out float presentationDelay);
            if (ack == null) return;
            Socket.ApplyGameplayAck(ack);
            ApplyResolvedMode(ack);

            bool accepted = ack["ok"]?.ToObject<bool>() == true;
            if (accepted && meleePresentation && presentationDelay > 0.001f)
            {
                StartCoroutine(PresentPlayerHitResultAfterDelay((JObject)ack.DeepClone(), target,
                    targetPosition, sourcePosition, attackToken, presentationDelay));
                return;
            }

            PresentPlayerHitResult(ack, target, targetPosition, sourcePosition, attackToken);
        }

        private IEnumerator PresentPlayerHitResultAfterDelay(JObject ack, PublicPlayer target,
                                                              Vector3 targetPosition,
                                                              Vector3 sourcePosition,
                                                              string attackToken, float delay)
        {
            yield return new WaitForSecondsRealtime(delay);
            PresentPlayerHitResult(ack, target, targetPosition, sourcePosition, attackToken);
        }

        private void PresentPlayerHitResult(JObject ack, PublicPlayer target,
                                            Vector3 targetPosition, Vector3 sourcePosition,
                                            string attackToken)
        {
            if (ack["target"] is JObject targetState)
                RemotePlayers?.ApplyPublicPlayer(targetState.ToObject<PublicPlayer>());

            if (ack["ok"]?.ToObject<bool>() != true)
            {
                AddLog(ack["error"]?.ToString() ?? "PvP-атака отклонена.");
                return;
            }

            bool hit = ack["hit"]?.ToObject<bool>() ?? false;
            if (!hit)
            {
                string missWeapon = ack["weapon"]?.ToString() ?? ActiveWeapon();
                if (!string.IsNullOrEmpty(RoaWeaponData.Get(missWeapon).AmmoType))
                {
                    Vector3 missPoint = RoaCombatFx.ResolveMissPoint(
                        sourcePosition, targetPosition, attackToken);
                    Fx?.PlayMiss(missPoint, sourcePosition, missWeapon);
                }
                Float("мимо", targetPosition, new Color(0.72f, 0.72f, 0.72f));
                AddLog("Промах по " + (target?.Name ?? "игроку") + ", шанс "
                    + Mathf.RoundToInt(ack["chance"]?.ToObject<float>() ?? 0f) + "%");
                return;
            }

            int damage = Mathf.Max(0, Mathf.RoundToInt(ack["damage"]?.ToObject<float>() ?? 0f));
            bool critical = ack["critical"]?.ToObject<bool>() ?? false;
            bool killed = ack["killed"]?.ToObject<bool>() ?? false;
            string weapon = ack["weapon"]?.ToString() ?? ActiveWeapon();
            if (string.IsNullOrEmpty(RoaWeaponData.Get(weapon).AmmoType))
                Audio?.PlayMeleeImpact(targetPosition, critical);
            Audio?.PlayHitConfirm(critical);
            if (killed) Audio?.PlayKillConfirm();
            Fx?.PlayConfirmedHit(targetPosition, sourcePosition, weapon, critical, killed);
            ConfirmHit(targetPosition, critical, killed);
            Float((critical ? "КРИТ " : "") + damage, targetPosition,
                critical ? new Color(1f, 0.85f, 0.25f) : new Color(1f, 0.35f, 0.3f));
            AddLog((target?.Name ?? "Игрок") + ": " + damage
                + (critical ? " (крит)" : "") + (killed ? " — убит" : ""));
        }

        private void HandleExplosionResult(JObject ack, Vector3 impactPosition)
        {
            if (ack == null) return;
            Socket.ApplyGameplayAck(ack);
            ApplyResolvedMode(ack);
            if (ack["ok"]?.ToObject<bool>() != true)
            {
                AddLog(ack["error"]?.ToString() ?? "Взрыв отклонён.");
                return;
            }

            JArray enemyHits = ack["enemyHits"] as JArray;
            if (ack["enemies"] is JArray enemies)
            {
                foreach (JToken token in enemies)
                {
                    if (!(token is JObject enemy)) continue;
                    JObject hit = FindResultRow(enemyHits, "enemyId", enemy["id"]?.ToString());
                    if (hit != null)
                        Enemies.ApplyPublicEnemyHit(enemy, impactPosition,
                            Mathf.Max(0, hit["damage"]?.ToObject<int>() ?? 0),
                            hit["critical"]?.ToObject<bool>() == true);
                    else Enemies.ApplyPublicEnemy(enemy);
                }
            }

            int affected = 0;
            int confirmedTargets = 0;
            bool anyCritical = false;
            bool killedRemotePlayer = false;
            if (enemyHits != null)
            {
                foreach (JToken token in enemyHits)
                {
                    JObject hit = token as JObject;
                    if (hit == null) continue;
                    affected++;
                    confirmedTargets++;
                    string id = hit["enemyId"]?.ToString();
                    Vector3 position = impactPosition;
                    if (!string.IsNullOrEmpty(id)
                        && Enemies.TryGetPosition(id, out Vector3 resolvedEnemyPosition))
                        position = resolvedEnemyPosition;
                    int damage = Mathf.Max(0, hit["damage"]?.ToObject<int>() ?? 0);
                    bool critical = hit["critical"]?.ToObject<bool>() == true;
                    bool killed = hit["killed"]?.ToObject<bool>() == true;
                    anyCritical |= critical;
                    ConfirmHit(position, critical, killed);
                    Float((critical ? "КРИТ " : "") + damage, position,
                        critical ? new Color(1f, 0.85f, 0.25f) : new Color(1f, 0.55f, 0.3f));
                }
            }

            if (ack["playerHits"] is JArray playerHits)
            {
                foreach (JToken token in playerHits)
                {
                    JObject hit = token as JObject;
                    if (hit == null) continue;
                    affected++;
                    string id = hit["playerId"]?.ToString();
                    bool selfHit = string.Equals(id, Socket?.Session?.Id, StringComparison.Ordinal);
                    if (selfHit) continue; // incoming-damage feedback already owns this branch.

                    Vector3 position = impactPosition;
                    if (!string.IsNullOrEmpty(id) && RemotePlayers != null
                        && RemotePlayers.TryGetPosition(id, out Vector3 resolvedPlayerPosition))
                        position = resolvedPlayerPosition;
                    int damage = Mathf.Max(0, hit["damage"]?.ToObject<int>() ?? 0);
                    bool critical = hit["critical"]?.ToObject<bool>() == true;
                    bool killed = hit["killed"]?.ToObject<bool>() == true;
                    confirmedTargets++;
                    anyCritical |= critical;
                    killedRemotePlayer |= killed;
                    ConfirmHit(position, critical, killed);
                    Float((critical ? "КРИТ " : "") + damage, position,
                        critical ? new Color(1f, 0.85f, 0.25f) : new Color(1f, 0.45f, 0.34f));
                }
            }

            if (Fx != null)
                Fx.PlayExplosion(impactPosition, ack["radius"]?.ToObject<float>() ?? 3.6f);
            if (confirmedTargets > 0) Audio?.PlayHitConfirm(anyCritical);
            if (killedRemotePlayer) Audio?.PlayKillConfirm();
            Float("ВЗРЫВ", impactPosition, new Color(1f, 0.65f, 0.22f));
            AddLog(affected > 0 ? "Взрыв задел целей: " + affected : "Взрыв никого не задел.");
        }

        private static JObject FindResultRow(JArray rows, string idKey, string id)
        {
            if (rows == null || string.IsNullOrEmpty(id)) return null;
            foreach (JToken token in rows)
                if (token is JObject row
                    && string.Equals(row[idKey]?.ToString(), id, StringComparison.Ordinal)) return row;
            return null;
        }

        private void EnsureFireMode()
        {
            string weapon = ActiveWeapon();
            if (weapon == _modeWeapon && AvailableModes().Contains(_fireMode)) return;
            _modeWeapon = weapon;
            _fireMode = HasAmmoWeapon() ? "single" : "melee";
        }

        private void CycleFireMode()
        {
            List<string> modes = AvailableModes();
            if (modes.Count <= 1)
            {
                AddLog(ActiveWeapon() + ": режим не меняется.");
                return;
            }

            int index = modes.IndexOf(_fireMode);
            _fireMode = modes[(Mathf.Max(0, index) + 1) % modes.Count];
            AddLog("X: режим «" + ModeLabel(_fireMode) + "».");
        }

        private List<string> AvailableModes()
        {
            var modes = new List<string>();
            if (!HasAmmoWeapon())
            {
                modes.Add("melee");
                return modes;
            }

            modes.Add("single");
            modes.Add("aimed");
            string weapon = ActiveWeapon();
            if (weapon == "smg" || weapon == "assaultRifle" || weapon == "machineGun" || weapon == "flamethrower")
                modes.Add("auto");
            if (HasDualPistolPair()) modes.Add("dual");
            return modes;
        }

        private bool HasAmmoWeapon()
        {
            return !string.IsNullOrEmpty(Socket?.Session?.Combat?["ammoType"]?.ToString());
        }

        private bool HasDualPistolPair()
        {
            JObject equipment = EquipmentSnapshot();
            string right = BaseItemId(equipment?["weapon"]?.ToString());
            string left = BaseItemId(equipment?["offhand"]?.ToString());
            return IsDualPistol(right) && IsDualPistol(left);
        }

        private int LoadedRoundsForHand(string handSlot)
        {
            if (Socket?.Session == null) return -1;
            string slot = handSlot == "offhand" ? "offhand" : "weapon";
            string expectedRuntime = Socket.Session.Self?["equipmentRuntime"]?[slot]?.ToString() ?? string.Empty;
            JArray combats = Socket.Session.Combats;
            if (combats != null)
            {
                foreach (JToken token in combats)
                {
                    JObject row = token as JObject;
                    if (row?["handSlot"]?.ToString() != slot) continue;
                    if (!string.IsNullOrEmpty(expectedRuntime)
                        && row?["weaponRuntimeId"]?.ToString() != expectedRuntime) continue;
                    return Mathf.Max(0, row["loaded"]?.ToObject<int>() ?? 0);
                }
            }

            JObject active = Socket.Session.Combat;
            if (active?["handSlot"]?.ToString() == slot
                && (string.IsNullOrEmpty(expectedRuntime)
                    || active?["weaponRuntimeId"]?.ToString() == expectedRuntime))
                return Mathf.Max(0, active["loaded"]?.ToObject<int>() ?? 0);
            return -1;
        }

        private static bool IsDualPistol(string id)
        {
            return id == "pistol" || id == "laserPistol";
        }

        private static string ModeLabel(string mode)
        {
            if (mode == "aimed") return "прицельный";
            if (mode == "auto") return "автоматический";
            if (mode == "dual") return "парный залп";
            if (mode == "melee") return "ближний бой";
            return "одиночный";
        }

        private void ApplyResolvedMode(JObject ack)
        {
            string mode = ack?["mode"]?.ToString();
            if (!string.IsNullOrEmpty(mode)) _fireMode = mode;
            if (ack?["fallback"]?.ToObject<bool>() == true)
                AddLog("Сервер переключил атаку на «" + ModeLabel(_fireMode) + "».");
        }

        private string ActiveWeapon()
        {
            return Socket?.Session?.Combat?["weapon"]?.ToString() ?? "fists";
        }

        private string ActiveWeaponRuntimeId()
        {
            return Socket?.Session?.Combat?["weaponRuntimeId"]?.ToString() ?? ActiveWeapon();
        }

        private string ActiveHandSlot()
        {
            return Socket?.Session?.Combat?["handSlot"]?.ToString() == "offhand" ? "offhand" : "weapon";
        }

        private JObject EquipmentSnapshot()
        {
            return Socket?.Session?.Self?["equipment"] as JObject;
        }

        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId ?? string.Empty;
            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        private void Reload()
        {
            if (Socket == null || Socket.Session == null) return;
            if (_reloadRequestInFlight)
            {
                AddLog("Перезарядка уже подтверждается сервером.");
                return;
            }

            JObject combat = Socket.Session.Combat;
            string weapon = combat?["weapon"]?.ToString();
            if (string.IsNullOrEmpty(weapon))
            {
                AddLog("Нет активного оружия для перезарядки.");
                return;
            }

            string ammoType = combat?["ammoType"]?.ToString() ?? string.Empty;
            int magSize = combat?["magSize"]?.ToObject<int>() ?? 0;
            int loaded = combat?["loaded"]?.ToObject<int>() ?? 0;
            int reserve = combat?["reserveAmmo"]?.ToObject<int>() ?? 0;
            if (string.IsNullOrEmpty(ammoType) || magSize <= 0)
            {
                AddLog("Это оружие не требует перезарядки.");
                return;
            }
            if (_fireMode != "dual" && loaded >= magSize)
            {
                AddLog("Магазин уже полон.");
                return;
            }
            if (reserve <= 0)
            {
                Audio?.PlayDryFire();
                AddLog("Нет патронов в запасе.");
                return;
            }

            var payload = new Dictionary<string, object> { ["weapon"] = weapon };
            JObject equipment = Socket.Session.Self?["equipment"] as JObject;
            if (equipment != null) payload["equipment"] = equipment;

            _reloadRequestInFlight = true;
            AddLog("Перезарядка…");
            Socket.EmitWithAck("reloadWeapon", payload, ack =>
            {
                _reloadRequestInFlight = false;
                if (ack == null)
                {
                    AddLog("Сервер не ответил на перезарядку.");
                    return;
                }

                Socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    Audio?.PlayDryFire();
                    AddLog(ack["error"]?.ToString() ?? "Перезарядка отклонена.");
                    return;
                }

                int take = ack["take"]?.ToObject<int>() ?? 0;
                float apCost = ack["apCost"]?.ToObject<float>() ?? 0f;
                _reloadVisualEndsAt = Time.unscaledTime + ReloadVisualSeconds;
                Player.View?.StartReload(ReloadVisualSeconds);
                Audio?.PlayReload();
                AddLog("Перезарядка: +" + take + " патр., -" + apCost.ToString("0.#") + " ОД");
            });
        }

        private void AddLog(string line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;
            if (_log.Count > 0 && line == _lastLogRaw)
            {
                _lastLogCount++;
                _log[_log.Count - 1] = line + " \u00d7" + _lastLogCount;
                return;
            }
            _lastLogRaw = line;
            _lastLogCount = 1;
            _log.Add(line);
            while (_log.Count > LogLimit) _log.RemoveAt(0);
        }

        private void Float(string text, Vector3 world, Color color)
        {
            if (CanvasDriven)
            {
                RoaCombatFeedbackCanvas feedback = EnsureFeedbackCanvas();
                if (feedback != null)
                {
                    feedback.ShowFloating(text, world + Vector3.up * 1.6f, color);
                    return;
                }
            }

            _floating.Add(new FloatingText
            {
                Text = text,
                World = world + Vector3.up * 1.6f,
                Until = Time.time + 1.1f,
                Color = color
            });
        }

        private void ConfirmHit(Vector3 world, bool critical, bool killed)
        {
            if (CanvasDriven)
            {
                RoaCombatFeedbackCanvas feedback = EnsureFeedbackCanvas();
                if (feedback != null)
                {
                    feedback.ShowHit(world + Vector3.up * 1.08f, critical, killed);
                    return;
                }
            }

            while (_hitConfirmations.Count >= HitConfirmationLimit)
                _hitConfirmations.RemoveAt(0);
            _hitConfirmations.Add(new HitConfirmation
            {
                World = world + Vector3.up * 1.08f,
                Started = Time.unscaledTime,
                Critical = critical,
                Killed = killed
            });
        }

        private RoaCombatFeedbackCanvas EnsureFeedbackCanvas()
        {
            if (FeedbackCanvas == null) FeedbackCanvas = GetComponent<RoaCombatFeedbackCanvas>();
            if (FeedbackCanvas == null) FeedbackCanvas = gameObject.AddComponent<RoaCombatFeedbackCanvas>();
            Camera camera = RoaGameBootstrap.Active?.CameraRig?.GetComponent<Camera>() ?? Camera.main;
            FeedbackCanvas.Configure(camera);
            return FeedbackCanvas;
        }

        private static void DrawHitConfirmation(Camera camera, HitConfirmation confirmation)
        {
            Vector3 screen = camera.WorldToScreenPoint(confirmation.World);
            if (screen.z <= 0f) return;
            RoaCombatConfirmation.Frame frame = RoaCombatConfirmation.Evaluate(
                Time.unscaledTime - confirmation.Started, confirmation.Critical, confirmation.Killed);
            if (!frame.Visible || frame.Alpha <= 0f) return;

            float x = screen.x;
            float y = Screen.height - screen.y;
            float r = frame.Radius;
            float length = frame.Length;
            float thickness = frame.Thickness;
            Color previous = GUI.color;
            Color color = frame.Color;
            color.a *= frame.Alpha;
            GUI.color = color;

            DrawMarkerCorner(x - r, y - r, length, thickness, true, true);
            DrawMarkerCorner(x + r, y - r, length, thickness, false, true);
            DrawMarkerCorner(x - r, y + r, length, thickness, true, false);
            DrawMarkerCorner(x + r, y + r, length, thickness, false, false);
            GUI.color = previous;
        }

        private static void DrawMarkerCorner(float x, float y, float length, float thickness,
                                             bool opensRight, bool opensDown)
        {
            float horizontalX = opensRight ? x : x - length;
            float verticalY = opensDown ? y : y - length;
            GUI.DrawTexture(new Rect(horizontalX, y - thickness * 0.5f, length, thickness),
                            Texture2D.whiteTexture);
            GUI.DrawTexture(new Rect(x - thickness * 0.5f, verticalY, thickness, length),
                            Texture2D.whiteTexture);
        }

        /// <summary>Подсказку цели рисует канва (RoaActorNameplates); IMGUI-вариант молчит.</summary>
        public bool TargetHintCanvasDriven { get; set; }

        /// <summary>
        /// Compact compatibility API retained for the existing HUD. The richer
        /// display overload below also exposes blocked/range state and colour.
        /// </summary>
        public bool TryGetTargetHint(out string name, out int chance)
        {
            if (!TryBuildTargetFrame(out name, out chance, out _))
            {
                name = string.Empty;
                chance = 0;
                return false;
            }
            return true;
        }

        public bool TryGetTargetDisplay(out string name, out string label, out Color color)
        {
            name = string.Empty;
            label = string.Empty;
            color = Color.white;
            if (!TryBuildTargetFrame(out name, out _, out RoaTargetingFeedback.Frame frame)) return false;
            label = frame.Label;
            // Keep the requested bright-red percentage; only explicit invalid
            // states use the matching blocked/range colour.
            color = frame.State == RoaTargetingFeedback.Status.Ready
                ? new Color(1f, 0.176f, 0.122f, 1f) : frame.Color;
            return true;
        }

        private bool TryBuildTargetFrame(out string name, out int chance,
                                         out RoaTargetingFeedback.Frame frame)
        {
            name = string.Empty;
            chance = 0;
            frame = default(RoaTargetingFeedback.Frame);
            if (_hoverTarget == null || Player == null || Socket?.Session?.Self == null) return false;
            if (_hoverTarget["dead"]?.ToObject<bool>() == true) return false;

            RoaCombatPreview.Result preview = RoaCombatPreview.Calculate(
                Socket.Session.Self, Socket.Session.Combat, _hoverTarget, Player, _hoverPosition, _fireMode);
            float targetScale = _hoverTarget["isRemotePlayer"]?.ToObject<bool>() == true
                ? 1f : _hoverTarget["scale"]?.ToObject<float>() ?? 1f;
            bool lineBlocked = preview.InRange
                && ((Player.View != null && Player.View.FireObstructed)
                    || AttackLineBlocked(_hoverPosition, targetScale));
            bool remote = _hoverTarget["isRemotePlayer"]?.ToObject<bool>() == true;
            name = _hoverTarget["name"]?.ToString() ?? (remote ? "Игрок" : "Цель");
            chance = lineBlocked ? 0 : preview.Chance;
            frame = RoaTargetingFeedback.Evaluate(Time.unscaledTime, chance,
                preview.InRange, lineBlocked, targetScale);
            return true;
        }

        private void UpdateTargetingFeedback(bool enabled)
        {
            if (!enabled || RoaGameBootstrap.BlocksWorldHud
                || !TryBuildTargetFrame(out _, out _, out RoaTargetingFeedback.Frame frame))
            {
                if (_targetingFeedback != null) _targetingFeedback.Hide();
                return;
            }

            if (_targetingFeedback == null)
            {
                _targetingFeedback = GetComponent<RoaTargetingFeedback>();
                if (_targetingFeedback == null) _targetingFeedback = gameObject.AddComponent<RoaTargetingFeedback>();
            }
            _targetingFeedback.Present(frame, Player.transform.position, _hoverPosition, true);
        }
        private void DrawTargetHint()
        {
            if (TargetHintCanvasDriven) return;
            if (_hoverTarget == null || Player == null || Socket?.Session?.Self == null) return;
            RoaCombatPreview.Result preview = RoaCombatPreview.Calculate(
                Socket.Session.Self, Socket.Session.Combat, _hoverTarget, Player, _hoverPosition, _fireMode);
            bool lineBlocked = preview.InRange && AttackLineBlocked(_hoverPosition,
                _hoverTarget["scale"]?.ToObject<float>() ?? 1f);
            if (lineBlocked)
            {
                preview.Chance = 0;
                preview.DamageExpected = 0;
            }
            bool awareness = Socket.Session.Self["talentRanks"]?["awareness"]?.ToObject<int>() > 0;
            bool remote = _hoverTarget["isRemotePlayer"]?.ToObject<bool>() == true;
            bool neutral = !remote && _hoverTarget["hostileToPlayer"]?.ToObject<bool>() == false;
            string personality = _hoverTarget["personality"]?["label"]?.ToString();
            string schedule = _hoverTarget["scheduleLabel"]?.ToString();
            string faction = _hoverTarget["wastelandOwnerLabel"]?.ToString();
            int extraRows = (string.IsNullOrEmpty(personality) ? 0 : 1)
                + (string.IsNullOrEmpty(schedule) ? 0 : 1)
                + (string.IsNullOrEmpty(faction) ? 0 : 1);
            float width = Mathf.Min(380f, Screen.width - 24f);
            float height = (awareness ? 238f : 188f) + extraRows * 20f;
            Vector2 mouse = Event.current.mousePosition;
            float x = Mathf.Clamp(mouse.x + 18f, 12f, Screen.width - width - 12f);
            float y = Mathf.Clamp(mouse.y + 18f, 12f, Screen.height - height - 12f);
            GUILayout.BeginArea(new Rect(x, y, width, height), GUI.skin.window);
            GUILayout.Label("<b>" + Escape(_hoverTarget["name"]?.ToString() ?? (remote ? "Игрок" : "Цель")) + "</b>", TargetHintStyle());
            GUILayout.Label(remote ? "Игрок" : neutral ? "Нейтральный" : "Враждебный");
            if (!string.IsNullOrEmpty(faction)) GUILayout.Label("Фракция: " + faction);
            if (!string.IsNullOrEmpty(personality)) GUILayout.Label("Характер: " + personality);
            if (!string.IsNullOrEmpty(schedule)) GUILayout.Label("Занят: " + schedule);

            int hp = Mathf.Max(0, _hoverTarget["hp"]?.ToObject<int>() ?? 0);
            int maxHp = Mathf.Max(1, _hoverTarget["maxHp"]?.ToObject<int>() ?? hp);
            GUILayout.Label(awareness
                ? "ОЗ " + hp + "/" + maxHp + " · " + HealthState(hp, maxHp)
                : "Состояние: " + HealthState(hp, maxHp));
            Color previous = GUI.contentColor;
            GUI.contentColor = new Color(1f, 0.36f, 0.30f);
            GUILayout.Label("Шанс попадания: " + preview.Chance + "%", TargetHintStyle());
            GUI.contentColor = previous;

            if (awareness && preview.HasDamage)
            {
                string range = preview.DamageMin == preview.DamageMax
                    ? preview.DamageMin.ToString()
                    : preview.DamageMin + "–" + preview.DamageMax;
                GUILayout.Label("Предп. урон: " + range + " " + DamageTypeLabel(preview.DamageType)
                    + " · средний " + preview.DamageAverage + " · с шансом ≈" + preview.DamageExpected,
                    TargetHintStyle());
            }
            else if (awareness && remote)
                GUILayout.Label("Урон по игроку окончательно определяет его серверная экипировка.", TargetHintStyle());

            string note = lineBlocked
                ? "Линия огня перекрыта"
                : preview.InRange
                ? preview.ModeLabel + " · " + preview.ApCost + " ОД · " + preview.Distance.ToString("0") + " м"
                : "Вне дальности · " + preview.Distance.ToString("0") + "/" + preview.Range.ToString("0") + " м";
            if (preview.InRange && !lineBlocked && preview.CriticalChance > 0)
                note += " · крит " + preview.CriticalChance + "% (×2)";
            if (preview.InRange && !lineBlocked && preview.EnergyFailureChance > 0)
                note += " · риск сбоя " + preview.EnergyFailureChance + "%";
            GUILayout.Label(note, TargetHintStyle());
            GUILayout.EndArea();
        }

        private bool AttackLineBlocked(Vector3 target, float targetScale)
        {
            Vector3 start = Player.transform.position + Vector3.up * (Player.Crouching ? 0.62f : 1.16f);
            Vector3 end = target + Vector3.up * (Player.Crouching ? 0.62f : 1.05f);
            Vector3 direction = end - start;
            float distance = direction.magnitude;
            if (distance <= 0.2f) return false;
            direction /= distance;
            float targetPadding = Mathf.Max(0.65f, Mathf.Clamp(targetScale, 0.5f, 2f) * 0.55f);
            if (Fog != null && Fog.TerrainBlocksBallisticLine(Player.transform.position,
                target, Player.Crouching, targetPadding)) return true;
            float checkDistance = Mathf.Max(0.05f, distance - targetPadding);
            RaycastHit[] hits = Physics.RaycastAll(start, direction, checkDistance,
                Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
            foreach (RaycastHit hit in hits)
            {
                if (hit.collider == null) continue;
                Transform colliderTransform = hit.collider.transform;
                if (colliderTransform == Player.transform || colliderTransform.IsChildOf(Player.transform)) continue;
                return true;
            }
            return false;
        }

        private GUIStyle TargetHintStyle()
        {
            if (_targetHintStyle == null)
                _targetHintStyle = new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true };
            return _targetHintStyle;
        }

        private static string HealthState(int hp, int maxHp)
        {
            if (hp <= 0) return "при смерти";
            float ratio = hp / (float)Mathf.Max(1, maxHp);
            if (hp >= maxHp || ratio >= 0.995f) return "здоров";
            if (ratio >= 0.8f) return "лёгкое ранение";
            if (ratio >= 0.5f) return "ранен";
            if (ratio >= 0.3f) return "сильное ранение";
            if (ratio >= 0.1f) return "критическое ранение";
            return "при смерти";
        }

        private static string DamageTypeLabel(string type)
        {
            if (type == "explosive") return "взрывной";
            if (type == "energy") return "энергетический";
            if (type == "fire") return "огненный";
            if (type == "radiation") return "радиационный";
            if (type == "toxic") return "токсичный";
            return "баллистический";
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty).Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
        }

        private void OnGUI()
        {
            RoaUiTheme.Apply();
            if (RoaGameBootstrap.BlocksWorldHud) return;
            UnityEngine.Camera cam = UnityEngine.Camera.main;

            if (!CanvasDriven && cam != null)
            {
                foreach (HitConfirmation confirmation in _hitConfirmations)
                    DrawHitConfirmation(cam, confirmation);

                foreach (FloatingText item in _floating)
                {
                    Vector3 screen = cam.WorldToScreenPoint(item.World);
                    if (screen.z <= 0f) continue;

                    Color previous = GUI.color;
                    GUI.color = item.Color;
                    GUI.Label(new Rect(screen.x - 40f, Screen.height - screen.y - 20f, 80f, 20f), item.Text);
                    GUI.color = previous;
                }
            }

            DrawTargetHint();

            if (CanvasDriven) return;

            if (_log.Count == 0) return;

            var area = RoaHudLayout.Resolve("combatLog", new Rect(Screen.width - 332f, Screen.height - 132f, 320f, 120f));
            GUILayout.BeginArea(area, GUI.skin.box);

            foreach (string line in _log) GUILayout.Label(line);

            GUILayout.EndArea();
            RoaHudLayout.HandleDrag("combatLog", ref area, "Боевой журнал");
        }
    }
}
