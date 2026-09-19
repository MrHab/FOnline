using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Префабы набора зон мира: ключ из data/zones/kit.json → нативный префаб
    /// Assets/Prefabs/Kromka/RecoveredEnvironment. Сгенерированная зона не имеет
    /// своей сцены Unity, её объекты — экземпляры этих префабов. Ассет собирает
    /// tools/build-zone-kit-asset.js, руками его не правят.
    /// </summary>
    public sealed class RoaZoneKitCatalog : ScriptableObject
    {
        public const string ResourcePath = "RealmOfAshes/ZoneKitPrefabs";

        [Serializable]
        public sealed class Entry
        {
            [SerializeField] private string key = string.Empty;
            [SerializeField] private GameObject prefab;

            public string Key { get { return key; } }
            public GameObject Prefab { get { return prefab; } }
        }

        [SerializeField] private List<Entry> entries = new List<Entry>();

        private static RoaZoneKitCatalog _instance;
        private static bool _loaded;
        private Dictionary<string, GameObject> _byKey;

        public int EntryCount { get { return entries != null ? entries.Count : 0; } }

        public static RoaZoneKitCatalog Instance
        {
            get
            {
                if (!_loaded)
                {
                    _instance = Resources.Load<RoaZoneKitCatalog>(ResourcePath);
                    _loaded = true;
                    if (_instance == null) Debug.LogError("[ROA] Набор зон не найден в Resources/" + ResourcePath);
                }
                return _instance;
            }
        }

        public GameObject Find(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            if (_byKey == null)
            {
                _byKey = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                if (entries != null)
                    foreach (Entry entry in entries)
                        if (entry != null && !string.IsNullOrEmpty(entry.Key) && entry.Prefab != null)
                            _byKey[entry.Key] = entry.Prefab;
            }
            return _byKey.TryGetValue(key, out GameObject prefab) ? prefab : null;
        }
    }
}
