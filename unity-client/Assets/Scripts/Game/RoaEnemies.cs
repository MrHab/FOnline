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
    public sealed class RoaEnemies : MonoBehaviour
    {
        [Tooltip("Origin сервера — отсюда грузятся модели существ.")]
        public string BaseUrl = "http://127.0.0.1:3000";

        [Tooltip("Время сглаживания к серверной позиции, сек.")]
        public float SmoothTime = 0.12f;

        [Tooltip("Сколько секунд продолжать движение по последней скорости без новых пакетов.")]
        public float MaxExtrapolationSeconds = 0.4f;

        [Tooltip("Коррекция больше этой дистанции считается телепортом или спавном.")]
        public float SnapDistance = 4f;

        public RoaSocketClient Socket;

        [Tooltip("Туман войны. Пока не назначен, существа видны всегда.")]
        public RoaFogOfWar Fog;

        private RoaMovementFx _movementFx;
        private Camera _worldCamera;

        /// <summary>Порог перехода на бег для существ, м/с.</summary>
        private const float RunSpeedThreshold = 2.4f;

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
        }

        private readonly Dictionary<string, Enemy> _enemies = new Dictionary<string, Enemy>();

        public void ConfigureMovementFx(RoaMovementFx movementFx, Camera worldCamera)
        {
            _movementFx = movementFx;
            _worldCamera = worldCamera;
        }

        /// <summary>Сколько сущностей в комнате сейчас. Для диагностики.</summary>
        public int Count { get { return _enemies.Count; } }

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
                if (enemy.Snapshot?["hostileToPlayer"]?.ToObject<bool>() == false) continue;
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

                bool dead = enemy.Snapshot["dead"]?.ToObject<bool>() ?? enemy.Dead;
                bool hostile = enemy.Snapshot["hostileToPlayer"]?.ToObject<bool>() ?? true;
                bool canDialogue = enemy.Snapshot["canDialogue"]?.ToObject<bool>() ?? false;
                bool hasTrade = !string.IsNullOrEmpty(enemy.Snapshot["traderProfile"]?.ToString())
                    || !string.IsNullOrEmpty(enemy.Snapshot["traderId"]?.ToString())
                    || enemy.Snapshot["personalTrade"]?.ToObject<bool>() == true;

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
            if (payload?["enemyShooter"]?.ToObject<bool>() != true) return;
            PlayEnemyAttack(payload["shooterId"]?.ToString(), payload);
        }

        private void HandleEnemyMelee(JObject payload)
        {
            PlayEnemyAttack(payload?["enemyId"]?.ToString(), payload);
        }

        private void PlayEnemyAttack(string id, JObject payload)
        {
            if (string.IsNullOrEmpty(id) || !_enemies.TryGetValue(id, out Enemy enemy)) return;
            if (enemy.Dead) return;
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
            if (!windupAnimated)
            {
                enemy.Clip = string.Empty;
                if (enemy.CharacterView != null) enemy.CharacterView.PlayAttack();
                else PlayClip(enemy, "attack");
            }
        }

        private void HandleEnemyKilled(JObject payload)
        {
            string id = payload?["enemyId"]?.ToString();
            if (string.IsNullOrEmpty(id) || !_enemies.TryGetValue(id, out Enemy enemy)) return;
            enemy.Dead = true;
            enemy.Moving = false;
            enemy.PresentationMoving = false;
            enemy.Velocity = Vector3.zero;
            enemy.PresentationVelocity = Vector3.zero;
            enemy.ActionUntil = 0f;
            enemy.ThreatActive = false;
            enemy.ThreatRemaining = 0f;
            if (payload["x"] != null && payload["z"] != null)
            {
                enemy.TargetPosition = RoaCoords.ToUnity(Value(payload, "x"), Value(payload, "z"));
                if (enemy.Root != null) enemy.Root.transform.position = enemy.TargetPosition;
                enemy.SmoothVelocity = Vector3.zero;
            }
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

            enemy.TargetPosition = position;
            enemy.Velocity = RoaCoords.VelocityToUnity(Value(row, "vx"), Value(row, "vz"));
            enemy.Moving = row["moving"]?.ToObject<bool>() ?? false;
            enemy.Dead = row["dead"]?.ToObject<bool>() ?? false;
            enemy.LastPacketTime = Time.time;
            enemy.ActivityRevision = row["activityRevision"]?.ToObject<int>() ?? enemy.ActivityRevision;
            enemy.Hp = nextHp;
            enemy.Snapshot = (JObject)row.DeepClone();

            if (enemy.CharacterView != null)
            {
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

            var enemy = new Enemy
            {
                Root = root,
                Gate = root.AddComponent<RoaVisibilityGate>(),
                UnifiedHumanoid = unifiedHumanoid,
                YawOffset = unifiedHumanoid ? 0f : RoaEnemyModels.YawOffset(key),
                Snapshot = (JObject)row.DeepClone(),
                LastPacketTime = Time.time
            };

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
            PlayClip(enemy, "idle");
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

                enemy.TargetPosition = RoaCoords.ToUnity(Value(data, "x"), Value(data, "z"));
                enemy.LastPacketTime = Time.time;

                int flags = data["flags"]?.ToObject<int>() ?? 0;
                enemy.Moving = (flags & EnemyFrameFlags.Moving) != 0;
                enemy.Dead = (flags & EnemyFrameFlags.Dead) != 0;

                enemy.Velocity = enemy.Moving
                    ? RoaCoords.VelocityToUnity(Value(data, "vx"), Value(data, "vz"))
                    : Vector3.zero;

                // lookX/lookZ — абсолютная серверная точка, а не направление.
                if ((flags & EnemyFrameFlags.HasLook) != 0)
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

                if (threat && enemy.ThreatView == null && enemy.Root != null)
                    enemy.ThreatView = enemy.Root.AddComponent<RoaEnemyThreatTelegraph>();

                if (started)
                {
                    enemy.AttackWindupUntil = Time.time + enemy.ThreatRemaining + 0.18f;
                    enemy.ActionUntil = Mathf.Max(enemy.ActionUntil,
                        Time.time + enemy.ThreatRemaining + 0.08f);
                    enemy.Clip = string.Empty;
                    if (enemy.CharacterView != null) enemy.CharacterView.PlayAttack();
                    else PlayClip(enemy, "attack");
                    if (enemy.ThreatTargetsLocalPlayer)
                        RoaAudio.Active?.PlayThreatWarning(enemy.ThreatRanged);
                }
            }
        }

        private void Update()
        {
            foreach (Enemy enemy in _enemies.Values)
            {
                if (enemy.Root == null) continue;

                float sincePacket = Time.time - enemy.LastPacketTime
                    + RoaNetworkActorMotion.OneWayLatencySeconds(
                        Socket != null ? Socket.PingMs : -1f, MaxExtrapolationSeconds);
                Transform t = enemy.Root.transform;
                RoaNetworkActorMotion.Sample motion = RoaNetworkActorMotion.Step(
                    t.position, enemy.TargetPosition, enemy.Velocity, enemy.Moving,
                    sincePacket, Time.deltaTime, SmoothTime,
                    MaxExtrapolationSeconds, SnapDistance, ref enemy.SmoothVelocity);
                t.position = motion.Position;
                enemy.PresentationVelocity = motion.VisualVelocity;
                enemy.PresentationMoving = motion.Moving && !enemy.Dead;
                if (motion.Snapped) enemy.StepFx = default(RoaMovementFx.ActorStepState);

                // Поворот следует видимому пути, а не устаревшей скорости пакета.
                if (enemy.PresentationMoving && enemy.PresentationVelocity.sqrMagnitude > 0.0001f)
                    enemy.TargetYawDeg = Mathf.Atan2(
                        enemy.PresentationVelocity.x, enemy.PresentationVelocity.z) * Mathf.Rad2Deg;

                Quaternion wanted = Quaternion.Euler(0f, enemy.TargetYawDeg + enemy.YawOffset, 0f);
                t.rotation = Quaternion.Slerp(t.rotation, wanted, 1f - Mathf.Exp(-10f * Time.deltaTime));

                if (enemy.CharacterView != null)
                {
                    enemy.CharacterView.SetDead(enemy.Dead);
                    enemy.CharacterView.UpdateLocomotion(enemy.PresentationVelocity, enemy.TargetYawDeg,
                        enemy.PresentationMoving, false);
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

            string wanted;
            if (enemy.Dead) wanted = "death";
            else if (Time.time < enemy.ActionUntil && enemy.Animation.GetClip("attack") != null) wanted = "attack";
            else if (!enemy.PresentationMoving) wanted = "idle";
            else wanted = enemy.PresentationVelocity.magnitude > RunSpeedThreshold ? "run" : "walk";

            PlayClip(enemy, wanted);
        }

        private static void PlayClip(Enemy enemy, string clip)
        {
            if (enemy.Animation == null || enemy.Clip == clip) return;
            if (enemy.Animation.GetClip(clip) == null) return;

            enemy.Clip = clip;

            // Смерть проигрывается один раз и замирает в последней позе.
            enemy.Animation[clip].wrapMode = clip == "death"
                ? WrapMode.ClampForever
                : (clip == "attack" ? WrapMode.Once : WrapMode.Loop);
            enemy.Animation.CrossFade(clip, 0.15f);
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
            bool hostile = snapshot?["hostileToPlayer"]?.ToObject<bool>() ?? true;
            if (hostile) return RoaMinimap.MarkerKind.Enemy;

            bool hasService = snapshot?["serviceAvailable"]?.ToObject<bool>() == true
                || snapshot?["personalTrade"]?.ToObject<bool>() == true
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
                if (enemy.Snapshot["canDialogue"]?.ToObject<bool>() != true) continue;
                Vector3 delta = enemy.Root.transform.position - origin;
                delta.y = 0f;
                if (delta.sqrMagnitude > maxSq) continue;
                float scale = Mathf.Clamp(Value(enemy.Snapshot, "scale"), 0.75f, 1.25f);
                if (scale <= 0.01f) scale = 1f;
                rows.Add(new RoaActorNameplates.Entry
                {
                    Name = enemy.Snapshot["name"]?.ToString() ?? "Персонаж",
                    Hp = enemy.Hp,
                    MaxHp = Mathf.Max(1, enemy.Snapshot["maxHp"]?.ToObject<int>() ?? enemy.Hp),
                    World = enemy.Root.transform.position + Vector3.up * (2.05f * scale),
                    Hostile = enemy.Snapshot["hostileToPlayer"]?.ToObject<bool>() != false,
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
        }
    }
}
