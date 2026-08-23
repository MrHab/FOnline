using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.World
{
    public struct RoaWorldCollisionBox
    {
        public float X;
        public float Z;
        public float HalfX;
        public float HalfZ;
        public float RotationY;
    }

    /// <summary>
    /// Строит сцену локации из авторского JSON и GLB-моделей, которые отдаёт тот же
    /// Node-сервер. Ни один ассет не конвертируется: Unity читает ровно те файлы,
    /// что и Three.js-клиент.
    ///
    /// Загружается только статическая геометрия. Живые сущности (NPC, враги) есть
    /// в objects, но их авторитетные позиции приходят в enemySnapshot — если создать
    /// их ещё и отсюда, в сцене будут дубли.
    /// </summary>
    public sealed class RoaLocationLoader : MonoBehaviour
    {
        [Tooltip("Origin игрового сервера, например http://127.0.0.1:3000")]
        public string BaseUrl = "http://127.0.0.1:3000";

        [Tooltip("Кешировать загруженные GLB между локациями. 215 моделей проекта весят 146 МБ — на PC-сборке кеш оправдан.")]
        public bool CacheModels = true;

        private readonly Dictionary<string, GltfImport> _modelCache = new Dictionary<string, GltfImport>();
        private readonly Dictionary<string, GameObject> _objectRoots = new Dictionary<string, GameObject>();
        private readonly Dictionary<string, LocationObject> _objectEntries = new Dictionary<string, LocationObject>();
        private static readonly HashSet<string> LowBallisticCoverModels = new HashSet<string>(StringComparer.Ordinal)
        {
            "crate", "cargostack", "storagechest", "workshopbench", "watertank",
            "roadblockbarricade", "lowruinedwall", "scrapheap", "armoryrack", "cotbed",
            "campfirerest", "fencesegment", "perimeterdebris", "gardenpatch", "oreoutcrop",
            "drybush", "deadwood", "tirestack", "rustbarrel", "brahminpen", "barrelcluster",
            "traderwindowblock"
        };
        private Dictionary<string, LocationDefinition> _locations;
        private JObject _colliderModels;
        private GameObject _currentRoot;
        private RoaLocalTerrain _groundSurface;

        public LocationDefinition Current { get; private set; }
        public Renderer CurrentGroundRenderer { get; private set; }
        public bool IsLoading { get; private set; }
        /// <summary>Доля собранных объектов 0..1 и текущий шаг — для экрана загрузки (setLocationLoadingProgress web).</summary>
        public float Progress { get; private set; }
        public string StepText { get; private set; } = string.Empty;

        /// <summary>
        /// GET /api/locations — забирает авторские определения и материализованные
        /// сервером world-site instances одним каталогом. JSON не содержит геометрию,
        /// поэтому безопасно кешируется на сеанс и обновляется при следующем входе.
        /// </summary>
        public IEnumerator FetchLocationCatalog(Action<bool, string> onDone)
        {
            using (UnityWebRequest request = UnityWebRequest.Get(BaseUrl.TrimEnd('/') + "/api/locations"))
            {
                yield return request.SendWebRequest();

                if (request.result != UnityWebRequest.Result.Success)
                {
                    onDone?.Invoke(false, "Не удалось получить список локаций: " + request.error);
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    JToken locations = payload["locations"];
                    if (locations == null)
                    {
                        onDone?.Invoke(false, "В ответе /api/locations нет поля locations.");
                        yield break;
                    }

                    _locations = locations.ToObject<Dictionary<string, LocationDefinition>>();
                    onDone?.Invoke(true, null);
                }
                catch (JsonException error)
                {
                    onDone?.Invoke(false, "Некорректный JSON локаций: " + error.Message);
                }
            }
        }

        public LocationDefinition GetDefinition(string locationId)
        {
            if (_locations == null || string.IsNullOrEmpty(locationId)) return null;
            return _locations.TryGetValue(locationId, out LocationDefinition definition) ? definition : null;
        }

        /// <summary>
        /// Убрать локальную геометрию при выходе на глобальную карту. Каталог и
        /// GLB-кеш сохраняются, поэтому обратный вход не требует повторной загрузки
        /// уже виденных моделей.
        /// </summary>
        public void ClearLocation()
        {
            if (_currentRoot != null)
            {
                _currentRoot.SetActive(false);
                Destroy(_currentRoot);
            }
            _currentRoot = null;
            _groundSurface = null;
            CurrentGroundRenderer = null;
            _objectRoots.Clear();
            _objectEntries.Clear();
            Current = null;
            Progress = 1f;
            StepText = "Собираю карту, персонажа и окружение...";
            IsLoading = false;
        }

        /// <summary>Совместимый вход без сетевого снимка; поверхность обновится с первым worldState.</summary>
        public IEnumerator LoadLocation(string locationId, Action<bool, string> onDone)
        {
            return LoadLocation(locationId, null, onDone);
        }

        /// <summary>Строит сцену локации. Предыдущая сцена уничтожается целиком.</summary>
        public IEnumerator LoadLocation(string locationId, JArray authoritativeMap, Action<bool, string> onDone)
        {
            if (IsLoading)
            {
                onDone?.Invoke(false, "Загрузка локации уже идёт.");
                yield break;
            }

            LocationDefinition definition = GetDefinition(locationId);
            if (definition == null)
            {
                onDone?.Invoke(false, "Локация не найдена в каталоге: " + locationId);
                yield break;
            }

            if (definition.Map != null && definition.Map.Origin != "center")
            {
                // Весь перевод координат построен на origin = center. Другое значение
                // означает иную разметку — молча строить сцену нельзя.
                onDone?.Invoke(false, "Неподдерживаемый map.origin: " + definition.Map.Origin);
                yield break;
            }

            IsLoading = true;
            Progress = 0f;
            StepText = "Подготавливаю графику и модели мира...";

            if (_colliderModels == null)
                yield return StartCoroutine(FetchColliderCatalog());

            if (_currentRoot != null) Destroy(_currentRoot);
            _objectRoots.Clear();
            _objectEntries.Clear();
            _groundSurface = null;
            CurrentGroundRenderer = null;
            _currentRoot = new GameObject("Location:" + definition.Id);
            Current = definition;

            BuildGround(definition, authoritativeMap, _currentRoot.transform);

            int built = 0;
            int skipped = 0;
            var failures = new List<string>();

            int total = definition.Objects != null ? definition.Objects.Count : 0;
            int done = 0;
            foreach (LocationObject entry in definition.Objects)
            {
                done++;
                Progress = total > 0 ? done / (float)total : 1f;
                StepText = "Загружаю ассеты " + done + "/" + total + "...";
                if (entry == null || string.IsNullOrEmpty(entry.Url)) { skipped++; continue; }

                // Живые сущности приходят от сервера — здесь не создаём.
                if (entry.IsLiveEntity()) { skipped++; continue; }

                Task<GameObject> task = InstantiateModel(entry, _currentRoot.transform);
                while (!task.IsCompleted) yield return null;

                if (task.IsFaulted || task.Result == null)
                {
                    string reason = task.Exception?.GetBaseException().Message ?? "модель не создана";
                    failures.Add(entry.Id + " (" + entry.Url + "): " + reason);
                    continue;
                }

                if (!string.IsNullOrEmpty(entry.Id))
                {
                    _objectRoots[entry.Id] = task.Result;
                    _objectEntries[entry.Id] = entry;
                }
                built++;
            }

            foreach (LocationObject entry in RuntimeLocationObjects(definition, authoritativeMap))
            {
                Task<GameObject> task = InstantiateModel(entry, _currentRoot.transform);
                while (!task.IsCompleted) yield return null;

                if (task.IsFaulted || task.Result == null)
                {
                    string reason = task.Exception?.GetBaseException().Message ?? "модель не создана";
                    failures.Add(entry.Id + " (" + entry.Url + "): " + reason);
                    continue;
                }

                _objectRoots[entry.Id] = task.Result;
                _objectEntries[entry.Id] = entry;
                if (entry.Id == "procedural_rest_camp") AddCampfireGlow(task.Result.transform);
                built++;
            }

            IsLoading = false;

            string summary = "Локация " + definition.Id + ": построено " + built
                + ", пропущено " + skipped + ", ошибок " + failures.Count;

            if (failures.Count > 0)
            {
                // Локация с дырами всё ещё играбельна, но молчать об этом нельзя.
                Debug.LogWarning("[ROA] " + summary + "\n" + string.Join("\n", failures));
            }
            else
            {
                Debug.Log("[ROA] " + summary);
            }

            onDone?.Invoke(true, summary);
        }

        /// <summary>
        /// Включает или скрывает уже загруженный авторский объект. Это используется для
        /// серверных ресурсных узлов: истощённая руда/растение исчезает без пересборки локации.
        /// </summary>
        public bool SetObjectVisible(string objectId, bool visible)
        {
            if (string.IsNullOrEmpty(objectId)) return false;
            GameObject root;
            if (!_objectRoots.TryGetValue(objectId, out root) || root == null) return false;
            if (root.activeSelf != visible) root.SetActive(visible);
            return true;
        }

        /// <summary>
        /// Returns the instantiated root of an authored static object. Runtime
        /// presentation systems (roof cutaway, resource depletion) use the same
        /// stable authored id instead of searching scene names.
        /// </summary>
        public bool TryGetObjectRoot(string objectId, out GameObject root)
        {
            root = null;
            if (string.IsNullOrEmpty(objectId)) return false;
            return _objectRoots.TryGetValue(objectId, out root) && root != null;
        }

        /// <summary>
        /// Returns the same generated walk-slab OBB parts consumed by Node and the
        /// browser. Coordinates are already converted to Unity's X/-Z world.
        /// </summary>
        public int CollectCollisionBoxes(string objectId, List<RoaWorldCollisionBox> output)
        {
            if (string.IsNullOrEmpty(objectId) || output == null) return 0;
            if (!_objectRoots.TryGetValue(objectId, out GameObject root) || root == null) return 0;
            if (!_objectEntries.TryGetValue(objectId, out LocationObject entry) || entry == null) return 0;
            JObject collision = CatalogCollision(entry);
            if (!string.Equals(collision?["mode"]?.ToString(), "solid", StringComparison.OrdinalIgnoreCase))
                return 0;
            JArray parts = collision?["parts"] as JArray;
            if (parts == null || parts.Count == 0) return 0;

            int added = 0;
            Vector3 scale = root.transform.lossyScale;
            float rotationY = root.transform.eulerAngles.y * Mathf.Deg2Rad;
            foreach (JToken token in parts)
            {
                JObject part = token as JObject;
                JObject center = part?["center"] as JObject;
                JObject size = part?["size"] as JObject;
                if (center == null || size == null) continue;
                float sx = size["x"]?.ToObject<float>() ?? 0f;
                float sz = size["z"]?.ToObject<float>() ?? 0f;
                if (sx <= 0.001f || sz <= 0.001f) continue;
                Vector3 world = root.transform.TransformPoint(new Vector3(
                    center["x"]?.ToObject<float>() ?? 0f,
                    center["y"]?.ToObject<float>() ?? 0f,
                    -(center["z"]?.ToObject<float>() ?? 0f)));
                output.Add(new RoaWorldCollisionBox
                {
                    X = world.x,
                    Z = world.z,
                    HalfX = sx * 0.5f * Mathf.Abs(scale.x),
                    HalfZ = sz * 0.5f * Mathf.Abs(scale.z),
                    RotationY = rotationY
                });
                added++;
            }
            return added;
        }

        /// <summary>
        /// Применяет полную сетку, которую сервер присылает в worldState.map.
        /// Локальный клиент не генерирует проходимость и ресурсы самостоятельно.
        /// </summary>
        public bool ApplyWorldMap(JArray authoritativeMap)
        {
            return _groundSurface != null && _groundSurface.ApplyMap(authoritativeMap);
        }

        /// <summary>
        /// Земля локации. map.width/depth заданы в метрах, а техническая сетка
        /// приходит отдельно от Node-сервера. RoaLocalTerrain повторяет непрерывную
        /// backplate-композицию браузера и держит плоский физический коллайдер.
        /// </summary>
        private void BuildGround(LocationDefinition definition, JArray authoritativeMap, Transform parent)
        {
            var ground = new GameObject("Ground");
            ground.transform.SetParent(parent, false);
            _groundSurface = ground.AddComponent<RoaLocalTerrain>();
            _groundSurface.Initialize(definition, authoritativeMap);
            CurrentGroundRenderer = _groundSurface.GroundRenderer;

            Debug.Log("[ROA] Земля: " + definition.WorldWidth + "x" + definition.WorldDepth
                + " м, сетка " + _groundSurface.AuthoritativeMapWidth + "x"
                + _groundSurface.AuthoritativeMapDepth + ", пресет '"
                + (definition.Ground?.Preset ?? string.Empty) + "'");
        }

        private async Task<GameObject> InstantiateModel(LocationObject entry, Transform parent)
        {
            GltfImport import = await LoadGltf(entry.Url);
            if (import == null) return null;

            var holder = new GameObject(string.IsNullOrEmpty(entry.Id) ? entry.Model : entry.Id);
            holder.transform.SetParent(parent, false);

            ApplyTransform(holder.transform, entry);

            bool ok = await import.InstantiateMainSceneAsync(holder.transform);
            if (!ok)
            {
                Destroy(holder);
                return null;
            }

            if (BlocksMovement(entry) && !AddCatalogColliders(holder, entry)) AddBoundsCollider(holder);

            return holder;
        }

        private void ApplyTransform(Transform target, LocationObject entry)
        {
            Vector3 position = entry.Position != null
                ? RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z)
                : Vector3.zero;

            target.localPosition = position;

            if (entry.Rotation != null)
            {
                target.localRotation = RoaCoords.AuthoredRotation(
                    entry.Rotation.X, entry.Rotation.Y, entry.Rotation.Z);
            }

            if (entry.Scale != null)
            {
                target.localScale = new Vector3(
                    entry.Scale.X == 0f ? 1f : entry.Scale.X,
                    entry.Scale.Y == 0f ? 1f : entry.Scale.Y,
                    entry.Scale.Z == 0f ? 1f : entry.Scale.Z);
            }
        }

        /// <summary>
        /// Exact authoredObjectBlocksMovement() policy. Interaction props, roofs,
        /// floors and low cover deliberately allow player overlap even when their
        /// authoring collision field is used for another subsystem.
        /// </summary>
        private static bool BlocksMovement(LocationObject entry)
        {
            if (entry == null) return false;
            string role = entry.Occlusion?["role"]?.ToString().Trim().ToLowerInvariant() ?? string.Empty;
            if (role == "roof" || role == "floor" || HasTag(entry, "roof") || HasTag(entry, "floor"))
                return false;
            if (ExplicitCollisionDisabled(entry.PlayerCollision, entry.MovementCollision)) return false;

            string interactiveKind = NormalizeKind(entry.Interactive?["kind"]?.ToString());
            string entityKind = NormalizeKind(entry.Entity?["kind"]?.ToString());
            string ownKind = NormalizeKind(entry.Kind);
            if (OverlapKind(interactiveKind) || OverlapKind(entityKind) || OverlapKind(ownKind)) return false;

            string[] overlapTags = { "interactive", "crafting-station", "jobboard", "questboard",
                "trademachine", "vendingmachine", "container", "storage", "personal-storage",
                "ground-item", "loot-item", "pickup", "pass-through", "no-player-collision" };
            for (int i = 0; i < overlapTags.Length; i++)
                if (HasTag(entry, overlapTags[i]) || JObjectHasTag(entry.Entity, overlapTags[i])
                    || JObjectHasTag(entry.Interactive, overlapTags[i])) return false;

            string collision = (entry.Collision ?? string.Empty).Trim().ToLowerInvariant();
            return collision == "solid" || collision == "block" || collision == "blocked"
                || collision == "wall" || collision == "resource";
        }

        private static bool ExplicitCollisionDisabled(JToken playerCollision, JToken movementCollision)
        {
            if (playerCollision?.Type == JTokenType.Boolean && playerCollision.ToObject<bool>() == false)
                return true;
            JToken value = playerCollision ?? movementCollision;
            if (value == null || value.Type == JTokenType.Null) return false;
            string text = value.ToString().Trim().ToLowerInvariant();
            return text == "none" || text == "off" || text == "disabled" || text == "pass"
                || text == "pass-through" || text == "passthrough";
        }

        private static bool OverlapKind(string kind)
        {
            return kind == "craftingstation" || kind == "jobboard" || kind == "trademachine"
                || kind == "vendingmachine" || kind == "container" || kind == "storage";
        }

        private static string NormalizeKind(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            var chars = new char[value.Length];
            int count = 0;
            for (int i = 0; i < value.Length; i++)
                if (char.IsLetterOrDigit(value[i])) chars[count++] = char.ToLowerInvariant(value[i]);
            return new string(chars, 0, count);
        }

        private static bool HasTag(LocationObject entry, string expected)
        {
            if (entry?.Tags == null) return false;
            for (int i = 0; i < entry.Tags.Count; i++)
                if (string.Equals(entry.Tags[i], expected, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static bool JObjectHasTag(JObject source, string expected)
        {
            if (source == null) return false;
            JToken tags = source["tags"];
            if (tags is JArray array)
            {
                foreach (JToken token in array)
                    if (string.Equals(token?.ToString(), expected, StringComparison.OrdinalIgnoreCase)) return true;
            }
            else if (tags != null)
            {
                string[] values = tags.ToString().Split(',');
                for (int i = 0; i < values.Length; i++)
                    if (string.Equals(values[i].Trim(), expected, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        /// <summary>
        /// Коллайдер по границам меша. Сервер всё равно остаётся истиной для движения
        /// (serverApplyMovementProposal в server.js), локальные коллайдеры нужны только
        /// чтобы предсказание не проезжало сквозь стены между поправками.
        /// </summary>
        private bool AddCatalogColliders(GameObject root, LocationObject entry)
        {
            if (root == null || entry == null) return false;
            JObject collision = CatalogCollision(entry);
            if (collision == null) return false;
            if (!string.Equals(collision["mode"]?.ToString(), "solid", StringComparison.OrdinalIgnoreCase))
                return true;

            JArray parts = collision["parts"] as JArray;
            if (parts == null || parts.Count == 0) return false;
            int added = 0;
            bool lowBallisticCover = IsLowBallisticCover(entry);
            float inverseScaleY = 1f / Mathf.Max(0.001f, Mathf.Abs(root.transform.lossyScale.y));
            foreach (JToken token in parts)
            {
                JObject part = token as JObject;
                JObject center = part?["center"] as JObject;
                JObject size = part?["size"] as JObject;
                if (center == null || size == null) continue;
                float sx = size["x"]?.ToObject<float>() ?? 0f;
                float sy = size["y"]?.ToObject<float>() ?? 0f;
                float sz = size["z"]?.ToObject<float>() ?? 0f;
                if (sx <= 0.001f || sy <= 0.001f || sz <= 0.001f) continue;

                var box = root.AddComponent<BoxCollider>();
                box.center = new Vector3(
                    center["x"]?.ToObject<float>() ?? 0f,
                    lowBallisticCover ? center["y"]?.ToObject<float>() ?? 0f : 1.6f * inverseScaleY,
                    -(center["z"]?.ToObject<float>() ?? 0f));
                box.size = new Vector3(sx, lowBallisticCover ? sy : 3.2f * inverseScaleY, sz);
                added++;
            }
            return added > 0;
        }

        /// <summary>
        /// LOW_BALLISTIC_COVER_MODELS from 02a_materials_static_models.js. The
        /// generated catalog is a walking slab capped near 0.95 m; only these
        /// models should also remain that low for standing shot previews.
        /// </summary>
        private static bool IsLowBallisticCover(LocationObject entry)
        {
            if (entry == null) return false;
            string source = !string.IsNullOrEmpty(entry.Model) ? entry.Model : entry.Url;
            if (string.IsNullOrEmpty(source)) return false;
            source = source.Replace('\\', '/');
            int slash = source.LastIndexOf('/');
            if (slash >= 0) source = source.Substring(slash + 1);
            int query = source.IndexOf('?');
            if (query >= 0) source = source.Substring(0, query);
            int dot = source.LastIndexOf('.');
            if (dot > 0) source = source.Substring(0, dot);
            var key = new System.Text.StringBuilder(source.Length);
            for (int i = 0; i < source.Length; i++)
                if (char.IsLetterOrDigit(source[i])) key.Append(char.ToLowerInvariant(source[i]));
            return LowBallisticCoverModels.Contains(key.ToString());
        }

        private JObject CatalogCollision(LocationObject entry)
        {
            if (_colliderModels == null || entry == null) return null;
            string source = !string.IsNullOrEmpty(entry.Url) ? entry.Url : entry.Model;
            if (string.IsNullOrEmpty(source)) return null;
            source = source.Replace('\\', '/');
            int query = source.IndexOf('?');
            if (query >= 0) source = source.Substring(0, query);
            int slash = source.LastIndexOf('/');
            string file = slash >= 0 ? source.Substring(slash + 1) : source;
            JObject model = _colliderModels[file] as JObject;
            if (model == null) return null;
            return model["collision"] as JObject;
        }

        private static void AddBoundsCollider(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            if (renderers.Length == 0) return;

            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);

            var box = root.AddComponent<BoxCollider>();
            box.center = root.transform.InverseTransformPoint(bounds.center);
            box.size = bounds.size;
        }

        private IEnumerator FetchColliderCatalog()
        {
            string url = BaseUrl.TrimEnd('/') + "/assets/models/wasteland/model-colliders.json";
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogWarning("[ROA] Каталог точных коллайдеров недоступен, используется bounds fallback: "
                        + request.error);
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    _colliderModels = payload["models"] as JObject;
                    if (_colliderModels == null)
                        Debug.LogWarning("[ROA] В model-colliders.json нет поля models; используется bounds fallback.");
                }
                catch (JsonException error)
                {
                    Debug.LogWarning("[ROA] Некорректный model-colliders.json: " + error.Message);
                }
            }
        }

        private static IEnumerable<LocationObject> RuntimeLocationObjects(LocationDefinition definition, JArray map)
        {
            if (definition?.Exit != null && !string.IsNullOrEmpty(definition.Exit.To))
            {
                float exitX = (definition.Exit.Tx - definition.TileWidth / 2f + 0.5f) * RoaCoords.Tile;
                float exitZ = (definition.Exit.Tz - definition.TileDepth / 2f + 0.5f) * RoaCoords.Tile;
                yield return new LocationObject
                {
                    Id = "location_exit_highway_sign",
                    Model = "highway_sign.glb",
                    Url = "/assets/models/wasteland/highway_sign.glb",
                    Position = new Vec3 { X = exitX, Y = 0f, Z = exitZ },
                    Rotation = new Vec3(),
                    Scale = new Vec3 { X = 1f, Y = 1f, Z = 1f },
                    Collision = "none"
                };
            }

            bool procedural = definition != null && (definition.WorldSiteInstance
                || string.Equals(definition.RuntimeMode, "worldSiteInstance", StringComparison.OrdinalIgnoreCase)
                || string.Equals(definition.RuntimeMode, "procedural", StringComparison.OrdinalIgnoreCase));
            if (!procedural || map == null) yield break;

            int mapDepth = map.Count;
            int mapWidth = 0;
            for (int z = 0; z < map.Count; z++)
                if (map[z] is JArray row && row.Count > mapWidth) mapWidth = row.Count;
            if (mapWidth <= 0 || mapDepth <= 0) yield break;

            string[] trees = { "dead_tree_a.glb", "dead_tree_b.glb", "dead_tree_c.glb" };
            string[] ruins = { "car_wreck.glb", "concrete_wall.glb", "barrel_cluster.glb",
                "tire_stack.glb", "scrap_heap.glb", "low_ruined_wall.glb", "roadblock_barricade.glb" };

            for (int tz = 0; tz < mapDepth; tz++)
            {
                JArray row = map[tz] as JArray;
                if (row == null) continue;
                for (int tx = 0; tx < mapWidth && tx < row.Count; tx++)
                {
                    int type = row[tx]?.ToObject<int>() ?? 0;
                    string file = string.Empty;
                    float rotation = 0f;
                    string id = "tile_" + tx + "_" + tz;
                    if (type == 1)
                    {
                        int index = Mathf.FloorToInt(ModelHash01(tx, tz, 77603) * trees.Length) % trees.Length;
                        file = trees[index];
                        rotation = ModelHash01(tx, tz, 77601) * Mathf.PI * 2f;
                    }
                    else if (type == 2)
                    {
                        file = "rubble_rock.glb";
                        rotation = ModelHash01(tx, tz, 77720) * Mathf.PI * 2f;
                    }
                    else if (type == 6)
                    {
                        file = "ore_outcrop.glb";
                        rotation = ModelHash01(tx, tz, 77720) * Mathf.PI * 2f;
                        id = "res_" + tx + "_" + tz + "_ore";
                    }
                    else if (type == 7)
                    {
                        file = "deadwood.glb";
                        rotation = ModelHash01(tx, tz, 77780) * Mathf.PI * 2f;
                        id = "res_" + tx + "_" + tz + "_wood";
                    }
                    else if (type == 8)
                    {
                        int index = Mathf.FloorToInt(ModelHash01(tx, tz, 77802) * ruins.Length) % ruins.Length;
                        file = ruins[index];
                        rotation = ModelHash01(tx, tz, 77800) * Mathf.PI * 2f;
                    }
                    else if (type == 9)
                    {
                        file = "oil_pump_jack.glb";
                        id = "res_" + tx + "_" + tz + "_oil";
                    }
                    if (string.IsNullOrEmpty(file)) continue;

                    float worldX = (tx - mapWidth / 2f + 0.5f) * RoaCoords.Tile;
                    float worldZ = (tz - mapDepth / 2f + 0.5f) * RoaCoords.Tile;
                    yield return new LocationObject
                    {
                        Id = id,
                        Model = file,
                        Url = "/assets/models/wasteland/" + file,
                        Position = new Vec3 { X = worldX, Y = 0f, Z = worldZ },
                        Rotation = new Vec3 { Y = rotation },
                        Scale = new Vec3 { X = 1f, Y = 1f, Z = 1f },
                        Collision = "solid"
                    };
                }
            }

            // recreateWorldVisualsFromCurrentMap() places this shared rest camp in
            // every non-authored local site. It is decorative and therefore must
            // not invent a movement blocker that the authoritative server lacks.
            yield return new LocationObject
            {
                Id = "procedural_rest_camp",
                Model = "campfire_rest.glb",
                Url = "/assets/models/wasteland/campfire_rest.glb",
                Position = new Vec3 { X = -2.6f, Y = 0f, Z = 2.2f },
                Rotation = new Vec3(),
                Scale = new Vec3 { X = 1f, Y = 1f, Z = 1f },
                Collision = "none"
            };
        }

        private static float ModelHash01(int a, int b, int c)
        {
            unchecked
            {
                uint value = (uint)((a ^ unchecked((int)0x9e3779b9)) * unchecked((int)0x85ebca6b));
                value ^= (uint)((b + unchecked((int)0xc2b2ae35)) * unchecked((int)0x27d4eb2d));
                value ^= (uint)((c + unchecked((int)0x165667b1)) * unchecked((int)0x9e3779b1));
                value ^= value >> 15;
                return (value % 100000u) / 100000f;
            }
        }

        private static void AddCampfireGlow(Transform parent)
        {
            if (parent == null) return;
            var glowRoot = new GameObject("CampfireGlow");
            glowRoot.transform.SetParent(parent, false);
            glowRoot.transform.localPosition = new Vector3(0f, 1.1f, 0f);
            Light glow = glowRoot.AddComponent<Light>();
            glow.type = LightType.Point;
            glow.color = new Color(1f, 0.65f, 0.29f);
            glow.intensity = 1.8f;
            glow.range = 9f;
            glow.shadows = LightShadows.None;
        }

        private async Task<GltfImport> LoadGltf(string url)
        {
            string absolute = url.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                ? url
                : BaseUrl.TrimEnd('/') + url;

            if (CacheModels && _modelCache.TryGetValue(absolute, out GltfImport cached)) return cached;

            var import = new GltfImport();
            bool ok = await import.Load(RoaModelUrl.Lite(absolute));
            if (!ok)
            {
                import.Dispose();
                return null;
            }

            if (CacheModels) _modelCache[absolute] = import;
            return import;
        }

        private void OnDestroy()
        {
            foreach (GltfImport import in _modelCache.Values) import?.Dispose();
            _modelCache.Clear();
        }
    }
}
