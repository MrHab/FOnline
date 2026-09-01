#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Rebuilds the saved strategic road network from authored global-map data.
    /// Long source spans are split into short prefab pieces so textures and broken
    /// silhouettes stay readable. Nothing here runs in a player build.
    /// </summary>
    public static class RoaGlobalMapRoadAuthoring
    {
        public const string NetworkLayerName = "RoadNetwork_AUTHORED";
        public const string LandmarkLayerName = "RoadLandmarks_AUTHORED";
        public const int ExpectedRoadPieceCount = 34;
        public const int ExpectedPipelinePieceCount = 14;
        public const int ExpectedLandmarkCount = 14;
        public const float GroundSurfaceY = -0.13f;

        private const float MapScale = 0.1f;
        private const float MaximumPieceLength = 6f;
        private const string RoadPrefabPath =
            "Assets/Prefabs/GlobalMap/GM_RoadSegment.prefab";
        private const string PipelinePrefabPath =
            "Assets/Prefabs/GlobalMap/GM_PipelineSegment.prefab";
        private const string InfrastructureLayerName = "Infrastructure";

        private const string BarrelPrefab =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Props/Chest_Barrel/Prefabs/MEP_Barrel.prefab";
        private const string ChestPrefab =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Props/Chest_Barrel/Prefabs/MEP_Chest.prefab";
        private const string ShackPrefab =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/MEP_Shack_Broken_N.prefab";
        private const string FencePrefab =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/MEP_Fence_03_N.prefab";
        private const string LanternPrefab =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Props/MEP_House_Props_01/Prefabs/MEP_Lantern_01.prefab";
        private const string SkullPrefab =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Props/MEP_Skull/Prefabs/MEP_B_Skull_01.prefab";
        private const string WallPrefab =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/MEP_StoneWall_01_N.prefab";
        private const string Cracked01Prefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_01.prefab";
        private const string Cracked02Prefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_02.prefab";

        private const string BarrelMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Chest_Barrel_f3305e32.mat";
        private const string WoodMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Wall_Roof_Dif_1d2d5508.mat";
        private const string PropMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_House_Props_01_c9d61c9d.mat";
        private const string StoneMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_StoneWall_Dif_cf79555f.mat";
        private const string CrackedMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/Cracked_Mud_b13c2d72.mat";

        private readonly struct LandmarkPlacement
        {
            public readonly string Name;
            public readonly string PrefabPath;
            public readonly string MaterialPath;
            public readonly Vector3 Position;
            public readonly float Yaw;
            public readonly float Footprint;
            public readonly bool GroundPatch;

            public LandmarkPlacement(string name, string prefabPath, string materialPath,
                                     float x, float y, float z, float yaw,
                                     float footprint, bool groundPatch = false)
            {
                Name = name;
                PrefabPath = prefabPath;
                MaterialPath = materialPath;
                Position = new Vector3(x, y, z);
                Yaw = yaw;
                Footprint = footprint;
                GroundPatch = groundPatch;
            }
        }

        private static readonly LandmarkPlacement[] Landmarks =
        {
            new LandmarkPlacement("RoadLandmark_Crossroads_Ruin", ShackPrefab, WoodMaterial,
                -2.9f, 0.045f, -14.8f, -18f, 2.8f),
            new LandmarkPlacement("RoadLandmark_Crossroads_Barrel", BarrelPrefab, BarrelMaterial,
                -4.1f, 0.045f, -15.05f, 22f, 0.62f),
            new LandmarkPlacement("RoadLandmark_Crossroads_Lantern", LanternPrefab, PropMaterial,
                -3.55f, 0.045f, -15.8f, -31f, 0.48f),
            new LandmarkPlacement("RoadLandmark_Crossroads_Dust", Cracked01Prefab, CrackedMaterial,
                -4.5f, 0.018f, -16.5f, 19f, 4.4f, true),

            new LandmarkPlacement("RoadLandmark_KlimGate_FenceN", FencePrefab, WoodMaterial,
                -21.55f, 0.045f, -23.9f, 63f, 2.2f),
            new LandmarkPlacement("RoadLandmark_KlimGate_FenceS", FencePrefab, WoodMaterial,
                -20.7f, 0.045f, -25.75f, 63f, 2.2f),

            new LandmarkPlacement("RoadLandmark_ScrapGate_Fence", FencePrefab, WoodMaterial,
                24.35f, 0.045f, -24.25f, 90f, 2.25f),
            new LandmarkPlacement("RoadLandmark_ScrapGate_Barrel", BarrelPrefab, BarrelMaterial,
                24.05f, 0.045f, -26f, -12f, 0.66f),

            new LandmarkPlacement("RoadLandmark_RelayGate_Wall", WallPrefab, StoneMaterial,
                24.15f, 0.045f, 21.05f, 0f, 1.9f),
            new LandmarkPlacement("RoadLandmark_RelayGate_Lantern", LanternPrefab, PropMaterial,
                26f, 0.045f, 21.25f, 16f, 0.5f),

            new LandmarkPlacement("RoadLandmark_Northern_Skull", SkullPrefab, StoneMaterial,
                2.35f, 0.045f, 0.45f, -28f, 0.52f),
            new LandmarkPlacement("RoadLandmark_Northern_Ruin", ShackPrefab, WoodMaterial,
                14f, 0.045f, 13f, 31f, 2.45f),

            new LandmarkPlacement("RoadLandmark_TradeStop_Chest", ChestPrefab, BarrelMaterial,
                12.75f, 0.045f, -10.15f, 17f, 0.76f),
            new LandmarkPlacement("RoadLandmark_TradeStop_Dust", Cracked02Prefab, CrackedMaterial,
                13.5f, 0.018f, -10.5f, 72f, 3.5f, true)
        };

        [MenuItem("Realm of Ashes/Глобальная карта/Применить дороги и ориентиры 3.2", true)]
        private static bool CanApply()
        {
            return !Application.isPlaying && !EditorApplication.isCompiling;
        }

        [MenuItem("Realm of Ashes/Глобальная карта/Применить дороги и ориентиры 3.2")]
        public static void Apply()
        {
            Scene scene = SceneManager.GetSceneByPath(RoaGlobalMapAuthoringTools.ScenePath);
            bool openedHere = !scene.IsValid() || !scene.isLoaded;
            if (openedHere)
                scene = EditorSceneManager.OpenScene(RoaGlobalMapAuthoringTools.ScenePath,
                    OpenSceneMode.Additive);

            try
            {
                RoaUnityGlobalMapScene marker = FindMarker(scene)
                    ?? throw new InvalidOperationException("RoaUnityGlobalMapScene is missing.");
                Transform infrastructure = marker.StaticContentRoot.Find(InfrastructureLayerName)
                    ?? throw new InvalidOperationException("Infrastructure authoring layer is missing.");
                GameObject roadPrefab = Load<GameObject>(RoadPrefabPath);
                GameObject pipelinePrefab = Load<GameObject>(PipelinePrefabPath);
                JObject map = JObject.Parse(File.ReadAllText(Path.GetFullPath(
                    Path.Combine(Application.dataPath, "../../data/global-map.json"))));
                JObject grid = map["grid"] as JObject
                    ?? throw new InvalidOperationException("Global-map grid is missing.");
                float width = Float(grid["cols"]) * Float(grid["cellPoints"]);
                float height = Float(grid["rows"]) * Float(grid["cellPoints"]);

                for (int i = infrastructure.childCount - 1; i >= 0; i--)
                    UnityEngine.Object.DestroyImmediate(infrastructure.GetChild(i).gameObject);

                Transform network = CreateLayer(NetworkLayerName, infrastructure, scene);
                Transform landmarks = CreateLayer(LandmarkLayerName, infrastructure, scene);
                int roadPieces = 0;
                int pipelinePieces = 0;
                JArray rows = map["infrastructure"] as JArray ?? new JArray();
                for (int rowIndex = 0; rowIndex < rows.Count; rowIndex++)
                {
                    JObject row = rows[rowIndex] as JObject;
                    string id = row?["id"]?.ToString() ?? "infrastructure_" + rowIndex;
                    bool pipeline = string.Equals(row?["type"]?.ToString(), "pipeline",
                        StringComparison.OrdinalIgnoreCase);
                    float authoredWidth = Mathf.Max(1f, Float(row?["width"]));
                    JArray points = row?["points"] as JArray ?? new JArray();
                    for (int segment = 1; segment < points.Count; segment++)
                    {
                        Vector3 from = PointToWorld(points[segment - 1], width, height);
                        Vector3 to = PointToWorld(points[segment], width, height);
                        Vector3 delta = to - from;
                        delta.y = 0f;
                        float length = delta.magnitude;
                        if (length < 0.01f) continue;
                        int pieceCount = Mathf.Max(1, Mathf.CeilToInt(length / MaximumPieceLength));
                        Quaternion rotation = Quaternion.FromToRotation(Vector3.right,
                            delta.normalized);
                        for (int piece = 0; piece < pieceCount; piece++)
                        {
                            float t0 = (float)piece / pieceCount;
                            float t1 = (float)(piece + 1) / pieceCount;
                            Vector3 position = Vector3.Lerp(from, to, (t0 + t1) * 0.5f);
                            float pieceLength = length / pieceCount + (pipeline ? 0.08f : 0.18f);
                            int ordinal = pipeline ? pipelinePieces++ : roadPieces++;
                            float widthVariation = pipeline ? 1f
                                : 1f + ((ordinal % 3) - 1) * 0.045f;
                            GameObject instance = PrefabUtility.InstantiatePrefab(
                                pipeline ? pipelinePrefab : roadPrefab, scene) as GameObject;
                            if (instance == null)
                                throw new InvalidOperationException("Cannot instantiate " + id + ".");
                            instance.name = (pipeline ? "PipelinePiece_" : "RoadPiece_")
                                + id + "_S" + segment.ToString("00") + "_P" + piece.ToString("00");
                            instance.transform.SetParent(network, false);
                            instance.transform.localPosition = position
                                + Vector3.up * (pipeline ? 0.085f : 0.035f);
                            instance.transform.localRotation = rotation;
                            instance.transform.localScale = new Vector3(pieceLength, 1f,
                                authoredWidth * MapScale * widthVariation);
                            ConfigureRenderers(instance, null, false);
                            DisableColliders(instance);
                        }
                    }
                }

                if (roadPieces != ExpectedRoadPieceCount
                    || pipelinePieces != ExpectedPipelinePieceCount)
                    throw new InvalidOperationException("Unexpected authored infrastructure split: roads="
                        + roadPieces + ", pipelines=" + pipelinePieces + ".");

                for (int i = 0; i < Landmarks.Length; i++)
                    InstantiateLandmark(Landmarks[i], landmarks, scene);

                EditorSceneManager.MarkSceneDirty(scene);
                if (!EditorSceneManager.SaveScene(scene))
                    throw new InvalidOperationException("GlobalMapAuthored could not be saved.");
                Debug.Log("[ГЛОБАЛЬНАЯ КАРТА 3.2] дороги сохранены: " + roadPieces
                    + " дорожных секций, " + pipelinePieces + " секций трубопровода, "
                    + Landmarks.Length + " MEP-ориентиров.", marker);
            }
            finally
            {
                if (openedHere && scene.IsValid() && scene.isLoaded)
                    EditorSceneManager.CloseScene(scene, true);
            }
        }

        private static void InstantiateLandmark(LandmarkPlacement placement, Transform parent,
                                                Scene scene)
        {
            GameObject source = Load<GameObject>(placement.PrefabPath);
            Material material = Load<Material>(placement.MaterialPath);
            GameObject instance = PrefabUtility.InstantiatePrefab(source, scene) as GameObject;
            if (instance == null)
                throw new InvalidOperationException("Cannot instantiate " + placement.Name + ".");
            instance.name = placement.Name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.Euler(0f, placement.Yaw, 0f);
            instance.transform.localScale = Vector3.one;
            ScaleToFootprint(instance, placement.Footprint);
            instance.transform.localPosition = placement.Position;
            float embedDepth = placement.GroundPatch
                ? 0.105f
                : Mathf.Clamp(placement.Footprint * 0.055f, 0.035f, 0.16f);
            GroundToSurface(instance, GroundSurfaceY, embedDepth, placement.GroundPatch);
            // The strategic camera uses a deliberately low warm sun. Even small
            // upright props can otherwise cast map-sized black wedges at the far
            // zoom tier, so landmarks read through their silhouette, not shadows.
            ConfigureRenderers(instance, material, false);
            DisableColliders(instance);
        }

        private static void ScaleToFootprint(GameObject instance, float target)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            bool found = false;
            Bounds bounds = default;
            for (int i = 0; i < renderers.Length; i++)
            {
                if (renderers[i] == null) continue;
                if (!found) { bounds = renderers[i].bounds; found = true; }
                else bounds.Encapsulate(renderers[i].bounds);
            }
            if (!found) throw new InvalidOperationException(instance.name + " has no renderer.");
            float footprint = Mathf.Max(bounds.size.x, bounds.size.z);
            if (footprint < 0.001f)
                throw new InvalidOperationException(instance.name + " has invalid bounds.");
            instance.transform.localScale = Vector3.one * (target / footprint);
        }

        private static void GroundToSurface(GameObject instance, float groundY,
                                            float embedDepth, bool groundPatch)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
                throw new InvalidOperationException(instance.name + " has no renderer.");
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
            Vector3 position = instance.transform.position;
            position.y += groundPatch && bounds.size.y < 0.12f
                ? groundY + 0.006f - bounds.max.y
                : groundY - embedDepth - bounds.min.y;
            instance.transform.position = position;
        }

        private static void ConfigureRenderers(GameObject instance, Material overrideMaterial,
                                               bool castShadows)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                if (renderer == null) continue;
                if (overrideMaterial != null)
                {
                    Material[] materials = renderer.sharedMaterials;
                    for (int m = 0; m < materials.Length; m++) materials[m] = overrideMaterial;
                    renderer.sharedMaterials = materials;
                }
                renderer.shadowCastingMode = castShadows
                    ? ShadowCastingMode.On : ShadowCastingMode.Off;
                renderer.receiveShadows = true;
            }
            EditorUtility.SetDirty(instance);
        }

        private static void DisableColliders(GameObject instance)
        {
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++) colliders[i].enabled = false;
        }

        private static Transform CreateLayer(string name, Transform parent, Scene scene)
        {
            var layer = new GameObject(name);
            SceneManager.MoveGameObjectToScene(layer, scene);
            layer.transform.SetParent(parent, false);
            return layer.transform;
        }

        private static Vector3 PointToWorld(JToken token, float width, float height)
        {
            float x = Float(token?["x"]);
            float y = Float(token?["y"]);
            return new Vector3((x - width * 0.5f) * MapScale, 0f,
                (height * 0.5f - y) * MapScale);
        }

        private static float Float(JToken token)
        {
            return token != null && float.TryParse(token.ToString(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out float value) ? value : 0f;
        }

        private static T Load<T>(string path) where T : UnityEngine.Object
        {
            return AssetDatabase.LoadAssetAtPath<T>(path)
                ?? throw new InvalidOperationException("Missing authored asset: " + path);
        }

        private static RoaUnityGlobalMapScene FindMarker(Scene scene)
        {
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                RoaUnityGlobalMapScene marker =
                    root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (marker != null) return marker;
            }
            return null;
        }
    }
}
#endif
