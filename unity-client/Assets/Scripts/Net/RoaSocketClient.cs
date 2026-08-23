using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net.SocketIo;
using UnityEngine;

namespace RealmOfAshes.Net
{
    /// <summary>
    /// Realtime-канал к авторитетному серверу.
    ///
    /// Транспорт (RoaSocketIoConnection) работает в фоновых потоках, а Unity API
    /// доступен только из главного. Поэтому всё, что приходит из сети, складывается
    /// в очередь и разбирается в Update() — трогать Transform прямо в обработчике нельзя.
    ///
    /// Сервер авторитетен во всём: клиент только предлагает своё состояние событием
    /// state и применяет то, что вернулось. Никакой локальный расчёт урона, AP или
    /// коллизий не является истиной.
    /// </summary>
    public sealed class RoaSocketClient : MonoBehaviour
    {
        /// <summary>Таймаут join. Значение из docs/wiki/SOCKET_EVENTS.md (v7.76.5): 5000 мс.</summary>
        public const float JoinTimeoutSeconds = 5f;

        /// <summary>Минимальный интервал между пакетами state: 50 мс = 20 Гц, как у web-клиента.</summary>
        public const float StateSendIntervalSeconds = 0.05f;

        public enum ConnectionPhase
        {
            Disconnected,
            Connecting,
            Connected,
            Joining,
            Joined,
            Rejected
        }

        public ConnectionPhase Phase { get; private set; } = ConnectionPhase.Disconnected;
        public string LastError { get; private set; } = string.Empty;
        public JoinAck Session { get; private set; }
        public float PingMs { get; private set; } = -1f;
        public int ReconnectAttempt { get { return _reconnectAttempt; } }

        // Игровые события, уже разложенные по главному потоку.
        public event Action<JoinAck> OnJoined;
        public event Action<string> OnRejected;
        public event Action<string> OnDisconnected;
        public event Action<PlayerMovement> OnRemotePlayerMoved;
        public event Action<PublicPlayer> OnPlayerJoined;
        public event Action<string> OnPlayerLeft;
        public event Action<JObject> OnAuthoritativeSelf;
        public event Action<EnemyFrameEvent> OnEnemyFrame;
        public event Action<JObject> OnEnemySnapshot;
        public event Action<JObject> OnEnemyActivityDelta;
        public event Action<JObject> OnWorldState;

        /// <summary>Полный снимок серверных контейнеров текущей комнаты.</summary>
        public event Action<JObject> OnWorldContainers;

        /// <summary>Точечное изменение одного серверного контейнера.</summary>
        public event Action<JObject> OnWorldContainerUpdated;

        /// <summary>Ассортимент/состояние NPC изменились после сделки или квеста.</summary>
        public event Action<JObject> OnEnemyTradeUpdated;

        /// <summary>Игрок спровоцировал мирную группу в случайной встрече.</summary>
        public event Action<JObject> OnEncounterFactionHostile;

        /// <summary>Рынок авторского торгового автомата изменился в текущей комнате.</summary>
        public event Action<JObject> OnTradeMachineMarketUpdated;

        /// <summary>Точечное серверное изменение ресурсного узла после добычи или респауна.</summary>
        public event Action<JObject> OnResourceUpdated;

        public event Action<JObject> OnGroundItemDropped;
        public event Action<JObject> OnGroundItemPicked;
        public event Action<JObject> OnEnemyMelee;
        public event Action<JObject> OnEnemyAttack;
        public event Action<JObject> OnEnemyAttackMiss;
        public event Action<JObject> OnEnemyKilled;
        public event Action<JObject> OnPlayerStatusEffect;

        /// <summary>Адресное предложение торговли, дружбы или вступления в клан.</summary>
        public event Action<JObject> OnSocialActionReceived;

        /// <summary>Друзья, заявки и клан изменились в постоянном серверном состоянии.</summary>
        public event Action<JObject> OnSocialStateUpdated;

        /// <summary>Канонический блок combat из ack атаки, перезарядки или отказа.</summary>
        public event Action<JObject> OnCombatState;

        /// <summary>Другой игрок перезарядился — визуал движения рук.</summary>
        public event Action<JObject> OnPlayerReloaded;

        /// <summary>Выстрел в комнате: вспышка и замах у стрелявшего.</summary>
        public event Action<JObject> OnShot;

        /// <summary>Ближняя атака игрока — визуал замаха.</summary>
        public event Action<JObject> OnMelee;

        /// <summary>
        /// Состав и статус живых игроков комнаты, раз в секунду. Включает и
        /// самого игрока, поэтому отсюда берутся собственные HP, AP и уровень:
        /// в authoritativePlayerState их нет (server.js:21996).
        /// </summary>
        public event Action<List<PublicPlayer>> OnRoomSnapshot;

        /// <summary>Авторитетный урон по игроку: HP, источник, эффекты.</summary>
        public event Action<JObject> OnPlayerDamaged;

        /// <summary>Авторитетный итог лечения любого игрока в комнате.</summary>
        public event Action<JObject> OnPlayerHealed;

        /// <summary>Другой игрок умер, сменил комнату или возродился в текущей.</summary>
        public event Action<JObject> OnPlayerRespawned;

        /// <summary>Сервер возродил локального игрока в поселении.</summary>
        public event Action<JObject> OnServerRespawn;

        /// <summary>Мировая симуляция адресно перенесла игрока в другую комнату.</summary>
        public event Action<JObject> OnServerWorldTransfer;

        /// <summary>
        /// Полный снимок предметов на земле. Сервер шлёт его не чаще 120 мс,
        /// но принудительно сразу после значимого действия, поэтому отдельные
        /// события появления и подбора клиенту не нужны.
        /// </summary>
        public event Action<JObject> OnGroundItems;

        // События сервер-авторитетного маршрута глобальной карты. Они нужны
        // не только лидеру: участники группы получают те же переходы без ack.
        public event Action<JObject> OnGlobalTravelStarted;
        public event Action<JObject> OnGlobalTravelEnteredWorld;
        public event Action<JObject> OnGlobalTravelCancelled;
        public event Action<JObject> OnGlobalTravelArrived;
        public event Action<JObject> OnGlobalTravelGroupReleased;
        public event Action<JObject> OnGlobalTravelEncounterDecision;

        private RoaSocketIoConnection _connection;
        private RoaAuthClient _auth;
        private string _characterId;
        private string _baseUrl;

        /// <summary>
        /// Адрес HTTP/Socket.IO-сервера без завершающего слеша. Клиентские системы
        /// используют тот же origin для загрузки статических GLB, что и браузер.
        /// </summary>
        public string ServerOrigin { get { return (_baseUrl ?? string.Empty).TrimEnd('/'); } }

        // Заполняется только при первом входе новым персонажем.
        private string _newCharacterName;
        private CharacterAppearance _newAppearance;
        private CharacterSpecial _newSpecial;
        private string[] _newTaggedSkills;
        private string[] _newTraits;

        private readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
        private readonly JsonSerializer _serializer = JsonSerializer.CreateDefault();

        private long _stateSeq;
        private float _stateCooldown;
        private bool _lastSentMoving;
        private bool _lastSentCrouching;

        // enemyFrame — volatile: пакеты обгоняют друг друга, устаревший seq надо отбросить.
        private long _lastEnemyFrameSeq;

        private float _joinDeadline;
        private bool _joinPending;
        private bool _reconnectScheduled;
        private float _reconnectAt;
        private int _reconnectAttempt;
        private bool _shuttingDown;

        private const float NetworkPingIntervalSeconds = 2f;
        private const float NetworkPingTimeoutSeconds = 3.5f;
        private float _nextNetworkPingAt;
        private float _networkPingDeadline;
        private float _networkPingStartedAt;
        private bool _networkPingPending;
        private int _networkPingRequestId;

        /// <summary>Войти существующим персонажем.</summary>
        public void Connect(string baseUrl, RoaAuthClient auth, string characterId)
        {
            ConnectInternal(baseUrl, auth, characterId);
        }

        /// <summary>Close a rejected/failed join so the character form can be corrected and submitted again.</summary>
        public void DisconnectForRetry()
        {
            _reconnectScheduled = false;
            _joinPending = false;
            ResetNetworkPing();
            Phase = ConnectionPhase.Disconnected;
            Session = null;
            RoaSocketIoConnection connection = _connection;
            _connection = null;
            connection?.Dispose();
            _newCharacterName = null;
            _newAppearance = null;
            _newSpecial = null;
            _newTaggedSkills = null;
            _newTraits = null;
        }

        /// <summary>
        /// Войти, создав персонажа на лету. Сервер валидирует внешность, навыки
        /// и перки в newServerCharacterSelectionError() (server.js:6939) и отклоняет
        /// весь join, если что-то не из разрешённого набора.
        /// </summary>
        public void ConnectWithNewCharacter(string baseUrl, RoaAuthClient auth, string characterId,
                                            string name, CharacterAppearance appearance,
                                            CharacterSpecial special, string[] taggedSkills, string[] traits)
        {
            _newCharacterName = name;
            _newAppearance = appearance;
            _newSpecial = special;
            _newTaggedSkills = taggedSkills;
            _newTraits = traits;

            ConnectInternal(baseUrl, auth, characterId);
        }

        private void ConnectInternal(string baseUrl, RoaAuthClient auth, string characterId)
        {
            if (Phase != ConnectionPhase.Disconnected)
            {
                Debug.LogWarning("[ROA] Connect вызван при активном соединении — игнорирую.");
                return;
            }

            _auth = auth;
            _characterId = characterId;
            _baseUrl = baseUrl;
            _shuttingDown = false;
            _reconnectAttempt = 0;
            _reconnectScheduled = false;
            LastError = string.Empty;

            BeginTransportConnection();
        }

        private void BeginTransportConnection()
        {
            if (_shuttingDown || _auth == null || string.IsNullOrEmpty(_baseUrl)) return;
            _reconnectScheduled = false;
            Phase = ConnectionPhase.Connecting;

            RoaSocketIoConnection previous = _connection;
            _connection = null;
            previous?.Dispose();

            // Уходит в socket.handshake.auth. Сервер читает отсюда clientInstanceId,
            // если он не пришёл в самом join (server.js:19118).
            var handshakeAuth = new
            {
                clientInstanceId = _auth.ClientInstanceId,
                deviceType = _auth.DeviceType,
                controlType = _auth.ControlType
            };

            var connection = new RoaSocketIoConnection(_baseUrl, handshakeAuth);
            _connection = connection;
            RegisterHandlers();

            connection.ConnectAsync().ContinueWith(task =>
            {
                if (!task.IsFaulted) return;

                string message = task.Exception?.GetBaseException().Message ?? "неизвестная ошибка";
                _mainThread.Enqueue(() =>
                {
                    if (_connection != connection || _shuttingDown) return;
                    Phase = ConnectionPhase.Disconnected;
                    LastError = "Не удалось подключиться: " + message;
                    Debug.LogError("[ROA] " + LastError);
                    ScheduleReconnect();
                });
            });
        }

        private void RegisterHandlers()
        {
            RoaSocketIoConnection registeredConnection = _connection;
            _connection.OnConnected += () => _mainThread.Enqueue(() =>
            {
                if (_connection != registeredConnection || _shuttingDown) return;
                Phase = ConnectionPhase.Connected;
                SendJoin();
            });

            _connection.OnDisconnected += reason => _mainThread.Enqueue(() =>
            {
                if (_connection != registeredConnection || _shuttingDown) return;
                bool rejected = Phase == ConnectionPhase.Rejected;
                // Игровой authority до нового успешного join считается потерянным.
                Phase = ConnectionPhase.Disconnected;
                Session = null;
                _joinPending = false;
                ResetNetworkPing();
                Debug.LogWarning("[ROA] Соединение потеряно: " + reason);
                OnDisconnected?.Invoke(reason);
                if (!rejected) ScheduleReconnect();
            });

            _connection.OnConnectError += message => _mainThread.Enqueue(() =>
            {
                if (_connection != registeredConnection || _shuttingDown) return;
                Phase = ConnectionPhase.Disconnected;
                LastError = "Ошибка подключения: " + message;
                OnDisconnected?.Invoke(message);
                ScheduleReconnect();
            });

            _connection.OnError += error => _mainThread.Enqueue(() => Debug.LogException(error));

            _connection.On("sessionRejected", args => _mainThread.Enqueue(() =>
            {
                var rejected = First<SessionRejected>(args);
                Phase = ConnectionPhase.Rejected;
                LastError = rejected?.Error ?? "Сессия отклонена сервером.";
                _joinPending = false;
                OnRejected?.Invoke(LastError);
            }));

            _connection.On("playerState", args => _mainThread.Enqueue(() =>
            {
                var evt = First<PlayerStateEvent>(args);
                if (evt?.Player == null || !IsForCurrentRoom(evt.RoomId)) return;
                OnRemotePlayerMoved?.Invoke(evt.Player);
            }));

            _connection.On("playerJoined", args => _mainThread.Enqueue(() =>
            {
                var player = First<PublicPlayer>(args);
                if (player != null) OnPlayerJoined?.Invoke(player);
            }));

            _connection.On("playerLeft", args => _mainThread.Enqueue(() =>
            {
                string id = First<JObject>(args)?["id"]?.ToString();
                if (!string.IsNullOrEmpty(id)) OnPlayerLeft?.Invoke(id);
            }));

            _connection.On("authoritativePlayerState", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                ApplyAuthoritativeSelf(payload);
            }));

            _connection.On("enemyFrame", args => _mainThread.Enqueue(() =>
            {
                var frame = First<EnemyFrameEvent>(args);
                if (frame == null || !IsForCurrentRoom(frame.RoomId)) return;

                // Volatile-кадр мог прийти после более свежего — молча отбрасываем.
                if (frame.Seq <= _lastEnemyFrameSeq) return;
                _lastEnemyFrameSeq = frame.Seq;
                OnEnemyFrame?.Invoke(frame);
            }));

            _connection.On("enemyActivityDelta", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnEnemyActivityDelta?.Invoke(payload);
            }));

            _connection.On("enemySnapshot", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null) return;

                // Полный снимок задаёт состав сущностей заново, поэтому счётчик
                // volatile-кадров сбрасывается вместе с ним.
                _lastEnemyFrameSeq = 0;
                OnEnemySnapshot?.Invoke(payload);
            }));

            _connection.On("worldState", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                // Broadcasts use { reason, state }, while join/request acknowledgements
                // contain the snapshot itself. Expose one shape to every Unity system.
                JObject state = payload?["state"] as JObject ?? payload;
                if (state != null && IsForCurrentRoom(state["roomId"]?.ToString()))
                    OnWorldState?.Invoke(state);
            }));

            _connection.On("worldContainersSnapshot", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnWorldContainers?.Invoke(payload);
            }));

            _connection.On("worldContainerUpdated", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnWorldContainerUpdated?.Invoke(payload);
            }));

            _connection.On("enemyTradeUpdated", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnEnemyTradeUpdated?.Invoke(payload);
            }));

            _connection.On("encounterFactionHostile", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnEncounterFactionHostile?.Invoke(payload);
            }));

            _connection.On("tradeMachineMarketUpdated", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnTradeMachineMarketUpdated?.Invoke(payload);
            }));

            _connection.On("resourceUpdated", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnResourceUpdated?.Invoke(payload);
            }));

            _connection.On("socialActionReceived", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnSocialActionReceived?.Invoke(payload);
            }));

            _connection.On("socialStateUpdated", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null) return;
                OnSocialStateUpdated?.Invoke(payload);
            }));

            _connection.On("playerReloaded", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnPlayerReloaded?.Invoke(payload);
            }));

            _connection.On("snapshot", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null) return;
                if (!IsForCurrentRoom(payload["roomId"]?.ToString())) return;

                var players = payload["players"]?.ToObject<List<PublicPlayer>>();
                if (players != null) OnRoomSnapshot?.Invoke(players);
            }));

            _connection.On("playerDamaged", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                string targetId = payload["playerId"]?.ToString() ?? payload["targetId"]?.ToString();
                if (string.IsNullOrEmpty(targetId) || targetId == Session?.Id) MergeLocalVitals(payload);
                OnPlayerDamaged?.Invoke(payload);
            }));

            _connection.On("playerHealed", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                string targetId = payload["targetId"]?.ToString() ?? payload["playerId"]?.ToString();
                if (string.IsNullOrEmpty(targetId) || targetId == Session?.Id) MergeLocalVitals(payload);
                OnPlayerHealed?.Invoke(payload);
            }));

            _connection.On("playerRespawned", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnPlayerRespawned?.Invoke(payload);
            }));

            _connection.On("serverRespawn", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || payload["ok"]?.ToObject<bool>() != true) return;
                ApplyServerRoomTransfer(payload);
                OnServerRespawn?.Invoke(payload);
            }));

            _connection.On("serverWorldTransfer", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || payload["ok"]?.ToObject<bool>() != true) return;
                ApplyServerRoomTransfer(payload);
                OnServerWorldTransfer?.Invoke(payload);
            }));

            _connection.On("groundItemsSnapshot", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnGroundItems?.Invoke(payload);
            }));

            _connection.On("groundItemDropped", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnGroundItemDropped?.Invoke(payload);
            }));

            _connection.On("groundItemPicked", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload == null || !IsForCurrentRoom(payload["roomId"]?.ToString())) return;
                OnGroundItemPicked?.Invoke(payload);
            }));

            _connection.On("shot", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnShot?.Invoke(payload);
            }));

            _connection.On("melee", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnMelee?.Invoke(payload);
            }));

            _connection.On("enemyMelee", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null && IsForCurrentLocation(payload["locationId"]?.ToString()))
                    OnEnemyMelee?.Invoke(payload);
            }));

            _connection.On("enemyAttackMiss", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null && IsForCurrentLocation(payload["locationId"]?.ToString()))
                    OnEnemyAttackMiss?.Invoke(payload);
            }));

            _connection.On("enemyAttack", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null && IsForCurrentLocation(payload["locationId"]?.ToString()))
                {
                    MergeLocalVitals(payload);
                    OnEnemyAttack?.Invoke(payload);
                }
            }));

            _connection.On("playerStatusEffect", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null)
                {
                    MergeLocalVitals(payload);
                    OnPlayerStatusEffect?.Invoke(payload);
                }
            }));

            _connection.On("enemyKilled", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnEnemyKilled?.Invoke(payload);
            }));

            _connection.On("globalTravelStarted", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnGlobalTravelStarted?.Invoke(payload);
            }));

            _connection.On("globalTravelEnteredWorld", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnGlobalTravelEnteredWorld?.Invoke(payload);
            }));

            _connection.On("globalTravelCancelled", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnGlobalTravelCancelled?.Invoke(payload);
            }));

            _connection.On("globalTravelArrived", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnGlobalTravelArrived?.Invoke(payload);
            }));

            _connection.On("globalTravelGroupReleased", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnGlobalTravelGroupReleased?.Invoke(payload);
            }));

            _connection.On("globalTravelEncounterDecision", args => _mainThread.Enqueue(() =>
            {
                var payload = First<JObject>(args);
                if (payload != null) OnGlobalTravelEncounterDecision?.Invoke(payload);
            }));
        }

        private T First<T>(JArray args) where T : class
        {
            if (args == null || args.Count == 0) return null;

            try
            {
                return args[0].ToObject<T>(_serializer);
            }
            catch (JsonException error)
            {
                Debug.LogWarning("[ROA] Не удалось разобрать пакет " + typeof(T).Name + ": " + error.Message);
                return null;
            }
        }

        /// <summary>
        /// Пакеты из чужой комнаты надо отбрасывать: во время перехода между локациями
        /// в полёте остаются сообщения предыдущей сцены.
        ///
        /// Отбрасывать можно только когда обе стороны знают свою комнату и они разные.
        /// Пустой roomId — законное состояние (игрок на глобальной карте), и трактовать
        /// его как «не совпало» нельзя: тогда фильтр режет вообще весь трафик.
        /// Та же логика в web-клиенте: public/js/game/05_multiplayer_core_state.js:390.
        /// </summary>
        private bool IsForCurrentRoom(string roomId)
        {
            if (string.IsNullOrEmpty(roomId)) return true;

            string mine = Session != null ? Session.RoomId : null;
            if (string.IsNullOrEmpty(mine)) return true;

            return roomId == mine;
        }

        private bool IsForCurrentLocation(string locationId)
        {
            if (string.IsNullOrEmpty(locationId)) return true;
            string mine = Session != null ? Session.LocationId : null;
            return string.IsNullOrEmpty(mine) || locationId == mine;
        }

        private void SendJoin()
        {
            RoaSocketIoConnection joinConnection = _connection;
            if (joinConnection == null) return;
            var request = new JoinRequest
            {
                Token = _auth.Token,
                DeviceId = _auth.DeviceId,
                ClientInstanceId = _auth.ClientInstanceId,
                DeviceType = _auth.DeviceType,
                ControlType = _auth.ControlType,
                CharacterId = _characterId,
                EnemyFrameVersion = 1,

                // Для существующего персонажа остаются null и не сериализуются.
                Name = _newCharacterName,
                Appearance = _newAppearance,
                Special = _newSpecial,
                TaggedSkills = _newTaggedSkills,
                Traits = _newTraits
            };

            Phase = ConnectionPhase.Joining;
            _joinPending = true;
            _joinDeadline = Time.realtimeSinceStartup + JoinTimeoutSeconds;

            joinConnection.EmitAsync("join", request, args => _mainThread.Enqueue(() =>
            {
                if (_connection != joinConnection || _shuttingDown) return;
                // Просроченный callback игнорируется — соединение уже ушло
                // в reconnect и ждёт нового ack.
                if (!_joinPending) return;
                _joinPending = false;

                var ack = First<JoinAck>(args);
                if (ack == null || !ack.Ok)
                {
                    _reconnectScheduled = false;
                    Phase = ConnectionPhase.Rejected;
                    LastError = ack?.Error ?? "Сервер отклонил вход в игру.";
                    OnRejected?.Invoke(LastError);
                    return;
                }

                Session = ack;
                Phase = ConnectionPhase.Joined;
                LastError = string.Empty;
                _lastEnemyFrameSeq = 0;
                _reconnectAttempt = 0;
                _reconnectScheduled = false;
                _nextNetworkPingAt = Time.realtimeSinceStartup + 0.25f;

                // Эти поля нужны только для первого создания. Повторный join после
                // обрыва обязан входить в уже существующего персонажа.
                _newCharacterName = null;
                _newAppearance = null;
                _newSpecial = null;
                _newTaggedSkills = null;
                _newTraits = null;
                OnJoined?.Invoke(ack);
            }));
        }

        private void ScheduleReconnect()
        {
            if (_shuttingDown || _reconnectScheduled || _auth == null) return;
            _reconnectAttempt++;
            float delay = Mathf.Min(15f, Mathf.Pow(2f, Mathf.Min(4, _reconnectAttempt - 1)));
            _reconnectAt = Time.realtimeSinceStartup + delay;
            _reconnectScheduled = true;
            LastError = "Повторное подключение через " + delay.ToString("0") + " с.";
        }

        private void ResetNetworkPing()
        {
            PingMs = -1f;
            _networkPingPending = false;
            _networkPingRequestId++;
            _nextNetworkPingAt = 0f;
        }

        private void UpdateNetworkPing()
        {
            float now = Time.realtimeSinceStartup;
            if (_networkPingPending)
            {
                if (now <= _networkPingDeadline) return;
                _networkPingPending = false;
                PingMs = -1f;
                _nextNetworkPingAt = now + NetworkPingIntervalSeconds;
                return;
            }
            if (now < _nextNetworkPingAt) return;

            _networkPingPending = true;
            _networkPingStartedAt = now;
            _networkPingDeadline = now + NetworkPingTimeoutSeconds;
            int requestId = ++_networkPingRequestId;
            EmitWithAck("networkPing", new Dictionary<string, object>
            {
                ["clientTime"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            }, ack =>
            {
                if (!_networkPingPending || requestId != _networkPingRequestId) return;
                _networkPingPending = false;
                float sample = Mathf.Max(0f, (Time.realtimeSinceStartup - _networkPingStartedAt) * 1000f);
                PingMs = PingMs < 0f ? sample : Mathf.Lerp(PingMs, sample, 0.28f);
                _nextNetworkPingAt = Time.realtimeSinceStartup + NetworkPingIntervalSeconds;
            });
        }

        /// <summary>
        /// Отправить произвольное событие без подтверждения.
        /// Для визуальных реле вроде shoot и melee.
        /// </summary>
        public void Emit(string eventName, object payload)
        {
            if (Phase != ConnectionPhase.Joined || _connection == null) return;
            _connection.EmitAsync(eventName, payload);
        }

        /// <summary>
        /// Отправить событие и получить авторитетный ответ. Колбэк уже разложен
        /// в главный поток, поэтому из него можно трогать сцену.
        /// </summary>
        public void EmitWithAck(string eventName, object payload, Action<JObject> onAck)
        {
            if (Phase != ConnectionPhase.Joined || _connection == null) return;

            _connection.EmitAsync(eventName, payload, args => _mainThread.Enqueue(() =>
            {
                var result = First<JObject>(args);
                if (onAck != null) onAck(result);
            }));
        }

        /// <summary>
        /// Addressed recovery for a missing room baseline. The client sends only a
        /// short reason; map, resources and other authority always flow server → client.
        /// Mirrors requestWorldStateFromServer() in the browser client.
        /// </summary>
        public void RequestWorldState(string reason, Action<JObject> onDone)
        {
            if (Phase != ConnectionPhase.Joined || _connection == null)
            {
                onDone?.Invoke(null);
                return;
            }

            string requestedRoomId = Session?.RoomId ?? string.Empty;
            EmitWithAck("requestWorldState", new Dictionary<string, object>
            {
                ["reason"] = (reason ?? "resync").Substring(0, Mathf.Min(32, (reason ?? "resync").Length))
            }, ack =>
            {
                JObject state = ack?["state"] as JObject;
                if (ack?["ok"]?.ToObject<bool>() != true || state == null
                    || (!string.IsNullOrEmpty(requestedRoomId)
                        && !string.Equals(requestedRoomId, Session?.RoomId ?? string.Empty, StringComparison.Ordinal))
                    || !IsForCurrentRoom(state["roomId"]?.ToString()))
                {
                    onDone?.Invoke(null);
                    return;
                }

                if (Session != null) Session.WorldState = state;
                OnWorldState?.Invoke(state);
                onDone?.Invoke(state);
            });
        }

        /// <summary>
        /// Применить канонический <c>self</c> из ack игрового действия. Все окна
        /// получают один и тот же снимок через OnAuthoritativeSelf, а Session
        /// остаётся пригодной для следующего запроса и перехода между комнатами.
        /// </summary>
        public void ApplyAuthoritativeSelf(JObject self)
        {
            if (self == null) return;
            if (Session != null) Session.Self = self;
            OnAuthoritativeSelf?.Invoke(self);
        }

        private void MergeLocalVitals(JObject payload)
        {
            if (payload == null || Session?.Self == null) return;
            JObject merged = (JObject)Session.Self.DeepClone();
            bool changed = false;
            foreach (string field in new[] { "hp", "maxHp" })
            {
                JToken value = payload[field];
                if (value == null) continue;
                merged[field] = value.DeepClone();
                changed = true;
            }

            if (payload["injuries"] is JObject injuries)
            {
                merged["injuries"] = injuries.DeepClone();
                changed = true;
            }

            if (!changed) return;
            ApplyAuthoritativeSelf(merged);
        }

        /// <summary>
        /// Разобрать общий ack игрового действия: self и combat публикуются
        /// независимо, потому что authoritative self намеренно не содержит магазин.
        /// </summary>
        public void ApplyGameplayAck(JObject ack)
        {
            if (ack == null) return;
            ApplyAuthoritativeSelf(ack["self"] as JObject);

            JObject combat = ack["combat"] as JObject;
            if (combat == null) return;
            if (Session != null) Session.Combat = combat;
            OnCombatState?.Invoke(combat);
        }

        /// <summary>
        /// globalTravelEnterWorld меняет серверную комнату без повторного join.
        /// Сразу отражаем это в Session, чтобы фильтр пакетов не считал старую
        /// локальную комнату текущей.
        /// </summary>
        public void ApplyGlobalMapTransitionAck(JObject ack)
        {
            if (Session == null) return;
            Session.RoomId = string.Empty;
            Session.WorldState = null;
            Session.Players.Clear();
            string locationId = ack?["fromLocationId"]?.ToString();
            if (!string.IsNullOrEmpty(locationId)) Session.LocationId = locationId;
            _lastEnemyFrameSeq = 0;
        }

        /// <summary>
        /// changeLocation возвращает тот же базовый снимок, что join, но без
        /// идентификаторов сессии. Объединяем его с текущей Session и публикуем
        /// OnJoined как новый комнатный baseline для HUD, врагов и игроков.
        /// </summary>
        public JoinAck ApplyLocationTransitionAck(JObject payload)
        {
            if (payload == null) return null;

            JoinAck update;
            try
            {
                update = payload.ToObject<JoinAck>(_serializer);
            }
            catch (JsonException error)
            {
                Debug.LogError("[ROA] Не удалось разобрать changeLocation ack: " + error.Message);
                return null;
            }

            if (update == null || !update.Ok) return null;
            if (Session == null) Session = update;
            else
            {
                if (!string.IsNullOrEmpty(update.Id)) Session.Id = update.Id;
                Session.RoomId = update.RoomId ?? string.Empty;
                Session.LocationId = update.LocationId ?? Session.LocationId;
                Session.LastVisitedSettlementId = update.LastVisitedSettlementId ?? Session.LastVisitedSettlementId;
                Session.X = update.X;
                Session.Z = update.Z;
                Session.Self = update.Self;
                Session.Combat = update.Combat ?? update.Self?["combat"] as JObject;
                Session.Players = update.Players ?? new List<PublicPlayer>();
                Session.WorldState = update.WorldState;
                Session.ServerAuthoritativeEnemies = update.ServerAuthoritativeEnemies;
            }

            _lastEnemyFrameSeq = 0;
            OnJoined?.Invoke(Session);
            return Session;
        }

        /// <summary>
        /// Возрождение и адресный перенос мировой симуляцией меняют комнату без join.
        /// Пакет не дублирует self/combat, поэтому сохраняем прежние до следующей
        /// authoritativePlayerState, но немедленно пересобираем локальный baseline через OnJoined.
        /// </summary>
        public JoinAck ApplyServerRoomTransfer(JObject payload)
        {
            if (payload == null) return null;
            if (Session == null) Session = new JoinAck { Ok = true };

            Session.Ok = true;
            Session.RoomId = payload["roomId"]?.ToString() ?? Session.RoomId;
            Session.LocationId = payload["locationId"]?.ToString() ?? Session.LocationId;
            Session.LastVisitedSettlementId = payload["lastVisitedSettlementId"]?.ToString()
                ?? Session.LastVisitedSettlementId;
            Session.X = payload["x"]?.ToObject<float>() ?? Session.X;
            Session.Z = payload["z"]?.ToObject<float>() ?? Session.Z;
            Session.WorldState = payload["worldState"] as JObject;
            Session.Players = payload["players"]?.ToObject<List<PublicPlayer>>() ?? new List<PublicPlayer>();
            Session.ServerAuthoritativeEnemies = payload["serverAuthoritativeEnemies"]?.ToObject<bool>() ?? true;
            _lastEnemyFrameSeq = 0;
            OnJoined?.Invoke(Session);
            return Session;
        }

        /// <summary>
        /// Предложить серверу собственное состояние. Вызывать каждый кадр — метод сам
        /// соблюдает частоту 20 Гц и не шлёт пакет, если ничего не изменилось.
        /// </summary>
        public void SendState(Vector3 unityPosition, float unityYawDeg, Vector3 unityVelocity,
                              bool moving, bool crouching, bool turning)
        {
            // Транспорт мог быть уничтожен раньше контроллера игрока — при выходе
            // из Play Mode порядок OnDestroy не определён. Проверять только Phase
            // недостаточно: она остаётся Joined до следующего кадра.
            if (Phase != ConnectionPhase.Joined || _connection == null) return;

            // Начало и остановка движения — надёжные переходы, их сервер должен
            // получить сразу, иначе персонаж «залипает» в беге у других игроков.
            bool isTransition = moving != _lastSentMoving || crouching != _lastSentCrouching;
            if (!isTransition && _stateCooldown > 0f) return;

            _stateCooldown = StateSendIntervalSeconds;
            _lastSentMoving = moving;
            _lastSentCrouching = crouching;

            World.RoaCoords.ToServer(unityPosition, out float serverX, out float serverZ);
            World.RoaCoords.ToServer(unityVelocity, out float serverVx, out float serverVz);

            var payload = new StateUpdate
            {
                Seq = ++_stateSeq,
                X = serverX,
                Z = serverZ,
                Angle = World.RoaCoords.YawDegToAngle(unityYawDeg),
                Vx = moving ? serverVx : 0f,
                Vz = moving ? serverVz : 0f,
                Moving = moving,
                Crouching = crouching,
                Turning = turning
            };

            _connection.EmitAsync("state", payload);
        }

        /// <summary>
        /// Профильное предложение без координат. Сервер сам сверяет бюджет,
        /// требования и невозвратность очков, затем шлёт authoritativePlayerState.
        /// </summary>
        public void SendProgressionProfile(JObject skillRanks, JObject talentRanks)
        {
            if (Phase != ConnectionPhase.Joined || _connection == null) return;

            var payload = new JObject
            {
                ["profileOnly"] = true,
                ["reason"] = "profile"
            };
            if (skillRanks != null) payload["skillRanks"] = skillRanks.DeepClone();
            if (talentRanks != null) payload["talentRanks"] = talentRanks.DeepClone();
            _connection.EmitAsync("state", payload);
        }

        private void Update()
        {
            while (_mainThread.TryDequeue(out Action action))
            {
                try
                {
                    action();
                }
                catch (Exception error)
                {
                    // Один сбойный пакет не должен ронять обработку остальных.
                    Debug.LogException(error);
                }
            }

            if (_stateCooldown > 0f) _stateCooldown -= Time.deltaTime;

            if (Phase == ConnectionPhase.Joined) UpdateNetworkPing();

            if (_reconnectScheduled && Phase == ConnectionPhase.Disconnected
                && Time.realtimeSinceStartup >= _reconnectAt)
                BeginTransportConnection();

            if (_joinPending && Time.realtimeSinceStartup > _joinDeadline)
            {
                _joinPending = false;
                Phase = ConnectionPhase.Disconnected;
                LastError = "Сервер не ответил на join за " + JoinTimeoutSeconds + " с.";
                Debug.LogWarning("[ROA] " + LastError);
                RoaSocketIoConnection stale = _connection;
                _connection = null;
                stale?.Dispose();
                ScheduleReconnect();
            }
        }

        private void OnDestroy()
        {
            _shuttingDown = true;
            _reconnectScheduled = false;
            ResetNetworkPing();
            // Фазу надо снять до Dispose: иначе компоненты, которые уничтожаются
            // позже, увидят Joined и попытаются писать в закрытый транспорт.
            Phase = ConnectionPhase.Disconnected;
            Session = null;

            _connection?.Dispose();
            _connection = null;
        }
    }
}
