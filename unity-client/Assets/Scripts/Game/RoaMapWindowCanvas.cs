using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Окно карты локации — клавиша M, как #map-window в web: заголовок с именем
    /// локации и холст 680×520 с тем же рендером, что у HUD-миникарты
    /// (drawMinimap, 13_minimap_hud_loop.js:194), только крупно.
    ///
    /// Сам рендер не дублируется: тайлы — StaticTexture из RoaMinimap, поверх —
    /// его же маркеры. Web в этом режиме («legacy») рисует врагов и игрока;
    /// здесь остальные маркеры (игроки, предметы, контейнеры) тоже показаны —
    /// туман войны их и так уже отфильтровал в RoaMinimap.
    /// </summary>
    public sealed class RoaMapWindowCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.075f, 0.071f, 0.055f, 0.97f);
        private static readonly Color PanelBorder = new Color(0.82f, 0.694f, 0.404f, 0.58f);
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);

        public RoaMinimap Minimap;
        public RoaPlayerController Player;
        public bool InputEnabled = true;

        /// <summary>Размер холста web (#minimap 680×520).</summary>
        private const float MapWidth = 680f;
        private const float MapHeight = 520f;

        private Canvas _canvas;
        private GameObject _root;
        private Text _title;
        private Text _hint;
        private RawImage _mapImage;
        private RectTransform _markerLayer;
        private readonly List<Image> _markers = new List<Image>();
        private RectTransform _playerArrow;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        private void Update()
        {
            // Закрываемся только когда bootstrap отключает ввод (меню, глобальная
            // карта). BlocksWorldHud сюда нельзя: он учитывает и это окно —
            // карта закрывала бы себя в кадр открытия.
            if (!InputEnabled)
            {
                if (IsOpen) Close();
                return;
            }

            if (Input.GetKeyDown(KeyCode.M)) Toggle();
            else if (IsOpen && Input.GetKeyDown(KeyCode.Escape)) Close();

            if (IsOpen) Refresh();
        }

        public void Toggle()
        {
            if (IsOpen) Close();
            else Open();
        }

        public void Open()
        {
            EnsureBuilt();
            _root.SetActive(true);
            Refresh();
        }

        public void Close()
        {
            if (_root != null) _root.SetActive(false);
        }

        private void EnsureBuilt()
        {
            if (_root != null) return;

            var canvasGo = new GameObject("MapWindowCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 41;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            _root = new GameObject("MapWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            rootRect.anchorMin = Vector2.zero;
            rootRect.anchorMax = Vector2.one;
            rootRect.offsetMin = Vector2.zero;
            rootRect.offsetMax = Vector2.zero;
            var dim = _root.AddComponent<Image>();
            dim.color = new Color(0f, 0f, 0f, 0.4f);

            RectTransform panel = Child("Panel", rootRect);
            panel.anchorMin = panel.anchorMax = new Vector2(0.5f, 0.5f);
            panel.pivot = new Vector2(0.5f, 0.5f);
            panel.sizeDelta = new Vector2(MapWidth + 32f, MapHeight + 92f);
            var back = panel.gameObject.AddComponent<Image>();
            back.color = PanelBg;
            var outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            _title = Label("Title", panel, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            _title.rectTransform.anchorMin = new Vector2(0f, 1f);
            _title.rectTransform.anchorMax = new Vector2(1f, 1f);
            _title.rectTransform.pivot = new Vector2(0.5f, 1f);
            _title.rectTransform.offsetMin = new Vector2(16f, -44f);
            _title.rectTransform.offsetMax = new Vector2(-56f, -8f);

            Button close = TextButton("Close", panel, "×", 24, out Text closeText);
            var closeRect = (RectTransform)close.transform;
            closeRect.anchorMin = closeRect.anchorMax = new Vector2(1f, 1f);
            closeRect.pivot = new Vector2(1f, 1f);
            closeRect.anchoredPosition = new Vector2(-8f, -8f);
            closeRect.sizeDelta = new Vector2(36f, 32f);
            closeText.color = Accent;
            close.onClick.AddListener(Close);

            RectTransform map = Child("Map", panel);
            map.anchorMin = new Vector2(0.5f, 1f);
            map.anchorMax = new Vector2(0.5f, 1f);
            map.pivot = new Vector2(0.5f, 1f);
            map.anchoredPosition = new Vector2(0f, -52f);
            map.sizeDelta = new Vector2(MapWidth, MapHeight);
            var mapBack = map.gameObject.AddComponent<Image>();
            mapBack.color = new Color(0.027f, 0.047f, 0.051f, 1f); // #070c0d — фон холста web
            mapBack.raycastTarget = false;

            _mapImage = Child("Tiles", map).gameObject.AddComponent<RawImage>();
            Stretch(_mapImage.rectTransform, 0f);
            _mapImage.raycastTarget = false;

            _markerLayer = Child("Markers", map);
            Stretch(_markerLayer, 0f);

            _playerArrow = Child("Player", _markerLayer);
            _playerArrow.anchorMin = _playerArrow.anchorMax = Vector2.zero;
            _playerArrow.pivot = new Vector2(0.5f, 0.5f);
            _playerArrow.sizeDelta = new Vector2(24f, 24f);
            Text arrow = _playerArrow.gameObject.AddComponent<Text>();
            arrow.font = RoaUiFont.Default;
            arrow.fontSize = 18;
            // Без overflow глиф выше области не рисуется вовсе.
            arrow.horizontalOverflow = HorizontalWrapMode.Overflow;
            arrow.verticalOverflow = VerticalWrapMode.Overflow;
            arrow.alignment = TextAnchor.MiddleCenter;
            arrow.color = new Color(0.902f, 0.839f, 0.561f, 1f); // #e6d68f
            arrow.fontStyle = FontStyle.Bold;
            arrow.text = "▲";
            arrow.raycastTarget = false;

            _hint = Label("Hint", panel, 12, TextAnchor.MiddleCenter, new Color(Ink.r, Ink.g, Ink.b, 0.55f));
            _hint.rectTransform.anchorMin = new Vector2(0f, 0f);
            _hint.rectTransform.anchorMax = new Vector2(1f, 0f);
            _hint.rectTransform.pivot = new Vector2(0.5f, 0f);
            _hint.rectTransform.offsetMin = new Vector2(16f, 6f);
            _hint.rectTransform.offsetMax = new Vector2(-16f, 30f);
            _hint.text = "M или Esc — закрыть · красные — противники · синие — игроки · жёлтые — предметы";

            _root.SetActive(false);
        }

        private void Refresh()
        {
            if (Minimap == null) return;

            _title.text = string.IsNullOrEmpty(Minimap.LocationName) ? "Карта" : Minimap.LocationName;

            if (!Minimap.IsReady)
            {
                _mapImage.enabled = false;
                SetMarkerCount(0);
                _playerArrow.gameObject.SetActive(false);
                return;
            }

            _mapImage.enabled = true;
            _mapImage.texture = Minimap.StaticTexture;

            int count = Minimap.Markers.Count;
            SetMarkerCount(count);
            int shown = 0;
            for (int i = 0; i < count; i++)
            {
                RoaMinimap.Marker marker = Minimap.Markers[i];
                Vector2 p = Minimap.WorldToMapNormalized(marker.Position);
                Image image = _markers[i];
                bool visible = p.x >= 0f && p.y >= 0f && p.x <= 1f && p.y <= 1f;
                image.gameObject.SetActive(visible);
                if (!visible) continue;
                shown++;
                image.rectTransform.anchoredPosition = new Vector2(p.x * MapWidth, p.y * MapHeight);
                Style(image, marker.Kind);
            }

            Vector2 player = Minimap.PlayerMapNormalized;
            bool playerVisible = Minimap.HasPlayer && player.x >= 0f && player.y >= 0f && player.x <= 1f && player.y <= 1f;
            _playerArrow.gameObject.SetActive(playerVisible);
            if (playerVisible)
            {
                _playerArrow.anchoredPosition = new Vector2(player.x * MapWidth, player.y * MapHeight);
                _playerArrow.localEulerAngles = new Vector3(0f, 0f, -Minimap.PlayerHeading);
            }
        }

        private void SetMarkerCount(int count)
        {
            while (_markers.Count < count)
            {
                RectTransform rect = Child("Marker" + _markers.Count, _markerLayer);
                rect.anchorMin = rect.anchorMax = Vector2.zero;
                rect.pivot = new Vector2(0.5f, 0.5f);
                var image = rect.gameObject.AddComponent<Image>();
                image.raycastTarget = false;
                _markers.Add(image);
            }
            for (int i = count; i < _markers.Count; i++) _markers[i].gameObject.SetActive(false);
            _playerArrow.SetAsLastSibling();
        }

        /// <summary>Цвета как в drawMinimapActors (13:85), размер в 2.5 раза крупнее миникарты.</summary>
        private static void Style(Image image, RoaMinimap.MarkerKind kind)
        {
            float size;
            switch (kind)
            {
                case RoaMinimap.MarkerKind.Enemy:
                    image.color = new Color(0.878f, 0.314f, 0.216f); size = 10f; break;
                case RoaMinimap.MarkerKind.FriendlyNpc:
                    image.color = new Color(0.46f, 0.75f, 0.62f); size = 10f; break;
                case RoaMinimap.MarkerKind.ServiceNpc:
                    image.color = new Color(0.95f, 0.75f, 0.30f); size = 13f; break;
                case RoaMinimap.MarkerKind.RemotePlayer:
                    image.color = new Color(0.439f, 0.675f, 0.902f); size = 12f; break;
                case RoaMinimap.MarkerKind.GroundItem:
                    image.color = new Color(0.902f, 0.839f, 0.502f); size = 8f; break;
                case RoaMinimap.MarkerKind.Container:
                    image.color = new Color(0.898f, 0.710f, 0.345f); size = 10f; break;
                case RoaMinimap.MarkerKind.Objective:
                    image.color = new Color(0.95f, 0.78f, 0.25f); size = 15f; break;
                case RoaMinimap.MarkerKind.Threat:
                    image.color = new Color(0.96f, 0.24f, 0.16f); size = 19f; break;
                case RoaMinimap.MarkerKind.Extraction:
                    image.color = new Color(0.42f, 0.82f, 0.40f); size = 17f; break;
                default:
                    image.color = new Color(0.78f, 0.62f, 0.30f); size = 8f; break;
            }
            image.rectTransform.sizeDelta = new Vector2(size, size);
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

        private static Button TextButton(string name, RectTransform parent, string caption, int size, out Text label)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = new Color(0f, 0f, 0f, 0.3f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, Ink);
            Stretch(label.rectTransform, 2f);
            label.text = caption;
            return button;
        }
    }
}
