using System.Collections.Generic;
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
        private readonly Image[] _apocalypseSlotIcons = new Image[RoaQuickbar.SlotCount];
        private RectTransform _apocalypseApLampRow;
        private GameObject _apocalypseApLampSample;
        private readonly List<RectTransform> _apocalypseApLamps = new List<RectTransform>();
        private GameObject _apocalypseWeapon;
        private TextMeshProUGUI _apocalypseWeaponName;
        private TextMeshProUGUI _apocalypseWeaponAmmo;
        private Image _apocalypseWeaponIcon;
        private readonly Toggle[] _apocalypseBullets = new Toggle[16];
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
            GameObject source = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_HotBar_03");
            Transform sourceItems = source != null ? source.transform.Find("ActionBar") : null;
            if (sourceItems == null) return false;
            for (int i = 0; i < RoaQuickbar.SlotCount; i++)
                if (sourceItems.Find("Item_" + i.ToString("00")) == null) return false;
            if (sourceItems.Find("Item_00/Greeble_MetalValve01") == null) return false;

            Image panelBackground = panel.GetComponent<Image>();
            if (panelBackground != null) panelBackground.enabled = false;
            Outline panelBorder = panel.GetComponent<Outline>();
            if (panelBorder != null) panelBorder.enabled = false;

            _apocalypseActionBar = Instantiate(source, panel, false);
            _apocalypseActionBar.name = "ApocalypseHotBar";
            RectTransform bar = (RectTransform)_apocalypseActionBar.transform;
            bar.anchorMin = bar.anchorMax = new Vector2(0.5f, 0f);
            bar.pivot = new Vector2(0.5f, 0f);
            bar.anchoredPosition = new Vector2(0f, 50f);
            bar.localScale = Vector3.one * 0.5f;
            panel.sizeDelta = new Vector2(800f, 170f);
            foreach (Animator animator in bar.GetComponentsInChildren<Animator>(true))
                animator.enabled = false;
            foreach (Graphic graphic in bar.GetComponentsInChildren<Graphic>(true))
            {
                graphic.raycastTarget = false;
                if (!(graphic is Image)) graphic.enabled = false;
            }

            Transform items = bar.Find("ActionBar");
            for (int i = 0; i < RoaQuickbar.SlotCount; i++)
            {
                int index = i;
                Transform slot = items.Find("Item_" + i.ToString("00"));
                Button button = slot.GetComponent<Button>();
                if (button == null) return false;
                button.onClick = new Button.ButtonClickedEvent();
                button.onClick.AddListener(() => _quickbar?.TriggerSlot(index));
                Image plate = slot.GetComponent<Image>();
                if (plate != null) plate.raycastTarget = true;
                foreach (string part in new[] { "Highlighted", "Selected",
                    "Item/Slider - Vertical" })
                {
                    Transform child = slot.Find(part);
                    if (child != null) child.gameObject.SetActive(false);
                }
                Transform lamp = slot.Find("Greeble_MetalValve01");
                if (lamp != null)
                {
                    if (i == 0) _apocalypseApLampSample = lamp.gameObject;
                    lamp.gameObject.SetActive(false);
                }
                Transform icon = slot.Find("Item/Icon");
                if (icon != null)
                {
                    _apocalypseSlotIcons[i] = icon.GetComponent<Image>();
                    if (_apocalypseSlotIcons[i] != null)
                        _apocalypseSlotIcons[i].enabled = false;
                }
                _slotButtons[i] = button;
            }

            GameObject lampRow = new GameObject("ActionPointLamps", typeof(RectTransform));
            _apocalypseApLampRow = (RectTransform)lampRow.transform;
            _apocalypseApLampRow.SetParent(bar, false);
            _apocalypseApLampRow.anchorMin = _apocalypseApLampRow.anchorMax =
                new Vector2(0.5f, 0f);
            _apocalypseApLampRow.pivot = new Vector2(0.5f, 0f);
            _apocalypseApLampRow.anchoredPosition = Vector2.zero;
            _apocalypseApLampRow.sizeDelta = new Vector2(800f, 260f);
            for (int i = 0; i < RoaQuickbar.SlotCount; i++)
            {
                Text number = Label("LiveSlotLabel_" + i, bar, Vector2.zero,
                    new Vector2(78f, 42f), 30, TextAnchor.MiddleCenter,
                    Color.white);
                RectTransform label = number.rectTransform;
                label.anchorMin = label.anchorMax = new Vector2(0.5f, 0f);
                label.pivot = new Vector2(0.5f, 0.5f);
                label.anchoredPosition = new Vector2((i - 2.5f) * 133f, -25f);
                number.text = (i + 1).ToString();
                _slotTexts[i] = number;
            }
            _quickStatus = Label("Status", panel, new Vector2(10f, 5f),
                new Vector2(778f, 18f), 11, TextAnchor.MiddleCenter, MutedInk);
            return true;
        }

        private void RefreshApocalypseActionBar()
        {
            if (_quickbar == null || _hud == null) return;
            RefreshApocalypseApLamps(_hud.MaxAp, _hud.Ap);

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
                Transform selected = _slotButtons[i].transform.Find("Selected");
                if (selected != null)
                    selected.gameObject.SetActive(_quickbar.IsSlotActive(i));
            }
            _quickStatus.text = _quickbar.CanvasStatus;
        }

        private void RefreshApocalypseApLamps(int maxAp, float currentAp)
        {
            if (_apocalypseApLampRow == null || _apocalypseApLampSample == null) return;
            int count = Mathf.Clamp(maxAp, 0, 99);
            while (_apocalypseApLamps.Count < count)
            {
                GameObject lamp = Instantiate(_apocalypseApLampSample,
                    _apocalypseApLampRow, false);
                lamp.name = "ActionPoint_" + (_apocalypseApLamps.Count + 1).ToString("00");
                lamp.SetActive(true);
                RectTransform rect = (RectTransform)lamp.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                foreach (Graphic graphic in lamp.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                _apocalypseApLamps.Add(rect);
            }

            int lit = Mathf.Clamp(Mathf.FloorToInt(currentAp), 0, count);
            int columns = count <= 12 ? count : count <= 24 ? 12
                : Mathf.CeilToInt(count / 3f);
            float pitch = columns > 0 ? Mathf.Min(105f, 720f / columns) : 105f;
            float scale = Mathf.Min(0.48f, pitch * 0.8f / 120f);
            for (int i = 0; i < _apocalypseApLamps.Count; i++)
            {
                RectTransform lamp = _apocalypseApLamps[i];
                bool shown = i < count;
                lamp.gameObject.SetActive(shown);
                if (!shown) continue;
                int row = i / columns;
                int rowCount = Mathf.Min(columns, count - row * columns);
                int column = i % columns;
                lamp.anchoredPosition = new Vector2(
                    (column - (rowCount - 1) * 0.5f) * pitch, 190f + row * 55f);
                lamp.localScale = Vector3.one * scale;
                Transform glow = lamp.Find("Valve_Active");
                if (glow != null) glow.gameObject.SetActive(i < lit);
            }
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
            if (_apocalypseActionBar != null)
                _apocalypseActionBar.transform.localScale = Vector3.one *
                    (mobile ? 0.625f : 0.5f);
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
