#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Checks all species in a real zone without changing the open scene.</summary>
    [InitializeOnLoad]
    public static class RoaZoneLairDressingProbe
    {
        private static readonly string Project = Directory.GetParent(Application.dataPath).FullName;
        private static readonly string Request = Path.Combine(Project, "Library/LairProbe.request");
        private static readonly string Result = Path.Combine(Project, "Library/LairProbe.result.json");
        private static bool _running;

        static RoaZoneLairDressingProbe() { EditorApplication.update += Poll; }

        private static void Poll()
        {
            if (_running || EditorApplication.isCompiling || EditorApplication.isUpdating ||
                EditorApplication.isPlayingOrWillChangePlaymode || !File.Exists(Request)) return;
            File.Delete(Request);
            Run();
        }

        [MenuItem("Realm of Ashes/Проверить оформление логов")]
        public static void Run()
        {
            if (_running) return;
            _running = true;
            Scene preview = default;
            PreviewRenderUtility renderer = null;
            GameObject host = null;
            try
            {
                File.WriteAllText(Result, new JObject { ["status"] = "running" }.ToString());
                string repo = Environment.GetEnvironmentVariable("ROA_REPO") ??
                    Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
                var ecology = JObject.Parse(File.ReadAllText(Path.Combine(repo, "data/kromka/danger-ecology.json")));
                var species = ((JArray)ecology["species"]).OfType<JObject>()
                    .Where(row => row["kind"]?.ToString() != "traveller").ToArray();
                Require(species.Length == RoaZoneLairDressing.ThemeCount, "Every resident species needs a theme");
                if (RoaLairPropCatalog.Instance == null) RoaLairPropCatalogBuilder.Build();
                Require(RoaLairPropCatalog.Instance != null, "PolygonApocalypse lair catalog is missing");
                var definition = JObject.Parse(File.ReadAllText(
                    Path.Combine(repo, "data/zones/authored/z_01_05.json"))).ToObject<LocationDefinition>();
                Require(definition.Zone?["lairs"] is JArray, "Authored zone has no lair anchor");
                JObject lair = (JObject)((JArray)definition.Zone["lairs"])[0];
                float x = (lair["tx"].Value<int>() - definition.TileWidth / 2f + 0.5f) * definition.TileStep;
                float z = (lair["tz"].Value<int>() - definition.TileDepth / 2f + 0.5f) * definition.TileStep;
                Vector3 focus = new Vector3(x, 0.5f, z);
                preview = EditorSceneManager.OpenPreviewScene("Assets/Scenes/Kromka/Locations/z_01_05.unity");
                Require(preview.IsValid(), "Authored zone scene did not open");
                renderer = new PreviewRenderUtility();
                renderer.camera.clearFlags = CameraClearFlags.SolidColor;
                renderer.camera.fieldOfView = 44f;
                renderer.camera.nearClipPlane = 0.1f;
                renderer.camera.farClipPlane = 170f;
                renderer.ambientColor = new Color(0.22f, 0.21f, 0.19f);
                int nearbyModels = 0;
                foreach (GameObject root in preview.GetRootGameObjects())
                    foreach (Renderer source in root.GetComponentsInChildren<Renderer>(true))
                    {
                        if (!source.enabled || source.bounds.SqrDistance(focus) > 28f * 28f) continue;
                        GameObject nearby = UnityEngine.Object.Instantiate(source.gameObject);
                        nearby.transform.SetPositionAndRotation(source.transform.position, source.transform.rotation);
                        nearby.transform.localScale = source.transform.lossyScale;
                        renderer.AddSingleGO(nearby);
                        nearbyModels++;
                    }
                Require(nearbyModels > 0 && nearbyModels < 500,
                    "Unexpected nearby zone renderer count: " + nearbyModels);
                Debug.Log("[ROA] Lair preview nearby scene renderers: " + nearbyModels);
                EditorSceneManager.ClosePreviewScene(preview);
                preview = default;
                string output = Path.Combine(Project, "Library/LairProbe");
                Directory.CreateDirectory(output);

                var camera = renderer.camera;
                camera.transform.position = focus + new Vector3(0f, 11f, -19f);
                camera.transform.LookAt(focus);
                var light = renderer.lights[0];
                light.transform.rotation = Quaternion.Euler(48f, -35f, 0f);

                foreach (JObject row in species)
                {
                    string id = row["id"].ToString();
                    Require(RoaZoneLairDressing.HasTheme(id), "Missing lair theme: " + id);
                    lair["speciesId"] = id;
                    host = new GameObject("LairProbe_" + id);
                    renderer.AddSingleGO(host);
                    Require(RoaZoneLairDressing.Build(definition, host.transform) == 1,
                        "Lair was not placed: " + id);
                    Transform group = host.transform.GetChild(0).GetChild(0);
                    Require(group.GetComponentsInChildren<Renderer>(true).Length >= 4,
                        "Lair lacks visible traces: " + id);
                    foreach (Transform prop in group)
                    {
                        Require(prop.name.StartsWith("LairProp_", StringComparison.Ordinal),
                            "Unexpected lair visual: " + prop.name);
                        GameObject source = RoaLairPropCatalog.Instance.Find(
                            prop.name.Substring("LairProp_".Length));
                        string path = AssetDatabase.GetAssetPath(source);
                        Require(path.StartsWith("Assets/Synty/PolygonApocalypse/Prefabs/", StringComparison.Ordinal),
                            "Non-PolygonApocalypse lair model: " + prop.name + " source=" +
                            (source != null ? source.name : "NULL") + " path=" + path);
                    }
                    Require(group.GetComponentsInChildren<Collider>(true).All(c => !c.enabled),
                        "Lair visual blocks gameplay: " + id);
                    Require(!group.GetComponentsInChildren<Text>(true).Any() &&
                        !group.GetComponentsInChildren<TextMesh>(true).Any() &&
                        !group.GetComponentsInChildren<Canvas>(true).Any() &&
                        !group.GetComponentsInChildren<Component>(true).Any(c =>
                            c != null && c.GetType().FullName.StartsWith("TMPro.", StringComparison.Ordinal)),
                        "Lair contains lettering: " + id);
                    Require(group.GetComponentsInChildren<Transform>(true).Any(t =>
                        t.name == Signature(id)), "Species trace missing: " + id);
                    if (id == "raider_band")
                        foreach (string required in new[] { "SM_Prop_Tent_Dome_01",
                            "SM_Prop_Barricade_01", "SM_Prop_FirePit_01", "FX_Fire_01" })
                            Require(group.GetComponentsInChildren<Transform>(true).Any(t =>
                                t.name == "LairProp_" + required), "Raider camp lacks " + required);
                    foreach (ParticleSystem particles in group.GetComponentsInChildren<ParticleSystem>(true))
                        particles.Simulate(1.25f, true, true);
                    foreach (string time in new[] { "day", "night" })
                    {
                        light.intensity = time == "day" ? 1.15f : 0.38f;
                        renderer.lights[1].intensity = time == "day" ? 0.28f : 0.08f;
                        renderer.ambientColor = time == "day"
                            ? new Color(0.40f, 0.39f, 0.37f)
                            : new Color(0.12f, 0.13f, 0.16f);
                        camera.backgroundColor = time == "day"
                            ? new Color(0.49f, 0.54f, 0.57f) : new Color(0.025f, 0.03f, 0.06f);
                        if (time == "day")
                            Capture(renderer, Path.Combine(output, id + "-desktop-day.png"), 1440, 810);
                        else
                            Capture(renderer, Path.Combine(output, id + "-mobile-night.png"), 844, 390);
                    }
                    UnityEngine.Object.DestroyImmediate(host);
                    host = null;
                }
                File.WriteAllText(Result, new JObject { ["status"] = "pass",
                    ["species"] = species.Length, ["nearbyModels"] = nearbyModels,
                    ["captures"] = output }.ToString());
                Debug.Log("[ROA] Lair dressing passed in authored zone: " + species.Length +
                    " species, no lettering or blocking colliders; desktop day/mobile night: " + output);
            }
            catch (Exception error)
            {
                File.WriteAllText(Result, new JObject { ["status"] = "fail",
                    ["error"] = error.ToString() }.ToString());
                Debug.LogException(error);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                if (renderer != null) renderer.Cleanup();
                if (preview.IsValid()) EditorSceneManager.ClosePreviewScene(preview);
                _running = false;
            }
        }

        private static string Signature(string speciesId)
        {
            switch (speciesId)
            {
                case "raider_band": return "LairProp_SM_Prop_Tent_Dome_01";
                case "gari_pack": return "LairProp_SM_Prop_Dog_House_01";
                case "dustling_brood": return "LairProp_SM_Prop_Vents_Exhaust_01";
                case "listener_pack": return "LairProp_SM_Prop_Roof_Satellite_Dish_01";
                case "rykhlyak_herd": return "LairProp_SM_Env_DirtPile_01";
                case "mourner_flock": return "LairProp_SM_Env_Tree_Dead_02";
                case "fold_cluster": return "LairProp_SM_Prop_BodyBag_Pile_01";
                case "burned_drifters": return "LairProp_SM_Prop_Tent_Dome_Damaged_01";
                case "lantern_herd": return "LairProp_SM_Prop_Barrel_Nuke_Pool_01";
                default: throw new InvalidOperationException("Unknown species: " + speciesId);
            }
        }

        private static void Capture(PreviewRenderUtility renderer, string path, int width, int height)
        {
            renderer.BeginPreview(new Rect(0, 0, width, height), GUIStyle.none);
            renderer.Render(true);
            Texture rendered = renderer.EndPreview();
            RenderTexture previous = RenderTexture.active;
            var pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
            try
            {
                RenderTexture.active = rendered as RenderTexture;
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                pixels.Apply();
                Color first = pixels.GetPixel(0, 0);
                int different = 0;
                for (int y = 20; y < height; y += 35)
                    for (int x = 20; x < width; x += 35)
                    {
                        Color sample = pixels.GetPixel(x, y);
                        if (Mathf.Abs(sample.r - first.r) + Mathf.Abs(sample.g - first.g) +
                            Mathf.Abs(sample.b - first.b) > 0.08f) different++;
                    }
                Require(different >= 12, "Capture contains no visible zone or lair: " + path);
                File.WriteAllBytes(path, pixels.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                UnityEngine.Object.DestroyImmediate(pixels);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
