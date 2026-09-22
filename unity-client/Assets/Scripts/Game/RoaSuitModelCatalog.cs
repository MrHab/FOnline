namespace RealmOfAshes.Game
{
    public static class RoaSuitModelCatalog
    {
        public const string CatalogVersion = "2-fcf74ef8";
        public const string FootwearLayer = "builtin_footwear";

        public static bool TryModelPath(string itemId, string bodyKey, out string path)
        {
            path=string.Empty;
            if(itemId!="hazmatSuit" && itemId!="energySuit") return false;
            // Телосложения больше нет: у каждого пола одна базовая модель.
            if(bodyKey!="male_medium" && bodyKey!="female_medium") return false;
            path="/assets/models/equipment/suits-v2/equipment_"+itemId+"_"+bodyKey
                +".glb?v=layered-suits-"+CatalogVersion;
            return true;
        }
    }
}
