#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaProgressionProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string VisualKey = "roa.progression.visual-probe";
        private static int _stage;
        private static double _next;
        private static double _deadline;
        private static GameObject _host;
        private static string _capture;
        private static bool _captureRequested;

        static RoaProgressionProbe()
        {
            if (SessionState.GetBool(VisualKey, false)) BeginVisualUpdates();
        }

        private static JObject Self(int rank, int points = 3)
        {
            return new JObject {
                ["level"] = 20, ["skillPoints"] = points, ["perkPoints"] = 2,
                ["special"] = JObject.Parse("{'str':5,'per':6,'end':6,'cha':5,'int':6,'agi':7,'luck':5}"),
                ["skillRanks"] = new JObject { ["lightWeapons"] = rank },
                ["talentRanks"] = new JObject(), ["taggedSkills"] = new JArray("lightWeapons"),
                ["traits"] = new JArray("trainedEye")
            };
        }

        private static RoaPipboyCanvas CreateFixture(out GameObject host, int rank)
        {
            host = new GameObject("ProgressionProbe");
            var socket = host.AddComponent<RoaSocketClient>();
            socket.enabled = false;
            typeof(RoaSocketClient).GetProperty("Session").SetValue(socket, new JoinAck { Self = Self(rank) });
            var pipboy = host.AddComponent<RoaPipboy>();
            pipboy.enabled = false;
            pipboy.Socket = socket;
            typeof(RoaPipboy).GetMethod("ApplySelf", Private).Invoke(pipboy, new object[] { socket.Session.Self });
            var canvas = host.AddComponent<RoaPipboyCanvas>();
            canvas.enabled = false;
            canvas.Socket = socket;
            canvas.Pipboy = pipboy;
            return canvas;
        }

        private static Dictionary<string, int> Plan(RoaPipboyCanvas canvas)
        {
            return (Dictionary<string, int>)typeof(RoaPipboyCanvas).GetField("_skillPlan", Private).GetValue(canvas);
        }

        private static IEnumerator Apply(RoaPipboyCanvas canvas)
        {
            return (IEnumerator)typeof(RoaPipboyCanvas).GetMethod("ApplySkillPlan", Private).Invoke(canvas, null);
        }

        private static void Reply(RoaPipboyCanvas canvas, bool accepted, int rank)
        {
            canvas.Socket.Session.Self = Self(rank);
            typeof(RoaPipboy).GetMethod("HandleProgressionAck", Private).Invoke(canvas.Pipboy, new object[] {
                new JObject { ["ok"] = accepted, ["self"] = canvas.Socket.Session.Self,
                    ["error"] = accepted ? "" : "Не хватает очков навыков." }
            });
        }

        [MenuItem("Realm of Ashes/Проверить прокачку игроков")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                var canvas = CreateFixture(out host, 96);
                Plan(canvas)["lightWeapons"] = 1;
                IEnumerator request = Apply(canvas);
                Require(request.MoveNext() && canvas.Pipboy.ProgressionPending, "Final skill step was not submitted");
                Reply(canvas, true, 100);
                Require(!canvas.Pipboy.ProgressionPending, "100% ACK still waits for an impossible 101% rank");
                Require(!request.MoveNext() && Plan(canvas).Count == 0, "Confirmed final step remains in the plan");

                Reply(canvas, true, 86);
                Plan(canvas)["lightWeapons"] = 2;
                request = Apply(canvas);
                Require(request.MoveNext(), "Planned skill request did not start");
                Reply(canvas, false, 86);
                Require(!request.MoveNext(), "Rejected plan continued spending points");
                Require(Plan(canvas)["lightWeapons"] == 2, "Rejected steps disappeared from the plan");
                Require(!(bool)typeof(RoaPipboyCanvas).GetField("_planApplying", Private).GetValue(canvas), "Rejected plan cannot be retried");

                request = Apply(canvas);
                Require(request.MoveNext(), "Retry did not submit the first remaining step");
                Reply(canvas, true, 91);
                Require(request.MoveNext() && Plan(canvas)["lightWeapons"] == 1, "Only confirmed steps should leave the plan");
                Reply(canvas, true, 96);
                Require(!request.MoveNext() && Plan(canvas).Count == 0, "Two confirmed steps did not finish the plan");
                Debug.Log("[PLAYER PROGRESSION] PASS: final 100% ACK, rejected plan preservation, retry and sequential confirmations.");
            }
            finally { if (host != null) UnityEngine.Object.DestroyImmediate(host); }
        }

        public static void RunVisualBatch()
        {
            Run();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SessionState.SetBool(VisualKey, true);
            BeginVisualUpdates();
            EditorApplication.EnterPlaymode();
        }

        private static void BeginVisualUpdates()
        {
            _stage = 0;
            _deadline = EditorApplication.timeSinceStartup + 90;
            EditorApplication.update -= TickVisual;
            EditorApplication.update += TickVisual;
        }

        private static void TickVisual()
        {
            if (EditorApplication.timeSinceStartup > _deadline) { Finish(false, "Timed out waiting for progression UI"); return; }
            if (!EditorApplication.isPlaying || EditorApplication.timeSinceStartup < _next) return;
            try
            {
                if (_stage == 0 || _stage == 3)
                {
                    bool mobile = _stage == 3;
                    var type = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
                    var view = EditorWindow.GetWindow(type);
                    view.position = new Rect(0, 0, mobile ? 900 : 1440, mobile ? 440 : 900);
                    view.Show();
                    Screen.SetResolution(mobile ? 844 : 1280, mobile ? 390 : 720, false);
                    _stage++; _next = EditorApplication.timeSinceStartup + 2;
                    return;
                }
                if (_stage == 1 || _stage == 4)
                {
                    bool mobile = _stage == 4;
                    if (_host != null) UnityEngine.Object.DestroyImmediate(_host);
                    var canvas = CreateFixture(out _host, 96);
                    if (Camera.main == null) new GameObject("ProgressionCamera").AddComponent<Camera>().tag = "MainCamera";
                    canvas.Open(RoaPipboyCanvas.Page.Skills);
                    Canvas.ForceUpdateCanvases();
                    typeof(RoaPipboyCanvas).GetMethod("FitFrameToViewport", Private).Invoke(canvas, null);
                    Button plus = Array.Find(canvas.GetComponentsInChildren<Button>(true), button => button.name == "SkillPlus:lightWeapons");
                    Require(plus != null && plus.interactable, "Last skill point button is missing or disabled");
                    plus.onClick.Invoke();
                    Require(Plan(canvas)["lightWeapons"] == 1, "Skill button did not add a planned point");
                    typeof(RoaPipboyCanvas).GetMethod("Refresh", Private).Invoke(canvas, null);
                    var frame = (RectTransform)typeof(RoaPipboyCanvas).GetField("_frameRect", Private).GetValue(canvas);
                    var corners = new Vector3[4]; frame.GetWorldCorners(corners);
                    foreach (var corner in corners) Require(corner.x >= -1 && corner.y >= -1 && corner.x <= Screen.width + 1 && corner.y <= Screen.height + 1, "Progression window exceeds the viewport");
                    Require(Screen.width > Screen.height, "Landscape viewport required");
                    _capture = Path.Combine(Path.GetTempPath(), mobile ? "roa-progression-mobile.png" : "roa-progression-desktop.png");
                    _captureRequested = false;
                    Debug.Log($"[PROGRESSION VISUAL] {(mobile ? "mobile" : "desktop")}: {Screen.width}x{Screen.height}, skill plan button passed.");
                    _stage++; _next = EditorApplication.timeSinceStartup + 2;
                    return;
                }
                if (!_captureRequested)
                {
                    if (File.Exists(_capture)) File.Delete(_capture);
                    ScreenCapture.CaptureScreenshot(_capture);
                    _captureRequested = true;
                    _next = EditorApplication.timeSinceStartup + 2;
                    return;
                }
                Require(File.Exists(_capture), "Progression screenshot was not written");
                var screenshot = new Texture2D(2, 2);
                try
                {
                    Require(screenshot.LoadImage(File.ReadAllBytes(_capture)), "Progression screenshot could not be read");
                    var colors = new HashSet<Color32>(screenshot.GetPixels32());
                    Require(colors.Count > 32, "Progression screenshot is blank");
                }
                finally { UnityEngine.Object.DestroyImmediate(screenshot); }
                if (_stage == 2) { _stage = 3; return; }
                Finish(true, "Desktop and mobile landscape progression UI passed");
            }
            catch (Exception error) { Finish(false, error.ToString()); }
        }

        private static void Finish(bool ok, string message)
        {
            SessionState.SetBool(VisualKey, false);
            EditorApplication.update -= TickVisual;
            if (ok) Debug.Log("[PROGRESSION VISUAL] PASS: " + message);
            else Debug.LogError("[PROGRESSION VISUAL] FAIL: " + message);
            EditorApplication.Exit(ok ? 0 : 1);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
