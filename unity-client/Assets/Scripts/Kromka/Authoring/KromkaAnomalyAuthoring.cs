using UnityEngine;

namespace Kromka.Authoring
{
    /// <summary>Editable anomaly centre linked to server-authoritative runtime state.</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaAnomalyAuthoring : MonoBehaviour
    {
        [SerializeField] private string _stableAnomalyId = string.Empty;
        [SerializeField] private string _anomalyTypeId = string.Empty;
        [SerializeField, Min(0.75f)] private float _radius = 2.5f;
        [SerializeField, Min(500)] private int _dischargeMilliseconds = 4000;
        [SerializeField] private bool _trainingField;

        public string StableAnomalyId => _stableAnomalyId;
        public string AnomalyTypeId => _anomalyTypeId;
        public float Radius => _radius;
        public int DischargeMilliseconds => _dischargeMilliseconds;
        public bool TrainingField => _trainingField;

        public void Configure(string stableAnomalyId, string anomalyTypeId, float radius,
                              int dischargeMilliseconds, bool trainingField)
        {
            _stableAnomalyId = stableAnomalyId ?? string.Empty;
            _anomalyTypeId = anomalyTypeId ?? string.Empty;
            _radius = Mathf.Max(0.75f, radius);
            _dischargeMilliseconds = Mathf.Max(500, dischargeMilliseconds);
            _trainingField = trainingField;
        }

        private void OnValidate()
        {
            _radius = Mathf.Max(0.75f, _radius);
            _dischargeMilliseconds = Mathf.Max(500, _dischargeMilliseconds);
        }
    }
}
