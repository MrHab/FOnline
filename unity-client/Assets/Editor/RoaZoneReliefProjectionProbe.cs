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

            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
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
                float min = float.PositiveInfinity, max = float.NegativeInfinity;
                foreach (Vector3 vertex in mesh.vertices)
                {
                    min = Mathf.Min(min, vertex.y);
                    max = Mathf.Max(max, vertex.y);
                }
                Require(max - min > 0.1f, "Relief remains visually flat.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(ground);
            }
            Debug.Log("[ROA DAM ROAD RELIEF] PASS: map scale, zone edges, level checkpoint and walk mesh.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
