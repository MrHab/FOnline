using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>Личный, невидимый на карте мира дом и серверный режим строительства.</summary>
    [DisallowMultipleComponent]
    public sealed class RoaPersonalBaseCanvas : MonoBehaviour
    {
        private readonly Dictionary<string, GameObject> _worldObjects = new Dictionary<string, GameObject>();
        private readonly Dictionary<string, GameObject> _residentViews = new Dictionary<string, GameObject>();
        private RoaGameBootstrap _bootstrap;
        private RoaSocketClient _socket;
        private JObject _state;
        private Canvas _canvas;
        private GameObject _window;
        private RectTransform _list;
        private Text _summary;
        private Text _status;
        private GameObject _preview;
        private JObject _selectedBuild;
        private float _rotation;
        private bool _pending;

        public string Summary
        {
            get
            {
                if (_state == null) return "Запись убежища ещё не получена.";
                if (_state["available"]?.Value<bool>() != true) return "Участок не зарегистрирован. Найдите Актова и решите, чьи печати считать настоящими.";
                string tier = _state["tierProfile"]?["displayName"]?.ToString() ?? "Схрон";
                return tier + " · объектов " + (_state["objectCount"]?.Value<int>() ?? 0)
                    + " · энергия " + Signed(_state["energy"]?.Value<int>() ?? 0)
                    + " · вода " + Signed(_state["water"]?.Value<int>() ?? 0);
            }
        }

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket)
        {
            if (_socket != null) Unsubscribe();
            _bootstrap = bootstrap;
            _socket = socket;
            BuildUi();
            Subscribe();
        }

        public void Open()
        {
            BuildUi();
            _window.SetActive(true);
            RequestState();
            RefreshUi();
        }

        public void Close()
        {
            if (_window != null) _window.SetActive(false);
        }

        private void Subscribe()
        {
            if (_socket == null) return;
            _socket.OnPersonalBaseState += ApplyState;
            _socket.OnJoined += HandleJoined;
        }

        private void Unsubscribe()
        {
            if (_socket == null) return;
            _socket.OnPersonalBaseState -= ApplyState;
            _socket.OnJoined -= HandleJoined;
        }

        private void OnDestroy()
        {
            Unsubscribe();
            ClearWorldObjects();
        }

        private void HandleJoined(JoinAck _)
        {
            RequestState();
        }

        private void RequestState()
        {
            if (_socket == null || _socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            _socket.EmitWithAck("requestPersonalBaseState", new Dictionary<string, object>(), ack =>
            {
                JObject state = ack?["state"] as JObject;
                if (state != null) ApplyState(state);
            });
        }

        private void ApplyState(JObject state)
        {
            if (state == null) return;
            _state = (JObject)state.DeepClone();
            RefreshUi();
            RenderWorldObjects();
            RenderResidents();
        }

        private bool AtPersonalBase()
        {
            return _socket?.Session != null && _socket.Session.LocationId == "personalBase";
        }

        private bool IsOwner() { return _state?["isOwner"]?.Value<bool>() == true; }
        private bool HasAccess(string key) { return _state?["access"]?[key]?.Value<bool>() == true; }

        private void Update()
        {
            if (_preview == null || _selectedBuild == null) return;
            Camera camera = _bootstrap?.CameraRig != null ? _bootstrap.CameraRig.GetComponent<Camera>() : Camera.main;
            if (camera != null)
            {
                Ray ray = camera.ScreenPointToRay(Input.mousePosition);
                var plane = new Plane(Vector3.up, Vector3.zero);
                float distance;
                if (plane.Raycast(ray, out distance))
                {
                    Vector3 point = ray.GetPoint(distance);
                    point.x = Mathf.Round(point.x);
                    point.y = 0.5f;
                    point.z = Mathf.Round(point.z);
                    _preview.transform.position = point;
                }
            }
            if (Input.GetKeyDown(KeyCode.R))
            {
                _rotation = (_rotation + 90f) % 360f;
                _preview.transform.rotation = Quaternion.Euler(0f, _rotation, 0f);
            }
            if (Input.GetKeyDown(KeyCode.Escape) || Input.GetMouseButtonDown(1)) CancelBuild();
            else if (Input.GetMouseButtonDown(0) && (EventSystem.current == null || !EventSystem.current.IsPointerOverGameObject())) ConfirmBuild();
        }

        private void BeginBuild(JObject profile)
        {
            if (!AtPersonalBase() || !HasAccess("build")) { _status.text = "Для строительства нужен доступ владельца."; return; }
            CancelBuild();
            _selectedBuild = (JObject)profile.DeepClone();
            _rotation = 0f;
            _preview = GameObject.CreatePrimitive(PrimitiveType.Cube);
            _preview.name = "BaseBuildPreview:" + profile["id"];
            Collider collider = _preview.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            ApplyObjectShape(_preview, profile, new Color(0.28f, 0.92f, 0.65f, 0.55f));
            Close();
        }

        private void ConfirmBuild()
        {
            if (_pending || _preview == null || _selectedBuild == null) return;
            Vector3 point = _preview.transform.position;
            SendAction(new Dictionary<string, object>
            {
                ["action"] = "build", ["typeId"] = _selectedBuild["id"]?.ToString() ?? string.Empty,
                ["x"] = point.x, ["z"] = point.z, ["rotation"] = _rotation
            }, true);
            CancelBuild();
        }

        private void CancelBuild()
        {
            if (_preview != null) Destroy(_preview);
            _preview = null;
            _selectedBuild = null;
        }

        private void SendAction(Dictionary<string, object> payload, bool reopen = false)
        {
            if (_pending || _socket == null) return;
            if (!payload.ContainsKey("requestId")) payload["requestId"] = Guid.NewGuid().ToString("N");
            _pending = true;
            if (_status != null) _status.text = "Сервер проверяет…";
            _socket.EmitWithAck("personalBaseAction", payload, ack =>
            {
                _pending = false;
                if (ack?["ok"]?.Value<bool>() == true)
                {
                    JObject state = ack["state"] as JObject;
                    if (state != null) ApplyState(state);
                    _status.text = "Готово.";
                    if (reopen) Open();
                }
                else _status.text = ack?["error"]?.ToString() ?? "Действие отклонено.";
            });
        }

        private void RefreshUi()
        {
            if (_summary == null || _list == null) return;
            _summary.text = Summary;
            foreach (Transform child in _list) Destroy(child.gameObject);
            if (_state == null) return;
            bool available = _state["available"]?.Value<bool>() == true;
            if (!available)
            {
                AddHeader("ПРАВО НА ВОЗДУХ");
                JArray outcomes = _state["catalog"]?["rightsQuest"]?["outcomes"] as JArray;
                foreach (JToken token in outcomes ?? new JArray())
                {
                    if (!(token is JObject outcome)) continue;
                    AddAction(outcome["displayName"]?.ToString() ?? "Оформить", outcome["consequence"]?.ToString() ?? string.Empty,
                        () => SendAction(new Dictionary<string, object> { ["action"] = "resolveRights", ["outcomeId"] = outcome["id"]?.ToString() ?? "official" }));
                }
                return;
            }
            if (!AtPersonalBase())
            {
                AddAction("ВОЙТИ В УБЕЖИЩЕ", "Доступно только из спокойного безопасного поселения.",
                    () => SendAction(new Dictionary<string, object> { ["action"] = "enter" }));
                return;
            }
            bool isOwner = IsOwner();
            AddAction("ВЫЙТИ К ТРАКТУ", "Возвращение в последнее безопасное поселение.",
                () => SendAction(new Dictionary<string, object> { ["action"] = "leave" }));
            AddHeader(isOwner ? "ВЫ — ВЛАДЕЛЕЦ" : "ГОСТЕВОЙ ДОСТУП"
                + " · стройка " + (HasAccess("build") ? "да" : "нет")
                + " · склад " + (HasAccess("storage") ? "да" : "нет")
                + " · станции " + (HasAccess("stations") ? "да" : "нет"));
            if (isOwner)
            {
                AddAction("РАСШИРИТЬ ПЛОЩАДКУ", "Сервер проверит следующий уровень и стоимость.",
                    () => SendAction(new Dictionary<string, object> { ["action"] = "upgrade" }));
            }
            if (HasAccess("build"))
            {
                AddHeader("СТРОИТЕЛЬСТВО · ЛКМ поставить · R повернуть · ПКМ отменить");
                foreach (JToken token in (_state["catalog"]?["objects"] as JArray) ?? new JArray())
                {
                    if (!(token is JObject profile)) continue;
                    string details = profile["category"] + " · " + CostText(profile["cost"] as JObject);
                    AddAction(profile["displayName"]?.ToString() ?? profile["id"]?.ToString(), details, () => BeginBuild(profile));
                }
            }
            if (HasAccess("stations"))
            {
                int activeJobs = 0;
                foreach (JToken token in (_state["jobs"] as JArray) ?? new JArray())
                    if (token is JObject row && row["claimed"]?.Value<bool>() != true) activeJobs++;
                AddHeader("ПРОИЗВОДСТВО · очередь " + activeJobs + "/" + (_state["jobQueueLimit"]?.Value<int>() ?? 4));
                foreach (JToken token in (_state["catalog"]?["jobs"] as JArray) ?? new JArray())
                {
                    if (!(token is JObject job)) continue;
                    AddAction(job["displayName"]?.ToString() ?? "Работа", "Выполняется офлайн по серверному времени.",
                        () => SendAction(new Dictionary<string, object> { ["action"] = "startJob", ["typeId"] = job["id"]?.ToString() ?? string.Empty }));
                }
                foreach (JToken token in (_state["jobs"] as JArray) ?? new JArray())
                {
                    if (!(token is JObject job) || job["ready"]?.Value<bool>() != true) continue;
                    AddAction("ЗАБРАТЬ ГОТОВОЕ", job["typeId"]?.ToString() ?? string.Empty,
                        () => SendAction(new Dictionary<string, object> { ["action"] = "claimJob", ["jobId"] = job["id"]?.ToString() ?? string.Empty }));
                }
            }
            if (HasAccess("storage"))
            {
                AddHeader("СКЛАД БАЗЫ · " + (_state["storageUsed"]?.Value<int>() ?? 0)
                    + "/" + (_state["storageCapacity"]?.Value<int>() ?? 500));
                if (_state["inventory"] is JObject baseInventory)
                    foreach (JProperty entry in baseInventory.Properties())
                    {
                        string itemId = entry.Name;
                        int qty = entry.Value.Value<int>();
                        AddAction("ЗАБРАТЬ · " + RoaItemData.Name(itemId), "На складе: " + qty,
                            () => SendAction(new Dictionary<string, object> { ["action"] = "withdraw", ["itemId"] = itemId, ["qty"] = 1 }));
                    }
                if (_bootstrap?.Inventory != null)
                    foreach (RoaInventory.Row row in _bootstrap.Inventory.Items)
                    {
                        string itemId = row.Id;
                        int qty = row.Qty;
                        if (string.IsNullOrEmpty(itemId) || itemId == "fists" || qty <= 0) continue;
                        AddAction("ПОЛОЖИТЬ · " + RoaItemData.Name(itemId), "В рюкзаке: " + qty,
                            () => SendAction(new Dictionary<string, object> { ["action"] = "deposit", ["itemId"] = itemId, ["qty"] = 1 }));
                    }
            }
            if (isOwner)
            {
                AddHeader("ЖИТЕЛИ · ОСТАЮТСЯ НА БАЗЕ И НЕ ХОДЯТ С ИГРОКОМ");
                JObject residentPopulation = _state["residentPopulation"] as JObject;
                JObject residentStates = residentPopulation?["states"] as JObject;
                // Что база даёт сейчас: сумма вклада работающих жителей.
                string contribution = ResidentBonusLabel(residentPopulation?["bonuses"] as JObject);
                AddNote("ВКЛАД БАЗЫ: " + (string.IsNullOrEmpty(contribution) ? "пока ничего — назначьте жителей" : contribution));
                var activeResidents = new HashSet<string>();
                foreach (JToken id in (residentPopulation?["bonuses"]?["activeResidentIds"] as JArray) ?? new JArray())
                    activeResidents.Add(id?.ToString() ?? string.Empty);
                foreach (JToken token in (residentPopulation?["candidates"] as JArray) ?? new JArray())
                {
                    if (!(token is JObject resident)) continue;
                    string residentId = resident["id"]?.ToString() ?? string.Empty;
                    JObject residentState = residentStates?[residentId] as JObject;
                    bool recruited = residentState?["recruited"]?.Value<bool>() == true;
                    bool assigned = residentState?["assigned"]?.Value<bool>() == true;
                    string nextAction = !recruited ? "recruit" : assigned ? "unassign" : "assign";
                    string verb = !recruited ? "ПРИНЯТЬ" : assigned ? "ОСВОБОДИТЬ МЕСТО" : "НАЗНАЧИТЬ";
                    AddAction(verb + " · " + (resident["displayName"]?.ToString() ?? residentId),
                        ResidentRowText(resident, residentState, activeResidents.Contains(residentId)),
                        () => SendAction(new Dictionary<string, object> { ["action"] = "resident", ["residentAction"] = nextAction, ["residentId"] = residentId }),
                        ResidentRowHeight);
                    if (recruited && residentState?["personalQuestStarted"]?.Value<bool>() != true)
                        AddAction("ОТКРЫТЬ ЛИЧНОЕ ДЕЛО · " + (resident["personalQuestName"]?.ToString() ?? string.Empty), resident["bark"]?.ToString() ?? string.Empty,
                            () => SendAction(new Dictionary<string, object> { ["action"] = "resident", ["residentAction"] = "startQuest", ["residentId"] = residentId }));
                    else if (recruited && residentState?["personalQuestCompleted"]?.Value<bool>() != true)
                    {
                        JObject requirement = resident["questRequirement"] as JObject ?? new JObject();
                        string requiredItemId = requirement["itemId"]?.ToString() ?? string.Empty;
                        int requiredQty = requirement["qty"]?.Value<int>() ?? 0;
                        string requiredName = RoaItemData.Name(requiredItemId);
                        if (string.IsNullOrWhiteSpace(requiredName)) requiredName = requiredItemId;
                        string objective = resident["questObjective"]?.ToString() ?? "Выполнить просьбу специалиста.";
                        AddAction("ЗАВЕРШИТЬ ЛИЧНОЕ ДЕЛО · " + (resident["personalQuestName"]?.ToString() ?? string.Empty),
                            objective + "\nНужно: " + requiredName + " ×" + requiredQty,
                            () => SendAction(new Dictionary<string, object> { ["action"] = "resident", ["residentAction"] = "completeQuest", ["residentId"] = residentId }));
                    }
                }
            }
        }

        private void RenderWorldObjects()
        {
            if (!AtPersonalBase()) { ClearWorldObjects(); return; }
            var present = new HashSet<string>();
            JObject[] catalog = ((_state?["catalog"]?["objects"] as JArray) ?? new JArray()).ToObject<JObject[]>();
            var profiles = new Dictionary<string, JObject>();
            foreach (JObject row in catalog) profiles[row["id"]?.ToString() ?? string.Empty] = row;
            foreach (JToken token in (_state?["objects"] as JArray) ?? new JArray())
            {
                if (!(token is JObject row)) continue;
                string id = row["id"]?.ToString();
                string typeId = row["typeId"]?.ToString();
                if (string.IsNullOrEmpty(id) || !profiles.TryGetValue(typeId ?? string.Empty, out JObject profile)) continue;
                present.Add(id);
                if (!_worldObjects.TryGetValue(id, out GameObject view))
                {
                    view = GameObject.CreatePrimitive(profile["category"]?.ToString() == "generator" ? PrimitiveType.Cylinder : PrimitiveType.Cube);
                    view.name = "PersonalBaseObject:" + id;
                    _worldObjects[id] = view;
                    ApplyObjectShape(view, profile, CategoryColor(profile["category"]?.ToString()));
                }
                view.transform.position = new Vector3(row["x"]?.Value<float>() ?? 0f, view.transform.localScale.y * 0.5f, row["z"]?.Value<float>() ?? 0f);
                view.transform.rotation = Quaternion.Euler(0f, row["rotation"]?.Value<float>() ?? 0f, 0f);
            }
            foreach (string id in new List<string>(_worldObjects.Keys))
                if (!present.Contains(id)) { Destroy(_worldObjects[id]); _worldObjects.Remove(id); }
        }

        private void ClearWorldObjects()
        {
            foreach (GameObject view in _worldObjects.Values) if (view != null) Destroy(view);
            _worldObjects.Clear();
            foreach (GameObject view in _residentViews.Values) if (view != null) Destroy(view);
            _residentViews.Clear();
        }

        private void RenderResidents()
        {
            if (!AtPersonalBase()) return;
            var present = new HashSet<string>();
            JArray assigned = _state?["residentPopulation"]?["assigned"] as JArray;
            JArray candidates = _state?["residentPopulation"]?["candidates"] as JArray;
            int index = 0;
            foreach (JToken idToken in assigned ?? new JArray())
            {
                string id = idToken?.ToString() ?? string.Empty;
                JObject profile = null;
                foreach (JToken candidate in candidates ?? new JArray()) if (candidate?["id"]?.ToString() == id) { profile = candidate as JObject; break; }
                if (string.IsNullOrEmpty(id) || profile == null) continue;
                present.Add(id);
                if (!_residentViews.TryGetValue(id, out GameObject view))
                {
                    view = new GameObject("BaseResident:" + id);
                    view.name = "BaseResident:" + id;
                    var collider = view.AddComponent<CapsuleCollider>();
                    collider.radius = 0.36f; collider.height = 1.8f; collider.center = Vector3.up * 0.9f;
                    GameObject modelRoot = new GameObject("View"); modelRoot.transform.SetParent(view.transform, false);
                    RoaCharacterView characterView = modelRoot.AddComponent<RoaCharacterView>();
                    _ = LoadResidentModel(characterView, id, index);
                    GameObject nameGo = new GameObject("Name"); nameGo.transform.SetParent(view.transform, false); nameGo.transform.localPosition = Vector3.up * 1.35f;
                    TextMesh name = nameGo.AddComponent<TextMesh>(); name.text = (profile["displayName"]?.ToString() ?? id) + "\n" + (profile["roleName"]?.ToString() ?? string.Empty); name.fontSize = 36; name.characterSize = 0.055f; name.anchor = TextAnchor.MiddleCenter; name.alignment = TextAlignment.Center; name.color = new Color(0.8f, 0.92f, 0.72f);
                    _residentViews[id] = view;
                }
                JObject workObject = null;
                JArray requiredObjects = profile["requiredObjectTypeIds"] as JArray;
                foreach (JToken placedToken in (_state?["objects"] as JArray) ?? new JArray())
                {
                    if (!(placedToken is JObject placed) || requiredObjects == null) continue;
                    foreach (JToken required in requiredObjects)
                        if (placed["typeId"]?.ToString() == required?.ToString()) { workObject = placed; break; }
                    if (workObject != null) break;
                }
                if (workObject != null)
                {
                    float side = index % 2 == 0 ? 1.15f : -1.15f;
                    view.transform.position = new Vector3((workObject["x"]?.Value<float>() ?? 0f) + side, 0f, (workObject["z"]?.Value<float>() ?? 0f) + 0.7f);
                    view.transform.rotation = Quaternion.Euler(0f, index % 2 == 0 ? 225f : 135f, 0f);
                }
                else
                {
                    float angle = index * Mathf.PI * 2f / Mathf.Max(1, assigned.Count);
                    view.transform.position = new Vector3(Mathf.Cos(angle) * 5.5f, 0f, Mathf.Sin(angle) * 5.5f + 2f);
                }
                index++;
            }
            foreach (string id in new List<string>(_residentViews.Keys)) if (!present.Contains(id)) { Destroy(_residentViews[id]); _residentViews.Remove(id); }
        }

        private async Task LoadResidentModel(RoaCharacterView view, string id, int index)
        {
            if (view == null) return;
            bool female = index % 3 == 0;
            var appearance = new JObject
            {
                ["sex"] = female ? "female" : "male",
                ["bodyType"] = index % 4 == 0 ? "slim" : "medium",
                ["faceId"] = female ? "female_01" : "male_01",
                ["hairId"] = female ? "tied_back" : (index % 2 == 0 ? "short_crop" : "shaved"),
                ["skinToneId"] = "skin_03",
                ["hairColorId"] = index % 2 == 0 ? "hair_02" : "hair_03"
            };
            try { await view.Load(_bootstrap?.BaseUrl ?? "http://127.0.0.1:3000", appearance); }
            catch (Exception error) { Debug.LogWarning("[ROA] Не удалось загрузить модель жителя " + id + ": " + error.Message); }
        }

        private static void ApplyObjectShape(GameObject view, JObject profile, Color color)
        {
            JArray size = profile["size"] as JArray;
            view.transform.localScale = new Vector3(size?[0]?.Value<float>() ?? 1f, profile["category"]?.ToString() == "structure" ? 2.4f : 1.2f, size?[1]?.Value<float>() ?? 1f);
            Renderer renderer = view.GetComponent<Renderer>();
            if (renderer == null) return;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader) { color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            renderer.sharedMaterial = material;
        }

        private void BuildUi()
        {
            if (_canvas != null) return;
            GameObject canvasGo = new GameObject("PersonalBaseCanvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>(); _canvas.renderMode = RenderMode.ScreenSpaceOverlay; _canvas.sortingOrder = 245;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());
            _window = new GameObject("PersonalBaseWindow", typeof(RectTransform), typeof(Image));
            _window.transform.SetParent(canvasGo.transform, false);
            RectTransform window = (RectTransform)_window.transform;
            window.anchorMin = new Vector2(0.5f, 0.5f); window.anchorMax = window.anchorMin; window.pivot = window.anchorMin;
            window.sizeDelta = new Vector2(720f, 720f); window.anchoredPosition = Vector2.zero;
            _window.GetComponent<Image>().color = new Color(0.035f, 0.075f, 0.055f, 0.98f);
            _summary = Label(window, "Summary", 18, TextAnchor.MiddleLeft); Anchor(_summary.rectTransform, new Vector2(0f, 1f), new Vector2(12f, -12f), new Vector2(610f, 54f));
            Button close = Button(window, "Close", "×", out _); Anchor((RectTransform)close.transform, new Vector2(1f, 1f), new Vector2(-12f, -12f), new Vector2(52f, 42f)); close.onClick.AddListener(Close);
            _status = Label(window, "Status", 14, TextAnchor.MiddleLeft); Anchor(_status.rectTransform, new Vector2(0f, 0f), new Vector2(12f, 10f), new Vector2(690f, 34f));
            GameObject scrollGo = new GameObject("Scroll", typeof(RectTransform), typeof(Image), typeof(Mask), typeof(ScrollRect));
            scrollGo.transform.SetParent(window, false); RectTransform sr = (RectTransform)scrollGo.transform;
            sr.anchorMin = Vector2.zero; sr.anchorMax = Vector2.one; sr.offsetMin = new Vector2(12f, 50f); sr.offsetMax = new Vector2(-12f, -72f);
            scrollGo.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.24f); scrollGo.GetComponent<Mask>().showMaskGraphic = false;
            _list = new GameObject("Content", typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter)).GetComponent<RectTransform>();
            _list.SetParent(sr, false); _list.anchorMin = new Vector2(0f, 1f); _list.anchorMax = new Vector2(1f, 1f); _list.pivot = new Vector2(0.5f, 1f);
            _list.sizeDelta = Vector2.zero; // иначе контейнер на 100 px шире области прокрутки и маска режет края строк
            var layout = _list.GetComponent<VerticalLayoutGroup>(); layout.spacing = 6f; layout.padding = new RectOffset(8, 8, 8, 8); layout.childControlHeight = true; layout.childForceExpandHeight = false;
            _list.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            ScrollRect scroll = scrollGo.GetComponent<ScrollRect>(); scroll.content = _list; scroll.horizontal = false;
            _window.SetActive(false);
        }

        private void AddHeader(string text)
        {
            Text label = Label(_list, "Header", 15, TextAnchor.MiddleLeft); label.text = text; label.color = new Color(0.95f, 0.8f, 0.38f); label.gameObject.AddComponent<LayoutElement>().preferredHeight = 34f;
        }

        private void AddAction(string title, string details, Action action, float height = 58f)
        {
            Button button = Button(_list, "Action", title + "\n" + details, out Text label);
            label.alignment = TextAnchor.MiddleLeft; label.rectTransform.offsetMin = new Vector2(12f, 4f); label.rectTransform.offsetMax = new Vector2(-12f, -4f);
            button.gameObject.AddComponent<LayoutElement>().preferredHeight = height; button.onClick.AddListener(() => action());
        }

        /// <summary>Строка-пояснение в списке: вклад базы. Высота измерена пробой раскладки.</summary>
        private void AddNote(string text)
        {
            Text label = Label(_list, "Note", 14, TextAnchor.MiddleLeft);
            label.text = text;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.gameObject.AddComponent<LayoutElement>().preferredHeight = NoteHeight;
        }

        // --- вклад жителей: чистые форматтеры, их проверяет проба -------------------

        /// <summary>Ширина подписи строки списка: окно 720 минус прокрутка, отступы списка и подписи.</summary>
        public const float RowLabelWidth = 720f - 24f - 16f - 24f;
        public const float ResidentRowHeight = 80f;
        public const float NoteHeight = 88f;

        /// <summary>
        /// Что даёт житель или вся база. Подписаны только ключи, которые сервер
        /// действительно применяет; служебные поля вроде activeResidentIds пропускаются.
        /// </summary>
        public static string ResidentBonusLabel(JObject bonus)
        {
            if (bonus == null) return string.Empty;
            var parts = new List<string>();
            foreach (JProperty entry in bonus.Properties())
            {
                if (entry.Value.Type != JTokenType.Integer && entry.Value.Type != JTokenType.Float) continue;
                float value = entry.Value.Value<float>();
                if (Mathf.Approximately(value, 0f)) continue;
                string part = ResidentBonusPart(entry.Name, value);
                if (!string.IsNullOrEmpty(part)) parts.Add(part);
            }
            return string.Join(" · ", parts);
        }

        private static string ResidentBonusPart(string key, float value)
        {
            switch (key)
            {
                case "repairCostPct": return "ремонт дома " + Percent(-value);
                case "weaponWearPct": return "износ оружия при стрельбе " + Percent(value);
                case "medicineOutputPct": return "выход лекарств " + Percent(value);
                case "filterOutputPct": return "выход фильтров " + Percent(value);
                case "foodOutputPct": return "выход еды " + Percent(value);
                case "injuryRecoveryPct": return "сумка врача дома " + Percent(value);
                case "maxHpFlat": return "макс. ОЗ " + SignedNumber(Mathf.RoundToInt(value));
                case "artifactPenaltyPct": return "недостатки артефактов " + Percent(value);
                case "shiftWarningLeadSeconds": return "прогноз сдвига +" + Mathf.Max(1, Mathf.RoundToInt(value / 60f)) + " мин";
                case "commonTradePricePct": return "цены у торговцев выгоднее на " + Mathf.RoundToInt(value * 100f) + "%";
                case "extraOrders": return "очередь производства " + SignedNumber(Mathf.RoundToInt(value));
                case "storageCapacityPct": return "склад " + Percent(value);
                case "productionSpeedPct": return "скорость станков " + Percent(value);
                case "guestPermissionSlots": return "гостевые записи " + SignedNumber(Mathf.RoundToInt(value));
                case "waterUsePct": return "вода грядки " + Percent(value) + " (не меньше 1 за цикл)";
                case "scrapPerHour": return "лом " + SignedNumber(Mathf.RoundToInt(value)) + "/ч";
                default: return string.Empty;
            }
        }

        /// <summary>
        /// Строка жителя под именем: роль, лояльность, работает ли он сейчас,
        /// что даёт и что ему нужно. Назначенный, но неактивный житель
        /// простаивает — без этого снос нужной постройки проходил незаметно.
        /// </summary>
        public static string ResidentRowText(JObject resident, JObject state, bool active)
        {
            if (resident == null) return string.Empty;
            bool recruited = state?["recruited"]?.Value<bool>() == true;
            bool assigned = state?["assigned"]?.Value<bool>() == true;
            var sb = new System.Text.StringBuilder(resident["roleName"]?.ToString() ?? string.Empty);
            if (recruited) sb.Append(" · лояльность ").Append(state?["loyalty"]?.Value<int>() ?? 0);
            if (assigned) sb.Append(active ? " · РАБОТАЕТ" : " · ПРОСТАИВАЕТ");
            string gives = ResidentBonusLabel(resident["bonus"] as JObject);
            if (!string.IsNullOrEmpty(gives)) sb.Append("\nДаёт: ").Append(gives);
            string need = resident["need"]?.ToString();
            if (!string.IsNullOrEmpty(need)) sb.Append("\nНужно: ").Append(need);
            return sb.ToString();
        }

        private static string Percent(float value)
        {
            int rounded = Mathf.RoundToInt(value * 100f);
            return (rounded > 0 ? "+" : rounded < 0 ? "−" : string.Empty) + Mathf.Abs(rounded) + "%";
        }

        private static string SignedNumber(int value)
        {
            return (value > 0 ? "+" : value < 0 ? "−" : string.Empty) + Mathf.Abs(value);
        }

        private static string CostText(JObject cost)
        {
            if (cost == null || !cost.HasValues) return "без материалов";
            var parts = new List<string>(); foreach (var entry in cost) parts.Add(entry.Key + " " + entry.Value); return string.Join(" · ", parts);
        }
        private static string Signed(int value) { return value > 0 ? "+" + value : value.ToString(); }
        private static Color CategoryColor(string category) { return category == "station" ? new Color(0.32f, 0.58f, 0.62f) : category == "generator" ? new Color(0.72f, 0.48f, 0.18f) : new Color(0.35f, 0.39f, 0.36f); }
        private static Text Label(Transform parent, string name, int size, TextAnchor align) { var go = new GameObject(name, typeof(RectTransform), typeof(Text)); go.transform.SetParent(parent, false); var text = go.GetComponent<Text>(); text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); text.fontSize = size; text.alignment = align; text.color = new Color(0.72f, 0.92f, 0.68f); return text; }
        private static Button Button(Transform parent, string name, string value, out Text label) { var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button)); go.transform.SetParent(parent, false); go.GetComponent<Image>().color = new Color(0.1f, 0.2f, 0.14f, 0.98f); label = Label(go.transform, "Label", 14, TextAnchor.MiddleCenter); label.text = value; label.rectTransform.anchorMin = Vector2.zero; label.rectTransform.anchorMax = Vector2.one; label.rectTransform.offsetMin = new Vector2(4f, 2f); label.rectTransform.offsetMax = new Vector2(-4f, -2f); return go.GetComponent<Button>(); }
        private static void Anchor(RectTransform rect, Vector2 anchor, Vector2 pos, Vector2 size) { rect.anchorMin = rect.anchorMax = anchor; rect.pivot = anchor; rect.anchoredPosition = pos; rect.sizeDelta = size; }
    }
}
