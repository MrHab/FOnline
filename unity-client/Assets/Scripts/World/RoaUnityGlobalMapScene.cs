using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Every live global-map visual is a checked-in prefab. Runtime code may place,
    /// scale and tint these prefabs, but it must never manufacture render geometry.
    /// </summary>
    public enum RoaGlobalMapPrefabKind
    {
        Site,
        Party,
        TrackedTask,
        SettlementStatus,
        TerritoryCell,
        TerritoryBorder,
        InfluenceRing,
        RouteDash,
        ActivityCaravan,
        ActivityDistress,
        ActivityRecon,
        ActivityResource,
        ActivityDefense,
        ActivityAssault
    }

    [Serializable]
    public struct RoaGlobalMapPrefabSlot
    {
        public RoaGlobalMapPrefabKind Kind;
        public GameObject Prefab;

        public RoaGlobalMapPrefabSlot(RoaGlobalMapPrefabKind kind, GameObject prefab)
        {
            Kind = kind;
            Prefab = prefab;
        }
    }

    /// <summary>
    /// Bridge to the hand-authored additive scene. Static content is edited directly
    /// in Unity; changing server state only checks prefabs out of the local pool.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaUnityGlobalMapScene : MonoBehaviour
    {
        [Header("Authoring layers")]
        [SerializeField] private Transform _staticContentRoot;
        [SerializeField] private Transform _dynamicContentRoot;
        [SerializeField] private Collider _selectionSurface;

        [Header("Runtime handles (authored prefab instances)")]
        [SerializeField] private GameObject _playerMarker;
        [SerializeField] private GameObject _selectionMarker;
        [SerializeField] private Transform _cameraAnchor;

        [Header("Live-state prefab catalogue")]
        [SerializeField] private RoaGlobalMapPrefabSlot[] _livePrefabs = Array.Empty<RoaGlobalMapPrefabSlot>();

        private readonly Dictionary<string, RoaGlobalMapNodeAnchor> _nodes =
            new Dictionary<string, RoaGlobalMapNodeAnchor>(StringComparer.Ordinal);
        private readonly Dictionary<RoaGlobalMapPrefabKind, GameObject> _prefabs =
            new Dictionary<RoaGlobalMapPrefabKind, GameObject>();
        private readonly Dictionary<RoaGlobalMapPrefabKind, Stack<GameObject>> _pools =
            new Dictionary<RoaGlobalMapPrefabKind, Stack<GameObject>>();
        private readonly Dictionary<GameObject, RoaGlobalMapPrefabKind> _instanceKinds =
            new Dictionary<GameObject, RoaGlobalMapPrefabKind>();
        private readonly HashSet<GameObject> _activeInstances = new HashSet<GameObject>();
        private readonly List<GameObject> _releaseBuffer = new List<GameObject>();

        public Transform StaticContentRoot => _staticContentRoot;
        public Transform DynamicContentRoot => _dynamicContentRoot;
        public Collider SelectionSurface => _selectionSurface;
        public GameObject PlayerMarker => _playerMarker;
        public GameObject SelectionMarker => _selectionMarker;
        public Transform CameraAnchor => _cameraAnchor;
        public int ActiveLiveInstanceCount => _activeInstances.Count;
        public int NodeCount
        {
            get
            {
                EnsureNodeIndex();
                return _nodes.Count;
            }
        }

        public void Configure(Transform staticContentRoot, Transform dynamicContentRoot,
                              Collider selectionSurface, GameObject playerMarker,
                              GameObject selectionMarker, Transform cameraAnchor,
                              RoaGlobalMapPrefabSlot[] livePrefabs)
        {
            _staticContentRoot = staticContentRoot;
            _dynamicContentRoot = dynamicContentRoot;
            _selectionSurface = selectionSurface;
            _playerMarker = playerMarker;
            _selectionMarker = selectionMarker;
            _cameraAnchor = cameraAnchor;
            _livePrefabs = livePrefabs ?? Array.Empty<RoaGlobalMapPrefabSlot>();
            RebuildIndexes();
        }

        public void RebuildIndexes()
        {
            _nodes.Clear();
            RoaGlobalMapNodeAnchor[] anchors = GetComponentsInChildren<RoaGlobalMapNodeAnchor>(true);
            for (int i = 0; i < anchors.Length; i++)
            {
                RoaGlobalMapNodeAnchor anchor = anchors[i];
                if (anchor == null || string.IsNullOrWhiteSpace(anchor.NodeId)) continue;
                if (_nodes.ContainsKey(anchor.NodeId))
                {
                    Debug.LogWarning("[ROA] Duplicate global-map node id '" + anchor.NodeId
                                     + "' in authored scene.", anchor);
                    continue;
                }
                _nodes.Add(anchor.NodeId, anchor);
            }

            _prefabs.Clear();
            for (int i = 0; i < _livePrefabs.Length; i++)
            {
                RoaGlobalMapPrefabSlot slot = _livePrefabs[i];
                if (slot.Prefab != null && !_prefabs.ContainsKey(slot.Kind))
                    _prefabs.Add(slot.Kind, slot.Prefab);
            }
        }

        public bool TryGetNode(string nodeId, out RoaGlobalMapNodeAnchor anchor)
        {
            EnsureNodeIndex();
            anchor = null;
            return !string.IsNullOrWhiteSpace(nodeId)
                && _nodes.TryGetValue(nodeId, out anchor) && anchor != null;
        }

        public GameObject PrefabFor(RoaGlobalMapPrefabKind kind)
        {
            EnsurePrefabIndex();
            _prefabs.TryGetValue(kind, out GameObject prefab);
            return prefab;
        }

        public bool Validate(out string error)
        {
            if (_staticContentRoot == null) return Fail("не задан слой StaticContent", out error);
            if (_dynamicContentRoot == null) return Fail("не задан слой DynamicContent", out error);
            if (_selectionSurface == null) return Fail("не задан SelectionSurface", out error);
            if (_playerMarker == null) return Fail("не задан префаб игрока в сцене", out error);
            if (_selectionMarker == null) return Fail("не задан префаб выбранной точки", out error);
            if (_cameraAnchor == null) return Fail("не задан CameraAnchor", out error);

            EnsurePrefabIndex();
            foreach (RoaGlobalMapPrefabKind kind in Enum.GetValues(typeof(RoaGlobalMapPrefabKind)))
            {
                if (!_prefabs.TryGetValue(kind, out GameObject prefab) || prefab == null)
                    return Fail("не задан live-prefab " + kind, out error);
            }

            EnsureNodeIndex();
            if (_nodes.Count == 0) return Fail("нет ни одного RoaGlobalMapNodeAnchor", out error);
            error = null;
            return true;
        }

        public GameObject InstantiateLivePrefab(RoaGlobalMapPrefabKind kind, Transform parent)
        {
            EnsurePrefabIndex();
            if (!_prefabs.TryGetValue(kind, out GameObject prefab) || prefab == null) return null;

            if (!_pools.TryGetValue(kind, out Stack<GameObject> pool))
            {
                pool = new Stack<GameObject>();
                _pools.Add(kind, pool);
            }

            GameObject instance = null;
            while (pool.Count > 0 && instance == null) instance = pool.Pop();
            if (instance == null)
            {
                instance = Instantiate(prefab, parent != null ? parent : _dynamicContentRoot);
                _instanceKinds[instance] = kind;
            }
            else
            {
                instance.transform.SetParent(parent != null ? parent : _dynamicContentRoot, false);
                instance.transform.localPosition = prefab.transform.localPosition;
                instance.transform.localRotation = prefab.transform.localRotation;
                instance.transform.localScale = prefab.transform.localScale;
                instance.SetActive(true);
            }
            _activeInstances.Add(instance);
            return instance;
        }

        public void ReleaseLivePrefab(GameObject instance)
        {
            if (instance == null || !_activeInstances.Remove(instance)) return;
            if (!_instanceKinds.TryGetValue(instance, out RoaGlobalMapPrefabKind kind))
            {
                Destroy(instance);
                return;
            }
            if (!_pools.TryGetValue(kind, out Stack<GameObject> pool))
            {
                pool = new Stack<GameObject>();
                _pools.Add(kind, pool);
            }
            instance.SetActive(false);
            instance.transform.SetParent(_dynamicContentRoot, false);
            pool.Push(instance);
        }

        public void ClearDynamicContent()
        {
            _releaseBuffer.Clear();
            foreach (GameObject instance in _activeInstances)
                if (instance != null) _releaseBuffer.Add(instance);
            for (int i = 0; i < _releaseBuffer.Count; i++) ReleaseLivePrefab(_releaseBuffer[i]);
            _releaseBuffer.Clear();
        }

        private void EnsureNodeIndex()
        {
            if (_nodes.Count == 0) RebuildIndexes();
        }

        private void EnsurePrefabIndex()
        {
            if (_prefabs.Count == 0) RebuildIndexes();
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }
    }

    /// <summary>
    /// Stable ID for a location miniature placed by hand in GlobalMapAuthored.
    /// Move the visual children freely; keep the anchor aligned with server data.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaGlobalMapNodeAnchor : MonoBehaviour
    {
        [SerializeField] private string _nodeId = string.Empty;

        public string NodeId => _nodeId;

        public void Configure(string nodeId)
        {
            _nodeId = nodeId ?? string.Empty;
        }
    }
}
