using System;
using System.Collections.Generic;
using UnityEngine;

namespace Kromka.Authoring
{
    /// <summary>Editable control-point route; points remain ordinary scene transforms.</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaRouteAuthoring : MonoBehaviour
    {
        [SerializeField] private string _routeId = string.Empty;
        [SerializeField] private string _displayName = string.Empty;
        [SerializeField] private KromkaRouteKind _routeKind;
        [SerializeField] private Transform[] _controlPoints = Array.Empty<Transform>();
        [SerializeField, Min(0.1f)] private float _widthKm = 1f;
        [SerializeField, Range(0.1f, 2f)] private float _travelFactor = 1f;

        public string RouteId => _routeId;
        public string DisplayName => _displayName;
        public KromkaRouteKind RouteKind => _routeKind;
        public IReadOnlyList<Transform> ControlPoints => _controlPoints;
        public float WidthKm => _widthKm;
        public float TravelFactor => _travelFactor;

        public void Configure(string routeId, string displayName, KromkaRouteKind routeKind,
                              Transform[] controlPoints, float widthKm, float travelFactor)
        {
            _routeId = routeId ?? string.Empty;
            _displayName = displayName ?? string.Empty;
            _routeKind = routeKind;
            _controlPoints = controlPoints ?? Array.Empty<Transform>();
            _widthKm = Mathf.Max(0.1f, widthKm);
            _travelFactor = Mathf.Clamp(travelFactor, 0.1f, 2f);
        }

        private void OnValidate()
        {
            _widthKm = Mathf.Max(0.1f, _widthKm);
            _travelFactor = Mathf.Clamp(_travelFactor, 0.1f, 2f);
        }
    }
}
