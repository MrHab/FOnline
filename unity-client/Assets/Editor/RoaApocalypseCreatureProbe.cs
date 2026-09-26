using System;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    // One-shot probe keeps the user's current scene untouched.
    public static class RoaApocalypseCreatureProbe
    {
        private static bool _enteredPlayMode;
        private static readonly string[] Models =
        {
            "kromkaBurned", "kromkaGari", "kromkaDustling",
            "kromkaRykhlyak", "kromkaLantern"
        };

        [InitializeOnLoadMethod]
        private static void RunIfRequested()
        {
            string request = Path.Combine(Application.dataPath,
                "../Library/roa-apocalypse-creature-probe.request");
            if (!File.Exists(request)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(request)) return;
                File.Delete(request);
                if (EditorApplication.isPlaying) { Run(); return; }
                _enteredPlayMode = true;
                EditorApplication.playModeStateChanged += OnPlayModeChanged;
                EditorApplication.EnterPlaymode();
            };
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            Run();
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Capture creature lineup")]
        public static async void Run()
        {
            if (!EditorApplication.isPlaying)
            {
                Debug.LogError("[ROA APOCALYPSE] Creature lineup requires Play Mode.");
                return;
            }
            GameObject host = null;
            GameObject cameraRoot = null;
            GameObject lightRoot = null;
            RenderTexture target = null;
            Texture2D image = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                host = new GameObject("ApocalypseCreatureProbe");
                var enemies = host.AddComponent<RoaEnemies>();
                enemies.enabled = false;
                enemies.BaseUrl = "http://127.0.0.1:3000";
                MethodInfo create = typeof(RoaEnemies).GetMethod("Create",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                if (create == null) throw new InvalidOperationException("Enemy creation method missing.");
                for (int i = 0; i < Models.Length; i++)
                {
                    string key = Models[i];
                    var row = new JObject
                    {
                        ["id"] = "apocalypse-probe-" + i,
                        ["name"] = key,
                        ["modelKey"] = key,
                        ["visual"] = key,
                        ["species"] = key,
                        ["x"] = 0f,
                        ["z"] = 0f,
                        ["scale"] = 1f,
                        ["hp"] = 100,
                        ["maxHp"] = 100
                    };
                    if (create.Invoke(enemies, new object[] { "probe-" + i, row }) == null)
                        throw new InvalidOperationException("Could not create " + key);
                    host.transform.GetChild(i).position = new Vector3(i * 2.6f, 0f, 0f);
                }
                var deadline = DateTime.UtcNow.AddSeconds(90);
                while (DateTime.UtcNow < deadline)
                {
                    int visuals = 0;
                    foreach (Transform node in host.GetComponentsInChildren<Transform>(true))
                        if (node.name == RoaApocalypseVisuals.ChildName) visuals++;
                    if (visuals == Models.Length) break;
                    await Task.Delay(100);
                }
                int count = 0;
                foreach (Transform node in host.GetComponentsInChildren<Transform>(true))
                    if (node.name == RoaApocalypseVisuals.ChildName
                        && node.GetComponentsInChildren<Renderer>(true).Length > 0) count++;
                if (count != Models.Length)
                    throw new InvalidOperationException("Only " + count + "/" + Models.Length
                        + " creatures have PolygonApocalypse geometry.");
                foreach (Transform node in host.GetComponentsInChildren<Transform>(true))
                    node.gameObject.layer = 30;

                cameraRoot = new GameObject("ApocalypseCreatureCamera");
                Camera camera = cameraRoot.AddComponent<Camera>();
                camera.cullingMask = 1 << 30;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.15f, 0.17f, 0.18f);
                camera.orthographic = true;
                camera.orthographicSize = 4.6f;
                camera.transform.position = new Vector3(5.2f, 5.5f, 12f);
                camera.transform.LookAt(new Vector3(5.2f, 0.7f, 0f));
                lightRoot = new GameObject("ApocalypseCreatureSun");
                Light light = lightRoot.AddComponent<Light>();
                light.type = LightType.Directional;
                light.intensity = 2f;
                light.transform.rotation = Quaternion.Euler(45f, -35f, 0f);
                target = new RenderTexture(1440, 810, 24);
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                image = new Texture2D(1440, 810, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0, 0, 1440, 810), 0, 0);
                image.Apply();
                string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                    "../Temp/ApocalypseCreatureLineup.png"));
                File.WriteAllBytes(path, image.EncodeToPNG());
                Debug.Log("[ROA APOCALYPSE] Creature lineup PASS " + count + " models: " + path);
            }
            catch (Exception error) { Debug.LogError("[ROA APOCALYPSE] Creature lineup FAIL " + error); }
            finally
            {
                RenderTexture.active = previous;
                if (image != null) UnityEngine.Object.DestroyImmediate(image);
                if (target != null) UnityEngine.Object.DestroyImmediate(target);
                if (cameraRoot != null) UnityEngine.Object.DestroyImmediate(cameraRoot);
                if (lightRoot != null) UnityEngine.Object.DestroyImmediate(lightRoot);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                if (_enteredPlayMode)
                {
                    _enteredPlayMode = false;
                    EditorApplication.ExitPlaymode();
                }
            }
        }
    }
}
