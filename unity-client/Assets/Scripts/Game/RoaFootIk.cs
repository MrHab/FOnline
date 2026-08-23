using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Фиксация опорной стопы. Портирует applyCharacterFootIk()
    /// и solveCharacterLegChain() из 04b_character_glb_runtime.js:1106–1355.
    ///
    /// Зачем: запечённые клипы ходьбы проигрываются с изменённым темпом
    /// (stride sync), а персонаж движется со скоростью сервера. Даже при точной
    /// подгонке темпа остаётся расхождение, и стопы подскальзывают. IK ловит
    /// опорную стопу в момент контакта, пришивает её к точке касания и держит,
    /// пока анимация не поднимет ногу снова.
    ///
    /// Двигаются только бедро и голень — ориентацию стопы задаёт анимация.
    /// </summary>
    public sealed class RoaFootIk
    {
        /// <summary>Высота, ниже которой стопа считается «у земли», м.</summary>
        private const float Lift = 0.05f;

        /// <summary>Предел сноса замка до принудительного отпускания, м.</summary>
        private const float MaxDrift = 0.44f;

        /// <summary>Предел скручивания корпуса относительно замка, рад.</summary>
        private const float TwistLimit = 0.55f;
        private const float TurnTwistLimit = 0.6f;

        /// <summary>Замок хватает быстро (24), отпускает мягко (6).</summary>
        private const float BlendRateLock = 24f;
        private const float BlendRateRelease = 6f;

        /// <summary>Скачок позиции, после которого замки сбрасываются, м.</summary>
        private const float TeleportReset = 1.6f;

        private const int FabrikIterations = 8;

        private sealed class Side
        {
            public Transform Thigh;
            public Transform Calf;
            public Transform Foot;

            public float RestHeight;

            public bool Locked;
            public float Blend;
            public Vector3 LockPos;
            public float LockYaw;
            public float RelockCooldown;

            public Vector3 PrevAnimated;
            public bool HasPrev;

            // Рабочие буферы решателя, чтобы не аллоцировать каждый кадр.
            public readonly Vector3[] Positions = new Vector3[3];
            public readonly float[] Lengths = new float[2];
        }

        private readonly Side _left = new Side();
        private readonly Side _right = new Side();

        private Transform _ground;
        private Transform _modelRoot;

        private Vector3 _lastActorPos;
        private bool _hasLastActorPos;
        private string _lastClip = string.Empty;

        public bool Ready { get; private set; }

        /// <summary>Сколько стоп зафиксировано сейчас. Для диагностики.</summary>
        public int LockedCount { get { return (_left.Locked ? 1 : 0) + (_right.Locked ? 1 : 0); } }

        /// <param name="ground">Трансформ на уровне ступней — от него считается земля.</param>
        /// <param name="modelRoot">Корень модели: его поворот задаёт скручивание.</param>
        public void Bind(Transform ground, Transform modelRoot)
        {
            _ground = ground;
            _modelRoot = modelRoot;
            if (_ground == null || _modelRoot == null) return;

            BindSide(_left, "thigh_l", "calf_l", "foot_l");
            BindSide(_right, "thigh_r", "calf_r", "foot_r");

            Ready = _left.Foot != null && _right.Foot != null;
            if (!Ready)
                Debug.LogWarning("[ROA] Кости ног не найдены — foot IK отключён.");
        }

        private void BindSide(Side side, string thigh, string calf, string foot)
        {
            side.Thigh = FindDeep(_modelRoot, thigh);
            side.Calf = FindDeep(_modelRoot, calf);
            side.Foot = FindDeep(_modelRoot, foot);

            if (side.Foot == null) return;

            // Высота стопы в позе покоя: она же целевая высота при постановке.
            side.RestHeight = Mathf.Max(0.015f, side.Foot.position.y - _ground.position.y);
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
        /// Применить IK. Вызывать в LateUpdate ПОСЛЕ направленной позы: та вращает
        /// таз, а ноги — его дети, поэтому их мировые позиции меняются.
        /// </summary>
        /// <param name="clip">Текущий клип: его смена перепришивает стопы.</param>
        /// <param name="kneeFlex">
        /// На сколько опущен корень модели. Таз просажен, поэтому «земля клипа»
        /// ниже настоящей: без этой поправки в приседе (0.26 м) стопа всегда
        /// числилась бы «у земли», замок хватал бы её в воздухе, а свободная
        /// стопа уходила бы под пол.
        /// </param>
        public void Apply(float dt, bool locomoting, bool turning, bool dead, string clip, float kneeFlex)
        {
            if (!Ready) return;

            float frameDt = Mathf.Clamp(dt, 0.001f, 0.08f);
            Vector3 actorWorld = _ground.position;

            // Телепорт (смена локации, серверная поправка) не должен тянуть
            // стопы через всю карту.
            if (_hasLastActorPos && Vector3.Distance(actorWorld, _lastActorPos) > TeleportReset)
            {
                ResetSide(_left);
                ResetSide(_right);
            }

            Vector3 actorVel = Vector3.zero;
            if (_hasLastActorPos) actorVel = (actorWorld - _lastActorPos) / frameDt;
            actorVel.y = 0f;

            bool hadActorPosition = _hasLastActorPos;
            _lastActorPos = actorWorld;
            _hasLastActorPos = true;

            float actorSpeed = actorVel.magnitude;
            float groundY = actorWorld.y;

            Vector3 rootForward = _modelRoot.forward;
            float rootYaw = Mathf.Atan2(rootForward.x, rootForward.z);

            // Смена клипа (шёл → встал, развернулся → замер) перепришивает стопы:
            // иначе замки держат ноги там, где их застал прошлый клип, и в стойке
            // ноги остаются раскиданными.
            if (_lastClip != clip)
            {
                _lastClip = clip;
                _left.Locked = false;
                _right.Locked = false;
                _left.RelockCooldown = 0.12f;
                _right.RelockCooldown = 0.12f;
            }

            float flex = Mathf.Max(0f, kneeFlex);

            ApplySide(_left, frameDt, actorVel, actorSpeed, groundY, rootYaw, turning, !locomoting, dead, hadActorPosition, flex);
            ApplySide(_right, frameDt, actorVel, actorSpeed, groundY, rootYaw, turning, !locomoting, dead, hadActorPosition, flex);
        }

        private static void ResetSide(Side side)
        {
            side.Locked = false;
            side.Blend = 0f;
            side.HasPrev = false;
        }

        private void ApplySide(Side side, float frameDt, Vector3 actorVel, float actorSpeed,
                               float groundY, float rootYaw, bool turning, bool idle, bool dead,
                               bool hadActorPosition, float kneeFlex)
        {
            if (side.Foot == null || side.RestHeight <= 0f) return;

            Vector3 animated = side.Foot.position;

            // Высота считается от настоящей земли, а не от «земли клипа»:
            // поправка на просадку корня обязательна, иначе присед ломает замки.
            float height = animated.y - groundY - side.RestHeight + kneeFlex;

            Vector3 footVel = Vector3.zero;
            if (side.HasPrev) footVel = (animated - side.PrevAnimated) / frameDt;
            footVel.y = 0f;

            bool hadPrev = side.HasPrev;
            side.PrevAnimated = animated;
            side.HasPrev = true;

            // Опора против переноса — по знаку скорости стопы относительно актёра:
            // опорная нога «уезжает назад» под корпусом, переносимая летит вперёд
            // примерно вдвое быстрее корпуса. Высота у этих клипов почти
            // не меняется, поэтому она лишь страховка.
            bool stance = false;
            bool swing = false;

            if (hadPrev && actorSpeed > 0.3f)
            {
                float along = Vector3.Dot(footVel - actorVel, actorVel) / actorSpeed;
                stance = along < actorSpeed * 0.15f;
                swing = along > actorSpeed * 0.7f;
            }
            else if (hadPrev)
            {
                float footSpeed = footVel.magnitude;

                // В развороте клип всё равно свипует стопы (~0.9 м/с) — замок
                // должен пересиливать свип, иначе ноги «шагают вперёд» на месте.
                stance = footSpeed < (turning ? 1.1f : 0.25f);
                swing = footSpeed > (turning ? 1.5f : 0.8f);
            }

            side.RelockCooldown = Mathf.Max(0f, side.RelockCooldown - frameDt);

            if (dead || !hadPrev)
            {
                side.Locked = false;
            }
            else if (!side.Locked)
            {
                if (stance && height < Lift * 1.2f && side.RelockCooldown <= 0f)
                {
                    side.Locked = true;
                    side.LockPos = new Vector3(animated.x, groundY + side.RestHeight, animated.z);
                    side.LockYaw = rootYaw;
                }
            }
            else
            {
                float drift = new Vector2(animated.x - side.LockPos.x, animated.z - side.LockPos.z).magnitude;
                float twist = Mathf.Abs(Mathf.DeltaAngle(side.LockYaw * Mathf.Rad2Deg, rootYaw * Mathf.Rad2Deg)) * Mathf.Deg2Rad;

                float twistLimit = turning ? TurnTwistLimit : (idle ? 0.28f : TwistLimit);
                float driftLimit = idle ? 0.2f : MaxDrift;

                // В развороте шаги диктует клип: нога отпускается, как только клип
                // её поднял; скручивание — страховка на медленных поворотах.
                float liftRelease = Lift * (turning ? 1.5f : 2.4f);

                if (swing || height > liftRelease || drift > driftLimit || twist > twistLimit)
                {
                    side.Locked = false;

                    // Пауза перед повторным замком: без неё нога, опускаясь,
                    // ловится и рвётся по нескольку раз за шаг.
                    side.RelockCooldown = turning ? 0.18f : 0.08f;
                }
            }

            side.Blend = Blend(side.Blend, side.Locked ? 1f : 0f,
                side.Locked ? BlendRateLock : BlendRateRelease, frameDt);

            // Стопа на настоящей земле — база для обоих случаев, замок ложится
            // поверх неё. Иначе отпущенная стопа всё время спада blend тянулась бы
            // к устаревшему замку и проваливалась.
            Vector3 grounded = new Vector3(
                animated.x,
                groundY + side.RestHeight + Mathf.Max(0f, height),
                animated.z);

            bool hasTarget = false;
            Vector3 target = Vector3.zero;

            if (side.Blend >= 0.02f)
            {
                target = Vector3.Lerp(grounded, side.LockPos, side.Blend);
                hasTarget = true;
            }
            else if (!dead && Mathf.Abs(grounded.y - animated.y) > 0.004f)
            {
                target = grounded;
                hasTarget = true;
            }

            if (hasTarget) SolveLegChain(side, target);
        }

        /// <summary>
        /// FABRIK по цепи бедро → голень → стопа. Стопу не вращаем: её ориентацию
        /// задаёт анимация, IK лишь приводит сустав стопы в целевую точку.
        /// </summary>
        private static void SolveLegChain(Side side, Vector3 target)
        {
            if (side.Thigh == null || side.Calf == null || side.Foot == null) return;

            side.Positions[0] = side.Thigh.position;
            side.Positions[1] = side.Calf.position;
            side.Positions[2] = side.Foot.position;

            Vector3 basePos = side.Positions[0];

            side.Lengths[0] = Vector3.Distance(side.Positions[0], side.Positions[1]);
            side.Lengths[1] = Vector3.Distance(side.Positions[1], side.Positions[2]);

            if (side.Lengths[0] <= 0.0001f || side.Lengths[1] <= 0.0001f) return;

            float total = side.Lengths[0] + side.Lengths[1];

            if (Vector3.Distance(basePos, target) >= total)
            {
                // Цель недостижима — нога вытягивается прямо к ней.
                Vector3 dir = (target - basePos).normalized;
                side.Positions[1] = side.Positions[0] + dir * side.Lengths[0];
                side.Positions[2] = side.Positions[1] + dir * side.Lengths[1];
            }
            else
            {
                for (int iteration = 0; iteration < FabrikIterations; iteration++)
                {
                    // Обратный проход: от цели к основанию.
                    side.Positions[2] = target;
                    side.Positions[1] = side.Positions[2]
                        + (side.Positions[1] - side.Positions[2]).normalized * side.Lengths[1];
                    side.Positions[0] = side.Positions[1]
                        + (side.Positions[0] - side.Positions[1]).normalized * side.Lengths[0];

                    // Прямой проход: основание возвращается на место.
                    side.Positions[0] = basePos;
                    side.Positions[1] = side.Positions[0]
                        + (side.Positions[1] - side.Positions[0]).normalized * side.Lengths[0];
                    side.Positions[2] = side.Positions[1]
                        + (side.Positions[2] - side.Positions[1]).normalized * side.Lengths[1];

                    if (Vector3.Distance(side.Positions[2], target) < 0.0008f) break;
                }
            }

            RotateTowards(side.Thigh, side.Calf, side.Positions[0], side.Positions[1]);
            RotateTowards(side.Calf, side.Foot, side.Positions[1], side.Positions[2]);
        }

        /// <summary>
        /// Довернуть кость так, чтобы направление на дочернюю совпало с расчётным.
        /// В Unity достаточно записать мировую ротацию: пересчёт в локальную
        /// делает сам Transform.
        /// </summary>
        private static void RotateTowards(Transform bone, Transform child, Vector3 from, Vector3 to)
        {
            if (bone == null || child == null) return;

            Vector3 current = child.position - bone.position;
            Vector3 wanted = to - from;

            if (current.sqrMagnitude < 1e-8f || wanted.sqrMagnitude < 1e-8f) return;

            Quaternion delta = Quaternion.FromToRotation(current.normalized, wanted.normalized);
            bone.rotation = delta * bone.rotation;
        }

        private static float Blend(float current, float target, float rate, float dt)
        {
            float step = Mathf.Min(1f, Mathf.Max(0.001f, dt) * Mathf.Max(0f, rate));
            return current + (target - current) * step;
        }
    }
}
