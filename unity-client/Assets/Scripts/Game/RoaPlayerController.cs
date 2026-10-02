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
        /// Спиной вперёд не бегут в полную силу: шаг короткий, опора — на носки.
        /// Прямо назад скорость ×0.55 (4.2 → 2.3 м/с, темп клипа run_back — 2.22 м/с,
        /// и стопы перестают скользить), вбок — полная, между ними — плавно.
        /// </summary>
        public const float BackpedalSpeedFactor = 0.55f;

        /// <summary>
        /// На таче корпус поворачивает не игрок, а прицел (AimAtWorld): стик его не
        /// разворачивает. Столько секунд после прицела взгляд считается намеренным,
        /// и ход спиной замедляется; дальше тач-игрок, пятясь, не теряет скорость.
        /// </summary>
        public const float TouchAimHoldSeconds = 1.5f;

        /// <summary>
        /// Верхом скорость задаёт транспорт (self.vehicle.speed, data/kromka/vehicles.json),
        /// а не SPECIAL. Потолок — защита от кривого пакета: сервер режет быстрее.
        /// </summary>
        public const float VehicleSpeedLimit = 16f;

        /// <summary>
        /// Управляемость по умолчанию — армейского мотоцикла; своя у каждого
        /// транспорта приходит в self.vehicle (data/kromka/vehicles.json).
        /// Разгон, м/с²: торможение в RideBrakingFactor раз резче, без газа
        /// транспорт катится и встаёт сам с замедлением RideCoastFactor от разгона.
        /// </summary>
        public const float RideAcceleration = 22f;
        public const float RideBrakingFactor = 30f / 22f;
        public const float RideCoastFactor = 5f / 22f;

        /// <summary>Задний ход медленный: мотоцикл пятится, а не едет спиной вперёд.</summary>
        public const float RideReverseSpeed = 3.5f;

        /// <summary>
        /// Разворот носа, град/с: на месте мотоцикл переставляется легко, на полном
        /// ходу пишет дугу (при 11 м/с и 120°/с радиус около 5 м). Грузовик
        /// разворачивается вдвое медленнее и пишет дугу втрое шире.
        /// </summary>
        public const float RideTurnStillDeg = 220f;
        public const float RideTurnFullDeg = 120f;

        /// <summary>Курсор ближе этого к мотоциклу (м) не поворачивает его: иначе он крутится волчком.</summary>
        public const float VehicleCursorDeadZone = 0.9f;

        [Header("Движение")]
        [Tooltip("Скорость из характеристик. Пересчитывается по авторитетному состоянию, вручную не задавать.")]
        public float Speed = DefaultSpeed;

        /// <summary>Погода комнаты: грязь замедляет шаг тем же множителем, что и бюджет шага сервера.</summary>
        public RoaWeather Weather;

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
        private float _touchAimUntil;
        private Vector3 _presentationCorrectionOffset;
        private Vector3 _presentationCorrectionVelocity;
        /// <summary>Ход мотоцикла вдоль носа, м/с: минус — задний ход.</summary>
        private float _rideSpeed;

        public bool Moving { get; private set; }

        /// <summary>Скорость, которую разрешили коллизии, м/с (её же видит сервер).</summary>
        public Vector3 Velocity { get { return _velocity; } }

        /// <summary>Игрок сидит на транспорте — так решил сервер (self.vehicle).</summary>
        public bool Mounted { get; private set; }

        /// <summary>Id транспорта под игроком; пешком — пусто.</summary>
        public string VehicleItemId { get; private set; } = string.Empty;

        /// <summary>Скорость транспорта по серверу, м/с.</summary>
        public float VehicleSpeed { get; private set; }

        /// <summary>Вид транспорта под игроком (moped, motorcycle, pickup, truck); пешком — пусто.</summary>
        public string VehicleKind { get; private set; } = string.Empty;

        // Управляемость транспорта под игроком: разгон, м/с², разворот, град/с, задний ход, м/с.
        public float VehicleAcceleration { get; private set; } = RideAcceleration;
        public float VehicleTurnStillDeg { get; private set; } = RideTurnStillDeg;
        public float VehicleTurnFullDeg { get; private set; } = RideTurnFullDeg;
        public float VehicleReverseSpeed { get; private set; } = RideReverseSpeed;

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
                _rideSpeed = 0f;
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

            // Верхом оружие убрано, а нос мотоцикла поворачивает руль — см. RideVehicle.
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
            if (!TryCursorGroundPoint(out Ray ray, out Vector3 aim)) return;

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

            // Курсор ровно на персонаже — направление неопределимо, держим прежнее.
            TurnToward(aim, TurnSpeedDeg, 0.02f);
        }

        /// <summary>
        /// Езда мотоцикла: руль поворачивает нос, газ везёт вдоль носа — боком
        /// мотоцикл не ездит. Рулит курсор, а пока зажаты A/D (стик вбок) — они;
        /// на скорости нос поворачивается медленнее, поэтому выходит дуга.
        /// steerInput: −1 влево … +1 вправо; throttleInput: +1 газ, −1 тормоз и задний ход.
        /// </summary>
        private Vector3 RideVehicle(float steerInput, float throttleInput, float dt)
        {
            float top = Mathf.Min(VehicleSpeed, VehicleSpeedLimit);
            float pace = Mathf.InverseLerp(0f, Mathf.Max(1f, top), Mathf.Abs(_rideSpeed));
            float turnRate = Mathf.Lerp(VehicleTurnStillDeg, VehicleTurnFullDeg, pace);
            if (Mathf.Abs(steerInput) > 0.05f)
                SetYaw(_yawDeg + steerInput * turnRate * dt);
            else if (PointerAimEnabled && TryCursorGroundPoint(out _, out Vector3 point))
                TurnToward(point, turnRate, VehicleCursorDeadZone);

            float target = throttleInput > 0.05f ? top : throttleInput < -0.05f ? -VehicleReverseSpeed : 0f;
            // Газ разгоняет, тормоз и смена хода — резче, отпущенный газ просто катит.
            float acceleration = VehicleAcceleration;
            float rate = Mathf.Abs(throttleInput) <= 0.05f ? acceleration * RideCoastFactor
                : (target > 0f && _rideSpeed >= 0f) || (target < 0f && _rideSpeed <= 0f)
                    ? acceleration
                    : acceleration * RideBrakingFactor;
            _rideSpeed = Mathf.MoveTowards(_rideSpeed, target, rate * dt);
            return transform.forward * _rideSpeed;
        }

        private void SetYaw(float yawDeg)
        {
            _yawDeg = Mathf.Repeat(yawDeg, 360f);
            transform.rotation = Quaternion.Euler(0f, _yawDeg, 0f);
        }

        /// <summary>
        /// Точка на земле под курсором. Разворот берётся с плоскости на высоте ног —
        /// так курсор совпадает с точкой, куда игрок смотрит на карте.
        /// </summary>
        private bool TryCursorGroundPoint(out Ray ray, out Vector3 point)
        {
            ray = default(Ray);
            point = Vector3.zero;
            UnityEngine.Camera cam = UnityEngine.Camera.main;
            if (cam == null) return false;
            ray = cam.ScreenPointToRay(Input.mousePosition);
            var groundPlane = new Plane(Vector3.up, new Vector3(0f, FeetY(), 0f));
            if (!groundPlane.Raycast(ray, out float distance)) return false;
            point = ray.GetPoint(distance);
            return true;
        }

        /// <summary>Довернуть корпус к точке; ближе deadZone метров к нему — не вертеть.</summary>
        private void TurnToward(Vector3 point, float degreesPerSecond, float deadZone)
        {
            Vector3 to = point - transform.position;
            to.y = 0f;
            if (to.sqrMagnitude < deadZone * deadZone) return;
            float targetYaw = Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg;
            _yawDeg = Mathf.MoveTowardsAngle(_yawDeg, targetYaw, degreesPerSecond * Time.deltaTime);
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
            float ground = RoaZoneReliefProjection.GroundHeightAt(transform.position.x, transform.position.z);
            if (transform.position.y > ground + standing - FallRecoveryDepth) return;
            Vector3 place = transform.position;
            place.y = ground + standing;
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
            _touchAimUntil = Time.time + TouchAimHoldSeconds;
            _yawDeg = Mathf.Atan2(delta.x, delta.z) * Mathf.Rad2Deg;
            transform.rotation = Quaternion.Euler(0f, _yawDeg, 0f);
            if (View != null)
            {
                target.y = View.AimPlaneY > 0.01f ? View.AimPlaneY : target.y;
                View.SetAim(target, true);
            }
        }

        /// <summary>
        /// Множитель пешей скорости по углу между ходом и взглядом: вперёд и вбок — 1,
        /// прямо спиной — BackpedalSpeedFactor, от бока к спине — линейно по косинусу.
        /// </summary>
        public static float BackpedalFactor(Vector3 wish, Vector3 facing)
        {
            wish.y = 0f;
            facing.y = 0f;
            if (wish.sqrMagnitude < 0.0001f || facing.sqrMagnitude < 0.0001f) return 1f;
            float along = Vector3.Dot(wish.normalized, facing.normalized);
            return Mathf.Lerp(1f, BackpedalSpeedFactor, -along);
        }

        private void ReadInputAndMove()
        {
            bool virtualActive = _virtualMove.sqrMagnitude > 0.0001f;
            bool typing = RoaPipboyCanvas.TypingInInputField();
            float x = virtualActive ? _virtualMove.x : typing ? 0f : Input.GetAxisRaw("Horizontal");
            float z = virtualActive ? _virtualMove.y : typing ? 0f : Input.GetAxisRaw("Vertical");
            // В седле не приседают: сервер тоже держит седока в полный рост.
            _crouching = !Mounted && (_virtualCrouch || (!typing &&
                (Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.C))));

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
                // Транспорт едет не как персонаж: руль поворачивает нос, газ везёт
                // вдоль носа. Ввод тот же: A/D (стик вбок) — руль, W/S — газ и тормоз.
                float yawBefore = _yawDeg;
                Quaternion rotationBefore = transform.rotation;
                requestedVelocity = RideVehicle(x, z, frameDt);
                // Корпус разворачивается вокруг заднего моста и не заходит в стену:
                // нос остаётся, куда пустило, а водитель смещается вместе с поворотом.
                _hullPivotShift = Vector3.zero;
                if (_hull.Valid)
                {
                    GuardHullTurn(yawBefore, rotationBefore);
                    requestedVelocity = transform.forward * _rideSpeed;
                }
            }
            else
            {
                bool facingHeld = PointerAimEnabled || Time.time < _touchAimUntil;
                float speed = Mathf.Min(Speed, ServerSpeedLimit) * (_crouching ? CrouchSpeedFactorValue : 1f)
                    * (facingHeld ? BackpedalFactor(wish, transform.forward) : 1f)
                    * (Weather != null ? Weather.MoveSpeedMultiplier : 1f);
                requestedVelocity = wish * speed;
            }
            _requestedVelocity = requestedVelocity;
            Vector3 before = transform.position;
            _colliding = false;
            _actorContact = false;
            _collisionNormal = Vector3.zero;
            _collisionPressure = 0f;

            Vector3 motion = requestedVelocity * frameDt;
            // За рулём путь режет корпус машины: капсула водителя внутри него не
            // заметила бы стену, в которую уже въехал капот.
            if (Mounted && _hull.Valid) motion = ResolveHullMotion(motion, _hullPivotShift);
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
                // О стену мотоцикл теряет ход, а не скребёт вдоль неё на полном газу.
                float along = Vector3.Dot(actual, transform.forward);
                if (_colliding) _rideSpeed = along;
                Moving = actual.sqrMagnitude > 0.0064f;
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
            // В седло садятся с ходу: ход вдоль носа наследует бег, спешиваются — сбрасывают.
            if (mounted && !Mounted) _rideSpeed = Mathf.Max(0f, Vector3.Dot(_velocity, transform.forward));
            if (!mounted) _rideSpeed = 0f;
            Mounted = mounted;
            VehicleItemId = mounted ? itemId : string.Empty;
            VehicleSpeed = mounted ? speed : 0f;
            VehicleKind = mounted ? RoaVehicleCatalog.Kind(itemId) : string.Empty;
            // Управляемость — из седла; пакет старого сервера без неё едет как мотоцикл.
            float Handling(string key, float fallback, float min, float max)
            {
                float value = mounted ? vehicle?[key]?.ToObject<float?>() ?? fallback : fallback;
                return Mathf.Clamp(value, min, max);
            }
            VehicleAcceleration = Handling("acceleration", RideAcceleration, 2f, 40f);
            VehicleTurnStillDeg = Handling("turnStillDeg", RideTurnStillDeg, 20f, 360f);
            VehicleTurnFullDeg = Mathf.Min(VehicleTurnStillDeg, Handling("turnFullDeg", RideTurnFullDeg, 10f, 360f));
            VehicleReverseSpeed = Handling("reverseSpeed", RideReverseSpeed, 0.5f, 8f);
            _hull = mounted ? RoaVehicleCatalog.Hull.Parse(vehicle?["hull"] as JObject) : default(RoaVehicleCatalog.Hull);
            ConfigureHullProbe();
            if (changed) MountChanged?.Invoke();
        }

        // --- Корпус транспорта ------------------------------------------------------
        // Бокс корпуса (RoaVehicleCatalog.Hull) движется вместе с игроком: протягивается
        // по пути со скольжением вдоль стен, выталкивается из того, во что уже въехал,
        // и не даёт развернуть нос в препятствие. Земля и пологие склоны (нормаль
        // вверх) корпус не останавливают — по ним едет капсула водителя.

        private const float HullSkin = 0.04f;
        private const float HullWalkableNormalY = 0.6f;
        private const float HullMaxPushPerFrame = 0.25f;
        private const int IgnoreRaycastLayer = 2;
        private static readonly float[] HullTurnFractions = { 1f, 0.5f, 0.25f };

        private RoaVehicleCatalog.Hull _hull;
        private BoxCollider _hullProbe;
        // Сдвиг водителя за кадр от поворота вокруг заднего моста.
        private Vector3 _hullPivotShift;
        private readonly RaycastHit[] _hullHits = new RaycastHit[32];
        private readonly Collider[] _hullOverlaps = new Collider[32];

        /// <summary>Корпус транспорта под игроком; пешком Valid = false.</summary>
        public RoaVehicleCatalog.Hull VehicleHull { get { return _hull; } }

        private static int HullMask { get { return Physics.DefaultRaycastLayers & ~(1 << IgnoreRaycastLayer); } }

        private void ConfigureHullProbe()
        {
            if (!_hull.Valid)
            {
                if (_hullProbe != null) _hullProbe.enabled = false;
                return;
            }
            if (_hullProbe == null)
            {
                // Только для запросов ComputePenetration: триггер на слое Ignore Raycast
                // не толкает капсулу и не попадает в обычные лучи.
                var probe = new GameObject("VehicleHullProbe") { layer = IgnoreRaycastLayer };
                probe.transform.SetParent(transform, false);
                _hullProbe = probe.AddComponent<BoxCollider>();
                _hullProbe.isTrigger = true;
            }
            _hullProbe.size = _hull.Size;
            _hullProbe.center = Vector3.zero;
            _hullProbe.enabled = true;
        }

        private Vector3 HullCenter(Vector3 position, Quaternion rotation)
        {
            Vector3 feet = position + Vector3.down * (_controller.height * 0.5f);
            return feet + rotation * _hull.LocalCenter;
        }

        private bool IsOwnHullContact(Collider other)
        {
            if (other == null || other == _controller || other == _hullProbe) return true;
            Transform hit = other.transform;
            if (hit.IsChildOf(transform)) return true;
            return View != null && hit.IsChildOf(View.transform);
        }

        /// <summary>
        /// Насколько корпус в этой позе влез в препятствия (наибольшая глубина, м);
        /// push — куда и насколько его вытолкнуть по горизонтали.
        /// </summary>
        private float HullPenetration(Vector3 position, Quaternion rotation, out Vector3 push)
        {
            push = Vector3.zero;
            if (_hullProbe == null) return 0f;
            Vector3 center = HullCenter(position, rotation);
            int count = Physics.OverlapBoxNonAlloc(center, _hull.HalfExtents, _hullOverlaps, rotation,
                HullMask, QueryTriggerInteraction.Ignore);
            float depth = 0f;
            for (int i = 0; i < count; i++)
            {
                Collider other = _hullOverlaps[i];
                if (IsOwnHullContact(other)) continue;
                if (!Physics.ComputePenetration(_hullProbe, center, rotation,
                        other, other.transform.position, other.transform.rotation,
                        out Vector3 direction, out float distance)) continue;
                // Выталкивание вверх — это земля или склон под колёсами, а не препятствие.
                if (Mathf.Abs(direction.y) > HullWalkableNormalY) continue;
                Vector3 flat = new Vector3(direction.x, 0f, direction.z);
                if (flat.sqrMagnitude < 0.000001f) continue;
                push += flat.normalized * distance;
                depth = Mathf.Max(depth, distance);
            }
            return depth;
        }

        /// <summary>Ближайшее препятствие на пути корпуса; уже задетые в начале — забота выталкивания.</summary>
        private bool CastHull(Vector3 position, Quaternion rotation, Vector3 direction, float distance, out RaycastHit best)
        {
            best = default(RaycastHit);
            int count = Physics.BoxCastNonAlloc(HullCenter(position, rotation), _hull.HalfExtents, direction,
                _hullHits, rotation, distance, HullMask, QueryTriggerInteraction.Ignore);
            bool found = false;
            for (int i = 0; i < count; i++)
            {
                RaycastHit hit = _hullHits[i];
                if (IsOwnHullContact(hit.collider)) continue;
                if (hit.distance <= 0f && hit.point == Vector3.zero) continue;
                if (hit.normal.y > HullWalkableNormalY) continue;
                if (Vector3.Dot(hit.normal, direction) >= 0f) continue;
                if (found && hit.distance >= best.distance) continue;
                best = hit;
                found = true;
            }
            return found;
        }

        /// <summary>
        /// Путь корпуса за кадр по горизонтали: сдвиг от поворота вокруг заднего
        /// моста (его поза уже проверена в GuardHullTurn), затем выйти из того, во
        /// что влез, и ехать до препятствия, скользя вдоль него (до трёх касаний).
        /// </summary>
        private Vector3 ResolveHullMotion(Vector3 planar, Vector3 pivotShift)
        {
            planar.y = 0f;
            Vector3 position = transform.position + pivotShift;
            Quaternion rotation = transform.rotation;
            float depthBefore = HullPenetration(position, rotation, out Vector3 push);
            // Касание — ещё не пересечение: иначе кузов, упёртый рулём в стену, отползал
            // бы от неё по паре миллиметров за кадр и так проворачивался бы дальше.
            push = depthBefore > HullContactDepth * 2f ? Vector3.ClampMagnitude(push, HullMaxPushPerFrame) : Vector3.zero;

            Vector3 moved = Vector3.zero;
            Vector3 remaining = planar;
            for (int i = 0; i < 3 && remaining.sqrMagnitude > 0.00000001f; i++)
            {
                float distance = remaining.magnitude;
                Vector3 direction = remaining / distance;
                if (!CastHull(position + push + moved, rotation, direction, distance + HullSkin, out RaycastHit hit))
                {
                    moved += remaining;
                    break;
                }
                float step = Mathf.Max(0f, hit.distance - HullSkin);
                moved += direction * step;
                Vector3 normal = new Vector3(hit.normal.x, 0f, hit.normal.z).normalized;
                _colliding = true;
                _collisionNormal = normal;
                _collisionPressure = Mathf.Max(_collisionPressure, -Vector3.Dot(direction, normal));
                Vector3 rest = remaining - direction * step;
                remaining = rest - normal * Vector3.Dot(rest, normal);
            }

            // То, во что корпус уже влез, луч не видит: глубже в него не пускаем.
            if (depthBefore > HullContactDepth || push.sqrMagnitude > 0f)
            {
                float depthAfter = HullPenetration(position + push + moved, rotation, out _);
                if (!HullDepthAllowed(depthBefore, depthAfter))
                {
                    moved = Vector3.zero;
                    _colliding = true;
                }
            }
            return pivotShift + push + moved;
        }

        /// <summary>Касание: на столько корпус может «лечь» на препятствие, м.</summary>
        private const float HullContactDepth = 0.002f;

        /// <summary>
        /// Новая поза годится, если корпус в ней свободен (только касание) или
        /// выходит из препятствия. Сравнение с допуском «чуть глубже» не годится:
        /// на частых кадрах кузов вползал бы в стену по долям миллиметра.
        /// </summary>
        private static bool HullDepthAllowed(float depthBefore, float depthAfter)
        {
            return depthAfter <= HullContactDepth || depthAfter < depthBefore - 0.0001f;
        }

        /// <summary>
        /// Куда сдвинуть водителя, чтобы при повороте с from на to ось поворота
        /// (задний мост) осталась на месте. Только по горизонтали.
        /// </summary>
        private Vector3 HullPivotShift(Quaternion from, Quaternion to)
        {
            Vector3 shift = from * _hull.LocalPivot - to * _hull.LocalPivot;
            shift.y = 0f;
            return shift;
        }

        /// <summary>
        /// Поворот, который вдавил бы корпус в препятствие, режется: пробуем весь
        /// шаг, половину и четверть, иначе нос остаётся прежним. Поза проверяется
        /// вместе со сдвигом водителя вокруг заднего моста. true — поворот урезан.
        /// </summary>
        private bool GuardHullTurn(float yawBefore, Quaternion rotationBefore)
        {
            // Сравниваем сами углы: Quaternion.Angle обнуляет повороты меньше ~0,16°,
            // а на частых кадрах поворот за кадр как раз такой.
            if (Mathf.Abs(Mathf.DeltaAngle(yawBefore, _yawDeg)) < 0.00001f) return false;
            Vector3 position = transform.position;
            float depthBefore = HullPenetration(position, rotationBefore, out _);
            float targetYaw = _yawDeg;
            foreach (float fraction in HullTurnFractions)
            {
                float yaw = Mathf.LerpAngle(yawBefore, targetYaw, fraction);
                Quaternion rotation = Quaternion.Euler(0f, yaw, 0f);
                Vector3 shift = HullPivotShift(rotationBefore, rotation);
                if (!HullDepthAllowed(depthBefore, HullPenetration(position + shift, rotation, out _))) continue;
                _hullPivotShift = shift;
                if (fraction >= 1f) return false;
                SetYaw(yaw);
                return true;
            }
            SetYaw(yawBefore);
            return true;
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
            if (_controller == null) _controller = GetComponent<CharacterController>();
            corrected.y += reason == "movementCorrection"
                ? transform.position.y - RoaZoneReliefProjection.GroundHeightAt(transform.position.x, transform.position.z)
                : (_controller != null ? _controller.height * 0.5f : 0.9f) + 0.1f;

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
                    candidate.y += RoaZoneReliefProjection.GroundHeightAt(candidate.x, candidate.z)
                        - RoaZoneReliefProjection.GroundHeightAt(requested.x, requested.z);
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
            _rideSpeed = 0f;
            _presentationCorrectionOffset = Vector3.zero;
            _presentationCorrectionVelocity = Vector3.zero;
            if (PresentationRoot != null) PresentationRoot.localPosition = Vector3.zero;
            Audio?.StopLocomotion();

            if (Camera != null) Camera.SnapToTarget();
        }
    }
}
