#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>GPU captures of the authored outposts and the walk-in Core entrance.</summary>
    public static class RoaAlifeCoreVisualProbe
    {
        private struct Sample
        {
            public string Id;
            public Vector3 Focus;
            public string Perimeter;
            public string Centre;
        }

        [MenuItem("Realm of Ashes/Tests/A-Life and Core Scene Captures")]
        public static void Run()
        {
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../Library/AgentCaptures/AlifeCore"));
            Directory.CreateDirectory(output);
            var report = new JArray();
            var samples = new[]
            {
                new Sample { Id = "z_06_10", Focus = new Vector3(55f, 11.2f, 47f),
                    Perimeter = "scrapOutpost_perimeter_", Centre = "scrapOutpost_repair_bench" },
                new Sample { Id = "z_13_10", Focus = new Vector3(1f, 2.3f, 111f),
                    Perimeter = "relayOutpost_perimeter_", Centre = "relayOutpost_power" },
                new Sample { Id = "z_09_07", Focus = new Vector3(30f, -6.9f, 0f),
                    Perimeter = "facility_coreZone_wall_", Centre = "facility_coreZone_physical_door" },
                new Sample { Id = "z_10_10", Focus = new Vector3(-65f, 0f, -105f),
                    Perimeter = "roadOutpost_fence_", Centre = "roadOutpost_hq_trailer" }
            };
            foreach (Sample sample in samples)
            {
                Scene scene = default;
                PreviewRenderUtility preview = null;
                AmbientMode previousAmbientMode = RenderSettings.ambientMode;
                Color previousAmbientLight = RenderSettings.ambientLight;
                SphericalHarmonicsL2 previousAmbientProbe = RenderSettings.ambientProbe;
                try
                {
                    scene = EditorSceneManager.OpenPreviewScene(
                        "Assets/Scenes/Kromka/Locations/" + sample.Id + ".unity");
                    if (!scene.IsValid()) throw new Exception("Cannot open scene: " + sample.Id);
                    Transform[] nodes = scene.GetRootGameObjects()
                        .SelectMany(root => root.GetComponentsInChildren<Transform>(true)).ToArray();
                    int walls = nodes.Count(node => node.name.StartsWith(sample.Perimeter,
                        StringComparison.Ordinal));
                    Transform centre = nodes.FirstOrDefault(node => node.name == sample.Centre);
                    if (walls < 5 || centre == null)
                        throw new Exception(sample.Id + ": perimeter=" + walls + ", centre="
                            + (centre != null ? "present" : "missing"));

                    preview = new PreviewRenderUtility();
                    Camera camera = preview.camera;
                    camera.clearFlags = CameraClearFlags.SolidColor;
                    camera.fieldOfView = 45f;
                    camera.nearClipPlane = 0.1f;
                    camera.farClipPlane = 350f;
                    preview.lights[0].transform.rotation = Quaternion.Euler(48f, -35f, 0f);
                    // Inspection captures need a readable ambient term in URP's
                    // preview renderer. These temporary settings are not saved
                    // to the authored scene or used by the running client.
                    RenderSettings.ambientMode = AmbientMode.Flat;
                    RenderSettings.ambientLight = new Color(0.44f, 0.42f, 0.38f);
                    var ambient = new SphericalHarmonicsL2();
                    ambient.AddAmbientLight(RenderSettings.ambientLight);
                    RenderSettings.ambientProbe = ambient;

                    float visibleRange = sample.Id == "z_09_07" ? 60f : 83f;
                    int models = 0;
                    foreach (GameObject root in scene.GetRootGameObjects())
                    foreach (Renderer source in root.GetComponentsInChildren<Renderer>(true))
                    {
                        if (!source.enabled || !source.gameObject.activeInHierarchy
                            || source.bounds.SqrDistance(sample.Focus) > visibleRange * visibleRange) continue;
                        GameObject model = UnityEngine.Object.Instantiate(source.gameObject);
                        model.transform.SetPositionAndRotation(source.transform.position,
                            source.transform.rotation);
                        model.transform.localScale = source.transform.lossyScale;
                        preview.AddSingleGO(model);
                        models++;
                    }
                    if (models < 10) throw new Exception(sample.Id + ": too few visible scene models: " + models);
                    EditorSceneManager.ClosePreviewScene(scene);
                    scene = default;

                    Quaternion orbit = Quaternion.Euler(55f, 45f, 0f);
                    camera.transform.position = sample.Focus - orbit * Vector3.forward *
                        (sample.Id == "z_09_07" ? 72f : 102f);
                    camera.transform.rotation = orbit;
                    SetDaylight(preview, false);
                    Capture(preview, Path.Combine(output, sample.Id + "-desktop-day.png"), 1440, 810);
                    SetDaylight(preview, true);
                    Capture(preview, Path.Combine(output, sample.Id + "-mobile-day.png"), 844, 390);
                    report.Add(new JObject { ["locationId"] = sample.Id, ["perimeter"] = walls,
                        ["centre"] = sample.Centre, ["sceneRenderers"] = models });
                }
                finally
                {
                    RenderSettings.ambientMode = previousAmbientMode;
                    RenderSettings.ambientLight = previousAmbientLight;
                    RenderSettings.ambientProbe = previousAmbientProbe;
                    if (preview != null) preview.Cleanup();
                    if (scene.IsValid()) EditorSceneManager.ClosePreviewScene(scene);
                }
            }
            File.WriteAllText(Path.Combine(output, "report.json"), report.ToString());
            Debug.Log("[ROA] A-Life/Core scene captures passed: " + output);
        }

        private static void SetDaylight(PreviewRenderUtility preview, bool mobile)
        {
            RoaWorldLighting.LightingSample light = RoaWorldLighting.Evaluate(
                RoaWorldLighting.WebFixedWorldHour, null, mobile);
            preview.lights[0].intensity = light.SunIntensity;
            preview.lights[0].color = light.SunColor;
            preview.lights[0].intensity = Mathf.Max(preview.lights[0].intensity, 1.35f);
            preview.lights[1].intensity = Mathf.Max(light.FillIntensity, 0.65f);
            preview.lights[1].color = light.FillColor;
            preview.ambientColor = light.HemiSkyColor * 0.75f;
            preview.camera.backgroundColor = light.SkyColor;
        }

        private static void Capture(PreviewRenderUtility preview, string path, int width, int height)
        {
            RenderTexture previous = RenderTexture.active;
            Texture2D image = null;
            try
            {
                preview.BeginPreview(new Rect(0, 0, width, height), GUIStyle.none);
                preview.Render(true);
                Texture texture = preview.EndPreview();
                RenderTexture.active = texture as RenderTexture;
                image = new Texture2D(width, height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                image.Apply();
                File.WriteAllBytes(path, image.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (image != null) UnityEngine.Object.DestroyImmediate(image);
            }
        }
    }
}
#endif
