using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>Five server-routed channels presented with the Apocalypse chat prefab.</summary>
    public sealed class RoaChatCanvas : MonoBehaviour
    {
        private static readonly string[] ChannelIds =
            { "world", "local", "faction", "group", "clan" };
        private static readonly string[] ChannelTabNames =
            { "Мир", "Лок.", "Фрак.", "Груп.", "Клан" };
        private readonly List<JObject> _history = new List<JObject>();
        private readonly List<GameObject> _rows = new List<GameObject>();
        private readonly Button[] _tabs = new Button[5];
        private RoaGameBootstrap _bootstrap;
        private RoaSocketClient _socket;
        private GameObject _canvasObject;
        private GameObject _launcherObject;
        private GameObject _panel;
        private RectTransform _content;
        private GameObject _rowTemplate;
        private TMP_InputField _input;
        private ScrollRect _scroll;
        private TextMeshProUGUI _status;
        private int _selected;
        private bool _pending;
        private bool _subscribed;
        private bool _expanded;

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket)
        {
            if (_subscribed && _socket != null) _socket.OnPlayerChatMessage -= Receive;
            _bootstrap = bootstrap;
            _socket = socket;
            if (_socket != null) _socket.OnPlayerChatMessage += Receive;
            _subscribed = _socket != null;
        }

        private void OnDestroy()
        {
            if (_subscribed && _socket != null) _socket.OnPlayerChatMessage -= Receive;
        }

        private void Update()
        {
            bool inGame = _bootstrap != null && _bootstrap.InGame;
            if (!inGame)
            {
                if (_canvasObject != null) _canvasObject.SetActive(false);
                if (_launcherObject != null) _launcherObject.SetActive(false);
                _expanded = false;
                return;
            }
            if (_canvasObject == null) Build();
            if (_canvasObject == null) return;
            if (_canvasObject.activeSelf != _expanded) _canvasObject.SetActive(_expanded);

            bool mobile = _bootstrap.MobileControls != null
                ? _bootstrap.MobileControls.ControlsEnabled : Application.isMobilePlatform;
            if (_launcherObject != null)
                _launcherObject.SetActive(mobile && !_expanded);
            var rect = (RectTransform)_panel.transform;
            rect.localScale = Vector3.one * (mobile ? 0.58f : 0.36f);
            rect.anchoredPosition = new Vector2(mobile ? 8f : 14f, 14f);

            if (_input == null) return;
            if (Input.GetKeyDown(KeyCode.Escape) && _expanded)
            {
                _input.DeactivateInputField();
                _expanded = false;
                _canvasObject.SetActive(false);
                if (EventSystem.current != null)
                    EventSystem.current.SetSelectedGameObject(null);
            }
            else if ((Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter))
                && !RoaPipboyCanvas.TypingInInputField()
                && EventSystem.current != null)
            {
                OpenChat();
            }
        }

        private void OpenChat()
        {
            _expanded = true;
            _canvasObject.SetActive(true);
            if (_launcherObject != null) _launcherObject.SetActive(false);
            _input.Select();
            _input.ActivateInputField();
        }

        private void Build()
        {
            GameObject prefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_ChatLog_01");
            if (prefab == null)
            {
                Debug.LogWarning("Apocalypse chat prefab is not installed.");
                enabled = false;
                return;
            }
            _canvasObject = new GameObject("ApocalypseChatCanvas", typeof(RectTransform),
                typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _canvasObject.transform.SetParent(transform, false);
            Canvas canvas = _canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 32;
            RoaUiScale.Apply(_canvasObject.GetComponent<CanvasScaler>());
            _panel = Instantiate(prefab, _canvasObject.transform, false);
            _panel.name = "ApocalypseChat";
            RectTransform rect = (RectTransform)_panel.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 0f);
            rect.pivot = new Vector2(0f, 0f);
            rect.sizeDelta = new Vector2(600f, 420f);

            Transform header = rect.Find("Header");
            Transform first = header != null ? header.GetChild(0) : null;
            Transform second = header != null && header.childCount > 1
                ? header.GetChild(1) : null;
            if (first != null && second != null)
            {
                for (int i = 0; i < ChannelIds.Length; i++)
                {
                    int index = i;
                    Transform tab = i == 0 ? first : i == 1 ? second
                        : Instantiate(first.gameObject, header, false).transform;
                    tab.name = "Channel_" + ChannelIds[i];
                    Animator animator = tab.GetComponent<Animator>();
                    if (animator != null) animator.enabled = false;
                    var title = tab.Find("Title")?.GetComponent<TextMeshProUGUI>();
                    if (title != null)
                    {
                        title.text = ChannelTabNames[i];
                        title.fontSize = 28f;
                        title.textWrappingMode = TextWrappingModes.NoWrap;
                    }
                    var width = tab.GetComponent<LayoutElement>();
                    if (width == null) width = tab.gameObject.AddComponent<LayoutElement>();
                    width.minWidth = 0f;
                    width.preferredWidth = 112f;
                    width.flexibleWidth = 1f;
                    Button button = tab.GetComponent<Button>();
                    _tabs[i] = button;
                    if (button != null)
                    {
                        button.onClick = new Button.ButtonClickedEvent();
                        button.onClick.AddListener(() => SelectChannel(index));
                    }
                }
            }

            _scroll = rect.Find("ScrollRect")?.GetComponent<ScrollRect>();
            _content = rect.Find("ScrollRect/Messages/Content") as RectTransform;
            if (_content != null && _content.childCount > 0)
            {
                _rowTemplate = _content.GetChild(0).gameObject;
                for (int i = 0; i < _content.childCount; i++)
                    _content.GetChild(i).gameObject.SetActive(false);
            }
            _input = rect.Find("Input")?.GetComponent<TMP_InputField>();
            if (_input != null)
            {
                _input.text = string.Empty;
                _input.characterLimit = 240;
                _input.lineType = TMP_InputField.LineType.SingleLine;
                _input.onSubmit.AddListener(Send);
                var placeholder = rect.Find("Input/Input_Area/Label_TypeMessageHere")
                    ?.GetComponent<TextMeshProUGUI>();
                if (placeholder != null) placeholder.text = "Сообщение... (Enter)";
                Transform sendIcon = rect.Find("Input/ICON");
                if (sendIcon != null)
                {
                    Image image = sendIcon.GetComponent<Image>();
                    if (image != null) image.raycastTarget = true;
                    Button sendButton = sendIcon.gameObject.AddComponent<Button>();
                    sendButton.targetGraphic = image;
                    sendButton.onClick.AddListener(() => Send(_input.text));
                }
            }
            var statusObject = new GameObject("ChatStatus", typeof(RectTransform),
                typeof(CanvasRenderer), typeof(TextMeshProUGUI));
            statusObject.transform.SetParent(_panel.transform, false);
            var statusRect = (RectTransform)statusObject.transform;
            statusRect.anchorMin = statusRect.anchorMax = new Vector2(0f, 0f);
            statusRect.pivot = new Vector2(0f, 0f);
            statusRect.anchoredPosition = new Vector2(20f, 105f);
            statusRect.sizeDelta = new Vector2(560f, 64f);
            _status = statusObject.GetComponent<TextMeshProUGUI>();
            _status.fontSize = 23f;
            _status.color = new Color(1f, 0.83f, 0.42f);
            _status.raycastTarget = false;
            RoaApocalypseTmpFonts.Apply(_panel);
            SelectChannel(0);
            BuildMobileLauncher();
            _canvasObject.SetActive(false);
        }

        private void BuildMobileLauncher()
        {
            if (_tabs[0] == null) return;
            _launcherObject = new GameObject("ApocalypseChatLauncher",
                typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler),
                typeof(GraphicRaycaster));
            _launcherObject.transform.SetParent(transform, false);
            Canvas canvas = _launcherObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 32;
            RoaUiScale.Apply(_launcherObject.GetComponent<CanvasScaler>());
            GameObject tab = Instantiate(_tabs[0].gameObject, _launcherObject.transform, false);
            tab.name = "OpenChat";
            RectTransform rect = (RectTransform)tab.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 0f);
            rect.pivot = new Vector2(0f, 0f);
            rect.anchoredPosition = new Vector2(14f, 14f);
            rect.sizeDelta = new Vector2(178f, 72f);
            rect.localScale = Vector3.one * 0.55f;
            Animator animator = tab.GetComponent<Animator>();
            if (animator != null) animator.enabled = false;
            TextMeshProUGUI label = tab.transform.Find("Title")?.GetComponent<TextMeshProUGUI>();
            if (label != null) label.text = "ЧАТ";
            Button button = tab.GetComponent<Button>();
            button.onClick = new Button.ButtonClickedEvent();
            button.onClick.AddListener(OpenChat);
            RoaApocalypseTmpFonts.Apply(tab);
            _launcherObject.SetActive(false);
        }

        private void SelectChannel(int index)
        {
            _selected = Mathf.Clamp(index, 0, ChannelIds.Length - 1);
            for (int i = 0; i < _tabs.Length; i++)
            {
                if (_tabs[i] == null) continue;
                Transform selected = _tabs[i].transform.Find("Selected");
                if (selected != null) selected.gameObject.SetActive(i == _selected);
            }
            if (_status != null) _status.text = string.Empty;
            RefreshRows();
        }

        private void Send(string raw)
        {
            string value = (raw ?? string.Empty).Trim();
            if (value.Length == 0 || _pending || _socket == null) return;
            _pending = true;
            string channel = ChannelIds[_selected];
            _socket.EmitWithAck("playerChatSend", new { channel, text = value }, ack =>
            {
                _pending = false;
                if (ack?.Value<bool>("ok") == true)
                {
                    if (_input != null) _input.text = string.Empty;
                    if (_status != null) _status.text = string.Empty;
                }
                else if (_status != null)
                    _status.text = ack?.Value<string>("error") ?? "Сообщение не отправлено.";
            });
            StartCoroutine(RefocusInput());
        }

        private IEnumerator RefocusInput()
        {
            yield return null;
            if (_input != null && _bootstrap != null && _bootstrap.InGame)
            {
                _input.Select();
                _input.ActivateInputField();
            }
        }

        private void Receive(JObject message)
        {
            string channel = message?.Value<string>("channel") ?? string.Empty;
            if (System.Array.IndexOf(ChannelIds, channel) < 0) return;
            _history.Add((JObject)message.DeepClone());
            if (_history.Count > 100) _history.RemoveAt(0);
            if (channel == ChannelIds[_selected]) RefreshRows();
        }

        private void RefreshRows()
        {
            if (_content == null || _rowTemplate == null) return;
            foreach (GameObject row in _rows) row.SetActive(false);
            int used = 0;
            foreach (JObject message in _history)
            {
                if (message.Value<string>("channel") != ChannelIds[_selected]) continue;
                GameObject row;
                if (used < _rows.Count) row = _rows[used];
                else
                {
                    row = Instantiate(_rowTemplate, _content, false);
                    row.name = "ChatMessage";
                    _rows.Add(row);
                }
                TextMeshProUGUI label = row.transform.Find("Label_Message")
                    ?.GetComponent<TextMeshProUGUI>();
                if (label != null)
                {
                    label.richText = false;
                    label.text = (message.Value<string>("senderName") ?? "Странник")
                        + ": " + (message.Value<string>("text") ?? string.Empty);
                    label.textWrappingMode = TextWrappingModes.Normal;
                }
                LayoutElement layout = row.GetComponent<LayoutElement>();
                if (layout != null)
                {
                    float lineHeight = label != null
                        ? label.GetPreferredValues(label.text, 500f, 1000f).y : 58f;
                    layout.preferredHeight = Mathf.Max(58f, lineHeight + 12f);
                }
                row.SetActive(true);
                used++;
            }
            if (_scroll != null && Application.isPlaying)
                StartCoroutine(ScrollAfterLayout());
        }

        private IEnumerator ScrollAfterLayout()
        {
            yield return null;
            if (_scroll != null && _scroll.gameObject.activeInHierarchy)
                _scroll.verticalNormalizedPosition = 0f;
        }
    }
}
