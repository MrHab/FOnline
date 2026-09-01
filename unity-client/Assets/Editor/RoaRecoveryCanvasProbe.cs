#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaRecoveryCanvasProbe
    {
        private const string RequestName = "RoaRecoveryCanvasProbe.request";
        private static double _nextRequestCheck;

        static RoaRecoveryCanvasProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string root = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(root)) return;
            string request = Path.Combine(root, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem("Realm of Ashes/Проверить восстановление после смерти")]
        private static void Run()
        {
            GameObject host = null;
            try
            {
                JObject pve = JObject.Parse("{\"hp\":55,\"maxHp\":100,\"cause\":{\"enemyName\":\"Пепельный волк\",\"fullDrop\":false},\"failedWorldActivityIds\":[\"task_1\"],\"activityResult\":{\"reason\":\"player_died\"}}");
                Require(RoaRecoveryCanvas.CauseText(pve).Contains("Пепельный волк"),
                        "PvE cause is missing");
                Require(RoaRecoveryCanvas.StateText(pve).Contains("55%")
                        && RoaRecoveryCanvas.StateText(pve).Contains("сохранены"),
                        "safe respawn state is unclear");
                Require(RoaRecoveryCanvas.NextText(pve).Contains("вылазка провалена"),
                        "activity death has no next step");

                JObject pvp = JObject.Parse("{\"hp\":44,\"maxHp\":80,\"cause\":{\"killerName\":\"Рейдер\",\"fullDrop\":true,\"droppedItems\":[{\"id\":\"water\"},{\"id\":\"ammo9\"}]}}");
                Require(RoaRecoveryCanvas.CauseText(pvp).Contains("Рейдер"),
                        "PvP killer is missing");
                Require(RoaRecoveryCanvas.StateText(pvp).Contains("2 поз."),
                        "full-loot loss count is missing");
                Require(RoaWorldActivityCanvas.FailureSummary("time_expired").Contains("ВРЕМЯ ВЫШЛО"),
                        "timeout result does not explain failure");

                host = new GameObject("RecoveryCanvasProbe");
                RoaRecoveryCanvas recovery = host.AddComponent<RoaRecoveryCanvas>();
                recovery.Configure(null, null);
                Transform panel = host.transform.Find("RecoveryCanvas/SafeArea/RecoveryPanel");
                Require(panel != null, "recovery panel was not built");
                int raycastGraphics = 0;
                foreach (Graphic graphic in panel.GetComponentsInChildren<Graphic>(true))
                {
                    if (!graphic.raycastTarget) continue;
                    raycastGraphics++;
                    Require(graphic.GetComponent<Button>() != null,
                            "recovery UI blocks play outside Continue: " + graphic.name);
                }
                Require(raycastGraphics == 1, "recovery UI must expose exactly one clickable graphic");

                Debug.Log("[ВОССТАНОВЛЕНИЕ] готово: причина, потери, провал активности и продолжение");
            }
            catch (Exception error)
            {
                Debug.LogError("[ВОССТАНОВЛЕНИЕ] ошибка: " + error.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        public static void RunBatch()
        {
            Run();
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
