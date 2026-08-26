using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Landscape touch controls: floating direction stick, auto-target, fire,
    /// interaction, crouch, reload and panel shortcuts. The stick supplies a
    /// direction, not analogue speed, matching 08a_mobile_controls_panels.js.
    /// </summary>
    public sealed class RoaMobileControls : MonoBehaviour
    {
        [Tooltip("Show touch controls in the editor for landscape verification.")]
        public bool ForceVisible;

        public float TargetRange = 28f;
        public bool InputSuppressed;
        public Action MenuRequested;

        private RoaCombat _combat;
        private RoaInteraction _interaction;
        private RoaInventory _inventory;
        private RoaPipboy _pipboy;
        private RoaEnemies _enemies;
        private RoaGlobalMap _globalMap;
        private RoaGroundItems _groundItems;
        private RoaPlayerController _player;

        private readonly List<RoaEnemies.MobileTarget> _targets = new List<RoaEnemies.MobileTarget>();
        private string _selectedId = string.Empty;
        private int _joystickFinger = -1;
        private Vector2 _joystickBase;
        private Vector2 _joystickPoint;
        private float _joystickRadius = 54f;
        private bool _crouching;
        private bool _fireHeld;
        private bool _lastEnabled;
        private float _targetRefreshAt;

        private GUIStyle _buttonStyle;
        private GUIStyle _iconButtonStyle;
        private Texture2D _inventoryIcon;
        private Texture2D _mapIcon;
        private Texture2D _pipboyIcon;
        private Texture2D _menuIcon;
        private Texture2D _fireIcon;
        private Texture2D _interactIcon;
        private Texture2D _targetIcon;
        private Texture2D _crouchIcon;
        private Texture2D _reloadIcon;
        private Texture2D _modeIcon;
        private Texture2D _playerIcon;

        public bool ControlsEnabled { get { return Application.isMobilePlatform || ForceVisible; } }
        public bool CanvasDriven { get; set; }
        public bool JoystickActive { get { return _joystickFinger >= 0; } }
        public string SelectedTargetId { get { return _selectedId; } }
        public bool PlayerReady
        {
            get { return _player != null && _player.gameObject.activeInHierarchy; }
        }
        public bool PanelOpen { get { return IsPanelOpen(); } }
        public bool PipboyOpen { get { return _pipboy != null && _pipboy.IsOpen; } }
        public bool InventoryOpen { get { return _inventory != null && _inventory.IsOpen; } }
        public bool TargetSelected { get { return !string.IsNullOrEmpty(_selectedId); } }
        public bool Crouching { get { return _crouching; } }
        public string CurrentFireMode
        {
            get { return _combat != null ? _combat.FireMode : "Режим"; }
        }
        public bool FireHeldForCanvas { get { return _fireHeld; } }

        public void Configure(RoaCombat combat, RoaInteraction interaction, RoaInventory inventory,
                              RoaPipboy pipboy, RoaEnemies enemies, RoaGlobalMap globalMap,
                              RoaGroundItems groundItems = null)
        {
            _combat = combat;
            _interaction = interaction;
            _inventory = inventory;
            _pipboy = pipboy;
            _enemies = enemies;
            _globalMap = globalMap;
            _groundItems = groundItems;
            ApplyMode();
        }

        public void SetPlayer(RoaPlayerController player)
        {
            if (_player != null && _player != player)
            {
                _player.SetVirtualMove(Vector2.zero);
                _player.SetVirtualCrouch(false);
                _player.SetPointerAimEnabled(true);
            }
            _player = player;
            ResetJoystick();
            _crouching = false;
            _fireHeld = false;
            if (_player != null) _player.SetVirtualCrouch(false);
            _selectedId = string.Empty;
            _combat?.ClearMobileAimTarget();
            ApplyMode();
        }

        public void Clear()
        {
            ResetJoystick();
            _crouching = false;
            _fireHeld = false;
            if (_player != null) _player.SetVirtualCrouch(false);
            _selectedId = string.Empty;
            _targets.Clear();
            _combat?.ClearMobileAimTarget();
        }

        private void OnDisable()
        {
            if (_player != null)
            {
                _player.SetVirtualMove(Vector2.zero);
                _player.SetVirtualCrouch(false);
                _player.SetPointerAimEnabled(true);
            }
            if (_combat != null) _combat.MobileInputMode = false;
            Clear();
        }

        private void Update()
        {
            if (_lastEnabled != ControlsEnabled) ApplyMode();
            if (!ControlsEnabled || InputSuppressed || _player == null || !_player.gameObject.activeInHierarchy)
            {
                if (_joystickFinger >= 0) ResetJoystick();
                SetFireHeld(false);
                _combat?.ClearMobileAimTarget();
                return;
            }

            if (Time.unscaledTime >= _targetRefreshAt)
            {
                _targetRefreshAt = Time.unscaledTime + 0.12f;
                RefreshTargets();
            }

            bool panelOpen = IsPanelOpen();
            if (panelOpen)
            {
                if (_joystickFinger >= 0) ResetJoystick();
                SetFireHeld(false);
            }
            else
            {
                ReadJoystickTouches();
                if (_fireHeld || (!CanvasDriven && TouchHeld(FireRect(Screen.width, Screen.height))))
                    Fire();
            }

            UpdateTargetRing(panelOpen);
        }

        private void ApplyMode()
        {
            _lastEnabled = ControlsEnabled;
            if (_combat != null) _combat.MobileInputMode = ControlsEnabled;
            if (_player != null) _player.SetPointerAimEnabled(!ControlsEnabled);
            if (!ControlsEnabled) ResetJoystick();
        }

        private bool IsPanelOpen()
        {
            return (_interaction != null && _interaction.IsPanelOpen)
                || (_inventory != null && _inventory.IsOpen)
                || (_pipboy != null && _pipboy.IsOpen);
        }

        private void ReadJoystickTouches()
        {
            bool found = false;
            for (int i = 0; i < Input.touchCount; i++)
            {
                Touch touch = Input.GetTouch(i);
                Vector2 gui = new Vector2(touch.position.x, Screen.height - touch.position.y);
                if (touch.fingerId == _joystickFinger)
                {
                    found = touch.phase != TouchPhase.Ended && touch.phase != TouchPhase.Canceled;
                    if (found)
                    {
                        _joystickPoint = gui;
                        _player.SetVirtualMove(NormalizeJoystick(_joystickPoint - _joystickBase,
                                                                   _joystickRadius));
                    }
                    continue;
                }

                if (_joystickFinger < 0 && touch.phase == TouchPhase.Began
                    && IsJoystickStart(gui, Screen.width, Screen.height, Screen.safeArea))
                {
                    _joystickFinger = touch.fingerId;
                    _joystickRadius = Mathf.Clamp(Mathf.Min(Screen.width, Screen.height) * 0.09f, 42f, 68f);
                    float half = _joystickRadius * 1.28f;
                    _joystickBase = new Vector2(
                        Mathf.Clamp(gui.x, 8f + half, Mathf.Min(Screen.width * 0.46f, 380f) - half),
                        Mathf.Clamp(gui.y, Mathf.Max(80f, Screen.height * 0.18f) + half,
                                    Screen.height - 18f - half));
                    _joystickPoint = gui;
                    found = true;
                    _player.SetVirtualMove(NormalizeJoystick(_joystickPoint - _joystickBase,
                                                               _joystickRadius));
                }
            }

            if (_joystickFinger >= 0 && !found) ResetJoystick();
        }

        private void ResetJoystick()
        {
            _joystickFinger = -1;
            _joystickPoint = _joystickBase;
            if (_player != null) _player.SetVirtualMove(Vector2.zero);
        }

        private bool TouchHeld(Rect guiRect)
        {
            for (int i = 0; i < Input.touchCount; i++)
            {
                Touch touch = Input.GetTouch(i);
                if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled) continue;
                Vector2 gui = new Vector2(touch.position.x, Screen.height - touch.position.y);
                if (guiRect.Contains(gui)) return true;
            }
            return false;
        }

        private void Fire()
        {
            if (_combat == null || _player == null) return;
            Vector3 target;
            if (!TrySelectedTarget(out target))
                target = _player.transform.position + _player.transform.forward * 18f;
            _combat.TriggerAttackAt(target);
        }

        private void CycleTarget()
        {
            RefreshTargets();
            if (_targets.Count == 0)
            {
                _selectedId = string.Empty;
                return;
            }
            int current = -1;
            for (int i = 0; i < _targets.Count; i++)
                if (_targets[i].Id == _selectedId) { current = i; break; }
            RoaEnemies.MobileTarget next = _targets[(current + 1) % _targets.Count];
            _selectedId = next.Id;
            _player?.AimAtWorld(next.Position);
        }

        private void RefreshTargets()
        {
            if (_enemies == null || _player == null)
            {
                _targets.Clear();
                _selectedId = string.Empty;
                return;
            }
            _enemies.CollectMobileTargets(_player.transform.position, TargetRange, _targets);
            if (string.IsNullOrEmpty(_selectedId)) return;
            for (int i = 0; i < _targets.Count; i++) if (_targets[i].Id == _selectedId) return;
            _selectedId = string.Empty;
        }

        private bool TrySelectedTarget(out Vector3 position)
        {
            position = Vector3.zero;
            if (string.IsNullOrEmpty(_selectedId) || _enemies == null) return false;
            for (int i = 0; i < _targets.Count; i++)
            {
                if (_targets[i].Id != _selectedId) continue;
                position = _targets[i].Position;
                return true;
            }
            _selectedId = string.Empty;
            return false;
        }

        private void UpdateTargetRing(bool panelOpen)
        {
            Vector3 position;
            if (panelOpen || !TrySelectedTarget(out position))
            {
                _combat?.ClearMobileAimTarget();
                return;
            }

            // Rendering and target resolution now belong to RoaCombat. Both
            // desktop and mobile therefore preview the exact same shot line.
            _combat?.SetMobileAimTarget(_selectedId, position);
        }
        private void OnGUI()
        {
            if (CanvasDriven) return;
            RoaUiTheme.Apply();
            if (!ControlsEnabled || _player == null || !_player.gameObject.activeInHierarchy) return;
            // PIP-Boy owns the whole landscape viewport and has its own close
            // button. Keeping the mobile shortcut row here would cover its title
            // and first tab row on short screens.
            if (_pipboy != null && _pipboy.IsOpen) return;
            EnsureStyles();

            float railSize = Mathf.Clamp(Screen.height * 0.12f, 46f, 58f);
            Rect inventory = new Rect(12f, 12f, railSize, railSize);
            Rect map = new Rect(12f, 18f + railSize, railSize, railSize);
            Rect pip = new Rect(12f, 24f + railSize * 2f, railSize, railSize);
            Rect menu = new Rect(12f, 30f + railSize * 3f, railSize, railSize);
            if (IconButton(menu, InputSuppressed ? "Закрыть" : "Меню", _menuIcon))
                TriggerMenu();
            if (InputSuppressed) return;
            if (IconButton(inventory, _inventory != null && _inventory.IsOpen ? "Закрыть" : "Сумка",
                           _inventoryIcon)) TriggerInventory();
            if (IconButton(pip, _pipboy != null && _pipboy.IsOpen ? "Закрыть" : "Пип-бой",
                           _pipboyIcon)) TriggerPipboy();
            if (IconButton(map, "Карта", _mapIcon)) TriggerMap();

            if (IsPanelOpen()) return;

            Rect fire = FireRect(Screen.width, Screen.height);
            if (Event.current.isMouse && IconButton(fire, "ОГОНЬ", _fireIcon, true)) Fire();
            else IconButton(fire, "ОГОНЬ", _fireIcon);

            Rect interact = ActionRect(Screen.width, Screen.height, 1);
            Rect target = ActionRect(Screen.width, Screen.height, 2);
            Rect crouch = ActionRect(Screen.width, Screen.height, 3);
            Rect reload = ActionRect(Screen.width, Screen.height, 4);
            Rect mode = ActionRect(Screen.width, Screen.height, 5);
            Rect player = ActionRect(Screen.width, Screen.height, 6);
            if (IconButton(interact, "Действие", _interactIcon)) TriggerInteract();
            if (IconButton(target, string.IsNullOrEmpty(_selectedId) ? "Цель" : "Цель выбрана",
                           _targetIcon)) TriggerTargetCycle();
            if (IconButton(crouch, _crouching ? "Встать" : "Присесть", _crouchIcon))
                TriggerCrouch();
            if (IconButton(reload, "Перезарядить", _reloadIcon)) TriggerReload();
            if (IconButton(mode, _combat != null ? _combat.FireMode : "Режим", _modeIcon))
                TriggerFireMode();
            if (IconButton(player, "Игрок", _playerIcon)) TriggerPlayerPanel();

            DrawJoystick();
        }

        public bool TryGetJoystickVisual(out Vector2 guiBase, out Vector2 guiPoint,
                                         out float radius)
        {
            guiBase = _joystickBase;
            guiPoint = _joystickPoint;
            radius = _joystickRadius;
            return _joystickFinger >= 0;
        }

        public void SetFireHeld(bool held)
        {
            if (_fireHeld == held) return;
            _fireHeld = held;
            if (held && ControlsEnabled && !InputSuppressed && !IsPanelOpen()) Fire();
        }

        public void TriggerMenu()
        {
            MenuRequested?.Invoke();
        }

        public void TriggerInventory()
        {
            if (InputSuppressed) return;
            if (_pipboy != null && _pipboy.IsOpen) _pipboy.Toggle();
            _inventory?.Toggle();
        }

        public void TriggerPipboy()
        {
            if (InputSuppressed) return;
            if (_inventory != null && _inventory.IsOpen) _inventory.Toggle();
            _pipboy?.Toggle();
        }

        public void TriggerMap()
        {
            if (InputSuppressed || IsPanelOpen()) return;
            _globalMap?.RequestEnterFromLocation();
        }

        public void TriggerTargetCycle()
        {
            if (!InputSuppressed && !IsPanelOpen()) CycleTarget();
        }

        public void TriggerCrouch()
        {
            if (InputSuppressed || IsPanelOpen() || _player == null) return;
            _crouching = !_crouching;
            _player.SetVirtualCrouch(_crouching);
        }

        public void TriggerReload()
        {
            if (!InputSuppressed && !IsPanelOpen()) _combat?.TriggerReload();
        }

        public void TriggerFireMode()
        {
            if (!InputSuppressed && !IsPanelOpen()) _combat?.TriggerCycleFireMode();
        }

        public void TriggerPlayerPanel()
        {
            if (!InputSuppressed && !IsPanelOpen()) _pipboy?.OpenSocial();
        }

        /// <summary>Uses desktop E priority: an interaction target first, then nearby ground loot.</summary>
        public void TriggerInteract()
        {
            if (InputSuppressed || IsPanelOpen()) return;
            _interaction?.TriggerInteract();
            if (_interaction == null || !_interaction.BlocksGroundPickup)
                _groundItems?.RequestPickupNearest();
        }

        private void DrawJoystick()
        {
            if (_joystickFinger < 0) return;
            float outer = _joystickRadius * 1.28f;
            GUI.color = new Color(0.22f, 0.32f, 0.24f, 0.62f);
            GUI.Box(new Rect(_joystickBase.x - outer, _joystickBase.y - outer,
                             outer * 2f, outer * 2f), string.Empty);
            Vector2 delta = Vector2.ClampMagnitude(_joystickPoint - _joystickBase, _joystickRadius);
            const float knob = 34f;
            GUI.color = new Color(0.72f, 0.83f, 0.67f, 0.88f);
            GUI.Box(new Rect(_joystickBase.x + delta.x - knob,
                             _joystickBase.y + delta.y - knob, knob * 2f, knob * 2f), string.Empty);
            GUI.color = Color.white;
        }

        private void EnsureStyles()
        {
            if (_buttonStyle == null)
            {
                _buttonStyle = new GUIStyle(GUI.skin.button)
                {
                    alignment = TextAnchor.MiddleCenter,
                    wordWrap = true,
                    fontStyle = FontStyle.Bold,
                    fontSize = Mathf.Clamp(Mathf.RoundToInt(Screen.height / 55f), 13, 22)
                };
                _iconButtonStyle = new GUIStyle(_buttonStyle);
                ClearBackgrounds(_iconButtonStyle);

                _inventoryIcon = LoadIcon("RealmUi/mobile/left/inventory");
                _mapIcon = LoadIcon("RealmUi/mobile/left/map");
                _pipboyIcon = LoadIcon("RealmUi/mobile/left/skills");
                _menuIcon = LoadIcon("RealmUi/mobile/top/main_menu");
                _fireIcon = LoadIcon("RealmUi/mobile/right/attack");
                _interactIcon = LoadIcon("RealmUi/mobile/right/interact");
                _targetIcon = LoadIcon("RealmUi/mobile/right/target");
                _crouchIcon = LoadIcon("RealmUi/mobile/left/crouch");
                _reloadIcon = LoadIcon("RealmUi/mobile/right/reload");
                _modeIcon = LoadIcon("RealmUi/mobile/right/mode");
                _playerIcon = LoadIcon("RealmUi/mobile/right/radial_menu");
            }
        }

        private bool IconButton(Rect rect, string fallback, Texture2D icon, bool repeat = false)
        {
            if (icon == null)
                return repeat ? GUI.RepeatButton(rect, fallback, _buttonStyle)
                              : GUI.Button(rect, fallback, _buttonStyle);

            GUI.DrawTexture(rect, icon, ScaleMode.ScaleToFit, true);
            GUIContent content = new GUIContent(string.Empty, fallback);
            return repeat ? GUI.RepeatButton(rect, content, _iconButtonStyle)
                          : GUI.Button(rect, content, _iconButtonStyle);
        }

        private static Texture2D LoadIcon(string path)
        {
            return Resources.Load<Texture2D>(path);
        }

        private static void ClearBackgrounds(GUIStyle style)
        {
            style.normal.background = null;
            style.hover.background = null;
            style.active.background = null;
            style.focused.background = null;
            style.onNormal.background = null;
            style.onHover.background = null;
            style.onActive.background = null;
            style.onFocused.background = null;
        }

        public static Vector2 NormalizeJoystick(Vector2 delta, float radius)
        {
            radius = Mathf.Max(1f, radius);
            float length = delta.magnitude;
            float deadzone = Mathf.Max(8f, radius * 0.14f);
            if (length < deadzone) return Vector2.zero;
            Vector2 direction = delta / Mathf.Max(0.001f, length);
            return new Vector2(direction.x, -direction.y);
        }

        public static bool IsJoystickStart(Vector2 guiPoint, int width, int height)
        {
            return IsJoystickStart(guiPoint, width, height, new Rect(0f, 0f, width, height));
        }

        public static bool IsJoystickStart(Vector2 guiPoint, int width, int height, Rect safeArea)
        {
            Vector2 screenPoint = new Vector2(guiPoint.x, height - guiPoint.y);
            RoaMobileControlsCanvas.Layout layout =
                RoaMobileControlsCanvas.CalculateLayout(width, height, safeArea);
            if (!layout.SafeArea.Contains(screenPoint)
                || layout.Inventory.Contains(screenPoint) || layout.Map.Contains(screenPoint)
                || layout.Pipboy.Contains(screenPoint) || layout.Menu.Contains(screenPoint))
                return false;
            return guiPoint.x >= Mathf.Max(8f, safeArea.xMin)
                && guiPoint.x <= Mathf.Min(width * 0.46f, 380f)
                && guiPoint.y >= Mathf.Max(80f, height * 0.18f)
                && guiPoint.y <= height - 18f;
        }

        public static Rect FireRect(int width, int height)
        {
            float size = Mathf.Clamp(Mathf.Min(width, height) * 0.145f, 76f, 112f);
            return new Rect(width - size - 18f, height - size - 22f, size, size);
        }

        private static Rect ActionRect(int width, int height, int index)
        {
            float size = Mathf.Clamp(Mathf.Min(width, height) * 0.09f, 54f, 76f);
            float x = width - size - 24f - ((index - 1) % 2) * (size + 10f);
            float row = Mathf.Floor((index - 1) / 2f);
            float y = height - FireRect(width, height).height - 34f - (row + 1f) * (size + 8f);
            return new Rect(x, y, size, size);
        }
    }
}
