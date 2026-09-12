using UnityEngine;

namespace Kromka.Authoring
{
    /// <summary>Editable spawn, exit or encounter transform inside a location scene.</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaSpawnAuthoring : MonoBehaviour
    {
        [SerializeField] private string _spawnId = string.Empty;
        [SerializeField] private KromkaSpawnKind _kind;
        [SerializeField] private string _targetLocationId = string.Empty;
        [SerializeField, Min(0f)] private float _radius = 1f;

        public string SpawnId => _spawnId;
        public KromkaSpawnKind Kind => _kind;
        public string TargetLocationId => _targetLocationId;
        public float Radius => _radius;

        public void Configure(string spawnId, KromkaSpawnKind kind,
                              string targetLocationId, float radius)
        {
            _spawnId = spawnId ?? string.Empty;
            _kind = kind;
            _targetLocationId = targetLocationId ?? string.Empty;
            _radius = Mathf.Max(0f, radius);
        }

        private void OnValidate()
        {
            _radius = Mathf.Max(0f, _radius);
        }
    }
}
