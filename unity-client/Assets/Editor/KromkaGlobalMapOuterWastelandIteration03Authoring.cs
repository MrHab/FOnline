#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Outer-wasteland iteration 03/20. Continues the two finished north-western
    /// sectors into a collapsed western city belt. All geometry stays outside
    /// the playable contour and is presentation-only.
    /// </summary>
    internal static class KromkaGlobalMapOuterWastelandIteration03Authoring
    {
        private const string GlobalScenePath =
            "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string MeshRoot = "Assets/Art/Kromka/Meshes/";
        private const string TerrainMeshPath = MeshRoot
            + "Kromka_OuterWesternCollapsedCity_Iteration03.asset";
        private const string ScorchMeshPath = MeshRoot
            + "Kromka_OuterWesternCollapsedCityScorch_Iteration03.asset";
        private const string GroundMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OuterNuclearGround_MEP.mat";
        private const string ScorchMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OuterNuclearCraterScorch_MEP.mat";
        private const string SourcePath =
            "Assets/ThirdParty/OpenGameArt/FleurmanDestroyedCity/"
            + "Destroyed_City_Assets.fbx";
        private const string CityMaterialRoot =
            "Assets/Art/Kromka/Materials/Kromka_OuterCity_";

        private const float SectorStart = 2.827433f;
        private const float SectorEnd = 3.141593f;
        private const float InnerOutset = 0.09f;
        private const float OuterOutset = 0.60f;
        private const int AngularSegments = 32;
        private const int RadialSegments = 24;
        private const int CraterAngularSegments = 40;
        private const int CraterRadialRings = 5;
        private const int SourceTriangleCount = 15857;
        private const int SourceRendererCount = 61;

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

        // Iteration 02 crater deformation is repeated at the shared seam so the
        // two independently persisted terrain meshes meet vertex-for-vertex.
        private static readonly CraterSpec[] PreviousCraters =
        {
            new CraterSpec("EvacuationColumnImpactCrater", 2.680f, 0.340f,
                1.60f, 0.48f, 0.17f),
            new CraterSpec("WesternRelayBlastCrater", 2.795f, 0.495f,
                0.86f, 0.26f, 0.10f),
            new CraterSpec("RoadsideSecondaryCrater", 2.615f, 0.555f,
                0.62f, 0.19f, 0.075f)
        };

        private static readonly CraterSpec[] Craters =
        {
            new CraterSpec("CollapsedCityGroundZero", 2.965f, 0.305f,
                1.45f, 0.52f, 0.19f),
            new CraterSpec("WesternTenementAirburst", 3.050f, 0.505f,
                0.92f, 0.30f, 0.11f),
            new CraterSpec("MunicipalRoadImpact", 3.116f, 0.175f,
                0.64f, 0.22f, 0.085f)
        };

        internal static void Compose(Transform staticContent)
        {
            Transform worldEdge = staticContent.Find("WorldEdge_AUTHORED");
            if (worldEdge == null)
                throw new InvalidOperationException(
                    "Outer-wasteland iteration 03 requires the authored world edge.");
            Transform outer = worldEdge.Find("OuterNuclearWasteland_AUTHORED");
            if (outer == null || outer.Find(
                    "Iteration02_WesternEvacuationGraveyard_10pct") == null)
                throw new InvalidOperationException(
                    "Outer-wasteland iteration 02 must be composed first.");

            Transform previous = outer.Find(
                "Iteration03_WesternCollapsedCity_15pct");
            if (previous != null)
                UnityEngine.Object.DestroyImmediate(previous.gameObject);
            Transform iteration = KromkaGlobalMapOuterWastelandAuthoring.Child(
                outer, "Iteration03_WesternCollapsedCity_15pct");

            KromkaGlobalMapOuterWastelandAuthoring.CreateMeshObject(
                "WesternCollapsedCity_DevastatedTerrain", iteration,
                KromkaGlobalMapOuterWastelandAuthoring.PersistMesh(
                    TerrainMeshPath, BuildSectorTerrain()),
                KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                    GroundMaterialPath), false);
            KromkaGlobalMapOuterWastelandAuthoring.CreateMeshObject(
                "WesternCollapsedCity_NuclearScorch_SURFACE_MEP", iteration,
                KromkaGlobalMapOuterWastelandAuthoring.PersistMesh(
                    ScorchMeshPath, BuildCraterScars()),
                KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                    ScorchMaterialPath), false);

            Transform craterRoot = KromkaGlobalMapOuterWastelandAuthoring.Child(
                iteration, "WesternCollapsedCityImpactCraters_AUTHORED");
            for (int i = 0; i < Craters.Length; i++)
            {
                Transform marker = KromkaGlobalMapOuterWastelandAuthoring.Child(
                    craterRoot, Craters[i].Name
                        + "_DEFORMED_TERRAIN_REFERENCE");
                marker.position = PointAt(Craters[i].Angle, Craters[i].Outset);
            }

            PlaceDestroyedCity(KromkaGlobalMapOuterWastelandAuthoring.Child(
                iteration, "FleurmanDestroyedCity_CC0_URP_WASTELAND_PALETTE"));

            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "OuterWastelandProgress_15pct_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "OuterSectorsComplete_03_of_20_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "WesternCollapsedCity_COMPLETE_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "CC0FleurmanSourceGeometry_PRESERVED_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "FleurmanSixSlotURPWastelandPalette_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "Iteration02To03_WATERTIGHT_SEAM_REFERENCE");
            KromkaGlobalMapOuterWastelandAuthoring.Child(outer,
                "OutsidePlayableBoundary_NON_ROUTABLE_REFERENCE");
        }

        [MenuItem("Realm of Ashes/Checks/Validate outer nuclear wasteland 15pct")]
        public static void ValidateIteration03()
        {
            GameObject outerObject = GameObject.Find(
                "OuterNuclearWasteland_AUTHORED");
            if (outerObject == null)
            {
                UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
                    GlobalScenePath,
                    UnityEditor.SceneManagement.OpenSceneMode.Single);
                outerObject = GameObject.Find("OuterNuclearWasteland_AUTHORED");
            }
            KromkaGlobalMapOuterWastelandAuthoring.Require(outerObject != null,
                "The staged outer nuclear wasteland is missing.");
            Transform iteration = outerObject.transform.Find(
                "Iteration03_WesternCollapsedCity_15pct");
            KromkaGlobalMapOuterWastelandAuthoring.Require(iteration != null,
                "Outer-wasteland iteration 03 is missing.");

            Transform terrain = iteration.Find(
                "WesternCollapsedCity_DevastatedTerrain");
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
                "The collapsed-city exterior terrain is incomplete.");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                terrainRenderer != null && terrainRenderer.enabled
                    && terrainRenderer.sharedMaterial
                        == KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                            GroundMaterialPath),
                "The collapsed-city terrain lost its nuclear-ground material.");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                terrainFilter.sharedMesh.vertices.All(vertex =>
                {
                    Vector2 map = KromkaGlobalMapOuterWastelandAuthoring
                        .WorldToMap(terrain.TransformPoint(vertex));
                    return !KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        map.x, map.y);
                }), "The collapsed-city terrain intrudes into the playable region.");

            ValidateSharedSeam(outerObject.transform, terrainFilter);

            Transform scorch = iteration.Find(
                "WesternCollapsedCity_NuclearScorch_SURFACE_MEP");
            MeshFilter scorchFilter = scorch != null
                ? scorch.GetComponent<MeshFilter>() : null;
            MeshRenderer scorchRenderer = scorch != null
                ? scorch.GetComponent<MeshRenderer>() : null;
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                scorchFilter != null && scorchFilter.sharedMesh != null
                    && scorchFilter.sharedMesh.vertexCount == Craters.Length
                        * (1 + CraterAngularSegments * CraterRadialRings)
                    && scorchRenderer != null && scorchRenderer.enabled
                    && scorchRenderer.sharedMaterial
                        == KromkaGlobalMapOuterWastelandAuthoring.RequireMaterial(
                            ScorchMaterialPath),
                "The collapsed-city nuclear scorch layer is incomplete.");

            Transform craterRoot = iteration.Find(
                "WesternCollapsedCityImpactCraters_AUTHORED");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                craterRoot != null && craterRoot.childCount == Craters.Length,
                "Three collapsed-city impact craters are required.");
            for (int i = 0; i < Craters.Length; i++)
            {
                CraterSpec crater = Craters[i];
                Vector3 centre = PointAt(crater.Angle, crater.Outset);
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    centre.y < BaseOuterHeight(crater.Angle, crater.Outset)
                        - crater.Depth * 0.72f,
                    crater.Name + " lost its blast depression.");
            }

            Transform sourceRoot = iteration.Find(
                "FleurmanDestroyedCity_CC0_URP_WASTELAND_PALETTE");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                sourceRoot != null && sourceRoot.childCount == 1,
                "The CC0 destroyed-city source placement is incomplete.");
            Transform city = sourceRoot.GetChild(0);
            GameObject original = PrefabUtility
                .GetCorrespondingObjectFromOriginalSource(city.gameObject);
            string originalPath = original != null
                ? AssetDatabase.GetAssetPath(original).Replace('\\', '/')
                : string.Empty;
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                string.Equals(originalPath, SourcePath, StringComparison.Ordinal),
                "The destroyed city lost its downloaded CC0 source link.");

            MeshFilter[] sourceMeshes = city.GetComponentsInChildren<MeshFilter>(true)
                .Where(filter => filter.sharedMesh != null).ToArray();
            Renderer[] sourceRenderers = city.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            int triangleCount = sourceMeshes.Sum(filter =>
                filter.sharedMesh.triangles.Length / 3);
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                sourceRenderers.Length == SourceRendererCount
                    && triangleCount == SourceTriangleCount,
                "The Fleurman source geometry changed or exceeded its reviewed budget.");
            Material[] sourceMaterials = sourceRenderers
                .SelectMany(renderer => renderer.sharedMaterials)
                .Where(material => material != null).Distinct().ToArray();
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                sourceMaterials.Length == 6 && sourceMaterials.All(material =>
                {
                    string materialPath = AssetDatabase.GetAssetPath(material)
                        .Replace('\\', '/');
                    return materialPath.StartsWith(CityMaterialRoot,
                            StringComparison.Ordinal)
                        && material.shader != null
                        && material.shader.name != "Hidden/InternalErrorShader";
                }), "The destroyed-city URP wasteland palette is incomplete.");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                sourceMeshes.All(filter => filter.sharedMesh.vertices.All(vertex =>
                {
                    Vector2 map = KromkaGlobalMapOuterWastelandAuthoring
                        .WorldToMap(filter.transform.TransformPoint(vertex));
                    return !KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        map.x, map.y);
                })), "Destroyed-city geometry intrudes into the playable region.");

            KromkaGlobalMapOuterWastelandAuthoring.Require(
                iteration.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Iteration 03 must not extend the playable collision area.");
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                iteration.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Iteration 03 scenery must remain visible at every map zoom.");

            string[] markers =
            {
                "OuterWastelandProgress_15pct_REFERENCE",
                "OuterSectorsComplete_03_of_20_REFERENCE",
                "WesternCollapsedCity_COMPLETE_REFERENCE",
                "CC0FleurmanSourceGeometry_PRESERVED_REFERENCE",
                "FleurmanSixSlotURPWastelandPalette_REFERENCE",
                "Iteration02To03_WATERTIGHT_SEAM_REFERENCE",
                "OutsidePlayableBoundary_NON_ROUTABLE_REFERENCE"
            };
            for (int i = 0; i < markers.Length; i++)
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    GameObject.Find(markers[i]) != null,
                    markers[i] + " is missing.");

            WriteSourceAudit(city, triangleCount, sourceMaterials);
            Debug.Log("[KROMKA OUTER WASTELAND 15%] PASS: three contiguous "
                + "exterior sectors, nine terrain-deformed impact craters and "
                + "a complete CC0 destroyed city with three building shells, "
                + "broken roads and blast rubble; the exterior remains "
                + "non-routable and outside the playable contour.");
        }

        private static Mesh BuildSectorTerrain()
        {
            var vertices = new List<Vector3>((AngularSegments + 1)
                * (RadialSegments + 1));
            var uv = new List<Vector2>(vertices.Capacity);
            var triangles = new List<int>(AngularSegments * RadialSegments * 6);
            for (int radial = 0; radial <= RadialSegments; radial++)
            {
                float outset = Mathf.Lerp(InnerOutset, OuterOutset,
                    radial / (float)RadialSegments);
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
                name = "Kromka_OuterWesternCollapsedCity_Iteration03",
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
                * CraterAngularSegments
                * (1 + (CraterRadialRings - 1) * 2) * 3);

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
                    for (int segment = 0; segment < CraterAngularSegments;
                         segment++)
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
                    for (int segment = 0; segment < CraterAngularSegments;
                         segment++)
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
                name = "Kromka_OuterWesternCollapsedCityScorch_Iteration03",
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

        private static void PlaceDestroyedCity(Transform parent)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                SourcePath);
            if (prefab == null)
                throw new InvalidOperationException(
                    "Missing CC0 destroyed-city source: " + SourcePath);
            GameObject instance = PrefabUtility.InstantiatePrefab(prefab)
                as GameObject;
            if (instance == null)
                throw new InvalidOperationException(
                    "Cannot instantiate CC0 destroyed-city source.");
            instance.name = "WesternCityAfterTheFlash_Fleurman_CC0";
            instance.transform.SetParent(parent, false);
            instance.transform.rotation = Quaternion.Euler(0.8f, 99f, -1.4f);
            KromkaGlobalMapOuterWastelandAuthoring.FitAndSeat(instance,
                PointAt(3.000f, 0.365f), 5.45f, 1.65f, 0.045f);
            ApplyWastelandPalette(instance);
        }

        private static void ApplyWastelandPalette(GameObject city)
        {
            Material concrete = CityMaterial("BrokenConcrete.mat",
                "Kromka_OuterCity_BrokenConcrete",
                new Color(0.31f, 0.285f, 0.25f, 1f), 0f, 0.07f);
            Material concreteDark = CityMaterial("BrokenConcreteDark.mat",
                "Kromka_OuterCity_BrokenConcreteDark",
                new Color(0.205f, 0.195f, 0.18f, 1f), 0f, 0.045f);
            Material concreteDust = CityMaterial("BrokenConcreteDust.mat",
                "Kromka_OuterCity_BrokenConcreteDust",
                new Color(0.39f, 0.345f, 0.285f, 1f), 0f, 0.055f);
            Material rust = CityMaterial("RustMetal.mat",
                "Kromka_OuterCity_RustMetal",
                new Color(0.245f, 0.105f, 0.043f, 1f), 0.48f, 0.16f);
            Material rock = CityMaterial("RubbleRock.mat",
                "Kromka_OuterCity_RubbleRock",
                new Color(0.20f, 0.165f, 0.125f, 1f), 0f, 0.035f);
            Material road = CityMaterial("BrokenRoad.mat",
                "Kromka_OuterCity_BrokenRoad",
                new Color(0.115f, 0.105f, 0.095f, 1f), 0f, 0.08f);

            Renderer[] renderers = city.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Material[] assigned = renderers[i].sharedMaterials;
                for (int slot = 0; slot < assigned.Length; slot++)
                {
                    string name = assigned[slot] != null
                        ? assigned[slot].name.ToLowerInvariant() : string.Empty;
                    if (name.Contains("route")) assigned[slot] = road;
                    else if (name.Contains("rock")) assigned[slot] = rock;
                    else if (name.Contains("tal") || name.Contains("metal"))
                        assigned[slot] = rust;
                    else if (name.EndsWith("2", StringComparison.Ordinal))
                        assigned[slot] = concreteDark;
                    else if (name.EndsWith("3", StringComparison.Ordinal))
                        assigned[slot] = concreteDust;
                    else assigned[slot] = concrete;
                }
                renderers[i].sharedMaterials = assigned;
            }
        }

        private static Material CityMaterial(string suffix, string name,
                                             Color color, float metallic,
                                             float smoothness)
        {
            string path = CityMaterialRoot + suffix;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException(
                    "URP Lit is unavailable for the destroyed-city palette.");
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
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
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

        private static void ValidateSharedSeam(Transform outer,
                                               MeshFilter thirdFilter)
        {
            Transform second = outer.Find(
                "Iteration02_WesternEvacuationGraveyard_10pct/"
                + "Western_DevastatedTerrain");
            MeshFilter secondFilter = second != null
                ? second.GetComponent<MeshFilter>() : null;
            KromkaGlobalMapOuterWastelandAuthoring.Require(
                secondFilter != null && secondFilter.sharedMesh != null,
                "Iteration 02 terrain is unavailable for seam validation.");
            Vector3[] secondVertices = secondFilter.sharedMesh.vertices;
            Vector3[] thirdVertices = thirdFilter.sharedMesh.vertices;
            int row = AngularSegments + 1;
            for (int radial = 0; radial <= RadialSegments; radial++)
            {
                Vector3 secondPoint = second.TransformPoint(
                    secondVertices[radial * row + AngularSegments]);
                Vector3 thirdPoint = thirdFilter.transform.TransformPoint(
                    thirdVertices[radial * row]);
                KromkaGlobalMapOuterWastelandAuthoring.Require(
                    Vector3.Distance(secondPoint, thirdPoint) < 0.0025f,
                    "Iteration 02/03 seam opened at radial row " + radial + ".");
            }
        }

        private static void WriteSourceAudit(Transform city, int triangleCount,
                                             Material[] materials)
        {
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/"
                + "fleurman-destroyed-city-source-audit.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            File.WriteAllLines(output, new[]
            {
                "FLEURMAN DESTROYED CITY SOURCE AUDIT",
                "source=https://opengameart.org/content/destroyed-city-assets",
                "author=Fleurman",
                "license=CC0-1.0",
                "archive_sha256=3AEA810178FDF6235F82FC61C4569A7742E08588AE4390357EB991726F5610AC",
                "fbx_sha256=6FA9604C9B3832B3BBC3B3004BB255FC023055941BD257C63A655A0A664CBC10",
                "instances=1",
                "renderers=" + city.GetComponentsInChildren<Renderer>(true)
                    .Count(renderer => renderer != null && renderer.enabled),
                "total_triangles=" + triangleCount,
                "source_materials=" + string.Join(";", materials
                    .Select(material => material.name).OrderBy(name => name))
            });
        }
    }
}
#endif
