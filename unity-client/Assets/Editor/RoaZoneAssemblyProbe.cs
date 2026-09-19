#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Сборка сгенерированной зоны мира на клиенте: все префабы набора находятся,
    /// коллайдеры клиента совпадают с серверными боксами (проверка по точкам той же
    /// формулой, что circleRotatedBlockerPenalty в server.js), повторная сборка
    /// берёт объекты из пулов. Снимает кадр сверху и кадр с игровой камеры.
    ///
    /// Зона берётся из ROA_ZONE_PROBE_JSON (определение, которое строит сервер),
    /// кадры и отчёт пишутся в ROA_ZONE_PROBE_OUT.
    /// </summary>
    public static class RoaZoneAssemblyProbe
    {
        private const float Tile = 2f;

        [MenuItem("Realm of Ashes/Zones/Check zone assembly")]
        public static void Run()
        {
            string outDir = Environment.GetEnvironmentVariable("ROA_ZONE_PROBE_OUT");
            if (string.IsNullOrEmpty(outDir)) outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Temp", "ZoneProbe"));
            Directory.CreateDirectory(outDir);
            var report = new StringBuilder();
            try
            {
                Check(outDir, report);
                report.AppendLine("RESULT OK");
                File.WriteAllText(Path.Combine(outDir, "report.txt"), report.ToString());
                Debug.Log("[ZoneProbe] OK\n" + report);
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                report.AppendLine("RESULT FAIL " + error.Message);
                File.WriteAllText(Path.Combine(outDir, "report.txt"), report.ToString());
                Debug.LogError("[ZoneProbe] FAIL " + error + "\n" + report);
                if (Application.isBatchMode) EditorApplication.Exit(1);
            }
        }

        private static void Check(string outDir, StringBuilder report)
        {
            string jsonPath = Environment.GetEnvironmentVariable("ROA_ZONE_PROBE_JSON");
            Require(!string.IsNullOrEmpty(jsonPath) && File.Exists(jsonPath), "ROA_ZONE_PROBE_JSON must point at a zone definition");
            LocationDefinition zone = JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(jsonPath));
            Require(zone != null && zone.Generated && zone.Objects != null && zone.Objects.Count > 0, "the file is not a generated zone");

            // --- набор: каждый ключ data/zones/kit.json — префаб с мешами ----------------------
            RoaZoneKitCatalog kit = RoaZoneKitCatalog.Instance;
            Require(kit != null, "RoaZoneKitCatalog is not loadable from Resources");
            string kitFile = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "data", "zones", "kit.json"));
            JObject kitJson = JObject.Parse(File.ReadAllText(kitFile));
            int kitKeys = 0;
            foreach (JProperty property in ((JObject)kitJson["prefabs"]).Properties())
            {
                kitKeys++;
                GameObject prefab = kit.Find(property.Name);
                Require(prefab != null, "kit prefab missing from the catalog: " + property.Name);
                int meshes = 0;
                foreach (MeshFilter filter in prefab.GetComponentsInChildren<MeshFilter>(true))
                    if (filter.sharedMesh != null) meshes++;
                Require(meshes > 0, "kit prefab has no mesh (store pack missing?): " + property.Name);
            }
            Require(kit.EntryCount == kitKeys, "catalog has " + kit.EntryCount + " entries, kit has " + kitKeys);
            report.AppendLine("kit prefabs: " + kitKeys);

            // --- сборка ---------------------------------------------------------------------------
            EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var host = new GameObject("ZoneProbe");
            var assembler = host.AddComponent<RoaZoneAssembler>();
            Transform root = new GameObject("Zone:" + zone.Id).transform;
            var roots = new Dictionary<string, GameObject>();
            var entries = new Dictionary<string, LocationObject>();
            Drain(assembler.Build(zone, root, roots, entries, null));
            int expected = 0;
            foreach (LocationObject entry in zone.Objects) if (entry != null && !string.IsNullOrEmpty(entry.Prefab)) expected++;
            Require(assembler.MissingPrefabs == 0, "objects without a prefab: " + assembler.MissingPrefabs);
            Require(assembler.ActiveCount == expected, "built " + assembler.ActiveCount + " of " + expected);
            report.AppendLine("zone " + zone.Id + " '" + zone.Name + "': objects " + expected + ", created " + assembler.CreatedCount);

            // --- коллизия: клиент упирается там же, где сервер ------------------------------------
            Physics.SyncTransforms();
            int solid = 0, samples = 0, mismatches = 0;
            var firstMismatch = string.Empty;
            foreach (LocationObject entry in zone.Objects)
            {
                if (entry == null || !string.Equals(entry.Collision, "solid", StringComparison.OrdinalIgnoreCase)) continue;
                JObject part = entry.CollisionParts != null && entry.CollisionParts.Count > 0 ? entry.CollisionParts[0] as JObject : null;
                Require(part != null, entry.Id + ": a solid zone object has no collision part");
                Require(roots.TryGetValue(entry.Id, out GameObject instance), entry.Id + " was not built");
                BoxCollider box = instance.GetComponent<BoxCollider>();
                Require(box != null && box.enabled, entry.Id + ": no enabled BoxCollider");
                solid++;
                ServerBox server = ServerBoxFor(entry, part);
                float halfY = Mathf.Max(0.3f, (float)(part["height"] ?? 1.5)) * Mathf.Max(0.01f, entry.Scale != null && entry.Scale.Y != 0f ? entry.Scale.Y : 1f) * 0.5f;
                float reach = Mathf.Max(server.HalfX, server.HalfZ) + 0.6f;
                for (float dx = -reach; dx <= reach; dx += 0.25f)
                {
                    for (float dz = -reach; dz <= reach; dz += 0.25f)
                    {
                        float px = server.X + dx, pz = server.Z + dz;
                        float margin = server.Margin(px, pz);
                        if (Mathf.Abs(margin) < 0.06f) continue; // граница: округления не считаем
                        bool serverInside = margin > 0f;
                        Vector3 point = new Vector3(px, halfY, -pz);
                        bool clientInside = (box.ClosestPoint(point) - point).sqrMagnitude < 1e-6f;
                        samples++;
                        if (serverInside != clientInside)
                        {
                            mismatches++;
                            if (firstMismatch.Length == 0)
                                firstMismatch = entry.Id + " at " + px.ToString("0.00") + "," + pz.ToString("0.00") + " server=" + serverInside;
                        }
                    }
                }
            }
            report.AppendLine("solid objects " + solid + ", collision samples " + samples + ", mismatches " + mismatches + (firstMismatch.Length > 0 ? " first: " + firstMismatch : ""));
            Require(solid > 0, "the zone has no solid objects");
            Require(mismatches == 0, "client colliders differ from server boxes: " + firstMismatch);

            // --- пулы: вторая сборка не создаёт новых объектов ------------------------------------
            int created = assembler.CreatedCount;
            assembler.ReleaseAll();
            Require(assembler.ActiveCount == 0, "release left objects active");
            Drain(assembler.Build(zone, root, roots, entries, null));
            Require(assembler.CreatedCount == created, "rebuilding from pools created " + (assembler.CreatedCount - created) + " new objects");
            Require(assembler.ActiveCount == expected, "rebuild from pools built " + assembler.ActiveCount);
            report.AppendLine("pool rebuild: 0 new objects");

            // --- кадры -----------------------------------------------------------------------------
            AddGroundAndMarkers(zone);

            // --- покров земли: детерминирован и не ложится на объекты, тропы и ворота ---------------
            var cover = new GameObject("ZoneGroundCover").AddComponent<RoaZoneGroundCover>();
            cover.transform.SetParent(root, false);
            cover.Build(zone, false);
            Require(cover.InstanceCount > 5000, "ground cover placed " + cover.InstanceCount + " instances");
            var again = new GameObject("ZoneGroundCoverAgain").AddComponent<RoaZoneGroundCover>();
            again.Build(zone, false);
            Require(again.InstanceCount == cover.InstanceCount, "ground cover is not deterministic");
            UnityEngine.Object.DestroyImmediate(again.gameObject);
            var mobileCover = new GameObject("ZoneGroundCoverMobile").AddComponent<RoaZoneGroundCover>();
            mobileCover.Build(zone, true);
            report.AppendLine("ground cover: " + cover.InstanceCount + " instances desktop, " + mobileCover.InstanceCount + " mobile");
            UnityEngine.Object.DestroyImmediate(mobileCover.gameObject);

            int w = zone.TileWidth, d = zone.TileDepth;
            Capture(Path.Combine(outDir, "zone-top.png"), new Vector3(0f, 320f, 0f), Quaternion.Euler(90f, 0f, 0f), false, 0f, 1600, null);
            Vector3 hub = TileToUnity(zone.Spawn.Tx, zone.Spawn.Tz, w, d);
            Capture(Path.Combine(outDir, "zone-hub.png"), hub + new Vector3(0f, 16f, -15f), Quaternion.Euler(47f, 0f, 0f), false, 0f, 1280, cover);
            foreach (LocationTransition gate in zone.Transitions)
            {
                if (!string.Equals(gate.Type, "zoneGate", StringComparison.Ordinal)) continue;
                Vector3 at = TileToUnity(gate.Tx, gate.Tz, w, d);
                Capture(Path.Combine(outDir, "zone-gate-" + gate.Direction + ".png"), at + new Vector3(0f, 14f, -13f), Quaternion.Euler(47f, 0f, 0f), false, 0f, 1024, cover);
                break;
            }
            // Игровая камера (RoaCameraRig: 11,5 м, наклон 55°, поворот 45°, FOV 52) над заполнителем и точкой интереса.
            int shots = 0;
            foreach (JToken row in zone.Zone?["chunks"] as JArray ?? new JArray())
            {
                string chunk = (string)row["chunk"] ?? string.Empty;
                string kind = chunk.StartsWith("filler_", StringComparison.Ordinal) ? "filler" : chunk.StartsWith("poi_", StringComparison.Ordinal) ? "poi" : null;
                if (kind == null || File.Exists(Path.Combine(outDir, "zone-play-" + kind + ".png"))) continue;
                float sx = -zone.WorldWidth / 2f + ((int)row["slot"][0] + 0.5f) * 40f;
                float sz = -zone.WorldDepth / 2f + ((int)row["slot"][1] + 0.5f) * 40f;
                Vector3 target = new Vector3(sx, 0f, -sz);
                Quaternion orbit = Quaternion.Euler(55f, 45f, 0f);
                Capture(Path.Combine(outDir, "zone-play-" + kind + ".png"), target - orbit * Vector3.forward * 11.5f, orbit, false, 0f, 1024, cover, 52f);
                report.AppendLine("gameplay shot over " + chunk + ": " + cover.ActivePieces + " cover pieces in " + cover.ShownSlots + " slots around the camera");
                if (++shots == 2) break;
            }
            // Окно покрова ездит за камерой: уход в соседний слот переиспользует экземпляры из пула.
            cover.ShowAround(new Vector3(-100f, 0f, -100f), 1);
            int createdBefore = cover.CreatedPieces;
            cover.ShowAround(new Vector3(-60f, 0f, -100f), 1);
            cover.ShowAround(new Vector3(-100f, 0f, -100f), 1);
            Require(cover.ShownSlots == 9, "the cover window shows " + cover.ShownSlots + " slots");
            report.AppendLine("cover window: " + cover.ActivePieces + " pieces in 9 slots, " + cover.CreatedPieces + " created in total, "
                + (cover.CreatedPieces - createdBefore) + " created by moving one slot and back");
            report.AppendLine("captures written to " + outDir);
        }

        private struct ServerBox
        {
            public float X, Z, HalfX, HalfZ, Theta;

            // Та же формула, что circleRotatedBlockerPenalty: точка в осях бокса.
            public float Margin(float px, float pz)
            {
                float dx = px - X, dz = pz - Z;
                float c = Mathf.Cos(Theta), s = Mathf.Sin(Theta);
                float lx = dx * c - dz * s;
                float lz = dx * s + dz * c;
                return Mathf.Min(HalfX - Mathf.Abs(lx), HalfZ - Mathf.Abs(lz));
            }
        }

        // transformedBounds (model-colliders.js): поворот объекта берётся со знаком минус.
        private static ServerBox ServerBoxFor(LocationObject entry, JObject part)
        {
            float x = entry.Position?.X ?? 0f, z = entry.Position?.Z ?? 0f;
            float yaw = entry.Rotation?.Y ?? 0f;
            float sx = entry.Scale != null && entry.Scale.X != 0f ? entry.Scale.X : 1f;
            float sz = entry.Scale != null && entry.Scale.Z != 0f ? entry.Scale.Z : 1f;
            float cx = (float)(part["center"]?["x"] ?? 0) * sx, cz = (float)(part["center"]?["z"] ?? 0) * sz;
            float rot = -yaw;
            float c = Mathf.Cos(rot), s = Mathf.Sin(rot);
            return new ServerBox
            {
                X = x + cx * c - cz * s,
                Z = z + cx * s + cz * c,
                HalfX = (float)(part["size"]?["x"] ?? 1) * Mathf.Abs(sx) * 0.5f,
                HalfZ = (float)(part["size"]?["z"] ?? 1) * Mathf.Abs(sz) * 0.5f,
                // circleRotatedBlockerPenalty крутит на −rotationY блокера, а он равен −yaw.
                Theta = yaw
            };
        }

        private static Vector3 TileToUnity(int tx, int tz, int w, int d)
        {
            return new Vector3((tx - w / 2f + 0.5f) * Tile, 0f, -((tz - d / 2f + 0.5f) * Tile));
        }

        private static void AddGroundAndMarkers(LocationDefinition zone)
        {
            // Та же земля, что строит загрузчик локации; свет — из сцены по умолчанию.
            new GameObject("Ground").AddComponent<RoaLocalTerrain>().Initialize(zone, null);
            int w = zone.TileWidth, d = zone.TileDepth;
            foreach (LocationTransition row in zone.Transitions)
            {
                GameObject marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                marker.transform.position = TileToUnity(row.Tx, row.Tz, w, d) + Vector3.up * 0.05f;
                marker.transform.localScale = new Vector3(6f, 0.05f, 6f);
                Paint(marker, string.Equals(row.Type, "zoneGate", StringComparison.Ordinal) ? new Color(0.2f, 0.75f, 0.35f) : new Color(0.55f, 0.3f, 0.8f));
            }
        }

        private static void Paint(GameObject target, Color color)
        {
            Renderer renderer = target.GetComponent<Renderer>();
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            if (renderer == null || shader == null) return;
            var material = new Material(shader) { color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            renderer.sharedMaterial = material;
        }


        private static void Capture(string file, Vector3 position, Quaternion rotation, bool orthographic, float size, int pixels,
                                    RoaZoneGroundCover cover, float fieldOfView = 55f, int coverRadius = 1)
        {
            var go = new GameObject("ProbeCamera");
            Camera camera = go.AddComponent<Camera>();
            camera.transform.SetPositionAndRotation(position, rotation);
            camera.orthographic = orthographic;
            if (orthographic) camera.orthographicSize = size;
            else camera.fieldOfView = fieldOfView;
            camera.nearClipPlane = 0.3f;
            camera.farClipPlane = 1200f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.72f, 0.7f, 0.64f);
            var target = new RenderTexture(pixels, pixels, 24, RenderTextureFormat.ARGB32);
            camera.targetTexture = target;
            cover?.ShowAround(cover.Focus(camera), coverRadius);
            camera.Render();
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = target;
            var image = new Texture2D(pixels, pixels, TextureFormat.RGB24, false);
            image.ReadPixels(new Rect(0, 0, pixels, pixels), 0, 0);
            image.Apply();
            RenderTexture.active = previous;
            File.WriteAllBytes(file, image.EncodeToPNG());
            camera.targetTexture = null;
            UnityEngine.Object.DestroyImmediate(target);
            UnityEngine.Object.DestroyImmediate(image);
            UnityEngine.Object.DestroyImmediate(go);
        }

        private static void Drain(IEnumerator routine)
        {
            var stack = new Stack<IEnumerator>();
            stack.Push(routine);
            int guard = 0;
            while (stack.Count > 0 && guard++ < 100000)
            {
                IEnumerator top = stack.Peek();
                if (!top.MoveNext()) { stack.Pop(); continue; }
                if (top.Current is IEnumerator nested) stack.Push(nested);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
