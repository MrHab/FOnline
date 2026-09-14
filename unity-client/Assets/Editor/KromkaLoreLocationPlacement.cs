#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    // Explicit editor operation only. Never called from startup, runtime or terrain rebuilds.
    public static class KromkaLoreLocationPlacement
    {
        const string ScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        const string ReviewPath = "../docs/art/reviews/global-map-lore-placement-2026-09-13.json";
        const string MeshPath = "Assets/Art/Kromka/Meshes/Kromka_FuelRampAuthoredAccess.asset";
        static Vector3 World(Vector2 p) => new Vector3((p.x - 190f) * .1f, 0f, (150f - p.y) * .1f);
        static Vector2 Map(Vector3 p) => new Vector2(p.x * 10f + 190f, 150f - p.z * 10f);
        static Vector2 Point(JToken row) => new Vector2((float)row["x"], (float)row["y"]);
        static JObject Review() => JObject.Parse(File.ReadAllText(Path.GetFullPath(ReviewPath)));

        sealed class Surfaces : IDisposable
        {
            readonly List<GameObject> temporary = new List<GameObject>();
            readonly List<MeshCollider> ground = new List<MeshCollider>(), water = new List<MeshCollider>();
            public Surfaces(Scene scene)
            {
                foreach (var f in scene.GetRootGameObjects().SelectMany(r => r.GetComponentsInChildren<MeshFilter>()))
                {
                    var renderer = f.GetComponent<Renderer>();
                    if (!f.sharedMesh || !renderer || !renderer.enabled) continue;
                    bool isGround = renderer.sharedMaterials.Any(m => m && (m.name == "Kromka_GlobalTerrain_MEP"
                        || m.name == "Kromka_OuterNuclearGround_MEP"));
                    bool isWater = f.name == "CleanWater_SURFACE_MEP" || f.name == "ToxicWater_SURFACE_MEP"
                        || f.name == "KarstWater_SURFACE_MEP";
                    if (!isGround && !isWater) continue;
                    var go = new GameObject("LorePlacementSurfaceProbe") { hideFlags = HideFlags.HideAndDontSave };
                    temporary.Add(go);
                    go.transform.SetPositionAndRotation(f.transform.position, f.transform.rotation);
                    go.transform.localScale = f.transform.lossyScale;
                    var collider = go.AddComponent<MeshCollider>(); collider.sharedMesh = f.sharedMesh;
                    (isGround ? ground : water).Add(collider);
                }
                Physics.SyncTransforms();
                if (ground.Count == 0 || water.Count == 0) throw new InvalidOperationException("Missing rendered terrain/water.");
            }
            static float Height(IEnumerable<MeshCollider> surfaces, Vector3 p)
            {
                float h = float.NegativeInfinity;
                foreach (var c in surfaces)
                    if (c.Raycast(new Ray(new Vector3(p.x, 20f, p.z), Vector3.down), out var hit, 60f)) h = Mathf.Max(h, hit.point.y);
                return h;
            }
            public float DryHeight(Vector2 point, string id)
            {
                Vector3 p = World(point); float h = Height(ground, p), w = Height(water, p);
                if (float.IsInfinity(h) || !KromkaGlobalMapReliefAuthoring.ContainsMapPoint(point.x, point.y))
                    throw new InvalidOperationException(id + " has no land at " + point);
                if (w > h + .002f) throw new InvalidOperationException(id + " in water at " + point + " depth=" + (w-h));
                return h;
            }
            public void Dispose() { foreach (var go in temporary) UnityEngine.Object.DestroyImmediate(go); }
        }

        public static void InspectProposed()
        {
            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            if (!scene.isLoaded) throw new InvalidOperationException("Open the authored global scene first.");
            using (var surfaces = new Surfaces(scene))
            {
                int failures = 0;
                foreach (var row in Review()["locations"])
                {
                    try { Debug.Log("[LORE PLACEMENT] " + row["id"] + " ground=" + surfaces.DryHeight(Point(row), (string)row["id"])); }
                    catch (Exception e) { failures++; Debug.LogWarning(e.Message); }
                }
                var fuel = Review()["fuelAccess"].Select(p => new Vector2((float)p[0], (float)p[1])).ToArray();
                try { CheckAccess(surfaces, fuel); } catch (Exception e) { failures++; Debug.LogWarning(e.Message); }
                var zero = Review()["zeroAccess"].Select(p => new Vector2((float)p[0], (float)p[1])).ToArray();
                try { CheckAccess(surfaces, zero); } catch (Exception e) { failures++; Debug.LogWarning(e.Message); }
                if (failures > 0) throw new InvalidOperationException("Review has " + failures + " invalid placements; nothing changed.");
            }
        }

        static void CheckAccess(Surfaces surfaces, Vector2[] points)
        {
            for (int i = 1; i < points.Length; i++)
            {
                int steps = Mathf.CeilToInt(Vector2.Distance(points[i-1], points[i]) / .35f);
                Vector2 side = new Vector2(-(points[i]-points[i-1]).y, (points[i]-points[i-1]).x).normalized * .4f;
                float previousHeight = surfaces.DryHeight(points[i-1], "Access road");
                for (int j = 0; j <= steps; j++)
                {
                    Vector2 centre = Vector2.Lerp(points[i-1], points[i], j/(float)steps);
                    float height = surfaces.DryHeight(centre, "Access road");
                    float run = Vector2.Distance(points[i-1], points[i]) * .1f / steps;
                    if (j > 0 && Mathf.Abs(height - previousHeight) / run > .3f)
                        throw new InvalidOperationException("Access road exceeds 30% relief grade at " + centre);
                    previousHeight = height;
                    foreach (float sign in new[] { -1f, 0f, 1f })
                        surfaces.DryHeight(centre + side*sign, "Access road");
                }
            }
        }

        [MenuItem("Кромка/Авторинг/Применить лорное размещение 2026-09-13")]
        public static void Apply()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Edit Mode only.");
            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            if (!scene.isLoaded || scene.isDirty) throw new InvalidOperationException("Open a saved global scene first.");
            InspectProposed(); // Complete physical preflight before any scene edits.
            var review = Review();
            var markers = scene.GetRootGameObjects().SelectMany(r => r.GetComponentsInChildren<KromkaWorldLocationAuthoring>(true))
                .ToDictionary(m => m.StableLocationId, StringComparer.Ordinal);
            var rows = review["locations"].ToArray();
            if (rows.Length != markers.Count || rows.Any(r => !markers.ContainsKey((string)r["id"])))
                throw new InvalidOperationException("Review must cover the exact authored location ID set.");
            int moved = 0;
            using (var surfaces = new Surfaces(scene))
            {
                foreach (var row in rows)
                {
                    var marker = markers[(string)row["id"]]; Vector2 point = Point(row);
                    if (Vector2.Distance(Map(marker.transform.position), point) > .01f) moved++;
                    float ground = surfaces.DryHeight(point, marker.StableLocationId);
                    var miniature = marker.transform.Find("MapMiniature").GetComponent<Renderer>();
                    float bottom = miniature.bounds.min.y - marker.transform.position.y;
                    Undo.RecordObject(marker.transform, "Place lore location at its safe approach");
                    marker.transform.position = World(point) + Vector3.up * (ground - bottom - .002f);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(marker.transform);
                }
                var routes = scene.GetRootGameObjects().SelectMany(r => r.GetComponentsInChildren<KromkaRouteAuthoring>(true)).ToArray();
                foreach (var route in routes)
                {
                    Vector2[] points = route.RouteId == "ore_freight_rail" ? KromkaGlobalMapRouteSurfaceAuthoring.OreFreightRail
                        : route.RouteId == "tesma_service_road" ? KromkaGlobalMapRouteSurfaceAuthoring.TesmaServiceRoad
                        : route.RouteId == "zero_service_line" ? KromkaGlobalMapRouteSurfaceAuthoring.ZeroServiceLine
                        : route.RouteId == "tract_main" ? KromkaGlobalMapRouteSurfaceAuthoring.MainTract : null;
                    if (points != null) SetRoute(route, points);
                }
                Vector2[] fuel = review["fuelAccess"].Select(p => new Vector2((float)p[0], (float)p[1])).ToArray();
                var access = routes.FirstOrDefault(r => r.RouteId == "fuel_ramp_access");
                if (!access)
                {
                    var go = new GameObject("Route_fuel_ramp_access"); Undo.RegisterCreatedObjectUndo(go, "Authored fuel yard access");
                    go.transform.SetParent(routes[0].transform.parent, false); access = go.AddComponent<KromkaRouteAuthoring>();
                    access.Configure("fuel_ramp_access", "Подъезд к Топливной рампе", KromkaRouteKind.Road, Array.Empty<Transform>(), .8f, .8f);
                }
                SetRoute(access, fuel);
                BuildAccess(access.transform, fuel, surfaces, MeshPath);
                Vector2[] zero = review["zeroAccess"].Select(p => new Vector2((float)p[0], (float)p[1])).ToArray();
                var admin = routes.FirstOrDefault(r => r.RouteId == "zero_admin_access");
                if (!admin)
                {
                    var go = new GameObject("Route_zero_admin_access"); Undo.RegisterCreatedObjectUndo(go, "Authored southern administrative access");
                    go.transform.SetParent(routes[0].transform.parent, false); admin = go.AddComponent<KromkaRouteAuthoring>();
                    admin.Configure("zero_admin_access", "Подъезд к Балансу и Форту 14", KromkaRouteKind.Road, Array.Empty<Transform>(), .8f, .8f);
                }
                SetRoute(admin, zero);
                BuildAccess(admin.transform, zero, surfaces, "Assets/Art/Kromka/Meshes/Kromka_ZeroAdminAuthoredAccess.asset");
            }
            KromkaWorldSceneExporter.ExportGlobalScene(scene);
            Validate();
            Undo.FlushUndoRecordObjects();
            EditorSceneManager.MarkSceneDirty(scene); EditorSceneManager.SaveScene(scene); AssetDatabase.SaveAssets();
            Debug.Log("[LORE PLACEMENT] Reviewed " + rows.Length + ", moved " + moved + "; saved Unity markers and authored export.");
        }

        static void SetRoute(KromkaRouteAuthoring route, Vector2[] points)
        {
            var controls = route.ControlPoints.ToList();
            while (controls.Count < points.Length)
            {
                var go = new GameObject("Point_" + controls.Count.ToString("D2"));
                Undo.RegisterCreatedObjectUndo(go, "Authored route control point");
                go.transform.SetParent(route.transform, false); controls.Add(go.transform);
            }
            // Removed references are retained as ordinary inactive authoring objects for undo/recovery.
            for (int i = points.Length; i < controls.Count; i++) { Undo.RecordObject(controls[i].gameObject, "Retire route point"); controls[i].gameObject.SetActive(false); }
            controls = controls.Take(points.Length).ToList();
            for (int i = 0; i < controls.Count; i++)
            {
                Undo.RecordObject(controls[i], "Sync route with its rendered course");
                controls[i].position = World(points[i]) + Vector3.up * KromkaGlobalMapReliefAuthoring.HeightAtMap(points[i].x, points[i].y);
            }
            Undo.RecordObject(route, "Sync authored route");
            route.Configure(route.RouteId, route.DisplayName, route.RouteKind, controls.ToArray(), route.WidthKm, route.TravelFactor);
        }

        static void BuildAccess(Transform root, Vector2[] points, Surfaces surfaces, string meshPath)
        {
            var vertices = new List<Vector3>(); var uv = new List<Vector2>(); var triangles = new List<int>();
            float length = 0f;
            for (int i = 1; i < points.Length; i++)
            {
                Vector2 delta = points[i]-points[i-1], side = new Vector2(-delta.y, delta.x).normalized * .4f;
                int steps = Mathf.CeilToInt(delta.magnitude/.35f);
                for (int j = 0; j < steps; j++)
                {
                    int start = vertices.Count;
                    foreach (float t in new[] { j/(float)steps, (j+1f)/steps })
                        foreach (float sign in new[] { -1f, 1f })
                        {
                            Vector2 p = Vector2.Lerp(points[i-1], points[i], t)+side*sign;
                            vertices.Add(root.InverseTransformPoint(World(p)+Vector3.up*(surfaces.DryHeight(p,"Fuel access")+.008f)));
                            uv.Add(new Vector2(sign < 0f ? 0f : 1f, (length+delta.magnitude*t)*.1f));
                        }
                    triangles.AddRange(new[] { start,start+2,start+1,start+1,start+2,start+3 });
                }
                length += delta.magnitude;
            }
            var mesh = new Mesh { name = Path.GetFileNameWithoutExtension(meshPath) };
            mesh.SetVertices(vertices); mesh.SetUVs(0, uv); mesh.SetTriangles(triangles, 0); mesh.RecalculateNormals(); mesh.RecalculateBounds();
            Mesh asset = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
            if (asset) { EditorUtility.CopySerialized(mesh, asset); UnityEngine.Object.DestroyImmediate(mesh); }
            else { AssetDatabase.CreateAsset(mesh, meshPath); asset = mesh; }
            var visual = root.Find("FuelAccess_SURFACE_AUTHORED");
            if (!visual) { var go = new GameObject("FuelAccess_SURFACE_AUTHORED"); Undo.RegisterCreatedObjectUndo(go,"Fuel access surface"); go.transform.SetParent(root,false); visual=go.transform; }
            var filter = visual.GetComponent<MeshFilter>();
            if (!filter) filter = Undo.AddComponent<MeshFilter>(visual.gameObject);
            filter.sharedMesh = asset;
            var renderer = visual.GetComponent<MeshRenderer>();
            if (!renderer) renderer = Undo.AddComponent<MeshRenderer>(visual.gameObject);
            renderer.sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>("Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Road_MEP.mat");
        }

        [MenuItem("Кромка/Проверки/Лорное размещение всех локаций")]
        public static void Validate()
        {
            var scene = SceneManager.GetSceneByPath(ScenePath);
            var markers = scene.GetRootGameObjects().SelectMany(r => r.GetComponentsInChildren<KromkaWorldLocationAuthoring>(true)).ToArray();
            using (var surfaces = new Surfaces(scene))
                foreach (var marker in markers)
                {
                    float h = surfaces.DryHeight(Map(marker.transform.position), marker.StableLocationId);
                    float gap = marker.transform.Find("MapMiniature").GetComponent<Renderer>().bounds.min.y - h;
                    if (Mathf.Abs(gap) > .015f) throw new InvalidOperationException(marker.StableLocationId + " marker is not terrain seated: " + gap);
                }
            Debug.Log("[LORE PLACEMENT] PASS " + markers.Length + " dry terrain-seated Unity location markers.");
        }
    }
}
#endif
