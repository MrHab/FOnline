using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Круг быстрых слотов по удержанию E. Выбор ведёт RoaQuickbar и считает
    /// его в экранных пикселях от точки нажатия, поэтому круг раскладывается
    /// в тех же пикселях, а не в единицах канвы: иначе сектор под курсором и
    /// нарисованный слот разошлись бы на любом масштабе, кроме единицы.
    /// </summary>
    public sealed partial class RoaHudCanvas
    {
        public const float RadialSlotPixels = 70f;
        /// <summary>Ниже этого размера в экранных пикселях кириллица превращается в кашу.</summary>
        public const float RadialMinFontPixels = 11f;

        private static readonly Color RadialSlotIdle = new Color(0.105f, 0.110f, 0.090f, 0.98f);
        private static readonly Color RadialSlotSelected = new Color(0.62f, 0.45f, 0.13f, 0.98f);
        private static readonly Color RadialSlotEquipped = new Color(0.20f, 0.40f, 0.17f, 0.98f);
        private static readonly Color RadialSlotEmpty = new Color(0.10f, 0.10f, 0.095f, 0.90f);
        private static readonly Color RadialSlotMissing = new Color(0.30f, 0.13f, 0.10f, 0.96f);

        private GameObject _radialRoot;
        private RectTransform _radialHintRect;
        private Text _radialHint;
        private readonly RectTransform[] _radialSlotRects = new RectTransform[RoaQuickbar.SlotCount];
        private readonly Image[] _radialSlotImages = new Image[RoaQuickbar.SlotCount];
        private readonly Outline[] _radialSlotOutlines = new Outline[RoaQuickbar.SlotCount];
        private readonly Text[] _radialSlotNumbers = new Text[RoaQuickbar.SlotCount];
        private readonly Text[] _radialSlotCounts = new Text[RoaQuickbar.SlotCount];
        private readonly Text[] _radialSlotNames = new Text[RoaQuickbar.SlotCount];
        private RectTransform _apocalypseWheelBackdrop;
        private readonly RectTransform[] _apocalypseWheelItems = new RectTransform[RoaQuickbar.SlotCount];
        private readonly Image[] _apocalypseWheelIcons = new Image[RoaQuickbar.SlotCount];
        private readonly GameObject[] _apocalypseWheelSelections = new GameObject[RoaQuickbar.SlotCount];
        private readonly GameObject[] _apocalypseWheelDisabled = new GameObject[RoaQuickbar.SlotCount];
        // Подгонка имени меряет текст генератором, поэтому делается только на смену подписи или раскладки.
        private readonly string[] _radialSlotLabels = new string[RoaQuickbar.SlotCount];
        private int _radialFitKey;

        public bool QuickRadialVisible { get { return _radialRoot != null && _radialRoot.activeSelf; } }

        /// <summary>
        /// Сторона слота. Соседние слоты стоят под 45°, и квадраты без поворота
        /// разделяет не хорда, а проекция на ось — radius·sin 45°.
        /// </summary>
        public static float RadialSlotSize(float radiusPixels)
        {
            float step = radiusPixels * Mathf.Sin(Mathf.PI * 2f / RoaQuickbar.SlotCount);
            return Mathf.Min(RadialSlotPixels, step - 2f);
        }

        /// <summary>Подсказка в центре сжимается вместе с кольцом, чтобы не лезть под диагональные слоты.</summary>
        public static Vector2 RadialHintSize(float radiusPixels)
        {
            return new Vector2(112f, 64f) * Mathf.Min(1f, radiusPixels / 96f);
        }

        private void BuildQuickRadial(Transform canvasRoot)
        {
            // Вне безопасной зоны: центр приходит в пикселях всего экрана.
            RectTransform root = Rect("QuickRadial", canvasRoot, Vector2.zero, Vector2.zero,
                                      new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            _radialRoot = root.gameObject;
            CanvasGroup group = _radialRoot.AddComponent<CanvasGroup>();
            // Выбор делает отпускание E; круг ничего не нажимает и не перехватывает.
            group.blocksRaycasts = false;
            group.interactable = false;
            // Канву пересобрали — подписи новые, подгонку имён начинать заново.
            _radialFitKey = 0;
            System.Array.Clear(_radialSlotLabels, 0, _radialSlotLabels.Length);

            GameObject wheelPrefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_WeaponWheel_03");
            GameObject itemPrefab = null;
            if (wheelPrefab != null)
            {
                GameObject wheel = Instantiate(wheelPrefab, root, false);
                wheel.name = "ApocalypseWheel";
                _apocalypseWheelBackdrop = wheel.transform as RectTransform;
                _apocalypseWheelBackdrop.anchorMin = _apocalypseWheelBackdrop.anchorMax =
                    new Vector2(0.5f, 0.5f);
                _apocalypseWheelBackdrop.pivot = new Vector2(0.5f, 0.5f);
                _apocalypseWheelBackdrop.anchoredPosition = Vector2.zero;
                Transform content = wheel.transform.Find("Content");
                if (content != null)
                {
                    Transform source = content.Find("Item_00/Item/Item_00");
                    if (source != null) itemPrefab = source.gameObject;
                    for (int i = 0; i < 6; i++)
                    {
                        Transform sample = content.Find("Item_0" + i);
                        if (sample != null) sample.gameObject.SetActive(false);
                    }
                }
                foreach (Animator animator in wheel.GetComponentsInChildren<Animator>(true))
                    animator.enabled = false;
                foreach (Graphic graphic in wheel.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                _apocalypseWheelBackdrop.SetAsFirstSibling();
            }

            for (int i = 0; i < _radialSlotRects.Length; i++)
            {
                RectTransform slot = PanelRect("Slot" + (i + 1), root, new Vector2(0.5f, 0.5f),
                                               new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
                _radialSlotRects[i] = slot;
                _radialSlotImages[i] = slot.GetComponent<Image>();
                _radialSlotOutlines[i] = slot.GetComponent<Outline>();
                if (itemPrefab != null)
                {
                    GameObject visual = Instantiate(itemPrefab, slot, false);
                    visual.name = "ApocalypseWheelItem";
                    visual.SetActive(true);
                    RectTransform visualRect = visual.transform as RectTransform;
                    visualRect.anchorMin = visualRect.anchorMax = new Vector2(0.5f, 0.5f);
                    visualRect.pivot = new Vector2(0.5f, 0.5f);
                    visualRect.anchoredPosition = Vector2.zero;
                    visualRect.localRotation = Quaternion.identity;
                    _apocalypseWheelItems[i] = visualRect;
                    foreach (Animator animator in visual.GetComponentsInChildren<Animator>(true))
                        animator.enabled = false;
                    foreach (Graphic graphic in visual.GetComponentsInChildren<Graphic>(true))
                        graphic.raycastTarget = false;
                    Transform icon = visual.transform.Find("Content/Icon/Icon");
                    if (icon != null)
                    {
                        _apocalypseWheelIcons[i] = icon.GetComponent<Image>();
                        if (_apocalypseWheelIcons[i] != null)
                            _apocalypseWheelIcons[i].enabled = false;
                    }
                    Transform selection = visual.transform.Find("Content/BG/Ring_Selected");
                    if (selection != null)
                        _apocalypseWheelSelections[i] = selection.gameObject;
                    Transform disabled = visual.transform.Find("Content/Disabled");
                    if (disabled != null)
                        _apocalypseWheelDisabled[i] = disabled.gameObject;
                    _radialSlotImages[i].enabled = false;
                    _radialSlotOutlines[i].enabled = false;
                }
                _radialSlotNumbers[i] = Label("Number", slot, Vector2.zero, Vector2.zero, 14,
                                              TextAnchor.MiddleCenter, ConsoleAccent, FontStyle.Bold);
                _radialSlotNumbers[i].text = (i + 1).ToString();
                _radialSlotNumbers[i].horizontalOverflow = HorizontalWrapMode.Overflow;
                _radialSlotNumbers[i].verticalOverflow = VerticalWrapMode.Overflow;
                // Количество стоит в строке номера: области имени оно стоило бы третьей строки.
                _radialSlotCounts[i] = Label("Count", slot, Vector2.zero, Vector2.zero, 11,
                                             TextAnchor.MiddleRight, Ink, FontStyle.Bold);
                _radialSlotCounts[i].horizontalOverflow = HorizontalWrapMode.Overflow;
                _radialSlotCounts[i].verticalOverflow = VerticalWrapMode.Overflow;
                _radialSlotNames[i] = Label("Name", slot, Vector2.zero, Vector2.zero, 11,
                                            TextAnchor.UpperCenter, Ink, FontStyle.Bold);
                _radialSlotNames[i].horizontalOverflow = HorizontalWrapMode.Wrap;
                _radialSlotNames[i].verticalOverflow = VerticalWrapMode.Truncate;
            }

            _radialHintRect = PanelRect("Hint", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
                                        Vector2.zero, Vector2.zero);
            _radialHint = Label("Text", _radialHintRect, Vector2.zero, Vector2.zero, 12,
                                TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_radialHint.rectTransform, new Vector2(3f, 3f));
            _radialHint.verticalOverflow = VerticalWrapMode.Overflow;
            _radialRoot.SetActive(false);
        }

        private void RefreshQuickRadial()
        {
            if (_radialRoot == null) return;
            bool open = _quickbar != null && _quickbar.IsRadialOpen;
            if (_radialRoot.activeSelf != open) _radialRoot.SetActive(open);
            if (!open) return;

            LayoutQuickRadial(_quickbar.RadialCenter, Screen.width, Screen.height,
                              Mathf.Max(0.01f, _canvas.scaleFactor));

            bool hasAssignedItems = false;
            int selected = _quickbar.RadialSelected;
            for (int i = 0; i < _radialSlotRects.Length; i++)
            {
                string item = i < _quickbar.Slots.Count ? _quickbar.Slots[i] : string.Empty;
                bool assigned = !string.IsNullOrEmpty(item);
                if (assigned) hasAssignedItems = true;
                SetRadialName(i, assigned ? RoaItemData.Name(item) : "—");
                if (_apocalypseWheelIcons[i] != null)
                {
                    Sprite sprite = assigned ? RoaApocalypseItemIcons.For(item) : null;
                    _apocalypseWheelIcons[i].sprite = sprite;
                    _apocalypseWheelIcons[i].enabled = sprite != null;
                    _apocalypseWheelIcons[i].preserveAspect = true;
                }
                if (_apocalypseWheelSelections[i] != null)
                    _apocalypseWheelSelections[i].SetActive(selected == i);
                if (_apocalypseWheelDisabled[i] != null)
                    _apocalypseWheelDisabled[i].SetActive(assigned && !_quickbar.IsSlotAvailable(i));
                int quantity = _quickbar.SlotQuantity(i);
                bool counted = assigned && quantity > 1;
                _radialSlotCounts[i].text = counted ? "×" + quantity : string.Empty;
                _radialSlotNumbers[i].alignment = counted ? TextAnchor.MiddleLeft : TextAnchor.MiddleCenter;

                Color fill;
                if (selected == i) fill = RadialSlotSelected;
                else if (_quickbar.IsSlotActive(i)) fill = RadialSlotEquipped;
                else if (!assigned) fill = RadialSlotEmpty;
                else if (!_quickbar.IsSlotAvailable(i)) fill = RadialSlotMissing;
                else fill = RadialSlotIdle;
                _radialSlotImages[i].color = fill;
                _radialSlotOutlines[i].effectColor = selected == i ? ConsoleAccent : Border;
                // На янтарной заливке выбранного слота янтарные подписи теряются.
                _radialSlotNumbers[i].color = selected == i ? Color.white : ConsoleAccent;
                _radialSlotNames[i].color = selected == i ? Color.white : Ink;
                _radialSlotCounts[i].color = _radialSlotNames[i].color;
            }
            _radialHint.text = hasAssignedItems ? "выбери\nи отпусти" : "слоты пусты\nI: инвентарь";
        }

        /// <summary>
        /// Раскладка круга: центр и радиус — в экранных пикселях, как у выбора в
        /// RoaQuickbar, размеры переводятся в единицы канвы делением на её масштаб.
        /// </summary>
        private void LayoutQuickRadial(Vector2 centerPixels, int screenWidth, int screenHeight, float scale)
        {
            var root = (RectTransform)_radialRoot.transform;
            root.anchoredPosition = new Vector2(centerPixels.x, screenHeight - centerPixels.y) / scale;

            float radius = RoaQuickbar.RadialRadius(screenWidth, screenHeight);
            float side = RadialSlotSize(radius);
            int numberFont = FontUnits(Mathf.Clamp(screenHeight / 50f, RadialMinFontPixels, 18f), scale);
            int nameFont = FontUnits(RadialMinFontPixels, scale);
            float numberBand = side * 0.40f / scale;
            if (_apocalypseWheelBackdrop != null)
                _apocalypseWheelBackdrop.localScale = Vector3.one *
                    (radius / (550f * scale));

            for (int i = 0; i < _radialSlotRects.Length; i++)
            {
                float angle = -Mathf.PI * 0.5f + i * Mathf.PI * 2f / RoaQuickbar.SlotCount;
                // Экранная ось Y смотрит вниз, ось канвы — вверх.
                _radialSlotRects[i].anchoredPosition = new Vector2(Mathf.Cos(angle), -Mathf.Sin(angle)) * radius / scale;
                _radialSlotRects[i].sizeDelta = new Vector2(side, side) / scale;
                if (_apocalypseWheelItems[i] != null)
                    _apocalypseWheelItems[i].localScale = Vector3.one *
                        (side / (380f * scale));

                Text number = _radialSlotNumbers[i];
                number.fontSize = numberFont;
                RectTransform numberRect = number.rectTransform;
                numberRect.anchorMin = new Vector2(0f, 1f);
                numberRect.anchorMax = new Vector2(1f, 1f);
                numberRect.pivot = new Vector2(0.5f, 1f);
                numberRect.offsetMin = new Vector2(5f, -numberBand);
                numberRect.offsetMax = new Vector2(-5f, -1f);

                Text count = _radialSlotCounts[i];
                count.fontSize = nameFont;
                RectTransform countRect = count.rectTransform;
                countRect.anchorMin = numberRect.anchorMin;
                countRect.anchorMax = numberRect.anchorMax;
                countRect.pivot = numberRect.pivot;
                countRect.offsetMin = new Vector2(5f, -numberBand);
                countRect.offsetMax = new Vector2(-4f, -1f);

                Text name = _radialSlotNames[i];
                name.fontSize = nameFont;
                RectTransform nameRect = name.rectTransform;
                nameRect.anchorMin = Vector2.zero;
                nameRect.anchorMax = Vector2.one;
                nameRect.pivot = new Vector2(0.5f, 0.5f);
                nameRect.offsetMin = new Vector2(2f, 2f);
                nameRect.offsetMax = new Vector2(-2f, -numberBand);
            }

            _radialHintRect.sizeDelta = RadialHintSize(radius) / scale;
            _radialHint.fontSize = FontUnits(Mathf.Clamp(screenHeight / 60f, RadialMinFontPixels, 13f), scale);

            int fitKey = Mathf.RoundToInt(side / scale * 16f) * 64 + nameFont;
            if (fitKey == _radialFitKey) return;
            _radialFitKey = fitKey;
            for (int i = 0; i < _radialSlotLabels.Length; i++)
            {
                string label = _radialSlotLabels[i];
                _radialSlotLabels[i] = null;
                if (label != null) SetRadialName(i, label);
            }
        }

        private void SetRadialName(int index, string label)
        {
            if (_radialSlotLabels[index] == label) return;
            _radialSlotLabels[index] = label;
            Text text = _radialSlotNames[index];
            float width = text.rectTransform.rect.width;
            // Рамка привязана к пикселям и может потерять до пикселя ширины.
            text.text = width > 1f ? FitWords(text, label, width - 0.5f) : label;
        }

        /// <summary>
        /// Слово шире слота переносилось бы посреди букв: такое слово обрезается
        /// многоточием до ширины рамки, перенос остаётся только по пробелам.
        /// </summary>
        public static string FitWords(Text text, string label, float width)
        {
            if (string.IsNullOrEmpty(label)) return string.Empty;
            TextGenerationSettings settings = text.GetGenerationSettings(Vector2.zero);
            TextGenerator generator = text.cachedTextGeneratorForLayout;
            string[] words = label.Split(' ');
            for (int i = 0; i < words.Length; i++)
            {
                string word = words[i];
                string stem = word.TrimEnd('…');
                while (stem.Length > 1 && generator.GetPreferredWidth(word, settings) / text.pixelsPerUnit > width)
                {
                    stem = stem.Substring(0, stem.Length - 1);
                    word = stem + "…";
                }
                words[i] = word;
            }
            return string.Join(" ", words);
        }

        /// <summary>Кегль в единицах канвы, который на экране даст не меньше заданных пикселей.</summary>
        private static int FontUnits(float pixels, float scale)
        {
            return Mathf.Max(1, Mathf.CeilToInt(pixels / scale));
        }
    }
}
