using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Обзор хватов для критика: каждый класс предметов в руках снимается листом.
    /// Строки — состояния (готовность, шаг, удар или выстрел), столбцы — ракурсы:
    /// сбоку справа, спереди, игровая камера сверху в три четверти и крупные планы
    /// правой и левой кисти. Рядом report.json: где кисти видимого тела относительно
    /// точек хвата на модели. Сервер моделей — ROA_ANIM_SERVER, папка — ROA_GRIP_OUT,
    /// выбор предметов — ROA_GRIP_ONLY (id случаев через запятую).
    /// </summary>
    public static class RoaGripReviewProbe
    {
        private const int W = 300, H = 360, Views = 7, Rows = 4;
        private const float SwingSeconds = 0.6f;
        private static bool _batchOptionsCaptured;
        private static bool _previousEnterPlayModeOptionsEnabled;
        private static EnterPlayModeOptions _previousEnterPlayModeOptions;

        private static string Server =>
            Environment.GetEnvironmentVariable("ROA_ANIM_SERVER") ?? "http://127.0.0.1:3000";

        private static string OutDir =>
            Environment.GetEnvironmentVariable("ROA_GRIP_OUT")
            ?? Path.GetFullPath(Path.Combine(Application.dataPath, "../Temp/GripReview"));

        private sealed class Case
        {
            public string Name;
            public string Item;
            public string Offhand = string.Empty;
            public Case(string name, string item, string offhand = "") { Name = name; Item = item; Offhand = offhand; }
        }

        // Представитель каждого класса: у классов с разными формами — по нескольку.
        private static readonly Case[] Cases =
        {
            new Case("assault_rifle", "assaultRifle"),
            new Case("hunting_rifle", "rifle"),
            new Case("sniper_rifle", "polygonSniperRifle01"),
            new Case("crossbow", "polygonCrossBow01"),
            new Case("smg", "smg"),
            new Case("nailgun", "polygonNailgun01"),
            new Case("shotgun", "shotgun"),
            new Case("sawed_off", "sawedOffShotgun"),
            new Case("plasma_rifle", "plasmaRifle"),
            new Case("machine_gun", "machineGun"),
            new Case("minigun", "polygonMinigun01"),
            new Case("rocket_launcher", "rocketLauncher"),
            new Case("flamethrower", "flamethrower"),
            new Case("pistol", "pistol"),
            new Case("revolver", "revolver"),
            new Case("laser_pistol", "laserPistol"),
            new Case("flare_gun", "polygonFlareGun01"),
            new Case("dual_pistols", "pistol", "pistol"),
            new Case("grenade", "polygonGrenade01"),
            new Case("molotov", "polygonMolotov01"),
            new Case("fire_axe", "axe"),
            new Case("wood_axe", "polygonWoodAxe01"),
            new Case("bat", "polygonBatWood01"),
            new Case("pipe", "polygonPipe01"),
            new Case("katana", "polygonKatana01"),
            new Case("spear", "polygonMeleeSpearWood01"),
            new Case("sledge_hammer", "polygonHammer01"),
            new Case("crowbar", "polygonCrowbar01"),
            new Case("machete", "polygonMeleeMachete01"),
            new Case("baton", "polygonBaton01"),
            new Case("wrench", "polygonWrench01"),
            new Case("chainsaw", "polygonChainSaw01"),
            new Case("trimmer", "polygonTrimmer01"),
            new Case("sign_shield", "polygonSignShield01"),
            new Case("knife", "knife"),
            new Case("spade", "pickaxe"),
            new Case("pipe_wrench", "handPump"),
            new Case("medkit", "medkit")
        };

        private sealed class Rig
        {
            public RoaCharacterPreview Preview;
            public RoaCharacterView View;
            public Camera Camera;
            public Transform Root;
            public Texture2D Readback;
            public Transform HandR, HandL;
        }

        [MenuItem("Realm of Ashes/Animation/Review weapon grips")]
        public static void RunBatch()
        {
            if (EditorApplication.isPlaying) { RunBatchAsync(); return; }
            try
            {
                _previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
                _previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
                _batchOptionsCaptured = true;
                EditorSettings.enterPlayModeOptionsEnabled = true;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorApplication.playModeStateChanged += OnPlayModeChanged;
                EditorApplication.EnterPlaymode();
            }
            catch (Exception error)
            {
                Debug.LogError("[GRIP REVIEW] FAIL: " + error);
                Finish(1);
            }
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            RunBatchAsync();
        }

        private static async void RunBatchAsync()
        {
            try
            {
                await RunAsync();
                Debug.Log("[GRIP REVIEW] PASS " + OutDir);
                Finish(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[GRIP REVIEW] FAIL: " + error);
                Finish(1);
            }
        }

        private static void Finish(int code)
        {
            Time.timeScale = 1f;
            Time.captureDeltaTime = 0f;
            if (_batchOptionsCaptured)
            {
                EditorSettings.enterPlayModeOptions = _previousEnterPlayModeOptions;
                EditorSettings.enterPlayModeOptionsEnabled = _previousEnterPlayModeOptionsEnabled;
                _batchOptionsCaptured = false;
            }
            if (Application.isBatchMode) EditorApplication.Exit(code);
        }

        private static List<Case> Selected()
        {
            string only = Environment.GetEnvironmentVariable("ROA_GRIP_ONLY");
            var rows = new List<Case>(Cases);
            if (string.IsNullOrWhiteSpace(only)) return rows;
            var wanted = new HashSet<string>(only.Split(','), StringComparer.Ordinal);
            return rows.FindAll(row => wanted.Contains(row.Name));
        }

        public static async Task RunAsync()
        {
            if (!Application.isPlaying) throw new InvalidOperationException("Grip review needs Play Mode.");
            Directory.CreateDirectory(OutDir);
            Rig rig = await MakeRig();
            Time.captureDeltaTime = 1f / 30f;
            await Frames(rig, Vector3.zero, 20);
            var report = new StringBuilder("{\n");
            List<Case> cases = Selected();
            for (int c = 0; c < cases.Count; c++)
            {
                Case item = cases[c];
                await rig.View.EquipItems(Server, new JObject { ["offhand"] = item.Offhand });
                await rig.View.EquipWeapon(Server, item.Item);
                await Frames(rig, Vector3.zero, 45);
                FindHands(rig);
                var sheet = new Texture2D(Views * W, Rows * H, TextureFormat.RGBA32, false);
                var metrics = new StringBuilder();
                // Готовность: стоит, оружие наведено вперёд, без стрельбы.
                await Frames(rig, Vector3.zero, 90);
                Shoot(sheet, 0, rig, metrics, "ready");
                // Шаг: середина цикла ходьбы.
                await Frames(rig, new Vector3(0f, 0f, 1.6f), 40);
                Shoot(sheet, 1, rig, metrics, "walk");
                await Frames(rig, Vector3.zero, 45);
                bool firearm = RoaWeaponView.IsFirearm(RoaApocalypseModels.WeaponRig(item.Item))
                    && rig.View.HeldWeapon != null && rig.View.HeldWeapon.HoldKind != "Throwable";
                if (firearm)
                {
                    // Вскинуто: через 0.7 с после выстрела отдача прошла, оружие у плеча.
                    rig.View.PlayAttack(SwingSeconds);
                    await Frames(rig, Vector3.zero, 21);
                    Shoot(sheet, 2, rig, metrics, "aim");
                    // Выстрел: пик отдачи.
                    rig.View.PlayAttack(SwingSeconds);
                    await Frames(rig, Vector3.zero, 2);
                    Shoot(sheet, 3, rig, metrics, "fire");
                }
                else
                {
                    // Замах (фаза ~0.3) и контакт удара или бросок (фаза ~0.6).
                    rig.View.PlayAttack(SwingSeconds);
                    await Frames(rig, Vector3.zero, 6);
                    Shoot(sheet, 2, rig, metrics, "windup");
                    await Frames(rig, Vector3.zero, 5);
                    Shoot(sheet, 3, rig, metrics, "contact");
                }
                await Frames(rig, Vector3.zero, 45);
                sheet.Apply();
                File.WriteAllBytes(Path.Combine(OutDir, (c + 1).ToString("00") + "_" + item.Name + ".png"), sheet.EncodeToPNG());
                UnityEngine.Object.Destroy(sheet);
                if (metrics.Length >= 2) metrics.Length -= 2;
                report.Append("  \"").Append(item.Name).Append("\": {\"item\": \"").Append(item.Item)
                    .Append("\", \"states\": [\n").Append(metrics).Append("\n  ]},\n");
            }
            report.Append("  \"columns\": \"right side, front, game camera, right hand outside, right hand inside, left hand outside, left hand inside\"\n}\n");
            File.WriteAllText(Path.Combine(OutDir, "report.json"), report.ToString());
        }

        private static async Task<Rig> MakeRig()
        {
            var host = new GameObject("GripReview");
            var rig = new Rig { Preview = host.AddComponent<RoaCharacterPreview>() };
            rig.Preview.Show(Server, new CharacterAppearance { Sex = "male", HairId = "short_crop", HairColorId = "hair_08" },
                W, H, false);
            DateTime deadline = DateTime.UtcNow.AddSeconds(90);
            while (!rig.Preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
            if (!rig.Preview.IsReady) throw new TimeoutException("body did not load from " + Server);
            rig.Preview.enabled = false;
            rig.View = host.GetComponentInChildren<RoaCharacterView>(true);
            rig.Camera = host.GetComponentInChildren<Camera>(true);
            rig.Root = rig.Camera.transform.parent;
            rig.Camera.backgroundColor = new Color(0.34f, 0.37f, 0.36f, 1f);
            rig.Camera.nearClipPlane = 0.02f;
            rig.View.transform.localRotation = Quaternion.identity;
            for (int x = -3; x <= 3; x++)
                for (int z = -3; z <= 3; z++)
                {
                    GameObject tile = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    UnityEngine.Object.Destroy(tile.GetComponent<Collider>());
                    tile.transform.SetParent(rig.Root, false);
                    tile.transform.localPosition = new Vector3(x, -0.005f, z);
                    tile.transform.localScale = new Vector3(1f, 0.01f, 1f);
                    tile.layer = RoaCharacterPreview.PreviewLayer;
                    tile.GetComponent<Renderer>().material.color = (x + z) % 2 == 0
                        ? new Color(0.22f, 0.24f, 0.22f) : new Color(0.29f, 0.31f, 0.29f);
                }
            rig.Readback = new Texture2D(W, H, TextureFormat.RGBA32, false);
            return rig;
        }

        private static void FindHands(Rig rig)
        {
            RoaApocalypseCharacterSkin skin = rig.View.GetComponent<RoaApocalypseCharacterSkin>();
            rig.HandR = skin != null ? skin.VisibleHand(false) : null;
            rig.HandL = skin != null ? skin.VisibleHand(true) : null;
        }

        // Игровое время — ровно 1/30 с на кадр (captureDeltaTime), поэтому шаги
        // считаются кадрами, а не секундами реального времени.
        private static async Task Frames(Rig rig, Vector3 velocity, int frames)
        {
            for (int i = 0; i < frames; i++)
            {
                rig.View.transform.localRotation = Quaternion.identity;
                rig.View.UpdateLocomotion(velocity, 0f, velocity.sqrMagnitude > 0.01f, false);
                rig.View.SetAim(rig.View.transform.position + Vector3.forward * 6f + Vector3.up * 1.2f, true);
                int start = Time.frameCount;
                while (Time.frameCount == start) await Task.Yield();
            }
        }

        // Середина ладони: между запястьем и основанием указательного.
        private static Vector3 Palm(Transform hand, Vector3 fallback)
        {
            if (hand == null) return fallback;
            foreach (Transform node in hand.GetComponentsInChildren<Transform>(true))
                if (node.name.StartsWith("IndexFinger_01")) return Vector3.Lerp(hand.position, node.position, 0.6f);
            return hand.position;
        }

        private static void Shoot(Texture2D sheet, int row, Rig rig, StringBuilder metrics, string label)
        {
            Transform view = rig.View.transform;
            Vector3 anchor = view.position;
            Vector3 chest = anchor + Vector3.up * 1.15f;
            Grab(sheet, 0, row, rig, anchor + new Vector3(2.4f, 1.25f, 0.35f), anchor + new Vector3(0f, 1.0f, 0.35f), 40f);
            Grab(sheet, 1, row, rig, anchor + new Vector3(0.35f, 1.35f, 2.6f), anchor + new Vector3(0f, 1.0f, 0.2f), 40f);
            Grab(sheet, 2, row, rig, anchor + new Vector3(3.1f, 3.4f, -2.6f), anchor + new Vector3(0f, 0.9f, 0.2f), 34f);
            Vector3 right = Palm(rig.HandR, chest);
            Vector3 left = Palm(rig.HandL, chest);
            // Кисти крупно: со стороны тыльной стороны ладони и со стороны пальцев
            // (по месту кисти на предмете, иначе — по осям персонажа).
            RoaWeaponView held = rig.View.HeldWeapon;
            RoaHandTarget rt = held != null ? held.HoldRight : default;
            RoaHandTarget lt = held != null ? held.HoldLeft : default;
            Vector3 up = Vector3.up * 0.05f;
            Vector3 rBack = rt.Active ? rt.Back : Vector3.right;
            Vector3 lBack = lt.Active ? lt.Back : Vector3.left;
            Vector3 rSide = rt.Active ? -Vector3.Cross(rt.Axis, rt.Back).normalized : Vector3.forward;
            Vector3 lSide = lt.Active ? Vector3.Cross(lt.Axis, lt.Back).normalized : Vector3.forward;
            Grab(sheet, 3, row, rig, right + rBack * 0.32f + up, right, 40f, 0.2f);
            Grab(sheet, 4, row, rig, right + (rSide - rBack * 0.4f).normalized * 0.32f + up, right, 40f, 0.2f);
            Grab(sheet, 5, row, rig, left + lBack * 0.32f + up, left, 40f, 0.2f);
            Grab(sheet, 6, row, rig, left + (lSide - lBack * 0.4f).normalized * 0.32f + up, left, 40f, 0.2f);
            metrics.Append("    {\"state\": \"").Append(label).Append("\", \"hand_r\": ").Append(V(rig, right))
                .Append(", \"hand_l\": ").Append(V(rig, left)).Append(", \"hold\": ").Append(HoldState(rig))
                .Append(", \"elbow_r\": ").Append(ElbowDrop(rig.HandR)).Append(", \"elbow_l\": ").Append(ElbowDrop(rig.HandL)).Append("},\n");
        }

        // Локоть: насколько ниже плеча (м) и угол плеча от вертикали (0° — рука вниз, 90° — горизонтально).
        private static string ElbowDrop(Transform hand)
        {
            Transform elbow = hand != null ? hand.parent : null;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null) return "null";
            float angle = Vector3.Angle(elbow.position - shoulder.position, Vector3.down);
            float extension = Vector3.Distance(shoulder.position, hand.position)
                / (Vector3.Distance(shoulder.position, elbow.position) + Vector3.Distance(elbow.position, hand.position));
            return "{\"drop\": " + F(shoulder.position.y - elbow.position.y) + ", \"abduct\": " + F(angle) + ", \"extension\": " + F(extension) + "}";
        }

        private static string HoldState(Rig rig)
        {
            RoaApocalypseCharacterSkin skin = rig.View.GetComponent<RoaApocalypseCharacterSkin>();
            if (skin == null) return "null";
            return "{\"primaryMiss\": " + F(skin.HoldMissPrimary) + ", \"supportMiss\": " + F(skin.HoldMissSupport)
                + ", \"archetype\": \"" + skin.HoldArchetype + "\""
                + ", \"phase\": " + F(rig.View.HeldWeapon != null ? rig.View.HeldWeapon.DebugAttackPhase : -1f)
                + ", \"raise\": " + F(rig.View.HeldWeapon != null ? rig.View.HeldWeapon.Raise : 0f) + "}";
        }

        private static string V(Rig rig, Vector3 world)
        {
            Vector3 local = rig.View.transform.InverseTransformPoint(world);
            return "[" + F(local.x) + ", " + F(local.y) + ", " + F(local.z) + "]";
        }

        private static string F(float value) =>
            value.ToString("F3", System.Globalization.CultureInfo.InvariantCulture);

        private static void Grab(Texture2D sheet, int column, int row, Rig rig, Vector3 eye, Vector3 target, float fov, float near = 0.02f)
        {
            Transform camera = rig.Camera.transform;
            camera.position = eye;
            camera.LookAt(target);
            rig.Camera.fieldOfView = fov;
            // Крупный план: всё ближе 12 см перед кистью (плащ, корпус) отсекается.
            rig.Camera.nearClipPlane = near;
            if (!rig.Preview.RenderNow()) throw new InvalidOperationException("render failed");
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = rig.Preview.Texture;
            rig.Readback.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            rig.Readback.Apply();
            RenderTexture.active = previous;
            sheet.SetPixels32(column * W, (Rows - 1 - row) * H, W, H, rig.Readback.GetPixels32());
        }
    }
}
