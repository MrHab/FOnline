using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Точка добычи светится: у её основания медленно поднимаются редкие искры цвета
    /// тира. По ним видно, что это ресурс и его можно добывать, и какого он тира;
    /// сама модель остаётся без краски. Размер облака — по габаритам рендереров,
    /// поэтому вершины модели читать не нужно.
    /// </summary>
    public static class RoaTierGlow
    {
        public const string ChildName = "TierGlow";
        private static Material _material;

        private static Material GlowMaterial
        {
            get
            {
                if (_material != null) return _material;
                Shader shader = Resources.Load<Shader>("RealmOfAshes/TierGlow");
                if (shader == null) return null;
                _material = new Material(shader) { name = "RoaTierGlow", hideFlags = HideFlags.DontSave };
                return _material;
            }
        }

        public static ParticleSystem Attach(GameObject root, int tier)
        {
            if (root == null) return null;
            Transform old = root.transform.Find(ChildName);
            if (old != null)
            {
                if (Application.isPlaying) Object.Destroy(old.gameObject);
                else Object.DestroyImmediate(old.gameObject);
            }
            Material material = GlowMaterial;
            if (tier < 1 || material == null || !LocalBounds(root.transform, out Bounds bounds)) return null;

            var holder = new GameObject(ChildName);
            holder.layer = root.layer;
            holder.transform.SetParent(root.transform, false);
            // Искры родятся кольцом у основания, чуть шире модели, и идут вверх.
            float radius = Mathf.Clamp(Mathf.Max(bounds.extents.x, bounds.extents.z) * 0.9f, 0.25f, 1.6f);
            float rise = Mathf.Clamp(bounds.size.y * 0.6f, 0.5f, 1.6f);
            holder.transform.localPosition = new Vector3(bounds.center.x, bounds.min.y + 0.08f, bounds.center.z);
            // Облако живёт в мировом масштабе: чужой масштаб родителя его не искажает.
            Vector3 lossy = root.transform.lossyScale;
            holder.transform.localScale = new Vector3(1f / Mathf.Max(0.0001f, Mathf.Abs(lossy.x)),
                1f / Mathf.Max(0.0001f, Mathf.Abs(lossy.y)), 1f / Mathf.Max(0.0001f, Mathf.Abs(lossy.z)));
            radius *= Mathf.Abs(lossy.x);
            rise *= Mathf.Abs(lossy.y);

            var system = holder.AddComponent<ParticleSystem>();
            system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            Color color = RoaTierData.TierColor(tier);

            ParticleSystem.MainModule main = system.main;
            main.loop = true;
            main.prewarm = true;
            main.playOnAwake = true;
            main.duration = 4f;
            main.startLifetime = new ParticleSystem.MinMaxCurve(2.2f, 3.4f);
            main.startSpeed = 0f;
            float spark = Mathf.Clamp(radius / 0.8f, 0.45f, 1.6f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.16f * spark, 0.28f * spark);
            main.startColor = color;
            main.maxParticles = 60;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.scalingMode = ParticleSystemScalingMode.Local;

            ParticleSystem.EmissionModule emission = system.emission;
            emission.rateOverTime = Mathf.Clamp(8f * radius, 6f, 14f);

            ParticleSystem.ShapeModule shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Circle;
            shape.radius = radius;
            shape.radiusThickness = 0.35f;
            shape.rotation = new Vector3(90f, 0f, 0f);

            ParticleSystem.VelocityOverLifetimeModule velocity = system.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.Local;
            float up = rise / 2.8f;
            velocity.x = new ParticleSystem.MinMaxCurve(-0.04f, 0.04f);
            velocity.y = new ParticleSystem.MinMaxCurve(up * 0.7f, up * 1.3f);
            velocity.z = new ParticleSystem.MinMaxCurve(-0.04f, 0.04f);

            ParticleSystem.NoiseModule noise = system.noise;
            noise.enabled = true;
            noise.strength = 0.12f;
            noise.frequency = 0.6f;
            noise.scrollSpeed = 0.25f;

            // Искра разгорается, мерцает и гаснет наверху.
            ParticleSystem.ColorOverLifetimeModule fade = system.colorOverLifetime;
            fade.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(0.95f, 0.2f), new GradientAlphaKey(0.6f, 0.6f), new GradientAlphaKey(0f, 1f) });
            fade.color = gradient;

            ParticleSystem.SizeOverLifetimeModule size = system.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 1f, 1f, 0.45f));

            var renderer = holder.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            if (Application.isPlaying) system.Play(true);
            else system.Simulate(3f, true, true);
            return system;
        }

        /// <summary>Габариты видимых рендереров под root в его координатах.</summary>
        private static bool LocalBounds(Transform root, out Bounds bounds)
        {
            bounds = default;
            bool any = false;
            Matrix4x4 toLocal = root.worldToLocalMatrix;
            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(false))
            {
                if (!renderer.enabled || renderer is ParticleSystemRenderer) continue;
                Bounds world = renderer.bounds;
                Vector3 min = world.min, max = world.max;
                for (int i = 0; i < 8; i++)
                {
                    Vector3 corner = toLocal.MultiplyPoint3x4(new Vector3(
                        (i & 1) == 0 ? min.x : max.x, (i & 2) == 0 ? min.y : max.y, (i & 4) == 0 ? min.z : max.z));
                    if (!any) { bounds = new Bounds(corner, Vector3.zero); any = true; }
                    else bounds.Encapsulate(corner);
                }
            }
            return any;
        }
    }
}
