using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Карта мира из локальной сцены. Кнопка «КАРТА МИРА» на миникарте открывает
    /// обзор глобальной карты с флажком там, где сейчас игрок: в клетке
    /// Сердцевины («Меловая чаша №47») или у места карты. Карта рисуется из
    /// /api/global-map — цвета опасности земель, край мира, места и сетка
    /// клеток Сердцевины с номерами; колесо, «+»/«−» и перетаскивание меняют
    /// масштаб и вид. Сцена глобальной карты для этого не загружается.
    /// </summary>
    public sealed class RoaWorldOverviewCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.055f, 0.066f, 0.052f, 0.98f);
        private static readonly Color PanelBorder = new Color(0.82f, 0.694f, 0.404f, 0.58f);
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color MutedInk = new Color(0.72f, 0.7f, 0.6f, 1f);
        private static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);
        private static readonly Color FlagColor = new Color(0.96f, 0.27f, 0.2f, 1f);
        private static readonly Color CoreInner = new Color(0.86f, 0.36f, 0.66f, 0.5f);
        private static readonly Color CoreOuter = new Color(0.96f, 0.42f, 0.74f, 0.95f);
        private static readonly float[] ZoomSteps = { 1f, 1.5f, 2f, 3f, 4f, 6f, 8f, 12f, 16f, 24f, 32f };
        private const int PixelsPerCell = 16;
        private const int CorePixelsPerCell = 16;
        // Клетка Сердцевины на экране (ед. канвы): с какого размера номера и имена.
        private const float CoreNumberUnits = 22f;
        private const float CoreNameUnits = 96f;

        public RoaGlobalMap GlobalMap;
        public RoaSocketClient Socket;
        public RoaMinimap Minimap;
        public RoaLocationLoader Loader;
        public bool InputEnabled = true;

        private Canvas _canvas;
        private GameObject _root;
        private RectTransform _panel;
        private Text _title;
        private Text _subtitle;
        private Text _status;
        private RectTransform _viewport;
        private RectTransform _content;
        private RawImage _mapImage;
        private RawImage _coreImage;
        private RectTransform _nodeLayer;
        private RectTransform _coreLabelLayer;
        private RectTransform _flag;
        private RectTransform _flagPlate;
        private Text _flagText;
        private RectTransform _pointerCard;
        private Text _pointerText;
        private readonly List<RectTransform> _nodeDots = new List<RectTransform>();
        private readonly List<Text> _nodeNames = new List<Text>();
        private readonly List<GlobalMapNode> _nodeRows = new List<GlobalMapNode>();
        private readonly List<Text> _coreLabels = new List<Text>();
        private readonly Dictionary<long, int[]> _coreCells = new Dictionary<long, int[]>();

        private GlobalMapDefinition _built;
        private Texture2D _mapTexture;
        private Texture2D _coreTexture;
        private int _coreMinX, _coreMinY, _coreColumns, _coreRows;
        private float _subCellPoints = 1.6f;
        private float _mapWidthPoints = 380f;
        private float _mapHeightPoints = 300f;
        private int _zoomIndex;
        private Vector2 _focus = new Vector2(190f, 150f);
        private Vector2 _playerPoint;
        private bool _hasPlayer;
        private int[] _playerCell;
        private string _place = string.Empty;
        private string _playerLocationId = string.Empty;
        private bool _loading;
        private float _coreLabelsScale = -1f;
        private Vector2 _lastPointer;
        private bool _pointerDirty;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        private void Update()
        {
            if (!InputEnabled)
            {
                if (IsOpen) Close();
                return;
            }
            if (!IsOpen) return;
            // Esc закрывает окно из цепочки RoaGameBootstrap: иначе в том же кадре
            // загрузчик не увидел бы открытого окна и открыл бы игровое меню.
            float wheel = Input.mouseScrollDelta.y;
            if (Mathf.Abs(wheel) > 0.01f && _viewport != null
                && RectTransformUtility.RectangleContainsScreenPoint(_viewport, Input.mousePosition, null))
            {
                ZoomAround(wheel > 0f ? 1 : -1, Input.mousePosition);
            }
            // Клетка под курсором — её имя с номером; на телефоне — по касанию.
            if (Input.mousePresent)
            {
                Vector2 mouse = Input.mousePosition;
                if (_pointerDirty || (mouse - _lastPointer).sqrMagnitude > 0.25f)
                {
                    _pointerDirty = false;
                    _lastPointer = mouse;
                    ReadPointer(mouse);
                }
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

        /// <summary>Открыть обзор для состояния игрока (self сервера); пробы подают своё.</summary>
        public void OpenFor(JObject self)
        {
            EnsureBuilt();
            _root.SetActive(true);
            ReadPlayer(self);
            _status.text = string.Empty;
            if (GlobalMap != null && (GlobalMap.Definition == null || GlobalMap.Definition.Grid == null))
            {
                if (!_loading)
                {
                    _loading = true;
                    _status.text = "Загрузка карты…";
                    StartCoroutine(GlobalMap.EnsureDefinition((ok, error) =>
                    {
                        _loading = false;
                        _status.text = ok ? string.Empty : (error ?? "Карта недоступна.");
                        if (ok && IsOpen) Rebuild(true);
                    }));
                }
                return;
            }
            Rebuild(true);
        }

        public void Close()
        {
            if (_root != null) _root.SetActive(false);
        }

        // --- где игрок --------------------------------------------------------------------------------

        private void ReadPlayer(JObject self)
        {
            _hasPlayer = false;
            _playerCell = null;
            _playerLocationId = self?["locationId"]?.ToString() ?? string.Empty;
            JObject cell = self?["dangerCell"] as JObject;
            _place = Minimap != null ? Minimap.LocationName : string.Empty;
            if (cell != null)
            {
                _playerPoint = new Vector2(cell["x"]?.ToObject<float>() ?? 0f, cell["y"]?.ToObject<float>() ?? 0f);
                _hasPlayer = true;
                _place = cell["title"]?.ToString() ?? _place;
            }
            else if (self?["uiSnapshots"]?["world"]?["globalMap"] is JObject globalMap)
            {
                // В обычной локации сервер держит точку игрока на карте — место входа.
                float x = globalMap["playerX"]?.ToObject<float>() ?? 0f;
                float y = globalMap["playerY"]?.ToObject<float>() ?? 0f;
                _hasPlayer = x > 0f || y > 0f;
                _playerPoint = new Vector2(x, y);
            }
            ApplyPlaceText();
        }

        /// <summary>«Вы здесь: …» и подпись флажка; без имени локации — ближайшее место карты.</summary>
        private void ApplyPlaceText()
        {
            string place = _place;
            GlobalMapDefinition map = GlobalMap != null ? GlobalMap.Definition : null;
            if (string.IsNullOrEmpty(place) && _hasPlayer && map?.Nodes != null)
            {
                GlobalMapNode best = null;
                float bestDistance = 4f;
                foreach (GlobalMapNode node in map.Nodes)
                {
                    if (node == null || node.Hidden) continue;
                    if (!string.IsNullOrEmpty(_playerLocationId) && node.EffectiveLocationId == _playerLocationId)
                    {
                        best = node;
                        break;
                    }
                    float distance = Vector2.Distance(new Vector2(node.X, node.Y), _playerPoint);
                    if (distance >= bestDistance) continue;
                    bestDistance = distance;
                    best = node;
                }
                if (best != null) place = NodeTitle(best);
            }
            _subtitle.text = _hasPlayer
                ? "Вы здесь: " + (string.IsNullOrEmpty(place) ? "пустошь" : RoaPipboy.KromkaPublicText(place))
                : "Место на карте неизвестно";
            _flagText.text = string.IsNullOrEmpty(place) ? "ВЫ ЗДЕСЬ" : RoaPipboy.KromkaPublicText(place);
            _flagPlate.sizeDelta = new Vector2(Mathf.Ceil(_flagText.preferredWidth) + 12f, 20f);
        }

        // --- построение -------------------------------------------------------------------------------

        private void Rebuild(bool focusPlayer)
        {
            GlobalMapDefinition map = GlobalMap != null ? GlobalMap.Definition : null;
            if (map?.Grid == null) return;
            if (!ReferenceEquals(map, _built))
            {
                BuildTextures(map);
                BuildNodes(map);
                _built = map;
            }
            if (_hasPlayer && _subCellPoints > 0f)
            {
                _coreCells.TryGetValue(Key(Mathf.FloorToInt(_playerPoint.x / _subCellPoints),
                    Mathf.FloorToInt(_playerPoint.y / _subCellPoints)), out _playerCell);
            }
            if (focusPlayer)
            {
                _zoomIndex = _playerCell != null ? ZoomForCoreNumbers() : (_hasPlayer ? 2 : 0);
                _focus = _hasPlayer ? _playerPoint : new Vector2(_mapWidthPoints * 0.5f, _mapHeightPoints * 0.5f);
            }
            _coreLabelsScale = -1f;
            ApplyPlaceText();
            Layout();
        }

        /// <summary>Самый мелкий масштаб, при котором у клеток Сердцевины видны номера.</summary>
        private int ZoomForCoreNumbers()
        {
            float fit = Scale / ZoomSteps[Mathf.Clamp(_zoomIndex, 0, ZoomSteps.Length - 1)];
            for (int i = 0; i < ZoomSteps.Length; i++)
                if (fit * ZoomSteps[i] * _subCellPoints >= CoreNumberUnits) return i;
            return ZoomSteps.Length - 1;
        }

        private static long Key(int sx, int sy)
        {
            return ((long)sx << 32) ^ (uint)sy;
        }

        private void BuildTextures(GlobalMapDefinition map)
        {
            int cols = map.Grid.Cols;
            int rows = map.Grid.Rows;
            _mapWidthPoints = cols * map.Grid.CellPoints;
            _mapHeightPoints = rows * map.Grid.CellPoints;
            int width = cols * PixelsPerCell;
            int height = rows * PixelsPerCell;
            var pixels = new Color32[width * height];
            List<float[]> contour = map.PlayableContour;
            float pointsPerPixel = map.Grid.CellPoints / PixelsPerCell;
            var crossings = new List<float>();
            for (int py = 0; py < height; py++)
            {
                // Строка 0 — юг (у карты y растёт на юг, у текстуры — вверх).
                float y = _mapHeightPoints - (py + 0.5f) * pointsPerPixel;
                ContourCrossings(contour, y, crossings);
                int cy = Mathf.Clamp(Mathf.FloorToInt(y / map.Grid.CellPoints), 0, rows - 1);
                for (int px = 0; px < width; px++)
                {
                    float x = (px + 0.5f) * pointsPerPixel;
                    int cx = Mathf.Clamp(Mathf.FloorToInt(x / map.Grid.CellPoints), 0, cols - 1);
                    bool inside = contour == null || contour.Count < 3 || InsideByCrossings(crossings, x);
                    Color color = inside ? CellColor(map, cx, cy) : new Color(0.035f, 0.04f, 0.036f, 1f);
                    // Тонкая сетка клеток 10 км.
                    if (inside && (px % PixelsPerCell == 0 || py % PixelsPerCell == 0)) color *= 0.86f;
                    color.a = 1f;
                    pixels[py * width + px] = color;
                }
            }
            if (_mapTexture != null) Destroy(_mapTexture);
            _mapTexture = new Texture2D(width, height, TextureFormat.RGBA32, true)
            {
                name = "WorldOverview",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear
            };
            _mapTexture.SetPixels32(pixels);
            _mapTexture.Apply(true, false);
            _mapImage.texture = _mapTexture;

            BuildCoreTexture(map);
        }

        private static Color CellColor(GlobalMapDefinition map, int cx, int cy)
        {
            string mode = map.Cells != null && map.Cells.TryGetValue(cx + ":" + cy, out GlobalMapCell cell)
                ? (cell?.PvpMode ?? string.Empty) : string.Empty;
            Color ground = new Color(0.2f, 0.19f, 0.15f, 1f);
            switch (RoaGlobalMap.DangerRank(mode))
            {
                case 0: return Color.Lerp(ground, RoaGlobalMap.PeacefulZoneColor, 0.42f);
                case 1: return Color.Lerp(ground, RoaGlobalMap.BlueZoneColor, 0.36f);
                case 2: return Color.Lerp(ground, RoaGlobalMap.YellowZoneColor, 0.2f);
                case 3: return Color.Lerp(ground, RoaGlobalMap.RedZoneColor, 0.38f);
                case 4: return Color.Lerp(ground, RoaGlobalMap.BlackZoneColor, 0.8f);
                default: return ground;
            }
        }

        private static void ContourCrossings(List<float[]> contour, float y, List<float> output)
        {
            output.Clear();
            if (contour == null || contour.Count < 3) return;
            for (int i = 0, j = contour.Count - 1; i < contour.Count; j = i, i++)
            {
                float[] a = contour[i];
                float[] b = contour[j];
                if (a == null || b == null || a.Length < 2 || b.Length < 2) continue;
                if ((a[1] > y) == (b[1] > y)) continue;
                output.Add((b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]);
            }
            output.Sort();
        }

        private static bool InsideByCrossings(List<float> crossings, float x)
        {
            int count = 0;
            for (int i = 0; i < crossings.Count; i++) if (crossings[i] > x) count++;
            return (count & 1) == 1;
        }

        private void BuildCoreTexture(GlobalMapDefinition map)
        {
            _coreCells.Clear();
            GlobalMapDangerWalkCells walk = map.DangerWalkCells;
            _coreImage.gameObject.SetActive(false);
            if (walk?.Cells == null || walk.Cells.Count == 0) return;
            float pointKm = map.Grid.CellKm / Mathf.Max(0.001f, map.Grid.CellPoints);
            _subCellPoints = walk.SubCellKm / Mathf.Max(0.001f, pointKm);
            int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
            foreach (int[] row in walk.Cells)
            {
                if (row == null || row.Length < 3) continue;
                _coreCells[Key(row[0], row[1])] = row;
                minX = Mathf.Min(minX, row[0]);
                minY = Mathf.Min(minY, row[1]);
                maxX = Mathf.Max(maxX, row[0]);
                maxY = Mathf.Max(maxY, row[1]);
            }
            if (_coreCells.Count == 0) return;
            _coreMinX = minX;
            _coreMinY = minY;
            _coreColumns = maxX - minX + 1;
            _coreRows = maxY - minY + 1;
            int width = _coreColumns * CorePixelsPerCell;
            int height = _coreRows * CorePixelsPerCell;
            var pixels = new Color32[width * height];
            Color32 inner = CoreInner;
            Color32 outer = CoreOuter;
            foreach (int[] row in _coreCells.Values)
            {
                int px = (row[0] - minX) * CorePixelsPerCell;
                int py = (maxY - row[1]) * CorePixelsPerCell;
                bool north = _coreCells.ContainsKey(Key(row[0], row[1] - 1));
                bool south = _coreCells.ContainsKey(Key(row[0], row[1] + 1));
                bool west = _coreCells.ContainsKey(Key(row[0] - 1, row[1]));
                bool east = _coreCells.ContainsKey(Key(row[0] + 1, row[1]));
                for (int i = 0; i < CorePixelsPerCell; i++)
                {
                    Put(pixels, width, px + i, py + CorePixelsPerCell - 1, north ? inner : outer);
                    Put(pixels, width, px + i, py, south ? inner : outer);
                    Put(pixels, width, px, py + i, west ? inner : outer);
                    Put(pixels, width, px + CorePixelsPerCell - 1, py + i, east ? inner : outer);
                }
            }
            if (_coreTexture != null) Destroy(_coreTexture);
            _coreTexture = new Texture2D(width, height, TextureFormat.RGBA32, true)
            {
                name = "WorldOverviewCore",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear
            };
            _coreTexture.SetPixels32(pixels);
            _coreTexture.Apply(true, false);
            _coreImage.texture = _coreTexture;
            _coreImage.gameObject.SetActive(true);
        }

        private static void Put(Color32[] pixels, int width, int x, int y, Color32 color)
        {
            int index = y * width + x;
            if (x < 0 || y < 0 || index < 0 || index >= pixels.Length) return;
            if (pixels[index].a >= color.a) return;
            pixels[index] = color;
        }

        private void BuildNodes(GlobalMapDefinition map)
        {
            _nodeRows.Clear();
            if (map.Nodes == null) return;
            foreach (GlobalMapNode node in map.Nodes)
            {
                if (node == null || node.Hidden) continue;
                _nodeRows.Add(node);
            }
            while (_nodeDots.Count < _nodeRows.Count)
            {
                RectTransform dot = Child("Node" + _nodeDots.Count, _nodeLayer);
                dot.anchorMin = dot.anchorMax = new Vector2(0f, 1f);
                dot.pivot = new Vector2(0.5f, 0.5f);
                var image = dot.gameObject.AddComponent<Image>();
                image.raycastTarget = false;
                _nodeDots.Add(dot);
                Text name = Label("Name", _nodeLayer, 11, TextAnchor.MiddleLeft, Ink);
                name.rectTransform.anchorMin = name.rectTransform.anchorMax = new Vector2(0f, 1f);
                name.rectTransform.pivot = new Vector2(0f, 0.5f);
                name.rectTransform.sizeDelta = new Vector2(220f, 18f);
                AddShadow(name);
                _nodeNames.Add(name);
            }
            for (int i = 0; i < _nodeDots.Count; i++)
            {
                bool used = i < _nodeRows.Count;
                _nodeDots[i].gameObject.SetActive(used);
                _nodeNames[i].gameObject.SetActive(used);
                if (!used) continue;
                GlobalMapNode node = _nodeRows[i];
                _nodeDots[i].GetComponent<Image>().color = node.Capital
                    ? new Color(1f, 0.84f, 0.4f, 1f) : new Color(0.9f, 0.86f, 0.74f, 0.9f);
                _nodeDots[i].sizeDelta = node.Capital ? new Vector2(9f, 9f) : new Vector2(6f, 6f);
                string title = NodeTitle(node);
                _nodeNames[i].text = title;
                _nodeNames[i].enabled = title.Length > 0;
                _nodeNames[i].fontStyle = node.Capital ? FontStyle.Bold : FontStyle.Normal;
            }
        }

        /// <summary>Имя места для игрока; служебный id вместо имени не показываем — только точку.</summary>
        private string NodeTitle(GlobalMapNode node)
        {
            string locationId = node.EffectiveLocationId;
            LocationDefinition location = Loader != null ? Loader.GetDefinition(locationId) : null;
            string title = location != null && !string.IsNullOrEmpty(location.Name) ? location.Name
                : (GlobalMap != null ? GlobalMap.NodeTitle(node) : string.Empty);
            if (string.IsNullOrEmpty(title) || title == locationId || title == node.Id) return string.Empty;
            return RoaPipboy.KromkaPublicText(title);
        }

        private string CellTitle(int[] row)
        {
            GlobalMapDangerWalkCells walk = _built?.DangerWalkCells;
            string name = walk != null ? RoaPipboy.KromkaPublicText(walk.NameOf(row)) : string.Empty;
            return (string.IsNullOrEmpty(name) ? "Клетка" : name) + " №" + row[2];
        }

        // --- вид ---------------------------------------------------------------------------------------

        private float Scale
        {
            get
            {
                Rect view = _viewport.rect;
                float fit = Mathf.Min(view.width / Mathf.Max(1f, _mapWidthPoints),
                    view.height / Mathf.Max(1f, _mapHeightPoints));
                return fit * ZoomSteps[Mathf.Clamp(_zoomIndex, 0, ZoomSteps.Length - 1)];
            }
        }

        private Vector2 ContentPosition(float x, float y)
        {
            float s = Scale;
            return new Vector2(x * s, -y * s);
        }

        private void Layout()
        {
            if (_content == null || _viewport == null) return;
            float s = Scale;
            Rect view = _viewport.rect;
            _content.sizeDelta = new Vector2(_mapWidthPoints * s, _mapHeightPoints * s);
            // Точка фокуса — в середину окна; край карты не уходит внутрь окна.
            float left = view.width * 0.5f - _focus.x * s;
            float top = -(view.height * 0.5f) + _focus.y * s;
            left = _content.sizeDelta.x <= view.width
                ? (view.width - _content.sizeDelta.x) * 0.5f
                : Mathf.Clamp(left, view.width - _content.sizeDelta.x, 0f);
            top = _content.sizeDelta.y <= view.height
                ? -(view.height - _content.sizeDelta.y) * 0.5f
                : Mathf.Clamp(top, 0f, _content.sizeDelta.y - view.height);
            _content.anchoredPosition = new Vector2(left, top);
            _focus = new Vector2((view.width * 0.5f - left) / s, (view.height * 0.5f + top) / s);

            if (_coreImage.gameObject.activeSelf)
            {
                RectTransform core = _coreImage.rectTransform;
                core.anchoredPosition = ContentPosition(_coreMinX * _subCellPoints, _coreMinY * _subCellPoints);
                core.sizeDelta = new Vector2(_coreColumns * _subCellPoints * s, _coreRows * _subCellPoints * s);
            }

            bool allNames = ZoomSteps[_zoomIndex] >= 2f;
            for (int i = 0; i < _nodeRows.Count && i < _nodeDots.Count; i++)
            {
                GlobalMapNode node = _nodeRows[i];
                Vector2 position = ContentPosition(node.X, node.Y);
                _nodeDots[i].anchoredPosition = position;
                _nodeNames[i].rectTransform.anchoredPosition = position + new Vector2(7f, 0f);
                // Место, где стоит игрок, называет флажок.
                bool underFlag = _hasPlayer && Vector2.Distance(new Vector2(node.X, node.Y), _playerPoint) < 2f;
                _nodeNames[i].gameObject.SetActive((allNames || node.Capital) && !underFlag);
            }

            _flag.gameObject.SetActive(_hasPlayer);
            if (_hasPlayer) _flag.anchoredPosition = ContentPosition(_playerPoint.x, _playerPoint.y);
            _flag.SetAsLastSibling();
            LayoutCoreLabels(s);
            _pointerDirty = true;
        }

        /// <summary>
        /// Номера клеток Сердцевины, когда клетка достаточно крупная, и «Имя №N»
        /// вблизи. Подписи лежат в координатах карты: перетаскивание их не
        /// пересчитывает, лишнее обрезает маска окна. Клетку игрока подписывает флажок.
        /// </summary>
        private void LayoutCoreLabels(float scale)
        {
            if (Mathf.Approximately(scale, _coreLabelsScale)) return;
            _coreLabelsScale = scale;
            int used = 0;
            float cellUnits = _subCellPoints * scale;
            bool numbers = cellUnits >= CoreNumberUnits;
            bool names = cellUnits >= CoreNameUnits;
            if (_coreCells.Count > 0 && numbers)
            {
                foreach (int[] row in _coreCells.Values)
                {
                    if (row == _playerCell) continue;
                    Text label = CoreLabel(used++);
                    label.gameObject.SetActive(true);
                    label.text = names ? CellTitle(row).Replace(" №", "\n№") : row[2].ToString();
                    label.fontSize = names ? 11 : Mathf.Clamp(Mathf.RoundToInt(cellUnits * 0.36f), 9, 15);
                    label.rectTransform.anchoredPosition = ContentPosition((row[0] + 0.5f) * _subCellPoints,
                        (row[1] + 0.5f) * _subCellPoints);
                }
            }
            for (int i = used; i < _coreLabels.Count; i++)
                if (_coreLabels[i].gameObject.activeSelf) _coreLabels[i].gameObject.SetActive(false);
        }

        /// <summary>Клетка Сердцевины под курсором (или пальцем) — её имя с номером внизу окна.</summary>
        private void ReadPointer(Vector2 screenPoint)
        {
            if (_pointerCard == null || _viewport == null) return;
            string text = string.Empty;
            Camera eventCamera = _canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : _canvas.worldCamera;
            if (_coreCells.Count > 0 && _subCellPoints > 0f
                && RectTransformUtility.ScreenPointToLocalPointInRectangle(_viewport, screenPoint, eventCamera, out Vector2 local)
                && _viewport.rect.Contains(local))
            {
                Vector2 fromCenter = local - _viewport.rect.center;
                Vector2 point = _focus + new Vector2(fromCenter.x, -fromCenter.y) / Mathf.Max(0.0001f, Scale);
                if (_coreCells.TryGetValue(Key(Mathf.FloorToInt(point.x / _subCellPoints),
                        Mathf.FloorToInt(point.y / _subCellPoints)), out int[] row))
                    text = (row == _playerCell ? "Вы здесь: " : string.Empty) + CellTitle(row);
            }
            if (_pointerText.text != text) _pointerText.text = text;
            bool show = text.Length > 0;
            if (_pointerCard.gameObject.activeSelf != show) _pointerCard.gameObject.SetActive(show);
        }

        private void HandleTap(BaseEventData data)
        {
            if (data is PointerEventData pointer) ReadPointer(pointer.position);
        }

        private Text CoreLabel(int index)
        {
            while (_coreLabels.Count <= index)
            {
                Text label = Label("Core" + _coreLabels.Count, _coreLabelLayer, 11, TextAnchor.MiddleCenter,
                    new Color(0.98f, 0.74f, 0.89f, 0.9f));
                label.rectTransform.anchorMin = label.rectTransform.anchorMax = new Vector2(0f, 1f);
                label.rectTransform.pivot = new Vector2(0.5f, 0.5f);
                label.rectTransform.sizeDelta = new Vector2(160f, 34f);
                label.lineSpacing = 0.9f;
                AddShadow(label);
                _coreLabels.Add(label);
            }
            return _coreLabels[index];
        }

        private void ZoomAround(int direction, Vector2 screenPoint)
        {
            int next = Mathf.Clamp(_zoomIndex + direction, 0, ZoomSteps.Length - 1);
            if (next == _zoomIndex) return;
            Vector2 anchor = _focus;
            if (RectTransformUtility.ScreenPointToLocalPointInRectangle(_viewport, screenPoint, null, out Vector2 local))
            {
                // Точка под курсором остаётся под курсором.
                Rect view = _viewport.rect;
                float s = Scale;
                Vector2 fromCenter = local - view.center;
                anchor = _focus + new Vector2(fromCenter.x, -fromCenter.y) / s;
                _zoomIndex = next;
                float ns = Scale;
                _focus = anchor - new Vector2(fromCenter.x, -fromCenter.y) / ns;
            }
            else
            {
                _zoomIndex = next;
            }
            Layout();
        }

        private void Zoom(int direction)
        {
            _zoomIndex = Mathf.Clamp(_zoomIndex + direction, 0, ZoomSteps.Length - 1);
            Layout();
        }

        private void CenterOnPlayer()
        {
            if (_hasPlayer) _focus = _playerPoint;
            Layout();
        }

        /// <summary>Перетаскивание карты мышью или пальцем.</summary>
        private void HandleDrag(BaseEventData data)
        {
            if (!(data is PointerEventData pointer)) return;
            float factor = 1f / Mathf.Max(0.01f, _canvas.scaleFactor);
            _focus -= new Vector2(pointer.delta.x, -pointer.delta.y) * factor / Mathf.Max(0.0001f, Scale);
            Layout();
        }

        // --- окно --------------------------------------------------------------------------------------

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
            Stretch(rootRect, 0f);
            // Касание мимо окна закрывает его. Затемнение — соседний слой, а не
            // родитель окна: клики по окну не всплывают к этой кнопке.
            RectTransform dimRect = Child("Dim", rootRect);
            Stretch(dimRect, 0f);
            var dim = dimRect.gameObject.AddComponent<Image>();
            dim.color = new Color(0f, 0f, 0f, 0.5f);
            var dimButton = dimRect.gameObject.AddComponent<Button>();
            dimButton.transition = Selectable.Transition.None;
            dimButton.onClick.AddListener(Close);

            _panel = Child("Panel", rootRect);
            _panel.anchorMin = new Vector2(0.5f, 0.5f);
            _panel.anchorMax = new Vector2(0.5f, 0.5f);
            _panel.pivot = new Vector2(0.5f, 0.5f);
            Vector2 reference = RoaUiScale.Reference;
            _panel.sizeDelta = new Vector2(Mathf.Min(1060f, reference.x - 40f), Mathf.Min(700f, reference.y - 28f));
            var back = _panel.gameObject.AddComponent<Image>();
            back.color = PanelBg;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            _title = Label("Title", _panel, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -40f), new Vector2(-280f, -8f));
            _title.text = "КАРТА МИРА";
            _subtitle = Label("Subtitle", _panel, 13, TextAnchor.MiddleLeft, Ink);
            Place(_subtitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -62f), new Vector2(-280f, -40f));

            Button close = TextButton("Close", _panel, "×", 24, out Text closeText);
            Place((RectTransform)close.transform, 1f, 1f, 1f, 1f, new Vector2(-44f, -40f), new Vector2(-8f, -8f));
            closeText.color = Accent;
            close.onClick.AddListener(Close);
            Button zoomIn = TextButton("ZoomIn", _panel, "+", 20, out _);
            Place((RectTransform)zoomIn.transform, 1f, 1f, 1f, 1f, new Vector2(-92f, -40f), new Vector2(-56f, -8f));
            zoomIn.onClick.AddListener(() => Zoom(1));
            Button zoomOut = TextButton("ZoomOut", _panel, "−", 20, out _);
            Place((RectTransform)zoomOut.transform, 1f, 1f, 1f, 1f, new Vector2(-132f, -40f), new Vector2(-96f, -8f));
            zoomOut.onClick.AddListener(() => Zoom(-1));
            Button toPlayer = TextButton("ToPlayer", _panel, "К ИГРОКУ", 12, out _);
            Place((RectTransform)toPlayer.transform, 1f, 1f, 1f, 1f, new Vector2(-250f, -40f), new Vector2(-140f, -8f));
            toPlayer.onClick.AddListener(CenterOnPlayer);

            _viewport = Child("Viewport", _panel);
            Place(_viewport, 0f, 0f, 1f, 1f, new Vector2(12f, 64f), new Vector2(-12f, -70f));
            var viewportBack = _viewport.gameObject.AddComponent<Image>();
            viewportBack.color = new Color(0.02f, 0.025f, 0.022f, 1f);
            _viewport.gameObject.AddComponent<RectMask2D>();
            var drag = _viewport.gameObject.AddComponent<EventTrigger>();
            var dragEntry = new EventTrigger.Entry { eventID = EventTriggerType.Drag };
            dragEntry.callback.AddListener(HandleDrag);
            drag.triggers.Add(dragEntry);
            var tapEntry = new EventTrigger.Entry { eventID = EventTriggerType.PointerClick };
            tapEntry.callback.AddListener(HandleTap);
            drag.triggers.Add(tapEntry);

            _content = Child("Content", _viewport);
            _content.anchorMin = _content.anchorMax = new Vector2(0f, 1f);
            _content.pivot = new Vector2(0f, 1f);
            _mapImage = Child("Map", _content).gameObject.AddComponent<RawImage>();
            Stretch(_mapImage.rectTransform, 0f);
            _mapImage.raycastTarget = false;
            _coreImage = Child("Core", _content).gameObject.AddComponent<RawImage>();
            _coreImage.rectTransform.anchorMin = _coreImage.rectTransform.anchorMax = new Vector2(0f, 1f);
            _coreImage.rectTransform.pivot = new Vector2(0f, 1f);
            _coreImage.raycastTarget = false;
            _coreImage.gameObject.SetActive(false);
            _coreLabelLayer = Child("CoreLabels", _content);
            Stretch(_coreLabelLayer, 0f);
            _nodeLayer = Child("Nodes", _content);
            Stretch(_nodeLayer, 0f);

            // Флажок игрока: древко, полотнище и подпись.
            _flag = Child("Flag", _content);
            _flag.anchorMin = _flag.anchorMax = new Vector2(0f, 1f);
            _flag.pivot = new Vector2(0.5f, 0f);
            _flag.sizeDelta = new Vector2(2f, 2f);
            RectTransform pole = Child("Pole", _flag);
            pole.anchorMin = pole.anchorMax = new Vector2(0.5f, 0f);
            pole.pivot = new Vector2(0.5f, 0f);
            pole.sizeDelta = new Vector2(2.5f, 26f);
            pole.anchoredPosition = Vector2.zero;
            pole.gameObject.AddComponent<Image>().color = new Color(0.95f, 0.92f, 0.86f, 1f);
            RectTransform cloth = Child("Cloth", _flag);
            cloth.anchorMin = cloth.anchorMax = new Vector2(0.5f, 0f);
            cloth.pivot = new Vector2(0f, 1f);
            cloth.sizeDelta = new Vector2(15f, 10f);
            cloth.anchoredPosition = new Vector2(1.2f, 26f);
            cloth.gameObject.AddComponent<Image>().color = FlagColor;
            RectTransform foot = Child("Foot", _flag);
            foot.anchorMin = foot.anchorMax = new Vector2(0.5f, 0f);
            foot.pivot = new Vector2(0.5f, 0.5f);
            foot.sizeDelta = new Vector2(7f, 7f);
            foot.gameObject.AddComponent<Image>().color = FlagColor;
            // Подложка под подписью флажка: поверх номеров клеток текст читается.
            _flagPlate = Child("Plate", _flag);
            _flagPlate.anchorMin = _flagPlate.anchorMax = new Vector2(0.5f, 0f);
            _flagPlate.pivot = new Vector2(0f, 0.5f);
            _flagPlate.anchoredPosition = new Vector2(13f, 22f);
            _flagPlate.sizeDelta = new Vector2(80f, 20f);
            _flagPlate.gameObject.AddComponent<Image>().color = new Color(0.05f, 0.04f, 0.035f, 0.86f);
            _flagText = Label("Text", _flag, 12, TextAnchor.MiddleLeft, new Color(1f, 0.95f, 0.85f, 1f), FontStyle.Bold);
            _flagText.rectTransform.anchorMin = _flagText.rectTransform.anchorMax = new Vector2(0.5f, 0f);
            _flagText.rectTransform.pivot = new Vector2(0f, 0.5f);
            _flagText.rectTransform.sizeDelta = new Vector2(240f, 18f);
            _flagText.rectTransform.anchoredPosition = new Vector2(19f, 22f);
            AddShadow(_flagText);
            foreach (Image image in _flag.GetComponentsInChildren<Image>()) image.raycastTarget = false;

            // Имя клетки под курсором — плашка в левом нижнем углу карты.
            _pointerCard = Child("PointerCell", _viewport);
            Place(_pointerCard, 0f, 0f, 0f, 0f, new Vector2(8f, 8f), new Vector2(268f, 34f));
            var pointerBack = _pointerCard.gameObject.AddComponent<Image>();
            pointerBack.color = new Color(0.03f, 0.035f, 0.03f, 0.88f);
            pointerBack.raycastTarget = false;
            _pointerText = Label("Text", _pointerCard, 13, TextAnchor.MiddleLeft, Ink);
            Stretch(_pointerText.rectTransform, 0f);
            _pointerText.rectTransform.offsetMin = new Vector2(10f, 0f);
            _pointerCard.gameObject.SetActive(false);

            Text legend = Label("Legend", _panel, 11, TextAnchor.UpperLeft, MutedInk);
            Place(legend.rectTransform, 0f, 0f, 1f, 0f, new Vector2(16f, 6f), new Vector2(-16f, 60f));
            legend.supportRichText = true;
            legend.horizontalOverflow = HorizontalWrapMode.Wrap;
            legend.text = RoaGlobalMap.DangerLegendText().Replace("\n", "   ");
            _status = Label("Status", _panel, 13, TextAnchor.MiddleCenter, Ink);
            Place(_status.rectTransform, 0f, 0.5f, 1f, 0.5f, new Vector2(20f, -14f), new Vector2(-20f, 14f));

            _root.SetActive(false);
        }

        // --- помощники uGUI ----------------------------------------------------------------------------

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

        private static void Place(RectTransform rect, float minX, float minY, float maxX, float maxY,
                                  Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = new Vector2(minX, minY);
            rect.anchorMax = new Vector2(maxX, maxY);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }

        private static Text Label(string name, RectTransform parent, int size, TextAnchor anchor,
                                  Color color, FontStyle style = FontStyle.Normal)
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

        private static void AddShadow(Text text)
        {
            Shadow shadow = text.gameObject.AddComponent<Shadow>();
            shadow.effectColor = new Color(0f, 0f, 0f, 0.8f);
            shadow.effectDistance = new Vector2(1f, -1f);
        }

        private static Button TextButton(string name, RectTransform parent, string caption, int size, out Text label)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = new Color(0f, 0f, 0f, 0.35f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, Ink);
            Stretch(label.rectTransform, 2f);
            label.text = caption;
            return button;
        }
    }
}
