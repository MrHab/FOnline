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
    /// Environment-model iteration 16/20. The last uncovered named node,
    /// Gloom Detour, becomes a readable Silent Ring border outpost with a
    /// defence tower, broken MEP perimeter, buried service pipes and exposed
    /// seams of subsurface fire.
    /// </summary>
    internal static class KromkaGlobalMapSilentRingOutpostAuthoring
    {
        internal const int ModelIteration = 16;
        internal const int ModelIterationCount = 20;
        private const int ExpectedFortificationCount = 18;
        private const int ExpectedPipeCount = 8;
        private const int ExpectedStructureCount = 6;
        private const int ExpectedFireVentCount = 5;
        private const int ExpectedSignalPylonCount = 6;
        private const float GloomMapX = 78f;
        private const float GloomMapY = 65f;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string MepBuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepCaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";
        private const string SpaceRoot =
            "Assets/ThirdParty/Kenney/SpaceKit10/Models/";
        private const string FactoryRoot =
            "Assets/ThirdParty/Kenney/FactoryKit30/Models/";
        private const string CityRoot =
            "Assets/ThirdParty/Kenney/CityKitIndustrial20/Models/";
        private const string MepBuildingSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string MepCaveSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Cave/Materials/MEP_CaveWall_Dif.mat";

        private const string FortificationMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_Fortifications_MEP.mat";
        private const string PipeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_Pipes_MEP.mat";
        private const string StructureMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_Structures.mat";
        private const string ConcreteMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_Concrete.mat";
        private const string SteelMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_Steel.mat";
        private const string DarkMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_BurntGround.mat";
        private const string FireMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_SubsurfaceFire.mat";
        private const string WarningMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_Warning.mat";
        private const string SearchlightMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_SilentOutpost_Searchlight.mat";

        private static readonly string[] FortificationSources =
        {
            MepBuildingRoot + "MEP_Wall_01_N.prefab",
            MepBuildingRoot + "MEP_Wall_02_N.prefab",
            MepBuildingRoot + "MEP_Wall_03_N.prefab",
            MepBuildingRoot + "MEP_Wall_04_N.prefab",
            MepBuildingRoot + "MEP_StoneWall_01_N.prefab",
            MepBuildingRoot + "MEP_StoneWall_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_01_N.prefab",
            MepBuildingRoot + "MEP_Fence_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_03_N.prefab"
        };

        private static readonly string[] PipeSources =
        {
            MepCaveRoot + "MEP_C_Pipe_01_N.prefab",
            MepCaveRoot + "MEP_C_Pipe_02_N.prefab"
        };

        private static readonly string[] StructureSources =
        {
            SpaceRoot + "structure_closed.fbx",
            SpaceRoot + "machine_generatorLarge.fbx",
            SpaceRoot + "satelliteDish_detailed.fbx",
            FactoryRoot + "structure-tall.fbx",
            FactoryRoot + "hopper-high-square.fbx",
            CityRoot + "water-tower.fbx"
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

        private static readonly Placement[] Fortifications = BuildFortifications();
        private static readonly Placement[] Pipes = BuildPipes();
        private static readonly Placement[] Structures =
        {
            new Placement("Gloom_CommandBunker", StructureSources[0],
                78f, 77f, 0.62f, 0.54f, 2f, 0.030f),
            new Placement("Gloom_ReserveGenerator", StructureSources[1],
                66f, 68f, 0.52f, 0.46f, 78f, 0.022f),
            new Placement("Gloom_DeafDish", StructureSources[2],
                90f, 76f, 0.52f, 0.62f, -28f, 0.022f),
            new Placement("Gloom_ServiceFrame", StructureSources[3],
                65f, 56f, 0.48f, 0.72f, 12f, 0.022f),
            new Placement("Gloom_AshHopper", StructureSources[4],
                90f, 64f, 0.50f, 0.66f, -12f, 0.022f),
            new Placement("Gloom_DeadWaterTower", StructureSources[5],
                90f, 53f, 0.48f, 0.74f, 7f, 0.022f)
        };

        private static readonly Vector2[] FireVentCentres =
        {
            new Vector2(70f, 59f), new Vector2(96f, 47f),
            new Vector2(102f, 68f), new Vector2(63f, 86f),
            new Vector2(92f, 88f)
        };

        private static readonly Vector2[] SignalPylonCentres =
        {
            new Vector2(56f, 65f), new Vector2(65f, 49f),
            new Vector2(83f, 43f), new Vector2(101f, 57f),
            new Vector2(98f, 82f), new Vector2(72f, 87f)
        };

        internal static void Compose(Transform parent)
        {
            Material fortifications = BuildMepMaterial(FortificationMaterialPath,
                MepBuildingSourceMaterial, "Kromka_SilentOutpost_Fortifications_MEP",
                new Color(0.21f, 0.22f, 0.18f, 1f));
            Material pipes = BuildMepMaterial(PipeMaterialPath,
                MepCaveSourceMaterial, "Kromka_SilentOutpost_Pipes_MEP",
                new Color(0.19f, 0.17f, 0.13f, 1f));
            Material structures = BuildSolidMaterial(StructureMaterialPath,
                "Kromka_SilentOutpost_Structures",
                new Color(0.18f, 0.21f, 0.18f, 1f), 0.34f, 0.20f);
            Material concrete = BuildSolidMaterial(ConcreteMaterialPath,
                "Kromka_SilentOutpost_Concrete",
                new Color(0.29f, 0.30f, 0.25f, 1f), 0.08f, 0.18f);
            Material steel = BuildSolidMaterial(SteelMaterialPath,
                "Kromka_SilentOutpost_Steel",
                new Color(0.12f, 0.14f, 0.13f, 1f), 0.52f, 0.26f);
            Material dark = BuildSolidMaterial(DarkMaterialPath,
                "Kromka_SilentOutpost_BurntGround",
                new Color(0.025f, 0.022f, 0.018f, 1f), 0.02f, 0.12f);
            Material fire = BuildEmissiveMaterial(FireMaterialPath,
                "Kromka_SilentOutpost_SubsurfaceFire",
                new Color(0.42f, 0.075f, 0.008f, 1f),
                new Color(2.8f, 0.34f, 0.025f, 1f));
            Material warning = BuildEmissiveMaterial(WarningMaterialPath,
                "Kromka_SilentOutpost_Warning",
                new Color(0.32f, 0.018f, 0.010f, 1f),
                new Color(1.20f, 0.035f, 0.012f, 1f));
            Material searchlight = BuildEmissiveMaterial(SearchlightMaterialPath,
                "Kromka_SilentOutpost_Searchlight",
                new Color(0.55f, 0.49f, 0.31f, 1f),
                new Color(2.2f, 1.35f, 0.52f, 1f));

            Transform root = Child(parent, "SilentRing_GloomDetour_ModelPass16_MEP_Kenney");
            PlaceSet(Fortifications,
                Child(root, "GloomDetour_DirectMEPPerimeter_EDITABLE"), fortifications);
            PlaceSet(Pipes, Child(root, "GloomDetour_DirectMEPBuriedPipes_EDITABLE"),
                pipes);
            PlaceSet(Structures, Child(root, "GloomDetour_IndustrialRelics_EDITABLE"),
                structures);
            BuildDefenceTower(root, concrete, steel, warning, searchlight);
            BuildSubsurfaceFire(root, dark, fire, steel);
            BuildSignalPylons(root, steel, warning);

            Child(parent, "GloomDetourNamedNode_1_REFERENCE");
            Child(parent, "GloomDetourDirectMEPPerimeter_18_REFERENCE");
            Child(parent, "GloomDetourDirectMEPBuriedPipes_8_REFERENCE");
            Child(parent, "GloomDetourIndustrialRelics_6_REFERENCE");
            Child(parent, "GloomDetourDefenceTower_1_REFERENCE");
            Child(parent, "GloomDetourSubsurfaceFireVents_5_REFERENCE");
            Child(parent, "GloomDetourSignalPylons_6_REFERENCE");
            Child(parent, "TerrainSeatedGloomDetour_REFERENCE");
            Child(parent, "PersistentSilentRingGeometry_REFERENCE");
            Child(parent, "ModelIteration_16_of_20");
        }

        internal static void ValidateIteration16()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 16 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "GloomDetourNamedNode_1_REFERENCE",
                "GloomDetourDirectMEPPerimeter_18_REFERENCE",
                "GloomDetourDirectMEPBuriedPipes_8_REFERENCE",
                "GloomDetourIndustrialRelics_6_REFERENCE",
                "GloomDetourDefenceTower_1_REFERENCE",
                "GloomDetourSubsurfaceFireVents_5_REFERENCE",
                "GloomDetourSignalPylons_6_REFERENCE",
                "TerrainSeatedGloomDetour_REFERENCE",
                "PersistentSilentRingGeometry_REFERENCE",
                "ModelIteration_16_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");

            Require(Fortifications.Length == ExpectedFortificationCount,
                "eighteen broken-perimeter MEP pieces are required");
            Require(Pipes.Length == ExpectedPipeCount,
                "eight buried MEP pipes are required");
            Require(Structures.Length == ExpectedStructureCount,
                "six industrial relics are required");

            Transform outpost = FindDescendant(root,
                "SilentRing_GloomDetour_ModelPass16_MEP_Kenney");
            Require(outpost != null, "Gloom Detour hierarchy is missing");
            ValidateSet(FindDescendant(outpost,
                    "GloomDetour_DirectMEPPerimeter_EDITABLE"),
                Fortifications, RequireMaterial(FortificationMaterialPath),
                FortificationSources, "Gloom Detour perimeter");
            ValidateSet(FindDescendant(outpost,
                    "GloomDetour_DirectMEPBuriedPipes_EDITABLE"),
                Pipes, RequireMaterial(PipeMaterialPath), PipeSources,
                "Gloom Detour buried pipes");
            ValidateSet(FindDescendant(outpost,
                    "GloomDetour_IndustrialRelics_EDITABLE"),
                Structures, RequireMaterial(StructureMaterialPath), StructureSources,
                "Gloom Detour industrial relics");

            Transform tower = FindDescendant(outpost,
                "GloomDetour_DefenceTower_LANDMARK");
            Require(tower != null, "Gloom Detour defence tower is missing");
            Renderer[] towerRenderers = tower.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(towerRenderers.Length >= 32,
                "Gloom Detour defence tower silhouette is incomplete");
            Bounds towerBounds = Encapsulate(towerRenderers);
            float towerTerrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                GloomMapX, GloomMapY);
            Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                    GloomMapX, GloomMapY, 0.10f),
                "Gloom Detour defence tower is outside the visible landmass");
            // A four-legged tower on a slope has four distinct footing levels;
            // comparing its entire bounds to one central sample is incorrect.
            for (int i = 0; i < 4; i++)
            {
                Bounds foot = tower.Find("FootBlock_" + i).GetComponent<Renderer>().bounds;
                Bounds leg = tower.Find("TowerLeg_" + i).GetComponent<Renderer>().bounds;
                float ground = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    190f + foot.center.x * 10f, 150f - foot.center.z * 10f);
                Require(Mathf.Abs(foot.min.y - (ground - .012f)) < .006f,
                    "Gloom tower footing " + i + " is not grounded");
                Require(leg.min.y <= foot.max.y && leg.max.y >= tower.position.y + 1.12f,
                    "Gloom tower leg " + i + " is detached from its footing/platform");
            }
            Require(towerBounds.size.y >= 2.0f && towerBounds.size.y <= 2.35f,
                "Gloom Detour defence tower lost its strategic silhouette");

            Transform fireField = FindDescendant(outpost,
                "GloomDetour_SubsurfaceFire_LANDMARK");
            Require(fireField != null && fireField.childCount == ExpectedFireVentCount,
                "Gloom Detour must retain five separate subsurface-fire vents");
            Require(fireField.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedFireVentCount * 8,
                "subsurface-fire crack geometry is incomplete");
            for (int i = 0; i < FireVentCentres.Length; i++)
            {
                Transform vent = fireField.Find("SubsurfaceFireVent_" + i.ToString("00"));
                Require(vent != null, "a subsurface-fire vent is missing");
                Renderer[] renderers = vent.GetComponentsInChildren<Renderer>(true);
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    FireVentCentres[i].x, FireVentCentres[i].y);
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        FireVentCentres[i].x, FireVentCentres[i].y, 0.015f),
                    vent.name + " is outside the visible landmass");
                foreach (Renderer part in renderers.Where(r => r.name.StartsWith("FireCrack_", StringComparison.Ordinal)))
                {
                    Bounds b = part.bounds;
                    float low = new[] { b.center, new Vector3(b.min.x, 0f, b.min.z),
                        new Vector3(b.min.x, 0f, b.max.z), new Vector3(b.max.x, 0f, b.min.z),
                        new Vector3(b.max.x, 0f, b.max.z) }.Min(p =>
                        KromkaGlobalMapReliefAuthoring.HeightAtMap(190f + p.x * 10f, 150f - p.z * 10f));
                    Require(Mathf.Abs(b.min.y - (low - .009f)) < .006f,
                        vent.name + "/" + part.name + " is detached from the ground");
                }
            }

            Transform pylons = FindDescendant(outpost,
                "GloomDetour_SignalPylons_LANDMARK");
            Require(pylons != null && pylons.childCount == ExpectedSignalPylonCount,
                "Gloom Detour must retain six warning pylons");
            Require(pylons.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedSignalPylonCount * 6,
                "warning-pylon silhouettes are incomplete");
            for (int i = 0; i < SignalPylonCentres.Length; i++)
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        SignalPylonCentres[i].x, SignalPylonCentres[i].y, 0.015f),
                    "a warning pylon is outside the visible landmass");

            Renderer[] allRenderers = outpost.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(allRenderers.Length >= 125,
                "Gloom Detour lost its reviewed strategic silhouettes");
            Require(allRenderers.All(renderer => renderer.sharedMaterials.Length > 0
                    && renderer.sharedMaterials.All(material => material != null
                        && material.shader != null && material.shader.isSupported)),
                "every Gloom Detour renderer must retain a supported material");
            Require(outpost.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Gloom Detour geometry can obstruct strategic-map interaction");
            Require(outpost.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Gloom Detour geometry can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 80%] PASS: Gloom Detour uses eighteen "
                + "direct MEP perimeter pieces, eight direct MEP buried pipes, six "
                + "optimized industrial relics, a terrain-seated defence tower, five "
                + "subsurface-fire vents and six persistent warning pylons.");
        }

        private static Placement[] BuildFortifications()
        {
            var rows = new List<Placement>(ExpectedFortificationCount);
            for (int i = 0; i < ExpectedFortificationCount; i++)
            {
                float angle = i * (360f / ExpectedFortificationCount) + 7f;
                float radians = angle * Mathf.Deg2Rad;
                float radiusMap = 18.5f + (i % 3 == 0 ? 1.0f : 0f);
                rows.Add(new Placement("Gloom_PerimeterPiece_" + i.ToString("00"),
                    FortificationSources[i % FortificationSources.Length],
                    GloomMapX + Mathf.Cos(radians) * radiusMap,
                    GloomMapY + Mathf.Sin(radians) * radiusMap,
                    i % 3 == 0 ? 0.48f : 0.43f,
                    i % 3 == 0 ? 0.31f : 0.27f,
                    -angle + 90f + (i % 2 == 0 ? 6f : -6f),
                    i < 6 ? 0.030f : 0.020f));
            }
            return rows.ToArray();
        }

        private static Placement[] BuildPipes()
        {
            var rows = new List<Placement>(ExpectedPipeCount);
            for (int i = 0; i < ExpectedPipeCount; i++)
            {
                float angle = i * 45f + 22.5f;
                float radians = angle * Mathf.Deg2Rad;
                float radiusMap = 8.0f;
                rows.Add(new Placement("Gloom_BuriedPipe_" + i.ToString("00"),
                    PipeSources[i % PipeSources.Length],
                    GloomMapX + Mathf.Cos(radians) * radiusMap,
                    GloomMapY + Mathf.Sin(radians) * radiusMap,
                    0.36f, 0.24f, -angle + 90f, 0.080f));
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
                GameObject instance =
                    KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                        placement.AssetPath, placement.Name, root,
                        placement.MapX, placement.MapY, placement.Footprint,
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
                                        Material material, string[] allowedSources,
                                        string label)
        {
            Require(root != null, label + " root is missing");
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
                    placement.MapX, placement.MapY);
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        placement.MapX, placement.MapY, 0.015f),
                    placement.Name + " is outside the visible landmass");
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.04f,
                    placement.Name + " footprint drifted from authored scale");
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is floating above or buried in the terrain");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for strategic-map scale");
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

        private static void BuildDefenceTower(Transform parent, Material concrete,
                                              Material steel, Material warning,
                                              Material searchlight)
        {
            Transform root = Child(parent, "GloomDetour_DefenceTower_LANDMARK");
            root.position = MapToWorld(GloomMapX, GloomMapY)
                + new Vector3(0f, 0.015f, 0f);
            BuildPrimitive("TowerFooting", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.10f, 0f), new Vector3(0.58f, 0.10f, 0.58f),
                Quaternion.identity, concrete);
            for (int i = 0; i < 4; i++)
            {
                float x = i % 2 == 0 ? -0.33f : 0.33f;
                float z = i < 2 ? -0.33f : 0.33f;
                BuildPrimitive("TowerLeg_" + i, root, PrimitiveType.Cube,
                    new Vector3(x, 0.66f, z), new Vector3(0.085f, 0.57f, 0.085f),
                    Quaternion.Euler(z > 0f ? 3f : -3f, 0f, x > 0f ? -3f : 3f),
                    steel);
                BuildPrimitive("FootBlock_" + i, root, PrimitiveType.Cube,
                    new Vector3(x, 0.12f, z), new Vector3(0.16f, 0.11f, 0.16f),
                    Quaternion.identity, concrete);
                BuildPrimitive("DiagonalBrace_" + i, root, PrimitiveType.Cube,
                    new Vector3(x * 0.55f, 0.65f, z),
                    new Vector3(0.055f, 0.46f, 0.055f),
                    Quaternion.Euler(x * z > 0f ? 28f : -28f, 0f,
                        x > 0f ? 21f : -21f), steel);
            }
            BuildPrimitive("LowerPlatform", root, PrimitiveType.Cylinder,
                new Vector3(0f, 1.19f, 0f), new Vector3(0.52f, 0.07f, 0.52f),
                Quaternion.identity, steel);
            BuildPrimitive("WatchCabin", root, PrimitiveType.Cube,
                new Vector3(0f, 1.42f, 0f), new Vector3(0.48f, 0.22f, 0.48f),
                Quaternion.Euler(0f, 7f, 0f), concrete);
            for (int side = 0; side < 4; side++)
            {
                float angle = side * 90f + 7f;
                float radians = angle * Mathf.Deg2Rad;
                BuildPrimitive("CabinWindow_" + side, root, PrimitiveType.Cube,
                    new Vector3(Mathf.Sin(radians) * 0.49f, 1.45f,
                        Mathf.Cos(radians) * 0.49f),
                    new Vector3(side % 2 == 0 ? 0.34f : 0.025f, 0.075f,
                        side % 2 == 0 ? 0.025f : 0.34f),
                    Quaternion.Euler(0f, 7f, 0f), searchlight);
            }
            BuildPrimitive("CabinRoof", root, PrimitiveType.Cylinder,
                new Vector3(0f, 1.69f, 0f), new Vector3(0.56f, 0.07f, 0.56f),
                Quaternion.identity, steel);
            for (int side = 0; side < 4; side++)
            {
                float angle = side * 90f;
                float radians = angle * Mathf.Deg2Rad;
                BuildPrimitive("PlatformRail_" + side, root, PrimitiveType.Cube,
                    new Vector3(Mathf.Sin(radians) * 0.51f, 1.29f,
                        Mathf.Cos(radians) * 0.51f),
                    new Vector3(side % 2 == 0 ? 0.43f : 0.025f, 0.025f,
                        side % 2 == 0 ? 0.025f : 0.43f),
                    Quaternion.identity, steel);
            }
            BuildPrimitive("SignalMast", root, PrimitiveType.Cylinder,
                new Vector3(0f, 1.94f, 0f), new Vector3(0.055f, 0.23f, 0.055f),
                Quaternion.Euler(0f, 0f, -3f), steel);
            for (int i = 0; i < 4; i++)
            {
                float angle = i * 90f + 20f;
                float radians = angle * Mathf.Deg2Rad;
                BuildPrimitive("SearchlightArm_" + i, root, PrimitiveType.Cube,
                    new Vector3(Mathf.Sin(radians) * 0.43f, 1.77f,
                        Mathf.Cos(radians) * 0.43f),
                    new Vector3(i % 2 == 0 ? 0.38f : 0.055f, 0.045f,
                        i % 2 == 0 ? 0.055f : 0.38f),
                    Quaternion.Euler(0f, 20f, 0f), steel);
                BuildPrimitive("Searchlight_" + i, root, PrimitiveType.Sphere,
                    new Vector3(Mathf.Sin(radians) * 0.73f, 1.77f,
                        Mathf.Cos(radians) * 0.73f),
                    new Vector3(0.12f, 0.09f, 0.12f), Quaternion.identity,
                    searchlight);
            }
            BuildPrimitive("RedTowerBeacon", root, PrimitiveType.Sphere,
                new Vector3(0f, 2.19f, 0f), new Vector3(0.105f, 0.08f, 0.105f),
                Quaternion.identity, warning);
        }

        private static void BuildSubsurfaceFire(Transform parent, Material dark,
                                                Material fire, Material steel)
        {
            Transform root = Child(parent, "GloomDetour_SubsurfaceFire_LANDMARK");
            for (int i = 0; i < FireVentCentres.Length; i++)
            {
                Vector2 centre = FireVentCentres[i];
                Transform vent = Child(root, "SubsurfaceFireVent_" + i.ToString("00"));
                vent.position = MapToWorld(centre.x, centre.y)
                    + new Vector3(0f, 0.012f, 0f);
                BuildPrimitive("BurntMouth", vent, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.025f, 0f), new Vector3(0.30f, 0.025f, 0.23f),
                    Quaternion.Euler(0f, i * 23f, 0f), dark);
                BuildPrimitive("EmberCore", vent, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.050f, 0f), new Vector3(0.19f, 0.018f, 0.13f),
                    Quaternion.Euler(0f, i * 23f, 0f), fire);
                for (int crack = 0; crack < 5; crack++)
                {
                    float angle = crack * 72f + i * 19f;
                    float radians = angle * Mathf.Deg2Rad;
                    BuildPrimitive("FireCrack_" + crack, vent, PrimitiveType.Cube,
                        new Vector3(Mathf.Cos(radians) * 0.32f, 0.046f,
                            Mathf.Sin(radians) * 0.32f),
                        new Vector3(0.24f + (crack % 2) * 0.07f, 0.018f, 0.035f),
                        Quaternion.Euler(0f, -angle, crack % 2 == 0 ? 3f : -3f),
                        fire);
                }
                BuildPrimitive("HeatVent", vent, PrimitiveType.Cylinder,
                    new Vector3(0.18f, 0.16f, -0.10f),
                    new Vector3(0.055f, 0.14f, 0.055f),
                    Quaternion.Euler(i % 2 == 0 ? 8f : -8f, i * 31f,
                        i % 2 == 0 ? -6f : 6f), steel);
            }
        }

        private static void BuildSignalPylons(Transform parent, Material steel,
                                              Material warning)
        {
            Transform root = Child(parent, "GloomDetour_SignalPylons_LANDMARK");
            for (int i = 0; i < SignalPylonCentres.Length; i++)
            {
                Vector2 centre = SignalPylonCentres[i];
                Transform pylon = Child(root, "SilentWarningPylon_" + i.ToString("00"));
                pylon.position = MapToWorld(centre.x, centre.y)
                    + new Vector3(0f, 0.010f, 0f);
                BuildPrimitive("Foot", pylon, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.065f, 0f), new Vector3(0.16f, 0.065f, 0.16f),
                    Quaternion.identity, steel);
                BuildPrimitive("Mast", pylon, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.53f, 0f), new Vector3(0.045f, 0.43f, 0.045f),
                    Quaternion.Euler(0f, 0f, i % 2 == 0 ? -4f : 4f), steel);
                BuildPrimitive("Crossbar", pylon, PrimitiveType.Cube,
                    new Vector3(0f, 0.83f, 0f), new Vector3(0.28f, 0.035f, 0.035f),
                    Quaternion.Euler(0f, i * 17f, 0f), steel);
                BuildPrimitive("MarkerLeft", pylon, PrimitiveType.Cube,
                    new Vector3(-0.25f, 0.83f, 0f), new Vector3(0.07f, 0.09f, 0.025f),
                    Quaternion.Euler(0f, i * 17f, 0f), warning);
                BuildPrimitive("MarkerRight", pylon, PrimitiveType.Cube,
                    new Vector3(0.25f, 0.83f, 0f), new Vector3(0.07f, 0.09f, 0.025f),
                    Quaternion.Euler(0f, i * 17f, 0f), warning);
                BuildPrimitive("Beacon", pylon, PrimitiveType.Sphere,
                    new Vector3(0f, 1.01f, 0f), new Vector3(0.075f, 0.055f, 0.075f),
                    Quaternion.identity, warning);
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
                    "MEP source material is unavailable for Gloom Detour: "
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
            Material material = BuildSolidMaterial(path, name, color, 0.20f, 0.28f);
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
                "Kromka model iteration 16 validation failed: " + message);
        }
    }
}
#endif
