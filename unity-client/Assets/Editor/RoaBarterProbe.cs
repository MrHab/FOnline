#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Окно бартера в edit-режиме на подставных данных: крестик закрытия
    /// действительно рисует глиф, колесо и перетаскивание над строкой доходят
    /// до ScrollRect (подсказки предметов их не глотают), вкладка «Оружие»
    /// активна и после клика оставляет только оружие.
    /// </summary>
    public static class RoaBarterProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;

        [MenuItem("Realm of Ashes/Проверить окно бартера")]
        public static void Run()
        {
            string report = RunReport();
            Debug.Log(report);
            // Клиентский аудит и пакетный запуск видят провал только как исключение:
            // строка «FAIL» в логе проходила незамеченной.
            if (!report.EndsWith("OK", StringComparison.Ordinal)) throw new InvalidOperationException(report);
        }

        public static string RunReport()
        {
            var report = new StringBuilder("RoaBarterProbe:\n");
            GameObject host = null;
            try
            {
                // Цены берутся из серверного каталога, как в игре после входа.
                JObject items = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/kromka/items.json"))));
                Require(RoaItemData.ApplyCatalog(items, out string catalogError), "каталог предметов отклонён: " + catalogError);
                host = new GameObject("RoaBarterProbe");
                var interaction = host.AddComponent<RoaInteraction>();
                Type panelKind = typeof(RoaInteraction).GetNestedType("PanelKind", BindingFlags.NonPublic);
                Set(interaction, "_panel", Enum.Parse(panelKind, "Trade"));
                Set(interaction, "_self", JObject.Parse(
                    "{\"inventory\":[{\"id\":\"ui_pistol_a1_b2\",\"qty\":1},{\"id\":\"medkit\",\"qty\":3},{\"id\":\"ammo9\",\"qty\":40}," +
                    "{\"id\":\"silver\",\"qty\":120},{\"id\":\"scrap\",\"qty\":5},{\"id\":\"water\",\"qty\":2},{\"id\":\"knife\",\"qty\":1}," +
                    "{\"id\":\"leather\",\"qty\":1},{\"id\":\"stim\",\"qty\":4},{\"id\":\"oil\",\"qty\":2},{\"id\":\"wood\",\"qty\":9}," +
                    "{\"id\":\"ore\",\"qty\":3},{\"id\":\"axe\",\"qty\":1}],\"special\":{\"cha\":5},\"skills\":{\"barter\":20}}"));
                var stock = new JArray();
                foreach (string id in new[] { "rifle", "shotgun", "pistol", "ammo9", "ammo556", "medkit", "stim", "water", "oil",
                                              "repairKit", "leather", "helmet", "scrap", "axe", "pickaxe" })
                    stock.Add(new JObject { ["id"] = id, ["qty"] = 3, ["price"] = 25 });
                Set(interaction, "_market", new JObject { ["caps"] = 500, ["stock"] = stock, ["buyInterests"] = new JArray("weapons") });

                // Надетая винтовка: в рюкзаке self.inventory её нет, но в колонке
                // «Ваши вещи» она должна появиться (заблокированной), а вкладка «Оружие» — включиться.
                var inventoryComponent = host.AddComponent<RoaInventory>();
                var equipment = (Dictionary<string, string>)Get(inventoryComponent, "_equipment");
                equipment["weapon"] = "ui_rifle_r1_x";
                equipment["armor"] = "ui_leather_a1_x";
                var canvas = host.AddComponent<RoaBarterCanvas>();
                canvas.Interaction = interaction;
                canvas.Inventory = inventoryComponent;

                // Регрессия со сделки фельдшера Старого Клима: экран должен считать эти
                // продажи так же, как serverTradeMachineSellPrice с каталогом «Кромки»
                // (47 и 32; до каталога цены были 56 и 32).
                JObject quoteSelf = JObject.Parse(
                    "{\"special\":{\"cha\":5,\"int\":5},\"skillRanks\":{\"barter\":25},\"talentRanks\":{},\"traits\":[]}");
                JObject quoteMarket = new JObject
                {
                    ["caps"] = 15,
                    ["buyInterests"] = new JArray("aid", "all"),
                    ["stock"] = new JArray(
                        new JObject { ["id"] = "medkit", ["qty"] = 1, ["price"] = 21 },
                        new JObject { ["id"] = "stim", ["qty"] = 1, ["price"] = 11 })
                };
                int sellTotal = 2 * CallPrice("TradeSellPrice", "reinforcedBoots", quoteMarket, quoteSelf)
                    + 2 * CallPrice("TradeSellPrice", "leather", quoteMarket, quoteSelf)
                    + CallPrice("TradeSellPrice", "trophy", quoteMarket, quoteSelf)
                    + CallPrice("TradeSellPrice", "water", quoteMarket, quoteSelf);
                int buyTotal = CallPrice("TradeBuyPrice", 21, quoteSelf) + CallPrice("TradeBuyPrice", 11, quoteSelf);
                report.Append("Old Klim quote: sells=").Append(sellTotal).Append(" buys=").Append(buyTotal)
                      .Append(" payout=").Append(sellTotal - buyTotal).Append('\n');
                Require(sellTotal == 47 && buyTotal == 32 && sellTotal - buyTotal == 15,
                    "цены Unity снова расходятся с серверной сделкой фельдшера Старого Клима");

                // Торговец личной базы: доля входит в обе цены, как на сервере,
                // и перепродажа по-прежнему не выгоднее покупки.
                JObject residentSelf = (JObject)quoteSelf.DeepClone();
                residentSelf["residentTradePricePct"] = 0.08;
                int residentBuy = CallPrice("TradeBuyPrice", 21, residentSelf) + CallPrice("TradeBuyPrice", 11, residentSelf);
                report.Append("resident quote: buys=").Append(residentBuy).Append('\n');
                Require(residentBuy == 30, "скидка Торговца базы не вошла в цену покупки: " + residentBuy);
                int leather = CallPrice("TradeSellPrice", "leather", quoteMarket, quoteSelf);
                int residentLeather = CallPrice("TradeSellPrice", "leather", quoteMarket, residentSelf);
                Require(leather == 11 && residentLeather == 12, "надбавка Торговца базы не вошла в цену продажи: " + leather + " → " + residentLeather);
                Require(CallPrice("TradeSellPrice", "medkit", quoteMarket, residentSelf) < CallPrice("TradeBuyPrice", 21, residentSelf),
                    "со скидкой Торговца перепродажа стала выгоднее покупки");
                // Опытный торговец упирается в потолок продажи: житель не должен его опускать.
                JObject traderSelf = JObject.Parse(
                    "{\"special\":{\"cha\":10,\"int\":5},\"skillRanks\":{\"barter\":100},\"talentRanks\":{\"merchant\":3},\"traits\":[]}");
                JObject traderResident = (JObject)traderSelf.DeepClone();
                traderResident["residentTradePricePct"] = 0.08;
                int capped = CallPrice("TradeSellPrice", "medkit", quoteMarket, traderSelf);
                int cappedResident = CallPrice("TradeSellPrice", "medkit", quoteMarket, traderResident);
                report.Append("capped medkit: ").Append(capped).Append(" → ").Append(cappedResident).Append('\n');
                Require(capped == 14 && cappedResident == 14, "Торговец базы удешевил продажу у опытного торговца: " + capped + " → " + cappedResident);
                Require(CallPrice("TradeBuyPrice", 21, traderResident) == 12 && CallPrice("TradeBuyPriceCore", 21, traderResident, false) == 13,
                    "потолок продажи считается не от цены покупки без доли жителя");

                Call(canvas, "EnsureBuilt");
                var root = (GameObject)Get(canvas, "_root");
                root.SetActive(true);
                Call(canvas, "Refresh");
                Canvas.ForceUpdateCanvases();

                // Крестик: подпись должна породить вершины, а не быть обрезанной Truncate.
                var closeLabel = root.transform.Find("Btn:×/Label").GetComponent<Text>();
                closeLabel.cachedTextGenerator.Populate(closeLabel.text, closeLabel.GetGenerationSettings(closeLabel.rectTransform.rect.size));
                report.Append("close: rect=").Append(closeLabel.rectTransform.rect.size).Append(" pref=").Append(closeLabel.preferredHeight)
                      .Append(" verts=").Append(closeLabel.cachedTextGenerator.vertexCount).Append('\n');
                Require(closeLabel.cachedTextGenerator.vertexCount > 0, "крестик закрытия не рисуется (подпись обрезана)");

                object vendor = Get(canvas, "_vendor");
                var tabs = (Dictionary<string, Button>)vendor.GetType().GetField("TabButtons").GetValue(vendor);
                var rows = (List<GameObject>)vendor.GetType().GetField("Rows").GetValue(vendor);
                var list = (RectTransform)vendor.GetType().GetField("List").GetValue(vendor);
                foreach (KeyValuePair<string, Button> tab in tabs)
                    report.Append("tab ").Append(tab.Key).Append(": interactable=").Append(tab.Value.interactable)
                          .Append(" w=").Append(((RectTransform)tab.Value.transform).rect.width).Append('\n');
                report.Append("vendor rows=").Append(rows.Count).Append(" list=").Append(list.rect.size)
                      .Append(" viewport=").Append(((RectTransform)list.parent).rect.size).Append('\n');
                Require(rows.Count == 15, "торговец показал " + rows.Count + " строк вместо 15");
                Require(tabs["weapons"].interactable, "вкладка «Оружие» неактивна при оружии в стоке");

                // Колесо/перетаскивание над строкой должны доходить до ScrollRect.
                GameObject scrollHandler = ExecuteEvents.GetEventHandler<IScrollHandler>(rows[0]);
                GameObject dragHandler = ExecuteEvents.GetEventHandler<IBeginDragHandler>(rows[0]);
                report.Append("scroll handler=").Append(scrollHandler != null ? scrollHandler.name : "null")
                      .Append(" drag handler=").Append(dragHandler != null ? dragHandler.name : "null").Append('\n');
                Require(scrollHandler != null && scrollHandler.GetComponent<ScrollRect>() != null, "колесо над строкой не доходит до ScrollRect");
                Require(dragHandler != null && dragHandler.GetComponent<ScrollRect>() != null, "перетаскивание над строкой не доходит до ScrollRect");

                // Клик по «Оружие» в обеих колонках оставляет только оружие
                // (у игрока — по runtime-id вида ui_pistol_a1_b2).
                object player = Get(canvas, "_player");
                var playerTabs = (Dictionary<string, Button>)player.GetType().GetField("TabButtons").GetValue(player);
                Require(playerTabs["weapons"].interactable, "вкладка «Оружие» игрока неактивна при оружии в инвентаре");
                tabs["weapons"].onClick.Invoke();
                playerTabs["weapons"].onClick.Invoke();
                ClearRowsImmediate(canvas, player, vendor);
                Call(canvas, "Refresh");
                rows = (List<GameObject>)vendor.GetType().GetField("Rows").GetValue(vendor);
                var playerRows = (List<GameObject>)player.GetType().GetField("Rows").GetValue(player);
                report.Append("after weapons: vendor rows=").Append(rows.Count).Append(" player rows=").Append(playerRows.Count).Append('\n');
                Require(rows.Count == 3, "фильтр «Оружие» торговца показал " + rows.Count + " строк вместо 3");
                Require(playerRows.Count == 3, "фильтр «Оружие» игрока показал " + playerRows.Count + " строк вместо 3 (пистолет, нож, надетая винтовка)");
                foreach (GameObject row in rows)
                    Require(RoaItemCategories.Category(row.name.Substring("Row:".Length)) == "weapons", "в «Оружии» чужая строка " + row.name);
                bool rifleShown = false;
                foreach (GameObject row in playerRows)
                {
                    Require(RoaItemCategories.Category(row.name.Substring("Row:".Length)) == "weapons", "в «Оружии» игрока чужая строка " + row.name);
                    if (row.name != "Row:rifle") continue;
                    rifleShown = true;
                    Require(row.GetComponent<Button>() == null, "надетую винтовку можно кликнуть в продажу, хотя сервер её отклонит");
                    Require(row.transform.Find("Side").GetComponent<Text>().text == "на теле", "у надетой винтовки нет пометки «на теле»");
                }
                Require(rifleShown, "надетая винтовка не попала в колонку «Ваши вещи»");
                ClearRowsImmediate(canvas, player, vendor);

                report.Append("OK");
            }
            catch (Exception e)
            {
                report.Append("FAIL: ").Append(e.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
            return report.ToString();
        }

        /// <summary>Refresh зовёт Destroy, который в edit-режиме ругается — чистим строки сами.</summary>
        private static void ClearRowsImmediate(RoaBarterCanvas canvas, params object[] columns)
        {
            foreach (object column in columns)
            {
                var rows = (List<GameObject>)column.GetType().GetField("Rows").GetValue(column);
                foreach (GameObject row in rows) UnityEngine.Object.DestroyImmediate(row);
                rows.Clear();
            }
            var offers = (List<GameObject>)Get(canvas, "_offerRows");
            foreach (GameObject row in offers) UnityEngine.Object.DestroyImmediate(row);
            offers.Clear();
        }

        private static object Get(object target, string field)
        {
            return target.GetType().GetField(field, Private).GetValue(target);
        }

        private static void Set(object target, string field, object value)
        {
            target.GetType().GetField(field, Private).SetValue(target, value);
        }

        private static void Call(object target, string method)
        {
            target.GetType().GetMethod(method, Private).Invoke(target, null);
        }

        private static int CallPrice(string method, params object[] args)
        {
            MethodInfo info = typeof(RoaBarterCanvas).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static);
            if (info == null) throw new MissingMethodException(typeof(RoaBarterCanvas).FullName, method);
            return (int)info.Invoke(null, args);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
