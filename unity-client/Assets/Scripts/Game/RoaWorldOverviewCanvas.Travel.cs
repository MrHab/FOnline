using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Карта мира у проводника. Разговор с ним открывает карту в режиме выбора города:
    /// города, куда он ведёт, подсвечены на рельефе, над каждым — кнопка с именем и
    /// расстоянием. Нажатие на кнопку или на сектор такого города просит сервер о дороге;
    /// сервер переносит персонажа (serverWorldTransfer), и карта закрывается. Проводник
    /// ведёт бесплатно, но только налегке — строка под шапкой называет условие, а если
    /// идти пока нельзя, то и причину от сервера, ещё до нажатия.
    /// </summary>
    public sealed partial class RoaWorldOverviewCanvas
    {
        public const string TravelRules = "Проводник ведёт бесплатно, но только налегке: без экипировки и с пустым рюкзаком. Марки остаются на счёте.";
        private const float TravelButtonWidth = 176f;
        private const float TravelButtonHeight = 46f;
        // Кадр карты под шапкой с полосой условий (62 + 50) и над нижней строкой (48), в единицах канвы.
        private const float TravelTopReserve = 112f;
        private const float TravelBottomReserve = 48f;

        private static readonly Color TravelButtonBg = new Color(0.33f, 0.24f, 0.07f, 0.95f);
        private const string TravelWarnHex = "#ff9a7a";

        private bool _travelMode;
        private bool _travelPending;
        private string _travelFrom = string.Empty;
        private string _travelBlocked = string.Empty;
        private string _travelNote = string.Empty;
        private readonly Dictionary<string, JObject> _travelTargets = new Dictionary<string, JObject>(StringComparer.Ordinal);
        private readonly List<Button> _travelButtons = new List<Button>();
        private RectTransform _travelBanner;
        private Text _travelBannerText;
        private Vector2Int _travelFitFrame;
        private Vector2? _compassHome;

        /// <summary>Карта открыта у проводника.</summary>
        public bool TravelMode { get { return _travelMode && IsOpen; } }

        /// <summary>Город, куда игрок попросил отвести последним (пробы).</summary>
        public string LastTravelTarget { get; private set; } = string.Empty;

        /// <summary>Строка условий и причины под шапкой (пробы).</summary>
        public string TravelBannerText { get { return _travelBannerText != null ? _travelBannerText.text : string.Empty; } }

        /// <summary>
        /// Открыть карту у проводника. list — ответ сервера на fastTravel {action: 'list'}:
        /// from, destinations [{locationId, name, distanceKm}], blocked — почему идти пока нельзя.
        /// </summary>
        public void OpenForTravel(JObject list)
        {
            _travelTargets.Clear();
            foreach (JToken token in list?["destinations"] as JArray ?? new JArray())
            {
                if (token is JObject row && !string.IsNullOrEmpty(row["locationId"]?.ToString()))
                    _travelTargets[row["locationId"].ToString()] = row;
            }
            _travelFrom = list?["from"]?.ToString() ?? string.Empty;
            _travelBlocked = list?["blocked"]?.ToString() ?? string.Empty;
            _travelNote = string.Empty;
            _travelPending = false;
            _travelMode = true;
            OpenFor(CurrentSelf);
        }

        /// <summary>Выложить кнопки городов по текущей камере (пробы: LateUpdate в редакторе не идёт).</summary>
        public void LayoutTravelForProbe()
        {
            LayoutViewLabels();
            LayoutTravelButtons();
        }

        /// <summary>Нажать на карту в точке (км), как кликом по рельефу — пробы.</summary>
        public void PickForProbe(Vector2 point) { OnPointPicked(point); }

        private bool IsTravelTarget(string locationId)
        {
            return TravelMode && !string.IsNullOrEmpty(locationId) && _travelTargets.ContainsKey(locationId);
        }

        private void EndTravel()
        {
            if (!_travelMode) return;
            _travelMode = false;
            _travelPending = false;
            _travelTargets.Clear();
            ApplyTravelView();
        }

        /// <summary>Шапка, подсветка городов и строка условий — по тому, открыта ли карта у проводника.</summary>
        private void ApplyTravelView()
        {
            bool travel = _travelMode;
            if (_viewTitle != null) _viewTitle.text = travel ? "ПРОВОДНИК" : "КАРТА МИРА";
            if (_flatTitle != null) _flatTitle.text = travel ? "ПРОВОДНИК" : "КАРТА МИРА";
            if (_travelBanner != null) _travelBanner.gameObject.SetActive(travel);
            // Компас стоит под шапкой; у проводника под ней ещё полоса условий — компас ниже на её высоту.
            if (_compassRose != null && _compassRose.parent is RectTransform compass)
            {
                if (!_compassHome.HasValue) _compassHome = compass.anchoredPosition;
                compass.anchoredPosition = _compassHome.Value - new Vector2(0f, travel ? TravelTopReserve - 62f : 0f);
            }
            if (_map3D != null && _map3D.Ready) _map3D.ShowHighlights(travel ? TravelZones() : null, _zoneKm);
            foreach (Button button in _travelButtons) button.gameObject.SetActive(false);
            if (!travel) return;
            if (_card != null) CloseCard();
            RefreshTravelBanner();
        }

        /// <summary>Сектора городов, куда ведёт проводник.</summary>
        private List<JObject> TravelZones()
        {
            var zones = new List<JObject>();
            foreach (JObject zone in _zonesById.Values)
                if (_travelTargets.ContainsKey(zone["city"]?.ToString() ?? string.Empty)) zones.Add(zone);
            return zones;
        }

        private void RefreshTravelBanner()
        {
            string problem = !string.IsNullOrEmpty(_travelNote) ? _travelNote : _travelBlocked;
            bool warn = !_travelPending && !string.IsNullOrEmpty(problem);
            string second = string.IsNullOrEmpty(problem) ? "Выберите подсвеченный город."
                : warn ? "<color=" + TravelWarnHex + ">" + problem + "</color>" : problem;
            if (_travelBannerText != null) _travelBannerText.text = TravelRules + "\n" + second;
            // Плоский вид (если 3D-карта не поднялась): те же строки в подписи и статусе окна.
            if (_subtitle != null && !Uses3D) _subtitle.text = TravelRules;
            if (_status != null && !Uses3D) _status.text = string.IsNullOrEmpty(problem) ? "Выберите город." : problem;
            foreach (Button button in _travelButtons) button.interactable = !_travelPending;
        }

        /// <summary>
        /// Клик по сектору у проводника: город назначения — в путь; свой город — подсказка;
        /// любая другая зона — напоминание, куда он ведёт. Вне режима — false.
        /// </summary>
        private bool TravelPick(JObject zone)
        {
            if (!TravelMode) return false;
            string city = zone?["city"]?.ToString() ?? string.Empty;
            if (_travelTargets.ContainsKey(city))
            {
                TravelTo(city);
                return true;
            }
            _travelNote = !string.IsNullOrEmpty(city) && city == _travelFrom
                ? "Вы уже в этом городе."
                : "Проводник ведёт только в подсвеченные города.";
            RefreshTravelBanner();
            return true;
        }

        private void TravelTo(string locationId)
        {
            if (_travelPending || !_travelTargets.TryGetValue(locationId ?? string.Empty, out JObject row)) return;
            LastTravelTarget = locationId;
            _travelPending = true;
            _travelNote = "Проводник ведёт вас в «" + (row["name"]?.ToString() ?? locationId) + "»…";
            RefreshTravelBanner();
            bool sent = RoaTerritoryNet.UseFastTravel(Socket, locationId, ack =>
            {
                _travelPending = false;
                // Сам переход приходит отдельно (serverWorldTransfer): карте остаётся закрыться.
                if (ack?["ok"]?.ToObject<bool>() == true)
                {
                    Close();
                    return;
                }
                _travelNote = ack?["error"]?.ToString() ?? "Проводник не повёл.";
                RefreshTravelBanner();
            });
            if (sent) return;
            _travelPending = false;
            _travelNote = "Нет связи с сервером.";
            RefreshTravelBanner();
        }

        // --- кнопки городов ------------------------------------------------------------------------------

        /// <summary>
        /// Кадр у проводника: все города назначения и свой город вместе с кнопками — между
        /// шапкой с полосой условий и нижней строкой. Камера отъезжает от середины городов,
        /// пока они не влезут, и сдвигается, чтобы они легли посередине свободной части.
        /// Кадр подбирается заново при смене размера экрана (поворот телефона, окно).
        /// </summary>
        private void FitTravelView()
        {
            if (!TravelMode || _map3D == null || !_map3D.IsOpen || _canvas == null) return;
            Camera camera = _map3D.MapCamera;
            _travelFitFrame = new Vector2Int(camera.pixelWidth, camera.pixelHeight);
            var points = new List<Vector2>();
            foreach (JObject zone in _zonesById.Values)
            {
                string city = zone["city"]?.ToString() ?? string.Empty;
                if (_travelTargets.ContainsKey(city) || (city.Length > 0 && city == _travelFrom)) points.Add(ZoneCentre(zone));
            }
            if (points.Count == 0) return;
            Vector2 min = points[0], max = points[0];
            foreach (Vector2 point in points)
            {
                min = Vector2.Min(min, point);
                max = Vector2.Max(max, point);
            }
            Vector2 middle = (min + max) * 0.5f;
            float scale = Mathf.Max(0.01f, _canvas.scaleFactor);
            // Свободная часть кадра в пикселях: над городом ещё стоит его кнопка, а под своим
            // городом — его подпись.
            var free = Rect.MinMaxRect(
                (TravelButtonWidth * 0.5f + 8f) * scale,
                (TravelBottomReserve + 36f) * scale,
                _travelFitFrame.x - (TravelButtonWidth * 0.5f + 8f) * scale,
                _travelFitFrame.y - (TravelTopReserve + TravelButtonHeight + 26f) * scale);
            Vector2 frameCentre = new Vector2(_travelFitFrame.x * 0.5f, _travelFitFrame.y * 0.5f);
            for (float distance = 12f; distance <= RoaWorldMap3D.MaxDistance; distance += 1f)
            {
                _map3D.FocusOn(middle, distance);
                if (!TravelScreenBounds(points, out Rect seen)) continue;
                // Середина городов на экране — в середину свободной части.
                if (_map3D.ScreenToPoint(frameCentre + (seen.center - free.center), out Vector2 shifted))
                    _map3D.FocusOn(shifted, distance);
                if (TravelScreenBounds(points, out seen) && free.Contains(seen.min) && free.Contains(seen.max)) return;
            }
        }

        private bool TravelScreenBounds(List<Vector2> points, out Rect bounds)
        {
            bounds = default;
            Vector2 min = new Vector2(float.MaxValue, float.MaxValue), max = new Vector2(float.MinValue, float.MinValue);
            foreach (Vector2 point in points)
            {
                if (!_map3D.PointToScreen(point, 0.35f, out Vector2 at)) return false;
                min = Vector2.Min(min, at);
                max = Vector2.Max(max, at);
            }
            bounds = Rect.MinMaxRect(min.x, min.y, max.x, max.y);
            return true;
        }

        /// <summary>
        /// 3D-вид: кнопка над каждым городом назначения, пока он в кадре. Кнопка стоит
        /// над центром сектора, как табличка на шесте: сам подсвеченный город под ней виден.
        /// </summary>
        private void LayoutTravelButtons()
        {
            if (!TravelMode || _map3D == null || !_map3D.IsOpen) return;
            Camera camera = _map3D.MapCamera;
            if (camera != null && (camera.pixelWidth != _travelFitFrame.x || camera.pixelHeight != _travelFitFrame.y)) FitTravelView();
            int used = 0;
            foreach (JObject zone in TravelZones())
            {
                if (!_map3D.PointToScreen(ZoneCentre(zone), 0.35f, out Vector2 screen)) continue;
                Button button = TakeTravelButton(ref used, _viewLabels, zone);
                var rect = (RectTransform)button.transform;
                rect.pivot = new Vector2(0.5f, 0f);
                if (RectTransformUtility.ScreenPointToLocalPointInRectangle(_viewLabels, screen, CanvasCamera, out Vector2 local))
                    rect.anchoredPosition = local + new Vector2(0f, 14f);
            }
            for (int i = used; i < _travelButtons.Count; i++) _travelButtons[i].gameObject.SetActive(false);
        }

        /// <summary>Плоский вид: кнопка в центре клетки города, поверх его знака.</summary>
        private void LayoutTravelButtonsFlat(float scale)
        {
            if (!TravelMode || _labels == null) return;
            int used = 0;
            foreach (JObject zone in TravelZones())
            {
                Button button = TakeTravelButton(ref used, _labels, zone);
                var rect = (RectTransform)button.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                rect.anchoredPosition = CellOrigin(zone, scale) + new Vector2(scale * 0.5f, -scale * 0.5f);
            }
            for (int i = used; i < _travelButtons.Count; i++) _travelButtons[i].gameObject.SetActive(false);
        }

        private Button TakeTravelButton(ref int used, RectTransform parent, JObject zone)
        {
            if (used >= _travelButtons.Count) _travelButtons.Add(MakeTravelButton());
            Button button = _travelButtons[used++];
            var rect = (RectTransform)button.transform;
            if (rect.parent != parent)
            {
                rect.SetParent(parent, false);
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            }
            rect.SetAsLastSibling();
            string city = zone["city"]?.ToString() ?? string.Empty;
            JObject row = _travelTargets[city];
            button.name = "Travel:" + city;
            Text[] lines = button.GetComponentsInChildren<Text>(true);
            lines[0].text = row["name"]?.ToString() ?? zone["title"]?.ToString() ?? city;
            lines[1].text = (row["distanceKm"]?.ToObject<int>() ?? 0) + " км · бесплатно";
            button.onClick.RemoveAllListeners();
            button.onClick.AddListener(() => TravelTo(city));
            button.interactable = !_travelPending;
            button.gameObject.SetActive(true);
            return button;
        }

        private Button MakeTravelButton()
        {
            RectTransform rect = Child("Travel", _viewLabels);
            rect.sizeDelta = new Vector2(TravelButtonWidth, TravelButtonHeight);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = TravelButtonBg;
            var outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = Accent;
            outline.effectDistance = new Vector2(1.5f, -1.5f);
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            Text name = Label("Name", rect, 15, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            Place(name.rectTransform, 0f, 0.45f, 1f, 1f, new Vector2(6f, 0f), new Vector2(-6f, -2f));
            Text distance = Label("Distance", rect, 11, TextAnchor.MiddleCenter, Ink);
            Place(distance.rectTransform, 0f, 0f, 1f, 0.45f, new Vector2(6f, 3f), new Vector2(-6f, 0f));
            return button;
        }

        /// <summary>Строка условий под шапкой 3D-вида.</summary>
        private void BuildTravelBanner(RectTransform view)
        {
            _travelBanner = Child("TravelBanner", view);
            Place(_travelBanner, 0f, 1f, 1f, 1f, new Vector2(0f, -112f), new Vector2(0f, -62f));
            _travelBanner.gameObject.AddComponent<Image>().color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, 0.88f);
            _travelBannerText = Label("Text", _travelBanner, 13, TextAnchor.MiddleLeft, Ink);
            _travelBannerText.supportRichText = true;
            _travelBannerText.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_travelBannerText.rectTransform, 0f, 0f, 1f, 1f, new Vector2(16f, 2f), new Vector2(-16f, -2f));
            _travelBanner.gameObject.SetActive(false);
        }
    }
}
