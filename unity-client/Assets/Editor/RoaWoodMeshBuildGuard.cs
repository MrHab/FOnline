using System;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    // Runtime terrain seats wood resource roots using their native mesh tips.
    // Player builds cannot read Mesh.vertices when the imported model has
    // Read/Write disabled, even though the Editor can read the same model.
    public sealed class RoaWoodMeshBuildGuard : IPreprocessBuildWithReport
    {
        private static readonly string[] ModelPaths =
        {
            "Assets/Synty/PolygonApocalypse/Models/SM_Env_Tree_Dead_01.fbx",
            "Assets/Synty/PolygonApocalypse/Models/SM_Env_Tree_Dead_02.fbx"
        };

        public int callbackOrder => -990;

        public static void Prepare()
        {
            // Run before BuildPipeline begins; reimporting in OnPreprocessBuild
            // would mutate Bee inputs during the player build.
            foreach (string path in ModelPaths)
            {
                var importer = AssetImporter.GetAtPath(path) as ModelImporter;
                if (importer == null) throw new InvalidOperationException("Wood resource model is unavailable: " + path);
                if (!importer.isReadable)
                {
                    importer.isReadable = true;
                    importer.SaveAndReimport();
                }
                Check(path);
            }
        }

        public void OnPreprocessBuild(BuildReport report)
        {
            foreach (string path in ModelPaths) Check(path);
        }

        private static void Check(string path)
        {
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (importer == null || !importer.isReadable
                || !AssetDatabase.LoadAllAssetsAtPath(path).OfType<Mesh>().Any(mesh => mesh.isReadable))
                throw new BuildFailedException("Wood resource mesh must be readable in player: " + path);
        }
    }
}
