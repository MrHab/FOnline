using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>Small scene-only objects for NPC actions; they have no collision or gameplay state.</summary>
    public static class RoaNpcActionPropVisual
    {
        private static Material _grenadeBody;
        private static Material _grenadeMetal;
        private static Material _bandageCloth;
        private static Material _bandageCore;

        public static GameObject CreateGrenade(Transform parent)
        {
            GameObject root = Root("NpcGrenadeVisual", parent);
            Part(root.transform, "Body", PrimitiveType.Capsule,
                Vector3.zero, Vector3.one * 0.055f,
                Quaternion.identity, ref _grenadeBody, new Color(0.24f, 0.29f, 0.17f));
            Part(root.transform, "Cap", PrimitiveType.Cylinder,
                Vector3.up * 0.064f, new Vector3(0.031f, 0.012f, 0.031f),
                Quaternion.identity, ref _grenadeMetal, new Color(0.55f, 0.57f, 0.51f));
            Part(root.transform, "Lever", PrimitiveType.Cube,
                new Vector3(0.034f, 0.069f, 0f), new Vector3(0.012f, 0.085f, 0.018f),
                Quaternion.Euler(0f, 0f, -18f), ref _grenadeMetal,
                new Color(0.55f, 0.57f, 0.51f));
            return root;
        }

        public static GameObject CreateBandage(Transform parent)
        {
            GameObject root = Root("NpcBandageVisual", parent);
            Quaternion rollAxis = Quaternion.Euler(0f, 0f, 90f);
            Part(root.transform, "GauzeRoll", PrimitiveType.Cylinder,
                Vector3.zero, new Vector3(0.052f, 0.017f, 0.052f), rollAxis,
                ref _bandageCloth, new Color(0.89f, 0.86f, 0.72f));
            Part(root.transform, "GauzeCore", PrimitiveType.Cylinder,
                new Vector3(-0.019f, 0f, 0f), new Vector3(0.017f, 0.002f, 0.017f),
                rollAxis, ref _bandageCore, new Color(0.46f, 0.40f, 0.30f));
            Part(root.transform, "LooseEnd", PrimitiveType.Cube,
                new Vector3(0.013f, -0.065f, -0.032f),
                new Vector3(0.032f, 0.11f, 0.008f), Quaternion.Euler(-14f, 0f, -9f),
                ref _bandageCloth, new Color(0.89f, 0.86f, 0.72f));
            return root;
        }

        private static GameObject Root(string name, Transform parent)
        {
            GameObject root = new GameObject(name);
            root.hideFlags = HideFlags.DontSave;
            if (parent != null)
            {
                root.transform.SetParent(parent, false);
                root.layer = parent.gameObject.layer;
            }
            return root;
        }

        private static void Part(Transform parent, string name, PrimitiveType primitive,
            Vector3 position, Vector3 scale, Quaternion rotation,
            ref Material sharedMaterial, Color color)
        {
            GameObject part = GameObject.CreatePrimitive(primitive);
            part.name = name;
            part.hideFlags = HideFlags.DontSave;
            part.transform.SetParent(parent, false);
            part.layer = parent.gameObject.layer;
            part.transform.localPosition = position;
            part.transform.localRotation = rotation;
            part.transform.localScale = scale;
            Collider collider = part.GetComponent<Collider>();
            if (collider != null) collider.enabled = false;
            Renderer renderer = part.GetComponent<Renderer>();
            if (sharedMaterial == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit")
                    ?? Shader.Find("Standard") ?? Shader.Find("Diffuse");
                sharedMaterial = new Material(shader) { hideFlags = HideFlags.DontSave };
                if (sharedMaterial.HasProperty("_BaseColor"))
                    sharedMaterial.SetColor("_BaseColor", color);
                if (sharedMaterial.HasProperty("_Color"))
                    sharedMaterial.SetColor("_Color", color);
            }
            renderer.sharedMaterial = sharedMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }
    }
}
