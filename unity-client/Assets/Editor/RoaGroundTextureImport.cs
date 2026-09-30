#if UNITY_EDITOR
using System;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Импорт текстур земли зон (Assets/Resources/RealmOfAshes/Ground, собирает
    /// tools/build-ground-textures.js). По суффиксу: _albedo — цвет в sRGB,
    /// _normal — карта нормалей, _mask — линейная маска (высота, шероховатость,
    /// затенение). Все повторяются по миру, с mip-уровнями и анизотропией. В
    /// WebGL-сборку идут по 512 px: при шаге повтора около трёх метров это
    /// больше пикселя экрана на тексель даже на ближней камере, а весь набор
    /// земли укладывается в несколько мегабайт загрузки.
    /// </summary>
    public sealed class RoaGroundTextureImport : AssetPostprocessor
    {
        public const string Folder = "Assets/Resources/RealmOfAshes/Ground/";
        public const int WebGlMaxSize = 512;
        public const int MaxSize = 1024;

        public static bool InScope(string assetPath)
        {
            return (assetPath ?? string.Empty).Replace('\\', '/')
                .StartsWith(Folder, StringComparison.OrdinalIgnoreCase);
        }

        private void OnPreprocessTexture()
        {
            if (!InScope(assetPath)) return;
            var importer = (TextureImporter)assetImporter;
            string name = System.IO.Path.GetFileNameWithoutExtension(assetPath);
            bool normal = name.EndsWith("_normal", StringComparison.Ordinal);
            bool mask = name.EndsWith("_mask", StringComparison.Ordinal);

            importer.textureType = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            importer.sRGBTexture = !normal && !mask;
            importer.alphaSource = TextureImporterAlphaSource.None;
            importer.wrapMode = TextureWrapMode.Repeat;
            importer.mipmapEnabled = true;
            importer.filterMode = FilterMode.Trilinear;
            importer.anisoLevel = 4;
            importer.maxTextureSize = MaxSize;
            importer.textureCompression = TextureImporterCompression.Compressed;

            TextureImporterPlatformSettings webGl = importer.GetPlatformTextureSettings("WebGL");
            webGl.overridden = true;
            webGl.maxTextureSize = WebGlMaxSize;
            webGl.format = TextureImporterFormat.Automatic;
            webGl.textureCompression = TextureImporterCompression.Compressed;
            importer.SetPlatformTextureSettings(webGl);
        }
    }
}
#endif
