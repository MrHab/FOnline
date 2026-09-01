using System;
using System.IO;
using System.Linq;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaGlobalMapPresentationProbe
    {
        [MenuItem("Realm of Ashes/Проверить представление глобальной карты")]
        public static void Run()
        {
            GameObject probe = null;
            try
            {
                Check(RoaGlobalMap.DetailTierDisplayName(RoaGlobalMap.MapDetailTier.Near) == "РАЙОН"
                      && RoaGlobalMap.DetailTierDisplayName(RoaGlobalMap.MapDetailTier.Medium) == "ОКРУГА"
                      && RoaGlobalMap.DetailTierDisplayName(RoaGlobalMap.MapDetailTier.Far) == "РЕГИОН",
                    "масштаб карты не объяснён игроку");

                RoaGlobalMap.MapPresentationProfile far =
                    RoaGlobalMap.PresentationProfile(RoaGlobalMap.MapDetailTier.Far);
                RoaGlobalMap.MapPresentationProfile medium =
                    RoaGlobalMap.PresentationProfile(RoaGlobalMap.MapDetailTier.Medium);
                RoaGlobalMap.MapPresentationProfile near =
                    RoaGlobalMap.PresentationProfile(RoaGlobalMap.MapDetailTier.Near);
                Check(far.TerritoryFill && !far.TerritoryBorder && !far.Sites
                      && !far.Parties && !far.Threats && far.OverlayLabelLimit == 6
                      && far.InfrastructureLabelLimit == 0
                      && !medium.TerritoryFill && medium.TerritoryBorder
                      && medium.Sites && medium.Parties && medium.Threats
                      && medium.InfrastructureLabelLimit == 3
                      && medium.SiteBucket > near.SiteBucket
                      && near.TerritoryBorder && near.Influence && near.Sites
                      && near.Parties && near.Threats && near.OverlayLabelLimit == 12
                      && near.InfrastructureLabelLimit == 0,
                    "семантический масштаб не отделяет регион, округу и район");
                Check(!RoaGlobalMap.TargetKindVisibleAtTier("site",
                          RoaGlobalMap.MapDetailTier.Far, true, true)
                      && RoaGlobalMap.TargetKindVisibleAtTier("site",
                          RoaGlobalMap.MapDetailTier.Medium, true, true)
                      && !RoaGlobalMap.TargetKindVisibleAtTier("party",
                          RoaGlobalMap.MapDetailTier.Near, true, false)
                      && !RoaGlobalMap.TargetKindVisibleAtTier("zone",
                          RoaGlobalMap.MapDetailTier.Near, false, true),
                    "скрытые слои всё ещё могут притягивать курсор");

                Check(RoaGlobalMapCanvas.RouteStateLabel(true, true, false, false, false) == "КОНТАКТ"
                      && RoaGlobalMapCanvas.RouteStateLabel(true, false, false, false, false) == "В ПУТИ"
                      && RoaGlobalMapCanvas.RouteStateLabel(false, false, false, true, false) == "В ОТРЯДЕ"
                      && RoaGlobalMapCanvas.RouteStateLabel(false, false, true, false, false) == "ПРИБЫЛИ"
                      && RoaGlobalMapCanvas.RouteStateLabel(false, false, false, false, true) == "НА МЕСТЕ"
                      && RoaGlobalMapCanvas.RouteStateLabel(false, false, false, false, false) == "НОВАЯ ЦЕЛЬ",
                    "карточка маршрута не различает ключевые состояния");
                Check(RoaGlobalMapCanvas.RouteStateLabel(true, false, false, false,
                          false, false, false) == "РАСЧЁТ ПУТИ"
                      && RoaGlobalMapCanvas.RouteStateLabel(true, true, true, false,
                          false, false, false) == "МЕНЯЕМ ПУТЬ"
                      && RoaGlobalMapCanvas.RouteStateColor(true, true, true, false,
                          false, false, false).r
                         > RoaGlobalMapCanvas.RouteStateColor(true, false, false, false,
                          false, false, false).r,
                    "ожидание нового маршрута смешано с уже подтверждённым движением");

                Color lowRisk = RoaGlobalMapCanvas.RiskColor("низкий");
                Color mediumRisk = RoaGlobalMapCanvas.RiskColor("средний");
                Color highRisk = RoaGlobalMapCanvas.RiskColor("высокий");
                Check(lowRisk.g > lowRisk.r && mediumRisk.r > mediumRisk.g
                      && highRisk.r > highRisk.g && highRisk.g < mediumRisk.g,
                    "цвет риска не ведёт от безопасного к опасному");

                Check(Mathf.Approximately(RoaGlobalMapCanvas.SidebarHeight(false, false, false, 800f), 238f)
                      && Mathf.Approximately(RoaGlobalMapCanvas.SidebarHeight(false, true, false, 800f), 468f)
                      && Mathf.Approximately(RoaGlobalMapCanvas.SidebarHeight(true, true, false, 800f), 338f)
                      && Mathf.Approximately(RoaGlobalMapCanvas.SidebarHeight(false, false, true, 800f), 358f)
                      && Mathf.Approximately(RoaGlobalMapCanvas.SidebarHeight(false, true, false, 200f), 196f),
                    "адаптивная панель карты снова занимает лишнюю высоту");

                Check(RoaGlobalMapCanvas.ResolveJourneyStage(false, false, false, 0f,
                          false, false, false, false)
                          == RoaGlobalMapCanvas.MapJourneyStage.Target
                      && RoaGlobalMapCanvas.ResolveJourneyStage(true, false, false, 0f,
                          false, false, false, false)
                          == RoaGlobalMapCanvas.MapJourneyStage.Travel
                      && RoaGlobalMapCanvas.ResolveJourneyStage(false, true, false, 0.94f,
                          false, false, false, false)
                          == RoaGlobalMapCanvas.MapJourneyStage.Arrival
                      && RoaGlobalMapCanvas.ResolveJourneyStage(false, false, false, 1f,
                          false, true, false, true)
                          == RoaGlobalMapCanvas.MapJourneyStage.Location,
                    "путь цель → маршрут → прибытие → локация не объясняет текущее состояние");
                Color journeyPast = RoaGlobalMapCanvas.JourneyStepColor(0,
                    RoaGlobalMapCanvas.MapJourneyStage.Arrival, false, false);
                Color journeyCurrent = RoaGlobalMapCanvas.JourneyStepColor(1,
                    RoaGlobalMapCanvas.MapJourneyStage.Travel, true, false);
                Check(journeyPast.g > journeyPast.r && journeyCurrent.r > journeyCurrent.g,
                    "пройденный путь и контакт визуально не различаются");

                string context = RoaGlobalMapCanvas.MapContextText("округа", 3, 2);
                Check(context.Contains("МАСШТАБ: ОКРУГА") && context.Contains("СОБЫТИЯ: 3")
                      && context.Contains("ОТРЯДЫ: 2")
                      && RoaGlobalMapCanvas.MapGestureHint(false, "район").Contains("МАСШТАБ: РАЙОН")
                      && RoaGlobalMapCanvas.MapGestureHint(false, "район").Contains("ТЯНУТЬ — ОБЗОР")
                      && RoaGlobalMapCanvas.MapGestureHint(true, "регион").Contains("ЩИПОК"),
                    "контекст масштаба или подсказка управления потеряны");

                var ordinary = new RoaGlobalMap.OverlayLabel { Id = "ordinary", Priority = 500 };
                var activity = new RoaGlobalMap.OverlayLabel
                {
                    Id = "activity", Priority = 900, Activity = true
                };
                var selected = new RoaGlobalMap.OverlayLabel
                {
                    Id = "selected", Priority = 100, Selected = true
                };
                var labels = new[] { ordinary, activity, selected };
                Array.Sort(labels, RoaGlobalMapCanvas.CompareOverlayLabels);
                Check(labels[0].Id == "selected" && labels[1].Id == "activity",
                    "выбранная цель и активность теряются за второстепенными метками");

                Color completed = RoaGlobalMap.RouteVisualColor(0.2f, 0.6f, false, false);
                Color future = RoaGlobalMap.RouteVisualColor(0.9f, 0.6f, false, false);
                Color head = RoaGlobalMap.RouteVisualColor(0.6f, 0.6f, false, false);
                Color contact = RoaGlobalMap.RouteVisualColor(0.9f, 0.6f, false, true);
                Check(completed.g > completed.r && future.r > future.g
                      && head.b > future.b && contact.r > contact.g,
                    "маршрут не различает пройденный, текущий и опасный участки");

                float completedScale = RoaGlobalMap.RouteVisualScale(0.2f, 0.6f, false, false);
                float futureScale = RoaGlobalMap.RouteVisualScale(0.9f, 0.6f, false, false);
                float headScale = RoaGlobalMap.RouteVisualScale(0.6f, 0.6f, false, false);
                float contactHeadScale = RoaGlobalMap.RouteVisualScale(0.6f, 0.6f, false, true);
                Check(completedScale < futureScale && headScale > futureScale
                      && contactHeadScale > headScale
                      && RoaGlobalMap.RouteDetailScale(RoaGlobalMap.MapDetailTier.Far)
                         > RoaGlobalMap.RouteDetailScale(RoaGlobalMap.MapDetailTier.Near),
                    "голова маршрута не выделяется размером на разных масштабах карты");
                Check(RoaGlobalMap.InfrastructureShortTitle("southern_caravan_road", "")
                          == "ЮЖНАЯ ТРАССА"
                      && RoaGlobalMap.InfrastructureShortTitle("relay_trade_road", "")
                          == "ТОРГОВЫЙ ПУТЬ"
                      && RoaGlobalMap.InfrastructureShortTitle("old_northern_road", "")
                          == "СЕВЕРНЫЙ ТРАКТ",
                    "ключевые дороги не имеют коротких навигационных названий");

                probe = new GameObject("Global map presentation probe");
                RoaGlobalMapCanvas canvas = probe.AddComponent<RoaGlobalMapCanvas>();
                MethodInfo ensureBuilt = typeof(RoaGlobalMapCanvas).GetMethod("EnsureBuilt",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Check(ensureBuilt != null, "Canvas карты нельзя детерминированно собрать");
                ensureBuilt.Invoke(canvas, null);
                Canvas.ForceUpdateCanvases();

                RectTransform routeBox = probe.GetComponentsInChildren<RectTransform>(true)
                    .FirstOrDefault(rect => rect.gameObject.name == "Box"
                        && rect.Find("RouteStateBadge") != null);
                Check(routeBox != null
                      && Mathf.Abs(routeBox.offsetMax.y - routeBox.offsetMin.y
                          - RoaGlobalMapCanvas.RouteCardHeight) < 0.01f
                      && routeBox.Find("RouteRiskBadge") != null
                      && routeBox.Find("JourneyFlow")?.childCount == 4
                      && ((RectTransform)routeBox.Find("RouteStateBadge")).rect.width >= 132f
                      && routeBox.Find("RouteMeta") != null
                      && routeBox.Find("RouteHint") != null,
                    "семантическая карточка маршрута собрана неполно");

                Text mapContext = probe.GetComponentsInChildren<Text>(true)
                    .FirstOrDefault(text => text.gameObject.name == "MapContext");
                string[] buttons = probe.GetComponentsInChildren<Button>(true)
                    .Select(button => button.GetComponentInChildren<Text>(true)?.text ?? string.Empty)
                    .ToArray();
                Check(mapContext != null && buttons.Contains("К ИГРОКУ")
                      && buttons.Contains("ПОДРОБНО") && buttons.Contains("ПОКИНУТЬ")
                      && !buttons.Contains("Войти") && !buttons.Contains("Стоп"),
                    "карта потеряла навигацию или вернула старые кнопки");

                Text systemLog = probe.GetComponentsInChildren<Text>(true)
                    .FirstOrDefault(text => text.gameObject.name == "Log");
                Text groupKicker = probe.GetComponentsInChildren<Text>(true)
                    .FirstOrDefault(text => text.text == "ГРУППА");
                Check(systemLog != null && !systemLog.transform.parent.gameObject.activeSelf
                      && groupKicker != null && !groupKicker.gameObject.activeSelf,
                    "устаревшие журнал и группа снова засоряют карту");

                Debug.Log("[GLOBAL MAP & TRAVEL 4.6] готово: маршрут=транзакция/решение/риск/ETA, "
                    + "путь=цель→маршрут→прибытие→локация, метки=приоритет, панель=238/338/468, "
                    + "ввод=ЛКМ tap/drag + pinch-pan, камера=к игроку, legacy=скрыто");
            }
            finally
            {
                if (probe != null) UnityEngine.Object.DestroyImmediate(probe);
            }
        }

        [MenuItem("Realm of Ashes/Проверить Global Map & Travel 4.6")]
        private static void CaptureAndRun()
        {
            Run();
            string project = Directory.GetParent(Application.dataPath)?.FullName
                ?? Application.dataPath;
            string output = Path.Combine(project, "Library", "GlobalMapTravel46");
            Directory.CreateDirectory(output);
            Capture(Path.Combine(output, "desktop-travel.png"), false,
                RoaGlobalMapCanvas.MapJourneyStage.Travel, "В ПУТИ",
                "МУРАВЕЙНИК · ШТУРМ / ДИВЕРСИЯ", "64% · 12 с · 3.8 км",
                "Клик по новой точке меняет путь. Вход — автоматически.");
            Capture(Path.Combine(output, "mobile-arrival.png"), true,
                RoaGlobalMapCanvas.MapJourneyStage.Arrival, "ПРИБЫТИЕ",
                "МУРАВЕЙНИК · ШТУРМ / ДИВЕРСИЯ",
                "Маршрут завершён · сервер подтверждает прибытие",
                "Прибытие подтверждается. Вход начнётся автоматически.");
            Debug.Log("[GLOBAL MAP & TRAVEL 4.6] снимки: " + output);
        }

        private static void Capture(string path, bool mobile,
            RoaGlobalMapCanvas.MapJourneyStage stage, string state, string title,
            string meta, string hint)
        {
            const BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                host = new GameObject("GlobalMapTravel46Probe");
                RoaGlobalMapCanvas mapCanvas = host.AddComponent<RoaGlobalMapCanvas>();
                MethodInfo ensure = typeof(RoaGlobalMapCanvas).GetMethod("EnsureBuilt", flags);
                MethodInfo responsive = typeof(RoaGlobalMapCanvas).GetMethod(
                    "ApplyResponsiveLayout", flags);
                MethodInfo flow = typeof(RoaGlobalMapCanvas).GetMethod("ApplyJourneyFlow", flags);
                MethodInfo progress = typeof(RoaGlobalMapCanvas).GetMethod("SetRouteProgress", flags);
                Check(ensure != null && responsive != null && flow != null && progress != null,
                    "визуальная проверка маршрута потеряла точки сборки");
                ensure.Invoke(mapCanvas, null);

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                RectTransform root = host.transform.Find(
                    "GlobalMapCanvas/GlobalMapWindow") as RectTransform;
                RectTransform side = root?.Find("Side") as RectTransform;
                RectTransform routeBox = side?.Find("Box") as RectTransform;
                Check(canvas != null && root != null && side != null && routeBox != null,
                    "визуальная проверка не собрала карточку маршрута");
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
                root.gameObject.SetActive(true);
                responsive.Invoke(mapCanvas, null);
                if (mobile)
                {
                    side.anchorMin = new Vector2(0f, 0f);
                    side.anchorMax = new Vector2(1f, 0f);
                    side.pivot = new Vector2(0.5f, 0f);
                    side.anchoredPosition = new Vector2(0f, 10f);
                    side.sizeDelta = new Vector2(-20f,
                        RoaGlobalMapCanvas.CompactSidebarHeight);
                }

                Text routeState = routeBox.Find("RouteStateBadge/Text")?.GetComponent<Text>();
                Text routeRisk = routeBox.Find("RouteRiskBadge/Text")?.GetComponent<Text>();
                Text routeTitle = routeBox.Find("Route")?.GetComponent<Text>();
                Text routeMeta = routeBox.Find("RouteMeta")?.GetComponent<Text>();
                Text routeHint = routeBox.Find("RouteHint")?.GetComponent<Text>();
                Check(routeState != null && routeRisk != null && routeTitle != null
                    && routeMeta != null && routeHint != null,
                    "визуальная проверка не нашла тексты маршрута");
                Color accent = RoaGlobalMapCanvas.JourneyStepColor((int)stage, stage,
                    false, stage == RoaGlobalMapCanvas.MapJourneyStage.Arrival);
                routeState.text = state;
                routeState.color = accent;
                routeState.transform.parent.GetComponent<Image>().color = new Color(
                    accent.r * 0.18f, accent.g * 0.18f, accent.b * 0.18f, 0.96f);
                routeRisk.text = "РИСК: ВЫСОКИЙ";
                routeRisk.color = new Color(1f, 0.34f, 0.18f, 1f);
                routeRisk.transform.parent.GetComponent<Image>().color =
                    new Color(0.18f, 0.06f, 0.03f, 0.96f);
                routeTitle.text = title;
                routeMeta.text = meta;
                routeHint.text = hint;
                flow.Invoke(mapCanvas, new object[] { stage, false,
                    stage == RoaGlobalMapCanvas.MapJourneyStage.Arrival });
                progress.Invoke(mapCanvas, new object[] { true,
                    stage == RoaGlobalMapCanvas.MapJourneyStage.Travel ? 0.64f : 1f, false });

                cameraObject = new GameObject("GlobalMapTravel46Camera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.12f, 0.105f, 0.07f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                int width = mobile ? 1280 : 1920;
                int height = mobile ? 720 : 1080;
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32)
                {
                    name = "GlobalMapTravel46",
                    antiAliasing = 4
                };
                target.Create();
                camera.targetTexture = target;
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                {
                    var request = new RenderPipeline.StandardRequest { destination = target };
                    RenderPipeline.SubmitRenderRequest(camera, request);
                }
                else camera.Render();
                RenderTexture.active = target;
                readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, width, height), 0, 0);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
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
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("[GLOBAL MAP & TRAVEL 4.6] " + message);
        }
    }
}
