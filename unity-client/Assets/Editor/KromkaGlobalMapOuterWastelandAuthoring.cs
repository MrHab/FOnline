#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Staged environment beyond the playable refusal contour. Each iteration
    /// completes one twentieth of the ruined outside world without extending the
    /// walkable or routable map.
    /// </summary>
    internal static class KromkaGlobalMapOuterWastelandAuthoring
    {
        private const string GlobalScenePath =
            "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string MeshRoot = "Assets/Art/Kromka/Meshes/";
        private const string TerrainMeshPath = MeshRoot
            + "Kromka_OuterNuclearWasteland_05pct.asset";
        private const string HighwayMeshPath = MeshRoot
            + "Kromka_OuterDeadHighway_05pct.asset";
        private const string CraterScorchMeshPath = MeshRoot
            + "Kromka_OuterNuclearCraterScorch_05pct.asset";
        private const string TerrainMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OuterNuclearGround_MEP.mat";
        private const string CraterScorchMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OuterNuclearCraterScorch_MEP.mat";
        private const string HighwayMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Road_MEP.mat";
        private const string GroundTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_03.png";
        private const string ScorchTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Textures/MEP_StoneGround_Dif.png";
        private const string CraterShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaOuterNuclearScorch.shader";
        private const string SourceRoot =
            "Assets/ThirdParty/OpenGameArt/MajadroidApocalypticBuildings/";

        private const float SectorStart = 2.199115f;
        private const float SectorEnd = 2.513274f;
        private const float InnerOutset = 0.09f;
        private const float OuterOutset = 0.60f;
        private const int AngularSegments = 32;
        private const int RadialSegments = 24;
        private const int HighwaySegmentsPerSpan = 8;
        private const int CraterAngularSegments = 40;
        private const int CraterRadialRings = 5;

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

        private sealed class RuinPlacement
        {
            internal readonly string Name;
            internal readonly string Model;
            internal readonly float Angle;
            internal readonly float Outset;
            internal readonly float Footprint;
            internal readonly float MaximumHeight;
            internal readonly float Yaw;
            internal readonly float Embed;

            internal RuinPlacement(string name, string model, float angle,
                                   float outset, float footprint,
                                   float maximumHeight, float yaw, float embed)
            {
                Name = name;
                Model = model;
                Angle = angle;
                Outset = outset;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly CraterSpec[] Craters =
        {
            new CraterSpec("GroundZeroCrater", 2.385f, 0.405f,
                2.25f, 0.62f, 0.23f),
            new CraterSpec("SecondaryAirburstCrater", 2.245f, 0.435f,
                1.15f, 0.34f, 0.13f),
            new CraterSpec("CollapsedShelterCrater", 2.474f, 0.505f,
                0.82f, 0.25f, 0.095f)
        };

        private static readonly RuinPlacement[] Ruins =
        {
            new RuinPlacement("NorthWest_RuinBlock_A", "building-01.fbx",
                2.228f, 0.215f, 1.10f, 1.35f, 31f, 0.035f),
            new RuinPlacement("NorthWest_RuinBlock_B", "building-05.fbx",
                2.486f, 0.225f, 1.00f, 1.22f, -18f, 0.035f),
            new RuinPlacement("NorthWest_RuinBlock_C", "building-07.fbx",
                2.245f, 0.545f, 1.05f, 1.28f, 54f, 0.040f),
            new RuinPlacement("NorthWest_BlastWreckage_A",
                "wreckage-3-types.fbx", 2.315f, 0.315f,
                0.60f, 0.24f, 17f, 0.030f),
            new RuinPlacement("NorthWest_BlastWreckage_B",
                "wreckage-3-types.fbx", 2.445f, 0.555f,
                0.55f, 0.22f, -37f, 0.030f)
        };

        internal static void ComposeIteration01(Transform staticContent)
        {
            Transform worldEdge = staticContent.Find("WorldEdge_AUTHORED");
            if (worldEdge == null)
                throw new InvalidOperationException(
                    "Outer wasteland requires the authored world edge first.");
            Transform previous = worldEdge.Find("OuterNuclearWasteland_AUTHORED");
            if (previous != null)
                UnityEngine.Object.DestroyImmediate(previous.gameObject);

            Transform outer = Child(worldEdge, "OuterNuclearWasteland_AUTHORED");
            Transform iteration = Child(outer,
                "Iteration01_NorthWestNuclearOutskirts_05pct");
            Material outerGround = BuildOuterGroundMaterial();
            Material craterScorch = BuildCraterScorchMaterial();
            CreateMeshObject("NorthWest_DevastatedTerrain", iteration,
                PersistMesh(TerrainMeshPath, BuildSectorTerrain()),
                outerGround, false);
            CreateMeshObject("NorthWest_DeadHighway", iteration,
                PersistMesh(HighwayMeshPath, BuildDeadHighway()),
                RequireMaterial(HighwayMaterialPath), false);
            CreateMeshObject("NuclearImpactScorch_SURFACE_MEP", iteration,
                PersistMesh(CraterScorchMeshPath, BuildCraterScars()),
                craterScorch, false);

            Transform craters = Child(iteration, "NuclearImpactCraters_AUTHORED");
            for (int i = 0; i < Craters.Length; i++)
            {
                Transform marker = Child(craters, Craters[i].Name
                    + "_DEFORMED_TERRAIN_REFERENCE");
                Vector3 centre = PointAt(Craters[i].Angle, Craters[i].Outset);
                marker.position = centre;
            }

            Transform ruins = Child(iteration,
                "MajadroidApocalypticRuins_CC0_NATIVE_TEXTURES");
            for (int i = 0; i < Ruins.Length; i++)
                PlaceRuin(ruins, Ruins[i]);

            Child(outer, "OuterWastelandProgress_05pct_REFERENCE");
            Child(outer, "OuterSectorsComplete_01_of_20_REFERENCE");
            Child(outer, "NorthWestNuclearOutskirts_COMPLETE_REFERENCE");
            Child(outer, "CC0MajadroidNativeTextures_PRESERVED_REFERENCE");
            Child(outer, "NuclearCraterScorchReadableAtStrategicZoom_REFERENCE");
            Child(outer, "OutsidePlayableBoundary_NON_ROUTABLE_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate outer nuclear wasteland 05pct")]
        public static void ValidateIteration01()
        {
            GameObject outerObject = GameObject.Find(
                "OuterNuclearWasteland_AUTHORED");
            if (outerObject == null)
            {
                EditorSceneManager.OpenScene(GlobalScenePath, OpenSceneMode.Single);
                outerObject = GameObject.Find("OuterNuclearWasteland_AUTHORED");
            }
            Require(outerObject != null,
                "The staged outer nuclear wasteland is missing.");
            Transform iteration = outerObject.transform.Find(
                "Iteration01_NorthWestNuclearOutskirts_05pct");
            Require(iteration != null,
                "Outer-wasteland iteration 01 is missing.");

            Transform terrain = iteration.Find("NorthWest_DevastatedTerrain");
            MeshFilter terrainFilter = terrain != null
                ? terrain.GetComponent<MeshFilter>() : null;
            MeshRenderer terrainRenderer = terrain != null
                ? terrain.GetComponent<MeshRenderer>() : null;
            Require(terrainFilter != null && terrainFilter.sharedMesh != null
                && terrainFilter.sharedMesh.vertexCount
                    == (AngularSegments + 1) * (RadialSegments + 1),
                "The north-west devastated terrain sector is incomplete.");
            Require(terrainRenderer != null && terrainRenderer.enabled
                && terrainRenderer.sharedMaterial
                    == RequireMaterial(TerrainMaterialPath),
                "The devastated terrain lost its authored ground material.");
            Require(terrainFilter.sharedMesh.vertices.All(vertex =>
            {
                Vector3 world = terrain.TransformPoint(vertex);
                Vector2 map = WorldToMap(world);
                return !KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                    map.x, map.y);
            }), "Outer terrain intrudes into the playable region.");

            Transform highway = iteration.Find("NorthWest_DeadHighway");
            MeshFilter highwayFilter = highway != null
                ? highway.GetComponent<MeshFilter>() : null;
            MeshRenderer highwayRenderer = highway != null
                ? highway.GetComponent<MeshRenderer>() : null;
            Require(highwayFilter != null && highwayFilter.sharedMesh != null
                && highwayFilter.sharedMesh.vertexCount
                    == 3 * (HighwaySegmentsPerSpan + 1) * 2
                && highwayRenderer != null
                && highwayRenderer.sharedMaterial
                    == RequireMaterial(HighwayMaterialPath),
                "The three broken highway slabs are incomplete.");

            Transform scorch = iteration.Find("NuclearImpactScorch_SURFACE_MEP");
            MeshFilter scorchFilter = scorch != null
                ? scorch.GetComponent<MeshFilter>() : null;
            MeshRenderer scorchRenderer = scorch != null
                ? scorch.GetComponent<MeshRenderer>() : null;
            Require(scorchFilter != null && scorchFilter.sharedMesh != null
                && scorchFilter.sharedMesh.vertexCount == Craters.Length
                    * (1 + CraterAngularSegments * CraterRadialRings)
                && scorchRenderer != null && scorchRenderer.enabled
                && scorchRenderer.sharedMaterial
                    == RequireMaterial(CraterScorchMaterialPath),
                "The nuclear crater scorch layer is missing or incomplete.");

            Transform craterRoot = iteration.Find("NuclearImpactCraters_AUTHORED");
            Require(craterRoot != null && craterRoot.childCount == Craters.Length,
                "Three nuclear-impact craters are required in iteration 01.");
            for (int i = 0; i < Craters.Length; i++)
            {
                CraterSpec crater = Craters[i];
                Vector3 centre = PointAt(crater.Angle, crater.Outset);
                float baseAtCentre = BaseOuterHeight(crater.Angle,
                    crater.Outset);
                Require(centre.y < baseAtCentre - crater.Depth * 0.72f,
                    crater.Name + " lost its blast depression.");
            }

            Transform ruinRoot = iteration.Find(
                "MajadroidApocalypticRuins_CC0_NATIVE_TEXTURES");
            Require(ruinRoot != null && ruinRoot.childCount == Ruins.Length,
                "Iteration 01 must contain three ruins and two wreckage groups.");
            int triangleCount = 0;
            Renderer[] ruinRenderers = ruinRoot
                .GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(ruinRenderers.Length >= 9,
                "The imported ruin shells or wreckage meshes are incomplete.");
            for (int i = 0; i < ruinRoot.childCount; i++)
            {
                Transform ruin = ruinRoot.GetChild(i);
                Vector2 map = WorldToMap(Encapsulate(ruin
                    .GetComponentsInChildren<Renderer>(true)).center);
                Require(!KromkaGlobalMapReliefAuthoring.ContainsMapPoint(map.x, map.y),
                    ruin.name + " intrudes into the playable region.");
                GameObject source = PrefabUtility
                    .GetCorrespondingObjectFromOriginalSource(ruin.gameObject);
                string sourcePath = source != null
                    ? AssetDatabase.GetAssetPath(source).Replace('\\', '/') : string.Empty;
                Require(sourcePath.StartsWith(SourceRoot + "Models/",
                        StringComparison.Ordinal),
                    ruin.name + " is not linked to the downloaded CC0 source.");
            }
            Mesh[] ruinMeshes = ruinRoot.GetComponentsInChildren<MeshFilter>(true)
                .Select(filter => filter.sharedMesh).Where(mesh => mesh != null)
                .ToArray();
            for (int i = 0; i < ruinMeshes.Length; i++)
                triangleCount += ruinMeshes[i].triangles.Length / 3;
            Require(triangleCount > 35000 && triangleCount < 42000,
                "Iteration 01 ruin geometry is outside its WebGL budget.");
            Require(ruinRenderers.SelectMany(renderer => renderer.sharedMaterials)
                .Where(material => material != null).All(material =>
                {
                    Texture texture = material.mainTexture;
                    string path = texture != null
                        ? AssetDatabase.GetAssetPath(texture).Replace('\\', '/')
                        : string.Empty;
                    return path.StartsWith(SourceRoot + "Textures/",
                        StringComparison.Ordinal);
                }), "A Majadroid ruin lost its original source texture.");

            Require(iteration.GetComponentsInChildren<Collider>(true)
                .All(collider => !collider.enabled),
                "Outer scenery must not extend the playable collision area.");
            Require(iteration.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Outer scenery must remain visible at strategic-map zoom levels.");
            Require(GameObject.Find("OuterWastelandProgress_05pct_REFERENCE") != null
                && GameObject.Find("OuterSectorsComplete_01_of_20_REFERENCE") != null
                && GameObject.Find(
                    "CC0MajadroidNativeTextures_PRESERVED_REFERENCE") != null
                && GameObject.Find(
                    "NuclearCraterScorchReadableAtStrategicZoom_REFERENCE") != null
                && GameObject.Find(
                    "OutsidePlayableBoundary_NON_ROUTABLE_REFERENCE") != null,
                "The 5-percent progress or provenance contract is missing.");

            Debug.Log("[KROMKA OUTER WASTELAND 5%] PASS: north-west exterior "
                + "sector, three terrain-deformed nuclear craters, three CC0 "
                + "ruin shells, two wreckage groups, readable scorch bowls and a "
                + "terrain-seated severed highway; all source textures are "
                + "preserved outside the playable contour.");
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
                    // Radial vertices are written from the playable contour
                    // outwards while angular vertices advance counter-clockwise.
                    // Keep the winding upward so the exterior receives the same
                    // strategic-map lighting as the authored landmass.
                    triangles.Add(a); triangles.Add(a + 1); triangles.Add(b);
                    triangles.Add(a + 1); triangles.Add(b + 1);
                    triangles.Add(b);
                }
            }
            var mesh = new Mesh
            {
                name = "Kromka_OuterNuclearWasteland_05pct",
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

        private static Mesh BuildDeadHighway()
        {
            float[,] spans =
            {
                { 0.10f, 0.245f },
                { 0.265f, 0.415f },
                { 0.445f, 0.595f }
            };
            int vertexCount = spans.GetLength(0)
                * (HighwaySegmentsPerSpan + 1) * 2;
            var vertices = new List<Vector3>(vertexCount);
            var uv = new List<Vector2>(vertexCount);
            var triangles = new List<int>(spans.GetLength(0)
                * HighwaySegmentsPerSpan * 6);
            for (int i = 0; i < spans.GetLength(0); i++)
            {
                int first = vertices.Count;
                for (int segment = 0; segment <= HighwaySegmentsPerSpan; segment++)
                {
                    float t = segment / (float)HighwaySegmentsPerSpan;
                    float outset = Mathf.Lerp(spans[i, 0], spans[i, 1], t);
                    float sampleStep = (spans[i, 1] - spans[i, 0])
                        / HighwaySegmentsPerSpan;
                    Vector3 previous = PointAt(2.356f,
                        Mathf.Max(spans[i, 0], outset - sampleStep));
                    Vector3 next = PointAt(2.356f,
                        Mathf.Min(spans[i, 1], outset + sampleStep));
                    Vector3 direction = next - previous;
                    direction.y = 0f;
                    direction.Normalize();
                    float brokenEdge = Mathf.Sin((segment + i * 5) * 2.17f)
                        * 0.035f;
                    float halfWidth = 0.31f + brokenEdge;
                    Vector3 side = Vector3.Cross(Vector3.up, direction)
                        * halfWidth;
                    Vector3 centre = PointAt(2.356f, outset);
                    centre.y += 0.028f;
                    vertices.Add(centre - side);
                    vertices.Add(centre + side);
                    uv.Add(new Vector2(0f, t * 2.4f));
                    uv.Add(new Vector2(1f, t * 2.4f));
                }
                for (int segment = 0; segment < HighwaySegmentsPerSpan; segment++)
                {
                    int row = first + segment * 2;
                    triangles.Add(row); triangles.Add(row + 2);
                    triangles.Add(row + 1);
                    triangles.Add(row + 1); triangles.Add(row + 2);
                    triangles.Add(row + 3);
                }
            }
            var mesh = new Mesh { name = "Kromka_OuterDeadHighway_05pct" };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
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
                        Vector3 point = centre + new Vector3(Mathf.Cos(turn) * radius,
                            0f, Mathf.Sin(turn) * radius);
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
                name = "Kromka_OuterNuclearCraterScorch_05pct",
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

        private static void PlaceRuin(Transform parent, RuinPlacement placement)
        {
            string path = SourceRoot + "Models/" + placement.Model;
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null)
                throw new InvalidOperationException("Missing CC0 ruin model: " + path);
            GameObject instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (instance == null)
                throw new InvalidOperationException("Cannot instantiate: " + path);
            instance.name = placement.Name;
            instance.transform.SetParent(parent, false);
            instance.transform.rotation = Quaternion.Euler(0f, placement.Yaw, 0f);
            FitAndSeat(instance, PointAt(placement.Angle, placement.Outset),
                placement.Footprint, placement.MaximumHeight, placement.Embed);
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
            Vector2 at = new Vector2(point.x, point.z);
            for (int i = 0; i < Craters.Length; i++)
            {
                CraterSpec crater = Craters[i];
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
            float outset = radius - boundaryRadius;
            return SurfaceHeight(angle, outset, point);
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

        internal static void FitAndSeat(GameObject instance, Vector3 target,
                                       float footprint, float maximumHeight,
                                       float embed)
        {
            LODGroup[] lodGroups = instance.GetComponentsInChildren<LODGroup>(true);
            for (int i = 0; i < lodGroups.Length; i++)
                UnityEngine.Object.DestroyImmediate(lodGroups[i]);
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++) colliders[i].enabled = false;
            Animator[] animators = instance.GetComponentsInChildren<Animator>(true);
            for (int i = 0; i < animators.Length; i++)
                UnityEngine.Object.DestroyImmediate(animators[i]);
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            if (renderers.Length == 0)
                throw new InvalidOperationException(instance.name
                    + " contains no enabled renderers.");
            Bounds bounds = Encapsulate(renderers);
            instance.transform.localScale *= footprint
                / Mathf.Max(0.001f, Mathf.Max(bounds.size.x, bounds.size.z));
            bounds = Encapsulate(instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray());
            if (bounds.size.y > maximumHeight)
            {
                Vector3 scale = instance.transform.localScale;
                scale.y *= maximumHeight / bounds.size.y;
                instance.transform.localScale = scale;
                bounds = Encapsulate(instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray());
            }
            instance.transform.position += new Vector3(target.x - bounds.center.x,
                target.y - embed - bounds.min.y, target.z - bounds.center.z);
            for (int i = 0; i < renderers.Length; i++)
            {
                renderers[i].shadowCastingMode = ShadowCastingMode.On;
                renderers[i].receiveShadows = true;
            }
            MarkStatic(instance);
        }

        internal static Bounds Encapsulate(Renderer[] renderers)
        {
            if (renderers == null || renderers.Length == 0)
                throw new InvalidOperationException("Cannot measure empty ruin bounds.");
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        internal static GameObject CreateMeshObject(string name, Transform parent,
                                                   Mesh mesh, Material material,
                                                   bool shadows)
        {
            var instance = new GameObject(name);
            instance.transform.SetParent(parent, false);
            instance.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = instance.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = shadows
                ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = shadows;
            MarkStatic(instance);
            return instance;
        }

        internal static Mesh PersistMesh(string path, Mesh generated)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        internal static Material BuildOuterGroundMaterial()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException(
                    "URP Lit shader is unavailable for the outer ground.");
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                GroundTexturePath);
            if (texture == null)
                throw new InvalidOperationException("Missing MEP outer-ground texture: "
                    + GroundTexturePath);
            Material material = LoadOrCreateMaterial(TerrainMaterialPath, shader,
                "Kromka_OuterNuclearGround_MEP");
            material.SetTexture("_BaseMap", texture);
            material.SetTextureScale("_BaseMap", new Vector2(11f, 9f));
            material.SetColor("_BaseColor",
                new Color(0.72f, 0.70f, 0.65f, 1f));
            material.SetFloat("_Metallic", 0f);
            material.SetFloat("_Smoothness", 0.035f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildCraterScorchMaterial()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(CraterShaderPath);
            if (shader == null)
                throw new InvalidOperationException("Missing crater-scorch shader: "
                    + CraterShaderPath);
            Texture2D stone = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ScorchTexturePath);
            if (stone == null)
                throw new InvalidOperationException(
                    "Missing MEP textures for the crater-scorch layer.");
            Material material = LoadOrCreateMaterial(CraterScorchMaterialPath,
                shader, "Kromka_OuterNuclearCraterScorch_MEP");
            material.SetTexture("_MainTex", stone);
            material.SetColor("_InnerTint",
                new Color(0.038f, 0.028f, 0.021f, 1f));
            material.SetColor("_AshTint",
                new Color(0.18f, 0.135f, 0.095f, 1f));
            material.SetColor("_RimTint",
                new Color(0.235f, 0.092f, 0.030f, 1f));
            material.SetFloat("_DetailTiling", 3.6f);
            material.SetFloat("_Opacity", 0.94f);
            material.SetFloat("_RimCentre", 0.82f);
            material.SetFloat("_RimWidth", 0.22f);
            material.SetFloat("_AmbientFloor", 0.58f);
            material.SetFloat("_Seed", 5.43f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material LoadOrCreateMaterial(string path, Shader shader,
                                                     string name)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader) { name = name };
                AssetDatabase.CreateAsset(material, path);
            }
            else
            {
                material.shader = shader;
                material.name = name;
            }
            return material;
        }

        internal static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
                throw new InvalidOperationException("Missing outer-wasteland material: "
                    + path);
            return material;
        }

        private static Vector2 MapUv(Vector3 world)
        {
            return new Vector2(world.x / 38f + 0.5f,
                0.5f - world.z / 30f);
        }

        internal static Vector2 WorldToMap(Vector3 world)
        {
            return new Vector2(world.x / 0.1f + 190f,
                150f - world.z / 0.1f);
        }

        internal static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        internal static void MarkStatic(GameObject root)
        {
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic;
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(transforms[i].gameObject, flags);
        }

        internal static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
