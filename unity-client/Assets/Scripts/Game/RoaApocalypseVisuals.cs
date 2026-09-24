using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Places pack art at its native world size on existing gameplay sockets.</summary>
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
            SetNativeWorldScale(replacement.transform, prefab.transform.localScale);
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

            // Imported assets retain their authored scale. Only their position
            // changes to align with the existing world or gameplay socket.
            replacement.transform.localPosition = oldBounds.center - newBounds.center;
            foreach (Renderer renderer in legacy) renderer.enabled = false;
            return replacement;
        }

        public static void SetNativeWorldScale(Transform visual, Vector3 authoredScale)
        {
            if (visual == null || visual.parent == null) return;
            Vector3 inherited = visual.parent.lossyScale;
            visual.localScale = new Vector3(
                Mathf.Abs(inherited.x) > 0.0001f ? authoredScale.x / inherited.x : authoredScale.x,
                Mathf.Abs(inherited.y) > 0.0001f ? authoredScale.y / inherited.y : authoredScale.y,
                Mathf.Abs(inherited.z) > 0.0001f ? authoredScale.z / inherited.z : authoredScale.z);
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
