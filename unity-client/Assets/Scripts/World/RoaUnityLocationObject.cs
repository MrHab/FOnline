using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Stable bridge between a server-authored object id and its Unity scene visual.</summary>
    [DisallowMultipleComponent]
    public sealed class RoaUnityLocationObject : MonoBehaviour
    {
        [SerializeField] private string _objectId = string.Empty;

        public string ObjectId => _objectId;

        public void Configure(string objectId)
        {
            _objectId = objectId ?? string.Empty;
        }
    }
}
