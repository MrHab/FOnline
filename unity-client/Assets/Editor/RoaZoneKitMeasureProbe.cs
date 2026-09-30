using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Замер префаба для набора зон: габариты меша при масштабе 1, центр относительно
    /// пивота и высота. Ими живёт data/zones/kit.json — руками такие числа не пишут.
    ///
    /// Запуск: -executeMethod RealmOfAshes.EditorTools.RoaZoneKitMeasureProbe.Measure
    /// с именами префабов в ROA_KIT_PREFABS (через запятую). Результат — JSON в
    /// Logs/zone-kit-measure.json.
    /// </summary>
    public static class RoaZoneKitMeasureProbe
    {
        private const string PrefabDir = "Assets/Prefabs/Kromka/RecoveredEnvironment";
        internal const string KitCollisionName = "KitCollision";

        public static void Measure()
        {
            string wanted = System.Environment.GetEnvironmentVariable("ROA_KIT_PREFABS") ?? string.Empty;
            string[] keys = wanted.Split(',');
            var text = new StringBuilder();
            text.Append("{\n");
            bool first = true;
            foreach (string raw in keys)
            {
                string key = raw.Trim();
                if (key.Length == 0) continue;
                string path = PrefabDir + "/" + key + ".prefab";
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) { Debug.LogError("[kit] нет префаба " + path); continue; }
                GameObject instance = Object.Instantiate(prefab);
                instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                instance.transform.localScale = Vector3.one;
                Bounds bounds = default;
                bool has = false;
                foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>(true))
                {
                    if (renderer == null || renderer is ParticleSystemRenderer) continue;
                    if (!has) { bounds = renderer.bounds; has = true; }
                    else bounds.Encapsulate(renderer.bounds);
                }
                bool solid = instance.GetComponentInChildren<Collider>(true) != null;
                // Префаб может сам назвать свои преграды (узел KitCollision): у
                // мастерской участка это здание и штабели у двора, а плоский двор
                // и мастер у рабочего места преградой не считаются. Коробок
                // больше одной — они уходят в `parts`, общий габарит — их сумма.
                Transform declared = instance.transform.Find(KitCollisionName);
                BoxCollider[] declaredBoxes = declared != null ? declared.GetComponents<BoxCollider>() : new BoxCollider[0];
                if (has && declaredBoxes.Length > 0)
                {
                    bounds = declaredBoxes[0].bounds;
                    foreach (BoxCollider box in declaredBoxes) bounds.Encapsulate(box.bounds);
                }
                var parts = new StringBuilder();
                if (declaredBoxes.Length > 1)
                {
                    parts.Append(", \"parts\": [");
                    for (int i = 0; i < declaredBoxes.Length; i++)
                    {
                        Bounds part = declaredBoxes[i].bounds;
                        if (i > 0) parts.Append(", ");
                        parts.Append("{\"size\": [").Append(N(part.size.x)).Append(", ").Append(N(part.size.z)).Append("], ");
                        parts.Append("\"height\": ").Append(N(part.size.y)).Append(", ");
                        parts.Append("\"center\": [").Append(N(part.center.x)).Append(", ").Append(N(part.center.z)).Append("]}");
                    }
                    parts.Append("]");
                }
                Object.DestroyImmediate(instance);
                if (!has) { Debug.LogError("[kit] у префаба нет мешей: " + key); continue; }
                if (!first) text.Append(",\n");
                first = false;
                text.Append("  \"").Append(key).Append("\": {");
                text.Append("\"size\": [").Append(N(bounds.size.x)).Append(", ").Append(N(bounds.size.z)).Append("], ");
                text.Append("\"height\": ").Append(N(bounds.size.y)).Append(", ");
                text.Append("\"center\": [").Append(N(bounds.center.x)).Append(", ").Append(N(bounds.center.z)).Append("], ");
                text.Append("\"solid\": ").Append(solid ? "true" : "false");
                text.Append(parts);
                text.Append("}");
            }
            text.Append("\n}\n");
            string output = Path.GetFullPath("Logs/zone-kit-measure.json");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            File.WriteAllText(output, text.ToString(), new UTF8Encoding(false));
            Debug.Log("[kit] замеры записаны: " + output);
        }

        private static string N(float value)
        {
            return System.Math.Round(value, 3).ToString(CultureInfo.InvariantCulture);
        }
    }
}
