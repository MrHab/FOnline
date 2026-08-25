using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Оружие в руках: монтирование по позе хвата, сведение ствола на курсор
    /// и доворот корпуса по остатку.
    ///
    /// Портирует mountApprovedWeapon(), applyApprovedWeaponAimConvergence()
    /// и rotateApprovedTorsoTowardAim() из 04d_approved_humanoid_assets_runtime.js.
    ///
    /// Порядок важен и повторяет оригинал: сначала оружие ставится в кисть,
    /// затем ствол доворачивается к курсору в пределах ±0.35 рад, остаток
    /// забирает корпус (±1.2 рад на три позвонка), после чего оружие ставится
    /// заново — рука уехала вместе с корпусом, и остаток уже укладывается.
    /// </summary>
    public sealed class RoaWeaponView
    {
        /// <summary>Смещение сокета хвата от узла крепления. APPROVED_ASSAULT_PRIMARY_SOCKET, 04d:84.</summary>
        private static readonly Vector3 PrimarySocketOffset = new Vector3(0.03f, -0.02f, 0.025f);

        /// <summary>Предел выкручивания оружия в кисти, рад. 04d:1228.</summary>
        private const float WeaponAimLimit = 0.35f;

        /// <summary>Предел доворота корпуса, рад. APPROVED_TORSO_AIM_LIMIT, 04d:1255.</summary>
        private const float TorsoAimLimit = 1.2f;

        /// <summary>Ствол короче этого не даёт устойчивого направления, м.</summary>
        private const float MinBarrelLength = 0.05f;

        /// <summary>Ближе этого к стволу курсор не задаёт осмысленного направления, м.</summary>
        private const float MinAimDistance = 0.35f;

        /// <summary>
        /// «Поднятое положение» (high-ready): щуп вдоль ствола на этих расстояниях
        /// от рукояти. 04d:1308.
        /// </summary>
        private static readonly float[] ObstructionProbes = { 0.55f, 0.95f };

        /// <summary>Радиус щупа, м. Совпадает с проверкой движения игрока.</summary>
        private const float ObstructionRadius = 0.18f;

        /// <summary>Насколько ствол поднимается при полном упоре, рад.</summary>
        private const float ReadyRaiseAngle = 1.05f;

        /// <summary>Скорость смешивания подъёма за кадр. 04d:1314.</summary>
        private const float ObstructionBlendStep = 0.16f;

        private static readonly Collider[] ProbeHits = new Collider[8];

        private float _obstructedBlend;

        /// <summary>Насколько ствол поднят из-за препятствия, 0..1. Для диагностики.</summary>
        public float ObstructedBlend { get { return _obstructedBlend; } }

        /// <summary>Позвонки, по которым раскладывается доворот корпуса.</summary>
        private static readonly string[] TorsoBones = { "spine_01", "spine_02", "spine_03" };

        private static readonly Dictionary<string, GltfImport> WeaponCache = new Dictionary<string, GltfImport>();

        /// <summary>
        /// Огнестрел: всё это держится одним и тем же хватом
        /// (APPROVED_FIREARM_GRIP_PROFILES, 04d:21). Ближний бой — knife, axe,
        /// pickaxe, handPump — использует собственные позы и сюда не входит.
        /// </summary>
        private static readonly HashSet<string> Firearms = new HashSet<string>
        {
            "pistol", "revolver", "sawedOffShotgun", "smg", "rifle", "assaultRifle",
            "machineGun", "laserPistol", "flamethrower", "plasmaRifle", "shotgun",
            "rocketLauncher"
        };

        public static bool IsFirearm(string weaponId)
        {
            return !string.IsNullOrEmpty(weaponId) && Firearms.Contains(weaponId);
        }

        /// <summary>
        /// Куда тянется левая рука при перезарядке и как её доворачивать.
        /// APPROVED_FIREARM_GRIP_PROFILES, 04d:20. Узлы ищутся по порядку:
        /// первый найденный и есть цель; если нет ни одного — берётся fallback,
        /// смещение прямо в системе координат оружия.
        /// </summary>
        private sealed class ReloadProfile
        {
            public string[] Nodes;
            public Vector3 Rotation;
            public Vector3 Fallback;
        }

        private static readonly Dictionary<string, ReloadProfile> ReloadProfiles =
            new Dictionary<string, ReloadProfile>
            {
                { "pistol", new ReloadProfile { Nodes = new[] { "breech_cap", "socket_reload" }, Rotation = new Vector3(0.05f, -0.25f, -1.0f), Fallback = new Vector3(0f, -0.13f, 0.015f) } },
                { "rifle", new ReloadProfile { Nodes = new[] { "cartridge_clip", "bolt", "socket_reload" }, Rotation = new Vector3(-0.55f, 0.05f, -0.25f), Fallback = new Vector3(0f, 0.02f, -0.11f) } },
                { "assaultRifle", new ReloadProfile { Nodes = new[] { "magazine", "socket_reload" }, Rotation = new Vector3(0.05f, -0.25f, -0.9f), Fallback = new Vector3(0f, -0.16f, -0.07f) } },
                { "machineGun", new ReloadProfile { Nodes = new[] { "ammo_box", "socket_reload" }, Rotation = new Vector3(-0.15f, -0.35f, -0.55f), Fallback = new Vector3(0.1f, -0.13f, -0.08f) } },
                { "laserPistol", new ReloadProfile { Nodes = new[] { "energy_core", "socket_reload" }, Rotation = new Vector3(0f, -0.4f, -0.85f), Fallback = new Vector3(0f, 0.04f, -0.08f) } },
                { "flamethrower", new ReloadProfile { Nodes = new[] { "fuel_tank", "socket_reload" }, Rotation = new Vector3(-0.3f, -0.15f, -0.65f), Fallback = new Vector3(0f, 0.07f, 0.1f) } },
                { "plasmaRifle", new ReloadProfile { Nodes = new[] { "energy_core", "socket_reload" }, Rotation = new Vector3(-0.2f, -0.5f, -0.55f), Fallback = new Vector3(0f, 0.09f, -0.13f) } },
                { "shotgun", new ReloadProfile { Nodes = new[] { "reload_shell", "socket_reload", "pump" }, Rotation = new Vector3(-0.55f, 0f, -0.35f), Fallback = new Vector3(-0.07f, -0.02f, -0.13f) } },
                { "rocketLauncher", new ReloadProfile { Nodes = new[] { "rocket_round", "socket_reload" }, Rotation = new Vector3(-0.15f, -0.55f, -0.4f), Fallback = new Vector3(0f, 0.08f, 0.22f) } },
                { "revolver", new ReloadProfile { Nodes = new[] { "cylinder", "socket_reload" }, Rotation = new Vector3(0.05f, -0.25f, -1.0f), Fallback = new Vector3(0f, 0.06f, 0.1f) } },
                { "sawedOffShotgun", new ReloadProfile { Nodes = new[] { "reload_shell", "socket_reload" }, Rotation = new Vector3(-0.55f, 0f, -0.35f), Fallback = new Vector3(0.04f, -0.02f, 0.2f) } },
                { "smg", new ReloadProfile { Nodes = new[] { "magazine", "socket_reload" }, Rotation = new Vector3(0.05f, -0.25f, -0.9f), Fallback = new Vector3(0f, 0.1f, -0.15f) } }
            };

        /// <summary>Длительность перезарядки по умолчанию, с. 04d:1507.</summary>
        private const float DefaultReloadSeconds = 0.82f;

        /// <summary>Доля фазы на разгон и на возврат руки. 04d:1527.</summary>
        private const float ReloadEdge = 0.22f;

        private float _reloadStartedAt = -1f;
        private float _reloadDuration = DefaultReloadSeconds;
        private ReloadProfile _reloadProfile;
        private Transform _reloadNode;

        /// <summary>Идёт ли перезарядка. Для диагностики.</summary>
        public bool Reloading { get { return ReloadPhase() >= 0f; } }

        /// <summary>
        /// Запустить визуал перезарядки. Момент и длительность задаёт сервер:
        /// у себя — ack на reloadWeapon, у чужих — событие playerReloaded.
        /// </summary>
        public void StartReload(float durationSeconds)
        {
            _reloadDuration = Mathf.Max(0.5f, durationSeconds > 0f ? durationSeconds : DefaultReloadSeconds);
            _reloadStartedAt = Time.time;
        }

        /// <summary>Фаза перезарядки 0..1, либо −1 если она не идёт.</summary>
        private float ReloadPhase()
        {
            if (_reloadStartedAt < 0f) return -1f;

            float phase = (Time.time - _reloadStartedAt) / _reloadDuration;
            if (phase < 0f || phase >= 1f) return -1f;

            return phase;
        }

        /// <summary>Id оружия, которое сейчас в руках. Пусто — руки свободны.</summary>
        public string WeaponId { get; private set; }

        /// <summary>
        /// Высота рукояти в мире. По ней берётся точка прицела: если брать курсор
        /// с земли, а ствол держать на высоте груди, между ними у наклонной камеры
        /// набегает около метра, и доворот доходит до 48° — оружие выкручивается
        /// из кисти. На высоте ствола остаётся смещение в единицы градусов (04d:1222).
        /// </summary>
        public float GripHeight
        {
            get { return _socketGrip != null ? _socketGrip.position.y : 0f; }
        }

        public bool TryGetMuzzle(out Vector3 worldPosition)
        {
            if (_socketMuzzle != null)
            {
                worldPosition = _socketMuzzle.position;
                return true;
            }
            worldPosition = Vector3.zero;
            return false;
        }
        private Transform _weapon;
        private Transform _socketGrip;
        private Transform _socketMuzzle;
        private Transform _hand;

        /// <summary>Корень персонажа — по нему щуп отличает свои коллайдеры от чужих.</summary>
        private Transform _owner;

        private Transform _socketGripLeft;
        private RoaIkChain _supportArm;
        private RoaIkChain _primaryArm;

        private RoaMeleeGrip.Profile _melee;
        private readonly Transform[] _spine = new Transform[RoaMeleeGrip.SpineBones.Length];
        private float _swingStartedAt = -1f;

        /// <summary>Оружие ближнего боя в руках.</summary>
        public bool IsMeleeEquipped { get { return _melee != null; } }

        /// <summary>Левая рука дотянулась до цевья. Для диагностики.</summary>
        public bool SupportHandSolved { get; private set; }

        private Dictionary<string, Transform> _bones;
        private readonly Transform[] _torso = new Transform[TorsoBones.Length];

        public bool Ready { get; private set; }
        private int _loadRequest;

        /// <summary>Остаток доворота, который забрал корпус, рад. Для диагностики.</summary>
        public float TorsoResidual { get; private set; }

        /// <summary>Насколько ствол довернули в кисти, рад. Для диагностики.</summary>
        public float WeaponConverge { get; private set; }

        /// <summary>Убрать оружие из рук: руки возвращаются к клипу локомоции.</summary>
        public void Unequip()
        {
            _loadRequest++;
            ClearWeapon();
        }

        private void ClearWeapon()
        {
            if (_weapon != null) Object.Destroy(_weapon.gameObject);

            _weapon = null;
            _socketGrip = null;
            _socketMuzzle = null;
            WeaponId = string.Empty;
            Ready = false;
            TorsoResidual = 0f;
            WeaponConverge = 0f;
            _obstructedBlend = 0f;
            _reloadStartedAt = -1f;
            _reloadProfile = null;
            _reloadNode = null;
            _socketGripLeft = null;
            _supportArm = null;
            _primaryArm = null;
            _melee = null;
            _swingStartedAt = -1f;
        }

        public async Task Load(string baseUrl, string weaponId, Transform characterRoot,
                               Dictionary<string, Transform> bones)
        {
            if (WeaponId == weaponId && Ready) return;

            int request = ++_loadRequest;
            ClearWeapon();
            _bones = bones;
            _owner = characterRoot != null ? characterRoot.root : null;

            _melee = RoaMeleeGrip.Get(weaponId);

            if (!IsFirearm(weaponId) && _melee == null)
            {
                // Кулаки и всё, для чего нет профиля: руки остаются свободными.
                return;
            }

            if (!bones.TryGetValue("hand_r", out _hand) || _hand == null)
            {
                Debug.LogWarning("[ROA] Нет кости hand_r — оружие не подключено.");
                return;
            }

            for (int i = 0; i < TorsoBones.Length; i++)
            {
                Transform bone;
                bones.TryGetValue(TorsoBones[i], out bone);
                _torso[i] = bone;
            }

            await RoaWeaponGrip.Ensure(baseUrl);
            if (request != _loadRequest || !RoaWeaponGrip.Ready) return;

            string url = baseUrl.TrimEnd('/') + "/assets/models/weapons/weapon_" + weaponId + ".glb";
            GltfImport import = await LoadCached(weaponId, url);
            if (request != _loadRequest) return;
            if (import == null)
            {
                Debug.LogError("[ROA] Модель оружия не загрузилась: " + url);

                // Иначе каждый серверный снимок будет пробовать снова.
                WeaponId = weaponId;
                return;
            }

            var holder = new GameObject("Weapon:" + weaponId);
            holder.transform.SetParent(characterRoot, false);

            if (!await import.InstantiateMainSceneAsync(holder.transform))
            {
                Debug.LogError("[ROA] Экземпляр оружия не создан: " + weaponId);
                Object.Destroy(holder);
                return;
            }
            if (request != _loadRequest || characterRoot == null)
            {
                Object.Destroy(holder);
                return;
            }

            _weapon = holder.transform;
            _socketGrip = FindDeep(_weapon, "socket_grip_r");
            _socketMuzzle = FindDeep(_weapon, "socket_muzzle");
            _socketGripLeft = FindDeep(_weapon, "socket_grip_l");

            // Узел перезарядки: первый найденный из профиля.
            ReloadProfiles.TryGetValue(weaponId, out _reloadProfile);
            _reloadNode = null;
            if (_reloadProfile != null)
            {
                foreach (string node in _reloadProfile.Nodes)
                {
                    _reloadNode = FindDeep(_weapon, node);
                    if (_reloadNode != null) break;
                }
            }

            // Цепи рук: 12 итераций, как в оригинале (04d:1172).
            _supportArm = new RoaIkChain(new[]
            {
                Bone(bones, "clavicle_l"),
                Bone(bones, "upperarm_l"),
                Bone(bones, "lowerarm_l"),
                Bone(bones, "hand_l")
            }, 12, 0.001f);

            // Правая рука нужна только ближнему бою: там оружие занимает позицию
            // стойки, и уже к нему подтягивается кисть. У огнестрела наоборот —
            // оружие ставится в кисть, доворачивать её незачем.
            _primaryArm = new RoaIkChain(new[]
            {
                Bone(bones, "clavicle_r"),
                Bone(bones, "upperarm_r"),
                Bone(bones, "lowerarm_r"),
                Bone(bones, "hand_r")
            }, 12, 0.001f);

            for (int i = 0; i < RoaMeleeGrip.SpineBones.Length; i++)
                _spine[i] = Bone(bones, RoaMeleeGrip.SpineBones[i]);

            // Дуло есть только у огнестрела: у ножа и топора ствола не существует,
            // и требовать socket_muzzle от них — ошибка.
            bool needsMuzzle = _melee == null;

            if (_socketGrip == null || (needsMuzzle && _socketMuzzle == null))
            {
                Debug.LogError("[ROA] У оружия " + weaponId + " нет "
                    + (_socketGrip == null ? "socket_grip_r" : "socket_muzzle") + ".");

                // Помечаем как обработанное, иначе смена оружия будет пытаться
                // загрузить его заново каждый серверный снимок.
                WeaponId = weaponId;
                Object.Destroy(holder);
                return;
            }

            WeaponId = weaponId;
            Ready = true;
            Debug.Log("[ROA] Оружие " + weaponId + " подключено.");
        }

        private static async Task<GltfImport> LoadCached(string key, string url)
        {
            GltfImport cached;
            if (WeaponCache.TryGetValue(key, out cached)) return cached;

            var import = new GltfImport();
            if (!await import.Load(RoaModelUrl.Lite(url)))
            {
                import.Dispose();
                return null;
            }

            WeaponCache[key] = import;
            return import;
        }

        private static Transform Bone(Dictionary<string, Transform> bones, string name)
        {
            Transform bone;
            return bones.TryGetValue(name, out bone) ? bone : null;
        }

        private Vector3 ArmPole(bool left)
        {
            Transform upper = Bone(_bones, left ? "upperarm_l" : "upperarm_r");
            Vector3 origin = upper != null ? upper.position : (_owner != null ? _owner.position : Vector3.zero);
            Vector3 right = _owner != null ? _owner.right : Vector3.right;
            Vector3 forward = _owner != null ? _owner.forward : Vector3.forward;
            return origin + right * (left ? -0.48f : 0.48f) - forward * 0.18f + Vector3.down * 0.22f;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name) return root;

            for (int i = 0; i < root.childCount; i++)
            {
                Transform found = FindDeep(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        /// <summary>
        /// Обновить хват, оружие и доворот корпуса.
        /// Вызывать в LateUpdate после процедурной позы: та задаёт положение таза
        /// и позвоночника, от которых считается кисть.
        /// </summary>
        /// <param name="aimPoint">Точка прицеливания в мире (курсор на земле).</param>
        public void Apply(Vector3 aimPoint, bool hasAim)
        {
            if (!Ready) return;

            TorsoResidual = 0f;
            WeaponConverge = 0f;

            // Ближний бой идёт своим путём: у него три стойки, оружие
            // размещается ДО руки, а из общего хвата берутся только пальцы —
            // позу рук и корпуса задаёт стойка.
            if (_melee != null)
            {
                RoaWeaponGrip.ApplyFingersTo(_bones);
                ApplyMelee();
                return;
            }

            // 1. Поза хвата поверх клипа локомоции: руки, кисти и пальцы.
            RoaWeaponGrip.ApplyTo(_bones);

            // 2. Оружие в кисть.
            Mount();

            // 3. Упор впереди — ствол уходит вверх, а доворот к курсору гасится:
            // иначе оружие «летает», пытаясь навестись сквозь препятствие.
            UpdateObstruction();

            if (!hasAim)
            {
                Finish();
                return;
            }

            // 4. Ствол доворачивается к курсору в пределах своего лимита.
            float residual = ConvergeToAim(aimPoint);

            if (Mathf.Abs(residual) <= 0.002f)
            {
                Finish();
                return;
            }

            // 5. Остаток забирает корпус, после чего оружие ставится заново:
            // рука уехала вместе с корпусом.
            float appliedTorso = RotateTorsoTowardAim(residual);
            if (Mathf.Abs(appliedTorso) < 0.0005f)
            {
                Finish();
                return;
            }

            // Публикуем ПРИМЕНЁННЫЙ доворот, а не запрошенный: запрошенный может
            // превышать предел 1.2 рад, и тогда цифра врала бы о позе.
            TorsoResidual = appliedTorso;
            Mount();
            ConvergeToAim(aimPoint);

            // Подъём — последним: он считается от уже наведённого ствола.
            Finish();
        }

        /// <summary>
        /// Проверить, упирается ли ствол в геометрию. Щуп идёт вдоль ствола
        /// прошлого кадра. Портирует updateApprovedWeaponObstruction(), 04d:1286.
        /// </summary>
        private void UpdateObstruction()
        {
            float target = 0f;

            Vector3 grip = _socketGrip.position;
            Vector3 barrel = _socketMuzzle.position - grip;
            barrel.y = 0f;

            if (barrel.magnitude > MinBarrelLength)
            {
                Vector3 dir = barrel.normalized;

                foreach (float distance in ObstructionProbes)
                {
                    if (!ProbeBlocked(grip + dir * distance)) continue;
                    target = 1f;
                    break;
                }
            }

            _obstructedBlend += (target - _obstructedBlend) * ObstructionBlendStep;
            if (_obstructedBlend < 0.005f) _obstructedBlend = 0f;
        }

        /// <summary>
        /// Есть ли что-то в точке щупа. Собственные коллайдеры персонажа
        /// не считаются: рукоять у самой груди, и щуп неизбежно задевал бы их.
        /// </summary>
        private bool ProbeBlocked(Vector3 point)
        {
            int count = Physics.OverlapSphereNonAlloc(point, ObstructionRadius, ProbeHits,
                Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);

            for (int i = 0; i < count; i++)
            {
                Collider hit = ProbeHits[i];
                if (hit == null) continue;
                if (_weapon != null && hit.transform.IsChildOf(_weapon)) continue;
                if (_owner != null && hit.transform.IsChildOf(_owner)) continue;

                return true;
            }

            return false;
        }

        /// <summary>Начать замах: три стойки проигрываются по фазе.</summary>
        public void StartSwing(float durationSeconds)
        {
            _swingStartedAt = Time.time;
            _swingDuration = Mathf.Max(0.18f,
                durationSeconds > 0f ? durationSeconds : RoaMeleeGrip.DefaultSwingSeconds);
        }

        private float _swingDuration = RoaMeleeGrip.DefaultSwingSeconds;

        /// <summary>Фаза замаха 0..1, либо −1 если удара нет.</summary>
        private float SwingPhase()
        {
            if (_swingStartedAt < 0f) return -1f;

            float phase = (Time.time - _swingStartedAt) / _swingDuration;
            return phase >= 0f && phase < 1f ? phase : -1f;
        }

        /// <summary>
        /// Ближний бой. Порядок обратный огнестрелу: оружие занимает позицию
        /// стойки в системе координат персонажа, и уже к его рукояти
        /// подтягивается кисть. applyApprovedMeleeGrip(), 04d:1722.
        /// </summary>
        private void ApplyMelee()
        {
            Vector3 primary;
            Vector3 direction;
            Vector3 spine;
            RoaMeleeGrip.Sample(_melee, SwingPhase(), out primary, out direction, out spine);

            ApplyMeleeSpine(spine);

            Transform parent = _weapon.parent;
            if (parent == null) return;

            // Направление оружия в его собственных координатах: у двуручного —
            // от рукояти к цевью, у одноручного — заданная ось.
            Matrix4x4 primaryLocal = _weapon.worldToLocalMatrix * _socketGrip.localToWorldMatrix;
            Vector3 source = _melee.SourceAxis;

            if (_melee.TwoHanded && _socketGripLeft != null)
            {
                Matrix4x4 supportLocal = _weapon.worldToLocalMatrix * _socketGripLeft.localToWorldMatrix;
                source = (Vector3)supportLocal.GetColumn(3) - (Vector3)primaryLocal.GetColumn(3);
            }

            if (source.sqrMagnitude < 1e-6f) return;

            Quaternion rotation = Quaternion.FromToRotation(source.normalized, direction);

            // Крен вокруг оси оружия. Знак обратный авторскому: при зеркалении Z
            // направление вращения меняется.
            if (Mathf.Abs(_melee.Roll) > 0.0001f)
                rotation = Quaternion.AngleAxis(-_melee.Roll * Mathf.Rad2Deg, direction) * rotation;

            Vector3 offset = rotation * (Vector3)primaryLocal.GetColumn(3);

            _weapon.localPosition = primary - offset;
            _weapon.localRotation = rotation;

            // Кисть подтягивается к рукояти уже размещённого оружия.
            if (_primaryArm != null && _primaryArm.Ready)
            {
                Matrix4x4 handToSocket = RoaWeaponGrip.HandToMount * Matrix4x4.Translate(PrimarySocketOffset);
                Matrix4x4 handWorld = _socketGrip.localToWorldMatrix * handToSocket.inverse;
                _primaryArm.Solve(handWorld.GetColumn(3), handWorld.rotation, ArmPole(false));
            }

            if (!_melee.TwoHanded || _socketGripLeft == null) return;

            if (_supportArm != null && _supportArm.Ready)
            {
                Matrix4x4 socketLocal = _weapon.worldToLocalMatrix * _socketGripLeft.localToWorldMatrix;
                Vector3 position = (Vector3)socketLocal.GetColumn(3) + RoaWeaponGrip.SupportHandOffset;

                Quaternion rot = RoaWeaponGrip.SupportHandRotation * Quaternion.Euler(
                    _melee.SupportRotation.x * Mathf.Rad2Deg,
                    _melee.SupportRotation.y * Mathf.Rad2Deg,
                    _melee.SupportRotation.z * Mathf.Rad2Deg);

                Matrix4x4 handWorld = _weapon.localToWorldMatrix * Matrix4x4.TRS(position, rot, Vector3.one);
                _supportArm.Solve(handWorld.GetColumn(3), handWorld.rotation, ArmPole(true));
            }
        }

        /// <summary>
        /// Доворот позвоночника в стойке ближнего боя. Веса растут снизу вверх,
        /// поэтому корпус изгибается дугой. applyApprovedMeleeSpinePose(), 04d:1615.
        /// </summary>
        private void ApplyMeleeSpine(Vector3 rotation)
        {
            if (rotation.sqrMagnitude < 1e-8f) return;

            for (int i = 0; i < _spine.Length; i++)
            {
                if (_spine[i] == null) continue;

                float weight = RoaMeleeGrip.SpineWeights[i];
                _spine[i].localRotation = _spine[i].localRotation * Quaternion.Euler(
                    rotation.x * weight * Mathf.Rad2Deg,
                    rotation.y * weight * Mathf.Rad2Deg,
                    rotation.z * weight * Mathf.Rad2Deg);
            }
        }

        /// <summary>
        /// Завершение кадра: сначала подъём ствола, затем левая рука — она
        /// тянется к уже окончательному положению цевья.
        /// </summary>
        private void Finish()
        {
            ApplyReadyRaise();
            SolveSupportHand();
        }

        /// <summary>
        /// Поставить левую кисть на цевье. Цель берётся от сокета socket_grip_l
        /// самого оружия плюс поправка из позы хвата, поэтому рука садится
        /// правильно на любую модель, а не только на автомат.
        /// approvedWeaponSupportTarget() + solveApprovedSupportArm(), 04d:1512, 1218.
        /// </summary>
        private void SolveSupportHand()
        {
            SupportHandSolved = false;

            if (_supportArm == null || !_supportArm.Ready || _socketGripLeft == null) return;

            // Поза сокета цевья внутри оружия.
            Matrix4x4 socketLocal = _weapon.worldToLocalMatrix * _socketGripLeft.localToWorldMatrix;
            Vector3 gripPosition = (Vector3)socketLocal.GetColumn(3) + RoaWeaponGrip.SupportHandOffset;
            Quaternion gripRotation = RoaWeaponGrip.SupportHandRotation;

            Vector3 localPosition = gripPosition;
            Quaternion localRotation = gripRotation;

            // Перезарядка: рука уходит к магазину и возвращается. Края фазы
            // сглажены, поэтому переход не выглядит рывком.
            float phase = ReloadPhase();
            if (phase >= 0f && _reloadProfile != null)
            {
                Vector3 reloadPosition;
                if (_reloadNode != null)
                {
                    Matrix4x4 nodeLocal = _weapon.worldToLocalMatrix * _reloadNode.localToWorldMatrix;
                    reloadPosition = nodeLocal.GetColumn(3);
                }
                else
                {
                    reloadPosition = _reloadProfile.Fallback;
                }

                Quaternion reloadRotation = gripRotation * Quaternion.Euler(
                    _reloadProfile.Rotation.x * Mathf.Rad2Deg,
                    _reloadProfile.Rotation.y * Mathf.Rad2Deg,
                    _reloadProfile.Rotation.z * Mathf.Rad2Deg);

                float raw = phase < ReloadEdge
                    ? phase / ReloadEdge
                    : (phase > 1f - ReloadEdge ? (1f - phase) / ReloadEdge : 1f);

                float blend = Mathf.Clamp01(raw);
                float eased = blend * blend * (3f - 2f * blend);

                localPosition = Vector3.Lerp(gripPosition, reloadPosition, eased);
                localRotation = Quaternion.Slerp(gripRotation, reloadRotation, eased);
            }

            Matrix4x4 handLocal = Matrix4x4.TRS(localPosition, localRotation, Vector3.one);
            Matrix4x4 handWorld = _weapon.localToWorldMatrix * handLocal;

            SupportHandSolved = _supportArm.Solve(handWorld.GetColumn(3), handWorld.rotation, ArmPole(true));
        }

        /// <summary>
        /// Поднять ствол вокруг рукояти: дуло уходит вверх, рукоять остаётся
        /// в кисти. applyApprovedWeaponReadyRaise(), 04d:1322.
        /// </summary>
        private void ApplyReadyRaise()
        {
            if (_obstructedBlend <= 0.01f) return;

            Vector3 pivot = _socketGrip.position;
            Vector3 barrel = _socketMuzzle.position - pivot;
            barrel.y = 0f;
            if (barrel.sqrMagnitude < 0.002f) return;

            // Ось «вправо» относительно ствола: поворот вокруг неё задирает дуло.
            Vector3 axis = Vector3.Cross(barrel.normalized, Vector3.up).normalized;
            _weapon.RotateAround(pivot, axis, _obstructedBlend * ReadyRaiseAngle * Mathf.Rad2Deg);
        }

        /// <summary>Поставить оружие так, чтобы его сокет хвата пришёл в кисть. 04d:1414.</summary>
        private void Mount()
        {
            Matrix4x4 mountWorld = _hand.localToWorldMatrix * RoaWeaponGrip.HandToMount;
            Matrix4x4 targetWorld = mountWorld * Matrix4x4.Translate(PrimarySocketOffset);

            // Поза сокета внутри самого оружия — её и надо «вычесть».
            Matrix4x4 socketLocal = _weapon.worldToLocalMatrix * _socketGrip.localToWorldMatrix;
            Matrix4x4 socketLocalRigid = Matrix4x4.TRS(
                socketLocal.GetColumn(3),
                socketLocal.rotation,
                Vector3.one);

            Matrix4x4 weaponWorld = targetWorld * socketLocalRigid.inverse;

            _weapon.SetPositionAndRotation(weaponWorld.GetColumn(3), weaponWorld.rotation);
        }

        /// <summary>
        /// Довернуть оружие вокруг сокета хвата так, чтобы ствол смотрел в курсор.
        /// Возвращает остаток, который не влез в предел. 04d:1348.
        /// </summary>
        private float ConvergeToAim(Vector3 aim)
        {
            Vector3 pivot = _socketGrip.position;
            Vector3 tip = _socketMuzzle.position;

            float barrelX = tip.x - pivot.x;
            float barrelZ = tip.z - pivot.z;
            if (new Vector2(barrelX, barrelZ).magnitude < MinBarrelLength) return 0f;

            float aimX = aim.x - pivot.x;
            float aimZ = aim.z - pivot.z;
            if (new Vector2(aimX, aimZ).magnitude < MinAimDistance) return 0f;

            float delta = Mathf.Atan2(aimX, aimZ) - Mathf.Atan2(barrelX, barrelZ);
            delta = Mathf.Atan2(Mathf.Sin(delta), Mathf.Cos(delta));

            float requested = delta;
            delta = Mathf.Clamp(delta, -WeaponAimLimit, WeaponAimLimit);

            // У препятствия ствол поднят — доворот к курсору гасим, иначе оружие
            // «летает» в попытке навестись сквозь упор. 04d:1377.
            delta *= 1f - Mathf.Clamp01(_obstructedBlend);

            // Остаток, который оружию не отдали, забирает корпус: ствол обязан
            // прийти в курсор, а выкручивать его в кисти дальше предела нельзя.
            float residual = requested - delta;
            WeaponConverge = delta;

            if (Mathf.Abs(delta) >= 0.0005f)
                _weapon.RotateAround(pivot, Vector3.up, delta * Mathf.Rad2Deg);

            return residual;
        }

        /// <summary>
        /// Разложить доворот по трём позвонкам, чтобы корпус разворачивался плавной
        /// дугой, а не одним шарниром. rotateApprovedTorsoTowardAim(), 04d:1257.
        /// </summary>
        /// <returns>Фактически применённый доворот, рад.</returns>
        private float RotateTorsoTowardAim(float angle)
        {
            float total = Mathf.Clamp(angle, -TorsoAimLimit, TorsoAimLimit);
            float share = total / TorsoBones.Length;
            if (Mathf.Abs(share) < 0.0005f) return 0f;

            Quaternion yaw = Quaternion.AngleAxis(share * Mathf.Rad2Deg, Vector3.up);

            int applied = 0;
            for (int i = 0; i < _torso.Length; i++)
            {
                if (_torso[i] == null) continue;

                // Мировой доворот: Transform сам пересчитает локальную ротацию.
                _torso[i].rotation = yaw * _torso[i].rotation;
                applied++;
            }

            return share * applied;
        }
    }
}
