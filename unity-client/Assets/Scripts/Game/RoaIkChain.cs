using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// FABRIK по цепочке костей. Общий решатель для ног (бедро → голень → стопа)
    /// и рук (ключица → плечо → предплечье → кисть).
    ///
    /// Портирует solveCharacterLegChain() (04b:1106) и solveApprovedArm() (04d:1149) —
    /// они отличаются только длиной цепи, числом итераций и тем, задаётся ли
    /// ориентация последнего звена.
    ///
    /// В Unity решатель проще оригинала: Transform.rotation принимает мировую
    /// ротацию и сам пересчитывает локальную, тогда как в Three.js приходилось
    /// вручную инвертировать кватернион родителя.
    /// </summary>
    public sealed class RoaIkChain
    {
        private readonly Transform[] _bones;
        private readonly Vector3[] _positions;
        private readonly float[] _lengths;
        private readonly int _iterations;
        private readonly float _tolerance;

        public bool Ready { get; private set; }

        public RoaIkChain(Transform[] bones, int iterations, float tolerance)
        {
            _bones = bones;
            _iterations = iterations;
            _tolerance = tolerance;

            if (bones == null || bones.Length < 2) return;

            foreach (Transform bone in bones)
                if (bone == null) return;

            _positions = new Vector3[bones.Length];
            _lengths = new float[bones.Length - 1];
            Ready = true;
        }

        /// <summary>
        /// Привести конец цепи в целевую точку.
        /// </summary>
        /// <param name="endRotation">
        /// Мировая ориентация последнего звена. Пусто — ориентация не трогается
        /// (так работает нога: позу стопы задаёт анимация).
        /// </param>
        public bool Solve(Vector3 target, Quaternion? endRotation)
        {
            return Solve(target, endRotation, null);
        }

        /// <summary>
        /// Решить цепь с pole-целью: локоть или колено стабильно остаётся на нужной
        /// стороне, даже когда конечность почти выпрямлена.
        /// </summary>
        public bool Solve(Vector3 target, Quaternion? endRotation, Vector3? pole)
        {
            if (!Ready) return false;

            for (int i = 0; i < _bones.Length; i++) _positions[i] = _bones[i].position;

            Vector3 basePos = _positions[0];

            for (int i = 0; i < _lengths.Length; i++)
            {
                _lengths[i] = Vector3.Distance(_positions[i], _positions[i + 1]);
                if (_lengths[i] <= 0.0001f) return false;
            }

            float total = 0f;
            foreach (float length in _lengths) total += length;

            int last = _positions.Length - 1;

            if (Vector3.Distance(basePos, target) >= total)
            {
                // Цель недостижима — цепь вытягивается прямо к ней.
                Vector3 dir = (target - basePos).normalized;
                for (int i = 1; i < _positions.Length; i++)
                    _positions[i] = _positions[i - 1] + dir * _lengths[i - 1];
            }
            else
            {
                for (int iteration = 0; iteration < _iterations; iteration++)
                {
                    // Обратный проход: от цели к основанию.
                    _positions[last] = target;
                    for (int i = last - 1; i >= 0; i--)
                        _positions[i] = _positions[i + 1]
                            + (_positions[i] - _positions[i + 1]).normalized * _lengths[i];

                    // Прямой проход: основание возвращается на место.
                    _positions[0] = basePos;
                    for (int i = 1; i < _positions.Length; i++)
                        _positions[i] = _positions[i - 1]
                            + (_positions[i] - _positions[i - 1]).normalized * _lengths[i - 1];

                    if (Vector3.Distance(_positions[last], target) < _tolerance) break;
                }
            }

            if (pole.HasValue) ApplyPoleConstraint(pole.Value);

            // Довернуть каждое звено так, чтобы направление на следующее совпало
            // с расчётным. Читать позиции надо заново: поворот родителя уже
            // сдвинул детей.
            for (int i = 0; i < _bones.Length - 1; i++)
            {
                Vector3 current = _bones[i + 1].position - _bones[i].position;
                Vector3 wanted = _positions[i + 1] - _positions[i];

                if (current.sqrMagnitude < 1e-8f || wanted.sqrMagnitude < 1e-8f) continue;

                Quaternion delta = Quaternion.FromToRotation(current.normalized, wanted.normalized);
                _bones[i].rotation = delta * _bones[i].rotation;
            }

            if (endRotation.HasValue) _bones[last].rotation = endRotation.Value;

            return Vector3.Distance(_bones[last].position, target) < 0.01f;
        }

        private void ApplyPoleConstraint(Vector3 pole)
        {
            // The anatomical bend is the penultimate joint: calf for a leg,
            // lower arm for a four-bone arm chain. The clavicle remains animation-led.
            for (int i = Mathf.Max(1, _positions.Length - 2); i < _positions.Length - 1; i++)
            {
                Vector3 anchor = _positions[i - 1];
                Vector3 axis = _positions[i + 1] - anchor;
                if (axis.sqrMagnitude < 1e-8f) continue;

                Vector3 current = Vector3.ProjectOnPlane(_positions[i] - anchor, axis);
                Vector3 desired = Vector3.ProjectOnPlane(pole - anchor, axis);
                if (current.sqrMagnitude < 1e-8f || desired.sqrMagnitude < 1e-8f) continue;

                float angle = Vector3.SignedAngle(current, desired, axis.normalized);
                _positions[i] = anchor
                    + Quaternion.AngleAxis(angle, axis.normalized) * (_positions[i] - anchor);
            }
        }
    }
}
