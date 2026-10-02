using System;
using System.IO;
using System.Collections.Generic;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaDamRoadRailProbe
    {
        [MenuItem("Realm of Ashes/Zones/Check dam road railway")]
        public static void Run()
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            var definition = JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(
                Path.Combine(root, "data/zones/authored/z_10_10.json")));
            EditorSceneManager.OpenScene("Assets/Scenes/Kromka/Locations/z_10_10.unity");
            var location = UnityEngine.Object.FindFirstObjectByType<RoaUnityLocationScene>();
            var painter = new GameObject("RailProbeGroundPainter");
            painter.AddComponent<RoaLocalTerrain>().InitializeAuthoredSurface(definition, null, location.GroundRenderer);
            try
            {
                Physics.SyncTransforms();
                var rail = UnityEngine.Object.FindFirstObjectByType<RoaDamRoadRailProjection>();
                if (rail == null || rail.GetComponentsInChildren<MeshFilter>().Length != 4)
                    throw new InvalidOperationException("Railway render geometry is missing.");
                if (rail.GetComponentsInChildren<Collider>().Length != 0)
                    throw new InvalidOperationException("Rail components block the shared deck.");
                AssertVisibleDeckRails(location);
                var points = rail.Profile.points;
                if (Mathf.Abs(points[0].x + 160f) > 0.001f || Mathf.Abs(points[points.Length - 1].x - 160f) > 0.001f)
                    throw new InvalidOperationException("Railway does not reach both sector edges.");
                for (int i = 0; i < points.Length; i++)
                {
                    var p = points[i];
                    if (RoaDamRoadWaterProjection.InWater(new Vector3(p.x, 0f, p.z)))
                        throw new InvalidOperationException($"Railway enters water at {p.x}, {p.z}.");
                    if (p.x > -122f && p.x < -87f && Mathf.Abs(p.z + 106f) > 0.001f)
                        throw new InvalidOperationException("Rails miss the bridge deck.");
                    if (i % 4 != 0 || i < 8 || i > points.Length - 9) continue;
                    float y = RoaDamRoadRailProjection.SurfaceAt(p.x, p.z);
                    var overlaps = Physics.OverlapCapsule(new Vector3(p.x, y + 0.55f, p.z),
                        new Vector3(p.x, y + 1.45f, p.z), 0.32f);
                    foreach (Collider collider in overlaps)
                        if (collider.bounds.max.y > y + 0.4f)
                            throw new InvalidOperationException($"Track blocked at {p.x}, {p.z} by {collider.name} < {collider.transform.parent?.name}.");
                }
                Debug.Log("[ROA DAM ROAD RAIL] PASS: continuous railway on both banks, flush shared crossing, clear route corridor.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(painter);
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
            RoaDamRoadBridgeWalkProbe.Run();
        }

        private static void AssertVisibleDeckRails(RoaUnityLocationScene location)
        {
            var proxies = new List<GameObject>();
            var decks = new List<MeshCollider>();
            try
            {
                foreach (var placed in location.GetComponentsInChildren<Kromka.Authoring.KromkaPlacedObjectAuthoring>())
                {
                    if (!placed.StableObjectId.StartsWith("roadOutpost_bridge_deck_", StringComparison.Ordinal)) continue;
                    foreach (MeshFilter filter in placed.GetComponentsInChildren<MeshFilter>())
                    {
                        var proxy = new GameObject("ImportedBridgeSurfaceProbe");
                        proxies.Add(proxy);
                        proxy.transform.SetPositionAndRotation(filter.transform.position, filter.transform.rotation);
                        proxy.transform.localScale = filter.transform.lossyScale;
                        MeshCollider collider = proxy.AddComponent<MeshCollider>();
                        collider.sharedMesh = filter.sharedMesh;
                        decks.Add(collider);
                    }
                }
                Physics.SyncTransforms();
                for (float x = -118f; x < -90f; x += 2f)
                foreach (float z in new[] { -106.8f, -105.2f })
                {
                    float top = float.NegativeInfinity;
                    foreach (MeshCollider deck in decks)
                        if (deck.Raycast(new Ray(new Vector3(x, 3f, z), Vector3.down), out RaycastHit hit, 6f))
                            top = Mathf.Max(top, hit.point.y);
                    if (!float.IsFinite(top)) throw new InvalidOperationException("No imported deck under railway.");
                    float railTop = RoaDamRoadRailProjection.SurfaceAt(x, z) + 0.032f;
                    if (railTop < top + 0.004f || railTop > top + 0.04f)
                        throw new InvalidOperationException($"Rail head at {railTop} is buried or floating above native deck {top}.");
                    if (Mathf.Abs(top - RoaZoneReliefProjection.GroundHeightAt(x, z)) > 0.01f)
                        throw new InvalidOperationException("Actor feet and the native bridge deck disagree.");
                }
            }
            finally { foreach (GameObject proxy in proxies) UnityEngine.Object.DestroyImmediate(proxy); }
        }
    }
}
