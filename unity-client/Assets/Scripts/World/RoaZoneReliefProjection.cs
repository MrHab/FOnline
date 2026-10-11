using System;
using Kromka.Authoring;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Projects the authored world-map height field into a local zone. The dam road is
    /// the first sector using it: a 20 km cutout at the Tesma crossing becomes a 320 m
    /// play area. The checkpoint apron stays level around its authored structures.
    /// </summary>
    public sealed class RoaZoneReliefProjection : MonoBehaviour
    {
        public const string DamRoadZone = "z_10_10";
        public const float ZoneMapPoints = 20f;
        // The playable cutout is centred on the Tesma crossing, slightly west of
        // the administrative cell centre. This keeps the map river under the bridge.
        public const float DamRoadMapWest = 195.8f;
        public const float DamRoadCenterX = -82f;
        public const float DamRoadCenterZ = -106f;
        private const float LevelHalfWidth = 70f;
        private const float LevelHalfDepth = 30f;
        private const float BlendWidth = 24f;
        // The map renders 20 points across this cell at 0.1 units per point.
        // Stretching those 2 units to a 320 m zone requires the same factor on Y.
        private const float VerticalGain = 160f;
        private const int Segments = 256;

        private Mesh _mesh;
        private RoaGlobalMapRelief _relief;
        private float _width;
        private float _depth;
        private static RoaZoneReliefProjection _active;

        public static float GroundHeightAt(float localX, float localZ)
        {
            if (_active == null || _active._relief == null) return 0f;
            if (Mathf.Abs(localX) > _active._width * 0.5f
                || Mathf.Abs(localZ) > _active._depth * 0.5f) return 0f;
            return RoaDamRoadWaterProjection.IsBridgeDeck(localX, localZ)
                ? RoaDamRoadWaterProjection.BridgeWalkHeightAt(localX, localZ)
                : HeightAt(_active._relief, localX, localZ, _active._width, _active._depth);
        }

        public static bool Supports(string locationId) =>
            string.Equals(locationId, DamRoadZone, StringComparison.Ordinal);

        public static Vector2 MapPoint(float localX, float localZ, float worldWidth, float worldDepth)
        {
            // One uniform transform preserves the global height field and river shape.
            // The cutout is centred on the crossing, west of the administrative cell.
            float u = localX / worldWidth + 0.5f;
            float v = localZ / worldDepth + 0.5f;
            return new Vector2(DamRoadMapWest + u * ZoneMapPoints, 220f - v * ZoneMapPoints);
        }

        public static float HeightAt(RoaGlobalMapRelief relief, float localX, float localZ,
                                     float worldWidth, float worldDepth)
        {
            RoaDamRoadWaterProjection.Prepare(relief, worldWidth, worldDepth);
            return RoaDamRoadWaterProjection.BedHeightAt(relief, localX, localZ,
                worldWidth, worldDepth);
        }

        public static float RawHeightAt(RoaGlobalMapRelief relief, float localX, float localZ,
                                        float worldWidth, float worldDepth)
        {
            if (relief == null || !relief.Ready) return 0f;
            Vector2 point = MapPoint(localX, localZ, worldWidth, worldDepth);
            Vector2 origin = MapPoint(DamRoadCenterX, DamRoadCenterZ, worldWidth, worldDepth);
            float dx = Mathf.Max(0f, Mathf.Abs(localX - DamRoadCenterX) - LevelHalfWidth);
            float dz = Mathf.Max(0f, Mathf.Abs(localZ - DamRoadCenterZ) - LevelHalfDepth);
            float t = Mathf.Clamp01(new Vector2(dx, dz).magnitude / BlendWidth);
            float apronBlend = t * t * (3f - 2f * t);
            return (relief.HeightAt(point.x, point.y)
                    - relief.HeightAt(origin.x, origin.y)) * VerticalGain * apronBlend;
        }

        public static void Project(Renderer ground, float worldWidth, float worldDepth)
        {
            if (ground == null || worldWidth <= 0f || worldDepth <= 0f) return;
            RoaGlobalMapRelief relief = Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            if (relief == null || !relief.Ready)
            {
                Debug.LogWarning("[ROA] Dam road relief asset is missing; keeping its level ground.");
                return;
            }
            MeshFilter filter = ground.GetComponent<MeshFilter>();
            if (filter == null || ground.GetComponent<RoaZoneReliefProjection>() != null) return;
            RoaDamRoadWaterProjection.Prepare(relief, worldWidth, worldDepth);
            var projection = ground.gameObject.AddComponent<RoaZoneReliefProjection>();
            projection._relief = relief;
            projection._width = worldWidth;
            projection._depth = worldDepth;
            projection._mesh = BuildMesh(relief, worldWidth, worldDepth);
            filter.sharedMesh = projection._mesh;
            BoxCollider flat = ground.GetComponent<BoxCollider>();
            if (flat != null) flat.enabled = false;
            MeshCollider surface = ground.gameObject.AddComponent<MeshCollider>();
            surface.sharedMesh = projection._mesh;
            _active = projection;
            RoaDamRoadWaterProjection.Build(ground, relief, worldWidth, worldDepth);
            RoaDamRoadRailProjection.Build(ground);

            // Static models elsewhere in the zone follow the projected surface.
            // The checkpoint and bridge keep their authored heights and collision.
            foreach (KromkaPlacedObjectAuthoring placed in ground.transform.root
                         .GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if (placed == null || placed.gameObject == ground.gameObject) continue;
                if (placed.GetComponentInParent<RoaZoneReliefProjection>() != null) continue;
                if (placed.StableObjectId.StartsWith("roadOutpost_", StringComparison.Ordinal)) continue;
                KromkaPlacedObjectAuthoring parentPlaced = placed.transform.parent != null
                    ? placed.transform.parent.GetComponentInParent<KromkaPlacedObjectAuthoring>() : null;
                if (parentPlaced != null) continue;
                Vector3 position = placed.transform.position;
                if (placed.Role != "terrain"
                    && RoaDamRoadWaterProjection.Contains(position.x, position.z))
                {
                    placed.gameObject.SetActive(false);
                    continue;
                }
                position.y += HeightAt(relief, position.x, position.z, worldWidth, worldDepth);
                placed.transform.position = position;
            }
        }

        private static Mesh BuildMesh(RoaGlobalMapRelief relief, float width, float depth)
        {
            int side = Segments + 1;
            var vertices = new Vector3[side * side];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[Segments * Segments * 6];
            for (int z = 0; z < side; z++)
            for (int x = 0; x < side; x++)
            {
                float u = x / (float)Segments;
                float v = z / (float)Segments;
                float worldZ = (v - 0.5f) * depth;
                float worldX = (u - 0.5f) * width;
                // Pin one ground vertex to each exact bank at every river row.
                // The terrain and water then share a continuous shoreline even
                // where the regular grid would otherwise cut across the river.
                if (RoaDamRoadWaterProjection.TryBanksAt(worldZ,
                    out float leftBank, out float rightBank))
                {
                    int leftColumn = Mathf.RoundToInt((leftBank / width + 0.5f) * Segments);
                    int rightColumn = Mathf.RoundToInt((rightBank / width + 0.5f) * Segments);
                    if (x == leftColumn) worldX = leftBank;
                    else if (x == rightColumn) worldX = rightBank;
                }
                int index = z * side + x;
                // The authored ground is a 320 x 0.5 x 320 cube at y = -0.3.
                // Its top is -0.05, so local 0.5 remains the visual baseline.
                vertices[index] = new Vector3(worldX / width,
                    0.5f + HeightAt(relief, worldX, worldZ, width, depth) * 2f, v - 0.5f);
                uv[index] = new Vector2(worldX / width + 0.5f, v);
            }
            int next = 0;
            for (int z = 0; z < Segments; z++)
            for (int x = 0; x < Segments; x++)
            {
                int a = z * side + x, b = a + 1, c = a + side, d = c + 1;
                triangles[next++] = a; triangles[next++] = c; triangles[next++] = b;
                triangles[next++] = b; triangles[next++] = c; triangles[next++] = d;
            }
            var mesh = new Mesh { name = "DamRoadProjectedRelief" };
            mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
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
