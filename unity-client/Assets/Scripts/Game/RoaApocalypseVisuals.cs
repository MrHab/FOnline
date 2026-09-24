using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Fits new art to the old rig while keeping its gameplay sockets.</summary>
    public static class RoaApocalypseVisuals
    {
        public const string ChildName = "PolygonApocalypse_Visual";

        public static GameObject AttachStatic(Transform original, GameObject prefab, float yaw = 0f,
            float pitch = 0f)
        {
            if (original == null || prefab == null || original.Find(ChildName) != null) return null;
            if (original.name.StartsWith("EnemyModel:") && pitch <= 0f)
            {
                string key = original.name.Substring("EnemyModel:".Length);
                if (key == "enemyGhoul" || key == "enemySuperMutant"
                    || key == "kromkaBurned" || key == "kromkaFold")
                {
                    var skin = original.gameObject.AddComponent<RoaApocalypseCharacterSkin>();
                    if (skin.Bind(prefab, original)) return original.gameObject;
                    Object.Destroy(skin);
                }
            }
            var legacy = new List<Renderer>();
            foreach (Renderer renderer in original.GetComponentsInChildren<Renderer>(true))
                if (renderer.enabled && (renderer is MeshRenderer || renderer is SkinnedMeshRenderer))
                    legacy.Add(renderer);
            if (legacy.Count == 0) return null;

            Bounds oldBounds = LocalBounds(original, legacy);
            GameObject replacement = Object.Instantiate(prefab, original, false);
            replacement.name = ChildName;
            replacement.transform.localRotation = Quaternion.Euler(pitch, yaw, 0f);
            foreach (Animator animator in replacement.GetComponentsInChildren<Animator>(true))
                animator.enabled = false;
            foreach (Collider collider in replacement.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
            if (pitch > 0f)
                replacement.AddComponent<RoaApocalypseCreaturePose>().ApplyRestPose(original);
            var newRenderers = new List<Renderer>();
            foreach (Renderer renderer in replacement.GetComponentsInChildren<Renderer>(true))
                if (renderer.enabled && ActiveWithin(renderer.transform, replacement.transform))
                    newRenderers.Add(renderer);
            Bounds newBounds = LocalBounds(original, newRenderers);
            if (newBounds.size.sqrMagnitude < 0.000001f)
            {
                Object.Destroy(replacement);
                return null;
            }

            if (pitch > 0f)
            {
                float oldFootprint = Mathf.Max(oldBounds.size.x, oldBounds.size.z);
                float newFootprint = Mathf.Max(newBounds.size.x, newBounds.size.z);
                float scale = Mathf.Clamp(Mathf.Min(
                    oldBounds.size.y / Mathf.Max(newBounds.size.y, 0.01f),
                    oldFootprint / Mathf.Max(newFootprint, 0.01f)), 0.05f, 8f);
                replacement.transform.localScale = Vector3.one * scale;
            }
            else if (prefab.name.Contains("Grenade") || prefab.name.Contains("Flashbang")
                || prefab.name.Contains("Molotov") || prefab.name.Contains("Bomb"))
            {
                float targetSize = prefab.name.Contains("Grenade") || prefab.name.Contains("Flashbang")
                    ? 0.18f : prefab.name.Contains("Molotov") ? 0.28f : 0.3f;
                float longest = Mathf.Max(newBounds.size.x, newBounds.size.y, newBounds.size.z);
                replacement.transform.localScale = Vector3.one
                    * Mathf.Clamp(targetSize / Mathf.Max(longest, 0.01f), 0.05f, 8f);
            }
            else if (prefab.name.StartsWith("SM_Wep_"))
            {
                // A sword, a grenade and a rifle must keep their own silhouette.
                // Stretching every axis to the legacy rig turned long blades into
                // knife-sized clubs and flattened many firearm variants.
                float scale = oldBounds.size.magnitude
                    / Mathf.Max(newBounds.size.magnitude, 0.01f);
                replacement.transform.localScale = Vector3.one * Mathf.Clamp(scale, 0.05f, 8f);
            }
            else replacement.transform.localScale = new Vector3(
                    Mathf.Clamp(oldBounds.size.x / Mathf.Max(newBounds.size.x, 0.01f), 0.05f, 8f),
                    Mathf.Clamp(oldBounds.size.y / Mathf.Max(newBounds.size.y, 0.01f), 0.05f, 8f),
                    Mathf.Clamp(oldBounds.size.z / Mathf.Max(newBounds.size.z, 0.01f), 0.05f, 8f));
            Bounds fitted = LocalBounds(original, newRenderers);
            replacement.transform.localPosition = oldBounds.center - fitted.center;
            foreach (Renderer renderer in legacy) renderer.enabled = false;
            return replacement;
        }

        private static bool ActiveWithin(Transform node, Transform root)
        {
            for (Transform item = node; item != null; item = item.parent)
            {
                if (!item.gameObject.activeSelf) return false;
                if (item == root) return true;
            }
            return false;
        }

        public static Bounds LocalBounds(Transform root, IEnumerable<Renderer> renderers)
        {
            Bounds bounds = default;
            bool found = false;
            foreach (Renderer renderer in renderers)
            {
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                Mesh mesh = filter != null ? filter.sharedMesh : null;
                Bounds source = renderer is SkinnedMeshRenderer skin
                    ? skin.sharedMesh != null ? skin.sharedMesh.bounds : skin.localBounds
                    : mesh != null ? mesh.bounds : renderer.localBounds;
                Matrix4x4 matrix = root.worldToLocalMatrix * renderer.transform.localToWorldMatrix;
                for (int x = 0; x < 2; x++)
                for (int y = 0; y < 2; y++)
                for (int z = 0; z < 2; z++)
                {
                    Vector3 point = matrix.MultiplyPoint3x4(new Vector3(
                        x == 0 ? source.min.x : source.max.x,
                        y == 0 ? source.min.y : source.max.y,
                        z == 0 ? source.min.z : source.max.z));
                    if (!found) { bounds = new Bounds(point, Vector3.zero); found = true; }
                    else bounds.Encapsulate(point);
                }
            }
            return bounds;
        }
    }
}
