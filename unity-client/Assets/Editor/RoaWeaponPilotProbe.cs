using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using RenderPipeline = UnityEngine.Rendering.RenderPipeline;
using Stopwatch = System.Diagnostics.Stopwatch;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Equips every runtime weapon, including the non-pilot rifle and shotgun, on
    /// the real player character, validates the runtime grips/muzzle, and emits
    /// one upper-body review frame per model.
    /// </summary>
    public static class RoaWeaponPilotProbe
    {
        private const string BaseUrl = "http://127.0.0.1:3000";
        private static readonly string[] PilotIds =
        {
            "pistol",
            "rifle",
            "assaultRifle",
            "machineGun",
            "flamethrower",
            "laserPistol",
            "plasmaRifle",
            "rocketLauncher",
            "shotgun",
            "revolver",
            "sawedOffShotgun",
            "smg",
            "knife",
            "axe",
            "pickaxe",
            "handPump"
        };

        private static readonly HashSet<string> MeleeIds = new HashSet<string>
        {
            "knife", "axe", "pickaxe", "handPump"
        };

        private static bool _batchOptionsCaptured;
        private static bool _previousEnterPlayModeOptionsEnabled;
        private static EnterPlayModeOptions _previousEnterPlayModeOptions;

        [MenuItem("Realm of Ashes/Проверить все модели оружия")]
        public static async void Run()
        {
            try { await RunAsync(); }
            catch (Exception error) { Debug.LogError("[ROA WEAPON PILOT] " + error); }
        }

        public static void RunBatch()
        {
            if (EditorApplication.isPlaying)
            {
                RunBatchAsync();
                return;
            }

            try
            {
                _previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
                _previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
                _batchOptionsCaptured = true;
                EditorSettings.enterPlayModeOptionsEnabled = true;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorApplication.playModeStateChanged += OnBatchPlayModeStateChanged;
                EditorApplication.EnterPlaymode();
            }
            catch (Exception error)
            {
                Debug.LogError("[ROA WEAPON PILOT] BATCH FAIL: " + error);
                FinishBatch(1);
            }
        }

        private static void OnBatchPlayModeStateChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnBatchPlayModeStateChanged;
            RunBatchAsync();
        }

        private static async void RunBatchAsync()
        {
            try
            {
                await RunAsync();
                Debug.Log("[ROA WEAPON PILOT] BATCH PASS");
                FinishBatch(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[ROA WEAPON PILOT] BATCH FAIL: " + error);
                FinishBatch(1);
            }
        }

        private static void FinishBatch(int exitCode)
        {
            if (_batchOptionsCaptured)
            {
                EditorSettings.enterPlayModeOptions = _previousEnterPlayModeOptions;
                EditorSettings.enterPlayModeOptionsEnabled = _previousEnterPlayModeOptionsEnabled;
                _batchOptionsCaptured = false;
            }
            EditorApplication.Exit(exitCode);
        }

        public static async Task RunAsync()
        {
            GameObject host = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            UninterruptedDeferAgent deferAgent = null;
            try
            {
                if (!Application.isPlaying)
                {
                    deferAgent = new UninterruptedDeferAgent();
                    GltfImport.SetDefaultDeferAgent(deferAgent);
                }
                host = new GameObject("RoaWeaponPilotProbe");
                host.hideFlags = HideFlags.HideAndDontSave;
                RoaCharacterPreview preview = host.AddComponent<RoaCharacterPreview>();
                preview.Show(BaseUrl, new CharacterAppearance
                {
                    Sex = "male",
                    HairId = "short_crop",
                    HairColorId = "hair_08"
                }, 720, 640);
                await WaitUntilReady(preview, 30000);

                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                Check(character != null && character.Ready, "player character did not load");
                Animation animation = character.GetComponentInChildren<Animation>(true);
                Check(animation != null && animation["idle"] != null, "idle clip is unavailable");
                MethodInfo lateUpdate = typeof(RoaCharacterView).GetMethod(
                    "LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic);
                FieldInfo weaponField = typeof(RoaCharacterView).GetField(
                    "_weapon", BindingFlags.Instance | BindingFlags.NonPublic);
                FieldInfo gripField = typeof(RoaWeaponView).GetField(
                    "_socketGrip", BindingFlags.Instance | BindingFlags.NonPublic);
                FieldInfo handField = typeof(RoaWeaponView).GetField(
                    "_hand", BindingFlags.Instance | BindingFlags.NonPublic);
                FieldInfo weaponRootField = typeof(RoaWeaponView).GetField(
                    "_weapon", BindingFlags.Instance | BindingFlags.NonPublic);
                Check(lateUpdate != null && weaponField != null && gripField != null
                      && handField != null && weaponRootField != null,
                    "weapon diagnostics are unavailable");

                Camera camera = host.GetComponentInChildren<Camera>(true);
                Check(camera != null, "preview camera is missing");
                Transform previewRoot = camera.transform.parent;
                camera.transform.localPosition = new Vector3(1.72f, 1.48f, 2.28f);
                camera.transform.LookAt(previewRoot.position + new Vector3(0f, 1.15f, 0f));
                camera.fieldOfView = 31f;

                string captureDirectory = Environment.GetEnvironmentVariable(
                    "ROA_WEAPON_PILOT_CAPTURE_DIR");
                if (string.IsNullOrWhiteSpace(captureDirectory))
                    captureDirectory = Path.GetFullPath("Temp/WeaponPilotReview");
                Directory.CreateDirectory(captureDirectory);
                readback = new Texture2D(preview.Texture.width, preview.Texture.height,
                    TextureFormat.RGBA32, false);
                var results = new JArray();

                for (int index = 0; index < PilotIds.Length; index++)
                {
                    string weaponId = PilotIds[index];
                    await character.EquipWeapon(BaseUrl, weaponId);
                    await Task.Yield();
                    foreach (Transform node in host.GetComponentsInChildren<Transform>(true))
                        node.gameObject.layer = RoaCharacterPreview.PreviewLayer;

                    Check(character.WeaponReady && character.WeaponId == weaponId,
                        weaponId + ": runtime model did not equip");
                    AnimationState idle = animation["idle"];
                    animation.Play("idle");
                    idle.enabled = true;
                    idle.weight = 1f;
                    idle.time = Mathf.Min(0.35f, idle.length * 0.35f);
                    animation.Sample();
                    character.transform.localRotation = Quaternion.identity;
                    Vector3 aimPoint = character.transform.position + character.transform.forward * 8f;
                    aimPoint.y = character.AimPlaneY;
                    character.SetAim(aimPoint, true);
                    character.UpdateLocomotion(Vector3.zero, 0f, false, false);
                    lateUpdate.Invoke(character, null);

                    RoaWeaponView weapon = weaponField.GetValue(character) as RoaWeaponView;
                    Check(weapon != null && weapon.Ready, weaponId + ": weapon view is not ready");
                    Transform grip = gripField.GetValue(weapon) as Transform;
                    Transform hand = handField.GetValue(weapon) as Transform;
                    Transform weaponRoot = weaponRootField.GetValue(weapon) as Transform;
                    Check(grip != null && hand != null && weaponRoot != null,
                        weaponId + ": grip or runtime root is missing");
                    // The socket is intentionally offset from the wrist bone.
                    // Validate the production mount transform, not wrist=socket.
                    Matrix4x4 handToSocket = RoaWeaponGrip.HandToMount
                        * Matrix4x4.Translate(new Vector3(0.03f, -0.02f, 0.025f));
                    Vector3 expectedGrip = (hand.localToWorldMatrix * handToSocket).GetColumn(3);
                    float gripError = Vector3.Distance(grip.position, expectedGrip);
                    Check(gripError < 0.015f,
                        weaponId + ": primary grip misses the hand by " + gripError.ToString("0.000") + " m");
                    if (MeleeIds.Contains(weaponId))
                        Check(weapon.PrimaryHandSolved, weaponId + ": primary arm did not solve");
                    bool twoHanded = weaponId != "knife";
                    if (twoHanded)
                        Check(weapon.SupportHandSolved, weaponId + ": support arm did not solve");

                    bool hasMuzzle = character.TryGetMuzzle(out Vector3 muzzle);
                    float muzzleDistance = hasMuzzle
                        ? Vector3.Distance(muzzle, grip.position) : 0f;
                    if (!MeleeIds.Contains(weaponId))
                        Check(hasMuzzle && muzzleDistance > 0.18f && muzzleDistance < 1.65f,
                            weaponId + ": muzzle is missing or outside the grip envelope: " + muzzleDistance);
                    else
                        Check(!hasMuzzle, weaponId + ": melee weapon unexpectedly has a muzzle");

                    Bounds bounds = default;
                    bool hasBounds = false;
                    foreach (Renderer renderer in weaponRoot.GetComponentsInChildren<Renderer>(true))
                    {
                        if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                        if (!hasBounds) bounds = renderer.bounds;
                        else bounds.Encapsulate(renderer.bounds);
                        hasBounds = true;
                    }
                    Check(hasBounds && bounds.size.magnitude > 0.15f,
                        weaponId + ": rendered weapon bounds are empty");

                    Check(preview.RenderNow(), weaponId + ": preview render failed");
                    Check(preview.RenderNow(), weaponId + ": warmed preview render failed");
                    string capturePath = null;
                    if (!string.IsNullOrWhiteSpace(captureDirectory))
                    {
                        capturePath = Path.Combine(captureDirectory,
                            (index + 1).ToString("00") + "-" + weaponId + ".png");
                        RenderTexture.active = preview.Texture;
                        readback.ReadPixels(new Rect(0, 0, preview.Texture.width,
                            preview.Texture.height), 0, 0);
                        readback.Apply(false, false);
                        File.WriteAllBytes(capturePath, readback.EncodeToPNG());
                        CaptureLandscape(camera, Path.Combine(captureDirectory,
                            (index + 1).ToString("00") + "-" + weaponId + "-desktop.png"), 1280, 720);
                        CaptureLandscape(camera, Path.Combine(captureDirectory,
                            (index + 1).ToString("00") + "-" + weaponId + "-mobile.png"), 896, 414);
                    }

                    int attachmentSamples = CheckAnimatedAttachments(weaponId, weaponRoot);
                    lateUpdate.Invoke(character, null);
                    results.Add(new JObject
                    {
                        ["weaponId"] = weaponId,
                        ["animationAttachmentSamples"] = attachmentSamples,
                        ["primaryGripErrorMetres"] = Math.Round(gripError, 5),
                        ["primaryHandSolved"] = weapon.PrimaryHandSolved,
                        ["supportHandSolved"] = weapon.SupportHandSolved,
                        ["muzzleDistanceMetres"] = Math.Round(muzzleDistance, 4),
                        ["boundsMetres"] = new JArray(
                            Math.Round(bounds.size.x, 4),
                            Math.Round(bounds.size.y, 4),
                            Math.Round(bounds.size.z, 4)),
                        ["capture"] = capturePath
                    });
                    Debug.Log("[ROA WEAPON PILOT] PASS " + weaponId
                              + ", grip=" + gripError.ToString("0.0000")
                              + " m, bounds=" + bounds.size.ToString("F2"));
                    if (!Application.isPlaying && index + 1 < PilotIds.Length)
                        UnityEngine.Object.DestroyImmediate(weaponRoot.gameObject);
                }

                var report = new JObject
                {
                    ["schema"] = "realm.weapon-pilot-unity-fit.v1",
                    ["character"] = "male_medium",
                    ["baseUrl"] = BaseUrl,
                    ["weapons"] = results
                };
                string reportPath = Environment.GetEnvironmentVariable("ROA_WEAPON_PILOT_REPORT");
                if (string.IsNullOrWhiteSpace(reportPath))
                    reportPath = Path.Combine(captureDirectory, "fit-report.json");
                string directory = Path.GetDirectoryName(reportPath);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(reportPath, report.ToString(Formatting.Indented));
                Debug.Log("[ROA WEAPON PILOT] completed " + PilotIds.Length
                          + " in-character fit checks");
            }
            finally
            {
                if (deferAgent != null) GltfImport.UnsetDefaultDeferAgent(deferAgent);
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static async Task WaitUntilReady(RoaCharacterPreview preview, int timeoutMs)
        {
            var timer = Stopwatch.StartNew();
            while (!preview.IsReady && timer.ElapsedMilliseconds < timeoutMs)
                await Task.Delay(50);
            Check(preview.IsReady, "character preview timed out: " + preview.StatusText);
        }

        private static void CaptureLandscape(Camera camera, string path, int width, int height)
        {
            RenderTexture previousTarget = camera.targetTexture;
            RenderTexture previousActive = RenderTexture.active;
            RenderTexture target = RenderTexture.GetTemporary(width, height, 24);
            Texture2D pixels = new Texture2D(width, height, TextureFormat.RGBA32, false);
            try
            {
                camera.targetTexture = target;
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera,
                        new RenderPipeline.StandardRequest { destination = target });
                else camera.Render();
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                pixels.Apply(false, false);
                File.WriteAllBytes(path, pixels.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(pixels);
                RenderTexture.ReleaseTemporary(target);
            }
        }

        private static int CheckAnimatedAttachments(string weaponId, Transform root)
        {
            Animation modelAnimation = root.GetComponentInChildren<Animation>(true);
            Check(modelAnimation != null, weaponId + ": weapon animation is unavailable");
            modelAnimation.Stop();
            Transform[] nodes = root.GetComponentsInChildren<Transform>(true);
            var positions = new Vector3[nodes.Length];
            var rotations = new Quaternion[nodes.Length];
            var scales = new Vector3[nodes.Length];
            var pairs = new Dictionary<string, string>();
            if (weaponId == "laserPistol") pairs.Add("emitter_ring", "muzzle");
            if (weaponId == "rifle") pairs.Add("bolt_knob", "bolt");
            if (weaponId == "machineGun")
            {
                pairs.Add("ammo_box_lid", "ammo_box");
                pairs.Add("ammo_box_latch", "ammo_box");
            }
            if (weaponId == "smg") pairs.Add("magazine_base", "magazine");
            if (weaponId == "flamethrower")
            {
                pairs.Add("pressure_gauge", "fuel_tank");
                pairs.Add("gauge_face", "pressure_gauge");
                pairs.Add("fuel_valve", "fuel_tank");
                pairs.Add("pilot", "muzzle");
            }
            var attachmentIndices = new List<int>();
            for (int i = 0; i < nodes.Length; i++)
            {
                positions[i] = nodes[i].localPosition;
                rotations[i] = nodes[i].localRotation;
                scales[i] = nodes[i].localScale;
                if (pairs.TryGetValue(nodes[i].name, out string parent))
                {
                    Check(nodes[i].parent != null && nodes[i].parent.name == parent,
                        weaponId + ": " + nodes[i].name + " is not attached to " + parent);
                    attachmentIndices.Add(i);
                }
            }
            Check(attachmentIndices.Count == pairs.Count, weaponId + ": attachment part is missing");
            int samples = 0;
            try
            {
                foreach (AnimationState state in modelAnimation)
                {
                    foreach (float phase in new[] { 0f, 0.15f, 0.35f, 0.6f, 0.85f, 1f })
                    {
                        for (int i = 0; i < nodes.Length; i++)
                        {
                            nodes[i].localPosition = positions[i];
                            nodes[i].localRotation = rotations[i];
                            nodes[i].localScale = scales[i];
                        }
                        state.clip.SampleAnimation(modelAnimation.gameObject, state.length * phase);
                        foreach (int i in attachmentIndices)
                        {
                            Check(Vector3.Distance(nodes[i].localPosition, positions[i]) < 0.0001f
                                  && Quaternion.Angle(nodes[i].localRotation, rotations[i]) < 0.05f,
                                weaponId + "/" + state.name + ": " + nodes[i].name + " detaches during animation");
                            if (nodes[i].name != "pilot")
                                Check(Vector3.Distance(nodes[i].localScale, scales[i]) < 0.0001f,
                                    weaponId + ": hardware scale changes during animation");
                        }
                        samples++;
                    }
                }
                Check(samples >= 12, weaponId + ": weapon animation sampling is incomplete");
                return samples;
            }
            finally
            {
                for (int i = 0; i < nodes.Length; i++)
                {
                    nodes[i].localPosition = positions[i];
                    nodes[i].localRotation = rotations[i];
                    nodes[i].localScale = scales[i];
                }
            }
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
