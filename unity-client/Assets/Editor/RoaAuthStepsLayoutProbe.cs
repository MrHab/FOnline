#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.UI;
using Shared = RealmOfAshes.EditorTools.RoaCreatorCardLayoutProbe;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Шаги аккаунта — вход, регистрация, восстановление пароля, подключение, выбор
    /// персонажа и подтверждение удаления: текст читается, умещается в свои рамки,
    /// подписи не наезжают друг на друга, и до каждой кнопки можно добраться.
    ///
    /// Это первое, что видит игрок, и на телефоне 10 pt здесь были шестью
    /// пикселями. Проба строит настоящий экран RoaAuthCanvas на тех же размерах,
    /// что и проба создания персонажа, её же проверками (кегль в пикселях экрана,
    /// рамка подписи, достижимость, размер под палец, луч GraphicRaycaster), и
    /// добавляет своё: браузерный вход без поля сервера, длинную ошибку в строке
    /// статуса (её пишет сервер, длина любая), список персонажей, который не
    /// помещается без прокрутки, окно подтверждения поверх него — и то, что каждый
    /// знак на экране есть во вложенном шрифте: в WebGL другого нет.
    /// </summary>
    public static class RoaAuthStepsLayoutProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string Tag = "[AUTH STEPS LAYOUT] ";
        private const string LongStatus = "Не удалось связаться с сервером: Cannot connect to destination host. Проверьте адрес "
            + "сервера и подключение к сети, затем повторите вход. Если ошибка повторяется, попробуйте позже.";

        private sealed class StepCase
        {
            public string Name;
            public string Step;
            /// <summary>Поле адреса сервера: null — как в этой сборке, false — как в браузере.</summary>
            public bool? ServerField;
            public int Characters;
            public bool Confirm;
            public bool Error;
            /// <summary>Панель шага стоит целиком, без прокрутки, — везде, кроме неудобных окон (ScreenCase.Awkward).</summary>
            public bool Whole = true;
            public string[] Controls = new string[0];
        }

        private static readonly StepCase[] Steps =
        {
            new StepCase
            {
                Name = "login", Step = "login", ServerField = true, Whole = false,
                Controls = new[] { "QuickStart", "Input-login", "Input-password", "Input-server", "SubmitLogin", "ShowRegister", "ShowReset" }
            },
            new StepCase
            {
                Name = "login-web", Step = "login", ServerField = false,
                Controls = new[] { "QuickStart", "Input-login", "Input-password", "SubmitLogin", "ShowRegister", "ShowReset" }
            },
            new StepCase
            {
                Name = "login-web-error", Step = "login", ServerField = false, Error = true, Whole = false,
                Controls = new[] { "QuickStart", "Input-login", "Input-password", "SubmitLogin", "ShowRegister", "ShowReset" }
            },
            new StepCase
            {
                Name = "register", Step = "register",
                Controls = new[] { "Input-login", "Input-email", "Input-password", "Input-passwordConfirm", "SubmitRegister", "BackToLogin" }
            },
            new StepCase
            {
                Name = "register-error", Step = "register", Error = true, Whole = false,
                Controls = new[] { "Input-login", "Input-email", "Input-password", "Input-passwordConfirm", "SubmitRegister", "BackToLogin" }
            },
            new StepCase
            {
                Name = "reset", Step = "reset",
                Controls = new[] { "Input-email", "SubmitReset", "ShowResetConfirm", "BackToLogin" }
            },
            new StepCase
            {
                Name = "resetConfirm", Step = "resetConfirm",
                Controls = new[] { "Input-login", "Input-resetToken", "Input-newPassword", "Input-passwordConfirm", "SubmitResetConfirm", "BackToLogin" }
            },
            new StepCase { Name = "connecting", Step = "connecting" },
            new StepCase { Name = "select-empty", Step = "select", Controls = new[] { "Logout", "CreateNew" } },
            new StepCase { Name = "select", Step = "select", Characters = 6, Controls = new[] { "Logout", "CreateNew", "Play", "Delete" } },
            new StepCase
            {
                Name = "select-error", Step = "select", Characters = 2, Error = true,
                Controls = new[] { "Logout", "CreateNew", "Play", "Delete" }
            },
            new StepCase
            {
                Name = "select-confirm", Step = "select", Characters = 2, Confirm = true,
                Controls = new[] { "ConfirmDelete", "CancelDelete" }
            }
        };

        [MenuItem("Realm of Ashes/Probe/Auth steps layout")]
        public static void Run()
        {
            var failures = new List<string>();
            Measure(Shared.Screens, failures, null, false);
            if (failures.Count > 0)
                throw new InvalidOperationException(Tag + "FAIL: " + string.Join(" | ", failures));
            Debug.Log(Tag + "OK: на " + Shared.Screens.Length + " экранах текст входа, регистрации, восстановления пароля и "
                + "выбора персонажа не мельче " + RoaAuthCanvas.MinTextPixels + " пикселя, умещается в рамки и целиком есть во "
                + "вложенном шрифте, подписи не наезжают друг на друга, а все кнопки достижимы.");
        }

        /// <summary>Снимки всех шагов — посмотреть глазами, в аудит не входит.</summary>
        [MenuItem("Realm of Ashes/Probe/Auth steps layout (снимки)")]
        public static void Capture()
        {
            Directory.CreateDirectory(Shared.OutputDir);
            foreach (string stale in Directory.GetFiles(Shared.OutputDir, "auth-*.png")) File.Delete(stale);
            var failures = new List<string>();
            Measure(Shared.Screens, failures, Shared.OutputDir, true);
            Debug.Log(Tag + "снимки в " + Shared.OutputDir + (failures.Count > 0
                ? "; замечания (" + failures.Count + "): " + string.Join(" | ", failures) : "; замечаний нет"));
        }

        /// <summary>
        /// Все масштабы канвы подряд, те же окна 16:9, что у пробы создания персонажа.
        /// Нужен, когда новая строка или кнопка умещается впритык, — в аудит не входит.
        /// </summary>
        [MenuItem("Realm of Ashes/Probe/Auth steps layout (все масштабы)")]
        public static void Sweep()
        {
            Shared.ScreenCase[] screens = Shared.SweepScreens();
            var failures = new List<string>();
            Measure(screens, failures, null, false);
            Debug.Log(Tag + "масштабов: " + screens.Length + (failures.Count > 0
                ? "; замечания (" + failures.Count + "): " + string.Join(" | ", failures) : "; замечаний нет"));
        }

        private static void Measure(Shared.ScreenCase[] screens, List<string> failures, string captureDir, bool logScreens)
        {
            foreach (Shared.ScreenCase screen in screens)
            {
                foreach (StepCase step in Steps)
                {
                    GameObject host = null;
                    GameObject cameraObject = null;
                    RenderTexture target = null;
                    try
                    {
                        Canvas canvas = Shared.BuildHost(screen, out RoaAuthCanvas auth, out host, out cameraObject, out target);
                        MeasureStep(screen, step, canvas, auth, cameraObject.GetComponent<Camera>(), target, failures,
                            captureDir, logScreens);
                    }
                    finally
                    {
                        if (target != null)
                        {
                            target.Release();
                            UnityEngine.Object.DestroyImmediate(target);
                        }
                        if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                        if (host != null) UnityEngine.Object.DestroyImmediate(host);
                    }
                }
            }
        }

        private static void MeasureStep(Shared.ScreenCase screen, StepCase step, Canvas canvas, RoaAuthCanvas auth, Camera camera,
                                        RenderTexture target, List<string> failures, string captureDir, bool logScreens)
        {
            string where = step.Name + ", " + screen.Name;
            auth.ServerFieldOverride = step.ServerField;
            if (step.Characters > 0) SetCharacters(auth.Bootstrap, step.Characters);
            Shared.Invoke(auth, "RebuildBody", step.Step);
            if (step.Error) SetField(auth.Bootstrap, "_status", LongStatus);
            Shared.Invoke(auth, "RefreshTexts", step.Step);
            if (step.Confirm) Shared.Invoke(auth, "OpenConfirm", auth.Bootstrap.AuthCharacters[0]);
            Shared.ToCaptureLayer(canvas);
            Canvas.ForceUpdateCanvases();

            var canvasRect = (RectTransform)canvas.transform;
            var card = canvasRect.Find("CharacterScreen/CharacterCard") as RectTransform;
            if (card == null) throw new InvalidOperationException(Tag + "на канвасе нет карточки CharacterCard");
            // Окно подтверждения лежит поверх карточки и не в ней: пока оно открыто, меряется оно.
            RectTransform root = card;
            if (step.Confirm)
            {
                root = canvasRect.Find("CharacterScreen/ConfirmPanel") as RectTransform;
                if (root == null) throw new InvalidOperationException(Tag + where + ": окно подтверждения не открылось");
                var box = root.Find("Box") as RectTransform;
                if (box == null || !Shared.Contains(canvasRect.rect, Shared.RectIn(box, canvasRect)))
                    failures.Add(where + ": окно подтверждения не умещается на канве " + Shared.Size(canvasRect.rect));
            }

            if (!Shared.Contains(canvasRect.rect, Shared.RectIn(card, canvasRect)))
                failures.Add(where + ": карточка " + Shared.Size(Shared.RectIn(card, canvasRect)) + " не умещается на канве "
                    + Shared.Size(canvasRect.rect));

            var seen = new HashSet<string>();
            float smallest = Shared.CheckTexts(where, canvas, root, failures);
            CheckGlyphs(where, root, failures);
            CheckOverlaps(where, root, canvasRect, failures);
            Shared.CheckControls(where, canvasRect, root, screen.Mobile, seen, failures);
            // Кадр нужен и без снимка: глубину для луча канва раздаёт графике при отрисовке.
            Shared.Render(camera, target, captureDir == null ? null
                : Path.Combine(captureDir, "auth-" + screen.Name + "-" + step.Name + ".png"));
            Shared.CheckClickable(where, canvas, root, camera, target, failures);
            foreach (string control in step.Controls)
                if (!seen.Contains(control)) failures.Add(where + ": нет кнопки или поля «" + control + "»");

            ScrollRect body = BodyScroll(card);
            float hidden = body == null ? 0f : body.content.rect.height - ((RectTransform)body.transform).rect.height;
            if (!screen.Awkward && step.Whole && hidden > 0.5f)
                failures.Add(where + ": панель шага на " + Mathf.CeilToInt(hidden) + " ед. выше поля карточки — часть формы "
                    + "видна только после прокрутки");
            if (step.Characters > 0 && !step.Confirm) CheckRows(where, card, step.Characters, failures);

            if (logScreens)
                Debug.Log(Tag + where + ": карточка " + Shared.Size(card.rect) + " в масштабе " + card.localScale.x.ToString("0.000")
                    + ", канва " + Shared.Size(canvasRect.rect) + " в масштабе " + canvas.scaleFactor.ToString("0.000")
                    + ", мельчайший текст " + smallest.ToString("0.0") + " px"
                    + (hidden > 0.5f ? ", панель прокручивается (скрыто " + Mathf.CeilToInt(hidden) + " ед.)" : string.Empty));
        }

        /// <summary>
        /// Каждый знак каждой подписи есть во вложенном шрифте. В редакторе недостающий
        /// глиф молча берётся из шрифтов системы (и Font.HasCharacter отвечает «есть»), а
        /// в WebGL системных шрифтов нет — на месте знака остаётся пустота. Поэтому
        /// спрашиваем сам файл шрифта.
        /// </summary>
        private static void CheckGlyphs(string where, RectTransform root, List<string> failures)
        {
            foreach (Text text in root.GetComponentsInChildren<Text>(false))
            {
                if (!text.gameObject.activeInHierarchy || string.IsNullOrEmpty(text.text)) continue;
                foreach (char symbol in text.text)
                    if (!char.IsControl(symbol) && !Drawable(symbol))
                        failures.Add(where + ": в подписи " + Name(text) + " знак «" + symbol + "» (U+" + ((int)symbol).ToString("X4")
                            + ") — во вложенном шрифте его нет, в WebGL он не нарисуется");
            }
        }

        private static readonly Dictionary<char, bool> Glyphs = new Dictionary<char, bool>();
        private static bool _fontLoaded;

        private static bool Drawable(char symbol)
        {
            if (Glyphs.TryGetValue(symbol, out bool known)) return known;
            if (!_fontLoaded)
            {
                FontEngine.InitializeFontEngine();
                FontEngineError error = FontEngine.LoadFontFace(RoaUiFont.Default);
                if (error != FontEngineError.Success)
                    throw new InvalidOperationException(Tag + "вложенный шрифт не читается: " + error);
                _fontLoaded = true;
            }
            bool drawable = FontEngine.TryGetGlyphIndex(symbol, out uint index) && index != 0;
            Glyphs[symbol] = drawable;
            return drawable;
        }

        /// <summary>
        /// Подписи не наезжают друг на друга. Проверка рамки этого не видит: подпись,
        /// выросшая вместе с кеглем, умещается в свою рамку, а сама рамка уже легла на
        /// соседнюю. Текст поля ввода и его подсказка делят одну рамку по замыслу.
        /// </summary>
        private static void CheckOverlaps(string where, RectTransform root, RectTransform canvasRect, List<string> failures)
        {
            var texts = new List<Text>();
            foreach (Text text in root.GetComponentsInChildren<Text>(false))
                if (text.gameObject.activeInHierarchy && !string.IsNullOrEmpty(text.text)) texts.Add(text);
            for (int i = 0; i < texts.Count; i++)
                for (int j = i + 1; j < texts.Count; j++)
                {
                    if (texts[i].transform.parent == texts[j].transform.parent
                        && texts[i].transform.parent.GetComponent<InputField>() != null) continue;
                    Rect a = VisibleRect(texts[i].rectTransform, canvasRect);
                    Rect b = VisibleRect(texts[j].rectTransform, canvasRect);
                    float overlapX = Mathf.Min(a.xMax, b.xMax) - Mathf.Max(a.xMin, b.xMin);
                    float overlapY = Mathf.Min(a.yMax, b.yMax) - Mathf.Max(a.yMin, b.yMin);
                    if (overlapX > 0.5f && overlapY > 0.5f)
                        failures.Add(where + ": подпись " + Name(texts[i]) + " наезжает на " + Name(texts[j]) + " на "
                            + overlapX.ToString("0") + "×" + overlapY.ToString("0") + " ед.");
                }
        }

        /// <summary>
        /// Рамка подписи, обрезанная окнами прокруток, в которых она лежит: карточка,
        /// уехавшая под нижний край списка, на кнопку под списком не наезжает — её там не видно.
        /// </summary>
        private static Rect VisibleRect(RectTransform rect, RectTransform canvasRect)
        {
            Rect visible = Shared.RectIn(rect, canvasRect);
            foreach (ScrollRect scroll in rect.GetComponentsInParent<ScrollRect>())
            {
                Rect window = Shared.RectIn((RectTransform)scroll.transform, canvasRect);
                visible = Rect.MinMaxRect(Mathf.Max(visible.xMin, window.xMin), Mathf.Max(visible.yMin, window.yMin),
                    Mathf.Min(visible.xMax, window.xMax), Mathf.Min(visible.yMax, window.yMax));
            }
            return visible;
        }

        /// <summary>
        /// Карточки персонажей занимают всю ширину списка: в редакторе Reset() у
        /// LayoutGroup выключает childControlWidth, и карточка выходит шириной 100 единиц.
        /// </summary>
        private static void CheckRows(string where, RectTransform card, int expected, List<string> failures)
        {
            int rows = 0;
            foreach (RectTransform rect in card.GetComponentsInChildren<RectTransform>(false))
            {
                if (rect.name != "Row") continue;
                rows++;
                float room = ((RectTransform)rect.parent).rect.width;
                if (rect.rect.width < room * 0.9f)
                    failures.Add(where + ": карточка персонажа шириной " + rect.rect.width.ToString("0") + " ед. в списке шириной "
                        + room.ToString("0") + " ед.");
            }
            if (rows != expected) failures.Add(where + ": карточек персонажей " + rows + " вместо " + expected);
        }

        /// <summary>Прокрутка поля карточки — та, что лежит прямо в Body; списки внутри панели не в счёт.</summary>
        private static ScrollRect BodyScroll(RectTransform card)
        {
            Transform body = card.Find("Body");
            if (body == null) return null;
            foreach (Transform child in body)
            {
                ScrollRect scroll = child.GetComponent<ScrollRect>();
                if (scroll != null && scroll.content != null) return scroll;
            }
            return null;
        }

        private static string Name(Text text)
        {
            return text.transform.parent.name + "/" + text.name;
        }

        /// <summary>
        /// Список персонажей без сети: самое длинное имя, которое пропускает поле ввода,
        /// и длинное название локации — строка с ними самая тесная.
        /// </summary>
        private static void SetCharacters(RoaGameBootstrap bootstrap, int count)
        {
            var characters = new List<CharacterSummary>();
            for (int i = 0; i < count; i++)
                characters.Add(new CharacterSummary
                {
                    CharacterId = "probe-" + i,
                    Name = i % 2 == 0 ? "Максимилиан Долгий" : "Ива",
                    Level = i % 2 == 0 ? 48 : 1,
                    LocationId = i % 2 == 0 ? "Старая сортировочная станция «Западный узел»" : "settlement",
                    Appearance = new JObject { ["sex"] = i % 2 == 0 ? "female" : "male", ["bodyType"] = i % 2 == 0 ? "slim" : "large" },
                    UpdatedAt = 1789000000000L + i * 86400000L
                });
            var client = new RoaAuthClient("http://127.0.0.1:3000");
            PropertyInfo property = typeof(RoaAuthClient).GetProperty("Characters");
            if (property == null) throw new MissingMemberException(typeof(RoaAuthClient).FullName, "Characters");
            property.SetValue(client, characters);
            SetField(bootstrap, "_auth", client);
        }

        private static void SetField(RoaGameBootstrap bootstrap, string name, object value)
        {
            FieldInfo field = typeof(RoaGameBootstrap).GetField(name, Private);
            if (field == null) throw new MissingFieldException(typeof(RoaGameBootstrap).FullName, name);
            field.SetValue(bootstrap, value);
        }
    }
}
#endif
