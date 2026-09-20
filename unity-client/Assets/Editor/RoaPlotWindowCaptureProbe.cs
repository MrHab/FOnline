#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
    /// Снимок окна таблички участка: торги за свободное место, ряд построек с
    /// ценой станка по книге города и снос чужого станка. Окно строится кодом,
    /// поэтому проба собирает его рефлексией из снимка сервера, проверяет
    /// подписи и пишет PNG в Library/PlotWindow. Рецепт съёмки —
    /// RoaAuctionSinCaptureProbe.
    /// </summary>
    public static class RoaPlotWindowCaptureProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private static readonly string OutputDir = Path.Combine("Library", "PlotWindow");
        private const int CaptureLayer = 31;

        [MenuItem("Realm of Ashes/Проверить окно участка")]
        public static void Run()
        {
            Directory.CreateDirectory(OutputDir);
            var failures = new List<string>();
            Capture("free", Path.Combine(OutputDir, "plot-free.png"), failures, new[]
            {
                "Участок под застройку", "Участок свободен", "Торги открыты", "Сделать ставку",
                "Ставка сгорает как плата за место"
            });
            // Участок выигран и пуст: видно шесть станков с их ценой в марках.
            Capture("mine-empty", Path.Combine(OutputDir, "plot-mine-empty.png"), failures, new[]
            {
                "Участок ваш", "Оружейный\n120 марок", "Химический\n110 марок",
                "его построят за ваши материалы"
            });
            // Станок построен самим владельцем: сносить можно, но город вернёт
            // половину только при уходе участка.
            Capture("mine-built", Path.Combine(OutputDir, "plot-mine-built.png"), failures, new[]
            {
                "Участок: Оружейный станок", "Снести станок", "вернёт вам половину"
            });
            // Станок достался от прежнего владельца: за него не вернут ничего.
            Capture("inherited", Path.Combine(OutputDir, "plot-inherited.png"), failures, new[]
            {
                "Снести станок", "достался вам от прежнего владельца"
            });
            if (failures.Count > 0)
                throw new InvalidOperationException("[PLOT WINDOW] FAIL: " + string.Join("; ", failures));
            Debug.Log("[PLOT WINDOW] OK: окно участка показывает торги, цену станков и снос; снимки в " + OutputDir);
        }

        private static JObject Plot(string mode)
        {
            bool mine = mode != "free";
            bool built = mode == "mine-built" || mode == "inherited";
            return new JObject
            {
                ["plotId"] = "settlement__plot_7",
                ["objectId"] = "plot_7",
                ["station"] = built ? "weapon_bench" : string.Empty,
                ["stationMine"] = mode == "mine-built",
                ["leased"] = mine,
                ["lesseeName"] = mine ? "Странник" : string.Empty,
                ["mine"] = mine,
                ["leaseEndsAt"] = mine ? DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeMilliseconds() : 0L,
                ["feePct"] = 0.05,
                ["auction"] = new JObject
                {
                    ["open"] = !mine,
                    ["highestBid"] = 0,
                    ["leading"] = false,
                    ["bidderName"] = string.Empty,
                    ["endsAt"] = 0L,
                    ["minBid"] = 100
                }
            };
        }

        /// <summary>Снимок участков локации: по нему окно берёт цену станков.</summary>
        private static JObject State(JObject plot)
        {
            var costs = new JObject();
            foreach (var row in new[]
            {
                new object[] { "weapon_bench", 120 }, new object[] { "ammo_bench", 78 },
                new object[] { "tool_bench", 74 }, new object[] { "repair_bench", 78 },
                new object[] { "energy_bench", 109 }, new object[] { "chem_station", 110 }
            })
            {
                costs[(string)row[0]] = new JObject { ["cost"] = new JObject { ["scrap"] = 20 }, ["worth"] = (int)row[1] };
            }
            return new JObject
            {
                ["locationId"] = "settlement",
                ["plots"] = new JArray { plot },
                ["stationCosts"] = costs,
                ["stationRefundPct"] = 0.5,
                ["payout"] = 0
            };
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

        private static void Capture(string mode, string path, List<string> failures, string[] expected)
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                JObject plot = Plot(mode);
                RoaCraftingPlots.Apply(State(plot));

                host = new GameObject("PlotWindowCaptureProbe");
                var interaction = host.AddComponent<RoaInteraction>();
                interaction.enabled = false;
                typeof(RoaInteraction).GetField("_plotBoardId", Private).SetValue(interaction, "plot_7");

                var window = host.AddComponent<RoaPlotCanvas>();
                window.enabled = false;
                window.Interaction = interaction;
                Call(window, "EnsureBuilt");
                ((GameObject)typeof(RoaPlotCanvas).GetField("_root", Private).GetValue(window)).SetActive(true);
                Call(window, "Refresh");
                Canvas.ForceUpdateCanvases();

                string all = string.Join("\n", host.GetComponentsInChildren<Text>(true)
                    .Where(text => text.gameObject.activeInHierarchy)
                    .Select(text => text.text ?? string.Empty));
                foreach (string needle in expected)
                    if (!all.Contains(needle)) failures.Add(mode + ": нет текста «" + needle.Replace("\n", "|") + "»");

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                SetLayerRecursively(canvas.gameObject, CaptureLayer);
                cameraObject = new GameObject("PlotWindowCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.16f, 0.14f, 0.11f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;

                target = new RenderTexture(760, 620, 24, RenderTextureFormat.ARGB32) { name = "PlotWindow", antiAliasing = 4 };
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
                RoaCraftingPlots.Clear();
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
