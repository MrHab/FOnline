using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Applies the Apocalypse HUD art to the runtime-built uGUI screens. The game's
    /// canvases are rebuilt as data arrives, so newly created controls are picked up
    /// without changing their layout, event handlers or server-driven values.
    /// </summary>
    [DefaultExecutionOrder(32000)]
    public sealed class RoaApocalypseUiSkin : MonoBehaviour
    {
        private const string AssetRoot = "ApocalypseHud/";
        private const string FrameName = "ApocalypseHudFrame";

        private static Sprite _background;
        private static Sprite _button;
        private static Sprite _thinFrame;
        private static Sprite _bar;
        private static Sprite _playerMarker;
        private static Font _displayFont;

        private readonly HashSet<Image> _styledImages = new HashSet<Image>();
        private float _nextScan;

        public static Sprite Background => Load(ref _background, "SPR_Apocalypse_Box_Background_01");
        public static Sprite Bar => Load(ref _bar, "SPR_Apocalypse_Bar_MetalRusty_01");

        private static Sprite Load(ref Sprite field, string name)
        {
            if (field == null) field = Resources.Load<Sprite>(AssetRoot + name);
            return field;
        }

        private void Update()
        {
            if (Time.unscaledTime < _nextScan) return;
            _nextScan = Time.unscaledTime + 0.35f;
            if (_styledImages.Count > 3000)
                _styledImages.RemoveWhere(image => image == null);
            ApplyAll();
        }

        public void ApplyAll()
        {
            if (Background == null) return;
            Canvas[] canvases = FindObjectsByType<Canvas>(FindObjectsInactive.Include);
            for (int i = 0; i < canvases.Length; i++)
            {
                Canvas canvas = canvases[i];
                if (canvas == null || !canvas.gameObject.scene.IsValid() ||
                    canvas.rootCanvas != canvas) continue;
                ApplyTo(canvas);
            }
        }

        public void ApplyTo(Canvas canvas)
        {
            if (canvas == null || Background == null) return;
            Image[] images = canvas.GetComponentsInChildren<Image>(true);
            for (int i = 0; i < images.Length; i++) StyleImage(images[i]);

            Text[] labels = canvas.GetComponentsInChildren<Text>(true);
            for (int i = 0; i < labels.Length; i++) StyleText(labels[i]);
        }

        private void StyleImage(Image image)
        {
            if (image == null) return;
            if (_styledImages.Contains(image))
            {
                // Some screens change selection colours after construction.
                if (image.sprite == _button && IsLegacyGreen(image.color))
                    image.color = ButtonTint(image.color);
                else if (image.sprite == _background && IsLegacyGreen(image.color))
                    image.color = SurfaceTint(image.color);
                return;
            }
            if (image.name == FrameName || image.color.a < 0.1f ||
                image.GetComponent<Mask>() != null || image.type == Image.Type.Filled)
            {
                _styledImages.Add(image);
                return;
            }

            // Icons, maps and item art have their own meaning and must stay intact.
            if (image.name == "Player" && image.transform.parent != null &&
                image.transform.parent.name == "Markers")
            {
                Sprite marker = Load(ref _playerMarker, "SPR_HUD_Apocalypse_Map_Player_01");
                if (marker != null) image.sprite = marker;
                image.color = Color.white;
                image.preserveAspect = true;
                _styledImages.Add(image);
                return;
            }
            if (image.sprite == Background)
            {
                Rect bounds = image.rectTransform.rect;
                if (bounds.width >= 160f && bounds.height >= 72f &&
                    (bounds.width < 880f || bounds.height < 470f))
                    AddFrame(image.rectTransform);
                _styledImages.Add(image);
                return;
            }
            if (image.sprite != null && image.sprite != RoaUiPalette.Plate())
            {
                _styledImages.Add(image);
                return;
            }

            Rect rect = image.rectTransform.rect;
            float width = Mathf.Abs(rect.width);
            float height = Mathf.Abs(rect.height);
            if (width < 12f || height < 12f) return;

            string name = image.name;
            if (name.Contains("Fill") || name.Contains("Meter") ||
                name.Contains("Glow") || name.Contains("Track") ||
                image.GetComponentInParent<Slider>() != null)
            {
                _styledImages.Add(image);
                return;
            }

            if (image.GetComponent<Button>() != null || image.GetComponent<InputField>() != null)
            {
                Sprite sprite = Load(ref _button, "SPR_Apocalypse_Box_Metal_04");
                if (sprite == null) return;
                image.sprite = sprite;
                image.type = Image.Type.Sliced;
                image.color = ButtonTint(image.color);
                _styledImages.Add(image);
                return;
            }

            if (width < 90f || height < 30f) return;
            Sprite background = Background;
            if (background == null) return;
            image.sprite = background;
            image.type = Image.Type.Sliced;
            image.color = SurfaceTint(image.color);
            _styledImages.Add(image);

            bool isFullscreen = width > 880f && height > 470f;
            bool isPanel = width >= 160f && height >= 72f;
            if (isPanel && !isFullscreen && image.GetComponent<RectMask2D>() == null)
                AddFrame(image.rectTransform);
        }

        private static bool IsLegacyGreen(Color color)
        {
            return color.g > color.r * 1.12f && color.g > color.b * 1.08f;
        }

        private static Color ButtonTint(Color original)
        {
            if (original.r > original.g * 1.45f && original.r > 0.2f)
                return new Color(0.95f, 0.48f, 0.39f, original.a);
            float brightness = Mathf.Max(original.r, original.g, original.b);
            if (brightness > 0.23f)
                return new Color(0.96f, 0.82f, 0.49f, original.a);
            return new Color(0.61f, 0.55f, 0.43f, original.a);
        }

        private static Color SurfaceTint(Color original)
        {
            float brightness = Mathf.Max(original.r, original.g, original.b);
            if (brightness > 0.23f && IsLegacyGreen(original))
                return new Color(0.97f, 0.77f, 0.45f, original.a);
            return new Color(0.79f, 0.74f, 0.64f, original.a);
        }

        private static void AddFrame(RectTransform parent)
        {
            Sprite frame = Load(ref _thinFrame, "SPR_HUD_Apocalypse_Frame_Large_03_Clean");
            if (frame == null || parent.Find(FrameName) != null) return;
            var frameObject = new GameObject(FrameName, typeof(RectTransform), typeof(Image));
            RectTransform rect = frameObject.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            Image border = frameObject.GetComponent<Image>();
            border.sprite = frame;
            border.type = Image.Type.Sliced;
            border.color = new Color(0.91f, 0.70f, 0.37f, 0.68f);
            border.raycastTarget = false;
        }

        private static void StyleText(Text label)
        {
            if (label == null) return;
            if (_displayFont == null)
                _displayFont = Resources.Load<Font>(AssetRoot + "SairaCondensed-Regular");
            bool cyrillic = false;
            string value = label.text;
            for (int i = 0; i < value.Length; i++)
            {
                if (value[i] >= '\u0400' && value[i] <= '\u052f')
                {
                    cyrillic = true;
                    break;
                }
            }
            Font wanted = !cyrillic && _displayFont != null ? _displayFont : RoaUiFont.Default;
            if (label.font != wanted) label.font = wanted;

            Color color = label.color;
            if (color.a < 0.1f) return;
            if (color.g > color.r * 1.18f && color.g > color.b * 1.10f)
            {
                // Legacy phosphor green becomes the warm display ink of the pack.
                label.color = new Color(0.94f, 0.82f, 0.61f, color.a);
            }
        }
    }
}
