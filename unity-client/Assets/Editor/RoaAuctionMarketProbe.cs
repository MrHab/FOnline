#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    // Exercises the actual runtime canvas in Play Mode at both target sizes.
    [InitializeOnLoad]
    public static class RoaAuctionMarketProbe
    {
        private const string Key = "Roa.AuctionMarketProbe";
        private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        private static readonly string Output = Path.GetFullPath("Library/AuctionMarket");
        static RoaAuctionMarketProbe()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += state => {
                if (!SessionState.GetBool(Key, false)) return;
                if (state == PlayModeStateChange.EnteredPlayMode) RunRuntime();
                if (state == PlayModeStateChange.EnteredEditMode) {
                    SessionState.SetBool(Key, false);
                    if (Application.isBatchMode) EditorApplication.Exit(SessionState.GetInt(Key + ".result", 1));
                    else {
                        string scene = SessionState.GetString(Key + ".scene", string.Empty);
                        SessionState.EraseString(Key + ".scene");
                        if (!string.IsNullOrEmpty(scene)) EditorApplication.delayCall += () => EditorSceneManager.OpenScene(scene);
                    }
                }
            };
        }

        [MenuItem("Realm of Ashes/Проверить рынок в Play Mode")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Exit Play Mode first.");
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save scenes before running the probe.");
            SessionState.SetString(Key + ".scene", UnityEngine.SceneManagement.SceneManager.GetActiveScene().path);
            Directory.CreateDirectory(Output);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SessionState.SetBool(Key, true);
            SessionState.SetInt(Key + ".result", 1);
            EditorApplication.isPlaying = true;
        }

        private static object Get(object target, string name) => target.GetType().GetField(name, Private).GetValue(target);
        private static void Set(object target, string name, object value)
        {
            var field = target.GetType().GetField(name, Private);
            field.SetValue(target, field.FieldType.IsEnum ? Enum.Parse(field.FieldType, (string)value) : value);
        }
        private static object Call(object target, string name, params object[] args) => target.GetType().GetMethod(name, Private).Invoke(target, args);
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }

        private static JObject State()
        {
            return new JObject {
                ["marketName"] = "Створ", ["taxPct"] = 0.08, ["setupFeePct"] = 0.025,
                ["listingLifetimeHours"] = 720, ["durationChoicesHours"] = new JArray(24, 72, 168, 720),
                ["categories"] = new JArray(new JObject { ["id"] = "ammo", ["label"] = "Патроны", ["count"] = 4 },
                    new JObject { ["id"] = "aid", ["label"] = "Медицина", ["count"] = 3 },
                    new JObject { ["id"] = "materials", ["label"] = "Материалы", ["count"] = 2 },
                    new JObject { ["id"] = "tools", ["label"] = "Инструменты", ["count"] = 1 }),
                ["items"] = new JArray(new JObject { ["itemId"] = "ammo9", ["category"] = "ammo", ["sellQty"] = 40, ["sellPrice"] = 12, ["buyQty"] = 14, ["buyPrice"] = 9 },
                    new JObject { ["itemId"] = "medkit", ["category"] = "aid", ["sellQty"] = 0, ["buyQty"] = 0 },
                    new JObject { ["itemId"] = "ammo556", ["category"] = "ammo", ["sellQty"] = 50, ["sellPrice"] = 18 },
                    new JObject { ["itemId"] = "energyCell", ["category"] = "ammo", ["sellQty"] = 15, ["sellPrice"] = 32 },
                    new JObject { ["itemId"] = "shotgunShell", ["category"] = "ammo", ["sellQty"] = 12, ["sellPrice"] = 21 },
                    new JObject { ["itemId"] = "stim", ["category"] = "aid", ["sellQty"] = 7, ["sellPrice"] = 28 },
                    new JObject { ["itemId"] = "antibiotics", ["category"] = "aid", ["sellQty"] = 3, ["sellPrice"] = 46 },
                    new JObject { ["itemId"] = "scrap", ["category"] = "materials", ["sellQty"] = 85, ["sellPrice"] = 8 },
                    new JObject { ["itemId"] = "ore", ["category"] = "materials", ["sellQty"] = 20, ["sellPrice"] = 11 },
                    new JObject { ["itemId"] = "repairKit", ["category"] = "tools", ["sellQty"] = 4, ["sellPrice"] = 75 }),
                ["orders"] = new JArray(
                    new JObject { ["id"] = "lot_1", ["itemId"] = "ammo9", ["category"] = "ammo", ["side"] = "sell", ["qty"] = 40, ["price"] = 12, ["mine"] = false, ["ownerName"] = "Торговец", ["remainingSeconds"] = 86400 },
                    new JObject { ["id"] = "buy_2", ["itemId"] = "ammo9", ["category"] = "ammo", ["side"] = "buy", ["qty"] = 10, ["price"] = 8, ["mine"] = true, ["filled"] = 3, ["remainingSeconds"] = 86400 },
                    new JObject { ["id"] = "buy_3", ["itemId"] = "ammo9", ["category"] = "ammo", ["side"] = "buy", ["qty"] = 4, ["price"] = 9, ["mine"] = false, ["ownerName"] = "Скупщик", ["remainingSeconds"] = 86400 },
                    new JObject { ["id"] = "lot_4", ["itemId"] = "ammo556", ["category"] = "ammo", ["side"] = "sell", ["qty"] = 50, ["price"] = 18, ["remainingSeconds"] = 72000 },
                    new JObject { ["id"] = "lot_5", ["itemId"] = "energyCell", ["category"] = "ammo", ["side"] = "sell", ["qty"] = 15, ["price"] = 32, ["remainingSeconds"] = 50000 },
                    new JObject { ["id"] = "lot_6", ["itemId"] = "shotgunShell", ["category"] = "ammo", ["side"] = "sell", ["qty"] = 12, ["price"] = 21, ["remainingSeconds"] = 45000 },
                    new JObject { ["id"] = "lot_7", ["itemId"] = "stim", ["category"] = "aid", ["side"] = "sell", ["qty"] = 7, ["price"] = 28, ["remainingSeconds"] = 60000 },
                    new JObject { ["id"] = "lot_8", ["itemId"] = "antibiotics", ["category"] = "aid", ["side"] = "sell", ["qty"] = 3, ["price"] = 46, ["remainingSeconds"] = 61000 },
                    new JObject { ["id"] = "lot_9", ["itemId"] = "scrap", ["category"] = "materials", ["side"] = "sell", ["qty"] = 85, ["price"] = 8, ["remainingSeconds"] = 63000 },
                    new JObject { ["id"] = "lot_10", ["itemId"] = "ore", ["category"] = "materials", ["side"] = "sell", ["qty"] = 20, ["price"] = 11, ["remainingSeconds"] = 64000 },
                    new JObject { ["id"] = "lot_11", ["itemId"] = "repairKit", ["category"] = "tools", ["side"] = "sell", ["qty"] = 4, ["price"] = 75, ["remainingSeconds"] = 65000 }),
                ["shelf"] = new JObject { ["silver"] = 55, ["items"] = new JArray(), ["sales"] = 1 },
                ["historyItemId"] = "ammo9", ["history"] = new JArray(24, 168, 672).Select(hours => new JObject {
                    ["hours"] = (int)hours, ["qty"] = 125, ["average"] = 11.4, ["min"] = 8, ["max"] = 14 }).Aggregate(new JArray(), (array, row) => { array.Add(row); return array; }),
                ["historySeries"] = new JArray(new JObject { ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 3600000L * 3600000L,
                    ["qty"] = 25, ["average"] = 12.4, ["min"] = 12, ["max"] = 13, ["trades"] = 3 },
                    new JObject { ["at"] = (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 3600000L - 5) * 3600000L,
                    ["qty"] = 10, ["average"] = 9.2, ["min"] = 8, ["max"] = 10, ["trades"] = 2 }),
                ["activity"] = new JArray(new JObject { ["itemId"] = "ammo9", ["kind"] = "sold", ["qty"] = 5, ["price"] = 12,
                    ["tax"] = 4, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() })
            };
        }

        private static async void RunRuntime()
        {
            try {
                var modes = new[] { "listing", "catalog", "buy", "sell", "sellorder", "buyorder", "edit", "journal" }
                    .Concat(File.Exists(Path.Combine(Output, "verified-state.json")) ? new[] { "verified" } : Array.Empty<string>());
                foreach (bool mobile in new[] { false, true })
                    foreach (string mode in modes)
                        await Capture(mode, mobile);
                RoaAuctionSinCaptureProbe.Run();
                File.WriteAllText(Path.Combine(Output, "result.txt"), "PASS: listing filters, catalogue search, four item actions, quantity, price history, editing and journal at 1440x810 and 844x390"
                    + (File.Exists(Path.Combine(Output, "verified-state.json")) ? "; captured live server trade history." : "."));
                SessionState.SetInt(Key + ".result", 0);
                Debug.Log("[AUCTION MARKET] PASS: runtime interactions and desktop/mobile captures.");
            }
            catch (Exception error) {
                File.WriteAllText(Path.Combine(Output, "result.txt"), "FAIL: " + error);
                Debug.LogException(error);
            }
            finally { EditorApplication.isPlaying = false; }
        }

        private static async Task Capture(string mode, bool mobile)
        {
            var host = new GameObject("AuctionMarketProbe");
            var cameraObject = new GameObject("AuctionMarketCamera");
            RenderTexture target = null;
            Texture2D image = null;
            var previous = RenderTexture.active;
            try {
                var self = new JObject { ["inventory"] = new JArray(new JObject { ["id"] = "silver", ["qty"] = 4200 }, new JObject { ["id"] = "ammo9", ["qty"] = 30 }) };
                var socket = host.AddComponent<RoaSocketClient>(); socket.enabled = false;
                typeof(RoaSocketClient).GetProperty("Session").SetValue(socket, new JoinAck { Self = self, LocationId = "sluiceCity" });
                var inventory = host.AddComponent<RoaInventory>(); inventory.enabled = false; inventory.Socket = socket;
                Call(inventory, "ApplySelf", self);
                var screen = host.AddComponent<RoaAuctionCanvas>(); screen.enabled = false;
                Call(screen, "EnsureBuilt");
                ((GameObject)Get(screen, "_root")).SetActive(true);
                Set(screen, "_inventory", inventory);
                var state = State();
                Set(screen, "_state", state); Set(screen, "_durationHours", 720);
                Set(screen, "_snapshotAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                Set(screen, "_tab", mode == "edit" ? "Mine" : mode == "journal" ? "Journal" : "Buy");
                if (mode == "catalog") Set(screen, "_availability", 2);
                if (mode == "verified") {
                    var verified = JObject.Parse(File.ReadAllText(Path.Combine(Output, "verified-state.json")));
                    Require(verified["itemId"]?.ToString() == "ammo9", "The live capture must be for ammo9.");
                    state["history"] = verified["history"]?.DeepClone();
                    state["historySeries"] = verified["historySeries"]?.DeepClone();
                    Require(state["history"]?[0]?["qty"]?.Value<int>() == 35, "The live capture must contain the verified 35 units.");
                }
                if (mode == "buy" || mode == "verified" || mode == "sell" || mode == "edit") {
                    var order = state["orders"][mode == "buy" || mode == "verified" ? 0 : mode == "sell" ? 2 : 1] as JObject;
                    Call(screen, "SelectOrder", order, mode == "edit");
                    InputField quantity = (InputField)Get(screen, mode == "edit" ? "_qtyInput" : "_modalQty");
                    Require(quantity.text == (mode == "edit" ? "10" : "1"), "Quantity does not match the selected operation.");
                    quantity.text = "3";
                }
                if (mode == "sellorder" || mode == "buyorder") {
                    Call(screen, "SelectItem", "ammo9");
                    Call(screen, "ChooseMarketMode", mode == "sellorder" ? 2 : 3);
                }
                var canvas = host.GetComponentInChildren<Canvas>();
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
                Call(screen, "Rebuild");
                await Task.Yield(); await Task.Yield();
                if (mode == "catalog") {
                    ((InputField)Get(screen, "_searchInput")).text = RoaItemData.Name("medkit");
                    await Task.Yield(); await Task.Yield();
                    host.GetComponentsInChildren<Button>().First(button => button.name == "CategoryFilter").onClick.Invoke();
                    host.GetComponentsInChildren<Button>().First(button => button.name == "Option"
                        && button.GetComponentInChildren<Text>()?.text == "Медицина").onClick.Invoke();
                    Require((string)Get(screen, "_category") == "aid", "The category filter must change the listing.");
                    await Task.Yield(); await Task.Yield();
                    Require(((RectTransform)Get(screen, "_list")).Cast<Transform>().Count(child => child.name == "Item" && child.gameObject.activeSelf) == 1,
                        "Search must find an item with no active listings.");
                }
                if (mode == "listing") {
                    Require((int)Get(screen, "_pageCount") == 2, "Nine listings must span two pages.");
                    ((Button)Get(screen, "_nextPage")).onClick.Invoke();
                    Require((int)Get(screen, "_page") == 1, "Next page must change the visible listings.");
                    ((Button)Get(screen, "_previousPage")).onClick.Invoke();
                    await Task.Yield(); await Task.Yield();
                    Require(((RectTransform)Get(screen, "_list")).Cast<Transform>().Count(child => child.name == "Item") == 7,
                        "A market page must display seven individual offers.");
                }
                if (mode == "buy" || mode == "verified") {
                    Require(host.GetComponentsInChildren<RectTransform>().Count(rect => rect.name == "TradeHour") == (mode == "verified" ? 1 : 2),
                        "Price chart must draw the completed trade buckets.");
                    Require(host.GetComponentsInChildren<RectTransform>().Count(rect => rect.name == "PriceSegment") == (mode == "verified" ? 0 : 1),
                        "The chart must join distinct completed trade hours with a price line.");
                    host.GetComponentsInChildren<Button>().First(button => button.GetComponentInChildren<Text>()?.text == "7 ДНЕЙ").onClick.Invoke();
                    Require((int)Get(screen, "_historyHours") == 168, "History period control must change the chart range.");
                    host.GetComponentsInChildren<Button>().First(button => button.GetComponentInChildren<Text>()?.text == "24 ЧАСА").onClick.Invoke();
                    await Task.Yield(); await Task.Yield();
                }
                string all = string.Join("\n", host.GetComponentsInChildren<Text>().Select(text => text.text));
                Require(all.Contains(mode == "buy" || mode == "verified" ? "К оплате: 36" : mode == "edit" ? "СОХРАНИТЬ ИЗМЕНЕНИЯ"
                    : mode == "journal" ? "Продано" : mode == "catalog" ? RoaItemData.Name("medkit")
                    : mode == "listing" ? "КУПИТЬ С РЫНКА" : mode == "sellorder" ? "ВЫСТАВИТЬ НА ПРОДАЖУ"
                    : mode == "sell" ? "ПРОДАТЬ" : "ПОСТАВИТЬ ЗАЯВКУ"), "Missing action in " + mode);
                if (mode == "buy" || mode == "verified") Require(all.Contains("К оплате: 36"), "Partial purchase total must be 36.");
                if (mode == "edit") Require(all.Contains("Вернётся: 56"), "Edit must preview the correct reserve refund.");
                Camera camera = cameraObject.AddComponent<Camera>(); camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.black;
                canvas.renderMode = RenderMode.ScreenSpaceCamera; canvas.worldCamera = camera; canvas.planeDistance = 1f;
                target = new RenderTexture(mobile ? 844 : 1440, mobile ? 390 : 810, 24);
                target.Create(); camera.targetTexture = target;
                int settleFrame = Time.frameCount + 3;
                while (Time.frameCount < settleFrame) await Task.Yield();
                Canvas.ForceUpdateCanvases();
                foreach (InputField input in host.GetComponentsInChildren<InputField>()) {
                    Vector3[] corners = new Vector3[4]; ((RectTransform)input.transform).GetWorldCorners(corners);
                    foreach (var corner in corners) {
                        Vector3 point = camera.WorldToViewportPoint(corner);
                        Require(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1, "Input outside the screen: " + input.name);
                    }
                }
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = target });
                else camera.Render();
                RenderTexture.active = target;
                image = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0); image.Apply();
                File.WriteAllBytes(Path.Combine(Output, mode + (mobile ? "-mobile" : "-desktop") + ".png"), image.EncodeToPNG());
            }
            finally {
                RenderTexture.active = previous;
                if (image != null) UnityEngine.Object.DestroyImmediate(image);
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                UnityEngine.Object.DestroyImmediate(host); UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }
    }
}
#endif
