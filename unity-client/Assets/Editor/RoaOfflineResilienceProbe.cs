using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Проверяет паузы heartbeat и защиту журнала во время офлайна.</summary>
    public static class RoaOfflineResilienceProbe
    {
        [MenuItem("Realm of Ashes/Проверить поведение без сервера")]
        public static void Run()
        {
            Require(Mathf.Approximately(RoaGameBootstrap.AuthHeartbeatDelay(true), 10f),
                "успешный heartbeat потерял штатный интервал");
            Require(Mathf.Approximately(RoaGameBootstrap.AuthHeartbeatDelay(false), 60f),
                "ошибка heartbeat не включает минутную паузу");

            Require(!RoaGameBootstrap.ShouldAttemptAuthHeartbeat(
                    true, RoaSocketClient.ConnectionPhase.Disconnected),
                "игровая сессия продолжает heartbeat без сокета");
            Require(!RoaGameBootstrap.ShouldAttemptAuthHeartbeat(
                    true, RoaSocketClient.ConnectionPhase.Connecting),
                "heartbeat конкурирует с переподключением сокета");
            Require(RoaGameBootstrap.ShouldAttemptAuthHeartbeat(
                    true, RoaSocketClient.ConnectionPhase.Joined),
                "heartbeat не возобновляется после успешного join");
            Require(RoaGameBootstrap.ShouldAttemptAuthHeartbeat(
                    false, RoaSocketClient.ConnectionPhase.Disconnected),
                "экран аккаунта потерял автономное продление сессии");

            Require(RoaSocketClient.ShouldReportConnectFailure(false),
                "первое предупреждение офлайн-эпизода подавлено");
            Require(!RoaSocketClient.ShouldReportConnectFailure(true),
                "повторное предупреждение офлайн-эпизода не подавлено");

            Debug.Log("[OFFLINE RESILIENCE] готово: heartbeat 10/60 с, "
                + "игровой офлайн подавлен, предупреждение одно до успешного join");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new System.Exception("[OFFLINE RESILIENCE] " + message);
        }

        public static void RunBatch()
        {
            Run();
        }
    }
}
