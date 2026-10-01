#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Headgear built from the pack's own native-size meshes: «Дозор» is the
    /// football helmet without its face guard, in dark worn metal; «Реликт» is
    /// the army helmet with a gas mask. Both keep every authored vertex.
    /// </summary>
    public static class RoaApocalypseWornVariantBuilder
    {
        private const string Attachments = "Assets/Synty/PolygonApocalypse/Prefabs/Characters/Attachments/";
        private const string OutputDir = "Assets/Resources/RealmOfAshes/WornVariants";

        public const string TacticalHelmetPath = OutputDir + "/tacticalHelmet.prefab";
        public const string PreWarHelmetPath = OutputDir + "/preWarHelmet.prefab";
        private const string MetalMaterial = "Assets/Synty/PolygonApocalypse/Materials/Alts/PolygonApocalypse_01_Burnt.mat";

        [MenuItem("Realm of Ashes/PolygonApocalypse/Rebuild worn variants")]
        public static void Rebuild()
        {
            GameObject tactical = TacticalHelmet();
            GameObject preWar = PreWarHelmet();
            AssetDatabase.SaveAssets();
            // Point just these two catalog rows at the variants; a full palette rebuild
            // (RoaApocalypseModelCatalogBuilder) makes the same substitution itself.
            var catalog = AssetDatabase.LoadAssetAtPath<RoaApocalypseModels>(
                "Assets/Resources/RealmOfAshes/PolygonApocalypseModels.asset");
            var serialized = new SerializedObject(catalog);
            SerializedProperty rows = serialized.FindProperty("items");
            for (int i = 0; i < rows.arraySize; i++)
            {
                SerializedProperty row = rows.GetArrayElementAtIndex(i);
                string id = row.FindPropertyRelative("itemId").stringValue;
                GameObject prefab = id == "tacticalHelmet" ? tactical : id == "preWarHelmet" ? preWar : null;
                if (prefab == null) continue;
                row.FindPropertyRelative("prefab").objectReferenceValue = prefab;
                row.FindPropertyRelative("mark").boxedValue = RoaTierMarkLayout.Compute(prefab);
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA WORN VARIANT] tactical and pre-war helmets rebuilt");
        }

        /// <summary>Icons of the reworked wearables: every helmet, the AA gun and «Лом».</summary>
        [MenuItem("Realm of Ashes/PolygonApocalypse/Rebake worn item icons")]
        public static void RebakeIcons()
        {
            Environment.SetEnvironmentVariable("ROA_ITEM_BAKE_IDS",
                "weldedHelmet,helmet,tacticalHelmet,assaultHelmet,preWarHelmet,polygonAAGun01,metalArmor");
            RoaItemRenderBaker.RunSelected();
        }

        /// <summary>Catalog prefab for headgear that has a built variant, else null.</summary>
        public static GameObject CatalogVariant(string itemId) =>
            itemId == "tacticalHelmet" ? TacticalHelmet() : itemId == "preWarHelmet" ? PreWarHelmet() : null;

        /// <summary>Football helmet without the face guard (bars, brow and chin bars, their bolts), dark metal.</summary>
        public static GameObject TacticalHelmet()
        {
            GameObject source = Require(Attachments + "SM_Chr_Attach_FootballHelmet_01.prefab");
            Material metal = AssetDatabase.LoadAssetAtPath<Material>(MetalMaterial);
            if (metal == null) throw new InvalidOperationException("Missing " + MetalMaterial);
            string meshPath = OutputDir + "/tacticalHelmet.asset";
            WithReadable(source.GetComponentInChildren<MeshFilter>().sharedMesh, mesh =>
            {
                Vector3[] v = mesh.vertices;
                int[] t = mesh.triangles;
                var chosen = new List<int>(t.Length);
                foreach (List<int> shell in Shells(mesh))
                {
                    var bounds = new Bounds(v[t[shell[0]]], Vector3.zero);
                    foreach (int tri in shell)
                        for (int j = 0; j < 3; j++) bounds.Encapsulate(v[t[tri + j]]);
                    // The face guard hangs in front of the face; the shell itself does not.
                    if (bounds.center.z > FaceGuardZ && shell.Count < 300) continue;
                    foreach (int tri in shell) { chosen.Add(t[tri]); chosen.Add(t[tri + 1]); chosen.Add(t[tri + 2]); }
                }
                Mesh variant = UnityEngine.Object.Instantiate(mesh);
                variant.name = "PolygonApocalypse_TacticalHelmet_NativeSize";
                variant.triangles = chosen.ToArray();
                SaveMesh(variant, meshPath);
            });
            source = Require(Attachments + "SM_Chr_Attach_FootballHelmet_01.prefab");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(source);
            try
            {
                instance.name = "PolygonApocalypse_TacticalHelmet";
                instance.GetComponentInChildren<MeshFilter>().sharedMesh = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
                foreach (MeshRenderer renderer in instance.GetComponentsInChildren<MeshRenderer>(true))
                {
                    var materials = new Material[renderer.sharedMaterials.Length];
                    for (int i = 0; i < materials.Length; i++) materials[i] = metal;
                    renderer.sharedMaterials = materials;
                }
                return PrefabUtility.SaveAsPrefabAsset(instance, TacticalHelmetPath);
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }

        /// <summary>Army helmet with the pack's gas mask; both are authored on the head bone.</summary>
        public static GameObject PreWarHelmet()
        {
            EnsureFolder();
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(
                Require(Attachments + "SM_Chr_Attach_Soldier_Male_Helmet_01.prefab"));
            try
            {
                instance.name = "PolygonApocalypse_PreWarHelmet";
                var mask = (GameObject)PrefabUtility.InstantiatePrefab(
                    Require(Attachments + "SM_Chr_Attach_GasMask_01.prefab"), instance.transform);
                mask.transform.localPosition = Vector3.zero;
                mask.transform.localRotation = Quaternion.identity;
                mask.transform.localScale = Vector3.one;
                return PrefabUtility.SaveAsPrefabAsset(instance, PreWarHelmetPath);
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }

        private const float FaceGuardZ = 0.13f;

        private static GameObject Require(string path)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) throw new InvalidOperationException("PolygonApocalypse prefab missing: " + path);
            return prefab;
        }

        private static void EnsureFolder()
        {
            if (!AssetDatabase.IsValidFolder(OutputDir))
                AssetDatabase.CreateFolder("Assets/Resources/RealmOfAshes", "WornVariants");
        }

        private static void SaveMesh(Mesh mesh, string path)
        {
            EnsureFolder();
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null) AssetDatabase.CreateAsset(mesh, path);
            else
            {
                EditorUtility.CopySerialized(mesh, existing);
                UnityEngine.Object.DestroyImmediate(mesh);
                EditorUtility.SetDirty(existing);
            }
        }

        /// <summary>Connected shells of a mesh (vertices welded by position), as triangle start indices.</summary>
        internal static List<List<int>> Shells(Mesh mesh)
        {
            Vector3[] v = mesh.vertices;
            int[] t = mesh.triangles;
            var parent = new int[v.Length];
            for (int i = 0; i < v.Length; i++) parent[i] = i;
            int Find(int x) { while (parent[x] != x) x = parent[x] = parent[parent[x]]; return x; }
            var byPos = new Dictionary<Vector3Int, int>();
            for (int i = 0; i < v.Length; i++)
            {
                Vector3Int key = Vector3Int.RoundToInt(v[i] * 10000f);
                if (byPos.TryGetValue(key, out int other)) parent[Find(i)] = Find(other); else byPos[key] = i;
            }
            for (int i = 0; i < t.Length; i += 3)
            {
                parent[Find(t[i])] = Find(t[i + 1]);
                parent[Find(t[i + 1])] = Find(t[i + 2]);
            }
            var shells = new Dictionary<int, List<int>>();
            for (int i = 0; i < t.Length; i += 3)
            {
                int root = Find(t[i]);
                if (!shells.TryGetValue(root, out List<int> list)) shells[root] = list = new List<int>();
                list.Add(i);
            }
            return new List<List<int>>(shells.Values);
        }

        /// <summary>A CPU copy of a material's albedo atlas (pack textures are not readable).</summary>
        internal static Texture2D ReadableAtlas(Material material)
        {
            // Pack materials keep their atlas in _Albedo_Map, not in _BaseMap.
            Texture source = null;
            foreach (string name in new[] { "_Albedo_Map", "_BaseMap", "_MainTex" })
                if (source == null && material.HasProperty(name)) source = material.GetTexture(name);
            if (source == null) throw new InvalidOperationException("No albedo atlas on " + material.name);
            RenderTexture previous = RenderTexture.active;
            RenderTexture temporary = RenderTexture.GetTemporary(source.width, source.height, 0,
                RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            Graphics.Blit(source, temporary);
            RenderTexture.active = temporary;
            var copy = new Texture2D(source.width, source.height, TextureFormat.RGBA32, false);
            copy.ReadPixels(new Rect(0, 0, source.width, source.height), 0, 0);
            copy.Apply();
            RenderTexture.active = previous;
            RenderTexture.ReleaseTemporary(temporary);
            return copy;
        }

        internal static Color Sample(Texture2D atlas, Vector2 uv) =>
            atlas.GetPixelBilinear(uv.x - Mathf.Floor(uv.x), uv.y - Mathf.Floor(uv.y));

        /// <summary>Runs work with the mesh's model importer temporarily readable.</summary>
        internal static void WithReadable(Mesh mesh, Action<Mesh> work)
        {
            string path = AssetDatabase.GetAssetPath(mesh);
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            bool restore = importer != null && !importer.isReadable;
            if (restore) { importer.isReadable = true; importer.SaveAndReimport(); }
            try
            {
                Mesh readable = null;
                foreach (UnityEngine.Object asset in AssetDatabase.LoadAllAssetsAtPath(path))
                    if (asset is Mesh candidate && candidate.name == mesh.name) readable = candidate;
                work(readable ?? mesh);
            }
            finally
            {
                if (restore) { importer.isReadable = false; importer.SaveAndReimport(); }
            }
        }
    }
}
#endif
