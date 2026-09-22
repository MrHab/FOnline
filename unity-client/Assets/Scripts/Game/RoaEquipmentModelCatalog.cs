namespace RealmOfAshes.Game
{
    /// <summary>Downloaded, body-fitted replacements. Unlisted gear keeps its existing model.</summary>
    public static class RoaEquipmentModelCatalog
    {
        public const string CatalogVersion = "2-e27a3f51";

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
            // Телосложения больше нет: у каждого пола одна базовая модель.
            if (bodyKey != "male_medium" && bodyKey != "female_medium") return false;
            path = "/assets/models/equipment/free-v2/equipment_" + itemId + "_" + bodyKey
                + ".glb?v=free-equipment-" + CatalogVersion;
            return true;
        }
    }
}
