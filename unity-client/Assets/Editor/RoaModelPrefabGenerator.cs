using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GLTFast;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.Editor
{
    /// <summary>
    /// Creates small native Unity prefab variants for every shared GLB. The binary
    /// models remain single-source in public/assets/models and enter Unity through
    /// the local com.realmofashes.models package.
    /// </summary>
    public static class RoaModelPrefabGenerator
    {
        public const string PackageRoot = "Packages/com.realmofashes.models";
        public const string PrefabRoot = "Assets/Prefabs/Models";
        public const string CatalogPath =
            "Assets/Resources/RealmOfAshes/GlobalMapModelPrefabs.asset";

        private static readonly HashSet<string> RuntimeModelUrls = BuildRuntimeModelUrls();

        [MenuItem("Realm of Ashes/Models/Rebuild all model prefabs")]
        public static void RebuildAll()
        {
            string[] sourcePaths = FindModelPaths();
            ValidateSourceInventory(sourcePaths);

            EnsureFolder(PrefabRoot);
            ConfigureLegacyAnimation(sourcePaths);

            var generated = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var runtimeEntries = new List<RoaModelPrefabCatalog.Entry>();
            int failed = 0;

            foreach (string sourcePath in sourcePaths)
            {
                string relative = sourcePath.Substring(PackageRoot.Length).TrimStart('/');
                string destination = PrefabRoot + "/"
                    + Path.ChangeExtension(relative, ".prefab").Replace('\\', '/');
                EnsureFolder(Path.GetDirectoryName(destination)?.Replace('\\', '/'));

                GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(sourcePath);
                if (source == null)
                {
                    failed++;
                    Debug.LogError("[ROA MODELS] GLB has no GameObject main asset: " + sourcePath);
                    continue;
                }

                GameObject instance = PrefabUtility.InstantiatePrefab(source) as GameObject;
                if (instance == null) instance = UnityEngine.Object.Instantiate(source);
                try
                {
                    GameObject saved = PrefabUtility.SaveAsPrefabAsset(instance, destination);
                    if (saved == null)
                    {
                        failed++;
                        Debug.LogError("[ROA MODELS] Could not save prefab: " + destination);
                        continue;
                    }
                    generated.Add(destination);
                    string url = PackagePathToServerUrl(sourcePath);
                    if (RuntimeModelUrls.Contains(url))
                        runtimeEntries.Add(new RoaModelPrefabCatalog.Entry(url, saved));
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(instance);
                }
            }

            if (failed > 0)
                throw new InvalidOperationException("Failed to generate " + failed + " model prefab(s).");
            if (generated.Count != sourcePaths.Length)
                throw new InvalidOperationException("Generated " + generated.Count + " of "
                    + sourcePaths.Length + " model prefabs.");

            // A failed or incomplete import must not retire an existing prefab
            // or replace the runtime catalog with a partial set of entries.
            ValidateSourceInventory(sourcePaths);
            if (runtimeEntries.Count != RuntimeModelUrls.Count)
                throw new InvalidOperationException("Runtime model catalog is incomplete.");
            RemoveStalePrefabs(generated);
            WriteRuntimeCatalog(runtimeEntries);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log("[ROA MODELS] PREFAB GENERATION PASS: " + generated.Count
                + " prefabs, " + runtimeEntries.Count + " runtime catalog entries.");
        }

        public static void RunBatch()
        {
            try
            {
                RebuildAll();
                EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                EditorApplication.Exit(1);
            }
        }

        public static string[] FindModelPaths()
        {
            return AssetDatabase.FindAssets(string.Empty, new[] { PackageRoot })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".glb", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
        }

        public static void ValidateSourceInventory(IEnumerable<string> importedPaths)
        {
            // The local package is the repository's canonical model directory.
            // Compare the import database with disk so unimported new GLBs cannot
            // silently disappear from both the generator and its probe.
            string diskRoot = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../public/assets/models"));
            string[] expected = Directory.GetFiles(diskRoot, "*", SearchOption.AllDirectories)
                .Where(file => file.EndsWith(".glb", StringComparison.OrdinalIgnoreCase))
                .Select(file => PackageRoot + "/" + file.Substring(diskRoot.Length + 1).Replace('\\', '/'))
                .OrderBy(file => file, StringComparer.Ordinal).ToArray();
            string[] actual = importedPaths.OrderBy(file => file, StringComparer.Ordinal).ToArray();
            if (expected.Length == 0
                || expected.Distinct(StringComparer.OrdinalIgnoreCase).Count() != expected.Length
                || !expected.SequenceEqual(actual, StringComparer.Ordinal))
            {
                string missing = string.Join(", ", expected.Except(actual, StringComparer.Ordinal).Take(5));
                string unexpected = string.Join(", ", actual.Except(expected, StringComparer.Ordinal).Take(5));
                throw new InvalidOperationException("Canonical model import inventory mismatch: "
                    + expected.Length + " disk GLBs, " + actual.Length + " imported; missing: "
                    + missing + "; unexpected: " + unexpected);
            }
        }

        public static string PackagePathToServerUrl(string packagePath)
        {
            string relative = packagePath.Substring(PackageRoot.Length).TrimStart('/');
            return ("/assets/models/" + relative).Replace('\\', '/').ToLowerInvariant();
        }

        private static void ConfigureLegacyAnimation(IEnumerable<string> sourcePaths)
        {
            foreach (string path in sourcePaths)
            {
                AssetImporter importer = AssetImporter.GetAtPath(path);
                if (importer == null) continue;
                var serialized = new SerializedObject(importer);
                bool changed = SetEnum(serialized, "importSettings.animationMethod",
                    (int)AnimationMethod.Legacy);
                changed |= SetEnum(serialized, "importSettings.nodeNameMethod",
                    (int)NameImportMethod.OriginalUnique);
                SerializedProperty mipMaps =
                    serialized.FindProperty("importSettings.generateMipMaps");
                if (mipMaps != null && !mipMaps.boolValue)
                {
                    mipMaps.boolValue = true;
                    changed = true;
                }
                if (!changed) continue;
                serialized.ApplyModifiedPropertiesWithoutUndo();
                importer.SaveAndReimport();
            }
        }

        private static bool SetEnum(SerializedObject serialized, string path, int value)
        {
            SerializedProperty property = serialized.FindProperty(path);
            if (property == null || property.enumValueIndex == value) return false;
            property.enumValueIndex = value;
            return true;
        }

        private static void WriteRuntimeCatalog(List<RoaModelPrefabCatalog.Entry> entries)
        {
            EnsureFolder(Path.GetDirectoryName(CatalogPath)?.Replace('\\', '/'));
            RoaModelPrefabCatalog catalog =
                AssetDatabase.LoadAssetAtPath<RoaModelPrefabCatalog>(CatalogPath);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<RoaModelPrefabCatalog>();
                AssetDatabase.CreateAsset(catalog, CatalogPath);
            }
            catalog.ReplaceEntries(entries);
            EditorUtility.SetDirty(catalog);
        }

        private static void RemoveStalePrefabs(HashSet<string> generated)
        {
            foreach (string guid in AssetDatabase.FindAssets("t:Prefab", new[] { PrefabRoot }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!generated.Contains(path)) AssetDatabase.DeleteAsset(path);
            }
        }

        private static void EnsureFolder(string path)
        {
            if (string.IsNullOrEmpty(path) || AssetDatabase.IsValidFolder(path)) return;
            string parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            string name = Path.GetFileName(path);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, name);
        }

        // Каталог Resources попадает в сборку целиком, а GLB при импорте
        // разворачивается в несжатые текстуры и вершины: файл на 4 МБ весит в
        // player data 37 МБ. Поэтому здесь остаётся только то, что нужно
        // каждому игроку сразу и всегда — тело персонажа и общая библиотека
        // анимаций. Твари встречаются по одной-две на локацию и подгружаются
        // тем же путём, что и всё остальное: по URL из /assets/models-lite/
        // (RoaCharacterView → LoadCached), где облегчённая тварь весит
        // 0,4–2,8 МБ вместо 20–37 МБ в сборке.
        private static HashSet<string> BuildRuntimeModelUrls()
        {
            var urls = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "/assets/models/characters/npc/npc_humanoid_animations.glb"
            };
            // Телосложения больше нет: у каждого пола одна базовая модель.
            foreach (string sex in new[] { "female", "male" })
                urls.Add("/assets/models/characters/base/character_" + sex + "_medium.glb");
            return urls;
        }
    }
}
