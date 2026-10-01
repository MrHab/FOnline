using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>Recesses the authored outpost spillway and places water beneath its bridge.</summary>
    public sealed class RoaDamRoadWaterProjection : MonoBehaviour
    {
        private const string WaterMaterialKey = "RealmOfAshes/DamRoadRiver";
        private const float CanalX = -104.755f;
        private const float CanalMinZ = -140f;
        private const float CanalMaxZ = -72f;
        private const float CanalWaterHalfWidth = 4.6f;
        private const float CanalBedDepth = 1.65f;

        private Mesh _mesh;
        private RoaGlobalMapRelief _relief;
        private float _width;
        private float _depth;
        private static RoaDamRoadWaterProjection _active;

        public static float CanalDepthAt(float x, float z)
        {
            float bank = 1f - Smoothstep(CanalWaterHalfWidth, 9f, Mathf.Abs(x - CanalX));
            float start = Smoothstep(CanalMinZ, CanalMinZ + 6f, z);
            float end = 1f - Smoothstep(CanalMaxZ - 6f, CanalMaxZ, z);
            return CanalBedDepth * bank * start * end;
        }

        public static bool IsBridgeDeck(float x, float z) =>
            Mathf.Abs(x - CanalX) <= 8f && Mathf.Abs(z + 106f) <= 3.6f;

        public static bool Contains(float x, float z) =>
            _active != null && IsCanalWater(x, z);

        public static bool InWater(Vector3 world) =>
            _active != null && IsCanalWater(world.x, world.z)
            && !(IsBridgeDeck(world.x, world.z) && world.y >= 0f)
            && world.y <= _active.BaseHeightAt(world.x, world.z) + WaterLevel(world.z) + 0.04f;

        public static void Build(Renderer ground, RoaGlobalMapRelief relief,
                                 float worldWidth, float worldDepth)
        {
            if (ground == null || relief == null || !relief.Ready) return;
            Material water = Resources.Load<Material>(WaterMaterialKey);
            if (water == null)
            {
                Debug.LogError("[ROA] Dam road water material is missing.");
                return;
            }
            var root = new GameObject("DamRoadProjectedWater");
            root.transform.SetParent(ground.transform.parent, false);
            var projection = root.AddComponent<RoaDamRoadWaterProjection>();
            projection._relief = relief;
            projection._width = worldWidth;
            projection._depth = worldDepth;
            projection.BuildCanal(water);
            projection.BuildBridgeWalkSurface();
            _active = projection;
        }

        private static bool IsCanalWater(float x, float z) =>
            Mathf.Abs(x - CanalX) <= CanalWaterHalfWidth
            && z >= CanalMinZ + 2f && z <= CanalMaxZ - 2f;

        private float BaseHeightAt(float x, float z) =>
            RoaZoneReliefProjection.HeightAt(_relief, x, z, _width, _depth)
            + CanalDepthAt(x, z);

        private void BuildCanal(Material material)
        {
            const int segments = 68;
            var vertices = new List<Vector3>((segments + 1) * 2);
            var uv = new List<Vector2>(vertices.Capacity);
            var triangles = new List<int>(segments * 6);
            for (int index = 0; index <= segments; index++)
            {
                float z = Mathf.Lerp(CanalMinZ, CanalMaxZ, index / (float)segments);
                float y = BaseHeightAt(CanalX, z) + WaterLevel(z);
                vertices.Add(new Vector3(CanalX - CanalWaterHalfWidth, y, z));
                vertices.Add(new Vector3(CanalX + CanalWaterHalfWidth, y, z));
                uv.Add(new Vector2(0f, index * 0.25f));
                uv.Add(new Vector2(1f, index * 0.25f));
                if (index == segments) continue;
                int first = index * 2;
                triangles.Add(first); triangles.Add(first + 2); triangles.Add(first + 1);
                triangles.Add(first + 1); triangles.Add(first + 2); triangles.Add(first + 3);
            }
            _mesh = new Mesh { name = "OutpostSpillway" };
            _mesh.SetVertices(vertices);
            _mesh.SetUVs(0, uv);
            _mesh.SetTriangles(triangles, 0);
            _mesh.RecalculateNormals();
            _mesh.RecalculateBounds();
            var surface = new GameObject("OutpostSpillway");
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

        private static float WaterLevel(float z) =>
            -0.4f + 1.2f * Smoothstep(3f, 7f, Mathf.Abs(z + 106f));

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
