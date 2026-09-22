using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Транспорт своего игрока. B (или кнопка «МОТО» на телефоне) вызывает надетый
    /// в слот «Транспорт» мотоцикл или отпускает его. Решает сервер (vehicleAction):
    /// его ответ и событие playerVehicle сажают персонажа в седло и ссаживают —
    /// в том числе когда спешил сам сервер (удар, оглушение, снятый транспорт).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaVehicleController : MonoBehaviour
    {
        public const KeyCode ToggleKey = KeyCode.B;
        private const float RequestTimeoutSeconds = 4f;

        private RoaSocketClient _socket;
        private RoaInventory _inventory;
        private RoaPlayerController _player;
        private RoaMovementFx _movementFx;
        private RoaAudio _audio;
        private Camera _camera;
        private RoaMovementFx.ActorStepState _wheelDust;
        private string _baseUrl = string.Empty;
        private bool _pending;
        private float _pendingSince;
        private Text _hint;
        private float _hintUntil;

        public bool Pending { get { return _pending; } }
        public string StatusText { get; private set; } = string.Empty;
        public bool Mounted { get { return _player != null && _player.Mounted; } }

        /// <summary>В слоте «Транспорт» лежит то, на чём можно ехать.</summary>
        public bool HasVehicleEquipped
        {
            get
            {
                if (_inventory == null) return false;
                IReadOnlyDictionary<string, string> slots = _inventory.EquipmentSlots;
                return slots != null && slots.TryGetValue(RoaVehicleCatalog.Slot, out string runtimeId)
                    && RoaVehicleCatalog.Contains(RoaArmorData.BaseId(runtimeId ?? string.Empty));
            }
        }

        public void Configure(RoaSocketClient socket, RoaInventory inventory, string baseUrl)
        {
            if (_socket != null) _socket.OnPlayerVehicle -= HandlePlayerVehicle;
            _socket = socket;
            _inventory = inventory;
            _baseUrl = baseUrl ?? string.Empty;
            if (_socket != null) _socket.OnPlayerVehicle += HandlePlayerVehicle;
        }

        /// <summary>Пыль из-под колеса и звук мотора своего транспорта.</summary>
        public void ConfigurePresentation(RoaMovementFx movementFx, RoaAudio audio, Camera camera)
        {
            _movementFx = movementFx;
            _audio = audio;
            _camera = camera;
        }

        public void SetPlayer(RoaPlayerController player)
        {
            if (_player == player) return;
            if (_player != null) _player.MountChanged -= SyncView;
            _player = player;
            if (_player != null) _player.MountChanged += SyncView;
            SyncView();
        }

        private void OnDestroy()
        {
            if (_socket != null) _socket.OnPlayerVehicle -= HandlePlayerVehicle;
            if (_player != null) _player.MountChanged -= SyncView;
        }

        private void Update()
        {
            if (_pending && Time.realtimeSinceStartup - _pendingSince > RequestTimeoutSeconds) _pending = false;
            if (Input.GetKeyDown(ToggleKey) && !RoaGameBootstrap.BlocksWorldHud) Toggle();
            if (_hint != null && _hint.gameObject.activeSelf && Time.realtimeSinceStartup >= _hintUntil)
                _hint.gameObject.SetActive(false);
            UpdatePresentation();
        }

        private void UpdatePresentation()
        {
            bool riding = _player != null && _player.Mounted;
            Vector3 ground = Vector3.zero;
            Vector3 velocity = Vector3.zero;
            if (_player != null)
            {
                ground = _player.View != null ? _player.View.transform.position : _player.transform.position;
                velocity = _player.Velocity;
            }
            float load = riding ? Mathf.InverseLerp(0f, Mathf.Max(1f, _player.VehicleSpeed), velocity.magnitude) : 0f;
            _audio?.SetEngine(riding, load, ground + Vector3.up * 0.5f);
            if (!riding || _movementFx == null) return;
            Vector3 observer = _camera != null ? _camera.transform.position : ground;
            _movementFx.TrackWheels(ref _wheelDust, ground, velocity, _player.Moving,
                !RoaGameBootstrap.BlocksWorldHud, observer);
        }

        /// <summary>Сесть на транспорт или слезть с него. Ответ сервера применяется целиком.</summary>
        public void Toggle()
        {
            if (_pending || _socket == null || _player == null
                || _socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            if (!_player.Mounted && !HasVehicleEquipped)
            {
                ShowStatus("Транспорта нет: наденьте мотоцикл в слот «Транспорт» (ПУТНИК → Персонаж).", 3f);
                return;
            }
            _pending = true;
            _pendingSince = Time.realtimeSinceStartup;
            _socket.EmitWithAck("vehicleAction", new Dictionary<string, object>
            {
                ["action"] = _player.Mounted ? "dismount" : "mount"
            }, ack =>
            {
                _pending = false;
                if (ack == null)
                {
                    ShowStatus("Сервер не ответил.", 2f);
                    return;
                }
                _socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    ShowStatus(ack["error"]?.ToString() ?? "Сервер отказал.", 2.6f);
                    return;
                }
                _player.ApplyVehicleState(ack["vehicle"] as JObject);
                if (_player.Mounted)
                    ShowStatus("W — газ, S — тормоз, руль — мышь или A/D. B — слезть.", 3.2f);
            });
        }

        private void HandlePlayerVehicle(JObject payload)
        {
            if (_player == null || payload == null) return;
            if (!string.Equals(payload["id"]?.ToString(), _socket?.Session?.Id, System.StringComparison.Ordinal)) return;
            bool wasMounted = _player.Mounted;
            _player.ApplyVehicleState(payload["vehicle"] as JObject);
            if (!wasMounted || _player.Mounted) return;
            string reason = payload["reason"]?.ToString() ?? string.Empty;
            if (reason == "hit") ShowStatus("Удар выбил вас из седла.", 2.4f);
            else if (reason == "stunned") ShowStatus("Оглушение сбросило вас с мотоцикла.", 2.4f);
            else if (reason == "unequipped") ShowStatus("Мотоцикл снят со слота «Транспорт».", 2.2f);
        }

        private void SyncView()
        {
            if (_player == null || _player.View == null) return;
            _player.View.SetVehicle(_baseUrl, _player.Mounted ? _player.VehicleItemId : string.Empty);
        }

        public void SetBaseUrl(string baseUrl)
        {
            _baseUrl = baseUrl ?? string.Empty;
        }

        private void ShowStatus(string text, float seconds)
        {
            EnsureHint();
            StatusText = text ?? string.Empty;
            _hint.text = StatusText;
            _hint.gameObject.SetActive(true);
            _hintUntil = Time.realtimeSinceStartup + Mathf.Max(0.5f, seconds);
        }

        private void EnsureHint()
        {
            if (_hint != null) return;
            var canvasObject = new GameObject("VehicleHintCanvas", typeof(RectTransform), typeof(Canvas),
                typeof(CanvasScaler));
            canvasObject.transform.SetParent(transform, false);
            Canvas canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 25;
            RoaUiScale.Apply(canvasObject.GetComponent<CanvasScaler>());
            var textObject = new GameObject("VehicleHint", typeof(RectTransform), typeof(Text), typeof(Outline));
            textObject.transform.SetParent(canvasObject.transform, false);
            RectTransform rect = (RectTransform)textObject.transform;
            rect.anchorMin = new Vector2(0.5f, 0f);
            rect.anchorMax = new Vector2(0.5f, 0f);
            rect.pivot = new Vector2(0.5f, 0f);
            // Над подсказкой болта (112): обе могут гореть одновременно.
            rect.anchoredPosition = new Vector2(0f, 150f);
            rect.sizeDelta = new Vector2(760f, 42f);
            _hint = textObject.GetComponent<Text>();
            _hint.font = RoaUiFont.Default;
            _hint.fontSize = 18;
            _hint.fontStyle = FontStyle.Bold;
            _hint.alignment = TextAnchor.MiddleCenter;
            _hint.color = new Color(0.94f, 0.88f, 0.70f, 1f);
            _hint.raycastTarget = false;
            Outline outline = textObject.GetComponent<Outline>();
            outline.effectColor = new Color(0f, 0f, 0f, 0.92f);
            outline.effectDistance = new Vector2(2f, -2f);
            _hint.gameObject.SetActive(false);
        }
    }
}
