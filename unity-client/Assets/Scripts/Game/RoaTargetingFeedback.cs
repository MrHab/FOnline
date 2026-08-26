using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// World-space preview of the target the normal combat resolver will use.
    /// This component owns presentation only; the server still decides whether
    /// the attack hits and how much damage it deals.
    /// </summary>
    public sealed class RoaTargetingFeedback : MonoBehaviour
    {
        private const int RingSegments = 40;

        public enum Status
        {
            Ready,
            Blocked,
            OutOfRange
        }

        public struct Frame
        {
            public bool Visible;
            public Status State;
            public string Label;
            public Color Color;
            public float Radius;
            public float Width;
            public float TrajectoryAlpha;
        }

        private Material _material;
        private LineRenderer _ring;
        private LineRenderer _trajectory;

        public int ActiveRendererCount
        {
            get
            {
                int count = 0;
                if (_ring != null && _ring.enabled) count++;
                if (_trajectory != null && _trajectory.enabled) count++;
                return count;
            }
        }

        public static Frame Evaluate(float unscaledTime, int chance, bool inRange,
                                     bool blocked, float authoredScale)
        {
            float scale = Mathf.Clamp(authoredScale <= 0.01f ? 1f : authoredScale, 0.6f, 1.8f);
            float pulse = 0.5f + 0.5f * Mathf.Sin(unscaledTime * Mathf.PI * 3.2f);
            var frame = new Frame
            {
                Visible = true,
                Radius = (0.72f + pulse * 0.045f) * scale,
                Width = 0.055f + pulse * 0.012f,
                State = Status.Ready,
                Label = Mathf.Clamp(chance, 0, 100) + "%"
            };

            if (!inRange)
            {
                frame.State = Status.OutOfRange;
                frame.Label = "ВНЕ ДАЛЬНОСТИ";
                frame.Color = new Color(0.58f, 0.62f, 0.58f, 0.72f);
                frame.TrajectoryAlpha = 0.12f;
                return frame;
            }

            if (blocked)
            {
                frame.State = Status.Blocked;
                frame.Label = "ЛИНИЯ ПЕРЕКРЫТА";
                frame.Color = new Color(1f, 0.22f, 0.14f, 0.94f);
                frame.Width += 0.025f;
                frame.TrajectoryAlpha = 0.52f;
                return frame;
            }

            float quality = Mathf.InverseLerp(20f, 90f, chance);
            frame.Color = Color.Lerp(
                new Color(1f, 0.38f, 0.18f, 0.90f),
                new Color(0.54f, 0.94f, 0.48f, 0.94f), quality);
            frame.TrajectoryAlpha = Mathf.Lerp(0.14f, 0.26f, quality);
            return frame;
        }

        public void Present(Frame frame, Vector3 shooter, Vector3 target, bool worldVisible)
        {
            if (!frame.Visible || !worldVisible)
            {
                SetVisible(false, false);
                return;
            }

            EnsureRenderers();
            if (_ring == null || _trajectory == null) return;

            _ring.enabled = true;
            _ring.startWidth = frame.Width;
            _ring.endWidth = frame.Width;
            _ring.startColor = frame.Color;
            _ring.endColor = frame.Color;
            float y = target.y + 0.07f;
            for (int i = 0; i < RingSegments; i++)
            {
                float angle = Mathf.PI * 2f * i / RingSegments;
                _ring.SetPosition(i, new Vector3(
                    target.x + Mathf.Sin(angle) * frame.Radius,
                    y,
                    target.z + Mathf.Cos(angle) * frame.Radius));
            }

            Vector3 delta = target - shooter;
            delta.y = 0f;
            bool showTrajectory = frame.TrajectoryAlpha > 0.001f && delta.sqrMagnitude > 1f;
            _trajectory.enabled = showTrajectory;
            if (!showTrajectory) return;

            Color start = frame.Color;
            start.a = frame.TrajectoryAlpha * 0.18f;
            Color end = frame.Color;
            end.a = frame.TrajectoryAlpha;
            _trajectory.startColor = start;
            _trajectory.endColor = end;
            _trajectory.startWidth = 0.014f;
            _trajectory.endWidth = frame.State == Status.Blocked ? 0.055f : 0.028f;
            _trajectory.SetPosition(0, shooter + Vector3.up * 0.10f);
            _trajectory.SetPosition(1, target + Vector3.up * 0.10f);
        }

        public void Hide()
        {
            SetVisible(false, false);
        }

        private void EnsureRenderers()
        {
            if (_ring != null && _trajectory != null) return;
            Shader shader = Shader.Find("Sprites/Default")
                ?? Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            if (shader == null) return;
            _material = new Material(shader) { hideFlags = HideFlags.HideAndDontSave };
            _ring = CreateLine("TargetRing", true, RingSegments, 22);
            _trajectory = CreateLine("TargetTrajectory", false, 2, 21);
        }

        private LineRenderer CreateLine(string objectName, bool loop, int positions, int sortingOrder)
        {
            var lineObject = new GameObject(objectName);
            lineObject.transform.SetParent(transform, false);
            var line = lineObject.AddComponent<LineRenderer>();
            line.sharedMaterial = _material;
            line.useWorldSpace = true;
            line.loop = loop;
            line.positionCount = positions;
            line.alignment = LineAlignment.View;
            line.textureMode = LineTextureMode.Stretch;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            line.lightProbeUsage = LightProbeUsage.Off;
            line.reflectionProbeUsage = ReflectionProbeUsage.Off;
            line.sortingOrder = sortingOrder;
            line.enabled = false;
            return line;
        }

        private void SetVisible(bool ring, bool trajectory)
        {
            if (_ring != null) _ring.enabled = ring;
            if (_trajectory != null) _trajectory.enabled = trajectory;
        }

        private void OnDestroy()
        {
            if (_material == null) return;
            if (Application.isPlaying) Destroy(_material);
            else DestroyImmediate(_material);
            _material = null;
        }
    }
}
