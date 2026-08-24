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
        /// Скорость персонажа по умолчанию, пока не пришли SPECIAL
        /// (04_player_model_visuals.js:18).
        /// </summary>
        public const float DefaultSpeed = 4.2f;

        /// <summary>Множитель приседа. 09_update_fog_movement_ai.js:1284.</summary>
        public const float CrouchSpeedFactorValue = 0.62f;

        [Header("Движение")]
        [Tooltip("Скорость из SPECIAL. Пересчитывается по авторитетному состоянию, вручную не задавать.")]
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

        public bool InputEnabled = true;

        private CharacterController _controller;
        private Vector3 _velocity;
        private Vector3 _visualVelocity;
        private Vector3 _collisionNormal;
        private bool _colliding;
        private float _yawDeg;
        private bool _crouching;
        private float _baseSpeed = DefaultSpeed;
        private Vector2 _virtualMove;
        private bool _virtualCrouch;

        public bool Moving { get; private set; }
        public bool Colliding { get { return _colliding; } }
        public Vector3 CollisionNormal { get { return _collisionNormal; } }

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

        private void Awake()
        {
            _controller = GetComponent<CharacterController>();
            _controller.slopeLimit = 50f;
            _controller.stepOffset = Mathf.Clamp(_controller.height * 0.14f, 0.18f, 0.28f);
            _controller.skinWidth = Mathf.Clamp(_controller.radius * 0.16f, 0.045f, 0.075f);
            _controller.minMoveDistance = 0f;
            _controller.detectCollisions = true;
            _controller.enableOverlapRecovery = true;
            _yawDeg = transform.eulerAngles.y;
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
            if (!InputEnabled || (Pipboy != null && Pipboy.IsOpen) || (Inventory != null && Inventory.IsOpen))
            {
                _velocity = Vector3.zero;
                _visualVelocity = Vector3.zero;
                Moving = false;
                Audio?.StopLocomotion();
                if (View != null) View.UpdateLocomotion(_visualVelocity, _yawDeg, false, _crouching);
                if (Socket != null)
                    Socket.SendState(transform.position, _yawDeg, _velocity, false, _crouching, false);
                return;
            }

            if (PointerAimEnabled) AimAtCursor();
            ReadInputAndMove();
            Audio?.SetLocomotion(_visualVelocity, transform.position, _controller.isGrounded, _crouching);

            if (View != null) View.UpdateLocomotion(_visualVelocity, _yawDeg, Moving, _crouching);

            // turning — часть протокола: сервер ретранслирует его другим клиентам,
            // чтобы у них персонаж тоже переступал, а не проворачивался на месте.
            bool turning = View != null && View.Turning;

            if (Socket != null)
                Socket.SendState(transform.position, _yawDeg, _velocity, Moving, _crouching, turning);
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
            _crouching = _virtualCrouch || Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.C);

            Vector3 wish = Camera != null
                ? Camera.PlanarRight() * x + Camera.PlanarForward() * z
                : new Vector3(x, 0f, z);

            // Диагональ не должна давать преимущество в скорости, иначе сервер
            // начнёт резать позицию по бюджету расстояния.
            if (wish.sqrMagnitude > 1f) wish.Normalize();

            bool requestedMovement = wish.sqrMagnitude > 0.0001f;

            float speed = Mathf.Min(Speed, ServerSpeedLimit) * (_crouching ? CrouchSpeedFactorValue : 1f);
            Vector3 requestedVelocity = wish * speed;
            float frameDt = Mathf.Max(0.001f, Time.deltaTime);
            Vector3 before = transform.position;
            _colliding = false;
            _collisionNormal = Vector3.zero;

            Vector3 motion = requestedVelocity * frameDt;
            motion.y = _controller.isGrounded ? -0.05f : -9.81f * frameDt;
            _controller.Move(motion);

            // Animation and the network see the displacement that collisions
            // actually allowed. This prevents running in place against walls and
            // keeps stride sync correct while the controller slides along cover.
            Vector3 actual = (transform.position - before) / frameDt;
            actual.y = 0f;
            _velocity = actual;
            Moving = requestedMovement && actual.sqrMagnitude > 0.0064f;

            float visualRate = actual.sqrMagnitude > _visualVelocity.sqrMagnitude
                ? VisualAcceleration
                : VisualDeceleration;
            _visualVelocity = Vector3.MoveTowards(_visualVelocity, actual, visualRate * frameDt);
            if (!Moving && _visualVelocity.sqrMagnitude < 0.0025f) _visualVelocity = Vector3.zero;
        }

        private void OnControllerColliderHit(ControllerColliderHit hit)
        {
            if (hit == null || hit.normal.y > 0.55f) return;
            _colliding = true;
            _collisionNormal = hit.normal;
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
        public void ApplySpecial(JObject self)
        {
            if (self == null) return;

            JObject special = self["special"] as JObject;
            var ranks = self["talentRanks"] as JObject;

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
            float previousSpeed = Speed;
            Speed = (_baseSpeed + bootBonus) * injuryMultiplier;

            if (View != null) View.SetInjuries(injuries);

            if (Mathf.Abs(previousSpeed - Speed) > 0.001f || agiToken != null)
            {
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

            Teleport(corrected);
            Debug.Log("[ROA] Серверная поправка позиции: " + reason);
        }

        /// <summary>Переставить персонажа, минуя коллизии CharacterController.</summary>
        public void Teleport(Vector3 position)
        {
            _controller.enabled = false;
            transform.position = position;
            _controller.enabled = true;
            _velocity = Vector3.zero;
            _visualVelocity = Vector3.zero;
            _colliding = false;
            _collisionNormal = Vector3.zero;
            Audio?.StopLocomotion();

            if (Camera != null) Camera.SnapToTarget();
        }
    }
}
