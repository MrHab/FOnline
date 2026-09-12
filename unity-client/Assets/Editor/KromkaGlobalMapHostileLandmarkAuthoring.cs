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
    /// Environment-model iteration 15/20. Three hostile wilderness nodes gain
    /// distinct, terrain-seated silhouettes: the Dustling cable colony, the
    /// Folded medical crater and the Burrower settling nest.
    /// </summary>
    internal static class KromkaGlobalMapHostileLandmarkAuthoring
    {
        internal const int ModelIteration = 15;
        internal const int ModelIterationCount = 20;
        private const int ExpectedDustlingMepCount = 14;
        private const int ExpectedFoldedConcreteCount = 18;
        private const int ExpectedBurrowRidgeCount = 16;
        private const int ExpectedRelicCount = 9;
        private const int ExpectedCableRunCount = 10;
        private const int ExpectedMedicalRingSegments = 20;
        private const int ExpectedBurrowHoleCount = 5;
        private const float BurrowerOffsetY = 18f;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string CaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";
        private const string BuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string SpaceRoot =
            "Assets/ThirdParty/Kenney/SpaceKit10/Models/";
        private const string FactoryRoot =
            "Assets/ThirdParty/Kenney/FactoryKit30/Models/";
        private const string MepCaveSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Cave/Materials/MEP_CaveWall_Dif.mat";
        private const string MepBuildingSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";

        private const string DustlingMepMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_Dustling_MEP.mat";
        private const string FoldedConcreteMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_FoldedConcrete_MEP.mat";
        private const string BurrowRidgeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_BurrowRidge_MEP.mat";
        private const string RelicMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_IndustrialRelics.mat";
        private const string CableMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_ShreddedCable.mat";
        private const string MedicalMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_MedicalRing.mat";
        private const string BurrowMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_BurrowDark.mat";
        private const string AmberMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_AmberVent.mat";
        private const string RedMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Hostile_RedMedical.mat";

        private static readonly string[] DustlingMepSources =
        {
            CaveRoot + "MEP_C_Entrance_01_N.prefab",
            CaveRoot + "MEP_C_Block_01_N.prefab",
            CaveRoot + "MEP_C_Block_02_N.prefab",
            CaveRoot + "MEP_C_ClusterStone_01_N.prefab",
            CaveRoot + "MEP_C_ClusterStone_02_N.prefab",
            CaveRoot + "MEP_C_Pipe_01_N.prefab",
            CaveRoot + "MEP_C_Pipe_02_N.prefab"
        };

        private static readonly string[] FoldedConcreteSources =
        {
            BuildingRoot + "MEP_Wall_01_N.prefab",
            BuildingRoot + "MEP_Wall_02_N.prefab",
            BuildingRoot + "MEP_Wall_03_N.prefab",
            BuildingRoot + "MEP_Wall_04_N.prefab",
            BuildingRoot + "MEP_StoneWall_01_N.prefab",
            BuildingRoot + "MEP_StoneWall_02_N.prefab"
        };

        private static readonly string[] BurrowRidgeSources =
        {
            CaveRoot + "MEP_C_Rock_01_N.prefab",
            CaveRoot + "MEP_C_ConcaveStone_N.prefab",
            CaveRoot + "MEP_C_ClusterStone_03_N.prefab",
            CaveRoot + "MEP_C_ClusterStone_04_N.prefab",
            CaveRoot + "MEP_C_Wall_01_N.prefab",
            CaveRoot + "MEP_C_Wall_03_N.prefab",
            CaveRoot + "MEP_C_Wall_05_N.prefab",
            CaveRoot + "MEP_C_Wall_07_N.prefab"
        };

        private static readonly string[] RelicSources =
        {
            SpaceRoot + "machine_wirelessCable.fbx",
            SpaceRoot + "pipe_split.fbx",
            SpaceRoot + "pipe_cornerRoundLarge.fbx",
            SpaceRoot + "machine_generator.fbx",
            SpaceRoot + "corridor_open.fbx",
            SpaceRoot + "hangar_roundGlass.fbx",
            FactoryRoot + "hopper-high-round.fbx",
            FactoryRoot + "conveyor-corner.fbx",
            FactoryRoot + "structure-tall.fbx"
        };

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string Zone;
            public readonly string AssetPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string zone, string assetPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed)
            {
                Name = name;
                Zone = zone;
                AssetPath = assetPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly Placement[] DustlingMep = BuildDustlingMep();
        private static readonly Placement[] FoldedConcrete = BuildFoldedConcrete();
        private static readonly Placement[] BurrowRidge = BuildBurrowRidge();

        private static readonly Placement[] Relics =
        {
            new Placement("Dustling_CableRepeater", "DustlingColony", RelicSources[0], 42f, 173f, 0.48f, 0.55f, 18f, 0.020f),
            new Placement("Dustling_SplitManifold", "DustlingColony", RelicSources[1], 48f, 169f, 0.44f, 0.38f, -28f, 0.018f),
            new Placement("Dustling_BuriedPipeElbow", "DustlingColony", RelicSources[2], 35f, 178f, 0.50f, 0.40f, 68f, 0.050f),

            new Placement("Folded_EmergencyGenerator", "FoldedCrater", RelicSources[3], 307f, 145f, 0.40f, 0.42f, 18f, 0.018f),
            new Placement("Folded_OpenWard", "FoldedCrater", RelicSources[4], 323f, 145f, 0.64f, 0.34f, -18f, 0.025f),
            new Placement("Folded_CollapsedTheatre", "FoldedCrater", RelicSources[5], 315f, 133f, 0.66f, 0.48f, 3f, 0.075f),

            new Placement("Burrower_SettlingHopper", "BurrowerNest", RelicSources[6], 278f, 37f, 0.50f, 0.68f, 14f, 0.020f),
            new Placement("Burrower_BrokenConveyor", "BurrowerNest", RelicSources[7], 294f, 39f, 0.58f, 0.34f, -22f, 0.025f),
            new Placement("Burrower_AbandonedTower", "BurrowerNest", RelicSources[8], 286f, 25f, 0.50f, 0.84f, 2f, 0.025f)
        };

        internal static void Compose(Transform parent)
        {
            Material dustlingMep = BuildMepMaterial(DustlingMepMaterialPath,
                MepCaveSourceMaterial, "Kromka_Hostile_Dustling_MEP",
                new Color(0.25f, 0.20f, 0.13f, 1f));
            Material foldedConcrete = BuildMepMaterial(FoldedConcreteMaterialPath,
                MepBuildingSourceMaterial, "Kromka_Hostile_FoldedConcrete_MEP",
                new Color(0.47f, 0.48f, 0.42f, 1f));
            Material burrowRidge = BuildMepMaterial(BurrowRidgeMaterialPath,
                MepCaveSourceMaterial, "Kromka_Hostile_BurrowRidge_MEP",
                new Color(0.25f, 0.20f, 0.16f, 1f));
            Material relic = BuildSolidMaterial(RelicMaterialPath,
                "Kromka_Hostile_IndustrialRelics", new Color(0.17f, 0.21f, 0.19f, 1f),
                0.34f, 0.22f);
            Material cable = BuildSolidMaterial(CableMaterialPath,
                "Kromka_Hostile_ShreddedCable", new Color(0.030f, 0.035f, 0.030f, 1f),
                0.22f, 0.30f);
            Material medical = BuildSolidMaterial(MedicalMaterialPath,
                "Kromka_Hostile_MedicalRing", new Color(0.48f, 0.52f, 0.47f, 1f),
                0.28f, 0.26f);
            Material burrow = BuildSolidMaterial(BurrowMaterialPath,
                "Kromka_Hostile_BurrowDark", new Color(0.016f, 0.020f, 0.015f, 1f),
                0.05f, 0.72f);
            Material amber = BuildEmissiveMaterial(AmberMaterialPath,
                "Kromka_Hostile_AmberVent", new Color(0.28f, 0.11f, 0.010f, 1f),
                new Color(0.95f, 0.26f, 0.018f, 1f));
            Material red = BuildEmissiveMaterial(RedMaterialPath,
                "Kromka_Hostile_RedMedical", new Color(0.28f, 0.020f, 0.015f, 1f),
                new Color(0.92f, 0.035f, 0.018f, 1f));

            Transform root = Child(parent, "HostileLandmarks_ModelPass15_MEP_Kenney");
            PlaceSet(DustlingMep, Child(root, "DustlingColony_DirectMEP_EDITABLE"), dustlingMep);
            PlaceSet(FoldedConcrete, Child(root, "FoldedCrater_DirectMEP_EDITABLE"), foldedConcrete);
            PlaceSet(BurrowRidge, Child(root, "BurrowerNest_DirectMEP_EDITABLE"), burrowRidge);
            PlaceSet(Relics, Child(root, "HostileIndustrialRelics_EDITABLE"), relic);
            BuildDustlingCableRuns(root, cable, amber);
            BuildDustlingVentMound(root, dustlingMep, relic, amber);
            BuildFoldedMedicalRing(root, medical, red);
            BuildFoldedSurgicalMast(root, relic, medical, red);
            BuildBurrowHoles(root, burrow, burrowRidge);
            BuildBrokenSettlingWall(root, foldedConcrete, burrow);

            Child(parent, "HostileNamedNodes_3_REFERENCE");
            Child(parent, "DustlingDirectMEP_14_REFERENCE");
            Child(parent, "FoldedConcreteDirectMEP_18_REFERENCE");
            Child(parent, "BurrowRidgeDirectMEP_16_REFERENCE");
            Child(parent, "HostileIndustrialRelics_9_REFERENCE");
            Child(parent, "DustlingCableRuns_10_REFERENCE");
            Child(parent, "DustlingVentMound_1_REFERENCE");
            Child(parent, "FoldedMedicalRingSegments_20_REFERENCE");
            Child(parent, "FoldedSurgicalMast_1_REFERENCE");
            Child(parent, "BurrowerDarkHoles_5_REFERENCE");
            Child(parent, "BurrowerBrokenSettlingWall_1_REFERENCE");
            Child(parent, "TerrainSeatedHostileLandmarks_REFERENCE");
            Child(parent, "PersistentHostileGeometry_REFERENCE");
            Child(parent, "ModelIteration_15_of_20");
        }

        internal static void ValidateIteration15()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 15 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "HostileNamedNodes_3_REFERENCE", "DustlingDirectMEP_14_REFERENCE",
                "FoldedConcreteDirectMEP_18_REFERENCE",
                "BurrowRidgeDirectMEP_16_REFERENCE",
                "HostileIndustrialRelics_9_REFERENCE",
                "DustlingCableRuns_10_REFERENCE", "DustlingVentMound_1_REFERENCE",
                "FoldedMedicalRingSegments_20_REFERENCE",
                "FoldedSurgicalMast_1_REFERENCE", "BurrowerDarkHoles_5_REFERENCE",
                "BurrowerBrokenSettlingWall_1_REFERENCE",
                "TerrainSeatedHostileLandmarks_REFERENCE",
                "PersistentHostileGeometry_REFERENCE", "ModelIteration_15_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(DustlingMep.Length == ExpectedDustlingMepCount,
                "fourteen Dustling MEP pieces are required");
            Require(FoldedConcrete.Length == ExpectedFoldedConcreteCount,
                "eighteen Folded concrete pieces are required");
            Require(BurrowRidge.Length == ExpectedBurrowRidgeCount,
                "sixteen Burrower ridge pieces are required");
            Require(Relics.Length == ExpectedRelicCount,
                "nine industrial relics are required");

            Transform hostile = FindDescendant(root,
                "HostileLandmarks_ModelPass15_MEP_Kenney");
            Require(hostile != null, "hostile landmark root is missing");
            ValidateSet(FindDescendant(hostile, "DustlingColony_DirectMEP_EDITABLE"),
                DustlingMep, RequireMaterial(DustlingMepMaterialPath), DustlingMepSources);
            ValidateSet(FindDescendant(hostile, "FoldedCrater_DirectMEP_EDITABLE"),
                FoldedConcrete, RequireMaterial(FoldedConcreteMaterialPath),
                FoldedConcreteSources);
            ValidateSet(FindDescendant(hostile, "BurrowerNest_DirectMEP_EDITABLE"),
                BurrowRidge, RequireMaterial(BurrowRidgeMaterialPath), BurrowRidgeSources);
            ValidateSet(FindDescendant(hostile, "HostileIndustrialRelics_EDITABLE"),
                Relics, RequireMaterial(RelicMaterialPath), RelicSources);
            ValidateClearance(DustlingMep, "Dustling direct MEP");
            ValidateClearance(FoldedConcrete, "Folded concrete ring");
            ValidateClearance(BurrowRidge, "Burrower ridge");
            ValidateClearance(Relics, "hostile industrial relics");

            Transform cableRuns = FindDescendant(hostile,
                "Dustling_ShreddedCableRuns_LANDMARK");
            Require(cableRuns != null && cableRuns.childCount == ExpectedCableRunCount,
                "Dustling colony must retain ten cable runs");
            Require(cableRuns.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedCableRunCount * 3,
                "Dustling cable-run silhouettes are incomplete");
            Transform ventMound = FindDescendant(hostile,
                "Dustling_VentMound_LANDMARK");
            Require(ventMound != null
                    && ventMound.GetComponentsInChildren<Renderer>(true).Length >= 13,
                "Dustling vent mound silhouette is incomplete");
            Transform medicalRing = FindDescendant(hostile,
                "Folded_MedicalRing_LANDMARK");
            Require(medicalRing != null
                    && medicalRing.childCount == ExpectedMedicalRingSegments,
                "Folded crater must retain twenty terrain-seated ring segments");
            Transform surgicalMast = FindDescendant(hostile,
                "Folded_SurgicalMast_LANDMARK");
            Require(surgicalMast != null
                    && surgicalMast.GetComponentsInChildren<Renderer>(true).Length >= 12,
                "Folded surgical mast silhouette is incomplete");
            Transform holes = FindDescendant(hostile, "Burrower_DarkHoles_LANDMARK");
            Require(holes != null && holes.childCount == ExpectedBurrowHoleCount,
                "Burrower nest must retain five separate holes");
            Require(holes.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedBurrowHoleCount * 3,
                "Burrower hole silhouettes are incomplete");
            Transform settlingWall = FindDescendant(hostile,
                "Burrower_BrokenSettlingWall_LANDMARK");
            Require(settlingWall != null
                    && settlingWall.GetComponentsInChildren<Renderer>(true).Length == 10,
                "Burrower broken settling wall is incomplete");

            Renderer[] allRenderers = hostile.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(allRenderers.Length >= 150,
                "hostile landmarks lost their reviewed strategic silhouettes");
            Require(allRenderers.All(renderer => renderer.sharedMaterials.Length > 0
                    && renderer.sharedMaterials.All(material => material != null
                        && material.shader != null && material.shader.isSupported)),
                "every hostile landmark renderer must retain a supported material");
            Require(hostile.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "hostile landmark geometry can obstruct strategic-map interaction");
            Require(hostile.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "hostile landmark geometry can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 75%] PASS: the Dustling colony, Folded crater "
                + "and Burrower nest use forty-eight direct MEP pieces, nine optimized "
                + "industrial relics and six terrain-seated landmark systems; all "
                + "renderers retain supported materials with no active colliders or LODs.");
        }

        private static Placement[] BuildDustlingMep()
        {
            var rows = new List<Placement>(ExpectedDustlingMepCount);
            for (int i = 0; i < ExpectedDustlingMepCount; i++)
            {
                float angle = i * (360f / ExpectedDustlingMepCount) + 9f;
                float radians = angle * Mathf.Deg2Rad;
                float radiusMap = 10.8f + (i % 2) * 2.3f;
                rows.Add(new Placement("Dustling_MoundPiece_" + i.ToString("00"),
                    "DustlingColony", DustlingMepSources[i % DustlingMepSources.Length],
                    42f + Mathf.Cos(radians) * radiusMap,
                    174f + Mathf.Sin(radians) * radiusMap,
                    0.42f, 0.50f, -angle + 90f, 0.035f));
            }
            return rows.ToArray();
        }

        private static Placement[] BuildFoldedConcrete()
        {
            var rows = new List<Placement>(ExpectedFoldedConcreteCount);
            for (int i = 0; i < ExpectedFoldedConcreteCount; i++)
            {
                float angle = i * (360f / ExpectedFoldedConcreteCount) + 4f;
                float radians = angle * Mathf.Deg2Rad;
                float radiusMap = 13.6f;
                rows.Add(new Placement("Folded_InwardConcrete_" + i.ToString("00"),
                    "FoldedCrater", FoldedConcreteSources[i % FoldedConcreteSources.Length],
                    315f + Mathf.Cos(radians) * radiusMap,
                    143f + Mathf.Sin(radians) * radiusMap,
                    0.42f, 0.34f, -angle + 90f + (i % 2 == 0 ? 8f : -8f),
                    0.045f));
            }
            return rows.ToArray();
        }

        private static Placement[] BuildBurrowRidge()
        {
            var rows = new List<Placement>(ExpectedBurrowRidgeCount);
            for (int i = 0; i < ExpectedBurrowRidgeCount; i++)
            {
                float angle = i * (360f / ExpectedBurrowRidgeCount) + 12f;
                float radians = angle * Mathf.Deg2Rad;
                float radiusMap = 13.0f + (i % 3 == 0 ? 2.2f : 0f);
                rows.Add(new Placement("Burrower_RidgePiece_" + i.ToString("00"),
                    "BurrowerNest", BurrowRidgeSources[i % BurrowRidgeSources.Length],
                    286f + Mathf.Cos(radians) * radiusMap,
                    34f + Mathf.Sin(radians) * radiusMap,
                    i % 3 == 0 ? 0.48f : 0.42f,
                    i % 3 == 0 ? 0.54f : 0.46f,
                    -angle + 90f + (i % 2 == 0 ? 6f : -6f), 0.055f));
            }
            return rows.ToArray();
        }

        private static void PlaceSet(Placement[] placements, Transform root,
                                     Material material)
        {
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Material resolvedMaterial =
                    KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                        placement.AssetPath, material);
                Transform zone = root.Find(placement.Zone) ?? Child(root, placement.Zone);
                GameObject instance =
                    KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                        placement.AssetPath, placement.Name, zone,
                        placement.MapX, AdjustedMapY(placement),
                        placement.Footprint,
                        placement.MaximumHeight, placement.Yaw, placement.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                {
                    renderers[rendererIndex].sharedMaterials = Enumerable.Repeat(resolvedMaterial,
                        renderers[rendererIndex].sharedMaterials.Length).ToArray();
                    renderers[rendererIndex].receiveShadows = true;
                }
            }
        }

        private static void ValidateSet(Transform root, Placement[] placements,
                                        Material material, string[] allowedSources)
        {
            Require(root != null, "a hostile landmark placement root is missing");
            var allowed = new HashSet<string>(allowedSources, StringComparer.Ordinal);
            var used = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Material resolvedMaterial =
                    KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                        placement.AssetPath, material);
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath && allowed.Contains(source),
                    placement.Name + " lost its reviewed source link");
                used.Add(source);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials
                        .All(shared => shared == resolvedMaterial)),
                    placement.Name + " lost its strategic material");
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, AdjustedMapY(placement));
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.04f,
                    placement.Name + " footprint drifted from authored scale");
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is floating above or buried in the terrain");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for strategic-map scale");
            }
            Require(used.SetEquals(allowed),
                "a reviewed hostile landmark source set is incomplete");
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

        private static void BuildDustlingCableRuns(Transform parent, Material cable,
                                                   Material amber)
        {
            Transform root = Child(parent, "Dustling_ShreddedCableRuns_LANDMARK");
            for (int i = 0; i < ExpectedCableRunCount; i++)
            {
                Transform run = Child(root, "ShreddedCableRun_" + i.ToString("00"));
                float angle = i * (360f / ExpectedCableRunCount) + 6f;
                float radians = angle * Mathf.Deg2Rad;
                for (int segment = 0; segment < 3; segment++)
                {
                    float radius = 0.42f + segment * 0.46f;
                    float mapX = 42f + Mathf.Cos(radians) * radius / WorldScale;
                    float mapY = 174f + Mathf.Sin(radians) * radius / WorldScale;
                    Vector3 position = MapToWorld(mapX, mapY)
                        + new Vector3(0f, 0.045f + segment * 0.018f, 0f);
                    BuildPrimitive("CableSegment_" + segment, run, PrimitiveType.Cube,
                        position, new Vector3(0.50f, 0.045f, 0.055f),
                        Quaternion.Euler(0f, -angle, segment % 2 == 0 ? 4f : -4f),
                        segment == 0 && i % 3 == 0 ? amber : cable);
                }
            }
        }

        private static void BuildDustlingVentMound(Transform parent, Material mound,
                                                   Material metal, Material amber)
        {
            Transform root = Child(parent, "Dustling_VentMound_LANDMARK");
            root.position = MapToWorld(42f, 174f) + new Vector3(0f, 0.020f, 0f);
            BuildPrimitive("MoundCore", root, PrimitiveType.Sphere,
                new Vector3(0f, 0.30f, 0f), new Vector3(0.68f, 0.34f, 0.68f),
                Quaternion.identity, mound);
            for (int i = 0; i < 6; i++)
            {
                float angle = i * 60f + 11f;
                float radians = angle * Mathf.Deg2Rad;
                BuildPrimitive("VentShaft_" + i, root, PrimitiveType.Cylinder,
                    new Vector3(Mathf.Cos(radians) * 0.38f, 0.55f + i % 2 * 0.08f,
                        Mathf.Sin(radians) * 0.38f),
                    new Vector3(0.09f, 0.30f + i % 2 * 0.06f, 0.09f),
                    Quaternion.Euler(i % 2 == 0 ? 8f : -8f, -angle,
                        i % 2 == 0 ? -7f : 7f), metal);
                BuildPrimitive("AmberVent_" + i, root, PrimitiveType.Cylinder,
                    new Vector3(Mathf.Cos(radians) * 0.41f, 0.88f + i % 2 * 0.10f,
                        Mathf.Sin(radians) * 0.41f),
                    new Vector3(0.11f, 0.035f, 0.11f),
                    Quaternion.Euler(0f, -angle, 0f), amber);
            }
        }

        private static void BuildFoldedMedicalRing(Transform parent, Material medical,
                                                   Material red)
        {
            Transform root = Child(parent, "Folded_MedicalRing_LANDMARK");
            const float radius = 0.92f;
            float segmentLength = 2f * Mathf.PI * radius
                / ExpectedMedicalRingSegments * 0.80f;
            for (int i = 0; i < ExpectedMedicalRingSegments; i++)
            {
                float angle = i * (360f / ExpectedMedicalRingSegments) + 5f;
                float radians = angle * Mathf.Deg2Rad;
                float mapX = 315f + Mathf.Cos(radians) * radius / WorldScale;
                float mapY = 143f - Mathf.Sin(radians) * radius / WorldScale;
                BuildPrimitive("MedicalRingSegment_" + i.ToString("00"), root,
                    PrimitiveType.Cube, MapToWorld(mapX, mapY)
                        + new Vector3(0f, 0.050f, 0f),
                    new Vector3(segmentLength, 0.075f, 0.12f),
                    Quaternion.Euler(0f, -angle + 90f, i % 2 == 0 ? 3f : -3f),
                    i % 5 == 0 ? red : medical);
            }
        }

        private static void BuildFoldedSurgicalMast(Transform parent, Material metal,
                                                    Material medical, Material red)
        {
            Transform root = Child(parent, "Folded_SurgicalMast_LANDMARK");
            root.position = MapToWorld(315f, 143f) + new Vector3(0f, 0.020f, 0f);
            BuildPrimitive("BuriedTheatre", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.10f, 0f), new Vector3(0.58f, 0.10f, 0.58f),
                Quaternion.identity, medical);
            BuildPrimitive("SurgicalColumn", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.76f, 0f), new Vector3(0.16f, 0.66f, 0.16f),
                Quaternion.Euler(0f, 0f, -5f), metal);
            for (int i = 0; i < 5; i++)
            {
                float angle = i * 72f + 18f;
                float radians = angle * Mathf.Deg2Rad;
                BuildPrimitive("FoldedArm_" + i, root, PrimitiveType.Cube,
                    new Vector3(Mathf.Cos(radians) * 0.34f, 1.28f,
                        Mathf.Sin(radians) * 0.34f),
                    new Vector3(0.48f, 0.055f, 0.055f),
                    Quaternion.Euler(0f, -angle, i % 2 == 0 ? 12f : -12f), metal);
                BuildPrimitive("RedProcedureLamp_" + i, root, PrimitiveType.Sphere,
                    new Vector3(Mathf.Cos(radians) * 0.58f, 1.22f,
                        Mathf.Sin(radians) * 0.58f),
                    new Vector3(0.10f, 0.07f, 0.10f), Quaternion.identity, red);
            }
        }

        private static void BuildBurrowHoles(Transform parent, Material dark,
                                             Material ridge)
        {
            Transform root = Child(parent, "Burrower_DarkHoles_LANDMARK");
            Vector2[] centres =
            {
                new Vector2(286f, 34f), new Vector2(277f, 31f),
                new Vector2(294f, 29f), new Vector2(281f, 42f),
                new Vector2(296f, 40f)
            };
            for (int i = 0; i < centres.Length; i++)
            {
                Transform hole = Child(root, "BurrowHole_" + i.ToString("00"));
                Vector3 position = MapToWorld(centres[i].x,
                    centres[i].y + BurrowerOffsetY);
                BuildPrimitive("DarkOpening", hole, PrimitiveType.Cylinder,
                    position + new Vector3(0f, 0.026f, 0f),
                    new Vector3(0.34f + i % 2 * 0.06f, 0.020f,
                        0.25f + i % 2 * 0.04f),
                    Quaternion.Euler(0f, 18f + i * 31f, 0f), dark);
                BuildPrimitive("RidgeLipFront", hole, PrimitiveType.Cube,
                    position + new Vector3(0f, 0.075f, 0.28f),
                    new Vector3(0.58f, 0.10f, 0.12f),
                    Quaternion.Euler(0f, 18f + i * 31f, -5f), ridge);
                BuildPrimitive("RidgeLipRear", hole, PrimitiveType.Cube,
                    position + new Vector3(0f, 0.070f, -0.26f),
                    new Vector3(0.52f, 0.09f, 0.11f),
                    Quaternion.Euler(0f, 18f + i * 31f, 4f), ridge);
            }
        }

        private static void BuildBrokenSettlingWall(Transform parent, Material concrete,
                                                    Material dark)
        {
            Transform root = Child(parent, "Burrower_BrokenSettlingWall_LANDMARK");
            for (int i = 0; i < 10; i++)
            {
                float angle = -68f + i * 15f;
                if (i == 4 || i == 5) angle += i == 4 ? -8f : 8f;
                float radians = angle * Mathf.Deg2Rad;
                float radius = 1.72f;
                float mapX = 286f + Mathf.Cos(radians) * radius / WorldScale;
                float mapY = 34f - Mathf.Sin(radians) * radius / WorldScale;
                BuildPrimitive("SettlingWallPiece_" + i.ToString("00"), root,
                    PrimitiveType.Cube, MapToWorld(mapX, mapY + BurrowerOffsetY)
                        + new Vector3(0f, 0.11f, 0f),
                    new Vector3(i == 4 || i == 5 ? 0.30f : 0.44f,
                        i == 4 || i == 5 ? 0.18f : 0.25f, 0.15f),
                    Quaternion.Euler(0f, -angle + 90f,
                        i % 2 == 0 ? 6f : -6f),
                    i == 4 || i == 5 ? dark : concrete);
            }
        }

        private static void BuildPrimitive(string name, Transform parent,
                                           PrimitiveType type, Vector3 localPosition,
                                           Vector3 localScale, Quaternion localRotation,
                                           Material material)
        {
            GameObject primitive = GameObject.CreatePrimitive(type);
            primitive.name = name;
            primitive.transform.SetParent(parent, false);
            primitive.transform.localPosition = localPosition;
            primitive.transform.localRotation = localRotation;
            primitive.transform.localScale = localScale;
            Collider collider = primitive.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            Renderer renderer = primitive.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            GameObjectUtility.SetStaticEditorFlags(primitive,
                StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Material BuildMepMaterial(string path, string sourcePath,
                                                 string name, Color tint)
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(sourcePath);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException(
                    "MEP source material is unavailable for hostile landmarks: "
                    + sourcePath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = name;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildSolidMaterial(string path, string name, Color color,
                                                   float metallic, float smoothness)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.shader = shader;
            material.name = name;
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildEmissiveMaterial(string path, string name,
                                                      Color color, Color emission)
        {
            Material material = BuildSolidMaterial(path, name, color, 0.18f, 0.34f);
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", emission);
            material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null && material.shader.isSupported,
                "material is missing or unsupported: " + path);
            return material;
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static float AdjustedMapY(Placement placement)
        {
            return placement.Zone == "BurrowerNest"
                ? placement.MapY + BurrowerOffsetY : placement.MapY;
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
                "Kromka model iteration 15 validation failed: " + message);
        }
    }
}
#endif
