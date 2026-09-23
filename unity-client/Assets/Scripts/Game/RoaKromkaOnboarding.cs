using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;
using TMPro;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Canonical story onboarding. Objectives are server-owned and placed in the
    /// private caravan yard or private ambush instance; this Canvas only presents
    /// them and proposes a nearby interaction.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaKromkaOnboarding : MonoBehaviour
    {
        private static readonly Color Panel = new Color(0.035f, 0.048f, 0.038f, 0.96f);
        private static readonly Color Ink = new Color(0.91f, 0.89f, 0.78f, 1f);
        private static readonly Color Muted = new Color(0.61f, 0.67f, 0.55f, 1f);
        private static readonly Color Accent = new Color(0.91f, 0.68f, 0.24f, 1f);
        private RoaGameBootstrap _bootstrap;
        private RoaSocketClient _socket;
        private Canvas _canvas;
        private RectTransform _panel;
        private Text _kicker;
        private Text _title;
        private Text _instruction;
        private Text _hint;
        private Text _checks;
        private Text _distance;
        private RectTransform _objectiveMarker;
        private TextMeshProUGUI _objectiveMarkerDistance;
        private Button _skip;
        private JObject _state;
        private JObject _step;
        private Transform _beacon;
        private LineRenderer _ring;
        private LineRenderer _beam;
        private Material _beaconMaterial;
        private readonly List<JObject> _npcSnapshots = new List<JObject>();
        private bool _requestPending;
        private float _errorUntil;
        private string _error = string.Empty;
        private bool _mobilePresentation;

        public bool HasReceivedState { get; private set; }
        public bool IsActive { get { return HasReceivedState && (_state?["phase"]?.ToString() ?? "complete") != "complete"; } }
        public string Phase { get { return _state?["phase"]?.ToString() ?? string.Empty; } }
        public string StepId { get { return _step?["id"]?.ToString() ?? string.Empty; } }

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket)
        {
            if (_socket != null)
            {
                _socket.OnKromkaOnboardingState -= ApplyState;
                _socket.OnAuthoritativeSelf -= ApplyAuthoritativeSelf;
                _socket.OnJoined -= ApplyJoined;
            }
            _bootstrap = bootstrap;
            _socket = socket;
            if (_socket != null)
            {
                _socket.OnKromkaOnboardingState += ApplyState;
                _socket.OnAuthoritativeSelf += ApplyAuthoritativeSelf;
                _socket.OnJoined += ApplyJoined;
            }
            EnsureCanvas();
        }

        public void ApplyAuthoritativeSelf(JObject payload)
        {
            ApplyState(payload?["kromkaOnboarding"] as JObject);
        }

        private void ApplyJoined(JoinAck ack)
        {
            // The initial join already contains the authoritative onboarding
            // state. Waiting for a later state event left existing characters
            // in the retired four-step coach until they pressed "Skip".
            ApplyAuthoritativeSelf(ack?.Self);
        }

        public void ApplyState(JObject state)
        {
            if (state == null) return;
            _state = state;
            _step = state["step"] as JObject;
            HasReceivedState = true;
            _requestPending = false;
            _bootstrap?.RefreshEdgeExitAvailability();
            RefreshPresentation();
            RebuildBeacon();
        }

        private void Awake()
        {
            EnsureCanvas();
        }

        private void Update()
        {
            if (_canvas == null) EnsureCanvas();
            if (_mobilePresentation != (_bootstrap?.Combat?.MobileInputMode == true)) RefreshPresentation();
            bool visible = IsActive && _bootstrap != null && _bootstrap.InGame
                && !RoaGameBootstrap.BlocksWorldHud;
            _canvas.gameObject.SetActive(visible);
            if (_panel != null && _canvas.scaleFactor > 0f)
                _panel.SetSizeWithCurrentAnchors(RectTransform.Axis.Horizontal,
                    Mathf.Min(520f, Screen.width / _canvas.scaleFactor * 0.50f));
            if (!IsActive)
            {
                if (_beacon != null) _beacon.gameObject.SetActive(false);
                if (_objectiveMarker != null) _objectiveMarker.gameObject.SetActive(false);
                return;
            }
            if (_beacon != null)
            {
                _beacon.gameObject.SetActive(_bootstrap != null && !RoaGameBootstrap.BlocksWorldHud);
                _beacon.position = StepTarget();
                float wave = 0.5f + 0.5f * Mathf.Sin(Time.unscaledTime * 2.7f);
                _beam.startWidth = _beam.endWidth = 0.045f + wave * 0.025f;
                _ring.transform.localScale = Vector3.one * (1f + wave * 0.08f);
            }
            bool near = DistanceToStep() <= StepRadius() + 0.75f;
            if (_distance != null)
            {
                string npcName = _step?["npcName"]?.ToString() ?? string.Empty;
                if (_step?["ready"]?.Value<bool?>() == false) npcName = string.Empty;
                _distance.text = near
                    ? (string.IsNullOrEmpty(npcName) ? "Цель рядом" : "Поговорите: " + npcName)
                    : "До цели: " + Mathf.CeilToInt(DistanceToStep()) + " м";
                _distance.color = near ? Accent : Muted;
            }
            if (_objectiveMarker != null)
            {
                Camera camera = _bootstrap?.CameraRig != null
                    ? _bootstrap.CameraRig.GetComponent<Camera>() : Camera.main;
                Vector3 screen = camera != null
                    ? camera.WorldToScreenPoint(StepTarget() + Vector3.up * 2f)
                    : Vector3.zero;
                bool onScreen = visible && screen.z > 0f && screen.x >= 0f
                    && screen.x <= Screen.width && screen.y >= 0f
                    && screen.y <= Screen.height;
                _objectiveMarker.gameObject.SetActive(onScreen);
                if (onScreen)
                {
                    _objectiveMarker.anchoredPosition = new Vector2(screen.x, screen.y)
                        / Mathf.Max(0.01f, _canvas.scaleFactor);
                    if (_objectiveMarkerDistance != null)
                        _objectiveMarkerDistance.text = Mathf.CeilToInt(DistanceToStep()) + "м";
                }
            }
            if (_errorUntil > 0f && Time.realtimeSinceStartup >= _errorUntil)
            {
                _errorUntil = 0f;
                _error = string.Empty;
                RefreshPresentation();
            }
        }

        private void SkipTutorial()
        {
            if (_socket == null || _requestPending) return;
            _requestPending = true;
            _socket.EmitWithAck("kromkaOnboardingAction", new { action = "skip_tutorial" }, ack =>
            {
                _requestPending = false;
                if (ack?["ok"]?.Value<bool?>() == true) ApplyState(ack?["onboarding"] as JObject);
                else
                {
                    _error = ack?["error"]?.ToString() ?? "Пропуск недоступен.";
                    _errorUntil = Time.realtimeSinceStartup + 3f;
                    RefreshPresentation();
                }
            });
        }

        private void RefreshPresentation()
        {
            EnsureCanvas();
            if (!IsActive || _step == null)
            {
                _canvas.gameObject.SetActive(false);
                return;
            }
            JObject progress = _state["progress"] as JObject;
            int done = progress?["completed"]?.Value<int?>() ?? 0;
            int total = progress?["total"]?.Value<int?>() ?? 0;
            _kicker.text = (_state["phase"]?.ToString() == "tutorial" ? "ПОДГОТОВКА" : "ПРОЛОГ")
                + "   " + Mathf.Min(done + 1, total) + "/" + total;
            _title.text = _state["title"]?.ToString() + " · " + _step["title"]?.ToString();
            _instruction.text = string.IsNullOrEmpty(_error) ? _step["instruction"]?.ToString() : _error;
            _instruction.color = string.IsNullOrEmpty(_error) ? Ink : new Color(1f, 0.46f, 0.31f, 1f);
            bool mobile = _bootstrap?.Combat?.MobileInputMode == true;
            _mobilePresentation = mobile;
            var scaler = _canvas.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler, mobile);
            // Short landscape displays need legible lesson text, not a scaled
            // desktop card. The rest of the touch controls keep their layout.
            if (mobile && scaler != null) scaler.referenceResolution = new Vector2(960f, 540f);
            _hint.text = _step[mobile ? "mobileHint" : "hint"]?.ToString() ?? string.Empty;
            var checks = new List<string>();
            foreach (JObject row in _step["requirements"] as JArray ?? new JArray())
            {
                int count = row["count"]?.Value<int?>() ?? 1;
                int current = Mathf.Min(count, row["current"]?.Value<int?>() ?? 0);
                checks.Add((row["complete"]?.Value<bool?>() == true ? "✓ " : "○ ")
                    + row["label"] + (count > 1 ? "  " + current + "/" + count : string.Empty));
            }
            _checks.text = string.Join("\n", checks);
            if (checks.Count > 0 && _step["ready"]?.Value<bool?>() == true)
                _hint.text = "Выполнено. Вернитесь к " + _step["npcName"] + " и доложите в диалоге.";

            bool canSkip = _state["phase"]?.ToString() == "tutorial"
                && _state["canSkipTutorial"]?.Value<bool?>() == true;
            _skip.gameObject.SetActive(canSkip);
        }

        private float DistanceToStep()
        {
            Transform player = _bootstrap?.PlayerView != null ? _bootstrap.PlayerView.transform : null;
            if (player == null || _step == null) return 999f;
            Vector3 target = StepTarget();
            return Vector2.Distance(new Vector2(player.position.x, player.position.z),
                new Vector2(target.x, target.z));
        }

        private Vector3 StepTarget()
        {
            if (_step?["target"] is JObject practiceTarget)
                return RoaCoords.ToUnity(practiceTarget["x"]?.Value<float>() ?? 0f,
                    0.08f, practiceTarget["z"]?.Value<float>() ?? 0f);
            Vector3 target = RoaCoords.ToUnity(_step?["x"]?.Value<float?>() ?? 0f, 0.08f,
                _step?["z"]?.Value<float?>() ?? 0f);
            string npcId = _step?["npcId"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(npcId) || _bootstrap?.Enemies == null) return target;
            _bootstrap.Enemies.CollectPublicSnapshots(_npcSnapshots);
            foreach (JObject snapshot in _npcSnapshots)
            {
                if (snapshot?["kromkaOnboardingNpcId"]?.ToString() != npcId) continue;
                string actorId = snapshot["id"]?.ToString() ?? string.Empty;
                if (_bootstrap.Enemies.TryGetPosition(actorId, out Vector3 actorPosition))
                    return new Vector3(actorPosition.x, 0.08f, actorPosition.z);
            }
            return target;
        }

        private float StepRadius()
        {
            return Mathf.Max(1f, _step?["radius"]?.Value<float?>() ?? 3f);
        }

        private void RebuildBeacon()
        {
            if (_step == null)
            {
                if (_beacon != null) _beacon.gameObject.SetActive(false);
                return;
            }
            EnsureBeacon();
            _beacon.gameObject.SetActive(true);
            _beacon.position = StepTarget();
            float radius = Mathf.Min(2.2f, StepRadius() * 0.58f);
            for (int index = 0; index < _ring.positionCount; index++)
            {
                float angle = index / (float)_ring.positionCount * Mathf.PI * 2f;
                _ring.SetPosition(index, new Vector3(Mathf.Cos(angle) * radius, 0f,
                    Mathf.Sin(angle) * radius));
            }
            _beam.SetPosition(0, new Vector3(0f, 0.05f, 0f));
            _beam.SetPosition(1, new Vector3(0f, 2.7f, 0f));
        }

        private void EnsureBeacon()
        {
            if (_beacon != null) return;
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Sprites/Default") ?? Shader.Find("Unlit/Color");
            _beaconMaterial = shader != null ? new Material(shader) { name = "KromkaObjective_Runtime" } : null;
            if (_beaconMaterial != null)
            {
                _beaconMaterial.color = Accent;
                if (_beaconMaterial.HasProperty("_BaseColor")) _beaconMaterial.SetColor("_BaseColor", Accent);
                _beaconMaterial.renderQueue = 3020;
            }
            _beacon = new GameObject("KromkaStoryObjective").transform;
            _beacon.SetParent(transform, false);
            _ring = Line(_beacon, "ObjectiveGroundRing", true, 56, 0.08f);
            _beam = Line(_beacon, "ObjectiveVerticalBeam", false, 2, 0.05f);
        }

        private LineRenderer Line(Transform parent, string name, bool loop, int count, float width)
        {
            var target = new GameObject(name);
            target.transform.SetParent(parent, false);
            var line = target.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.loop = loop;
            line.positionCount = count;
            line.startWidth = line.endWidth = width;
            line.startColor = Accent;
            line.endColor = new Color(Accent.r, Accent.g, Accent.b, loop ? 0.92f : 0.05f);
            line.sharedMaterial = _beaconMaterial;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            return line;
        }

        private void EnsureCanvas()
        {
            if (_canvas != null) return;
            var root = new GameObject("KromkaOnboardingCanvas", typeof(RectTransform), typeof(Canvas),
                typeof(CanvasScaler), typeof(GraphicRaycaster));
            root.transform.SetParent(transform, false);
            _canvas = root.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 30;
            RoaUiScale.Apply(root.GetComponent<CanvasScaler>());
            _panel = Rect("OnboardingPanel", root.transform, new Vector2(0f, 1f), new Vector2(0f, 1f),
                new Vector2(18f, -18f), new Vector2(520f, 254f));
            _panel.pivot = new Vector2(0f, 1f);
            Image background = _panel.gameObject.AddComponent<Image>();
            background.color = Panel;
            background.raycastTarget = false;
            Outline outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(Accent.r, Accent.g, Accent.b, 0.72f);
            outline.effectDistance = new Vector2(1f, -1f);

            _kicker = Label("Kicker", _panel, 12, FontStyle.Bold, Accent);
            Place(_kicker.rectTransform, 16f, -28f, -150f, -7f);
            _title = Label("Title", _panel, 16, FontStyle.Bold, Ink);
            Place(_title.rectTransform, 16f, -55f, -16f, -30f);
            _instruction = Label("Instruction", _panel, 14, FontStyle.Normal, Ink);
            _instruction.horizontalOverflow = HorizontalWrapMode.Wrap;
            _instruction.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_instruction.rectTransform, 16f, -110f, -16f, -58f);
            _hint = Label("ControlHint", _panel, 14, FontStyle.Bold, Accent);
            _hint.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_hint.rectTransform, 16f, -181f, -16f, -114f);
            _checks = Label("Requirements", _panel, 12, FontStyle.Normal, Ink);
            Place(_checks.rectTransform, 16f, -226f, -16f, -184f);
            _distance = Label("Distance", _panel, 12, FontStyle.Bold, Muted);
            Place(_distance.rectTransform, 16f, -248f, -16f, -228f);
            GameObject markerPrefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_WorldSpace_Objective_01");
            if (markerPrefab != null)
            {
                GameObject marker = Instantiate(markerPrefab, root.transform, false);
                RoaApocalypseTmpFonts.Apply(marker);
                marker.name = "ApocalypseNavigationObjective";
                _objectiveMarker = (RectTransform)marker.transform;
                _objectiveMarker.anchorMin = _objectiveMarker.anchorMax = Vector2.zero;
                _objectiveMarker.pivot = new Vector2(0.5f, 0.5f);
                _objectiveMarker.localScale = Vector3.one * 0.8f;
                _objectiveMarkerDistance = _objectiveMarker.Find(
                    "Distance/Label_ObjectiveDistance")?.GetComponent<TextMeshProUGUI>();
                foreach (Animator animator in marker.GetComponentsInChildren<Animator>(true))
                    animator.enabled = false;
                foreach (Graphic graphic in marker.GetComponentsInChildren<Graphic>(true))
                    graphic.raycastTarget = false;
                marker.SetActive(false);
            }
            _skip = ActionButton("SkipTutorial", _panel, out Text skipLabel, SkipTutorial);
            skipLabel.text = "ПРОПУСТИТЬ";
            var skipRect = (RectTransform)_skip.transform;
            skipRect.anchorMin = skipRect.anchorMax = new Vector2(1f, 1f);
            skipRect.pivot = new Vector2(1f, 1f);
            skipRect.anchoredPosition = new Vector2(-10f, -7f);
            skipRect.sizeDelta = new Vector2(100f, 21f);
            _canvas.gameObject.SetActive(false);
        }

        private static Button ActionButton(string name, Transform parent, out Text label,
                                           UnityEngine.Events.UnityAction action)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            Image image = rect.gameObject.AddComponent<Image>();
            image.color = new Color(0.18f, 0.25f, 0.13f, 0.98f);
            Button button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(action);
            label = Label("Label", rect, 11, FontStyle.Bold, Ink);
            label.alignment = TextAnchor.MiddleCenter;
            label.rectTransform.anchorMax = Vector2.one;
            label.rectTransform.sizeDelta = Vector2.zero;
            return button;
        }

        private static Text Label(string name, Transform parent, int size, FontStyle style, Color color)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            Text text = rect.gameObject.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.fontStyle = style;
            text.alignment = TextAnchor.MiddleLeft;
            text.color = color;
            text.raycastTarget = false;
            return text;
        }

        private static RectTransform Rect(string name, Transform parent, Vector2 anchor,
                                          Vector2 pivot, Vector2 position, Vector2 size)
        {
            var target = new GameObject(name, typeof(RectTransform));
            RectTransform rect = (RectTransform)target.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = anchor;
            rect.pivot = pivot;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            return rect;
        }

        private static void Place(RectTransform rect, float left, float bottom, float right, float top)
        {
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.offsetMin = new Vector2(left, bottom);
            rect.offsetMax = new Vector2(right, top);
        }

        private void OnDestroy()
        {
            if (_socket != null)
            {
                _socket.OnKromkaOnboardingState -= ApplyState;
                _socket.OnAuthoritativeSelf -= ApplyAuthoritativeSelf;
                _socket.OnJoined -= ApplyJoined;
            }
            if (_beaconMaterial != null) Destroy(_beaconMaterial);
        }
    }
}
