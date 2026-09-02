#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Файловый канал команд для внешней автоматизации (по образцу
    /// RoaPlayModeRequest): агент кладёт запрос в Library/roa-agent-request.json,
    /// редактор выполняет его на ближайшем тике update и пишет ответ в
    /// Library/roa-agent-response.json. Работает без фокуса окна.
    ///
    /// Команды намеренно ограничены безопасными операциями чтения и меню
    /// проекта: шлюз не открывает и не сохраняет сцены, не трогает несохранённые
    /// правки художника.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaAgentGate
    {
        private const string RequestName = "roa-agent-request.json";
        private const string ResponseName = "roa-agent-response.json";
        private static double _nextCheck;

        static RoaAgentGate()
        {
            EditorApplication.update += Poll;
        }

        private static string LibraryPath(string file)
        {
            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            return string.IsNullOrEmpty(projectRoot)
                ? null
                : Path.Combine(projectRoot, "Library", file);
        }

        private static void Poll()
        {
            if (EditorApplication.timeSinceStartup < _nextCheck) return;
            _nextCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;

            string requestPath = LibraryPath(RequestName);
            if (requestPath == null || !File.Exists(requestPath)) return;

            JObject request;
            try
            {
                request = JObject.Parse(File.ReadAllText(requestPath));
            }
            catch (Exception error)
            {
                File.Delete(requestPath);
                Respond(false, "Некорректный JSON запроса: " + error.Message);
                return;
            }
            File.Delete(requestPath);

            try
            {
                Execute(request);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                Respond(false, error.Message);
            }
        }

        private static void Execute(JObject request)
        {
            string command = request["command"]?.ToString() ?? string.Empty;
            switch (command)
            {
                case "ping":
                    Respond(true, "pong; сцена: " + SceneManager.GetActiveScene().name
                        + (EditorApplication.isPlaying ? " (play)" : " (edit)"));
                    return;

                case "openMapScene":
                {
                    if (FindLoadedMarker() != null)
                    {
                        Respond(true, "Сцена GlobalMapAuthored уже загружена.");
                        return;
                    }
                    for (int i = 0; i < SceneManager.sceneCount; i++)
                    {
                        if (!SceneManager.GetSceneAt(i).isDirty) continue;
                        Respond(false, "Есть несохранённая сцена ("
                            + SceneManager.GetSceneAt(i).name
                            + ") — сохраните её сами, автоматика правки не трогает.");
                        return;
                    }
                    UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
                        "Assets/Scenes/GlobalMapAuthored.unity",
                        UnityEditor.SceneManagement.OpenSceneMode.Single);
                    Respond(true, "Сцена GlobalMapAuthored открыта.");
                    return;
                }

                case "refresh":
                    // Импорт внешних правок кода без фокуса окна: обычный
                    // auto-refresh срабатывает только при активации редактора.
                    Respond(true, "AssetDatabase.Refresh запущен.");
                    AssetDatabase.Refresh();
                    return;

                case "captureMap":
                    CaptureMap(request);
                    return;

                case "executeMenu":
                {
                    // Авторинг-меню в Play-режиме молча падают внутри
                    // ExecuteMenuItem — отклоняем честно, агент повторит.
                    if (EditorApplication.isPlaying)
                    {
                        Respond(false, "Редактор в Play-режиме — выйдите из"
                            + " Play и повторите команду.");
                        return;
                    }
                    string path = request["path"]?.ToString() ?? string.Empty;
                    // Только меню проекта: никаких File/Save, Build и системных пунктов
                    // без явного намерения человека.
                    if (!path.StartsWith("Realm of Ashes/", StringComparison.Ordinal))
                    {
                        Respond(false, "Разрешены только пункты меню Realm of Ashes/.");
                        return;
                    }
                    bool executed = EditorApplication.ExecuteMenuItem(path);
                    Respond(executed, executed ? "Выполнено: " + path
                        : "Пункт меню не найден: " + path);
                    return;
                }

                default:
                    Respond(false, "Неизвестная команда: " + command);
                    return;
            }
        }

        // ------------------------------------------------------------------

        private static void CaptureMap(JObject request)
        {
            RoaUnityGlobalMapScene marker = FindLoadedMarker();
            if (marker == null)
            {
                Respond(false, "Сцена GlobalMapAuthored не загружена в редакторе.");
                return;
            }

            string output = request["output"]?.ToString();
            if (string.IsNullOrWhiteSpace(output)) output = LibraryPath("AgentCaptures");
            Directory.CreateDirectory(output);

            var saved = SaveRenderSettings();
            try
            {
                ApplyStrategicLighting(marker);
                JArray shots = request["shots"] as JArray;
                if (shots == null || shots.Count == 0)
                {
                    shots = new JArray
                    {
                        Shot("01-overview", 0f, 0f, 112f, 55f, 45f),
                        Shot("02-west-coast", -31f, 4f, 47f, 52f, 78f),
                        Shot("03-biome-detail", 10f, 8f, 24f, 48f, 222f),
                        Shot("04-east-boundary", 43f, 0f, 32f, 48f, 90f)
                    };
                }
                int count = 0;
                foreach (JToken token in shots)
                {
                    JObject shot = token as JObject;
                    if (shot == null) continue;
                    string name = shot["name"]?.ToString() ?? ("shot-" + count);
                    Capture(Path.Combine(output, name + ".png"),
                        new Vector3(shot["x"]?.ToObject<float>() ?? 0f, 0f,
                                    shot["z"]?.ToObject<float>() ?? 0f),
                        shot["distance"]?.ToObject<float>() ?? 80f,
                        shot["pitch"]?.ToObject<float>() ?? 55f,
                        shot["yaw"]?.ToObject<float>() ?? 45f,
                        shot["width"]?.ToObject<int>() ?? 1600,
                        shot["height"]?.ToObject<int>() ?? 900);
                    count++;
                }
                Respond(true, "Снимков: " + count + " → " + output);
            }
            finally
            {
                RestoreRenderSettings(saved);
            }
        }

        private static JObject Shot(string name, float x, float z, float distance,
                                    float pitch, float yaw)
        {
            return new JObject
            {
                ["name"] = name, ["x"] = x, ["z"] = z,
                ["distance"] = distance, ["pitch"] = pitch, ["yaw"] = yaw
            };
        }

        private static RoaUnityGlobalMapScene FindLoadedMarker()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded) continue;
                foreach (GameObject root in scene.GetRootGameObjects())
                {
                    RoaUnityGlobalMapScene marker =
                        root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                    if (marker != null) return marker;
                }
            }
            return null;
        }

        private struct SavedRenderSettings
        {
            public AmbientMode AmbientMode;
            public Color Sky, Equator, Ground, FogColor;
            public float AmbientIntensity, ReflectionIntensity, FogStart, FogEnd;
            public bool Fog;
            public FogMode FogMode;
            public Light Sun;
        }

        private static SavedRenderSettings SaveRenderSettings()
        {
            return new SavedRenderSettings
            {
                AmbientMode = RenderSettings.ambientMode,
                Sky = RenderSettings.ambientSkyColor,
                Equator = RenderSettings.ambientEquatorColor,
                Ground = RenderSettings.ambientGroundColor,
                AmbientIntensity = RenderSettings.ambientIntensity,
                ReflectionIntensity = RenderSettings.reflectionIntensity,
                Fog = RenderSettings.fog,
                FogMode = RenderSettings.fogMode,
                FogColor = RenderSettings.fogColor,
                FogStart = RenderSettings.fogStartDistance,
                FogEnd = RenderSettings.fogEndDistance,
                Sun = RenderSettings.sun
            };
        }

        private static void RestoreRenderSettings(SavedRenderSettings saved)
        {
            RenderSettings.ambientMode = saved.AmbientMode;
            RenderSettings.ambientSkyColor = saved.Sky;
            RenderSettings.ambientEquatorColor = saved.Equator;
            RenderSettings.ambientGroundColor = saved.Ground;
            RenderSettings.ambientIntensity = saved.AmbientIntensity;
            RenderSettings.reflectionIntensity = saved.ReflectionIntensity;
            RenderSettings.fog = saved.Fog;
            RenderSettings.fogMode = saved.FogMode;
            RenderSettings.fogColor = saved.FogColor;
            RenderSettings.fogStartDistance = saved.FogStart;
            RenderSettings.fogEndDistance = saved.FogEnd;
            RenderSettings.sun = saved.Sun;
        }

        private static void ApplyStrategicLighting(RoaUnityGlobalMapScene marker)
        {
            RoaGlobalMap.StrategicVisualProfile profile = RoaGlobalMap.StrategicProfile(90f);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = profile.AmbientSky;
            RenderSettings.ambientEquatorColor = profile.AmbientEquator;
            RenderSettings.ambientGroundColor = profile.AmbientGround;
            RenderSettings.ambientIntensity = profile.AmbientIntensity;
            RenderSettings.reflectionIntensity = profile.ReflectionIntensity;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = profile.FogColor;
            RenderSettings.fogStartDistance = profile.FogStart;
            RenderSettings.fogEndDistance = profile.FogEnd;
            foreach (Light light in marker.GetComponentsInChildren<Light>(true))
            {
                if (light != null && light.name == "GlobalMapSun_AUTHORED")
                {
                    light.enabled = true;
                    RenderSettings.sun = light;
                    break;
                }
            }
        }

        private static void Capture(string path, Vector3 target, float distance,
                                    float pitch, float yaw, int width, int height)
        {
            GameObject cameraObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                cameraObject = new GameObject("RoaAgentGateCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = RoaCameraRig.StrategicFieldOfView;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 500f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = RoaGlobalMap.StrategicProfile(90f).CameraBackground;
                camera.allowHDR = true;
                camera.allowMSAA = true;
                Quaternion orbit = Quaternion.Euler(pitch, yaw, 0f);
                camera.transform.SetPositionAndRotation(
                    target - orbit * Vector3.forward * distance, orbit);

                renderTarget = new RenderTexture(width, height, 24,
                    RenderTextureFormat.ARGB32) { antiAliasing = 1, useMipMap = false };
                renderTarget.Create();
                camera.targetTexture = renderTarget;
                camera.Render();

                RenderTexture.active = renderTarget;
                readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (cameraObject != null)
                {
                    Camera camera = cameraObject.GetComponent<Camera>();
                    if (camera != null) camera.targetTexture = null;
                }
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (renderTarget != null)
                {
                    renderTarget.Release();
                    UnityEngine.Object.DestroyImmediate(renderTarget);
                }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        private static void Respond(bool ok, string message)
        {
            string responsePath = LibraryPath(ResponseName);
            if (responsePath == null) return;
            File.WriteAllText(responsePath, new JObject
            {
                ["ok"] = ok,
                ["message"] = message,
                ["at"] = DateTime.UtcNow.ToString("o")
            }.ToString());
            Debug.Log("[ROA-AGENT] " + (ok ? "OK: " : "Ошибка: ") + message);
        }
    }
}
#endif
