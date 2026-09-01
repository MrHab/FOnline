using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Collider-free, low-contrast perimeter for the staged activity area.
    /// It makes distributed objectives read as one encounter without painting
    /// another permanent HUD panel over the world.
    /// </summary>
    public sealed class RoaActivityZoneMarker : MonoBehaviour
    {
        private const int Segments = 72;
        private LineRenderer _ring;
        private Material _material;
        private Color _color;
        private float _phase;

        public float Radius { get; private set; }
        public int SegmentCount { get { return _ring != null ? _ring.positionCount : 0; } }

        public void Configure(float radius, Color color)
        {
            Radius = Mathf.Clamp(radius, 4f, 80f);
            _color = color;
            _phase = Mathf.Abs(name.GetHashCode() % 997) / 997f * Mathf.PI * 2f;
            Build();
            ApplyColor(0.22f);
        }

        private void Build()
        {
            if (_ring != null) return;
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Sprites/Default");
            if (shader != null)
            {
                _material = new Material(shader) { name = "ActivityZoneMaterial" };
                if (_material.HasProperty("_Surface")) _material.SetFloat("_Surface", 1f);
                if (_material.HasProperty("_SrcBlend")) _material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                if (_material.HasProperty("_DstBlend")) _material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                if (_material.HasProperty("_ZWrite")) _material.SetFloat("_ZWrite", 0f);
                _material.renderQueue = 3005;
                _material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            }

            var ringObject = new GameObject("ActivityZonePerimeter");
            ringObject.transform.SetParent(transform, false);
            _ring = ringObject.AddComponent<LineRenderer>();
            _ring.useWorldSpace = false;
            _ring.loop = true;
            _ring.positionCount = Segments;
            _ring.startWidth = 0.065f;
            _ring.endWidth = 0.065f;
            _ring.sharedMaterial = _material;
            _ring.shadowCastingMode = ShadowCastingMode.Off;
            _ring.receiveShadows = false;
            for (int index = 0; index < Segments; index += 1)
            {
                float angle = index / (float)Segments * Mathf.PI * 2f;
                _ring.SetPosition(index, new Vector3(Mathf.Cos(angle) * Radius, 0.075f,
                    Mathf.Sin(angle) * Radius));
            }
        }

        private void Update()
        {
            if (_ring == null) return;
            float wave = Mathf.Sin(Time.unscaledTime * 1.35f + _phase);
            float width = 0.055f + (wave + 1f) * 0.012f;
            _ring.startWidth = width;
            _ring.endWidth = width;
            ApplyColor(0.18f + (wave + 1f) * 0.045f);
        }

        private void ApplyColor(float alpha)
        {
            Color value = new Color(_color.r, _color.g, _color.b, Mathf.Clamp01(alpha));
            if (_material != null)
            {
                _material.color = value;
                if (_material.HasProperty("_BaseColor")) _material.SetColor("_BaseColor", value);
            }
            if (_ring != null)
            {
                _ring.startColor = value;
                _ring.endColor = value;
            }
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
