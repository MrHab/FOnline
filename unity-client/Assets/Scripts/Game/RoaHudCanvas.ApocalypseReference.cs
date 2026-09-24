using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using TMPro;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaHudCanvas
    {
        private GameObject _apocalypseCompass;
        private RectTransform _apocalypseCompassTape;
        private GameObject _apocalypseActionBar;
        private Slider _apocalypseXpSlider;
        private Slider _apocalypseHpReservoir;
        private Slider _apocalypseApReservoir;
        private Text _apocalypseXpLabel;
        private Text _apocalypseBarLevel;
        private readonly Image[] _apocalypseSlotIcons = new Image[RoaQuickbar.SlotCount];
        private GameObject _apocalypseWeapon;
        private TextMeshProUGUI _apocalypseWeaponName;
        private TextMeshProUGUI _apocalypseWeaponAmmo;
        private Image _apocalypseWeaponIcon;
        private readonly Toggle[] _apocalypseBullets = new Toggle[16];
        private GameObject _apocalypseApLamps;
        private readonly GameObject[] _apocalypseApGlow = new GameObject[6];
        private Text _apocalypseApLabel;
        private GameObject _apocalypseQuest;
        private TextMeshProUGUI _apocalypseQuestTitle;
        private readonly TextMeshProUGUI[] _apocalypseQuestRows =
            new TextMeshProUGUI[3];
        private readonly GameObject[] _apocalypseQuestItems = new GameObject[3];
        private GameObject _apocalypseLevelUp;
        private Text _apocalypseLevelNumber;
        private Image _apocalypseCursor;
        private int _observedLevel = -1;
        private float _levelUpUntil;

        private bool TryBuildApocalypseActionBar(RectTransform panel)
        {
            GameObject screen = Resources.Load<GameObject>(
                "ApocalypseHud/Screen_HUD_Apocalypse_ARPG_01");
            Transform source = screen != null
                ? screen.transform.Find("ScreenSpace/Bottom/HUD_ARPGBar_02") : null;
            if (source == null) return false;
            Transform sourceItems = source.Find("Bar_Items");
            if (sourceItems == null || sourceItems.childCount < RoaQuickbar.SlotCount)
                return false;

            Image panelBackground = panel.GetComponent<Image>();
            if (panelBackground != null) panelBackground.enabled = false;
            Outline panelBorder = panel.GetComponent<Outline>();
            if (panelBorder != null) panelBorder.enabled = false;

            _apocalypseActionBar = Instantiate(source.gameObject, panel, false);
            _apocalypseActionBar.name = "ApocalypseARPGBar";
            RectTransform bar = (RectTransform)_apocalypseActionBar.transform;
            bar.anchorMin = bar.anchorMax = new Vector2(0.5f, 0f);
            bar.pivot = new Vector2(0.5f, 0f);
            bar.anchoredPosition = new Vector2(0f, 75f);
            bar.localScale = Vector3.one * 0.55f;
            panel.sizeDelta = new Vector2(798f, 132f);
            foreach (Animator animator in bar.GetComponentsInChildren<Animator>(true))
                animator.enabled = false;
            foreach (Graphic graphic in bar.GetComponentsInChildren<Graphic>(true))
            {
                graphic.raycastTarget = false;
                if (!(graphic is Image)) graphic.enabled = false;
            }

            Transform items = bar.Find("Bar_Items");
            for (int i = 0; i < RoaQuickbar.SlotCount; i++)
            {
                int index = i;
                Transform slot = items.GetChild(i);
                Button button = slot.GetComponent<Button>();
                if (button == null) return false;
                button.onClick = new Button.ButtonClickedEvent();
                button.onClick.AddListener(() => _quickbar?.TriggerSlot(index));
                Image plate = slot.GetComponent<Image>();
                if (plate != null) plate.raycastTarget = true;
                foreach (string part in new[] { "Input", "Item/Highlighted",
                    "Item/Selected", "Item/HUD_ActionBar_Item/Cooldown",
                    "Item/HUD_ActionBar_Item/Flash" })
                {
                    Transform child = slot.Find(part);
                    if (child != null) child.gameObject.SetActive(false);
                }
                Transform icon = slot.Find("Item/HUD_ActionBar_Item/Item/Icon");
                if (icon != null)
                {
                    _apocalypseSlotIcons[i] = icon.GetComponent<Image>();
                    if (_apocalypseSlotIcons[i] != null)
                        _apocalypseSlotIcons[i].enabled = false;
                }
                _slotButtons[i] = button;
                _slotTexts[i] = Label("LiveSlotLabel", slot,
                    Vector2.zero, new Vector2(120f, 120f), 28,
                    TextAnchor.LowerCenter, Color.white, FontStyle.Bold);
                Stretch(_slotTexts[i].rectTransform, new Vector2(5f, 3f));
            }

            _apocalypseXpSlider = bar.Find("XPBar/HUD_XPBar/Slider_Horizontal")
                ?.GetComponent<Slider>();
            _apocalypseHpReservoir = bar.Find("Container_L/Container/Slider_Vertical")
                ?.GetComponent<Slider>();
            _apocalypseApReservoir = bar.Find("Container_R/Container/Slider_Vertical")
                ?.GetComponent<Slider>();
            foreach (Slider slider in new[] { _apocalypseXpSlider,
                _apocalypseHpReservoir, _apocalypseApReservoir })
            {
                if (slider == null) continue;
                slider.interactable = false;
                slider.minValue = 0f;
                slider.maxValue = 1f;
            }
            Transform xp = bar.Find("XPBar/HUD_XPBar");
            if (xp != null)
            {
                _apocalypseXpLabel = Label("LiveXp", xp, Vector2.zero,
                    new Vector2(400f, 40f), 30, TextAnchor.MiddleCenter,
                    Color.white, FontStyle.Bold);
                Stretch(_apocalypseXpLabel.rectTransform, Vector2.zero);
            }
            Transform level = bar.Find("HUD_PlayerLevel/Content");
            if (level != null)
            {
                _apocalypseBarLevel = Label("LiveLevel", level, Vector2.zero,
                    new Vector2(60f, 60f), 23, TextAnchor.MiddleCenter,
                    Color.white, FontStyle.Bold);
                Stretch(_apocalypseBarLevel.rectTransform, Vector2.zero);
            }
            _quickStatus = Label("Status", panel, new Vector2(10f, 5f),
                new Vector2(778f, 18f), 11, TextAnchor.MiddleCenter, MutedInk);
            return true;
        }

        private void RefreshApocalypseActionBar()
        {
            if (_quickbar == null || _hud == null) return;
            if (_apocalypseXpSlider != null)
                _apocalypseXpSlider.value = Mathf.Clamp01((float)_hud.Xp /
                    Mathf.Max(1, _hud.XpNeeded));
            if (_apocalypseXpLabel != null)
                _apocalypseXpLabel.text = _hud.Xp + "/" + Mathf.Max(1, _hud.XpNeeded);
            if (_apocalypseBarLevel != null)
                _apocalypseBarLevel.text = _hud.Level.ToString();
            if (_apocalypseHpReservoir != null)
                _apocalypseHpReservoir.value = _hud.MaxHp > 0
                    ? Mathf.Clamp01((float)_hud.Hp / _hud.MaxHp) : 0f;
            if (_apocalypseApReservoir != null)
                _apocalypseApReservoir.value = _hud.MaxAp > 0
                    ? Mathf.Clamp01(_hud.Ap / _hud.MaxAp) : 0f;

            for (int i = 0; i < _slotButtons.Length; i++)
            {
                string item = i < _quickbar.Slots.Count ? _quickbar.Slots[i] : string.Empty;
                Sprite sprite = RoaApocalypseItemIcons.For(item);
                Image icon = _apocalypseSlotIcons[i];
                if (icon != null)
                {
                    icon.sprite = sprite;
                    icon.enabled = sprite != null;
                    icon.preserveAspect = true;
                    icon.color = _quickbar.IsSlotAvailable(i) ? Color.white
                        : new Color(0.5f, 0.5f, 0.5f, 0.7f);
                }
                _slotTexts[i].text = sprite != null
                    ? (i + 1).ToString() : _quickbar.SlotLabel(i, item);
                Transform selected = _slotButtons[i].transform.Find("Item/Selected");
                if (selected != null)
                    selected.gameObject.SetActive(_quickbar.IsSlotActive(i));
            }
            _quickStatus.text = _quickbar.CanvasStatus;
        }

        private void BuildApocalypseReferenceOverlays()
        {
            GameObject questPrefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_Objective_02");
            if (questPrefab != null)
            {
                _apocalypseQuest = Instantiate(questPrefab, _safeRoot, false);
                _apocalypseQuest.name = "ApocalypseCurrentQuest";
                RectTransform rect = (RectTransform)_apocalypseQuest.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(1f, 1f);
                rect.pivot = new Vector2(1f, 1f);
                rect.anchoredPosition = new Vector2(108f, -225f);
                rect.localScale = Vector3.one * 0.27f;
                _apocalypseQuestTitle = rect.Find(
                    "Content/HUD_ChapterHeader/Content/Label_Location")
                    ?.GetComponent<TextMeshProUGUI>();
                for (int i = 0; i < _apocalypseQuestRows.Length; i++)
                {
                    Transform item = rect.Find("Content/Objective_List/Objective_Item_"
                        + i.ToString("00"));
                    _apocalypseQuestItems[i] = item != null ? item.gameObject : null;
                    _apocalypseQuestRows[i] = item?.Find("Content/Text/Label_Objective")
                        ?.GetComponent<TextMeshProUGUI>();
                }
                foreach (Animator animator in rect.GetComponentsInChildren<Animator>(true))
                    animator.enabled = false;
                foreach (Graphic graphic in rect.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                _apocalypseQuest.SetActive(false);
            }

            GameObject lampPrefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_HotBar_03");
            if (lampPrefab != null)
            {
                _apocalypseApLamps = Instantiate(lampPrefab, _safeRoot, false);
                _apocalypseApLamps.name = "ApocalypseActionPoints";
                RectTransform rect = (RectTransform)_apocalypseApLamps.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0f);
                rect.pivot = new Vector2(0.5f, 0f);
                rect.anchoredPosition = new Vector2(0f, 145f);
                rect.localScale = Vector3.one * 0.42f;
                Transform actionBar = rect.Find("ActionBar");
                if (actionBar != null)
                {
                    Transform frame = actionBar.Find("Frame");
                    if (frame != null) frame.gameObject.SetActive(false);
                    for (int i = 0; i < _apocalypseApGlow.Length; i++)
                    {
                        Transform item = actionBar.Find("Item_" + i.ToString("00"));
                        if (item == null) continue;
                        foreach (Transform child in item)
                            if (child.name != "Greeble_MetalValve01")
                                child.gameObject.SetActive(false);
                        Image image = item.GetComponent<Image>();
                        if (image != null) image.enabled = false;
                        Button button = item.GetComponent<Button>();
                        if (button != null) button.enabled = false;
                        Transform valve = item.Find("Greeble_MetalValve01");
                        if (valve != null)
                        {
                            valve.localScale = Vector3.one * 0.48f;
                            Transform glow = valve.Find("Valve_Active");
                            _apocalypseApGlow[i] = glow != null ? glow.gameObject : null;
                        }
                    }
                }
                foreach (Animator animator in rect.GetComponentsInChildren<Animator>(true))
                    animator.enabled = false;
                foreach (Graphic graphic in rect.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                _apocalypseApLabel = Label("LiveActionPoints", rect,
                    new Vector2(0f, 0f), new Vector2(250f, 40f), 24,
                    TextAnchor.MiddleCenter, Color.white, FontStyle.Bold);
                RectTransform apLabelRect = _apocalypseApLabel.rectTransform;
                apLabelRect.anchorMin = apLabelRect.anchorMax = new Vector2(0.5f, 0f);
                apLabelRect.pivot = new Vector2(0.5f, 0f);
                apLabelRect.anchoredPosition = new Vector2(0f, -15f);
                _apocalypseApLabel.raycastTarget = false;
                _apocalypseApLabel.enabled = false;
                _apocalypseApLamps.SetActive(false);
            }

            GameObject weaponPrefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_CurrentWeapon_02");
            if (weaponPrefab != null)
            {
                _apocalypseWeapon = Instantiate(weaponPrefab, _safeRoot, false);
                _apocalypseWeapon.name = "ApocalypseEquippedWeapon";
                RectTransform rect = (RectTransform)_apocalypseWeapon.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(1f, 0f);
                rect.pivot = new Vector2(1f, 0f);
                rect.anchoredPosition = new Vector2(-16f, 185f);
                rect.localScale = Vector3.one * 0.36f;
                _apocalypseWeaponName = rect.Find("Label_GunName")
                    ?.GetComponent<TextMeshProUGUI>();
                _apocalypseWeaponAmmo = rect.Find("Label_AmmoCount")
                    ?.GetComponent<TextMeshProUGUI>();
                _apocalypseWeaponIcon = rect.Find("Icon_CurrentWeapon")
                    ?.GetComponent<Image>();
                for (int i = 0; i < _apocalypseBullets.Length; i++)
                    _apocalypseBullets[i] = rect.Find("Ammo List/Toggle_Bullet_" + i.ToString("00"))
                        ?.GetComponent<Toggle>();
                foreach (Animator animator in rect.GetComponentsInChildren<Animator>(true))
                    animator.enabled = false;
                foreach (Graphic graphic in rect.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                _apocalypseWeapon.SetActive(false);
            }

            GameObject compassPrefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_Compass_03");
            if (compassPrefab != null)
            {
                _apocalypseCompass = Instantiate(compassPrefab, _safeRoot, false);
                _apocalypseCompass.name = "ApocalypseCompass";
                RectTransform rect = (RectTransform)_apocalypseCompass.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 1f);
                rect.pivot = new Vector2(0.5f, 1f);
                rect.anchoredPosition = new Vector2(0f, -6f);
                rect.localScale = Vector3.one * 0.30f;
                _apocalypseCompassTape = rect.Find("Content/Compass_Content") as RectTransform;
                Transform sampleIcons = rect.Find("Content/Compass_Content/Mask/Icons");
                if (sampleIcons != null) sampleIcons.gameObject.SetActive(false);
                foreach (Graphic graphic in rect.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                _apocalypseCompass.SetActive(false);
            }

            GameObject levelPrefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_Event_LevelUp_01");
            if (levelPrefab != null)
            {
                _apocalypseLevelUp = Instantiate(levelPrefab, _safeRoot, false);
                _apocalypseLevelUp.name = "ApocalypseLevelUp";
                RectTransform rect = (RectTransform)_apocalypseLevelUp.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                rect.anchoredPosition = new Vector2(0f, 50f);
                rect.localScale = Vector3.one * 0.38f;
                foreach (Animator animator in rect.GetComponentsInChildren<Animator>(true))
                    animator.enabled = false;
                foreach (CanvasGroup group in rect.GetComponentsInChildren<CanvasGroup>(true))
                {
                    group.alpha = 1f;
                    group.blocksRaycasts = false;
                    group.interactable = false;
                }
                foreach (Graphic graphic in rect.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                Transform number = rect.Find("LevelBox/Label_PlayerLevel");
                if (number != null)
                {
                    Behaviour sampleText = number.GetComponent("TextMeshProUGUI") as Behaviour;
                    if (sampleText != null) sampleText.enabled = false;
                    _apocalypseLevelNumber = Label("LiveLevelNumber", number,
                        Vector2.zero, new Vector2(220f, 195f), 86,
                        TextAnchor.MiddleCenter, new Color(0.20f, 0.17f, 0.11f),
                        FontStyle.Bold);
                    Stretch(_apocalypseLevelNumber.rectTransform, Vector2.zero);
                    _apocalypseLevelNumber.raycastTarget = false;
                }
                _apocalypseLevelUp.SetActive(false);
            }

            Sprite crosshair = Resources.Load<Sprite>(
                "ApocalypseHud/SPR_Apocalypse_MouseCursor_Crosshair_01");
            if (crosshair != null)
            {
                RectTransform rect = Rect("ApocalypseCursor", _canvas.transform,
                    Vector2.zero, Vector2.zero, new Vector2(0.5f, 0.5f),
                    Vector2.zero, new Vector2(30f, 30f));
                _apocalypseCursor = rect.gameObject.AddComponent<Image>();
                _apocalypseCursor.sprite = crosshair;
                _apocalypseCursor.preserveAspect = true;
                _apocalypseCursor.raycastTarget = false;
                _apocalypseCursor.gameObject.SetActive(false);
            }
        }

        private void RefreshApocalypseReferenceOverlays(bool worldHud, bool mobile)
        {
            bool visible = worldHud && _hud != null && _hud.HasState;
            if (_apocalypseQuest != null)
            {
                RectTransform quest = (RectTransform)_apocalypseQuest.transform;
                quest.localScale = Vector3.one * (mobile ? 0.30f : 0.27f);
                quest.anchoredPosition = new Vector2(mobile ? 160f : 108f, -225f);
            }
            RefreshApocalypseCurrentQuest(visible);
            if (_apocalypseApLamps != null)
            {
                _apocalypseApLamps.SetActive(visible);
                RectTransform lamps = (RectTransform)_apocalypseApLamps.transform;
                lamps.localScale = Vector3.one * (mobile ? 0.32f : 0.42f);
                lamps.anchoredPosition = new Vector2(0f, mobile ? 180f : 145f);
                if (visible)
                {
                    int lit = _hud.MaxAp > 0 ? Mathf.CeilToInt(
                        Mathf.Clamp01(_hud.Ap / _hud.MaxAp) * _apocalypseApGlow.Length) : 0;
                    for (int i = 0; i < _apocalypseApGlow.Length; i++)
                        if (_apocalypseApGlow[i] != null)
                            _apocalypseApGlow[i].SetActive(i < lit);
                    if (_apocalypseApLabel != null)
                        _apocalypseApLabel.text = "ОД " + Mathf.FloorToInt(_hud.Ap)
                            + "/" + _hud.MaxAp;
                }
            }
            if (_apocalypseWeapon != null)
            {
                _apocalypseWeapon.SetActive(visible && _hud.WeaponId != "fists");
                if (visible)
                {
                    if (_apocalypseWeaponName != null)
                        _apocalypseWeaponName.text = RoaWeaponData.Get(_hud.WeaponId).Name;
                    if (_apocalypseWeaponAmmo != null)
                        _apocalypseWeaponAmmo.text = _hud.MagSize > 0
                            ? _hud.Loaded + "/" + _hud.ReserveAmmo : "—";
                    if (_apocalypseWeaponIcon != null)
                    {
                        _apocalypseWeaponIcon.sprite = RoaApocalypseItemIcons.For(_hud.WeaponId);
                        _apocalypseWeaponIcon.enabled = _apocalypseWeaponIcon.sprite != null;
                        _apocalypseWeaponIcon.preserveAspect = true;
                    }
                    for (int i = 0; i < _apocalypseBullets.Length; i++)
                        if (_apocalypseBullets[i] != null)
                            _apocalypseBullets[i].isOn = i < _hud.Loaded;
                }
            }
            if (_apocalypseCompass != null)
            {
                _apocalypseCompass.SetActive(visible);
                if (_apocalypseCompassTape != null && _minimap != null && _minimap.HasPlayer)
                {
                    float heading = Mathf.DeltaAngle(0f, _minimap.PlayerHeading);
                    _apocalypseCompassTape.anchoredPosition = new Vector2(
                        -heading * (3200f / 360f), 0f);
                }
            }

            if (_hud != null && _hud.HasState)
            {
                int level = _hud.Level;
                if (_observedLevel >= 0 && level > _observedLevel)
                    _levelUpUntil = Time.unscaledTime + 3.5f;
                _observedLevel = level;
                if (_apocalypseLevelNumber != null)
                    _apocalypseLevelNumber.text = level.ToString();
            }
            else _observedLevel = -1;
            if (_apocalypseLevelUp != null)
                _apocalypseLevelUp.SetActive(visible && Time.unscaledTime < _levelUpUntil);

            if (_apocalypseCursor != null)
            {
                bool overUi = EventSystem.current != null
                    && EventSystem.current.IsPointerOverGameObject();
                bool show = visible && !mobile && !overUi && !RoaHudLayout.Editing;
                _apocalypseCursor.gameObject.SetActive(show);
                if (show)
                {
                    RectTransform rect = (RectTransform)_apocalypseCursor.transform;
                    Vector2 pointer = Input.mousePosition;
                    rect.anchoredPosition = pointer / Mathf.Max(0.01f, _canvas.scaleFactor);
                }
                Cursor.visible = !show;
            }
        }

        private void RefreshApocalypseCurrentQuest(bool visible)
        {
            if (_apocalypseQuest == null) return;
            JObject journal = RoaGameBootstrap.Active?.Pipboy?.Self?
                ["kromkaQuestJournal"] as JObject;
            JObject current = null;
            if (journal != null)
            {
                foreach (string section in new[] { "campaign", "mechanic", "personal" })
                {
                    foreach (JObject quest in journal[section] as JArray ?? new JArray())
                    {
                        string status = quest.Value<string>("status") ?? string.Empty;
                        if (status != "active" && status != "choice" && status != "turnin")
                            continue;
                        current = quest;
                        break;
                    }
                    if (current != null) break;
                }
                if (current == null && journal["factions"] is JObject factions)
                    foreach (JProperty faction in factions.Properties())
                    {
                        foreach (JObject quest in faction.Value as JArray ?? new JArray())
                        {
                            if (quest.Value<string>("status") != "active") continue;
                            current = quest;
                            break;
                        }
                        if (current != null) break;
                    }
            }
            _apocalypseQuest.SetActive(visible && current != null);
            if (!visible || current == null) return;
            if (_apocalypseQuestTitle != null)
                _apocalypseQuestTitle.text = current.Value<string>("title") ?? "Задание";
            string objective = current.Value<string>("currentObjectiveLabel") ?? string.Empty;
            int count = current.Value<int?>("objectiveProgressCurrent") ?? 0;
            int target = current.Value<int?>("objectiveProgressTarget") ?? 0;
            if (target > 1) objective += " (" + count + "/" + target + ")";
            string hint = current.Value<string>("currentObjectiveHint") ?? string.Empty;
            string[] lines = { objective, hint, string.Empty };
            for (int i = 0; i < _apocalypseQuestRows.Length; i++)
            {
                bool show = !string.IsNullOrWhiteSpace(lines[i]);
                if (_apocalypseQuestItems[i] != null)
                    _apocalypseQuestItems[i].SetActive(show);
                if (_apocalypseQuestRows[i] != null)
                    _apocalypseQuestRows[i].text = lines[i];
            }
        }

        private void ReleaseApocalypseReferenceOverlays()
        {
            if (_apocalypseCursor != null) Cursor.visible = true;
        }
    }
}
