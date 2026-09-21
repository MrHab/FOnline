#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Окно станка, круг быстрых слотов и баннер у края локации: проба строит их
    /// настоящим кодом канв, проверяет, что подписи помещаются в свои рамки и не
    /// мельчают ниже читаемого размера, и пишет снимки в Library/StationHudScreen.
    /// Рецепт съёмки — RoaAuctionSinCaptureProbe.
    /// </summary>
    public static class RoaStationHudCaptureProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private static readonly string OutputDir = Path.Combine("Library", "StationHudScreen");
        private const int CaptureLayer = 31;
        private const string StationObjectId = "probe_station";
        /// <summary>Ниже этого размера в экранных пикселях вложенный Noto Sans теряет форму букв.</summary>
        private const float MinReadablePixels = 10.5f;

        [MenuItem("Realm of Ashes/Probe/Station window, quick radial and exit banner")]
        public static void Run()
        {
            Directory.CreateDirectory(OutputDir);
            var failures = new List<string>();
            bool useFocus = RoaCraftingPlots.UseFocus;
            try
            {
                RoaCraftingPlots.UseFocus = true;
                CaptureStation("station-plot-desktop", true, false, 1440, 810, failures);
                CaptureStation("station-plot-laptop", true, false, 1280, 720, failures);
                CaptureStation("station-workshop-desktop", false, false, 1440, 810, failures);
                CaptureStation("station-plot-mobile", true, true, 844, 390, failures);
            }
            finally
            {
                RoaCraftingPlots.UseFocus = useFocus;
                RoaCraftingPlots.Clear();
            }

            CaptureHud("hud-exit-radial-desktop", false, 1440, 810, failures);
            CaptureHud("hud-locked-radial-laptop", true, 1280, 720, failures);
            CaptureHud("hud-exit-radial-fullhd", false, 1920, 1080, failures);
            CaptureHud("hud-exit-radial-low", false, 1024, 540, failures);

            if (failures.Count > 0)
                throw new InvalidOperationException("[STATION HUD] FAIL: " + string.Join("; ", failures));
            Debug.Log("[STATION HUD] OK: окно станка, круг быстрых слотов и баннер выхода помещают подписи; снимки в " + OutputDir);
        }

        // ------------------------------------------------------------------
        // Окно станка

        private static string BusiestStation()
        {
            return RoaCraftingData.Recipes
                .GroupBy(recipe => recipe.Station)
                .OrderByDescending(group => group.Count())
                .ThenBy(group => group.Key, StringComparer.Ordinal)
                .First().Key;
        }

        private static JObject Self(string station)
        {
            var inventory = new JArray { new JObject { ["id"] = "silver", ["qty"] = 50000 } };
            // Материалов хватает только на первый рецепт: у остальных видна строка нехватки.
            RoaCraftRecipe first = RoaCraftingData.Recipes.First(recipe => recipe.Station == station);
            foreach (KeyValuePair<string, int> cost in first.Cost)
                inventory.Add(new JObject { ["id"] = cost.Key, ["qty"] = cost.Value });
            return new JObject
            {
                ["name"] = "Странник",
                ["inventory"] = inventory,
                ["account"] = new JObject
                {
                    ["premium"] = true,
                    ["focus"] = 40,
                    ["focusCap"] = 30000
                }
            };
        }

        private static JObject PlotState(string station)
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return new JObject
            {
                ["ok"] = true,
                ["locationId"] = "sluiceCity",
                ["plots"] = new JArray
                {
                    new JObject
                    {
                        ["plotId"] = "sluiceCity:" + StationObjectId,
                        ["objectId"] = StationObjectId,
                        ["station"] = station,
                        ["leased"] = true,
                        ["mine"] = true,
                        ["lesseeName"] = "Странник",
                        ["leaseEndsAt"] = now + 20L * 3600000L,
                        ["feePct"] = 0.12,
                        ["maxFeePct"] = 0.3,
                        ["returnRate"] = 0.15,
                        ["focusReturnRate"] = 0.4,
                        ["auction"] = new JObject
                        {
                            ["open"] = true,
                            ["highestBid"] = 12500,
                            ["leading"] = false,
                            ["bidderName"] = "Константин Долгорукий",
                            ["minBid"] = 13125,
                            ["endsAt"] = now + 19L * 3600000L
                        }
                    }
                }
            };
        }

        private static void CaptureStation(string name, bool plot, bool mobile, int width, int height, List<string> failures)
        {
            GameObject host = null;
            try
            {
                string station = BusiestStation();
                RoaCraftingPlots.Clear();
                if (plot) RoaCraftingPlots.Apply(PlotState(station));

                host = new GameObject("StationCaptureProbe");
                var interaction = host.AddComponent<RoaInteraction>();
                interaction.enabled = false;
                Set(interaction, "_panel", "Crafting");
                Set(interaction, "_self", Self(station));
                Set(interaction, "_active", new JObject
                {
                    ["id"] = StationObjectId,
                    ["name"] = RoaCraftingData.StationLabel(station),
                    ["station"] = station
                });
                Set(interaction, "_status", "Создано: " + RoaItemData.Name("pistol") + " x1 · фокус −120");
                Set(interaction, "_statusUntil", float.MaxValue);

                var screen = host.AddComponent<RoaCraftingCanvas>();
                screen.enabled = false;
                screen.Interaction = interaction;
                Call(screen, "EnsureBuilt");
                ((GameObject)Get(screen, "_root")).SetActive(true);

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
                Render(canvas, width, height, Path.Combine(OutputDir, name + ".png"), () =>
                {
                    Call(screen, "Refresh");
                    typeof(RoaCraftingCanvas).GetMethod("RefreshPlotButtons", Private)
                        .Invoke(screen, new object[] { interaction.CraftingPlot });
                    Canvas.ForceUpdateCanvases();
                    CheckStation(name, screen, canvas, plot, mobile, failures);
                }, () => CheckClickable(name, screen, canvas, plot, failures));
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void CheckStation(string name, RoaCraftingCanvas screen, Canvas canvas, bool plot, bool mobile,
                                         List<string> failures)
        {
            string all = string.Join("\n", ActiveTexts(canvas.gameObject).Select(text => text.text ?? string.Empty));
            var expected = new List<string> { "Крафт: ", "Материалы: ", "комиссия: ", "Создать", "Не хватает материалов или марок.", "Создано: " };
            if (plot)
                expected.AddRange(new[]
                {
                    "Участок поселения", "возврат материалов 15%", "Арендатор: вы", "сами работаете бесплатно",
                    "ставка 12500 марок (Константин Долгорукий)", "Ставку делают у таблички участка", "Плата, %:",
                    "Назначить плату", "Тратить фокус: возврат материалов 40%", "Фокус: 40 / 30000",
                    "Фокус на заказ: ", "не хватает, заказ пройдёт без фокуса", "Комиссия уходит арендатору участка"
                });
            else expected.Add("Комиссия поступает владельцу мастерской.");
            foreach (string text in expected)
                if (!all.Contains(text)) failures.Add(name + ": нет текста «" + text + "»");
            if (!plot && (all.Contains("Участок поселения") || all.Contains("Тратить фокус")))
                failures.Add(name + ": у станка без участка показаны участок или фокус");

            if (plot)
            {
                var fee = (InputField)Get(screen, "_feeInput");
                if (fee.text != "12") failures.Add(name + ": плата по умолчанию «" + fee.text + "»");
                if (!((Button)Get(screen, "_feeButton")).interactable) failures.Add(name + ": допустимую плату нельзя назначить");
                if (!((GameObject)Get(screen, "_focusMark")).activeSelf) failures.Add(name + ": галочка фокуса не отражает настройку");
            }

            // Карточки занимают ширину списка: иначе перенос строк считается по чужой ширине.
            var list = (RectTransform)Get(screen, "_list");
            foreach (RectTransform card in list)
            {
                if (!card.gameObject.activeSelf || card.GetComponent<Image>() == null) continue;
                if (Mathf.Abs(card.rect.width - (list.rect.width - 8f)) > 1f)
                    failures.Add(name + ": карточка " + card.name + " шириной " + card.rect.width.ToString("0") + " при списке " + list.rect.width.ToString("0"));
            }

            var panel = (RectTransform)Get(screen, "_panel");
            var canvasRect = (RectTransform)canvas.transform;
            if (panel.rect.height > canvasRect.rect.height || panel.rect.width > canvasRect.rect.width)
                failures.Add(name + ": окно " + panel.rect.size + " больше экрана " + canvasRect.rect.size);

            CheckTextFit(name, canvas, failures);
            // Телефон: все окна взаимодействия пока собраны в общих единицах канвы без мобильного кегля.
            if (!mobile) CheckReadable(name, canvas, failures);
        }

        /// <summary>
        /// Кнопки окна должны получать нажатие сами: затемнение, область
        /// прокрутки или соседняя подпись не вправе перехватывать луч. Глубину
        /// графики канва раздаёт только при отрисовке, поэтому проверка идёт после неё.
        /// </summary>
        private static void CheckClickable(string name, RoaCraftingCanvas screen, Canvas canvas, bool plot, List<string> failures)
        {
            var raycaster = canvas.GetComponent<GraphicRaycaster>();
            var panel = (RectTransform)Get(screen, "_panel");
            var list = (RectTransform)Get(screen, "_list");
            var targets = new List<KeyValuePair<string, GameObject>>
            {
                new KeyValuePair<string, GameObject>("закрыть", panel.Find("Close").gameObject),
                new KeyValuePair<string, GameObject>("создать", list.GetComponentsInChildren<Button>()
                    .First(button => button.name == "Craft").gameObject)
            };
            if (plot)
            {
                targets.Add(new KeyValuePair<string, GameObject>("назначить плату", ((Button)Get(screen, "_feeButton")).gameObject));
                targets.Add(new KeyValuePair<string, GameObject>("тратить фокус", (GameObject)Get(screen, "_focusToggleRow")));
            }

            foreach (KeyValuePair<string, GameObject> target in targets)
            {
                Vector2 center = ScreenRect(target.Value).center;
                GameObject hit = null;
                // Ровно в центре рамки луч изредка даёт ложный промах — второй заход со сдвигом.
                foreach (Vector2 offset in new[] { Vector2.zero, new Vector2(0.37f, 0.37f) })
                {
                    var results = new List<UnityEngine.EventSystems.RaycastResult>();
                    raycaster.Raycast(new UnityEngine.EventSystems.PointerEventData(null) { position = center + offset }, results);
                    hit = results.Count > 0 ? results[0].gameObject : null;
                    if (hit != null && hit.transform.IsChildOf(target.Value.transform)) break;
                }
                if (hit == null || !hit.transform.IsChildOf(target.Value.transform))
                    failures.Add(name + ": нажатие «" + target.Key + "» получает " + (hit != null ? Trail(hit.transform) : "никто"));
            }
        }

        // ------------------------------------------------------------------
        // Круг быстрых слотов и баннер выхода

        private static void CaptureHud(string name, bool locked, int width, int height, List<string> failures)
        {
            GameObject host = null;
            GameObject boundaryObject = null;
            PropertyInfo current = typeof(RoaWorldExitBoundary).GetProperty("Current");
            try
            {
                var self = new JObject
                {
                    ["inventory"] = new JArray
                    {
                        new JObject { ["id"] = "ammo9", ["qty"] = 120 },
                        new JObject { ["id"] = "machineGun", ["qty"] = 1 },
                        new JObject { ["id"] = "pistol", ["qty"] = 1 }
                    },
                    ["equipmentRuntime"] = new JObject { ["weapon"] = "pistol" }
                };

                host = new GameObject("StationHudCaptureProbe");
                var hud = host.AddComponent<RoaHud>();
                Set(hud, "_selfId", "capture-player");
                Set(hud, "_name", "Странник");
                Set(hud, "_hp", 74);
                Set(hud, "_maxHp", 100);
                var inventory = host.AddComponent<RoaInventory>();
                inventory.enabled = false;
                typeof(RoaInventory).GetMethod("ApplySelf", Private).Invoke(inventory, new object[] { self });

                var quickbar = host.AddComponent<RoaQuickbar>();
                quickbar.enabled = false;
                Set(quickbar, "_inventory", inventory);
                var slots = (string[])Get(quickbar, "_slots");
                slots[0] = "pistol";      // экипирован
                slots[1] = "ammo9";       // длинное имя с количеством
                slots[2] = "machineGun";  // под курсором
                slots[4] = "laserPistol"; // назначен, но предмета уже нет
                Set(quickbar, "_radialOpen", true);
                Set(quickbar, "_radialSelected", 2);

                boundaryObject = new GameObject("ExitBoundaryProbe");
                var boundary = boundaryObject.AddComponent<RoaWorldExitBoundary>();
                Set(boundary, "_exitAllowed", !locked);
                Set(boundary, "_distanceToEdge", RoaWorldExitBoundary.ExitBandTileCount * RoaCoords.Tile + (locked ? 1.5f : 7.4f));
                current.SetValue(null, boundary);

                var owner = host.AddComponent<RoaHudCanvas>();
                owner.enabled = false;
                owner.Configure(hud, quickbar, null, null, null);
                Canvas canvas = host.GetComponentInChildren<Canvas>(true);

                Render(canvas, width, height, Path.Combine(OutputDir, name + ".png"), () =>
                {
                    Call(owner, "Update");
                    // В пакетном режиме Screen — не размер снимка: круг раскладывается по кадру пробы.
                    Vector2 center = RoaQuickbar.ClampRadialCenter(new Vector2(width * 0.5f, height * 0.62f), width, height);
                    typeof(RoaHudCanvas).GetMethod("LayoutQuickRadial", Private)
                        .Invoke(owner, new object[] { center, width, height, canvas.scaleFactor });
                    Canvas.ForceUpdateCanvases();
                    CheckHud(name, owner, canvas, locked, width, height, failures);
                }, null);
            }
            finally
            {
                current.SetValue(null, null);
                if (boundaryObject != null) UnityEngine.Object.DestroyImmediate(boundaryObject);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void CheckHud(string name, RoaHudCanvas owner, Canvas canvas, bool locked, int width, int height,
                                     List<string> failures)
        {
            if (!owner.ExitBannerVisible) failures.Add(name + ": баннер у края локации не показан");
            if (!owner.QuickRadialVisible) failures.Add(name + ": круг быстрых слотов не показан");

            string all = string.Join("\n", ActiveTexts(canvas.gameObject).Select(text => text.text ?? string.Empty));
            string[] expected = locked
                ? new[] { "ГРАНИЦА ЛОКАЦИИ", "Выход закрыт до завершения задания", "выбери\nи отпусти", "×120", "9mm пистолет", "Патроны 9mm" }
                : new[] { "ВЫХОД: ", "Пересеките золотую полосу  •  8 м", "выбери\nи отпусти", "×120", "9mm пистолет", "Патроны 9mm" };
            foreach (string text in expected)
                if (!all.Contains(text)) failures.Add(name + ": нет текста «" + text + "»");

            var banner = (GameObject)Get(owner, "_exitBanner");
            foreach (string field in new[] { "_pvpPanel", "_connectionPanel", "_playerPanel", "_mapPanel" })
            {
                var other = (GameObject)Get(owner, field);
                if (other != null && other.activeInHierarchy && ScreenRect(banner).Overlaps(ScreenRect(other)))
                    failures.Add(name + ": баннер выхода перекрывает " + other.name);
            }

            var slots = (RectTransform[])Get(owner, "_radialSlotRects");
            var hint = (RectTransform)Get(owner, "_radialHintRect");
            var screen = new Rect(0f, 0f, width, height);
            for (int i = 0; i < slots.Length; i++)
            {
                Rect slot = ScreenRect(slots[i].gameObject);
                if (slot.xMin < screen.xMin - 0.5f || slot.yMin < screen.yMin - 0.5f
                    || slot.xMax > screen.xMax + 0.5f || slot.yMax > screen.yMax + 0.5f)
                    failures.Add(name + ": слот " + (i + 1) + " круга выходит за экран");
                if (Shrink(slot).Overlaps(Shrink(ScreenRect(slots[(i + 1) % slots.Length].gameObject))))
                    failures.Add(name + ": слоты " + (i + 1) + " и " + ((i + 1) % slots.Length + 1) + " круга перекрываются");
                if (Shrink(slot).Overlaps(Shrink(ScreenRect(hint.gameObject))))
                    failures.Add(name + ": слот " + (i + 1) + " круга перекрывает подсказку в центре");
            }

            // Номер слева и количество справа делят одну строку и не должны встретиться.
            var numbers = (Text[])Get(owner, "_radialSlotNumbers");
            var counts = (Text[])Get(owner, "_radialSlotCounts");
            for (int i = 0; i < slots.Length; i++)
            {
                if (string.IsNullOrEmpty(counts[i].text)) continue;
                float band = numbers[i].rectTransform.rect.width;
                float used = numbers[i].preferredWidth + counts[i].preferredWidth + 3f;
                if (used > band)
                    failures.Add(name + ": номер и количество слота " + (i + 1) + " занимают " + used.ToString("0.#") + " из " + band.ToString("0.#"));
            }

            // Раскладка круга обязана совпадать с выбором RoaQuickbar: сектор под центром слота — этот слот.
            Vector2 radialCenter = ScreenRect(((GameObject)Get(owner, "_radialRoot"))).center;
            for (int i = 0; i < slots.Length; i++)
            {
                Vector2 delta = ScreenRect(slots[i].gameObject).center - radialCenter;
                // У выбора ось Y смотрит вниз, у канвы — вверх.
                int picked = RoaQuickbar.RadialSelection(new Vector2(delta.x, -delta.y), slots.Length);
                if (picked != i) failures.Add(name + ": слот " + (i + 1) + " нарисован в секторе слота " + (picked + 1));
            }

            CheckTextFit(name, canvas, failures);
            // Круг держит кегль в пикселях экрана сам; баннер живёт в единицах HUD и на
            // окне ниже 720 строк мельчает вместе со всем HUD.
            var radial = (GameObject)Get(owner, "_radialRoot");
            if (height >= 720) CheckReadable(name, canvas, failures, radial, banner);
            else CheckReadable(name, canvas, failures, radial);
        }

        private static Rect Shrink(Rect rect)
        {
            return new Rect(rect.x + 0.5f, rect.y + 0.5f, rect.width - 1f, rect.height - 1f);
        }

        private static Rect ScreenRect(GameObject go)
        {
            var corners = new Vector3[4];
            ((RectTransform)go.transform).GetWorldCorners(corners);
            Canvas canvas = go.GetComponentInParent<Canvas>().rootCanvas;
            Vector2 min = RectTransformUtility.WorldToScreenPoint(canvas.worldCamera, corners[0]);
            Vector2 max = RectTransformUtility.WorldToScreenPoint(canvas.worldCamera, corners[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        // ------------------------------------------------------------------
        // Общие проверки и съёмка

        private static IEnumerable<Text> ActiveTexts(GameObject root)
        {
            return root.GetComponentsInChildren<Text>(true).Where(text => text.gameObject.activeInHierarchy);
        }

        /// <summary>Подпись помещается в рамку: одна строка — по ширине, переносимая — по высоте.</summary>
        private static void CheckTextFit(string name, Canvas canvas, List<string> failures)
        {
            foreach (Text text in ActiveTexts(canvas.gameObject))
            {
                if (string.IsNullOrEmpty(text.text)) continue;
                Rect rect = text.rectTransform.rect;
                if (text.horizontalOverflow == HorizontalWrapMode.Overflow)
                {
                    if (text.preferredWidth > rect.width + 0.5f)
                        failures.Add(name + ": «" + OneLine(text.text) + "» шириной " + text.preferredWidth.ToString("0.#")
                            + " не помещается в " + rect.width.ToString("0.#") + " (" + Trail(text.transform) + ")");
                    continue;
                }
                // Рамка привязана к пикселям и может потерять до пикселя ширины.
                float inner = Mathf.Max(1f, rect.width - 2f / Mathf.Max(0.01f, canvas.scaleFactor));
                TextGenerationSettings settings = text.GetGenerationSettings(new Vector2(inner, 0f));
                float wrapped = text.cachedTextGeneratorForLayout.GetPreferredHeight(text.text, settings) / text.pixelsPerUnit;
                if (wrapped > rect.height + 1f)
                    failures.Add(name + ": «" + OneLine(text.text) + "» высотой " + wrapped.ToString("0.#")
                        + " не помещается в " + rect.height.ToString("0.#") + " (" + Trail(text.transform) + ")");
                string longest = text.text.Split(' ', '\n').OrderByDescending(word => word.Length).First();
                TextGenerationSettings single = text.GetGenerationSettings(Vector2.zero);
                float word = text.cachedTextGeneratorForLayout.GetPreferredWidth(longest, single) / text.pixelsPerUnit;
                if (word > rect.width + 0.5f)
                    failures.Add(name + ": слово «" + longest + "» шириной " + word.ToString("0.#")
                        + " шире рамки " + rect.width.ToString("0.#") + " (" + Trail(text.transform) + ")");
            }
        }

        private static void CheckReadable(string name, Canvas canvas, List<string> failures, params GameObject[] roots)
        {
            IEnumerable<Text> texts = roots.Length == 0
                ? ActiveTexts(canvas.gameObject)
                : roots.SelectMany(root => ActiveTexts(root));
            foreach (Text text in texts)
            {
                if (string.IsNullOrEmpty(text.text)) continue;
                float pixels = text.fontSize * canvas.scaleFactor * text.transform.lossyScale.x / canvas.transform.lossyScale.x;
                if (pixels < MinReadablePixels)
                    failures.Add(name + ": «" + OneLine(text.text) + "» — " + pixels.ToString("0.#") + " px (" + Trail(text.transform) + ")");
            }
        }

        private static string OneLine(string text)
        {
            text = text.Replace('\n', ' ');
            return text.Length > 40 ? text.Substring(0, 39) + "…" : text;
        }

        private static string Trail(Transform transform)
        {
            var parts = new List<string>();
            for (Transform node = transform; node != null && node.GetComponent<Canvas>() == null; node = node.parent)
                parts.Add(node.name);
            parts.Reverse();
            return string.Join("/", parts);
        }

        private static void Render(Canvas canvas, int width, int height, string path, Action afterScale, Action afterRender)
        {
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                SetLayerRecursively(canvas.gameObject, CaptureLayer);
                cameraObject = new GameObject("StationHudCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.30f, 0.33f, 0.36f, 1f);
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { name = "StationHud", antiAliasing = 4 };
                target.Create();
                camera.targetTexture = target;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                // Масштаб канвы считается от кадра камеры — до него раскладку мерить нельзя.
                Canvas.ForceUpdateCanvases();
                afterScale();
                SetLayerRecursively(canvas.gameObject, CaptureLayer);
                Canvas.ForceUpdateCanvases();

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
                afterRender?.Invoke();
            }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (target != null)
                {
                    target.Release();
                    UnityEngine.Object.DestroyImmediate(target);
                }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        private static void Set(object target, string field, object value)
        {
            FieldInfo info = target.GetType().GetField(field, Private);
            if (info == null) throw new MissingFieldException(target.GetType().Name, field);
            info.SetValue(target, value is string text && info.FieldType.IsEnum ? Enum.Parse(info.FieldType, text) : value);
        }

        private static object Get(object target, string field)
        {
            FieldInfo info = target.GetType().GetField(field, Private);
            if (info == null) throw new MissingFieldException(target.GetType().Name, field);
            return info.GetValue(target);
        }

        private static object Call(object target, string method)
        {
            MethodInfo info = target.GetType().GetMethod(method, Private);
            if (info == null) throw new MissingMethodException(target.GetType().Name, method);
            return info.Invoke(target, null);
        }

        private static void SetLayerRecursively(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform) SetLayerRecursively(child.gameObject, layer);
        }
    }
}
#endif
