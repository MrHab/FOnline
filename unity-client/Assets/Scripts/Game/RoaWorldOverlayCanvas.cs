using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Shared, pooled overlay for short-lived world information. It replaces
    /// the active IMGUI paths for nearby ground loot and authoritative NPC
    /// speech while remaining transparent to mouse and touch input.
    /// </summary>
    [DisallowMultipleComponent]
    // Мировые подписи проецируются в экран и должны обновляться после
    // RoaCameraRig.LateUpdate, иначе отстают от камеры на кадр и «плывут».
    [DefaultExecutionOrder(50)]
    public sealed class RoaWorldOverlayCanvas : MonoBehaviour
    {
        public struct GroundLabel
        {
            public string Id;
            public string ItemId;
            public int Quantity;
            public Vector3 World;
            public float DistanceSquared;
        }

        private sealed class GroundView
        {
            public GameObject Root;
            public RectTransform Rect;
            public CanvasGroup Group;
            public Image Back;
            public Outline Border;
            public Text Label;
        }

        private sealed class SpeechView
        {
            public GameObject Root;
            public RectTransform Rect;
            public CanvasGroup Group;
            public Image Back;
            public Outline Border;
            public RawImage Pointer;
            public Text Label;
        }

        private const int InitialGroundPool = 8;
        private const int InitialSpeechPool = 6;
        private static readonly Color GroundInk = new Color(0.86f, 0.91f, 0.78f, 1f);
        private static readonly Color GroundAction = new Color(1f, 0.84f, 0.42f, 1f);
        private static readonly Color SpeechInk = new Color(0.88f, 1f, 0.90f, 1f);

        public RoaGroundItems GroundItems;
        public RoaEnemies Enemies;
        public Camera WorldCamera;

        private Canvas _canvas;
        private RectTransform _layer;
        private RectTransform _statusRoot;
        private CanvasGroup _statusGroup;
        private Text _statusLabel;
        private readonly List<GroundView> _groundPool = new List<GroundView>();
        private readonly List<SpeechView> _speechPool = new List<SpeechView>();
        private readonly List<GroundLabel> _ground = new List<GroundLabel>();
        private readonly List<RoaCombatFx.SpeechBubble> _speech =
            new List<RoaCombatFx.SpeechBubble>();
        private readonly List<Rect> _occupied = new List<Rect>();

        public bool CanvasReady { get { return _canvas != null && _layer != null; } }
        public int GroundPoolSize { get { return _groundPool.Count; } }
        public int SpeechPoolSize { get { return _speechPool.Count; } }
        public int ActiveGroundCount { get { return CountActiveGround(); } }
        public int ActiveSpeechCount { get { return CountActiveSpeech(); } }
        public bool StatusVisible { get { return _statusRoot != null && _statusRoot.gameObject.activeSelf; } }

        public bool InputTransparent
        {
            get
            {
                if (_canvas != null && _canvas.GetComponent<GraphicRaycaster>() != null) return false;
                for (int i = 0; i < _groundPool.Count; i++)
                    if (_groundPool[i].Back.raycastTarget || _groundPool[i].Label.raycastTarget) return false;
                for (int i = 0; i < _speechPool.Count; i++)
                    if (_speechPool[i].Back.raycastTarget || _speechPool[i].Pointer.raycastTarget
                        || _speechPool[i].Label.raycastTarget) return false;
                return _statusLabel == null || !_statusLabel.raycastTarget;
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
            RefreshFromWorld();
        }

        public void Configure(RoaGroundItems groundItems, RoaEnemies enemies, Camera worldCamera)
        {
            GroundItems = groundItems;
            Enemies = enemies;
            WorldCamera = worldCamera;
            EnsureCanvas();
        }

        public void RefreshNow()
        {
            RefreshFromWorld();
        }

        public void PresentNow(IReadOnlyList<GroundLabel> ground,
                               IReadOnlyList<RoaCombatFx.SpeechBubble> speech,
                               string status, float statusAlpha)
        {
            EnsureCanvas();
            bool show = !RoaGameBootstrap.BlocksWorldHud;
            _canvas.enabled = show;
            if (!show)
            {
                HideAll();
                return;
            }

            Canvas.ForceUpdateCanvases();
            Camera camera = WorldCamera != null ? WorldCamera : Camera.main;
            Rect bounds = _layer.rect;
            if (bounds.width < 1f || bounds.height < 1f)
            {
                Vector2 reference = RoaUiScale.Reference;
                bounds = new Rect(-reference.x * 0.5f, -reference.y * 0.5f,
                                  reference.x, reference.y);
            }

            _occupied.Clear();
            int usedSpeech = PresentSpeech(speech, camera, bounds);
            int usedGround = PresentGround(ground, camera, bounds);
            for (int i = usedSpeech; i < _speechPool.Count; i++)
                if (_speechPool[i].Root.activeSelf) _speechPool[i].Root.SetActive(false);
            for (int i = usedGround; i < _groundPool.Count; i++)
                if (_groundPool[i].Root.activeSelf) _groundPool[i].Root.SetActive(false);
            PresentStatus(status, statusAlpha);
        }

        public void Clear()
        {
            HideAll();
            _ground.Clear();
            _speech.Clear();
            _occupied.Clear();
        }

        public static bool TryResolveLocalRect(Vector2 point, Vector2 size,
                                               IReadOnlyList<Rect> occupied,
                                               Rect bounds, out Rect resolved)
        {
            const float margin = 6f;
            float minX = bounds.xMin + margin;
            float maxX = Mathf.Max(minX, bounds.xMax - size.x - margin);
            float minY = bounds.yMin + margin;
            float maxY = Mathf.Max(minY, bounds.yMax - size.y - margin);
            float baseX = Mathf.Clamp(point.x - size.x * 0.5f, minX, maxX);
            float baseY = Mathf.Clamp(point.y + 8f, minY, maxY);
            for (int attempt = 0; attempt < 9; attempt++)
            {
                int step = attempt == 0 ? 0 : (attempt + 1) / 2;
                float direction = attempt == 0 ? 0f : (attempt % 2 == 1 ? 1f : -1f);
                float y = Mathf.Clamp(baseY + direction * step * (size.y + 6f), minY, maxY);
                var candidate = new Rect(baseX, y, size.x, size.y);
                bool overlaps = false;
                if (occupied != null)
                {
                    for (int i = 0; i < occupied.Count; i++)
                    {
                        if (!candidate.Overlaps(occupied[i])) continue;
                        overlaps = true;
                        break;
                    }
                }
                if (overlaps) continue;
                resolved = candidate;
                return true;
            }
            resolved = default;
            return false;
        }

        private void RefreshFromWorld()
        {
            EnsureCanvas();
            _ground.Clear();
            GroundItems?.CollectOverlayLabels(_ground);
            _ground.Sort((a, b) =>
            {
                int distance = a.DistanceSquared.CompareTo(b.DistanceSquared);
                return distance != 0 ? distance : string.CompareOrdinal(a.Id, b.Id);
            });

            _speech.Clear();
            Enemies?.CollectSpeechBubbles(_speech);
            _speech.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));

            string status = string.Empty;
            float statusAlpha = 0f;
            GroundItems?.TryGetOverlayStatus(out status, out statusAlpha);
            PresentNow(_ground, _speech, status, statusAlpha);
        }

        private int PresentSpeech(IReadOnlyList<RoaCombatFx.SpeechBubble> speech,
                                  Camera camera, Rect bounds)
        {
            int used = 0;
            if (speech == null) return used;
            for (int i = 0; i < speech.Count && used < _speechPool.Count; i++)
            {
                RoaCombatFx.SpeechBubble row = speech[i];
                if (string.IsNullOrWhiteSpace(row.Text)
                    || !Project(camera, row.World, out Vector2 point)) continue;
                int lines = Mathf.Clamp(Mathf.CeilToInt(row.Text.Length / 34f), 1, 4);
                Vector2 size = new Vector2(264f, 34f + lines * 16f);
                if (!TryResolveLocalRect(point, size, _occupied, bounds, out Rect rect)) continue;
                _occupied.Add(rect);

                SpeechView view = _speechPool[used++];
                view.Root.SetActive(true);
                view.Rect.sizeDelta = size;
                view.Rect.anchoredPosition = rect.center;
                view.Label.text = row.Text;
                float alpha = Mathf.Clamp(row.Opacity, 0.18f, 1f);
                view.Group.alpha = alpha;
                view.Back.color = new Color(0.035f, 0.075f, 0.048f, 0.94f);
                view.Border.effectColor = new Color(0.56f, 0.72f, 0.43f, 0.68f);
                view.Pointer.color = view.Back.color;
            }
            return used;
        }

        private int PresentGround(IReadOnlyList<GroundLabel> ground, Camera camera, Rect bounds)
        {
            int used = 0;
            if (ground == null) return used;
            bool mobile = RoaGameBootstrap.Active?.MobileControls?.ControlsEnabled == true;
            float range = GroundItems != null ? Mathf.Max(0.1f, GroundItems.PickupRange) : 2.2f;
            for (int i = 0; i < ground.Count && used < _groundPool.Count; i++)
            {
                GroundLabel row = ground[i];
                if (!Project(camera, row.World, out Vector2 point)) continue;
                bool nearest = i == 0;
                string name = RoaItemData.Name(row.ItemId);
                if (string.IsNullOrWhiteSpace(name)) name = "Предмет";
                string quantity = row.Quantity > 1 ? " ×" + row.Quantity : string.Empty;
                string text = nearest
                    ? (mobile ? "ПОДНЯТЬ · " : "[E] ПОДНЯТЬ · ") + name + quantity
                    : name + quantity;

                GroundView view = _groundPool[used];
                view.Label.text = text;
                view.Label.fontSize = nearest ? 13 : 11;
                view.Label.fontStyle = nearest ? FontStyle.Bold : FontStyle.Normal;
                view.Label.color = nearest ? GroundAction : GroundInk;
                Vector2 size = new Vector2(
                    Mathf.Clamp(view.Label.preferredWidth + 22f, nearest ? 150f : 100f, 286f),
                    nearest ? 30f : 24f);
                if (!TryResolveLocalRect(point, size, _occupied, bounds, out Rect rect)) continue;
                _occupied.Add(rect);

                view = _groundPool[used++];
                view.Root.SetActive(true);
                view.Rect.sizeDelta = size;
                view.Rect.anchoredPosition = rect.center;
                float distance = Mathf.Sqrt(Mathf.Max(0f, row.DistanceSquared));
                float alpha = nearest ? 1f : Mathf.Lerp(0.5f, 0.82f,
                    1f - Mathf.Clamp01(distance / range));
                view.Group.alpha = alpha;
                view.Back.color = nearest
                    ? new Color(0.09f, 0.10f, 0.075f, 0.90f)
                    : new Color(0.035f, 0.055f, 0.039f, 0.42f);
                view.Border.effectColor = nearest
                    ? new Color(0.92f, 0.72f, 0.30f, 0.78f)
                    : new Color(0.49f, 0.62f, 0.42f, 0.30f);
            }
            return used;
        }

        private void PresentStatus(string status, float alpha)
        {
            bool visible = !string.IsNullOrWhiteSpace(status) && alpha > 0f;
            _statusRoot.gameObject.SetActive(visible);
            if (!visible) return;
            _statusLabel.text = status;
            _statusGroup.alpha = Mathf.Clamp01(alpha);
            _statusRoot.sizeDelta = new Vector2(
                Mathf.Clamp(_statusLabel.preferredWidth + 34f, 180f, 460f), 34f);
        }

        private void EnsureCanvas()
        {
            if (_canvas != null) return;
            var root = new GameObject("WorldOverlayCanvas", typeof(RectTransform),
                typeof(Canvas), typeof(CanvasScaler));
            root.transform.SetParent(transform, false);
            _canvas = root.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 7;
            RoaUiScale.Apply(root.GetComponent<CanvasScaler>());

            var layer = new GameObject("WorldOverlayLayer", typeof(RectTransform));
            layer.transform.SetParent(root.transform, false);
            _layer = (RectTransform)layer.transform;
            _layer.anchorMin = Vector2.zero;
            _layer.anchorMax = Vector2.one;
            _layer.offsetMin = Vector2.zero;
            _layer.offsetMax = Vector2.zero;

            while (_groundPool.Count < InitialGroundPool) _groundPool.Add(CreateGroundView());
            while (_speechPool.Count < InitialSpeechPool) _speechPool.Add(CreateSpeechView());
            CreateStatus();
        }

        private GroundView CreateGroundView()
        {
            var root = new GameObject("GroundItemLabel", typeof(RectTransform), typeof(CanvasGroup));
            root.transform.SetParent(_layer, false);
            RectTransform rect = (RectTransform)root.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            CanvasGroup group = root.GetComponent<CanvasGroup>();
            group.blocksRaycasts = false;
            group.interactable = false;
            Image back = root.AddComponent<Image>();
            back.raycastTarget = false;
            Outline border = root.AddComponent<Outline>();
            border.effectDistance = new Vector2(1f, -1f);
            Text label = CreateText("Label", rect, 12, TextAnchor.MiddleCenter, true);
            root.SetActive(false);
            return new GroundView
            {
                Root = root, Rect = rect, Group = group, Back = back, Border = border, Label = label
            };
        }

        private SpeechView CreateSpeechView()
        {
            var root = new GameObject("WorldSpeechBubble", typeof(RectTransform), typeof(CanvasGroup));
            root.transform.SetParent(_layer, false);
            RectTransform rect = (RectTransform)root.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            CanvasGroup group = root.GetComponent<CanvasGroup>();
            group.blocksRaycasts = false;
            group.interactable = false;
            Image back = root.AddComponent<Image>();
            back.raycastTarget = false;
            Outline border = root.AddComponent<Outline>();
            border.effectDistance = new Vector2(1f, -1f);
            Text label = CreateText("Speech", rect, 12, TextAnchor.MiddleCenter, true);
            label.color = SpeechInk;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;

            var pointerRoot = new GameObject("Pointer", typeof(RectTransform));
            pointerRoot.transform.SetParent(root.transform, false);
            RectTransform pointerRect = (RectTransform)pointerRoot.transform;
            pointerRect.anchorMin = pointerRect.anchorMax = new Vector2(0.5f, 0f);
            pointerRect.pivot = new Vector2(0.5f, 0.5f);
            pointerRect.anchoredPosition = new Vector2(0f, -5f);
            pointerRect.sizeDelta = new Vector2(10f, 10f);
            pointerRect.localRotation = Quaternion.Euler(0f, 0f, 45f);
            RawImage pointer = pointerRoot.AddComponent<RawImage>();
            pointer.texture = Texture2D.whiteTexture;
            pointer.raycastTarget = false;
            root.SetActive(false);
            return new SpeechView
            {
                Root = root, Rect = rect, Group = group, Back = back,
                Border = border, Pointer = pointer, Label = label
            };
        }

        private void CreateStatus()
        {
            var root = new GameObject("WorldOverlayStatus", typeof(RectTransform),
                typeof(CanvasGroup), typeof(Image));
            root.transform.SetParent(_layer, false);
            _statusRoot = (RectTransform)root.transform;
            _statusRoot.anchorMin = _statusRoot.anchorMax = new Vector2(0.5f, 0f);
            _statusRoot.pivot = new Vector2(0.5f, 0f);
            _statusRoot.anchoredPosition = new Vector2(0f, 96f);
            _statusRoot.sizeDelta = new Vector2(260f, 34f);
            _statusGroup = root.GetComponent<CanvasGroup>();
            _statusGroup.blocksRaycasts = false;
            _statusGroup.interactable = false;
            Image back = root.GetComponent<Image>();
            back.color = new Color(0.08f, 0.055f, 0.035f, 0.94f);
            back.raycastTarget = false;
            var border = root.AddComponent<Outline>();
            border.effectColor = new Color(1f, 0.58f, 0.28f, 0.72f);
            border.effectDistance = new Vector2(1f, -1f);
            _statusLabel = CreateText("Status", _statusRoot, 13, TextAnchor.MiddleCenter, true);
            _statusLabel.color = new Color(1f, 0.78f, 0.50f, 1f);
            root.SetActive(false);
        }

        private static Text CreateText(string name, RectTransform parent, int size,
                                       TextAnchor alignment, bool outline)
        {
            var root = new GameObject(name, typeof(RectTransform));
            root.transform.SetParent(parent, false);
            RectTransform rect = (RectTransform)root.transform;
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(7f, 3f);
            rect.offsetMax = new Vector2(-7f, -3f);
            Text text = root.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.alignment = alignment;
            text.color = GroundInk;
            text.raycastTarget = false;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            if (outline)
            {
                var edge = root.AddComponent<Outline>();
                edge.effectColor = new Color(0f, 0f, 0f, 0.78f);
                edge.effectDistance = new Vector2(1f, -1f);
            }
            return text;
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

        private void HideAll()
        {
            for (int i = 0; i < _groundPool.Count; i++) _groundPool[i].Root.SetActive(false);
            for (int i = 0; i < _speechPool.Count; i++) _speechPool[i].Root.SetActive(false);
            if (_statusRoot != null) _statusRoot.gameObject.SetActive(false);
        }

        private int CountActiveGround()
        {
            int count = 0;
            for (int i = 0; i < _groundPool.Count; i++) if (_groundPool[i].Root.activeSelf) count++;
            return count;
        }

        private int CountActiveSpeech()
        {
            int count = 0;
            for (int i = 0; i < _speechPool.Count; i++) if (_speechPool[i].Root.activeSelf) count++;
            return count;
        }
    }
}
