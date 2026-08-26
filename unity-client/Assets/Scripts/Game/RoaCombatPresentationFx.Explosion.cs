using UnityEngine;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaCombatPresentationFx
    {
        private ExplosionFx CreateExplosion(Vector3 center, float radius)
        {
            var root = new GameObject("PolishedExplosionFx");
            root.transform.SetParent(transform, false);
            root.transform.position = new Vector3(center.x, Mathf.Max(0.08f, center.y), center.z);

            Material shockMaterial = CreateTransparentMaterial(new Color(1f, 0.76f, 0.34f, 0.8f), true);
            Material heatMaterial = CreateTransparentMaterial(new Color(1f, 0.28f, 0.04f, 0.66f), true);
            LineRenderer shock = CreateRing(root.transform, "Shockwave", shockMaterial, 0.12f);
            LineRenderer heat = CreateRing(root.transform, "HeatRing", heatMaterial, 0.085f);

            Material coreMaterial = CreateTransparentMaterial(new Color(1f, 0.31f, 0.025f, 0.96f), true);
            Renderer core = CreateSphere(root.transform, "FireballCore", coreMaterial);
            Material glowMaterial = CreateTransparentMaterial(new Color(1f, 0.7f, 0.16f, 0.68f), true);
            Renderer glow = CreateSphere(root.transform, "FireballGlow", glowMaterial);

            Material smokeMaterial = CreateTransparentMaterial(new Color(0.22f, 0.19f, 0.16f, 0f), false);
            var smoke = new Renderer[ExplosionSmokeCount];
            var smokeOffsets = new Vector3[ExplosionSmokeCount];
            for (int i = 0; i < smoke.Length; i++)
            {
                smoke[i] = CreateSphere(root.transform, "Smoke" + i, smokeMaterial);
                float angle = (i + Next01() * 0.35f) / smoke.Length * Mathf.PI * 2f;
                smokeOffsets[i] = new Vector3(Mathf.Cos(angle), Mathf.Lerp(0.18f, 0.62f, Next01()), Mathf.Sin(angle));
            }

            Material emberMaterial = CreateTransparentMaterial(new Color(1f, 0.56f, 0.12f, 0.95f), true);
            var embers = new LineRenderer[ExplosionEmberCount];
            var emberVelocities = new Vector3[ExplosionEmberCount];
            for (int i = 0; i < embers.Length; i++)
            {
                embers[i] = CreateSparkLine(root.transform, "Ember" + i, emberMaterial, 0.032f);
                float angle = (i + Next01() * 0.5f) / embers.Length * Mathf.PI * 2f;
                Vector3 direction = new Vector3(Mathf.Cos(angle), Mathf.Lerp(0.35f, 1.1f, Next01()), Mathf.Sin(angle)).normalized;
                emberVelocities[i] = direction * Mathf.Lerp(1.5f, 3.1f, Next01());
            }

            Light light = root.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = new Color(1f, 0.39f, 0.07f);
            light.range = radius * 2.8f;
            light.intensity = 8f;
            light.shadows = LightShadows.None;

            return new ExplosionFx
            {
                Root = root,
                ShockRing = shock,
                ShockMaterial = shockMaterial,
                HeatRing = heat,
                HeatMaterial = heatMaterial,
                Core = core,
                CoreMaterial = coreMaterial,
                Glow = glow,
                GlowMaterial = glowMaterial,
                Smoke = smoke,
                SmokeMaterial = smokeMaterial,
                SmokeOffsets = smokeOffsets,
                Embers = embers,
                EmberMaterial = emberMaterial,
                EmberVelocities = emberVelocities,
                Light = light,
                Radius = radius,
                Started = Time.unscaledTime
            };
        }

        private void UpdateExplosion(ExplosionFx fx, float t)
        {
            float eased = 1f - Mathf.Pow(1f - t, 3f);
            float heatT = Mathf.Clamp01((t - 0.045f) / 0.74f);
            fx.ShockRing.transform.localScale = Vector3.one
                * Mathf.Lerp(fx.Radius * 0.08f, fx.Radius * 1.2f, eased);
            fx.HeatRing.transform.localScale = Vector3.one
                * Mathf.Lerp(fx.Radius * 0.06f, fx.Radius * 0.86f, 1f - Mathf.Pow(1f - heatT, 2f));
            fx.ShockRing.widthMultiplier = Mathf.Lerp(0.16f, 0.025f, t);
            fx.HeatRing.widthMultiplier = Mathf.Lerp(0.11f, 0.02f, heatT);
            SetMaterialAlpha(fx.ShockMaterial, 0.82f * (1f - t) * (1f - t));
            SetMaterialAlpha(fx.HeatMaterial, 0.7f * (1f - heatT));

            float corePhase = t < 0.24f ? Mathf.Lerp(0.12f, 0.62f, t / 0.24f)
                : Mathf.Lerp(0.62f, 0.16f, (t - 0.24f) / 0.76f);
            fx.Core.transform.localScale = Vector3.one * fx.Radius * corePhase;
            fx.Glow.transform.localScale = Vector3.one * fx.Radius
                * Mathf.Lerp(0.22f, 0.88f, eased) * (1f - t * 0.42f);
            SetMaterialColor(fx.CoreMaterial,
                Color.Lerp(new Color(1f, 0.9f, 0.48f), new Color(1f, 0.18f, 0.015f), t),
                0.98f * (1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.52f, 1f, t))), 4f);
            SetMaterialAlpha(fx.GlowMaterial, 0.66f * (1f - t) * (1f - t));

            float smokeT = Mathf.Clamp01((t - 0.13f) / 0.87f);
            float smokeAlpha = Mathf.Sin(smokeT * Mathf.PI) * 0.36f;
            SetMaterialColor(fx.SmokeMaterial,
                Color.Lerp(new Color(0.29f, 0.22f, 0.16f), new Color(0.12f, 0.13f, 0.13f), smokeT),
                smokeAlpha, 0f);
            for (int i = 0; i < fx.Smoke.Length; i++)
            {
                Vector3 offset = fx.SmokeOffsets[i];
                fx.Smoke[i].transform.localPosition = new Vector3(
                    offset.x * fx.Radius * smokeT * 0.3f,
                    offset.y * fx.Radius * (0.12f + smokeT * 0.42f),
                    offset.z * fx.Radius * smokeT * 0.3f);
                float scale = fx.Radius * Mathf.Lerp(0.08f, 0.38f + i * 0.018f, smokeT);
                fx.Smoke[i].transform.localScale = Vector3.one * scale;
            }

            float emberFade = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.35f, 1f, t));
            SetMaterialAlpha(fx.EmberMaterial, 0.96f * emberFade);
            for (int i = 0; i < fx.Embers.Length; i++)
            {
                Vector3 velocity = fx.EmberVelocities[i] * fx.Radius * 0.34f;
                Vector3 head = velocity * t + Vector3.down * (t * t * fx.Radius * 0.45f);
                Vector3 tail = head - velocity.normalized * Mathf.Lerp(0.22f, 0.045f, t);
                fx.Embers[i].SetPosition(0, tail);
                fx.Embers[i].SetPosition(1, head);
            }

            fx.Light.intensity = 8f * (1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0f, 0.55f, t)));
        }

        private void DestroyExplosion(ExplosionFx fx)
        {
            if (fx == null) return;
            DestroyMaterial(fx.ShockMaterial);
            DestroyMaterial(fx.HeatMaterial);
            DestroyMaterial(fx.CoreMaterial);
            DestroyMaterial(fx.GlowMaterial);
            DestroyMaterial(fx.SmokeMaterial);
            DestroyMaterial(fx.EmberMaterial);
            if (fx.Root != null) Destroy(fx.Root);
        }
    }
}
