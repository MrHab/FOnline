#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Карточки навыков и стартовых перков в редакторе персонажа: текст обязан
    /// уместиться в свою карточку.
    ///
    /// Описание перка пишут в data/kromka/character-progression.json, далеко от
    /// кода карточки, а у подписи VerticalWrapMode.Overflow: лишняя строка не
    /// обрезается, а вылезает под карточку на соседнюю. Ни одна строковая проверка
    /// этого не видит. Поэтому проба строит настоящий экран RoaAuthCanvas — тем же
    /// кодом, что и игра, — на настольных и альбомных телефонных размерах (перенос
    /// зависит от масштаба канвы: шрифт растрируется в пикселях экрана) и сравнивает
    /// высоту каждой подписи с её рамкой. Меряются и строки каталога, которые
    /// присылает сервер, и запасные строки C#.
    /// </summary>
    public static class RoaCreatorCardLayoutProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string Tag = "[CREATOR CARD LAYOUT] ";
        private static readonly string OutputDir = Path.Combine("Library", "AgentCaptures");
        /// <summary>Тот же слой, что у превью персонажа: в edit mode он свободен.</summary>
        private const int CaptureLayer = 31;

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
            new ScreenCase { Name = "mobile-844x390", Mobile = true, Width = 844, Height = 390 }
        };

        [MenuItem("Realm of Ashes/Probe/Creator card layout")]
        public static void Run()
        {
            var failures = new List<string>();
            Measure("запасные строки C#", Screens, failures, null, false);
            WithCatalogTexts(() => Measure("каталог сервера", Screens, failures, null, false));
            if (failures.Count > 0)
                throw new InvalidOperationException(Tag + "FAIL: " + string.Join(" | ", failures));
            Debug.Log(Tag + "OK: подписи карточек навыков и стартовых перков умещаются в свои рамки на "
                + Screens.Length + " экранах, для каталога сервера и для запасных строк.");
        }

        /// <summary>Снимки экрана с текстами каталога — посмотреть глазами, в аудит не входит.</summary>
        [MenuItem("Realm of Ashes/Probe/Creator card layout (снимки)")]
        public static void Capture()
        {
            Directory.CreateDirectory(OutputDir);
            var failures = new List<string>();
            WithCatalogTexts(() => Measure("каталог сервера", Screens, failures, OutputDir));
            Debug.Log(Tag + "снимки в " + OutputDir + (failures.Count > 0 ? "; не умещается: " + string.Join(" | ", failures) : "; всё умещается"));
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
                ? "; не умещается (" + failures.Count + "): " + string.Join(" | ", failures) : "; всё умещается"));
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
                                    bool logCards = true)
        {
            foreach (ScreenCase screen in screens)
            {
                GameObject host = null;
                GameObject cameraObject = null;
                RenderTexture target = null;
                try
                {
                    Canvas canvas = BuildCreator(screen, out host, out cameraObject, out target);
                    int cards = 0;
                    foreach (Button card in host.GetComponentsInChildren<Button>(true))
                    {
                        bool trait = card.name.StartsWith("Trait-", StringComparison.Ordinal);
                        if (!trait && !card.name.StartsWith("Skill-", StringComparison.Ordinal)) continue;
                        cards++;
                        // Карточка обязана занять ширину списка: иначе раскладка не
                        // отработала и замер покажет переполнение там, где его нет.
                        float listWidth = ((RectTransform)card.transform.parent).rect.width;
                        float cardWidth = ((RectTransform)card.transform).rect.width;
                        if (cardWidth < listWidth * 0.9f)
                            throw new InvalidOperationException(Tag + screen.Name + ": карточка " + card.name + " шириной "
                                + cardWidth + " в списке " + listWidth + " — раскладка списка не применилась");
                        Text title = card.transform.Find("Title").GetComponent<Text>();
                        Text desc = card.transform.Find("Desc").GetComponent<Text>();
                        Rect room = desc.rectTransform.rect;
                        float needed = desc.preferredHeight;
                        int lines = desc.cachedTextGeneratorForLayout.lineCount;
                        if (trait && logCards)
                            Debug.Log(Tag + source + " · " + screen.Name + " · " + card.name + ": " + lines + " стр., "
                                + needed.ToString("0.0") + " / " + room.height.ToString("0.0") + " ед. при ширине "
                                + room.width.ToString("0.0") + " (масштаб канвы " + canvas.scaleFactor.ToString("0.000") + ")");
                        if (needed > room.height + 0.01f)
                            failures.Add(source + ", " + screen.Name + ": описание «" + title.text + "» занимает " + lines
                                + " стр. (" + Mathf.CeilToInt(needed) + " ед.) в рамке " + Mathf.FloorToInt(room.height)
                                + " ед. и вылезает из карточки: " + desc.text);
                        if (title.preferredWidth > title.rectTransform.rect.width + 0.01f)
                            failures.Add(source + ", " + screen.Name + ": заголовок «" + title.text + "» шире карточки");
                    }
                    if (cards < RoaCharacterCreator.Traits.Length + 1)
                        throw new InvalidOperationException(Tag + "экран создания персонажа не построил карточки: " + cards);
                    if (captureDir != null) Render(canvas, cameraObject.GetComponent<Camera>(), target,
                        Path.Combine(captureDir, "creator-" + screen.Name + ".png"));
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
        /// Экран создания персонажа теми же методами, что зовёт RoaAuthCanvas.Update.
        /// Хост пересоздаётся под каждый размер: Destroy в edit mode отложен. Порядок
        /// обязателен — масштабер раньше вписывания карточки, иначе выйдет настольная
        /// раскладка на телефонном холсте. RefreshPreview не зовём: он идёт в сеть за GLB.
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
            Invoke(auth, "EnsureBuilt");

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
            // AddComponent в редакторе зовёт Reset(), а у групп раскладки он выключает
            // childControlWidth. В сборке Reset не вызывается, и остаётся true из
            // инициализатора поля; RoaAuthCanvas ширину не трогает. Без этой строки
            // карточки остаются шириной 100 единиц — ловушка edit mode, а не клиента.
            foreach (HorizontalOrVerticalLayoutGroup group in canvas.GetComponentsInChildren<HorizontalOrVerticalLayoutGroup>(true))
                group.childControlWidth = true;
            Invoke(auth, "FitCardToViewport");
            Invoke(auth, "RebuildCreatorDynamic");
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

        private static void Render(Canvas canvas, Camera camera, RenderTexture target, string path)
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
