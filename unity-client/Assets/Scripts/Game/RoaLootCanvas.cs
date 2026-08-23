using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Лут и хранилище в структуре web-клиента.
    ///
    /// Лут (#loot-window): заголовок — что обыскиваем, список предметов, клик
    /// берёт один, «Забрать всё» (Space). Запертый контейнер показывает кнопки
    /// взлома вместо списка.
    ///
    /// Хранилище (#storage-window): две колонки «Рюкзак» и «Ящик», клик по
    /// предмету переносит один (web: «на телефоне нажмите предмет, на ПК можно
    /// перетаскивать»), внизу «Положить всё» и «Забрать всё».
    ///
    /// Логика и серверные запросы — в RoaInteraction; это окно только рисует.
    /// </summary>
    public sealed class RoaLootCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.075f, 0.071f, 0.055f, 0.97f);
        private static readonly Color PanelBorder = new Color(0.82f, 0.694f, 0.404f, 0.58f);
        private static readonly Color ColumnBg = new Color(0f, 0f, 0f, 0.32f);
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color InkDim = new Color(0.937f, 0.867f, 0.678f, 0.55f);
        private static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);
        private static readonly Color RowBg = new Color(0.13f, 0.12f, 0.09f, 0.9f);
        private static readonly Color ActionBg = new Color(0.16f, 0.28f, 0.12f, 0.95f);

        public RoaInteraction Interaction;

        private Canvas _canvas;
        private GameObject _root;
        private RectTransform _panel;
        private Text _title;
        private Text _hint;
        private Text _status;
        private RectTransform _leftColumn;
        private RectTransform _rightColumn;
        private Text _leftTitle;
        private Text _rightTitle;
        private RectTransform _leftList;
        private RectTransform _rightList;
        private Button _primaryButton;
        private Text _primaryLabel;
        private Button _secondaryButton;
        private Text _secondaryLabel;
        private readonly List<GameObject> _rows = new List<GameObject>();
        private float _refreshAt;
        private bool _storageMode;

        private void Update()
        {
            bool open = Interaction != null && Interaction.LootOpen; // хранилище рисует RoaStorageCanvas

            if (!open)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }

            EnsureBuilt();
            bool storage = Interaction.StorageOpen;
            if (!_root.activeSelf || storage != _storageMode)
            {
                _storageMode = storage;
                ApplyMode();
                _root.SetActive(true);
                _refreshAt = 0f;
            }

            // Space — «Забрать всё», как в web.
            if (!_storageMode && Input.GetKeyDown(KeyCode.Space)) Interaction.TakeAllLoot();

            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + 0.3f;
                Refresh();
            }
        }

        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;

            var canvasGo = new GameObject("LootCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 42;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            _root = new GameObject("LootWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            rootRect.anchorMin = Vector2.zero;
            rootRect.anchorMax = Vector2.one;
            rootRect.offsetMin = Vector2.zero;
            rootRect.offsetMax = Vector2.zero;
            var dim = _root.AddComponent<Image>();
            dim.color = new Color(0f, 0f, 0f, 0.46f);

            _panel = Child("Panel", rootRect);
            _panel.anchorMin = _panel.anchorMax = new Vector2(0.5f, 0.5f);
            _panel.pivot = new Vector2(0.5f, 0.5f);
            var back = _panel.gameObject.AddComponent<Image>();
            back.color = PanelBg;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            _title = Label("Title", _panel, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -44f), new Vector2(-56f, -8f));

            Button close = TextButton("Close", _panel, "×", 24, out Text closeText);
            var closeRect = (RectTransform)close.transform;
            closeRect.anchorMin = closeRect.anchorMax = new Vector2(1f, 1f);
            closeRect.pivot = new Vector2(1f, 1f);
            closeRect.anchoredPosition = new Vector2(-8f, -8f);
            closeRect.sizeDelta = new Vector2(36f, 32f);
            closeText.color = Accent;
            close.onClick.AddListener(() => Interaction.LootClose());

            _hint = Label("Hint", _panel, 12, TextAnchor.MiddleLeft, InkDim);
            Place(_hint.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -68f), new Vector2(-16f, -46f));

            _leftColumn = BuildColumn("Left", out _leftTitle, out _leftList);
            _rightColumn = BuildColumn("Right", out _rightTitle, out _rightList);

            _primaryButton = TextButton("Primary", _panel, "", 14, out _primaryLabel);
            _primaryButton.GetComponent<Image>().color = ActionBg;
            _primaryLabel.color = Accent;

            _secondaryButton = TextButton("Secondary", _panel, "", 14, out _secondaryLabel);
            _secondaryButton.GetComponent<Image>().color = ActionBg;
            _secondaryLabel.color = Accent;

            _status = Label("Status", _panel, 12, TextAnchor.MiddleCenter, InkDim);
            Place(_status.rectTransform, 0f, 0f, 1f, 0f, new Vector2(16f, 6f), new Vector2(-16f, 28f));

            _root.SetActive(false);
        }

        private RectTransform BuildColumn(string name, out Text title, out RectTransform list)
        {
            RectTransform column = Child("Column:" + name, _panel);
            var back = column.gameObject.AddComponent<Image>();
            back.color = ColumnBg;
            title = Label("Title", column, 14, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -28f), new Vector2(-8f, -4f));

            RectTransform scrollArea = Child("Scroll", column);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(4f, 4f), new Vector2(-4f, -32f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scrollArea.gameObject.AddComponent<RectMask2D>();

            list = Child("List", scrollArea);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero; // иначе контейнер на 100 px шире области прокрутки
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 3f;
            layout.padding = new RectOffset(4, 4, 4, 4);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            var fitter = list.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;
            return column;
        }

        /// <summary>Раскладка окна: лут — одна колонка, хранилище — две.</summary>
        private void ApplyMode()
        {
            if (_storageMode)
            {
                _panel.sizeDelta = new Vector2(1000f, 700f);
                Place(_leftColumn, 0.02f, 0f, 0.49f, 1f, new Vector2(0f, 74f), new Vector2(0f, -72f));
                Place(_rightColumn, 0.51f, 0f, 0.98f, 1f, new Vector2(0f, 74f), new Vector2(0f, -72f));
                _rightColumn.gameObject.SetActive(true);
                _leftTitle.text = "Рюкзак";
                _rightTitle.text = "Ящик";
                _hint.text = "Клик по предмету переносит один. Заряженное оружие перед переносом нужно разрядить.";

                Place((RectTransform)_primaryButton.transform, 0.02f, 0f, 0.49f, 0f, new Vector2(0f, 34f), new Vector2(0f, 68f));
                Place((RectTransform)_secondaryButton.transform, 0.51f, 0f, 0.98f, 0f, new Vector2(0f, 34f), new Vector2(0f, 68f));
                _primaryLabel.text = "Положить всё";
                _secondaryLabel.text = "Забрать всё";
                _primaryButton.onClick.RemoveAllListeners();
                _secondaryButton.onClick.RemoveAllListeners();
                _primaryButton.onClick.AddListener(() => { Interaction.StorageTransferAll(true); _refreshAt = Time.unscaledTime + 0.4f; });
                _secondaryButton.onClick.AddListener(() => { Interaction.StorageTransferAll(false); _refreshAt = Time.unscaledTime + 0.4f; });
                _secondaryButton.gameObject.SetActive(true);
            }
            else
            {
                _panel.sizeDelta = new Vector2(620f, 560f);
                Place(_leftColumn, 0.03f, 0f, 0.97f, 1f, new Vector2(0f, 74f), new Vector2(0f, -72f));
                _rightColumn.gameObject.SetActive(false);
                _leftTitle.text = "Содержимое";
                _hint.text = "Клик — взять один предмет. Space — забрать всё.";

                Place((RectTransform)_primaryButton.transform, 0.25f, 0f, 0.75f, 0f, new Vector2(0f, 34f), new Vector2(0f, 68f));
                _primaryLabel.text = "Забрать всё  (Space)";
                _primaryButton.onClick.RemoveAllListeners();
                _primaryButton.onClick.AddListener(() => { Interaction.TakeAllLoot(); _refreshAt = Time.unscaledTime + 0.4f; });
                _secondaryButton.gameObject.SetActive(false);
            }
        }

        // ------------------------------------------------------------------

        private void Refresh()
        {
            _title.text = Interaction.LootTitle;
            _status.text = Interaction.LootStatus;

            foreach (GameObject row in _rows) Destroy(row);
            _rows.Clear();

            if (_storageMode)
            {
                FillList(_leftList, Interaction.InventoryRows, true, id => Interaction.StorageDeposit(id));
                FillList(_rightList, Interaction.StorageRows, false, id => Interaction.StorageWithdraw(id));
                return;
            }

            bool locked = Interaction.LootLocked;
            bool terminal = Interaction.LootTerminalLocked;

            if (locked || terminal)
            {
                AddInfoRow(_leftList, terminal ? "Доступ защищён терминалом." : "Контейнер заперт.");
                if (locked) AddActionRow(_leftList, "Взломать замок", () => Interaction.LootSecurity("pickLock"));
                if (terminal) AddActionRow(_leftList, "Взломать терминал", () => Interaction.LootSecurity("hackTerminal"));
                _primaryButton.interactable = false;
                return;
            }

            _primaryButton.interactable = true;
            JArray loot = Interaction.LootRows;
            bool any = false;
            if (loot != null)
            {
                foreach (JToken row in loot)
                {
                    string id = row["id"]?.ToString();
                    int qty = row["qty"]?.ToObject<int>() ?? 0;
                    if (string.IsNullOrEmpty(id) || qty <= 0) continue;
                    any = true;
                    string captured = id;
                    AddItemRow(_leftList, RoaItemData.Name(RoaInteraction.TradeBaseId(id)) + "   —   x" + qty,
                        () => Interaction.LootRequest(captured, qty, qty));
                    RoaItemPopups.Bind(_rows[_rows.Count - 1], RoaInteraction.TradeBaseId(id));
                }
            }
            if (!any) AddInfoRow(_leftList, "Пусто.");
        }

        private void FillList(RectTransform list, JArray rows, bool skipCaps, System.Action<string> onClick)
        {
            bool any = false;
            if (rows != null)
            {
                foreach (JToken row in rows)
                {
                    string runtimeId = row["id"]?.ToString();
                    string baseId = RoaInteraction.TradeBaseId(runtimeId);
                    int qty = row["qty"]?.ToObject<int>() ?? 0;
                    if (string.IsNullOrEmpty(runtimeId) || qty <= 0) continue;
                    if (skipCaps && (baseId == "silver" || baseId == "fists")) continue;
                    any = true;
                    string captured = runtimeId;
                    AddItemRow(list, RoaItemData.Name(baseId) + "   —   x" + qty
                        + " · " + (RoaItemData.Weight(baseId) * qty).ToString("0.0") + " кг",
                        () => onClick(captured));
                }
            }
            if (!any) AddInfoRow(list, skipCaps ? "Нет предметов для хранения." : "Ящик пуст.");
        }

        private void AddItemRow(RectTransform list, string text, System.Action onClick)
        {
            GameObject row = Row(list, 30f, true);
            Text label = Label("Name", (RectTransform)row.transform, 12, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(label.rectTransform, 0f, 0f, 1f, 1f, new Vector2(6f, 0f), new Vector2(-6f, 0f));
            label.text = text;
            row.GetComponent<Button>().onClick.AddListener(() => { onClick(); _refreshAt = Time.unscaledTime + 0.35f; });
        }

        private void AddActionRow(RectTransform list, string caption, System.Action onClick)
        {
            GameObject row = Row(list, 34f, true);
            row.GetComponent<Image>().color = ActionBg;
            Text label = Label("Name", (RectTransform)row.transform, 13, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            Place(label.rectTransform, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            label.text = caption;
            row.GetComponent<Button>().onClick.AddListener(() => { onClick(); _refreshAt = Time.unscaledTime + 0.4f; });
        }

        private void AddInfoRow(RectTransform list, string text)
        {
            GameObject row = Row(list, 30f, false);
            Text label = Label("Text", (RectTransform)row.transform, 12, TextAnchor.MiddleLeft, InkDim);
            Place(label.rectTransform, 0f, 0f, 1f, 1f, new Vector2(6f, 0f), new Vector2(-6f, 0f));
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.text = text;
        }

        private GameObject Row(RectTransform list, float height, bool withButton)
        {
            var row = new GameObject("Row", typeof(RectTransform));
            row.transform.SetParent(list, false);
            var layout = row.AddComponent<LayoutElement>();
            layout.preferredHeight = height;
            var back = row.AddComponent<Image>();
            back.color = RowBg;
            if (withButton)
            {
                var button = row.AddComponent<Button>();
                button.targetGraphic = back;
            }
            _rows.Add(row);
            return row;
        }

        // ------------------------------------------------------------------

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
        }

        private static void Place(RectTransform rect, float minX, float minY, float maxX, float maxY,
                                  Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = new Vector2(minX, minY);
            rect.anchorMax = new Vector2(maxX, maxY);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }

        private static Text Label(string name, RectTransform parent, int size, TextAnchor anchor,
                                  Color color, FontStyle style = FontStyle.Normal)
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

        private static Button TextButton(string name, RectTransform parent, string caption, int size, out Text label)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = new Color(0f, 0f, 0f, 0.3f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, Ink);
            label.rectTransform.anchorMin = Vector2.zero;
            label.rectTransform.anchorMax = Vector2.one;
            label.rectTransform.offsetMin = new Vector2(2f, 2f);
            label.rectTransform.offsetMax = new Vector2(-2f, -2f);
            label.text = caption;
            return button;
        }
    }
}
