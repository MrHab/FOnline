#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>Local, offline Play Mode visual audit using the production camera rig.
    /// No server, account, save or production endpoint is contacted.</summary>
    [InitializeOnLoad]
    internal static class KromkaOuterWastelandPlayAudit
    {
        private const string SessionKey = "Kromka.OuterWasteland.PlayAudit";
        private static Camera view;
        private static RoaCameraRig rig;
        private static int shot;
        private static double next;
        private static readonly string[] RimNames = {
            "west-low-pitch", "south-low-pitch", "east-low-pitch", "north-low-pitch",
            "west-close", "south-close", "east-close", "north-close"
        };
        private static readonly string[] RiverNames = {
            "tesma-headwaters", "tesma-single-channel", "tesma-lower-channel"
        };
        private static readonly string[] FullSceneNames = {
            "northern-sluices", "ore-arc", "middle-vein", "tract-isthmus",
            "glasslands", "chalk-lowland", "zero-basin", "silent-ring",
            "main-road-bridge", "r12-road-bridge", "river-mouth", "rail-bridge",
            "crown-reservoir", "gloom-tower", "fuel-tanks", "r12-structure",
            "outer-west", "outer-south", "outer-east", "outer-north"
        };
        private static readonly Vector2[] RegionTargets = {
            new Vector2(201f, 270f), new Vector2(98f, 223f), new Vector2(194f, 204f),
            new Vector2(141f, 153f), new Vector2(300f, 190f), new Vector2(309f, 105f),
            new Vector2(210f, 57f), new Vector2(85f, 77f)
        };
        private static bool IsFullSceneAudit => SessionState.GetBool(SessionKey + ".full", false);
        private static bool IsRiverAudit => SessionState.GetBool(SessionKey + ".river", false);
        private static string[] Names => IsFullSceneAudit ? FullSceneNames : IsRiverAudit ? RiverNames : RimNames;
        private static string Output => IsFullSceneAudit
            ? Path.GetFullPath(Path.Combine(Application.dataPath, "../../Build/KromkaSceneCaptures/full-scene-play-review"))
            : IsRiverAudit
            ? Path.GetFullPath(Path.Combine(Application.dataPath, "../../Build/KromkaSceneCaptures"))
            : KromkaGlobalMapOuterWastelandPerimeterAuthoring.Output;

        static KromkaOuterWastelandPlayAudit()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += OnPlayState;
            EditorApplication.update += Tick;
            EditorApplication.delayCall += ResumeAfterReload;
        }

        private static void ResumeAfterReload()
        {
            if (!EditorApplication.isPlaying || !SessionState.GetBool(SessionKey, false)) return;
            // Other editor work may reload assemblies during this asynchronous
            // audit. Resume only our surviving camera, never another Play run.
            GameObject existing = GameObject.Find("OuterWastelandRuntimeAuditCamera");
            if (existing == null) return;
            view = existing.GetComponent<Camera>();
            rig = existing.GetComponent<RoaCameraRig>();
            if (view == null || rig == null || rig.Target == null) return;
            shot = SessionState.GetInt(SessionKey + ".shot", 0);
            if (shot >= Names.Length * 2) { EditorApplication.isPlaying = false; return; }
            PrepareShot();
        }

        [MenuItem("Realm of Ashes/Checks/Outer wasteland/Play Mode desktop and mobile")]
        public static void Run()
        {
            Begin(false);
        }

        [MenuItem("Realm of Ashes/Checks/Tesma/Play Mode desktop and mobile")]
        public static void RunRiver()
        {
            Begin(true);
        }

        [MenuItem("Realm of Ashes/Checks/Visual review/Full scene Play Mode desktop and mobile")]
        public static void RunFullScene() => Begin(false, true);

        private static void Begin(bool river, bool full = false)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Exit existing Play Mode first.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new InvalidOperationException("Save your scene first.");
            if (SceneManager.GetActiveScene().path != KromkaGlobalMapOuterWastelandPerimeterAuthoring.ScenePath)
                throw new InvalidOperationException("Open the authored Kromka global map first.");
            if (river || full)
            {
                KromkaGlobalMapWaterAuthoring.ValidateIteration07();
                KromkaGlobalMapShorelineAuthoring.ValidateIteration10();
            }
            else KromkaGlobalMapOuterWastelandPerimeterAuthoring.ValidateCompleted();
            SessionState.SetBool(SessionKey + ".river", river);
            SessionState.SetBool(SessionKey + ".full", full);
            SessionState.SetBool(SessionKey, true);
            SessionState.SetInt(SessionKey + ".shot", 0);
            EditorApplication.isPlaying = true;
        }

        private static void OnPlayState(PlayModeStateChange state)
        {
            if (!SessionState.GetBool(SessionKey, false)) return;
            if (state == PlayModeStateChange.EnteredEditMode)
            {
                SessionState.SetBool(SessionKey, false);
                view = null; rig = null;
            }
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            try
            {
                var profile = RoaGlobalMap.StrategicProfile(38f);
                RenderSettings.ambientMode = AmbientMode.Trilight;
                RenderSettings.ambientSkyColor = profile.AmbientSky;
                RenderSettings.ambientEquatorColor = profile.AmbientEquator;
                RenderSettings.ambientGroundColor = profile.AmbientGround;
                RenderSettings.ambientIntensity = profile.AmbientIntensity;
                RenderSettings.reflectionIntensity = profile.ReflectionIntensity;
                RenderSettings.fog = true;
                RenderSettings.fogMode = FogMode.Linear;
                RenderSettings.fogColor = profile.FogColor;
                RenderSettings.fogStartDistance = profile.FogStart;
                RenderSettings.fogEndDistance = profile.FogEnd;
                view = new GameObject("OuterWastelandRuntimeAuditCamera").AddComponent<Camera>();
                view.clearFlags = CameraClearFlags.SolidColor;
                view.backgroundColor = profile.CameraBackground;
                view.nearClipPlane = .05f; view.farClipPlane = 500f;
                rig = view.gameObject.AddComponent<RoaCameraRig>();
                rig.ZoomPersistenceEnabled = false;
                rig.MinDistance = RoaGlobalMap.StrategicMinimumCameraDistance(38f);
                rig.MaxDistance = RoaGlobalMap.StrategicMaximumCameraDistance(38f);
                rig.SmoothTime = 0f;
                rig.Target = new GameObject("OuterWastelandRuntimeAuditTarget").transform;
                rig.SetFieldOfView(RoaCameraRig.StrategicFieldOfView);
                shot = 0;
                PrepareShot();
            }
            catch (Exception error) { Fail(error); }
        }

        private static void PrepareShot()
        {
            int pose = shot / 2;
            if (IsFullSceneAudit)
            {
                Vector2 map = pose < RegionTargets.Length ? RegionTargets[pose] : new Vector2(243f, 78f);
                float distance = pose < RegionTargets.Length ? 13f : 7f;
                if (pose >= 11 && pose <= 15)
                {
                    Vector2[] details = { new Vector2(199f, 217f), new Vector2(205f, 272f),
                        new Vector2(78f, 65f), new Vector2(147f, 43f), new Vector2(205f, 65f) };
                    map = details[pose - 11]; distance = pose == 12 ? 8f : 6f;
                }
                if (pose >= 16)
                {
                    float rimAngle = Mathf.PI + (pose - 16) * Mathf.PI * .5f;
                    rig.Target.position = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(rimAngle, .015f);
                    rig.YawDeg = 90f - rimAngle * Mathf.Rad2Deg;
                    rig.PitchDeg = RoaGlobalMap.StrategicMinimumPitchDeg;
                    rig.SetDistance(rig.MaxDistance, false);
                    rig.SnapToTarget(); next = EditorApplication.timeSinceStartup + 1.5d; return;
                }
                if (pose == 8 || pose == 9)
                {
                    string bridge = pose == 8 ? "TesmaMainTract_RoadBridge" : "R12SouthService_RoadBridge";
                    Bounds bounds = GameObject.Find(bridge).GetComponentsInChildren<Renderer>()
                        .Single(renderer => renderer.name == "road").bounds;
                    map = new Vector2(190f + bounds.center.x * 10f, 150f - bounds.center.z * 10f);
                }
                rig.Target.position = new Vector3((map.x - 190f) * .1f,
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(map.x, map.y), (150f - map.y) * .1f);
                rig.YawDeg = pose == 14 ? 0f : 180f;
                rig.PitchDeg = pose < RegionTargets.Length ? 40f : 50f;
                rig.SetDistance(distance, false);
                rig.SnapToTarget();
                next = EditorApplication.timeSinceStartup + 1.5d;
                return;
            }
            if (IsRiverAudit)
            {
                float mapY = pose == 0 ? 277f : pose == 1 ? 222f : 118f;
                rig.Target.position = new Vector3(1.4f,
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(204f, mapY),
                    (150f - mapY) * .1f);
                rig.YawDeg = 180f;
                rig.PitchDeg = 40f;
                rig.SetDistance(pose == 0 ? 12f : 18f, false);
                rig.SnapToTarget();
                next = EditorApplication.timeSinceStartup + 1.5d;
                return;
            }
            // Cardinal playable-rim targets: low pitch + maximum legal zoom are
            // the critical frustum cases for seeing beyond the old finite plane.
            float angle = Mathf.PI + (pose % 4) * Mathf.PI * .5f;
            Vector3 target = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(angle, .015f);
            rig.Target.position = target;
            rig.YawDeg = 90f - angle * Mathf.Rad2Deg;
            rig.PitchDeg = pose < 4 ? RoaGlobalMap.StrategicMinimumPitchDeg : 55f;
            rig.SetDistance(pose < 4 ? rig.MaxDistance : 9f, false);
            rig.SnapToTarget();
            next = EditorApplication.timeSinceStartup + 1.5d;
        }

        private static void Tick()
        {
            if (!SessionState.GetBool(SessionKey, false) || !EditorApplication.isPlaying
                || view == null || EditorApplication.timeSinceStartup < next) return;
            try
            {
                int w = shot % 2 == 0 ? 1600 : 960, h = shot % 2 == 0 ? 900 : 540;
                string output = Output;
                Directory.CreateDirectory(output);
                Capture(view, Path.Combine(output, "play-" + Names[shot / 2]
                    + (shot % 2 == 0 ? "-desktop" : "-mobile") + ".png"), w, h);
                shot++;
                SessionState.SetInt(SessionKey + ".shot", shot);
                if (shot < Names.Length * 2) { PrepareShot(); return; }
                File.WriteAllText(Path.Combine(output, IsRiverAudit
                        ? "tesma-play-mode-audit.txt" : "play-mode-audit.txt"),
                    "PASS: " + Names.Length * 2
                    + " frames from running Unity Play Mode using RoaCameraRig.\n"
                    + (IsFullSceneAudit ? "Eight regions, two road bridges, freight bridge, reservoirs, tower/tanks/R12 and four outer boundaries.\n"
                        : IsRiverAudit ? "Single Tesma channel: headwaters, middle and lower reaches.\n"
                        : "Four cardinal rim targets, legal minimum pitch/max distance and close views.\n")
                    + "Desktop 1600x900; mobile landscape 960x540. Offline visual-only audit.\n");
                EditorApplication.isPlaying = false;
            }
            catch (Exception error) { Fail(error); }
        }

        private static void Fail(Exception error)
        {
            Debug.LogException(error);
            Directory.CreateDirectory(Output);
            File.WriteAllText(Path.Combine(Output, IsRiverAudit
                ? "tesma-play-mode-error.txt" : "play-mode-error.txt"), error.ToString());
            EditorApplication.isPlaying = false;
        }

        internal static void Capture(Camera camera, string path, int width, int height)
        {
            RenderTexture original = camera.targetTexture;
            RenderTexture active = RenderTexture.active;
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            Texture2D pixels = null;
            try
            {
                target.Create(); camera.targetTexture = target;
                camera.Render(); camera.Render();
                RenderTexture.active = target;
                pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                pixels.Apply();
                File.WriteAllBytes(path, pixels.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = original; RenderTexture.active = active;
                if (pixels != null) UnityEngine.Object.DestroyImmediate(pixels);
                target.Release(); UnityEngine.Object.DestroyImmediate(target);
            }
        }
    }
}
#endif
