using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Marks a Unity-authored additive location scene. Static presentation lives in
    /// the scene, while NPCs and gameplay state remain server authoritative.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaUnityLocationScene : MonoBehaviour
    {
        [SerializeField] private string _locationId = string.Empty;
        [SerializeField] private Terrain _terrain;

        private readonly Dictionary<string, GameObject> _objects =
            new Dictionary<string, GameObject>(StringComparer.Ordinal);

        public string LocationId => _locationId;
        public Terrain Terrain => _terrain;
        public int ObjectCount
        {
            get
            {
                EnsureIndex();
                return _objects.Count;
            }
        }

        public void Configure(string locationId, Terrain terrain)
        {
            _locationId = locationId ?? string.Empty;
            _terrain = terrain;
            RebuildIndex();
        }

        public void RebuildIndex()
        {
            _objects.Clear();
            RoaUnityLocationObject[] markers = GetComponentsInChildren<RoaUnityLocationObject>(true);
            for (int i = 0; i < markers.Length; i++)
            {
                RoaUnityLocationObject marker = markers[i];
                if (marker == null || string.IsNullOrEmpty(marker.ObjectId)) continue;
                if (_objects.ContainsKey(marker.ObjectId))
                {
                    Debug.LogWarning("[ROA] Duplicate Unity location object id '"
                        + marker.ObjectId + "' in " + name + ".", marker);
                    continue;
                }
                _objects.Add(marker.ObjectId, marker.gameObject);
            }
        }

        public bool TryGetObject(string objectId, out GameObject root)
        {
            EnsureIndex();
            root = null;
            return !string.IsNullOrEmpty(objectId)
                && _objects.TryGetValue(objectId, out root) && root != null;
        }

        private void EnsureIndex()
        {
            if (_objects.Count == 0) RebuildIndex();
        }
    }

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
