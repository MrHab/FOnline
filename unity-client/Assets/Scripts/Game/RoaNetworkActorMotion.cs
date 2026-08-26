using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Единая презентация сетевого движения для других игроков и NPC.
    /// Снимок остаётся неподвижным якорем; прогноз вычисляется от времени,
    /// поэтому результат не зависит от FPS и не накапливает дрейф.
    /// </summary>
    public static class RoaNetworkActorMotion
    {
        public const float PresentationMoveSpeed = 0.08f;
        private const float VisualVelocityFloor = 0.04f;

        public struct Sample
        {
            public Vector3 Position;
            public Vector3 VisualVelocity;
            public bool Moving;
            public bool Snapped;
            public float Error;
        }

        public static float OneWayLatencySeconds(float pingMs, float maxExtrapolationSeconds)
        {
            if (pingMs <= 0f || float.IsNaN(pingMs) || float.IsInfinity(pingMs)) return 0f;
            return Mathf.Clamp(pingMs * 0.0005f, 0f,
                Mathf.Max(0f, maxExtrapolationSeconds) * 0.5f);
        }

        public static Vector3 PredictPosition(Vector3 snapshotPosition,
                                              Vector3 networkVelocity,
                                              bool networkMoving,
                                              float secondsSincePacket,
                                              float maxExtrapolationSeconds)
        {
            snapshotPosition.y = 0f;
            networkVelocity.y = 0f;
            if (!networkMoving || networkVelocity.sqrMagnitude < 0.0001f)
                return snapshotPosition;

            float horizon = Mathf.Clamp(secondsSincePacket, 0f,
                Mathf.Max(0f, maxExtrapolationSeconds));
            return snapshotPosition + networkVelocity * horizon;
        }

        public static float PresentationSpeedLimit(Vector3 networkVelocity)
        {
            networkVelocity.y = 0f;
            return Mathf.Clamp(networkVelocity.magnitude * 1.35f + 1.5f, 5.5f, 12f);
        }

        public static float AdaptiveSmoothTime(float baseSmoothTime,
                                               float error,
                                               float snapDistance)
        {
            float baseline = Mathf.Max(0.025f, baseSmoothTime);
            float ratio = Mathf.InverseLerp(0.18f,
                Mathf.Max(0.2f, snapDistance * 0.72f), Mathf.Max(0f, error));
            return Mathf.Lerp(baseline, Mathf.Max(0.025f, baseline * 0.46f), ratio);
        }

        public static Sample Step(Vector3 currentPosition,
                                  Vector3 snapshotPosition,
                                  Vector3 networkVelocity,
                                  bool networkMoving,
                                  float secondsSincePacket,
                                  float frameDt,
                                  float baseSmoothTime,
                                  float maxExtrapolationSeconds,
                                  float snapDistance,
                                  ref Vector3 smoothVelocity)
        {
            float dt = Mathf.Clamp(frameDt, 0.001f, 0.1f);
            Vector3 predicted = PredictPosition(snapshotPosition, networkVelocity,
                networkMoving, secondsSincePacket, maxExtrapolationSeconds);
            predicted.y = currentPosition.y;

            Vector3 errorVector = predicted - currentPosition;
            errorVector.y = 0f;
            float error = errorVector.magnitude;
            float safeSnapDistance = Mathf.Max(0.5f, snapDistance);

            if (error >= safeSnapDistance)
            {
                smoothVelocity = Vector3.zero;
                return new Sample
                {
                    Position = predicted,
                    VisualVelocity = Vector3.zero,
                    Moving = false,
                    Snapped = true,
                    Error = error
                };
            }

            float smoothTime = AdaptiveSmoothTime(baseSmoothTime, error, safeSnapDistance);
            float speedLimit = PresentationSpeedLimit(networkVelocity);
            Vector3 next = Vector3.SmoothDamp(currentPosition, predicted,
                ref smoothVelocity, smoothTime, speedLimit, dt);
            Vector3 visibleStep = next - currentPosition;
            float maxVisibleStep = speedLimit * dt;
            if (visibleStep.magnitude > maxVisibleStep)
            {
                visibleStep = visibleStep.normalized * maxVisibleStep;
                next = currentPosition + visibleStep;
                smoothVelocity = visibleStep / dt;
            }
            Vector3 visualVelocity = visibleStep / dt;
            visualVelocity.y = 0f;
            float visualSpeed = visualVelocity.magnitude;
            if (visualSpeed < VisualVelocityFloor) visualVelocity = Vector3.zero;

            return new Sample
            {
                Position = next,
                VisualVelocity = visualVelocity,
                Moving = visualSpeed >= PresentationMoveSpeed,
                Snapped = false,
                Error = error
            };
        }
    }
}
