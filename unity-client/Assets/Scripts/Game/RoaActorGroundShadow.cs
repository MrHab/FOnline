using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Cheap procedural contact shadow shared by every humanoid. It remains visible
    /// when real-time shadows are disabled and follows the height/normal sampled by
    /// foot IK. The quad has no collider and never affects authoritative gameplay.
    /// </summary>
    public sealed class RoaActorGroundShadow : IDisposable
    {
        private const int TextureSize = 48;
        private static Mesh _sharedMesh;
        private static Material _sharedMaterial;
        private static Texture2D _sharedTexture;
        private static int _users;

        private Transform _owner;
        private GameObject _node;
        private MeshRenderer _renderer;
        private bool _requestedActive = true;
        private bool _ownsSharedResources;

        public bool Ready { get { return _node != null && _renderer != null; } }
        public bool Visible { get { return Ready && _node.activeSelf && _renderer.enabled; } }
        public static int SharedUsers { get { return _users; } }

        public void Bind(Transform owner)
        {
            if (owner == null || (_owner == owner && Ready)) return;
            Dispose();
            _owner = owner;
            EnsureSharedResources();
            if (_sharedMesh == null || _sharedMaterial == null) return;

            _node = new GameObject("ActorContactShadow");
            _node.layer = owner.gameObject.layer;
            _node.transform.SetParent(owner, false);
            var filter = _node.AddComponent<MeshFilter>();
            filter.sharedMesh = _sharedMesh;
            _renderer = _node.AddComponent<MeshRenderer>();
            _renderer.sharedMaterial = _sharedMaterial;
            _renderer.shadowCastingMode = ShadowCastingMode.Off;
            _renderer.receiveShadows = false;
            _renderer.lightProbeUsage = LightProbeUsage.Off;
            _renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            _renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            _renderer.allowOcclusionWhenDynamic = false;
            _renderer.sortingOrder = -20;
            _users++;
            _ownsSharedResources = true;
            SetActive(_requestedActive);
        }

        public void SetActive(bool active)
        {
            _requestedActive = active;
            if (_node != null && _node.activeSelf != active) _node.SetActive(active);
        }

        public void UpdatePose(Vector3 actorPosition, float groundY, Vector3 groundNormal,
                               float actorYawDeg, bool dead, bool crouching)
        {
            if (!Ready || !_requestedActive) return;
            if (groundNormal.sqrMagnitude < 0.5f) groundNormal = Vector3.up;
            groundNormal.Normalize();

            Transform shadow = _node.transform;
            shadow.position = new Vector3(actorPosition.x, groundY + 0.016f, actorPosition.z);
            Quaternion yaw = Quaternion.AngleAxis(actorYawDeg, Vector3.up);
            shadow.rotation = Quaternion.FromToRotation(Vector3.up, groundNormal) * yaw;
            float width = dead ? 1.32f : (crouching ? 1.08f : 1f);
            float depth = dead ? 1.12f : (crouching ? 1.04f : 1f);
            shadow.localScale = new Vector3(width, 1f, depth);
        }

        public void Dispose()
        {
            if (_node != null) DestroyRuntime(_node);
            _node = null;
            _renderer = null;
            _owner = null;
            if (_ownsSharedResources && _users > 0) _users--;
            _ownsSharedResources = false;
            if (_users != 0) return;
            DestroyRuntime(_sharedMaterial);
            DestroyRuntime(_sharedMesh);
            DestroyRuntime(_sharedTexture);
            _sharedMaterial = null;
            _sharedMesh = null;
            _sharedTexture = null;
        }

        private static void EnsureSharedResources()
        {
            if (_sharedMesh != null && _sharedMaterial != null) return;
            _sharedTexture = CreateTexture();
            _sharedMesh = CreateMesh();
            _sharedMaterial = CreateMaterial(_sharedTexture);
        }

        private static Mesh CreateMesh()
        {
            var mesh = new Mesh { name = "SharedActorContactShadow" };
            mesh.vertices = new[]
            {
                new Vector3(-0.56f, 0f, -0.36f), new Vector3(0.56f, 0f, -0.36f),
                new Vector3(-0.56f, 0f, 0.36f), new Vector3(0.56f, 0f, 0.36f)
            };
            mesh.uv = new[]
            {
                new Vector2(0f, 0f), new Vector2(1f, 0f),
                new Vector2(0f, 1f), new Vector2(1f, 1f)
            };
            mesh.colors = new[] { Color.white, Color.white, Color.white, Color.white };
            mesh.triangles = new[] { 0, 2, 1, 1, 2, 3 };
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Texture2D CreateTexture()
        {
            var texture = new Texture2D(TextureSize, TextureSize, TextureFormat.RGBA32, false, true)
            {
                name = "ProceduralActorContactShadow",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            var pixels = new Color32[TextureSize * TextureSize];
            for (int y = 0; y < TextureSize; y++)
            for (int x = 0; x < TextureSize; x++)
            {
                float nx = ((x + 0.5f) / TextureSize - 0.5f) * 2f;
                float ny = ((y + 0.5f) / TextureSize - 0.5f) * 2f;
                float radial = Mathf.Clamp01(1f - Mathf.Sqrt(nx * nx + ny * ny));
                float alpha = Mathf.SmoothStep(0f, 1f, radial);
                alpha *= alpha * 0.34f;
                pixels[y * TextureSize + x] = new Color(0.12f, 0.085f, 0.045f, alpha);
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }

        private static Material CreateMaterial(Texture2D texture)
        {
            Shader shader = Shader.Find("Sprites/Default")
                ?? Shader.Find("Universal Render Pipeline/Particles/Unlit")
                ?? Shader.Find("Unlit/Transparent");
            if (shader == null) return null;
            var material = new Material(shader)
            {
                name = "SharedActorContactShadowMaterial",
                color = Color.white,
                renderQueue = (int)RenderQueue.Transparent - 20
            };
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            if (material.HasProperty("_Color")) material.SetColor("_Color", Color.white);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            return material;
        }

        private static void DestroyRuntime(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
