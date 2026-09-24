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
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    public static class RoaHudCanvasProbe
    {
        [MenuItem("Realm of Ashes/Probe/Adaptive HUD")]
        public static void Run()
        {
            Require(RoaInteraction.DisplayNpcName(JObject.Parse(
                    "{\"name\":\"Перекрёсток: ополчение у баррикады [Лиги Тракта]\"}")) == "ополчение"
                && RoaInteraction.DisplayNpcName(JObject.Parse(
                    "{\"name\":\"Старый Клим\",\"traderQuests\":[\"supplies\"]}")) == "Старый Клим"
                && RoaInteraction.IsQuestNpc(JObject.Parse(
                    "{\"kromkaNamedNpcId\":\"story_guide\"}")),
                "NPC display names or quest dialogue classification changed");
            Require(RoaEnemies.ReadBoolean(JValue.CreateNull(), true)
                    && !RoaEnemies.ReadBoolean(JValue.CreateNull())
                    && RoaEnemies.ReadBoolean(new JValue(true))
                    && !RoaEnemies.ReadBoolean(new JValue(false), true),
                "explicit JSON null is no longer safe for optional NPC flags");
            var occupied = new List<Rect>();
            Require(RoaActorNameplates.TryResolveScreenRect(new Vector2(-20f, -10f), occupied,
                                                            800, 480, out Rect first),
                    "first nameplate was not placed");
            Require(first.xMin >= 6f && first.yMin >= 6f && first.xMax <= 794f && first.yMax <= 474f,
                    "nameplate escaped the screen safe margin");
            occupied.Add(first);
            Require(RoaActorNameplates.TryResolveScreenRect(new Vector2(-20f, -10f), occupied,
                                                            800, 480, out Rect second),
                    "overlapping nameplate was not relocated");
            Require(!first.Overlaps(second), "relocated nameplates still overlap");
            Require(RoaActorNameplates.IsImportantNpc(true, "merchant", string.Empty)
                    && RoaActorNameplates.IsImportantNpc(true, string.Empty, "quartermaster")
                    && !RoaActorNameplates.IsImportantNpc(true, "guard", string.Empty)
                    && !RoaActorNameplates.IsImportantNpc(false, "merchant", string.Empty),
                "Unity nameplates no longer match the important-NPC role filter");
            var healthyExtra = new RoaActorNameplates.Entry { Hp = 100, MaxHp = 100 };
            RoaActorNameplates.Presentation compact = RoaActorNameplates.ResolvePresentation(
                healthyExtra, false, 6f, 20f);
            var woundedExtra = new RoaActorNameplates.Entry { Hp = 42, MaxHp = 100 };
            RoaActorNameplates.Presentation wounded = RoaActorNameplates.ResolvePresentation(
                woundedExtra, false, 6f, 20f);
            var self = new RoaActorNameplates.Entry
                { Name = "Странник", Hp = 87, MaxHp = 100, IsSelf = true, IsPlayer = true };
            RoaActorNameplates.Presentation own = RoaActorNameplates.ResolvePresentation(
                self, false, 19f, 20f);
            var hostileNpc = new RoaActorNameplates.Entry
                { Faction = RoaActorNameplates.NpcFactionLine("raiders", true), Hp = 100, MaxHp = 100, Hostile = true };
            RoaActorNameplates.Presentation hostileNpcPresentation = RoaActorNameplates.ResolvePresentation(
                hostileNpc, false, 6f, 20f);
            Require(!compact.ShowName && !compact.ShowHealthText && compact.Height <= 9f
                    && wounded.ShowHealthText && wounded.HealthText == "тяжело"
                    && own.ShowName && own.ShowHealthText && own.HealthText == "87/100"
                    && Mathf.Approximately(own.Alpha, 1f)
                    && hostileNpcPresentation.ShowFaction
                    && hostileNpc.Faction == "ВРАГ · Рейдеры",
                "compact health-bar/name hierarchy is not deterministic");
            Require(typeof(RoaHudCanvas).IsSubclassOf(typeof(MonoBehaviour)),
                    "adaptive HUD is not a Unity component");
            Vector2 desktopReference = RoaUiScale.ReferenceFor(false);
            Vector2 mobileReference = RoaUiScale.ReferenceFor(true);
            Require(desktopReference == new Vector2(1440f, 810f),
                    "desktop UI reference no longer protects laptop readability");
            Require(mobileReference == new Vector2(1280f, 720f),
                    "mobile UI reference changed unexpectedly");
            GameObject scaleProbe = new GameObject("UiScaleProbe", typeof(Canvas), typeof(UnityEngine.UI.CanvasScaler));
            UnityEngine.UI.CanvasScaler scaleProbeScaler = scaleProbe.GetComponent<UnityEngine.UI.CanvasScaler>();
            RoaUiScale.Apply(scaleProbeScaler);
            Require(scaleProbe.GetComponent<Canvas>().pixelPerfect
                    && scaleProbeScaler.uiScaleMode == UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize
                    && scaleProbeScaler.screenMatchMode == UnityEngine.UI.CanvasScaler.ScreenMatchMode.MatchWidthOrHeight,
                "HUD scaling no longer keeps text pixel-aligned across fullscreen resolution changes");
            UnityEngine.Object.DestroyImmediate(scaleProbe);
            GameObject scrollProbe = new GameObject("UiScrollProbe", typeof(RectTransform),
                typeof(UnityEngine.UI.ScrollRect));
            UnityEngine.UI.ScrollRect wheelScroll = scrollProbe.GetComponent<UnityEngine.UI.ScrollRect>();
            RoaUiScroll.Configure(wheelScroll);
            UnityEngine.UI.Graphic wheelReceiver = scrollProbe.GetComponent<UnityEngine.UI.Graphic>();
            Require(wheelScroll.vertical && !wheelScroll.horizontal
                    && wheelScroll.viewport == scrollProbe.transform
                    && wheelScroll.scrollSensitivity >= 18f
                    && wheelReceiver != null && wheelReceiver.raycastTarget,
                "mouse-wheel scrolling no longer has a raycastable viewport in generated interfaces");
            UnityEngine.Object.DestroyImmediate(scrollProbe);
            RoaHudCanvas.LayoutProfile desktopHud = RoaHudCanvas.ResolveLayout(false);
            RoaHudCanvas.LayoutProfile mobileHud = RoaHudCanvas.ResolveLayout(true);
            float desktopConsoleTop = (desktopHud.ConsolePosition.y
                + 253f * desktopHud.ConsoleScale) / desktopReference.y;
            float mobileConsoleTop = (mobileHud.ConsolePosition.y
                + 253f * mobileHud.ConsoleScale) / mobileReference.y;
            Require(desktopConsoleTop < 0.31f && mobileConsoleTop < 0.29f,
                    "weapon console again obscures too much of the combat view");
            Require(desktopHud.QuickbarPosition.y > desktopHud.ConsolePosition.y
                        + 253f * desktopHud.ConsoleScale
                    && mobileHud.QuickbarPosition.y > mobileHud.ConsolePosition.y
                        + 253f * mobileHud.ConsoleScale,
                    "quickbar overlaps the compact weapon console");
            Require(mobileHud.PlayerScale < desktopHud.PlayerScale
                    && mobileHud.MapScale < desktopHud.MapScale,
                "mobile identity or minimap panels did not release combat space");
            Require(RoaHudCanvas.ResolveFocusMode(false, false, false)
                        == RoaHudCanvas.HudFocusMode.Detailed
                    && RoaHudCanvas.ResolveFocusMode(true, false, false)
                        == RoaHudCanvas.HudFocusMode.Detailed
                    && RoaHudCanvas.ResolveFocusMode(false, true, false)
                        == RoaHudCanvas.HudFocusMode.Detailed
                    && RoaHudCanvas.ResolveFocusMode(false, true, false, false)
                        == RoaHudCanvas.HudFocusMode.Detailed
                    && RoaHudCanvas.ResolveFocusMode(true, true, false, false)
                        == RoaHudCanvas.HudFocusMode.Detailed
                    && RoaHudCanvas.ShowsIdentity(RoaHudCanvas.HudFocusMode.Detailed)
                    && RoaHudCanvas.ShowsIdentity(RoaHudCanvas.HudFocusMode.Combat)
                    && RoaHudCanvas.ShowsQuickbar(RoaHudCanvas.HudFocusMode.Combat,
                        false, false, false)
                    && RoaHudCanvas.ShowsQuickbar(RoaHudCanvas.HudFocusMode.Activity,
                        false, false, false)
                    && RoaHudCanvas.ShowsQuickbar(RoaHudCanvas.HudFocusMode.Combat,
                        true, false, false)
                    && RoaCombat.IsCombatPresentationActive(6.9f, 7f)
                    && !RoaCombat.IsCombatPresentationActive(7f, 7f),
                "the HUD must retain one visible arrangement through combat and activity");
            float desktopCompactTop = (RoaHudCanvas.CompactConsolePosition(false).y
                + 66f * RoaHudCanvas.CompactConsoleScale(false)) / desktopReference.y;
            float mobileCompactTop = (RoaHudCanvas.CompactConsolePosition(true).y
                + 66f * RoaHudCanvas.CompactConsoleScale(true)) / mobileReference.y;
            Require(desktopCompactTop < 0.10f && mobileCompactTop < 0.11f
                    && RoaHudCanvas.QuickbarFocusPosition(false,
                        RoaHudCanvas.HudFocusMode.Exploration).y == 14f
                    && RoaHudCanvas.QuickbarFocusPosition(true,
                        RoaHudCanvas.HudFocusMode.Combat).y == 75f,
                "the fixed action bar left its bottom-centre reference position");
            Vector2 recoveredConsole = RoaHudCanvas.ClampBottomPanelPosition(
                new Vector2(0f, -56f), new Vector2(560f, 66f), 0.94f,
                new Vector2(1920f, 1080f));
            Require(recoveredConsole.y >= 8f,
                "legacy console offsets must not push the compact HUD below the safe area");
            Vector2 recoveredWide = RoaHudCanvas.ClampBottomPanelPosition(
                new Vector2(1600f, 16f), new Vector2(760f, 253f), 0.875f,
                new Vector2(1920f, 1080f));
            Require(recoveredWide.x < 1600f,
                "dragged combat console must remain horizontally reachable");
            GameObject hierarchyProbe = new GameObject("Hud hierarchy probe");
            try
            {
                RoaHudCanvas hierarchyCanvas = hierarchyProbe.AddComponent<RoaHudCanvas>();
                MethodInfo buildHud = typeof(RoaHudCanvas).GetMethod("Build",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Require(buildHud != null, "adaptive HUD builder is missing");
                buildHud.Invoke(hierarchyCanvas, null);
                Transform compactConsole = hierarchyProbe.transform.Find(
                    "AdaptiveGameplayHud/SafeArea/CompactWeaponConsole");
                Require(compactConsole != null
                        && ((RectTransform)compactConsole).sizeDelta == new Vector2(560f, 66f)
                        && compactConsole.GetComponent<CanvasGroup>() != null
                        && compactConsole.Find("HpTrack/Fill") != null
                        && compactConsole.Find("Weapon") != null
                        && compactConsole.Find("Ammo") != null,
                    "contextual exploration console is incomplete");
                if (Resources.Load<GameObject>("ApocalypseHud/HUD_Apocalypse_HealthBar_01") != null)
                {
                    Transform readyHealth = compactConsole.Find("ApocalypseHudHealthBar/Slider");
                    Require(readyHealth != null &&
                        readyHealth.GetComponent<UnityEngine.UI.Slider>() != null &&
                        !readyHealth.GetComponent<UnityEngine.UI.Slider>().interactable,
                        "the Synty health bar was not installed as a read-only live HUD element");
                }
                if (Resources.Load<GameObject>("ApocalypseHud/HUD_Apocalypse_Minimap_Box_02") != null)
                {
                    Transform minimap = hierarchyProbe.transform.Find(
                        "AdaptiveGameplayHud/SafeArea/Minimap");
                    Transform readyFrame = minimap != null
                        ? minimap.Find("ApocalypseMinimapDevice/SPR_Frame") : null;
                    Require(readyFrame != null &&
                        !minimap.Find("ApocalypseMinimapDevice/Minimap_Contents/Map_Container/Map").gameObject.activeSelf
                        && !minimap.Find("ApocalypseMinimapDevice/Minimap_Contents/Map_Icon_Player").gameObject.activeSelf,
                        "the Synty minimap must show live map data instead of sample markers");
                }
                if (Resources.Load<GameObject>("ApocalypseHud/HUD_Apocalypse_HotBar_03") != null)
                {
                    Transform quickbar = hierarchyProbe.transform.Find(
                        "AdaptiveGameplayHud/SafeArea/Quickbar/ApocalypseHotBar");
                    Transform slots = quickbar != null ? quickbar.Find("ActionBar") : null;
                    Require(slots != null, "the Apocalypse hotbar is missing");
                    for (int i = 0; i < RoaQuickbar.SlotCount; i++)
                    {
                        Transform slot = slots.Find("Item_" + i.ToString("00"));
                        UnityEngine.UI.Text number = quickbar.Find("LiveSlotLabel_" + i)
                            ?.GetComponent<UnityEngine.UI.Text>();
                        Require(slot != null && slot.GetComponent<UnityEngine.UI.Button>() != null
                            && number != null && number.enabled
                            && number.text == (i + 1).ToString(),
                            "hotbar slot " + i + " has no button or number plate");
                    }
                    MethodInfo refreshLamps = typeof(RoaHudCanvas).GetMethod(
                        "RefreshApocalypseApLamps", BindingFlags.Instance | BindingFlags.NonPublic);
                    Require(refreshLamps != null, "action-point lamps cannot be updated");
                    refreshLamps.Invoke(hierarchyCanvas, new object[] { 9, 4.8f });
                    Transform lamps = quickbar.Find("ActionPointLamps");
                    Require(lamps != null && lamps.childCount == 9,
                        "nine maximum action points must produce nine lamps");
                    for (int i = 0; i < 9; i++)
                        Require(lamps.GetChild(i).gameObject.activeSelf
                            && lamps.GetChild(i).Find("Valve_Active").gameObject.activeSelf == (i < 4),
                            "each lamp must reflect one current action point");
                    refreshLamps.Invoke(hierarchyCanvas, new object[] { 6, 2f });
                    for (int i = 0; i < 9; i++)
                        Require(lamps.GetChild(i).gameObject.activeSelf == (i < 6)
                            && (!lamps.GetChild(i).gameObject.activeSelf ||
                                lamps.GetChild(i).Find("Valve_Active").gameObject.activeSelf == (i < 2)),
                            "lamp count and illumination must follow changed action points");
                    refreshLamps.Invoke(hierarchyCanvas, new object[] { 26, 13.4f });
                    Require(lamps.childCount == 26,
                        "increased maximum action points must add one lamp per point");
                    for (int i = 0; i < 26; i++)
                        Require(lamps.GetChild(i).gameObject.activeSelf
                            && lamps.GetChild(i).Find("Valve_Active").gameObject.activeSelf == (i < 13),
                            "lamps must show the new current action points after expansion");
                }
                else if (Resources.Load<GameObject>("ApocalypseHud/Button_Apocalypse_HotBar_Item_01") != null)
                {
                    Transform quickbar = hierarchyProbe.transform.Find(
                        "AdaptiveGameplayHud/SafeArea/Quickbar");
                    Require(quickbar != null, "the quickbar is missing");
                    for (int i = 0; i < RoaQuickbar.SlotCount; i++)
                    {
                        Transform slot = quickbar.Find("Slot" + i);
                        Require(slot != null && slot.GetComponent<UnityEngine.UI.Button>() != null
                            && slot.Find("Item") != null && slot.Find("Item/Selected") != null,
                            "quickbar slot " + i + " does not use the Synty button prefab");
                    }
                }
                if (Resources.Load<GameObject>("ApocalypseHud/HUD_Apocalypse_Compass_03") != null)
                {
                    Transform compass = hierarchyProbe.transform.Find(
                        "AdaptiveGameplayHud/SafeArea/ApocalypseCompass");
                    Require(compass != null && compass.Find("Content/Compass_Content") != null
                        && compass.Find("Content/Compass_Content/Mask/Icons") != null
                        && !compass.Find("Content/Compass_Content/Mask/Icons").gameObject.activeSelf,
                        "the new compass still contains demonstration target markers");
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(hierarchyProbe);
            }
            RoaHudCanvas.ConnectionBannerState interrupted = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Disconnected, 3, 4.2f, string.Empty, false);
            Require(interrupted.Kind == RoaHudCanvas.ConnectionBannerKind.Interrupted
                    && interrupted.Title.Contains("ПОТЕРЯНА")
                    && interrupted.Detail.Contains("5 с")
                    && interrupted.Detail.Contains("3"),
                "offline banner lost retry countdown or attempt number");
            RoaHudCanvas.ConnectionBannerState connecting = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Connecting, 2, 0f, string.Empty, false);
            Require(connecting.Kind == RoaHudCanvas.ConnectionBannerKind.Connecting
                    && connecting.Detail.Contains("2"),
                "connecting banner no longer explains the current attempt");
            RoaHudCanvas.ConnectionBannerState synchronizing = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Joining, 2, 0f, string.Empty, false);
            Require(synchronizing.Kind == RoaHudCanvas.ConnectionBannerKind.Synchronizing,
                "join recovery is not presented as world synchronization");
            RoaHudCanvas.ConnectionBannerState restored = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Joined, 0, 0f, string.Empty, true);
            Require(restored.Kind == RoaHudCanvas.ConnectionBannerKind.Restored,
                "successful reconnect has no confirmation");
            RoaHudCanvas.ConnectionBannerState healthy = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Joined, 0, 0f, string.Empty, false);
            Require(healthy.Kind == RoaHudCanvas.ConnectionBannerKind.Hidden,
                "healthy connection leaves a permanent banner on screen");
            CaptureIfRequested();
            Debug.Log("[HUD CLEANUP 4.1] готово: исследование/активность/бой/детали, "
                + "компактный бой, скрытая личность, приоритетная панель и чёткий Canvas.");
        }

        private static void CaptureIfRequested()
        {
            string path = Environment.GetEnvironmentVariable("ROA_HUD_CAPTURE");
            if (string.IsNullOrWhiteSpace(path)) return;
            bool mobileCapture = string.Equals(Environment.GetEnvironmentVariable(
                "ROA_HUD_CAPTURE_MOBILE"), "1", StringComparison.Ordinal);
            if (mobileCapture) Screen.SetResolution(896, 414, false);
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                host = new GameObject("HudCanvasCapture");
                RoaHud hud = host.AddComponent<RoaHud>();
                Set(hud, "_selfId", "capture-player");
                Set(hud, "_name", "Странник");
                Set(hud, "_hp", 74);
                Set(hud, "_maxHp", 100);
                Set(hud, "_ap", 7f);
                Set(hud, "_maxAp", 10);
                Set(hud, "_level", 8);
                Set(hud, "_xp", 630);
                Set(hud, "_xpNeeded", 1000);
                Set(hud, "_weapon", "fists");
                Set(hud, "_armorThreshold", 4);
                Set(hud, "_condition", 0.72f);

                if (string.Equals(Environment.GetEnvironmentVariable(
                        "ROA_HUD_CAPTURE_CONNECTION"), "1", StringComparison.Ordinal))
                {
                    RoaSocketClient socket = host.AddComponent<RoaSocketClient>();
                    hud.Socket = socket;
                    Set(socket, "_reconnectAttempt", 3);
                    Set(socket, "_reconnectScheduled", true);
                    Set(socket, "_reconnectAt", Time.realtimeSinceStartup + 4.2f);
                }

                RoaQuickbar quickbar = host.AddComponent<RoaQuickbar>();
                Set(quickbar, "_worldActive", true);
                FieldInfo slots = typeof(RoaQuickbar).GetField("_slots",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Require(slots != null, "HUD capture cannot access quick slots");
                string[] assigned = (string[])slots.GetValue(quickbar);
                assigned[0] = "pistol";
                assigned[1] = "medkit";
                assigned[2] = "water";
                RoaMinimap minimap = host.AddComponent<RoaMinimap>();
                minimap.enabled = false;
                RoaMobileControls mobile = null;
                if (mobileCapture)
                {
                    mobile = host.AddComponent<RoaMobileControls>();
                    mobile.enabled = false;
                    mobile.ForceVisible = true;
                }
                RoaHudCanvas canvasOwner = host.AddComponent<RoaHudCanvas>();
                canvasOwner.Configure(hud, quickbar, minimap, null, mobile);
                MethodInfo update = typeof(RoaHudCanvas).GetMethod("Update",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Require(update != null, "HUD capture cannot invoke presentation update");
                update.Invoke(canvasOwner, null);
                if (string.Equals(Environment.GetEnvironmentVariable(
                        "ROA_HUD_CAPTURE_DETAILED"), "1", StringComparison.Ordinal))
                {
                    Set(canvasOwner, "_focusInitialized", false);
                    MethodInfo focus = typeof(RoaHudCanvas).GetMethod("RefreshHudFocus",
                        BindingFlags.Instance | BindingFlags.NonPublic);
                    Require(focus != null, "HUD capture cannot switch to the detailed console");
                    focus.Invoke(canvasOwner, new object[]
                        { true, false, RoaHudCanvas.HudFocusMode.Detailed });
                }

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                Require(canvas != null, "HUD capture canvas was not built");
                cameraObject = new GameObject("HudCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.16f, 0.13f, 0.085f, 1f);
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 100f;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                RectTransform safe = canvas.transform.Find("SafeArea") as RectTransform;
                Require(safe != null, "HUD capture safe area was not built");
                safe.anchorMin = Vector2.zero;
                safe.anchorMax = Vector2.one;
                safe.offsetMin = Vector2.zero;
                safe.offsetMax = Vector2.zero;
                Transform quest = safe.Find("ApocalypseCurrentQuest");
                if (quest != null)
                {
                    quest.gameObject.SetActive(true);
                    var title = quest.Find("Content/HUD_ChapterHeader/Content/Label_Location")
                        ?.GetComponent<TMPro.TextMeshProUGUI>();
                    if (title != null) title.text = "ПУТЬ К ЛАГЕРЮ";
                    var line = quest.Find("Content/Objective_List/Objective_Item_00/Content/Text/Label_Objective")
                        ?.GetComponent<TMPro.TextMeshProUGUI>();
                    if (line != null) line.text = "Найти вход в поселение";
                }

                target = new RenderTexture(mobileCapture ? 896 : 1280,
                    mobileCapture ? 414 : 720, 24, RenderTextureFormat.ARGB32)
                {
                    name = "HudCanvasCapture",
                    antiAliasing = 4
                };
                target.Create();
                camera.targetTexture = target;
                foreach (TMPro.TMP_Text label in host.GetComponentsInChildren<TMPro.TMP_Text>(true))
                    if (label != null && label.enabled) label.ForceMeshUpdate(true, true);
                foreach (UnityEngine.UI.RectMask2D mask in
                    host.GetComponentsInChildren<UnityEngine.UI.RectMask2D>(true))
                    if (mask.name != "Map"
                        && mask.GetComponentsInChildren<TMPro.TMP_Text>(true).Length > 0)
                        mask.enabled = false;
                Canvas.ForceUpdateCanvases();
                Transform captureBar = safe.Find("Quickbar/ApocalypseHotBar");
                if (captureBar != null)
                {
                    for (int i = 0; i < RoaQuickbar.SlotCount; i++)
                    {
                        UnityEngine.UI.Text number = captureBar.Find("LiveSlotLabel_" + i)
                            ?.GetComponent<UnityEngine.UI.Text>();
                        Require(number != null && number.cachedTextGenerator.vertexCount > 0,
                            "hotbar slot number " + (i + 1) + " is not rendered");
                    }
                }
                Debug.Log("[ROA PROBE] Capture layout: canvas "
                    + ((RectTransform)canvas.transform).rect + ", safe " + safe.rect
                    + ", quick " + safe.Find("Quickbar")?.gameObject.activeSelf
                    + ", graphic count " + host.GetComponentsInChildren<UnityEngine.UI.Graphic>(false).Length);
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
                Debug.Log("[ROA PROBE] HUD capture: " + path);
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

        private static void Set<T>(object target, string fieldName, T value)
        {
            FieldInfo field = target.GetType().GetField(fieldName,
                BindingFlags.Instance | BindingFlags.NonPublic);
            Require(field != null, "HUD capture field missing: " + fieldName);
            field.SetValue(target, value);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
