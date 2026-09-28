#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Builds a compact shotgun from the pack's own native-size mesh.</summary>
    public static class RoaApocalypseShotgunVariantBuilder
    {
        private const string SourcePath =
            "Assets/Synty/PolygonApocalypse/Prefabs/Weapons/Guns/SM_Wep_Shotgun_01.prefab";
        private const string OutputDir = "Assets/Resources/RealmOfAshes/WeaponVariants";
        private const string MeshPath = OutputDir + "/sawedOffShotgun.asset";
        private const string PrefabPath = OutputDir + "/sawedOffShotgun.prefab";

        [MenuItem("Realm of Ashes/PolygonApocalypse/Rebuild compact shotgun")]
        public static void Rebuild() => Build();

        public static GameObject Build()
        {
            GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(SourcePath);
            Mesh sourceMesh = source != null ? source.GetComponentInChildren<MeshFilter>()?.sharedMesh : null;
            if (sourceMesh == null) throw new InvalidOperationException("Pack shotgun mesh is missing.");
            string modelPath = AssetDatabase.GetAssetPath(sourceMesh);
            var importer = AssetImporter.GetAtPath(modelPath) as ModelImporter;
            bool restoreReadable = importer != null && !importer.isReadable;
            if (restoreReadable)
            {
                importer.isReadable = true;
                importer.SaveAndReimport();
                source = AssetDatabase.LoadAssetAtPath<GameObject>(SourcePath);
                sourceMesh = source.GetComponentInChildren<MeshFilter>().sharedMesh;
            }
            try
            {
                Vector3[] vertices = sourceMesh.vertices;
                int[] triangles = sourceMesh.triangles;
                var chosen = new List<int>(triangles.Length);
                for (int i = 0; i < triangles.Length; i += 3)
                {
                    Vector3 a = vertices[triangles[i]], b = vertices[triangles[i + 1]],
                        c = vertices[triangles[i + 2]];
                    // Remove long barrel and shoulder stock. The remaining
                    // receiver, grip and trigger retain every authored vertex.
                    if (Mathf.Max(a.z, b.z, c.z) > 0.29f
                        || Mathf.Min(a.z, b.z, c.z) < -0.025f) continue;
                    chosen.Add(triangles[i]); chosen.Add(triangles[i + 1]); chosen.Add(triangles[i + 2]);
                }
                if (chosen.Count < 300 || chosen.Count >= triangles.Length * 0.8f)
                    throw new InvalidOperationException("Unexpected compact shotgun geometry: " + chosen.Count);
                Mesh compact = UnityEngine.Object.Instantiate(sourceMesh);
                compact.name = "PolygonApocalypse_SawedOffShotgun_NativeSize";
                compact.triangles = chosen.ToArray();
                compact.RecalculateBounds();
                if (!AssetDatabase.IsValidFolder(OutputDir))
                    AssetDatabase.CreateFolder("Assets/Resources/RealmOfAshes", "WeaponVariants");
                Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(MeshPath);
                if (existing == null) AssetDatabase.CreateAsset(compact, MeshPath);
                else
                {
                    EditorUtility.CopySerialized(compact, existing);
                    UnityEngine.Object.DestroyImmediate(compact);
                    EditorUtility.SetDirty(existing);
                }
                var instance = PrefabUtility.InstantiatePrefab(source) as GameObject;
                try
                {
                    instance.name = "PolygonApocalypse_SawedOffShotgun";
                    instance.GetComponentInChildren<MeshFilter>().sharedMesh =
                        AssetDatabase.LoadAssetAtPath<Mesh>(MeshPath);
                    PrefabUtility.SaveAsPrefabAsset(instance, PrefabPath);
                }
                finally { UnityEngine.Object.DestroyImmediate(instance); }
                AssetDatabase.SaveAssets();
                return AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            }
            finally
            {
                if (restoreReadable)
                {
                    importer.isReadable = false;
                    importer.SaveAndReimport();
                }
            }
        }
    }
}
#endif
