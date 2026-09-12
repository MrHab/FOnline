using System;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Builds the lore-first macro landscape visible on the strategic map. The
    /// composition follows the approved 380x300 km scheme and uses overlapping,
    /// grounded forms instead of the old rectangular biome board.
    /// </summary>
    internal static class KromkaGlobalMapSceneComposer
    {
        private const string MaterialRoot = "Assets/Art/Kromka/Materials";
        private const float Scale = 0.1f;
        private static readonly Vector2 Center = new Vector2(190f, 150f);

        public static void Compose(Transform parent)
        {
            Transform root = Child(parent, "LORE_TERRAIN_LANGUAGE_EDITABLE");
            BuildContinuousLandmass(Child(root, "ContinuousRelief_EDITABLE"));
            KromkaGlobalMapTransitionDepositsAuthoring.Compose(
                Child(root, "TransitionDeposits_TexturePass_EDITABLE"));
            KromkaGlobalMapWaterAuthoring.Compose(
                Child(root, "WaterSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapShorelineAuthoring.Compose(
                Child(root, "ShorelineSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapOreStrataAuthoring.Compose(
                Child(root, "OreStrataSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapFusedGlassAuthoring.Compose(
                Child(root, "FusedGlassSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapChalkKarstAuthoring.Compose(
                Child(root, "ChalkKarstSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapZeroDepositsAuthoring.Compose(
                Child(root, "ZeroDepositSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapSluiceWeatheringAuthoring.Compose(
                Child(root, "SluiceWeatheringSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapFloodplainAuthoring.Compose(
                Child(root, "FloodplainSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapRouteSurfaceAuthoring.Compose(
                Child(root, "RouteSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapTractWearAuthoring.Compose(
                Child(root, "TractWearSurfaces_TexturePass_EDITABLE"));
            KromkaGlobalMapSilentRingAuthoring.Compose(
                Child(root, "SilentRingSurfaces_TexturePass_EDITABLE"));
            ScatterMacroRelief(Child(root, "SurfaceRelief_EDITABLE"));
            // These region roots used to contain an early grey-box proxy made
            // from Unity cubes, cylinders and spheres. The finished texture and
            // MEP model passes below now own every one of those landmarks. Keep
            // the named roots for scene-navigation compatibility, but never
            // compose the obsolete proxy geometry: at low camera angles it
            // produced black ellipses beyond the terrain, floating towers,
            // neon discs and oversized icon-like silhouettes.
            RetireLegacyMacroProxy(Child(root, "NorthernSluices_EDITABLE"),
                "NorthernSluices");
            RetireLegacyMacroProxy(Child(root, "MiddleVein_EDITABLE"),
                "MiddleVein");
            RetireLegacyMacroProxy(Child(root, "OreArc_EDITABLE"), "OreArc");
            RetireLegacyMacroProxy(Child(root, "TractIsthmus_EDITABLE"),
                "TractIsthmus");
            RetireLegacyMacroProxy(Child(root, "Glasslands_EDITABLE"),
                "Glasslands");
            RetireLegacyMacroProxy(Child(root, "ChalkLowland_EDITABLE"),
                "ChalkLowland");
            RetireLegacyMacroProxy(Child(root, "ZeroBasin_EDITABLE"),
                "ZeroBasin");
            RetireLegacyMacroProxy(Child(root, "SilentRing_EDITABLE"),
                "SilentRing");
            KromkaGlobalMapRockLandmarkAuthoring.Compose(
                Child(root, "EnvironmentModels_ModelPass_EDITABLE"));
            KromkaGlobalMapTalusAuthoring.Compose(
                root.Find("EnvironmentModels_ModelPass_EDITABLE"));
            KromkaGlobalMapQuarryBenchAuthoring.Compose(
                root.Find("EnvironmentModels_ModelPass_EDITABLE"));
            KromkaGlobalMapSilentRingCliffAuthoring.Compose(
                root.Find("EnvironmentModels_ModelPass_EDITABLE"));
            KromkaGlobalMapNorthernSluicesAuthoring.Compose(
                root.Find("EnvironmentModels_ModelPass_EDITABLE"));
            KromkaGlobalMapOreIndustryAuthoring.Compose(
                root.Find("EnvironmentModels_ModelPass_EDITABLE"));
            Transform models = root.Find("EnvironmentModels_ModelPass_EDITABLE");
            // Restore the full lore-bearing settlement and infrastructure layer.
            // Every pass owns a reviewed strategic footprint, terrain seating,
            // persistent renderers and disabled interaction colliders. Kenney
            // kits are deliberately recontextualised with Kromka materials as
            // industrial silhouettes rather than used as runtime map markers.
            ComposeLoreInfrastructure(models);
            KromkaGlobalMapSovietReplacementAuthoring.Compose(models);
            KromkaGlobalMapSilentRingDeadwoodAuthoring.Compose(
                models);
            Transform effects = Child(root, "Effects_EffectPass_EDITABLE");
            KromkaGlobalMapDustEffectAuthoring.ComposeIteration01(effects);
            KromkaGlobalMapDustEffectAuthoring.ComposeIteration02(effects);
            KromkaGlobalMapDustEffectAuthoring.ComposeIteration03(effects);
            KromkaGlobalMapDustEffectAuthoring.ComposeIteration04(effects);
            KromkaGlobalMapDustEffectAuthoring.ComposeIteration05(effects);
            KromkaGlobalMapFogEffectAuthoring.ComposeIteration06(effects);
            KromkaGlobalMapFogEffectAuthoring.ComposeIteration07(effects);
            KromkaGlobalMapFogEffectAuthoring.ComposeIteration08(effects);
            KromkaGlobalMapFogEffectAuthoring.ComposeIteration09(effects);
            KromkaGlobalMapFogEffectAuthoring.ComposeIteration10(effects);
            KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration11(effects);
            KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration12(effects);
            KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration13(effects);
            KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration14(effects);
            KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration15(effects);
            KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration16(effects);
            KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration17(effects);
            KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration18(effects);
            KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration19(effects);
            KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration20(effects);
            KromkaGlobalMapBoundaryAuthoring.Compose(parent);
            KromkaGlobalMapOuterWastelandAuthoring.ComposeIteration01(parent);
            KromkaGlobalMapOuterWastelandIteration02Authoring.Compose(parent);
            KromkaGlobalMapOuterWastelandIteration03Authoring.Compose(parent);
            KromkaGlobalMapOuterWastelandPerimeterAuthoring.ComposeCompleted(parent);
            KromkaGlobalMapAssemblySupportAuthoring.Apply(models);
            KromkaGlobalMapSurfaceFinishAuthoring.Apply(parent);
            KromkaGlobalMapMeshGroundingPass.ApplyReviewedContacts();
        }

        private static void BuildContinuousLandmass(Transform root)
        {
            // Relief 20/20 remains one continuous high-density landmass. Texture
            // Iterations 01-06/20 provide the MEP ground stack. Water iteration
            // 07/20 is composed separately so transparent surfaces remain batched.
            Material baseSoil = KromkaGlobalMapTextureAuthoring.BuildMaterial();
            KromkaGlobalMapFinalTextureAuthoring.Apply(root, baseSoil);
            KromkaGlobalMapReliefAuthoring.BuildSurface(root, baseSoil);
        }

        private static void ScatterMacroRelief(Transform root)
        {
            // The former random sphere scatter obscured the macro silhouette.
            // Regional ridges stay in the height field. MEP cliff pieces arrive
            // only in the later environment-model phase, after texture completion.
            Child(root, "ReliefIteration_20_of_20");
            Child(root, "TextureIteration_20_of_20");
        }

        private static void RetireLegacyMacroProxy(Transform root,
                                                   string regionName)
        {
            Child(root, regionName + "_LegacyPrimitiveProxyRemoved_REFERENCE");
        }

        private static void ComposeLoreInfrastructure(Transform models)
        {
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.Compose(models);
            KromkaGlobalMapTractInfrastructureAuthoring.Compose(models);
            KromkaGlobalMapGlasslandsScienceAuthoring.Compose(models);
            KromkaGlobalMapGlasslandsLandmarkAuthoring.Compose(models);
            KromkaGlobalMapChalkLowlandSettlementAuthoring.Compose(models);
            KromkaGlobalMapListenersRavineAuthoring.Compose(models);
            KromkaGlobalMapZeroCoreAuthoring.Compose(models);
            KromkaGlobalMapZeroOuterAuthoring.Compose(models);
            KromkaGlobalMapHostileLandmarkAuthoring.Compose(models);
            KromkaGlobalMapSilentRingOutpostAuthoring.Compose(models);
            KromkaGlobalMapRouteCrossingAuthoring.Compose(models);
            KromkaGlobalMapRoadBridgeAuthoring.Compose(models);
            KromkaGlobalMapPowerCorridorAuthoring.Compose(models);
            KromkaGlobalMapRoadsideFinalAuthoring.Compose(models);

            Transform manifest = Child(models,
                "RestoredLoreInfrastructure_MANIFEST_REFERENCE");
            Child(manifest, "FactoryKitIndustrialModels_RESTORED_REFERENCE");
            Child(manifest, "CitiesAndSettlements_RESTORED_REFERENCE");
            Child(manifest, "LoreLandmarks_RESTORED_REFERENCE");
            Child(manifest, "PowerTransmissionLine_RESTORED_REFERENCE");
            Child(manifest, "PersistentAtEveryZoom_REFERENCE");
        }

        private static Color SurfaceColor(float x, float z)
        {
            if (z > 236f) return new Color(0.18f, 0.20f, 0.18f);
            if (x < 150f && z > 160f) return new Color(0.22f, 0.105f, 0.06f);
            if (x > 245f && z > 120f) return new Color(0.095f, 0.18f, 0.18f);
            if (x > 242f && z <= 125f) return new Color(0.48f, 0.46f, 0.37f);
            if (z < 112f && x > 102f) return new Color(0.085f, 0.10f, 0.095f);
            if (z > 165f) return new Color(0.22f, 0.26f, 0.15f);
            return new Color(0.26f, 0.22f, 0.14f);
        }

        private static void NorthernSluices(Transform root)
        {
            Color concrete = new Color(0.31f, 0.34f, 0.33f);
            Color darkConcrete = new Color(0.18f, 0.21f, 0.21f);
            Color warning = new Color(0.94f, 0.30f, 0.075f);
            Vector2[] reservoirs =
            {
                new Vector2(157f, 273f), new Vector2(211f, 276f),
                new Vector2(249f, 258f)
            };
            for (int i = 0; i < reservoirs.Length; i++)
            {
                Segment("DamWall_" + i, root,
                    new Vector2(reservoirs[i].x - 20f, reservoirs[i].y - 12f),
                    new Vector2(reservoirs[i].x + 20f, reservoirs[i].y - 10f),
                    0.44f, concrete, 0.18f);
                for (int gate = 0; gate < 4; gate++)
                    Box("Gate_" + i + "_" + gate, root,
                        World(reservoirs[i].x - 8f + gate * 5.4f, reservoirs[i].y - 5.8f, 0.27f),
                        new Vector3(0.32f, 0.46f, 0.26f), darkConcrete, -4f);
            }
            for (int i = 0; i < 7; i++)
            {
                Pylon("HydroGrid_" + i, root, World(55f + i * 29f,
                    247f + (i % 2) * 8f, 0f), darkConcrete, i % 2 == 0 ? -5f : 6f);
                if (i % 2 == 0) Beacon("DamWarning_" + i, root,
                    World(55f + i * 29f, 247f + (i % 2) * 8f, 1.15f), warning, 0.11f);
            }
            IndustrialBlock("SluiceControl", root, new Vector2(190f, 262f), concrete, warning, 1.15f);
        }

        private static void MiddleVein(Transform root)
        {
            Color soil = new Color(0.34f, 0.37f, 0.20f);
            Color darkSoil = new Color(0.20f, 0.25f, 0.14f);
            Color trees = new Color(0.15f, 0.24f, 0.14f);
            Color concrete = new Color(0.37f, 0.38f, 0.32f);
            for (int i = 0; i < 16; i++)
            {
                float x = 124f + (i % 6) * 17f + (i / 6) * 3f;
                float z = 218f - (i / 6) * 24f - (i % 2) * 5f;
                Box("CleanField_" + i, root, World(x, z, 0.04f),
                    new Vector3(1.28f, 0.035f, 0.72f), i % 3 == 0 ? darkSoil : soil,
                    -16f + (i % 5) * 8f);
            }
            for (int i = 0; i < 22; i++)
                Tree("Shelterbelt_" + i, root, World(112f + i * 6.1f,
                    232f - (i % 5) * 12f, 0f), trees, 0.70f + (i % 3) * 0.12f);
            WaterTower("KeysWaterTower", root, World(195f, 205f, 0f), 1.2f);
            Segment("KeysHeavyBridge", root, new Vector2(185f, 207f),
                new Vector2(208f, 202f), 0.62f, concrete, 0.24f);
            for (int i = 0; i < 5; i++)
                Box("KeysBlock_" + i, root, World(187f + (i % 3) * 5f,
                    198f - (i / 3) * 5f, 0.18f), new Vector3(0.44f, 0.32f, 0.68f),
                    new Color(0.34f, 0.28f, 0.19f), i * 17f);
        }

        private static void OreArc(Transform root)
        {
            Color ore = new Color(0.39f, 0.15f, 0.07f);
            Color slag = new Color(0.20f, 0.09f, 0.055f);
            Color pit = new Color(0.065f, 0.055f, 0.050f);
            Color rust = new Color(0.57f, 0.20f, 0.055f);
            Color ember = new Color(0.95f, 0.24f, 0.035f);

            // The depression is now part of the continuous mesh. Keep an explicit
            // authoring handle for the named landmark without covering it by discs.
            Child(root, "OpenPitOuter_RELIEF_REFERENCE");
            for (int i = 0; i < 14; i++)
            {
                float a = i * Mathf.PI * 2f / 14f;
                Vector3 at = World(70f + Mathf.Cos(a) * 52f,
                    220f + Mathf.Sin(a) * 42f, 0f);
                Mound("SlagRidge_" + i, root, at,
                    new Vector3(1.45f + (i % 4) * 0.33f, 0.48f + (i % 3) * 0.16f,
                        0.72f + (i % 2) * 0.34f), i % 3 == 0 ? ore : slag);
            }
            Gantry("RazdolyeGantry", root, World(76f, 210f, 0f), rust, 1.25f);
            Gantry("OreExchange", root, World(84f, 265f, 0f), rust, 1.0f);
            IndustrialBlock("RazdolyeFoundry", root, new Vector2(52f, 236f), slag, ember, 1.45f);
            for (int i = 0; i < 5; i++)
                Chimney("FoundryStack_" + i, root, World(43f + i * 6.2f,
                    246f - (i % 2) * 8f, 0f), slag, ember, 0.85f + i * 0.09f);
        }

        private static void TractIsthmus(Transform root)
        {
            Color dust = new Color(0.43f, 0.34f, 0.20f);
            Color steel = new Color(0.25f, 0.25f, 0.22f);
            Patch("WestRoadDust", root, 92f, 151f, 184f, 42f, -0.07f, 0.16f, dust);
            Patch("EastRoadDust", root, 270f, 126f, 212f, 50f, -0.07f, 0.16f, dust);
            for (int i = 0; i < 9; i++)
                Box("RoadFort_" + i, root, World(35f + i * 38f,
                    151f - Mathf.Max(0, i - 4) * 7f + (i % 2) * 6f, 0.15f),
                    new Vector3(0.42f, 0.28f, 0.50f), steel, -12f + i * 9f);
            CargoYard("CrossroadsYard", root, new Vector2(125f, 155f), dust, steel);
        }

        private static void Glasslands(Transform root)
        {
            Color glass = new Color(0.075f, 0.36f, 0.39f);
            Color blackGlass = new Color(0.055f, 0.105f, 0.11f);
            Color steel = new Color(0.22f, 0.29f, 0.29f);
            Color electric = new Color(0.19f, 0.92f, 1f);
            for (int i = 0; i < 26; i++)
            {
                float x = 252f + (i % 6) * 21f + (i / 6) * 2.2f;
                float z = 238f - (i / 6) * 27f - (i % 3) * 5f;
                GameObject plate = Box("FusedPlate_" + i, root, World(x, z, 0.045f),
                    new Vector3(1.38f + (i % 4) * 0.28f, 0.035f,
                        0.72f + (i % 3) * 0.20f), i % 4 == 0 ? blackGlass : glass,
                    i * 29f);
                plate.transform.localRotation *= Quaternion.Euler(i % 2 == 0 ? 2f : -3f, 0f, i % 3 - 1f);
            }
            for (int i = 0; i < 9; i++)
                Pylon("LeaningGrid_" + i, root, World(248f + i * 14f,
                    232f - (i % 3) * 43f, 0f), steel, i % 2 == 0 ? 18f : -14f);
            for (int i = 0; i < 8; i++)
            {
                float x = 270f + (i % 4) * 25f;
                float z = 224f - (i / 4) * 68f - (i % 2) * 11f;
                FlatCylinder("ElectricScar_" + i, root, World(x, z, 0.075f),
                    new Vector3(0.66f + (i % 3) * 0.18f, 0.022f, 0.52f), electric, 0.64f, true);
                Beacon("AnomalyGlow_" + i, root, World(x, z, 0.30f), electric, 0.095f);
            }
            DishArray("ContourThreeArray", root, new Vector2(300f, 181f), steel, electric);
        }

        private static void ChalkLowland(Transform root)
        {
            Color chalk = new Color(0.75f, 0.71f, 0.56f);
            Color pale = new Color(0.61f, 0.58f, 0.46f);
            for (int i = 0; i < 13; i++)
            {
                float x = 252f + i * 9.2f;
                float z = 131f - (i % 4) * 23f - i * 2.8f;
                Mound("ChalkEscarpment_" + i, root, World(x, z, 0f),
                    new Vector3(1.55f, 0.48f + (i % 3) * 0.18f, 0.76f),
                    i % 3 == 0 ? pale : chalk);
            }
            for (int i = 0; i < 17; i++)
                Tree("ChalkReed_" + i, root, World(252f + (i % 7) * 17f,
                    125f - (i / 7) * 35f, 0f), pale, 0.36f + (i % 3) * 0.08f);
            CargoYard("ChalkYard", root, new Vector2(297f, 110f), chalk,
                new Color(0.31f, 0.31f, 0.28f));
        }

        private static void ZeroBasin(Transform root)
        {
            Color steel = new Color(0.19f, 0.23f, 0.22f);
            Color chemical = new Color(0.40f, 0.62f, 0.10f);
            Color warning = new Color(0.93f, 0.20f, 0.035f);
            Segment("LowerPipe_A", root, new Vector2(118f, 92f),
                new Vector2(205f, 65f), 0.26f, steel, 0.18f);
            Segment("LowerPipe_B", root, new Vector2(205f, 65f),
                new Vector2(304f, 54f), 0.26f, steel, 0.18f);
            IndustrialBlock("RegeneratorR12", root, new Vector2(205f, 65f), steel, warning, 1.65f);
            IndustrialBlock("BalanceBunker", root, new Vector2(247f, 49f),
                new Color(0.12f, 0.14f, 0.14f), chemical, 1.0f);
        }

        private static void SilentRing(Transform root)
        {
            Color ash = new Color(0.075f, 0.08f, 0.068f);
            Color burned = new Color(0.13f, 0.08f, 0.055f);
            Color ember = new Color(0.95f, 0.16f, 0.025f);
            for (int i = 0; i < 44; i++)
            {
                float angle = i * Mathf.PI * 2f / 44f;
                float wobble = 1f + Mathf.Sin(i * 2.31f) * 0.035f;
                Vector3 at = new Vector3(Mathf.Cos(angle) * 18.25f * wobble,
                    0.02f, Mathf.Sin(angle) * 14.25f * wobble);
                Mound("BoundaryScar_" + i, root, at,
                    new Vector3(1.55f + (i % 4) * 0.24f, 0.34f + (i % 3) * 0.10f,
                        0.68f + (i % 2) * 0.25f), i % 3 == 0 ? burned : ash);
                if (i % 5 == 0)
                {
                    Tower("AutonomousTower_" + i, root, at + Vector3.up * 0.08f,
                        ash, ember, 0.62f);
                    Beacon("PerimeterEmber_" + i, root, at + Vector3.up * 0.20f,
                        ember, 0.085f);
                }
            }
        }

        private static void IndustrialBlock(string name, Transform parent, Vector2 map,
                                            Color body, Color accent, float scale)
        {
            Transform root = Child(parent, name);
            root.localPosition = World(map.x, map.y, 0f);
            Box("MainHall", root, new Vector3(0f, 0.22f * scale, 0f),
                new Vector3(1.16f * scale, 0.38f * scale, 0.72f * scale), body, 0f);
            Box("SideHall", root, new Vector3(0.72f * scale, 0.15f * scale, -0.20f * scale),
                new Vector3(0.48f * scale, 0.26f * scale, 0.55f * scale), body, 0f);
            for (int i = 0; i < 3; i++)
                Chimney("Stack_" + i, root, new Vector3((-0.42f + i * 0.36f) * scale,
                    0f, 0.12f * scale), body, accent, (0.68f + i * 0.10f) * scale);
            Beacon("IndustrialGlow", root, new Vector3(0f, 0.68f * scale, -0.38f * scale),
                accent, 0.09f * scale);
        }

        private static void CargoYard(string name, Transform parent, Vector2 map,
                                     Color ground, Color steel)
        {
            Transform root = Child(parent, name);
            root.localPosition = World(map.x, map.y, 0f);
            FlatCylinder("YardGround", root, new Vector3(0f, 0.035f, 0f),
                new Vector3(1.25f, 0.025f, 0.92f), ground, 0.12f);
            for (int i = 0; i < 7; i++)
                Box("Cargo_" + i, root, new Vector3(-0.65f + (i % 4) * 0.42f,
                    0.13f, -0.38f + (i / 4) * 0.48f), new Vector3(0.32f, 0.19f, 0.24f),
                    i % 2 == 0 ? steel : new Color(0.43f, 0.20f, 0.09f), i * 7f);
            Gantry("CargoCrane", root, new Vector3(0.45f, 0f, 0.15f), steel, 0.72f);
        }

        private static void DishArray(string name, Transform parent, Vector2 map,
                                      Color body, Color glow)
        {
            Transform root = Child(parent, name);
            root.localPosition = World(map.x, map.y, 0f);
            for (int i = 0; i < 4; i++)
            {
                Vector3 at = new Vector3(-0.70f + i * 0.47f, 0f, (i % 2) * 0.40f - 0.20f);
                Cylinder("DishMast_" + i, root, at + Vector3.up * 0.35f,
                    new Vector3(0.06f, 0.35f, 0.06f), body);
                GameObject dish = FlatCylinder("Dish_" + i, root, at + Vector3.up * 0.77f,
                    new Vector3(0.34f, 0.035f, 0.34f), glow, 0.58f, true);
                dish.transform.localRotation = Quaternion.Euler(34f, i * 51f, 0f);
            }
        }

        private static void Segment(string name, Transform parent, Vector2 a, Vector2 b,
                                    float width, Color color, float height = 0.045f)
        {
            Vector3 wa = World(a.x, a.y, height);
            Vector3 wb = World(b.x, b.y, height);
            Vector3 delta = wb - wa;
            GameObject segment = Box(name, parent, (wa + wb) * 0.5f,
                new Vector3(width, height, delta.magnitude), color, 0f);
            segment.transform.rotation = Quaternion.LookRotation(delta.normalized, Vector3.up);
        }

        private static void WaterTower(string name, Transform parent, Vector3 at, float scale)
        {
            Transform root = Child(parent, name);
            root.localPosition = at;
            for (int i = 0; i < 4; i++) Box("Leg_" + i, root,
                new Vector3((i % 2 == 0 ? -0.22f : 0.22f) * scale, 0.42f * scale,
                    (i < 2 ? -0.22f : 0.22f) * scale),
                new Vector3(0.05f, 0.84f, 0.05f) * scale,
                new Color(0.25f, 0.25f, 0.22f), 0f);
            FlatCylinder("Tank", root, new Vector3(0f, 0.98f * scale, 0f),
                new Vector3(0.48f, 0.20f, 0.48f) * scale,
                new Color(0.15f, 0.30f, 0.33f), 0.32f);
        }

        private static void Pylon(string name, Transform parent, Vector3 at, Color color, float lean)
        {
            Transform root = Child(parent, name);
            root.localPosition = at;
            root.localRotation = Quaternion.Euler(0f, 0f, lean);
            Box("Mast", root, new Vector3(0f, 0.55f, 0f), new Vector3(0.055f, 1.1f, 0.055f), color, 0f);
            Box("Crossbar", root, new Vector3(0f, 0.92f, 0f), new Vector3(0.62f, 0.04f, 0.04f), color, 0f);
            Box("Brace", root, new Vector3(0f, 0.42f, 0f), new Vector3(0.42f, 0.035f, 0.035f), color, 0f);
        }

        private static void Tree(string name, Transform parent, Vector3 at, Color color, float scale)
        {
            Transform root = Child(parent, name);
            root.localPosition = at;
            Cylinder("Trunk", root, new Vector3(0f, 0.16f * scale, 0f),
                new Vector3(0.045f, 0.16f, 0.045f) * scale, new Color(0.20f, 0.14f, 0.085f));
            Sphere("Crown", root, new Vector3(0f, 0.43f * scale, 0f),
                new Vector3(0.30f, 0.37f, 0.30f) * scale, color);
        }

        private static void Gantry(string name, Transform parent, Vector3 at, Color color, float scale)
        {
            Transform root = Child(parent, name);
            root.localPosition = at;
            Box("Left", root, new Vector3(-0.5f * scale, 0.35f * scale, 0f),
                new Vector3(0.08f, 0.7f, 0.18f) * scale, color, 0f);
            Box("Right", root, new Vector3(0.5f * scale, 0.35f * scale, 0f),
                new Vector3(0.08f, 0.7f, 0.18f) * scale, color, 0f);
            Box("Beam", root, new Vector3(0f, 0.72f * scale, 0f),
                new Vector3(1.1f, 0.10f, 0.18f) * scale, color, 0f);
        }

        private static void Chimney(string name, Transform parent, Vector3 at,
                                    Color body, Color light, float scale)
        {
            Transform root = Child(parent, name);
            root.localPosition = at;
            Cylinder("Stack", root, new Vector3(0f, 0.48f * scale, 0f),
                new Vector3(0.13f * scale, 0.48f * scale, 0.13f * scale), body);
            Beacon("StackGlow", root, new Vector3(0f, 1.02f * scale, 0f),
                light, 0.10f * scale);
        }

        private static void Tower(string name, Transform parent, Vector3 at,
                                  Color body, Color light, float scale)
        {
            Transform root = Child(parent, name);
            root.localPosition = at;
            Cylinder("Body", root, new Vector3(0f, 0.45f * scale, 0f),
                new Vector3(0.20f * scale, 0.45f * scale, 0.20f * scale), body);
            Beacon("Beacon", root, new Vector3(0f, 0.98f * scale, 0f), light, 0.15f * scale);
        }

        private static void Beacon(string name, Transform parent, Vector3 at, Color color, float size)
        {
            Sphere(name, parent, at, Vector3.one * size, color, 0.35f, true);
        }

        private static void Mound(string name, Transform parent, Vector3 at, Vector3 scale, Color color)
        {
            Sphere(name, parent, at - Vector3.up * scale.y * 0.28f, scale, color);
        }

        private static GameObject Patch(string name, Transform parent, float x, float z,
                                        float widthKm, float depthKm, float y, float height,
                                        Color color, float smoothness = 0.08f)
        {
            return Sphere(name, parent, World(x, z, y),
                new Vector3(widthKm * Scale, height, depthKm * Scale), color, smoothness);
        }

        private static GameObject FlatCylinder(string name, Transform parent, Vector3 at,
                                               Vector3 scale, Color color,
                                               float smoothness = 0.12f, bool emission = false)
        {
            return Primitive(name, PrimitiveType.Cylinder, parent, at, scale, color, 0f,
                smoothness, emission);
        }

        private static GameObject Box(string name, Transform parent, Vector3 at,
                                      Vector3 scale, Color color, float yaw)
        {
            return Primitive(name, PrimitiveType.Cube, parent, at, scale, color, yaw, 0.11f, false);
        }

        private static GameObject Cylinder(string name, Transform parent, Vector3 at,
                                           Vector3 scale, Color color)
        {
            return Primitive(name, PrimitiveType.Cylinder, parent, at, scale, color, 0f, 0.16f, false);
        }

        private static GameObject Sphere(string name, Transform parent, Vector3 at,
                                         Vector3 scale, Color color, float smoothness = 0.08f,
                                         bool emission = false)
        {
            return Primitive(name, PrimitiveType.Sphere, parent, at, scale, color, 0f,
                smoothness, emission);
        }

        private static GameObject Primitive(string name, PrimitiveType type, Transform parent,
                                            Vector3 at, Vector3 scale, Color color, float yaw,
                                            float smoothness, bool emission)
        {
            GameObject result = GameObject.CreatePrimitive(type);
            result.name = name;
            result.transform.SetParent(parent, false);
            result.transform.localPosition = at;
            result.transform.localScale = scale;
            result.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            Collider collider = result.GetComponent<Collider>();
            if (collider != null) collider.enabled = false;
            Renderer renderer = result.GetComponent<Renderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = Material(color, smoothness, emission);
                renderer.shadowCastingMode = scale.y < 0.09f
                    ? UnityEngine.Rendering.ShadowCastingMode.Off
                    : UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }
            GameObjectUtility.SetStaticEditorFlags(result, StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic);
            return result;
        }

        private static Material Material(Color color, float smoothness, bool emission)
        {
            Color32 c = color;
            string key = c.r.ToString("X2") + c.g.ToString("X2") + c.b.ToString("X2")
                + (emission ? "_E" : "_L");
            string path = MaterialRoot + "/Kromka_Global_" + key + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                material = new Material(shader) { name = "Kromka_Global_" + key };
                AssetDatabase.CreateAsset(material, path);
            }
            material.color = color;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", smoothness > 0.3f ? 0.42f : 0.08f);
            if (material.HasProperty("_SpecularHighlights"))
                material.SetFloat("_SpecularHighlights", smoothness > 0.3f ? 1f : 0f);
            if (emission && material.HasProperty("_EmissionColor"))
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", color * 2.4f);
                material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Transform Child(Transform parent, string name)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static Vector3 World(float x, float z, float y)
        {
            return new Vector3((x - Center.x) * Scale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(x, z) + y,
                (Center.y - z) * Scale);
        }
    }
}
