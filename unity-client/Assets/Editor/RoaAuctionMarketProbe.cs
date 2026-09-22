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
                }
            };
        }

        [MenuItem("Realm of Ashes/Проверить рынок в Play Mode")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Exit Play Mode first.");
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save scenes before running the probe.");
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
                ["categories"] = new JArray(new JObject { ["id"] = "ammo", ["label"] = "Патроны", ["count"] = 1 },
                    new JObject { ["id"] = "aid", ["label"] = "Медицина", ["count"] = 1 }),
                ["items"] = new JArray(new JObject { ["itemId"] = "ammo9", ["category"] = "ammo", ["sellQty"] = 40, ["sellPrice"] = 12, ["buyQty"] = 10, ["buyPrice"] = 8 },
                    new JObject { ["itemId"] = "medkit", ["category"] = "aid", ["sellQty"] = 0, ["buyQty"] = 0 }),
                ["orders"] = new JArray(
                    new JObject { ["id"] = "lot_1", ["itemId"] = "ammo9", ["side"] = "sell", ["qty"] = 40, ["price"] = 12, ["mine"] = false, ["ownerName"] = "Торговец", ["remainingSeconds"] = 86400 },
                    new JObject { ["id"] = "buy_2", ["itemId"] = "ammo9", ["side"] = "buy", ["qty"] = 10, ["price"] = 8, ["mine"] = true, ["filled"] = 3, ["remainingSeconds"] = 86400 }),
                ["shelf"] = new JObject { ["silver"] = 55, ["items"] = new JArray(), ["sales"] = 1 },
                ["historyItemId"] = "ammo9", ["history"] = new JArray(24, 168, 672).Select(hours => new JObject {
                    ["hours"] = (int)hours, ["qty"] = 125, ["average"] = 11.4, ["min"] = 8, ["max"] = 14 }).Aggregate(new JArray(), (array, row) => { array.Add(row); return array; }),
                ["activity"] = new JArray(new JObject { ["itemId"] = "ammo9", ["kind"] = "sold", ["qty"] = 5, ["price"] = 12,
                    ["tax"] = 4, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() })
            };
        }

        private static async void RunRuntime()
        {
            try {
                foreach (bool mobile in new[] { false, true })
                    foreach (string mode in new[] { "catalog", "buy", "edit", "journal" })
                        await Capture(mode, mobile);
                RoaAuctionSinCaptureProbe.Run();
                File.WriteAllText(Path.Combine(Output, "result.txt"), "PASS: catalogue search, partial quantity, editing, history and journal in Play Mode at 1440x810 and 844x390.");
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
                if (mode == "buy" || mode == "edit") {
                    var order = state["orders"][mode == "buy" ? 0 : 1] as JObject;
                    Call(screen, "SelectOrder", order, mode == "edit");
                    Require(((InputField)Get(screen, "_qtyInput")).text == (mode == "buy" ? "1" : "10"), "Quantity does not match the selected operation.");
                    ((InputField)Get(screen, "_qtyInput")).text = "3";
                }
                var canvas = host.GetComponentInChildren<Canvas>();
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
                Call(screen, "Rebuild");
                await Task.Yield(); await Task.Yield();
                if (mode == "catalog") {
                    ((InputField)Get(screen, "_searchInput")).text = RoaItemData.Name("medkit");
                    await Task.Yield(); await Task.Yield();
                    Require(((RectTransform)Get(screen, "_list")).Cast<Transform>().Count(child => child.gameObject.activeSelf) == 1,
                        "Search must find an item with no active listings.");
                }
                string all = string.Join("\n", host.GetComponentsInChildren<Text>().Select(text => text.text));
                Require(all.Contains(mode == "buy" ? "КУПИТЬ 3 ШТ" : mode == "edit" ? "СОХРАНИТЬ ИЗМЕНЕНИЯ"
                    : mode == "journal" ? "Продано" : RoaItemData.Name("medkit")), "Missing action in " + mode);
                if (mode == "buy") Require(all.Contains("К оплате: 36"), "Partial purchase total must be 36.");
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
