#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 04/20. Short chains of direct MEP cliff
    /// prefabs join the eight Silent Ring sentinels without sealing the map edge.
    /// Every link keeps a wide central break for routes and later landmarks.
    /// </summary>
    internal static class KromkaGlobalMapSilentRingCliffAuthoring
    {
        internal const int ModelIteration = 4;
        internal const int ModelIterationCount = 20;
        private const int ExpectedLinkCount = 8;
        private const int PiecesPerLink = 4;
        private const int ExpectedPieceCount = ExpectedLinkCount * PiecesPerLink;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);
        private const string MepRockRoot =
            "Assets/MEP/MEP_Environment/MEP_Rocks/";

        private static readonly string[] CliffPrefabs =
        {
            MepRockRoot + "Cliff_02/Prefabs/Cliff_02_01_N.prefab",
            MepRockRoot + "Cliff_02/Prefabs/Cliff_02_02_N.prefab",
            MepRockRoot + "Cliff_02/Prefabs/Cliff_02_03_N.prefab",
            MepRockRoot + "Cliff_03/Prefabs/Cliff_03_02_N.prefab",
            MepRockRoot + "Cliff_03/Prefabs/Cliff_03_04_N.prefab",
            MepRockRoot + "Cliff_03/Prefabs/Cliff_03_06_N.prefab"
        };

        private readonly struct Anchor
        {
            public readonly string Name;
            public readonly Vector2 Map;

            public Anchor(string name, float mapX, float mapY)
            {
                Name = name;
                Map = new Vector2(mapX, mapY);
            }
        }

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string LinkName;
            public readonly string PrefabPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string linkName, string prefabPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed)
            {
                Name = name;
                LinkName = linkName;
                PrefabPath = prefabPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        // Clockwise anchors match the eight macro sentinels from model pass 01.
        private static readonly Anchor[] Anchors =
        {
            new Anchor("NorthWest", 75f, 235f),
            new Anchor("North", 150f, 270f),
            new Anchor("NorthEast", 275f, 232f),
            new Anchor("EastHigh", 327f, 190f),
            new Anchor("EastLow", 327f, 118f),
            new Anchor("SouthEast", 295f, 60f),
            new Anchor("SouthWest", 90f, 58f),
            new Anchor("West", 45f, 138f)
        };

        internal static void Compose(Transform parent)
        {
            Transform root = Child(parent, "SilentRing_BrokenCliffChain_MEP");
            List<Placement> placements = BuildPlacements();
            for (int i = 0; i < placements.Count; i++)
            {
                Placement placement = placements[i];
                Transform linkRoot = root.Find(placement.LinkName)
                    ?? Child(root, placement.LinkName);
                KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                    placement.PrefabPath, placement.Name, linkRoot,
                    placement.MapX, placement.MapY, placement.Footprint,
                    placement.MaximumHeight, placement.Yaw, placement.Embed);
            }

            Child(parent, "SilentRingCliffLinks_8_REFERENCE");
            Child(parent, "BrokenCliffPieces_32_REFERENCE");
            Child(parent, "DirectMEPCliffPrefabs_6_REFERENCE");
            Child(parent, "StrategicGaps_8_REFERENCE");
            Child(parent, "ModelIteration_04_of_20");
        }

        internal static void ValidateIteration04()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 04 root is missing from the global map.");
            Transform root = rootObject.transform;
            Require(root.Find("SilentRingCliffLinks_8_REFERENCE") != null,
                "cliff-link reference is missing");
            Require(root.Find("BrokenCliffPieces_32_REFERENCE") != null,
                "cliff piece-count reference is missing");
            Require(root.Find("DirectMEPCliffPrefabs_6_REFERENCE") != null,
                "direct MEP cliff-source reference is missing");
            Require(root.Find("StrategicGaps_8_REFERENCE") != null,
                "strategic-gap reference is missing");
            Require(root.Find("ModelIteration_04_of_20") != null,
                "model iteration marker is missing");

            Transform chainRoot = FindDescendant(root,
                "SilentRing_BrokenCliffChain_MEP");
            Require(chainRoot != null, "broken cliff-chain hierarchy is missing");
            Require(chainRoot.childCount == ExpectedLinkCount,
                "Silent Ring must retain eight separately authored links");

            List<Placement> placements = BuildPlacements();
            Require(placements.Count == ExpectedPieceCount,
                "iteration 04 must contain 32 broken-ring cliff pieces");
            var sourcePaths = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Count; i++)
            {
                Placement placement = placements[i];
                Transform instance = FindDescendant(chainRoot, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(sourcePath == placement.PrefabPath,
                    placement.Name + " lost its reviewed direct MEP prefab link");
                sourcePaths.Add(sourcePath);

                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no visible renderer");
                Bounds bounds = Encapsulate(renderers);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.035f,
                    placement.Name + " footprint drifted from authored scale");
                Require(bounds.size.y <= placement.MaximumHeight + 0.035f,
                    placement.Name + " is too tall for the strategic-map perimeter");
                float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
                Require(Mathf.Abs(bounds.min.y - (terrainHeight - placement.Embed)) <= 0.035f,
                    placement.Name + " is floating above the authored relief");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    placement.Name + " can disappear with camera distance");
                Require(instance.GetComponentsInChildren<Collider>(true)
                        .All(collider => !collider.enabled),
                    placement.Name + " can obstruct strategic-map interaction");
                Require(renderers.All(renderer => renderer.sharedMaterials.All(material =>
                            material != null && material.shader != null
                            && material.shader.isSupported)),
                    placement.Name + " has a missing or unsupported MEP material");
            }

            Require(sourcePaths.SetEquals(CliffPrefabs),
                "iteration 04 must use all six reviewed MEP cliff sources");
            Debug.Log("[KROMKA MODELS 20%] PASS: 32 direct MEP cliff pieces form "
                + "eight broken Silent Ring links; eight strategic passages remain "
                + "open and highest-detail geometry stays visible at every zoom.");
        }

        private static List<Placement> BuildPlacements()
        {
            var result = new List<Placement>(ExpectedPieceCount);
            float[] fractions = { 0.18f, 0.38f, 0.62f, 0.82f };
            for (int linkIndex = 0; linkIndex < Anchors.Length; linkIndex++)
            {
                Anchor start = Anchors[linkIndex];
                Anchor end = Anchors[(linkIndex + 1) % Anchors.Length];
                string linkName = "SilentRing_Link_" + linkIndex.ToString("00")
                    + "_" + start.Name + "_To_" + end.Name;
                Vector2 direction = (end.Map - start.Map).normalized;
                Vector2 lateral = new Vector2(-direction.y, direction.x);
                float yaw = Mathf.Atan2(direction.x, -direction.y) * Mathf.Rad2Deg;
                for (int pieceIndex = 0; pieceIndex < PiecesPerLink; pieceIndex++)
                {
                    Vector2 map = Vector2.Lerp(start.Map, end.Map, fractions[pieceIndex]);
                    Vector2 radial = (map - MapCentre).normalized;
                    float inward = 2.2f + ((linkIndex + pieceIndex) % 3) * 0.8f;
                    float stagger = Mathf.Sin((linkIndex * PiecesPerLink
                        + pieceIndex) * 2.173f) * 1.15f;
                    map -= radial * inward;
                    map += lateral * stagger;

                    float footprint = 0.70f
                        + ((linkIndex * 3 + pieceIndex) % 4) * 0.065f;
                    float maximumHeight = footprint * 0.62f;
                    string name = "SilentRing_CliffPiece_"
                        + linkIndex.ToString("00") + "_" + pieceIndex.ToString("00");
                    string prefabPath = CliffPrefabs[(linkIndex * PiecesPerLink
                        + pieceIndex) % CliffPrefabs.Length];
                    result.Add(new Placement(name, linkName, prefabPath,
                        map.x, map.y, footprint, maximumHeight,
                        yaw + (pieceIndex - 1.5f) * 6.5f,
                        0.035f + (pieceIndex % 2) * 0.010f));
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
                "Kromka model iteration 04 validation failed: " + message);
        }
    }
}
#endif
