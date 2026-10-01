#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Deterministic proposal for the 160 m Crossroads. The modular assembly
    /// follows Demo_City_Universal_RenderPipeline; canonical gameplay remains
    /// in data/locations/caravanCamp.json until the proposal is accepted.
    /// </summary>
    public static class RoaCrossroadsPreviewGenerator
    {
        public const string ScenePath = "Assets/Scenes/Proposals/CaravanCampCrossroadsPreview.unity";
        private const string Pack = "Assets/Synty/PolygonApocalypse/Prefabs/";
        private const float Tile = 5f;
        private static readonly string Road = "Environment/SM_Env_Road_01.prefab";
        private static readonly string Bare = "Environment/SM_Env_Road_Bare_01.prefab";
        private static readonly string Sidewalk = "Environment/SM_Env_Sidewalk_Straight_01.prefab";
        private static readonly string Crossing = "Environment/SM_Env_Road_Crossing_01.prefab";
        private static readonly string[] PerimeterWalls = {
            "Props/SM_Prop_Wall_Junk_01.prefab", "Props/SM_Prop_Wall_Junk_05.prefab",
            "Props/SM_Prop_Wall_Junk_04.prefab", "Props/SM_Prop_Wall_Junk_03_Tarp.prefab"
        };
        // Widths of the authored FBX meshes at Unity's native 0.01 import scale.
        private static readonly float[] PerimeterWallWidths = { 6.2686f, 4.9036f, 4.2461f, 3.4014f };
        private static readonly int[] PerimeterWallSequence = { 0,1,0,2,3,0,1,2,0,1,0 };
        private static readonly string PlotSign = "Props/SM_Prop_Sign_01.prefab";
        private static readonly string RouteBarricade = "Props/SM_Prop_Barricade_Metal_01.prefab";
        private const string WatchTowerAsset = "Assets/Prefabs/Kromka/RecoveredEnvironment/scrap_watch_tower.prefab";
        private const string PlotFenceAsset = "Assets/Prefabs/Kromka/RecoveredEnvironment/fence_segment.prefab";
        private const string JobBoardAsset = "Assets/Prefabs/Kromka/RecoveredEnvironment/job_board.prefab";
        private static readonly Vector3 ProposedDispatchPosition = new Vector3(13, 0, 8);

        private struct Placement
        {
            public readonly string Name, Prefab;
            public readonly Vector3 Position;
            public readonly float Yaw;
            public Placement(string name, string prefab, float x, float z, float yaw = 0)
            {
                Name = name; Prefab = prefab; Position = new Vector3(x, 0, z); Yaw = yaw;
            }
        }

        // City services sit in the common yard, outside the 32 auction plots.
        // Every plot remains empty so a player's future station can fit.
        private static readonly Placement[] Modules =
        {
            new Placement("MarketServiceKiosk", "Buildings/SM_Bld_Shop_Small_01.prefab", -14, -35, 180),
            new Placement("MarketLamp", "Props/SM_Prop_LightPole_01.prefab", -16, -20),
            new Placement("MarketCargo", "Props/SM_Prop_Crate_Large_01.prefab", -16, -43, 15),
            new Placement("MarketHandcart", "Props/SM_Prop_Cart_01.prefab", -11, -43, 30),
            new Placement("MarketTradingShade", "Buildings/SM_Bld_Sunshade_01.prefab", -15, -48),
            new Placement("LeagueBankAndAuction", "Buildings/SM_Bld_Shop_Medium_01.prefab", 37, -35, 180),
            new Placement("BankLamp", "Props/SM_Prop_LightPole_01.prefab", 18, -36),
            new Placement("BankFreight", "Props/SM_Prop_Crate_Large_02.prefab", 39, -48, 12),
            new Placement("AuctionFloodlitNotice", "Props/SM_Prop_Floodlights_Sign_01.prefab", 15, -39),
            new Placement("RepairServiceKiosk", "Buildings/SM_Bld_Shop_Small_01.prefab", 14, 33, 180),
            new Placement("RepairGenerator", "Props/SM_Prop_Generator_01.prefab", 14, 48),
            new Placement("RepairPole", "Props/SM_Prop_Powerpole_Single_01.prefab", 14, 57),
            new Placement("RepairSalvage", "Props/SM_Prop_Crate_Open_01.prefab", 18, 44, 195),
            new Placement("RepairWreckedMachinery", "Props/SM_Prop_Car_Wrecked_Stack_01_Tarp.prefab", 15, 45),
            new Placement("LeagueWaterTower", "Buildings/SM_Bld_WaterTower_01.prefab", 17, 22),
            new Placement("NorthWaterReserve", "Props/SM_Prop_Barrel_Water_01.prefab", 18, 57),
            new Placement("NorthFreight", "Props/SM_Prop_Crate_Large_02.prefab", 17, 54, 30),
            new Placement("NorthCaravan", "Vehicles/SM_Veh_Caravan_01.prefab", 10, 50),
            new Placement("LeagueCargoCrane", "Buildings/SM_Bld_Crane_01.prefab", -11, 35),
            new Placement("SouthMaintenance", "Props/SM_Prop_Generator_01.prefab", -7, -57),
            new Placement("SouthSalvage", "Props/SM_Prop_Crate_Open_01.prefab", -11, -55, 15),

            new Placement("CaravanRig", "Vehicles/SM_Veh_BigRig_01.prefab", -13, -51, 90),
            new Placement("CaravanTrailer", "Vehicles/SM_Veh_Caravan_01.prefab", 9, -51, 0),
            new Placement("CaravanWater", "Props/SM_Prop_Barrel_Water_01.prefab", 15, -55),

            new Placement("PlazaShadeWest", "Buildings/SM_Bld_Sunshade_01.prefab", -12, 12),
            new Placement("PlazaShadeEast", "Buildings/SM_Bld_Sunshade_02.prefab", 10, 12),
            new Placement("PlazaWell", "Props/SM_Prop_Barrel_Water_01.prefab", 11, 7),
            new Placement("PlazaLampWest", "Props/SM_Prop_LightPole_01.prefab", -14, 14),
            new Placement("PlazaLampEast", "Props/SM_Prop_LightPole_01.prefab", 15, 14),
            new Placement("CheckpointWest", "Props/SM_Prop_Barricade_08.prefab", -62, -14, 90),
            new Placement("CheckpointEast", "Props/SM_Prop_Barricade_08.prefab", 63, -14, 90)
        };

        private static readonly string[] RequiredAnchors =
        {
            "caravan_sayla", "sofia_sych", "medic", "auctioneer", "repairman",
            "capital_storage_caravans",
            "bank_counter", "bank_vault",
            "plaza_board", "plaza_dispatch_post", "plaza_medic_post", "plaza_well",
            "gate_tower_east_a", "gate_tower_east_b", "gate_tower_west_a", "gate_tower_west_b",
            "gate_tower_north_a", "gate_tower_north_b", "gate_tower_south_a", "gate_tower_south_b"
        };

        [MenuItem("Realm of Ashes/Locations/Build Crossroads preview")]
        public static void Build()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Stop Play Mode before building the Crossroads preview.");
            JObject canonical = ReadCanonical();
            ValidateAssets();
            EnsureFolder("Assets/Scenes/Proposals");
            Scene previous = SceneManager.GetActiveScene();
            Scene existing = SceneManager.GetSceneByPath(ScenePath);
            bool existingWasActive = existing.IsValid() && existing.isLoaded && previous.handle == existing.handle;
            if (existing.IsValid() && existing.isLoaded && existing.isDirty)
                throw new InvalidOperationException("Save or close the edited Crossroads preview before rebuilding it.");
            // The artist's saved version has additional scene roots. Never
            // replace those hand-placed objects through the old full build.
            string savedScene = Path.Combine(Application.dataPath,
                ScenePath.Substring("Assets/".Length));
            if (File.Exists(savedScene))
            {
                Scene inspected = existing;
                bool previewOpened = !inspected.IsValid() || !inspected.isLoaded;
                if (previewOpened) inspected = EditorSceneManager.OpenPreviewScene(ScenePath);
                try
                {
                    if (inspected.rootCount > 1)
                        throw new InvalidOperationException("The Crossroads scene contains hand-placed artwork. Use Refresh Crossroads ground and backdrop; full Build would erase it.");
                }
                finally { if (previewOpened) EditorSceneManager.ClosePreviewScene(inspected); }
            }
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
            try
            {
                if (existing.IsValid() && existing.isLoaded) EditorSceneManager.CloseScene(existing, true);
                SceneManager.SetActiveScene(scene);
                BuildScene(scene, canonical);
                if (!EditorSceneManager.SaveScene(scene, ScenePath))
                    throw new IOException("Unity did not save " + ScenePath);
                AssetDatabase.SaveAssets();
                Debug.Log("[KROMKA] Crossroads proposal rebuilt from canonical caravanCamp anchors: " + ScenePath);
            }
            catch
            {
                Scene restored = previous;
                if (existingWasActive && File.Exists(Path.Combine(Application.dataPath,
                        ScenePath.Substring("Assets/".Length))))
                    restored = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive);
                EditorSceneManager.CloseScene(scene, true);
                if (restored.IsValid() && restored.isLoaded) SceneManager.SetActiveScene(restored);
                throw;
            }
        }

        // Refresh only the finish of an artist-edited proposal. Build() would
        // replace the entire scene, including objects placed by hand.
        [MenuItem("Realm of Ashes/Locations/Refresh Crossroads ground and backdrop")]
        public static void RefreshGroundAndBackdrop()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Stop Play Mode before refreshing the Crossroads artwork.");
            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            bool opened = !scene.IsValid() || !scene.isLoaded;
            Scene previous = SceneManager.GetActiveScene();
            if (opened) scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive);
            try
            {
                Transform root = null;
                foreach (GameObject candidate in scene.GetRootGameObjects())
                    if (candidate.name == "Crossroads_Proposal_160x160") root = candidate.transform;
                if (root == null || root.Find("01_Raised_Isthmus_And_Lowlands/CrossroadsRelief") == null)
                    throw new InvalidOperationException("The saved Crossroads relief is missing.");
                JObject canonical = ReadCanonical();
                var centers = new List<Vector2>();
                Transform savedPlots = root.Find("07_All_32_Auction_Plots_Proposal");
                if (savedPlots == null)
                    throw new InvalidOperationException("The saved auction plot group is missing.");
                foreach (Transform plot in savedPlots)
                    if (IsPlotGround(plot.name))
                        centers.Add(new Vector2(plot.position.x, plot.position.z));
                if (centers.Count == 0)
                    throw new InvalidOperationException("The saved scene has no auction plots.");
                float seedOffset = ((int)canonical["seed"] & 65535) * .013f;
                Texture2D albedo = WriteTerrainAlbedo(centers, seedOffset);
                Material material = MaterialAsset("CrossroadsRelief", Color.white);
                material.SetTexture("_BaseMap", albedo);
                EditorUtility.SetDirty(material);
                AddDemoBackdrop(scene, root);
                EditorSceneManager.MarkSceneDirty(scene);
                if (!EditorSceneManager.SaveScene(scene))
                    throw new IOException("Could not save the edited Crossroads scene.");
                AssetDatabase.SaveAssets();
                Debug.Log("[KROMKA] Refreshed Crossroads ground and demo backdrop without rebuilding artist objects.");
            }
            finally
            {
                if (opened) EditorSceneManager.CloseScene(scene, true);
                if (previous.IsValid() && previous.isLoaded) SceneManager.SetActiveScene(previous);
            }
        }

        private static void AddDemoBackdrop(Scene scene, Transform root)
        {
            if (root.Find("08_Demo_Backdrop_Cards_And_Clouds") != null) return;
            const string demoPath = "Assets/Synty/PolygonApocalypse/Scenes/Demo_City_Universal_RenderPipeline.unity";
            Scene demo = EditorSceneManager.OpenPreviewScene(demoPath);
            try
            {
                Transform group = Child(root, "08_Demo_Backdrop_Cards_And_Clouds");
                foreach (GameObject demoRoot in demo.GetRootGameObjects())
                {
                    if (demoRoot.name != "Demo") continue;
                    int index = 0;
                    foreach (Transform original in demoRoot.transform)
                    {
                        bool card = original.name.StartsWith("SM_Env_BackgroundCard_", StringComparison.Ordinal);
                        bool clouds = original.name == "SM_Generic_CloudRing_01";
                        if (!card && !clouds) continue;
                        GameObject source = PrefabUtility.GetCorrespondingObjectFromSource(original.gameObject);
                        if (source == null) throw new InvalidOperationException("Demo backdrop source is missing: " + original.name);
                        GameObject copy = (GameObject)PrefabUtility.InstantiatePrefab(source, scene);
                        copy.name = clouds ? "Backdrop_CloudRing" : "Backdrop_MountainCard_" + index++;
                        copy.transform.SetParent(group, false);
                        copy.transform.localPosition = original.localPosition * .52f;
                        copy.transform.localRotation = original.localRotation;
                        copy.transform.localScale = original.localScale * .52f;
                        foreach (Renderer renderer in copy.GetComponentsInChildren<Renderer>())
                        {
                            renderer.shadowCastingMode = ShadowCastingMode.Off;
                            renderer.receiveShadows = false;
                        }
                        foreach (Collider collider in copy.GetComponentsInChildren<Collider>())
                            collider.enabled = false;
                    }
                }
                if (group.childCount < 14)
                    throw new InvalidOperationException("The Polygon Apocalypse demo backdrop is incomplete.");
            }
            finally { EditorSceneManager.ClosePreviewScene(demo); }
        }

        private static JObject ReadCanonical()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/locations/caravanCamp.json"));
            JObject location = JObject.Parse(File.ReadAllText(path));
            if ((string)location["id"] != "caravanCamp" || (string)location["name"] != "Перекрёсток"
                || (string)location["macroRegion"] != "tract_isthmus"
                || (int?)location["map"]?["width"] != 160 || (int?)location["map"]?["depth"] != 160
                || (bool?)location["safe"] != true || (string)location["pvpMode"] != "peaceful")
                throw new InvalidOperationException("Canonical Crossroads identity, safety or footprint changed.");
            foreach (string id in RequiredAnchors) FindPosition(location, id);
            int plots = 0;
            foreach (JToken item in (JArray)location["objects"])
            {
                string id = (string)item["id"];
                if (!IsPlotGround(id)) continue;
                if ((float?)item["footprint"]?["x"] != 14f
                    || (float?)item["footprint"]?["z"] != 14f)
                    throw new InvalidOperationException("Auction plot footprint changed: " + id);
                plots++;
            }
            if (plots != 32) throw new InvalidOperationException("Expected 32 canonical auction plot sites, found " + plots);
            return location;
        }

        private static bool IsPlotGround(string id)
        {
            return id != null && id.StartsWith("plot_", StringComparison.Ordinal)
                && id.EndsWith("_ground", StringComparison.Ordinal);
        }

        private static Vector3 FindPosition(JObject location, string id)
        {
            foreach (JToken item in (JArray)location["objects"])
                if ((string)item["id"] == id)
                    return new Vector3((float)item["position"]["x"], 0, (float)item["position"]["z"]);
            throw new InvalidOperationException("Missing canonical Crossroads object: " + id);
        }

        private static void ValidateAssets()
        {
            foreach (Placement module in Modules) Require(module.Prefab);
            foreach (string name in new[] { Road, Bare, Sidewalk,
                Crossing, PlotSign, RouteBarricade,
                "Environment/SM_Env_StormCanal_Straight_01.prefab",
                "Environment/SM_Env_Motorway_Edge_01.prefab",
                "Environment/SM_Env_Rock_01.prefab",
                "Environment/SM_Env_DirtPile_01.prefab",
                "Environment/SM_Env_Bushes_01.prefab" }) Require(name);
            foreach (string wall in PerimeterWalls) Require(wall);
            if (AssetDatabase.LoadAssetAtPath<GameObject>(WatchTowerAsset) == null)
                throw new FileNotFoundException("Missing canonical Crossroads watch tower", WatchTowerAsset);
            if (AssetDatabase.LoadAssetAtPath<GameObject>(PlotFenceAsset) == null)
                throw new FileNotFoundException("Missing canonical auction boundary marker", PlotFenceAsset);
            if (AssetDatabase.LoadAssetAtPath<GameObject>(JobBoardAsset) == null)
                throw new FileNotFoundException("Missing Kromka civic sign prefab");
        }

        private static GameObject Require(string relativePath)
        {
            string path = Pack + relativePath;
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) throw new FileNotFoundException("Missing Polygon Apocalypse prefab", path);
            return prefab;
        }

        private static void BuildScene(Scene scene, JObject canonical)
        {
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogStartDistance = 180;
            RenderSettings.fogEndDistance = 800;
            RenderSettings.fogColor = new Color(.68f, .63f, .53f);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.61f, .56f, .47f);

            Transform root = new GameObject("Crossroads_Proposal_160x160").transform;
            Transform land = Child(root, "01_Raised_Isthmus_And_Lowlands");
            Transform surfaces = Child(root, "02_Modular_Roads_And_Drainage");
            Transform perimeter = Child(root, "03_Perimeter_And_Gates");
            Transform districts = Child(root, "04_Four_Functional_Districts");
            Transform props = Child(root, "05_Seeded_Secondary_Dressing");
            Transform anchors = Child(root, "06_Proposal_Anchors_Reference_Only");
            Transform auctionPlots = Child(root, "07_All_32_Auction_Plots_Proposal");

            BuildTerrain(land, canonical);
            // Native paving forms two small connected forecourts, one tile
            // deep from the carriageway. Dirt remains visible around them.
            for (int x = -3; x <= -2; x++)
                for (int z = 0; z <= 1; z++)
                    SurfaceTile(scene, land, "WestPedestrianCourt",
                        "Environment/SM_Env_Sidewalk_02.prefab", x, z);
            for (int x = 1; x <= 2; x++)
                for (int z = 0; z <= 1; z++)
                    SurfaceTile(scene, land, "EastPedestrianCourt",
                        "Environment/SM_Env_Sidewalk_02.prefab", x, z);

            var occupied = new HashSet<int>();
            // The through route runs between towers at z=-7 and z=+9.
            // It bends one tile toward z<0 around the two pedestrian courts,
            // keeping Saila at (-7,+3) out of the carriageway.
            for (int x = -16; x <= 15; x++)
                for (int z = -2; z <= 0; z++)
                    if (MainRoadHasCell(x, z))
                    {
                        bool crossing = (x == -3 || x == 2) && (z == -2 || z == -1);
                        string road = crossing ? Crossing : (Math.Abs(x) <= 3 ? Bare : Road);
                        RoadTile(scene, surfaces, occupied, x, z, road, 90);
                    }
            for (int z = -16; z <= -1; z++)
                for (int x = -1; x <= 0; x++) RoadTile(scene, surfaces, occupied, x, z, (z % 9 == 0) ? Bare : Road);
            for (int z = 0; z <= 15; z++) RoadTile(scene, surfaces, occupied, 0, z, Bare);
            // Crossing prefabs replace road cells; overlapping coplanar tiles flicker.
            for (int x = -16; x <= 15; x++)
            {
                if (x < -4 || x > 3)
                    SurfaceTile(scene, surfaces, "NorthVerge", Sidewalk, x, 1);
                if (x < -4 || x > 3)
                    SurfaceTile(scene, surfaces, "SouthVerge", Sidewalk, x, -2);
            }
            for (int z = -16; z <= -4; z++)
            {
                SurfaceTile(scene, surfaces, "WestSpurVerge", Sidewalk, -2, z);
                SurfaceTile(scene, surfaces, "EastSpurVerge", Sidewalk, 1, z);
            }
            // The demo city also composes kerbs, drainage and highway edges
            // from repeating modules rather than one stretched surface.
            for (int x = -15; x <= 14; x++)
            {
                if (Math.Abs(x) <= 2) continue;
                SurfaceTile(scene, surfaces, "DrainZMinus", "Environment/SM_Env_StormCanal_Straight_01.prefab", x, -3);
                SurfaceTile(scene, surfaces, "DrainZPlus", "Environment/SM_Env_StormCanal_Straight_01.prefab", x, 2);
            }
            for (int x = -16; x <= 15; x++)
            {
                if (Math.Abs(x) < 13) continue;
                SurfaceTile(scene, surfaces, "EmbankmentEdgeZMinus", "Environment/SM_Env_Motorway_Edge_01.prefab", x, -3);
                SurfaceTile(scene, surfaces, "EmbankmentEdgeZPlus", "Environment/SM_Env_Motorway_Edge_01.prefab", x, 2);
            }

            BuildPerimeter(perimeter);
            BuildAuctionPlots(auctionPlots, canonical);
            foreach (Placement item in Modules) Place(scene, districts, item.Name, item.Prefab, item.Position, item.Yaw);
            PlaceAuthored(scene, districts, "PlazaDispatch", JobBoardAsset,
                ProposedDispatchPosition, 180);
            PlaceAuthored(scene, districts, "PlazaBoard", JobBoardAsset,
                new Vector3(-9, 0, 9), 180);
            BuildRoutePylon(scene, districts);
            BuildDistrictWayfinding(scene, districts);
            AddSeededDressing(scene, props, (int)canonical["seed"]);
            foreach (string id in RequiredAnchors)
            {
                Vector3 point = FindPosition(canonical, id);
                // The live dispatch awning is at (13,-7), on the proposed
                // through lane. This approval proposal moves it onto the
                // eastern pedestrian court; canonical data changes later.
                if (id == "plaza_dispatch_post") point = ProposedDispatchPosition;
                Anchor(anchors, id, point.x, point.z);
            }
            Anchor(anchors, "arrival", (float)canonical["spawn"]["x"], (float)canonical["spawn"]["z"]);
            Anchor(anchors, "migration", -2, -21);
            Anchor(anchors, "primary_exit", 1, -31);
            Anchor(anchors, "z_minus_gate", 0, -67);
            Anchor(anchors, "z_plus_service_gate", 0, 69);
            ValidateOpenRoutes(occupied);
            ValidateRoadClearances(districts, surfaces);
            ValidateGameplayClearances(districts, canonical);
            ValidateGateClearances(perimeter);
            ValidateAuctionPlotClearances(districts, land, perimeter, canonical);

            GameObject sun = new GameObject("PreviewSun");
            sun.transform.SetParent(root, false);
            sun.transform.rotation = Quaternion.Euler(42, -32, 0);
            Light light = sun.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.12f;
            GameObject cameraObject = new GameObject("PreviewCamera");
            cameraObject.transform.SetParent(root, false);
            cameraObject.transform.position = new Vector3(0, 145, -115);
            cameraObject.transform.LookAt(Vector3.zero);
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 103;
        }

        private static void BuildTerrain(Transform parent, JObject canonical)
        {
            int seed = (int)canonical["seed"];
            var plotCenters = new List<Vector2>();
            foreach (JToken item in (JArray)canonical["objects"])
                if (IsPlotGround((string)item["id"]))
                    plotCenters.Add(new Vector2((float)item["position"]["x"],
                        (float)item["position"]["z"]));
            const int segments = 130;
            const float halfExtent = 130f;
            int side = segments + 1;
            var vertices = new Vector3[side * side];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[segments * segments * 6];
            float seedOffset = (seed & 65535) * .013f;
            for (int z = 0; z <= segments; z++)
            for (int x = 0; x <= segments; x++)
            {
                float wx = x * 2f - halfExtent;
                float wz = z * 2f - halfExtent;
                int i = z * side + x;
                vertices[i] = new Vector3(wx, TerrainHeight(wx, wz, seedOffset), wz);
                uv[i] = new Vector2(x / (float)segments, z / (float)segments);
            }
            int t = 0;
            for (int z = 0; z < segments; z++)
            for (int x = 0; x < segments; x++)
            {
                int a = z * side + x, b = a + 1, c = a + side, d = c + 1;
                triangles[t++] = a; triangles[t++] = c; triangles[t++] = b;
                triangles[t++] = b; triangles[t++] = c; triangles[t++] = d;
            }
            const string directory = "Assets/Scenes/Proposals/Generated";
            EnsureFolder(directory);
            const string meshPath = directory + "/CrossroadsRelief.asset";
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
            if (mesh == null)
            {
                mesh = new Mesh { name = "CrossroadsRelief" };
                AssetDatabase.CreateAsset(mesh, meshPath);
            }
            mesh.Clear();
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            EditorUtility.SetDirty(mesh);

            Texture2D albedo = WriteTerrainAlbedo(plotCenters, seedOffset);
            Material material = MaterialAsset("CrossroadsRelief", Color.white);
            material.SetTexture("_BaseMap", albedo);
            EditorUtility.SetDirty(material);

            GameObject terrain = new GameObject("CrossroadsRelief");
            terrain.transform.SetParent(parent, false);
            terrain.AddComponent<MeshFilter>().sharedMesh = mesh;
            terrain.AddComponent<MeshRenderer>().sharedMaterial = material;
            terrain.AddComponent<MeshCollider>().sharedMesh = mesh;
        }

        private static Texture2D WriteTerrainAlbedo(IReadOnlyList<Vector2> plotCenters,
            float seedOffset)
        {
            const string texturePath = "Assets/Scenes/Proposals/Generated/CrossroadsReliefAlbedo.png";
            const int textureSize = 1024;
            var source = new Texture2D(textureSize, textureSize, TextureFormat.RGBA32, true);
            var pixels = new Color32[textureSize * textureSize];
            for (int z = 0; z < textureSize; z++)
            for (int x = 0; x < textureSize; x++)
            {
                float wx = (x / (float)(textureSize - 1) - .5f) * 260f;
                float wz = (z / (float)(textureSize - 1) - .5f) * 260f;
                float lowland = LowlandFactor(wx, wz);
                float broad = Mathf.PerlinNoise(wx * .018f + seedOffset + 38f,
                    wz * .018f + seedOffset + 38f);
                float drift = Mathf.PerlinNoise(wx * .065f + seedOffset,
                    wz * .065f + seedOffset);
                float grit = Mathf.PerlinNoise(wx * .48f + seedOffset + 103f,
                    wz * .48f + seedOffset + 103f);
                // The demo's ground reads as broad, quiet sand tones. Small
                // high-frequency flecks made the old terrain look mottled.
                Color earth = Color.Lerp(new Color(.55f, .48f, .38f),
                    new Color(.43f, .40f, .35f), lowland);
                float variation = (broad - .5f) * .05f
                    + (drift - .5f) * .025f + (grit - .5f) * .009f;
                // Surveyed parcel edges are a weathered stain in the soil,
                // never a coplanar overlay or a built surface on the lot.
                float survey = 0;
                foreach (Vector2 center in plotCenters)
                {
                    float dx = Mathf.Abs(wx - center.x), dz = Mathf.Abs(wz - center.y);
                    if (dx > 7.15f || dz > 7.15f) continue;
                    float edge = Mathf.Min(Mathf.Abs(dx - 7f), Mathf.Abs(dz - 7f));
                    if (edge < .36f)
                        survey = Mathf.Max(survey, (1f - edge / .36f) * (.82f + drift * .18f));
                }
                variation -= survey * .105f;
                pixels[z * textureSize + x] = new Color(earth.r + variation,
                    earth.g + variation, earth.b + variation, 1);
            }
            source.SetPixels32(pixels);
            source.Apply();
            string fullTexturePath = Path.GetFullPath(Path.Combine(Application.dataPath,
                texturePath.Substring("Assets/".Length)));
            File.WriteAllBytes(fullTexturePath, source.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(source);
            AssetDatabase.ImportAsset(texturePath, ImportAssetOptions.ForceSynchronousImport);
            return AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
        }

        private static float LowlandFactor(float x, float z)
        {
            // The last auction footprint ends at 68 m. Start the eroded edge
            // outside it, with a small natural wobble instead of a square rim.
            float erosion = (Mathf.PerlinNoise(x * .045f + 23f, z * .045f + 71f) - .5f) * 2f;
            float beyondYard = Mathf.Max(Mathf.Abs(x), Mathf.Abs(z)) - 70f + erosion;
            float axisDistance = Mathf.Min(Mathf.Abs(x), Mathf.Abs(z));
            float slope = Mathf.SmoothStep(0, 1, Mathf.Clamp01(beyondYard / 13f));
            float outsideCauseway = Mathf.SmoothStep(0, 1,
                Mathf.Clamp01((axisDistance - 6f) / 8f));
            return slope * outsideCauseway;
        }

        private static float TerrainHeight(float x, float z, float seedOffset)
        {
            float lowland = LowlandFactor(x, z);
            float broad = Mathf.PerlinNoise(x * .058f + seedOffset, z * .058f + seedOffset);
            float fine = Mathf.PerlinNoise(x * .17f + seedOffset + 51f,
                z * .17f + seedOffset + 51f);
            return -.08f - 3.1f * lowland
                + (broad - .5f) * (.05f + 1.25f * lowland)
                + (fine - .5f) * (.025f + .18f * lowland);
        }

        private static void BuildPerimeter(Transform parent)
        {
            // Four junk-wall variants are arranged in native size with ~9 cm
            // breathing gaps, ending at the authored gate tower footprints.
            Scene scene = parent.gameObject.scene;
            // Deep scrap variants stay outside the outer plot borders.
            foreach (float z in new[] { -67.4f, 69.4f })
            {
                BuildWallRun(scene, parent, "Wall_Z" + z + "_West", -67, -8.2f, z, true, false);
                BuildWallRun(scene, parent, "Wall_Z" + z + "_East", 10.2f, 69, z, true, true);
            }
            foreach (float x in new[] { -67.4f, 69.4f })
            {
                BuildWallRun(scene, parent, "Wall_X" + x + "_South", -67, -8.2f, x, false, true);
                BuildWallRun(scene, parent, "Wall_X" + x + "_North", 10.2f, 69, x, false, false);
            }
            GameObject towerAsset = AssetDatabase.LoadAssetAtPath<GameObject>(WatchTowerAsset);
            foreach (Vector2 p in new[] {
                new Vector2(-67,-7), new Vector2(-67,9), new Vector2(69,-7), new Vector2(69,9),
                new Vector2(-7,-67), new Vector2(9,-67), new Vector2(-7,69), new Vector2(9,69) })
            {
                GameObject tower = (GameObject)PrefabUtility.InstantiatePrefab(towerAsset, scene);
                tower.name = "GateTower_" + p.x + "_" + p.y;
                tower.transform.SetParent(parent, false);
                tower.transform.localPosition = new Vector3(p.x, 0, p.y);
                tower.transform.localRotation = Quaternion.identity;
                tower.transform.localScale = Vector3.one;
            }
            Place(scene, parent, "ServiceGate_Control_Left", RouteBarricade,
                new Vector3(-5.5f, 0, 66), 90);
            Place(scene, parent, "ServiceGate_Control_Right", RouteBarricade,
                new Vector3(5.5f, 0, 66), 90);
            RouteMarker(parent, "LeagueRoute_West", -57, -14);
            RouteMarker(parent, "LeagueRoute_East", 59, -14);
            RouteMarker(parent, "LeagueRoute_Caravan", -11, -58);
            RouteMarker(parent, "LeagueRoute_Service", 11, 58);
        }

        private static void BuildWallRun(Scene scene, Transform parent, string name,
            float from, float to, float fixedAxis, bool alongX, bool reverse)
        {
            float used = 0;
            foreach (int index in PerimeterWallSequence) used += PerimeterWallWidths[index];
            float gap = (to - from - used) / (PerimeterWallSequence.Length - 1);
            if (gap < 0) throw new InvalidOperationException("Native wall modules do not fit " + name);
            float cursor = from;
            float lastEnd = from;
            for (int i = 0; i < PerimeterWallSequence.Length; i++)
            {
                int index = PerimeterWallSequence[reverse ? PerimeterWallSequence.Length - 1 - i : i];
                float center = cursor + PerimeterWallWidths[index] * .5f;
                GameObject wall = Place(scene, parent, name + "_" + i, PerimeterWalls[index],
                    alongX ? new Vector3(center, 0, fixedAxis)
                        : new Vector3(fixedAxis, 0, center), alongX ? 0 : 90);
                Renderer[] renderers = wall.GetComponentsInChildren<Renderer>();
                Bounds bounds = renderers[0].bounds;
                for (int r = 1; r < renderers.Length; r++) bounds.Encapsulate(renderers[r].bounds);
                float actualStart = alongX ? bounds.min.x : bounds.min.z;
                float actualEnd = alongX ? bounds.max.x : bounds.max.z;
                if (Mathf.Abs(actualStart - cursor) > .08f
                    || Mathf.Abs(actualEnd - (cursor + PerimeterWallWidths[index])) > .08f
                    || (i > 0 && (actualStart - lastEnd > .15f || lastEnd - actualStart > .3f)))
                    throw new InvalidOperationException("Wall join or authored bounds changed: " + wall.name);
                lastEnd = actualEnd;
                cursor += PerimeterWallWidths[index] + gap;
            }
        }

        private static void RouteMarker(Transform parent, string name, float x, float z)
        {
            Place(parent.gameObject.scene, parent, name, PlotSign, new Vector3(x, 0, z), 0);
        }

        private static void BuildRoutePylon(Scene scene, Transform districts)
        {
            Transform pylon = Child(districts, "LeagueRoutePylon");
            pylon.localPosition = new Vector3(-17, 0, 13);
            Place(scene, pylon, "RecoveredRouteMast", "Props/SM_Prop_Powerpole_Single_01.prefab",
                Vector3.zero, 0);
            const string path = "Assets/Scenes/Proposals/Generated/CrossroadsRouteBlade.asset";
            EnsureFolder("Assets/Scenes/Proposals/Generated");
            Mesh blade = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (blade == null)
            {
                blade = new Mesh { name = "CrossroadsRouteBlade" };
                AssetDatabase.CreateAsset(blade, path);
            }
            blade.Clear();
            blade.vertices = new[] {
                new Vector3(-1.7f,-.28f,0), new Vector3(.7f,-.28f,0),
                new Vector3(1.7f,0,0), new Vector3(.7f,.28f,0),
                new Vector3(-1.7f,.28f,0)
            };
            blade.triangles = new[] { 0,1,4, 1,3,4, 1,2,3,
                4,1,0, 4,3,1, 3,2,1 };
            blade.RecalculateNormals();
            blade.RecalculateBounds();
            EditorUtility.SetDirty(blade);
            Material[] colors = {
                MaterialAsset("CrossroadsRouteIron", new Color(.27f,.31f,.29f)),
                MaterialAsset("CrossroadsRouteOchre", new Color(.53f,.38f,.21f)),
                MaterialAsset("CrossroadsRouteGreen", new Color(.30f,.40f,.34f))
            };
            float[] heights = { 5.1f, 4.25f, 3.4f };
            float[] yaws = { 0, 180, 90 };
            string[] directions = { "ВОСТОК", "ЗАПАД", "КАРАВАНЫ" };
            for (int i = 0; i < 3; i++)
            {
                GameObject panel = new GameObject("DirectionBlade_" + i);
                panel.transform.SetParent(pylon, false);
                panel.transform.localPosition = new Vector3(0, heights[i], 0);
                panel.transform.localRotation = Quaternion.Euler(0, yaws[i], 0);
                panel.AddComponent<MeshFilter>().sharedMesh = blade;
                panel.AddComponent<MeshRenderer>().sharedMaterial = colors[i];
                for (int side = 0; side < 2; side++)
                {
                    GameObject label = new GameObject("DirectionLabel_" + i + "_" + side);
                    label.transform.SetParent(panel.transform, false);
                    label.transform.localPosition = new Vector3(0, 0, side == 0 ? .02f : -.02f);
                    label.transform.localRotation = Quaternion.Euler(0, side == 0 ? 0 : 180, 0);
                    TextMesh text = label.AddComponent<TextMesh>();
                    text.text = directions[i];
                    text.fontSize = 64;
                    text.characterSize = .05f;
                    text.anchor = TextAnchor.MiddleCenter;
                    text.alignment = TextAlignment.Center;
                    text.color = new Color(.92f, .88f, .73f);
                }
            }
        }

        private static void BuildDistrictWayfinding(Scene scene, Transform districts)
        {
            const string path = "Assets/Scenes/Proposals/Generated/CrossroadsDistrictPlaque.asset";
            EnsureFolder("Assets/Scenes/Proposals/Generated");
            Mesh plaque = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (plaque == null)
            {
                plaque = new Mesh { name = "CrossroadsDistrictPlaque" };
                AssetDatabase.CreateAsset(plaque, path);
            }
            plaque.Clear();
            plaque.vertices = new[] {
                new Vector3(-3.2f,-.55f,0), new Vector3(3.2f,-.55f,0),
                new Vector3(3.4f,0,0), new Vector3(3.2f,.55f,0),
                new Vector3(-3.2f,.55f,0), new Vector3(-3.4f,0,0)
            };
            plaque.triangles = new[] { 0,1,4, 1,3,4, 1,2,3,
                0,4,1, 1,4,3, 1,3,2, 0,4,5, 0,5,4 };
            plaque.RecalculateNormals();
            plaque.RecalculateBounds();
            EditorUtility.SetDirty(plaque);
            var signs = new[] {
                new { Name = "NorthwestFreight", Label = "КАРАВАНЫ", X = -17f, Z = 20f,
                    Color = new Color(.55f,.36f,.19f) },
                new { Name = "NortheastRepair", Label = "РЕМОНТ", X = 18f, Z = 15f,
                    Color = new Color(.23f,.39f,.38f) },
                new { Name = "SouthwestMarket", Label = "РЫНОК", X = -12f, Z = -23f,
                    Color = new Color(.52f,.30f,.23f) },
                new { Name = "SoutheastAuction", Label = "АУКЦИОН", X = 15f, Z = -24f,
                    Color = new Color(.34f,.40f,.25f) }
            };
            foreach (var sign in signs)
            {
                Transform marker = Child(districts, "DistrictMarker_" + sign.Name);
                marker.localPosition = new Vector3(sign.X, 0, sign.Z);
                Place(scene, marker, "RecoveredMarkerMast",
                    "Props/SM_Prop_Powerpole_Single_01.prefab", Vector3.zero, 0);
                GameObject face = new GameObject("DistrictPlaque_" + sign.Name);
                face.transform.SetParent(marker, false);
                face.transform.localPosition = new Vector3(0, 4.5f, 0);
                face.AddComponent<MeshFilter>().sharedMesh = plaque;
                face.AddComponent<MeshRenderer>().sharedMaterial =
                    MaterialAsset("CrossroadsDistrict_" + sign.Name, sign.Color);
                for (int side = 0; side < 2; side++)
                {
                    GameObject label = new GameObject("DistrictName_" + side);
                    label.transform.SetParent(face.transform, false);
                    label.transform.localPosition = new Vector3(0, 0, side == 0 ? .022f : -.022f);
                    label.transform.localRotation = Quaternion.Euler(0, side == 0 ? 0 : 180, 0);
                    TextMesh text = label.AddComponent<TextMesh>();
                    text.text = sign.Label;
                    text.fontSize = 64;
                    text.characterSize = .11f;
                    text.anchor = TextAnchor.MiddleCenter;
                    text.alignment = TextAlignment.Center;
                    text.color = new Color(.95f, .91f, .75f);
                }
            }
        }

        private static void BuildAuctionPlots(Transform parent, JObject canonical)
        {
            Scene scene = parent.gameObject.scene;
            GameObject fencePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(PlotFenceAsset);
            foreach (JToken item in (JArray)canonical["objects"])
            {
                string id = (string)item["id"];
                if (!IsPlotGround(id)) continue;
                float x = (float)item["position"]["x"];
                float z = (float)item["position"]["z"];
                // All 32 sites are vacant in this approval proposal. The
                // current live data still marks eight of them city-built.
                GameObject plot = new GameObject(id);
                plot.transform.SetParent(parent, false);
                plot.transform.localPosition = new Vector3(x, 0, z);
                string boardId = id.Substring(0, id.Length - "_ground".Length) + "_board";
                Vector3 board = new Vector3(x + (x < 0 ? 6.1f : -6.1f), 0, z);
                foreach (JToken maybe in (JArray)canonical["objects"])
                    if ((string)maybe["id"] == boardId)
                    {
                        board = new Vector3((float)maybe["position"]["x"], 0,
                            (float)maybe["position"]["z"]);
                        break;
                    }
                PlaceAuthored(scene, parent, boardId, JobBoardAsset,
                    new Vector3(board.x, 0, board.z),
                    x < 0 ? 90 : -90);
            }
            // The four short fence markers already authored for each parcel
            // communicate its boundary at walking distance. The approval map
            // shows the complete 14 m footprint without painting the ground.
            foreach (JToken item in (JArray)canonical["objects"])
            {
                string id = (string)item["id"];
                if (id == null || !id.StartsWith("plot_", StringComparison.Ordinal)
                    || !id.Contains("_edge")) continue;
                GameObject marker = (GameObject)PrefabUtility.InstantiatePrefab(fencePrefab, scene);
                marker.name = id;
                marker.transform.SetParent(parent, false);
                marker.transform.localPosition = new Vector3(
                    (float)item["position"]["x"], 0, (float)item["position"]["z"]);
                marker.transform.localRotation = Quaternion.Euler(0,
                    (float)item["rotation"]["y"] * Mathf.Rad2Deg, 0);
                marker.transform.localScale = Vector3.one;
            }
        }

        private static Mesh PlotOutlineMesh()
        {
            const string path = "Assets/Scenes/Proposals/Generated/CrossroadsPlotOutline.asset";
            EnsureFolder("Assets/Scenes/Proposals/Generated");
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (mesh == null)
            {
                mesh = new Mesh { name = "CrossroadsPlotOutline" };
                AssetDatabase.CreateAsset(mesh, path);
            }
            const float outer = 7f, inner = 6.8f, y = -.035f;
            var vertices = new Vector3[] {
                new Vector3(-outer,y,-outer), new Vector3(-inner,y,-inner),
                new Vector3(-outer,y, outer), new Vector3(-inner,y, inner),
                new Vector3( inner,y,-inner), new Vector3( outer,y,-outer),
                new Vector3( inner,y, inner), new Vector3( outer,y, outer)
            };
            mesh.Clear();
            mesh.vertices = vertices;
            mesh.triangles = new[] { 0,2,1, 1,2,3, 4,6,5, 5,6,7,
                0,1,5, 0,5,4, 3,2,7, 3,7,6 };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static void BuildPedestrianCourt(Transform parent, string name,
            float x, float z, Material paving)
        {
            const string path = "Assets/Scenes/Proposals/Generated/CrossroadsCourt.asset";
            EnsureFolder("Assets/Scenes/Proposals/Generated");
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (mesh == null)
            {
                mesh = new Mesh { name = "CrossroadsCourt" };
                AssetDatabase.CreateAsset(mesh, path);
            }
            mesh.Clear();
            mesh.vertices = new[] {
                new Vector3(0,.005f,0), new Vector3(-8,.005f,-7),
                new Vector3(-6,.005f,-9), new Vector3(6,.005f,-9),
                new Vector3(8,.005f,-7), new Vector3(8,.005f,7),
                new Vector3(6,.005f,9), new Vector3(-6,.005f,9),
                new Vector3(-8,.005f,7)
            };
            var triangles = new int[24];
            for (int i = 0; i < 8; i++)
            {
                triangles[i * 3] = 0;
                triangles[i * 3 + 1] = i == 7 ? 1 : i + 2;
                triangles[i * 3 + 2] = i + 1;
            }
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            EditorUtility.SetDirty(mesh);
            GameObject court = new GameObject(name);
            court.transform.SetParent(parent, false);
            court.transform.localPosition = new Vector3(x, 0, z);
            court.AddComponent<MeshFilter>().sharedMesh = mesh;
            court.AddComponent<MeshRenderer>().sharedMaterial = paving;
            court.AddComponent<MeshCollider>().sharedMesh = mesh;
        }

        private static void AddSeededDressing(Scene scene, Transform parent, int seed)
        {
            var random = new System.Random(seed);
            float seedOffset = (seed & 65535) * .013f;
            // Authored rocks and dry scrub dress only the lowlands beyond the
            // city wall, leaving plot footprints and road corridors empty.
            for (int i = 0; i < 90; i++)
            {
                float x = -125 + random.Next(0, 251);
                float z = -125 + random.Next(0, 251);
                if (Math.Max(Math.Abs(x), Math.Abs(z)) < 76
                    || Math.Min(Math.Abs(x), Math.Abs(z)) < 18) continue;
                string prefab = i % 5 == 0 ? "Environment/SM_Env_Bushes_01.prefab"
                    : i % 2 == 0 ? "Environment/SM_Env_DirtPile_01.prefab"
                    : "Environment/SM_Env_Rock_01.prefab";
                Place(scene, parent, "LowlandScrub_" + i,
                    prefab,
                    new Vector3(x, TerrainHeight(x, z, seedOffset), z), random.Next(0, 360));
            }
        }

        private static void ValidateOpenRoutes(HashSet<int> cells)
        {
            for (int x = -16; x <= 15; x++)
                for (int z = -2; z <= 0; z++)
                    if (MainRoadHasCell(x,z) && !cells.Contains(Key(x,z)))
                        throw new InvalidOperationException("Broken through road.");
            for (int z = -16; z <= 15; z++)
                if (!cells.Contains(Key(0,z))) throw new InvalidOperationException("Broken caravan/service connection.");
        }

        private static bool MainRoadHasCell(int x, int z)
        {
            if (x == -4 || x == 3) return z >= -2 && z <= 0;
            if (x >= -3 && x <= 2) return z >= -2 && z <= -1;
            return z >= -1 && z <= 0;
        }

        private static void ValidateRoadClearances(Transform districts, Transform surfaces)
        {
            foreach (Transform module in districts)
            {
                Renderer[] renderers = module.GetComponentsInChildren<Renderer>();
                if (renderers.Length == 0) continue;
                Bounds footprint = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++)
                    footprint.Encapsulate(renderers[i].bounds);
                foreach (Transform tile in surfaces)
                {
                    if (!tile.name.StartsWith("Road_", StringComparison.Ordinal)
                        && !tile.name.StartsWith("PedestrianCrossing_", StringComparison.Ordinal))
                        continue;
                    Renderer road = tile.GetComponentInChildren<Renderer>();
                    if (road == null) continue;
                    Bounds cell = road.bounds;
                    float crossX = Mathf.Min(footprint.max.x, cell.max.x)
                        - Mathf.Max(footprint.min.x, cell.min.x);
                    float crossZ = Mathf.Min(footprint.max.z, cell.max.z)
                        - Mathf.Max(footprint.min.z, cell.min.z);
                    if (crossX > .08f && crossZ > .08f)
                        throw new InvalidOperationException(module.name
                            + " blocks road at " + tile.name);
                }
            }
        }

        private static void ValidateGateClearances(Transform perimeter)
        {
            Physics.SyncTransforms();
            Collider[] colliders = perimeter.GetComponentsInChildren<Collider>();
            foreach (float x in new[] { -67f, 69f })
                for (float approach = -2f; approach <= 2f; approach += 1f)
                    for (float z = -5f; z <= 5f; z += .5f)
                        foreach (float height in new[] { .7f, 2.2f, 3.2f })
                            RequireGateFree(colliders, new Vector3(x + approach, height, z));
            foreach (float z in new[] { -67f, 69f })
                for (float approach = -2f; approach <= 2f; approach += 1f)
                    for (float x = z < 0 ? -5f : 0f; x <= 5f; x += .5f)
                        foreach (float height in new[] { .7f, 2.2f, 3.2f })
                            RequireGateFree(colliders, new Vector3(x, height, z + approach));
        }

        private static void ValidateAuctionPlotClearances(Transform districts, Transform land,
            Transform perimeter, JObject canonical)
        {
            foreach (Transform group in new[] { districts, land, perimeter })
            foreach (Transform module in group)
            {
                if (module.name == "CrossroadsRelief") continue;
                Renderer[] renderers = module.GetComponentsInChildren<Renderer>();
                if (renderers.Length == 0) continue;
                Bounds moduleBounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) moduleBounds.Encapsulate(renderers[i].bounds);
                foreach (JToken plot in (JArray)canonical["objects"])
                {
                    if (!IsPlotGround((string)plot["id"])) continue;
                    float x = (float)plot["position"]["x"];
                    float z = (float)plot["position"]["z"];
                    if (moduleBounds.max.x > x - 7 && moduleBounds.min.x < x + 7
                        && moduleBounds.max.z > z - 7 && moduleBounds.min.z < z + 7)
                        throw new InvalidOperationException(module.name + " occupies auction " + plot["id"]);
                }
            }
        }

        private static void RequireGateFree(Collider[] colliders, Vector3 point)
        {
            foreach (Collider collider in colliders)
                if (collider.enabled && collider.bounds.Contains(point))
                    throw new InvalidOperationException("Gate passage blocked at " + point + " by " + collider.name);
        }

        private static void ValidateGameplayClearances(Transform districts, JObject canonical)
        {
            Physics.SyncTransforms();
            var ids = new[] { "caravan_sayla", "sofia_sych", "medic", "auctioneer",
                "repairman", "capital_storage_caravans" };
            Collider[] colliders = districts.GetComponentsInChildren<Collider>();
            foreach (string id in ids)
            {
                Vector3 point = FindPosition(canonical, id) + Vector3.up * .7f;
                foreach (Collider collider in colliders)
                    if (collider.enabled && collider.bounds.Contains(point))
                        throw new InvalidOperationException(id + " is blocked by " + collider.name);
            }
            foreach (Vector3 point in new[] { new Vector3(0, .7f, -22), new Vector3(1, .7f, -31) })
                foreach (Collider collider in colliders)
                    if (collider.enabled && collider.bounds.Contains(point))
                        throw new InvalidOperationException("Arrival or exit is blocked by " + collider.name);
        }

        private static int Key(int x, int z) { return (x + 32) * 100 + z + 32; }

        private static void RoadTile(Scene scene, Transform parent, HashSet<int> cells, int x, int z, string prefab, float yaw = 0)
        {
            if (!cells.Add(Key(x,z))) return;
            SurfaceTile(scene, parent, prefab == Crossing ? "PedestrianCrossing" : "Road", prefab, x, z, yaw);
        }

        private static void SurfaceTile(Scene scene, Transform parent, string name, string prefab, int x, int z, float yaw = 0)
        {
            // These 5 m modules have a corner pivot and occupy local -5..0.
            // At yaw 90, the pivot moves from the cell's NE corner to SE.
            GameObject tile = Place(scene, parent, name + "_" + x + "_" + z, prefab,
                new Vector3((x + 1) * Tile, 0, (z + (yaw == 90 ? 0 : 1)) * Tile), yaw);
            if (name == "Road" || name == "PedestrianCrossing")
            {
                Bounds bounds = tile.GetComponentInChildren<Renderer>().bounds;
                Vector2 wanted = new Vector2((x + .5f) * Tile, (z + .5f) * Tile);
                if (Mathf.Abs(bounds.center.x - wanted.x) > .05f
                    || Mathf.Abs(bounds.center.z - wanted.y) > .05f
                    || Mathf.Abs(bounds.size.x - Tile) > .05f
                    || Mathf.Abs(bounds.size.z - Tile) > .05f)
                    throw new InvalidOperationException("Road module shifted outside cell " + x + "," + z);
            }
        }

        private static GameObject Place(Scene scene, Transform parent, string name,
            string relativePath, Vector3 position, float yaw)
        {
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(Require(relativePath), scene);
            instance.name = name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = position;
            instance.transform.localRotation = Quaternion.Euler(0, yaw, 0);
            instance.transform.localScale = Vector3.one;
            return instance;
        }

        private static GameObject PlaceAuthored(Scene scene, Transform parent, string name,
            string assetPath, Vector3 position, float yaw)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
            instance.name = name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = position;
            instance.transform.localRotation = Quaternion.Euler(0, yaw, 0);
            instance.transform.localScale = Vector3.one;
            return instance;
        }

        private static Transform Child(Transform parent, string name)
        {
            Transform child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        private static void Anchor(Transform parent, string name, float x, float z)
        {
            Transform anchor = Child(parent, name);
            anchor.localPosition = new Vector3(x, .1f, z);
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int separator = path.LastIndexOf('/');
            EnsureFolder(path.Substring(0, separator));
            AssetDatabase.CreateFolder(path.Substring(0, separator), path.Substring(separator + 1));
        }

        private static Material MaterialAsset(string name, Color color)
        {
            const string directory = "Assets/Scenes/Proposals/Materials";
            string path = directory + "/" + name + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                EnsureFolder(directory);
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null) throw new InvalidOperationException("URP Lit shader is unavailable.");
                material = new Material(shader) { name = name };
                AssetDatabase.CreateAsset(material, path);
            }
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Smoothness", .03f);
            EditorUtility.SetDirty(material);
            return material;
        }
    }
}
#endif
