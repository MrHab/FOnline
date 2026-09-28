using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseNativeScaleAudit
    {
        private const string VisualName = "PolygonApocalypse_Visual";
        private const string PackRoot = "Assets/Synty/PolygonApocalypse/";

        [MenuItem("Realm of Ashes/PolygonApocalypse/Audit native model sizes")]
        public static void Run()
        {
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../Library/ApocalypseNativeScaleAudit.txt"));
            string[] scenes = AssetDatabase.FindAssets("t:Scene", new[]
                { "Assets/Scenes/Kromka/Locations" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".unity", StringComparison.OrdinalIgnoreCase))
                .Concat(new[] { "Assets/Scenes/Kromka/KromkaGlobalMap.unity" })
                .OrderBy(path => path, StringComparer.Ordinal).ToArray();
            int checkedCount = 0;
            int mismatchCount = 0;
            using (var writer = new StreamWriter(output, false))
            {
                foreach (string path in scenes)
                {
                    Scene scene = EditorSceneManager.OpenPreviewScene(path);
                    try
                    {
                        foreach (GameObject root in scene.GetRootGameObjects())
                        foreach (Transform visual in root.GetComponentsInChildren<Transform>(true))
                        {
                            if (visual.name != VisualName) continue;
                            GameObject source = PrefabUtility.GetCorrespondingObjectFromSource(visual.gameObject);
                            if (source == null || !AssetDatabase.GetAssetPath(source)
                                .StartsWith(PackRoot, StringComparison.Ordinal)) continue;
                            checkedCount++;
                            if (SameSize(visual.lossyScale, source.transform.localScale)) continue;
                            mismatchCount++;
                            if (mismatchCount <= 30)
                                writer.WriteLine(path + ": " + visual.parent.name + " "
                                    + visual.lossyScale + " instead of " + source.transform.localScale);
                        }
                    }
                    finally { EditorSceneManager.ClosePreviewScene(scene); }
                }
                writer.WriteLine("TOTAL " + scenes.Length + " scenes, " + checkedCount
                    + " models checked, " + mismatchCount + " scaled models");
            }
            Debug.Log("[ROA APOCALYPSE] Native-size audit: " + checkedCount
                + " models, " + mismatchCount + " scaled. " + output);
            if (mismatchCount > 0) throw new InvalidOperationException(
                "PolygonApocalypse models have non-native size: " + mismatchCount);
        }

        private static bool SameSize(Vector3 actual, Vector3 authored) =>
            Close(actual.x, authored.x) && Close(actual.y, authored.y) && Close(actual.z, authored.z);

        private static bool Close(float actual, float authored) =>
            Mathf.Abs(actual - authored) <= Mathf.Max(0.001f, Mathf.Abs(authored) * 0.001f);
    }
}
