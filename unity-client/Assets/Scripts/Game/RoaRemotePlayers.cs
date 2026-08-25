using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Другие игроки комнаты.
    ///
    /// Пакеты playerState приходят ~20 Гц и volatile: часть теряется намеренно.
    /// Поэтому между пакетами позиция интерполируется, а серверная скорость (vx, vz)
    /// продолжает движение, если следующий пакет задержался. Без этого удалённые
    /// игроки телепортируются рывками.
    /// </summary>
    public sealed class RoaRemotePlayers : MonoBehaviour
    {
        [Tooltip("Время сглаживания к последней серверной позиции, сек.")]
        public float SmoothTime = 0.1f;

        [Tooltip("Сколько секунд продолжать движение по последней скорости, если пакетов нет.")]
        public float MaxExtrapolationSeconds = 0.25f;

        public RoaSocketClient Socket;

        [Tooltip("Origin сервера — отсюда грузятся модели персонажей.")]
        public string BaseUrl = "http://127.0.0.1:3000";

        [Tooltip("Туман войны. Пока не назначен, другие игроки видны всегда.")]
        public RoaFogOfWar Fog;

        private RoaMovementFx _movementFx;
        private Camera _worldCamera;

        private sealed class Remote
        {
            public GameObject Root;
            public RoaVisibilityGate Gate;
            public RoaCharacterView View;
            public PublicPlayer Player;
            public Vector3 TargetPosition;
            public Vector3 Velocity;
            public float TargetYawDeg;
            public float LastPacketTime;
            public long LastSeq;
            public Vector3 SmoothVelocity;
            public bool Moving;
            public bool Crouching;
            public Vector3 AimPoint;
            public float AimUntil;
            public RoaMovementFx.ActorStepState StepFx;
        }

        private readonly Dictionary<string, Remote> _remotes = new Dictionary<string, Remote>();

        public void ConfigureMovementFx(RoaMovementFx movementFx, Camera worldCamera)
        {
            _movementFx = movementFx;
            _worldCamera = worldCamera;
        }

        private void OnEnable()
        {
            if (Socket == null) return;
            Socket.OnJoined += HandleJoined;
            Socket.OnPlayerJoined += HandlePlayerJoined;
            Socket.OnPlayerLeft += HandlePlayerLeft;
            Socket.OnRemotePlayerMoved += HandleMoved;
            Socket.OnPlayerReloaded += HandleReloaded;
            Socket.OnShot += HandleAttackVisual;
            Socket.OnMelee += HandleAttackVisual;
            Socket.OnRoomSnapshot += HandleSnapshot;
            Socket.OnPlayerRespawned += HandlePlayerRespawned;
            Socket.OnPlayerDamaged += HandlePlayerDamaged;
            Socket.OnPlayerHealed += HandlePlayerHealed;
        }

        private void OnDisable()
        {
            if (Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnPlayerJoined -= HandlePlayerJoined;
            Socket.OnPlayerLeft -= HandlePlayerLeft;
            Socket.OnRemotePlayerMoved -= HandleMoved;
            Socket.OnPlayerReloaded -= HandleReloaded;
            Socket.OnShot -= HandleAttackVisual;
            Socket.OnMelee -= HandleAttackVisual;
            Socket.OnRoomSnapshot -= HandleSnapshot;
            Socket.OnPlayerRespawned -= HandlePlayerRespawned;
            Socket.OnPlayerDamaged -= HandlePlayerDamaged;
            Socket.OnPlayerHealed -= HandlePlayerHealed;
        }

        /// <summary>
        /// Замах другого игрока. И выстрел, и ближняя атака приходят с полем
        /// shooterId — это чистый визуал, урон идёт отдельным авторитетным путём.
        /// </summary>
        private void HandleAttackVisual(Newtonsoft.Json.Linq.JObject payload)
        {
            string id = payload["shooterId"]?.ToString() ?? payload["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;

            Remote remote;
            if (!_remotes.TryGetValue(id, out remote) || remote.View == null) return;

            if (payload["angle"] != null)
                remote.TargetYawDeg = RoaCoords.AngleToYawDeg(payload["angle"].ToObject<float>());

            Vector3 start;
            Vector3 end;
            if (RoaCombatFx.TryShotEndpoints(payload, out start, out end))
            {
                remote.AimPoint = end;
                remote.AimUntil = Time.time + 0.32f;
                remote.View.SetAim(end, true);
            }

            remote.View.PlayAttack();
        }

        /// <summary>
        /// Перезарядка другого игрока. Сервер шлёт только момент и оружие
        /// (server.js:20343), поэтому длительность берётся по умолчанию.
        /// </summary>
        private void HandleReloaded(Newtonsoft.Json.Linq.JObject payload)
        {
            string id = payload["shooterId"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;

            Remote remote;
            if (!_remotes.TryGetValue(id, out remote) || remote.View == null) return;

            remote.View.StartReload(0f);
        }

        private void HandleJoined(JoinAck ack)
        {
            Clear();
            if (ack?.Players == null) return;

            foreach (PublicPlayer player in ack.Players) HandlePlayerJoined(player);
            Debug.Log("[ROA] В комнате других игроков: " + _remotes.Count);
        }

        private void HandlePlayerJoined(PublicPlayer player)
        {
            if (player == null || string.IsNullOrEmpty(player.Id)) return;
            if (_remotes.ContainsKey(player.Id)) return;

            var root = new GameObject("Remote:" + (string.IsNullOrEmpty(player.Name) ? player.Id : player.Name));
            root.transform.SetParent(transform, false);

            // Та же структура, что у локального игрока: корень несёт позицию
            // и поворот, дочерний View — только модель и анимацию.
            var viewGo = new GameObject("View");
            viewGo.transform.SetParent(root.transform, false);

            var view = viewGo.AddComponent<RoaCharacterView>();

            Vector3 position = RoaCoords.ToUnity(player.X, player.Z);
            root.transform.position = position;

            var remote = new Remote
            {
                Root = root,
                Gate = root.AddComponent<RoaVisibilityGate>(),
                View = view,
                Player = player,
                TargetPosition = position,
                TargetYawDeg = RoaCoords.AngleToYawDeg(player.Angle),
                LastPacketTime = Time.time,
                Velocity = Vector3.zero,
                Moving = player.Moving,
                Crouching = player.Crouching
            };
            view.OnVisualChanged += remote.Gate.Invalidate;
            _remotes[player.Id] = remote;
            Debug.Log("[ROA] Другой игрок вошёл: "
                + (string.IsNullOrEmpty(player.Name) ? player.Id : player.Name)
                + "; в комнате: " + _remotes.Count);
            _ = LoadRemoteVisuals(remote);
        }

        private void HandleSnapshot(List<PublicPlayer> players)
        {
            if (players == null) return;
            foreach (PublicPlayer player in players)
            {
                if (player == null || string.IsNullOrEmpty(player.Id)) continue;
                if (_remotes.TryGetValue(player.Id, out Remote remote))
                {
                    remote.Player = player;
                    if (remote.View != null) remote.View.SetInjuries(player.Injuries);
                    if (remote.View != null && remote.View.Ready) _ = ApplyRemoteEquipment(remote);
                }
            }
        }

        /// <summary>
        /// Ближайший живой игрок для серверного socialAction. Серверный предел — 4.8 м;
        /// вызывающий код обычно передаёт 4.5 м, оставляя запас на сетевое движение.
        /// </summary>
        /// <summary>Сколько других игроков сейчас в локации (для плитки «В локации» PIP-ASH).</summary>
        public int Count
        {
            get
            {
                int count = 0;
                foreach (Remote remote in _remotes.Values) if (remote?.Player != null) count++;
                return count;
            }
        }

        public bool TryGetNearest(Vector3 origin, float maxDistance, out PublicPlayer player, out float distance)
        {
            player = null;
            distance = float.PositiveInfinity;
            float maxSqr = maxDistance * maxDistance;

            foreach (Remote remote in _remotes.Values)
            {
                if (remote?.Root == null || remote.Player == null || remote.Player.Dead) continue;
                Vector3 delta = remote.Root.transform.position - origin;
                delta.y = 0f;
                float sqr = delta.sqrMagnitude;
                if (sqr > maxSqr || sqr >= distance * distance) continue;
                player = remote.Player;
                distance = Mathf.Sqrt(sqr);
            }

            return player != null;
        }

        /// <summary>Живая видимая PvP-цель вокруг точки курсора.</summary>
        public bool TryFindTarget(Vector3 worldPoint, float maxDistance,
                                  out PublicPlayer player, out Vector3 position, out float cursorDistance)
        {
            player = null;
            position = Vector3.zero;
            cursorDistance = float.PositiveInfinity;
            float bestSqr = maxDistance * maxDistance;

            foreach (Remote remote in _remotes.Values)
            {
                if (remote?.Root == null || remote.Player == null || remote.Player.Dead) continue;
                if (remote.Gate != null && !remote.Gate.IsVisible) continue;
                Vector3 delta = remote.Root.transform.position - worldPoint;
                delta.y = 0f;
                float sqr = delta.sqrMagnitude;
                if (sqr > bestSqr) continue;
                bestSqr = sqr;
                player = remote.Player;
                position = remote.Root.transform.position;
                cursorDistance = Mathf.Sqrt(sqr);
            }

            return player != null;
        }

        /// <summary>Игрок под курсором: луч экрана пересекает модель.</summary>
        public bool TryFindTargetUnderCursor(Ray ray, out PublicPlayer player, out Vector3 position, out float rayDistance)
        {
            player = null;
            position = Vector3.zero;
            rayDistance = float.PositiveInfinity;
            foreach (Remote remote in _remotes.Values)
            {
                if (remote?.Root == null || remote.Player == null || remote.Player.Dead) continue;
                if (remote.Gate != null && !remote.Gate.IsVisible) continue;
                float distance;
                if (!RoaEnemies.RayHitsModel(remote.Root, ray, out distance) || distance >= rayDistance) continue;
                rayDistance = distance;
                player = remote.Player;
                position = remote.Root.transform.position;
            }
            return player != null;
        }

        /// <summary>
        /// Ближайший видимый игрок вдоль линии выстрела. Совпадает с
        /// <c>findRemotePlayerAlongRay</c> web-клиента: цель должна находиться
        /// впереди стрелка и не дальше заданного поперечного радиуса.
        /// </summary>
        public bool TryFindTargetAlongRay(Vector3 origin, Vector3 direction,
                                          float maxDistance, float hitRadius,
                                          out PublicPlayer player, out Vector3 position,
                                          out float projection, out float perpendicular)
        {
            player = null;
            position = Vector3.zero;
            projection = float.PositiveInfinity;
            perpendicular = float.PositiveInfinity;
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) return false;
            direction.Normalize();

            float bestProjection = maxDistance + 0.45f;
            foreach (Remote remote in _remotes.Values)
            {
                if (remote?.Root == null || remote.Player == null || remote.Player.Dead) continue;
                if (remote.Gate != null && !remote.Gate.IsVisible) continue;

                Vector3 delta = remote.Root.transform.position - origin;
                delta.y = 0f;
                float along = Vector3.Dot(delta, direction);
                if (along < 0.35f || along > maxDistance + 0.45f || along >= bestProjection) continue;
                float side = (delta - direction * along).magnitude;
                if (side > hitRadius) continue;

                bestProjection = along;
                player = remote.Player;
                position = remote.Root.transform.position;
                projection = along;
                perpendicular = side;
            }

            return player != null;
        }

        public void ApplyPublicPlayer(PublicPlayer player)
        {
            if (player == null || string.IsNullOrEmpty(player.Id)) return;
            if (!_remotes.TryGetValue(player.Id, out Remote remote)) return;
            remote.Player = player;
            if (remote.View != null) remote.View.SetInjuries(player.Injuries);
            if (remote.View != null && remote.View.Ready) _ = ApplyRemoteEquipment(remote);
            if (player.Dead || player.Hp <= 0) HandlePlayerLeft(player.Id);
        }

        private void HandlePlayerRespawned(JObject payload)
        {
            if (payload == null) return;
            PublicPlayer player = payload["player"]?.ToObject<PublicPlayer>();
            bool visibleHere = payload["visibleHere"]?.ToObject<bool>() ?? false;
            if (visibleHere && player != null)
            {
                HandlePlayerLeft(player.Id);
                HandlePlayerJoined(player);
                return;
            }

            string id = payload["id"]?.ToString();
            if (!string.IsNullOrEmpty(id)) HandlePlayerLeft(id);
        }

        private void HandlePlayerDamaged(JObject payload)
        {
            ApplyVitals(payload, true);
        }

        private void HandlePlayerHealed(JObject payload)
        {
            ApplyVitals(payload, false);
        }

        private void ApplyVitals(JObject payload, bool removeDead)
        {
            if (payload == null) return;
            string id = payload["playerId"]?.ToString() ?? payload["targetId"]?.ToString();
            if (string.IsNullOrEmpty(id) || !_remotes.TryGetValue(id, out Remote remote) || remote.Player == null) return;
            if (payload["hp"] != null) remote.Player.Hp = payload["hp"].ToObject<int>();
            if (payload["maxHp"] != null) remote.Player.MaxHp = payload["maxHp"].ToObject<int>();
            if (payload["injuries"] is JObject injuries)
            {
                remote.Player.Injuries = (JObject)injuries.DeepClone();
                if (remote.View != null) remote.View.SetInjuries(remote.Player.Injuries);
            }
            if (removeDead && (payload["killed"]?.ToObject<bool>() == true || remote.Player.Hp <= 0))
                HandlePlayerLeft(id);
        }

        /// <summary>
        /// Модель, затем оружие: хвату нужны уже созданные кости.
        /// Оружие приходит в publicPlayer.weapon (server.js:18259).
        /// </summary>
        private async System.Threading.Tasks.Task LoadRemoteVisuals(Remote remote)
        {
            if (remote == null || remote.View == null || remote.Player == null) return;
            await remote.View.Load(BaseUrl, remote.Player.Appearance);
            await ApplyRemoteEquipment(remote);
        }

        private async System.Threading.Tasks.Task ApplyRemoteEquipment(Remote remote)
        {
            if (remote == null || remote.View == null || !remote.View.Ready || remote.Player == null) return;
            remote.View.SetInjuries(remote.Player.Injuries);
            await System.Threading.Tasks.Task.WhenAll(
                remote.View.EquipWeapon(BaseUrl, remote.Player.Weapon),
                remote.View.EquipItems(BaseUrl, remote.Player.Equipment));
        }

        private void HandlePlayerLeft(string id)
        {
            if (string.IsNullOrEmpty(id) || !_remotes.TryGetValue(id, out Remote remote)) return;

            if (remote.Root != null) Destroy(remote.Root);
            _remotes.Remove(id);
            Debug.Log("[ROA] Другой игрок вышел: " + id + "; в комнате: " + _remotes.Count);
        }

        private void HandleMoved(PlayerMovement movement)
        {
            if (movement == null || string.IsNullOrEmpty(movement.Id)) return;
            if (!_remotes.TryGetValue(movement.Id, out Remote remote)) return;

            // Пакеты volatile и могут обгонять друг друга — устаревший игнорируем.
            if (movement.Seq != 0 && movement.Seq <= remote.LastSeq) return;
            remote.LastSeq = movement.Seq;

            Vector3 position = RoaCoords.ToUnity(movement.X, movement.Z);
            position.y = remote.Root != null ? remote.Root.transform.position.y : 0f;

            remote.TargetPosition = position;
            remote.Velocity = movement.Moving
                ? RoaCoords.VelocityToUnity(movement.Vx, movement.Vz)
                : Vector3.zero;
            remote.TargetYawDeg = RoaCoords.AngleToYawDeg(movement.Angle);
            remote.LastPacketTime = Time.time;
            remote.Moving = movement.Moving;
            remote.Crouching = movement.Crouching;
        }

        private void Update()
        {
            foreach (Remote remote in _remotes.Values)
            {
                if (remote.Root == null) continue;

                // Экстраполяция закрывает разрыв между пакетами, но ограничена по
                // времени: иначе потерянный «стоп» уводит фигуру в бесконечный бег.
                float sincePacket = Time.time - remote.LastPacketTime;
                if (sincePacket <= MaxExtrapolationSeconds)
                    remote.TargetPosition += remote.Velocity * Time.deltaTime;

                Transform t = remote.Root.transform;
                t.position = Vector3.SmoothDamp(t.position, remote.TargetPosition,
                    ref remote.SmoothVelocity, SmoothTime);

                t.rotation = Quaternion.Slerp(t.rotation,
                    Quaternion.Euler(0f, remote.TargetYawDeg, 0f), 1f - Mathf.Exp(-12f * Time.deltaTime));

                // Локомоция берётся из серверной скорости: у удалённых игроков
                // своего ввода нет, а взгляд и путь так же независимы, как у своего.
                if (remote.View != null)
                {
                    remote.View.UpdateLocomotion(remote.Velocity, remote.TargetYawDeg,
                        remote.Moving, remote.Crouching);
                    remote.View.SetAim(remote.AimPoint, Time.time < remote.AimUntil);
                }

                // Туман скрывает рендереры, но сеть, интерполяция и выбор клипа
                // продолжают обновляться. Сэмплинг костей для невидимого актёра
                // Unity отсекает отдельно через BasedOnRenderers.
                if (remote.Gate != null)
                    remote.Gate.SetVisible(Fog == null || Fog.IsVisible(t.position, remote.Crouching));

                bool visible = remote.Gate == null || remote.Gate.IsVisible;
                bool presentationVisible = visible && !RoaGameBootstrap.BlocksWorldHud;
                Vector3 observer = _worldCamera != null ? _worldCamera.transform.position : t.position;
                if (remote.View != null)
                    remote.View.SetPresentationLod(RoaActorPresentationLod.Select(
                        t.position, observer, presentationVisible, Application.isMobilePlatform,
                        remote.View.PresentationTier));
                if (_movementFx != null)
                {
                    _movementFx.TrackActor(ref remote.StepFx, t.position, remote.Velocity,
                        remote.Moving, presentationVisible, remote.Crouching, observer);
                }
            }
        }

        public void Clear()
        {
            foreach (Remote remote in _remotes.Values)
                if (remote.Root != null) Destroy(remote.Root);

            _remotes.Clear();
        }

        public void CollectMinimapMarkers(List<RoaMinimap.Marker> markers)
        {
            if (markers == null) return;
            foreach (Remote remote in _remotes.Values)
            {
                if (remote == null || remote.Root == null || remote.Player == null || remote.Player.Dead) continue;
                if (remote.Gate != null && !remote.Gate.IsVisible) continue;
                markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.RemotePlayer,
                                                   remote.Root.transform.position));
            }
        }

        public void CollectCharacterViews(List<RoaCharacterView> views)
        {
            if (views == null) return;
            foreach (Remote remote in _remotes.Values)
                if (remote?.View != null) views.Add(remote.View);
        }

        public void CollectNameplates(List<RoaActorNameplates.Entry> rows, Vector3 origin, float maxDistance)
        {
            if (rows == null) return;
            float maxSq = maxDistance * maxDistance;
            foreach (Remote remote in _remotes.Values)
            {
                if (remote == null || remote.Root == null || remote.Player == null || remote.Player.Dead) continue;
                if (remote.Gate != null && !remote.Gate.IsVisible) continue;
                Vector3 delta = remote.Root.transform.position - origin;
                delta.y = 0f;
                if (delta.sqrMagnitude > maxSq) continue;
                rows.Add(new RoaActorNameplates.Entry
                {
                    Name = string.IsNullOrEmpty(remote.Player.Name) ? "Игрок" : remote.Player.Name,
                    Hp = remote.Player.Hp,
                    MaxHp = Mathf.Max(1, remote.Player.MaxHp),
                    World = remote.Root.transform.position + Vector3.up * 2.05f,
                    Hostile = true,
                    IsPlayer = true
                });
            }
        }
    }
}
