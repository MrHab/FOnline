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
    /// Environment-model iteration 19/20. A broken Soviet-style transmission
    /// corridor crosses the Glasslands and southern industrial approaches. The
    /// lattice pylons, sagging conductors and two compact switching yards restore
    /// the long infrastructure rhythm visible in the approved map reference.
    /// </summary>
    internal static class KromkaGlobalMapPowerCorridorAuthoring
    {
        internal const int ModelIteration = 19;
        internal const int ModelIterationCount = 20;
        private const int ExpectedPylonCount = 8;
        private const int ExpectedFenceCount = 16;
        private const int ExpectedEquipmentCount = 4;
        private const int ExpectedSwitchyardCount = 2;
        private const int SwitchBaysPerYard = 3;
        private const int PylonRendererCount = 22;
        private const int SwitchBayRendererCount = 7;
        private const int CablePhaseCount = 3;
        private const int CableSamplesPerSpan = 6;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string BuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepBuildingSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string SpaceRoot =
            "Assets/ThirdParty/Kenney/SpaceKit10/Models/";
        private const string FenceMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_PowerCorridor_Fences_MEP.mat";
        private const string EquipmentMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_PowerCorridor_Equipment.mat";
        private const string SteelMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_PowerCorridor_OxidizedSteel.mat";
        private const string ConcreteMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_PowerCorridor_Concrete.mat";
        private const string PorcelainMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_PowerCorridor_Porcelain.mat";
        private const string CableMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_PowerCorridor_Cables.mat";
        private const string WarningMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_PowerCorridor_Warning.mat";

        private static readonly string[] FenceSources =
        {
            BuildingRoot + "MEP_Fence_01_N.prefab",
            BuildingRoot + "MEP_Fence_02_N.prefab",
            BuildingRoot + "MEP_Fence_03_N.prefab"
        };

        private static readonly string[] EquipmentSources =
        {
            SpaceRoot + "machine_generatorLarge.fbx",
            SpaceRoot + "machine_generator.fbx"
        };

        private readonly struct Pylon
        {
            public readonly string Name;
            public readonly float MapX;
            public readonly float MapY;

            public Pylon(string name, float mapX, float mapY)
            {
                Name = name;
                MapX = mapX;
                MapY = mapY;
            }
        }

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string Yard;
            public readonly string AssetPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string yard, string assetPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed)
            {
                Name = name;
                Yard = yard;
                AssetPath = assetPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private readonly struct Switchyard
        {
            public readonly string Name;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Yaw;

            public Switchyard(string name, float mapX, float mapY, float yaw)
            {
                Name = name;
                MapX = mapX;
                MapY = mapY;
                Yaw = yaw;
            }
        }

        private static readonly Pylon[] Pylons =
        {
            new Pylon("NorthGlass_Pylon_00", 292f, 68f),
            new Pylon("NorthGlass_Pylon_01", 305f, 93f),
            new Pylon("GlassSpine_Pylon_02", 306f, 121f),
            new Pylon("GlassSwitch_Pylon_03", 294f, 147f),
            new Pylon("EastMiddle_Pylon_04", 286f, 174f),
            new Pylon("SouthApproach_Pylon_05", 285f, 202f),
            new Pylon("ShoreTransfer_Pylon_06", 292f, 229f),
            new Pylon("SouthSilent_Pylon_07", 275f, 248f)
        };

        private static readonly Switchyard[] Switchyards =
        {
            new Switchyard("GlassSwitchyard", 264f, 143f, -8f),
            new Switchyard("SouthTransferYard", 270f, 218f, 11f)
        };

        private static readonly Placement[] Fences =
        {
            new Placement("GlassFence_N0", "GlassSwitchyard", FenceSources[0], 257f, 136f, 0.40f, 0.28f, 0f, 0.025f),
            new Placement("GlassFence_N1", "GlassSwitchyard", FenceSources[1], 264f, 136f, 0.40f, 0.28f, 0f, 0.025f),
            new Placement("GlassFence_N2", "GlassSwitchyard", FenceSources[2], 271f, 136f, 0.40f, 0.28f, 0f, 0.025f),
            new Placement("GlassFence_S0", "GlassSwitchyard", FenceSources[2], 257f, 150f, 0.40f, 0.28f, 180f, 0.025f),
            new Placement("GlassFence_S1", "GlassSwitchyard", FenceSources[0], 264f, 150f, 0.40f, 0.28f, 180f, 0.025f),
            new Placement("GlassFence_S2", "GlassSwitchyard", FenceSources[1], 271f, 150f, 0.40f, 0.28f, 180f, 0.025f),
            new Placement("GlassFence_W", "GlassSwitchyard", FenceSources[1], 253.5f, 143f, 0.40f, 0.28f, 90f, 0.025f),
            new Placement("GlassFence_E", "GlassSwitchyard", FenceSources[2], 274.5f, 143f, 0.40f, 0.28f, 90f, 0.025f),
            new Placement("SouthFence_N0", "SouthTransferYard", FenceSources[0], 263f, 211f, 0.40f, 0.28f, 0f, 0.025f),
            new Placement("SouthFence_N1", "SouthTransferYard", FenceSources[1], 270f, 211f, 0.40f, 0.28f, 0f, 0.025f),
            new Placement("SouthFence_N2", "SouthTransferYard", FenceSources[2], 277f, 211f, 0.40f, 0.28f, 0f, 0.025f),
            new Placement("SouthFence_S0", "SouthTransferYard", FenceSources[2], 263f, 225f, 0.40f, 0.28f, 180f, 0.025f),
            new Placement("SouthFence_S1", "SouthTransferYard", FenceSources[0], 270f, 225f, 0.40f, 0.28f, 180f, 0.025f),
            new Placement("SouthFence_S2", "SouthTransferYard", FenceSources[1], 277f, 225f, 0.40f, 0.28f, 180f, 0.025f),
            new Placement("SouthFence_W", "SouthTransferYard", FenceSources[1], 259.5f, 218f, 0.40f, 0.28f, 90f, 0.025f),
            new Placement("SouthFence_E", "SouthTransferYard", FenceSources[2], 280.5f, 218f, 0.40f, 0.28f, 90f, 0.025f)
        };

        private static readonly Placement[] Equipment =
        {
            new Placement("GlassReserveGenerator", "GlassSwitchyard", EquipmentSources[0], 260f, 141f, 0.48f, 0.48f, -8f, 0.020f),
            new Placement("GlassExciter", "GlassSwitchyard", EquipmentSources[1], 268f, 141f, 0.42f, 0.42f, 172f, 0.020f),
            new Placement("SouthReserveGenerator", "SouthTransferYard", EquipmentSources[0], 266f, 216f, 0.48f, 0.48f, 11f, 0.020f),
            new Placement("SouthExciter", "SouthTransferYard", EquipmentSources[1], 274f, 216f, 0.42f, 0.42f, 191f, 0.020f)
        };

        internal static void Compose(Transform parent)
        {
            Material fences = BuildMepMaterial(FenceMaterialPath,
                "Kromka_PowerCorridor_Fences_MEP",
                new Color(0.25f, 0.25f, 0.21f, 1f));
            Material equipment = BuildSolidMaterial(EquipmentMaterialPath,
                "Kromka_PowerCorridor_Equipment",
                new Color(0.19f, 0.24f, 0.23f, 1f), 0.38f, 0.22f);
            Material steel = BuildSolidMaterial(SteelMaterialPath,
                "Kromka_PowerCorridor_OxidizedSteel",
                new Color(0.12f, 0.15f, 0.14f, 1f), 0.58f, 0.20f);
            Material concrete = BuildSolidMaterial(ConcreteMaterialPath,
                "Kromka_PowerCorridor_Concrete",
                new Color(0.37f, 0.36f, 0.31f, 1f), 0.04f, 0.16f);
            Material porcelain = BuildSolidMaterial(PorcelainMaterialPath,
                "Kromka_PowerCorridor_Porcelain",
                new Color(0.48f, 0.62f, 0.58f, 1f), 0.05f, 0.38f);
            Material cables = BuildSolidMaterial(CableMaterialPath,
                "Kromka_PowerCorridor_Cables",
                new Color(0.035f, 0.045f, 0.043f, 1f), 0.62f, 0.28f);
            Material warning = BuildEmissiveMaterial(WarningMaterialPath,
                "Kromka_PowerCorridor_Warning",
                new Color(0.31f, 0.040f, 0.010f, 1f),
                new Color(1.35f, 0.13f, 0.015f, 1f));

            Transform root = Child(parent,
                "SovietTransmissionCorridor_ModelPass19_MEP_Kenney");
            Transform yards = Child(root, "SwitchingYards_EDITABLE");
            PlaceSet(Fences, Child(yards, "DirectMEPSwitchyardFences_EDITABLE"),
                fences);
            PlaceSet(Equipment,
                Child(yards, "OptimizedSwitchyardEquipment_EDITABLE"), equipment);
            BuildPylons(Child(root, "LatticeTransmissionPylons_LANDMARKS"),
                steel, concrete, porcelain, warning);
            BuildCableRuns(Child(root, "SaggingTransmissionConductors_OPTIMIZED"),
                cables);
            BuildSwitchgear(Child(yards, "SwitchgearBays_LANDMARKS"),
                steel, concrete, porcelain, warning);

            Child(parent, "SovietTransmissionPylons_8_REFERENCE");
            Child(parent, "TransmissionCablePhases_3_REFERENCE");
            Child(parent, "DirectMEPSwitchyardFences_16_REFERENCE");
            Child(parent, "OptimizedSwitchyardEquipment_4_REFERENCE");
            Child(parent, "SwitchingYards_2_REFERENCE");
            Child(parent, "TerrainSeatedPowerInfrastructure_REFERENCE");
            Child(parent, "StaticBatchedPowerInfrastructure_REFERENCE");
            Child(parent, "PersistentPowerCorridorGeometry_REFERENCE");
            Child(parent, "ModelIteration_19_of_20");
        }

        internal static void ValidateIteration19()
        {
            GameObject rootObject = GameObject.Find(
                "EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 19 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "SovietTransmissionPylons_8_REFERENCE",
                "TransmissionCablePhases_3_REFERENCE",
                "DirectMEPSwitchyardFences_16_REFERENCE",
                "OptimizedSwitchyardEquipment_4_REFERENCE",
                "SwitchingYards_2_REFERENCE",
                "TerrainSeatedPowerInfrastructure_REFERENCE",
                "StaticBatchedPowerInfrastructure_REFERENCE",
                "PersistentPowerCorridorGeometry_REFERENCE",
                "ModelIteration_19_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");

            Require(Pylons.Length == ExpectedPylonCount,
                "eight transmission pylons are required");
            Require(Fences.Length == ExpectedFenceCount,
                "sixteen direct-MEP fence pieces are required");
            Require(Equipment.Length == ExpectedEquipmentCount,
                "four switching-yard equipment models are required");
            Require(Switchyards.Length == ExpectedSwitchyardCount,
                "two switching yards are required");

            Transform corridor = FindDescendant(root,
                "SovietTransmissionCorridor_ModelPass19_MEP_Kenney");
            Require(corridor != null, "transmission-corridor hierarchy is missing");
            ValidateSet(FindDescendant(corridor,
                    "DirectMEPSwitchyardFences_EDITABLE"),
                Fences, RequireMaterial(FenceMaterialPath), FenceSources,
                "switchyard fences");
            ValidateSet(FindDescendant(corridor,
                    "OptimizedSwitchyardEquipment_EDITABLE"),
                Equipment, RequireMaterial(EquipmentMaterialPath), EquipmentSources,
                "switchyard equipment");
            ValidatePylons(FindDescendant(corridor,
                "LatticeTransmissionPylons_LANDMARKS"));
            ValidateCables(FindDescendant(corridor,
                "SaggingTransmissionConductors_OPTIMIZED"));
            ValidateSwitchgear(FindDescendant(corridor,
                "SwitchgearBays_LANDMARKS"));

            Renderer[] allRenderers = corridor.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(allRenderers.Length >= ExpectedPylonCount * PylonRendererCount
                    + CablePhaseCount
                    + ExpectedSwitchyardCount * SwitchBaysPerYard
                        * SwitchBayRendererCount,
                "power corridor lost its reviewed strategic silhouettes");
            Require(allRenderers.All(renderer => renderer.sharedMaterials.Length > 0
                    && renderer.sharedMaterials.All(material => material != null
                        && material.shader != null && material.shader.isSupported)),
                "every power-corridor renderer must retain a supported material");
            Require(corridor.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "power infrastructure can obstruct strategic-map interaction");
            Require(corridor.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "power infrastructure can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 95%] PASS: eight terrain-seated Soviet-style "
                + "lattice pylons carry three optimized sagging conductor phases "
                + "past two switching yards with sixteen direct-MEP fence pieces, "
                + "four industrial equipment models and six switchgear bays.");
        }

        private static void BuildPylons(Transform root, Material steel,
                                        Material concrete, Material porcelain,
                                        Material warning)
        {
            for (int i = 0; i < Pylons.Length; i++)
            {
                Pylon pylon = Pylons[i];
                Transform group = Child(root, pylon.Name);
                Vector3 centre = MapToWorld(pylon.MapX, pylon.MapY);
                Quaternion rotation = PylonRotation(i);
                Vector3[] baseLocal =
                {
                    new Vector3(-0.28f, 0f, -0.14f),
                    new Vector3(0.28f, 0f, -0.14f),
                    new Vector3(-0.28f, 0f, 0.14f),
                    new Vector3(0.28f, 0f, 0.14f)
                };
                float[] baseHeights = new float[baseLocal.Length];
                for (int foot = 0; foot < baseLocal.Length; foot++)
                {
                    Vector3 position = centre + rotation * baseLocal[foot];
                    baseHeights[foot] = HeightAtWorld(position.x, position.z);
                    position.y = baseHeights[foot] + 0.035f;
                    BuildPrimitive("ConcreteFooting_" + foot, group,
                        PrimitiveType.Cube, position,
                        new Vector3(0.14f, 0.07f, 0.14f), rotation, concrete);
                }

                float structuralBase = baseHeights.Average();
                Vector3[] shoulderLocal =
                {
                    new Vector3(-0.10f, 0.82f, -0.045f),
                    new Vector3(0.10f, 0.82f, -0.045f),
                    new Vector3(-0.10f, 0.82f, 0.045f),
                    new Vector3(0.10f, 0.82f, 0.045f)
                };
                for (int leg = 0; leg < baseLocal.Length; leg++)
                {
                    Vector3 from = centre + rotation * baseLocal[leg];
                    from.y = baseHeights[leg] + 0.065f;
                    Vector3 to = centre + rotation * shoulderLocal[leg];
                    to.y = structuralBase + shoulderLocal[leg].y;
                    BuildBeam("LatticeLeg_" + leg, group, from, to, 0.050f,
                        steel);
                }

                Vector3[] braceStarts =
                {
                    new Vector3(-0.25f, 0.20f, -0.145f),
                    new Vector3(0.25f, 0.20f, -0.145f),
                    new Vector3(-0.25f, 0.20f, 0.145f),
                    new Vector3(0.25f, 0.20f, 0.145f)
                };
                Vector3[] braceEnds =
                {
                    new Vector3(0.10f, 0.70f, -0.050f),
                    new Vector3(-0.10f, 0.70f, -0.050f),
                    new Vector3(0.10f, 0.70f, 0.050f),
                    new Vector3(-0.10f, 0.70f, 0.050f)
                };
                for (int brace = 0; brace < braceStarts.Length; brace++)
                    BuildBeam("DiagonalBrace_" + brace, group,
                        PylonPoint(centre, rotation, structuralBase,
                            braceStarts[brace]),
                        PylonPoint(centre, rotation, structuralBase,
                            braceEnds[brace]), 0.028f, steel);

                BuildBeam("NeckLeft", group,
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(-0.07f, 0.78f, 0f)),
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(-0.07f, 1.20f, 0f)), 0.042f, steel);
                BuildBeam("NeckRight", group,
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0.07f, 0.78f, 0f)),
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0.07f, 1.20f, 0f)), 0.042f, steel);
                BuildBeam("LowerCrossarm", group,
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(-0.31f, 0.88f, 0f)),
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0.31f, 0.88f, 0f)), 0.055f, steel);
                BuildBeam("MainCrossarm", group,
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(-0.46f, 1.12f, 0f)),
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0.46f, 1.12f, 0f)), 0.060f, steel);
                BuildBeam("ApexLeft", group,
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(-0.07f, 1.17f, 0f)),
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0f, 1.47f, 0f)), 0.035f, steel);
                BuildBeam("ApexRight", group,
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0.07f, 1.17f, 0f)),
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0f, 1.47f, 0f)), 0.035f, steel);

                float[] phases = { -0.36f, 0f, 0.36f };
                for (int phase = 0; phase < phases.Length; phase++)
                    BuildPrimitive("PorcelainInsulator_" + phase, group,
                        PrimitiveType.Cylinder,
                        PylonPoint(centre, rotation, structuralBase,
                            new Vector3(phases[phase], 1.025f, 0f)),
                        new Vector3(0.032f, 0.070f, 0.032f),
                        Quaternion.identity, porcelain);
                BuildPrimitive("WarningPlate", group, PrimitiveType.Cube,
                    PylonPoint(centre, rotation, structuralBase,
                        new Vector3(0f, 0.66f, -0.065f)),
                    new Vector3(0.17f, 0.12f, 0.018f), rotation, warning);
            }
        }

        private static void BuildCableRuns(Transform root, Material material)
        {
            float[] phaseOffsets = { -0.36f, 0f, 0.36f };
            for (int phase = 0; phase < phaseOffsets.Length; phase++)
            {
                var cableObject = new GameObject("ConductorPhase_" + phase);
                cableObject.transform.SetParent(root, false);
                LineRenderer line = cableObject.AddComponent<LineRenderer>();
                line.sharedMaterial = material;
                line.useWorldSpace = true;
                line.widthMultiplier = 0.020f;
                line.numCornerVertices = 2;
                line.numCapVertices = 2;
                line.textureMode = LineTextureMode.Stretch;
                line.alignment = LineAlignment.TransformZ;
                line.generateLightingData = true;
                line.shadowCastingMode = ShadowCastingMode.On;
                line.receiveShadows = true;
                line.motionVectorGenerationMode =
                    MotionVectorGenerationMode.ForceNoMotion;

                var points = new List<Vector3>();
                for (int span = 0; span < Pylons.Length - 1; span++)
                {
                    Vector3 from = CableAnchor(span, phaseOffsets[phase]);
                    Vector3 to = CableAnchor(span + 1, phaseOffsets[phase]);
                    for (int sample = 0; sample < CableSamplesPerSpan; sample++)
                    {
                        if (span > 0 && sample == 0) continue;
                        float t = sample / (CableSamplesPerSpan - 1f);
                        Vector3 point = Vector3.Lerp(from, to, t);
                        point.y -= Mathf.Sin(t * Mathf.PI) * 0.14f;
                        points.Add(point);
                    }
                }
                line.positionCount = points.Count;
                line.SetPositions(points.ToArray());
                GameObjectUtility.SetStaticEditorFlags(cableObject,
                    StaticEditorFlags.BatchingStatic
                    | StaticEditorFlags.ReflectionProbeStatic);
            }
        }

        private static void BuildSwitchgear(Transform root, Material steel,
                                            Material concrete,
                                            Material porcelain,
                                            Material warning)
        {
            for (int yardIndex = 0; yardIndex < Switchyards.Length; yardIndex++)
            {
                Switchyard yard = Switchyards[yardIndex];
                Transform yardRoot = Child(root, yard.Name);
                Quaternion rotation = Quaternion.Euler(0f, yard.Yaw, 0f);
                for (int bay = 0; bay < SwitchBaysPerYard; bay++)
                {
                    float mapX = yard.MapX + (bay - 1) * 4f;
                    float mapY = yard.MapY + 3.5f;
                    Vector3 centre = MapToWorld(mapX, mapY);
                    Transform bayRoot = Child(yardRoot,
                        yard.Name + "_SwitchBay_" + bay);
                    BuildPrimitive("BayPlinth", bayRoot, PrimitiveType.Cube,
                        centre + new Vector3(0f, 0.035f, 0f),
                        new Vector3(0.28f, 0.07f, 0.22f), rotation, concrete);
                    Vector3 left = centre + rotation * new Vector3(-0.09f, 0.25f, 0f);
                    Vector3 right = centre + rotation * new Vector3(0.09f, 0.25f, 0f);
                    BuildPrimitive("BayPostLeft", bayRoot, PrimitiveType.Cylinder,
                        left, new Vector3(0.025f, 0.22f, 0.025f),
                        Quaternion.identity, steel);
                    BuildPrimitive("BayPostRight", bayRoot, PrimitiveType.Cylinder,
                        right, new Vector3(0.025f, 0.22f, 0.025f),
                        Quaternion.identity, steel);
                    BuildBeam("BayBusbar", bayRoot,
                        left + new Vector3(0f, 0.22f, 0f),
                        right + new Vector3(0f, 0.22f, 0f), 0.025f, steel);
                    BuildPrimitive("BayInsulatorLeft", bayRoot,
                        PrimitiveType.Cylinder,
                        left + new Vector3(0f, 0.16f, 0f),
                        new Vector3(0.036f, 0.060f, 0.036f),
                        Quaternion.identity, porcelain);
                    BuildPrimitive("BayInsulatorRight", bayRoot,
                        PrimitiveType.Cylinder,
                        right + new Vector3(0f, 0.16f, 0f),
                        new Vector3(0.036f, 0.060f, 0.036f),
                        Quaternion.identity, porcelain);
                    BuildBeam("BayDisconnect", bayRoot,
                        left + new Vector3(0f, 0.26f, 0f),
                        right + new Vector3(0f, 0.34f, 0f), 0.020f, warning);
                }
            }
        }

        private static void PlaceSet(Placement[] placements, Transform root,
                                     Material material)
        {
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Transform yard = root.Find(placement.Yard)
                    ?? Child(root, placement.Yard);
                GameObject instance =
                    KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                        placement.AssetPath, placement.Name, yard,
                        placement.MapX, placement.MapY, placement.Footprint,
                        placement.MaximumHeight, placement.Yaw, placement.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                for (int rendererIndex = 0; rendererIndex < renderers.Length;
                     rendererIndex++)
                {
                    renderers[rendererIndex].sharedMaterials = Enumerable.Repeat(
                        material, renderers[rendererIndex].sharedMaterials.Length)
                        .ToArray();
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
                        .All(shared => shared == material)),
                    placement.Name + " lost its strategic material");
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.04f,
                    placement.Name + " footprint drifted from authored scale");
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is floating or buried relative to terrain");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for strategic-map scale");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        placement.MapX, placement.MapY, 0.08f),
                    placement.Name + " lies outside the visible landmass");
            }
            Require(used.SetEquals(allowed), label + " source set is incomplete");
            ValidateClearance(placements, label);
        }

        private static void ValidatePylons(Transform root)
        {
            Require(root != null && root.childCount == ExpectedPylonCount,
                "eight separate transmission pylons are required");
            for (int i = 0; i < Pylons.Length; i++)
            {
                Pylon pylon = Pylons[i];
                Transform group = root.Find(pylon.Name);
                Require(group != null, pylon.Name + " is missing");
                Renderer[] renderers = group.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length == PylonRendererCount,
                    pylon.Name + " lattice silhouette is incomplete");
                Bounds bounds = Encapsulate(renderers);
                Require(bounds.size.y >= 1.42f && bounds.size.y <= 1.58f,
                    pylon.Name + " lost its transmission-tower height");
                Transform crossarm = group.Find("MainCrossarm");
                Require(crossarm != null
                        && Mathf.Abs(crossarm.localScale.y - 0.92f) <= 0.015f,
                    pylon.Name + " crossarm lost its reviewed span");
                for (int foot = 0; foot < 4; foot++)
                {
                    Transform footing = group.Find("ConcreteFooting_" + foot);
                    Require(footing != null, pylon.Name + " footing is missing");
                    Renderer renderer = footing.GetComponent<Renderer>();
                    Require(renderer != null, pylon.Name + " footing has no renderer");
                    float terrain = HeightAtWorld(renderer.bounds.center.x,
                        renderer.bounds.center.z);
                    Require(Mathf.Abs(renderer.bounds.min.y - terrain) <= 0.025f,
                        pylon.Name + " has a floating or buried footing");
                }
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        pylon.MapX, pylon.MapY, 0.12f),
                    pylon.Name + " lies outside the visible landmass");
            }
            for (int i = 0; i < Pylons.Length - 1; i++)
            {
                float dx = (Pylons[i + 1].MapX - Pylons[i].MapX) * WorldScale;
                float dz = (Pylons[i + 1].MapY - Pylons[i].MapY) * WorldScale;
                Require(Mathf.Sqrt(dx * dx + dz * dz) >= 2.5f,
                    "adjacent transmission pylons intersect");
            }
        }

        private static void ValidateCables(Transform root)
        {
            Require(root != null && root.childCount == CablePhaseCount,
                "three conductor phases are required");
            int expectedPoints = 1 + (Pylons.Length - 1)
                * (CableSamplesPerSpan - 1);
            for (int phase = 0; phase < CablePhaseCount; phase++)
            {
                Transform cable = root.Find("ConductorPhase_" + phase);
                Require(cable != null, "a conductor phase is missing");
                LineRenderer line = cable.GetComponent<LineRenderer>();
                Require(line != null && line.enabled,
                    "a conductor phase has no persistent renderer");
                Require(line.positionCount == expectedPoints,
                    "a conductor phase lost its reviewed sag sampling");
                Require(line.widthMultiplier >= 0.018f
                        && line.widthMultiplier <= 0.022f,
                    "a conductor phase has an invalid strategic-map width");
                for (int point = 0; point < line.positionCount; point++)
                {
                    Vector3 position = line.GetPosition(point);
                    float terrain = HeightAtWorld(position.x, position.z);
                    Require(position.y >= terrain + 0.55f,
                        "a sagging conductor intersects the terrain");
                }
            }
        }

        private static void ValidateSwitchgear(Transform root)
        {
            Require(root != null && root.childCount == ExpectedSwitchyardCount,
                "two switchgear-yard groups are required");
            for (int yardIndex = 0; yardIndex < Switchyards.Length; yardIndex++)
            {
                Switchyard yard = Switchyards[yardIndex];
                Transform yardRoot = root.Find(yard.Name);
                Require(yardRoot != null
                        && yardRoot.childCount == SwitchBaysPerYard,
                    yard.Name + " must retain three switchgear bays");
                for (int bay = 0; bay < SwitchBaysPerYard; bay++)
                {
                    Transform bayRoot = yardRoot.Find(
                        yard.Name + "_SwitchBay_" + bay);
                    Require(bayRoot != null, yard.Name + " switchgear bay is missing");
                    Renderer[] renderers = bayRoot
                        .GetComponentsInChildren<Renderer>(true)
                        .Where(renderer => renderer != null && renderer.enabled)
                        .ToArray();
                    Require(renderers.Length == SwitchBayRendererCount,
                        yard.Name + " switchgear silhouette is incomplete");
                    Transform plinth = bayRoot.Find("BayPlinth");
                    Require(plinth != null && plinth.GetComponent<Renderer>() != null,
                        yard.Name + " switchgear plinth is missing");
                    Renderer plinthRenderer = plinth.GetComponent<Renderer>();
                    float terrain = HeightAtWorld(plinthRenderer.bounds.center.x,
                        plinthRenderer.bounds.center.z);
                    Require(Mathf.Abs(plinthRenderer.bounds.min.y - terrain) <= 0.025f,
                        yard.Name + " switchgear is floating or buried");
                }
            }
        }

        private static void ValidateClearance(Placement[] placements, string label)
        {
            for (int a = 0; a < placements.Length; a++)
            {
                for (int b = a + 1; b < placements.Length; b++)
                {
                    if (placements[a].Yard != placements[b].Yard) continue;
                    float dx = (placements[a].MapX - placements[b].MapX)
                        * WorldScale;
                    float dz = (placements[a].MapY - placements[b].MapY)
                        * WorldScale;
                    float distance = Mathf.Sqrt(dx * dx + dz * dz);
                    float minimum = (placements[a].Footprint
                        + placements[b].Footprint) * 0.48f;
                    Require(distance >= minimum,
                        label + " contains intersecting authored footprints: "
                        + placements[a].Name + " / " + placements[b].Name);
                }
            }
        }

        private static Quaternion PylonRotation(int index)
        {
            Vector3 previous = MapToWorld(
                Pylons[Mathf.Max(0, index - 1)].MapX,
                Pylons[Mathf.Max(0, index - 1)].MapY);
            Vector3 next = MapToWorld(
                Pylons[Mathf.Min(Pylons.Length - 1, index + 1)].MapX,
                Pylons[Mathf.Min(Pylons.Length - 1, index + 1)].MapY);
            Vector3 direction = next - previous;
            direction.y = 0f;
            return Quaternion.LookRotation(direction.normalized, Vector3.up);
        }

        private static Vector3 CableAnchor(int index, float phaseOffset)
        {
            Pylon pylon = Pylons[index];
            Vector3 centre = MapToWorld(pylon.MapX, pylon.MapY);
            Quaternion rotation = PylonRotation(index);
            Vector3 anchor = centre + rotation
                * new Vector3(phaseOffset, 0f, 0f);
            anchor.y = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                pylon.MapX, pylon.MapY) + 0.94f;
            return anchor;
        }

        private static Vector3 PylonPoint(Vector3 centre, Quaternion rotation,
                                          float structuralBase,
                                          Vector3 local)
        {
            Vector3 point = centre + rotation
                * new Vector3(local.x, 0f, local.z);
            point.y = structuralBase + local.y;
            return point;
        }

        private static void BuildBeam(string name, Transform parent,
                                      Vector3 from, Vector3 to, float thickness,
                                      Material material)
        {
            Vector3 direction = to - from;
            BuildPrimitive(name, parent, PrimitiveType.Cube,
                (from + to) * 0.5f,
                new Vector3(thickness, direction.magnitude, thickness),
                Quaternion.FromToRotation(Vector3.up, direction.normalized),
                material);
        }

        private static void BuildPrimitive(string name, Transform parent,
                                           PrimitiveType type, Vector3 position,
                                           Vector3 scale, Quaternion rotation,
                                           Material material)
        {
            GameObject primitive = GameObject.CreatePrimitive(type);
            primitive.name = name;
            primitive.transform.SetParent(parent, false);
            primitive.transform.position = position;
            primitive.transform.rotation = rotation;
            primitive.transform.localScale = scale;
            Collider collider = primitive.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            Renderer renderer = primitive.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            GameObjectUtility.SetStaticEditorFlags(primitive,
                StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Material BuildMepMaterial(string path, string name,
                                                 Color tint)
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(
                MepBuildingSourceMaterial);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException(
                    "MEP source material is unavailable for the power corridor");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = name;
            if (material.HasProperty("_BaseColor"))
                material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildSolidMaterial(string path, string name,
                                                   Color color, float metallic,
                                                   float smoothness)
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
            Material material = BuildSolidMaterial(path, name, color, 0.24f, 0.28f);
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", emission);
            material.globalIlluminationFlags =
                MaterialGlobalIlluminationFlags.RealtimeEmissive;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null
                    && material.shader.isSupported,
                "material is missing or unsupported: " + path);
            return material;
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static float HeightAtWorld(float worldX, float worldZ)
        {
            float mapX = worldX / WorldScale + MapCentre.x;
            float mapY = MapCentre.y - worldZ / WorldScale;
            return KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY);
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
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
            if (!condition)
                throw new InvalidOperationException(
                    "Kromka model iteration 19 validation failed: " + message);
        }
    }
}
#endif
