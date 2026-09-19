using System;
using System.Collections.Generic;
using UnityEngine;

namespace Kromka.Authoring
{
    public enum KromkaRouteKind
    {
        Road,
        Railway,
        CascadeCanal,
        ServiceTunnel,
        SeasonalPass
    }

    /// <summary>
    /// Root of the editable global-map scene. Location nodes, region boundaries and
    /// route control points are ordinary scene transforms and may be moved in Unity.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaWorldAuthoring : MonoBehaviour
    {
        [SerializeField] private string _worldRevision = KromkaLocationAuthoring.CurrentWorldRevision;
        [SerializeField, Min(1f)] private float _worldWidthKm = 380f;
        [SerializeField, Min(1f)] private float _worldHeightKm = 300f;
        [SerializeField] private Transform _terrainRoot;
        [SerializeField] private Transform _regionRoot;
        [SerializeField] private Transform _routeRoot;
        [SerializeField] private Transform _locationRoot;

        private readonly Dictionary<string, KromkaWorldLocationAuthoring> _locations =
            new Dictionary<string, KromkaWorldLocationAuthoring>(StringComparer.Ordinal);

        public string WorldRevision => _worldRevision;
        public float WorldWidthKm => _worldWidthKm;
        public float WorldHeightKm => _worldHeightKm;
        public Transform TerrainRoot => _terrainRoot;
        public Transform RegionRoot => _regionRoot;
        public Transform RouteRoot => _routeRoot;
        public Transform LocationRoot => _locationRoot;

        public void Configure(string worldRevision, float worldWidthKm, float worldHeightKm,
                              Transform terrainRoot, Transform regionRoot,
                              Transform routeRoot, Transform locationRoot)
        {
            _worldRevision = worldRevision ?? string.Empty;
            _worldWidthKm = Mathf.Max(1f, worldWidthKm);
            _worldHeightKm = Mathf.Max(1f, worldHeightKm);
            _terrainRoot = terrainRoot;
            _regionRoot = regionRoot;
            _routeRoot = routeRoot;
            _locationRoot = locationRoot;
            RebuildLocationIndex();
        }

        public void RebuildLocationIndex()
        {
            _locations.Clear();
            KromkaWorldLocationAuthoring[] markers =
                GetComponentsInChildren<KromkaWorldLocationAuthoring>(true);
            for (int i = 0; i < markers.Length; i++)
            {
                KromkaWorldLocationAuthoring marker = markers[i];
                if (marker == null || string.IsNullOrWhiteSpace(marker.StableLocationId)) continue;
                if (_locations.ContainsKey(marker.StableLocationId))
                {
                    Debug.LogWarning("[KROMKA] Duplicate world location id '"
                        + marker.StableLocationId + "'.", marker);
                    continue;
                }
                _locations.Add(marker.StableLocationId, marker);
            }
        }

        public bool TryGetLocation(string locationId, out KromkaWorldLocationAuthoring marker)
        {
            if (_locations.Count == 0) RebuildLocationIndex();
            marker = null;
            return !string.IsNullOrWhiteSpace(locationId)
                && _locations.TryGetValue(locationId, out marker) && marker != null;
        }

        public bool Validate(out string error)
        {
            if (_worldRevision != KromkaLocationAuthoring.CurrentWorldRevision)
                return Fail("неверная ревизия мира", out error);
            if (_terrainRoot == null) return Fail("не задан TerrainRoot", out error);
            if (_regionRoot == null) return Fail("не задан RegionRoot", out error);
            if (_routeRoot == null) return Fail("не задан RouteRoot", out error);
            if (_locationRoot == null) return Fail("не задан LocationRoot", out error);

            RebuildLocationIndex();
            if (_locations.Count == 0) return Fail("не размещено ни одной локации", out error);
            error = null;
            return true;
        }

        private void OnValidate()
        {
            _worldWidthKm = Mathf.Max(1f, _worldWidthKm);
            _worldHeightKm = Mathf.Max(1f, _worldHeightKm);
            if (string.IsNullOrWhiteSpace(_worldRevision))
                _worldRevision = KromkaLocationAuthoring.CurrentWorldRevision;
            RebuildLocationIndex();
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }
    }

}
