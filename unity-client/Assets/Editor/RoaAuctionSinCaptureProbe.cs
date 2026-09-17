#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Снимок раздела СИНЬ у аукционера (экономика v3): счёт аккаунта, премиум
    /// и обменник синь↔марки. Экран строится кодом, поэтому проба собирает его
    /// рефлексией из снимка сервера, проверяет подписи и пишет PNG в
    /// Library/AuctionScreen. Рецепт съёмки — RoaPipboyItemsCaptureProbe.
    /// </summary>
    public static class RoaAuctionSinCaptureProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private static readonly string OutputDir = Path.Combine("Library", "AuctionScreen");
        private const int CaptureLayer = 31;

        [MenuItem("Realm of Ashes/Проверить обменник сини")]
        public static void Run()
        {
            Directory.CreateDirectory(OutputDir);
            var failures = new List<string>();
            Capture(false, false, Path.Combine(OutputDir, "sin-buy-desktop.png"), 1440, 810, failures);
            Capture(true, false, Path.Combine(OutputDir, "sin-sell-desktop.png"), 1440, 810, failures);
            Capture(false, true, Path.Combine(OutputDir, "sin-buy-mobile.png"), 844, 390, failures);
            // Премиум покупается в два нажатия: после первого кнопка спрашивает подтверждение.
            Capture(false, false, Path.Combine(OutputDir, "sin-premium-confirm.png"), 1440, 810, failures, true);
            if (failures.Count > 0)
                throw new InvalidOperationException("[AUCTION SIN] FAIL: " + string.Join("; ", failures));
            Debug.Log("[AUCTION SIN] OK: раздел СИНЬ показывает счёт, премиум, книгу обменника и форму ордера; снимки в " + OutputDir);
        }

        private static JObject Self()
        {
            return new JObject
            {
                ["name"] = "Странник",
                ["inventory"] = new JArray { new JObject { ["id"] = "silver", ["qty"] = 4200 } }
            };
        }

        private static JObject AuctionState()
        {
            return new JObject
            {
                ["marketId"] = "sluiceCity",
                ["marketName"] = "Створ",
                ["taxPct"] = 0.04,
                ["setupFeePct"] = 0.025,
                ["durationChoicesHours"] = new JArray(24, 72, 168, 720),
                ["orders"] = new JArray(),
                ["items"] = new JArray(),
                ["categories"] = new JArray(),
                ["shelf"] = new JObject { ["silver"] = 0, ["items"] = new JArray(), ["sales"] = 0 }
            };
        }

        private static JObject Account()
        {
            return new JObject
            {
                ["sin"] = 420,
                ["premium"] = true,
                ["premiumUntil"] = DateTimeOffset.UtcNow.AddDays(21).ToUnixTimeMilliseconds(),
                ["premiumPriceSin"] = 300,
                ["premiumDays"] = 30,
                ["focus"] = 18450,
                ["focusCap"] = 30000
            };
        }

        private static JObject Order(string id, string side, int qty, int price, bool mine, string owner)
        {
            return new JObject
            {
                ["id"] = id,
                ["side"] = side,
                ["itemId"] = "blue",
                ["qty"] = qty,
                ["filled"] = 0,
                ["price"] = price,
                ["ownerName"] = owner,
                ["mine"] = mine,
                ["remainingSeconds"] = 50000
            };
        }

        private static JObject Exchange()
        {
            return new JObject
            {
                ["orderFee"] = 10,
                ["durationChoicesHours"] = new JArray(24, 72, 168, 720),
                ["orders"] = new JArray
                {
                    Order("lot_1", "sell", 120, 27, false, "Рыжий"),
                    Order("lot_2", "sell", 40, 24, false, "Шпала"),
                    Order("lot_3", "sell", 15, 30, true, "Странник"),
                    Order("buy_4", "buy", 60, 21, false, "Ткач"),
                    Order("buy_5", "buy", 500, 19, false, "Управа Створа")
                },
                ["shelf"] = new JObject { ["silver"] = 375, ["items"] = new JArray(), ["sales"] = 2 }
            };
        }

        private static void Set(object target, string field, object value)
        {
            FieldInfo info = target.GetType().GetField(field, Private);
            if (info == null) throw new MissingFieldException(target.GetType().Name, field);
            info.SetValue(target, value is string text && info.FieldType.IsEnum ? Enum.Parse(info.FieldType, text) : value);
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

        private static void Capture(bool sell, bool mobile, string path, int width, int height, List<string> failures,
                                    bool confirmPremium = false)
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            string label = (sell ? "sell" : "buy") + (mobile ? "/mobile" : "/desktop") + (confirmPremium ? "/confirm" : string.Empty);
            try
            {
                JObject self = Self();
                host = new GameObject("AuctionSinCaptureProbe");
                var socket = host.AddComponent<RoaSocketClient>();
                socket.enabled = false;
                typeof(RoaSocketClient).GetProperty("Session").SetValue(socket, new JoinAck { Self = self, LocationId = "sluiceCity" });
                var inventory = host.AddComponent<RoaInventory>();
                inventory.enabled = false;
                inventory.Socket = socket;
                typeof(RoaInventory).GetMethod("ApplySelf", Private).Invoke(inventory, new object[] { self });

                var screen = host.AddComponent<RoaAuctionCanvas>();
                screen.enabled = false;
                Call(screen, "EnsureBuilt");
                ((GameObject)typeof(RoaAuctionCanvas).GetField("_root", Private).GetValue(screen)).SetActive(true);
                Set(screen, "_state", AuctionState());
                Set(screen, "_snapshotAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                Set(screen, "_sinAccount", Account());
                Set(screen, "_sinExchange", Exchange());
                Set(screen, "_sinSnapshotAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                Set(screen, "_durationHours", 72);
                Set(screen, "_tab", "Sin");
                Set(screen, "_sinSell", sell);
                Set(screen, "_premiumConfirm", confirmPremium);
                Call(screen, "PrepareSinForm");

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
                Canvas.ForceUpdateCanvases();
                Call(screen, "Rebuild");
                Canvas.ForceUpdateCanvases();

                string[] texts = host.GetComponentsInChildren<Text>(true)
                    .Where(text => text.gameObject.activeInHierarchy)
                    .Select(text => text.text ?? string.Empty).ToArray();
                string all = string.Join("\n", texts);
                foreach (string expected in new[]
                {
                    "СИНЬ · 420 ★", "ОБМЕННИК СИНИ", "Синь на счёте", "Фокус", "18450 из 30000",
                    "ПРОДАЮТ СИНЬ", "ВЫКУПАЮТ СИНЬ", "24 марок за синь",
                    confirmPremium ? "ПОДТВЕРДИТЬ: СПИСАТЬ 300 СИНИ" : "ПРОДЛИТЬ ПРЕМИУМ: 300 СИНИ / 30 Д",
                    "ЗАБРАТЬ МАРКИ С ПОЛКИ", "сбор за ордер 10 марок", "Премиум: налог рынка ниже",
                    sell ? "Со счёта уйдёт" : "Заморозится"
                })
                {
                    if (!all.Contains(expected)) failures.Add(label + ": нет текста «" + expected + "»");
                }
                // Лучшая цена книги — подсказка формы: продажа по лучшему выкупу, покупка по лучшей продаже.
                string price = ((InputField)typeof(RoaAuctionCanvas).GetField("_priceInput", Private).GetValue(screen)).text;
                if (price != (sell ? "21" : "24")) failures.Add(label + ": цена формы " + price);
                if (!((InputField)typeof(RoaAuctionCanvas).GetField("_qtyInput", Private).GetValue(screen)).gameObject.activeSelf)
                    failures.Add(label + ": поле количества скрыто");

                SetLayerRecursively(canvas.gameObject, CaptureLayer);
                cameraObject = new GameObject("AuctionSinCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.16f, 0.14f, 0.11f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;

                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { name = "AuctionSin", antiAliasing = 4 };
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
                readback = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
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
    }
}
#endif
