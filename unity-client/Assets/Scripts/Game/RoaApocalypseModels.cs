using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Licensed PolygonApocalypse prefab references included in local builds.</summary>
    public sealed class RoaApocalypseModels : ScriptableObject
    {
        public const string ResourcePath = "RealmOfAshes/PolygonApocalypseModels";

        [Serializable]
        public sealed class WeaponEntry
        {
            public string itemId;
            public GameObject prefab;
            public string rigId;
            public string combatId;
            public string displayName;
            public float weight;
            /// <summary>Метка тира на этой модели (изолента на тонкой части).</summary>
            public RoaTierMarkPlacement mark = new RoaTierMarkPlacement();
        }

        [Serializable]
        public sealed class ItemEntry
        {
            public string itemId;
            public GameObject prefab;
            /// <summary>Метка тира на этой модели: изолента или мазок краски сверху.</summary>
            public RoaTierMarkPlacement mark = new RoaTierMarkPlacement();
        }

        [Serializable]
        public sealed class ArmorEntry
        {
            public string itemId;
            public GameObject malePrefab;
            public GameObject femalePrefab;
        }

        [Serializable]
        public sealed class FootwearEntry
        {
            public string itemId;
            public GameObject malePrefab;
            public GameObject femalePrefab;
            public GameObject leftKnee;
            public GameObject rightKnee;
            public GameObject leftThigh;
            public GameObject rightThigh;
        }

        [Serializable]
        public sealed class CreatureEntry
        {
            public string modelKey;
            public GameObject prefab;
            public float pitch;
        }

        [Serializable]
        public sealed class EnvironmentEntry
        {
            public string modelKey;
            public GameObject prefab;
        }

        /// <summary>Облик точки добычи тира: жила, дерево, куст, бочка (data/kromka/tiers.json → visuals.nodes).</summary>
        [Serializable]
        public sealed class TierNodeEntry
        {
            public string resourceType;
            public int tier;
            public GameObject prefab;
            /// <summary>Кольцо краски цвета тира у основания точки.</summary>
            public RoaTierMarkPlacement mark = new RoaTierMarkPlacement();
        }

        [SerializeField] private GameObject male;
        [SerializeField] private GameObject female;
        [SerializeField] private GameObject maleSoldier;
        [SerializeField] private GameObject femaleSoldier;
        [SerializeField] private GameObject maleHazmat;
        [SerializeField] private GameObject maleRiot;
        [SerializeField] private GameObject backpackAttachment;
        [SerializeField] private GameObject helmetAttachment;
        [SerializeField] private GameObject motorbike;
        [SerializeField] private List<WeaponEntry> weapons = new List<WeaponEntry>();
        [SerializeField] private List<ItemEntry> items = new List<ItemEntry>();
        [SerializeField] private List<ArmorEntry> armor = new List<ArmorEntry>();
        [SerializeField] private List<FootwearEntry> footwear = new List<FootwearEntry>();
        [SerializeField] private List<CreatureEntry> creatures = new List<CreatureEntry>();
        [SerializeField] private List<EnvironmentEntry> environment = new List<EnvironmentEntry>();
        [SerializeField] private List<TierNodeEntry> tierNodes = new List<TierNodeEntry>();
        [SerializeField] private GameObject defaultEnvironment;
        [SerializeField] private GameObject roadEnvironment;
        [SerializeField] private GameObject plantEnvironment;
        [SerializeField] private GameObject buildingEnvironment;
        [SerializeField] private GameObject barrierEnvironment;
        [SerializeField] private GameObject towerEnvironment;
        [SerializeField] private GameObject industrialEnvironment;
        [SerializeField] private GameObject rockEnvironment;

        private static RoaApocalypseModels _instance;
        private Dictionary<string, GameObject> _weapons;
        private Dictionary<string, string> _weaponRigs;
        private Dictionary<string, string> _weaponCombats;
        private Dictionary<string, GameObject> _items;
        private Dictionary<string, ArmorEntry> _armor;
        private Dictionary<string, FootwearEntry> _footwear;
        private Dictionary<string, CreatureEntry> _creatures;
        private Dictionary<string, GameObject> _environment;

        private static RoaApocalypseModels Instance =>
            _instance != null ? _instance : (_instance = Resources.Load<RoaApocalypseModels>(ResourcePath));

        public static GameObject Character(string bodyKey)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null) return null;
            return bodyKey != null && bodyKey.StartsWith("female", StringComparison.OrdinalIgnoreCase)
                ? palette.female : palette.male;
        }

        public static GameObject CharacterOutfit(bool femaleBody, string outfit)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null) return null;
            // Броня тира T1–T5 надевается моделью исходной брони.
            outfit = RoaItemData.VisualId(outfit);
            if (palette._armor == null)
            {
                palette._armor = new Dictionary<string, ArmorEntry>(StringComparer.Ordinal);
                foreach (ArmorEntry entry in palette.armor)
                    if (entry != null && !string.IsNullOrEmpty(entry.itemId))
                        palette._armor[entry.itemId] = entry;
            }
            if (palette._armor.TryGetValue(outfit ?? string.Empty, out ArmorEntry selected))
                return femaleBody ? selected.femalePrefab : selected.malePrefab;
            if (outfit == "hazmat") return femaleBody ? palette.femaleSoldier : palette.maleHazmat;
            if (outfit == "riot") return femaleBody ? palette.femaleSoldier : palette.maleRiot;
            if (outfit == "soldier") return femaleBody ? palette.femaleSoldier : palette.maleSoldier;
            return femaleBody ? palette.female : palette.male;
        }

        public static GameObject Vehicle(string itemId) =>
            itemId == "motorcycle" ? Instance?.motorbike : null;

        public static GameObject BackpackAttachment => Instance?.backpackAttachment;
        public static GameObject HelmetAttachment => Instance?.helmetAttachment;

        public static GameObject Weapon(string itemId)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return null;
            itemId = RoaItemData.VisualId(itemId);
            palette.EnsureWeapons();
            return palette._weapons.TryGetValue(itemId, out GameObject prefab) ? prefab : null;
        }

        // The imported GLB supplies grip, muzzle and reload sockets. Its renderers
        // are hidden by AttachStatic; several pack weapons can share one socket rig.
        public static string WeaponRig(string itemId)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return itemId;
            itemId = RoaItemData.VisualId(itemId);
            palette.EnsureWeapons();
            return palette._weaponRigs.TryGetValue(itemId, out string rigId) ? rigId : itemId;
        }

        public static string WeaponCombatId(string itemId)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return itemId;
            itemId = RoaItemData.VisualId(itemId);
            palette.EnsureWeapons();
            return palette._weaponCombats.TryGetValue(itemId, out string combatId) ? combatId : itemId;
        }

        public static IReadOnlyList<WeaponEntry> WeaponEntries => Instance?.weapons;
        public static IReadOnlyList<ArmorEntry> ArmorEntries => Instance?.armor;

        public static FootwearEntry Footwear(string itemId)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return null;
            itemId = RoaItemData.VisualId(itemId);
            if (palette._footwear == null)
            {
                palette._footwear = new Dictionary<string, FootwearEntry>(StringComparer.Ordinal);
                foreach (FootwearEntry entry in palette.footwear)
                    if (entry != null && !string.IsNullOrEmpty(entry.itemId))
                        palette._footwear[entry.itemId] = entry;
            }
            return palette._footwear.TryGetValue(itemId, out FootwearEntry selected)
                ? selected : null;
        }

        private void EnsureWeapons()
        {
            if (_weapons != null) return;
            _weapons = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            _weaponRigs = new Dictionary<string, string>(StringComparer.Ordinal);
            _weaponCombats = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (WeaponEntry entry in weapons)
            {
                if (entry == null || string.IsNullOrEmpty(entry.itemId) || entry.prefab == null) continue;
                _weapons[entry.itemId] = entry.prefab;
                _weaponRigs[entry.itemId] = string.IsNullOrEmpty(entry.rigId) ? entry.itemId : entry.rigId;
                _weaponCombats[entry.itemId] = string.IsNullOrEmpty(entry.combatId)
                    ? _weaponRigs[entry.itemId] : entry.combatId;
            }
        }

        /// <summary>Префаб точки добычи этого типа и тира; null — остаётся модель набора зон.</summary>
        public static GameObject TierNode(string resourceType, int tier) => TierNodeEntryFor(resourceType, tier)?.prefab;

        private static TierNodeEntry TierNodeEntryFor(string resourceType, int tier)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(resourceType) || tier < 1) return null;
            foreach (TierNodeEntry entry in palette.tierNodes)
                if (entry != null && entry.tier == tier && entry.resourceType == resourceType) return entry;
            return null;
        }

        /// <summary>Запись предмета: своя (материал тира), иначе облика-исходника.</summary>
        private static ItemEntry ItemEntryFor(string itemId)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return null;
            string own = RoaInventory.BaseId(itemId);
            string visual = RoaItemData.VisualId(own);
            ItemEntry fallback = null;
            foreach (ItemEntry entry in palette.items)
            {
                if (entry == null) continue;
                if (entry.itemId == own) return entry;
                if (entry.itemId == visual) fallback = entry;
            }
            return fallback;
        }

        private static WeaponEntry WeaponEntryFor(string itemId)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return null;
            string visual = RoaItemData.VisualId(itemId);
            foreach (WeaponEntry entry in palette.weapons)
                if (entry != null && entry.itemId == visual) return entry;
            return null;
        }

        /// <summary>
        /// Метка тира на модели предмета (в руках, у врага, на земле, на иконке):
        /// родная модель остаётся как есть, тир виден по цветной детали.
        /// </summary>
        public static void MarkItem(GameObject visual, string itemId)
        {
            if (visual == null || !RoaItemData.IsTiered(itemId)) return;
            RoaTierMarkPlacement placement = WeaponEntryFor(itemId)?.mark;
            if (placement == null || !placement.valid) placement = ItemEntryFor(itemId)?.mark;
            RoaTierMark.Attach(visual, placement, RoaItemData.Tier(itemId));
        }

        /// <summary>Кольцо краски цвета тира у основания точки добычи.</summary>
        public static void MarkTierNode(GameObject visual, string resourceType, int tier)
        {
            RoaTierMark.Attach(visual, TierNodeEntryFor(resourceType, tier)?.mark, tier);
        }

        public void ConfigureTierNodes(IEnumerable<TierNodeEntry> rows)
        {
            tierNodes = new List<TierNodeEntry>(rows);
        }

        public static GameObject Item(string itemId)
        {
            // Artifacts retain their individually authored Kromka GLB models.
            // Older palettes contain one shared chemical prop for every artifact.
            if (itemId != null && itemId.StartsWith("artifact", StringComparison.Ordinal)
                && itemId != "artifactContainer" && !itemId.StartsWith("artifactDetector", StringComparison.Ordinal)
                && !itemId.StartsWith("artifactBelt", StringComparison.Ordinal)) return null;
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return null;
            if (palette._items == null)
            {
                palette._items = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (ItemEntry entry in palette.items)
                    if (entry != null && !string.IsNullOrEmpty(entry.itemId) && entry.prefab != null)
                        palette._items[entry.itemId] = entry.prefab;
            }
            // Сначала свой префаб (у каждого тира материала он свой), потом облик-заместитель.
            if (palette._items.TryGetValue(RoaInventory.BaseId(itemId), out GameObject own)) return own;
            return palette._items.TryGetValue(RoaItemData.VisualId(itemId), out GameObject prefab) ? prefab : null;
        }

        public static GameObject Creature(string modelKey, out float pitch)
        {
            pitch = 0f;
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(modelKey)) return null;
            if (palette._creatures == null)
            {
                palette._creatures = new Dictionary<string, CreatureEntry>(StringComparer.Ordinal);
                foreach (CreatureEntry entry in palette.creatures)
                    if (entry != null && !string.IsNullOrEmpty(entry.modelKey) && entry.prefab != null)
                        palette._creatures[entry.modelKey] = entry;
            }
            if (!palette._creatures.TryGetValue(modelKey, out CreatureEntry chosen)) return null;
            pitch = chosen.pitch;
            return chosen.prefab;
        }

        public static GameObject Environment(string modelKey)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null) return null;
            if (palette._environment == null)
            {
                palette._environment = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (EnvironmentEntry entry in palette.environment)
                    if (entry != null && !string.IsNullOrEmpty(entry.modelKey) && entry.prefab != null)
                        palette._environment[NormalizeModelKey(entry.modelKey)] = entry.prefab;
            }
            string key = NormalizeModelKey(modelKey);
            if (palette._environment.TryGetValue(key, out GameObject chosen)) return chosen;
            if (key.Contains("road") || key.Contains("rail") || key.Contains("bridge") || key.Contains("route"))
                return palette.roadEnvironment;
            if (key.Contains("tree") || key.Contains("bush") || key.Contains("garden") || key.Contains("crop")
                || key.Contains("soil") || key.Contains("grass")) return palette.plantEnvironment;
            if (key.Contains("tower") || key.Contains("antenna") || key.Contains("spire") || key.Contains("pylon"))
                return palette.towerEnvironment;
            if (key.Contains("wall") || key.Contains("gate") || key.Contains("fence") || key.Contains("barrier"))
                return palette.barrierEnvironment;
            if (key.Contains("bunker") || key.Contains("shelter") || key.Contains("building")
                || key.Contains("module") || key.Contains("warehouse") || key.Contains("lab")
                || key.Contains("workshop") || key.Contains("market")) return palette.buildingEnvironment;
            if (key.Contains("rock") || key.Contains("ore") || key.Contains("quarry") || key.Contains("cliff")
                || key.Contains("terrain")) return palette.rockEnvironment;
            if (key.Contains("pipe") || key.Contains("tank") || key.Contains("filter") || key.Contains("furnace")
                || key.Contains("pump") || key.Contains("industrial")) return palette.industrialEnvironment;
            return palette.defaultEnvironment;
        }

        private static string NormalizeModelKey(string key)
        {
            if (string.IsNullOrEmpty(key)) return string.Empty;
            var normalized = new System.Text.StringBuilder(key.Length);
            foreach (char character in key)
                if (char.IsLetterOrDigit(character)) normalized.Append(char.ToLowerInvariant(character));
            return normalized.ToString();
        }

        public void Configure(GameObject maleModel, GameObject femaleModel, GameObject soldierMale,
            GameObject soldierFemale, GameObject hazmatMale, GameObject riotMale,
            GameObject backpackModel, GameObject helmetModel, GameObject motorcycleModel,
            IEnumerable<WeaponEntry> weaponModels, IEnumerable<ItemEntry> itemModels,
            IEnumerable<ArmorEntry> armorModels, IEnumerable<FootwearEntry> footwearModels,
            IEnumerable<CreatureEntry> creatureModels, IEnumerable<EnvironmentEntry> environmentModels,
            GameObject defaultEnvironmentModel, GameObject roadModel, GameObject plantModel,
            GameObject buildingModel, GameObject barrierModel, GameObject towerModel,
            GameObject industrialModel, GameObject rockModel)
        {
            male = maleModel;
            female = femaleModel;
            maleSoldier = soldierMale;
            femaleSoldier = soldierFemale;
            maleHazmat = hazmatMale;
            maleRiot = riotMale;
            backpackAttachment = backpackModel;
            helmetAttachment = helmetModel;
            motorbike = motorcycleModel;
            weapons = new List<WeaponEntry>(weaponModels);
            items = new List<ItemEntry>(itemModels);
            armor = new List<ArmorEntry>(armorModels);
            footwear = new List<FootwearEntry>(footwearModels);
            creatures = new List<CreatureEntry>(creatureModels);
            environment = new List<EnvironmentEntry>(environmentModels);
            defaultEnvironment = defaultEnvironmentModel;
            roadEnvironment = roadModel;
            plantEnvironment = plantModel;
            buildingEnvironment = buildingModel;
            barrierEnvironment = barrierModel;
            towerEnvironment = towerModel;
            industrialEnvironment = industrialModel;
            rockEnvironment = rockModel;
            _weapons = null;
            _weaponRigs = null;
            _weaponCombats = null;
            _items = null;
            _armor = null;
            _footwear = null;
            _creatures = null;
            _environment = null;
            _instance = null;
        }
    }
}
