#if UNITY_EDITOR
using System;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Builds the runtime environment palette from reviewed Mobile Environment Pack assets.</summary>
    public static class RoaEnvironmentPaletteAuthoring
    {
        public const string AssetPath = "Assets/Resources/RealmOfAshes/EnvironmentPalette.asset";

        private static readonly string[] DryScrubs =
        {
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Grass/MEP_Grass/Prefabs/MEP_Grass_A_02_Dry.prefab",
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Bushes/MEP_Bush_01/Prefabs/MEP_Bush_01_b_Autumn_N.prefab",
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Bushes/MEP_Bush_02/Prefabs/MEP_Bush_02_c_Autumn_N.prefab",
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Bushes/MEP_Bush_04/Prefabs/MEP_Bush_04_a.prefab"
        };

        private static readonly string[] Stones =
        {
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_a.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_d.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_h.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Stones_01/Prefabs/MEP_Stone_06.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_a_Sand.prefab"
        };

        private static readonly string[] GroundAccents =
        {
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_02.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_03.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_05.prefab"
        };

        private static readonly string[] DistantRidges =
        {
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Rock_01/Prefabs/MEP_Rock_01_N_a_Sand.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Rock_04/Prefabs/MEP_Rock_04_b_Sand.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_01/Prefabs/MEP_Desert_Cliff_02.prefab",
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_01/Prefabs/MEP_Desert_Cliff_06.prefab"
        };

        [MenuItem("Realm of Ashes/Build Environment Palette 4.4")]
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
            Debug.Log("[WORLD READABILITY 4.4] MEP palette saved: scrub=" + palette.DryScrubCount
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
