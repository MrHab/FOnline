using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Процедурная поза поверх клипов локомоции.
    ///
    /// Портирует два слоя web-клиента из 04b_character_glb_runtime.js:
    /// applyCharacterUpperBodySwayDamping() и applyCharacterGlbDirectionalPose().
    ///
    /// Смысл направленной позы: ноги должны идти по НАПРАВЛЕНИЮ ДВИЖЕНИЯ, а корпус
    /// и голова — смотреть на ПРИЦЕЛ. Достигается это так: корень модели
    /// доворачивается на lowerBodyYaw (ноги уходят на путь), а вверх по цепи
    /// позвоночника идёт контр-поворот с коэффициентами
    /// 0.16 + 0.18 + 0.18 + 0.22 + 0.26 = 1.0 — ровно компенсирующими доворот.
    /// Поэтому голова возвращается точно на прицел, а между тазом и плечами
    /// возникает естественная скрутка.
    ///
    /// Все коэффициенты и скорости сглаживания взяты из web-клиента без правок:
    /// подобранные на глаз значения дают заметно другой силуэт.
    /// </summary>
    public sealed class RoaCharacterPose
    {
        /// <summary>Предел угловой скорости разворота таза, рад/с. CHARACTER_LOWER_BODY_YAW_RATE.</summary>
        private const float LowerBodyYawRate = 5.2f;

        /// <summary>
        /// Доля «размашистого» верха из клипа, которую оставляем.
        /// CHARACTER_UPPER_SWAY_KEEP, 04b_character_glb_runtime.js:819.
        /// Клипы авторизованы с качанием шеи и головы до ±40°, в игре это читается
        /// как «мотание головой», поэтому верх подтягивается к покою.
        /// </summary>
        private const float SwayKeepSpine02 = 0.65f;
        private const float SwayKeepSpine03 = 0.45f;
        private const float SwayKeepNeck = 0.30f;
        private const float SwayKeepHead = 0.22f;

        /// <summary>
        /// Просадка корня модели по Y, м. CHARACTER_KNEE_FLEX_*, 04b:1033.
        /// Сам сгиб коленей не рисуется: корень опускается, а foot IK возвращает
        /// стопы на настоящую землю — ноги подгибаются сами.
        /// </summary>
        private const float KneeFlexIdle = 0.04f;
        private const float KneeFlexMove = 0.055f;
        private const float KneeFlexCrouch = 0.26f;

        private Transform _pelvis;
        private Transform _spine01;
        private Transform _spine02;
        private Transform _spine03;
        private Transform _neck;
        private Transform _head;

        // Поза покоя: снимается сразу после создания модели, до первого клипа.
        private Quaternion _restSpine02;
        private Quaternion _restSpine03;
        private Quaternion _restNeck;
        private Quaternion _restHead;

        // Сглаженные величины (runtime.directional* в web-клиенте).
        private float _moveBlend;
        private float _lowerBodyYaw;
        private float _sideAmount;
        private float _forwardAmount;
        private float _turnAmount;
        private float _runLean;
        private float _swayDampBlend;
        private float _crouchBlend;
        private float _contactPressure;
        private float _contactForward;
        private float _contactSide;

        public bool Ready { get; private set; }

        /// <summary>Текущий доворот таза в градусах — его применяет владелец к корню модели.</summary>
        public float LowerBodyYawDeg { get; private set; }

        /// <summary>
        /// Насколько опущен корень модели, м. Владелец применяет как
        /// localPosition.y = −KneeFlex, а foot IK учитывает это в высоте стопы.
        /// </summary>
        public float KneeFlex { get; private set; }

        /// <summary>Сглаженная сила упора в препятствие, 0..1.</summary>
        public float ContactPressure { get { return _contactPressure; } }

        public void Bind(Transform modelRoot)
        {
            if (modelRoot == null) return;

            _pelvis = FindDeep(modelRoot, "pelvis");
            _spine01 = FindDeep(modelRoot, "spine_01");
            _spine02 = FindDeep(modelRoot, "spine_02");
            _spine03 = FindDeep(modelRoot, "spine_03");
            _neck = FindDeep(modelRoot, "neck_01");
            _head = FindDeep(modelRoot, "head");

            if (_pelvis == null || _spine01 == null || _head == null)
            {
                Debug.LogWarning("[ROA] Кости позы не найдены — процедурная поза отключена.");
                return;
            }

            if (_spine02 != null) _restSpine02 = _spine02.localRotation;
            if (_spine03 != null) _restSpine03 = _spine03.localRotation;
            if (_neck != null) _restNeck = _neck.localRotation;
            if (_head != null) _restHead = _head.localRotation;

            Ready = true;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name) return root;

            for (int i = 0; i < root.childCount; i++)
            {
                Transform found = FindDeep(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        /// <summary>
        /// Пересчитать сглаженные величины. Вызывать раз в кадр до применения позы.
        /// </summary>
        /// <param name="lowerBodyYawTarget">Целевой доворот таза, радианы.</param>
        public void Step(bool locomoting, bool turning, string action,
                         float lowerBodyYawTarget, float sideAmount, float forwardAmount,
                         float turnAmount, bool crouching, bool dead, float dt,
                         float contactPressure = 0f, float contactForward = 0f,
                         float contactSide = 0f)
        {
            if (!Ready) return;

            float frameDt = Mathf.Clamp(dt, 0.001f, 0.08f);
            float contactTarget = dead ? 0f : Mathf.Clamp01(contactPressure);

            float kneeFlexTarget = dead
                ? 0f
                : (crouching ? KneeFlexCrouch : (locomoting ? KneeFlexMove : KneeFlexIdle))
                    + contactTarget * 0.022f;
            KneeFlex = Blend(KneeFlex, kneeFlexTarget, 7f, frameDt);

            _crouchBlend = Blend(_crouchBlend, crouching && !dead ? 1f : 0f, 8f, frameDt);

            _moveBlend = Blend(_moveBlend, locomoting ? 1f : 0f, locomoting ? 9f : 6f, frameDt);

            // Разворот таза ограничен по угловой скорости: без предела смена режима
            // вперёд/назад или быстрый доворот прицела перекидывали ноги на
            // 1200-1600 град/с — именно это читается как «ноги глючат».
            float blended = Blend(_lowerBodyYaw, lowerBodyYawTarget, locomoting ? 8.5f : 6.5f, frameDt);
            float maxStep = LowerBodyYawRate * frameDt;
            _lowerBodyYaw += Mathf.Clamp(blended - _lowerBodyYaw, -maxStep, maxStep);

            _sideAmount = Blend(_sideAmount, sideAmount, 9f, frameDt);
            _forwardAmount = Blend(_forwardAmount, forwardAmount, 9f, frameDt);
            _turnAmount = Blend(_turnAmount, turnAmount, turning ? 11f : 7f, frameDt);
            _contactPressure = Blend(_contactPressure, contactTarget,
                contactTarget > _contactPressure ? 12f : 8f, frameDt);
            _contactForward = Blend(_contactForward,
                Mathf.Clamp(contactForward, -1f, 1f), 10f, frameDt);
            _contactSide = Blend(_contactSide,
                Mathf.Clamp(contactSide, -1f, 1f), 10f, frameDt);

            // Бег читается по силуэту: корпус подаётся вперёд заметно сильнее шага.
            _runLean = Blend(_runLean, action == "run" ? 0.11f : 0f, 6f, frameDt);

            bool damped = action == "walk" || action == "run" || action == "turn"
                || action == "walk_back" || action == "run_back"
                || action == "crouch_walk" || action == "crouch_walk_back";
            _swayDampBlend = Blend(_swayDampBlend, damped ? 1f : 0f, 8f, frameDt);

            LowerBodyYawDeg = _lowerBodyYaw * Mathf.Rad2Deg * _moveBlend;
        }

        /// <summary>
        /// Применить позу к костям. Обязательно ПОСЛЕ того, как анимация записала
        /// свой кадр, иначе она затрёт смещения — то есть из LateUpdate.
        /// </summary>
        public void Apply()
        {
            if (!Ready) return;

            ApplySwayDamping();
            ApplyDirectional();

            if (_crouchBlend > 0.01f) ApplyCrouch(_crouchBlend);
        }

        /// <summary>
        /// Поза приседа: корпус наклоняется вперёд, а шея и голова отклоняются
        /// назад, чтобы взгляд остался на цели. Сгиб ног здесь не рисуется —
        /// его даёт связка «просадка корня + foot IK».
        /// applyCharacterGlbCrouchPose(), 04b:1166.
        /// </summary>
        private void ApplyCrouch(float blend)
        {
            float b = Mathf.Clamp01(blend);

            AddOffset(_pelvis, 0.06f * b, 0f, 0f);
            AddOffset(_spine01, 0.14f * b, 0f, 0f);
            AddOffset(_spine02, 0.12f * b, 0f, 0f);
            AddOffset(_spine03, 0.08f * b, 0f, 0f);
            AddOffset(_neck, -0.10f * b, 0f, 0f);
            AddOffset(_head, -0.14f * b, 0f, 0f);
        }

        /// <summary>
        /// Подтянуть верх корпуса к позе покоя. Slerp к rest на (1 - keep) * blend:
        /// чем выше по цепи, тем сильнее гасится качание.
        /// </summary>
        private void ApplySwayDamping()
        {
            if (_swayDampBlend < 0.01f) return;

            if (_spine02 != null)
                _spine02.localRotation = Quaternion.Slerp(_spine02.localRotation, _restSpine02,
                    (1f - SwayKeepSpine02) * _swayDampBlend);

            if (_spine03 != null)
                _spine03.localRotation = Quaternion.Slerp(_spine03.localRotation, _restSpine03,
                    (1f - SwayKeepSpine03) * _swayDampBlend);

            if (_neck != null)
                _neck.localRotation = Quaternion.Slerp(_neck.localRotation, _restNeck,
                    (1f - SwayKeepNeck) * _swayDampBlend);

            if (_head != null)
                _head.localRotation = Quaternion.Slerp(_head.localRotation, _restHead,
                    (1f - SwayKeepHead) * _swayDampBlend);
        }

        /// <summary>
        /// Контр-поворот цепи позвоночника. Сумма коэффициентов по Y равна 1.0,
        /// поэтому голова оказывается точно на прицеле, несмотря на доворот таза.
        /// </summary>
        private void ApplyDirectional()
        {
            float lowerBodyYaw = _lowerBodyYaw * _moveBlend;
            float counterYaw = -lowerBodyYaw;
            float side = _sideAmount * _moveBlend;
            float forward = _forwardAmount;
            float backwardLean = Mathf.Max(0f, -forward) * _moveBlend;
            float forwardLean = Mathf.Max(0f, forward) * _moveBlend;
            float turn = _turnAmount * _moveBlend;
            float runLean = _runLean * _moveBlend;
            float contactForward = _contactForward * _contactPressure;
            float contactSide = _contactSide * _contactPressure;

            // Упор читается как короткая компрессия, а не отдельная театральная
            // анимация: таз и грудь слегка уходят от поверхности, шея и голова
            // компенсируют движение, сохраняя взгляд на прицеле.
            AddOffset(_pelvis,
                backwardLean * -0.025f - contactForward * 0.018f,
                turn * 0.06f,
                side * -0.035f - contactSide * 0.014f);
            AddOffset(_spine01,
                forwardLean * 0.025f - backwardLean * 0.045f + runLean * 0.5f
                    - contactForward * 0.038f,
                counterYaw * 0.16f - turn * 0.035f,
                side * -0.018f - contactSide * 0.026f);
            AddOffset(_spine02,
                runLean * 0.5f - contactForward * 0.022f,
                counterYaw * 0.18f,
                side * -0.012f - contactSide * 0.016f);
            AddOffset(_spine03, contactForward * 0.008f,
                counterYaw * 0.18f, side * 0.012f + contactSide * 0.008f);
            AddOffset(_neck, contactForward * 0.014f,
                counterYaw * 0.22f, side * 0.008f + contactSide * 0.010f);
            AddOffset(_head, contactForward * 0.012f,
                counterYaw * 0.26f, contactSide * 0.012f);
        }

        /// <summary>
        /// Добавить локальное смещение к уже записанной анимацией ротации.
        /// Углы в радианах, как в исходнике.
        /// </summary>
        private static void AddOffset(Transform bone, float x, float y, float z)
        {
            if (bone == null) return;
            if (Mathf.Abs(x) < 1e-5f && Mathf.Abs(y) < 1e-5f && Mathf.Abs(z) < 1e-5f) return;

            Quaternion offset = Quaternion.Euler(
                x * Mathf.Rad2Deg,
                y * Mathf.Rad2Deg,
                z * Mathf.Rad2Deg);

            bone.localRotation = bone.localRotation * offset;
        }

        /// <summary>characterLocomotionBlend(), 04b_character_glb_runtime.js:810.</summary>
        private static float Blend(float current, float target, float rate, float dt)
        {
            float step = Mathf.Min(1f, Mathf.Max(0.001f, dt) * Mathf.Max(0f, rate));
            return current + (target - current) * step;
        }
    }
}
