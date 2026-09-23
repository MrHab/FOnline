using System;
using System.Collections.Generic;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseModelCatalogBuilder
    {
        private const string Root = "Assets/Synty/PolygonApocalypse/Prefabs/";
        private const string Output = "Assets/Resources/RealmOfAshes/PolygonApocalypseModels.asset";

        [InitializeOnLoadMethod]
        private static void BuildIfRequested()
        {
            string request = Path.Combine(Application.dataPath,
                "../Library/roa-apocalypse-catalog.request");
            if (!File.Exists(request)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(request) || EditorApplication.isPlayingOrWillChangePlaymode) return;
                File.Delete(request);
                Build();
            };
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Rebuild runtime model palette")]
        public static void Build()
        {
            var weaponPaths = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                { "pistol", "Weapons/Guns/SM_Wep_Pistol_01" },
                { "revolver", "Weapons/Guns/SM_Wep_Revolver_01" },
                { "sawedOffShotgun", "Weapons/Guns/SM_Wep_Shotgun_01" },
                { "smg", "Weapons/Guns/SM_Wep_SubMGun_01" },
                { "rifle", "Weapons/Guns/SM_Wep_HuntingRifle_01" },
                { "assaultRifle", "Weapons/Guns/SM_Wep_AssaultRifle_01" },
                { "machineGun", "Weapons/Guns/SM_Wep_MachineGun_01" },
                { "laserPistol", "Weapons/Guns/SM_Wep_Hybrid_01" },
                { "flamethrower", "Weapons/Misc/SM_Wep_FlameThrower_01" },
                { "plasmaRifle", "Weapons/Guns/SM_Wep_Hybrid_02" },
                { "shotgun", "Weapons/Guns/SM_Wep_Shotgun_01" },
                { "rocketLauncher", "Weapons/Guns/SM_Wep_RocketLauncher_01" },
                { "knife", "Weapons/Melee/SM_Wep_Melee_HuntingKnife_01" },
                { "pickaxe", "Weapons/Melee/SM_Wep_Spade_01" },
                { "axe", "Weapons/Melee/SM_Wep_FireAxe_01" },
                { "handPump", "Weapons/Melee/SM_Wep_PipeWrench_01" }
            };
            var weapons = new List<RoaApocalypseModels.WeaponEntry>();
            foreach (KeyValuePair<string, string> pair in weaponPaths)
                weapons.Add(new RoaApocalypseModels.WeaponEntry
                {
                    itemId = pair.Key,
                    prefab = Require(pair.Value)
                });

            // The world can drop any of these items at runtime. Reuse a small
            // set of recognisable pack props where it has no exact counterpart.
            var itemPaths = new Dictionary<string, string>(StringComparer.Ordinal);
            AddItems(itemPaths, "Item/SM_Item_Ammo_9mm_01", "ammo9");
            AddItems(itemPaths, "Item/SM_Item_Ammo_556_01", "ammo556");
            AddItems(itemPaths, "Item/SM_Item_Ammo_12G_01", "shotgunShell");
            AddItems(itemPaths, "Props/SM_Prop_Ammo_Box_01", "rocketAmmo", "ammoParts");
            AddItems(itemPaths, "Item/SM_Item_Battery_01", "energyCell");
            AddItems(itemPaths, "Props/SM_Prop_CarBattery_01", "electronics", "circuitModule");
            AddItems(itemPaths, "Props/SM_Prop_GasCan_01", "napalm", "oil");
            AddItems(itemPaths, "Props/SM_Prop_MedicalBox_01", "medkit", "medicine", "bioReagent");
            AddItems(itemPaths, "Item/SM_Item_Pills_01", "stim", "antibiotics");
            AddItems(itemPaths, "Item/SM_Item_Duffle_Bag_01", "doctorBag");
            AddItems(itemPaths, "Props/SM_Prop_Medical_Container_01", "artifactContainer", "repairKit");
            AddItems(itemPaths, "Props/SM_Prop_ToolBox_01", "ore", "scrap", "alloyPlate", "weaponParts", "metalArmor", "ballisticVest", "combatArmor", "heavyArmor", "energySuit");
            AddItems(itemPaths, "Props/SM_Prop_Chemical_01", "chemicals", "spectrumSample", "stabilizerCatalyst");
            AddItems(itemPaths, "Item/SM_Item_Log_01", "wood");
            AddItems(itemPaths, "Item/SM_Item_Can_01", "food");
            AddItems(itemPaths, "Item/SM_Item_Drink_Bottle_01", "water");
            AddItems(itemPaths, "Item/SM_Item_Shop_Goods_01", "silver", "blue");
            AddItems(itemPaths, "Props/SM_Prop_Skull_01", "trophy");
            AddItems(itemPaths, "Props/SM_Prop_CardboardBox_01", "leather", "hazmatSuit", "boots", "assaultBoots", "reinforcedBoots", "scoutBoots");
            AddItems(itemPaths, "Item/SM_Item_Duffle_Bag_01", "backpack");
            AddItems(itemPaths, "Props/SM_Prop_Radio_01", "artifactDetectorMk1", "artifactDetectorMk2", "artifactDetectorMk3");
            AddItems(itemPaths, "Props/SM_Prop_Ammo_Box_Belt_01", "artifactBelt2", "artifactBelt3", "artifactBelt4");
            AddItems(itemPaths, "Props/SM_Prop_Chemical_02", "artifactSpring", "artifactVein", "artifactNode", "artifactDrop", "artifactBloodkin", "artifactShell", "artifactWarmer", "artifactSieve", "artifactThunderer", "artifactHusher", "artifactAnchor", "artifactDew", "artifactMemory", "artifactUnknown");
            AddItems(itemPaths, "Props/SM_Prop_Tool_Bucket_01", "preWarHelmet", "weldedHelmet", "helmet", "tacticalHelmet", "assaultHelmet");
            var items = new List<RoaApocalypseModels.ItemEntry>();
            foreach (KeyValuePair<string, string> pair in itemPaths)
                items.Add(new RoaApocalypseModels.ItemEntry { itemId = pair.Key, prefab = Require(pair.Value) });

            var creatures = new List<RoaApocalypseModels.CreatureEntry>();
            AddCreatures(creatures, "Characters/SM_Chr_Wanderer_Male_01", 0f,
                "traderNpc", "caravanMerchant");
            AddCreatures(creatures, "Characters/SM_Chr_Soldier_Male_01", 0f,
                "caravanGuard", "klimPatrolGuard");
            AddCreatures(creatures, "Characters/SM_Chr_Scout_Female_01", 0f, "wastelandSettler");
            AddCreatures(creatures, "Characters/SM_Chr_Criminal_Male_01", 0f, "enemyRaider");
            AddCreatures(creatures, "Characters/SM_Chr_Zombie_Male_01", 0f,
                "enemyGhoul", "kromkaBurned", "kromkaFold");
            AddCreatures(creatures, "Characters/SM_Chr_Zombie_Male_02", 0f,
                "enemySuperMutant");
            AddCreatures(creatures, "Characters/SM_Chr_Zombie_Male_02", 70f,
                "enemyAshWolf", "kromkaGari", "enemyGecko", "kromkaListener");
            AddCreatures(creatures, "Characters/SM_Chr_Zombie_Female_02", 70f,
                "enemyRadscorpion", "kromkaRykhlyak", "enemyFireGecko", "kromkaMourner");
            AddCreatures(creatures, "Characters/SM_Chr_Zombie_Female_01", 75f,
                "enemyMutantAnt", "kromkaDustling");
            AddCreatures(creatures, "Characters/SM_Chr_Zombie_Female_02", 55f,
                "brahmin", "friendlyBrahmin", "kromkaLantern");

            var environment = new List<RoaApocalypseModels.EnvironmentEntry>();
            foreach (KeyValuePair<string, string> pair in RoaApocalypseArtMigration.EnvironmentModels)
                environment.Add(new RoaApocalypseModels.EnvironmentEntry
                {
                    modelKey = pair.Key,
                    prefab = Require(pair.Value)
                });

            RoaApocalypseModels catalog = AssetDatabase.LoadAssetAtPath<RoaApocalypseModels>(Output);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<RoaApocalypseModels>();
                AssetDatabase.CreateAsset(catalog, Output);
            }
            catalog.Configure(
                Require("Characters/SM_Chr_Wanderer_Male_01"),
                Require("Characters/SM_Chr_Scout_Female_01"),
                Require("Characters/SM_Chr_Soldier_Male_01"),
                Require("Characters/SM_Chr_Soldier_Female_01"),
                Require("Characters/SM_Chr_Hazmat_Male_01"),
                Require("Characters/SM_Chr_RiotCop_Male_01"),
                Require("Characters/Attachments/SM_Chr_Attach_Backpack_01"),
                Require("Characters/Attachments/SM_Chr_Attach_FootballHelmet_01"),
                Require("Vehicles/SM_Veh_Motorbike_Apoco_01"), weapons, items, creatures,
                environment,
                Require("Props/SM_Prop_TrashPile_01"),
                Require("Environment/SM_Env_Road_Dirt_Straight_01"),
                Require("Environment/SM_Env_Bushes_01"),
                Require("Buildings/SM_Bld_Junk_Shelter_01"),
                Require("Props/SM_Prop_Barrier_Concrete_01"),
                Require("Buildings/SM_Bld_RadioTower_01"),
                Require("Props/SM_Prop_Generator_01"),
                Require("Environment/SM_Env_Rock_01"));
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA APOCALYPSE] Runtime palette: " + weapons.Count
                + " weapons, " + items.Count + " ground items, " + creatures.Count
                + " creature roles, " + environment.Count
                + " environment models, six bodies and one vehicle.");
        }

        private static void AddItems(Dictionary<string, string> paths, string prefab, params string[] ids)
        {
            foreach (string id in ids) paths.Add(id, prefab);
        }

        private static void AddCreatures(List<RoaApocalypseModels.CreatureEntry> entries,
            string prefab, float pitch, params string[] modelKeys)
        {
            GameObject model = Require(prefab);
            foreach (string key in modelKeys)
                entries.Add(new RoaApocalypseModels.CreatureEntry
                    { modelKey = key, prefab = model, pitch = pitch });
        }

        private static GameObject Require(string relativePath)
        {
            string path = Root + relativePath + ".prefab";
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) throw new InvalidOperationException("PolygonApocalypse prefab missing: " + path);
            return prefab;
        }
    }
}
