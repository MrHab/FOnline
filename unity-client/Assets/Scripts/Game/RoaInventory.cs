using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Инвентарь и экипировка.
    ///
    /// Сумка и слоты принадлежат серверу: клиент только показывает авторитетный
    /// снимок и просит его изменить. Локально ничего не перекладывается —
    /// отказ сервера обязан оставлять картинку прежней.
    ///
    /// Смена слота атомарна и стоит 1 очко действия. Запрос несёт requestId
    /// (защита от повторной отправки) и expectedRevision (защита от гонки:
    /// если экипировка уже изменилась, сервер отклоняет запрос и присылает
    /// свежее состояние). Разбор — serverApplyEquipmentAction, server.js:7240.
    /// </summary>
    public sealed class RoaInventory : MonoBehaviour
    {
        public RoaSocketClient Socket;
        public RoaQuickbar Quickbar;
        public RoaGroundItems GroundItems;
        public bool InputEnabled = true;

        [Tooltip("Клавиша открытия сумки.")]
        public KeyCode ToggleKey = KeyCode.Tab;

        /// <summary>
        /// Что подходит в какой слот. Портирует VALID_EQUIPMENT (server.js:…):
        /// клиент проверяет это только чтобы не слать заведомо отказной запрос,
        /// решение всё равно за сервером.
        /// </summary>
        private static readonly string[] HandItems =
        {
            "pistol", "rifle", "assaultRifle", "machineGun", "laserPistol", "flamethrower",
            "plasmaRifle", "shotgun", "rocketLauncher", "knife", "fists",
            "medkit", "stim", "doctorBag", "antibiotics", "pickaxe", "axe", "handPump"
        };

        private static readonly Dictionary<string, HashSet<string>> SlotItems =
            new Dictionary<string, HashSet<string>>
            {
                { "weapon", new HashSet<string>(HandItems) },
                { "offhand", new HashSet<string>(HandItems) },
                { "armor", new HashSet<string>(new[] { "leather", "metalArmor", "ballisticVest", "combatArmor", "hazmatSuit", "heavyArmor", "energySuit" }) },
                { "helmet", new HashSet<string>(new[] { "weldedHelmet", "helmet", "tacticalHelmet", "assaultHelmet", "preWarHelmet" }) },
                { "boots", new HashSet<string>(new[] { "boots", "scoutBoots", "reinforcedBoots", "assaultBoots" }) },
                { "backpack", new HashSet<string>(new[] { "backpack" }) }
            };

        private static readonly string[] SlotOrder = { "weapon", "offhand", "armor", "helmet", "boots", "backpack" };

        private static readonly HashSet<string> MedicalItems = new HashSet<string>(new[]
        {
            "medkit", "stim", "doctorBag", "antibiotics"
        });

        private static readonly HashSet<string> AmmoItems = new HashSet<string>(new[]
        {
            "ammo9", "ammo556", "energyCell", "napalm", "shotgunShell", "rocketAmmo"
        });

        private static readonly HashSet<string> Firearms = new HashSet<string>(new[]
        {
            "pistol", "rifle", "assaultRifle", "machineGun", "laserPistol", "flamethrower",
            "plasmaRifle", "shotgun", "rocketLauncher"
        });

        private static readonly HashSet<string> RepairableItems = new HashSet<string>(new[]
        {
            "pistol", "rifle", "assaultRifle", "machineGun", "laserPistol", "flamethrower",
            "plasmaRifle", "shotgun", "rocketLauncher", "knife", "pickaxe", "axe", "handPump",
            "leather", "metalArmor", "ballisticVest", "combatArmor", "hazmatSuit", "heavyArmor",
            "energySuit", "helmet", "tacticalHelmet", "assaultHelmet", "boots", "scoutBoots",
            "reinforcedBoots", "backpack"
        });

        private static readonly HashSet<string> SalvageableItems = new HashSet<string>(new[]
        {
            "pistol", "rifle", "assaultRifle", "machineGun", "laserPistol", "flamethrower",
            "plasmaRifle", "shotgun", "rocketLauncher", "knife", "leather", "metalArmor",
            "ballisticVest", "combatArmor", "hazmatSuit", "heavyArmor", "energySuit", "helmet",
            "tacticalHelmet", "assaultHelmet", "boots", "scoutBoots", "reinforcedBoots", "backpack",
            "pickaxe", "axe", "handPump", "repairKit"
        });

        public struct Row
        {
            public string Id;
            public int Qty;
        }

        private enum InventorySortMode
        {
            Name,
            Weight,
            Quantity
        }

        private readonly List<Row> _items = new List<Row>();
        private readonly Dictionary<string, string> _equipment = new Dictionary<string, string>();
        private readonly Dictionary<string, JObject> _weaponModifications = new Dictionary<string, JObject>();

        private int _revision;
        private float _carryWeight;
        private float _carryCapacity;
        private bool _open;
        private bool _actionPending;
        private JObject _self;
        private string _status = string.Empty;
        private string _modifyWeaponRuntimeId = string.Empty;
        private string _modifySlot = "barrel";
        private string _dropPickerItem = string.Empty;
        private int _dropPickerMax = 1;
        private int _dropPickerQty = 1;
        private Vector2 _scroll;
        private string _filter = string.Empty;
        private InventorySortMode _sortMode;

        public bool IsOpen { get { return _open; } }

        /// <summary>Новый Pip-Boy на канве рисует и обслуживает окно сам; IMGUI и клавиша выключаются.</summary>
        public bool CanvasDriven { get; set; }

        /// <summary>Строки инвентаря: базовые id и количество, как отдал сервер.</summary>
        public System.Collections.Generic.IReadOnlyList<Row> Items { get { return _items; } }

        /// <summary>Слоты экипировки: slot → runtime id предмета.</summary>
        public System.Collections.Generic.IReadOnlyDictionary<string, string> EquipmentSlots { get { return _equipment; } }

        public float CarryWeight { get { return _carryWeight; } }
        public float CarryCapacity { get { return _carryCapacity; } }

        private void OnEnable()
        {
            if (Socket == null) return;
            Socket.OnJoined += HandleJoined;
            Socket.OnAuthoritativeSelf += HandleSelf;
        }

        private void OnDisable()
        {
            if (Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnAuthoritativeSelf -= HandleSelf;
        }

        private void Update()
        {
            if (!string.IsNullOrEmpty(_dropPickerItem))
            {
                if (Input.GetKeyDown(KeyCode.Escape)) CloseDropPicker();
                return;
            }
            if (!CanvasDriven && InputEnabled && Input.GetKeyDown(ToggleKey)) Toggle();
        }

        public void Toggle()
        {
            _open = !_open;
            if (!_open) CloseDropPicker();
        }

        public bool IsQuickAssignable(string itemRuntimeId)
        {
            if (!OwnsItem(itemRuntimeId)) return false;
            string baseId = BaseId(itemRuntimeId);
            return SlotFor(baseId) != null || MedicalItems.Contains(baseId) || AmmoItems.Contains(baseId);
        }

        public bool OwnsItem(string itemRuntimeId)
        {
            if (string.IsNullOrEmpty(itemRuntimeId)) return false;
            foreach (Row row in _items)
                if (row.Id == itemRuntimeId && row.Qty > 0) return true;
            foreach (KeyValuePair<string, string> entry in _equipment)
                if (entry.Value == itemRuntimeId) return true;
            return false;
        }

        public bool IsEquipped(string itemRuntimeId)
        {
            if (string.IsNullOrEmpty(itemRuntimeId)) return false;
            foreach (KeyValuePair<string, string> entry in _equipment)
                if (entry.Value == itemRuntimeId) return true;
            return false;
        }

        public int QuickItemQuantity(string itemRuntimeId)
        {
            int total = 0;
            foreach (Row row in _items)
                if (row.Id == itemRuntimeId) total += Mathf.Max(0, row.Qty);
            if (total == 0 && IsEquipped(itemRuntimeId)) return 1;
            return total;
        }

        public bool ActivateQuickItem(string itemRuntimeId, RoaCombat combat)
        {
            if (!OwnsItem(itemRuntimeId)) return false;
            string baseId = BaseId(itemRuntimeId);
            if (MedicalItems.Contains(baseId))
            {
                HealSelf(baseId);
                return true;
            }
            if (AmmoItems.Contains(baseId))
            {
                combat?.TriggerReload();
                return combat != null;
            }

            string slot = SlotFor(baseId);
            if (slot == null) return false;
            if (!IsEquipped(itemRuntimeId)) Equip(slot, itemRuntimeId);
            return true;
        }

        private void HandleJoined(JoinAck ack)
        {
            ApplySelf(ack.Self);
        }

        private void HandleSelf(JObject payload)
        {
            ApplySelf(payload);
        }

        /// <summary>
        /// Принять авторитетный снимок. Вызывается и на входе, и на каждой сверке,
        /// и в ответе на смену слота — источник один и тот же.
        /// </summary>
        private void ApplySelf(JObject self)
        {
            if (self == null) return;
            _self = (JObject)self.DeepClone();

            JToken revision = self["equipmentRevision"];
            if (revision != null) _revision = revision.ToObject<int>();

            if (self["inventory"] is JArray inventory)
            {
                _items.Clear();
                foreach (JToken row in inventory)
                {
                    string id = row["id"]?.ToString();
                    if (string.IsNullOrEmpty(id)) continue;

                    _items.Add(new Row { Id = id, Qty = row["qty"]?.ToObject<int>() ?? 0 });
                }
            }

            if (self["equipmentRuntime"] is JObject runtime)
            {
                _equipment.Clear();
                foreach (KeyValuePair<string, JToken> entry in runtime)
                    _equipment[entry.Key] = entry.Value?.ToString() ?? string.Empty;
            }

            _weaponModifications.Clear();
            if (self["weaponInventoryRuntime"] is JArray runtimeWeapons)
            {
                foreach (JToken row in runtimeWeapons)
                    RememberWeaponModifications(row);
            }
            if (self["weaponModifications"] is JArray modificationRows)
            {
                foreach (JToken row in modificationRows)
                    RememberWeaponModifications(row);
            }

            RecalculateCarry();
        }

        private void RecalculateCarry()
        {
            float weight = 0f;
            foreach (Row row in _items)
                weight += RoaItemData.Weight(row.Id) * Mathf.Max(0, row.Qty);
            foreach (KeyValuePair<string, string> entry in _equipment)
            {
                string id = BaseId(entry.Value);
                if (!string.IsNullOrEmpty(id) && id != "fists") weight += RoaItemData.Weight(id);
            }

            int strength = _self?["special"]?["str"]?.ToObject<int>() ?? 5;
            strength += _self?["talentRanks"]?["specialStr"]?.ToObject<int>() ?? 0;
            strength = Mathf.Clamp(strength, 1, 15);
            _carryWeight = Mathf.Max(0f, weight);
            string backpack;
            bool backpackEquipped = _equipment.TryGetValue("backpack", out backpack)
                && BaseId(backpack) == "backpack";
            _carryCapacity = RoaItemData.CarryCapacity(strength, backpackEquipped);
        }

        /// <summary>Первый слот, куда подходит предмет.</summary>
        public static string SlotFor(string itemId)
        {
            foreach (string slot in SlotOrder)
            {
                HashSet<string> allowed;
                if (SlotItems.TryGetValue(slot, out allowed) && allowed.Contains(itemId)) return slot;
            }
            return null;
        }

        private void Equip(string slot, string itemRuntimeId)
        {
            SubmitEquipmentAction(slot, itemRuntimeId);
        }

        /// <summary>Uses the same revisioned authoritative equipment request as the inventory UI.</summary>
        public bool SubmitEquipmentAction(string slot, string itemRuntimeId, Action<JObject> completed = null)
        {
            if (Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;

            _status = "…";

            Socket.EmitWithAck("equipmentAction", new Dictionary<string, object>
            {
                // Уникален на запрос: повтор с тем же id сервер считает тем же
                // действием и не списывает очки повторно.
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["slot"] = slot,
                ["itemRuntimeId"] = itemRuntimeId ?? string.Empty,
                ["expectedRevision"] = _revision
            }, ack =>
            {
                if (ack == null) { _status = "нет ответа сервера"; completed?.Invoke(null); return; }

                // Свежее состояние приходит и при отказе — принимаем всегда,
                // иначе картинка разойдётся с сервером.
                // equipmentAction publishes inventory/equipment in self and the active
                // magazine in the separate combat block. Applying only self leaves
                // RoaCombat on the previously equipped weapon until another combat
                // action happens, so the very next shot can be formed from stale state.
                Socket.ApplyGameplayAck(ack);

                JToken revision = ack["equipmentRevision"];
                if (revision != null) _revision = revision.ToObject<int>();

                bool ok = ack["ok"]?.ToObject<bool>() ?? false;
                _status = ok ? string.Empty : (ack["error"]?.ToString() ?? "отказано");
                completed?.Invoke(ack);
            });
            return true;
        }

        private void HealSelf(string itemId)
        {
            if (_actionPending || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            string targetId = _self?["id"]?.ToString() ?? Socket.Session?.Id;
            if (string.IsNullOrEmpty(targetId))
            {
                _status = "серверный id персонажа ещё не получен";
                return;
            }

            _actionPending = true;
            _status = "лечение…";
            Socket.EmitWithAck("healPlayer", new Dictionary<string, object>
            {
                ["targetId"] = targetId,
                ["itemId"] = itemId
            }, ack =>
            {
                _actionPending = false;
                if (ack == null) { _status = "нет ответа сервера"; return; }
                Socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    _status = ack["error"]?.ToString() ?? "лечение отклонено";
                    return;
                }

                int healed = ack["healed"]?.ToObject<int>() ?? 0;
                string cured = ack["curedInjury"]?.ToString();
                _status = !string.IsNullOrEmpty(cured)
                    ? "вылечено: " + cured
                    : (healed > 0 ? "восстановлено HP: " + healed : "лечение выполнено");
            });
        }

        private void SubmitItemAction(string action, string itemRuntimeId)
        {
            if (_actionPending || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            string itemId = BaseId(itemRuntimeId);
            _actionPending = true;
            _status = "действие с предметом…";

            Socket.EmitWithAck("inventoryItemAction", new Dictionary<string, object>
            {
                ["action"] = action,
                ["itemId"] = itemId,
                ["itemRuntimeId"] = itemRuntimeId,
                ["equipment"] = EquipmentSnapshot()
            }, ack =>
            {
                _actionPending = false;
                if (ack == null) { _status = "нет ответа сервера"; return; }
                Socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    _status = ack["error"]?.ToString() ?? "действие отклонено";
                    return;
                }

                if (action == "repair")
                    _status = RoaItemData.Name(itemId) + ": состояние " + Mathf.RoundToInt(ack["condition"]?.ToObject<float>() ?? 100f) + "%";
                else if (action == "unload")
                    _status = RoaItemData.Name(itemId) + ": возвращено патронов " + (ack["loaded"]?.ToObject<int>() ?? 0);
                else if (action == "salvage")
                    _status = ack["success"]?.ToObject<bool>() == true
                        ? RoaItemData.Name(itemId) + ": материалы получены"
                        : RoaItemData.Name(itemId) + ": разбор не удался";
                else _status = "действие выполнено";
            });
        }

        private void DropItem(string itemRuntimeId, int qty)
        {
            SubmitDropItem(itemRuntimeId, qty);
        }

        /// <summary>Uses the same authoritative drop request as the inventory UI.</summary>
        public bool SubmitDropItem(string itemRuntimeId, int qty, Action<JObject> completed = null)
        {
            if (_actionPending || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;
            string itemId = BaseId(itemRuntimeId);
            if (string.IsNullOrEmpty(itemId) || itemId == "fists") return false;

            _actionPending = true;
            _status = "выбрасывание…";
            Socket.EmitWithAck("dropItem", new Dictionary<string, object>
            {
                ["itemId"] = itemId,
                ["itemRuntimeId"] = itemRuntimeId,
                ["qty"] = Mathf.Max(1, qty)
            }, ack =>
            {
                _actionPending = false;
                if (ack == null) { _status = "нет ответа сервера"; completed?.Invoke(null); return; }
                Socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    _status = ack["error"]?.ToString() ?? "предмет не выброшен";
                    completed?.Invoke(ack);
                    return;
                }

                RoaGroundItems groundItems = GroundItems != null
                    ? GroundItems
                    : GetComponent<RoaGroundItems>();
                if (GroundItems == null) GroundItems = groundItems;
                groundItems?.ApplyDropAck(ack);
                int dropped = ack["item"]?["qty"]?.ToObject<int>() ?? Mathf.Max(1, qty);
                _status = RoaItemData.Name(itemId) + ": выброшено " + dropped + ", ОД -" + (ack["apCost"]?.ToObject<float>() ?? 0f).ToString("0.#");
                completed?.Invoke(ack);
            });
            return true;
        }

        private void SubmitWeaponModification(string itemRuntimeId, string slot, string modificationId)
        {
            if (_actionPending || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            string itemId = BaseId(itemRuntimeId);
            if (!RoaWeaponModificationData.IsFirearm(itemId)) return;

            _actionPending = true;
            _status = string.IsNullOrEmpty(modificationId) ? "снятие детали…" : "установка детали…";
            Socket.EmitWithAck("inventoryItemAction", new Dictionary<string, object>
            {
                ["action"] = "modifyWeapon",
                ["itemId"] = itemId,
                ["itemRuntimeId"] = itemRuntimeId,
                ["modSlot"] = slot,
                ["modificationId"] = modificationId ?? string.Empty,
                ["equipment"] = EquipmentSnapshot()
            }, ack =>
            {
                _actionPending = false;
                if (ack == null) { _status = "нет ответа сервера"; return; }
                Socket.ApplyGameplayAck(ack);
                if (ack["ok"]?.ToObject<bool>() != true)
                {
                    _status = ack["error"]?.ToString() ?? "изменение сборки отклонено";
                    return;
                }

                string resolvedId = ack["itemRuntimeId"]?.ToString() ?? itemRuntimeId;
                if (ack["weaponMods"] is JObject mods)
                    _weaponModifications[resolvedId] = (JObject)mods.DeepClone();
                _modifyWeaponRuntimeId = resolvedId;

                RoaWeaponModificationData.Definition definition =
                    RoaWeaponModificationData.Find(modificationId);
                _status = definition != null
                    ? definition.Name + ": установлено"
                    : RoaWeaponModificationData.SlotLabel(slot) + ": базовая конфигурация";
            });
        }

        private void RememberWeaponModifications(JToken row)
        {
            string runtimeId = row?["id"]?.ToString();
            if (string.IsNullOrEmpty(runtimeId)) return;
            JObject mods = row["weaponMods"] as JObject;
            _weaponModifications[runtimeId] = mods != null
                ? (JObject)mods.DeepClone()
                : new JObject();
        }

        private JObject EquipmentSnapshot()
        {
            var result = new JObject();
            foreach (KeyValuePair<string, string> entry in _equipment) result[entry.Key] = entry.Value;
            return result;
        }

        private float ItemCondition(string itemId)
        {
            return _self?["itemConditions"]?[itemId]?.ToObject<float>() ?? 100f;
        }

        private void OnGUI()
        {
            if (CanvasDriven) return;
            LegacyOnGui();
        }

        private void LegacyOnGui()
        {
            RoaUiTheme.Apply();
            if (!_open) return;
            if (!string.IsNullOrEmpty(_dropPickerItem))
            {
                DrawDropPicker();
                return;
            }

            bool mobileLayout = Quickbar != null && Quickbar.IsMobileVisible;
            float top = mobileLayout ? 104f : 12f;
            float width = mobileLayout
                ? Mathf.Min(720f, Screen.width - 24f)
                : Mathf.Min(500f, Screen.width - 24f);
            float height = Mathf.Min(500f, Screen.height - top - 12f);
            float x = mobileLayout ? (Screen.width - width) * 0.5f : Screen.width - width - 12f;

            var area = new Rect(x, top, width, Mathf.Max(120f, height));
            GUILayout.BeginArea(area, GUI.skin.box);

            GUILayout.Label("<b>Сумка</b>   (Tab — закрыть)", Rich());
            Color previousColor = GUI.color;
            if (_carryWeight > _carryCapacity + 0.0001f) GUI.color = new Color(1f, 0.48f, 0.38f);
            GUILayout.Label("Вес: " + _carryWeight.ToString("0.#") + " / " + _carryCapacity.ToString("0.#") + " кг");
            GUI.color = previousColor;

            GUILayout.Space(4f);
            GUILayout.Label("Экипировано:");

            foreach (string slot in SlotOrder)
            {
                string equipped;
                _equipment.TryGetValue(slot, out equipped);

                GUILayout.BeginHorizontal();
                GUILayout.Label(SlotLabel(slot), GUILayout.Width(80f));
                GUILayout.Label(string.IsNullOrEmpty(equipped) ? "—" : RoaItemData.Name(equipped));

                // Кулаки — встроенное состояние боя, а не предмет: снимать нечего.
                bool canClear = !string.IsNullOrEmpty(equipped) && BaseId(equipped) != "fists";
                if (slot == "weapon" && Firearms.Contains(BaseId(equipped))
                    && (Socket?.Session?.Combat?["loaded"]?.ToObject<int>() ?? 0) > 0
                    && GUILayout.Button("разрядить", GUILayout.Width(82f)))
                    SubmitItemAction("unload", equipped);
                if (RoaWeaponModificationData.IsFirearm(BaseId(equipped))
                    && GUILayout.Button("моды", GUILayout.Width(52f)))
                    SelectWeaponForModification(equipped);
                if (canClear && GUILayout.Button("снять", GUILayout.Width(56f)))
                    // The equipment protocol uses an empty runtime id to clear a
                    // physical item. The server then resolves the right hand to
                    // its built-in fists state; sending "fists" here incorrectly
                    // asks it to find a physical fists instance in the inventory.
                    Equip(slot, string.Empty);

                GUILayout.EndHorizontal();
            }

            GUILayout.Space(6f);
            GUILayout.Label("Предметы:");
            GUILayout.BeginHorizontal();
            GUILayout.Label("Поиск", GUILayout.Width(46f));
            _filter = GUILayout.TextField(_filter ?? string.Empty, GUILayout.MinWidth(90f));
            if (GUILayout.Button("Сортировка: " + SortLabel(_sortMode), GUILayout.Width(168f)))
                _sortMode = (InventorySortMode)(((int)_sortMode + 1) % 3);
            GUILayout.EndHorizontal();

            _scroll = GUILayout.BeginScrollView(_scroll);

            DrawModificationWorkbench();

            if (_items.Count == 0) GUILayout.Label("пусто");

            foreach (Row row in DisplayItems())
            {
                string baseId = BaseId(row.Id);
                GUILayout.BeginHorizontal();
                string condition = RepairableItems.Contains(baseId)
                    ? "  (" + Mathf.RoundToInt(ItemCondition(baseId)) + "%)"
                    : string.Empty;
                float rowWeight = RoaItemData.Weight(baseId) * Mathf.Max(0, row.Qty);
                GUILayout.Label(RoaItemData.Name(baseId) + (row.Qty > 1 ? "  x" + row.Qty : "")
                    + "  · " + rowWeight.ToString("0.###") + " кг" + condition);

                string slot = SlotFor(baseId);
                if (slot != null && GUILayout.Button("надеть", GUILayout.Width(62f)))
                    Equip(slot, row.Id);
                if (RoaWeaponModificationData.IsFirearm(baseId)
                    && GUILayout.Button("моды", GUILayout.Width(52f)))
                    SelectWeaponForModification(row.Id);
                if (MedicalItems.Contains(baseId) && GUILayout.Button("лечить", GUILayout.Width(62f)))
                    HealSelf(baseId);
                if (Quickbar != null && IsQuickAssignable(row.Id)
                    && GUILayout.Button("быстро", GUILayout.Width(62f)))
                    Quickbar.BeginAssign(row.Id);
                if (RepairableItems.Contains(baseId) && ItemCondition(baseId) < 99.995f
                    && GUILayout.Button("ремонт", GUILayout.Width(62f)))
                    SubmitItemAction("repair", row.Id);
                if (SalvageableItems.Contains(baseId) && GUILayout.Button("разобрать", GUILayout.Width(72f)))
                    SubmitItemAction("salvage", row.Id);
                if (baseId != "fists" && GUILayout.Button("выбросить", GUILayout.Width(78f)))
                    DropItem(row.Id, 1);
                if (baseId != "fists" && row.Qty > 1 && GUILayout.Button("кол-во", GUILayout.Width(62f)))
                    OpenDropPicker(row.Id, row.Qty);

                GUILayout.EndHorizontal();
            }

            GUILayout.EndScrollView();

            if (!string.IsNullOrEmpty(_status)) GUILayout.Label(_status);

            GUILayout.EndArea();
        }

        private List<Row> DisplayItems()
        {
            string query = (_filter ?? string.Empty).Trim();
            var rows = new List<Row>();
            foreach (Row row in _items)
            {
                string baseId = BaseId(row.Id);
                if (query.Length > 0
                    && RoaItemData.Name(baseId).IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0
                    && baseId.IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0) continue;
                rows.Add(row);
            }
            rows.Sort((a, b) =>
            {
                if (_sortMode == InventorySortMode.Weight)
                {
                    int byWeight = (RoaItemData.Weight(b.Id) * b.Qty).CompareTo(RoaItemData.Weight(a.Id) * a.Qty);
                    if (byWeight != 0) return byWeight;
                }
                else if (_sortMode == InventorySortMode.Quantity)
                {
                    int byQty = b.Qty.CompareTo(a.Qty);
                    if (byQty != 0) return byQty;
                }
                return string.Compare(RoaItemData.Name(a.Id), RoaItemData.Name(b.Id), StringComparison.CurrentCultureIgnoreCase);
            });
            return rows;
        }

        private static string SortLabel(InventorySortMode mode)
        {
            if (mode == InventorySortMode.Weight) return "по весу";
            if (mode == InventorySortMode.Quantity) return "по количеству";
            return "по имени";
        }

        private void OpenDropPicker(string itemRuntimeId, int max)
        {
            if (string.IsNullOrEmpty(itemRuntimeId) || max <= 1) return;
            _dropPickerItem = itemRuntimeId;
            _dropPickerMax = Mathf.Max(1, max);
            _dropPickerQty = 1;
        }

        private void CloseDropPicker()
        {
            _dropPickerItem = string.Empty;
            _dropPickerMax = 1;
            _dropPickerQty = 1;
        }

        private void DrawDropPicker()
        {
            float width = Mathf.Min(420f, Screen.width - 24f);
            float height = 210f;
            Rect area = new Rect((Screen.width - width) * 0.5f, (Screen.height - height) * 0.5f,
                                 width, height);
            GUILayout.BeginArea(area, GUI.skin.window);
            GUILayout.Label("<b>Выбросить: " + RoaItemData.Name(_dropPickerItem) + "</b>", Rich());
            GUILayout.Label("В рюкзаке: " + _dropPickerMax + " · выбрано: " + _dropPickerQty);
            _dropPickerQty = Mathf.Clamp(Mathf.RoundToInt(GUILayout.HorizontalSlider(
                _dropPickerQty, 1f, _dropPickerMax, GUILayout.Height(28f))), 1, _dropPickerMax);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("−")) _dropPickerQty = Mathf.Max(1, _dropPickerQty - 1);
            if (GUILayout.Button("Половина")) _dropPickerQty = Mathf.Max(1, Mathf.CeilToInt(_dropPickerMax * 0.5f));
            if (GUILayout.Button("Всё")) _dropPickerQty = _dropPickerMax;
            if (GUILayout.Button("+")) _dropPickerQty = Mathf.Min(_dropPickerMax, _dropPickerQty + 1);
            GUILayout.EndHorizontal();
            GUILayout.FlexibleSpace();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Отмена", GUILayout.Height(34f))) CloseDropPicker();
            if (GUILayout.Button("Выбросить", GUILayout.Height(34f)))
            {
                string itemId = _dropPickerItem;
                int qty = _dropPickerQty;
                CloseDropPicker();
                DropItem(itemId, qty);
            }
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        // --- Фасад контекстного меню предмета (RoaItemContextMenu, web showItemContextMenu 03d:229) ---

        public bool IsRepairable(string itemOrRuntimeId) { return RepairableItems.Contains(BaseId(itemOrRuntimeId)); }
        public bool IsSalvageable(string itemOrRuntimeId) { return SalvageableItems.Contains(BaseId(itemOrRuntimeId)); }
        public bool IsFirearmItem(string itemOrRuntimeId) { return Firearms.Contains(BaseId(itemOrRuntimeId)); }
        public bool IsMedical(string itemOrRuntimeId) { return MedicalItems.Contains(BaseId(itemOrRuntimeId)); }
        public float ConditionPercent(string itemOrRuntimeId) { return ItemCondition(BaseId(itemOrRuntimeId)); }
        /// <summary>repair / unload / salvage — inventoryItemAction сервера.</summary>
        public void ItemAction(string action, string itemRuntimeId) { SubmitItemAction(action, itemRuntimeId); }

        // --- Фасад для канва-верстака (RoaWorkbenchCanvas) ---

        public string ModifyWeaponRuntimeId { get { return _modifyWeaponRuntimeId; } }
        public string ModifySlot { get { return _modifySlot; } set { _modifySlot = value ?? "barrel"; } }
        public bool ActionPending { get { return _actionPending; } }
        public string ActionStatus { get { return _status ?? string.Empty; } }

        /// <summary>Открыть верстак для огнестрела (openWeaponModificationWorkbench web).</summary>
        public bool OpenWorkbench(string itemRuntimeId)
        {
            string baseId = BaseId(itemRuntimeId);
            if (!RoaWeaponModificationData.IsFirearm(baseId)) { _status = "Это оружие не поддерживает сменные узлы."; return false; }
            if (!OwnsItem(itemRuntimeId)) { _status = "Выбранный экземпляр оружия больше недоступен."; return false; }
            SelectWeaponForModification(itemRuntimeId);
            return true;
        }

        public void CloseWorkbench() { _modifyWeaponRuntimeId = string.Empty; }
        public JObject InstalledModsFor(string runtimeId) { return InstalledMods(runtimeId); }
        public void SubmitModification(string runtimeId, string slot, string modificationId) { SubmitWeaponModification(runtimeId, slot, modificationId); }
        public bool CanAffordCost(Dictionary<string, int> cost) { return CanAfford(cost); }
        public int CountOf(string itemId) { return InventoryQty(itemId); }
        public float ConditionOf(string runtimeId) { return ItemCondition(BaseId(runtimeId)); }

        /// <summary>Сигнатура содержимого рюкзака — для перестроения списков при изменении.</summary>
        public string InventorySignature()
        {
            var sb = new System.Text.StringBuilder();
            foreach (Row row in _items) sb.Append(row.Id).Append(':').Append(row.Qty).Append(';');
            return sb.ToString();
        }

        private void SelectWeaponForModification(string itemRuntimeId)
        {
            _modifyWeaponRuntimeId = itemRuntimeId ?? string.Empty;
            string[] slots = RoaWeaponModificationData.SlotsFor(BaseId(_modifyWeaponRuntimeId));
            _modifySlot = slots.Length > 0 ? slots[0] : "barrel";
            _status = string.Empty;
        }

        private void DrawModificationWorkbench()
        {
            if (string.IsNullOrEmpty(_modifyWeaponRuntimeId)) return;
            string weaponId = BaseId(_modifyWeaponRuntimeId);
            if (!RoaWeaponModificationData.IsFirearm(weaponId))
            {
                _modifyWeaponRuntimeId = string.Empty;
                return;
            }

            GUILayout.BeginVertical(GUI.skin.box);
            GUILayout.BeginHorizontal();
            GUILayout.Label("<b>Оружейная мастерская: " + RoaItemData.Name(weaponId) + "</b>", Rich());
            if (GUILayout.Button("закрыть", GUILayout.Width(62f)))
            {
                _modifyWeaponRuntimeId = string.Empty;
                GUILayout.EndHorizontal();
                GUILayout.EndVertical();
                return;
            }
            GUILayout.EndHorizontal();

            string[] slots = RoaWeaponModificationData.SlotsFor(weaponId);
            GUILayout.BeginHorizontal();
            foreach (string slot in slots)
            {
                bool selected = slot == _modifySlot;
                string label = (selected ? "[" : string.Empty)
                    + RoaWeaponModificationData.SlotLabel(slot)
                    + (selected ? "]" : string.Empty);
                if (GUILayout.Button(label)) _modifySlot = slot;
            }
            GUILayout.EndHorizontal();

            JObject installedMods = InstalledMods(_modifyWeaponRuntimeId);
            string installedId = installedMods?[_modifySlot]?.ToString() ?? string.Empty;
            RoaWeaponModificationData.Definition installed = RoaWeaponModificationData.Find(installedId);
            GUILayout.Label("Установлено: " + (installed != null ? installed.Name : "базовая деталь"));
            if (installed != null)
            {
                bool oldEnabled = GUI.enabled;
                GUI.enabled = oldEnabled && !_actionPending;
                if (GUILayout.Button("Снять " + RoaWeaponModificationData.SlotLabel(_modifySlot)))
                    SubmitWeaponModification(_modifyWeaponRuntimeId, _modifySlot, string.Empty);
                GUI.enabled = oldEnabled;
            }

            foreach (RoaWeaponModificationData.Definition definition in RoaWeaponModificationData.All)
            {
                if (definition.Slot != _modifySlot
                    || !RoaWeaponModificationData.Compatible(definition, weaponId)) continue;

                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>" + definition.Name + "</b> — " + definition.Effect, Rich());
                GUILayout.Label("Материалы: " + CostText(definition.Cost));

                bool isInstalled = installedId == definition.Id;
                bool oldEnabled = GUI.enabled;
                GUI.enabled = oldEnabled && !_actionPending && !isInstalled && CanAfford(definition.Cost);
                if (GUILayout.Button(isInstalled ? "установлено" : "установить"))
                    SubmitWeaponModification(_modifyWeaponRuntimeId, definition.Slot, definition.Id);
                GUI.enabled = oldEnabled;
                GUILayout.EndVertical();
            }
            GUILayout.EndVertical();
            GUILayout.Space(6f);
        }

        private JObject InstalledMods(string runtimeId)
        {
            if (_weaponModifications.TryGetValue(runtimeId ?? string.Empty, out JObject mods)) return mods;
            string baseId = BaseId(runtimeId);
            if (_weaponModifications.TryGetValue(baseId ?? string.Empty, out mods)) return mods;
            return null;
        }

        private bool CanAfford(Dictionary<string, int> cost)
        {
            foreach (KeyValuePair<string, int> entry in cost)
                if (InventoryQty(entry.Key) < entry.Value) return false;
            return true;
        }

        private int InventoryQty(string itemId)
        {
            int total = 0;
            foreach (Row row in _items)
                if (BaseId(row.Id) == itemId) total += Mathf.Max(0, row.Qty);
            return total;
        }

        private string CostText(Dictionary<string, int> cost)
        {
            var parts = new List<string>();
            foreach (KeyValuePair<string, int> entry in cost)
                parts.Add(RoaItemData.Name(entry.Key) + " " + InventoryQty(entry.Key) + "/" + entry.Value);
            return string.Join(", ", parts);
        }

        private static string SlotLabel(string slot)
        {
            if (slot == "weapon") return "оружие";
            if (slot == "offhand") return "вторая рука";
            if (slot == "armor") return "броня";
            if (slot == "helmet") return "шлем";
            if (slot == "boots") return "обувь";
            if (slot == "backpack") return "рюкзак";
            return slot;
        }

        /// <summary>Базовый id из runtime-ключа "ui_{base}_{a}_{b}".</summary>
        public static string BaseId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId;

            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        private static GUIStyle Rich()
        {
            var style = new GUIStyle(GUI.skin.label);
            style.richText = true;
            return style;
        }
    }
}
