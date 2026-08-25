using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Визуальная часть персонажа: авторская GLB-модель, локомоция и процедурная поза.
    ///
    /// Модель выбирается по внешности так же, как в web-клиенте:
    /// /assets/models/characters/base/character_{sex}_{bodyType}.glb
    /// (04b_character_glb_runtime.js:167). Шесть утверждённых баз на общем
    /// 65-костном риге.
    ///
    /// Клипы берутся из общей библиотеки анимаций: Legacy-клип Unity привязывается
    /// к костям по полному пути, а у базы и библиотеки различается имя корневого
    /// узла, поэтому префикс выравнивается переименованием корня — подробности
    /// в TryUseLibraryClips().
    ///
    /// Поверх клипов работает RoaCharacterPose: ноги идут по пути, корпус и голова
    /// смотрят на прицел.
    /// </summary>
    public sealed class RoaCharacterView : MonoBehaviour
    {
        /// <summary>
        /// Скорость, с которой клип «покрывает землю» при единичном темпе.
        /// Значения измерены по GLB инструментом tools/check-locomotion-clip-sync.js
        /// и продублированы в 04b_character_glb_runtime.js:1006. Расхождение
        /// здесь превращается в скольжение стоп.
        /// </summary>
        private static readonly Dictionary<string, float> ClipNaturalSpeeds =
            new Dictionary<string, float>
            {
                { "walk", 1.26f },
                { "run", 3.72f },
                { "walk_back", 1.20f },
                { "run_back", 3.41f },
                { "crouch_walk", 2.11f },
                { "crouch_walk_back", 2.23f }
            };

        private const float StrideSyncMin = 0.6f;
        private const float StrideSyncMax = 2.9f;

        /// <summary>
        /// Порог перехода walk → run, м/с. 04b_character_glb_runtime.js:783.
        /// </summary>
        private const float RunSpeedThreshold = 3.4f;

        // Гистерезис заднего хода: вход −0.17, выход +0.17.
        private const float BackwardEnter = -0.17f;
        private const float BackwardExit = 0.17f;

        /// <summary>Предел скрутки корпуса относительно ног, рад. 04b:1651.</summary>
        private const float LowerBodyYawClamp = 1.65f;

        private const string AnimationLibraryUrl = "/assets/models/characters/npc/npc_humanoid_animations.glb";
        private const string BaseRootName = "character_root";
        private const string LibraryRootName = "npc_humanoid_root";

        private static readonly Dictionary<string, GltfImport> ModelCache = new Dictionary<string, GltfImport>();
        private static GltfImport _animationLibrary;
        private static bool _animationLibraryTried;

        private Animation _animation;
        private readonly HashSet<string> _clips = new HashSet<string>();
        private string _currentClip = string.Empty;
        private bool _backward;

        private readonly RoaCharacterPose _pose = new RoaCharacterPose();
        private readonly RoaFootIk _footIk = new RoaFootIk();
        private readonly RoaActorGroundShadow _groundShadow = new RoaActorGroundShadow();

        private bool _locomoting;
        private bool _groundingActive = true;
        private RoaActorPresentationTier _presentationTier = RoaActorPresentationTier.Near;
        private bool _crouching;
        private Transform _modelRoot;

        private readonly Dictionary<string, Transform> _bones = new Dictionary<string, Transform>();
        private RoaWeaponView _weapon;
        private RoaOffhandWeaponView _offhandWeapon;
        private RoaEquipmentView _equipment;
        private int _equipmentRequest;
        private int _loadRequest;
        private string _bodyKey = "male_medium";
        private JObject _appearance;
        private Transform _head;
        private Vector3 _headBaseScale = Vector3.one;
        private Vector3 _headScaleFactors = Vector3.one;
        private readonly List<GameObject> _hairObjects = new List<GameObject>();
        private bool _dead;
        private bool _brokenArm;
        private bool _brokenLeg;
        private bool _concussion;
        private bool _infection;
        private Transform _injuryIndicator;
        private readonly GameObject[] _injuryMarkers = new GameObject[4];
        private readonly Material[] _injuryMaterials = new Material[4];

        private Vector3 _aimPoint;
        private bool _hasAim;

        // Переступание на месте. characterTurnInPlaceState(), 04b:683.
        private float _turnFacingRad;
        private bool _hasTurnFacing;
        private float _turnHold;
        private float _turnAmount;

        /// <summary>
        /// До какого времени играет одноразовый клип удара. Он перебивает
        /// локомоцию, потому что руки в это время заняты.
        /// </summary>
        private float _attackUntil;
        private float _hurtUntil;

        /// <summary>Длительность вспышки удара по умолчанию, с.</summary>
        private const float AttackSeconds = 0.45f;

        // Сглаженные темпы. 04b:1657.
        private float _playbackRate = 1f;
        private float _strideSyncRate = 1f;

        public bool Ready { get; private set; }

        /// <summary>Изменилась иерархия визуала: туману войны надо обновить рендереры.</summary>
        public event Action OnVisualChanged;

        /// <summary>
        /// Персонаж переступает на месте. Это же значение уходит на сервер полем
        /// turning в событии state.
        /// </summary>
        public bool Turning { get; private set; }

        /// <summary>Текущий доворот таза относительно прицела, градусы. Для диагностики.</summary>
        public float LowerBodyYawDeg { get { return _pose.LowerBodyYawDeg; } }

        /// <summary>Клип, который играет сейчас. Для диагностики.</summary>
        public string CurrentClip { get { return _currentClip; } }
        public string BodyKey { get { return _bodyKey; } }
        public bool HasBrokenArmVisual { get { return _brokenArm; } }
        public bool HasBrokenLegVisual { get { return _brokenLeg; } }
        public bool HasConcussionVisual { get { return _concussion; } }
        public bool HasInfectionVisual { get { return _infection; } }
        public int ActiveInjuryMarkerCount
        {
            get
            {
                int count = 0;
                foreach (GameObject marker in _injuryMarkers)
                    if (marker != null && marker.activeSelf) count++;
                return count;
            }
        }
        public bool AnyHairVisible
        {
            get
            {
                foreach (GameObject hair in _hairObjects)
                    if (hair != null && hair.activeSelf) return true;
                return false;
            }
        }

        private void OnDestroy()
        {
            _groundShadow.Dispose();
            // Маркеры используют созданные в рантайме материалы. sharedMaterial
            // не освобождает их при удалении персонажа, поэтому удаляем явно.
            for (int i = 0; i < _injuryMaterials.Length; i++)
            {
                Material material = _injuryMaterials[i];
                _injuryMaterials[i] = null;
                if (material != null) Destroy(material);
            }
        }

        /// <summary>Сколько стоп зафиксировано foot IK сейчас. Для диагностики.</summary>
        public int FootLocks { get { return _footIk.LockedCount; } }

        /// <summary>Foot IK нашёл кости ног и работает.</summary>
        public bool FootIkReady { get { return _footIk.Ready; } }
        public bool FootIkActive { get { return _groundingActive && !_dead; } }
        public bool GroundShadowReady { get { return _groundShadow.Ready; } }
        public bool GroundShadowVisible { get { return _groundShadow.Visible; } }
        public RoaActorPresentationTier PresentationTier { get { return _presentationTier; } }
        public bool ProceduralPresentationActive { get { return _presentationTier == RoaActorPresentationTier.Near; } }

        /// <summary>Текущая просадка корня, м. Для диагностики.</summary>
        public float KneeFlex { get { return _pose.KneeFlex; } }

        /// <summary>Персонаж в приседе. Для диагностики.</summary>
        public bool Crouching { get { return _crouching; } }

        /// <summary>Оружие подключено и смонтировано.</summary>
        public bool WeaponReady { get { return _weapon != null && _weapon.Ready; } }
        public bool OffhandWeaponReady { get { return _offhandWeapon != null && _offhandWeapon.Ready; } }
        public string OffhandWeaponId { get { return _offhandWeapon != null ? _offhandWeapon.WeaponId : string.Empty; } }

        /// <summary>Доворот корпуса под ствол, рад. Для диагностики.</summary>
        public float TorsoResidual { get { return _weapon != null ? _weapon.TorsoResidual : 0f; } }

        /// <summary>Доворот ствола в кисти, рад. Для диагностики.</summary>
        public float WeaponConverge { get { return _weapon != null ? _weapon.WeaponConverge : 0f; } }

        /// <summary>
        /// Точка прицеливания в мире. Задаётся контроллером игрока; у удалённых
        /// игроков её нет, и оружие просто держится в руках без сведения.
        /// </summary>
        public void SetAim(Vector3 worldPoint, bool has)
        {
            _aimPoint = worldPoint;
            _hasAim = has;
        }

        /// <summary>Id оружия в руках. Пусто — руки свободны.</summary>
        public string WeaponId { get { return _weapon != null ? _weapon.WeaponId : string.Empty; } }

        public void SetGroundingLod(bool active)
        {
            if (_groundingActive == active)
            {
                _groundShadow.SetActive(active);
                return;
            }
            _groundingActive = active;
            if (!active) _footIk.Reset();
            _groundShadow.SetActive(active);
        }

        /// <summary>
        /// Меняет только стоимость визуальной позы. Сетевое положение, коллайдеры
        /// и выбор клипа продолжают обновляться на любом уровне качества.
        /// </summary>
        public void SetPresentationLod(RoaActorPresentationTier tier)
        {
            bool changed = _presentationTier != tier;
            _presentationTier = tier;
            if (_animation != null)
                _animation.cullingType = AnimationCullingType.BasedOnRenderers;

            SetGroundingLod(tier == RoaActorPresentationTier.Near);
            if (tier != RoaActorPresentationTier.Near && changed)
                ResetProceduralPresentation();
            if (tier == RoaActorPresentationTier.Hidden && changed && _dead)
                SnapHiddenDeathToEnd();
        }

        private void ResetProceduralPresentation()
        {
            transform.localRotation = Quaternion.identity;
            if (_modelRoot == null) return;
            Vector3 local = _modelRoot.localPosition;
            local.y = 0f;
            _modelRoot.localPosition = local;
        }

        private void SnapHiddenDeathToEnd()
        {
            if (_animation == null || !_clips.Contains("death")) return;
            AnimationState death = _animation["death"];
            if (death == null) return;
            death.wrapMode = WrapMode.ClampForever;
            _animation.Play("death");
            death.time = Mathf.Max(0f, death.length - 0.001f);
            _animation.Sample();
        }

        /// <summary>
        /// Высота, на которой брать точку прицела для оружия. Ноль — оружия нет
        /// и высота не имеет смысла.
        /// </summary>
        public float AimPlaneY { get { return _weapon != null ? _weapon.GripHeight : 0f; } }

        public bool TryGetMuzzle(out Vector3 worldPosition)
        {
            return TryGetMuzzle("weapon", out worldPosition);
        }

        public bool TryGetMuzzle(string handSlot, out Vector3 worldPosition)
        {
            if (handSlot == "offhand" && _offhandWeapon != null)
                return _offhandWeapon.TryGetMuzzle(out worldPosition);
            if (_weapon != null) return _weapon.TryGetMuzzle(out worldPosition);
            worldPosition = Vector3.zero;
            return false;
        }
        /// <summary>Запустить визуал перезарядки: левая рука уходит к магазину.</summary>
        public void StartReload(float durationSeconds)
        {
            if (_weapon != null) _weapon.StartReload(durationSeconds);
            if (_offhandWeapon != null) _offhandWeapon.StartReload(durationSeconds);
        }

        /// <summary>
        /// Проиграть удар или выстрел. Клип одноразовый и перебивает локомоцию:
        /// в вебе он выбирается раньше клипа ходьбы (04b:1676).
        /// </summary>
        public void PlayAttack()
        {
            if (_dead) return;

            // Замах оружием ближнего боя — своя система стоек, она работает
            // и без клипа.
            if (_weapon != null) _weapon.StartSwing(0f);

            if (!Ready || !_clips.Contains("attack")) return;

            _attackUntil = Time.time + AttackSeconds;

            // Перезапуск с нуля: очередь выстрелов должна давать удар на каждый,
            // а не один растянутый.
            _currentClip = "attack";
            _animation[_currentClip].wrapMode = WrapMode.Once;
            _animation[_currentClip].time = 0f;
            _animation[_currentClip].speed = 1f;
            _animation.CrossFade("attack", 0.08f);
        }

        public void PlayHit()
        {
            if (_dead || !Ready || !_clips.Contains("hurt")) return;
            _hurtUntil = Time.time + 0.36f;
            _currentClip = "hurt";
            _animation[_currentClip].wrapMode = WrapMode.Once;
            _animation[_currentClip].time = 0f;
            _animation[_currentClip].speed = 1f;
            _animation.CrossFade("hurt", 0.06f);
        }

        /// <summary>
        /// Авторитетные травмы персонажа. Поза переносит
        /// applyCharacterInjuryVisual() из web-клиента; боевые штрафы здесь не
        /// считаются, потому что их уже применяет сервер.
        /// </summary>
        public void SetInjuries(JObject injuries)
        {
            bool brokenArm = HasInjury(injuries, "brokenArm");
            bool brokenLeg = HasInjury(injuries, "brokenLeg");
            bool concussion = HasInjury(injuries, "concussion");
            bool infection = HasInjury(injuries, "infection");
            if (_brokenArm == brokenArm && _brokenLeg == brokenLeg
                && _concussion == concussion && _infection == infection) return;

            _brokenArm = brokenArm;
            _brokenLeg = brokenLeg;
            _concussion = concussion;
            _infection = infection;
            UpdateInjuryIndicator();
            NotifyVisualChanged();
        }

        private static bool HasInjury(JObject injuries, string id)
        {
            return injuries?[id]?.ToObject<bool>() == true;
        }

        /// <summary>Поставить или снять авторитетное состояние смерти.</summary>
        public void SetDead(bool dead)
        {
            if (_dead == dead && (!dead || _currentClip == "death")) return;
            _dead = dead;
            if (dead) _footIk.Reset();
            if (!Ready || _animation == null) return;

            if (dead && _clips.Contains("death"))
            {
                _currentClip = "death";
                _animation[_currentClip].wrapMode = WrapMode.ClampForever;
                _animation[_currentClip].time = 0f;
                _animation[_currentClip].speed = 1f;
                _animation.CrossFade(_currentClip, 0.1f);
                if (_presentationTier == RoaActorPresentationTier.Hidden) SnapHiddenDeathToEnd();
            }
            else if (!dead)
            {
                _currentClip = string.Empty;
                Play("idle");
            }
        }

        /// <summary>
        /// Взять оружие в руки по серверному id. Повторный вызов с тем же id
        /// ничего не делает, с другим — меняет модель.
        ///
        /// Огнестрел и ближний бой используют канонические стойки, IK и общий
        /// утверждённый профиль пальцев из browser-клиента; кулаки используют
        /// собственную безоружную боевую стойку.
        /// </summary>
        public async Task EquipWeapon(string baseUrl, string weaponId)
        {
            if (!Ready || _modelRoot == null) return;

            if (_weapon == null) _weapon = new RoaWeaponView();
            await _weapon.Load(baseUrl, weaponId, _modelRoot, _bones);
            UpdateDualWieldState();
            NotifyVisualChanged();
        }

        /// <summary>Надеть четыре видимых слота на тот же скелет, что анимирует тело.</summary>
        public async Task EquipItems(string baseUrl, JObject equipment)
        {
            if (!Ready || _modelRoot == null) return;

            int request = ++_equipmentRequest;
            if (_equipment == null) _equipment = new RoaEquipmentView();
            if (_offhandWeapon == null) _offhandWeapon = new RoaOffhandWeaponView();
            string offhandId = BaseItemId(equipment?["offhand"]?.ToString());
            await Task.WhenAll(
                _equipment.Apply(baseUrl, equipment, _bodyKey, _modelRoot, _bones),
                _offhandWeapon.Load(baseUrl, offhandId, _modelRoot, _bones));
            if (request != _equipmentRequest) return;
            UpdateDualWieldState();
            bool helmetOn = !string.IsNullOrEmpty(BaseItemId(equipment?["helmet"]?.ToString()));
            ApplyAppearanceVisuals(helmetOn);
            NotifyVisualChanged();
        }

        public int LoadedEquipmentSlotCount { get { return _equipment?.LoadedSlotCount ?? 0; } }

        public bool HasLoadedEquipment(string slot, string itemId)
        {
            return _equipment != null && _equipment.HasLoadedItem(slot, itemId);
        }

        public void CollectEquipmentRenderers(List<SkinnedMeshRenderer> output)
        {
            _equipment?.CollectRenderers(output);
        }

        private void UpdateDualWieldState()
        {
            if (_weapon == null) return;
            _weapon.DualWield = _weapon.Ready
                && RoaOffhandWeaponView.IsSupported(_weapon.WeaponId)
                && _offhandWeapon != null && _offhandWeapon.Ready;
        }

        /// <summary>Модель по умолчанию для старых сохранений без внешности (PLAYER_SYSTEM.md).</summary>
        public static string ModelKey(JObject appearance)
        {
            string sex = appearance?["sex"]?.ToString();
            string body = appearance?["bodyType"]?.ToString();

            if (sex != "female" && sex != "male") sex = "male";
            if (body != "slim" && body != "medium" && body != "large") body = "medium";

            return sex + "_" + body;
        }

        /// <summary>
        /// Apply face, hair and hair colour without re-instantiating the body GLB.
        /// The creator preview calls this while the selected sex/body pair stays
        /// the same; a different body key still requires a normal Load call.
        /// </summary>
        public bool ApplyAppearance(CharacterAppearance appearance)
        {
            if (!Ready || appearance == null) return false;
            JObject next = JObject.FromObject(appearance);
            if (ModelKey(next) != _bodyKey) return false;

            _appearance = next;
            ReadAppearanceVariants();
            ApplyAppearanceVisuals(false);
            NotifyVisualChanged();
            return true;
        }

        public async Task Load(string baseUrl, JObject appearance)
        {
            int loadRequest = ++_loadRequest;
            string key = ModelKey(appearance);
            _bodyKey = key;
            _appearance = appearance != null ? (JObject)appearance.DeepClone() : new JObject();
            string url = baseUrl.TrimEnd('/') + "/assets/models/characters/base/character_" + key + ".glb";

            GltfImport import = await LoadCached(key, url);
            if (!LoadIsCurrent(loadRequest)) return;
            if (import == null)
            {
                Debug.LogError("[ROA] Модель персонажа не загрузилась: " + url);
                return;
            }

            if (!await import.InstantiateMainSceneAsync(transform))
            {
                Debug.LogError("[ROA] Не удалось создать экземпляр модели " + key);
                return;
            }
            if (!LoadIsCurrent(loadRequest)) return;

            _animation = GetComponentInChildren<Animation>();
            if (_animation == null)
            {
                Debug.LogWarning("[ROA] У модели " + key + " нет компонента Animation — локомоция отключена.");
                Ready = true;
                return;
            }

            _animation.cullingType = AnimationCullingType.BasedOnRenderers;
            foreach (AnimationState state in _animation) _clips.Add(state.name);

            if (!await TryUseLibraryClips(baseUrl))
                Debug.LogWarning("[ROA] Библиотека анимаций недоступна: задний ход пойдёт реверсом walk/run.");
            if (!LoadIsCurrent(loadRequest)) return;

            // Позу покоя снимаем до первого клипа: она эталон и для демпфирования
            // верха, и для высоты стоп в foot IK.
            _pose.Bind(transform);

            _modelRoot = transform.Find(LibraryRootName) ?? transform.Find(BaseRootName);
            if (_modelRoot != null) _footIk.Bind(transform, _modelRoot);
            _groundShadow.Bind(transform);
            _groundShadow.SetActive(_groundingActive);

            // Индекс костей по имени: по нему работают поза хвата и доворот корпуса.
            foreach (Transform bone in GetComponentsInChildren<Transform>(true))
                if (!_bones.ContainsKey(bone.name)) _bones[bone.name] = bone;

            PrepareAppearance();
            ApplyAppearanceVisuals(false);

            _animation.wrapMode = WrapMode.Loop;
            Play("idle");
            Ready = true;

            Debug.Log("[ROA] Модель " + key + ", клипы: " + string.Join(", ", _clips)
                + ", поза: " + (_pose.Ready ? "включена" : "выключена")
                + ", foot IK: " + (_footIk.Ready ? "включён" : "выключен"));
            NotifyVisualChanged();
        }

        private bool LoadIsCurrent(int request)
        {
            return this != null && request == _loadRequest;
        }

        private void PrepareAppearance()
        {
            _hairObjects.Clear();
            foreach (Transform node in GetComponentsInChildren<Transform>(true))
            {
                if (node.name == "head")
                {
                    _head = node;
                    _headBaseScale = node.localScale;
                }
                if (node.name.StartsWith("hair_")) _hairObjects.Add(node.gameObject);
            }

            ReadAppearanceVariants();
        }

        private void ReadAppearanceVariants()
        {

            string face = _appearance?["faceId"]?.ToString() ?? string.Empty;
            string suffix = face.Length >= 2 ? face.Substring(face.Length - 2) : "01";
            if (suffix == "02") _headScaleFactors = new Vector3(0.88f, 1.018f, 1.05f);
            else if (suffix == "03") _headScaleFactors = new Vector3(1.13f, 0.985f, 0.96f);
            else if (suffix == "04") _headScaleFactors = new Vector3(0.98f, 0.982f, 1.09f);
            else _headScaleFactors = Vector3.one;

            Color hair = HairColor(_appearance?["hairColorId"]?.ToString());
            foreach (GameObject hairObject in _hairObjects)
            {
                foreach (Renderer renderer in hairObject.GetComponentsInChildren<Renderer>(true))
                {
                    Material[] materials = renderer.materials;
                    foreach (Material material in materials)
                    {
                        if (material == null) continue;
                        if (material.HasProperty("baseColorFactor")) material.SetColor("baseColorFactor", hair);
                        else if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", hair);
                        else if (material.HasProperty("_Color")) material.SetColor("_Color", hair);
                    }
                }
            }
        }

        private void ApplyAppearanceVisuals(bool helmetOn)
        {
            string hairId = _appearance?["hairId"]?.ToString() ?? "short_crop";
            bool showHair = !helmetOn && hairId != "shaved";
            foreach (GameObject hairObject in _hairObjects)
                if (hairObject != null && hairObject.activeSelf != showHair) hairObject.SetActive(showHair);
            ApplyHeadShape();
        }

        private void ApplyHeadShape()
        {
            if (_head != null) _head.localScale = Vector3.Scale(_headBaseScale, _headScaleFactors);
        }

        private static Color HairColor(string id)
        {
            string hex = id == "hair_01" ? "#1A1512"
                : id == "hair_02" ? "#2A1B16"
                : id == "hair_04" ? "#6B452A"
                : id == "hair_05" ? "#8A6040"
                : id == "hair_06" ? "#A27A4B"
                : id == "hair_07" ? "#7B7D76"
                : id == "hair_08" ? "#5B2922"
                : "#4B3023";
            Color color = ColorUtility.TryParseHtmlString(hex, out Color parsed)
                ? parsed
                : new Color(0.294f, 0.188f, 0.137f);
            return QualitySettings.activeColorSpace == ColorSpace.Linear ? color.linear : color;
        }

        private void NotifyVisualChanged()
        {
            RoaVisibilityGate gate = GetComponentInParent<RoaVisibilityGate>();
            if (gate != null) gate.Invalidate();
            if (OnVisualChanged != null) OnVisualChanged();
        }

        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId;
            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        private static async Task<GltfImport> LoadCached(string key, string url)
        {
            if (ModelCache.TryGetValue(key, out GltfImport cached)) return cached;

            var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };
            var import = new GltfImport();

            if (!await import.Load(RoaModelUrl.Lite(url), settings))
            {
                import.Dispose();
                return null;
            }

            ModelCache[key] = import;
            return import;
        }

        /// <summary>
        /// Взять полный набор клипов из общей библиотеки анимаций.
        ///
        /// Legacy-клип Unity привязывается к костям по ПОЛНОМУ пути трансформа, а не
        /// по имени узла, как в Three.js. Пути библиотеки начинаются с
        /// "npc_humanoid_root/...", пути базовой модели — с "character_root/...",
        /// поэтому просто добавить клипы недостаточно: они молча не привязываются
        /// (замерено — 0 совпадений из 65 путей), и персонаж замирает вместо
        /// анимации. Это хуже честного фолбэка.
        ///
        /// Переписать пути в рантайме нельзя: AnimationUtility доступен только
        /// в редакторе. Поэтому префикс выравнивается переименованием корня модели,
        /// а клипы берутся целиком из библиотеки — там есть и idle/walk/run,
        /// и attack/death/hurt/turn, которые понадобятся для боя.
        /// </summary>
        private async Task<bool> TryUseLibraryClips(string baseUrl)
        {
            if (!_animationLibraryTried)
            {
                _animationLibraryTried = true;

                var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };
                var import = new GltfImport();

                if (await import.Load(RoaModelUrl.Lite(baseUrl.TrimEnd('/') + AnimationLibraryUrl), settings))
                    _animationLibrary = import;
                else
                    import.Dispose();
            }

            if (_animationLibrary == null) return false;

            AnimationClip[] clips = _animationLibrary.GetAnimationClips();
            if (clips == null || clips.Length == 0) return false;

            Transform root = transform.Find(BaseRootName);
            if (root == null)
            {
                Debug.LogWarning("[ROA] В модели нет узла '" + BaseRootName
                    + "' — структура изменилась, клипы библиотеки не подключены.");
                return false;
            }

            root.name = LibraryRootName;

            foreach (string own in new List<string>(_clips)) _animation.RemoveClip(own);
            _clips.Clear();

            foreach (AnimationClip clip in clips)
            {
                if (clip == null || _clips.Contains(clip.name)) continue;

                clip.legacy = true;
                _animation.AddClip(clip, clip.name);
                _clips.Add(clip.name);
            }

            return _clips.Count > 0;
        }

        /// <summary>
        /// Обновить позу под текущее движение.
        /// </summary>
        /// <param name="velocity">Скорость в мировых координатах Unity.</param>
        /// <param name="facingYawDeg">Куда смотрит персонаж (прицел), градусы.</param>
        public void UpdateLocomotion(Vector3 velocity, float facingYawDeg, bool moving, bool crouching)
        {
            if (_dead || !Ready || _animation == null) return;

            float dt = Mathf.Clamp(Time.deltaTime, 0.001f, 0.08f);
            float speed = new Vector2(velocity.x, velocity.z).magnitude;
            bool actuallyMoving = moving && speed >= 0.05f;

            UpdateTurnInPlace(facingYawDeg, actuallyMoving, dt);

            // Направление движения относительно прицела. Формулы совпадают с
            // characterDirectionalLocomotionState(), 04b:724.
            float facingRad = facingYawDeg * Mathf.Deg2Rad;
            Vector3 facing = new Vector3(Mathf.Sin(facingRad), 0f, Mathf.Cos(facingRad));
            Vector3 right = new Vector3(Mathf.Cos(facingRad), 0f, -Mathf.Sin(facingRad));
            Vector3 move = actuallyMoving
                ? new Vector3(velocity.x, 0f, velocity.z).normalized
                : facing;

            float forwardAmount = Mathf.Clamp(Vector3.Dot(move, facing), -1f, 1f);
            float sideAmount = Mathf.Clamp(Vector3.Dot(move, right), -1f, 1f);
            float relativeAngle = Mathf.Atan2(sideAmount, forwardAmount);

            _backward = actuallyMoving
                && (_backward ? forwardAmount < BackwardExit : forwardAmount < BackwardEnter);

            _locomoting = actuallyMoving || Turning;
            bool locomoting = _locomoting;
            bool fast = speed > RunSpeedThreshold;

            // Ноги смотрят строго по пути: клип «вперёд» разворачивается на угол
            // движения, клип «назад» — на противоположный. Обе ветки дают один и
            // тот же непрерывный угол на границе режимов.
            float lowerBodyYaw = 0f;
            if (Turning)
            {
                lowerBodyYaw = _turnAmount * 0.28f;
            }
            else if (actuallyMoving)
            {
                float pathYaw = _backward ? WrapAngle(relativeAngle + Mathf.PI) : relativeAngle;
                lowerBodyYaw = Mathf.Clamp(pathYaw, -LowerBodyYawClamp, LowerBodyYawClamp);
            }

            string clip = SelectClip(actuallyMoving, crouching, _backward, fast);

            // Реакция на попадание и собственный удар перебивают локомоцию.
            bool hurt = Time.time < _hurtUntil && _clips.Contains("hurt");
            bool attacking = !hurt && Time.time < _attackUntil;
            if (!hurt && !attacking)
            {
                Play(clip);
                ApplyTimeScale(clip, actuallyMoving, speed, sideAmount, dt);
            }
            else if (hurt)
            {
                clip = "hurt";
            }
            else
            {
                clip = "attack";
            }

            _crouching = crouching;

            _pose.Step(locomoting, Turning, clip, lowerBodyYaw,
                sideAmount, forwardAmount, _turnAmount, crouching, false, dt);
        }

        private void LateUpdate()
        {
            if (!Ready || _presentationTier == RoaActorPresentationTier.Hidden) return;

            ApplyHeadShape();
            if (_injuryIndicator != null && _injuryIndicator.gameObject.activeSelf)
            {
                Vector3 local = _injuryIndicator.localPosition;
                local.y = 2.5f + Mathf.Sin(Time.time / 0.42f) * 0.08f;
                _injuryIndicator.localPosition = local;
            }
            if (_dead)
            {
                // Оружие остаётся у кисти и после перехода в позу смерти, но без
                // дорогого IK и проб столкновения ствола.
                if (_weapon != null) _weapon.ApplyReduced();
                if (_offhandWeapon != null) _offhandWeapon.ApplyReduced();
                UpdateGroundShadow();
                return;
            }

            if (_presentationTier == RoaActorPresentationTier.Far)
            {
                // Дальний силуэт получает обычный клип и оружие в руке. Скрутка
                // позвоночника, IK обеих рук, столкновение ствола и foot IK здесь
                // уже не читаются, поэтому не считаются.
                if (_weapon != null) _weapon.ApplyReduced();
                if (_offhandWeapon != null) _offhandWeapon.ApplyReduced();
                return;
            }

            if (_pose.Ready)
            {
                // Доворот таза: модель поворачивается относительно родителя, который
                // держит прицел. Контр-поворот позвоночника возвращает корпус обратно.
                transform.localRotation = Quaternion.Euler(0f, _pose.LowerBodyYawDeg, InjuryRootRollDeg());

                // Просадка корня. Сам сгиб коленей не рисуется: корень опускается,
                // а foot IK возвращает стопы на землю — ноги подгибаются сами.
                if (_modelRoot != null)
                {
                    Vector3 local = _modelRoot.localPosition;
                    local.y = -_pose.KneeFlex;
                    _modelRoot.localPosition = local;
                }

                // Строго после того, как анимация записала кадр, иначе она затрёт смещения.
                _pose.Apply();
            }
            else
            {
                transform.localRotation = Quaternion.Euler(0f, 0f, InjuryRootRollDeg());
            }

            // Хват и оружие поверх позы: кисть считается от таза и позвоночника,
            // которые направленная поза уже развернула.
            if (_weapon != null) _weapon.Apply(_aimPoint, _hasAim);
            if (_offhandWeapon != null) _offhandWeapon.Apply(_aimPoint, _hasAim);

            // Foot IK последним: он трогает только ноги, а их мировые позиции
            // к этому моменту окончательные.
            if (_groundingActive)
                _footIk.Apply(Time.deltaTime, _locomoting, Turning, false, _currentClip, _pose.KneeFlex);

            // Травма — самый верхний визуальный слой. Перелом руки намеренно
            // ослабляет идеальный IK-хват, а перелом ноги остаётся видим после
            // того, как foot IK поставил стопу на землю.
            ApplyInjuryPose();
            UpdateGroundShadow();
        }

        private void UpdateGroundShadow()
        {
            if (!_groundingActive || !_groundShadow.Ready) return;
            if (!_footIk.TryGetGroundPose(out float groundY, out Vector3 normal))
            {
                groundY = transform.position.y;
                normal = Vector3.up;
            }
            _groundShadow.UpdatePose(transform.position, groundY, normal,
                transform.eulerAngles.y, _dead, _crouching);
        }

        private float InjuryRootRollDeg()
        {
            if (!_brokenLeg) return 0f;
            return Mathf.Sin(Time.time / 0.26f) * 0.035f * Mathf.Rad2Deg;
        }

        private void ApplyInjuryPose()
        {
            if (_brokenArm)
                AddBoneOffset("upperarm_r", -0.35f, 0f, 0.72f);

            if (_brokenLeg)
                AddBoneOffset("thigh_l", 0f, 0f, -0.09f);

            if (_concussion)
            {
                float wobble = Mathf.Sin(Time.time / 0.12f) * 0.06f;
                AddBoneOffset("head", 0f, 0f, wobble);
                AddBoneOffset("spine_03", 0f, 0f, wobble * 0.4f);
            }
        }

        private void AddBoneOffset(string name, float x, float y, float z)
        {
            if (!_bones.TryGetValue(name, out Transform bone) || bone == null) return;
            bone.localRotation = bone.localRotation * Quaternion.Euler(
                x * Mathf.Rad2Deg, y * Mathf.Rad2Deg, z * Mathf.Rad2Deg);
        }

        private void UpdateInjuryIndicator()
        {
            if (_injuryIndicator == null)
            {
                var root = new GameObject("InjuryIndicators");
                root.transform.SetParent(transform, false);
                root.transform.localPosition = new Vector3(0f, 2.5f, 0f);
                _injuryIndicator = root.transform;

                Color[] colors =
                {
                    new Color(1f, 0.55f, 0.20f), // перелом руки
                    new Color(1f, 0.80f, 0.25f), // перелом ноги
                    new Color(0.55f, 0.82f, 1f), // сотрясение
                    new Color(0.42f, 0.92f, 0.32f) // инфекция
                };

                Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                    ?? Shader.Find("Unlit/Color")
                    ?? Shader.Find("Standard");
                for (int i = 0; i < _injuryMarkers.Length; i++)
                {
                    GameObject marker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    marker.name = "Injury_" + i;
                    marker.transform.SetParent(_injuryIndicator, false);
                    marker.transform.localScale = Vector3.one * 0.16f;
                    Collider collider = marker.GetComponent<Collider>();
                    if (collider != null) Destroy(collider);
                    Renderer renderer = marker.GetComponent<Renderer>();
                    if (renderer != null)
                    {
                        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                        renderer.receiveShadows = false;
                        if (shader != null)
                        {
                            var material = new Material(shader) { color = colors[i] };
                            renderer.sharedMaterial = material;
                            _injuryMaterials[i] = material;
                        }
                    }
                    _injuryMarkers[i] = marker;
                }
            }

            bool[] active = { _brokenArm, _brokenLeg, _concussion, _infection };
            int count = 0;
            for (int i = 0; i < active.Length; i++) if (active[i]) count++;
            int shown = 0;
            for (int i = 0; i < active.Length; i++)
            {
                GameObject marker = _injuryMarkers[i];
                if (marker == null) continue;
                marker.SetActive(active[i]);
                if (!active[i]) continue;
                marker.transform.localPosition = new Vector3((shown - (count - 1) * 0.5f) * 0.22f, 0f, 0f);
                shown++;
            }
            _injuryIndicator.gameObject.SetActive(count > 0);
        }

        private string SelectClip(bool moving, bool crouching, bool backward, bool fast)
        {
            if (!moving)
            {
                if (Turning && _clips.Contains("turn")) return "turn";

                // Присед на месте — это idle плюс поза приседа, а не clip ходьбы:
                // 04b:783 выбирает клип только когда locomoting. Иначе персонаж
                // марширует на месте, сидя на корточках.
                return "idle";
            }

            if (crouching)
            {
                if (backward && _clips.Contains("crouch_walk_back")) return "crouch_walk_back";
                if (_clips.Contains("crouch_walk")) return "crouch_walk";
            }

            if (backward)
            {
                if (fast && _clips.Contains("run_back")) return "run_back";
                if (_clips.Contains("walk_back")) return "walk_back";

                // Фолбэк web-клиента: клипов заднего хода нет — играем обычный
                // задом наперёд (playbackRate = −0.88).
                return fast ? "run" : "walk";
            }

            return fast ? "run" : "walk";
        }

        /// <summary>
        /// Темп клипа. Портирует 04b:1652–1674: базовый множитель walk 1.05,
        /// направленный playbackRate и stride sync перемножаются.
        /// </summary>
        private void ApplyTimeScale(string clip, bool moving, float speed, float sideAmount, float dt)
        {
            bool authoredBackClip = clip == "walk_back" || clip == "run_back" || clip == "crouch_walk_back";
            float sideStrength = Mathf.Abs(sideAmount);

            float playbackTarget;
            if (authoredBackClip)
            {
                // Авторский клип заднего хода сам шагает назад — реверс не нужен.
                playbackTarget = 1f;
            }
            else if (Turning && clip == "turn")
            {
                playbackTarget = 1f + Mathf.Abs(_turnAmount) * 0.5f;
            }
            else if (!moving)
            {
                playbackTarget = 1f;
            }
            else if (_backward)
            {
                playbackTarget = -0.88f;
            }
            else
            {
                playbackTarget = sideStrength > 0.62f ? 0.92f : 1f;
            }

            _playbackRate = Blend(_playbackRate, playbackTarget, playbackTarget < 0f ? 7f : 9f, dt);
            _strideSyncRate = Blend(_strideSyncRate, StrideSyncTarget(clip, moving, speed), 8f, dt);

            AnimationState state = _animation[_currentClip];
            if (state == null) return;

            float baseRate = _currentClip == "walk" ? 1.05f : 1f;
            state.speed = baseRate * _playbackRate * _strideSyncRate;
        }

        private float StrideSyncTarget(string clip, bool moving, float speed)
        {
            if (!moving || Turning) return 1f;

            float natural;
            if (!ClipNaturalSpeeds.TryGetValue(clip, out natural) || natural <= 0f) return 1f;

            return Mathf.Clamp(speed / natural, StrideSyncMin, StrideSyncMax);
        }

        /// <summary>
        /// Переступание на месте. Портирует characterTurnInPlaceState(), 04b:683.
        ///
        /// Смысл hold: короткий доворот курсором даёт всплеск угловой скорости
        /// на один-два кадра. Без удержания клип успевал бы только дёрнуться,
        /// поэтому поворот «держится» ещё 0.14–0.38 с после самого движения.
        /// </summary>
        private void UpdateTurnInPlace(float facingYawDeg, bool moving, float frameDt)
        {
            float angle = facingYawDeg * Mathf.Deg2Rad;

            float delta = 0f;
            if (_hasTurnFacing) delta = WrapAngle(angle - _turnFacingRad);
            _turnFacingRad = angle;
            _hasTurnFacing = true;

            float angularSpeed = Mathf.Abs(delta) / frameDt;

            _turnHold = Mathf.Max(0f, _turnHold - frameDt);
            _turnAmount = Mathf.Clamp(_turnAmount, -1f, 1f);

            if (moving)
            {
                _turnHold = 0f;
                _turnAmount = Blend(_turnAmount, 0f, 12f, frameDt);
            }
            else if (Mathf.Abs(delta) >= 0.003f && angularSpeed >= 0.18f)
            {
                float strength = Mathf.Clamp(angularSpeed / 2.8f, 0.28f, 1f);
                float sign = delta != 0f ? Mathf.Sign(delta) : (_turnAmount != 0f ? Mathf.Sign(_turnAmount) : 1f);
                _turnAmount = sign * strength;
                _turnHold = Mathf.Max(_turnHold, Mathf.Clamp(0.13f + Mathf.Abs(delta) * 0.18f, 0.14f, 0.38f));
            }
            else if (_turnHold <= 0f)
            {
                _turnAmount = Blend(_turnAmount, 0f, 10f, frameDt);
            }

            Turning = !moving && _turnHold > 0f && Mathf.Abs(_turnAmount) > 0.04f;
        }

        private void Play(string clip)
        {
            if (!_clips.Contains(clip)) clip = _clips.Contains("idle") ? "idle" : null;
            if (clip == null || clip == _currentClip) return;

            string previous = _currentClip;
            float phase = 0f;
            bool preservePhase = IsCyclicLocomotion(previous) && IsCyclicLocomotion(clip);
            AnimationState previousState = !string.IsNullOrEmpty(previous) ? _animation[previous] : null;
            if (preservePhase && previousState != null)
                phase = previousState.normalizedTime - Mathf.Floor(previousState.normalizedTime);

            _currentClip = clip;
            AnimationState nextState = _animation[clip];
            if (preservePhase && nextState != null) nextState.normalizedTime = phase;

            float fade = previous == "idle" || clip == "idle" ? 0.12f
                : previous == "turn" || clip == "turn" ? 0.10f
                : preservePhase ? 0.18f
                : 0.14f;
            _animation.CrossFade(clip, fade);
        }

        private static bool IsCyclicLocomotion(string clip)
        {
            return clip == "walk" || clip == "run"
                || clip == "walk_back" || clip == "run_back"
                || clip == "crouch_walk" || clip == "crouch_walk_back";
        }

        private static float WrapAngle(float radians)
        {
            return Mathf.Atan2(Mathf.Sin(radians), Mathf.Cos(radians));
        }

        /// <summary>characterLocomotionBlend(), 04b:810.</summary>
        private static float Blend(float current, float target, float rate, float dt)
        {
            float step = Mathf.Min(1f, Mathf.Max(0.001f, dt) * Mathf.Max(0f, rate));
            return current + (target - current) * step;
        }
    }
}
