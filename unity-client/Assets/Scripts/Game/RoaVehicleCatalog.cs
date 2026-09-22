using System.Collections.Generic;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Транспорт на клиенте: какая модель у предмета слота «Транспорт». Можно ли
    /// сесть и с какой скоростью ехать, решает сервер (data/kromka/vehicles.json,
    /// приходит полем vehicle в состоянии игрока) — здесь только внешний вид.
    /// </summary>
    public static class RoaVehicleCatalog
    {
        public const string Slot = "vehicle";

        private static readonly Dictionary<string, string> Models = new Dictionary<string, string>
        {
            { "motorcycle", "/assets/models/vehicles/vehicle_motorcycle.glb" }
        };

        public static bool Contains(string itemId)
        {
            return !string.IsNullOrEmpty(itemId) && Models.ContainsKey(itemId);
        }

        public static string ModelPath(string itemId)
        {
            return itemId != null && Models.TryGetValue(itemId, out string path) ? path : string.Empty;
        }
    }
}
