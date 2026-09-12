using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Stable ID for an editable location miniature on the global map.</summary>
    [DisallowMultipleComponent]
    public sealed class RoaGlobalMapNodeAnchor : MonoBehaviour
    {
        [SerializeField] private string _nodeId = string.Empty;

        public string NodeId => _nodeId;

        public void Configure(string nodeId)
        {
            _nodeId = nodeId ?? string.Empty;
        }
    }
}
