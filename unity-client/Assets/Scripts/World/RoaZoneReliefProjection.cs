using System;
using Kromka.Authoring;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Projects the authored world-map height field into a local zone. The dam road is
    /// the first sector using it: its 20 km map cell is represented by a 320 m play area.
    /// The checkpoint apron stays level so authored cover and the bridge still meet.
    /// </summary>
    public sealed class RoaZoneReliefProjection : MonoBehaviour
    {
        public const string DamRoadZone = "z_10_10";
        public const float ZoneMapPoints = 20f;
        public const float DamRoadCenterX = -82f;
        public const float DamRoadCenterZ = -106f;
        private const float LevelRadius = 68f;
        private const float BlendRadius = 104f;
        private const float VerticalGain = 3f;
        private const int Segments = 64;

        private Mesh _mesh;

        public static bool Supports(string locationId) =>
            string.Equals(locationId, DamRoadZone, StringComparison.Ordinal);

        public static Vector2 MapPoint(float localX, float localZ, float worldWidth, float worldDepth)
        {
            // One uniform transform preserves the global height field's plan shape.
            // The world-map icon is approximate; the authored checkpoint centre is
            // 22 metres north of its exact projected position in this local scene.
            float u = localX / worldWidth + 0.5f;
            float v = localZ / worldDepth + 0.5f;
            return new Vector2(200f + u * ZoneMapPoints, 220f - v * ZoneMapPoints);
        }

        public static float HeightAt(RoaGlobalMapRelief relief, float localX, float localZ,
                                     float worldWidth, float worldDepth)
        {
            if (relief == null || !relief.Ready) return 0f;
            Vector2 point = MapPoint(localX, localZ, worldWidth, worldDepth);
            Vector2 origin = MapPoint(DamRoadCenterX, DamRoadCenterZ, worldWidth, worldDepth);
            float distance = Vector2.Distance(new Vector2(localX, localZ),
                new Vector2(DamRoadCenterX, DamRoadCenterZ));
            float t = Mathf.Clamp01((distance - LevelRadius) / (BlendRadius - LevelRadius));
            float apronBlend = t * t * (3f - 2f * t);
            return Mathf.Clamp((relief.HeightAt(point.x, point.y)
                    - relief.HeightAt(origin.x, origin.y)) * VerticalGain * apronBlend,
                -0.55f, 0.25f);
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
            var projection = ground.gameObject.AddComponent<RoaZoneReliefProjection>();
            projection._mesh = BuildMesh(relief, worldWidth, worldDepth);
            filter.sharedMesh = projection._mesh;
            BoxCollider flat = ground.GetComponent<BoxCollider>();
            if (flat != null) flat.enabled = false;
            MeshCollider surface = ground.gameObject.AddComponent<MeshCollider>();
            surface.sharedMesh = projection._mesh;

            // Static models elsewhere in the zone follow the projected surface.
            // The whole checkpoint lies on the level apron, so its authored heights
            // and the collision boxes exported for the server are left intact.
            foreach (KromkaPlacedObjectAuthoring placed in ground.transform.root
                         .GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if (placed == null || placed.gameObject == ground.gameObject) continue;
                if (placed.GetComponentInParent<RoaZoneReliefProjection>() != null) continue;
                KromkaPlacedObjectAuthoring parentPlaced = placed.transform.parent != null
                    ? placed.transform.parent.GetComponentInParent<KromkaPlacedObjectAuthoring>() : null;
                if (parentPlaced != null) continue;
                Vector3 position = placed.transform.position;
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
                float worldX = (u - 0.5f) * width;
                float worldZ = (v - 0.5f) * depth;
                int index = z * side + x;
                // The authored ground is a 320 x 0.5 x 320 cube at y = -0.3.
                // Its top is -0.05, so local 0.5 remains the visual baseline.
                vertices[index] = new Vector3(u - 0.5f,
                    0.5f + HeightAt(relief, worldX, worldZ, width, depth) * 2f, v - 0.5f);
                uv[index] = new Vector2(u, v);
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
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private void OnDestroy()
        {
            if (_mesh == null) return;
            if (Application.isPlaying) Destroy(_mesh);
            else DestroyImmediate(_mesh);
        }
    }
}
