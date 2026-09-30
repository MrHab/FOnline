using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Край локации. У места внутри зоны — золотая полоса по всему краю: шаг в неё
    /// уводит в родительскую зону; место, закрытое сюжетом, вместо полосы получает
    /// пунктирный непроходимый периметр. У зоны и города край задан по сторонам
    /// (ConfigureSides): сторона, открытая в соседнюю зону, — сплошная полоса
    /// перехода, прочие — пунктирная граница (в город ведёт портал, из города —
    /// порталы у ворот).
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
        private float _distanceToClosed = float.MaxValue;
        private float _nextPlayerLookupAt;
        private bool _exitAllowed = true;

        // Стороны: 0 — север (+z, старшие tz), 1 — восток (+x), 2 — юг (−z), 3 — запад (−x), как у компаса.
        private static readonly string[] SideNames = { "north", "east", "south", "west" };
        private readonly bool[] _open = { true, true, true, true };
        private readonly string[] _labels = new string[4];
        private bool _sidesDriven;
        private int _nearestOpenSide = -1;
        private string _closedTitle = string.Empty;
        private string _closedDetail = string.Empty;
        private GameObject _edgeStopRoot;

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
            if (_visualRoot != null && !_sidesDriven && _mapWidth == mapWidth && _mapDepth == mapDepth) return;
            _sidesDriven = false;
            for (int side = 0; side < 4; side++) { _open[side] = true; _labels[side] = string.Empty; }
            Build(mapWidth, mapDepth);
        }

        /// <summary>
        /// Край зоны или города по сторонам: `open[side]` — полоса перехода в соседнюю
        /// зону (подпись — `labels[side]`), закрытая сторона — пунктир и упор.
        /// Порядок сторон: север, восток, юг, запад.
        /// </summary>
        public void ConfigureSides(int mapWidth, int mapDepth, bool[] open, string[] labels, string closedTitle, string closedDetail)
        {
            _sidesDriven = true;
            for (int side = 0; side < 4; side++)
            {
                _open[side] = open != null && side < open.Length && open[side];
                _labels[side] = labels != null && side < labels.Length ? labels[side] ?? string.Empty : string.Empty;
            }
            _closedTitle = closedTitle ?? string.Empty;
            _closedDetail = closedDetail ?? string.Empty;
            Build(Mathf.Max(1, mapWidth), Mathf.Max(1, mapDepth));
        }

        public bool SideOpen(string side)
        {
            int index = System.Array.IndexOf(SideNames, side);
            return index >= 0 && _open[index];
        }

        private void Build(int mapWidth, int mapDepth)
        {
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
            BuildEdgeStops();
        }

        /// <summary>
        /// Игрок в полосе перехода стороны `side` («north» — старшие tz, +z). Та же ширина,
        /// что у края места: крайняя клетка и клетка запаса.
        /// </summary>
        public static bool IsInSideBand(Vector3 worldPosition, int mapWidth, int mapDepth, string side)
        {
            if (mapWidth <= 0 || mapDepth <= 0) return false;
            RoaCoords.WorldToTile(worldPosition, mapWidth, mapDepth, out int tx, out int tz);
            int innerOffset = ExitBandTileCount - 1;
            switch (side)
            {
                case "north": return tz >= mapDepth - 1 - innerOffset;
                case "south": return tz <= innerOffset;
                case "west": return tx <= innerOffset;
                case "east": return tx >= mapWidth - 1 - innerOffset;
                default: return false;
            }
        }

        // Наружная нормаль стороны, её ось вдоль и расстояние от центра до края.
        private Vector3 Outward(int side)
        {
            return side == 0 ? Vector3.forward : side == 1 ? Vector3.right : side == 2 ? Vector3.back : Vector3.left;
        }

        private Vector3 Along(int side) { return side == 0 || side == 2 ? Vector3.right : Vector3.forward; }

        private float HalfAcross(int side) { return side == 0 || side == 2 ? _halfDepth : _halfWidth; }

        private float HalfAlong(int side) { return side == 0 || side == 2 ? _halfWidth : _halfDepth; }

        /// <summary>Сторона рисуется полосой: у места — все, у зоны — открытые в соседа.</summary>
        private bool StripSide(int side) { return !_sidesDriven || _open[side]; }

        /// <summary>Сторона рисуется пунктиром: у места — все (включаются сюжетом), у зоны — закрытые.</summary>
        private bool LockedSide(int side) { return !_sidesDriven || !_open[side]; }

        private float DistanceToSide(Vector3 position, int side)
        {
            switch (side)
            {
                case 0: return _halfDepth - position.z;
                case 1: return _halfWidth - position.x;
                case 2: return position.z + _halfDepth;
                default: return position.x + _halfWidth;
            }
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
            var vertices = new List<Vector3>(16);
            var triangles = new List<int>(24);
            const float y = 0.075f;

            for (int side = 0; side < 4; side++)
            {
                if (!StripSide(side)) continue;
                Vector3 outward = Outward(side), along = Along(side);
                Vector3 edge = outward * HalfAcross(side) + Vector3.up * y;
                Vector3 inner = edge - outward * band;
                // У места северная и южная полосы идут между боковыми, чтобы углы не
                // светились дважды; у зоны каждая открытая сторона — во всю длину.
                bool shortened = !_sidesDriven && (side == 0 || side == 2);
                float halfSpan = shortened ? Mathf.Max(0.1f, HalfAlong(side) - band) : HalfAlong(side);
                AddHorizontalQuad(vertices, triangles,
                    edge - along * halfSpan, inner - along * halfSpan, inner + along * halfSpan, edge + along * halfSpan);
            }

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
            if (!_sidesDriven)
            {
                _threshold = CreateThresholdLine(true, new[]
                {
                    new Vector3(-innerWidth, 0.13f, -innerDepth), new Vector3(-innerWidth, 0.13f, innerDepth),
                    new Vector3(innerWidth, 0.13f, innerDepth), new Vector3(innerWidth, 0.13f, -innerDepth)
                });
                return;
            }
            for (int side = 0; side < 4; side++)
            {
                if (!_open[side]) continue;
                Vector3 inner = Outward(side) * (HalfAcross(side) - ExitBandWidth) + Vector3.up * 0.13f;
                Vector3 along = Along(side) * HalfAlong(side);
                _thresholds.Add(CreateThresholdLine(false, new[] { inner - along, inner + along }));
            }
        }

        private readonly List<LineRenderer> _thresholds = new List<LineRenderer>(4);

        private LineRenderer CreateThresholdLine(bool loop, Vector3[] points)
        {
            var lineObject = new GameObject("ExitThresholdLine");
            lineObject.transform.SetParent(_visualRoot.transform, false);
            LineRenderer line = lineObject.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.loop = loop;
            line.positionCount = points.Length;
            line.startWidth = 0.16f;
            line.endWidth = 0.16f;
            line.numCornerVertices = 2;
            line.sharedMaterial = _accentMaterial;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            line.SetPositions(points);
            return line;
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

            if (StripSide(3)) AddArrowRow(vertices, triangles, new Vector3(-x, 0f, 0f), Vector3.left,
                Vector3.forward, innerDepth * 2f);
            if (StripSide(1)) AddArrowRow(vertices, triangles, new Vector3(x, 0f, 0f), Vector3.right,
                Vector3.forward, innerDepth * 2f);
            if (StripSide(0)) AddArrowRow(vertices, triangles, new Vector3(0f, 0f, z), Vector3.forward,
                Vector3.right, innerWidth * 2f);
            if (StripSide(2)) AddArrowRow(vertices, triangles, new Vector3(0f, 0f, -z), Vector3.back,
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
            if (StripSide(3)) AddBeaconRow(new Vector3(-innerWidth, 0f, 0f), Vector3.forward, innerDepth * 2f);
            if (StripSide(1)) AddBeaconRow(new Vector3(innerWidth, 0f, 0f), Vector3.forward, innerDepth * 2f);
            if (StripSide(0)) AddBeaconRow(new Vector3(0f, 0f, innerDepth), Vector3.right, innerWidth * 2f);
            if (StripSide(2)) AddBeaconRow(new Vector3(0f, 0f, -innerDepth), Vector3.right, innerWidth * 2f);
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
            if (LockedSide(3)) AddDashedRow(vertices, triangles, new Vector3(-innerWidth, 0.16f, 0f),
                Vector3.forward, innerDepth * 2f);
            if (LockedSide(1)) AddDashedRow(vertices, triangles, new Vector3(innerWidth, 0.16f, 0f),
                Vector3.forward, innerDepth * 2f);
            if (LockedSide(0)) AddDashedRow(vertices, triangles, new Vector3(0f, 0.16f, innerDepth),
                Vector3.right, innerWidth * 2f);
            if (LockedSide(2)) AddDashedRow(vertices, triangles, new Vector3(0f, 0.16f, -innerDepth),
                Vector3.right, innerWidth * 2f);

            _lockedDashMesh = new Mesh { name = "ClosedLocationDashedPerimeterMesh" };
            _lockedDashMesh.SetVertices(vertices);
            _lockedDashMesh.SetTriangles(triangles, 0);
            _lockedDashMesh.RecalculateNormals();
            _lockedDashMesh.RecalculateBounds();
            CreateMeshNode("LockedDashedPerimeter", _lockedDashMesh, _lockedMaterial, 2,
                _lockedRoot.transform);

            if (LockedSide(3)) AddLockedCollider(_lockedRoot, "ClosedBoundaryWest", new Vector3(-innerWidth, 2f, 0f),
                new Vector3(0.32f, 4f, innerDepth * 2f + 0.32f));
            if (LockedSide(1)) AddLockedCollider(_lockedRoot, "ClosedBoundaryEast", new Vector3(innerWidth, 2f, 0f),
                new Vector3(0.32f, 4f, innerDepth * 2f + 0.32f));
            if (LockedSide(0)) AddLockedCollider(_lockedRoot, "ClosedBoundaryNorth", new Vector3(0f, 2f, innerDepth),
                new Vector3(innerWidth * 2f + 0.32f, 4f, 0.32f));
            if (LockedSide(2)) AddLockedCollider(_lockedRoot, "ClosedBoundarySouth", new Vector3(0f, 2f, -innerDepth),
                new Vector3(innerWidth * 2f + 0.32f, 4f, 0.32f));
            // У зоны закрытые стороны закрыты всегда, у места — пока сюжет держит.
            _lockedRoot.SetActive(_sidesDriven);
        }

        /// <summary>
        /// Упор за открытой стороной зоны: пока сервер переводит в соседнюю зону,
        /// игрок не уходит за край карты. Невидим.
        /// </summary>
        private void BuildEdgeStops()
        {
            if (!_sidesDriven) return;
            _edgeStopRoot = new GameObject("EdgeStripStops");
            _edgeStopRoot.transform.SetParent(transform, false);
            for (int side = 0; side < 4; side++)
            {
                if (!_open[side]) continue;
                Vector3 centre = Outward(side) * (HalfAcross(side) + 0.2f) + Vector3.up * 2f;
                Vector3 size = side == 0 || side == 2
                    ? new Vector3(_halfWidth * 2f + 0.4f, 4f, 0.4f)
                    : new Vector3(0.4f, 4f, _halfDepth * 2f + 0.4f);
                AddLockedCollider(_edgeStopRoot, "EdgeStop_" + SideNames[side], centre, size);
            }
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

        private static void AddLockedCollider(GameObject root, string objectName, Vector3 center, Vector3 size)
        {
            var node = new GameObject(objectName);
            node.transform.SetParent(root.transform, false);
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
            if (!_sidesDriven)
            {
                _exitAllowed = bootstrap == null || bootstrap.CurrentLocationHasEdgeExit;
                if (_visualRoot != null && _visualRoot.activeSelf != _exitAllowed)
                    _visualRoot.SetActive(_exitAllowed);
                if (_lockedRoot != null && _lockedRoot.activeSelf == _exitAllowed)
                    _lockedRoot.SetActive(!_exitAllowed);
            }
            if (_player == null && Time.unscaledTime >= _nextPlayerLookupAt)
            {
                _nextPlayerLookupAt = Time.unscaledTime + 0.5f;
                _player = bootstrap != null && bootstrap.PlayerView != null
                    ? bootstrap.PlayerView.transform
                    : null;
            }

            if (_sidesDriven) MeasureSides();
            else
                _distanceToEdge = _player != null
                    ? DistanceToMapEdge(_player.position, _mapWidth, _mapDepth)
                    : float.MaxValue;
            float proximity = Mathf.InverseLerp(ApproachDistance, ExitBandWidth, _distanceToEdge);
            float wave = (Mathf.Sin(Time.unscaledTime * 2.4f) + 1f) * 0.5f;
            if (_sidesDriven)
            {
                float lockedNear = Mathf.InverseLerp(ApproachDistance, ExitBandWidth, _distanceToClosed);
                ApplyMaterialColor(_lockedMaterial, new Color(LockedAmber.r, LockedAmber.g, LockedAmber.b,
                    0.5f + lockedNear * 0.35f + wave * 0.06f));
            }
            else if (!_exitAllowed)
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

            float thresholdWidth = 0.14f + proximity * 0.08f + wave * 0.025f;
            if (_threshold != null) PaintThreshold(_threshold, thresholdWidth, accent);
            foreach (LineRenderer line in _thresholds) PaintThreshold(line, thresholdWidth, accent);
            for (int index = 0; index < _beacons.Count; index++)
            {
                LineRenderer beacon = _beacons[index];
                if (beacon == null) continue;
                beacon.startColor = accent;
                beacon.endColor = new Color(accent.r, accent.g, accent.b, accent.a * 0.08f);
            }
        }

        private static void PaintThreshold(LineRenderer line, float width, Color color)
        {
            if (line == null) return;
            line.startWidth = width;
            line.endWidth = width;
            line.startColor = color;
            line.endColor = color;
        }

        /// <summary>Расстояние до ближайшей открытой и ближайшей закрытой стороны зоны.</summary>
        private void MeasureSides()
        {
            _distanceToEdge = float.MaxValue;
            _distanceToClosed = float.MaxValue;
            _nearestOpenSide = -1;
            if (_player == null) return;
            for (int side = 0; side < 4; side++)
            {
                float distance = DistanceToSide(_player.position, side);
                if (!_open[side]) { _distanceToClosed = Mathf.Min(_distanceToClosed, distance); continue; }
                if (distance < _distanceToEdge) { _distanceToEdge = distance; _nearestOpenSide = side; }
            }
        }

        /// <summary>Граница загруженной локации.</summary>
        public static RoaWorldExitBoundary Current { get; private set; }

        /// <summary>Канва рисует баннер сама; IMGUI-вариант молчит.</summary>
        public bool BannerCanvasDriven { get; set; }

        private void OnEnable()
        {
            Current = this;
            // Границу ставит загрузчик локации, а баннер рисует HUD-канва: пока она
            // есть, IMGUI-вариант молчит — в WebGL у него нет кириллицы.
            BannerCanvasDriven = RoaGameBootstrap.Active?.HudCanvas != null;
        }

        private void OnDisable() { if (Current == this) Current = null; }

        /// <summary>
        /// Подсказка у края локации для HUD: выход в зону мира или граница,
        /// закрытая до конца задания. false — игрок ещё далеко от края.
        /// </summary>
        public bool TryGetBanner(out string title, out string detail, out bool locked)
        {
            title = detail = string.Empty;
            if (_sidesDriven) return TryGetSideBanner(out title, out detail, out locked);
            locked = !_exitAllowed;
            bool near = _exitAllowed ? PlayerIsApproaching : _distanceToEdge <= ExitBandWidth + 3f;
            if (!near) return false;
            if (locked)
            {
                title = "ГРАНИЦА ЛОКАЦИИ";
                detail = "Выход закрыт до завершения задания";
                return true;
            }
            ParentZoneInfo zone = RoaGameBootstrap.Active?.Loader?.Current?.ExitZone;
            string zoneName = zone != null && !string.IsNullOrEmpty(zone.Title) ? zone.Title : "зона мира";
            title = "ВЫХОД: " + zoneName.ToUpperInvariant();
            float remaining = Mathf.Max(0f, _distanceToEdge - ExitBandWidth);
            detail = _distanceToEdge <= ExitBandWidth + 0.25f
                ? "Переход в зону..."
                : "Пересеките золотую полосу  •  " + Mathf.CeilToInt(remaining) + " м";
            return true;
        }

        /// <summary>Баннер зоны: переход в соседа у открытой стороны, граница — у закрытой.</summary>
        private bool TryGetSideBanner(out string title, out string detail, out bool locked)
        {
            title = detail = string.Empty;
            locked = false;
            if (_nearestOpenSide >= 0 && PlayerIsApproaching)
            {
                string name = string.IsNullOrEmpty(_labels[_nearestOpenSide]) ? "соседняя зона" : _labels[_nearestOpenSide];
                title = "ПЕРЕХОД: " + name.ToUpperInvariant();
                float remaining = Mathf.Max(0f, _distanceToEdge - ExitBandWidth);
                detail = _distanceToEdge <= ExitBandWidth + 0.25f
                    ? "Переход в зону..."
                    : "Пересеките золотую полосу  •  " + Mathf.CeilToInt(remaining) + " м";
                return true;
            }
            if (_distanceToClosed <= ExitBandWidth + 3f)
            {
                locked = true;
                title = _closedTitle;
                detail = _closedDetail;
                return !string.IsNullOrEmpty(title);
            }
            return false;
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
            _thresholds.Clear();
            _threshold = null;
            DestroyRuntime(_visualRoot);
            DestroyRuntime(_lockedRoot);
            DestroyRuntime(_edgeStopRoot);
            _edgeStopRoot = null;
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
