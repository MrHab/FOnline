using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseModelCatalogBuilder
    {
        private const string Root = "Assets/Synty/PolygonApocalypse/Prefabs/";
        private const string Output = "Assets/Resources/RealmOfAshes/PolygonApocalypseModels.asset";

        [Serializable]
        private sealed class WeaponCatalog
        {
            public WeaponCatalogEntry[] weapons;
        }

        [Serializable]
        private sealed class WeaponCatalogEntry
        {
            public string itemId;
            public string prefab;
            public string rigId;
            public string combatId;
            public string name;
            public float weight;
        }

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
            GameObject compactShotgun = RoaApocalypseShotgunVariantBuilder.Build();
            string manifestPath = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../data/kromka/apocalypse-weapons.json"));
            WeaponCatalog catalogFile = JsonUtility.FromJson<WeaponCatalog>(File.ReadAllText(manifestPath));
            if (catalogFile == null || catalogFile.weapons == null || catalogFile.weapons.Length == 0)
                throw new InvalidOperationException("PolygonApocalypse weapon roster is empty: " + manifestPath);
            var weapons = new List<RoaApocalypseModels.WeaponEntry>();
            var weaponIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (WeaponCatalogEntry row in catalogFile.weapons)
            {
                if (row == null || string.IsNullOrEmpty(row.itemId) || !weaponIds.Add(row.itemId))
                    throw new InvalidOperationException("Duplicate PolygonApocalypse weapon ID: " + row?.itemId);
                weapons.Add(new RoaApocalypseModels.WeaponEntry
                {
                    itemId = row.itemId,
                    prefab = Require(row.prefab),
                    rigId = row.rigId,
                    combatId = row.combatId,
                    displayName = row.name,
                    weight = row.weight
                });
            }
            // The saved one-handed shotgun keeps its historical gameplay ID.
            weapons.Add(new RoaApocalypseModels.WeaponEntry
            {
                itemId = "sawedOffShotgun",
                prefab = compactShotgun,
                rigId = "sawedOffShotgun",
                combatId = "sawedOffShotgun",
                displayName = "Дробовик «Коротыш»",
                weight = 2.4f
            });

            // Every armor ID gets a different visible body for both character
            // sexes. The sealed hazmat suit hides body shape and serves both.
            // A shared "soldier" bucket made changing armor invisible.
            var armor = new List<RoaApocalypseModels.ArmorEntry>
            {
                Armor("leather", "SM_Chr_Biker_Male_01", "SM_Chr_Punk_Female_01"),
                Armor("metalArmor", "SM_Chr_Criminal_Male_01", "SM_Chr_Mechanic_Female_01"),
                Armor("ballisticVest", "SM_Chr_Hunter_Male_01", "SM_Chr_Eastern_Female_01"),
                Armor("combatArmor", "SM_Chr_Soldier_Male_01", "SM_Chr_Soldier_Female_01"),
                // Bastion uses frontline uniforms plus separate metal plates;
                // the old business/emo bodies were visibly unarmored.
                Armor("heavyArmor", "SM_Chr_RiotCop_Male_01", "SM_Chr_RiotCop_Male_01"),
                Armor("hazmatSuit", "SM_Chr_Hazmat_Male_01", "SM_Chr_Hazmat_Male_01"),
                Armor("energySuit", "SM_Chr_Press_Male_01", "SM_Chr_Cool_Female_01")
            };
            // The permanent player body no longer changes with armor. A donor
            // uniform may be shared; each item's garment and plates stay distinct.
            var footwear = new List<RoaApocalypseModels.FootwearEntry>
            {
                Footwear("boots", "SM_Chr_Biker_Male_01", "SM_Chr_Punk_Female_01", "Sports", false),
                Footwear("scoutBoots", "SM_Chr_Soldier_Male_01", "SM_Chr_Soldier_Female_01", "Metal", false),
                Footwear("reinforcedBoots", "SM_Chr_RiotCop_Male_01", "SM_Chr_Eastern_Female_01", null, true),
                Footwear("assaultBoots", "SM_Chr_Hazmat_Male_01", "SM_Chr_Mechanic_Female_01", "Metal", true)
            };

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
            AddItems(itemPaths, "Props/SM_Prop_ToolBox_01", "ore", "scrap", "alloyPlate", "weaponParts");
            AddItems(itemPaths, "Props/SM_Prop_Chemical_01", "chemicals", "spectrumSample", "stabilizerCatalyst");
            AddItems(itemPaths, "Item/SM_Item_Log_01", "wood");
            AddItems(itemPaths, "Item/SM_Item_Can_01", "food");
            AddItems(itemPaths, "Item/SM_Item_Drink_Bottle_01", "water");
            AddItems(itemPaths, "Item/SM_Item_Shop_Goods_01", "silver", "blue");
            AddItems(itemPaths, "Props/SM_Prop_Skull_01", "trophy");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Armour_Knee_Sports_L_01", "boots");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Armour_Knee_Metal_L_01", "scoutBoots");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Armour_Thigh_Metal_L_01", "reinforcedBoots");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Armour_Knee_Metal_R_01", "assaultBoots");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Backpack_01", "backpack");
            AddItems(itemPaths, "Props/SM_Prop_Radio_01", "artifactDetectorMk1", "artifactDetectorMk2", "artifactDetectorMk3");
            AddItems(itemPaths, "Props/SM_Prop_Ammo_Box_Belt_01", "artifactBelt2", "artifactBelt3", "artifactBelt4");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Mask_Hockey_01", "weldedHelmet");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Soldier_Male_Helmet_01", "helmet");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_FootballHelmet_01", "tacticalHelmet");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_RiotCop_Male_Helmet_01", "assaultHelmet");
            AddItems(itemPaths, "Characters/Attachments/SM_Chr_Attach_Scout_Female_Hat_01", "preWarHelmet");
            foreach (RoaApocalypseModels.ArmorEntry row in armor)
                itemPaths[row.itemId] = "Characters/" + row.malePrefab.name;
            // Материалы и точки добычи по тирам — из data/kromka/tiers.json (visuals):
            // у каждого тира сырья и полуфабриката свой префаб пака.
            var tierNodes = new List<RoaApocalypseModels.TierNodeEntry>();
            var itemTints = new Dictionary<string, Color>(StringComparer.Ordinal);
            var itemPaints = new HashSet<string>(StringComparer.Ordinal);
            JObject tierData = JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "..", "..", "data", "kromka", "tiers.json")));
            foreach (JObject family in (JArray)tierData["families"])
            {
                JObject visuals = (JObject)family["visuals"];
                if (visuals == null) continue;
                foreach (string kind in new[] { "raw", "refined" })
                {
                    JArray ids = (JArray)family[kind]["ids"];
                    JArray paths = (JArray)visuals[kind];
                    for (int i = 0; i < ids.Count && i < paths.Count; i++)
                    {
                        itemPaths[ids[i].ToString()] = VisualPath(paths[i]);
                        itemTints[ids[i].ToString()] = VisualTint(paths[i]);
                        if (VisualPaint(paths[i])) itemPaints.Add(ids[i].ToString());
                    }
                }
                JArray nodes = (JArray)visuals["nodes"];
                for (int i = 0; nodes != null && i < nodes.Count; i++)
                    tierNodes.Add(new RoaApocalypseModels.TierNodeEntry
                    {
                        resourceType = family["resourceType"].ToString(),
                        tier = i + 1,
                        prefab = Require(VisualPath(nodes[i])),
                        tint = VisualTint(nodes[i]),
                        paint = VisualPaint(nodes[i])
                    });
            }
            var items = new List<RoaApocalypseModels.ItemEntry>();
            foreach (KeyValuePair<string, string> pair in itemPaths)
                items.Add(new RoaApocalypseModels.ItemEntry
                {
                    itemId = pair.Key,
                    prefab = Require(pair.Value),
                    tint = itemTints.TryGetValue(pair.Key, out Color tint) ? tint : Color.white,
                    paint = itemPaints.Contains(pair.Key)
                });

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
                Require("Vehicles/SM_Veh_Motorbike_Apoco_01"),
                weapons, items, armor, footwear, creatures,
                environment,
                Require("Props/SM_Prop_TrashPile_01"),
                Require("Environment/SM_Env_Road_Dirt_Straight_01"),
                Require("Environment/SM_Env_Bushes_01"),
                Require("Buildings/SM_Bld_Junk_Shelter_01"),
                Require("Props/SM_Prop_Barrier_Concrete_01"),
                Require("Buildings/SM_Bld_RadioTower_01"),
                Require("Props/SM_Prop_Generator_01"),
                Require("Environment/SM_Env_Rock_01"));
            catalog.ConfigureTierNodes(tierNodes);
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA APOCALYPSE] Runtime palette: " + weapons.Count
                + " weapons, " + items.Count + " ground items, " + creatures.Count
                + " creature roles, " + environment.Count
                + " environment models, six bodies and one vehicle.");
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Validate weapon roster")]
        public static void ValidateWeaponRoster()
        {
            string manifestPath = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../data/kromka/apocalypse-weapons.json"));
            WeaponCatalog manifest = JsonUtility.FromJson<WeaponCatalog>(File.ReadAllText(manifestPath));
            if (manifest?.weapons == null || manifest.weapons.Length == 0)
                throw new InvalidOperationException("PolygonApocalypse weapon manifest is empty.");
            if (RoaApocalypseModels.WeaponEntries == null
                || RoaApocalypseModels.WeaponEntries.Count != manifest.weapons.Length + 1)
                throw new InvalidOperationException("Runtime weapon palette has missing entries.");
            foreach (WeaponCatalogEntry row in manifest.weapons)
            {
                GameObject prefab = RoaApocalypseModels.Weapon(row.itemId);
                if (prefab == null || prefab != Require(row.prefab))
                    throw new InvalidOperationException("Weapon prefab is missing: " + row.itemId);
                if (RoaApocalypseModels.WeaponRig(row.itemId) != row.rigId)
                    throw new InvalidOperationException("Weapon grip rig is wrong: " + row.itemId);
                if (RoaApocalypseModels.WeaponCombatId(row.itemId) != row.combatId)
                    throw new InvalidOperationException("Weapon combat profile is wrong: " + row.itemId);
                if (prefab.GetComponentsInChildren<Renderer>(true).Length == 0)
                    throw new InvalidOperationException("Weapon has no visible mesh: " + row.itemId);
                string rigPath = Path.GetFullPath(Path.Combine(Application.dataPath,
                    "../../public/assets/models/weapons/weapon_" + row.rigId + ".glb"));
                if (!File.Exists(rigPath))
                    throw new InvalidOperationException("Weapon grip rig is missing: " + row.rigId);
                if (row.itemId.StartsWith("polygon", StringComparison.Ordinal)
                    && (RoaItemData.Name(row.itemId) != row.name
                        || Mathf.Abs(RoaItemData.Weight(row.itemId) - row.weight) > 0.001f))
                    throw new InvalidOperationException("Weapon item fallback is wrong: " + row.itemId);
            }
            Debug.Log("[ROA APOCALYPSE] Weapon roster PASS: " + manifest.weapons.Length
                + " pack models, grip rigs, renderers and local item definitions.");
        }

        private static void AddItems(Dictionary<string, string> paths, string prefab, params string[] ids)
        {
            foreach (string id in ids) paths.Add(id, prefab);
        }

        private static RoaApocalypseModels.ArmorEntry Armor(
            string itemId, string malePrefab, string femalePrefab)
        {
            return new RoaApocalypseModels.ArmorEntry
            {
                itemId = itemId,
                malePrefab = Require("Characters/" + malePrefab),
                femalePrefab = Require("Characters/" + femalePrefab)
            };
        }

        private static RoaApocalypseModels.FootwearEntry Footwear(
            string itemId, string malePrefab, string femalePrefab, string kneeStyle, bool thigh)
        {
            string root = "Characters/Attachments/SM_Chr_Attach_Armour_";
            return new RoaApocalypseModels.FootwearEntry
            {
                itemId = itemId,
                malePrefab = Require("Characters/" + malePrefab),
                femalePrefab = Require("Characters/" + femalePrefab),
                leftKnee = kneeStyle == null ? null : Require(root + "Knee_" + kneeStyle + "_L_01"),
                rightKnee = kneeStyle == null ? null : Require(root + "Knee_" + kneeStyle + "_R_01"),
                leftThigh = thigh ? Require(root + "Thigh_Metal_L_01") : null,
                rightThigh = thigh ? Require(root + "Thigh_Metal_R_01") : null
            };
        }

        private static void AddCreatures(List<RoaApocalypseModels.CreatureEntry> entries,
            string prefab, float pitch, params string[] modelKeys)
        {
            GameObject model = Require(prefab);
            foreach (string key in modelKeys)
                entries.Add(new RoaApocalypseModels.CreatureEntry
                    { modelKey = key, prefab = model, pitch = pitch });
        }

        /// <summary>Облик в tiers.json: строка пути префаба или { prefab, tint: "#RRGGBB" }.</summary>
        private static string VisualPath(JToken visual)
        {
            return visual is JObject row ? row["prefab"]?.ToString() : visual?.ToString();
        }

        private static Color VisualTint(JToken visual)
        {
            string hex = visual is JObject row ? row["tint"]?.ToString() : null;
            return !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out Color tint) ? tint : Color.white;
        }

        private static bool VisualPaint(JToken visual)
        {
            return visual is JObject row && row["paint"]?.Type == JTokenType.Boolean && row["paint"].ToObject<bool>();
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
