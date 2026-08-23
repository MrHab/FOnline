using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Экран загрузки локации — web #location-loading-screen
    /// (15_location_loading_screen.css, showLocationLoading в 02c:394).
    /// Полноэкранная тёмная пелена и карточка 520px: кикер «ВХОД В ИГРУ» /
    /// «ПЕРЕХОД МЕЖДУ ЛОКАЦИЯМИ», крупное имя локации, подзаголовок, полоса
    /// прогресса, текущий шаг и подсказка. Состояние — фасад RoaGameBootstrap.Loading*.
    /// </summary>
    public sealed class RoaLoadingCanvas : MonoBehaviour
    {
        public RoaGameBootstrap Bootstrap;

        private static readonly Color VeilLocation = new Color(0.031f, 0.024f, 0.016f, 0.9f);
        private static readonly Color VeilStartup = new Color(0.031f, 0.024f, 0.016f, 1f);
        private static readonly Color CardBg = new Color(0.16f, 0.125f, 0.094f, 0.98f);          // градиент 83,59,36 → 17,16,14
        private static readonly Color CardBgDark = new Color(0.075f, 0.067f, 0.055f, 0.98f);
        private static readonly Color CardBorder = new Color(0.914f, 0.729f, 0.408f, 0.34f);     // rgba(233,186,104,.34)
        private static readonly Color Kicker = new Color(0.98f, 0.804f, 0.467f, 0.72f);
        private static readonly Color Title = new Color(0.941f, 0.851f, 0.635f, 1f);             // #f0d9a2
        private static readonly Color Subtitle = new Color(0.925f, 0.863f, 0.69f, 0.86f);
        private static readonly Color BarBg = new Color(0.039f, 0.031f, 0.024f, 1f);
        private static readonly Color BarBorder = new Color(0.961f, 0.8f, 0.494f, 0.28f);
        private static readonly Color BarFill = new Color(0.788f, 0.525f, 0.22f, 1f);            // #c98638
        private static readonly Color BarFillTip = new Color(0.941f, 0.753f, 0.424f, 1f);        // #f0c06c
        private static readonly Color Step = new Color(0.961f, 0.851f, 0.627f, 0.82f);
        private static readonly Color Hint = new Color(0.827f, 0.733f, 0.537f, 0.58f);
        private static readonly Color Rivet = new Color(0.306f, 0.224f, 0.149f, 1f);

        private Canvas _canvas;
        private GameObject _root;
        private Image _veil, _card;
        private Text _kicker, _title, _subtitle, _step, _hint;
        private RectTransform _barFill;
        private Image _barTip;
        private float _shownProgress;

        private void Update()
        {
            bool visible = Bootstrap != null && Bootstrap.LoadingVisible;
            if (!visible)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) { _root.SetActive(true); _shownProgress = 0f; }

            _veil.color = Bootstrap.LoadingStartup ? VeilStartup : VeilLocation;
            _kicker.text = Bootstrap.LoadingKicker.ToUpperInvariant();
            _title.text = Bootstrap.LoadingTitle;
            _subtitle.text = Bootstrap.LoadingSubtitle;
            _step.text = Bootstrap.LoadingStep;
            _hint.text = Bootstrap.LoadingHint;
            // transition: width 170ms — плавное догоняние.
            _shownProgress = Mathf.MoveTowards(_shownProgress, Mathf.Clamp01(Bootstrap.LoadingProgress), Time.unscaledDeltaTime / 0.17f);
            _barFill.anchorMax = new Vector2(_shownProgress, 1f);
        }

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("LoadingCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 70; // z-index 9999 — выше всех окон
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            _root = new GameObject("LocationLoadingScreen", typeof(RectTransform));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            Stretch(root, 0f);
            _veil = _root.AddComponent<Image>();
            _veil.color = VeilLocation;
            _veil.raycastTarget = true; // pointer-events: all — блокирует клики по миру

            // .location-loading-card 520×~240 по центру.
            RectTransform card = Child("Card", root);
            card.anchorMin = card.anchorMax = new Vector2(0.5f, 0.5f);
            card.sizeDelta = new Vector2(520f, 250f);
            _card = card.gameObject.AddComponent<Image>();
            _card.color = CardBg;
            var border = card.gameObject.AddComponent<Outline>();
            border.effectColor = CardBorder;
            border.effectDistance = new Vector2(2f, -2f);
            // Нижняя тёмная половина градиента.
            RectTransform lower = Child("Lower", card);
            Place(lower, 0f, 0f, 1f, 0.55f, Vector2.zero, Vector2.zero);
            var lowerImage = lower.gameObject.AddComponent<Image>();
            lowerImage.color = CardBgDark;
            lowerImage.raycastTarget = false;
            // Заклёпки ::before/::after.
            foreach (float x in new[] { 15f, -15f })
            {
                RectTransform rivet = Child("Rivet", card);
                rivet.anchorMin = rivet.anchorMax = new Vector2(x > 0 ? 0f : 1f, 1f);
                rivet.anchoredPosition = new Vector2(x + (x > 0 ? 4.5f : -4.5f), -19.5f);
                rivet.sizeDelta = new Vector2(9f, 9f);
                var rivetImage = rivet.gameObject.AddComponent<Image>();
                rivetImage.color = Rivet;
                rivetImage.raycastTarget = false;
                var rivetOutline = rivet.gameObject.AddComponent<Outline>();
                rivetOutline.effectColor = new Color(0.941f, 0.769f, 0.443f, 0.44f);
                rivetOutline.effectDistance = new Vector2(1f, -1f);
            }

            float y = -26f;
            _kicker = Label("Kicker", card, 11, TextAnchor.MiddleCenter, Kicker, FontStyle.Bold);
            Place(_kicker.rectTransform, 0f, 1f, 1f, 1f, new Vector2(28f, y - 14f), new Vector2(-28f, y));
            y -= 26f;
            _title = Label("Title", card, 32, TextAnchor.MiddleCenter, Title, FontStyle.Bold);
            _title.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(28f, y - 40f), new Vector2(-28f, y));
            y -= 50f;
            _subtitle = Label("Subtitle", card, 14, TextAnchor.MiddleCenter, Subtitle);
            Place(_subtitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(28f, y - 20f), new Vector2(-28f, y));
            y -= 42f;

            // .location-loading-progress 16px.
            RectTransform bar = Child("Progress", card);
            Place(bar, 0f, 1f, 1f, 1f, new Vector2(28f, y - 16f), new Vector2(-28f, y));
            var barBg = bar.gameObject.AddComponent<Image>();
            barBg.color = BarBg;
            barBg.raycastTarget = false;
            var barBorder = bar.gameObject.AddComponent<Outline>();
            barBorder.effectColor = BarBorder;
            barBorder.effectDistance = new Vector2(1f, -1f);
            _barFill = Child("Fill", bar);
            Place(_barFill, 0f, 0f, 0f, 1f, new Vector2(1f, 1f), new Vector2(-1f, -1f));
            var fill = _barFill.gameObject.AddComponent<Image>();
            fill.color = BarFill;
            fill.raycastTarget = false;
            RectTransform tip = Child("Tip", _barFill);
            Place(tip, 0.6f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            _barTip = tip.gameObject.AddComponent<Image>();
            _barTip.color = BarFillTip;
            _barTip.raycastTarget = false;
            y -= 30f;

            _step = Label("Step", card, 13, TextAnchor.MiddleCenter, Step);
            Place(_step.rectTransform, 0f, 1f, 1f, 1f, new Vector2(28f, y - 18f), new Vector2(-28f, y));
            y -= 30f;
            _hint = Label("Hint", card, 12, TextAnchor.UpperCenter, Hint);
            _hint.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_hint.rectTransform, 0f, 1f, 1f, 1f, new Vector2(50f, y - 40f), new Vector2(-50f, y));
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
