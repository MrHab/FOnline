using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Проверяет сетевой прогноз, остановку, коррекцию и телепорт актёров.</summary>
    public static class RoaNetworkActorMotionProbe
    {
        [MenuItem("Realm of Ashes/Проверить сетевое движение актёров")]
        public static void Run()
        {
            float latency = RoaNetworkActorMotion.OneWayLatencySeconds(160f, 0.25f);
            float cappedLatency = RoaNetworkActorMotion.OneWayLatencySeconds(1000f, 0.25f);
            float unknownLatency = RoaNetworkActorMotion.OneWayLatencySeconds(-1f, 0.25f);
            Require(Mathf.Abs(latency - 0.08f) < 0.001f
                    && Mathf.Abs(cappedLatency - 0.125f) < 0.001f
                    && unknownLatency <= 0f,
                "компенсация ping не равна половине RTT или вышла за безопасный предел");

            Vector3 predicted = RoaNetworkActorMotion.PredictPosition(
                Vector3.zero, Vector3.forward * 4f, true, 0.1f, 0.25f);
            Vector3 capped = RoaNetworkActorMotion.PredictPosition(
                Vector3.zero, Vector3.forward * 4f, true, 0.8f, 0.25f);
            Vector3 stopped = RoaNetworkActorMotion.PredictPosition(
                Vector3.zero, Vector3.forward * 4f, false, 0.2f, 0.25f);
            Require(Mathf.Abs(predicted.z - 0.4f) < 0.001f
                    && Mathf.Abs(capped.z - 1f) < 0.001f
                    && stopped.sqrMagnitude < 0.0001f,
                "экстраполяция не ограничена временем или игнорирует стоп");

            Vector3 smooth = Vector3.one;
            RoaNetworkActorMotion.Sample teleport = RoaNetworkActorMotion.Step(
                Vector3.zero, Vector3.forward * 8f, Vector3.zero, false,
                0f, 1f / 60f, 0.1f, 0.25f, 3.4f, ref smooth);
            Require(teleport.Snapped && teleport.Position.z > 7.99f
                    && teleport.VisualVelocity.sqrMagnitude < 0.0001f
                    && smooth.sqrMagnitude < 0.0001f,
                "крупная коррекция протянулась через сцену вместо безопасного snap");

            smooth = Vector3.one;
            RoaNetworkActorMotion.Sample movingTeleport = RoaNetworkActorMotion.Step(
                Vector3.zero, Vector3.forward * 8f, Vector3.forward * 4f, true,
                0f, 1f / 60f, 0.1f, 0.25f, 3.4f, ref smooth);
            Require(movingTeleport.Snapped && movingTeleport.Moving
                    && Mathf.Abs(movingTeleport.VisualVelocity.z - 4f) < 0.001f
                    && smooth.sqrMagnitude < 0.0001f,
                "движущийся сетевой актёр вспыхнул в idle после snap-коррекции");

            smooth = Vector3.zero;
            RoaNetworkActorMotion.Sample stopCorrection = RoaNetworkActorMotion.Step(
                Vector3.zero, Vector3.forward * 0.7f, Vector3.zero, false,
                0f, 0.05f, 0.1f, 0.25f, 3.4f, ref smooth);
            Require(!stopCorrection.Snapped && stopCorrection.Moving
                    && stopCorrection.VisualVelocity.z > 0.1f,
                "догоняющая остановочная коррекция снова скользит в idle");

            smooth = Vector3.zero;
            RoaNetworkActorMotion.Sample nearTeleport = RoaNetworkActorMotion.Step(
                Vector3.zero, Vector3.forward * 3.2f, Vector3.zero, false,
                0f, 0.05f, 0.1f, 0.25f, 3.4f, ref smooth);
            Require(!nearTeleport.Snapped
                    && nearTeleport.VisualVelocity.magnitude <= 5.51f
                    && nearTeleport.Position.z <= 0.276f,
                "коррекция под порогом телепорта превысила безопасную скорость");

            RoaNetworkActorMotion.Sample at30 = Simulate(30);
            RoaNetworkActorMotion.Sample at120 = Simulate(120);
            Require(Mathf.Abs(at30.Position.z - at120.Position.z) < 0.015f,
                "положение после потери пакетов зависит от FPS");
            Require(at30.Position.z > 0.98f && at30.Position.z < 1.02f
                    && at120.Position.z > 0.98f && at120.Position.z < 1.02f,
                "актёр вышел за ограниченный горизонт экстраполяции");
            Require(!at30.Moving && !at120.Moving,
                "после исчерпания экстраполяции актёр продолжает бежать на месте");

            float nearSmooth = RoaNetworkActorMotion.AdaptiveSmoothTime(0.1f, 0.05f, 3.4f);
            float farSmooth = RoaNetworkActorMotion.AdaptiveSmoothTime(0.1f, 2.4f, 3.4f);
            Require(farSmooth < nearSmooth * 0.65f,
                "большая коррекция не догоняется быстрее мелкого сетевого шума");

            Debug.Log("[СЕТЕВОЕ ДВИЖЕНИЕ] готово: прогноз="
                + predicted.z.ToString("0.00") + "/" + capped.z.ToString("0.00")
                + ", snap=" + movingTeleport.VisualVelocity.z.ToString("0.00")
                + ", stop=" + stopCorrection.VisualVelocity.z.ToString("0.00")
                + ", cap=" + nearTeleport.VisualVelocity.magnitude.ToString("0.00")
                + ", 30/120 FPS=" + at30.Position.z.ToString("0.000")
                + "/" + at120.Position.z.ToString("0.000"));
        }

        private static RoaNetworkActorMotion.Sample Simulate(int fps)
        {
            float dt = 1f / fps;
            Vector3 position = Vector3.zero;
            Vector3 smooth = Vector3.zero;
            RoaNetworkActorMotion.Sample sample = default(RoaNetworkActorMotion.Sample);
            for (int frame = 0; frame < fps; frame++)
            {
                float sincePacket = (frame + 1) * dt;
                sample = RoaNetworkActorMotion.Step(position, Vector3.zero,
                    Vector3.forward * 4f, true, sincePacket, dt,
                    0.1f, 0.25f, 3.4f, ref smooth);
                position = sample.Position;
            }
            return sample;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new System.Exception("[СЕТЕВОЕ ДВИЖЕНИЕ] " + message);
        }

        public static void RunBatch()
        {
            Run();
        }
    }
}
