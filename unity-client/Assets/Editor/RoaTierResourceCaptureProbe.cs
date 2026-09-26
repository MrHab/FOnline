#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Листы ресурсов по тирам: для каждого семейства из data/kromka/tiers.json —
    /// префабы PolygonApocalypse точки добычи, сырья и полуфабриката T1–T5
    /// (поле visuals) с названиями из серверного каталога.
    /// Снимки — Library/TierScreen/tier-resources-(семейство).png.
    /// </summary>
    public static class RoaTierResourceCaptureProbe
    {
        private const int CaptureLayer = 31;
        private const int Width = 1240;
        private const int Cell = 200;
        private const string PackRoot = "Assets/Synty/PolygonApocalypse/Prefabs/";
        private static readonly string OutputDir = Path.Combine("Library", "TierScreen");
        private static readonly string[] RowNames = { "Точка добычи", "Сырьё", "Полуфабрикат" };

        [MenuItem("Realm of Ashes/Probe/Tiers: resource sheets")]
        public static void Run()
        {
            Directory.CreateDirectory(OutputDir);
            RoaTierCraftCaptureProbe.LoadServerCatalogs();
            JObject tiers = JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "..", "..", "data", "kromka", "tiers.json")));
            var missing = new List<string>();
            foreach (JObject family in (JArray)tiers["families"])
                CaptureFamily(family, missing);
            CheckNodeSwap(missing);
            if (missing.Count > 0) throw new InvalidOperationException("[TIER RESOURCES] нет префабов: " + string.Join(", ", missing));
            Debug.Log("[TIER RESOURCES] OK: листы в " + OutputDir);
        }

        private static void CaptureFamily(JObject family, List<string> missing)
        {
            string id = family["id"].ToString();
            JObject visuals = (JObject)family["visuals"];
            JToken[][] prefabs =
            {
                ((JArray)visuals["nodes"]).ToArray(),
                ((JArray)visuals["raw"]).ToArray(),
                ((JArray)visuals["refined"]).ToArray()
            };
            string[][] items =
            {
                new string[5],
                ((JArray)family["raw"]["ids"]).ToObject<string[]>(),
                ((JArray)family["refined"]["ids"]).ToObject<string[]>()
            };
            int height = 110 + 3 * (Cell + 64);
            var renders = new List<Texture2D>();
            GameObject root = null;
            try
            {
                root = new GameObject("TierResourceSheet");
                var canvasGo = new GameObject("Canvas", typeof(RectTransform));
                canvasGo.transform.SetParent(root.transform, false);
                Canvas canvas = canvasGo.AddComponent<Canvas>();
                canvasGo.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
                var panel = (RectTransform)canvasGo.transform;

                Text title = Label(panel, family["name"] + " — префабы PolygonApocalypse по тирам", 22, FontStyle.Bold);
                Place(title.rectTransform, 24, 18, Width - 48, 32);
                for (int tier = 1; tier <= 5; tier++)
                {
                    Text head = Label(panel, "T" + tier, 22, FontStyle.Bold);
                    head.alignment = TextAnchor.MiddleCenter;
                    Place(head.rectTransform, ColumnX(tier), 62, Cell, 28);
                }
                for (int row = 0; row < 3; row++)
                {
                    float y = 100 + row * (Cell + 64);
                    var band = new GameObject("Band", typeof(RectTransform), typeof(Image));
                    band.transform.SetParent(panel, false);
                    band.GetComponent<Image>().color = row % 2 == 0 ? new Color(0.17f, 0.16f, 0.13f) : new Color(0.14f, 0.13f, 0.11f);
                    Place((RectTransform)band.transform, 16, y - 4, Width - 32, Cell + 60);
                    Text rowName = Label(panel, RowNames[row], 16, FontStyle.Bold);
                    Place(rowName.rectTransform, 26, y + Cell / 2f - 12, 170, 26);
                    for (int tier = 1; tier <= 5; tier++)
                    {
                        float x = ColumnX(tier);
                        if (prefabs[row].Length < tier)
                        {
                            Text none = Label(panel, "шкура снимается\nс убитого зверя", 13, FontStyle.Normal);
                            none.alignment = TextAnchor.MiddleCenter;
                            Place(none.rectTransform, x, y + Cell / 2f - 20, Cell, 40);
                            continue;
                        }
                        JToken visual = prefabs[row][tier - 1];
                        string path = visual is JObject entry ? entry["prefab"].ToString() : visual.ToString();
                        string hex = visual is JObject tinted ? tinted["tint"]?.ToString() : null;
                        Color tint = !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out Color parsed) ? parsed : Color.white;
                        bool paint = visual is JObject painted && painted["paint"]?.Type == JTokenType.Boolean && painted["paint"].ToObject<bool>();
                        Texture2D render = RenderPrefab(path, tint, paint, out float size);
                        if (render == null) { missing.Add(path); continue; }
                        renders.Add(render);
                        RawImage image = Raw(panel, render);
                        Place(image.rectTransform, x, y, Cell, Cell);
                        string itemId = items[row][tier - 1];
                        string shown = Path.GetFileName(path).Replace("SM_", string.Empty)
                            + (string.IsNullOrEmpty(hex) ? string.Empty : (paint ? " заливка " : " оттенок ") + hex)
                            + " · " + size.ToString("0.0") + " м";
                        string caption = string.IsNullOrEmpty(itemId) ? shown : RoaItemData.Name(itemId) + "\n" + shown;
                        Text label = Label(panel, caption, 12, FontStyle.Normal);
                        label.alignment = TextAnchor.UpperCenter;
                        Place(label.rectTransform, x - 10, y + Cell + 4, Cell + 20, 52);
                    }
                }
                Render(canvas, height, Path.Combine(OutputDir, "tier-resources-" + id + ".png"));
            }
            finally
            {
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                foreach (Texture2D texture in renders) UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        /// <summary>
        /// Клиентская подмена точки добычи (RoaInteraction.ApplyTierNodeVisual) на
        /// настоящих префабах набора зон: модель тира на месте, прежние меши погашены.
        /// </summary>
        private static void CheckNodeSwap(List<string> failures)
        {
            var apply = typeof(RoaInteraction).GetMethod("ApplyTierNodeVisual",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            if (apply == null) { failures.Add("нет RoaInteraction.ApplyTierNodeVisual"); return; }
            var kit = new Dictionary<string, string> { { "ore", "ore_outcrop" }, { "wood", "dead_tree_a" }, { "fiber", "dry_bush" }, { "oil", "oil_pump_jack" } };
            foreach (KeyValuePair<string, string> pair in kit)
                for (int tier = 1; tier <= 5; tier++)
                {
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/Kromka/RecoveredEnvironment/" + pair.Value + ".prefab");
                    GameObject root = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                    try
                    {
                        apply.Invoke(null, new object[] { root, pair.Key, tier });
                        apply.Invoke(null, new object[] { root, pair.Key, tier });
                        Transform visual = root.transform.Find("TierResourceVisual");
                        GameObject expected = RoaApocalypseModels.TierNode(pair.Key, tier);
                        if (expected == null || visual == null) { failures.Add(pair.Key + " T" + tier + ": модель тира не поставлена"); continue; }
                        if (root.transform.childCount != prefab.transform.childCount + 1)
                            failures.Add(pair.Key + " T" + tier + ": повторный вызов добавил вторую модель");
                        foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
                            if (renderer.enabled != renderer.transform.IsChildOf(visual))
                                failures.Add(pair.Key + " T" + tier + ": видна не та модель (" + renderer.name + ")");
                        if (Vector3.Distance(visual.lossyScale, expected.transform.localScale) > 0.001f)
                            failures.Add(pair.Key + " T" + tier + ": модель пака не в родном размере");
                        Color tint = RoaApocalypseModels.TierNodeTint(pair.Key, tier);
                        if (tint != Color.white)
                        {
                            var block = new MaterialPropertyBlock();
                            visual.GetComponentInChildren<Renderer>().GetPropertyBlock(block);
                            if (block.GetColor("_BaseColor") != tint)
                                failures.Add(pair.Key + " T" + tier + ": оттенок тира не применён");
                        }
                    }
                    finally { UnityEngine.Object.DestroyImmediate(root); }
                }
        }

        private static float ColumnX(int tier) => 210 + (tier - 1) * 204;

        /// <summary>Префаб пака в авторском размере, снятый камерой по своим габаритам.</summary>
        private static Texture2D RenderPrefab(string packPath, Color tint, bool paint, out float largest)
        {
            largest = 0f;
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PackRoot + packPath + ".prefab");
            if (prefab == null) return null;
            GameObject instance = null, cameraGo = null;
            var lights = new List<GameObject>();
            RenderTexture target = null;
            RenderTexture previous = RenderTexture.active;
            AmbientMode savedMode = RenderSettings.ambientMode;
            Color savedAmbient = RenderSettings.ambientLight;
            try
            {
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = new Color(0.42f, 0.43f, 0.46f);
                instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(0f, -12000f, 0f);
                SetLayer(instance, CaptureLayer);
                RoaApocalypseModels.ApplyTint(instance, tint, paint);
                var bounds = new Bounds(instance.transform.position, Vector3.zero);
                bool first = true;
                foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>())
                {
                    if (first) { bounds = renderer.bounds; first = false; }
                    else bounds.Encapsulate(renderer.bounds);
                }
                float size = Mathf.Max(bounds.extents.magnitude, 0.05f);
                largest = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);

                cameraGo = new GameObject("NodeCamera");
                Camera camera = cameraGo.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.36f, 0.38f, 0.40f, 1f);
                camera.fieldOfView = 30f;
                camera.allowHDR = false;
                camera.allowMSAA = false;
                UniversalAdditionalCameraData data = camera.GetUniversalAdditionalCameraData();
                data.renderPostProcessing = false;
                data.renderShadows = false;
                Vector3 direction = new Vector3(1f, 0.75f, -1.3f).normalized;
                camera.transform.position = bounds.center + direction * size / Mathf.Sin(15f * Mathf.Deg2Rad);
                camera.transform.LookAt(bounds.center);
                camera.nearClipPlane = 0.01f;
                camera.farClipPlane = size * 20f;

                foreach (var (euler, intensity) in new[] { (new Vector3(40f, -30f, 0f), 1.4f), (new Vector3(20f, 150f, 0f), 0.6f) })
                {
                    var lightGo = new GameObject("NodeLight");
                    Light light = lightGo.AddComponent<Light>();
                    light.type = LightType.Directional;
                    light.intensity = intensity;
                    light.cullingMask = 1 << CaptureLayer;
                    light.shadows = LightShadows.None;
                    lightGo.transform.rotation = Quaternion.Euler(euler);
                    lights.Add(lightGo);
                }

                target = new RenderTexture(Cell, Cell, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
                target.Create();
                camera.targetTexture = target;
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = target });
                else camera.Render();
                RenderTexture.active = target;
                var readback = new Texture2D(Cell, Cell, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0, 0, Cell, Cell), 0, 0);
                readback.Apply();
                return readback;
            }
            finally
            {
                RenderSettings.ambientMode = savedMode;
                RenderSettings.ambientLight = savedAmbient;
                RenderTexture.active = previous;
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                if (instance != null) UnityEngine.Object.DestroyImmediate(instance);
                if (cameraGo != null) UnityEngine.Object.DestroyImmediate(cameraGo);
                foreach (GameObject light in lights) UnityEngine.Object.DestroyImmediate(light);
            }
        }

        private static void Render(Canvas canvas, int height, string path)
        {
            GameObject cameraGo = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                SetLayer(canvas.gameObject, CaptureLayer);
                cameraGo = new GameObject("SheetCamera");
                Camera camera = cameraGo.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.10f, 0.10f, 0.09f, 1f);
                target = new RenderTexture(Width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                target.Create();
                camera.targetTexture = target;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = target });
                else camera.Render();
                RenderTexture.active = target;
                readback = new Texture2D(Width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0, 0, Width, height), 0, 0);
                readback.Apply();
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                if (cameraGo != null) UnityEngine.Object.DestroyImmediate(cameraGo);
            }
        }

        private static Text Label(RectTransform parent, string text, int size, FontStyle style)
        {
            var go = new GameObject("Label", typeof(RectTransform));
            go.transform.SetParent(parent, false);
            Text label = go.AddComponent<Text>();
            label.font = RoaUiFont.Default;
            label.fontSize = size;
            label.fontStyle = style;
            label.color = new Color(0.93f, 0.86f, 0.66f);
            label.text = text;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.verticalOverflow = VerticalWrapMode.Overflow;
            return label;
        }

        private static RawImage Raw(RectTransform parent, Texture texture)
        {
            var go = new GameObject("Image", typeof(RectTransform));
            go.transform.SetParent(parent, false);
            RawImage image = go.AddComponent<RawImage>();
            image.texture = texture;
            return image;
        }

        /// <summary>Прямоугольник от левого верхнего угла холста, в пикселях.</summary>
        private static void Place(RectTransform rect, float x, float y, float width, float height)
        {
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = new Vector2(x, -y);
            rect.sizeDelta = new Vector2(width, height);
        }

        private static void SetLayer(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform) SetLayer(child.gameObject, layer);
        }
    }
}
#endif
