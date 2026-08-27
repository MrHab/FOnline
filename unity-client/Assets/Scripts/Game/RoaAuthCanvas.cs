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

        private GameObject _root;
        private RectTransform _card;
        private Text _title;
        private Text _subtitle;
        private Text _note;
        private RectTransform _body;
        private readonly List<GameObject> _bodyObjects = new List<GameObject>();
        private string _builtStep = string.Empty;
        private int _builtCharacters = -1;
        private Text _status;
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
            int characters = Bootstrap.AuthCharacters.Count * 1000 + Bootstrap.AuthCatalogVersion;
            if (step != _builtStep || characters != _builtCharacters)
            {
                _builtStep = step;
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
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 60; // z-index 300 в web — выше всех игровых окон
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

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

            _title = Label("Title", _card, 26, TextAnchor.UpperLeft, Title, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(18f, -52f), new Vector2(-320f, -18f));
            _subtitle = Label("Subtitle", _card, 12, TextAnchor.UpperLeft, Subtitle);
            Place(_subtitle.rectTransform, 0f, 1f, 0f, 1f, new Vector2(18f, -92f), new Vector2(600f, -54f));
            _subtitle.horizontalOverflow = HorizontalWrapMode.Wrap;
            _note = Label("OnlineNote", _card, 11, TextAnchor.UpperRight, StatusInk);
            Place(_note.rectTransform, 1f, 1f, 1f, 1f, new Vector2(-320f, -40f), new Vector2(-18f, -20f));

            _body = Child("Body", _card);
            Place(_body, 0f, 0f, 1f, 1f, new Vector2(18f, 18f), new Vector2(-18f, -104f));
        }

        // ------------------------------------------------------------------

        private void RebuildBody(string step)
        {
            foreach (GameObject go in _bodyObjects) Destroy(go);
            _bodyObjects.Clear();
            _inputs.Clear();
            _status = null;
            CloseConfirm();

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
            if (_inputs.Count > 0) _inputs[0].ActivateInputField();
        }

        private RectTransform Panel(string name, float height)
        {
            // Карточка в web растёт по содержимому (max-height: 100vh-28px).
            _card.sizeDelta = new Vector2(1180f, Mathf.Min(122f + height, 1040f));
            RectTransform panel = Child(name, _body);
            Place(panel, 0f, 1f, 1f, 1f, new Vector2(0f, -height), new Vector2(0f, 0f));
            var image = panel.gameObject.AddComponent<Image>();
            image.color = PanelBg;
            var outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            _bodyObjects.Add(panel.gameObject);
            return panel;
        }

        private void PanelTitleRow(RectTransform panel, string caption, string small, out Text smallText)
        {
            PanelTitleRow(panel, caption, small, out smallText, 12f);
        }

        private void PanelTitleRow(RectTransform panel, string caption, string small, out Text smallText, float top)
        {
            Text title = Label("PanelTitle", panel, 12, TextAnchor.MiddleLeft, PanelTitle, FontStyle.Bold);
            title.text = caption.ToUpperInvariant();
            Place(title.rectTransform, 0f, 1f, 0.5f, 1f, new Vector2(12f, -top - 20f), new Vector2(0f, -top));
            smallText = Label("PanelSmall", panel, 11, TextAnchor.MiddleRight, PanelTitle);
            smallText.text = small;
            smallText.fontStyle = FontStyle.Normal;
            Place(smallText.rectTransform, 0.5f, 1f, 1f, 1f, new Vector2(0f, -top - 20f), new Vector2(-12f, -top));
        }

        /// <summary>Размещение от верхнего-левого угла: left/top — отступы, width/height — размер.</summary>
        private static void PlaceTop(RectTransform rect, float left, float top, float width, float height)
        {
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = new Vector2(left, -top);
            rect.sizeDelta = new Vector2(width, height);
        }

        private InputField TextInput(RectTransform panel, float top, string placeholder, string value,
                                 bool password, System.Action<string> onChanged)
        {
            RectTransform rect = Child("Input", panel);
            Place(rect, 0f, 1f, 0f, 1f, new Vector2(12f, -top - 36f), new Vector2(472f, -top));
            var back = rect.gameObject.AddComponent<Image>();
            back.color = InputBg;
            var outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.682f, 0.545f, 0.282f, 0.45f);
            outline.effectDistance = new Vector2(1f, -1f);

            var field = rect.gameObject.AddComponent<InputField>();
            Text text = Label("Text", rect, 14, TextAnchor.MiddleLeft, InputInk);
            Stretch(text.rectTransform, 10f);
            text.supportRichText = false;
            field.textComponent = text;
            Text hint = Label("Placeholder", rect, 14, TextAnchor.MiddleLeft, InputHint);
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
            rect.sizeDelta = new Vector2(width, 32f);
            var image = go.AddComponent<Image>();
            image.color = link ? new Color(0f, 0f, 0f, 0f) : ButtonBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = link ? new Color(0.682f, 0.545f, 0.282f, 0.35f) : new Color(0.682f, 0.545f, 0.282f, 0.55f);
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            Text label = Label("Label", rect, 13, TextAnchor.MiddleCenter, link ? LinkInk : ButtonInk);
            Stretch(label.rectTransform, 2f);
            label.text = caption;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        private void StatusLine(RectTransform panel, float top, string fallback)
        {
            _status = Label("Status", panel, 11, TextAnchor.UpperLeft, StatusInk);
            Place(_status.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -top - 36f), new Vector2(-12f, -top));
            _status.horizontalOverflow = HorizontalWrapMode.Wrap;
            _status.text = fallback;
            _statusFallback = fallback;
        }

        private string _statusFallback = string.Empty;

        // --- Шаги -----------------------------------------------------------

        private void BuildLogin()
        {
            RectTransform panel = Panel("LoginPanel", 346f);

            // .quick-start-panel web (01:680): кикер, «Сразу в пустошь», подпись и «Начать сразу».
            RectTransform quick = new GameObject("QuickStart", typeof(RectTransform)).GetComponent<RectTransform>();
            quick.SetParent(panel, false);
            quick.anchorMin = new Vector2(0f, 1f);
            quick.anchorMax = new Vector2(1f, 1f);
            quick.offsetMin = new Vector2(12f, -84f);
            quick.offsetMax = new Vector2(-12f, -8f);
            var quickBg = quick.gameObject.AddComponent<Image>();
            quickBg.color = new Color(0.18f, 0.15f, 0.08f, 1f);
            var quickBorder = quick.gameObject.AddComponent<Outline>();
            quickBorder.effectColor = new Color(0.78f, 0.604f, 0.275f, 0.78f);
            quickBorder.effectDistance = new Vector2(1f, -1f);
            Text kicker = Label("Kicker", quick, 9, TextAnchor.UpperLeft, new Color(0.851f, 0.678f, 0.345f, 1f), FontStyle.Bold);
            kicker.text = "БЫСТРЫЙ СТАРТ";
            PlaceTop(kicker.rectTransform, 14f, 10f, 200f, 12f);
            Text strong = Label("Title", quick, 16, TextAnchor.UpperLeft, new Color(0.949f, 0.824f, 0.529f, 1f), FontStyle.Bold);
            strong.text = "Сразу в пустошь";
            PlaceTop(strong.rectTransform, 14f, 24f, 200f, 20f);
            Text small = Label("Small", quick, 10, TextAnchor.UpperLeft, new Color(0.722f, 0.753f, 0.639f, 1f));
            small.text = "Готовый выживший, пистолет и сохранение прогресса на этом устройстве.";
            small.horizontalOverflow = HorizontalWrapMode.Wrap;
            PlaceTop(small.rectTransform, 14f, 46f, 330f, 28f);
            ActionButton(quick, "Начать сразу", 14f, 22f, 150f, false, () => Bootstrap.AuthQuickStart());

            Text divider = Label("Divider", panel, 10, TextAnchor.MiddleCenter, new Color(0.6f, 0.6f, 0.5f, 1f));
            divider.text = "— или войдите в постоянный аккаунт —";
            PlaceTop(divider.rectTransform, 12f, 92f, 560f, 14f);

            PanelTitleRow(panel, "Вход", "не выполнен вход", out _, 110f);
            TextInput(panel, 140f, "Логин", Bootstrap.AuthLogin, false, v => Bootstrap.AuthLogin = v);
            TextInput(panel, 184f, "Пароль", Bootstrap.AuthPassword, true, v => Bootstrap.AuthPassword = v);
            // Сервер — у web он задан адресом страницы; у Unity это поле формы.
            TextInput(panel, 228f, "Сервер (http://host:port)", Bootstrap.AuthServerUrl, false, v => Bootstrap.AuthServerUrl = v);

            ActionButton(panel, "Войти", 12f, 276f, 120f, false, () => Bootstrap.AuthSubmitLogin());
            ActionButton(panel, "Зарегистрироваться", 140f, 276f, 180f, true, () => Bootstrap.AuthShowPanel("register"));
            ActionButton(panel, "Забыли пароль?", 328f, 276f, 150f, true, () => Bootstrap.AuthShowPanel("reset"));
            StatusLine(panel, 310f, "Войдите, чтобы загрузить персонажей с сервера.");
        }

        private void BuildRegister()
        {
            RectTransform panel = Panel("RegisterPanel", 300f);
            PanelTitleRow(panel, "Регистрация", "новый аккаунт", out _);
            TextInput(panel, 44f, "Логин", Bootstrap.AuthLogin, false, v => Bootstrap.AuthLogin = v);
            TextInput(panel, 88f, "Email для восстановления пароля", Bootstrap.AuthEmail, false, v => Bootstrap.AuthEmail = v);
            TextInput(panel, 132f, "Пароль", Bootstrap.AuthPassword, true, v => Bootstrap.AuthPassword = v);
            TextInput(panel, 176f, "Повторите пароль", Bootstrap.AuthPasswordConfirm, true, v => Bootstrap.AuthPasswordConfirm = v);
            ActionButton(panel, "Создать аккаунт", 12f, 224f, 160f, false, () => Bootstrap.AuthSubmitRegister());
            ActionButton(panel, "Назад ко входу", 180f, 224f, 150f, true, () => Bootstrap.AuthShowPanel("login"));
            StatusLine(panel, 258f, "После регистрации откроется выбор персонажа.");
        }

        private void BuildReset()
        {
            RectTransform panel = Panel("ResetPanel", 210f);
            PanelTitleRow(panel, "Восстановление пароля", "код придёт на email", out _);
            TextInput(panel, 44f, "Email аккаунта", Bootstrap.AuthEmail, false, v => Bootstrap.AuthEmail = v);
            ActionButton(panel, "Отправить код", 12f, 92f, 150f, false, () => Bootstrap.AuthSubmitResetRequest());
            ActionButton(panel, "У меня уже есть код", 170f, 92f, 170f, true, () => Bootstrap.AuthShowPanel("resetConfirm"));
            ActionButton(panel, "Назад ко входу", 348f, 92f, 150f, true, () => Bootstrap.AuthShowPanel("login"));
            StatusLine(panel, 134f, "Введите email, указанный при регистрации.");
        }

        private void BuildResetConfirm()
        {
            RectTransform panel = Panel("ResetConfirmPanel", 300f);
            PanelTitleRow(panel, "Новый пароль", "одноразовый код", out _);
            TextInput(panel, 44f, "Логин", Bootstrap.AuthLogin, false, v => Bootstrap.AuthLogin = v);
            TextInput(panel, 88f, "Код восстановления", Bootstrap.AuthResetToken, false, v => Bootstrap.AuthResetToken = v);
            TextInput(panel, 132f, "Новый пароль", Bootstrap.AuthNewPassword, true, v => Bootstrap.AuthNewPassword = v);
            TextInput(panel, 176f, "Повторите новый пароль", Bootstrap.AuthPasswordConfirm, true, v => Bootstrap.AuthPasswordConfirm = v);
            ActionButton(panel, "Сохранить новый пароль", 12f, 224f, 210f, false, () => Bootstrap.AuthSubmitResetConfirm());
            ActionButton(panel, "Назад ко входу", 230f, 224f, 150f, true, () => Bootstrap.AuthShowPanel("login"));
            StatusLine(panel, 258f, "Введите новый пароль длиной не менее 8 символов.");
        }

        private void BuildConnecting()
        {
            RectTransform panel = Panel("ConnectingPanel", 90f);
            PanelTitleRow(panel, "Подключение", Bootstrap.AuthServerUrl, out _);
            StatusLine(panel, 44f, "Вход...");
        }

        private void BuildSelect()
        {
            IReadOnlyList<CharacterSummary> characters = Bootstrap.AuthCharacters;
            float listHeight = Mathf.Clamp(characters.Count * 74f + 8f, 60f, 380f);
            RectTransform panel = Panel("SelectPanel", 120f + listHeight);
            PanelTitleRow(panel, "Выбор персонажа", Bootstrap.AuthLogin, out Text loginSmall);
            loginSmall.rectTransform.offsetMax = new Vector2(-112f, -12f);
            ActionButton(panel, "Выйти", 12f, 10f, 90f, true, () => Bootstrap.AuthLogout());

            // Список карточек (.character-list) с прокруткой.
            RectTransform scrollArea = Child("Scroll", panel);
            Place(scrollArea, 0f, 1f, 1f, 1f, new Vector2(12f, -44f - listHeight), new Vector2(-12f, -44f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scrollArea.gameObject.AddComponent<RectMask2D>();
            RectTransform list = Child("List", scrollArea);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero;
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 8f;
            layout.padding = new RectOffset(0, 4, 0, 0);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            list.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;

            if (characters.Count == 0)
            {
                var empty = new GameObject("Empty", typeof(RectTransform));
                empty.transform.SetParent(list, false);
                empty.AddComponent<LayoutElement>().preferredHeight = 44f;
                var outline = empty.AddComponent<Image>();
                outline.color = new Color(0f, 0f, 0f, 0f);
                var border = empty.AddComponent<Outline>();
                border.effectColor = RowBorder;
                border.effectDistance = new Vector2(1f, -1f);
                Text text = Label("Text", (RectTransform)empty.transform, 12, TextAnchor.MiddleLeft, StatusInk);
                Stretch(text.rectTransform, 12f);
                text.text = "На этом аккаунте пока нет персонажей. Создайте нового персонажа.";
            }

            foreach (CharacterSummary character in characters) AddCharacterRow(list, character);

            float buttonsTop = 44f + listHeight + 10f;
            ActionButton(panel, "Создать нового персонажа", 12f, buttonsTop, 230f, false, () => Bootstrap.AuthOpenCreator());
            StatusLine(panel, buttonsTop + 36f, characters.Count > 0
                ? "Выберите персонажа для продолжения."
                : "Персонажей пока нет. Создайте нового.");
        }

        private void AddCharacterRow(RectTransform list, CharacterSummary character)
        {
            var row = new GameObject("Row", typeof(RectTransform));
            row.transform.SetParent(list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 66f;
            row.AddComponent<Image>().color = RowBg;
            var outline = row.AddComponent<Outline>();
            outline.effectColor = RowBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var rect = (RectTransform)row.transform;

            Text name = Label("Name", rect, 14, TextAnchor.UpperLeft, Title, FontStyle.Bold);
            name.text = "☢ " + (string.IsNullOrEmpty(character.Name) ? "Без имени" : character.Name);
            Place(name.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -30f), new Vector2(-230f, -10f));

            Text meta = Label("Meta", rect, 11, TextAnchor.UpperLeft, MetaInk);
            meta.text = CharacterMeta(character);
            Place(meta.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -56f), new Vector2(-230f, -34f));

            Button play = ActionButton(rect, "Играть", 110f, 17f, 90f, false, () => Bootstrap.AuthPlayCharacter(character.CharacterId));
            play.name = "Play";
            Button delete = ActionButton(rect, "Удалить", 10f, 17f, 92f, false, () => OpenConfirm(character));
            delete.name = "Delete";
            delete.GetComponent<Image>().color = DeleteBg;
            delete.GetComponentInChildren<Text>().color = DeleteInk;
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

        // --- Создание персонажа (#character-creator-panel) ---------------------

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

        private string _creatorSignature = string.Empty;
        private RawImage _previewImage;
        private Text _previewSummary;
        private Text _previewStatus;
        private RectTransform _statsBox;
        private RectTransform _skillsList;
        private RectTransform _traitsList;
        private Text _pointsLeft;
        private Text _skillCount;
        private Text _traitCount;
        private Text _derived;
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
            return sb.ToString();
        }

        private void BuildCreator()
        {
            _stepperValues.Clear();
            _dynamicObjects.Clear();

            // Размеры: редактор внешности 320, сетка блоков 440, действия 56.
            RectTransform panel = Panel("CreatorPanel", 320f + 12f + 440f + 12f + 56f);
            panel.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0f);
            Destroy(panel.GetComponent<Outline>());

            // --- .character-appearance-editor: превью (0.9fr) + управление (1.1fr) ---
            RectTransform shell = Child("PreviewShell", panel);
            Place(shell, 0f, 1f, 0.45f, 1f, new Vector2(0f, -320f), new Vector2(-6f, 0f));
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
            Place(caption, 0f, 0f, 1f, 0f, new Vector2(12f, 11f), new Vector2(-12f, 43f));
            caption.gameObject.AddComponent<Image>().color = new Color(0.024f, 0.031f, 0.031f, 0.82f);
            Outline captionOutline = caption.gameObject.AddComponent<Outline>();
            captionOutline.effectColor = new Color(0.682f, 0.545f, 0.282f, 0.36f);
            captionOutline.effectDistance = new Vector2(1f, -1f);
            Text captionLabel = Label("Label", caption, 10, TextAnchor.MiddleLeft, StatusInk);
            captionLabel.text = "БАЗОВАЯ МОДЕЛЬ";
            Stretch(captionLabel.rectTransform, 10f);
            _previewSummary = Label("Summary", caption, 11, TextAnchor.MiddleRight, Title, FontStyle.Bold);
            Stretch(_previewSummary.rectTransform, 10f);
            _previewStatus = Label("Status", shell, 10, TextAnchor.UpperLeft, MetaInk);
            Place(_previewStatus.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -30f), new Vector2(-10f, -10f));

            RectTransform controls = Block("Controls", panel, 0.45f, 1f, 1f, 1f, new Vector2(6f, -320f), new Vector2(0f, 0f));
            string[] titles = { "Пол", "Телосложение", "Лицо", "Причёска", "Цвет волос" };
            string[] keys = { "sex", "body", "face", "hair", "hairColor" };
            for (int i = 0; i < titles.Length; i++)
            {
                float top = 10f + i * 54f;
                Text h3 = Label("H3", controls, 11, TextAnchor.MiddleLeft, PanelTitle, FontStyle.Bold);
                h3.text = titles[i].ToUpperInvariant();
                Place(h3.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -top - 14f), new Vector2(-12f, -top));
                BuildStepper(controls, keys[i], top + 16f);
            }
            RectTransform noteBar = Child("NoteBar", controls);
            Place(noteBar, 0f, 0f, 0f, 0f, new Vector2(12f, 6f), new Vector2(14f, 36f));
            noteBar.gameObject.AddComponent<Image>().color = NoteGreen;
            Text note = Label("Note", controls, 10, TextAnchor.MiddleLeft, MetaInk);
            note.horizontalOverflow = HorizontalWrapMode.Wrap;
            note.text = "Новый персонаж начинает игру в нижнем белье и без надетых предметов. Одежда, броня, обувь, головные уборы, рюкзаки и оружие отображаются только после экипировки.";
            Place(note.rectTransform, 0f, 0f, 1f, 0f, new Vector2(20f, 6f), new Vector2(-12f, 36f));

            // --- .char-layout: 4 блока ---
            float gridTop = -332f;
            float gridBottom = -332f - 440f;
            float[] edges = { 0f, 0.275f, 0.5125f, 0.75f, 1f };
            RectTransform nameBlock = Block("NameBlock", panel, edges[0], 1f, edges[1], 1f, new Vector2(0f, gridBottom), new Vector2(-6f, gridTop));
            RectTransform skillBlock = Block("SkillBlock", panel, edges[1], 1f, edges[2], 1f, new Vector2(6f, gridBottom), new Vector2(-6f, gridTop));
            RectTransform traitBlock = Block("TraitBlock", panel, edges[2], 1f, edges[3], 1f, new Vector2(6f, gridBottom), new Vector2(-6f, gridTop));
            RectTransform derivedBlock = Block("DerivedBlock", panel, edges[3], 1f, edges[4], 1f, new Vector2(6f, gridBottom), new Vector2(0f, gridTop));

            BlockTitle(nameBlock, "Имя и SPECIAL", null);
            InputField nameField = TextInput(nameBlock, 34f, "Имя персонажа", Bootstrap.NewCharacterName, false, v => Bootstrap.NewCharacterName = v);
            nameField.characterLimit = 18;
            var nameRect = (RectTransform)nameField.transform;
            nameRect.anchorMax = new Vector2(1f, 1f);
            nameRect.offsetMax = new Vector2(-12f, -34f);
            _statsBox = Child("Stats", nameBlock);
            Place(_statsBox, 0f, 1f, 1f, 1f, new Vector2(12f, -80f - 7 * 30f), new Vector2(-12f, -80f));
            _pointsLeft = Label("Points", nameBlock, 12, TextAnchor.MiddleLeft, StatusOk);
            Place(_pointsLeft.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -80f - 7 * 30f - 26f), new Vector2(-12f, -80f - 7 * 30f - 4f));

            _skillCount = BlockTitle(skillBlock, "Профильные навыки", "0/2");
            Text skillNote = Label("Note", skillBlock, 10, TextAnchor.UpperLeft, SmallNote);
            skillNote.horizontalOverflow = HorizontalWrapMode.Wrap;
            skillNote.text = "Выберите 1–2 навыка. Каждый выбранный навык получает +5% к базовому значению.";
            Place(skillNote.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -60f), new Vector2(-12f, -32f));
            _skillsList = ScrollList(skillBlock, 66f, 6f);

            _traitCount = BlockTitle(traitBlock, "Стартовые перки", "0/2");
            Text traitNote = Label("Note", traitBlock, 10, TextAnchor.UpperLeft, SmallNote);
            traitNote.horizontalOverflow = HorizontalWrapMode.Wrap;
            traitNote.text = "Выберите 1–2 стартовых перка. Без перка персонажа создать нельзя.";
            Place(traitNote.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -60f), new Vector2(-12f, -32f));
            _traitsList = ScrollList(traitBlock, 66f, 7f);

            BlockTitle(derivedBlock, "Производные параметры", null);
            _derived = Label("Derived", derivedBlock, 12, TextAnchor.UpperLeft, DerivedInk);
            _derived.lineSpacing = 1.45f;
            _derived.supportRichText = true;
            Place(_derived.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -420f), new Vector2(-12f, -36f));

            // --- .char-actions ---
            float actionsTop = 320f + 12f + 440f + 12f;
            _readiness = Label("Readiness", panel, 10, TextAnchor.UpperLeft, SmallNote);
            _readiness.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_readiness.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(0f, -actionsTop - 52f), new Vector2(0f, -actionsTop - 6f));
            _createButton = ActionButton(panel, "СОЗДАТЬ И НАЧАТЬ", 0f, actionsTop + 8f, 190f, false, () => Bootstrap.CreatorSubmit());
            _createButton.name = "CreateCharacter";
            ((RectTransform)_createButton.transform).sizeDelta = new Vector2(190f, 38f);
            Button back = ActionButton(panel, "НАЗАД", 200f, actionsTop + 8f, 110f, true, () => Bootstrap.CreatorCancel());
            back.name = "CreatorBack";
            ((RectTransform)back.transform).sizeDelta = new Vector2(110f, 38f);

            _creatorSignature = string.Empty; // динамика построится в Update
        }

        private RectTransform Block(string name, RectTransform parent, float minX, float minY, float maxX, float maxY,
                                    Vector2 offsetMin, Vector2 offsetMax)
        {
            RectTransform block = Child(name, parent);
            Place(block, minX, minY, maxX, maxY, offsetMin, offsetMax);
            block.gameObject.AddComponent<Image>().color = BlockBg;
            Outline outline = block.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            return block;
        }

        private Text BlockTitle(RectTransform block, string caption, string small)
        {
            Text h3 = Label("H3", block, 12, TextAnchor.MiddleLeft, PanelTitle, FontStyle.Bold);
            h3.text = caption.ToUpperInvariant();
            Place(h3.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -28f), new Vector2(-12f, -10f));
            if (small == null) return null;
            Text smallText = Label("Small", block, 10, TextAnchor.MiddleRight, MetaInk);
            smallText.text = small;
            Place(smallText.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -28f), new Vector2(-12f, -10f));
            return smallText;
        }

        private RectTransform ScrollList(RectTransform block, float top, float spacing)
        {
            RectTransform scrollArea = Child("Scroll", block);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(12f, 10f), new Vector2(-8f, -top));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scroll.scrollSensitivity = 24f;
            scrollArea.gameObject.AddComponent<RectMask2D>();
            RectTransform list = Child("List", scrollArea);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero;
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = spacing;
            layout.padding = new RectOffset(0, 4, 0, 0);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            list.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;
            return list;
        }

        /// <summary>.character-appearance-stepper: [<] значение [>].</summary>
        private void BuildStepper(RectTransform parent, string key, float top)
        {
            RectTransform row = Child("Stepper-" + key, parent);
            Place(row, 0f, 1f, 1f, 1f, new Vector2(12f, -top - 34f), new Vector2(-12f, -top));
            row.gameObject.AddComponent<Image>().color = StepperBg;
            Outline outline = row.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.537f, 0.439f, 0.263f, 0.55f);
            outline.effectDistance = new Vector2(1f, -1f);

            StepperArrow(row, "<", 0f, () => CycleAppearance(key, -1)).name = "Prev-" + key;
            StepperArrow(row, ">", 1f, () => CycleAppearance(key, 1)).name = "Next-" + key;

            Text value = Label("Value", row, 12, TextAnchor.MiddleCenter, Title, FontStyle.Bold);
            Place(value.rectTransform, 0f, 0f, 1f, 1f, new Vector2(44f, 0f), new Vector2(-44f, 0f));
            _stepperValues[key] = value;
            if (key == "hairColor")
            {
                RectTransform swatch = Child("Swatch", row);
                swatch.anchorMin = swatch.anchorMax = new Vector2(0f, 0.5f);
                swatch.pivot = new Vector2(0f, 0.5f);
                swatch.anchoredPosition = new Vector2(52f, 0f);
                swatch.sizeDelta = new Vector2(20f, 20f);
                _hairSwatch = swatch.gameObject.AddComponent<Image>();
                _hairSwatch.sprite = RadialSprite();
                _hairSwatch.raycastTarget = false;
            }
        }

        private Button StepperArrow(RectTransform row, string glyph, float side, System.Action onClick)
        {
            var go = new GameObject("Arrow", typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(row, false);
            rect.anchorMin = new Vector2(side, 0f);
            rect.anchorMax = new Vector2(side, 1f);
            rect.pivot = new Vector2(side, 0.5f);
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = new Vector2(42f, 0f);
            var image = go.AddComponent<Image>();
            image.color = ButtonBg;
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            Text label = Label("Label", rect, 19, TextAnchor.MiddleCenter, ButtonInk, FontStyle.Bold);
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

        /// <summary>Статы, навыки и перки пересоздаются при изменении выбора (как renderCharacterCreator).</summary>
        private void RebuildCreatorDynamic()
        {
            foreach (GameObject go in _dynamicObjects) Destroy(go);
            _dynamicObjects.Clear();
            RoaCharacterCreator c = Bootstrap.Creator;
            int points = c.PointsLeft;

            // .char-stat-row: код | имя | значение | − | +
            int index = 0;
            foreach (RoaCharacterCreator.StatDef stat in RoaCharacterCreator.Stats)
            {
                RectTransform row = Child("Stat-" + stat.Id, _statsBox);
                float top = index * 30f;
                Place(row, 0f, 1f, 1f, 1f, new Vector2(0f, -top - 24f), new Vector2(0f, -top));
                _dynamicObjects.Add(row.gameObject);
                Text code = Label("Code", row, 12, TextAnchor.MiddleLeft, Title, FontStyle.Bold);
                code.text = stat.Code;
                Place(code.rectTransform, 0f, 0f, 0f, 1f, new Vector2(0f, 0f), new Vector2(34f, 0f));
                Text name = Label("Name", row, 12, TextAnchor.MiddleLeft, StatName);
                name.text = stat.Name;
                Place(name.rectTransform, 0f, 0f, 1f, 1f, new Vector2(40f, 0f), new Vector2(-96f, 0f));
                Text value = Label("Value", row, 12, TextAnchor.MiddleCenter, StatVal, FontStyle.Bold);
                value.text = c.Stat(stat.Id).ToString();
                Place(value.rectTransform, 1f, 0f, 1f, 1f, new Vector2(-92f, 0f), new Vector2(-64f, 0f));
                string id = stat.Id;
                StatButton(row, "-", 56f, c.Stat(id) > RoaCharacterCreator.SpecialMin, () => c.AdjustStat(id, -1)).name = "Stat-" + id + "-minus";
                StatButton(row, "+", 28f, c.Stat(id) < RoaCharacterCreator.SpecialMax && points > 0, () => c.AdjustStat(id, 1)).name = "Stat-" + id + "-plus";
                index++;
            }
            _pointsLeft.text = "Свободные очки: " + points;

            foreach (RoaProgressionData.SkillDef skill in RoaProgressionData.Skills)
            {
                bool selected = c.HasSkill(skill.Id);
                string id = skill.Id;
                string desc = skill.Group + " · база " + c.SkillBasePercent(id, false) + "% -> " + c.SkillBasePercent(id, true) + "%";
                AddTraitCard(_skillsList, "Skill-" + id, skill.Name, desc, selected, 44f, () => c.ToggleSkill(id));
            }
            _skillCount.text = c.SelectedSkillCount + "/" + RoaCharacterCreator.MaxTaggedSkills;

            foreach (RoaCharacterCreator.TraitDef trait in RoaCharacterCreator.Traits)
            {
                bool selected = c.HasTrait(trait.Id);
                string id = trait.Id;
                AddTraitCard(_traitsList, "Trait-" + id, trait.Name, trait.Description, selected, 62f, () => c.ToggleTrait(id));
            }
            _traitCount.text = c.SelectedTraitCount + "/" + RoaCharacterCreator.MaxTraits;

            RoaCharacterCreator.DerivedStats d = c.Derived();
            string nl = "\n";
            _derived.text = "ОЗ: <b>" + d.MaxHp + "</b>" + nl + "ОД: <b>" + d.MaxAp + "</b>" + nl
                + "Скорость: <b>" + d.Speed.ToString("0.0") + "</b>" + nl
                + "Переносимый вес: <b>" + d.Carry + "</b>" + nl + "Меткость: <b>" + Signed(d.Hit) + "%</b>" + nl
                + "Критический выстрел: <b>" + d.CriticalChance + "% (x2)</b>" + nl + "Обзор: <b>" + d.VisionRadius + " кл.</b>" + nl
                + "Сопротивление: <b>" + d.ResistAll + "%</b>" + nl + "Продажа: <b>" + Signed(d.Sell) + "%</b>" + nl
                + "Крафт/сбор: <b>" + Signed(d.Craft) + "%</b>" + nl + "Проверки удачи: <b>+" + d.LuckChecks + " п.п.</b>";

            LayoutRebuilder.ForceRebuildLayoutImmediate(_skillsList);
            LayoutRebuilder.ForceRebuildLayoutImmediate(_traitsList);
            RefreshCreatorTexts();
        }

        private static string Signed(int value) { return (value >= 0 ? "+" : "") + value; }

        private Button StatButton(RectTransform row, string glyph, float right, bool enabled, System.Action onClick)
        {
            var go = new GameObject("StatBtn", typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(row, false);
            rect.anchorMin = new Vector2(1f, 0.5f);
            rect.anchorMax = new Vector2(1f, 0.5f);
            rect.pivot = new Vector2(1f, 0.5f);
            rect.anchoredPosition = new Vector2(-right + 24f, 0f);
            rect.sizeDelta = new Vector2(24f, 24f);
            var image = go.AddComponent<Image>();
            image.color = enabled ? ButtonBg : new Color(ButtonBg.r, ButtonBg.g, ButtonBg.b, 0.4f);
            Outline outline = go.AddComponent<Outline>();
            outline.effectColor = new Color(0.682f, 0.545f, 0.282f, enabled ? 0.55f : 0.25f);
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            button.interactable = enabled;
            Color ink = enabled ? ButtonInk : new Color(ButtonInk.r, ButtonInk.g, ButtonInk.b, 0.4f);
            Text label = Label("Label", rect, 14, TextAnchor.MiddleCenter, ink, FontStyle.Bold);
            Stretch(label.rectTransform, 0f);
            label.text = glyph;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        /// <summary>.trait-card: заголовок + описание, выбранная — зелёная рамка.</summary>
        private void AddTraitCard(RectTransform list, string name, string title, string desc, bool selected, float height, System.Action onClick)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(list, false);
            go.AddComponent<LayoutElement>().preferredHeight = height;
            var image = go.AddComponent<Image>();
            image.color = CardBgDim;
            Outline outline = go.AddComponent<Outline>();
            outline.effectColor = selected ? CardSelected : new Color(0.341f, 0.322f, 0.235f, 0.55f);
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => onClick());
            var rect = (RectTransform)go.transform;
            Text titleText = Label("Title", rect, 12, TextAnchor.UpperLeft, CardTitle, FontStyle.Bold);
            titleText.text = title;
            Place(titleText.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -22f), new Vector2(-8f, -6f));
            Text descText = Label("Desc", rect, 10, TextAnchor.UpperLeft, CardDesc);
            descText.horizontalOverflow = HorizontalWrapMode.Wrap;
            descText.text = desc;
            Place(descText.rectTransform, 0f, 0f, 1f, 1f, new Vector2(8f, 4f), new Vector2(-8f, -24f));
            _dynamicObjects.Add(go);
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
            if (_hairSwatch != null) _hairSwatch.color = RoaCharacterCreator.HairColorSwatch(c.Appearance.HairColorId);
            _previewSummary.text = c.SexLabelText + " · " + c.BodyLabelText;

            string hint = c.ReadinessHint(Bootstrap.NewCharacterName);
            bool ready = c.Ready(Bootstrap.NewCharacterName) && !Bootstrap.CreatorBusy;
            string notice = c.Notice;
            _readiness.text = !string.IsNullOrEmpty(notice) ? notice
                : Bootstrap.CreatorBusy ? Bootstrap.StatusText
                : string.IsNullOrEmpty(hint)
                    ? "Распределите SPECIAL и обязательно выберите профильный навык и стартовый перк. Прогресс, карта, инвентарь и хранилище привязаны к серверному персонажу."
                    : hint;
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

            RectTransform box = Child("Box", dim);
            box.anchorMin = box.anchorMax = new Vector2(0.5f, 0.5f);
            box.sizeDelta = new Vector2(460f, 230f);
            box.gameObject.AddComponent<Image>().color = CardBg;
            var outline = box.gameObject.AddComponent<Outline>();
            outline.effectColor = CardBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            Text kicker = Label("Kicker", box, 11, TextAnchor.UpperLeft, PanelTitle, FontStyle.Bold);
            kicker.text = "УДАЛЕНИЕ ПЕРСОНАЖА";
            Place(kicker.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -32f), new Vector2(-16f, -14f));
            Text title = Label("Title", box, 18, TextAnchor.UpperLeft, Title, FontStyle.Bold);
            title.text = "Удалить персонажа навсегда?";
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -62f), new Vector2(-16f, -36f));
            Text body = Label("Body", box, 12, TextAnchor.UpperLeft, InputInk);
            body.horizontalOverflow = HorizontalWrapMode.Wrap;
            body.text = (string.IsNullOrEmpty(character.Name) ? "Без имени" : character.Name)
                + ". Уровень " + Mathf.Max(1, character.Level)
                + ". Всё серверное сохранение этого персонажа будет удалено.";
            Place(body.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -110f), new Vector2(-16f, -68f));
            Text note = Label("Note", box, 11, TextAnchor.UpperLeft, StatusErr);
            note.horizontalOverflow = HorizontalWrapMode.Wrap;
            note.text = "Действие необратимо. Инвентарь, прогресс, карта и задания восстановить нельзя.";
            Place(note.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -150f), new Vector2(-16f, -114f));

            Button confirm = ActionButton(box, "Удалить", 16f, 178f, 120f, false, () =>
            {
                string id = _deleteCandidate?.CharacterId;
                CloseConfirm();
                Bootstrap.AuthDeleteCharacter(id);
            });
            confirm.name = "ConfirmDelete";
            confirm.GetComponent<Image>().color = DeleteBg;
            confirm.GetComponentInChildren<Text>().color = DeleteInk;
            Button cancel = ActionButton(box, "Оставить", 146f, 178f, 120f, true, CloseConfirm);
            cancel.name = "CancelDelete";
        }

        private void CloseConfirm()
        {
            _deleteCandidate = null;
            if (_confirm != null) Destroy(_confirm);
            _confirm = null;
        }

        // --- Обновление текста ------------------------------------------------

        private void RefreshTexts(string step)
        {
            bool select = step == "select";
            bool creator = step == "creator";
            _title.text = creator ? "НОВЫЙ ПЕРСОНАЖ"
                : select ? "ВЫБОР ПЕРСОНАЖА" : (step == "connecting" ? "ПОДКЛЮЧЕНИЕ" : "ВХОД В ИГРУ");
            _subtitle.text = creator
                ? "Соберите внешность, распределите SPECIAL и выберите профильный навык и стартовый перк. Персонаж хранится на сервере."
                : select
                ? "Выберите персонажа, чтобы войти в мир, или создайте нового. Прогресс, карта, инвентарь и хранилище привязаны к серверному аккаунту."
                : "Войдите в серверный аккаунт, чтобы выбрать уже созданного персонажа или создать нового. Прогресс, карта, инвентарь и хранилище привязаны к серверному аккаунту.";
            _note.text = select || creator ? "Сервер: " + Bootstrap.AuthLogin : "Сервер: " + Bootstrap.AuthServerUrl;
            if (creator) RefreshCreatorTexts();

            if (_status == null) return;
            string status = Bootstrap.StatusText;
            bool failed = Bootstrap.AuthFailed;
            _status.text = string.IsNullOrEmpty(status) ? _statusFallback : status;
            _status.color = failed ? StatusErr : (string.IsNullOrEmpty(status) ? StatusInk : StatusOk);
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
