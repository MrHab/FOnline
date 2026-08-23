using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Панель выбора количества — web #quantity-side-panel
    /// (03_hud_minimap_inventory_progression.css:927/1282, openQuantityPanel в 07:33).
    /// Центрированная карточка 330px поверх затемнения: заголовок, подзаголовок,
    /// ряд «− [число] +», ползунок, «1 / 1/2 / Все», «ОК / Отмена».
    /// Состояние и подтверждение — RoaInteraction.Quantity*.
    /// </summary>
    public sealed class RoaQuantityCanvas : MonoBehaviour
    {
        public RoaInteraction Interaction;

        private static readonly Color Veil = new Color(0f, 0f, 0f, 0.38f);
        private static readonly Color PanelBg = new Color(0.051f, 0.063f, 0.063f, 0.97f);
        private static readonly Color PanelBorder = new Color(0.682f, 0.545f, 0.282f, 0.45f);
        private static readonly Color TitleInk = new Color(0.941f, 0.824f, 0.541f, 1f);       // #f0d28a
        private static readonly Color SubInk = new Color(0.557f, 0.627f, 0.49f, 1f);         // #8ea07d
        private static readonly Color BtnBg = new Color(0.165f, 0.141f, 0.098f, 1f);         // rgba(42,36,25)
        private static readonly Color BtnBorder = new Color(0.682f, 0.545f, 0.282f, 0.65f);
        private static readonly Color BtnInk = new Color(0.898f, 0.78f, 0.486f, 1f);         // #e5c77c
        private static readonly Color ValueBg = new Color(0.051f, 0.063f, 0.063f, 1f);
        private static readonly Color ValueInk = new Color(0.945f, 0.867f, 0.667f, 1f);      // #f1ddaa
        private static readonly Color SliderTrack = new Color(0.2f, 0.18f, 0.13f, 1f);
        private static readonly Color SliderFill = new Color(0.851f, 0.722f, 0.427f, 1f);    // #d9b86d

        private Canvas _canvas;
        private GameObject _root;
        private Text _title, _sub, _value;
        private Slider _slider;
        private bool _syncing;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        private void Update()
        {
            bool open = Interaction != null && Interaction.QuantityOpen;
            if (!open)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) _root.SetActive(true);
            if (Input.GetKeyDown(KeyCode.Escape)) { Interaction.QuantityCancel(); return; }
            if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter)) { Interaction.QuantityConfirm(); return; }

            _title.text = Interaction.QuantityTitle;
            _sub.text = Interaction.QuantitySub;
            _value.text = Interaction.QuantityValue.ToString();
            _syncing = true;
            _slider.minValue = 1f;
            _slider.maxValue = Mathf.Max(1, Interaction.QuantityMax);
            _slider.value = Interaction.QuantityValue;
            _syncing = false;
        }

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("QuantityCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 48; // над торговлей/хранилищем (42), под системными окнами
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;

            _root = new GameObject("QuantitySidePanel", typeof(RectTransform));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            Stretch(root, 0f);
            var veil = _root.AddComponent<Image>();
            veil.color = Veil; // box-shadow 0 0 0 9999px rgba(0,0,0,.38)
            var veilButton = _root.AddComponent<Button>();
            veilButton.transition = Selectable.Transition.None;
            veilButton.onClick.AddListener(() => Interaction.QuantityCancel());

            RectTransform panel = Child("Panel", root);
            panel.anchorMin = panel.anchorMax = new Vector2(0.5f, 0.5f);
            panel.sizeDelta = new Vector2(330f, 262f);
            var bg = panel.gameObject.AddComponent<Image>();
            bg.color = PanelBg;
            var border = panel.gameObject.AddComponent<Outline>();
            border.effectColor = PanelBorder;
            border.effectDistance = new Vector2(1f, -1f);

            float y = -12f;
            _title = Label("Title", panel, 13, TextAnchor.UpperLeft, TitleInk, FontStyle.Bold);
            _title.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_title.rectTransform, 12f, y - 18f, -12f, y);
            y -= 24f;
            _sub = Label("Sub", panel, 11, TextAnchor.UpperLeft, SubInk);
            _sub.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_sub.rectTransform, 12f, y - 30f, -12f, y);
            y -= 38f;

            // .qty-row: 38px | 1fr | 38px
            UiButton(panel, "−", 12f, y - 38f, 50f, y, () => Interaction.QuantityValue -= 1);
            RectTransform valueRect = Child("Value", panel);
            Place(valueRect, 58f, y - 38f, -58f, y);
            var valueBg = valueRect.gameObject.AddComponent<Image>();
            valueBg.color = ValueBg;
            var valueBorder = valueRect.gameObject.AddComponent<Outline>();
            valueBorder.effectColor = new Color(PanelBorder.r, PanelBorder.g, PanelBorder.b, 0.45f);
            valueBorder.effectDistance = new Vector2(1f, -1f);
            _value = Label("Text", valueRect, 18, TextAnchor.MiddleCenter, ValueInk, FontStyle.Bold);
            Stretch(_value.rectTransform, 2f);
            UiButton(panel, "+", -50f, y - 38f, -12f, y, () => Interaction.QuantityValue += 1, true);
            y -= 46f;

            // #qty-range
            RectTransform sliderRect = Child("Range", panel);
            Place(sliderRect, 12f, y - 18f, -12f, y);
            _slider = sliderRect.gameObject.AddComponent<Slider>();
            _slider.wholeNumbers = true;
            RectTransform track = Child("Track", sliderRect);
            Place(track, 0f, -11f, 0f, -7f);
            var trackImage = track.gameObject.AddComponent<Image>();
            trackImage.color = SliderTrack;
            RectTransform fillArea = Child("FillArea", sliderRect);
            Place(fillArea, 0f, -11f, 0f, -7f);
            RectTransform fill = Child("Fill", fillArea);
            Stretch(fill, 0f);
            var fillImage = fill.gameObject.AddComponent<Image>();
            fillImage.color = SliderFill;
            RectTransform handleArea = Child("HandleArea", sliderRect);
            Place(handleArea, 6f, -18f, -6f, 0f);
            RectTransform handle = Child("Handle", handleArea);
            handle.sizeDelta = new Vector2(14f, 18f);
            var handleImage = handle.gameObject.AddComponent<Image>();
            handleImage.color = SliderFill;
            _slider.fillRect = fill;
            _slider.handleRect = handle;
            _slider.targetGraphic = handleImage;
            _slider.direction = Slider.Direction.LeftToRight;
            _slider.onValueChanged.AddListener(v => { if (!_syncing) Interaction.QuantityValue = Mathf.RoundToInt(v); });
            y -= 28f;

            // .qty-max-row: 1 | 1/2 | Все
            float third = (330f - 24f - 12f) / 3f;
            UiButton(panel, "1", 12f, y - 34f, 12f + third, y, () => Interaction.QuantityValue = 1, false, true);
            UiButton(panel, "1/2", 18f + third, y - 34f, 18f + third * 2f, y, () => Interaction.QuantityValue = Mathf.CeilToInt(Interaction.QuantityMax / 2f), false, true);
            UiButton(panel, "Все", 24f + third * 2f, y - 34f, 24f + third * 3f, y, () => Interaction.QuantityValue = Interaction.QuantityMax, false, true);
            y -= 44f;

            // .qty-actions: ОК | Отмена
            float half = (330f - 24f - 8f) / 2f;
            UiButton(panel, "ОК", 12f, y - 32f, 12f + half, y, () => Interaction.QuantityConfirm(), false, true);
            UiButton(panel, "Отмена", 20f + half, y - 32f, 20f + half * 2f, y, () => Interaction.QuantityCancel(), false, true);
        }

        private static Button UiButton(RectTransform parent, string caption, float left, float bottom, float right, float top,
                                       System.Action onClick, bool rightAnchored = false, bool absolute = false)
        {
            var go = new GameObject("Btn:" + caption, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            if (absolute)
            {
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0f, 1f);
                rect.anchoredPosition = new Vector2(left, top);
                rect.sizeDelta = new Vector2(right - left, top - bottom);
            }
            else if (rightAnchored)
            {
                rect.anchorMin = rect.anchorMax = new Vector2(1f, 1f);
                rect.pivot = new Vector2(1f, 1f);
                rect.anchoredPosition = new Vector2(right, top);
                rect.sizeDelta = new Vector2(right - left, top - bottom);
            }
            else
            {
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0f, 1f);
                rect.anchoredPosition = new Vector2(left, top);
                rect.sizeDelta = new Vector2(right - left, top - bottom);
            }
            var image = go.AddComponent<Image>();
            image.color = BtnBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = BtnBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            Text label = Label("Label", rect, 12, TextAnchor.MiddleCenter, BtnInk, FontStyle.Bold);
            Stretch(label.rectTransform, 2f);
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

        /// <summary>Привязка к верхней кромке: left/right — отступы от краёв, bottomY/topY — смещения от верха (отрицательные).</summary>
        private static void Place(RectTransform rect, float left, float bottomY, float right, float topY)
        {
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.offsetMin = new Vector2(left, bottomY);
            rect.offsetMax = new Vector2(right, topY);
        }

        private static void Stretch(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset);
            rect.offsetMax = new Vector2(-inset, -inset);
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
