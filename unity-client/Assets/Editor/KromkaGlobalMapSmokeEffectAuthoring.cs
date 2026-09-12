#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Cinematic-effects iterations 11-15/20. Iteration 11 anchors compact,
    /// shader-animated smoke columns directly to the upper bounds of authored
    /// Ore Arc machinery. This makes the effect follow the models precisely
    /// without ParticleSystems, gameplay colliders or distance LODs.
    /// </summary>
    internal static class KromkaGlobalMapSmokeEffectAuthoring
    {
        internal const int SmokeIteration11 = 11;
        internal const int SmokeIteration12 = 12;
        internal const int SmokeIteration13 = 13;
        internal const int SmokeIteration14 = 14;
        internal const int SmokeIteration15 = 15;
        private const int ExpectedOreSmokeCount = 4;
        private const int ExpectedKilnSmokeCount = 2;
        private const int ExpectedRegeneratorExhaustCount = 3;
        private const int ExpectedFireVentSmokeCount = 5;
        private const int ExpectedRemoteFailureSmokeCount = 4;
        private const int PuffsPerColumn = 6;
        private const int VerticesPerPuff = 4;
        private const int MaximumOreSmokeRendererCount = 4;
        private const int MaximumCumulativeSmokeRendererCount12 = 6;
        private const int MaximumCumulativeSmokeRendererCount13 = 9;
        private const int MaximumCumulativeSmokeRendererCount14 = 14;
        private const int MaximumFinalSmokeRendererCount = 18;
        private const int MaximumFinalSmokeMaterialCount = 5;
        private const int MaximumFinalSmokeMeshCount = 1;

        private const string SmokeTexturePath =
            "Assets/MEP/MEP_Environment/MEP_FX/MEP_Clouds/Textures/AEP_Smoke_02.png";
        private const string SmokeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_OreIndustrialSmoke_MEP.mat";
        private const string KilnSmokeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_CeramicKilnSmoke_MEP.mat";
        private const string RegeneratorSmokeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_RegeneratorExhaust_MEP.mat";
        private const string FireVentSmokeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_FireVentSmoke_MEP.mat";
        private const string FailureSmokeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_RemoteFailureSmoke_MEP.mat";
        private const string SmokeMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_Effect_SmokeColumn.asset";
        private const string SmokeShaderName =
            "Kromka/Global Map/Industrial Smoke";

        private readonly struct SmokeEmitter
        {
            public readonly string Name;
            public readonly string TargetName;
            public readonly float Yaw;
            public readonly Vector3 Scale;

            public SmokeEmitter(string name, string targetName, float yaw,
                                Vector3 scale)
            {
                Name = name;
                TargetName = targetName;
                Yaw = yaw;
                Scale = scale;
            }
        }

        private static readonly SmokeEmitter[] OreIndustrialSmoke =
        {
            new SmokeEmitter("PitWorks_CrusherSmoke",
                "PitWorks_CrusherHall", -11f,
                new Vector3(0.66f, 0.72f, 0.66f)),
            new SmokeEmitter("WesternFoundry_TowerSoot",
                "WesternFoundry_MainHall", 17f,
                new Vector3(0.72f, 0.80f, 0.72f)),
            new SmokeEmitter("WesternFoundry_HopperSoot",
                "WesternFoundry_ServiceHall", -26f,
                new Vector3(0.58f, 0.64f, 0.58f)),
            new SmokeEmitter("OreExchange_TowerSmoke",
                "OreExchange_LoadingHall", 8f,
                new Vector3(0.64f, 0.70f, 0.64f))
        };

        private static readonly SmokeEmitter[] CeramicKilnSmoke =
        {
            new SmokeEmitter("CeramicKiln_0_PaleSmoke",
                "Chalk_KilnGarage_West", -8f,
                new Vector3(0.48f, 0.60f, 0.48f)),
            new SmokeEmitter("CeramicKiln_1_PaleSmoke",
                "Chalk_KilnGarage_East", 18f,
                new Vector3(0.52f, 0.64f, 0.52f))
        };

        private static readonly SmokeEmitter[] RegeneratorExhaust =
        {
            new SmokeEmitter("R12_AuxiliaryTower_ColdExhaust",
                "Zero_ServiceSubstation", 4f,
                new Vector3(0.54f, 0.66f, 0.54f)),
            new SmokeEmitter("R12_GeneratorWest_ColdExhaust",
                "Zero_SealedGarage", -19f,
                new Vector3(0.42f, 0.52f, 0.42f)),
            new SmokeEmitter("R12_GeneratorEast_ColdExhaust",
                "Zero_WestPanelShell", 22f,
                new Vector3(0.40f, 0.50f, 0.40f))
        };

        private static readonly SmokeEmitter[] FireVentSmoke =
        {
            new SmokeEmitter("GloomVent_00_Smoke",
                "SilentRing_AbandonedGarage", -16f,
                new Vector3(0.42f, 0.54f, 0.42f)),
            new SmokeEmitter("GloomVent_01_Smoke",
                "SilentRing_DeadSubstation", 21f,
                new Vector3(0.46f, 0.60f, 0.46f)),
            new SmokeEmitter("GloomVent_02_Smoke",
                "Storehouse_CraterGarage", -29f,
                new Vector3(0.40f, 0.52f, 0.40f)),
            new SmokeEmitter("GloomVent_03_Smoke",
                "Ravine_MaintenanceGarage", 13f,
                new Vector3(0.44f, 0.57f, 0.44f)),
            new SmokeEmitter("GloomVent_04_Smoke",
                "Glasslands_FieldGarage", 32f,
                new Vector3(0.38f, 0.50f, 0.38f))
        };

        private static readonly SmokeEmitter[] RemoteFailureSmoke =
        {
            new SmokeEmitter("FoldedGenerator_IntermittentSmoke",
                "Tract_Substation", -14f,
                new Vector3(0.44f, 0.56f, 0.44f)),
            new SmokeEmitter("BurrowerTower_IntermittentSmoke",
                "Glasslands_VectorSubstation", 19f,
                new Vector3(0.50f, 0.64f, 0.50f)),
            new SmokeEmitter("RelayB9_BackupGeneratorSmoke",
                "NorthGrid_Substation", -25f,
                new Vector3(0.40f, 0.50f, 0.40f)),
            new SmokeEmitter("ExperimentalWorkshop_GeneratorSmoke",
                "Roadside_EastGarage", 11f,
                new Vector3(0.42f, 0.53f, 0.42f))
        };

        internal static void ComposeIteration11(Transform parent)
        {
            Material material = BuildSmokeMaterial();
            Mesh mesh = BuildSmokeMesh();
            Transform root = Child(parent,
                "Smoke_Iteration11_OreArcIndustrialSoot_MEP");
            Transform modelRoot = RequireModelRoot();
            for (int i = 0; i < OreIndustrialSmoke.Length; i++)
                BuildSmokeColumn(root, modelRoot, OreIndustrialSmoke[i],
                    mesh, material);

            Child(parent, "OreIndustrialSmokeColumns_4_REFERENCE");
            Child(parent, "AEPIndustrialSmokeTexture_REFERENCE");
            Child(parent, "ModelTopAnchoredSmoke_REFERENCE");
            Child(parent, "NoParticleSmoke_REFERENCE");
            Child(parent, "EffectIteration_11_of_20");
        }

        internal static void ComposeIteration12(Transform parent)
        {
            Material material = BuildTintedSmokeMaterial(KilnSmokeMaterialPath,
                "Kromka_Effect_CeramicKilnSmoke_MEP",
                new Color(0.62f, 0.58f, 0.49f, 0.52f),
                0.060f, 0.30f, 0.045f);
            Mesh mesh = RequireSmokeMesh();
            Transform root = Child(parent,
                "Smoke_Iteration12_CeramicKilnPaleSmoke_MEP");
            Transform modelRoot = RequireModelRoot();
            for (int i = 0; i < CeramicKilnSmoke.Length; i++)
                BuildSmokeColumn(root, modelRoot, CeramicKilnSmoke[i],
                    mesh, material);

            Child(parent, "CeramicKilnSmokeColumns_2_REFERENCE");
            Child(parent, "PaleChalkSmokeLanguage_REFERENCE");
            Child(parent, "KilnTopAnchoredSmoke_REFERENCE");
            Child(parent, "EffectIteration_12_of_20");
        }

        internal static void ComposeIteration13(Transform parent)
        {
            Material material = BuildTintedSmokeMaterial(
                RegeneratorSmokeMaterialPath,
                "Kromka_Effect_RegeneratorExhaust_MEP",
                new Color(0.48f, 0.58f, 0.60f, 0.46f),
                0.105f, 0.34f, 0.052f);
            Mesh mesh = RequireSmokeMesh();
            Transform root = Child(parent,
                "Smoke_Iteration13_RegeneratorColdExhaust_MEP");
            Transform modelRoot = RequireModelRoot();
            for (int i = 0; i < RegeneratorExhaust.Length; i++)
                BuildSmokeColumn(root, modelRoot, RegeneratorExhaust[i],
                    mesh, material);

            Child(parent, "RegeneratorExhaustColumns_3_REFERENCE");
            Child(parent, "ColdTechnicalExhaustLanguage_REFERENCE");
            Child(parent, "R12MachineTopAnchors_REFERENCE");
            Child(parent, "EffectIteration_13_of_20");
        }

        internal static void ComposeIteration14(Transform parent)
        {
            Material material = BuildTintedSmokeMaterial(
                FireVentSmokeMaterialPath,
                "Kromka_Effect_FireVentSmoke_MEP",
                new Color(0.22f, 0.19f, 0.16f, 0.64f),
                0.092f, 0.36f, 0.070f);
            Mesh mesh = RequireSmokeMesh();
            Transform root = Child(parent,
                "Smoke_Iteration14_GloomSubsurfaceVents_MEP");
            Transform modelRoot = RequireModelRoot();
            for (int i = 0; i < FireVentSmoke.Length; i++)
                BuildSmokeColumn(root, modelRoot, FireVentSmoke[i],
                    mesh, material);

            Child(parent, "GloomFireVentSmokeColumns_5_REFERENCE");
            Child(parent, "HotSubsurfaceSmokeLanguage_REFERENCE");
            Child(parent, "FireVentTopAnchors_REFERENCE");
            Child(parent, "EffectIteration_14_of_20");
        }

        internal static void ComposeIteration15(Transform parent)
        {
            Material material = BuildTintedSmokeMaterial(
                FailureSmokeMaterialPath,
                "Kromka_Effect_RemoteFailureSmoke_MEP",
                new Color(0.31f, 0.295f, 0.27f, 0.56f),
                0.070f, 0.32f, 0.062f);
            Mesh mesh = RequireSmokeMesh();
            Transform root = Child(parent,
                "Smoke_Iteration15_RemoteFailureSources_MEP");
            Transform modelRoot = RequireModelRoot();
            for (int i = 0; i < RemoteFailureSmoke.Length; i++)
                BuildSmokeColumn(root, modelRoot, RemoteFailureSmoke[i],
                    mesh, material);

            Child(parent, "RemoteFailureSmokeColumns_4_REFERENCE");
            Child(parent, "IntermittentGeneratorSmoke_REFERENCE");
            Child(parent, "SmokeStageGlobalAudit_REFERENCE");
            Child(parent, "EffectIteration_15_of_20");
        }

        internal static void ValidateIteration11()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 11 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "OreIndustrialSmokeColumns_4_REFERENCE",
                "AEPIndustrialSmokeTexture_REFERENCE",
                "ModelTopAnchoredSmoke_REFERENCE",
                "NoParticleSmoke_REFERENCE",
                "EffectIteration_11_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(OreIndustrialSmoke.Length == ExpectedOreSmokeCount,
                "four reviewed Ore Arc smoke columns are required");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                SmokeTexturePath);
            Material material = RequireMaterial(SmokeMaterialPath);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(SmokeMeshPath);
            Require(source != null && material.GetTexture("_BaseMap") == source,
                "industrial smoke lost its licensed AEP/MEP texture");
            Require(material.enableInstancing,
                "industrial smoke material is not instancing-ready");
            Require(mesh != null
                    && mesh.vertexCount == PuffsPerColumn * VerticesPerPuff,
                "optimized six-puff smoke-column mesh is missing");

            Transform smokeRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration11_OreArcIndustrialSoot_MEP");
            Require(smokeRoot != null
                    && smokeRoot.childCount == ExpectedOreSmokeCount,
                "Ore Arc smoke hierarchy is incomplete");
            Transform modelRoot = RequireModelRoot();
            MeshRenderer[] renderers = smokeRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(renderers.Length == MaximumOreSmokeRendererCount,
                "Ore Arc smoke must remain at four renderers");

            for (int i = 0; i < OreIndustrialSmoke.Length; i++)
            {
                SmokeEmitter row = OreIndustrialSmoke[i];
                Transform smoke = smokeRoot.Find(row.Name);
                Transform target = FindDescendant(modelRoot, row.TargetName);
                Require(smoke != null, row.Name + " is missing");
                Require(target != null, row.TargetName + " model target is missing");
                Require(TryGetBounds(target, out Bounds targetBounds),
                    row.TargetName + " model target has no renderer");
                MeshFilter filter = smoke.GetComponent<MeshFilter>();
                MeshRenderer renderer = smoke.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the optimized smoke mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the industrial smoke material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require((GameObjectUtility.GetStaticEditorFlags(smoke.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
                Vector2 smokePlanar = new Vector2(smoke.position.x, smoke.position.z);
                Vector2 targetPlanar = new Vector2(targetBounds.center.x,
                    targetBounds.center.z);
                Require(Vector2.Distance(smokePlanar, targetPlanar) <= 0.02f,
                    row.Name + " is horizontally detached from its machine");
                Require(Mathf.Abs(renderer.bounds.min.y
                        - (targetBounds.max.y + 0.015f)) <= 0.025f,
                    row.Name + " intersects or floats above its machine outlet");
            }

            Require(smokeRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "industrial smoke must not rely on ParticleSystem simulation");
            Require(smokeRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "industrial smoke must not create local lights");
            Require(smokeRoot.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "industrial smoke contains an active collider");
            Require(smokeRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "industrial smoke can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 55%] PASS: four dark AEP/MEP smoke "
                + "columns are anchored to the exact upper bounds of Ore Arc "
                + "machinery. Four renderers share one twenty-four-vertex mesh "
                + "and one instancing-ready material without particles, lights, "
                + "colliders or distance LODs.");
        }

        internal static void ValidateIteration12()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 12 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "CeramicKilnSmokeColumns_2_REFERENCE",
                "PaleChalkSmokeLanguage_REFERENCE",
                "KilnTopAnchoredSmoke_REFERENCE",
                "EffectIteration_12_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(CeramicKilnSmoke.Length == ExpectedKilnSmokeCount,
                "two reviewed ceramic-kiln smoke columns are required");

            Material material = RequireMaterial(KilnSmokeMaterialPath);
            Mesh mesh = RequireSmokeMesh();
            Transform oreRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration11_OreArcIndustrialSoot_MEP");
            Transform kilnRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration12_CeramicKilnPaleSmoke_MEP");
            Require(oreRoot != null,
                "kiln smoke cannot discard the accepted Ore Arc smoke");
            Require(kilnRoot != null
                    && kilnRoot.childCount == ExpectedKilnSmokeCount,
                "ceramic-kiln smoke hierarchy is incomplete");
            Transform modelRoot = RequireModelRoot();

            ValidateAnchoredSmokeSet(kilnRoot, modelRoot, CeramicKilnSmoke,
                mesh, material, "ceramic kiln");
            int cumulativeRenderers = oreRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + kilnRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeSmokeRendererCount12,
                "first two smoke passes must remain at six renderers");
            Require(kilnRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "kiln smoke must not introduce particle simulation");
            Require(kilnRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "kiln smoke can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 60%] PASS: two pale, slow-rising "
                + "AEP/MEP smoke columns sit on the exact upper bounds of the "
                + "Ceramic Ledge kilns. Six cumulative smoke renderers still "
                + "share one twenty-four-vertex mesh without particles or LODs.");
        }

        internal static void ValidateIteration13()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 13 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "RegeneratorExhaustColumns_3_REFERENCE",
                "ColdTechnicalExhaustLanguage_REFERENCE",
                "R12MachineTopAnchors_REFERENCE",
                "EffectIteration_13_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(RegeneratorExhaust.Length == ExpectedRegeneratorExhaustCount,
                "three reviewed Regenerator exhaust columns are required");

            Material material = RequireMaterial(RegeneratorSmokeMaterialPath);
            Mesh mesh = RequireSmokeMesh();
            Transform oreRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration11_OreArcIndustrialSoot_MEP");
            Transform kilnRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration12_CeramicKilnPaleSmoke_MEP");
            Transform regeneratorRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration13_RegeneratorColdExhaust_MEP");
            Require(oreRoot != null && kilnRoot != null,
                "Regenerator exhaust cannot discard an accepted smoke layer");
            Require(regeneratorRoot != null
                    && regeneratorRoot.childCount
                        == ExpectedRegeneratorExhaustCount,
                "Regenerator exhaust hierarchy is incomplete");

            ValidateAnchoredSmokeSet(regeneratorRoot, RequireModelRoot(),
                RegeneratorExhaust, mesh, material, "Regenerator machine");
            int cumulativeRenderers = oreRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + kilnRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + regeneratorRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeSmokeRendererCount13,
                "first three smoke passes must remain at nine renderers");
            Require(regeneratorRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "Regenerator exhaust must not introduce particle simulation");
            Require(regeneratorRoot.GetComponentsInChildren<LODGroup>(true)
                    .Length == 0,
                "Regenerator exhaust can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 65%] PASS: three compact cold exhaust "
                + "columns distinguish the active Regenerator-12 machinery. "
                + "Nine cumulative renderers reuse the same twenty-four-vertex "
                + "mesh with model-top anchoring and no particles or LODs.");
        }

        internal static void ValidateIteration14()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 14 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "GloomFireVentSmokeColumns_5_REFERENCE",
                "HotSubsurfaceSmokeLanguage_REFERENCE",
                "FireVentTopAnchors_REFERENCE",
                "EffectIteration_14_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(FireVentSmoke.Length == ExpectedFireVentSmokeCount,
                "five reviewed Gloom fire-vent smoke columns are required");

            Material material = RequireMaterial(FireVentSmokeMaterialPath);
            Mesh mesh = RequireSmokeMesh();
            Transform oreRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration11_OreArcIndustrialSoot_MEP");
            Transform kilnRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration12_CeramicKilnPaleSmoke_MEP");
            Transform regeneratorRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration13_RegeneratorColdExhaust_MEP");
            Transform ventRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration14_GloomSubsurfaceVents_MEP");
            Require(oreRoot != null && kilnRoot != null && regeneratorRoot != null,
                "fire-vent smoke cannot discard an accepted smoke layer");
            Require(ventRoot != null
                    && ventRoot.childCount == ExpectedFireVentSmokeCount,
                "Gloom fire-vent smoke hierarchy is incomplete");

            ValidateAnchoredSmokeSet(ventRoot, RequireModelRoot(),
                FireVentSmoke, mesh, material, "subsurface fire vent");
            int cumulativeRenderers = oreRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + kilnRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + regeneratorRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + ventRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeSmokeRendererCount14,
                "first four smoke passes must remain at fourteen renderers");
            Require(ventRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "fire-vent smoke must not introduce particle simulation");
            Require(ventRoot.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "fire-vent smoke can disappear with camera distance");

            Debug.Log("[KROMKA EFFECTS 70%] PASS: five compact dark smoke "
                + "columns rise from the exact upper bounds of the Gloom "
                + "subsurface fire vents. Fourteen cumulative renderers remain "
                + "model-anchored, particle-free and free of distance LODs.");
        }

        internal static void ValidateIteration15()
        {
            GameObject effectsObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 15 root is missing from the global map");
            Transform effectsRoot = effectsObject.transform;
            string[] markers =
            {
                "RemoteFailureSmokeColumns_4_REFERENCE",
                "IntermittentGeneratorSmoke_REFERENCE",
                "SmokeStageGlobalAudit_REFERENCE",
                "EffectIteration_15_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(RemoteFailureSmoke.Length == ExpectedRemoteFailureSmokeCount,
                "four reviewed remote failure-smoke columns are required");

            Material failureMaterial = RequireMaterial(FailureSmokeMaterialPath);
            Mesh sharedMesh = RequireSmokeMesh();
            Transform failureRoot = FindDescendant(effectsRoot,
                "Smoke_Iteration15_RemoteFailureSources_MEP");
            Require(failureRoot != null
                    && failureRoot.childCount == ExpectedRemoteFailureSmokeCount,
                "remote failure-smoke hierarchy is incomplete");
            ValidateAnchoredSmokeSet(failureRoot, RequireModelRoot(),
                RemoteFailureSmoke, sharedMesh, failureMaterial,
                "remote failure source");

            string[] smokeRootNames =
            {
                "Smoke_Iteration11_OreArcIndustrialSoot_MEP",
                "Smoke_Iteration12_CeramicKilnPaleSmoke_MEP",
                "Smoke_Iteration13_RegeneratorColdExhaust_MEP",
                "Smoke_Iteration14_GloomSubsurfaceVents_MEP",
                "Smoke_Iteration15_RemoteFailureSources_MEP"
            };
            Transform[] smokeRoots = smokeRootNames
                .Select(name => FindDescendant(effectsRoot, name)).ToArray();
            Require(smokeRoots.All(root => root != null),
                "the final smoke audit cannot find every smoke iteration root");
            MeshRenderer[] renderers = smokeRoots
                .SelectMany(root => root.GetComponentsInChildren<MeshRenderer>(true))
                .ToArray();
            Require(renderers.Length == MaximumFinalSmokeRendererCount,
                "complete smoke stage must remain at eighteen renderers");
            Material[] materials = renderers.Select(renderer =>
                    renderer != null ? renderer.sharedMaterial : null)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(materials.Length == MaximumFinalSmokeMaterialCount,
                "complete smoke stage must remain at five shared materials");
            Mesh[] meshes = renderers.Select(renderer =>
                    renderer != null
                        ? renderer.GetComponent<MeshFilter>()?.sharedMesh : null)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(meshes.Length == MaximumFinalSmokeMeshCount
                    && meshes[0] == sharedMesh,
                "complete smoke stage must reuse one optimized mesh");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                SmokeTexturePath);
            Require(source != null && materials.All(material =>
                    material.shader != null && material.shader.isSupported
                    && material.shader.name == SmokeShaderName
                    && material.GetTexture("_BaseMap") == source
                    && material.enableInstancing),
                "a final smoke material lost its AEP/MEP texture, shader or instancing");
            for (int i = 0; i < renderers.Length; i++)
            {
                MeshRenderer renderer = renderers[i];
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    renderer.name + " drifted outside the shadow-free budget");
                Require(!renderer.allowOcclusionWhenDynamic,
                    renderer.name + " can disappear through dynamic occlusion");
                Require((GameObjectUtility.GetStaticEditorFlags(renderer.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    renderer.name + " is no longer batching-static");
            }
            Require(smokeRoots.Sum(root => root
                    .GetComponentsInChildren<ParticleSystem>(true).Length) == 0,
                "complete smoke stage must not contain particle systems");
            Require(smokeRoots.Sum(root => root
                    .GetComponentsInChildren<Light>(true).Length) == 0,
                "complete smoke stage must not contain local lights");
            Require(smokeRoots.Sum(root => root
                    .GetComponentsInChildren<LODGroup>(true).Length) == 0,
                "complete smoke stage contains a distance LOD");
            Require(smokeRoots.SelectMany(root => root
                    .GetComponentsInChildren<Collider>(true))
                    .All(collider => collider == null || !collider.enabled),
                "complete smoke stage contains an active collider");

            Debug.Log("[KROMKA EFFECTS 75%] PASS: four intermittent remote "
                + "failure plumes complete the smoke stage. Eighteen "
                + "model-anchored renderers reuse one twenty-four-vertex mesh "
                + "and five AEP/MEP materials with no particles, lights, "
                + "colliders, occlusion hiding or distance LODs.");
        }

        private static void BuildSmokeColumn(Transform parent,
                                             Transform modelRoot,
                                             SmokeEmitter row,
                                             Mesh mesh, Material material)
        {
            Transform target = FindDescendant(modelRoot, row.TargetName);
            if (target == null || !TryGetBounds(target, out Bounds targetBounds))
                throw new InvalidOperationException(
                    "Smoke target is missing or has no renderer: " + row.TargetName);

            var smoke = new GameObject(row.Name);
            smoke.transform.SetParent(parent, false);
            smoke.transform.position = new Vector3(targetBounds.center.x,
                targetBounds.max.y + 0.015f, targetBounds.center.z);
            smoke.transform.rotation = Quaternion.Euler(0f, row.Yaw, 0f);
            // The extended close zoom made the old columns tower over whole
            // districts. Retain readable activity without turning smoke into
            // another map-sized landmark.
            smoke.transform.localScale = row.Scale * 0.58f;

            MeshFilter filter = smoke.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            MeshRenderer renderer = smoke.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            renderer.allowOcclusionWhenDynamic = false;
            GameObjectUtility.SetStaticEditorFlags(smoke,
                StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Mesh BuildSmokeMesh()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(SmokeMeshPath);
            bool fresh = mesh == null;
            if (fresh) mesh = new Mesh { name = "Kromka_Effect_SmokeColumn" };
            else mesh.Clear();

            Vector3[] vertices = new Vector3[PuffsPerColumn * VerticesPerPuff];
            Vector2[] uv = new Vector2[vertices.Length];
            Color[] colors = new Color[vertices.Length];
            int[] triangles = new int[PuffsPerColumn * 6];
            AddPuff(vertices, uv, colors, triangles, 0,
                new Vector3(-0.06f, 0.28f, 0.00f), 0.48f, 0.56f, -15f,
                new Color(0.78f, 0.05f, 0f, 1f));
            AddPuff(vertices, uv, colors, triangles, 1,
                new Vector3(0.07f, 0.35f, 0.02f), 0.52f, 0.64f, 65f,
                new Color(0.72f, 0.22f, 0f, 1f));
            AddPuff(vertices, uv, colors, triangles, 2,
                new Vector3(-0.05f, 0.82f, 0.01f), 0.66f, 0.76f, 10f,
                new Color(0.68f, 0.37f, 0f, 1f));
            AddPuff(vertices, uv, colors, triangles, 3,
                new Vector3(0.07f, 0.90f, -0.02f), 0.72f, 0.84f, 92f,
                new Color(0.64f, 0.54f, 0f, 1f));
            AddPuff(vertices, uv, colors, triangles, 4,
                new Vector3(-0.08f, 1.38f, 0.03f), 0.84f, 1.00f, -20f,
                new Color(0.58f, 0.69f, 0f, 1f));
            AddPuff(vertices, uv, colors, triangles, 5,
                new Vector3(0.10f, 1.48f, -0.04f), 0.92f, 1.08f, 70f,
                new Color(0.54f, 0.86f, 0f, 1f));

            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.colors = colors;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(false);
            if (fresh) AssetDatabase.CreateAsset(mesh, SmokeMeshPath);
            EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static void AddPuff(Vector3[] vertices, Vector2[] uv,
                                    Color[] colors, int[] triangles,
                                    int puffIndex, Vector3 centre,
                                    float width, float height,
                                    float yaw, Color data)
        {
            int vertex = puffIndex * VerticesPerPuff;
            float radians = yaw * Mathf.Deg2Rad;
            Vector3 right = new Vector3(Mathf.Cos(radians), 0f,
                Mathf.Sin(radians)) * (width * 0.5f);
            Vector3 up = Vector3.up * (height * 0.5f);
            vertices[vertex + 0] = centre - right - up;
            vertices[vertex + 1] = centre + right - up;
            vertices[vertex + 2] = centre + right + up;
            vertices[vertex + 3] = centre - right + up;
            uv[vertex + 0] = new Vector2(0f, 0f);
            uv[vertex + 1] = new Vector2(1f, 0f);
            uv[vertex + 2] = new Vector2(1f, 1f);
            uv[vertex + 3] = new Vector2(0f, 1f);
            for (int i = 0; i < VerticesPerPuff; i++) colors[vertex + i] = data;

            int triangle = puffIndex * 6;
            triangles[triangle + 0] = vertex + 0;
            triangles[triangle + 1] = vertex + 2;
            triangles[triangle + 2] = vertex + 1;
            triangles[triangle + 3] = vertex + 0;
            triangles[triangle + 4] = vertex + 3;
            triangles[triangle + 5] = vertex + 2;
        }

        private static Material BuildSmokeMaterial()
        {
            return BuildTintedSmokeMaterial(SmokeMaterialPath,
                "Kromka_Effect_OreIndustrialSmoke_MEP",
                new Color(0.28f, 0.245f, 0.21f, 0.68f),
                0.078f, 0.38f, 0.075f);
        }

        private static Material BuildTintedSmokeMaterial(string path,
                                                         string name,
                                                         Color tint,
                                                         float riseSpeed,
                                                         float riseDistance,
                                                         float swayAmount)
        {
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                SmokeTexturePath);
            if (source == null)
                throw new InvalidOperationException(
                    "Licensed AEP/MEP smoke texture is unavailable");
            Shader shader = Shader.Find(SmokeShaderName);
            if (shader == null)
                throw new InvalidOperationException(
                    "Kromka industrial-smoke shader is unavailable");
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
            material.SetFloat("_RiseSpeed", riseSpeed);
            material.SetFloat("_RiseDistance", riseDistance);
            material.SetFloat("_SwayAmount", swayAmount);
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)RenderQueue.Transparent + 10;
            material.shaderKeywords = Array.Empty<string>();
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Mesh RequireSmokeMesh()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(SmokeMeshPath);
            Require(mesh != null
                    && mesh.vertexCount == PuffsPerColumn * VerticesPerPuff,
                "shared optimized smoke-column mesh is missing");
            return mesh;
        }

        private static void ValidateAnchoredSmokeSet(Transform smokeRoot,
                                                     Transform modelRoot,
                                                     SmokeEmitter[] rows,
                                                     Mesh mesh,
                                                     Material material,
                                                     string label)
        {
            for (int i = 0; i < rows.Length; i++)
            {
                SmokeEmitter row = rows[i];
                Transform smoke = smokeRoot.Find(row.Name);
                Transform target = FindDescendant(modelRoot, row.TargetName);
                Require(smoke != null, row.Name + " is missing");
                Require(target != null, row.TargetName + " target is missing");
                Require(TryGetBounds(target, out Bounds targetBounds),
                    row.TargetName + " target has no renderer");
                MeshFilter filter = smoke.GetComponent<MeshFilter>();
                MeshRenderer renderer = smoke.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the optimized smoke mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " lost the " + label + " smoke material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Vector2 smokePlanar = new Vector2(smoke.position.x, smoke.position.z);
                Vector2 targetPlanar = new Vector2(targetBounds.center.x,
                    targetBounds.center.z);
                Require(Vector2.Distance(smokePlanar, targetPlanar) <= 0.02f,
                    row.Name + " is horizontally detached from " + label);
                Require(Mathf.Abs(renderer.bounds.min.y
                        - (targetBounds.max.y + 0.015f)) <= 0.025f,
                    row.Name + " intersects or floats above " + label);
                Require((GameObjectUtility.GetStaticEditorFlags(smoke.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
            }
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null
                    && material.shader.isSupported
                    && material.shader.name == SmokeShaderName,
                "smoke material is missing or unsupported: " + path);
            return material;
        }

        private static Transform RequireModelRoot()
        {
            GameObject modelObject = GameObject.Find(
                "EnvironmentModels_ModelPass_EDITABLE");
            if (modelObject == null)
                throw new InvalidOperationException(
                    "Smoke authoring cannot find the environment-model root");
            return modelObject.transform;
        }

        private static bool TryGetBounds(Transform target, out Bounds bounds)
        {
            Renderer[] renderers = target != null
                ? target.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled)
                    .ToArray()
                : Array.Empty<Renderer>();
            if (renderers.Length == 0)
            {
                bounds = default;
                return false;
            }
            bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
            return true;
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
                    "Kromka smoke-effect validation failed: " + message);
        }
    }
}
#endif
