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
    /// Карта мира: сетка зон мира из /api/world-map. Каждая зона — клетка цвета её
    /// опасности с номером, закрытые стороны — стены, места и столицы — точки с
    /// именами, флажок — где стоит игрок (зона из self.zone, в месте — зона, в
    /// которую выводит его край). Других игроков, групп A-Life и событий на
    /// карте нет: она только показывает, куда идти. Открывается кнопкой
    /// «КАРТА МИРА» у миникарты и в окне локальной карты.
    /// </summary>
    public sealed class RoaWorldOverviewCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.055f, 0.066f, 0.052f, 0.98f);
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

        public RoaSocketClient Socket;
        public RoaMinimap Minimap;
        public RoaLocationLoader Loader;
        public bool InputEnabled = true;

        private Canvas _canvas;
        private GameObject _root;
        private RectTransform _panel;
        private Text _subtitle;
        private Text _status;
        private RectTransform _map;
        private RawImage _mapImage;
        private RectTransform _labels;
        private RectTransform _flag;
        private Text _pointer;
        private Texture2D _texture;
        private JObject _world;
        private readonly Dictionary<string, JObject> _zonesById = new Dictionary<string, JObject>(StringComparer.Ordinal);
        private readonly List<Text> _labelPool = new List<Text>();
        private bool _loading;
        private int _cols = 19;
        private int _rows = 15;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

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

        private void Update()
        {
            if (!InputEnabled)
            {
                if (IsOpen) Close();
                return;
            }
            if (!IsOpen || _map == null || _world == null) return;
            // Зона под курсором — её номер, название и цвет; на телефоне подсказка не нужна.
            if (Input.mousePresent && RectTransformUtility.ScreenPointToLocalPointInRectangle(_map, Input.mousePosition, null, out Vector2 local))
            {
                JObject zone = ZoneAtLocalPoint(local);
                _pointer.text = zone == null ? string.Empty : ZoneCaption(zone);
            }
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
                if (!_loading) StartCoroutine(FetchWorld(self));
                return;
            }
            Rebuild(self);
        }

        public void Close()
        {
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
            if (IsOpen) Rebuild(self ?? Socket?.Session?.Self);
        }

        /// <summary>Подставить карту мира без запроса (пробы).</summary>
        public void ApplyWorld(JObject world)
        {
            _world = world;
            _zonesById.Clear();
            if (world == null) return;
            _cols = Mathf.Max(1, world["cols"]?.ToObject<int>() ?? 19);
            _rows = Mathf.Max(1, world["rows"]?.ToObject<int>() ?? 15);
            foreach (JToken token in world["zones"] as JArray ?? new JArray())
            {
                if (token is JObject zone && !string.IsNullOrEmpty(zone["id"]?.ToString())) _zonesById[zone["id"].ToString()] = zone;
            }
            BuildTexture();
        }

        // --- вид ----------------------------------------------------------------------------------------

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
            var capitals = new HashSet<string>(StringComparer.Ordinal);
            foreach (JToken id in _world["capitals"] as JArray ?? new JArray()) capitals.Add(id.ToString());
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
                    bool capital = capitals.Contains(place["id"]?.ToString() ?? string.Empty);
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
            string zoneId = self?["zone"]?["id"]?.ToString() ?? string.Empty;
            float u = 0.5f, v = 0.5f;
            if (!string.IsNullOrEmpty(zoneId))
            {
                // В зоне: точка игрока в зоне (центр зоны — 0,0, ось z сервера — на юг).
                LocationDefinition current = Loader != null ? Loader.Current : null;
                float width = current != null && current.WorldWidth > 0 ? current.WorldWidth : 320f;
                float depth = current != null && current.WorldDepth > 0 ? current.WorldDepth : 320f;
                u = Mathf.Clamp01((self["x"]?.ToObject<float>() ?? 0f) / width + 0.5f);
                v = Mathf.Clamp01((self["z"]?.ToObject<float>() ?? 0f) / depth + 0.5f);
            }
            else
            {
                // В месте: зона, куда выводит его край, и точка места в ней.
                ParentZoneInfo parent = Loader != null && Loader.Current != null ? Loader.Current.ParentZone : null;
                zoneId = parent?.Id ?? string.Empty;
                string placeId = Loader?.Current?.Id ?? string.Empty;
                if (_zonesById.TryGetValue(zoneId, out JObject host))
                {
                    foreach (JToken token in host["places"] as JArray ?? new JArray())
                    {
                        if (token is JObject place && place["id"]?.ToString() == placeId)
                        {
                            u = place["u"]?.ToObject<float>() ?? 0.5f;
                            v = place["v"]?.ToObject<float>() ?? 0.5f;
                        }
                    }
                }
            }
            if (!_zonesById.TryGetValue(zoneId, out JObject zone))
            {
                _flag.gameObject.SetActive(false);
                _subtitle.text = "Где вы — не видно: вы не в зоне мира.";
                return;
            }
            _flag.gameObject.SetActive(true);
            _flag.anchoredPosition = CellOrigin(zone, scale) + new Vector2(u * scale, -v * scale);
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

            _root = new GameObject("WorldOverview", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            Place(rootRect, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            _root.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0.55f);

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

            Button close = MakeButton("Close", _panel, "×", Close);
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

            _root.SetActive(false);
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

        private static Button MakeButton(string name, RectTransform parent, string caption, Action onClick)
        {
            RectTransform rect = Child(name, parent);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = new Color(0.13f, 0.12f, 0.09f, 0.95f);
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => onClick());
            Text label = Label("Label", rect, 20, TextAnchor.MiddleCenter, Accent);
            label.text = caption;
            Place(label.rectTransform, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            return button;
        }
    }
}
