using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Оружейный верстак в структуре web (#weapon-modification-window,
    /// 04e_weapon_modification_workbench.js:288, 19_weapon_modification_workbench.css):
    /// модальная оболочка 1180×760 — шапка (kicker «ОРУЖЕЙНЫЙ ВЕРСТАК», «Модификация
    /// оружия», подзаголовок «имя · одноручное/двуручное · состояние N%», счётчик
    /// «N / M узлов», ×), тело: сцена с артом оружия и кнопками-узлами по углам
    /// (СТВОЛ / ПРИЦЕЛ / МАГАЗИН / ЦЕВЬЁ) + панель опций (kicker «УЗЕЛ i ИЗ n»,
    /// заголовок, заметка, список: «Базовая конфигурация · СНЯТЬ» и совместимые
    /// детали с эффектом, стоимостью и статусом СОЗДАТЬ / УСТАНОВЛЕНО / НЕ ХВАТАЕТ),
    /// подвал: полоса характеристик (УРОН/ДАЛЬНОСТЬ/ЁМКОСТЬ/ТОЧНОСТЬ/ТЕМП) и статус.
    /// Логика и серверный запрос modifyWeapon остаются в RoaInventory.
    /// </summary>
    public sealed class RoaWorkbenchCanvas : MonoBehaviour
    {
        private static readonly Color Overlay = new Color(0.01f, 0.02f, 0.015f, 0.78f);
        private static readonly Color ShellBg = new Color(0.035f, 0.06f, 0.045f, 1f);
        private static readonly Color ShellBorder = new Color(0.522f, 0.8f, 0.408f, 0.55f);
        private static readonly Color KickerInk = new Color(0.537f, 0.769f, 0.431f, 1f);   // #89c46e
        private static readonly Color TitleInk = new Color(0.89f, 0.93f, 0.78f, 1f);
        private static readonly Color BodyInk = new Color(0.718f, 0.788f, 0.682f, 1f);     // #b7c9ae
        private static readonly Color Lime = new Color(0.667f, 0.898f, 0.435f, 1f);        // #aae56f
        private static readonly Color Gold = new Color(0.937f, 0.816f, 0.471f, 1f);
        private static readonly Color StageBg = new Color(0.025f, 0.045f, 0.035f, 1f);
        private static readonly Color PanelBg = new Color(0.027f, 0.051f, 0.043f, 1f);
        private static readonly Color OptionBg = new Color(0.075f, 0.12f, 0.09f, 1f);
        private static readonly Color OptionBorder = new Color(0.502f, 0.663f, 0.435f, 0.29f);
        private static readonly Color SlotBg = new Color(0.05f, 0.09f, 0.065f, 1f);

        public RoaInventory Inventory;
        public RoaHud Hud;

        private GameObject _root;
        private Text _subtitle;
        private Text _buildCount;
        private RawImage _art;
        private RoaWeaponArt _weaponArt;
        private readonly Dictionary<string, (Button button, Text name, Text icon)> _slotPins = new Dictionary<string, (Button, Text, Text)>();
        private Text _slotKicker;
        private Text _slotTitle;
        private Text _slotNote;
        private RectTransform _optionList;
        private readonly List<GameObject> _optionRows = new List<GameObject>();
        private readonly List<(Text label, Text value, Text was)> _stats = new List<(Text, Text, Text)>();
        private Text _status;
        private float _refreshAt;
        private string _builtSignature = string.Empty;

        public bool IsOpen { get { return Inventory != null && !string.IsNullOrEmpty(Inventory.ModifyWeaponRuntimeId); } }

        private void Update()
        {
            if (!IsOpen)
            {
                if (_root != null && _root.activeSelf) { _root.SetActive(false); _builtSignature = string.Empty; }
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) { _root.SetActive(true); _refreshAt = 0f; }
            if (Input.GetKeyDown(KeyCode.Escape)) { Inventory.CloseWorkbench(); return; }
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.3f;
            Refresh();
        }

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("WorkbenchCanvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 44;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            _root = new GameObject("WeaponModificationWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            Stretch(rootRect, 0f);
            var overlay = _root.AddComponent<Image>();
            overlay.color = Overlay;
            var overlayButton = _root.AddComponent<Button>();
            overlayButton.targetGraphic = overlay;
            overlayButton.onClick.AddListener(() => Inventory.CloseWorkbench());

            RectTransform shell = Child("Shell", rootRect);
            shell.anchorMin = shell.anchorMax = new Vector2(0.5f, 0.5f);
            shell.sizeDelta = new Vector2(1180f, 760f);
            var shellImage = shell.gameObject.AddComponent<Image>();
            shellImage.color = ShellBg;
            var shellOutline = shell.gameObject.AddComponent<Outline>();
            shellOutline.effectColor = ShellBorder;
            shellOutline.effectDistance = new Vector2(1f, -1f);

            // --- .wm-header ---
            Text kicker = Label("Kicker", shell, 10, TextAnchor.UpperLeft, KickerInk, FontStyle.Bold);
            kicker.text = "О Р У Ж Е Й Н Ы Й   В Е Р С Т А К";
            Place(kicker.rectTransform, 0f, 1f, 0.7f, 1f, new Vector2(24f, -28f), new Vector2(0f, -15f));
            Text title = Label("Title", shell, 24, TextAnchor.UpperLeft, TitleInk, FontStyle.Bold);
            title.text = "Модификация оружия";
            Place(title.rectTransform, 0f, 1f, 0.7f, 1f, new Vector2(24f, -58f), new Vector2(0f, -30f));
            _subtitle = Label("Subtitle", shell, 12, TextAnchor.UpperLeft, BodyInk);
            Place(_subtitle.rectTransform, 0f, 1f, 0.7f, 1f, new Vector2(24f, -76f), new Vector2(0f, -60f));
            _buildCount = Label("BuildCount", shell, 12, TextAnchor.MiddleRight, Lime, FontStyle.Bold);
            Place(_buildCount.rectTransform, 0.7f, 1f, 1f, 1f, new Vector2(0f, -50f), new Vector2(-70f, -26f));
            Button close = UiButton(shell, "×", 22, () => Inventory.CloseWorkbench());
            var closeRect = (RectTransform)close.transform;
            closeRect.anchorMin = closeRect.anchorMax = new Vector2(1f, 1f);
            closeRect.pivot = new Vector2(1f, 1f);
            closeRect.anchoredPosition = new Vector2(-20f, -22f);
            closeRect.sizeDelta = new Vector2(36f, 34f);

            // --- .wm-body: сцена | панель опций ---
            RectTransform stage = Child("Stage", shell);
            Place(stage, 0f, 0f, 1f, 1f, new Vector2(0f, 78f), new Vector2(-360f, -82f));
            stage.gameObject.AddComponent<Image>().color = StageBg;
            RectTransform artRect = Child("Art", stage);
            Place(artRect, 0.12f, 0.12f, 0.88f, 0.88f, Vector2.zero, Vector2.zero);
            _art = artRect.gameObject.AddComponent<RawImage>();
            _art.raycastTarget = false;
            _art.enabled = false;
            Text hint = Label("RotateHint", stage, 10, TextAnchor.LowerLeft, new Color(BodyInk.r, BodyInk.g, BodyInk.b, 0.7f));
            hint.text = "Модель оружия · узлы сборки по углам";
            Place(hint.rectTransform, 0f, 0f, 1f, 0f, new Vector2(16f, 10f), new Vector2(-16f, 26f));

            // Кнопки-узлы по углам сцены (.wm-slot--left-top …).
            BuildSlotPin(stage, "barrel", "СТВОЛ", new Vector2(0f, 1f), new Vector2(18f, -18f));
            BuildSlotPin(stage, "scope", "ПРИЦЕЛ", new Vector2(1f, 1f), new Vector2(-18f, -18f));
            BuildSlotPin(stage, "magazine", "МАГАЗИН", new Vector2(1f, 0f), new Vector2(-18f, 40f));
            BuildSlotPin(stage, "forend", "ЦЕВЬЁ", new Vector2(0f, 0f), new Vector2(18f, 40f));

            RectTransform options = Child("Options", shell);
            Place(options, 1f, 0f, 1f, 1f, new Vector2(-360f, 78f), new Vector2(0f, -82f));
            options.gameObject.AddComponent<Image>().color = PanelBg;
            _slotKicker = Label("SlotKicker", options, 10, TextAnchor.UpperLeft, KickerInk, FontStyle.Bold);
            Place(_slotKicker.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -26f), new Vector2(-16f, -14f));
            _slotTitle = Label("SlotTitle", options, 18, TextAnchor.UpperLeft, TitleInk, FontStyle.Bold);
            Place(_slotTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -52f), new Vector2(-16f, -28f));
            _slotNote = Label("SlotNote", options, 11, TextAnchor.UpperLeft, BodyInk);
            _slotNote.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_slotNote.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -84f), new Vector2(-16f, -54f));
            RectTransform scrollArea = Child("Scroll", options);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(12f, 10f), new Vector2(-8f, -90f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.scrollSensitivity = 28f;
            scrollArea.gameObject.AddComponent<RectMask2D>();
            _optionList = Child("List", scrollArea);
            _optionList.anchorMin = new Vector2(0f, 1f);
            _optionList.anchorMax = new Vector2(1f, 1f);
            _optionList.pivot = new Vector2(0f, 1f);
            _optionList.sizeDelta = Vector2.zero;
            var layout = _optionList.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 8f;
            layout.padding = new RectOffset(0, 4, 0, 8);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            _optionList.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = _optionList;

            // --- .wm-footer ---
            RectTransform footer = Child("Footer", shell);
            Place(footer, 0f, 0f, 1f, 0f, new Vector2(0f, 0f), new Vector2(0f, 78f));
            footer.gameObject.AddComponent<Image>().color = PanelBg;
            string[] statLabels = { "УРОН", "ДАЛЬНОСТЬ", "ЁМКОСТЬ", "ТОЧНОСТЬ", "ТЕМП" };
            for (int i = 0; i < statLabels.Length; i++)
            {
                RectTransform stat = Child("Stat", footer);
                Place(stat, 0f, 0f, 0f, 1f, new Vector2(16f + i * 122f, 12f), new Vector2(16f + i * 122f + 116f, -12f));
                stat.gameObject.AddComponent<Image>().color = OptionBg;
                var outline = stat.gameObject.AddComponent<Outline>();
                outline.effectColor = OptionBorder;
                outline.effectDistance = new Vector2(1f, -1f);
                Text label = Label("Label", stat, 9, TextAnchor.UpperLeft, KickerInk, FontStyle.Bold);
                label.text = statLabels[i];
                Place(label.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -18f), new Vector2(-8f, -5f));
                Text value = Label("Value", stat, 15, TextAnchor.LowerLeft, Lime, FontStyle.Bold);
                Place(value.rectTransform, 0f, 0f, 0.6f, 0f, new Vector2(8f, 5f), new Vector2(0f, 27f));
                Text was = Label("Was", stat, 9, TextAnchor.LowerRight, new Color(BodyInk.r, BodyInk.g, BodyInk.b, 0.7f));
                Place(was.rectTransform, 0.4f, 0f, 1f, 0f, new Vector2(0f, 6f), new Vector2(-8f, 20f));
                _stats.Add((label, value, was));
            }
            _status = Label("Status", footer, 11, TextAnchor.MiddleRight, BodyInk);
            _status.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_status.rectTransform, 0.58f, 0f, 1f, 1f, new Vector2(0f, 10f), new Vector2(-16f, -10f));

            _weaponArt = gameObject.GetComponent<RoaWeaponArt>();
            if (_weaponArt == null) _weaponArt = gameObject.AddComponent<RoaWeaponArt>();
            _weaponArt.BaseUrl = RoaGameBootstrap.ActiveBaseUrl;
            _root.SetActive(false);
        }

        private void BuildSlotPin(RectTransform stage, string slot, string shortLabel, Vector2 anchor, Vector2 offset)
        {
            Button button = UiButton(stage, string.Empty, 10, () => { Inventory.ModifySlot = slot; _refreshAt = 0f; });
            var rect = (RectTransform)button.transform;
            rect.anchorMin = rect.anchorMax = anchor;
            rect.pivot = anchor;
            rect.anchoredPosition = offset;
            rect.sizeDelta = new Vector2(170f, 66f);
            button.GetComponent<Image>().color = SlotBg;
            Text small = Label("Short", rect, 9, TextAnchor.UpperLeft, KickerInk, FontStyle.Bold);
            small.text = shortLabel;
            Place(small.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -22f), new Vector2(-36f, -8f));
            Text name = Label("Name", rect, 12, TextAnchor.LowerLeft, TitleInk, FontStyle.Bold);
            name.verticalOverflow = VerticalWrapMode.Truncate;
            Place(name.rectTransform, 0f, 0f, 1f, 0f, new Vector2(12f, 8f), new Vector2(-36f, 38f));
            Text icon = Label("Icon", rect, 16, TextAnchor.MiddleCenter, Lime, FontStyle.Bold);
            Place(icon.rectTransform, 1f, 0f, 1f, 1f, new Vector2(-32f, 0f), new Vector2(-6f, 0f));
            _slotPins[slot] = (button, name, icon);
        }

        private void Refresh()
        {
            string runtimeId = Inventory.ModifyWeaponRuntimeId;
            string weaponId = RoaInventory.BaseId(runtimeId);
            RoaWeaponData.Weapon weapon = RoaWeaponData.Get(weaponId) ?? new RoaWeaponData.Weapon();
            string[] slots = RoaWeaponModificationData.SlotsFor(weaponId);
            JObject mods = Inventory.InstalledModsFor(runtimeId) ?? new JObject();
            int installedCount = 0;
            foreach (string slot in slots) if (!string.IsNullOrEmpty(mods[slot]?.ToString())) installedCount++;
            bool twoHanded = RoaWeaponModificationData.IsTwoHanded(weaponId);

            _subtitle.text = RoaItemData.Name(weaponId) + " · " + (twoHanded ? "двуручное оружие" : "одноручное оружие")
                + " · состояние " + Mathf.RoundToInt(Inventory.ConditionOf(runtimeId)) + "%";
            _buildCount.text = installedCount + " / " + slots.Length + " узлов";
            _weaponArt.Show(weaponId);
            if (_art.texture != _weaponArt.ArtTexture) _art.texture = _weaponArt.ArtTexture;
            _art.enabled = _weaponArt.ArtTexture != null;

            string active = Inventory.ModifySlot;
            if (System.Array.IndexOf(slots, active) < 0 && slots.Length > 0) { active = slots[0]; Inventory.ModifySlot = active; }
            foreach (KeyValuePair<string, (Button button, Text name, Text icon)> pin in _slotPins)
            {
                bool available = System.Array.IndexOf(slots, pin.Key) >= 0;
                pin.Value.button.gameObject.SetActive(available);
                if (!available) continue;
                RoaWeaponModificationData.Definition installed = RoaWeaponModificationData.Find(mods[pin.Key]?.ToString());
                bool selected = pin.Key == active;
                pin.Value.name.text = installed != null ? installed.Name : "Пусто";
                pin.Value.icon.text = installed != null ? "•" : "+";
                pin.Value.button.GetComponent<Image>().color = selected ? new Color(0.11f, 0.2f, 0.13f, 1f) : SlotBg;
                var outline = pin.Value.button.GetComponent<Outline>();
                outline.effectColor = selected ? Lime : installed != null ? new Color(Lime.r, Lime.g, Lime.b, 0.5f) : OptionBorder;
            }

            RoaWeaponModificationData.Definition activeInstalled = RoaWeaponModificationData.Find(mods[active]?.ToString());
            _slotKicker.text = "УЗЕЛ " + (System.Array.IndexOf(slots, active) + 1) + " ИЗ " + slots.Length;
            _slotTitle.text = RoaWeaponModificationData.SlotLabel(active);
            _slotNote.text = activeInstalled != null
                ? "Установлено: " + activeInstalled.Name + ". " + activeInstalled.Effect
                : "Выберите совместимую деталь.";

            // Список опций перестраивается только при изменении состояния.
            string signature = runtimeId + "|" + active + "|" + mods.ToString(Newtonsoft.Json.Formatting.None) + "|" + Inventory.ActionPending + "|" + Inventory.InventorySignature();
            if (signature != _builtSignature)
            {
                _builtSignature = signature;
                RebuildOptions(weaponId, runtimeId, active, activeInstalled);
            }

            // Полоса характеристик: текущие значения с учётом установленных деталей.
            float baseRange = RoaGearData.Range(weaponId);
            int baseMag = RoaWeaponModificationData.MagazineSize(weaponId);
            float baseRate = RoaWeaponModificationData.FireRate(weaponId);
            float dmgMul = 1f, rangeMul = 1f, accuracy = 0f, magMul = 1f, rateMul = 1f; int magBonus = 0;
            foreach (string slot in slots)
            {
                RoaWeaponModificationData.Effects d = RoaWeaponModificationData.EffectsOf(mods[slot]?.ToString());
                dmgMul *= d.DamageMul; rangeMul *= d.RangeMul; accuracy += d.AccuracyBonus; magMul *= d.MagazineMul; magBonus += d.MagazineBonus; rateMul *= d.FireRateMul;
            }
            float range = baseRange * rangeMul;
            int magazine = Mathf.Max(1, Mathf.RoundToInt(baseMag * magMul) + magBonus);
            int dmgMin = Mathf.RoundToInt(weapon.DmgMin * dmgMul), dmgMax = Mathf.RoundToInt(weapon.DmgMax * dmgMul);
            SetStat(0, dmgMin + "–" + dmgMax, weapon.DmgMin + "–" + weapon.DmgMax);
            SetStat(1, range.ToString("0.#") + " м", baseRange.ToString("0.#") + " м");
            SetStat(2, magazine.ToString(), baseMag.ToString());
            SetStat(3, "+" + Mathf.RoundToInt(accuracy * 100f) + "%", "0%");
            SetStat(4, (baseRate * rateMul).ToString("0.00") + " c", baseRate.ToString("0.00") + " c");

            _status.text = string.IsNullOrEmpty(Inventory.ActionStatus) ? "Сборка готова к настройке." : Inventory.ActionStatus;
        }

        private void SetStat(int index, string value, string original)
        {
            (Text label, Text value, Text was) stat = _stats[index];
            stat.value.text = value;
            bool changed = value != original && !(index == 3 && value == "+0%");
            stat.was.text = changed ? "было " + original : string.Empty;
            stat.value.color = changed ? Gold : Lime;
        }

        private void RebuildOptions(string weaponId, string runtimeId, string slot, RoaWeaponModificationData.Definition installed)
        {
            foreach (GameObject row in _optionRows) Destroy(row);
            _optionRows.Clear();
            if (installed != null)
                AddOption("×", "Базовая конфигурация", "Снять установленную деталь. Материалы не возвращаются.", string.Empty, string.Empty,
                    "СНЯТЬ", !Inventory.ActionPending, () => Inventory.SubmitModification(runtimeId, slot, string.Empty), false);
            foreach (RoaWeaponModificationData.Definition definition in RoaWeaponModificationData.All)
            {
                if (definition.Slot != slot || !RoaWeaponModificationData.Compatible(definition, weaponId)) continue;
                bool isInstalled = installed != null && installed.Id == definition.Id;
                bool affordable = Inventory.CanAffordCost(definition.Cost);
                string cost = CostText(definition.Cost);
                string state = isInstalled ? "УСТАНОВЛЕНО" : affordable ? "СОЗДАТЬ" : "НЕ ХВАТАЕТ";
                string id = definition.Id;
                AddOption(RoaWeaponModificationData.SlotLabel(slot).Substring(0, 1), definition.Name, RoaWeaponModificationData.EffectsOf(definition.Id).Description, definition.Effect, cost,
                    state, !Inventory.ActionPending && !isInstalled && affordable,
                    () => Inventory.SubmitModification(runtimeId, slot, id), isInstalled);
            }
        }

        private string CostText(Dictionary<string, int> cost)
        {
            var parts = new List<string>();
            foreach (KeyValuePair<string, int> entry in cost)
            {
                int have = Inventory.CountOf(entry.Key);
                parts.Add(RoaItemData.Name(entry.Key) + " " + have + "/" + entry.Value);
            }
            return parts.Count > 0 ? "Нужно: " + string.Join(" · ", parts) : string.Empty;
        }

        /// <summary>.wm-option: иконка-бокс | имя, описание, эффект, стоимость | статус.</summary>
        private void AddOption(string icon, string name, string desc, string effect, string cost, string state, bool enabled, System.Action onClick, bool isInstalled)
        {
            var row = new GameObject("Option:" + name, typeof(RectTransform));
            row.transform.SetParent(_optionList, false);
            row.AddComponent<LayoutElement>().preferredHeight = string.IsNullOrEmpty(effect) ? 62f : 92f;
            var image = row.AddComponent<Image>();
            image.color = enabled ? OptionBg : new Color(OptionBg.r, OptionBg.g, OptionBg.b, 0.58f);
            var outline = row.AddComponent<Outline>();
            outline.effectColor = isInstalled ? new Color(Lime.r, Lime.g, Lime.b, 0.62f) : OptionBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var button = row.AddComponent<Button>();
            button.targetGraphic = image;
            button.interactable = enabled;
            button.onClick.AddListener(() => { onClick(); _refreshAt = Time.unscaledTime + 0.3f; });
            var rect = (RectTransform)row.transform;

            RectTransform iconBox = Child("IconBox", rect);
            iconBox.anchorMin = iconBox.anchorMax = new Vector2(0f, 0.5f);
            iconBox.pivot = new Vector2(0f, 0.5f);
            iconBox.anchoredPosition = new Vector2(10f, 0f);
            iconBox.sizeDelta = new Vector2(42f, 42f);
            iconBox.gameObject.AddComponent<Image>().color = new Color(0.02f, 0.04f, 0.03f, 1f);
            var iconOutline = iconBox.gameObject.AddComponent<Outline>();
            iconOutline.effectColor = OptionBorder;
            iconOutline.effectDistance = new Vector2(1f, -1f);
            Text iconText = Label("Icon", iconBox, 18, TextAnchor.MiddleCenter, Lime, FontStyle.Bold);
            iconText.text = icon;
            Stretch(iconText.rectTransform, 0f);

            Text title = Label("Name", rect, 12, TextAnchor.UpperLeft, TitleInk, FontStyle.Bold);
            title.text = name;
            title.verticalOverflow = VerticalWrapMode.Truncate;
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(62f, -24f), new Vector2(-96f, -8f));
            Text descText = Label("Desc", rect, 10, TextAnchor.UpperLeft, BodyInk);
            descText.text = desc;
            descText.verticalOverflow = VerticalWrapMode.Truncate;
            Place(descText.rectTransform, 0f, 1f, 1f, 1f, new Vector2(62f, -50f), new Vector2(-96f, -26f));
            if (!string.IsNullOrEmpty(effect))
            {
                Text effectText = Label("Effect", rect, 10, TextAnchor.UpperLeft, Lime, FontStyle.Bold);
                effectText.text = effect;
                effectText.verticalOverflow = VerticalWrapMode.Truncate;
                Place(effectText.rectTransform, 0f, 1f, 1f, 1f, new Vector2(62f, -64f), new Vector2(-96f, -52f));
                Text costText = Label("Cost", rect, 9, TextAnchor.UpperLeft, new Color(Gold.r, Gold.g, Gold.b, 0.85f));
                costText.text = cost;
                costText.verticalOverflow = VerticalWrapMode.Truncate;
                Place(costText.rectTransform, 0f, 1f, 1f, 1f, new Vector2(62f, -80f), new Vector2(-96f, -66f));
            }
            Text stateText = Label("State", rect, 9, TextAnchor.MiddleRight, isInstalled ? Lime : enabled ? Gold : BodyInk, FontStyle.Bold);
            stateText.text = state;
            Place(stateText.rectTransform, 1f, 0f, 1f, 1f, new Vector2(-92f, 0f), new Vector2(-10f, 0f));
            _optionRows.Add(row);
        }

        // --- Утилиты ---------------------------------------------------------

        private static Button UiButton(RectTransform parent, string caption, int size, System.Action onClick)
        {
            var go = new GameObject("Btn:" + caption, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = OptionBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = OptionBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            if (!string.IsNullOrEmpty(caption))
            {
                Text label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, Lime, FontStyle.Bold);
                label.text = caption;
                Stretch(label.rectTransform, 2f);
            }
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
