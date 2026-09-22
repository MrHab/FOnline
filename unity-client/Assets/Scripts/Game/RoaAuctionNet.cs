using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Рынок столицы у аукционера: книга ордеров на продажу и на выкуп.
    /// Сервер проверяет присутствие рядом с аукционером, категорию,
    /// срок и цену, снимает предметы и марки; requestId делает ордер, покупку и
    /// продажу безопасными при повторе.
    /// </summary>
    public static class RoaAuctionNet
    {
        public static bool RequestState(RoaSocketClient socket, Action<JObject> completed)
        {
            return RequestState(socket, string.Empty, completed);
        }

        public static bool RequestState(RoaSocketClient socket, string itemId, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object> { ["action"] = "state", ["itemId"] = itemId }, completed);
        }

        public static bool UpdateOrder(RoaSocketClient socket, string orderId, int qty, int price,
                                       int durationHours, Action<JObject> completed, int expectedPrice = 0, int expectedQty = 0)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "update", ["orderId"] = orderId, ["qty"] = qty,
                ["price"] = price, ["durationHours"] = durationHours,
                ["expectedPrice"] = expectedPrice, ["expectedQty"] = expectedQty,
                ["requestId"] = NewRequestId("market-update")
            }, completed);
        }

        /// <summary>
        /// Ордер на продажу: цена за штуку и срок из предложенных сервером.
        /// Встречные ордера на выкуп исполняются сразу, остаток встаёт в книгу.
        /// </summary>
        public static bool SellOrder(RoaSocketClient socket, string itemId, int qty, int price,
                                     int durationHours, string itemRuntimeId, Action<JObject> completed)
        {
            var payload = new Dictionary<string, object>
            {
                ["action"] = "sell",
                ["itemId"] = itemId ?? string.Empty,
                ["qty"] = Math.Max(1, qty),
                ["price"] = Math.Max(1, price),
                ["durationHours"] = Math.Max(0, durationHours),
                ["requestId"] = NewRequestId("market-sell")
            };
            if (!string.IsNullOrEmpty(itemRuntimeId)) payload["itemRuntimeId"] = itemRuntimeId;
            return Send(socket, payload, completed);
        }

        /// <summary>
        /// Ордер на выкуп: марки замораживаются до исполнения, отмены или срока.
        /// Ставится только на предметы без износа и собственных свойств.
        /// </summary>
        public static bool BuyOrder(RoaSocketClient socket, string itemId, int qty, int price,
                                    int durationHours, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "buy",
                ["itemId"] = itemId ?? string.Empty,
                ["qty"] = Math.Max(1, qty),
                ["price"] = Math.Max(1, price),
                ["durationHours"] = Math.Max(0, durationHours),
                ["requestId"] = NewRequestId("market-buy")
            }, completed);
        }

        /// <summary>Купить сейчас с конкретного ордера на продажу.</summary>
        public static bool BuyNow(RoaSocketClient socket, string orderId, int qty, Action<JObject> completed, int expectedPrice = 0)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "buyNow",
                ["orderId"] = orderId ?? string.Empty,
                ["qty"] = Math.Max(1, qty),
                ["requestId"] = NewRequestId("market-buynow"),
                ["expectedPrice"] = expectedPrice
            }, completed);
        }

        /// <summary>Продать сейчас в конкретный ордер на выкуп.</summary>
        public static bool SellNow(RoaSocketClient socket, string orderId, int qty, string itemRuntimeId, Action<JObject> completed, int expectedPrice = 0)
        {
            var payload = new Dictionary<string, object>
            {
                ["action"] = "sellNow",
                ["orderId"] = orderId ?? string.Empty,
                ["qty"] = Math.Max(1, qty),
                ["requestId"] = NewRequestId("market-sellnow"),
                ["expectedPrice"] = expectedPrice
            };
            if (!string.IsNullOrEmpty(itemRuntimeId)) payload["itemRuntimeId"] = itemRuntimeId;
            return Send(socket, payload, completed);
        }

        public static bool Cancel(RoaSocketClient socket, string orderId, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "cancel",
                ["orderId"] = orderId ?? string.Empty,
                ["requestId"] = NewRequestId("market-cancel")
            }, completed);
        }

        public static bool Claim(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "claim",
                ["requestId"] = NewRequestId("market-claim")
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
