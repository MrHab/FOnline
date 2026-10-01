#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Checks tier-one lairs in a real zone without changing the open scene.</summary>
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
                var allResidents = ((JArray)ecology["species"]).OfType<JObject>()
                    .Where(row => row["kind"]?.ToString() != "traveller").ToArray();
                Require(allResidents.Length == RoaZoneLairDressing.ThemeCount,
                    "Every resident species needs a theme");
                var tiers = JObject.Parse(File.ReadAllText(Path.Combine(repo, "data/kromka/tiers.json")));
                var tierRules = tiers["enemies"]?["species"];
                var species = allResidents.Where(row =>
                {
                    string type = row["members"]?[0]?["type"]?.ToString();
                    return tierRules?[type]?["tiers"] is JArray allowed &&
                        allowed.Any(value => value.Value<int>() == 1);
                }).ToArray();
                Require(species.Length == 4, "Expected four tier-one lair species");
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
                renderer.camera.fieldOfView = RoaCameraRig.GameplayFieldOfView;
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
                Quaternion gameplayOrbit = Quaternion.Euler(55f, 45f, 0f);
                camera.transform.position = focus - gameplayOrbit * Vector3.forward *
                    RoaCameraRig.DefaultGameplayDistance;
                camera.transform.rotation = gameplayOrbit;
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
                    string modelKey = CreatureModelKey(id);
                    RoaLairCreatureRemains[] remains =
                        group.GetComponentsInChildren<RoaLairCreatureRemains>(true);
                    Require(remains.Length == (modelKey == null ? 0 : id == "lantern_herd" ? 2 : 1),
                        "Wrong species remains count: " + id);
                    foreach (RoaLairCreatureRemains trace in remains)
                    {
                        string sourcePath = RoaLairCreatureRemains.SourcePath(modelKey);
                        const string prefix = "public/assets/models/";
                        Require(sourcePath.StartsWith(prefix, StringComparison.Ordinal),
                            "Unapproved creature source: " + sourcePath);
                        string packagePath = "Packages/com.realmofashes.models/" +
                            sourcePath.Substring(prefix.Length);
                        GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(packagePath);
                        Require(source != null, "Existing creature GLB unavailable: " + packagePath);
                        GameObject model = UnityEngine.Object.Instantiate(source, trace.transform, false);
                        Require(RoaLairCreatureRemains.ConfigureStaticVisual(
                                model, modelKey, trace.ShowsBody),
                            "Creature remains cannot freeze existing model: " + id +
                            " nodes=" + string.Join(",", model.GetComponentsInChildren<Transform>(true)
                                .Select(t => t.name)) + " renderers=" +
                            string.Join(",", model.GetComponentsInChildren<Renderer>(true)
                                .Select(r => r.name)));
                        if (modelKey != "kromkaLantern")
                        {
                            Animation animation = model.GetComponentInChildren<Animation>(true);
                            Require(animation != null && animation["death"] != null &&
                                animation["death"].speed == 0f,
                                "Creature trace is not frozen in death pose: " + id);
                        }
                        else if (trace.ShowsBody)
                        {
                            Require(Mathf.Abs(Mathf.DeltaAngle(
                                    trace.transform.localEulerAngles.z, 40f)) < 1f &&
                                model.GetComponentsInChildren<Renderer>(true)
                                    .Any(renderer => renderer.enabled &&
                                        renderer.name.Contains("stag_body")),
                                "Lantern remains must be a whole creature lying on its side");
                        }
                        else
                            Require(model.GetComponentsInChildren<Renderer>(true)
                                .Where(renderer => renderer.enabled).All(renderer =>
                                    !renderer.name.Contains("stag_body")),
                                "Lantern trace shows body rather than shed antlers");
                    }
                    Require(group.GetComponentsInChildren<Renderer>(true).Length >= 4,
                        "Lair lacks visible traces: " + id);
                    foreach (Transform prop in group)
                    {
                        if (prop.GetComponent<RoaLairCreatureRemains>() != null) continue;
                        Require(prop.name.StartsWith("LairProp_", StringComparison.Ordinal),
                            "Unexpected lair visual: " + prop.name);
                        GameObject source = RoaLairPropCatalog.Instance.Find(
                            prop.name.Substring("LairProp_".Length));
                        string path = AssetDatabase.GetAssetPath(source);
                        Require(path.StartsWith("Assets/Synty/PolygonApocalypse/Prefabs/", StringComparison.Ordinal),
                            "Non-PolygonApocalypse lair model: " + prop.name + " source=" +
                            (source != null ? source.name : "NULL") + " path=" + path);
                        Require(prop.localScale == source.transform.localScale,
                            "PolygonApocalypse authored scale changed: " + prop.name);
                    }
                    Require(group.GetComponentsInChildren<Collider>(true).All(c => !c.enabled),
                        "Lair visual blocks gameplay: " + id);
                    Require(group.GetComponentsInChildren<RoaEnemies>(true).Length == 0 &&
                        group.GetComponentsInChildren<RoaCharacterView>(true).Length == 0,
                        "Static trace impersonates a live server actor: " + id);
                    Require(!group.GetComponentsInChildren<Text>(true).Any() &&
                        !group.GetComponentsInChildren<TextMesh>(true).Any() &&
                        !group.GetComponentsInChildren<Canvas>(true).Any() &&
                        !group.GetComponentsInChildren<Component>(true).Any(c =>
                            c != null && c.GetType().FullName.StartsWith("TMPro.", StringComparison.Ordinal)),
                        "Lair contains lettering: " + id);
                    Require(group.GetComponentsInChildren<Transform>(true).Any(t =>
                        t.name == Signature(id)), "Species trace missing: " + id);
                    CheckTierOneMotif(id, group);
                    foreach (ParticleSystem particles in group.GetComponentsInChildren<ParticleSystem>(true))
                        particles.Simulate(1.25f, true, true);
                    foreach (string time in new[] { "day", "night" })
                    {
                        bool mobile = time == "night";
                        RoaWorldLighting.LightingSample lighting = RoaWorldLighting.Evaluate(
                            mobile ? 0f : RoaWorldLighting.WebFixedWorldHour, null, mobile);
                        light.intensity = mobile ? lighting.MoonIntensity : lighting.SunIntensity;
                        light.color = mobile ? lighting.MoonColor : lighting.SunColor;
                        renderer.lights[1].intensity = lighting.FillIntensity;
                        renderer.lights[1].color = lighting.FillColor;
                        renderer.ambientColor = lighting.HemiSkyColor * lighting.HemiIntensity;
                        camera.backgroundColor = lighting.SkyColor;
                        if (time == "day")
                            Capture(renderer, Path.Combine(output, id + "-desktop-day.png"), 1440, 810);
                        else
                            Capture(renderer, Path.Combine(output, id + "-mobile-night.png"), 844, 390);
                    }
                    UnityEngine.Object.DestroyImmediate(host);
                    host = null;
                }
                File.WriteAllText(Result, new JObject { ["status"] = "pass",
                    ["tier"] = 1, ["species"] = species.Length, ["nearbyModels"] = nearbyModels,
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
                case "gari_pack": return "LairProp_SM_Env_Rock_01";
                case "dustling_brood": return "LairProp_SM_Prop_Vents_Exhaust_01";
                case "listener_pack": return "LairProp_SM_Prop_Roof_Satellite_Dish_01";
                case "rykhlyak_herd": return "LairProp_SM_Env_DirtPile_01";
                case "mourner_flock": return "LairProp_SM_Env_Tree_Dead_02";
                case "fold_cluster": return "LairProp_SM_Prop_BodyBag_Pile_01";
                case "burned_drifters": return "LairProp_SM_Prop_Tent_Dome_Damaged_01";
                case "lantern_herd": return "LairProp_SM_Env_Flowers_Large_01";
                default: throw new InvalidOperationException("Unknown species: " + speciesId);
            }
        }

        private static string CreatureModelKey(string speciesId)
        {
            switch (speciesId)
            {
                case "gari_pack": return "kromkaGari";
                case "dustling_brood": return "kromkaDustling";
                case "lantern_herd": return "kromkaLantern";
                default: return null;
            }
        }

        private static void CheckTierOneMotif(string id, Transform group)
        {
            int Count(string key) => group.GetComponentsInChildren<Transform>(true)
                .Count(t => t.name == "LairProp_" + key);
            switch (id)
            {
                case "raider_band":
                    Require(Count("SM_Prop_Tent_Dome_01") == 2 &&
                        Count("SM_Prop_Barricade_01") + Count("SM_Prop_Barricade_02") >= 6 &&
                        Count("SM_Prop_Barricade_Corrugated_01") == 2 &&
                        Count("SM_Prop_Sandbag_Wall_01") == 2 &&
                        Count("SM_Prop_Ammo_Box_Open_01") == 1 &&
                        Count("SM_Prop_DeadBody_Spiked_Male_01") == 1 &&
                        Count("SM_Prop_FirePit_01") == 1 && Count("FX_Fire_01") == 1 &&
                        group.GetComponentsInChildren<Light>(true).Length >= 1,
                        "Raider camp needs tents, perimeter, firepit and firelight");
                    break;
                case "gari_pack":
                    Require(Count("SM_Prop_Dog_House_01") == 0 &&
                        Count("SM_Env_Rock_01") >= 3 && Count("SM_Env_Rock_02") == 0 &&
                        Count("SM_Prop_DeadBody_Laying_Male_01") == 1 &&
                        Count("SM_Prop_BloodPool_01") == 1,
                        "Gari den needs a wild low entrance and torn prey, not a kennel");
                    break;
                case "dustling_brood":
                    Require(Count("SM_Prop_Wall_Wire_Damaged_01") == 0 &&
                        Count("SM_Prop_Wire_01") == 0 &&
                        Count("SM_Env_DirtPile_01") + Count("SM_Env_DirtPile_02") >= 5 &&
                        Count("SM_Prop_Vents_Exhaust_01") == 1 && Count("FX_Flies_01") >= 3,
                        "Dustling brood needs a low clustered hive and insects");
                    break;
                case "lantern_herd":
                    Light[] lights = group.GetComponentsInChildren<Light>(true);
                    Require(Count("SM_Prop_Barrel_Nuke_Pool_01") == 0 &&
                        Count("SM_Env_Flowers_Large_01") == 2 &&
                        Count("SM_Env_Flowers_Large_02") == 1 && lights.Length >= 3 &&
                        lights.All(light => light.color.b > light.color.r),
                        "Lantern pasture needs vegetation and cold light, not radioactive waste");
                    break;
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
