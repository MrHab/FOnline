using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Синь на счёте аккаунта (экономика v3): снимок счёта, покупка премиума и
    /// обменник синь↔марки у аукционера столицы. Сервер держит счёт, книгу
    /// обменника и сбор за ордер; requestId делает каждое действие безопасным
    /// при повторе.
    /// </summary>
    public static class RoaAccountSinNet
    {
        public static bool RequestState(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object> { ["action"] = "state" }, completed);
        }

        public static bool BuyPremium(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "buyPremium",
                ["requestId"] = NewRequestId("sin-premium")
            }, completed);
        }

        /// <summary>Ордер обменника: продать синь за марки или выкупить синь.</summary>
        public static bool PlaceOrder(RoaSocketClient socket, bool sell, int qty, int price, int durationHours,
                                      Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = sell ? "sell" : "buy",
                ["qty"] = Math.Max(1, qty),
                ["price"] = Math.Max(1, price),
                ["durationHours"] = Math.Max(0, durationHours),
                ["requestId"] = NewRequestId(sell ? "sin-sell" : "sin-buy")
            }, completed);
        }

        /// <summary>Исполнить чужой ордер: купить его синь или продать ему свою.</summary>
        public static bool TakeOrder(RoaSocketClient socket, string orderId, bool buyFromSeller, int qty,
                                     Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = buyFromSeller ? "buyNow" : "sellNow",
                ["orderId"] = orderId ?? string.Empty,
                ["qty"] = Math.Max(1, qty),
                ["requestId"] = NewRequestId("sin-take")
            }, completed);
        }

        public static bool Cancel(RoaSocketClient socket, string orderId, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "cancel",
                ["orderId"] = orderId ?? string.Empty,
                ["requestId"] = NewRequestId("sin-cancel")
            }, completed);
        }

        public static bool Claim(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, new Dictionary<string, object>
            {
                ["action"] = "claim",
                ["requestId"] = NewRequestId("sin-claim")
            }, completed);
        }

        private static bool Send(RoaSocketClient socket, Dictionary<string, object> payload, Action<JObject> completed)
        {
            if (socket == null || socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;
            socket.EmitWithAck("accountSinAction", payload, ack =>
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
