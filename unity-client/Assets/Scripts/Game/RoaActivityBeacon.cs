using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Lightweight, collider-free objective beacon. It keeps activity targets
    /// readable above terrain and props without participating in gameplay.
    /// </summary>
    public sealed class RoaActivityBeacon : MonoBehaviour
    {
        private Transform _disc;
        private Transform _orb;
        private LineRenderer _ring;
        private LineRenderer _beam;
        private Material _material;
        private Color _color;
        private float _phase;
        private bool _completed;

        public void Configure(Color color, bool completed)
        {
            _color = color;
            _completed = completed;
            _phase = Mathf.Abs(name.GetHashCode() % 997) / 997f * Mathf.PI * 2f;
            Build();
            ApplyColor(1f);
        }

        private void Build()
        {
            if (_disc != null) return;
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Sprites/Default");
            if (shader != null)
            {
                _material = new Material(shader) { name = "ActivityBeaconMaterial" };
                _material.color = _color;
                if (_material.HasProperty("_BaseColor")) _material.SetColor("_BaseColor", _color);
                if (_material.HasProperty("_Surface")) _material.SetFloat("_Surface", 1f);
                if (_material.HasProperty("_SrcBlend")) _material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                if (_material.HasProperty("_DstBlend")) _material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                if (_material.HasProperty("_ZWrite")) _material.SetFloat("_ZWrite", 0f);
                _material.renderQueue = 3010;
                _material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            }

            GameObject disc = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            disc.name = "ObjectiveDisc";
            disc.transform.SetParent(transform, false);
            disc.transform.localPosition = new Vector3(0f, 0.055f, 0f);
            disc.transform.localScale = new Vector3(0.72f, 0.018f, 0.72f);
            RemoveCollider(disc);
            ApplyMaterial(disc.GetComponent<Renderer>());
            _disc = disc.transform;

            GameObject orb = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            orb.name = "ObjectiveOrb";
            orb.transform.SetParent(transform, false);
            orb.transform.localPosition = new Vector3(0f, 1.35f, 0f);
            orb.transform.localScale = Vector3.one * 0.22f;
            RemoveCollider(orb);
            ApplyMaterial(orb.GetComponent<Renderer>());
            _orb = orb.transform;

            _ring = CreateLine("ObjectiveRing", true, 48, 0.055f);
            for (int index = 0; index < _ring.positionCount; index++)
            {
                float angle = index / (float)_ring.positionCount * Mathf.PI * 2f;
                _ring.SetPosition(index, new Vector3(Mathf.Cos(angle) * 1.08f, 0.095f, Mathf.Sin(angle) * 1.08f));
            }

            _beam = CreateLine("ObjectiveBeam", false, 2, 0.045f);
            _beam.SetPosition(0, new Vector3(0f, 0.14f, 0f));
            _beam.SetPosition(1, new Vector3(0f, 1.28f, 0f));
        }

        private LineRenderer CreateLine(string objectName, bool loop, int positions, float width)
        {
            var lineObject = new GameObject(objectName);
            lineObject.transform.SetParent(transform, false);
            var line = lineObject.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.loop = loop;
            line.positionCount = positions;
            line.startWidth = width;
            line.endWidth = width;
            line.sharedMaterial = _material;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            return line;
        }

        private void Update()
        {
            if (_disc == null || _orb == null) return;
            float wave = Mathf.Sin(Time.unscaledTime * (_completed ? 1.7f : 2.8f) + _phase);
            float pulse = 1f + wave * (_completed ? 0.025f : 0.085f);
            _disc.localScale = new Vector3(0.72f * pulse, 0.018f, 0.72f * pulse);
            _ring.transform.localScale = new Vector3(pulse, 1f, pulse);
            _orb.localPosition = new Vector3(0f, 1.35f + wave * 0.11f, 0f);
            _orb.Rotate(0f, 55f * Time.unscaledDeltaTime, 0f, Space.Self);
            ApplyColor(_completed ? 0.58f : 0.82f + wave * 0.12f);
        }

        private void ApplyColor(float alpha)
        {
            if (_material == null) return;
            Color value = new Color(_color.r, _color.g, _color.b, Mathf.Clamp01(alpha));
            _material.color = value;
            if (_material.HasProperty("_BaseColor")) _material.SetColor("_BaseColor", value);
            if (_ring != null)
            {
                _ring.startColor = value;
                _ring.endColor = value;
            }
            if (_beam != null)
            {
                Color transparent = new Color(value.r, value.g, value.b, value.a * 0.08f);
                _beam.startColor = value;
                _beam.endColor = transparent;
            }
        }

        private void ApplyMaterial(Renderer renderer)
        {
            if (renderer == null || _material == null) return;
            renderer.sharedMaterial = _material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        private static void RemoveCollider(GameObject target)
        {
            Collider collider = target != null ? target.GetComponent<Collider>() : null;
            if (collider == null) return;
            collider.enabled = false;
            if (Application.isPlaying) Destroy(collider);
            else DestroyImmediate(collider);
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
