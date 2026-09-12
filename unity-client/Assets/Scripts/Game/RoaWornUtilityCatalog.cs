namespace RealmOfAshes.Game
{
    /// <summary>CC0 item models fitted to the player's body and current armor.</summary>
    public static class RoaWornUtilityCatalog
    {
        public const string CatalogVersion = "1-75bbf530";

        public static string ArmorFit(string armorId)
        {
            switch (armorId)
            {
                case "leather": case "metalArmor": case "ballisticVest": case "combatArmor":
                case "heavyArmor": case "hazmatSuit": case "energySuit": return armorId;
                default: return "none";
            }
        }

        public static bool TryModelPath(string itemId, string bodyKey, string armorFit, out string path)
        {
            path = string.Empty;
            switch (itemId)
            {
                case "artifactDetectorMk1": case "artifactDetectorMk2": case "artifactDetectorMk3":
                case "artifactBelt2": case "artifactBelt3": case "artifactBelt4": break;
                default: return false;
            }
            switch (bodyKey)
            {
                case "male_slim": case "male_medium": case "male_large":
                case "female_slim": case "female_medium": case "female_large": break;
                default: return false;
            }
            path = "/assets/models/equipment/utilities-v1/equipment_" + itemId + "_" + bodyKey
                + "_" + ArmorFit(armorFit) + ".glb?v=worn-utilities-" + CatalogVersion;
            return true;
        }
    }
}
