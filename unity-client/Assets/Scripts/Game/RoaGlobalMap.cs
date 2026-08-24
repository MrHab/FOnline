using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Networking;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Сервер-авторитетная глобальная карта. Геометрия берётся из
    /// /api/global-map, маршрут строит сервер, а клиент только показывает его
    /// и запрашивает прибытие после подтверждённого времени.
    /// </summary>
    public sealed class RoaGlobalMap : MonoBehaviour
    {
        private const float MapWorldScale = 0.1f;
        private const float NodeSnapRadiusPoints = 18f;
        private const float DynamicSnapRadiusPoints = 13f;
        private const float WastelandRefreshSeconds = 5f;
        // Only bridges main-thread queue reordering; it is not a client authority timeout.
        private const float TravelDescriptorGraceSeconds = 2.5f;

        public RoaSocketClient Socket;
        public RoaCameraRig CameraRig;
        public string BaseUrl = "http://127.0.0.1:3000";

        public bool IsActive { get; private set; }
        public bool InputEnabled = true;
        public string StatusText { get; private set; } = string.Empty;
        public int TerritoryCellCount { get; private set; }
        public int TerritoryBorderCount { get; private set; }
        public int InfluenceZoneCount { get; private set; }
        public int SettlementModelCount { get; private set; }
        public int SiteMarkerCount { get; private set; }
        public int SettlementStatusCount { get; private set; }
        public int SiteMeshVertexCount { get; private set; }
        public int SiteMeshSubMeshCount { get; private set; }
        public string SelectionSummary { get { return BuildSelectionSummary(); } }
        public string FactionSummary { get { return BuildFactionSummary(); } }
        public string AttachedPartyId { get { return _state?["attachedPartyId"]?.ToString() ?? string.Empty; } }

        // --- Фасад для канва-сайдбара (RoaGlobalMapCanvas), структура renderGlobalMapPanel web (12b). ---

        /// <summary>Сайдбар рисует канва; IMGUI-панель информации не рисуется.</summary>
        public bool CanvasDriven { get; set; }

        public bool ArrivalPending { get { return _arrivalPending; } }
        public bool ContactDecisionPending { get { return _contactDecisionPending; } }
        public bool HasPendingContact { get { return _pendingContact != null; } }
        public string PendingContactName { get { return _pendingContact?.Name ?? "Событие пустоши"; } }
        public string PendingContactDetails { get { return _pendingContact?.Details ?? string.Empty; } }
        public bool PendingContactForced { get { return _pendingContact != null && _pendingContact.Forced; } }
        public bool LocalIsLeader { get { return IsLocalTravelLeader(); } }
        public JObject WastelandState { get { return _wasteland; } }
        public Vector2 PlayerXY { get { return _playerPoint != null ? new Vector2(_playerPoint.X, _playerPoint.Y) : Vector2.zero; } }
        public Vector2 SelectedXY { get { return _selectedPoint != null ? new Vector2(_selectedPoint.X, _selectedPoint.Y) : Vector2.zero; } }
        public float TravelProgress
        {
            get { return _travelActive ? Mathf.Clamp01((Time.realtimeSinceStartup - _travelStartedRealtime) / Mathf.Max(0.01f, _travelDuration)) : 0f; }
        }
        public float TravelSecondsLeft
        {
            get { return _travelActive ? Mathf.Max(0f, _travelDuration * (1f - TravelProgress)) : 0f; }
        }

        /// <summary>Клетка карты для точки — «Клетка cx:cy» в тексте маршрута web.</summary>
        public Vector2Int CellOf(Vector2 point)
        {
            if (_map == null || _map.Grid == null) return Vector2Int.zero;
            return new Vector2Int(
                Mathf.Clamp(Mathf.FloorToInt(point.x / _map.Grid.CellPoints), 0, _map.Grid.Cols - 1) + 1,
                Mathf.Clamp(Mathf.FloorToInt(point.y / _map.Grid.CellPoints), 0, _map.Grid.Rows - 1) + 1);
        }

        public float DistanceKm(Vector2 a, Vector2 b)
        {
            if (_map == null || _map.Grid == null) return 0f;
            float points = Vector2.Distance(a, b);
            return points / Mathf.Max(0.001f, _map.Grid.CellPoints) * _map.Grid.CellKm;
        }

        /// <summary>Имя выбранной цели: динамический объект, узел карты или точка пустоши.</summary>
        public string SelectedTitle
        {
            get
            {
                if (_selectedDynamic != null) return _selectedDynamic.Name ?? _selectedDynamic.Id ?? "точка пустоши";
                if (_selectedNode != null) return NodeTitle(_selectedNode);
                return "Точка пустоши";
            }
        }

        /// <summary>Узел (поселение/точка входа) под игроком, если он стоит в его радиусе.</summary>
        public GlobalMapNode PlayerNode { get { return _playerPoint != null ? NearestNode(_playerPoint, NodeSnapRadiusPoints) : null; } }
        public bool PlayerAtSelection { get { return _playerPoint != null && _selectedPoint != null && Distance(_playerPoint, _selectedPoint) <= 0.35f; } }

        /// <summary>Площадка живой пустоши под игроком (для доски работ сайдбара).</summary>
        public JObject PlayerSiteData()
        {
            JArray sites = _wasteland?["sites"] as JArray;
            if (sites == null || _playerPoint == null) return null;
            GlobalMapNode node = PlayerNode;
            JObject nearest = null;
            float nearestDistance = 15f;
            foreach (JToken token in sites)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string id = row["id"]?.ToString() ?? string.Empty;
                string rowLocation = row["locationId"]?.ToString() ?? string.Empty;
                if (node != null && (id == node.Id || id == node.EffectiveLocationId || rowLocation == node.EffectiveLocationId)) return row;
                float distance = Distance(_playerPoint, ReadPoint(row, "x", "y", null));
                if (distance > nearestDistance) continue;
                nearest = row;
                nearestDistance = distance;
            }
            return nearest;
        }

        public string NodeTitle(GlobalMapNode node)
        {
            if (node == null) return string.Empty;
            string locationId = node.EffectiveLocationId;
            LocationDefinition definition = _bootstrap?.Loader != null ? _bootstrap.Loader.GetDefinition(locationId) : null;
            if (definition != null && !string.IsNullOrEmpty(definition.Name)) return definition.Name;
            foreach (JToken token in _wasteland?["sites"] as JArray ?? new JArray())
                if (token?["id"]?.ToString() == node.Id || token?["locationId"]?.ToString() == locationId)
                    return token["name"]?.ToString() ?? locationId;
            return locationId;
        }

        // Прибытие к локации ждёт кнопки «Войти» (pendingWorldDrop web), а не входит само.
        private bool _pendingEntry;
        public bool PendingEntry { get { return _pendingEntry; } }
        public string PendingEntryTitle { get { return _pendingEntry ? SelectedTitle : string.Empty; } }

        /// <summary>Подпись кнопки «Войти» и её доступность — как enterBtn в renderGlobalMapPanel.</summary>
        public bool CanEnter(out string label)
        {
            label = "Войти";
            if (_travelActive || _pendingContact != null || !string.IsNullOrEmpty(AttachedPartyId) || _arrivalPending) return false;
            if (_pendingEntry) { label = "Войти: " + SelectedTitle; return true; }
            GlobalMapNode node = PlayerNode;
            if (node != null) { label = "Войти: " + NodeTitle(node); return true; }
            // Точка мира с локацией под игроком (globalMapWorldSiteCanEnter web).
            DynamicTarget site = _playerPoint != null ? NearestDynamicTarget(_playerPoint, DynamicSnapRadiusPoints) : null;
            if (site != null && !string.IsNullOrEmpty(site.LocationId) && site.Kind == "site")
            {
                label = "Войти: " + (site.Name ?? site.Id);
                return true;
            }
            return false;
        }

        public void EnterCurrent()
        {
            string label;
            if (!CanEnter(out label)) return;
            if (!_pendingEntry)
            {
                GlobalMapNode node = PlayerNode;
                _selectedNode = node;
                _selectedDynamic = node == null ? NearestDynamicTarget(_playerPoint, DynamicSnapRadiusPoints) : null;
                _selectedPoint = CopyPoint(_playerPoint);
            }
            _pendingEntry = false;
            RequestArrival();
        }

        public void CancelOrLeave()
        {
            if (!string.IsNullOrEmpty(AttachedPartyId)) RequestLeaveAttachedWorldParty();
            else CancelTravel();
        }

        public void ResolveContact(bool enter) { ResolveTravelContact(enter); }
        public void BeginTravel() { StartTravel(); }

        public string AttachedPartyTaskId { get { return _state?["attachedPartyTaskId"]?.ToString() ?? string.Empty; } }
        public bool TravelActive { get { return _travelActive; } }
        public bool ContactPending { get { return _pendingContact != null; } }
        public string PendingContactId { get { return _pendingContact?.Id ?? string.Empty; } }
        public float PlayerMapX { get { return _playerPoint.X; } }
        public float PlayerMapY { get { return _playerPoint.Y; } }
        public float SelectedMapX { get { return _selectedPoint.X; } }
        public float SelectedMapY { get { return _selectedPoint.Y; } }

        private RoaGameBootstrap _bootstrap;
        private GlobalMapDefinition _map;
        private JObject _state;

        private GameObject _root;
        private GameObject _playerMarker;
        private GameObject _selectionMarker;
        private GameObject _cameraAnchor;
        private MeshCollider _terrainCollider;
        private LineRenderer _routeLine;
        private Texture2D _terrainTexture;
        private readonly List<Material> _materials = new List<Material>();
        private readonly List<Material> _dynamicMaterials = new List<Material>();
        private readonly List<Mesh> _dynamicMeshes = new List<Mesh>();
        private readonly Dictionary<string, Material> _dynamicMaterialCache = new Dictionary<string, Material>();

        private sealed class MeshBucket
        {
            public Color Color;
            public readonly List<Vector3> Vertices = new List<Vector3>();
            public readonly List<int> Triangles = new List<int>();
        }

        private sealed class DynamicTarget
        {
            public string Kind;
            public string Id;
            public string Name;
            public string LocationId;
            public string SiteId;
            public string PartyId;
            public string WorldZoneId;
            public string Details;
            public string Faction;
            public GlobalMapPoint Point;
            public float Radius;
            public bool CanEnter;
            public bool Forced;
            public JObject Data;
        }

        private JObject _wasteland;
        private GameObject _dynamicRoot;
        private Coroutine _wastelandPoll;
        private readonly List<DynamicTarget> _dynamicTargets = new List<DynamicTarget>();
        private readonly List<LineRenderer> _activityHighlightRings = new List<LineRenderer>();
        private string _activityHighlightKey = string.Empty;
        private readonly Dictionary<string, JObject> _territoryByCell = new Dictionary<string, JObject>();
        private DynamicTarget _selectedDynamic;
        private string _factionSummary = string.Empty;

        private GlobalMapPoint _playerPoint = new GlobalMapPoint();
        private GlobalMapPoint _selectedPoint = new GlobalMapPoint();
        private GlobalMapNode _selectedNode;
        private List<GlobalMapPoint> _route = new List<GlobalMapPoint>();
        private float _travelDuration;
        private float _travelStartedRealtime;
        private bool _travelActive;
        private float _travelDescriptorGraceUntil;
        private bool _arrivalPending;
        private float _arrivalRetryAt;
        private bool _contactArrival;
        private DynamicTarget _savedDestinationDynamic;
        private GlobalMapNode _savedDestinationNode;
        private GlobalMapPoint _savedDestinationPoint;
        private readonly HashSet<string> _ignoredRouteContacts = new HashSet<string>();
        private DynamicTarget _pendingContact;
        private string _travelLeaderId = string.Empty;
        private bool _contactDecisionPending;
        private Vector2 _panelScroll;

        private bool _cameraSaved;
        private float _savedDistance;
        private float _savedMinDistance;
        private float _savedMaxDistance;
        private float _savedPitch;
        private float _savedYaw;
        private bool _cameraPanning;
        private Vector2 _lastPanPointer;

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket,
                              RoaCameraRig cameraRig, string baseUrl)
        {
            DetachSocket();
            _bootstrap = bootstrap;
            Socket = socket;
            CameraRig = cameraRig;
            BaseUrl = string.IsNullOrEmpty(baseUrl) ? BaseUrl : baseUrl;
            AttachSocket();
        }

        private void AttachSocket()
        {
            if (Socket == null) return;
            Socket.OnGlobalTravelStarted += HandleTravelStarted;
            Socket.OnGlobalTravelEnteredWorld += HandleEnteredWorld;
            Socket.OnGlobalTravelCancelled += HandleTravelCancelled;
            Socket.OnGlobalTravelArrived += HandleTravelArrived;
            Socket.OnGlobalTravelGroupReleased += HandleGroupReleased;
            Socket.OnGlobalTravelEncounterDecision += HandleEncounterDecision;
        }

        private void DetachSocket()
        {
            if (Socket == null) return;
            Socket.OnGlobalTravelStarted -= HandleTravelStarted;
            Socket.OnGlobalTravelEnteredWorld -= HandleEnteredWorld;
            Socket.OnGlobalTravelCancelled -= HandleTravelCancelled;
            Socket.OnGlobalTravelArrived -= HandleTravelArrived;
            Socket.OnGlobalTravelGroupReleased -= HandleGroupReleased;
            Socket.OnGlobalTravelEncounterDecision -= HandleEncounterDecision;
        }

        private void OnDestroy()
        {
            DetachSocket();
            ClearVisuals();
        }

        /// <summary>Показать глобальную карту из self.globalMap успешного join.</summary>
        public IEnumerator EnterFromJoin(JoinAck ack, Action<bool, string> onDone)
        {
            JObject state = ack != null && ack.Self != null
                ? ack.Self["globalMap"] as JObject
                : null;

            if (state == null)
            {
                onDone?.Invoke(false, "В join нет авторитетного self.globalMap.");
                yield break;
            }

            yield return Enter(state, onDone);
        }

        /// <summary>Показать карту после globalTravelEnterWorld или события лидера.</summary>
        public IEnumerator Enter(JObject state, Action<bool, string> onDone)
        {
            if (_wastelandPoll != null) StopCoroutine(_wastelandPoll);
            _wastelandPoll = null;
            if (_map == null)
            {
                bool loaded = false;
                string loadError = null;
                yield return FetchDefinition((ok, error) =>
                {
                    loaded = ok;
                    loadError = error;
                });

                if (!loaded)
                {
                    StatusText = loadError;
                    onDone?.Invoke(false, loadError);
                    yield break;
                }
            }

            ClearVisuals();
            BuildVisuals();
            ApplyState(state);
            IsActive = true;
            StatusText = _travelActive ? "Маршрут восстановлен сервером." : "Выберите точку на карте.";
            ConfigureCamera();
            _wastelandPoll = StartCoroutine(PollWasteland());
            onDone?.Invoke(true, "Глобальная карта загружена: " + _map.Nodes.Count + " поселения, "
                                  + _map.Infrastructure.Count + " объектов инфраструктуры.");
        }

        /// <summary>
        /// Обновить уже открытую карту полным серверным self.globalMap. Это важно при
        /// присоединении к мировой группе и выходе из неё: маршрут и лидер меняются без нового join.
        /// </summary>
        public void ApplyAuthoritativeState(JObject state)
        {
            if (!IsActive || state == null) return;
            ApplyState(state, true);
        }

        public void Leave()
        {
            _pendingEntry = false;
            IsActive = false;
            _cameraPanning = false;
            _travelActive = false;
            _arrivalPending = false;
            if (_wastelandPoll != null) StopCoroutine(_wastelandPoll);
            _wastelandPoll = null;
            RestoreCamera();
            ClearVisuals();
        }

        private IEnumerator PollWasteland()
        {
            while (IsActive)
            {
                yield return FetchWasteland();
                float until = Time.realtimeSinceStartup + WastelandRefreshSeconds;
                while (IsActive && Time.realtimeSinceStartup < until) yield return null;
            }
            _wastelandPoll = null;
        }

        private IEnumerator FetchWasteland()
        {
            using (UnityWebRequest request = UnityWebRequest.Get(BaseUrl.TrimEnd('/') + "/api/wasteland"))
            {
                request.SetRequestHeader("Cache-Control", "no-store");
                yield return request.SendWebRequest();
                if (!IsActive) yield break;
                if (request.result != UnityWebRequest.Result.Success)
                {
                    StatusText = "Живая пустошь временно недоступна: " + request.error;
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    JObject sim = payload["sim"] as JObject;
                    if (sim == null) throw new JsonException("В ответе нет поля sim.");
                    _wasteland = sim;
                    RebuildDynamicWorld();
                }
                catch (JsonException error)
                {
                    StatusText = "Не удалось разобрать живую пустошь: " + error.Message;
                }
            }
        }

        private IEnumerator FetchDefinition(Action<bool, string> onDone)
        {
            string url = BaseUrl.TrimEnd('/') + "/api/global-map";
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    onDone?.Invoke(false, "Не удалось получить глобальную карту: " + request.error);
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    JToken mapToken = payload["map"];
                    if (mapToken == null)
                    {
                        onDone?.Invoke(false, "В /api/global-map нет поля map.");
                        yield break;
                    }

                    _map = mapToken.ToObject<GlobalMapDefinition>();
                    if (_map == null || _map.Grid == null || _map.Grid.Cols <= 0 || _map.Grid.Rows <= 0)
                    {
                        onDone?.Invoke(false, "Сервер прислал некорректную сетку глобальной карты.");
                        yield break;
                    }

                    onDone?.Invoke(true, null);
                }
                catch (JsonException error)
                {
                    onDone?.Invoke(false, "Некорректный JSON глобальной карты: " + error.Message);
                }
            }
        }

        private void BuildVisuals()
        {
            _root = new GameObject("GlobalMap");
            BuildTerrain();
            BuildInfrastructure();
            BuildNodes();

            _routeLine = CreateLine("ActiveRoute", new Color(1f, 0.68f, 0.18f), 0.32f, 0.22f);

            _playerMarker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            _playerMarker.name = "GlobalPlayer";
            _playerMarker.transform.SetParent(_root.transform, false);
            _playerMarker.transform.localScale = Vector3.one * 0.9f;
            ApplyMaterial(_playerMarker, new Color(0.95f, 0.83f, 0.22f));
            Destroy(_playerMarker.GetComponent<Collider>());

            _selectionMarker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            _selectionMarker.name = "SelectedDestination";
            _selectionMarker.transform.SetParent(_root.transform, false);
            _selectionMarker.transform.localScale = new Vector3(0.75f, 0.06f, 0.75f);
            ApplyMaterial(_selectionMarker, new Color(0.2f, 0.78f, 0.95f));
            Destroy(_selectionMarker.GetComponent<Collider>());

            _cameraAnchor = new GameObject("GlobalMapCameraAnchor");
            _cameraAnchor.transform.SetParent(_root.transform, false);
        }

        private void BuildTerrain()
        {
            float width = MapWidthPoints * MapWorldScale;
            float depth = MapHeightPoints * MapWorldScale;

            var mesh = new Mesh { name = "GlobalMapTerrain" };
            mesh.vertices = new[]
            {
                new Vector3(-width * 0.5f, 0f, -depth * 0.5f),
                new Vector3(width * 0.5f, 0f, -depth * 0.5f),
                new Vector3(-width * 0.5f, 0f, depth * 0.5f),
                new Vector3(width * 0.5f, 0f, depth * 0.5f)
            };
            mesh.uv = new[] { new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(0f, 1f), new Vector2(1f, 1f) };
            mesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var terrain = new GameObject("Terrain");
            terrain.transform.SetParent(_root.transform, false);
            terrain.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = terrain.AddComponent<MeshRenderer>();

            _terrainTexture = new Texture2D(_map.Grid.Cols, _map.Grid.Rows, TextureFormat.RGBA32, false);
            _terrainTexture.name = "GlobalMapCells";
            _terrainTexture.filterMode = FilterMode.Point;
            _terrainTexture.wrapMode = TextureWrapMode.Clamp;

            for (int cy = 0; cy < _map.Grid.Rows; cy++)
            {
                for (int cx = 0; cx < _map.Grid.Cols; cx++)
                {
                    GlobalMapCell cell;
                    _map.Cells.TryGetValue(cx + ":" + cy, out cell);
                    // Верх карты (cy=0) соответствует верхнему краю текстуры.
                    _terrainTexture.SetPixel(cx, _map.Grid.Rows - 1 - cy, CellColor(cell));
                }
            }
            _terrainTexture.Apply(false, false);

            Material material = CreateMaterial(Color.white);
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", _terrainTexture);
            else if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", _terrainTexture);
            renderer.sharedMaterial = material;

            _terrainCollider = terrain.AddComponent<MeshCollider>();
            _terrainCollider.sharedMesh = mesh;
        }

        private void BuildInfrastructure()
        {
            foreach (GlobalMapInfrastructure row in _map.Infrastructure)
            {
                if (row == null || row.Points == null || row.Points.Count < 2) continue;
                bool pipeline = string.Equals(row.Type, "pipeline", StringComparison.OrdinalIgnoreCase);
                Color color = pipeline ? new Color(0.33f, 0.48f, 0.5f) : new Color(0.25f, 0.21f, 0.17f);
                float width = Mathf.Clamp(row.Width * MapWorldScale, 0.18f, 1.1f);
                LineRenderer line = CreateLine("Infrastructure:" + row.Id, color, width, 0.08f);
                SetLinePoints(line, row.Points);
            }
        }

        private void BuildNodes()
        {
            SettlementModelCount = 0;
            foreach (GlobalMapNode node in _map.Nodes)
            {
                if (node == null) continue;
                BuildSettlementModel(node);
                SettlementModelCount++;
            }
        }

        private void BuildSettlementModel(GlobalMapNode node)
        {
            var group = new GameObject("SettlementModel:" + node.Id);
            group.transform.SetParent(_root.transform, false);
            group.transform.localPosition = PointToWorld(node.X, node.Y, 0.08f);
            group.transform.localScale = Vector3.one * 1.25f;
            Color accent = NodeColor(node.Id);

            CreateNodePart(group.transform, "Foundation", PrimitiveType.Cylinder,
                new Vector3(0f, 0.03f, 0f), new Vector3(1.28f, 0.035f, 1.28f),
                new Color(accent.r * 0.38f, accent.g * 0.38f, accent.b * 0.38f), Vector3.zero);

            string id = (node.Id ?? string.Empty).ToLowerInvariant();
            if (id == "relaystation")
            {
                CreateNodePart(group.transform, "RelayBase", PrimitiveType.Cube, new Vector3(0f, 0.14f, 0f), new Vector3(0.72f, 0.22f, 0.58f), Hex(0x38464c), Vector3.zero);
                CreateNodePart(group.transform, "RelayMast", PrimitiveType.Cylinder, new Vector3(0f, 0.78f, 0f), new Vector3(0.09f, 0.65f, 0.09f), Hex(0x252c31), Vector3.zero);
                CreateNodePart(group.transform, "RelayPanelA", PrimitiveType.Cube, new Vector3(-0.24f, 0.56f, 0.04f), new Vector3(0.4f, 0.25f, 0.045f), Hex(0x2f7084), new Vector3(-12f, -20f, 0f));
                CreateNodePart(group.transform, "RelayPanelB", PrimitiveType.Cube, new Vector3(0.25f, 0.78f, -0.04f), new Vector3(0.42f, 0.24f, 0.045f), Hex(0x3f8797), new Vector3(10f, 22f, 0f));
                CreateNodePart(group.transform, "RelayBeacon", PrimitiveType.Sphere, new Vector3(0f, 1.45f, 0f), Vector3.one * 0.15f, accent, Vector3.zero);
            }
            else if (id == "scraptown")
            {
                CreateNodePart(group.transform, "ScrapBase", PrimitiveType.Cube, new Vector3(0f, 0.12f, 0f), new Vector3(0.86f, 0.16f, 0.62f), Hex(0x3a3730), new Vector3(0f, 8f, 0f));
                CreateNodePart(group.transform, "ScrapPileA", PrimitiveType.Cube, new Vector3(-0.2f, 0.3f, 0.04f), new Vector3(0.52f, 0.12f, 0.3f), Hex(0x8b6c42), new Vector3(7f, -24f, 9f));
                CreateNodePart(group.transform, "ScrapPileB", PrimitiveType.Cube, new Vector3(0.18f, 0.43f, -0.05f), new Vector3(0.5f, 0.1f, 0.26f), Hex(0x58615e), new Vector3(-5f, 28f, -6f));
                CreateNodePart(group.transform, "ScrapTank", PrimitiveType.Cylinder, new Vector3(0.34f, 0.25f, 0.25f), new Vector3(0.27f, 0.22f, 0.27f), Hex(0x1b1917), new Vector3(90f, 0f, 0f));
            }
            else if (id == "caravancamp")
            {
                CreateNodePart(group.transform, "CaravanYard", PrimitiveType.Cube, new Vector3(0f, 0.1f, 0f), new Vector3(0.9f, 0.14f, 0.66f), Hex(0x5a4932), new Vector3(0f, -8f, 0f));
                CreateNodePart(group.transform, "TentA", PrimitiveType.Cube, new Vector3(-0.23f, 0.32f, -0.06f), new Vector3(0.34f, 0.34f, 0.38f), Hex(0xb7a36d), new Vector3(0f, 18f, 45f));
                CreateNodePart(group.transform, "TentB", PrimitiveType.Cube, new Vector3(0.2f, 0.29f, 0.12f), new Vector3(0.31f, 0.31f, 0.34f), Hex(0x93835b), new Vector3(0f, -14f, 45f));
                CreateNodePart(group.transform, "Wagon", PrimitiveType.Cube, new Vector3(0.32f, 0.18f, -0.25f), new Vector3(0.5f, 0.2f, 0.26f), Hex(0x6b5234), new Vector3(0f, 16f, 0f));
                CreateNodePart(group.transform, "Campfire", PrimitiveType.Sphere, new Vector3(-0.05f, 0.15f, -0.27f), Vector3.one * 0.13f, Hex(0xff9d3b), Vector3.zero);
            }
            else
            {
                CreateNodePart(group.transform, "KlimYard", PrimitiveType.Cube, new Vector3(0f, 0.12f, 0f), new Vector3(0.9f, 0.16f, 0.68f), Hex(0x5b432b), Vector3.zero);
                CreateNodePart(group.transform, "KlimHall", PrimitiveType.Cube, new Vector3(-0.1f, 0.34f, 0f), new Vector3(0.58f, 0.38f, 0.45f), Hex(0x7a5b34), new Vector3(0f, 9f, 0f));
                CreateNodePart(group.transform, "KlimRoof", PrimitiveType.Cube, new Vector3(-0.1f, 0.58f, 0f), new Vector3(0.5f, 0.26f, 0.5f), Hex(0x493624), new Vector3(0f, 9f, 45f));
                CreateNodePart(group.transform, "KlimTower", PrimitiveType.Cylinder, new Vector3(0.36f, 0.49f, -0.16f), new Vector3(0.13f, 0.45f, 0.13f), Hex(0x30261c), Vector3.zero);
            }

            CreateNodePart(group.transform, "FlagPole", PrimitiveType.Cylinder, new Vector3(0.48f, 0.55f, -0.32f), new Vector3(0.045f, 0.5f, 0.045f), Hex(0x21170e), Vector3.zero);
            CreateNodePart(group.transform, "Flag", PrimitiveType.Cube, new Vector3(0.62f, 0.91f, -0.32f), new Vector3(0.3f, 0.18f, 0.035f), accent, Vector3.zero);
        }

        private GameObject CreateNodePart(Transform parent, string name, PrimitiveType type,
                                          Vector3 position, Vector3 scale, Color color, Vector3 rotation)
        {
            GameObject part = GameObject.CreatePrimitive(type);
            part.name = name;
            part.transform.SetParent(parent, false);
            part.transform.localPosition = position;
            part.transform.localScale = scale;
            part.transform.localEulerAngles = rotation;
            ApplyMaterial(part, color);
            Collider collider = part.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            return part;
        }

        private static Color NodeColor(string nodeId)
        {
            switch ((nodeId ?? string.Empty).ToLowerInvariant())
            {
                case "scraptown": return Hex(0xe4b35c);
                case "relaystation": return Hex(0x62c8e5);
                case "caravancamp": return Hex(0x91d16f);
                default: return Hex(0xd58a45);
            }
        }

        private void RebuildDynamicWorld()
        {
            if (_root == null || _wasteland == null) return;

            if (_dynamicRoot != null)
            {
                _dynamicRoot.SetActive(false);
                Destroy(_dynamicRoot);
            }
            foreach (Material material in _dynamicMaterials) if (material != null) Destroy(material);
            _dynamicMaterials.Clear();
            foreach (Mesh mesh in _dynamicMeshes) if (mesh != null) Destroy(mesh);
            _dynamicMeshes.Clear();
            _dynamicMaterialCache.Clear();
            _dynamicTargets.Clear();
            _territoryByCell.Clear();
            _factionSummary = string.Empty;
            TerritoryCellCount = 0;
            TerritoryBorderCount = 0;
            InfluenceZoneCount = 0;
            SiteMarkerCount = 0;
            SettlementStatusCount = 0;
            SiteMeshVertexCount = 0;
            SiteMeshSubMeshCount = 0;

            _dynamicRoot = new GameObject("WastelandSimulation");
            _dynamicRoot.transform.SetParent(_root.transform, false);

            BuildFactionTerritories();
            if (TerritoryCellCount == 0) BuildFactionInfluence();

            JArray sites = _wasteland["sites"] as JArray;
            if (sites != null)
            {
                var siteVisuals = new RoaGlobalMapSiteMeshBuilder();
                foreach (JToken token in sites)
                {
                    JObject row = token as JObject;
                    if (row == null) continue;
                    string type = row["type"]?.ToString() ?? string.Empty;
                    string id = row["id"]?.ToString() ?? string.Empty;
                    if (string.IsNullOrEmpty(id)) continue;
                    if (string.Equals(type, "settlement", StringComparison.OrdinalIgnoreCase))
                    {
                        BuildSettlementStatus(row);
                        continue;
                    }

                    DynamicTarget target = TargetFrom(row, "site");
                    target.SiteId = id;
                    target.LocationId = row["locationId"]?.ToString() ?? string.Empty;
                    target.Radius = 15f;
                    target.CanEnter = !string.IsNullOrEmpty(target.LocationId);
                    target.Details = row["description"]?.ToString()
                                  ?? row["note"]?.ToString()
                                  ?? row["workSummary"]?.ToString()
                                  ?? string.Empty;
                    _dynamicTargets.Add(target);

                    Color accent = FactionColor(row["owner"]?.ToString(), new Color(0.72f, 0.63f, 0.36f));
                    siteVisuals.AddSite(row, PointToWorld(target.Point.X, target.Point.Y, 0.09f), accent);
                }
                Mesh siteMesh;
                siteVisuals.Build("WorldSiteModels", _dynamicRoot.transform, CreateDynamicMaterial, out siteMesh);
                if (siteMesh != null)
                {
                    _dynamicMeshes.Add(siteMesh);
                    SiteMeshVertexCount = siteMesh.vertexCount;
                    SiteMeshSubMeshCount = siteMesh.subMeshCount;
                }
                SiteMarkerCount = siteVisuals.MarkerCount;
            }

            JArray parties = _wasteland["parties"] as JArray;
            if (parties != null)
            {
                foreach (JToken token in parties)
                {
                    JObject row = token as JObject;
                    if (row == null || row["destroyed"]?.ToObject<bool>() == true) continue;
                    string id = row["id"]?.ToString() ?? string.Empty;
                    if (string.IsNullOrEmpty(id)) continue;

                    DynamicTarget target = TargetFrom(row, "party");
                    target.PartyId = id;
                    target.Faction = row["faction"]?.ToString() ?? string.Empty;
                    target.Radius = PartyRadius(row);
                    target.CanEnter = PartyCanEncounter(row);
                    target.Forced = WorldPartyHostile(target.Faction);
                    target.Details = row["statusText"]?.ToString() ?? row["kind"]?.ToString() ?? string.Empty;
                    _dynamicTargets.Add(target);

                    GameObject marker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    marker.name = "WorldParty:" + id;
                    marker.transform.SetParent(_dynamicRoot.transform, false);
                    marker.transform.localPosition = PointToWorld(target.Point.X, target.Point.Y, 0.45f);
                    float size = string.Equals(row["kind"]?.ToString(), "caravan", StringComparison.OrdinalIgnoreCase) ? 0.72f : 0.54f;
                    marker.transform.localScale = Vector3.one * size;
                    ApplyDynamicMaterial(marker, FactionColor(row["faction"]?.ToString(), new Color(0.8f, 0.32f, 0.25f)));
                    Destroy(marker.GetComponent<Collider>());
                }
            }

            JArray zones = _wasteland["worldZones"] as JArray;
            if (zones != null)
            {
                foreach (JToken token in zones)
                {
                    JObject row = token as JObject;
                    if (row == null || !string.Equals(row["status"]?.ToString(), "active", StringComparison.OrdinalIgnoreCase)) continue;
                    if (row["details"]?["hidden"]?.ToObject<bool>() == true || row["details"]?["visible"]?.ToObject<bool>() == false) continue;
                    string id = row["id"]?.ToString() ?? string.Empty;
                    if (string.IsNullOrEmpty(id)) continue;

                    DynamicTarget target = TargetFrom(row, "zone");
                    target.WorldZoneId = id;
                    target.PartyId = row["partyId"]?.ToString() ?? string.Empty;
                    target.SiteId = row["siteId"]?.ToString() ?? string.Empty;
                    target.LocationId = row["locationId"]?.ToString() ?? string.Empty;
                    target.Faction = row["faction"]?.ToString()
                        ?? row["details"]?["faction"]?.ToString()
                        ?? string.Empty;
                    target.Radius = Mathf.Clamp(Float(row["radius"], 7f), 2f, 40f);
                    target.CanEnter = !string.IsNullOrEmpty(target.LocationId);
                    target.Forced = row["forced"]?.ToObject<bool>() == true
                        || row["details"]?["forced"]?.ToObject<bool>() == true
                        || WorldPartyHostile(target.Faction);
                    target.Details = row["title"]?.ToString() ?? row["encounterId"]?.ToString() ?? string.Empty;
                    _dynamicTargets.Add(target);

                    DrawWorldRing("WorldZone:" + id, target.Point,
                                  Mathf.Clamp(Float(row["radius"], 7f), 2f, 40f),
                                  new Color(0.95f, 0.3f, 0.2f, 0.95f));
                }
            }

            JArray threats = _wasteland["threatZones"] as JArray;
            if (threats != null)
            {
                int index = 0;
                foreach (JToken token in threats)
                {
                    JObject row = token as JObject;
                    if (row == null) continue;
                    GlobalMapPoint point = ReadPoint(row, "x", "y", null);
                    DrawWorldRing("Threat:" + index++, point,
                                  Mathf.Clamp(Float(row["radius"], 10f), 2f, 80f),
                                  new Color(0.72f, 0.16f, 0.13f, 0.65f));
                }
            }

            BuildTrackedWorldTaskMarker();
            ResolveSelectedDynamic();
        }

        private void BuildTrackedWorldTaskMarker()
        {
            JObject task = _bootstrap?.Interaction?.TrackedWorldTask;
            JObject details = task?["details"] as JObject;
            JToken x = task?["targetX"] ?? task?["x"] ?? details?["x"];
            JToken y = task?["targetY"] ?? task?["y"] ?? details?["y"];
            if (task == null || x == null || y == null || x.Type == JTokenType.Null || y.Type == JTokenType.Null) return;
            var point = new GlobalMapPoint { X = Float(x, 0f), Y = Float(y, 0f) };
            string id = task["id"]?.ToString() ?? "tracked";
            DrawWorldRing("TrackedWorldTask:" + id, point, 9f, new Color(1f, 0.78f, 0.18f, 0.95f), 0.24f, 0.12f);

            GameObject marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            marker.name = "TrackedWorldTaskMarker:" + id;
            marker.transform.SetParent(_dynamicRoot.transform, false);
            marker.transform.localPosition = PointToWorld(point.X, point.Y, 0.32f);
            marker.transform.localScale = new Vector3(0.3f, 0.18f, 0.3f);
            ApplyDynamicMaterial(marker, new Color(1f, 0.78f, 0.18f, 1f));
            Collider markerCollider = marker.GetComponent<Collider>();
            if (markerCollider != null) Destroy(markerCollider);
        }

        private void BuildSettlementStatus(JObject row)
        {
            string id = row?["id"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(id)) return;
            GlobalMapPoint point = ReadPoint(row, "x", "y", null);
            Color accent = FactionColor(row["owner"]?.ToString(), new Color(0.82f, 0.51f, 0.2f));
            bool critical = string.Equals(row["controlState"]?.ToString(), "critical", StringComparison.OrdinalIgnoreCase);
            bool contested = string.Equals(row["controlState"]?.ToString(), "contested", StringComparison.OrdinalIgnoreCase)
                          || string.Equals(row["controlState"]?.ToString(), "threatened", StringComparison.OrdinalIgnoreCase);
            Color ring = critical ? new Color(0.96f, 0.22f, 0.16f, 0.82f)
                       : (contested ? new Color(1f, 0.65f, 0.18f, 0.76f)
                                    : new Color(accent.r, accent.g, accent.b, 0.68f));
            DrawWorldRing("SettlementStatus:" + id, point, 14f, ring, 0.18f, 0.12f);

            Vector3 origin = PointToWorld(point.X, point.Y, 0.09f);
            GameObject pole = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            pole.name = "SettlementFlagPole:" + id;
            pole.transform.SetParent(_dynamicRoot.transform, false);
            pole.transform.localPosition = origin + new Vector3(0.62f, 0.48f, -0.42f);
            pole.transform.localScale = new Vector3(0.035f, 0.45f, 0.035f);
            ApplyDynamicMaterial(pole, Hex(0x20170c));
            Collider poleCollider = pole.GetComponent<Collider>();
            if (poleCollider != null) Destroy(poleCollider);

            GameObject flag = GameObject.CreatePrimitive(PrimitiveType.Cube);
            flag.name = "SettlementFlag:" + id;
            flag.transform.SetParent(_dynamicRoot.transform, false);
            flag.transform.localPosition = origin + new Vector3(0.78f, 0.82f, -0.42f);
            flag.transform.localScale = new Vector3(0.34f, 0.18f, 0.035f);
            ApplyDynamicMaterial(flag, accent);
            Collider flagCollider = flag.GetComponent<Collider>();
            if (flagCollider != null) Destroy(flagCollider);
            SettlementStatusCount++;
        }

        private DynamicTarget TargetFrom(JObject row, string kind)
        {
            return new DynamicTarget
            {
                Kind = kind,
                Id = row["id"]?.ToString() ?? string.Empty,
                Name = row["name"]?.ToString() ?? row["title"]?.ToString() ?? row["id"]?.ToString() ?? kind,
                Point = ReadPoint(row, "x", "y", null),
                Data = row
            };
        }

        private void BuildFactionTerritories()
        {
            JArray rows = _wasteland?["territories"] as JArray;
            if (rows == null || _map == null || _map.Grid == null) return;

            var fills = new Dictionary<string, MeshBucket>();
            var glows = new Dictionary<string, MeshBucket>();
            var cores = new Dictionary<string, MeshBucket>();
            float cellPoints = _map.Grid.CellPoints;
            float cellWorld = cellPoints * MapWorldScale;
            float coreThickness = Mathf.Max(0.075f, cellWorld * 0.045f);
            float glowThickness = Mathf.Max(0.22f, cellWorld * 0.14f);

            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                int cx = Mathf.FloorToInt(Float(row["cx"], -1f));
                int cy = Mathf.FloorToInt(Float(row["cy"], -1f));
                if (cx < 0 || cy < 0 || cx >= _map.Grid.Cols || cy >= _map.Grid.Rows || IsWaterCell(cx, cy)) continue;
                string owner = row["owner"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(owner) || string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase)) continue;
                _territoryByCell[cx + ":" + cy] = row;

                Color baseColor = TerritoryColor(row, owner);
                float strength = Mathf.Clamp(Float(row["strength"], 0.3f), 0.1f, 1f);
                float alpha = Mathf.Round((0.055f + strength * 0.105f) * 40f) / 40f;
                Color fillColor = new Color(baseColor.r, baseColor.g, baseColor.b, alpha);
                MeshBucket fill = Bucket(fills, ColorKey(fillColor), fillColor);

                float x0 = cx * cellPoints;
                float y0 = cy * cellPoints;
                float x1 = x0 + cellPoints;
                float y1 = y0 + cellPoints;
                AddPointQuad(fill, x0 + cellPoints * 0.01f, y0 + cellPoints * 0.01f,
                             x1 - cellPoints * 0.01f, y1 - cellPoints * 0.01f, 0.045f);
                TerritoryCellCount++;

                string borders = row["borders"]?.ToString()?.ToUpperInvariant() ?? string.Empty;
                Color glowColor = new Color(baseColor.r, baseColor.g, baseColor.b, 0.18f);
                Color coreColor = new Color(baseColor.r, baseColor.g, baseColor.b, 0.72f);
                MeshBucket glow = Bucket(glows, ColorKey(glowColor), glowColor);
                MeshBucket core = Bucket(cores, ColorKey(coreColor), coreColor);
                foreach (char side in borders)
                {
                    if (side != 'N' && side != 'E' && side != 'S' && side != 'W') continue;
                    if (TerritoryBorderTouchesWater(cx, cy, side)) continue;
                    AddTerritoryBorder(glow, cx, cy, side, glowThickness, 0.068f);
                    AddTerritoryBorder(core, cx, cy, side, coreThickness, 0.078f);
                    TerritoryBorderCount++;
                }
            }

            BuildBucketedMesh("FactionTerritoryFill", fills);
            BuildBucketedMesh("FactionTerritoryGlow", glows);
            BuildBucketedMesh("FactionTerritoryBorders", cores);
            _factionSummary = ComposeFactionSummary();
        }

        private void BuildFactionInfluence()
        {
            JArray sites = _wasteland?["sites"] as JArray;
            if (sites == null) return;
            var fills = new Dictionary<string, MeshBucket>();
            int limit = 32;
            foreach (JToken token in sites)
            {
                if (InfluenceZoneCount >= limit) break;
                JObject site = token as JObject;
                if (site == null || site["owner"] == null) continue;
                string owner = site["owner"]?.ToString() ?? "neutral";
                Color color = TerritoryColor(site, owner);
                bool critical = string.Equals(site["controlState"]?.ToString(), "critical", StringComparison.OrdinalIgnoreCase);
                bool contested = string.Equals(site["controlState"]?.ToString(), "contested", StringComparison.OrdinalIgnoreCase)
                              || string.Equals(site["controlState"]?.ToString(), "threatened", StringComparison.OrdinalIgnoreCase);
                float alpha = string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase) ? 0.095f : (critical ? 0.18f : (contested ? 0.16f : 0.12f));
                Color fillColor = new Color(color.r, color.g, color.b, alpha);
                GlobalMapPoint point = ReadPoint(site, "x", "y", null);
                float radius = FactionInfluenceRadius(site);
                AddPointCircle(Bucket(fills, ColorKey(fillColor), fillColor), point, radius, 0.035f, 48);
                DrawWorldRing("FactionInfluence:" + (site["id"]?.ToString() ?? InfluenceZoneCount.ToString()),
                              point, radius, new Color(color.r, color.g, color.b, critical ? 0.48f : 0.28f), 0.14f, 0.075f);
                InfluenceZoneCount++;
            }
            BuildBucketedMesh("FactionInfluenceFill", fills);
            _factionSummary = ComposeFactionSummary();
        }

        private void AddTerritoryBorder(MeshBucket bucket, int cx, int cy, char side, float thickness, float height)
        {
            float cp = _map.Grid.CellPoints;
            float x0 = (cx * cp - MapWidthPoints * 0.5f) * MapWorldScale;
            float x1 = ((cx + 1) * cp - MapWidthPoints * 0.5f) * MapWorldScale;
            float z0 = (MapHeightPoints * 0.5f - cy * cp) * MapWorldScale;
            float z1 = (MapHeightPoints * 0.5f - (cy + 1) * cp) * MapWorldScale;
            if (side == 'N') AddWorldQuad(bucket, x0, z0 - thickness * 0.5f, x1, z0 + thickness * 0.5f, height);
            else if (side == 'S') AddWorldQuad(bucket, x0, z1 - thickness * 0.5f, x1, z1 + thickness * 0.5f, height);
            else if (side == 'W') AddWorldQuad(bucket, x0 - thickness * 0.5f, z1, x0 + thickness * 0.5f, z0, height);
            else if (side == 'E') AddWorldQuad(bucket, x1 - thickness * 0.5f, z1, x1 + thickness * 0.5f, z0, height);
        }

        private void AddPointQuad(MeshBucket bucket, float x0, float y0, float x1, float y1, float height)
        {
            Vector3 a = PointToWorld(x0, y0, height);
            Vector3 b = PointToWorld(x1, y0, height);
            Vector3 c = PointToWorld(x0, y1, height);
            Vector3 d = PointToWorld(x1, y1, height);
            AddQuad(bucket, a, b, c, d);
        }

        private static void AddWorldQuad(MeshBucket bucket, float x0, float z0, float x1, float z1, float height)
        {
            AddQuad(bucket, new Vector3(x0, height, z0), new Vector3(x1, height, z0),
                    new Vector3(x0, height, z1), new Vector3(x1, height, z1));
        }

        private void AddPointCircle(MeshBucket bucket, GlobalMapPoint point, float radiusPoints, float height, int segments)
        {
            int start = bucket.Vertices.Count;
            bucket.Vertices.Add(PointToWorld(point.X, point.Y, height));
            for (int i = 0; i <= segments; i++)
            {
                float angle = i / (float)segments * Mathf.PI * 2f;
                bucket.Vertices.Add(PointToWorld(point.X + Mathf.Cos(angle) * radiusPoints,
                                                point.Y + Mathf.Sin(angle) * radiusPoints, height));
            }
            for (int i = 0; i < segments; i++)
            {
                bucket.Triangles.Add(start);
                bucket.Triangles.Add(start + i + 2);
                bucket.Triangles.Add(start + i + 1);
            }
        }

        private static void AddQuad(MeshBucket bucket, Vector3 a, Vector3 b, Vector3 c, Vector3 d)
        {
            int start = bucket.Vertices.Count;
            bucket.Vertices.Add(a);
            bucket.Vertices.Add(b);
            bucket.Vertices.Add(c);
            bucket.Vertices.Add(d);
            bucket.Triangles.Add(start);
            bucket.Triangles.Add(start + 2);
            bucket.Triangles.Add(start + 1);
            bucket.Triangles.Add(start + 2);
            bucket.Triangles.Add(start + 3);
            bucket.Triangles.Add(start + 1);
        }

        private GameObject BuildBucketedMesh(string name, Dictionary<string, MeshBucket> buckets)
        {
            if (buckets == null || buckets.Count == 0) return null;
            var go = new GameObject(name);
            go.transform.SetParent(_dynamicRoot.transform, false);
            var filter = go.AddComponent<MeshFilter>();
            var renderer = go.AddComponent<MeshRenderer>();
            var mesh = new Mesh { name = name };
            var vertices = new List<Vector3>();
            var materials = new List<Material>();
            var triangles = new List<int[]>();
            foreach (MeshBucket bucket in buckets.Values)
            {
                int offset = vertices.Count;
                vertices.AddRange(bucket.Vertices);
                int[] shifted = new int[bucket.Triangles.Count];
                for (int i = 0; i < shifted.Length; i++) shifted[i] = bucket.Triangles[i] + offset;
                triangles.Add(shifted);
                materials.Add(CreateDynamicMaterial(bucket.Color));
            }
            if (vertices.Count > 65535) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.SetVertices(vertices);
            mesh.subMeshCount = triangles.Count;
            for (int i = 0; i < triangles.Count; i++) mesh.SetTriangles(triangles[i], i, false);
            mesh.RecalculateBounds();
            filter.sharedMesh = mesh;
            renderer.sharedMaterials = materials.ToArray();
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            _dynamicMeshes.Add(mesh);
            return go;
        }

        private static MeshBucket Bucket(Dictionary<string, MeshBucket> buckets, string key, Color color)
        {
            MeshBucket bucket;
            if (buckets.TryGetValue(key, out bucket)) return bucket;
            bucket = new MeshBucket { Color = color };
            buckets[key] = bucket;
            return bucket;
        }

        private static string ColorKey(Color color)
        {
            Color32 value = color;
            return value.r + ":" + value.g + ":" + value.b + ":" + value.a;
        }

        private Color TerritoryColor(JObject row, string owner)
        {
            string hex = row?["color"]?.ToString();
            Color color;
            if (!string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out color)) return color;
            return FactionColor(owner, new Color(0.62f, 0.84f, 1f));
        }

        private bool IsWaterCell(int cx, int cy)
        {
            if (_map == null || cx < 0 || cy < 0 || cx >= _map.Grid.Cols || cy >= _map.Grid.Rows) return false;
            GlobalMapCell cell;
            return _map.Cells.TryGetValue(cx + ":" + cy, out cell) && IsWater(cell);
        }

        private bool TerritoryBorderTouchesWater(int cx, int cy, char side)
        {
            if (side == 'N') return IsWaterCell(cx, cy - 1);
            if (side == 'E') return IsWaterCell(cx + 1, cy);
            if (side == 'S') return IsWaterCell(cx, cy + 1);
            return IsWaterCell(cx - 1, cy);
        }

        private static bool IsWater(GlobalMapCell cell)
        {
            string texture = cell != null ? (cell.Texture ?? string.Empty).ToLowerInvariant() : string.Empty;
            return texture == "water" || texture == "ocean" || texture == "sea" || texture == "lake";
        }

        private static float FactionInfluenceRadius(JObject site)
        {
            string type = site?["type"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            float security = Mathf.Clamp(Float(site?["security"], 0f), 0f, 100f);
            float prosperity = Mathf.Clamp(Float(site?["prosperity"], 0f), 0f, 100f);
            float pressure = Mathf.Min(30f, Mathf.Abs(Float(site?["controlPressure"], 0f)));
            float radius = type == "settlement" ? 48f : (type == "outpost" ? 38f : (type == "production" ? 35f : (type == "resource" ? 31f : (type == "pointofinterest" ? 27f : 28f))));
            radius += security * 0.08f + prosperity * 0.05f - pressure * 0.22f;
            if (string.Equals(site?["owner"]?.ToString(), "neutral", StringComparison.OrdinalIgnoreCase)) radius *= 0.72f;
            if (string.Equals(site?["controlState"]?.ToString(), "secured", StringComparison.OrdinalIgnoreCase)) radius *= 1.12f;
            if (string.Equals(site?["controlState"]?.ToString(), "critical", StringComparison.OrdinalIgnoreCase)) radius *= 0.86f;
            return Mathf.Clamp(radius, 18f, 58f);
        }

        private void DrawWorldRing(string name, GlobalMapPoint point, float radiusPoints, Color color,
                                   float width = 0.13f, float height = 0.16f)
        {
            const int segments = 40;
            var points = new List<GlobalMapPoint>(segments + 1);
            for (int i = 0; i <= segments; i++)
            {
                float angle = i / (float)segments * Mathf.PI * 2f;
                points.Add(new GlobalMapPoint
                {
                    X = point.X + Mathf.Cos(angle) * radiusPoints,
                    Y = point.Y + Mathf.Sin(angle) * radiusPoints
                });
            }
            LineRenderer line = CreateDynamicLine(name, color, width, height);
            SetLinePoints(line, points);
        }

        private LineRenderer CreateDynamicLine(string name, Color color, float width, float height)
        {
            var go = new GameObject(name);
            go.transform.SetParent(_dynamicRoot.transform, false);
            go.transform.localPosition = Vector3.up * height;
            var line = go.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.startWidth = width;
            line.endWidth = width;
            line.numCapVertices = 2;
            line.numCornerVertices = 2;
            line.sharedMaterial = CreateDynamicMaterial(color);
            return line;
        }

        private LineRenderer CreateLine(string name, Color color, float width, float height)
        {
            var go = new GameObject(name);
            go.transform.SetParent(_root.transform, false);
            go.transform.localPosition = Vector3.up * height;
            var line = go.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.loop = false;
            line.startWidth = width;
            line.endWidth = width;
            line.numCapVertices = 2;
            line.numCornerVertices = 2;
            line.sharedMaterial = CreateMaterial(color);
            return line;
        }

        private void SetLinePoints(LineRenderer line, IList<GlobalMapPoint> points)
        {
            if (line == null) return;
            int count = points != null ? points.Count : 0;
            line.positionCount = count;
            for (int i = 0; i < count; i++) line.SetPosition(i, PointToWorld(points[i].X, points[i].Y, 0f));
        }

        private void ApplyState(JObject state, bool preserveIdleSelection = false)
        {
            JObject authoritativeTravel = state?["travel"] as JObject;
            // A gameplay self snapshot may already be queued when the travel-start
            // acknowledgement reaches the main thread. Do not let that older idle
            // snapshot erase a route that the server has just accepted. A current
            // descriptor normally arrives immediately afterwards and still wins.
            bool preserveFreshTravel = preserveIdleSelection
                                    && _travelActive
                                    && authoritativeTravel == null
                                    && Time.realtimeSinceStartup < _travelDescriptorGraceUntil;
            bool keepSelection = preserveIdleSelection
                              && authoritativeTravel == null
                              && (!_travelActive || preserveFreshTravel);
            _state = state != null ? (JObject)state.DeepClone() : new JObject();
            if (_pendingEntry)
            {
                // Ждём «Войти»: сервер ещё хранит завершённый маршрут и стартовую точку —
                // не откатываем игрока и выбор (web в этот момент живёт на pendingWorldDrop).
                RefreshMarkers();
                return;
            }
            _playerPoint = ReadPoint(_state, "playerX", "playerY", null);
            if (!keepSelection)
            {
                _selectedPoint = ReadPoint(_state, "selectedX", "selectedY", _playerPoint);
                _selectedNode = NearestNode(_selectedPoint, NodeSnapRadiusPoints);
                _selectedDynamic = null;
            }

            if (authoritativeTravel != null) ApplyTravel(authoritativeTravel);
            else if (!preserveFreshTravel) ClearTravel();

            RefreshMarkers();
        }

        private void ApplyTravel(JObject travel)
        {
            _travelLeaderId = travel["leaderId"]?.ToString() ?? Socket?.Session?.Id ?? string.Empty;
            GlobalMapPoint from = ReadObjectPoint(travel["fromPoint"], _playerPoint);
            GlobalMapPoint to = ReadObjectPoint(travel["toPoint"] ?? travel["targetPoint"], from);
            float rawDuration = Float(travel["duration"], Float(travel["durationMs"], 0f) / 1000f);
            if (rawDuration <= 0.001f && Distance(from, to) <= 0.35f)
            {
                _playerPoint = CopyPoint(from);
                _selectedPoint = CopyPoint(from);
                _selectedNode = NearestNode(from, NodeSnapRadiusPoints);
                _selectedDynamic = null;
                ClearTravel();
                return;
            }
            _route = ReadRoute(travel["routePoints"] as JArray);
            if (_route.Count < 2)
            {
                _route.Clear();
                _route.Add(from);
                _route.Add(to);
            }

            _selectedPoint = CopyPoint(to);
            _selectedNode = NearestNode(to, NodeSnapRadiusPoints);
            string targetSiteId = travel["targetSiteId"]?.ToString()
                               ?? travel["targetWorldSiteId"]?.ToString()
                               ?? string.Empty;
            string targetPartyId = travel["partyId"]?.ToString() ?? string.Empty;
            string targetWorldZoneId = travel["worldZoneId"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(targetSiteId) || !string.IsNullOrEmpty(targetPartyId) || !string.IsNullOrEmpty(targetWorldZoneId))
            {
                _selectedDynamic = new DynamicTarget
                {
                    Kind = !string.IsNullOrEmpty(targetWorldZoneId) ? "zone" : (!string.IsNullOrEmpty(targetPartyId) ? "party" : "site"),
                    Id = !string.IsNullOrEmpty(targetWorldZoneId) ? targetWorldZoneId : (!string.IsNullOrEmpty(targetPartyId) ? targetPartyId : targetSiteId),
                    Name = !string.IsNullOrEmpty(targetSiteId) ? targetSiteId : (!string.IsNullOrEmpty(targetPartyId) ? targetPartyId : targetWorldZoneId),
                    SiteId = targetSiteId,
                    PartyId = targetPartyId,
                    WorldZoneId = targetWorldZoneId,
                    LocationId = travel["targetLocationId"]?.ToString() ?? string.Empty,
                    Point = CopyPoint(to)
                };
            }
            _travelDuration = Mathf.Max(0.1f, rawDuration);
            float progress = Mathf.Clamp01(Float(travel["progress"], Float(travel["elapsedMs"], 0f) / (_travelDuration * 1000f)));
            _travelStartedRealtime = Time.realtimeSinceStartup - progress * _travelDuration;
            _travelActive = true;
            _travelDescriptorGraceUntil = 0f;
            _arrivalPending = false;
            _arrivalRetryAt = 0f;
            _contactArrival = false;
            _pendingContact = null;
            _contactDecisionPending = false;
            _ignoredRouteContacts.Clear();
            _playerPoint = PointAtRouteProgress(_route, progress);
            SetLinePoints(_routeLine, _route);
        }

        private void ClearTravel()
        {
            _route.Clear();
            _travelActive = false;
            _travelDescriptorGraceUntil = 0f;
            _arrivalPending = false;
            _contactArrival = false;
            _pendingContact = null;
            _contactDecisionPending = false;
            _travelLeaderId = string.Empty;
            _ignoredRouteContacts.Clear();
            if (_routeLine != null) _routeLine.positionCount = 0;
        }

        private void Update()
        {
            if (!IsActive) return;

            UpdateCameraPan();
            PulseActivityHighlights();

            if (!_travelActive) return;
            if (_pendingContact != null) return;

            GlobalMapPoint previousPoint = CopyPoint(_playerPoint);
            float progress = Mathf.Clamp01((Time.realtimeSinceStartup - _travelStartedRealtime) / _travelDuration);
            _playerPoint = PointAtRouteProgress(_route, progress);
            RefreshMarkers();

            if (!_arrivalPending && Time.realtimeSinceStartup >= _arrivalRetryAt
                && MaybeTriggerTravelContact(previousPoint, _playerPoint)) return;
            if (progress >= 1f && !_arrivalPending && Time.realtimeSinceStartup >= _arrivalRetryAt)
            {
                if (TryOpenSelectedDestinationContact()) return;
                bool toLocation = _selectedNode != null
                    || (_selectedDynamic != null && !string.IsNullOrEmpty(_selectedDynamic.LocationId));
                if (CanvasDriven && toLocation && !_pendingEntry)
                {
                    // Как pendingWorldDrop web: остаёмся на карте, вход — кнопкой «Войти».
                    _pendingEntry = true;
                    _playerPoint = CopyPoint(_selectedPoint);
                    ClearTravel();
                    RefreshMarkers();
                    StatusText = "Вы на месте. Нажмите «Войти», чтобы перейти в локацию.";
                    return;
                }
                RequestArrival();
            }
        }

        private void UpdateCameraPan()
        {
            if (!InputEnabled || CameraRig == null || _cameraAnchor == null)
            {
                _cameraPanning = false;
                return;
            }

            bool pressed = Input.GetMouseButton(1) || Input.GetMouseButton(2);
            if (!_cameraPanning)
            {
                bool began = Input.GetMouseButtonDown(1) || Input.GetMouseButtonDown(2);
                if (!began || Input.mousePosition.x <= 380f) return;
                _cameraPanning = true;
                _lastPanPointer = Input.mousePosition;
                return;
            }
            if (!pressed)
            {
                _cameraPanning = false;
                return;
            }

            Vector2 pointer = Input.mousePosition;
            Vector2 delta = pointer - _lastPanPointer;
            _lastPanPointer = pointer;
            if (delta.sqrMagnitude < 0.01f) return;

            Vector3 movement = CameraPanMovement(delta, CameraRig.Distance, Screen.height,
                CameraRig.PlanarRight(), CameraRig.PlanarForward());
            _cameraAnchor.transform.position = ClampCameraPan(
                _cameraAnchor.transform.position + movement,
                MapWidthPoints * MapWorldScale, MapHeightPoints * MapWorldScale);
        }

        public static Vector3 CameraPanMovement(Vector2 pointerDelta, float distance,
                                                float screenHeight, Vector3 right, Vector3 forward)
        {
            float scale = distance / Mathf.Max(240f, screenHeight) * 1.1f;
            return -right.normalized * (pointerDelta.x * scale)
                   + forward.normalized * (pointerDelta.y * scale);
        }

        public static Vector3 ClampCameraPan(Vector3 position, float width, float depth)
        {
            float xLimit = Mathf.Max(0f, width) * 0.5f;
            float zLimit = Mathf.Max(0f, depth) * 0.5f;
            position.x = Mathf.Clamp(position.x, -xLimit, xLimit);
            position.z = Mathf.Clamp(position.z, -zLimit, zLimit);
            return position;
        }

        private bool MaybeTriggerTravelContact(GlobalMapPoint previousPoint, GlobalMapPoint nextPoint)
        {
            if (!IsLocalTravelLeader()) return false;
            DynamicTarget best = null;
            float bestT = float.MaxValue;

            foreach (DynamicTarget target in _dynamicTargets)
            {
                if (target == null || !target.CanEnter || target.Point == null) continue;
                if (_ignoredRouteContacts.Contains(target.Kind + ":" + target.Id)) continue;
                float touchRadius = Mathf.Max(2f, target.Radius) + 2.5f;
                if (Distance(previousPoint, target.Point) <= touchRadius + 0.25f) continue;
                float t;
                float distance = PointSegmentDistance(target.Point, previousPoint, nextPoint, out t);
                if (distance > touchRadius || t < 0f || t > 1f || t >= bestT) continue;
                best = target;
                bestT = t;
            }

            foreach (GlobalMapNode node in _map.Nodes)
            {
                if (node == null || string.IsNullOrEmpty(node.EffectiveLocationId)) continue;
                if (_ignoredRouteContacts.Contains("settlement:" + node.Id)) continue;
                var center = new GlobalMapPoint { X = node.X, Y = node.Y };
                const float touchRadius = 17.5f;
                if (Distance(previousPoint, center) <= touchRadius + 0.25f) continue;
                float t;
                float distance = PointSegmentDistance(center, previousPoint, nextPoint, out t);
                if (distance > touchRadius || t < 0f || t > 1f || t >= bestT) continue;
                best = new DynamicTarget
                {
                    Kind = "settlement",
                    Id = node.Id,
                    Name = node.EffectiveLocationId,
                    LocationId = node.EffectiveLocationId,
                    Point = center,
                    Radius = 15f,
                    CanEnter = true
                };
                bestT = t;
            }

            if (best == null) return false;

            _savedDestinationDynamic = _selectedDynamic;
            _savedDestinationNode = _selectedNode;
            _savedDestinationPoint = CopyPoint(_selectedPoint);
            _ignoredRouteContacts.Add(best.Kind + ":" + best.Id);

            if ((best.Kind == "party" || best.Kind == "zone") && !best.Forced)
            {
                return OpenPendingTravelContact(best);
            }

            _contactArrival = true;
            _selectedDynamic = best;
            _selectedNode = null;
            _selectedPoint = CopyPoint(best.Point);
            if (CanvasDriven && !string.IsNullOrEmpty(best.LocationId))
            {
                // Как pendingWorldDrop web: прибыли к точке с локацией — ждём «Войти».
                _pendingEntry = true;
                _playerPoint = CopyPoint(_selectedPoint);
                ClearTravel();
                RefreshMarkers();
                StatusText = "Вы на месте: " + best.Name + ". Нажмите «Войти», чтобы перейти в локацию.";
                return true;
            }
            StatusText = "Маршрут встретил: " + best.Name + ". Сервер подтверждает вход...";
            if (best.Kind == "party" || best.Kind == "zone")
            {
                Socket.Emit("globalTravelEncounterDecision", new
                {
                    decision = "enter",
                    encounterId = best.Id,
                    title = best.Name
                });
            }
            RequestArrival();
            return true;
        }

        private bool TryOpenSelectedDestinationContact()
        {
            DynamicTarget contact = _selectedDynamic;
            if (contact == null || contact.Forced || !contact.CanEnter) return false;
            if (contact.Kind != "party" && contact.Kind != "zone") return false;
            if (_ignoredRouteContacts.Contains(contact.Kind + ":" + contact.Id)) return false;

            _savedDestinationDynamic = contact;
            _savedDestinationNode = _selectedNode;
            _savedDestinationPoint = CopyPoint(_selectedPoint);
            _ignoredRouteContacts.Add(contact.Kind + ":" + contact.Id);
            return OpenPendingTravelContact(contact);
        }

        private bool OpenPendingTravelContact(DynamicTarget contact)
        {
            if (contact == null || Socket == null || !IsLocalTravelLeader()) return false;
            _pendingContact = contact;
            StatusText = "На маршруте: " + contact.Name + ". Войти или обойти?";
            Socket.Emit("globalTravelEncounterDecision", new
            {
                pending = true,
                encounterId = contact.Id,
                title = contact.Name
            });
            return true;
        }

        private void ResolveTravelContact(bool enter)
        {
            if (_pendingContact == null || _contactDecisionPending || Socket == null) return;
            DynamicTarget contact = _pendingContact;
            bool destinationContact = _savedDestinationDynamic != null
                && _savedDestinationDynamic.Kind == contact.Kind
                && _savedDestinationDynamic.Id == contact.Id;
            _contactDecisionPending = true;
            StatusText = enter ? "Сервер подтверждает вход…" : "Сервер подтверждает обход…";
            Socket.EmitWithAck("globalTravelEncounterDecision", new
            {
                decision = enter ? "enter" : "skip",
                encounterId = contact.Id,
                title = contact.Name
            }, ack =>
            {
                _contactDecisionPending = false;
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Сервер не принял решение по встрече.");
                    return;
                }

                if (!enter)
                {
                    if (destinationContact)
                    {
                        StatusText = "Останавливаемся перед " + contact.Name + "...";
                        _contactDecisionPending = true;
                        Socket.EmitWithAck("globalTravelCancel", new { }, cancelAck =>
                        {
                            _contactDecisionPending = false;
                            if (!AckOk(cancelAck))
                            {
                                StatusText = AckError(cancelAck, "Сервер не подтвердил обход встречи.");
                                return;
                            }
                            _playerPoint = ReadObjectPoint(cancelAck["worldPoint"], _playerPoint);
                            _selectedPoint = CopyPoint(_playerPoint);
                            _selectedDynamic = null;
                            _selectedNode = NearestNode(_playerPoint, NodeSnapRadiusPoints);
                            ClearTravel();
                            RefreshMarkers();
                            StatusText = "Вы обошли " + contact.Name + " и остановились на маршруте.";
                        });
                        return;
                    }

                    _pendingContact = null;
                    _selectedDynamic = _savedDestinationDynamic;
                    _selectedNode = _savedDestinationNode;
                    _selectedPoint = CopyPoint(_savedDestinationPoint);
                    RefreshMarkers();
                    StatusText = "Группа обходит: " + contact.Name + ". Маршрут продолжается.";
                    return;
                }

                _pendingContact = null;
                _contactArrival = true;
                _selectedDynamic = contact;
                _selectedNode = null;
                _selectedPoint = CopyPoint(contact.Point);
                RefreshMarkers();
                RequestArrival();
            });
        }

        private void SelectFromCursor()
        {
            Camera camera = Camera.main;
            if (camera == null || _terrainCollider == null) return;

            Ray ray = camera.ScreenPointToRay(Input.mousePosition);
            RaycastHit hit;
            if (!_terrainCollider.Raycast(ray, out hit, 1000f)) return;

            _selectedPoint = WorldToPoint(hit.point);
            _selectedDynamic = NearestDynamicTarget(_selectedPoint, DynamicSnapRadiusPoints);
            _selectedNode = _selectedDynamic == null ? NearestNode(_selectedPoint, NodeSnapRadiusPoints) : null;
            if (_selectedDynamic != null)
                _selectedPoint = CopyPoint(_selectedDynamic.Point);
            else if (_selectedNode != null)
                _selectedPoint = new GlobalMapPoint { X = _selectedNode.X, Y = _selectedNode.Y };

            StatusText = _selectedDynamic != null
                ? "Выбрано: " + _selectedDynamic.Name
                : (_selectedNode != null ? "Выбрано: " + _selectedNode.EffectiveLocationId : "Выбрана точка пустоши.");
            RefreshMarkers();
        }

        public void RequestEnterFromLocation()
        {
            if (Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined)
            {
                StatusText = "Нет соединения с сервером.";
                return;
            }

            StatusText = "Сервер проверяет выход с границы локации...";
            Socket.EmitWithAck("globalTravelEnterWorld", new { }, ack =>
            {
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Не удалось выйти на глобальную карту.");
                    return;
                }

                Socket.ApplyGlobalMapTransitionAck(ack);
                JObject point = ack["worldPoint"] as JObject;
                JObject state = StateFromWorldPoint(point, ack["fromLocationId"]?.ToString());
                _bootstrap?.EnterGlobalMapFromServer(state);
            });
        }

        /// <summary>
        /// Построить обычный production-маршрут к видимому отряду мира. Курсорная
        /// кнопка использует те же внутренние выбор и StartTravel; этот вход нужен
        /// также мобильному управлению и сквозным проверкам собранного клиента.
        /// </summary>
        public bool RequestTravelToWorldParty(string partyId, Action<JObject> completed = null)
        {
            if (!IsActive || _travelActive || _pendingContact != null || string.IsNullOrEmpty(partyId)) return false;
            if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                StatusText = "Вы движетесь с отрядом. Сначала покиньте группу.";
                return false;
            }

            DynamicTarget target = _dynamicTargets.Find(row => row != null && row.PartyId == partyId && row.CanEnter);
            if (target == null) return false;
            _selectedDynamic = target;
            _selectedNode = null;
            _selectedPoint = CopyPoint(target.Point);
            RefreshMarkers();
            StartTravel(completed);
            return true;
        }

        /// <summary>Draw up to three pulsing rings for the compact live-event rail.</summary>
        public void SetActivityHighlights(IList<JObject> tasks)
        {
            var ids = new List<string>();
            if (tasks != null)
            {
                for (int i = 0; i < tasks.Count && i < 3; i++)
                    ids.Add(tasks[i]?["id"]?.ToString() ?? string.Empty);
            }
            string key = string.Join("|", ids);
            if (key == _activityHighlightKey && (_activityHighlightRings.Count > 0 || ids.Count == 0)) return;
            ClearActivityHighlights();
            _activityHighlightKey = key;
            if (_root == null || tasks == null) return;

            for (int i = 0; i < tasks.Count && i < 3; i++)
            {
                JObject task = tasks[i];
                GlobalMapPoint point;
                if (!TryActivityPoint(task, out point)) continue;
                var ringPoints = new List<GlobalMapPoint>(33);
                float radius = 10f + i * 1.8f;
                for (int segment = 0; segment <= 32; segment++)
                {
                    float angle = segment / 32f * Mathf.PI * 2f;
                    ringPoints.Add(new GlobalMapPoint
                    {
                        X = point.X + Mathf.Cos(angle) * radius,
                        Y = point.Y + Mathf.Sin(angle) * radius
                    });
                }
                LineRenderer ring = CreateLine("LiveActivity:" + ids[i], ActivityColor(task), 0.14f, 0.34f + i * 0.02f);
                ring.loop = true;
                SetLinePoints(ring, ringPoints);
                _activityHighlightRings.Add(ring);
            }
        }

        private bool TryActivityPoint(JObject task, out GlobalMapPoint point)
        {
            point = null;
            JToken x = task?["targetX"] ?? task?["details"]?["x"];
            JToken y = task?["targetY"] ?? task?["details"]?["y"];
            if (x != null && y != null && x.Type != JTokenType.Null && y.Type != JTokenType.Null)
            {
                point = new GlobalMapPoint { X = Float(x, 0f), Y = Float(y, 0f) };
                return true;
            }

            string siteId = task?["siteId"]?.ToString() ?? string.Empty;
            DynamicTarget target = _dynamicTargets.Find(row => row != null
                && (row.SiteId == siteId || (row.Kind == "site" && row.Id == siteId)));
            if (target != null)
            {
                point = CopyPoint(target.Point);
                return true;
            }

            foreach (JToken token in _wasteland?["sites"] as JArray ?? new JArray())
            {
                JObject site = token as JObject;
                if (site?["id"]?.ToString() != siteId) continue;
                point = new GlobalMapPoint { X = Float(site["x"], 0f), Y = Float(site["y"], 0f) };
                return true;
            }
            if (_map?.Nodes != null)
            {
                foreach (GlobalMapNode node in _map.Nodes)
                {
                    if (node == null || (node.Id != siteId && node.EffectiveLocationId != siteId)) continue;
                    point = new GlobalMapPoint { X = node.X, Y = node.Y };
                    return true;
                }
            }
            return false;
        }

        private static Color ActivityColor(JObject task)
        {
            switch (task?["type"]?.ToString() ?? string.Empty)
            {
                case "distress_signal": return new Color(1f, 0.28f, 0.16f, 1f);
                case "outpost_defense": return new Color(1f, 0.55f, 0.18f, 1f);
                case "recon_expedition": return new Color(0.35f, 0.86f, 0.92f, 1f);
                case "resource_expedition": return new Color(0.48f, 0.88f, 0.34f, 1f);
                default: return new Color(0.96f, 0.76f, 0.25f, 1f);
            }
        }

        private void PulseActivityHighlights()
        {
            float pulse = 0.5f + 0.5f * Mathf.Sin(Time.unscaledTime * 4.2f);
            float width = Mathf.Lerp(0.08f, 0.22f, pulse);
            for (int i = 0; i < _activityHighlightRings.Count; i++)
            {
                LineRenderer ring = _activityHighlightRings[i];
                if (ring == null) continue;
                ring.startWidth = width;
                ring.endWidth = width;
            }
        }

        private void ClearActivityHighlights()
        {
            for (int i = 0; i < _activityHighlightRings.Count; i++)
                if (_activityHighlightRings[i] != null) Destroy(_activityHighlightRings[i].gameObject);
            _activityHighlightRings.Clear();
            _activityHighlightKey = string.Empty;
        }


        /// <summary>Select an activity site and immediately request its server route.</summary>
        public bool RequestTravelToWorldSite(string siteId, Action<JObject> completed = null)
        {
            if (!IsActive || _travelActive || _pendingContact != null || string.IsNullOrEmpty(siteId)) return false;
            if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                StatusText = "Вы движетесь с отрядом. Сначала покиньте группу.";
                return false;
            }

            DynamicTarget target = _dynamicTargets.Find(row => row != null
                && (row.SiteId == siteId || (row.Kind == "site" && row.Id == siteId))
                && row.CanEnter);
            if (target != null)
            {
                _selectedDynamic = target;
                _selectedNode = null;
                _selectedPoint = CopyPoint(target.Point);
            }
            else
            {
                JObject site = null;
                foreach (JToken token in _wasteland?["sites"] as JArray ?? new JArray())
                {
                    JObject row = token as JObject;
                    if (row?["id"]?.ToString() == siteId) { site = row; break; }
                }
                string locationId = site?["locationId"]?.ToString() ?? siteId;
                GlobalMapNode node = null;
                if (_map != null && _map.Nodes != null)
                foreach (GlobalMapNode row in _map.Nodes)
                {
                    if (row.Id == siteId || row.Id == locationId || row.EffectiveLocationId == locationId)
                    {
                        node = row;
                        break;
                    }
                }
                if (node == null)
                {
                    StatusText = "Точка активности пока не нанесена на карту.";
                    return false;
                }
                _selectedDynamic = null;
                _selectedNode = node;
                _selectedPoint = new GlobalMapPoint { X = node.X, Y = node.Y };
            }

            RefreshMarkers();
            if (Distance(_playerPoint, _selectedPoint) <= 0.35f)
            {
                StatusText = "Вы прибыли к цели. Можно войти в локацию.";
                completed?.Invoke(new JObject { ["ok"] = true, ["alreadyThere"] = true });
                return true;
            }
            StartTravel(completed);
            return true;
        }

        public bool PlayerAtWorldSite(string siteId)
        {
            if (string.IsNullOrEmpty(siteId)) return false;
            JObject site = PlayerSiteData();
            if (site == null) return false;
            string id = site["id"]?.ToString() ?? string.Empty;
            string locationId = site["locationId"]?.ToString() ?? string.Empty;
            return id == siteId || locationId == siteId;
        }
        public bool SubmitPendingContactDecision(bool enter)
        {
            if (_pendingContact == null || _contactDecisionPending || !IsLocalTravelLeader()) return false;
            ResolveTravelContact(enter);
            return true;
        }

        public bool RequestLeaveAttachedWorldParty(Action<JObject> completed = null)
        {
            string taskId = AttachedPartyTaskId;
            if (string.IsNullOrEmpty(taskId) || _bootstrap?.Interaction == null) return false;
            StatusText = "Сервер подтверждает выход из отряда…";
            return _bootstrap.Interaction.SubmitWorldTaskAction(taskId, "cancel", ack =>
            {
                StatusText = ack?["ok"]?.ToObject<bool>() == true
                    ? "Вы покинули отряд и снова можете выбирать маршрут."
                    : (ack?["error"]?.ToString() ?? "Сервер не подтвердил выход из отряда.");
                completed?.Invoke(ack);
            });
        }

        private void StartTravel(Action<JObject> completed = null)
        {
            if (_travelActive || Socket == null) return;
            if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                StatusText = "Вы движетесь с отрядом. Сначала покиньте группу.";
                return;
            }
            if (Distance(_playerPoint, _selectedPoint) <= 0.35f)
            {
                StatusText = "Вы уже находитесь в этой точке.";
                return;
            }

            StatusText = "Сервер строит маршрут...";
            string locationId = _selectedDynamic != null && !string.IsNullOrEmpty(_selectedDynamic.LocationId)
                ? _selectedDynamic.LocationId
                : (_selectedNode != null ? _selectedNode.EffectiveLocationId : "wasteland");
            var payload = new
            {
                fromLocationId = _state?["fromLocationId"]?.ToString() ?? Socket.Session?.LocationId ?? "settlement",
                targetLocationId = locationId,
                siteId = _selectedDynamic?.SiteId ?? string.Empty,
                worldPoint = new { x = _selectedPoint.X, y = _selectedPoint.Y }
            };

            Socket.EmitWithAck("globalTravelStart", payload, ack =>
            {
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Сервер не подтвердил маршрут.");
                    completed?.Invoke(ack);
                    return;
                }

                ApplyTravel(ack);
                _travelDescriptorGraceUntil = Time.realtimeSinceStartup + TravelDescriptorGraceSeconds;
                RefreshMarkers();
                StatusText = "Маршрут запущен.";
                completed?.Invoke(ack);
            });
        }

        private void CancelTravel()
        {
            if (!_travelActive || Socket == null || _arrivalPending) return;
            StatusText = "Останавливаем маршрут...";
            Socket.EmitWithAck("globalTravelCancel", new { }, ack =>
            {
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Сервер не смог остановить маршрут.");
                    return;
                }

                _playerPoint = ReadObjectPoint(ack["worldPoint"], _playerPoint);
                _selectedPoint = CopyPoint(_playerPoint);
                _selectedNode = NearestNode(_playerPoint, NodeSnapRadiusPoints);
                ClearTravel();
                RefreshMarkers();
                StatusText = "Маршрут остановлен.";
            });
        }

        private void RequestArrival()
        {
            if (Socket == null) return;
            _arrivalPending = true;
            StatusText = "Сервер подтверждает прибытие...";
            string targetLocationId = _selectedDynamic != null && !string.IsNullOrEmpty(_selectedDynamic.LocationId)
                ? _selectedDynamic.LocationId
                : (_selectedNode != null ? _selectedNode.EffectiveLocationId : "wasteland");
            Socket.EmitWithAck("globalTravelArrive", new
            {
                targetLocationId,
                siteId = _selectedDynamic?.SiteId ?? string.Empty,
                partyId = _selectedDynamic?.PartyId ?? string.Empty,
                worldZoneId = _selectedDynamic?.WorldZoneId ?? string.Empty,
                worldPoint = new { x = _selectedPoint.X, y = _selectedPoint.Y }
            }, ack =>
            {
                _arrivalPending = false;
                if (!AckOk(ack))
                {
                    JObject corrected = ack?["worldPoint"] as JObject;
                    if (corrected != null) _playerPoint = ReadObjectPoint(corrected, _playerPoint);
                    StatusText = AckError(ack, "Сервер не подтвердил прибытие.");
                    _arrivalRetryAt = Time.realtimeSinceStartup + 1.5f;
                    if (_contactArrival)
                    {
                        _selectedDynamic = _savedDestinationDynamic;
                        _selectedNode = _savedDestinationNode;
                        _selectedPoint = CopyPoint(_savedDestinationPoint);
                        _contactArrival = false;
                        RefreshMarkers();
                    }
                    return;
                }

                _contactArrival = false;
                ApplyArrival(ack);
            });
        }

        private void ApplyArrival(JObject payload)
        {
            _playerPoint = ReadObjectPoint(payload?["worldPoint"], _selectedPoint);
            _selectedPoint = CopyPoint(_playerPoint);
            ClearTravel();
            RefreshMarkers();

            if (payload?["stayOnWorldMap"]?.ToObject<bool>() == true)
            {
                StatusText = "Вы прибыли в выбранную точку пустоши.";
                return;
            }

            RequestLocationEntry(payload);
        }

        private void RequestLocationEntry(JObject arrival)
        {
            if (arrival == null || Socket == null) return;
            string locationId = arrival["targetLocationId"]?.ToString();
            if (string.IsNullOrEmpty(locationId))
            {
                StatusText = "В ответе прибытия нет targetLocationId.";
                return;
            }

            StatusText = "Вход в локацию " + locationId + "...";
            var payload = new
            {
                locationId,
                roomId = arrival["encounterRoomId"]?.ToString() ?? string.Empty,
                encounterId = arrival["encounterId"]?.ToString() ?? string.Empty,
                worldZoneId = arrival["worldZoneId"]?.ToString() ?? string.Empty,
                partyId = arrival["partyId"]?.ToString() ?? string.Empty,
                siteId = arrival["siteId"]?.ToString() ?? string.Empty,
                worldPoint = arrival["worldPoint"],
                pvpMode = arrival["pvpMode"]?.ToString() ?? string.Empty,
                entryKey = arrival["entryKey"]?.ToString() ?? "entryFromWorld",
                deviceType = "desktop",
                controlType = "keyboard_mouse"
            };

            Socket.EmitWithAck("changeLocation", payload, ack =>
            {
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Сервер не разрешил вход в локацию.");
                    return;
                }

                JoinAck session = Socket.ApplyLocationTransitionAck(ack);
                if (session == null)
                {
                    StatusText = "Не удалось разобрать ответ смены локации.";
                    return;
                }
            });
        }

        private void HandleTravelStarted(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            ApplyTravel(payload);
            RefreshMarkers();
            StatusText = (payload?["leaderName"]?.ToString() ?? "Лидер группы") + " запустил маршрут.";
        }

        private void HandleEnteredWorld(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            Socket?.ApplyGlobalMapTransitionAck(payload);
            JObject state = StateFromWorldPoint(payload?["worldPoint"] as JObject,
                                                payload?["fromLocationId"]?.ToString());
            _bootstrap?.EnterGlobalMapFromServer(state);
        }

        private void HandleTravelCancelled(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            _playerPoint = ReadObjectPoint(payload?["worldPoint"], _playerPoint);
            _selectedPoint = CopyPoint(_playerPoint);
            ClearTravel();
            RefreshMarkers();
            StatusText = "Лидер группы остановил маршрут.";
        }

        private void HandleTravelArrived(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            ApplyArrival(payload);
        }

        private void HandleGroupReleased(JObject payload)
        {
            _playerPoint = ReadObjectPoint(payload?["worldPoint"], _playerPoint);
            _selectedPoint = CopyPoint(_playerPoint);
            ClearTravel();
            RefreshMarkers();
            StatusText = "Связь с лидером потеряна; маршрут снова можно выбирать самостоятельно.";
        }

        private void HandleEncounterDecision(JObject payload)
        {
            if (payload == null || IsOwnLeaderEvent(payload)) return;
            string title = payload["title"]?.ToString() ?? "событие мира";
            if (payload["pending"]?.ToObject<bool>() == true)
            {
                string id = payload["encounterId"]?.ToString() ?? string.Empty;
                _pendingContact = _dynamicTargets.Find(row => row.Id == id)
                    ?? new DynamicTarget { Id = id, Name = title, Point = CopyPoint(_playerPoint) };
                StatusText = "Лидер выбирает решение: " + title;
                return;
            }

            if (payload["decision"]?.ToString() == "skip")
            {
                _pendingContact = null;
                StatusText = "Лидер обходит событие: " + title;
            }
            else StatusText = "Лидер вступает в событие: " + title;
        }

        private bool IsOwnLeaderEvent(JObject payload)
        {
            string leaderId = payload?["leaderId"]?.ToString();
            return !string.IsNullOrEmpty(leaderId) && leaderId == Socket?.Session?.Id;
        }

        private bool IsLocalTravelLeader()
        {
            return string.IsNullOrEmpty(_travelLeaderId) || _travelLeaderId == Socket?.Session?.Id;
        }

        private bool WorldPartyHostile(string factionId)
        {
            string faction = FactionGroupKey(factionId);
            if (faction == "raiders" || faction == "mutants" || faction == "wild") return true;
            string playerFaction = FactionGroupKey(Socket?.Session?.Self?["worldFactionId"]?.ToString()
                ?? Socket?.Session?.Self?["factionId"]?.ToString());
            bool playerCivil = IsCivilFaction(playerFaction);
            return playerCivil && IsCivilFaction(faction) && playerFaction != faction;
        }

        private static bool IsCivilFaction(string faction)
        {
            return faction == "old_klim" || faction == "caravans"
                || faction == "scrap_union" || faction == "relay_order";
        }

        private static string FactionGroupKey(string faction)
        {
            string key = (faction ?? string.Empty).ToLowerInvariant();
            if (key == "old_klim" || key == "klim_patrol") return "old_klim";
            if (key == "caravan" || key == "caravans") return "caravans";
            if (key == "scrap" || key == "scrap_town" || key == "scrap_union") return "scrap_union";
            if (key == "relay" || key == "relay_station" || key == "relay_order") return "relay_order";
            if (key == "ghouls" || key == "radscorpions" || key == "mutant_ants"
                || key == "geckos" || key == "wild") return "wild";
            return string.IsNullOrEmpty(key) ? "neutral" : key;
        }

        private void RefreshMarkers()
        {
            if (_playerMarker != null) _playerMarker.transform.localPosition = PointToWorld(_playerPoint.X, _playerPoint.Y, 0.62f);
            if (_selectionMarker != null) _selectionMarker.transform.localPosition = PointToWorld(_selectedPoint.X, _selectedPoint.Y, 0.13f);
        }

        private void ConfigureCamera()
        {
            if (CameraRig == null || _cameraAnchor == null) return;
            if (!_cameraSaved)
            {
                _cameraSaved = true;
                _savedDistance = CameraRig.Distance;
                _savedMinDistance = CameraRig.MinDistance;
                _savedMaxDistance = CameraRig.MaxDistance;
                _savedPitch = CameraRig.PitchDeg;
                _savedYaw = CameraRig.YawDeg;
            }

            CameraRig.ZoomPersistenceEnabled = false;

            float span = Mathf.Max(MapWidthPoints, MapHeightPoints) * MapWorldScale;
            CameraRig.Target = _cameraAnchor.transform;
            CameraRig.PitchDeg = 68f;
            CameraRig.YawDeg = 0f;
            CameraRig.MinDistance = Mathf.Max(28f, span * 0.45f);
            CameraRig.MaxDistance = Mathf.Max(150f, span * 1.8f);
            CameraRig.Distance = Mathf.Clamp(span * 1.12f, CameraRig.MinDistance, CameraRig.MaxDistance);
            CameraRig.SnapToTarget();
        }

        private void RestoreCamera()
        {
            if (!_cameraSaved || CameraRig == null) return;
            CameraRig.Distance = _savedDistance;
            CameraRig.MinDistance = _savedMinDistance;
            CameraRig.MaxDistance = _savedMaxDistance;
            CameraRig.PitchDeg = _savedPitch;
            CameraRig.YawDeg = _savedYaw;
            CameraRig.ZoomPersistenceEnabled = true;
            _cameraSaved = false;
        }

        private void ClearVisuals()
        {
            if (_root != null)
            {
                _root.SetActive(false);
                Destroy(_root);
            }
            _root = null;
            _playerMarker = null;
            _selectionMarker = null;
            _cameraAnchor = null;
            _terrainCollider = null;
            _routeLine = null;
            _dynamicRoot = null;
            _dynamicTargets.Clear();
            _activityHighlightRings.Clear();
            _activityHighlightKey = string.Empty;

            if (_terrainTexture != null) Destroy(_terrainTexture);
            _terrainTexture = null;
            foreach (Material material in _materials) if (material != null) Destroy(material);
            _materials.Clear();
            foreach (Material material in _dynamicMaterials) if (material != null) Destroy(material);
            _dynamicMaterials.Clear();
            foreach (Mesh mesh in _dynamicMeshes) if (mesh != null) Destroy(mesh);
            _dynamicMeshes.Clear();
            _dynamicMaterialCache.Clear();
            _territoryByCell.Clear();
            _factionSummary = string.Empty;
            TerritoryCellCount = 0;
            TerritoryBorderCount = 0;
            InfluenceZoneCount = 0;
            SettlementModelCount = 0;
            SiteMarkerCount = 0;
            SettlementStatusCount = 0;
            SiteMeshVertexCount = 0;
            SiteMeshSubMeshCount = 0;
        }

        private void ApplyMaterial(GameObject target, Color color)
        {
            MeshRenderer renderer = target != null ? target.GetComponent<MeshRenderer>() : null;
            if (renderer != null) renderer.sharedMaterial = CreateMaterial(color);
        }

        private void ApplyDynamicMaterial(GameObject target, Color color)
        {
            MeshRenderer renderer = target != null ? target.GetComponent<MeshRenderer>() : null;
            if (renderer != null) renderer.sharedMaterial = CreateDynamicMaterial(color);
        }

        private Material CreateMaterial(Color color)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                         ?? Shader.Find("Universal Render Pipeline/Lit")
                         ?? Shader.Find("Standard");
            var material = new Material(shader) { color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            _materials.Add(material);
            return material;
        }

        private Material CreateDynamicMaterial(Color color)
        {
            Color32 value = color;
            string key = value.r + ":" + value.g + ":" + value.b + ":" + value.a;
            Material cached;
            if (_dynamicMaterialCache.TryGetValue(key, out cached) && cached != null) return cached;

            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                         ?? Shader.Find("Universal Render Pipeline/Lit")
                         ?? Shader.Find("Standard");
            var material = new Material(shader) { color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (color.a < 0.999f)
            {
                material.renderQueue = 3000;
                if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
                if (material.HasProperty("_SrcBlend"))
                    material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                if (material.HasProperty("_DstBlend"))
                    material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
                if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)UnityEngine.Rendering.CullMode.Off);
                material.SetOverrideTag("RenderType", "Transparent");
                material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                material.DisableKeyword("_ALPHATEST_ON");
            }
            _dynamicMaterials.Add(material);
            _dynamicMaterialCache[key] = material;
            return material;
        }

        private float MapWidthPoints { get { return _map.Grid.Cols * _map.Grid.CellPoints; } }
        private float MapHeightPoints { get { return _map.Grid.Rows * _map.Grid.CellPoints; } }

        private Vector3 PointToWorld(float x, float y, float height)
        {
            return new Vector3((x - MapWidthPoints * 0.5f) * MapWorldScale,
                               height,
                               (MapHeightPoints * 0.5f - y) * MapWorldScale);
        }

        private GlobalMapPoint WorldToPoint(Vector3 world)
        {
            return new GlobalMapPoint
            {
                X = Mathf.Clamp(world.x / MapWorldScale + MapWidthPoints * 0.5f, 0f, MapWidthPoints),
                Y = Mathf.Clamp(MapHeightPoints * 0.5f - world.z / MapWorldScale, 0f, MapHeightPoints)
            };
        }

        private GlobalMapNode NearestNode(GlobalMapPoint point, float radius)
        {
            GlobalMapNode best = null;
            float bestDistance = radius;
            foreach (GlobalMapNode node in _map.Nodes)
            {
                float distance = Mathf.Sqrt((node.X - point.X) * (node.X - point.X)
                                          + (node.Y - point.Y) * (node.Y - point.Y));
                if (distance > bestDistance) continue;
                best = node;
                bestDistance = distance;
            }
            return best;
        }

        private DynamicTarget NearestDynamicTarget(GlobalMapPoint point, float radius)
        {
            DynamicTarget best = null;
            float bestDistance = radius;
            foreach (DynamicTarget target in _dynamicTargets)
            {
                if (target == null || target.Point == null) continue;
                if (!target.CanEnter && !string.Equals(target.Kind, "site", StringComparison.OrdinalIgnoreCase)) continue;
                float distance = Distance(point, target.Point);
                if (distance > bestDistance) continue;
                best = target;
                bestDistance = distance;
            }
            return best;
        }

        private static float PointSegmentDistance(GlobalMapPoint point, GlobalMapPoint from,
                                                  GlobalMapPoint to, out float t)
        {
            float dx = to.X - from.X;
            float dy = to.Y - from.Y;
            float lengthSq = dx * dx + dy * dy;
            t = lengthSq > 0.0001f
                ? Mathf.Clamp01(((point.X - from.X) * dx + (point.Y - from.Y) * dy) / lengthSq)
                : 0f;
            float x = from.X + dx * t;
            float y = from.Y + dy * t;
            float px = point.X - x;
            float py = point.Y - y;
            return Mathf.Sqrt(px * px + py * py);
        }

        private static bool PartyCanEncounter(JObject row)
        {
            if (row == null || row["destroyed"]?.ToObject<bool>() == true) return false;
            string state = row["state"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            if (state == "destroyed" || state == "onsite" || state == "engaged") return false;
            return Float(row["members"], Float(row["strength"], 0f)) > 0f;
        }

        private static float PartyRadius(JObject row)
        {
            string kind = row?["kind"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            string faction = row?["faction"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            string species = ((row?["species"]?.ToString() ?? string.Empty) + " "
                            + (row?["visual"]?.ToString() ?? string.Empty) + " "
                            + (row?["name"]?.ToString() ?? string.Empty)).ToLowerInvariant();
            float radius = 5.8f;
            if (kind == "caravan") radius = 8.2f;
            else if (kind == "patrol") radius = 6.4f;
            else if (faction == "raiders" || kind == "raider") radius = 6.2f;
            else if (faction == "mutants") radius = 7f;
            else if (species.Contains("radscorpion") || species.Contains("scorpion") || species.Contains("скорпион")) radius = 7.2f;
            else if (species.Contains("gecko") || species.Contains("геккон")) radius = 6.8f;
            else if (species.Contains("brahmin") || species.Contains("брамин")) radius = 7.4f;
            else if (species.Contains("ant") || species.Contains("мурав")) radius = 6f;
            else if (species.Contains("wolf") || species.Contains("волк")) radius = 6.4f;
            return Mathf.Clamp(radius, 5.2f, 8.8f);
        }

        private void ResolveSelectedDynamic()
        {
            if (_selectedDynamic == null) return;
            foreach (DynamicTarget target in _dynamicTargets)
            {
                bool same = !string.IsNullOrEmpty(_selectedDynamic.WorldZoneId)
                    ? target.WorldZoneId == _selectedDynamic.WorldZoneId
                    : (!string.IsNullOrEmpty(_selectedDynamic.PartyId)
                        ? target.PartyId == _selectedDynamic.PartyId
                        : (!string.IsNullOrEmpty(_selectedDynamic.SiteId) && target.SiteId == _selectedDynamic.SiteId));
                if (!same) continue;
                _selectedDynamic = target;
                if (!_travelActive) _selectedPoint = CopyPoint(target.Point);
                RefreshMarkers();
                return;
            }
        }

        private Color FactionColor(string factionId, Color fallback)
        {
            if (string.IsNullOrEmpty(factionId) || _wasteland == null) return fallback;
            string hex = _wasteland["factions"]?[factionId]?["color"]?.ToString();
            Color color;
            return !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out color) ? color : fallback;
        }

        private static GlobalMapPoint PointAtRouteProgress(IList<GlobalMapPoint> route, float progress)
        {
            if (route == null || route.Count == 0) return new GlobalMapPoint();
            if (route.Count == 1) return CopyPoint(route[0]);

            float total = 0f;
            for (int i = 1; i < route.Count; i++) total += Distance(route[i - 1], route[i]);
            if (total <= 0.0001f) return CopyPoint(route[route.Count - 1]);

            float remaining = Mathf.Clamp01(progress) * total;
            for (int i = 1; i < route.Count; i++)
            {
                float segment = Distance(route[i - 1], route[i]);
                if (remaining <= segment || i == route.Count - 1)
                {
                    float t = segment > 0.0001f ? Mathf.Clamp01(remaining / segment) : 1f;
                    return new GlobalMapPoint
                    {
                        X = Mathf.Lerp(route[i - 1].X, route[i].X, t),
                        Y = Mathf.Lerp(route[i - 1].Y, route[i].Y, t)
                    };
                }
                remaining -= segment;
            }
            return CopyPoint(route[route.Count - 1]);
        }

        private static float Distance(GlobalMapPoint a, GlobalMapPoint b)
        {
            if (a == null || b == null) return 0f;
            float dx = a.X - b.X;
            float dy = a.Y - b.Y;
            return Mathf.Sqrt(dx * dx + dy * dy);
        }

        private static GlobalMapPoint CopyPoint(GlobalMapPoint point)
        {
            return point == null ? new GlobalMapPoint() : new GlobalMapPoint { X = point.X, Y = point.Y };
        }

        private static GlobalMapPoint ReadPoint(JObject source, string xName, string yName, GlobalMapPoint fallback)
        {
            if (source == null) return CopyPoint(fallback);
            return new GlobalMapPoint
            {
                X = Float(source[xName], fallback != null ? fallback.X : 0f),
                Y = Float(source[yName], fallback != null ? fallback.Y : 0f)
            };
        }

        private static GlobalMapPoint ReadObjectPoint(JToken token, GlobalMapPoint fallback)
        {
            JObject point = token as JObject;
            return point == null ? CopyPoint(fallback) : ReadPoint(point, "x", "y", fallback);
        }

        private static List<GlobalMapPoint> ReadRoute(JArray rows)
        {
            var result = new List<GlobalMapPoint>();
            if (rows == null) return result;
            foreach (JToken row in rows)
            {
                JObject point = row as JObject;
                if (point != null) result.Add(ReadPoint(point, "x", "y", null));
            }
            return result;
        }

        private static float Float(JToken token, float fallback)
        {
            if (token == null) return fallback;
            // JValue.ToString() форматирует double текущей культурой (ru-RU даёт "173,3"),
            // и инвариантный разбор такой строки молча возвращал fallback. Числовые токены
            // читаем напрямую, строки разбираем инвариантно.
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return token.Value<float>();
            float value;
            return float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                                  System.Globalization.CultureInfo.InvariantCulture, out value)
                ? value
                : fallback;
        }

        private static bool AckOk(JObject ack)
        {
            return ack != null && ack["ok"] != null && ack["ok"].ToObject<bool>();
        }

        private static string AckError(JObject ack, string fallback)
        {
            return ack?["error"]?.ToString() ?? fallback;
        }

        private static JObject StateFromWorldPoint(JObject point, string fromLocationId)
        {
            float x = Float(point?["x"], 0f);
            float y = Float(point?["y"], 0f);
            return new JObject
            {
                ["version"] = 1,
                ["onWorldMap"] = true,
                ["fromLocationId"] = string.IsNullOrEmpty(fromLocationId) ? "settlement" : fromLocationId,
                ["playerX"] = x,
                ["playerY"] = y,
                ["selectedX"] = x,
                ["selectedY"] = y
            };
        }

        private static Color CellColor(GlobalMapCell cell)
        {
            string texture = cell != null ? (cell.Texture ?? string.Empty).ToLowerInvariant() : string.Empty;
            switch (texture)
            {
                case "water":
                case "ocean":
                case "sea":
                case "lake": return Hex(0x254a52);
                case "old_road": return Hex(0x675a3d);
                case "salt_flat": return Hex(0xa89e70);
                case "dry_lake": return Hex(0xb39a60);
                case "rocky_hills": return Hex(0x6a6250);
                case "scrap_field": return Hex(0x5c5142);
                case "green_lowland": return Hex(0x405b32);
                default: return Hex(0x7a5b32);
            }
        }

        private static Color Hex(int rgb)
        {
            return new Color(((rgb >> 16) & 0xff) / 255f,
                             ((rgb >> 8) & 0xff) / 255f,
                             (rgb & 0xff) / 255f, 1f);
        }

        private string BuildSelectionSummary()
        {
            if (_map == null || _map.Grid == null || _selectedPoint == null) return string.Empty;
            int cx = Mathf.Clamp(Mathf.FloorToInt(_selectedPoint.X / _map.Grid.CellPoints), 0, _map.Grid.Cols - 1);
            int cy = Mathf.Clamp(Mathf.FloorToInt(_selectedPoint.Y / _map.Grid.CellPoints), 0, _map.Grid.Rows - 1);
            var lines = new List<string>();

            GlobalMapCell cell;
            _map.Cells.TryGetValue(cx + ":" + cy, out cell);
            string terrain = cell != null && !string.IsNullOrEmpty(cell.Terrain)
                ? cell.Terrain
                : TerrainLabel(cell != null ? cell.Texture : string.Empty);
            int difficulty = cell != null ? Mathf.Max(cell.Difficulty, cell.Danger) : 0;
            float chance = cell != null ? cell.Chance : 0f;
            string cellLine = "Клетка " + (cx + 1) + ":" + (cy + 1) + " · " + terrain;
            if (difficulty > 0) cellLine += " · опасность " + difficulty;
            if (chance > 0.01f) cellLine += " · встреча " + chance.ToString("0.#") + "%";
            if (cell != null && !string.IsNullOrEmpty(cell.PvpMode)) cellLine += " · " + PvpLabel(cell.PvpMode);
            lines.Add(cellLine);

            float distancePoints = Distance(_playerPoint, _selectedPoint);
            float distanceKm = distancePoints / Mathf.Max(0.001f, _map.Grid.CellPoints) * _map.Grid.CellKm;
            if (distancePoints > 0.35f) lines.Add("До цели: " + distanceKm.ToString("0.0") + " км");

            JObject territory;
            if (_territoryByCell.TryGetValue(cx + ":" + cy, out territory))
            {
                string owner = territory["owner"]?.ToString() ?? string.Empty;
                string ownerLabel = territory["ownerLabel"]?.ToString();
                if (string.IsNullOrEmpty(ownerLabel)) ownerLabel = FactionName(owner);
                lines.Add("Территория: " + ownerLabel + " · контроль "
                          + Mathf.RoundToInt(Float(territory["strength"], 0f) * 100f) + "%"
                          + (territory["frontier"]?.ToObject<bool>() == true ? " · граница" : string.Empty));
            }

            JObject site = SelectedSiteData();
            if (site != null)
            {
                string owner = site["owner"]?.ToString() ?? "neutral";
                string ownerLabel = site["ownerLabel"]?.ToString();
                if (string.IsNullOrEmpty(ownerLabel)) ownerLabel = FactionName(owner);
                string type = SiteTypeLabel(site["type"]?.ToString());
                string control = site["controlStateLabel"]?.ToString() ?? site["controlState"]?.ToString() ?? "стабильно";
                float pressure = Float(site["controlPressure"], 0f);
                lines.Add(type + " · владелец: " + ownerLabel + " · контроль: " + control
                          + (Mathf.Abs(pressure) > 0.05f ? " (" + (pressure > 0f ? "+" : string.Empty) + pressure.ToString("0.#") + ")" : string.Empty));
                lines.Add("Безопасность " + Mathf.RoundToInt(Float(site["security"], 0f))
                          + " · процветание " + Mathf.RoundToInt(Float(site["prosperity"], 0f))
                          + " · опасность " + Mathf.RoundToInt(Float(site["danger"], 0f)));
                string market = site["marketStateLabel"]?.ToString();
                if (string.IsNullOrEmpty(market)) market = site["marketState"]?.ToString();
                if (!string.IsNullOrEmpty(market)) lines.Add("Рынок: " + market);
                string work = site["workSummary"]?.ToString();
                if (!string.IsNullOrEmpty(work)) lines.Add("Население и работа: " + work);
                string need = site["productionNeedSummary"]?.ToString();
                if (!string.IsNullOrEmpty(need)) lines.Add("Нужна поддержка: " + need);
            }
            else if (_selectedDynamic != null && _selectedDynamic.Data != null)
            {
                JObject row = _selectedDynamic.Data;
                if (string.Equals(_selectedDynamic.Kind, "party", StringComparison.OrdinalIgnoreCase))
                {
                    string faction = row["faction"]?.ToString() ?? "neutral";
                    lines.Add(PartyKindLabel(row["kind"]?.ToString()) + " · " + FactionName(faction)
                              + " · бойцов " + Mathf.RoundToInt(Float(row["members"], Float(row["strength"], 0f))));
                    string status = row["statusText"]?.ToString();
                    if (!string.IsNullOrEmpty(status)) lines.Add(status);
                    string cargo = row["cargoSummary"]?.ToString();
                    if (!string.IsNullOrEmpty(cargo)) lines.Add("Груз: " + cargo + " · риск " + (row["riskLabel"]?.ToString() ?? "нет"));
                }
                else if (string.Equals(_selectedDynamic.Kind, "zone", StringComparison.OrdinalIgnoreCase))
                {
                    lines.Add("Мировая зона · " + FactionName(_selectedDynamic.Faction)
                              + " · радиус " + _selectedDynamic.Radius.ToString("0.#") + " км");
                }
            }
            else if (_selectedNode != null)
            {
                string note = _selectedNode.Note;
                if (!string.IsNullOrEmpty(note)) lines.Add(note);
                if (_selectedNode.Danger > 0) lines.Add("Опасность поселения: " + _selectedNode.Danger);
            }

            return string.Join("\n", lines);
        }

        private JObject SelectedSiteData()
        {
            if (_selectedDynamic != null && string.Equals(_selectedDynamic.Kind, "site", StringComparison.OrdinalIgnoreCase)
                && _selectedDynamic.Data != null) return _selectedDynamic.Data;
            JArray sites = _wasteland?["sites"] as JArray;
            if (sites == null) return null;
            string nodeId = _selectedNode != null ? _selectedNode.Id : string.Empty;
            string locationId = _selectedNode != null ? _selectedNode.EffectiveLocationId : string.Empty;
            JObject nearest = null;
            float nearestDistance = 15f;
            foreach (JToken token in sites)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string id = row["id"]?.ToString() ?? string.Empty;
                string rowLocation = row["locationId"]?.ToString() ?? string.Empty;
                if ((!string.IsNullOrEmpty(nodeId) && id == nodeId)
                    || (!string.IsNullOrEmpty(locationId) && (id == locationId || rowLocation == locationId))) return row;
                float distance = Distance(_selectedPoint, ReadPoint(row, "x", "y", null));
                if (distance > nearestDistance) continue;
                nearest = row;
                nearestDistance = distance;
            }
            return nearest;
        }

        private string ComposeFactionSummary()
        {
            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (JObject row in _territoryByCell.Values)
            {
                string owner = row?["owner"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(owner) || string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase)) continue;
                int count;
                counts.TryGetValue(owner, out count);
                counts[owner] = count + 1;
            }

            if (counts.Count == 0)
            {
                JArray sites = _wasteland?["sites"] as JArray;
                if (sites != null)
                {
                    foreach (JToken token in sites)
                    {
                        string owner = token?["owner"]?.ToString() ?? string.Empty;
                        if (string.IsNullOrEmpty(owner) || string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase)) continue;
                        int count;
                        counts.TryGetValue(owner, out count);
                        counts[owner] = count + 1;
                    }
                }
            }
            if (counts.Count == 0) return string.Empty;

            var rows = new List<KeyValuePair<string, int>>(counts);
            rows.Sort((left, right) => right.Value.CompareTo(left.Value));
            var parts = new List<string>();
            float cellArea = _map != null && _map.Grid != null ? _map.Grid.CellKm * _map.Grid.CellKm : 1f;
            bool territoryArea = _territoryByCell.Count > 0;
            for (int i = 0; i < rows.Count && i < 8; i++)
            {
                string value = territoryArea
                    ? Mathf.RoundToInt(rows[i].Value * cellArea).ToString("N0") + " км²"
                    : rows[i].Value + " точек";
                parts.Add(FactionName(rows[i].Key) + " — " + value);
            }
            return (territoryArea ? "Владение фракций: " : "Влияние фракций: ") + string.Join(" · ", parts);
        }

        private string BuildFactionSummary()
        {
            return _factionSummary;
        }

        private string FactionName(string factionId)
        {
            string id = FactionGroupKey(factionId);
            string name = _wasteland?["factions"]?[id]?["name"]?.ToString();
            if (!string.IsNullOrEmpty(name)) return name;
            switch (id)
            {
                case "old_klim": return "Старый Клим";
                case "caravans": return "Вольные караваны";
                case "scrap_union": return "Свалочный союз";
                case "relay_order": return "Техники Ретранслятора";
                case "raiders": return "Рейдеры";
                case "mutants": return "Супермутанты";
                case "wild": return "Дикие твари";
                default: return "Нейтральные";
            }
        }

        private static string TerrainLabel(string texture)
        {
            switch ((texture ?? string.Empty).ToLowerInvariant())
            {
                case "water": case "ocean": case "sea": case "lake": return "вода";
                case "old_road": return "старая дорога";
                case "salt_flat": return "солончак";
                case "dry_lake": return "сухое озеро";
                case "rocky_hills": return "каменистые холмы";
                case "scrap_field": return "поле металлолома";
                case "green_lowland": return "зелёная низина";
                default: return "пустошь";
            }
        }

        private static string PvpLabel(string mode)
        {
            string value = (mode ?? string.Empty).ToLowerInvariant();
            return value == "peaceful" || value == "pve" ? "мирная зона" : (value == "pvp" ? "PvP" : mode);
        }

        private static string SiteTypeLabel(string type)
        {
            switch ((type ?? string.Empty).ToLowerInvariant())
            {
                case "settlement": return "Поселение";
                case "outpost": return "Аванпост";
                case "production": return "Производственная точка";
                case "resource": return "Ресурсная точка";
                case "pointofinterest": return "Точка интереса";
                default: return "Точка пустоши";
            }
        }

        private static string PartyKindLabel(string kind)
        {
            switch ((kind ?? string.Empty).ToLowerInvariant())
            {
                case "caravan": return "Караван";
                case "patrol": return "Патруль";
                case "raider": return "Рейдерский отряд";
                default: return "Отряд";
            }
        }

        private void OnGUI()
        {
            RoaUiTheme.Apply();
            if (!IsActive || !InputEnabled) return;

            Rect panel = InformationPanelRect(Screen.width, Screen.height);
            Event guiEvent = Event.current;
            bool pointerOverCanvas = EventSystem.current != null && EventSystem.current.IsPointerOverGameObject();
            if (!_travelActive && !_cameraPanning && !pointerOverCanvas
                && guiEvent != null && guiEvent.type == EventType.MouseDown && guiEvent.button == 0
                && (CanvasDriven || MapPointCanSelect(guiEvent.mousePosition, Screen.width, Screen.height)))
            {
                SelectFromCursor();
                guiEvent.Use();
                // Web: клик по карте = выбор цели и сразу старт маршрута (selectGlobalMapDestination);
                // pendingWorldDrop сбрасывается, только если новая точка дальше 0.35.
                if (CanvasDriven && !PlayerAtSelection)
                {
                    _pendingEntry = false;
                    if (_pendingContact == null && string.IsNullOrEmpty(AttachedPartyId)) StartTravel();
                }
            }

            if (CanvasDriven)
            {
                DrawNodeLabels();
                return;
            }

            DrawPanelBackdrop(panel);
            GUILayout.BeginArea(panel, GUI.skin.box);
            GUILayout.Label("<b>Глобальная карта</b>", Rich());
            _panelScroll = GUILayout.BeginScrollView(_panelScroll, false, true);
            GUILayout.Label(StatusText);
            GUILayout.Label("Позиция: " + _playerPoint.X.ToString("0.0") + ", " + _playerPoint.Y.ToString("0.0"));
            string targetName = _selectedDynamic != null
                ? _selectedDynamic.Name
                : (_selectedNode != null ? _selectedNode.EffectiveLocationId : "точка пустоши");
            GUILayout.Label("Цель: " + targetName
                            + "  (" + _selectedPoint.X.ToString("0.0") + ", " + _selectedPoint.Y.ToString("0.0") + ")");

            string selectionSummary = BuildSelectionSummary();
            if (!string.IsNullOrEmpty(selectionSummary))
            {
                GUILayout.Space(3f);
                GUILayout.Label(selectionSummary, Wrapped());
            }

            if (_wasteland != null)
            {
                float hour = Float(_wasteland["worldHour"], 0f);
                GUILayout.Label("Мир: час " + hour.ToString("0.0")
                               + " · точки " + ArrayCount(_wasteland["sites"])
                               + " · отряды " + ArrayCount(_wasteland["parties"])
                               + " · территории " + TerritoryCellCount);
                if (!string.IsNullOrEmpty(_factionSummary)) GUILayout.Label(_factionSummary, Wrapped());
            }

            if (_pendingContact != null)
            {
                GUILayout.Space(7f);
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>Контакт на маршруте</b>", Rich());
                GUILayout.Label(_pendingContact.Name ?? "Событие пустоши");
                if (!string.IsNullOrEmpty(_pendingContact.Details)) GUILayout.Label(_pendingContact.Details);
                if (IsLocalTravelLeader())
                {
                    GUI.enabled = !_contactDecisionPending;
                    GUILayout.BeginHorizontal();
                    if (GUILayout.Button("Войти", GUILayout.Height(32f))) ResolveTravelContact(true);
                    if (!_pendingContact.Forced && GUILayout.Button("Обойти", GUILayout.Height(32f))) ResolveTravelContact(false);
                    GUILayout.EndHorizontal();
                    GUI.enabled = true;
                }
                else GUILayout.Label("Решение принимает лидер группы.");
                GUILayout.EndVertical();
            }
            else if (_travelActive)
            {
                float progress = Mathf.Clamp01((Time.realtimeSinceStartup - _travelStartedRealtime) / _travelDuration);
                GUILayout.Label("Путь: " + Mathf.RoundToInt(progress * 100f) + "%");
                if (!_arrivalPending && GUILayout.Button("Остановить маршрут")) CancelTravel();
            }
            else if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                GUILayout.Label("Вы следуете с отрядом " + AttachedPartyId + ". Собственный маршрут недоступен.", Wrapped());
                if (GUILayout.Button("Покинуть отряд")) RequestLeaveAttachedWorldParty();
            }
            else if (GUILayout.Button("Начать маршрут"))
            {
                StartTravel();
            }

            GUILayout.Space(4f);
            GUILayout.Label("ЛКМ — выбрать точку, колесо — масштаб, Esc — меню.");
            GUILayout.EndScrollView();
            GUILayout.EndArea();

            DrawNodeLabels();
        }

        public static Rect InformationPanelRect(int screenWidth, int screenHeight)
        {
            float width = Mathf.Clamp(screenWidth * 0.46f, 270f, 390f);
            float height = Mathf.Clamp(screenHeight - 24f, 240f, 600f);
            return new Rect(screenWidth - width - 12f, 12f, width, height);
        }

        public static bool MapPointCanSelect(Vector2 guiPoint, int screenWidth, int screenHeight)
        {
            return guiPoint.x >= 0f && guiPoint.y >= 0f
                && guiPoint.x <= screenWidth && guiPoint.y <= screenHeight
                && !InformationPanelRect(screenWidth, screenHeight).Contains(guiPoint);
        }

        private static void DrawPanelBackdrop(Rect area)
        {
            Color previous = GUI.color;
            GUI.color = new Color(0.075f, 0.065f, 0.055f, 0.94f);
            GUI.DrawTexture(area, Texture2D.whiteTexture);
            GUI.color = previous;
        }

        private void DrawNodeLabels()
        {
            Camera camera = Camera.main;
            if (camera == null || _map == null) return;
            Rect panel = InformationPanelRect(Screen.width, Screen.height);
            var occupied = new List<Rect>();
            foreach (GlobalMapNode node in _map.Nodes)
            {
                Vector3 screen = camera.WorldToScreenPoint(PointToWorld(node.X, node.Y, 0.9f));
                if (screen.z <= 0f) continue;
                Vector2 point = new Vector2(screen.x, Screen.height - screen.y);
                if (!TryResolveNodeLabelRect(point, panel, occupied,
                                             Screen.width, Screen.height, out Rect label)) continue;
                occupied.Add(label);
                GUI.Label(label, NodeTitle(node), Centered());
            }
        }

        /// <summary>
        /// Keeps world-space map labels inside the visible map viewport. 3D marker
        /// names are drawn by IMGUI and therefore are not clipped by the sidebar;
        /// without this guard they appear on top of route controls and summaries.
        /// Nearby labels are shifted vertically or omitted instead of overlapping.
        /// </summary>
        public static bool TryResolveNodeLabelRect(Vector2 point, Rect blocked,
                                                   IReadOnlyList<Rect> occupied,
                                                   int screenWidth, int screenHeight,
                                                   out Rect resolved)
        {
            const float width = 140f;
            const float height = 24f;
            const float margin = 5f;
            if (point.x < 0f || point.y < 0f || point.x > screenWidth || point.y > screenHeight
                || blocked.Contains(point))
            {
                resolved = default;
                return false;
            }

            float rightEdge = Mathf.Min(screenWidth - margin, blocked.xMin - margin);
            if (rightEdge - margin < width)
            {
                resolved = default;
                return false;
            }
            float x = Mathf.Clamp(point.x - width * 0.5f, margin, rightEdge - width);
            float baseY = Mathf.Clamp(point.y - height * 0.5f, margin,
                                      Mathf.Max(margin, screenHeight - height - margin));
            for (int attempt = 0; attempt < 5; attempt++)
            {
                int step = attempt == 0 ? 0 : (attempt + 1) / 2;
                float direction = attempt == 0 || attempt % 2 == 1 ? -1f : 1f;
                float y = Mathf.Clamp(baseY + direction * step * (height + 3f), margin,
                                      Mathf.Max(margin, screenHeight - height - margin));
                var candidate = new Rect(x, y, width, height);
                if (candidate.Overlaps(blocked)) continue;
                bool overlaps = false;
                if (occupied != null)
                {
                    for (int i = 0; i < occupied.Count; i++)
                    {
                        if (!candidate.Overlaps(occupied[i])) continue;
                        overlaps = true;
                        break;
                    }
                }
                if (overlaps) continue;
                resolved = candidate;
                return true;
            }
            resolved = default;
            return false;
        }

        private static GUIStyle Rich()
        {
            var style = new GUIStyle(GUI.skin.label) { richText = true };
            return style;
        }

        private static GUIStyle Wrapped()
        {
            return new GUIStyle(GUI.skin.label) { wordWrap = true };
        }

        private static GUIStyle Centered()
        {
            var style = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = Color.white }
            };
            return style;
        }

        private static int ArrayCount(JToken token)
        {
            JArray array = token as JArray;
            return array != null ? array.Count : 0;
        }
    }
}
