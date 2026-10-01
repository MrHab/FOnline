using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Собирает площадку места (аванпост, точку добычи, кланбазу) прямо в сцене сектора по
    /// макету архитектора (`roa.siteLayout.v1`, data/kromka/site-layouts/&lt;id&gt;.json):
    /// снимает содержимое сектора под площадкой, ставит модели PolygonApocalypse в
    /// авторском масштабе, режет их меш-коллайдеры на высоте тела в коробки (их видит и
    /// сервер, и tools/check-kromka-collision-parity.js), ставит маркер площадки и якоря
    /// НПС, сохраняет сцену, экспортирует её в data и снимает кадры для критика.
    ///
    /// Каждый объект — узел с маркером, внутри «Collision» с BoxCollider и «Visual» —
    /// префаб пака с выключенными коллайдерами. Повторная сборка сносит прежний узел
    /// площадки целиком, поэтому макет можно править и собирать сколько угодно раз.
    ///
    /// Пакетно: -executeMethod Kromka.EditorTools.KromkaSiteBuilder.RunBatch -quit
    /// ROA_SITE_LAYOUT — путь к макету, ROA_SITE_OUT — папка кадров и отчёта
    /// (по умолчанию renders рядом с макетом), ROA_SITE_CAPTURE=0 — без кадров.
    /// </summary>
    public static class KromkaSiteBuilder
    {
        private const string PrefabRoot = "Assets/Synty/PolygonApocalypse/Prefabs";
        private const float BandBottom = 0.2f;
        private const float BandTop = 1.75f;
        private const float SliceCell = 0.25f;
        private const int MaxBoxesPerObject = 48;
        private const int SliceLayer = 31;
        private static readonly Vector3 SliceOrigin = new Vector3(6000f, 0f, 6000f);
        private const string CacheVersion = "site-slice-v1";

        private sealed class Box
        {
            public Vector3 Center;
            public Vector3 Size;
        }

        private static readonly Dictionary<string, List<Box>> SliceCache = new Dictionary<string, List<Box>>();
        private static Dictionary<string, string> _prefabPaths;

        [MenuItem("Кромка/Авторинг/Собрать площадку места по макету…")]
        public static void BuildFromMenu()
        {
            string path = EditorUtility.OpenFilePanel("Макет площадки", Path.Combine(ProjectRoot(), "data/kromka/site-layouts"), "json");
            if (string.IsNullOrEmpty(path)) return;
            Build(path, Path.Combine(ProjectRoot(), "Build/sites", Path.GetFileNameWithoutExtension(path), "renders"), true);
        }

        public static void RunBatch()
        {
            string layout = Environment.GetEnvironmentVariable("ROA_SITE_LAYOUT");
            if (string.IsNullOrWhiteSpace(layout) || !File.Exists(layout))
                throw new FileNotFoundException("ROA_SITE_LAYOUT: нет макета площадки", layout ?? "");
            string output = Environment.GetEnvironmentVariable("ROA_SITE_OUT");
            if (string.IsNullOrWhiteSpace(output))
                output = Path.Combine(ProjectRoot(), "Build/sites", Path.GetFileNameWithoutExtension(layout), "renders");
            bool capture = Environment.GetEnvironmentVariable("ROA_SITE_CAPTURE") != "0";
            if (Environment.GetEnvironmentVariable("ROA_SITE_PREVIEW") == "1") Preview(layout, output);
            else Build(layout, output, capture);
        }

        private static void Build(string layoutPath, string outputDir, bool capture)
        {
            JObject layout = JObject.Parse(File.ReadAllText(layoutPath));
            if (Text(layout, "schema") != "roa.siteLayout.v1")
                throw new InvalidOperationException("Макет не roa.siteLayout.v1: " + layoutPath);
            JObject siteRow = layout["site"] as JObject ?? throw new InvalidOperationException("В макете нет site");
            string siteId = Text(siteRow, "id");
            string zoneId = Text(siteRow, "zone");
            if (string.IsNullOrWhiteSpace(siteId) || !KromkaLocationSceneCatalog.IsZoneId(zoneId))
                throw new InvalidOperationException("site.id и site.zone (z_CC_RR) обязательны");
            Vector3 center = new Vector3(Num(siteRow["center"]?["x"]), 0f, Num(siteRow["center"]?["z"]));
            float yaw = Num(siteRow["rotationY"]);
            var size = new Vector2(Num(siteRow["size"]?["x"], 30f), Num(siteRow["size"]?["z"], 30f));
            float clearMargin = Num(layout["clear"]?["margin"], 6f);
            Quaternion siteRotation = Quaternion.Euler(0f, yaw, 0f);

            string scenePath = KromkaLocationSceneCatalog.ScenePath(zoneId);
            if (scenePath == null || AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null)
                throw new FileNotFoundException("Нет сцены сектора " + zoneId, scenePath ?? zoneId);
            Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            KromkaLocationAuthoring location = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<KromkaLocationAuthoring>(true)).FirstOrDefault()
                ?? throw new InvalidOperationException("В сцене " + zoneId + " нет KromkaLocationAuthoring");
            Transform staticContent = location.transform.Find("StaticContent_EDITABLE") ?? location.transform;
            Transform anchors = location.transform.Find("DynamicAnchors_EDITABLE") ?? location.transform;

            var report = new JObject
            {
                ["site"] = siteId,
                ["zone"] = zoneId,
                ["builtAt"] = DateTime.UtcNow.ToString("o")
            };

            // Прежняя сборка этой площадки уходит целиком — со своими якорями НПС.
            foreach (KromkaSiteAuthoring old in location.GetComponentsInChildren<KromkaSiteAuthoring>(true))
                if (old != null && old.SiteId == siteId) UnityEngine.Object.DestroyImmediate(old.gameObject);
            string anchorPrefix = "SiteAnchor_" + siteId + "_";
            foreach (Transform child in anchors.Cast<Transform>().ToArray())
                if (child.name.StartsWith(anchorPrefix, StringComparison.Ordinal)) UnityEngine.Object.DestroyImmediate(child.gameObject);

            // Под площадкой и в полосе вокруг неё сектор расчищается: кусты, камни и остовы
            // конструктора зоны не должны торчать сквозь ограду.
            var removed = new JArray();
            foreach (KromkaPlacedObjectAuthoring marker in location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if (marker == null || marker.Role == "terrain") continue;
                if (!Inside(marker.transform.position, center, yaw, size, clearMargin)) continue;
                removed.Add(marker.StableObjectId);
                UnityEngine.Object.DestroyImmediate(marker.gameObject);
            }
            // Точечная расчистка за пределами полосы (камень-засада у выхода): clear.points в осях площадки.
            foreach (JObject point in (layout["clear"]?["points"] as JArray ?? new JArray()).OfType<JObject>())
            {
                Vector3 spot = center + siteRotation * new Vector3(Num(point["x"]), 0f, Num(point["z"]));
                float radius = Num(point["r"], 2f);
                foreach (KromkaPlacedObjectAuthoring marker in location.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                {
                    if (marker == null || marker.Role == "terrain") continue;
                    Vector3 at = marker.transform.position;
                    if (new Vector2(at.x - spot.x, at.z - spot.z).magnitude > radius) continue;
                    removed.Add(marker.StableObjectId);
                    UnityEngine.Object.DestroyImmediate(marker.gameObject);
                }
            }
            report["removedZoneObjects"] = removed;

            var siteObject = new GameObject("Site_" + siteId);
            siteObject.transform.SetParent(staticContent, false);
            siteObject.transform.SetPositionAndRotation(center, siteRotation);
            siteObject.AddComponent<KromkaSiteAuthoring>().Configure(siteId, Text(siteRow, "name"), Text(siteRow, "kind"),
                siteRow["safe"]?.Value<bool>() == true, size);

            var ids = new HashSet<string>(StringComparer.Ordinal);
            var unresolved = new JArray();
            var built = new JArray();
            int blocking = 0, boxes = 0;
            foreach (JObject row in (layout["objects"] as JArray ?? new JArray()).OfType<JObject>())
            {
                string localId = Text(row, "id");
                string prefabName = Text(row, "prefab");
                if (string.IsNullOrWhiteSpace(localId) || string.IsNullOrWhiteSpace(prefabName))
                    throw new InvalidOperationException("Объект макета без id или prefab: " + row.ToString(Formatting.None));
                string objectId = StableId(siteId, localId);
                if (!ids.Add(objectId)) throw new InvalidOperationException("Повтор id объекта: " + objectId);
                string prefabPath = ResolvePrefab(prefabName);
                GameObject asset = prefabPath == null ? null : AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                if (asset == null)
                {
                    unresolved.Add(prefabName);
                    continue;
                }

                var local = new Vector3(Num(row["x"]), Num(row["y"]), Num(row["z"]));
                var holder = new GameObject(objectId);
                holder.transform.SetParent(siteObject.transform, false);
                holder.transform.SetPositionAndRotation(center + siteRotation * local,
                    siteRotation * Quaternion.Euler(0f, Num(row["rotY"]), 0f));

                var visual = (GameObject)PrefabUtility.InstantiatePrefab(asset, scene);
                visual.transform.SetParent(holder.transform, false);
                visual.transform.localPosition = Vector3.zero;
                visual.transform.localRotation = Quaternion.identity;
                visual.name = "Visual";
                foreach (Collider collider in visual.GetComponentsInChildren<Collider>(true))
                {
                    collider.enabled = false;
                    PrefabUtility.RecordPrefabInstancePropertyModifications(collider);
                }

                string collisionMode = Text(row, "collision");
                // Поднятый объект (мешки на контейнере, лоток на насыпи) режется на своей высоте.
                List<Box> shapes = collisionMode == "none" ? new List<Box>() : Slice(prefabPath, asset, local.y);
                if (shapes.Count > 0)
                {
                    var collision = new GameObject("Collision");
                    collision.transform.SetParent(holder.transform, false);
                    foreach (Box shape in shapes)
                    {
                        BoxCollider box = collision.AddComponent<BoxCollider>();
                        box.center = shape.Center;
                        box.size = shape.Size;
                    }
                    blocking++;
                    boxes += shapes.Count;
                }

                float height = RendererTop(visual) - holder.transform.position.y;
                string vision = Text(row, "vision");
                if (string.IsNullOrWhiteSpace(vision) || vision == "auto")
                    vision = shapes.Count == 0 ? "none" : height >= 1.8f ? "block" : height >= 0.5f ? "cover" : "none";
                if (shapes.Count == 0) vision = "none";
                string role = string.IsNullOrWhiteSpace(Text(row, "role")) ? "structure" : Text(row, "role");
                string[] tags = (row["tags"] as JArray ?? new JArray()).Select(tag => tag.ToString())
                    .Concat(new[] { "site", "site-" + siteId }).Distinct().ToArray();
                holder.AddComponent<KromkaPlacedObjectAuthoring>().Configure(objectId, string.Empty, role, tags,
                    false, shapes.Count > 0, vision == "block", vision == "cover");
                holder.AddComponent<RoaUnityLocationObject>().Configure(objectId);
                built.Add(new JObject
                {
                    ["id"] = objectId, ["prefab"] = prefabName, ["boxes"] = shapes.Count,
                    ["height"] = Math.Round(height, 2), ["vision"] = vision
                });
            }
            report["objects"] = built;
            report["unresolvedPrefabs"] = unresolved;
            report["blockingObjects"] = blocking;
            report["collisionBoxes"] = boxes;
            if (unresolved.Count > 0)
                Debug.LogWarning("[KROMKA SITE] Нет префабов пака: " + string.Join(", ", unresolved.Select(v => v.ToString())));

            // НПС площадки: живые строки пишет tools/site-apply.js, в сцене они — префабы KromkaNpc
            // (их требует проверка паритета и по ним экспорт ставит строку). Прежние НПС этой
            // площадки уходят, на местах из макета встают якоря, а KromkaNpcSceneSync
            // превращает их в префабы с обликом и снаряжением из строк.
            var npcIds = new HashSet<string>((layout["npcs"] as JArray ?? new JArray()).OfType<JObject>()
                .Select(npc => Text(npc, "id")).Where(id => !string.IsNullOrWhiteSpace(id)), StringComparer.Ordinal);
            foreach (KromkaSpawnAuthoring spawn in location.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
                if (spawn != null && npcIds.Contains(spawn.SpawnId)) UnityEngine.Object.DestroyImmediate(spawn.gameObject);
            foreach (JObject npc in (layout["npcs"] as JArray ?? new JArray()).OfType<JObject>())
            {
                string npcId = Text(npc, "id");
                if (string.IsNullOrWhiteSpace(npcId)) continue;
                var anchor = new GameObject(anchorPrefix + npcId);
                anchor.transform.SetParent(anchors, false);
                var local = new Vector3(Num(npc["x"]), 0.1f, Num(npc["z"]));
                anchor.transform.SetPositionAndRotation(center + siteRotation * local,
                    siteRotation * Quaternion.Euler(0f, Num(npc["rotY"]), 0f));
                anchor.AddComponent<KromkaSpawnAuthoring>().Configure(npcId, KromkaSpawnKind.Npc, string.Empty, 1f);
            }
            string zoneFile = Path.Combine(ProjectRoot(), "data", "zones", "authored", zoneId + ".json");
            if (npcIds.Count > 0)
                RealmOfAshes.EditorTools.KromkaNpcSceneSync.SyncScene(scene, JObject.Parse(File.ReadAllText(zoneFile)));

            EditorSceneManager.MarkSceneDirty(scene);
            if (!EditorSceneManager.SaveScene(scene)) throw new InvalidOperationException("Не удалось сохранить " + scenePath);
            KromkaWorldSceneExporter.ExportLocationScene(scene);
            AssetDatabase.Refresh();

            Directory.CreateDirectory(outputDir);
            if (capture) report["captures"] = Capture(scene, layout, center, yaw, size, outputDir);
            File.WriteAllText(Path.Combine(outputDir, "build-report.json"), report.ToString(Formatting.Indented));
            // Кадры ставили в сцену свет и подписи; сцена уже сохранена, поэтому она закрывается без них.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            Debug.Log("[KROMKA SITE] PASS: " + siteId + " в " + zoneId + ": " + built.Count + " объектов, "
                      + blocking + " преград, " + boxes + " коробок, снято с сектора " + removed.Count
                      + ", не найдено префабов " + unresolved.Count + ". Отчёт: " + outputDir);
        }

        /// <summary>
        /// Снимок сектора вокруг будущей площадки без единой правки сцены: что сейчас стоит
        /// рядом, где ворота и остовы. Вход архитектора перед первым макетом.
        /// </summary>
        private static void Preview(string layoutPath, string outputDir)
        {
            JObject layout = JObject.Parse(File.ReadAllText(layoutPath));
            JObject siteRow = layout["site"] as JObject ?? throw new InvalidOperationException("В макете нет site");
            string zoneId = Text(siteRow, "zone");
            Vector3 center = new Vector3(Num(siteRow["center"]?["x"]), 0f, Num(siteRow["center"]?["z"]));
            float yaw = Num(siteRow["rotationY"]);
            var size = new Vector2(Num(siteRow["size"]?["x"], 30f), Num(siteRow["size"]?["z"], 30f));
            Scene scene = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(zoneId), OpenSceneMode.Single);
            Directory.CreateDirectory(outputDir);
            var helpers = new List<GameObject>();
            string shot;
            Action restore = CaptureLighting(scene, helpers);
            try
            {
                float extent = Mathf.Max(size.x, size.y) * 0.5f + 40f;
                helpers.AddRange(Frame(center, yaw, size, extent, true));
                Camera camera = CaptureCamera(helpers);
                camera.orthographic = true;
                camera.orthographicSize = extent;
                camera.transform.SetPositionAndRotation(center + Vector3.up * 200f, Quaternion.Euler(90f, yaw, 0f));
                shot = Shot(camera, outputDir, "context-top", 1400, 1400);
            }
            finally
            {
                restore();
                foreach (GameObject helper in helpers)
                    if (helper != null) UnityEngine.Object.DestroyImmediate(helper);
            }
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            Debug.Log("[KROMKA SITE] PASS: предпросмотр " + zoneId + " без правок сцены: " + shot);
        }

        // ---------------------------------------------------------------- collision

        /// <summary>
        /// Коллизия префаба на высоте тела: его коллайдеры (часто меш) проверяются сеткой
        /// коробок 25 см, занятые клетки сливаются в прямоугольники. Результат — в осях префаба.
        /// lift — на сколько объект поднят над землёй: полоса тела в осях префаба сдвигается вниз.
        /// </summary>
        private static List<Box> Slice(string prefabPath, GameObject asset, float lift)
        {
            lift = Mathf.Round(lift * 100f) / 100f;
            string key = Mathf.Abs(lift) < 0.005f ? prefabPath : prefabPath + "@" + lift.ToString("0.00", CultureInfo.InvariantCulture);
            float bandBottom = BandBottom - lift, bandTop = BandTop - lift;
            if (SliceCache.TryGetValue(key, out List<Box> cached)) return cached;
            List<Box> result = LoadCachedSlice(key);
            if (result != null)
            {
                SliceCache[key] = result;
                return result;
            }
            result = new List<Box>();
            var temp = (GameObject)PrefabUtility.InstantiatePrefab(asset);
            try
            {
                temp.transform.SetPositionAndRotation(SliceOrigin, Quaternion.identity);
                foreach (Transform part in temp.GetComponentsInChildren<Transform>(true)) part.gameObject.layer = SliceLayer;
                Collider[] colliders = temp.GetComponentsInChildren<Collider>(true)
                    .Where(c => c.enabled && !c.isTrigger && c.gameObject.activeInHierarchy).ToArray();
                if (colliders.Length > 0)
                {
                    Physics.SyncTransforms();
                    Bounds bounds = colliders[0].bounds;
                    foreach (Collider collider in colliders.Skip(1)) bounds.Encapsulate(collider.bounds);
                    float bottom = bounds.min.y - SliceOrigin.y;
                    float top = bounds.max.y - SliceOrigin.y;
                    if (top > bandBottom && bottom < bandTop)
                    {
                        result = SliceAt(bounds, SliceCell, bandBottom, bandTop);
                        if (result.Count > MaxBoxesPerObject) result = SliceAt(bounds, SliceCell * 2f, bandBottom, bandTop);
                    }
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(temp);
            }
            SliceCache[key] = result;
            SaveCachedSlice(key, result);
            return result;
        }

        private static List<Box> SliceAt(Bounds bounds, float cell, float bandBottom, float bandTop)
        {
            int nx = Mathf.Max(1, Mathf.CeilToInt(bounds.size.x / cell));
            int nz = Mathf.Max(1, Mathf.CeilToInt(bounds.size.z / cell));
            float minX = bounds.center.x - nx * cell * 0.5f;
            float minZ = bounds.center.z - nz * cell * 0.5f;
            var occupied = new bool[nx, nz];
            var half = new Vector3(cell * 0.49f, (bandTop - bandBottom) * 0.5f, cell * 0.49f);
            float midY = SliceOrigin.y + (bandBottom + bandTop) * 0.5f;
            int mask = 1 << SliceLayer;
            for (int i = 0; i < nx; i++)
            for (int j = 0; j < nz; j++)
                occupied[i, j] = Physics.CheckBox(new Vector3(minX + (i + 0.5f) * cell, midY, minZ + (j + 0.5f) * cell),
                    half, Quaternion.identity, mask, QueryTriggerInteraction.Ignore);

            var used = new bool[nx, nz];
            var boxes = new List<Box>();
            for (int j = 0; j < nz; j++)
            for (int i = 0; i < nx; i++)
            {
                if (!occupied[i, j] || used[i, j]) continue;
                int w = 1;
                while (i + w < nx && occupied[i + w, j] && !used[i + w, j]) w++;
                int h = 1;
                bool grow = true;
                while (grow && j + h < nz)
                {
                    for (int k = 0; k < w; k++)
                        if (!occupied[i + k, j + h] || used[i + k, j + h]) { grow = false; break; }
                    if (grow) h++;
                }
                for (int a = 0; a < w; a++)
                for (int b = 0; b < h; b++) used[i + a, j + b] = true;
                boxes.Add(new Box
                {
                    Center = new Vector3(minX + (i + w * 0.5f) * cell - SliceOrigin.x, (bandBottom + bandTop) * 0.5f,
                        minZ + (j + h * 0.5f) * cell - SliceOrigin.z),
                    Size = new Vector3(w * cell, bandTop - bandBottom, h * cell)
                });
            }
            return boxes;
        }

        private static string SliceCachePath() =>
            Path.Combine(ProjectRoot(), "unity-client", "Library", "SiteBuilder", "slice-cache.json");

        private static List<Box> LoadCachedSlice(string prefabPath)
        {
            string path = SliceCachePath();
            if (!File.Exists(path)) return null;
            JObject cache = JObject.Parse(File.ReadAllText(path));
            if (Text(cache, "version") != CacheVersion) return null;
            if (!(cache["prefabs"]?[prefabPath] is JArray rows)) return null;
            return rows.OfType<JObject>().Select(row => new Box
            {
                Center = new Vector3(Num(row["cx"]), Num(row["cy"]), Num(row["cz"])),
                Size = new Vector3(Num(row["sx"]), Num(row["sy"]), Num(row["sz"]))
            }).ToList();
        }

        private static void SaveCachedSlice(string prefabPath, List<Box> boxes)
        {
            string path = SliceCachePath();
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            JObject cache = File.Exists(path) ? JObject.Parse(File.ReadAllText(path)) : new JObject();
            if (Text(cache, "version") != CacheVersion) cache = new JObject { ["version"] = CacheVersion, ["prefabs"] = new JObject() };
            ((JObject)cache["prefabs"])[prefabPath] = new JArray(boxes.Select(box => new JObject
            {
                ["cx"] = Math.Round(box.Center.x, 3), ["cy"] = Math.Round(box.Center.y, 3), ["cz"] = Math.Round(box.Center.z, 3),
                ["sx"] = Math.Round(box.Size.x, 3), ["sy"] = Math.Round(box.Size.y, 3), ["sz"] = Math.Round(box.Size.z, 3)
            }));
            File.WriteAllText(path, cache.ToString(Formatting.None));
        }

        // ---------------------------------------------------------------- captures

        private static JArray Capture(Scene scene, JObject layout, Vector3 center, float yaw, Vector2 size, string outputDir)
        {
            var shots = new JArray();
            var helpers = new List<GameObject>();
            Action restore = CaptureLighting(scene, helpers);
            try
            {
                Quaternion rotation = Quaternion.Euler(0f, yaw, 0f);
                // Граница площадки — белая рамка, сетка через 5 м в осях площадки с подписями.
                float extent = Mathf.Max(size.x, size.y) * 0.5f + 16f;
                List<GameObject> frame = Frame(center, yaw, size, extent, true);
                helpers.AddRange(frame);
                List<GameObject> gridBars = frame.Where(item => item.name != "SiteCaptureBorder").ToList();
                Camera camera = CaptureCamera(helpers);

                // Сверху: север площадки (её +Z) вверху кадра.
                camera.orthographic = true;
                camera.orthographicSize = extent;
                camera.transform.SetPositionAndRotation(center + Vector3.up * 200f, Quaternion.Euler(90f, yaw, 0f));
                shots.Add(Shot(camera, outputDir, "top", 1400, 1400));
                foreach (GameObject bar in gridBars) bar.SetActive(false);

                // Игровая камера: наклон 55°, поворот 45°, FOV 52, дистанция до 21,5 м (RoaCameraRig).
                camera.orthographic = false;
                var views = new List<(string name, Vector3 target, float distance, float fov)>
                {
                    ("game-center", center, 21.5f, 52f),
                    ("game-wide", center, 46f, 60f)
                };
                foreach (JObject view in (layout["viewpoints"] as JArray ?? new JArray()).OfType<JObject>().Take(6))
                {
                    string name = "game-" + SafeName(Text(view, "label"), views.Count);
                    views.Add((name, center + rotation * new Vector3(Num(view["x"]), 0f, Num(view["z"])), Num(view["distance"], 16f), 52f));
                }
                foreach (var view in views)
                {
                    camera.fieldOfView = view.fov;
                    Quaternion look = Quaternion.Euler(55f, 45f, 0f);
                    camera.transform.SetPositionAndRotation(view.target + Vector3.up * 1f - look * Vector3.forward * view.distance, look);
                    shots.Add(Shot(camera, outputDir, view.name, 1280, 720));
                }
                camera.fieldOfView = 52f;
                Quaternion mobileLook = Quaternion.Euler(55f, 45f, 0f);
                camera.transform.SetPositionAndRotation(center + Vector3.up - mobileLook * Vector3.forward * 21.5f, mobileLook);
                shots.Add(Shot(camera, outputDir, "mobile-center", 844, 390));
            }
            finally
            {
                restore();
                foreach (GameObject helper in helpers)
                    if (helper != null) UnityEngine.Object.DestroyImmediate(helper);
            }
            return shots;
        }

        /// <summary>Белая рамка площадки и (grid) сетка через 5 м в её осях с подписями через 10 м.</summary>
        private static List<GameObject> Frame(Vector3 center, float yaw, Vector2 size, float extent, bool grid)
        {
            var items = new List<GameObject>();
            Material line = Unlit(new Color(0.95f, 0.95f, 0.9f));
            Material dark = Unlit(new Color(0.12f, 0.12f, 0.12f));
            Quaternion rotation = Quaternion.Euler(0f, yaw, 0f);
            float hx = size.x * 0.5f, hz = size.y * 0.5f;
            var edges = new[]
            {
                (new Vector3(0f, 0.04f, hz), new Vector3(size.x, 0.06f, 0.3f)),
                (new Vector3(0f, 0.04f, -hz), new Vector3(size.x, 0.06f, 0.3f)),
                (new Vector3(hx, 0.04f, 0f), new Vector3(0.3f, 0.06f, size.y)),
                (new Vector3(-hx, 0.04f, 0f), new Vector3(0.3f, 0.06f, size.y))
            };
            foreach ((Vector3 offset, Vector3 scale) in edges)
            {
                GameObject border = Bar(center + rotation * offset, rotation, scale, line);
                border.name = "SiteCaptureBorder";
                items.Add(border);
            }
            if (!grid) return items;
            int steps = Mathf.CeilToInt(extent / 5f);
            for (int k = -steps; k <= steps; k++)
            {
                float offset = k * 5f;
                float width = k == 0 ? 0.16f : 0.08f;
                items.Add(Bar(center + rotation * new Vector3(offset, 0.02f, 0f), rotation, new Vector3(width, 0.02f, extent * 2f), dark));
                items.Add(Bar(center + rotation * new Vector3(0f, 0.02f, offset), rotation, new Vector3(extent * 2f, 0.02f, width), dark));
                if (k % 2 != 0) continue;
                string text = offset.ToString("0", CultureInfo.InvariantCulture);
                items.Add(Label(center + rotation * new Vector3(offset, 0.3f, -extent + 1.2f), yaw, text));
                items.Add(Label(center + rotation * new Vector3(-extent + 1.2f, 0.3f, offset), yaw, text));
            }
            return items;
        }

        /// <summary>
        /// Свет кадра: в редакторе сектор освещён тускло и земля тёмная, а критик должен
        /// читать силуэты. Свет сцены выключается, ставится своё солнце с тенями, ровный
        /// рассеянный свет и светлая земля. Возвращает откат (сцена после кадров не сохраняется).
        /// </summary>
        private static Action CaptureLighting(Scene scene, List<GameObject> helpers)
        {
            Light[] lights = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)
                .Where(light => light.enabled).ToArray();
            foreach (Light light in lights) light.enabled = false;
            // Огонь, дым и туман пака — частицы: в редакторе они не идут сами, и без прогрева
            // критик не видел бы их на кадрах.
            foreach (ParticleSystem system in UnityEngine.Object.FindObjectsByType<ParticleSystem>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                system.Simulate(4f, false, true, true);
            UnityEngine.Rendering.AmbientMode mode = RenderSettings.ambientMode;
            Color ambient = RenderSettings.ambientLight;
            UnityEngine.Rendering.SphericalHarmonicsL2 probe = RenderSettings.ambientProbe;
            bool fog = RenderSettings.fog;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.46f, 0.44f, 0.41f);
            var flat = new UnityEngine.Rendering.SphericalHarmonicsL2();
            flat.AddAmbientLight(RenderSettings.ambientLight);
            RenderSettings.ambientProbe = flat;
            RenderSettings.fog = false;

            var sunObject = new GameObject("SiteCaptureSun");
            helpers.Add(sunObject);
            Light sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.25f;
            sun.color = new Color(1f, 0.96f, 0.88f);
            sun.shadows = LightShadows.Soft;
            sunObject.transform.rotation = Quaternion.Euler(52f, -35f, 0f);

            var grounds = new List<(Renderer renderer, Material material)>();
            Material soil = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
            if (soil.HasProperty("_BaseColor")) soil.SetColor("_BaseColor", new Color(0.60f, 0.55f, 0.46f));
            foreach (GameObject root in scene.GetRootGameObjects())
            foreach (KromkaPlacedObjectAuthoring terrain in root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if (terrain.Role != "terrain") continue;
                foreach (Renderer renderer in terrain.GetComponentsInChildren<Renderer>(true))
                {
                    grounds.Add((renderer, renderer.sharedMaterial));
                    renderer.sharedMaterial = soil;
                }
            }
            return () =>
            {
                foreach (Light light in lights) if (light != null) light.enabled = true;
                RenderSettings.ambientMode = mode;
                RenderSettings.ambientLight = ambient;
                RenderSettings.ambientProbe = probe;
                RenderSettings.fog = fog;
                foreach ((Renderer renderer, Material material) in grounds)
                    if (renderer != null) renderer.sharedMaterial = material;
            };
        }

        private static Camera CaptureCamera(List<GameObject> helpers)
        {
            var cameraObject = new GameObject("SiteCaptureCamera");
            helpers.Add(cameraObject);
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.42f, 0.44f, 0.46f);
            camera.farClipPlane = 1500f;
            return camera;
        }

        private static string Shot(Camera camera, string outputDir, string name, int width, int height)
        {
            string file = Path.Combine(outputDir, name + ".png");
            camera.aspect = (float)width / height;
            KromkaSceneShot.Capture(camera, file, width, height);
            return Path.GetFileName(file);
        }

        private static GameObject Bar(Vector3 position, Quaternion rotation, Vector3 scale, Material material)
        {
            GameObject bar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            bar.name = "SiteCaptureHelper";
            UnityEngine.Object.DestroyImmediate(bar.GetComponent<Collider>());
            bar.transform.SetPositionAndRotation(position, rotation);
            bar.transform.localScale = scale;
            bar.GetComponent<Renderer>().sharedMaterial = material;
            return bar;
        }

        private static GameObject Label(Vector3 position, float yaw, string text)
        {
            var label = new GameObject("SiteCaptureLabel");
            TextMesh mesh = label.AddComponent<TextMesh>();
            mesh.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            label.GetComponent<MeshRenderer>().sharedMaterial = mesh.font.material;
            mesh.text = text;
            mesh.fontSize = 48;
            mesh.characterSize = 0.28f;
            mesh.anchor = TextAnchor.MiddleCenter;
            mesh.color = Color.black;
            label.transform.SetPositionAndRotation(position, Quaternion.Euler(90f, yaw, 0f));
            return label;
        }

        private static Material Unlit(Color color)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            var material = new Material(shader);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            return material;
        }

        // ---------------------------------------------------------------- helpers

        private static bool Inside(Vector3 point, Vector3 center, float yawDeg, Vector2 size, float margin)
        {
            Vector3 local = Quaternion.Euler(0f, -yawDeg, 0f) * (point - center);
            return Mathf.Abs(local.x) <= size.x * 0.5f + margin && Mathf.Abs(local.z) <= size.y * 0.5f + margin;
        }

        private static float RendererTop(GameObject root)
        {
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true).Where(r => r.enabled).ToArray();
            if (renderers.Length == 0) return root.transform.position.y;
            return renderers.Max(r => r.bounds.max.y);
        }

        private static string ResolvePrefab(string name)
        {
            if (_prefabPaths == null)
            {
                _prefabPaths = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (string guid in AssetDatabase.FindAssets("t:Prefab", new[] { PrefabRoot }))
                {
                    string path = AssetDatabase.GUIDToAssetPath(guid);
                    string key = Path.GetFileNameWithoutExtension(path);
                    if (!_prefabPaths.ContainsKey(key)) _prefabPaths[key] = path;
                }
            }
            string trimmed = name.Trim();
            if (_prefabPaths.TryGetValue(trimmed, out string found)) return found;
            if (!trimmed.StartsWith("SM_", StringComparison.Ordinal) && _prefabPaths.TryGetValue("SM_" + trimmed, out found)) return found;
            return null;
        }

        private static string StableId(string siteId, string localId)
        {
            string clean = new string(localId.Where(ch => char.IsLetterOrDigit(ch) || ch == '_' || ch == '-').ToArray());
            string id = siteId + "_" + clean;
            return id.Length <= 96 ? id : id.Substring(0, 96);
        }

        private static string SafeName(string label, int index)
        {
            string clean = new string((label ?? string.Empty).Where(ch => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-').ToArray());
            return string.IsNullOrEmpty(clean) ? "view" + index : clean;
        }

        private static string ProjectRoot() => Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));

        private static string Text(JToken token, string key) => token?[key]?.ToString() ?? string.Empty;

        private static float Num(JToken token, float fallback = 0f)
        {
            if (token == null || token.Type == JTokenType.Null) return fallback;
            // Число JSON читается как число: ToString() дробного токена берёт культуру системы
            // («-22,755» в русской), и разбор по инвариантной культуре тихо давал 0.
            if (token.Type == JTokenType.Float || token.Type == JTokenType.Integer) return token.Value<float>();
            return float.TryParse((string)token, NumberStyles.Float, CultureInfo.InvariantCulture, out float value) ? value : fallback;
        }
    }
}
