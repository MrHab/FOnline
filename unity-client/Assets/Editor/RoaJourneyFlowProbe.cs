#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaJourneyFlowProbe
    {
        [MenuItem("Realm of Ashes/Проверить Journey Flow 5.2")]
        public static void Run()
        {
            try
            {
                Require(!RoaSocketClient.AckRequestExpired(4.99f, 5f)
                    && RoaSocketClient.AckRequestExpired(5f, 5f),
                    "таймаут ответа срабатывает не на своей границе");

                JObject timeout = RoaSocketClient.AckFailure("changeLocation", true, false);
                JObject disconnected = RoaSocketClient.AckFailure("globalTravelStart", false, true);
                Require(timeout["ok"]?.Value<bool>() == false
                    && timeout["timeout"]?.Value<bool>() == true
                    && timeout["eventName"]?.ToString() == "changeLocation"
                    && disconnected["disconnected"]?.Value<bool>() == true,
                    "потерянный ACK не превращается в понятный локальный отказ");

                Require(RoaGlobalMap.ShouldAutoRetryLocationEntry(0, true)
                    && RoaGlobalMap.ShouldAutoRetryLocationEntry(3, true)
                    && !RoaGlobalMap.ShouldAutoRetryLocationEntry(4, true)
                    && !RoaGlobalMap.ShouldAutoRetryLocationEntry(0, false),
                    "вход в локацию имеет неверный лимит автоматических повторов");
                Require(Mathf.Approximately(RoaGlobalMap.LocationEntryRetryDelay(1), 1.25f)
                    && Mathf.Approximately(RoaGlobalMap.LocationEntryRetryDelay(2), 2.5f)
                    && Mathf.Approximately(RoaGlobalMap.LocationEntryRetryDelay(4), 10f),
                    "повторы входа не используют ограниченную задержку");
                Require(RoaGlobalMap.LocationEntryFailureRetryable(timeout)
                    && RoaGlobalMap.LocationEntryFailureRetryable(disconnected)
                    && !RoaGlobalMap.LocationEntryFailureRetryable(new JObject
                    {
                        ["ok"] = false,
                        ["error"] = "Переход запрещён сервером."
                    }),
                    "явный отказ сервера ошибочно повторяется либо потеря связи не восстанавливается");

                Debug.Log("[JOURNEY FLOW 5.2] готово: ACK завершается всегда, вход восстанавливается и повторы ограничены.");
            }
            catch (Exception error)
            {
                Debug.LogError("[JOURNEY FLOW 5.2] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
