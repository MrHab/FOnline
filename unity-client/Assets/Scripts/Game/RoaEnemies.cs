using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Враги, NPC и существа комнаты.
    ///
    /// Сервер шлёт два потока: надёжный <c>enemySnapshot</c> задаёт состав
    /// сущностей, а volatile <c>enemyFrame</c> двигает уже известных.
    /// Кадр НЕ создаёт и не удаляет никого — появление и смерть приходят только
    /// снимком (docs/wiki/SOCKET_EVENTS.md).
    /// </summary>
    [DefaultExecutionOrder(-80)]
    public sealed class RoaEnemies : MonoBehaviour
    {
        [Tooltip("Origin сервера — отсюда грузятся модели существ.")]
        public string BaseUrl = "http://127.0.0.1:3000";

        [Tooltip("Время сглаживания к серверной позиции, сек.")]
        public float SmoothTime = 0.12f;

        [Tooltip("Сколько секунд продолжать движение по последней скорости без новых пакетов.")]
        // Server AI publishes at 5 Hz. A 0.4 s horizon could carry a melee NPC
        // almost a metre beyond its final engagement slot before the stop frame.
        public float MaxExtrapolationSeconds = 0.22f;

        [Tooltip("Коррекция больше этой дистанции считается телепортом или спавном.")]
        public float SnapDistance = 4f;

        public RoaSocketClient Socket;

        [Tooltip("Туман войны. Пока не назначен, существа видны всегда.")]
        public RoaFogOfWar Fog;

        private RoaMovementFx _movementFx;
        private Camera _worldCamera;
        private RoaPlayerController _localPlayer;

        public const float LocalPlayerBodyRadius = 0.35f;
        public const float ActorContactMargin = 0.08f;

        /// <summary>Порог перехода на бег для существ, м/с.</summary>
        private const float RunSpeedThreshold = 2.4f;
        private const float MeleeFollowThroughSeconds = 0.22f;
        private const float RangedRecoverySeconds = 0.10f;

        /// <summary>
        /// Кеш хранит ЗАДАЧУ загрузки, а не результат: в комнате несколько
        /// существ одной модели создаются в одном кадре, и кеш по результату
        /// давал бы промах у всех сразу — файл качался бы столько раз,
        /// сколько существ.
        /// </summary>
        private static readonly Dictionary<string, Task<GltfImport>> ModelCache =
            new Dictionary<string, Task<GltfImport>>();

        private sealed class Enemy
        {
            public GameObject Root;
            public RoaVisibilityGate Gate;
            public Animation Animation;
            public RoaCharacterView CharacterView;
            public bool UnifiedHumanoid;
            public string Clip = string.Empty;
            public float YawOffset;

            public Vector3 TargetPosition;
            public Vector3 Velocity;
            public Vector3 PresentationVelocity;
            public Vector3 SmoothVelocity;
            public float TargetYawDeg;

            public bool Moving;
            public bool PresentationMoving;
            public bool Dead;
            public float LastPacketTime;
            public float ActionUntil;
            public float ReactionUntil;
            public int ActivityRevision;
            public int Hp;
            public JObject Snapshot;
            public RoaMovementFx.ActorStepState StepFx;
            public RoaEnemyThreatTelegraph ThreatView;
            public Vector3 LookPoint;
            public float ThreatRemaining;
            public float ThreatWindow;
            public float AttackWindupUntil;
            public bool ThreatActive;
            public bool ThreatRanged;
            public bool ThreatTargetsLocalPlayer;
            public CapsuleCollider BodyCollider;
            public Rigidbody BodyRigidbody;
            public float BodyRadius;
            public float ContactFallbackAngleDeg;
            public float ActivityPhase01;
        }

        private readonly Dictionary<string, Enemy> _enemies = new Dictionary<string, Enemy>();

        private sealed class MeleePresentationHold
        {
            public float ReleaseAt;
            public JObject PendingSnapshot;
            public JObject PendingKilled;
            public bool SawDeadFrame;
        }

        private readonly Dictionary<string, MeleePresentationHold> _meleePresentationHolds =
            new Dictionary<string, MeleePresentationHold>();
        private readonly List<string> _dueMeleePresentationHolds = new List<string>();

        public void ConfigureMovementFx(RoaMovementFx movementFx, Camera worldCamera)
        {
            _movementFx = movementFx;
            _worldCamera = worldCamera;
        }

        public void SetLocalPlayer(RoaPlayerController player)
        {
            _localPlayer = player;
        }

        public struct BodyProfile
        {
            public float Radius;
            public float Height;
            public float CenterY;

            public BodyProfile(float radius, float height, float centerY)
            {
                Radius = radius;
                Height = height;
                CenterY = centerY;
            }
        }

        /// <summary>
        /// Lightweight collision silhouette used only by Unity presentation.
        /// Exact movement authority stays on the server; this body lets the local
        /// CharacterController classify point-blank contact as another actor.
        /// </summary>
        public static BodyProfile PresentationBodyProfile(string modelKey, bool unifiedHumanoid)
        {
            if (unifiedHumanoid) return new BodyProfile(0.38f, 1.82f, 0.91f);
            switch (modelKey ?? string.Empty)
            {
                case "enemySuperMutant": return new BodyProfile(0.52f, 2.38f, 1.19f);
                case "enemyRadscorpion": return new BodyProfile(0.58f, 0.72f, 0.36f);
                case "enemyMutantAnt": return new BodyProfile(0.38f, 0.48f, 0.24f);
                case "enemyAshWolf": return new BodyProfile(0.44f, 0.92f, 0.46f);
                case "enemyGecko":
                case "enemyFireGecko": return new BodyProfile(0.43f, 1.10f, 0.55f);
                case "brahmin":
                case "friendlyBrahmin": return new BodyProfile(0.62f, 1.55f, 0.78f);
                default: return new BodyProfile(0.40f, 1.78f, 0.89f);
            }
        }

        public static CapsuleCollider InstallPresentationBody(GameObject root, BodyProfile profile,
                                                               out Rigidbody rigidbody)
        {
            rigidbody = null;
            if (root == null) return null;
            CapsuleCollider capsule = root.GetComponent<CapsuleCollider>();
            if (capsule == null) capsule = root.AddComponent<CapsuleCollider>();
            capsule.direction = 1;
            capsule.radius = Mathf.Max(0.12f, profile.Radius);
            capsule.height = Mathf.Max(capsule.radius * 2f, profile.Height);
            capsule.center = new Vector3(0f, profile.CenterY, 0f);
            capsule.isTrigger = false;

            rigidbody = root.GetComponent<Rigidbody>();
            if (rigidbody == null) rigidbody = root.AddComponent<Rigidbody>();
            rigidbody.isKinematic = true;
            rigidbody.useGravity = false;
            rigidbody.detectCollisions = true;
            rigidbody.interpolation = RigidbodyInterpolation.None;
            rigidbody.collisionDetectionMode = CollisionDetectionMode.ContinuousSpeculative;
            rigidbody.constraints = RigidbodyConstraints.FreezeRotation;
            return capsule;
        }

        public static void SetPresentationBodyAlive(CapsuleCollider capsule, Rigidbody rigidbody,
                                                    bool alive)
        {
            if (capsule != null) capsule.enabled = alive;
            if (rigidbody != null) rigidbody.detectCollisions = alive;
        }

        public static float StableContactAngle(string id)
        {
            uint hash = 2166136261u;
            unchecked
            {
                foreach (char c in id ?? string.Empty)
                {
                    hash ^= c;
                    hash *= 16777619u;
                }
            }
            return (hash / (float)uint.MaxValue) * 360f;
        }

        public static float StableActivityPhase01(string id)
        {
            return StableContactAngle("activity:" + (id ?? string.Empty)) / 360f;
        }

        public static Vector3 ResolvePresentationContact(Vector3 actorPosition,
                                                         Vector3 playerPosition,
                                                         float minimumDistance,
                                                         float fallbackAngleDeg)
        {
            float minimum = Mathf.Max(0f, minimumDistance);
            Vector2 delta = new Vector2(actorPosition.x - playerPosition.x,
                                        actorPosition.z - playerPosition.z);
            if (delta.sqrMagnitude >= minimum * minimum) return actorPosition;
            if (delta.sqrMagnitude < 0.000001f)
            {
                float angle = fallbackAngleDeg * Mathf.Deg2Rad;
                delta = new Vector2(Mathf.Sin(angle), Mathf.Cos(angle));
            }
            else delta.Normalize();
            actorPosition.x = playerPosition.x + delta.x * minimum;
            actorPosition.z = playerPosition.z + delta.y * minimum;
            return actorPosition;
        }

        public static bool CombatMotionLocked(bool dead, bool threatActive,
                                              float actionUntil, float now)
        {
            return CombatMotionLocked(dead, threatActive, actionUntil, 0f, now);
        }

        public static bool CombatMotionLocked(bool dead, bool threatActive,
                                              float actionUntil, float reactionUntil,
                                              float now)
        {
            return dead || threatActive || now < actionUntil || now < reactionUntil;
        }

        public static bool AttackPresentationBlocked(bool dead, float reactionUntil, float now)
        {
            return dead || now < reactionUntil;
        }

        public static float AttackRootLockSeconds(float remainingSeconds, bool ranged)
        {
            return Mathf.Max(0f, remainingSeconds)
                + (ranged ? RangedRecoverySeconds : MeleeFollowThroughSeconds);
        }

        public static bool AnimateAttackAtTelegraph(bool ranged)
        {
            return !ranged;
        }

        public static bool AnimateAttackAtImpact(bool ranged, bool windupAnimated)
        {
            return ranged || !windupAnimated;
        }

        public static int ResolveFrameHealth(int currentHp, int frameHp,
                                             bool dead, bool deferDamage)
        {
            if (dead) return 0;
            if (deferDamage && frameHp < currentHp) return Mathf.Max(0, currentHp);
            return Mathf.Max(0, frameHp);
        }

        public static bool IsCombatAiState(string aiState)
        {
            switch ((aiState ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "attack":
                case "chase":
                case "pressure":
                case "tactical":
                case "combat":
                case "factioncombat":
                case "reload":
                case "retreat":
                case "stagger":
                    return true;
                default:
                    return false;
            }
        }

        public static string NpcIntentLabel(string aiState, bool hostile,
                                            bool localThreat, bool threatRanged = false)
        {
            if (localThreat) return threatRanged ? "ЦЕЛИТСЯ В ВАС" : "АТАКУЕТ ВАС";
            switch ((aiState ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "pressure": return "ИЩЕТ МОМЕНТ";
                case "reload": return "ПЕРЕЗАРЯЖАЕТСЯ";
                case "retreat": return "ОТСТУПАЕТ";
                case "chase": return "СБЛИЖАЕТСЯ";
                case "investigate": return "ИЩЕТ";
                case "stagger": return "ОГЛУШЁН";
                case "alarm": return "ТРЕВОГА";
                case "attack": return "АТАКУЕТ";
                case "combat":
                case "factioncombat":
                case "tactical": return "В БОЮ";
                default: return hostile ? "ВРАГ" : "МИРНЫЙ";
            }
        }

        public static string NpcCombatFactionLine(string factionId, bool hostile,
                                                  string aiState, bool localThreat,
                                                  bool threatRanged = false,
                                                  string activityType = "",
                                                  string activityPhase = "")
        {
            string label = RoaPipboy.FactionLabel(factionId);
            string intent = NpcIntentLabel(aiState, hostile, localThreat, threatRanged);
            if (!hostile && !localThreat && intent == "МИРНЫЙ")
            {
                string activity = NpcActivityLabel(activityType, activityPhase);
                if (!string.IsNullOrEmpty(activity)) intent = activity;
            }
            return intent
                + " · " + label;
        }

        public static string NpcActivityLabel(string activityType, string activityPhase)
        {
            string phase = (activityPhase ?? string.Empty).Trim().ToLowerInvariant();
            if (phase == "travel") return "ИДЁТ К МЕСТУ";
            switch ((activityType ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "work":
                case "craft": return "РАБОТАЕТ";
                case "shop":
                case "merchant":
                case "trade": return "ТОРГУЕТ";
                case "guard": return "НА ПОСТУ";
                case "patrol": return "ПАТРУЛИРУЕТ";
                case "social":
                case "socialize": return "ОБЩАЕТСЯ";
                case "eat": return "ЕСТ";
                case "rest":
                case "sleep": return "ОТДЫХАЕТ";
                case "dialogue": return "РАЗГОВАРИВАЕТ";
                default: return string.Empty;
            }
        }

        public static string ResolveNpcActivityVisual(string activityType,
                                                       string activityPhase,
                                                       string visualAction,
                                                       string aiState,
                                                       bool moving,
                                                       bool dead,
                                                       bool hostile = false)
        {
            string state = (aiState ?? string.Empty).Trim().ToLowerInvariant();
            string phase = (activityPhase ?? string.Empty).Trim().ToLowerInvariant();
            if (dead || moving || hostile || phase == "travel" || IsCombatAiState(state)
                || state == "alarm" || state == "investigate") return string.Empty;

            string action = (visualAction ?? string.Empty).Trim().ToLowerInvariant();
            string type = (activityType ?? string.Empty).Trim().ToLowerInvariant();
            string source = !string.IsNullOrEmpty(action) && action != "idle" ? action : type;
            switch (source)
            {
                case "work":
                case "craft": return "work";
                case "shop":
                case "merchant":
                case "trade": return "shop";
                case "guard":
                case "patrol": return "guard";
                case "social":
                case "socialize":
                case "dialogue": return "social";
                case "eat": return "eat";
                case "rest":
                case "sleep": return "rest";
                default: return string.Empty;
            }
        }

        /// <summary>Сколько сущностей в комнате сейчас. Для диагностики.</summary>
        public int Count { get { return _enemies.Count; } }
        public int MeleePresentationHoldCount { get { return _meleePresentationHolds.Count; } }

        /// <summary>
        /// Удержать только раннее уменьшение HP/смерть выбранной PvE-цели до
        /// контактной позы уже начатого локального замаха. Движение и прочие
        /// снимки продолжают применяться как обычно.
        /// </summary>
        public void BeginMeleePresentationHold(string enemyId, float seconds)
        {
            if (string.IsNullOrEmpty(enemyId)) return;
            _meleePresentationHolds[enemyId] = new MeleePresentationHold
            {
                ReleaseAt = Time.unscaledTime + Mathf.Clamp(seconds, 0.05f, 0.35f)
            };
        }

        /// <summary>
        /// ACK дошёл до контактной фазы и содержит полное состояние цели —
        /// ранние копии больше не нужны, следующий ApplyPublicEnemyHit применит
        /// точную направленную реакцию или смерть.
        /// </summary>
        public void CompleteMeleePresentationHold(string enemyId)
        {
            if (!string.IsNullOrEmpty(enemyId)) _meleePresentationHolds.Remove(enemyId);
        }

        public static bool ShouldDeferMeleeState(float now, float releaseAt,
                                                 int currentHp, int nextHp, bool dead)
        {
            return now < releaseAt && (dead || (currentHp > 0 && nextHp < currentHp));
        }

        /// <summary>
        /// Volatile enemy frames may arrive after the reliable kill event. They can
        /// confirm death, but must never revive an already dead presentation merely
        /// because an older frame did not carry the Dead bit.
        /// </summary>
        public static bool ResolveFrameDeadState(bool currentlyDead, bool frameReportsDead,
                                                 bool deferFrameDeath)
        {
            return currentlyDead || (frameReportsDead && !deferFrameDeath);
        }

        public static bool ResolveSnapshotDeadState(bool currentlyDead, bool snapshotReportsDead)
        {
            return currentlyDead || snapshotReportsDead;
        }

        /// <summary>
        /// Server snapshots may contain an explicit JSON null for optional flags.
        /// Newtonsoft treats that token differently from a missing C# value and
        /// throws when it is converted directly to bool, so all NPC flags pass
        /// through this boundary before entering the per-frame presentation code.
        /// </summary>
        public static bool ReadBoolean(JToken token, bool fallback = false)
        {
            if (token == null || token.Type == JTokenType.Null || token.Type == JTokenType.Undefined)
                return fallback;
            if (token.Type == JTokenType.Boolean) return token.Value<bool>();
            if (token.Type == JTokenType.Integer) return token.Value<long>() != 0L;
            return bool.TryParse(token.ToString(), out bool value) ? value : fallback;
        }

        private bool MeleePresentationHeld(string enemyId)
        {
            return !string.IsNullOrEmpty(enemyId)
                && _meleePresentationHolds.TryGetValue(enemyId, out MeleePresentationHold hold)
                && Time.unscaledTime < hold.ReleaseAt;
        }

        private bool TryDeferMeleeSnapshot(string enemyId, JObject row,
                                           out JObject presentationRow)
        {
            presentationRow = row;
            if (row == null
                || !_meleePresentationHolds.TryGetValue(enemyId, out MeleePresentationHold hold)
                || !_enemies.TryGetValue(enemyId, out Enemy enemy)) return false;
            if (Time.unscaledTime >= hold.ReleaseAt)
            {
                _meleePresentationHolds.Remove(enemyId);
                return false;
            }

            int nextHp = row["hp"]?.ToObject<int>() ?? enemy.Hp;
            bool dead = ReadBoolean(row["dead"]);
            if (!ShouldDeferMeleeState(Time.unscaledTime, hold.ReleaseAt,
                                       enemy.Hp, nextHp, dead)) return false;

            hold.PendingSnapshot = (JObject)row.DeepClone();
            presentationRow = (JObject)row.DeepClone();
            presentationRow["hp"] = enemy.Hp;
            presentationRow["dead"] = enemy.Dead;
            return true;
        }

        private void ReleaseDueMeleePresentationHolds()
        {
            if (_meleePresentationHolds.Count == 0) return;
            _dueMeleePresentationHolds.Clear();
            float now = Time.unscaledTime;
            foreach (KeyValuePair<string, MeleePresentationHold> entry in _meleePresentationHolds)
                if (now >= entry.Value.ReleaseAt) _dueMeleePresentationHolds.Add(entry.Key);
            foreach (string enemyId in _dueMeleePresentationHolds)
                ReleaseMeleePresentationHold(enemyId);
            _dueMeleePresentationHolds.Clear();
        }

        private void ReleaseMeleePresentationHold(string enemyId)
        {
            if (!_meleePresentationHolds.TryGetValue(enemyId, out MeleePresentationHold hold)) return;
            _meleePresentationHolds.Remove(enemyId);

            bool snapshotKilled = ReadBoolean(hold.PendingSnapshot?["dead"]);
            if (hold.PendingSnapshot != null)
                ApplySnapshotRow(enemyId, hold.PendingSnapshot);
            if (hold.PendingKilled != null)
                ApplyEnemyKilledNow(hold.PendingKilled);
            else if (hold.SawDeadFrame && !snapshotKilled)
                ApplyEnemyKilledNow(new JObject { ["enemyId"] = enemyId });
        }

        public struct ConeTarget
        {
            public string Id;
            public Vector3 Position;
            public float Distance;
            public float Perp;
            public float Width;
        }

        public struct MobileTarget
        {
            public string Id;
            public Vector3 Position;
            public float Distance;
        }

        /// <summary>
        /// Ближайшая живая цель к точке на земле. Используется для выбора цели
        /// по курсору: в игре с видом сверху попадать курсором точно в модель
        /// неудобно, поэтому берётся ближайшая в радиусе.
        /// </summary>
        public bool TryFindTarget(Vector3 worldPoint, float maxDistance, out string id, out Vector3 position)
        {
            return TryFindTarget(worldPoint, maxDistance, out id, out position, out _);
        }

        public bool TryFindTarget(Vector3 worldPoint, float maxDistance,
                                  out string id, out Vector3 position, out float cursorDistance)
        {
            id = null;
            position = Vector3.zero;
            cursorDistance = float.PositiveInfinity;

            float best = maxDistance * maxDistance;
            bool found = false;

            foreach (KeyValuePair<string, Enemy> entry in _enemies)
            {
                Enemy enemy = entry.Value;
                if (enemy.Dead || enemy.Root == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;

                Vector3 delta = enemy.Root.transform.position - worldPoint;
                delta.y = 0f;

                float distance = delta.sqrMagnitude;
                if (distance > best) continue;

                best = distance;
                id = entry.Key;
                position = enemy.Root.transform.position;
                cursorDistance = Mathf.Sqrt(distance);
                found = true;
            }

            return found;
        }

        /// <summary>
        /// Ближайшая видимая сущность вдоль линии выстрела. Радиус повторяет
        /// <c>enemyCombatHitRadius</c> web-клиента для авторского масштаба NPC.
        /// </summary>
        public bool TryFindTargetAlongRay(Vector3 origin, Vector3 direction, float maxDistance,
                                          out string id, out Vector3 position,
                                          out float projection, out float perpendicular)
        {
            id = null;
            position = Vector3.zero;
            projection = float.PositiveInfinity;
            perpendicular = float.PositiveInfinity;
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) return false;
            direction.Normalize();

            float bestProjection = maxDistance + 1f;
            foreach (KeyValuePair<string, Enemy> entry in _enemies)
            {
                Enemy enemy = entry.Value;
                if (enemy.Dead || enemy.Root == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;

                Vector3 delta = enemy.Root.transform.position - origin;
                delta.y = 0f;
                float along = Vector3.Dot(delta, direction);
                if (along < 0.45f || along > maxDistance || along >= bestProjection) continue;
                float side = (delta - direction * along).magnitude;
                float authoredScale = Value(enemy.Snapshot, "scale");
                if (authoredScale <= 0.01f) authoredScale = 1f;
                float hitRadius = Mathf.Max(0.5f, 0.78f * authoredScale + 0.28f);
                if (side > hitRadius) continue;

                bestProjection = along;
                id = entry.Key;
                position = enemy.Root.transform.position;
                projection = along;
                perpendicular = side;
            }

            return id != null;
        }


        /// <summary>
        /// Пересечение луча курсора с объединёнными границами рендереров модели —
        /// буквальный hit-test web (курсор должен быть над моделью, а не рядом).
        /// </summary>
        public static bool RayHitsModel(GameObject root, Ray ray, out float distance)
        {
            distance = float.PositiveInfinity;
            if (root == null) return false;
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>();
            bool any = false;
            Bounds bounds = default;
            foreach (Renderer renderer in renderers)
            {
                if (renderer == null || !renderer.enabled) continue;
                if (!any) { bounds = renderer.bounds; any = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            if (!any) return false;

            // AABB тела с курткой и оружием шире самой фигуры (≈1.4 м), поэтому
            // проверяем капсулу: ось от ног до макушки, радиус 0.42 м.
            Vector3 foot = root.transform.position;
            Vector3 head = new Vector3(foot.x, bounds.max.y, foot.z);
            const float radius = 0.42f;
            Vector3 u = ray.direction.normalized;
            Vector3 v = head - foot;
            Vector3 w0 = ray.origin - foot;
            float a = Vector3.Dot(u, u), b = Vector3.Dot(u, v), c = Vector3.Dot(v, v);
            float d = Vector3.Dot(u, w0), e = Vector3.Dot(v, w0);
            float denom = a * c - b * b;
            float t = denom > 1e-6f ? (b * e - c * d) / denom : 0f;            // вдоль луча
            float s = denom > 1e-6f ? (a * e - b * d) / denom : 0f;            // вдоль оси [0..1]
            s = Mathf.Clamp01(s);
            t = Mathf.Max(0f, Vector3.Dot(foot + v * s - ray.origin, u));
            Vector3 closestRay = ray.origin + u * t;
            Vector3 closestAxis = foot + v * s;
            if ((closestRay - closestAxis).magnitude > radius) return false;
            distance = t;
            return true;
        }

        /// <summary>Сущность под курсором: луч экрана пересекает модель (ближайшая по лучу).</summary>
        public bool TryFindTargetUnderCursor(Ray ray, out string id, out Vector3 position, out float rayDistance)
        {
            id = null;
            position = Vector3.zero;
            rayDistance = float.PositiveInfinity;
            foreach (KeyValuePair<string, Enemy> entry in _enemies)
            {
                Enemy enemy = entry.Value;
                if (enemy.Dead || enemy.Root == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;
                float distance;
                if (!RayHitsModel(enemy.Root, ray, out distance) || distance >= rayDistance) continue;
                rayDistance = distance;
                id = entry.Key;
                position = enemy.Root.transform.position;
            }
            return id != null;
        }

        /// <summary>Позиция сущности по id, если она ещё в комнате.</summary>
        public bool TryGetPosition(string id, out Vector3 position)
        {
            position = Vector3.zero;

            Enemy enemy;
            if (string.IsNullOrEmpty(id) || !_enemies.TryGetValue(id, out enemy)) return false;
            if (enemy.Root == null) return false;

            position = enemy.Root.transform.position;
            return true;
        }

        /// <summary>Read-only public state used by the target forecast UI.</summary>
        public bool TryGetSnapshot(string id, out JObject snapshot)
        {
            snapshot = null;
            Enemy enemy;
            if (string.IsNullOrEmpty(id) || !_enemies.TryGetValue(id, out enemy)) return false;
            if (enemy == null || enemy.Dead || enemy.Snapshot == null) return false;
            if (enemy.Gate != null && !enemy.Gate.IsVisible) return false;
            snapshot = enemy.Snapshot;
            return true;
        }

        /// <summary>Копии видимых живых серверных снимков для мобильных меню и внешнего выбора действия.</summary>
        public void CollectPublicSnapshots(List<JObject> snapshots)
        {
            if (snapshots == null) return;
            snapshots.Clear();
            foreach (Enemy enemy in _enemies.Values)
            {
                if (enemy == null || enemy.Dead || enemy.Snapshot == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;
                snapshots.Add((JObject)enemy.Snapshot.DeepClone());
            }
        }

        /// <summary>Visible hostile NPCs ordered exactly as the mobile auto-target list.</summary>
        public void CollectMobileTargets(Vector3 origin, float maxDistance, List<MobileTarget> targets)
        {
            if (targets == null) return;
            targets.Clear();
            float maxSq = maxDistance * maxDistance;
            foreach (KeyValuePair<string, Enemy> entry in _enemies)
            {
                Enemy enemy = entry.Value;
                if (enemy == null || enemy.Dead || enemy.Root == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;
                if (!ReadBoolean(enemy.Snapshot?["hostileToPlayer"], true)) continue;
                Vector3 delta = enemy.Root.transform.position - origin;
                delta.y = 0f;
                float sq = delta.sqrMagnitude;
                if (sq > maxSq) continue;
                targets.Add(new MobileTarget
                {
                    Id = entry.Key,
                    Position = enemy.Root.transform.position,
                    Distance = Mathf.Sqrt(sq)
                });
            }
            targets.Sort((a, b) => a.Distance.CompareTo(b.Distance));
        }

        /// <summary>
        /// Кандидаты для конуса дробовика/огнемёта. Финальную дальность, линию огня,
        /// радиус модели и повтор токена проверяет serverValidateMultiTargetHit.
        /// </summary>
        public List<ConeTarget> FindTargetsInCone(Vector3 origin, Vector3 direction, string weaponId)
        {
            var result = new List<ConeTarget>();
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) return result;
            direction.Normalize();

            float range = weaponId == "flamethrower" ? 8f : 11f;
            foreach (KeyValuePair<string, Enemy> entry in _enemies)
            {
                Enemy enemy = entry.Value;
                if (enemy.Dead || enemy.Root == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;

                Vector3 offset = enemy.Root.transform.position - origin;
                offset.y = 0f;
                float projection = Vector3.Dot(offset, direction);
                if (projection < 0.35f || projection > range) continue;
                float perp = (offset - direction * projection).magnitude;
                float width = weaponId == "flamethrower"
                    ? 0.42f + projection * 0.24f
                    : 0.28f + projection * 0.24f + projection * projection * 0.006f;
                const float targetRadius = 0.9f;
                if (perp > width + targetRadius) continue;

                result.Add(new ConeTarget
                {
                    Id = entry.Key,
                    Position = enemy.Root.transform.position,
                    Distance = offset.magnitude,
                    Perp = perp,
                    Width = width
                });
            }

            result.Sort((a, b) => a.Distance.CompareTo(b.Distance));
            return result;
        }

        /// <summary>
        /// Ближайший объект, с которым можно взаимодействовать: труп либо живой
        /// не враждебный NPC. Возвращается копия последнего полного серверного
        /// снимка — volatile enemyFrame намеренно не меняет социальные поля и лут.
        /// </summary>
        public bool TryFindInteractable(Vector3 origin, float maxDistance,
                                        out JObject snapshot, out Vector3 position)
        {
            snapshot = null;
            position = Vector3.zero;
            float best = maxDistance * maxDistance;

            foreach (Enemy enemy in _enemies.Values)
            {
                if (enemy.Root == null || enemy.Snapshot == null) continue;

                bool dead = ReadBoolean(enemy.Snapshot["dead"], enemy.Dead);
                bool hostile = ReadBoolean(enemy.Snapshot["hostileToPlayer"], true);
                bool canDialogue = ReadBoolean(enemy.Snapshot["canDialogue"]);
                bool hasTrade = !string.IsNullOrEmpty(enemy.Snapshot["traderProfile"]?.ToString())
                    || !string.IsNullOrEmpty(enemy.Snapshot["traderId"]?.ToString())
                    || ReadBoolean(enemy.Snapshot["personalTrade"]);

                if (!dead && (hostile || (!canDialogue && !hasTrade))) continue;

                Vector3 delta = enemy.Root.transform.position - origin;
                delta.y = 0f;
                float distance = delta.sqrMagnitude;
                if (distance > best) continue;

                best = distance;
                snapshot = (JObject)enemy.Snapshot.DeepClone();
                position = enemy.Root.transform.position;
            }

            return snapshot != null;
        }

        /// <summary>Применить точечное публичное состояние NPC из ack/сделки.</summary>
        public void ApplyPublicEnemy(JObject row)
        {
            if (row == null) return;
            string id = row["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            ApplySnapshotRow(id, row);
        }

        /// <summary>
        /// Apply the authoritative post-hit state while preserving the shot
        /// direction, damage and critical strength that a plain HP snapshot loses.
        /// </summary>
        public void ApplyPublicEnemyHit(JObject row, Vector3 sourceWorld,
                                        int damage, bool critical)
        {
            if (row == null) return;
            string id = row["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            ApplySnapshotRow(id, row, true, sourceWorld, damage, critical);
        }

        private void OnEnable()
        {
            if (Socket == null) return;
            Socket.OnEnemySnapshot += HandleSnapshot;
            Socket.OnEnemyFrame += HandleFrame;
            Socket.OnEnemyActivityDelta += HandleActivityDelta;
            Socket.OnJoined += HandleJoined;
            Socket.OnEnemyTradeUpdated += HandleTradeUpdated;
            Socket.OnEncounterFactionHostile += HandleEncounterFactionHostile;
            Socket.OnShot += HandleEnemyShot;
            Socket.OnEnemyMelee += HandleEnemyMelee;
            Socket.OnEnemyKilled += HandleEnemyKilled;
        }

        private void OnDisable()
        {
            if (Socket == null) return;
            Socket.OnEnemySnapshot -= HandleSnapshot;
            Socket.OnEnemyFrame -= HandleFrame;
            Socket.OnEnemyActivityDelta -= HandleActivityDelta;
            Socket.OnJoined -= HandleJoined;
            Socket.OnEnemyTradeUpdated -= HandleTradeUpdated;
            Socket.OnEncounterFactionHostile -= HandleEncounterFactionHostile;
            Socket.OnShot -= HandleEnemyShot;
            Socket.OnEnemyMelee -= HandleEnemyMelee;
            Socket.OnEnemyKilled -= HandleEnemyKilled;
        }

        private void HandleJoined(JoinAck ack)
        {
            // Смена комнаты: старые сущности принадлежат прошлой сцене.
            Clear();
        }

        private void HandleTradeUpdated(JObject payload)
        {
            ApplyPublicEnemy(payload?["enemy"] as JObject);
        }

        private void HandleEncounterFactionHostile(JObject payload)
        {
            JArray rows = payload?["enemies"] as JArray;
            if (rows == null) return;
            foreach (JToken token in rows)
                ApplyPublicEnemy(token as JObject);
        }

        private void HandleEnemyShot(JObject payload)
        {
            if (!ReadBoolean(payload?["enemyShooter"])) return;
            PlayEnemyAttack(payload["shooterId"]?.ToString(), payload, true);
        }

        private void HandleEnemyMelee(JObject payload)
        {
            PlayEnemyAttack(payload?["enemyId"]?.ToString(), payload, false);
        }

        private void PlayEnemyAttack(string id, JObject payload, bool ranged)
        {
            if (string.IsNullOrEmpty(id) || !_enemies.TryGetValue(id, out Enemy enemy)) return;
            if (AttackPresentationBlocked(enemy.Dead, enemy.ReactionUntil, Time.time)) return;
            if (enemy.Snapshot != null)
            {
                if (payload?["weapon"] != null) enemy.Snapshot["weapon"] = payload["weapon"].DeepClone();
                if (payload?["equipment"] != null) enemy.Snapshot["equipment"] = payload["equipment"].DeepClone();
                if (enemy.UnifiedHumanoid) _ = RefreshHumanoidEquipment(enemy);
            }
            bool windupAnimated = Time.time < enemy.AttackWindupUntil;
            enemy.ThreatActive = false;
            enemy.ThreatRemaining = 0f;
            enemy.ActionUntil = Mathf.Max(enemy.ActionUntil, Time.time + 0.45f);
            enemy.Moving = false;
            enemy.PresentationMoving = false;
            enemy.Velocity = Vector3.zero;
            enemy.PresentationVelocity = Vector3.zero;
            if (AnimateAttackAtImpact(ranged, windupAnimated))
            {
                enemy.Clip = string.Empty;
                if (enemy.CharacterView != null) enemy.CharacterView.PlayAttack();
                else PlayClip(enemy, "attack");
            }
        }

        private void HandleEnemyKilled(JObject payload)
        {
            string id = payload?["enemyId"]?.ToString();
            if (string.IsNullOrEmpty(id) || !_enemies.ContainsKey(id)) return;
            if (MeleePresentationHeld(id))
            {
                _meleePresentationHolds[id].PendingKilled = (JObject)payload.DeepClone();
                return;
            }

            _meleePresentationHolds.Remove(id);
            ApplyEnemyKilledNow(payload);
        }

        private void ApplyEnemyKilledNow(JObject payload)
        {
            string id = payload?["enemyId"]?.ToString();
            if (string.IsNullOrEmpty(id) || !_enemies.TryGetValue(id, out Enemy enemy)) return;
            bool newlyDead = !enemy.Dead;
            if (newlyDead && enemy.CharacterView != null
                && payload?["sourceX"] != null && payload["sourceZ"] != null)
            {
                enemy.CharacterView.PrepareDeath(RoaCoords.ToUnity(
                    Value(payload, "sourceX"), Value(payload, "sourceZ")));
            }
            enemy.Dead = true;
            enemy.Moving = false;
            enemy.PresentationMoving = false;
            enemy.Velocity = Vector3.zero;
            enemy.PresentationVelocity = Vector3.zero;
            enemy.ActionUntil = 0f;
            enemy.ReactionUntil = 0f;
            enemy.ThreatActive = false;
            enemy.ThreatRemaining = 0f;
            if (payload["x"] != null && payload["z"] != null)
            {
                enemy.TargetPosition = RoaCoords.ToUnity(Value(payload, "x"), Value(payload, "z"));
                if (enemy.Root != null) enemy.Root.transform.position = enemy.TargetPosition;
            }
            else if (enemy.Root != null)
            {
                enemy.TargetPosition = enemy.Root.transform.position;
            }
            enemy.SmoothVelocity = Vector3.zero;
            SetPresentationBodyAlive(enemy.BodyCollider, enemy.BodyRigidbody, false);
            if (enemy.Snapshot != null)
            {
                enemy.Snapshot["dead"] = true;
                enemy.Snapshot["hp"] = 0;
            }
            enemy.Clip = string.Empty;
            if (enemy.CharacterView != null) enemy.CharacterView.SetDead(true);
            else PlayClip(enemy, "death");
        }

        private void HandleActivityDelta(JObject payload)
        {
            JArray activities = payload?["activities"] as JArray;
            if (activities == null) return;
            foreach (JToken token in activities)
            {
                JObject row = token as JObject;
                string id = row?["id"]?.ToString();
                JArray activity = row?["a"] as JArray;
                if (string.IsNullOrEmpty(id) || activity == null || activity.Count < 7
                    || !_enemies.TryGetValue(id, out Enemy enemy)) continue;

                int revision = activity[0]?.ToObject<int>() ?? 0;
                if (revision <= enemy.ActivityRevision) continue;
                enemy.ActivityRevision = revision;
                if (enemy.Snapshot == null) enemy.Snapshot = new JObject { ["id"] = id };

                string type = activity[1]?.ToString() ?? string.Empty;
                enemy.Snapshot["activityRevision"] = revision;
                enemy.Snapshot["activityType"] = type;
                enemy.Snapshot["goalActivity"] = type;
                enemy.Snapshot["activityPhase"] = activity[2]?.ToString() ?? string.Empty;
                enemy.Snapshot["visualAction"] = activity[3]?.ToString() ?? string.Empty;
                enemy.Snapshot["activitySlotId"] = activity[4]?.ToString() ?? string.Empty;
                JToken facing = activity[5];
                enemy.Snapshot["activityFacing"] = facing == null || facing.Type == JTokenType.Null
                    ? JValue.CreateNull()
                    : facing.DeepClone();
                enemy.Snapshot["serviceAvailable"] = (activity[6]?.ToObject<int>() ?? 0) != 0;

                string label = ScheduleLabel(type);
                if (!string.IsNullOrEmpty(label)) enemy.Snapshot["scheduleLabel"] = label;
                if (facing != null && facing.Type != JTokenType.Null)
                    enemy.TargetYawDeg = RoaCoords.AngleToYawDeg(facing.ToObject<float>());
            }
        }

        private static string ScheduleLabel(string activity)
        {
            if (activity == "work") return "работает";
            if (activity == "eat") return "ест";
            if (activity == "shop") return "торгует";
            if (activity == "patrol") return "патрулирует";
            if (activity == "guard") return "на посту";
            if (activity == "rest") return "отдыхает";
            if (activity == "social") return "общается";
            if (activity == "combat") return "тревога";
            if (activity == "dialogue") return "разговор";
            return string.Empty;
        }

        /// <summary>
        /// Полный снимок: он и только он задаёт состав. Кого нет в снимке —
        /// того больше нет в комнате.
        /// </summary>
        private void HandleSnapshot(JObject payload)
        {
            JArray rows = payload["enemies"] as JArray;
            if (rows == null) return;

            var seen = new HashSet<string>();

            foreach (JToken row in rows)
            {
                JObject enemy = row as JObject;
                if (enemy == null) continue;

                string id = enemy["id"]?.ToString();
                if (string.IsNullOrEmpty(id)) continue;

                seen.Add(id);
                ApplySnapshotRow(id, enemy);
            }

            var stale = new List<string>();
            foreach (string id in _enemies.Keys)
                if (!seen.Contains(id)) stale.Add(id);

            foreach (string id in stale) Remove(id);
        }

        private void ApplySnapshotRow(string id, JObject row)
        {
            ApplySnapshotRow(id, row, false, Vector3.zero, 0, false);
        }

        private void ApplySnapshotRow(string id, JObject row, bool confirmedHit,
                                      Vector3 hitSource, int hitDamage, bool hitCritical)
        {
            if (!confirmedHit && TryDeferMeleeSnapshot(id, row, out JObject presentationRow))
                row = presentationRow;

            Enemy enemy;
            if (!_enemies.TryGetValue(id, out enemy))
            {
                enemy = Create(id, row);
                if (enemy == null) return;
            }

            float x = Value(row, "x");
            float z = Value(row, "z");
            Vector3 position = RoaCoords.ToUnity(x, z);

            int previousHp = enemy.Hp;
            int nextHp = row["hp"]?.ToObject<int>() ?? previousHp;

            bool wasDead = enemy.Dead;
            bool snapshotDead = ReadBoolean(row["dead"]);
            bool resolvedDead = ResolveSnapshotDeadState(wasDead, snapshotDead);
            bool acceptPosition = !wasDead || snapshotDead;
            if (acceptPosition) enemy.TargetPosition = position;
            enemy.Velocity = resolvedDead
                ? Vector3.zero
                : RoaCoords.VelocityToUnity(Value(row, "vx"), Value(row, "vz"));
            enemy.Moving = !resolvedDead && ReadBoolean(row["moving"]);
            enemy.Dead = resolvedDead;
            enemy.LastPacketTime = Time.time;
            enemy.ActivityRevision = row["activityRevision"]?.ToObject<int>() ?? enemy.ActivityRevision;
            enemy.Hp = resolvedDead ? 0 : nextHp;
            enemy.Snapshot = (JObject)row.DeepClone();
            enemy.Snapshot["dead"] = resolvedDead;
            enemy.Snapshot["moving"] = enemy.Moving;
            if (resolvedDead) enemy.Snapshot["hp"] = 0;
            SetPresentationBodyAlive(enemy.BodyCollider, enemy.BodyRigidbody, !resolvedDead);

            if (resolvedDead)
            {
                enemy.Moving = false;
                enemy.PresentationMoving = false;
                enemy.Velocity = Vector3.zero;
                enemy.PresentationVelocity = Vector3.zero;
                enemy.SmoothVelocity = Vector3.zero;
                enemy.ActionUntil = 0f;
                enemy.ReactionUntil = 0f;
                enemy.ThreatActive = false;
                enemy.ThreatRemaining = 0f;
                if (acceptPosition && enemy.Root != null)
                    enemy.Root.transform.position = enemy.TargetPosition;
            }
            else if (previousHp > 0 && nextHp > 0 && nextHp < previousHp)
            {
                enemy.ReactionUntil = Mathf.Max(enemy.ReactionUntil, Time.time + 0.28f);
            }

            if (enemy.CharacterView != null)
            {
                if (resolvedDead && !wasDead && confirmedHit)
                    enemy.CharacterView.PrepareDeath(hitSource);
                enemy.CharacterView.SetDead(enemy.Dead);
                if (!enemy.Dead && previousHp > 0 && nextHp > 0 && nextHp < previousHp)
                {
                    if (confirmedHit)
                        enemy.CharacterView.PlayHit(hitSource, hitDamage, hitCritical);
                    else enemy.CharacterView.PlayHit();
                }
                if (enemy.CharacterView.Ready) _ = RefreshHumanoidEquipment(enemy);
            }

            if (enemy.Root != null && enemy.Root.transform.position == Vector3.zero)
                enemy.Root.transform.position = position;

            float scale = Value(row, "scale");
            if (enemy.Root != null && scale > 0.01f)
                enemy.Root.transform.localScale = Vector3.one * scale;
        }

        private Enemy Create(string id, JObject row)
        {
            string key = RoaEnemyModels.ResolveKey(
                row["modelKey"]?.ToString(),
                row["visual"]?.ToString(),
                row["species"]?.ToString());

            bool unifiedHumanoid = RoaEnemyModels.IsUnifiedHumanoid(
                row["modelKey"]?.ToString(),
                row["visual"]?.ToString(),
                row["species"]?.ToString());

            string path = unifiedHumanoid ? string.Empty : RoaEnemyModels.Url(key);

            // Путь в карте моделей относительный — glTFast требует абсолютный URI
            // и без префикса падает с "URI must be absolute".
            string url = string.IsNullOrEmpty(path) ? string.Empty : BaseUrl.TrimEnd('/') + path;

            if (!unifiedHumanoid && string.IsNullOrEmpty(url))
            {
                // Неизвестная модель — молча пропускать нельзя: в комнате
                // окажется невидимый противник, который стреляет.
                Debug.LogWarning("[ROA] Нет модели для существа: modelKey='"
                    + row["modelKey"] + "' visual='" + row["visual"] + "'");
                return null;
            }

            string name = row["name"]?.ToString();
            var root = new GameObject("Enemy:" + (string.IsNullOrEmpty(name) ? id : name));
            root.transform.SetParent(transform, false);
            BodyProfile bodyProfile = PresentationBodyProfile(key, unifiedHumanoid);

            var enemy = new Enemy
            {
                Root = root,
                Gate = root.AddComponent<RoaVisibilityGate>(),
                UnifiedHumanoid = unifiedHumanoid,
                YawOffset = unifiedHumanoid ? 0f : RoaEnemyModels.YawOffset(key),
                Snapshot = (JObject)row.DeepClone(),
                LastPacketTime = Time.time,
                BodyRadius = bodyProfile.Radius,
                ContactFallbackAngleDeg = StableContactAngle(id),
                ActivityPhase01 = StableActivityPhase01(id)
            };
            enemy.BodyCollider = InstallPresentationBody(root, bodyProfile,
                out enemy.BodyRigidbody);

            _enemies[id] = enemy;
            if (unifiedHumanoid)
            {
                var viewRoot = new GameObject("View");
                viewRoot.transform.SetParent(root.transform, false);
                enemy.CharacterView = viewRoot.AddComponent<RoaCharacterView>();
                enemy.CharacterView.OnVisualChanged += enemy.Gate.Invalidate;
                _ = LoadHumanoidGuarded(enemy, HumanoidAppearance(row));
            }
            else
            {
                _ = LoadModelGuarded(enemy, url);
            }

            return enemy;
        }

        private async Task LoadHumanoidGuarded(Enemy enemy, JObject appearance)
        {
            try
            {
                if (enemy == null || enemy.CharacterView == null) return;
                await enemy.CharacterView.Load(BaseUrl, appearance);
                if (enemy.Root == null || enemy.CharacterView == null) return;
                enemy.CharacterView.SetDead(enemy.Dead);
                await RefreshHumanoidEquipment(enemy);
                if (enemy.Gate != null) enemy.Gate.Invalidate();
            }
            catch (MissingReferenceException)
            {
                // NPC покинул комнату во время загрузки общей модели.
            }
            catch (System.Exception error)
            {
                if (enemy == null || enemy.Root == null || enemy.CharacterView == null) return;
                Debug.LogError("[ROA] Сбой загрузки unified humanoid NPC: " + error);
            }
        }

        private async Task RefreshHumanoidEquipment(Enemy enemy)
        {
            if (enemy == null || enemy.Root == null || enemy.CharacterView == null
                || !enemy.CharacterView.Ready || enemy.Snapshot == null) return;

            JObject equipment = EnemyEquipment(enemy.Snapshot);
            string weapon = equipment["weapon"]?.ToString() ?? "fists";
            await Task.WhenAll(
                enemy.CharacterView.EquipWeapon(BaseUrl, weapon),
                enemy.CharacterView.EquipItems(BaseUrl, equipment));
            if (enemy.Gate != null) enemy.Gate.Invalidate();
        }

        private static JObject EnemyEquipment(JObject row)
        {
            JObject source = row?["equipment"] as JObject ?? new JObject();
            var result = new JObject();
            foreach (string slot in new[] { "weapon", "offhand", "armor", "helmet", "boots", "backpack" })
                result[slot] = BaseItemId(source[slot]?.ToString() ?? string.Empty);
            if (string.IsNullOrEmpty(result["weapon"]?.ToString()))
                result["weapon"] = BaseItemId(row?["weapon"]?.ToString() ?? "fists");
            return result;
        }

        private static string BaseItemId(string id)
        {
            if (string.IsNullOrEmpty(id) || !id.StartsWith("ui_")) return id;
            string[] parts = id.Split('_');
            return parts.Length == 4 ? parts[1] : id;
        }

        /// <summary>Детерминированная внешность — тот же FNV-1a seed, что в web 05f.</summary>
        private static JObject HumanoidAppearance(JObject row)
        {
            if (row?["appearance"] is JObject authored) return (JObject)authored.DeepClone();

            string seed = string.Join("|", new[]
            {
                row?["id"]?.ToString() ?? string.Empty,
                row?["name"]?.ToString() ?? string.Empty,
                row?["role"]?.ToString() ?? string.Empty,
                row?["faction"]?.ToString() ?? string.Empty,
                row?["visual"]?.ToString() ?? string.Empty,
                row?["modelKey"]?.ToString() ?? string.Empty
            });
            uint hash = 2166136261u;
            unchecked
            {
                foreach (char c in seed)
                {
                    hash ^= c;
                    hash *= 16777619u;
                }
            }

            string sex = (hash & 1u) == 0u ? "female" : "male";
            string[] bodies = { "slim", "medium", "large" };
            string[] hairs = { "shaved", "short_crop", "tied_back" };
            string hair = hairs[(int)((hash >> 7) % (uint)hairs.Length)];
            if (sex == "female" && hair == "short_crop") hair = "tied_back";
            if (sex == "male" && hair == "tied_back") hair = "short_crop";

            return new JObject
            {
                ["schema"] = "realm.character-appearance.v1",
                ["sex"] = sex,
                ["bodyType"] = bodies[(int)((hash >> 1) % (uint)bodies.Length)],
                ["faceId"] = sex + "_0" + (1 + ((hash >> 4) % 4u)),
                ["hairId"] = hair,
                ["skinToneId"] = "skin_03",
                ["hairColorId"] = "hair_0" + (1 + ((hash >> 11) % 8u))
            };
        }

        /// <summary>
        /// Обёртка над загрузкой. Задача запускается без ожидания, а исключение
        /// в такой задаче никто не наблюдает: без этого перехвата сбой выглядит
        /// как «модель просто не появилась», без единой строки в консоли.
        /// </summary>
        private async Task LoadModelGuarded(Enemy enemy, string url)
        {
            try
            {
                await LoadModel(enemy, url);
            }
            catch (MissingReferenceException)
            {
                // Существо покинуло комнату или остановился Play Mode, пока
                // качалась модель. Это штатная гонка, а не сбой.
            }
            catch (System.Exception error)
            {
                Debug.LogError("[ROA] Сбой загрузки модели существа " + url + ": " + error);
            }
        }

        private async Task LoadModel(Enemy enemy, string url)
        {
            GltfImport import = await LoadCached(url);

            if (import == null)
            {
                // Молчать нельзя: в комнате окажется невидимая сущность,
                // которая ходит и стреляет.
                Debug.LogError("[ROA] Модель существа не загрузилась: " + url);
                return;
            }

            if (enemy.Root == null) return;

            if (!await import.InstantiateMainSceneAsync(enemy.Root.transform))
            {
                Debug.LogError("[ROA] Экземпляр модели существа не создан: " + url);
                return;
            }

            if (enemy.Root == null) return;

            // У части существ клипы свои, а часть моделей — статичный меш.
            enemy.Animation = enemy.Root.GetComponentInChildren<Animation>();
            if (enemy.Animation == null) return;

            enemy.Animation.wrapMode = WrapMode.Loop;
            PlayClip(enemy, enemy.Dead ? "death" : "idle");
        }

        private static Task<GltfImport> LoadCached(string url)
        {
            Task<GltfImport> cached;
            if (ModelCache.TryGetValue(url, out cached)) return cached;

            Task<GltfImport> loading = LoadImport(url);
            ModelCache[url] = loading;
            return loading;
        }

        private static async Task<GltfImport> LoadImport(string url)
        {
            var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };
            var import = new GltfImport();

            if (!await import.Load(RoaModelUrl.Lite(url), settings))
            {
                import.Dispose();

                // Неудачную загрузку из кеша убираем: иначе одна сетевая
                // ошибка навсегда оставила бы модель отсутствующей.
                ModelCache.Remove(url);
                return null;
            }

            return import;
        }

        /// <summary>
        /// Volatile-кадр: двигает уже известных. Незнакомый id игнорируется —
        /// его появление придёт снимком.
        /// </summary>
        private void HandleFrame(EnemyFrameEvent frame)
        {
            if (frame.Enemies == null) return;

            foreach (JToken row in frame.Enemies)
            {
                JObject data = row as JObject;
                if (data == null) continue;

                string id = data["id"]?.ToString();
                if (string.IsNullOrEmpty(id)) continue;

                Enemy enemy;
                if (!_enemies.TryGetValue(id, out enemy)) continue;

                enemy.LastPacketTime = Time.time;

                int flags = data["flags"]?.ToObject<int>() ?? 0;
                bool frameReportsDead = (flags & EnemyFrameFlags.Dead) != 0;
                bool wasDead = enemy.Dead;
                int previousHp = enemy.Hp;
                int frameHp = data["hp"]?.ToObject<int>() ?? previousHp;
                bool deferredDeadFrame = frameReportsDead && MeleePresentationHeld(id);
                bool deferredDamageFrame = MeleePresentationHeld(id)
                    && frameHp < previousHp;
                if (deferredDeadFrame)
                {
                    _meleePresentationHolds[id].SawDeadFrame = true;
                }
                else if (frameReportsDead)
                {
                    _meleePresentationHolds.Remove(id);
                }
                bool deadFrame = ResolveFrameDeadState(
                    enemy.Dead, frameReportsDead, deferredDeadFrame);
                if (!wasDead || frameReportsDead)
                    enemy.TargetPosition = RoaCoords.ToUnity(Value(data, "x"), Value(data, "z"));
                enemy.Moving = !deferredDeadFrame && !deadFrame
                    && (flags & EnemyFrameFlags.Moving) != 0;
                enemy.Dead = deadFrame;
                enemy.Hp = ResolveFrameHealth(previousHp, frameHp, deadFrame,
                    deferredDamageFrame);
                enemy.Velocity = enemy.Moving
                    ? RoaCoords.VelocityToUnity(Value(data, "vx"), Value(data, "vz"))
                    : Vector3.zero;
                SetPresentationBodyAlive(enemy.BodyCollider, enemy.BodyRigidbody, !enemy.Dead);
                if (!wasDead && enemy.Dead)
                {
                    enemy.Moving = false;
                    enemy.PresentationMoving = false;
                    enemy.Velocity = Vector3.zero;
                    enemy.PresentationVelocity = Vector3.zero;
                    enemy.SmoothVelocity = Vector3.zero;
                    enemy.ActionUntil = 0f;
                    enemy.ReactionUntil = 0f;
                    if (enemy.Root != null) enemy.Root.transform.position = enemy.TargetPosition;
                }
                else if (!deferredDamageFrame && previousHp > 0
                    && enemy.Hp > 0 && enemy.Hp < previousHp)
                {
                    enemy.ReactionUntil = Mathf.Max(enemy.ReactionUntil,
                        Time.time + 0.28f);
                    if (enemy.CharacterView != null) enemy.CharacterView.PlayHit();
                }

                if (enemy.Snapshot != null)
                {
                    enemy.Snapshot["hp"] = enemy.Hp;
                    enemy.Snapshot["dead"] = enemy.Dead;
                    enemy.Snapshot["moving"] = enemy.Moving;
                    enemy.Snapshot["looted"] = (flags & EnemyFrameFlags.Searched) != 0;
                    enemy.Snapshot["hostileToPlayer"] =
                        (flags & EnemyFrameFlags.HostileToViewer) != 0;
                    if (data["aiState"] != null)
                        enemy.Snapshot["aiState"] = data["aiState"].ToString();
                }

                // lookX/lookZ — абсолютная серверная точка, а не направление.
                if (!enemy.Dead && (flags & EnemyFrameFlags.HasLook) != 0)
                {
                    enemy.LookPoint = RoaCoords.ToUnity(Value(data, "lookX"), Value(data, "lookZ"));
                    Vector3 look = enemy.LookPoint - enemy.TargetPosition;
                    look.y = 0f;
                    if (look.sqrMagnitude > 0.0001f)
                        enemy.TargetYawDeg = Mathf.Atan2(look.x, look.z) * Mathf.Rad2Deg;
                }

                bool threat = !enemy.Dead
                    && (flags & EnemyFrameFlags.AttackTelegraph) != 0
                    && Value(data, "attackMs") > 0f;
                bool started = threat && !enemy.ThreatActive;
                enemy.ThreatActive = threat;
                enemy.ThreatRemaining = threat ? Value(data, "attackMs") / 1000f : 0f;
                enemy.ThreatWindow = threat
                    ? Mathf.Max(enemy.ThreatRemaining, Value(data, "attackWindowMs") / 1000f) : 0f;
                enemy.ThreatRanged = threat
                    && (flags & EnemyFrameFlags.RangedAttackTelegraph) != 0;
                enemy.ThreatTargetsLocalPlayer = threat
                    && string.Equals(data["attackTargetId"]?.ToString(), Socket?.Session?.Id,
                        StringComparison.Ordinal);
                if (threat)
                {
                    enemy.Moving = false;
                    enemy.Velocity = Vector3.zero;
                }

                if (threat && enemy.ThreatView == null && enemy.Root != null)
                    enemy.ThreatView = enemy.Root.AddComponent<RoaEnemyThreatTelegraph>();

                if (started)
                {
                    // Небольшой запас поглощает джиттер между volatile frame и
                    // надёжным enemyMelee, не запуская второй замах после контакта.
                    enemy.AttackWindupUntil = Time.time + enemy.ThreatRemaining + 0.36f;
                    enemy.ActionUntil = Mathf.Max(enemy.ActionUntil,
                        Time.time + AttackRootLockSeconds(
                            enemy.ThreatRemaining, enemy.ThreatRanged));
                    enemy.Clip = string.Empty;
                    if (!AttackPresentationBlocked(enemy.Dead, enemy.ReactionUntil, Time.time)
                        && AnimateAttackAtTelegraph(enemy.ThreatRanged))
                    {
                        if (enemy.CharacterView != null)
                            enemy.CharacterView.PlayAttack(
                                RoaMeleeGrip.SwingSecondsForImpact(enemy.ThreatRemaining));
                        else PlayClip(enemy, "attack", enemy.ThreatRemaining);
                    }
                    if (enemy.ThreatTargetsLocalPlayer)
                        RoaAudio.Active?.PlayThreatWarning(enemy.ThreatRanged);
                }
            }
        }

        private void Update()
        {
            ReleaseDueMeleePresentationHolds();

            foreach (Enemy enemy in _enemies.Values)
            {
                if (enemy.Root == null) continue;

                float sincePacket = Time.time - enemy.LastPacketTime
                    + RoaNetworkActorMotion.OneWayLatencySeconds(
                        Socket != null ? Socket.PingMs : -1f,
                        Mathf.Min(MaxExtrapolationSeconds, 0.22f));
                Transform t = enemy.Root.transform;
                bool motionLocked = CombatMotionLocked(enemy.Dead, enemy.ThreatActive,
                    enemy.ActionUntil, enemy.ReactionUntil, Time.time);
                RoaNetworkActorMotion.Sample motion = RoaNetworkActorMotion.Step(
                    t.position, motionLocked ? t.position : enemy.TargetPosition,
                    motionLocked ? Vector3.zero : enemy.Velocity,
                    enemy.Moving && !motionLocked,
                    sincePacket, Time.deltaTime, SmoothTime,
                    Mathf.Min(MaxExtrapolationSeconds, 0.22f), SnapDistance,
                    ref enemy.SmoothVelocity);
                Vector3 presentedPosition = motion.Position;
                bool contactConstrained = false;
                Vector3 contactNormal = Vector3.zero;
                if (!enemy.Dead && _localPlayer != null
                    && Mathf.Abs(_localPlayer.transform.position.y - presentedPosition.y) < 1.8f)
                {
                    Vector3 scale = t.lossyScale;
                    float worldRadius = enemy.BodyRadius
                        * Mathf.Max(Mathf.Abs(scale.x), Mathf.Abs(scale.z));
                    Vector3 separated = ResolvePresentationContact(presentedPosition,
                        _localPlayer.transform.position,
                        LocalPlayerBodyRadius + worldRadius + ActorContactMargin,
                        enemy.ContactFallbackAngleDeg);
                    contactConstrained = (separated - presentedPosition).sqrMagnitude > 0.000001f;
                    presentedPosition = separated;
                    if (contactConstrained)
                    {
                        contactNormal = presentedPosition - _localPlayer.transform.position;
                        contactNormal.y = 0f;
                        if (contactNormal.sqrMagnitude > 0.0001f) contactNormal.Normalize();
                    }
                }
                if (contactConstrained) enemy.SmoothVelocity = Vector3.zero;
                t.position = presentedPosition;
                enemy.PresentationVelocity = motionLocked || contactConstrained
                    ? Vector3.zero : motion.VisualVelocity;
                enemy.PresentationMoving = motion.Moving && !motionLocked
                    && !contactConstrained && !enemy.Dead;
                if (motion.Snapped) enemy.StepFx = default(RoaMovementFx.ActorStepState);

                // Поворот следует видимому пути, а не устаревшей скорости пакета.
                if (enemy.PresentationMoving && enemy.PresentationVelocity.sqrMagnitude > 0.0001f)
                    enemy.TargetYawDeg = Mathf.Atan2(
                        enemy.PresentationVelocity.x, enemy.PresentationVelocity.z) * Mathf.Rad2Deg;

                if (!enemy.Dead)
                {
                    Quaternion wanted = Quaternion.Euler(0f, enemy.TargetYawDeg + enemy.YawOffset, 0f);
                    t.rotation = Quaternion.Slerp(t.rotation, wanted, 1f - Mathf.Exp(-10f * Time.deltaTime));
                }

                if (enemy.CharacterView != null)
                {
                    enemy.CharacterView.SetDead(enemy.Dead);
                    enemy.CharacterView.UpdateLocomotion(enemy.PresentationVelocity, enemy.TargetYawDeg,
                        enemy.PresentationMoving, false, contactNormal,
                        contactConstrained ? 1f : 0f);
                    bool hostile = ReadBoolean(enemy.Snapshot?["hostileToPlayer"], true);
                    enemy.CharacterView.SetActivityPresentation(ResolveNpcActivityVisual(
                        enemy.Snapshot?["activityType"]?.ToString(),
                        enemy.Snapshot?["activityPhase"]?.ToString(),
                        enemy.Snapshot?["visualAction"]?.ToString(),
                        enemy.Snapshot?["aiState"]?.ToString(),
                        enemy.PresentationMoving, enemy.Dead, hostile),
                        enemy.ActivityPhase01);
                }
                else UpdateClip(enemy);

                // Существо за стеной или за краем обзора не показывается вовсе:
                // видеть его на экране значило бы знать то, чего персонаж не знает.
                if (enemy.Gate != null)
                    enemy.Gate.SetVisible(Fog == null || Fog.IsVisible(t.position));

                bool visible = enemy.Gate == null || enemy.Gate.IsVisible;
                bool presentationVisible = visible && !RoaGameBootstrap.BlocksWorldHud;
                if (enemy.ThreatView != null)
                {
                    RoaEnemyThreatTelegraph.Frame threatFrame = RoaEnemyThreatTelegraph.Evaluate(
                        enemy.ThreatRemaining, enemy.ThreatWindow, enemy.ThreatRanged,
                        enemy.ThreatTargetsLocalPlayer);
                    Vector3 aimPoint = enemy.LookPoint;
                    if ((aimPoint - t.position).sqrMagnitude < 0.1f)
                        aimPoint = t.position + t.forward * 5f;
                    enemy.ThreatView.Present(threatFrame, t.position, aimPoint,
                        presentationVisible && !enemy.Dead);
                    enemy.ThreatRemaining = Mathf.Max(0f,
                        enemy.ThreatRemaining - Time.deltaTime);
                }
                Vector3 observer = _worldCamera != null ? _worldCamera.transform.position : t.position;
                if (enemy.CharacterView != null)
                    enemy.CharacterView.SetPresentationLod(RoaActorPresentationLod.Select(
                        t.position, observer, presentationVisible, Application.isMobilePlatform,
                        enemy.CharacterView.PresentationTier));
                if (_movementFx != null)
                {
                    _movementFx.TrackActor(ref enemy.StepFx, t.position, enemy.PresentationVelocity,
                        enemy.PresentationMoving, presentationVisible, false, observer);
                }
            }
        }

        private void UpdateClip(Enemy enemy)
        {
            if (enemy.CharacterView != null) return;
            if (enemy.Animation == null) return;

            bool reacting = Time.time < enemy.ReactionUntil
                && enemy.Animation.GetClip("hurt") != null;
            bool attacking = Time.time < enemy.ActionUntil
                && enemy.Animation.GetClip("attack") != null;
            RoaCharacterView.CombatPresentationPhase phase =
                RoaCharacterView.ResolveCombatPresentationPhase(
                    enemy.Dead, reacting, attacking, enemy.PresentationMoving);
            string wanted = phase == RoaCharacterView.CombatPresentationPhase.Death ? "death"
                : phase == RoaCharacterView.CombatPresentationPhase.Reaction ? "hurt"
                : phase == RoaCharacterView.CombatPresentationPhase.Attack ? "attack"
                : phase == RoaCharacterView.CombatPresentationPhase.Idle ? "idle"
                : enemy.PresentationVelocity.magnitude > RunSpeedThreshold ? "run" : "walk";

            PlayClip(enemy, wanted);
        }

        private static void PlayClip(Enemy enemy, string clip, float durationSeconds = 0f)
        {
            if (enemy.Animation == null || enemy.Clip == clip) return;
            if (enemy.Animation.GetClip(clip) == null) return;

            enemy.Clip = clip;
            AnimationState state = enemy.Animation[clip];

            // Одноразовые клипы всегда начинаются с нулевого кадра. Без этого
            // повторная атака могла CrossFade-нуться в уже закончившееся состояние,
            // а смерть сохраняла вес предыдущей ходьбы за ClampForever.
            state.wrapMode = clip == "death"
                ? WrapMode.ClampForever
                : (clip == "attack" || clip == "hurt" ? WrapMode.Once : WrapMode.Loop);
            state.speed = clip == "attack" && durationSeconds > 0.01f
                ? Mathf.Clamp(state.length / Mathf.Max(0.08f, durationSeconds), 0.42f, 2.6f)
                : 1f;
            if (clip == "death")
            {
                state.time = 0f;
                enemy.Animation.Play(clip, PlayMode.StopAll);
                return;
            }
            if (clip == "attack" || clip == "hurt") state.time = 0f;
            enemy.Animation.CrossFade(clip, clip == "hurt" ? 0.08f : 0.12f);
        }

        private static float Value(JObject row, string key)
        {
            JToken token = row[key];
            return token != null ? token.ToObject<float>() : 0f;
        }

        private void Remove(string id)
        {
            Enemy enemy;
            if (!_enemies.TryGetValue(id, out enemy)) return;

            _meleePresentationHolds.Remove(id);
            if (enemy.Root != null) Destroy(enemy.Root);
            _enemies.Remove(id);
        }

        public void CollectMinimapMarkers(List<RoaMinimap.Marker> markers)
        {
            if (markers == null) return;
            foreach (Enemy enemy in _enemies.Values)
            {
                if (enemy == null || enemy.Dead || enemy.Root == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;
                markers.Add(new RoaMinimap.Marker(ClassifyMinimapActor(enemy.Snapshot),
                                                   enemy.Root.transform.position));
            }
        }

        public static RoaMinimap.MarkerKind ClassifyMinimapActor(JObject snapshot)
        {
            bool hostile = ReadBoolean(snapshot?["hostileToPlayer"], true);
            if (hostile) return RoaMinimap.MarkerKind.Enemy;

            bool hasService = ReadBoolean(snapshot?["serviceAvailable"])
                || ReadBoolean(snapshot?["personalTrade"])
                || !string.IsNullOrWhiteSpace(snapshot?["traderProfile"]?.ToString())
                || !string.IsNullOrWhiteSpace(snapshot?["traderId"]?.ToString())
                || !string.IsNullOrWhiteSpace(snapshot?["tradeProfile"]?.ToString());
            return hasService
                ? RoaMinimap.MarkerKind.ServiceNpc
                : RoaMinimap.MarkerKind.FriendlyNpc;
        }

        public void CollectNameplates(List<RoaActorNameplates.Entry> rows, Vector3 origin, float maxDistance)
        {
            if (rows == null) return;
            float maxSq = maxDistance * maxDistance;
            foreach (Enemy enemy in _enemies.Values)
            {
                if (enemy == null || enemy.Dead || enemy.Root == null || enemy.Snapshot == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;
                Vector3 delta = enemy.Root.transform.position - origin;

                delta.y = 0f;
                if (delta.sqrMagnitude > maxSq) continue;
                float scale = Mathf.Clamp(Value(enemy.Snapshot, "scale"), 0.75f, 1.25f);
                if (scale <= 0.01f) scale = 1f;
                bool canDialogue = ReadBoolean(enemy.Snapshot["canDialogue"]);
                bool important = RoaActorNameplates.IsImportantNpc(canDialogue,
                    enemy.Snapshot["role"]?.ToString(), enemy.Snapshot["encounterRole"]?.ToString());
                bool hostile = ReadBoolean(enemy.Snapshot["hostileToPlayer"], true);
                rows.Add(new RoaActorNameplates.Entry
                {
                    Name = important ? enemy.Snapshot["name"]?.ToString() ?? "Торговец" : string.Empty,
                    Faction = NpcCombatFactionLine(
                        enemy.Snapshot["faction"]?.ToString(), hostile,
                        enemy.Snapshot["aiState"]?.ToString(),
                        enemy.ThreatActive && enemy.ThreatTargetsLocalPlayer,
                        enemy.ThreatRanged,
                        enemy.Snapshot["activityType"]?.ToString(),
                        enemy.Snapshot["activityPhase"]?.ToString()),
                    Hp = enemy.Hp,
                    MaxHp = Mathf.Max(1, enemy.Snapshot["maxHp"]?.ToObject<int>() ?? enemy.Hp),
                    World = enemy.Root.transform.position + Vector3.up * (2.05f * scale),
                    Hostile = hostile,
                    IsPlayer = false
                });
            }
        }

        /// <summary>
        /// Active NPC speech from the authoritative enemy snapshot. Rendering
        /// belongs to RoaCombatFx so no canvas or texture is allocated per NPC.
        /// </summary>
        public void CollectSpeechBubbles(List<RoaCombatFx.SpeechBubble> bubbles)
        {
            if (bubbles == null) return;
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            foreach (KeyValuePair<string, Enemy> entry in _enemies)
            {
                Enemy enemy = entry.Value;
                if (enemy == null || enemy.Root == null || enemy.Dead || enemy.Snapshot == null) continue;
                if (enemy.Gate != null && !enemy.Gate.IsVisible) continue;
                string speech = enemy.Snapshot["speechText"]?.ToString()?.Trim();
                if (string.IsNullOrEmpty(speech)) continue;
                long until = enemy.Snapshot["speechUntil"]?.ToObject<long>() ?? 0L;
                if (until <= now) continue;
                float opacity = Mathf.Clamp01((until - now) / 420f);
                float rawScale = Value(enemy.Snapshot, "scale");
                float scale = rawScale > 0.01f ? Mathf.Clamp(rawScale, 0.75f, 1.25f) : 1f;
                bubbles.Add(new RoaCombatFx.SpeechBubble
                {
                    Id = entry.Key,
                    Text = speech,
                    World = enemy.Root.transform.position + Vector3.up * (2.85f * scale),
                    Opacity = Mathf.Max(0.18f, opacity)
                });
            }
        }

        public void Clear()
        {
            foreach (Enemy enemy in _enemies.Values)
                if (enemy.Root != null) Destroy(enemy.Root);

            _enemies.Clear();
            _meleePresentationHolds.Clear();
            _dueMeleePresentationHolds.Clear();
        }
    }
}
