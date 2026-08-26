#if UNITY_EDITOR
using System;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaTargetingFeedbackProbe
    {
        [MenuItem("Realm of Ashes/Проверить обратную связь прицела")]
        private static void Run()
        {
            GameObject root = null;
            try
            {
                RoaTargetingFeedback.Frame low = RoaTargetingFeedback.Evaluate(
                    0f, 24, true, false, 1f);
                RoaTargetingFeedback.Frame high = RoaTargetingFeedback.Evaluate(
                    0.25f, 88, true, false, 1f);
                RoaTargetingFeedback.Frame blocked = RoaTargetingFeedback.Evaluate(
                    0.5f, 0, true, true, 1f);
                RoaTargetingFeedback.Frame far = RoaTargetingFeedback.Evaluate(
                    0.75f, 0, false, false, 1f);

                Require(low.Visible && low.State == RoaTargetingFeedback.Status.Ready
                    && low.Label == "24%", "ready target lost its hit chance");
                Require(high.Color.g > low.Color.g && high.Color.r < low.Color.r,
                    "hit quality is not readable from the target ring");
                Require(blocked.State == RoaTargetingFeedback.Status.Blocked
                    && blocked.Label.Contains("ПЕРЕКРЫТА")
                    && blocked.TrajectoryAlpha > high.TrajectoryAlpha,
                    "blocked shot has no explicit warning");
                Require(far.State == RoaTargetingFeedback.Status.OutOfRange
                    && far.Label.Contains("ДАЛЬНОСТИ"),
                    "out-of-range target looks attackable");

                root = new GameObject("Targeting feedback probe");
                RoaTargetingFeedback view = root.AddComponent<RoaTargetingFeedback>();
                view.Present(blocked, Vector3.zero, new Vector3(6f, 0f, 3f), true);
                Require(view.ActiveRendererCount == 2,
                    "target preview is missing the ring or exact shot trajectory");
                view.Hide();
                Require(view.ActiveRendererCount == 0,
                    "target preview remains visible after input is blocked");

                Debug.Log("[ПРИЦЕЛ] готово: общая цель, траектория, шанс, дальность и препятствие проверены.");
            }
            catch (Exception error)
            {
                Debug.LogError("[ПРИЦЕЛ] ошибка: " + error.Message);
            }
            finally
            {
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
