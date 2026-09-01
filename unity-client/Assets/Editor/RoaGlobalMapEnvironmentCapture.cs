#if UNITY_EDITOR
using System;
using System.IO;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Deterministic visual-QA captures of the real authored map scene.</summary>
    public static class RoaGlobalMapEnvironmentCapture
    {
        [MenuItem("Realm of Ashes/Проверки/Снимки детальной глобальной карты")]
        public static void Run()
        {
            RunInternal();
        }

        public static void RunBatch()
        {
            try
            {
                RunInternal();
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                else throw;
            }
        }

        private static void RunInternal()
        {
            Scene scene = EditorSceneManager.OpenScene(RoaGlobalMapAuthoringTools.ScenePath,
                OpenSceneMode.Single);
            RoaUnityGlobalMapScene marker = FindMarker(scene)
                ?? throw new InvalidOperationException("RoaUnityGlobalMapScene is missing.");
            if (!marker.Validate(out string validationError))
                throw new InvalidOperationException(validationError);

            string output = Environment.GetEnvironmentVariable(
                "ROA_GLOBAL_MAP_ENV_CAPTURE_DIR");
            if (string.IsNullOrWhiteSpace(output))
            {
                string project = Directory.GetParent(Application.dataPath)?.FullName
                    ?? Application.dataPath;
                output = Path.Combine(project, "Library", "GlobalMapEnvironment34");
            }
            Directory.CreateDirectory(output);

            StrategicLighting(marker);
            Capture(Path.Combine(output, "01-overview-oblique.png"),
                new Vector3(0f, 0f, 0f), 112f, 55f, 45f, 1920, 1080);
            Capture(Path.Combine(output, "02-west-ocean-coast.png"),
                new Vector3(-31f, 0f, 4f), 47f, 52f, 78f, 1600, 900);
            Capture(Path.Combine(output, "03-biome-detail.png"),
                new Vector3(10f, 0f, 8f), 24f, 48f, 222f, 1600, 900);
            Capture(Path.Combine(output, "04-toxic-east-boundary.png"),
                new Vector3(43f, 0f, 0f), 32f, 48f, 90f, 1600, 900);
            Capture(Path.Combine(output, "05-toxic-west-ocean.png"),
                new Vector3(-43f, 0f, 0f), 34f, 50f, 270f, 1600, 900);
            Debug.Log("[ГЛОБАЛЬНАЯ КАРТА 3.4] контрольные снимки: " + output, marker);
        }

        private static void StrategicLighting(RoaUnityGlobalMapScene marker)
        {
            RoaGlobalMap.StrategicVisualProfile profile = RoaGlobalMap.StrategicProfile(90f);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = profile.AmbientSky;
            RenderSettings.ambientEquatorColor = profile.AmbientEquator;
            RenderSettings.ambientGroundColor = profile.AmbientGround;
            RenderSettings.ambientIntensity = profile.AmbientIntensity;
            RenderSettings.reflectionIntensity = profile.ReflectionIntensity;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = profile.FogColor;
            RenderSettings.fogStartDistance = profile.FogStart;
            RenderSettings.fogEndDistance = profile.FogEnd;
            Light[] lights = marker.GetComponentsInChildren<Light>(true);
            for (int i = 0; i < lights.Length; i++)
            {
                if (lights[i] != null && lights[i].name == "GlobalMapSun_AUTHORED")
                {
                    lights[i].enabled = true;
                    RenderSettings.sun = lights[i];
                    break;
                }
            }
        }

        private static void Capture(string path, Vector3 target, float distance,
                                    float pitch, float yaw, int width, int height)
        {
            GameObject cameraObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                cameraObject = new GameObject("GlobalMapEnvironmentCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = RoaCameraRig.StrategicFieldOfView;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 500f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = RoaGlobalMap.StrategicProfile(90f).CameraBackground;
                camera.allowHDR = true;
                camera.allowMSAA = true;
                Quaternion orbit = Quaternion.Euler(pitch, yaw, 0f);
                camera.transform.SetPositionAndRotation(
                    target - orbit * Vector3.forward * distance, orbit);

                renderTarget = new RenderTexture(width, height, 24,
                    RenderTextureFormat.ARGB32)
                {
                    name = "GlobalMapEnvironmentCapture",
                    antiAliasing = 1,
                    useMipMap = false
                };
                renderTarget.Create();
                camera.targetTexture = renderTarget;
                camera.Render();

                RenderTexture.active = renderTarget;
                readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (cameraObject != null)
                {
                    Camera camera = cameraObject.GetComponent<Camera>();
                    if (camera != null) camera.targetTexture = null;
                }
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (renderTarget != null)
                {
                    renderTarget.Release();
                    UnityEngine.Object.DestroyImmediate(renderTarget);
                }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        private static RoaUnityGlobalMapScene FindMarker(Scene scene)
        {
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                RoaUnityGlobalMapScene marker =
                    root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (marker != null) return marker;
            }
            return null;
        }
    }
}
#endif
