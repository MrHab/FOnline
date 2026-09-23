using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Shared metre-scale CC0 item models for drops, hands and artifact fields.</summary>
    public static class RoaItemModelCatalog
    {
        // Updated together with models-lite by tools/build-free-item-models.js.
        public const string CatalogVersion = "1-e97f4e39";
        public static readonly Vector3 MedicalPalmOffset = new Vector3(0f, .085f, .02f);
        private static readonly HashSet<string> Items = new HashSet<string>(StringComparer.Ordinal)
        {
            "artifactDetectorMk1", "artifactDetectorMk2", "artifactDetectorMk3",
            "artifactBelt2", "artifactBelt3", "artifactBelt4", "artifactContainer", "blue", "medkit",
            "artifactSpring", "artifactVein", "artifactNode", "artifactDrop", "artifactBloodkin",
            "artifactShell", "artifactWarmer", "artifactSieve", "artifactThunderer", "artifactHusher",
            "artifactAnchor", "artifactDew", "artifactMemory", "artifactUnknown"
        };
        private static readonly Dictionary<string, Task<GltfImport>> Cache =
            new Dictionary<string, Task<GltfImport>>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetModelCache() => RoaModelImportLifetime.Clear(Cache);

        public static bool Contains(string itemId) { return itemId != null && Items.Contains(itemId); }

        public static string ModelPath(string itemId)
        {
            return Contains(itemId) ? "/assets/models/items/kromka/item_" + itemId
                + ".glb?v=item-catalog-" + CatalogVersion : string.Empty;
        }

        public static string ArtifactItemId(string revealedTypeId)
        {
            // Mk1/Mk2 snapshots deliberately omit identity. Never infer it from id or signal.
            switch (revealedTypeId)
            {
                case "spring": return "artifactSpring";
                case "vein": return "artifactVein";
                case "node": return "artifactNode";
                case "drop": return "artifactDrop";
                case "bloodkin": return "artifactBloodkin";
                case "shell": return "artifactShell";
                case "warmer": return "artifactWarmer";
                case "sieve": return "artifactSieve";
                case "thunderer": return "artifactThunderer";
                case "husher": return "artifactHusher";
                case "anchor": return "artifactAnchor";
                case "dew": return "artifactDew";
                case "memory": return "artifactMemory";
                default: return "artifactUnknown";
            }
        }

        /// <summary>The caller activates only after validating its current equipment/snapshot request.</summary>
        public static async Task<GameObject> InstantiateInactive(string origin, string itemId, Transform parent)
        {
            if (parent == null || !Contains(itemId)) return null;
            GameObject holder = null;
            try
            {
                string url = (origin ?? string.Empty).TrimEnd('/') + ModelPath(itemId);
                GltfImport import = await LoadCached(url);
                if (import == null || parent == null) return null;
                holder = new GameObject("ItemModel:" + itemId);
                holder.SetActive(false);
                holder.transform.SetParent(parent, false);
                if (await import.InstantiateMainSceneAsync(holder.transform)
                    && holder != null && parent != null
                    && holder.GetComponentsInChildren<Renderer>(true).Length > 0)
                {
                    RoaApocalypseVisuals.AttachStatic(holder.transform, RoaApocalypseModels.Item(itemId));
                    return holder;
                }
            }
            catch (MissingReferenceException) { /* Owner disappeared during import. */ }
            catch (Exception error) { Debug.LogWarning("[ROA] Item model " + itemId + ": " + error.Message); }
            if (holder != null) UnityEngine.Object.Destroy(holder);
            return null;
        }

        private static async Task<GltfImport> LoadCached(string url)
        {
            if (Cache.TryGetValue(url, out Task<GltfImport> cached)) return await cached;
            Task<GltfImport> loading = LoadImport(url);
            Cache[url] = loading;
            GltfImport import = await loading;
            if (import == null) Cache.Remove(url);
            return import;
        }

        private static async Task<GltfImport> LoadImport(string url)
        {
            var import = new GltfImport();
            try
            {
                if (await import.Load(RoaModelUrl.Lite(url),
                    new ImportSettings { AnimationMethod = AnimationMethod.None })) return import;
            }
            catch (Exception error) { Debug.LogWarning("[ROA] Item download: " + error.Message); }
            import.Dispose();
            return null;
        }

        public static Transform FindSocket(Transform root, string socketName)
        {
            if (root == null) return null;
            foreach (Transform child in root.GetComponentsInChildren<Transform>(true))
                if (child.name == socketName) return child;
            return null;
        }

        public static bool MountMedicalCase(GameObject model, Transform hand)
        {
            Transform grip = model != null ? FindSocket(model.transform, "socket_grip_r") : null;
            if (grip == null || hand == null) return false;
            Transform root = model.transform;
            root.SetParent(hand, false);
            // Hand-bone +Y runs from wrist toward fingers, opposite to the case's upright +Y.
            root.localRotation = Quaternion.Euler(180f, 0f, 0f);
            root.localPosition = Vector3.zero;
            // The case handle, not its centre or importer root, sits in the palm.
            root.position += hand.TransformPoint(MedicalPalmOffset) - grip.position;
            return true;
        }
    }
}
