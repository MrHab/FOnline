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
    /// Модель выбирается по полу:
    /// /assets/models/characters/base/character_{sex}_medium.glb — две
    /// утверждённые базы на общем 65-костном риге.
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
        /// Один порядок приоритетов для humanoid и legacy NPC. Числовой порядок
        /// намеренно совпадает с визуальным приоритетом: смерть всегда выше
        /// реакции, реакция выше атаки, а одноразовые действия выше gait.
        /// </summary>
        public enum CombatPresentationPhase
        {
            Idle = 0,
            Locomotion = 1,
            Attack = 2,
            Reaction = 3,
            Death = 4
        }

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
                { "walk_back", 0.87f },
                { "run_back", 2.22f },
                { "crouch_run", 3.72f },
                { "crouch_run_back", 2.23f },
                // CMU (tools/import-cmu-clips.js печатает скорость хода клипа).
                { "strafe_left", 0.55f },
                { "strafe_right", 0.55f },
                { "strafe_run_left", 1.40f },
                { "strafe_run_right", 1.40f },
                { "crouch_walk", 0.72f },
                { "crouch_walk_back", 0.64f }
            };

        // Сектор бокового шага: угол движения от прицела, градусы.
        private const float StrafeSectorFromDeg = 55f;
        private const float StrafeSectorToDeg = 125f;
        private const float StrafeSectorHysteresisDeg = 6f;
        // Выше — приставной шаг вместо бокового; выше StrafeMaxSpeed вбок не семенят.
        private const float StrafeRunSpeed = 1.0f;
        private const float StrafeMaxSpeed = 3.2f;
        // Выше — бег пригнувшись (UAL) вместо шага в приседе (CMU).
        private const float CrouchRunSpeed = 2.0f;
        private const float BackRunSpeed = 1.6f;

        private const float StrideSyncMin = 0.6f;
        private const float StrideSyncMax = 2.9f;

        // Быстрые клипы авторизованы примерно на 1/6 цикла впереди walk.
        // Перенос normalizedTime 1:1 меняет либо разгружает опорную стопу в cross-fade.
        private const float FastGaitPhaseOffset = -1f / 6f;

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

        private static readonly string[] DeathContactBones =
        {
            "hand_l", "hand_r", "foot_l", "foot_r"
        };
        private static readonly Dictionary<string, GltfImport> ModelCache = new Dictionary<string, GltfImport>();
        private static readonly Dictionary<string, Task<GltfImport>> ModelLoads =
            new Dictionary<string, Task<GltfImport>>();
        private static GltfImport _animationLibrary;
        private static bool _animationLibraryTried;
        private static Task<GltfImport> _animationLibraryLoad;
        private static int _modelCacheSession;

        private Animation _animation;
        private readonly HashSet<string> _clips = new HashSet<string>();
        private string _currentClip = string.Empty;
        private bool _backward;
        private bool _strafing;

        private readonly RoaCharacterPose _pose = new RoaCharacterPose();
        private readonly RoaHitReaction _hitReaction = new RoaHitReaction();
        private readonly RoaActorGroundShadow _groundShadow = new RoaActorGroundShadow();

        private bool _locomoting;
        private bool _groundingActive = true;
        private RoaActorPresentationTier _presentationTier = RoaActorPresentationTier.Near;
        private bool _crouching;
        private Transform _modelRoot;

        private readonly Dictionary<string, Transform> _bones = new Dictionary<string, Transform>();

        // База процедурных смещений костей за кадр. Смещения направленной позы и
        // приседа (RoaCharacterPose), травм, презентации активности и реакции на
        // удар прибавляются к текущему повороту кости;
        // это безопасно, только пока аниматор переставляет кость каждый кадр.
        // Legacy Animation перестаёт писать кости, когда клип Once (attack/hurt)
        // закончился или анимация остановлена, — тогда прибавка копилась бы
        // бесконечно (нога с переломом уходила по кругу). Здесь помним базу и
        // то, что записали сами: если аниматор кость не тронул — сперва откат.
        private sealed class BoneOffsetBase
        {
            public Quaternion Base;
            public Quaternion Written;
        }
        private readonly Dictionary<Transform, BoneOffsetBase> _boneOffsets =
            new Dictionary<Transform, BoneOffsetBase>();
        private static readonly string[] ProceduralOffsetBones =
        {
            "pelvis", "thigh_l", "upperarm_r", "upperarm_l", "head",
            "spine_01", "spine_02", "spine_03", "neck_01", "neck"
        };
        private readonly List<SkinnedMeshRenderer> _deathGroundRenderers = new List<SkinnedMeshRenderer>();
        private RoaWeaponView _weapon;
        private RoaOffhandWeaponView _offhandWeapon;
        private RoaEquipmentView _equipment;
        private RoaApocalypseCharacterSkin _apocalypseSkin;
        // Транспорт под седоком. Пока _riding, клип — покой, а поверх него поза
        // седока (RoaRiderPose) с весом _riderWeight; при спешивании вес плавно
        // уходит, а отпущенный транспорт сам доигрывает уход и удаляется.
        private const float RiderBlendSeconds = 0.24f;
        private readonly RoaRiderPose _rider = new RoaRiderPose();
        private RoaVehicleView _vehicle;
        private bool _riding;
        // Седло отпущено, но оружие ещё спрятано, а крен и посадка не сняты.
        private bool _dismountPending;
        private float _riderWeight;
        private float _rideSpeed;
        private float _rideYawRate;
        private float _rideLastYaw;
        private bool _rideHasYaw;
        private Vector3 _modelRootRest;
        private int _loadRequest;
        private string _bodyKey = "male_medium";
        private JObject _appearance;
        private readonly List<GameObject> _hairObjects = new List<GameObject>();
        private bool _dead;
        private bool _deathFallStarted;
        private bool _deathPoseFrozen;
        private float _deathStartedAt;
        private float _deathSettleWeight;
        private int _deathGroundContactBones;
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
        // Какой клип играет удар без оружия и реакция: джеб и кросс чередуются,
        // сильное попадание — удар в голову вместо короткого кивка.
        private string _attackClip = "attack";
        private string _reactionClip = "hurt";
        private bool _alternateAttack;
        // Удар кулаком на ходу: клип удара играет слоем поверх походки только на
        // корпусе и руках (от spine_01), ноги продолжают шаг.
        private bool _upperAttack;
        private const string UpperSuffix = "_upper";
        // Действие на месте (добыча, еда, ящик): клип до этого времени, пока стоим.
        private string _actionClip = string.Empty;
        private float _actionUntil;
        private string _activityPresentation = string.Empty;
        private float _activityPhaseOffset;
        private float _activityPresentationWeight;
        private Vector2 _lastImpactLocalSource = Vector2.up;
        private float _lastImpactAt = -100f;
        private bool _hasLastImpactDirection;
        private float _deathYawOffsetDeg;

        /// <summary>Длительность вспышки удара по умолчанию, с.</summary>
        private const float AttackSeconds = 0.45f;
        private const float CrossSeconds = 0.52f;
        private const int HeavyHitDamage = 25;
        private const float DeathImpactMemorySeconds = 0.9f;

        // Утверждённый humanoid death-клип уже содержит потерю равновесия,
        // падение и зафиксированные контакты рук/ног. Корень персонажа нельзя
        // поворачивать поверх него: это превращает расслабленную позу в доску.
        private const float DeathClipEndPaddingSeconds = 0.001f;
        private const float DeathSettleDurationSeconds = 1.27f;
        private const float DeathContactHeightMeters = 0.025f;
        private const float DeathMeshGroundClearanceMeters = 0.015f;
        private const float DeathMaximumGroundCorrectionMeters = 0.45f;

        // Сглаженные темпы. 04b:1657.
        private float _playbackRate = 1f;
        private float _strideSyncRate = 1f;

        public bool Ready { get; private set; }
        public bool UsesProjectPrefab { get; private set; }
        public bool UsesUnderwearBody { get; private set; }

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

        /// <summary>Идёт удар кулаком (стоя или на ходу поверх шага).</summary>
        public bool PunchActive { get { return Time.time < _attackUntil; } }

        /// <summary>Какой удар кулаком идёт: "attack" — джеб левой, "punch_cross" — кросс правой.</summary>
        public string PunchClip { get { return _attackClip; } }

        /// <summary>Удар кулаком играет верхним слоем поверх походки.</summary>
        public bool UpperBodyPunch { get { return _upperAttack && Time.time < _attackUntil; } }

        /// <summary>Доля пройденного удара кулаком, 0..1; −1 — удара нет. Для проб.</summary>
        public float DebugPunchPhase
        {
            get
            {
                if (Time.time >= _attackUntil || _animation == null) return -1f;
                AnimationState state = _animation[_upperAttack ? _attackClip + UpperSuffix : _attackClip];
                if (state == null || state.length <= 0f) return -1f;
                return Mathf.Clamp01(state.time / state.length);
            }
        }

        /// <summary>Доля пройденного текущего клипа, 0..1 (у петли — внутри цикла).</summary>
        public float CurrentClipPhase
        {
            get
            {
                AnimationState state = _animation != null && !string.IsNullOrEmpty(_currentClip) ? _animation[_currentClip] : null;
                if (state == null || state.length <= 0f) return 0f;
                float phase = state.time / state.length;
                return state.wrapMode == WrapMode.Loop ? Mathf.Repeat(phase, 1f) : Mathf.Clamp01(phase);
            }
        }
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

        public bool GroundShadowReady { get { return _groundShadow.Ready; } }
        public bool GroundShadowVisible { get { return _groundShadow.Visible; } }
        public RoaActorPresentationTier PresentationTier { get { return _presentationTier; } }
        public bool ProceduralPresentationActive { get { return _presentationTier == RoaActorPresentationTier.Near; } }
        public bool HitReactionActive { get { return _hitReaction.Active; } }
        public Vector2 HitReactionDirection { get { return _hitReaction.LocalSourceDirection; } }
        public bool Dead { get { return _dead; } }
        public float DeathYawOffsetDeg { get { return _deathYawOffsetDeg; } }
        public float DeathSettleWeight { get { return _deathSettleWeight; } }
        public static float DeathSettleSeconds { get { return DeathSettleDurationSeconds; } }
        public int DeathGroundContactBones { get { return _deathGroundContactBones; } }
        public float DeathGroundOffsetY { get { return transform.localPosition.y; } }

        /// <summary>Текущая просадка корня, м. Для диагностики.</summary>
        public float KneeFlex { get { return _pose.KneeFlex; } }

        /// <summary>Сглаженная сила контактной позы у препятствия.</summary>
        public float LocomotionContactPressure { get { return _pose.ContactPressure; } }

        /// <summary>
        /// Коллайдер принадлежит живому актёру (игроку, NPC или удалённому
        /// игроку), а не стене или предмету. Нужен контроллеру игрока, чтобы
        /// не считать столкновение с телом NPC контактом со стеной, и пробам.
        /// Перенесён сюда из удалённой системы foot IK.
        /// </summary>
        public static bool IsActorCollider(Collider collider, Transform owner)
        {
            if (collider == null) return false;
            Transform hit = collider.transform;
            if (owner != null && hit != null && hit.IsChildOf(owner)) return true;
            if (collider is CharacterController) return true;
            if (hit == null) return false;
            if (hit.GetComponentInParent<RoaPlayerController>() != null) return true;
            if (hit.GetComponentInParent<RoaCharacterView>() != null) return true;
            return hit.GetComponentInParent<RoaVisibilityGate>() != null;
        }

        public static CombatPresentationPhase ResolveCombatPresentationPhase(
            bool dead, bool reacting, bool attacking, bool locomoting)
        {
            if (dead) return CombatPresentationPhase.Death;
            if (reacting) return CombatPresentationPhase.Reaction;
            if (attacking) return CombatPresentationPhase.Attack;
            return locomoting ? CombatPresentationPhase.Locomotion
                : CombatPresentationPhase.Idle;
        }

        /// <summary>
        /// Направление источника к актёру превращается в восемь устойчивых
        /// вариантов падения. Клип падает назад, поэтому модель на момент смерти
        /// разворачивается к источнику: труп уходит от удара, а не всегда в одну
        /// и ту же экранную сторону.
        /// </summary>
        public static float DeathYawForImpact(Vector2 localSource)
        {
            if (localSource.sqrMagnitude < 0.001f) return 0f;
            localSource.Normalize();
            float raw = Mathf.Atan2(localSource.x, localSource.y) * Mathf.Rad2Deg;
            float quantized = Mathf.Round(raw / 45f) * 45f;
            return Mathf.DeltaAngle(0f, quantized);
        }

        /// <summary>Персонаж в приседе. Для диагностики.</summary>
        public bool Crouching { get { return _crouching; } }

        /// <summary>Персонаж сидит на транспорте (или садится на него).</summary>
        public bool Riding { get { return _riding; } }

        /// <summary>Транспорт под седоком; при спешивании — ещё уезжающий.</summary>
        public RoaVehicleView Vehicle { get { return _vehicle; } }

        /// <summary>Вес позы седока поверх клипа, 0..1. Для проб.</summary>
        public float RiderWeight { get { return _riderWeight; } }

        public RoaRiderPose RiderPose { get { return _rider; } }

        /// <summary>
        /// Посадить персонажа на транспорт по id предмета (пусто — спешить).
        /// Повторный вызов с тем же id ничего не делает.
        /// </summary>
        public void SetVehicle(string baseUrl, string itemId)
        {
            itemId = RoaVehicleCatalog.Contains(itemId) ? itemId : string.Empty;
            if (string.IsNullOrEmpty(itemId))
            {
                if (!_riding) return;
                // Оружие вернётся в руки, когда поза седока уйдёт целиком (LateUpdate).
                _riding = false;
                if (_vehicle != null) _vehicle.Dismiss();
                NotifyVisualChanged();
                return;
            }
            if (_riding && _vehicle != null && !_vehicle.Leaving && _vehicle.ItemId == itemId) return;
            if (_vehicle != null) Destroy(_vehicle.gameObject);
            _vehicle = RoaVehicleView.Create(transform, baseUrl, itemId);
            _vehicle.VisualChanged += NotifyVisualChanged;
            _riding = true;
            _dismountPending = true;
            _rideHasYaw = false;
            _ = RoaWeaponGrip.Ensure(baseUrl);
            SetHeldWeaponsStowed(true);
            NotifyVisualChanged();
        }

        /// <summary>
        /// Посадить на уже созданный транспорт (редакторские пробы берут модель из
        /// импортированного GLB, а не по HTTP).
        /// </summary>
        public void AttachVehicle(RoaVehicleView vehicle)
        {
            if (vehicle == null) return;
            if (_vehicle != null && _vehicle != vehicle)
            {
                if (Application.isPlaying) Destroy(_vehicle.gameObject);
                else DestroyImmediate(_vehicle.gameObject);
            }
            _vehicle = vehicle;
            _vehicle.VisualChanged += NotifyVisualChanged;
            _riding = true;
            _dismountPending = true;
            _rideHasYaw = false;
            SetHeldWeaponsStowed(true);
            NotifyVisualChanged();
        }

        private void SetHeldWeaponsStowed(bool stowed)
        {
            _weapon?.SetStowed(stowed);
            _offhandWeapon?.SetStowed(stowed);
        }

        /// <summary>Оружие подключено и смонтировано.</summary>
        public bool WeaponReady { get { return _weapon != null && _weapon.Ready; } }
        public bool OffhandWeaponReady { get { return _offhandWeapon != null && _offhandWeapon.Ready; } }
        /// <summary>Основное оружие в руках (видимое тело берёт с него места кистей).</summary>
        public RoaWeaponView HeldWeapon { get { return _weapon; } }
        public RoaOffhandWeaponView HeldOffhand { get { return _offhandWeapon; } }
        public string OffhandWeaponId { get { return _offhandWeapon != null ? _offhandWeapon.WeaponId : string.Empty; } }

        /// <summary>Максимальная глубина упора стволов, 0..1.</summary>
        public float WeaponObstruction
        {
            get
            {
                float primary = _weapon != null ? _weapon.ObstructedBlend : 0f;
                float offhand = _offhandWeapon != null ? _offhandWeapon.ObstructedBlend : 0f;
                return Mathf.Max(primary, offhand);
            }
        }

        /// <summary>Огнестрел поднят препятствием настолько, что выстрел невозможен.</summary>
        public bool FireObstructed
        {
            get
            {
                float primary = _weapon != null ? _weapon.ObstructedBlend : 0f;
                float offhand = _offhandWeapon != null ? _offhandWeapon.ObstructedBlend : 0f;
                return RoaWeaponView.BlocksFire(WeaponId, primary, offhand);
            }
        }

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

        /// <summary>
        /// Lightweight settlement-life layer for a stationary NPC. The server
        /// remains authoritative for the activity; this method only makes that
        /// state readable without adding a separate animation controller.
        /// </summary>
        public void SetActivityPresentation(string activity, float phaseOffset01)
        {
            _activityPresentation = (activity ?? string.Empty).Trim().ToLowerInvariant();
            _activityPhaseOffset = Mathf.Repeat(phaseOffset01, 1f);
        }

        public string ActivityPresentation { get { return _activityPresentation; } }
        public float ActivityPresentationWeight { get { return _activityPresentationWeight; } }

        /// <summary>Id оружия в руках. Пусто или «fists» — руки свободны.</summary>
        public string WeaponId { get { return _weapon != null ? _weapon.WeaponId : string.Empty; } }

        /// <summary>Id оружия, модель которого сейчас грузится. Пусто — загрузки нет.</summary>
        public string WeaponLoadingId { get { return _weapon != null ? _weapon.LoadingId : string.Empty; } }

        public void SetGroundingLod(bool active)
        {
            if (_groundingActive == active)
            {
                _groundShadow.SetActive(active);
                return;
            }
            _groundingActive = active;
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
                // The legacy rig's renderers are hidden behind the visible
                // PolygonApocalypse body. Culling by those renderers freezes
                // NPCs in their bind pose as soon as presentation LOD changes.
                _animation.cullingType = _apocalypseSkin != null
                    && tier != RoaActorPresentationTier.Hidden
                    ? AnimationCullingType.AlwaysAnimate
                    : AnimationCullingType.BasedOnRenderers;

            SetGroundingLod(tier == RoaActorPresentationTier.Near);
            if (tier != RoaActorPresentationTier.Near && changed)
                ResetProceduralPresentation();
            if (tier == RoaActorPresentationTier.Hidden && changed && _dead)
                SnapHiddenDeathToEnd();
        }

        private void ResetProceduralPresentation()
        {
            _hitReaction.Reset();
            _activityPresentationWeight = 0f;
            transform.localRotation = Quaternion.identity;
            transform.localPosition = Vector3.zero;
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
            death.time = FinalDeathPoseTime(death);
            death.speed = 0f;
            _animation.Sample();
            _deathPoseFrozen = true;
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

        /// <summary>
        /// Current animated right-hand position. Tools thrown by the character use the
        /// skeleton instead of a fixed offset so crouching, locomotion and body variants
        /// cannot detach the projectile from the hand.
        /// </summary>
        public bool TryGetRightHand(out Vector3 worldPosition)
        {
            if (!_bones.TryGetValue("hand_r", out Transform hand) || hand == null)
            {
                hand = FindDeep(transform, "hand_r");
                if (hand != null) _bones["hand_r"] = hand;
            }
            if (hand != null)
            {
                worldPosition = hand.position;
                return true;
            }
            worldPosition = Vector3.zero;
            return false;
        }

        /// <summary>Дать обеим поднятым рукам короткий контактный толчок.</summary>
        public void PlayBlockedFireContact()
        {
            if (_weapon != null) _weapon.PlayBlockedContact();
            if (_offhandWeapon != null) _offhandWeapon.PlayBlockedContact();
        }

        /// <summary>Запустить визуал перезарядки: левая рука уходит к магазину.</summary>
        public void StartReload(float durationSeconds)
        {
            if (_weapon != null) _weapon.StartReload(durationSeconds);
            if (_offhandWeapon != null) _offhandWeapon.StartReload(durationSeconds);
        }

        /// <summary>Убрать косметическую перезарядку перед следующим разрешённым выстрелом.</summary>
        public void CancelReload()
        {
            if (_weapon != null) _weapon.CancelReload();
            if (_offhandWeapon != null) _offhandWeapon.CancelReload();
        }

        /// <summary>
        /// Проиграть удар или выстрел. Экипированное оружие использует свой
        /// процедурный слой и сохраняет текущую походку; полнотелый attack-клип
        /// остаётся резервом для безоружной атаки.
        /// </summary>
        public void PlayAttack()
        {
            PlayAttack(0f);
        }

        /// <summary>
        /// Проиграть атаку с опциональным серверным дедлайном контакта.
        /// Локальный игрок передаёт ноль и сохраняет быстрый отзывчивый замах;
        /// NPC передаёт полную длительность, рассчитанную из attackMs.
        /// </summary>
        public void PlayAttack(float meleeSwingSeconds)
        {
            CombatPresentationPhase phase = ResolveCombatPresentationPhase(
                _dead, _hitReaction.Active || Time.time < _hurtUntil,
                false, _locomoting);
            if (phase == CombatPresentationPhase.Death
                || phase == CombatPresentationPhase.Reaction) return;

            if (_weapon != null && _weapon.Ready)
            {
                _weapon.PlayAttack(meleeSwingSeconds);
                _attackUntil = 0f;
                return;
            }

            if (!Ready || !_clips.Contains("attack")) return;

            _actionUntil = 0f;
            // Джеб и кросс чередуются: серия ударов не выглядит одним повтором.
            _attackClip = _alternateAttack && _clips.Contains("punch_cross") ? "punch_cross" : "attack";
            // Кросс длиннее джеба: удар доходит до конца, а не обрывается на вытянутой руке.
            _attackUntil = Time.time + (_attackClip == "punch_cross" ? CrossSeconds : AttackSeconds);
            _alternateAttack = !_alternateAttack;

            // На ходу ноги не встают: удар идёт верхним слоем, походка остаётся.
            AnimationState upper = _locomoting ? UpperAttackState(_attackClip) : null;
            if (upper != null)
            {
                _upperAttack = true;
                upper.wrapMode = WrapMode.ClampForever;
                upper.time = 0f;
                upper.speed = 1f;
                _animation.CrossFade(upper.name, 0.08f);
                return;
            }
            FadeUpperAttack(0.08f);

            // Перезапуск с нуля: очередь выстрелов должна давать удар на каждый,
            // а не один растянутый.
            _currentClip = _attackClip;
            _animation[_currentClip].wrapMode = WrapMode.Once;
            _animation[_currentClip].time = 0f;
            _animation[_currentClip].speed = 1f;
            _animation.CrossFade(_attackClip, 0.08f);
        }

        /// <summary>
        /// Копия клипа удара на слое 1, которая пишет только корпус, голову и руки
        /// (всё ниже spine_01 — от походки). Создаётся при первом ударе на ходу.
        /// </summary>
        private AnimationState UpperAttackState(string clip)
        {
            if (_animation == null || !_clips.Contains(clip)) return null;
            string name = clip + UpperSuffix;
            AnimationState state = _animation[name];
            if (state != null) return state;
            if (!_bones.TryGetValue("spine_01", out Transform spine) || spine == null) return null;
            AnimationClip source = _animation.GetClip(clip);
            if (source == null) return null;
            _animation.AddClip(source, name);
            state = _animation[name];
            state.layer = 1;
            state.AddMixingTransform(spine, true);
            return state;
        }

        private void FadeUpperAttack(float seconds)
        {
            _upperAttack = false;
            if (_animation == null) return;
            foreach (string clip in new[] { "attack", "punch_cross" })
            {
                AnimationState state = _animation[clip + UpperSuffix];
                if (state != null && state.enabled) _animation.Blend(state.name, 0f, seconds);
            }
        }

        /// <summary>Идёт ли действие на месте (добыча, еда, ящик).</summary>
        public bool ActionActive { get { return Time.time < _actionUntil && !string.IsNullOrEmpty(_actionClip); } }

        /// <summary>
        /// Действие на месте полнотелым клипом: добыча, еда и аптечка, открытие
        /// ящика. Длится <paramref name="seconds"/> или до первого шага; клип
        /// короче — повторяется. Нет клипа или персонаж мёртв/в движении — false.
        /// </summary>
        public bool PlayAction(string clip, float seconds, float speed = 1f)
        {
            if (_dead || !Ready || _animation == null || _locomoting || _riding
                || string.IsNullOrEmpty(clip) || !_clips.Contains(clip)) return false;
            AnimationState state = _animation[clip];
            _actionClip = clip;
            _actionUntil = Time.time + Mathf.Max(0.2f, seconds);
            _attackUntil = 0f;
            state.wrapMode = seconds * speed > state.length + 0.05f ? WrapMode.Loop : WrapMode.ClampForever;
            state.time = 0f;
            state.speed = Mathf.Max(0.1f, speed);
            _currentClip = clip;
            // На колено и с колена — дольше: иначе поза прыгает.
            _animation.CrossFade(clip, clip == "kneel_work" ? 0.3f : 0.18f);
            return true;
        }

        public void PlayHit()
        {
            PlayHitInternal(Vector3.zero, false, 12, false);
        }

        public void PlayHit(Vector3 sourceWorld, int damage, bool critical)
        {
            PlayHitInternal(sourceWorld, true, damage, critical);
        }

        private void PlayHitInternal(Vector3 sourceWorld, bool hasSource, int damage, bool critical)
        {
            if (_dead || !Ready) return;
            RememberImpact(sourceWorld, hasSource);
            _attackUntil = 0f;
            if (_weapon != null) _weapon.CancelAttackPose();
            if (_presentationTier == RoaActorPresentationTier.Near)
                _hitReaction.Trigger(transform, sourceWorld, hasSource, damage, critical);

            // Ноги продолжают текущий gait или стойку; направленный процедурный слой
            // даёт реакцию всей цепью позвоночника и тазом. Клипы hurt/hit_head (UAL)
            // дёргают одну шею — они остались дальнему LOD, где слоя нет.
            bool fullBody = !_hitReaction.Ready || _presentationTier != RoaActorPresentationTier.Near;
            if (!fullBody || !_clips.Contains("hurt"))
            {
                _hurtUntil = 0f;
                return;
            }
            _actionUntil = 0f;
            // Сильный удар (крит или от 25 урона) запрокидывает голову, лёгкий — вздрагивание.
            bool heavy = (critical || damage >= HeavyHitDamage) && _clips.Contains("hit_head");
            _reactionClip = heavy ? "hit_head" : "hurt";
            // Тяжёлое — медленнее (0.8×): с камеры сверху читается сильнее лёгкого.
            _hurtUntil = Time.time + (heavy ? 0.72f : 0.36f);
            _currentClip = _reactionClip;
            _animation[_currentClip].wrapMode = WrapMode.Once;
            _animation[_currentClip].time = 0f;
            _animation[_currentClip].speed = heavy ? 0.8f : 1f;
            _animation.CrossFade(_reactionClip, 0.06f);
        }

        /// <summary>
        /// Запомнить смертельный источник до переключения в death. Никакая
        /// реакция уже не запускается: метод только выбирает направление падения.
        /// </summary>
        public void PrepareDeath(Vector3 sourceWorld, bool hasSource = true)
        {
            RememberImpact(sourceWorld, hasSource);
        }

        private void RememberImpact(Vector3 sourceWorld, bool hasSource)
        {
            if (!hasSource)
            {
                _hasLastImpactDirection = false;
                return;
            }
            Vector3 delta = sourceWorld - transform.position;
            delta.y = 0f;
            if (delta.sqrMagnitude < 0.0144f)
            {
                _hasLastImpactDirection = false;
                return;
            }
            Vector3 local = transform.InverseTransformDirection(delta.normalized);
            _lastImpactLocalSource = new Vector2(local.x, local.z).normalized;
            _lastImpactAt = Time.unscaledTime;
            _hasLastImpactDirection = true;
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
            bool wasDead = _dead;
            _dead = dead;
            _deathGroundRenderers.Clear();
            if (dead)
            {
                // Упавший седок падает с земли: транспорт уходит сразу, без плавного спешивания.
                if (_vehicle != null)
                {
                    _vehicle.Dismiss();
                    _vehicle = null;
                }
                if (_riderWeight > 0f && _modelRoot != null) _modelRoot.localPosition = _modelRootRest;
                _riding = false;
                _dismountPending = false;
                _riderWeight = 0f;
                _rideYawRate = 0f;
                _rideHasYaw = false;
                SetHeldWeaponsStowed(false);
                if (!wasDead)
                {
                    bool recentImpact = _hasLastImpactDirection
                        && Time.unscaledTime - _lastImpactAt <= DeathImpactMemorySeconds;
                    _deathYawOffsetDeg = recentImpact
                        ? DeathYawForImpact(_lastImpactLocalSource) : 0f;
                }
                _locomoting = false;
                Turning = false;
                _turnHold = 0f;
                _attackUntil = 0f;
                _hurtUntil = 0f;
                _actionUntil = 0f;
                _activityPresentation = string.Empty;
                _activityPresentationWeight = 0f;
                if (_weapon != null) _weapon.CancelAttackPose();
                _hitReaction.Reset();
                if (!wasDead || !_deathFallStarted)
                {
                    _deathFallStarted = true;
                    _deathPoseFrozen = false;
                    _deathStartedAt = Time.unscaledTime;
                    _deathSettleWeight = 0f;
                    transform.localRotation = Quaternion.Euler(0f, _deathYawOffsetDeg, 0f);
                    transform.localPosition = Vector3.zero;
                }
                if (_injuryIndicator != null) _injuryIndicator.gameObject.SetActive(false);
            }
            else
            {
                _deathFallStarted = false;
                _deathPoseFrozen = false;
                _deathSettleWeight = 0f;
                _deathYawOffsetDeg = 0f;
                _hasLastImpactDirection = false;
                _lastImpactAt = -100f;
                transform.localRotation = Quaternion.identity;
                transform.localPosition = Vector3.zero;
                UpdateInjuryIndicator();
            }
            if (!Ready || _animation == null) return;

            if (dead && _clips.Contains("death"))
            {
                _currentClip = "death";
                _animation[_currentClip].wrapMode = WrapMode.ClampForever;
                _animation[_currentClip].time = 0f;
                _animation[_currentClip].speed = 1f;
                // Death is authoritative, not a blendable request. StopAll also
                // prevents a locomotion state retaining weight behind this clip.
                _animation.Play(_currentClip, PlayMode.StopAll);
                if (_presentationTier == RoaActorPresentationTier.Hidden) SnapHiddenDeathToEnd();
            }
            else if (dead)
            {
                // A malformed or still-loading animation set must never leave a
                // corpse walking. Freeze a neutral frame while retaining the
                // semantic death state for late-load recovery.
                _animation.Stop();
                if (_clips.Contains("idle"))
                {
                    AnimationState fallback = _animation["idle"];
                    fallback.wrapMode = WrapMode.ClampForever;
                    fallback.time = 0f;
                    fallback.speed = 0f;
                    _animation.Play("idle", PlayMode.StopAll);
                    _animation.Sample();
                }
                _currentClip = "death";
            }
            else if (!dead)
            {
                _currentClip = string.Empty;
                Play("idle");
            }
        }

        private void FreezeDeathPose(float elapsed)
        {
            if (_deathPoseFrozen || _animation == null || !_clips.Contains("death")) return;
            AnimationState death = _animation["death"];
            if (death == null) return;
            float finalTime = FinalDeathPoseTime(death);
            if (elapsed < finalTime) return;
            death.time = finalTime;
            death.speed = 0f;
            _animation.Sample();
            _deathPoseFrozen = true;
        }

        public static float FinalDeathPoseTime(AnimationState death)
        {
            return death != null ? Mathf.Max(0f, death.length - DeathClipEndPaddingSeconds) : 0f;
        }

        /// <summary>Restore an already fallen presentation actor without replaying its fall.</summary>
        public void SetCorpsePresentationImmediate()
        {
            SetDead(true);
            _deathStartedAt = Time.unscaledTime - 100f;
            if (_animation != null && _clips.Contains("death"))
            {
                _animation.Play("death", PlayMode.StopAll);
                _animation["death"].enabled = true;
                _animation["death"].weight = 1f;
                _deathPoseFrozen = false;
            }
            FreezeDeathPose(100f);
            ApplyDeathSettleForDiagnostics(100f);
            GroundDeathForDiagnostics(transform.parent != null ? transform.parent.position.y : 0f);
        }

        public static float DeathSettleWeightAt(float elapsed)
        {
            float t = Mathf.Clamp01(elapsed / DeathSettleDurationSeconds);
            return t * t * (3f - 2f * t);
        }

        /// <summary>Обновить только фазу контактной тени; позу целиком даёт GLB-клип.</summary>
        public void ApplyDeathSettleForDiagnostics(float elapsed)
        {
            if (!_dead) return;
            _deathSettleWeight = DeathSettleWeightAt(elapsed);
            transform.localRotation = Quaternion.identity;
            transform.localPosition = Vector3.zero;
        }

        /// <summary>Слегка выровнять авторские контакты ладоней/стоп по реальной земле.</summary>
        public void GroundDeathForDiagnostics(float groundY)
        {
            if (!_dead || _bones.Count == 0) return;
            _deathGroundContactBones = 0;
            float minY = float.PositiveInfinity;
            foreach (string name in DeathContactBones)
            {
                if (_bones.TryGetValue(name, out Transform bone) && bone != null)
                {
                    minY = Mathf.Min(minY, bone.position.y);
                    _deathGroundContactBones++;
                }
            }
            bool hasMeshBounds = TryGetDeathMeshMinimumY(out float meshMinY);
            if (!hasMeshBounds && float.IsInfinity(minY)) return;
            float surfaceMinY = hasMeshBounds ? meshMinY : minY;
            float targetClearance = hasMeshBounds
                ? DeathMeshGroundClearanceMeters : DeathContactHeightMeters;
            float settled = Mathf.Clamp(groundY + targetClearance - surfaceMinY,
                -DeathMaximumGroundCorrectionMeters, DeathMaximumGroundCorrectionMeters);
            // Пока тело падает, рамка меша — грубая коробка скина и тянет его вверх
            // («подскок» в начале смерти). В падении кости лишь не уходят под пол,
            // к лёжа поправка переходит целиком.
            float falling = float.IsInfinity(minY) ? 0f : Mathf.Max(0f, groundY - minY);
            float correction = Mathf.Lerp(falling, settled, _deathPoseFrozen ? 1f : _deathSettleWeight * _deathSettleWeight);
            Vector3 local = transform.localPosition;
            local.y += correction;
            transform.localPosition = local;
        }

        private bool TryGetDeathMeshMinimumY(out float minimumY)
        {
            minimumY = float.PositiveInfinity;
            if (_deathGroundRenderers.Count == 0)
                GetComponentsInChildren(true, _deathGroundRenderers);
            for (int i = 0; i < _deathGroundRenderers.Count; i++)
            {
                SkinnedMeshRenderer renderer = _deathGroundRenderers[i];
                if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                minimumY = Mathf.Min(minimumY, renderer.bounds.min.y);
            }
            return !float.IsInfinity(minimumY);
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
            _weapon.SetStowed(_riding);
            await _weapon.Load(baseUrl, weaponId, _modelRoot, _bones);
            UpdateDualWieldState();
            NotifyVisualChanged();
        }

        /// <summary>Надеть шесть видимых слотов на тот же скелет, что анимирует тело.</summary>
        public async Task EquipItems(string baseUrl, JObject equipment)
        {
            if (!Ready || _modelRoot == null) return;

            if (_equipment == null)
            {
                _equipment = new RoaEquipmentView();
                _equipment.VisualChanged += EquipmentVisualChanged;
            }
            if (_offhandWeapon == null) _offhandWeapon = new RoaOffhandWeaponView();
            _offhandWeapon.SetStowed(_riding);
            string offhandId = BaseItemId(equipment?["offhand"]?.ToString());
            await Task.WhenAll(
                _equipment.Apply(baseUrl, equipment, _bodyKey, _modelRoot, _bones),
                _offhandWeapon.Load(baseUrl, offhandId, _modelRoot, _bones));
            // Итог пересчитывает любой завершившийся вызов, а не только последний:
            // повторный снимок посреди загрузки возвращается сразу, и модели
            // довозит более ранний вызов. Всё ниже читает текущее состояние.
            if (!Ready || _modelRoot == null) return;
            UpdateDualWieldState();
            ApplyAppearanceVisuals();
            NotifyVisualChanged();
        }

        public int LoadedEquipmentSlotCount { get { return _equipment?.LoadedSlotCount ?? 0; } }

        /// <summary>Настоящий id надетой вещи слота (с тиром), для цвета тира на модели.</summary>
        public string EquippedItemId(string slot) => _equipment?.EquippedItemId(slot) ?? string.Empty;

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
                && _offhandWeapon != null && _offhandWeapon.Ready
                && RoaOffhandWeaponView.IsSupported(_offhandWeapon.WeaponId);
        }

        /// <summary>Модель по умолчанию для старых сохранений без внешности (PLAYER_SYSTEM.md).</summary>
        public static string ModelKey(JObject appearance)
        {
            string sex = appearance?["sex"]?.ToString();
            if (sex != "female" && sex != "male") sex = "male";
            // Телосложение и форма лица не выбираются: у пола одна базовая модель.
            return sex + "_medium";
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
            ApplyAppearanceVisuals();
            NotifyVisualChanged();
            return true;
        }

        public async Task Load(string baseUrl, JObject appearance, bool useUnderwearBody = false)
        {
            int loadRequest = ++_loadRequest;
            string key = ModelKey(appearance);
            _bodyKey = key;
            _appearance = appearance != null ? (JObject)appearance.DeepClone() : new JObject();
            string relativeUrl = "/assets/models/characters/base/character_" + key + ".glb";
            string url = baseUrl.TrimEnd('/') + relativeUrl;
            Ready = false;
            UsesProjectPrefab = false;
            UsesUnderwearBody = useUnderwearBody;
            _clips.Clear();
            _bones.Clear();
            _boneOffsets.Clear();

            GameObject prefabInstance;
            UsesProjectPrefab = RoaModelPrefabCatalog.TryInstantiate(
                relativeUrl, transform, out prefabInstance);

            GltfImport import = UsesProjectPrefab ? null : await LoadCached(key, url);
            if (!LoadIsCurrent(loadRequest)) return;
            if (!UsesProjectPrefab && import == null)
            {
                Debug.LogError("[ROA] Модель персонажа не загрузилась: " + url);
                return;
            }

            if (!UsesProjectPrefab && !await import.InstantiateMainSceneAsync(transform))
            {
                Debug.LogError("[ROA] Не удалось создать экземпляр модели " + key);
                return;
            }
            if (!LoadIsCurrent(loadRequest)) return;

            // Cinematic/prewarmed actors are intentionally inactive while their
            // models load. Still bind their animation and equipment skeleton.
            _animation = GetComponentInChildren<Animation>(true);
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
            // верха.
            _pose.Bind(transform);

            _modelRoot = FindDeep(transform, LibraryRootName) ?? FindDeep(transform, BaseRootName);
            if (_modelRoot != null) _modelRootRest = _modelRoot.localPosition;
            _groundShadow.Bind(transform);
            _groundShadow.SetActive(_groundingActive);

            // Индекс костей по имени: по нему работают поза хвата и доворот корпуса.
            foreach (Transform bone in GetComponentsInChildren<Transform>(true))
            {
                // Узлы транспорта (seat, steer…) — не кости тела.
                if (_vehicle != null && bone.IsChildOf(_vehicle.transform)) continue;
                if (!_bones.ContainsKey(bone.name)) _bones[bone.name] = bone;
            }
            _hitReaction.Bind(_modelRoot != null ? _modelRoot : transform);
            _rider.Bind(_bones);

            PrepareAppearance();
            ApplyAppearanceVisuals();

            GameObject apocalypseBody = useUnderwearBody ? null : RoaApocalypseModels.Character(key);
            if (_modelRoot != null && apocalypseBody != null)
            {
                _apocalypseSkin = GetComponent<RoaApocalypseCharacterSkin>();
                if (_apocalypseSkin == null)
                    _apocalypseSkin = gameObject.AddComponent<RoaApocalypseCharacterSkin>();
                if (_apocalypseSkin.Bind(apocalypseBody))
                    // The hidden GLB rig still drives the visible pack skin.
                    // Renderer-based culling would stop its clips entirely.
                    _animation.cullingType = AnimationCullingType.AlwaysAnimate;
            }

            _animation.wrapMode = WrapMode.Loop;
            Play("idle");
            // The creator exposes this rig directly. Apply its first idle pose
            // before the preview becomes visible so loading never flashes a T-pose.
            if (useUnderwearBody && _animation["idle"] != null)
            {
                AnimationState idle = _animation["idle"];
                idle.enabled = true;
                idle.weight = 1f;
                idle.time = Mathf.Min(0.35f, idle.length * 0.35f);
                _animation.Sample();
            }
            Ready = true;
            if (_dead) SetDead(true);

            Debug.Log("[ROA] Модель " + key + ", клипы: " + string.Join(", ", _clips)
                + ", поза: " + (_pose.Ready ? "включена" : "выключена"));
            NotifyVisualChanged();
        }

        private bool LoadIsCurrent(int request)
        {
            return this != null && request == _loadRequest;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root == null) return null;
            if (root.name == name) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                Transform found = FindDeep(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        private void PrepareAppearance()
        {
            _hairObjects.Clear();
            foreach (Transform node in GetComponentsInChildren<Transform>(true))
            {
                if (node.name.StartsWith("hair_")) _hairObjects.Add(node.gameObject);
            }

            ReadAppearanceVariants();
        }

        private void ReadAppearanceVariants()
        {
            Color hair = HairColor(_appearance?["hairColorId"]?.ToString());
            foreach (GameObject hairObject in _hairObjects)
            {
                foreach (Renderer renderer in hairObject.GetComponentsInChildren<Renderer>(true))
                {
                    // GLTFast creates transient materials for the imported character. In play mode
                    // renderer.materials gives each actor its own instances; editor probes must use
                    // the already transient shared set or Unity reports a material leak.
                    Material[] materials = Application.isPlaying
                        ? renderer.materials
                        : renderer.sharedMaterials;
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

        private void EquipmentVisualChanged()
        {
            if (!Ready || _modelRoot == null) return;
            ApplyAppearanceVisuals();
            NotifyVisualChanged();
        }

        private void ApplyAppearanceVisuals()
        {
            string hairId = _appearance?["hairId"]?.ToString() ?? "short_crop";
            bool covered = _equipment != null && _equipment.CoversHair(_modelRoot);
            bool showHair = !covered && hairId != "shaved";
            foreach (GameObject hairObject in _hairObjects)
                if (hairObject != null && hairObject.activeSelf != showHair) hairObject.SetActive(showHair);
            if (_apocalypseSkin != null) _apocalypseSkin.SetNativeHairVisible(showHair);
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
            if (_apocalypseSkin != null) _apocalypseSkin.HideLegacyVisuals();
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
            int session = _modelCacheSession;
            if (ModelCache.TryGetValue(key, out GltfImport cached)) return cached;
            if (!ModelLoads.TryGetValue(key, out Task<GltfImport> loading))
            {
                loading = LoadSharedImport(url);
                ModelLoads[key] = loading;
            }

            GltfImport import;
            try
            {
                import = await loading;
            }
            finally
            {
                if (ModelLoads.TryGetValue(key, out Task<GltfImport> current)
                    && ReferenceEquals(current, loading))
                    ModelLoads.Remove(key);
            }
            if (session != _modelCacheSession) return null;
            if (import != null) ModelCache[key] = import;
            return import;
        }

        private static async Task<GltfImport> LoadSharedImport(string url)
        {
            var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };
            var import = new GltfImport();
            if (await import.Load(RoaModelUrl.Lite(url), settings)) return import;
            import.Dispose();
            return null;
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
            AnimationClip[] clips = RoaModelPrefabCatalog.AnimationClips(AnimationLibraryUrl);
            if (clips.Length == 0 && !_animationLibraryTried)
            {
                _animationLibraryTried = true;
                _animationLibraryLoad = LoadSharedImport(
                    baseUrl.TrimEnd('/') + AnimationLibraryUrl);
            }

            if (clips.Length == 0 && _animationLibrary == null && _animationLibraryLoad != null)
                _animationLibrary = await _animationLibraryLoad;

            if (clips.Length == 0 && _animationLibrary != null)
                clips = _animationLibrary.GetAnimationClips();
            if (clips == null || clips.Length == 0) return false;

            Transform root = FindDeep(transform, BaseRootName);
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

                if (!clip.legacy) clip.legacy = true;
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
        public void UpdateLocomotion(Vector3 velocity, float facingYawDeg, bool moving, bool crouching,
                                     Vector3 collisionNormal = default(Vector3),
                                     float collisionPressure = 0f)
        {
            if (_dead || !Ready || _animation == null) return;

            float dt = Mathf.Clamp(Time.deltaTime, 0.001f, 0.08f);
            float speed = new Vector2(velocity.x, velocity.z).magnitude;
            bool actuallyMoving = moving && speed >= 0.05f;

            if (_riding)
            {
                // Верхом ноги не шагают: клип — покой, а позу даёт седло (LateUpdate).
                // Мотоцикл смотрит на курсор, а едет по WASD: колёсам нужен ход вдоль
                // корпуса со знаком — назад они крутятся назад, боком стоят.
                float yawRad = facingYawDeg * Mathf.Deg2Rad;
                float along = velocity.x * Mathf.Sin(yawRad) + velocity.z * Mathf.Cos(yawRad);
                _rideSpeed = actuallyMoving ? along : 0f;
                _locomoting = false;
                Turning = false;
                _turnHold = 0f;
                _backward = false;
                _strafing = false;
                _crouching = false;
                if (Time.time >= _hurtUntil && Time.time >= _attackUntil)
                {
                    Play("idle");
                    ApplyTimeScale("idle", false, 0f, 0f, dt);
                }
                _pose.Step(false, false, "idle", 0f, 0f, 1f, 0f, false, false, dt, 0f, 0f, 0f);
                return;
            }

            UpdateTurnInPlace(facingYawDeg, actuallyMoving, dt);

            // Направление движения относительно прицела. Формулы совпадают с
            // characterDirectionalLocomotionState(), 04b:724.
            float facingRad = facingYawDeg * Mathf.Deg2Rad;
            Vector3 facing = new Vector3(Mathf.Sin(facingRad), 0f, Mathf.Cos(facingRad));
            Vector3 right = new Vector3(Mathf.Cos(facingRad), 0f, -Mathf.Sin(facingRad));
            Vector3 obstacleDirection = Vector3.zero;
            collisionNormal.y = 0f;
            if (collisionNormal.sqrMagnitude > 0.0001f)
                obstacleDirection = -collisionNormal.normalized;
            float contactForward = Vector3.Dot(obstacleDirection, facing);
            float contactSide = Vector3.Dot(obstacleDirection, right);
            float contactWeight = Mathf.Clamp01(collisionPressure);

            Vector3 move = actuallyMoving
                ? new Vector3(velocity.x, 0f, velocity.z).normalized
                : facing;

            float forwardAmount = Mathf.Clamp(Vector3.Dot(move, facing), -1f, 1f);
            float sideAmount = Mathf.Clamp(Vector3.Dot(move, right), -1f, 1f);
            float relativeAngle = Mathf.Atan2(sideAmount, forwardAmount);

            // Боковой шаг — свой клип (CMU): ноги идут приставным шагом, корпус смотрит
            // на прицел. Он возможен до StrafeMaxSpeed — быстрее вбок человек не
            // семенит, а разворачивается и бежит; в приседе боковых клипов нет.
            bool strafeAllowed = actuallyMoving && !crouching && speed <= StrafeMaxSpeed
                && _clips.Contains("strafe_left") && _clips.Contains("strafe_right");
            _strafing = strafeAllowed && IsStrafeSector(Mathf.Abs(relativeAngle) * Mathf.Rad2Deg, _strafing);
            _backward = actuallyMoving && !_strafing
                && (_backward ? forwardAmount < BackwardExit : forwardAmount < BackwardEnter);
            int strafeSign = _strafing ? (relativeAngle > 0f ? 1 : -1) : 0;

            _locomoting = actuallyMoving || Turning;
            bool locomoting = _locomoting;
            bool fast = speed > RunSpeedThreshold;

            // Ноги смотрят по пути с поправкой на клип: «вперёд» разворачивается на
            // угол движения, «назад» — на противоположный, боковой шаг — на угол
            // от чистого бока (не больше ~40°). Корпус остаётся на прицеле.
            float lowerBodyYaw = 0f;
            if (Turning)
            {
                lowerBodyYaw = _turnAmount * 0.28f;
            }
            else if (actuallyMoving)
            {
                float pathYaw = _strafing ? relativeAngle - strafeSign * Mathf.PI * 0.5f
                    : _backward ? WrapAngle(relativeAngle + Mathf.PI) : relativeAngle;
                lowerBodyYaw = Mathf.Clamp(pathYaw, -LowerBodyYawClamp, LowerBodyYawClamp);
            }
            else if (!crouching)
            {
                // Стойка стрелка — боком: ноги и таз развёрнуты к стороне оружия, левая
                // нога впереди, корпус возвращается к прицелу скруткой.
                lowerBodyYaw = ArmedStanceYaw();
            }

            string clip = strafeSign != 0
                ? StrafeClip(strafeSign, speed)
                : SelectClip(actuallyMoving, crouching, _backward, fast, speed);

            // Ближний LOD сохраняет gait даже если игрок начал двигаться уже
            // после попадания. На дальнем LOD остаётся дешёвый полнотелый клип.
            if (locomoting && _presentationTier == RoaActorPresentationTier.Near)
                _hurtUntil = 0f;
            bool hurt = Time.time < _hurtUntil && _clips.Contains("hurt");
            // Удар на ходу закончился — верхний слой плавно отдаёт руки походке.
            if (_upperAttack && Time.time >= _attackUntil) FadeUpperAttack(0.2f);
            // Верхний слой не останавливает походку: ноги идут своим клипом.
            bool attacking = Time.time < _attackUntil && !_upperAttack;
            CombatPresentationPhase phase = ResolveCombatPresentationPhase(
                false, hurt, attacking, locomoting);
            // Шаг прерывает действие на месте (добычу, еду, ящик).
            if (locomoting || crouching) _actionUntil = 0f;
            if (phase == CombatPresentationPhase.Idle && ActionActive)
            {
                clip = _actionClip;
            }
            else if (phase == CombatPresentationPhase.Idle
                || phase == CombatPresentationPhase.Locomotion)
            {
                Play(clip);
                ApplyTimeScale(clip, actuallyMoving, speed, sideAmount, dt);
            }
            else if (phase == CombatPresentationPhase.Reaction)
            {
                clip = _reactionClip;
            }
            else
            {
                clip = _attackClip;
            }

            _crouching = crouching;

            // Стойка, шаг и бег в приседе уже сидят в клипах: процедурные просадка и
            // наклон — только для бега спиной пригнувшись (UAL, таз почти на высоте шага).
            bool poseCrouch = crouching && clip == "crouch_run_back";
            _pose.Step(locomoting, Turning, clip, lowerBodyYaw,
                sideAmount, forwardAmount, _turnAmount, poseCrouch, false, dt,
                contactWeight, contactForward, contactSide);
        }

        private void LateUpdate()
        {
            if (!Ready || _presentationTier == RoaActorPresentationTier.Hidden) return;

            if (_injuryIndicator != null && _injuryIndicator.gameObject.activeSelf)
            {
                Vector3 local = _injuryIndicator.localPosition;
                local.y = 2.5f + Mathf.Sin(Time.time / 0.42f) * 0.08f;
                _injuryIndicator.localPosition = local;
            }
            if (_dead)
            {
                float deathElapsed = _deathFallStarted
                    ? Time.unscaledTime - _deathStartedAt : DeathSettleSeconds;
                FreezeDeathPose(deathElapsed);
                ApplyDeathSettleForDiagnostics(deathElapsed);
                float deathGroundY = transform.parent != null
                    ? transform.parent.position.y : transform.position.y;
                GroundDeathForDiagnostics(deathGroundY);
                // Оружие остаётся у кисти и после перехода в позу смерти, но без
                // дорогого IK и проб столкновения ствола.
                if (_weapon != null) _weapon.ApplyReduced();
                if (_offhandWeapon != null) _offhandWeapon.ApplyReduced();
                UpdateGroundShadow();
                return;
            }

            // Седло — на любом уровне детализации: иначе дальний седок стоял бы
            // над мотоциклом. Поза седока дешёвая: четыре цепи по две кости.
            if (UpdateRiding(Mathf.Clamp(Time.deltaTime, 0f, 0.1f)))
            {
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

            // Окно процедурных смещений открывается до направленной позы и приседа:
            // RoaCharacterPose тоже пишет таз и позвоночник аддитивно, и на
            // замороженной анимации наклон таза копился по кадрам — тело кувыркалось.
            BeginBoneOffsets();
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
                ApplyPunchDrive();
            }
            else
            {
                transform.localRotation = Quaternion.Euler(0f, 0f, InjuryRootRollDeg());
            }

            // Поверх клипа и направленной позы, но до оружейного IK: корпус
            // отшатывается, а кисти затем снова точно садятся на рукояти.
            ApplyActivityPresentation(Time.deltaTime);
            _hitReaction.Apply(Time.deltaTime);

            // Хват и оружие поверх позы: кисть считается от таза и позвоночника,
            // которые направленная поза уже развернула.
            // Во время действия руки ведёт клип: оружие просто держится в кисти.
            if (_weapon != null)
            {
                if (ActionActive) _weapon.ApplyHeld();
                else _weapon.Apply(_aimPoint, _hasAim);
            }
            if (_offhandWeapon != null) _offhandWeapon.Apply(_aimPoint, _hasAim, _weapon);

            // Травма — самый верхний визуальный слой. Перелом руки намеренно
            // ослабляет идеальный IK-хват, а перелом ноги остаётся видим поверх
            // авторской анимации ног (foot IK удалён: стопы следуют клипу).
            ApplyInjuryPose();
            EndBoneOffsets();
            UpdateGroundShadow();
        }

        /// <summary>
        /// Езда за кадр: колёса, руль и крен транспорта, затем поза седока поверх
        /// клипа. true — кадр отдан седлу, обычная поза не нужна.
        /// </summary>
        private bool UpdateRiding(float dt)
        {
            bool vehicleAlive = _vehicle != null;
            float target = _riding && vehicleAlive && _vehicle.Ready ? 1f : 0f;
            _riderWeight = Mathf.MoveTowards(_riderWeight, target, dt / RiderBlendSeconds);
            // Отпущенный транспорт уходит быстрее, чем снимается поза (LeaveSeconds <
            // RiderBlendSeconds), и может удалить себя раньше: без него сидеть уже не на чем.
            if (!_riding && (_riderWeight <= 0.001f || !vehicleAlive))
            {
                // Седок спешился целиком: транспорт уже уезжает сам, оружие — в руки.
                if (_dismountPending)
                {
                    _dismountPending = false;
                    _vehicle = null;
                    _riderWeight = 0f;
                    _rideYawRate = 0f;
                    _rideHasYaw = false;
                    transform.localRotation = Quaternion.identity;
                    if (_modelRoot != null) _modelRoot.localPosition = _modelRootRest;
                    SetHeldWeaponsStowed(false);
                }
                return false;
            }
            if (!vehicleAlive) return false;

            float yaw = transform.parent != null ? transform.parent.eulerAngles.y : transform.eulerAngles.y;
            float rate = _rideHasYaw && dt > 0.0001f ? Mathf.DeltaAngle(_rideLastYaw, yaw) / dt : 0f;
            _rideLastYaw = yaw;
            _rideHasYaw = true;
            _rideYawRate = Mathf.Lerp(_rideYawRate, Mathf.Clamp(rate, -400f, 400f), 1f - Mathf.Exp(-8f * dt));
            float speed = _riding ? _rideSpeed : 0f;
            float lean = _vehicle.Step(speed, _rideYawRate, dt);

            // Крен — всего узла персонажа: седок и транспорт ложатся в вираж вместе,
            // вокруг линии касания колёс.
            transform.localRotation = Quaternion.Euler(0f, 0f, lean * _riderWeight);
            // Корень скелета каждый кадр с места покоя: посадка в седло — сдвиг от него.
            if (_modelRoot != null) _modelRoot.localPosition = _modelRootRest;

            BeginBoneOffsets();
            if (_vehicle.TryGetAnchors(out RoaVehicleView.Anchors anchors))
                _rider.Apply(anchors, _riderWeight, Mathf.InverseLerp(1f, 11f, Mathf.Abs(speed)), _modelRoot);
            EndBoneOffsets();
            return true;
        }

        private void UpdateGroundShadow()
        {
            if (!_groundingActive || !_groundShadow.Ready) return;
            Vector3 actorPosition = _dead && transform.parent != null
                ? transform.parent.position : transform.position;
            if (_dead && TryGetDeathShadowCenter(out Vector3 corpseCenter))
                actorPosition = Vector3.Lerp(actorPosition, corpseCenter, _deathSettleWeight);
            float groundY;
            Vector3 normal;
            if (_dead)
            {
                groundY = actorPosition.y;
                normal = Vector3.up;
            }
            else
            {
                groundY = actorPosition.y;
                normal = Vector3.up;
            }
            float yaw = _dead && transform.parent != null
                ? transform.parent.eulerAngles.y : transform.eulerAngles.y;
            _groundShadow.UpdatePose(actorPosition, groundY, normal,
                yaw, _dead, _crouching, _deathSettleWeight);
        }

        private bool TryGetDeathShadowCenter(out Vector3 center)
        {
            center = transform.position;
            if (!_bones.TryGetValue("head", out Transform head) || head == null
                || !_bones.TryGetValue("foot_l", out Transform leftFoot) || leftFoot == null
                || !_bones.TryGetValue("foot_r", out Transform rightFoot) || rightFoot == null)
                return false;
            center = (head.position + (leftFoot.position + rightFoot.position) * 0.5f) * 0.5f;
            if (transform.parent != null) center.y = transform.parent.position.y;
            return true;
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

        private void ApplyActivityPresentation(float dt)
        {
            bool actionBlocked = _dead || _locomoting || Turning || _hitReaction.Active
                || Time.time < _attackUntil || Time.time < _hurtUntil
                || string.IsNullOrEmpty(_activityPresentation);
            float targetWeight = actionBlocked ? 0f : 1f;
            float blendSpeed = targetWeight > _activityPresentationWeight ? 3.6f : 8f;
            _activityPresentationWeight = Mathf.MoveTowards(_activityPresentationWeight,
                targetWeight, Mathf.Max(0f, dt) * blendSpeed);
            float weight = _activityPresentationWeight;
            if (weight <= 0.001f) return;

            // A per-actor phase keeps a group from looking like a synchronized
            // animation loop. Only upper-body bones are touched: foot IK and
            // locomotion contacts remain completely independent.
            float t = Time.time + _activityPhaseOffset * 7.13f;
            float slow = Mathf.Sin(t * 0.82f);
            float pulse = Mathf.Sin(t * 2.35f);
            switch (_activityPresentation)
            {
                case "work":
                    float workStroke = 0.5f + 0.5f * pulse;
                    AddBoneOffset("spine_02", (0.025f + workStroke * 0.045f) * weight,
                        slow * 0.018f * weight, 0f);
                    AddBoneOffset("head", -workStroke * 0.025f * weight, 0f,
                        -slow * 0.018f * weight);
                    AddBoneOffset("upperarm_r", -0.08f * weight, 0f,
                        (0.14f + workStroke * 0.10f) * weight);
                    AddBoneOffset("upperarm_l", 0.04f * weight, 0f,
                        (-0.10f - workStroke * 0.06f) * weight);
                    break;
                case "shop":
                    AddBoneOffset("spine_03", -0.025f * weight,
                        slow * 0.035f * weight, 0f);
                    AddBoneOffset("head", 0f, slow * 0.055f * weight,
                        Mathf.Sin(t * 1.18f) * 0.022f * weight);
                    AddBoneOffset("upperarm_r", 0f, 0f,
                        (0.10f + pulse * 0.035f) * weight);
                    break;
                case "guard":
                    AddBoneOffset("spine_03", -0.018f * weight,
                        slow * 0.025f * weight, 0f);
                    AddBoneOffset("head", -0.015f * weight,
                        Mathf.Sin(t * 0.55f) * 0.10f * weight, 0f);
                    break;
                case "social":
                    AddBoneOffset("spine_03", -0.025f * weight,
                        slow * 0.025f * weight, slow * 0.018f * weight);
                    AddBoneOffset("head", -0.02f * weight,
                        Mathf.Sin(t * 1.15f) * 0.055f * weight,
                        pulse * 0.025f * weight);
                    AddBoneOffset("upperarm_r", 0f, 0f,
                        (0.20f + pulse * 0.09f) * weight);
                    AddBoneOffset("upperarm_l", 0f, 0f,
                        (-0.08f - slow * 0.04f) * weight);
                    break;
                case "eat":
                    AddBoneOffset("spine_02", 0.045f * weight, 0f, 0f);
                    AddBoneOffset("head", -0.06f * weight, 0f,
                        pulse * 0.012f * weight);
                    AddBoneOffset("upperarm_r", -0.18f * weight, 0f,
                        (0.24f + pulse * 0.045f) * weight);
                    break;
                case "rest":
                    AddBoneOffset("spine_03", 0.025f * weight,
                        slow * 0.018f * weight, slow * 0.022f * weight);
                    AddBoneOffset("head", 0.025f * weight,
                        slow * 0.025f * weight, -slow * 0.025f * weight);
                    break;
            }
        }

        private void AddBoneOffset(string name, float x, float y, float z)
        {
            if (!_bones.TryGetValue(name, out Transform bone) || bone == null) return;
            if (!_boneOffsets.ContainsKey(bone))
            {
                _boneOffsets[bone] = new BoneOffsetBase
                {
                    Base = bone.localRotation,
                    Written = bone.localRotation
                };
            }
            bone.localRotation = bone.localRotation * Quaternion.Euler(
                x * Mathf.Rad2Deg, y * Mathf.Rad2Deg, z * Mathf.Rad2Deg);
        }

        // Открывает окно процедурных смещений кадра. Кость, которую аниматор в
        // этом кадре не переставил (её поворот равен тому, что записали мы),
        // сначала возвращается к базе — иначе смещение копилось бы каждый кадр.
        private void BeginBoneOffsets()
        {
            for (int i = 0; i < ProceduralOffsetBones.Length; i++)
            {
                if (!_bones.TryGetValue(ProceduralOffsetBones[i], out Transform listed)
                    || listed == null || _boneOffsets.ContainsKey(listed)) continue;
                _boneOffsets[listed] = new BoneOffsetBase
                {
                    Base = listed.localRotation,
                    Written = listed.localRotation
                };
            }
            foreach (KeyValuePair<Transform, BoneOffsetBase> entry in _boneOffsets)
            {
                Transform bone = entry.Key;
                if (bone == null) continue;
                BoneOffsetBase state = entry.Value;
                if (Mathf.Abs(Quaternion.Dot(bone.localRotation, state.Written)) > 0.999999f)
                    bone.localRotation = state.Base;
                state.Base = bone.localRotation;
            }
        }

        // Закрывает окно: запоминаем, что именно записали, чтобы в следующем
        // кадре отличить «аниматор переставил кость» от «кость заморожена».
        private void EndBoneOffsets()
        {
            foreach (KeyValuePair<Transform, BoneOffsetBase> entry in _boneOffsets)
            {
                if (entry.Key == null) continue;
                entry.Value.Written = entry.Key.localRotation;
            }
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
                    if (collider != null)
                    {
                        if (Application.isPlaying) Destroy(collider);
                        else DestroyImmediate(collider);
                    }
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

        /// <summary>
        /// Сектор бокового шага по углу движения от прицела (0° — вперёд), с
        /// гистерезисом, чтобы клип не мигал на границе.
        /// </summary>
        public static bool IsStrafeSector(float absAngleDeg, bool strafing)
        {
            float from = strafing ? StrafeSectorFromDeg - StrafeSectorHysteresisDeg : StrafeSectorFromDeg;
            float to = strafing ? StrafeSectorToDeg + StrafeSectorHysteresisDeg : StrafeSectorToDeg;
            return absAngleDeg > from && absAngleDeg < to;
        }

        /// <summary>
        /// Удар идёт от бёдер: таз доворачивается к удару (джеб — вправо, кросс —
        /// влево) и вес уходит на переднюю ногу, пятка задней проворачивается сама.
        /// </summary>
        private void ApplyPunchDrive()
        {
            if (_upperAttack)
            {
                // На ходу таз ведёт шаг: удар идёт от плеч — грудь доворачивается к удару.
                float upperPhase = DebugPunchPhase;
                if (upperPhase < 0f) return;
                float upperDrive = Mathf.Sin(Mathf.Clamp01(upperPhase / 0.55f) * Mathf.PI);
                float upperYaw = (_attackClip == "attack" ? 0.5f : -0.35f) * PunchHipYawDeg * upperDrive;
                if (_bones.TryGetValue("spine_02", out Transform upperChest) && upperChest != null)
                    upperChest.rotation = Quaternion.AngleAxis(upperYaw, transform.up) * upperChest.rotation;
                return;
            }
            bool jab = _currentClip == "attack", cross = _currentClip == "punch_cross";
            if ((!jab && !cross) || Time.time >= _attackUntil) return;
            if (!_bones.TryGetValue("pelvis", out Transform pelvis) || pelvis == null) return;
            float phase = Mathf.Clamp01(CurrentClipPhase / 0.55f);
            float drive = Mathf.Sin(phase * Mathf.PI);
            float yaw = (jab ? 1f : -1f) * PunchHipYawDeg * drive;
            pelvis.rotation = Quaternion.AngleAxis(yaw, transform.up) * pelvis.rotation;
            pelvis.position += transform.forward * (PunchWeightShift * drive);
            // Грудь не должна докручиваться сверх клипа: позвоночник возвращает половину.
            if (_bones.TryGetValue("spine_02", out Transform chest) && chest != null)
                chest.rotation = Quaternion.AngleAxis(-yaw * 0.5f, transform.up) * chest.rotation;
        }

        private const float PunchHipYawDeg = 13f;
        private const float PunchWeightShift = 0.05f;

        private float ArmedStanceYaw()
        {
            if (_weapon == null || !_weapon.HoldActive) return 0f;
            string kind = _weapon.HoldKind;
            if (kind == "LongGun" || kind == "SawedOff" || kind == "HipGun") return 0.38f;
            if (kind == "Pistol" && _offhandWeapon == null) return 0.17f;
            return 0f;
        }

        private string StrafeClip(int sign, float speed)
        {
            string side = sign > 0 ? "right" : "left";
            // Приставной шаг быстрее обычного бокового: у клипа свои ноги и темп.
            if (speed > StrafeRunSpeed && _clips.Contains("strafe_run_" + side)) return "strafe_run_" + side;
            return "strafe_" + side;
        }

        private static bool IsStrafeClip(string clip)
        {
            return clip == "strafe_left" || clip == "strafe_right"
                || clip == "strafe_run_left" || clip == "strafe_run_right";
        }

        private string SelectClip(bool moving, bool crouching, bool backward, bool fast, float speed)
        {
            if (!moving)
            {
                if (Turning && _clips.Contains("turn")) return "turn";

                // Присед на месте — свой клип (UAL Crouch_Idle_Loop): колени, корпус и
                // руки в нём настоящие. Без клипа — idle плюс процедурная поза приседа.
                if (crouching && _clips.Contains("crouch_idle")) return "crouch_idle";
                return "idle";
            }

            if (crouching)
            {
                // Шаг в приседе (CMU) медленный; быстрее — бег пригнувшись (UAL).
                bool crouchRun = speed > CrouchRunSpeed;
                if (backward && crouchRun && _clips.Contains("crouch_run_back")) return "crouch_run_back";
                if (backward && _clips.Contains("crouch_walk_back")) return "crouch_walk_back";
                if (crouchRun && _clips.Contains("crouch_run")) return "crouch_run";
                if (_clips.Contains("crouch_walk")) return "crouch_walk";
            }

            if (backward)
            {
                // Назад быстро не шагают: выше BackRunSpeed — короткий частый бег спиной.
                if (speed > BackRunSpeed && _clips.Contains("run_back")) return "run_back";
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
            bool authoredBackClip = clip == "walk_back" || clip == "run_back" || clip == "crouch_walk_back"
                || clip == "crouch_run_back"
                || IsStrafeClip(clip);
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
                phase = SyncedLocomotionPhase(previous, clip, previousState.normalizedTime);

            _currentClip = clip;
            AnimationState nextState = _animation[clip];
            if (preservePhase && nextState != null) nextState.normalizedTime = phase;

            // Из стойки после удара руки опускаются не рывком.
            float fade = (previous == "attack" || previous == "punch_cross") && clip == "idle" ? 0.25f
                : previous == "idle" || clip == "idle" ? 0.12f
                : previous == "turn" || clip == "turn" ? 0.10f
                : preservePhase ? 0.18f
                : 0.14f;
            _animation.CrossFade(clip, fade);
        }

        /// <summary>
        /// Перевести фазу между локомоционными клипами по реальному контакту
        /// стоп, а не только по normalizedTime. Run и crouch получены из одной
        /// быстрой основы; walk сдвинут относительно неё примерно на 1/6 цикла.
        /// </summary>
        public static float SyncedLocomotionPhase(string previousClip, string nextClip,
                                                   float previousNormalizedPhase)
        {
            float phase = Mathf.Repeat(previousNormalizedPhase, 1f);
            return Mathf.Repeat(phase + LocomotionPhaseOffset(nextClip)
                - LocomotionPhaseOffset(previousClip), 1f);
        }

        private static float LocomotionPhaseOffset(string clip)
        {
            // Ход назад укорочен и идёт в фазе с шагом назад — без сдвига.
            return clip == "run" || clip == "crouch_run" || clip == "crouch_run_back"
                ? FastGaitPhaseOffset : 0f;
        }

        private static bool IsCyclicLocomotion(string clip)
        {
            return clip == "walk" || clip == "run"
                || clip == "walk_back" || clip == "run_back"
                || clip == "crouch_run" || clip == "crouch_run_back";
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
