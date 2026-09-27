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
                { "backpack", new HashSet<string>(new[] { "backpack" }) },
                { "detector", new HashSet<string>(new[] { "artifactDetectorMk1", "artifactDetectorMk2", "artifactDetectorMk3" }) },
                { "artifactBelt", new HashSet<string>(new[] { "artifactBelt2", "artifactBelt3", "artifactBelt4" }) },
                { "vehicle", new HashSet<string>(new[] { "motorcycle" }) }
            };

        private static readonly string[] SlotOrder = { "weapon", "offhand", "armor", "helmet", "boots", "backpack", "detector", "artifactBelt", "vehicle" };

        /// <summary>Сколько слотов экипировки у персонажа (шапка «N/9 СЛОТОВ»).</summary>
        public static int SlotCount { get { return SlotOrder.Length; } }

        private static readonly HashSet<string> MedicalItems = new HashSet<string>(new[]
        {
            "medkit", "stim", "doctorBag", "antibiotics", "food", "water"
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
        private int _marks;
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
        private string _filter = string.Empty;

        public bool IsOpen { get { return _open; } }

        /// <summary>Новый Pip-Boy на канве рисует и обслуживает окно сам; IMGUI и клавиша выключаются.</summary>
        public bool CanvasDriven { get; set; }

        /// <summary>
        /// Строки рюкзака: базовые id и количество, как отдал сервер. Марок
        /// среди них нет: марки — счёт аккаунта (Marks, CountOf("silver")).
        /// </summary>
        public System.Collections.Generic.IReadOnlyList<Row> Items { get { return _items; } }

        /// <summary>Марки на счёте аккаунта — не предмет рюкзака.</summary>
        public int Marks { get { return _marks; } }

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
            // Строки сумки несут базовый id; экземпляр огнестрела в ней сервер
            // называет отдельно, в weaponInventoryRuntime.
            if (_self?["weaponInventoryRuntime"] is JArray records)
                foreach (JToken row in records)
                    if (row["id"]?.ToString() == itemRuntimeId) return true;
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
                _marks = 0;
                foreach (JToken row in inventory)
                {
                    string id = row["id"]?.ToString();
                    if (string.IsNullOrEmpty(id)) continue;
                    int qty = row["qty"]?.ToObject<int>() ?? 0;
                    // Марки лежат на счёте аккаунта: в сетках рюкзака их нет.
                    if (id == "silver") { _marks += Mathf.Max(0, qty); continue; }

                    _items.Add(new Row { Id = id, Qty = qty });
                }
            }
            JToken accountMarks = self["account"]?["marks"];
            if (accountMarks != null && (accountMarks.Type == JTokenType.Integer || accountMarks.Type == JTokenType.Float))
                _marks = Mathf.Max(0, accountMarks.ToObject<int>());

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
            float artifactCarry = _self?["artifactEffects"]?["carryKg"]?.ToObject<float>() ?? 0f;
            _carryCapacity = RoaItemData.CarryCapacity(strength, backpackEquipped) + artifactCarry;
        }

        /// <summary>
        /// Первый слот, куда подходит предмет. Источник правды — серверный каталог
        /// (compatibleSlots): списки ниже остались лишь запасным вариантом до его
        /// загрузки. Раньше они были единственным источником и успели отстать, из-за
        /// чего скрафченные револьвер, обрез и пистолет-пулемёт нельзя было взять в руки.
        /// </summary>
        public static string SlotFor(string itemId)
        {
            if (RoaItemData.Contains(itemId))
            {
                // Повторяем правило сервера (serverCatalogItemIdsForSlot): слот берётся
                // из поля slot, и только вторая рука смотрит на compatibleSlots. Иначе
                // артефакт со слотом artifact предлагался бы как пояс и получал отказ.
                string catalogSlot = RoaItemData.Slot(itemId);
                foreach (string slot in SlotOrder)
                {
                    if (slot == "offhand")
                    {
                        if (Array.IndexOf(RoaItemData.CompatibleSlots(itemId), slot) >= 0) return slot;
                        continue;
                    }
                    if (!string.IsNullOrEmpty(catalogSlot) && catalogSlot == slot) return slot;
                }
                return null;
            }

            foreach (string slot in SlotOrder)
            {
                HashSet<string> allowed;
                if (SlotItems.TryGetValue(slot, out allowed) && allowed.Contains(itemId)) return slot;
            }
            return null;
        }

        /// <summary>
        /// Экипировка — штучная вещь: у каждой свой износ, магазин и сборка, поэтому
        /// в сетках она лежит по одной, а не стопкой «×3». Расходник, который тоже
        /// берётся в руку (аптечка), остаётся стопкой: износа у него нет.
        /// </summary>
        public static bool IsGear(string itemOrRuntimeId)
        {
            string baseId = BaseId(itemOrRuntimeId);
            if (string.IsNullOrEmpty(baseId) || baseId == "fists" || SlotFor(baseId) == null) return false;
            return RoaItemData.ConditionMode(baseId) != "none" || RepairableItems.Contains(baseId);
        }

        /// <summary>
        /// Runtime-id экземпляров, лежащих в сумке. Сервер ведёт их только для
        /// огнестрела (weaponInventoryRuntime — уже без надетого); остальным и
        /// экземплярам без записи достаётся базовый id.
        /// </summary>
        public List<string> BagInstanceIds(string baseId, int count)
        {
            var result = new List<string>();
            if (_self?["weaponInventoryRuntime"] is JArray records)
                foreach (JToken row in records)
                {
                    if (row["baseId"]?.ToString() != baseId) continue;
                    string id = row["id"]?.ToString();
                    int qty = Mathf.Max(1, row["qty"]?.ToObject<int>() ?? 1);
                    for (int i = 0; i < qty && result.Count < count; i++)
                        result.Add(string.IsNullOrEmpty(id) ? baseId : id);
                }
            while (result.Count < count) result.Add(baseId);
            return result;
        }

        /// <summary>
        /// Состояние экземпляра из сумки. ConditionPercent для базового id сначала
        /// смотрит на надетый экземпляр — запасной ствол показывал бы чужой износ.
        /// </summary>
        public float BagConditionPercent(string itemOrRuntimeId)
        {
            if (_self?["weaponInventoryRuntime"] is JArray records)
                foreach (JToken row in records)
                    if (row["id"]?.ToString() == itemOrRuntimeId && row["condition"] != null)
                        return row["condition"].ToObject<float>();
            return _self?["itemConditions"]?[BaseId(itemOrRuntimeId)]?.ToObject<float>() ?? 100f;
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
            itemRuntimeId = DistinctHandInstanceId(slot, itemRuntimeId);

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

        /// <summary>
        /// Сервер различает оружие в руках по id экземпляра и один ключ в обеих руках
        /// отклоняет («один экземпляр оружия нельзя держать сразу в двух руках»). Второй
        /// такой же ствол из сумки без собственной записи приходит под базовым id — тем
        /// же, что у надетого, — и пара одинаковых пистолетов не собиралась. Такому
        /// стволу выдаётся новый id экземпляра в серверном формате ui_{base}_{a}_{b}.
        /// </summary>
        private string DistinctHandInstanceId(string slot, string itemRuntimeId)
        {
            if (string.IsNullOrEmpty(itemRuntimeId) || (slot != "weapon" && slot != "offhand")) return itemRuntimeId;
            string held;
            if (!_equipment.TryGetValue(slot == "weapon" ? "offhand" : "weapon", out held) || held != itemRuntimeId)
                return itemRuntimeId;
            // Собственный id (ui_…) в другой руке — это тот же самый предмет, его
            // перекладывают из руки в руку. Новый экземпляр нужен только запасному.
            string baseId = BaseId(itemRuntimeId);
            if (itemRuntimeId != baseId || InventoryQty(baseId) <= 0) return itemRuntimeId;
            return NewInstanceId(baseId);
        }

        /// <summary>Формат serverNewWeaponRuntimeId (server.js): ui_{base}_{время base36}_{8 hex}.</summary>
        public static string NewInstanceId(string baseId)
        {
            const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
            long value = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var time = new System.Text.StringBuilder();
            do { time.Insert(0, digits[(int)(value % 36)]); value /= 36; } while (value > 0);
            return "ui_" + baseId + "_" + time + "_" + Guid.NewGuid().ToString("N").Substring(0, 8);
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
                _status = (ack["hydrated"]?.ToObject<float>() ?? 0f) > 0f
                    ? "запас воды пополнен"
                    : !string.IsNullOrEmpty(cured)
                    ? "вылечено: " + cured
                    : (healed > 0 ? "восстановлено HP: " + healed : "лечение выполнено");
            });
        }

        private void SubmitItemAction(string action, string itemRuntimeId)
        {
            if (_actionPending || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            if (action == "repair") itemRuntimeId = RepairRuntimeId(itemRuntimeId);
            string itemId = BaseId(itemRuntimeId);
            _actionPending = true;
            _status = "действие с предметом…";

            Socket.EmitWithAck("inventoryItemAction", new Dictionary<string, object>
            {
                ["requestId"] = Guid.NewGuid().ToString("N"),
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
                ["requestId"] = Guid.NewGuid().ToString("N"),
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
            string baseId = BaseId(itemId);
            string runtimeId = RepairRuntimeId(itemId);
            foreach (string key in new[] { "weaponInventoryRuntime", "weaponModifications" })
                if (_self?[key] is JArray records)
                    foreach (JToken row in records)
                        if (row["id"]?.ToString() == runtimeId && row["condition"] != null)
                            return row["condition"].ToObject<float>();
            return _self?["itemConditions"]?[baseId]?.ToObject<float>() ?? 100f;
        }

        private string RepairRuntimeId(string itemId)
        {
            string baseId = BaseId(itemId);
            if (itemId != baseId) return itemId;
            foreach (var entry in _equipment)
                if (BaseId(entry.Value) == baseId) return entry.Value;
            if (_self?["weaponInventoryRuntime"] is JArray records)
                foreach (JToken row in records)
                    if (row["baseId"]?.ToString() == baseId) return row["id"]?.ToString() ?? itemId;
            return itemId;
        }

        /// <summary>Все записи артефактов персонажа (серверная проекция без скрытых свойств).</summary>
        public List<JObject> ArtifactRecords()
        {
            var result = new List<JObject>();
            if (_self?["artifactRecords"] is JArray records)
                foreach (JToken token in records)
                    if (token is JObject row) result.Add((JObject)row.DeepClone());
            return result;
        }

        public List<JObject> ArtifactsFor(string itemId)
        {
            var result = new List<JObject>();
            if (_self?["artifactRecords"] is JArray records)
                foreach (JObject row in records)
                    if (row["itemId"]?.ToString() == itemId) result.Add((JObject)row.DeepClone());
            return result;
        }

        public bool ArtifactEquipped(string recordId)
        {
            if (_self?["artifactSlots"] is JArray slots)
                foreach (JToken slot in slots) if (slot.ToString() == recordId) return true;
            return false;
        }

        public bool SubmitArtifactAction(string action, string recordId, Action<JObject> completed = null)
        {
            if (_actionPending || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;
            _actionPending = true;
            var payload = new Dictionary<string, object> { ["recordId"] = recordId, ["action"] = action };
            // Append to the next free slot. A full belt must not silently replace an artifact.
            payload["slotIndex"] = (_self?["artifactSlots"] as JArray)?.Count ?? 0;
            Action<JObject> onAck = ack =>
            {
                _actionPending = false;
                if (ack != null) Socket.ApplyGameplayAck(ack);
                _status = ack?["ok"]?.ToObject<bool>() == true ? string.Empty : ack?["error"]?.ToString() ?? "Нет ответа сервера.";
                completed?.Invoke(ack);
            };
            if (action == "stabilize") Socket.EmitWithAck("stabilizeArtifact", payload, onAck);
            else if (action == "salvage") Socket.EmitWithAck("salvageArtifact", payload, onAck);
            else Socket.EmitWithAck("artifactLoadoutAction", payload, onAck);
            return true;
        }

        private void CloseDropPicker()
        {
            _dropPickerItem = string.Empty;
        }

        // --- Фасад контекстного меню предмета (RoaItemContextMenu, web showItemContextMenu 03d:229) ---

        /// <summary>Ремонтируется всё, что изнашивается: вариант тира — как его исходник.</summary>
        public bool IsRepairable(string itemOrRuntimeId)
        {
            string baseId = BaseId(itemOrRuntimeId);
            return RepairableItems.Contains(RoaItemData.TierGroup(baseId))
                || (RoaItemData.Contains(baseId) && baseId != "fists" && RoaItemData.ConditionMode(baseId) != "none");
        }
        public bool IsSalvageable(string itemOrRuntimeId) { return SalvageableItems.Contains(BaseId(itemOrRuntimeId)); }
        /// <summary>
        /// Огнестрел определяется наличием типа патронов в каталоге: у ножа, кулаков
        /// и инструментов его нет. Список ниже работает, пока каталог не загружен.
        /// </summary>
        public bool IsFirearmItem(string itemOrRuntimeId)
        {
            string baseId = BaseId(itemOrRuntimeId);
            if (RoaItemData.Contains(baseId))
                return !string.IsNullOrEmpty(RoaItemData.AmmoType(baseId));
            return Firearms.Contains(baseId);
        }
        public bool IsMedical(string itemOrRuntimeId) { return MedicalItems.Contains(BaseId(itemOrRuntimeId)); }
        public float ConditionPercent(string itemOrRuntimeId) { return ItemCondition(itemOrRuntimeId); }
        /// <summary>repair / unload / salvage — inventoryItemAction сервера.</summary>
        public void ItemAction(string action, string itemRuntimeId) { SubmitItemAction(action, itemRuntimeId); }

        // --- Фасад для канва-верстака (RoaWorkbenchCanvas) ---

        public string ModifyWeaponRuntimeId { get { return _modifyWeaponRuntimeId; } }
        public string ModifySlot { get { return _modifySlot; } set { _modifySlot = value ?? "barrel"; } }
        public bool ActionPending { get { return _actionPending; } }
        public string ActionStatus { get { return _status ?? string.Empty; } }
        public string ArtifactStatus
        {
            get { return GetComponent<RoaHud>()?.ArtifactStatus ?? string.Empty; }
        }

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
        public float ConditionOf(string runtimeId) { return ItemCondition(runtimeId); }

        /// <summary>Сигнатура содержимого рюкзака — для перестроения списков при изменении.</summary>
        public string InventorySignature()
        {
            var sb = new System.Text.StringBuilder();
            foreach (Row row in _items) sb.Append(row.Id).Append(':').Append(row.Qty).Append(';');
            sb.Append("marks:").Append(_marks);
            return sb.ToString();
        }

        private void SelectWeaponForModification(string itemRuntimeId)
        {
            _modifyWeaponRuntimeId = itemRuntimeId ?? string.Empty;
            string[] slots = RoaWeaponModificationData.SlotsFor(BaseId(_modifyWeaponRuntimeId));
            _modifySlot = slots.Length > 0 ? slots[0] : "barrel";
            _status = string.Empty;
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
            if (itemId == "silver") return _marks;
            int total = 0;
            foreach (Row row in _items)
                if (BaseId(row.Id) == itemId) total += Mathf.Max(0, row.Qty);
            return total;
        }

        private static string SlotLabel(string slot)
        {
            if (slot == "weapon") return "оружие";
            if (slot == "offhand") return "вторая рука";
            if (slot == "armor") return "броня";
            if (slot == "helmet") return "шлем";
            if (slot == "boots") return "обувь";
            if (slot == "backpack") return "рюкзак";
            if (slot == "detector") return "детектор";
            if (slot == "artifactBelt") return "арт-пояс";
            if (slot == "vehicle") return "транспорт";
            return slot;
        }

        /// <summary>Базовый id из runtime-ключа "ui_{base}_{a}_{b}".</summary>
        public static string BaseId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId;

            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

    }
}
