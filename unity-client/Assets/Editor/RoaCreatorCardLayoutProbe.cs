#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Экран создания персонажа: текст читается, умещается в свои рамки, и до
    /// каждой кнопки можно добраться.
    ///
    /// Описание перка пишут в data/kromka/character-progression.json, далеко от
    /// кода карточки, а читаемость решают пиксели экрана, а не пункты: вложенный
    /// шрифт растрируется в целых пикселях, и 10 pt на телефоне — это 6 пикселей
    /// каши. Ни одна строковая проверка этого не видит. Поэтому проба строит
    /// настоящий экран RoaAuthCanvas — тем же кодом, что и игра, — на настольных и
    /// альбомных телефонных размерах, на телефоне обходит все вкладки и сверяет:
    /// кегль каждой подписи на экране не мельче RoaAuthCanvas.MinTextPixels; каждая
    /// подпись умещается в свою рамку; каждая кнопка лежит на экране либо в
    /// прокрутке, которая до неё достаёт, под палец — не мельче MinTouchUnits, и луч
    /// GraphicRaycaster попадает в неё саму, а не в то, что её накрыло.
    /// Меряются и строки каталога, которые присылает сервер, и запасные строки C#.
    /// </summary>
    public static class RoaCreatorCardLayoutProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string Tag = "[CREATOR CARD LAYOUT] ";
        private static readonly string OutputDir = Path.Combine("Library", "AgentCaptures");
        /// <summary>Тот же слой, что у превью персонажа: в edit mode он свободен.</summary>
        private const int CaptureLayer = 31;
        private static readonly Vector3[] Corners = new Vector3[4];
        private static readonly Vector2[] Nudges = { Vector2.zero, new Vector2(0.37f, 0.29f), new Vector2(-0.41f, -0.23f) };

        private struct ScreenCase
        {
            public string Name;
            public bool Mobile;
            public int Width;
            public int Height;
        }

        // Окно браузера бывает любым, поэтому настольных размеров несколько: перенос
        // строки зависит от того, в сколько целых пикселей растрируется кегль.
        // Телефон в альбомной ориентации: 844×390 CSS-пикселей при DPR 1 и 1,5
        // (шаблон WebGL выше не поднимает) и 960×540, как в RoaMobileLayoutProbe.
        // Ниже — неудобные окна, на которых раскладка обязана хотя бы не терять
        // кнопки: 16:10 (колонкам впритык), 5:4 и 4:3 (колонкам тесно — вкладки),
        // сверхширокий монитор, маленькое окно, маленький телефон, планшет.
        private static readonly ScreenCase[] Screens =
        {
            new ScreenCase { Name = "desktop-2560x1440", Mobile = false, Width = 2560, Height = 1440 },
            new ScreenCase { Name = "desktop-1920x1080", Mobile = false, Width = 1920, Height = 1080 },
            new ScreenCase { Name = "desktop-1536x864", Mobile = false, Width = 1536, Height = 864 },
            new ScreenCase { Name = "desktop-1440x810", Mobile = false, Width = 1440, Height = 810 },
            new ScreenCase { Name = "desktop-1366x768", Mobile = false, Width = 1366, Height = 768 },
            new ScreenCase { Name = "desktop-1280x720", Mobile = false, Width = 1280, Height = 720 },
            new ScreenCase { Name = "mobile-1266x585", Mobile = true, Width = 1266, Height = 585 },
            new ScreenCase { Name = "mobile-960x540", Mobile = true, Width = 960, Height = 540 },
            new ScreenCase { Name = "mobile-844x390", Mobile = true, Width = 844, Height = 390 },
            new ScreenCase { Name = "desktop-1920x1200", Mobile = false, Width = 1920, Height = 1200 },
            new ScreenCase { Name = "desktop-1280x800", Mobile = false, Width = 1280, Height = 800 },
            new ScreenCase { Name = "desktop-1280x1024", Mobile = false, Width = 1280, Height = 1024 },
            new ScreenCase { Name = "desktop-2560x1080", Mobile = false, Width = 2560, Height = 1080 },
            new ScreenCase { Name = "desktop-1024x768", Mobile = false, Width = 1024, Height = 768 },
            new ScreenCase { Name = "desktop-1024x576", Mobile = false, Width = 1024, Height = 576 },
            new ScreenCase { Name = "mobile-667x375", Mobile = true, Width = 667, Height = 375 },
            new ScreenCase { Name = "mobile-1536x1152", Mobile = true, Width = 1536, Height = 1152 }
        };

        [MenuItem("Realm of Ashes/Probe/Creator card layout")]
        public static void Run()
        {
            var failures = new List<string>();
            Measure("запасные строки C#", Screens, failures, null, false);
            WithCatalogTexts(() => Measure("каталог сервера", Screens, failures, null, false));
            if (failures.Count > 0)
                throw new InvalidOperationException(Tag + "FAIL: " + string.Join(" | ", failures));
            Debug.Log(Tag + "OK: на " + Screens.Length + " экранах текст создания персонажа не мельче "
                + RoaAuthCanvas.MinTextPixels + " пикселя, умещается в рамки, а все кнопки достижимы — для каталога сервера и для запасных строк.");
        }

        /// <summary>Снимки экрана с текстами каталога — посмотреть глазами, в аудит не входит.</summary>
        [MenuItem("Realm of Ashes/Probe/Creator card layout (снимки)")]
        public static void Capture()
        {
            Directory.CreateDirectory(OutputDir);
            foreach (string stale in Directory.GetFiles(OutputDir, "creator-*.png")) File.Delete(stale);
            var failures = new List<string>();
            WithCatalogTexts(() => Measure("каталог сервера", Screens, failures, OutputDir));
            Debug.Log(Tag + "снимки в " + OutputDir + (failures.Count > 0 ? "; замечания: " + string.Join(" | ", failures) : "; замечаний нет"));
        }

        /// <summary>
        /// Все масштабы канвы подряд: окно 16:9 высотой от 390 до 1440 пикселей с
        /// шагом 6. Нужен, когда новая строка умещается впритык, — в аудит не входит.
        /// </summary>
        [MenuItem("Realm of Ashes/Probe/Creator card layout (все масштабы)")]
        public static void Sweep()
        {
            var screens = new List<ScreenCase>();
            foreach (bool mobile in new[] { false, true })
                for (int height = 390; height <= 1440; height += 6)
                    screens.Add(new ScreenCase
                    {
                        Name = (mobile ? "mobile-" : "desktop-") + (height * 16 / 9) + "x" + height,
                        Mobile = mobile, Width = height * 16 / 9, Height = height
                    });
            var failures = new List<string>();
            WithCatalogTexts(() => Measure("каталог сервера", screens.ToArray(), failures, null, false));
            Debug.Log(Tag + "масштабов: " + screens.Count + (failures.Count > 0
                ? "; замечания (" + failures.Count + "): " + string.Join(" | ", failures) : "; замечаний нет"));
        }

        /// <summary>
        /// На время замера подставляет имена и описания перков из каталога, который
        /// клиент получает с /api/kromka/character-progression, и возвращает запасные.
        /// </summary>
        private static void WithCatalogTexts(Action body)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/kromka/character-progression.json"));
            JArray rows = JObject.Parse(File.ReadAllText(path))["startTraits"]?["items"] as JArray;
            if (rows == null) throw new InvalidOperationException(Tag + "в каталоге нет startTraits.items: " + path);
            var saved = new List<KeyValuePair<string, string>>();
            foreach (RoaCharacterCreator.TraitDef trait in RoaCharacterCreator.Traits)
                saved.Add(new KeyValuePair<string, string>(trait.Name, trait.Description));
            try
            {
                foreach (RoaCharacterCreator.TraitDef trait in RoaCharacterCreator.Traits)
                {
                    JObject row = null;
                    foreach (JToken candidate in rows)
                        if ((string)candidate["id"] == trait.Id) row = candidate as JObject;
                    if (row == null) throw new InvalidOperationException(Tag + "в каталоге нет перка " + trait.Id);
                    trait.Name = (string)row["name"];
                    trait.Description = (string)row["description"];
                }
                body();
            }
            finally
            {
                for (int i = 0; i < saved.Count; i++)
                {
                    RoaCharacterCreator.Traits[i].Name = saved[i].Key;
                    RoaCharacterCreator.Traits[i].Description = saved[i].Value;
                }
            }
        }

        private static void Measure(string source, ScreenCase[] screens, List<string> failures, string captureDir,
                                    bool logScreens = true)
        {
            foreach (ScreenCase screen in screens)
            {
                GameObject host = null;
                GameObject cameraObject = null;
                RenderTexture target = null;
                try
                {
                    Canvas canvas = BuildCreator(screen, out host, out cameraObject, out target);
                    var canvasRect = (RectTransform)canvas.transform;
                    var card = canvasRect.Find("CharacterScreen/CharacterCard") as RectTransform;
                    if (card == null) throw new InvalidOperationException(Tag + "на канвасе нет карточки CharacterCard");
                    string where = source + ", " + screen.Name;

                    // Экран под палец — четыре вкладки: у каждой свой набор подписей и кнопок.
                    var tabs = new List<Button>();
                    foreach (Button button in card.GetComponentsInChildren<Button>(true))
                        if (button.name.StartsWith("Tab-", StringComparison.Ordinal)) tabs.Add(button);
                    if (screen.Mobile && tabs.Count == 0)
                        throw new InvalidOperationException(Tag + screen.Name + ": телефонная раскладка не построила вкладки");

                    if (!Contains(canvasRect.rect, RectIn(card, canvasRect)))
                        failures.Add(where + ": карточка " + Size(RectIn(card, canvasRect)) + " не умещается на канве "
                            + Size(canvasRect.rect));

                    var seen = new HashSet<string>();
                    float smallest = float.MaxValue;
                    for (int state = 0; state < Mathf.Max(1, tabs.Count); state++)
                    {
                        string suffix = string.Empty;
                        if (tabs.Count > 0)
                        {
                            tabs[state].onClick.Invoke();
                            Canvas.ForceUpdateCanvases();
                            suffix = "-" + tabs[state].name.Substring("Tab-".Length);
                        }
                        smallest = Mathf.Min(smallest, CheckTexts(where + suffix, canvas, card, failures));
                        CheckControls(where + suffix, canvasRect, card, screen.Mobile, seen, failures);
                        // Кадр нужен и без снимка: глубину для луча канва раздаёт графике при отрисовке.
                        Camera camera = cameraObject.GetComponent<Camera>();
                        Render(camera, target, captureDir == null ? null
                            : Path.Combine(captureDir, "creator-" + screen.Name + suffix + ".png"));
                        CheckClickable(where + suffix, canvas, card, camera, target, failures);
                    }

                    foreach (string control in ExpectedControls())
                        if (!seen.Contains(control))
                            failures.Add(where + ": кнопки «" + control + "» нет ни на одной вкладке");
                    if (logScreens)
                        Debug.Log(Tag + source + " · " + screen.Name + ": " + (tabs.Count > 0 ? "вкладки" : "колонки")
                            + ", карточка " + Size(card.rect) + " в масштабе " + card.localScale.x.ToString("0.000")
                            + ", канва " + Size(canvasRect.rect) + " в масштабе " + canvas.scaleFactor.ToString("0.000")
                            + ", мельчайший текст " + smallest.ToString("0.0") + " px");
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

        /// <summary>
        /// Кегль на экране и рамка каждой видимой подписи. Кегль — в пикселях экрана:
        /// fontSize × масштаб канвы × масштаб карточки. Рамка: переносимый текст обязан
        /// уместиться по высоте, строка без переноса — по ширине, а по высоте ей хватает
        /// рамки родителя (подпись кнопки центрируется в кнопке, а не в своих отступах).
        /// </summary>
        private static float CheckTexts(string where, Canvas canvas, RectTransform card, List<string> failures)
        {
            float smallest = float.MaxValue;
            foreach (Text text in card.GetComponentsInChildren<Text>(false))
            {
                if (!text.gameObject.activeInHierarchy) continue;
                float pixels = text.fontSize * canvas.scaleFactor * card.localScale.x;
                smallest = Mathf.Min(smallest, pixels);
                if (pixels < RoaAuthCanvas.MinTextPixels - 0.01f)
                    failures.Add(where + ": " + Describe(text) + " — " + pixels.ToString("0.0") + " px на экране (кегль "
                        + text.fontSize + "), предел " + RoaAuthCanvas.MinTextPixels);
                if (string.IsNullOrEmpty(text.text)) continue;

                Rect room = text.rectTransform.rect;
                if (text.horizontalOverflow == HorizontalWrapMode.Wrap)
                {
                    float needed = text.preferredHeight;
                    if (needed > room.height + 0.5f)
                        failures.Add(where + ": " + Describe(text) + " занимает " + text.cachedTextGeneratorForLayout.lineCount
                            + " стр. (" + Mathf.CeilToInt(needed) + " ед.) в рамке " + Mathf.FloorToInt(room.height) + " ед.");
                    continue;
                }
                if (text.preferredWidth > room.width + 0.5f)
                    failures.Add(where + ": " + Describe(text) + " шириной " + Mathf.CeilToInt(text.preferredWidth)
                        + " ед. в рамке " + Mathf.FloorToInt(room.width) + " ед.");
                float parentHeight = ((RectTransform)text.transform.parent).rect.height;
                if (text.preferredHeight > Mathf.Max(room.height, parentHeight) + 0.5f)
                    failures.Add(where + ": " + Describe(text) + " высотой " + Mathf.CeilToInt(text.preferredHeight)
                        + " ед. в рамке " + Mathf.FloorToInt(Mathf.Max(room.height, parentHeight)) + " ед.");
            }
            return smallest;
        }

        /// <summary>
        /// Каждая кнопка и поле ввода: вне прокрутки — целиком на экране; в прокрутке —
        /// внутри её содержимого (иначе до него не докрутить), в её окне по ширине, а
        /// само окно на экране. Под палец — не мельче MinTouchUnits по обеим сторонам.
        /// </summary>
        private static void CheckControls(string where, RectTransform canvasRect, RectTransform card, bool touch,
                                          HashSet<string> seen, List<string> failures)
        {
            foreach (Selectable control in card.GetComponentsInChildren<Selectable>(false))
            {
                if (!control.gameObject.activeInHierarchy) continue;
                seen.Add(control.name);
                var rect = (RectTransform)control.transform;
                string name = "кнопка «" + control.name + "»";
                ScrollRect scroll = control.GetComponentInParent<ScrollRect>();
                if (scroll == null)
                {
                    if (!Contains(canvasRect.rect, RectIn(rect, canvasRect)))
                        failures.Add(where + ": " + name + " " + Size(RectIn(rect, canvasRect)) + " выходит за экран");
                }
                else
                {
                    var window = (RectTransform)scroll.transform;
                    if (!Contains(scroll.content.rect, RectIn(rect, scroll.content)))
                        failures.Add(where + ": " + name + " выходит за содержимое прокрутки — до неё не докрутить");
                    if (!Contains(canvasRect.rect, RectIn(window, canvasRect)))
                        failures.Add(where + ": окно прокрутки с «" + control.name + "» выходит за экран");
                    Rect inWindow = RectIn(rect, window);
                    if (inWindow.xMin < window.rect.xMin - 0.5f || inWindow.xMax > window.rect.xMax + 0.5f)
                        failures.Add(where + ": " + name + " шире окна прокрутки, а вбок оно не крутится");
                }
                Vector2 size = rect.rect.size * card.localScale.x;
                if (touch && (size.x < RoaAuthCanvas.MinTouchUnits - 0.01f || size.y < RoaAuthCanvas.MinTouchUnits - 0.01f))
                    failures.Add(where + ": " + name + " " + size.x.ToString("0") + "×" + size.y.ToString("0")
                        + " ед. — под палец нужно не меньше " + RoaAuthCanvas.MinTouchUnits);
            }
        }

        /// <summary>
        /// Луч GraphicRaycaster в центр каждой кнопки попадает в неё саму: кнопка на
        /// экране, но под чужой подложкой, потеряна так же, как за краем. Списки
        /// листаются по окну за раз: глубину для луча и отсечение маской канва
        /// пересчитывает только при отрисовке, поэтому на каждую страницу — один кадр.
        /// </summary>
        private static void CheckClickable(string where, Canvas canvas, RectTransform card, Camera camera,
                                           RenderTexture target, List<string> failures)
        {
            var pending = new List<Selectable>();
            foreach (Selectable control in card.GetComponentsInChildren<Selectable>(false))
                if (control.gameObject.activeInHierarchy) pending.Add(control);
            ClickVisible(where, canvas, pending, failures);

            var scrolls = new List<ScrollRect>();
            foreach (Selectable control in pending)
            {
                ScrollRect scroll = control.GetComponentInParent<ScrollRect>();
                if (scroll != null && !scrolls.Contains(scroll)) scrolls.Add(scroll);
            }
            foreach (ScrollRect scroll in scrolls)
            {
                float window = ((RectTransform)scroll.transform).rect.height;
                float limit = Mathf.Max(0f, scroll.content.rect.height - window);
                for (float position = window * 0.8f; ; position += window * 0.8f)
                {
                    scroll.content.anchoredPosition = new Vector2(0f, Mathf.Min(position, limit));
                    Canvas.ForceUpdateCanvases();
                    Render(camera, target, null);
                    ClickVisible(where, canvas, pending, failures);
                    if (position >= limit) break;
                }
                scroll.content.anchoredPosition = Vector2.zero;
            }
            Canvas.ForceUpdateCanvases();
            foreach (Selectable control in pending)
                failures.Add(where + ": кнопку «" + control.name + "» не удалось докрутить до окна прокрутки");
        }

        /// <summary>Проверяет лучом те кнопки из списка, чей центр сейчас виден, и убирает их из списка.</summary>
        private static void ClickVisible(string where, Canvas canvas, List<Selectable> pending, List<string> failures)
        {
            var raycaster = canvas.GetComponent<GraphicRaycaster>();
            var hits = new List<RaycastResult>();
            for (int i = pending.Count - 1; i >= 0; i--)
            {
                var rect = (RectTransform)pending[i].transform;
                Vector3 center = rect.TransformPoint(rect.rect.center);
                ScrollRect scroll = pending[i].GetComponentInParent<ScrollRect>();
                if (scroll != null)
                {
                    var window = (RectTransform)scroll.transform;
                    Vector2 inWindow = window.InverseTransformPoint(center);
                    if (!window.rect.Contains(inWindow)) continue; // ещё не долистали
                }
                // Ровно в центре рамки RectangleContainsScreenPoint изредка даёт ложный промах
                // (замерено: точка пересчитывается в самый центр, 24 соседних пикселя из 25 внутри,
                // а она сама — нет). Мышь таких дробных координат не даёт, поэтому при промахе луч
                // сдвигается на долю пикселя; накрытая кнопка не нажмётся ни в одной из точек.
                Vector2 screen = RectTransformUtility.WorldToScreenPoint(canvas.worldCamera, center);
                Transform top = null;
                bool hit = false;
                foreach (Vector2 nudge in Nudges)
                {
                    hits.Clear();
                    raycaster.Raycast(new PointerEventData(null) { position = screen + nudge }, hits);
                    top = hits.Count > 0 ? hits[0].gameObject.transform : null;
                    hit = top != null && (top == rect || top.IsChildOf(rect));
                    if (hit) break;
                }
                if (!hit)
                    failures.Add(where + ": кнопка «" + pending[i].name + "» не нажимается — под лучом "
                        + (top == null ? "ничего" : "«" + top.name + "»"));
                pending.RemoveAt(i);
            }
        }

        private static List<string> ExpectedControls()
        {
            var expected = new List<string> { "CreateCharacter", "CreatorBack", "Input" };
            foreach (string key in new[] { "sex", "body", "face", "hair", "hairColor" })
            {
                expected.Add("Prev-" + key);
                expected.Add("Next-" + key);
            }
            foreach (RoaCharacterCreator.StatDef stat in RoaCharacterCreator.Stats)
            {
                expected.Add("Stat-" + stat.Id + "-minus");
                expected.Add("Stat-" + stat.Id + "-plus");
            }
            foreach (RoaProgressionData.SkillDef skill in RoaProgressionData.Skills) expected.Add("Skill-" + skill.Id);
            foreach (RoaCharacterCreator.TraitDef trait in RoaCharacterCreator.Traits) expected.Add("Trait-" + trait.Id);
            return expected;
        }

        /// <summary>«Trait-bruiser/Desc „+18 ОЗ…“» — чтобы по сообщению было видно, какую строку править.</summary>
        private static string Describe(Text text)
        {
            string content = (text.text ?? string.Empty).Replace('\n', ' ');
            if (content.Length > 48) content = content.Substring(0, 48) + "…";
            return "подпись " + text.transform.parent.name + "/" + text.name + " «" + content + "»";
        }

        private static Rect RectIn(RectTransform rect, RectTransform space)
        {
            rect.GetWorldCorners(Corners);
            Vector2 min = space.InverseTransformPoint(Corners[0]);
            Vector2 max = space.InverseTransformPoint(Corners[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        private static bool Contains(Rect outer, Rect inner)
        {
            return inner.xMin >= outer.xMin - 0.5f && inner.xMax <= outer.xMax + 0.5f
                && inner.yMin >= outer.yMin - 0.5f && inner.yMax <= outer.yMax + 0.5f;
        }

        private static string Size(Rect rect)
        {
            return rect.width.ToString("0") + "×" + rect.height.ToString("0");
        }

        /// <summary>
        /// Экран создания персонажа теми же методами, что зовёт RoaAuthCanvas.Update.
        /// Хост пересоздаётся под каждый размер. Порядок обязателен — масштабер раньше
        /// постройки: раскладка считается от размера и масштаба канвы, иначе выйдет
        /// настольная расстановка на телефонном холсте. RefreshPreview не зовём: он идёт
        /// в сеть за GLB. Цвет волос берётся с самым длинным названием — его строка
        /// самая тесная.
        /// </summary>
        private static Canvas BuildCreator(ScreenCase screen, out GameObject host, out GameObject cameraObject,
                                           out RenderTexture target)
        {
            host = new GameObject("CreatorCardLayoutProbe");
            var bootstrap = host.AddComponent<RoaGameBootstrap>();
            bootstrap.enabled = false;
            var auth = host.AddComponent<RoaAuthCanvas>();
            auth.enabled = false;
            auth.Bootstrap = bootstrap;
            auth.TouchLayoutOverride = screen.Mobile;
            Invoke(auth, "EnsureBuilt");

            RoaCharacterCreator creator = bootstrap.Creator;
            int longest = 0;
            for (int i = 0; i < 16; i++)
            {
                creator.CycleHairColor(1);
                longest = Mathf.Max(longest, creator.HairColorLabelText.Length);
            }
            for (int i = 0; i < 16 && creator.HairColorLabelText.Length < longest; i++) creator.CycleHairColor(1);

            Canvas canvas = host.GetComponentInChildren<Canvas>(true);
            if (canvas == null) throw new InvalidOperationException(Tag + "канвас входа не построился");
            RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), screen.Mobile);

            // ScreenSpaceOverlay в пакетном режиме не знает размера экрана: канвас
            // переводится на выключенную камеру с текстурой нужного размера.
            SetLayerRecursively(canvas.gameObject, CaptureLayer);
            cameraObject = new GameObject("CreatorCardLayoutCamera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.enabled = false;
            camera.cullingMask = 1 << CaptureLayer;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.03f, 0.035f, 0.04f, 1f);
            target = new RenderTexture(screen.Width, screen.Height, 24, RenderTextureFormat.ARGB32)
            {
                name = "CreatorCardLayout_" + screen.Name,
                antiAliasing = 1
            };
            target.Create();
            camera.targetTexture = target;
            canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = camera;
            canvas.planeDistance = 1f;

            Canvas.ForceUpdateCanvases();
            Invoke(auth, "RebuildBody", "creator");
            Invoke(auth, "FitCardToViewport");
            Invoke(auth, "RebuildCreatorDynamic");
            Invoke(auth, "RefreshTexts", "creator");
            SetLayerRecursively(canvas.gameObject, CaptureLayer);
            Canvas.ForceUpdateCanvases();

            Vector2 expected = RoaMobileLayoutProbe.CanvasSize(new Vector2(screen.Width, screen.Height),
                RoaUiScale.ReferenceFor(screen.Mobile));
            Rect actual = ((RectTransform)canvas.transform).rect;
            if (Mathf.Abs(actual.width - expected.x) > 1f || Mathf.Abs(actual.height - expected.y) > 1f)
                throw new InvalidOperationException(Tag + screen.Name + ": канва " + actual.width + "×" + actual.height
                    + " вместо " + expected.x + "×" + expected.y + " — замер шёл бы не на том масштабе");
            return canvas;
        }

        private static void Render(Camera camera, RenderTexture target, string path)
        {
            RenderTexture previous = RenderTexture.active;
            Texture2D readback = null;
            try
            {
                if (GraphicsSettings.currentRenderPipeline != null)
                {
                    var request = new RenderPipeline.StandardRequest { destination = target };
                    RenderPipeline.SubmitRenderRequest(camera, request);
                }
                else camera.Render();
                if (path == null) return;
                RenderTexture.active = target;
                readback = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
            }
        }

        private static void Invoke(RoaAuthCanvas auth, string method, params object[] args)
        {
            MethodInfo info = typeof(RoaAuthCanvas).GetMethod(method, Private);
            if (info == null) throw new MissingMethodException(typeof(RoaAuthCanvas).FullName, method);
            info.Invoke(auth, args);
        }

        private static void SetLayerRecursively(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform) SetLayerRecursively(child.gameObject, layer);
        }
    }
}
#endif
