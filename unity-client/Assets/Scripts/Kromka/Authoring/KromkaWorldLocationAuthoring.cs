using UnityEngine;

namespace Kromka.Authoring
{
    /// <summary>A movable global-map marker linked to one editable location scene.</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaWorldLocationAuthoring : MonoBehaviour
    {
        [SerializeField] private string _stableLocationId = string.Empty;
        [SerializeField] private KromkaMacroRegion _macroRegion;
        [SerializeField] private string _locationScenePath = string.Empty;
        [SerializeField, Range(0, 5)] private int _dangerBand;
        [SerializeField, Min(0.1f)] private float _selectionRadiusKm = 2f;

        public string StableLocationId => _stableLocationId;
        public KromkaMacroRegion MacroRegion => _macroRegion;
        public string LocationScenePath => _locationScenePath;
        public int DangerBand => _dangerBand;
        public float SelectionRadiusKm => _selectionRadiusKm;

        public void Configure(string stableLocationId, KromkaMacroRegion macroRegion,
                              string locationScenePath, int dangerBand, float selectionRadiusKm)
        {
            _stableLocationId = stableLocationId ?? string.Empty;
            _macroRegion = macroRegion;
            _locationScenePath = locationScenePath ?? string.Empty;
            _dangerBand = Mathf.Clamp(dangerBand, 0, 5);
            _selectionRadiusKm = Mathf.Max(0.1f, selectionRadiusKm);
        }

        private void OnValidate()
        {
            _dangerBand = Mathf.Clamp(_dangerBand, 0, 5);
            _selectionRadiusKm = Mathf.Max(0.1f, _selectionRadiusKm);
        }
    }
}
