using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Сборка WebGL-клиента в public/unity/ игрового сервера — чтобы тот же Node
    /// раздавал её по /unity/ рядом с браузерным клиентом (см. server.js,
    /// заголовки Content-Encoding для .br/.gz). Меню: Realm of Ashes → Build WebGL,
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

        [MenuItem("Realm of Ashes/Build WebGL")]
        public static void Build()
        {
            string output = OutputDirectory;
            Directory.CreateDirectory(output);

            // Gzip + fallback: сервер шлёт Content-Encoding, а если хостинг этого не умеет —
            // загрузчик Unity распакует сам. Brotli требует https, gzip работает и по http.
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
            PlayerSettings.WebGL.decompressionFallback = true;
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
            PlayerSettings.WebGL.threadsSupport = false;
            PlayerSettings.WebGL.initialMemorySize = 256;
            PlayerSettings.WebGL.maximumMemorySize = 2048;
            PlayerSettings.WebGL.memoryGrowthMode = WebGLMemoryGrowthMode.Geometric;
            PlayerSettings.runInBackground = true;
            // Компоненты (CharacterController, коллайдеры) добавляются из кода, а не из сцены —
            // стрипинг движка их вырезал («class 'SphereCollider' doesn't exist»).
            PlayerSettings.stripEngineCode = false;
            // Имена файлов — хэши содержимого: кеш браузера и IndexedDB-кеш Unity никогда не
            // смешают framework/wasm разных сборок (иначе LinkError при обновлении).
            PlayerSettings.WebGL.nameFilesAsHashes = true;
            PlayerSettings.WebGL.template = "PROJECT:RealmOfAshes";
            PlayerSettings.productName = "Realm of Ashes";
            PlayerSettings.companyName = "Realm of Ashes";

            var options = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/Wasteland.unity" },
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            BuildSummary summary = report.summary;
            Debug.Log("[ROA] WebGL build " + summary.result + ": " + summary.totalSize / (1024 * 1024) + " MB, " + summary.totalTime + " → " + output);
            if (summary.result != BuildResult.Succeeded) Debug.LogError("[ROA] WebGL build failed: " + summary.totalErrors + " error(s)");
        }
    }
}
