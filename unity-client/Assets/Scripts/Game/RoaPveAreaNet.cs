using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Сетевые запросы постоянных PvE-областей: снимок личной встречи и
    /// «Искать следы». Сервер сам решает, появится ли группа, и присылает
    /// pveAreaState всей комнате.
    /// </summary>
    public static class RoaPveAreaNet
    {
        public static bool RequestState(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, "state", completed);
        }

        public static bool SearchTracks(RoaSocketClient socket, Action<JObject> completed)
        {
            return Send(socket, "searchTracks", completed);
        }

        private static bool Send(RoaSocketClient socket, string action, Action<JObject> completed)
        {
            if (socket == null || socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;
            socket.EmitWithAck("pveAreaAction", new Dictionary<string, object> { ["action"] = action }, ack => completed?.Invoke(ack));
            return true;
        }
    }
}
