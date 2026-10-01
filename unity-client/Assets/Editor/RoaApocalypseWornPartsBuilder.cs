#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Collects the pack attachments worn over armor into RoaApocalypseWornParts.</summary>
    public static class RoaApocalypseWornPartsBuilder
    {
        private const string Output = "Assets/Resources/RealmOfAshes/PolygonApocalypseWornParts.asset";
        private const string Prefabs = "Assets/Synty/PolygonApocalypse/Prefabs";
        private const string PlateDonor = "Assets/Synty/PolygonApocalypse/Prefabs/Characters/SM_Chr_Criminal_Male_01.prefab";
        private const string MetalMaterial = "Assets/Synty/PolygonApocalypse/Materials/Alts/PolygonApocalypse_01_Burnt.mat";

        internal static readonly string[] PartNames =
        {
            "Armour_Knee_Metal_L_01", "Armour_Knee_Metal_R_01",
            "Armour_Wrist_Metal_L_01", "Armour_Wrist_Metal_R_01",
            "Pouch_01", "Pouch_02", "Pouch_03", "SupplyBag_01",
            "RiotCop_Male_Radio_01", "Scout_Female_Radio_01"
        };

        [MenuItem("Realm of Ashes/PolygonApocalypse/Rebuild worn parts")]
        public static void Build()
        {
            var metal = AssetDatabase.LoadAssetAtPath<Material>(MetalMaterial);
            if (metal == null) throw new InvalidOperationException("Missing " + MetalMaterial);
            var plateDonor = AssetDatabase.LoadAssetAtPath<GameObject>(PlateDonor);
            if (plateDonor == null) throw new InvalidOperationException("Missing " + PlateDonor);
            var parts = new List<RoaApocalypseWornParts.Part>();
            foreach (string name in PartNames)
            {
                GameObject prefab = null;
                foreach (string guid in AssetDatabase.FindAssets("SM_Chr_Attach_" + name + " t:Prefab", new[] { Prefabs }))
                {
                    string path = AssetDatabase.GUIDToAssetPath(guid);
                    if (System.IO.Path.GetFileNameWithoutExtension(path) == "SM_Chr_Attach_" + name)
                        prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                }
                if (prefab == null) throw new InvalidOperationException("Missing pack attachment " + name);
                parts.Add(new RoaApocalypseWornParts.Part { name = name, prefab = prefab });
            }
            var catalog = AssetDatabase.LoadAssetAtPath<RoaApocalypseWornParts>(Output);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<RoaApocalypseWornParts>();
                catalog.Configure(metal, plateDonor, parts);
                AssetDatabase.CreateAsset(catalog, Output);
            }
            else
            {
                catalog.Configure(metal, plateDonor, parts);
                EditorUtility.SetDirty(catalog);
            }
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA APOCALYPSE] Worn parts: " + parts.Count + " attachments.");
        }
    }
}
#endif
