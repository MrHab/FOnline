#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 01/20. Large MEP rock silhouettes establish
    /// the Ore Arc quarry rim and the strongest buttresses of the Silent Ring.
    /// Smaller talus, industrial landmarks and vegetation belong to later passes.
    /// </summary>
    internal static class KromkaGlobalMapRockLandmarkAuthoring
    {
        internal const int ModelIteration = 1;
        internal const int ModelIterationCount = 20;

        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);
        private const string MepRockRoot =
            "Assets/MEP/MEP_Environment/MEP_Rocks/";

        private const string DesertCliff02 = MepRockRoot
            + "Cliff_01/Prefabs/MEP_Desert_Cliff_02.prefab";
        private const string DesertCliff03 = MepRockRoot
            + "Cliff_01/Prefabs/MEP_Desert_Cliff_03.prefab";
        private const string DesertCliff04 = MepRockRoot
            + "Cliff_01/Prefabs/MEP_Desert_Cliff_04.prefab";
        private const string DesertCliff05 = MepRockRoot
            + "Cliff_01/Prefabs/MEP_Desert_Cliff_05.prefab";
        private const string DesertCliff06 = MepRockRoot
            + "Cliff_01/Prefabs/MEP_Desert_Cliff_06.prefab";
        private const string SandRock01 = MepRockRoot
            + "MEP_Rock_01/Prefabs/MEP_Rock_01_N_d_Sand.prefab";
        private const string SandRock03 = MepRockRoot
            + "MEP_Rock_02_03/Prefabs/MEP_Rock_03_b_Sand.prefab";
        private const string SandRock04 = MepRockRoot
            + "MEP_Rock_04/Prefabs/MEP_Rock_04_b_Sand.prefab";
        private const string SandRock05 = MepRockRoot
            + "MEP_Rock_05/Prefabs/MEP_Rock_05_h_Sand.prefab";
        private const string RingRock01 = MepRockRoot
            + "MEP_Rock_01/Prefabs/MEP_Rock_01_N_c_Sand.prefab";
        private const string RingRock03 = MepRockRoot
            + "MEP_Rock_02_03/Prefabs/MEP_Rock_03_a_Sand.prefab";
        private const string RingRock04 = MepRockRoot
            + "MEP_Rock_04/Prefabs/MEP_Rock_04_c_Sand.prefab";
        private const string RingRock05 = MepRockRoot
            + "MEP_Rock_05/Prefabs/MEP_Rock_05_j_Sand.prefab";

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string Region;
            public readonly string PrefabPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string region, string prefabPath,
                             float mapX, float mapY, float footprint, float maximumHeight,
                             float yaw, float embed)
            {
                Name = name;
                Region = region;
                PrefabPath = prefabPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        // These are sparse silhouette anchors, deliberately kept off settlement
        // pads and the main route centres. Medium and small rock scatter is not
        // part of this five-percent pass.
        private static readonly Placement[] Placements =
        {
            new Placement("OreArc_WesternCrown", "OreArc", DesertCliff02,
                52f, 212f, 1.30f, 1.00f, 28f, 0.08f),
            new Placement("OreArc_NorthWestWall", "OreArc", DesertCliff05,
                78f, 238f, 1.15f, 0.88f, -18f, 0.07f),
            new Placement("OreArc_NorthCrown", "OreArc", DesertCliff06,
                112f, 255f, 1.22f, 0.95f, 10f, 0.08f),
            new Placement("OreArc_NorthEastButte", "OreArc", SandRock04,
                140f, 250f, 1.05f, 0.76f, 46f, 0.06f),
            new Placement("OreArc_EasternCut", "OreArc", DesertCliff03,
                143f, 248f, 1.20f, 0.78f, 82f, 0.07f),
            new Placement("OreArc_SouthEastSpur", "OreArc", SandRock01,
                141f, 212f, 1.05f, 0.74f, 116f, 0.06f),
            new Placement("OreArc_SouthRim", "OreArc", DesertCliff04,
                117f, 178f, 1.30f, 0.90f, 162f, 0.08f),
            new Placement("OreArc_SouthWestSpur", "OreArc", SandRock03,
                66f, 166f, 1.10f, 0.76f, -132f, 0.06f),
            new Placement("OreArc_WesternGate", "OreArc", SandRock05,
                38f, 185f, 1.02f, 0.74f, -78f, 0.06f),

            new Placement("SilentRing_NorthWestSentinel", "SilentRing", RingRock04,
                75f, 235f, 1.15f, 0.80f, 18f, 0.07f),
            new Placement("SilentRing_NorthSentinel", "SilentRing", RingRock01,
                150f, 270f, 1.05f, 0.75f, -12f, 0.06f),
            new Placement("SilentRing_NorthEastSentinel", "SilentRing", RingRock05,
                275f, 232f, 1.08f, 0.80f, 35f, 0.07f),
            new Placement("SilentRing_EastHighSentinel", "SilentRing", RingRock03,
                327f, 190f, 1.00f, 0.72f, 81f, 0.06f),
            new Placement("SilentRing_EastLowSentinel", "SilentRing", RingRock04,
                327f, 118f, 1.04f, 0.75f, 104f, 0.07f),
            new Placement("SilentRing_SouthEastSentinel", "SilentRing", RingRock01,
                295f, 60f, 1.20f, 0.84f, 148f, 0.07f),
            new Placement("SilentRing_SouthWestSentinel", "SilentRing", RingRock05,
                90f, 58f, 1.15f, 0.82f, -151f, 0.07f),
            new Placement("SilentRing_WestSentinel", "SilentRing", RingRock03,
                45f, 138f, 1.00f, 0.72f, -86f, 0.06f)
        };

        internal static void Compose(Transform parent)
        {
            Transform oreRoot = Child(parent, "OreArc_LargeRockLandmarks_MEP");
            Transform ringRoot = Child(parent, "SilentRing_LargeRockLandmarks_MEP");

            for (int i = 0; i < Placements.Length; i++)
            {
                Placement placement = Placements[i];
                Transform regionRoot = placement.Region == "OreArc" ? oreRoot : ringRoot;
                InstantiateLandmark(placement, regionRoot);
            }

            Child(parent, "LargeRockLandmarks_17_REFERENCE");
            Child(parent, "DirectMEPRockPrefabs_13_REFERENCE");
            Child(parent, "PersistentHighestDetailLOD_REFERENCE");
            Child(parent, "ModelIteration_01_of_20");
        }

        internal static void ValidateIteration01()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 01 root is missing from the global map.");

            Transform root = rootObject.transform;
            Require(root.Find("LargeRockLandmarks_17_REFERENCE") != null,
                "large-rock count reference is missing");
            Require(root.Find("DirectMEPRockPrefabs_13_REFERENCE") != null,
                "direct MEP source reference is missing");
            Require(root.Find("PersistentHighestDetailLOD_REFERENCE") != null,
                "persistent-detail reference is missing");
            Require(root.Find("ModelIteration_01_of_20") != null,
                "model iteration marker is missing");

            var sourcePaths = new HashSet<string>(StringComparer.Ordinal);
            int rendererCount = 0;
            for (int i = 0; i < Placements.Length; i++)
            {
                Placement placement = Placements[i];
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");

                string sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(sourcePath == placement.PrefabPath,
                    placement.Name + " must remain connected to its reviewed MEP prefab");
                Require(sourcePath.StartsWith(MepRockRoot, StringComparison.Ordinal),
                    placement.Name + " is not sourced from MEP rocks");
                sourcePaths.Add(sourcePath);

                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no visible renderer");
                rendererCount += renderers.Length;
                Bounds bounds = Encapsulate(renderers);
                float actualFootprint = Mathf.Max(bounds.size.x, bounds.size.z);
                Require(Mathf.Abs(actualFootprint - placement.Footprint) <= 0.035f,
                    placement.Name + " footprint drifted from authored scale");
                Require(bounds.size.y <= placement.MaximumHeight + 0.035f,
                    placement.Name + " is too tall for the strategic-map scale");

                float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
                Require(Mathf.Abs(bounds.min.y - (terrainHeight - placement.Embed)) <= 0.035f,
                    placement.Name + " is not seated in the authored relief");
                Require(instance.GetComponentsInChildren<Collider>(true)
                        .All(collider => !collider.enabled),
                    placement.Name + " can obstruct strategic-map interaction");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    placement.Name + " can still disappear with camera distance");
                Require(renderers.All(renderer => renderer.sharedMaterials.All(material =>
                            material != null && material.shader != null
                            && material.shader.isSupported)),
                    placement.Name + " has a missing or unsupported material");
            }

            Require(Placements.Length == 17, "iteration 01 must contain 17 macro landmarks");
            Require(sourcePaths.Count == 13,
                "iteration 01 must retain thirteen distinct direct MEP rock sources");
            Require(rendererCount >= Placements.Length,
                "iteration 01 visible renderer coverage is incomplete");

            Debug.Log("[KROMKA MODELS 5%] PASS: 17 direct MEP cliff and rock landmarks "
                + "establish the Ore Arc quarry rim and eight Silent Ring buttresses; "
                + "highest-detail geometry remains visible at every strategic-map distance.");
        }

        private static void InstantiateLandmark(Placement placement, Transform parent)
        {
            InstantiateMepRock(placement.PrefabPath, placement.Name, parent,
                placement.MapX, placement.MapY, placement.Footprint,
                placement.MaximumHeight, placement.Yaw, placement.Embed);
        }

        internal static GameObject InstantiateMepRock(string prefabPath, string name,
                                                      Transform parent, float mapX,
                                                      float mapY, float footprint,
                                                      float maximumHeight, float yaw,
                                                      float embed,
                                                      float sourcePitch = 0f)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefab == null)
                throw new InvalidOperationException("Missing reviewed MEP rock prefab: "
                    + prefabPath);

            GameObject instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (instance == null)
                throw new InvalidOperationException("Cannot instantiate " + name);
            instance.name = name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = MapToWorld(mapX, mapY);
            instance.transform.localRotation = Quaternion.Euler(0f, yaw, 0f)
                * Quaternion.Euler(sourcePitch, 0f, 0f);

            KeepHighestDetailAtEveryDistance(instance);
            DisableInteractionColliders(instance);
            FitAndSeat(instance, name, mapX, mapY, footprint, maximumHeight, embed);
            MarkStatic(instance);
            EditorUtility.SetDirty(instance);
            return instance;
        }

        private static void KeepHighestDetailAtEveryDistance(GameObject instance)
        {
            LODGroup[] groups = instance.GetComponentsInChildren<LODGroup>(true);
            for (int i = 0; i < groups.Length; i++)
            {
                LODGroup group = groups[i];
                LOD[] lods = group.GetLODs();
                if (lods.Length == 0)
                {
                    UnityEngine.Object.DestroyImmediate(group);
                    continue;
                }

                var highestDetail = new HashSet<Renderer>(lods[0].renderers
                    .Where(renderer => renderer != null));
                for (int lodIndex = 0; lodIndex < lods.Length; lodIndex++)
                {
                    Renderer[] renderers = lods[lodIndex].renderers;
                    for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                    {
                        Renderer renderer = renderers[rendererIndex];
                        if (renderer != null) renderer.enabled = highestDetail.Contains(renderer);
                    }
                }
                UnityEngine.Object.DestroyImmediate(group);
            }
        }

        private static void DisableInteractionColliders(GameObject instance)
        {
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++) colliders[i].enabled = false;
        }

        private static void FitAndSeat(GameObject instance, string name,
                                       float mapX, float mapY, float footprint,
                                       float maximumHeight, float embed)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            if (renderers.Length == 0)
                throw new InvalidOperationException(name + " has no LOD0 renderers");

            Bounds bounds = Encapsulate(renderers);
            float sourceFootprint = Mathf.Max(0.001f, Mathf.Max(bounds.size.x, bounds.size.z));
            instance.transform.localScale *= footprint / sourceFootprint;

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
            Vector3 target = MapToWorld(mapX, mapY);
            Vector3 correction = new Vector3(target.x - bounds.center.x,
                target.y - embed - bounds.min.y,
                target.z - bounds.center.z);
            instance.transform.position += correction;

            Renderer[] fitted = instance.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < fitted.Length; i++)
            {
                fitted[i].shadowCastingMode = ShadowCastingMode.On;
                fitted[i].receiveShadows = true;
                fitted[i].motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            }
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            Transform[] descendants = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < descendants.Length; i++)
                if (descendants[i].name == name) return descendants[i];
            return null;
        }

        private static void MarkStatic(GameObject root)
        {
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic;
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(transforms[i].gameObject, flags);
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(
                "Kromka model iteration 01 validation failed: " + message);
        }
    }
}
#endif
