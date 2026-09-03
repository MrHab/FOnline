using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    public enum RoaStrategicActorFitMode
    {
        Height,
        Footprint
    }

    public struct RoaStrategicActorProfile
    {
        public float TargetWorldSpan;
        public float GroundDropWorld;
        public float YawOffset;
        public RoaStrategicActorFitMode FitMode;
        public Bounds AnimatedLocalBounds;
        public bool HasAnimatedBounds
        {
            get { return AnimatedLocalBounds.size.sqrMagnitude > 0.000001f; }
        }

        public RoaStrategicActorProfile(float targetWorldSpan, float groundDropWorld,
                                        float yawOffset, RoaStrategicActorFitMode fitMode,
                                        Bounds animatedLocalBounds)
        {
            TargetWorldSpan = targetWorldSpan;
            GroundDropWorld = groundDropWorld;
            YawOffset = yawOffset;
            FitMode = fitMode;
            AnimatedLocalBounds = animatedLocalBounds;
        }
    }

    /// <summary>
    /// Lightweight strategic-map representation of one player or world party.
    /// The authoritative marker remains the host object and therefore keeps its
    /// selection colour and semantic-zoom behaviour; this component adds the real
    /// character/creature GLB and drives only presentation animation and facing.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaGlobalMapActorView : MonoBehaviour
    {
        private const float HumanoidWalkVisualSpeed = 1.26f;
        private const string ModelPivotName = "StrategicActorModel";
        private const string ModelContentName = "StrategicActorContent";

        private static readonly Dictionary<string, Task<GltfImport>> ModelCache =
            new Dictionary<string, Task<GltfImport>>(StringComparer.Ordinal);

        private Transform _modelPivot;
        private Transform _modelContent;
        private RoaCharacterView _character;
        private Animation _animation;
        private string _clip = string.Empty;
        private string _signature = string.Empty;
        private Task _configurationTask;
        private Vector3 _motionDirection = Vector3.forward;
        private bool _moving;
        private int _loadVersion;
        private float _yawOffset;
        private bool _usesProjectPrefab;
        private RoaActorPresentationTier _presentationTier = RoaActorPresentationTier.Near;
        private RoaStrategicActorProfile _profile;

        public bool Ready { get; private set; }
        public bool IsPlayer { get; private set; }
        public bool IsHumanoid { get; private set; }
        public string ModelKey { get; private set; } = string.Empty;
        public RoaActorPresentationTier PresentationTier { get { return _presentationTier; } }
        public RoaStrategicActorProfile StrategicProfile { get { return _profile; } }
        public bool ModelVisible
        {
            get { return _modelPivot != null && _modelPivot.gameObject.activeSelf; }
        }
        public bool UsesProjectPrefab
        {
            get { return _character != null ? _character.UsesProjectPrefab : _usesProjectPrefab; }
        }
        public string MotionClip { get { return _character != null ? _character.CurrentClip : _clip; } }
        public int ModelRendererCount
        {
            get
            {
                return _modelPivot == null
                    ? 0
                    : _modelPivot.GetComponentsInChildren<Renderer>(true).Length;
            }
        }
        public int EnabledAnimationCount
        {
            get
            {
                if (_modelPivot == null) return 0;
                int count = 0;
                foreach (Animation animation in _modelPivot.GetComponentsInChildren<Animation>(true))
                    if (animation != null && animation.enabled) count++;
                return count;
            }
        }

        public Task ConfigurePlayer(string baseUrl, JObject self)
        {
            JObject appearance = self?["appearance"] as JObject ?? new JObject();
            JObject equipment = PlayerEquipment(self);
            string signature = "player|" + CompactJson(appearance) + "|" + CompactJson(equipment);
            return Configure(signature, baseUrl, "player", true, appearance, equipment);
        }

        public Task ConfigureParty(string baseUrl, JObject party)
        {
            string modelKey = ResolvePartyModelKey(
                party?["kind"]?.ToString(),
                party?["faction"]?.ToString(),
                party?["species"]?.ToString(),
                party?["visual"]?.ToString());
            bool humanoid = RoaEnemyModels.IsUnifiedHumanoid(modelKey,
                party?["visual"]?.ToString(), party?["species"]?.ToString());
            JObject appearance = humanoid ? PartyAppearance(party) : null;
            JObject equipment = humanoid ? PartyEquipment(modelKey) : null;
            string signature = "party|" + modelKey + "|" + CompactJson(appearance)
                + "|" + CompactJson(equipment);
            return Configure(signature, baseUrl, modelKey, humanoid, appearance, equipment);
        }

        public void SetPresentationLod(RoaActorPresentationTier tier)
        {
            if (_presentationTier == tier && _modelPivot != null) return;
            _presentationTier = tier;
            ApplyPresentationBudget();
        }

        public void SetMotion(Vector3 worldDirection, bool moving)
        {
            worldDirection.y = 0f;
            if (worldDirection.sqrMagnitude > 0.000001f)
                _motionDirection = worldDirection.normalized;
            _moving = moving && _motionDirection.sqrMagnitude > 0.000001f;

            if (_modelPivot != null && _motionDirection.sqrMagnitude > 0.000001f)
            {
                Vector3 localDirection = transform.InverseTransformDirection(_motionDirection);
                localDirection.y = 0f;
                if (localDirection.sqrMagnitude > 0.000001f)
                {
                    float yaw = Mathf.Atan2(localDirection.x, localDirection.z) * Mathf.Rad2Deg;
                    _modelPivot.localRotation = Quaternion.Slerp(_modelPivot.localRotation,
                        Quaternion.Euler(0f, yaw + _yawOffset, 0f),
                        1f - Mathf.Exp(-12f * Mathf.Max(0.001f, Time.unscaledDeltaTime)));
                }
            }

            ApplyPresentationBudget();
        }

        public bool TryGetModelWorldBounds(out Bounds bounds)
        {
            bounds = default;
            if (_modelPivot == null) return false;
            Renderer[] renderers = _modelPivot.GetComponentsInChildren<Renderer>(true);
            bool found = false;
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                if (renderer == null || !renderer.enabled) continue;
                if (!found)
                {
                    bounds = renderer.bounds;
                    found = true;
                }
                else bounds.Encapsulate(renderer.bounds);
            }
            return found;
        }

        private Transform _banner;
        private Material _bannerFlagMaterial;
        private Material _bannerPoleMaterial;

        /// <summary>
        /// Фракционный штандарт над отрядом — читаемость принадлежности с любого
        /// зума, как знамёна армий в стратегиях. Чистая презентация: кликов не
        /// перехватывает (коллайдеры примитивов удаляются), масштабируется вместе
        /// с актёром.
        /// </summary>
        public void SetBanner(Color color, bool visible = true)
        {
            if (!visible)
            {
                if (_banner != null) _banner.gameObject.SetActive(false);
                return;
            }
            if (_banner == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                    ?? Shader.Find("Unlit/Color")
                    ?? Shader.Find("Sprites/Default");
                if (shader == null) return;
                _bannerPoleMaterial = new Material(shader) { name = "PartyBannerPole" };
                ApplyBannerColor(_bannerPoleMaterial, new Color(0.16f, 0.13f, 0.10f));
                _bannerFlagMaterial = new Material(shader) { name = "PartyBannerFlag" };

                var root = new GameObject("PartyBanner");
                _banner = root.transform;
                _banner.SetParent(transform, false);

                GameObject pole = GameObject.CreatePrimitive(PrimitiveType.Cube);
                pole.name = "Pole";
                Destroy(pole.GetComponent<Collider>());
                pole.transform.SetParent(_banner, false);
                pole.transform.localPosition = new Vector3(0f, 1.05f, 0f);
                pole.transform.localScale = new Vector3(0.045f, 2.1f, 0.045f);
                ConfigureBannerRenderer(pole, _bannerPoleMaterial);

                GameObject flag = GameObject.CreatePrimitive(PrimitiveType.Cube);
                flag.name = "Flag";
                Destroy(flag.GetComponent<Collider>());
                flag.transform.SetParent(_banner, false);
                flag.transform.localPosition = new Vector3(0.34f, 1.86f, 0f);
                flag.transform.localScale = new Vector3(0.64f, 0.4f, 0.02f);
                ConfigureBannerRenderer(flag, _bannerFlagMaterial);
            }
            _banner.gameObject.SetActive(true);
            ApplyBannerColor(_bannerFlagMaterial, color);
        }

        private static void ConfigureBannerRenderer(GameObject go, Material material)
        {
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        private static void ApplyBannerColor(Material material, Color color)
        {
            if (material == null) return;
            material.color = color;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
        }

        private void OnDestroy()
        {
            if (_bannerFlagMaterial != null) Destroy(_bannerFlagMaterial);
            if (_bannerPoleMaterial != null) Destroy(_bannerPoleMaterial);
        }

        public bool TryGetStrategicWorldBounds(out Bounds bounds)
        {
            bounds = default;
            if (_modelContent == null) return false;
            Bounds source;
            if (_profile.HasAnimatedBounds) source = _profile.AnimatedLocalBounds;
            else if (!TryRendererContentBounds(out source)) return false;

            bool found = false;
            Vector3 min = source.min;
            Vector3 max = source.max;
            for (int corner = 0; corner < 8; corner++)
            {
                Vector3 local = new Vector3(
                    (corner & 1) == 0 ? min.x : max.x,
                    (corner & 2) == 0 ? min.y : max.y,
                    (corner & 4) == 0 ? min.z : max.z);
                Vector3 world = _modelContent.TransformPoint(local);
                if (!found)
                {
                    bounds = new Bounds(world, Vector3.zero);
                    found = true;
                }
                else bounds.Encapsulate(world);
            }
            return found;
        }

        public float CurrentWorldSpan
        {
            get
            {
                if (_modelContent == null) return 0f;
                Bounds source;
                if (_profile.HasAnimatedBounds) source = _profile.AnimatedLocalBounds;
                else if (!TryRendererContentBounds(out source)) return 0f;
                Vector3 scale = _modelContent.lossyScale;
                float worldScale = Mathf.Max(Mathf.Abs(scale.x),
                    Mathf.Max(Mathf.Abs(scale.y), Mathf.Abs(scale.z)));
                return ProfileSpan(source.size, _profile.FitMode) * worldScale;
            }
        }

        public static RoaStrategicActorProfile ProfileFor(string modelKey)
        {
            return ProfileFor(modelKey, string.Empty);
        }

        public static RoaStrategicActorProfile ProfileFor(string modelKey, string sex)
        {
            switch (modelKey ?? string.Empty)
            {
                case "player":
                    return HumanoidProfile(2.15f, 0.50f, sex);
                // Доворот берётся из единого источника RoaEnemyModels.YawOffset,
                // чтобы разворот отрядов на глобальной карте совпадал с боем и не
                // расходился при правках (скорпион/муравей — 180°, остальные — 0°).
                case "enemySuperMutant":
                    return Profile(1.95f, 0.37f, RoaEnemyModels.YawOffset(modelKey),
                        RoaStrategicActorFitMode.Height,
                        BoundsOf(0.005f, 1.053f, 0.047f, 0.953f, 2.147f, 1.196f));
                case "enemyGhoul":
                    return Profile(1.68f, 0.37f, RoaEnemyModels.YawOffset(modelKey),
                        RoaStrategicActorFitMode.Height,
                        BoundsOf(0.004f, 0.906f, 0.032f, 0.770f, 1.838f, 0.992f));
                case "friendlyBrahmin":
                case "brahmin":
                    return Profile(1.95f, 0.37f, RoaEnemyModels.YawOffset(modelKey),
                        RoaStrategicActorFitMode.Footprint,
                        BoundsOf(0.063f, 1.193f, -0.354f, 2.922f, 2.388f, 3.280f));
                case "enemyAshWolf":
                    return Profile(1.72f, 0.37f, RoaEnemyModels.YawOffset(modelKey),
                        RoaStrategicActorFitMode.Footprint,
                        BoundsOf(0f, 0.958f, 0.053f, 0.916f, 1.916f, 3.266f));
                case "enemyGecko":
                case "enemyFireGecko":
                    return Profile(1.75f, 0.37f, RoaEnemyModels.YawOffset(modelKey),
                        RoaStrategicActorFitMode.Footprint,
                        BoundsOf(0f, 1.451f, 0.501f, 2.122f, 2.903f, 5.216f));
                case "enemyRadscorpion":
                    return Profile(1.82f, 0.37f, RoaEnemyModels.YawOffset(modelKey),
                        RoaStrategicActorFitMode.Footprint,
                        BoundsOf(-0.025f, 0.629f, 0.243f, 2.340f, 1.257f, 2.303f));
                case "enemyMutantAnt":
                    return Profile(1.68f, 0.37f, RoaEnemyModels.YawOffset(modelKey),
                        RoaStrategicActorFitMode.Footprint,
                        BoundsOf(0f, 0.355f, -0.011f, 2.053f, 0.708f, 2.186f));
                default:
                    RoaStrategicActorProfile humanoid = HumanoidProfile(1.68f, 0.37f, sex);
                    humanoid.YawOffset = RoaEnemyModels.YawOffset(modelKey);
                    return humanoid;
            }
        }

        public static string ResolvePartyModelKey(string kind, string faction,
                                                  string species, string visual)
        {
            string normalizedKind = Normalize(kind);
            if (normalizedKind == "caravan") return "friendlyBrahmin";
            if (normalizedKind == "patrol") return "klimPatrolGuard";

            string resolved = RoaEnemyModels.ResolveKey(string.Empty, visual, species);
            if (!string.IsNullOrEmpty(RoaEnemyModels.Url(resolved))) return resolved;

            string normalizedFaction = Normalize(faction);
            if (normalizedFaction == "mutants" || normalizedKind == "mutant")
                return "enemySuperMutant";
            if (normalizedFaction == "raiders" || normalizedKind == "raider")
                return "enemyRaider";
            if (normalizedFaction == "wild" || normalizedKind == "monster")
                return "enemyAshWolf";
            return "wastelandSettler";
        }

        private Task Configure(string signature, string baseUrl, string modelKey,
                               bool humanoid, JObject appearance, JObject equipment)
        {
            string endpoint = (baseUrl ?? string.Empty).Trim().TrimEnd('/');
            string fullSignature = endpoint + "|" + signature;
            if (fullSignature == _signature)
            {
                if (Ready) return Task.CompletedTask;
                if (_configurationTask != null && !_configurationTask.IsCompleted)
                    return _configurationTask;
            }

            float referenceHostScale = Mathf.Max(0.0001f,
                Mathf.Max(Mathf.Abs(transform.lossyScale.x),
                    Mathf.Max(Mathf.Abs(transform.lossyScale.y),
                              Mathf.Abs(transform.lossyScale.z))));
            _configurationTask = ConfigureAsync(fullSignature, endpoint, modelKey,
                humanoid, appearance, equipment, referenceHostScale);
            return _configurationTask;
        }

        private async Task ConfigureAsync(string signature, string baseUrl, string modelKey,
                                          bool humanoid, JObject appearance,
                                          JObject equipment,
                                          float referenceHostScale)
        {

            _signature = signature;
            int version = ++_loadVersion;
            Ready = false;
            IsPlayer = modelKey == "player";
            IsHumanoid = humanoid;
            ModelKey = modelKey;
            _profile = ProfileFor(modelKey, appearance?["sex"]?.ToString());
            _yawOffset = _profile.YawOffset;
            _clip = string.Empty;
            _animation = null;
            _character = null;
            _usesProjectPrefab = false;

            if (_modelPivot != null) Destroy(_modelPivot.gameObject);
            var pivotObject = new GameObject(ModelPivotName);
            _modelPivot = pivotObject.transform;
            _modelPivot.SetParent(transform, false);
            var contentObject = new GameObject(ModelContentName);
            _modelContent = contentObject.transform;
            _modelContent.SetParent(_modelPivot, false);

            try
            {
                if (humanoid)
                {
                    _character = contentObject.AddComponent<RoaCharacterView>();
                    _character.SetPresentationLod(RoaActorPresentationTier.Far);
                    await _character.Load(baseUrl, appearance);
                    if (!LoadIsCurrent(version) || !_character.Ready) return;

                    string weapon = equipment?["weapon"]?.ToString() ?? string.Empty;
                    await Task.WhenAll(
                        _character.EquipWeapon(baseUrl, weapon),
                        _character.EquipItems(baseUrl, equipment ?? new JObject()));
                    if (!LoadIsCurrent(version)) return;
                }
                else
                {
                    string relative = RoaEnemyModels.Url(modelKey);
                    if (string.IsNullOrEmpty(relative))
                        throw new InvalidOperationException("No strategic-map GLB for " + modelKey + ".");
                    GameObject prefabInstance;
                    _usesProjectPrefab = RoaModelPrefabCatalog.TryInstantiate(
                        relative, _modelContent, out prefabInstance);
                    if (!_usesProjectPrefab)
                    {
                        string url = baseUrl.TrimEnd('/') + relative;
                        GltfImport import = await LoadCached(url);
                        if (!LoadIsCurrent(version) || import == null) return;
                        if (!await import.InstantiateMainSceneAsync(_modelContent))
                            throw new InvalidOperationException("Could not instantiate " + url + ".");
                    }
                    if (!LoadIsCurrent(version)) return;

                    _modelPivot.localRotation = Quaternion.Euler(0f, _yawOffset, 0f);
                    _animation = _modelPivot.GetComponentInChildren<Animation>(true);
                    if (_animation != null)
                    {
                        _animation.wrapMode = WrapMode.Loop;
                        _animation.cullingType = AnimationCullingType.BasedOnRenderers;
                    }
                }

                ConfigureStrategicRenderers();
                FitToStrategicSize(_profile, referenceHostScale);
                Ready = ModelRendererCount > 0;
                ApplyPresentationBudget();
                if (!Ready)
                    Debug.LogWarning("[ROA] Strategic actor has no renderer: " + modelKey, this);
            }
            catch (MissingReferenceException)
            {
                // The map or this party was closed while its shared GLB was loading.
            }
            catch (Exception error)
            {
                if (LoadIsCurrent(version))
                    Debug.LogError("[ROA] Strategic actor model failed ('" + modelKey + "'): "
                        + error, this);
            }
            finally
            {
                if (version == _loadVersion)
                {
                    if (!Ready)
                    {
                        _signature = string.Empty;
                        if (_modelPivot != null) Destroy(_modelPivot.gameObject);
                        _modelPivot = null;
                        _modelContent = null;
                        _character = null;
                        _animation = null;
                    }
                    _configurationTask = null;
                }
            }
        }

        private void ApplyMotionPresentation()
        {
            if (_presentationTier == RoaActorPresentationTier.Hidden) return;
            if (_character != null)
            {
                _character.UpdateLocomotion(_moving
                        ? Vector3.forward * HumanoidWalkVisualSpeed : Vector3.zero,
                    0f, _moving, false);
                return;
            }
            if (_animation == null) return;
            PlayCreatureClip(_moving ? "walk" : "idle");
        }

        private void ApplyPresentationBudget()
        {
            if (_modelPivot == null) return;
            bool visible = _presentationTier != RoaActorPresentationTier.Hidden;
            if (_modelPivot.gameObject.activeSelf != visible)
                _modelPivot.gameObject.SetActive(visible);

            if (_character != null)
                _character.SetPresentationLod(visible
                    ? RoaActorPresentationTier.Far : RoaActorPresentationTier.Hidden);
            Animation[] animations = _modelPivot.GetComponentsInChildren<Animation>(true);
            if (!visible)
            {
                for (int i = 0; i < animations.Length; i++)
                    if (animations[i] != null) animations[i].enabled = false;
                return;
            }

            bool animate = _presentationTier == RoaActorPresentationTier.Near || _moving;
            for (int i = 0; i < animations.Length; i++)
            {
                Animation animation = animations[i];
                if (animation == null) continue;
                if (!animate && animation.enabled) FreezeToIdle(animation);
                animation.enabled = animate;
            }
            if (animate) ApplyMotionPresentation();
        }

        private static void FreezeToIdle(Animation animation)
        {
            AnimationClip idle = animation.GetClip("idle");
            if (idle == null) return;
            animation.Play("idle");
            AnimationState state = animation["idle"];
            if (state != null) state.time = 0f;
            animation.Sample();
        }

        private void PlayCreatureClip(string requested)
        {
            if (_animation == null || _clip == requested) return;
            string selected = requested;
            if (_animation.GetClip(selected) == null)
                selected = _animation.GetClip("idle") != null ? "idle" : string.Empty;
            if (string.IsNullOrEmpty(selected) || _clip == selected) return;
            _clip = selected;
            AnimationState state = _animation[selected];
            state.wrapMode = WrapMode.Loop;
            state.speed = 1f;
            _animation.CrossFade(selected, 0.12f);
        }

        private void ConfigureStrategicRenderers()
        {
            if (_modelPivot == null) return;
            foreach (Renderer renderer in _modelPivot.GetComponentsInChildren<Renderer>(true))
            {
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                renderer.lightProbeUsage = LightProbeUsage.Off;
                renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
                if (renderer is SkinnedMeshRenderer skinned)
                    // Imported accessor bounds do not contain the full idle/walk
                    // deformation envelope. Keeping skinning alive avoids limbs
                    // being culled at the edge of the strategic camera; semantic
                    // LOD below still pauses animation for distant stationary actors.
                    skinned.updateWhenOffscreen = true;
            }
            foreach (Collider collider in _modelPivot.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
        }

        private void FitToStrategicSize(RoaStrategicActorProfile profile,
                                        float referenceHostScale)
        {
            if (_modelContent == null) return;
            Bounds bounds;
            if (profile.HasAnimatedBounds) bounds = profile.AnimatedLocalBounds;
            else if (!TryRendererContentBounds(out bounds)) return;
            float sourceSpan = ProfileSpan(bounds.size, profile.FitMode);
            if (sourceSpan <= 0.0001f) return;
            float safeHostScale = Mathf.Max(0.0001f, referenceHostScale);
            float factor = Mathf.Clamp(profile.TargetWorldSpan / (sourceSpan * safeHostScale),
                0.02f, 40f);
            _modelContent.localScale = Vector3.one * factor;
            _modelContent.localPosition = new Vector3(
                -bounds.center.x * factor,
                -profile.GroundDropWorld / safeHostScale - bounds.min.y * factor,
                -bounds.center.z * factor);
        }

        private bool TryRendererContentBounds(out Bounds bounds)
        {
            bounds = default;
            if (_modelContent == null) return false;
            Renderer[] renderers = _modelContent.GetComponentsInChildren<Renderer>(true);
            bool found = false;
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                if (renderer == null || !renderer.enabled) continue;
                Bounds local = renderer.localBounds;
                Vector3 min = local.min;
                Vector3 max = local.max;
                for (int corner = 0; corner < 8; corner++)
                {
                    Vector3 rendererPoint = new Vector3(
                        (corner & 1) == 0 ? min.x : max.x,
                        (corner & 2) == 0 ? min.y : max.y,
                        (corner & 4) == 0 ? min.z : max.z);
                    Vector3 pivotPoint = _modelContent.InverseTransformPoint(
                        renderer.transform.TransformPoint(rendererPoint));
                    if (!found)
                    {
                        bounds = new Bounds(pivotPoint, Vector3.zero);
                        found = true;
                    }
                    else bounds.Encapsulate(pivotPoint);
                }
            }
            return found;
        }

        private static float ProfileSpan(Vector3 size, RoaStrategicActorFitMode fitMode)
        {
            return fitMode == RoaStrategicActorFitMode.Height
                ? size.y : Mathf.Max(size.x, size.z);
        }

        private static RoaStrategicActorProfile Profile(float targetWorldSpan,
                                                        float groundDropWorld,
                                                        float yawOffset,
                                                        RoaStrategicActorFitMode fitMode,
                                                        Bounds animatedLocalBounds)
        {
            return new RoaStrategicActorProfile(targetWorldSpan, groundDropWorld,
                yawOffset, fitMode, animatedLocalBounds);
        }

        private static RoaStrategicActorProfile HumanoidProfile(float targetWorldSpan,
                                                                float groundDropWorld,
                                                                string sex)
        {
            bool female = string.Equals(sex, "female", StringComparison.OrdinalIgnoreCase);
            Bounds bounds = female
                ? BoundsOf(0.004f, 0.955f, 0.035f, 0.789f, 1.926f, 1.012f)
                : BoundsOf(0.004f, 0.919f, 0.037f, 0.771f, 1.865f, 1.001f);
            return Profile(targetWorldSpan, groundDropWorld, 0f,
                RoaStrategicActorFitMode.Height, bounds);
        }

        private static Bounds BoundsOf(float centerX, float centerY, float centerZ,
                                       float sizeX, float sizeY, float sizeZ)
        {
            return new Bounds(new Vector3(centerX, centerY, centerZ),
                new Vector3(sizeX, sizeY, sizeZ));
        }


        private bool LoadIsCurrent(int version)
        {
            return this != null && _modelPivot != null && version == _loadVersion;
        }

        private static Task<GltfImport> LoadCached(string url)
        {
            if (ModelCache.TryGetValue(url, out Task<GltfImport> cached)) return cached;
            Task<GltfImport> loading = LoadImport(url);
            ModelCache[url] = loading;
            return loading;
        }

        private static async Task<GltfImport> LoadImport(string url)
        {
            var import = new GltfImport();
            var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };
            if (await import.Load(RoaModelUrl.Lite(url), settings)) return import;
            import.Dispose();
            ModelCache.Remove(url);
            return null;
        }

        private static JObject PlayerEquipment(JObject self)
        {
            JObject source = self?["equipmentRuntime"] as JObject
                ?? self?["equipment"] as JObject
                ?? new JObject();
            var result = new JObject();
            foreach (string slot in new[] { "weapon", "offhand", "armor", "helmet", "boots", "backpack" })
                result[slot] = BaseItemId(source[slot]?.ToString() ?? string.Empty);
            if (string.IsNullOrEmpty(result["weapon"]?.ToString())) result["weapon"] = "fists";
            return result;
        }

        private static JObject PartyEquipment(string modelKey)
        {
            if (modelKey == "enemyRaider")
                return new JObject
                {
                    ["weapon"] = "rifle", ["armor"] = "leather", ["boots"] = "boots"
                };
            if (modelKey == "klimPatrolGuard")
                return new JObject
                {
                    ["weapon"] = "rifle", ["armor"] = "ballisticVest",
                    ["helmet"] = "helmet", ["boots"] = "boots"
                };
            return new JObject
            {
                ["weapon"] = "fists", ["armor"] = "leather", ["boots"] = "boots"
            };
        }

        private static JObject PartyAppearance(JObject row)
        {
            string seed = string.Join("|", new[]
            {
                row?["id"]?.ToString() ?? string.Empty,
                row?["name"]?.ToString() ?? string.Empty,
                row?["kind"]?.ToString() ?? string.Empty,
                row?["faction"]?.ToString() ?? string.Empty
            });
            uint hash = 2166136261u;
            unchecked
            {
                foreach (char c in seed)
                {
                    hash ^= c;
                    hash *= 16777619u;
                }
            }

            string sex = (hash & 1u) == 0u ? "female" : "male";
            string[] bodies = { "slim", "medium", "large" };
            string[] hairs = { "shaved", "short_crop", "tied_back" };
            string hair = hairs[(int)((hash >> 7) % (uint)hairs.Length)];
            if (sex == "female" && hair == "short_crop") hair = "tied_back";
            if (sex == "male" && hair == "tied_back") hair = "short_crop";
            return new JObject
            {
                ["schema"] = "realm.character-appearance.v1",
                ["sex"] = sex,
                ["bodyType"] = bodies[(int)((hash >> 1) % (uint)bodies.Length)],
                ["faceId"] = sex + "_0" + (1 + ((hash >> 4) % 4u)),
                ["hairId"] = hair,
                ["skinToneId"] = "skin_03",
                ["hairColorId"] = "hair_0" + (1 + ((hash >> 11) % 8u))
            };
        }

        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_", StringComparison.Ordinal))
                return runtimeId;
            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        private static string CompactJson(JObject value)
        {
            return value == null ? string.Empty : value.ToString(Newtonsoft.Json.Formatting.None);
        }

        private static string Normalize(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            var chars = new List<char>(value.Length);
            foreach (char c in value)
                if (char.IsLetterOrDigit(c)) chars.Add(char.ToLowerInvariant(c));
            return new string(chars.ToArray());
        }
    }
}
