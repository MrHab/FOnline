#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaLairPropCatalogBuilder
    {
        private const string Output = "Assets/Resources/RealmOfAshes/LairProps.asset";
        private const string Source = "Assets/Synty/PolygonApocalypse/Prefabs/";

        private static readonly string[] Paths =
        {
            "Props/SM_Prop_Tent_Dome_01",
            "Props/SM_Prop_Tent_Dome_Damaged_01",
            "Props/SM_Prop_Sleeping_Bag_01",
            "Props/SM_Prop_Barricade_01",
            "Props/SM_Prop_Barricade_02",
            "Props/SM_Prop_FirePit_01",
            "Props/SM_Prop_Camp_Chair_01",
            "Props/SM_Prop_SupplyPile_01",
            "Props/SM_Prop_Dog_House_01",
            "Props/SM_Prop_Skull_01",
            "Environment/SM_Env_DirtPile_01",
            "Environment/SM_Env_DirtPile_02",
            "Props/SM_Prop_BloodPool_01",
            "Props/SM_Prop_BloodSplat_01",
            "DeadBodies/SM_Prop_DeadBody_Laying_Male_01",
            "Props/SM_Prop_Wall_Wire_Damaged_01",
            "Props/SM_Prop_Vents_Exhaust_01",
            "Props/SM_Prop_TrashPile_03",
            "Environment/SM_Env_Overgrowth_03",
            "Environment/SM_Env_Overgrowth_05",
            "Props/SM_Prop_Roof_Satellite_Dish_01",
            "Props/SM_Prop_Loud_Speaker_01",
            "Props/SM_Prop_Wire_01",
            "Props/SM_Prop_Bear_Trap_01",
            "Environment/SM_Env_Rock_01",
            "Environment/SM_Env_Rubble_Pebbles_01",
            "Environment/SM_Env_GroundLeaves_03",
            "Environment/SM_Env_Tree_Dead_02",
            "Props/SM_Prop_Skull_Silver_01",
            "Props/SM_Prop_Glass_Shard_02",
            "Props/SM_Prop_Bed_Gurney_BodySheet_01",
            "DeadBodies/SM_Prop_BodyBag_Pile_01",
            "Props/SM_Prop_Medical_Container_Broken_01",
            "Props/SM_Prop_BurnPile_01",
            "Props/SM_Prop_BurnPile_Books_01",
            "Props/SM_Prop_Luggage_Open_01",
            "Props/SM_Prop_Chemical_02",
            "Props/SM_Prop_Barrel_Nuke_Pool_01",
            "Environment/SM_Env_GrassBlob_11",
            "Environment/SM_Env_Bushes_02",
            "FX/FX_Fire_01"
        };

        [MenuItem("Realm of Ashes/PolygonApocalypse/Build lair prefab references")]
        public static void Build()
        {
            var entries = new List<RoaLairPropCatalog.Entry>();
            foreach (string path in Paths)
            {
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(Source + path + ".prefab");
                if (prefab == null) throw new InvalidOperationException("Missing PolygonApocalypse prefab: " + path);
                entries.Add(new RoaLairPropCatalog.Entry
                {
                    key = path.Substring(path.LastIndexOf('/') + 1),
                    prefab = prefab
                });
            }
            RoaLairPropCatalog catalog = AssetDatabase.LoadAssetAtPath<RoaLairPropCatalog>(Output);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<RoaLairPropCatalog>();
                AssetDatabase.CreateAsset(catalog, Output);
            }
            catalog.Configure(entries);
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA] Lair catalog references " + entries.Count + " PolygonApocalypse prefabs.");
        }
    }
}
#endif
