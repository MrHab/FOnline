#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    // Physical ramps share the native road deck's exact end points. They are
    // generated siblings, leaving the source prefab and its materials intact.
    internal static class KromkaGlobalMapBridgeApproachAuthoring
    {
        private const string RootName = "RoadBridgeApproaches_EDITABLE";
        private const int Steps = 12;
        internal static void SeatDeckAboveBanks(Transform bridge)
        {
            Deck(bridge, out Vector3 left, out Vector3 right, out Vector3 forward,
                out float halfLength, out _, out _);
            float bank = new[] { left - forward * halfLength, right - forward * halfLength,
                left + forward * halfLength, right + forward * halfLength }.Max(Ground);
            float lift = Mathf.Max(0f, bank + .035f - left.y);
            if (lift <= 0f) return;
            bridge.position += Vector3.up * lift;
            // Stretch supports down while keeping their deck attachment fixed.
            foreach (Renderer pier in bridge.GetComponentsInChildren<Renderer>().Where(r => r.name.StartsWith("pilar")))
            {
                Bounds bounds = pier.bounds;
                float bottom = Ground(bounds.center) - .035f;
                if (bounds.min.y <= bottom) continue;
                Vector3 scale = pier.transform.localScale;
                scale.y *= (bounds.max.y - bottom) / bounds.size.y;
                pier.transform.localScale = scale;
                pier.transform.position += Vector3.up * (bounds.max.y - pier.bounds.max.y);
            }
        }
        internal static void Compose(Transform bridges)
        {
            Transform previous = bridges.parent.Find(RootName);
            if (previous != null) UnityEngine.Object.DestroyImmediate(previous.gameObject);
            Transform root = new GameObject(RootName).transform;
            root.SetParent(bridges.parent, false);
            foreach (Transform bridge in bridges)
            {
                Deck(bridge, out Vector3 left, out Vector3 right, out Vector3 forward,
                    out float halfLength, out Material road, out Material concrete);
                Vector2[] route = KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(
                    bridge.name.StartsWith("TesmaMain") ? KromkaGlobalMapRouteSurfaceAuthoring.MainTract
                        : KromkaGlobalMapRouteSurfaceAuthoring.ZeroServiceLine);
                for (int sign = -1; sign <= 1; sign += 2)
                    Add(root, bridge.name + (sign < 0 ? "_ApproachA" : "_ApproachB"),
                        left + forward * (halfLength * sign),
                        right + forward * (halfLength * sign), forward * sign, route, road, concrete);
            }
        }

        private static void Deck(Transform bridge, out Vector3 left, out Vector3 right,
            out Vector3 forward, out float halfLength, out Material road, out Material concrete)
        {
            MeshRenderer renderer = bridge.GetComponentsInChildren<MeshRenderer>()
                .Single(item => item.name == "road");
            MeshFilter filter = renderer.GetComponent<MeshFilter>();
            Mesh mesh = filter.sharedMesh;
            int slot = Array.FindIndex(renderer.sharedMaterials, material => material.name == "road");
            road = renderer.sharedMaterials[slot];
            concrete = renderer.sharedMaterials.First(material => material.name == "Concrete");
            Vector3[] points = mesh.GetTriangles(slot).Distinct().Select(index =>
                bridge.InverseTransformPoint(filter.transform.TransformPoint(mesh.vertices[index]))).ToArray();
            float minX = points.Min(p => p.x), maxX = points.Max(p => p.x);
            float minZ = points.Min(p => p.z), maxZ = points.Max(p => p.z);
            float y = points.Average(p => p.y), z = (minZ + maxZ) * .5f;
            left = bridge.TransformPoint(new Vector3(minX, y, z));
            right = bridge.TransformPoint(new Vector3(maxX, y, z));
            forward = bridge.forward;
            halfLength = Vector3.Distance(bridge.TransformPoint(new Vector3(0f, y, minZ)),
                bridge.TransformPoint(new Vector3(0f, y, maxZ))) * .5f;
        }

        private static float Ground(Vector3 point) => KromkaGlobalMapReliefAuthoring.HeightAtMap(
            190f + point.x * 10f, 150f - point.z * 10f);

        private static void Add(Transform parent, string name, Vector3 left, Vector3 right,
            Vector3 direction, Vector2[] route, Material road, Material concrete)
        {
            const float length = 1.15f;
            Vector3 side = (right - left).normalized;
            Vector3 start = (left + right) * .5f;
            Vector3 end = NearestRoadPoint(start + direction * length, route, out Vector3 endDirection);
            if (Vector3.Dot(endDirection, direction) < 0f) endDirection = -endDirection;
            Vector3 controlA = start + direction * .42f;
            Vector3 controlB = end - endDirection * .42f;
            float halfWidth = Vector3.Distance(left, right) * .5f;
            var vertices = new List<Vector3>();
            var uv = new List<Vector2>();
            var top = new List<int>();
            var banks = new List<int>();
            for (int row = 0; row <= Steps; row++)
            {
                float t = row / (float)Steps;
                float u = 1f - t;
                Vector3 centre = u * u * u * start + 3f * u * u * t * controlA
                    + 3f * u * t * t * controlB + t * t * t * end;
                Vector3 tangent = (3f * u * u * (controlA - start)
                    + 6f * u * t * (controlB - controlA) + 3f * t * t * (end - controlB)).normalized;
                Vector3 crossSide = Vector3.Cross(Vector3.up, tangent).normalized;
                if (Vector3.Dot(crossSide, side) < 0f) crossSide = -crossSide;
                Vector3 a = centre - crossSide * halfWidth;
                Vector3 b = centre + crossSide * halfWidth;
                // Smooth contact with the existing raised route surface. Never
                // bend the ramp through a local rise in the terrain.
                a.y = Mathf.Max(Mathf.Lerp(left.y, Ground(a) + .042f, t), Ground(a) + .025f);
                b.y = Mathf.Max(Mathf.Lerp(right.y, Ground(b) + .042f, t), Ground(b) + .025f);
                if (row == 0) { a.y = left.y; b.y = right.y; }
                Vector3 toeA = a - crossSide * .14f, toeB = b + crossSide * .14f;
                toeA.y = Ground(toeA) + .004f; toeB.y = Ground(toeB) + .004f;
                vertices.Add(parent.InverseTransformPoint(toeA));
                vertices.Add(parent.InverseTransformPoint(a));
                vertices.Add(parent.InverseTransformPoint(b));
                vertices.Add(parent.InverseTransformPoint(toeB));
                for (int cross = 0; cross < 4; cross++) uv.Add(new Vector2(cross / 3f, t));
                if (row == 0) continue;
                int i = row * 4;
                Quad(top, vertices, i - 3, i - 2, i + 2, i + 1);
                Quad(banks, vertices, i - 4, i - 3, i + 1, i);
                Quad(banks, vertices, i - 2, i - 1, i + 3, i + 2);
            }
            string path = "Assets/Art/Kromka/Meshes/Kromka_" + name + ".asset";
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            bool fresh = mesh == null;
            if (fresh) mesh = new Mesh { name = "Kromka_" + name };
            mesh.Clear(); mesh.SetVertices(vertices); mesh.SetUVs(0, uv);
            mesh.subMeshCount = 2;
            mesh.SetTriangles(top, 0); mesh.SetTriangles(banks, 1);
            mesh.RecalculateNormals(); mesh.RecalculateBounds();
            if (fresh) AssetDatabase.CreateAsset(mesh, path); else EditorUtility.SetDirty(mesh);
            var ramp = new GameObject(name);
            ramp.transform.SetParent(parent, false);
            ramp.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = ramp.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = new[] { road, concrete };
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
        }

        private static Vector3 NearestRoadPoint(Vector3 point, Vector2[] route, out Vector3 tangent)
        {
            Vector2 map = new Vector2(190f + point.x * 10f, 150f - point.z * 10f);
            float best = float.MaxValue;
            Vector2 nearest = default;
            tangent = Vector3.zero;
            for (int i = 0; i < route.Length - 1; i++)
            {
                Vector2 delta = route[i + 1] - route[i];
                float t = Mathf.Clamp01(Vector2.Dot(map - route[i], delta) / Mathf.Max(delta.sqrMagnitude, .0001f));
                Vector2 candidate = route[i] + delta * t;
                float distance = (candidate - map).sqrMagnitude;
                if (distance >= best) continue;
                best = distance; nearest = candidate;
                tangent = new Vector3(delta.x, 0f, -delta.y).normalized;
            }
            return new Vector3((nearest.x - 190f) * .1f, point.y, (150f - nearest.y) * .1f);
        }

        private static void Quad(List<int> triangles, List<Vector3> vertices, int a, int b, int c, int d)
        {
            if (Vector3.Cross(vertices[b] - vertices[a], vertices[c] - vertices[a]).y < 0f)
            { int swap = b; b = d; d = swap; }
            triangles.AddRange(new[] { a, b, c, a, c, d });
        }

        internal static void Validate(Transform bridges)
        {
            Transform root = bridges.parent.Find(RootName);
            Require(root != null && root.childCount == 4, "Four road-to-bridge ramps are required.");
            foreach (Transform bridge in bridges)
            {
                Deck(bridge, out Vector3 left, out Vector3 right, out Vector3 forward,
                    out float halfLength, out _, out _);
                for (int sign = -1; sign <= 1; sign += 2)
                {
                    Transform ramp = root.Find(bridge.name + (sign < 0 ? "_ApproachA" : "_ApproachB"));
                    Require(ramp != null, bridge.name + " has a missing approach.");
                    Vector3[] vertices = ramp.GetComponent<MeshFilter>().sharedMesh.vertices;
                    Require(vertices.Length == (Steps + 1) * 4, "Incomplete bridge ramp mesh.");
                    Require(Vector3.Distance(ramp.TransformPoint(vertices[1]), left + forward * halfLength * sign) < .002f
                        && Vector3.Distance(ramp.TransformPoint(vertices[2]), right + forward * halfLength * sign) < .002f,
                        bridge.name + " has a gap at the bridge deck.");
                    for (int row = 0; row <= Steps; row++)
                        for (int cross = 1; cross <= 2; cross++)
                        {
                            Vector3 point = ramp.TransformPoint(vertices[row * 4 + cross]);
                            Require(point.y >= Ground(point) + .02f, "A bridge ramp clips the terrain.");
                        }
                    Vector3 end = ramp.TransformPoint((vertices[Steps * 4 + 1] + vertices[Steps * 4 + 2]) * .5f);
                    Vector2[] route = KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(
                        bridge.name.StartsWith("TesmaMain") ? KromkaGlobalMapRouteSurfaceAuthoring.MainTract
                            : KromkaGlobalMapRouteSurfaceAuthoring.ZeroServiceLine);
                    Vector3 nearest = NearestRoadPoint(end, route, out _);
                    Require(Vector2.Distance(new Vector2(end.x, end.z), new Vector2(nearest.x, nearest.z)) < .002f,
                        bridge.name + " approach does not meet the rendered route.");
                }
            }
            Debug.Log("[KROMKA BRIDGE APPROACHES] PASS: four grounded ramps, native deck seams below 0.002.");
            ValidateBuildingClearance(bridges, root);
        }

        private static void ValidateBuildingClearance(Transform bridges, Transform approaches)
        {
            var blockers = new HashSet<string>();
            var obstacles = bridges.parent.GetComponentsInChildren<MeshRenderer>()
                .Where(renderer => renderer.enabled && !renderer.transform.IsChildOf(bridges)
                    && !renderer.transform.IsChildOf(approaches))
                .Where(renderer =>
                {
                    GameObject prefab = PrefabUtility.GetOutermostPrefabInstanceRoot(renderer.gameObject);
                    if (prefab != null) return KromkaGlobalMapRiverClearanceAudit.IsStructureSource(
                        PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(prefab).Replace('\\', '/'));
                    MeshFilter filter = renderer.GetComponent<MeshFilter>();
                    return filter != null && filter.sharedMesh != null
                        && !AssetDatabase.GetAssetPath(filter.sharedMesh).StartsWith("Assets/");
                }).ToArray();
            foreach (MeshRenderer obstacle in obstacles)
            {
                Bounds bounds = obstacle.bounds;
                foreach (MeshFilter ramp in approaches.GetComponentsInChildren<MeshFilter>())
                {
                    Vector3[] points = ramp.sharedMesh.vertices;
                    for (int row = 0; row <= Steps; row++)
                        CheckRoadSection(bounds, ramp.transform.TransformPoint(points[row * 4 + 1]),
                            ramp.transform.TransformPoint(points[row * 4 + 2]), obstacle, ramp.name, blockers);
                }
                foreach (Transform bridge in bridges)
                {
                    Deck(bridge, out Vector3 left, out Vector3 right, out Vector3 forward,
                        out float halfLength, out _, out _);
                    for (int row = 0; row <= 24; row++)
                    {
                        Vector3 offset = forward * Mathf.Lerp(-halfLength, halfLength, row / 24f);
                        CheckRoadSection(bounds, left + offset, right + offset, obstacle, bridge.name, blockers);
                    }
                }
            }
            Require(blockers.Count == 0, "Road clearance: " + string.Join("; ", blockers));
        }

        private static void CheckRoadSection(Bounds bounds, Vector3 left, Vector3 right,
            Renderer obstacle, string name, HashSet<string> blockers)
        {
            for (int cross = 0; cross <= 4; cross++)
                foreach (float height in new[] { .025f, .08f, .15f })
                    if (bounds.Contains(Vector3.Lerp(left, right, cross / 4f) + Vector3.up * height))
                        blockers.Add(obstacle.transform.parent.name + "/" + obstacle.name + " obstructs " + name);
        }

        private static void Require(bool condition, string message)
        { if (!condition) throw new InvalidOperationException(message); }
    }
}
#endif
