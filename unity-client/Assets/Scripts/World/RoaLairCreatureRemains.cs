using System;
using GLTFast;
using RealmOfAshes.Game;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Non-interactive traces of a lair's species. Live residents are created only
    /// by RoaEnemies from the server snapshot; these models never represent actors.
    /// </summary>
    public sealed class RoaLairCreatureRemains : MonoBehaviour
    {
        private const string AntlerNode = "lantern_symbiont_antlers";
        private string _modelKey;
        private bool _showBody;
        private bool _destroyed;

        public bool ShowsBody => _showBody;

        public void Initialize(string modelKey, bool showBody = false)
        {
            _modelKey = modelKey;
            _showBody = showBody;
        }

        /// <summary>Repository-relative source path for editor previews.</summary>
        public static string SourcePath(string modelKey)
        {
            if (!IsSupported(modelKey)) return string.Empty;
            return "public" + RoaEnemyModels.Url(modelKey);
        }

        /// <summary>
        /// Apply exactly the same inert presentation to an already instantiated GLB
        /// in the editor or at runtime. Returns false rather than showing an idle NPC.
        /// </summary>
        public static bool ConfigureStaticVisual(GameObject modelRoot, string modelKey,
            bool showBody = false)
        {
            if (modelRoot == null || !IsSupported(modelKey)) return false;

            Animation animation = modelRoot.GetComponentInChildren<Animation>(true);
            AnimationState death = animation != null ? animation["death"] : null;
            if (modelKey != "kromkaLantern" && death == null) return false;

            Transform antlers = null;
            if (modelKey == "kromkaLantern")
            {
                antlers = FindDeepChild(modelRoot.transform, AntlerNode);
                if (antlers == null) return false;
                bool hasAntlerRenderer = false;
                foreach (Renderer renderer in modelRoot.GetComponentsInChildren<Renderer>(true))
                    if (renderer.transform == antlers || renderer.transform.IsChildOf(antlers))
                        hasAntlerRenderer = true;
                if (!hasAntlerRenderer) return false;
            }

            RoaEnemyModels.RestoreApprovedScale(modelKey, modelRoot.transform);
            foreach (Collider collider in modelRoot.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;

            if (death != null)
            {
                animation.cullingType = AnimationCullingType.AlwaysAnimate;
                death.wrapMode = WrapMode.ClampForever;
                animation.Play("death", PlayMode.StopAll);
                death.enabled = true;
                death.weight = 1f;
                death.time = RoaCharacterView.FinalDeathPoseTime(death);
                death.speed = 0f;
                animation.Sample();
            }

            if (antlers != null && !showBody)
                foreach (Renderer renderer in modelRoot.GetComponentsInChildren<Renderer>(true))
                    renderer.enabled = renderer.transform == antlers
                        || renderer.transform.IsChildOf(antlers);

            // The packaged editor preview has no stag death clip. Lay that model
            // on its side; the runtime GLB uses its authored death pose instead.
            if (modelKey == "kromkaLantern" && showBody && death == null &&
                modelRoot.transform.parent != null)
            {
                Transform holder = modelRoot.transform.parent;
                holder.localRotation = Quaternion.Euler(
                    0f, holder.localEulerAngles.y, 40f);
            }

            float lowest = float.PositiveInfinity;
            foreach (Renderer renderer in modelRoot.GetComponentsInChildren<Renderer>(true))
                if (renderer.enabled) lowest = Mathf.Min(lowest, renderer.bounds.min.y);
            if (float.IsPositiveInfinity(lowest)) return false;
            float floor = modelRoot.transform.parent != null
                ? modelRoot.transform.parent.position.y : modelRoot.transform.position.y;
            modelRoot.transform.position += Vector3.up * (floor + 0.04f - lowest);

            return true;
        }

        private async void Start()
        {
            if (!IsSupported(_modelKey)) return;
            string path = RoaEnemyModels.Url(_modelKey);
            string url = RoaGameBootstrap.ActiveBaseUrl.TrimEnd('/') + path;
            GameObject holder = null;
            try
            {
                GltfImport import = await RoaEnemies.LoadCached(url);
                if (_destroyed) return;
                if (import == null)
                {
                    Debug.LogError("[ROA] Lair remains model failed to load: " + url);
                    return;
                }

                holder = new GameObject("LairRemainsModel_" + _modelKey);
                holder.transform.SetParent(transform, false);
                if (!await import.InstantiateMainSceneAsync(holder.transform))
                {
                    Destroy(holder);
                    Debug.LogError("[ROA] Lair remains model failed to instantiate: " + url);
                    return;
                }

                if (_destroyed)
                {
                    if (holder != null) Destroy(holder);
                    return;
                }
                if (!ConfigureStaticVisual(holder, _modelKey, _showBody))
                {
                    Destroy(holder);
                    Debug.LogError("[ROA] Lair remains lack required death pose or antlers: " + url);
                }
            }
            catch (Exception error)
            {
                if (holder != null) Destroy(holder);
                if (!_destroyed)
                    Debug.LogError("[ROA] Lair remains failed: " + url + ": " + error);
            }
        }

        private void OnDestroy()
        {
            _destroyed = true;
        }

        private static bool IsSupported(string modelKey)
        {
            return modelKey == "kromkaGari" || modelKey == "kromkaDustling"
                || modelKey == "kromkaLantern";
        }

        private static Transform FindDeepChild(Transform root, string name)
        {
            if (root.name == name) return root;
            foreach (Transform child in root)
            {
                Transform found = FindDeepChild(child, name);
                if (found != null) return found;
            }
            return null;
        }

    }
}
