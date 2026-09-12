namespace RealmOfAshes.Game
{
    public static class RoaSuitModelCatalog
    {
        public const string CatalogVersion = "2-2392c3f1";
        public const string FootwearLayer = "builtin_footwear";

        public static bool TryModelPath(string itemId, string bodyKey, out string path)
        {
            path=string.Empty;
            if(itemId!="hazmatSuit" && itemId!="energySuit") return false;
            switch(bodyKey)
            {
                case "male_slim": case "male_medium": case "male_large":
                case "female_slim": case "female_medium": case "female_large": break;
                default: return false;
            }
            path="/assets/models/equipment/suits-v2/equipment_"+itemId+"_"+bodyKey
                +".glb?v=layered-suits-"+CatalogVersion;
            return true;
        }
    }
}
