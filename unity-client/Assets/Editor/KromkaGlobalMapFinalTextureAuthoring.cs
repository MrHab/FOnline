using System;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 20/20: final MEP-backed chromatic calibration and
    /// micro-surface patina for the continuous relief material.
    /// </summary>
    internal static class KromkaGlobalMapFinalTextureAuthoring
    {
        internal const int TextureIteration = 20;
        internal const int TextureIterationCount = 20;

        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalTerrain.shader";
        private const string MaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTerrain_MEP.mat";
        private const string PatinaTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Cave/Textures/MEP_CaveGround_Dif_N.png";
        private const string MicroDustTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_N_Dif.tga";

        internal static void Apply(Transform root, Material material)
        {
            if (root == null || material == null)
                throw new InvalidOperationException(
                    "Final texture authoring requires the continuous relief material.");
            Texture2D patina = AssetDatabase.LoadAssetAtPath<Texture2D>(PatinaTexturePath);
            Texture2D microDust = AssetDatabase.LoadAssetAtPath<Texture2D>(
                MicroDustTexturePath);
            if (patina == null || microDust == null)
                throw new InvalidOperationException(
                    "Final texture MEP sources are missing.");

            material.SetTexture("_PatinaTex", patina);
            material.SetTexture("_MicroDustTex", microDust);
            material.SetColor("_BaseTint", new Color(0.64f, 0.60f, 0.43f, 1f));
            material.SetColor("_NorthTint", new Color(0.57f, 0.59f, 0.56f, 1f));
            material.SetColor("_OreTint", new Color(0.82f, 0.43f, 0.26f, 1f));
            material.SetColor("_GlassTint", new Color(0.50f, 0.73f, 0.74f, 1f));
            material.SetColor("_ChalkTint", new Color(0.88f, 0.84f, 0.72f, 1f));
            material.SetColor("_ZeroTint", new Color(0.47f, 0.52f, 0.34f, 1f));
            material.SetColor("_RingTint", new Color(0.49f, 0.42f, 0.35f, 1f));
            material.SetColor("_CliffTint", new Color(0.60f, 0.56f, 0.50f, 1f));
            material.SetColor("_WetTint", new Color(1.10f, 1.20f, 1.08f, 1f));
            material.SetColor("_OreDepositTint", new Color(0.88f, 0.48f, 0.31f, 1f));
            material.SetColor("_GlassDepositTint", new Color(0.62f, 0.77f, 0.77f, 1f));
            material.SetColor("_ChalkDepositTint", new Color(0.96f, 0.93f, 0.80f, 1f));
            material.SetColor("_PeatDepositTint", new Color(0.92f, 0.98f, 0.70f, 1f));
            material.SetFloat("_MacroBlend", 0.33f);
            material.SetFloat("_MacroVariation", 0.14f);
            material.SetFloat("_WeatheringStrength", 0.18f);
            material.SetFloat("_WetDarkening", 0.09f);
            material.SetFloat("_PatinaTiling", 31f);
            material.SetFloat("_PatinaMacroTiling", 7.4f);
            material.SetFloat("_PatinaStrength", 0.10f);
            material.SetFloat("_ChromaticCompression", 0.10f);
            material.SetFloat("_DustVeil", 0.09f);
            material.SetFloat("_WashContrast", 0.12f);
            material.SetFloat("_Roughness", 0.88f);
            EditorUtility.SetDirty(material);

            Child(root, "FinalTexture_MicroPatina_2MEP_REFERENCE");
            Child(root, "FinalTexture_ChromaticCalibration_REFERENCE");
            Child(root, "FinalTexture_WashVariation_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 20")]
        public static void ValidateIteration20()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            Texture2D patina = ValidateSource(PatinaTexturePath,
                "final stone patina");
            Texture2D microDust = ValidateSource(MicroDustTexturePath,
                "final micro dust");
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Final Kromka terrain shader is missing or invalid.");
            Require(material != null && material.shader == shader
                && material.GetTexture("_PatinaTex") == patina
                && material.GetTexture("_MicroDustTex") == microDust,
                "Continuous terrain does not directly use both final MEP sources.");

            Require(material.GetFloat("_PatinaTiling") >= 28f
                && material.GetFloat("_PatinaTiling") <= 36f
                && material.GetFloat("_PatinaMacroTiling") >= 6.5f
                && material.GetFloat("_PatinaMacroTiling") <= 8.5f
                && material.GetFloat("_PatinaTiling")
                    / material.GetFloat("_PatinaMacroTiling") >= 4f,
                "Final texture detail and landscape scales are not separated.");
            Require(material.GetFloat("_PatinaStrength") >= 0.08f
                && material.GetFloat("_PatinaStrength") <= 0.13f
                && material.GetFloat("_ChromaticCompression") >= 0.08f
                && material.GetFloat("_ChromaticCompression") <= 0.13f
                && material.GetFloat("_DustVeil") >= 0.07f
                && material.GetFloat("_DustVeil") <= 0.12f
                && material.GetFloat("_WashContrast") >= 0.09f
                && material.GetFloat("_WashContrast") <= 0.16f,
                "Final texture calibration is too weak or erases regional identity.");
            Color ore = material.GetColor("_OreTint");
            Color glass = material.GetColor("_GlassTint");
            Color chalk = material.GetColor("_ChalkTint");
            Color zero = material.GetColor("_ZeroTint");
            Require(ore.r > ore.g * 1.75f && ore.g > ore.b
                && glass.b > glass.r * 1.45f
                && glass.g > glass.r * 1.42f
                && chalk.r > zero.r * 1.75f
                && chalk.g > zero.g * 1.55f,
                "Final chromatic calibration erased the regional hierarchy.");
            Require(GameObject.Find("KromkaLandmass_Relief_100pct") != null
                && GameObject.Find("FinalTexture_MicroPatina_2MEP_REFERENCE") != null
                && GameObject.Find("FinalTexture_ChromaticCalibration_REFERENCE") != null
                && GameObject.Find("FinalTexture_WashVariation_REFERENCE") != null,
                "Final texture reference handles or continuous relief are missing.");
            Renderer renderer = GameObject.Find("KromkaLandmass_Relief_100pct")
                .GetComponent<Renderer>();
            Require(renderer != null && renderer.sharedMaterial == material,
                "Continuous Kromka relief is not using the final calibrated material.");
            Debug.Log("[KROMKA TEXTURES 100%] PASS: two direct high-resolution MEP "
                + "sources add protected stone patina and micro dust; restrained "
                + "chromatic compression, dry-ground wash variation and final roughness "
                + "calibrate the continuous terrain without erasing regional identity.");
        }

        private static Texture2D ValidateSource(string path, string label)
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            Require(texture != null && texture.width >= 2048 && texture.height >= 2048,
                label + " direct MEP source is missing or under-resolved.");
            return texture;
        }

        private static Transform Child(Transform parent, string name)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
