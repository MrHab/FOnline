namespace RealmOfAshes.Game
{
    /// <summary>Downloaded, body-fitted replacements. Unlisted gear keeps its existing model.</summary>
    public static class RoaEquipmentModelCatalog
    {
        public const string CatalogVersion = "2-a89d04ce";

        public static bool TryModelPath(string itemId, string bodyKey, out string path)
        {
            if (RoaOutfitModelCatalog.TryModelPath(itemId, bodyKey, out path)) return true;
            if (RoaSuitModelCatalog.TryModelPath(itemId, bodyKey, out path)) return true;
            path = string.Empty;
            switch (itemId)
            {
                case "backpack":
                case "helmet": case "tacticalHelmet": case "assaultHelmet":
                case "preWarHelmet": case "weldedHelmet":
                case "boots": case "scoutBoots": case "reinforcedBoots": case "assaultBoots": break;
                default: return false;
            }
            switch (bodyKey)
            {
                case "male_slim": case "male_medium": case "male_large":
                case "female_slim": case "female_medium": case "female_large": break;
                default: return false;
            }
            path = "/assets/models/equipment/free-v2/equipment_" + itemId + "_" + bodyKey
                + ".glb?v=free-equipment-" + CatalogVersion;
            return true;
        }
    }
}
