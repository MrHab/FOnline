using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Окно зоны и компас 3D-карты мира. Клик по зоне открывает окно, как карта зоны в
    /// Albion: в шапке тир, знак опасности, название и правила зоны, справа — ресурсы
    /// угодий с тиром (и жила ×2); ниже — карта зоны, как локальная карта: снимок зоны
    /// сверху, запечённый RoaZoneMapBaker (public/assets/zone-maps), север вверху, со
    /// сторонами света, воротами, местами и отметкой игрока. Пока снимок грузится или
    /// если его нет, на его месте кадр 3D-карты мира над зоной. Справа —
    /// подробности и «Проложить путь». Компас в углу поворачивается вместе с камерой,
    /// клик по нему возвращает север наверх.
    /// </summary>
    public sealed partial class RoaWorldOverviewCanvas
    {
        private const float WindowWidth = 760f;
        private const float WindowHeight = 520f;
        private const float HeaderHeight = 72f;
        private const float PreviewSize = 360f;
        // Отступ местности от края: букве «З» нужно место внутри рамки окна.
        private const float PreviewLeft = 52f;
        private const int PreviewPixels = 512;
        // Запасной кадр 3D-карты захватывает и полосу соседей: границы зоны с проёмами
        // ворот видны целиком. Запечённая карта зоны занимает рамку ровно.
        private const float FallbackMargin = 0.06f;
        private const int ZoneMapCacheSize = 16;
        private const int ResourceSlots = 4;
        private const float ResourceSlotWidth = 72f;

        private static readonly Color HeaderBg = new Color(0.1f, 0.09f, 0.065f, 0.98f);
        private static readonly Color GateColor = new Color(1f, 0.82f, 0.25f, 1f);
        private static readonly string[] CompassLetters = { "С", "В", "Ю", "З" };

        private Text _cardTier;
        private Image _cardDanger;
        private Text _cardSubtitle;
        private RawImage _preview;
        private RenderTexture _previewTexture;
        private RectTransform _previewLabels;
        private RectTransform _previewFlag;
        private readonly Dictionary<char, RectTransform> _gateMarks = new Dictionary<char, RectTransform>();
        private readonly List<Text> _previewLabelPool = new List<Text>();
        private readonly List<Image> _previewMarkPool = new List<Image>();
        private readonly List<RawImage> _resourceIcons = new List<RawImage>();
        private readonly List<Text> _resourceLabels = new List<Text>();
        private readonly List<Outline> _resourceFrames = new List<Outline>();
        private Text _resourceEmpty;
        private readonly Dictionary<string, Texture2D> _resourceTextures = new Dictionary<string, Texture2D>();

        private float _previewMargin = FallbackMargin;
        private readonly Dictionary<char, Vector2> _gateDirections = new Dictionary<char, Vector2>();
        private JObject _zoneMapHashes;
        private bool _zoneMapManifestLoading;
        private bool _zoneMapManifestFailed;
        private readonly Dictionary<string, Texture2D> _zoneMaps = new Dictionary<string, Texture2D>(StringComparer.Ordinal);
        private readonly List<string> _zoneMapOrder = new List<string>();
        private readonly HashSet<string> _zoneMapLoading = new HashSet<string>(StringComparer.Ordinal);

        private RectTransform _compassRose;
        private readonly List<RectTransform> _compassLetters = new List<RectTransform>();

        /// <summary>Открыто ли окно зоны (пробы).</summary>
        public bool ZoneWindowOpen { get { return _card != null && _card.gameObject.activeInHierarchy; } }

        /// <summary>Пробы редактора: открыть окно поверх уже подключённой 3D-карты.</summary>
        public void AttachMapForProbe(RoaWorldMap3D map)
        {
            EnsureBuilt();
            _root.SetActive(true);
            _map3D = map;
            ShowMode(true);
            if (!_map3D.HasZones) _map3D.ShowZones(_zonesById.Values, _zoneKm, DangerZoneColor);
            Vector2? player = PlayerPoint(CurrentSelf, out JObject _);
            _map3D.SetPlayer(player);
        }

        /// <summary>Подставить запечённую карту зоны без запроса (пробы).</summary>
        public void SetZoneMapForProbe(string id, Texture2D texture) { _zoneMaps[id] = texture; }

        /// <summary>Повернуть компас по камере карты (пробы: LateUpdate в редакторе не идёт).</summary>
        public void UpdateCompassForProbe() { UpdateCompass(); }

        /// <summary>Выбрать зону (и место в ней) как кликом по карте — пробы.</summary>
        public void SelectForProbe(string zoneId, string placeId = null)
        {
            if (!_zonesById.TryGetValue(zoneId ?? string.Empty, out JObject zone)) return;
            _selectedZone = zone;
            _selectedPlace = null;
            foreach (JToken token in zone["places"] as JArray ?? new JArray())
                if (token is JObject place && place["id"]?.ToString() == placeId) _selectedPlace = place;
            _map3D?.SetSelection(_selectedPlace != null ? PlacePoint(zone, _selectedPlace) : ZoneCentre(zone));
            ShowCard();
        }

        /// <summary>Строка ресурса под значком: семейство и тир (у жилы — ×2).</summary>
        public static List<(string family, int tier, bool hotspot)> ZoneResources(JObject zone)
        {
            var rows = new List<(string, int, bool)>();
            int tier = Tier(zone);
            foreach (JToken token in (zone?["grounds"] as JObject)?["families"] as JArray ?? new JArray())
            {
                string family = token?.ToString();
                if (!string.IsNullOrEmpty(family)) rows.Add((family, tier, false));
            }
            if (zone?["hotspot"] is JObject hotspot && !string.IsNullOrEmpty(hotspot["family"]?.ToString()))
                rows.Add((hotspot["family"].ToString(), hotspot["tier"]?.ToObject<int?>() ?? tier, true));
            return rows;
        }

        private void ShowCard()
        {
            if (_selectedZone == null) { _card.gameObject.SetActive(false); return; }
            JObject zone = _selectedZone;
            _card.gameObject.SetActive(true);
            string mode = zone["mode"]?.ToString();
            int tier = Tier(_selectedPlace ?? zone);
            _cardTier.text = tier > 0 ? RoaTierData.Badge(tier) : "—";
            _cardDanger.color = DangerZoneColor(mode);
            _cardTitle.text = _selectedPlace != null
                ? (_selectedPlace["name"]?.ToString() ?? "Место")
                : (zone["title"]?.ToString() ?? RoaWorldMapRoute.Id(zone));
            _cardSubtitle.text = "Зона " + DangerRulesText(mode);
            FillResources(zone);
            FillPreview(zone);

            var body = new System.Text.StringBuilder();
            if (_selectedPlace != null) body.Append("В зоне: ").Append(zone["title"]).Append('\n');
            body.Append("Зона №").Append(zone["n"]).Append('\n');
            bool isCity = !string.IsNullOrEmpty(zone["city"]?.ToString());
            if (isCity) body.Append("Город занимает сектор целиком: ворота соседей ведут прямо в него.\n");
            string tierLine = TierRulesText(tier);
            if (!string.IsNullOrEmpty(tierLine)) body.Append(tierLine).Append('\n');
            string groundsLine = GroundsText(zone);
            if (!string.IsNullOrEmpty(groundsLine)) body.Append(groundsLine).Append('\n');
            string gates = zone["gates"]?.ToString() ?? string.Empty;
            var open = new List<string>();
            foreach (char side in RoaWorldMapRoute.Sides) if (gates.IndexOf(side) >= 0) open.Add(RoaWorldMapRoute.GateName(side));
            body.Append("Ворота: ").Append(open.Count > 0 ? string.Join(", ", open) : "нет").Append('\n');
            var places = new List<string>();
            foreach (JToken token in zone["places"] as JArray ?? new JArray()) places.Add(token?["name"]?.ToString() ?? string.Empty);
            if (places.Count > 0) body.Append("Места: ").Append(string.Join(", ", places)).Append('\n');
            string from = CurrentZoneId();
            List<JObject> path = RoaWorldMapRoute.Find(_zonesById, from, RoaWorldMapRoute.Id(zone));
            body.Append('\n');
            if (string.IsNullOrEmpty(from)) body.Append("Путь проложить нельзя: вы не в зоне мира.");
            else if (path.Count == 0) body.Append("Пути туда через открытые ворота нет.");
            else if (path.Count == 1) body.Append("Вы уже здесь.");
            else body.Append("Путь: ").Append(RoaWorldMapRoute.ZonesWord(path.Count - 1)).Append(" через ворота.");
            _cardBody.text = body.ToString();
            bool routed = _routeTargetZone == RoaWorldMapRoute.Id(zone);
            _routeButtonLabel.text = routed ? "Сбросить путь" : "Проложить путь";
            _routeButton.interactable = routed || path.Count > 1;
        }

        private void CloseCard()
        {
            _selectedZone = null;
            _selectedPlace = null;
            _map3D?.SetSelection(null);
            _card.gameObject.SetActive(false);
        }

        private void FillResources(JObject zone)
        {
            List<(string family, int tier, bool hotspot)> rows = ZoneResources(zone);
            for (int i = 0; i < ResourceSlots; i++)
            {
                bool used = i < rows.Count;
                Transform slot = _resourceIcons[i].transform.parent;
                slot.gameObject.SetActive(used);
                if (!used) continue;
                var row = rows[i];
                Texture2D icon = ResourceIcon(row.family, row.tier);
                _resourceIcons[i].texture = icon;
                _resourceIcons[i].color = icon != null ? Color.white : new Color(1f, 1f, 1f, 0f);
                string badge = RoaTierData.Badge(row.tier);
                _resourceLabels[i].text = (row.hotspot ? "жила" : FamilyName(row.family)) + "\n"
                    + (badge.Length > 0 ? badge : "—") + (row.hotspot ? " ×2" : string.Empty);
                _resourceFrames[i].effectColor = row.hotspot ? Accent : new Color(PanelBorder.r, PanelBorder.g, PanelBorder.b, 0.3f);
            }
            _resourceEmpty.gameObject.SetActive(rows.Count == 0);
        }

        /// <summary>Значок сырья тира: item_ore, item_oreT3 и т. д. (у T1 — без суффикса).</summary>
        private Texture2D ResourceIcon(string family, int tier)
        {
            string key = "item_" + family + (tier > 1 ? "T" + tier : string.Empty);
            if (_resourceTextures.TryGetValue(key, out Texture2D cached)) return cached;
            Texture2D texture = Resources.Load<Texture2D>("RealmUi/items/" + key);
            if (texture == null && tier > 1) texture = Resources.Load<Texture2D>("RealmUi/items/item_" + family);
            _resourceTextures[key] = texture;
            return texture;
        }

        private void FillPreview(JObject zone)
        {
            int col = RoaWorldMapRoute.Col(zone), row = RoaWorldMapRoute.Row(zone);
            if (_previewTexture == null)
            {
                _previewTexture = new RenderTexture(PreviewPixels, PreviewPixels, 24, RenderTextureFormat.ARGB32) { name = "WorldZonePreview" };
            }
            string id = RoaWorldMapRoute.Id(zone);
            if (_zoneMaps.TryGetValue(id, out Texture2D baked) && baked != null)
            {
                _previewMargin = 0f;
                _preview.texture = baked;
                _preview.color = Color.white;
                // Снимок зоны снят сверху с +Z вверху, а север сектора — −Z (там северные
                // ворота): кадр переворачивается, чтобы север был вверху, как у ворот,
                // мест, флажка и бури.
                _preview.uvRect = new Rect(0f, 1f, 1f, -1f);
            }
            else
            {
                _previewMargin = FallbackMargin;
                Vector2 corner = new Vector2((col - FallbackMargin) * _zoneKm, (row - FallbackMargin) * _zoneKm);
                bool rendered = Uses3D && _map3D.RenderArea(corner, _zoneKm * (1f + 2f * FallbackMargin), _previewTexture);
                _preview.texture = rendered ? _previewTexture : null;
                _preview.color = rendered ? Color.white : Color.Lerp(Void, DangerZoneColor(zone["mode"]?.ToString()), 0.45f);
                _preview.uvRect = new Rect(0f, 0f, 1f, 1f);
                if (isActiveAndEnabled) StartCoroutine(LoadZoneMap(id));
            }

            // Буря выброса над этим квадратом карты — там же, где полоса на 3D-карте.
            if (_previewStorm != null)
                _previewStorm.ShowMapArea(new Vector2((col - _previewMargin) * _zoneKm, (row - _previewMargin) * _zoneKm), _zoneKm * (1f + 2f * _previewMargin));

            // Ворота — у края зоны: на запасном кадре край отступает от рамки на полосу соседей.
            float edge = Mathf.Max(5f, _previewMargin / (1f + 2f * _previewMargin) * PreviewSize);
            foreach (char side in RoaWorldMapRoute.Sides)
            {
                if (!_gateMarks.TryGetValue(side, out RectTransform mark)) continue;
                mark.gameObject.SetActive(RoaWorldMapRoute.IsOpen(zone, side));
                if (_gateDirections.TryGetValue(side, out Vector2 inward)) mark.anchoredPosition = inward * edge;
            }

            foreach (Text label in _previewLabelPool) label.gameObject.SetActive(false);
            foreach (Image mark in _previewMarkPool) mark.gameObject.SetActive(false);
            int used = 0, marks = 0;
            string city = zone["city"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(city))
            {
                bool capital = _capitals.Contains(city);
                PreviewMark(ref marks, new Vector2(0.5f, 0.5f), capital ? 16f : 13f, capital ? Accent : Ink);
                PreviewLabel(ref used, new Vector2(0.5f, 0.5f), zone["title"]?.ToString() ?? city, 13, capital ? Accent : Ink, -18f);
            }
            foreach (JToken token in zone["places"] as JArray ?? new JArray())
            {
                if (!(token is JObject place)) continue;
                bool capital = _capitals.Contains(place["id"]?.ToString() ?? string.Empty);
                bool chosen = ReferenceEquals(place, _selectedPlace);
                Vector2 uv = new Vector2(place["u"]?.ToObject<float>() ?? 0.5f, place["v"]?.ToObject<float>() ?? 0.5f);
                Color color = chosen ? GateColor : capital ? Accent : Ink;
                PreviewMark(ref marks, uv, capital ? 14f : 10f, color);
                PreviewLabel(ref used, uv, (place["name"]?.ToString() ?? string.Empty) + PlaceTierSuffix(zone, place), 12, color, -16f);
            }

            Vector2? player = RoaWorldMapRoute.Id(zone) == CurrentZoneId() ? PlayerPoint(CurrentSelf, out JObject _) : null;
            _previewFlag.gameObject.SetActive(player.HasValue);
            if (player.HasValue)
            {
                Vector2 uv = new Vector2(player.Value.x / _zoneKm - col, player.Value.y / _zoneKm - row);
                _previewFlag.anchoredPosition = PreviewPosition(uv);
                _previewFlag.SetAsLastSibling();
            }
        }

        /// <summary>Доля зоны (u — на восток, v — на юг) в точку кадра местности.</summary>
        private Vector2 PreviewPosition(Vector2 uv)
        {
            float span = 1f + 2f * _previewMargin;
            return new Vector2((_previewMargin + uv.x) / span * PreviewSize, -(_previewMargin + uv.y) / span * PreviewSize);
        }

        /// <summary>Запечённая карта зоны: манифест один раз, снимок — по первому показу зоны.</summary>
        private IEnumerator LoadZoneMap(string id)
        {
            if (string.IsNullOrEmpty(id) || _zoneMapLoading.Contains(id) || _zoneMapManifestFailed) yield break;
            _zoneMapLoading.Add(id);
            string root = (Loader != null ? Loader.BaseUrl : "http://127.0.0.1:3000").TrimEnd('/') + "/assets/zone-maps/";
            try
            {
                while (_zoneMapManifestLoading) yield return null;
                if (_zoneMapHashes == null && !_zoneMapManifestFailed)
                {
                    _zoneMapManifestLoading = true;
                    using (UnityWebRequest request = UnityWebRequest.Get(root + "manifest.json"))
                    {
                        yield return request.SendWebRequest();
                        _zoneMapManifestLoading = false;
                        if (request.result == UnityWebRequest.Result.Success)
                        {
                            try { _zoneMapHashes = JObject.Parse(request.downloadHandler.text)["zones"] as JObject; }
                            catch (Exception) { _zoneMapHashes = null; }
                        }
                        // Карт нет — окно остаётся на кадре 3D-карты и больше не спрашивает.
                        if (_zoneMapHashes == null) _zoneMapManifestFailed = true;
                    }
                }
                string hash = _zoneMapHashes?[id]?.ToString();
                if (string.IsNullOrEmpty(hash)) yield break;
                using (UnityWebRequest request = UnityWebRequestTexture.GetTexture(root + Uri.EscapeDataString(id) + ".jpg?v=" + hash, true))
                {
                    yield return request.SendWebRequest();
                    if (request.result != UnityWebRequest.Result.Success) yield break;
                    Texture2D texture = DownloadHandlerTexture.GetContent(request);
                    if (texture == null) yield break;
                    texture.name = "ZoneMap:" + id;
                    texture.wrapMode = TextureWrapMode.Clamp;
                    _zoneMaps[id] = texture;
                    _zoneMapOrder.Remove(id);
                    _zoneMapOrder.Add(id);
                    while (_zoneMapOrder.Count > ZoneMapCacheSize)
                    {
                        string oldest = _zoneMapOrder[0];
                        _zoneMapOrder.RemoveAt(0);
                        if (_zoneMaps.TryGetValue(oldest, out Texture2D stale) && stale != null && stale != _preview.texture) Destroy(stale);
                        _zoneMaps.Remove(oldest);
                    }
                }
                if (_selectedZone != null && RoaWorldMapRoute.Id(_selectedZone) == id && ZoneWindowOpen) FillPreview(_selectedZone);
            }
            finally
            {
                _zoneMapLoading.Remove(id);
            }
        }

        /// <summary>Ромбик места на местности: у бандл-шрифта нет геометрических значков.</summary>
        private void PreviewMark(ref int used, Vector2 uv, float size, Color color)
        {
            if (used >= _previewMarkPool.Count) _previewMarkPool.Add(Diamond("PlaceMark", _previewLabels, Ink));
            Image mark = _previewMarkPool[used++];
            mark.gameObject.SetActive(true);
            mark.color = color;
            mark.rectTransform.sizeDelta = new Vector2(size, size);
            mark.rectTransform.anchoredPosition = PreviewPosition(uv);
        }

        private static Image Diamond(string name, RectTransform parent, Color color)
        {
            RectTransform rect = Child(name, parent);
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.localRotation = Quaternion.Euler(0f, 0f, 45f);
            Image image = rect.gameObject.AddComponent<Image>();
            image.color = color;
            image.raycastTarget = false;
            var outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0f, 0f, 0f, 0.85f);
            outline.effectDistance = new Vector2(1.5f, -1.5f);
            return image;
        }

        private void PreviewLabel(ref int used, Vector2 uv, string text, int size, Color color, float dy = 0f)
        {
            if (used >= _previewLabelPool.Count)
            {
                Text created = Label("PlaceLabel", _previewLabels, 12, TextAnchor.MiddleCenter, Ink);
                created.gameObject.AddComponent<Shadow>().effectColor = new Color(0f, 0f, 0f, 0.9f);
                RectTransform rect = created.rectTransform;
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                rect.sizeDelta = new Vector2(200f, 20f);
                _previewLabelPool.Add(created);
            }
            Text label = _previewLabelPool[used++];
            label.gameObject.SetActive(true);
            label.text = text;
            label.fontSize = size;
            label.color = color;
            label.rectTransform.anchoredPosition = PreviewPosition(uv) + new Vector2(0f, dy);
        }

        // --- компас -------------------------------------------------------------------------------------

        private void UpdateCompass()
        {
            if (_compassRose == null || _map3D == null) return;
            float angle = _map3D.NorthScreenAngle();
            _compassRose.localRotation = Quaternion.Euler(0f, 0f, -angle);
            // Буквы стоят по кругу, но читаются прямо.
            foreach (RectTransform letter in _compassLetters) letter.rotation = Quaternion.identity;
        }

        private void ResetNorth()
        {
            if (_map3D != null && _map3D.IsOpen) _map3D.SetView(0f, _map3D.Pitch);
        }

        /// <summary>Большие буквы сторон света у краёв мира: видны, когда край в кадре.</summary>
        private void LayoutEdgeLetters(ref int used)
        {
            float width = _cols * _zoneKm, height = _rows * _zoneKm, off = _zoneKm * 0.35f;
            Vector2[] points =
            {
                new Vector2(width * 0.5f, -off), new Vector2(width + off, height * 0.5f),
                new Vector2(width * 0.5f, height + off), new Vector2(-off, height * 0.5f)
            };
            for (int i = 0; i < points.Length; i++)
            {
                if (!_map3D.PointToScreen(points[i], 0.2f, out Vector2 at)) continue;
                Text letter = TakeViewLabel(ref used);
                letter.fontSize = 28;
                letter.fontStyle = FontStyle.Bold;
                letter.color = i == 0 ? Accent : Ink;
                letter.text = CompassLetters[i];
                PlaceViewLabel(letter, at);
            }
        }

        // --- постройка ----------------------------------------------------------------------------------

        private void BuildCompass(RectTransform parent)
        {
            RectTransform compass = Child("Compass", parent);
            Place(compass, 0f, 1f, 0f, 1f, new Vector2(16f, -178f), new Vector2(112f, -82f));
            Image face = compass.gameObject.AddComponent<Image>();
            face.color = PanelBg;
            var outline = compass.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);
            var button = compass.gameObject.AddComponent<Button>();
            button.targetGraphic = face;
            button.onClick.AddListener(ResetNorth);

            _compassRose = Child("Rose", compass);
            _compassRose.anchorMin = _compassRose.anchorMax = new Vector2(0.5f, 0.5f);
            _compassRose.sizeDelta = Vector2.zero;
            Needle(_compassRose, new Color(0.9f, 0.25f, 0.18f, 1f), new Vector2(0.5f, 0f));
            Needle(_compassRose, new Color(0.85f, 0.82f, 0.72f, 1f), new Vector2(0.5f, 1f));
            Vector2[] at = { new Vector2(0f, 34f), new Vector2(34f, 0f), new Vector2(0f, -34f), new Vector2(-34f, 0f) };
            for (int i = 0; i < CompassLetters.Length; i++)
            {
                Text letter = Label("Letter" + CompassLetters[i], _compassRose, i == 0 ? 17 : 14, TextAnchor.MiddleCenter,
                    i == 0 ? Accent : Ink, FontStyle.Bold);
                letter.text = CompassLetters[i];
                RectTransform rect = letter.rectTransform;
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.sizeDelta = new Vector2(24f, 24f);
                rect.anchoredPosition = at[i];
                _compassLetters.Add(rect);
            }
        }

        private static void Needle(RectTransform rose, Color color, Vector2 pivot)
        {
            RectTransform needle = Child("Needle", rose);
            needle.anchorMin = needle.anchorMax = new Vector2(0.5f, 0.5f);
            needle.pivot = pivot;
            needle.sizeDelta = new Vector2(6f, 22f);
            needle.anchoredPosition = Vector2.zero;
            Image image = needle.gameObject.AddComponent<Image>();
            image.color = color;
            image.raycastTarget = false;
        }

        /// <summary>Буквы сторон света у краёв плоской карты: север всегда вверху.</summary>
        private void BuildFlatCompass()
        {
            Vector2[] anchors = { new Vector2(0.5f, 1f), new Vector2(1f, 0.5f), new Vector2(0.5f, 0f), new Vector2(0f, 0.5f) };
            Vector2[] offsets = { new Vector2(0f, -12f), new Vector2(-12f, 0f), new Vector2(0f, 12f), new Vector2(12f, 0f) };
            for (int i = 0; i < CompassLetters.Length; i++)
            {
                Text letter = Label("Side" + CompassLetters[i], _map, 18, TextAnchor.MiddleCenter, i == 0 ? Accent : Ink, FontStyle.Bold);
                letter.gameObject.AddComponent<Shadow>().effectColor = new Color(0f, 0f, 0f, 0.9f);
                letter.text = CompassLetters[i];
                RectTransform rect = letter.rectTransform;
                rect.anchorMin = rect.anchorMax = anchors[i];
                rect.sizeDelta = new Vector2(24f, 24f);
                rect.anchoredPosition = offsets[i];
            }
        }

        private void BuildZoneWindow(RectTransform parent)
        {
            _card = Child("ZoneWindow", parent);
            _card.anchorMin = _card.anchorMax = new Vector2(0.5f, 0.5f);
            _card.pivot = new Vector2(0.5f, 0.5f);
            _card.sizeDelta = new Vector2(WindowWidth, WindowHeight);
            _card.anchoredPosition = new Vector2(0f, -7f);
            Image background = _card.gameObject.AddComponent<Image>();
            background.color = PanelBg;
            RoaApocalypseUiKit.StyleWindow(background, true);
            var outline = _card.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            // Шапка: тир, знак опасности, имя и правила, справа — ресурсы.
            RectTransform header = Child("Header", _card);
            Place(header, 0f, 1f, 1f, 1f, new Vector2(0f, -HeaderHeight), Vector2.zero);
            header.gameObject.AddComponent<Image>().color = HeaderBg;
            _cardTier = Label("Tier", header, 28, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            _cardTier.supportRichText = true;
            Place(_cardTier.rectTransform, 0f, 0f, 0f, 1f, new Vector2(10f, 0f), new Vector2(66f, 0f));
            _cardDanger = Diamond("Danger", header, YellowZoneColor);
            _cardDanger.rectTransform.sizeDelta = new Vector2(15f, 15f);
            _cardDanger.rectTransform.anchoredPosition = new Vector2(80f, -23f);
            float resourcesLeft = ResourceSlots * ResourceSlotWidth + 56f;
            _cardTitle = Label("Title", header, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            _cardTitle.horizontalOverflow = HorizontalWrapMode.Wrap;
            _cardTitle.resizeTextForBestFit = true;
            _cardTitle.resizeTextMinSize = 14;
            _cardTitle.resizeTextMaxSize = 20;
            Place(_cardTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(94f, -40f), new Vector2(-resourcesLeft - 8f, -6f));
            _cardSubtitle = Label("Subtitle", header, 12, TextAnchor.MiddleLeft, MutedInk);
            _cardSubtitle.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_cardSubtitle.rectTransform, 0f, 0f, 1f, 0f, new Vector2(68f, 6f), new Vector2(-resourcesLeft - 8f, 32f));

            for (int i = 0; i < ResourceSlots; i++)
            {
                RectTransform slot = Child("Resource" + i, header);
                float left = -resourcesLeft + i * ResourceSlotWidth + 4f;
                Place(slot, 1f, 0f, 1f, 1f, new Vector2(left, 4f), new Vector2(left + ResourceSlotWidth - 6f, -4f));
                // Подложка непрозрачна: Outline копирует всю плашку, и сквозь прозрачную проступал бы цвет рамки.
                slot.gameObject.AddComponent<Image>().color = new Color(0.07f, 0.065f, 0.05f, 1f);
                Outline frame = slot.gameObject.AddComponent<Outline>();
                frame.effectDistance = new Vector2(1f, -1f);
                RectTransform iconRect = Child("Icon", slot);
                Place(iconRect, 0.5f, 1f, 0.5f, 1f, new Vector2(-17f, -36f), new Vector2(17f, -2f));
                RawImage icon = iconRect.gameObject.AddComponent<RawImage>();
                icon.raycastTarget = false;
                Text label = Label("Label", slot, 11, TextAnchor.LowerCenter, Ink);
                label.supportRichText = true;
                label.lineSpacing = 0.9f;
                Place(label.rectTransform, 0f, 0f, 1f, 0f, new Vector2(0f, 1f), new Vector2(0f, 30f));
                _resourceIcons.Add(icon);
                _resourceLabels.Add(label);
                _resourceFrames.Add(frame);
            }
            _resourceEmpty = Label("NoResources", header, 12, TextAnchor.MiddleCenter, MutedInk);
            _resourceEmpty.text = "ресурсов нет";
            Place(_resourceEmpty.rectTransform, 1f, 0f, 1f, 1f, new Vector2(-resourcesLeft, 0f), new Vector2(-56f, 0f));

            Button close = MakeButton("Close", header, "×", 22, CloseCard);
            Place((RectTransform)close.transform, 1f, 0.5f, 1f, 0.5f, new Vector2(-48f, -19f), new Vector2(-10f, 19f));

            // Местность зоны: север вверху, по краям — стороны света и ворота.
            float top = -HeaderHeight - 30f;
            RectTransform frameRect = Child("Terrain", _card);
            Place(frameRect, 0f, 1f, 0f, 1f, new Vector2(PreviewLeft, top - PreviewSize), new Vector2(PreviewLeft + PreviewSize, top));
            _preview = frameRect.gameObject.AddComponent<RawImage>();
            var previewOutline = frameRect.gameObject.AddComponent<Outline>();
            previewOutline.effectColor = PanelBorder;
            previewOutline.effectDistance = new Vector2(2f, -2f);
            // Буря — поверх местности и под воротами, местами и флажком.
            _previewStorm = RoaStormMapOverlay.Attach(frameRect);
            Vector2[] letterAt = { new Vector2(0.5f, 1f), new Vector2(1f, 0.5f), new Vector2(0.5f, 0f), new Vector2(0f, 0.5f) };
            Vector2[] letterOff = { new Vector2(0f, 14f), new Vector2(14f, 0f), new Vector2(0f, -14f), new Vector2(-14f, 0f) };
            for (int i = 0; i < CompassLetters.Length; i++)
            {
                Text letter = Label("Side" + CompassLetters[i], frameRect, i == 0 ? 20 : 17, TextAnchor.MiddleCenter, i == 0 ? Accent : Ink, FontStyle.Bold);
                letter.text = CompassLetters[i];
                RectTransform rect = letter.rectTransform;
                rect.anchorMin = rect.anchorMax = letterAt[i];
                rect.sizeDelta = new Vector2(24f, 24f);
                rect.anchoredPosition = letterOff[i];
            }
            // Ворота — жёлтые планки посередине открытых сторон.
            char[] sides = { 'n', 'e', 's', 'w' };
            for (int i = 0; i < sides.Length; i++)
            {
                RectTransform mark = Child("Gate_" + sides[i], frameRect);
                mark.anchorMin = mark.anchorMax = letterAt[i];
                bool horizontal = sides[i] == 'n' || sides[i] == 's';
                mark.sizeDelta = horizontal ? new Vector2(46f, 8f) : new Vector2(8f, 46f);
                _gateDirections[sides[i]] = new Vector2(-letterOff[i].x, -letterOff[i].y).normalized;
                Image image = mark.gameObject.AddComponent<Image>();
                image.color = GateColor;
                image.raycastTarget = false;
                var gateOutline = mark.gameObject.AddComponent<Outline>();
                gateOutline.effectColor = new Color(0f, 0f, 0f, 0.8f);
                _gateMarks[sides[i]] = mark;
            }
            _previewLabels = Child("Places", frameRect);
            Place(_previewLabels, 0f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            // Игрок — красный ромб с подписью «Вы».
            Image flag = Diamond("Player", frameRect, FlagColor);
            flag.rectTransform.sizeDelta = new Vector2(14f, 14f);
            _previewFlag = flag.rectTransform;
            Text you = Label("You", _previewFlag, 12, TextAnchor.MiddleCenter, FlagColor, FontStyle.Bold);
            you.gameObject.AddComponent<Shadow>().effectColor = new Color(0f, 0f, 0f, 0.9f);
            you.text = "Вы";
            you.rectTransform.anchorMin = you.rectTransform.anchorMax = new Vector2(0.5f, 0.5f);
            you.rectTransform.sizeDelta = new Vector2(40f, 18f);
            you.rectTransform.localRotation = Quaternion.Euler(0f, 0f, -45f);
            you.rectTransform.anchoredPosition = new Vector2(12f, 12f);

            // Подробности и путь — справа от местности.
            float infoLeft = PreviewLeft + PreviewSize + 34f;
            _cardBody = Label("Body", _card, 12, TextAnchor.UpperLeft, Ink);
            _cardBody.supportRichText = true;
            _cardBody.horizontalOverflow = HorizontalWrapMode.Wrap;
            _cardBody.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_cardBody.rectTransform, 0f, 0f, 1f, 1f, new Vector2(infoLeft, 70f), new Vector2(-28f, -HeaderHeight - 18f));
            _routeButton = MakeButton("Route", _card, "Проложить путь", 14, ToggleRoute);
            _routeButtonLabel = _routeButton.GetComponentInChildren<Text>();
            Place((RectTransform)_routeButton.transform, 0f, 0f, 1f, 0f, new Vector2(infoLeft, 28f), new Vector2(-28f, 64f));
            _card.gameObject.SetActive(false);
        }

        private void ReleaseZoneWindow()
        {
            foreach (Texture2D texture in _zoneMaps.Values) if (texture != null) Destroy(texture);
            _zoneMaps.Clear();
            _zoneMapOrder.Clear();
            if (_previewTexture != null)
            {
                _previewTexture.Release();
                Destroy(_previewTexture);
                _previewTexture = null;
            }
        }
    }
}
