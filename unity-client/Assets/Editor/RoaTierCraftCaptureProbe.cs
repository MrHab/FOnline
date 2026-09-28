#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;
using Debug = UnityEngine.Debug;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Тиры в интерфейсе: окно оружейного верстака с полным серверным каталогом
    /// (одна карточка на изделие, переключатель T1–T5, строка навыка профессии) и
    /// страница навыков ПУТНИКа с профессиями. Каталог берётся тем же путём, что у
    /// сервера (src/server/kromka-tiers.js через node), снимки — в Library/TierScreen.
    /// Рецепт съёмки — RoaStationHudCaptureProbe и RoaPipboyItemsCaptureProbe.
    /// </summary>
    public static class RoaTierCraftCaptureProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private static readonly string OutputDir = Path.Combine("Library", "TierScreen");
        private const int CaptureLayer = 31;
        private const string Station = "weapon_bench";

        [MenuItem("Realm of Ashes/Probe/Tiers: workbench and professions")]
        public static void Run()
        {
            Directory.CreateDirectory(OutputDir);
            LoadServerCatalogs();
            var failures = new List<string>();
            CaptureStation("tier-bench-desktop", false, 1440, 810, failures);
            CaptureStation("tier-bench-mobile", true, 844, 390, failures);
            CaptureSkills("tier-professions-desktop", false, 1440, 810, failures);
            CaptureSkills("tier-professions-mobile", true, 844, 390, failures);
            if (failures.Count > 0) throw new InvalidOperationException("[TIER UI] FAIL: " + string.Join("; ", failures));
            Debug.Log("[TIER UI] OK: верстак показывает тиры и навык, ПУТНИК — профессии; снимки в " + OutputDir);
        }

        /// <summary>Каталоги /api/kromka/items без сервера: node собирает их из data/kromka.</summary>
        internal static void LoadServerCatalogs()
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            const string script = "const t=require('./src/server/kromka-tiers');const k=require('./src/server/kromka-items');"
                + "const c=t.readTieredCatalogs('data');process.stdout.write(JSON.stringify({catalog:k.publicItemCatalog(c.itemCatalog),"
                + "fieldRecipes:k.publicFieldRecipeCatalog(c.recipeCatalog),tiers:t.publicTierConfig(c.config)}));";
            var start = new ProcessStartInfo("node", "-e \"" + script + "\"")
            {
                WorkingDirectory = root,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8
            };
            string json;
            using (Process process = Process.Start(start))
            {
                json = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit(60000);
                if (process.ExitCode != 0) throw new InvalidOperationException("node не собрал каталог: " + error);
            }
            JObject response = JObject.Parse(json);
            if (!RoaItemData.ApplyCatalog((JObject)response["catalog"], out string itemError))
                throw new InvalidOperationException("каталог предметов: " + itemError);
            if (!RoaCraftingData.ApplyCatalog((JObject)response["fieldRecipes"], out string recipeError))
                throw new InvalidOperationException("каталог рецептов: " + recipeError);
            RoaTierData.Apply((JObject)response["tiers"]);
        }

        /// <summary>Оружейник 35: T1–T3 открыты, материалов хватает на ПП третьего тира.</summary>
        private static JObject Self()
        {
            var professions = new JArray();
            foreach (RoaTierData.Profession profession in RoaTierData.ProfessionList)
            {
                int level = profession.Id == "craftFirearms" ? 35 : profession.Id == "gatherMetal" ? 12 : 0;
                professions.Add(new JObject
                {
                    ["id"] = profession.Id,
                    ["kind"] = profession.Kind,
                    ["name"] = profession.Name,
                    ["level"] = level,
                    ["xp"] = 25 * level * level + (level > 0 ? 400 : 0),
                    ["levelXp"] = 25 * level * level,
                    ["nextLevelXp"] = 25 * (level + 1) * (level + 1),
                    ["maxTier"] = level >= 30 ? 3 : level >= 10 ? 2 : 1
                });
            }
            return new JObject
            {
                ["name"] = "Странник",
                ["level"] = 12,
                ["special"] = JObject.Parse("{'str':6,'per':6,'end':5,'cha':4,'int':6,'agi':7,'luck':5}"),
                ["skillPoints"] = 0,
                ["skillRanks"] = new JObject { ["lightWeapons"] = 62 },
                ["professions"] = professions,
                ["inventory"] = new JArray
                {
                    new JObject { ["id"] = "silver", ["qty"] = 5000 },
                    new JObject { ["id"] = "metalBarT3", ["qty"] = 8 },
                    new JObject { ["id"] = "plankT3", ["qty"] = 4 },
                    new JObject { ["id"] = "weaponParts", ["qty"] = 6 }
                },
                ["account"] = new JObject { ["premium"] = false }
            };
        }

        private static void CaptureStation(string name, bool mobile, int width, int height, List<string> failures)
        {
            GameObject host = null;
            try
            {
                RoaCraftingPlots.Clear();
                host = new GameObject("TierBenchProbe");
                var interaction = host.AddComponent<RoaInteraction>();
                interaction.enabled = false;
                Set(interaction, "_panel", "Crafting");
                Set(interaction, "_self", Self());
                Set(interaction, "_active", new JObject
                {
                    ["id"] = "probe_station",
                    ["name"] = RoaCraftingData.StationLabel(Station),
                    ["station"] = Station
                });

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
                    RestoreLayoutFlags(canvas.gameObject);
                    Canvas.ForceUpdateCanvases();
                    CheckStation(name, screen, failures);
                });
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void CheckStation(string name, RoaCraftingCanvas screen, List<string> failures)
        {
            IList cards = (IList)Get(screen, "_cards");
            int stationRecipes = RoaCraftingData.Recipes.Count(recipe => recipe.Station == Station);
            if (cards.Count * 3 > stationRecipes) failures.Add(name + ": тиры не собраны в карточки (" + cards.Count + " из " + stationRecipes + ")");
            object smg = cards.Cast<object>().FirstOrDefault(card =>
                ((RoaCraftRecipe)card.GetType().GetField("Recipe").GetValue(card)).GroupKey == "smgcraft");
            if (smg == null) { failures.Add(name + ": нет карточки ПП"); return; }
            var buttons = (Button[])smg.GetType().GetField("TierButtons").GetValue(smg);
            if (buttons == null || buttons.Length != 5) failures.Add(name + ": у ПП не пять кнопок тиров");
            var recipe = (RoaCraftRecipe)smg.GetType().GetField("Recipe").GetValue(smg);
            if (recipe.Tier != 3) failures.Add(name + ": выбран не старший открытый тир, а T" + recipe.Tier);
            string skill = ((Text)smg.GetType().GetField("Skill").GetValue(smg)).text;
            if (!skill.Contains("Оружейник") || !skill.Contains("35") || !skill.Contains("30"))
                failures.Add(name + ": строка навыка «" + skill + "»");
            string head = ((Text)smg.GetType().GetField("Head").GetValue(smg)).text;
            if (!head.Contains("[T3]")) failures.Add(name + ": в названии изделия нет тира: " + head);
            if (!((Button)smg.GetType().GetField("Craft").GetValue(smg)).interactable)
                failures.Add(name + ": открытый T3 при нужных материалах не создаётся");
        }

        private static void CaptureSkills(string name, bool mobile, int width, int height, List<string> failures)
        {
            GameObject host = null;
            try
            {
                JObject self = Self();
                host = new GameObject("TierSkillsProbe");
                var socket = host.AddComponent<RoaSocketClient>();
                socket.enabled = false;
                typeof(RoaSocketClient).GetProperty("Session").SetValue(socket, new JoinAck { Self = self, LocationId = "Развилка" });
                var pipboy = host.AddComponent<RoaPipboy>();
                pipboy.enabled = false;
                pipboy.Socket = socket;
                typeof(RoaPipboy).GetMethod("ApplySelf", Private).Invoke(pipboy, new object[] { self });
                var inventory = host.AddComponent<RoaInventory>();
                inventory.enabled = false;
                inventory.Socket = socket;
                var hud = host.AddComponent<RoaHud>();
                hud.enabled = false;
                hud.Socket = socket;
                var quickbar = host.AddComponent<RoaQuickbar>();
                quickbar.enabled = false;
                var terminal = host.AddComponent<RoaPipboyCanvas>();
                terminal.enabled = false;
                terminal.Socket = socket;
                terminal.Pipboy = pipboy;
                terminal.Inventory = inventory;
                terminal.Hud = hud;
                terminal.Quickbar = quickbar;
                terminal.Open(RoaPipboyCanvas.Page.Skills);

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
                Render(canvas, width, height, Path.Combine(OutputDir, name + ".png"), () =>
                {
                    MethodInfo fit = typeof(RoaPipboyCanvas).GetMethod("FitFrameToViewport", Private);
                    if (fit != null) fit.Invoke(terminal, null);
                    Call(terminal, "Refresh");
                    RestoreLayoutFlags(canvas.gameObject);
                    Canvas.ForceUpdateCanvases();
                    // Профессии — внизу списка навыков: прокручиваем к ним.
                    foreach (ScrollRect scroll in canvas.GetComponentsInChildren<ScrollRect>(false))
                        scroll.verticalNormalizedPosition = 0f;
                    Canvas.ForceUpdateCanvases();
                    string all = string.Join("\n", canvas.GetComponentsInChildren<Text>(false).Select(text => text.text));
                    foreach (string expected in new[] { "Профессии", "Оружейник", "открыт тир T3", "Рудокоп", "Уровень 12" })
                        if (!all.Contains(expected, StringComparison.OrdinalIgnoreCase))
                            failures.Add(name + ": нет текста «" + expected + "»");
                });
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        /// <summary>В редакторе AddComponent сбрасывает флаги раскладки в false; в игре они true.</summary>
        private static void RestoreLayoutFlags(GameObject root)
        {
            foreach (HorizontalOrVerticalLayoutGroup group in root.GetComponentsInChildren<HorizontalOrVerticalLayoutGroup>(true))
            {
                group.childControlWidth = true;
                group.childControlHeight = true;
            }
        }

        private static void Render(Canvas canvas, int width, int height, string path, Action afterScale)
        {
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                SetLayerRecursively(canvas.gameObject, CaptureLayer);
                cameraObject = new GameObject("TierCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.30f, 0.33f, 0.36f, 1f);
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { name = "TierScreen", antiAliasing = 4 };
                target.Create();
                camera.targetTexture = target;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                Canvas.ForceUpdateCanvases();
                afterScale();
                SetLayerRecursively(canvas.gameObject, CaptureLayer);
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = target });
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
