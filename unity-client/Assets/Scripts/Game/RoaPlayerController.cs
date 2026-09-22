using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Локальный игрок: ввод, предсказание движения и отправка состояния серверу.
    ///
    /// Управление повторяет web-клиент: персонаж смотрит на курсор, а ходит
    /// независимо от взгляда — WASD относительно камеры. Именно поэтому нужны
    /// клипы заднего хода и стрейфа: направление движения не совпадает со взглядом.
    /// Угол прицела считается так же, как в 06c_combat_stats_modes.js:148 —
    /// atan2(цель − игрок) по горизонтали.
    ///
    /// Сервер авторитетен. Клиент двигает персонажа сразу, чтобы управление не
    /// «плавало» на задержке, но серверная поправка (authoritativePlayerState
    /// с reason = "movementCorrection") всегда побеждает.
    ///
    /// Скорость обязана укладываться в серверный бюджет: server.js:7491 проверяет
    /// расстояние как PLAYER_SPEED * elapsed * 1.35 + 0.22, PLAYER_SPEED = 7.0.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public sealed class RoaPlayerController : MonoBehaviour
    {
        /// <summary>
        /// Потолок валидации на сервере (PLAYER_SPEED, server.js:144). Это НЕ скорость
        /// ходьбы: сервер лишь отвергает перемещение быстрее этого значения с запасом
        /// ×1.35. Фактическая скорость персонажа считается из SPECIAL — см. Speed.
        /// </summary>
        public const float ServerSpeedLimit = 7f;

        /// <summary>
        /// Авторитетный радиус игрока при проверке рельефа, статических объектов
        /// и живых актёров. Локальная капсула обязана иметь тот же радиус, иначе
        /// Unity пропускает игрока в позиции, которые сервер уже считает занятыми.
        /// </summary>
        public const float AuthoritativeCollisionRadius = 0.48f;

        /// <summary>
        /// Maximum local correction used only when an authoritative arrival point
        /// overlaps authored Unity geometry. The corrected position is sent back
        /// through the normal server-authoritative movement channel on the next frame.
        /// </summary>
        public const float SafeSpawnSearchRadius = 8f;

        public const float SafeSpawnSearchStep = 0.65f;

        /// <summary>
        /// На сколько метров ниже пола тело считается провалившимся. Пол локации
        /// плоский, и дыра в нём означала бы бесконечное падение.
        /// </summary>
        private const float FallRecoveryDepth = 3f;

        /// <summary>
        /// The physics root accepts an authoritative correction immediately. The
        /// visible character keeps its previous world position and closes this
        /// presentation offset smoothly, so networking stays authoritative without
        /// a visible teleport.
        /// </summary>
        public const float PositionReconciliationSmoothTime = 0.18f;
        public const float PositionReconciliationMaxSpeed = 18f;
        private const float PositionReconciliationStopDistance = 0.015f;

        /// <summary>
        /// Скорость персонажа по умолчанию, пока не пришли SPECIAL
        /// (04_player_model_visuals.js:18).
        /// </summary>
        public const float DefaultSpeed = 4.2f;

        /// <summary>Множитель приседа. 09_update_fog_movement_ai.js:1284.</summary>
        public const float CrouchSpeedFactorValue = 0.62f;

        /// <summary>
        /// Верхом скорость задаёт транспорт (self.vehicle.speed, data/kromka/vehicles.json),
        /// а не SPECIAL. Потолок — защита от кривого пакета: сервер режет быстрее.
        /// </summary>
        public const float VehicleSpeedLimit = 16f;

        /// <summary>Разгон и торможение седока, м/с². Ход остаётся игроцким, но у мотоцикла есть инерция.</summary>
        public const float RideAcceleration = 22f;
        public const float RideBraking = 30f;

        /// <summary>Как быстро транспорт разворачивается по ходу, град/с.</summary>
        public const float RideTurnSpeedDeg = 520f;

        [Header("Движение")]
        [Tooltip("Скорость из характеристик. Пересчитывается по авторитетному состоянию, вручную не задавать.")]
        public float Speed = DefaultSpeed;

        [Tooltip("Скорость доворота корпуса к прицелу, град/с.")]
        public float TurnSpeedDeg = 900f;

        [Tooltip("Скорость сглаживания визуальной локомоции при разгоне, м/с².")]
        public float VisualAcceleration = 26f;

        [Tooltip("Скорость возврата анимации в стойку, м/с².")]
        public float VisualDeceleration = 34f;

        [Header("Связи")]
        public RoaSocketClient Socket;
        public RoaCameraRig Camera;
        public RoaCharacterView View;
        public RoaAudio Audio;
        public RoaPipboy Pipboy;
        public RoaInventory Inventory;
        public Transform PresentationRoot;

        public bool InputEnabled = true;

        private CharacterController _controller;
        private Vector3 _velocity;
        private Vector3 _visualVelocity;
        private Vector3 _collisionNormal;
        private Vector3 _requestedVelocity;
        private float _collisionPressure;
        private bool _colliding;
        private bool _actorContact;
        private float _yawDeg;
        private bool _crouching;
        private float _baseSpeed = DefaultSpeed;
        private Vector2 _virtualMove;
        private bool _virtualCrouch;
        private Vector3 _presentationCorrectionOffset;
        private Vector3 _presentationCorrectionVelocity;
        private Vector3 _rideVelocity;

        public bool Moving { get; private set; }

        /// <summary>Скорость, которую разрешили коллизии, м/с (её же видит сервер).</summary>
        public Vector3 Velocity { get { return _velocity; } }

        /// <summary>Игрок сидит на транспорте — так решил сервер (self.vehicle).</summary>
        public bool Mounted { get; private set; }

        /// <summary>Id транспорта под игроком; пешком — пусто.</summary>
        public string VehicleItemId { get; private set; } = string.Empty;

        /// <summary>Скорость транспорта по серверу, м/с.</summary>
        public float VehicleSpeed { get; private set; }

        /// <summary>Сменилось «верхом/пешком» или сам транспорт.</summary>
        public event System.Action MountChanged;

        public bool Colliding { get { return _colliding; } }
        public Vector3 CollisionNormal { get { return _collisionNormal; } }
        public float CollisionPressure { get { return _collisionPressure; } }
        public bool ActorContact { get { return _actorContact; } }

        /// <summary>Touch UI disables cursor aiming and supplies an explicit target.</summary>
        public bool PointerAimEnabled { get; private set; } = true;

        /// <summary>Присед. Нужен не только скорости: он режет радиус обзора и меняет позу.</summary>
        public bool Crouching { get { return _crouching; } }

        /// <summary>Восприятие из авторитетных SPECIAL. Задаёт радиус тумана войны.</summary>
        public int Perception { get; private set; } = 5;

        /// <summary>Ранг перка «Бдительность»: +1 тайл обзора за уровень.</summary>
        public int Vigilance { get; private set; }

        /// <summary>Авторитетные травмы, влияющие на локальное движение и обзор.</summary>
        public bool HasBrokenArm { get; private set; }
        public bool HasBrokenLeg { get; private set; }
        public bool HasConcussion { get; private set; }
        public bool HasInfection { get; private set; }
        public bool Downed { get; private set; }

        private void Awake()
        {
            _controller = GetComponent<CharacterController>();
            ConfigureAuthoritativeCollision(_controller);
            _controller.enableOverlapRecovery = true;
            _yawDeg = transform.eulerAngles.y;
        }

        /// <summary>
        /// Настраивает локальную капсулу по тем же размерам, которые сервер
        /// использует при авторитетной проверке перемещения.
        /// </summary>
        public static void ConfigureAuthoritativeCollision(CharacterController controller)
        {
            if (controller == null) return;

            controller.radius = AuthoritativeCollisionRadius;
            controller.slopeLimit = 50f;
            controller.stepOffset = Mathf.Clamp(controller.height * 0.14f, 0.18f, 0.28f);
            controller.skinWidth = Mathf.Clamp(controller.radius * 0.16f, 0.045f, 0.075f);
            controller.minMoveDistance = 0f;
            controller.detectCollisions = true;
            controller.enableOverlapRecovery = true;
        }

        private void OnEnable()
        {
            if (Socket != null) Socket.OnAuthoritativeSelf += ApplyAuthoritativeState;
        }

        private void OnDisable()
        {
            if (Socket != null) Socket.OnAuthoritativeSelf -= ApplyAuthoritativeState;
            Audio?.StopLocomotion();
        }

        private void Update()
        {
            // BlocksWorldHud закрывает и канву ПУТНИКа: раньше гейт смотрел только на
            // старые IMGUI-панели, поэтому «wasd» в поле имени клана уводил персонажа.
            if (!InputEnabled || Downed || Time.unscaledTime < _artifactStunUntil
                || RoaGameBootstrap.BlocksWorldHud
                || (Pipboy != null && Pipboy.IsOpen) || (Inventory != null && Inventory.IsOpen))
            {
                _velocity = Vector3.zero;
                _visualVelocity = Vector3.zero;
                _requestedVelocity = Vector3.zero;
                _rideVelocity = Vector3.zero;
                _colliding = false;
                _actorContact = false;
                _collisionNormal = Vector3.zero;
                _collisionPressure = 0f;
                Moving = false;
                Audio?.StopLocomotion();
                UpdatePresentationReconciliation();
                if (View != null) View.UpdateLocomotion(_visualVelocity, _yawDeg, false, _crouching);
                if (Socket != null)
                    Socket.SendState(transform.position, _yawDeg, _velocity, false, _crouching, false);
                return;
            }

            // Верхом корпус смотрит по ходу транспорта, а не на курсор.
            if (Mounted) View?.SetAim(transform.position, false);
            else if (PointerAimEnabled) AimAtCursor();
            ReadInputAndMove();
            UpdatePresentationReconciliation();
            Vector3 footPosition = transform.position;
            footPosition.y = FeetY() + 0.025f;
            if (Mounted) Audio?.StopLocomotion();
            else Audio?.SetLocomotion(_visualVelocity, footPosition, _controller.isGrounded, _crouching, Moving);

            if (View != null)
                View.UpdateLocomotion(_visualVelocity, _yawDeg, Moving, _crouching,
                    _collisionNormal, _collisionPressure);

            // turning — часть протокола: сервер ретранслирует его другим клиентам,
            // чтобы у них персонаж тоже переступал, а не проворачивался на месте.
            bool turning = View != null && View.Turning;

            if (Socket != null)
                Socket.SendState(transform.position, _yawDeg, _velocity, Moving, _crouching, turning);
        }

        public void SendStateImmediately()
        {
            bool turning = View != null && View.Turning;
            Socket?.SendStateImmediately(transform.position, _yawDeg, _velocity,
                Moving, _crouching, turning);
        }

        /// <summary>
        /// Направить персонажа на курсор. Луч камеры пересекается с горизонтальной
        /// плоскостью на высоте ног: цель прицела — точка на земле, а не в воздухе.
        /// </summary>
        private void AimAtCursor()
        {
            UnityEngine.Camera cam = UnityEngine.Camera.main;
            if (cam == null) return;

            Ray ray = cam.ScreenPointToRay(Input.mousePosition);

            // Разворот персонажа берётся с земли — так курсор совпадает с точкой,
            // куда игрок смотрит на карте.
            var groundPlane = new Plane(Vector3.up, new Vector3(0f, FeetY(), 0f));

            float distance;
            if (!groundPlane.Raycast(ray, out distance)) return;

            Vector3 aim = ray.GetPoint(distance);

            // А оружию нужна точка на ВЫСОТЕ СТВОЛА: у наклонной камеры проекции
            // одного и того же курсора на землю и на высоту груди расходятся
            // почти на метр, и ствол доворачивало бы на десятки градусов,
            // выкручиваясь из кисти (04d:1222).
            if (View != null)
            {
                float planeY = View.AimPlaneY;
                Vector3 weaponAim = aim;

                if (planeY > 0.01f)
                {
                    var barrelPlane = new Plane(Vector3.up, new Vector3(0f, planeY, 0f));
                    float barrelDistance;
                    if (barrelPlane.Raycast(ray, out barrelDistance))
                        weaponAim = ray.GetPoint(barrelDistance);
                }

                View.SetAim(weaponAim, true);
            }

            Vector3 toAim = aim - transform.position;
            toAim.y = 0f;

            // Курсор ровно на персонаже — направление неопределимо, держим прежнее.
            if (toAim.sqrMagnitude < 0.0004f) return;

            float targetYaw = Mathf.Atan2(toAim.x, toAim.z) * Mathf.Rad2Deg;
            _yawDeg = Mathf.MoveTowardsAngle(_yawDeg, targetYaw, TurnSpeedDeg * Time.deltaTime);
            transform.rotation = Quaternion.Euler(0f, _yawDeg, 0f);
        }

        /// <summary>
        /// Возвращает провалившееся тело на поверхность. Серверная поправка правит
        /// только плоскость — высоту она берёт с текущей, — поэтому без этого
        /// падение сквозь дыру в полу было бы уже не остановить.
        /// </summary>
        private void RecoverFromFall()
        {
            float standing = _controller.height * 0.5f;
            if (transform.position.y > standing - FallRecoveryDepth) return;
            Vector3 place = transform.position;
            place.y = standing;
            TeleportToSafeSpawn(place);
            Debug.LogWarning("[ROA] Тело ушло под пол локации — возвращено на поверхность.");
        }

        private float FeetY()
        {
            return transform.position.y - _controller.height * 0.5f;
        }

        public void SetVirtualMove(Vector2 movement)
        {
            _virtualMove = Vector2.ClampMagnitude(movement, 1f);
        }

        public void SetVirtualCrouch(bool crouching)
        {
            _virtualCrouch = crouching;
        }

        public void SetPointerAimEnabled(bool enabled)
        {
            PointerAimEnabled = enabled;
        }

        /// <summary>Face a world target supplied by the mobile auto-target UI.</summary>
        public void AimAtWorld(Vector3 target)
        {
            // Верхом корпус смотрит по ходу: автоприцел не разворачивает мотоцикл.
            if (Mounted) return;
            Vector3 delta = target - transform.position;
            delta.y = 0f;
            if (delta.sqrMagnitude < 0.0004f) return;
            _yawDeg = Mathf.Atan2(delta.x, delta.z) * Mathf.Rad2Deg;
            transform.rotation = Quaternion.Euler(0f, _yawDeg, 0f);
            if (View != null)
            {
                target.y = View.AimPlaneY > 0.01f ? View.AimPlaneY : target.y;
                View.SetAim(target, true);
            }
        }

        private void ReadInputAndMove()
        {
            bool virtualActive = _virtualMove.sqrMagnitude > 0.0001f;
            float x = virtualActive ? _virtualMove.x : Input.GetAxisRaw("Horizontal");
            float z = virtualActive ? _virtualMove.y : Input.GetAxisRaw("Vertical");
            // В седле не приседают: сервер тоже держит седока в полный рост.
            _crouching = !Mounted && (_virtualCrouch || Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.C));

            Vector3 wish = Camera != null
                ? Camera.PlanarRight() * x + Camera.PlanarForward() * z
                : new Vector3(x, 0f, z);

            // Диагональ не должна давать преимущество в скорости, иначе сервер
            // начнёт резать позицию по бюджету расстояния.
            if (wish.sqrMagnitude > 1f) wish.Normalize();

            bool requestedMovement = wish.sqrMagnitude > 0.0001f;
            float frameDt = Mathf.Max(0.001f, Time.deltaTime);

            Vector3 requestedVelocity;
            if (Mounted)
            {
                // Тот же ввод, что пешком (WASD относительно камеры), но транспорт
                // разгоняется и тормозит, а не меняет скорость мгновенно.
                Vector3 rideTarget = wish * Mathf.Min(VehicleSpeed, VehicleSpeedLimit);
                float rate = rideTarget.sqrMagnitude >= _rideVelocity.sqrMagnitude ? RideAcceleration : RideBraking;
                _rideVelocity = Vector3.MoveTowards(_rideVelocity, rideTarget, rate * frameDt);
                requestedVelocity = _rideVelocity;
            }
            else
            {
                float speed = Mathf.Min(Speed, ServerSpeedLimit) * (_crouching ? CrouchSpeedFactorValue : 1f);
                requestedVelocity = wish * speed;
            }
            _requestedVelocity = requestedVelocity;
            Vector3 before = transform.position;
            _colliding = false;
            _actorContact = false;
            _collisionNormal = Vector3.zero;
            _collisionPressure = 0f;

            Vector3 motion = requestedVelocity * frameDt;
            motion.y = _controller.isGrounded ? -0.05f : -9.81f * frameDt;
            _controller.Move(motion);
            RecoverFromFall();

            // Animation and the network see the displacement that collisions
            // actually allowed. This prevents running in place against walls and
            // keeps stride sync correct while the controller slides along cover.
            Vector3 actual = (transform.position - before) / frameDt;
            actual.y = 0f;
            _velocity = actual;

            if (Mounted)
            {
                // Транспорт катится и без нажатия, пока не остановится; о стену он
                // теряет ход, а не копит его.
                Moving = actual.sqrMagnitude > 0.0064f;
                if (_colliding) _rideVelocity = actual;
                Vector3 heading = actual.sqrMagnitude > 0.16f ? actual : (requestedMovement ? wish : Vector3.zero);
                if (heading.sqrMagnitude > 0.0001f)
                {
                    float targetYaw = Mathf.Atan2(heading.x, heading.z) * Mathf.Rad2Deg;
                    _yawDeg = Mathf.MoveTowardsAngle(_yawDeg, targetYaw, RideTurnSpeedDeg * frameDt);
                    transform.rotation = Quaternion.Euler(0f, _yawDeg, 0f);
                }
                _visualVelocity = actual;
                return;
            }

            Moving = requestedMovement && actual.sqrMagnitude > 0.0064f;

            Vector3 presentationVelocity = RoaLocomotionPresentation.ResolveCollisionVelocity(
                requestedVelocity, actual, _colliding, _collisionNormal);
            _visualVelocity = RoaLocomotionPresentation.SmoothVisualVelocity(
                _visualVelocity, presentationVelocity,
                VisualAcceleration, VisualDeceleration, frameDt);
        }

        /// <summary>
        /// Состояние седла из сервера: self.vehicle или событие playerVehicle.
        /// null — пешком. Скорость транспорта приходит оттуда же.
        /// </summary>
        public void ApplyVehicleState(JObject vehicle)
        {
            string itemId = vehicle?["itemId"]?.ToString() ?? string.Empty;
            float speed = vehicle?["speed"]?.ToObject<float?>() ?? 0f;
            bool mounted = !string.IsNullOrEmpty(itemId) && speed > 0f;
            bool changed = mounted != Mounted || (mounted && itemId != VehicleItemId);
            if (mounted && !Mounted) _rideVelocity = _velocity;
            if (!mounted) _rideVelocity = Vector3.zero;
            Mounted = mounted;
            VehicleItemId = mounted ? itemId : string.Empty;
            VehicleSpeed = mounted ? speed : 0f;
            if (changed) MountChanged?.Invoke();
        }

        /// <summary>
        /// Применить авторитетное состояние. Позицию трогаем только когда сервер
        /// прямо об этом просит: обычная сверка сохраняет локальную позицию, иначе
        /// персонаж будет дёргаться на каждом снимке (docs/wiki/SOCKET_EVENTS.md).
        /// </summary>
        /// <summary>
        /// Пересчитать скорость из авторитетных SPECIAL.
        /// Формула web-клиента: derivedFromStats(), 08_character_creation_save.js:96.
        /// Поверх базового значения применяются бонус надетых ботинок и авторитетные
        /// штрафы травм — те же speedBonus()/injurySpeedMultiplier(), что в web.
        /// </summary>
        private float _artifactStunUntil;
        private bool _speedLogged;

        public void ApplySpecial(JObject self)
        {
            if (self == null) return;
            if (self["artifactRuntime"] is JObject runtime)
                _artifactStunUntil = Time.unscaledTime + Mathf.Max(0f, runtime["stunSeconds"]?.Value<float>() ?? 0f);

            bool downed = self.Value<bool?>("downed") == true;
            if (Downed != downed)
            {
                Downed = downed;
                if (View != null) View.SetDead(Downed);
            }

            // Поле есть в каждом полном состоянии: null — пешком. Частичные пакеты
            // без поля седло не трогают.
            if (self.TryGetValue("vehicle", out JToken vehicleToken)) ApplyVehicleState(vehicleToken as JObject);

            JObject special = self["special"] as JObject;
            var ranks = self["talentRanks"] as JObject;
            int previousPerception = Perception;
            int previousVigilance = Vigilance;

            // Восприятие с бонусом перка specialPer, как в clientStatValueWithTalentRanks()
            // (04_player_model_visuals.js:397). Радиус обзора считает уже туман.
            JToken perToken = special?["per"];
            if (perToken != null)
            {
                Perception = Mathf.Clamp(
                    Mathf.RoundToInt(perToken.ToObject<float>()) + TalentRank(ranks, "specialPer"), 1, 15);
                Vigilance = Mathf.Clamp(TalentRank(ranks, "vigilance"), 0, 2);
            }

            float agi = 0f;
            bool bruiser = false;
            JToken agiToken = special?["agi"];
            if (agiToken != null)
            {
                agi = Mathf.Clamp(
                    agiToken.ToObject<float>() + TalentRank(ranks, "specialAgi"), 1f, 15f);

                if (self["traits"] is JArray traits)
                {
                    foreach (JToken t in traits)
                        if (t != null && t.ToString() == "bruiser") bruiser = true;
                }

                _baseSpeed = 4.35f + agi * 0.13f - (bruiser ? 0.18f : 0f);
            }

            JObject injuries = self["injuries"] as JObject;
            HasBrokenArm = HasInjury(injuries, "brokenArm");
            HasBrokenLeg = HasInjury(injuries, "brokenLeg");
            HasConcussion = HasInjury(injuries, "concussion");
            HasInfection = HasInjury(injuries, "infection");

            JObject equipment = self["equipmentRuntime"] as JObject
                ?? self["equipment"] as JObject;
            float bootBonus = BootSpeedBonus(BaseItemId(equipment?["boots"]?.ToString()));
            float injuryMultiplier = (HasBrokenLeg ? 0.68f : 1f) * (HasInfection ? 0.92f : 1f);
            float artifactSpeedMultiplier = 1f + Mathf.Clamp(
                self["artifactEffects"]?["speedPct"]?.ToObject<float>() ?? 0f, -0.45f, 0.18f);
            float previousSpeed = Speed;
            Speed = (_baseSpeed + bootBonus) * injuryMultiplier * artifactSpeedMultiplier;

            if (View != null) View.SetInjuries(injuries);

            // Сверка приходит с каждым серверным снимком: пишем только первый
            // расчёт и настоящие изменения, иначе лог забивается одной строкой.
            if (!_speedLogged || Mathf.Abs(previousSpeed - Speed) > 0.001f
                || Perception != previousPerception || Vigilance != previousVigilance)
            {
                _speedLogged = true;
                Debug.Log("[ROA] Скорость: база " + _baseSpeed.ToString("0.00")
                    + (bootBonus > 0f ? " + обувь " + bootBonus.ToString("0.00") : "")
                    + (injuryMultiplier < 1f ? " × травмы " + injuryMultiplier.ToString("0.000") : "")
                    + " = " + Speed.ToString("0.00") + "; восприятие " + Perception
                    + (Vigilance > 0 ? " + бдительность " + Vigilance : ""));
            }
        }

        private static bool HasInjury(JObject injuries, string id)
        {
            return injuries?[id]?.ToObject<bool>() == true;
        }

        private static float BootSpeedBonus(string id)
        {
            if (id == "boots") return 0.22f;
            if (id == "scoutBoots") return 0.34f;
            if (id == "assaultBoots") return 0.12f;
            if (id == "reinforcedBoots") return 0.14f;
            return 0f;
        }

        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId;
            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        /// <summary>Ранг перка. clientTalentRankFrom(), 04:389.</summary>
        private static int TalentRank(JObject ranks, string id)
        {
            if (ranks == null) return 0;

            JToken value = ranks[id];
            if (value == null) return 0;

            return Mathf.Max(0, Mathf.FloorToInt(value.ToObject<float>()));
        }

        private void ApplyAuthoritativeState(JObject payload)
        {
            ApplySpecial(payload["self"] as JObject ?? payload);

            string reason = payload["reason"]?.ToString() ?? string.Empty;
            bool positional = reason == "movementCorrection" || reason == "locationChange" || reason == "respawn";
            if (!positional) return;

            JToken xToken = payload["x"];
            JToken zToken = payload["z"];
            if (xToken == null || zToken == null) return;

            Vector3 corrected = RoaCoords.ToUnity(xToken.ToObject<float>(), zToken.ToObject<float>());
            corrected.y = transform.position.y;

            if (reason == "movementCorrection")
            {
                ApplyAuthoritativePositionCorrection(corrected);
                return;
            }

            TeleportToSafeSpawn(corrected);
            Debug.Log("[ROA] Серверная поправка позиции: " + reason);
        }

        /// <summary>
        /// Moves the collision/network root to the server position immediately,
        /// while counter-moving the presentation root. Gameplay remains in sync;
        /// only the visible correction is spread over subsequent frames.
        /// </summary>
        private void ApplyAuthoritativePositionCorrection(Vector3 corrected)
        {
            Vector3 rootDelta = corrected - transform.position;
            rootDelta.y = 0f;
            if (rootDelta.sqrMagnitude < 0.000001f) return;

            Vector3 currentOffset = PresentationRoot != null
                ? PresentationRoot.position - transform.position
                : _presentationCorrectionOffset;
            currentOffset.y = 0f;
            Vector3 nextOffset = CompensatePresentationOffset(currentOffset, rootDelta);
            if (Vector3.Dot(currentOffset, nextOffset) < 0f)
                _presentationCorrectionVelocity = Vector3.zero;
            _presentationCorrectionOffset = nextOffset;

            if (_controller == null) _controller = GetComponent<CharacterController>();
            if (_controller != null)
            {
                bool wasEnabled = _controller.enabled;
                _controller.enabled = false;
                transform.position = corrected;
                Physics.SyncTransforms();
                _controller.enabled = wasEnabled;
            }
            else
            {
                transform.position = corrected;
            }

            if (PresentationRoot != null)
                PresentationRoot.position = transform.position + _presentationCorrectionOffset;
            Camera?.PreservePresentationAfterTargetCorrection(rootDelta);
        }

        public static Vector3 CompensatePresentationOffset(Vector3 currentOffset,
                                                           Vector3 authoritativeDelta)
        {
            currentOffset.y = 0f;
            authoritativeDelta.y = 0f;
            return currentOffset - authoritativeDelta;
        }

        public static Vector3 SmoothPresentationOffset(Vector3 currentOffset,
                                                       ref Vector3 velocity,
                                                       float deltaTime)
        {
            currentOffset.y = 0f;
            velocity.y = 0f;
            if (currentOffset.sqrMagnitude
                <= PositionReconciliationStopDistance * PositionReconciliationStopDistance)
            {
                velocity = Vector3.zero;
                return Vector3.zero;
            }

            if (deltaTime <= 0f) return currentOffset;
            Vector3 next = Vector3.SmoothDamp(currentOffset, Vector3.zero, ref velocity,
                PositionReconciliationSmoothTime, PositionReconciliationMaxSpeed, deltaTime);
            next.y = 0f;
            return next;
        }

        private void UpdatePresentationReconciliation()
        {
            if (PresentationRoot == null) return;

            _presentationCorrectionOffset = SmoothPresentationOffset(
                _presentationCorrectionOffset, ref _presentationCorrectionVelocity,
                Time.unscaledDeltaTime);
            PresentationRoot.position = transform.position + _presentationCorrectionOffset;
        }

        /// <summary>
        /// Deterministic nearest-point search shared by runtime placement and the
        /// editor probe. The requested point wins whenever it is already free.
        /// </summary>
        public static Vector3 FindSafeSpawnPosition(Vector3 requested,
                                                    System.Func<Vector3, bool> blocked)
        {
            if (blocked == null || !blocked(requested)) return requested;

            Vector2 towardCenter = new Vector2(-requested.x, -requested.z);
            float startAngle = towardCenter.sqrMagnitude > 0.001f
                ? Mathf.Atan2(towardCenter.y, towardCenter.x)
                : 0f;

            for (float radius = SafeSpawnSearchStep;
                 radius <= SafeSpawnSearchRadius + 0.001f;
                 radius += SafeSpawnSearchStep)
            {
                int samples = Mathf.Max(8, Mathf.CeilToInt(
                    Mathf.PI * 2f * radius / SafeSpawnSearchStep));
                for (int index = 0; index < samples; index++)
                {
                    float angle = startAngle + index * Mathf.PI * 2f / samples;
                    Vector3 candidate = requested + new Vector3(
                        Mathf.Cos(angle) * radius, 0f, Mathf.Sin(angle) * radius);
                    if (!blocked(candidate)) return candidate;
                }
            }

            return requested;
        }

        /// <summary>
        /// Places a newly created, respawned or transferred character outside any
        /// authored collider. Returns true when the requested point was adjusted.
        /// </summary>
        public bool TeleportToSafeSpawn(Vector3 position)
        {
            if (_controller == null) _controller = GetComponent<CharacterController>();
            if (_controller == null)
            {
                transform.position = position;
                ResetTeleportMotion();
                return false;
            }

            bool wasEnabled = _controller.enabled;
            _controller.enabled = false;
            Physics.SyncTransforms();
            Vector3 resolved = FindSafeSpawnPosition(position, SpawnCapsuleBlocked);
            transform.position = resolved;
            Physics.SyncTransforms();
            _controller.enabled = wasEnabled;
            ResetTeleportMotion();
            return (resolved - position).sqrMagnitude > 0.0025f;
        }

        private bool SpawnCapsuleBlocked(Vector3 position)
        {
            float radius = Mathf.Max(0.05f, _controller.radius * 0.92f);
            float halfSegment = Mathf.Max(0f, _controller.height * 0.5f - _controller.radius);
            Vector3 center = position + _controller.center;
            return Physics.CheckCapsule(center - Vector3.up * halfSegment,
                center + Vector3.up * halfSegment, radius,
                Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
        }

        public void Teleport(Vector3 position)
        {
            if (_controller == null) _controller = GetComponent<CharacterController>();
            if (_controller == null)
            {
                transform.position = position;
                ResetTeleportMotion();
                return;
            }
            _controller.enabled = false;
            transform.position = position;
            _controller.enabled = true;
            ResetTeleportMotion();
        }

        private void ResetTeleportMotion()
        {
            _velocity = Vector3.zero;
            _visualVelocity = Vector3.zero;
            _colliding = false;
            _actorContact = false;
            _collisionNormal = Vector3.zero;
            _collisionPressure = 0f;
            _requestedVelocity = Vector3.zero;
            _rideVelocity = Vector3.zero;
            _presentationCorrectionOffset = Vector3.zero;
            _presentationCorrectionVelocity = Vector3.zero;
            if (PresentationRoot != null) PresentationRoot.localPosition = Vector3.zero;
            Audio?.StopLocomotion();

            if (Camera != null) Camera.SnapToTarget();
        }
    }
}
