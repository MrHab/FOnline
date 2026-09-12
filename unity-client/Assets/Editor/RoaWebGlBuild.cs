using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using System.Security.Cryptography;
using System.Text;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Сборка WebGL-клиента в public/unity/ игрового сервера — чтобы тот же Node
    /// раздавал её по /unity/ рядом с браузерным клиентом (см. server.js,
    /// заголовки Content-Encoding для .br/.gz). Меню: Кромка → Build WebGL,
    /// или из пакетного режима: -executeMethod RealmOfAshes.EditorTools.RoaWebGlBuild.Build.
    /// </summary>
    public static class RoaWebGlBuild
    {
        public static string OutputDirectory
        {
            get
            {
                string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
                return Path.GetFullPath(Path.Combine(project, "..", "public", "unity"));
            }
        }

        [MenuItem("Кромка/Build WebGL")]
        public static void Build()
        {
            BuildCore(WebGLCompressionFormat.Brotli);
        }

        internal static string ClientSourceFingerprint()
        {
            string root = Path.Combine(Application.dataPath, "Scripts");
            var text = new StringBuilder();
            using (SHA256 sha = SHA256.Create())
            {
                foreach (string file in Directory.GetFiles(root, "*.cs", SearchOption.AllDirectories).OrderBy(p => p, System.StringComparer.Ordinal))
                {
                    string relative = file.Substring(root.Length + 1).Replace('\\', '/');
                    string hash = System.BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(file))).Replace("-", "").ToLowerInvariant();
                    text.Append(relative).Append('=').Append(hash).Append('\n');
                }
                return System.BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text.ToString()))).Replace("-", "").ToLowerInvariant();
            }
        }

        // Gzip keeps iterative loopback builds fast. Production's Brotli setting
        // is restored even when compilation fails; no deployment is performed.
        [MenuItem("Realm of Ashes/Build local WebGL review")]
        public static void BuildLocalReview()
        {
            var previous = PlayerSettings.WebGL.compressionFormat;
            try { BuildCore(WebGLCompressionFormat.Gzip); }
            finally { PlayerSettings.WebGL.compressionFormat = previous; }
        }

        private static void BuildCore(WebGLCompressionFormat compression)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode || BuildPipeline.isBuildingPlayer)
                throw new System.InvalidOperationException("Build requires idle Edit mode.");
            for (int i=0;i<UnityEngine.SceneManagement.SceneManager.sceneCount;i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty)
                    throw new System.InvalidOperationException("Save edited scenes before building.");
            string output = OutputDirectory;
            Directory.CreateDirectory(output);
            string receiptPath = Path.GetFullPath("Logs/local-webgl-build.json");
            Directory.CreateDirectory(Path.GetDirectoryName(receiptPath));
            var receipt = new JObject {
                ["startedAt"] = System.DateTime.UtcNow.ToString("O"), ["result"] = "RUNNING",
                ["compression"] = compression.ToString(),
                ["clientSourceHash"] = ClientSourceFingerprint(),
                ["items"] = RoaItemModelCatalog.CatalogVersion,
                ["equipment"] = RoaEquipmentModelCatalog.CatalogVersion,
                ["suits"] = RoaSuitModelCatalog.CatalogVersion,
                ["utilities"] = RoaWornUtilityCatalog.CatalogVersion,
                ["weapons"] = RoaModelUrl.WeaponCatalogVersion };
            File.WriteAllText(receiptPath, receipt.ToString());

            // Brotli + fallback: по https браузер распаковывает сам (сервер шлёт Content-Encoding: br),
            // по http или на хостинге без заголовка — распакует загрузчик Unity.
            PlayerSettings.WebGL.compressionFormat = compression;
            PlayerSettings.WebGL.decompressionFallback = true;
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
            PlayerSettings.WebGL.threadsSupport = false;
            PlayerSettings.WebGL.initialMemorySize = 256;
            PlayerSettings.WebGL.maximumMemorySize = 2048;
            PlayerSettings.WebGL.memoryGrowthMode = WebGLMemoryGrowthMode.Geometric;
            PlayerSettings.runInBackground = true;
            // Стрипинг движка и managed-кода включён; то, что добавляется из кода или читается
            // рефлексией (коллайдеры, Newtonsoft, glTFast), защищено Assets/link.xml.
            PlayerSettings.stripEngineCode = true;
            PlayerSettings.SetManagedStrippingLevel(UnityEditor.Build.NamedBuildTarget.WebGL, ManagedStrippingLevel.Medium);
            PlayerSettings.SplashScreen.show = false; // логотип Unity — 2,7 МБ в данных
            // Имена файлов — хэши содержимого: кеш браузера и IndexedDB-кеш Unity никогда не
            // смешают framework/wasm разных сборок (иначе LinkError при обновлении).
            PlayerSettings.WebGL.nameFilesAsHashes = true;
            PlayerSettings.WebGL.template = "PROJECT:RealmOfAshes";
            PlayerSettings.productName = "Кромка";
            PlayerSettings.companyName = "Kromka Studio";

            var options = new BuildPlayerOptions
            {
                // Runtime location/map presentation is loaded additively. Building only
                // Wasteland silently drops those authored scenes from WebGL even though
                // they are enabled in the project's build profile.
                scenes = EditorBuildSettings.scenes
                    .Where(scene => scene.enabled)
                    .Select(scene => scene.path)
                    .ToArray(),
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            BuildSummary summary = report.summary;
            receipt["result"] = summary.result.ToString();
            receipt["finishedAt"] = System.DateTime.UtcNow.ToString("O");
            receipt["seconds"] = summary.totalTime.TotalSeconds;
            receipt["bytes"] = summary.totalSize;
            receipt["errors"] = summary.totalErrors;
            receipt["warnings"] = summary.totalWarnings;
            receipt["scenes"] = new JArray(options.scenes);
            receipt["clientSourceHashAtFinish"] = ClientSourceFingerprint();
            if (summary.result == BuildResult.Succeeded)
            {
                // Unity hashes the uncompressed framework; switching compression
                // can otherwise reuse an incompatible browser-cached response.
                string index = Path.Combine(output, "index.html");
                string html = File.ReadAllText(index);
                html = System.Text.RegularExpressions.Regex.Replace(html,
                    @"(\.framework\.js\.(?:unityweb|gz|br))(?="")",
                    "$1?v=" + compression.ToString().ToLowerInvariant() + "-" + RoaWornUtilityCatalog.CatalogVersion);
                File.WriteAllText(index, html);
            }
            File.WriteAllText(receiptPath, receipt.ToString());
            Debug.Log("[ROA] WebGL build " + summary.result + ": " + summary.totalSize / (1024 * 1024) + " MB, " + summary.totalTime + " → " + output);
            if (summary.result != BuildResult.Succeeded) Debug.LogError("[ROA] WebGL build failed: " + summary.totalErrors + " error(s)");
        }
    }
}
