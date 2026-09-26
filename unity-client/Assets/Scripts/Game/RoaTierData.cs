using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Тиры мира с сервера (data/kromka/tiers.json через /api/kromka/items):
    /// множители силы и прочности тиров и список профессий добычи, переработки
    /// и ремесла. Решает всё сервер; клиент только показывает цифры.
    /// </summary>
    public static class RoaTierData
    {
        public sealed class Tier
        {
            public int Number;
            public float Power = 1f;
            public float Durability = 1f;
            public int ModSlots;
            public int Level;
        }

        public sealed class Profession
        {
            public string Id;
            public string Kind;
            public string Name;
        }

        private static readonly List<Tier> Tiers = new List<Tier>();
        private static readonly List<Profession> Professions = new List<Profession>();

        public static bool Loaded => Tiers.Count > 0;
        public static IReadOnlyList<Profession> ProfessionList => Professions;

        public static void Apply(JObject config)
        {
            if (!(config?["tiers"] is JArray rows) || rows.Count == 0) return;
            var tiers = new List<Tier>();
            foreach (JToken token in rows)
            {
                if (!(token is JObject row)) continue;
                tiers.Add(new Tier
                {
                    Number = row["tier"]?.ToObject<int?>() ?? tiers.Count + 1,
                    Power = row["power"]?.ToObject<float?>() ?? 1f,
                    Durability = row["durability"]?.ToObject<float?>() ?? 1f,
                    ModSlots = row["modSlots"]?.ToObject<int?>() ?? 0,
                    Level = row["level"]?.ToObject<int?>() ?? 0
                });
            }
            var professions = new List<Profession>();
            if (config["professions"]?["skills"] is JArray skills)
            {
                foreach (JToken token in skills)
                {
                    if (!(token is JObject row)) continue;
                    professions.Add(new Profession
                    {
                        Id = row["id"]?.ToString() ?? string.Empty,
                        Kind = row["kind"]?.ToString() ?? string.Empty,
                        Name = row["name"]?.ToString() ?? string.Empty
                    });
                }
            }
            Tiers.Clear();
            Tiers.AddRange(tiers);
            Professions.Clear();
            Professions.AddRange(professions);
        }

        public static Tier Get(int tier)
        {
            foreach (Tier row in Tiers) if (row.Number == tier) return row;
            return null;
        }

        /// <summary>Во сколько раз сила тира `to` больше силы тира `from` (1, пока конфиг не пришёл).</summary>
        public static float PowerRatio(int from, int to)
        {
            Tier a = Get(from), b = Get(to);
            return a != null && b != null && a.Power > 0f ? b.Power / a.Power : 1f;
        }

        /// <summary>Уровень профессии, с которого открыт тир.</summary>
        public static int LevelFor(int tier) => Get(tier)?.Level ?? 0;
    }
}
