using System;
using System.Collections.Generic;
using System.IO;
using RealmOfAshes.Game;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.UI;

namespace RealmOfAshes.Editor
{
    public static class RoaCyrillicTmpFontBuilder
    {
        private const string SourcePath = "Assets/Resources/RealmUi/Fonts/NotoSans.ttf";
        private const string AssetPath = "Assets/Resources/RealmUi/Fonts/NotoSansCyrillicTMP.asset";
        private const string RussianLetters =
            "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ" +
            "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";

        [MenuItem("Realm of Ashes/Fonts/Create Noto Sans Cyrillic TMP Font")]
        public static void Build()
        {
            if (AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(AssetPath) != null)
                throw new InvalidOperationException("TMP font asset already exists: " + AssetPath);

            Font source = AssetDatabase.LoadAssetAtPath<Font>(SourcePath);
            if (source == null) throw new InvalidOperationException("Noto Sans source font is missing: " + SourcePath);
            if (TMP_Settings.instance == null)
                throw new InvalidOperationException("Import TMP Essential Resources before creating the font asset.");

            TMP_FontAsset asset = TMP_FontAsset.CreateFontAsset(
                source, 90, 9, GlyphRenderMode.SDFAA, 1024, 1024, AtlasPopulationMode.Dynamic, false);
            if (asset == null) throw new InvalidOperationException("Could not create a TMP font from Noto Sans.");

            asset.name = "Noto Sans Cyrillic TMP";
            if (!asset.TryAddCharacters(RussianLetters, out string missing) || !string.IsNullOrEmpty(missing))
                throw new InvalidOperationException("Could not bake all Russian letters: " + missing);

            // The atlas and material belong to this asset, so TMP can release them
            // without touching the source font or any other saved asset.
            asset.atlasPopulationMode = AtlasPopulationMode.Static;
            AssetDatabase.CreateAsset(asset, AssetPath);
            foreach (Texture2D atlas in asset.atlasTextures)
            {
                atlas.name = asset.name + " Atlas";
                AssetDatabase.AddObjectToAsset(atlas, asset);
            }
            asset.material.name = asset.name + " Material";
            AssetDatabase.AddObjectToAsset(asset.material, asset);
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(AssetPath, ImportAssetOptions.ForceUpdate);

            TMP_FontAsset saved = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(AssetPath);
            foreach (char letter in RussianLetters)
            {
                if (!saved.HasCharacter(letter))
                    throw new InvalidOperationException("Saved TMP font is missing: " + letter);
            }
            Debug.Log("Created Noto Sans Cyrillic TMP font with all Russian letters: " + AssetPath);
        }

        [MenuItem("Realm of Ashes/Probe/Cyrillic TMP Fallback")]
        public static void Probe()
        {
            TMP_FontAsset fallback = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(AssetPath);
            TMP_FontAsset source = Resources.Load<TMP_FontAsset>("ApocalypseHud/Font_Apocalypse_Body")
                ?? TMP_Settings.defaultFontAsset;
            if (fallback == null || source == null)
                throw new InvalidOperationException("TMP font assets are unavailable for the Cyrillic probe.");

            List<TMP_FontAsset> originalFallbacks = TMP_Settings.fallbackFontAssets == null
                ? null : new List<TMP_FontAsset>(TMP_Settings.fallbackFontAssets);
            GameObject host = null;
            try
            {
                host = new GameObject("Cyrillic TMP Probe", typeof(RectTransform),
                    typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
                Canvas canvas = host.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                CanvasScaler scaler = host.GetComponent<CanvasScaler>();
                scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
                scaler.referenceResolution = new Vector2(1280f, 720f);

                GameObject labelObject = new GameObject("Cyrillic Label", typeof(RectTransform),
                    typeof(CanvasRenderer), typeof(TextMeshProUGUI));
                labelObject.transform.SetParent(host.transform, false);
                RectTransform rect = (RectTransform)labelObject.transform;
                rect.anchorMin = new Vector2(0.08f, 0.1f);
                rect.anchorMax = new Vector2(0.92f, 0.9f);
                rect.offsetMin = rect.offsetMax = Vector2.zero;
                TextMeshProUGUI label = labelObject.GetComponent<TextMeshProUGUI>();
                label.font = source;
                label.fontSize = 48f;
                label.alignment = TextAlignmentOptions.MidlineLeft;
                label.text = "Кромка — проверка кириллицы\nЁж, щука, подъём";
                RoaApocalypseTmpFonts.Apply(host);

                if (label.font != source)
                    throw new InvalidOperationException("The label's authored font was replaced.");
                if (TMP_Settings.fallbackFontAssets == null ||
                    !TMP_Settings.fallbackFontAssets.Contains(fallback))
                    throw new InvalidOperationException("The Cyrillic font was not registered as a fallback.");
                foreach (char letter in RussianLetters)
                {
                    if (!fallback.HasCharacter(letter))
                        throw new InvalidOperationException("The Cyrillic font is missing: " + letter);
                }
                bool alternativeTypeface;
                TMP_Character character = TMP_FontAssetUtilities.GetCharacterFromFontAssets(
                    'Ж', source, TMP_Settings.fallbackFontAssets, true,
                    FontStyles.Normal, FontWeight.Regular, out alternativeTypeface);
                if (character == null)
                    throw new InvalidOperationException("TMP could not resolve a Cyrillic fallback glyph.");

                string captureDirectory = Environment.GetEnvironmentVariable("ROA_CYRILLIC_CAPTURE_DIR");
                if (!string.IsNullOrEmpty(captureDirectory))
                {
                    Directory.CreateDirectory(captureDirectory);
                    Capture(canvas, label, Path.Combine(captureDirectory, "desktop.png"), 1280, 720);
                    Capture(canvas, label, Path.Combine(captureDirectory, "mobile-landscape.png"), 896, 414);
                }
                Debug.Log("[ROA PROBE] Cyrillic TMP fallback and all Russian glyphs passed.");
            }
            finally
            {
                TMP_Settings.fallbackFontAssets = originalFallbacks;
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Capture(Canvas canvas, TextMeshProUGUI label, string path, int width, int height)
        {
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D image = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                cameraObject = new GameObject("Cyrillic Capture Camera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.12f, 0.13f, 0.12f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;

                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
                target.Create();
                camera.targetTexture = target;
                label.ForceMeshUpdate(true, true);
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                {
                    var request = new RenderPipeline.StandardRequest { destination = target };
                    RenderPipeline.SubmitRenderRequest(camera, request);
                }
                else camera.Render();

                RenderTexture.active = target;
                image = new Texture2D(width, height, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0f, 0f, width, height), 0, 0);
                image.Apply(false, false);
                File.WriteAllBytes(path, image.EncodeToPNG());
                Debug.Log("[ROA PROBE] Cyrillic capture: " + path);
            }
            finally
            {
                RenderTexture.active = previous;
                if (image != null) UnityEngine.Object.DestroyImmediate(image);
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }
    }
}
