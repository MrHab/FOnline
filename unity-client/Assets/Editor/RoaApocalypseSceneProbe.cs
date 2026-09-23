using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseSceneProbe
    {
        private static readonly string[] Samples =
        {
            "personalBase", "randomRuinedRoad", "tutorialCaravanYard"
        };

        [MenuItem("Realm of Ashes/PolygonApocalypse/Capture sample locations")]
        public static void CaptureSamples()
        {
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../Temp/ApocalypseSceneProbe"));
            Directory.CreateDirectory(output);
            using (var report = new StreamWriter(Path.Combine(output, "report.txt"), false))
            foreach (string id in Samples)
            {
                string path = "Assets/Scenes/Kromka/Locations/" + id + ".unity";
                Scene scene = EditorSceneManager.OpenPreviewScene(path);
                try
                {
                    Renderer[] renderers = scene.GetRootGameObjects()
                        .SelectMany(root => root.GetComponentsInChildren<Renderer>(true))
                        .Where(r => r.enabled && r.gameObject.activeInHierarchy).ToArray();
                    Renderer[] scenery = renderers.Where(r => r.bounds.size.x < 300f
                        && r.bounds.size.z < 300f).ToArray();
                    Bounds bounds = scenery.Length > 0 ? scenery[0].bounds
                        : new Bounds(Vector3.zero, new Vector3(100f, 1f, 100f));
                    foreach (Renderer renderer in scenery.Skip(1)) bounds.Encapsulate(renderer.bounds);
                    float size = 18f;
                    var cameraObject = new GameObject("ApocalypseSampleCamera");
                    SceneManager.MoveGameObjectToScene(cameraObject, scene);
                    Camera camera = cameraObject.AddComponent<Camera>();
                    camera.orthographic = true;
                    camera.orthographicSize = size;
                    camera.farClipPlane = 1000f;
                    camera.clearFlags = CameraClearFlags.Skybox;
                    camera.transform.position = bounds.center + new Vector3(0f, size * 1.2f, -size);
                    camera.transform.rotation = Quaternion.Euler(55f, 0f, 0f);
                    var lightObject = new GameObject("ApocalypseSampleLight");
                    SceneManager.MoveGameObjectToScene(lightObject, scene);
                    Light light = lightObject.AddComponent<Light>();
                    light.type = LightType.Directional;
                    light.intensity = 1.4f;
                    lightObject.transform.rotation = Quaternion.Euler(48f, -25f, 0f);
                    Capture(camera, Path.Combine(output, id + "-desktop.png"), 1440, 810);
                    Capture(camera, Path.Combine(output, id + "-mobile.png"), 844, 390);
                    int newModels = renderers.Count(r => UnderReplacement(r.transform));
                    report.WriteLine(id + ": " + newModels + " PolygonApocalypse renderers, "
                        + (renderers.Length - newModels) + " other renderers");
                }
                finally { EditorSceneManager.ClosePreviewScene(scene); }
            }
            Debug.Log("[ROA APOCALYPSE] Sample locations captured: " + output);
        }

        private static bool UnderReplacement(Transform node)
        {
            for (Transform item = node; item != null; item = item.parent)
                if (item.name == "PolygonApocalypse_Visual") return true;
            return false;
        }

        private static void Capture(Camera camera, string path, int width, int height)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var image = new Texture2D(width, height, TextureFormat.RGBA32, false);
            RenderTexture previous = RenderTexture.active;
            RenderTexture previousTarget = camera.targetTexture;
            try
            {
                camera.aspect = (float)width / height;
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                image.Apply();
                File.WriteAllBytes(path, image.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previous;
                UnityEngine.Object.DestroyImmediate(target);
                UnityEngine.Object.DestroyImmediate(image);
            }
        }
    }
}
