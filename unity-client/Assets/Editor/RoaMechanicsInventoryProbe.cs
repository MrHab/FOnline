#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Reflection;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaMechanicsInventoryProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string VisualKey = "roa.mechanics.visual-probe";
        private static int _visualStage;
        private static double _nextStage;
        private static RoaPipboyCanvas _visualCanvas;
        private static string _capturePath;
        private static double VisualDeadline = EditorApplication.timeSinceStartup + 90;

        static RoaMechanicsInventoryProbe()
        {
            if (SessionState.GetBool(VisualKey, false)) EditorApplication.update += TickVisual;
        }

        public static void RunVisualBatch()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SessionState.SetBool(VisualKey, true);
            _visualStage = 0;
            VisualDeadline = EditorApplication.timeSinceStartup + 90;
            EditorApplication.update -= TickVisual;
            EditorApplication.update += TickVisual; // Also supports projects with domain reload disabled.
            EditorApplication.EnterPlaymode();
        }

        private static void TickVisual()
        {
            if (EditorApplication.timeSinceStartup > VisualDeadline)
            {
                SessionState.SetBool(VisualKey, false);
                Debug.LogError("[MECHANICS VISUAL] Timed out waiting for the play-mode UI.");
                EditorApplication.Exit(1);
                return;
            }
            if (!EditorApplication.isPlaying || EditorApplication.timeSinceStartup < _nextStage) return;
            try
            {
                if (_visualStage == 0 || _visualStage == 4)
                {
                    bool mobile = _visualStage == 4;
                    Type gameViewType = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
                    var view = EditorWindow.GetWindow(gameViewType);
                    view.position = new Rect(0, 0, mobile ? 900 : 1440, mobile ? 440 : 900);
                    view.Show();
                    Screen.SetResolution(mobile ? 844 : 1280, mobile ? 390 : 720, false);
                    _visualStage++;
                    _nextStage = EditorApplication.timeSinceStartup + 2;
                    return;
                }
                if (_visualStage == 1 || _visualStage == 5)
                {
                    bool mobile = _visualStage == 5;
                    if (_visualCanvas == null)
                    {
                        var host = new GameObject("MechanicsVisualClient");
                        var camera = new GameObject("MechanicsVisualCamera").AddComponent<Camera>();
                        camera.clearFlags = CameraClearFlags.SolidColor;
                        camera.backgroundColor = new Color(0.05f, 0.07f, 0.08f);
                        var inventory = host.AddComponent<RoaInventory>();
                        inventory.CanvasDriven = true;
                        inventory.InputEnabled = false;
                        host.AddComponent<RoaItemPopups>().enabled = false;
                        _visualCanvas = host.AddComponent<RoaPipboyCanvas>();
                        _visualCanvas.enabled = false; // Keep fixture UI open without a live login session.
                        _visualCanvas.Inventory = inventory;
                        var hud = host.AddComponent<RoaHud>();
                        hud.CanvasDriven = true;
                        typeof(RoaHud).GetMethod("HandleArtifactRuntime", Private).Invoke(hud, new object[] {
                            JObject.Parse(@"{'artifactRuntime':{'hydration':35,'stimSeconds':12,'wetSeconds':30}}") });
                        typeof(RoaInventory).GetMethod("ApplySelf", Private).Invoke(inventory, new object[] {
                            JObject.Parse(@"{'inventory':[{'id':'artifactSpring','qty':2},{'id':'water','qty':3},{'id':'food','qty':2},{'id':'stim','qty':1}],
                                'artifactRecords':[{'id':'hot','itemId':'artifactSpring','hot':true},
                                {'id':'stable','itemId':'artifactSpring','stabilized':true}], 'artifactSlots':[]}") });
                    }
                    _visualCanvas.Open(RoaPipboyCanvas.Page.Items);
                    typeof(RoaPipboyCanvas).GetField("_selectedItemId", Private).SetValue(_visualCanvas, "artifactSpring");
                    typeof(RoaPipboyCanvas).GetMethod("RefreshSelection", Private).Invoke(_visualCanvas, null);
                    var button = (Button)typeof(RoaPipboyCanvas).GetField("_equipButton", Private).GetValue(_visualCanvas);
                    button.onClick.Invoke();
                    Require(RoaItemPopups.Instance.MenuOpen, "Artifact action menu opens from the visible inventory button");
                    foreach (CanvasScaler scaler in UnityEngine.Object.FindObjectsByType<CanvasScaler>())
                        RoaUiScale.Apply(scaler, mobile);
                    Canvas.ForceUpdateCanvases();
                    typeof(RoaPipboyCanvas).GetMethod("FitFrameToViewport", Private).Invoke(_visualCanvas, null);
                    button.onClick.Invoke();
                    var frame = (RectTransform)typeof(RoaPipboyCanvas).GetField("_frameRect", Private).GetValue(_visualCanvas);
                    var corners = new Vector3[4];
                    frame.GetWorldCorners(corners);
                    foreach (Vector3 corner in corners)
                        Require(corner.x >= -1 && corner.y >= -1 && corner.x <= Screen.width + 1 && corner.y <= Screen.height + 1, "Inventory frame fits the viewport");
                    Require(Screen.width > Screen.height, "Landscape viewport is required");
                    _capturePath = Path.Combine(Path.GetTempPath(), mobile ? "roa-mechanics-mobile.png" : "roa-mechanics-desktop.png");
                    ScreenCapture.CaptureScreenshot(_capturePath);
                    Debug.Log($"[MECHANICS VISUAL] {(mobile ? "mobile" : "desktop")}: {Screen.width}x{Screen.height}, menu opened, capture {_capturePath}");
                    _visualStage++;
                    _nextStage = EditorApplication.timeSinceStartup + 2;
                    return;
                }
                Require(File.Exists(_capturePath), "Unity must finish writing the visual capture");
                var captured = new Texture2D(2, 2);
                captured.LoadImage(File.ReadAllBytes(_capturePath));
                int visiblePixels = 0;
                foreach (Color32 pixel in captured.GetPixels32()) if (pixel.g > 60) visiblePixels++;
                UnityEngine.Object.Destroy(captured);
                Require(visiblePixels > 100, "Capture must contain the rendered UI, not a blank frame");
                if (_visualStage == 2 || _visualStage == 6)
                {
                    bool mobile = _visualStage == 6;
                    RoaItemPopups.Instance.HideMenu();
                    typeof(RoaPipboyCanvas).GetField("_selectedItemId", Private).SetValue(_visualCanvas, "water");
                    typeof(RoaPipboyCanvas).GetMethod("RefreshSelection", Private).Invoke(_visualCanvas, null);
                    var use = (Button)typeof(RoaPipboyCanvas).GetField("_useButton", Private).GetValue(_visualCanvas);
                    Require(use.interactable, "Water has a visible enabled Use action");
                    Canvas.ForceUpdateCanvases();
                    _capturePath = Path.Combine(Path.GetTempPath(), mobile ? "roa-provisions-mobile.png" : "roa-provisions-desktop.png");
                    ScreenCapture.CaptureScreenshot(_capturePath);
                    Debug.Log($"[MECHANICS VISUAL] provisions {(mobile ? "mobile" : "desktop")}, usable water, capture {_capturePath}");
                    _visualStage++;
                    _nextStage = EditorApplication.timeSinceStartup + 2;
                    return;
                }
                if (_visualStage == 3) { _visualStage = 4; return; }
                SessionState.SetBool(VisualKey, false);
                EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                SessionState.SetBool(VisualKey, false);
                Debug.LogException(error);
                EditorApplication.Exit(1);
            }
        }

        [MenuItem("Realm of Ashes/Проверить ремонт и артефакты инвентаря")]
        public static void Run()
        {
            var host = new GameObject("MechanicsInventoryProbe");
            try
            {
                var inventory = host.AddComponent<RoaInventory>();
                var canvas = host.AddComponent<RoaPipboyCanvas>();
                canvas.Inventory = inventory;
                JObject self = JObject.Parse(@"{
                    'inventory': [{'id':'artifactSpring','qty':2},{'id':'water','qty':3},{'id':'food','qty':2}],
                    'equipmentRuntime': {'weapon':'ui_pistol_a_1','offhand':'ui_pistol_b_2'},
                    'itemConditions': {'pistol':100},
                    'weaponModifications': [{'id':'ui_pistol_a_1','condition':42},{'id':'ui_pistol_b_2','condition':87}],
                    'artifactRecords': [
                        {'id':'hot','itemId':'artifactSpring','hot':true,'stabilized':false},
                        {'id':'stable','itemId':'artifactSpring','hot':false,'stabilized':true}],
                    'artifactSlots': ['stable']
                }");
                typeof(RoaInventory).GetMethod("ApplySelf", Private).Invoke(inventory, new object[] { self });
                Require(inventory.ConditionPercent("ui_pistol_a_1") == 42, "Repair reads the selected runtime condition");
                Require(inventory.ConditionPercent("ui_pistol_b_2") == 87, "Other hand retains its own condition");
                var options = (List<RoaItemPopups.Option>)typeof(RoaPipboyCanvas)
                    .GetMethod("BuildArtifactContextOptions", Private).Invoke(canvas, new object[] { "artifactSpring" });
                // У каждого экземпляра свои действия: горячий стабилизируют или
                // разбирают, стоящий на поясе снимают или смотрят предпросмотр.
                Require(options.Count == 4, "Each artifact instance has its own actions: " + options.Count);
                Require(options[0].Label.StartsWith("Стабилизировать") && options[1].Label.StartsWith("Разобрать"),
                    "Hot artifact exposes stabilization and salvage");
                Require(options[2].Label.StartsWith("Снять с пояса") && options[3].Label.StartsWith("Предпросмотр"),
                    "Slotted artifact can be removed and previewed");
                Require(options.FindAll(option => option.Label.StartsWith("Разобрать")).Count == 1, "A slotted artifact cannot be salvaged");
                self["artifactSlots"] = new JArray();
                typeof(RoaInventory).GetMethod("ApplySelf", Private).Invoke(inventory, new object[] { self });
                options = (List<RoaItemPopups.Option>)typeof(RoaPipboyCanvas)
                    .GetMethod("BuildArtifactContextOptions", Private).Invoke(canvas, new object[] { "artifactSpring" });
                Require(options.Count == 5 && options[2].Label.StartsWith("Установить на пояс"), "Stable artifact exposes equip");
                Require(!inventory.SubmitArtifactAction("equip", "stable"), "Disconnected UI must not mutate loadout");
                Require(inventory.IsQuickAssignable("water") && inventory.IsQuickAssignable("food"), "Provisions work from the quickbar");
                Require(RoaItemInfo.Get("water").Usable && RoaItemInfo.Get("food").Usable, "Provisions expose Use in the inventory");
                var audio = host.AddComponent<RoaAudio>();
                audio.ApplyArtifactEffects(JObject.Parse(@"{'artifactEffects':{'hearingRangePct':-0.3,'movementNoisePct':-0.35}}"));
                Require(Mathf.Abs(audio.HearingMultiplier - 0.7f) < 0.001f, "Husher hearing penalty reaches audio");
                audio.ApplyArtifactEffects(JObject.Parse(@"{'artifactEffects':{}}"));
                Require(Mathf.Abs(audio.HearingMultiplier - 1f) < 0.001f, "Removing Husher restores hearing");
                var hud = host.AddComponent<RoaHud>();
                typeof(RoaHud).GetMethod("HandleArtifactRuntime", Private).Invoke(hud, new object[] {
                    JObject.Parse(@"{'artifactRuntime':{'hydration':35,'stimSeconds':12,'wetSeconds':30,'stunSeconds':1}}") });
                Require(hud.ArtifactStatus.Contains("35%") && hud.ArtifactStatus.Contains("Стим")
                    && hud.ArtifactStatus.Contains("Намокание") && hud.ArtifactStatus.Contains("Оглушение"), "Server statuses are visible");
                RequireGearTiles(inventory, canvas);
                Debug.Log("[MECHANICS INVENTORY] PASS: instance durability, stabilization, belt equip/unequip, unstacked gear tiles and disconnected guard.");
            }
            finally { UnityEngine.Object.DestroyImmediate(host); }
        }

        /// <summary>
        /// Сетка предметов: надетая вещь — своя плитка и не сливается с такой же в
        /// сумке, экипировка из сумки лежит поштучно, расходники остаются стопкой.
        /// </summary>
        private static void RequireGearTiles(RoaInventory inventory, RoaPipboyCanvas canvas)
        {
            // Слот и износ предмета клиент знает только из серверного каталога.
            JObject items = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/kromka/items.json"))));
            Require(RoaItemData.ApplyCatalog(items, out string catalogError), "Item catalog rejected: " + catalogError);
            Require(RoaInventory.IsGear("pistol") && RoaInventory.IsGear("leather") && RoaInventory.IsGear("knife"), "Weapons and armour are gear");
            Require(!RoaInventory.IsGear("medkit") && !RoaInventory.IsGear("ammo9") && !RoaInventory.IsGear("artifactSpring"),
                "A hand-held consumable, ammo and artifacts are not gear");

            JObject self = JObject.Parse(@"{
                'inventory': [{'id':'pistol','qty':2},{'id':'leather','qty':2},{'id':'medkit','qty':3}],
                'equipmentRuntime': {'weapon':'ui_pistol_a_1','offhand':'ui_pistol_b_2','armor':'leather'},
                'weaponInventoryRuntime': [{'id':'ui_pistol_c_3','baseId':'pistol','qty':1,'condition':55},
                                           {'id':'pistol','baseId':'pistol','qty':1,'condition':90}],
                'weaponModifications': [{'id':'ui_pistol_a_1','condition':42},{'id':'ui_pistol_b_2','condition':87}],
                'itemConditions': {'pistol':100,'leather':70}
            }");
            typeof(RoaInventory).GetMethod("ApplySelf", Private).Invoke(inventory, new object[] { self });

            var tiles = new List<object>();
            foreach (object tile in (System.Collections.IEnumerable)typeof(RoaPipboyCanvas)
                .GetMethod("BuildItemTiles", Private).Invoke(canvas, null)) tiles.Add(tile);
            Func<object, string, object> field = (tile, name) => tile.GetType().GetField(name).GetValue(tile);
            Func<string, bool, List<object>> of = (baseId, worn) => tiles.FindAll(tile =>
                (string)field(tile, "BaseId") == baseId && string.IsNullOrEmpty((string)field(tile, "Slot")) != worn);

            Require(tiles.Count == 8, "Two worn pistols, a worn jacket, two spare pistols, two spare jackets and one medkit stack: " + tiles.Count);
            Require(of("pistol", true).Count == 2 && of("pistol", false).Count == 2, "Worn pistols never merge with the spare ones");
            Require(of("leather", true).Count == 1 && of("leather", false).Count == 2, "A worn jacket never merges with the spare jackets");
            Require(tiles.TrueForAll(tile => !RoaInventory.IsGear((string)field(tile, "BaseId")) || (int)field(tile, "Qty") == 1), "Gear never stacks");
            Require((int)field(of("medkit", false)[0], "Qty") == 3, "Consumables still stack");
            Require((string)field(of("pistol", false)[0], "RuntimeId") == "ui_pistol_c_3" && (string)field(of("pistol", false)[1], "RuntimeId") == "pistol",
                "Spare pistols carry the server's instance ids");
            Require(inventory.BagConditionPercent("ui_pistol_c_3") == 55 && inventory.BagConditionPercent("pistol") == 90,
                "A spare pistol shows its own wear, not the worn one's");
            Require(inventory.OwnsItem("ui_pistol_c_3"), "A bag instance id is an owned item");

            var spareMenu = (List<RoaItemPopups.Option>)typeof(RoaPipboyCanvas)
                .GetMethod("BuildItemContextOptions", Private).Invoke(canvas, new[] { of("pistol", false)[0] });
            Require(spareMenu.Exists(option => option.Label == "В левую руку") && !spareMenu.Exists(option => option.Label.StartsWith("Снять"))
                && spareMenu.Exists(option => option.Label == "Выбросить на землю" && !option.Disabled),
                "A spare pistol is equipped or dropped even while the same pistol is worn");
            var wornMenu = (List<RoaItemPopups.Option>)typeof(RoaPipboyCanvas)
                .GetMethod("BuildItemContextOptions", Private).Invoke(canvas, new[] { of("pistol", true)[0] });
            Require(wornMenu[0].Label.StartsWith("Снять из") && wornMenu.Exists(option => option.Label.StartsWith("Выбросить") && option.Disabled),
                "A worn pistol is taken off first and cannot be dropped");
        }

        public static void RunBatch()
        {
            try { Run(); EditorApplication.Exit(0); }
            catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
