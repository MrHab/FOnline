#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Outer-wasteland iteration 02/20. Extends the completed north-west impact
    /// field into a western evacuation graveyard without making the exterior
    /// routable. The seam includes the previous sector's crater deformation so
    /// the two independently-authored meshes remain watertight.
    /// </summary>
    internal static class KromkaGlobalMapOuterWastelandIteration02Authoring
    {
        private const string GlobalScenePath =
            "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string MeshRoot = "Assets/Art/Kromka/Meshes/";
        private const string TerrainMeshPath = MeshRoot
            + "Kromka_OuterWesternEvacuationGraveyard_Iteration02.asset";
        private const string RouteMeshPath = MeshRoot
            + "Kromka_OuterWesternEvacuationRoute_Iteration02.asset";
        private const string ScorchMeshPath = MeshRoot
            + "Kromka_OuterWesternCraterScorch_Iteration02.asset";
        private const string GroundMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OuterNuclearGround_MEP.mat";
        private const string BaseRouteMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Road_MEP.mat";
        private const string RouteMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OuterEvacuationAsphalt_MEP.mat";
        private const string ScorchMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OuterNuclearCraterScorch_MEP.mat";
        private const string MajadroidRoot =
            "Assets/ThirdParty/OpenGameArt/MajadroidApocalypticBuildings/Models/";
        private const string UazRoot =
            "Assets/ThirdParty/OpenGameArt/MehozavrUaz452/";
        private const string UazDestroyedPath = UazRoot + "uaz_destroyed.fbx";
        private const string DeadTreeRoot =
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Trees/MEP_BrokenTrees/Prefabs/";

        private const float SectorStart = 2.513274f;
        private const float SectorEnd = 2.827433f;
        private const float InnerOutset = 0.09f;
        private const float OuterOutset = 0.60f;
        private const int AngularSegments = 32;
        private const int RadialSegments = 24;
        private const int CraterAngularSegments = 36;
        private const int CraterRadialRings = 5;
        private const int RoutePointCount = 25;

        private readonly struct CraterSpec
        {
            internal readonly string Name;
            internal readonly float Angle;
            internal readonly float Outset;
            internal readonly float Radius;
            internal readonly float Depth;
            internal readonly float Rim;

            internal CraterSpec(string name, float angle, float outset,
                                float radius, float depth, float rim)
            {
                Name = name;
                Angle = angle;
                Outset = outset;
                Radius = radius;
                Depth = depth;
                Rim = rim;
            }
        }

        private readonly struct PrefabPlacement
        {
            internal readonly string Name;
            internal readonly string AssetPath;
            internal readonly float Angle;
            internal readonly float Outset;
            internal readonly float Footprint;
            internal readonly float MaximumHeight;
            internal readonly float Yaw;
            internal readonly float Pitch;
            internal readonly float Roll;
            internal readonly float Embed;

            internal PrefabPlacement(string name, string assetPath,
                                     float angle, float outset,
                                     float footprint, float maximumHeight,
                                     float yaw, float pitch, float roll,
                                     float embed)
            {
                Name = name;
                AssetPath = assetPath;
                Angle = angle;
                Outset = outset;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Pitch = pitch;
                Roll = roll;
                Embed = embed;
            }
        }

        // Duplicated exactly from iteration 01 so its south-western crater lip
        // continues across the shared angular seam without a height crack.
        private static readonly CraterSpec[] PreviousCraters =
        {
            new CraterSpec("GroundZeroCrater", 2.385f, 0.405f,
                2.25f, 0.62f, 0.23f),
            new CraterSpec("SecondaryAirburstCrater", 2.245f, 0.435f,
                1.15f, 0.34f, 0.13f),
            new CraterSpec("CollapsedShelterCrater", 2.474f, 0.505f,
                0.82f, 0.25f, 0.095f)
        };

        private static readonly CraterSpec[] Craters =
        {
            new CraterSpec("EvacuationColumnImpactCrater", 2.680f, 0.340f,
                1.60f, 0.48f, 0.17f),
            new CraterSpec("WesternRelayBlastCrater", 2.795f, 0.495f,
                0.86f, 0.26f, 0.10f),
            new CraterSpec("RoadsideSecondaryCrater", 2.615f, 0.555f,
                0.62f, 0.19f, 0.075f)
        };

        private static readonly Vector2[] RoutePoints = BuildRoutePoints();

        private static readonly int[] BrokenRouteSegments = { 7, 8, 16, 17 };

        private static readonly PrefabPlacement[] Convoy =
        {
            new PrefabPlacement("DestroyedUaz_Lead", UazDestroyedPath,
                2.570f, 0.225f, 0.46f, 0.25f, -31f, 0f, 7f, 0.020f),
            new PrefabPlacement("DestroyedUaz_Centre", UazDestroyedPath,
                2.625f, 0.270f, 0.44f, 0.24f, 54f, 4f, -9f, 0.026f),
            new PrefabPlacement("DestroyedUaz_BlastTurned", UazDestroyedPath,
                2.725f, 0.365f, 0.45f, 0.24f, 121f, -3f, 11f, 0.028f),
            new PrefabPlacement("DestroyedUaz_Rear", UazDestroyedPath,
                2.785f, 0.430f, 0.43f, 0.23f, -72f, 2f, -6f, 0.022f)
        };

        private static readonly PrefabPlacement[] Ruins =
        {
            new PrefabPlacement("WesternCheckpointShell_A",
                MajadroidRoot + "building-02.fbx", 2.550f, 0.470f,
                0.90f, 1.02f, 18f, 0f, 0f, 0.035f),
            new PrefabPlacement("WesternCheckpointShell_B",
                MajadroidRoot + "building-06.fbx", 2.805f, 0.330f,
                0.86f, 0.96f, -27f, 0f, 0f, 0.038f),
            new PrefabPlacement("CheckpointBlastWreckage",
                MajadroidRoot + "wreckage-3-types.fbx", 2.745f, 0.165f,
                0.50f, 0.20f, 62f, 0f, 0f, 0.026f)
        };

        private static readonly PrefabPlacement[] DeadTrees =
        {
            new PrefabPlacement("BlastTree_00", DeadTreeRoot
                + "MEP_BrokenDeadTree_01_N.prefab", 2.535f, 0.355f,
                0.30f, 0.58f, 14f, 0f, 0f, 0.018f),
            new PrefabPlacement("BlastTree_01", DeadTreeRoot
                + "MEP_BrokenDeadTree_03_N.prefab", 2.585f, 0.445f,
                0.32f, 0.62f, -38f, 0f, 0f, 0.018f),
            new PrefabPlacement("BlastTree_02", DeadTreeRoot
                + "MEP_BrokenDeadTree_05_N.prefab", 2.650f, 0.155f,
                0.28f, 0.54f, 73f, 0f, 0f, 0.018f),
            new PrefabPlacement("BlastTree_03", DeadTreeRoot
                + "MEP_BrokenDeadTree_02_N.prefab", 2.715f, 0.545f,
                0.31f, 0.60f, 119f, 0f, 0f, 0.018f),
            new PrefabPlacement("BlastTree_04", DeadTreeRoot
                + "MEP_BrokenDeadTree_04_N.prefab", 2.765f, 0.255f,
                0.29f, 0.56f, -82f, 0f, 0f, 0.018f),
            new PrefabPlacement("BlastTree_05", DeadTreeRoot
                + "MEP_BrokenDeadTree_06_N.prefab", 2.820f, 0.535f,
                0.33f, 0.64f, 41f, 0f, 0f, 0.018f)
        };

        internal static void Compose(Transform staticContent)
        {
            Transform worldEdge = staticContent.Find("WorldEdge_AUTHORED");
            if (worldEdge == null)
                throw new InvalidOperationException(
                    "Outer-wasteland iteration 02 requires the authored world edge.");
            Transform outer = worldEdge.Find("OuterNuclearWasteland_AUTHORED");
            if (outer == null)
                throw new InvalidOperationException(
                    "Outer-wasteland iteration 01 must be composed first.");

            Transform previous = outer.Find(
                "Iteration02_WesternEvacuationGraveyard_10pct");
            if (previous != null)
                UnityEngine.Object.DestroyImmediate(previous.gameObject);
            Transform iteration = KromkaGlobalMapOuterWastelandAuthoring.Child(
                outer, "Iteration02_WesternEvacuationGraveyard_10pct");

            KromkaGlobalMapOuterWastelandAuthoring.CreateMeshObject(
                "Western_DevastatedTerrain", iteration,
                KromkaGlobalMapOuterWastelandAuthoring.PersistMesh(
                    TerrainMeshPath, BuildSectorTerrain()),
                KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                    GroundMaterialPath), false);
            KromkaGlobalMapOuterWastelandAuthoring.CreateMeshObject(
                "Western_BrokenEvacuationRoute", iteration,
                KromkaGlobalMapOuterWastelandAuthoring.PersistMesh(
                    RouteMeshPath, BuildEvacuationRoute()),
                BuildEvacuationRouteMaterial(), false);
            KromkaGlobalMapOuterWastelandAuthoring.CreateMeshObject(
                "WesternNuclearScorch_SURFACE_MEP", iteration,
                KromkaGlobalMapOuterWastelandAuthoring.PersistMesh(
                    ScorchMeshPath, BuildCraterScars()),
                KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                    ScorchMaterialPath), false);

            Transform craterRoot = KromkaGlobalMapOuterWastelandAuthoring.Child(
                iteration, "WesternImpactCraters_AUTHORED");
            for (int i = 0; i < Craters.Length; i++)
            {
                Transform marker = KromkaGlobalMapOuterWastelandAuthoring.Child(
                    craterRoot, Craters[i].Name
                        + "_DEFORMED_TERRAIN_REFERENCE");
                marker.position = PointAt(Craters[i].Angle, Craters[i].Outset);
            }

            PlaceSet(KromkaGlobalMapOuterWastelandAuthoring.Child(iteration,
                "MehozavrDestroyedUazConvoy_CC0_NATIVE_TEXTURES"), Convoy);
            PlaceSet(KromkaGlobalMapOuterWastelandAuthoring.Child(iteration,
                "WesternCheckpointRuins_CC0_NATIVE_TEXTURES"), Ruins);
            PlaceSet(KromkaGlobalMapOuterWastelandAuthoring.Child(iteration,
                "WesternBlastDeadwood_DIRECT_MEP"), DeadTrees);

            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "OuterWastelandProgress_10pct_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "OuterSectorsComplete_02_of_20_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "WesternEvacuationGraveyard_COMPLETE_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "CC0MehozavrUazNativeTextures_PRESERVED_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "ScorchedEvacuationConvoy_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "Iteration01To02_WATERTIGHT_SEAM_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate outer nuclear wasteland 10pct")]
        public static void ValidateIteration02()
        {
            GameObject outerObject = GameObject.Find(
                "OuterNuclearWasteland_AUTHORED");
            if (outerObject == null)
            {
                EditorSceneManager.OpenScene(GlobalScenePath, OpenSceneMode.Single);
                outerObject = GameObject.Find("OuterNuclearWasteland_AUTHORED");
            }
            KromkaGlobalMapOuterWastelandAuthoring.Require(outerObject != null,
                "The staged outer nuclear wasteland is missing.");
            Transform iteration = outerObject.transform.Find(
                "Iteration02_WesternEvacuationGraveyard_10pct");
            KromkaGlobalMapOuterWastelandAuthoring.Require(iteration != null,
                "Outer-wasteland iteration 02 is missing.");

            Transform terrain = iteration.Find("Western_DevastatedTerrain");
            MeshFilter terrainFilter = terrain != null
                ? terrain.GetComponent<MeshFilter>() : null;
            MeshRenderer terrainRenderer = terrain != null
                ? terrain.GetComponent<MeshRenderer>() : null;
            int expectedTerrainVertices = (AngularSegments + 1)
                * (RadialSegments + 1);
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                terrainFilter != null && terrainFilter.sharedMesh != null
                    && terrainFilter.sharedMesh.vertexCount
                        == expectedTerrainVertices,
                "The western devastated terrain sector is incomplete.");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                terrainRenderer != null && terrainRenderer.enabled
                    && terrainRenderer.sharedMaterial
                        == KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                            GroundMaterialPath),
                "The western sector lost its authored ground material.");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                terrainFilter.sharedMesh.vertices.All(vertex =>
                {
                    Vector3 world = terrain.TransformPoint(vertex);
                    Vector2 map = KromkaGlobalMapOuterWastelandAuthoring
                        .WorldToMap(world);
                    return !KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        map.x, map.y);
                }), "The western exterior intrudes into the playable region.");

            ValidateSharedSeam(outerObject.transform, terrainFilter);

            Transform route = iteration.Find("Western_BrokenEvacuationRoute");
            MeshFilter routeFilter = route != null
                ? route.GetComponent<MeshFilter>() : null;
            MeshRenderer routeRenderer = route != null
                ? route.GetComponent<MeshRenderer>() : null;
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                routeFilter != null && routeFilter.sharedMesh != null
                    && routeFilter.sharedMesh.vertexCount == RoutePoints.Length * 2
                    && routeRenderer != null
                    && routeRenderer.sharedMaterial
                        == KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                            RouteMaterialPath),
                "The broken western evacuation route is incomplete.");

            Transform scorch = iteration.Find("WesternNuclearScorch_SURFACE_MEP");
            MeshFilter scorchFilter = scorch != null
                ? scorch.GetComponent<MeshFilter>() : null;
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                scorchFilter != null && scorchFilter.sharedMesh != null
                    && scorchFilter.sharedMesh.vertexCount == Craters.Length
                        * (1 + CraterAngularSegments * CraterRadialRings),
                "The western crater-scorch mesh is incomplete.");

            Transform craterRoot = iteration.Find("WesternImpactCraters_AUTHORED");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                craterRoot != null && craterRoot.childCount == Craters.Length,
                "Three western impact craters are required.");
            for (int i = 0; i < Craters.Length; i++)
            {
                CraterSpec crater = Craters[i];
                Vector3 centre = PointAt(crater.Angle, crater.Outset);
                float baseAtCentre = BaseOuterHeight(crater.Angle,
                    crater.Outset);
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    centre.y < baseAtCentre - crater.Depth * 0.72f,
                    crater.Name + " lost its blast depression.");
            }

            ValidateSourceSet(iteration.Find(
                    "MehozavrDestroyedUazConvoy_CC0_NATIVE_TEXTURES"),
                Convoy, UazRoot, true, "destroyed UAZ convoy");
            ValidateSourceSet(iteration.Find(
                    "WesternCheckpointRuins_CC0_NATIVE_TEXTURES"),
                Ruins, "Assets/ThirdParty/OpenGameArt/"
                    + "MajadroidApocalypticBuildings/", true,
                "western checkpoint ruins");
            ValidateSourceSet(iteration.Find(
                    "WesternBlastDeadwood_DIRECT_MEP"),
                DeadTrees, "Assets/MEP/", false, "western blast deadwood");

            Transform convoyRoot = iteration.Find(
                "MehozavrDestroyedUazConvoy_CC0_NATIVE_TEXTURES");
            int convoyTriangles = convoyRoot.GetComponentsInChildren<MeshFilter>(true)
                .Where(filter => filter.sharedMesh != null)
                .Sum(filter => filter.sharedMesh.triangles.Length / 3);
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                convoyTriangles >= 3000 && convoyTriangles <= 6000,
                "The destroyed UAZ convoy is outside its WebGL triangle budget.");

            KromkaGlobalMapOuterWastelandAuthoring.Require(
                iteration.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Iteration 02 must not extend the playable collision area.");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                iteration.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Iteration 02 scenery must remain visible at every map zoom.");

            string[] markers =
            {
                "OuterWastelandProgress_10pct_REFERENCE",
                "OuterSectorsComplete_02_of_20_REFERENCE",
                "WesternEvacuationGraveyard_COMPLETE_REFERENCE",
                "CC0MehozavrUazNativeTextures_PRESERVED_REFERENCE",
                "ScorchedEvacuationConvoy_REFERENCE",
                "Iteration01To02_WATERTIGHT_SEAM_REFERENCE",
                "OutsidePlayableBoundary_NON_ROUTABLE_REFERENCE"
            };
            for (int i = 0; i < markers.Length; i++)
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    GameObject.Find(markers[i]) != null,
                    markers[i] + " is missing.");

            WriteUazSourceAudit(convoyRoot, convoyTriangles);
            Debug.Log("[KROMKA OUTER WASTELAND 10%] PASS: two contiguous "
                + "exterior sectors, six terrain-deformed impact craters, a "
                + "broken evacuation road, four destroyed CC0 UAZ-452 vans, "
                + "three checkpoint ruins and six direct-MEP blast trees; source "
                + "textures remain intact and the exterior is non-routable.");
        }

        private static Mesh BuildSectorTerrain()
        {
            var vertices = new List<Vector3>((AngularSegments + 1)
                * (RadialSegments + 1));
            var uv = new List<Vector2>(vertices.Capacity);
            var triangles = new List<int>(AngularSegments * RadialSegments * 6);
            for (int radial = 0; radial <= RadialSegments; radial++)
            {
                float radialT = radial / (float)RadialSegments;
                float outset = Mathf.Lerp(InnerOutset, OuterOutset, radialT);
                for (int angular = 0; angular <= AngularSegments; angular++)
                {
                    float angle = Mathf.Lerp(SectorStart, SectorEnd,
                        angular / (float)AngularSegments);
                    Vector3 point = PointAt(angle, outset);
                    vertices.Add(point);
                    uv.Add(MapUv(point));
                }
            }
            int row = AngularSegments + 1;
            for (int radial = 0; radial < RadialSegments; radial++)
            {
                for (int angular = 0; angular < AngularSegments; angular++)
                {
                    int a = radial * row + angular;
                    int b = a + row;
                    triangles.Add(a); triangles.Add(a + 1); triangles.Add(b);
                    triangles.Add(a + 1); triangles.Add(b + 1);
                    triangles.Add(b);
                }
            }
            var mesh = new Mesh
            {
                name = "Kromka_OuterWesternEvacuationGraveyard_Iteration02",
                indexFormat = IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh BuildEvacuationRoute()
        {
            var vertices = new List<Vector3>(RoutePoints.Length * 2);
            var uv = new List<Vector2>(RoutePoints.Length * 2);
            var triangles = new List<int>((RoutePoints.Length - 1
                - BrokenRouteSegments.Length) * 6);
            for (int i = 0; i < RoutePoints.Length; i++)
            {
                Vector3 centre = PointAt(RoutePoints[i].x, RoutePoints[i].y);
                Vector2 previousSpec = RoutePoints[Mathf.Max(0, i - 1)];
                Vector2 nextSpec = RoutePoints[Mathf.Min(RoutePoints.Length - 1,
                    i + 1)];
                Vector3 direction = PointAt(nextSpec.x, nextSpec.y)
                    - PointAt(previousSpec.x, previousSpec.y);
                direction.y = 0f;
                direction.Normalize();
                float halfWidth = 0.255f + Mathf.Sin(i * 2.19f) * 0.025f;
                Vector3 side = Vector3.Cross(Vector3.up, direction) * halfWidth;
                centre.y += 0.026f;
                vertices.Add(centre - side);
                vertices.Add(centre + side);
                uv.Add(new Vector2(0f, i * 0.82f));
                uv.Add(new Vector2(1f, i * 0.82f));
            }
            for (int segment = 0; segment < RoutePoints.Length - 1; segment++)
            {
                if (BrokenRouteSegments.Contains(segment)) continue;
                int row = segment * 2;
                triangles.Add(row); triangles.Add(row + 2);
                triangles.Add(row + 1);
                triangles.Add(row + 1); triangles.Add(row + 2);
                triangles.Add(row + 3);
            }
            var mesh = new Mesh
            {
                name = "Kromka_OuterWesternEvacuationRoute_Iteration02"
            };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Vector2[] BuildRoutePoints()
        {
            var points = new Vector2[RoutePointCount];
            for (int i = 0; i < points.Length; i++)
            {
                float t = i / (float)(points.Length - 1);
                float angle = Mathf.Lerp(2.530f, 2.820f, t);
                float outset = Mathf.Lerp(0.175f, 0.470f, t)
                    + Mathf.Sin(t * Mathf.PI) * 0.018f
                    - Mathf.Sin(t * Mathf.PI * 2f) * 0.009f;
                points[i] = new Vector2(angle, outset);
            }
            return points;
        }

        private static Mesh BuildCraterScars()
        {
            float[] ringRadius = { 0.18f, 0.45f, 0.72f, 1.02f, 1.28f };
            float[] ringAlpha = { 0.90f, 0.96f, 1.00f, 0.72f, 0.00f };
            int vertexCount = Craters.Length
                * (1 + CraterAngularSegments * CraterRadialRings);
            var vertices = new List<Vector3>(vertexCount);
            var uv = new List<Vector2>(vertexCount);
            var colors = new List<Color>(vertexCount);
            var triangles = new List<int>(Craters.Length
                * CraterAngularSegments * (1 + (CraterRadialRings - 1) * 2) * 3);

            for (int craterIndex = 0; craterIndex < Craters.Length; craterIndex++)
            {
                CraterSpec crater = Craters[craterIndex];
                Vector3 centre = PointAt(crater.Angle, crater.Outset);
                centre.y += 0.014f;
                int centreIndex = vertices.Count;
                vertices.Add(centre);
                uv.Add(Vector2.zero);
                colors.Add(new Color(1f, 1f, 1f, 0.94f));
                int firstRing = vertices.Count;

                for (int ring = 0; ring < CraterRadialRings; ring++)
                {
                    float radius = crater.Radius * ringRadius[ring];
                    for (int segment = 0; segment < CraterAngularSegments; segment++)
                    {
                        float turn = segment / (float)CraterAngularSegments
                            * Mathf.PI * 2f;
                        Vector3 point = centre + new Vector3(
                            Mathf.Cos(turn) * radius, 0f,
                            Mathf.Sin(turn) * radius);
                        point.y = SurfaceHeightAtWorld(point) + 0.014f;
                        vertices.Add(point);
                        uv.Add(new Vector2(ringRadius[ring],
                            segment / (float)CraterAngularSegments));
                        colors.Add(new Color(1f, 1f, 1f, ringAlpha[ring]));
                    }
                }

                for (int segment = 0; segment < CraterAngularSegments; segment++)
                {
                    int current = firstRing + segment;
                    int next = firstRing
                        + (segment + 1) % CraterAngularSegments;
                    triangles.Add(centreIndex); triangles.Add(next);
                    triangles.Add(current);
                }
                for (int ring = 0; ring < CraterRadialRings - 1; ring++)
                {
                    int inner = firstRing + ring * CraterAngularSegments;
                    int outer = inner + CraterAngularSegments;
                    for (int segment = 0; segment < CraterAngularSegments; segment++)
                    {
                        int next = (segment + 1) % CraterAngularSegments;
                        triangles.Add(inner + segment);
                        triangles.Add(outer + next);
                        triangles.Add(outer + segment);
                        triangles.Add(inner + segment);
                        triangles.Add(inner + next);
                        triangles.Add(outer + next);
                    }
                }
            }

            var mesh = new Mesh
            {
                name = "Kromka_OuterWesternCraterScorch_Iteration02",
                indexFormat = IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetColors(colors);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void PlaceSet(Transform parent, PrefabPlacement[] placements)
        {
            for (int i = 0; i < placements.Length; i++)
                PlacePrefab(parent, placements[i]);
        }

        private static void PlacePrefab(Transform parent, PrefabPlacement placement)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                placement.AssetPath);
            if (prefab == null)
                throw new InvalidOperationException("Missing exterior source: "
                    + placement.AssetPath);
            GameObject instance = PrefabUtility.InstantiatePrefab(prefab)
                as GameObject;
            if (instance == null)
                throw new InvalidOperationException("Cannot instantiate exterior source: "
                    + placement.AssetPath);
            instance.name = placement.Name;
            instance.transform.SetParent(parent, false);
            instance.transform.rotation = Quaternion.Euler(placement.Pitch,
                placement.Yaw, placement.Roll);
            KromkaGlobalMapOuterWastelandAuthoring.FitAndSeat(instance,
                PointAt(placement.Angle, placement.Outset), placement.Footprint,
                placement.MaximumHeight, placement.Embed);
        }

        private static Vector3 PointAt(float angle, float outset)
        {
            Vector3 point = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                angle, -outset, 0f);
            point.y = SurfaceHeight(angle, outset, point);
            return point;
        }

        private static float SurfaceHeight(float angle, float outset,
                                           Vector3 point)
        {
            float height = BaseOuterHeight(angle, outset);
            height = ApplyCraters(height, point, PreviousCraters);
            return ApplyCraters(height, point, Craters);
        }

        private static float ApplyCraters(float height, Vector3 point,
                                          CraterSpec[] craters)
        {
            Vector2 at = new Vector2(point.x, point.z);
            for (int i = 0; i < craters.Length; i++)
            {
                CraterSpec crater = craters[i];
                Vector3 craterPoint = KromkaGlobalMapReliefAuthoring
                    .BoundaryWorldPoint(crater.Angle, -crater.Outset, 0f);
                float distance = Vector2.Distance(at,
                    new Vector2(craterPoint.x, craterPoint.z)) / crater.Radius;
                if (distance < 0.82f)
                {
                    float depression = 1f - distance / 0.82f;
                    height -= crater.Depth * depression * depression;
                }
                if (distance > 0.74f && distance < 1.28f)
                {
                    float rim = 1f - Mathf.Abs(distance - 1.01f) / 0.27f;
                    height += crater.Rim * Mathf.Clamp01(rim);
                }
            }
            return height;
        }

        internal static float SurfaceHeightAtWorld(Vector3 point)
        {
            float normalizedX = point.x / 18.65f;
            float normalizedZ = point.z / 14.65f;
            float angle = Mathf.Atan2(normalizedZ, normalizedX);
            float radius = Mathf.Sqrt(normalizedX * normalizedX
                + normalizedZ * normalizedZ);
            Vector3 boundary = KromkaGlobalMapReliefAuthoring
                .BoundaryWorldPoint(angle, 0f, 0f);
            float boundaryX = boundary.x / 18.65f;
            float boundaryZ = boundary.z / 14.65f;
            float boundaryRadius = Mathf.Sqrt(boundaryX * boundaryX
                + boundaryZ * boundaryZ);
            return SurfaceHeight(angle, radius - boundaryRadius, point);
        }

        private static float BaseOuterHeight(float angle, float outset)
        {
            float t = Mathf.InverseLerp(InnerOutset, OuterOutset, outset);
            float edge = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                angle, -InnerOutset, 0f).y;
            float weathering = Mathf.Sin(angle * 31f + outset * 17f) * 0.032f
                + Mathf.Sin(angle * 73f - outset * 29f) * 0.018f;
            return Mathf.Lerp(edge - 0.015f, -1.13f, t) + weathering;
        }

        private static Vector2 MapUv(Vector3 world)
        {
            return new Vector2(world.x / 38f + 0.5f,
                0.5f - world.z / 30f);
        }

        private static Material BuildEvacuationRouteMaterial()
        {
            Material source = KromkaGlobalMapOuterWastelandAuthoring
                .RequireMaterial(BaseRouteMaterialPath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(
                RouteMaterialPath);
            if (material == null)
            {
                material = new Material(source)
                {
                    name = "Kromka_OuterEvacuationAsphalt_MEP"
                };
                AssetDatabase.CreateAsset(material, RouteMaterialPath);
            }
            else
            {
                EditorUtility.CopySerialized(source, material);
                material.name = "Kromka_OuterEvacuationAsphalt_MEP";
            }
            material.SetColor("_Tint", new Color(0.46f, 0.455f, 0.43f, 1f));
            material.SetColor("_WearTint",
                new Color(0.30f, 0.275f, 0.245f, 1f));
            material.SetFloat("_Opacity", 0.92f);
            material.SetFloat("_EdgeDust", 0.52f);
            material.SetFloat("_WearStrength", 0.86f);
            material.SetFloat("_Ruts", 0.68f);
            material.SetFloat("_WetLowlands", 0f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void ValidateSharedSeam(Transform outer,
                                               MeshFilter secondFilter)
        {
            Transform first = outer.Find(
                "Iteration01_NorthWestNuclearOutskirts_05pct/"
                + "NorthWest_DevastatedTerrain");
            MeshFilter firstFilter = first != null
                ? first.GetComponent<MeshFilter>() : null;
            KromkaGlobalMapOuterWastelandAuthoring.Require(firstFilter != null
                    && firstFilter.sharedMesh != null,
                "Iteration 01 terrain is unavailable for seam validation.");
            Vector3[] firstVertices = firstFilter.sharedMesh.vertices;
            Vector3[] secondVertices = secondFilter.sharedMesh.vertices;
            int row = AngularSegments + 1;
            for (int radial = 0; radial <= RadialSegments; radial++)
            {
                Vector3 firstPoint = first.transform.TransformPoint(
                    firstVertices[radial * row + AngularSegments]);
                Vector3 secondPoint = secondFilter.transform.TransformPoint(
                    secondVertices[radial * row]);
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    Vector3.Distance(firstPoint, secondPoint) < 0.0025f,
                    "Outer-wasteland seam opened at radial row " + radial + ".");
            }
        }

        private static void ValidateSourceSet(Transform root,
                                              PrefabPlacement[] expected,
                                              string sourcePrefix,
                                              bool requireNativeTexture,
                                              string label)
        {
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                root != null && root.childCount == expected.Length,
                label + " placement count is incorrect.");
            for (int i = 0; i < root.childCount; i++)
            {
                Transform instance = root.GetChild(i);
                GameObject source = PrefabUtility
                    .GetCorrespondingObjectFromOriginalSource(instance.gameObject);
                string sourcePath = source != null
                    ? AssetDatabase.GetAssetPath(source).Replace('\\', '/')
                    : string.Empty;
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    sourcePath.StartsWith(sourcePrefix, StringComparison.Ordinal),
                    instance.name + " lost its source-prefab connection.");
                Bounds bounds = KromkaGlobalMapOuterWastelandAuthoring.Encapsulate(
                    instance.GetComponentsInChildren<Renderer>(true)
                        .Where(renderer => renderer != null && renderer.enabled)
                        .ToArray());
                Vector2 map = KromkaGlobalMapOuterWastelandAuthoring
                    .WorldToMap(bounds.center);
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    !KromkaGlobalMapReliefAuthoring.ContainsMapPoint(map.x, map.y),
                    instance.name + " intrudes into the playable region.");

                if (!requireNativeTexture) continue;
                Material[] materials = instance
                    .GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled)
                    .SelectMany(renderer => renderer.sharedMaterials)
                    .Where(material => material != null).Distinct().ToArray();
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    materials.Length > 0 && materials.All(material =>
                    {
                        Texture texture = material.mainTexture;
                        string texturePath = texture != null
                            ? AssetDatabase.GetAssetPath(texture).Replace('\\', '/')
                            : string.Empty;
                        return texturePath.StartsWith(sourcePrefix,
                            StringComparison.Ordinal);
                    }), instance.name + " lost an original source texture.");
            }
        }

        private static void WriteUazSourceAudit(Transform convoyRoot,
                                                int triangleCount)
        {
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/mehozavr-uaz-source-audit.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            Renderer[] renderers = convoyRoot
                .GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            string[] textures = renderers.SelectMany(renderer =>
                    renderer.sharedMaterials)
                .Where(material => material != null && material.mainTexture != null)
                .Select(material => AssetDatabase.GetAssetPath(material.mainTexture)
                    .Replace('\\', '/'))
                .Distinct().OrderBy(path => path).ToArray();
            File.WriteAllLines(output, new[]
            {
                "MEHOZAVR UAZ-452 SOURCE AUDIT",
                "source=https://opengameart.org/content/uaz-452-utility-van-lowpoly",
                "author=Mehozavr",
                "license=CC0-1.0",
                "archive_sha256=ADC0E41D50198F64B44C3A3C1266F478E444AED88C205AE4E0B12F6EE4B146B0",
                "instances=" + convoyRoot.childCount,
                "renderers=" + renderers.Length,
                "total_triangles=" + triangleCount,
                "source_texture_bindings=" + textures.Length,
                "textures=" + string.Join(";", textures)
            });
        }
    }
}
#endif
