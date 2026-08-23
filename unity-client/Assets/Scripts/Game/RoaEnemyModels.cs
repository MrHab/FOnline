using System.Collections.Generic;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Соответствие ключа модели существа и файла GLB, плюс поправка разворота.
    ///
    /// Карта путей — из MODEL_URLS в 02a_materials_static_models.js:740.
    /// Таблица «передних осей» — из MODEL_FORWARD_AXIS_BY_KEY,
    /// 00a_actor_facing.js:6.
    /// </summary>
    public static class RoaEnemyModels
    {
        private const string Wasteland = "/assets/models/wasteland/";

        private static readonly Dictionary<string, string> Urls = new Dictionary<string, string>
        {
            { "traderNpc", Wasteland + "trader_npc.glb" },
            { "caravanMerchant", Wasteland + "npc_caravan_trader.glb" },
            { "caravanGuard", Wasteland + "npc_caravan_guard.glb" },
            { "klimPatrolGuard", Wasteland + "npc_klim_guard.glb" },
            { "wastelandSettler", Wasteland + "npc_wasteland_settler.glb" },
            { "enemyRaider", Wasteland + "npc_raider.glb" },
            { "enemyGhoul", Wasteland + "npc_ghoul.glb" },
            { "enemySuperMutant", Wasteland + "npc_super_mutant.glb" },
            { "enemyAshWolf", Wasteland + "npc_ash_wolf.glb" },
            { "enemyRadscorpion", Wasteland + "npc_radscorpion.glb" },
            { "enemyMutantAnt", Wasteland + "npc_mutant_ant.glb" },
            { "enemyGecko", Wasteland + "npc_gecko.glb" },
            { "enemyFireGecko", Wasteland + "npc_fire_gecko.glb" },
            { "brahmin", Wasteland + "brahmin.glb" },
            { "friendlyBrahmin", Wasteland + "brahmin.glb" }
        };

        /// <summary>
        /// Модели, авторизованные «лицом в +Z» в glTF. glTFast инвертирует Z,
        /// поэтому в Unity они смотрят назад и требуют доворота на 180°.
        /// Остальные авторизованы в −Z и после инверсии смотрят вперёд.
        /// </summary>
        private static readonly HashSet<string> FacingPlusZ = new HashSet<string>
        {
            "enemyGhoul", "enemySuperMutant", "enemyAshWolf",
            "enemyGecko", "enemyFireGecko", "brahmin", "friendlyBrahmin"
        };

        /// <summary>
        /// Соответствие визуала ключу модели для строк, где сервер прислал
        /// species/visual без modelKey. MODEL_KEY_BY_VISUAL, 00a_actor_facing.js:23.
        /// </summary>
        private static readonly Dictionary<string, string> ByVisual = new Dictionary<string, string>
        {
            { "raider", "enemyRaider" },
            { "ghoul", "enemyGhoul" },
            { "mutant", "enemySuperMutant" },
            { "supermutant", "enemySuperMutant" },
            { "wolf", "enemyAshWolf" },
            { "ashwolf", "enemyAshWolf" },
            { "radscorpion", "enemyRadscorpion" },
            { "mutantant", "enemyMutantAnt" },
            { "gecko", "enemyGecko" },
            { "firegecko", "enemyFireGecko" },
            { "brahmin", "friendlyBrahmin" }
        };

        /// <summary>Путь к модели, либо пусто если ключ неизвестен.</summary>
        public static string Url(string modelKey)
        {
            string url;
            return Urls.TryGetValue(modelKey ?? string.Empty, out url) ? url : string.Empty;
        }

        /// <summary>Доворот модели в градусах.</summary>
        public static float YawOffset(string modelKey)
        {
            return FacingPlusZ.Contains(modelKey ?? string.Empty) ? 180f : 0f;
        }

        /// <summary>
        /// Люди используют те же шесть 65-костных баз, внешность и экипировку,
        /// что игроки. Старые wasteland GLB для них были статичными коробочными
        /// фигурами без skin; web-клиент также заменяет их unified humanoid.
        /// </summary>
        public static bool IsUnifiedHumanoid(string modelKey, string visual, string species)
        {
            string resolved = ResolveKey(modelKey, visual, species);
            return resolved == "traderNpc"
                || resolved == "caravanMerchant"
                || resolved == "caravanGuard"
                || resolved == "klimPatrolGuard"
                || resolved == "wastelandSettler"
                || resolved == "enemyRaider";
        }

        /// <summary>
        /// Подобрать ключ модели: сначала явный modelKey, затем визуал или вид.
        /// </summary>
        public static string ResolveKey(string modelKey, string visual, string species)
        {
            if (!string.IsNullOrEmpty(modelKey) && Urls.ContainsKey(modelKey)) return modelKey;

            string key = Normalize(visual);
            string resolved;
            if (ByVisual.TryGetValue(key, out resolved)) return resolved;

            key = Normalize(species);
            if (ByVisual.TryGetValue(key, out resolved)) return resolved;

            return modelKey ?? string.Empty;
        }

        private static string Normalize(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;

            var chars = new List<char>(value.Length);
            foreach (char c in value)
                if (char.IsLetterOrDigit(c)) chars.Add(char.ToLowerInvariant(c));

            return new string(chars.ToArray());
        }
    }
}
