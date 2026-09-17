using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Участки станков текущей локации (экономика v3, библия 14.5): каждый
    /// станок поселения сдаётся в аренду. Сервер присылает снимок участков
    /// (craftingPlotAction state), и комиссия заказа считается по нему так же,
    /// как на сервере (plotCraftFee): своему арендатору — даром, чужим — доля
    /// стоимости изделия по ставке арендатора, на свободном участке — ставка
    /// поселения; не меньше прежней комиссии рецепта.
    /// </summary>
    public static class RoaCraftingPlots
    {
        private static readonly Dictionary<string, JObject> ByStation = new Dictionary<string, JObject>(StringComparer.Ordinal);
        private static readonly List<JObject> All = new List<JObject>();

        /// <summary>Локация, к которой относится снимок.</summary>
        public static string LocationId { get; private set; } = string.Empty;

        /// <summary>Участки текущей локации в порядке сервера.</summary>
        public static IReadOnlyList<JObject> Plots { get { return All; } }

        /// <summary>Марки, которые сервер только что зачислил (возвраты ставок и плата за станок).</summary>
        public static int LastPayout { get; private set; }

        public static void Apply(JObject state)
        {
            Clear();
            if (state == null) return;
            LocationId = state["locationId"]?.ToString() ?? string.Empty;
            LastPayout = state["payout"]?.Type == JTokenType.Integer ? state["payout"].Value<int>() : 0;
            if (!(state["plots"] is JArray rows)) return;
            foreach (JToken token in rows)
            {
                if (!(token is JObject plot)) continue;
                All.Add(plot);
                string station = plot["station"]?.ToString();
                if (!string.IsNullOrEmpty(station) && !ByStation.ContainsKey(station)) ByStation[station] = plot;
            }
        }

        public static void Clear()
        {
            ByStation.Clear();
            All.Clear();
            LocationId = string.Empty;
            LastPayout = 0;
        }

        public static JObject ForStation(string station)
        {
            JObject plot;
            return !string.IsNullOrEmpty(station) && ByStation.TryGetValue(station, out plot) ? plot : null;
        }

        public static JObject ForObject(string objectId)
        {
            if (string.IsNullOrEmpty(objectId)) return null;
            foreach (JObject plot in All)
                if (plot["objectId"]?.ToString() == objectId) return plot;
            return null;
        }

        /// <summary>Комиссия заказа с учётом участка станка этого рецепта.</summary>
        public static int FeeFor(RoaCraftRecipe recipe)
        {
            if (recipe == null) return 0;
            int baseFee = recipe.BaseFee;
            JObject plot = ForStation(recipe.Station);
            if (plot == null) return baseFee;
            if (plot["mine"]?.Type == JTokenType.Boolean && plot["mine"].Value<bool>()) return 0;
            double pct = plot["feePct"]?.Type == JTokenType.Float || plot["feePct"]?.Type == JTokenType.Integer
                ? plot["feePct"].Value<double>()
                : 0d;
            double value = (double)RoaItemData.BasePrice(recipe.OutputId) * Math.Max(1, recipe.OutputQty);
            // Как на сервере: произведение округляется до миллионных перед округлением вверх.
            return Math.Max(baseFee, (int)Math.Ceiling(Math.Round(value * pct, 6, MidpointRounding.AwayFromZero)));
        }
    }
}
