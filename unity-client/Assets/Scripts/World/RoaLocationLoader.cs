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
using UnityEngine.SceneManagement;
using Kromka;

namespace RealmOfAshes.World
{
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
        private Dictionary<string, LocationDefinition> _locations;
        private GameObject _currentRoot;
        private RoaLocalTerrain _groundSurface;
        private Scene _unityLocationScene;
        private GameObject _unityLocationRoot;
        private AsyncOperation _unitySceneUnload;
        private RoaSceneEnvironment _bootstrapEnvironment;
        private bool _bootstrapEnvironmentCaptured;
        private RoaZoneAssembler _zoneAssembler;

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
        /// GET /api/locations/:id — одна локация. Так приходят зоны мира: их почти две
        /// сотни, и в общий каталог они не входят. Ответ кладётся в тот же кеш.
        /// </summary>
        public IEnumerator FetchDefinition(string locationId, Action<bool, string> onDone)
        {
            if (string.IsNullOrEmpty(locationId))
            {
                onDone?.Invoke(false, "Не указана локация.");
                yield break;
            }
            string url = BaseUrl.TrimEnd('/') + "/api/locations/" + UnityWebRequest.EscapeURL(locationId);
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    onDone?.Invoke(false, "Не удалось получить локацию " + locationId + ": " + request.error);
                    yield break;
                }
                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    LocationDefinition definition = payload["location"]?.ToObject<LocationDefinition>();
                    if (definition == null || string.IsNullOrEmpty(definition.Id))
                    {
                        onDone?.Invoke(false, "В ответе нет локации " + locationId + ".");
                        yield break;
                    }
                    if (_locations == null) _locations = new Dictionary<string, LocationDefinition>();
                    _locations[definition.Id] = definition;
                    onDone?.Invoke(true, null);
                }
                catch (JsonException error)
                {
                    onDone?.Invoke(false, "Некорректный JSON локации: " + error.Message);
                }
            }
        }

        private RoaZoneAssembler ZoneAssembler
        {
            get
            {
                if (_zoneAssembler == null)
                {
                    _zoneAssembler = GetComponent<RoaZoneAssembler>();
                    if (_zoneAssembler == null) _zoneAssembler = gameObject.AddComponent<RoaZoneAssembler>();
                }
                return _zoneAssembler;
            }
        }

        /// <summary>
        /// Убрать локальную геометрию при выходе к экрану персонажей. Каталог и
        /// GLB-кеш сохраняются, поэтому обратный вход не требует повторной загрузки
        /// уже виденных моделей.
        /// </summary>
        public void ClearLocation()
        {
            _zoneAssembler?.ReleaseAll();
            if (_currentRoot != null)
            {
                _currentRoot.SetActive(false);
                Destroy(_currentRoot);
            }
            _currentRoot = null;
            ReleaseUnityLocationScene();
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

            while (_unitySceneUnload != null && !_unitySceneUnload.isDone) yield return null;
            _unitySceneUnload = null;
            ReleaseUnityLocationScene();
            while (_unitySceneUnload != null && !_unitySceneUnload.isDone) yield return null;
            _unitySceneUnload = null;
            StepText = "Подготавливаю графику и модели мира...";

            // Объекты зоны возвращаются в пулы до уничтожения корня, иначе умрут вместе с ним.
            _zoneAssembler?.ReleaseAll();
            if (_currentRoot != null) Destroy(_currentRoot);
            _objectRoots.Clear();
            _objectEntries.Clear();
            _groundSurface = null;
            CurrentGroundRenderer = null;
            _currentRoot = new GameObject("Location:" + definition.Id);
            Current = definition;

            // Край места выводит в его зону, а закрытое сюжетом место получает
            // непроходимый пунктир. У самой зоны края нет: её стены и ворота собирает конструктор.
            if (definition.ParentZone != null || !definition.CanExitAtEdge)
            {
                var exitBoundary = _currentRoot.AddComponent<RoaWorldExitBoundary>();
                exitBoundary.Configure(definition.TileWidth, definition.TileDepth);
            }

            RoaUnityLocationScene unityScene = null;
            string unitySceneName = UnitySceneName(definition.Id);
            if (!string.IsNullOrEmpty(unitySceneName))
            {
                AsyncOperation load = SceneManager.LoadSceneAsync(unitySceneName, LoadSceneMode.Additive);
                if (load != null)
                {
                    while (!load.isDone) yield return null;
                    _unityLocationScene = SceneManager.GetSceneByName(unitySceneName);
                    unityScene = FindUnityLocationScene(_unityLocationScene, definition.Id);
                    if (unityScene != null)
                    {
                        _unityLocationRoot = unityScene.gameObject;
                        unityScene.RebuildIndex();
                        CurrentGroundRenderer = unityScene.GroundRenderer;
                        AdoptAuthoredEnvironment(_unityLocationScene);
                        PaintAuthoredGround(definition, authoritativeMap, unityScene.GroundRenderer);
                    }
                    else
                    {
                        Debug.LogError("[ROA] Unity location scene '" + unitySceneName
                            + "' has no matching RoaUnityLocationScene for " + definition.Id + ".");
                    }
                }
            }

            if (unityScene == null)
                BuildGround(definition, authoritativeMap, _currentRoot.transform);

            if (definition.Generated)
            {
                // Зона мира: сцены Unity нет, объекты — префабы набора из пулов.
                StepText = "Собираю зону...";
                RoaZoneAssembler assembler = ZoneAssembler;
                yield return StartCoroutine(assembler.Build(definition, _currentRoot.transform, _objectRoots, _objectEntries,
                    share => Progress = share));
                // Мелкий покров земли между объектами — инстансингом, без GameObject на экземпляр.
                var cover = new GameObject("ZoneGroundCover").AddComponent<RoaZoneGroundCover>();
                cover.transform.SetParent(_currentRoot.transform, false);
                cover.Build(definition, Application.isMobilePlatform);
                IsLoading = false;
                string zoneSummary = "Зона " + definition.Id + ": объектов " + assembler.ActiveCount
                    + ", создано новых " + assembler.CreatedCount + ", без префаба " + assembler.MissingPrefabs
                    + ", покров " + cover.InstanceCount;
                Debug.Log("[ROA] " + zoneSummary);
                onDone?.Invoke(true, zoneSummary);
                yield break;
            }

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
                if (entry == null) { skipped++; continue; }

                // Живые сущности приходят от сервера — здесь не создаём.
                if (entry.IsLiveEntity()) { skipped++; continue; }

                if (unityScene != null && unityScene.TryGetObject(entry.Id, out GameObject sceneObject))
                {
                    _objectRoots[entry.Id] = sceneObject;
                    _objectEntries[entry.Id] = entry;
                    built++;
                    continue;
                }

                // A Kromka scene may deliberately replace the legacy static JSON
                // composition. Missing static ids are then absent by design: spawning
                // their old GLB fallbacks would put the retired layout on top of the
                // editable Unity scene and create invisible server/client mismatches.
                if (unityScene != null && unityScene.ReplaceServerStaticGeometry)
                {
                    skipped++;
                    continue;
                }

                if (string.IsNullOrEmpty(entry.Url)) { skipped++; continue; }

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

        private static string UnitySceneName(string locationId)
        {
            return KromkaLocationSceneCatalog.SceneName(locationId);
        }

        private static RoaUnityLocationScene FindUnityLocationScene(Scene scene, string locationId)
        {
            if (!scene.IsValid() || !scene.isLoaded) return null;
            GameObject[] roots = scene.GetRootGameObjects();
            for (int i = 0; i < roots.Length; i++)
            {
                RoaUnityLocationScene marker = roots[i].GetComponentInChildren<RoaUnityLocationScene>(true);
                if (marker != null && string.Equals(marker.LocationId, locationId, StringComparison.Ordinal))
                    return marker;
            }
            return null;
        }

        /// <summary>
        /// Красит землю авторской сцены запечённым альбедо.
        ///
        /// Авторская земля — куб размером с карту с плоским цветом региона: из 660
        /// материалов, на которые ссылаются 57 локаций, текстура была ровно у
        /// одного. При этом генератор поверхности в проекте написан и проверен, но
        /// вызывался только там, где авторской сцены нет, — то есть ни в одной
        /// боевой локации. Здесь он получает авторскую землю как холст и пишет по
        /// ней тропы, воду, руду и рельеф по той же карте, что видит сервер.
        ///
        /// Геометрия, коллизии и обстановка остаются авторскими: трогается только
        /// материал того рендерера, который сцена сама объявила землёй.
        /// </summary>
        private void PaintAuthoredGround(LocationDefinition definition, JArray authoritativeMap, Renderer groundRenderer)
        {
            if (groundRenderer == null)
            {
                Debug.LogWarning("[ROA] Авторская сцена '" + (definition?.Id ?? "?")
                    + "' не объявила землю (GroundRenderer пуст) — покрасить нечего.");
                return;
            }
            var surface = new GameObject("AuthoredGroundPainter");
            surface.transform.SetParent(_currentRoot.transform, false);
            _groundSurface = surface.AddComponent<RoaLocalTerrain>();
            _groundSurface.InitializeAuthoredSurface(definition, authoritativeMap, groundRenderer);
            Debug.Log("[ROA] Земля локации покрашена: сетка "
                + _groundSurface.AuthoritativeMapWidth + "x" + _groundSurface.AuthoritativeMapDepth
                + ", альбедо " + _groundSurface.AlbedoTextureSize + " px, пресет '"
                + (definition.Ground?.Preset ?? string.Empty) + "'");
        }

        /// <summary>
        /// Переносит освещение авторской сцены на активную.
        ///
        /// Локации грузятся аддитивно, а Unity при аддитивной загрузке берёт
        /// окружение активной сцены, а не загруженной. Поэтому туман и ambient,
        /// прописанные в каждой из 57 локаций, до игрока не доходили: весь мир
        /// освещался холодным градиентом сцены-бутстрапа, из-за чего земля
        /// уходила в синеву (градиент светит цветом неба вверх-смотрящим
        /// поверхностям), а авторский пыльный туман не включался нигде.
        ///
        /// RenderSettings читает и пишет настройки ТЕКУЩЕЙ активной сцены, так что
        /// авторские значения снимаются коротким переключением активной сцены и
        /// тут же применяются к бутстрапу. Активной локация не остаётся: иначе в
        /// неё начали бы попадать создаваемые в рантайме объекты и умирать вместе
        /// с ней при переходе.
        /// </summary>
        private void AdoptAuthoredEnvironment(Scene authored)
        {
            if (!authored.IsValid() || !authored.isLoaded) return;
            Scene active = SceneManager.GetActiveScene();
            if (!active.IsValid() || active == authored) return;

            if (!_bootstrapEnvironmentCaptured)
            {
                _bootstrapEnvironment = RoaSceneEnvironment.Capture();
                _bootstrapEnvironmentCaptured = true;
            }

            RoaSceneEnvironment authoredEnvironment;
            if (!SceneManager.SetActiveScene(authored)) return;
            try
            {
                authoredEnvironment = RoaSceneEnvironment.Capture();
            }
            finally
            {
                SceneManager.SetActiveScene(active);
            }

            authoredEnvironment.Apply();
            Debug.Log("[ROA] Окружение локации: туман " + (authoredEnvironment.FogEnabled ? "включён" : "выключен")
                + ", ambient " + authoredEnvironment.AmbientMode
                + ", небо " + ColorUtility.ToHtmlStringRGB(authoredEnvironment.AmbientSky));
        }

        /// <summary>Возвращает освещение бутстрапа, когда авторская сцена уходит.</summary>
        private void RestoreBootstrapEnvironment()
        {
            if (!_bootstrapEnvironmentCaptured) return;
            _bootstrapEnvironment.Apply();
        }

        private void ReleaseUnityLocationScene()
        {
            if (_unityLocationRoot != null) RestoreBootstrapEnvironment();
            if (_unityLocationRoot != null) _unityLocationRoot.SetActive(false);
            _unityLocationRoot = null;
            if (_unityLocationScene.IsValid() && _unityLocationScene.isLoaded)
                _unitySceneUnload = SceneManager.UnloadSceneAsync(_unityLocationScene);
            _unityLocationScene = default;
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
        /// Применяет полную сетку, которую сервер присылает в worldState.map.
        /// Локальный клиент не генерирует проходимость и ресурсы самостоятельно.
        /// </summary>
        public bool ApplyWorldMap(JArray authoritativeMap)
        {
            if (_groundSurface != null) return _groundSurface.ApplyMap(authoritativeMap);
            return _unityLocationScene.IsValid() && _unityLocationScene.isLoaded;
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

            return holder;
        }

        internal static void ApplyTransform(Transform target, LocationObject entry)
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
