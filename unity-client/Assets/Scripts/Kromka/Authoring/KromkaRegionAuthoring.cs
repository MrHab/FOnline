using System;
using System.Collections.Generic;
using UnityEngine;

namespace Kromka.Authoring
{
    /// <summary>Designer-authored polygon for a visual and gameplay macroregion.</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaRegionAuthoring : MonoBehaviour
    {
        [SerializeField] private KromkaMacroRegion _macroRegion;
        [SerializeField] private string _displayName = string.Empty;
        [SerializeField] private string _visualProfileId = string.Empty;
        [SerializeField] private Transform[] _boundaryPoints = Array.Empty<Transform>();
        [SerializeField, Range(0, 5)] private int _dangerBand;

        public KromkaMacroRegion MacroRegion => _macroRegion;
        public string DisplayName => _displayName;
        public string VisualProfileId => _visualProfileId;
        public IReadOnlyList<Transform> BoundaryPoints => _boundaryPoints;
        public int DangerBand => _dangerBand;

        public void Configure(KromkaMacroRegion macroRegion, string displayName,
                              string visualProfileId, Transform[] boundaryPoints, int dangerBand)
        {
            _macroRegion = macroRegion;
            _displayName = displayName ?? string.Empty;
            _visualProfileId = visualProfileId ?? string.Empty;
            _boundaryPoints = boundaryPoints ?? Array.Empty<Transform>();
            _dangerBand = Mathf.Clamp(dangerBand, 0, 5);
        }

        private void OnValidate()
        {
            _dangerBand = Mathf.Clamp(_dangerBand, 0, 5);
        }
    }
}
