using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Cheap deterministic dressing for the runtime wasteland surface. It breaks up
    /// the empty backplate with ankle-high scrub, stones and a distant low ridge,
    /// while deliberately creating no colliders or gameplay state.
    /// </summary>
    public sealed class RoaGroundDressing : MonoBehaviour
    {
        private const int Grass = 0;
        private const int Dark = 4;
        public const int ScrubBladeCount = 6;
        public const int StoneClusterPieceCount = 4;

        private GameObject _root;
        private Mesh _scrubMesh;
        private Mesh _stoneMesh;
        private Material _scrubMaterial;
        private Material _stoneMaterial;

        public int SurfaceClusterCount { get; private set; }
        public int ScrubClusterCount { get; private set; }
        public int StoneClusterCount { get; private set; }
        public int RidgeCount { get; private set; }
        public int VertexCount { get; private set; }

        public static int SurfaceBudget(bool mobile)
        {
            return mobile ? 60 : 120;
        }

        public static int RidgeBudget(bool mobile)
        {
            return mobile ? 16 : 28;
        }

        public static bool SupportsTile(int type)
        {
            return type == Grass || type == Dark;
        }

        public void Build(LocationDefinition location, JArray stateMap, int mapWidth, int mapDepth,
                          float visualWidth, float visualDepth)
        {
            ClearGenerated();
            if (location == null) return;

            bool mobile = Application.isMobilePlatform;
            bool settlement = string.Equals(location.Id, "settlement", StringComparison.Ordinal);
            int seed = unchecked((int)location.Seed);
            float worldWidth = Mathf.Max(RoaCoords.Tile, location.WorldWidth);
            float worldDepth = Mathf.Max(RoaCoords.Tile, location.WorldDepth);

            var scrubVertices = new List<Vector3>();
            var scrubTriangles = new List<int>();
            var stoneVertices = new List<Vector3>();
            var stoneTriangles = new List<int>();

            int budget = SurfaceBudget(mobile);
            int attempts = budget * 7;
            for (int i = 0; i < attempts && SurfaceClusterCount < budget; i++)
            {
                float x = (Hash01(i, seed, 8101) - 0.5f) * worldWidth * 0.92f;
                float z = (Hash01(i, seed, 8103) - 0.5f) * worldDepth * 0.92f;
                if (!SupportsPosition(location, stateMap, mapWidth, mapDepth, x, z, settlement)) continue;
                if (KeepClear(location, x, z, mapWidth, mapDepth, settlement)) continue;

                float yaw = Hash01(i, seed, 8107) * Mathf.PI * 2f;
                float scale = 0.90f + Hash01(i, seed, 8111) * 1.15f;
                if (Hash01(i, seed, 8113) < 0.56f)
                {
                    AppendScrub(scrubVertices, scrubTriangles, new Vector3(x, 0.004f, z), yaw, scale, i, seed);
                    ScrubClusterCount++;
                }
                else
                {
                    AppendStoneCluster(stoneVertices, stoneTriangles,
                        new Vector3(x, -0.012f, z), yaw, scale, i, seed);
                    StoneClusterCount++;
                }
                SurfaceClusterCount++;
            }

            AppendDistantRidge(stoneVertices, stoneTriangles, worldWidth, worldDepth,
                Mathf.Max(worldWidth, visualWidth), Mathf.Max(worldDepth, visualDepth), seed, mobile);

            _root = new GameObject("GroundDressing");
            _root.transform.SetParent(transform, false);
            if (scrubVertices.Count > 0)
            {
                _scrubMesh = CreateMesh("RuntimeGroundScrubMesh", scrubVertices, scrubTriangles);
                _scrubMaterial = CreateMaterial("RuntimeGroundScrubMaterial",
                    settlement ? new Color(0.48f, 0.37f, 0.14f) : new Color(0.52f, 0.40f, 0.15f), true);
                CreateRenderNode("Scrub", _scrubMesh, _scrubMaterial, !mobile);
            }
            if (stoneVertices.Count > 0)
            {
                _stoneMesh = CreateMesh("RuntimeGroundStoneMesh", stoneVertices, stoneTriangles);
                _stoneMaterial = CreateMaterial("RuntimeGroundStoneMaterial",
                    settlement ? new Color(0.42f, 0.35f, 0.27f) : new Color(0.40f, 0.33f, 0.25f), false);
                CreateRenderNode("StonesAndDistantRidge", _stoneMesh, _stoneMaterial, !mobile);
            }
            VertexCount = scrubVertices.Count + stoneVertices.Count;
        }

        private static bool SupportsPosition(LocationDefinition location, JArray stateMap,
                                             int mapWidth, int mapDepth, float x, float z,
                                             bool settlement)
        {
            if (stateMap == null || mapWidth <= 0 || mapDepth <= 0) return settlement;
            RoaCoords.WorldToTile(new Vector3(x, 0f, z), mapWidth, mapDepth, out int tx, out int tz);
            if (tx < 0 || tz < 0 || tx >= mapWidth || tz >= mapDepth || tz >= stateMap.Count) return false;
            JArray row = stateMap[tz] as JArray;
            if (row == null || tx >= row.Count) return false;
            return SupportsTile(row[tx]?.ToObject<int>() ?? Grass);
        }

        private static bool KeepClear(LocationDefinition location, float x, float z,
                                      int mapWidth, int mapDepth, bool settlement)
        {
            Vector2 point = new Vector2(x, z);
            if (settlement && Mathf.Abs(x) < 28f && Mathf.Abs(z) < 24f) return true;
            if (!settlement && point.sqrMagnitude < 13.5f) return true;

            if (NearTile(point, location.Spawn, mapWidth, mapDepth, 2.6f)
                || NearTile(point, location.EntryFromWorld, mapWidth, mapDepth, 2.6f)) return true;
            if (location.Exit != null && NearTile(point,
                new TileCoord { Tx = location.Exit.Tx, Tz = location.Exit.Tz }, mapWidth, mapDepth, 2.8f)) return true;
            if (location.Transitions != null)
            {
                for (int i = 0; i < location.Transitions.Count; i++)
                {
                    LocationTransition transition = location.Transitions[i];
                    if (transition != null && NearTile(point,
                        new TileCoord { Tx = transition.Tx, Tz = transition.Tz },
                        mapWidth, mapDepth, Mathf.Max(2.5f, transition.Radius + 0.8f))) return true;
                }
            }

            if (location.Objects == null) return false;
            for (int i = 0; i < location.Objects.Count; i++)
            {
                LocationObject entry = location.Objects[i];
                if (entry?.Position == null) continue;
                Vector3 world = RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z);
                Vector2 delta = point - new Vector2(world.x, world.z);
                float radius = entry.IsLiveEntity() ? 1.2f : 1.85f;
                if (delta.sqrMagnitude < radius * radius) return true;
            }
            return false;
        }

        private static bool NearTile(Vector2 point, TileCoord tile, int mapWidth, int mapDepth, float radius)
        {
            if (tile == null || mapWidth <= 0 || mapDepth <= 0) return false;
            Vector3 world = RoaCoords.TileToWorld(tile.Tx, tile.Tz, mapWidth, mapDepth);
            Vector2 delta = point - new Vector2(world.x, world.z);
            return delta.sqrMagnitude < radius * radius;
        }

        private static void AppendScrub(List<Vector3> vertices, List<int> triangles,
                                        Vector3 center, float yaw, float scale, int index, int seed)
        {
            for (int blade = 0; blade < ScrubBladeCount; blade++)
            {
                float angle = yaw + blade * Mathf.PI / ScrubBladeCount;
                float width = (0.11f + Hash01(index, blade, seed + 8121) * 0.09f) * scale;
                float height = (0.32f + Hash01(index, blade, seed + 8123) * 0.24f) * scale;
                Vector3 side = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * width;
                Vector3 lean = new Vector3(Mathf.Sin(angle), 0f, -Mathf.Cos(angle)) * height * 0.12f;
                int start = vertices.Count;
                vertices.Add(center - side);
                vertices.Add(center + side);
                vertices.Add(center + side * 0.28f + Vector3.up * height + lean);
                vertices.Add(center - side * 0.28f + Vector3.up * height + lean);
                triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 1);
                triangles.Add(start); triangles.Add(start + 3); triangles.Add(start + 2);
            }
        }

        private static void AppendStoneCluster(List<Vector3> vertices, List<int> triangles,
                                               Vector3 center, float yaw, float scale,
                                               int index, int seed)
        {
            for (int piece = 0; piece < StoneClusterPieceCount; piece++)
            {
                float angle = yaw + piece * Mathf.PI * 0.72f
                    + (Hash01(index, piece, seed + 8135) - 0.5f) * 0.42f;
                float spread = piece == 0 ? 0f
                    : (0.22f + Hash01(index, piece, seed + 8137) * 0.20f) * scale;
                Vector3 offset = new Vector3(Mathf.Cos(angle) * spread, 0f,
                    Mathf.Sin(angle) * spread);
                float baseRadius = piece == 0
                    ? 0.25f + Hash01(index, piece, seed + 8139) * 0.10f
                    : 0.12f + Hash01(index, piece, seed + 8140) * 0.08f;
                float radius = baseRadius * scale;
                float height = radius * (0.54f + Hash01(index, piece, seed + 8142) * 0.24f);
                AppendStone(vertices, triangles, center + offset, angle, radius, height,
                    index * StoneClusterPieceCount + piece, seed + 19, 6);
            }
        }

        private static void AppendStone(List<Vector3> vertices, List<int> triangles,
                                        Vector3 center, float yaw, float radius, float height,
                                        int index, int seed, int sides)
        {
            int start = vertices.Count;
            vertices.Add(center + Vector3.up * height);
            for (int side = 0; side < sides; side++)
            {
                float angle = yaw + side / (float)sides * Mathf.PI * 2f;
                float jitter = 0.74f + Hash01(index, side, seed + 8131) * 0.42f;
                vertices.Add(center + new Vector3(Mathf.Cos(angle) * radius * jitter,
                    0f, Mathf.Sin(angle) * radius * (0.72f + jitter * 0.22f)));
            }
            for (int side = 0; side < sides; side++)
            {
                triangles.Add(start);
                triangles.Add(start + 1 + side);
                triangles.Add(start + 1 + (side + 1) % sides);
            }
        }

        private void AppendDistantRidge(List<Vector3> vertices, List<int> triangles,
                                        float worldWidth, float worldDepth,
                                        float visualWidth, float visualDepth, int seed, bool mobile)
        {
            int count = RidgeBudget(mobile);
            float playableX = worldWidth * 0.5f;
            float playableZ = worldDepth * 0.5f;
            float outerX = visualWidth * 0.5f - 3f;
            float outerZ = visualDepth * 0.5f - 3f;
            for (int i = 0; i < count; i++)
            {
                int side = i & 3;
                float along = Hash01(i, seed, 8141) * 2f - 1f;
                float depth = 0.28f + Hash01(i, seed, 8143) * 0.58f;
                float x;
                float z;
                if (side == 0 || side == 1)
                {
                    x = along * Mathf.Max(4f, outerX - 2f);
                    z = Mathf.Lerp(playableZ + 5f, outerZ, depth) * (side == 0 ? 1f : -1f);
                }
                else
                {
                    x = Mathf.Lerp(playableX + 5f, outerX, depth) * (side == 2 ? 1f : -1f);
                    z = along * Mathf.Max(4f, outerZ - 2f);
                }
                float radius = 1.25f + Hash01(i, seed, 8147) * 2.2f;
                float height = 0.42f + Hash01(i, seed, 8149) * 1.05f;
                AppendStone(vertices, triangles, new Vector3(x, -0.055f, z),
                    Hash01(i, seed, 8153) * Mathf.PI * 2f, radius, height, i, seed + 37, 7);
                RidgeCount++;
            }
        }

        private void CreateRenderNode(string name, Mesh mesh, Material material, bool castShadows)
        {
            var node = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            node.transform.SetParent(_root.transform, false);
            node.GetComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = node.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = true;
        }

        private static Mesh CreateMesh(string name, List<Vector3> vertices, List<int> triangles)
        {
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Material CreateMaterial(string name, Color color, bool twoSided)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (shader == null) return null;
            var material = new Material(shader) { name = name, color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.015f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.015f);
            if (twoSided && material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            material.doubleSidedGI = twoSided;
            return material;
        }

        private static float Hash01(int a, int b, int c)
        {
            unchecked
            {
                uint value = (uint)((a ^ unchecked((int)0x9e3779b9)) * unchecked((int)0x85ebca6b));
                value ^= (uint)((b + unchecked((int)0xc2b2ae35)) * unchecked((int)0x27d4eb2d));
                value ^= (uint)((c + unchecked((int)0x165667b1)) * unchecked((int)0x9e3779b1));
                value ^= value >> 15;
                return (value % 100000u) / 100000f;
            }
        }

        private void ClearGenerated()
        {
            DisposeObject(_root);
            DisposeObject(_scrubMesh);
            DisposeObject(_stoneMesh);
            DisposeObject(_scrubMaterial);
            DisposeObject(_stoneMaterial);
            _root = null;
            _scrubMesh = null;
            _stoneMesh = null;
            _scrubMaterial = null;
            _stoneMaterial = null;
            SurfaceClusterCount = 0;
            ScrubClusterCount = 0;
            StoneClusterCount = 0;
            RidgeCount = 0;
            VertexCount = 0;
        }

        private void OnDestroy()
        {
            ClearGenerated();
        }

        private static void DisposeObject(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
