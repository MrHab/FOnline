using System;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Progressive MEP-backed material authoring for the 380 x 300 Kromka map.
    /// Iteration 06/20 adds MEP mineral granules, fine dust and peat litter along
    /// the authored ore strata, Glasslands faults, chalk gullies and Zero Basin
    /// wetland spine; open water and decals belong to later passes.
    /// </summary>
    internal static class KromkaGlobalMapTextureAuthoring
    {
        internal const int TextureIteration = 6;
        internal const int TextureIterationCount = 20;

        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalTerrain.shader";
        private const string MaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTerrain_MEP.mat";
        private const string MepTerrainRoot =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/";

        private const string CentralTexturePath =
            MepTerrainRoot + "MEP_Ground_01_N_Dif.tga";
        private const string NorthTexturePath =
            MepTerrainRoot + "MEP_Dessert_Base_N.png";
        private const string OreTexturePath =
            MepTerrainRoot + "MEP_Sand_03.png";
        private const string GlassTexturePath =
            MepTerrainRoot + "MEP_Ground_Snow_01_N.tga";
        private const string ChalkTexturePath =
            MepTerrainRoot + "MEP_Sand_05.png";
        private const string ZeroTexturePath =
            MepTerrainRoot + "ForestFloor_BL_Dif.tga";
        private const string CliffTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_03/Textures/MEP_Cliff_03_Terrain.png";
        private const string WetTexturePath =
            MepTerrainRoot + "MEP_Soil_01_N_Dif.tga";
        private const string GranuleTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Cave/Textures/MEP_CaveGround_Dif_N.png";
        private const string DustTexturePath =
            MepTerrainRoot + "MEP_Sand_N_Dif.tga";
        private const string PeatTexturePath =
            MepTerrainRoot + "ForestFloor_C_Dif.tga";

        internal static Material BuildMaterial()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            if (shader == null)
                throw new InvalidOperationException("Kromka global terrain shader is missing.");

            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                material = new Material(shader) { name = "Kromka_GlobalTerrain_MEP" };
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            else if (material.shader != shader)
            {
                material.shader = shader;
            }

            SetTexture(material, "_BaseTex", CentralTexturePath);
            SetTexture(material, "_NorthTex", NorthTexturePath);
            SetTexture(material, "_OreTex", OreTexturePath);
            SetTexture(material, "_GlassTex", GlassTexturePath);
            SetTexture(material, "_ChalkTex", ChalkTexturePath);
            SetTexture(material, "_ZeroTex", ZeroTexturePath);
            SetTexture(material, "_CliffTex", CliffTexturePath);
            SetTexture(material, "_WetTex", WetTexturePath);
            SetTexture(material, "_GranuleTex", GranuleTexturePath);
            SetTexture(material, "_DustTex", DustTexturePath);
            SetTexture(material, "_PeatTex", PeatTexturePath);

            material.SetColor("_BaseTint", new Color(0.64f, 0.62f, 0.43f, 1f));
            material.SetColor("_NorthTint", new Color(0.55f, 0.58f, 0.53f, 1f));
            material.SetColor("_OreTint", new Color(0.88f, 0.39f, 0.20f, 1f));
            material.SetColor("_GlassTint", new Color(0.46f, 0.73f, 0.74f, 1f));
            material.SetColor("_ChalkTint", new Color(0.92f, 0.86f, 0.70f, 1f));
            material.SetColor("_ZeroTint", new Color(0.45f, 0.51f, 0.31f, 1f));
            material.SetColor("_RingTint", new Color(0.48f, 0.40f, 0.32f, 1f));
            material.SetColor("_CliffTint", new Color(0.62f, 0.56f, 0.48f, 1f));
            material.SetColor("_WetTint", new Color(1.12f, 1.34f, 1.10f, 1f));
            material.SetColor("_OreDepositTint", new Color(0.94f, 0.46f, 0.28f, 1f));
            material.SetColor("_GlassDepositTint", new Color(0.58f, 0.77f, 0.78f, 1f));
            material.SetColor("_ChalkDepositTint", new Color(1.02f, 0.99f, 0.84f, 1f));
            material.SetColor("_PeatDepositTint", new Color(1.04f, 1.10f, 0.72f, 1f));
            material.SetFloat("_TextureTiling", 16f);
            material.SetFloat("_MacroTiling", 5.1f);
            material.SetFloat("_MacroBlend", 0.30f);
            material.SetFloat("_MacroVariation", 0.11f);
            material.SetFloat("_BoundaryWarp", 16f);
            material.SetFloat("_TransitionWidth", 0.46f);
            material.SetFloat("_CliffTiling", 0.75f);
            material.SetFloat("_SlopeStart", 0.28f);
            material.SetFloat("_SlopeFull", 0.66f);
            material.SetFloat("_WeatheringStart", 0.50f);
            material.SetFloat("_WeatheringEnd", 1.02f);
            material.SetFloat("_WeatheringStrength", 0.16f);
            material.SetFloat("_RiverWetInner", 2.8f);
            material.SetFloat("_RiverWetOuter", 13.5f);
            material.SetFloat("_WetBlend", 0.66f);
            material.SetFloat("_WetDarkening", 0.08f);
            material.SetFloat("_BasinWetStrength", 0.72f);
            material.SetFloat("_DepositTiling", 23f);
            material.SetFloat("_DepositMacroTiling", 8.2f);
            material.SetFloat("_DepositBreakup", 0.38f);
            material.SetFloat("_OreDepositStrength", 0.42f);
            material.SetFloat("_GlassDepositStrength", 0.34f);
            material.SetFloat("_ChalkDepositStrength", 0.34f);
            material.SetFloat("_PeatDepositStrength", 0.30f);
            material.SetFloat("_Roughness", 0.82f);
            EditorUtility.SetDirty(material);
            return material;
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 06")]
        public static void ValidateIteration06()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            Require(shader != null, "Kromka global terrain shader is missing.");
            Require(!ShaderUtil.ShaderHasError(shader),
                "Kromka global terrain shader has compile errors.");
            Require(material != null && material.shader == shader,
                "The Kromka relief is not using the authored MEP terrain material.");

            ValidateTexture(material, "_BaseTex", CentralTexturePath, "Middle Vein");
            ValidateTexture(material, "_NorthTex", NorthTexturePath, "Northern Sluices");
            ValidateTexture(material, "_OreTex", OreTexturePath, "Ore Arc");
            ValidateTexture(material, "_GlassTex", GlassTexturePath, "Glasslands");
            ValidateTexture(material, "_ChalkTex", ChalkTexturePath, "Chalk Lowland");
            ValidateTexture(material, "_ZeroTex", ZeroTexturePath, "Zero Basin");
            ValidateTexture(material, "_CliffTex", CliffTexturePath, "exposed slopes");
            ValidateTexture(material, "_WetTex", WetTexturePath, "wet terrain");
            ValidateTexture(material, "_GranuleTex", GranuleTexturePath, "mineral deposits");
            ValidateTexture(material, "_DustTex", DustTexturePath, "chalk dust deposits");
            ValidateTexture(material, "_PeatTex", PeatTexturePath, "Zero Basin peat deposits");

            Color ore = material.GetColor("_OreTint");
            Color glass = material.GetColor("_GlassTint");
            Color chalk = material.GetColor("_ChalkTint");
            Color zero = material.GetColor("_ZeroTint");
            Require(ore.r > ore.g * 1.7f && ore.g > ore.b,
                "Ore Arc lacks its rust-red macro palette.");
            Require(glass.b > glass.r * 1.45f && glass.g > glass.r * 1.45f,
                "Glasslands lacks its cold cyan macro palette.");
            Require(chalk.r > zero.r * 1.7f && chalk.g > zero.g * 1.5f,
                "Chalk and Zero macro palettes are not visually separated.");
            Require(material.GetFloat("_TextureTiling") >= 12f,
                "MEP terrain maps are stretched beyond useful strategic scale.");
            float detailTiling = material.GetFloat("_TextureTiling");
            float macroTiling = material.GetFloat("_MacroTiling");
            float macroBlend = material.GetFloat("_MacroBlend");
            float macroVariation = material.GetFloat("_MacroVariation");
            Require(macroTiling >= 4f && macroTiling <= 7f
                && detailTiling / macroTiling > 2.7f,
                "MEP detail and macro sampling scales are not sufficiently separated.");
            Require(macroBlend >= 0.24f && macroBlend <= 0.38f,
                "Macro sampling either cannot hide tiling or erases local detail.");
            Require(macroVariation >= 0.08f && macroVariation <= 0.15f,
                "Low-frequency material tone variation is outside the safe range.");
            float boundaryWarp = material.GetFloat("_BoundaryWarp");
            float transitionWidth = material.GetFloat("_TransitionWidth");
            Require(boundaryWarp >= 14f && boundaryWarp <= 20f,
                "Regional boundaries are still geometric or excessively displaced.");
            Require(transitionWidth >= 0.38f && transitionWidth <= 0.56f,
                "Regional transition belts are either too sharp or too muddy.");
            float cliffTiling = material.GetFloat("_CliffTiling");
            float slopeStart = material.GetFloat("_SlopeStart");
            float slopeFull = material.GetFloat("_SlopeFull");
            float weatheringStart = material.GetFloat("_WeatheringStart");
            float weatheringEnd = material.GetFloat("_WeatheringEnd");
            float weatheringStrength = material.GetFloat("_WeatheringStrength");
            Require(cliffTiling >= 0.55f && cliffTiling <= 1.05f,
                "World-projected cliff texture scale is outside the strategic range.");
            Require(slopeStart >= 0.20f && slopeFull <= 0.75f
                && slopeFull - slopeStart >= 0.30f,
                "Slope-driven rock transition is too abrupt or misses major scarps.");
            Require(weatheringStart >= 0.40f && weatheringEnd >= 0.90f
                && weatheringEnd - weatheringStart >= 0.45f
                && weatheringStrength >= 0.12f && weatheringStrength <= 0.22f,
                "Altitude weathering is missing or outside the restrained range.");
            float wetInner = material.GetFloat("_RiverWetInner");
            float wetOuter = material.GetFloat("_RiverWetOuter");
            float wetBlend = material.GetFloat("_WetBlend");
            float wetDarkening = material.GetFloat("_WetDarkening");
            float basinWetStrength = material.GetFloat("_BasinWetStrength");
            Require(wetInner >= 2f && wetInner <= 4f
                && wetOuter >= 11f && wetOuter <= 16f
                && wetOuter - wetInner >= 8f,
                "Tesma wet core and floodplain widths are not separated correctly.");
            Require(wetBlend >= 0.58f && wetBlend <= 0.72f
                && wetDarkening >= 0.05f && wetDarkening <= 0.12f
                && basinWetStrength >= 0.62f && basinWetStrength <= 0.80f,
                "Wet soil blend or darkening is outside the readable range.");

            float depositTiling = material.GetFloat("_DepositTiling");
            float depositMacroTiling = material.GetFloat("_DepositMacroTiling");
            float depositBreakup = material.GetFloat("_DepositBreakup");
            float oreDepositStrength = material.GetFloat("_OreDepositStrength");
            float glassDepositStrength = material.GetFloat("_GlassDepositStrength");
            float chalkDepositStrength = material.GetFloat("_ChalkDepositStrength");
            float peatDepositStrength = material.GetFloat("_PeatDepositStrength");
            Require(depositTiling >= 20f && depositTiling <= 28f
                && depositMacroTiling >= 7f && depositMacroTiling <= 10f
                && depositTiling / depositMacroTiling >= 2.5f,
                "Geological deposits lack separated detail and macro scales.");
            Require(depositBreakup >= 0.30f && depositBreakup <= 0.44f,
                "Geological deposit edges are too geometric or too fragmented.");
            Require(oreDepositStrength >= 0.36f && oreDepositStrength <= 0.48f
                && glassDepositStrength >= 0.28f && glassDepositStrength <= 0.42f
                && chalkDepositStrength >= 0.28f && chalkDepositStrength <= 0.42f
                && peatDepositStrength >= 0.24f && peatDepositStrength <= 0.36f,
                "Regional deposit strengths are outside the restrained readable range.");

            Debug.Log("[KROMKA TEXTURES 30%] PASS: eleven direct MEP terrain maps, "
                + "two-scale sampling " + detailTiling.ToString("F1") + "/"
                + macroTiling.ToString("F1") + " at "
                + macroBlend.ToString("F2") + " blend, tone variation "
                + macroVariation.ToString("F2") + ", seven regional tints, "
                + boundaryWarp.ToString("F0")
                + " km boundary warp and " + transitionWidth.ToString("F2")
                + " transition width, cliff projection " + cliffTiling.ToString("F2")
                + ", slope " + slopeStart.ToString("F2") + ".."
                + slopeFull.ToString("F2") + " and weathering "
                + weatheringStart.ToString("F2") + ".."
                + weatheringEnd.ToString("F2") + ", Tesma wet belt "
                + wetInner.ToString("F1") + ".." + wetOuter.ToString("F1")
                + ", basin strength " + basinWetStrength.ToString("F2")
                + ", wet-soil darkening, and authored ore/glass/chalk/peat deposits at "
                + depositTiling.ToString("F1") + "/"
                + depositMacroTiling.ToString("F1") + " scales are assigned.");
        }

        private static void SetTexture(Material material, string property, string path)
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (texture == null)
                throw new InvalidOperationException("Missing MEP texture: " + path);
            material.SetTexture(property, texture);
        }

        private static void ValidateTexture(Material material, string property,
                                            string path, string region)
        {
            Texture2D expected = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            Require(expected != null, region + " MEP source texture is missing.");
            Require(material.GetTexture(property) == expected,
                region + " does not reference the selected MEP source texture directly.");
            Require(expected.width >= 1024 && expected.height >= 1024,
                region + " MEP texture resolution is too low for the global map.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
