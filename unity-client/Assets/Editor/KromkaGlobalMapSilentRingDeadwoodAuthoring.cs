#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 18/20. A sparse ring of individual MEP dead
    /// trees, stumps and wind-thrown branches gives the Silent Ring a continuous
    /// dead-forest identity without importing the expensive grouped prefabs.
    /// </summary>
    internal static class KromkaGlobalMapSilentRingDeadwoodAuthoring
    {
        internal const int ModelIteration = 18;
        internal const int ModelIterationCount = 20;
        private const int ExpectedDeadTreeCount = 40;
        private const int ExpectedStumpCount = 16;
        private const int ExpectedBranchCount = 20;
        private const float WorldScale = 0.1f;

        private const string BrokenTreeRoot =
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Trees/MEP_BrokenTrees/Prefabs/";
        private const string StumpRoot =
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Trees/MEP_TreeStump/Prefabs/";
        private const string BuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";

        private static readonly string[] DeadTreeSources =
        {
            BrokenTreeRoot + "MEP_BrokenDeadTree_01_N.prefab",
            BrokenTreeRoot + "MEP_BrokenDeadTree_02_N.prefab",
            BrokenTreeRoot + "MEP_BrokenDeadTree_03_N.prefab",
            BrokenTreeRoot + "MEP_BrokenDeadTree_04_N.prefab",
            BrokenTreeRoot + "MEP_BrokenDeadTree_05_N.prefab",
            BrokenTreeRoot + "MEP_BrokenDeadTree_06_N.prefab"
        };

        private static readonly string[] StumpSources =
        {
            StumpRoot + "MEP_TreeStump_01.prefab",
            StumpRoot + "MEP_TreeStump_02.prefab",
            StumpRoot + "MEP_TreeTrunk_01.prefab"
        };

        private static readonly string[] BranchSources =
        {
            BuildingRoot + "MEP_S_Branch_03.prefab",
            BuildingRoot + "MEP_S_Branch_04.prefab",
            BuildingRoot + "MEP_S_Branch_05.prefab",
            BuildingRoot + "MEP_S_Branch_06.prefab",
            BuildingRoot + "MEP_S_Branch_07.prefab",
            BuildingRoot + "MEP_S_Branch_08.prefab",
            BuildingRoot + "MEP_S_Branch_09.prefab"
        };

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string AssetPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string assetPath, float mapX, float mapY,
                             float footprint, float maximumHeight, float yaw,
                             float embed)
            {
                Name = name;
                AssetPath = assetPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly Placement[] DeadTrees = BuildDeadTrees();
        private static readonly Placement[] Stumps = BuildStumps();
        private static readonly Placement[] Branches = BuildBranches();

        internal static void Compose(Transform parent)
        {
            Transform root = Child(parent,
                "SilentRing_DeadwoodBelt_ModelPass18_DirectMEP");
            PlaceSet(DeadTrees, Child(root, "DeadTreeSentinels_EDITABLE"));
            PlaceSet(Stumps, Child(root, "DeadTreeStumps_EDITABLE"));
            PlaceSet(Branches, Child(root, "WindThrownBranches_EDITABLE"));

            Child(parent, "SilentRingDeadTrees_40_REFERENCE");
            Child(parent, "SilentRingStumps_16_REFERENCE");
            Child(parent, "SilentRingBranches_20_REFERENCE");
            Child(parent, "DirectMEPDeadwoodSources_16_REFERENCE");
            Child(parent, "SparseDeadForestBelt_REFERENCE");
            Child(parent, "TerrainSeatedDeadwood_REFERENCE");
            Child(parent, "PersistentDeadwoodGeometry_REFERENCE");
            Child(parent, "ModelIteration_18_of_20");
        }

        internal static void ValidateIteration18()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 18 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "SilentRingDeadTrees_40_REFERENCE",
                "SilentRingStumps_16_REFERENCE",
                "SilentRingBranches_20_REFERENCE",
                "DirectMEPDeadwoodSources_16_REFERENCE",
                "SparseDeadForestBelt_REFERENCE",
                "TerrainSeatedDeadwood_REFERENCE",
                "PersistentDeadwoodGeometry_REFERENCE",
                "ModelIteration_18_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");

            Require(DeadTrees.Length == ExpectedDeadTreeCount,
                "forty dead-tree sentinels are required");
            Require(Stumps.Length == ExpectedStumpCount,
                "sixteen dead-tree stumps are required");
            Require(Branches.Length == ExpectedBranchCount,
                "twenty wind-thrown branches are required");

            Transform belt = FindDescendant(root,
                "SilentRing_DeadwoodBelt_ModelPass18_DirectMEP");
            Require(belt != null, "Silent Ring deadwood hierarchy is missing");
            ValidateSet(FindDescendant(belt, "DeadTreeSentinels_EDITABLE"),
                DeadTrees, DeadTreeSources, "dead-tree sentinels");
            ValidateSet(FindDescendant(belt, "DeadTreeStumps_EDITABLE"),
                Stumps, StumpSources, "dead-tree stumps");
            ValidateSet(FindDescendant(belt, "WindThrownBranches_EDITABLE"),
                Branches, BranchSources, "wind-thrown branches");

            Renderer[] renderers = belt.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(renderers.Length >= ExpectedDeadTreeCount + ExpectedStumpCount
                    + ExpectedBranchCount,
                "Silent Ring deadwood lost its reviewed silhouettes");
            Require(renderers.All(renderer => renderer.sharedMaterials.Length > 0
                    && renderer.sharedMaterials.All(material => material != null
                        && material.shader != null && material.shader.isSupported)),
                "every deadwood renderer must retain a supported MEP material");
            Require(belt.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "deadwood can obstruct strategic-map interaction");
            Require(belt.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "deadwood can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 90%] PASS: the Silent Ring uses forty "
                + "terrain-seated direct-MEP dead trees, sixteen stumps and twenty "
                + "wind-thrown branches; no grouped vegetation, active colliders or "
                + "distance-dependent LODs remain.");
        }

        private static Placement[] BuildDeadTrees()
        {
            var rows = new List<Placement>(ExpectedDeadTreeCount);
            for (int i = 0; i < ExpectedDeadTreeCount; i++)
            {
                float angle = i * (360f / ExpectedDeadTreeCount) + 4f;
                float radians = angle * Mathf.Deg2Rad;
                // Leave a full model-footprint margin from the irregular cliff
                // edge; the former 0.79-0.844 ring put two tree crowns in mid-air.
                float radial = 0.74f + (i % 4) * 0.012f;
                float mapX = 190f + Mathf.Cos(radians) * 186.5f * radial;
                float mapY = 150f - Mathf.Sin(radians) * 146.5f * radial;
                rows.Add(new Placement("SilentDeadTree_" + i.ToString("00"),
                    DeadTreeSources[i % DeadTreeSources.Length], mapX, mapY,
                    0.38f + (i % 4) * 0.025f,
                    0.86f + (i % 5) * 0.075f,
                    i * 137.5f + (i % 3) * 11f, 0.025f));
            }
            return rows.ToArray();
        }

        private static Placement[] BuildStumps()
        {
            var rows = new List<Placement>(ExpectedStumpCount);
            for (int i = 0; i < ExpectedStumpCount; i++)
            {
                float angle = i * (360f / ExpectedStumpCount) + 15f;
                float radians = angle * Mathf.Deg2Rad;
                float radial = 0.70f + (i % 3) * 0.020f;
                float mapX = 190f + Mathf.Cos(radians) * 186.5f * radial;
                float mapY = 150f - Mathf.Sin(radians) * 146.5f * radial;
                rows.Add(new Placement("SilentStump_" + i.ToString("00"),
                    StumpSources[i % StumpSources.Length], mapX, mapY,
                    0.32f + (i % 3) * 0.030f,
                    0.28f + (i % 2) * 0.070f,
                    i * 97f + 9f, 0.032f));
            }
            return rows.ToArray();
        }

        private static Placement[] BuildBranches()
        {
            var rows = new List<Placement>(ExpectedBranchCount);
            for (int i = 0; i < ExpectedBranchCount; i++)
            {
                float angle = i * (360f / ExpectedBranchCount) + 11f;
                float radians = angle * Mathf.Deg2Rad;
                float radial = 0.75f + (i % 4) * 0.016f;
                float mapX = 190f + Mathf.Cos(radians) * 186.5f * radial;
                float mapY = 150f - Mathf.Sin(radians) * 146.5f * radial;
                rows.Add(new Placement("SilentWindfall_" + i.ToString("00"),
                    BranchSources[i % BranchSources.Length], mapX, mapY,
                    0.38f + (i % 4) * 0.025f,
                    0.22f + (i % 3) * 0.025f,
                    i * 113f - 17f, 0.040f));
            }
            return rows.ToArray();
        }

        private static void PlaceSet(Placement[] placements, Transform root)
        {
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                    placement.AssetPath, placement.Name, root,
                    placement.MapX, placement.MapY, placement.Footprint,
                    placement.MaximumHeight, placement.Yaw, placement.Embed);
            }
        }

        private static void ValidateSet(Transform root, Placement[] placements,
                                        string[] allowedSources, string label)
        {
            Require(root != null, label + " root is missing");
            var allowed = new HashSet<string>(allowedSources, StringComparer.Ordinal);
            var used = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath && allowed.Contains(source),
                    placement.Name + " lost its reviewed direct MEP source link");
                used.Add(source);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no renderer");
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.04f,
                    placement.Name + " footprint drifted from authored scale");
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is floating above or buried in the terrain");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for strategic-map scale");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        placement.MapX, placement.MapY, 0.10f),
                    placement.Name + " lies outside the visible landmass");
            }
            Require(used.SetEquals(allowed), label + " source set is incomplete");
            ValidateClearance(placements, label);
        }

        private static void ValidateClearance(Placement[] placements, string label)
        {
            for (int a = 0; a < placements.Length; a++)
            {
                for (int b = a + 1; b < placements.Length; b++)
                {
                    float dx = (placements[a].MapX - placements[b].MapX) * WorldScale;
                    float dz = (placements[a].MapY - placements[b].MapY) * WorldScale;
                    float distance = Mathf.Sqrt(dx * dx + dz * dz);
                    float minimum = (placements[a].Footprint + placements[b].Footprint)
                        * 0.48f;
                    Require(distance >= minimum,
                        label + " contains intersecting authored footprints: "
                        + placements[a].Name + " / " + placements[b].Name);
                }
            }
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root == null) return null;
            Transform[] descendants = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < descendants.Length; i++)
                if (descendants[i].name == name) return descendants[i];
            return null;
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
                "Kromka model iteration 18 validation failed: " + message);
        }
    }
}
#endif
