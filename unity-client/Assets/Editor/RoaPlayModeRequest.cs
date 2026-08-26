#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Handles an optional one-shot Library request used by local tooling to
    /// enter Play Mode after the editor has finished importing the project.
    /// Normal editor launches are unaffected when the request file is absent.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaPlayModeRequest
    {
        private const string RequestName = "RoaStartPlayMode.request";
        private static double _nextCheck;

        static RoaPlayModeRequest()
        {
            EditorApplication.delayCall += Process;
            EditorApplication.update += Poll;
        }

        private static void Poll()
        {
            if (EditorApplication.timeSinceStartup < _nextCheck) return;
            _nextCheck = EditorApplication.timeSinceStartup + 0.5d;
            Process();
        }

        private static void Process()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                return;

            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(projectRoot)) return;
            string requestPath = Path.Combine(projectRoot, "Library", RequestName);
            if (!File.Exists(requestPath)) return;

            File.Delete(requestPath);
            Scene active = SceneManager.GetActiveScene();
            if (!active.IsValid() || !active.isLoaded
                || !string.Equals(active.path, "Assets/Scenes/Wasteland.unity",
                    System.StringComparison.OrdinalIgnoreCase))
                EditorSceneManager.OpenScene("Assets/Scenes/Wasteland.unity", OpenSceneMode.Single);
            if (!EditorApplication.isPlayingOrWillChangePlaymode)
                EditorApplication.isPlaying = true;
        }
    }
}
#endif
