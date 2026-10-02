using System;
using System.IO;
using Kromka.EditorTools;
using Newtonsoft.Json;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Renders the dam road with the same projected and painted ground used in play.</summary>
    public static class RoaDamRoadVisualProbe
    {
        [MenuItem("Realm of Ashes/Zones/Capture dam road desktop and mobile")]
        public static void Run()
        {
            RoaZoneReliefProjectionProbe.Run();
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            string output = Environment.GetEnvironmentVariable("ROA_DAM_ROAD_CAPTURE");
            if (string.IsNullOrWhiteSpace(output)) output = Path.Combine(root, "Build/DamRoadVisual");
            Directory.CreateDirectory(output);
            var definition = JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(
                Path.Combine(root, "data/zones/authored/z_10_10.json")));
            EditorSceneManager.OpenScene("Assets/Scenes/Kromka/Locations/z_10_10.unity");
            RoaUnityLocationScene location = UnityEngine.Object.FindFirstObjectByType<RoaUnityLocationScene>();
            if (location == null || location.GroundRenderer == null)
                throw new InvalidOperationException("Dam road scene has no authored ground.");

            var painterObject = new GameObject("DamRoadCaptureGroundPainter");
            painterObject.AddComponent<RoaLocalTerrain>()
                .InitializeAuthoredSurface(definition, null, location.GroundRenderer);
            Light[] sceneLights = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude,
                FindObjectsSortMode.None);
            foreach (Light light in sceneLights) light.enabled = false;
            AmbientMode previousMode = RenderSettings.ambientMode;
            Color previousAmbient = RenderSettings.ambientLight;
            SphericalHarmonicsL2 previousProbe = RenderSettings.ambientProbe;
            bool previousFog = RenderSettings.fog;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.38f, 0.37f, 0.34f);
            var ambientProbe = new SphericalHarmonicsL2();
            ambientProbe.AddAmbientLight(RenderSettings.ambientLight);
            RenderSettings.ambientProbe = ambientProbe;
            RenderSettings.fog = false;
            var sunObject = new GameObject("DamRoadCaptureSun");
            Light sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.94f, 0.83f);
            sun.intensity = 1.05f;
            sun.shadows = LightShadows.Soft;
            sunObject.transform.rotation = Quaternion.Euler(52f, -35f, 0f);
            var cameraObject = new GameObject("DamRoadCaptureCamera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.35f, 0.37f, 0.36f);
            camera.farClipPlane = 1500f;
            try
            {
                Vector3 site = new Vector3(-82f, 0f, -106f);
                Capture(camera, Path.Combine(output, "desktop-wide.png"), site, 46f, 1280, 720);
                Capture(camera, Path.Combine(output, "desktop-checkpoint.png"),
                    site + new Vector3(21.5f, 0f, -0.5f), 18f, 1280, 720);
                Capture(camera, Path.Combine(output, "mobile-landscape.png"), site, 21.5f, 844, 390);
                Capture(camera, Path.Combine(output, "desktop-bridge.png"),
                    site + new Vector3(-21f, 0f, 0f), 24f, 1280, 720);
                Capture(camera, Path.Combine(output, "mobile-bridge.png"),
                    site + new Vector3(-21f, 0f, 0f), 26f, 844, 390);
                Capture(camera, Path.Combine(output, "desktop-river.png"),
                    site + new Vector3(-31f, 0f, -28f), 30f, 1280, 720);
                Capture(camera, Path.Combine(output, "desktop-upstream.png"),
                    new Vector3(-20f, 0f, 70f), 65f, 1280, 720);
                Capture(camera, Path.Combine(output, "mobile-upstream.png"),
                    new Vector3(-20f, 0f, 70f), 70f, 844, 390);
                camera.orthographic = false;
                camera.fieldOfView = 64f;
                camera.transform.position = new Vector3(-104.755f, 1.8f, -133f);
                camera.transform.LookAt(new Vector3(-104.755f, -0.15f, -96f));
                KromkaSceneShot.Capture(camera, Path.Combine(output, "desktop-canal-eye.png"), 1280, 720);
                KromkaSceneShot.Capture(camera, Path.Combine(output, "mobile-canal-eye.png"), 844, 390);
                camera.transform.position = new Vector3(-104.755f, 1.8f, -79f);
                camera.transform.LookAt(new Vector3(-104.755f, -0.15f, -118f));
                KromkaSceneShot.Capture(camera, Path.Combine(output, "desktop-canal-north-eye.png"), 1280, 720);
                camera.transform.position = new Vector3(-52f, 2.8f, 76f);
                camera.transform.LookAt(new Vector3(-10f, 0.1f, 90f));
                KromkaSceneShot.Capture(camera, Path.Combine(output, "desktop-riverbank-eye.png"), 1280, 720);
                camera.fieldOfView = 60f;
                camera.transform.position = new Vector3(-112f, 39f, -131f);
                camera.transform.LookAt(new Vector3(94f, 10f, 42f));
                KromkaSceneShot.Capture(camera, Path.Combine(output, "desktop-relief.png"), 1280, 720);
                KromkaSceneShot.Capture(camera, Path.Combine(output, "mobile-relief.png"), 844, 390);
                camera.orthographic = true;
                camera.orthographicSize = 185f;
                camera.transform.SetPositionAndRotation(new Vector3(0f, 430f, 0f),
                    Quaternion.Euler(90f, 0f, 0f));
                KromkaSceneShot.Capture(camera, Path.Combine(output, "desktop-sector.png"), 1280, 720);
            }
            finally
            {
                RenderSettings.ambientMode = previousMode;
                RenderSettings.ambientLight = previousAmbient;
                RenderSettings.ambientProbe = previousProbe;
                RenderSettings.fog = previousFog;
                foreach (Light light in sceneLights) if (light != null) light.enabled = true;
                UnityEngine.Object.DestroyImmediate(cameraObject);
                UnityEngine.Object.DestroyImmediate(sunObject);
                UnityEngine.Object.DestroyImmediate(painterObject);
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
            Debug.Log("[ROA DAM ROAD VISUAL] PASS: " + output);
        }

        private static void Capture(Camera camera, string path, Vector3 target, float distance,
                                    int width, int height)
        {
            camera.orthographic = false;
            camera.fieldOfView = distance > 40f ? 60f : 52f;
            Quaternion look = Quaternion.Euler(55f, 45f, 0f);
            camera.transform.SetPositionAndRotation(target + Vector3.up - look * Vector3.forward * distance, look);
            camera.aspect = width / (float)height;
            KromkaSceneShot.Capture(camera, path, width, height);
        }
    }
}
