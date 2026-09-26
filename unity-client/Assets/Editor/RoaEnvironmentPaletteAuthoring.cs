#if UNITY_EDITOR
using System;
using System.IO;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Builds the runtime environment palette from PolygonApocalypse prefabs.</summary>
    public static class RoaEnvironmentPaletteAuthoring
    {
        public const string AssetPath = "Assets/Resources/RealmOfAshes/EnvironmentPalette.asset";
        private const string Environment = "Assets/Synty/PolygonApocalypse/Prefabs/Environment/";

        [InitializeOnLoadMethod]
        private static void BuildIfRequested()
        {
            string request = Path.Combine(Application.dataPath,
                "../Library/roa-apocalypse-environment-palette.request");
            if (!File.Exists(request)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(request) || EditorApplication.isPlayingOrWillChangePlaymode) return;
                File.Delete(request);
                Build();
            };
        }

        private static readonly string[] DryScrubs =
        {
            Environment + "SM_Env_Bushes_01.prefab",
            Environment + "SM_Env_Bushes_02.prefab",
            Environment + "SM_Env_Bushes_03.prefab",
            Environment + "SM_Env_Bushes_04.prefab"
        };

        private static readonly string[] Stones =
        {
            Environment + "SM_Env_Rock_01.prefab",
            Environment + "SM_Env_Rock_02.prefab",
            Environment + "SM_Env_Rock_03.prefab",
            Environment + "SM_Env_DirtPile_01.prefab",
            Environment + "SM_Env_DirtPile_02.prefab"
        };

        private static readonly string[] GroundAccents =
        {
            Environment + "SM_Env_Grass_Tuft_01.prefab",
            Environment + "SM_Env_Grass_Tuft_02.prefab",
            Environment + "SM_Env_Grass_Tuft_03.prefab"
        };

        private static readonly string[] DistantRidges =
        {
            Environment + "SM_Env_Dirt_Slope_01.prefab",
            Environment + "SM_Env_Dirt_Slope_02.prefab",
            Environment + "SM_Env_Dirt_Slope_Bump_01.prefab",
            Environment + "SM_Env_Dirt_Slope_Bump_02.prefab"
        };

        [MenuItem("Realm of Ashes/PolygonApocalypse/Rebuild environment palette")]
        public static void Build()
        {
            EnsureFolder("Assets/Resources");
            EnsureFolder("Assets/Resources/RealmOfAshes");

            RoaEnvironmentPalette palette = AssetDatabase.LoadAssetAtPath<RoaEnvironmentPalette>(AssetPath);
            if (palette == null)
            {
                palette = ScriptableObject.CreateInstance<RoaEnvironmentPalette>();
                palette.name = "EnvironmentPalette";
                AssetDatabase.CreateAsset(palette, AssetPath);
            }

            var serialized = new SerializedObject(palette);
            Assign(serialized.FindProperty("_dryScrubs"), DryScrubs);
            Assign(serialized.FindProperty("_stones"), Stones);
            Assign(serialized.FindProperty("_groundAccents"), GroundAccents);
            Assign(serialized.FindProperty("_distantRidges"), DistantRidges);
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(palette);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(AssetPath, ImportAssetOptions.ForceUpdate);

            if (!palette.Ready) throw new InvalidOperationException("Environment palette is incomplete after authoring.");
            Debug.Log("[POLYGON APOCALYPSE] Environment palette saved: scrub=" + palette.DryScrubCount
                + ", stones=" + palette.StoneCount + ", accents=" + palette.GroundAccentCount
                + ", ridges=" + palette.DistantRidgeCount);
        }

        private static void Assign(SerializedProperty property, string[] paths)
        {
            if (property == null) throw new InvalidOperationException("Environment palette field is missing.");
            property.arraySize = paths.Length;
            for (int i = 0; i < paths.Length; i++)
            {
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(paths[i]);
                if (prefab == null) throw new InvalidOperationException("Missing curated environment prefab: " + paths[i]);
                property.GetArrayElementAtIndex(i).objectReferenceValue = prefab;
            }
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            string parent = path.Substring(0, slash);
            string name = path.Substring(slash + 1);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, name);
        }
    }
}
#endif
