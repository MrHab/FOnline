using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Всплывающая подсказка предмета и контекстное меню — web #tooltip
    /// (showTooltip 03c:882, 01:989) и #item-context-menu (showItemContextMenu
    /// 03d:229, .ctx-option 01:1797). Один канвас поверх всех окон: подсказка
    /// следует за курсором (+14px, прижата к краям), меню открывается у курсора
    /// и закрывается кликом мимо или Esc.
    /// </summary>
    public sealed class RoaItemPopups : MonoBehaviour
    {
        public static RoaItemPopups Instance { get; private set; }

        private static readonly Color TipBg = new Color(0.035f, 0.047f, 0.047f, 0.96f);
        private static readonly Color TipBorder = new Color(0.702f, 0.561f, 0.294f, 0.55f);
        private static readonly Color TipName = new Color(0.941f, 0.824f, 0.541f, 1f);    // #f0d28a
        private static readonly Color TipDesc = new Color(0.682f, 0.729f, 0.573f, 1f);    // #aeba92
        private static readonly Color TipStat = new Color(0.498f, 0.702f, 0.741f, 1f);    // #7fb3bd
        private static readonly Color MenuBg = new Color(0.051f, 0.063f, 0.063f, 0.97f);
        private static readonly Color MenuBorder = new Color(0.682f, 0.545f, 0.282f, 0.45f);
        private static readonly Color OptionInk = new Color(0.906f, 0.835f, 0.682f, 1f);  // #e7d5ae
        private static readonly Color OptionHover = new Color(0.682f, 0.545f, 0.282f, 0.22f);

        private const float TipWidth = 280f;

        private Canvas _canvas;
        private RectTransform _canvasRect;
        private RectTransform _tip;
        private Text _tipName, _tipDesc, _tipStat;
        private RectTransform _menu;
        private readonly List<GameObject> _options = new List<GameObject>();
        private bool _menuOpenedThisFrame;

        public sealed class Option
        {
            public string Label;
            public System.Action Action;
            public bool Disabled;
            public Option(string label, System.Action action, bool disabled = false) { Label = label; Action = action; Disabled = disabled; }
        }

        private void Awake() { Instance = this; }
        private void OnDestroy() { if (Instance == this) Instance = null; }

        private void Update()
        {
            if (_tip != null && _tip.gameObject.activeSelf) PositionAtCursor(_tip, 14f);
            if (_menu != null && _menu.gameObject.activeSelf)
            {
                if (Input.GetKeyDown(KeyCode.Escape)) HideMenu();
                else if (!_menuOpenedThisFrame && (Input.GetMouseButtonDown(0) || Input.GetMouseButtonDown(1))
                         && !RectTransformUtility.RectangleContainsScreenPoint(_menu, Input.mousePosition))
                    HideMenu();
            }
            _menuOpenedThisFrame = false;
        }

        // ------------------------------------------------------------------ подсказка

        /// <summary>Подсказка предмета по id (gameTooltipItem web); extraStat дописывается через « · ».</summary>
        public void ShowItem(string itemOrRuntimeId, string extraStat = null)
        {
            RoaItemInfo.Row row = RoaItemInfo.Get(itemOrRuntimeId);
            string name = RoaItemData.Name(RoaArmorData.BaseId(itemOrRuntimeId));
            if (string.IsNullOrEmpty(name)) { RoaWeaponData.Weapon w = RoaWeaponData.Get(RoaArmorData.BaseId(itemOrRuntimeId)); name = w != null ? w.Name : itemOrRuntimeId; }
            string stat = row != null ? row.Stat : string.Empty;
            if (!string.IsNullOrEmpty(extraStat)) stat = string.IsNullOrEmpty(stat) ? extraStat : stat + " · " + extraStat;
            Show(name, row != null ? row.Desc : string.Empty, stat);
        }

        public void Show(string name, string desc, string stat)
        {
            EnsureBuilt();
            _tipName.text = name ?? string.Empty;
            _tipDesc.text = desc ?? string.Empty;
            _tipDesc.gameObject.SetActive(!string.IsNullOrEmpty(desc));
            _tipStat.text = stat ?? string.Empty;
            _tipStat.gameObject.SetActive(!string.IsNullOrEmpty(stat));
            _tip.gameObject.SetActive(true);
            LayoutRebuilder.ForceRebuildLayoutImmediate(_tip);
            PositionAtCursor(_tip, 14f);
        }

        public void Hide()
        {
            if (_tip != null) _tip.gameObject.SetActive(false);
        }

        /// <summary>Навесить показ подсказки на карточку (mouseenter/mouseleave web).</summary>
        public static void Bind(GameObject card, string itemOrRuntimeId, string extraStat = null)
        {
            if (card == null) return;
            var trigger = card.GetComponent<EventTrigger>() ?? card.AddComponent<EventTrigger>();
            var enter = new EventTrigger.Entry { eventID = EventTriggerType.PointerEnter };
            enter.callback.AddListener(_ => { if (Instance != null) Instance.ShowItem(itemOrRuntimeId, extraStat); });
            var exit = new EventTrigger.Entry { eventID = EventTriggerType.PointerExit };
            exit.callback.AddListener(_ => { if (Instance != null) Instance.Hide(); });
            trigger.triggers.Add(enter);
            trigger.triggers.Add(exit);
        }

        /// <summary>Подсказка с произвольным текстом (dataset.gameHint web).</summary>
        public static void BindHint(GameObject target, string title, string hint)
        {
            if (target == null) return;
            var trigger = target.GetComponent<EventTrigger>() ?? target.AddComponent<EventTrigger>();
            var enter = new EventTrigger.Entry { eventID = EventTriggerType.PointerEnter };
            enter.callback.AddListener(_ => { if (Instance != null) Instance.Show(title, hint, null); });
            var exit = new EventTrigger.Entry { eventID = EventTriggerType.PointerExit };
            exit.callback.AddListener(_ => { if (Instance != null) Instance.Hide(); });
            trigger.triggers.Add(enter);
            trigger.triggers.Add(exit);
        }

        // ------------------------------------------------------------------ контекстное меню

        public bool MenuOpen { get { return _menu != null && _menu.gameObject.activeSelf; } }

        public void ShowMenu(List<Option> options)
        {
            EnsureBuilt();
            Hide();
            foreach (GameObject go in _options) Destroy(go);
            _options.Clear();
            if (options == null || options.Count == 0) options = new List<Option> { new Option("Нет действий", null, true) };
            float y = -5f;
            foreach (Option option in options)
            {
                var go = new GameObject("Ctx:" + option.Label, typeof(RectTransform));
                var rect = (RectTransform)go.transform;
                rect.SetParent(_menu, false);
                rect.anchorMin = new Vector2(0f, 1f);
                rect.anchorMax = new Vector2(1f, 1f);
                rect.pivot = new Vector2(0.5f, 1f);
                rect.offsetMin = new Vector2(5f, y - 28f);
                rect.offsetMax = new Vector2(-5f, y);
                var image = go.AddComponent<Image>();
                image.color = new Color(0f, 0f, 0f, 0f);
                Text label = Label("Label", rect, 12, TextAnchor.MiddleLeft, option.Disabled ? new Color(OptionInk.r, OptionInk.g, OptionInk.b, 0.45f) : OptionInk);
                label.rectTransform.anchorMin = Vector2.zero;
                label.rectTransform.anchorMax = Vector2.one;
                label.rectTransform.offsetMin = new Vector2(9f, 0f);
                label.rectTransform.offsetMax = new Vector2(-9f, 0f);
                label.text = option.Label;
                if (!option.Disabled)
                {
                    var button = go.AddComponent<Button>();
                    button.targetGraphic = image;
                    var colors = button.colors;
                    colors.normalColor = new Color(0f, 0f, 0f, 0f);
                    colors.highlightedColor = OptionHover;
                    colors.pressedColor = OptionHover;
                    colors.selectedColor = new Color(0f, 0f, 0f, 0f);
                    button.colors = colors;
                    System.Action action = option.Action;
                    button.onClick.AddListener(() => { HideMenu(); action?.Invoke(); });
                }
                _options.Add(go);
                y -= 28f;
            }
            _menu.sizeDelta = new Vector2(210f, -y + 5f);
            _menu.gameObject.SetActive(true);
            _menuOpenedThisFrame = true;
            PositionAtCursor(_menu, 2f);
        }

        public void HideMenu()
        {
            if (_menu != null) _menu.gameObject.SetActive(false);
        }

        /// <summary>Правый клик по карточке открывает меню (contextmenu web).</summary>
        public static void BindMenu(GameObject card, System.Func<List<Option>> build)
        {
            if (card == null) return;
            var trigger = card.GetComponent<EventTrigger>() ?? card.AddComponent<EventTrigger>();
            var click = new EventTrigger.Entry { eventID = EventTriggerType.PointerClick };
            click.callback.AddListener(data =>
            {
                var pointer = data as PointerEventData;
                if (pointer == null || pointer.button != PointerEventData.InputButton.Right || Instance == null) return;
                Instance.ShowMenu(build());
            });
            trigger.triggers.Add(click);
        }

        // ------------------------------------------------------------------ постройка

        private void PositionAtCursor(RectTransform rect, float pad)
        {
            Vector2 local;
            RectTransformUtility.ScreenPointToLocalPointInRectangle(_canvasRect, Input.mousePosition, null, out local);
            Vector2 size = rect.rect.size;
            Vector2 half = _canvasRect.rect.size * 0.5f;
            float edge = 10f;
            float x = Mathf.Clamp(local.x + pad, -half.x + edge, half.x - size.x - edge);
            float y = Mathf.Clamp(local.y - pad, -half.y + size.y + edge, half.y - edge);
            rect.anchoredPosition = new Vector2(x, y);
        }

        private void EnsureBuilt()
        {
            if (_tip != null) return;
            var canvasGo = new GameObject("ItemPopupsCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 58; // над окнами (42–48), под системными (60+)
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;
            _canvasRect = (RectTransform)canvasGo.transform;

            // #tooltip: max-width 280, padding 9/10, pointer-events none.
            _tip = Child("Tooltip", _canvasRect);
            _tip.anchorMin = _tip.anchorMax = new Vector2(0.5f, 0.5f);
            _tip.pivot = new Vector2(0f, 1f);
            _tip.sizeDelta = new Vector2(TipWidth, 60f);
            var tipBg = _tip.gameObject.AddComponent<Image>();
            tipBg.color = TipBg;
            tipBg.raycastTarget = false;
            var tipBorder = _tip.gameObject.AddComponent<Outline>();
            tipBorder.effectColor = TipBorder;
            tipBorder.effectDistance = new Vector2(1f, -1f);
            var layout = _tip.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.padding = new RectOffset(10, 10, 9, 9);
            layout.spacing = 4f;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = false;
            layout.childControlWidth = true;
            layout.childControlHeight = true;
            var fitter = _tip.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            _tipName = Label("Name", _tip, 12, TextAnchor.UpperLeft, TipName, FontStyle.Bold);
            _tipDesc = Label("Desc", _tip, 11, TextAnchor.UpperLeft, TipDesc);
            _tipStat = Label("Stat", _tip, 11, TextAnchor.UpperLeft, TipStat);
            foreach (Text t in new[] { _tipName, _tipDesc, _tipStat })
            {
                t.horizontalOverflow = HorizontalWrapMode.Wrap;
                t.verticalOverflow = VerticalWrapMode.Overflow;
            }
            _tip.gameObject.SetActive(false);

            // #item-context-menu: min-width 150, padding 5.
            _menu = Child("ContextMenu", _canvasRect);
            _menu.anchorMin = _menu.anchorMax = new Vector2(0.5f, 0.5f);
            _menu.pivot = new Vector2(0f, 1f);
            _menu.sizeDelta = new Vector2(210f, 40f);
            var menuBg = _menu.gameObject.AddComponent<Image>();
            menuBg.color = MenuBg;
            var menuBorder = _menu.gameObject.AddComponent<Outline>();
            menuBorder.effectColor = MenuBorder;
            menuBorder.effectDistance = new Vector2(1f, -1f);
            _menu.gameObject.SetActive(false);
        }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
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
            return text;
        }
    }
}
