#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
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
                JObject disconnected = RoaSocketClient.AckFailure("changeLocation", false, true);
                Require(timeout["ok"]?.Value<bool>() == false
                    && timeout["timeout"]?.Value<bool>() == true
                    && timeout["eventName"]?.ToString() == "changeLocation"
                    && disconnected["disconnected"]?.Value<bool>() == true,
                    "потерянный ACK не превращается в понятный локальный отказ");

                Debug.Log("[JOURNEY FLOW 5.2] готово: ACK завершается всегда, потеря связи даёт понятный локальный отказ.");
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
