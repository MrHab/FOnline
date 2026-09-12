using System;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Authored playable contour for a strategic map. Points are stored in local
    /// space so the same contour drives click rejection and the visible dash line.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaGlobalMapBoundary : MonoBehaviour
    {
        [SerializeField] private Vector3[] _localPoints = Array.Empty<Vector3>();

        public int PointCount => _localPoints != null ? _localPoints.Length : 0;

        public void Configure(Vector3[] localPoints)
        {
            _localPoints = localPoints != null
                ? (Vector3[])localPoints.Clone()
                : Array.Empty<Vector3>();
        }

        public bool ContainsWorldPoint(Vector3 worldPoint)
        {
            if (_localPoints == null || _localPoints.Length < 3) return true;
            Vector3 point = transform.InverseTransformPoint(worldPoint);
            bool inside = false;
            int previous = _localPoints.Length - 1;
            for (int current = 0; current < _localPoints.Length; current++)
            {
                Vector3 a = _localPoints[current];
                Vector3 b = _localPoints[previous];
                float dz = b.z - a.z;
                bool crosses = (a.z > point.z) != (b.z > point.z)
                    && point.x < (b.x - a.x) * (point.z - a.z)
                    / (Mathf.Abs(dz) > 0.000001f ? dz : 0.000001f) + a.x;
                if (crosses) inside = !inside;
                previous = current;
            }
            return inside;
        }

        public Vector3 ClosestWorldPoint(Vector3 worldPoint)
        {
            if (_localPoints == null || _localPoints.Length == 0)
                return transform.position;

            Vector3 point = transform.InverseTransformPoint(worldPoint);
            Vector3 closest = _localPoints[0];
            float closestDistance = float.PositiveInfinity;
            for (int i = 0; i < _localPoints.Length; i++)
            {
                Vector3 a = _localPoints[i];
                Vector3 b = _localPoints[(i + 1) % _localPoints.Length];
                Vector2 segment = new Vector2(b.x - a.x, b.z - a.z);
                float denominator = segment.sqrMagnitude;
                float t = denominator > 0.000001f
                    ? Mathf.Clamp01(Vector2.Dot(new Vector2(point.x - a.x,
                        point.z - a.z), segment) / denominator)
                    : 0f;
                Vector3 candidate = Vector3.Lerp(a, b, t);
                float distance = new Vector2(point.x - candidate.x,
                    point.z - candidate.z).sqrMagnitude;
                if (distance >= closestDistance) continue;
                closestDistance = distance;
                closest = candidate;
            }
            return transform.TransformPoint(closest);
        }
    }
}
