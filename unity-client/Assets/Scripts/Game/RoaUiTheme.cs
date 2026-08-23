using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Общая IMGUI-тема Unity-клиента. Цвета, рамки и отступы
    /// повторяют канонические .ui-panel, .char-input и .ui-btn web-клиента.
    /// Компонент живёт в Resources Prefab, но имеет безопасный runtime fallback.
    /// </summary>
    [DefaultExecutionOrder(-32000)]
    public sealed class RoaUiTheme : MonoBehaviour
    {
        public static readonly Color Page = Html("#06080B");
        public static readonly Color Text = Html("#E7D5AE");
        public static readonly Color Muted = Html("#8EA07D");
        public static readonly Color Amber = Html("#D9B86D");
        public static readonly Color AmberBright = Html("#F0D28A");
        public static readonly Color Green = Html("#7FB24B");
        public static readonly Color Red = Html("#D24A3A");
        public static readonly Color Blue = Html("#4E8D98");

        private static RoaUiTheme _instance;
        private GUISkin _skin;
        private Texture2D _frontendBackdrop;
        private GUIStyle _brand;
        private GUIStyle _subtitle;

        public static RoaUiTheme Ensure(GameObject host)
        {
            if (_instance != null) return _instance;

            GameObject prefab = Resources.Load<GameObject>("RealmUi/Prefabs/RoaUiRoot");
            if (prefab != null)
            {
                GameObject root = Instantiate(prefab);
                root.name = "RoaUiRoot";
                _instance = root.GetComponent<RoaUiTheme>();
                if (_instance != null) return _instance;
                Destroy(root);
            }

            RoaUiTheme existing = host != null ? host.GetComponent<RoaUiTheme>() : null;
            if (existing != null) return existing;
            if (host == null) host = new GameObject("RoaUiRoot");
            return host.AddComponent<RoaUiTheme>();
        }

        public static void Apply()
        {
            if (_instance == null) return;
            _instance.BuildIfNeeded();
            if (_instance._skin != null) GUI.skin = _instance._skin;
        }

        public static GUIStyle BrandStyle
        {
            get
            {
                if (_instance == null) return GUI.skin.label;
                _instance.BuildIfNeeded();
                return _instance._brand;
            }
        }

        public static GUIStyle SubtitleStyle
        {
            get
            {
                if (_instance == null) return GUI.skin.label;
                _instance.BuildIfNeeded();
                return _instance._subtitle;
            }
        }

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }
            _instance = this;
        }

        private void OnDestroy()
        {
            if (_instance == this) _instance = null;
            DestroyGenerated(_skin);
            DestroyGenerated(_frontendBackdrop);
        }

        private void OnGUI()
        {
            Apply();
            if (RoaGameBootstrap.Active == null || !RoaGameBootstrap.Active.ShowsFrontendBackdrop) return;
            if (Event.current.type != EventType.Repaint) return;

            int previousDepth = GUI.depth;
            GUI.depth = 10000;
            GUI.DrawTexture(new Rect(0f, 0f, Screen.width, Screen.height), _frontendBackdrop,
                ScaleMode.StretchToFill, true);

            Color old = GUI.color;
            GUI.color = new Color(0.85f, 0.70f, 0.34f, 0.12f);
            for (float y = 1f; y < Screen.height; y += 4f)
                GUI.DrawTexture(new Rect(0f, y, Screen.width, 1f), Texture2D.whiteTexture);
            GUI.color = old;
            GUI.depth = previousDepth;
        }

        private void BuildIfNeeded()
        {
            if (_skin != null) return;

            _skin = Instantiate(GUI.skin);
            _skin.name = "Realm of Ashes Web-Parity Skin";
            _skin.hideFlags = HideFlags.HideAndDontSave;

            Texture2D panel = Rounded("ui-panel", new Color(0.051f, 0.063f, 0.063f, 0.94f),
                new Color(0.68f, 0.55f, 0.28f, 0.72f), 8);
            Texture2D panelFocused = Rounded("ui-panel-focused", new Color(0.075f, 0.076f, 0.064f, 0.97f),
                new Color(0.94f, 0.78f, 0.36f, 0.92f), 8);
            Texture2D card = Rounded("ui-card", new Color(0.094f, 0.106f, 0.094f, 0.94f),
                new Color(0.40f, 0.36f, 0.24f, 0.76f), 7);
            Texture2D button = Rounded("ui-button", new Color(0.105f, 0.110f, 0.090f, 0.98f),
                new Color(0.68f, 0.55f, 0.28f, 0.76f), 7);
            Texture2D buttonHover = Rounded("ui-button-hover", new Color(0.22f, 0.20f, 0.14f, 0.99f),
                new Color(0.94f, 0.78f, 0.36f, 1f), 7);
            Texture2D buttonActive = Rounded("ui-button-active", new Color(0.31f, 0.27f, 0.15f, 1f),
                new Color(1f, 0.86f, 0.48f, 1f), 7);
            Texture2D field = Rounded("ui-field", new Color(0.051f, 0.063f, 0.063f, 0.98f),
                new Color(0.68f, 0.55f, 0.28f, 0.72f), 7);
            Texture2D fieldFocused = Rounded("ui-field-focused", new Color(0.067f, 0.077f, 0.067f, 1f),
                new Color(0.94f, 0.78f, 0.36f, 1f), 7);
            Texture2D transparent = Solid("transparent", Color.clear);
            Texture2D selection = Solid("selection", new Color(0.78f, 0.57f, 0.20f, 0.55f));

            ConfigureContainer(_skin.box, card, Text, 7, 10);
            ConfigureContainer(_skin.window, panel, Text, 8, 14);
            _skin.window.onNormal.background = panelFocused;
            _skin.window.fontSize = 12;
            _skin.window.richText = true;

            _skin.label.normal.textColor = Text;
            _skin.label.fontSize = 12;
            _skin.label.richText = true;
            _skin.label.padding = new RectOffset(2, 2, 2, 2);
            _skin.label.wordWrap = false;

            ConfigureButton(_skin.button, button, buttonHover, buttonActive);
            ConfigureTextInput(_skin.textField, field, fieldFocused, selection);
            ConfigureTextInput(_skin.textArea, field, fieldFocused, selection);
            _skin.textArea.wordWrap = true;

            _skin.toggle.normal.textColor = Text;
            _skin.toggle.hover.textColor = AmberBright;
            _skin.toggle.onNormal.textColor = AmberBright;
            _skin.toggle.fontSize = 12;

            _skin.horizontalScrollbar.normal.background = card;
            _skin.horizontalScrollbarThumb.normal.background = button;
            _skin.horizontalScrollbarThumb.hover.background = buttonHover;
            _skin.verticalScrollbar.normal.background = card;
            _skin.verticalScrollbarThumb.normal.background = button;
            _skin.verticalScrollbarThumb.hover.background = buttonHover;
            _skin.scrollView.normal.background = transparent;
            _skin.scrollView.padding = new RectOffset(2, 5, 2, 2);

            _skin.horizontalSlider.normal.background = card;
            _skin.horizontalSliderThumb.normal.background = button;
            _skin.horizontalSliderThumb.hover.background = buttonHover;
            _skin.verticalSlider.normal.background = card;
            _skin.verticalSliderThumb.normal.background = button;

            _skin.settings.cursorColor = AmberBright;
            _skin.settings.selectionColor = new Color(0.78f, 0.57f, 0.20f, 0.55f);

            _brand = new GUIStyle(_skin.label)
            {
                fontSize = 27,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleLeft,
                normal = { textColor = AmberBright },
                richText = true
            };
            _subtitle = new GUIStyle(_skin.label)
            {
                fontSize = 11,
                alignment = TextAnchor.MiddleLeft,
                normal = { textColor = Muted },
                wordWrap = true
            };

            _frontendBackdrop = FrontendBackdrop();
        }

        private static void ConfigureContainer(GUIStyle style, Texture2D background, Color text,
                                               int border, int padding)
        {
            style.normal.background = background;
            style.normal.textColor = text;
            style.border = new RectOffset(border, border, border, border);
            style.padding = new RectOffset(padding, padding, padding, padding);
            style.margin = new RectOffset(2, 2, 2, 2);
        }

        private static void ConfigureButton(GUIStyle style, Texture2D normal, Texture2D hover,
                                            Texture2D active)
        {
            style.normal.background = normal;
            style.hover.background = hover;
            style.active.background = active;
            style.focused.background = hover;
            style.onNormal.background = active;
            style.onHover.background = active;
            style.normal.textColor = Text;
            style.hover.textColor = AmberBright;
            style.active.textColor = Color.white;
            style.focused.textColor = AmberBright;
            style.onNormal.textColor = Color.white;
            style.border = new RectOffset(7, 7, 7, 7);
            style.padding = new RectOffset(11, 11, 7, 7);
            style.margin = new RectOffset(3, 3, 3, 3);
            style.fontSize = 12;
            style.fontStyle = FontStyle.Bold;
            style.alignment = TextAnchor.MiddleCenter;
        }

        private static void ConfigureTextInput(GUIStyle style, Texture2D normal, Texture2D focused,
                                               Texture2D selection)
        {
            style.normal.background = normal;
            style.hover.background = focused;
            style.focused.background = focused;
            style.active.background = focused;
            style.onNormal.background = selection;
            style.normal.textColor = AmberBright;
            style.hover.textColor = AmberBright;
            style.focused.textColor = Color.white;
            style.border = new RectOffset(7, 7, 7, 7);
            style.padding = new RectOffset(10, 10, 8, 8);
            style.margin = new RectOffset(2, 2, 3, 6);
            style.fontSize = 14;
        }

        private static Texture2D FrontendBackdrop()
        {
            const int width = 256;
            const int height = 128;
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false)
            {
                name = "character-screen-backdrop",
                hideFlags = HideFlags.HideAndDontSave,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear
            };
            var pixels = new Color32[width * height];
            Color center = new Color(0.165f, 0.133f, 0.074f, 0.95f);
            Color edge = new Color(0.012f, 0.020f, 0.024f, 0.995f);
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    float nx = (x / (width - 1f) - 0.5f) / 0.72f;
                    float ny = (y / (height - 1f) - 0.45f) / 0.82f;
                    float distance = Mathf.Clamp01(Mathf.Sqrt(nx * nx + ny * ny));
                    pixels[y * width + x] = Color.Lerp(center, edge, Mathf.SmoothStep(0f, 1f, distance));
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }

        private static Texture2D Rounded(string name, Color fill, Color border, int radius)
        {
            const int size = 32;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                name = name,
                hideFlags = HideFlags.HideAndDontSave,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear
            };
            var pixels = new Color32[size * size];
            float edge = radius - 0.5f;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float dx = Mathf.Max(radius - x, x - (size - radius - 1));
                    float dy = Mathf.Max(radius - y, y - (size - radius - 1));
                    float corner = Mathf.Sqrt(Mathf.Max(0f, dx) * Mathf.Max(0f, dx)
                        + Mathf.Max(0f, dy) * Mathf.Max(0f, dy));
                    Color color = corner > edge + 1f ? Color.clear
                        : (x <= 1 || y <= 1 || x >= size - 2 || y >= size - 2 || corner > edge - 1f
                            ? border : fill);
                    pixels[y * size + x] = color;
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }

        private static Texture2D Solid(string name, Color color)
        {
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false)
            {
                name = name,
                hideFlags = HideFlags.HideAndDontSave,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Point
            };
            texture.SetPixels(new[] { color, color, color, color });
            texture.Apply(false, true);
            return texture;
        }

        private static Color Html(string html)
        {
            return ColorUtility.TryParseHtmlString(html, out Color color) ? color : Color.white;
        }

        private static void DestroyGenerated(Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
