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
        public const int ScrubBladeCount = 7;
        public const float MinimumSurfaceSpacing = 0.72f;
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
        public float MinimumClusterSpacing { get; private set; }

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
            var accepted = new List<Vector2>();
            float minimumSpacing = float.PositiveInfinity;
            int attempts = budget * 12;
            for (int i = 0; i < attempts && SurfaceClusterCount < budget; i++)
            {
                float x = (Hash01(i, seed, 8101) - 0.5f) * worldWidth * 0.92f;
                float z = (Hash01(i, seed, 8103) - 0.5f) * worldDepth * 0.92f;
                if (!SupportsPosition(location, stateMap, mapWidth, mapDepth, x, z, settlement)) continue;
                if (KeepClear(location, x, z, mapWidth, mapDepth, settlement)) continue;

                float patch = PatchDensity(x, z, seed);
                if (Hash01(i, seed, 8167) > 0.24f + patch * 0.72f) continue;
                Vector2 point = new Vector2(x, z);
                float nearest = NearestDistance(point, accepted);
                if (nearest < MinimumSurfaceSpacing) continue;

                float yaw = Hash01(i, seed, 8107) * Mathf.PI * 2f;
                float sizeRandom = Hash01(i, seed, 8111);
                float scale = 0.65f + Mathf.Pow(sizeRandom, 1.65f) * 0.72f;
                if (Hash01(i, seed, 8113) < Mathf.Lerp(0.50f, 0.70f, patch))
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
                if (!float.IsInfinity(nearest)) minimumSpacing = Mathf.Min(minimumSpacing, nearest);
                accepted.Add(point);
                SurfaceClusterCount++;
            }
            MinimumClusterSpacing = float.IsInfinity(minimumSpacing) ? 0f : minimumSpacing;
            AppendDistantRidge(stoneVertices, stoneTriangles, worldWidth, worldDepth,
                Mathf.Max(worldWidth, visualWidth), Mathf.Max(worldDepth, visualDepth), seed, mobile);

            _root = new GameObject("GroundDressing");
            _root.transform.SetParent(transform, false);
            if (scrubVertices.Count > 0)
            {
                _scrubMesh = CreateMesh("RuntimeGroundScrubMesh", scrubVertices, scrubTriangles);
                _scrubMaterial = CreateMaterial("RuntimeGroundScrubMaterial",
                    settlement ? new Color(0.42f, 0.35f, 0.14f) : new Color(0.38f, 0.35f, 0.16f),
                    true, 0f);
                CreateRenderNode("Scrub", _scrubMesh, _scrubMaterial, false);
            }
            if (stoneVertices.Count > 0)
            {
                _stoneMesh = CreateMesh("RuntimeGroundStoneMesh", stoneVertices, stoneTriangles);
                _stoneMaterial = CreateMaterial("RuntimeGroundStoneMaterial",
                    settlement ? new Color(0.50f, 0.43f, 0.35f) : new Color(0.46f, 0.42f, 0.36f),
                    false, 0.035f);
                CreateRenderNode("StonesAndDistantRidge", _stoneMesh, _stoneMaterial, false);
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
                float angle = yaw + Hash01(index, blade, seed + 8120) * Mathf.PI * 2f;
                float length = (0.22f + Hash01(index, blade, seed + 8121) * 0.28f) * scale;
                float height = (0.08f + Hash01(index, blade, seed + 8123) * 0.12f) * scale;
                float width = (0.050f + Hash01(index, blade, seed + 8125) * 0.044f) * scale;
                Vector3 direction = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle));
                Vector3 sideOffset = new Vector3(-direction.z, 0f, direction.x)
                    * ((Hash01(index, blade, seed + 8126) - 0.5f) * 0.10f * scale);
                Vector3 branchStart = center + direction * (0.018f * scale) + sideOffset;
                Vector3 branchEnd = center + direction * length + Vector3.up * height;
                AppendTaperedBranch(vertices, triangles, branchStart, branchEnd, width,
                    width * (0.42f + Hash01(index, blade, seed + 8127) * 0.22f));
            }
            AppendStone(vertices, triangles, center - Vector3.up * 0.012f, yaw,
                0.16f * scale, 0.12f * scale, index, seed + 53, 5);
        }

        private static void AppendTaperedBranch(List<Vector3> vertices, List<int> triangles,
                                                Vector3 from, Vector3 to,
                                                float baseRadius, float tipRadius)
        {
            Vector3 axis = (to - from).normalized;
            Vector3 lateral = Vector3.Cross(Vector3.up, axis).normalized;
            if (lateral.sqrMagnitude < 0.5f) lateral = Vector3.right;
            Vector3 vertical = Vector3.Cross(axis, lateral).normalized;
            int start = vertices.Count;
            vertices.Add(from - lateral * baseRadius - vertical * baseRadius * 0.55f);
            vertices.Add(from + lateral * baseRadius - vertical * baseRadius * 0.55f);
            vertices.Add(from + lateral * baseRadius + vertical * baseRadius * 0.55f);
            vertices.Add(from - lateral * baseRadius + vertical * baseRadius * 0.55f);
            vertices.Add(to - lateral * tipRadius - vertical * tipRadius * 0.55f);
            vertices.Add(to + lateral * tipRadius - vertical * tipRadius * 0.55f);
            vertices.Add(to + lateral * tipRadius + vertical * tipRadius * 0.55f);
            vertices.Add(to - lateral * tipRadius + vertical * tipRadius * 0.55f);
            AppendQuad(triangles, start, 0, 1, 5, 4);
            AppendQuad(triangles, start, 1, 2, 6, 5);
            AppendQuad(triangles, start, 2, 3, 7, 6);
            AppendQuad(triangles, start, 3, 0, 4, 7);
            AppendQuad(triangles, start, 4, 5, 6, 7);
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
            for (int side = 0; side < sides; side++)
            {
                float angle = yaw + side / (float)sides * Mathf.PI * 2f;
                float jitter = 0.74f + Hash01(index, side, seed + 8131) * 0.42f;
                vertices.Add(center + new Vector3(Mathf.Cos(angle) * radius * jitter,
                    0f, Mathf.Sin(angle) * radius * (0.72f + jitter * 0.22f)));
            }
            int shoulder = vertices.Count;
            for (int side = 0; side < sides; side++)
            {
                float angle = yaw + 0.08f + side / (float)sides * Mathf.PI * 2f;
                float jitter = 0.82f + Hash01(index, side, seed + 8133) * 0.30f;
                vertices.Add(center + new Vector3(Mathf.Cos(angle) * radius * 0.72f * jitter,
                    height * (0.52f + Hash01(index, side, seed + 8134) * 0.12f),
                    Mathf.Sin(angle) * radius * 0.66f * jitter));
            }
            int crown = vertices.Count;
            vertices.Add(center + new Vector3(
                (Hash01(index, seed, 8173) - 0.5f) * radius * 0.30f,
                height,
                (Hash01(index, seed, 8177) - 0.5f) * radius * 0.30f));
            for (int side = 0; side < sides; side++)
            {
                int next = (side + 1) % sides;
                AppendQuad(triangles, 0, start + side, start + next,
                    shoulder + next, shoulder + side);
                triangles.Add(shoulder + side);
                triangles.Add(shoulder + next);
                triangles.Add(crown);
            }
        }

        private static void AppendQuad(List<int> triangles, int offset,
                                       int a, int b, int c, int d)
        {
            triangles.Add(offset + a); triangles.Add(offset + c); triangles.Add(offset + b);
            triangles.Add(offset + a); triangles.Add(offset + d); triangles.Add(offset + c);
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

        private static Material CreateMaterial(string name, Color color, bool twoSided,
                                               float emissionLift)
        {
            Shader shader = twoSided
                ? (Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color"))
                : (Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
            if (shader == null) return null;
            var material = new Material(shader) { name = name, color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.015f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.015f);
            if (material.HasProperty("_EmissionColor") && emissionLift > 0f)
            {
                material.SetColor("_EmissionColor", color.linear * emissionLift);
                material.EnableKeyword("_EMISSION");
            }
            if (twoSided && material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            material.doubleSidedGI = twoSided;
            return material;
        }

        private static float PatchDensity(float x, float z, int seed)
        {
            float gx = x / 9f;
            float gz = z / 9f;
            int ix = Mathf.FloorToInt(gx);
            int iz = Mathf.FloorToInt(gz);
            float tx = Mathf.SmoothStep(0f, 1f, gx - ix);
            float tz = Mathf.SmoothStep(0f, 1f, gz - iz);
            float a = Mathf.Lerp(Hash01(ix, iz, seed + 8161),
                Hash01(ix + 1, iz, seed + 8161), tx);
            float b = Mathf.Lerp(Hash01(ix, iz + 1, seed + 8161),
                Hash01(ix + 1, iz + 1, seed + 8161), tx);
            return Mathf.Lerp(a, b, tz);
        }

        private static float NearestDistance(Vector2 point, List<Vector2> accepted)
        {
            float nearest = float.PositiveInfinity;
            for (int i = 0; i < accepted.Count; i++)
                nearest = Mathf.Min(nearest, Vector2.Distance(point, accepted[i]));
            return nearest;
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
            MinimumClusterSpacing = 0f;
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
