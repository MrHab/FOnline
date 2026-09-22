using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using RenderPipeline = UnityEngine.Rendering.RenderPipeline;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Седок на мотоцикле для всех шести тел: таз в седле, кисти на рукоятях,
    /// стопы на подножках, колёса крутятся по пути, в вираже транспорт и седок
    /// ложатся внутрь поворота, а спешивание возвращает стойку. Снимки — в
    /// Temp/RiderPoseReview (или ROA_RIDER_CAPTURE_DIR): сбоку, игровой камерой
    /// сверху и в вираже.
    ///
    /// Модель мотоцикла берётся из импортированного GLB пакета моделей, тело —
    /// из каталога префабов, поэтому сервер для пробы не нужен.
    /// Пакетный запуск: -executeMethod RealmOfAshes.EditorTools.RoaRiderPoseProbe.RunBatch (без -quit).
    /// </summary>
    public static class RoaRiderPoseProbe
    {
        private const string BaseUrl = "http://127.0.0.1:3000";
        private const string VehicleAsset = "Packages/com.realmofashes.models/vehicles/vehicle_motorcycle.glb";
        private const int Layer = 30;
        private const float MaxLimbError = 0.06f;

        private static readonly string[] Bodies =
        {
            "male_medium", "male_slim", "male_large", "female_medium", "female_slim", "female_large"
        };

        private static bool _batchOptionsCaptured;
        private static bool _previousEnterPlayModeOptionsEnabled;
        private static EnterPlayModeOptions _previousEnterPlayModeOptions;

        [MenuItem("Realm of Ashes/Проверить позу седока")]
        public static async void Run()
        {
            if (!EditorApplication.isPlaying)
            {
                Debug.LogError("[ROA RIDER] Запустите пробу в Play Mode или через RunBatch.");
                return;
            }
            try { await RunAsync(); }
            catch (Exception error) { Debug.LogError("[ROA RIDER] FAIL: " + error); }
        }

        public static void RunBatch()
        {
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
                Debug.LogError("[ROA RIDER] BATCH FAIL: " + error);
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
                Debug.Log("[ROA RIDER] BATCH PASS");
                FinishBatch(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[ROA RIDER] BATCH FAIL: " + error);
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
            var vehicleAsset = AssetDatabase.LoadAssetAtPath<GameObject>(VehicleAsset);
            Check(vehicleAsset != null, "motorcycle GLB is not imported: " + VehicleAsset);
            string captureDirectory = Environment.GetEnvironmentVariable("ROA_RIDER_CAPTURE_DIR");
            if (string.IsNullOrWhiteSpace(captureDirectory)) captureDirectory = Path.GetFullPath("Temp/RiderPoseReview");
            Directory.CreateDirectory(captureDirectory);

            AmbientMode savedMode = RenderSettings.ambientMode;
            Color savedAmbient = RenderSettings.ambientLight;
            var rig = new GameObject("RoaRiderPoseProbeRig");
            var results = new JArray();
            try
            {
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = new Color(0.42f, 0.43f, 0.46f, 1f);
                Camera camera = BuildRig(rig);
                foreach (string body in Bodies)
                    results.Add(await ProbeBody(body, vehicleAsset, camera, captureDirectory,
                        body == "male_medium" || body == "female_slim"));
            }
            finally
            {
                RenderSettings.ambientMode = savedMode;
                RenderSettings.ambientLight = savedAmbient;
                UnityEngine.Object.Destroy(rig);
            }

            var report = new JObject
            {
                ["schema"] = "realm.rider-pose.v1",
                ["vehicle"] = "motorcycle",
                ["bodies"] = results
            };
            File.WriteAllText(Path.Combine(captureDirectory, "rider-report.json"), report.ToString(Formatting.Indented));
            Debug.Log("[ROA RIDER] PASS " + Bodies.Length + " bodies; captures: " + captureDirectory);
        }

        private static async Task<JObject> ProbeBody(string body, GameObject vehicleAsset, Camera camera,
                                                     string captureDirectory, bool capture)
        {
            string[] parts = body.Split('_');
            var root = new GameObject("RiderProbe:" + body);
            try
            {
                var viewObject = new GameObject("View");
                viewObject.transform.SetParent(root.transform, false);
                RoaCharacterView character = viewObject.AddComponent<RoaCharacterView>();
                await character.Load(BaseUrl, new JObject { ["sex"] = parts[0], ["bodyType"] = parts[1] });
                Check(character.Ready, body + ": character did not load");

                GameObject model = UnityEngine.Object.Instantiate(vehicleAsset);
                RoaVehicleView vehicle = RoaVehicleView.CreateFromModel(character.transform, "motorcycle", model);
                Check(vehicle.Ready, body + ": motorcycle nodes are missing");
                character.AttachVehicle(vehicle);
                Check(character.Riding, body + ": character is not riding");
                SetLayer(root, Layer);

                FieldInfo weightField = typeof(RoaCharacterView).GetField("_riderWeight", BindingFlags.Instance | BindingFlags.NonPublic);
                MethodInfo lateUpdate = typeof(RoaCharacterView).GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic);
                Check(weightField != null && lateUpdate != null, "rider diagnostics are unavailable");
                weightField.SetValue(character, 1f);

                Animation animation = character.GetComponentInChildren<Animation>(true);
                Check(animation != null && animation["idle"] != null, body + ": idle clip is unavailable");

                // Ровный ход: 8 м/с прямо, без поворота. Кадры идут настоящие, иначе
                // Time.deltaTime не растёт и колёсам не на что крутиться.
                float spun = 0f;
                for (int frame = 0; frame < 8; frame++)
                {
                    float before = vehicle.WheelAngleDeg;
                    Pose(character, animation, lateUpdate, new Vector3(0f, 0f, 8f), 1);
                    spun += Mathf.Abs(Mathf.DeltaAngle(before, vehicle.WheelAngleDeg));
                    await Task.Yield();
                }
                Pose(character, animation, lateUpdate, new Vector3(0f, 0f, 8f), 1);
                Check(spun > 1f, body + ": wheels do not spin while riding");

                Check(vehicle.TryGetAnchors(out RoaVehicleView.Anchors anchors), body + ": no rider anchors");
                Transform pelvis = Bone(character, "pelvis");
                Transform handL = Bone(character, "hand_l");
                Transform handR = Bone(character, "hand_r");
                Transform footL = Bone(character, "foot_l");
                Transform footR = Bone(character, "foot_r");
                Transform head = Bone(character, "head");
                Check(pelvis != null && handL != null && handR != null && footL != null && footR != null && head != null,
                    body + ": rider bones are missing");
                float seatError = Vector3.Distance(pelvis.position,
                    anchors.Seat + anchors.Up * RoaRiderPose.PelvisAboveSeat - anchors.Forward * 0.03f);
                float gripLeft = Vector3.Distance(handL.position, anchors.GripLeft);
                float gripRight = Vector3.Distance(handR.position, anchors.GripRight);
                float pegLeft = Vector3.Distance(footL.position, anchors.PegLeft);
                float pegRight = Vector3.Distance(footR.position, anchors.PegRight);
                float reach = character.RiderPose.LastReachError;
                Check(seatError < 0.01f, body + ": pelvis misses the saddle by " + seatError.ToString("0.000"));
                Check(reach < MaxLimbError, body + ": a limb misses its grip or peg by " + reach.ToString("0.000"));
                Check(gripLeft < 0.16f && gripRight < 0.16f, body + ": hands are off the grips: "
                    + gripLeft.ToString("0.00") + " / " + gripRight.ToString("0.00"));
                Check(pegLeft < 0.2f && pegRight < 0.2f, body + ": feet are off the pegs: "
                    + pegLeft.ToString("0.00") + " / " + pegRight.ToString("0.00"));
                Check(handL.position.x < handR.position.x, body + ": the rider crossed the arms");
                Check(head.position.y > anchors.Seat.y + 0.55f, body + ": the rider slumps below the bars");
                float seatedPelvisY = pelvis.position.y;
                int skinned = 0;
                foreach (SkinnedMeshRenderer renderer in character.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    // Снимок идёт посреди кадра: без пересчёта на каждый рендер камера
                    // увидела бы скиннинг прошлого кадра.
                    renderer.forceMatrixRecalculationPerRender = true;
                    renderer.updateWhenOffscreen = true;
                    if (Array.IndexOf(renderer.bones, pelvis) >= 0) skinned++;
                }
                Check(skinned > 0, body + ": no skinned mesh follows the posed pelvis");
                float lowest = BakedLowestY(character);
                Check(lowest > 0.06f, body + ": the rider's feet still touch the ground (lowest skinned point "
                    + lowest.ToString("0.000") + " m)");
                if (capture)
                {
                    // Дальше позу держит обычный LateUpdate каждого кадра, снимки — с включённой камерой.
                    Debug.Log("[ROA RIDER] " + body + " pelvis " + pelvis.position.ToString("F3")
                        + " seat " + anchors.Seat.ToString("F3") + ", lowest skinned point " + lowest.ToString("0.000"));
                    await Shoot(camera, anchors, new Vector3(-3.4f, 1.0f, 0.1f), 30f, Path.Combine(captureDirectory, body + "-side.png"));
                    await Shoot(camera, anchors, new Vector3(7.5f, 9.5f, -7.5f), 24f, Path.Combine(captureDirectory, body + "-game.png"));
                    await Shoot(camera, anchors, new Vector3(2.4f, 1.7f, 3.0f), 30f, Path.Combine(captureDirectory, body + "-front.png"));
                }

                // Вираж: поворот направо 90°/с на 9 м/с — крен вправо (отрицательный угол).
                for (int frame = 0; frame < 30; frame++)
                {
                    root.transform.rotation = Quaternion.Euler(0f, frame * 3f, 0f);
                    Pose(character, animation, lateUpdate, root.transform.forward * 9f, 1);
                    await Task.Yield();
                }
                float lean = vehicle.LeanDeg;
                Check(lean < -3f, body + ": no lean into a right turn: " + lean.ToString("0.0"));
                Check(Mathf.Abs(vehicle.SteerDeg) > 0.5f, body + ": the handlebar does not steer");
                if (capture && vehicle.TryGetAnchors(out RoaVehicleView.Anchors turning))
                    await Shoot(camera, turning, -turning.Forward * 3.6f + Vector3.up * 1.4f, 30f,
                        Path.Combine(captureDirectory, body + "-turn.png"));

                // Спешивание: транспорт уезжает, вес позы уходит, стойка возвращается.
                character.SetVehicle(BaseUrl, string.Empty);
                Check(!character.Riding, body + ": dismount ignored");
                // Пакетный режим крутит кадры по миллисекунде: ждём по реальному времени.
                float releaseDeadline = Time.realtimeSinceStartup + 5f;
                while (character.RiderWeight > 0f && Time.realtimeSinceStartup < releaseDeadline)
                {
                    Pose(character, animation, lateUpdate, Vector3.zero, 1);
                    await Task.Yield();
                }
                Check(character.RiderWeight <= 0f, body + ": the rider pose never released");
                float standingLowest = BakedLowestY(character);
                Check(standingLowest < 0.05f, body + ": after dismounting the feet do not reach the ground (lowest "
                    + standingLowest.ToString("0.000") + " m, pelvis " + pelvis.position.y.ToString("0.000")
                    + " vs seated " + seatedPelvisY.ToString("0.000") + ")");

                Debug.Log("[ROA RIDER] PASS " + body + ": seat " + seatError.ToString("0.000")
                    + " m, reach " + reach.ToString("0.000") + " m, lean " + lean.ToString("0.0") + "°");
                return new JObject
                {
                    ["body"] = body,
                    ["seatErrorMetres"] = Math.Round(seatError, 4),
                    ["limbReachErrorMetres"] = Math.Round(reach, 4),
                    ["handToGripMetres"] = new JArray(Math.Round(gripLeft, 3), Math.Round(gripRight, 3)),
                    ["footToPegMetres"] = new JArray(Math.Round(pegLeft, 3), Math.Round(pegRight, 3)),
                    ["leanDegrees"] = Math.Round(lean, 2),
                    ["wheelSpinDegrees"] = Math.Round(spun, 2)
                };
            }
            finally
            {
                UnityEngine.Object.Destroy(root);
            }
        }

        private static void Pose(RoaCharacterView character, Animation animation, MethodInfo lateUpdate,
                                 Vector3 velocity, int frames)
        {
            for (int i = 0; i < frames; i++)
            {
                AnimationState idle = animation["idle"];
                animation.Play("idle");
                idle.enabled = true;
                idle.weight = 1f;
                idle.time = Mathf.Min(0.35f, idle.length * 0.35f);
                animation.Sample();
                float yaw = character.transform.parent != null ? character.transform.parent.eulerAngles.y : 0f;
                character.UpdateLocomotion(velocity, yaw, velocity.sqrMagnitude > 0.01f, false);
                lateUpdate.Invoke(character, null);
            }
        }

        private static Transform Bone(RoaCharacterView character, string name)
        {
            foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
            {
                if (node.name != name) continue;
                if (character.Vehicle != null && node.IsChildOf(character.Vehicle.transform)) continue;
                return node;
            }
            return null;
        }

        private static Camera BuildRig(GameObject rig)
        {
            var cameraObject = new GameObject("RiderProbeCamera");
            cameraObject.transform.SetParent(rig.transform, false);
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.enabled = false;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.52f, 0.47f, 0.38f, 1f);
            camera.cullingMask = 1 << Layer;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 60f;
            camera.allowHDR = false;
            camera.allowMSAA = false;
            AddLight(rig, new Vector3(48f, -35f, 0f), new Color(1f, 0.93f, 0.82f), 1.5f);
            AddLight(rig, new Vector3(22f, 150f, 0f), new Color(0.7f, 0.78f, 0.9f), 0.55f);
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "RiderProbeGround";
            ground.transform.SetParent(rig.transform, false);
            ground.transform.localScale = new Vector3(3f, 1f, 3f);
            ground.layer = Layer;
            return camera;
        }

        private static void AddLight(GameObject rig, Vector3 euler, Color color, float intensity)
        {
            var lightObject = new GameObject("RiderProbeLight");
            lightObject.transform.SetParent(rig.transform, false);
            lightObject.transform.rotation = Quaternion.Euler(euler);
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.cullingMask = 1 << Layer;
            light.shadows = LightShadows.None;
        }

        /// <summary>
        /// Снимок обычным кадром: камера включена и рисует после LateUpdate и
        /// скиннинга. Рендер по запросу посреди кадра показал бы скиннинг прошлого
        /// кадра — стоящего, а не сидящего седока.
        /// </summary>
        private static async Task Shoot(Camera camera, RoaVehicleView.Anchors anchors, Vector3 offset, float fov, string path)
        {
            Vector3 focus = anchors.Seat + anchors.Up * 0.05f;
            camera.fieldOfView = fov;
            camera.transform.position = focus + offset;
            camera.transform.LookAt(focus);
            const int width = 960;
            const int height = 720;
            RenderTexture target = RenderTexture.GetTemporary(width, height, 24);
            RenderTexture previous = RenderTexture.active;
            var pixels = new Texture2D(width, height, TextureFormat.RGBA32, false);
            try
            {
                camera.targetTexture = target;
                camera.enabled = true;
                for (int frame = 0; frame < 3; frame++) await Task.Yield();
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                pixels.Apply(false, false);
                File.WriteAllBytes(path, pixels.EncodeToPNG());
            }
            finally
            {
                camera.enabled = false;
                camera.targetTexture = null;
                RenderTexture.active = previous;
                UnityEngine.Object.DestroyImmediate(pixels);
                RenderTexture.ReleaseTemporary(target);
            }
        }

        /// <summary>Нижняя точка скиннированного тела по текущим костям: стопы на подножках, а не на земле.</summary>
        private static float BakedLowestY(RoaCharacterView character)
        {
            float lowest = float.PositiveInfinity;
            var mesh = new Mesh();
            try
            {
                foreach (SkinnedMeshRenderer renderer in character.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                    renderer.BakeMesh(mesh, true);
                    Matrix4x4 world = renderer.transform.localToWorldMatrix;
                    foreach (Vector3 vertex in mesh.vertices) lowest = Mathf.Min(lowest, world.MultiplyPoint3x4(vertex).y);
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(mesh);
            }
            return lowest;
        }

        private static void SetLayer(GameObject root, int layer)
        {
            root.layer = layer;
            foreach (Transform child in root.transform) SetLayer(child.gameObject, layer);
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
