#if UNITY_EDITOR
using System.IO;
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
    /// Снимок экрана персонажа ПУТНИКа в edit mode — единственный способ увидеть
    /// вёрстку, не запуская игру: ни одна из 25 автопроверок не смотрит на геометрию.
    ///
    /// Три ловушки edit mode, из-за которых наивный снимок выходит пустым:
    ///   * ScreenSpaceOverlay камерой не снимается — канвас переводится в
    ///     ScreenSpaceCamera с выключенной камерой;
    ///   * второй Refresh зовёт Destroy, который в edit mode отложен, — поэтому
    ///     хост пересоздаётся под каждый снимок, а не переиспользуется;
    ///   * appearance в фикстуре уводит RefreshItemsPanel в сеть за GLB — его тут нет.
    /// Рецепт съёмки повторяет RoaHudReadabilityProbe.Capture, фикстура — RoaProgressionProbe.
    /// </summary>
    public static class RoaPipboyItemsCaptureProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private static readonly string OutputDir = Path.Combine("Library", "PipboyScreen");
        /// <summary>Тот же слой, что у превью персонажа: в edit mode он свободен.</summary>
        private const int CaptureLayer = 31;

        private static void SetLayerRecursively(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform) SetLayerRecursively(child.gameObject, layer);
        }

        [MenuItem("Realm of Ashes/Проверить экран ПУТНИКА")]
        public static void Run()
        {
            Directory.CreateDirectory(OutputDir);
            string desktop = Path.Combine(OutputDir, "items-desktop.png");
            string mobile = Path.Combine(OutputDir, "items-mobile.png");
            string portrait = Path.Combine(OutputDir, "items-portrait.png");

            Capture(RoaPipboyCanvas.Page.Items, desktop, false, 1440, 810);
            Capture(RoaPipboyCanvas.Page.Items, mobile, true, 844, 390);
            // Портрет — худший случай по масштабу: именно ради него существует компакт-режим.
            Capture(RoaPipboyCanvas.Page.Items, portrait, true, 390, 844);

            Debug.Log("[PIPBOY SCREEN] снимки готовы: " + desktop + " | " + mobile + " | " + portrait);
        }

        /// <summary>
        /// Фикстура игрока. Намеренно без appearance: модель персонажа тянется по сети,
        /// и проба зависла бы на загрузке GLB.
        /// </summary>
        private static JObject Self()
        {
            return new JObject
            {
                ["name"] = "Странник",
                ["level"] = 12,
                ["equipmentRevision"] = 4,
                ["special"] = JObject.Parse("{'str':6,'per':6,'end':5,'cha':4,'int':6,'agi':7,'luck':5}"),
                ["skillPoints"] = 3,
                ["talentPoints"] = 1,
                ["taggedSkills"] = new JArray("lightWeapons"),
                ["skillRanks"] = new JObject { ["lightWeapons"] = 62 },
                ["talentRanks"] = new JObject { ["toughness"] = 1 },
                ["worldFactionId"] = "tract_league",
                ["socialState"] = new JObject
                {
                    ["clan"] = new JObject { ["name"] = "Завет" }
                },
                ["inventory"] = new JArray
                {
                    new JObject { ["id"] = "rifle", ["qty"] = 1 },
                    new JObject { ["id"] = "pistol", ["qty"] = 1 },
                    new JObject { ["id"] = "knife", ["qty"] = 1 },
                    new JObject { ["id"] = "combatArmor", ["qty"] = 1 },
                    new JObject { ["id"] = "tacticalHelmet", ["qty"] = 1 },
                    new JObject { ["id"] = "scoutBoots", ["qty"] = 1 },
                    new JObject { ["id"] = "backpack", ["qty"] = 1 },
                    new JObject { ["id"] = "medkit", ["qty"] = 4 },
                    new JObject { ["id"] = "stim", ["qty"] = 2 },
                    new JObject { ["id"] = "antibiotics", ["qty"] = 1 },
                    new JObject { ["id"] = "ammo556", ["qty"] = 120 },
                    new JObject { ["id"] = "ammo9", ["qty"] = 64 },
                    new JObject { ["id"] = "shotgunShell", ["qty"] = 18 },
                    new JObject { ["id"] = "scrap", ["qty"] = 23 },
                    new JObject { ["id"] = "electronics", ["qty"] = 6 },
                    new JObject { ["id"] = "oil", ["qty"] = 3 },
                    new JObject { ["id"] = "food", ["qty"] = 5 },
                    new JObject { ["id"] = "water", ["qty"] = 2 },
                    new JObject { ["id"] = "repairKit", ["qty"] = 1 },
                    new JObject { ["id"] = "silver", ["qty"] = 15320 }
                },
                ["equipmentRuntime"] = new JObject
                {
                    ["weapon"] = "rifle",
                    ["offhand"] = "knife",
                    ["armor"] = "combatArmor",
                    ["helmet"] = "tacticalHelmet",
                    ["boots"] = "scoutBoots",
                    ["backpack"] = "backpack",
                    ["detector"] = string.Empty,
                    ["artifactBelt"] = string.Empty
                },
                ["itemConditions"] = new JObject
                {
                    ["rifle"] = 72f,
                    ["pistol"] = 99f,
                    ["combatArmor"] = 86.6f,
                    ["tacticalHelmet"] = 94f,
                    ["scoutBoots"] = 61f,
                    ["backpack"] = 100f
                },
                ["artifactEffects"] = new JObject
                {
                    ["carryKg"] = 12f,
                    ["medkitEffectPct"] = 11.53f
                },
                ["artifactBeltCapacity"] = 2,
                ["injuries"] = new JObject
                {
                    ["brokenArm"] = false,
                    ["brokenLeg"] = false,
                    ["concussion"] = true,
                    ["infection"] = false
                },
                ["combatProtection"] = new JObject
                {
                    ["bullet"] = new JObject { ["threshold"] = 4, ["protection"] = 28, ["resistance"] = 28 },
                    ["explosion"] = new JObject { ["threshold"] = 3, ["protection"] = 22, ["resistance"] = 22 },
                    ["energy"] = new JObject { ["threshold"] = 1, ["protection"] = 10, ["resistance"] = 10 },
                    ["fire"] = new JObject { ["threshold"] = 2, ["protection"] = 14, ["resistance"] = 14 },
                    ["electric"] = new JObject { ["threshold"] = 0, ["protection"] = 0, ["resistance"] = 0 },
                    ["toxin"] = new JObject { ["threshold"] = 1, ["protection"] = 8, ["resistance"] = 8 },
                    ["radiation"] = new JObject { ["threshold"] = 2, ["protection"] = 18, ["resistance"] = 18 },
                    ["anomaly"] = new JObject { ["threshold"] = 0, ["protection"] = 0, ["resistance"] = 0 }
                }
            };
        }

        private static RoaPipboyCanvas CreateFixture(out GameObject host)
        {
            JObject self = Self();
            host = new GameObject("PipboyItemsCaptureProbe");

            var socket = host.AddComponent<RoaSocketClient>();
            socket.enabled = false;
            typeof(RoaSocketClient).GetProperty("Session")
                .SetValue(socket, new JoinAck { Self = self, LocationId = "Развилка" });

            var pipboy = host.AddComponent<RoaPipboy>();
            pipboy.enabled = false;
            pipboy.Socket = socket;
            typeof(RoaPipboy).GetMethod("ApplySelf", Private).Invoke(pipboy, new object[] { self });

            var inventory = host.AddComponent<RoaInventory>();
            inventory.enabled = false;
            inventory.Socket = socket;
            typeof(RoaInventory).GetMethod("ApplySelf", Private).Invoke(inventory, new object[] { self });

            var hud = host.AddComponent<RoaHud>();
            hud.enabled = false;
            hud.Socket = socket;
            SetPrivate(hud, "_hp", 82);
            SetPrivate(hud, "_maxHp", 134);
            SetPrivate(hud, "_ap", 7f);
            SetPrivate(hud, "_maxAp", 9);
            SetPrivate(hud, "_level", 12);
            SetPrivate(hud, "_armorThreshold", 4);
            SetPrivate(hud, "_loaded", 6);
            SetPrivate(hud, "_magSize", 6);
            SetPrivate(hud, "_reserveAmmo", 29);

            var quickbar = host.AddComponent<RoaQuickbar>();
            quickbar.enabled = false;

            var canvas = host.AddComponent<RoaPipboyCanvas>();
            canvas.enabled = false;
            canvas.Socket = socket;
            canvas.Pipboy = pipboy;
            canvas.Inventory = inventory;
            canvas.Hud = hud;
            canvas.Quickbar = quickbar;
            return canvas;
        }

        /// <summary>Тихо пропускает поле, которого нет: проба не должна падать из-за переименования.</summary>
        private static void SetPrivate(object target, string field, object value)
        {
            FieldInfo info = target.GetType().GetField(field, Private);
            if (info != null) info.SetValue(target, value);
        }

        private static void Capture(RoaPipboyCanvas.Page page, string path, bool mobile, int width, int height)
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                RoaPipboyCanvas terminal = CreateFixture(out host);
                terminal.Open(page);

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                if (canvas == null)
                {
                    Debug.LogError("[PIPBOY SCREEN] канвас не построился для страницы " + page);
                    return;
                }
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);

                // Снимаем ТОЛЬКО интерфейс: открытая сцена проекта живёт своей жизнью
                // (соседняя сессия авторит карту), и её геометрия ближе плоскости
                // канваса перекрывала бы экран. Отодвигать камеру от мира нельзя —
                // на больших координатах у float не хватает точности и глифы плывут.
                SetLayerRecursively(canvas.gameObject, CaptureLayer);

                cameraObject = new GameObject("PipboyCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                // Размытый мир за окном в игре — здесь ровный тёмный фон, чтобы
                // затемнение _root читалось как затемнение, а не как пустота.
                camera.backgroundColor = new Color(0.16f, 0.14f, 0.11f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;

                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32)
                {
                    name = "PipboyScreen_" + page,
                    antiAliasing = 4
                };
                target.Create();
                camera.targetTexture = target;

                // Порядок важен: масштабер меняет размер канваса, а вписывание рамки
                // и выбор компакт-режима считаются от него. В игре это делает Update
                // каждый кадр, здесь компонент выключен — зовём руками.
                Canvas.ForceUpdateCanvases();
                MethodInfo fit = typeof(RoaPipboyCanvas).GetMethod("FitFrameToViewport", Private);
                if (fit != null) fit.Invoke(terminal, null);

                // Ряд действий живёт только при выбранном предмете — без этого
                // снимок показывал бы пустое место там, где у игрока четыре кнопки.
                FieldInfo selected = typeof(RoaPipboyCanvas).GetField("_selectedItemId", Private);
                if (selected != null && page == RoaPipboyCanvas.Page.Items)
                    selected.SetValue(terminal, "medkit");
                typeof(RoaPipboyCanvas).GetMethod("Refresh", Private).Invoke(terminal, null);
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
                if (readback != null) Object.DestroyImmediate(readback);
                if (target != null)
                {
                    target.Release();
                    Object.DestroyImmediate(target);
                }
                if (cameraObject != null) Object.DestroyImmediate(cameraObject);
                if (host != null) Object.DestroyImmediate(host);
            }
        }
    }
}
#endif
