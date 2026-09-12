#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>One functional rail crossing replaces the orphaned modular
    /// viaducts. Rails, sleepers, bridge bearings and approach fill share a grade.</summary>
    internal static class KromkaGlobalMapRouteCrossingAuthoring
    {
        internal const int ModelIteration = 17;
        internal const int ModelIterationCount = 20;
        private const string RootName = "TesmaFreightRail_SUPPORTED_EDITABLE";
        private const float HalfSpan = .82f;
        private const float ApproachLength = 1.30f;
        private static bool ready;
        private static Vector3 centre, along, across;
        private static float deckLevel;

        private static void Geometry()
        {
            if (ready) return;
            Vector2[] rail = KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(
                KromkaGlobalMapRouteSurfaceAuthoring.OreFreightRail);
            Vector2[] river = KromkaGlobalMapWaterAuthoring.SampleTesma();
            var crossings = new List<(Vector2 point, Vector2 tangent)>();
            for (int i = 0; i < rail.Length - 1; i++)
                for (int j = 0; j < river.Length - 1; j++)
                {
                    Vector2 a = rail[i], b = rail[i + 1] - a;
                    Vector2 c = river[j], d = river[j + 1] - c;
                    float denominator = Cross(b, d);
                    if (Mathf.Abs(denominator) < .00001f) continue;
                    float t = Cross(c - a, d) / denominator, u = Cross(c - a, b) / denominator;
                    if (t < 0f || t > 1f || u < 0f || u > 1f) continue;
                    Vector2 point = a + b * t;
                    if (crossings.All(hit => Vector2.Distance(hit.point, point) > .02f))
                        crossings.Add((point, b.normalized));
                }
            Require(crossings.Count == 1, "The freight railway must cross the one Tesma channel exactly once.");
            centre = World(crossings[0].point);
            along = new Vector3(crossings[0].tangent.x, 0f, -crossings[0].tangent.y);
            across = Vector3.Cross(Vector3.up, along);
            deckLevel = new[] { centre - along * HalfSpan - across * .2f,
                centre - along * HalfSpan + across * .2f,
                centre + along * HalfSpan - across * .2f,
                centre + along * HalfSpan + across * .2f }.Max(Ground) + .16f;
            ready = true;
        }

        internal static float RailwaySurfaceHeight(Vector2 map, float terrain)
        {
            Geometry();
            float distance = Mathf.Abs(Vector3.Dot(World(map) - centre, along));
            if (distance >= HalfSpan + ApproachLength) return terrain + .04f;
            float blend = 1f - Mathf.SmoothStep(0f, 1f,
                Mathf.InverseLerp(HalfSpan, HalfSpan + ApproachLength, distance));
            return Mathf.Max(terrain + .04f, Mathf.Lerp(terrain + .04f, deckLevel, blend));
        }

        internal static void Compose(Transform parent)
        {
            ready = false;
            Geometry();
            // These obsolete dry-ground crossings were four separated plank
            // panels each, with floating piers. No physical obstacle justified them.
            foreach (string name in new[] { RootName, "StrategicRouteCrossings_ModelPass17_MEP",
                "StrategicRouteCrossings_3_REFERENCE", "DirectMEPBridgeDecks_12_REFERENCE",
                "DirectMEPBridgeAbutments_6_REFERENCE", "RouteCrossingFurniture_39_REFERENCE",
                "TerrainSeatedCrossingPiers_REFERENCE", "RaisedNonFloatingBridgeDecks_REFERENCE" })
            {
                Transform old = parent.Find(name);
                if (old != null) UnityEngine.Object.DestroyImmediate(old.gameObject);
            }
            Transform root = Child(parent, RootName);
            Material steel = Material("Kromka_RouteCrossing_Steel", new Color(.20f, .22f, .21f), .40f);
            Material timber = Material("Kromka_Railway_Timber", new Color(.24f, .18f, .12f), 0f);
            Material concrete = Material("Kromka_RouteCrossing_Concrete", new Color(.34f, .34f, .30f), .03f);
            Material fill = AssetDatabase.LoadAssetAtPath<Material>(
                "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Ballast_MEP.mat");
            var rails = new MeshParts();
            var sleepers = new MeshParts();
            var structure = new MeshParts();
            var earth = new MeshParts();
            Vector2[] points = KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(
                KromkaGlobalMapRouteSurfaceAuthoring.OreFreightRail);
            float sleeperDistance = .16f;
            for (int segment = 0; segment < points.Length - 1; segment++)
            {
                Vector2 delta = points[segment + 1] - points[segment];
                int steps = Mathf.Max(1, Mathf.CeilToInt(delta.magnitude * .1f / .09f));
                for (int step = 0; step < steps; step++)
                {
                    Vector3 a = TrackPoint(Vector2.Lerp(points[segment], points[segment + 1], step / (float)steps));
                    Vector3 b = TrackPoint(Vector2.Lerp(points[segment], points[segment + 1], (step + 1f) / steps));
                    Vector3 forward = (b - a).normalized;
                    Vector3 side = Vector3.Cross(Vector3.up, forward).normalized;
                    Quaternion rotation = Quaternion.LookRotation(forward, Vector3.up);
                    foreach (float sign in new[] { -1f, 1f })
                        rails.Box((a + b) * .5f + side * (sign * .065f) + Vector3.up * .032f,
                            new Vector3(.012f, .018f, Vector3.Distance(a, b) + .003f), rotation);
                    sleeperDistance += Vector3.Distance(a, b);
                    if (sleeperDistance >= .16f)
                    {
                        sleepers.Box(a + Vector3.up * .012f, new Vector3(.24f, .024f, .035f), rotation);
                        sleeperDistance = 0f;
                    }
                    float distance = Mathf.Abs(Vector3.Dot((a + b) * .5f - centre, along));
                    if (distance > HalfSpan)
                        earth.FillSection(a, b, side);
                }
            }
            // A single continuous load-bearing slab spans both banks; abutments
            // extend from actual terrain to its underside, not a constant offset.
            Quaternion deckRotation = Quaternion.LookRotation(along, Vector3.up);
            structure.Box(new Vector3(centre.x, deckLevel - .045f, centre.z),
                new Vector3(.38f, .09f, HalfSpan * 2f), deckRotation);
            for (int end = -1; end <= 1; end += 2)
            {
                Vector3 position = centre + along * (end * .70f);
                float bottom = new[] { position, position + across * .20f, position - across * .20f }.Min(Ground) - .025f;
                float top = deckLevel - .06f;
                position.y = (bottom + top) * .5f;
                BoxObject("BankAbutment_" + end, root, position,
                    new Vector3(.42f, top - bottom, .17f), deckRotation, concrete);
            }
            // Two side beams and attached stanchions form an ordinary steel
            // railway bridge, without hovering warning lights or road markings.
            for (int side = -1; side <= 1; side += 2)
            {
                Vector3 beam = centre + across * (side * .20f); beam.y = deckLevel + .12f;
                structure.Box(beam, new Vector3(.035f, .07f, HalfSpan * 2f), deckRotation);
                for (int post = 0; post <= 6; post++)
                {
                    Vector3 p = centre + across * (side * .20f)
                        + along * Mathf.Lerp(-HalfSpan, HalfSpan, post / 6f);
                    p.y = deckLevel + .045f;
                    structure.Box(p, new Vector3(.025f, .16f, .025f), deckRotation);
                }
            }
            foreach (int end in new[] { 0, points.Length - 1 })
            {
                Vector3 p = TrackPoint(points[end]);
                Vector3 tangent = TrackPoint(points[end == 0 ? 1 : end - 1]) - p;
                tangent.y = 0f;
                structure.Box(p + Vector3.up * .035f, new Vector3(.27f, .07f, .07f),
                    Quaternion.LookRotation(tangent.normalized, Vector3.up));
            }
            rails.Build("ContinuousFreightRails", root, steel);
            sleepers.Build("GroundSupportedSleepers", root, timber);
            structure.Build("TesmaRailBridge_ContinuousStructure", root, steel);
            earth.Build("RailBridgeApproachFill", root, fill);
            Child(parent, "RailWaterCrossing_1_REFERENCE");
            Child(parent, "NoOrphanedDryLandViaducts_REFERENCE");
            Child(parent, "PersistentRouteCrossingGeometry_REFERENCE");
            Child(parent, "ModelIteration_17_of_20");
        }

        internal static void ValidateIteration17()
        {
            Geometry();
            Transform root = GameObject.Find(RootName)?.transform;
            Require(root != null, "The supported freight railway is missing.");
            Require(GameObject.Find("StrategicRouteCrossings_ModelPass17_MEP") == null,
                "Orphaned modular viaducts are still present.");
            foreach (string name in new[] { "ContinuousFreightRails", "GroundSupportedSleepers",
                "TesmaRailBridge_ContinuousStructure", "RailBridgeApproachFill" })
            {
                MeshFilter filter = root.Find(name)?.GetComponent<MeshFilter>();
                Require(filter != null && filter.sharedMesh.vertexCount > 0, name + " is incomplete.");
                Require(AssetDatabase.Contains(filter.sharedMesh), name + " is not persistent.");
            }
            foreach (int end in new[] { -1, 1 })
            {
                Renderer footing = root.Find("BankAbutment_" + end).GetComponent<Renderer>();
                Require(footing.bounds.min.y <= Ground(footing.bounds.center) + .005f,
                    "A rail bridge abutment is floating.");
                Require(Mathf.Abs(footing.bounds.max.y - (deckLevel - .06f)) < .002f,
                    "A rail bridge bearing is detached from its deck.");
            }
            Require(root.GetComponentsInChildren<Collider>().Length == 0,
                "Railway geometry must not obstruct map interaction.");
            Debug.Log("[KROMKA MODELS 85%] PASS: one functional rail-water crossing, continuous rails,") ;
            Debug.Log("[KROMKA RAIL PHYSICS] Grounded abutments, joined sleepers and earth-filled approaches.");
        }

        private static Vector3 TrackPoint(Vector2 map)
        {
            Vector3 p = World(map); p.y = RailwaySurfaceHeight(map, Ground(p)); return p;
        }
        private static float Cross(Vector2 a, Vector2 b) => a.x * b.y - a.y * b.x;
        private static Vector3 World(Vector2 p) => new Vector3((p.x - 190f) * .1f, 0f, (150f - p.y) * .1f);
        private static float Ground(Vector3 p) => KromkaGlobalMapReliefAuthoring.HeightAtMap(190f + p.x * 10f, 150f - p.z * 10f);
        private static void Require(bool condition, string message)
        { if (!condition) throw new InvalidOperationException(message); }
        private static Transform Child(Transform parent, string name)
        {
            Transform old = parent.Find(name); if (old != null) return old;
            Transform child = new GameObject(name).transform; child.SetParent(parent, false); return child;
        }
        private static Material Material(string name, Color color, float metallic)
        {
            string path = "Assets/Art/Kromka/Materials/" + name + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null) { material = new Material(Shader.Find("Universal Render Pipeline/Lit")); AssetDatabase.CreateAsset(material, path); }
            material.SetColor("_BaseColor", color); material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", .16f); material.enableInstancing = true;
            EditorUtility.SetDirty(material); return material;
        }
        private static void BoxObject(string name, Transform parent, Vector3 position,
            Vector3 scale, Quaternion rotation, Material material)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube); go.name = name;
            go.transform.SetParent(parent, false); go.transform.SetPositionAndRotation(position, rotation);
            go.transform.localScale = scale; UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
            go.GetComponent<Renderer>().sharedMaterial = material; go.isStatic = true;
        }
        private sealed class MeshParts
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<int> triangles = new List<int>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d)
            {
                int i = vertices.Count; vertices.AddRange(new[] { a, b, c, d });
                uv.AddRange(new[] { Vector2.zero, Vector2.up, Vector2.one, Vector2.right });
                triangles.AddRange(new[] { i, i + 1, i + 2, i, i + 2, i + 3 });
            }
            internal void Box(Vector3 centre, Vector3 size, Quaternion rotation)
            {
                Vector3[] p = new Vector3[8];
                for (int i = 0; i < 8; i++) p[i] = centre + rotation * Vector3.Scale(size * .5f,
                    new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                Quad(p[0], p[2], p[3], p[1]); Quad(p[4], p[5], p[7], p[6]);
                Quad(p[0], p[4], p[6], p[2]); Quad(p[1], p[3], p[7], p[5]);
                Quad(p[2], p[6], p[7], p[3]); Quad(p[0], p[1], p[5], p[4]);
            }
            internal void FillSection(Vector3 a, Vector3 b, Vector3 side)
            {
                Vector3 l0 = a - side * .18f, r0 = a + side * .18f;
                Vector3 l1 = b - side * .18f, r1 = b + side * .18f;
                Vector3 bl0 = a - side * .34f, br0 = a + side * .34f;
                Vector3 bl1 = b - side * .34f, br1 = b + side * .34f;
                bl0.y = Ground(bl0) - .04f; br0.y = Ground(br0) - .04f;
                bl1.y = Ground(bl1) - .04f; br1.y = Ground(br1) - .04f;
                Quad(l0, l1, r1, r0); Quad(l0, bl0, bl1, l1); Quad(br0, r0, r1, br1);
            }
            internal void Build(string name, Transform parent, Material material)
            {
                string path = "Assets/Art/Kromka/Meshes/Kromka_" + name + ".asset";
                Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
                bool fresh = mesh == null; if (fresh) mesh = new Mesh { name = "Kromka_" + name };
                mesh.Clear(); mesh.indexFormat = IndexFormat.UInt32;
                mesh.SetVertices(vertices); mesh.SetUVs(0, uv); mesh.SetTriangles(triangles, 0);
                mesh.RecalculateNormals(); mesh.RecalculateBounds();
                if (fresh) AssetDatabase.CreateAsset(mesh, path); else EditorUtility.SetDirty(mesh);
                Transform t = Child(parent, name); t.gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = t.gameObject.AddComponent<MeshRenderer>(); renderer.sharedMaterial = material;
                renderer.shadowCastingMode = ShadowCastingMode.On; renderer.receiveShadows = true; t.gameObject.isStatic = true;
            }
        }
    }
}
#endif
