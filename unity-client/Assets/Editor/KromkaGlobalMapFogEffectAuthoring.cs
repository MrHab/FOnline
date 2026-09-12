#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Cinematic-effects iterations 06-10/20. Iteration 06 lays the first
    /// low, animated mist banks along the Tesma. The animation lives entirely
    /// in a transparent shader and a licensed MEP 4x4 fog atlas, keeping the
    /// strategic map free of ParticleSystem simulation and gameplay colliders.
    /// </summary>
    internal static class KromkaGlobalMapFogEffectAuthoring
    {
        internal const int FogIteration06 = 6;
        internal const int FogIteration07 = 7;
        internal const int FogIteration08 = 8;
        internal const int FogIteration09 = 9;
        internal const int FogIteration10 = 10;
        private const int ExpectedRiverBankCount = 5;
        private const int ExpectedReservoirBankCount = 3;
        private const int ExpectedChalkMistCount = 4;
        private const int ExpectedRavineFogCount = 3;
        private const int ExpectedFrontierHazeCount = 5;
        private const int SheetsPerBank = 3;
        private const int VerticesPerSheet = 4;
        private const int MaximumRiverFogRendererCount = 5;
        private const int MaximumCumulativeFogRendererCount07 = 8;
        private const int MaximumCumulativeFogRendererCount08 = 12;
        private const int MaximumCumulativeFogRendererCount09 = 15;
        private const int MaximumFinalFogRendererCount = 20;
        private const int MaximumFinalFogMaterialCount = 5;
        private const int MaximumFinalFogMeshCount = 2;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string FogTexturePath =
            "Assets/MEP/MEP_Environment/MEP_FX/MEP_Clouds/Textures/MEP_Fog_4x4.png";
        private const string FogMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_TesmaLowFog_MEP.mat";
        private const string ReservoirFogMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_ReservoirMist_MEP.mat";
        private const string ChalkFogMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_ChalkLowlandMist_MEP.mat";
        private const string RavineFogMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_ListenersRavineFog_MEP.mat";
        private const string FrontierFogMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Effect_FrontierHaze_MEP.mat";
        private const string FogMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_Effect_LowFogBank.asset";
        private const string GroundFogMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_Effect_GroundFogPatch.asset";
        private const string FogShaderName = "Kromka/Global Map/Low Fog";

        private readonly struct FogBank
        {
            public readonly string Name;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Yaw;
            public readonly Vector3 Scale;

            public FogBank(string name, float mapX, float mapY, float yaw,
                           Vector3 scale)
            {
                Name = name;
                MapX = mapX;
                MapY = mapY;
                Yaw = yaw;
                Scale = scale;
            }
        }

        private static readonly FogBank[] TesmaRiverBanks =
        {
            new FogBank("LowerTesma_FloodplainMist", 196f, 229f, 18f,
                new Vector3(1.46f, 0.58f, 1.12f)),
            new FogBank("FoundryBend_WaterMist", 203f, 204f, -11f,
                new Vector3(1.38f, 0.54f, 1.06f)),
            new FogBank("MiddleVein_RiverMist", 195f, 173f, 7f,
                new Vector3(1.52f, 0.60f, 1.14f)),
            new FogBank("ChalkConfluence_RiverMist", 208f, 135f, -16f,
                new Vector3(1.34f, 0.53f, 1.04f)),
            new FogBank("UpperTesma_TailwaterMist", 203f, 111f, 5f,
                new Vector3(1.42f, 0.56f, 1.10f))
        };

        private static readonly FogBank[] ReservoirBanks =
        {
            new FogBank("WestReservoir_ColdMist", 157f, 268f, 5f,
                new Vector3(1.28f, 1.00f, 1.14f)),
            new FogBank("CentralReservoir_ColdMist", 211f, 270f, -7f,
                new Vector3(1.22f, 1.00f, 1.10f)),
            new FogBank("EastReservoir_ColdMist", 249f, 254f, 13f,
                new Vector3(1.16f, 1.00f, 1.06f))
        };

        private static readonly FogBank[] ChalkLowlandMist =
        {
            new FogBank("CeramicLedge_ChalkMist", 270f, 139f, -18f,
                new Vector3(0.94f, 1.00f, 0.86f)),
            new FogBank("ChalkSluice_EvaporationMist", 268f, 98f, 8f,
                new Vector3(0.88f, 1.00f, 0.82f)),
            new FogBank("FilterCamp_LowlandMist", 294f, 112f, 21f,
                new Vector3(0.92f, 1.00f, 0.84f)),
            new FogBank("EasternKarst_BasinMist", 310f, 96f, -27f,
                new Vector3(0.84f, 1.00f, 0.78f))
        };

        private static readonly FogBank[] ListenersRavineFog =
        {
            new FogBank("SouthMouth_ListeningFog", 319f, 69f, 12f,
                new Vector3(0.94f, 1.00f, 0.86f)),
            // Keep the eastern pocket fully inside the broken shoreline. The
            // earlier, wider placement clipped the continental edge and read
            // as a detached translucent patch at low camera angles.
            new FogBank("DeepBasin_ListeningFog", 340f, 86f, -24f,
                new Vector3(0.82f, 1.00f, 0.78f)),
            new FogBank("NorthReach_ListeningFog", 322f, 99f, 31f,
                new Vector3(0.90f, 1.00f, 0.84f))
        };

        private static readonly FogBank[] FrontierHaze =
        {
            new FogBank("NorthwestInnerRidge_FrontierHaze", 105f, 245f, -24f,
                new Vector3(1.64f, 0.50f, 1.18f)),
            new FogBank("NortheastInnerRidge_FrontierHaze", 285f, 240f, 21f,
                new Vector3(1.56f, 0.48f, 1.14f)),
            new FogBank("WestInnerRim_FrontierHaze", 40f, 185f, -8f,
                new Vector3(1.48f, 0.52f, 1.10f)),
            new FogBank("EastInnerRim_FrontierHaze", 340f, 190f, 11f,
                new Vector3(1.60f, 0.50f, 1.16f)),
            new FogBank("SouthPass_FrontierHaze", 210f, 35f, 4f,
                new Vector3(1.46f, 0.48f, 1.12f))
        };

        internal static void ComposeIteration06(Transform parent)
        {
            Material material = BuildMistMaterial();
            Mesh mesh = BuildFogBankMesh();
            Transform root = Child(parent,
                "Fog_Iteration06_TesmaGroundMist_MEP");
            for (int i = 0; i < TesmaRiverBanks.Length; i++)
                BuildFogBank(root, TesmaRiverBanks[i], mesh, material);

            Child(parent, "TesmaLowFogBanks_5_REFERENCE");
            Child(parent, "MEPFogFlipbook_REFERENCE");
            Child(parent, "ShaderAnimatedFog_REFERENCE");
            Child(parent, "TerrainSeatedFog_REFERENCE");
            Child(parent, "EffectIteration_06_of_20");
        }

        internal static void ComposeIteration07(Transform parent)
        {
            Material material = BuildFogMaterial(ReservoirFogMaterialPath,
                "Kromka_Effect_ReservoirMist_MEP",
                new Color(0.46f, 0.55f, 0.56f, 0.23f), 0.90f, 0.025f);
            Mesh mesh = BuildGroundFogPatchMesh();
            Transform root = Child(parent,
                "Fog_Iteration07_ReservoirColdMist_MEP");
            for (int i = 0; i < ReservoirBanks.Length; i++)
                BuildFogBank(root, ReservoirBanks[i], mesh, material);

            Child(parent, "ReservoirFogBanks_3_REFERENCE");
            Child(parent, "ColdWaterFogLanguage_REFERENCE");
            Child(parent, "SharedFogMesh_REFERENCE");
            Child(parent, "EffectIteration_07_of_20");
        }

        internal static void ComposeIteration08(Transform parent)
        {
            Material material = BuildFogMaterial(ChalkFogMaterialPath,
                "Kromka_Effect_ChalkLowlandMist_MEP",
                new Color(0.61f, 0.62f, 0.55f, 0.19f), 0.72f, 0.018f);
            Mesh mesh = RequireGroundFogMesh();
            Transform root = Child(parent,
                "Fog_Iteration08_ChalkLowlandMist_MEP");
            for (int i = 0; i < ChalkLowlandMist.Length; i++)
                BuildFogBank(root, ChalkLowlandMist[i], mesh, material);

            Child(parent, "ChalkLowlandMistPatches_4_REFERENCE");
            Child(parent, "DryKarstFogLanguage_REFERENCE");
            Child(parent, "ChalkFogLandmarkClearance_REFERENCE");
            Child(parent, "EffectIteration_08_of_20");
        }

        internal static void ComposeIteration09(Transform parent)
        {
            Material material = BuildFogMaterial(RavineFogMaterialPath,
                "Kromka_Effect_ListenersRavineFog_MEP",
                new Color(0.44f, 0.50f, 0.51f, 0.32f), 0.58f, 0.014f);
            Mesh mesh = RequireGroundFogMesh();
            Transform root = Child(parent,
                "Fog_Iteration09_ListenersRavinePockets_MEP");
            for (int i = 0; i < ListenersRavineFog.Length; i++)
                BuildFogBank(root, ListenersRavineFog[i], mesh, material);

            Child(parent, "ListenersRavineFogPockets_3_REFERENCE");
            Child(parent, "EnclosedKarstFogLanguage_REFERENCE");
            Child(parent, "ListeningBasinClearance_REFERENCE");
            Child(parent, "EffectIteration_09_of_20");
        }

        internal static void ComposeIteration10(Transform parent)
        {
            Material material = BuildFogMaterial(FrontierFogMaterialPath,
                "Kromka_Effect_FrontierHaze_MEP",
                new Color(0.42f, 0.44f, 0.41f, 0.20f), 0.45f, 0.012f);
            Mesh mesh = RequireFogMesh();
            Transform root = Child(parent,
                "Fog_Iteration10_FrontierBoundaryHaze_MEP");
            for (int i = 0; i < FrontierHaze.Length; i++)
                BuildFogBank(root, FrontierHaze[i], mesh, material);

            Child(parent, "FrontierHazeBanks_5_REFERENCE");
            Child(parent, "SilentRingBoundaryDepth_REFERENCE");
            Child(parent, "FogStageGlobalAudit_REFERENCE");
            Child(parent, "EffectIteration_10_of_20");
        }

        internal static void ValidateIteration06()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 06 root is missing from the global map");
            Transform effectsRoot = rootObject.transform;
            string[] markers =
            {
                "TesmaLowFogBanks_5_REFERENCE",
                "MEPFogFlipbook_REFERENCE",
                "ShaderAnimatedFog_REFERENCE",
                "TerrainSeatedFog_REFERENCE",
                "EffectIteration_06_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(TesmaRiverBanks.Length == ExpectedRiverBankCount,
                "five reviewed Tesma fog banks are required");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                FogTexturePath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(
                FogMaterialPath);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(FogMeshPath);
            Require(source != null, "licensed MEP fog atlas is missing");
            Require(material != null && material.shader != null
                    && material.shader.isSupported
                    && material.shader.name == FogShaderName,
                "Tesma fog material or shader is missing or unsupported");
            Require(material.GetTexture("_BaseMap") == source,
                "Tesma fog lost its licensed MEP atlas");
            Require(material.enableInstancing,
                "Tesma fog material is not instancing-ready");
            Require(mesh != null
                    && mesh.vertexCount == SheetsPerBank * VerticesPerSheet,
                "optimized three-sheet fog-bank mesh is missing");

            Transform fogRoot = FindDescendant(effectsRoot,
                "Fog_Iteration06_TesmaGroundMist_MEP");
            Require(fogRoot != null
                    && fogRoot.childCount == ExpectedRiverBankCount,
                "Tesma river-fog hierarchy is incomplete");
            MeshRenderer[] renderers = fogRoot
                .GetComponentsInChildren<MeshRenderer>(true);
            Require(renderers.Length == MaximumRiverFogRendererCount,
                "Tesma fog must remain at five renderers");

            for (int i = 0; i < TesmaRiverBanks.Length; i++)
            {
                FogBank row = TesmaRiverBanks[i];
                Transform bank = fogRoot.Find(row.Name);
                Require(bank != null, row.Name + " is missing");
                MeshFilter filter = bank.GetComponent<MeshFilter>();
                MeshRenderer renderer = bank.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the optimized fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " does not reuse the MEP fog material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require((GameObjectUtility.GetStaticEditorFlags(bank.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    row.Name + " is not batching-static");
                Require(row.MapX >= 190f && row.MapX <= 212f
                        && row.MapY >= 105f && row.MapY <= 235f,
                    row.Name + " is outside the reviewed Tesma corridor");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.18f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.035f
                        && renderer.bounds.min.y <= expectedGround + 0.085f,
                    row.Name + " is buried or visibly floating over the river");
            }

            Require(fogRoot.GetComponentsInChildren<ParticleSystem>(true).Length == 0,
                "Tesma low fog must not rely on ParticleSystem simulation");
            Require(fogRoot.GetComponentsInChildren<Light>(true).Length == 0,
                "Tesma low fog must not create local lights");
            Require(fogRoot.GetComponentsInChildren<Collider>(true)
                    .All(collider => collider == null || !collider.enabled),
                "Tesma low fog contains an active collider");

            Debug.Log("[KROMKA EFFECTS 30%] PASS: five restrained low-fog "
                + "banks trace the Tesma using one twelve-vertex mesh, one "
                + "instancing-ready MEP flipbook material and shader-side "
                + "animation without particles, lights or colliders.");
        }

        internal static void ValidateIteration07()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 07 root is missing from the global map");
            Transform effectsRoot = rootObject.transform;
            string[] markers =
            {
                "ReservoirFogBanks_3_REFERENCE",
                "ColdWaterFogLanguage_REFERENCE",
                "SharedFogMesh_REFERENCE",
                "EffectIteration_07_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(ReservoirBanks.Length == ExpectedReservoirBankCount,
                "three reviewed reservoir fog banks are required");

            Material material = RequireMaterial(ReservoirFogMaterialPath);
            Mesh mesh = RequireGroundFogMesh();
            Transform riverRoot = FindDescendant(effectsRoot,
                "Fog_Iteration06_TesmaGroundMist_MEP");
            Transform reservoirRoot = FindDescendant(effectsRoot,
                "Fog_Iteration07_ReservoirColdMist_MEP");
            Require(riverRoot != null,
                "reservoir fog cannot discard the accepted Tesma layer");
            Require(reservoirRoot != null
                    && reservoirRoot.childCount == ExpectedReservoirBankCount,
                "reservoir fog hierarchy is incomplete");

            for (int i = 0; i < ReservoirBanks.Length; i++)
            {
                FogBank row = ReservoirBanks[i];
                Transform bank = reservoirRoot.Find(row.Name);
                Require(bank != null, row.Name + " is missing");
                MeshFilter filter = bank.GetComponent<MeshFilter>();
                MeshRenderer renderer = bank.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the optimized fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " lost the reservoir fog material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.06f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.035f
                        && renderer.bounds.min.y <= expectedGround + 0.085f,
                    row.Name + " is buried or floating above its reservoir");
            }

            int cumulativeRenderers = riverRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + reservoirRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeFogRendererCount07,
                "first two fog passes must remain at eight renderers");
            Require(reservoirRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "reservoir fog must not introduce particle simulation");

            Debug.Log("[KROMKA EFFECTS 35%] PASS: three cool MEP mist banks "
                + "give each northern reservoir a low water-bound layer. "
                + "Eight cumulative fog renderers share one twelve-vertex "
                + "mesh and remain shadow-free and particle-free.");
        }

        internal static void ValidateIteration08()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 08 root is missing from the global map");
            Transform effectsRoot = rootObject.transform;
            string[] markers =
            {
                "ChalkLowlandMistPatches_4_REFERENCE",
                "DryKarstFogLanguage_REFERENCE",
                "ChalkFogLandmarkClearance_REFERENCE",
                "EffectIteration_08_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(ChalkLowlandMist.Length == ExpectedChalkMistCount,
                "four reviewed Chalk Lowland mist patches are required");

            Material material = RequireMaterial(ChalkFogMaterialPath);
            Mesh mesh = RequireGroundFogMesh();
            Transform riverRoot = FindDescendant(effectsRoot,
                "Fog_Iteration06_TesmaGroundMist_MEP");
            Transform reservoirRoot = FindDescendant(effectsRoot,
                "Fog_Iteration07_ReservoirColdMist_MEP");
            Transform chalkRoot = FindDescendant(effectsRoot,
                "Fog_Iteration08_ChalkLowlandMist_MEP");
            Require(riverRoot != null && reservoirRoot != null,
                "Chalk mist cannot discard either accepted fog layer");
            Require(chalkRoot != null
                    && chalkRoot.childCount == ExpectedChalkMistCount,
                "Chalk Lowland fog hierarchy is incomplete");

            for (int i = 0; i < ChalkLowlandMist.Length; i++)
            {
                FogBank row = ChalkLowlandMist[i];
                Transform patch = chalkRoot.Find(row.Name);
                Require(patch != null, row.Name + " is missing");
                MeshFilter filter = patch.GetComponent<MeshFilter>();
                MeshRenderer renderer = patch.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the horizontal fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " lost the Chalk Lowland fog material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(row.MapX >= 255f && row.MapX <= 315f
                        && row.MapY >= 78f && row.MapY <= 150f,
                    row.Name + " is outside the reviewed Chalk Lowland");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.10f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.050f
                        && renderer.bounds.min.y <= expectedGround + 0.090f,
                    row.Name + " is buried or floating above the karst floor");
            }

            int cumulativeRenderers = riverRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + reservoirRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + chalkRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeFogRendererCount08,
                "first three fog passes must remain at twelve renderers");
            Require(chalkRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "Chalk Lowland mist must not introduce particle simulation");

            Debug.Log("[KROMKA EFFECTS 40%] PASS: four pale horizontal fog "
                + "patches mark Ceramic Ledge, Chalk Sluice, Filter Camp and "
                + "the eastern karst basin. Twelve cumulative renderers use "
                + "two twelve-vertex meshes and three regional materials.");
        }

        internal static void ValidateIteration09()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 09 root is missing from the global map");
            Transform effectsRoot = rootObject.transform;
            string[] markers =
            {
                "ListenersRavineFogPockets_3_REFERENCE",
                "EnclosedKarstFogLanguage_REFERENCE",
                "ListeningBasinClearance_REFERENCE",
                "EffectIteration_09_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(ListenersRavineFog.Length == ExpectedRavineFogCount,
                "three reviewed Listeners' Ravine fog pockets are required");

            Material material = RequireMaterial(RavineFogMaterialPath);
            Mesh mesh = RequireGroundFogMesh();
            Transform riverRoot = FindDescendant(effectsRoot,
                "Fog_Iteration06_TesmaGroundMist_MEP");
            Transform reservoirRoot = FindDescendant(effectsRoot,
                "Fog_Iteration07_ReservoirColdMist_MEP");
            Transform chalkRoot = FindDescendant(effectsRoot,
                "Fog_Iteration08_ChalkLowlandMist_MEP");
            Transform ravineRoot = FindDescendant(effectsRoot,
                "Fog_Iteration09_ListenersRavinePockets_MEP");
            Require(riverRoot != null && reservoirRoot != null && chalkRoot != null,
                "ravine fog cannot discard an accepted fog layer");
            Require(ravineRoot != null
                    && ravineRoot.childCount == ExpectedRavineFogCount,
                "Listeners' Ravine fog hierarchy is incomplete");

            for (int i = 0; i < ListenersRavineFog.Length; i++)
            {
                FogBank row = ListenersRavineFog[i];
                Transform pocket = ravineRoot.Find(row.Name);
                Require(pocket != null, row.Name + " is missing");
                MeshFilter filter = pocket.GetComponent<MeshFilter>();
                MeshRenderer renderer = pocket.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == mesh,
                    row.Name + " does not reuse the horizontal fog mesh");
                Require(renderer != null && renderer.sharedMaterial == material,
                    row.Name + " lost the ravine fog material");
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    row.Name + " uses unnecessary transparent shadows");
                Require(row.MapX >= 315f && row.MapX <= 350f
                        && row.MapY >= 58f && row.MapY <= 107f,
                    row.Name + " is outside the reviewed Listeners' Ravine");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.04f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.050f
                        && renderer.bounds.min.y <= expectedGround + 0.090f,
                    row.Name + " is buried or floating above its basin");
            }

            int cumulativeRenderers = riverRoot
                .GetComponentsInChildren<MeshRenderer>(true).Length
                + reservoirRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + chalkRoot.GetComponentsInChildren<MeshRenderer>(true).Length
                + ravineRoot.GetComponentsInChildren<MeshRenderer>(true).Length;
            Require(cumulativeRenderers == MaximumCumulativeFogRendererCount09,
                "first four fog passes must remain at fifteen renderers");
            Require(ravineRoot.GetComponentsInChildren<ParticleSystem>(true)
                    .Length == 0,
                "Listeners' Ravine fog must not introduce particle simulation");

            Debug.Log("[KROMKA EFFECTS 45%] PASS: three compact cold fog "
                + "pockets occupy the authored listening basins without hiding "
                + "their karst rims. Fifteen cumulative fog renderers remain "
                + "shader-animated, shadow-free and particle-free.");
        }

        internal static void ValidateIteration10()
        {
            GameObject rootObject = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Effect iteration 10 root is missing from the global map");
            Transform effectsRoot = rootObject.transform;
            string[] markers =
            {
                "FrontierHazeBanks_5_REFERENCE",
                "SilentRingBoundaryDepth_REFERENCE",
                "FogStageGlobalAudit_REFERENCE",
                "EffectIteration_10_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(effectsRoot.Find(markers[i]) != null,
                    markers[i] + " is missing");
            Require(FrontierHaze.Length == ExpectedFrontierHazeCount,
                "five reviewed frontier haze banks are required");

            Material frontierMaterial = RequireMaterial(FrontierFogMaterialPath);
            Mesh verticalMesh = RequireFogMesh();
            Mesh horizontalMesh = RequireGroundFogMesh();
            Transform frontierRoot = FindDescendant(effectsRoot,
                "Fog_Iteration10_FrontierBoundaryHaze_MEP");
            Require(frontierRoot != null
                    && frontierRoot.childCount == ExpectedFrontierHazeCount,
                "frontier haze hierarchy is incomplete");

            for (int i = 0; i < FrontierHaze.Length; i++)
            {
                FogBank row = FrontierHaze[i];
                Transform haze = frontierRoot.Find(row.Name);
                Require(haze != null, row.Name + " is missing");
                MeshFilter filter = haze.GetComponent<MeshFilter>();
                MeshRenderer renderer = haze.GetComponent<MeshRenderer>();
                Require(filter != null && filter.sharedMesh == verticalMesh,
                    row.Name + " does not reuse the vertical fog mesh");
                Require(renderer != null
                        && renderer.sharedMaterial == frontierMaterial,
                    row.Name + " lost the frontier haze material");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        row.MapX, row.MapY, 0.05f),
                    row.Name + " lies outside the visible landmass");
                float expectedGround =
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(row.MapX, row.MapY);
                Require(renderer.bounds.min.y >= expectedGround + 0.035f
                        && renderer.bounds.min.y <= expectedGround + 0.085f,
                    row.Name + " is buried or floating above the inner rim");
            }

            string[] fogRootNames =
            {
                "Fog_Iteration06_TesmaGroundMist_MEP",
                "Fog_Iteration07_ReservoirColdMist_MEP",
                "Fog_Iteration08_ChalkLowlandMist_MEP",
                "Fog_Iteration09_ListenersRavinePockets_MEP",
                "Fog_Iteration10_FrontierBoundaryHaze_MEP"
            };
            Transform[] fogRoots = fogRootNames
                .Select(name => FindDescendant(effectsRoot, name)).ToArray();
            Require(fogRoots.All(root => root != null),
                "the final fog audit cannot find every fog iteration root");
            MeshRenderer[] renderers = fogRoots
                .SelectMany(root => root.GetComponentsInChildren<MeshRenderer>(true))
                .ToArray();
            Require(renderers.Length == MaximumFinalFogRendererCount,
                "complete fog stage must remain at twenty renderers");
            Material[] materials = renderers.Select(renderer =>
                    renderer != null ? renderer.sharedMaterial : null)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(materials.Length == MaximumFinalFogMaterialCount,
                "complete fog stage must remain at five shared materials");
            Mesh[] meshes = renderers.Select(renderer =>
                    renderer != null
                        ? renderer.GetComponent<MeshFilter>()?.sharedMesh : null)
                .Where(candidate => candidate != null).Distinct().ToArray();
            Require(meshes.Length == MaximumFinalFogMeshCount
                    && meshes.Contains(verticalMesh)
                    && meshes.Contains(horizontalMesh),
                "complete fog stage must reuse exactly two optimized meshes");

            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                FogTexturePath);
            Require(source != null && materials.All(material =>
                    material.shader != null && material.shader.isSupported
                    && material.shader.name == FogShaderName
                    && material.GetTexture("_BaseMap") == source
                    && material.enableInstancing),
                "a final fog material lost its MEP atlas, shader or instancing");
            for (int i = 0; i < renderers.Length; i++)
            {
                MeshRenderer renderer = renderers[i];
                Require(renderer.shadowCastingMode == ShadowCastingMode.Off
                        && !renderer.receiveShadows,
                    renderer.name + " drifted outside the shadow-free budget");
                Require((GameObjectUtility.GetStaticEditorFlags(renderer.gameObject)
                        & StaticEditorFlags.BatchingStatic) != 0,
                    renderer.name + " is no longer batching-static");
            }
            Require(fogRoots.Sum(root => root
                    .GetComponentsInChildren<ParticleSystem>(true).Length) == 0,
                "complete fog stage must not contain particle systems");
            Require(fogRoots.Sum(root => root
                    .GetComponentsInChildren<Light>(true).Length) == 0,
                "complete fog stage must not contain local lights");
            Require(fogRoots.SelectMany(root => root
                    .GetComponentsInChildren<Collider>(true))
                    .All(collider => collider == null || !collider.enabled),
                "complete fog stage contains an active collider");

            Debug.Log("[KROMKA EFFECTS 50%] PASS: five restrained frontier "
                + "haze banks complete the ordinary-fog stage. Twenty "
                + "terrain-seated renderers reuse two twelve-vertex meshes and "
                + "five MEP-sourced materials with no particles, lights, "
                + "colliders or transparent shadows.");
        }

        private static void BuildFogBank(Transform parent, FogBank row,
                                         Mesh mesh, Material material)
        {
            var bank = new GameObject(row.Name);
            bank.transform.SetParent(parent, false);
            bank.transform.position = MapToWorld(row.MapX, row.MapY)
                + new Vector3(0f, 0.05f, 0f);
            bank.transform.rotation = Quaternion.Euler(0f, row.Yaw, 0f);
            bank.transform.localScale = row.Scale;

            MeshFilter filter = bank.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            MeshRenderer renderer = bank.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            renderer.allowOcclusionWhenDynamic = true;
            GameObjectUtility.SetStaticEditorFlags(bank,
                StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Mesh BuildFogBankMesh()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(FogMeshPath);
            bool fresh = mesh == null;
            if (fresh) mesh = new Mesh { name = "Kromka_Effect_LowFogBank" };
            else mesh.Clear();

            Vector3[] vertices = new Vector3[SheetsPerBank * VerticesPerSheet];
            Vector2[] uv = new Vector2[vertices.Length];
            Color[] colors = new Color[vertices.Length];
            int[] triangles = new int[SheetsPerBank * 6];
            // Low-angle map cameras exposed the former vertical quads as
            // straight translucent walls. Keep the same animated atlas but
            // lay compact, overlapping patches over the terrain instead.
            AddGroundPatch(vertices, uv, colors, triangles, 0,
                new Vector3(-0.32f, 0.018f, -0.06f), 1.05f, 0.52f, -11f,
                new Color(0.72f, 0.11f, 0f, 1f));
            AddGroundPatch(vertices, uv, colors, triangles, 1,
                new Vector3(0.02f, 0.024f, 0.09f), 1.18f, 0.58f, 19f,
                new Color(0.64f, 0.46f, 0f, 1f));
            AddGroundPatch(vertices, uv, colors, triangles, 2,
                new Vector3(0.36f, 0.014f, -0.03f), 0.92f, 0.46f, -27f,
                new Color(0.68f, 0.79f, 0f, 1f));

            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.colors = colors;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(false);
            if (fresh) AssetDatabase.CreateAsset(mesh, FogMeshPath);
            EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static Mesh BuildGroundFogPatchMesh()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(GroundFogMeshPath);
            bool fresh = mesh == null;
            if (fresh) mesh = new Mesh { name = "Kromka_Effect_GroundFogPatch" };
            else mesh.Clear();

            Vector3[] vertices = new Vector3[SheetsPerBank * VerticesPerSheet];
            Vector2[] uv = new Vector2[vertices.Length];
            Color[] colors = new Color[vertices.Length];
            int[] triangles = new int[SheetsPerBank * 6];
            AddGroundPatch(vertices, uv, colors, triangles, 0,
                new Vector3(-0.34f, 0.020f, -0.06f), 1.10f, 0.55f, -8f,
                new Color(0.68f, 0.16f, 0f, 1f));
            AddGroundPatch(vertices, uv, colors, triangles, 1,
                new Vector3(0.04f, 0.026f, 0.09f), 1.20f, 0.60f, 17f,
                new Color(0.60f, 0.51f, 0f, 1f));
            AddGroundPatch(vertices, uv, colors, triangles, 2,
                new Vector3(0.40f, 0.016f, -0.03f), 0.96f, 0.50f, -25f,
                new Color(0.64f, 0.82f, 0f, 1f));

            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.colors = colors;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(false);
            if (fresh) AssetDatabase.CreateAsset(mesh, GroundFogMeshPath);
            EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static void AddGroundPatch(Vector3[] vertices, Vector2[] uv,
                                           Color[] colors, int[] triangles,
                                           int patchIndex, Vector3 centre,
                                           float length, float width,
                                           float yaw, Color data)
        {
            int vertex = patchIndex * VerticesPerSheet;
            float radians = yaw * Mathf.Deg2Rad;
            Vector3 right = new Vector3(Mathf.Cos(radians), 0f,
                Mathf.Sin(radians)) * (length * 0.5f);
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

            int triangle = patchIndex * 6;
            triangles[triangle + 0] = vertex + 0;
            triangles[triangle + 1] = vertex + 2;
            triangles[triangle + 2] = vertex + 1;
            triangles[triangle + 3] = vertex + 0;
            triangles[triangle + 4] = vertex + 3;
            triangles[triangle + 5] = vertex + 2;
        }

        private static Material BuildMistMaterial()
        {
            return BuildFogMaterial(FogMaterialPath,
                "Kromka_Effect_TesmaLowFog_MEP",
                new Color(0.50f, 0.57f, 0.55f, 0.27f), 1.20f, 0.040f);
        }

        private static Material BuildFogMaterial(string path, string name,
                                                 Color tint, float frameRate,
                                                 float driftAmount)
        {
            Texture2D source = AssetDatabase.LoadAssetAtPath<Texture2D>(
                FogTexturePath);
            if (source == null)
                throw new InvalidOperationException(
                    "Licensed MEP 4x4 fog atlas is unavailable");
            Shader shader = Shader.Find(FogShaderName);
            if (shader == null)
                throw new InvalidOperationException(
                    "Kromka low-fog shader is unavailable");
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
            material.SetFloat("_FrameRate", frameRate);
            material.SetFloat("_DriftAmount", driftAmount);
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)RenderQueue.Transparent + 5;
            material.shaderKeywords = Array.Empty<string>();
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Mesh RequireFogMesh()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(FogMeshPath);
            Require(mesh != null
                    && mesh.vertexCount == SheetsPerBank * VerticesPerSheet,
                "shared low-fog bank mesh is missing");
            return mesh;
        }

        private static Mesh RequireGroundFogMesh()
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(GroundFogMeshPath);
            Require(mesh != null
                    && mesh.vertexCount == SheetsPerBank * VerticesPerSheet,
                "shared horizontal ground-fog mesh is missing");
            return mesh;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null
                    && material.shader.isSupported
                    && material.shader.name == FogShaderName,
                "fog material is missing or unsupported: " + path);
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
                    "Kromka fog-effect validation failed: " + message);
        }
    }
}
#endif
