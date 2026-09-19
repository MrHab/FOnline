using System;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Keeps the original texture atlases supplied with the Kenney model kits:
    /// textured kit assets must not be flattened to a single replacement colour.
    /// </summary>
    internal static class KromkaNativeModelMaterial
    {
        private const string MaterialRoot = "Assets/Art/Kromka/Materials/NativeModelKits/";

        private const string CarRoot = "Assets/ThirdParty/Kenney/CarKit31/";
        private const string CarTexture = CarRoot + "Textures/colormap.png";
        private const string CarMaterial = MaterialRoot + "Kenney_CarKit31_Native.mat";

        private const string FactoryRoot = "Assets/ThirdParty/Kenney/FactoryKit30/";
        private const string FactoryTexture = FactoryRoot + "Textures/colormap.png";
        private const string FactoryMaterial = MaterialRoot + "Kenney_FactoryKit30_Native.mat";

        private const string CityRoot = "Assets/ThirdParty/Kenney/CityKitIndustrial20/";
        private const string CityTexture = CityRoot + "Textures/colormap.png";
        private const string CityMaterial = MaterialRoot + "Kenney_CityKitIndustrial20_Native.mat";

        internal static Material Resolve(string assetPath, Material fallback)
        {
            if (string.IsNullOrEmpty(assetPath)) return fallback;
            if (assetPath.StartsWith(CarRoot, StringComparison.Ordinal))
                return Build(CarMaterial, "Kenney_CarKit31_Native", CarTexture);
            if (assetPath.StartsWith(FactoryRoot, StringComparison.Ordinal))
                return Build(FactoryMaterial, "Kenney_FactoryKit30_Native", FactoryTexture);
            if (assetPath.StartsWith(CityRoot, StringComparison.Ordinal))
                return Build(CityMaterial, "Kenney_CityKitIndustrial20_Native", CityTexture);
            return fallback;
        }

        private static Material Build(string materialPath, string materialName,
                                      string texturePath)
        {
            EnsureFolder("Assets/Art/Kromka/Materials", "NativeModelKits");
            Texture2D texture = RequireTexture(texturePath, materialName);
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable");

            Material material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            if (material == null)
            {
                material = new Material(shader) { name = materialName };
                AssetDatabase.CreateAsset(material, materialPath);
            }

            material.shader = shader;
            material.name = materialName;
            material.SetTexture("_BaseMap", texture);
            material.SetTexture("_MainTex", texture);
            material.SetColor("_BaseColor", Color.white);
            material.SetColor("_Color", Color.white);
            material.SetFloat("_Metallic", 0f);
            material.SetFloat("_Smoothness", 0.24f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Texture2D RequireTexture(string path, string label)
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (texture == null)
                throw new InvalidOperationException(label + " native texture is missing: " + path);
            return texture;
        }

        private static void EnsureFolder(string parent, string child)
        {
            string path = parent + "/" + child;
            if (!AssetDatabase.IsValidFolder(path)) AssetDatabase.CreateFolder(parent, child);
        }
    }
}
