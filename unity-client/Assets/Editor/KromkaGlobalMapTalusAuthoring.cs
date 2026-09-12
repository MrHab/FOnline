#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 02/20. Medium MEP ground rocks form compact,
    /// directional talus fans around the macro landmarks from iteration 01.
    /// </summary>
    internal static class KromkaGlobalMapTalusAuthoring
    {
        internal const int ModelIteration = 2;
        internal const int ModelIterationCount = 20;
        private const int ExpectedPieceCount = 52;
        private const string MepRockRoot =
            "Assets/MEP/MEP_Environment/MEP_Rocks/";

        private static readonly string[] TalusPrefabs =
        {
            MepRockRoot + "MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_a.prefab",
            MepRockRoot + "MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_d.prefab",
            MepRockRoot + "MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_f.prefab",
            MepRockRoot + "MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_h.prefab",
            MepRockRoot + "MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_k.prefab",
            MepRockRoot + "MEP_Stones_01/Prefabs/MEP_Stone_06.prefab",
            MepRockRoot + "MEP_Stones_01/Prefabs/MEP_Stone_09.prefab",
            MepRockRoot + "MEP_Stones_01/Prefabs/MEP_Stone_12.prefab",
            MepRockRoot + "MEP_StoneGround/Prefabs/MEP_StoneGround_a_Sand.prefab"
        };

        private readonly struct Anchor
        {
            public readonly string Name;
            public readonly string Region;
            public readonly float MapX;
            public readonly float MapY;
            public readonly int PieceCount;

            public Anchor(string name, string region, float mapX, float mapY,
                          int pieceCount)
            {
                Name = name;
                Region = region;
                MapX = mapX;
                MapY = mapY;
                PieceCount = pieceCount;
            }
        }

        private readonly struct TalusPlacement
        {
            public readonly string Name;
            public readonly string ClusterName;
            public readonly string Region;
            public readonly string PrefabPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public TalusPlacement(string name, string clusterName, string region,
                                  string prefabPath, float mapX, float mapY,
                                  float footprint, float maximumHeight,
                                  float yaw, float embed)
            {
                Name = name;
                ClusterName = clusterName;
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

        private static readonly Anchor[] Anchors =
        {
            new Anchor("WesternCrown", "OreArc", 52f, 212f, 4),
            new Anchor("NorthWestWall", "OreArc", 78f, 238f, 4),
            new Anchor("NorthCrown", "OreArc", 112f, 255f, 4),
            new Anchor("NorthEastButte", "OreArc", 140f, 250f, 4),
            new Anchor("EasternCut", "OreArc", 143f, 248f, 4),
            new Anchor("SouthEastSpur", "OreArc", 141f, 212f, 4),
            new Anchor("SouthRim", "OreArc", 117f, 178f, 4),
            new Anchor("SouthWestSpur", "OreArc", 66f, 166f, 4),
            new Anchor("WesternGate", "OreArc", 38f, 185f, 4),
            new Anchor("NorthWestSentinel", "SilentRing", 75f, 235f, 2),
            new Anchor("NorthSentinel", "SilentRing", 150f, 270f, 2),
            new Anchor("NorthEastSentinel", "SilentRing", 275f, 232f, 2),
            new Anchor("EastHighSentinel", "SilentRing", 327f, 190f, 2),
            new Anchor("EastLowSentinel", "SilentRing", 327f, 118f, 2),
            new Anchor("SouthEastSentinel", "SilentRing", 295f, 60f, 2),
            new Anchor("SouthWestSentinel", "SilentRing", 90f, 58f, 2),
            new Anchor("WestSentinel", "SilentRing", 45f, 138f, 2)
        };

        internal static void Compose(Transform parent)
        {
            Transform oreRoot = Child(parent, "OreArc_DirectionalTalus_MEP");
            Transform ringRoot = Child(parent, "SilentRing_SparseTalus_MEP");
            List<TalusPlacement> placements = BuildPlacements();
            for (int i = 0; i < placements.Count; i++)
            {
                TalusPlacement placement = placements[i];
                Transform regionRoot = placement.Region == "OreArc" ? oreRoot : ringRoot;
                Transform clusterRoot = regionRoot.Find(placement.ClusterName)
                    ?? Child(regionRoot, placement.ClusterName);
                KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                    placement.PrefabPath, placement.Name, clusterRoot,
                    placement.MapX, placement.MapY, placement.Footprint,
                    placement.MaximumHeight, placement.Yaw, placement.Embed);
            }

            Child(parent, "DirectionalTalusFans_17_REFERENCE");
            Child(parent, "MediumTalusPieces_52_REFERENCE");
            Child(parent, "DirectMEPTalusPrefabs_9_REFERENCE");
            Child(parent, "ModelIteration_02_of_20");
        }

        internal static void ValidateIteration02()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 02 root is missing from the global map.");
            Transform root = rootObject.transform;
            Require(root.Find("DirectionalTalusFans_17_REFERENCE") != null,
                "talus fan reference is missing");
            Require(root.Find("MediumTalusPieces_52_REFERENCE") != null,
                "talus piece-count reference is missing");
            Require(root.Find("DirectMEPTalusPrefabs_9_REFERENCE") != null,
                "talus MEP source reference is missing");
            Require(root.Find("ModelIteration_02_of_20") != null,
                "model iteration marker is missing");

            List<TalusPlacement> placements = BuildPlacements();
            Require(placements.Count == ExpectedPieceCount,
                "iteration 02 must contain 52 medium talus pieces");
            var sourcePaths = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Count; i++)
            {
                TalusPlacement placement = placements[i];
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(sourcePath == placement.PrefabPath,
                    placement.Name + " lost its direct MEP prefab link");
                sourcePaths.Add(sourcePath);

                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no visible renderer");
                Bounds bounds = Encapsulate(renderers);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.035f,
                    placement.Name + " footprint drifted from authored scale");
                Require(bounds.size.y <= placement.MaximumHeight + 0.035f,
                    placement.Name + " is too tall for medium talus");
                float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
                Require(Mathf.Abs(bounds.min.y - (terrainHeight - placement.Embed)) <= 0.035f,
                    placement.Name + " is not seated in the authored relief");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    placement.Name + " can disappear with camera distance");
                Require(instance.GetComponentsInChildren<Collider>(true)
                        .All(collider => !collider.enabled),
                    placement.Name + " can obstruct strategic-map interaction");
            }

            Require(sourcePaths.SetEquals(TalusPrefabs),
                "iteration 02 must use all nine reviewed MEP talus sources");
            Debug.Log("[KROMKA MODELS 10%] PASS: 52 medium MEP ground-rock pieces "
                + "form seventeen directional talus fans; Ore Arc clusters are dense, "
                + "Silent Ring clusters remain sparse and every LOD0 stays persistent.");
        }

        private static List<TalusPlacement> BuildPlacements()
        {
            var result = new List<TalusPlacement>(ExpectedPieceCount);
            for (int anchorIndex = 0; anchorIndex < Anchors.Length; anchorIndex++)
            {
                Anchor anchor = Anchors[anchorIndex];
                string clusterName = anchor.Region + "_TalusFan_"
                    + anchorIndex.ToString("00") + "_" + anchor.Name;
                float fanHeading = Mathf.Repeat(19f + anchorIndex * 71f, 360f);
                for (int piece = 0; piece < anchor.PieceCount; piece++)
                {
                    float spread = anchor.PieceCount == 4
                        ? -31f + piece * 21f
                        : -17f + piece * 34f;
                    float angle = (fanHeading + spread) * Mathf.Deg2Rad;
                    float radius = (anchor.Region == "OreArc" ? 3.2f : 2.8f)
                        + piece * (anchor.Region == "OreArc" ? 1.05f : 1.25f);
                    float mapX = anchor.MapX + Mathf.Cos(angle) * radius;
                    float mapY = anchor.MapY + Mathf.Sin(angle) * radius;
                    float footprint = (anchor.Region == "OreArc" ? 0.30f : 0.25f)
                        + ((anchorIndex + piece) % 3) * 0.065f;
                    float maximumHeight = footprint * 0.68f;
                    string prefabPath = TalusPrefabs[(anchorIndex * 3 + piece * 2)
                        % TalusPrefabs.Length];
                    string name = anchor.Region + "_Talus_"
                        + anchorIndex.ToString("00") + "_" + piece.ToString("00");
                    result.Add(new TalusPlacement(name, clusterName, anchor.Region,
                        prefabPath, mapX, mapY, footprint, maximumHeight,
                        fanHeading + piece * 47f, 0.018f + (piece % 2) * 0.008f));
                }
            }
            return result;
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

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(
                "Kromka model iteration 02 validation failed: " + message);
        }
    }
}
#endif
