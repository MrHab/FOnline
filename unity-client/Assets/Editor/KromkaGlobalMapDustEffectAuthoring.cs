#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Cinematic-effects iterations 01-05/20. Iteration 01 establishes a
    /// restrained animated road-dust layer. Four instancing-friendly static
    /// veil meshes use the licensed MEP fog mask; motion stays in the shader so
    /// the global map avoids ParticleSystem simulation and camera-state churn.
    /// </summary>
    internal static class KromkaGlobalMapDustEffectAuthoring
    {
        internal const int EffectIterationCount = 20;
        internal const int DustIteration01 = 1;
        internal const int DustIteration02 = 2;
        internal const int DustIteration03 = 3;
        internal const int DustIteration04 = 4;
        internal const int DustIteration05 = 5;
        private const int ExpectedRoadEmitterCount = 4;
        private const int ExpectedCrosswindTrailCount = 5;
        private const int ExpectedOrePlumeCount = 3;
        private const int ExpectedGlassGritCount = 4;
        private const int ExpectedSilentAshCount = 4;
        private const int SheetsPerEmitter = 3;
        private const int VerticesPerSheet = 4;
        private const int MaximumDustRendererCount = 4;
        private const int MaximumCumulativeDustRendererCount = 9;
        private const int MaximumCumulativeDustRendererCount03 = 12;
        private const int MaximumCumulativeDustRendererCount04 = 16;
        private const int MaximumFinalDustRendererCount = 20;
        private const int MaximumFinalDustMaterialCount = 4;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string DustTexturePath =
            "Assets/MEP/MEP_Environment/MEP_FX/MEP_Clouds/Textures/MEP_Fog_a.png";
        private const string DustMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_RoadDust_MEP.mat";
        private const string DustMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_Effect_RoadDustVeils.asset";
        private const string OreDustMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_OreDust_MEP.mat";
        private const string GlassDustMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_GlassGrit_MEP.mat";
        private const string SilentAshMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_SilentAsh_MEP.mat";
        private const string DustShaderName = "Kromka/Global Map/Road Dust";

        private readonly struct DustEmitter
        {
            public readonly string Name;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Yaw;
            public readonly Vector3 Scale;

            public DustEmitter(string name, float mapX, float mapY, float yaw,
                               Vector3 scale)
            {
                Name = name;
                MapX = mapX;
                MapY = mapY;
                Yaw = yaw;
                Scale = scale;
            }
        }

        private static readonly DustEmitter[] RoadEmitters =
        {
            new DustEmitter("WestTract_RoadBreath", 91f, 155f, -8f,
                new Vector3(1.00f, 1.00f, 1.00f)),
            new DustEmitter("Crossroads_RoadBreath", 151f, 174f, 34f,
                new Vector3(1.12f, 1.00f, 0.94f)),
            new DustEmitter("EastTract_RoadBreath", 238f, 169f, -34f,
                new Vector3(1.04f, 1.00f, 1.08f)),
            new DustEmitter("GlassApproach_RoadBreath", 286f, 120f, -58f,
                new Vector3(0.94f, 1.00f, 1.12f))
        };

        private static readonly DustEmitter[] CrosswindTrails =
        {
            new DustEmitter("WestMarch_ExposedCrosswind", 78f, 157f, -16f,
                new Vector3(1.46f, 0.82f, 1.18f)),
            new DustEmitter("OreHaul_ExposedCrosswind", 116f, 181f, 22f,
                new Vector3(1.34f, 0.90f, 1.12f)),
            new DustEmitter("MiddleVein_ExposedCrosswind", 178f, 177f, 34f,
                new Vector3(1.52f, 0.78f, 1.08f)),
            new DustEmitter("EastTract_ExposedCrosswind", 246f, 163f, -38f,
                new Vector3(1.42f, 0.86f, 1.16f)),
            new DustEmitter("GlassApproach_ExposedCrosswind", 280f, 126f, -55f,
                new Vector3(1.28f, 0.94f, 1.22f))
        };

        private static readonly DustEmitter[] OreDustPlumes =
        {
            new DustEmitter("PitWorks_CrusherDust", 78f, 202f, 18f,
                new Vector3(1.38f, 1.16f, 1.24f)),
            new DustEmitter("WesternFoundry_SlagDust", 74f, 210f, -11f,
                new Vector3(1.26f, 1.28f, 1.18f)),
            new DustEmitter("OreExchange_LoadingDust", 126f, 232f, 36f,
                new Vector3(1.44f, 1.10f, 1.22f))
        };

        private static readonly DustEmitter[] GlassGritVeils =
        {
            new DustEmitter("Contour3_GlassGritVeil", 300f, 185f, -23f,
                new Vector3(1.52f, 0.88f, 1.18f)),
            new DustEmitter("PerimeterK3_GlassGritVeil", 274f, 208f, 18f,
                new Vector3(1.34f, 0.76f, 1.26f)),
            new DustEmitter("Solar4WestApproach_GlassGritVeil", 318f, 162f, -7f,
                new Vector3(1.42f, 0.82f, 1.20f)),
            new DustEmitter("VectorApproach_GlassGritVeil", 305f, 205f, 37f,
                new Vector3(1.48f, 0.80f, 1.14f))
        };

        private static readonly DustEmitter[] SilentAshDrifts =
        {
            new DustEmitter("GloomApproach_SilentAsh", 105f, 75f, -28f,
                new Vector3(1.42f, 0.84f, 1.20f)),
            new DustEmitter("NorthwestRing_SilentAsh", 150f, 55f, -10f,
                new Vector3(1.36f, 0.78f, 1.24f)),
            new DustEmitter("NorthRing_SilentAsh", 215f, 60f, 14f,
                new Vector3(1.48f, 0.80f, 1.16f)),
            new DustEmitter("NortheastRing_SilentAsh", 275f, 75f, 31f,
                new Vector3(1.34f, 0.86f, 1.22f))
        };

        internal static void ComposeIteration01(Transform parent)
        {
            Material material = BuildDustMaterial();
            Mesh mesh = BuildDustVeilMesh();
            Transform root = Child(parent,
                "Dust_Iteration01_GroundRoadBreath_MEP");
            for (int i = 0; i < RoadEmitters.Length; i++)
                BuildRoadDustVeil(root, RoadEmitters[i], mesh, material);

            Child(parent, "RoadDustEmitters_4_REFERENCE");
            Child(parent, "MEPDustTexture_REFERENCE");
            Child(parent, "GroundHuggingRoadDust_REFERENCE");
            Child(parent, "AnimatedDustVeils_REFERENCE");
            Child(parent, "OptimizedDustMeshBudget_REFERENCE");
            Child(parent, "EffectIteration_01_of_20");
        }

        internal static void ComposeIteration02(Transform parent)
        {
            Material material = RequireMaterial(DustMaterialPath);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            if (mesh == null)
                throw new InvalidOperationException(
                    "Iteration 02 cannot reuse the reviewed road-dust mesh");
            Transform root = Child(parent,
                "Dust_Iteration02_ExposedTractCrosswind_MEP");
            for (int i = 0; i < CrosswindTrails.Length; i++)
                BuildRoadDustVeil(root, CrosswindTrails[i], mesh, material);

            Child(parent, "CrosswindDustTrails_5_REFERENCE");
            Child(parent, "ExposedTractWindLanguage_REFERENCE");
            Child(parent, "SharedDustMeshAndMaterial_REFERENCE");
            Child(parent, "EffectIteration_02_of_20");
        }

        internal static void ComposeIteration03(Transform parent)
        {
            Material material = BuildTintedDustMaterial(OreDustMaterialPath,
                "Kromka_Effect_OreDust_MEP",
                new Color(0.72f, 0.43f, 0.24f, 0.31f), 0.021f);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            if (mesh == null)
                throw new InvalidOperationException(
                    "Iteration 03 cannot reuse the reviewed dust veil mesh");
            Transform root = Child(parent,
                "Dust_Iteration03_OreArcIndustrialPlumes_MEP");
            for (int i = 0; i < OreDustPlumes.Length; i++)
                BuildRoadDustVeil(root, OreDustPlumes[i], mesh, material);

            Child(parent, "OreArcDustPlumes_3_REFERENCE");
            Child(parent, "CrusherSlagLoadingDust_REFERENCE");
            Child(parent, "RegionalDustTint_REFERENCE");
            Child(parent, "EffectIteration_03_of_20");
        }

        internal static void ComposeIteration04(Transform parent)
        {
            Material material = BuildTintedDustMaterial(GlassDustMaterialPath,
                "Kromka_Effect_GlassGrit_MEP",
                new Color(0.55f, 0.64f, 0.62f, 0.23f), -0.017f);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            if (mesh == null)
                throw new InvalidOperationException(
                    "Iteration 04 cannot reuse the reviewed dust veil mesh");
            Transform root = Child(parent,
                "Dust_Iteration04_GlasslandsColdGrit_MEP");
            for (int i = 0; i < GlassGritVeils.Length; i++)
                BuildRoadDustVeil(root, GlassGritVeils[i], mesh, material);

            Child(parent, "GlasslandsGritVeils_4_REFERENCE");
            Child(parent, "ColdFusedGlassDust_REFERENCE");
            Child(parent, "CounterflowDustMotion_REFERENCE");
            Child(parent, "EffectIteration_04_of_20");
        }

        internal static void ComposeIteration05(Transform parent)
        {
            Material material = BuildTintedDustMaterial(SilentAshMaterialPath,
                "Kromka_Effect_SilentAsh_MEP",
                new Color(0.48f, 0.49f, 0.45f, 0.25f), 0.012f);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            if (mesh == null)
                throw new InvalidOperationException(
                    "Iteration 05 cannot reuse the reviewed dust veil mesh");
            Transform root = Child(parent,
                "Dust_Iteration05_SilentRingAshDrift_MEP");
            for (int i = 0; i < SilentAshDrifts.Length; i++)
                BuildRoadDustVeil(root, SilentAshDrifts[i], mesh, material);

            Child(parent, "SilentRingAshDrifts_4_REFERENCE");
            Child(parent, "DeadwoodAshLanguage_REFERENCE");
            Child(parent, "DustStageGlobalAudit_REFERENCE");
            Child(parent, "EffectIteration_05_of_20");
        }

        internal static void ValidateIteration01()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 01 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "RoadDustEmitters_4_REFERENCE",
                "MEPDustTexture_REFERENCE",
                "GroundHuggingRoadDust_REFERENCE",
                "AnimatedDustVeils_REFERENCE",
                "OptimizedDustMeshBudget_REFERENCE",
                "EffectIteration_01_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(RoadEmitters.Length == ExpectedRoadEmitterCount,
                "four principal-route dust fields are required");

            Material material = RequireMaterial(DustMaterialPath);
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                DustTexturePath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "road dust lost its licensed MEP texture source");
            Require(material.shader != null
                    && material.shader.name == DustShaderName,
                "road dust lost its purpose-built transparent shader");
            Mesh sharedMesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            Require(sharedMesh != null
                    && sharedMesh.vertexCount
                        == SheetsPerEmitter * VerticesPerSheet,
                "optimized three-sheet road-dust mesh is missing");

            Transform dustRoot = FindDescendant(root,
                "Dust_Iteration01_GroundRoadBreath_MEP");
            Require(dustRoot != null
                    && dustRoot.childCount == ExpectedRoadEmitterCount,
                "road-dust veil hierarchy is incomplete");

            int rendererCount = 0;
            for (int i = 0; i < RoadEmitters.Length; i++)
            {
                DustEmitter row = RoadEmitters[i];
                Transform veil = dustRoot.Find(row.Name);
                Require(veil != null, row.Name + " is missing");
                MeshFilter filter = veil.GetComponent<MeshFilter>();
                MeshRenderer renderer = veil.GetComponent<MeshRenderer>();
                Require(filter != null && renderer != null,
                    row.Name + " has no mesh filter or renderer");
                Require(filter.sharedMesh == sharedMesh,
                    row.Name + " does not reuse the reviewed dust mesh");
                Require(renderer.sharedMaterial == material,
                    row.Name + " does not reuse the reviewed MEP dust material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require((GameObjectUtility.GetStaticEditorFlags(veil.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not eligible for static batching");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.18f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.045f
                        && renderer.bounds.min.y <= expectedGround + 0.12f,
                    row.Name + " is buried or visibly floating above the route");
                rendererCount++;
            }
            Require(rendererCount <= MaximumDustRendererCount,
                "road-dust renderer budget exceeds four draw-ready fields");
            Require(dustRoot.GetComponentsInChildren<ParticleSystem>(true).Length == 0,
                "road dust must not rely on unstable map particle simulation");
            Require(dustRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "road dust must not create local lights");

            Debug.Log("[KROMKA EFFECTS 5%] PASS: four road-aligned animated "
                + "MEP dust veils add subtle ground breath along the principal "
                + "caravan corridor using four renderers, one shared mesh and "
                + "one instancing-ready material without particle simulation.");
        }

        internal static void ValidateIteration02()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 02 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "CrosswindDustTrails_5_REFERENCE",
                "ExposedTractWindLanguage_REFERENCE",
                "SharedDustMeshAndMaterial_REFERENCE",
                "EffectIteration_02_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(CrosswindTrails.Length == ExpectedCrosswindTrailCount,
                "five exposed-tract crosswind trails are required");

            Material material = RequireMaterial(DustMaterialPath);
            Mesh sharedMesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            Require(sharedMesh != null,
                "iteration 02 lost the shared road-dust veil mesh");
            Transform windRoot = FindDescendant(root,
                "Dust_Iteration02_ExposedTractCrosswind_MEP");
            Require(windRoot != null
                    && windRoot.childCount == ExpectedCrosswindTrailCount,
                "exposed-tract crosswind hierarchy is incomplete");

            for (int i = 0; i < CrosswindTrails.Length; i++)
            {
                DustEmitter row = CrosswindTrails[i];
                Transform trail = windRoot.Find(row.Name);
                Require(trail != null, row.Name + " is missing");
                MeshFilter filter = trail.GetComponent<MeshFilter>();
                MeshRenderer renderer = trail.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == sharedMesh,
                    row.Name + " does not reuse the optimized dust mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the MEP dust material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.18f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.045f
                        && renderer.bounds.min.y <= expectedGround + 0.12f,
                    row.Name + " is buried or visibly floating above the tract");
            }

            Transform firstRoot = FindDescendant(root,
                "Dust_Iteration01_GroundRoadBreath_MEP");
            Require(firstRoot != null,
                "iteration 02 cannot discard the accepted road-breath layer");
            int cumulativeRenderers = firstRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + windRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeDustRendererCount,
                "cumulative dust layer must remain at nine renderers");
            Require(root.GetComponentsInChildren<ParticleSystem>(true).Length == 0,
                "crosswind dust must not introduce particle simulation");

            Debug.Log("[KROMKA EFFECTS 10%] PASS: five elongated exposed-tract "
                + "crosswind trails extend the accepted road-breath layer. "
                + "Nine cumulative renderers still share one MEP material and "
                + "one animated veil mesh without transparent shadows.");
        }

        internal static void ValidateIteration03()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 03 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "OreArcDustPlumes_3_REFERENCE",
                "CrusherSlagLoadingDust_REFERENCE",
                "RegionalDustTint_REFERENCE",
                "EffectIteration_03_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(OreDustPlumes.Length == ExpectedOrePlumeCount,
                "three Ore Arc industrial dust plumes are required");

            Material material = RequireMaterial(OreDustMaterialPath);
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                DustTexturePath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "Ore Arc dust lost the licensed MEP source texture");
            Require(material.shader != null
                    && material.shader.name == DustShaderName,
                "Ore Arc dust lost the animated transparent shader");
            Mesh sharedMesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            Transform oreRoot = FindDescendant(root,
                "Dust_Iteration03_OreArcIndustrialPlumes_MEP");
            Require(oreRoot != null
                    && oreRoot.childCount == ExpectedOrePlumeCount,
                "Ore Arc industrial plume hierarchy is incomplete");

            for (int i = 0; i < OreDustPlumes.Length; i++)
            {
                DustEmitter row = OreDustPlumes[i];
                Transform plume = oreRoot.Find(row.Name);
                Require(plume != null, row.Name + " is missing");
                MeshFilter filter = plume.GetComponent<MeshFilter>();
                MeshRenderer renderer = plume.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == sharedMesh,
                    row.Name + " does not reuse the optimized dust mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " lost the regional ore-dust material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(row.MapX >= 40f && row.MapX <= 150f
                        && row.MapY >= 185f && row.MapY <= 250f,
                    row.Name + " is outside the authored Ore Arc");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.18f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.045f
                        && renderer.bounds.min.y <= expectedGround + 0.12f,
                    row.Name + " is buried or floating above its works yard");
            }

            Transform roadRoot = FindDescendant(root,
                "Dust_Iteration01_GroundRoadBreath_MEP");
            Transform crosswindRoot = FindDescendant(root,
                "Dust_Iteration02_ExposedTractCrosswind_MEP");
            Require(roadRoot != null && crosswindRoot != null,
                "iteration 03 cannot discard either accepted road dust layer");
            int cumulativeRenderers = roadRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + crosswindRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + oreRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeDustRendererCount03,
                "first three dust passes must remain at twelve renderers");
            Require(root.GetComponentsInChildren<ParticleSystem>(true).Length == 0,
                "Ore Arc plumes must not introduce particle simulation");

            Debug.Log("[KROMKA EFFECTS 15%] PASS: three warm Ore Arc plumes "
                + "mark the crusher, slag yard and loading exchange. Twelve "
                + "cumulative renderers use two shared MEP materials, one mesh "
                + "and no particle or transparent-shadow overhead.");
        }

        internal static void ValidateIteration04()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 04 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "GlasslandsGritVeils_4_REFERENCE",
                "ColdFusedGlassDust_REFERENCE",
                "CounterflowDustMotion_REFERENCE",
                "EffectIteration_04_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(GlassGritVeils.Length == ExpectedGlassGritCount,
                "four Glasslands grit veils are required");

            Material material = RequireMaterial(GlassDustMaterialPath);
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                DustTexturePath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "Glasslands grit lost the licensed MEP source texture");
            Require(material.shader != null
                    && material.shader.name == DustShaderName,
                "Glasslands grit lost the animated transparent shader");
            Mesh sharedMesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            Transform glassRoot = FindDescendant(root,
                "Dust_Iteration04_GlasslandsColdGrit_MEP");
            Require(glassRoot != null
                    && glassRoot.childCount == ExpectedGlassGritCount,
                "Glasslands grit hierarchy is incomplete");

            for (int i = 0; i < GlassGritVeils.Length; i++)
            {
                DustEmitter row = GlassGritVeils[i];
                Transform veil = glassRoot.Find(row.Name);
                Require(veil != null, row.Name + " is missing");
                MeshFilter filter = veil.GetComponent<MeshFilter>();
                MeshRenderer renderer = veil.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == sharedMesh,
                    row.Name + " does not reuse the optimized dust mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " lost the cold glass-grit material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(row.MapX >= 250f && row.MapX <= 355f
                        && row.MapY >= 138f && row.MapY <= 232f,
                    row.Name + " is outside the authored Glasslands");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.18f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.045f
                        && renderer.bounds.min.y <= expectedGround + 0.12f,
                    row.Name + " is buried or floating above fused ground");
            }

            Transform roadRoot = FindDescendant(root,
                "Dust_Iteration01_GroundRoadBreath_MEP");
            Transform crosswindRoot = FindDescendant(root,
                "Dust_Iteration02_ExposedTractCrosswind_MEP");
            Transform oreRoot = FindDescendant(root,
                "Dust_Iteration03_OreArcIndustrialPlumes_MEP");
            Require(roadRoot != null && crosswindRoot != null && oreRoot != null,
                "iteration 04 cannot discard any accepted dust layer");
            int cumulativeRenderers = roadRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + crosswindRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + oreRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + glassRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeDustRendererCount04,
                "first four dust passes must remain at sixteen renderers");
            Require(root.GetComponentsInChildren<ParticleSystem>(true).Length == 0,
                "Glasslands grit must not introduce particle simulation");

            Debug.Log("[KROMKA EFFECTS 20%] PASS: four cool counterflow grit "
                + "veils distinguish the Glasslands around Contour 3, K-3, "
                + "Solar 4 and Vector Approach. Sixteen cumulative renderers "
                + "share one mesh and three MEP-sourced materials.");
        }

        internal static void ValidateIteration05()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 05 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "SilentRingAshDrifts_4_REFERENCE",
                "DeadwoodAshLanguage_REFERENCE",
                "DustStageGlobalAudit_REFERENCE",
                "EffectIteration_05_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(SilentAshDrifts.Length == ExpectedSilentAshCount,
                "four Silent Ring ash drifts are required");

            Material material = RequireMaterial(SilentAshMaterialPath);
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                DustTexturePath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "Silent Ring ash lost the licensed MEP source texture");
            Require(material.shader != null
                    && material.shader.name == DustShaderName,
                "Silent Ring ash lost the animated transparent shader");
            Mesh sharedMesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            Transform ashRoot = FindDescendant(root,
                "Dust_Iteration05_SilentRingAshDrift_MEP");
            Require(ashRoot != null
                    && ashRoot.childCount == ExpectedSilentAshCount,
                "Silent Ring ash hierarchy is incomplete");

            for (int i = 0; i < SilentAshDrifts.Length; i++)
            {
                DustEmitter row = SilentAshDrifts[i];
                Transform drift = ashRoot.Find(row.Name);
                Require(drift != null, row.Name + " is missing");
                MeshFilter filter = drift.GetComponent<MeshFilter>();
                MeshRenderer renderer = drift.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == sharedMesh,
                    row.Name + " does not reuse the optimized dust mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " lost the regional ash material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(row.MapY <= 90f,
                    row.Name + " is outside the northern Silent Ring language");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.18f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.045f
                        && renderer.bounds.min.y <= expectedGround + 0.12f,
                    row.Name + " is buried or floating above the deadwood belt");
            }

            string[] dustRootNames =
            {
                "Dust_Iteration01_GroundRoadBreath_MEP",
                "Dust_Iteration02_ExposedTractCrosswind_MEP",
                "Dust_Iteration03_OreArcIndustrialPlumes_MEP",
                "Dust_Iteration04_GlasslandsColdGrit_MEP",
                "Dust_Iteration05_SilentRingAshDrift_MEP"
            };
            MeshRenderer[] renderers = dustRootNames
                .Select(name => FindDescendant(root, name))
                .SelectMany(dustRoot => dustRoot != null
                    ? dustRoot.GetComponentsInChildren<MeshRenderer>(true)
                    : Array.Empty<MeshRenderer>())
                .ToArray();
            Require(renderers.Length == MaximumFinalDustRendererCount,
                "complete dust stage must remain at twenty renderers");
            Material[] materials = renderers.Select(renderer =>
                    renderer != null ? renderer.sharedMaterial : null)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(materials.Length == MaximumFinalDustMaterialCount,
                "complete dust stage must remain at four shared materials");
            for (int i = 0; i < renderers.Length; i++)
            {
                MeshRenderer renderer = renderers[i];
                Require(renderer.sharedMaterial != null
                        && renderer.sharedMaterial.shader != null
                        && renderer.sharedMaterial.shader.isSupported,
                    renderer.name + " has an unsupported dust material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    renderer.name + " drifted outside the shadow-free budget");
                Require((GameObjectUtility.GetStaticEditorFlags(renderer.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    renderer.name + " is no longer batching-static");
            }
            Require(root.GetComponentsInChildren<ParticleSystem>(true).Length == 0,
                "complete dust stage must not contain particle systems");
            Require(root.GetComponentsInChildren<Light>(true).Length == 0,
                "complete dust stage must not contain local lights");
            Require(root.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "complete dust stage contains an active collider");

            Debug.Log("[KROMKA EFFECTS 25%] PASS: four restrained Silent Ring "
                + "ash drifts complete the dust stage. Twenty terrain-seated "
                + "renderers share one mesh and four MEP-sourced materials, "
                + "with no particles, lights, colliders or transparent shadows.");
        }

        private static void BuildRoadDustVeil(Transform parent, DustEmitter row,
                                              Mesh mesh, Material material)
        {
            var veil = new GameObject(row.Name);
            veil.transform.SetParent(parent, false);
            veil.transform.position = MapToWorld(row.MapX, row.MapY)
                + new Vector3(0f, 0.035f, 0f);
            veil.transform.rotation = Quaternion.Euler(0f, row.Yaw, 0f);
            // Keep the regional variation while preventing the shared cards
            // from spanning several settlements at close zoom.
            veil.transform.localScale = Vector3.Scale(row.Scale,
                new Vector3(0.72f, 0.74f, 0.72f));

            MeshFilter filter = veil.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            MeshRenderer renderer = veil.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            renderer.allowOcclusionWhenDynamic = true;
            GameObjectUtility.SetStaticEditorFlags(veil,
                StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Mesh BuildDustVeilMesh()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(DustMeshPath);
            bool fresh = mesh == null;
            if (fresh) mesh = new Mesh { name = "Kromka_Effect_RoadDustVeils" };
            else mesh.Clear();

            Vector3[] vertices = new Vector3[SheetsPerEmitter * VerticesPerSheet];
            Vector2[] uv = new Vector2[vertices.Length];
            Color[] colors = new Color[vertices.Length];
            int[] triangles = new int[SheetsPerEmitter * 6];
            // Vertical billboard strips remained visible as long grey ribbons
            // when players used the newly extended close zoom. Dust is now a
            // trio of shallow terrain patches with feathered shader edges.
            AddGroundPatch(vertices, uv, colors, triangles, 0,
                new Vector3(-0.31f, 0.018f, 0.02f), 0.86f, 0.40f, -12f,
                new Color(0.68f, 0.13f, 0f, 1f));
            AddGroundPatch(vertices, uv, colors, triangles, 1,
                new Vector3(0.03f, 0.024f, 0.08f), 0.94f, 0.44f, 18f,
                new Color(0.58f, 0.47f, 0f, 1f));
            AddGroundPatch(vertices, uv, colors, triangles, 2,
                new Vector3(0.37f, 0.014f, -0.05f), 0.76f, 0.36f, -25f,
                new Color(0.64f, 0.79f, 0f, 1f));

            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.colors = colors;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(false);
            if (fresh) AssetDatabase.CreateAsset(mesh, DustMeshPath);
            EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static void AddGroundPatch(Vector3[] vertices, Vector2[] uv,
                                           Color[] colors, int[] triangles,
                                           int sheetIndex, Vector3 centre,
                                           float length, float width,
                                           float yaw, Color data)
        {
            int vertex = sheetIndex * VerticesPerSheet;
            float halfLength = length * 0.5f;
            float radians = yaw * Mathf.Deg2Rad;
            Vector3 right = new Vector3(Mathf.Cos(radians), 0f,
                Mathf.Sin(radians)) * halfLength;
            Vector3 forward = new Vector3(-Mathf.Sin(radians), 0f,
                Mathf.Cos(radians)) * (width * 0.5f);
            vertices[vertex + 0] = centre - right - forward;
            vertices[vertex + 1] = centre + right - forward;
            vertices[vertex + 2] = centre + right + forward;
            vertices[vertex + 3] = centre - right + forward;
            uv[vertex + 0] = new Vector2(0f, 0f);
            uv[vertex + 1] = new Vector2(1f, 0f);
            uv[vertex + 2] = new Vector2(1f, 1f);
            uv[vertex + 3] = new Vector2(0f, 1f);
            for (int i = 0; i < VerticesPerSheet; i++) colors[vertex + i] = data;

            int triangle = sheetIndex * 6;
            triangles[triangle + 0] = vertex + 0;
            triangles[triangle + 1] = vertex + 2;
            triangles[triangle + 2] = vertex + 1;
            triangles[triangle + 3] = vertex + 0;
            triangles[triangle + 4] = vertex + 3;
            triangles[triangle + 5] = vertex + 2;
        }

        private static Material BuildDustMaterial()
        {
            return BuildTintedDustMaterial(DustMaterialPath,
                "Kromka_Effect_RoadDust_MEP",
                new Color(0.66f, 0.54f, 0.38f, 0.28f), 0.028f);
        }

        private static Material BuildTintedDustMaterial(string path, string name,
                                                        Color tint, float flow)
        {
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(DustTexturePath);
            if (source == null)
                throw new InvalidOperationException(
                    "Licensed MEP fog texture is unavailable for road dust");
            Shader shader = Shader.Find(DustShaderName);
            if (shader == null)
                throw new InvalidOperationException(
                    "Kromka road-dust shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.shader = shader;
            material.name = name;
            material.SetTexture("_BaseMap", source);
            material.SetColor("_BaseColor", tint);
            material.SetFloat("_AlphaCutoff", 0.006f);
            material.SetFloat("_FlowSpeed", flow);
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)RenderQueue.Transparent;
            material.shaderKeywords = Array.Empty<string>();
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null
                    && material.shader.isSupported,
                "effect material is missing or unsupported: " + path);
            return material;
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
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
                    "Kromka effect iteration 01 validation failed: " + message);
        }
    }
}
#endif
