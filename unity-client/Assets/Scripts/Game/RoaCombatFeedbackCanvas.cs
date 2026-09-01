using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Pooled, input-transparent combat feedback for the primary Unity HUD.
    /// Damage and hit decisions stay server-authoritative; this component only
    /// projects already accepted results into the scaled overlay Canvas.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaCombatFeedbackCanvas : MonoBehaviour
    {
        public struct FloatingFrame
        {
            public bool Visible;
            public float Alpha;
            public float Rise;
            public float Scale;
        }

        public readonly struct FloatingStyle
        {
            public readonly string Text;
            public readonly int FontSize;
            public readonly FontStyle FontStyle;
            public readonly Vector2 Size;

            public FloatingStyle(string text, int fontSize, FontStyle fontStyle, Vector2 size)
            {
                Text = text;
                FontSize = fontSize;
                FontStyle = fontStyle;
                Size = size;
            }
        }

        private sealed class FloatingView
        {
            public GameObject Root;
            public RectTransform Rect;
            public CanvasGroup Group;
            public Text Label;
            public Vector3 World;
            public float Started;
            public Vector2 Offset;
            public bool Active;
        }

        private sealed class MarkerView
        {
            public GameObject Root;
            public RectTransform Rect;
            public CanvasGroup Group;
            public RawImage[] Segments;
            public Vector3 World;
            public float Started;
            public bool Critical;
            public bool Killed;
            public bool Active;
        }

        private const int InitialFloatingPool = 16;
        private const int InitialMarkerPool = 12;
        private const float FloatingLifetime = 0.92f;
        private const float FloatingStackWindow = 0.22f;
        private const float FloatingStackWorldRadius = 1.2f;

        public Camera WorldCamera;

        private Canvas _canvas;
        private RectTransform _layer;
        private readonly List<FloatingView> _floating = new List<FloatingView>();
        private readonly List<MarkerView> _markers = new List<MarkerView>();

        public bool CanvasReady { get { return _canvas != null && _layer != null; } }
        public int ActiveFloatingCount { get { return CountFloating(); } }
        public int ActiveMarkerCount { get { return CountMarkers(); } }
        public int FloatingPoolSize { get { return _floating.Count; } }
        public int MarkerPoolSize { get { return _markers.Count; } }

        public bool InputTransparent
        {
            get
            {
                for (int i = 0; i < _floating.Count; i++)
                    if (_floating[i].Label.raycastTarget) return false;
                for (int i = 0; i < _markers.Count; i++)
                    for (int j = 0; j < _markers[i].Segments.Length; j++)
                        if (_markers[i].Segments[j].raycastTarget) return false;
                return _canvas == null || _canvas.GetComponent<GraphicRaycaster>() == null;
            }
        }

        private void Awake()
        {
            EnsureCanvas();
        }

        private void OnDisable()
        {
            Clear();
        }

        private void LateUpdate()
        {
            Refresh(Time.unscaledTime);
        }

        public void Configure(Camera worldCamera)
        {
            WorldCamera = worldCamera;
            EnsureCanvas();
        }

        public void ShowFloating(string text, Vector3 world, Color color)
        {
            EnsureCanvas();
            FloatingView view = AcquireFloating();
            view.Offset = FloatingStackOffset(NearbyFloatingCount(world, view));
            view.World = world;
            view.Started = Time.unscaledTime;
            view.Active = true;
            bool mobile = RoaGameBootstrap.Active?.MobileControls?.ControlsEnabled == true;
            FloatingStyle style = ResolveFloatingStyle(text, mobile);
            view.Label.text = style.Text;
            view.Label.color = color;
            view.Label.fontSize = style.FontSize;
            view.Label.fontStyle = style.FontStyle;
            view.Rect.sizeDelta = style.Size;
            view.Group.alpha = 1f;
            view.Root.SetActive(true);
        }

        public void ShowHit(Vector3 world, bool critical, bool killed)
        {
            EnsureCanvas();
            MarkerView view = AcquireMarker();
            view.World = world;
            view.Started = Time.unscaledTime;
            view.Critical = critical;
            view.Killed = killed;
            view.Active = true;
            view.Group.alpha = 1f;
            view.Root.SetActive(true);
        }

        public void RefreshNow()
        {
            Refresh(Time.unscaledTime);
        }

        public void Clear()
        {
            for (int i = 0; i < _floating.Count; i++)
            {
                _floating[i].Active = false;
                _floating[i].Root.SetActive(false);
            }
            for (int i = 0; i < _markers.Count; i++)
            {
                _markers[i].Active = false;
                _markers[i].Root.SetActive(false);
            }
        }

        public static FloatingFrame EvaluateFloating(float elapsed)
        {
            if (elapsed < 0f || elapsed >= FloatingLifetime) return default;
            float t = Mathf.Clamp01(elapsed / FloatingLifetime);
            float enter = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t / 0.12f));
            float settle = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.12f, 0.34f, t));
            float scale = Mathf.Lerp(0.82f, 1.06f, enter);
            if (t > 0.12f) scale = Mathf.Lerp(1.06f, 1f, settle);
            return new FloatingFrame
            {
                Visible = true,
                Alpha = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.44f, 1f, t)),
                Rise = Mathf.Lerp(0f, 42f, 1f - (1f - t) * (1f - t)),
                Scale = scale
            };
        }

        public static FloatingStyle ResolveFloatingStyle(string text, bool mobile)
        {
            string source = (text ?? string.Empty).Trim();
            bool critical = source.IndexOf("КРИТ", System.StringComparison.OrdinalIgnoreCase) >= 0;
            bool miss = string.Equals(source, "мимо", System.StringComparison.OrdinalIgnoreCase)
                || string.Equals(source, "промах", System.StringComparison.OrdinalIgnoreCase);
            bool auxiliary = source.EndsWith(" XP", System.StringComparison.OrdinalIgnoreCase);
            if (critical)
            {
                string value = source.Replace("КРИТ", string.Empty).Trim();
                int tagSize = mobile ? 10 : 11;
                source = string.IsNullOrEmpty(value)
                    ? "КРИТ"
                    : value + "  <size=" + tagSize + ">КРИТ</size>";
                return new FloatingStyle(source, mobile ? 17 : 18, FontStyle.Bold,
                    new Vector2(170f, 32f));
            }
            if (miss || auxiliary)
                return new FloatingStyle(source, mobile ? 13 : 14, FontStyle.Normal,
                    new Vector2(120f, 26f));
            return new FloatingStyle(source, mobile ? 15 : 16, FontStyle.Bold,
                new Vector2(132f, 28f));
        }

        public static Vector2 FloatingStackOffset(int nearbyIndex)
        {
            int index = Mathf.Max(0, nearbyIndex);
            if (index == 0) return new Vector2(0f, 14f);
            int ring = Mathf.Min(3, (index + 1) / 2);
            float direction = index % 2 == 1 ? -1f : 1f;
            return new Vector2(direction * (18f + ring * 8f), 14f + ring * 8f);
        }

        private void EnsureCanvas()
        {
            if (_canvas != null) return;
            var root = new GameObject("CombatFeedbackCanvas", typeof(RectTransform),
                typeof(Canvas), typeof(CanvasScaler));
            root.transform.SetParent(transform, false);
            _canvas = root.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 34;
            RoaUiScale.Apply(root.GetComponent<CanvasScaler>());

            var layer = new GameObject("FeedbackLayer", typeof(RectTransform));
            layer.transform.SetParent(root.transform, false);
            _layer = (RectTransform)layer.transform;
            _layer.anchorMin = Vector2.zero;
            _layer.anchorMax = Vector2.one;
            _layer.offsetMin = Vector2.zero;
            _layer.offsetMax = Vector2.zero;

            while (_floating.Count < InitialFloatingPool) _floating.Add(CreateFloating());
            while (_markers.Count < InitialMarkerPool) _markers.Add(CreateMarker());
        }

        private FloatingView CreateFloating()
        {
            var root = new GameObject("FloatingCombatText", typeof(RectTransform), typeof(CanvasGroup));
            root.transform.SetParent(_layer, false);
            RectTransform rect = (RectTransform)root.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.sizeDelta = new Vector2(240f, 38f);
            CanvasGroup group = root.GetComponent<CanvasGroup>();
            group.blocksRaycasts = false;
            group.interactable = false;

            var labelRoot = new GameObject("Label", typeof(RectTransform));
            labelRoot.transform.SetParent(root.transform, false);
            RectTransform labelRect = (RectTransform)labelRoot.transform;
            labelRect.anchorMin = Vector2.zero;
            labelRect.anchorMax = Vector2.one;
            labelRect.offsetMin = Vector2.zero;
            labelRect.offsetMax = Vector2.zero;
            Text label = labelRoot.AddComponent<Text>();
            label.font = RoaUiFont.Default;
            label.fontSize = 19;
            label.fontStyle = FontStyle.Bold;
            label.alignment = TextAnchor.MiddleCenter;
            label.horizontalOverflow = HorizontalWrapMode.Overflow;
            label.verticalOverflow = VerticalWrapMode.Overflow;
            label.supportRichText = true;
            label.raycastTarget = false;
            var outline = labelRoot.AddComponent<Outline>();
            outline.effectColor = new Color(0f, 0f, 0f, 0.88f);
            outline.effectDistance = new Vector2(1.2f, -1.2f);
            root.SetActive(false);
            return new FloatingView { Root = root, Rect = rect, Group = group, Label = label };
        }

        private MarkerView CreateMarker()
        {
            var root = new GameObject("AuthoritativeHitMarker", typeof(RectTransform), typeof(CanvasGroup));
            root.transform.SetParent(_layer, false);
            RectTransform rect = (RectTransform)root.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.sizeDelta = new Vector2(96f, 96f);
            CanvasGroup group = root.GetComponent<CanvasGroup>();
            group.blocksRaycasts = false;
            group.interactable = false;
            var segments = new RawImage[8];
            for (int i = 0; i < segments.Length; i++)
            {
                var segment = new GameObject("Segment" + i, typeof(RectTransform));
                segment.transform.SetParent(root.transform, false);
                RawImage image = segment.AddComponent<RawImage>();
                image.texture = Texture2D.whiteTexture;
                image.raycastTarget = false;
                segments[i] = image;
            }
            root.SetActive(false);
            return new MarkerView
            {
                Root = root,
                Rect = rect,
                Group = group,
                Segments = segments
            };
        }

        private FloatingView AcquireFloating()
        {
            FloatingView oldest = _floating[0];
            for (int i = 0; i < _floating.Count; i++)
            {
                FloatingView candidate = _floating[i];
                if (!candidate.Active) return candidate;
                if (candidate.Started < oldest.Started) oldest = candidate;
            }
            return oldest;
        }

        private int NearbyFloatingCount(Vector3 world, FloatingView reused)
        {
            int count = 0;
            float now = Time.unscaledTime;
            float radiusSq = FloatingStackWorldRadius * FloatingStackWorldRadius;
            for (int i = 0; i < _floating.Count; i++)
            {
                FloatingView candidate = _floating[i];
                if (candidate == reused || !candidate.Active
                    || now - candidate.Started > FloatingStackWindow) continue;
                Vector3 delta = candidate.World - world;
                delta.y = 0f;
                if (delta.sqrMagnitude <= radiusSq) count++;
            }
            return count;
        }

        private MarkerView AcquireMarker()
        {
            MarkerView oldest = _markers[0];
            for (int i = 0; i < _markers.Count; i++)
            {
                MarkerView candidate = _markers[i];
                if (!candidate.Active) return candidate;
                if (candidate.Started < oldest.Started) oldest = candidate;
            }
            return oldest;
        }

        private void Refresh(float now)
        {
            EnsureCanvas();
            bool show = !RoaGameBootstrap.BlocksWorldHud;
            _canvas.enabled = show;
            Camera camera = WorldCamera != null ? WorldCamera : Camera.main;

            for (int i = 0; i < _floating.Count; i++)
            {
                FloatingView view = _floating[i];
                if (!view.Active) continue;
                FloatingFrame frame = EvaluateFloating(now - view.Started);
                if (!frame.Visible)
                {
                    view.Active = false;
                    view.Root.SetActive(false);
                    continue;
                }
                if (!show || !Project(camera, view.World, out Vector2 point))
                {
                    view.Group.alpha = 0f;
                    continue;
                }
                view.Rect.anchoredPosition = point + view.Offset + Vector2.up * frame.Rise;
                view.Rect.localScale = Vector3.one * frame.Scale;
                view.Group.alpha = frame.Alpha;
            }

            for (int i = 0; i < _markers.Count; i++)
            {
                MarkerView view = _markers[i];
                if (!view.Active) continue;
                float elapsed = now - view.Started;
                RoaCombatConfirmation.Frame frame = RoaCombatConfirmation.Evaluate(
                    elapsed, view.Critical, view.Killed);
                if (!frame.Visible)
                {
                    view.Active = false;
                    view.Root.SetActive(false);
                    continue;
                }
                if (!show || !Project(camera, view.World, out Vector2 point))
                {
                    view.Group.alpha = 0f;
                    continue;
                }
                view.Rect.anchoredPosition = point;
                view.Group.alpha = frame.Alpha;
                LayoutMarker(view, frame);
            }
        }

        private bool Project(Camera camera, Vector3 world, out Vector2 localPoint)
        {
            localPoint = Vector2.zero;
            if (camera == null) return false;
            Vector3 screen = camera.WorldToScreenPoint(world);
            if (screen.z <= 0f || screen.x < 0f || screen.x > Screen.width
                || screen.y < 0f || screen.y > Screen.height) return false;
            return RectTransformUtility.ScreenPointToLocalPointInRectangle(
                _layer, new Vector2(screen.x, screen.y), null, out localPoint);
        }

        private static void LayoutMarker(MarkerView view, RoaCombatConfirmation.Frame frame)
        {
            float r = frame.Radius;
            float length = frame.Length;
            float thickness = frame.Thickness;
            SetSegment(view.Segments[0], new Vector2(-r + length * 0.5f, r),
                new Vector2(length, thickness), frame.Color);
            SetSegment(view.Segments[1], new Vector2(-r, r - length * 0.5f),
                new Vector2(thickness, length), frame.Color);
            SetSegment(view.Segments[2], new Vector2(r - length * 0.5f, r),
                new Vector2(length, thickness), frame.Color);
            SetSegment(view.Segments[3], new Vector2(r, r - length * 0.5f),
                new Vector2(thickness, length), frame.Color);
            SetSegment(view.Segments[4], new Vector2(-r + length * 0.5f, -r),
                new Vector2(length, thickness), frame.Color);
            SetSegment(view.Segments[5], new Vector2(-r, -r + length * 0.5f),
                new Vector2(thickness, length), frame.Color);
            SetSegment(view.Segments[6], new Vector2(r - length * 0.5f, -r),
                new Vector2(length, thickness), frame.Color);
            SetSegment(view.Segments[7], new Vector2(r, -r + length * 0.5f),
                new Vector2(thickness, length), frame.Color);
        }

        private static void SetSegment(RawImage image, Vector2 position, Vector2 size, Color color)
        {
            RectTransform rect = image.rectTransform;
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            image.color = color;
        }

        private int CountFloating()
        {
            int count = 0;
            for (int i = 0; i < _floating.Count; i++) if (_floating[i].Active) count++;
            return count;
        }

        private int CountMarkers()
        {
            int count = 0;
            for (int i = 0; i < _markers.Count; i++) if (_markers[i].Active) count++;
            return count;
        }
    }
}
