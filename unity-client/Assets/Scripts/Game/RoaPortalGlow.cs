using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Портал перехода: светящееся пятно на земле с мягким краем и искры, которые
    /// медленно поднимаются над ним, как у точек добычи. Пятно пульсирует и
    /// разгорается, когда игрок подходит. Портал ворот вытянут вдоль проёма
    /// (`across` — ось ширины), портал места — квадрат со скруглённым краем.
    /// </summary>
    public sealed class RoaPortalGlow : MonoBehaviour
    {
        public const string ObjectName = "LocationPortalGlow";
        public static readonly Color PortalGold = new Color(1f, 0.74f, 0.3f, 1f);

        private const int TextureSize = 64;
        private static Texture2D _patchTexture;
        private static Material _sparkMaterial;

        private Material _patchMaterial;
        private Transform _player;
        private float _nextPlayerLookupAt;
        private float _reach;
        private Color _color;

        public float Width { get; private set; }
        public float Depth { get; private set; }
        public ParticleSystem Sparks { get; private set; }

        /// <summary>
        /// Портал с центром в `position`. `radius` — радиус срабатывания перехода;
        /// пятно покрывает его. `across` — ось ширины (для ворот — вдоль проёма);
        /// нулевой вектор — пятно квадратное.
        /// </summary>
        public static RoaPortalGlow Create(Transform parent, Vector3 position, float radius, Vector3 across, Color color)
        {
            radius = Mathf.Max(0.8f, radius);
            bool gate = across.sqrMagnitude > 0.0001f;
            var root = new GameObject(ObjectName);
            root.transform.SetParent(parent, false);
            root.transform.position = position;
            if (gate) root.transform.rotation = Quaternion.LookRotation(Vector3.Cross(across.normalized, Vector3.up), Vector3.up);
            var glow = root.AddComponent<RoaPortalGlow>();
            glow._color = color;
            glow.Width = radius * 2f;
            glow.Depth = gate ? radius * 1.1f : radius * 2f;
            glow._reach = radius + 10f;
            glow.BuildPatch();
            glow.BuildSparks();
            return glow;
        }

        private void BuildPatch()
        {
            var patch = new GameObject("PortalPatch");
            patch.transform.SetParent(transform, false);
            patch.transform.localPosition = new Vector3(0f, 0.06f, 0f);
            patch.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            patch.transform.localScale = new Vector3(Width, Depth, 1f);
            var mesh = patch.AddComponent<MeshFilter>();
            mesh.sharedMesh = QuadMesh;
            var renderer = patch.AddComponent<MeshRenderer>();
            _patchMaterial = CreatePatchMaterial();
            renderer.sharedMaterial = _patchMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            ApplyPatchColor(0.55f);
        }

        private void BuildSparks()
        {
            Material material = SparkMaterial;
            if (material == null) return;
            var holder = new GameObject("PortalSparks");
            holder.transform.SetParent(transform, false);
            holder.transform.localPosition = new Vector3(0f, 0.08f, 0f);
            var system = holder.AddComponent<ParticleSystem>();
            system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            Sparks = system;

            ParticleSystem.MainModule main = system.main;
            main.loop = true;
            main.prewarm = true;
            main.playOnAwake = true;
            main.duration = 4f;
            main.startLifetime = new ParticleSystem.MinMaxCurve(2.0f, 3.2f);
            main.startSpeed = 0f;
            main.startSize = new ParticleSystem.MinMaxCurve(0.14f, 0.3f);
            main.startColor = _color;
            float area = Width * Depth;
            main.maxParticles = Mathf.Clamp(Mathf.RoundToInt(area * 4f), 40, 220);
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.scalingMode = ParticleSystemScalingMode.Local;

            ParticleSystem.EmissionModule emission = system.emission;
            emission.rateOverTime = Mathf.Clamp(area * 0.9f, 10f, 60f);

            // Искры родятся по всему пятну, а не кольцом: видно, где именно проход.
            ParticleSystem.ShapeModule shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(Width * 0.92f, 0.05f, Depth * 0.92f);

            ParticleSystem.VelocityOverLifetimeModule velocity = system.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.Local;
            velocity.x = new ParticleSystem.MinMaxCurve(-0.05f, 0.05f);
            velocity.y = new ParticleSystem.MinMaxCurve(0.45f, 0.85f);
            velocity.z = new ParticleSystem.MinMaxCurve(-0.05f, 0.05f);

            ParticleSystem.NoiseModule noise = system.noise;
            noise.enabled = true;
            noise.strength = 0.14f;
            noise.frequency = 0.6f;
            noise.scrollSpeed = 0.25f;

            ParticleSystem.ColorOverLifetimeModule fade = system.colorOverLifetime;
            fade.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(0.95f, 0.2f), new GradientAlphaKey(0.55f, 0.6f), new GradientAlphaKey(0f, 1f) });
            fade.color = gradient;

            ParticleSystem.SizeOverLifetimeModule size = system.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 1f, 1f, 0.4f));

            var renderer = holder.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            if (Application.isPlaying) system.Play(true);
            else system.Simulate(3f, true, true);
        }

        private void Update()
        {
            if (_player == null && Time.unscaledTime >= _nextPlayerLookupAt)
            {
                _nextPlayerLookupAt = Time.unscaledTime + 0.5f;
                RoaGameBootstrap bootstrap = RoaGameBootstrap.Active;
                _player = bootstrap != null && bootstrap.PlayerView != null ? bootstrap.PlayerView.transform : null;
            }
            float near = 0f;
            if (_player != null)
            {
                Vector3 delta = _player.position - transform.position;
                delta.y = 0f;
                near = Mathf.InverseLerp(_reach, Mathf.Max(Width, Depth) * 0.5f, delta.magnitude);
            }
            float wave = (Mathf.Sin(Time.time * 2.2f) + 1f) * 0.5f;
            ApplyPatchColor(0.42f + near * 0.35f + wave * 0.12f);
        }

        private void ApplyPatchColor(float alpha)
        {
            if (_patchMaterial == null) return;
            var color = new Color(_color.r, _color.g, _color.b, Mathf.Clamp01(alpha));
            _patchMaterial.color = color;
            if (_patchMaterial.HasProperty("_BaseColor")) _patchMaterial.SetColor("_BaseColor", color);
        }

        private void OnDestroy()
        {
            if (_patchMaterial == null) return;
            if (Application.isPlaying) Destroy(_patchMaterial);
            else DestroyImmediate(_patchMaterial);
        }

        private static Material CreatePatchMaterial()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Sprites/Default") ?? Shader.Find("Unlit/Transparent");
            var material = new Material(shader) { name = "RoaPortalPatch", hideFlags = HideFlags.DontSave };
            Texture2D texture = PatchTexture;
            material.mainTexture = texture;
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.One);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.renderQueue = 3010;
            return material;
        }

        /// <summary>
        /// Пятно: яркая кромка, мягкий спад к краю и полупрозрачная середина.
        /// Скруглённый прямоугольник — чтобы вытянутый портал ворот не стал эллипсом.
        /// </summary>
        private static Texture2D PatchTexture
        {
            get
            {
                if (_patchTexture != null) return _patchTexture;
                _patchTexture = new Texture2D(TextureSize, TextureSize, TextureFormat.RGBA32, false)
                {
                    name = "RoaPortalPatch", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear,
                    hideFlags = HideFlags.DontSave
                };
                var pixels = new Color32[TextureSize * TextureSize];
                for (int y = 0; y < TextureSize; y++)
                for (int x = 0; x < TextureSize; x++)
                {
                    float u = Mathf.Abs((x + 0.5f) / TextureSize * 2f - 1f);
                    float v = Mathf.Abs((y + 0.5f) / TextureSize * 2f - 1f);
                    // Расстояние до скруглённого прямоугольника (0 — середина, 1 — край).
                    float qx = Mathf.Max(u - 0.55f, 0f), qy = Mathf.Max(v - 0.55f, 0f);
                    float edge = Mathf.Clamp01(Mathf.Max(Mathf.Max(u, v), 0.55f + Mathf.Sqrt(qx * qx + qy * qy)));
                    float rim = Mathf.Exp(-Mathf.Pow((edge - 0.86f) / 0.07f, 2f));
                    float body = Mathf.SmoothStep(1f, 0f, Mathf.InverseLerp(0.2f, 1f, edge)) * 0.45f;
                    float alpha = Mathf.Clamp01(Mathf.Max(rim, body)) * (edge >= 1f ? 0f : 1f);
                    pixels[y * TextureSize + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(alpha * 255f));
                }
                _patchTexture.SetPixels32(pixels);
                _patchTexture.Apply(false, true);
                return _patchTexture;
            }
        }

        private static Material SparkMaterial
        {
            get
            {
                if (_sparkMaterial != null) return _sparkMaterial;
                Shader shader = Resources.Load<Shader>("RealmOfAshes/TierGlow");
                if (shader == null) return null;
                _sparkMaterial = new Material(shader) { name = "RoaPortalSparks", hideFlags = HideFlags.DontSave };
                return _sparkMaterial;
            }
        }

        private static Mesh _quad;

        private static Mesh QuadMesh
        {
            get
            {
                if (_quad != null) return _quad;
                _quad = new Mesh { name = "RoaPortalQuad", hideFlags = HideFlags.DontSave };
                _quad.SetVertices(new[]
                {
                    new Vector3(-0.5f, -0.5f, 0f), new Vector3(0.5f, -0.5f, 0f),
                    new Vector3(0.5f, 0.5f, 0f), new Vector3(-0.5f, 0.5f, 0f)
                });
                _quad.SetUVs(0, new[] { new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(1f, 1f), new Vector2(0f, 1f) });
                _quad.SetTriangles(new[] { 0, 2, 1, 0, 3, 2 }, 0);
                _quad.RecalculateNormals();
                _quad.RecalculateBounds();
                return _quad;
            }
        }
    }
}
