using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    internal static class RoaOpenApocalypseDemo
    {
        private const string ScenePath =
            "Assets/Synty/PolygonApocalypse/Scenes/Demo_City_Universal_RenderPipeline.unity";

        [MenuItem("Realm of Ashes/PolygonApocalypse/Open URP demo city")]
        public static void OpenDemo()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ScenePath) == null)
                throw new InvalidOperationException("PolygonApocalypse URP demo scene is missing: " + ScenePath);
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        }

        [InitializeOnLoadMethod]
        private static void OpenIfRequested()
        {
            string request = Path.Combine(Application.dataPath, "../Library/roa-open-apocalypse-demo.request");
            if (!File.Exists(request)) return;
            File.Delete(request);
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode) return;
                if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ScenePath) == null)
                {
                    Debug.LogError("PolygonApocalypse URP demo scene is missing: " + ScenePath);
                    return;
                }
                for (int index = 0; index < SceneManager.sceneCount; index++)
                {
                    Scene open = SceneManager.GetSceneAt(index);
                    if (open.isDirty && !EditorSceneManager.SaveScene(open))
                        throw new InvalidOperationException("Could not save open Unity scene " + open.path);
                }
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                Debug.Log("[ROA] Opened PolygonApocalypse URP demo scene.");
            };
        }
    }
}
