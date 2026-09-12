using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Release previous-session imports when domain reload is disabled.</summary>
    internal static class RoaModelImportLifetime
    {
        internal static void Clear(IDictionary<string, Task<GltfImport>> cache)
        {
            var previous = new HashSet<Task<GltfImport>>(cache.Values);
            cache.Clear();
            foreach (Task<GltfImport> loading in previous) Release(loading);
        }

        internal static void Clear(IDictionary<string, GltfImport> cache)
        {
            var previous = new HashSet<GltfImport>(cache.Values);
            cache.Clear();
            foreach (GltfImport import in previous) import?.Dispose();
        }

        internal static async void Release(Task<GltfImport> loading)
        {
            if (loading == null) return;
            try { (await loading)?.Dispose(); }
            catch (Exception error)
            {
                // A failed previous load must not prevent the new Play session.
                Debug.LogWarning("[ROA] Previous model import cleanup: " + error.Message);
            }
        }
    }
}
