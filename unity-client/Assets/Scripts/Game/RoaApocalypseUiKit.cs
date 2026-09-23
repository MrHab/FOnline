using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Builds the new UI directly from the installed Apocalypse HUD components.
    /// Game-specific data, Russian labels and callbacks remain owned by each screen.
    /// </summary>
    public static class RoaApocalypseUiKit
    {
        private const string Root = "ApocalypseHud/";
        private static GameObject _simpleButton;
        private static GameObject _slotButton;
        private static Sprite _buttonPlate;
        private static Sprite _windowPlate;
        private static Sprite _windowFrame;
        private static Sprite _slicedFrame;
        private static Sprite _inputPlate;

        public static Sprite FrameSprite
        {
            get
            {
                if (_slicedFrame != null) return _slicedFrame;
                if (_windowFrame == null)
                    _windowFrame = Resources.Load<Sprite>(Root +
                        "SPR_HUD_Apocalypse_Frame_Large_03_Clean");
                if (_windowFrame == null) return null;
                if (_windowFrame.border.sqrMagnitude > 0f)
                    return _slicedFrame = _windowFrame;
                // This pack sprite has a transparent centre and a 13 px rim, but
                // its source importer leaves the 9-slice border at zero.
                _slicedFrame = Sprite.Create(_windowFrame.texture, _windowFrame.rect,
                    new Vector2(_windowFrame.pivot.x / _windowFrame.rect.width,
                        _windowFrame.pivot.y / _windowFrame.rect.height),
                    _windowFrame.pixelsPerUnit, 0, SpriteMeshType.FullRect,
                    new Vector4(18f, 18f, 18f, 18f));
                return _slicedFrame;
            }
        }

        public static bool IsInstalled => Resources.Load<GameObject>(Root +
            "Button_Apocalypse_Simple") != null;

        public static GameObject CreateButtonRoot(RectTransform parent, string name)
        {
            if (_simpleButton == null)
                _simpleButton = Resources.Load<GameObject>(Root + "Button_Apocalypse_Simple");
            GameObject root = _simpleButton != null
                ? Object.Instantiate(_simpleButton, parent, false)
                : new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            if (_simpleButton == null) root.transform.SetParent(parent, false);
            root.name = name;

            // Synty's sample button uses a HorizontalLayoutGroup for its English
            // caption. Our screens set exact widths for responsive Russian labels.
            HorizontalLayoutGroup layout = root.GetComponent<HorizontalLayoutGroup>();
            if (layout != null) layout.enabled = false;
            LayoutElement layoutElement = root.GetComponent<LayoutElement>();
            if (layoutElement != null) layoutElement.enabled = false;

            // The sample prefab has an English TMP caption. Screens add their own
            // Cyrillic-capable Text and keep the prefab's Button/RectTransform.
            foreach (Graphic graphic in root.GetComponentsInChildren<Graphic>(true))
                if (!(graphic is Image)) graphic.enabled = false;

            Image plate = root.GetComponent<Image>();
            if (plate == null) plate = root.AddComponent<Image>();
            if (_buttonPlate == null)
                _buttonPlate = Resources.Load<Sprite>(Root + "SPR_Apocalypse_Box_Metal_04");
            if (_buttonPlate != null)
            {
                plate.sprite = _buttonPlate;
                plate.type = Image.Type.Sliced;
                plate.color = Color.white;
            }
            Button button = root.GetComponent<Button>();
            if (button == null) button = root.AddComponent<Button>();
            button.targetGraphic = plate;
            return root;
        }

        public static Button CreateSlotButton(RectTransform parent, string name)
        {
            if (_slotButton == null)
                _slotButton = Resources.Load<GameObject>(Root +
                    "Button_Apocalypse_HotBar_Item_01");
            if (_slotButton == null)
                return CreateButtonRoot(parent, name).GetComponent<Button>();

            GameObject root = Object.Instantiate(_slotButton, parent, false);
            root.name = name;
            foreach (Animator animator in root.GetComponentsInChildren<Animator>(true))
                animator.enabled = false;
            foreach (Graphic graphic in root.GetComponentsInChildren<Graphic>(true))
                graphic.raycastTarget = graphic.transform == root.transform;
            foreach (Image image in root.GetComponentsInChildren<Image>(true))
                if (image.sprite != null && image.sprite.name.StartsWith("ICON_"))
                    image.enabled = false;
            foreach (string part in new[] { "Input", "Item/Highlighted", "Item/Selected" })
            {
                Transform child = root.transform.Find(part);
                if (child != null) child.gameObject.SetActive(false);
            }
            Image plate = root.GetComponent<Image>();
            if (plate == null)
            {
                plate = root.AddComponent<Image>();
                plate.color = new Color(1f, 1f, 1f, 0.01f);
            }
            plate.raycastTarget = true;
            Button button = root.GetComponent<Button>();
            if (button == null) button = root.AddComponent<Button>();
            button.targetGraphic = plate;
            return button;
        }

        public static void DecorateButton(Button button)
        {
            if (button == null || button.transform.Find("ApocalypseHudButtonVisual") != null)
                return;
            RectTransform parent = button.transform as RectTransform;
            if (parent == null || parent.rect.width < 14f || parent.rect.height < 14f)
                return;
            // Existing screen callbacks stay on the original Button. The real
            // Synty prefab supplies its visual layers behind the live caption.
            GameObject visual = CreateButtonRoot(parent, "ApocalypseHudButtonVisual");
            RectTransform rect = (RectTransform)visual.transform;
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            rect.SetAsFirstSibling();
            Button visualButton = visual.GetComponent<Button>();
            if (visualButton != null) visualButton.enabled = false;
            foreach (Graphic graphic in visual.GetComponentsInChildren<Graphic>(true))
                graphic.raycastTarget = false;
        }

        public static void StyleWindow(Image surface, bool frame = false)
        {
            if (surface == null) return;
            if (_windowPlate == null)
                _windowPlate = Resources.Load<Sprite>(Root + "SPR_Apocalypse_Box_Background_01");
            if (_windowPlate == null) return;
            surface.sprite = _windowPlate;
            surface.type = Image.Type.Sliced;
            surface.color = Color.white;
            if (!frame || surface.transform.Find("ApocalypseHudFrame") != null) return;
            Sprite borderSprite = FrameSprite;
            if (borderSprite == null) return;
            var go = new GameObject("ApocalypseHudFrame", typeof(RectTransform), typeof(Image));
            RectTransform rect = (RectTransform)go.transform;
            rect.SetParent(surface.transform, false);
            rect.SetAsFirstSibling();
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = rect.offsetMax = Vector2.zero;
            Image image = go.GetComponent<Image>();
            image.sprite = borderSprite;
            image.type = Image.Type.Sliced;
            image.color = new Color(0.91f, 0.70f, 0.37f, 0.68f);
            image.raycastTarget = false;
        }

        public static void StyleInput(Image surface)
        {
            if (surface == null) return;
            if (_inputPlate == null)
                _inputPlate = Resources.Load<Sprite>(Root + "SPR_Apocalypse_Bar_MetalRusty_01");
            if (_inputPlate == null) return;
            surface.sprite = _inputPlate;
            surface.type = Image.Type.Sliced;
            surface.color = Color.white;
        }
    }
}
