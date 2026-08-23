using System;
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
    /// Сервер сам проверяет доступность боя в локации, дистанцию, очки действия,
    /// магазин и темп стрельбы, поэтому клиент не дублирует эти проверки:
    /// он показывает отказ, если он пришёл.
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

        private float _nextRequestAt;
        private int _shotSeq;
        private string _fireMode = "single";
        private string _modeWeapon = string.Empty;
        private JObject _hoverTarget;
        private Vector3 _hoverPosition;
        private float _nextHoverAt;
        private GUIStyle _targetHintStyle;

        /// <summary>Последние строки боевого журнала. Показываются в углу.</summary>
        private readonly List<string> _log = new List<string>();
        private const int LogLimit = 6;
        private string _lastLogRaw = string.Empty;
        private int _lastLogCount;
        public bool CanvasDriven { get; set; }
        public IReadOnlyList<string> LogLines { get { return _log; } }

        /// <summary>Всплывающий текст над целью: (текст, мир, до какого времени).</summary>
        private readonly List<FloatingText> _floating = new List<FloatingText>();
        private const float RemotePlayerHitRadius = 0.58f;

        private struct FloatingText
        {
            public string Text;
            public Vector3 World;
            public float Until;
            public Color Color;
        }

        private void OnEnable()
        {
            if (Socket == null) return;
            Socket.OnEnemyAttack += HandleEnemyAttack;
            Socket.OnEnemyAttackMiss += HandleEnemyAttackMiss;
            Socket.OnPlayerStatusEffect += HandlePlayerStatusEffect;
            Socket.OnEnemyKilled += HandleEnemyKilled;
        }

        private void OnDisable()
        {
            if (Socket == null) return;
            Socket.OnEnemyAttack -= HandleEnemyAttack;
            Socket.OnEnemyAttackMiss -= HandleEnemyAttackMiss;
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
            Player.View?.PlayHit();
            Float("-" + damage, Player.transform.position, new Color(1f, 0.36f, 0.29f));
            AddLog(name + " атакует (" + type + "): -" + damage + " HP"
                + (absorbed > 0 ? ", броня " + absorbed : string.Empty));
            if (payload["secondChance"]?.ToObject<bool>() == true)
                AddLog("Второй шанс: смертельный удар оставил 1 HP.");
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
            Float("-" + damage, Player.transform.position, new Color(0.62f, 0.81f, 0.45f));
            AddLog("Инфекция: -" + damage + " HP. Нужны антибиотики.");
        }

        private void HandleEnemyKilled(JObject payload)
        {
            if (payload == null || payload["killerId"]?.ToString() != Socket?.Session?.Id) return;
            int xp = Mathf.Max(0, payload["xp"]?.ToObject<int>() ?? 0);
            if (xp <= 0) return;
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
            UpdateHoverTarget(inputAllowed && !MobileInputMode);

            for (int i = _floating.Count - 1; i >= 0; i--)
                if (Time.time > _floating[i].Until) _floating.RemoveAt(i);
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
            if (Time.unscaledTime < _nextHoverAt) return;
            _nextHoverAt = Time.unscaledTime + 0.10f;
            // Наведение — только когда курсор над самой моделью (hit-test web), а не
            // в радиусе вокруг ног: иначе подсказка появляется раньше наведения.
            Camera hoverCamera = Camera.main;
            if (hoverCamera == null)
            {
                _hoverTarget = null;
                return;
            }
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
                _hoverPosition = remotePosition;
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
                return;
            }

            JObject snapshot;
            if (hasEnemy && Enemies.TryGetSnapshot(enemyId, out snapshot))
            {
                _hoverPosition = enemyPosition;
                _hoverTarget = snapshot;
            }
            else _hoverTarget = null;
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

        private void AttackAt(Vector3 cursor)
        {

            _nextRequestAt = Time.time + MinRequestInterval;

            Vector3 self = Player.transform.position;
            Vector3 targetPosition = cursor;
            RoaCoords.ToServer(self, out float selfX, out float selfZ);
            RoaCoords.ToServer(targetPosition, out float targetX, out float targetZ);

            float angle = RoaCoords.YawDegToAngle(Player.transform.eulerAngles.y);

            // Замах проигрывается сразу, не дожидаясь ответа сервера: иначе
            // удар отставал бы от нажатия на величину задержки. Если сервер
            // откажет, промах покажет журнал, но замах уже был честным вводом.
            if (Player.View != null) Player.View.PlayAttack();

            string attackToken = Guid.NewGuid().ToString("N");
            SendAttackVisual(self, targetPosition, selfX, selfZ, targetX, targetZ, angle);

            string weapon = ActiveWeapon();
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

            Vector3 dir = target - self;
            dir.y = 0f;
            if (dir.sqrMagnitude > 0.0001f) dir.Normalize();

            RoaCoords.ToServer(dir, out float dirX, out float dirZ);

            Socket.Emit("shoot", new Dictionary<string, object>
            {
                ["shotSeq"] = ++_shotSeq,
                ["clientFiredAt"] = Mathf.RoundToInt(Time.realtimeSinceStartup * 1000f),
                ["originX"] = selfX,
                ["originZ"] = selfZ,
                ["dirX"] = dirX,
                ["dirZ"] = dirZ,
                ["endX"] = targetX,
                ["endZ"] = targetZ,
                ["angle"] = angle,
                ["mode"] = _fireMode,
                ["handSlot"] = ActiveHandSlot(),
                ["deviceType"] = MobileInputMode ? "mobile" : "desktop",
                ["controlType"] = MobileInputMode ? "touch" : "keyboard_mouse"
            });

            if (Fx != null)
            {
                Vector3 start = new Vector3(self.x, Mathf.Max(1.05f, self.y + 0.23f), self.z);
                Vector3 end = new Vector3(target.x, Mathf.Max(1.02f, target.y + 0.23f), target.z);
                Fx.PlayShot(start, end, weapon);
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
            }, ack => HandleHitResult(ack, targetPosition));
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
            }, ack => HandlePlayerHitResult(ack, target, targetPosition));
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
            }, ack => HandleExplosionResult(ack, impactPosition));
        }

        private void HandleHitResult(JObject ack, Vector3 targetPosition)
        {
            if (ack == null) return;
            Socket.ApplyGameplayAck(ack);
            ApplyResolvedMode(ack);
            if (ack["enemy"] is JObject enemyState) Enemies.ApplyPublicEnemy(enemyState);

            if (ack["ok"]?.ToObject<bool>() != true)
            {
                // Отказы сервера уже на русском и пригодны для показа игроку:
                // мало ОД, пустой магазин, мирная локация, цель недоступна.
                string error = ack["error"]?.ToString();
                if (!string.IsNullOrEmpty(error)) AddLog(error);
                return;
            }

            bool hit = ack["hit"]?.ToObject<bool>() ?? true;

            if (!hit)
            {
                float chance = ack["chance"]?.ToObject<float>() ?? 0f;
                Float("мимо", targetPosition, new Color(0.72f, 0.72f, 0.72f));
                AddLog("Промах, шанс был " + Mathf.RoundToInt(chance) + "%");
                return;
            }

            int damage = Mathf.RoundToInt(ack["damage"]?.ToObject<float>() ?? 0f);
            bool critical = ack["critical"]?.ToObject<bool>() ?? false;

            Float((critical ? "КРИТ " : "") + damage, targetPosition,
                critical ? new Color(1f, 0.85f, 0.25f) : new Color(1f, 0.45f, 0.4f));

            JObject enemy = ack["enemy"] as JObject;
            string name = enemy?["name"]?.ToString() ?? "цель";
            bool dead = enemy?["dead"]?.ToObject<bool>() ?? false;

            AddLog(name + ": " + damage + (critical ? " (крит)" : "") + (dead ? " — убит" : ""));
        }

        private void HandlePlayerHitResult(JObject ack, PublicPlayer target, Vector3 targetPosition)
        {
            if (ack == null) return;
            Socket.ApplyGameplayAck(ack);
            ApplyResolvedMode(ack);

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
                Float("мимо", targetPosition, new Color(0.72f, 0.72f, 0.72f));
                AddLog("Промах по " + (target?.Name ?? "игроку") + ", шанс "
                    + Mathf.RoundToInt(ack["chance"]?.ToObject<float>() ?? 0f) + "%");
                return;
            }

            int damage = Mathf.RoundToInt(ack["damage"]?.ToObject<float>() ?? 0f);
            bool critical = ack["critical"]?.ToObject<bool>() ?? false;
            bool killed = ack["killed"]?.ToObject<bool>() ?? false;
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

            if (ack["enemies"] is JArray enemies)
                foreach (JToken token in enemies)
                    if (token is JObject enemy) Enemies.ApplyPublicEnemy(enemy);

            int affected = 0;
            if (ack["enemyHits"] is JArray enemyHits)
            {
                foreach (JToken hit in enemyHits)
                {
                    affected++;
                    string id = hit["enemyId"]?.ToString();
                    Vector3 position = impactPosition;
                    if (!string.IsNullOrEmpty(id)) Enemies.TryGetPosition(id, out position);
                    int damage = Mathf.RoundToInt(hit["damage"]?.ToObject<float>() ?? 0f);
                    bool critical = hit["critical"]?.ToObject<bool>() ?? false;
                    Float((critical ? "КРИТ " : "") + damage, position,
                        critical ? new Color(1f, 0.85f, 0.25f) : new Color(1f, 0.55f, 0.3f));
                }
            }
            if (ack["playerHits"] is JArray playerHits) affected += playerHits.Count;

            if (Fx != null)
                Fx.PlayExplosion(impactPosition, ack["radius"]?.ToObject<float>() ?? 3.6f);
            Float("ВЗРЫВ", impactPosition, new Color(1f, 0.65f, 0.22f));
            AddLog(affected > 0 ? "Взрыв задел целей: " + affected : "Взрыв никого не задел.");
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
            JObject combat = Socket.Session.Combat;
            string weapon = combat?["weapon"]?.ToString();
            if (string.IsNullOrEmpty(weapon))
            {
                AddLog("Нет активного оружия для перезарядки.");
                return;
            }

            var payload = new Dictionary<string, object> { ["weapon"] = weapon };
            JObject equipment = Socket.Session.Self?["equipment"] as JObject;
            if (equipment != null) payload["equipment"] = equipment;

            Socket.EmitWithAck("reloadWeapon", payload, ack =>
            {
                if (ack == null)
                {
                    AddLog("Сервер не ответил на перезарядку.");
                    return;
                }

                Socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    AddLog(ack["error"]?.ToString() ?? "Перезарядка отклонена.");
                    return;
                }

                int take = ack["take"]?.ToObject<int>() ?? 0;
                float apCost = ack["apCost"]?.ToObject<float>() ?? 0f;
                Player.View?.StartReload(0f);
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
            _floating.Add(new FloatingText
            {
                Text = text,
                World = world + Vector3.up * 1.6f,
                Until = Time.time + 1.1f,
                Color = color
            });
        }

        /// <summary>Подсказку цели рисует канва (RoaActorNameplates); IMGUI-вариант молчит.</summary>
        public bool TargetHintCanvasDriven { get; set; }

        /// <summary>
        /// Компактная подсказка наведения: имя цели и шанс попадания (как просил
        /// игрок — только эти два значения; расчёт тот же RoaCombatPreview).
        /// </summary>
        public bool TryGetTargetHint(out string name, out int chance)
        {
            name = string.Empty;
            chance = 0;
            if (_hoverTarget == null || Player == null || Socket?.Session?.Self == null) return false;
            if (_hoverTarget["dead"]?.ToObject<bool>() == true) return false;
            RoaCombatPreview.Result preview = RoaCombatPreview.Calculate(
                Socket.Session.Self, Socket.Session.Combat, _hoverTarget, Player, _hoverPosition, _fireMode);
            bool lineBlocked = preview.InRange && AttackLineBlocked(_hoverPosition,
                _hoverTarget["scale"]?.ToObject<float>() ?? 1f);
            bool remote = _hoverTarget["isRemotePlayer"]?.ToObject<bool>() == true;
            name = _hoverTarget["name"]?.ToString() ?? (remote ? "Игрок" : "Цель");
            chance = lineBlocked ? 0 : preview.Chance;
            return true;
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

            if (cam != null)
            {
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
