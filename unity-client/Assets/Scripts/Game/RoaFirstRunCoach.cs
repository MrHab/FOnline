using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    [DisallowMultipleComponent]
    public sealed class RoaFirstRunCoach : MonoBehaviour
    {
        public enum CoachStep { Movement, Interaction, Activity, Mission, Complete }

        private const string PrefsKey = "roa.firstRunCoach.v1";
        private static readonly Color Panel = new Color(0.035f, 0.050f, 0.039f, 0.96f);
        private static readonly Color Border = new Color(0.70f, 0.58f, 0.26f, 0.72f);
        private static readonly Color Ink = new Color(0.91f, 0.87f, 0.75f, 1f);
        private static readonly Color Muted = new Color(0.57f, 0.66f, 0.53f, 1f);
        private static readonly Color Accent = new Color(0.95f, 0.78f, 0.30f, 1f);
        private static readonly Color Done = new Color(0.42f, 0.76f, 0.40f, 1f);

        public RoaGameBootstrap Bootstrap;

        private Canvas _canvas;
        private RectTransform _safeRoot;
        private RectTransform _panel;
        private Text _kicker;
        private Text _instruction;
        private readonly Image[] _progress = new Image[4];
        private CoachStep _step;
        private Vector3 _lastPlayerPosition;
        private float _movementMeters;
        private bool _hasPlayerPosition;
        private Rect _lastSafeArea;
        private bool _lastMobile;
        private bool _skipped;
        private string _trackedActivityTaskId = string.Empty;
        private string _consumedResultId = string.Empty;

        public CoachStep CurrentStep { get { return _step; } }
        public bool IsVisible { get { return _canvas != null && _canvas.gameObject.activeSelf; } }
        public string CurrentInstruction { get { return _instruction != null ? _instruction.text : string.Empty; } }

        public void Configure(RoaGameBootstrap bootstrap)
        {
            Bootstrap = bootstrap;
            if (_canvas == null) Build();
            if (string.IsNullOrEmpty(_consumedResultId))
                _consumedResultId = bootstrap?.WorldActivityCanvas?.LastResultId ?? string.Empty;
        }

        public void Restart()
        {
            _skipped = false;
            _step = CoachStep.Movement;
            _movementMeters = 0f;
            _hasPlayerPosition = false;
            _trackedActivityTaskId = string.Empty;
            _consumedResultId = Bootstrap?.WorldActivityCanvas?.LastResultId ?? string.Empty;
            PlayerPrefs.DeleteKey(PrefsKey);
            PlayerPrefs.Save();
            RefreshCopy();
        }

        private void Awake()
        {
            Build();
        }

        private void Update()
        {
            if (_canvas == null) Build();
            bool completedBefore = PlayerPrefs.GetInt(PrefsKey, 0) != 0;
            if (_skipped || completedBefore || Bootstrap == null || !Bootstrap.InGame)
            {
                _canvas.gameObject.SetActive(false);
                _hasPlayerPosition = false;
                return;
            }

            TrackMovement();
            bool interacted = Bootstrap.Interaction != null && Bootstrap.Interaction.IsPanelOpen;
            RoaWorldActivityCanvas activity = Bootstrap.WorldActivityCanvas;
            bool activityActive = activity != null && activity.IsActivityRunning;
            string activeTaskId = activity?.CurrentActivityTaskId ?? string.Empty;
            if (activityActive && !string.IsNullOrEmpty(activeTaskId)
                && (_step != CoachStep.Mission || string.IsNullOrEmpty(_trackedActivityTaskId)))
                _trackedActivityTaskId = activeTaskId;
            bool matchingResult = activity != null && !string.IsNullOrEmpty(_trackedActivityTaskId)
                && string.Equals(activity.LastResultTaskId, _trackedActivityTaskId,
                    System.StringComparison.Ordinal)
                && !string.IsNullOrEmpty(activity.LastResultId)
                && !string.Equals(activity.LastResultId, _consumedResultId,
                    System.StringComparison.Ordinal);
            bool activitySucceeded = matchingResult && activity.LastResultSucceeded;
            bool activityFailed = matchingResult && !activity.LastResultSucceeded;
            CoachStep next = ResolveStep(_step, _movementMeters >= 1.5f, interacted,
                                         Bootstrap.OnGlobalMap, activityActive,
                                         activitySucceeded, activityFailed);
            if (matchingResult) _consumedResultId = activity.LastResultId;
            if (activityFailed) _trackedActivityTaskId = string.Empty;
            if (next == CoachStep.Complete)
            {
                PlayerPrefs.SetInt(PrefsKey, 1);
                PlayerPrefs.Save();
                _canvas.gameObject.SetActive(false);
                return;
            }
            if (next != _step)
            {
                _step = next;
                RefreshCopy();
            }

            UpdateSafeArea();
            bool visible = !RoaGameBootstrap.BlocksWorldHud
                && !(_step == CoachStep.Mission && activityActive);
            _canvas.gameObject.SetActive(visible);
            if (visible) RefreshCopy();
        }

        private void TrackMovement()
        {
            Transform player = Bootstrap?.PlayerView != null ? Bootstrap.PlayerView.transform : null;
            if (player == null || Bootstrap.OnGlobalMap)
            {
                _hasPlayerPosition = false;
                return;
            }
            Vector3 current = player.position;
            if (!_hasPlayerPosition)
            {
                _lastPlayerPosition = current;
                _hasPlayerPosition = true;
                return;
            }
            Vector3 delta = Vector3.ProjectOnPlane(current - _lastPlayerPosition, Vector3.up);
            _lastPlayerPosition = current;
            if (delta.magnitude <= 5f) _movementMeters += delta.magnitude;
        }

        public static CoachStep ResolveStep(CoachStep current, bool moved, bool interacted,
                                            bool onGlobalMap, bool activityActive,
                                            bool activitySucceeded, bool activityFailed)
        {
            if (activitySucceeded) return CoachStep.Complete;
            if (activityFailed) return CoachStep.Activity;
            if (activityActive) return CoachStep.Mission;
            if (current == CoachStep.Mission && onGlobalMap) return CoachStep.Activity;
            if (onGlobalMap && (int)current < (int)CoachStep.Activity) return CoachStep.Activity;
            if (current == CoachStep.Movement && moved) return CoachStep.Interaction;
            if (current == CoachStep.Interaction && interacted) return CoachStep.Activity;
            return current;
        }

        public static string InstructionFor(CoachStep step, bool mobile, bool onGlobalMap)
        {
            if (step == CoachStep.Movement)
                return mobile
                    ? "Левый палец — движение, правый — направление взгляда. Пройдите несколько шагов."
                    : "WASD — движение, мышь — направление взгляда. Пройдите несколько шагов.";
            if (step == CoachStep.Interaction)
                return mobile
                    ? "Подойдите к зелёной или золотой метке и нажмите «ДЕЙСТВИЕ»."
                    : "Подойдите к зелёной или золотой метке и нажмите E.";
            if (step == CoachStep.Activity && onGlobalMap)
                return "Выберите карточку события и нажмите «ВЗЯТЬ И ЕХАТЬ».";
            if (step == CoachStep.Activity)
                return "Дойдите до края локации: переход на живую карту произойдёт автоматически.";
            if (step == CoachStep.Mission)
                return "Выполните выделенные цели. Когда появится «ЭВАКУАЦИЯ», доберитесь до неё и подтвердите выход.";
            return "Первая вылазка завершена. Результат и награда показаны в карточке.";
        }

        private void RefreshCopy()
        {
            if (_kicker == null || _instruction == null) return;
            bool mobile = Application.isMobilePlatform;
            int number = Mathf.Clamp((int)_step + 1, 1, 4);
            _kicker.text = "ПЕРВЫЙ ВЫХОД   " + number + "/4";
            _instruction.text = InstructionFor(_step, mobile, Bootstrap != null && Bootstrap.OnGlobalMap);
            for (int i = 0; i < _progress.Length; i++)
                _progress[i].color = i < (int)_step ? Done : i == (int)_step
                    ? Accent : new Color(Muted.r, Muted.g, Muted.b, 0.28f);
            _panel.sizeDelta = new Vector2(mobile ? 650f : 620f, mobile ? 108f : 94f);
        }

        private void Skip()
        {
            _skipped = true;
            PlayerPrefs.SetInt(PrefsKey, 1);
            PlayerPrefs.Save();
            if (_canvas != null) _canvas.gameObject.SetActive(false);
        }

        private void Build()
        {
            if (_canvas != null) return;
            var canvasGo = new GameObject("FirstRunCoachCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 31;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());

            _safeRoot = Rect("SafeArea", canvasGo.transform, Vector2.zero, Vector2.one,
                             new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            _panel = Rect("CoachPanel", _safeRoot, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f),
                          new Vector2(0f, -16f), new Vector2(620f, 94f));
            var background = _panel.gameObject.AddComponent<Image>();
            background.color = Panel;
            background.raycastTarget = false;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = Border;
            outline.effectDistance = new Vector2(1f, -1f);

            _kicker = Label("Kicker", _panel, 10, FontStyle.Bold, TextAnchor.MiddleLeft, Accent);
            Place(_kicker.rectTransform, 16f, -28f, -112f, -8f);
            Text help = Label("Help", _panel, 10, FontStyle.Normal, TextAnchor.MiddleRight, Muted);
            help.text = "F1 — все клавиши";
            Place(help.rectTransform, 370f, -28f, -102f, -8f);
            _instruction = Label("Instruction", _panel, 14, FontStyle.Normal, TextAnchor.UpperLeft, Ink);
            _instruction.horizontalOverflow = HorizontalWrapMode.Wrap;
            _instruction.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_instruction.rectTransform, 16f, -70f, -102f, -32f);

            Button skip = UiButton("Skip", _panel, "Пропустить", Skip);
            Place((RectTransform)skip.transform, 520f, -66f, -12f, -34f);

            for (int i = 0; i < _progress.Length; i++)
            {
                RectTransform bar = Rect("Step" + (i + 1), _panel, Vector2.zero, Vector2.zero,
                                         new Vector2(16f + i * 54f, 10f), new Vector2(46f, 3f));
                _progress[i] = bar.gameObject.AddComponent<Image>();
                _progress[i].raycastTarget = false;
            }
            UpdateSafeArea(true);
            RefreshCopy();
            _canvas.gameObject.SetActive(false);
        }

        private void UpdateSafeArea(bool force = false)
        {
            if (_safeRoot == null) return;
            Rect area = Screen.safeArea;
            bool mobile = Application.isMobilePlatform;
            if (!force && area == _lastSafeArea && mobile == _lastMobile) return;
            _lastSafeArea = area;
            _lastMobile = mobile;
            Vector2 min = area.position;
            Vector2 max = area.position + area.size;
            min.x /= Mathf.Max(1f, Screen.width);
            min.y /= Mathf.Max(1f, Screen.height);
            max.x /= Mathf.Max(1f, Screen.width);
            max.y /= Mathf.Max(1f, Screen.height);
            _safeRoot.anchorMin = min;
            _safeRoot.anchorMax = max;
            _safeRoot.offsetMin = Vector2.zero;
            _safeRoot.offsetMax = Vector2.zero;
        }

        private static RectTransform Rect(string name, Transform parent, Vector2 anchor, Vector2 pivot,
                                          Vector2 position, Vector2 size)
        {
            return Rect(name, parent, anchor, anchor, pivot, position, size);
        }

        private static RectTransform Rect(string name, Transform parent, Vector2 anchorMin,
                                          Vector2 anchorMax, Vector2 pivot,
                                          Vector2 position, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.pivot = pivot;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            return rect;
        }

        private static Text Label(string name, Transform parent, int size, FontStyle style,
                                  TextAnchor alignment, Color color)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            Text text = rect.gameObject.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.fontStyle = style;
            text.alignment = alignment;
            text.color = color;
            text.raycastTarget = false;
            return text;
        }

        private static Button UiButton(string name, Transform parent, string caption,
                                       UnityEngine.Events.UnityAction action)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            Image image = rect.gameObject.AddComponent<Image>();
            image.color = new Color(0.12f, 0.15f, 0.10f, 0.92f);
            Button button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(action);
            Text label = Label("Label", rect, 10, FontStyle.Normal, TextAnchor.MiddleCenter, Muted);
            label.text = caption;
            label.rectTransform.anchorMax = Vector2.one;
            label.rectTransform.sizeDelta = Vector2.zero;
            return button;
        }

        private static void Place(RectTransform rect, float left, float bottomY, float right, float topY)
        {
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.offsetMin = new Vector2(left, bottomY);
            rect.offsetMax = new Vector2(right, topY);
        }
    }
}
