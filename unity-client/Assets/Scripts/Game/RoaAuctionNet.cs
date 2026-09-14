using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Фракционный аукцион на базе Сердцевины. Сервер проверяет членство,
    /// присутствие рядом с аукционером, снимает предметы и марки; requestId
    /// делает покупку и выставление лота безопасными при повторе.
    /// </summary>
    public static class RoaAuctionNet
    {
        public static bool RequestState(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object> { ["action"] = "state" }, completed);
        }

        public static bool ListItem(RoaSocketClient socket, string itemId, int qty, int price, string itemRuntimeId, Action<JObject> completed)
        {
            var payload = new Dictionary<string, object>
            {
                ["action"] = "list",
                ["itemId"] = itemId ?? string.Empty,
                ["qty"] = Math.Max(1, qty),
                ["price"] = Math.Max(1, price),
                ["requestId"] = NewRequestId("auction-list")
            };
            if (!string.IsNullOrEmpty(itemRuntimeId)) payload["itemRuntimeId"] = itemRuntimeId;
            return Send(socket, payload, completed);
        }

        public static bool Buy(RoaSocketClient socket, string listingId, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "buy",
                ["listingId"] = listingId ?? string.Empty,
                ["requestId"] = NewRequestId("auction-buy")
            }, completed);
        }

        public static bool Cancel(RoaSocketClient socket, string listingId, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "cancel",
                ["listingId"] = listingId ?? string.Empty,
                ["requestId"] = NewRequestId("auction-cancel")
            }, completed);
        }

        public static bool Claim(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "claim",
                ["requestId"] = NewRequestId("auction-claim")
            }, completed);
        }

        private static bool Send(RoaSocketClient socket, Dictionary<string, object> payload, Action<JObject> completed)
        {
            if (socket == null || socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;
            socket.EmitWithAck("auctionAction", payload, ack =>
            {
                if (ack != null) socket.ApplyGameplayAck(ack);
                completed?.Invoke(ack);
            });
            return true;
        }

        private static string NewRequestId(string prefix)
        {
            return prefix + "-" + DateTime.UtcNow.Ticks.ToString("x") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        }
    }
}
