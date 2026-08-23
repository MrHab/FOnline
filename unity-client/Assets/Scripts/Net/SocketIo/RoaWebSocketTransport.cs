using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace RealmOfAshes.Net.SocketIo
{
    /// <summary>
    /// Сырой текстовый WebSocket под Socket.IO-клиентом. Две реализации:
    /// System.Net.WebSockets для Windows/Standalone и .jslib-мост к браузерному
    /// WebSocket для WebGL (там нет ни сокетов .NET, ни фоновых потоков).
    /// События могут приходить из фонового потока (native) или с главного (WebGL);
    /// маршалингом занимается RoaSocketClient.
    /// </summary>
    public interface IRoaWebSocketTransport : IDisposable
    {
        bool IsOpen { get; }
        event Action<string> OnMessage;
        event Action<string> OnClosed;
        event Action<Exception> OnError;
        Task ConnectAsync(Uri uri, CancellationToken token);
        Task SendAsync(string text, CancellationToken token);
    }

    public static class RoaWebSocketTransportFactory
    {
        public static IRoaWebSocketTransport Create()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return new RoaWebGlWebSocket();
#else
            return new RoaNativeWebSocket();
#endif
        }
    }

    /// <summary>ClientWebSocket с фоновым циклом приёма (как было до выделения транспорта).</summary>
    public sealed class RoaNativeWebSocket : IRoaWebSocketTransport
    {
        private const int ReceiveBufferSize = 16 * 1024;
        private ClientWebSocket _socket;
        private CancellationTokenSource _cancellation;

        public bool IsOpen { get { return _socket != null && _socket.State == WebSocketState.Open; } }
        public event Action<string> OnMessage;
        public event Action<string> OnClosed;
        public event Action<Exception> OnError;

        public async Task ConnectAsync(Uri uri, CancellationToken token)
        {
            if (_socket != null) throw new InvalidOperationException("Соединение уже открыто.");
            _cancellation = CancellationTokenSource.CreateLinkedTokenSource(token);
            _socket = new ClientWebSocket();
            await _socket.ConnectAsync(uri, _cancellation.Token).ConfigureAwait(false);
            _ = Task.Run(() => ReceiveLoopAsync(_cancellation.Token));
        }

        public async Task SendAsync(string text, CancellationToken token)
        {
            if (!IsOpen) return;
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token).ConfigureAwait(false);
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            var buffer = new byte[ReceiveBufferSize];
            var message = new StringBuilder();
            try
            {
                while (!token.IsCancellationRequested && _socket.State == WebSocketState.Open)
                {
                    WebSocketReceiveResult result;
                    message.Clear();
                    do
                    {
                        result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), token).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            OnClosed?.Invoke("сервер закрыл соединение: " + result.CloseStatusDescription);
                            return;
                        }
                        message.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    }
                    while (!result.EndOfMessage);
                    OnMessage?.Invoke(message.ToString());
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception error)
            {
                OnError?.Invoke(error);
                OnClosed?.Invoke("ошибка транспорта: " + error.Message);
            }
        }

        public void Dispose()
        {
            try
            {
                _cancellation?.Cancel();
                if (_socket?.State == WebSocketState.Open)
                    _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "client shutdown", CancellationToken.None).Wait(TimeSpan.FromSeconds(1));
            }
            catch (Exception)
            {
            }
            finally
            {
                _socket?.Dispose();
                _socket = null;
                _cancellation?.Dispose();
                _cancellation = null;
            }
        }
    }

#if UNITY_WEBGL && !UNITY_EDITOR
    /// <summary>
    /// Браузерный WebSocket через Assets/Plugins/WebGL/RoaWebSocket.jslib.
    /// Колбэки приходят на главном потоке из JS; соединения различаются по id.
    /// </summary>
    public sealed class RoaWebGlWebSocket : IRoaWebSocketTransport
    {
        private delegate void OpenCallback(int id);
        private delegate void MessageCallback(int id, IntPtr text);
        private delegate void CloseCallback(int id, int code, IntPtr reason);
        private delegate void ErrorCallback(int id, IntPtr message);

        [DllImport("__Internal")] private static extern void RoaWs_Init(OpenCallback onOpen, MessageCallback onMessage, CloseCallback onClose, ErrorCallback onError);
        [DllImport("__Internal")] private static extern int RoaWs_Connect(string url);
        [DllImport("__Internal")] private static extern void RoaWs_Send(int id, string text);
        [DllImport("__Internal")] private static extern void RoaWs_Close(int id);
        [DllImport("__Internal")] private static extern int RoaWs_State(int id);

        private static bool _initialized;
        private static readonly Dictionary<int, RoaWebGlWebSocket> Sockets = new Dictionary<int, RoaWebGlWebSocket>();

        private int _id = -1;
        private TaskCompletionSource<bool> _connectTcs;

        public bool IsOpen { get { return _id >= 0 && RoaWs_State(_id) == 1; } }
        public event Action<string> OnMessage;
        public event Action<string> OnClosed;
        public event Action<Exception> OnError;

        public Task ConnectAsync(Uri uri, CancellationToken token)
        {
            if (_id >= 0) throw new InvalidOperationException("Соединение уже открыто.");
            if (!_initialized)
            {
                RoaWs_Init(HandleOpen, HandleMessage, HandleClose, HandleError);
                _initialized = true;
            }
            _connectTcs = new TaskCompletionSource<bool>();
            _id = RoaWs_Connect(uri.ToString());
            if (_id < 0) throw new InvalidOperationException("Браузер не создал WebSocket.");
            Sockets[_id] = this;
            token.Register(() => _connectTcs.TrySetCanceled());
            return _connectTcs.Task;
        }

        public Task SendAsync(string text, CancellationToken token)
        {
            if (IsOpen) RoaWs_Send(_id, text);
            return Task.CompletedTask;
        }

        public void Dispose()
        {
            if (_id < 0) return;
            Sockets.Remove(_id);
            RoaWs_Close(_id);
            _id = -1;
        }

        [AOT.MonoPInvokeCallback(typeof(OpenCallback))]
        private static void HandleOpen(int id)
        {
            if (Sockets.TryGetValue(id, out RoaWebGlWebSocket socket)) socket._connectTcs?.TrySetResult(true);
        }

        [AOT.MonoPInvokeCallback(typeof(MessageCallback))]
        private static void HandleMessage(int id, IntPtr text)
        {
            if (Sockets.TryGetValue(id, out RoaWebGlWebSocket socket)) socket.OnMessage?.Invoke(Marshal.PtrToStringUTF8(text));
        }

        [AOT.MonoPInvokeCallback(typeof(CloseCallback))]
        private static void HandleClose(int id, int code, IntPtr reason)
        {
            if (!Sockets.TryGetValue(id, out RoaWebGlWebSocket socket)) return;
            string why = Marshal.PtrToStringUTF8(reason);
            socket._connectTcs?.TrySetException(new InvalidOperationException("WebSocket закрыт до открытия (" + code + ")"));
            socket.OnClosed?.Invoke("сервер закрыл соединение: " + code + (string.IsNullOrEmpty(why) ? string.Empty : " " + why));
        }

        [AOT.MonoPInvokeCallback(typeof(ErrorCallback))]
        private static void HandleError(int id, IntPtr message)
        {
            if (!Sockets.TryGetValue(id, out RoaWebGlWebSocket socket)) return;
            var error = new InvalidOperationException(Marshal.PtrToStringUTF8(message) ?? "WebSocket error");
            socket._connectTcs?.TrySetException(error);
            socket.OnError?.Invoke(error);
        }
    }
#endif
}
