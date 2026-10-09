using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Explicit, ignored review output. The regular WebGL build continues to
    /// own public/unity; use ROA_UNITY_REVIEW_BUILD_DIR on an isolated server.
    /// </summary>
    public static class RoaWebGlStagingBuild
    {
        public static string OutputDirectory
        {
            get
            {
                string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
                return Path.Combine(project, "Builds", "WebGlReview");
            }
        }

        [MenuItem("Realm of Ashes/Build staged WebGL review")]
        public static void Build()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode || BuildPipeline.isBuildingPlayer)
                throw new InvalidOperationException("Build requires idle Edit mode.");
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty)
                    throw new InvalidOperationException("Save edited scenes before building.");

            string output = OutputDirectory;
            Directory.CreateDirectory(output);
            string receiptPath = Path.GetFullPath("Logs/staged-webgl-review-build.json");
            Directory.CreateDirectory(Path.GetDirectoryName(receiptPath));
            var receipt = new JObject {
                ["startedAt"] = DateTime.UtcNow.ToString("O"),
                ["result"] = "RUNNING",
                ["output"] = output,
                ["compression"] = "Gzip",
                ["clientSourceHash"] = RoaWebGlBuild.ClientSourceFingerprint(),
                ["textureBudget"] = RoaWebGlTextureBudget.MaxTextureSize,
                ["texturesOverBudget"] = RoaWebGlTextureBudget.OverBudgetCount(),
                ["items"] = RoaItemModelCatalog.CatalogVersion,
                ["equipment"] = RoaEquipmentModelCatalog.CatalogVersion,
                ["suits"] = RoaSuitModelCatalog.CatalogVersion,
                ["utilities"] = RoaWornUtilityCatalog.CatalogVersion,
                ["weapons"] = RoaModelUrl.WeaponCatalogVersion
            };
            File.WriteAllText(receiptPath, receipt.ToString());

            var previousCompression = PlayerSettings.WebGL.compressionFormat;
            bool previousHashes = PlayerSettings.WebGL.nameFilesAsHashes;
            try
            {
                PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
                PlayerSettings.WebGL.decompressionFallback = true;
                PlayerSettings.WebGL.dataCaching = true;
                PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
                PlayerSettings.WebGL.threadsSupport = false;
                PlayerSettings.WebGL.initialMemorySize = 256;
                PlayerSettings.WebGL.maximumMemorySize = 2048;
                PlayerSettings.WebGL.memoryGrowthMode = WebGLMemoryGrowthMode.Geometric;
                PlayerSettings.runInBackground = true;
                PlayerSettings.stripEngineCode = true;
                PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.Medium);
                PlayerSettings.SplashScreen.show = false;
                // Unity 6000.5 batch builds may loop in Bee with hashed names.
                PlayerSettings.WebGL.nameFilesAsHashes = !Application.isBatchMode;
                PlayerSettings.WebGL.template = "PROJECT:RealmOfAshes";
                PlayerSettings.productName = "Кромка";
                PlayerSettings.companyName = "Kromka Studio";

                var options = new BuildPlayerOptions {
                    scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray(),
                    locationPathName = output,
                    target = BuildTarget.WebGL,
                    options = BuildOptions.None
                };
                BuildReport report = BuildPipeline.BuildPlayer(options);
                if (report == null)
                {
                    receipt["result"] = "Failed";
                    receipt["finishedAt"] = DateTime.UtcNow.ToString("O");
                    File.WriteAllText(receiptPath, receipt.ToString());
                    throw new BuildFailedException("Staged WebGL build did not return a report; inspect the Unity log.");
                }
                BuildSummary summary = report.summary;
                receipt["result"] = summary.result.ToString();
                receipt["finishedAt"] = DateTime.UtcNow.ToString("O");
                receipt["seconds"] = summary.totalTime.TotalSeconds;
                receipt["bytes"] = summary.totalSize;
                receipt["errors"] = summary.totalErrors;
                receipt["warnings"] = summary.totalWarnings;
                receipt["scenes"] = new JArray(options.scenes);
                receipt["clientSourceHashAtFinish"] = RoaWebGlBuild.ClientSourceFingerprint();
                if (summary.result == BuildResult.Succeeded)
                {
                    string index = Path.Combine(output, "index.html");
                    string html = File.ReadAllText(index);
                    html = System.Text.RegularExpressions.Regex.Replace(html,
                        @"(\.framework\.js\.(?:unityweb|gz|br))(?="")",
                        "$1?v=gzip-" + RoaWornUtilityCatalog.CatalogVersion);
                    File.WriteAllText(index, html);
                }
                File.WriteAllText(receiptPath, receipt.ToString());
                Debug.Log("[ROA] Staged WebGL build " + summary.result + ": "
                    + summary.totalSize / (1024 * 1024) + " MB, " + summary.totalTime + " → " + output);
                if (summary.result != BuildResult.Succeeded)
                    throw new BuildFailedException("Staged WebGL build failed: " + summary.totalErrors
                        + " error(s); receipt: " + receiptPath);
            }
            finally
            {
                PlayerSettings.WebGL.nameFilesAsHashes = previousHashes;
                PlayerSettings.WebGL.compressionFormat = previousCompression;
            }
        }
    }
}
