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
                { "walk_back", 1.20f },
                { "run_back", 3.41f },
                { "crouch_walk", 2.11f },
                { "crouch_walk_back", 2.23f }
            };

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

        private Animation _animation;
        private readonly HashSet<string> _clips = new HashSet<string>();
        private string _currentClip = string.Empty;
        private bool _backward;

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
        private int _equipmentRequest;
        private int _loadRequest;
        private string _bodyKey = "male_medium";
        private JObject _appearance;
        private Transform _head;
        private Vector3 _headBaseScale = Vector3.one;
        private Vector3 _headScaleFactors = Vector3.one;
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
        private string _activityPresentation = string.Empty;
        private float _activityPhaseOffset;
        private float _activityPresentationWeight;
        private Vector2 _lastImpactLocalSource = Vector2.up;
        private float _lastImpactAt = -100f;
        private bool _hasLastImpactDirection;
        private float _deathYawOffsetDeg;

        /// <summary>Длительность вспышки удара по умолчанию, с.</summary>
        private const float AttackSeconds = 0.45f;
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

        /// <summary>Оружие подключено и смонтировано.</summary>
        public bool WeaponReady { get { return _weapon != null && _weapon.Ready; } }
        public bool OffhandWeaponReady { get { return _offhandWeapon != null && _offhandWeapon.Ready; } }
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

            // Во время движения ноги продолжают текущий gait; направленный
            // процедурный слой даёт реакцию без полнотелого скольжения hurt-клипа.
            bool fullBody = !_hitReaction.Ready || _presentationTier != RoaActorPresentationTier.Near
                || !_locomoting;
            if (!fullBody || !_clips.Contains("hurt"))
            {
                _hurtUntil = 0f;
                return;
            }
            _hurtUntil = Time.time + 0.36f;
            _currentClip = "hurt";
            _animation[_currentClip].wrapMode = WrapMode.Once;
            _animation[_currentClip].time = 0f;
            _animation[_currentClip].speed = 1f;
            _animation.CrossFade("hurt", 0.06f);
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
            float correction = Mathf.Clamp(groundY + targetClearance - surfaceMinY,
                -DeathMaximumGroundCorrectionMeters, DeathMaximumGroundCorrectionMeters);
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
            string relativeUrl = "/assets/models/characters/base/character_" + key + ".glb";
            string url = baseUrl.TrimEnd('/') + relativeUrl;
            Ready = false;
            UsesProjectPrefab = false;
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
            // верха.
            _pose.Bind(transform);

            _modelRoot = FindDeep(transform, LibraryRootName) ?? FindDeep(transform, BaseRootName);
            _groundShadow.Bind(transform);
            _groundShadow.SetActive(_groundingActive);

            // Индекс костей по имени: по нему работают поза хвата и доворот корпуса.
            foreach (Transform bone in GetComponentsInChildren<Transform>(true))
                if (!_bones.ContainsKey(bone.name)) _bones[bone.name] = bone;
            _hitReaction.Bind(_modelRoot != null ? _modelRoot : transform);

            PrepareAppearance();
            ApplyAppearanceVisuals(false);

            _animation.wrapMode = WrapMode.Loop;
            Play("idle");
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

            // Ближний LOD сохраняет gait даже если игрок начал двигаться уже
            // после попадания. На дальнем LOD остаётся дешёвый полнотелый клип.
            if (locomoting && _presentationTier == RoaActorPresentationTier.Near)
                _hurtUntil = 0f;
            bool hurt = Time.time < _hurtUntil && _clips.Contains("hurt");
            bool attacking = Time.time < _attackUntil;
            CombatPresentationPhase phase = ResolveCombatPresentationPhase(
                false, hurt, attacking, locomoting);
            if (phase == CombatPresentationPhase.Idle
                || phase == CombatPresentationPhase.Locomotion)
            {
                Play(clip);
                ApplyTimeScale(clip, actuallyMoving, speed, sideAmount, dt);
            }
            else if (phase == CombatPresentationPhase.Reaction)
            {
                clip = "hurt";
            }
            else
            {
                clip = "attack";
            }

            _crouching = crouching;

            _pose.Step(locomoting, Turning, clip, lowerBodyYaw,
                sideAmount, forwardAmount, _turnAmount, crouching, false, dt,
                contactWeight, contactForward, contactSide);
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
            if (_weapon != null) _weapon.Apply(_aimPoint, _hasAim);
            if (_offhandWeapon != null) _offhandWeapon.Apply(_aimPoint, _hasAim);

            // Травма — самый верхний визуальный слой. Перелом руки намеренно
            // ослабляет идеальный IK-хват, а перелом ноги остаётся видим поверх
            // авторской анимации ног (foot IK удалён: стопы следуют клипу).
            ApplyInjuryPose();
            EndBoneOffsets();
            UpdateGroundShadow();
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
                phase = SyncedLocomotionPhase(previous, clip, previousState.normalizedTime);

            _currentClip = clip;
            AnimationState nextState = _animation[clip];
            if (preservePhase && nextState != null) nextState.normalizedTime = phase;

            float fade = previous == "idle" || clip == "idle" ? 0.12f
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
            return clip == "run" || clip == "run_back"
                || clip == "crouch_walk" || clip == "crouch_walk_back"
                ? FastGaitPhaseOffset : 0f;
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
