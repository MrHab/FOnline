#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Бюджет текстур WebGL-сборки.
    ///
    /// Художественные паки приходят с текстурами по 2048–4096, и в player data
    /// они ложатся несжатыми: одна текстура террейна весит в сборке 21 МБ
    /// (2048² RGBA32 с мипами), а весь пак окружения — 445 МБ из 827 МБ всех
    /// используемых ассетов. Игрок в браузере качает это целиком до первого
    /// кадра.
    ///
    /// Поэтому для WebGL каждому такому ассету ставится собственный предел
    /// размера. Настройка живёт в .meta, а художественные паки в git не входят
    /// (`unity-client/Assets/MEP/` в .gitignore) — значит правку .meta руками
    /// другая машина не увидит и соберёт другой билд. Отсюда постпроцессор: он
    /// лежит в репозитории и проставляет предел при импорте у всех одинаково.
    /// Уже импортированное приводит к бюджету пункт меню.
    /// </summary>
    public sealed class RoaWebGlTextureBudget : AssetPostprocessor
    {
        /// <summary>1024 хватает окружению на экране браузера и режет вес вчетверо.</summary>
        public const int MaxTextureSize = 1024;

        private const string Platform = "WebGL";

        /// <summary>
        /// Паки окружения и реквизита. Модели персонажей и предметов сюда не
        /// входят: их текстуры уже готовит `npm run build:models-lite`.
        /// </summary>
        public static readonly string[] Roots = { "Assets/MEP" };

        public static bool InBudgetScope(string assetPath)
        {
            string path = (assetPath ?? string.Empty).Replace('\\', '/');
            foreach (string root in Roots)
                if (path.StartsWith(root + "/", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>Приводит настройки к бюджету; true — если что-то поменялось.</summary>
        public static bool ApplyBudget(TextureImporter importer)
        {
            if (importer == null) return false;
            TextureImporterPlatformSettings settings = importer.GetPlatformTextureSettings(Platform);
            if (settings.overridden && settings.maxTextureSize <= MaxTextureSize
                && settings.textureCompression != TextureImporterCompression.Uncompressed) return false;
            settings.overridden = true;
            settings.maxTextureSize = Math.Min(settings.maxTextureSize <= 0 ? MaxTextureSize : settings.maxTextureSize, MaxTextureSize);
            settings.format = TextureImporterFormat.Automatic;
            settings.textureCompression = TextureImporterCompression.Compressed;
            importer.SetPlatformTextureSettings(settings);
            return true;
        }

        /// <summary>Сколько ассетов ещё не в бюджете — без переимпорта, для отчёта сборки.</summary>
        public static int OverBudgetCount(List<string> examples = null)
        {
            int over = 0;
            foreach (string guid in AssetDatabase.FindAssets("t:Texture2D", Roots))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var importer = AssetImporter.GetAtPath(path) as TextureImporter;
                if (importer == null) continue;
                TextureImporterPlatformSettings settings = importer.GetPlatformTextureSettings(Platform);
                if (settings.overridden && settings.maxTextureSize <= MaxTextureSize) continue;
                over += 1;
                if (examples != null && examples.Count < 5) examples.Add(path);
            }
            return over;
        }

        [MenuItem("Кромка/Авторинг/Бюджет текстур WebGL")]
        public static void ApplyToImportedAssets()
        {
            string[] guids = AssetDatabase.FindAssets("t:Texture2D", Roots);
            int changed = 0;
            for (int i = 0; i < guids.Length; i++)
            {
                string path = AssetDatabase.GUIDToAssetPath(guids[i]);
                var importer = AssetImporter.GetAtPath(path) as TextureImporter;
                if (importer == null) continue;
                if (EditorUtility.DisplayCancelableProgressBar("Бюджет текстур WebGL",
                        path, (i + 1f) / Math.Max(1, guids.Length))) break;
                if (!ApplyBudget(importer)) continue;
                importer.SaveAndReimport();
                changed += 1;
            }
            EditorUtility.ClearProgressBar();
            Debug.Log("[ROA] Бюджет текстур WebGL (" + MaxTextureSize + "): приведено "
                + changed + " из " + guids.Length + " текстур.");
        }

        [MenuItem("Кромка/Проверки/Бюджет текстур WebGL")]
        public static void ReportBudget()
        {
            var examples = new List<string>();
            int over = OverBudgetCount(examples);
            Debug.Log("[ROA] Вне бюджета текстур WebGL: " + over
                + (examples.Count > 0 ? " · например " + string.Join(", ", examples) : " · всё в бюджете"));
        }
    }
}
#endif
