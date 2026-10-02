using System;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaZoneReliefProjectionProbe
    {
        [MenuItem("Realm of Ashes/Zones/Check dam road relief")]
        public static void Run()
        {
            Vector2 site = RoaZoneReliefProjection.MapPoint(-82f, -106f, 320f, 320f);
            Require(Vector2.Distance(site, new Vector2(201f, 217f)) < 1f,
                "The checkpoint has drifted beyond its world-map marker area.");
            Require(Vector2.Distance(RoaZoneReliefProjection.MapPoint(-160f, 160f, 320f, 320f),
                new Vector2(195.8f, 200f)) < 0.001f, "North-west cutout edge drifted.");
            Require(Vector2.Distance(RoaZoneReliefProjection.MapPoint(160f, -160f, 320f, 320f),
                new Vector2(215.8f, 220f)) < 0.001f, "South-east cutout edge drifted.");
            Require(Vector2.Distance(RoaZoneReliefProjection.MapPoint(0f, 0f, 320f, 320f),
                new Vector2(205.8f, 210f)) < 0.001f, "Zone relief scale is not uniform.");

            RoaGlobalMapRelief relief = Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            Require(relief != null && relief.Ready, "The authored global-map height field is unavailable.");
            Require(Mathf.Abs(RoaZoneReliefProjection.HeightAt(relief, -82f, -106f, 320f, 320f)) < 0.001f,
                "Checkpoint apron is not level.");
            Require(Mathf.Abs(RoaZoneReliefProjection.HeightAt(relief, -31f, -106f, 320f, 320f)) < 0.001f,
                "The checkpoint approach is not level.");
            Vector2 outer = RoaZoneReliefProjection.MapPoint(120f, 120f, 320f, 320f);
            float mapDelta = relief.HeightAt(outer.x, outer.y) - relief.HeightAt(site.x, site.y);
            Require(Mathf.Abs(RoaZoneReliefProjection.HeightAt(relief, 120f, 120f, 320f, 320f)
                - mapDelta * 160f) < 0.001f, "Local height does not match the map's visual scale.");

            var host = new GameObject("ProjectionProbeRoot");
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ground.transform.SetParent(host.transform, false);
            try
            {
                ground.transform.position = new Vector3(0f, -0.3f, 0f);
                ground.transform.localScale = new Vector3(320f, 0.5f, 320f);
                RoaZoneReliefProjection.Project(ground.GetComponent<Renderer>(), 320f, 320f);
                Mesh mesh = ground.GetComponent<MeshFilter>().sharedMesh;
                Require(mesh != null && mesh.vertexCount > 4000, "Projected ground mesh is missing.");
                Require(ground.GetComponent<MeshCollider>()?.sharedMesh == mesh,
                    "Walk surface and rendered relief differ.");
                Require(!ground.GetComponent<BoxCollider>().enabled, "Flat collision still covers the relief.");
                Require(Mathf.Abs(RoaCoords.ToUnity(120f, 120f).y
                    - RoaZoneReliefProjection.HeightAt(relief, 120f, 120f, 320f, 320f)) < 0.001f,
                    "Actors are not placed on the projected terrain.");
                float min = float.PositiveInfinity, max = float.NegativeInfinity;
                foreach (Vector3 vertex in mesh.vertices)
                {
                    min = Mathf.Min(min, vertex.y);
                    max = Mathf.Max(max, vertex.y);
                }
                Require((max - min) * 0.5f > 12f, "Relief remains visually flat.");
                var water = host.GetComponentInChildren<RoaDamRoadWaterProjection>();
                Mesh river = water?.transform.Find("TesmaRiver")?.GetComponent<MeshFilter>()?.sharedMesh;
                Require(river != null && river.bounds.size.z >= 319f,
                    "The Tesma does not cross the full local sector.");
                Mesh sourceRiver = Resources.Load<Mesh>("RealmOfAshes/DamRoadRiverSource");
                Require(sourceRiver != null, "The source river on the global map is unavailable.");
                AssertBankProjection(river, sourceRiver, relief, -7f, 0);
                AssertBankProjection(river, sourceRiver, relief, -5.5f, 96 * 2);
                AssertBankProjection(river, sourceRiver, relief, -5f, river.vertexCount - 2);
                Require(RoaDamRoadWaterProjection.Contains(-104.755f, -106f),
                    "The outpost bridge does not cross water.");
                Require(RoaDamRoadWaterProjection.Contains(-30f, 80f),
                    "The global-map river is missing beyond the concrete spillway.");
                Require(!RoaDamRoadWaterProjection.Contains(-70f, -95.7f),
                    "The checkpoint NPC area was flooded by the river.");
                Require(RoaDamRoadWaterProjection.BedDepthAt(-104.755f, -106f) > 1.6f,
                    "The outpost spillway has no recessed bed.");
                Require(Mathf.Abs(RoaZoneReliefProjection.GroundHeightAt(-104.755f, -106f)) < 0.01f,
                    "The bridge deck is not at the authored walk height.");
                Require(water.transform.Find("OutpostBridgeWalkSurface")?.GetComponent<BoxCollider>() != null,
                    "The outpost bridge cannot be crossed.");
                Physics.SyncTransforms();
                bool crossesBridge = false;
                foreach (RaycastHit hit in Physics.RaycastAll(new Vector3(-104.755f, 3f, -106f),
                             Vector3.down, 6f))
                    crossesBridge |= hit.collider.name == "OutpostBridgeWalkSurface"
                        && Mathf.Abs(hit.point.y) < 0.01f;
                Require(crossesBridge, "The bridge collider does not cover the carved channel.");
                Require(RoaDamRoadWaterProjection.InWater(new Vector3(-104.755f, -1f, -106f)),
                    "The spillway does not register as water.");
                Require(!RoaDamRoadWaterProjection.InWater(new Vector3(-104.755f, 0.3f, -106f)),
                    "The bridge deck is incorrectly underwater.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
            Require(Mathf.Abs(RoaCoords.ToUnity(120f, 120f).y) < 0.001f,
                "The old zone's terrain is still active after unload.");
            Debug.Log("[ROA DAM ROAD RELIEF] PASS: map scale, Tesma banks, level checkpoint and bridge walk mesh.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void AssertBankProjection(Mesh river, Mesh source,
                                                 RoaGlobalMapRelief relief,
                                                 float sourceZ, int localIndex)
        {
            Vector3[] sourceVertices = source.vertices;
            int[] triangles = source.triangles;
            float left = float.PositiveInfinity, right = float.NegativeInfinity;
            for (int index = 0; index < triangles.Length; index += 3)
            {
                for (int side = 0; side < 3; side++)
                {
                    Vector3 a = sourceVertices[triangles[index + side]];
                    Vector3 b = sourceVertices[triangles[index + (side + 1) % 3]];
                    if ((a.z - sourceZ) * (b.z - sourceZ) > 0f
                        || Mathf.Abs(a.z - b.z) < 0.000001f) continue;
                    float x = Mathf.Lerp(a.x, b.x, (sourceZ - a.z) / (b.z - a.z));
                    if (x < -1f || x > 3f) continue;
                    left = Mathf.Min(left, x);
                    right = Mathf.Max(right, x);
                }
            }
            Require(!float.IsInfinity(left), "The source river misses a sector edge.");
            float mapWest = RoaZoneReliefProjection.DamRoadMapWest;
            float expectedLeft = Mathf.Max(-160f,
                ((left / 0.1f + relief.WidthPoints * 0.5f - mapWest) / 20f - 0.5f) * 320f);
            float expectedRight = Mathf.Min(160f,
                ((right / 0.1f + relief.WidthPoints * 0.5f - mapWest) / 20f - 0.5f) * 320f);
            Vector3[] localVertices = river.vertices;
            Require(Mathf.Abs(localVertices[localIndex].x - expectedLeft) < 0.25f
                && Mathf.Abs(localVertices[localIndex + 1].x - expectedRight) < 0.25f,
                "Local river banks do not match the global-map water mesh.");
        }
    }
}
