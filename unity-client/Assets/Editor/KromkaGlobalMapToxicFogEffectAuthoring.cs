#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Cinematic-effects iterations 16-20/20. Iteration 16 introduces a
    /// restrained toxic vapour language for dead water, polluted infrastructure,
    /// anomalous research sites, the Silent Ring and its boundary breaches. It
    /// reuses two reviewed twelve-vertex fog meshes and a licensed MEP atlas;
    /// all movement and pulsing stay in the shader.
    /// </summary>
    internal static class KromkaGlobalMapToxicFogEffectAuthoring
    {
        internal const int ToxicFogIteration16 = 16;
        internal const int ToxicFogIteration17 = 17;
        internal const int ToxicFogIteration18 = 18;
        internal const int ToxicFogIteration19 = 19;
        internal const int ToxicFogIteration20 = 20;
        private const int ExpectedDeadWaterPatchCount = 4;
        private const int ExpectedInfrastructurePatchCount = 4;
        private const int ExpectedAnomalyPatchCount = 4;
        private const int ExpectedSporeBreachPatchCount = 4;
        private const int ExpectedBoundaryVeilCount = 4;
        private const int MaximumDeadWaterRendererCount = 4;
        private const int MaximumCumulativeRendererCount17 = 8;
        private const int MaximumCumulativeRendererCount18 = 12;
        private const int MaximumCumulativeRendererCount19 = 16;
        private const int MaximumFinalToxicRendererCount = 20;
        private const int MaximumFinalToxicMaterialCount = 5;
        private const int MaximumFinalToxicMeshCount = 2;
        private const int MaximumAllEffectRendererCount = 78;
        private const int MaximumAllEffectMaterialCount = 19;
        private const int MaximumAllEffectMeshCount = 4;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string ToxicFogTexturePath =
            "Assets/MEP/MEP_Environment/MEP_FX/MEP_Clouds/Textures/MEP_Fog_4x4.png";
        private const string GroundFogMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_Effect_GroundFogPatch.asset";
        private const string VerticalFogMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_Effect_LowFogBank.asset";
        private const string DeadWaterMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_DeadWaterToxicFog_MEP.mat";
        private const string InfrastructureMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_InfrastructureToxicFog_MEP.mat";
        private const string AnomalyMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_AnomalyReactionFog_MEP.mat";
        private const string SporeBreachMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_SilentSporeFog_MEP.mat";
        private const string BoundaryMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_BoundaryPoisonFog_MEP.mat";
        private const string ToxicFogShaderName =
            "Kromka/Global Map/Toxic Fog";

        private readonly struct ToxicPatch
        {
            public readonly string Name;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Yaw;
            public readonly Vector3 Scale;

            public ToxicPatch(string name, float mapX, float mapY, float yaw,
                              Vector3 scale)
            {
                Name = name;
                MapX = mapX;
                MapY = mapY;
                Yaw = yaw;
                Scale = scale;
            }
        }

        private static readonly ToxicPatch[] DeadWaterVapour =
        {
            new ToxicPatch("WestDeadWater_ToxicVapour", 151f, 54f, -12f,
                new Vector3(1.04f, 1.00f, 0.92f)),
            new ToxicPatch("CentralDeadWater_ToxicVapour", 214f, 43f, 9f,
                new Vector3(1.12f, 1.00f, 0.96f)),
            new ToxicPatch("EastDeadWater_ToxicVapour", 257f, 68f, 22f,
                new Vector3(0.98f, 1.00f, 0.88f)),
            new ToxicPatch("MarshDeadWater_ToxicVapour", 137f, 82f, -28f,
                new Vector3(0.86f, 1.00f, 0.80f))
        };

        private static readonly ToxicPatch[] InfrastructureRunoffVapour =
        {
            new ToxicPatch("Drain4B_ChemicalVapour", 168f, 76f, -18f,
                new Vector3(0.90f, 1.00f, 0.72f)),
            new ToxicPatch("FuelRamp_ChemicalVapour", 144f, 46f, 14f,
                new Vector3(0.82f, 1.00f, 0.68f)),
            new ToxicPatch("Fort14_RunoffVapour", 220f, 20f, -9f,
                new Vector3(0.76f, 1.00f, 0.64f)),
            new ToxicPatch("BalanceSluice_ChemicalVapour", 185f, 62f, 27f,
                new Vector3(0.88f, 1.00f, 0.70f))
        };

        private static readonly ToxicPatch[] AnomalyReactionVapour =
        {
            new ToxicPatch("FoldedCrater_ReactionVapour", 315f, 143f, -16f,
                new Vector3(0.94f, 1.00f, 0.78f)),
            new ToxicPatch("Contour3_ReactionVapour", 302f, 184f, 8f,
                new Vector3(0.84f, 1.00f, 0.70f)),
            new ToxicPatch("PerimeterK3_ReactionVapour", 274f, 210f, 26f,
                new Vector3(0.78f, 1.00f, 0.66f)),
            new ToxicPatch("ExperimentalWorkshop_ReactionVapour", 333f, 198f,
                -28f, new Vector3(0.82f, 1.00f, 0.68f))
        };

        private static readonly ToxicPatch[] SilentRingSporeBreaches =
        {
            new ToxicPatch("GloomInnerBelt_SporeBreach", 116f, 82f, -24f,
                new Vector3(0.92f, 1.00f, 0.76f)),
            new ToxicPatch("NorthwestInnerBelt_SporeBreach", 160f, 65f, -8f,
                new Vector3(0.86f, 1.00f, 0.72f)),
            new ToxicPatch("NorthInnerBelt_SporeBreach", 223f, 69f, 15f,
                new Vector3(0.94f, 1.00f, 0.78f)),
            new ToxicPatch("NortheastInnerBelt_SporeBreach", 264f, 86f, 29f,
                new Vector3(0.84f, 1.00f, 0.70f))
        };

        private static readonly ToxicPatch[] BoundaryPoisonVeils =
        {
            new ToxicPatch("WestBoundary_PoisonVeil", 45f, 178f, -7f,
                new Vector3(1.46f, 0.76f, 1.10f)),
            new ToxicPatch("NorthBoundary_PoisonVeil", 193f, 262f, 3f,
                new Vector3(1.52f, 0.80f, 1.14f)),
            new ToxicPatch("EastBoundary_PoisonVeil", 334f, 182f, 12f,
                new Vector3(1.48f, 0.78f, 1.12f)),
            new ToxicPatch("SouthBoundary_PoisonVeil", 208f, 42f, -4f,
                new Vector3(1.42f, 0.74f, 1.08f))
        };

        internal static void ComposeIteration16(Transform parent)
        {
            Material material = BuildToxicMaterial(DeadWaterMaterialPath,
                "Kromka_Effect_DeadWaterToxicFog_MEP",
                new Color(0.25f, 0.36f, 0.13f, 0.38f),
                new Color(0.55f, 0.68f, 0.17f, 1f),
                0.78f, 0.042f, 0.46f, 0.23f);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Transform root = Child(parent,
                "ToxicFog_Iteration16_DeadWaterVapour_MEP");
            for (int i = 0; i < DeadWaterVapour.Length; i++)
                BuildToxicPatch(root, DeadWaterVapour[i], mesh, material, 0.075f);

            Child(parent, "DeadWaterToxicPatches_4_REFERENCE");
            Child(parent, "MEPToxicFogAtlas_REFERENCE");
            Child(parent, "DeadWaterSurfaceClearance_REFERENCE");
            Child(parent, "NoParticleToxicFog_REFERENCE");
            Child(parent, "EffectIteration_16_of_20");
        }

        internal static void ComposeIteration17(Transform parent)
        {
            Material material = BuildToxicMaterial(InfrastructureMaterialPath,
                "Kromka_Effect_InfrastructureToxicFog_MEP",
                new Color(0.33f, 0.37f, 0.10f, 0.31f),
                new Color(0.70f, 0.70f, 0.18f, 1f),
                0.64f, 0.035f, 0.38f, 0.16f);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Transform root = Child(parent,
                "ToxicFog_Iteration17_InfrastructureRunoff_MEP");
            for (int i = 0; i < InfrastructureRunoffVapour.Length; i++)
                BuildToxicPatch(root, InfrastructureRunoffVapour[i], mesh,
                    material, 0.068f);

            Child(parent, "InfrastructureToxicPatches_4_REFERENCE");
            Child(parent, "DrainFuelRunoffPlacement_REFERENCE");
            Child(parent, "MutedSulphurPalette_REFERENCE");
            Child(parent, "EffectIteration_17_of_20");
        }

        internal static void ComposeIteration18(Transform parent)
        {
            Material material = BuildToxicMaterial(AnomalyMaterialPath,
                "Kromka_Effect_AnomalyReactionFog_MEP",
                new Color(0.10f, 0.28f, 0.23f, 0.30f),
                new Color(0.20f, 0.68f, 0.51f, 1f),
                0.92f, 0.052f, 0.52f, 0.15f);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Transform root = Child(parent,
                "ToxicFog_Iteration18_AnomalyReaction_MEP");
            for (int i = 0; i < AnomalyReactionVapour.Length; i++)
                BuildToxicPatch(root, AnomalyReactionVapour[i], mesh, material,
                    0.082f);

            Child(parent, "AnomalyReactionPatches_4_REFERENCE");
            Child(parent, "GlasslandsFacilityPlacement_REFERENCE");
            Child(parent, "ColdCyanGreenPalette_REFERENCE");
            Child(parent, "EffectIteration_18_of_20");
        }

        internal static void ComposeIteration19(Transform parent)
        {
            Material material = BuildToxicMaterial(SporeBreachMaterialPath,
                "Kromka_Effect_SilentSporeFog_MEP",
                new Color(0.24f, 0.29f, 0.20f, 0.28f),
                new Color(0.48f, 0.57f, 0.35f, 1f),
                0.48f, 0.028f, 0.31f, 0.08f);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Transform root = Child(parent,
                "ToxicFog_Iteration19_SilentSporeBreaches_MEP");
            for (int i = 0; i < SilentRingSporeBreaches.Length; i++)
                BuildToxicPatch(root, SilentRingSporeBreaches[i], mesh,
                    material, 0.073f);

            Child(parent, "SilentSporeBreachPatches_4_REFERENCE");
            Child(parent, "DeadwoodInnerBeltPlacement_REFERENCE");
            Child(parent, "AshGreenSporePalette_REFERENCE");
            Child(parent, "EffectIteration_19_of_20");
        }

        internal static void ComposeIteration20(Transform parent)
        {
            Material material = BuildToxicMaterial(BoundaryMaterialPath,
                "Kromka_Effect_BoundaryPoisonFog_MEP",
                new Color(0.18f, 0.28f, 0.11f, 0.34f),
                new Color(0.46f, 0.59f, 0.17f, 1f),
                0.56f, 0.038f, 0.34f, 0.14f);
            Mesh mesh = RequireMesh(VerticalFogMeshPath);
            Transform root = Child(parent,
                "ToxicFog_Iteration20_BoundaryPoisonVeils_MEP");
            for (int i = 0; i < BoundaryPoisonVeils.Length; i++)
                BuildToxicPatch(root, BoundaryPoisonVeils[i], mesh, material,
                    0.052f);

            Child(parent, "BoundaryPoisonVeils_4_REFERENCE");
            Child(parent, "FourSidedInnerRimPlacement_REFERENCE");
            Child(parent, "EffectsGlobalRendererBudget_78_REFERENCE");
            Child(parent, "EffectsGlobalMaterialBudget_19_REFERENCE");
            Child(parent, "EffectsGlobalMeshBudget_4_REFERENCE");
            Child(parent, "EffectStageFinalAudit_REFERENCE");
            Child(parent, "EffectIteration_20_of_20");
        }

        internal static void ValidateIteration16()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 16 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "DeadWaterToxicPatches_4_REFERENCE",
                "MEPToxicFogAtlas_REFERENCE",
                "DeadWaterSurfaceClearance_REFERENCE",
                "NoParticleToxicFog_REFERENCE",
                "EffectIteration_16_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(DeadWaterVapour.Length == ExpectedDeadWaterPatchCount,
                "four reviewed dead-water toxic patches are required");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ToxicFogTexturePath);
            Material material = RequireMaterial(DeadWaterMaterialPath);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "dead-water toxic fog lost its licensed MEP atlas");
            Require(material.enableInstancing,
                "dead-water toxic fog material is not instancing-ready");

            Transform toxicRoot = FindDescendant(effectsRoot,
                "ToxicFog_Iteration16_DeadWaterVapour_MEP");
            Require(toxicRoot != null
                    && toxicRoot.childCount == ExpectedDeadWaterPatchCount,
                "dead-water toxic-fog hierarchy is incomplete");
            MeshRenderer[] renderers = toxicRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(renderers.Length == MaximumDeadWaterRendererCount,
                "dead-water toxic fog must remain at four renderers");

            for (int i = 0; i < DeadWaterVapour.Length; i++)
            {
                ToxicPatch row = DeadWaterVapour[i];
                Transform patch = toxicRoot.Find(row.Name);
                Require(patch != null, row.Name + " is missing");
                MeshFilter filter = patch.GetComponent<MeshFilter>();
                MeshRenderer renderer = patch.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the ground-fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the dead-water material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(!renderer.allowOcclusionWhenDynamic,
                    row.Name + " can disappear through dynamic occlusion");
                Require((GameObjectUtility.GetStaticEditorFlags(patch.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.04f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.075f
                        && renderer.bounds.min.y <= expectedGround + 0.115f,
                    row.Name + " is buried or floating above dead water");
            }

            Require(toxicRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "dead-water toxic fog must not use ParticleSystem simulation");
            Require(toxicRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "dead-water toxic fog must not create local lights");
            Require(toxicRoot.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "dead-water toxic fog contains an active collider");
            Require(toxicRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "dead-water toxic fog can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 80%] PASS: four muted green MEP toxic "
                + "vapour patches sit directly above the authored dead-water "
                + "pools. Four renderers reuse the reviewed twelve-vertex "
                + "ground-fog mesh without particles, lights, colliders, "
                + "occlusion hiding or distance LODs.");
        }

        internal static void ValidateIteration17()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 17 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "InfrastructureToxicPatches_4_REFERENCE",
                "DrainFuelRunoffPlacement_REFERENCE",
                "MutedSulphurPalette_REFERENCE",
                "EffectIteration_17_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(InfrastructureRunoffVapour.Length
                    == ExpectedInfrastructurePatchCount,
                "four reviewed infrastructure toxic patches are required");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ToxicFogTexturePath);
            Material material = RequireMaterial(InfrastructureMaterialPath);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "infrastructure toxic fog lost its licensed MEP atlas");
            Require(material.enableInstancing,
                "infrastructure toxic fog material is not instancing-ready");

            Transform toxicRoot = FindDescendant(effectsRoot,
                "ToxicFog_Iteration17_InfrastructureRunoff_MEP");
            Require(toxicRoot != null
                    && toxicRoot.childCount == ExpectedInfrastructurePatchCount,
                "infrastructure toxic-fog hierarchy is incomplete");
            MeshRenderer[] renderers = toxicRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(renderers.Length == ExpectedInfrastructurePatchCount,
                "infrastructure toxic fog must remain at four renderers");

            for (int i = 0; i < InfrastructureRunoffVapour.Length; i++)
            {
                ToxicPatch row = InfrastructureRunoffVapour[i];
                Transform patch = toxicRoot.Find(row.Name);
                Require(patch != null, row.Name + " is missing");
                MeshFilter filter = patch.GetComponent<MeshFilter>();
                MeshRenderer renderer = patch.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the ground-fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the infrastructure material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(!renderer.allowOcclusionWhenDynamic,
                    row.Name + " can disappear through dynamic occlusion");
                Require((GameObjectUtility.GetStaticEditorFlags(patch.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.04f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.068f
                        && renderer.bounds.min.y <= expectedGround + 0.108f,
                    row.Name + " is buried or floating above infrastructure");
            }

            Transform deadWaterRoot = FindDescendant(effectsRoot,
                "ToxicFog_Iteration16_DeadWaterVapour_MEP");
            int cumulativeRenderers = renderers.Length
                + (deadWaterRoot != null
                    ? deadWaterRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                    : 0);
            Require(cumulativeRenderers == MaximumCumulativeRendererCount17,
                "toxic fog exceeds the eight-renderer budget at 85 percent");
            Require(toxicRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "infrastructure toxic fog must not use ParticleSystem simulation");
            Require(toxicRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "infrastructure toxic fog must not create local lights");
            Require(toxicRoot.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "infrastructure toxic fog contains an active collider");
            Require(toxicRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "infrastructure toxic fog can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 85%] PASS: four low sulphur-green MEP "
                + "vapour patches mark drains, fuel runoff and damaged "
                + "infrastructure. The cumulative toxic layer remains eight "
                + "static renderers without simulation, lights or LOD hiding.");
        }

        internal static void ValidateIteration18()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 18 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "AnomalyReactionPatches_4_REFERENCE",
                "GlasslandsFacilityPlacement_REFERENCE",
                "ColdCyanGreenPalette_REFERENCE",
                "EffectIteration_18_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(AnomalyReactionVapour.Length == ExpectedAnomalyPatchCount,
                "four reviewed anomaly-reaction patches are required");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ToxicFogTexturePath);
            Material material = RequireMaterial(AnomalyMaterialPath);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "anomaly-reaction fog lost its licensed MEP atlas");
            Require(material.enableInstancing,
                "anomaly-reaction fog material is not instancing-ready");

            Transform toxicRoot = FindDescendant(effectsRoot,
                "ToxicFog_Iteration18_AnomalyReaction_MEP");
            Require(toxicRoot != null
                    && toxicRoot.childCount == ExpectedAnomalyPatchCount,
                "anomaly-reaction fog hierarchy is incomplete");
            MeshRenderer[] renderers = toxicRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(renderers.Length == ExpectedAnomalyPatchCount,
                "anomaly-reaction fog must remain at four renderers");

            for (int i = 0; i < AnomalyReactionVapour.Length; i++)
            {
                ToxicPatch row = AnomalyReactionVapour[i];
                Transform patch = toxicRoot.Find(row.Name);
                Require(patch != null, row.Name + " is missing");
                MeshFilter filter = patch.GetComponent<MeshFilter>();
                MeshRenderer renderer = patch.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the ground-fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the anomaly material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(!renderer.allowOcclusionWhenDynamic,
                    row.Name + " can disappear through dynamic occlusion");
                Require((GameObjectUtility.GetStaticEditorFlags(patch.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.04f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.082f
                        && renderer.bounds.min.y <= expectedGround + 0.122f,
                    row.Name + " is buried or floating above Glasslands terrain");
            }

            string[] cumulativeRoots =
            {
                "ToxicFog_Iteration16_DeadWaterVapour_MEP",
                "ToxicFog_Iteration17_InfrastructureRunoff_MEP",
                "ToxicFog_Iteration18_AnomalyReaction_MEP"
            };
            int cumulativeRenderers = 0;
            for (int i = 0; i < cumulativeRoots.Length; i++)
            {
                Transform root = FindDescendant(effectsRoot, cumulativeRoots[i]);
                Require(root != null, cumulativeRoots[i] + " is missing");
                cumulativeRenderers += root
                    .GetComponentsInChildren<MeshRenderer>(true).Length;
            }
            Require(cumulativeRenderers == MaximumCumulativeRendererCount18,
                "toxic fog exceeds the twelve-renderer budget at 90 percent");
            Require(toxicRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "anomaly-reaction fog must not use ParticleSystem simulation");
            Require(toxicRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "anomaly-reaction fog must not create local lights");
            Require(toxicRoot.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "anomaly-reaction fog contains an active collider");
            Require(toxicRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "anomaly-reaction fog can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 90%] PASS: four cold cyan-green MEP "
                + "reaction patches distinguish the Folded crater, Contour-3, "
                + "Perimeter K-3 and the experimental workshop without lights "
                + "or simulation. The toxic layer remains twelve renderers.");
        }

        internal static void ValidateIteration19()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 19 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "SilentSporeBreachPatches_4_REFERENCE",
                "DeadwoodInnerBeltPlacement_REFERENCE",
                "AshGreenSporePalette_REFERENCE",
                "EffectIteration_19_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(SilentRingSporeBreaches.Length
                    == ExpectedSporeBreachPatchCount,
                "four reviewed Silent Ring spore breaches are required");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ToxicFogTexturePath);
            Material material = RequireMaterial(SporeBreachMaterialPath);
            Mesh mesh = RequireMesh(GroundFogMeshPath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "Silent Ring spore fog lost its licensed MEP atlas");
            Require(material.enableInstancing,
                "Silent Ring spore material is not instancing-ready");

            Transform toxicRoot = FindDescendant(effectsRoot,
                "ToxicFog_Iteration19_SilentSporeBreaches_MEP");
            Require(toxicRoot != null
                    && toxicRoot.childCount == ExpectedSporeBreachPatchCount,
                "Silent Ring spore-fog hierarchy is incomplete");
            MeshRenderer[] renderers = toxicRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(renderers.Length == ExpectedSporeBreachPatchCount,
                "Silent Ring spore fog must remain at four renderers");

            for (int i = 0; i < SilentRingSporeBreaches.Length; i++)
            {
                ToxicPatch row = SilentRingSporeBreaches[i];
                Transform patch = toxicRoot.Find(row.Name);
                Require(patch != null, row.Name + " is missing");
                MeshFilter filter = patch.GetComponent<MeshFilter>();
                MeshRenderer renderer = patch.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the ground-fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the spore material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(!renderer.allowOcclusionWhenDynamic,
                    row.Name + " can disappear through dynamic occlusion");
                Require((GameObjectUtility.GetStaticEditorFlags(patch.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.04f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.073f
                        && renderer.bounds.min.y <= expectedGround + 0.113f,
                    row.Name + " is buried or floating above the deadwood belt");
            }

            string[] cumulativeRoots =
            {
                "ToxicFog_Iteration16_DeadWaterVapour_MEP",
                "ToxicFog_Iteration17_InfrastructureRunoff_MEP",
                "ToxicFog_Iteration18_AnomalyReaction_MEP",
                "ToxicFog_Iteration19_SilentSporeBreaches_MEP"
            };
            int cumulativeRenderers = 0;
            for (int i = 0; i < cumulativeRoots.Length; i++)
            {
                Transform root = FindDescendant(effectsRoot, cumulativeRoots[i]);
                Require(root != null, cumulativeRoots[i] + " is missing");
                cumulativeRenderers += root
                    .GetComponentsInChildren<MeshRenderer>(true).Length;
            }
            Require(cumulativeRenderers == MaximumCumulativeRendererCount19,
                "toxic fog exceeds the sixteen-renderer budget at 95 percent");
            Require(toxicRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "Silent Ring spore fog must not use ParticleSystem simulation");
            Require(toxicRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "Silent Ring spore fog must not create local lights");
            Require(toxicRoot.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "Silent Ring spore fog contains an active collider");
            Require(toxicRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Silent Ring spore fog can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 95%] PASS: four ash-green MEP spore "
                + "breaches sit just inside the Silent Ring deadwood belt, "
                + "offset from the existing dust veils. The toxic layer remains "
                + "sixteen static renderers without lights, simulation or LODs.");
        }

        internal static void ValidateIteration20()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 20 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "BoundaryPoisonVeils_4_REFERENCE",
                "FourSidedInnerRimPlacement_REFERENCE",
                "EffectsGlobalRendererBudget_78_REFERENCE",
                "EffectsGlobalMaterialBudget_19_REFERENCE",
                "EffectsGlobalMeshBudget_4_REFERENCE",
                "EffectStageFinalAudit_REFERENCE",
                "EffectIteration_20_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(BoundaryPoisonVeils.Length == ExpectedBoundaryVeilCount,
                "four reviewed boundary poison veils are required");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ToxicFogTexturePath);
            Material material = RequireMaterial(BoundaryMaterialPath);
            Mesh verticalMesh = RequireMesh(VerticalFogMeshPath);
            Mesh horizontalMesh = RequireMesh(GroundFogMeshPath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "boundary poison fog lost its licensed MEP atlas");
            Require(material.enableInstancing,
                "boundary poison material is not instancing-ready");

            Transform boundaryRoot = FindDescendant(effectsRoot,
                "ToxicFog_Iteration20_BoundaryPoisonVeils_MEP");
            Require(boundaryRoot != null
                    && boundaryRoot.childCount == ExpectedBoundaryVeilCount,
                "boundary poison hierarchy is incomplete");
            MeshRenderer[] boundaryRenderers = boundaryRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(boundaryRenderers.Length == ExpectedBoundaryVeilCount,
                "boundary poison layer must remain at four renderers");

            for (int i = 0; i < BoundaryPoisonVeils.Length; i++)
            {
                ToxicPatch row = BoundaryPoisonVeils[i];
                Transform veil = boundaryRoot.Find(row.Name);
                Require(veil != null, row.Name + " is missing");
                MeshFilter filter = veil.GetComponent<MeshFilter>();
                MeshRenderer renderer = veil.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == verticalMesh,
                    row.Name + " does not reuse the vertical fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the boundary material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(!renderer.allowOcclusionWhenDynamic,
                    row.Name + " can disappear through dynamic occlusion");
                Require((GameObjectUtility.GetStaticEditorFlags(veil.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.05f),
                    row.Name + " lies outside the visible inner rim");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.045f
                        && renderer.bounds.min.y <= expectedGround + 0.095f,
                    row.Name + " is buried or floating above the inner rim");
            }

            string[] toxicRootNames =
            {
                "ToxicFog_Iteration16_DeadWaterVapour_MEP",
                "ToxicFog_Iteration17_InfrastructureRunoff_MEP",
                "ToxicFog_Iteration18_AnomalyReaction_MEP",
                "ToxicFog_Iteration19_SilentSporeBreaches_MEP",
                "ToxicFog_Iteration20_BoundaryPoisonVeils_MEP"
            };
            Transform[] toxicRoots = toxicRootNames
                .Select(name => FindDescendant(effectsRoot, name)).ToArray();
            Require(toxicRoots.All(root => root != null),
                "the final toxic-fog audit cannot find every iteration root");
            MeshRenderer[] toxicRenderers = toxicRoots
                .SelectMany(root => root.GetComponentsInChildren<MeshRenderer>(true))
                .ToArray();
            Require(toxicRenderers.Length == MaximumFinalToxicRendererCount,
                "complete toxic-fog stage must remain at twenty renderers");
            Material[] toxicMaterials = toxicRenderers.Select(renderer =>
                    renderer != null ? renderer.sharedMaterial : null)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(toxicMaterials.Length == MaximumFinalToxicMaterialCount,
                "complete toxic-fog stage must remain at five materials");
            Mesh[] toxicMeshes = toxicRenderers.Select(renderer =>
                    renderer != null
                        ? renderer.GetComponent<MeshFilter>()?.sharedMesh : null)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(toxicMeshes.Length == MaximumFinalToxicMeshCount
                    && toxicMeshes.Contains(verticalMesh)
                    && toxicMeshes.Contains(horizontalMesh),
                "complete toxic-fog stage must reuse exactly two fog meshes");
            Require(toxicMaterials.All(candidate =>
                    candidate.shader != null && candidate.shader.isSupported
                    && candidate.shader.name == ToxicFogShaderName
                    && candidate.GetTexture("_BaseMap") == source
                    && candidate.enableInstancing),
                "a toxic-fog material lost its shader, MEP atlas or instancing");
            Require(toxicRenderers.All(renderer =>
                    renderer.shadowCastingMode == ShadowCastingMode.Off
                    && !renderer.receiveShadows
                    && !renderer.allowOcclusionWhenDynamic
                    && renderer.gameObject.activeInHierarchy),
                "a toxic-fog renderer can cast shadows, hide or deactivate");
            Require(toxicRoots.SelectMany(root =>
                    root.GetComponentsInChildren<ParticleSystem>(true)).Count() == 0,
                "toxic fog must not use ParticleSystem simulation");
            Require(toxicRoots.SelectMany(root =>
                    root.GetComponentsInChildren<Light>(true)).Count() == 0,
                "toxic fog must not create local lights");
            Require(toxicRoots.SelectMany(root =>
                    root.GetComponentsInChildren<LODGroup>(true)).Count() == 0,
                "toxic fog must not disappear through LOD groups");
            Require(toxicRoots.SelectMany(root =>
                    root.GetComponentsInChildren<Collider>(true))
                .All(collider => collider == null || !collider.enabled),
                "toxic fog contains an active collider");

            MeshRenderer[] allEffectRenderers = effectsRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(allEffectRenderers.Length == MaximumAllEffectRendererCount,
                "the complete effect stage exceeds the 78-renderer budget");
            Material[] allEffectMaterials = allEffectRenderers
                .Select(renderer => renderer.sharedMaterial)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(allEffectMaterials.Length == MaximumAllEffectMaterialCount,
                "the complete effect stage must reuse exactly nineteen materials");
            Mesh[] allEffectMeshes = allEffectRenderers.Select(renderer =>
                    renderer.GetComponent<MeshFilter>()?.sharedMesh)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(allEffectMeshes.Length == MaximumAllEffectMeshCount,
                "the complete effect stage must reuse exactly four meshes");
            Require(allEffectMeshes.All(candidate => candidate.vertexCount <= 24),
                "an effect mesh exceeds the reviewed 24-vertex ceiling");
            Require(allEffectMaterials.All(candidate => candidate.shader != null
                    && candidate.shader.isSupported && candidate.HasProperty("_BaseMap")
                    && candidate.GetTexture("_BaseMap") != null
                    && candidate.renderQueue >= (int)RenderQueue.Transparent),
                "an effect material is unsupported, untextured or opaque");
            Require(allEffectRenderers.All(renderer =>
                    renderer.shadowCastingMode == ShadowCastingMode.Off
                    && !renderer.receiveShadows
                    && renderer.GetComponent<MeshFilter>()?.sharedMesh != null
                    && renderer.gameObject.activeInHierarchy),
                "an effect renderer is shadowed, unmeshed or inactive");
            Require(effectsRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "the complete effect stage must remain simulation-free");
            Require(effectsRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "the complete effect stage must not create local lights");
            Require(effectsRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "the complete effect stage must not hide through distance LODs");
            Require(effectsRoot.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "the complete effect stage contains an active collider");

            Debug.Log("[KROMKA EFFECTS 100%] PASS: four dark poison veils "
                + "complete the Silent Ring boundary. The full cinematic "
                + "effect language uses 78 static renderers, nineteen textured "
                + "materials and four meshes of at most 24 vertices, with no "
                + "particles, lights, colliders, shadows or distance LODs.");
        }

        private static void BuildToxicPatch(Transform parent, ToxicPatch row,
                                            Mesh mesh, Material material,
                                            float groundOffset)
        {
            var patch = new GameObject(row.Name);
            patch.transform.SetParent(parent, false);
            patch.transform.position = MapToWorld(row.MapX, row.MapY)
                + new Vector3(0f, groundOffset, 0f);
            patch.transform.rotation = Quaternion.Euler(0f, row.Yaw, 0f);
            patch.transform.localScale = row.Scale;

            MeshFilter filter = patch.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            MeshRenderer renderer = patch.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            renderer.allowOcclusionWhenDynamic = false;
            GameObjectUtility.SetStaticEditorFlags(patch,
                StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Material BuildToxicMaterial(string path, string name,
                                                   Color body, Color core,
                                                   float frameRate,
                                                   float driftAmount,
                                                   float pulseSpeed,
                                                   float glowStrength)
        {
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ToxicFogTexturePath);
            if (source == null)
                throw new InvalidOperationException(
                    "Licensed MEP toxic-fog atlas is unavailable");
            Shader shader = Shader.Find(ToxicFogShaderName);
            if (shader == null)
                throw new InvalidOperationException(
                    "Kromka toxic-fog shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.shader = shader;
            material.name = name;
            material.SetTexture("_BaseMap", source);
            material.SetColor("_BaseColor", body);
            material.SetColor("_GlowColor", core);
            material.SetFloat("_AlphaCutoff", 0.006f);
            material.SetFloat("_FrameRate", frameRate);
            material.SetFloat("_DriftAmount", driftAmount);
            material.SetFloat("_PulseSpeed", pulseSpeed);
            material.SetFloat("_GlowStrength", glowStrength);
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)RenderQueue.Transparent + 15;
            material.shaderKeywords = Array.Empty<string>();
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null
                    && material.shader.isSupported
                    && material.shader.name == ToxicFogShaderName,
                "toxic-fog material is missing or unsupported: " + path);
            return material;
        }

        private static Mesh RequireMesh(string path)
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            Require(mesh != null && mesh.vertexCount == 12,
                "reviewed twelve-vertex fog mesh is missing: " + path);
            return mesh;
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
                    "Kromka toxic-fog validation failed: " + message);
        }
    }
}
#endif
