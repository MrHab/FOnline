using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Public clan-base management backed exclusively by authoritative server state.
    /// </summary>
    public sealed partial class RoaPipboyCanvas
    {
        private JObject _kromkaClanState;
        private bool _kromkaClanSubscribed;
        private float _nextKromkaClanRequestAt;

        private void AddKromkaClanBaseRows(string clanName)
        {
            EnsureKromkaClanSubscription();
            RequestKromkaClanStateIfDue();
            AddSectionTitle(_clanRows, _clanList, "СТРАТЕГИЧЕСКИЕ БАЗЫ КРОМКИ");
            if (_kromkaClanState == null)
            {
                AddTextCard(_clanRows, _clanList, "Сводка запрашивается", "Радиосеть сверяет владельцев, окна осад и долги по содержанию.");
                return;
            }

            JObject ownClan = _kromkaClanState["clan"] as JObject;
            string ownClanId = ownClan?["id"]?.ToString() ?? string.Empty;
            string ownBaseId = ownClan?["baseId"]?.ToString() ?? string.Empty;
            JObject storage = ownClan?["storage"] as JObject ?? new JObject();
            AddTextCard(_clanRows, _clanList,
                string.IsNullOrEmpty(ownClanId) ? "Нет стратегического владения" : "Клановый склад",
                string.IsNullOrEmpty(ownClanId)
                    ? "Создайте клан или вступите в существующий. Один клан может удерживать только одну базу."
                    : FormatKromkaObject(storage, "Склад пуст"));

            if (!string.IsNullOrEmpty(ownClanId)) AddClanWarehouseActions(storage);
            AddKromkaSiegeRows(ownClanId, ownBaseId);

            foreach (JToken token in _kromkaClanState["bases"] as JArray ?? new JArray())
            {
                if (!(token is JObject profile)) continue;
                JObject runtime = profile["runtime"] as JObject ?? new JObject();
                string baseId = profile["id"]?.ToString() ?? string.Empty;
                string ownerClanId = runtime["ownerClanId"]?.ToString() ?? string.Empty;
                bool own = !string.IsNullOrEmpty(ownClanId) && ownerClanId == ownClanId;
                string windows = string.Join(" · ", profile["siegeWindowsUtc"]?.ToObject<string[]>() ?? Array.Empty<string>());
                JObject benefitStatus = profile["benefitStatus"] as JObject ?? new JObject();
                JObject weeklyGrant = profile["weeklyGrant"] as JObject ?? new JObject();
                long nextWeeklyAt = benefitStatus["nextWeeklyBenefitAt"]?.Value<long>() ?? 0L;
                bool weeklyReady = benefitStatus["weeklyReady"]?.Value<bool>() == true;
                string body = "Владелец: " + (profile["ownerName"]?.ToString() ?? "Нейтральный гарнизон")
                    + "\nРегион: " + HumanObjective(profile["macroRegion"]?.ToString())
                    + "\nПольза: " + (profile["benefitText"]?.ToString() ?? "—")
                    + "\nНедельная выдача: " + FormatKromkaObject(weeklyGrant, "нет")
                    + (own ? " · " + (weeklyReady ? "готова" : "через " + FormatBenefitCooldown(nextWeeklyAt)) : string.Empty)
                    + "\nОкна осады UTC: " + windows
                    + "\nСодержание: " + FormatKromkaObject(profile["upkeep"] as JObject, "нет")
                    + "\nМодули: " + FormatKromkaObject(runtime["modules"] as JObject, "нет");
                var actions = new List<(string, Action)>();
                if (own)
                    actions.Add(("ОПЛАТИТЬ СОДЕРЖАНИЕ", () => SendKromkaClanAction("payUpkeep", baseId)));
                if (own && profile["benefit"]?["protectedRally"]?.Value<bool>() == true)
                    actions.Add(("ЗАЩИЩЁННЫЙ СБОР", () => SendKromkaClanAction("protectedRally", baseId)));
                AddTextCard(_clanRows, _clanList, (own ? "★ " : string.Empty) + (profile["displayName"]?.ToString() ?? baseId), body, actions);
                if (own)
                {
                    AddClanBenefitOrderRows(profile, benefitStatus);
                    AddClanModuleRows(baseId, runtime["modules"] as JObject ?? new JObject());
                }
            }
        }

        private void EnsureKromkaClanSubscription()
        {
            if (_kromkaClanSubscribed || Socket == null) return;
            Socket.OnKromkaClanState += ApplyKromkaClanState;
            Socket.OnKromkaSiegeState += ApplyKromkaSiegeEnvelope;
            _kromkaClanSubscribed = true;
        }

        private void RequestKromkaClanStateIfDue()
        {
            if (Socket == null || Time.unscaledTime < _nextKromkaClanRequestAt) return;
            _nextKromkaClanRequestAt = Time.unscaledTime + 5f;
            Socket.EmitWithAck("requestKromkaClanState", new Dictionary<string, object>(), ack =>
            {
                JObject state = ack?["state"] as JObject;
                if (state != null) ApplyKromkaClanState(state);
            });
        }

        private void ApplyKromkaClanState(JObject state)
        {
            _kromkaClanState = state;
            _refreshAt = 0f;
        }

        private void ApplyKromkaSiegeEnvelope(JObject payload)
        {
            JObject state = payload?["state"] as JObject;
            if (state != null)
            {
                if (_kromkaClanState == null) _kromkaClanState = new JObject();
                _kromkaClanState["sieges"] = state;
            }
            else if (payload?["event"] is JObject changed && _kromkaClanState?["sieges"] is JObject sieges)
            {
                JArray events = sieges["events"] as JArray ?? new JArray();
                string id = changed["id"]?.ToString() ?? string.Empty;
                for (int i = events.Count - 1; i >= 0; i--)
                    if (events[i]?["id"]?.ToString() == id) events.RemoveAt(i);
                events.Add(changed); sieges["events"] = events;
            }
            _refreshAt = 0f;
        }

        private void AddKromkaSiegeRows(string ownClanId, string ownBaseId)
        {
            JObject sieges = _kromkaClanState?["sieges"] as JObject;
            if (sieges == null) return;
            AddHeading(_clanRows, _clanList, "КАЛЕНДАРЬ ОСАД");
            int shown = 0;
            foreach (JToken token in sieges["calendar"] as JArray ?? new JArray())
            {
                if (!(token is JObject window) || shown++ >= 8) continue;
                string baseId = window["baseId"]?.ToString() ?? string.Empty;
                long startAt = window["startAt"]?.Value<long>() ?? 0;
                string ownerClanId = window["ownerClanId"]?.ToString() ?? string.Empty;
                string status = window["status"]?.ToString() ?? "open";
                string body = "Владелец: " + (window["ownerName"]?.ToString() ?? "Нейтральный гарнизон")
                    + "\nНачало: " + FormatSiegeTime(startAt) + " UTC"
                    + "\nСтатус: " + HumanObjective(status)
                    + " · претендентов: " + (window["challengerCount"]?.Value<int>() ?? 0);
                var actions = new List<(string, Action)>();
                if ((status == "open" || status == "scheduled") && !string.IsNullOrEmpty(ownClanId) && string.IsNullOrEmpty(ownBaseId)
                    && ownerClanId != ownClanId)
                    actions.Add(("ОБЪЯВИТЬ ВЫЗОВ", () => SendKromkaSiegeAction("challenge", window["eventId"]?.ToString(), baseId, startAt)));
                AddTextCard(_clanRows, _clanList, window["displayName"]?.ToString() ?? baseId, body, actions);
            }

            foreach (JToken token in sieges["events"] as JArray ?? new JArray())
            {
                if (!(token is JObject siege)) continue;
                string eventId = siege["id"]?.ToString() ?? string.Empty;
                string status = siege["status"]?.ToString() ?? "scheduled";
                string phase = siege["phase"]?.ToString() ?? "waiting";
                JObject rosters = siege["rosters"] as JObject ?? new JObject();
                bool side = siege["defenderClanId"]?.ToString() == ownClanId
                    || (siege["challengers"] as JArray ?? new JArray()).Any(row => row?["clanId"]?.ToString() == ownClanId);
                string characterId = Socket?.Session?.CharacterId ?? string.Empty;
                bool registered = (rosters[ownClanId] as JArray ?? new JArray()).Any(row => row?.ToString() == characterId);
                long phaseEndsAt = siege["phaseEndsAt"]?.Value<long>() ?? siege["startAt"]?.Value<long>() ?? 0;
                string body = "Защита: " + (siege["defenderName"]?.ToString() ?? "—")
                    + "\nФаза: " + HumanObjective(phase) + " · осталось " + RemainingSiegeTime(phaseEndsAt)
                    + "\nСостав заблокирован: " + (siege["rosterLocked"]?.Value<bool>() == true ? "да" : "нет")
                    + "\nВорота: " + (siege["gateHp"]?.Value<int>() ?? 0) + "/" + (siege["gateMaxHp"]?.Value<int>() ?? 0);
                var actions = new List<(string, Action)>();
                if (side && status == "scheduled" && siege["rosterLocked"]?.Value<bool>() != true)
                    actions.Add((registered ? "СНЯТЬСЯ" : "ЗАПИСАТЬСЯ", () => SendKromkaSiegeAction(registered ? "unregisterSelf" : "registerSelf", eventId)));
                if (registered && status == "active") actions.Add(("ВОЙТИ В ОСАДУ", () => SendKromkaSiegeAction("enter", eventId)));
                AddTextCard(_clanRows, _clanList, "ОСАДА: " + (siege["baseId"]?.ToString() ?? eventId), body, actions);
                if (status == "resolved")
                    AddTextCard(_clanRows, _clanList, "РЕЗУЛЬТАТ", "Победитель: " + (siege["winnerClanId"]?.ToString() ?? "—")
                        + "\nИтог: " + HumanObjective(siege["result"]?.ToString())
                        + "\nЛичные ячейки эвакуированы: " + (siege["evacuatedPersonalStorage"]?.Value<bool>() == true ? "да" : "нет"));
            }
        }

        private void SendKromkaSiegeAction(string action, string eventId, string baseId = "", long startAt = 0)
        {
            if (Socket == null) return;
            Socket.EmitWithAck("kromkaSiegeAction", new Dictionary<string, object>
            {
                ["action"] = action, ["eventId"] = eventId ?? string.Empty, ["baseId"] = baseId ?? string.Empty, ["startAt"] = startAt
            }, ack =>
            {
                Socket.ApplyGameplayAck(ack);
                if (ack?["state"] is JObject state) ApplyKromkaSiegeEnvelope(new JObject { ["state"] = state });
                _nextKromkaClanRequestAt = 0f;
            });
        }

        private static string FormatSiegeTime(long milliseconds)
        {
            if (milliseconds <= 0) return "—";
            return DateTimeOffset.FromUnixTimeMilliseconds(milliseconds).UtcDateTime.ToString("dd.MM HH:mm");
        }

        private static string RemainingSiegeTime(long milliseconds)
        {
            long seconds = Math.Max(0, (milliseconds - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 1000);
            return (seconds / 60).ToString("00") + ":" + (seconds % 60).ToString("00");
        }

        private void AddClanWarehouseActions(JObject storage)
        {
            string[] depositIds = { "scrap", "electronics", "wood", "silver", "oil", "chemicals", "medicine", "ammoParts" };
            foreach (string itemId in depositIds)
            {
                int available = Pipboy?.InventoryQty(itemId) ?? 0;
                if (available <= 0) continue;
                AddTextCard(_clanRows, _clanList, "Внести: " + HumanObjective(itemId), "В сумке: " + available,
                    new List<(string, Action)> { ("ВНЕСТИ 1", () => SendKromkaClanItemAction("deposit", itemId)) });
            }
            foreach (JProperty item in storage.Properties())
            {
                if (item.Value.Value<int>() <= 0) continue;
                string itemId = item.Name;
                AddTextCard(_clanRows, _clanList, "Выдать: " + HumanObjective(itemId), "На складе: " + item.Value.Value<int>(),
                    new List<(string, Action)> { ("ВЗЯТЬ 1", () => SendKromkaClanItemAction("withdraw", itemId)) });
            }
        }

        private void AddClanModuleRows(string baseId, JObject installed)
        {
            AddHeading(_clanRows, _clanList, "МОДУЛИ ВАШЕЙ БАЗЫ");
            foreach (JToken socketToken in _kromkaClanState["moduleSockets"] as JArray ?? new JArray())
            {
                string socketId = socketToken?.ToString() ?? string.Empty;
                string installedId = installed[socketId]?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(installedId))
                {
                    AddTextCard(_clanRows, _clanList, HumanObjective(socketId), "Установлен: " + HumanObjective(installedId));
                    continue;
                }
                var actions = new List<(string, Action)>();
                foreach (JToken moduleToken in _kromkaClanState["modules"] as JArray ?? new JArray())
                {
                    if (!(moduleToken is JObject module)) continue;
                    JArray allowed = module["allowedSockets"] as JArray;
                    if (allowed == null || !Contains(allowed, socketId)) continue;
                    string moduleId = module["id"]?.ToString() ?? string.Empty;
                    string label = module["displayName"]?.ToString() ?? HumanObjective(moduleId);
                    actions.Add((label, () => SendKromkaClanModuleAction(baseId, socketId, moduleId)));
                }
                AddTextCard(_clanRows, _clanList, HumanObjective(socketId), "Свободная фиксированная позиция", actions);
            }
        }

        private void SendKromkaClanAction(string action, string baseId)
        {
            SendKromkaClanPayload(new Dictionary<string, object> { ["action"] = action, ["baseId"] = baseId });
        }

        private void SendKromkaClanItemAction(string action, string itemId)
        {
            SendKromkaClanPayload(new Dictionary<string, object> { ["action"] = action, ["itemId"] = itemId, ["qty"] = 1 });
        }

        private void SendKromkaClanModuleAction(string baseId, string socketId, string moduleId)
        {
            SendKromkaClanPayload(new Dictionary<string, object>
            {
                ["action"] = "installModule", ["baseId"] = baseId, ["socketId"] = socketId, ["moduleId"] = moduleId
            });
        }

        private void AddClanBenefitOrderRows(JObject profile, JObject benefitStatus)
        {
            JArray authoredOrders = profile?["benefitOrders"] as JArray ?? new JArray();
            JArray states = benefitStatus?["orders"] as JArray ?? new JArray();
            if (authoredOrders.Count == 0) return;
            AddHeading(_clanRows, _clanList, "ОСОБЫЕ ЗАКАЗЫ ВЛАДЕНИЯ");
            string baseId = profile?["id"]?.ToString() ?? string.Empty;
            foreach (JToken token in states)
            {
                if (!(token is JObject order)) continue;
                string orderId = order["id"]?.ToString() ?? string.Empty;
                bool ready = order["ready"]?.Value<bool>() == true;
                long readyAt = order["readyAt"]?.Value<long>() ?? 0L;
                string body = (order["description"]?.ToString() ?? string.Empty)
                    + "\nНужно: " + FormatKromkaObject(order["cost"] as JObject, "нет")
                    + "\nВ клановый склад: " + FormatKromkaObject(order["reward"] as JObject, "нет")
                    + "\nСтатус: " + (ready ? "готов — подойдите к базе" : "повтор через " + FormatBenefitCooldown(readyAt));
                var actions = new List<(string, Action)>();
                if (ready) actions.Add(("ВЫПОЛНИТЬ НА БАЗЕ", () => SendKromkaClanOrderAction(baseId, orderId)));
                AddTextCard(_clanRows, _clanList, order["displayName"]?.ToString() ?? HumanObjective(orderId), body, actions);
            }
        }

        private void SendKromkaClanOrderAction(string baseId, string orderId)
        {
            SendKromkaClanPayload(new Dictionary<string, object>
            {
                ["action"] = "completeBenefitOrder", ["baseId"] = baseId, ["orderId"] = orderId
            });
        }

        private static string FormatBenefitCooldown(long readyAt)
        {
            long seconds = Math.Max(0, (readyAt - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 1000);
            if (seconds <= 0) return "готово";
            long hours = seconds / 3600;
            long minutes = (seconds % 3600) / 60;
            return hours > 0 ? hours + " ч " + minutes + " мин" : Math.Max(1, minutes) + " мин";
        }

        private void SendKromkaClanPayload(Dictionary<string, object> payload)
        {
            if (Socket == null) return;
            Socket.EmitWithAck("kromkaClanAction", payload, ack =>
            {
                Socket.ApplyGameplayAck(ack);
                JObject state = ack?["state"] as JObject;
                if (state != null) ApplyKromkaClanState(state);
                _nextKromkaClanRequestAt = 0f;
            });
        }

        private static string FormatKromkaObject(JObject value, string empty)
        {
            if (value == null || !value.HasValues) return empty;
            var parts = new List<string>();
            foreach (JProperty property in value.Properties()) parts.Add(property.Name + " ×" + property.Value);
            return string.Join(", ", parts);
        }

        private static string HumanObjective(string value)
        {
            string id = (value ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(id)) return "—";
            switch (id)
            {
                case "north": return "Север Кромки";
                case "center": return "Центр Кромки";
                case "south": return "Юг Кромки";
                case "open": return "открыто";
                case "scheduled": return "назначено";
                case "waiting": return "ожидание";
                case "preparation": return "подготовка";
                case "assault": return "штурм";
                case "active": return "идёт бой";
                case "resolved": return "завершено";
                case "cancelled": return "отменено";
                case "gate": return "Ворота";
                case "utility": return "Хозяйственный узел";
                case "defense": return "Оборонительный узел";
                case "production": return "Производственный узел";
                case "storage": return "Складской узел";
            }
            string item = ItemName(id);
            if (!string.Equals(item, id, StringComparison.OrdinalIgnoreCase)) return item;
            return id.Replace('_', ' ');
        }
    }
}
