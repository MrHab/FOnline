namespace RealmOfAshes.Game
{
    /// <summary>
    /// Одежда и броня, сшитые под наш 65-костный скелет полным костюмом — с
    /// рукавами, штанами и обувью, а не накладкой на торс.
    ///
    /// Кожаная броня — набор Quaternius «Modular Character Outfits – Fantasy»
    /// (CC0) под тем же скелетом (tools/build-outfit-models.js). Военная броня —
    /// форма Swat/Soldier с пластинами прежней утверждённой брони поверх
    /// (tools/build-plated-armor-models.js). ОЗК и энергозащита остаются в
    /// RoaSuitModelCatalog: у них своя утверждённая партия.
    /// </summary>
    public static class RoaOutfitModelCatalog
    {
        public const string OutfitVersion = "1-e832316f";
        public const string PlatedVersion = "1-a5a37b4f";

        public static bool TryModelPath(string itemId, string bodyKey, out string path)
        {
            path = string.Empty;
            // Телосложения больше нет: у каждого пола одна базовая модель.
            if (bodyKey != "male_medium" && bodyKey != "female_medium") return false;
            if (itemId == "leather")
            {
                path = "/assets/models/equipment/outfits-v1/equipment_" + itemId + "_" + bodyKey
                    + ".glb?v=outfits-" + OutfitVersion;
                return true;
            }
            switch (itemId)
            {
                case "ballisticVest": case "combatArmor": case "heavyArmor": case "metalArmor": break;
                default: return false;
            }
            path = "/assets/models/equipment/armor-v3/equipment_" + itemId + "_" + bodyKey
                + ".glb?v=plated-" + PlatedVersion;
            return true;
        }
    }
}
