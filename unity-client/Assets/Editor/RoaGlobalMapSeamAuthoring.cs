#if UNITY_EDITOR
using System;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// One-click authoring pass for the eight visible borders between the nine
    /// global-map ground tiles.  It writes normal prefab instances into the saved
    /// scene; nothing is generated when the game runs.
    /// </summary>
    public static class RoaGlobalMapSeamAuthoring
    {
        public const string LayerName = "BiomeTransitions_AUTHORED";
        // Художественное решение 2026-09-02: стыки биомов отключены — карта
        // сведена к рельефу. Расстановка Placements сохранена для возврата.
        public const int ExpectedPlacementCount = 0;
        public const float GroundSurfaceY = -0.13f;
        public const float GroundEmbedDepth = 0.105f;

        private const string StonePrefabPath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_Sand.prefab";
        private const string CrackedPrefabPath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_03.prefab";
        private const string StoneMaterialPath =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_StoneGround_Desert_f3580c39.mat";
        private const string CrackedMaterialPath =
            "Assets/Art/GlobalMap/MEPMaterials/Cracked_Mud_b13c2d72.mat";
        private const string SaltMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_Salt.mat";

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly bool Stone;
            public readonly bool Salt;
            public readonly Vector3 Position;
            public readonly float Yaw;
            public readonly float Scale;

            public Placement(string name, bool stone, bool salt, float x, float z,
                             float yaw, float scale)
            {
                Name = name;
                Stone = stone;
                Salt = salt;
                Position = new Vector3(x, 0f, z);
                Yaw = yaw;
                Scale = scale;
            }
        }

        // Every group follows one actual boundary between unlike 30x30 tiles.
        // Positions are deliberately staggered so the silhouette never repeats as
        // a straight strip when viewed from the strategic camera.
        private static readonly Placement[] Placements =
        {
            // North-west rocky plateau / desert: east and south edges.
            new Placement("BiomeBlend_RD_NWV_01", true, false, -15.8f, 22f, 18f, 2.05f),
            new Placement("BiomeBlend_RD_NWV_02", false, false, -14.2f, 30.5f, 71f, 1.65f),
            new Placement("BiomeBlend_RD_NWV_03", true, false, -15.4f, 39f, 143f, 1.85f),
            new Placement("BiomeBlend_RD_NWH_01", true, false, -39f, 15.6f, 102f, 1.85f),
            new Placement("BiomeBlend_RD_NWH_02", false, false, -30f, 14.3f, 24f, 1.7f),
            new Placement("BiomeBlend_RD_NWH_03", true, false, -21f, 15.2f, 168f, 2.0f),

            // North-east salt basin / desert and the rocky belt below it.
            new Placement("BiomeBlend_SD_NEV_01", false, true, 15.5f, 22f, 11f, 1.85f),
            new Placement("BiomeBlend_SD_NEV_02", true, true, 14.3f, 30.5f, 82f, 1.9f),
            new Placement("BiomeBlend_SD_NEV_03", false, true, 15.8f, 39f, 151f, 1.75f),
            new Placement("BiomeBlend_SR_NEH_01", true, true, 21f, 15.7f, 116f, 1.85f),
            new Placement("BiomeBlend_SR_NEH_02", false, true, 30f, 14.2f, 34f, 1.7f),
            new Placement("BiomeBlend_SR_NEH_03", true, false, 39f, 15.3f, 173f, 1.95f),

            // Eastern rocky belt / central and southern desert.
            new Placement("BiomeBlend_RD_EV_01", true, false, 15.6f, 9f, 27f, 1.9f),
            new Placement("BiomeBlend_RD_EV_02", false, false, 14.2f, 0f, 96f, 1.65f),
            new Placement("BiomeBlend_RD_EV_03", true, false, 15.4f, -9f, 157f, 2.0f),
            new Placement("BiomeBlend_RD_EH_01", true, false, 21f, -14.4f, 124f, 1.95f),
            new Placement("BiomeBlend_RD_EH_02", false, false, 30f, -15.7f, 45f, 1.7f),
            new Placement("BiomeBlend_RD_EH_03", true, false, 39f, -14.6f, 178f, 1.85f),

            // South-west salt basin / desert: east and north edges.
            new Placement("BiomeBlend_SD_SWV_01", false, true, -15.6f, -21f, 20f, 1.75f),
            new Placement("BiomeBlend_SD_SWV_02", true, true, -14.2f, -30f, 88f, 1.95f),
            new Placement("BiomeBlend_SD_SWV_03", false, true, -15.5f, -39f, 149f, 1.85f),
            new Placement("BiomeBlend_SD_SWH_01", false, true, -39f, -15.4f, 109f, 1.8f),
            new Placement("BiomeBlend_SD_SWH_02", true, true, -30f, -14.1f, 32f, 1.9f),
            new Placement("BiomeBlend_SD_SWH_03", false, true, -21f, -15.6f, 166f, 1.75f)
        };

        [MenuItem("Realm of Ashes/Глобальная карта/Применить бесшовные биомы 3.1", true)]
        private static bool CanApply()
        {
            return !Application.isPlaying && !EditorApplication.isCompiling;
        }

        [MenuItem("Realm of Ashes/Глобальная карта/Применить бесшовные биомы 3.1")]
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
                GameObject stonePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(StonePrefabPath)
                    ?? throw new InvalidOperationException("MEP stone-ground prefab is missing.");
                GameObject crackedPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(CrackedPrefabPath)
                    ?? throw new InvalidOperationException("MEP cracked-mud prefab is missing.");
                Material stoneMaterial = AssetDatabase.LoadAssetAtPath<Material>(StoneMaterialPath)
                    ?? throw new InvalidOperationException("Map-local stone material is missing.");
                Material crackedMaterial = AssetDatabase.LoadAssetAtPath<Material>(CrackedMaterialPath)
                    ?? throw new InvalidOperationException("Map-local cracked-mud material is missing.");
                Material saltMaterial = AssetDatabase.LoadAssetAtPath<Material>(SaltMaterialPath)
                    ?? throw new InvalidOperationException("Salt material is missing.");

                Transform existing = marker.StaticContentRoot.Find(LayerName);
                if (existing != null) UnityEngine.Object.DestroyImmediate(existing.gameObject);

                var layer = new GameObject(LayerName);
                SceneManager.MoveGameObjectToScene(layer, scene);
                layer.transform.SetParent(marker.StaticContentRoot, false);

                for (int i = 0; i < Mathf.Min(Placements.Length,
                         ExpectedPlacementCount); i++)
                {
                    Placement placement = Placements[i];
                    GameObject source = placement.Stone ? stonePrefab : crackedPrefab;
                    GameObject instance = PrefabUtility.InstantiatePrefab(source, scene) as GameObject;
                    if (instance == null)
                        throw new InvalidOperationException("Cannot instantiate " + placement.Name + ".");
                    instance.name = placement.Name;
                    instance.transform.SetParent(layer.transform, false);
                    instance.transform.localPosition = placement.Position;
                    instance.transform.localRotation = Quaternion.Euler(0f, placement.Yaw, 0f);
                    instance.transform.localScale = Vector3.one * placement.Scale;

                    Material material = placement.Salt
                        ? saltMaterial
                        : (placement.Stone ? stoneMaterial : crackedMaterial);
                    Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
                    for (int r = 0; r < renderers.Length; r++)
                    {
                        Renderer renderer = renderers[r];
                        if (renderer == null) continue;
                        Material[] materials = renderer.sharedMaterials;
                        for (int m = 0; m < materials.Length; m++) materials[m] = material;
                        renderer.sharedMaterials = materials;
                        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                        renderer.receiveShadows = true;
                    }
                    Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
                    for (int c = 0; c < colliders.Length; c++) colliders[c].enabled = false;
                    GroundToSurface(instance, GroundSurfaceY, GroundEmbedDepth);
                    EditorUtility.SetDirty(instance);
                }

                EditorSceneManager.MarkSceneDirty(scene);
                if (!EditorSceneManager.SaveScene(scene))
                    throw new InvalidOperationException("GlobalMapAuthored could not be saved.");
                Debug.Log("[ГЛОБАЛЬНАЯ КАРТА 3.1] бесшовные биомы сохранены: "
                          + Mathf.Min(Placements.Length, ExpectedPlacementCount)
                          + " MEP-переходов.", marker);
            }
            finally
            {
                if (openedHere && scene.IsValid() && scene.isLoaded)
                    EditorSceneManager.CloseScene(scene, true);
            }
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

        private static void GroundToSurface(GameObject instance, float groundY,
                                            float embedDepth)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
                throw new InvalidOperationException(instance.name + " has no renderer.");
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
            Vector3 position = instance.transform.position;
            position.y += bounds.size.y < 0.12f
                ? groundY + 0.006f - bounds.max.y
                : groundY - embedDepth - bounds.min.y;
            instance.transform.position = position;
        }
    }
}
#endif
