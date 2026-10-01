using System;
using System.IO;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Столкновения корпуса транспорта на клиенте, настоящим RoaPlayerController в
    /// Play Mode: грузовик на газу встаёт носом у стены (а не водителем), у стены
    /// справа не разворачивает кузов в неё, но уходит от неё, и упирается в твёрдый
    /// корпус чужого пикапа, а пологий пандус его не останавливает. Размеры
    /// корпусов — из data/kromka/vehicles.json.
    /// Пакетный запуск: -executeMethod RealmOfAshes.EditorTools.RoaVehicleHullProbe.RunBatch (без -quit).
    /// </summary>
    public static class RoaVehicleHullProbe
    {
        private const float Tolerance = 0.08f;

        [MenuItem("Realm of Ashes/Проверить корпус транспорта")]
        public static async void Run()
        {
            if (!EditorApplication.isPlaying)
            {
                Debug.LogError("[ROA HULL] Запустите пробу в Play Mode или через RunBatch.");
                return;
            }
            try { await RunAsync(); }
            catch (Exception error) { Debug.LogError("[ROA HULL] FAIL: " + error); }
        }

        public static void RunBatch()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorApplication.playModeStateChanged += OnPlayMode;
            EditorApplication.EnterPlaymode();
        }

        private static async void OnPlayMode(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnPlayMode;
            int code = 0;
            try
            {
                await RunAsync();
                Debug.Log("[ROA HULL] BATCH PASS");
            }
            catch (Exception error)
            {
                Debug.LogError("[ROA HULL] BATCH FAIL: " + error);
                code = 1;
            }
            EditorApplication.Exit(code);
        }

        private static JObject VehicleRow(string group)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/kromka/vehicles.json"));
            foreach (JToken row in JObject.Parse(File.ReadAllText(path))["vehicles"] as JArray)
                if (row["itemId"]?.ToString() == group) return (JObject)row;
            throw new InvalidOperationException("no vehicle " + group);
        }

        private static JObject Mounted(string itemId, JObject row)
        {
            JObject tier = (JObject)((JArray)row["tiers"])[0];
            return new JObject
            {
                ["itemId"] = itemId,
                ["kind"] = row["kind"],
                ["speed"] = tier["speed"],
                ["acceleration"] = row["acceleration"],
                ["turnStillDeg"] = row["turnStillDeg"],
                ["turnFullDeg"] = row["turnFullDeg"],
                ["reverseSpeed"] = row["reverseSpeed"],
                ["hull"] = row["hull"].DeepClone()
            };
        }

        public static async Task RunAsync()
        {
            var root = new GameObject("RoaVehicleHullProbe");
            try
            {
                Box(root, "Ground", new Vector3(0f, -0.5f, 0f), new Vector3(200f, 1f, 200f));
                JObject truckRow = VehicleRow("armyTruck");
                RoaVehicleCatalog.Hull hull = RoaVehicleCatalog.Hull.Parse((JObject)truckRow["hull"]);
                Check(hull.Valid, "the truck hull is not parsed");
                float nose = hull.OffsetZ + hull.Length * 0.5f;
                float rightSide = hull.OffsetX + hull.Width * 0.5f;

                var playerObject = new GameObject("LocalPlayer");
                playerObject.transform.SetParent(root.transform, false);
                playerObject.transform.position = new Vector3(0f, 0.9f, 0f);
                var body = playerObject.AddComponent<CharacterController>();
                body.height = 1.8f;
                body.center = Vector3.zero;
                RoaPlayerController player = playerObject.AddComponent<RoaPlayerController>();
                player.ApplyVehicleState(Mounted("armyTruck", truckRow));
                Check(player.Mounted && player.VehicleHull.Valid, "the truck did not mount with a hull");
                await Frames(3);

                // 1. На газу в стену: нос встаёт у стены, водитель — на длину капота раньше.
                GameObject wall = Box(root, "WallAhead", new Vector3(0f, 1.5f, 12.5f), new Vector3(30f, 3f, 1f));
                await Drive(player, new Vector2(0f, 1f), 7f, () => player.transform.position.z + nose > 11.9f && player.Velocity.sqrMagnitude < 0.01f);
                float noseZ = player.transform.position.z + nose;
                Debug.Log("[ROA HULL] nose at the wall: " + noseZ.ToString("0.000") + " (wall face 12)");
                Check(noseZ <= 12f + Tolerance, "the truck nose drove into the wall: " + noseZ.ToString("0.000"));
                Check(noseZ >= 11.5f, "the truck stopped short of the wall: " + noseZ.ToString("0.000"));
                Check(!HullOverlaps(player, hull, wall), "the truck hull overlaps the wall ahead");
                UnityEngine.Object.Destroy(wall);

                // 2. Стена справа в 60 см от борта: руль вправо нос в неё не заносит, влево — пускает,
                // пока в стену не упрётся корма (грузовик разворачивается вокруг заднего моста).
                Reset(player, truckRow);
                GameObject side = Box(root, "WallRight", new Vector3(rightSide + 0.6f + 0.5f, 1.5f, 0f), new Vector3(1f, 3f, 40f));
                await Frames(3);
                await Drive(player, new Vector2(1f, 0f), 1.5f, null);
                float yawRight = Mathf.DeltaAngle(0f, player.transform.eulerAngles.y);
                Debug.Log("[ROA HULL] yaw after steering into the right wall: " + yawRight.ToString("0.0"));
                Check(yawRight < 12f, "the truck swung its hull into the wall: yaw " + yawRight.ToString("0.0"));
                Check(!HullOverlaps(player, hull, side), "the truck hull overlaps the wall on the right");
                await Drive(player, new Vector2(-1f, 0f), 1.5f, null);
                float yawLeft = Mathf.DeltaAngle(0f, player.transform.eulerAngles.y);
                Debug.Log("[ROA HULL] yaw after steering away: " + yawLeft.ToString("0.0"));
                Check(yawLeft < -12f, "the truck cannot turn away from the wall: yaw " + yawLeft.ToString("0.0"));
                Check(!HullOverlaps(player, hull, side), "the truck tail swung into the wall on the right");
                Check(yawLeft > -40f, "the truck tail passed through the wall on the right: yaw " + yawLeft.ToString("0.0"));
                // С газом корма уходит от стены по ходу, и грузовик выезжает.
                await Drive(player, new Vector2(-1f, 1f), 2f, null);
                float yawOut = Mathf.DeltaAngle(0f, player.transform.eulerAngles.y);
                Debug.Log("[ROA HULL] yaw after driving away: " + yawOut.ToString("0.0"));
                Check(yawOut < yawLeft - 20f, "the truck cannot drive away from the wall: yaw " + yawOut.ToString("0.0"));
                Check(!HullOverlaps(player, hull, side), "the truck scraped into the wall while driving away");
                UnityEngine.Object.Destroy(side);

                // 3. Чужой пикап впереди: его корпус твёрдый, грузовик упирается ему в корму.
                Reset(player, truckRow);
                JObject pickupRow = VehicleRow("pickup");
                RoaVehicleCatalog.Hull pickupHull = RoaVehicleCatalog.Hull.Parse((JObject)pickupRow["hull"]);
                var remote = new GameObject("RemotePickup");
                remote.transform.SetParent(root.transform, false);
                remote.transform.position = new Vector3(0f, 0f, 20f);
                GameObject prefab = RoaApocalypseModels.Vehicle("pickup");
                Check(prefab != null, "the palette has no pickup model");
                RoaVehicleView view = RoaVehicleView.CreateFromPack(remote.transform, "pickup", prefab);
                view.SetSolidHull(pickupHull);
                await Frames(3);
                float tail = 20f + pickupHull.OffsetZ - pickupHull.Length * 0.5f;
                await Drive(player, new Vector2(0f, 1f), 8f, () => player.transform.position.z + nose > tail - 0.1f && player.Velocity.sqrMagnitude < 0.01f);
                noseZ = player.transform.position.z + nose;
                Debug.Log("[ROA HULL] nose at the pickup tail: " + noseZ.ToString("0.000") + " (tail " + tail.ToString("0.000") + ")");
                Check(noseZ <= tail + Tolerance, "the truck drove into the other player's pickup: " + noseZ.ToString("0.000"));
                Check(noseZ >= tail - 0.5f, "the truck stopped short of the pickup: " + noseZ.ToString("0.000"));
                view.Dismiss();
                await Frames(2);
                Check(view == null || view.GetComponentInChildren<BoxCollider>() == null, "a dismissed vehicle keeps its solid hull");

                // 4. Пологий пандус (10°) — земля, а не стена: корпус по нему едет.
                Reset(player, truckRow);
                GameObject ramp = Box(root, "Ramp", new Vector3(0f, 0.3f, 14f), new Vector3(8f, 1f, 16f));
                ramp.transform.rotation = Quaternion.Euler(-10f, 0f, 0f);
                await Frames(3);
                float peak = 0f;
                player.SetVirtualMove(new Vector2(0f, 1f));
                float rampUntil = Time.realtimeSinceStartup + 4f;
                while (Time.realtimeSinceStartup < rampUntil)
                {
                    await Task.Yield();
                    peak = Mathf.Max(peak, player.transform.position.y);
                }
                player.SetVirtualMove(Vector2.zero);
                Debug.Log("[ROA HULL] over the ramp: " + player.transform.position.ToString("F2") + ", peak height " + peak.ToString("0.00"));
                Check(player.transform.position.z > 22f && Mathf.Abs(player.transform.position.x) < 0.05f && peak > 1.5f,
                    "a gentle ramp stopped or deflected the truck: " + player.transform.position.ToString("F2"));
                UnityEngine.Object.Destroy(ramp);

                Debug.Log("[ROA HULL] PASS: wall ahead, wall on the right, drive-away, other player's pickup, ramp");
            }
            finally
            {
                UnityEngine.Object.Destroy(root);
            }
        }

        private static void Reset(RoaPlayerController player, JObject truckRow)
        {
            player.ApplyVehicleState(null);
            player.Teleport(new Vector3(0f, 0.9f, 0f));
            player.AimAtWorld(new Vector3(0f, 0.9f, 10f));
            player.ApplyVehicleState(Mounted("armyTruck", truckRow));
        }

        private static async Task Drive(RoaPlayerController player, Vector2 input, float seconds, Func<bool> done)
        {
            player.SetVirtualMove(input);
            float until = Time.realtimeSinceStartup + seconds;
            float settled = -1f;
            while (Time.realtimeSinceStartup < until)
            {
                await Task.Yield();
                if (done == null) continue;
                if (!done()) { settled = -1f; continue; }
                if (settled < 0f) settled = Time.realtimeSinceStartup;
                else if (Time.realtimeSinceStartup - settled > 0.3f) break;
            }
            player.SetVirtualMove(Vector2.zero);
            await Frames(2);
        }

        private static bool HullOverlaps(RoaPlayerController player, RoaVehicleCatalog.Hull hull, GameObject wall)
        {
            Transform t = player.transform;
            Vector3 feet = t.position + Vector3.down * 0.9f;
            Vector3 center = feet + t.rotation * hull.LocalCenter;
            Collider wallCollider = wall.GetComponent<Collider>();
            foreach (Collider hit in Physics.OverlapBox(center, hull.HalfExtents - Vector3.one * 0.03f, t.rotation))
                if (hit == wallCollider) return true;
            return false;
        }

        private static GameObject Box(GameObject root, string name, Vector3 center, Vector3 size)
        {
            GameObject box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.name = name;
            box.transform.SetParent(root.transform, false);
            box.transform.position = center;
            box.transform.localScale = size;
            return box;
        }

        private static async Task Frames(int count)
        {
            for (int i = 0; i < count; i++) await Task.Yield();
            Physics.SyncTransforms();
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
