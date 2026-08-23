using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Eight persistent quick-access slots. The browser client keeps these in the
    /// character save rather than join.self, so Unity reads and writes the same field
    /// through the authenticated character endpoint. Item actions themselves still
    /// use authoritative Socket.IO events through RoaInventory/RoaCombat.
    /// </summary>
    public sealed class RoaQuickbar : MonoBehaviour
    {
        public const int SlotCount = 8;

        private readonly string[] _slots = new string[SlotCount];
        private RoaAuthClient _auth;
        private RoaSocketClient _socket;
        private RoaInventory _inventory;
        private RoaCombat _combat;
        private RoaMobileControls _mobile;
        private RoaInteraction _interaction;
        private RoaSocketClient _subscribedSocket;

        private string _characterId = string.Empty;
        private string _leaseId = string.Empty;
        private string _assignItem = string.Empty;
        private string _status = string.Empty;
        private bool _clearMode;
        private bool _loaded;
        private bool _dirty;
        private bool _saving;
        private bool _worldActive;
        private bool _globalMapActive;
        private int _loadVersion;
        private GUIStyle _slotStyle;
        private GUIStyle _hintStyle;
        private bool _eHeld;
        private float _ePressedAt;
        private bool _radialOpen;
        private bool _assignRadial;
        private int _radialSelected = -1;
        private Vector2 _radialCenter;

        public const float RadialHoldSeconds = 0.21f;

        public bool IsMobileVisible
        {
            get { return (_worldActive || _globalMapActive) && _mobile != null && _mobile.ControlsEnabled; }
        }

        public IReadOnlyList<string> Slots { get { return _slots; } }
        public bool CanvasDriven { get; set; }
        public bool InputEnabled = true;
        public bool IsRadialOpen { get { return _radialOpen || _assignRadial; } }
        public string CanvasStatus { get { return _saving ? "Saving..." : _status; } }
        public bool CanvasVisible
        {
            get
            {
                if (!InputEnabled || (!_worldActive && !_globalMapActive)) return false;
                bool pipboyOpen = _combat != null && _combat.Pipboy != null && _combat.Pipboy.IsOpen;
                bool interactionOpen = _interaction != null && _interaction.IsPanelOpen;
                if (pipboyOpen || interactionOpen) return false;

                // Пустая панель не показывается — как #quickbar в web,
                // который остаётся display:none, пока нет ни одного слота.
                foreach (string slot in Slots)
                    if (!string.IsNullOrEmpty(slot)) return true;

                return false;
            }
        }

        public bool IsSlotActive(int index)
        {
            string item = index >= 0 && index < _slots.Length ? _slots[index] : string.Empty;
            return !string.IsNullOrEmpty(item) && _inventory != null && _inventory.IsEquipped(item);
        }

        public bool IsSlotAvailable(int index)
        {
            string item = index >= 0 && index < _slots.Length ? _slots[index] : string.Empty;
            return !string.IsNullOrEmpty(item) && _inventory != null && _inventory.OwnsItem(item);
        }

        public void TriggerSlot(int index)
        {
            if (index < 0 || index >= SlotCount) return;
            if (!string.IsNullOrEmpty(_assignItem)) Assign(index, _assignItem);
            else if (_clearMode) ClearSlot(index);
            else Activate(index);
        }

        public void Configure(RoaAuthClient auth, RoaSocketClient socket, RoaInventory inventory,
                              RoaCombat combat, RoaMobileControls mobile, RoaInteraction interaction)
        {
            _auth = auth;
            _inventory = inventory;
            _combat = combat;
            _mobile = mobile;
            _interaction = interaction;
            if (_interaction != null) _interaction.KeyboardInputEnabled = false;
            Subscribe(socket);
        }

        public void SetWorldActive(bool active)
        {
            _worldActive = active;
            if (active) _globalMapActive = false;
            if (!active)
            {
                _assignItem = string.Empty;
                _clearMode = false;
            }
        }

        public void SetGlobalMapActive(bool active)
        {
            _globalMapActive = active;
            if (active) _worldActive = false;
            ResetHeldRadial();
        }

        public void BeginAssign(string itemRuntimeId)
        {
            if (_inventory == null || !_inventory.IsQuickAssignable(itemRuntimeId))
            {
                _status = "Этот предмет нельзя назначить в быстрый слот.";
                return;
            }
            _assignItem = itemRuntimeId;
            _clearMode = false;
            _status = "Выберите слот 1–8.";
            if (_mobile == null || !_mobile.ControlsEnabled) OpenAssignRadial();
        }

        public bool Assign(int index, string itemRuntimeId)
        {
            if (!ValidIndex(index) || _inventory == null || !_inventory.IsQuickAssignable(itemRuntimeId))
                return false;
            if (_slots[index] == itemRuntimeId)
            {
                _assignItem = string.Empty;
                _status = "Предмет уже назначен в этот слот.";
                return false;
            }

            _slots[index] = itemRuntimeId;
            _assignItem = string.Empty;
            _clearMode = false;
            _status = "Быстрый слот " + (index + 1) + " обновлён.";
            MarkDirty();
            return true;
        }

        public bool ClearSlot(int index)
        {
            if (!ValidIndex(index) || string.IsNullOrEmpty(_slots[index])) return false;
            _slots[index] = string.Empty;
            _clearMode = false;
            _status = "Быстрый слот " + (index + 1) + " очищен.";
            MarkDirty();
            return true;
        }

        public bool Activate(int index)
        {
            if (!ValidIndex(index) || _inventory == null) return false;
            if (string.IsNullOrEmpty(_slots[index]))
            {
                _status = "Быстрый слот " + (index + 1) + " пуст.";
                return false;
            }
            bool activated = _inventory.ActivateQuickItem(_slots[index], _combat);
            if (!activated) _status = "Предмет в слоте сейчас недоступен.";
            return activated;
        }

        private void OnEnable()
        {
            if (_interaction != null) _interaction.KeyboardInputEnabled = false;
            Subscribe(_socket);
        }

        private void Update()
        {
            if (!InputEnabled)
            {
                if (_radialOpen || _assignRadial) CloseRadial();
                else ResetHeldRadial();
                return;
            }
            if (_assignRadial)
            {
                for (int i = 0; i < SlotCount; i++)
                {
                    if (Input.GetKeyDown(KeyCode.Alpha1 + i) || Input.GetKeyDown(KeyCode.Keypad1 + i))
                    {
                        Assign(i, _assignItem);
                        CloseRadial();
                        return;
                    }
                }
                if (Input.GetKeyDown(KeyCode.Escape)) CloseRadial();
                return;
            }

            if (_globalMapActive)
            {
                if (!AnyPanelOpen())
                {
                    for (int i = 0; i < SlotCount; i++)
                        if (Input.GetKeyDown(KeyCode.Alpha1 + i) || Input.GetKeyDown(KeyCode.Keypad1 + i))
                            Activate(i);
                }
                return;
            }

            bool desktopWorld = _worldActive && (_mobile == null || !_mobile.ControlsEnabled);
            if (!desktopWorld || AnyPanelOpen())
            {
                if (_eHeld || _radialOpen) ResetHeldRadial();
                return;
            }

            if (Input.GetKeyDown(KeyCode.E))
            {
                _eHeld = true;
                _ePressedAt = Time.unscaledTime;
                _radialCenter = ClampRadialCenter(MouseGuiPoint(), Screen.width, Screen.height);
            }
            if (_eHeld && !_radialOpen && Input.GetKey(KeyCode.E)
                && Time.unscaledTime - _ePressedAt >= RadialHoldSeconds)
            {
                _radialOpen = true;
                _radialSelected = -1;
                _radialCenter = ClampRadialCenter(MouseGuiPoint(), Screen.width, Screen.height);
            }
            if (_radialOpen) UpdateRadialSelection();
            if (_eHeld && Input.GetKeyUp(KeyCode.E))
            {
                bool wasOpen = _radialOpen;
                int selected = _radialSelected;
                ResetHeldRadial();
                if (wasOpen)
                {
                    if (selected >= 0) Activate(selected);
                }
                else _interaction?.TriggerInteract();
            }
        }

        private void OnDisable()
        {
            ResetHeldRadial();
            if (_interaction != null) _interaction.KeyboardInputEnabled = true;
            Subscribe(null);
        }

        private void Subscribe(RoaSocketClient socket)
        {
            _socket = socket;
            if (_subscribedSocket == socket) return;
            if (_subscribedSocket != null) _subscribedSocket.OnJoined -= HandleJoined;
            _subscribedSocket = socket;
            if (_subscribedSocket != null) _subscribedSocket.OnJoined += HandleJoined;
        }

        private void HandleJoined(JoinAck ack)
        {
            if (ack == null || string.IsNullOrEmpty(ack.CharacterId) || string.IsNullOrEmpty(ack.CharacterLeaseId))
                return;
            if (_loaded && ack.CharacterId == _characterId && ack.CharacterLeaseId == _leaseId) return;

            _characterId = ack.CharacterId;
            _leaseId = ack.CharacterLeaseId;
            _loaded = false;
            _assignItem = string.Empty;
            _clearMode = false;
            int version = ++_loadVersion;
            StartCoroutine(Load(version, _characterId, _leaseId));
        }

        private IEnumerator Load(int version, string characterId, string leaseId)
        {
            if (_auth == null)
            {
                _status = "Сессия сохранения недоступна.";
                yield break;
            }

            JObject state = null;
            string error = null;
            yield return _auth.FetchCharacterState(characterId, leaseId, (ok, loaded, message) =>
            {
                if (ok) state = loaded;
                else error = message;
            });
            if (version != _loadVersion || characterId != _characterId || leaseId != _leaseId) yield break;
            if (state == null)
            {
                _status = error ?? "Быстрые слоты не загружены.";
                yield break;
            }

            for (int i = 0; i < SlotCount; i++) _slots[i] = string.Empty;
            if (state["quickbarSlots"] is JArray saved)
            {
                for (int i = 0; i < Mathf.Min(SlotCount, saved.Count); i++)
                {
                    JToken token = saved[i];
                    if (token != null && token.Type != JTokenType.Null)
                        _slots[i] = token.ToString().Trim();
                }
            }
            _loaded = true;
            _status = string.Empty;
        }

        private void MarkDirty()
        {
            _dirty = true;
            if (!_saving) StartCoroutine(SaveLoop());
        }

        private IEnumerator SaveLoop()
        {
            _saving = true;
            while (_dirty)
            {
                _dirty = false;
                var snapshot = new string[SlotCount];
                System.Array.Copy(_slots, snapshot, SlotCount);
                bool ok = false;
                string error = null;
                if (_auth != null && !string.IsNullOrEmpty(_characterId) && !string.IsNullOrEmpty(_leaseId))
                {
                    yield return _auth.SaveQuickbar(_characterId, _leaseId, snapshot, (saved, message) =>
                    {
                        ok = saved;
                        error = message;
                    });
                }
                else error = "Нет активной сессии персонажа.";

                if (!ok)
                {
                    _status = error ?? "Быстрые слоты не сохранены.";
                    break;
                }
                if (!_dirty) _status = string.Empty;
            }
            _saving = false;
        }

        private void OnGUI()
        {
            RoaUiTheme.Apply();
            if (!InputEnabled && !RoaHudLayout.Editing) return;
            if (!_worldActive && !_globalMapActive && !_radialOpen) return;
            bool inventoryOpen = _inventory != null && _inventory.IsOpen;
            bool pipboyOpen = _combat != null && _combat.Pipboy != null && _combat.Pipboy.IsOpen;
            bool interactionOpen = _interaction != null && _interaction.IsPanelOpen;
            if ((pipboyOpen || interactionOpen) && !RoaHudLayout.Editing) return;
            EnsureStyles();

            if (_radialOpen)
            {
                DrawRadial();
                if (CanvasDriven || !IsMobileVisible) return;
            }
            if (CanvasDriven) return;

            Rect defaultBar = IsMobileVisible
                ? BarRect(Screen.width, Screen.height)
                : DesktopBarRect(Screen.width, Screen.height);
            Rect bar = inventoryOpen && !IsMobileVisible && !RoaHudLayout.Editing
                ? DesktopInventoryBarRect(Screen.width, Screen.height)
                : RoaHudLayout.Resolve("quickbar", defaultBar);
            float gap = 4f;
            float slotWidth = (bar.width - gap * (SlotCount - 1)) / SlotCount;
            for (int i = 0; i < SlotCount; i++)
            {
                Rect rect = new Rect(bar.x + i * (slotWidth + gap), bar.y, slotWidth, bar.height);
                string itemId = _slots[i];
                bool active = !string.IsNullOrEmpty(itemId) && _inventory != null && _inventory.IsEquipped(itemId);
                bool available = !string.IsNullOrEmpty(itemId) && _inventory != null && _inventory.OwnsItem(itemId);
                Color old = GUI.backgroundColor;
                if (!string.IsNullOrEmpty(_assignItem)) GUI.backgroundColor = new Color(0.95f, 0.72f, 0.25f);
                else if (_clearMode) GUI.backgroundColor = new Color(0.82f, 0.34f, 0.25f);
                else if (active) GUI.backgroundColor = new Color(0.42f, 0.78f, 0.35f);
                else if (!available && !string.IsNullOrEmpty(itemId)) GUI.backgroundColor = new Color(0.40f, 0.40f, 0.40f);

                if (RoaHudLayout.Editing) GUI.Box(rect, SlotLabel(i, itemId), _slotStyle);
                else if (GUI.Button(rect, SlotLabel(i, itemId), _slotStyle))
                {
                    if (!string.IsNullOrEmpty(_assignItem)) Assign(i, _assignItem);
                    else if (_clearMode) ClearSlot(i);
                    else Activate(i);
                }
                GUI.backgroundColor = old;
            }

            Rect hint = new Rect(bar.x, bar.yMax + 3f, bar.width - 72f, 24f);
            string hintText = !string.IsNullOrEmpty(_assignItem)
                ? "Выберите слот для " + RoaItemData.Name(_assignItem)
                : (_saving ? "Сохранение быстрых слотов…" : _status);
            if (!string.IsNullOrEmpty(hintText)) GUI.Label(hint, hintText, _hintStyle);
            if (!RoaHudLayout.Editing && _inventory != null && _inventory.IsOpen)
            {
                Rect clear = new Rect(bar.xMax - 68f, bar.yMax + 2f, 68f, 24f);
                if (GUI.Button(clear, _clearMode ? "Отмена" : "Очистить"))
                {
                    _clearMode = !_clearMode;
                    _assignItem = string.Empty;
                }
            }
            RoaHudLayout.HandleDrag("quickbar", ref bar, "Быстрые слоты");
        }

        private void OpenAssignRadial()
        {
            _assignRadial = true;
            _radialOpen = true;
            _radialSelected = -1;
            _radialCenter = ClampRadialCenter(MouseGuiPoint(), Screen.width, Screen.height);
        }

        private void CloseRadial()
        {
            _radialOpen = false;
            _assignRadial = false;
            _radialSelected = -1;
            _eHeld = false;
            if (_mobile == null || !_mobile.ControlsEnabled) _assignItem = string.Empty;
        }

        private void ResetHeldRadial()
        {
            _eHeld = false;
            if (!_assignRadial)
            {
                _radialOpen = false;
                _radialSelected = -1;
            }
        }

        private bool AnyPanelOpen()
        {
            return (_inventory != null && _inventory.IsOpen)
                || (_interaction != null && _interaction.IsPanelOpen)
                || (_mobile != null && _mobile.ControlsEnabled)
                || (_combat != null && _combat.Pipboy != null && _combat.Pipboy.IsOpen);
        }

        private void UpdateRadialSelection()
        {
            // Keep all eight directions fixed even when only one or no item is
            // assigned. Compressing the populated entries around the circle made
            // slot numbers move and reduced an empty quickbar to a lone center box.
            _radialSelected = RadialSelection(MouseGuiPoint() - _radialCenter, SlotCount);
        }

        private void DrawRadial()
        {
            List<int> entries = AllIndices();
            bool hasAssignedItems = AssignedIndices().Count > 0;
            float radius = RadialRadius(Screen.width, Screen.height);
            const float size = 70f;
            for (int visual = 0; visual < entries.Count; visual++)
            {
                int index = entries[visual];
                float angle = -Mathf.PI * 0.5f + visual * Mathf.PI * 2f / Mathf.Max(1, entries.Count);
                Vector2 center = _radialCenter + new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * radius;
                Rect rect = new Rect(center.x - size * 0.5f, center.y - size * 0.5f, size, size);
                Color old = GUI.backgroundColor;
                if (_radialSelected == index) GUI.backgroundColor = new Color(0.96f, 0.72f, 0.24f);
                else if (!_assignRadial && _inventory != null && _inventory.IsEquipped(_slots[index]))
                    GUI.backgroundColor = new Color(0.42f, 0.78f, 0.35f);
                else if (string.IsNullOrEmpty(_slots[index]))
                    GUI.backgroundColor = new Color(0.30f, 0.30f, 0.28f);
                else if (!_assignRadial && _inventory != null && !_inventory.OwnsItem(_slots[index]))
                    GUI.backgroundColor = new Color(0.43f, 0.24f, 0.20f);
                if (GUI.Button(rect, SlotLabel(index, _slots[index]), _slotStyle) && _assignRadial)
                {
                    Assign(index, _assignItem);
                    CloseRadial();
                }
                GUI.backgroundColor = old;
            }

            Rect centerRect = new Rect(_radialCenter.x - 56f, _radialCenter.y - 32f, 112f, 64f);
            string centerText = _assignRadial
                ? "выбери\nслот"
                : (hasAssignedItems ? "выбери\nи отпусти" : "слоты пусты\nTab: сумка");
            GUI.Box(centerRect, centerText, _slotStyle);
        }

        private List<int> AssignedIndices()
        {
            var result = new List<int>();
            for (int i = 0; i < SlotCount; i++)
                if (!string.IsNullOrEmpty(_slots[i])) result.Add(i);
            return result;
        }

        private static List<int> AllIndices()
        {
            var result = new List<int>(SlotCount);
            for (int i = 0; i < SlotCount; i++) result.Add(i);
            return result;
        }

        private static Vector2 MouseGuiPoint()
        {
            return new Vector2(Input.mousePosition.x, Screen.height - Input.mousePosition.y);
        }

        public static int RadialSelection(Vector2 delta, int entryCount, float deadzone = 28f)
        {
            if (entryCount <= 0 || delta.magnitude < deadzone) return -1;
            float angle = Mathf.Atan2(delta.y, delta.x) + Mathf.PI * 0.5f;
            while (angle < 0f) angle += Mathf.PI * 2f;
            while (angle >= Mathf.PI * 2f) angle -= Mathf.PI * 2f;
            return Mathf.RoundToInt(angle / (Mathf.PI * 2f / entryCount)) % entryCount;
        }

        public static float RadialRadius(int width, int height)
        {
            return Mathf.Clamp(Mathf.Min(width, height) * 0.16f, 66f, 96f);
        }

        public static Vector2 ClampRadialCenter(Vector2 point, int width, int height)
        {
            float margin = RadialRadius(width, height) + 42f;
            return new Vector2(Mathf.Clamp(point.x, margin, width - margin),
                               Mathf.Clamp(point.y, margin, height - margin));
        }

        public string SlotLabel(int index, string itemRuntimeId)
        {
            if (string.IsNullOrEmpty(itemRuntimeId)) return (index + 1) + "\n—";
            string baseId = RoaItemData.Name(itemRuntimeId);
            if (baseId.Length > 10) baseId = baseId.Substring(0, 9) + "…";
            int qty = _inventory != null ? _inventory.QuickItemQuantity(itemRuntimeId) : 0;
            return (index + 1) + "\n" + baseId + (qty > 1 ? " ×" + qty : string.Empty);
        }

        private void EnsureStyles()
        {
            if (_slotStyle == null)
            {
                _slotStyle = new GUIStyle(GUI.skin.button)
                {
                    alignment = TextAnchor.MiddleCenter,
                    wordWrap = false,
                    fontStyle = FontStyle.Bold,
                    fontSize = Mathf.Clamp(Mathf.RoundToInt(Screen.height / 50f), 11, 18)
                };
            }
            if (_hintStyle == null)
            {
                _hintStyle = new GUIStyle(GUI.skin.label)
                {
                    alignment = TextAnchor.MiddleLeft,
                    fontSize = Mathf.Clamp(Mathf.RoundToInt(Screen.height / 58f), 10, 16)
                };
            }
        }

        private static bool ValidIndex(int index)
        {
            return index >= 0 && index < SlotCount;
        }

        public static Rect BarRect(int width, int height)
        {
            float available = Mathf.Max(320f, width - 316f);
            float barWidth = Mathf.Min(760f, available);
            float x = Mathf.Max(304f, (width - barWidth) * 0.5f);
            return new Rect(x, 10f, Mathf.Min(barWidth, width - x - 12f),
                            Mathf.Clamp(height * 0.14f, 52f, 68f));
        }

        public static Rect DesktopBarRect(int width, int height)
        {
            float barWidth = Mathf.Min(760f, Mathf.Max(320f, width - 24f));
            return new Rect((width - barWidth) * 0.5f, 10f, barWidth,
                            Mathf.Clamp(height * 0.09f, 52f, 68f));
        }

        public static Rect DesktopInventoryBarRect(int width, int height)
        {
            float inventoryWidth = Mathf.Min(500f, width - 24f);
            float inventoryLeft = width - inventoryWidth - 12f;
            float available = Mathf.Max(160f, inventoryLeft - 24f);
            float barWidth = Mathf.Min(760f, available);
            return new Rect(12f, 10f, barWidth, Mathf.Clamp(height * 0.09f, 52f, 68f));
        }
    }
}
