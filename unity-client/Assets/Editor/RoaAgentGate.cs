#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
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
    /// проекта: шлюз не сохраняет сцены и не трогает несохранённые правки
    /// художника. Единственное исключение — revertOpenScene: откат активной сцены
    /// к состоянию на диске, который выполняется только с явным полем
    /// "confirm": true, то есть после согласия человека.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaAgentGate
    {
        private const string RequestName = "roa-agent-request.json";
        private const string ResponseName = "roa-agent-response.json";
        private static double _nextCheck;

        static RoaAgentGate()
        {
            // Asset-import worker processes share the project Library folder
            // with the main editor. They must never consume automation requests
            // intended for the interactive editor instance.
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
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

                case "revertOpenScene":
                {
                    // Откат активной сцены к состоянию на диске без сохранения.
                    // Выполняется только с явным "confirm": true — после согласия
                    // человека; остальные загруженные сцены закрываются той же командой.
                    if (EditorApplication.isPlaying)
                    {
                        Respond(false, "Редактор в Play-режиме — выйдите из Play и повторите команду.");
                        return;
                    }
                    if (request["confirm"]?.Value<bool>() != true)
                    {
                        Respond(false, "Откат сцены требует поля \"confirm\": true — подтверждение человека.");
                        return;
                    }
                    Scene active = SceneManager.GetActiveScene();
                    string activePath = active.IsValid() ? active.path : string.Empty;
                    if (string.IsNullOrEmpty(activePath))
                    {
                        Respond(false, "Активная сцена не сохранена на диск — откатывать нечего.");
                        return;
                    }
                    int dirtyScenes = 0;
                    for (int i = 0; i < SceneManager.sceneCount; i++)
                        if (SceneManager.GetSceneAt(i).isDirty) dirtyScenes++;
                    if (dirtyScenes == 0)
                    {
                        Respond(true, "Сцена " + active.name + " и так без несохранённых правок.");
                        return;
                    }
                    string activeName = active.name; // после OpenScene старый дескриптор сцены пуст
                    UnityEditor.SceneManagement.EditorSceneManager.OpenScene(activePath,
                        UnityEditor.SceneManagement.OpenSceneMode.Single);
                    Respond(true, "Сцена " + activeName + " перечитана с диска; несохранённых сцен отброшено: " + dirtyScenes + ".");
                    return;
                }

                case "refresh":
                    // Импорт внешних правок кода без фокуса окна: обычный
                    // auto-refresh срабатывает только при активации редактора.
                    Respond(true, "AssetDatabase.Refresh запущен.");
                    AssetDatabase.Refresh();
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
                    bool allowed = path.StartsWith("Realm of Ashes/", StringComparison.Ordinal)
                        || path.StartsWith("Кромка/Авторинг/", StringComparison.Ordinal)
                        || path.StartsWith("Кромка/Проверки/", StringComparison.Ordinal)
                        || string.Equals(path, "Кромка/Build WebGL", StringComparison.Ordinal);
                    if (!allowed)
                    {
                        Respond(false, "Разрешены только проверки, авторинг Кромки и безопасные пункты меню проекта.");
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
