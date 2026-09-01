using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Build-time references to project-authored model prefabs. The complete prefab
    /// library stays visible under Assets/Prefabs/Models, while this lightweight
    /// Resources catalog contains only models needed without a scene reference.
    /// Network GLB loading remains a compatibility fallback for older builds.
    /// </summary>
    public sealed class RoaModelPrefabCatalog : ScriptableObject
    {
        public const string ResourcePath = "RealmOfAshes/GlobalMapModelPrefabs";

        [Serializable]
        public sealed class Entry
        {
            [SerializeField] private string sourceUrl = string.Empty;
            [SerializeField] private GameObject prefab;

            public string SourceUrl { get { return sourceUrl; } }
            public GameObject Prefab { get { return prefab; } }

            public Entry(string url, GameObject value)
            {
                sourceUrl = NormalizeUrl(url);
                prefab = value;
            }
        }

        [SerializeField] private List<Entry> entries = new List<Entry>();

        private static RoaModelPrefabCatalog _instance;
        private Dictionary<string, GameObject> _byUrl;

        public int EntryCount { get { return entries != null ? entries.Count : 0; } }
        public IReadOnlyList<Entry> Entries { get { return entries; } }

        public static bool TryInstantiate(string sourceUrl, Transform parent,
                                          out GameObject instance)
        {
            instance = null;
            GameObject prefab = FindPrefab(sourceUrl);
            if (prefab == null) return false;
            instance = Instantiate(prefab, parent, false);
            return instance != null;
        }

        public static AnimationClip[] AnimationClips(string sourceUrl)
        {
            GameObject prefab = FindPrefab(sourceUrl);
            if (prefab == null) return Array.Empty<AnimationClip>();
            Animation animation = prefab.GetComponentInChildren<Animation>(true);
            if (animation == null) return Array.Empty<AnimationClip>();

            var clips = new List<AnimationClip>();
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (AnimationState state in animation)
            {
                AnimationClip clip = state != null ? state.clip : null;
                if (clip != null && names.Add(clip.name)) clips.Add(clip);
            }
            return clips.ToArray();
        }

        public void ReplaceEntries(IEnumerable<Entry> values)
        {
            entries = values != null ? new List<Entry>(values) : new List<Entry>();
            entries.Sort((left, right) => string.CompareOrdinal(left.SourceUrl, right.SourceUrl));
            _byUrl = null;
        }

        public static string NormalizeUrl(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;
            string normalized = value.Trim().Replace('\\', '/');
            int query = normalized.IndexOfAny(new[] { '?', '#' });
            if (query >= 0) normalized = normalized.Substring(0, query);
            int lite = normalized.IndexOf("/assets/models-lite/", StringComparison.OrdinalIgnoreCase);
            if (lite >= 0)
                normalized = normalized.Substring(0, lite) + "/assets/models/"
                    + normalized.Substring(lite + "/assets/models-lite/".Length);
            int asset = normalized.IndexOf("/assets/models/", StringComparison.OrdinalIgnoreCase);
            if (asset >= 0) normalized = normalized.Substring(asset);
            if (!normalized.StartsWith("/", StringComparison.Ordinal)) normalized = "/" + normalized;
            return normalized.ToLowerInvariant();
        }

        private static GameObject FindPrefab(string sourceUrl)
        {
            if (_instance == null) _instance = Resources.Load<RoaModelPrefabCatalog>(ResourcePath);
            if (_instance == null) return null;
            _instance.EnsureIndex();
            _instance._byUrl.TryGetValue(NormalizeUrl(sourceUrl), out GameObject prefab);
            return prefab;
        }

        private void EnsureIndex()
        {
            if (_byUrl != null) return;
            _byUrl = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            if (entries == null) return;
            foreach (Entry entry in entries)
            {
                if (entry == null || entry.Prefab == null) continue;
                string key = NormalizeUrl(entry.SourceUrl);
                if (!string.IsNullOrEmpty(key)) _byUrl[key] = entry.Prefab;
            }
        }
    }
}
