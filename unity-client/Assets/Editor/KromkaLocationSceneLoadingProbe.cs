#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>Offline regression for the Wasteland bootstrap / wasteland location name collision.</summary>
    [InitializeOnLoad]
    public static class KromkaLocationSceneLoadingProbe
    {
        private const string Key = "Kromka.LocationSceneLoadingProbe";
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../../Build/LocationSceneLoading/result.txt"));
        static KromkaLocationSceneLoadingProbe()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += state => {
                if (!SessionState.GetBool(Key, false)) return;
                if (state == PlayModeStateChange.EnteredEditMode)
                {
                    EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(SessionState.GetString(Key + ".original", ""));
                    SessionState.SetBool(Key, false);
                }
                if (state == PlayModeStateChange.EnteredPlayMode)
                {
                    try
                    {
                        var loader = new GameObject("OfflineLocationLoadingProbe").AddComponent<RoaLocationLoader>();
                        string json = File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/locations/wasteland.json")));
                        var definition = JObject.Parse(json).ToObject<LocationDefinition>();
                        typeof(RoaLocationLoader).GetField("_locations", BindingFlags.NonPublic | BindingFlags.Instance)
                            .SetValue(loader, new Dictionary<string, LocationDefinition> { ["wasteland"] = definition });
                        loader.StartCoroutine(Audit(loader));
                    }
                    catch (Exception error) { Finish("FAIL: " + error); }
                }
            };
        }

        [MenuItem("Кромка/Проверки/Загрузка переименованной локации")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Exit Play Mode first.");
            for (int i=0; i<SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save open scenes first.");
            var paths = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
            if (paths.Select(Path.GetFileNameWithoutExtension).Distinct(StringComparer.OrdinalIgnoreCase).Count() != paths.Length)
                throw new InvalidOperationException("Scene names collide ignoring case.");
            if (!paths.Contains(KromkaLocationSceneCatalog.ScenePath("wasteland"))) throw new InvalidOperationException("Renamed scene missing from build.");
            Directory.CreateDirectory(Path.GetDirectoryName(Output)); File.WriteAllText(Output, "RUNNING");
            SessionState.SetString(Key + ".original", AssetDatabase.GetAssetPath(EditorSceneManager.playModeStartScene));
            // No bootstrap/authentication/network session is started by this audit.
            EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(KromkaLocationSceneCatalog.ScenePath("personalBase"));
            SessionState.SetBool(Key, true); EditorApplication.isPlaying = true;
        }

        private static IEnumerator Audit(RoaLocationLoader loader)
        {
            int initialScenes = SceneManager.sceneCount;
            for (int pass=0; pass<2; pass++)
            {
                bool called = false, success = false;
                var routine = loader.LoadLocation("wasteland", (ok, _) => { called = true; success = ok; });
                while (true)
                {
                    bool more; object current = null; string failure = null;
                    try { more = routine.MoveNext(); if (more) current = routine.Current; }
                    catch (Exception error) { more = false; failure = error.ToString(); }
                    if (failure != null) { Finish("FAIL: " + failure); yield break; }
                    if (!more) break;
                    yield return current;
                }
                Scene scene = SceneManager.GetSceneByName(KromkaLocationSceneCatalog.SceneName("wasteland"));
                var marker = scene.IsValid() && scene.isLoaded ? scene.GetRootGameObjects()
                    .SelectMany(root => root.GetComponentsInChildren<RoaUnityLocationScene>(true)).SingleOrDefault() : null;
                if (!called || !success || !marker || marker.LocationId != "wasteland"
                    || scene.path != KromkaLocationSceneCatalog.ScenePath("wasteland")
                    || loader.CurrentGroundRenderer != marker.GroundRenderer || !marker.GroundRenderer
                    || SceneManager.sceneCount != initialScenes + 1
                    || SceneManager.GetSceneByName("Wasteland").IsValid())
                { Finish("FAIL: wrong scene, bootstrap duplicate or missing authored ground"); yield break; }
                loader.ClearLocation();
                double deadline = EditorApplication.timeSinceStartup + 20;
                while ((scene.isLoaded || SceneManager.sceneCount != initialScenes)
                    && EditorApplication.timeSinceStartup < deadline) yield return null;
                if (scene.isLoaded || SceneManager.sceneCount != initialScenes)
                { Finish("FAIL: location did not unload cleanly; loaded=" + scene.isLoaded
                    + "; scenes=" + SceneManager.sceneCount + "; expected=" + initialScenes); yield break; }
            }
            Finish("PASS: two real RoaLocationLoader load/unload cycles; wasteland -> KromkaGloomDetour; authored marker and ground found; no bootstrap duplication; game ID preserved.");
        }

        private static void Finish(string report)
        {
            File.WriteAllText(Output, report);
            Debug.Log("[LOCATION SCENE LOADING] " + report);
            EditorApplication.isPlaying = false;
        }
    }
}
#endif
