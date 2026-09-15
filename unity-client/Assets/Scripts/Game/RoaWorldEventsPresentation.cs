using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Компактная панель мировых событий в HUD: аванпосты Сердцевины (владелец,
    /// состояние события, отсчёт, прогресс, гарнизон), публичное событие
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
        private Canvas _canvas;
        private GameObject _panel;
        private Text _text;
        private Button _tracksButton;
        private Text _tracksLabel;
        private Button _openChestButton;
        private Text _openChestLabel;
        private JObject _territory;
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
            RequestTerritory();
        }

        private void OnDestroy() { Unsubscribe(); }

        private void Subscribe()
        {
            if (_socket == null) return;
            _socket.OnTerritoryOutpostState += ApplyTerritory;
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
            _socket.OnTerritoryOutpostState -= ApplyTerritory;
            _socket.OnPublicEventState -= ApplyPublicEvent;
            _socket.OnWorldBossState -= ApplyWorldBoss;
            _socket.OnPveAreaState -= ApplyPveArea;
            _socket.OnLabHallState -= ApplyLabHall;
            _socket.OnJoined -= HandleJoined;
            _socket.OnServerWorldTransfer -= HandleTransfer;
        }

        private void HandleJoined(JoinAck _) { ApplyJoinedWorldState(); RequestTerritory(); }
        private void HandleTransfer(JObject _) { ApplyJoinedWorldState(); }

        /// <summary>Снимок комнаты при входе несёт PvE/событие/босса; сброс при смене локации.</summary>
        private void ApplyJoinedWorldState()
        {
            JObject world = _socket?.Session?.WorldState;
            _publicEvent = world?["publicEvent"] as JObject;
            _labHall = world?["labHall"] as JObject;
            _worldBoss = world?["worldBoss"] as JObject;
            _pveArea = world?["pveArea"] as JObject;
            _receivedAt = Time.realtimeSinceStartupAsDouble;
            Refresh();
        }

        private void RequestTerritory()
        {
            if (_socket == null || _socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            RoaTerritoryNet.RequestTerritoryState(_socket, ack =>
            {
                if (!(ack?["territory"] is JObject territory)) return;
                // Имена фракций для подписей приходят с каталогом территории.
                var names = new JObject();
                foreach (JToken row in ack["catalog"]?["factions"] as JArray ?? new JArray())
                {
                    string id = row["id"]?.ToString();
                    if (!string.IsNullOrEmpty(id)) names[id] = row["displayName"]?.ToString() ?? id;
                }
                territory["factionNames"] = names;
                ApplyTerritory(territory);
            });
        }

        private void ApplyTerritory(JObject payload)
        {
            JObject next = payload?["territory"] as JObject ?? payload;
            if (next != null && next["factionNames"] == null && _territory?["factionNames"] is JObject names) next["factionNames"] = names;
            _territory = next;
            Refresh();
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
            string outposts = DescribeOutposts(_territory, locationId);
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
                && _socket.Session != null && !(_socket.Session.Self?["onGlobalMap"]?.Value<bool>() ?? false);
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
            }
            if (payload["guardShielded"]?.Value<bool>() == true) sb.Append(" · МАШИНА ПОД ПИТАНИЕМ");
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
            int rejoin = payload["rejoinInSeconds"]?.Value<int>() ?? 0;
            if (rejoin > 0) sb.Append("\nВернуться можно через ").Append(Math.Max(0, rejoin - elapsedSeconds)).Append(" с");
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
            if (hazards > 0) sb.Append(" · горящих секторов: ").Append(hazards);
            if (payload["pulseTelegraph"]?.Value<bool>() == true) sb.Append("\nИМПУЛЬС! Отойдите на ").Append(payload["pulseRadius"]?.Value<int>() ?? 9).Append(" м");
            else sb.Append("\nИмпульс через ").Append(Math.Max(0, (payload["pulseInSeconds"]?.Value<int>() ?? 0) - elapsedSeconds)).Append(" с");
            return sb.ToString();
        }

        public static string DescribePveArea(JObject payload, string roomId, int elapsedSeconds)
        {
            if (payload == null || string.IsNullOrEmpty(roomId) || payload["roomId"]?.ToString() != roomId) return string.Empty;
            string name = payload["displayName"]?.ToString() ?? "PvE-область";
            var sb = new StringBuilder(name.ToUpperInvariant()).Append(" · личная встреча · PvP отключён");
            int alive = payload["alive"]?.Value<int>() ?? 0;
            sb.Append("\nВрагов рядом: ").Append(alive);
            int calm = Math.Max(0, (payload["calmSeconds"]?.Value<int>() ?? 0) - elapsedSeconds);
            if (calm > 0) sb.Append(" · затишье ").Append(calm).Append(" с");
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
            _tracksLabel = CreateText("Label", br, mobile ? 12 : 14, TextAnchor.MiddleCenter, Calm);
            Stretch(_tracksLabel.rectTransform, 4);
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
            _openChestLabel = CreateText("Label", cr, mobile ? 12 : 14, TextAnchor.MiddleCenter, Calm);
            Stretch(_openChestLabel.rectTransform, 4);
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

        public static Vector2 ButtonSize(bool mobile)
        {
            return mobile ? new Vector2(180f, 30f) : new Vector2(220f, 34f);
        }

        private static Text CreateText(string name, RectTransform parent, int size, TextAnchor anchor, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
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
