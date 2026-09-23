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
        }

        [Serializable]
        public sealed class ItemEntry
        {
            public string itemId;
            public GameObject prefab;
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
        [SerializeField] private List<CreatureEntry> creatures = new List<CreatureEntry>();
        [SerializeField] private List<EnvironmentEntry> environment = new List<EnvironmentEntry>();
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
        private Dictionary<string, GameObject> _items;
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
            if (palette._weapons == null)
            {
                palette._weapons = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (WeaponEntry entry in palette.weapons)
                    if (entry != null && !string.IsNullOrEmpty(entry.itemId) && entry.prefab != null)
                        palette._weapons[entry.itemId] = entry.prefab;
            }
            return palette._weapons.TryGetValue(itemId, out GameObject prefab) ? prefab : null;
        }

        public static GameObject Item(string itemId)
        {
            RoaApocalypseModels palette = Instance;
            if (palette == null || string.IsNullOrEmpty(itemId)) return null;
            if (palette._items == null)
            {
                palette._items = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (ItemEntry entry in palette.items)
                    if (entry != null && !string.IsNullOrEmpty(entry.itemId) && entry.prefab != null)
                        palette._items[entry.itemId] = entry.prefab;
            }
            return palette._items.TryGetValue(itemId, out GameObject prefab) ? prefab : null;
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
            _items = null;
            _creatures = null;
            _environment = null;
            _instance = null;
        }
    }
}
