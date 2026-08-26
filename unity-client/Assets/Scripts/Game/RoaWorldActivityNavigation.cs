using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaWorldActivityCanvas
    {
        public readonly struct WorldLabelFrame
        {
            public readonly string Id;
            public readonly string Label;
            public readonly Vector3 World;
            public readonly Color Color;
            public readonly float Distance;
            public readonly int Priority;
            public readonly bool Completed;

            public WorldLabelFrame(string id, string label, Vector3 world, Color color,
                                   float distance, int priority, bool completed)
            {
                Id = id ?? string.Empty;
                Label = label ?? string.Empty;
                World = world;
                Color = color;
                Distance = Mathf.Max(0f, distance);
                Priority = priority;
                Completed = completed;
            }
        }

        private sealed class WorldLabelSlot
        {
            public GameObject Root;
            public RectTransform Rect;
            public Image Background;
            public Image Stripe;
            public Outline Outline;
            public Text Text;
        }

        private const int MaxWorldLabels = 4;
        private Canvas _activityCanvas;
        private RectTransform _worldLabelLayer;
        private readonly List<WorldLabelSlot> _worldLabelPool = new List<WorldLabelSlot>(MaxWorldLabels);
        private readonly List<WorldLabelFrame> _worldLabelFrames = new List<WorldLabelFrame>(8);
        private readonly List<Rect> _occupiedWorldLabels = new List<Rect>(16);
        private GameObject _navigationRoot;
        private RectTransform _navigationArrow;
        private Text _navigationLabel;
        private Image _navigationStripe;
        private string _navigationText = string.Empty;

        public int ActiveObjectiveMarkerCount
        {
            get { return _markerRoot != null ? _markerRoot.transform.childCount : 0; }
        }

        public string NavigationText { get { return _navigationText; } }
        public int ActiveWorldLabelCount { get; private set; }
        public int WorldLabelPoolSize { get { return _worldLabelPool.Count; } }

        public static float CalculateNavigationArrowAngle(Vector3 direction, Vector3 cameraRight, Vector3 cameraScreenUp)
        {
            direction.y = 0f;
            cameraRight.y = 0f;
            cameraScreenUp.y = 0f;
            if (direction.sqrMagnitude < 0.0001f) return 0f;
            if (cameraRight.sqrMagnitude < 0.0001f) cameraRight = Vector3.right;
            if (cameraScreenUp.sqrMagnitude < 0.0001f) cameraScreenUp = Vector3.forward;
            direction.Normalize();
            cameraRight.Normalize();
            cameraScreenUp.Normalize();
            float horizontal = Vector3.Dot(direction, cameraRight);
            float vertical = Vector3.Dot(direction, cameraScreenUp);
            return -Mathf.Atan2(horizontal, vertical) * Mathf.Rad2Deg;
        }

        public static string NavigationDistanceLabel(string label, float distance, bool inReach)
        {
            string prefix = string.IsNullOrEmpty(label) ? "ЦЕЛЬ" : label.ToUpperInvariant();
            return inReach ? prefix + " · ДОСТУПНО" : prefix + " · " + Mathf.CeilToInt(Mathf.Max(0f, distance)) + " М";
        }

        private void BuildObjectiveWorldLabelLayer(RectTransform canvasRoot)
        {
            if (_worldLabelLayer != null || canvasRoot == null) return;
            _worldLabelLayer = Child("WorldObjectiveLabels", canvasRoot);
            Stretch(_worldLabelLayer, 0f);
            _worldLabelLayer.SetAsFirstSibling();
            EnsureWorldLabelPool();
        }

        private void EnsureWorldLabelPool()
        {
            if (_worldLabelLayer == null) return;
            while (_worldLabelPool.Count < MaxWorldLabels)
            {
                var root = new GameObject("WorldObjectiveLabel", typeof(RectTransform),
                    typeof(Image), typeof(Outline));
                RectTransform rect = (RectTransform)root.transform;
                rect.SetParent(_worldLabelLayer, false);
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                Image background = root.GetComponent<Image>();
                background.color = PanelBg;
                background.raycastTarget = false;
                Outline outline = root.GetComponent<Outline>();
                outline.useGraphicAlpha = true;
                outline.effectDistance = new Vector2(1f, -1f);

                RectTransform stripeRect = Child("State", rect);
                stripeRect.anchorMin = new Vector2(0f, 0f);
                stripeRect.anchorMax = new Vector2(0f, 1f);
                stripeRect.pivot = new Vector2(0f, 0.5f);
                stripeRect.offsetMin = Vector2.zero;
                stripeRect.offsetMax = new Vector2(3f, 0f);
                Image stripe = stripeRect.gameObject.AddComponent<Image>();
                stripe.raycastTarget = false;

                Text text = Label("Text", rect, 10, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.verticalOverflow = VerticalWrapMode.Truncate;
                Place(text.rectTransform, 10f, -35f, -7f, -3f);
                root.SetActive(false);
                _worldLabelPool.Add(new WorldLabelSlot
                {
                    Root = root,
                    Rect = rect,
                    Background = background,
                    Stripe = stripe,
                    Outline = outline,
                    Text = text
                });
            }
        }

        private void LateUpdate()
        {
            RefreshObjectiveWorldLabels();
        }

        private void RefreshObjectiveWorldLabels()
        {
            if (_worldLabelLayer == null || _activityCanvas == null || _root == null
                || !_root.activeInHierarchy || Bootstrap?.PlayerView == null)
            {
                HideObjectiveWorldLabels();
                return;
            }

            Camera camera = Camera.main;
            if (camera == null || CollectWorldLabelFrames(_worldLabelFrames) == 0)
            {
                HideObjectiveWorldLabels();
                return;
            }

            float scale = Mathf.Max(0.01f, _activityCanvas.scaleFactor);
            Rect safe = TopLeftSafeScreenRect(Screen.safeArea, Screen.height);
            _occupiedWorldLabels.Clear();
            _occupiedWorldLabels.Add(ActivityHudScreenRect(Screen.width, scale));
            _occupiedWorldLabels.Add(ActivityNavigationScreenRect(Screen.width, scale));
            Bootstrap.HudCanvas?.CollectOccupiedScreenRects(_occupiedWorldLabels);

            int visible = 0;
            for (int index = 0; index < _worldLabelFrames.Count && visible < MaxWorldLabels; index += 1)
            {
                WorldLabelFrame frame = _worldLabelFrames[index];
                Vector3 projected = camera.WorldToScreenPoint(frame.World + Vector3.up * 1.85f);
                if (projected.z <= 0f) continue;
                Vector2 anchor = new Vector2(projected.x, Screen.height - projected.y);
                float width = frame.Id == "extraction" ? 210f : 190f;
                float height = 38f;
                if (!TryResolveWorldLabelRect(anchor, safe, _occupiedWorldLabels,
                    width, height, out Rect resolved)) continue;

                WorldLabelSlot slot = _worldLabelPool[visible++];
                slot.Root.SetActive(true);
                slot.Root.name = "WorldObjectiveLabel:" + frame.Id;
                slot.Rect.anchoredPosition = RoaGlobalMapCanvas.CanvasPositionForScreenRect(
                    resolved, Screen.width, Screen.height, scale);
                slot.Rect.sizeDelta = RoaGlobalMapCanvas.CanvasSizeForScreenRect(resolved, scale);
                slot.Text.text = WorldLabelText(frame.Label, frame.Distance, frame.Completed);
                slot.Text.color = frame.Completed ? Safe : frame.Color;
                float alpha = frame.Completed ? 0.72f : 0.93f;
                slot.Background.color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, alpha);
                slot.Stripe.color = frame.Completed ? Safe : frame.Color;
                slot.Outline.effectColor = new Color(frame.Color.r, frame.Color.g, frame.Color.b,
                    frame.Completed ? 0.46f : 0.82f);
                _occupiedWorldLabels.Add(resolved);
            }

            for (int index = visible; index < _worldLabelPool.Count; index += 1)
                if (_worldLabelPool[index].Root.activeSelf) _worldLabelPool[index].Root.SetActive(false);
            ActiveWorldLabelCount = visible;
        }

        public int CollectWorldLabelFrames(List<WorldLabelFrame> output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            output.Clear();
            if (_activity == null || Bootstrap?.PlayerView == null) return 0;
            Vector3 player = Bootstrap.PlayerView.transform.position;
            string kind = _activity["kind"]?.ToString() ?? string.Empty;
            bool extractionOpen = _activity["extractionOpen"]?.ToObject<bool>() == true;

            if (extractionOpen && kind != "outpost_defense" && kind != "distress_signal"
                && TryActivityExtractionTarget(out Vector3 extraction, out _))
            {
                output.Add(new WorldLabelFrame("extraction", "Эвакуация", extraction, Safe,
                    FlatDistance(player, extraction), 4, false));
            }

            if (_activity["interactionPoints"] is JArray points)
            {
                foreach (JToken token in points)
                {
                    JObject point = token as JObject;
                    string status = point?["status"]?.ToString() ?? string.Empty;
                    if (point == null || status == "disabled" || status == "locked") continue;
                    bool completed = status == "completed";
                    float x = point["x"]?.ToObject<float>() ?? 0f;
                    float z = point["z"]?.ToObject<float>() ?? 0f;
                    Vector3 world = RoaCoords.ToUnity(x, 0.08f, z);
                    float distance = FlatDistance(player, world);
                    if (completed && distance > 20f) continue;
                    string id = point["id"]?.ToString() ?? "point";
                    string label = point["label"]?.ToString() ?? "Цель активности";
                    int priority = completed ? 0 : id.StartsWith("approach_", StringComparison.Ordinal) ? 3 : 2;
                    output.Add(new WorldLabelFrame(id, label, world,
                        completed ? Safe : Accent, distance, priority, completed));
                }
            }

            if (kind == "resource_expedition" && Bootstrap.Interaction != null
                && Bootstrap.Interaction.TryNearestActivityResource(player, out Vector3 resource, out float resourceDistance))
            {
                output.Add(new WorldLabelFrame("resource", "Ресурс активности", resource,
                    Accent, resourceDistance, 2, false));
            }

            output.Sort((left, right) =>
            {
                int byPriority = right.Priority.CompareTo(left.Priority);
                if (byPriority != 0) return byPriority;
                int byDistance = left.Distance.CompareTo(right.Distance);
                return byDistance != 0 ? byDistance : string.CompareOrdinal(left.Id, right.Id);
            });
            return output.Count;
        }

        private void HideObjectiveWorldLabels()
        {
            for (int index = 0; index < _worldLabelPool.Count; index += 1)
                if (_worldLabelPool[index].Root.activeSelf) _worldLabelPool[index].Root.SetActive(false);
            ActiveWorldLabelCount = 0;
        }

        private static float FlatDistance(Vector3 left, Vector3 right)
        {
            Vector3 delta = right - left;
            delta.y = 0f;
            return delta.magnitude;
        }

        public static string WorldLabelText(string label, float distance, bool completed)
        {
            string title = string.IsNullOrWhiteSpace(label) ? "ЦЕЛЬ" : label.Trim().ToUpperInvariant();
            string state = completed ? "ГОТОВО"
                : distance <= 3.05f ? "ДОСТУПНО"
                : Mathf.CeilToInt(Mathf.Max(0f, distance)) + " М";
            return title + "\n" + state;
        }

        public static Rect TopLeftSafeScreenRect(Rect unitySafeArea, int screenHeight)
        {
            return new Rect(unitySafeArea.xMin, screenHeight - unitySafeArea.yMax,
                unitySafeArea.width, unitySafeArea.height);
        }

        public static Rect ActivityHudScreenRect(int screenWidth, float canvasScale)
        {
            float scale = Mathf.Max(0.01f, canvasScale);
            return new Rect(screenWidth * 0.5f - 205f * scale, 18f * scale,
                410f * scale, 260f * scale);
        }

        public static Rect ActivityNavigationScreenRect(int screenWidth, float canvasScale)
        {
            float scale = Mathf.Max(0.01f, canvasScale);
            return new Rect(screenWidth * 0.5f - 170f * scale, 282f * scale,
                340f * scale, 36f * scale);
        }

        public static bool TryResolveWorldLabelRect(Vector2 anchor, Rect safeArea,
                                                    IList<Rect> reserved, float width,
                                                    float height, out Rect resolved)
        {
            resolved = default;
            width = Mathf.Max(80f, width);
            height = Mathf.Max(24f, height);
            for (int ring = 0; ring < 6; ring += 1)
            {
                float gap = 12f + ring * (height + 6f);
                for (int direction = 0; direction < 4; direction += 1)
                {
                    float x = anchor.x - width * 0.5f;
                    float y = anchor.y - height - gap;
                    if (direction == 1) y = anchor.y + gap;
                    else if (direction == 2)
                    {
                        x = anchor.x + gap;
                        y = anchor.y - height * 0.5f;
                    }
                    else if (direction == 3)
                    {
                        x = anchor.x - gap - width;
                        y = anchor.y - height * 0.5f;
                    }

                    Rect candidate = new Rect(x, y, width, height);
                    if (candidate.xMin < safeArea.xMin + 8f || candidate.xMax > safeArea.xMax - 8f
                        || candidate.yMin < safeArea.yMin + 8f || candidate.yMax > safeArea.yMax - 8f)
                        continue;
                    bool overlaps = false;
                    if (reserved != null)
                    {
                        for (int index = 0; index < reserved.Count; index += 1)
                        {
                            if (!candidate.Overlaps(reserved[index])) continue;
                            overlaps = true;
                            break;
                        }
                    }
                    if (overlaps) continue;
                    resolved = candidate;
                    return true;
                }
            }
            return false;
        }

        private void BuildActivityNavigation(Transform canvasRoot)
        {
            if (_navigationRoot != null || canvasRoot == null) return;
            _navigationRoot = new GameObject("WorldActivityNavigation", typeof(RectTransform), typeof(Image), typeof(Outline));
            RectTransform rect = (RectTransform)_navigationRoot.transform;
            rect.SetParent(canvasRoot, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 1f);
            rect.pivot = new Vector2(0.5f, 1f);
            rect.anchoredPosition = new Vector2(0f, -282f);
            rect.sizeDelta = new Vector2(340f, 36f);
            Image navigationBackground = _navigationRoot.GetComponent<Image>();
            navigationBackground.color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, 0.93f);
            navigationBackground.raycastTarget = false;
            Outline outline = _navigationRoot.GetComponent<Outline>();
            outline.effectColor = Border;
            outline.effectDistance = new Vector2(1f, -1f);

            RectTransform stripe = Child("NavigationStripe", rect);
            stripe.anchorMin = new Vector2(0f, 0f);
            stripe.anchorMax = new Vector2(0f, 1f);
            stripe.pivot = new Vector2(0f, 0.5f);
            stripe.offsetMin = Vector2.zero;
            stripe.offsetMax = new Vector2(4f, 0f);
            _navigationStripe = stripe.gameObject.AddComponent<Image>();
            _navigationStripe.color = Accent;
            _navigationStripe.raycastTarget = false;

            Text arrow = Label("NavigationArrow", rect, 18, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            _navigationArrow = arrow.rectTransform;
            _navigationArrow.anchorMin = _navigationArrow.anchorMax = new Vector2(0f, 0.5f);
            _navigationArrow.pivot = new Vector2(0.5f, 0.5f);
            _navigationArrow.anchoredPosition = new Vector2(23f, 0f);
            _navigationArrow.sizeDelta = new Vector2(30f, 30f);
            arrow.text = "▲";

            _navigationLabel = Label("NavigationLabel", rect, 11, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(_navigationLabel.rectTransform, 45f, -31f, -10f, -5f);
            _navigationRoot.SetActive(false);
        }

        private void HideActivityNavigation()
        {
            _navigationText = string.Empty;
            if (_navigationRoot != null) _navigationRoot.SetActive(false);
        }

        private void RefreshActivityNavigation()
        {
            if (_navigationRoot == null || _root == null || !_root.activeSelf || Bootstrap?.PlayerView == null)
            {
                HideActivityNavigation();
                return;
            }

            if (!TryActivityNavigationTarget(out Vector3 target, out float reach, out string label, out Color color))
            {
                HideActivityNavigation();
                return;
            }

            Vector3 player = Bootstrap.PlayerView.transform.position;
            Vector3 delta = target - player;
            delta.y = 0f;
            float distance = delta.magnitude;
            bool inReach = distance <= Mathf.Max(0.5f, reach);
            _navigationText = NavigationDistanceLabel(label, distance, inReach);
            _navigationLabel.text = _navigationText;
            _navigationLabel.color = inReach ? Safe : Ink;
            _navigationStripe.color = color;
            Text arrowText = _navigationArrow != null ? _navigationArrow.GetComponent<Text>() : null;
            if (arrowText != null) arrowText.color = color;

            Camera camera = Camera.main;
            Vector3 right = camera != null ? Vector3.ProjectOnPlane(camera.transform.right, Vector3.up) : Vector3.right;
            Vector3 screenUp = camera != null ? Vector3.ProjectOnPlane(camera.transform.up, Vector3.up) : Vector3.forward;
            _navigationArrow.localEulerAngles = new Vector3(0f, 0f, CalculateNavigationArrowAngle(delta, right, screenUp));
            _navigationRoot.SetActive(true);
        }

        private bool TryActivityNavigationTarget(out Vector3 target, out float reach, out string label, out Color color)
        {
            target = Vector3.zero;
            reach = 2.8f;
            label = "ЦЕЛЬ";
            color = Accent;
            if (_activity == null || Bootstrap?.PlayerView == null) return false;

            string activityStatus = _activity["status"]?.ToString() ?? string.Empty;
            if (activityStatus != "active" && activityStatus != "extracting") return false;
            string kind = _activity["kind"]?.ToString() ?? string.Empty;
            bool extractionOpen = _activity["extractionOpen"]?.ToObject<bool>() == true;
            if (extractionOpen && kind != "outpost_defense" && kind != "distress_signal"
                && TryActivityExtractionTarget(out target, out reach))
            {
                label = "ЭВАКУАЦИЯ";
                color = Safe;
                return true;
            }

            JObject point = NearestPendingPoint(out _);
            if (point != null)
            {
                float x = point["x"]?.ToObject<float>() ?? 0f;
                float z = point["z"]?.ToObject<float>() ?? 0f;
                target = RoaCoords.ToUnity(x, 0.08f, z);
                reach = 3f;
                label = kind == "distress_signal" ? "МАЯК"
                    : kind == "assault_diversion" ? "ОПЕРАЦИЯ" : "НАБЛЮДЕНИЕ";
                return true;
            }

            if (kind == "resource_expedition" && Bootstrap.Interaction != null
                && Bootstrap.Interaction.TryNearestActivityResource(Bootstrap.PlayerView.transform.position, out target, out _))
            {
                reach = 2.8f;
                label = "РЕСУРС";
                return true;
            }

            return false;
        }

        private bool TryActivityExtractionTarget(out Vector3 target, out float reach)
        {
            target = Vector3.zero;
            reach = 4f;
            LocationDefinition location = Bootstrap?.Loader?.Current;
            if (location == null) return false;

            WorldZone zone = null;
            if (location.WorldZones != null)
            {
                foreach (WorldZone candidate in location.WorldZones)
                {
                    if (candidate == null) continue;
                    if ((candidate.Id ?? string.Empty).IndexOf("world_exit", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        zone = candidate;
                        break;
                    }
                    if (zone == null) zone = candidate;
                }
            }
            if (zone != null)
            {
                target = RoaCoords.TileToWorld(zone.Tx, zone.Tz, location.TileWidth, location.TileDepth);
                reach = Mathf.Max(2f, zone.Radius > 0f ? zone.Radius : 4f);
                return true;
            }

            if (location.EntryFromWorld != null)
            {
                target = RoaCoords.TileToWorld(location.EntryFromWorld.Tx, location.EntryFromWorld.Tz,
                    location.TileWidth, location.TileDepth);
                return true;
            }
            return false;
        }

        public void CollectMinimapMarkers(List<RoaMinimap.Marker> markers)
        {
            if (markers == null || _activity == null || Bootstrap?.PlayerView == null) return;
            string activityStatus = _activity["status"]?.ToString() ?? string.Empty;
            if (activityStatus != "active" && activityStatus != "extracting") return;
            string kind = _activity["kind"]?.ToString() ?? string.Empty;
            if (_activity["extractionOpen"]?.ToObject<bool>() == true && kind != "outpost_defense" && kind != "distress_signal"
                && TryActivityExtractionTarget(out Vector3 extraction, out _))
                markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.Extraction, extraction));

            if (_activity["interactionPoints"] is JArray points)
            {
                foreach (JToken token in points)
                {
                    JObject point = token as JObject;
                    string status = point?["status"]?.ToString() ?? string.Empty;
                    if (point == null || status == "completed" || status == "disabled"
                        || status == "locked") continue;
                    float x = point["x"]?.ToObject<float>() ?? 0f;
                    float z = point["z"]?.ToObject<float>() ?? 0f;
                    markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.Objective, RoaCoords.ToUnity(x, 0f, z)));
                }
            }
            if (kind == "resource_expedition") Bootstrap.Interaction?.CollectActivityResourceMarkers(markers);
        }

        private void CreateActivityWorldBeacon(string objectName, Vector3 position, Color color, bool completed)
        {
            if (_markerRoot == null) return;
            var marker = new GameObject(objectName);
            marker.transform.SetParent(_markerRoot.transform, false);
            marker.transform.position = position;
            marker.AddComponent<RoaActivityBeacon>().Configure(color, completed);
        }
    }
}
