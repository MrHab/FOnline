#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseResidualAudit
    {
        [InitializeOnLoadMethod]
        private static void RunIfRequested()
        {
            string request = Path.Combine(Application.dataPath,
                "../Library/roa-apocalypse-residual-audit.request");
            if (!File.Exists(request)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(request) || EditorApplication.isPlayingOrWillChangePlaymode) return;
                File.Delete(request);
                Run();
            };
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Audit visible location meshes")]
        public static void Run()
        {
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../Temp/ApocalypseResidualAudit.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            string[] scenes = AssetDatabase.FindAssets("t:Scene", new[]
                { "Assets/Scenes/Kromka/Locations" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".unity", StringComparison.OrdinalIgnoreCase))
                .Concat(new[] { "Assets/Scenes/Kromka/KromkaGlobalMap.unity" })
                .OrderBy(path => path, StringComparer.Ordinal).ToArray();
            int residual = 0;
            int structural = 0;
            using (var writer = new StreamWriter(output, false))
            {
                foreach (string path in scenes)
                {
                    Scene scene = EditorSceneManager.OpenPreviewScene(path);
                    try
                    {
                        var names = new Dictionary<string, int>(StringComparer.Ordinal);
                        int sceneCount = 0;
                        foreach (GameObject root in scene.GetRootGameObjects())
                        foreach (MeshRenderer renderer in root.GetComponentsInChildren<MeshRenderer>(true))
                        {
                            if (!renderer.enabled || !renderer.gameObject.activeInHierarchy
                                || Excluded(renderer.transform)) continue;
                            if (path.EndsWith("KromkaGlobalMap.unity", StringComparison.Ordinal)
                                && RoaApocalypseArtMigration.IsMapSurfaceOrEffect(renderer.transform))
                            {
                                structural++;
                                continue;
                            }
                            if (Structural(renderer)) { structural++; continue; }
                            sceneCount++;
                            string name = renderer.transform.parent != null
                                ? renderer.transform.parent.name + "/" + renderer.name : renderer.name;
                            names[name] = names.TryGetValue(name, out int count) ? count + 1 : 1;
                        }
                        if (sceneCount == 0) continue;
                        residual += sceneCount;
                        writer.WriteLine(path + ": " + sceneCount);
                        foreach (KeyValuePair<string, int> pair in names
                            .OrderByDescending(pair => pair.Value))
                            writer.WriteLine("  " + pair.Value + " " + pair.Key);
                    }
                    finally { EditorSceneManager.ClosePreviewScene(scene); }
                }
                writer.WriteLine("TOTAL " + scenes.Length + " scenes; " + residual
                    + " remaining prop meshes; " + structural
                    + " authored surfaces, effects and structural meshes retained");
            }
            Debug.Log("[ROA APOCALYPSE] Residual audit: " + scenes.Length + " scenes, "
                + residual + " prop meshes, " + structural + " structural meshes. " + output);
        }

        private static bool Structural(MeshRenderer renderer)
        {
            string name = renderer.name;
            Transform parent = renderer.transform.parent;
            if (parent == null || !parent.name.EndsWith("_EDITABLE", StringComparison.Ordinal)) return false;
            return name == "Surface" || name == "Pipe" || name == "Wall"
                || name == "NorthWall" || name == "WestWall" || name == "EastWall"
                || name == "SouthWallLeft" || name == "SouthWallRight"
                || name == "RailLeft" || name == "RailRight"
                || name.StartsWith("Sleeper_", StringComparison.Ordinal);
        }

        private static bool Excluded(Transform node)
        {
            for (Transform item = node; item != null; item = item.parent)
            {
                if (item.name == "PolygonApocalypse_Visual") return true;
                KromkaPlacedObjectAuthoring authoring = item.GetComponent<KromkaPlacedObjectAuthoring>();
                if (authoring != null && (authoring.Role == "terrain" || authoring.Role == "anomaly"))
                    return true;
            }
            return false;
        }
    }
}
#endif
