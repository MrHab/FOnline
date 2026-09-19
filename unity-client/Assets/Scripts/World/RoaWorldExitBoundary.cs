using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Край места внутри зоны мира. Когда выход открыт, рисует золотую полосу:
    /// шаг в неё уводит в родительскую зону. Место, закрытое сюжетом, вместо
    /// полосы получает пунктирный непроходимый периметр по её внутренней кромке.
    /// </summary>
    public sealed class RoaWorldExitBoundary : MonoBehaviour
    {
        public const int ExitBandTileCount = 2;
        public const float ApproachDistance = 12f;

        private const float ArrowSpacing = 7.5f;
        private const float BeaconSpacing = 17f;
        private const float LockedDashLength = 1.35f;
        private const float LockedDashGap = 0.85f;
        private static readonly Color ExitGold = new Color(1f, 0.69f, 0.18f, 1f);
        private static readonly Color LockedAmber = new Color(1f, 0.37f, 0.11f, 1f);

        private readonly List<LineRenderer> _beacons = new List<LineRenderer>(24);
        private GameObject _visualRoot;
        private GameObject _lockedRoot;
        private Mesh _bandMesh;
        private Mesh _arrowMesh;
        private Mesh _lockedDashMesh;
        private Material _bandMaterial;
        private Material _accentMaterial;
        private Material _lockedMaterial;
        private LineRenderer _threshold;
        private Transform _player;
        private int _mapWidth;
        private int _mapDepth;
        private float _halfWidth;
        private float _halfDepth;
        private float _distanceToEdge = float.MaxValue;
        private float _nextPlayerLookupAt;
        private bool _exitAllowed = true;

        public int MapWidth { get { return _mapWidth; } }
        public int MapDepth { get { return _mapDepth; } }
        public int BeaconCount { get { return _beacons.Count; } }
        public int LockedColliderCount
        {
            get { return _lockedRoot != null ? _lockedRoot.GetComponentsInChildren<BoxCollider>(true).Length : 0; }
        }
        public float ExitBandWidth { get { return ExitBandTileCount * RoaCoords.Tile; } }
        public bool PlayerIsApproaching { get { return _distanceToEdge <= ApproachDistance; } }

        public void Configure(int mapWidth, int mapDepth)
        {
            mapWidth = Mathf.Max(1, mapWidth);
            mapDepth = Mathf.Max(1, mapDepth);
            if (_visualRoot != null && _mapWidth == mapWidth && _mapDepth == mapDepth) return;

            ReleaseVisuals();
            _mapWidth = mapWidth;
            _mapDepth = mapDepth;
            _halfWidth = mapWidth * RoaCoords.Tile * 0.5f;
            _halfDepth = mapDepth * RoaCoords.Tile * 0.5f;

            _visualRoot = new GameObject("PlaceExitBoundary");
            _visualRoot.transform.SetParent(transform, false);
            _bandMaterial = CreateTransparentMaterial("PlaceExitBandMaterial", 0.18f, 3015);
            _accentMaterial = CreateTransparentMaterial("PlaceExitAccentMaterial", 0.82f, 3020);

            BuildBand();
            BuildThreshold();
            BuildArrows();
            BuildBeacons();
            BuildLockedBoundary();
        }

        public static bool IsInExitBand(Vector3 worldPosition, int mapWidth, int mapDepth)
        {
            if (mapWidth <= 0 || mapDepth <= 0) return false;
            RoaCoords.WorldToTile(worldPosition, mapWidth, mapDepth, out int tx, out int tz);
            int innerOffset = ExitBandTileCount - 1;
            return tx <= innerOffset || tz <= innerOffset
                || tx >= mapWidth - 1 - innerOffset || tz >= mapDepth - 1 - innerOffset;
        }

        public static float DistanceToMapEdge(Vector3 worldPosition, int mapWidth, int mapDepth)
        {
            if (mapWidth <= 0 || mapDepth <= 0) return float.MaxValue;
            float halfWidth = mapWidth * RoaCoords.Tile * 0.5f;
            float halfDepth = mapDepth * RoaCoords.Tile * 0.5f;
            return Mathf.Min(halfWidth - Mathf.Abs(worldPosition.x),
                halfDepth - Mathf.Abs(worldPosition.z));
        }

        private void BuildBand()
        {
            float band = ExitBandWidth;
            float innerWidth = Mathf.Max(0.1f, _halfWidth - band);
            float innerDepth = Mathf.Max(0.1f, _halfDepth - band);
            var vertices = new List<Vector3>(16);
            var triangles = new List<int>(24);
            const float y = 0.075f;

            AddHorizontalQuad(vertices, triangles,
                new Vector3(-_halfWidth, y, -_halfDepth), new Vector3(-_halfWidth, y, _halfDepth),
                new Vector3(-innerWidth, y, _halfDepth), new Vector3(-innerWidth, y, -_halfDepth));
            AddHorizontalQuad(vertices, triangles,
                new Vector3(innerWidth, y, -_halfDepth), new Vector3(innerWidth, y, _halfDepth),
                new Vector3(_halfWidth, y, _halfDepth), new Vector3(_halfWidth, y, -_halfDepth));
            AddHorizontalQuad(vertices, triangles,
                new Vector3(-innerWidth, y, -_halfDepth), new Vector3(-innerWidth, y, -innerDepth),
                new Vector3(innerWidth, y, -innerDepth), new Vector3(innerWidth, y, -_halfDepth));
            AddHorizontalQuad(vertices, triangles,
                new Vector3(-innerWidth, y, innerDepth), new Vector3(-innerWidth, y, _halfDepth),
                new Vector3(innerWidth, y, _halfDepth), new Vector3(innerWidth, y, innerDepth));

            _bandMesh = new Mesh { name = "PlaceExitBandMesh" };
            _bandMesh.SetVertices(vertices);
            _bandMesh.SetTriangles(triangles, 0);
            _bandMesh.RecalculateNormals();
            _bandMesh.RecalculateBounds();
            CreateMeshNode("ExitBand", _bandMesh, _bandMaterial, 0);
        }

        private void BuildThreshold()
        {
            float innerWidth = Mathf.Max(0.1f, _halfWidth - ExitBandWidth);
            float innerDepth = Mathf.Max(0.1f, _halfDepth - ExitBandWidth);
            var lineObject = new GameObject("ExitThresholdLine");
            lineObject.transform.SetParent(_visualRoot.transform, false);
            _threshold = lineObject.AddComponent<LineRenderer>();
            _threshold.useWorldSpace = false;
            _threshold.loop = true;
            _threshold.positionCount = 4;
            _threshold.startWidth = 0.16f;
            _threshold.endWidth = 0.16f;
            _threshold.numCornerVertices = 2;
            _threshold.sharedMaterial = _accentMaterial;
            _threshold.shadowCastingMode = ShadowCastingMode.Off;
            _threshold.receiveShadows = false;
            _threshold.SetPosition(0, new Vector3(-innerWidth, 0.13f, -innerDepth));
            _threshold.SetPosition(1, new Vector3(-innerWidth, 0.13f, innerDepth));
            _threshold.SetPosition(2, new Vector3(innerWidth, 0.13f, innerDepth));
            _threshold.SetPosition(3, new Vector3(innerWidth, 0.13f, -innerDepth));
        }

        private void BuildArrows()
        {
            float band = ExitBandWidth;
            float innerWidth = Mathf.Max(0.1f, _halfWidth - band);
            float innerDepth = Mathf.Max(0.1f, _halfDepth - band);
            float x = innerWidth + band * 0.5f;
            float z = innerDepth + band * 0.5f;
            var vertices = new List<Vector3>(256);
            var triangles = new List<int>(384);

            AddArrowRow(vertices, triangles, new Vector3(-x, 0f, 0f), Vector3.left,
                Vector3.forward, innerDepth * 2f);
            AddArrowRow(vertices, triangles, new Vector3(x, 0f, 0f), Vector3.right,
                Vector3.forward, innerDepth * 2f);
            AddArrowRow(vertices, triangles, new Vector3(0f, 0f, -z), Vector3.back,
                Vector3.right, innerWidth * 2f);
            AddArrowRow(vertices, triangles, new Vector3(0f, 0f, z), Vector3.forward,
                Vector3.right, innerWidth * 2f);

            _arrowMesh = new Mesh { name = "PlaceExitArrowMesh" };
            _arrowMesh.SetVertices(vertices);
            _arrowMesh.SetTriangles(triangles, 0);
            _arrowMesh.RecalculateNormals();
            _arrowMesh.RecalculateBounds();
            CreateMeshNode("OutwardExitArrows", _arrowMesh, _accentMaterial, 1);
        }

        private void AddArrowRow(List<Vector3> vertices, List<int> triangles,
            Vector3 rowCenter, Vector3 outward, Vector3 rowAxis, float span)
        {
            float usable = Mathf.Max(0f, span - 5f);
            int count = Mathf.Max(1, Mathf.FloorToInt(usable / ArrowSpacing) + 1);
            for (int index = 0; index < count; index++)
            {
                float offset = count == 1 ? 0f : Mathf.Lerp(-usable * 0.5f, usable * 0.5f,
                    index / (float)(count - 1));
                AddChevron(vertices, triangles, rowCenter + rowAxis * offset, outward);
            }
        }

        private static void AddChevron(List<Vector3> vertices, List<int> triangles,
            Vector3 center, Vector3 outward)
        {
            Vector3 across = Vector3.Cross(Vector3.up, outward).normalized;
            Vector3 tip = center + outward * 0.92f + Vector3.up * 0.145f;
            Vector3 shoulder = center - outward * 0.48f + Vector3.up * 0.145f;
            AddRibbon(vertices, triangles, shoulder + across * 0.62f, tip, 0.17f);
            AddRibbon(vertices, triangles, shoulder - across * 0.62f, tip, 0.17f);
        }

        private void BuildBeacons()
        {
            float innerWidth = Mathf.Max(0.1f, _halfWidth - ExitBandWidth);
            float innerDepth = Mathf.Max(0.1f, _halfDepth - ExitBandWidth);
            AddBeaconRow(new Vector3(-innerWidth, 0f, 0f), Vector3.forward, innerDepth * 2f);
            AddBeaconRow(new Vector3(innerWidth, 0f, 0f), Vector3.forward, innerDepth * 2f);
            AddBeaconRow(new Vector3(0f, 0f, -innerDepth), Vector3.right, innerWidth * 2f);
            AddBeaconRow(new Vector3(0f, 0f, innerDepth), Vector3.right, innerWidth * 2f);
        }

        private void BuildLockedBoundary()
        {
            float innerWidth = Mathf.Max(0.5f, _halfWidth - ExitBandWidth);
            float innerDepth = Mathf.Max(0.5f, _halfDepth - ExitBandWidth);
            _lockedRoot = new GameObject("ClosedLocationBoundary");
            _lockedRoot.transform.SetParent(transform, false);
            _lockedMaterial = CreateTransparentMaterial("ClosedLocationBoundaryMaterial", 0.9f, 3025);
            ApplyMaterialColor(_lockedMaterial, new Color(LockedAmber.r, LockedAmber.g, LockedAmber.b, 0.9f));

            var vertices = new List<Vector3>(512);
            var triangles = new List<int>(768);
            AddDashedRow(vertices, triangles, new Vector3(-innerWidth, 0.16f, 0f),
                Vector3.forward, innerDepth * 2f);
            AddDashedRow(vertices, triangles, new Vector3(innerWidth, 0.16f, 0f),
                Vector3.forward, innerDepth * 2f);
            AddDashedRow(vertices, triangles, new Vector3(0f, 0.16f, -innerDepth),
                Vector3.right, innerWidth * 2f);
            AddDashedRow(vertices, triangles, new Vector3(0f, 0.16f, innerDepth),
                Vector3.right, innerWidth * 2f);

            _lockedDashMesh = new Mesh { name = "ClosedLocationDashedPerimeterMesh" };
            _lockedDashMesh.SetVertices(vertices);
            _lockedDashMesh.SetTriangles(triangles, 0);
            _lockedDashMesh.RecalculateNormals();
            _lockedDashMesh.RecalculateBounds();
            CreateMeshNode("LockedDashedPerimeter", _lockedDashMesh, _lockedMaterial, 2,
                _lockedRoot.transform);

            AddLockedCollider("ClosedBoundaryWest", new Vector3(-innerWidth, 2f, 0f),
                new Vector3(0.32f, 4f, innerDepth * 2f + 0.32f));
            AddLockedCollider("ClosedBoundaryEast", new Vector3(innerWidth, 2f, 0f),
                new Vector3(0.32f, 4f, innerDepth * 2f + 0.32f));
            AddLockedCollider("ClosedBoundarySouth", new Vector3(0f, 2f, -innerDepth),
                new Vector3(innerWidth * 2f + 0.32f, 4f, 0.32f));
            AddLockedCollider("ClosedBoundaryNorth", new Vector3(0f, 2f, innerDepth),
                new Vector3(innerWidth * 2f + 0.32f, 4f, 0.32f));
            _lockedRoot.SetActive(false);
        }

        private static void AddDashedRow(List<Vector3> vertices, List<int> triangles,
            Vector3 rowCenter, Vector3 rowAxis, float span)
        {
            float step = LockedDashLength + LockedDashGap;
            int count = Mathf.Max(1, Mathf.FloorToInt((span + LockedDashGap) / step));
            float used = (count - 1) * step;
            for (int index = 0; index < count; index++)
            {
                float offset = index * step - used * 0.5f;
                Vector3 center = rowCenter + rowAxis * offset;
                AddRibbon(vertices, triangles,
                    center - rowAxis * (LockedDashLength * 0.5f),
                    center + rowAxis * (LockedDashLength * 0.5f), 0.22f);
            }
        }

        private void AddLockedCollider(string objectName, Vector3 center, Vector3 size)
        {
            var node = new GameObject(objectName);
            node.transform.SetParent(_lockedRoot.transform, false);
            node.transform.localPosition = center;
            var collider = node.AddComponent<BoxCollider>();
            collider.size = size;
        }

        private void AddBeaconRow(Vector3 rowCenter, Vector3 rowAxis, float span)
        {
            float usable = Mathf.Max(0f, span - 8f);
            int count = Mathf.Max(1, Mathf.FloorToInt(usable / BeaconSpacing) + 1);
            for (int index = 0; index < count; index++)
            {
                float offset = count == 1 ? 0f : Mathf.Lerp(-usable * 0.5f, usable * 0.5f,
                    index / (float)(count - 1));
                var beaconObject = new GameObject("ExitGuideBeacon");
                beaconObject.transform.SetParent(_visualRoot.transform, false);
                var beacon = beaconObject.AddComponent<LineRenderer>();
                beacon.useWorldSpace = false;
                beacon.positionCount = 2;
                beacon.startWidth = 0.085f;
                beacon.endWidth = 0.025f;
                beacon.numCapVertices = 2;
                beacon.sharedMaterial = _accentMaterial;
                beacon.shadowCastingMode = ShadowCastingMode.Off;
                beacon.receiveShadows = false;
                Vector3 foot = rowCenter + rowAxis * offset;
                beacon.SetPosition(0, foot + Vector3.up * 0.12f);
                beacon.SetPosition(1, foot + Vector3.up * 2.25f);
                _beacons.Add(beacon);
            }
        }

        private void Update()
        {
            if (_mapWidth <= 0 || _mapDepth <= 0) return;
            RoaGameBootstrap bootstrap = RoaGameBootstrap.Active;
            _exitAllowed = bootstrap == null || bootstrap.CurrentLocationHasEdgeExit;
            if (_visualRoot != null && _visualRoot.activeSelf != _exitAllowed)
                _visualRoot.SetActive(_exitAllowed);
            if (_lockedRoot != null && _lockedRoot.activeSelf == _exitAllowed)
                _lockedRoot.SetActive(!_exitAllowed);
            if (_player == null && Time.unscaledTime >= _nextPlayerLookupAt)
            {
                _nextPlayerLookupAt = Time.unscaledTime + 0.5f;
                _player = bootstrap != null && bootstrap.PlayerView != null
                    ? bootstrap.PlayerView.transform
                    : null;
            }

            _distanceToEdge = _player != null
                ? DistanceToMapEdge(_player.position, _mapWidth, _mapDepth)
                : float.MaxValue;
            float proximity = Mathf.InverseLerp(ApproachDistance, ExitBandWidth, _distanceToEdge);
            float wave = (Mathf.Sin(Time.unscaledTime * 2.4f) + 1f) * 0.5f;
            if (!_exitAllowed)
            {
                ApplyMaterialColor(_lockedMaterial, new Color(LockedAmber.r, LockedAmber.g, LockedAmber.b,
                    0.68f + proximity * 0.2f + wave * 0.08f));
                return;
            }
            ApplyMaterialColor(_bandMaterial, new Color(ExitGold.r, ExitGold.g, ExitGold.b,
                0.15f + proximity * 0.13f + wave * 0.025f));
            Color accent = new Color(ExitGold.r, ExitGold.g, ExitGold.b,
                0.68f + proximity * 0.22f + wave * 0.08f);
            ApplyMaterialColor(_accentMaterial, accent);

            if (_threshold != null)
            {
                float width = 0.14f + proximity * 0.08f + wave * 0.025f;
                _threshold.startWidth = width;
                _threshold.endWidth = width;
                _threshold.startColor = accent;
                _threshold.endColor = accent;
            }
            for (int index = 0; index < _beacons.Count; index++)
            {
                LineRenderer beacon = _beacons[index];
                if (beacon == null) continue;
                beacon.startColor = accent;
                beacon.endColor = new Color(accent.r, accent.g, accent.b, accent.a * 0.08f);
            }
        }

        private void OnGUI()
        {
            bool approaching = _exitAllowed
                ? PlayerIsApproaching
                : _distanceToEdge <= ExitBandWidth + 3f;
            if (!approaching || RoaGameBootstrap.BlocksWorldHud) return;
            RoaUiTheme.Apply();
            bool mobile = Application.isMobilePlatform;
            float width = Mathf.Clamp(Screen.width * (mobile ? 0.54f : 0.36f), 310f, 500f);
            float height = mobile ? 58f : 64f;
            Rect panel = new Rect((Screen.width - width) * 0.5f, Mathf.Max(12f, Screen.height * 0.085f),
                width, height);
            GUI.depth = -30;
            GUI.Box(panel, GUIContent.none);

            var title = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontStyle = FontStyle.Bold,
                fontSize = mobile ? 14 : 16
            };
            title.normal.textColor = ExitGold;
            var detail = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize = mobile ? 11 : 12
            };
            detail.normal.textColor = new Color(0.92f, 0.88f, 0.75f, 0.92f);
            if (!_exitAllowed)
            {
                title.normal.textColor = LockedAmber;
                GUI.Label(new Rect(panel.x + 12f, panel.y + 6f, panel.width - 24f, 24f),
                    "ГРАНИЦА ЛОКАЦИИ", title);
                GUI.Label(new Rect(panel.x + 12f, panel.y + 31f, panel.width - 24f, 22f),
                    "Выход закрыт до завершения задания", detail);
                return;
            }
            ParentZoneInfo zone = RoaGameBootstrap.Active?.Loader?.Current?.ParentZone;
            string zoneName = zone != null && !string.IsNullOrEmpty(zone.Title) ? zone.Title : "зона мира";
            GUI.Label(new Rect(panel.x + 12f, panel.y + 6f, panel.width - 24f, 24f),
                "ВЫХОД: " + zoneName.ToUpperInvariant(), title);
            float metres = Mathf.Max(0f, _distanceToEdge - ExitBandWidth);
            string copy = _distanceToEdge <= ExitBandWidth + 0.25f
                ? "Переход в зону..."
                : "Пересеките золотую полосу  •  " + Mathf.CeilToInt(metres) + " м";
            GUI.Label(new Rect(panel.x + 12f, panel.y + 31f, panel.width - 24f, 22f), copy, detail);
        }

        private void CreateMeshNode(string objectName, Mesh mesh, Material material, int sortingOrder)
        {
            CreateMeshNode(objectName, mesh, material, sortingOrder, _visualRoot.transform);
        }

        private static void CreateMeshNode(string objectName, Mesh mesh, Material material,
            int sortingOrder, Transform parent)
        {
            var node = new GameObject(objectName);
            node.transform.SetParent(parent, false);
            node.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = node.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.sortingOrder = sortingOrder;
        }

        private static Material CreateTransparentMaterial(string materialName, float alpha, int queue)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Sprites/Default")
                ?? Shader.Find("Unlit/Color");
            if (shader == null) return null;
            var material = new Material(shader) { name = materialName };
            ApplyMaterialColor(material, new Color(ExitGold.r, ExitGold.g, ExitGold.b, alpha));
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.renderQueue = queue;
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            return material;
        }

        private static void ApplyMaterialColor(Material material, Color color)
        {
            if (material == null) return;
            material.color = color;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        }

        private static void AddHorizontalQuad(List<Vector3> vertices, List<int> triangles,
            Vector3 a, Vector3 b, Vector3 c, Vector3 d)
        {
            int first = vertices.Count;
            vertices.Add(a);
            vertices.Add(b);
            vertices.Add(c);
            vertices.Add(d);
            triangles.Add(first);
            triangles.Add(first + 1);
            triangles.Add(first + 2);
            triangles.Add(first);
            triangles.Add(first + 2);
            triangles.Add(first + 3);
        }

        private static void AddRibbon(List<Vector3> vertices, List<int> triangles,
            Vector3 from, Vector3 to, float width)
        {
            Vector3 direction = (to - from).normalized;
            Vector3 side = Vector3.Cross(Vector3.up, direction) * (width * 0.5f);
            AddHorizontalQuad(vertices, triangles, from - side, to - side, to + side, from + side);
        }

        private void OnDestroy()
        {
            ReleaseVisuals();
        }

        private void ReleaseVisuals()
        {
            _beacons.Clear();
            _threshold = null;
            DestroyRuntime(_visualRoot);
            DestroyRuntime(_lockedRoot);
            DestroyRuntime(_bandMesh);
            DestroyRuntime(_arrowMesh);
            DestroyRuntime(_lockedDashMesh);
            DestroyRuntime(_bandMaterial);
            DestroyRuntime(_accentMaterial);
            DestroyRuntime(_lockedMaterial);
            _visualRoot = null;
            _lockedRoot = null;
            _bandMesh = null;
            _arrowMesh = null;
            _lockedDashMesh = null;
            _bandMaterial = null;
            _accentMaterial = null;
            _lockedMaterial = null;
        }

        private static void DestroyRuntime(Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
