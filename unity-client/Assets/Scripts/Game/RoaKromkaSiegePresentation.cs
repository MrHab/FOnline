using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>In-world objectives, side colours, timer and result for the isolated 20x20 siege room.</summary>
    [DisallowMultipleComponent]
    public sealed class RoaKromkaSiegePresentation : MonoBehaviour
    {
        private static readonly Color Attack = new Color(0.95f, 0.48f, 0.16f, 1f);
        private static readonly Color Defend = new Color(0.24f, 0.64f, 1f, 1f);
        private static readonly Color Neutral = new Color(0.88f, 0.82f, 0.54f, 1f);
        private readonly Dictionary<string, GameObject> _objectives = new Dictionary<string, GameObject>();
        private RoaGameBootstrap _bootstrap;
        private RoaSocketClient _socket;
        private JObject _event;
        private string _clanId = string.Empty;
        private Canvas _canvas;
        private GameObject _panel;
        private Text _status;
        private Button _actionButton;
        private Text _actionLabel;
        private string _nearAction = string.Empty;
        private string _nearObjective = string.Empty;

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket)
        {
            Unsubscribe(); _bootstrap = bootstrap; _socket = socket;
            BuildUi(); BuildWorldMarkers(); Subscribe(); RequestState();
        }

        private void OnDestroy() { Unsubscribe(); }

        private void Subscribe()
        {
            if (_socket == null) return;
            _socket.OnKromkaSiegeState += ApplyEnvelope;
            _socket.OnJoined += HandleJoined;
            _socket.OnServerWorldTransfer += HandleTransfer;
        }

        private void Unsubscribe()
        {
            if (_socket == null) return;
            _socket.OnKromkaSiegeState -= ApplyEnvelope;
            _socket.OnJoined -= HandleJoined;
            _socket.OnServerWorldTransfer -= HandleTransfer;
        }

        private void HandleJoined(JoinAck _) { RequestState(); RefreshVisibility(); }
        private void HandleTransfer(JObject _) { RequestState(); RefreshVisibility(); }

        private void RequestState()
        {
            if (_socket == null || _socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            _socket.EmitWithAck("requestKromkaSiegeState", new Dictionary<string, object>(), ack =>
            {
                if (ack?["state"] is JObject state) ApplyState(state);
            });
        }

        private void ApplyEnvelope(JObject payload)
        {
            if (payload?["state"] is JObject state) ApplyState(state);
            if (payload?["event"] is JObject changed && EventMatchesRoom(changed)) _event = changed;
            RefreshVisibility();
        }

        private void ApplyState(JObject state)
        {
            _clanId = state?["clanId"]?.ToString() ?? string.Empty;
            _event = null;
            foreach (JToken token in state?["events"] as JArray ?? new JArray())
                if (token is JObject row && EventMatchesRoom(row)) { _event = row; break; }
            RefreshVisibility();
        }

        private bool EventMatchesRoom(JObject row)
        {
            string roomId = _socket?.Session?.RoomId ?? string.Empty;
            return !string.IsNullOrEmpty(roomId) && row?["roomId"]?.ToString() == roomId;
        }

        private void Update()
        {
            bool inside = _socket?.Session?.LocationId == "clanSiege" && _event != null;
            if (!inside) { if (_panel != null) _panel.SetActive(false); SetMarkers(false); return; }
            if (_panel != null) _panel.SetActive(true);
            SetMarkers(true); UpdateStatus(); UpdateNearbyAction();
            if (!string.IsNullOrEmpty(_nearAction) && Input.GetKeyDown(KeyCode.F)) SendObjective();
        }

        private void RefreshVisibility()
        {
            bool inside = _socket?.Session?.LocationId == "clanSiege" && _event != null;
            if (_panel != null) _panel.SetActive(inside);
            SetMarkers(inside);
        }

        private void UpdateStatus()
        {
            string status = _event?["status"]?.ToString() ?? string.Empty;
            if (status == "resolved" || status == "cancelled")
            {
                _status.text = "ОСАДА ЗАВЕРШЕНА\nПобедитель: " + (_event["winnerClanId"]?.ToString() ?? "—")
                    + " · " + Human(_event["result"]?.ToString());
                return;
            }
            string phase = _event?["phase"]?.ToString() ?? "waiting";
            long ends = _event?["phaseEndsAt"]?.Value<long>() ?? 0;
            long seconds = Math.Max(0, (ends - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 1000);
            string objective = phase == "relay" ? "Захватите 2 из 3 передатчиков"
                : phase == "breach" ? "Отключите ворота"
                : phase == "core" ? "Удерживайте ядро 3 минуты"
                : "Ожидание синхронизации";
            _status.text = "ОСАДА · " + Human(phase).ToUpperInvariant() + " · " + (seconds / 60).ToString("00") + ":" + (seconds % 60).ToString("00")
                + "\n" + objective;
        }

        private void UpdateNearbyAction()
        {
            _nearAction = string.Empty; _nearObjective = string.Empty;
            string phase = _event?["phase"]?.ToString() ?? string.Empty;
            string attacker = _event?["qualifiedAttackerClanId"]?.ToString() ?? string.Empty;
            string defender = _event?["defenderClanId"]?.ToString() ?? string.Empty;
            if (phase == "relay" && IsChallenger()) FindNearest(new[] { "relay_a", "relay_b", "relay_c" }, "captureRelay");
            else if (phase == "breach" && _clanId == attacker) FindNearest(new[] { "siege_gate" }, "damageGate");
            else if (phase == "core" && _clanId == attacker) FindNearest(new[] { "command_core" }, "captureCore");
            else if (phase == "core" && _clanId == defender) FindNearest(new[] { "command_core" }, "contestCore");
            bool visible = !string.IsNullOrEmpty(_nearAction) && _event?["status"]?.ToString() == "active";
            _actionButton.gameObject.SetActive(visible);
            if (visible) _actionLabel.text = ActionLabel(_nearAction) + " [F]";
        }

        private bool IsChallenger()
        {
            foreach (JToken row in _event?["challengers"] as JArray ?? new JArray())
                if (row?["clanId"]?.ToString() == _clanId) return true;
            return false;
        }

        private void FindNearest(IEnumerable<string> ids, string action)
        {
            Transform player = _bootstrap?.PlayerView?.transform;
            if (player == null) return;
            float best = 3.3f;
            foreach (string id in ids)
            {
                if (!_objectives.TryGetValue(id, out GameObject marker)) continue;
                float distance = Vector3.Distance(player.position, marker.transform.position);
                if (distance > best) continue;
                best = distance; _nearAction = action; _nearObjective = id.StartsWith("relay_") ? id : string.Empty;
            }
        }

        private void SendObjective()
        {
            if (_socket == null || _event == null || string.IsNullOrEmpty(_nearAction)) return;
            string action = _nearAction; string objectiveId = _nearObjective;
            _socket.EmitWithAck("kromkaSiegeAction", new Dictionary<string, object>
            {
                ["action"] = action, ["objectiveId"] = objectiveId, ["eventId"] = _event["id"]?.ToString() ?? string.Empty
            }, ack =>
            {
                if (ack?["state"] is JObject state) ApplyState(state);
                if (ack?["ok"]?.Value<bool>() != true && _status != null) _status.text = ack?["error"]?.ToString() ?? "Командное ядро отклонило действие.";
            });
        }

        private void BuildWorldMarkers()
        {
            CreateObjective("relay_a", -17, -13, Attack);
            CreateObjective("relay_b", 0, -9, Attack);
            CreateObjective("relay_c", 17, -13, Attack);
            CreateObjective("siege_gate", 0, 3, Neutral);
            CreateObjective("command_core", 0, 19, Defend);
            CreateRing("AttackerZone", 0, -30, 7f, Attack);
            CreateRing("DefenderZone", 0, 31, 7f, Defend);
            SetMarkers(false);
        }

        private void CreateObjective(string id, float x, float z, Color color)
        {
            GameObject marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            marker.name = "SiegeObjective:" + id;
            marker.transform.SetParent(transform, false);
            marker.transform.position = RoaCoords.ToUnity(x, 0.1f, z);
            marker.transform.localScale = new Vector3(0.9f, 0.06f, 0.9f);
            Collider collider = marker.GetComponent<Collider>(); if (collider != null) Destroy(collider);
            Renderer renderer = marker.GetComponent<Renderer>();
            Material material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            material.EnableKeyword("_EMISSION"); if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", color * 1.8f);
            renderer.sharedMaterial = material; _objectives[id] = marker;
        }

        private void CreateRing(string id, float x, float z, float radius, Color color)
        {
            GameObject root = new GameObject(id); root.transform.SetParent(transform, false); root.transform.position = RoaCoords.ToUnity(x, 0.08f, z);
            var line = root.AddComponent<LineRenderer>(); line.useWorldSpace = false; line.loop = true; line.positionCount = 49;
            line.startWidth = line.endWidth = 0.12f; line.material = new Material(Shader.Find("Sprites/Default")); line.startColor = line.endColor = color;
            for (int i = 0; i < line.positionCount; i++) { float a = i / (float)(line.positionCount - 1) * Mathf.PI * 2f; line.SetPosition(i, new Vector3(Mathf.Cos(a) * radius, 0, Mathf.Sin(a) * radius)); }
            _objectives[id] = root;
        }

        private void SetMarkers(bool active) { foreach (GameObject marker in _objectives.Values) if (marker != null) marker.SetActive(active); }

        private void BuildUi()
        {
            _canvas = new GameObject("KromkaSiegeCanvas", typeof(RectTransform)).AddComponent<Canvas>();
            _canvas.transform.SetParent(transform, false); _canvas.renderMode = RenderMode.ScreenSpaceOverlay; _canvas.sortingOrder = 470;
            _canvas.gameObject.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            _canvas.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1280, 720);
            _canvas.gameObject.AddComponent<GraphicRaycaster>();
            _panel = new GameObject("SiegeStatus", typeof(RectTransform), typeof(Image)); _panel.transform.SetParent(_canvas.transform, false);
            RectTransform rect = (RectTransform)_panel.transform; rect.anchorMin = new Vector2(0.5f, 1); rect.anchorMax = new Vector2(0.5f, 1); rect.pivot = new Vector2(0.5f, 1); rect.anchoredPosition = new Vector2(0, -18); rect.sizeDelta = new Vector2(620, 70);
            _panel.GetComponent<Image>().color = new Color(0.035f, 0.055f, 0.045f, 0.94f);
            _status = CreateText("Status", rect, 17, TextAnchor.MiddleCenter, Neutral); Stretch(_status.rectTransform, 8);
            GameObject button = new GameObject("SiegeAction", typeof(RectTransform), typeof(Image), typeof(Button)); button.transform.SetParent(_canvas.transform, false);
            RectTransform br = (RectTransform)button.transform; br.anchorMin = new Vector2(0.5f, 0); br.anchorMax = new Vector2(0.5f, 0); br.pivot = new Vector2(0.5f, 0); br.anchoredPosition = new Vector2(0, 28); br.sizeDelta = new Vector2(320, 46);
            button.GetComponent<Image>().color = new Color(0.34f, 0.17f, 0.05f, 0.96f); _actionButton = button.GetComponent<Button>(); _actionButton.onClick.AddListener(SendObjective);
            _actionLabel = CreateText("Label", br, 15, TextAnchor.MiddleCenter, Neutral); Stretch(_actionLabel.rectTransform, 4); _actionButton.gameObject.SetActive(false); _panel.SetActive(false);
        }

        private static Text CreateText(string name, RectTransform parent, int size, TextAnchor anchor, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform)); go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>(); text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); text.fontSize = size; text.alignment = anchor; text.color = color; text.horizontalOverflow = HorizontalWrapMode.Wrap; text.verticalOverflow = VerticalWrapMode.Overflow; return text;
        }
        private static void Stretch(RectTransform rect, float pad) { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = new Vector2(pad, pad); rect.offsetMax = new Vector2(-pad, -pad); }
        private static string Human(string value) { return string.IsNullOrEmpty(value) ? "—" : value.Replace('_', ' '); }
        private static string ActionLabel(string action) { return action == "captureRelay" ? "ЗАХВАТИТЬ ПЕРЕДАТЧИК" : action == "damageGate" ? "ОТКЛЮЧИТЬ ВОРОТА" : action == "contestCore" ? "СБИТЬ ПЕРЕЗАПИСЬ" : "ЗАПУСТИТЬ ПЕРЕЗАПИСЬ"; }
    }
}
