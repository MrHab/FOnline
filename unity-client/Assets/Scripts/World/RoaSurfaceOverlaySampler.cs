using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Cached heights of the finished ground mesh and its walkable decks.</summary>
    public sealed class RoaSurfaceOverlaySampler
    {
        private readonly RoaMeshSurfaceHeight _ground;
        private readonly Renderer _renderer;
        private readonly bool _projected;
        private readonly RoaSectorSurface.Profile _profile;
        private readonly RoaMeshSurfaceHeight _cover;
        private readonly List<OverlaySurface> _overlaySurfaces = new List<OverlaySurface>();

        public RoaSurfaceOverlaySampler(Renderer ground)
        {
            _renderer = ground;
            if (ground == null) return;
            var filter = ground.GetComponent<MeshFilter>();
            Mesh mesh = filter != null ? filter.sharedMesh : null;
            if (mesh != null && mesh.isReadable && mesh.vertexCount > 0)
            {
                Vector3[] vertices = mesh.vertices;
                for (int i = 0; i < vertices.Length; i++)
                    vertices[i] = ground.transform.TransformPoint(vertices[i]);
                _ground = new RoaMeshSurfaceHeight(vertices, mesh.triangles);
                _overlaySurfaces.Add(new OverlaySurface(vertices, mesh.triangles));
            }
            _projected = ground.GetComponent<RoaSectorSurface>() != null
                || ground.GetComponent<RoaRoomSurface>() != null
                || ground.GetComponent<RoaZoneReliefProjection>() != null;
            _profile = ground.GetComponent<RoaSectorSurface>()?.Sector;
            if (_profile == null && ground.GetComponent<RoaZoneReliefProjection>() != null)
                _profile = RoaSectorSurface.Find(RoaZoneReliefProjection.DamRoadZone);
            if (_projected)
            {
                foreach (var deckFilter in ground.transform.root.GetComponentsInChildren<MeshFilter>())
                    if (deckFilter.name == RoaSectorRailInfrastructure.CoverName
                        || deckFilter.name == "FreightFormationCollider" || deckFilter.name.StartsWith("SectorBridge_", System.StringComparison.Ordinal))
                        AddOverlaySurface(deckFilter.sharedMesh, deckFilter.transform);
                foreach (var collider in ground.transform.root.GetComponentsInChildren<MeshCollider>())
                    if (collider.name == "OutpostBridgeWalkSurface") AddOverlaySurface(collider.sharedMesh, collider.transform);
                foreach (var cover in ground.transform.root.GetComponentsInChildren<MeshFilter>())
                    if (cover.name == RoaSectorRailInfrastructure.CoverName && cover.sharedMesh != null
                        && cover.sharedMesh.isReadable && cover.sharedMesh.vertexCount > 0)
                    {
                        Vector3[] vertices = cover.sharedMesh.vertices;
                        for (int i = 0; i < vertices.Length; i++) vertices[i] = cover.transform.TransformPoint(vertices[i]);
                        _cover = new RoaMeshSurfaceHeight(vertices, cover.sharedMesh.triangles);
                        break;
                    }
            }
        }

        private void AddOverlaySurface(Mesh mesh, Transform frame)
        {
            if (mesh == null || !mesh.isReadable || mesh.vertexCount == 0) return;
            var vertices = mesh.vertices;
            for (int i = 0; i < vertices.Length; i++) vertices[i] = frame.TransformPoint(vertices[i]);
            _overlaySurfaces.Add(new OverlaySurface(vertices, mesh.triangles));
        }

        /// <summary>Exact saved surface triangles clipped to a visibility cell.
        /// Visibility is defined in XZ, so it shades each physical floor there.
        /// Floors never get joined to each other or to an excavated void.</summary>
        public bool AppendOverlayTriangles(Rect cell, List<Vector3> vertices)
        {
            if (_overlaySurfaces.Count == 0) return false;
            foreach (var surface in _overlaySurfaces) surface.Append(cell, vertices);
            return true;
        }

        private sealed class OverlaySurface
        {
            private const float BucketSize = 4f;
            private readonly Vector3[] _vertices;
            private readonly int[] _triangles;
            private readonly Dictionary<Vector2Int, List<int>> _buckets = new Dictionary<Vector2Int, List<int>>();
            private readonly HashSet<int> _visited = new HashSet<int>();
            private List<Vector3> _polygon = new List<Vector3>(8), _clipped = new List<Vector3>(8);

            public OverlaySurface(Vector3[] vertices, int[] triangles)
            {
                _vertices = vertices; _triangles = triangles;
                for (int i = 0; i < triangles.Length; i += 3)
                {
                    Vector3 a = vertices[triangles[i]], b = vertices[triangles[i + 1]], c = vertices[triangles[i + 2]];
                    // Exclude undersides and vertical walls of slabs.
                    if (Vector3.Cross(b - a, c - a).y <= .000001f) continue;
                    for (int z = Bucket(Mathf.Min(a.z, b.z, c.z)); z <= Bucket(Mathf.Max(a.z, b.z, c.z)); z++)
                    for (int x = Bucket(Mathf.Min(a.x, b.x, c.x)); x <= Bucket(Mathf.Max(a.x, b.x, c.x)); x++)
                    {
                        var key = new Vector2Int(x, z);
                        if (!_buckets.TryGetValue(key, out var indices)) _buckets.Add(key, indices = new List<int>());
                        indices.Add(i);
                    }
                }
            }
            private static int Bucket(float x) => Mathf.FloorToInt(x / BucketSize);
            public void Append(Rect cell, List<Vector3> output)
            {
                _visited.Clear();
                for (int z = Bucket(cell.yMin); z <= Bucket(cell.yMax); z++)
                for (int x = Bucket(cell.xMin); x <= Bucket(cell.xMax); x++)
                {
                    if (!_buckets.TryGetValue(new Vector2Int(x, z), out var indices)) continue;
                    foreach (int index in indices)
                    {
                        if (!_visited.Add(index)) continue;
                        _polygon.Clear();
                        for (int i = 0; i < 3; i++) _polygon.Add(_vertices[_triangles[index + i]]);
                        Clip(true, cell.xMin, true); Clip(true, cell.xMax, false);
                        Clip(false, cell.yMin, true); Clip(false, cell.yMax, false);
                        for (int i = 1; i + 1 < _polygon.Count; i++)
                        {
                            if (Vector3.Cross(_polygon[i] - _polygon[0], _polygon[i + 1] - _polygon[0]).sqrMagnitude < 1e-12f) continue;
                            output.Add(_polygon[0]); output.Add(_polygon[i]); output.Add(_polygon[i + 1]);
                        }
                    }
                }
            }
            private void Clip(bool axisX, float boundary, bool minimum)
            {
                _clipped.Clear();
                if (_polygon.Count > 0)
                {
                    Vector3 previous = _polygon[_polygon.Count - 1];
                    float before = axisX ? previous.x : previous.z;
                    bool insideBefore = minimum ? before >= boundary : before <= boundary;
                    foreach (Vector3 current in _polygon)
                    {
                        float after = axisX ? current.x : current.z;
                        bool insideAfter = minimum ? after >= boundary : after <= boundary;
                        if (insideAfter != insideBefore)
                        {
                            Vector3 cut = Vector3.LerpUnclamped(previous, current, (boundary - before) / (after - before));
                            if (axisX) cut.x = boundary; else cut.z = boundary;
                            _clipped.Add(cut);
                        }
                        if (insideAfter) _clipped.Add(current);
                        previous = current; before = after; insideBefore = insideAfter;
                    }
                }
                var swap = _polygon; _polygon = _clipped; _clipped = swap;
            }
        }

        // Ordinary saved terrain never depends on the observer's height. Only
        // overlapping authored decks can require another overlay at the same XZ.
        public bool ReferenceDependentAt(float x, float z)
        {
            if (!_projected || _ground == null) return false;
            Bounds bounds = _ground.Bounds;
            x = Mathf.Clamp(x, bounds.min.x, bounds.max.x);
            z = Mathf.Clamp(z, bounds.min.z, bounds.max.z);
            return (_cover != null && _cover.TryHeight(x, z, out _))
                || (_profile != null && (RoaSectorSurface.BridgeAt(_profile, x, z) != null
                    || RoaSectorSurface.TryRailFloor(_profile, x, z, out _)));
        }

        public float HeightAt(float x, float z, float referenceFeet = float.NaN)
        {
            if (_ground == null) return _renderer != null ? _renderer.bounds.max.y : 0f;
            Bounds bounds = _ground.Bounds;
            x = Mathf.Clamp(x, bounds.min.x, bounds.max.x);
            z = Mathf.Clamp(z, bounds.min.z, bounds.max.z);
            bool hasFloor = _ground.TryHeight(x, z, out float floor);
            if (!hasFloor) floor = bounds.min.y;
            if (!_projected || _renderer == null) return floor;

            // Avoid the analytic provider and route scans on ordinary terrain.
            if (!ReferenceDependentAt(x, z)) return floor;

            if (_cover != null && _cover.TryHeight(x, z, out float roof)
                && (float.IsNaN(referenceFeet) || referenceFeet >= roof - 2f)) return roof;

            // Projection profiles use world XZ, even when the source ground is
            // the legacy scaled cube. Only saved mesh vertices use its transform.
            Vector3 local = new Vector3(x, floor, z);
            float feet = referenceFeet;
            float support = RoaZoneReliefProjection.GroundHeightAt(local.x, local.z, feet);
            bool explicitLayer = false;
            if (_profile != null)
            {
                var bridge = RoaSectorSurface.BridgeAt(_profile, local.x, local.z);
                explicitLayer = bridge != null
                    && Mathf.Abs(support - RoaSectorSurface.BridgeHeight(bridge, local.x, local.z)) <= 0.1f;
                if (RoaSectorSurface.TryRailFloor(_profile, local.x, local.z, out float rail))
                    explicitLayer |= Mathf.Abs(support - rail) <= 0.1f;
            }
            // The legacy terrain provider is analytic; a height difference on a
            // bank is not evidence of another floor. Require an authored deck.
            if (!explicitLayer) return floor;
            // Small provider clearances belong to movement. Use the saved triangles
            // for the overlay; only a distinct bridge/tunnel layer replaces them.
            if (Mathf.Abs(support - floor) <= 0.1f) return floor;
            if (!hasFloor || float.IsNaN(referenceFeet)
                || Mathf.Abs(referenceFeet - support) <= Mathf.Abs(referenceFeet - floor) + 0.25f)
                return support;
            return floor;
        }
    }
}
