#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    // Offline Play Mode presentation audit. Gameplay transactions are checked by
    // check-kromka-live-journey-local.js against an isolated authoritative server.
    [InitializeOnLoad]
    public static class RoaPracticalTutorialProbe
    {
        private const string Key = "Roa.PracticalTutorialAudit";
        private static double next;
        private static bool started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/PracticalTutorialAudit"));
        static RoaPracticalTutorialProbe()
        {
            EditorApplication.playModeStateChanged += state => {
                if (!SessionState.GetBool(Key, false)) return;
                if (state == PlayModeStateChange.EnteredPlayMode) { started = false; next = EditorApplication.timeSinceStartup + 2; }
                if (state == PlayModeStateChange.EnteredEditMode) {
                    EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(SessionState.GetString(Key + ".scene", ""));
                    SessionState.SetBool(Key, false);
                    if (Application.isBatchMode && SessionState.GetBool(Key + ".batch", false))
                    {
                        SessionState.SetBool(Key + ".batch", false);
                        string result = Path.Combine(Output, SessionState.GetBool(Key + ".coverOnly", false) ? "cover-result.txt" : "result.txt");
                        SessionState.SetBool(Key + ".coverOnly", false);
                        var start = DateTime.Parse(SessionState.GetString(Key + ".start", ""), null,
                            System.Globalization.DateTimeStyles.RoundtripKind);
                        EditorApplication.Exit(File.Exists(result) && File.GetLastWriteTimeUtc(result) >= start
                            && File.ReadAllText(result).StartsWith("PASS:", StringComparison.Ordinal) ? 0 : 1);
                    }
                }
            };
            EditorApplication.update += () => {
                if (!SessionState.GetBool(Key, false) || !EditorApplication.isPlaying || started || EditorApplication.timeSinceStartup < next) return;
                started = true;
                Audit();
            };
        }

        [MenuItem("Realm of Ashes/Onboarding/Check practical tutorial desktop and mobile")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Exit Play Mode first");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save the open scene first");
            Directory.CreateDirectory(Output);
            SessionState.SetString(Key + ".scene", AssetDatabase.GetAssetPath(EditorSceneManager.playModeStartScene));
            SessionState.SetBool(Key, true);
            EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(RoaTutorialYardAuthoring.ScenePath);
            EditorApplication.isPlaying = true;
        }

        public static void RunBatch()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("Use Run in the interactive editor.");
            SessionState.SetBool(Key + ".batch", true);
            SessionState.SetString(Key + ".start", DateTime.UtcNow.ToString("O"));
            Run();
        }

        public static void RunCoverBatch()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("Use batch mode for the focused cover check.");
            SessionState.SetBool(Key + ".coverOnly", true);
            RunBatch();
        }

        private static async void Audit()
        {
            try
            {
                var authoring = UnityEngine.Object.FindAnyObjectByType<KromkaLocationAuthoring>();
                Require(authoring != null, "Tutorial scene did not load");
                var markers = authoring.StaticContentRoot.GetComponentsInChildren<KromkaPlacedObjectAuthoring>();
                Require(markers.Length == 9, "Unexpected decorative objects remain in the yard");
                foreach (var marker in markers) Require(marker.GetComponentsInChildren<Renderer>().Length > 0, "Invisible prop: " + marker.StableObjectId);
                var cover = markers.Single(marker => marker.StableObjectId == "yard_cover_a");
                RoaTutorialCoverAuthoring.Validate(cover);
                Require(authoring.PlayerArrival.localPosition.z == -26f, "Start anchor is not on clear ground");
                // Сцена стоит как в игре: сервер и Unity в одной системе координат (RoaCoords),
                // RoaLocationLoader сцену не отражает.
                var host = new GameObject("PracticalTutorialAudit");
                var enemies = host.AddComponent<RoaEnemies>(); enemies.enabled = false; enemies.BaseUrl = "http://127.0.0.1:1";
                var dummy = new JObject { ["id"] = "qa_target", ["trainingTarget"] = true, ["hostileToPlayer"] = false,
                    ["x"] = -10, ["z"] = 22, ["hp"] = 100, ["maxHp"] = 100, ["scale"] = 1 };
                enemies.ApplyPublicEnemy(dummy);
                var catalog = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/kromka/onboarding.json"))));
                foreach (JObject npc in catalog["npcs"].OfType<JObject>().Where(row => (string)row["locationId"] == "tutorialCaravanYard"))
                {
                    enemies.ApplyPublicEnemy(new JObject { ["id"] = npc["id"], ["kromkaOnboardingNpcId"] = npc["id"],
                        ["name"] = npc["displayName"], ["modelKey"] = "wastelandSettler", ["visual"] = "wastelandSettler", ["species"] = "human",
                        ["hostileToPlayer"] = false, ["canDialogue"] = true, ["x"] = npc["x"], ["z"] = npc["z"],
                        ["hp"] = (string)npc["id"] == "yard_casualty_shurik" ? 60 : 100, ["maxHp"] = 100, ["scale"] = 1,
                        ["equipment"] = new JObject { ["weapon"] = "fists", ["armor"] = "leather", ["boots"] = "boots" } });
                }
                var targets = new List<RoaEnemies.MobileTarget>();
                enemies.CollectMobileTargets(RoaCoords.ToUnity(-10, 16), 30f, targets);
                Require(targets.Count == 1 && targets[0].Id == "qa_target", "Mobile shooting cannot select the peaceful training target");
                enemies.CollectMobileTargets(RoaCoords.ToUnity(10, 10), 30f, targets, true);
                Require(targets.Count == 1 && targets[0].Id == "yard_casualty_shurik", "Medical targeting cannot select Shurik");
                Require(enemies.TryFindTarget(RoaCoords.ToUnity(-10, 22), .8f, out string hitId, out _) && hitId == "qa_target", "Mouse aiming cannot acquire target");
                // Мишень севернее (+Z): сервер и сцена Unity в одной системе координат.
                Require(enemies.TryFindTargetAlongRay(RoaCoords.ToUnity(-10,16), Vector3.forward, 20f,
                    out string rayId, out _, out _, out _) && rayId == "qa_target", "Actual firing ray cannot acquire target");

                var crate = RoaTutorialProps.Build("crate", host.transform); crate.transform.position = RoaCoords.ToUnity(-15, 1);
                var off = new GameObject("InactiveAuditBootstrap"); off.SetActive(false);
                var bootstrap = off.AddComponent<RoaGameBootstrap>();
                bootstrap.Enemies = enemies;
                var combat = host.AddComponent<RoaCombat>(); combat.enabled = false; bootstrap.Combat = combat;
                var socket = host.AddComponent<RoaSocketClient>(); socket.enabled = false; combat.Socket = socket;
                // Слот предмета клиент берёт из серверного каталога (RoaInventory.SlotFor),
                // поэтому проба загружает тот же каталог, что игра получает при входе.
                var items = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/kromka/items.json"))));
                Require(RoaItemData.ApplyCatalog(items, out string catalogError), "Item catalog rejected: " + catalogError);
                var session = new JoinAck { Self = new JObject { ["equipment"] = new JObject { ["weapon"] = "medkit" } } };
                typeof(RoaSocketClient).GetProperty("Session").SetValue(socket, session);
                Require(combat.HasHeldMedkit && RoaInventory.SlotFor("medkit") == "weapon", "Held medkit is not usable in the client");
                var coach = host.AddComponent<RoaKromkaOnboarding>(); coach.enabled = false; coach.Configure(bootstrap, null);
                var mobile = host.AddComponent<RoaMobileControls>(); mobile.enabled = false;
                mobile.Configure(combat, null, null, null, enemies, null);
                var touch = host.AddComponent<RoaMobileControlsCanvas>(); touch.enabled = false; touch.Controls = mobile;

                var camera = new GameObject("TutorialAuditCamera").AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.18f,.2f,.19f);
                camera.nearClipPlane = .1f; camera.farClipPlane = 180f; camera.fieldOfView = 52f;
                var light = new GameObject("TutorialAuditSun").AddComponent<Light>(); light.type = LightType.Directional; light.intensity = 1.2f;
                light.transform.rotation = Quaternion.Euler(55,-30,0);
                RenderSettings.ambientLight = new Color(.62f,.64f,.6f); RenderSettings.fog = false;
                await System.Threading.Tasks.Task.Delay(2000);
                var coverFocus = cover.transform.position + Vector3.up * .55f;
                camera.transform.position = coverFocus + new Vector3(4, 3, -5);
                camera.transform.LookAt(coverFocus);
                KromkaSceneShot.Capture(camera, Path.Combine(Output, "cover-desktop.png"), 1920, 1080);
                KromkaSceneShot.Capture(camera, Path.Combine(Output, "cover-mobile.png"), 844, 390);
                if (SessionState.GetBool(Key + ".coverOnly", false))
                {
                    File.WriteAllText(Path.Combine(Output, "cover-result.txt"),
                        "PASS: Play Mode; imported textured tutorial barrier; grounded 3.2 x 1.16 x 0.8 mesh; matching solid collider and server definition; stable objective ID; desktop 1920x1080 and mobile 844x390.");
                    Debug.Log("[TUTORIAL COVER PLAY] PASS: imported mesh, ground contact, server/client collision and two resolutions.");
                    return;
                }
                await System.Threading.Tasks.Task.Delay(2000);
                Require(enemies.GetComponentsInChildren<RoaCharacterView>().All(view => view.Ready), "An onboarding NPC model failed to load");
                var medicObject = new GameObject("AuditPlayerWithMedkit"); medicObject.transform.SetParent(host.transform, false);
                medicObject.transform.position = RoaCoords.ToUnity(10,8);
                var medic = medicObject.AddComponent<RoaCharacterView>();
                await medic.Load("http://127.0.0.1:1", new JObject { ["sex"] = "male", ["bodyType"] = "medium" });
                // Аптечка в руке — настоящая модель предмета с сервера ассетов, как у
                // остальных проб моделей (ROA_UNITY_PROBE_ORIGIN или локальный :3000).
                string assetOrigin = Environment.GetEnvironmentVariable("ROA_UNITY_PROBE_ORIGIN") ?? "http://127.0.0.1:3000";
                await medic.EquipWeapon(assetOrigin, "medkit");
                Require(medic.WeaponReady && medic.WeaponId == "medkit"
                    && medic.GetComponentsInChildren<Transform>().Any(t => t.name == "ItemModel:medkit" && t.parent.name == "hand_r"),
                    "Medkit is not visibly attached to the player's right hand (asset server " + assetOrigin + ")");
                var steps = catalog["tutorial"]["steps"].OfType<JObject>().ToArray();
                for (int view = 0; view < 2; view++)
                {
                    bool isMobile = view == 1; int width = isMobile ? 844 : 1920, height = isMobile ? 390 : 1080;
                    combat.MobileInputMode = isMobile;
                    foreach (JObject lesson in steps)
                    {
                        JObject step = (JObject)lesson.DeepClone();
                        var first = step["requirements"]?.First as JObject;
                        step["hint"] = first?["hint"] ?? step["hint"]; step["mobileHint"] = first?["mobileHint"] ?? step["mobileHint"];
                        step["target"] = first?["target"]; step["ready"] = first == null;
                        foreach (JObject requirement in step["requirements"] as JArray ?? new JArray()) { requirement["current"] = 0; requirement["complete"] = false; }
                        coach.ApplyState(new JObject { ["phase"] = "tutorial", ["title"] = catalog["tutorial"]["title"],
                            ["step"] = step, ["progress"] = new JObject { ["completed"] = Array.IndexOf(steps, lesson), ["total"] = steps.Length } });
                        touch.PresentNow(new RoaMobileControlsCanvas.Presentation { Visible = isMobile }, width, height, new Rect(0,0,width,height));
                        if (isMobile) Require(touch.ButtonLabel("Fire") == "ЛЕЧИТЬ", "Medical mobile button still says Fire");
                        foreach (Canvas canvas in host.GetComponentsInChildren<Canvas>(true))
                        {
                            canvas.gameObject.SetActive(canvas.name == "KromkaOnboardingCanvas" || isMobile);
                            canvas.renderMode = RenderMode.ScreenSpaceCamera; canvas.worldCamera = camera; canvas.planeDistance = 1;
                            var scaler = canvas.GetComponent<CanvasScaler>(); if (scaler != null) scaler.enabled = false;
                            Vector2 reference = canvas.name == "KromkaOnboardingCanvas" && isMobile ? new Vector2(960,540) : RoaUiScale.ReferenceFor(isMobile);
                            canvas.scaleFactor = Mathf.Sqrt(width / reference.x * height / reference.y);
                        }
                        Vector3 focus = isMobile ? RoaCoords.ToUnity(10,10) : RoaCoords.ToUnity(-10,18);
                        camera.transform.position = focus + new Vector3(11,17,-11); camera.transform.LookAt(focus);
                        if ((string)step["id"] == (isMobile ? "first_aid" : "range"))
                            KromkaSceneShot.Capture(camera, Path.Combine(Output, isMobile ? "mobile-landscape.png" : "desktop.png"), width, height);
                        Canvas.ForceUpdateCanvases();
                        foreach (Text label in coach.GetComponentsInChildren<Text>(true).Where(t => new[] { "ControlHint", "Instruction", "Requirements" }.Contains(t.name)))
                            Require(label.preferredHeight <= label.rectTransform.rect.height + 1, step["id"] + ": clipped " + label.name);
                    }
                }
                File.WriteAllText(Path.Combine(Output, "result.txt"), "PASS: Play Mode; 1920x1080 and 844x390; imported grounded tutorial barrier and matching solid collision, eight visible props, clear spawn, target mouse/touch acquisition, held medkit and Shurik selection, 12 lesson hints.");
                Debug.Log("[PRACTICAL TUTORIAL] PASS: desktop, mobile, target, healing selection and all hints");
            }
            catch (Exception error) { File.WriteAllText(Path.Combine(Output,
                SessionState.GetBool(Key + ".coverOnly", false) ? "cover-result.txt" : "result.txt"), "FAIL: " + error); Debug.LogException(error); }
            finally { EditorApplication.isPlaying = false; }
        }
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    }
}
#endif
