#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Kromka;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// 3D-карта мира против графа зон. Сцена KromkaGlobalMap и граф зон собраны из одной
    /// географии, и сетка зон ложится на рельеф только если каждое место сцены стоит в
    /// своей зоне графа: проба сверяет якорь каждого места (RoaGlobalMapNodeAnchor) с
    /// клеткой зоны в data/kromka/zone-graph.json. Потом строит сетку зон, путь от Ключей
    /// до Лома и снимает карту сверху, вблизи и по пути — кадры и отчёт в ROA_WORLDMAP_PROBE_OUT.
    /// </summary>
    public static class RoaWorldMap3DProbe
    {
        [MenuItem("Realm of Ashes/Zones/Check 3D world map")]
        public static void Run()
        {
            string outDir = Environment.GetEnvironmentVariable("ROA_WORLDMAP_PROBE_OUT");
            if (string.IsNullOrEmpty(outDir)) outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Temp", "WorldMapProbe"));
            Directory.CreateDirectory(outDir);
            var report = new StringBuilder();
            try
            {
                Check(outDir, report);
                report.AppendLine("RESULT OK");
                File.WriteAllText(Path.Combine(outDir, "report.txt"), report.ToString());
                Debug.Log("[WorldMapProbe] OK\n" + report);
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                report.AppendLine("RESULT FAIL " + error.Message);
                File.WriteAllText(Path.Combine(outDir, "report.txt"), report.ToString());
                Debug.LogError("[WorldMapProbe] FAIL " + error + "\n" + report);
                if (Application.isBatchMode) EditorApplication.Exit(1);
            }
        }

        private static void Check(string outDir, StringBuilder report)
        {
            string repo = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            JObject graph = JObject.Parse(File.ReadAllText(Path.Combine(repo, "data", "kromka", "zone-graph.json")));
            JObject globalMap = JObject.Parse(File.ReadAllText(Path.Combine(repo, "data", "global-map.json")));
            float zoneKm = graph["grid"]?["zoneKm"]?.ToObject<float>() ?? 20f;
            int cols = graph["grid"]?["cols"]?.ToObject<int>() ?? 19;
            int rows = graph["grid"]?["rows"]?.ToObject<int>() ?? 15;

            Scene scene = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath, OpenSceneMode.Single);
            RoaUnityGlobalMapScene authored = null;
            foreach (GameObject top in scene.GetRootGameObjects())
            {
                authored = top.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (authored != null) break;
            }
            Require(authored != null, "the world map scene has no RoaUnityGlobalMapScene");
            var map = new GameObject("WorldMapProbe").AddComponent<RoaWorldMap3D>();
            map.SetWorldSize(cols * zoneKm, rows * zoneKm);
            map.AttachForProbe(scene, authored, false);

            // --- места сцены стоят в своих зонах графа ------------------------------------------------
            var nodeByLocation = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (JObject node in globalMap["nodes"] as JArray ?? new JArray())
                nodeByLocation[node["locationId"]?.ToString() ?? node["id"]?.ToString() ?? string.Empty] = node["id"]?.ToString() ?? string.Empty;
            var zones = new List<JObject>();
            var byId = new Dictionary<string, JObject>(StringComparer.Ordinal);
            int checkedPlaces = 0;
            var misplaced = new List<string>();
            float worst = 0f;
            foreach (JObject zone in graph["zones"] as JArray ?? new JArray())
            {
                int col = zone["col"].ToObject<int>(), row = zone["row"].ToObject<int>();
                var places = new JArray();
                foreach (JObject place in zone["places"] as JArray ?? new JArray())
                {
                    string locationId = place["locationId"]?.ToString() ?? string.Empty;
                    float u = place["u"]?.ToObject<float>() ?? 0.5f, v = place["v"]?.ToObject<float>() ?? 0.5f;
                    if (place["hidden"]?.ToObject<bool>() != true)
                        places.Add(new JObject { ["id"] = locationId, ["name"] = place["name"], ["u"] = u, ["v"] = v });
                    if (!nodeByLocation.TryGetValue(locationId, out string nodeId) || !authored.TryGetNode(nodeId, out RoaGlobalMapNodeAnchor anchor))
                    {
                        misplaced.Add(locationId + ": no anchor in the scene");
                        continue;
                    }
                    Vector2 point = map.LocalToPoint(authored.transform.InverseTransformPoint(anchor.transform.position));
                    Vector2 expected = new Vector2((col + u) * zoneKm, (row + v) * zoneKm);
                    float error = (point - expected).magnitude;
                    worst = Mathf.Max(worst, error);
                    checkedPlaces += 1;
                    if (Mathf.FloorToInt(point.x / zoneKm) != col || Mathf.FloorToInt(point.y / zoneKm) != row)
                        misplaced.Add($"{locationId}: scene point {point.x:0.0},{point.y:0.0} lies outside zone {zone["id"]} ({error:0.0} km off)");
                }
                var gates = new StringBuilder();
                foreach (var side in new[] { ("north", 'n'), ("east", 'e'), ("south", 's'), ("west", 'w') })
                    if (zone["edges"]?[side.Item1]?["open"]?.ToObject<bool>() == true) gates.Append(side.Item2);
                var row0 = new JObject
                {
                    ["id"] = zone["id"], ["n"] = zone["n"], ["col"] = col, ["row"] = row, ["title"] = zone["title"],
                    ["mode"] = zone["mode"], ["gates"] = gates.ToString(), ["places"] = places
                };
                zones.Add(row0);
                byId[zone["id"].ToString()] = row0;
            }
            report.AppendLine($"places checked {checkedPlaces}, worst offset {worst:0.00} km");
            foreach (string row in misplaced) report.AppendLine("  " + row);
            Require(misplaced.Count == 0, misplaced.Count + " places of the scene stand outside their zone of the graph");

            // --- сетка, путь, флажок и кадры ----------------------------------------------------------------
            map.ShowZones(zones, zoneKm, RoaWorldOverviewCanvas.DangerZoneColor);
            Require(map.HasZones, "the zone grid was not built");
            string keysZone = ZoneOfPlace(zones, "settlement");
            string scrapZone = ZoneOfPlace(zones, "scrapTown");
            List<JObject> path = RoaWorldMapRoute.Find(byId, keysZone, scrapZone);
            Require(path.Count > 1, "no route from Keys to Scrap Town through open gates");
            report.AppendLine($"route {keysZone} → {scrapZone}: {path.Count - 1} zones; {RoaWorldMapRoute.Hint(path, "Лом")}");
            string fromKeys = RoaWorldMapRoute.Hint(path, "Лом", "Ключи");
            Require(fromKeys.Contains("выйдите из «Ключи», затем "), "the hint from inside a place does not say to leave it first: " + fromKeys);
            map.ShowRoute(path, zoneKm);
            Vector2 keys = PlacePoint(byId[keysZone], "settlement", zoneKm);
            map.SetPlayer(keys);
            Require(map.MapCamera != null, "the map camera is missing");

            map.FocusOn(new Vector2(cols * zoneKm * 0.5f, rows * zoneKm * 0.5f), 40f);
            map.SetView(0f, 70f);
            map.CaptureTo(Path.Combine(outDir, "world-overview.png"), 1600, 900);
            map.FocusOn(keys, 9f);
            map.SetView(20f, 52f);
            map.CaptureTo(Path.Combine(outDir, "world-keys.png"), 1600, 900);
            Vector2 middle = (keys + PlacePoint(byId[scrapZone], "scrapTown", zoneKm)) * 0.5f;
            map.FocusOn(middle, 22f);
            map.SetView(0f, 62f);
            map.CaptureTo(Path.Combine(outDir, "world-route.png"), 1600, 900);
            string core = ZoneOfPlace(zones, "coreZone");
            if (!string.IsNullOrEmpty(core))
            {
                map.FocusOn(new Vector2((byId[core]["col"].ToObject<int>() + 0.5f) * zoneKm, (byId[core]["row"].ToObject<int>() + 0.5f) * zoneKm), 7f);
                map.SetView(-30f, 48f);
                map.CaptureTo(Path.Combine(outDir, "world-core.png"), 1600, 900);
            }

            // В месте (не в зоне) сервер шлёт self.zone = null: карта не должна на нём падать.
            Require(RoaWorldOverviewCanvas.SelfZoneId(JObject.Parse("{\"zone\":null}")) == string.Empty, "self.zone = null breaks the map");
            Require(RoaWorldOverviewCanvas.SelfZoneId(JObject.Parse("{\"zone\":{\"id\":\"z_09_10\"}}")) == "z_09_10", "self.zone.id is not read");

            // Клик в центр кадра попадает в рельеф, и точка — внутри мира.
            Vector3 centre = map.MapCamera.ViewportToScreenPoint(new Vector3(0.5f, 0.5f, 0f));
            Require(map.ScreenToPoint(centre, out Vector2 picked), "a click in the middle of the map does not reach the relief");
            report.AppendLine($"centre pick {picked.x:0.0},{picked.y:0.0}");
        }

        private static string ZoneOfPlace(List<JObject> zones, string locationId)
        {
            foreach (JObject zone in zones)
                foreach (JToken place in zone["places"] as JArray ?? new JArray())
                    if (place["id"]?.ToString() == locationId) return zone["id"].ToString();
            return string.Empty;
        }

        private static Vector2 PlacePoint(JObject zone, string locationId, float zoneKm)
        {
            foreach (JToken place in zone["places"] as JArray ?? new JArray())
                if (place["id"]?.ToString() == locationId)
                    return new Vector2((zone["col"].ToObject<int>() + place["u"].ToObject<float>()) * zoneKm,
                        (zone["row"].ToObject<int>() + place["v"].ToObject<float>()) * zoneKm);
            return new Vector2((zone["col"].ToObject<int>() + 0.5f) * zoneKm, (zone["row"].ToObject<int>() + 0.5f) * zoneKm);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
