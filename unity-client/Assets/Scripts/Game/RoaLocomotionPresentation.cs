using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Чистая математика визуальной локомоции локального игрока.
    /// Сервер и CharacterController по-прежнему получают фактическое движение;
    /// этот слой лишь делает направление ног устойчивым после разрешения коллизий.
    /// </summary>
    public static class RoaLocomotionPresentation
    {
        private const float DirectionEpsilon = 0.0001f;
        private const float SlideEpsilon = 0.0004f;

        public static float ContactPressure(Vector3 requestedVelocity, Vector3 collisionNormal)
        {
            requestedVelocity.y = 0f;
            collisionNormal.y = 0f;
            if (requestedVelocity.sqrMagnitude < DirectionEpsilon
                || collisionNormal.sqrMagnitude < DirectionEpsilon) return 0f;

            return Mathf.Clamp01(-Vector3.Dot(
                requestedVelocity.normalized, collisionNormal.normalized));
        }

        /// <summary>
        /// У стены направление презентации берётся из желаемой касательной,
        /// а величина — из реально разрешённого перемещения. Так микродрожание
        /// CharacterController не разворачивает ноги внутрь стены.
        /// </summary>
        public static Vector3 ResolveCollisionVelocity(Vector3 requestedVelocity,
                                                       Vector3 actualVelocity,
                                                       bool colliding,
                                                       Vector3 collisionNormal)
        {
            requestedVelocity.y = 0f;
            actualVelocity.y = 0f;
            if (!colliding) return actualVelocity;

            float pressure = ContactPressure(requestedVelocity, collisionNormal);
            if (pressure <= 0.001f) return actualVelocity;

            collisionNormal.y = 0f;
            if (collisionNormal.sqrMagnitude < DirectionEpsilon) return actualVelocity;
            collisionNormal.Normalize();

            Vector3 slide = Vector3.ProjectOnPlane(requestedVelocity, collisionNormal);
            slide.y = 0f;
            float actualSpeed = actualVelocity.magnitude;
            if (slide.sqrMagnitude < SlideEpsilon || actualSpeed < 0.01f)
                return Vector3.zero;

            return slide.normalized * actualSpeed;
        }

        /// <summary>
        /// Сглаживает только темп шага. Направление меняется сразу вслед за
        /// фактическим движением, поэтому реверс не проходит через ложный ноль
        /// и не создаёт короткий moonwalk.
        /// </summary>
        public static Vector3 SmoothVisualVelocity(Vector3 previous, Vector3 target,
                                                   float acceleration, float deceleration,
                                                   float dt)
        {
            previous.y = 0f;
            target.y = 0f;
            float previousSpeed = previous.magnitude;
            float targetSpeed = target.magnitude;
            float rate = targetSpeed > previousSpeed ? acceleration : deceleration;
            float nextSpeed = Mathf.MoveTowards(previousSpeed, targetSpeed,
                Mathf.Max(0f, rate) * Mathf.Clamp(dt, 0f, 0.1f));

            if (targetSpeed >= 0.01f) return target / targetSpeed * nextSpeed;
            if (nextSpeed < 0.05f || previousSpeed < 0.01f) return Vector3.zero;
            return previous / previousSpeed * nextSpeed;
        }
    }
}
