using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Карта мира. Основной вид — 3D-сцена мира (RoaWorldMap3D): рельеф, реки, дороги и
    /// города, поверх — сетка зон из /api/world-map с цветом опасности, номерами и
    /// проёмами открытых ворот, места и флажок игрока. Клик по зоне или месту открывает
    /// карточку; «Проложить путь» подсвечивает цепочку зон через открытые ворота, а строка
    /// под миникартой ведёт по ней: в какие ворота идти дальше. Других игроков, групп A-Life
    /// и событий на карте нет. Если сцена не загрузилась, окно рисует плоскую сетку зон.
    /// Открывается кнопкой «КАРТА МИРА» у миникарты и в окне локальной карты.
    /// </summary>
    public sealed class RoaWorldOverviewCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.055f, 0.066f, 0.052f, 0.94f);
        private static readonly Color PanelBorder = new Color(0.82f, 0.694f, 0.404f, 0.58f);
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color MutedInk = new Color(0.72f, 0.7f, 0.6f, 1f);
        private static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);
        private static readonly Color FlagColor = new Color(0.96f, 0.27f, 0.2f, 1f);
        private static readonly Color Void = new Color(0.08f, 0.08f, 0.07f, 1f);
        private static readonly Color Wall = new Color(0.05f, 0.05f, 0.04f, 1f);

        public static readonly Color PeacefulZoneColor = new Color(0.36f, 0.82f, 0.46f, 1f);
        public static readonly Color BlueZoneColor = new Color(0.33f, 0.62f, 1f, 1f);
        public static readonly Color YellowZoneColor = new Color(0.97f, 0.8f, 0.3f, 1f);
        public static readonly Color RedZoneColor = new Color(0.9f, 0.2f, 0.14f, 1f);
        public static readonly Color BlackZoneColor = new Color(0.36f, 0.06f, 0.24f, 1f);
        private const int PixelsPerZone = 32;
        // Подписи 3D-вида: номера зон — только вблизи, имена мест — ближе среднего, столицы — всегда.
        private const float ZoneNumbersDistance = 16f;
        private const float PlaceNamesDistance = 24f;
        private const float PlacePickKm = 7f;

        public RoaSocketClient Socket;
        public RoaMinimap Minimap;
        public RoaLocationLoader Loader;
        public bool InputEnabled = true;

        private Canvas _canvas;
        private GameObject _root;
        private Image _backdrop;
        private RectTransform _panel;
        private Text _subtitle;
        private Text _status;
        private RectTransform _map;
        private RawImage _mapImage;
        private RectTransform _labels;
        private RectTransform _flag;
        private Text _pointer;
        private Texture2D _texture;

        private RectTransform _view;
        private Text _viewSubtitle;
        private Text _viewStatus;
        private RectTransform _viewLabels;
        private RectTransform _card;
        private Text _cardTitle;
        private Text _cardBody;
        private Button _routeButton;
        private Text _routeButtonLabel;
        private Text _routeHint;
        private readonly List<Text> _viewLabelPool = new List<Text>();

        private RoaWorldMap3D _map3D;
        private bool _use3D = true;
        private JObject _world;
        private readonly Dictionary<string, JObject> _zonesById = new Dictionary<string, JObject>(StringComparer.Ordinal);
        private readonly HashSet<string> _capitals = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<Text> _labelPool = new List<Text>();
        private bool _loading;
        private int _cols = 19;
        private int _rows = 15;
        private float _zoneKm = 20f;

        private JObject _selectedZone;
        private JObject _selectedPlace;
        private string _routeTargetZone = string.Empty;
        private string _routeTargetName = string.Empty;
        private string _routeFromZone = string.Empty;
        private float _arrivedUntil;
        private float _nextRouteCheck;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }
        public bool Uses3D { get { return _use3D && _map3D != null && _map3D.IsOpen; } }
        public RoaWorldMap3D Map3D { get { return _map3D; } }
        public string RouteHint { get { return _routeHint != null ? _routeHint.text : string.Empty; } }

        /// <summary>Порядок опасности: 0 мирная … 4 чёрная, -1 — вне мира.</summary>
        public static int DangerRank(string mode)
        {
            switch ((mode ?? string.Empty).ToLowerInvariant())
            {
                case "peaceful": return 0;
                case "pve": return 1;
                case "pvp": return 2;
                case "pvpfulldrop": return 3;
                case "pvpblack": return 4;
                default: return -1;
            }
        }

        public static Color DangerZoneColor(string mode)
        {
            switch (DangerRank(mode))
            {
                case 0: return PeacefulZoneColor;
                case 1: return BlueZoneColor;
                case 3: return RedZoneColor;
                case 4: return BlackZoneColor;
                default: return YellowZoneColor;
            }
        }

        public static string DangerLegendText()
        {
            return "<color=#5cd175>■</color> мирная  <color=#549eff>■</color> синяя — PvE, вещи при себе  "
                + "<color=#f7cc4d>■</color> жёлтая — PvP, вещи при себе  <color=#e63324>■</color> красная — выпадает инвентарь  "
                + "<color=#9e1452>■</color> чёрная — выпадает всё";
        }

        public static string DangerRulesText(string mode)
        {
            switch (DangerRank(mode))
            {
                case 0: return "мирная: PvP нет, вещи при себе";
                case 1: return "синяя: PvE, вещи при себе";
                case 3: return "красная: PvP, при смерти выпадает инвентарь";
                case 4: return "чёрная: PvP, при смерти выпадает всё";
                default: return "жёлтая: PvP, вещи при себе";
            }
        }

        private void Update()
        {
            if (!InputEnabled)
            {
                if (IsOpen) Close();
                UpdateRouteHint();
                return;
            }
            UpdateRouteHint();
            if (!IsOpen || _world == null) return;
            if (Uses3D)
            {
                _map3D.InputEnabled = true;
                return;
            }
            if (_map == null) return;
            // Плоский вид: зона под курсором — её номер, название и цвет.
            if (Input.mousePresent && RectTransformUtility.ScreenPointToLocalPointInRectangle(_map, Input.mousePosition, null, out Vector2 local))
            {
                JObject zone = ZoneAtLocalPoint(local);
                _pointer.text = zone == null ? string.Empty : ZoneCaption(zone);
            }
        }

        private void LateUpdate()
        {
            if (IsOpen && Uses3D) LayoutViewLabels();
        }

        public void Toggle()
        {
            if (IsOpen) Close();
            else Open();
        }

        public void Open()
        {
            OpenFor(Socket?.Session?.Self);
        }

        /// <summary>Открыть карту для состояния игрока (self сервера); пробы подают своё.</summary>
        public void OpenFor(JObject self)
        {
            EnsureBuilt();
            _root.SetActive(true);
            if (_world == null)
            {
                ShowMode(false);
                if (!_loading) StartCoroutine(FetchWorld(self));
                return;
            }
            if (_use3D) StartCoroutine(Open3D(self));
            else ShowFlat(self);
        }

        public void Close()
        {
            if (_map3D != null) _map3D.Close();
            if (_root != null) _root.SetActive(false);
        }

        private IEnumerator FetchWorld(JObject self)
        {
            _loading = true;
            _status.text = "Загрузка карты…";
            string baseUrl = Loader != null ? Loader.BaseUrl : "http://127.0.0.1:3000";
            using (UnityWebRequest request = UnityWebRequest.Get(baseUrl.TrimEnd('/') + "/api/world-map"))
            {
                yield return request.SendWebRequest();
                _loading = false;
                if (request.result != UnityWebRequest.Result.Success)
                {
                    _status.text = "Карта недоступна: " + request.error;
                    yield break;
                }
                try
                {
                    ApplyWorld(JObject.Parse(request.downloadHandler.text)["map"] as JObject);
                }
                catch (Exception error)
                {
                    _status.text = "Карта не разобрана: " + error.Message;
                    yield break;
                }
            }
            _status.text = string.Empty;
            if (!IsOpen) yield break;
            if (_use3D) StartCoroutine(Open3D(self ?? Socket?.Session?.Self));
            else ShowFlat(self ?? Socket?.Session?.Self);
        }

        /// <summary>Подставить карту мира без запроса (пробы).</summary>
        public void ApplyWorld(JObject world)
        {
            _world = world;
            _zonesById.Clear();
            _capitals.Clear();
            if (world == null) return;
            _cols = Mathf.Max(1, world["cols"]?.ToObject<int>() ?? 19);
            _rows = Mathf.Max(1, world["rows"]?.ToObject<int>() ?? 15);
            _zoneKm = Mathf.Max(1f, world["zoneKm"]?.ToObject<float>() ?? 20f);
            foreach (JToken token in world["zones"] as JArray ?? new JArray())
            {
                if (token is JObject zone && !string.IsNullOrEmpty(zone["id"]?.ToString())) _zonesById[zone["id"].ToString()] = zone;
            }
            foreach (JToken id in world["capitals"] as JArray ?? new JArray()) _capitals.Add(id.ToString());
            BuildTexture();
        }

        // --- 3D-вид -------------------------------------------------------------------------------------

        private IEnumerator Open3D(JObject self)
        {
            ShowMode(true);
            if (_map3D == null)
            {
                _map3D = gameObject.GetComponent<RoaWorldMap3D>();
                if (_map3D == null) _map3D = gameObject.AddComponent<RoaWorldMap3D>();
                _map3D.PointPicked += OnPointPicked;
            }
            _viewStatus.text = "Загрузка карты мира…";
            _map3D.SetWorldSize(_cols * _zoneKm, _rows * _zoneKm);
            RoaMobileControls touch = RoaGameBootstrap.Active != null ? RoaGameBootstrap.Active.MobileControls : null;
            yield return _map3D.Open(Application.isMobilePlatform || (touch != null && touch.ControlsEnabled));
            if (!_map3D.IsOpen)
            {
                // Сцена не поднялась: окно остаётся полезным в плоском виде.
                Debug.LogWarning("[ROA] 3D-карта мира недоступна: " + _map3D.FailReason);
                _use3D = false;
                if (IsOpen) ShowFlat(self);
                yield break;
            }
            if (!IsOpen)
            {
                _map3D.Close();
                yield break;
            }
            _viewStatus.text = string.Empty;
            if (!_map3D.HasZones) _map3D.ShowZones(_zonesById.Values, _zoneKm, DangerZoneColor);
            RefreshRouteView();
            Vector2? player = PlayerPoint(self, out JObject zone);
            _map3D.SetPlayer(player);
            _viewSubtitle.text = zone != null ? "Вы здесь: " + ZoneCaption(zone) : "Где вы — не видно: вы не в зоне мира.";
            _map3D.FocusOn(player ?? new Vector2(_cols * _zoneKm * 0.5f, _rows * _zoneKm * 0.5f), 14f);
            if (_selectedZone != null) ShowCard();
        }

        private void OnPointPicked(Vector2 point)
        {
            int col = Mathf.FloorToInt(point.x / _zoneKm);
            int row = Mathf.FloorToInt(point.y / _zoneKm);
            JObject zone = null;
            foreach (JObject candidate in _zonesById.Values)
            {
                if (RoaWorldMapRoute.Col(candidate) == col && RoaWorldMapRoute.Row(candidate) == row) { zone = candidate; break; }
            }
            _selectedZone = zone;
            _selectedPlace = null;
            if (zone == null)
            {
                _map3D.SetSelection(null);
                _card.gameObject.SetActive(false);
                return;
            }
            // Место рядом с кликом важнее зоны: карточка называет его.
            float best = PlacePickKm;
            foreach (JToken token in zone["places"] as JArray ?? new JArray())
            {
                if (!(token is JObject place)) continue;
                float distance = (PlacePoint(zone, place) - point).magnitude;
                if (distance < best) { best = distance; _selectedPlace = place; }
            }
            _map3D.SetSelection(_selectedPlace != null ? PlacePoint(zone, _selectedPlace) : ZoneCentre(zone));
            ShowCard();
        }

        private void ShowCard()
        {
            if (_selectedZone == null) { _card.gameObject.SetActive(false); return; }
            JObject zone = _selectedZone;
            _card.gameObject.SetActive(true);
            _cardTitle.text = _selectedPlace != null
                ? (_selectedPlace["name"]?.ToString() ?? "Место")
                : (zone["title"]?.ToString() ?? RoaWorldMapRoute.Id(zone));
            var body = new System.Text.StringBuilder();
            if (_selectedPlace != null) body.Append("В зоне: ").Append(zone["title"]).Append('\n');
            body.Append("Зона ").Append(DangerRulesText(zone["mode"]?.ToString())).Append('\n');
            string gates = zone["gates"]?.ToString() ?? string.Empty;
            var open = new List<string>();
            foreach (char side in RoaWorldMapRoute.Sides) if (gates.IndexOf(side) >= 0) open.Add(RoaWorldMapRoute.GateName(side));
            body.Append("Ворота: ").Append(open.Count > 0 ? string.Join(", ", open) : "нет").Append('\n');
            var places = new List<string>();
            foreach (JToken token in zone["places"] as JArray ?? new JArray()) places.Add(token?["name"]?.ToString() ?? string.Empty);
            if (places.Count > 0) body.Append("Места: ").Append(string.Join(", ", places)).Append('\n');
            string from = CurrentZoneId();
            List<JObject> path = RoaWorldMapRoute.Find(_zonesById, from, RoaWorldMapRoute.Id(zone));
            if (string.IsNullOrEmpty(from)) body.Append("Путь проложить нельзя: вы не в зоне мира.");
            else if (path.Count == 0) body.Append("Пути туда через открытые ворота нет.");
            else if (path.Count == 1) body.Append("Вы в этой зоне.");
            else body.Append("Путь: ").Append(RoaWorldMapRoute.ZonesWord(path.Count - 1)).Append(" через ворота.");
            _cardBody.text = body.ToString();
            bool routed = _routeTargetZone == RoaWorldMapRoute.Id(zone);
            _routeButtonLabel.text = routed ? "Сбросить путь" : "Проложить путь";
            _routeButton.interactable = routed || path.Count > 1;
        }

        private void ToggleRoute()
        {
            if (_selectedZone == null) return;
            string target = RoaWorldMapRoute.Id(_selectedZone);
            if (_routeTargetZone == target)
            {
                ClearRoute();
            }
            else
            {
                _routeTargetZone = target;
                _routeTargetName = _selectedPlace != null
                    ? (_selectedPlace["name"]?.ToString() ?? string.Empty)
                    : (_selectedZone["title"]?.ToString() ?? string.Empty);
                _routeFromZone = string.Empty;
                _arrivedUntil = 0f;
            }
            RefreshRouteView();
            ShowCard();
        }

        private void ClearRoute()
        {
            _routeTargetZone = string.Empty;
            _routeTargetName = string.Empty;
            _routeFromZone = string.Empty;
            _map3D?.ShowRoute(null, _zoneKm);
            if (_routeHint != null) _routeHint.text = string.Empty;
        }

        private void RefreshRouteView()
        {
            if (string.IsNullOrEmpty(_routeTargetZone)) { _map3D?.ShowRoute(null, _zoneKm); return; }
            List<JObject> path = RoaWorldMapRoute.Find(_zonesById, CurrentZoneId(), _routeTargetZone);
            _map3D?.ShowRoute(path, _zoneKm);
            if (_routeHint != null) _routeHint.text = RoaWorldMapRoute.Hint(path, _routeTargetName, CurrentPlaceName());
        }

        /// <summary>Место, из которого игрок ещё должен выйти в свою зону; пусто, если он уже в зоне.</summary>
        private string CurrentPlaceName()
        {
            if (!string.IsNullOrEmpty(SelfZoneId(Socket?.Session?.Self))) return string.Empty;
            LocationDefinition current = Loader != null ? Loader.Current : null;
            if (current == null || current.ExitZone == null) return string.Empty;
            return string.IsNullOrEmpty(current.Name) ? "места" : current.Name;
        }

        /// <summary>Строка пути под миникартой следует за игроком: новая зона — новая подсказка.</summary>
        private void UpdateRouteHint()
        {
            if (_routeHint == null) return;
            bool inGame = RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.InGame;
            _routeHint.gameObject.SetActive(inGame && !IsOpen && !string.IsNullOrEmpty(_routeHint.text)
                && !RoaGameBootstrap.BlocksWorldHud);
            if (string.IsNullOrEmpty(_routeTargetZone) || _world == null) return;
            if (_arrivedUntil > 0f)
            {
                if (Time.unscaledTime >= _arrivedUntil) { _arrivedUntil = 0f; ClearRoute(); }
                return;
            }
            if (Time.unscaledTime < _nextRouteCheck) return;
            _nextRouteCheck = Time.unscaledTime + 0.5f;
            // Выход из места в его зону тоже меняет подсказку: «выйдите из…» больше не нужно.
            string zone = CurrentZoneId();
            string here = zone + "|" + CurrentPlaceName();
            if (here == _routeFromZone) return;
            _routeFromZone = here;
            if (zone == _routeTargetZone)
            {
                _routeHint.text = "Вы на месте: «" + _routeTargetName + "».";
                _arrivedUntil = Time.unscaledTime + 8f;
                _map3D?.ShowRoute(null, _zoneKm);
                return;
            }
            RefreshRouteView();
        }

        private void LayoutViewLabels()
        {
            foreach (Text label in _viewLabelPool) label.gameObject.SetActive(false);
            if (_map3D == null || !_map3D.IsOpen) return;
            int used = 0;
            float distance = _map3D.Distance;
            foreach (JObject zone in _zonesById.Values)
            {
                if (distance <= ZoneNumbersDistance && _map3D.PointToScreen(ZoneCentre(zone), 0.12f, out Vector2 centre))
                {
                    Text number = TakeViewLabel(ref used);
                    number.fontSize = 11;
                    number.color = new Color(1f, 1f, 1f, 0.72f);
                    number.text = "№" + zone["n"];
                    PlaceViewLabel(number, centre + new Vector2(0f, 12f));
                }
                foreach (JToken token in zone["places"] as JArray ?? new JArray())
                {
                    if (!(token is JObject place)) continue;
                    bool capital = _capitals.Contains(place["id"]?.ToString() ?? string.Empty);
                    if (!capital && distance > PlaceNamesDistance) continue;
                    if (!_map3D.PointToScreen(PlacePoint(zone, place), 0.35f, out Vector2 at)) continue;
                    Text name = TakeViewLabel(ref used);
                    name.fontSize = capital ? 14 : 11;
                    name.color = capital ? Accent : Ink;
                    name.text = (capital ? "◆ " : string.Empty) + (place["name"]?.ToString() ?? string.Empty);
                    PlaceViewLabel(name, at + new Vector2(0f, 16f));
                }
            }
        }

        private Text TakeViewLabel(ref int used)
        {
            if (used >= _viewLabelPool.Count)
            {
                Text label = Label("ViewLabel", _viewLabels, 11, TextAnchor.MiddleCenter, Ink);
                label.gameObject.AddComponent<Shadow>().effectColor = new Color(0f, 0f, 0f, 0.85f);
                label.rectTransform.sizeDelta = new Vector2(220f, 20f);
                _viewLabelPool.Add(label);
            }
            Text text = _viewLabelPool[used++];
            text.gameObject.SetActive(true);
            return text;
        }

        private void PlaceViewLabel(Text label, Vector2 screen)
        {
            if (RectTransformUtility.ScreenPointToLocalPointInRectangle(_viewLabels, screen, null, out Vector2 local))
                label.rectTransform.anchoredPosition = local;
        }

        private void FocusPlayer()
        {
            Vector2? player = PlayerPoint(Socket?.Session?.Self, out JObject _);
            if (player.HasValue) _map3D?.FocusOn(player.Value);
        }

        // --- где игрок ----------------------------------------------------------------------------------

        /// <summary>Зона, в которой игрок: сама зона или зона, куда выводит край места.</summary>
        private string CurrentZoneId()
        {
            string zoneId = SelfZoneId(Socket?.Session?.Self);
            if (!string.IsNullOrEmpty(zoneId) && _zonesById.ContainsKey(zoneId)) return zoneId;
            ParentZoneInfo exit = Loader != null && Loader.Current != null ? Loader.Current.ExitZone : null;
            return exit != null && _zonesById.ContainsKey(exit.Id ?? string.Empty) ? exit.Id : string.Empty;
        }

        /// <summary>Id зоны из self.zone; вне зоны сервер шлёт null — это JValue, а не объект.</summary>
        public static string SelfZoneId(JObject self)
        {
            return (self?["zone"] as JObject)?["id"]?.ToString() ?? string.Empty;
        }

        /// <summary>Точка игрока на карте (км): в зоне — по его месту в ней, в месте — точка места.</summary>
        private Vector2? PlayerPoint(JObject self, out JObject zone)
        {
            zone = null;
            string zoneId = SelfZoneId(self);
            float u = 0.5f, v = 0.5f;
            if (!string.IsNullOrEmpty(zoneId) && _zonesById.TryGetValue(zoneId, out zone))
            {
                // В зоне: центр зоны — 0,0, ось z сервера — на юг.
                LocationDefinition current = Loader != null ? Loader.Current : null;
                float width = current != null && current.WorldWidth > 0 ? current.WorldWidth : 320f;
                float depth = current != null && current.WorldDepth > 0 ? current.WorldDepth : 320f;
                u = Mathf.Clamp01((self["x"]?.ToObject<float>() ?? 0f) / width + 0.5f);
                v = Mathf.Clamp01((self["z"]?.ToObject<float>() ?? 0f) / depth + 0.5f);
            }
            else
            {
                ParentZoneInfo exit = Loader != null && Loader.Current != null ? Loader.Current.ExitZone : null;
                string placeId = Loader?.Current?.Id ?? string.Empty;
                if (exit == null || !_zonesById.TryGetValue(exit.Id ?? string.Empty, out zone)) return null;
                foreach (JToken token in zone["places"] as JArray ?? new JArray())
                {
                    if (token is JObject place && place["id"]?.ToString() == placeId) return PlacePoint(zone, place);
                }
            }
            if (zone == null) return null;
            return new Vector2((RoaWorldMapRoute.Col(zone) + u) * _zoneKm, (RoaWorldMapRoute.Row(zone) + v) * _zoneKm);
        }

        private Vector2 ZoneCentre(JObject zone)
        {
            return new Vector2((RoaWorldMapRoute.Col(zone) + 0.5f) * _zoneKm, (RoaWorldMapRoute.Row(zone) + 0.5f) * _zoneKm);
        }

        private Vector2 PlacePoint(JObject zone, JObject place)
        {
            float u = place["u"]?.ToObject<float>() ?? 0.5f;
            float v = place["v"]?.ToObject<float>() ?? 0.5f;
            return new Vector2((RoaWorldMapRoute.Col(zone) + u) * _zoneKm, (RoaWorldMapRoute.Row(zone) + v) * _zoneKm);
        }

        // --- плоский вид (запасной) -----------------------------------------------------------------------

        private void ShowFlat(JObject self)
        {
            ShowMode(false);
            Rebuild(self);
        }

        private void ShowMode(bool threeD)
        {
            _view.gameObject.SetActive(threeD);
            _panel.gameObject.SetActive(!threeD);
            // 3D-вид виден сквозь окно: подложка прозрачна и не ловит клики карты.
            _backdrop.color = threeD ? Color.clear : new Color(0f, 0f, 0f, 0.55f);
            _backdrop.raycastTarget = !threeD;
        }

        private void Rebuild(JObject self)
        {
            if (_world == null || _texture == null) return;
            _mapImage.texture = _texture;
            // Карта вписывается в окно, пропорции сетки сохраняются.
            Rect area = ((RectTransform)_map.parent).rect;
            float scale = Mathf.Min(area.width / _cols, area.height / _rows);
            _map.sizeDelta = new Vector2(_cols * scale, _rows * scale);
            LayoutLabels(scale);
            PlaceFlag(self, scale);
        }

        private void BuildTexture()
        {
            int width = _cols * PixelsPerZone;
            int height = _rows * PixelsPerZone;
            if (_texture == null || _texture.width != width || _texture.height != height)
            {
                if (_texture != null) Destroy(_texture);
                _texture = new Texture2D(width, height, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp, name = "WorldOverviewZones" };
            }
            var pixels = new Color32[width * height];
            for (int i = 0; i < pixels.Length; i++) pixels[i] = Void;
            foreach (JObject zone in _zonesById.Values)
            {
                int col = zone["col"]?.ToObject<int>() ?? 0;
                int row = zone["row"]?.ToObject<int>() ?? 0;
                Color fill = Color.Lerp(new Color(0.36f, 0.33f, 0.27f, 1f), DangerZoneColor(zone["mode"]?.ToString()), 0.62f);
                string gates = zone["gates"]?.ToString() ?? string.Empty;
                for (int y = 0; y < PixelsPerZone; y++)
                {
                    for (int x = 0; x < PixelsPerZone; x++)
                    {
                        // Строки текстуры идут снизу вверх, ряды зон — с севера на юг.
                        int px = col * PixelsPerZone + x;
                        int py = (_rows - 1 - row) * PixelsPerZone + y;
                        bool edgeN = y >= PixelsPerZone - 1, edgeS = y == 0, edgeW = x == 0, edgeE = x >= PixelsPerZone - 1;
                        bool gap = Mathf.Abs(x - PixelsPerZone / 2) <= 4 || Mathf.Abs(y - PixelsPerZone / 2) <= 4;
                        // Закрытая сторона — сплошная стена, открытая — стена с проходом посередине.
                        bool wall = (edgeN && (gates.IndexOf('n') < 0 || !gap)) || (edgeS && (gates.IndexOf('s') < 0 || !gap))
                            || (edgeW && (gates.IndexOf('w') < 0 || !gap)) || (edgeE && (gates.IndexOf('e') < 0 || !gap));
                        pixels[py * width + px] = wall ? (Color32)Wall : (Color32)fill;
                    }
                }
            }
            _texture.SetPixels32(pixels);
            _texture.Apply(false);
        }

        private void LayoutLabels(float scale)
        {
            foreach (Text label in _labelPool) label.gameObject.SetActive(false);
            int used = 0;
            foreach (JObject zone in _zonesById.Values)
            {
                Vector2 cell = CellOrigin(zone, scale);
                // Номер зоны в углу клетки: по нему зону ищут в разговоре.
                Text number = TakeLabel(ref used);
                number.fontSize = Mathf.Clamp(Mathf.RoundToInt(scale * 0.28f), 8, 12);
                number.color = new Color(0f, 0f, 0f, 0.62f);
                number.alignment = TextAnchor.UpperLeft;
                number.text = zone["n"]?.ToString() ?? string.Empty;
                SetLabelRect(number, cell + new Vector2(2f, -2f), new Vector2(scale, scale * 0.4f), new Vector2(0f, 1f));
                foreach (JToken token in zone["places"] as JArray ?? new JArray())
                {
                    if (!(token is JObject place)) continue;
                    bool capital = _capitals.Contains(place["id"]?.ToString() ?? string.Empty);
                    float u = place["u"]?.ToObject<float>() ?? 0.5f;
                    float v = place["v"]?.ToObject<float>() ?? 0.5f;
                    Vector2 at = cell + new Vector2(u * scale, -v * scale);
                    Text dot = TakeLabel(ref used);
                    dot.fontSize = capital ? 16 : 12;
                    dot.color = capital ? Accent : Ink;
                    dot.alignment = TextAnchor.MiddleCenter;
                    dot.text = capital ? "◆" : "●";
                    SetLabelRect(dot, at, new Vector2(18f, 18f), new Vector2(0.5f, 0.5f));
                    Text name = TakeLabel(ref used);
                    name.fontSize = capital ? 12 : 10;
                    name.color = capital ? Accent : Ink;
                    name.alignment = TextAnchor.UpperCenter;
                    name.text = place["name"]?.ToString() ?? string.Empty;
                    SetLabelRect(name, at + new Vector2(0f, -8f), new Vector2(scale * 2.4f, 16f), new Vector2(0.5f, 1f));
                }
            }
        }

        private void PlaceFlag(JObject self, float scale)
        {
            Vector2? point = PlayerPoint(self, out JObject zone);
            if (!point.HasValue || zone == null)
            {
                _flag.gameObject.SetActive(false);
                _subtitle.text = "Где вы — не видно: вы не в зоне мира.";
                return;
            }
            _flag.gameObject.SetActive(true);
            _flag.anchoredPosition = new Vector2(point.Value.x / _zoneKm * scale, -point.Value.y / _zoneKm * scale);
            _flag.SetAsLastSibling();
            _subtitle.text = "Вы здесь: " + ZoneCaption(zone);
        }

        private static string ZoneCaption(JObject zone)
        {
            string mode;
            switch (DangerRank(zone["mode"]?.ToString()))
            {
                case 0: mode = "мирная"; break;
                case 1: mode = "синяя"; break;
                case 3: mode = "красная"; break;
                case 4: mode = "чёрная"; break;
                default: mode = "жёлтая"; break;
            }
            return (zone["title"]?.ToString() ?? zone["id"]?.ToString() ?? "зона") + " · " + mode + " зона";
        }

        /// <summary>Левый верхний угол клетки зоны в координатах карты (начало — левый верхний угол карты).</summary>
        private Vector2 CellOrigin(JObject zone, float scale)
        {
            int col = zone["col"]?.ToObject<int>() ?? 0;
            int row = zone["row"]?.ToObject<int>() ?? 0;
            return new Vector2(col * scale, -row * scale);
        }

        private JObject ZoneAtLocalPoint(Vector2 local)
        {
            Rect rect = _map.rect;
            float scale = rect.width / Mathf.Max(1, _cols);
            int col = Mathf.FloorToInt((local.x - rect.xMin) / scale);
            int row = Mathf.FloorToInt((rect.yMax - local.y) / scale);
            foreach (JObject zone in _zonesById.Values)
            {
                if ((zone["col"]?.ToObject<int>() ?? -1) == col && (zone["row"]?.ToObject<int>() ?? -1) == row) return zone;
            }
            return null;
        }

        private Text TakeLabel(ref int used)
        {
            if (used >= _labelPool.Count)
            {
                Text label = Label("Label", _labels, 10, TextAnchor.MiddleCenter, Ink);
                _labelPool.Add(label);
            }
            Text text = _labelPool[used++];
            text.gameObject.SetActive(true);
            return text;
        }

        private static void SetLabelRect(Text label, Vector2 position, Vector2 size, Vector2 pivot)
        {
            RectTransform rect = label.rectTransform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = pivot;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
        }

        // --- окно ---------------------------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("WorldOverviewCanvas", typeof(RectTransform), typeof(Canvas),
                typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 43;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());
            var canvasRect = (RectTransform)canvasGo.transform;

            // Строка пути под миникартой: живёт вне окна и видна, пока окно закрыто.
            _routeHint = Label("RouteHint", canvasRect, 12, TextAnchor.UpperRight, Accent, FontStyle.Bold);
            _routeHint.horizontalOverflow = HorizontalWrapMode.Wrap;
            _routeHint.gameObject.AddComponent<Shadow>().effectColor = new Color(0f, 0f, 0f, 0.9f);
            Place(_routeHint.rectTransform, 1f, 1f, 1f, 1f, new Vector2(-340f, -290f), new Vector2(-12f, -236f));
            _routeHint.gameObject.SetActive(false);

            _root = new GameObject("WorldOverview", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasRect, false);
            Place(rootRect, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            _backdrop = _root.AddComponent<Image>();
            _backdrop.color = new Color(0f, 0f, 0f, 0.55f);

            BuildFlatPanel(rootRect);
            BuildView(rootRect);
            _root.SetActive(false);
        }

        private void BuildFlatPanel(RectTransform rootRect)
        {
            _panel = Child("Panel", rootRect);
            Place(_panel, 0.5f, 0.5f, 0.5f, 0.5f, new Vector2(-530f, -350f), new Vector2(530f, 350f));
            _panel.gameObject.AddComponent<Image>().color = PanelBg;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            Text title = Label("Title", _panel, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            title.text = "КАРТА МИРА";
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -44f), new Vector2(-60f, -8f));
            _subtitle = Label("Subtitle", _panel, 13, TextAnchor.MiddleLeft, Ink);
            Place(_subtitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -70f), new Vector2(-16f, -44f));

            Button close = MakeButton("Close", _panel, "×", 20, Close);
            Place((RectTransform)close.transform, 1f, 1f, 1f, 1f, new Vector2(-48f, -44f), new Vector2(-10f, -8f));

            RectTransform area = Child("MapArea", _panel);
            Place(area, 0f, 0f, 1f, 1f, new Vector2(16f, 58f), new Vector2(-16f, -78f));
            _map = Child("Map", area);
            _map.anchorMin = _map.anchorMax = new Vector2(0.5f, 0.5f);
            _map.pivot = new Vector2(0.5f, 0.5f);
            _mapImage = _map.gameObject.AddComponent<RawImage>();
            _mapImage.color = Color.white;
            _labels = Child("Labels", _map);
            Place(_labels, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);

            Text flag = Label("Flag", _map, 22, TextAnchor.LowerCenter, FlagColor, FontStyle.Bold);
            flag.text = "⚑";
            _flag = flag.rectTransform;
            _flag.anchorMin = _flag.anchorMax = new Vector2(0f, 1f);
            _flag.pivot = new Vector2(0.5f, 0f);
            _flag.sizeDelta = new Vector2(28f, 28f);

            Text legend = Label("Legend", _panel, 11, TextAnchor.MiddleLeft, MutedInk);
            legend.supportRichText = true;
            legend.text = DangerLegendText();
            Place(legend.rectTransform, 0f, 0f, 1f, 0f, new Vector2(16f, 30f), new Vector2(-16f, 54f));
            _pointer = Label("Pointer", _panel, 12, TextAnchor.MiddleLeft, Ink);
            Place(_pointer.rectTransform, 0f, 0f, 0.7f, 0f, new Vector2(16f, 8f), new Vector2(0f, 30f));
            _status = Label("Status", _panel, 12, TextAnchor.MiddleRight, MutedInk);
            Place(_status.rectTransform, 0.5f, 0f, 1f, 0f, new Vector2(0f, 8f), new Vector2(-16f, 30f));
        }

        /// <summary>Рамка 3D-вида: верхняя строка, карточка справа, легенда внизу, подписи поверх сцены.</summary>
        private void BuildView(RectTransform rootRect)
        {
            _view = Child("View3D", rootRect);
            Place(_view, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            _viewLabels = Child("Labels", _view);
            Place(_viewLabels, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);

            RectTransform top = Child("Top", _view);
            Place(top, 0f, 1f, 1f, 1f, new Vector2(0f, -62f), Vector2.zero);
            top.gameObject.AddComponent<Image>().color = PanelBg;
            Text title = Label("Title", top, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            title.text = "КАРТА МИРА";
            Place(title.rectTransform, 0f, 0f, 0.4f, 1f, new Vector2(16f, 22f), new Vector2(0f, -6f));
            _viewSubtitle = Label("Subtitle", top, 13, TextAnchor.MiddleLeft, Ink);
            Place(_viewSubtitle.rectTransform, 0f, 0f, 0.7f, 0f, new Vector2(16f, 4f), new Vector2(0f, 26f));
            // Правый угол (60 px) занят шестерёнкой меню: её канва лежит выше карты.
            Button focus = MakeButton("FocusPlayer", top, "К СЕБЕ", 13, FocusPlayer);
            Place((RectTransform)focus.transform, 1f, 0.5f, 1f, 0.5f, new Vector2(-230f, -17f), new Vector2(-118f, 17f));
            Button close = MakeButton("Close", top, "×", 22, Close);
            Place((RectTransform)close.transform, 1f, 0.5f, 1f, 0.5f, new Vector2(-110f, -19f), new Vector2(-70f, 19f));

            _card = Child("Card", _view);
            Place(_card, 1f, 1f, 1f, 1f, new Vector2(-336f, -330f), new Vector2(-12f, -74f));
            _card.gameObject.AddComponent<Image>().color = PanelBg;
            var outline = _card.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);
            _cardTitle = Label("Title", _card, 16, TextAnchor.UpperLeft, Accent, FontStyle.Bold);
            _cardTitle.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_cardTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -40f), new Vector2(-14f, -10f));
            _cardBody = Label("Body", _card, 12, TextAnchor.UpperLeft, Ink);
            _cardBody.horizontalOverflow = HorizontalWrapMode.Wrap;
            _cardBody.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_cardBody.rectTransform, 0f, 0f, 1f, 1f, new Vector2(14f, 56f), new Vector2(-14f, -44f));
            _routeButton = MakeButton("Route", _card, "Проложить путь", 14, ToggleRoute);
            _routeButtonLabel = _routeButton.GetComponentInChildren<Text>();
            Place((RectTransform)_routeButton.transform, 0f, 0f, 1f, 0f, new Vector2(14f, 12f), new Vector2(-14f, 46f));
            _card.gameObject.SetActive(false);

            RectTransform bottom = Child("Bottom", _view);
            Place(bottom, 0f, 0f, 1f, 0f, Vector2.zero, new Vector2(0f, 48f));
            bottom.gameObject.AddComponent<Image>().color = PanelBg;
            Text legend = Label("Legend", bottom, 11, TextAnchor.MiddleLeft, MutedInk);
            legend.supportRichText = true;
            legend.text = DangerLegendText();
            Place(legend.rectTransform, 0f, 0.5f, 1f, 1f, new Vector2(16f, 0f), new Vector2(-16f, -2f));
            Text controls = Label("Controls", bottom, 11, TextAnchor.MiddleLeft, MutedInk);
            controls.text = Application.isMobilePlatform
                ? "Касание — выбрать · палец — сдвиг · два пальца — масштаб, поворот и наклон"
                : "Клик — выбрать · тянуть ЛКМ или WASD — сдвиг · ПКМ — поворот и наклон · колесо — масштаб";
            Place(controls.rectTransform, 0f, 0f, 1f, 0.5f, new Vector2(16f, 2f), new Vector2(-16f, 0f));

            _viewStatus = Label("Status", _view, 16, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Place(_viewStatus.rectTransform, 0.3f, 0.45f, 0.7f, 0.55f, Vector2.zero, Vector2.zero);
            _view.gameObject.SetActive(false);
        }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
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

        private static Button MakeButton(string name, RectTransform parent, string caption, int size, Action onClick)
        {
            RectTransform rect = Child(name, parent);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = new Color(0.13f, 0.12f, 0.09f, 0.95f);
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => onClick());
            Text label = Label("Label", rect, size, TextAnchor.MiddleCenter, Accent);
            label.text = caption;
            Place(label.rectTransform, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            return button;
        }
    }
}
