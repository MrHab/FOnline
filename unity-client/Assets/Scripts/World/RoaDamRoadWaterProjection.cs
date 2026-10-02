using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Samples both banks of the authored Tesma water mesh into the dam-road cutout.
    /// The river narrows into Outpost 17's concrete spillway and opens again beyond it.
    /// </summary>
    public sealed class RoaDamRoadWaterProjection : MonoBehaviour
    {
        private const string RiverMeshKey = "RealmOfAshes/DamRoadRiverSource";
        private const string WaterMaterialKey = "RealmOfAshes/DamRoadRiver";
        private const float MapWorldScale = 0.1f;
        private const float CanalX = -104.755f;
        private const float CanalMinZ = -140f;
        private const float CanalMaxZ = -72f;
        private const float CanalWaterHalfWidth = 4.6f;
        private const float BedDepth = 1.65f;
        private const int Segments = 128;

        private static float[] _centers;
        private static float[] _halfWidths;
        private static RoaGlobalMapRelief _preparedRelief;
        private static float _preparedWidth;
        private static float _preparedDepth;
        private static RoaDamRoadWaterProjection _active;

        private Mesh _mesh;
        private RoaGlobalMapRelief _relief;
        private float _width;
        private float _depth;

        public static void Prepare(RoaGlobalMapRelief relief, float worldWidth, float worldDepth)
        {
            if (relief == null || !relief.Ready) return;
            if (_preparedRelief == relief && _preparedWidth == worldWidth
                && _preparedDepth == worldDepth && _centers != null) return;
            Mesh source = Resources.Load<Mesh>(RiverMeshKey);
            if (source == null)
            {
                Debug.LogError("[ROA] The authored Tesma water mesh is missing.");
                return;
            }
            Vector3[] vertices = source.vertices;
            int[] triangles = source.triangles;
            var centers = new float[Segments + 1];
            var halfWidths = new float[Segments + 1];
            for (int step = 0; step <= Segments; step++)
            {
                float z = (step / (float)Segments - 0.5f) * worldDepth;
                float mapY = RoaZoneReliefProjection.MapPoint(0f, z, worldWidth, worldDepth).y;
                float sourceZ = (relief.HeightPoints * 0.5f - mapY) * MapWorldScale;
                float left = float.PositiveInfinity, right = float.NegativeInfinity;
                for (int index = 0; index < triangles.Length; index += 3)
                {
                    Vector3 a = vertices[triangles[index]];
                    Vector3 b = vertices[triangles[index + 1]];
                    Vector3 c = vertices[triangles[index + 2]];
                    Intersect(a, b, sourceZ, ref left, ref right);
                    Intersect(b, c, sourceZ, ref left, ref right);
                    Intersect(c, a, sourceZ, ref left, ref right);
                }
                if (float.IsInfinity(left) || right - left < 0.01f)
                {
                    Debug.LogError($"[ROA] Tesma has no banks at local z={z:0.0}.");
                    return;
                }
                float localLeft = ProjectX(left, relief, worldWidth);
                float localRight = ProjectX(right, relief, worldWidth);
                localLeft = Mathf.Max(-worldWidth * 0.5f, localLeft);
                localRight = Mathf.Min(worldWidth * 0.5f, localRight);
                float pinch = Pinch(z, worldDepth);
                centers[step] = Mathf.Lerp((localLeft + localRight) * 0.5f, CanalX, pinch);
                halfWidths[step] = Mathf.Lerp((localRight - localLeft) * 0.5f,
                    CanalWaterHalfWidth, pinch);
            }
            _centers = centers;
            _halfWidths = halfWidths;
            _preparedRelief = relief;
            _preparedWidth = worldWidth;
            _preparedDepth = worldDepth;
        }

        public static float BedDepthAt(float x, float z)
        {
            if (!ProfileAt(z, out float center, out float halfWidth)) return 0f;
            float taper = Mathf.Lerp(8f, 4.4f, Pinch(z, _preparedDepth));
            return BedDepth * (1f - Smoothstep(halfWidth, halfWidth + taper,
                Mathf.Abs(x - center)));
        }

        public static bool IsBridgeDeck(float x, float z) =>
            Mathf.Abs(x - CanalX) <= 8f && Mathf.Abs(z + 106f) <= 3.6f;

        public static bool Contains(float x, float z) =>
            _active != null && ProfileAt(z, out float center, out float halfWidth)
            && Mathf.Abs(x - center) <= halfWidth;

        public static bool InWater(Vector3 world) =>
            Contains(world.x, world.z)
            && !(IsBridgeDeck(world.x, world.z) && world.y >= 0f)
            && world.y <= _active.WaterHeightAt(world.z) + 0.04f;

        public static void Build(Renderer ground, RoaGlobalMapRelief relief,
                                 float worldWidth, float worldDepth)
        {
            if (ground == null || relief == null || !relief.Ready) return;
            Prepare(relief, worldWidth, worldDepth);
            Material water = Resources.Load<Material>(WaterMaterialKey);
            if (_centers == null || water == null)
            {
                Debug.LogError("[ROA] Dam road river assets are missing.");
                return;
            }
            var root = new GameObject("DamRoadProjectedWater");
            root.transform.SetParent(ground.transform.parent, false);
            var projection = root.AddComponent<RoaDamRoadWaterProjection>();
            projection._relief = relief;
            projection._width = worldWidth;
            projection._depth = worldDepth;
            projection.BuildRiver(water);
            projection.BuildBridgeWalkSurface();
            _active = projection;
        }

        private static void Intersect(Vector3 a, Vector3 b, float z, ref float left, ref float right)
        {
            if ((a.z - z) * (b.z - z) > 0f || Mathf.Abs(a.z - b.z) < 0.000001f) return;
            float t = (z - a.z) / (b.z - a.z);
            float x = Mathf.Lerp(a.x, b.x, t);
            // Only the Tesma strip crosses this map cutout; exclude detached water bodies.
            if (x < -1f || x > 3f) return;
            left = Mathf.Min(left, x);
            right = Mathf.Max(right, x);
        }

        private static float ProjectX(float sourceX, RoaGlobalMapRelief relief, float worldWidth)
        {
            float mapX = sourceX / MapWorldScale + relief.WidthPoints * 0.5f;
            return ((mapX - RoaZoneReliefProjection.DamRoadMapWest)
                / RoaZoneReliefProjection.ZoneMapPoints - 0.5f) * worldWidth;
        }

        private static bool ProfileAt(float z, out float center, out float halfWidth)
        {
            center = 0f;
            halfWidth = 0f;
            if (_centers == null || Mathf.Abs(z) > _preparedDepth * 0.5f) return false;
            float step = (z / _preparedDepth + 0.5f) * Segments;
            int lower = Mathf.Clamp(Mathf.FloorToInt(step), 0, Segments);
            int upper = Mathf.Min(lower + 1, Segments);
            float blend = step - lower;
            center = Mathf.Lerp(_centers[lower], _centers[upper], blend);
            halfWidth = Mathf.Lerp(_halfWidths[lower], _halfWidths[upper], blend);
            return true;
        }

        private static float Pinch(float z, float depth)
        {
            float south = Smoothstep(-depth * 0.5f, CanalMinZ, z);
            float north = 1f - Smoothstep(CanalMaxZ, CanalMaxZ + 48f, z);
            return south * north;
        }

        private float WaterHeightAt(float z)
        {
            if (!ProfileAt(z, out float center, out _)) return float.NegativeInfinity;
            float land = RoaZoneReliefProjection.RawHeightAt(_relief, center, z, _width, _depth);
            float level = Mathf.Lerp(-0.45f, 0.8f, Pinch(z, _depth));
            float underBridge = 1f - Smoothstep(3f, 7f, Mathf.Abs(z + 106f));
            return land + Mathf.Lerp(level, -0.4f, underBridge);
        }

        private void BuildRiver(Material material)
        {
            var vertices = new List<Vector3>((Segments + 1) * 2);
            var uv = new List<Vector2>(vertices.Capacity);
            var triangles = new List<int>(Segments * 6);
            for (int index = 0; index <= Segments; index++)
            {
                float z = (index / (float)Segments - 0.5f) * _depth;
                ProfileAt(z, out float center, out float halfWidth);
                float y = WaterHeightAt(z);
                vertices.Add(new Vector3(center - halfWidth, y, z));
                vertices.Add(new Vector3(center + halfWidth, y, z));
                uv.Add(new Vector2(0f, index * 0.25f));
                uv.Add(new Vector2(1f, index * 0.25f));
                if (index == Segments) continue;
                int first = index * 2;
                triangles.Add(first); triangles.Add(first + 2); triangles.Add(first + 1);
                triangles.Add(first + 1); triangles.Add(first + 2); triangles.Add(first + 3);
            }
            _mesh = new Mesh { name = "TesmaRiverDamRoad" };
            _mesh.SetVertices(vertices);
            _mesh.SetUVs(0, uv);
            _mesh.SetTriangles(triangles, 0);
            _mesh.RecalculateNormals();
            _mesh.RecalculateBounds();
            var surface = new GameObject("TesmaRiver");
            surface.transform.SetParent(transform, false);
            surface.AddComponent<MeshFilter>().sharedMesh = _mesh;
            var renderer = surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        private void BuildBridgeWalkSurface()
        {
            var deck = new GameObject("OutpostBridgeWalkSurface");
            deck.transform.SetParent(transform, false);
            deck.transform.localPosition = new Vector3(CanalX, -0.12f, -106f);
            var collider = deck.AddComponent<BoxCollider>();
            collider.size = new Vector3(16f, 0.24f, 7.2f);
        }

        private static float Smoothstep(float start, float end, float value)
        {
            float t = Mathf.Clamp01((value - start) / (end - start));
            return t * t * (3f - 2f * t);
        }

        private void OnDisable()
        {
            if (_active == this) _active = null;
        }

        private void OnDestroy()
        {
            if (_active == this) _active = null;
            if (_mesh == null) return;
            if (Application.isPlaying) Destroy(_mesh);
            else DestroyImmediate(_mesh);
        }
    }
}
