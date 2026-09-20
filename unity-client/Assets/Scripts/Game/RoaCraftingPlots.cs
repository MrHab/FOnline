using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

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

        /// <summary>
        /// Во что обходится постройка станка в этом городе: материалы и их
        /// нынешняя цена по книге аукционера. Ключ — вид станка.
        /// </summary>
        public static JObject StationCosts { get; private set; }

        /// <summary>Доля цены материалов, которую город вернёт строителю при смене владельца.</summary>
        public static float StationRefundPct { get; private set; } = 0.5f;

        public static void Apply(JObject state)
        {
            Clear();
            if (state == null) return;
            LocationId = state["locationId"]?.ToString() ?? string.Empty;
            LastPayout = state["payout"]?.Type == JTokenType.Integer ? state["payout"].Value<int>() : 0;
            StationCosts = state["stationCosts"] as JObject;
            if (state["stationRefundPct"] != null) StationRefundPct = state["stationRefundPct"].Value<float>();
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
            StationCosts = null;
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

        private const string UseFocusPref = "roa.craft.useFocus";

        /// <summary>
        /// Переключатель «тратить фокус» у станка участка: общий для окна
        /// станка и страницы крафта, запоминается между сессиями. В запрос
        /// уходит, только если есть премиум и у станка есть участок.
        /// </summary>
        public static bool UseFocus
        {
            get { return PlayerPrefs.GetInt(UseFocusPref, 0) == 1; }
            set
            {
                PlayerPrefs.SetInt(UseFocusPref, value ? 1 : 0);
                PlayerPrefs.Save();
            }
        }

        /// <summary>Премиум по снимку счёта игрока (self.account).</summary>
        public static bool Premium(JObject account)
        {
            return account?["premium"]?.Type == JTokenType.Boolean && account["premium"].Value<bool>();
        }

        public static int Focus(JObject account) { return IntOf(account?["focus"], 0); }

        public static int FocusCap(JObject account) { return IntOf(account?["focusCap"], 0); }

        /// <summary>
        /// Цена фокуса заказа — как на сервере (focusCostFor): столько-то за
        /// марку стоимости изделия, не меньше минимума.
        /// </summary>
        public static int FocusCostFor(RoaCraftRecipe recipe, JObject account)
        {
            if (recipe == null) return 0;
            JToken perValueToken = account?["focusCostPerValue"];
            double perValue = perValueToken != null && (perValueToken.Type == JTokenType.Float || perValueToken.Type == JTokenType.Integer)
                ? perValueToken.Value<double>()
                : 10d;
            int minCost = IntOf(account?["focusMinCost"], 50);
            double worth = (double)RoaItemData.BasePrice(recipe.OutputId) * Math.Max(1, recipe.OutputQty);
            return Math.Max(minCost, (int)Math.Ceiling(worth * perValue));
        }

        /// <summary>Уйдёт ли заказ с фокусом: переключатель, премиум и участок у станка.</summary>
        public static bool WantsFocus(RoaCraftRecipe recipe, JObject account)
        {
            return recipe != null && UseFocus && Premium(account) && ForStation(recipe.Station) != null;
        }

        /// <summary>Строка запаса фокуса для окон крафта и экрана персонажа.</summary>
        public static string FocusText(JObject account)
        {
            if (!Premium(account)) return "нет (только с премиумом)";
            return Focus(account) + " / " + FocusCap(account);
        }

        private static int IntOf(JToken token, int fallback)
        {
            return token != null && (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
                ? (int)Math.Floor(token.Value<double>())
                : fallback;
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
