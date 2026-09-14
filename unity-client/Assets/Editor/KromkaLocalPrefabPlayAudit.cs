#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Kromka.EditorTools
{
    /// <summary>Offline Play Mode QA: every recovered asset plus two authored scenes, at both target sizes.</summary>
    [InitializeOnLoad]
    public static class KromkaLocalPrefabPlayAudit
    {
        private const string Key = "Kromka.LocalPrefabPlayAudit";
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../../Build/LocalPrefabRepair/play"));
        private static double next;
        private static int shot;
        private static Camera camera;
        private static GameObject gallery;
        private static Light sun;
        private static bool prepared;
        private static string captureName;
        static KromkaLocalPrefabPlayAudit()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += state => {
                if (!SessionState.GetBool(Key, false)) return;
                if (state == PlayModeStateChange.EnteredPlayMode) { shot = 0; prepared = false; next = EditorApplication.timeSinceStartup + 2; }
                if (state == PlayModeStateChange.EnteredEditMode)
                {
                    SessionState.SetBool(Key, false);
                    EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(SessionState.GetString(Key + ".startScene", ""));
                    if (Application.isBatchMode && SessionState.GetBool(Key + ".batch", false))
                    {
                        SessionState.SetBool(Key + ".batch", false);
                        EditorApplication.Exit(File.ReadAllText(Path.Combine(Output, "result.txt")).StartsWith("PASS:", StringComparison.Ordinal) ? 0 : 1);
                    }
                }
            };
            EditorApplication.update += Tick;
        }

        [MenuItem("Кромка/Проверки/Локальные префабы Play Mode")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Exit Play Mode first.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save open scenes first.");
            Directory.CreateDirectory(Output);
            File.WriteAllText(Path.Combine(Output, "result.txt"), "RUNNING");
            SessionState.SetString(Key + ".startScene", AssetDatabase.GetAssetPath(EditorSceneManager.playModeStartScene));
            EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>("Assets/Scenes/Kromka/Locations/personalBase.unity");
            SessionState.SetBool(Key, true);
            EditorApplication.isPlaying = true;
        }

        public static void RunRecoveryBatch() => RunBatch(true);
        public static void RunValidationBatch() => RunBatch(false);

        private static void RunBatch(bool rebuild)
        {
            Directory.CreateDirectory(Output);
            File.WriteAllText(Path.Combine(Output, "result.txt"), "RUNNING: asset and scene validation");
            try
            {
                if (rebuild) KromkaLocalPrefabRecovery.Build();
                KromkaLocalPrefabRecovery.ValidateLocations();
                SessionState.SetBool(Key + ".batch", true);
                Run();
            }
            catch (Exception error)
            {
                File.WriteAllText(Path.Combine(Output, "result.txt"), "FAIL: " + error);
                Debug.LogException(error); EditorApplication.Exit(1);
            }
        }

        private static void Tick()
        {
            if (!SessionState.GetBool(Key, false) || !EditorApplication.isPlaying || EditorApplication.isCompiling
                || EditorApplication.timeSinceStartup < next) return;
            next = EditorApplication.timeSinceStartup + 1;
            try
            {
                if (shot >= 7)
                {
                    File.WriteAllText(Path.Combine(Output, "result.txt"), "PASS: 45 recovered prefabs in five galleries and two authored local scenes; Play Mode; desktop 1920x1080 and mobile landscape 844x390; 14 screenshots.");
                    EditorApplication.isPlaying = false; return;
                }
                if (prepared)
                {
                    // Imported meshes, texture uploads and scene loads need complete player frames before rendering.
                    if (shot >= 5)
                    {
                        string expectedScene = shot == 5 ? "personalBase" : "resourceOilPump";
                        if (SceneManager.GetActiveScene().name != expectedScene) throw new InvalidOperationException("Wrong captured scene: " + SceneManager.GetActiveScene().name);
                        var loadedMarkers = Object.FindObjectsByType<KromkaPlacedObjectAuthoring>().Where(m => m.Role != "terrain").ToArray();
                        Vector3 loadedFocus = loadedMarkers.Aggregate(Vector3.zero, (sum, m) => sum + m.transform.position) / Mathf.Max(1, loadedMarkers.Length);
                        camera.transform.position = loadedFocus + new Vector3(4,30,-30); camera.transform.LookAt(loadedFocus);
                        RenderSettings.fog = false;
                    }
                    KromkaOuterWastelandPlayAudit.Capture(camera, Path.Combine(Output,captureName+"-desktop.png"),1920,1080);
                    KromkaOuterWastelandPlayAudit.Capture(camera, Path.Combine(Output,captureName+"-mobile.png"),844,390);
                    Object.DestroyImmediate(sun.gameObject);
                    prepared = false; shot++; return;
                }
                if (gallery) Object.DestroyImmediate(gallery);
                if (camera) Object.DestroyImmediate(camera.gameObject);
                if (shot >= 5)
                    EditorSceneManager.LoadSceneInPlayMode("Assets/Scenes/Kromka/Locations/" + (shot == 5 ? "personalBase" : "resourceOilPump") + ".unity", new LoadSceneParameters(LoadSceneMode.Single));
                foreach (var existing in Object.FindObjectsByType<Camera>()) existing.enabled = false;
                camera = new GameObject("LocalPrefabAuditCamera").AddComponent<Camera>();
                Object.DontDestroyOnLoad(camera.gameObject);
                camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.17f,.19f,.18f);
                camera.nearClipPlane = .1f; camera.farClipPlane = 160f; camera.orthographic = true;
                RenderSettings.ambientMode = AmbientMode.Trilight;
                RenderSettings.ambientSkyColor = new Color(.64f,.65f,.63f);
                RenderSettings.ambientEquatorColor = new Color(.42f,.43f,.40f);
                RenderSettings.ambientGroundColor = new Color(.25f,.24f,.21f);
                RenderSettings.fog = false;
                sun = new GameObject("AuditSun").AddComponent<Light>(); sun.type = LightType.Directional;
                Object.DontDestroyOnLoad(sun.gameObject);
                sun.intensity = 1.2f; sun.transform.rotation = Quaternion.Euler(55,-30,0);
                Vector3 focus;
                string name;
                if (shot < 5)
                {
                    gallery = new GameObject("RecoveredPrefabGallery"); gallery.transform.position = new Vector3(500,0,500);
                    var rows = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../tools/data/local-prefab-recovery.json"))))["prefabs"].OfType<JObject>().Skip(shot * 9).Take(9).ToArray();
                    var names = new List<string>();
                    for (int i=0; i<rows.Length; i++)
                    {
                        string key = (string)rows[i]["key"]; names.Add(key);
                        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(KromkaLocalPrefabRecovery.PrefabRoot + key + ".prefab");
                        var instance = Object.Instantiate(prefab, gallery.transform);
                        instance.transform.localPosition = new Vector3((i%3-1)*9,0,(1-i/3)*7);
                        foreach (var renderer in instance.GetComponentsInChildren<MeshRenderer>())
                            if (renderer.sharedMaterials.Any(m => !m || !m.shader || !m.shader.isSupported)) throw new InvalidOperationException("Unsupported material: " + key);
                    }
                    focus = gallery.transform.position + Vector3.up;
                    camera.orthographicSize = 11;
                    name = "gallery-" + (shot+1);
                    File.WriteAllLines(Path.Combine(Output, name + ".txt"), names);
                }
                else
                {
                    var markers = Object.FindObjectsByType<KromkaPlacedObjectAuthoring>().Where(m => m.Role != "terrain").ToArray();
                    focus = markers.Aggregate(Vector3.zero, (sum, m) => sum+m.transform.position)/Mathf.Max(1,markers.Length);
                    camera.orthographicSize = 35;
                    name = shot == 5 ? "personalBase" : "resourceOilPump";
                }
                camera.transform.position = focus + new Vector3(4,30,-30); camera.transform.LookAt(focus);
                captureName = name; prepared = true;
                next = EditorApplication.timeSinceStartup + 3;
            }
            catch (Exception e)
            {
                File.WriteAllText(Path.Combine(Output,"result.txt"),"FAIL: "+e);
                Debug.LogException(e); EditorApplication.isPlaying = false;
            }
        }
    }
}
#endif
