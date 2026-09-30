using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Каталог префабов PolygonApocalypse для сборки мест: габариты при масштабе 1, коллайдеры,
    /// треугольники и листы превью с подписями. Им пользуется архитектор площадки: он выбирает
    /// модели по размеру и виду, не открывая Unity. Пак в git не входит, поэтому каталог
    /// пишется в каталог вывода (по умолчанию Library/PolygonCatalog), а не в репозиторий.
    ///
    /// Пакетно: -executeMethod RealmOfAshes.EditorTools.RoaPolygonCatalogProbe.RunBatch -quit
    /// ROA_POLY_OUT — каталог вывода, ROA_POLY_FOLDERS — папки Prefabs через запятую.
    /// </summary>
    public static class RoaPolygonCatalogProbe
    {
        private const string PrefabRoot = "Assets/Synty/PolygonApocalypse/Prefabs";
        private static readonly string[] DefaultFolders =
            { "Buildings", "Environment", "Props", "Vehicles", "Generic", "DeadBodies", "FX" };
        private const int Cell = 192;
        private const int LabelHeight = 36;
        private const int Columns = 8;
        private const int Rows = 6;
        private const int CaptureLayer = 30;
        private const int LabelLayer = 29;

        [MenuItem("Realm of Ashes/Sites/Build Polygon catalog")]
        public static void RunMenu() => Build();

        public static void RunBatch() => Build();

        private static void Build()
        {
            string output = Environment.GetEnvironmentVariable("ROA_POLY_OUT");
            if (string.IsNullOrWhiteSpace(output))
                output = Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/PolygonCatalog"));
            Directory.CreateDirectory(output);
            string folderList = Environment.GetEnvironmentVariable("ROA_POLY_FOLDERS");
            string[] folders = string.IsNullOrWhiteSpace(folderList)
                ? DefaultFolders
                : folderList.Split(',').Select(row => row.Trim()).Where(row => row.Length > 0).ToArray();

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.42f, 0.40f, 0.37f);
            var probe = new SphericalHarmonicsL2();
            probe.AddAmbientLight(RenderSettings.ambientLight);
            RenderSettings.ambientProbe = probe;
            RenderSettings.fog = false;

            var lightObject = new GameObject("CatalogSun");
            Light sun = lightObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.1f;
            sun.shadows = LightShadows.None;
            lightObject.transform.rotation = Quaternion.Euler(50f, 20f, 0f);

            Camera camera = new GameObject("CatalogCamera").AddComponent<Camera>();
            camera.orthographic = true;
            camera.cullingMask = 1 << CaptureLayer;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.30f, 0.29f, 0.27f);
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 2000f;
            camera.aspect = 1f;

            Camera labelCamera = new GameObject("CatalogLabelCamera").AddComponent<Camera>();
            labelCamera.orthographic = true;
            labelCamera.cullingMask = 1 << LabelLayer;
            labelCamera.clearFlags = CameraClearFlags.SolidColor;
            labelCamera.backgroundColor = new Color(0.08f, 0.08f, 0.08f);
            labelCamera.aspect = (float)Cell / LabelHeight;
            labelCamera.orthographicSize = LabelHeight * 0.5f * 0.01f;
            labelCamera.transform.position = new Vector3(0f, -500f, -10f);
            labelCamera.transform.rotation = Quaternion.identity;
            labelCamera.nearClipPlane = 0.01f;
            labelCamera.farClipPlane = 50f;

            var labelObject = new GameObject("CatalogLabel") { layer = LabelLayer };
            TextMesh label = labelObject.AddComponent<TextMesh>();
            label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            labelObject.GetComponent<MeshRenderer>().sharedMaterial = label.font.material;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.fontSize = 48;
            label.characterSize = 0.05f;
            label.color = new Color(0.95f, 0.93f, 0.85f);
            labelObject.transform.position = new Vector3(0f, -500f, 0f);

            var cellTarget = new RenderTexture(Cell, Cell, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            var labelTarget = new RenderTexture(Cell, LabelHeight, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            var cellPixels = new Texture2D(Cell, Cell, TextureFormat.RGBA32, false);
            var labelPixels = new Texture2D(Cell, LabelHeight, TextureFormat.RGBA32, false);
            var entries = new JArray();
            int total = 0;
            try
            {
                foreach (string folder in folders)
                {
                    string[] paths = AssetDatabase.FindAssets("t:Prefab", new[] { PrefabRoot + "/" + folder })
                        .Select(AssetDatabase.GUIDToAssetPath)
                        .Where(path => path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                        .Distinct()
                        .OrderBy(path => path, StringComparer.Ordinal)
                        .ToArray();
                    int perSheet = Columns * Rows;
                    for (int start = 0; start < paths.Length; start += perSheet)
                    {
                        string sheetName = folder + "-" + (start / perSheet + 1).ToString("00");
                        int count = Math.Min(perSheet, paths.Length - start);
                        int rows = (count + Columns - 1) / Columns;
                        var sheet = new Texture2D(Columns * Cell, rows * (Cell + LabelHeight), TextureFormat.RGBA32, false);
                        Color32[] fill = Enumerable.Repeat(new Color32(20, 20, 20, 255), sheet.width * sheet.height).ToArray();
                        sheet.SetPixels32(fill);
                        for (int index = 0; index < count; index++)
                        {
                            string path = paths[start + index];
                            JObject entry = Measure(path, folder, camera, cellTarget, cellPixels, out bool rendered);
                            entry["sheet"] = sheetName;
                            entry["cell"] = index;
                            entries.Add(entry);
                            total++;

                            int column = index % Columns;
                            int row = index / Columns;
                            int top = sheet.height - row * (Cell + LabelHeight);
                            if (rendered)
                                sheet.SetPixels(column * Cell, top - Cell, Cell, Cell, cellPixels.GetPixels());
                            RenderLabel(label, labelCamera, labelTarget, labelPixels,
                                (string)entry["name"], (JArray)entry["size"]);
                            sheet.SetPixels(column * Cell, top - Cell - LabelHeight, Cell, LabelHeight, labelPixels.GetPixels());
                        }
                        sheet.Apply();
                        File.WriteAllBytes(Path.Combine(output, sheetName + ".png"), sheet.EncodeToPNG());
                        UnityEngine.Object.DestroyImmediate(sheet);
                    }
                }
            }
            finally
            {
                cellTarget.Release();
                labelTarget.Release();
                UnityEngine.Object.DestroyImmediate(cellTarget);
                UnityEngine.Object.DestroyImmediate(labelTarget);
                UnityEngine.Object.DestroyImmediate(cellPixels);
                UnityEngine.Object.DestroyImmediate(labelPixels);
            }

            var catalog = new JObject
            {
                ["schema"] = "roa.polygonCatalog.v1",
                ["root"] = PrefabRoot,
                ["note"] = "size = габарит рендереров при масштабе 1 (x, y, z, метры); center = центр габарита от "
                           + "опоры префаба; minY = низ модели; colliders = типы коллайдеров префаба",
                ["prefabs"] = entries
            };
            File.WriteAllText(Path.Combine(output, "catalog.json"), catalog.ToString(Formatting.Indented));
            Debug.Log("[ROA POLYGON CATALOG] PASS: " + total + " prefabs, output " + output);
        }

        private static JObject Measure(string path, string folder, Camera camera, RenderTexture target,
                                       Texture2D pixels, out bool rendered)
        {
            rendered = false;
            var asset = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            var entry = new JObject
            {
                ["name"] = Path.GetFileNameWithoutExtension(path),
                ["category"] = folder,
                ["path"] = path
            };
            if (asset == null) return entry;
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(asset);
            try
            {
                instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                foreach (Transform part in instance.GetComponentsInChildren<Transform>(true))
                    part.gameObject.layer = CaptureLayer;
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer.enabled && renderer.gameObject.activeInHierarchy
                                       && !(renderer is ParticleSystemRenderer) && !(renderer is TrailRenderer)
                                       && !(renderer is LineRenderer))
                    .ToArray();
                bool hasParticles = instance.GetComponentsInChildren<ParticleSystem>(true).Length > 0;
                Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
                entry["colliders"] = new JObject(colliders
                    .GroupBy(collider => collider.GetType().Name.Replace("Collider", string.Empty).ToLowerInvariant())
                    .Select(group => new JProperty(group.Key, group.Count())));
                entry["tris"] = CountTriangles(instance);
                if (hasParticles) entry["fx"] = true;
                if (renderers.Length == 0)
                {
                    entry["size"] = new JArray(0, 0, 0);
                    return entry;
                }
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
                entry["size"] = new JArray(Round(bounds.size.x), Round(bounds.size.y), Round(bounds.size.z));
                entry["center"] = new JArray(Round(bounds.center.x), Round(bounds.center.y), Round(bounds.center.z));
                entry["minY"] = Round(bounds.min.y);

                Quaternion view = Quaternion.Euler(32f, 45f, 0f);
                camera.transform.rotation = view;
                camera.transform.position = bounds.center - view * Vector3.forward * (bounds.extents.magnitude * 2f + 5f);
                float half = 0.1f;
                foreach (Vector3 corner in Corners(bounds))
                {
                    Vector3 local = camera.transform.InverseTransformPoint(corner);
                    half = Mathf.Max(half, Mathf.Abs(local.x), Mathf.Abs(local.y));
                }
                camera.orthographicSize = half * 1.06f;
                camera.farClipPlane = bounds.extents.magnitude * 4f + 20f;
                camera.targetTexture = target;
                camera.Render();
                RenderTexture previous = RenderTexture.active;
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, Cell, Cell), 0, 0);
                pixels.Apply();
                RenderTexture.active = previous;
                camera.targetTexture = null;
                rendered = true;
                return entry;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        private static void RenderLabel(TextMesh label, Camera camera, RenderTexture target, Texture2D pixels,
                                        string name, JArray size)
        {
            string shortName = name.StartsWith("SM_", StringComparison.Ordinal) ? name.Substring(3) : name;
            if (shortName.Length > 34) shortName = shortName.Substring(0, 33) + "~";
            string dims = size != null && size.Count == 3
                ? string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0:0.0} x {1:0.0}  h {2:0.0}",
                    (double)size[0], (double)size[2], (double)size[1])
                : "";
            label.text = shortName + "\n" + dims;
            label.transform.localScale = Vector3.one;
            Bounds bounds = label.GetComponent<MeshRenderer>().bounds;
            float width = Cell * 0.01f * 0.96f;
            float height = LabelHeight * 0.01f * 0.92f;
            float scale = Mathf.Min(width / Mathf.Max(0.001f, bounds.size.x), height / Mathf.Max(0.001f, bounds.size.y));
            label.transform.localScale = Vector3.one * scale;
            camera.targetTexture = target;
            camera.Render();
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = target;
            pixels.ReadPixels(new Rect(0, 0, Cell, LabelHeight), 0, 0);
            pixels.Apply();
            RenderTexture.active = previous;
            camera.targetTexture = null;
        }

        private static int CountTriangles(GameObject root)
        {
            int triangles = 0;
            foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
                triangles += Triangles(filter.sharedMesh);
            foreach (SkinnedMeshRenderer skinned in root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                triangles += Triangles(skinned.sharedMesh);
            return triangles;
        }

        private static int Triangles(Mesh mesh)
        {
            if (mesh == null) return 0;
            long indices = 0;
            for (int submesh = 0; submesh < mesh.subMeshCount; submesh++) indices += mesh.GetIndexCount(submesh);
            return (int)(indices / 3);
        }

        private static IEnumerable<Vector3> Corners(Bounds bounds)
        {
            Vector3 min = bounds.min, max = bounds.max;
            for (int i = 0; i < 8; i++)
                yield return new Vector3((i & 1) == 0 ? min.x : max.x, (i & 2) == 0 ? min.y : max.y, (i & 4) == 0 ? min.z : max.z);
        }

        private static double Round(float value) => Math.Round(value, 2);
    }
}
