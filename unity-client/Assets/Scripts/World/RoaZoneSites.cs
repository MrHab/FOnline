using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Площадки мест, стоящих прямо в зоне (src/server/zone-sites.js): аванпост, точка
    /// добычи, кланбаза. Строки приходят в определении зоны (`sites`). Здесь — та же
    /// геометрия, что у сервера (повёрнутый прямоугольник), и белая черта по краю
    /// безопасного островка: за ней не стреляют, и игрок должен видеть, где она.
    /// </summary>
    public static class RoaZoneSites
    {
        private const float LineWidth = 0.28f;
        private const float LineHeight = 0.035f;

        /// <summary>Внутри ли точка (метры сцены) хоть одной площадки; margin расширяет их.</summary>
        public static bool Contains(JArray sites, float x, float z, float margin = 0f)
        {
            if (sites == null) return false;
            foreach (JToken site in sites)
                if (site is JObject row && Inside(row, x, z, margin)) return true;
            return false;
        }

        public static bool Inside(JObject site, float x, float z, float margin = 0f)
        {
            float dx = x - Value(site, "x");
            float dz = z - Value(site, "z");
            float yaw = Value(site, "rotationY");
            float cos = Mathf.Cos(yaw), sin = Mathf.Sin(yaw);
            float localX = dx * cos - dz * sin;
            float localZ = dx * sin + dz * cos;
            return Mathf.Abs(localX) <= Value(site, "halfX") + margin && Mathf.Abs(localZ) <= Value(site, "halfZ") + margin;
        }

        /// <summary>Белая черта по краю каждого безопасного островка зоны.</summary>
        public static GameObject BuildBoundaries(JArray sites, Transform parent)
        {
            if (sites == null || sites.Count == 0) return null;
            var root = new GameObject("ZoneSiteBoundaries");
            root.transform.SetParent(parent, false);
            Material paint = null;
            foreach (JToken token in sites)
            {
                if (!(token is JObject site) || site["safe"]?.ToObject<bool>() != true) continue;
                if (paint == null) paint = PaintMaterial();
                float halfX = Value(site, "halfX"), halfZ = Value(site, "halfZ");
                var center = new Vector3(Value(site, "x"), 0f, Value(site, "z"));
                Quaternion rotation = Quaternion.Euler(0f, Value(site, "rotationY") * Mathf.Rad2Deg, 0f);
                var group = new GameObject("SafeLine_" + (site["id"]?.ToString() ?? "site"));
                group.transform.SetParent(root.transform, false);
                group.transform.SetPositionAndRotation(center, rotation);
                Stripe(group.transform, new Vector3(0f, LineHeight, halfZ), new Vector2(halfX * 2f + LineWidth, LineWidth), paint);
                Stripe(group.transform, new Vector3(0f, LineHeight, -halfZ), new Vector2(halfX * 2f + LineWidth, LineWidth), paint);
                Stripe(group.transform, new Vector3(halfX, LineHeight, 0f), new Vector2(LineWidth, halfZ * 2f), paint);
                Stripe(group.transform, new Vector3(-halfX, LineHeight, 0f), new Vector2(LineWidth, halfZ * 2f), paint);
            }
            return root;
        }

        private static void Stripe(Transform parent, Vector3 localPosition, Vector2 size, Material material)
        {
            GameObject stripe = GameObject.CreatePrimitive(PrimitiveType.Quad);
            stripe.name = "Stripe";
            Object.Destroy(stripe.GetComponent<Collider>());
            stripe.transform.SetParent(parent, false);
            stripe.transform.localPosition = localPosition;
            stripe.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            stripe.transform.localScale = new Vector3(size.x, size.y, 1f);
            var renderer = stripe.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = true;
        }

        private static Material PaintMaterial()
        {
            // Известь на земле: светлая, но не светится ночью — берёт свет сцены.
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader) { name = "SafeLinePaint" };
            var color = new Color(0.9f, 0.88f, 0.82f);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.1f);
            return material;
        }

        private static float Value(JObject row, string key)
        {
            JToken token = row?[key];
            return token == null || token.Type == JTokenType.Null ? 0f : token.ToObject<float>();
        }
    }
}
