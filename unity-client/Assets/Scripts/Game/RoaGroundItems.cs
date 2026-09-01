using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Предметы на земле: метки в мире и подбор.
    ///
    /// Полный состав задаёт серверный снимок, а надёжные drop/pickup-события
    /// обновляют одну метку сразу, не дожидаясь следующего baseline. Подбор отправляется запросом
    /// <c>pickupGroundItem</c>, и сервер сам проверяет вес, свободное место
    /// в стаке и дистанцию: при отказе предмет остаётся на карте
    /// (docs/wiki/SOCKET_EVENTS.md). Поэтому метка не убирается локально —
    /// она исчезнет следующим снимком, когда подбор действительно состоялся.
    /// </summary>
    public sealed class RoaGroundItems : MonoBehaviour
    {
        public RoaSocketClient Socket;
        public RoaPlayerController Player;
        public RoaInteraction Interaction;

        [Tooltip("Туман войны. Пока не назначен, предметы видны всегда.")]
        public RoaFogOfWar Fog;

        [Tooltip("С какого расстояния можно подобрать, м.")]
        public float PickupRange = 2.2f;

        [Tooltip("Клавиша подбора ближайшего предмета.")]
        public KeyCode PickupKey = KeyCode.E;

        private sealed class GroundItem
        {
            public string Id;
            public string ItemId;
            public int Qty;
            public Vector3 Position;
            public GameObject Marker;
            public Renderer Renderer;
            public GameObject Visual;
            public Renderer[] VisualRenderers;
            public string VisualItemId;
            public int VisualRequest;
            public bool VisualLoading;
            public int VisualFailures;
            public float VisualRetryAt;
        }

        private readonly Dictionary<string, GroundItem> _items = new Dictionary<string, GroundItem>();
        private static readonly Dictionary<string, Task<GltfImport>> ModelCache =
            new Dictionary<string, Task<GltfImport>>();

        private static readonly HashSet<string> LibraryItems = new HashSet<string>(new[]
        {
            "ammo9", "ammo556", "energyCell", "napalm", "shotgunShell", "rocketAmmo",
            "medkit", "stim", "doctorBag", "antibiotics", "ore", "wood", "scrap", "oil",
            "chemicals", "medicine", "electronics", "ammoParts", "food", "weaponParts",
            "silver", "trophy", "water", "repairKit"
        });

        private static readonly HashSet<string> WeaponItems = new HashSet<string>(new[]
        {
            "pistol", "rifle", "assaultRifle", "machineGun", "laserPistol", "flamethrower",
            "plasmaRifle", "shotgun", "rocketLauncher", "revolver", "sawedOffShotgun", "smg",
            "knife", "pickaxe", "axe", "handPump"
        });

        private static readonly Dictionary<string, string> EquipmentModels =
            new Dictionary<string, string>
            {
                { "leather", "/assets/models/equipment/armor/equipment_leather_jacket_male_medium.glb" },
                { "metalArmor", "/assets/models/equipment/armor/equipment_metal_armor_male_medium.glb" },
                { "ballisticVest", "/assets/models/equipment/armor/equipment_ballistic_vest_male_medium.glb" },
                { "combatArmor", "/assets/models/equipment/armor/equipment_combat_armor_male_medium.glb" },
                { "heavyArmor", "/assets/models/equipment/armor/equipment_heavy_armor_male_medium.glb" },
                { "hazmatSuit", "/assets/models/equipment/armor/equipment_hazmat_suit_male_medium.glb" },
                { "energySuit", "/assets/models/equipment/armor/equipment_energy_suit_male_medium.glb" },
                { "backpack", "/assets/models/equipment/backpack/equipment_backpack_male_medium.glb" },
                { "boots", "/assets/models/equipment/boots/equipment_boots_male_medium.glb" },
                { "assaultBoots", "/assets/models/equipment/boots/equipment_assault_boots_male_medium.glb" },
                { "reinforcedBoots", "/assets/models/equipment/boots/equipment_reinforced_boots_male_medium.glb" },
                { "scoutBoots", "/assets/models/equipment/boots/equipment_scout_boots_male_medium.glb" },
                { "preWarHelmet", "/assets/models/equipment/helmet/equipment_prewar_helmet_male_medium.glb" },
                { "weldedHelmet", "/assets/models/equipment/helmet/equipment_welded_helmet_male_medium.glb" },
                { "helmet", "/assets/models/equipment/helmet/equipment_steel_helmet_male_medium.glb" },
                { "tacticalHelmet", "/assets/models/equipment/helmet/equipment_tactical_helmet_male_medium.glb" },
                { "assaultHelmet", "/assets/models/equipment/helmet/equipment_assault_helmet_male_medium.glb" }
            };

        private string _status = string.Empty;
        private float _statusUntil;
        private Material _markerMaterial;

        /// <summary>Основной Unity HUD показывает подписи через общий uGUI overlay.</summary>
        public bool CanvasDriven { get; set; }

        /// <summary>Сколько предметов лежит в комнате. Для диагностики.</summary>
        public int Count { get { return _items.Count; } }

        /// <summary>Number of authoritative ground items that already have a physical model.</summary>
        public int LoadedVisualCount
        {
            get
            {
                int count = 0;
                foreach (GroundItem item in _items.Values)
                    if (item != null && item.Visual != null) count++;
                return count;
            }
        }

        /// <summary>Number of items still represented by the safe loading marker.</summary>
        public int FallbackVisualCount { get { return Mathf.Max(0, Count - LoadedVisualCount); } }

        public int LoadedVisualCountForItem(string itemId)
        {
            int count = 0;
            foreach (GroundItem item in _items.Values)
                if (item != null && item.ItemId == itemId && item.Visual != null) count++;
            return count;
        }

        public int CountForItem(string itemId)
        {
            int count = 0;
            foreach (GroundItem item in _items.Values)
                if (item != null && item.ItemId == itemId) count++;
            return count;
        }

        private void OnEnable()
        {
            if (Socket == null) return;
            Socket.OnGroundItems += HandleSnapshot;
            Socket.OnGroundItemDropped += HandleDropped;
            Socket.OnGroundItemPicked += HandlePicked;
            Socket.OnJoined += HandleJoined;
        }

        private void OnDisable()
        {
            if (Socket == null) return;
            Socket.OnGroundItems -= HandleSnapshot;
            Socket.OnGroundItemDropped -= HandleDropped;
            Socket.OnGroundItemPicked -= HandlePicked;
            Socket.OnJoined -= HandleJoined;
        }

        private void HandleJoined(JoinAck ack)
        {
            Clear();
        }

        private void HandleSnapshot(JObject payload)
        {
            JArray rows = payload["items"] as JArray;
            if (rows == null) return;

            var seen = new HashSet<string>();

            foreach (JToken row in rows)
            {
                string id = row["id"]?.ToString();
                if (string.IsNullOrEmpty(id)) continue;

                seen.Add(id);
                Upsert(row as JObject);
            }

            var stale = new List<string>();
            foreach (string id in _items.Keys)
                if (!seen.Contains(id)) stale.Add(id);

            foreach (string id in stale) Remove(id);
        }

        private void HandleDropped(JObject payload)
        {
            Upsert(payload?["item"] as JObject);
        }

        /// <summary>
        /// The dropping client already receives the authoritative public item in
        /// the ACK. Apply it immediately; the room event/snapshot will safely
        /// upsert the same id again for reconciliation and other clients.
        /// </summary>
        public void ApplyDropAck(JObject ack)
        {
            if (ack?["ok"]?.ToObject<bool>() != true) return;
            Upsert(ack["item"] as JObject);
        }

        private void HandlePicked(JObject payload)
        {
            string id = payload?["id"]?.ToString() ?? payload?["item"]?["id"]?.ToString();
            if (!string.IsNullOrEmpty(id)) Remove(id);
        }

        private void Upsert(JObject row)
        {
            string id = row?["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;

            if (!_items.TryGetValue(id, out GroundItem item))
            {
                item = new GroundItem { Id = id };
                _items[id] = item;
                item.Marker = CreateMarker();
                item.Renderer = item.Marker.GetComponent<MeshRenderer>();
            }

            item.ItemId = row["itemId"]?.ToString() ?? string.Empty;
            item.Qty = row["qty"]?.ToObject<int>() ?? 1;
            item.Position = RoaCoords.ToUnity(
                row["x"]?.ToObject<float>() ?? 0f,
                row["z"]?.ToObject<float>() ?? 0f);
            if (item.Marker != null)
                item.Marker.transform.position = item.Position + Vector3.up * 0.12f;

            if (item.VisualItemId != item.ItemId)
            {
                item.VisualRequest++;
                item.VisualItemId = item.ItemId;
                item.VisualLoading = false;
                item.VisualFailures = 0;
                item.VisualRetryAt = 0f;
                if (item.Visual != null) Destroy(item.Visual);
                item.Visual = null;
                item.VisualRenderers = null;
                ApplyVisibility(item);
                BeginVisualLoad(item);
            }
        }

        /// <summary>
        /// Метка-заглушка остаётся видимой, пока GLB грузится или если для id нет модели.
        /// </summary>
        private GameObject CreateMarker()
        {
            var marker = GameObject.CreatePrimitive(PrimitiveType.Cube);
            marker.name = "GroundItem";
            marker.transform.SetParent(transform, false);
            marker.transform.localScale = new Vector3(0.22f, 0.08f, 0.22f);

            Object.Destroy(marker.GetComponent<Collider>());

            var renderer = marker.GetComponent<MeshRenderer>();
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (shader != null && renderer != null)
            {
                renderer.sharedMaterial = EnsureMarkerMaterial(shader);
            }

            return marker;
        }

        private Material EnsureMarkerMaterial(Shader shader)
        {
            if (_markerMaterial != null) return _markerMaterial;
            if (shader == null) return null;
            _markerMaterial = new Material(shader) { name = "GroundItemLoadingMarker" };
            _markerMaterial.color = new Color(0.95f, 0.78f, 0.32f);
            return _markerMaterial;
        }

        private void BeginVisualLoad(GroundItem item)
        {
            if (item == null || item.Visual != null || item.VisualLoading) return;
            string kind;
            if (string.IsNullOrEmpty(ModelPath(item.ItemId, out kind))) return;
            item.VisualLoading = true;
            item.VisualRetryAt = 0f;
            _ = LoadVisualGuarded(item, item.ItemId, item.VisualRequest);
        }

        private async Task LoadVisualGuarded(GroundItem item, string itemId, int request)
        {
            string kind;
            string path = ModelPath(itemId, out kind);
            if (string.IsNullOrEmpty(path)) return;

            try
            {
                GltfImport import = await LoadCached(BaseModelUrl(path));
                if (!VisualRequestIsCurrent(item, itemId, request)) return;
                if (import == null)
                {
                    ScheduleVisualRetry(item);
                    return;
                }

                var holder = new GameObject("GroundItemModel:" + itemId);
                holder.transform.SetParent(item.Marker.transform, false);
                if (!await import.InstantiateMainSceneAsync(holder.transform))
                {
                    Destroy(holder);
                    Debug.LogWarning("[ROA] Не удалось создать физическую модель предмета: " + itemId);
                    ScheduleVisualRetry(item);
                    return;
                }
                if (!VisualRequestIsCurrent(item, itemId, request))
                {
                    if (holder != null) Destroy(holder);
                    return;
                }

                if (kind == "library")
                {
                    GameObject isolated = IsolateLibraryItem(holder, itemId);
                    if (isolated == null)
                    {
                        Destroy(holder);
                        Debug.LogWarning("[ROA] В ground_item_library.glb нет узла ground_item_" + itemId);
                        ScheduleVisualRetry(item);
                        return;
                    }
                    holder = isolated;
                }
                if (!FitPhysicalModel(holder, kind))
                {
                    Destroy(holder);
                    Debug.LogWarning("[ROA] У физической модели нет отображаемых мешей: " + itemId);
                    ScheduleVisualRetry(item);
                    return;
                }

                item.Visual = holder;
                item.VisualRenderers = holder.GetComponentsInChildren<Renderer>(true);
                item.VisualFailures = 0;
                item.VisualRetryAt = 0f;
                ApplyVisibility(item);
            }
            catch (MissingReferenceException)
            {
                // Предмет подобрали или сменили комнату во время загрузки.
            }
            catch (System.Exception error)
            {
                Debug.LogWarning("[ROA] Сбой загрузки физической модели " + itemId + ": " + error.Message);
                if (VisualRequestIsCurrent(item, itemId, request)) ScheduleVisualRetry(item);
            }
            finally
            {
                if (VisualRequestIsCurrent(item, itemId, request)) item.VisualLoading = false;
            }
        }

        private static void ScheduleVisualRetry(GroundItem item)
        {
            if (item == null) return;
            item.VisualFailures++;
            float delay = Mathf.Min(12f, 1.5f * Mathf.Pow(2f, Mathf.Min(3, item.VisualFailures - 1)));
            item.VisualRetryAt = Time.unscaledTime + delay;
        }

        private bool VisualRequestIsCurrent(GroundItem item, string itemId, int request)
        {
            return item != null && item.Marker != null && item.VisualRequest == request
                && item.VisualItemId == itemId && _items.TryGetValue(item.Id, out GroundItem current)
                && ReferenceEquals(current, item);
        }

        private string BaseModelUrl(string path)
        {
            string origin = Socket != null ? Socket.ServerOrigin : string.Empty;
            return string.IsNullOrEmpty(origin) ? path : origin.TrimEnd('/') + path;
        }

        private static string ModelPath(string itemId, out string kind)
        {
            kind = string.Empty;
            if (LibraryItems.Contains(itemId))
            {
                kind = "library";
                return "/assets/models/items/ground_item_library.glb";
            }
            if (WeaponItems.Contains(itemId))
            {
                kind = "weapon";
                return "/assets/models/weapons/weapon_" + itemId + ".glb";
            }
            if (EquipmentModels.TryGetValue(itemId ?? string.Empty, out string path))
            {
                kind = "equipment";
                return path;
            }
            return string.Empty;
        }

        private static async Task<GltfImport> LoadCached(string url)
        {
            if (ModelCache.TryGetValue(url, out Task<GltfImport> cached)) return await cached;
            Task<GltfImport> loading = LoadImport(url);
            ModelCache[url] = loading;
            GltfImport result = await loading;
            if (result == null) ModelCache.Remove(url);
            return result;
        }

        private static async Task<GltfImport> LoadImport(string url)
        {
            var import = new GltfImport();
            var settings = new ImportSettings { AnimationMethod = AnimationMethod.None };
            if (await import.Load(RoaModelUrl.Lite(url), settings)) return import;
            import.Dispose();
            return null;
        }

        private static GameObject IsolateLibraryItem(GameObject holder, string itemId)
        {
            Transform wanted = FindDeep(holder.transform, "ground_item_" + itemId);
            if (wanted == null) return null;

            // Библиотека содержит все 24 предмета в одной сцене. Оставляем только
            // нужную ветку, сохраняя её итоговую мировую трансформацию, чтобы туман
            // войны впоследствии не включил скрытые соседние меши.
            Transform parent = holder.transform.parent;
            wanted.SetParent(parent, true);
            Object.Destroy(holder);
            return wanted.gameObject;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name) return root;
            foreach (Transform child in root)
            {
                Transform found = FindDeep(child, name);
                if (found != null) return found;
            }
            return null;
        }

        private static bool FitPhysicalModel(GameObject holder, string kind)
        {
            if (kind == "equipment") holder.transform.localRotation = Quaternion.Euler(-90f, 0f, 10f);
            else if (kind == "weapon") holder.transform.localRotation = Quaternion.Euler(0f, 14f, 2.3f);

            if (!TryBounds(holder, out Bounds bounds)) return false;
            float footprint = Mathf.Max(bounds.size.x, bounds.size.z, bounds.size.y * 0.55f, 0.001f);
            float target = kind == "weapon" ? 1.02f : (kind == "equipment" ? 0.92f : 0.68f);
            float scale = Mathf.Min(1.35f, target / footprint);
            holder.transform.localScale = Vector3.one * scale;

            if (!TryBounds(holder, out bounds)) return false;
            Transform marker = holder.transform.parent;
            Vector3 markerWorld = marker != null ? marker.position : holder.transform.position;
            holder.transform.position += new Vector3(
                markerWorld.x - bounds.center.x,
                markerWorld.y + 0.025f - bounds.min.y,
                markerWorld.z - bounds.center.z);

            foreach (Renderer renderer in holder.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer.enabled) continue;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }
            return true;
        }

        private static bool TryBounds(GameObject root, out Bounds bounds)
        {
            bounds = new Bounds();
            bool found = false;
            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer.enabled) continue;
                if (!found) { bounds = renderer.bounds; found = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            return found;
        }

        private void Update()
        {
            // The unified interaction component owns the shared E key so one
            // press cannot both pick up an item and open a dialogue.
            if (Interaction == null && Input.GetKeyDown(PickupKey)) RequestPickupNearest();

            foreach (GroundItem item in _items.Values)
            {
                if (item == null || item.Visual != null || item.VisualLoading || item.VisualRetryAt <= 0f) continue;
                if (Time.unscaledTime >= item.VisualRetryAt) BeginVisualLoad(item);
            }

            UpdateVisibility();
        }

        /// <summary>
        /// Лут за стеной не показывается. Подбор при этом не запрещаем: он и так
        /// ограничен радиусом 2.2 м, где заслонить предмет практически нечем,
        /// а последнее слово всё равно за сервером.
        /// </summary>
        private void UpdateVisibility()
        {
            foreach (GroundItem item in _items.Values)
                ApplyVisibility(item);
        }

        private void ApplyVisibility(GroundItem item)
        {
            bool visible = Fog == null || Fog.IsVisible(item.Position);

            if (item.Renderer != null)
                item.Renderer.enabled = visible && item.Visual == null;

            if (item.VisualRenderers == null) return;
            foreach (Renderer renderer in item.VisualRenderers)
                if (renderer != null && renderer.enabled != visible) renderer.enabled = visible;
        }

        public void CollectMinimapMarkers(List<RoaMinimap.Marker> markers)
        {
            if (markers == null) return;
            foreach (GroundItem item in _items.Values)
            {
                if (item == null || (Fog != null && !Fog.IsVisible(item.Position))) continue;
                markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.GroundItem, item.Position));
            }
        }

        public void CollectOverlayLabels(List<RoaWorldOverlayCanvas.GroundLabel> labels)
        {
            if (labels == null || Player == null || !Player.gameObject.activeInHierarchy) return;
            Vector3 origin = Player.transform.position;
            float rangeSquared = PickupRange * PickupRange;
            foreach (GroundItem item in _items.Values)
            {
                if (item == null || (Fog != null && !Fog.IsVisible(item.Position))) continue;
                Vector3 delta = item.Position - origin;
                delta.y = 0f;
                float distanceSquared = delta.sqrMagnitude;
                if (distanceSquared > rangeSquared) continue;
                labels.Add(new RoaWorldOverlayCanvas.GroundLabel
                {
                    Id = item.Id,
                    ItemId = item.ItemId,
                    Quantity = Mathf.Max(1, item.Qty),
                    World = item.Position + Vector3.up * 0.5f,
                    DistanceSquared = distanceSquared
                });
            }
        }

        public bool TryGetOverlayStatus(out string text, out float opacity)
        {
            text = _status;
            float remaining = _statusUntil - Time.time;
            if (remaining <= 0f || string.IsNullOrWhiteSpace(text))
            {
                text = string.Empty;
                opacity = 0f;
                return false;
            }
            opacity = remaining >= 0.35f ? 1f : Mathf.Clamp01(remaining / 0.35f);
            return true;
        }

        public bool HasPickupCandidate()
        {
            if (Player == null) return false;
            float best = PickupRange * PickupRange;
            foreach (GroundItem item in _items.Values)
            {
                Vector3 delta = item.Position - Player.transform.position;
                delta.y = 0f;
                if (delta.sqrMagnitude <= best) return true;
            }
            return false;
        }

        public bool RequestPickupNearest(System.Action<JObject> completed = null)
        {
            if (Socket == null || Player == null) return false;
            if (Socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return false;

            GroundItem nearest = null;
            float best = PickupRange * PickupRange;

            foreach (GroundItem item in _items.Values)
            {
                Vector3 delta = item.Position - Player.transform.position;
                delta.y = 0f;

                float distance = delta.sqrMagnitude;
                if (distance > best) continue;

                best = distance;
                nearest = item;
            }

            if (nearest == null)
            {
                Show("рядом ничего нет");
                return false;
            }

            Socket.EmitWithAck("pickupGroundItem", new Dictionary<string, object>
            {
                ["id"] = nearest.Id
            }, ack =>
            {
                if (ack == null) { Show("нет ответа сервера"); completed?.Invoke(null); return; }

                // pickupGroundItem возвращает тот же авторитетный self, что и
                // остальные действия с инвентарём. Событие groundItemPicked
                // удаляет объект из мира, но не содержит новый состав сумки.
                // Без применения ack предмет исчезал с земли, а Unity-инвентарь
                // оставался устаревшим до следующей серверной сверки.
                Socket.ApplyGameplayAck(ack);

                bool ok = ack["ok"]?.ToObject<bool>() ?? false;

                // Метку не убираем по одному ack: общий groundItemPicked или
                // следующий снимок одинаково покажут авторитетный результат.
                if (ok)
                {
                    _status = string.Empty;
                    _statusUntil = 0f;
                }
                else Show(ack["error"]?.ToString() ?? "не удалось подобрать");
                completed?.Invoke(ack);
            });
            return true;
        }

        private void Show(string text)
        {
            _status = text;
            _statusUntil = Time.time + 2.5f;
        }

        private void OnGUI()
        {
            if (CanvasDriven) return;
            RoaUiTheme.Apply();
            if (RoaGameBootstrap.BlocksWorldHud) return;
            UnityEngine.Camera cam = UnityEngine.Camera.main;

            if (cam != null && Player != null)
            {
                foreach (GroundItem item in _items.Values)
                {
                    Vector3 delta = item.Position - Player.transform.position;
                    delta.y = 0f;
                    if (delta.sqrMagnitude > PickupRange * PickupRange) continue;

                    Vector3 screen = cam.WorldToScreenPoint(item.Position + Vector3.up * 0.5f);
                    if (screen.z <= 0f) continue;

                    string label = item.ItemId + (item.Qty > 1 ? " x" + item.Qty : "") + "   [E]";
                    GUI.Label(new Rect(screen.x - 70f, Screen.height - screen.y - 18f, 140f, 20f), label);
                }
            }

            if (Time.time < _statusUntil && !string.IsNullOrEmpty(_status))
                GUI.Label(new Rect(Screen.width * 0.5f - 120f, Screen.height - 170f, 240f, 20f), _status);
        }

        private void Remove(string id)
        {
            GroundItem item;
            if (!_items.TryGetValue(id, out item)) return;

            item.VisualRequest++;
            if (item.Marker != null) Destroy(item.Marker);
            _items.Remove(id);
        }

        public void Clear()
        {
            foreach (GroundItem item in _items.Values)
                if (item.Marker != null) Destroy(item.Marker);

            _items.Clear();
        }

        private void OnDestroy()
        {
            if (_markerMaterial != null) Destroy(_markerMaterial);
        }
    }
}
