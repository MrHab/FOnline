using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Окно бартера в web-виде — #trader-window.barter-window
    /// (01_base_layout_hud.css:1288, renderTraderWindow в 07d_trader_barter_ui.js).
    /// Шапка «Имя · БАРТЕР», строка «Бартер N% · крышки торговца · интерес» и
    /// «Вес X/Y», три колонки: «Ваши вещи» (крышки, вкладки категорий, строки
    /// .barter-row с артом/весом/ценой продажи), центр «ИТОГ ОБМЕНА» (леджер,
    /// «Вы отдаёте / Вы берёте», предупреждение, «Принять обмен / Сбросить»),
    /// «Товар торговца» (имя · крышки, вкладки, строки с ценой покупки).
    /// Логика очередей и сделки — RoaInteraction (tradeQueue/submit на сервере).
    /// </summary>
    public sealed class RoaBarterCanvas : MonoBehaviour
    {
        public RoaInteraction Interaction;
        public RoaHud Hud;
        public RoaInventory Inventory;

        // Палитра #trader-window.barter-window.
        private static readonly Color PanelBg = new Color(0.06f, 0.062f, 0.05f, 0.98f);
        private static readonly Color PanelBorder = new Color(0.839f, 0.659f, 0.322f, 0.74f);
        private static readonly Color TitleInk = new Color(0.949f, 0.784f, 0.435f, 1f);        // #f2c86f
        private static readonly Color TitleLine = new Color(0.706f, 0.545f, 0.263f, 0.48f);
        private static readonly Color StatusInk = new Color(0.592f, 0.71f, 0.557f, 1f);        // #97b58e
        private static readonly Color WarnInk = new Color(0.886f, 0.545f, 0.388f, 1f);         // #e28b63
        private static readonly Color ColumnBg = new Color(0.02f, 0.035f, 0.03f, 1f);
        private static readonly Color ColumnBorder = new Color(0.482f, 0.412f, 0.263f, 0.72f);
        private static readonly Color ColumnTitle = new Color(0.906f, 0.757f, 0.443f, 1f);     // #e7c171
        private static readonly Color ColumnMeta = new Color(0.616f, 0.8f, 0.529f, 1f);        // #9dcc87
        private static readonly Color RowBg = new Color(0.094f, 0.106f, 0.094f, 1f);
        private static readonly Color RowBorder = new Color(0.341f, 0.322f, 0.235f, 0.55f);
        private static readonly Color RowQueued = new Color(0.553f, 0.804f, 0.455f, 0.72f);    // rgba(141,205,116)
        private static readonly Color RowBlocked = new Color(0.847f, 0.494f, 0.357f, 0.62f);   // rgba(216,126,91)
        private static readonly Color RowEquipped = new Color(0.957f, 0.78f, 0.361f, 0.92f);   // rgba(244,199,92)
        private static readonly Color RowName = new Color(0.918f, 0.839f, 0.612f, 1f);         // #ead69c
        private static readonly Color RowNote = new Color(0.62f, 0.66f, 0.53f, 1f);
        private static readonly Color IconBg = new Color(0f, 0f, 0f, 0.35f);
        private static readonly Color IconBorder = new Color(0.651f, 0.494f, 0.227f, 0.38f);
        private static readonly Color LedgerInk = new Color(0.608f, 0.675f, 0.533f, 1f);       // #9bac88
        private static readonly Color LedgerCost = new Color(0.894f, 0.643f, 0.365f, 1f);      // #e4a45d
        private static readonly Color LedgerGain = new Color(0.537f, 0.835f, 0.478f, 1f);      // #89d57a
        private static readonly Color NetBg = new Color(0.169f, 0.141f, 0.078f, 1f);
        private static readonly Color NetInk = new Color(0.902f, 0.831f, 0.608f, 1f);          // #e6d49b
        private static readonly Color NetPay = new Color(0.914f, 0.741f, 0.396f, 1f);          // #e9bd65
        private static readonly Color NetGain = new Color(0.608f, 0.875f, 0.525f, 1f);         // #9bdf86
        private static readonly Color OfferTitle = new Color(0.851f, 0.741f, 0.478f, 1f);      // #d9bd7a
        private static readonly Color BtnBg = new Color(0.165f, 0.141f, 0.098f, 1f);
        private static readonly Color BtnInk = new Color(0.898f, 0.78f, 0.486f, 1f);
        private static readonly Color BtnBorder = new Color(0.682f, 0.545f, 0.282f, 0.65f);
        private static readonly Color TabBg = new Color(0.031f, 0.071f, 0.047f, 1f);
        private static readonly Color TabBorder = new Color(0.459f, 0.58f, 0.341f, 0.46f);
        private static readonly Color TabInk = new Color(0.663f, 0.788f, 0.561f, 1f);
        private static readonly Color TabActiveBg = new Color(0.188f, 0.149f, 0.078f, 1f);
        private static readonly Color TabActiveBorder = new Color(0.816f, 0.631f, 0.306f, 1f);
        private static readonly Color TabActiveInk = new Color(0.941f, 0.824f, 0.541f, 1f);

        private const float RowHeight = 52f;
        private const float RowGap = 6f;
        private const float MiniRowHeight = 30f;

        private sealed class Column
        {
            public RectTransform Root, Tabs, List;
            public Text Title, Meta, Empty;
            public readonly Dictionary<string, Button> TabButtons = new Dictionary<string, Button>();
            public readonly Dictionary<string, Text> TabLabels = new Dictionary<string, Text>();
            public readonly List<GameObject> Rows = new List<GameObject>();
            public string Category = "all";
        }

        private Canvas _canvas;
        private GameObject _root;
        private Text _title, _skillLine, _carryLine;
        private Column _player, _vendor;
        private Text _sellTotal, _buyTotal, _net, _warning, _statusLine;
        private Image _netBg;
        private RectTransform _sellList, _buyList;
        private Text _sellEmpty, _buyEmpty;
        private readonly List<GameObject> _offerRows = new List<GameObject>();
        private Button _confirm, _clear;
        private Text _confirmLabel, _clearLabel;
        private float _refreshAt;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        private void Update()
        {
            bool open = Interaction != null && Interaction.TradeOpen;
            if (!open)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) { _root.SetActive(true); _refreshAt = 0f; }
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.3f;
            Refresh();
        }

        // ------------------------------------------------------------------ данные

        private struct Entry { public string RuntimeId; public string BaseId; public int Qty; public int Price; }

        private static string ItemName(string baseId)
        {
            string name = RoaItemData.Name(baseId);
            if (!string.IsNullOrEmpty(name)) return name;
            RoaWeaponData.Weapon weapon = RoaWeaponData.Get(baseId);
            return weapon != null ? weapon.Name : baseId;
        }

        private static int CategoryOrder(string id)
        {
            switch (RoaItemCategories.Category(id))
            {
                case "weapons": return 1;
                case "armor": return 2;
                case "ammo": return 3;
                case "aid": return 4;
                case "tools": return 5;
                case "materials": return 6;
                default: return 7;
            }
        }

        private static int StockPrice(JObject market, string itemId)
        {
            JArray stock = market?["stock"] as JArray;
            if (stock == null) return 0;
            foreach (JToken row in stock)
                if (row["id"]?.ToString() == itemId) return row["price"]?.ToObject<int>() ?? 0;
            return 0;
        }

        private static int CountInventory(JObject self, string baseId)
        {
            JArray inventory = self?["inventory"] as JArray;
            if (inventory == null) return 0;
            foreach (JToken row in inventory)
                if (RoaInteraction.TradeBaseId(row["id"]?.ToString()) == baseId)
                    return row["qty"]?.ToObject<int>() ?? 0;
            return 0;
        }

        /// <summary>SELL_PRICE_OVERRIDES из web (07c:96) — базы для оружия.</summary>
        private static readonly Dictionary<string, int> SellOverrides = new Dictionary<string, int>
        {
            { "pistol", 28 }, { "rifle", 38 }, { "shotgun", 48 }, { "rocketLauncher", 118 },
            { "machineGun", 72 }, { "laserPistol", 60 }, { "flamethrower", 78 }, { "plasmaRifle", 92 }
        };

        /// <summary>
        /// Ориентир цены продажи — getSellPrice() web (07c:131) без караванных
        /// интересов: override → 45% цены в стоке → база по типу, затем бонус
        /// харизмы и бартера. Настоящую цену считает сервер при обмене.
        /// </summary>
        private int EstimateSellPrice(string baseId, JObject market)
        {
            int basePrice;
            if (!SellOverrides.TryGetValue(baseId, out basePrice))
            {
                int stockPrice = StockPrice(market, baseId);
                if (stockPrice > 0) basePrice = Mathf.Max(1, Mathf.FloorToInt(stockPrice * 0.45f));
                else
                {
                    RoaWeaponData.Weapon weapon = RoaWeaponData.Get(baseId);
                    basePrice = weapon != null && weapon.Id == baseId ? 12 : 2;
                }
            }
            JObject self = Interaction.TradeSelf;
            int cha = self?["special"]?["cha"]?.ToObject<int>() ?? 5;
            int barter = RoaPipboy.SkillPercent(self, "barter");
            float bonus = 1f + (cha - 5) * 0.04f + barter / 100f * 0.30f;
            return Mathf.Max(1, Mathf.FloorToInt(basePrice * bonus));
        }

        private bool IsEquipped(string runtimeId, string baseId)
        {
            if (Inventory == null) return false;
            foreach (KeyValuePair<string, string> slot in Inventory.EquipmentSlots)
                if (!string.IsNullOrEmpty(slot.Value) && (slot.Value == runtimeId || RoaArmorData.BaseId(slot.Value) == baseId)) return true;
            return false;
        }

        // ------------------------------------------------------------------ обновление

        private void Refresh()
        {
            JObject market = Interaction.TradeMarket;
            JObject self = Interaction.TradeSelf;
            string traderName = Interaction.TradeActorName;
            int traderCaps = market?["caps"]?.ToObject<int>() ?? 0;
            int money = CountInventory(self, "silver");

            _title.text = (Interaction.TradeIsMachine ? "ТОРГОВЫЙ АВТОМАТ" : traderName) + " · БАРТЕР";
            _player.Meta.text = money + " кр.";
            _vendor.Meta.text = traderName + " · " + traderCaps + " кр.";

            // Строка состояния: бартер, крышки торговца, интерес (buyInterests рынка).
            int barter = RoaPipboy.SkillPercent(self, "barter");
            string skillText = "Бартер " + barter + "% · крышки торговца: " + traderCaps;
            JArray interests = market?["buyInterests"] as JArray;
            if (interests != null && interests.Count > 0)
            {
                var labels = new List<string>();
                foreach (JToken token in interests) labels.Add(RoaItemCategories.Label(token.ToString()));
                skillText += " · интерес: " + string.Join(", ", labels);
            }
            _skillLine.text = skillText;

            // Сделка: суммы, проектный вес, причина блокировки (tradeAcceptState web).
            var sellEntries = new List<Entry>();
            var buyEntries = new List<Entry>();
            int sellTotal = 0, buyTotal = 0;
            float projectedWeight = Inventory != null ? Inventory.CarryWeight : 0f;
            float capacity = Inventory != null ? Inventory.CarryCapacity : 0f;
            foreach (KeyValuePair<string, int> entry in Interaction.TradeSellsQueue)
            {
                string baseId = RoaInteraction.TradeBaseId(entry.Key);
                int price = EstimateSellPrice(baseId, market);
                sellEntries.Add(new Entry { RuntimeId = entry.Key, BaseId = baseId, Qty = entry.Value, Price = price });
                sellTotal += price * entry.Value;
                projectedWeight -= RoaItemData.Weight(baseId) * entry.Value;
            }
            foreach (KeyValuePair<string, int> entry in Interaction.TradeBuysQueue)
            {
                string baseId = RoaInteraction.TradeBaseId(entry.Key);
                int price = StockPrice(market, entry.Key);
                buyEntries.Add(new Entry { RuntimeId = entry.Key, BaseId = baseId, Qty = entry.Value, Price = price });
                buyTotal += price * entry.Value;
                projectedWeight += RoaItemData.Weight(baseId) * entry.Value;
            }
            int net = buyTotal - sellTotal;
            bool hasTrade = sellEntries.Count > 0 || buyEntries.Count > 0;
            bool overweight = projectedWeight > capacity + 0.0001f;
            string reason = string.Empty;
            if (Interaction.TradePending) reason = "Автомат проводит обмен на сервере.";
            else if (!hasTrade) reason = "Выберите предметы для обмена.";
            else if (net > money) reason = "Не хватает крышек: нужно " + net + ", у вас " + money + ".";
            else if (net < 0 && Mathf.Abs(net) > traderCaps) reason = "У торговца не хватает крышек: нужно " + Mathf.Abs(net) + ", у него " + traderCaps + ".";
            else if (overweight) reason = "Перегруз: " + projectedWeight.ToString("0.0") + "/" + capacity.ToString("0.0") + " кг.";

            _carryLine.text = "Вес " + projectedWeight.ToString("0.0") + "/" + capacity.ToString("0.0");
            _carryLine.color = overweight ? WarnInk : StatusInk;

            _sellTotal.text = "+" + sellTotal + " кр.";
            _buyTotal.text = "-" + buyTotal + " кр.";
            _net.text = net > 0 ? "Вы платите " + net + " кр." : (net < 0 ? "Вам платят " + Mathf.Abs(net) + " кр." : "Ровный обмен");
            _net.color = net > 0 ? NetPay : (net < 0 ? NetGain : NetInk);
            _warning.text = hasTrade ? reason : string.Empty;
            _warning.gameObject.SetActive(hasTrade && !string.IsNullOrEmpty(reason));

            SetButton(_confirm, _confirmLabel, string.IsNullOrEmpty(reason));
            _confirmLabel.text = Interaction.TradePending ? "Сервер проверяет…" : "Принять обмен";
            SetButton(_clear, _clearLabel, hasTrade);
            _statusLine.text = Interaction.TradeStatus ?? string.Empty;

            FillOffers(sellEntries, buyEntries);
            FillPlayer(self, market, money, net, projectedWeight, capacity);
            FillVendor(market, money, net, projectedWeight, capacity);
        }

        private void FillPlayer(JObject self, JObject market, int money, int net, float projectedWeight, float capacity)
        {
            var entries = new List<Entry>();
            JArray inventory = self?["inventory"] as JArray;
            if (inventory != null)
            {
                foreach (JToken row in inventory)
                {
                    string runtimeId = row["id"]?.ToString();
                    string baseId = RoaInteraction.TradeBaseId(runtimeId);
                    int qty = row["qty"]?.ToObject<int>() ?? 0;
                    if (string.IsNullOrEmpty(runtimeId) || qty <= 0 || baseId == "silver" || baseId == "fists") continue;
                    entries.Add(new Entry { RuntimeId = runtimeId, BaseId = baseId, Qty = qty, Price = EstimateSellPrice(baseId, market) });
                }
            }
            entries.Sort((a, b) =>
            {
                int cmp = CategoryOrder(a.BaseId).CompareTo(CategoryOrder(b.BaseId));
                return cmp != 0 ? cmp : string.Compare(ItemName(a.BaseId), ItemName(b.BaseId), System.StringComparison.CurrentCulture);
            });
            RefreshTabs(_player, entries);

            ClearRows(_player);
            int index = 0;
            foreach (Entry e in entries)
            {
                if (!RoaItemCategories.Matches(e.BaseId, _player.Category)) continue;
                int queued = Interaction.TradeQueuedQuantity(e.RuntimeId, false);
                int free = Mathf.Max(0, e.Qty - queued);
                bool equipped = IsEquipped(e.RuntimeId, e.BaseId);
                Entry captured = e;
                int capturedFree = free;
                AddRow(_player, index++, e.BaseId, ItemName(e.BaseId), equipped ? "ЭКИПИРОВАНО" : null,
                    RoaItemData.Weight(e.BaseId).ToString("0.0") + " кг · продажа " + e.Price + " кр.",
                    "x" + free, queued > 0 ? "в обмене " + queued : null,
                    queued > 0 ? RowQueued : (equipped ? RowEquipped : RowBorder), free <= 0,
                    () => Interaction.TradeRequest(captured.RuntimeId, false, capturedFree, captured.Price));
            }
            SetEmpty(_player, index == 0, _player.Category == "all"
                ? "Нет предметов для продажи."
                : "В разделе «" + RoaItemCategories.Label(_player.Category) + "» нет предметов для продажи.");
        }

        private void FillVendor(JObject market, int money, int net, float projectedWeight, float capacity)
        {
            var entries = new List<Entry>();
            JArray stock = market?["stock"] as JArray;
            if (stock != null)
            {
                foreach (JToken row in stock)
                {
                    string id = row["id"]?.ToString();
                    if (string.IsNullOrEmpty(id)) continue;
                    entries.Add(new Entry { RuntimeId = id, BaseId = RoaInteraction.TradeBaseId(id), Qty = row["qty"]?.ToObject<int>() ?? 0, Price = row["price"]?.ToObject<int>() ?? 0 });
                }
            }
            RefreshTabs(_vendor, entries);

            ClearRows(_vendor);
            int index = 0;
            foreach (Entry e in entries)
            {
                if (!RoaItemCategories.Matches(e.BaseId, _vendor.Category)) continue;
                int queued = Interaction.TradeQueuedQuantity(e.RuntimeId, true);
                int available = Mathf.Max(0, e.Qty - queued);
                bool weightBlocked = projectedWeight + RoaItemData.Weight(e.BaseId) > capacity + 0.0001f;
                bool moneyBlocked = net + e.Price > money;
                bool stockBlocked = available <= 0;
                Entry captured = e;
                int capturedAvailable = available;
                AddRow(_vendor, index++, e.BaseId, ItemName(e.BaseId), null,
                    RoaItemData.Weight(e.BaseId).ToString("0.0") + " кг · покупка " + e.Price + " кр. · осталось " + available,
                    e.Price + " кр.", queued > 0 ? "в обмене " + queued : null,
                    queued > 0 ? RowQueued : ((weightBlocked || moneyBlocked) ? RowBlocked : RowBorder), stockBlocked,
                    () => Interaction.TradeRequest(captured.RuntimeId, true, capturedAvailable, captured.Price));
            }
            SetEmpty(_vendor, index == 0, _vendor.Category == "all"
                ? "У торговца нет товаров."
                : "В разделе «" + RoaItemCategories.Label(_vendor.Category) + "» у торговца пусто.");
        }

        private void FillOffers(List<Entry> sell, List<Entry> buy)
        {
            foreach (GameObject row in _offerRows) Destroy(row);
            _offerRows.Clear();
            _sellEmpty.gameObject.SetActive(sell.Count == 0);
            _buyEmpty.gameObject.SetActive(buy.Count == 0);
            for (int i = 0; i < sell.Count; i++)
            {
                Entry e = sell[i];
                _offerRows.Add(MiniRow(_sellList, i, e, "+" + (e.Price * e.Qty) + " кр.", () => Interaction.TradeQueueRemove(e.RuntimeId, false, 1)));
            }
            for (int i = 0; i < buy.Count; i++)
            {
                Entry e = buy[i];
                _offerRows.Add(MiniRow(_buyList, i, e, "-" + (e.Price * e.Qty) + " кр.", () => Interaction.TradeQueueRemove(e.RuntimeId, true, 1)));
            }
            _sellList.sizeDelta = new Vector2(0f, Mathf.Max(1, sell.Count) * (MiniRowHeight + 5f));
            _buyList.sizeDelta = new Vector2(0f, Mathf.Max(1, buy.Count) * (MiniRowHeight + 5f));
        }

        private void RefreshTabs(Column column, List<Entry> entries)
        {
            var available = new HashSet<string>();
            foreach (Entry e in entries) available.Add(RoaItemCategories.Category(e.BaseId));
            foreach (KeyValuePair<string, Button> tab in column.TabButtons)
            {
                bool active = tab.Key == column.Category;
                bool enabled = tab.Key == "all" || available.Contains(tab.Key);
                tab.Value.interactable = enabled;
                tab.Value.GetComponent<Image>().color = active ? TabActiveBg : TabBg;
                tab.Value.GetComponent<Outline>().effectColor = active ? TabActiveBorder : TabBorder;
                Color ink = active ? TabActiveInk : TabInk;
                if (!enabled) ink.a = 0.38f;
                column.TabLabels[tab.Key].color = ink;
            }
        }

        private static void ClearRows(Column column)
        {
            foreach (GameObject row in column.Rows) Destroy(row);
            column.Rows.Clear();
        }

        private static void SetEmpty(Column column, bool empty, string text)
        {
            column.Empty.gameObject.SetActive(empty);
            column.Empty.text = text;
            column.List.sizeDelta = new Vector2(0f, empty ? 60f : column.Rows.Count * (RowHeight + RowGap) + 7f);
        }

        /// <summary>.trade-card.barter-row: 34px арт | имя+заметка | правая колонка.</summary>
        private void AddRow(Column column, int index, string baseId, string name, string badge, string note,
                            string side, string sideSub, Color border, bool disabled, System.Action onClick)
        {
            var go = new GameObject("Row:" + baseId, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(column.List, false);
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.pivot = new Vector2(0.5f, 1f);
            rect.offsetMin = new Vector2(7f, -7f - index * (RowHeight + RowGap) - RowHeight);
            rect.offsetMax = new Vector2(-7f, -7f - index * (RowHeight + RowGap));
            var image = go.AddComponent<Image>();
            // Непрозрачный приглушённый фон: полупрозрачный тонировался бы копией Outline.
            image.color = disabled ? new Color(0.06f, 0.07f, 0.06f, 1f) : RowBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = border;
            outline.effectDistance = new Vector2(1f, -1f);

            // .barter-row-icon 30×30
            RectTransform icon = Child("Icon", rect);
            icon.anchorMin = icon.anchorMax = new Vector2(0f, 0.5f);
            icon.pivot = new Vector2(0f, 0.5f);
            icon.anchoredPosition = new Vector2(7f, 0f);
            icon.sizeDelta = new Vector2(30f, 30f);
            var iconBg = icon.gameObject.AddComponent<Image>();
            iconBg.color = IconBg;
            iconBg.raycastTarget = false;
            var iconBorder = icon.gameObject.AddComponent<Outline>();
            iconBorder.effectColor = IconBorder;
            iconBorder.effectDistance = new Vector2(1f, -1f);
            RectTransform art = Child("Art", icon);
            Stretch(art, 3f);
            var artImage = art.gameObject.AddComponent<RawImage>();
            artImage.texture = RoaItemCategories.Art(baseId);
            artImage.raycastTarget = false;
            artImage.enabled = artImage.texture != null;
            if (disabled) artImage.color = new Color(1f, 1f, 1f, 0.5f);

            // .barter-row-body
            Text nameText = Label("Name", rect, 11, TextAnchor.LowerLeft, RowName, FontStyle.Bold);
            Place(nameText.rectTransform, 0f, 0.5f, 1f, 1f, new Vector2(44f, 0f), new Vector2(-76f, -6f));
            nameText.horizontalOverflow = HorizontalWrapMode.Wrap;
            nameText.verticalOverflow = VerticalWrapMode.Truncate;
            nameText.text = badge != null ? name + "  <color=#f4c75c><size=8>" + badge + "</size></color>" : name;
            nameText.supportRichText = true;
            Text noteText = Label("Note", rect, 9, TextAnchor.UpperLeft, RowNote);
            Place(noteText.rectTransform, 0f, 0f, 1f, 0.5f, new Vector2(44f, 5f), new Vector2(-76f, -1f));
            noteText.horizontalOverflow = HorizontalWrapMode.Wrap;
            noteText.verticalOverflow = VerticalWrapMode.Truncate;
            noteText.text = note;

            // .barter-row-side
            Text sideText = Label("Side", rect, 11, TextAnchor.MiddleRight, RowName, FontStyle.Bold);
            Place(sideText.rectTransform, 1f, sideSub != null ? 0.5f : 0f, 1f, 1f, new Vector2(-72f, 0f), new Vector2(-7f, 0f));
            sideText.text = side;
            if (sideSub != null)
            {
                Text subText = Label("SideSub", rect, 8, TextAnchor.UpperRight, ColumnMeta);
                Place(subText.rectTransform, 1f, 0f, 1f, 0.5f, new Vector2(-72f, 4f), new Vector2(-7f, 0f));
                subText.text = sideSub;
            }

            if (!disabled)
            {
                var button = go.AddComponent<Button>();
                button.targetGraphic = image;
                button.onClick.AddListener(() => { onClick(); _refreshAt = Time.unscaledTime + 0.2f; });
            }
            column.Rows.Add(go);
        }

        /// <summary>.barter-mini-row: 22px арт | имя | ×N | сумма; клик убирает 1 шт.</summary>
        private GameObject MiniRow(RectTransform list, int index, Entry entry, string sum, System.Action onClick)
        {
            var go = new GameObject("Mini:" + entry.BaseId, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(list, false);
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.pivot = new Vector2(0.5f, 1f);
            rect.offsetMin = new Vector2(0f, -index * (MiniRowHeight + 5f) - MiniRowHeight);
            rect.offsetMax = new Vector2(0f, -index * (MiniRowHeight + 5f));
            var image = go.AddComponent<Image>();
            image.color = RowBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = RowQueued;
            outline.effectDistance = new Vector2(1f, -1f);
            RectTransform art = Child("Art", rect);
            art.anchorMin = art.anchorMax = new Vector2(0f, 0.5f);
            art.pivot = new Vector2(0f, 0.5f);
            art.anchoredPosition = new Vector2(5f, 0f);
            art.sizeDelta = new Vector2(20f, 20f);
            var artImage = art.gameObject.AddComponent<RawImage>();
            artImage.texture = RoaItemCategories.Art(entry.BaseId);
            artImage.raycastTarget = false;
            artImage.enabled = artImage.texture != null;
            Text name = Label("Name", rect, 10, TextAnchor.MiddleLeft, RowName, FontStyle.Bold);
            Place(name.rectTransform, 0f, 0f, 1f, 1f, new Vector2(30f, 0f), new Vector2(-96f, 0f));
            name.horizontalOverflow = HorizontalWrapMode.Wrap;
            name.verticalOverflow = VerticalWrapMode.Truncate;
            name.text = ItemName(entry.BaseId);
            Text qty = Label("Qty", rect, 10, TextAnchor.MiddleRight, new Color(0.682f, 0.725f, 0.557f, 1f));
            Place(qty.rectTransform, 1f, 0f, 1f, 1f, new Vector2(-94f, 0f), new Vector2(-62f, 0f));
            qty.text = "x" + entry.Qty;
            Text total = Label("Sum", rect, 10, TextAnchor.MiddleRight, LedgerGain, FontStyle.Bold);
            Place(total.rectTransform, 1f, 0f, 1f, 1f, new Vector2(-60f, 0f), new Vector2(-5f, 0f));
            total.text = sum;
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => { onClick(); _refreshAt = Time.unscaledTime + 0.2f; });
            return go;
        }

        // ------------------------------------------------------------------ постройка

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("BarterCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 42;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;

            // #trader-window.barter-window: 1180×760, padding 14.
            _root = new GameObject("TraderWindow", typeof(RectTransform));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            root.anchorMin = root.anchorMax = new Vector2(0.5f, 0.5f);
            root.sizeDelta = new Vector2(1180f, 760f);
            var bg = _root.AddComponent<Image>();
            bg.color = PanelBg;
            var border = _root.AddComponent<Outline>();
            border.effectColor = PanelBorder;
            border.effectDistance = new Vector2(1f, -1f);

            // .barter-panel-title
            _title = Label("Title", root, 13, TextAnchor.MiddleLeft, TitleInk, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -38f), new Vector2(-52f, -14f));
            Button close = UiButton(root, "×", out Text closeLabel, () => Interaction.TradeClose());
            closeLabel.fontSize = 14;
            Place((RectTransform)close.transform, 1f, 1f, 1f, 1f, new Vector2(-38f, -38f), new Vector2(-14f, -14f));
            RectTransform line = Child("TitleLine", root);
            Place(line, 0f, 1f, 1f, 1f, new Vector2(14f, -47f), new Vector2(-14f, -46f));
            var lineImage = line.gameObject.AddComponent<Image>();
            lineImage.color = TitleLine;
            lineImage.raycastTarget = false;

            // .barter-status-row
            _skillLine = Label("Skill", root, 11, TextAnchor.MiddleLeft, StatusInk, FontStyle.Bold);
            Place(_skillLine.rectTransform, 0f, 1f, 0.75f, 1f, new Vector2(14f, -68f), new Vector2(0f, -50f));
            _carryLine = Label("Carry", root, 11, TextAnchor.MiddleRight, StatusInk, FontStyle.Bold);
            Place(_carryLine.rectTransform, 0.75f, 1f, 1f, 1f, new Vector2(0f, -68f), new Vector2(-14f, -50f));

            // .barter-layout: 1fr | 340px | 1fr, gap 12.
            float centerWidth = 340f;
            float side = (1180f - 28f - centerWidth - 24f) / 2f;
            _player = BuildColumn(root, "Player", "ВАШИ ВЕЩИ");
            Place(_player.Root, 0f, 0f, 0f, 1f, new Vector2(14f, 40f), new Vector2(14f + side, -76f));
            RectTransform center = Child("Center", root);
            Place(center, 0f, 0f, 0f, 1f, new Vector2(14f + side + 12f, 40f), new Vector2(14f + side + 12f + centerWidth, -76f));
            Panel(center, ColumnBg, ColumnBorder);
            BuildCenter(center);
            _vendor = BuildColumn(root, "Vendor", "ТОВАР ТОРГОВЦА");
            Place(_vendor.Root, 1f, 0f, 1f, 1f, new Vector2(-14f - side, 40f), new Vector2(-14f, -76f));

            _statusLine = Label("Status", root, 10, TextAnchor.MiddleLeft, StatusInk);
            Place(_statusLine.rectTransform, 0f, 0f, 1f, 0f, new Vector2(14f, 12f), new Vector2(-14f, 34f));
        }

        private Column BuildColumn(RectTransform parent, string name, string caption)
        {
            var column = new Column();
            column.Root = Child(name, parent);
            Panel(column.Root, ColumnBg, ColumnBorder);

            // .barter-column-title 30px с линией снизу.
            column.Title = Label("Title", column.Root, 11, TextAnchor.MiddleLeft, ColumnTitle, FontStyle.Bold);
            column.Title.text = caption;
            Place(column.Title.rectTransform, 0f, 1f, 0.5f, 1f, new Vector2(8f, -30f), new Vector2(0f, 0f));
            column.Meta = Label("Meta", column.Root, 11, TextAnchor.MiddleRight, ColumnMeta, FontStyle.Bold);
            Place(column.Meta.rectTransform, 0.35f, 1f, 1f, 1f, new Vector2(0f, -30f), new Vector2(-8f, 0f));
            RectTransform line = Child("Line", column.Root);
            Place(line, 0f, 1f, 1f, 1f, new Vector2(0f, -31f), new Vector2(0f, -30f));
            var lineImage = line.gameObject.AddComponent<Image>();
            lineImage.color = new Color(ColumnBorder.r, ColumnBorder.g, ColumnBorder.b, 0.54f);
            lineImage.raycastTarget = false;

            // .item-category-tabs
            column.Tabs = Child("Tabs", column.Root);
            Place(column.Tabs, 0f, 1f, 1f, 1f, new Vector2(6f, -60f), new Vector2(-6f, -36f));
            var layout = column.Tabs.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.spacing = 3f;
            layout.childForceExpandWidth = false;
            layout.childForceExpandHeight = true;
            layout.childControlWidth = true;
            layout.childControlHeight = true;
            foreach (RoaItemCategories.Tab tab in RoaItemCategories.Tabs)
            {
                string id = tab.Id;
                Button button = UiButton(column.Tabs, tab.Label, out Text label, () => { column.Category = id; _refreshAt = 0f; });
                button.name = "Tab:" + id;
                label.fontSize = 8;
                label.fontStyle = FontStyle.Normal;
                button.GetComponent<Image>().color = TabBg;
                button.GetComponent<Outline>().effectColor = TabBorder;
                var element = button.gameObject.AddComponent<LayoutElement>();
                element.preferredWidth = Mathf.Max(30f, tab.Label.Length * 6f + 12f);
                column.TabButtons[id] = button;
                column.TabLabels[id] = label;
            }

            // .barter-item-list — прокрутка.
            RectTransform viewport = Child("Viewport", column.Root);
            Place(viewport, 0f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(0f, -64f));
            viewport.gameObject.AddComponent<RectMask2D>();
            var viewImage = viewport.gameObject.AddComponent<Image>();
            viewImage.color = new Color(0f, 0f, 0f, 0.01f);
            column.List = Child("List", viewport);
            column.List.anchorMin = new Vector2(0f, 1f);
            column.List.anchorMax = new Vector2(1f, 1f);
            column.List.pivot = new Vector2(0.5f, 1f);
            column.List.sizeDelta = new Vector2(0f, 100f);
            var scroll = viewport.gameObject.AddComponent<ScrollRect>();
            scroll.content = column.List;
            scroll.viewport = viewport;
            scroll.horizontal = false;
            scroll.scrollSensitivity = 30f;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            column.Empty = Label("Empty", viewport, 10, TextAnchor.UpperLeft, RowNote);
            Place(column.Empty.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -40f), new Vector2(-10f, -10f));
            column.Empty.horizontalOverflow = HorizontalWrapMode.Wrap;
            column.Empty.gameObject.SetActive(false);
            return column;
        }

        private void BuildCenter(RectTransform center)
        {
            float y = -8f;
            // .barter-ledger
            RectTransform ledger = Child("Ledger", center);
            Place(ledger, 0f, 1f, 1f, 1f, new Vector2(8f, y - 104f), new Vector2(-8f, y));
            Panel(ledger, new Color(0f, 0f, 0f, 0.3f), new Color(ColumnBorder.r, ColumnBorder.g, ColumnBorder.b, 0.64f));
            Text ledgerTitle = Label("Title", ledger, 11, TextAnchor.MiddleLeft, TitleInk, FontStyle.Bold);
            ledgerTitle.text = "ИТОГ ОБМЕНА";
            Place(ledgerTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -24f), new Vector2(-8f, -6f));
            Text sellLabel = Label("SellLabel", ledger, 10, TextAnchor.MiddleLeft, LedgerInk);
            sellLabel.text = "Ваши товары";
            Place(sellLabel.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(8f, -40f), new Vector2(0f, -26f));
            _sellTotal = Label("SellTotal", ledger, 10, TextAnchor.MiddleRight, LedgerGain, FontStyle.Bold);
            Place(_sellTotal.rectTransform, 0.4f, 1f, 1f, 1f, new Vector2(0f, -40f), new Vector2(-8f, -26f));
            Text buyLabel = Label("BuyLabel", ledger, 10, TextAnchor.MiddleLeft, LedgerInk);
            buyLabel.text = "Товар торговца";
            Place(buyLabel.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(8f, -56f), new Vector2(0f, -42f));
            _buyTotal = Label("BuyTotal", ledger, 10, TextAnchor.MiddleRight, LedgerCost, FontStyle.Bold);
            Place(_buyTotal.rectTransform, 0.4f, 1f, 1f, 1f, new Vector2(0f, -56f), new Vector2(-8f, -42f));
            RectTransform netRect = Child("Net", ledger);
            Place(netRect, 0f, 1f, 1f, 1f, new Vector2(8f, -96f), new Vector2(-8f, -66f));
            _netBg = netRect.gameObject.AddComponent<Image>();
            _netBg.color = NetBg;
            _netBg.raycastTarget = false;
            _net = Label("Text", netRect, 12, TextAnchor.MiddleCenter, NetInk, FontStyle.Bold);
            Stretch(_net.rectTransform, 2f);
            y -= 112f;

            // .barter-offers: «Вы отдаёте» / «Вы берёте».
            Text sellTitle = Label("SellTitle", center, 10, TextAnchor.MiddleLeft, OfferTitle, FontStyle.Bold);
            sellTitle.text = "ВЫ ОТДАЁТЕ";
            Place(sellTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, y - 16f), new Vector2(-8f, y));
            y -= 20f;
            _sellList = OfferList(center, "SellList", y, 150f, out _sellEmpty);
            y -= 158f;
            Text buyTitle = Label("BuyTitle", center, 10, TextAnchor.MiddleLeft, OfferTitle, FontStyle.Bold);
            buyTitle.text = "ВЫ БЕРЁТЕ";
            Place(buyTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, y - 16f), new Vector2(-8f, y));
            y -= 20f;
            _buyList = OfferList(center, "BuyList", y, 150f, out _buyEmpty);
            y -= 158f;

            // .trade-warning
            _warning = Label("Warning", center, 10, TextAnchor.MiddleCenter, WarnInk, FontStyle.Bold);
            Place(_warning.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, y - 34f), new Vector2(-8f, y));
            _warning.horizontalOverflow = HorizontalWrapMode.Wrap;

            // .trade-sell-actions — снизу центра.
            _confirm = UiButton(center, "Принять обмен", out _confirmLabel, () => { Interaction.TradeConfirm(); _refreshAt = Time.unscaledTime + 0.3f; });
            Place((RectTransform)_confirm.transform, 0f, 0f, 0.5f, 0f, new Vector2(8f, 8f), new Vector2(-4f, 42f));
            _clear = UiButton(center, "Сбросить", out _clearLabel, () => { Interaction.TradeClear(); _refreshAt = 0f; });
            Place((RectTransform)_clear.transform, 0.5f, 0f, 1f, 0f, new Vector2(4f, 8f), new Vector2(-8f, 42f));
        }

        private RectTransform OfferList(RectTransform parent, string name, float top, float height, out Text empty)
        {
            RectTransform viewport = Child(name + "Viewport", parent);
            Place(viewport, 0f, 1f, 1f, 1f, new Vector2(8f, top - height), new Vector2(-8f, top));
            viewport.gameObject.AddComponent<RectMask2D>();
            var viewImage = viewport.gameObject.AddComponent<Image>();
            viewImage.color = new Color(0f, 0f, 0f, 0.01f);
            RectTransform list = Child(name, viewport);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0.5f, 1f);
            list.sizeDelta = new Vector2(0f, 30f);
            var scroll = viewport.gameObject.AddComponent<ScrollRect>();
            scroll.content = list;
            scroll.viewport = viewport;
            scroll.horizontal = false;
            scroll.scrollSensitivity = 30f;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            empty = Label("Empty", viewport, 11, TextAnchor.UpperLeft, RowNote);
            empty.text = "—";
            Place(empty.rectTransform, 0f, 1f, 1f, 1f, new Vector2(4f, -20f), new Vector2(-4f, -2f));
            return list;
        }

        // ------------------------------------------------------------------ утилиты

        private static void Panel(RectTransform rect, Color bg, Color border)
        {
            var image = rect.gameObject.AddComponent<Image>();
            image.color = bg;
            image.raycastTarget = false;
            var outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = border;
            outline.effectDistance = new Vector2(1f, -1f);
        }

        private static void SetButton(Button button, Text label, bool enabled)
        {
            button.interactable = enabled;
            Color c = BtnInk;
            if (!enabled) c.a = 0.45f;
            label.color = c;
        }

        private static Button UiButton(RectTransform parent, string caption, out Text label, System.Action onClick)
        {
            var go = new GameObject("Btn:" + caption, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = BtnBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = BtnBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, 11, TextAnchor.MiddleCenter, BtnInk, FontStyle.Bold);
            label.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(label.rectTransform, 3f);
            label.text = caption;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
        }

        private static void Stretch(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset);
            rect.offsetMax = new Vector2(-inset, -inset);
        }

        private static void Place(RectTransform rect, float minX, float minY, float maxX, float maxY, Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = new Vector2(minX, minY);
            rect.anchorMax = new Vector2(maxX, maxY);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }

        private static Text Label(string name, RectTransform parent, int size, TextAnchor anchor, Color color, FontStyle style = FontStyle.Normal)
        {
            RectTransform rect = Child(name, parent);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = size;
            text.alignment = anchor;
            text.color = color;
            text.fontStyle = style;
            text.raycastTarget = false;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            return text;
        }
    }
}
