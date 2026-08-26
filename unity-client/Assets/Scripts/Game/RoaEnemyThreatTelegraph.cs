using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// World-space attack tell driven by the server's remaining wind-up time.
    /// It owns presentation only: hit, miss and damage remain authoritative.
    /// </summary>
    public sealed class RoaEnemyThreatTelegraph : MonoBehaviour
    {
        private const int RingSegments = 36;

        public struct Frame
        {
            public bool Visible;
            public bool Ranged;
            public bool TargetsLocalPlayer;
            public float Progress;
            public float Radius;
            public float Width;
            public float AimAlpha;
            public Color Color;
        }

        private Material _material;
        private LineRenderer _ring;
        private LineRenderer _aim;

        public int ActiveRendererCount
        {
            get
            {
                int count = 0;
                if (_ring != null && _ring.enabled) count++;
                if (_aim != null && _aim.enabled) count++;
                return count;
            }
        }

        public static Frame Evaluate(float remainingSeconds, float windowSeconds,
                                     bool ranged, bool targetsLocalPlayer)
        {
            if (remainingSeconds <= 0f || windowSeconds <= 0.01f)
                return default(Frame);

            float progress = Mathf.Clamp01(1f - remainingSeconds / windowSeconds);
            float urgency = progress * progress * (3f - 2f * progress);
            float pulse = 0.5f + 0.5f * Mathf.Sin(progress * Mathf.PI * 7f);
            Color calm = targetsLocalPlayer
                ? new Color(1f, 0.72f, 0.20f, 1f)
                : new Color(0.92f, 0.58f, 0.18f, 1f);
            Color danger = targetsLocalPlayer
                ? new Color(1f, 0.16f, 0.08f, 1f)
                : new Color(1f, 0.42f, 0.12f, 1f);
            Color color = Color.Lerp(calm, danger, urgency);
            color.a = (targetsLocalPlayer ? 0.56f : 0.28f)
                + urgency * (targetsLocalPlayer ? 0.36f : 0.28f)
                + pulse * 0.06f;

            return new Frame
            {
                Visible = true,
                Ranged = ranged,
                TargetsLocalPlayer = targetsLocalPlayer,
                Progress = progress,
                Radius = Mathf.Lerp(ranged ? 1.08f : 0.92f, 0.42f, urgency),
                Width = Mathf.Lerp(0.045f, 0.095f, urgency),
                AimAlpha = ranged && targetsLocalPlayer
                    ? Mathf.Lerp(0.12f, 0.58f, urgency) : 0f,
                Color = color
            };
        }

        public void Present(Frame frame, Vector3 origin, Vector3 aimPoint, bool worldVisible)
        {
            if (!frame.Visible || !worldVisible)
            {
                SetVisible(false, false);
                return;
            }

            EnsureRenderers();
            if (_ring == null) return;

            _ring.enabled = true;
            _ring.startWidth = frame.Width;
            _ring.endWidth = frame.Width;
            _ring.startColor = frame.Color;
            _ring.endColor = frame.Color;
            float y = origin.y + 0.065f;
            for (int i = 0; i < RingSegments; i++)
            {
                float angle = Mathf.PI * 2f * i / RingSegments;
                _ring.SetPosition(i, new Vector3(
                    origin.x + Mathf.Sin(angle) * frame.Radius,
                    y,
                    origin.z + Mathf.Cos(angle) * frame.Radius));
            }

            bool showAim = frame.AimAlpha > 0.001f
                && (aimPoint - origin).sqrMagnitude > 0.1f;
            if (_aim == null || !showAim)
            {
                if (_aim != null) _aim.enabled = false;
                return;
            }

            _aim.enabled = true;
            Color aimColor = frame.Color;
            aimColor.a = frame.AimAlpha;
            _aim.startColor = aimColor;
            aimColor.a *= 0.18f;
            _aim.endColor = aimColor;
            _aim.startWidth = Mathf.Lerp(0.018f, 0.042f, frame.Progress);
            _aim.endWidth = 0.012f;
            _aim.SetPosition(0, origin + Vector3.up * 0.82f);
            _aim.SetPosition(1, aimPoint + Vector3.up * 0.14f);
        }

        private void EnsureRenderers()
        {
            if (_ring != null && _aim != null) return;
            Shader shader = Shader.Find("Sprites/Default")
                ?? Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            if (shader == null) return;
            _material = new Material(shader) { hideFlags = HideFlags.HideAndDontSave };

            _ring = CreateLine("ThreatRing", true, RingSegments);
            _aim = CreateLine("ThreatAim", false, 2);
        }

        private LineRenderer CreateLine(string objectName, bool loop, int positions)
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
            line.sortingOrder = 18;
            line.enabled = false;
            return line;
        }

        private void SetVisible(bool ring, bool aim)
        {
            if (_ring != null) _ring.enabled = ring;
            if (_aim != null) _aim.enabled = aim;
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
