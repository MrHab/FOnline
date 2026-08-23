using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Сайдбар глобальной карты в структуре web (#global-map-window .global-map-side,
    /// 03_hud_minimap_inventory_progression.css:362; текст — renderGlobalMapPanel,
    /// 12b_global_map_panel_window.js): заголовок «Глобальная карта», справа панель
    /// 340px с разделами МАРШРУТ (текст маршрута моноширинным), кнопки «Войти: …»
    /// и «Стоп / Покинуть группу», ДОСКА РАБОТ (работы площадки под игроком),
    /// СИСТЕМНЫЙ ЖУРНАЛ, ГРУППА. Контакт на маршруте — блок с «Войти / Обойти».
    /// Логика и серверные запросы остаются в RoaGlobalMap (фасад CanvasDriven…).
    /// </summary>
    public sealed class RoaGlobalMapCanvas : MonoBehaviour
    {
        private static readonly Color SideBg = new Color(0.03f, 0.07f, 0.045f, 1f);        // rgba(2,10,6,.72) на тёмном
        private static readonly Color SideBorder = new Color(0.494f, 0.784f, 0.357f, 0.34f);
        private static readonly Color Kicker = new Color(0.831f, 0.702f, 0.357f, 1f);      // #d4b35b
        private static readonly Color Mono = new Color(0.749f, 0.902f, 0.541f, 1f);        // #bfe68a
        private static readonly Color MonoBold = new Color(0.937f, 0.816f, 0.471f, 1f);    // #efd078
        private static readonly Color BoxBg = new Color(0.02f, 0.05f, 0.03f, 1f);
        private static readonly Color BoxBorder = new Color(0.494f, 0.784f, 0.357f, 0.28f);
        private static readonly Color BtnBg = new Color(0.165f, 0.141f, 0.098f, 1f);
        private static readonly Color BtnInk = new Color(0.898f, 0.78f, 0.486f, 1f);
        private static readonly Color BtnBorder = new Color(0.682f, 0.545f, 0.282f, 0.65f);
        private static readonly Color TitleInk = new Color(0.941f, 0.824f, 0.541f, 1f);

        public RoaGlobalMap Map;
        public RoaInteraction Interaction;
        public RoaHudCanvas HudCanvas;

        private Canvas _canvas;
        private GameObject _root;
        private Text _route;
        private Button _enterButton;
        private Text _enterLabel;
        private Button _cancelButton;
        private Text _cancelLabel;
        private RectTransform _contactBox;
        private Text _contactTitle;
        private Text _contactDetails;
        private Button _contactEnter;
        private Button _contactAvoid;
        private RectTransform _workList;
        private readonly List<GameObject> _workRows = new List<GameObject>();
        private Text _systemLog;
        private RectTransform _partyList;
        private readonly List<GameObject> _partyRows = new List<GameObject>();
        private float _refreshAt;
        private readonly List<string> _logLines = new List<string>();
        private string _lastStatus = string.Empty;

        /// <summary>Ширина сайдбара в единицах канвы (340 px как в web).</summary>
        public const float SidebarWidth = 340f;

        private void Update()
        {
            bool visible = Map != null && Map.CanvasDriven && Map.IsActive;
            if (!visible)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) { _root.SetActive(true); _refreshAt = 0f; }
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.3f;
            Refresh();
        }

        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("GlobalMapCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 35;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;

            _root = new GameObject("GlobalMapWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            Stretch(rootRect, 0f);

            // .panel-title: «ГЛОБАЛЬНАЯ КАРТА» слева сверху.
            Text title = Label("Title", rootRect, 12, TextAnchor.MiddleLeft, TitleInk, FontStyle.Bold);
            title.text = "ГЛОБАЛЬНАЯ КАРТА";
            Place(title.rectTransform, 0f, 1f, 0f, 1f, new Vector2(18f, -40f), new Vector2(420f, -14f));

            // .global-map-side
            RectTransform side = Child("Side", rootRect);
            side.anchorMin = new Vector2(1f, 0f);
            side.anchorMax = new Vector2(1f, 1f);
            side.pivot = new Vector2(1f, 0.5f);
            side.anchoredPosition = new Vector2(-14f, 0f);
            side.sizeDelta = new Vector2(SidebarWidth, -28f);
            side.gameObject.AddComponent<Image>().color = SideBg;
            var outline = side.gameObject.AddComponent<Outline>();
            outline.effectColor = SideBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            float y = 10f;
            KickerLabel(side, "Маршрут", ref y);
            RectTransform routeBox = Box(side, 118f, ref y);
            _route = Label("Route", routeBox, 12, TextAnchor.UpperLeft, Mono);
            _route.supportRichText = true;
            _route.horizontalOverflow = HorizontalWrapMode.Wrap;
            _route.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(_route.rectTransform, 9f);

            // .global-map-actions
            RectTransform actions = Child("Actions", side);
            Place(actions, 0f, 1f, 1f, 1f, new Vector2(10f, -y - 34f), new Vector2(-10f, -y));
            _enterButton = UiButton(actions, "Войти", out _enterLabel, () => Map.EnterCurrent());
            _enterLabel.fontSize = 10;
            _enterLabel.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place((RectTransform)_enterButton.transform, 0f, 0f, 0.62f, 1f, Vector2.zero, new Vector2(-4f, 0f));
            _cancelButton = UiButton(actions, "Стоп", out _cancelLabel, () => Map.CancelOrLeave());
            Place((RectTransform)_cancelButton.transform, 0.62f, 0f, 1f, 1f, new Vector2(4f, 0f), Vector2.zero);
            y += 34f + 9f;

            // Контакт на маршруте (global-encounter-panel): показывается поверх доски работ.
            _contactBox = Box(side, 110f, ref y);
            _contactTitle = Label("ContactTitle", _contactBox, 12, TextAnchor.UpperLeft, MonoBold, FontStyle.Bold);
            Place(_contactTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(9f, -26f), new Vector2(-9f, -8f));
            _contactDetails = Label("ContactDetails", _contactBox, 11, TextAnchor.UpperLeft, Mono);
            _contactDetails.horizontalOverflow = HorizontalWrapMode.Wrap;
            _contactDetails.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_contactDetails.rectTransform, 0f, 1f, 1f, 1f, new Vector2(9f, -66f), new Vector2(-9f, -28f));
            _contactEnter = UiButton(_contactBox, "Войти", out _, () => Map.ResolveContact(true));
            Place((RectTransform)_contactEnter.transform, 0f, 0f, 0.5f, 0f, new Vector2(9f, 8f), new Vector2(-3f, 36f));
            _contactAvoid = UiButton(_contactBox, "Обойти", out _, () => Map.ResolveContact(false));
            Place((RectTransform)_contactAvoid.transform, 0.5f, 0f, 1f, 0f, new Vector2(3f, 8f), new Vector2(-9f, 36f));
            _contactBox.gameObject.SetActive(false);
            y -= 110f + 9f; // бокс контакта накладывается на доску работ, когда виден

            KickerLabel(side, "Доска работ", ref y);
            _workList = ScrollBox(side, 0.30f, ref y);
            KickerLabel(side, "Системный журнал", ref y);
            RectTransform logBox = Box(side, 120f, ref y);
            _systemLog = Label("Log", logBox, 11, TextAnchor.UpperLeft, Mono);
            _systemLog.horizontalOverflow = HorizontalWrapMode.Wrap;
            _systemLog.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(_systemLog.rectTransform, 8f);
            KickerLabel(side, "Группа", ref y);
            _partyList = ScrollBox(side, 0.16f, ref y);

            _root.SetActive(false);
        }

        private void KickerLabel(RectTransform side, string caption, ref float y)
        {
            Text text = Label("Kicker", side, 11, TextAnchor.MiddleLeft, Kicker, FontStyle.Bold);
            text.text = caption.ToUpperInvariant();
            Place(text.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -y - 16f), new Vector2(-10f, -y));
            y += 16f + 5f;
        }

        private RectTransform Box(RectTransform side, float height, ref float y)
        {
            RectTransform box = Child("Box", side);
            Place(box, 0f, 1f, 1f, 1f, new Vector2(10f, -y - height), new Vector2(-10f, -y));
            box.gameObject.AddComponent<Image>().color = BoxBg;
            var outline = box.gameObject.AddComponent<Outline>();
            outline.effectColor = BoxBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            y += height + 9f;
            return box;
        }

        /// <summary>Прокручиваемый список фиксированной доли высоты сайдбара.</summary>
        private RectTransform ScrollBox(RectTransform side, float fraction, ref float y)
        {
            float height = Mathf.Round(fraction * 800f);
            RectTransform box = Box(side, height, ref y);
            var scroll = box.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.scrollSensitivity = 24f;
            box.gameObject.AddComponent<RectMask2D>();
            RectTransform list = Child("List", box);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero;
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 5f;
            layout.padding = new RectOffset(6, 6, 6, 6);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            list.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;
            return list;
        }

        // ------------------------------------------------------------------

        private void Refresh()
        {
            Vector2 player = Map.PlayerXY;
            Vector2 selected = Map.SelectedXY;
            Vector2Int playerCell = Map.CellOf(player);
            Vector2Int selectedCell = Map.CellOf(selected);
            string attached = Map.AttachedPartyId;

            // --- Маршрут (тексты renderGlobalMapPanel) ---
            if (Map.TravelActive)
            {
                int pct = Mathf.RoundToInt(Map.TravelProgress * 100f);
                _route.text = "<b><color=#efd078>Путь к: " + Map.SelectedTitle + "</color></b>\n"
                    + "Цель: клетка " + selectedCell.x + ":" + selectedCell.y + " · точка " + Mathf.RoundToInt(selected.x) + ":" + Mathf.RoundToInt(selected.y) + "\n"
                    + "Сейчас: точка " + Mathf.RoundToInt(player.x) + ":" + Mathf.RoundToInt(player.y) + " · прогресс " + pct + "% · осталось " + FormatSeconds(Map.TravelSecondsLeft) + "\n"
                    + "Дистанция " + Map.DistanceKm(player, selected).ToString("0.0") + " км"
                    + (Map.HasPendingContact ? "\nСобытие на маршруте." : string.Empty);
            }
            else if (!string.IsNullOrEmpty(attached))
            {
                _route.text = "<b><color=#efd078>Вы в караванной группе: " + attached + "</color></b>\n"
                    + "Сейчас: клетка " + playerCell.x + ":" + playerCell.y + " · точка " + Mathf.RoundToInt(player.x) + ":" + Mathf.RoundToInt(player.y) + "\n"
                    + "Движение: отряд ведёт маршрут. Собственный путь недоступен.";
            }
            else if (Map.PendingEntry)
            {
                _route.text = "<b><color=#efd078>" + Map.PendingEntryTitle + "</color></b>\n"
                    + "Клетка " + playerCell.x + ":" + playerCell.y + " · точка " + Mathf.RoundToInt(player.x) + ":" + Mathf.RoundToInt(player.y) + "\n"
                    + "Вы на месте. Нажмите «Войти», чтобы перейти в найденную локацию, или выберите новую точку маршрута.";
            }
            else
            {
                bool same = Map.PlayerAtSelection;
                GlobalMapNode playerNode = Map.PlayerNode;
                string where = same
                    ? (playerNode != null ? "Вы в зоне: " + Map.NodeTitle(playerNode) + "." : "Текущая точка пустоши.")
                    : "Дистанция: " + Map.DistanceKm(player, selected).ToString("0.0") + " км · опасность видна на карте";
                _route.text = "<b><color=#efd078>" + Map.SelectedTitle + "</color></b>\n"
                    + "Клетка " + selectedCell.x + ":" + selectedCell.y + " · точка " + Mathf.RoundToInt(selected.x) + ":" + Mathf.RoundToInt(selected.y) + "\n"
                    + where + "\n" + Map.SelectionSummary;
            }

            // --- Кнопки ---
            string enterLabel;
            bool canEnter = Map.CanEnter(out enterLabel);
            _enterLabel.text = enterLabel;
            SetButton(_enterButton, _enterLabel, canEnter);
            bool canCancel = (Map.TravelActive && !Map.ArrivalPending) || !string.IsNullOrEmpty(attached);
            _cancelLabel.text = string.IsNullOrEmpty(attached) ? "Стоп" : "Покинуть группу";
            SetButton(_cancelButton, _cancelLabel, canCancel && !Map.HasPendingContact);

            // --- Контакт на маршруте ---
            bool contact = Map.HasPendingContact;
            _contactBox.gameObject.SetActive(contact);
            if (contact)
            {
                _contactTitle.text = "Контакт: " + Map.PendingContactName;
                _contactDetails.text = Map.LocalIsLeader ? Map.PendingContactDetails : "Решение принимает лидер группы.";
                bool can = Map.LocalIsLeader && !Map.ContactDecisionPending;
                _contactEnter.interactable = can;
                _contactAvoid.interactable = can && !Map.PendingContactForced;
                _contactAvoid.gameObject.SetActive(!Map.PendingContactForced);
            }

            RefreshWorkBoard();
            RefreshLog();
            RefreshParty();
        }

        private void RefreshWorkBoard()
        {
            foreach (GameObject row in _workRows) Destroy(row);
            _workRows.Clear();
            JObject site = Map.PlayerSiteData();
            if (site == null)
            {
                AddNote(_workList, _workRows, "Доска работ доступна у поселения или точки мира.");
                return;
            }
            string siteId = site["id"]?.ToString() ?? string.Empty;
            AddNote(_workList, _workRows, site["name"]?.ToString() ?? siteId, true);
            int shown = 0;
            if (Interaction != null)
            {
                foreach (RoaInteraction.WorldTaskCard card in Interaction.PipboyWorldTasks(true))
                {
                    JToken issuer = null;
                    foreach (JToken token in Map.WastelandState?["worldTasks"] as JArray ?? new JArray())
                        if (token?["id"]?.ToString() == card.Id) issuer = token["issuerSiteId"] ?? token["siteId"];
                    if (issuer?.ToString() != siteId) continue;
                    AddWorkRow(card);
                    shown++;
                }
            }
            if (shown == 0) AddNote(_workList, _workRows, "Работ на этой доске нет.");
        }

        private void AddWorkRow(RoaInteraction.WorldTaskCard card)
        {
            var row = new GameObject("Work:" + card.Id, typeof(RectTransform));
            row.transform.SetParent(_workList, false);
            bool hasButton = card.AcceptLabel != null || card.TrackLabel != null;
            row.AddComponent<LayoutElement>().preferredHeight = hasButton ? 66f : 40f;
            row.AddComponent<Image>().color = new Color(0.04f, 0.09f, 0.055f, 1f);
            var outline = row.AddComponent<Outline>();
            outline.effectColor = BoxBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var rect = (RectTransform)row.transform;
            Text title = Label("Title", rect, 11, TextAnchor.UpperLeft, MonoBold, FontStyle.Bold);
            title.text = card.Label.ToUpperInvariant() + " · " + card.Title;
            title.verticalOverflow = VerticalWrapMode.Truncate;
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(6f, -20f), new Vector2(-6f, -4f));
            Text reward = Label("Reward", rect, 10, TextAnchor.UpperLeft, Mono);
            reward.text = card.Reward;
            reward.verticalOverflow = VerticalWrapMode.Truncate;
            Place(reward.rectTransform, 0f, 1f, 1f, 1f, new Vector2(6f, -36f), new Vector2(-6f, -22f));
            if (hasButton)
            {
                string id = card.Id;
                string caption = card.AcceptLabel ?? card.TrackLabel;
                bool enabled = card.AcceptLabel == null || card.CanAccept;
                string action = card.AcceptLabel != null ? "accept" : "track";
                Button button = UiButton(rect, caption, out Text label, () => Interaction.PipboyWorldTaskAction(id, action));
                Place((RectTransform)button.transform, 0f, 0f, 0.6f, 0f, new Vector2(6f, 4f), new Vector2(0f, 26f));
                SetButton(button, label, enabled);
            }
            _workRows.Add(row);
        }

        private void RefreshLog()
        {
            string status = Map.StatusText ?? string.Empty;
            if (!string.IsNullOrEmpty(status) && status != _lastStatus)
            {
                _lastStatus = status;
                _logLines.Add(status);
                while (_logLines.Count > 6) _logLines.RemoveAt(0);
            }
            _systemLog.text = _logLines.Count == 0
                ? "События маршрута и системные сообщения появятся здесь."
                : string.Join("\n", _logLines);
        }

        private void RefreshParty()
        {
            foreach (GameObject row in _partyRows) Destroy(row);
            _partyRows.Clear();
            string attached = Map.AttachedPartyId;
            string self = HudCanvas != null ? null : null;
            AddPartyRow("Вы", string.IsNullOrEmpty(attached) ? "Лидер" : "в отряде");
            if (!string.IsNullOrEmpty(attached)) AddPartyRow(attached, "караван");
        }

        private void AddPartyRow(string name, string meta)
        {
            var row = new GameObject("Party", typeof(RectTransform));
            row.transform.SetParent(_partyList, false);
            row.AddComponent<LayoutElement>().preferredHeight = 20f;
            var rect = (RectTransform)row.transform;
            Text n = Label("Name", rect, 12, TextAnchor.MiddleLeft, MonoBold, FontStyle.Bold);
            n.text = name;
            Place(n.rectTransform, 0f, 0f, 0.7f, 1f, new Vector2(2f, 0f), Vector2.zero);
            Text m = Label("Meta", rect, 11, TextAnchor.MiddleRight, Mono);
            m.text = meta;
            Place(m.rectTransform, 0.5f, 0f, 1f, 1f, Vector2.zero, new Vector2(-2f, 0f));
            _partyRows.Add(row);
        }

        private void AddNote(RectTransform list, List<GameObject> rows, string text, bool bold = false)
        {
            var row = new GameObject("Note", typeof(RectTransform));
            row.transform.SetParent(list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 18f;
            Text label = Label("Text", (RectTransform)row.transform, 11, TextAnchor.MiddleLeft, bold ? MonoBold : new Color(Mono.r, Mono.g, Mono.b, 0.62f), bold ? FontStyle.Bold : FontStyle.Normal);
            label.text = text;
            label.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(label.rectTransform, 2f);
            rows.Add(row);
        }

        private static string FormatSeconds(float seconds)
        {
            int total = Mathf.CeilToInt(seconds);
            return total >= 60 ? (total / 60) + " мин " + (total % 60) + " с" : total + " с";
        }

        private static void SetButton(Button button, Text label, bool enabled)
        {
            button.interactable = enabled;
            button.GetComponent<Image>().color = enabled ? BtnBg : new Color(BtnBg.r, BtnBg.g, BtnBg.b, 0.5f);
            label.color = enabled ? BtnInk : new Color(BtnInk.r, BtnInk.g, BtnInk.b, 0.45f);
        }

        // --- Утилиты ---------------------------------------------------------

        private static Button UiButton(RectTransform parent, string caption, out Text label, System.Action onClick)
        {
            var go = new GameObject("Btn:" + caption, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = BtnBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = BtnBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, 11, TextAnchor.MiddleCenter, BtnInk, FontStyle.Bold);
            label.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(label.rectTransform, 4f);
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
