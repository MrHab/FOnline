#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Lore boundary of Kromka: an irregular amber refusal line, a broken terrain
    /// apron, mountain headwaters, sparse remnants of old control and a dust storm.
    /// It intentionally does not build a continuous wall or a tower ring.
    /// </summary>
    internal static class KromkaGlobalMapBoundaryAuthoring
    {
        private const int Segments = 192;
        // Must match the rendered landmass edge; a 192-sided inset ring left
        // visible slivers between the 320 landmass edge vertices.
        private const int ApronSegments = 320;
        private const string GlobalScenePath =
            "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const float LineInset = 0.022f;
        private const float LineWidth = 0.16f;
        private const string MeshRoot = "Assets/Art/Kromka/Meshes/";
        private const string MaterialRoot = "Assets/Art/Kromka/Materials/";
        private const string BoundaryMeshPath = MeshRoot + "Kromka_BoundaryLine.asset";
        private const string ApronMeshPath = MeshRoot + "Kromka_BoundaryApron.asset";
        private const string BeaconMeshPath = MeshRoot + "Kromka_BoundaryBeacon.asset";
        private const string LampMeshPath = MeshRoot + "Kromka_BoundaryLamp.asset";
        private const string LineMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_BoundaryLine.mat";
        private const string DustMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_SandstormDust.mat";
        private const string TerrainMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTerrain_MEP.mat";
        private const string RockRoot = "Assets/MEP/MEP_Environment/MEP_Rocks/";
        private const string FenceRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";

        private static readonly string[] EdgeRocks =
        {
            RockRoot + "Cliff_01/Prefabs/MEP_Desert_Cliff_03.prefab",
            RockRoot + "Cliff_01/Prefabs/MEP_Desert_Cliff_05.prefab",
            RockRoot + "MEP_Rock_04/Prefabs/MEP_Rock_04_c_Sand.prefab",
            RockRoot + "MEP_Rock_05/Prefabs/MEP_Rock_05_j_Sand.prefab"
        };

        private static readonly float[] RockAngles =
        {
            -2.76f, -2.36f, -1.98f, -0.82f, -0.40f,
            0.08f, 0.55f, 2.13f, 2.56f, 2.92f
        };

        private static readonly float[] BeaconAngles =
        {
            -2.98f, -1.20f, 0.30f, 1.92f, 2.70f
        };

        private static readonly float[] FenceAngles =
        {
            -2.92f, -0.06f, 0.50f, 2.73f
        };

        internal static void Compose(Transform staticContent)
        {
            Transform previous = staticContent.Find("WorldEdge_AUTHORED");
            if (previous != null) UnityEngine.Object.DestroyImmediate(previous.gameObject);

            Transform worldEdge = Child(staticContent, "WorldEdge_AUTHORED");
            Transform storm = Child(worldEdge, "ToxicBoundaryFog_AUTHORED");
            Transform landscape = Child(worldEdge, "BoundaryLandscape_AUTHORED");

            Vector3[] playablePoints = BuildBoundaryPoints(LineInset, 0.045f);
            GameObject line = CreateMeshObject("BoundaryLine", storm,
                PersistMesh(BoundaryMeshPath,
                    BuildRibbonMesh("Kromka_BoundaryLine", playablePoints,
                        LineWidth, 0.58f)), RequireMaterial(LineMaterialPath), false);
            line.AddComponent<RoaGlobalMapBoundary>().Configure(playablePoints);

            CreateMeshObject("TerrainApron_FadesIntoStorm", landscape,
                PersistMesh(ApronMeshPath, BuildApronMesh()),
                RequireMaterial(TerrainMaterialPath), true);
            BuildRockRidges(landscape);
            BuildFenceFragments(landscape);
            BuildSparseBeacons(landscape);
            BuildDustStorm(storm);

            Child(worldEdge, "NoContinuousWall_LoreRule_REFERENCE");
            Child(worldEdge, "SparseControlRemnants_Only_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate lore world boundary")]
        public static void Validate()
        {
            GameObject worldEdge = GameObject.Find("WorldEdge_AUTHORED");
            if (worldEdge == null)
            {
                EditorSceneManager.OpenScene(GlobalScenePath, OpenSceneMode.Single);
                worldEdge = GameObject.Find("WorldEdge_AUTHORED");
            }
            Require(worldEdge != null, "The authored Kromka world edge is missing.");
            Transform storm = worldEdge.transform.Find("ToxicBoundaryFog_AUTHORED");
            Transform landscape = worldEdge.transform.Find("BoundaryLandscape_AUTHORED");
            Require(storm != null && landscape != null,
                "Boundary storm or landscape layer is missing.");
            Transform line = storm.Find("BoundaryLine");
            Require(line != null, "The amber boundary line is missing.");
            MeshFilter filter = line.GetComponent<MeshFilter>();
            MeshRenderer renderer = line.GetComponent<MeshRenderer>();
            RoaGlobalMapBoundary boundary = line.GetComponent<RoaGlobalMapBoundary>();
            Require(filter != null && filter.sharedMesh != null
                && filter.sharedMesh.vertexCount == Segments * 2,
                "The irregular boundary ribbon is incomplete.");
            Require(renderer != null && renderer.enabled
                && renderer.sharedMaterial == RequireMaterial(LineMaterialPath),
                "The boundary line does not use the animated amber material.");
            Material lineMaterial = renderer.sharedMaterial;
            Require(lineMaterial.shader != null
                && lineMaterial.shader.name ==
                    "Universal Render Pipeline/Realm of Ashes/Global Map Boundary Line"
                && lineMaterial.GetFloat("_ScrollSpeed") > 0f
                && lineMaterial.GetFloat("_PulseSpeed") > 0f
                && lineMaterial.GetFloat("_PulseAmount") > 0f
                && lineMaterial.GetColor("_FlashColor").r > 0.9f,
                "The old animated dash, pulse or refusal-flash effect was lost.");
            Require(boundary != null && boundary.PointCount == Segments,
                "The visible contour is not bound to route refusal.");
            Require(boundary.ContainsWorldPoint(Vector3.zero)
                && !boundary.ContainsWorldPoint(new Vector3(30f, 0f, 0f)),
                "The contour must accept its centre and reject the outer wasteland.");
            Vector3 eastRefusal = boundary.ClosestWorldPoint(
                new Vector3(30f, 0f, 0f));
            Require(eastRefusal.x > 15f && eastRefusal.x < 21f,
                "Boundary refusal does not resolve to the eastern dash line.");
            Transform apron = landscape.Find("TerrainApron_FadesIntoStorm");
            MeshFilter apronFilter = apron != null ? apron.GetComponent<MeshFilter>() : null;
            MeshRenderer apronRenderer = apron != null
                ? apron.GetComponent<MeshRenderer>() : null;
            Require(apronFilter != null && apronFilter.sharedMesh != null
                && apronFilter.sharedMesh.vertexCount == ApronSegments * 2
                && apronRenderer != null
                && apronRenderer.sharedMaterial == RequireMaterial(TerrainMaterialPath)
                && apronRenderer.bounds.extents.x > 19f
                && apronRenderer.bounds.extents.z > 15f,
                "The relief apron no longer carries terrain into the surrounding haze.");
            Mesh land = GameObject.Find("KromkaLandmass_Relief_100pct").GetComponent<MeshFilter>().sharedMesh;
            Vector3[] edgeVertices = land.vertices, apronVertices = apronFilter.sharedMesh.vertices;
            int lastTopRing = edgeVertices.Length - ApronSegments * 3;
            for (int i = 0; i < ApronSegments; i++)
                Require(Vector3.Distance(edgeVertices[lastTopRing + i], apronVertices[i * 2]) < .0001f,
                    "The playable terrain/apron join has a crack at edge vertex " + i);
            Require(landscape.Find("FloodedExit_NorthernTesma") == null
                && landscape.Find("FloodedExit_SouthernZeroBasin") == null,
                "Flat water sheets must not extend above the falling boundary apron.");
            Require(GameObject.Find("TesmaMountainHeadwaters_REFERENCE") != null,
                "The Tesma mountain-headwater reference is missing.");
            ParticleSystem[] dustFronts = worldEdge
                .GetComponentsInChildren<ParticleSystem>(true);
            Require(dustFronts.Length == 12,
                "The dry perimeter must contain twelve sparse dust fronts.");
            Material dustMaterial = RequireMaterial(DustMaterialPath);
            for (int i = 0; i < dustFronts.Length; i++)
            {
                ParticleSystemRenderer dustRenderer =
                    dustFronts[i].GetComponent<ParticleSystemRenderer>();
                ParticleSystem.MinMaxGradient startColour =
                    dustFronts[i].main.startColor;
                Require(dustRenderer != null
                    && dustRenderer.sharedMaterial == dustMaterial
                    && startColour.colorMax.r > startColour.colorMax.g
                    && startColour.colorMax.g > startColour.colorMax.b,
                    "A boundary dust front lost its ochre storm material.");
            }
            Require(landscape.GetComponentsInChildren<Transform>(true)
                .Count(item => item.name.StartsWith("WarningBeacon_",
                    StringComparison.Ordinal)) == BeaconAngles.Length,
                "The sparse warning-beacon count changed.");
            Require(landscape.GetComponentsInChildren<Light>(true).Count(light =>
                    light.transform.name == "AmberSignal")
                == BeaconAngles.Length,
                "A warning beacon lost its amber signal.");
            Require(landscape.GetComponentsInChildren<Transform>(true)
                .Count(item => item.name.StartsWith("BrokenRoadBarrier_",
                    StringComparison.Ordinal)) == FenceAngles.Length,
                "The broken barrier-fragment count changed.");
            Require(landscape.GetComponentsInChildren<Transform>(true)
                .Count(item => item.name.StartsWith("EdgeRockRidge_",
                    StringComparison.Ordinal)) == RockAngles.Length,
                "The perimeter rock-ridge count changed.");
            Require(worldEdge.GetComponentsInChildren<Collider>(true)
                .All(collider => !collider.enabled),
                "Boundary dressing must not create hidden physical walls.");
            Require(worldEdge.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Boundary dressing must stay visible at every strategic distance.");
            Require(!worldEdge.GetComponentsInChildren<Transform>(true).Any(item =>
                    item.name.IndexOf("BoundaryWall", StringComparison.OrdinalIgnoreCase) >= 0
                    || item.name.IndexOf("TowerRing", StringComparison.OrdinalIgnoreCase) >= 0
                    || item.name.IndexOf("WallRing", StringComparison.OrdinalIgnoreCase) >= 0),
                "A continuous boundary wall or tower ring returned to Kromka.");
            Require(GameObject.Find("NoContinuousWall_LoreRule_REFERENCE") != null,
                "The no-continuous-wall lore contract is missing.");
            Debug.Log("[KROMKA BOUNDARY] PASS: irregular refusal contour, terrain "
                + "apron, grounded mountain headwaters, ten rock ridges, four broken barrier "
                + "fragments, five warning beacons and twelve dust fronts; no "
                + "continuous wall or tower ring.");
        }

        private static Vector3[] BuildBoundaryPoints(float inset, float lift)
        {
            var points = new Vector3[Segments];
            for (int i = 0; i < Segments; i++)
            {
                float angle = i / (float)Segments * Mathf.PI * 2f;
                points[i] = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                    angle, inset, lift);
            }
            return points;
        }

        private static Mesh BuildRibbonMesh(string name, Vector3[] points,
                                            float width, float repeatLength)
        {
            var vertices = new List<Vector3>(points.Length * 2);
            var uv = new List<Vector2>(points.Length * 2);
            var triangles = new List<int>(points.Length * 6);
            float distance = 0f;
            for (int i = 0; i < points.Length; i++)
            {
                Vector3 previous = points[(i - 1 + points.Length) % points.Length];
                Vector3 next = points[(i + 1) % points.Length];
                Vector2 tangent = new Vector2(next.x - previous.x,
                    next.z - previous.z).normalized;
                Vector2 side = new Vector2(-tangent.y, tangent.x) * (width * 0.5f);
                if (i > 0) distance += Vector3.Distance(points[i - 1], points[i]);
                vertices.Add(points[i] + new Vector3(side.x, 0f, side.y));
                vertices.Add(points[i] - new Vector3(side.x, 0f, side.y));
                float u = distance / Mathf.Max(0.05f, repeatLength);
                uv.Add(new Vector2(u, 0f));
                uv.Add(new Vector2(u, 1f));
            }
            for (int i = 0; i < points.Length; i++)
            {
                int next = (i + 1) % points.Length;
                int a = i * 2;
                int b = next * 2;
                triangles.Add(a); triangles.Add(b); triangles.Add(a + 1);
                triangles.Add(a + 1); triangles.Add(b); triangles.Add(b + 1);
            }
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh BuildApronMesh()
        {
            var vertices = new List<Vector3>(ApronSegments * 2);
            var uv = new List<Vector2>(ApronSegments * 2);
            var triangles = new List<int>(ApronSegments * 6);
            for (int i = 0; i < ApronSegments; i++)
            {
                float angle = i / (float)ApronSegments * Mathf.PI * 2f;
                Vector3 inner = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                    angle, 0f, 0f);
                Vector3 outer = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                    angle, -0.145f, 0f);
                outer.y = Mathf.Lerp(-0.98f, -0.82f,
                    0.5f + 0.5f * Mathf.Sin(angle * 5f + 0.7f));
                vertices.Add(inner);
                vertices.Add(outer);
                uv.Add(MapUv(inner));
                uv.Add(MapUv(outer));
            }
            for (int i = 0; i < ApronSegments; i++)
            {
                int next = (i + 1) % ApronSegments;
                int a = i * 2;
                int b = next * 2;
                triangles.Add(a); triangles.Add(b); triangles.Add(a + 1);
                triangles.Add(a + 1); triangles.Add(b); triangles.Add(b + 1);
            }
            var mesh = new Mesh { name = "Kromka_BoundaryApron" };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        [MenuItem("Realm of Ashes/Authoring/Visual review/Weld inner terrain join")]
        public static void RepairInnerTerrainJoin()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode
                || SceneManager.GetActiveScene().path != GlobalScenePath)
                throw new InvalidOperationException("Open the global map outside Play Mode.");
            PersistMesh(ApronMeshPath, BuildApronMesh());
            AssetDatabase.SaveAssets();
            KromkaSceneCapture.SaveOpenGeneratedGlobalMap();
            KromkaGlobalMapOuterWastelandPerimeterAuthoring.RepairTerrainJoins();
            Validate();
        }

        private static void BuildRockRidges(Transform parent)
        {
            Transform root = Child(parent, "SparseRockRidges_MEP");
            for (int i = 0; i < RockAngles.Length; i++)
            {
                Vector2 map = KromkaGlobalMapReliefAuthoring.BoundaryMapPoint(
                    RockAngles[i], 0.070f + (i % 3) * 0.012f);
                KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                    EdgeRocks[i % EdgeRocks.Length], "EdgeRockRidge_" + (i + 1),
                    root, map.x, map.y, 1.05f + (i % 3) * 0.16f,
                    0.72f + (i % 2) * 0.12f, -RockAngles[i] * Mathf.Rad2Deg,
                    0.075f);
            }
        }

        private static void BuildFenceFragments(Transform parent)
        {
            Transform root = Child(parent, "BrokenBarrierFragments_MEP");
            string[] paths =
            {
                FenceRoot + "MEP_Fence_01_N.prefab",
                FenceRoot + "MEP_Fence_02_N.prefab",
                FenceRoot + "MEP_Fence_03_N.prefab"
            };
            for (int i = 0; i < FenceAngles.Length; i++)
            {
                Vector3 point = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                    FenceAngles[i], 0.050f, 0f);
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                    paths[i % paths.Length]);
                if (prefab == null) throw new InvalidOperationException(
                    "Missing MEP boundary fence: " + paths[i % paths.Length]);
                GameObject instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
                instance.name = "BrokenRoadBarrier_" + (i + 1);
                instance.transform.SetParent(root, false);
                instance.transform.position = point;
                instance.transform.rotation = Quaternion.Euler(0f,
                    -FenceAngles[i] * Mathf.Rad2Deg + 90f + i * 7f,
                    i % 2 == 0 ? -7f : 5f);
                FitAndSeat(instance, point, 1.35f, 0.55f, 0.035f);
            }
        }

        private static void BuildSparseBeacons(Transform parent)
        {
            Transform root = Child(parent, "SparseWarningBeacons_AUTHORED");
            Mesh bodyMesh = PersistMesh(BeaconMeshPath, BuildBeaconBodyMesh());
            Mesh lampMesh = PersistMesh(LampMeshPath, BuildLampMesh());
            Material metal = BuildLitMaterial("Kromka_BoundaryBeacon_MEP",
                new Color(0.19f, 0.17f, 0.13f), false);
            Material lamp = BuildLitMaterial("Kromka_BoundaryBeaconLamp_MEP",
                new Color(1f, 0.34f, 0.055f), true);

            for (int i = 0; i < BeaconAngles.Length; i++)
            {
                Vector3 point = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                    BeaconAngles[i], 0.072f, 0.01f);
                GameObject beacon = CreateMeshObject("WarningBeacon_" + (i + 1),
                    root, bodyMesh, metal, true);
                beacon.transform.position = point;
                beacon.transform.rotation = Quaternion.Euler(0f,
                    -BeaconAngles[i] * Mathf.Rad2Deg + 90f, 0f);
                GameObject signal = CreateMeshObject("AmberSignal", beacon.transform,
                    lampMesh, lamp, false);
                signal.transform.localPosition = new Vector3(0f, 1.30f, 0f);
                Light light = signal.AddComponent<Light>();
                light.type = LightType.Point;
                light.color = new Color(1f, 0.38f, 0.08f);
                light.intensity = 0.34f;
                light.range = 2.2f;
                light.shadows = LightShadows.None;
            }
        }

        private static Mesh BuildBeaconBodyMesh()
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            AddBox(vertices, triangles, new Vector3(0f, 0.56f, 0f),
                new Vector3(0.10f, 1.12f, 0.10f));
            AddBox(vertices, triangles, new Vector3(0f, 1.06f, 0f),
                new Vector3(0.66f, 0.09f, 0.09f));
            AddBox(vertices, triangles, new Vector3(0f, 0.72f, 0.025f),
                new Vector3(0.54f, 0.28f, 0.055f));
            AddBox(vertices, triangles, new Vector3(-0.25f, 0.11f, 0f),
                new Vector3(0.10f, 0.22f, 0.34f));
            AddBox(vertices, triangles, new Vector3(0.25f, 0.11f, 0f),
                new Vector3(0.10f, 0.22f, 0.34f));
            return FinishMesh("Kromka_BoundaryBeacon", vertices, triangles);
        }

        private static Mesh BuildLampMesh()
        {
            Vector3[] vertices =
            {
                new Vector3(0f, 0.14f, 0f), new Vector3(0f, -0.14f, 0f),
                new Vector3(0.13f, 0f, 0f), new Vector3(-0.13f, 0f, 0f),
                new Vector3(0f, 0f, 0.13f), new Vector3(0f, 0f, -0.13f)
            };
            int[] triangles =
            {
                0,2,4, 0,4,3, 0,3,5, 0,5,2,
                1,4,2, 1,3,4, 1,5,3, 1,2,5
            };
            var mesh = new Mesh { name = "Kromka_BoundaryLamp",
                vertices = vertices, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void BuildDustStorm(Transform parent)
        {
            Transform root = Child(parent, "DustStormPerimeter_AUTHORED");
            Material dust = RequireMaterial(DustMaterialPath);
            var wind = new Vector3(-0.26f, 0.02f, -0.17f);
            for (int i = 0; i < 14; i++)
            {
                float angle = (i + 0.35f) / 14f * Mathf.PI * 2f;
                // Flooded north/south outlets keep cold mist instead of dense dust.
                float verticalAlignment = Mathf.Abs(Mathf.Cos(angle));
                if (verticalAlignment < 0.16f) continue;
                BuildDustEmitter(root, "DustFront_" + (i + 1), angle, dust, wind);
            }
        }

        private static void BuildDustEmitter(Transform parent, string name,
                                             float angle, Material material,
                                             Vector3 wind)
        {
            Vector3 point = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                angle, -0.065f, 0.52f);
            Vector3 previous = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                angle - 0.03f, -0.065f, 0.52f);
            Vector3 next = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(
                angle + 0.03f, -0.065f, 0.52f);
            Vector3 tangent = next - previous;

            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.position = point;
            go.transform.rotation = Quaternion.Euler(0f,
                Mathf.Atan2(tangent.x, tangent.z) * Mathf.Rad2Deg, 0f);
            ParticleSystem ps = go.AddComponent<ParticleSystem>();
            ParticleSystem.MainModule main = ps.main;
            main.loop = true;
            main.prewarm = true;
            main.duration = 10f;
            main.startLifetime = new ParticleSystem.MinMaxCurve(8f, 13f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(0.02f, 0.08f);
            main.startSize3D = true;
            main.startSizeX = new ParticleSystem.MinMaxCurve(2.2f, 4.6f);
            main.startSizeY = new ParticleSystem.MinMaxCurve(0.9f, 2.1f);
            main.startSizeZ = 1f;
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(0.58f, 0.43f, 0.27f, 0.20f),
                new Color(0.79f, 0.64f, 0.44f, 0.34f));
            main.maxParticles = 76;
            main.simulationSpace = ParticleSystemSimulationSpace.World;

            ParticleSystem.EmissionModule emission = ps.emission;
            emission.rateOverTime = 5.2f;
            ParticleSystem.ShapeModule shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(7.4f, 1.25f, 2.6f);

            ParticleSystem.VelocityOverLifetimeModule velocity = ps.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.World;
            velocity.x = wind.x;
            velocity.y = wind.y;
            velocity.z = wind.z;
            ParticleSystem.NoiseModule noise = ps.noise;
            noise.enabled = true;
            noise.separateAxes = true;
            noise.strengthX = 0.32f;
            noise.strengthY = 0.09f;
            noise.strengthZ = 0.26f;
            noise.frequency = 0.12f;
            noise.scrollSpeed = 0.14f;
            noise.quality = ParticleSystemNoiseQuality.Medium;

            ParticleSystem.ColorOverLifetimeModule colour = ps.colorOverLifetime;
            colour.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(new[]
            {
                new GradientColorKey(Color.white, 0f),
                new GradientColorKey(new Color(0.88f, 0.77f, 0.62f), 1f)
            }, new[]
            {
                new GradientAlphaKey(0f, 0f),
                new GradientAlphaKey(0.58f, 0.18f),
                new GradientAlphaKey(0.48f, 0.75f),
                new GradientAlphaKey(0f, 1f)
            });
            colour.color = gradient;

            ParticleSystemRenderer renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.sharedMaterial = material;
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.maxParticleSize = 2.6f;
        }

        private static void FitAndSeat(GameObject instance, Vector3 target,
                                       float footprint, float maximumHeight,
                                       float embed)
        {
            LODGroup[] lodGroups = instance.GetComponentsInChildren<LODGroup>(true);
            for (int i = 0; i < lodGroups.Length; i++)
                UnityEngine.Object.DestroyImmediate(lodGroups[i]);
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++) colliders[i].enabled = false;
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            if (renderers.Length == 0) return;
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
            MarkStatic(instance);
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static GameObject CreateMeshObject(string name, Transform parent,
                                                   Mesh mesh, Material material,
                                                   bool shadows)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = shadows
                ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = shadows;
            MarkStatic(go);
            return go;
        }

        private static Mesh PersistMesh(string path, Mesh generated)
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

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null) throw new InvalidOperationException(
                "Missing boundary material: " + path);
            return material;
        }

        private static Material BuildLitMaterial(string name, Color colour,
                                                 bool emissive)
        {
            string path = MaterialRoot + name + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Shader shader = Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Standard");
            if (material == null)
            {
                material = new Material(shader) { name = name };
                AssetDatabase.CreateAsset(material, path);
            }
            material.shader = shader;
            material.color = colour;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
            material.SetFloat("_Smoothness", emissive ? 0.46f : 0.13f);
            if (emissive && material.HasProperty("_EmissionColor"))
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", colour * 3.2f);
            }
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void AddBox(List<Vector3> vertices, List<int> triangles,
                                   Vector3 centre, Vector3 size)
        {
            int start = vertices.Count;
            Vector3 half = size * 0.5f;
            vertices.Add(centre + new Vector3(-half.x, -half.y, -half.z));
            vertices.Add(centre + new Vector3(half.x, -half.y, -half.z));
            vertices.Add(centre + new Vector3(half.x, half.y, -half.z));
            vertices.Add(centre + new Vector3(-half.x, half.y, -half.z));
            vertices.Add(centre + new Vector3(-half.x, -half.y, half.z));
            vertices.Add(centre + new Vector3(half.x, -half.y, half.z));
            vertices.Add(centre + new Vector3(half.x, half.y, half.z));
            vertices.Add(centre + new Vector3(-half.x, half.y, half.z));
            int[] faces =
            {
                0,2,1, 0,3,2, 4,5,6, 4,6,7,
                0,1,5, 0,5,4, 3,7,6, 3,6,2,
                0,4,7, 0,7,3, 1,2,6, 1,6,5
            };
            for (int i = 0; i < faces.Length; i++) triangles.Add(start + faces[i]);
        }

        private static Mesh FinishMesh(string name, List<Vector3> vertices,
                                       List<int> triangles)
        {
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Vector2 MapUv(Vector3 world)
        {
            return new Vector2(world.x / 38f + 0.5f, 0.5f - world.z / 30f);
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void MarkStatic(GameObject root)
        {
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic;
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(transforms[i].gameObject, flags);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
