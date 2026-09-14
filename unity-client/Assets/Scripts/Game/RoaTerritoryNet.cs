using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Сетевые запросы Сердцевины: принадлежность к фракции (регистратор или
    /// столица фракции) и сервисы постоянной базы (медик). Сервер проверяет
    /// присутствие рядом с NPC, кулдауны и стоимость; клиент только передаёт
    /// намерение и применяет присланный снимок.
    /// </summary>
    public static class RoaTerritoryNet
    {
        public static bool RequestMembershipState(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, "territoryFactionAction", new Dictionary<string, object> { ["action"] = "state" }, completed);
        }

        public static bool JoinFaction(RoaSocketClient socket, string factionId, Action<JObject> completed)
        {
            return Send(socket, "territoryFactionAction", new Dictionary<string, object>
            {
                ["action"] = "join",
                ["factionId"] = factionId ?? string.Empty,
                ["requestId"] = NewRequestId("territory-join")
            }, completed);
        }

        public static bool LeaveFaction(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, "territoryFactionAction", new Dictionary<string, object>
            {
                ["action"] = "leave",
                ["requestId"] = NewRequestId("territory-leave")
            }, completed);
        }

        public static bool RequestTerritoryState(RoaSocketClient socket, Action<JObject> completed)
        {
            if (socket == null || socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;
            socket.EmitWithAck("requestTerritoryState", new Dictionary<string, object>(), ack => completed?.Invoke(ack));
            return true;
        }

        public static bool RequestMedicState(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, "baseServiceAction", new Dictionary<string, object>
            {
                ["service"] = "medic",
                ["action"] = "state"
            }, completed);
        }

        public static bool UseMedic(RoaSocketClient socket, string action, Action<JObject> completed)
        {
            return Send(socket, "baseServiceAction", new Dictionary<string, object>
            {
                ["service"] = "medic",
                ["action"] = action ?? "heal",
                ["requestId"] = NewRequestId("medic-" + (action ?? "heal"))
            }, completed);
        }

        private static bool Send(RoaSocketClient socket, string eventName, Dictionary<string, object> payload, Action<JObject> completed)
        {
            if (socket == null || socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;
            Action<JObject> onAck = ack =>
            {
                if (ack != null) socket.ApplyGameplayAck(ack);
                completed?.Invoke(ack);
            };
            if (eventName == "territoryFactionAction") socket.EmitWithAck("territoryFactionAction", payload, onAck);
            else socket.EmitWithAck("baseServiceAction", payload, onAck);
            return true;
        }

        private static string NewRequestId(string prefix)
        {
            return prefix + "-" + DateTime.UtcNow.Ticks.ToString("x") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        }
    }
}
