using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>Freight track on continuous crushed-stone ballast, including the bridge.</summary>
    public sealed class RoaDamRoadRailProjection : MonoBehaviour
    {
        [Serializable] public sealed class Point { public float x; public float z; }
        [Serializable] public sealed class Route
        {
            public string route;
            public float gauge;
            public float sleeperSpacing;
            public Point[] points;
        }

        private readonly List<Mesh> _meshes = new List<Mesh>();
        private readonly List<Material> _materials = new List<Material>();
        public const string ResourceKey = "RealmOfAshes/DamRoadRail";
        public const float BallastRise = 0.06f;
        public const float RailHeadRise = 0.245f;
        public Route Profile { get; private set; }

        public static float BridgeBedRiseAt(float z) => BallastRise
            * (1f - Mathf.Clamp01((Mathf.Abs(z + 106f) - 1.5f) / 0.6f));

        public static void Build(Renderer ground)
        {
            TextAsset source = Resources.Load<TextAsset>(ResourceKey);
            if (source == null) throw new InvalidOperationException("Dam road railway profile is missing.");
            var host = new GameObject("DamRoadFreightRail");
            host.transform.SetParent(ground.transform.parent, false);
            var track = host.AddComponent<RoaDamRoadRailProjection>();
            track.Profile = JsonConvert.DeserializeObject<Route>(source.text);
            track.Generate();
        }

        public static float SurfaceAt(float x, float z)
        {
            if (RoaDamRoadWaterProjection.IsBridgeDeck(x, z)) return RoaDamRoadWaterProjection.BridgeFoundationHeightAt(x);
            // The structural bridge remains beneath the ballast. On land the
            // foundation follows the projected soil; road slabs are not used.
            return RoaZoneReliefProjection.GroundHeightAt(x, z) - 0.05f;
        }

        private void Generate()
        {
            if (Profile?.points == null || Profile.points.Length < 2)
                throw new InvalidOperationException("Dam road railway has no route.");
            var ballast = new Geometry();
            var timber = new Geometry();
            var steel = new Geometry();
            var head = new Geometry();
            Point[] points = Profile.points;
            float distance = 0f, nextSleeper = 0f;
            for (int i = 0; i < points.Length - 1; i++)
            {
                Vector2 a = new Vector2(points[i].x, points[i].z);
                Vector2 b = new Vector2(points[i + 1].x, points[i + 1].z);
                Vector2 direction = (b - a).normalized;
                Vector2 side = new Vector2(-direction.y, direction.x);
                // Averaged tangents keep both rails continuous through curves.
                Vector2 sideA = SideAt(points, i), sideB = SideAt(points, i + 1);
                ballast.Ribbon(a, b, sideA, sideB, 0f, 1.5f, BallastRise);
                foreach (float sign in new[] { -1f, 1f })
                {
                    float edgeA = 2.1f + 0.025f * Mathf.Sin(i * 1.73f);
                    float edgeB = 2.1f + 0.025f * Mathf.Sin((i + 1) * 1.73f);
                    ballast.Slope(a + sideA * (sign * 1.5f), b + sideB * (sign * 1.5f),
                        a + sideA * (sign * edgeA), b + sideB * (sign * edgeB), BallastRise, 0.002f);
                }
                foreach (float sign in new[] { -1f, 1f })
                {
                    float offset = sign * (Profile.gauge + 0.08f) * 0.5f;
                    float top = RailHeadRise;
                    steel.Ribbon(a, b, sideA, sideB, offset, 0.07f, top - 0.12f);
                    steel.Ribbon(a, b, sideA, sideB, offset, 0.025f, top - 0.06f);
                    steel.Vertical(a + sideA * (offset - 0.025f), b + sideB * (offset - 0.025f), top - 0.12f, top - 0.025f);
                    steel.Vertical(a + sideA * (offset + 0.025f), b + sideB * (offset + 0.025f), top - 0.025f, top - 0.12f);
                    head.Ribbon(a, b, sideA, sideB, offset, 0.04f, top);
                    head.Vertical(a + sideA * (offset - 0.04f), b + sideB * (offset - 0.04f), top - 0.025f, top);
                    head.Vertical(a + sideA * (offset + 0.04f), b + sideB * (offset + 0.04f), top, top - 0.025f);
                }
                float length = Vector2.Distance(a, b);
                while (nextSleeper <= distance + length)
                {
                    float t = (nextSleeper - distance) / length;
                    Vector2 centre = Vector2.Lerp(a, b, t);
                    timber.Box(centre, direction, side, 0.13f, 1.3f, 0.02f, 0.105f);
                    foreach (float sign in new[] { -1f, 1f })
                    {
                        Vector2 seat = centre + side * (sign * (Profile.gauge + 0.08f) * 0.5f);
                        steel.Box(seat, direction, side, 0.17f, 0.155f, 0.105f, 0.125f);
                        foreach (float fastener in new[] { -1f, 1f })
                            steel.Box(seat + side * (fastener * 0.12f), direction, side,
                                0.035f, 0.025f, 0.125f, 0.145f);
                    }
                    nextSleeper += Profile.sleeperSpacing;
                }
                distance += length;
            }
            Material gravel = Material("DamRoadRailBallast", new Color(0.48f, 0.49f, 0.47f), 0.05f, 0f);
            Create("Ballast", ballast, gravel);
            Create("Sleepers", timber, Material("DamRoadRailTimber", new Color(0.23f, 0.17f, 0.11f), 0.12f, 0f));
            Create("RailFeetAndWebs", steel, Material("DamRoadRailRust", new Color(0.24f, 0.16f, 0.105f), 0.22f, 0.3f));
            Create("RailHeads", head, Material("DamRoadRailSteel", new Color(0.5f, 0.53f, 0.53f), 0.62f, 0.8f));
        }

        private static Vector2 SideAt(Point[] points, int i)
        {
            Point a = points[Mathf.Max(0, i - 1)], b = points[Mathf.Min(points.Length - 1, i + 1)];
            Vector2 direction = new Vector2(b.x - a.x, b.z - a.z).normalized;
            return new Vector2(-direction.y, direction.x);
        }

        private Material Material(string resource, Color color, float smoothness, float metallic)
        {
            Material source = Resources.Load<Material>("RealmOfAshes/" + resource);
            if (source == null) throw new InvalidOperationException("Missing railway material: " + resource);
            var result = new Material(source) { name = resource };
            result.SetColor("_BaseColor", color);
            if (result.HasProperty("_Smoothness")) result.SetFloat("_Smoothness", smoothness);
            if (result.HasProperty("_Metallic")) result.SetFloat("_Metallic", metallic);
            _materials.Add(result);
            return result;
        }

        private void Create(string name, Geometry geometry, Material material)
        {
            var child = new GameObject(name);
            child.transform.SetParent(transform, false);
            var mesh = new Mesh { name = "DamRoad" + name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(geometry.vertices);
            mesh.SetUVs(0, geometry.uv);
            mesh.SetTriangles(geometry.triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            child.AddComponent<MeshFilter>().sharedMesh = mesh;
            child.AddComponent<MeshRenderer>().sharedMaterial = material;
            _meshes.Add(mesh);
        }

        private sealed class Geometry
        {
            public readonly List<Vector3> vertices = new List<Vector3>();
            public readonly List<Vector2> uv = new List<Vector2>();
            public readonly List<int> triangles = new List<int>();
            private static Vector3 Vertex(Vector2 p, float y) => new Vector3(p.x, SurfaceAt(p.x, p.y) + y, p.y);
            public void Ribbon(Vector2 a, Vector2 b, Vector2 sideA, Vector2 sideB, float offset, float halfWidth, float y)
            {
                Quad(Vertex(a + sideA * (offset - halfWidth), y), Vertex(b + sideB * (offset - halfWidth), y),
                    Vertex(b + sideB * (offset + halfWidth), y), Vertex(a + sideA * (offset + halfWidth), y));
            }
            public void Vertical(Vector2 a, Vector2 b, float bottom, float top)
            {
                Quad(Vertex(a, bottom), Vertex(b, bottom), Vertex(b, top), Vertex(a, top));
            }
            public void Slope(Vector2 a, Vector2 b, Vector2 c, Vector2 d, float innerY, float outerY)
            {
                Vector3 va = Vertex(a, innerY), vb = Vertex(b, innerY), vc = Vertex(c, outerY), vd = Vertex(d, outerY);
                if (Vector3.Cross(vc - va, vb - va).y >= 0f) Quad(va, vb, vd, vc);
                else Quad(vc, vd, vb, va);
            }
            public void Box(Vector2 centre, Vector2 direction, Vector2 side,
                float halfLength, float halfWidth, float bottom, float top)
            {
                Vector2 a = centre - direction * halfLength - side * halfWidth;
                Vector2 b = centre + direction * halfLength - side * halfWidth;
                Vector2 c = centre + direction * halfLength + side * halfWidth;
                Vector2 d = centre - direction * halfLength + side * halfWidth;
                Quad(Vertex(a, top), Vertex(b, top), Vertex(c, top), Vertex(d, top));
                Vertical(a, b, bottom, top); Vertical(b, c, bottom, top);
                Vertical(c, d, bottom, top); Vertical(d, a, bottom, top);
            }
            private void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d)
            {
                int n = vertices.Count;
                vertices.AddRange(new[] { a, b, c, d });
                foreach (Vector3 p in new[] { a, b, c, d }) uv.Add(new Vector2(p.x, p.z) * 1.7f);
                triangles.AddRange(new[] { n, n + 3, n + 1, n + 1, n + 3, n + 2 });
            }
        }

        private void OnDestroy()
        {
            foreach (Mesh mesh in _meshes) Release(mesh);
            foreach (Material material in _materials) Release(material);
        }
        private static void Release(UnityEngine.Object asset)
        {
            if (Application.isPlaying) Destroy(asset); else DestroyImmediate(asset);
        }
    }
}
