using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Мелкий покров сгенерированной зоны: кусты и щебень между объектами.
    /// Объекты сервера (≈700 на зону) дают укрытия и точки интереса, а с игровой камеры
    /// в 11 м их видно по одному‑два; покров заполняет землю между ними.
    ///
    /// Раскладка детерминирована зерном зоны и считается один раз, а на сцене стоят только
    /// слоты 40×40 м вокруг точки, куда смотрит камера: экземпляры — простые рендеры из
    /// пула, при переходе камеры в соседний слот уходящие слоты отдают их входящим.
    /// Материалы — те же, что у префабов набора, поэтому их берёт SRP Batcher без
    /// вариантов шейдера с инстансингом (в WebGL‑сборке они вырезаются).
    ///
    /// Сервер о покрове не знает: он не мешает ходьбе и обзору, поэтому не ложится на
    /// тропы, ворота, входы и объекты зоны.
    /// </summary>
    public sealed class RoaZoneGroundCover : MonoBehaviour
    {
        public const float SlotMetres = 40f;
        public const int DesktopPerSlot = 220;
        public const int MobilePerSlot = 120;
        public const int WindowRadiusSlots = 1;
        private const float TrailClearMetres = 1.7f;
        private const float NodeClearMetres = 3.5f;
        private const float CellMetres = 10f;

        private struct Kind
        {
            public string Prefab;
            public float Weight;
            public float MinRadius;
            public float MaxRadius;
        }

        // Радиус — половина ширины экземпляра в метрах: размер задаётся по мешу, а не по масштабу префаба.
        private static readonly Kind[] Kinds =
        {
            new Kind { Prefab = "dry_bush", Weight = 0.65f, MinRadius = 0.4f, MaxRadius = 1.05f },
            new Kind { Prefab = "rubble_rock", Weight = 0.35f, MinRadius = 0.15f, MaxRadius = 0.4f }
        };

        private sealed class Part
        {
            public Mesh Mesh;
            public Material[] Materials;
            public Matrix4x4 Local;
            public readonly Stack<GameObject> Pool = new Stack<GameObject>();
        }

        private sealed class Blocker
        {
            public Vector2 Point;
            public float Radius;
        }

        private struct Piece
        {
            public int Part;
            public Matrix4x4 Matrix;
        }

        private readonly List<Part> _parts = new List<Part>();
        private readonly Dictionary<int, List<KeyValuePair<int, GameObject>>> _shown = new Dictionary<int, List<KeyValuePair<int, GameObject>>>();
        private readonly List<int> _leaving = new List<int>();
        private List<Piece>[] _slots = Array.Empty<List<Piece>>();
        private int _slotsX;
        private int _slotsZ;
        private float _halfWidth;
        private float _halfDepth;
        private int _centerX = int.MinValue;
        private int _centerZ = int.MinValue;
        private int _radius = -1;

        public int InstanceCount { get; private set; }
        public int ActivePieces { get; private set; }
        public int CreatedPieces { get; private set; }
        public int ShownSlots { get { return _shown.Count; } }

        public void Build(LocationDefinition zone, bool mobile)
        {
            Clear();
            RoaZoneKitCatalog kit = RoaZoneKitCatalog.Instance;
            if (zone == null || kit == null) return;
            _halfWidth = zone.WorldWidth * 0.5f;
            _halfDepth = zone.WorldDepth * 0.5f;
            _slotsX = Mathf.Max(1, Mathf.CeilToInt(zone.WorldWidth / SlotMetres));
            _slotsZ = Mathf.Max(1, Mathf.CeilToInt(zone.WorldDepth / SlotMetres));
            _slots = new List<Piece>[_slotsX * _slotsZ];
            for (int s = 0; s < _slots.Length; s++) _slots[s] = new List<Piece>();

            // Меши видов и их размер в осях префаба.
            var kindParts = new List<int>[Kinds.Length];
            var kindRadius = new float[Kinds.Length];
            var kindBase = new float[Kinds.Length];
            float weightTotal = 0f;
            for (int k = 0; k < Kinds.Length; k++)
            {
                kindParts[k] = ExtractParts(kit.Find(Kinds[k].Prefab), out Bounds bounds);
                if (kindParts[k].Count == 0) continue;
                kindRadius[k] = Mathf.Max(0.01f, Mathf.Max(bounds.extents.x, bounds.extents.z));
                kindBase[k] = bounds.min.y;
                weightTotal += Kinds[k].Weight;
            }
            if (weightTotal <= 0f) return;

            Dictionary<long, List<Blocker>> blockers = CollectBlockers(zone);
            var nodes = new List<Vector2>();
            var trails = new List<KeyValuePair<Vector2, Vector2>>();
            CollectTrails(zone, nodes, trails);

            uint state = unchecked((uint)(zone.Seed ^ (zone.Seed >> 32)) ^ 0x9E3779B9u);
            if (state == 0) state = 0x6C8E9CF5u;
            int perSlot = mobile ? MobilePerSlot : DesktopPerSlot;
            for (int sz = 0; sz < _slotsZ; sz++)
            {
                for (int sx = 0; sx < _slotsX; sx++)
                {
                    List<Piece> slot = _slots[sz * _slotsX + sx];
                    // Плотность меняется от слота к слоту: пустошь не выглядит ровным ковром.
                    float density = 0.45f + Next(ref state) * 0.75f;
                    int count = Mathf.RoundToInt(perSlot * density);
                    for (int n = 0; n < count; n++)
                    {
                        float x = -_halfWidth + (sx + Next(ref state)) * SlotMetres;
                        float z = -_halfDepth + (sz + Next(ref state)) * SlotMetres;
                        float pick = Next(ref state) * weightTotal;
                        float yaw = Next(ref state) * 360f;
                        float size = Next(ref state);
                        int kind = -1;
                        for (int k = 0; k < Kinds.Length; k++)
                        {
                            if (kindParts[k].Count == 0) continue;
                            kind = k;
                            pick -= Kinds[k].Weight;
                            if (pick <= 0f) break;
                        }
                        if (kind < 0 || Mathf.Abs(x) > _halfWidth - 2f || Mathf.Abs(z) > _halfDepth - 2f) continue;
                        var point = new Vector2(x, z);
                        if (Blocked(blockers, point) || NearTrail(point, nodes, trails)) continue;
                        float radius = Mathf.Lerp(Kinds[kind].MinRadius, Kinds[kind].MaxRadius, size * size);
                        float scale = radius / kindRadius[kind];
                        Matrix4x4 placement = Matrix4x4.TRS(new Vector3(x, -kindBase[kind] * scale - 0.02f, z),
                            Quaternion.Euler(0f, yaw, 0f), Vector3.one * scale);
                        foreach (int part in kindParts[kind])
                            slot.Add(new Piece { Part = part, Matrix = placement * _parts[part].Local });
                        InstanceCount++;
                    }
                }
            }
        }

        private void LateUpdate()
        {
            Camera view = Camera.main;
            if (view != null) ShowAround(Focus(view), WindowRadiusSlots);
        }

        /// <summary>Точка земли, куда смотрит камера.</summary>
        public Vector3 Focus(Camera view)
        {
            Vector3 focus = view.transform.position;
            Vector3 forward = view.transform.forward;
            if (forward.y < -0.05f) focus += forward * (-(focus.y - transform.position.y) / forward.y);
            return focus;
        }

        /// <summary>Поставить слоты в квадрате radius вокруг точки мира и убрать остальные.</summary>
        public void ShowAround(Vector3 focus, int radius)
        {
            if (_slots.Length == 0) return;
            Vector3 local = transform.InverseTransformPoint(focus);
            int cx = Mathf.FloorToInt((local.x + _halfWidth) / SlotMetres);
            int cz = Mathf.FloorToInt((local.z + _halfDepth) / SlotMetres);
            if (cx == _centerX && cz == _centerZ && radius == _radius) return;
            _centerX = cx;
            _centerZ = cz;
            _radius = radius;

            _leaving.Clear();
            foreach (int slot in _shown.Keys)
            {
                int sx = slot % _slotsX, sz = slot / _slotsX;
                if (Mathf.Abs(sx - cx) > radius || Mathf.Abs(sz - cz) > radius) _leaving.Add(slot);
            }
            foreach (int slot in _leaving) Hide(slot);

            for (int sz = Mathf.Max(0, cz - radius); sz <= Mathf.Min(_slotsZ - 1, cz + radius); sz++)
            {
                for (int sx = Mathf.Max(0, cx - radius); sx <= Mathf.Min(_slotsX - 1, cx + radius); sx++)
                {
                    int slot = sz * _slotsX + sx;
                    if (!_shown.ContainsKey(slot)) Show(slot);
                }
            }
        }

        private void Show(int slot)
        {
            var list = new List<KeyValuePair<int, GameObject>>(_slots[slot].Count);
            foreach (Piece piece in _slots[slot])
            {
                Part part = _parts[piece.Part];
                GameObject instance = null;
                while (part.Pool.Count > 0 && instance == null) instance = part.Pool.Pop();
                if (instance == null)
                {
                    instance = new GameObject(part.Mesh.name);
                    instance.transform.SetParent(transform, false);
                    instance.AddComponent<MeshFilter>().sharedMesh = part.Mesh;
                    var renderer = instance.AddComponent<MeshRenderer>();
                    renderer.sharedMaterials = part.Materials;
                    renderer.shadowCastingMode = ShadowCastingMode.Off;
                    renderer.receiveShadows = true;
                    renderer.lightProbeUsage = LightProbeUsage.Off;
                    renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
                    CreatedPieces++;
                }
                instance.transform.localPosition = piece.Matrix.GetColumn(3);
                instance.transform.localRotation = piece.Matrix.rotation;
                instance.transform.localScale = piece.Matrix.lossyScale;
                instance.SetActive(true);
                list.Add(new KeyValuePair<int, GameObject>(piece.Part, instance));
            }
            _shown[slot] = list;
            ActivePieces += list.Count;
        }

        private void Hide(int slot)
        {
            if (!_shown.TryGetValue(slot, out List<KeyValuePair<int, GameObject>> list)) return;
            foreach (KeyValuePair<int, GameObject> pair in list)
            {
                if (pair.Value == null) continue;
                pair.Value.SetActive(false);
                _parts[pair.Key].Pool.Push(pair.Value);
            }
            ActivePieces -= list.Count;
            _shown.Remove(slot);
        }

        private void Clear()
        {
            for (int i = transform.childCount - 1; i >= 0; i--)
            {
                GameObject child = transform.GetChild(i).gameObject;
                if (Application.isPlaying) Destroy(child);
                else DestroyImmediate(child);
            }
            _parts.Clear();
            _shown.Clear();
            _slots = Array.Empty<List<Piece>>();
            InstanceCount = 0;
            ActivePieces = 0;
            CreatedPieces = 0;
            _centerX = _centerZ = int.MinValue;
            _radius = -1;
        }

        private List<int> ExtractParts(GameObject prefab, out Bounds bounds)
        {
            var indices = new List<int>();
            bounds = new Bounds();
            if (prefab == null) return indices;
            Matrix4x4 toRoot = prefab.transform.worldToLocalMatrix;
            bool any = false;
            foreach (MeshFilter filter in prefab.GetComponentsInChildren<MeshFilter>(true))
            {
                Mesh mesh = filter.sharedMesh;
                MeshRenderer renderer = filter.GetComponent<MeshRenderer>();
                if (mesh == null || renderer == null) continue;
                Matrix4x4 local = toRoot * filter.transform.localToWorldMatrix;
                indices.Add(_parts.Count);
                _parts.Add(new Part { Mesh = mesh, Materials = renderer.sharedMaterials, Local = local });
                Bounds meshBounds = mesh.bounds;
                for (int corner = 0; corner < 8; corner++)
                {
                    Vector3 p = meshBounds.center + Vector3.Scale(meshBounds.extents, new Vector3(
                        (corner & 1) == 0 ? -1f : 1f, (corner & 2) == 0 ? -1f : 1f, (corner & 4) == 0 ? -1f : 1f));
                    p = local.MultiplyPoint3x4(p);
                    if (!any) { bounds = new Bounds(p, Vector3.zero); any = true; }
                    else bounds.Encapsulate(p);
                }
            }
            return indices;
        }

        // Объекты зоны в ячейках по 10 м: покров проверяет только соседние ячейки.
        private static Dictionary<long, List<Blocker>> CollectBlockers(LocationDefinition zone)
        {
            var cells = new Dictionary<long, List<Blocker>>();
            int w = zone.TileWidth, d = zone.TileDepth;
            void Add(Vector2 point, float radius)
            {
                long key = Pack(Mathf.FloorToInt(point.x / CellMetres), Mathf.FloorToInt(point.y / CellMetres));
                if (!cells.TryGetValue(key, out List<Blocker> list)) cells[key] = list = new List<Blocker>();
                list.Add(new Blocker { Point = point, Radius = radius });
            }
            if (zone.Objects != null)
            {
                foreach (LocationObject entry in zone.Objects)
                {
                    if (entry?.Position == null) continue;
                    Vector3 world = RoaCoords.ToUnity(entry.Position.X, entry.Position.Z);
                    float fx = entry.Footprint != null ? entry.Footprint.X : 1f;
                    float fz = entry.Footprint != null ? entry.Footprint.Z : 1f;
                    Add(new Vector2(world.x, world.z), Mathf.Min(4.8f, Mathf.Max(fx, fz) * 0.5f + 0.25f));
                }
            }
            if (zone.Transitions != null)
            {
                foreach (LocationTransition row in zone.Transitions)
                {
                    if (row == null) continue;
                    Vector3 world = RoaCoords.TileToWorld(row.Tx, row.Tz, w, d);
                    Add(new Vector2(world.x, world.z), Mathf.Min(4.8f, Mathf.Max(2.5f, row.Radius + 1.5f)));
                }
            }
            if (zone.Spawn != null)
            {
                Vector3 hub = RoaCoords.TileToWorld(zone.Spawn.Tx, zone.Spawn.Tz, w, d);
                Add(new Vector2(hub.x, hub.z), 4.5f);
            }
            return cells;
        }

        private static bool Blocked(Dictionary<long, List<Blocker>> cells, Vector2 point)
        {
            int cx = Mathf.FloorToInt(point.x / CellMetres), cz = Mathf.FloorToInt(point.y / CellMetres);
            for (int dz = -1; dz <= 1; dz++)
            {
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (!cells.TryGetValue(Pack(cx + dx, cz + dz), out List<Blocker> list)) continue;
                    foreach (Blocker row in list)
                        if ((row.Point - point).sqrMagnitude < row.Radius * row.Radius) return true;
                }
            }
            return false;
        }

        // Тропы зоны — рёбра графа nav: покров их не закрывает, тропа читается на земле.
        private static void CollectTrails(LocationDefinition zone, List<Vector2> nodes, List<KeyValuePair<Vector2, Vector2>> trails)
        {
            if (!(zone.Zone?["nav"] is JObject nav)) return;
            int w = zone.TileWidth, d = zone.TileDepth;
            var byId = new Dictionary<string, Vector2>(StringComparer.Ordinal);
            if (nav["nodes"] is JArray list)
            {
                foreach (JToken node in list)
                {
                    string id = (string)node["id"];
                    if (string.IsNullOrEmpty(id)) continue;
                    Vector3 world = RoaCoords.TileToWorld((int)(node["tx"] ?? 0), (int)(node["tz"] ?? 0), w, d);
                    var point = new Vector2(world.x, world.z);
                    byId[id] = point;
                    nodes.Add(point);
                }
            }
            if (nav["links"] is JArray links)
            {
                foreach (JToken link in links)
                {
                    if (!(link is JArray pair) || pair.Count < 2) continue;
                    if (byId.TryGetValue((string)pair[0] ?? string.Empty, out Vector2 a)
                        && byId.TryGetValue((string)pair[1] ?? string.Empty, out Vector2 b))
                        trails.Add(new KeyValuePair<Vector2, Vector2>(a, b));
                }
            }
        }

        private static bool NearTrail(Vector2 point, List<Vector2> nodes, List<KeyValuePair<Vector2, Vector2>> trails)
        {
            foreach (Vector2 node in nodes)
                if ((node - point).sqrMagnitude < NodeClearMetres * NodeClearMetres) return true;
            foreach (KeyValuePair<Vector2, Vector2> trail in trails)
            {
                Vector2 ab = trail.Value - trail.Key;
                float t = ab.sqrMagnitude > 0.0001f ? Mathf.Clamp01(Vector2.Dot(point - trail.Key, ab) / ab.sqrMagnitude) : 0f;
                if ((trail.Key + ab * t - point).sqrMagnitude < TrailClearMetres * TrailClearMetres) return true;
            }
            return false;
        }

        private static long Pack(int x, int z)
        {
            return ((long)x << 32) ^ (uint)z;
        }

        private static float Next(ref uint state)
        {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            return (state & 0xFFFFFF) / 16777216f;
        }
    }
}
