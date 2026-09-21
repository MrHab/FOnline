using System.Collections.Generic;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Экран аккаунта в структуре web-клиента (#character-screen, index.html:467;
    /// стили 01_base_layout_hud.css:561–715).
    ///
    /// Тёмная подложка на весь экран, карточка #character-card с заголовком
    /// «Вход в игру» / «Выбор персонажа», пояснением и панелью текущего шага:
    /// вход, регистрация, восстановление пароля (в Unity — по коду, как в
    /// RoaAuthClient), подтверждение нового пароля, список персонажей с
    /// карточками «Играть / Удалить» и подтверждением удаления, как
    /// openGameConfirmPanel в web (01_bootstrap_online_save.js:729).
    ///
    /// Вся логика (запросы, этапы, проверки) остаётся в RoaGameBootstrap —
    /// это окно только рисует и дёргает его фасад Auth*.
    /// Создание персонажа также собирается здесь: SPECIAL, навыки, перки и живой предпросмотр.
    /// </summary>
    public sealed class RoaAuthCanvas : MonoBehaviour
    {
        // Цвета из CSS.
        private static readonly Color ScreenBg = new Color(0.03f, 0.035f, 0.04f, 0.95f);
        private static readonly Color ScreenGlow = new Color(0.165f, 0.133f, 0.075f, 0.6f);
        private static readonly Color CardBg = new Color(0.051f, 0.063f, 0.063f, 0.92f);
        private static readonly Color CardBorder = new Color(0.682f, 0.545f, 0.282f, 0.45f);
        private static readonly Color PanelBg = new Color(0.024f, 0.031f, 0.031f, 0.6f);
        private static readonly Color PanelBorder = new Color(0.537f, 0.439f, 0.263f, 0.42f);
        private static readonly Color Title = new Color(0.941f, 0.824f, 0.541f, 1f);      // #f0d28a
        private static readonly Color Subtitle = new Color(0.663f, 0.6f, 0.439f, 1f);     // #a99970
        private static readonly Color PanelTitle = new Color(0.851f, 0.722f, 0.427f, 1f); // #d9b86d
        private static readonly Color InputBg = new Color(0.051f, 0.063f, 0.063f, 0.95f);
        private static readonly Color InputInk = new Color(0.945f, 0.867f, 0.667f, 1f);   // #f1ddaa
        private static readonly Color InputHint = new Color(0.945f, 0.867f, 0.667f, 0.45f);
        private static readonly Color ButtonBg = new Color(0.137f, 0.114f, 0.071f, 0.96f);
        private static readonly Color ButtonInk = new Color(0.906f, 0.757f, 0.443f, 1f);  // #e7c171
        private static readonly Color LinkInk = new Color(0.682f, 0.729f, 0.573f, 1f);    // #aeba92
        private static readonly Color StatusInk = new Color(0.557f, 0.627f, 0.49f, 1f);   // #8ea07d
        private static readonly Color StatusOk = new Color(0.58f, 0.725f, 0.506f, 1f);    // #94b981
        private static readonly Color StatusErr = new Color(0.878f, 0.584f, 0.447f, 1f);  // #e09572
        private static readonly Color RowBg = new Color(0.094f, 0.106f, 0.094f, 0.88f);
        private static readonly Color RowBorder = new Color(0.537f, 0.439f, 0.263f, 0.42f);
        private static readonly Color MetaInk = new Color(0.569f, 0.627f, 0.482f, 1f);    // #91a07b
        private static readonly Color DeleteBg = new Color(0.255f, 0.098f, 0.078f, 0.82f);
        private static readonly Color DeleteInk = new Color(0.91f, 0.627f, 0.518f, 1f);   // #e8a084

        public RoaGameBootstrap Bootstrap;

        /// <summary>
        /// Раскладка под палец вместо определения по платформе: редакторская проба
        /// строит телефонный экран на ПК.
        /// </summary>
        public bool? TouchLayoutOverride;

        /// <summary>
        /// Поле адреса сервера на шаге входа вместо определения по сборке: в браузере его
        /// нет, и редакторская проба меряет вход таким, каким его видит игрок.
        /// </summary>
        public bool? ServerFieldOverride;

        private GameObject _root;
        private RectTransform _card;
        private Canvas _canvas;
        private RectTransform _canvasRect;
        private Text _title;
        private Text _subtitle;
        private Text _note;
        private RectTransform _body;
        private float _bodyTop;
        private RectTransform _panel;
        private readonly List<GameObject> _bodyObjects = new List<GameObject>();
        private string _builtStep = string.Empty;
        private int _builtCharacters = -1;
        private Text _status;
        private float _statusTop;
        private string _statusMeasured;
        private float _refreshAt;

        // Подтверждение удаления — как модалка openGameConfirmPanel в web.
        private CharacterSummary _deleteCandidate;
        private GameObject _confirm;

        private readonly List<InputField> _inputs = new List<InputField>();

        private void Update()
        {
            bool visible = Bootstrap != null && Bootstrap.AuthCanvasDriven && Bootstrap.FrontendVisible;
            if (!visible)
            {
                if (_root != null && _root.activeSelf)
                {
                    _root.SetActive(false);
                    _builtStep = string.Empty;
                }
                return;
            }

            EnsureBuilt();
            if (!_root.activeSelf) _root.SetActive(true);

            string step = Bootstrap.AuthStep;
            int characters = Bootstrap.AuthCharacters.Count * 100000
                + Bootstrap.AuthCatalogVersion * 100
                + Bootstrap.ProgressionCatalogVersion;
            if (step != _builtStep || characters != _builtCharacters || LayoutChanged(step))
            {
                _builtCharacters = characters;
                RebuildBody(step);
            }

            if (step == "creator")
            {
                string signature = CreatorSignature();
                if (signature != _creatorSignature)
                {
                    _creatorSignature = signature;
                    RebuildCreatorDynamic();
                }
                RefreshPreview();
            }

            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + 0.2f;
                RefreshTexts(step);
            }

            // Tab — переход между полями, Enter — отправка, как у формы в браузере.
            if (_inputs.Count > 0 && Input.GetKeyDown(KeyCode.Tab)) FocusNextInput();
            if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter)) Submit(step);
        }

        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;

            if (FindAnyObjectByType<EventSystem>() == null)
            {
                var events = new GameObject("AuthEventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
                events.transform.SetParent(transform, false);
            }

            var canvasGo = new GameObject("AuthCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 60; // z-index 300 в web — выше всех игровых окон
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);
            _canvasRect = (RectTransform)canvasGo.transform;

            _root = new GameObject("CharacterScreen", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            Stretch(rootRect, 0f);
            _root.AddComponent<Image>().color = ScreenBg;

            // Радиальное свечение в центре — ближе к radial-gradient web.
            RectTransform glow = Child("Glow", rootRect);
            glow.anchorMin = glow.anchorMax = new Vector2(0.5f, 0.45f);
            glow.sizeDelta = new Vector2(1400f, 900f);
            var glowImage = glow.gameObject.AddComponent<Image>();
            glowImage.sprite = RadialSprite();
            glowImage.color = ScreenGlow;
            glowImage.raycastTarget = false;

            _card = Child("CharacterCard", rootRect);
            _card.anchorMin = _card.anchorMax = new Vector2(0.5f, 0.5f);
            _card.sizeDelta = new Vector2(1180f, 700f);
            var cardImage = _card.gameObject.AddComponent<Image>();
            cardImage.color = CardBg;
            var cardOutline = _card.gameObject.AddComponent<Outline>();
            cardOutline.effectColor = CardBorder;
            cardOutline.effectDistance = new Vector2(1f, -1f);

            // Кегль и место шапке даёт ApplyFrame: они зависят от раскладки шага под экран.
            _title = Label("Title", _card, 26, TextAnchor.UpperLeft, Title, FontStyle.Bold);
            _subtitle = Label("Subtitle", _card, 12, TextAnchor.UpperLeft, Subtitle);
            _subtitle.horizontalOverflow = HorizontalWrapMode.Wrap;
            _note = Label("OnlineNote", _card, 11, TextAnchor.UpperRight, StatusInk);
            _body = Child("Body", _card);
        }

        /// <summary>
        /// Шапка карточки и поле шага. У шагов аккаунта шапка одна: заголовок, справа от
        /// него адрес сервера, ниже пояснение, которому высоту даёт его текст, — поле
        /// шага начинается там, где шапка кончилась. Редактор персонажа ставит свою: на
        /// ПК шапка ниже и подзаголовок в одну строку, на телефоне шапку заменяет ряд
        /// вкладок.
        /// </summary>
        private void ApplyFrame(bool creator)
        {
            bool compact = creator && _layout.Compact;
            _title.gameObject.SetActive(true);
            _subtitle.gameObject.SetActive(!compact);
            _note.gameObject.SetActive(!compact);
            _title.alignment = compact ? TextAnchor.MiddleLeft : TextAnchor.UpperLeft;
            if (!creator)
            {
                _title.fontSize = Fs(26f);
                _subtitle.fontSize = Fs(12f);
                _note.fontSize = Fs(11f);
                float width = _layout.Card.x - 2f * AccountPad;
                float titleWidth = Mathf.Min(width, Mathf.Ceil(_title.preferredWidth) + U(12f));
                float titleHeight = U(36f);
                PlaceTop(_title.rectTransform, AccountPad, AccountPad, titleWidth, titleHeight);
                PlaceTop(_note.rectTransform, AccountPad + titleWidth, AccountPad + U(2f), width - titleWidth, U(20f));
                float subtitleWidth = Mathf.Min(width, U(582f));
                float subtitleHeight = WrappedHeight(_subtitle, subtitleWidth);
                PlaceTop(_subtitle.rectTransform, AccountPad, AccountPad + titleHeight, subtitleWidth, subtitleHeight);
                _bodyTop = AccountPad + titleHeight + subtitleHeight + U(12f);
                Place(_body, 0f, 0f, 1f, 1f, new Vector2(AccountPad, AccountPad), new Vector2(-AccountPad, -_bodyTop));
                return;
            }

            _card.sizeDelta = _layout.Card;
            float pad = CreatorPad;
            Place(_body, 0f, 0f, 1f, 1f, new Vector2(pad, pad), new Vector2(-pad, -CreatorBodyTop));
            if (compact)
            {
                _title.fontSize = Fs(15f);
                return; // место заголовка зависит от вкладок: его ставит BuildCreatorTabs
            }
            _title.fontSize = Fs(26f);
            _subtitle.fontSize = Fs(12f);
            _note.fontSize = Fs(12f);
            float titleBottom = 14f + U(36f);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(pad, -titleBottom), new Vector2(-340f, -14f));
            Place(_subtitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(pad, -titleBottom - U(22f)), new Vector2(-pad, -titleBottom));
            Place(_note.rectTransform, 1f, 1f, 1f, 1f, new Vector2(-340f, -14f - U(22f)), new Vector2(-pad, -14f));
        }

        // ------------------------------------------------------------------

        /// <summary>
        /// Каждый шаг раскладывается под экран сам (ComputeLayout), а карточка остаётся в
        /// масштабе раскладки — единице везде, кроме окна уже CompactMinWidth. Ужимать её
        /// целиком под экран нельзя: сжатая карточка мылит текст (глифы растрируются по
        /// масштабу канвы, а не карточки) и роняет 10 pt до 6 пикселей на телефоне.
        /// </summary>
        private void RebuildBody(string step)
        {
            // Пересборка того же шага под новый размер окна возвращает фокус тому же полю.
            int focused = 0;
            if (step == _builtStep)
                for (int i = 0; i < _inputs.Count; i++)
                    if (_inputs[i] != null && _inputs[i].isFocused) focused = i;

            foreach (GameObject go in _bodyObjects) Discard(go);
            _bodyObjects.Clear();
            _inputs.Clear();
            _status = null;
            _panel = null;
            CloseConfirm();
            // Заново открытый редактор начинается с первой вкладки; пересборка под новый
            // размер окна или каталог оставляет ту, что открыта.
            if (step != _builtStep) _creatorTab = 0;
            _builtStep = step;
            bool creator = step == "creator";
            _layout = ComputeLayout(creator);
            _card.localScale = Vector3.one * _layout.CardScale;
            HeaderTexts(step); // шапка меряет свой текст
            ApplyFrame(creator);

            switch (step)
            {
                case "register": BuildRegister(); break;
                case "reset": BuildReset(); break;
                case "resetConfirm": BuildResetConfirm(); break;
                case "select": BuildSelect(); break;
                case "creator": BuildCreator(); break;
                case "connecting": BuildConnecting(); break;
                default: BuildLogin(); break;
            }
            // На телефоне фокус поднял бы экранную клавиатуру поверх формы, а у редактора
            // поле имени ещё и лежит на закрытой вкладке.
            if (_inputs.Count > 0 && !_layout.Touch) _inputs[Mathf.Min(focused, _inputs.Count - 1)].ActivateInputField();
        }

        /// <summary>Экран строит и редакторская проба раскладки: в edit mode Destroy — ошибка в логе.</summary>
        private static void Discard(Object target)
        {
            if (target == null) return;
            if (Application.isPlaying) Destroy(target); else DestroyImmediate(target);
        }

        // --- Панель шага аккаунта: всё расставляется сверху вниз, метрики — через U() ---

        private float PanelWidth { get { return _layout.Card.x - 2f * AccountPad; } }

        /// <summary>
        /// Панель шага лежит в прокрутке на всё поле карточки. Высоту панели даёт её
        /// содержимое (ClosePanel), карточка растёт вместе с ней, как #character-card в
        /// web, но не выше экрана: не влезшее прокручивается, до кнопки всегда можно
        /// добраться. Пока панель ниже поля, прокрутки нет.
        /// </summary>
        private RectTransform Panel(string name)
        {
            RectTransform content = ScrollColumn(_body, 0f, 0f, PanelWidth, 0f);
            _bodyObjects.Add(content.parent.gameObject);
            _panel = Child(name, content);
            var image = _panel.gameObject.AddComponent<Image>();
            image.color = PanelBg;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            return _panel;
        }

        private void ClosePanel(float height)
        {
            PlaceTop(_panel, 0f, 0f, PanelWidth, height);
            var content = (RectTransform)_panel.parent;
            content.sizeDelta = new Vector2(0f, height);
            float cardHeight = Mathf.Min(_bodyTop + height + AccountPad, _layout.Card.y);
            _card.sizeDelta = new Vector2(_layout.Card.x, cardHeight);
            ((RectTransform)content.parent).sizeDelta = new Vector2(PanelWidth, cardHeight - _bodyTop - AccountPad);
        }

        /// <summary>Название панели слева, пояснение справа; right — место, занятое кнопкой в той же строке.</summary>
        private float PanelTitleRow(RectTransform panel, string caption, string small, float top, float height, float right)
        {
            float half = Mathf.Floor(PanelWidth * 0.5f);
            Text title = Label("PanelTitle", panel, Fs(12f), TextAnchor.MiddleLeft, PanelTitle, FontStyle.Bold);
            title.text = caption.ToUpperInvariant();
            PlaceTop(title.rectTransform, 12f, top, half - 12f, height);
            Text smallText = Label("PanelSmall", panel, Fs(11f), TextAnchor.MiddleRight, PanelTitle);
            smallText.text = small;
            PlaceTop(smallText.rectTransform, half, top, PanelWidth - half - right, height);
            return top + height;
        }

        /// <summary>Размещение от верхнего-левого угла: left/top — отступы, width/height — размер.</summary>
        private static void PlaceTop(RectTransform rect, float left, float top, float width, float height)
        {
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = new Vector2(left, -top);
            rect.sizeDelta = new Vector2(width, height);
        }

        /// <summary>
        /// Ставит подпись в поток сверху вниз и возвращает её низ. Высоту рамке даёт сам
        /// текст при его кегле: у подписей мельче основного кегль поднимает MinFont, и
        /// рамка, отмеренная в единицах макета, оказалась бы ниже строки.
        /// </summary>
        private float FlowText(Text text, float left, float top, float width)
        {
            float height = text.horizontalOverflow == HorizontalWrapMode.Wrap
                ? WrappedHeight(text, width) : Mathf.Ceil(text.preferredHeight);
            PlaceTop(text.rectTransform, left, top, width, height);
            return top + height;
        }

        private float TextInput(RectTransform panel, string key, float top, string placeholder, string value,
                                bool password, System.Action<string> onChanged)
        {
            RectTransform rect = Child("Input-" + key, panel);
            PlaceTop(rect, 12f, top, InputWidth, U(36f));
            InputBox(rect, Fs(14f), placeholder, value, password, onChanged);
            return top + U(36f);
        }

        private float InputWidth { get { return Mathf.Min(U(460f), PanelWidth - 24f); } }

        /// <summary>Поле ввода в готовом прямоугольнике: место и кегль задаёт вызывающий.</summary>
        private InputField InputBox(RectTransform rect, int fontSize, string placeholder, string value,
                                    bool password, System.Action<string> onChanged)
        {
            var back = rect.gameObject.AddComponent<Image>();
            back.color = InputBg;
            var outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.682f, 0.545f, 0.282f, 0.45f);
            outline.effectDistance = new Vector2(1f, -1f);

            var field = rect.gameObject.AddComponent<InputField>();
            Text text = Label("Text", rect, fontSize, TextAnchor.MiddleLeft, InputInk);
            Stretch(text.rectTransform, 10f);
            text.supportRichText = false;
            field.textComponent = text;
            Text hint = Label("Placeholder", rect, fontSize, TextAnchor.MiddleLeft, InputHint);
            Stretch(hint.rectTransform, 10f);
            hint.text = placeholder;
            field.placeholder = hint;
            field.characterLimit = 128;
            if (password) field.contentType = InputField.ContentType.Password;
            field.text = value ?? string.Empty;
            field.onValueChanged.AddListener(v => onChanged(v));
            _inputs.Add(field);
            return field;
        }

        private Button ActionButton(RectTransform panel, string caption, float right, float top, float width,
                                    bool link, System.Action onClick)
        {
            var go = new GameObject("Action", typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(panel, false);
            rect.anchorMin = rect.anchorMax = new Vector2(1f, 1f);
            rect.pivot = new Vector2(1f, 1f);
            rect.anchoredPosition = new Vector2(-right, -top);
            rect.sizeDelta = new Vector2(width, U(32f));
            var image = go.AddComponent<Image>();
            image.color = link ? new Color(0f, 0f, 0f, 0f) : ButtonBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = link ? new Color(0.682f, 0.545f, 0.282f, 0.35f) : new Color(0.682f, 0.545f, 0.282f, 0.55f);
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            Text label = Label("Label", rect, Fs(13f), TextAnchor.MiddleCenter, link ? LinkInk : ButtonInk);
            Stretch(label.rectTransform, 2f);
            label.text = caption;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        /// <summary>
        /// Кнопка шага аккаунта. Ширину ей даёт подпись — кегль у экранов разный, —
        /// но не меньше minWidth макета; место ей назначает ButtonRow. Высота U(32)
        /// под палец (Zoom от TouchZoom) — ровно MinTouchUnits.
        /// </summary>
        private Button ActionButton(RectTransform panel, string name, string caption, bool link, System.Action onClick,
                                    float minWidth = 96f)
        {
            Button button = ActionButton(panel, caption, 0f, 0f, 0f, link, onClick);
            button.name = name;
            float width = Mathf.Max(U(minWidth), Mathf.Ceil(button.GetComponentInChildren<Text>().preferredWidth) + U(36f));
            ((RectTransform)button.transform).sizeDelta = new Vector2(width, U(32f));
            return button;
        }

        /// <summary>
        /// Ряд кнопок от правого края родителя шириной room, первая — крайняя справа.
        /// Кнопка, которой не хватило места, уходит на следующую строку. Возвращает низ ряда.
        /// </summary>
        private float ButtonRow(float top, float right, float room, params Button[] buttons)
        {
            float gap = U(8f);
            float used = right;
            float rowHeight = 0f;
            foreach (Button button in buttons)
            {
                var rect = (RectTransform)button.transform;
                Vector2 size = rect.sizeDelta;
                if (used > right && used + size.x > room - right)
                {
                    top += rowHeight + gap;
                    used = right;
                    rowHeight = 0f;
                }
                rect.anchoredPosition = new Vector2(-used, -top);
                used += size.x + gap;
                rowHeight = Mathf.Max(rowHeight, size.y);
            }
            return top + rowHeight;
        }

        /// <summary>
        /// Строка статуса — последняя в панели, она же её и закрывает. Текст ей пишет
        /// сервер, длина любая: когда строк становится больше, панель и карточка
        /// подрастают вместе с ней, без пересборки шага — та отняла бы фокус у поля ввода.
        /// </summary>
        private void StatusLine(RectTransform panel, float top, string fallback)
        {
            _status = Label("Status", panel, Fs(11f), TextAnchor.UpperLeft, StatusInk);
            _status.horizontalOverflow = HorizontalWrapMode.Wrap;
            _statusFallback = fallback;
            _statusTop = top;
            _statusMeasured = null;
            ShowStatus();
        }

        private void ShowStatus()
        {
            string status = Bootstrap.StatusText;
            _status.text = string.IsNullOrEmpty(status) ? _statusFallback : status;
            _status.color = Bootstrap.AuthFailed ? StatusErr : (string.IsNullOrEmpty(status) ? StatusInk : StatusOk);
            if (_status.text == _statusMeasured) return;
            _statusMeasured = _status.text;
            ClosePanel(FlowText(_status, 12f, _statusTop, PanelWidth - 24f) + U(10f));
            // Панель выше поля карточки (вход с полем сервера на телефоне): ответ сервера не
            // должен остаться под нижним краем. Статус в панели последний — она докручивается до низа.
            var content = (RectTransform)_panel.parent;
            float hidden = content.sizeDelta.y - ((RectTransform)content.parent).sizeDelta.y;
            if (hidden > 0f && !string.IsNullOrEmpty(status)) content.anchoredPosition = new Vector2(0f, hidden);
        }

        private string _statusFallback = string.Empty;

        // --- Шаги -----------------------------------------------------------

        private void BuildLogin()
        {
            RectTransform panel = Panel("LoginPanel");
            float width = PanelWidth;

            // .quick-start-panel web (01:680): кикер, «Сразу в пустошь», подпись и «Начать сразу».
            // Подписи идут во всю ширину слева от кнопки: пояснение в одну строку экономит
            // телефону высоту, а блок получает высоту своего текста.
            RectTransform quick = Child("QuickStartPanel", panel);
            float quickWidth = width - 24f;
            var quickBg = quick.gameObject.AddComponent<Image>();
            quickBg.color = new Color(0.18f, 0.15f, 0.08f, 1f);
            var quickBorder = quick.gameObject.AddComponent<Outline>();
            quickBorder.effectColor = new Color(0.78f, 0.604f, 0.275f, 0.78f);
            quickBorder.effectDistance = new Vector2(1f, -1f);
            Button start = ActionButton(quick, "QuickStart", "Начать сразу", false, () => Bootstrap.AuthQuickStart(), 150f);
            float quickPad = U(14f);
            float textWidth = quickWidth - quickPad * 2f - ((RectTransform)start.transform).sizeDelta.x - U(16f);
            Text kicker = Label("Kicker", quick, Fs(9f), TextAnchor.UpperLeft, new Color(0.851f, 0.678f, 0.345f, 1f), FontStyle.Bold);
            kicker.text = "БЫСТРЫЙ СТАРТ";
            float y = FlowText(kicker, quickPad, U(10f), textWidth);
            Text strong = Label("Title", quick, Fs(16f), TextAnchor.UpperLeft, new Color(0.949f, 0.824f, 0.529f, 1f), FontStyle.Bold);
            strong.text = "Сразу в пустошь";
            y = FlowText(strong, quickPad, y, textWidth);
            Text small = Label("Small", quick, Fs(10f), TextAnchor.UpperLeft, new Color(0.722f, 0.753f, 0.639f, 1f));
            small.text = "Готовый выживший, пистолет и сохранение прогресса на этом устройстве.";
            small.horizontalOverflow = HorizontalWrapMode.Wrap;
            float quickHeight = FlowText(small, quickPad, y + U(2f), textWidth) + U(10f);
            PlaceTop(quick, 12f, U(8f), quickWidth, quickHeight);
            ButtonRow((quickHeight - U(32f)) * 0.5f, quickPad, quickWidth, start);

            Text divider = Label("Divider", panel, Fs(10f), TextAnchor.MiddleCenter, new Color(0.6f, 0.6f, 0.5f, 1f));
            divider.text = "— или войдите в постоянный аккаунт —";
            float top = FlowText(divider, 12f, U(8f) + quickHeight + U(8f), InputWidth);

            top = PanelTitleRow(panel, "Вход", "не выполнен вход", top + U(4f), U(20f), 12f) + U(10f);
            top = TextInput(panel, "login", top, "Логин", Bootstrap.AuthLogin, false, v => Bootstrap.AuthLogin = v) + U(8f);
            top = TextInput(panel, "password", top, "Пароль", Bootstrap.AuthPassword, true, v => Bootstrap.AuthPassword = v) + U(8f);
            // В браузере адрес берётся из адреса страницы, поэтому поле там только
            // технический шум и лишний способ случайно сломать вход. В остальных
            // сборках оно нужно: сервер задаётся вручную.
            if (ServerFieldOverride ?? ServerFieldInBuild)
                top = TextInput(panel, "server", top, "Сервер (http://host:port)", Bootstrap.AuthServerUrl, false, v => Bootstrap.AuthServerUrl = v) + U(8f);

            top = ButtonRow(top + U(4f), 12f, width,
                ActionButton(panel, "SubmitLogin", "Войти", false, () => Bootstrap.AuthSubmitLogin(), 120f),
                ActionButton(panel, "ShowRegister", "Зарегистрироваться", true, () => Bootstrap.AuthShowPanel("register")),
                ActionButton(panel, "ShowReset", "Забыли пароль?", true, () => Bootstrap.AuthShowPanel("reset")));
            StatusLine(panel, top + U(4f), "Войдите, чтобы загрузить персонажей с сервера.");
        }

#if !UNITY_WEBGL || UNITY_EDITOR
        private const bool ServerFieldInBuild = true;
#else
        private const bool ServerFieldInBuild = false;
#endif

        private void BuildRegister()
        {
            RectTransform panel = Panel("RegisterPanel");
            float top = PanelTitleRow(panel, "Регистрация", "новый аккаунт", U(12f), U(20f), 12f) + U(12f);
            top = TextInput(panel, "login", top, "Логин", Bootstrap.AuthLogin, false, v => Bootstrap.AuthLogin = v) + U(8f);
            top = TextInput(panel, "email", top, "Email для восстановления пароля", Bootstrap.AuthEmail, false, v => Bootstrap.AuthEmail = v) + U(8f);
            top = TextInput(panel, "password", top, "Пароль", Bootstrap.AuthPassword, true, v => Bootstrap.AuthPassword = v) + U(8f);
            top = TextInput(panel, "passwordConfirm", top, "Повторите пароль", Bootstrap.AuthPasswordConfirm, true, v => Bootstrap.AuthPasswordConfirm = v);
            top = ButtonRow(top + U(12f), 12f, PanelWidth,
                ActionButton(panel, "SubmitRegister", "Создать аккаунт", false, () => Bootstrap.AuthSubmitRegister()),
                ActionButton(panel, "BackToLogin", "Назад ко входу", true, () => Bootstrap.AuthShowPanel("login")));
            StatusLine(panel, top + U(4f), "После регистрации откроется выбор персонажа.");
        }

        private void BuildReset()
        {
            RectTransform panel = Panel("ResetPanel");
            float top = PanelTitleRow(panel, "Восстановление пароля", "код придёт на email", U(12f), U(20f), 12f) + U(12f);
            top = TextInput(panel, "email", top, "Email аккаунта", Bootstrap.AuthEmail, false, v => Bootstrap.AuthEmail = v);
            top = ButtonRow(top + U(12f), 12f, PanelWidth,
                ActionButton(panel, "SubmitReset", "Отправить код", false, () => Bootstrap.AuthSubmitResetRequest()),
                ActionButton(panel, "ShowResetConfirm", "У меня уже есть код", true, () => Bootstrap.AuthShowPanel("resetConfirm")),
                ActionButton(panel, "BackToLogin", "Назад ко входу", true, () => Bootstrap.AuthShowPanel("login")));
            StatusLine(panel, top + U(10f), "Введите email, указанный при регистрации.");
        }

        private void BuildResetConfirm()
        {
            RectTransform panel = Panel("ResetConfirmPanel");
            float top = PanelTitleRow(panel, "Новый пароль", "одноразовый код", U(12f), U(20f), 12f) + U(12f);
            top = TextInput(panel, "login", top, "Логин", Bootstrap.AuthLogin, false, v => Bootstrap.AuthLogin = v) + U(8f);
            top = TextInput(panel, "resetToken", top, "Код восстановления", Bootstrap.AuthResetToken, false, v => Bootstrap.AuthResetToken = v) + U(8f);
            top = TextInput(panel, "newPassword", top, "Новый пароль", Bootstrap.AuthNewPassword, true, v => Bootstrap.AuthNewPassword = v) + U(8f);
            top = TextInput(panel, "passwordConfirm", top, "Повторите новый пароль", Bootstrap.AuthPasswordConfirm, true, v => Bootstrap.AuthPasswordConfirm = v);
            top = ButtonRow(top + U(12f), 12f, PanelWidth,
                ActionButton(panel, "SubmitResetConfirm", "Сохранить новый пароль", false, () => Bootstrap.AuthSubmitResetConfirm()),
                ActionButton(panel, "BackToLogin", "Назад ко входу", true, () => Bootstrap.AuthShowPanel("login")));
            StatusLine(panel, top + U(4f), "Введите новый пароль длиной не менее 8 символов.");
        }

        private void BuildConnecting()
        {
            RectTransform panel = Panel("ConnectingPanel");
            float top = PanelTitleRow(panel, "Подключение", Bootstrap.AuthServerUrl, U(12f), U(20f), 12f);
            StatusLine(panel, top + U(12f), "Вход...");
        }

        private void BuildSelect()
        {
            IReadOnlyList<CharacterSummary> characters = Bootstrap.AuthCharacters;
            RectTransform panel = Panel("SelectPanel");
            float width = PanelWidth;

            // Название панели стоит в одну строку с «Выйти» и по её высоте.
            Button logout = ActionButton(panel, "Logout", "Выйти", true, () => Bootstrap.AuthLogout());
            Vector2 logoutSize = ((RectTransform)logout.transform).sizeDelta;
            float top = ButtonRow(U(10f), 12f, width, logout);
            PanelTitleRow(panel, "Выбор персонажа", Bootstrap.AuthLogin, U(10f), logoutSize.y, 12f + logoutSize.x + U(10f));
            top += U(8f);

            // Список карточек (.character-list). Высоту карточке даёт её текст, поэтому
            // расставляет их этот код, а не LayoutGroup.
            float listWidth = width - 24f;
            RectTransform list = ScrollColumn(panel, 12f, top, listWidth, 0f);
            float gap = U(8f);
            float firstRow = 0f;
            float bottom = 0f;
            if (characters.Count == 0) bottom = firstRow = AddEmptyRow(list, listWidth);
            foreach (CharacterSummary character in characters)
            {
                bottom = AddCharacterRow(list, character, bottom > 0f ? bottom + gap : 0f, listWidth);
                if (firstRow <= 0f) firstRow = bottom;
            }
            list.sizeDelta = new Vector2(0f, bottom);

            // Под списком — кнопка и статус, которому отмерено две строки; всё остальное
            // поле карточки достаётся списку. Карточки, которым не хватило места,
            // прокручиваются в нём, а не вместе со всей панелью; меньше одной карточки
            // список не бывает — тогда уже прокручивается панель.
            float below = U(10f) + U(32f) + U(4f) + 2f * U(18f) + U(10f);
            float room = _layout.Card.y - _bodyTop - AccountPad - top - below;
            float listHeight = Mathf.Min(bottom, Mathf.Max(room, firstRow));
            ((RectTransform)list.parent).sizeDelta = new Vector2(listWidth, listHeight);

            top = ButtonRow(top + listHeight + U(10f), 12f, width,
                ActionButton(panel, "CreateNew", "Создать нового персонажа", false, () => Bootstrap.AuthOpenCreator()));
            StatusLine(panel, top + U(4f), characters.Count > 0
                ? "Выберите персонажа для продолжения."
                : "Персонажей пока нет. Создайте нового.");
        }

        private float AddEmptyRow(RectTransform list, float width)
        {
            RectTransform rect = Child("Empty", list);
            rect.gameObject.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0f);
            var border = rect.gameObject.AddComponent<Outline>();
            border.effectColor = RowBorder;
            border.effectDistance = new Vector2(1f, -1f);
            Text text = Label("Text", rect, Fs(12f), TextAnchor.UpperLeft, StatusInk);
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.text = "На этом аккаунте пока нет персонажей. Создайте нового персонажа.";
            float height = FlowText(text, 12f, U(12f), width - 24f) + U(12f);
            PlaceTop(rect, 0f, 0f, width, height);
            return height;
        }

        /// <summary>Карточка персонажа (.character-card): имя, строка сведений с переносом и «Играть / Удалить». Возвращает свой низ.</summary>
        private float AddCharacterRow(RectTransform list, CharacterSummary character, float top, float width)
        {
            RectTransform rect = Child("Row", list);
            rect.gameObject.AddComponent<Image>().color = RowBg;
            var outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = RowBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            Button delete = ActionButton(rect, "Delete", "Удалить", false, () => OpenConfirm(character));
            delete.GetComponent<Image>().color = DeleteBg;
            delete.GetComponentInChildren<Text>().color = DeleteInk;
            Button play = ActionButton(rect, "Play", "Играть", false, () => Bootstrap.AuthPlayCharacter(character.CharacterId));
            float pad = U(10f);
            float buttons = ((RectTransform)delete.transform).sizeDelta.x + U(8f) + ((RectTransform)play.transform).sizeDelta.x;
            float textWidth = width - pad * 3f - buttons;

            Text name = Label("Name", rect, Fs(14f), TextAnchor.UpperLeft, Title, FontStyle.Bold);
            // Значка радиации, как в web, перед именем нет: во вложенном шрифте такого глифа
            // нет, а в WebGL подставить его неоткуда — имя начиналось бы с пустого места.
            name.text = string.IsNullOrEmpty(character.Name) ? "Без имени" : character.Name;
            float y = FlowText(name, pad, pad, textWidth);
            // Название локации приходит из каталога и бывает длинным: строка переносится,
            // а не уходит под кнопки.
            Text meta = Label("Meta", rect, Fs(11f), TextAnchor.UpperLeft, MetaInk);
            meta.horizontalOverflow = HorizontalWrapMode.Wrap;
            meta.text = CharacterMeta(character);
            float height = Mathf.Max(U(66f), FlowText(meta, pad, y + U(4f), textWidth) + pad);
            PlaceTop(rect, 0f, top, width, height);
            ButtonRow((height - U(32f)) * 0.5f, pad, width, delete, play);
            return top + height;
        }

        /// <summary>Строка .character-card-meta: внешность · уровень · локация · обновлён.</summary>
        private string CharacterMeta(CharacterSummary character)
        {
            string appearance = AppearanceLabel(character.Appearance);
            string updated = character.UpdatedAt > 0
                ? System.DateTimeOffset.FromUnixTimeMilliseconds(character.UpdatedAt).ToLocalTime().ToString("dd.MM.yyyy HH:mm")
                : "нет даты";
            return (string.IsNullOrEmpty(appearance) ? string.Empty : appearance + " · ")
                + "Уровень " + Mathf.Max(1, character.Level)
                + " · Локация: " + Bootstrap.AuthLocationLabel(character.LocationId)
                + " · обновлён: " + updated;
        }

        /// <summary>characterAppearanceLabel (04b_character_glb_runtime.js:139) — пол · телосложение.</summary>
        private static string AppearanceLabel(Newtonsoft.Json.Linq.JObject appearance)
        {
            if (appearance == null) return string.Empty;
            string sex = appearance["sex"]?.ToString() == "female" ? "Женский" : "Мужской";
            string bodyType = appearance["bodyType"]?.ToString();
            string body = bodyType == "slim" ? "Стройное" : bodyType == "large" ? "Крепкое" : "Среднее";
            return sex + " · " + body;
        }

        // --- Раскладка под экран: общая для шагов аккаунта и создания персонажа ---

        /// <summary>
        /// Нижний предел кегля на экране аккаунта — в пикселях экрана, а не в пунктах.
        /// Вложенный Noto Sans импортирован как Hinted Raster: глиф растрируется в целых
        /// пикселях (кегль × масштаб канвы), и мельче 11 пикселей буквы теряют форму,
        /// каким бы ни был кегль в единицах канвы.
        /// </summary>
        public const float MinTextPixels = 10.5f;

        /// <summary>
        /// Наименьшая сторона кнопки под палец, в единицах канвы телефонного референса
        /// 1280×720: на экране 844×390 это 29 пикселей, на 1266×585 — 43.
        /// </summary>
        public const float MinTouchUnits = 48f;

        // Основной кегль настольного макета: от него считается Zoom. Подписи мельче
        // (9–11 pt на шагах аккаунта) до MinFont поднимает сама Fs.
        private const int DesignFont = 12;
        private const float TouchZoom = 1.5f;       // телефон: те же метрики в полтора раза крупнее
        private const float CardMargin = 24f;
        private const float AccountCardWidth = 1180f; // #character-card в web
        private const float AccountPad = 18f;
        private const float MaxCardWidth = 1416f;   // 1440 − поля: на 16:9 карточка встаёт пиксель в пиксель
        // Уже — четырём колонкам тесно: строке «ЦВЕТ ВОЛОС … Светло-коричневый» нужна колонка
        // в 358 единиц, то есть карточка от 1306. 16:9 и 16:10 проходят, 4:3 получает вкладки.
        private const float WideMinWidth = 1310f;
        private const float CompactMinWidth = 960f; // уже — карточка всё-таки ужимается

        private static readonly string[] PageIds = { "appearance", "params", "skills", "traits" };
        private static readonly string[] PageTitles = { "ВНЕШНОСТЬ", "ПАРАМЕТРЫ", "НАВЫКИ", "ПЕРКИ" };
        private static readonly float[] ColumnWeights = { 0.29f, 0.228f, 0.214f, 0.268f };

        private static readonly Color BlockBg = new Color(0.024f, 0.031f, 0.031f, 0.48f);
        private static readonly Color StepperBg = new Color(0.094f, 0.106f, 0.094f, 0.88f);
        private static readonly Color StatName = new Color(0.78f, 0.706f, 0.518f, 1f);    // #c7b484
        private static readonly Color StatVal = new Color(0.949f, 0.839f, 0.553f, 1f);    // #f2d68d
        private static readonly Color CardBgDim = new Color(0.094f, 0.106f, 0.094f, 0.82f);
        private static readonly Color CardSelected = new Color(0.498f, 0.698f, 0.294f, 1f); // #7fb24b
        private static readonly Color CardTitle = new Color(0.937f, 0.82f, 0.549f, 1f);  // #efd18c
        private static readonly Color CardDesc = new Color(0.616f, 0.608f, 0.494f, 1f);  // #9d9b7e
        private static readonly Color DerivedInk = new Color(0.725f, 0.678f, 0.525f, 1f); // #b9ad86
        private static readonly Color NoteGreen = new Color(0.498f, 0.698f, 0.294f, 0.58f);
        private static readonly Color SmallNote = new Color(0.47f, 0.518f, 0.431f, 1f);  // #78846e
        private static readonly Color TabSelectedBg = new Color(0.231f, 0.188f, 0.102f, 0.98f);
        private static readonly Color TabBorder = new Color(0.682f, 0.545f, 0.282f, 0.4f);
        private static readonly Color TabSelectedBorder = new Color(0.851f, 0.722f, 0.427f, 0.95f);

        /// <summary>
        /// Раскладка шага под текущий экран. Карточка остаётся в масштабе 1, а под
        /// экран подстраиваются кегль и расстановка. MinFont — кегль, который на этом
        /// экране даёт MinTextPixels; Zoom — множитель метрик относительно настольного
        /// макета (кегль 12), под палец не меньше TouchZoom. CardScale меньше 1 только
        /// у окна уже CompactMinWidth, и кегль это возмещает. Card — размер карточки
        /// создания персонажа; у шагов аккаунта — ширина карточки и предел её высоты:
        /// саму высоту даёт панель шага. Compact — только у создания персонажа: вкладки
        /// вместо четырёх колонок, под палец и когда колонкам тесно.
        /// </summary>
        private struct ScreenLayout
        {
            public bool Compact;
            public bool Touch;
            public float CardScale;
            public float Zoom;
            public int MinFont;
            public Vector2 Card;

            public bool Same(ScreenLayout other)
            {
                return Compact == other.Compact && Touch == other.Touch && MinFont == other.MinFont
                    && Mathf.Abs(CardScale - other.CardScale) < 0.001f && Mathf.Abs(Zoom - other.Zoom) < 0.001f
                    && Mathf.Abs(Card.x - other.Card.x) < 0.5f && Mathf.Abs(Card.y - other.Card.y) < 0.5f;
            }
        }

        private ScreenLayout _layout;

        private bool TouchLayout()
        {
            if (TouchLayoutOverride.HasValue) return TouchLayoutOverride.Value;
            return Application.isMobilePlatform
                || (Bootstrap != null && Bootstrap.MobileControls != null && Bootstrap.MobileControls.ControlsEnabled);
        }

        private ScreenLayout ComputeLayout(bool creator)
        {
            Rect viewport = _canvasRect.rect;
            if (viewport.width <= 1f || viewport.height <= 1f) viewport = new Rect(Vector2.zero, RoaUiScale.Reference);
            float canvasScale = _canvas != null ? Mathf.Max(0.01f, _canvas.scaleFactor) : 1f;
            var layout = new ScreenLayout { Touch = TouchLayout() };
            layout.CardScale = Mathf.Clamp((viewport.width - CardMargin) / CompactMinWidth, 0.35f, 1f);
            layout.MinFont = Mathf.CeilToInt(MinTextPixels / (canvasScale * layout.CardScale) - 0.001f);
            layout.Zoom = Mathf.Max(layout.Touch ? TouchZoom : 1f, layout.MinFont / (float)DesignFont);
            float roomX = (viewport.width - CardMargin) / layout.CardScale;
            float roomY = (viewport.height - CardMargin) / layout.CardScale;
            if (!creator)
            {
                layout.Card = new Vector2(Mathf.Floor(Mathf.Min(roomX, AccountCardWidth)), Mathf.Floor(roomY));
                return layout;
            }
            layout.Compact = layout.Touch || roomX < WideMinWidth * layout.Zoom;
            // Настольный макет: шапка 80, колонки 620, ряд действий 56 и поля — 786 единиц
            // при Zoom 1, ровно 810 − поля. Вкладки занимают экран целиком.
            float height = layout.Compact ? roomY : Mathf.Min(roomY, 52f + 734f * layout.Zoom);
            layout.Card = new Vector2(Mathf.Floor(Mathf.Min(roomX, MaxCardWidth)), Mathf.Floor(height));
            return layout;
        }

        /// <summary>Окно, масштаб канвы или способ ввода изменились: построенный шаг пора переложить.</summary>
        private bool LayoutChanged(string step)
        {
            // Экранная клавиатура телефона меняет размер окна, а пересборка отняла бы фокус у
            // поля ввода и закрыла её. На ПК поле в фокусе с самого открытия экрана, поэтому
            // там окно перекладывается сразу, а фокус возвращает RebuildBody.
            if (_layout.Touch)
                foreach (InputField field in _inputs)
                    if (field != null && field.isFocused) return false;
            return !_layout.Same(ComputeLayout(step == "creator"));
        }

        /// <summary>
        /// Высота переносимого текста при данной ширине рамки. Рамка подписи привязана к
        /// пикселям экрана и в зависимости от места теряет до пикселя ширины, поэтому
        /// строка «впритык» после расстановки переносилась иначе, чем при замере.
        /// Меряем на два пикселя уже: лишняя строка в запасе безвредна, нехватка — нет.
        /// </summary>
        private float WrappedHeight(Text text, float width)
        {
            float slack = 2f / (_canvas != null ? Mathf.Max(0.01f, _canvas.scaleFactor) : 1f);
            TextGenerationSettings settings = text.GetGenerationSettings(new Vector2(Mathf.Max(1f, width - slack), 0f));
            float pixels = text.cachedTextGeneratorForLayout.GetPreferredHeight(text.text, settings);
            return Mathf.Ceil(pixels / text.pixelsPerUnit) + 1f;
        }

        /// <summary>Метрика настольного макета в единицах канвы текущей раскладки.</summary>
        private float U(float design) { return design * _layout.Zoom; }

        /// <summary>Кегль настольного макета, не мельче MinTextPixels на этом экране.</summary>
        private int Fs(float design) { return Mathf.Max(Mathf.RoundToInt(design * _layout.Zoom), _layout.MinFont); }

        // --- Создание персонажа (#character-creator-panel) ---------------------

        private sealed class CreatorTab
        {
            public Image Back;
            public Outline Border;
            public Text Label;
        }

        private int _creatorTab;
        private readonly List<RectTransform> _pages = new List<RectTransform>();
        private readonly List<CreatorTab> _tabs = new List<CreatorTab>();
        private string _creatorSignature = string.Empty;
        private RawImage _previewImage;
        private Text _previewSummary;
        private Text _previewStatus;
        private RectTransform _statsBox;
        private float _statPitch;
        private float _statRow;
        private RectTransform _skillsList;
        private RectTransform _traitsList;
        private Text _pointsLeft;
        private Text _skillCount;
        private Text _traitCount;
        private readonly List<Text> _derivedTexts = new List<Text>();
        private Text _readiness;
        private Button _createButton;
        private readonly Dictionary<string, Text> _stepperValues = new Dictionary<string, Text>();
        private Image _hairSwatch;
        private readonly List<GameObject> _dynamicObjects = new List<GameObject>();

        private string CreatorSignature()
        {
            RoaCharacterCreator c = Bootstrap.Creator;
            var sb = new System.Text.StringBuilder();
            foreach (RoaCharacterCreator.StatDef stat in RoaCharacterCreator.Stats) sb.Append(c.Stat(stat.Id)).Append(',');
            sb.Append(string.Join("|", c.TaggedSkills)).Append('#').Append(string.Join("|", c.SelectedTraits));
            sb.Append('#').Append(Bootstrap.ProgressionCatalogVersion);
            return sb.ToString();
        }

        private float CreatorPad { get { return _layout.Compact ? 12f : 18f; } }
        private float CreatorBodyTop { get { return _layout.Compact ? 12f + U(36f) + 8f : 22f + U(58f); } }
        private float StepperArrowWidth { get { return U(_layout.Compact ? 56f : 40f); } }
        private string CreatorTitle { get { return _layout.Compact ? "НОВЫЙ ПЕРСОНАЖ" : "КРОМКА · НОВЫЙ ПЕРСОНАЖ"; } }

        /// <summary>
        /// Четыре блока — внешность, имя с характеристиками и производными, навыки,
        /// перки. На ПК это четыре колонки во всю высоту карточки, на телефоне — четыре
        /// вкладки; ряд «Назад / Создать и начать» в обоих случаях прибит к низу
        /// карточки, а всё, что не влезло в блок, прокручивается внутри него.
        /// </summary>
        private void BuildCreator()
        {
            _stepperValues.Clear();
            _dynamicObjects.Clear();
            _derivedTexts.Clear();
            _pages.Clear();
            _tabs.Clear();
            _hairSwatch = null;

            bool compact = _layout.Compact;
            float gap = compact ? 8f : 12f;
            float width = _layout.Card.x - 2f * CreatorPad;
            float height = _layout.Card.y - CreatorBodyTop - CreatorPad;
            RectTransform panel = Child("CreatorPanel", _body);
            Stretch(panel, 0f);
            _bodyObjects.Add(panel.gameObject);

            float actionsHeight = U(compact ? 36f : 56f);
            BuildCreatorActions(panel, width, height - actionsHeight, actionsHeight);
            float pagesHeight = height - actionsHeight - gap;

            float free = width - gap * (PageIds.Length - 1);
            float left = 0f;
            for (int i = 0; i < PageIds.Length; i++)
            {
                float pageWidth = compact ? width
                    : i == PageIds.Length - 1 ? width - left : Mathf.Round(free * ColumnWeights[i]);
                RectTransform page = Child("Page-" + PageIds[i], panel);
                PlaceTop(page, compact ? 0f : left, 0f, pageWidth, pagesHeight);
                _pages.Add(page);
                switch (i)
                {
                    case 0: BuildAppearancePage(page, pageWidth, pagesHeight); break;
                    case 1: BuildParamsPage(page, pageWidth, pagesHeight); break;
                    case 2:
                        _skillsList = BuildChoicePage(page, pageWidth, pagesHeight, "SkillBlock", "Профильные навыки",
                            "Выберите 1–2 навыка. Каждый выбранный навык получает +5% к базовому значению.", out _skillCount);
                        break;
                    default:
                        _traitsList = BuildChoicePage(page, pageWidth, pagesHeight, "TraitBlock", "Стартовые перки",
                            "Выберите 1–2 стартовых перка. Без перка персонажа создать нельзя.", out _traitCount);
                        break;
                }
                left += pageWidth + gap;
            }
            if (compact) BuildCreatorTabs();

            _creatorSignature = string.Empty; // динамика построится в Update
        }

        /// <summary>Вкладки занимают место шапки; в узком окне заголовок уступает им строку целиком.</summary>
        private void BuildCreatorTabs()
        {
            float pad = CreatorPad;
            float gap = 8f;
            float height = U(36f);
            float labelWidth = 0f;
            for (int i = 0; i < PageIds.Length; i++)
            {
                int index = i;
                var go = new GameObject("Tab-" + PageIds[i], typeof(RectTransform));
                var rect = (RectTransform)go.transform;
                rect.SetParent(_card, false);
                var tab = new CreatorTab { Back = go.AddComponent<Image>(), Border = go.AddComponent<Outline>() };
                tab.Border.effectDistance = new Vector2(1f, -1f);
                var button = go.AddComponent<Button>();
                button.targetGraphic = tab.Back;
                button.onClick.AddListener(() => SelectCreatorTab(index));
                tab.Label = Label("Label", rect, Fs(13f), TextAnchor.MiddleCenter, ButtonInk, FontStyle.Bold);
                Stretch(tab.Label.rectTransform, 2f);
                // Самая длинная подпись вкладки — со счётчиком выбранного.
                tab.Label.text = PageTitles[i] + (i >= 2 ? " 2/2" : string.Empty);
                labelWidth = Mathf.Max(labelWidth, tab.Label.preferredWidth);
                _tabs.Add(tab);
                _bodyObjects.Add(go);
            }

            _title.text = CreatorTitle;
            float titleWidth = Mathf.Ceil(_title.preferredWidth) + 20f;
            float room = _layout.Card.x - 2f * pad;
            bool showTitle = (room - titleWidth - gap * (PageIds.Length - 1)) / PageIds.Length >= labelWidth + 16f;
            _title.gameObject.SetActive(showTitle);
            if (showTitle) PlaceTop(_title.rectTransform, pad, 12f, titleWidth, height);
            float left = pad + (showTitle ? titleWidth : 0f);
            float tabWidth = (_layout.Card.x - pad - left - gap * (PageIds.Length - 1)) / PageIds.Length;
            for (int i = 0; i < _tabs.Count; i++)
                PlaceTop((RectTransform)_tabs[i].Back.transform, left + i * (tabWidth + gap), 12f, tabWidth, height);
            ApplyCreatorTab();
        }

        private void SelectCreatorTab(int index)
        {
            _creatorTab = Mathf.Clamp(index, 0, PageIds.Length - 1);
            ApplyCreatorTab();
        }

        private void ApplyCreatorTab()
        {
            if (!_layout.Compact) return; // на ПК все четыре блока видны сразу
            for (int i = 0; i < _pages.Count; i++)
                if (_pages[i] != null) _pages[i].gameObject.SetActive(i == _creatorTab);
            for (int i = 0; i < _tabs.Count; i++)
            {
                bool selected = i == _creatorTab;
                _tabs[i].Back.color = selected ? TabSelectedBg : ButtonBg;
                _tabs[i].Border.effectColor = selected ? TabSelectedBorder : TabBorder;
                _tabs[i].Label.color = selected ? Title : ButtonInk;
            }
        }

        // --- .char-actions: подсказка готовности и две кнопки, всегда на виду ---
        private void BuildCreatorActions(RectTransform panel, float width, float top, float height)
        {
            float buttonHeight = U(_layout.Compact ? 36f : 38f);
            float buttonTop = top + (height - buttonHeight) * 0.5f;
            float createWidth = U(190f);
            float backWidth = U(110f);
            float gap = 10f;
            _createButton = ActionButton(panel, "СОЗДАТЬ И НАЧАТЬ", 0f, buttonTop, createWidth, false, () => Bootstrap.CreatorSubmit());
            _createButton.name = "CreateCharacter";
            SizeButton(_createButton, createWidth, buttonHeight);
            Button back = ActionButton(panel, "НАЗАД", createWidth + gap, buttonTop, backWidth, true, () => Bootstrap.CreatorCancel());
            back.name = "CreatorBack";
            SizeButton(back, backWidth, buttonHeight);

            _readiness = Label("Readiness", panel, Fs(12f), TextAnchor.MiddleLeft, SmallNote);
            _readiness.horizontalOverflow = HorizontalWrapMode.Wrap;
            PlaceTop(_readiness.rectTransform, 0f, top, width - createWidth - backWidth - gap * 3f, height);
        }

        private void SizeButton(Button button, float width, float height)
        {
            ((RectTransform)button.transform).sizeDelta = new Vector2(width, height);
            button.GetComponentInChildren<Text>().fontSize = Fs(13f);
        }

        // --- .character-appearance-editor: превью, пять степперов и примечание ---
        private void BuildAppearancePage(RectTransform page, float width, float height)
        {
            bool compact = _layout.Compact;
            string[] titles = { "Пол", "Телосложение", "Лицо", "Причёска", "Цвет волос" };
            string[] keys = { "sex", "body", "face", "hair", "hairColor" };
            float rowHeight = U(compact ? 40f : 36f);
            float rowGap = U(6f);
            float steppersHeight = keys.Length * (rowHeight + rowGap) - rowGap;

            // На телефоне превью стоит слева во всю высоту вкладки, а справа
            // прокручиваются степперы. На ПК превью — верх той же колонки.
            RectTransform shell;
            RectTransform controls;
            float controlsWidth;
            float controlsRoom;
            if (compact)
            {
                float previewWidth = Mathf.Round(width * 0.36f);
                shell = Child("PreviewShell", page);
                PlaceTop(shell, 0f, 0f, previewWidth, height);
                controlsWidth = width - previewWidth - 12f;
                controlsRoom = height;
                controls = ScrollColumn(page, previewWidth + 12f, 0f, controlsWidth, controlsRoom);
            }
            else
            {
                DecorateBlock(page);
                BlockTitle(page, "Внешность", null);
                float top = U(32f);
                controlsWidth = width - 24f;
                controlsRoom = height - top - 10f;
                controls = ScrollColumn(page, 12f, top, controlsWidth, controlsRoom);
                shell = Child("PreviewShell", controls);
            }
            controls.name = "Controls";

            Text note = Label("Note", controls, Fs(12f), TextAnchor.UpperLeft, MetaInk);
            note.horizontalOverflow = HorizontalWrapMode.Wrap;
            note.text = "Новый персонаж начинает игру в нижнем белье и без надетых предметов. Одежда, броня, обувь, головные уборы, рюкзаки и оружие отображаются только после экипировки.";
            float noteHeight = WrappedHeight(note, controlsWidth - 10f);

            float steppersTop = 0f;
            if (!compact)
            {
                // Превью забирает всё, что осталось от степперов и примечания.
                float previewHeight = Mathf.Max(U(150f), controlsRoom - steppersHeight - noteHeight - 16f);
                PlaceTop(shell, 0f, 0f, controlsWidth, previewHeight);
                steppersTop = previewHeight + 8f;
            }
            float noteTop = steppersTop + steppersHeight + 8f;
            PlaceTop(note.rectTransform, 10f, noteTop, controlsWidth - 10f, noteHeight);
            RectTransform noteBar = Child("NoteBar", controls);
            PlaceTop(noteBar, 0f, noteTop, 2f, noteHeight);
            noteBar.gameObject.AddComponent<Image>().color = NoteGreen;
            controls.sizeDelta = new Vector2(0f, noteTop + noteHeight);

            for (int i = 0; i < keys.Length; i++)
                BuildStepper(controls, keys[i], titles[i], steppersTop + i * (rowHeight + rowGap), controlsWidth, rowHeight);

            shell.gameObject.AddComponent<Image>().color = new Color(0.051f, 0.063f, 0.055f, 0.98f);
            Outline shellOutline = shell.gameObject.AddComponent<Outline>();
            shellOutline.effectColor = new Color(0.682f, 0.545f, 0.282f, 0.48f);
            shellOutline.effectDistance = new Vector2(1f, -1f);

            RectTransform previewRect = Child("Preview", shell);
            Stretch(previewRect, 1f);
            _previewImage = previewRect.gameObject.AddComponent<RawImage>();
            _previewImage.color = Color.white;
            _previewImage.raycastTarget = true;
            var pointer = previewRect.gameObject.AddComponent<PreviewPointer>();
            pointer.Owner = this;

            RectTransform caption = Child("Caption", shell);
            Place(caption, 0f, 0f, 1f, 0f, new Vector2(8f, 8f), new Vector2(-8f, 8f + U(28f)));
            caption.gameObject.AddComponent<Image>().color = new Color(0.024f, 0.031f, 0.031f, 0.82f);
            Outline captionOutline = caption.gameObject.AddComponent<Outline>();
            captionOutline.effectColor = new Color(0.682f, 0.545f, 0.282f, 0.36f);
            captionOutline.effectDistance = new Vector2(1f, -1f);
            Text captionLabel = Label("Label", caption, Fs(12f), TextAnchor.MiddleLeft, StatusInk);
            captionLabel.text = "БАЗОВАЯ МОДЕЛЬ";
            Place(captionLabel.rectTransform, 0f, 0f, 0.5f, 1f, new Vector2(10f, 0f), Vector2.zero);
            _previewSummary = Label("Summary", caption, Fs(12f), TextAnchor.MiddleRight, Title, FontStyle.Bold);
            Place(_previewSummary.rectTransform, 0.4f, 0f, 1f, 1f, Vector2.zero, new Vector2(-10f, 0f));
            _previewStatus = Label("Status", shell, Fs(12f), TextAnchor.UpperLeft, MetaInk);
            Place(_previewStatus.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -10f - U(20f)), new Vector2(-10f, -10f));
        }

        /// <summary>.character-appearance-stepper: [<] ПОДПИСЬ … значение [>] в одну строку.</summary>
        private void BuildStepper(RectTransform parent, string key, string title, float top, float width, float height)
        {
            RectTransform row = Child("Stepper-" + key, parent);
            PlaceTop(row, 0f, top, width, height);
            row.gameObject.AddComponent<Image>().color = StepperBg;
            Outline outline = row.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.537f, 0.439f, 0.263f, 0.55f);
            outline.effectDistance = new Vector2(1f, -1f);

            float arrow = StepperArrowWidth;
            StepperArrow(row, "<", 0f, arrow, () => CycleAppearance(key, -1)).name = "Prev-" + key;
            StepperArrow(row, ">", 1f, arrow, () => CycleAppearance(key, 1)).name = "Next-" + key;

            // Подпись занимает свою ширину, значение — всё остальное: проба сверяет
            // самое длинное значение с этим остатком, так что они не наезжают.
            Text caption = Label("Caption", row, Fs(12f), TextAnchor.MiddleLeft, PanelTitle, FontStyle.Bold);
            caption.text = title.ToUpperInvariant();
            float captionWidth = Mathf.Ceil(caption.preferredWidth) + 2f;
            Place(caption.rectTransform, 0f, 0f, 0f, 1f, new Vector2(arrow + 10f, 0f), new Vector2(arrow + 10f + captionWidth, 0f));

            float swatch = key == "hairColor" ? U(20f) : 0f;
            Text value = Label("Value", row, Fs(12f), TextAnchor.MiddleRight, Title, FontStyle.Bold);
            Place(value.rectTransform, 0f, 0f, 1f, 1f,
                new Vector2(arrow + 10f + captionWidth + 10f + (swatch > 0f ? swatch + U(6f) : 0f), 0f), new Vector2(-arrow - 10f, 0f));
            _stepperValues[key] = value;
            if (swatch <= 0f) return;

            RectTransform swatchRect = Child("Swatch", row);
            swatchRect.anchorMin = swatchRect.anchorMax = new Vector2(1f, 0.5f);
            swatchRect.pivot = new Vector2(1f, 0.5f);
            swatchRect.sizeDelta = new Vector2(swatch, swatch);
            _hairSwatch = swatchRect.gameObject.AddComponent<Image>();
            _hairSwatch.sprite = RadialSprite();
            _hairSwatch.raycastTarget = false;
        }

        private Button StepperArrow(RectTransform row, string glyph, float side, float width, System.Action onClick)
        {
            var go = new GameObject("Arrow", typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(row, false);
            rect.anchorMin = new Vector2(side, 0f);
            rect.anchorMax = new Vector2(side, 1f);
            rect.pivot = new Vector2(side, 0.5f);
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = new Vector2(width, 0f);
            var image = go.AddComponent<Image>();
            image.color = ButtonBg;
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            Text label = Label("Label", rect, Fs(19f), TextAnchor.MiddleCenter, ButtonInk, FontStyle.Bold);
            Stretch(label.rectTransform, 0f);
            label.text = glyph;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        private void CycleAppearance(string key, int offset)
        {
            RoaCharacterCreator c = Bootstrap.Creator;
            switch (key)
            {
                case "sex": c.CycleSex(offset); break;
                case "body": c.CycleBody(offset); break;
                case "face": c.CycleFace(offset); break;
                case "hair": c.CycleHair(offset); break;
                default: c.CycleHairColor(offset); break;
            }
            RefreshCreatorTexts();
        }

        // --- Имя, характеристики и производные параметры ---
        private void BuildParamsPage(RectTransform page, float width, float height)
        {
            bool compact = _layout.Compact;
            RectTransform content = ScrollColumn(page, 0f, 0f, width, height);
            RectTransform nameBlock = Child("NameBlock", content);
            RectTransform derivedBlock = Child("DerivedBlock", content);
            DecorateBlock(nameBlock);
            DecorateBlock(derivedBlock);

            float inputHeight = U(36f);
            float pointsHeight = U(22f);
            _statPitch = U(compact ? 41f : 30f);
            _statRow = U(compact ? 37f : 24f);
            float statsHeight = RoaCharacterCreator.Stats.Length * _statPitch - (_statPitch - _statRow);

            if (compact)
            {
                // Слева семь характеристик, справа имя, свободные очки и производные в два столбца.
                float half = Mathf.Floor((width - 12f) * 0.5f);
                float rightWidth = width - half - 12f;
                _statsBox = Child("Stats", nameBlock);
                PlaceTop(_statsBox, 12f, 10f, half - 24f, statsHeight);

                NameInput(derivedBlock, 12f, 10f, rightWidth - 24f, inputHeight);
                float top = 10f + inputHeight + U(6f);
                _pointsLeft = Label("Points", derivedBlock, Fs(12f), TextAnchor.MiddleLeft, StatusOk);
                PlaceTop(_pointsLeft.rectTransform, 12f, top, rightWidth - 24f, pointsHeight);
                top += pointsHeight + U(4f);
                float derivedHeight = DerivedColumns(derivedBlock, 12f, top, rightWidth - 24f, 2, 1.2f);

                float needed = Mathf.Max(10f + statsHeight + 10f, top + derivedHeight + 10f);
                float blockHeight = Mathf.Max(height, needed);
                PlaceTop(nameBlock, 0f, 0f, half, blockHeight);
                PlaceTop(derivedBlock, half + 12f, 0f, rightWidth, blockHeight);
                content.sizeDelta = new Vector2(0f, blockHeight);
                return;
            }

            BlockTitle(nameBlock, "Имя и характеристики", null);
            float y = U(32f);
            NameInput(nameBlock, 12f, y, width - 24f, inputHeight);
            y += inputHeight + U(10f);
            _statsBox = Child("Stats", nameBlock);
            PlaceTop(_statsBox, 12f, y, width - 24f, statsHeight);
            y += statsHeight + U(4f);
            _pointsLeft = Label("Points", nameBlock, Fs(12f), TextAnchor.MiddleLeft, StatusOk);
            PlaceTop(_pointsLeft.rectTransform, 12f, y, width - 24f, pointsHeight);
            float nameHeight = y + pointsHeight + 8f;
            PlaceTop(nameBlock, 0f, 0f, width, nameHeight);

            BlockTitle(derivedBlock, "Производные параметры", null);
            float derivedNeeded = U(32f) + DerivedColumns(derivedBlock, 12f, U(32f), width - 24f, 1, 1.3f) + 8f;
            float derivedTop = nameHeight + 12f;
            PlaceTop(derivedBlock, 0f, derivedTop, width, Mathf.Max(height - derivedTop, derivedNeeded));
            content.sizeDelta = new Vector2(0f, derivedTop + Mathf.Max(height - derivedTop, derivedNeeded));
        }

        private void NameInput(RectTransform parent, float left, float top, float width, float height)
        {
            RectTransform rect = Child("Input", parent);
            PlaceTop(rect, left, top, width, height);
            InputField field = InputBox(rect, Fs(14f), "Имя персонажа", Bootstrap.NewCharacterName, false, v => Bootstrap.NewCharacterName = v);
            field.characterLimit = 18;
        }

        /// <summary>
        /// Подписи производных параметров: один столбец на ПК, два на телефоне. Высоту
        /// даёт сам Text по строкам-заглушкам — настоящие строки приходят позже, в
        /// RebuildCreatorDynamic, а блок нужно разметить уже сейчас.
        /// </summary>
        private float DerivedColumns(RectTransform block, float left, float top, float width, int columns, float lineSpacing)
        {
            string[] widest = DerivedRows(WidestDerived);
            float height = 0f;
            for (int i = 0; i < columns; i++)
            {
                Text text = Label("Derived", block, Fs(12f), TextAnchor.UpperLeft, DerivedInk);
                text.lineSpacing = lineSpacing;
                text.supportRichText = true;
                _derivedTexts.Add(text);
                if (i > 0) continue;
                // Второй столбец — только если в половину ширины влезает самая длинная строка.
                text.text = string.Join("\n", widest);
                if (columns > 1 && text.preferredWidth + 2f > (width - 12f) / columns) columns = 1;
            }
            int perColumn = Mathf.CeilToInt(widest.Length / (float)columns);
            float columnWidth = (width - 12f * (columns - 1)) / columns;
            for (int i = 0; i < columns; i++)
            {
                _derivedTexts[i].text = string.Join("\n", widest, i * perColumn, Mathf.Min(perColumn, widest.Length - i * perColumn));
                height = Mathf.Max(height, Mathf.Ceil(_derivedTexts[i].preferredHeight) + 2f);
            }
            for (int i = 0; i < columns; i++)
                PlaceTop(_derivedTexts[i].rectTransform, left + i * (columnWidth + 12f), top, columnWidth, height);
            return height;
        }

        /// <summary>Самые длинные значения производных: по ним размечается блок, пока настоящих ещё нет.</summary>
        private static readonly RoaCharacterCreator.DerivedStats WidestDerived = new RoaCharacterCreator.DerivedStats
        {
            MaxHp = 999, MaxAp = 99, Speed = 9.9f, Carry = 999, Hit = -99, CriticalChance = 10, VisionRadius = 16,
            ResistAll = 99, Sell = -99, GatherBonus = -99, LuckChecks = 99
        };

        // --- Навыки и перки: пояснение и прокручиваемый список карточек ---
        private RectTransform BuildChoicePage(RectTransform page, float width, float height, string blockName,
                                              string caption, string hint, out Text count)
        {
            bool compact = _layout.Compact;
            RectTransform block = Child(blockName, page);
            Stretch(block, 0f);
            float inset = compact ? 0f : 12f;
            float top = 0f;
            count = null; // на телефоне счётчик выбранного живёт в подписи вкладки
            if (!compact)
            {
                DecorateBlock(block);
                count = BlockTitle(block, caption, "0/2");
                top = U(32f);
            }
            Text note = Label("Note", block, Fs(12f), TextAnchor.UpperLeft, SmallNote);
            note.horizontalOverflow = HorizontalWrapMode.Wrap;
            note.text = hint;
            float noteHeight = WrappedHeight(note, width - inset * 2f);
            PlaceTop(note.rectTransform, inset, top, width - inset * 2f, noteHeight);
            top += noteHeight + 6f;
            return ScrollColumn(block, inset, top, width - inset - (compact ? 0f : 8f), height - top - (compact ? 0f : 10f));
        }

        private static void DecorateBlock(RectTransform block)
        {
            block.gameObject.AddComponent<Image>().color = BlockBg;
            Outline outline = block.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1f, -1f);
        }

        private Text BlockTitle(RectTransform block, string caption, string small)
        {
            Text h3 = Label("H3", block, Fs(12f), TextAnchor.MiddleLeft, PanelTitle, FontStyle.Bold);
            h3.text = caption.ToUpperInvariant();
            Place(h3.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -8f - U(20f)), new Vector2(-12f, -8f));
            if (small == null) return null;
            Text smallText = Label("Small", block, Fs(12f), TextAnchor.MiddleRight, MetaInk);
            smallText.text = small;
            Place(smallText.rectTransform, 1f, 1f, 1f, 1f, new Vector2(-12f - U(40f), -8f - U(20f)), new Vector2(-12f, -8f));
            h3.rectTransform.offsetMax = new Vector2(-12f - U(40f), -8f);
            return smallText;
        }

        /// <summary>
        /// Область с вертикальной прокруткой без LayoutGroup: детей расставляет
        /// вызывающий, он же задаёт высоту содержимого. Пока содержимое ниже области,
        /// прокрутки нет — так блок переживает и низкое окно, и крупный кегль.
        /// </summary>
        private RectTransform ScrollColumn(RectTransform parent, float left, float top, float width, float height)
        {
            RectTransform area = Child("Scroll", parent);
            PlaceTop(area, left, top, width, height);
            var scroll = area.gameObject.AddComponent<ScrollRect>();
            RoaUiScroll.Configure(scroll);
            scroll.scrollSensitivity = U(24f);
            // Рамка Outline рисуется на единицу шире своего прямоугольника: маска её не режет.
            area.gameObject.AddComponent<RectMask2D>().padding = new Vector4(-2f, -2f, -2f, -2f);
            RectTransform content = Child("List", area);
            content.anchorMin = new Vector2(0f, 1f);
            content.anchorMax = new Vector2(1f, 1f);
            content.pivot = new Vector2(0f, 1f);
            content.anchoredPosition = Vector2.zero;
            content.sizeDelta = Vector2.zero;
            scroll.content = content;
            return content;
        }

        /// <summary>Статы, навыки и перки пересоздаются при изменении выбора (как renderCharacterCreator).</summary>
        private void RebuildCreatorDynamic()
        {
            foreach (GameObject go in _dynamicObjects) Discard(go);
            _dynamicObjects.Clear();
            // Высоту подписи меряет сам Text, а ему нужен активный путь до канвы.
            foreach (RectTransform page in _pages) page.gameObject.SetActive(true);
            RoaCharacterCreator c = Bootstrap.Creator;
            int points = c.PointsLeft;
            bool compact = _layout.Compact;

            // .char-stat-row: код | имя | значение | − | +
            float buttonWidth = U(compact ? 42f : 24f);
            float buttonHeight = compact ? _statRow : U(24f);
            float valueWidth = U(28f);
            float buttonsWidth = buttonWidth * 2f + 4f;
            int index = 0;
            foreach (RoaCharacterCreator.StatDef stat in RoaCharacterCreator.Stats)
            {
                RectTransform row = Child("Stat-" + stat.Id, _statsBox);
                float top = index * _statPitch;
                Place(row, 0f, 1f, 1f, 1f, new Vector2(0f, -top - _statRow), new Vector2(0f, -top));
                _dynamicObjects.Add(row.gameObject);
                Text code = Label("Code", row, Fs(12f), TextAnchor.MiddleLeft, Title, FontStyle.Bold);
                code.text = stat.Code;
                Place(code.rectTransform, 0f, 0f, 0f, 1f, Vector2.zero, new Vector2(U(34f), 0f));
                Text name = Label("Name", row, Fs(12f), TextAnchor.MiddleLeft, StatName);
                name.text = stat.Name;
                Place(name.rectTransform, 0f, 0f, 1f, 1f, new Vector2(U(40f), 0f), new Vector2(-buttonsWidth - 8f - valueWidth - 4f, 0f));
                Text value = Label("Value", row, Fs(12f), TextAnchor.MiddleCenter, StatVal, FontStyle.Bold);
                value.text = c.Stat(stat.Id).ToString();
                Place(value.rectTransform, 1f, 0f, 1f, 1f, new Vector2(-buttonsWidth - 8f - valueWidth, 0f), new Vector2(-buttonsWidth - 8f, 0f));
                string id = stat.Id;
                StatButton(row, "-", buttonWidth + 4f, buttonWidth, buttonHeight, c.Stat(id) > RoaCharacterCreator.SpecialMin, () => c.AdjustStat(id, -1)).name = "Stat-" + id + "-minus";
                StatButton(row, "+", 0f, buttonWidth, buttonHeight, c.Stat(id) < RoaCharacterCreator.SpecialMax && points > 0, () => c.AdjustStat(id, 1)).name = "Stat-" + id + "-plus";
                index++;
            }
            _pointsLeft.text = "Свободные очки: " + points;

            var cards = new List<RectTransform>();
            int skillColumns = compact ? 3 : 1;
            float skillWidth = CardWidth(_skillsList, skillColumns, U(6f));
            foreach (RoaProgressionData.SkillDef skill in RoaProgressionData.Skills)
            {
                bool selected = c.HasSkill(skill.Id);
                string id = skill.Id;
                string desc = skill.Group + " · база " + c.SkillBasePercent(id, false) + "% -> " + c.SkillBasePercent(id, true) + "%";
                cards.Add(AddTraitCard(_skillsList, "Skill-" + id, skill.Name, desc, selected, skillWidth, () => c.ToggleSkill(id)));
            }
            FlowCards(_skillsList, cards, skillColumns, skillWidth, U(6f));
            string skills = c.SelectedSkillCount + "/" + RoaCharacterCreator.MaxTaggedSkills;
            if (_skillCount != null) _skillCount.text = skills;

            cards.Clear();
            int traitColumns = compact ? (_traitsList.rect.width >= U(720f) ? 3 : 2) : 1;
            float traitWidth = CardWidth(_traitsList, traitColumns, U(7f));
            foreach (RoaCharacterCreator.TraitDef trait in RoaCharacterCreator.Traits)
            {
                bool selected = c.HasTrait(trait.Id);
                string id = trait.Id;
                cards.Add(AddTraitCard(_traitsList, "Trait-" + id, trait.Name, trait.Description, selected, traitWidth, () => c.ToggleTrait(id)));
            }
            FlowCards(_traitsList, cards, traitColumns, traitWidth, U(7f));
            string traits = c.SelectedTraitCount + "/" + RoaCharacterCreator.MaxTraits;
            if (_traitCount != null) _traitCount.text = traits;
            if (_tabs.Count == PageIds.Length)
            {
                _tabs[2].Label.text = PageTitles[2] + " " + skills;
                _tabs[3].Label.text = PageTitles[3] + " " + traits;
            }

            string[] derived = DerivedRows(c.Derived());
            int perColumn = Mathf.CeilToInt(derived.Length / (float)Mathf.Max(1, _derivedTexts.Count));
            for (int i = 0; i < _derivedTexts.Count; i++)
            {
                int start = i * perColumn;
                _derivedTexts[i].text = string.Join("\n", derived, start, Mathf.Clamp(derived.Length - start, 0, perColumn));
            }

            ApplyCreatorTab();
            RefreshCreatorTexts();
        }

        private static string[] DerivedRows(RoaCharacterCreator.DerivedStats d)
        {
            return new[]
            {
                "ОЗ: <b>" + d.MaxHp + "</b>",
                "ОД: <b>" + d.MaxAp + "</b>",
                "Скорость: <b>" + d.Speed.ToString("0.0") + "</b>",
                "Переносимый вес: <b>" + d.Carry + "</b>",
                "Меткость: <b>" + Signed(d.Hit) + "%</b>",
                "Критический выстрел: <b>" + d.CriticalChance + "% (x2)</b>",
                "Обзор: <b>" + d.VisionRadius + " кл.</b>",
                "Сопротивление: <b>" + d.ResistAll + "%</b>",
                "Продажа: <b>" + Signed(d.Sell) + "%</b>",
                "Доп. ресурс при сборе: <b>" + Signed(d.GatherBonus) + " п.п.</b>",
                "Проверки удачи: <b>+" + d.LuckChecks + " п.п.</b>"
            };
        }

        private static string Signed(int value) { return (value >= 0 ? "+" : "") + value; }

        private Button StatButton(RectTransform row, string glyph, float right, float width, float height,
                                  bool enabled, System.Action onClick)
        {
            var go = new GameObject("StatBtn", typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(row, false);
            rect.anchorMin = new Vector2(1f, 0.5f);
            rect.anchorMax = new Vector2(1f, 0.5f);
            rect.pivot = new Vector2(1f, 0.5f);
            rect.anchoredPosition = new Vector2(-right, 0f);
            rect.sizeDelta = new Vector2(width, height);
            var image = go.AddComponent<Image>();
            image.color = enabled ? ButtonBg : new Color(ButtonBg.r, ButtonBg.g, ButtonBg.b, 0.4f);
            Outline outline = go.AddComponent<Outline>();
            outline.effectColor = new Color(0.682f, 0.545f, 0.282f, enabled ? 0.55f : 0.25f);
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            button.interactable = enabled;
            Color ink = enabled ? ButtonInk : new Color(ButtonInk.r, ButtonInk.g, ButtonInk.b, 0.4f);
            Text label = Label("Label", rect, Fs(14f), TextAnchor.MiddleCenter, ink, FontStyle.Bold);
            Stretch(label.rectTransform, 0f);
            label.text = glyph;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        private static float CardWidth(RectTransform list, int columns, float gap)
        {
            return Mathf.Floor((list.rect.width - gap * (columns - 1)) / columns);
        }

        /// <summary>
        /// Расставляет карточки по колонкам без LayoutGroup: высоту каждой уже дал её
        /// текст, ряд выравнивается по самой высокой, список получает высоту рядов.
        /// </summary>
        private static void FlowCards(RectTransform list, List<RectTransform> cards, int columns, float width, float gap)
        {
            float top = 0f;
            for (int start = 0; start < cards.Count; start += columns)
            {
                int end = Mathf.Min(start + columns, cards.Count);
                float rowHeight = 0f;
                for (int i = start; i < end; i++) rowHeight = Mathf.Max(rowHeight, cards[i].sizeDelta.y);
                for (int i = start; i < end; i++)
                    PlaceTop(cards[i], (i - start) * (width + gap), top, width, rowHeight);
                top += rowHeight + gap;
            }
            list.sizeDelta = new Vector2(0f, Mathf.Max(0f, top - gap));
        }

        /// <summary>
        /// .trait-card: заголовок + описание, выбранная — зелёная рамка. Высоту карточке
        /// даёт её текст: описание перка пишут в каталоге сервера, далеко от этого кода,
        /// а у подписи VerticalWrapMode.Overflow — лишняя строка не обрезалась, а
        /// вылезала на соседнюю карточку.
        /// </summary>
        private RectTransform AddTraitCard(RectTransform list, string name, string title, string desc, bool selected,
                                           float width, System.Action onClick)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(list, false);
            PlaceTop(rect, 0f, 0f, width, 10f);
            var image = go.AddComponent<Image>();
            image.color = CardBgDim;
            Outline outline = go.AddComponent<Outline>();
            outline.effectColor = selected ? CardSelected : new Color(0.341f, 0.322f, 0.235f, 0.55f);
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => onClick());

            float padX = U(8f);
            float padTop = U(5f);
            Text titleText = Label("Title", rect, Fs(13f), TextAnchor.UpperLeft, CardTitle, FontStyle.Bold);
            titleText.text = title;
            PlaceTop(titleText.rectTransform, padX, padTop, width - padX * 2f, 10f);
            float titleHeight = Mathf.Ceil(titleText.preferredHeight);
            PlaceTop(titleText.rectTransform, padX, padTop, width - padX * 2f, titleHeight);
            Text descText = Label("Desc", rect, Fs(12f), TextAnchor.UpperLeft, CardDesc);
            descText.horizontalOverflow = HorizontalWrapMode.Wrap;
            descText.text = desc;
            float descHeight = WrappedHeight(descText, width - padX * 2f);
            PlaceTop(descText.rectTransform, padX, padTop + titleHeight, width - padX * 2f, descHeight);
            rect.sizeDelta = new Vector2(width, Mathf.Max(U(44f), padTop + titleHeight + descHeight + U(6f)));
            _dynamicObjects.Add(go);
            return rect;
        }

        private void RefreshCreatorTexts()
        {
            if (_stepperValues.Count == 0 || Bootstrap == null || _readiness == null) return;
            RoaCharacterCreator c = Bootstrap.Creator;
            _stepperValues["sex"].text = c.SexLabelText;
            _stepperValues["body"].text = c.BodyLabelText;
            _stepperValues["face"].text = c.FaceLabelText;
            _stepperValues["hair"].text = c.HairLabelText;
            _stepperValues["hairColor"].text = c.HairColorLabelText;
            if (_hairSwatch != null)
            {
                // Образец цвета стоит вплотную слева от названия, какой бы длины оно ни было.
                _hairSwatch.color = RoaCharacterCreator.HairColorSwatch(c.Appearance.HairColorId);
                float valueWidth = _stepperValues["hairColor"].preferredWidth;
                _hairSwatch.rectTransform.anchoredPosition = new Vector2(-StepperArrowWidth - 10f - valueWidth - U(6f), 0f);
            }
            _previewSummary.text = c.SexLabelText + " · " + c.BodyLabelText;

            string hint = c.ReadinessHint(Bootstrap.NewCharacterName);
            bool ready = c.Ready(Bootstrap.NewCharacterName) && !Bootstrap.CreatorBusy;
            string notice = c.Notice;
            // На телефоне строке готовности достаётся одна-две строки рядом с кнопками.
            string idle = _layout.Compact
                ? "Персонаж готов. Прогресс, карта и инвентарь хранятся на сервере."
                : "Распределите характеристики и обязательно выберите профильный навык и стартовый перк. Прогресс, карта, инвентарь и хранилище привязаны к серверному персонажу.";
            _readiness.text = !string.IsNullOrEmpty(notice) ? notice
                : Bootstrap.CreatorBusy ? Bootstrap.StatusText
                : string.IsNullOrEmpty(hint) ? idle : hint;
            _readiness.color = !string.IsNullOrEmpty(notice) ? StatusErr : SmallNote;
            _createButton.interactable = ready;
            _createButton.GetComponent<Image>().color = ready ? ButtonBg : new Color(ButtonBg.r, ButtonBg.g, ButtonBg.b, 0.4f);
        }

        private void RefreshPreview()
        {
            RoaCharacterPreview preview = Bootstrap.CharacterPreview;
            if (preview == null || _previewImage == null) return;
            var rect = (RectTransform)_previewImage.transform;
            preview.Show(Bootstrap.AuthServerUrl, Bootstrap.Creator.Appearance,
                Mathf.Max(64, Mathf.RoundToInt(rect.rect.width)), Mathf.Max(64, Mathf.RoundToInt(rect.rect.height)));
            if (_previewImage.texture != preview.Texture) _previewImage.texture = preview.Texture;
            _previewImage.enabled = preview.Texture != null;
            _previewStatus.text = preview.StatusText ?? string.Empty;
        }

        /// <summary>Наведение на превью поворачивает модель, как mousemove по canvas в web.</summary>
        private sealed class PreviewPointer : MonoBehaviour, IPointerMoveHandler, IPointerExitHandler
        {
            public RoaAuthCanvas Owner;

            public void OnPointerMove(PointerEventData eventData)
            {
                var rect = (RectTransform)transform;
                if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(rect, eventData.position, eventData.pressEventCamera, out Vector2 local)) return;
                float normalized = Mathf.Clamp(local.x / Mathf.Max(1f, rect.rect.width * 0.5f), -1f, 1f);
                if (Owner != null && Owner.Bootstrap != null && Owner.Bootstrap.CharacterPreview != null)
                    Owner.Bootstrap.CharacterPreview.SetPointer(normalized, true);
            }

            public void OnPointerExit(PointerEventData eventData)
            {
                if (Owner != null && Owner.Bootstrap != null && Owner.Bootstrap.CharacterPreview != null)
                    Owner.Bootstrap.CharacterPreview.SetPointer(0f, false);
            }
        }

        // --- Подтверждение удаления ------------------------------------------

        private void OpenConfirm(CharacterSummary character)
        {
            CloseConfirm();
            _deleteCandidate = character;

            _confirm = new GameObject("ConfirmPanel", typeof(RectTransform));
            var dim = (RectTransform)_confirm.transform;
            dim.SetParent(_root.transform, false);
            Stretch(dim, 0f);
            _confirm.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0.55f);

            // Окно собирается сверху вниз, как панель шага: высоту ему дают его подписи.
            RectTransform box = Child("Box", dim);
            box.anchorMin = box.anchorMax = new Vector2(0.5f, 0.5f);
            float width = Mathf.Min(U(460f), _layout.Card.x);
            box.sizeDelta = new Vector2(width, 0f);
            box.gameObject.AddComponent<Image>().color = CardBg;
            var outline = box.gameObject.AddComponent<Outline>();
            outline.effectColor = CardBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            float pad = U(16f);
            float inner = width - pad * 2f;
            Text kicker = Label("Kicker", box, Fs(11f), TextAnchor.UpperLeft, PanelTitle, FontStyle.Bold);
            kicker.text = "УДАЛЕНИЕ ПЕРСОНАЖА";
            float top = FlowText(kicker, pad, U(14f), inner);
            Text title = Label("Title", box, Fs(18f), TextAnchor.UpperLeft, Title, FontStyle.Bold);
            title.horizontalOverflow = HorizontalWrapMode.Wrap;
            title.text = "Удалить персонажа навсегда?";
            top = FlowText(title, pad, top + U(4f), inner);
            Text body = Label("Body", box, Fs(12f), TextAnchor.UpperLeft, InputInk);
            body.horizontalOverflow = HorizontalWrapMode.Wrap;
            body.text = (string.IsNullOrEmpty(character.Name) ? "Без имени" : character.Name)
                + ". Уровень " + Mathf.Max(1, character.Level)
                + ". Всё серверное сохранение этого персонажа будет удалено.";
            top = FlowText(body, pad, top + U(6f), inner);
            Text note = Label("Note", box, Fs(11f), TextAnchor.UpperLeft, StatusErr);
            note.horizontalOverflow = HorizontalWrapMode.Wrap;
            note.text = "Действие необратимо. Инвентарь, прогресс, карта и задания восстановить нельзя.";
            top = FlowText(note, pad, top + U(4f), inner);

            Button confirm = ActionButton(box, "ConfirmDelete", "Удалить", false, () =>
            {
                string id = _deleteCandidate?.CharacterId;
                CloseConfirm();
                Bootstrap.AuthDeleteCharacter(id);
            }, 120f);
            confirm.GetComponent<Image>().color = DeleteBg;
            confirm.GetComponentInChildren<Text>().color = DeleteInk;
            Button cancel = ActionButton(box, "CancelDelete", "Оставить", true, CloseConfirm, 120f);
            top = ButtonRow(top + U(16f), pad, width, confirm, cancel);
            box.sizeDelta = new Vector2(width, top + pad);
        }

        private void CloseConfirm()
        {
            _deleteCandidate = null;
            Discard(_confirm);
            _confirm = null;
        }

        // --- Обновление текста ------------------------------------------------

        private void RefreshTexts(string step)
        {
            HeaderTexts(step);
            if (step == "creator") RefreshCreatorTexts();
            if (_status != null) ShowStatus();
        }

        /// <summary>Заголовок и пояснение зависят только от шага: по ним ApplyFrame размечает шапку.</summary>
        private void HeaderTexts(string step)
        {
            bool select = step == "select";
            bool creator = step == "creator";
            _title.text = creator ? CreatorTitle : "КРОМКА · "
                + (select ? "ВЫБОР ПЕРСОНАЖА" : (step == "connecting" ? "ПОДКЛЮЧЕНИЕ" : "ВХОД В ИГРУ"));
            _subtitle.text = creator
                ? "Соберите внешность, распределите характеристики и выберите профильный навык и стартовый перк. Персонаж хранится на сервере."
                : select
                ? "Выберите персонажа, чтобы войти в мир, или создайте нового. Прогресс, карта, инвентарь и хранилище привязаны к серверному аккаунту."
                : "Войдите в серверный аккаунт, чтобы выбрать уже созданного персонажа или создать нового. Прогресс, карта, инвентарь и хранилище привязаны к серверному аккаунту.";
            _note.text = select || creator ? "Сервер: " + Bootstrap.AuthLogin : "Сервер: " + Bootstrap.AuthServerUrl;
        }

        private void Submit(string step)
        {
            if (_confirm != null) return;
            if (_inputs.Count == 0) return;
            bool focused = false;
            foreach (InputField field in _inputs) if (field.isFocused) focused = true;
            if (!focused) return;
            switch (step)
            {
                case "register": Bootstrap.AuthSubmitRegister(); break;
                case "reset": Bootstrap.AuthSubmitResetRequest(); break;
                case "resetConfirm": Bootstrap.AuthSubmitResetConfirm(); break;
                case "login": Bootstrap.AuthSubmitLogin(); break;
                case "creator": break;
            }
        }

        private void FocusNextInput()
        {
            int current = -1;
            for (int i = 0; i < _inputs.Count; i++) if (_inputs[i].isFocused) current = i;
            InputField next = _inputs[(current + 1) % _inputs.Count];
            next.ActivateInputField();
            next.Select();
        }

        // --- Утилиты -----------------------------------------------------------

        private static Sprite _radial;

        private static Sprite RadialSprite()
        {
            if (_radial != null) return _radial;
            const int size = 128;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float dx = (x + 0.5f) / size - 0.5f;
                    float dy = (y + 0.5f) / size - 0.5f;
                    float d = Mathf.Sqrt(dx * dx + dy * dy) * 2f;
                    float a = Mathf.Clamp01(1f - d);
                    pixels[y * size + x] = new Color(1f, 1f, 1f, a * a);
                }
            texture.SetPixels(pixels);
            texture.Apply();
            _radial = Sprite.Create(texture, new Rect(0f, 0f, size, size), new Vector2(0.5f, 0.5f));
            return _radial;
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
    }
}
