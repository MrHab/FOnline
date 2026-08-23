using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.Net.SocketIo
{
    /// <summary>
    /// Клиент Socket.IO поверх IRoaWebSocketTransport (ClientWebSocket на
    /// Standalone, .jslib-мост к браузерному WebSocket на WebGL).
    ///
    /// Реализует Engine.IO v4 + Socket.IO v5 — именно этот протокол отдаёт
    /// socket.io@4.7.5, зафиксированный в package.json сервера.
    ///
    /// Класс намеренно не зависит от UnityEngine: на Standalone он работает в
    /// фоновых потоках, на WebGL — на главном; весь Unity-специфичный маршалинг
    /// живёт выше, в RoaSocketClient.
    ///
    /// Поддерживается только пространство имён по умолчанию ("/") и только
    /// текстовые пакеты — сервер бинарных вложений не шлёт.
    /// </summary>
    public sealed class RoaSocketIoConnection : IDisposable
    {
        // Engine.IO packet types — первый символ кадра.
        private const char EioOpen = '0';
        private const char EioClose = '1';
        private const char EioPing = '2';
        private const char EioPong = '3';
        private const char EioMessage = '4';

        // Socket.IO packet types — второй символ кадра (внутри EioMessage).
        private const char SioConnect = '0';
        private const char SioDisconnect = '1';
        private const char SioEvent = '2';
        private const char SioAck = '3';
        private const char SioConnectError = '4';
        private const char SioBinaryEvent = '5';
        private const char SioBinaryAck = '6';

        private readonly Uri _handshakeUri;
        private readonly object _auth;
        private readonly JsonSerializerSettings _jsonSettings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore
        };

        private IRoaWebSocketTransport _transport;
        private CancellationTokenSource _cancellation;

        // Отправка из нескольких потоков должна быть сериализована:
        // ClientWebSocket.SendAsync не допускает параллельных вызовов.
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);

        private readonly ConcurrentDictionary<string, Action<JArray>> _handlers =
            new ConcurrentDictionary<string, Action<JArray>>();

        private readonly ConcurrentDictionary<int, Action<JArray>> _pendingAcks =
            new ConcurrentDictionary<int, Action<JArray>>();

        private int _nextAckId;

        public string Sid { get; private set; } = string.Empty;
        public bool IsConnected { get; private set; }

        /// <summary>Socket.IO CONNECT подтверждён — можно слать события.</summary>
        public event Action OnConnected;

        /// <summary>Соединение закрылось. Аргумент — человекочитаемая причина.</summary>
        public event Action<string> OnDisconnected;

        /// <summary>Сервер отклонил подключение пакетом CONNECT_ERROR.</summary>
        public event Action<string> OnConnectError;

        /// <summary>Сбой протокола или транспорта. Соединение при этом закрывается.</summary>
        public event Action<Exception> OnError;

        /// <param name="baseUrl">Origin сервера, например http://127.0.0.1:3000</param>
        /// <param name="auth">Объект, уходящий в CONNECT — сервер читает его как socket.handshake.auth</param>
        public RoaSocketIoConnection(string baseUrl, object auth)
        {
            if (string.IsNullOrEmpty(baseUrl)) throw new ArgumentNullException(nameof(baseUrl));

            var origin = new Uri(baseUrl);
            string scheme = origin.Scheme == "https" ? "wss" : "ws";

            // Транспорт сразу websocket: long-polling для игрового hot-path не нужен,
            // поэтому фазы upgrade нет и апгрейд-пакеты не ожидаются.
            _handshakeUri = new Uri($"{scheme}://{origin.Authority}/socket.io/?EIO=4&transport=websocket");
            _auth = auth;
        }

        public void On(string eventName, Action<JArray> handler)
        {
            if (string.IsNullOrEmpty(eventName) || handler == null) return;
            _handlers[eventName] = handler;
        }

        public async Task ConnectAsync(CancellationToken externalToken = default)
        {
            if (_transport != null) throw new InvalidOperationException("Соединение уже открыто.");

            _cancellation = CancellationTokenSource.CreateLinkedTokenSource(externalToken);
            _transport = RoaWebSocketTransportFactory.Create();
            _transport.OnMessage += HandleFrame;
            _transport.OnClosed += Shutdown;
            _transport.OnError += error => OnError?.Invoke(error);

            await _transport.ConnectAsync(_handshakeUri, _cancellation.Token).ConfigureAwait(false);
        }

        /// <summary>Отправить событие без подтверждения.</summary>
        public Task EmitAsync(string eventName, object payload)
        {
            return EmitInternalAsync(eventName, payload, null);
        }

        /// <summary>
        /// Отправить событие с ack-колбэком. Колбэк вызывается в фоновом потоке —
        /// вызывающая сторона отвечает за маршалинг.
        /// Таймаут здесь не встроен намеренно: разные запросы протокола ждут по-разному
        /// (join — 5000 мс), и решение принимает игровой слой.
        /// </summary>
        public Task EmitAsync(string eventName, object payload, Action<JArray> ack)
        {
            return EmitInternalAsync(eventName, payload, ack);
        }

        private Task EmitInternalAsync(string eventName, object payload, Action<JArray> ack)
        {
            if (!IsConnected) throw new InvalidOperationException("Соединение не установлено.");

            var frame = new StringBuilder();
            frame.Append(EioMessage).Append(SioEvent);

            if (ack != null)
            {
                int ackId = Interlocked.Increment(ref _nextAckId);
                _pendingAcks[ackId] = ack;
                frame.Append(ackId);
            }

            // Payload Socket.IO — всегда массив: [имя события, аргумент...].
            var args = new JArray { eventName };
            if (payload != null) args.Add(JToken.FromObject(payload, JsonSerializer.Create(_jsonSettings)));

            frame.Append(args.ToString(Formatting.None));

            return SendRawAsync(frame.ToString());
        }

        private async Task SendRawAsync(string frame)
        {
            await _sendLock.WaitAsync().ConfigureAwait(false);
            try
            {
                if (_transport == null || !_transport.IsOpen) return;
                await _transport.SendAsync(frame, _cancellation.Token).ConfigureAwait(false);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        private void HandleFrame(string frame)
        {
            if (string.IsNullOrEmpty(frame)) return;

            switch (frame[0])
            {
                case EioOpen:
                    HandleEngineOpen(frame.Substring(1));
                    break;

                case EioPing:
                    // EIO v4: пинги инициирует сервер, клиент обязан ответить сразу,
                    // иначе сервер разорвёт соединение по pingTimeout.
                    _ = SendRawAsync(EioPong.ToString());
                    break;

                case EioPong:
                    break;

                case EioClose:
                    Shutdown("сервер прислал close");
                    break;

                case EioMessage:
                    HandleSocketIoPacket(frame.Substring(1));
                    break;
            }
        }

        private void HandleEngineOpen(string json)
        {
            try
            {
                JObject open = JObject.Parse(json);
                Sid = open["sid"]?.ToString() ?? string.Empty;
            }
            catch (JsonException error)
            {
                OnError?.Invoke(error);
                return;
            }

            // Сразу за Engine.IO open клиент должен прислать Socket.IO CONNECT.
            // Полезная нагрузка становится socket.handshake.auth на сервере.
            string payload = _auth != null
                ? JsonConvert.SerializeObject(_auth, _jsonSettings)
                : string.Empty;

            _ = SendRawAsync($"{EioMessage}{SioConnect}{payload}");
        }

        private void HandleSocketIoPacket(string packet)
        {
            if (string.IsNullOrEmpty(packet)) return;

            char type = packet[0];
            string body = packet.Substring(1);

            switch (type)
            {
                case SioConnect:
                    IsConnected = true;
                    OnConnected?.Invoke();
                    break;

                case SioConnectError:
                    OnConnectError?.Invoke(ExtractErrorMessage(body));
                    break;

                case SioDisconnect:
                    Shutdown("сервер отключил сокет");
                    break;

                case SioEvent:
                    DispatchEvent(body);
                    break;

                case SioAck:
                    DispatchAck(body);
                    break;

                case SioBinaryEvent:
                case SioBinaryAck:
                    // Протокол проекта бинарных вложений не использует. Молча
                    // проглотить такой пакет — значит потерять данные незаметно.
                    OnError?.Invoke(new NotSupportedException(
                        "Получен бинарный Socket.IO пакет, который клиент не разбирает."));
                    break;
            }
        }

        private static string ExtractErrorMessage(string body)
        {
            try
            {
                JToken parsed = JToken.Parse(body);
                return parsed["message"]?.ToString() ?? body;
            }
            catch (JsonException)
            {
                return body;
            }
        }

        private void DispatchEvent(string body)
        {
            // Формат: [ackId]["имя",аргумент...]. Числовой префикс до '[' — id подтверждения,
            // которое сервер ждёт от нас. Сервер в этом протоколе ack не запрашивает,
            // поэтому префикс только пропускается.
            int arrayStart = body.IndexOf('[');
            if (arrayStart < 0) return;

            JArray args;
            try
            {
                args = JArray.Parse(body.Substring(arrayStart));
            }
            catch (JsonException error)
            {
                OnError?.Invoke(error);
                return;
            }

            if (args.Count == 0) return;

            string eventName = args[0]?.ToString() ?? string.Empty;
            if (!_handlers.TryGetValue(eventName, out Action<JArray> handler)) return;

            var payload = new JArray();
            for (int i = 1; i < args.Count; i++) payload.Add(args[i]);

            handler(payload);
        }

        private void DispatchAck(string body)
        {
            int arrayStart = body.IndexOf('[');
            if (arrayStart <= 0) return;

            if (!int.TryParse(body.Substring(0, arrayStart), out int ackId)) return;
            if (!_pendingAcks.TryRemove(ackId, out Action<JArray> callback)) return;

            try
            {
                callback(JArray.Parse(body.Substring(arrayStart)));
            }
            catch (JsonException error)
            {
                OnError?.Invoke(error);
            }
        }

        private void Shutdown(string reason)
        {
            if (!IsConnected && _transport == null) return;

            IsConnected = false;

            // Ожидающие ack никогда не придут — освобождаем, чтобы игровой слой
            // не завис в состоянии «жду ответа».
            _pendingAcks.Clear();

            OnDisconnected?.Invoke(reason);
        }

        public void Dispose()
        {
            try
            {
                _cancellation?.Cancel();
            }
            catch (Exception)
            {
            }
            finally
            {
                IsConnected = false;
                _transport?.Dispose();
                _transport = null;
                _cancellation?.Dispose();
                _cancellation = null;
                _sendLock.Dispose();
            }
        }
    }
}
