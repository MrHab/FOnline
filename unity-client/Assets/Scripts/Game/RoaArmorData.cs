using System.Collections.Generic;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Баллистические пороги брони для бокса БРОНЯ в оружейной консоли.
    ///
    /// Клиентская копия SERVER_ARMOR_ITEMS (server.js:4671) — так же, как web
    /// держит свой каталог ITEMS. Порог суммируется по слотам брони и шлема
    /// (serverArmorProfile, server.js:4711); сам расчёт урона остаётся на сервере,
    /// это число только для показа.
    /// </summary>
    public static class RoaArmorData
    {
        private static readonly Dictionary<string, int> BallisticThreshold = new Dictionary<string, int>
        {
            { "leather", 1 },
            { "metalArmor", 2 },
            { "ballisticVest", 4 },
            { "combatArmor", 4 },
            { "hazmatSuit", 0 },
            { "heavyArmor", 6 },
            { "energySuit", 0 },
            { "weldedHelmet", 1 },
            { "helmet", 1 },
            { "tacticalHelmet", 1 },
            { "assaultHelmet", 2 },
            { "preWarHelmet", 2 }
        };

        /// <summary>Порог одного предмета. Неизвестный id даёт 0 — как отсутствие брони.</summary>
        public static int Threshold(string baseItemId)
        {
            int value;
            return BallisticThreshold.TryGetValue(baseItemId ?? string.Empty, out value) ? value : 0;
        }

        /// <summary>
        /// Базовый id из runtime-ключа экипировки. Портирует serverBaseItemId
        /// (server.js:4753): экземпляры именуются "ui_{base}_{a}_{b}".
        /// </summary>
        public static string BaseId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId)) return string.Empty;
            if (!runtimeId.StartsWith("ui_")) return runtimeId;

            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }
    }
}
