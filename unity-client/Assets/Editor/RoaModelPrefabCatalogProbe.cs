#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaModelPrefabCatalogProbe
    {
        private const int ExpectedModelCount = 202;
        private const int ExpectedRuntimeCount = 15;

        public static void Run()
        {
            string[] sources = RealmOfAshes.Editor.RoaModelPrefabGenerator.FindModelPaths();
            Require(sources.Length == ExpectedModelCount,
                "expected " + ExpectedModelCount + " package GLBs, found " + sources.Length);

            int animated = 0;
            int skinned = 0;
            var sourceGuids = new HashSet<string>(StringComparer.Ordinal);
            foreach (string sourcePath in sources)
            {
                bool serviceAsset = sourcePath.EndsWith(
                        "/characters/npc/npc_humanoid_animations.glb",
                        StringComparison.OrdinalIgnoreCase)
                    || sourcePath.EndsWith(
                        "/weapons/approved_assault_rifle_grip.glb",
                        StringComparison.OrdinalIgnoreCase);
                GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(sourcePath);
                Require(source != null, "missing imported model: " + sourcePath);
                Require(PrefabUtility.GetPrefabAssetType(source) == PrefabAssetType.Model,
                    "GLB is not a Unity model prefab: " + sourcePath);

                string relative = sourcePath.Substring(
                    RealmOfAshes.Editor.RoaModelPrefabGenerator.PackageRoot.Length).TrimStart('/');
                string prefabPath = RealmOfAshes.Editor.RoaModelPrefabGenerator.PrefabRoot + "/"
                    + System.IO.Path.ChangeExtension(relative, ".prefab").Replace('\\', '/');
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                Require(prefab != null, "missing generated prefab: " + prefabPath);
                PrefabAssetType prefabType = PrefabUtility.GetPrefabAssetType(prefab);
                Require(prefabType == PrefabAssetType.Variant || prefabType == PrefabAssetType.Regular,
                    "generated asset is not a prefab: " + prefabPath);
                Require(GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(prefab) == 0,
                    "prefab has a missing script: " + prefabPath);

                string[] dependencies = AssetDatabase.GetDependencies(prefabPath, true);
                Require(dependencies.Contains(sourcePath),
                    "prefab does not depend on its GLB: " + prefabPath);

                string guid = AssetDatabase.AssetPathToGUID(sourcePath);
                Require(!string.IsNullOrEmpty(guid) && sourceGuids.Add(guid),
                    "missing or duplicate GLB GUID: " + sourcePath);

                var serialized = new SerializedObject(AssetImporter.GetAtPath(sourcePath));
                SerializedProperty animationMethod =
                    serialized.FindProperty("importSettings.animationMethod");
                Require(animationMethod != null && animationMethod.enumValueIndex == 1,
                    "GLB is not imported as Legacy Animation: " + sourcePath);

                Animation animation = prefab.GetComponentInChildren<Animation>(true);
                if (animation != null) animated++;
                SkinnedMeshRenderer[] skins =
                    prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true);
                if (skins.Length > 0) skinned++;
                foreach (SkinnedMeshRenderer renderer in skins)
                {
                    Require(renderer.sharedMesh != null,
                        "skinned renderer has no mesh: " + prefabPath);
                    Require(renderer.bones != null && renderer.bones.Length > 0,
                        "skinned renderer has no bones: " + prefabPath);
                }
                foreach (MeshFilter filter in prefab.GetComponentsInChildren<MeshFilter>(true))
                    Require(filter.sharedMesh != null, "mesh filter has no mesh: " + prefabPath);
                if (!serviceAsset)
                {
                    foreach (Renderer renderer in prefab.GetComponentsInChildren<Renderer>(true))
                        foreach (Material material in renderer.sharedMaterials)
                            Require(material != null && material.shader != null,
                                "renderer has a missing material or shader: " + prefabPath);
                }
            }

            RoaModelPrefabCatalog catalog = AssetDatabase.LoadAssetAtPath<RoaModelPrefabCatalog>(
                RealmOfAshes.Editor.RoaModelPrefabGenerator.CatalogPath);
            Require(catalog != null, "runtime prefab catalog is missing");
            Require(catalog.EntryCount == ExpectedRuntimeCount,
                "runtime catalog expected " + ExpectedRuntimeCount + " entries, found "
                + catalog.EntryCount);
            Require(catalog.Entries.Select(entry => entry.SourceUrl)
                    .Distinct(StringComparer.OrdinalIgnoreCase).Count() == ExpectedRuntimeCount,
                "runtime catalog has duplicate URLs");
            foreach (RoaModelPrefabCatalog.Entry entry in catalog.Entries)
                Require(entry.Prefab != null, "runtime catalog has a missing prefab: " + entry.SourceUrl);

            Require(RoaModelPrefabCatalog.NormalizeUrl(
                    "https://example.invalid/assets/models-lite/wasteland/brahmin.glb?v=1")
                    == "/assets/models/wasteland/brahmin.glb",
                "catalog URL normalization does not cover lite/query URLs");

            Debug.Log("[ROA MODELS] CATALOG PROBE PASS: " + sources.Length
                + " prefabs, " + animated + " animated, " + skinned + " skinned, "
                + catalog.EntryCount + " runtime entries.");
        }

        public static void RunBatch()
        {
            try
            {
                Run();
                EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[ROA MODELS] CATALOG PROBE FAIL: " + error);
                EditorApplication.Exit(1);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("[ROA MODELS] " + message);
        }
    }
}
#endif
