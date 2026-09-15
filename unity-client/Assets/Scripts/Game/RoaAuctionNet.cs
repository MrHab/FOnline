using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Аукцион на базе Сердцевины. Сервер проверяет членство, присутствие
    /// рядом с аукционером, категорию и срок лота, снимает предметы и марки;
    /// requestId делает ставку, выкуп и выставление безопасными при повторе.
    /// </summary>
    public static class RoaAuctionNet
    {
        public static bool RequestState(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object> { ["action"] = "state" }, completed);
        }

        /// <summary>
        /// Выставить лот: стартовая цена обязательна, цена выкупа нулём
        /// означает торги до конца срока, срок — один из предложенных сервером.
        /// </summary>
        public static bool ListItem(RoaSocketClient socket, string itemId, int qty, int startPrice, int buyoutPrice,
                                    int durationHours, string itemRuntimeId, Action<JObject> completed)
        {
            var payload = new Dictionary<string, object>
            {
                ["action"] = "list",
                ["itemId"] = itemId ?? string.Empty,
                ["qty"] = Math.Max(1, qty),
                ["startPrice"] = Math.Max(1, startPrice),
                ["buyoutPrice"] = Math.Max(0, buyoutPrice),
                ["durationHours"] = Math.Max(0, durationHours),
                ["requestId"] = NewRequestId("auction-list")
            };
            if (!string.IsNullOrEmpty(itemRuntimeId)) payload["itemRuntimeId"] = itemRuntimeId;
            return Send(socket, payload, completed);
        }

        /// <summary>Ставка: марки уходят сразу и возвращаются на полку, если её перебьют.</summary>
        public static bool Bid(RoaSocketClient socket, string listingId, int amount, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "bid",
                ["listingId"] = listingId ?? string.Empty,
                ["amount"] = Math.Max(1, amount),
                ["requestId"] = NewRequestId("auction-bid")
            }, completed);
        }

        public static bool Buyout(RoaSocketClient socket, string listingId, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "buyout",
                ["listingId"] = listingId ?? string.Empty,
                ["requestId"] = NewRequestId("auction-buyout")
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
