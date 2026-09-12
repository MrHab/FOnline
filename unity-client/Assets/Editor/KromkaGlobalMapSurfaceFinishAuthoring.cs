#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    internal static class KromkaGlobalMapSurfaceFinishAuthoring
    {
        private const string Variants = "Assets/Art/Kromka/Materials/Kromka_Weathered_";

        [MenuItem("Realm of Ashes/Authoring/Visual review/Weathered surface finish")]
        public static void RepairCurrent()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode
                || SceneManager.GetActiveScene().path != "Assets/Scenes/Kromka/KromkaGlobalMap.unity")
                throw new InvalidOperationException("Open the authored global map outside Play Mode.");
            foreach (GameObject root in SceneManager.GetActiveScene().GetRootGameObjects()) Apply(root.transform);
            KromkaSceneCapture.SaveOpenGeneratedGlobalMap();
        }

        internal static void Apply(Transform root)
        {
            var cache = new Dictionary<Material, Material>();
            int changed = 0;
            foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
            {
                string meshPath = AssetDatabase.GetAssetPath(filter.sharedMesh);
                if (!meshPath.Contains("MajadroidApocalypticBuildings/")
                    && !meshPath.Contains("MehozavrUaz452/")) continue;
                Renderer renderer = filter.GetComponent<Renderer>();
                if (renderer == null) continue;
                Material[] materials = renderer.sharedMaterials;
                for (int i = 0; i < materials.Length; i++)
                {
                    Material source = materials[i];
                    if (source == null) continue;
                    string currentPath = AssetDatabase.GetAssetPath(source);
                    if (currentPath.StartsWith(Variants, StringComparison.Ordinal))
                    {
                        source.name = System.IO.Path.GetFileNameWithoutExtension(currentPath);
                        EditorUtility.SetDirty(source); continue;
                    }
                    if (!cache.TryGetValue(source, out Material variant))
                    {
                        AssetDatabase.TryGetGUIDAndLocalFileIdentifier(source, out string guid, out long id);
                        string path = Variants + guid + "_" + id + ".mat";
                        variant = AssetDatabase.LoadAssetAtPath<Material>(path);
                        if (variant == null) { variant = new Material(source); AssetDatabase.CreateAsset(variant, path); }
                        else variant.CopyPropertiesFromMaterial(source);
                        variant.name = System.IO.Path.GetFileNameWithoutExtension(path);
                        // Preserve every original texture, normal and colour. Only
                        // roughness/metal response changes; third-party assets stay intact.
                        if (variant.HasProperty("_Smoothness")) variant.SetFloat("_Smoothness", .12f);
                        if (variant.HasProperty("_Glossiness")) variant.SetFloat("_Glossiness", .12f);
                        if (variant.HasProperty("_Metallic")) variant.SetFloat("_Metallic", .08f);
                        EditorUtility.SetDirty(variant); cache.Add(source, variant);
                    }
                    materials[i] = variant;
                }
                renderer.sharedMaterials = materials; changed++;
            }
            Debug.Log("[KROMKA WEATHERED SURFACES] Native textures preserved on " + changed + " ruin/wreck renderers.");
        }
    }
}
#endif
