using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Replaces presentation only. Authored ids, transforms, colliders, spawn anchors and
    /// server data remain on their original objects. The purchased Synty pack stays local.
    /// </summary>
    public static class RoaApocalypseArtMigration
    {
        private const string PackRoot = "Assets/Synty/PolygonApocalypse/";
        private const string Pack = PackRoot + "Prefabs/";
        private const string ReplacementName = "PolygonApocalypse_Visual";
        private const string SceneRoot = "Assets/Scenes/Kromka/Locations";
        private const string MapScene = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string DemoScene = PackRoot + "Scenes/Demo_City_Universal_RenderPipeline.unity";
        private const string RecoveredRoot = "Assets/Prefabs/Kromka/RecoveredEnvironment";
        private const float GlobalMapPresentationScale = 20f;

        // The left side is the game's authored model key; the right side is a Synty prefab.
        private static readonly Dictionary<string, string> Models = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "armory_rack", "Props/SM_Prop_Workbench_01" },
            { "asphalt_slab", "Environment/SM_Env_Road_01" },
            { "barrel_cluster", "Props/SM_Prop_BarrelStack_01" },
            { "brahmin_pen", "Props/SM_Prop_Fence_Wood_Straight_01" },
            { "campfire_rest", "Props/SM_Prop_BurnPile_01" },
            { "car_wreck", "Props/SM_Prop_Car_Wrecked_01" },
            { "cargo_stack", "Props/SM_Prop_Container_01" },
            { "concrete_wall", "Props/SM_Prop_Barrier_Concrete_01" },
            { "cot_bed", "Props/SM_Prop_Bedframe_01" },
            { "craft_station_ammo", "Props/SM_Prop_Workbench_01" },
            { "craft_station_chem", "Props/SM_Prop_Workbench_01" },
            { "craft_station_energy", "Props/SM_Prop_Generator_01" },
            { "craft_station_repair", "Props/SM_Prop_Workbench_01" },
            { "craft_station_tools", "Props/SM_Prop_Workbench_01" },
            { "craft_station_weapon", "Props/SM_Prop_Workbench_01" },
            { "dead_tree_a", "Environment/SM_Env_Tree_Dead_01" },
            { "dead_tree_b", "Environment/SM_Env_Tree_Dead_02" },
            { "dead_tree_c", "Environment/SM_Env_Tree_Dead_03" },
            { "deadwood", "Environment/SM_Env_Tree_Dead_01" },
            { "dry_bush", "Environment/SM_Env_Bushes_01" },
            { "fence_segment", "Props/SM_Prop_Fence_Wood_Straight_01" },
            { "garden_patch", "Environment/SM_Env_Overgrowth_01" },
            { "highway_sign", "Props/SM_Prop_Sign_Stop_01" },
            { "job_board", "Props/SM_Prop_Blackboard_01" },
            { "oil_pump_jack", "Props/SM_Prop_Gaspump_01" },
            { "ore_outcrop", "Environment/SM_Env_Rock_01" },
            { "perimeter_debris", "Props/SM_Prop_TrashPile_01" },
            { "relay_antenna", "Buildings/SM_Bld_RadioTower_01" },
            { "road_tile", "Environment/SM_Env_Road_Dirt_Straight_01" },
            { "roadblock_barricade", "Props/SM_Prop_Barricade_01" },
            { "rubble_rock", "Environment/SM_Env_Rock_02" },
            { "ruined_billboard", "Props/SM_Prop_Billboard_Sign_01" },
            { "rust_barrel_v1", "Props/SM_Prop_Barrel_Old_01" },
            { "scrap_heap", "Props/SM_Prop_TrashPile_02" },
            { "scrap_wall_segment", "Props/SM_Prop_Wall_Junk_01" },
            { "scrap_watch_tower", "Buildings/SM_Bld_RadioTower_01" },
            { "storage_chest", "Props/SM_Prop_Crate_01" },
            { "storage_lean_to", "Buildings/SM_Bld_Junk_Shelter_01" },
            { "tire_stack", "Props/SM_Prop_Tire_Pile_01" },
            { "trade_machine", "Props/SM_Prop_VendingMachine_01" },
            { "trader_awning", "Buildings/SM_Bld_Market_Medium_01" },
            { "utility_pole", "Props/SM_Prop_Powerpole_01" },
            { "wasteland_shack", "Buildings/SM_Bld_Junk_Shelter_02" },
            { "watch_post", "Buildings/SM_Bld_RadioTower_01" },
            { "water_tank", "Buildings/SM_Bld_WaterTank_01" },
            { "workshop_bench", "Props/SM_Prop_Workbench_01" }
        };

        internal static IEnumerable<KeyValuePair<string, string>> EnvironmentModels => Models;

        [MenuItem("Realm of Ashes/PolygonApocalypse/Replace world visuals")]
        public static void MigrateAll()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Visual migration requires Edit Mode.");
            ValidatePack();
            int prefabCount = MigrateRecoveredPrefabs();
            int mapCount = MigrateScene(MapScene, true);
            int locationCount = 0;
            int visualCount = mapCount;
            foreach (string scene in AssetDatabase.FindAssets("t:Scene", new[] { SceneRoot })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".unity", StringComparison.OrdinalIgnoreCase))
                .OrderBy(path => path, StringComparer.Ordinal))
            {
                visualCount += MigrateScene(scene, false);
                locationCount++;
            }
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA APOCALYPSE] " + prefabCount + " shared prefabs, " + locationCount
                + " location scenes, " + visualCount + " scene visuals migrated.");
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Preview map and tutorial")]
        public static void MigratePreview()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Visual migration requires Edit Mode.");
            ValidatePack();
            int prefabs = MigrateRecoveredPrefabs();
            int map = MigrateScene(MapScene, true);
            int tutorial = MigrateScene(SceneRoot + "/tutorialCaravanYard.unity", false);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA APOCALYPSE] Preview: " + prefabs + " prefabs, "
                + map + " map visuals, " + tutorial + " tutorial visuals.");
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Replace remaining map models")]
        public static void MigrateRemainingMapModels()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Visual migration requires Edit Mode.");
            ValidatePack();
            int count = MigrateScene(MapScene, true);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA APOCALYPSE] " + count + " additional map models migrated.");
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Restore native size in sample scenes")]
        public static void RestoreNativeSizeSamples()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Visual migration requires Edit Mode.");
            int count = NormalizeSceneVisuals(MapScene);
            count += NormalizeSceneVisuals(SceneRoot + "/tutorialCaravanYard.unity");
            count += NormalizeSceneVisuals(SceneRoot + "/personalBase.unity");
            count += NormalizeSceneVisuals(SceneRoot + "/randomRuinedRoad.unity");
            count += NormalizeSceneVisuals(SceneRoot + "/z_15_06.unity");
            Debug.Log("[ROA APOCALYPSE] Restored native size for " + count + " sample visuals.");
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Restore native size in all scenes")]
        public static void RestoreNativeSizeAll()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Visual migration requires Edit Mode.");
            int count = NormalizeRecoveredPrefabs();
            count += NormalizeSceneVisuals(MapScene);
            foreach (string scene in AssetDatabase.FindAssets("t:Scene", new[] { SceneRoot })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".unity", StringComparison.OrdinalIgnoreCase))
                .OrderBy(path => path, StringComparer.Ordinal))
                count += NormalizeSceneVisuals(scene);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA APOCALYPSE] Restored native size for " + count + " scene/prefab visuals.");
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Open city demo")]
        public static void OpenCityDemo()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Open the demo in Edit Mode.");
            EditorSceneManager.OpenScene(DemoScene, OpenSceneMode.Single);
        }

        // Invoked by an explicit Library request after script compilation. This avoids
        // interrupting the editor during its large first import of the licensed pack.
        [InitializeOnLoadMethod]
        private static void MigrateIfRequested()
        {
            string request = Path.Combine(Application.dataPath, "../Library/roa-apocalypse-migrate.request");
            string preview = Path.Combine(Application.dataPath, "../Library/roa-apocalypse-preview.request");
            if (!File.Exists(request) && !File.Exists(preview)) return;
            EditorApplication.update += ProcessRequest;
        }

        private static void ProcessRequest()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            EditorApplication.update -= ProcessRequest;
            string request = Path.Combine(Application.dataPath, "../Library/roa-apocalypse-migrate.request");
            string preview = Path.Combine(Application.dataPath, "../Library/roa-apocalypse-preview.request");
            try
            {
                if (File.Exists(request))
                {
                    File.Delete(request);
                    MigrateAll();
                }
                else if (File.Exists(preview))
                {
                    File.Delete(preview);
                    MigratePreview();
                }
            }
            catch (Exception error)
            {
                Debug.LogException(error);
            }
        }

        private static void ValidatePack()
        {
            foreach (string name in Models.Values.Distinct(StringComparer.Ordinal))
                if (Load(name) == null)
                    throw new InvalidOperationException("PolygonApocalypse prefab is missing: " + name);
        }

        private static GameObject Load(string name) =>
            AssetDatabase.LoadAssetAtPath<GameObject>(Pack + name + ".prefab");

        private static int MigrateRecoveredPrefabs()
        {
            int changed = 0;
            foreach (KeyValuePair<string, string> pair in Models)
            {
                string path = RecoveredRoot + "/" + pair.Key + ".prefab";
                if (AssetDatabase.LoadAssetAtPath<GameObject>(path) == null) continue;
                GameObject root = PrefabUtility.LoadPrefabContents(path);
                try
                {
                    if (!ReplaceVisual(root.transform, pair.Value)) continue;
                    PrefabUtility.SaveAsPrefabAsset(root, path);
                    changed++;
                }
                finally { PrefabUtility.UnloadPrefabContents(root); }
            }
            return changed;
        }

        private static int NormalizeRecoveredPrefabs()
        {
            int changed = 0;
            foreach (string path in AssetDatabase.FindAssets("t:Prefab", new[] { RecoveredRoot })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                .OrderBy(path => path, StringComparer.Ordinal))
            {
                GameObject root = PrefabUtility.LoadPrefabContents(path);
                try
                {
                    int count = NormalizeVisuals(root);
                    if (count == 0) continue;
                    PrefabUtility.SaveAsPrefabAsset(root, path);
                    changed += count;
                }
                finally { PrefabUtility.UnloadPrefabContents(root); }
            }
            return changed;
        }

        private static int NormalizeSceneVisuals(string path)
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(path) == null) return 0;
            Scene existing = SceneManager.GetSceneByPath(path);
            bool alreadyOpen = existing.IsValid() && existing.isLoaded;
            Scene scene = alreadyOpen ? existing : EditorSceneManager.OpenScene(path, OpenSceneMode.Additive);
            try
            {
                int count = 0;
                if (path == MapScene)
                {
                    GameObject mapRoot = scene.GetRootGameObjects().FirstOrDefault(item =>
                        item.name.StartsWith("KromkaGlobalMap_", StringComparison.Ordinal));
                    if (mapRoot == null) throw new InvalidOperationException("Global map root is missing.");
                    Vector3 expanded = Vector3.one * GlobalMapPresentationScale;
                    if ((mapRoot.transform.localScale - expanded).sqrMagnitude > 0.000001f)
                    {
                        mapRoot.transform.localScale = expanded;
                        count++;
                    }
                }
                foreach (GameObject root in scene.GetRootGameObjects()) count += NormalizeVisuals(root);
                if (count == 0) return 0;
                EditorSceneManager.MarkSceneDirty(scene);
                if (!EditorSceneManager.SaveScene(scene)) throw new IOException("Could not save " + path);
                return count;
            }
            finally { if (!alreadyOpen) EditorSceneManager.CloseScene(scene, true); }
        }

        private static int NormalizeVisuals(GameObject root)
        {
            int changed = 0;
            foreach (Transform existing in root.GetComponentsInChildren<Transform>(true))
            {
                Transform visual = existing;
                if (visual == null) continue;
                if (visual.name != ReplacementName || visual.parent == null) continue;
                GameObject source = PrefabUtility.GetCorrespondingObjectFromSource(visual.gameObject);
                if (source == null || !InPack(visual.gameObject)) continue;
                Transform parent = visual.parent;
                KromkaPlacedObjectAuthoring marker = parent.GetComponent<KromkaPlacedObjectAuthoring>();
                string expected = marker == null ? null : ExactModel(marker.ServerArchetypeId)
                    ?? Guess(marker.ServerArchetypeId + " " + marker.name, marker.Role);
                GameObject correct = expected == null ? source : Load(expected);
                if (correct == null) throw new InvalidOperationException("Missing PolygonApocalypse model: " + expected);
                Vector3 inherited = visual.parent.lossyScale;
                Vector3 target = new Vector3(
                    Mathf.Abs(inherited.x) > 0.0001f ? correct.transform.localScale.x / inherited.x : correct.transform.localScale.x,
                    Mathf.Abs(inherited.y) > 0.0001f ? correct.transform.localScale.y / inherited.y : correct.transform.localScale.y,
                    Mathf.Abs(inherited.z) > 0.0001f ? correct.transform.localScale.z / inherited.z : correct.transform.localScale.z);
                if (source == correct && (visual.localScale - target).sqrMagnitude < 0.000001f) continue;

                // Keep the authored object's footprint and ground contact while
                // restoring the Synty prefab's original dimensions.
                Renderer[] old = parent.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer is MeshRenderer || renderer is SkinnedMeshRenderer)
                    .Where(renderer => !InPack(renderer.gameObject)
                        && !UnderReplacement(renderer.transform)
                        && (marker == null || renderer.GetComponentInParent<KromkaPlacedObjectAuthoring>() == marker))
                    .ToArray();
                Renderer[] fresh = visual.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer.enabled && renderer.gameObject.activeSelf).ToArray();
                Bounds before = old.Length > 0 ? LocalBounds(parent, old) : LocalBounds(parent, fresh);
                if (source != correct)
                {
                    UnityEngine.Object.DestroyImmediate(visual.gameObject);
                    GameObject replacement = (GameObject)PrefabUtility.InstantiatePrefab(correct, parent.gameObject.scene);
                    replacement.name = ReplacementName;
                    replacement.transform.SetParent(parent, false);
                    visual = replacement.transform;
                    foreach (Collider collider in replacement.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
                    fresh = replacement.GetComponentsInChildren<Renderer>(true)
                        .Where(renderer => renderer.enabled && renderer.gameObject.activeSelf).ToArray();
                }
                RoaApocalypseVisuals.SetNativeWorldScale(visual, correct.transform.localScale);
                Bounds after = LocalBounds(parent, fresh);
                visual.localPosition += new Vector3(before.center.x - after.center.x,
                    before.min.y - after.min.y, before.center.z - after.center.z);
                changed++;
            }
            return changed;
        }

        private static int MigrateScene(string path, bool globalMap)
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(path) == null) return 0;
            Scene existing = SceneManager.GetSceneByPath(path);
            bool alreadyOpen = existing.IsValid() && existing.isLoaded;
            Scene scene = alreadyOpen ? existing : EditorSceneManager.OpenScene(path, OpenSceneMode.Additive);
            try
            {
                int changed = globalMap ? MigrateMap(scene) : MigrateLocation(scene);
                if (changed > 0)
                {
                    EditorSceneManager.MarkSceneDirty(scene);
                    if (!EditorSceneManager.SaveScene(scene))
                        throw new IOException("Could not save " + path);
                }
                return changed;
            }
            finally
            {
                if (!alreadyOpen) EditorSceneManager.CloseScene(scene, true);
            }
        }

        private static int MigrateLocation(Scene scene)
        {
            int changed = 0;
            foreach (GameObject top in scene.GetRootGameObjects())
            foreach (KromkaPlacedObjectAuthoring marker in top.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if (marker.Role == "terrain" || marker.Role == "anomaly") continue;
                string key = marker.ServerArchetypeId;
                string model = ExactModel(key) ?? Guess(key + " " + marker.name, marker.Role);
                if (model != null && ReplaceVisual(marker.transform, model, 35f)) changed++;
            }
            foreach (GameObject top in scene.GetRootGameObjects())
            foreach (MeshRenderer renderer in top.GetComponentsInChildren<MeshRenderer>(true))
            {
                if (renderer == null || !renderer.enabled || InPack(renderer.gameObject)
                    || UnderTerrain(renderer.transform) || UnderReplacement(renderer.transform)) continue;
                string model = GuessLocationAccent(Context(renderer.transform));
                if (model != null && ReplaceVisual(renderer.transform, model, 30f))
                    changed++;
            }
            return changed;
        }

        private static bool UnderTerrain(Transform node)
        {
            for (Transform item = node; item != null; item = item.parent)
            {
                KromkaPlacedObjectAuthoring marker = item.GetComponent<KromkaPlacedObjectAuthoring>();
                if (marker != null && marker.Role == "terrain") return true;
            }
            return false;
        }

        private static bool UnderReplacement(Transform node)
        {
            for (Transform item = node; item != null; item = item.parent)
                if (item.name == ReplacementName) return true;
            return false;
        }

        private static int MigrateMap(Scene scene)
        {
            int changed = 0;
            foreach (GameObject top in scene.GetRootGameObjects())
            foreach (MeshRenderer renderer in top.GetComponentsInChildren<MeshRenderer>(true).ToArray())
            {
                if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy
                    || InPack(renderer.gameObject) || UnderReplacement(renderer.transform)
                    || IsMapSurfaceOrEffect(renderer.transform)) continue;
                string context = Context(renderer.transform);
                Transform target = MapVisualRoot(renderer.transform);
                string model = renderer.name == "MapMiniature"
                    ? "Buildings/SM_Bld_Industrial_Small_01"
                    : GuessMapAccent(context) ?? Guess(context, "map landmark");
                if (ReplaceVisual(target, model)) changed++;
            }
            return changed;
        }

        private static Transform MapVisualRoot(Transform node)
        {
            Transform parent = node.parent;
            if (parent == null || parent.name.StartsWith("Location_", StringComparison.Ordinal))
                return node;
            if (parent.name.IndexOf("_SOURCE", StringComparison.OrdinalIgnoreCase) >= 0
                || parent.name.IndexOf("_LANDMARK", StringComparison.OrdinalIgnoreCase) >= 0
                || parent.name.IndexOf("_Pylon_", StringComparison.OrdinalIgnoreCase) >= 0
                || parent.name.StartsWith("BlackWaterServiceRing_", StringComparison.Ordinal)
                || parent.name.StartsWith("Colonne_", StringComparison.Ordinal))
                return parent;
            GameObject prefabRoot = PrefabUtility.GetNearestPrefabInstanceRoot(node.gameObject);
            return prefabRoot != null && prefabRoot.transform != node.root
                && !prefabRoot.name.StartsWith("Location_", StringComparison.Ordinal)
                ? prefabRoot.transform : node;
        }

        internal static bool IsMapSurfaceOrEffect(Transform node)
        {
            if (UnderNamedMapBase(node)) return true;
            string name = node.name;
            if (name.IndexOf("_SURFACE", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("Terrain", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("Scorch", StringComparison.OrdinalIgnoreCase) >= 0
                || name == "LocationGlow" || name == "BoundaryLine"
                || name.StartsWith("TerrainApron", StringComparison.Ordinal)) return true;
            for (Transform item = node; item != null; item = item.parent)
            {
                name = item.name;
                if (IsAuthoredMapStructure(name)
                    || name == "DistantAshHorizon_AUTHORED"
                    || name.StartsWith("Fog_Iteration", StringComparison.Ordinal)
                    || name.StartsWith("Smoke_Iteration", StringComparison.Ordinal)
                    || name.StartsWith("Dust_Iteration", StringComparison.Ordinal)
                    || name.StartsWith("ToxicFog_Iteration", StringComparison.Ordinal)
                    || name.EndsWith("Fog_AUTHORED", StringComparison.Ordinal)) return true;
            }
            return false;
        }

        private static bool IsAuthoredMapStructure(string name) =>
            name == "RailBridgeApproachFill"
            || name == "TesmaRailBridge_ContinuousStructure"
            || name == "GroundSupportedSleepers"
            || name == "ContinuousFreightRails"
            || name == "NorthWest_DeadHighway"
            || name == "Western_BrokenEvacuationRoute"
            || name.StartsWith("OreArc_Quarry_", StringComparison.Ordinal)
                && name.EndsWith("_CONTINUOUS", StringComparison.Ordinal);

        private static bool UnderNamedMapBase(Transform node)
        {
            for (Transform item = node; item != null; item = item.parent)
            {
                string name = item.name;
                if (name.IndexOf("SelectionSurface", StringComparison.OrdinalIgnoreCase) >= 0
                    || name.IndexOf("Terrain_EDITABLE", StringComparison.OrdinalIgnoreCase) >= 0
                    || name.IndexOf("ContinuousRelief", StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            }
            return false;
        }

        private static string Context(Transform node)
        {
            var names = new List<string>();
            for (Transform item = node; item != null && names.Count < 5; item = item.parent)
                names.Add(item.name);
            return string.Join(" ", names);
        }

        // The world map also contains authored relief, roads, water and selection
        // meshes. These are surfaces, not interchangeable scenery props.
        private static string GuessMapAccent(string context)
        {
            string name = context.ToLowerInvariant();
            if (Has(name, "tree", "deadwood", "shelterbelt")) return "Environment/SM_Env_Tree_Dead_01";
            if (Has(name, "bush", "vegetation")) return "Environment/SM_Env_Bushes_01";
            if (Has(name, "vehicle", "truck", "car_wreck", "bus")) return "Props/SM_Prop_Car_Wrecked_01";
            if (Has(name, "barrel", "drum")) return "Props/SM_Prop_Barrel_Old_01";
            if (Has(name, "crate", "container")) return "Props/SM_Prop_Container_01";
            if (Has(name, "sign", "billboard")) return "Props/SM_Prop_Billboard_Sign_01";
            if (Has(name, "fence", "barricade")) return "Props/SM_Prop_Barricade_01";
            if (Has(name, "antenna", "radio_tower")) return "Buildings/SM_Bld_RadioTower_01";
            if (Has(name, "powerpole", "utilitypole")) return "Props/SM_Prop_Powerpole_01";
            if (Has(name, "shack", "shelter")) return "Buildings/SM_Bld_Junk_Shelter_01";
            if (Has(name, "water_tank")) return "Buildings/SM_Bld_WaterTank_01";
            return null;
        }

        private static string GuessLocationAccent(string context)
        {
            string name = context.ToLowerInvariant();
            if (Has(name, "ground", "surface", "terrain", "water", "river", "lake",
                    "road", "route", "floor", "foundation", "horizon")) return null;
            return GuessMapAccent(context) ?? (Has(name, "rock", "boulder", "ore")
                ? "Environment/SM_Env_Rock_01" : null);
        }

        private static string Guess(string text, string role)
        {
            string name = (text + " " + role).ToLowerInvariant();
            if (Has(name, "road", "route", "asphalt", "highway", "tract")) return "Environment/SM_Env_Road_Dirt_Straight_01";
            if (Has(name, "rail", "track")) return "Environment/SM_Env_Road_Bare_01";
            if (Has(name, "tower", "antenna", "mast", "radio")) return "Buildings/SM_Bld_RadioTower_01";
            if (Has(name, "pylon", "powerpole", "pole")) return "Props/SM_Prop_Powerpole_01";
            if (Has(name, "wall", "fence", "barrier", "fortification")) return "Props/SM_Prop_Wall_Junk_01";
            if (Has(name, "bridge", "walkway")) return "Environment/SM_Env_Bridge_01";
            if (Has(name, "tank", "reservoir", "vat")) return "Buildings/SM_Bld_WaterTank_01";
            if (Has(name, "pipe", "culvert", "drain")) return "Environment/SM_Env_StormCanal_Pipe_01";
            if (Has(name, "machine", "factory", "industrial", "furnace", "processing")) return "Buildings/SM_Bld_Industrial_Small_01";
            if (Has(name, "house", "shelter", "shack", "module", "settlement")) return "Buildings/SM_Bld_Junk_Shelter_01";
            if (Has(name, "market", "trader", "awning", "canopy")) return "Buildings/SM_Bld_Market_Medium_01";
            if (Has(name, "vehicle", "truck", "bus", "wreck") || HasWord(name, "car")) return "Props/SM_Prop_Car_Wrecked_01";
            if (Has(name, "tree", "deadwood", "shelterbelt")) return "Environment/SM_Env_Tree_Dead_01";
            if (Has(name, "bush", "grass", "garden", "vegetation")) return "Environment/SM_Env_Bushes_01";
            if (Has(name, "rock", "ore", "cliff", "mountain", "boulder", "strata", "slag")) return "Environment/SM_Env_Rock_01";
            if (Has(name, "barrel", "drum")) return "Props/SM_Prop_Barrel_Old_01";
            if (Has(name, "crate", "cargo", "container", "depot")) return "Props/SM_Prop_Container_01";
            if (Has(name, "rubble", "ruin", "debris", "scrap", "junk")) return "Props/SM_Prop_Rubble_Concrete_01";
            if (Has(name, "ground", "surface", "dirt", "sand", "soil")) return "Environment/SM_Env_Dirt_Flat_01";
            if (Has(name, "sign", "billboard")) return "Props/SM_Prop_Billboard_Sign_01";
            if (Has(name, "bench", "station", "workshop")) return "Props/SM_Prop_Workbench_01";
            if (Has(name, "building", "city", "facility", "structure")) return "Buildings/SM_Bld_Industrial_Small_01";
            return "Props/SM_Prop_TrashPile_01";
        }

        private static bool Has(string text, params string[] fragments) =>
            fragments.Any(fragment => text.Contains(fragment));

        private static bool HasWord(string text, string word)
        {
            for (int start = text.IndexOf(word, StringComparison.Ordinal); start >= 0;
                start = text.IndexOf(word, start + word.Length, StringComparison.Ordinal))
            {
                bool left = start == 0 || !char.IsLetter(text[start - 1]);
                int end = start + word.Length;
                bool right = end == text.Length || !char.IsLetter(text[end]);
                if (left && right) return true;
            }
            return false;
        }

        private static string ExactModel(string key)
        {
            string normalized = new string((key ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());
            foreach (KeyValuePair<string, string> pair in Models)
                if (string.Equals(new string(pair.Key.Where(char.IsLetterOrDigit).ToArray()),
                    normalized, StringComparison.OrdinalIgnoreCase)) return pair.Value;
            return null;
        }

        private static bool InPack(GameObject value)
        {
            GameObject source = PrefabUtility.GetCorrespondingObjectFromSource(value);
            string path = source != null ? AssetDatabase.GetAssetPath(source) : string.Empty;
            return path.StartsWith(PackRoot, StringComparison.Ordinal);
        }

        private static bool ReplaceVisual(Transform root, string model, float maxExtent = float.PositiveInfinity)
        {
            if (root.Find(ReplacementName) != null) return false;
            GameObject prefab = Load(model);
            if (prefab == null) throw new InvalidOperationException("Missing PolygonApocalypse model: " + model);
            Renderer[] old = root.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer is MeshRenderer || renderer is SkinnedMeshRenderer)
                .Where(renderer => renderer.enabled && !InPack(renderer.gameObject))
                .Where(renderer => root.GetComponent<KromkaPlacedObjectAuthoring>() == null
                    || renderer.GetComponentInParent<KromkaPlacedObjectAuthoring>()?.transform == root)
                .ToArray();
            if (old.Length == 0) return false;
            Bounds before = LocalBounds(root, old);
            if (before.size.x > maxExtent || before.size.y > maxExtent
                || before.size.z > maxExtent) return false;
            GameObject art = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root.gameObject.scene);
            art.name = ReplacementName;
            art.transform.SetParent(root, false);
            art.transform.localPosition = Vector3.zero;
            art.transform.localRotation = Quaternion.identity;
            RoaApocalypseVisuals.SetNativeWorldScale(art.transform, prefab.transform.localScale);
            foreach (Collider collider in art.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            Renderer[] fresh = art.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer.enabled && renderer.gameObject.activeSelf)
                .ToArray();
            Bounds source = LocalBounds(root, fresh);
            if (source.size.sqrMagnitude < 0.000001f)
            {
                UnityEngine.Object.DestroyImmediate(art);
                throw new InvalidOperationException("PolygonApocalypse prefab has no usable bounds: " + model);
            }
            // Keep the authored footprint and ground contact without changing
            // the pack mesh's original dimensions.
            art.transform.localPosition = new Vector3(before.center.x - source.center.x,
                before.min.y - source.min.y, before.center.z - source.center.z);
            foreach (Renderer renderer in old) renderer.enabled = false;
            return true;
        }

        private static Bounds LocalBounds(Transform root, IEnumerable<Renderer> renderers)
        {
            Bounds result = default;
            bool any = false;
            foreach (Renderer renderer in renderers)
            {
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                Mesh mesh = filter != null ? filter.sharedMesh : null;
                Bounds source = renderer is SkinnedMeshRenderer skin
                    ? skin.localBounds
                    : mesh != null ? mesh.bounds : renderer.localBounds;
                Matrix4x4 toRoot = root.worldToLocalMatrix * renderer.transform.localToWorldMatrix;
                Vector3 min = source.min;
                Vector3 max = source.max;
                for (int x = 0; x < 2; x++)
                for (int y = 0; y < 2; y++)
                for (int z = 0; z < 2; z++)
                {
                    Vector3 point = toRoot.MultiplyPoint3x4(new Vector3(
                        x == 0 ? min.x : max.x, y == 0 ? min.y : max.y, z == 0 ? min.z : max.z));
                    if (!any) { result = new Bounds(point, Vector3.zero); any = true; }
                    else result.Encapsulate(point);
                }
            }
            return result;
        }
    }
}
