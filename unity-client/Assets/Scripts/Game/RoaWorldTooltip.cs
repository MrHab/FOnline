using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using RealmOfAshes.World;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Подсказка при наведении на постройку города: что это, к какому кварталу
    /// относится и что о ней важно знать. У станка добавляется живое состояние его
    /// участка — свободен он или у него есть арендатор и какой у него сбор.
    ///
    /// Объекты помечает сборщик зоны (<see cref="RoaWorldObjectTag"/>), описание
    /// приходит от конструктора городов полем `hover` объекта локации.
    /// </summary>
    public sealed class RoaWorldTooltip : MonoBehaviour
    {
        private const float Reach = 60f;
        private const float RefreshSeconds = 0.1f;

        public RoaLocationLoader Loader;

        private Canvas _canvas;
        private RectTransform _panel;
        private Text _title;
        private Text _subtitle;
        private Text _body;
        private string _shownId = string.Empty;
        private float _nextProbe;

        private void Awake()
        {
            Build();
            Hide();
        }

        private void Update()
        {
            if (Time.unscaledTime < _nextProbe) return;
            _nextProbe = Time.unscaledTime + RefreshSeconds;
            if (Loader == null || Camera.main == null) { Hide(); return; }
            if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject()) { Hide(); return; }

            Vector3 pointer = Input.mousePosition;
            if (pointer.x < 0f || pointer.y < 0f || pointer.x > Screen.width || pointer.y > Screen.height) { Hide(); return; }
            if (!Physics.Raycast(Camera.main.ScreenPointToRay(pointer), out RaycastHit hit, Reach)) { Hide(); return; }
            var tag = hit.collider.GetComponentInParent<RoaWorldObjectTag>();
            if (tag == null || string.IsNullOrEmpty(tag.ObjectId)) { Hide(); return; }
            LocationObject entry = Loader.ObjectEntry(tag.ObjectId);
            if (entry?.Hover == null) { Hide(); return; }
            Show(entry, pointer);
        }

        private void Show(LocationObject entry, Vector3 pointer)
        {
            if (_shownId != entry.Id)
            {
                _shownId = entry.Id;
                _title.text = entry.Hover["title"]?.ToString() ?? entry.Name ?? string.Empty;
                _subtitle.text = entry.Hover["subtitle"]?.ToString() ?? string.Empty;
                _body.text = BodyText(entry.Hover);
            }
            _panel.gameObject.SetActive(true);
            float height = 34f + (_subtitle.text.Length > 0 ? 16f : 0f) + _body.preferredHeight;
            _panel.sizeDelta = new Vector2(240f, Mathf.Max(52f, height));
            // Панель держится у курсора и не уходит за край экрана.
            float x = Mathf.Min(pointer.x + 18f, Screen.width - _panel.sizeDelta.x - 8f);
            float y = Mathf.Max(pointer.y - 12f, _panel.sizeDelta.y + 8f);
            _panel.position = new Vector3(x, y, 0f);
        }

        private string BodyText(JObject hover)
        {
            var text = new StringBuilder();
            if (hover["lines"] is JArray lines)
            {
                foreach (JToken line in lines)
                {
                    string row = line?.ToString();
                    if (string.IsNullOrEmpty(row)) continue;
                    if (text.Length > 0) text.Append('\n');
                    text.Append("· ").Append(row);
                }
            }
            string station = hover["station"]?.ToString();
            string plotLine = PlotLine(station);
            if (!string.IsNullOrEmpty(plotLine))
            {
                if (text.Length > 0) text.Append('\n');
                text.Append(plotLine);
            }
            return text.ToString();
        }

        /// <summary>Живое состояние участка станка: арендатор и его сбор либо «свободен».</summary>
        private static string PlotLine(string station)
        {
            if (string.IsNullOrEmpty(station)) return string.Empty;
            JObject plot = RoaCraftingPlots.ForStation(station);
            if (plot == null) return string.Empty;
            bool leased = plot["leased"]?.Type == JTokenType.Boolean && plot["leased"].Value<bool>();
            if (!leased) return "· Участок свободен: сбор поселения";
            string holder = plot["lesseeName"]?.ToString();
            if (string.IsNullOrEmpty(holder)) holder = plot["lessee"]?.ToString();
            int fee = plot["feePct"]?.Type == JTokenType.Integer ? plot["feePct"].Value<int>() : 0;
            string tail = fee > 0 ? ", сбор " + fee + "%" : string.Empty;
            return "· Арендатор: " + (string.IsNullOrEmpty(holder) ? "есть" : holder) + tail;
        }

        private void Hide()
        {
            _shownId = string.Empty;
            if (_panel != null) _panel.gameObject.SetActive(false);
        }

        private void Build()
        {
            var root = new GameObject("WorldTooltipCanvas", typeof(RectTransform));
            root.transform.SetParent(transform, false);
            _canvas = root.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 60; // поверх HUD, но под системными окнами
            root.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;

            var panel = new GameObject("Panel", typeof(RectTransform));
            _panel = (RectTransform)panel.transform;
            _panel.SetParent(root.transform, false);
            _panel.pivot = new Vector2(0f, 1f);
            _panel.anchorMin = _panel.anchorMax = Vector2.zero;
            var back = panel.AddComponent<Image>();
            back.color = new Color(0.07f, 0.07f, 0.06f, 0.94f);
            back.raycastTarget = false;
            var outline = panel.AddComponent<Outline>();
            outline.effectColor = new Color(0.55f, 0.45f, 0.22f, 0.9f);
            outline.effectDistance = new Vector2(1.2f, -1.2f);

            _title = Label("Title", _panel, 13, FontStyle.Bold, new Color(0.94f, 0.88f, 0.62f),
                           new Vector2(10f, -8f), new Vector2(220f, 18f));
            _subtitle = Label("Subtitle", _panel, 11, FontStyle.Normal, new Color(0.78f, 0.72f, 0.52f, 0.9f),
                              new Vector2(10f, -25f), new Vector2(220f, 14f));
            _body = Label("Body", _panel, 11, FontStyle.Normal, new Color(0.86f, 0.84f, 0.78f),
                          new Vector2(10f, -41f), new Vector2(220f, 40f));
            _body.verticalOverflow = VerticalWrapMode.Overflow;
        }

        private static Text Label(string name, RectTransform parent, int size, FontStyle style, Color color,
                                  Vector2 position, Vector2 box)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = position;
            rect.sizeDelta = box;
            var text = go.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.fontStyle = style;
            text.color = color;
            text.alignment = TextAnchor.UpperLeft;
            text.raycastTarget = false;
            return text;
        }
    }
}
