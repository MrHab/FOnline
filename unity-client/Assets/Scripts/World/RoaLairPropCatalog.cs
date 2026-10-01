using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Direct references to existing Synty PolygonApocalypse prefabs used at A-Life lairs.</summary>
    public sealed class RoaLairPropCatalog : ScriptableObject
    {
        public const string ResourcePath = "RealmOfAshes/LairProps";

        [Serializable]
        public sealed class Entry
        {
            public string key;
            public GameObject prefab;
        }

        [SerializeField] private List<Entry> entries = new List<Entry>();
        private static RoaLairPropCatalog _instance;
        private Dictionary<string, GameObject> _lookup;

        public static RoaLairPropCatalog Instance =>
            _instance != null ? _instance : (_instance = Resources.Load<RoaLairPropCatalog>(ResourcePath));

        public GameObject Find(string key)
        {
            if (_lookup == null)
            {
                _lookup = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (Entry row in entries)
                    if (row != null && !string.IsNullOrEmpty(row.key) && row.prefab != null)
                        _lookup[row.key] = row.prefab;
            }
            return key != null && _lookup.TryGetValue(key, out GameObject prefab) ? prefab : null;
        }

#if UNITY_EDITOR
        public void Configure(List<Entry> rows)
        {
            entries = rows;
            _lookup = null;
            _instance = this;
        }
#endif
    }
}
