using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Окно хранилища в web-виде — #storage-window (01_base_layout_hud.css:1045,
    /// renderStorageWindow в 07a_storage_window.js). Две колонки «Рюкзак | Ящик»:
    /// заголовок с весом, кнопка сортировки, вкладки категорий, сетка карточек
    /// .inv-card по 4 в ряд с пустыми ячейками до 20, внизу «Положить всё /
    /// Забрать всё». Логика переноса — RoaInteraction (storageTransfer).
    /// Перетаскивание web заменено кликом: клик — один предмет, Shift+клик — вся стопка.
    /// </summary>
    public sealed class RoaStorageCanvas : MonoBehaviour
    {
        public RoaInteraction Interaction;
        public RoaInventory Inventory;

        // .ui-panel / .storage-title / .inv-card / .item-category-tab
        private static readonly Color PanelBg = new Color(0.051f, 0.063f, 0.063f, 0.97f);
        private static readonly Color PanelBorder = new Color(0.682f, 0.545f, 0.282f, 0.45f);
        private static readonly Color TitleInk = new Color(0.941f, 0.824f, 0.541f, 1f);
        private static readonly Color HintInk = new Color(0.62f, 0.6f, 0.5f, 1f);
        private static readonly Color ColumnTitle = new Color(0.851f, 0.741f, 0.478f, 1f);   // #d9bd7a
        private static readonly Color GridBg = new Color(0.03f, 0.035f, 0.03f, 1f);
        private static readonly Color GridBorder = new Color(0.341f, 0.322f, 0.235f, 0.55f);
        private static readonly Color CardBg = new Color(0.094f, 0.106f, 0.094f, 1f);          // rgba(24,27,24)
        private static readonly Color CardBorder = new Color(0.341f, 0.322f, 0.235f, 0.55f);  // rgba(87,82,60,.55)
        private static readonly Color CardEquipped = new Color(0.498f, 0.698f, 0.294f, 1f);   // #7fb24b
        private static readonly Color CardBlocked = new Color(0.45f, 0.2f, 0.15f, 0.8f);
        private static readonly Color CardName = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color CardWeight = new Color(0.82f, 0.694f, 0.404f, 1f);
        private static readonly Color EmptyMark = new Color(0.4f, 0.4f, 0.35f, 0.6f);
        private static readonly Color TabBg = new Color(0.031f, 0.071f, 0.047f, 1f);
        private static readonly Color TabBorder = new Color(0.459f, 0.58f, 0.341f, 0.46f);
        private static readonly Color TabInk = new Color(0.663f, 0.788f, 0.561f, 1f);         // #a9c98f
        private static readonly Color TabActiveBg = new Color(0.188f, 0.149f, 0.078f, 1f);
        private static readonly Color TabActiveBorder = new Color(0.816f, 0.631f, 0.306f, 1f); // #d0a14e
        private static readonly Color TabActiveInk = new Color(0.941f, 0.824f, 0.541f, 1f);    // #f0d28a
        private static readonly Color BtnBg = new Color(0.165f, 0.141f, 0.098f, 1f);
        private static readonly Color BtnInk = new Color(0.898f, 0.78f, 0.486f, 1f);
        private static readonly Color BtnBorder = new Color(0.682f, 0.545f, 0.282f, 0.65f);
        private static readonly Color StatusInk = new Color(0.85f, 0.8f, 0.6f, 1f);

        private const int Columns = 4;
        private const int MinSlots = 20;
        private const float CardSize = 84f;
        private const float CardGap = 7f;

        private sealed class Column
        {
            public RectTransform Root;
            public Text Title, Info, SortLabel, Empty;
            public RectTransform Tabs, Grid;
            public readonly Dictionary<string, Button> TabButtons = new Dictionary<string, Button>();
            public readonly Dictionary<string, Text> TabLabels = new Dictionary<string, Text>();
            public readonly List<GameObject> Cards = new List<GameObject>();
            public string Category = "all";
            public string SortMode = "type";
        }

        private Canvas _canvas;
        private GameObject _root;
        private Text _title, _status;
        private Column _backpack, _box;
        private Button _putAll, _takeAll;
        private Text _putAllLabel, _takeAllLabel;
        private float _refreshAt;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        private void Update()
        {
            bool open = Interaction != null && Interaction.StorageOpen;
            if (!open)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) { _root.SetActive(true); _refreshAt = 0f; }
            if (Input.GetKeyDown(KeyCode.Escape) && !Interaction.QuantityOpen) { Interaction.LootClose(); return; }
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.3f;
            Refresh();
        }

        // ------------------------------------------------------------------ данные

        private struct Entry { public string RuntimeId; public string BaseId; public int Qty; }

        private List<Entry> Entries(JArray rows, bool backpack)
        {
            var list = new List<Entry>();
            if (rows == null) return list;
            foreach (JToken row in rows)
            {
                string runtimeId = row["id"]?.ToString();
                int qty = row["qty"]?.ToObject<int>() ?? 0;
                if (string.IsNullOrEmpty(runtimeId) || qty <= 0) continue;
                string baseId = RoaInteraction.TradeBaseId(runtimeId);
                if (baseId == "fists" || (backpack && baseId == "silver")) continue;
                list.Add(new Entry { RuntimeId = runtimeId, BaseId = baseId, Qty = qty });
            }
            return list;
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

        private static string ItemName(string baseId)
        {
            string name = RoaItemData.Name(baseId);
            if (!string.IsNullOrEmpty(name)) return name;
            RoaWeaponData.Weapon weapon = RoaWeaponData.Get(baseId);
            return weapon != null ? weapon.Name : baseId;
        }

        private static void Sort(List<Entry> list, string mode)
        {
            if (mode == "weight")
                list.Sort((a, b) =>
                {
                    float aw = RoaItemData.Weight(a.BaseId) * a.Qty, bw = RoaItemData.Weight(b.BaseId) * b.Qty;
                    if (!Mathf.Approximately(aw, bw)) return bw.CompareTo(aw);
                    return string.Compare(ItemName(a.BaseId), ItemName(b.BaseId), System.StringComparison.CurrentCulture);
                });
            else
                list.Sort((a, b) =>
                {
                    int cmp = CategoryOrder(a.BaseId).CompareTo(CategoryOrder(b.BaseId));
                    if (cmp != 0) return cmp;
                    return string.Compare(ItemName(a.BaseId), ItemName(b.BaseId), System.StringComparison.CurrentCulture);
                });
        }

        /// <summary>isProtectedInventoryItem web: крышки, надетое и патроны текущего оружия остаются в рюкзаке.</summary>
        private bool IsProtected(Entry entry)
        {
            if (entry.BaseId == "silver") return true;
            if (Inventory == null) return false;
            foreach (KeyValuePair<string, string> slot in Inventory.EquipmentSlots)
                if (slot.Value == entry.RuntimeId || RoaArmorData.BaseId(slot.Value) == entry.BaseId) return true;
            if (Inventory.EquipmentSlots.TryGetValue("weapon", out string weaponId))
            {
                RoaWeaponData.Weapon weapon = RoaWeaponData.Get(RoaArmorData.BaseId(weaponId));
                if (weapon != null && !string.IsNullOrEmpty(weapon.AmmoType) && weapon.AmmoType == entry.BaseId) return true;
            }
            return false;
        }

        /// <summary>Класс .equipped web — только надетые вещи, не патроны.</summary>
        private bool IsEquipped(Entry entry)
        {
            if (Inventory == null) return false;
            foreach (KeyValuePair<string, string> slot in Inventory.EquipmentSlots)
                if (!string.IsNullOrEmpty(slot.Value) && (slot.Value == entry.RuntimeId || RoaArmorData.BaseId(slot.Value) == entry.BaseId)) return true;
            return false;
        }

        private float FreeWeight()
        {
            return Inventory != null ? Mathf.Max(0f, Inventory.CarryCapacity - Inventory.CarryWeight) : 9999f;
        }

        /// <summary>finiteMaxCarryableQty web: сколько штук влезет по весу.</summary>
        private int CarryMax(Entry entry)
        {
            float unit = RoaItemData.Weight(entry.BaseId);
            if (unit <= 0.0001f) return entry.Qty;
            return Mathf.Clamp(Mathf.FloorToInt(FreeWeight() / unit + 0.0001f), 0, entry.Qty);
        }

        // ------------------------------------------------------------------ обновление

        private void Refresh()
        {
            // #storage-title web — только имя ящика.
            string title = Interaction.LootTitle ?? string.Empty;
            if (title.StartsWith("Хранилище: ")) title = title.Substring("Хранилище: ".Length);
            _title.text = title;
            _status.text = Interaction.LootStatus;

            List<Entry> backpack = Entries(Interaction.InventoryRows, true);
            List<Entry> box = Entries(Interaction.StorageRows, false);
            Sort(backpack, _backpack.SortMode);
            Sort(box, _box.SortMode);

            if (Inventory != null)
                _backpack.Info.text = Inventory.CarryWeight.ToString("0.0") + " / " + Inventory.CarryCapacity.ToString("0") + " кг";
            float boxWeight = 0f;
            foreach (Entry e in box) boxWeight += RoaItemData.Weight(e.BaseId) * e.Qty;
            _box.Info.text = box.Count + " предм. · " + boxWeight.ToString("0.0") + " кг";

            FillColumn(_backpack, backpack, true);
            FillColumn(_box, box, false);

            // «Забрать всё» недоступно, если не хватает веса (canCarryFullLootList).
            bool canTakeAll = box.Count > 0 && boxWeight <= FreeWeight() + 0.0001f;
            SetButton(_takeAll, _takeAllLabel, canTakeAll);
            bool anyDeposit = false;
            foreach (Entry e in backpack) if (!IsProtected(e)) { anyDeposit = true; break; }
            SetButton(_putAll, _putAllLabel, anyDeposit);
        }

        private void FillColumn(Column column, List<Entry> entries, bool backpack)
        {
            foreach (GameObject card in column.Cards) Destroy(card);
            column.Cards.Clear();

            var available = new HashSet<string>();
            foreach (Entry e in entries) available.Add(RoaItemCategories.Category(e.BaseId));
            foreach (KeyValuePair<string, Button> tab in column.TabButtons)
            {
                bool active = tab.Key == column.Category;
                bool enabled = tab.Key == "all" || available.Contains(tab.Key);
                tab.Value.interactable = enabled;
                var image = tab.Value.GetComponent<Image>();
                image.color = active ? TabActiveBg : TabBg;
                tab.Value.GetComponent<Outline>().effectColor = active ? TabActiveBorder : TabBorder;
                Color ink = active ? TabActiveInk : TabInk;
                if (!enabled) ink.a = 0.38f;
                column.TabLabels[tab.Key].color = ink;
            }
            column.SortLabel.text = (backpack ? "Сортировать рюкзак · " : "Сортировать ящик · ") + (column.SortMode == "weight" ? "по весу" : "по типу");

            int index = 0;
            foreach (Entry e in entries)
            {
                if (!RoaItemCategories.Matches(e.BaseId, column.Category)) continue;
                column.Cards.Add(BuildCard(column, e, backpack, index++));
            }
            bool filteredEmpty = column.Category != "all" && index == 0;
            column.Empty.gameObject.SetActive(filteredEmpty);
            if (filteredEmpty) column.Empty.text = "В разделе «" + RoaItemCategories.Label(column.Category) + "» пусто.";
            if (column.Category == "all")
            {
                int visible = Mathf.Max(MinSlots, Mathf.CeilToInt(Mathf.Max(index, 1) / (float)Columns) * Columns);
                for (int i = index; i < visible; i++) column.Cards.Add(BuildEmptyCard(column, i));
            }
            float rows = Mathf.Ceil(Mathf.Max(index, column.Category == "all" ? MinSlots : 0) / (float)Columns);
            column.Grid.sizeDelta = new Vector2(0f, Mathf.Max(270f, rows * (CardSize + CardGap) + 8f));
        }

        private GameObject BuildCard(Column column, Entry entry, bool backpack, int index)
        {
            int carryMax = backpack ? entry.Qty : CarryMax(entry);
            bool carryLimited = !backpack && carryMax < entry.Qty;
            bool carryBlocked = !backpack && carryMax <= 0;
            bool equipped = backpack && IsEquipped(entry);

            GameObject card = CardShell(column, "Item:" + entry.RuntimeId, index);
            var image = card.GetComponent<Image>();
            var outline = card.GetComponent<Outline>();
            outline.effectColor = equipped ? CardEquipped : (carryBlocked ? CardBlocked : CardBorder);
            if (carryBlocked) image.color = new Color(CardBg.r, CardBg.g, CardBg.b, 0.6f);
            var rect = (RectTransform)card.transform;

            // .inv-weight
            Text weight = Label("Weight", rect, 9, TextAnchor.UpperRight, CardWeight, FontStyle.Bold);
            Place(weight.rectTransform, 0.4f, 1f, 1f, 1f, new Vector2(0f, -16f), new Vector2(-5f, -3f));
            weight.text = (RoaItemData.Weight(entry.BaseId) * entry.Qty).ToString("0.0") + " кг";
            if (equipped)
            {
                Text tag = Label("Tag", rect, 8, TextAnchor.UpperLeft, CardEquipped);
                Place(tag.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(4f, -16f), new Vector2(0f, -3f));
                tag.text = "НАДЕТО";
            }
            else if (carryLimited)
            {
                Text tag = Label("Tag", rect, 8, TextAnchor.UpperLeft, new Color(1f, 0.6f, 0.33f, 1f));
                Place(tag.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(4f, -16f), new Vector2(0f, -3f));
                tag.text = carryBlocked ? "ТЯЖЕЛО" : "до " + carryMax;
            }

            // .inv-emoji
            RectTransform artRect = Child("Art", rect);
            artRect.anchorMin = artRect.anchorMax = new Vector2(0.5f, 1f);
            artRect.pivot = new Vector2(0.5f, 1f);
            artRect.anchoredPosition = new Vector2(0f, -16f);
            artRect.sizeDelta = new Vector2(36f, 36f);
            var art = artRect.gameObject.AddComponent<RawImage>();
            art.texture = RoaItemCategories.Art(entry.BaseId);
            art.raycastTarget = false;
            art.enabled = art.texture != null;
            if (carryBlocked) art.color = new Color(1f, 1f, 1f, 0.5f);

            // .inv-name
            Text name = Label("Name", rect, 9, TextAnchor.UpperCenter, CardName);
            Place(name.rectTransform, 0f, 0f, 1f, 1f, new Vector2(3f, 3f), new Vector2(-3f, -54f));
            name.horizontalOverflow = HorizontalWrapMode.Wrap;
            name.verticalOverflow = VerticalWrapMode.Truncate;
            name.text = ItemName(entry.BaseId);

            // .inv-count
            string category = RoaItemCategories.Category(entry.BaseId);
            if (entry.Qty > 1 || category == "ammo" || category == "materials" || entry.BaseId == "silver")
            {
                Text count = Label("Count", rect, 10, TextAnchor.LowerRight, CardWeight, FontStyle.Bold);
                Place(count.rectTransform, 0.5f, 0f, 1f, 0f, new Vector2(0f, 2f), new Vector2(-4f, 15f));
                count.text = entry.Qty.ToString();
            }

            var button = card.AddComponent<Button>();
            button.targetGraphic = image;
            Entry captured = entry;
            button.onClick.AddListener(() => OnCardClicked(captured, backpack));
            RoaItemPopups.Bind(card, entry.BaseId, carryLimited ? "можно унести: " + carryMax : null);
            return card;
        }

        private GameObject BuildEmptyCard(Column column, int index)
        {
            GameObject card = CardShell(column, "Empty:" + index, index);
            var image = card.GetComponent<Image>();
            image.color = new Color(CardBg.r, CardBg.g, CardBg.b, 0.58f);
            card.GetComponent<Outline>().effectColor = new Color(CardBorder.r, CardBorder.g, CardBorder.b, 0.3f);
            Text mark = Label("Mark", (RectTransform)card.transform, 16, TextAnchor.MiddleCenter, EmptyMark);
            Stretch(mark.rectTransform, 0f);
            mark.text = "·";
            return card;
        }

        private GameObject CardShell(Column column, string name, int index)
        {
            var card = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)card.transform;
            rect.SetParent(column.Grid, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            int col = index % Columns, row = index / Columns;
            rect.sizeDelta = new Vector2(CardSize, CardSize);
            rect.anchoredPosition = new Vector2(8f + col * (CardSize + CardGap), -8f - row * (CardSize + CardGap));
            var image = card.AddComponent<Image>();
            image.color = CardBg;
            var outline = card.AddComponent<Outline>();
            outline.effectDistance = new Vector2(1f, -1f);
            return card;
        }

        private void OnCardClicked(Entry entry, bool backpack)
        {
            // Web: стопка открывает панель количества (requestStorageTransfer); Shift+клик переносит всё сразу.
            bool all = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
            if (backpack)
            {
                if (IsProtected(entry)) { _status.text = "Этот предмет используется персонажем и остаётся в рюкзаке."; return; }
                if (all) Interaction.StorageDeposit(entry.RuntimeId, entry.Qty);
                else Interaction.StorageRequest(entry.RuntimeId, true, entry.Qty, entry.Qty);
            }
            else
            {
                int carryMax = CarryMax(entry);
                if (carryMax <= 0)
                {
                    _status.text = ItemName(entry.BaseId) + ": нет свободного веса. Свободно " + FreeWeight().ToString("0.0") + " кг.";
                    return;
                }
                if (all) Interaction.StorageWithdraw(entry.RuntimeId, carryMax);
                else Interaction.StorageRequest(entry.RuntimeId, false, entry.Qty, carryMax);
            }
            _refreshAt = Time.unscaledTime + 0.35f;
        }

        // ------------------------------------------------------------------ постройка

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("StorageCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 42;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;

            _root = new GameObject("StorageWindow", typeof(RectTransform));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            root.anchorMin = root.anchorMax = new Vector2(0.5f, 0.5f);
            root.sizeDelta = new Vector2(760f, 620f);
            var bg = _root.AddComponent<Image>();
            bg.color = PanelBg;
            var border = _root.AddComponent<Outline>();
            border.effectColor = PanelBorder;
            border.effectDistance = new Vector2(1f, -1f);

            // .panel-title + × (modal-close-x)
            _title = Label("Title", root, 12, TextAnchor.MiddleLeft, TitleInk, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -30f), new Vector2(-40f, -10f));
            Button close = UiButton(root, "×", out Text closeLabel, () => Interaction.LootClose());
            closeLabel.fontSize = 14;
            Place((RectTransform)close.transform, 1f, 1f, 1f, 1f, new Vector2(-34f, -32f), new Vector2(-10f, -10f));

            // .trade-hint
            Text hint = Label("Hint", root, 10, TextAnchor.UpperLeft, HintInk);
            Place(hint.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -58f), new Vector2(-12f, -34f));
            hint.horizontalOverflow = HorizontalWrapMode.Wrap;
            hint.text = "Если предметов много, появится выбор количества. Shift+клик переносит всю стопку сразу. Крышки, надетое и патроны текущего оружия остаются в рюкзаке.";

            // .storage-layout: две колонки.
            _backpack = BuildColumn(root, "Backpack", "Рюкзак", 0.5f, true);
            _box = BuildColumn(root, "Box", "Ящик", 0.5f, false);
            Place(_backpack.Root, 0f, 0f, 0.5f, 1f, new Vector2(12f, 78f), new Vector2(-5f, -62f));
            Place(_box.Root, 0.5f, 0f, 1f, 1f, new Vector2(5f, 78f), new Vector2(-12f, -62f));

            // .storage-actions-extra
            _putAll = UiButton(root, "Положить всё", out _putAllLabel, () => { Interaction.StorageTransferAll(true); _refreshAt = Time.unscaledTime + 0.4f; });
            _takeAll = UiButton(root, "Забрать всё", out _takeAllLabel, () => { Interaction.StorageTransferAll(false); _refreshAt = Time.unscaledTime + 0.4f; });
            Place((RectTransform)_putAll.transform, 0f, 0f, 0.5f, 0f, new Vector2(12f, 38f), new Vector2(-4f, 68f));
            Place((RectTransform)_takeAll.transform, 0.5f, 0f, 1f, 0f, new Vector2(4f, 38f), new Vector2(-12f, 68f));

            _status = Label("Status", root, 10, TextAnchor.MiddleLeft, StatusInk);
            Place(_status.rectTransform, 0f, 0f, 1f, 0f, new Vector2(12f, 10f), new Vector2(-12f, 32f));
        }

        private Column BuildColumn(RectTransform parent, string name, string caption, float width, bool backpack)
        {
            var column = new Column();
            column.Root = Child(name, parent);

            // .storage-title: имя + вес справа.
            column.Title = Label("Title", column.Root, 11, TextAnchor.MiddleLeft, ColumnTitle);
            column.Title.text = caption;
            Place(column.Title.rectTransform, 0f, 1f, 0.5f, 1f, new Vector2(0f, -16f), new Vector2(0f, 0f));
            column.Info = Label("Info", column.Root, 10, TextAnchor.MiddleRight, ColumnTitle);
            Place(column.Info.rectTransform, 0.5f, 1f, 1f, 1f, new Vector2(0f, -16f), new Vector2(0f, 0f));

            // .storage-sort-actions
            Button sort = UiButton(column.Root, backpack ? "Сортировать рюкзак" : "Сортировать ящик", out column.SortLabel, () =>
            {
                column.SortMode = column.SortMode == "type" ? "weight" : "type";
                _refreshAt = 0f;
            });
            column.SortLabel.fontSize = 9;
            Place((RectTransform)sort.transform, 0f, 1f, 0.62f, 1f, new Vector2(0f, -42f), new Vector2(0f, -20f));

            // .item-category-tabs — ряд мелких вкладок.
            column.Tabs = Child("Tabs", column.Root);
            Place(column.Tabs, 0f, 1f, 1f, 1f, new Vector2(0f, -70f), new Vector2(0f, -46f));
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
                var fitter = button.gameObject.AddComponent<LayoutElement>();
                fitter.preferredWidth = Mathf.Max(30f, tab.Label.Length * 6f + 12f);
                column.TabButtons[id] = button;
                column.TabLabels[id] = label;
            }

            // .storage-grid — прокручиваемая сетка 4×N.
            RectTransform viewport = Child("Viewport", column.Root);
            Place(viewport, 0f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(0f, -76f));
            var viewImage = viewport.gameObject.AddComponent<Image>();
            viewImage.color = GridBg;
            var viewBorder = viewport.gameObject.AddComponent<Outline>();
            viewBorder.effectColor = GridBorder;
            viewBorder.effectDistance = new Vector2(1f, -1f);
            viewport.gameObject.AddComponent<RectMask2D>();
            column.Grid = Child("Grid", viewport);
            column.Grid.anchorMin = new Vector2(0f, 1f);
            column.Grid.anchorMax = new Vector2(1f, 1f);
            column.Grid.pivot = new Vector2(0.5f, 1f);
            column.Grid.sizeDelta = new Vector2(0f, 270f);
            var scroll = viewport.gameObject.AddComponent<ScrollRect>();
            scroll.content = column.Grid;
            scroll.viewport = viewport;
            scroll.horizontal = false;
            scroll.scrollSensitivity = 30f;
            scroll.movementType = ScrollRect.MovementType.Clamped;

            column.Empty = Label("Empty", viewport, 10, TextAnchor.MiddleCenter, HintInk);
            Place(column.Empty.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -60f), new Vector2(-8f, -20f));
            column.Empty.gameObject.SetActive(false);
            return column;
        }

        // ------------------------------------------------------------------ утилиты

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
            label = Label("Label", (RectTransform)go.transform, 10, TextAnchor.MiddleCenter, BtnInk, FontStyle.Bold);
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
            text.font = RoaUiFont.Default;
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
