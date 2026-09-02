#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Каталог ассетов MEP для конвейера планирования глобальной карты:
    /// каждый префаб пака измеряется (габариты по рендерерам) и попадает в
    /// data/mep-catalog.json — палитру, по которой агенты-планировщики
    /// раскладывают окружение, не открывая Unity. Категория — путь внутри
    /// пака; флаг snow — по имени. Каталог детерминирован и пересоздаётся
    /// целиком при каждом запуске.
    /// </summary>
    public static class RoaMepCatalogExporter
    {
        private const string Root = "Assets/MEP";
        private const string OutputPath = "../../data/mep-catalog.json";

        [MenuItem("Realm of Ashes/Авторинг/Составить каталог MEP")]
        public static void Export()
        {
            string[] guids = AssetDatabase.FindAssets("t:Prefab",
                new[] { Root });
            var lines = new List<string>();
            int measured = 0;
            foreach (string guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) continue;

                MeshRenderer[] renderers =
                    prefab.GetComponentsInChildren<MeshRenderer>(true);
                if (renderers.Length == 0) continue;
                Bounds bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++)
                    bounds.Encapsulate(renderers[i].bounds);

                string category = Path.GetDirectoryName(path)
                    .Replace('\\', '/')
                    .Replace("Assets/MEP/", string.Empty)
                    .Replace("/Prefabs", string.Empty);
                bool snow = prefab.name.IndexOf("Snow",
                    System.StringComparison.OrdinalIgnoreCase) >= 0;

                lines.Add("  {\"name\":\"" + prefab.name
                    + "\",\"path\":\"" + path
                    + "\",\"category\":\"" + category
                    + "\",\"sizeX\":" + bounds.size.x.ToString("0.0",
                        System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"sizeY\":" + bounds.size.y.ToString("0.0",
                        System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"sizeZ\":" + bounds.size.z.ToString("0.0",
                        System.Globalization.CultureInfo.InvariantCulture)
                    + ",\"renderers\":" + renderers.Length
                    + ",\"snow\":" + (snow ? "true" : "false") + "}");
                measured++;
            }
            lines.Sort();

            var json = new StringBuilder();
            json.AppendLine("{");
            json.AppendLine("\"schema\":\"realm.mep-catalog.v1\",");
            json.AppendLine("\"count\":" + measured + ",");
            json.AppendLine("\"entries\":[");
            json.AppendLine(string.Join(",\n", lines));
            json.AppendLine("]}");

            string output = Path.GetFullPath(Path.Combine(
                Application.dataPath, OutputPath));
            File.WriteAllText(output, json.ToString());
            Debug.Log("[КАТАЛОГ MEP] префабов с мешами: " + measured
                + " → " + output);
        }
    }
}
#endif
