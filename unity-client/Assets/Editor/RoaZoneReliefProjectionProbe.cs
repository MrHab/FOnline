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
            Require(Vector2.Distance(site, new Vector2(205f, 218f)) < 1.5f,
                "The checkpoint has drifted beyond its world-map marker area.");
            Require(Vector2.Distance(RoaZoneReliefProjection.MapPoint(-160f, 160f, 320f, 320f),
                new Vector2(200f, 200f)) < 0.001f, "North-west zone edge drifted.");
            Require(Vector2.Distance(RoaZoneReliefProjection.MapPoint(160f, -160f, 320f, 320f),
                new Vector2(220f, 220f)) < 0.001f, "South-east zone edge drifted.");
            Require(Vector2.Distance(RoaZoneReliefProjection.MapPoint(0f, 0f, 320f, 320f),
                new Vector2(210f, 210f)) < 0.001f, "Zone relief scale is not uniform.");

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
                Require(water != null && water.transform.Find("OutpostSpillway") != null,
                    "The outpost spillway water is missing.");
                Require(RoaDamRoadWaterProjection.Contains(-104.755f, -106f),
                    "The outpost bridge does not cross water.");
                Require(RoaDamRoadWaterProjection.CanalDepthAt(-104.755f, -106f) > 1.6f,
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
            Debug.Log("[ROA DAM ROAD RELIEF] PASS: map scale, zone edges, level checkpoint and walk mesh.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
