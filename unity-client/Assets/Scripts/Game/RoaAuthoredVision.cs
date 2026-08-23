using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Решает, перекрывает ли авторский объект обзор.
    ///
    /// Портирует authoredObjectVisionKind(), visionKindFromConfig()
    /// и STATIC_MODEL_VISION_RULES из 02a_materials_static_models.js:932, 1889, 1910.
    ///
    /// Порядок важен и неочевиден: реестр моделей проверяется ПЕРВЫМ, но только
    /// на «сквозной» вердикт — модель, объявленная прозрачной (крыша, окно, пол),
    /// не станет стеной, даже если объект помечен тегом wall. Уже потом идёт явное
    /// поле vision у объекта, затем режим модели, роль окклюзии и теги.
    ///
    /// Исходов четыре, и сводить их к двум нельзя: Block, Cover и Clear — это
    /// принятые решения, а Unknown значит «правило промолчало, спрашиваем дальше».
    /// </summary>
    public static class RoaAuthoredVision
    {
        public enum Kind { Unknown, Clear, Cover, Block }

        /// <summary>STATIC_MODEL_VISION_RULES, 02a:932.</summary>
        private static readonly Dictionary<string, Kind> ModelRules = new Dictionary<string, Kind>(StringComparer.Ordinal)
        {
            { "traderWallBlock", Kind.Block },
            { "wallWoodBlock", Kind.Block },
            { "wallBrickBlock", Kind.Block },
            { "wallMetalBlock", Kind.Block },
            { "wastelandShack", Kind.Block },
            { "storageLeanTo", Kind.Block },
            { "scrapWatchTower", Kind.Block },
            { "latrineOuthouse", Kind.Block },
            { "waterTank", Kind.Block },

            { "traderWindowBlock", Kind.Clear },
            { "traderFloorSlab", Kind.Clear },
            { "traderRoofBlock", Kind.Clear },
            { "roofWoodBlock", Kind.Clear },
            { "roofMetalBlock", Kind.Clear },
            { "floorWoodBlock", Kind.Clear },
            { "floorTileBlock", Kind.Clear },
            { "asphaltSlab", Kind.Clear },
            { "traderAwning", Kind.Clear },
            { "cotBed", Kind.Clear },

            { "openScrapGate", Kind.Cover },
            { "watchPost", Kind.Cover },
            { "scrapWallSegment", Kind.Cover },
            { "fenceSegment", Kind.Cover },
            { "concreteWall", Kind.Cover },
            { "lowRuinedWall", Kind.Cover },
            { "roadblockBarricade", Kind.Cover },
            { "crate", Kind.Cover },
            { "tradeMachine", Kind.Cover },
            { "storageChest", Kind.Cover },
            { "jobBoard", Kind.Cover },
            { "barrel", Kind.Cover },
            { "rustBarrel", Kind.Cover },
            { "barrelCluster", Kind.Cover },
            { "cargoStack", Kind.Cover },
            { "armoryRack", Kind.Cover },
            { "workshopBench", Kind.Cover },
            { "craftStationAmmo", Kind.Cover },
            { "craftStationWeapon", Kind.Cover },
            { "craftStationTools", Kind.Cover },
            { "craftStationRepair", Kind.Cover },
            { "craftStationEnergy", Kind.Cover },
            { "craftStationChem", Kind.Cover },
            { "carWreck", Kind.Cover },
            { "oreOutcrop", Kind.Cover },
            { "oilPumpJack", Kind.Cover },
            { "deadwood", Kind.Cover },
            { "relayAntenna", Kind.Cover },
            { "brahminPen", Kind.Cover }
        };

        public static Kind Resolve(LocationObject entry)
        {
            if (entry == null) return Kind.Clear;

            // 1. Реестр моделей. Прозрачная модель обрывает цепочку сразу:
            //    крыша не должна становиться стеной из-за тега или коллизии.
            Kind modelKind = FromModel(entry);
            if (modelKind == Kind.Clear) return Kind.Clear;

            // 2. Явное поле vision у объекта — авторская правка поверх модели.
            Kind explicitKind = FromConfig(entry.Vision);
            if (explicitKind != Kind.Unknown) return explicitKind;

            // 3. Режим модели, если он был.
            if (modelKind != Kind.Unknown) return modelKind;

            // 4. Роль окклюзии. Здание, разобранное на стены, окна, пол и крышу,
            //    перекрывает обзор только стенами — иначе игрок внутри дома
            //    оказался бы под глухим колпаком из собственной крыши.
            string role = OcclusionRole(entry);
            bool losBlockingFalse = IsFalse(entry.Occlusion?["losBlocking"]);

            if (losBlockingFalse || role == "window" || role == "roof" || role == "floor") return Kind.Clear;
            if (role == "wall") return Kind.Block;

            // 5. Теги и режим коллизии.
            string collision = (entry.Collision ?? string.Empty).ToLowerInvariant();
            string model = (entry.Model ?? entry.Url ?? string.Empty).ToLowerInvariant();

            if (HasTag(entry, "window") || HasTag(entry, "roof") || HasTag(entry, "floor")) return Kind.Clear;

            if (HasTag(entry, "wall") || collision == "wall" || collision == "block" || collision == "blocked")
                return Kind.Block;

            if (collision == "cover") return Kind.Cover;

            if (HasTag(entry, "ore") || HasTag(entry, "wood")
                || model.Contains("ore") || model.Contains("deadwood")) return Kind.Cover;

            return Kind.Clear;
        }

        /// <summary>visionKindFromConfig(), 02a:1889.</summary>
        private static Kind FromConfig(JObject vision)
        {
            if (vision == null) return Kind.Unknown;

            string mode = (vision["mode"]?.ToString() ?? vision["kind"]?.ToString() ?? string.Empty).ToLowerInvariant();

            if (IsTrue(vision["blocks"]) || mode == "block" || mode == "blocking") return Kind.Block;

            if (IsTrue(vision["cover"]) || IsTrue(vision["lowCover"])
                || mode == "cover" || mode == "low-cover") return Kind.Cover;

            if (IsFalse(vision["blocks"]) || mode == "none" || mode == "clear") return Kind.Clear;

            return Kind.Unknown;
        }

        /// <summary>
        /// Ключ модели: сначала само поле model, затем имя файла из url.
        /// staticModelKeyFromLocationObject(), 02a:1614.
        /// </summary>
        private static Kind FromModel(LocationObject entry)
        {
            Kind kind;

            string model = Sanitize(entry.Model);
            if (model.Length > 0 && ModelRules.TryGetValue(model, out kind)) return kind;

            string url = entry.Url ?? string.Empty;
            if (url.Length == 0) return Kind.Unknown;

            string file = url.Replace('\\', '/');

            int slash = file.LastIndexOf('/');
            if (slash >= 0) file = file.Substring(slash + 1);

            int dot = file.LastIndexOf('.');
            if (dot > 0) file = file.Substring(0, dot);

            string key = Sanitize(file);
            if (key.Length > 0 && ModelRules.TryGetValue(key, out kind)) return kind;

            return Kind.Unknown;
        }

        private static string OcclusionRole(LocationObject entry)
        {
            return (entry.Occlusion?["role"]?.ToString() ?? string.Empty).ToLowerInvariant();
        }

        private static bool HasTag(LocationObject entry, string tag)
        {
            if (entry.Tags == null) return false;

            foreach (string value in entry.Tags)
                if (value != null && value.ToLowerInvariant() == tag) return true;

            return false;
        }

        private static bool IsTrue(JToken token)
        {
            return token != null && token.Type == JTokenType.Boolean && token.ToObject<bool>();
        }

        private static bool IsFalse(JToken token)
        {
            return token != null && token.Type == JTokenType.Boolean && !token.ToObject<bool>();
        }

        private static string Sanitize(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;

            var builder = new StringBuilder(value.Length);

            foreach (char c in value)
                if ((c < 128 && char.IsLetterOrDigit(c)) || c == '_' || c == '-') builder.Append(c);

            return builder.ToString();
        }
    }
}
