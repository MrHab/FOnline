using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Компактная панель мировых событий в HUD: аванпосты открытого мира
    /// (владелец, босс и прогресс удержания), публичное событие
    /// (таймер, предупреждение, спорный сундук, возврат после смерти), мировой
    /// босс (щит, уязвимость, телеграф импульса), PvE-область («Искать следы»)
    /// и зал боковой лаборатории (шкала угрозы, объявленный удар, узлы).
    /// Все значения приходят с сервера; клиент только форматирует и показывает
    /// то, что относится к текущей комнате.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaWorldEventsPresentation : MonoBehaviour
    {
        private static readonly Color Ink = new Color(0.906f, 0.835f, 0.682f, 1f);
        private static readonly Color Warn = new Color(1f, 0.66f, 0.42f, 1f);
        private static readonly Color Calm = new Color(0.62f, 0.84f, 0.62f, 1f);

        private RoaSocketClient _socket;
        private RoaPlayerController _player;
        private Canvas _canvas;
        private GameObject _panel;
        private Text _text;
        private Button _tracksButton;
        private Text _tracksLabel;
        private Button _openChestButton;
        private Text _openChestLabel;
        private JObject _alife;
        private long _alifeVersion = -1;
        private JObject _publicEvent;
        private JObject _worldBoss;
        private JObject _pveArea;
        private JObject _labHall;
        private float _nextRefreshAt;
        private double _receivedAt;

        public void Configure(RoaSocketClient socket)
        {
            Unsubscribe();
            _socket = socket;
            BuildUi();
            Subscribe();
            ApplyJoinedWorldState();
        }

        public void SetPlayer(RoaPlayerController player)
        {
            _player = player;
            Refresh();
        }

        private void OnDestroy() { Unsubscribe(); }

        private void Subscribe()
        {
            if (_socket == null) return;
            _socket.OnAlifeUpdate += ApplyAlifeUpdate;
            _socket.OnPublicEventState += ApplyPublicEvent;
            _socket.OnWorldBossState += ApplyWorldBoss;
            _socket.OnPveAreaState += ApplyPveArea;
            _socket.OnLabHallState += ApplyLabHall;
            _socket.OnJoined += HandleJoined;
            _socket.OnServerWorldTransfer += HandleTransfer;
        }

        private void Unsubscribe()
        {
            if (_socket == null) return;
            _socket.OnAlifeUpdate -= ApplyAlifeUpdate;
            _socket.OnPublicEventState -= ApplyPublicEvent;
            _socket.OnWorldBossState -= ApplyWorldBoss;
            _socket.OnPveAreaState -= ApplyPveArea;
            _socket.OnLabHallState -= ApplyLabHall;
            _socket.OnJoined -= HandleJoined;
            _socket.OnServerWorldTransfer -= HandleTransfer;
        }

        private void HandleJoined(JoinAck _) { ApplyJoinedWorldState(); }
        private void HandleTransfer(JObject _) { ApplyJoinedWorldState(); }

        /// <summary>Снимок комнаты при входе несёт PvE/событие/босса; сброс при смене локации.</summary>
        private void ApplyJoinedWorldState()
        {
            JObject world = _socket?.Session?.WorldState;
            _publicEvent = world?["publicEvent"] as JObject;
            _labHall = world?["labHall"] as JObject;
            _worldBoss = world?["worldBoss"] as JObject;
            _pveArea = world?["pveArea"] as JObject;
            _alife = null;
            _alifeVersion = -1;
            ApplyAlifeUpdate(world?["alife"] as JObject);
            _receivedAt = Time.realtimeSinceStartupAsDouble;
            Refresh();
        }

        private void ApplyAlifeUpdate(JObject payload)
        {
            if (!ShouldApplyAlifeUpdate(_socket?.Session?.LocationId, _alifeVersion, payload)) return;
            long version = payload["version"].Value<long>();
            _alifeVersion = version;
            _alife = (JObject)payload.DeepClone();
            Refresh();
        }

        public static bool ShouldApplyAlifeUpdate(string currentLocationId, long currentVersion, JObject payload)
        {
            return payload != null && !string.IsNullOrEmpty(currentLocationId)
                && string.Equals(payload["locationId"]?.ToString(), currentLocationId, StringComparison.Ordinal)
                && (payload["version"]?.Value<long>() ?? -1) > currentVersion
                && payload["sites"] is JArray;
        }

        public void CollectMinimapMarkers(List<RoaMinimap.Marker> markers)
        {
            CollectAlifeMarkers(_alife, _socket?.Session?.LocationId, markers);
        }

        public static void CollectAlifeMarkers(JObject alife, string locationId,
            List<RoaMinimap.Marker> markers)
        {
            JArray sites = alife?["sites"] as JArray;
            if (markers == null || sites == null) return;
            foreach (JToken token in sites)
            {
                JObject site = token as JObject;
                if (site == null || site["locationId"]?.ToString() != locationId) continue;
                string kind = site["kind"]?.ToString();
                if (kind == "lair" && site["active"]?.Value<bool>() != true) continue;
                RoaMinimap.MarkerKind markerKind;
                if (kind == "lair") markerKind = RoaMinimap.MarkerKind.Lair;
                else if (kind == "huntingGround") markerKind = RoaMinimap.MarkerKind.HuntingGround;
                else if (kind == "outpost") markerKind = RoaMinimap.MarkerKind.Outpost;
                else continue;
                float x = site["x"]?.Value<float>() ?? 0f;
                float z = site["z"]?.Value<float>() ?? 0f;
                markers.Add(new RoaMinimap.Marker(markerKind, RoaCoords.ToUnity(x, z)));
            }
        }

        public static string DescribeAlifeOutposts(JObject alife, string locationId)
        {
            JArray sites = alife?["sites"] as JArray;
            if (sites == null || string.IsNullOrEmpty(locationId)) return string.Empty;
            var rows = new List<string>();
            foreach (JToken token in sites)
            {
                JObject site = token as JObject;
                if (site?["kind"]?.ToString() != "outpost" || site["locationId"]?.ToString() != locationId) continue;
                string name = site["displayName"]?.ToString() ?? site["id"]?.ToString() ?? "Аванпост";
                string owner = site["ownerFaction"]?.ToString() ?? string.Empty;
                string label = string.IsNullOrEmpty(owner) ? "нейтральный" : RoaPipboy.FactionLabel(owner);
                int percent = Mathf.Clamp(Mathf.RoundToInt(site["capturePercent"]?.Value<float>() ?? 0f), 0, 100);
                string boss = site["bossAlive"]?.Value<bool>() == true ? "босс защищает" : "босс побеждён";
                rows.Add(name + ": " + label + " · " + boss + " · захват " + percent + "%");
            }
            return rows.Count == 0 ? string.Empty : "АВАНПОСТЫ\n" + string.Join("\n", rows);
        }

        /// <summary>Активное задание только в границах аванпоста, где стоит игрок.</summary>
        public static string DescribeAlifeCaptureTask(JObject alife, string locationId, Vector3 playerPosition)
        {
            JArray sites = alife?["sites"] as JArray;
            JArray tasks = alife?["captureTasks"] as JArray;
            if (sites == null || tasks == null || string.IsNullOrEmpty(locationId)) return string.Empty;

            JObject closest = null;
            float closestDistance = float.MaxValue;
            RoaCoords.ToServer(playerPosition, out float playerX, out float playerZ);
            foreach (JToken token in sites)
            {
                JObject site = token as JObject;
                if (site?["kind"]?.ToString() != "outpost" || site["locationId"]?.ToString() != locationId) continue;
                float siteX = site["x"]?.Value<float>() ?? 0f;
                float siteZ = site["z"]?.Value<float>() ?? 0f;
                float dx = playerX - siteX;
                float dz = playerZ - siteZ;
                float distance = dx * dx + dz * dz;
                JObject bounds = site["bounds"] as JObject;
                bool within;
                if (bounds != null && bounds["minX"] != null && bounds["maxX"] != null
                    && bounds["minZ"] != null && bounds["maxZ"] != null)
                    within = playerX >= bounds["minX"].Value<float>()
                        && playerX <= bounds["maxX"].Value<float>()
                        && playerZ >= bounds["minZ"].Value<float>()
                        && playerZ <= bounds["maxZ"].Value<float>();
                else
                {
                    float radius = Mathf.Max(0f, site["radius"]?.Value<float>() ?? 0f);
                    within = radius > 0f && distance <= radius * radius;
                }
                if (!within || distance >= closestDistance) continue;
                closest = site;
                closestDistance = distance;
            }
            if (closest == null) return string.Empty;

            JObject task = null;
            string siteId = closest["id"]?.ToString();
            foreach (JToken token in tasks)
            {
                JObject candidate = token as JObject;
                if (candidate?["siteId"]?.ToString() != siteId) continue;
                task = candidate;
                break;
            }
            if (task == null) return string.Empty;

            string title = task["title"]?.ToString() ?? "Захват аванпоста";
            string name = closest["displayName"]?.ToString();
            var line = new StringBuilder("ЗАДАНИЕ · ").Append(title.ToUpperInvariant());
            if (!string.IsNullOrEmpty(name)) line.Append(" · ").Append(name);
            string phase = task["phase"]?.ToString();
            if (phase == "defeatBoss" || task["bossAlive"]?.Value<bool>() == true)
                line.Append("\nЭтап 1/2 · победите босса аванпоста");
            else if (phase == "hold")
            {
                int percent = Mathf.Clamp(Mathf.RoundToInt(task["progressPercent"]?.Value<float>() ?? 0f), 0, 100);
                int seconds = Mathf.Max(0, task["requiredSeconds"]?.Value<int>() ?? 180);
                line.Append("\nЭтап 2/2 · удержание ").Append(percent).Append("% / ")
                    .Append(Clock(seconds));
                string faction = task["captureFaction"]?.ToString();
                if (!string.IsNullOrEmpty(faction)) line.Append(" · ").Append(RoaPipboy.FactionLabel(faction));
            }
            else if (phase == "owned") line.Append("\nАванпост захвачен");
            else return string.Empty;
            return line.ToString();
        }

        private void ApplyPublicEvent(JObject payload)
        {
            if (payload?["expired"]?.Value<bool>() == true || payload?["evicted"]?.Value<bool>() == true) _publicEvent = null;
            else _publicEvent = payload;
            _receivedAt = Time.realtimeSinceStartupAsDouble;
            Refresh();
        }

        private void ApplyWorldBoss(JObject payload) { _worldBoss = payload; _receivedAt = Time.realtimeSinceStartupAsDouble; Refresh(); }
        private void ApplyPveArea(JObject payload) { _pveArea = payload; _receivedAt = Time.realtimeSinceStartupAsDouble; Refresh(); }
        private void ApplyLabHall(JObject payload) { _labHall = payload; _receivedAt = Time.realtimeSinceStartupAsDouble; Refresh(); }

        private void Update()
        {
            if (Time.unscaledTime < _nextRefreshAt) return;
            _nextRefreshAt = Time.unscaledTime + 1f;
            Refresh();
        }

        private void Refresh()
        {
            if (_text == null) return;
            string locationId = _socket?.Session?.LocationId ?? string.Empty;
            string roomId = _socket?.Session?.RoomId ?? string.Empty;
            int elapsed = (int)Math.Max(0, Time.realtimeSinceStartupAsDouble - _receivedAt);
            var lines = new List<string>();
            string outposts = _player != null
                ? DescribeAlifeCaptureTask(_alife, locationId, _player.transform.position)
                : string.Empty;
            if (!string.IsNullOrEmpty(outposts)) lines.Add(outposts);
            string publicEvent = DescribePublicEvent(_publicEvent, roomId, elapsed);
            if (!string.IsNullOrEmpty(publicEvent)) lines.Add(publicEvent);
            string worldBoss = DescribeWorldBoss(_worldBoss, roomId, elapsed);
            if (!string.IsNullOrEmpty(worldBoss)) lines.Add(worldBoss);
            string pve = DescribePveArea(_pveArea, roomId, elapsed);
            if (!string.IsNullOrEmpty(pve)) lines.Add(pve);
            string lab = DescribeLabHall(_labHall, roomId);
            if (!string.IsNullOrEmpty(lab)) lines.Add(lab);
            bool visible = lines.Count > 0 && _socket != null && _socket.Phase == RoaSocketClient.ConnectionPhase.Joined
                && _socket.Session != null;
            _panel.SetActive(visible);
            if (!visible) return;
            _text.text = string.Join("\n", lines);
            _text.color = (_worldBoss != null && _worldBoss["pulseTelegraph"]?.Value<bool>() == true)
                || (_publicEvent != null && _publicEvent["warning"]?.Value<bool>() == true) ? Warn : Ink;
            ResizePanel();
            RefreshChestButton(roomId);
            bool tracks = _pveArea != null && _pveArea["roomId"]?.ToString() == roomId;
            _tracksButton.gameObject.SetActive(tracks);
            if (tracks)
            {
                int ready = Math.Max(0, (_pveArea["tracksReadyInSeconds"]?.Value<int>() ?? 0) - elapsed);
                _tracksLabel.text = (_pveArea["tracksLabel"]?.ToString() ?? "Искать следы").ToUpperInvariant()
                    + (ready > 0 ? " · " + ready + " с" : string.Empty);
                _tracksButton.interactable = ready <= 0;
            }
        }

        /// <summary>
        /// Панель растёт под свой текст и уводит за собой кнопки. Раньше высота
        /// была жёсткой, а лишнее просто обрезалось: в Сердцевине с тремя
        /// аванпостами и правилами захвата хвост сообщения игрок не видел.
        /// Предел роста — доля высоты экрана, чтобы панель не съедала обзор.
        /// </summary>
        private void ResizePanel()
        {
            if (_panel == null || _text == null) return;
            bool mobile = Application.isMobilePlatform;
            Vector2 size = PanelSize(mobile);
            var rect = (RectTransform)_panel.transform;
            float content = _text.preferredHeight + PanelPadding * 2f;
            float height = Mathf.Clamp(content, size.y, PanelMaxHeight(mobile));
            rect.sizeDelta = new Vector2(size.x, height);
            float top = rect.anchoredPosition.y;
            float gap = mobile ? 8f : 10f;
            Vector2 button = ButtonSize(mobile);
            if (_tracksButton != null)
            {
                var br = (RectTransform)_tracksButton.transform;
                br.anchoredPosition = new Vector2(br.anchoredPosition.x, top - height - gap);
            }
            if (_openChestButton != null)
            {
                var cr = (RectTransform)_openChestButton.transform;
                cr.anchoredPosition = new Vector2(cr.anchoredPosition.x, top - height - gap * 2f - button.y);
            }
        }

        private void RefreshChestButton(string roomId)
        {
            if (_openChestButton == null) return;
            bool mine = _publicEvent != null && _publicEvent["roomId"]?.ToString() == roomId;
            bool open = mine && _publicEvent["chestOpen"]?.Value<bool>() == true
                && _publicEvent["chestClaimed"]?.Value<bool>() != true;
            if (_openChestButton.gameObject.activeSelf != open) _openChestButton.gameObject.SetActive(open);
            if (!open) return;
            _openChestLabel.text = ChestButtonLabel(_publicEvent["chestOpening"] as JObject);
        }

        /// <summary>Надпись кнопки вскрытия: доля канала и причина паузы.</summary>
        public static string ChestButtonLabel(JObject opening)
        {
            long channel = opening?["channelMs"]?.Value<long>() ?? 0L;
            long progress = opening?["progressMs"]?.Value<long>() ?? 0L;
            string holder = opening?["characterId"]?.ToString();
            if (string.IsNullOrEmpty(holder) || channel <= 0) return "ВСКРЫТЬ ТАЙНИК";
            int percent = Mathf.Clamp(Mathf.RoundToInt(progress * 100f / Mathf.Max(1f, channel)), 0, 100);
            return opening?["contested"]?.Value<bool>() == true
                ? "ВСКРЫТИЕ " + percent + "% · ОСПАРИВАЕТСЯ"
                : "ВСКРЫТИЕ " + percent + "%";
        }

        private void OpenEventChest()
        {
            if (_socket == null || _socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            _socket.EmitWithAck("publicEventAction", new Dictionary<string, object> { ["action"] = "open" }, ack =>
            {
                if (ack == null) return;
                if (ack["ok"]?.Value<bool>() == true)
                {
                    if (ack["event"] is JObject updated) _publicEvent = updated;
                    if (ack["opening"] is JObject opening && _publicEvent != null) _publicEvent["chestOpening"] = opening;
                }
                else if (_text != null) _text.text = ack["error"]?.ToString() ?? _text.text;
            });
        }

        private void SearchTracks()
        {
            RoaPveAreaNet.SearchTracks(_socket, ack =>
            {
                if (ack != null && ack["ok"]?.Value<bool>() == true) ApplyPveArea(ack);
                else if (_text != null && ack != null) _text.text = ack["error"]?.ToString() ?? _text.text;
            });
        }

        // --- Форматирование (чистые функции, проверяются пробой) ---------------------

        public static string DescribeOutposts(JObject territory, string locationId)
        {
            if (territory == null || string.IsNullOrEmpty(locationId)) return string.Empty;
            string zoneId = territory["zoneLocationId"]?.ToString() ?? "coreZone";
            if (!string.Equals(locationId, zoneId, StringComparison.Ordinal)) return string.Empty;
            JArray outposts = territory["outposts"] as JArray;
            if (outposts == null || outposts.Count == 0) return string.Empty;
            JObject factionNames = territory["factionNames"] as JObject;
            // Правила захвата приходят в снимке: игрок видит, сколько нужно
            // удерживать область и что мешает прогрессу.
            var sb = new StringBuilder("АВАНПОСТЫ");
            string captureRules = CaptureRulesLabel(territory["rules"] as JObject);
            if (!string.IsNullOrEmpty(captureRules)) sb.Append(" · ").Append(captureRules);
            sb.Append("\n").Append(OutpostVersusBaseLabel());
            foreach (JToken token in outposts)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string name = row["displayName"]?.ToString() ?? row["id"]?.ToString() ?? "Аванпост";
                string owner = FactionLabel(factionNames, row["ownerFactionId"]?.ToString());
                if (string.IsNullOrEmpty(owner)) owner = "нейтральный";
                bool open = row["eventStatus"]?.ToString() == "open";
                int countdown = Mathf.CeilToInt((row["eventOpensInMs"]?.Value<long>() ?? 0L) / 1000f);
                string leading = row["capture"]?["leadingFactionId"]?.ToString() ?? string.Empty;
                float progressValue = string.IsNullOrEmpty(leading) ? 0f : (row["capture"]?["progress"]?[leading]?.Value<float>() ?? 0f);
                int progress = Mathf.RoundToInt(progressValue * 100f);
                bool contested = row["capture"]?["contested"]?.Value<bool>() == true;
                string garrison = GarrisonLabel(row["garrison"]?["state"]?.ToString());
                sb.Append('\n').Append(name).Append(": ").Append(owner);
                if (open) sb.Append(" · ЗАХВАТ ОТКРЫТ");
                else if (countdown > 0) sb.Append(" · захват через ").Append(Clock(countdown));
                if (open && progress > 0) sb.Append(" · ").Append(FactionLabel(factionNames, leading)).Append(' ').Append(progress).Append('%');
                if (open && contested) sb.Append(" · ОСПАРИВАЕТСЯ");
                if (!string.IsNullOrEmpty(garrison)) sb.Append(" · гарнизон: ").Append(garrison);
                if (open && contested) sb.Append(" (прогресс стоит)");
                string retiring = RetiringLabel(factionNames, row["retiring"] as JArray);
                if (!string.IsNullOrEmpty(retiring)) sb.Append(" · отходит: ").Append(retiring);
            }
            return sb.ToString();
        }

        /// <summary>
        /// Правила захвата для панели: длительность удержания, остановка при
        /// оспаривании и скорость отката. Значения приходят с сервера.
        /// </summary>
        /// <summary>
        /// Чем аванпост отличается от базы. Без этой строки игрок видел только
        /// проценты захвата и не понимал, что база — незахватываемый участок
        /// со службами, а здесь нет ни хранилища, ни сервисов, и смерть стоит
        /// рюкзака.
        /// </summary>
        public static string OutpostVersusBaseLabel()
        {
            return "Аванпост — полевой объект: захватывается присутствием, служб и хранилища здесь нет, "
                + "смерть стоит рюкзака. База фракции не захватывается: там регистратор, медик, аукционер, "
                + "исследователь и хранилище, и PvP отключён.";
        }

        public static string CaptureRulesLabel(JObject rules)
        {
            if (rules == null) return string.Empty;
            long holdMs = rules["captureHoldMs"]?.Value<long>() ?? 0L;
            if (holdMs <= 0) return string.Empty;
            var parts = new List<string>();
            parts.Add("удержание " + Clock(Mathf.CeilToInt(holdMs / 1000f)));
            if (rules["contestPausesProgress"]?.Value<bool>() == true) parts.Add("оспаривание останавливает прогресс");
            float decay = rules["captureDecayRate"]?.Value<float>() ?? 0f;
            if (decay > 0f) parts.Add("откат " + Mathf.RoundToInt(decay * 100f) + "%/с");
            return string.Join(", ", parts);
        }

        /// <summary>
        /// Колонны прежних владельцев, ещё идущие к своим базам. Гарнизоном
        /// аванпоста они не являются и флаг не защищают.
        /// </summary>
        public static string RetiringLabel(JObject factionNames, JArray retiring)
        {
            if (retiring == null || retiring.Count == 0) return string.Empty;
            var parts = new List<string>();
            foreach (JToken token in retiring)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string label = FactionLabel(factionNames, row["factionId"]?.ToString());
                if (string.IsNullOrEmpty(label)) continue;
                parts.Add(label + " " + Mathf.RoundToInt((row["progress"]?.Value<float>() ?? 0f) * 100f) + "%");
            }
            return string.Join(", ", parts);
        }

        /// <summary>
        /// Механики сценария в строке события: какие опоры ещё целы, защищён ли
        /// главарь и сколько осталось до обозначенного удара.
        /// </summary>
        public static string ScenarioLine(JObject scenario)
        {
            if (scenario == null) return string.Empty;
            var parts = new List<string>();
            var intact = new List<string>();
            foreach (JToken token in scenario["supports"] as JArray ?? new JArray())
            {
                JObject row = token as JObject;
                if (row == null || row["alive"]?.Value<bool>() != true) continue;
                // Сторона опоры важна: к цели ведёт не один коридор, и отряд
                // выбирает, с какой стороны заходить.
                string side = row["side"]?.ToString();
                string name = row["displayName"]?.ToString() ?? "опора";
                intact.Add(string.IsNullOrEmpty(side) ? name : name + " (" + side + ")");
            }
            if (intact.Count > 0) parts.Add("цело: " + string.Join(", ", intact));
            if (scenario["shielded"]?.Value<bool>() == true) parts.Add("ГЛАВАРЬ ПОД ЩИТОМ");
            JObject strike = scenario["strike"] as JObject;
            if (strike != null)
            {
                string name = strike["displayName"]?.ToString() ?? "удар";
                if (strike["telegraph"]?.Value<bool>() == true) parts.Add(name.ToUpperInvariant() + "!");
                else
                {
                    int inSeconds = strike["inSeconds"]?.Value<int>() ?? 0;
                    if (inSeconds > 0) parts.Add(name + " через " + inSeconds + " с");
                }
                // Обозначенный удар называет сторону: точка прихода известна
                // заранее, и уходить надо в другую.
                string strikeSide = CompassSide(strike["x"]?.Value<float>() ?? 0f, strike["z"]?.Value<float>() ?? 0f);
                if (!string.IsNullOrEmpty(strikeSide) && strikeSide != "центр") parts.Add("удар с: " + strikeSide);
            }
            int hazards = (scenario["hazards"] as JArray)?.Count ?? 0;
            if (hazards > 0) parts.Add("опасная земля: " + hazards);
            return parts.Count > 0 ? "\n" + string.Join(" · ", parts) : string.Empty;
        }

        /// <summary>
        /// Зал лаборатории: шкала угрозы, объявленный удар и готовность узлов.
        /// Данные присылает сервер; клиент только показывает их.
        /// </summary>
        public static string DescribeLabHall(JObject payload, string roomId)
        {
            if (payload == null) return string.Empty;
            string payloadRoom = payload["roomId"]?.ToString();
            if (!string.IsNullOrEmpty(payloadRoom) && !string.IsNullOrEmpty(roomId) && payloadRoom != roomId) return string.Empty;
            string meterLabel = payload["meterLabel"]?.ToString() ?? "Угроза";
            int percent = Mathf.Clamp(Mathf.RoundToInt((payload["meter"]?.Value<float>() ?? 0f) * 100f), 0, 100);
            var sb = new StringBuilder(meterLabel.ToUpperInvariant()).Append(": ").Append(percent).Append('%');
            if (payload["telegraph"]?.Value<bool>() == true)
            {
                sb.Append(" · ").Append((payload["hazardName"]?.ToString() ?? "УДАР").ToUpperInvariant()).Append('!');
                int inSeconds = payload["telegraphInSeconds"]?.Value<int>() ?? 0;
                if (inSeconds > 0) sb.Append(' ').Append(inSeconds).Append(" с");
                // Объявленный удар обязан говорить, куда он придёт: сервер шлёт
                // сами сектора, а игрок должен знать, с какой стороны уходить.
                string sides = HazardSides(payload["sectors"] as JArray);
                if (!string.IsNullOrEmpty(sides)) sb.Append(" · ").Append(sides);
            }
            if (payload["guardShielded"]?.Value<bool>() == true) sb.Append(" · МАШИНА ПОД ПИТАНИЕМ");
            // Окно побочного эффекта узла — это и есть время, когда охранную
            // машину можно бить: щит снят, пока оно идёт. Сервер шлёт остаток,
            // и без него игрок бьёт вслепую. В зале без машины окно ничего не
            // решает, поэтому там оно и не называется.
            string effect = NodeEffectLine(payload["nodes"] as JArray,
                !string.IsNullOrEmpty(payload["guardName"]?.ToString()));
            if (!string.IsNullOrEmpty(effect)) sb.Append(" · ").Append(effect);
            // Одинаковые приборы на стенах называются одинаково, поэтому
            // совпадающие строки сводятся в одну с количеством.
            var ready = new List<string>();
            var counts = new Dictionary<string, int>();
            foreach (JToken token in payload["nodes"] as JArray ?? new JArray())
            {
                JObject node = token as JObject;
                if (node == null) continue;
                int readyIn = node["readyInSeconds"]?.Value<int>() ?? 0;
                string name = node["displayName"]?.ToString() ?? "узел";
                string row = readyIn > 0 ? name + " (" + readyIn + " с)" : name;
                if (counts.TryGetValue(row, out int seen)) counts[row] = seen + 1;
                else { counts[row] = 1; ready.Add(row); }
            }
            for (int i = 0; i < ready.Count; i++)
            {
                if (counts[ready[i]] > 1) ready[i] = ready[i] + " ×" + counts[ready[i]];
            }
            if (ready.Count > 0) sb.Append("\nУзлы: ").Append(string.Join(", ", ready));
            return sb.ToString();
        }

        /// <summary>
        /// Остаток окна побочного эффекта узла. Сервер снимает щит с охранной
        /// машины, пока идёт окно любого узла, и больше это окно ни на что не
        /// влияет — в зале без машины оно не называется вовсе.
        /// </summary>
        public static string NodeEffectLine(JArray nodes, bool hasGuard)
        {
            if (!hasGuard) return string.Empty;
            int best = 0;
            foreach (JToken token in nodes ?? new JArray())
            {
                JObject row = token as JObject;
                if (row == null) continue;
                best = Mathf.Max(best, row["effectSeconds"]?.Value<int>() ?? 0);
            }
            return best > 0 ? "ПИТАНИЕ СНЯТО: " + best + " с" : string.Empty;
        }

        /// <summary>
        /// Стороны зала, по которым придёт удар: «север, юго-запад». Считается
        /// от центра зала, вокруг которого сервер и раскладывает сектора.
        /// </summary>
        public static string HazardSides(JArray sectors, float centerX = 0f, float centerZ = 0f)
        {
            if (sectors == null || sectors.Count == 0) return string.Empty;
            var sides = new List<string>();
            foreach (JToken token in sectors)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string side = CompassSide((row["x"]?.Value<float>() ?? 0f) - centerX,
                    (row["z"]?.Value<float>() ?? 0f) - centerZ);
                if (!string.IsNullOrEmpty(side) && !sides.Contains(side)) sides.Add(side);
            }
            return sides.Count > 0 ? string.Join(", ", sides) : string.Empty;
        }

        /// <summary>Сторона света точки относительно центра зала.</summary>
        public static string CompassSide(float x, float z)
        {
            if (Mathf.Abs(x) < 1f && Mathf.Abs(z) < 1f) return "центр";
            string vertical = Mathf.Abs(z) >= Mathf.Abs(x) * 0.5f ? (z >= 0f ? "север" : "юг") : string.Empty;
            string horizontal = Mathf.Abs(x) >= Mathf.Abs(z) * 0.5f ? (x >= 0f ? "восток" : "запад") : string.Empty;
            if (!string.IsNullOrEmpty(vertical) && !string.IsNullOrEmpty(horizontal)) return vertical + "о-" + horizontal;
            return string.IsNullOrEmpty(vertical) ? horizontal : vertical;
        }

        public static string FactionLabel(JObject factionNames, string factionId)
        {
            if (string.IsNullOrEmpty(factionId)) return string.Empty;
            string label = factionNames?[factionId]?.ToString();
            return string.IsNullOrEmpty(label) ? factionId : label;
        }

        public static string GarrisonLabel(string state)
        {
            switch (state ?? string.Empty)
            {
                case "dispatched": return "выдвинулся";
                case "enroute": return "в пути";
                case "arrived": return "прибыл";
                default: return string.Empty;
            }
        }

        public static string DescribePublicEvent(JObject payload, string roomId, int elapsedSeconds)
        {
            if (payload == null || string.IsNullOrEmpty(roomId) || payload["roomId"]?.ToString() != roomId) return string.Empty;
            int remaining = Math.Max(0, (payload["remainingSeconds"]?.Value<int>() ?? 0) - elapsedSeconds);
            string name = payload["displayName"]?.ToString() ?? "Событие";
            var sb = new StringBuilder(name.ToUpperInvariant()).Append(" · ").Append(Clock(remaining));
            int danger = payload["danger"]?.Value<int>() ?? 0;
            if (danger > 0) sb.Append(" · опасность ").Append(danger);
            // Мини-босс сценария: пока он жив, событие не зачищено и тайник закрыт.
            JObject boss = payload["boss"] as JObject;
            string bossName = boss?["displayName"]?.ToString();
            if (!string.IsNullOrWhiteSpace(bossName))
            {
                sb.Append(boss["killed"]?.Value<bool>() == true ? " · " + bossName + ": повержен" : " · цель: " + bossName);
            }
            string scenario = ScenarioLine(payload["scenario"] as JObject);
            if (!string.IsNullOrEmpty(scenario)) sb.Append(scenario);
            if (payload["warning"]?.Value<bool>() == true) sb.Append(" · СКОРО ЗАКРОЕТСЯ");
            if (payload["cleared"]?.Value<bool>() == true)
            {
                if (payload["chestClaimed"]?.Value<bool>() == true) sb.Append("\nТайник уже забрали");
                else if (payload["chestOpen"]?.Value<bool>() == true) sb.Append("\nТАЙНИК ОТКРЫТ — успейте первыми");
                else sb.Append("\nТайник откроется через ").Append(Math.Max(0, (payload["chestOpensInSeconds"]?.Value<int>() ?? 0) - elapsedSeconds)).Append(" с · PvP разрешено");
            }
            else sb.Append("\nЗачистите логово, чтобы открыть тайник");
            return sb.ToString();
        }

        public static string DescribeWorldBoss(JObject payload, string roomId, int elapsedSeconds)
        {
            if (payload == null) return string.Empty;
            string payloadRoom = payload["roomId"]?.ToString();
            if (!string.IsNullOrEmpty(payloadRoom) && !string.IsNullOrEmpty(roomId) && payloadRoom != roomId) return string.Empty;
            string name = payload["displayName"]?.ToString() ?? "Хранитель";
            string phase = payload["phase"]?.ToString() ?? "shielded";
            var sb = new StringBuilder(name.ToUpperInvariant()).Append(" · ").Append(payload["phaseLabel"]?.ToString() ?? phase);
            if (phase == "defeated")
            {
                sb.Append("\nВозвращение через ").Append(Clock(Math.Max(0, (payload["respawnInSeconds"]?.Value<int>() ?? 0) - elapsedSeconds)));
                // Победа открывает сейфы установки, и закроет их возвращение
                // Хранителя: этот же отсчёт и есть срок, чтобы их забрать.
                if (payload["rewardOpen"]?.Value<bool>() == true) sb.Append(" · сейфы установки открыты");
                return sb.ToString();
            }
            sb.Append("\nУзлы щита: ").Append(payload["nodesAlive"]?.Value<int>() ?? 0).Append('/').Append(payload["nodesTotal"]?.Value<int>() ?? 0);
            if (phase == "vulnerable") sb.Append(" · уязвим ещё ").Append(Math.Max(0, (payload["vulnerableSeconds"]?.Value<int>() ?? 0) - elapsedSeconds)).Append(" с");
            int hp = payload["bossHp"]?.Value<int>() ?? 0;
            int maxHp = payload["bossMaxHp"]?.Value<int>() ?? 0;
            if (maxHp > 0) sb.Append(" · HP ").Append(hp).Append('/').Append(maxHp);
            // Опасные участки арены смещаются с каждым импульсом: игрок должен
            // видеть, сколько секторов горит прямо сейчас.
            int hazards = (payload["hazards"] as JArray)?.Count ?? 0;
            if (hazards > 0)
            {
                sb.Append(" · горит: ");
                JObject arena = payload["arenaCenter"] as JObject;
                string sides = HazardSides(payload["hazards"] as JArray,
                    arena?["x"]?.Value<float>() ?? 0f, arena?["z"]?.Value<float>() ?? 0f);
                sb.Append(string.IsNullOrEmpty(sides) ? hazards + " сект." : sides);
            }
            if (payload["pulseTelegraph"]?.Value<bool>() == true) sb.Append("\nИМПУЛЬС! Отойдите на ").Append(payload["pulseRadius"]?.Value<int>() ?? 9).Append(" м");
            else sb.Append("\nИмпульс через ").Append(Math.Max(0, (payload["pulseInSeconds"]?.Value<int>() ?? 0) - elapsedSeconds)).Append(" с");
            return sb.ToString();
        }

        public static string DescribePveArea(JObject payload, string roomId, int elapsedSeconds)
        {
            if (payload == null || string.IsNullOrEmpty(roomId) || payload["roomId"]?.ToString() != roomId) return string.Empty;
            string name = payload["displayName"]?.ToString() ?? "PvE-область";
            // Логово угодий — общая комната: у главаря встречаются все, кто
            // дошёл. Личными остались случайные встречи на маршруте.
            var sb = new StringBuilder(name.ToUpperInvariant())
                .Append(payload["personal"]?.Value<bool>() == true ? " · личная встреча" : " · общее логово")
                .Append(" · PvP отключён");
            int alive = payload["alive"]?.Value<int>() ?? 0;
            sb.Append("\nВрагов рядом: ").Append(alive);
            int calm = Math.Max(0, (payload["calmSeconds"]?.Value<int>() ?? 0) - elapsedSeconds);
            if (calm > 0) sb.Append(" · затишье ").Append(calm).Append(" с");
            // Встречи приходят к идущему: пока отряд не прошёл свою долю пути по
            // области, проверки не будет. Без этой строки тишина выглядит
            // поломкой, а не правилом.
            int toRoll = payload["distanceToRollM"]?.Value<int>() ?? 0;
            // Проверка требует и пройденного пути, и выдержанного интервала.
            // Пока показывали только путь, прошедший его отряд стоял в тишине
            // и не понимал, чего ждёт.
            int nextRoll = Math.Max(0, (payload["nextRollInSeconds"]?.Value<int>() ?? 0) - elapsedSeconds);
            if (calm <= 0)
            {
                if (toRoll > 0) sb.Append(" · идти ещё ").Append(toRoll).Append(" м");
                if (nextRoll > 0) sb.Append(" · проверка через ").Append(nextRoll).Append(" с");
            }
            string last = payload["lastResultLabel"]?.ToString();
            if (!string.IsNullOrEmpty(last)) sb.Append('\n').Append(last);
            return sb.ToString();
        }

        public static string Clock(int seconds)
        {
            int value = Math.Max(0, seconds);
            return (value / 60).ToString("00") + ":" + (value % 60).ToString("00");
        }

        // --- UI ------------------------------------------------------------------------

        private void BuildUi()
        {
            if (_canvas != null) return;
            _canvas = new GameObject("WorldEventsCanvas", typeof(RectTransform)).AddComponent<Canvas>();
            _canvas.transform.SetParent(transform, false);
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 465;
            var scaler = _canvas.gameObject.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1280, 720);
            _canvas.gameObject.AddComponent<GraphicRaycaster>();
            bool mobile = Application.isMobilePlatform;
            _panel = new GameObject("WorldEvents", typeof(RectTransform), typeof(Image));
            _panel.transform.SetParent(_canvas.transform, false);
            RectTransform rect = (RectTransform)_panel.transform;
            rect.anchorMin = new Vector2(1, 1);
            rect.anchorMax = new Vector2(1, 1);
            rect.pivot = new Vector2(1, 1);
            rect.anchoredPosition = mobile ? new Vector2(-12, -58) : new Vector2(-16, -84);
            rect.sizeDelta = PanelSize(mobile);
            _panel.GetComponent<Image>().color = new Color(0.035f, 0.05f, 0.045f, 0.9f);
            _text = CreateText("Status", rect, PanelFontSize(mobile), TextAnchor.UpperLeft, Ink);
            Stretch(_text.rectTransform, PanelPadding);
            _text.horizontalOverflow = HorizontalWrapMode.Wrap;
            _text.verticalOverflow = VerticalWrapMode.Truncate;
            GameObject button = new GameObject("SearchTracks", typeof(RectTransform), typeof(Image), typeof(Button));
            button.transform.SetParent(_canvas.transform, false);
            RectTransform br = (RectTransform)button.transform;
            br.anchorMin = new Vector2(1, 1);
            br.anchorMax = new Vector2(1, 1);
            br.pivot = new Vector2(1, 1);
            br.anchoredPosition = mobile ? new Vector2(-12, -182) : new Vector2(-16, -240);
            br.sizeDelta = ButtonSize(mobile);
            button.GetComponent<Image>().color = new Color(0.16f, 0.28f, 0.12f, 0.95f);
            _tracksButton = button.GetComponent<Button>();
            _tracksButton.onClick.AddListener(SearchTracks);
            _tracksLabel = CreateText("Label", br, ButtonFontSize(mobile), TextAnchor.MiddleCenter, Calm);
            Stretch(_tracksLabel.rectTransform, ButtonLabelInset);
            _tracksButton.gameObject.SetActive(false);

            // Вскрытие тайника события: канал держится, пока игрок стоит у сундука.
            GameObject chestButton = new GameObject("OpenChest", typeof(RectTransform), typeof(Image), typeof(Button));
            chestButton.transform.SetParent(_canvas.transform, false);
            RectTransform cr = (RectTransform)chestButton.transform;
            cr.anchorMin = new Vector2(1, 1);
            cr.anchorMax = new Vector2(1, 1);
            cr.pivot = new Vector2(1, 1);
            cr.anchoredPosition = mobile ? new Vector2(-12, -218) : new Vector2(-16, -280);
            cr.sizeDelta = ButtonSize(mobile);
            chestButton.GetComponent<Image>().color = new Color(0.3f, 0.22f, 0.08f, 0.95f);
            _openChestButton = chestButton.GetComponent<Button>();
            _openChestButton.onClick.AddListener(OpenEventChest);
            _openChestLabel = CreateText("Label", cr, ButtonFontSize(mobile), TextAnchor.MiddleCenter, Calm);
            Stretch(_openChestLabel.rectTransform, ButtonLabelInset);
            _openChestButton.gameObject.SetActive(false);
            _panel.SetActive(false);
        }

        /// <summary>Отступ текста от края панели: по нему считается ширина строки.</summary>
        public const float PanelPadding = 8f;

        /// <summary>
        /// Размер панели мировых событий. Вынесен сюда, чтобы проба раскладки
        /// могла померить, помещается ли текст на мобильном альбомном экране:
        /// у панели включено обрезание, и не влезший хвост игрок не увидит.
        /// </summary>
        public static Vector2 PanelSize(bool mobile)
        {
            return mobile ? new Vector2(300f, 118f) : new Vector2(360f, 150f);
        }

        public static int PanelFontSize(bool mobile)
        {
            return mobile ? 12 : 14;
        }

        /// <summary>Предел роста панели: дальше текст обрезается, но обзор цел.</summary>
        public static float PanelMaxHeight(bool mobile)
        {
            return mobile ? 288f : 324f;
        }

        /// <summary>
        /// Кнопки под панелью шириной с саму панель. В прежние 220/180 ед. не
        /// влезала подпись «ВСКРЫТИЕ 100% · ОСПАРИВАЕТСЯ» (около 233/200 ед.
        /// вложенным шрифтом): она переносилась, и обрезание съедало вторую
        /// строку. Высота прежняя, так что стопка под панелью не выросла.
        /// </summary>
        public static Vector2 ButtonSize(bool mobile)
        {
            return new Vector2(PanelSize(mobile).x, mobile ? 30f : 34f);
        }

        /// <summary>Кегль подписей кнопок «Искать следы» и вскрытия тайника.</summary>
        public static int ButtonFontSize(bool mobile)
        {
            return mobile ? 12 : 14;
        }

        /// <summary>Отступ подписи от краёв кнопки.</summary>
        public const float ButtonLabelInset = 4f;

        private static Text CreateText(string name, RectTransform parent, int size, TextAnchor anchor, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.alignment = anchor;
            text.color = color;
            text.supportRichText = true;
            return text;
        }

        private static void Stretch(RectTransform rect, float pad)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(pad, pad);
            rect.offsetMax = new Vector2(-pad, -pad);
        }
    }
}
