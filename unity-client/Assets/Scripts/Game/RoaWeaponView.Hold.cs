using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Хват как у живого человека: предмет ставится стойкой своего класса
    /// (RoaHoldStance) относительно груди, а видимые кисти потом ложатся на
    /// места рук, снятые с самой модели (RoaHoldAnchors). Скрытый риг здесь
    /// только даёт грудь и получает кисти для согласованности.
    /// </summary>
    public sealed partial class RoaWeaponView
    {
        // Грудь видимого тела в покое, пространство персонажа: вокруг неё поворачивается стойка.
        private static readonly Vector3 ChestRest = new Vector3(0f, 1.337f, -0.033f);
        // Вскинуть к стрельбе после выстрела и держать так, с.
        private const float RaiseHoldSeconds = 2.4f;
        private const float RaiseUpSeconds = 0.16f;
        private const float RaiseDownSeconds = 0.55f;

        private RoaHold _hold;
        private Transform _visualRoot;
        private Transform _chest;
        // Персонаж (стопы, лицом по +Z): от него считается стойка. Не корень
        // иерархии — превью и сцены кладут персонажа внутрь своих узлов.
        private Transform _frame;
        private Quaternion _chestRestRotation = Quaternion.identity;
        private Vector3 _chestRestPosition;
        private bool _chestRestKnown;
        private float _raise;
        private float _lastAttackAt = -100f;
        private float _throwStartedAt = -1f;
        private const float ThrowSeconds = 0.62f;

        /// <summary>Хват предмета в руках по модели (иначе — старый путь по сокетам GLB).</summary>
        public bool HoldActive => _hold != null && Ready && !Stowed
            && (!DualWield || _hold.Kind == RoaHoldKind.Pistol || _hold.Kind == RoaHoldKind.SawedOff);
        public string HoldKind => _hold != null ? _hold.Kind.ToString() : string.Empty;
        /// <summary>Куда положить видимые кисти в этом кадре.</summary>
        public RoaHandTarget HoldRight { get; private set; }
        public RoaHandTarget HoldLeft { get; private set; }
        /// <summary>Наклон головы к прицелу, градусы.</summary>
        public float HoldHeadPitch { get; private set; }
        public float HoldHeadRoll { get; private set; }
        /// <summary>Насколько оружие вскинуто к стрельбе, 0..1.</summary>
        public float Raise => _raise;
        /// <summary>Фаза удара или броска 0..1 (−1 — нет). Для проб.</summary>
        public float DebugAttackPhase => _hold != null && _hold.Kind == RoaHoldKind.Throwable ? ThrowPhase() : SwingPhase();

        private void BindHold(string weaponId, string rigId, GameObject visual)
        {
            _hold = null;
            _visualRoot = null;
            HoldRight = default;
            HoldLeft = default;
            if (visual == null) return;
            GameObject prefab = RoaApocalypseModels.Weapon(weaponId);
            if (prefab == null) return;
            _hold = RoaHoldStance.Build(prefab.name, rigId, RoaHoldAnchors.Find(prefab.name), _melee == null);
            if (_hold == null) return;
            _visualRoot = visual.transform;
            RoaCharacterView view = _weapon.GetComponentInParent<RoaCharacterView>();
            _frame = view != null ? view.transform : _owner;
            _raise = 0f;
            CaptureChestRest();
        }

        private void CaptureChestRest()
        {
            _chestRestKnown = false;
            _shoulderRestKnown = false;
            _chest = Bone(_bones, "spine_03");
            _shoulder = Bone(_bones, "upperarm_r");
            if (_chest == null || _frame == null) return;
            foreach (SkinnedMeshRenderer skin in _frame.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (skin.sharedMesh == null) continue;
                Transform[] bones = skin.bones;
                Matrix4x4[] bind = skin.sharedMesh.bindposes;
                for (int i = 0; i < bones.Length && i < bind.Length; i++)
                {
                    Matrix4x4 rest = skin.transform.localToWorldMatrix * bind[i].inverse;
                    if (bones[i] == _chest && !_chestRestKnown)
                    {
                        _chestRestRotation = Quaternion.Inverse(_frame.rotation) * rest.rotation;
                        _chestRestPosition = _frame.InverseTransformPoint(rest.GetColumn(3));
                        _chestRestKnown = true;
                    }
                    if (bones[i] == _shoulder && _shoulder != null && !_shoulderRestKnown)
                    {
                        _shoulderRestPosition = _frame.InverseTransformPoint(rest.GetColumn(3));
                        _shoulderRestKnown = true;
                    }
                }
                if (_chestRestKnown) return;
            }
        }

        private Transform _shoulder;
        private Vector3 _shoulderRestPosition;
        private bool _shoulderRestKnown;

        /// <summary>
        /// Сдвиг правого плеча от покоя: приклад и труба лежат в плече, поэтому
        /// огнестрел идёт за наклоном корпуса (стойка клипа клонит плечи вперёд и вниз).
        /// </summary>
        private Vector3 ShoulderTravel()
        {
            if (!_shoulderRestKnown || _shoulder == null || _frame == null) return ChestTravel();
            return _frame.InverseTransformPoint(_shoulder.position) - _shoulderRestPosition;
        }

        private Vector3 StanceTravel() => _hold != null && _hold.Firearm ? ShoulderTravel() : ChestTravel();

        /// <summary>
        /// Поворот стойки вокруг вертикали: только доворот корпуса к цели. Скрутка
        /// клипа (стойка на полушаге, раскачка шага) оружие не уводит в сторону.
        /// </summary>
        private Quaternion ChestYaw()
        {
            return Quaternion.AngleAxis(TorsoResidual * Mathf.Rad2Deg, Vector3.up);
        }

        private Vector3 ChestTravel()
        {
            if (!_chestRestKnown || _chest == null || _frame == null) return Vector3.zero;
            return _frame.InverseTransformPoint(_chest.position) - _chestRestPosition;
        }

        private Vector3 FramePoint(Vector3 point, Quaternion yaw, Vector3 travel) =>
            _frame.TransformPoint(ChestRest + yaw * (point - ChestRest) + travel);

        private Vector3 FrameDirection(Vector3 direction, Quaternion yaw) =>
            _frame.rotation * (yaw * direction);

        private void UpdateRaise()
        {
            bool reloading = ReloadPhase() >= 0f;
            float target = Time.time - _lastAttackAt < RaiseHoldSeconds && !reloading ? 1f : 0f;
            float speed = target > _raise ? 1f / RaiseUpSeconds : 1f / RaiseDownSeconds;
            _raise = Mathf.MoveTowards(_raise, target, speed * Time.deltaTime);
        }

        private float ThrowPhase()
        {
            if (_throwStartedAt < 0f) return -1f;
            float phase = (Time.time - _throwStartedAt) / ThrowSeconds;
            return phase >= 0f && phase < 1f ? phase : -1f;
        }

        /// <summary>Отметить атаку: огнестрел вскидывается, граната — бросок.</summary>
        private void NoteHoldAttack()
        {
            _lastAttackAt = Time.time;
            if (_hold != null && _hold.Kind == RoaHoldKind.Throwable) _throwStartedAt = Time.time;
        }

        /// <summary>Поставить предмет так, чтобы его опорная точка и оси пришли в позу стойки.</summary>
        private void PlaceHold(RoaHoldPose pose, Quaternion yaw, Vector3 travel)
        {
            // Верхняя рука скользит по древку, и предмет ставится по ней: стойка
            // задаёт место кисти, а не точку на древке.
            Vector3 slide = _hold.Right.Axis * RoaHoldStance.TopHandSlide(_hold, SwingPhase());
            PlaceInFrame(_weapon, _visualRoot, _hold, pose, yaw, travel, slide);
        }

        /// <summary>Поставить любой предмет (и оружие второй руки) в позу относительно груди этого персонажа.</summary>
        internal void PlaceInFrame(Transform holder, Transform visual, RoaHold hold, RoaHoldPose pose)
        {
            if (_frame == null) return;
            PlaceInFrame(holder, visual, hold, pose, ChestYaw(), ChestTravel());
        }

        private void PlaceInFrame(Transform holder, Transform visual, RoaHold hold, RoaHoldPose pose, Quaternion yaw, Vector3 travel,
            Vector3 anchorShift = default)
        {
            Vector3 point = FramePoint(pose.Point, yaw, travel);
            Vector3 forward = FrameDirection(pose.Forward, yaw);
            Vector3 up = FrameDirection(pose.Up, yaw);
            Vector3 currentForward = visual.TransformDirection(hold.Forward);
            Vector3 currentUp = visual.TransformDirection(hold.Up);
            if (currentForward.sqrMagnitude < 1e-6f || Vector3.Cross(currentForward, currentUp).sqrMagnitude < 1e-6f) return;
            if (Vector3.Cross(forward, up).sqrMagnitude < 1e-6f) up = _frame.up;
            Quaternion turn = Quaternion.LookRotation(forward, up)
                * Quaternion.Inverse(Quaternion.LookRotation(currentForward, currentUp));
            holder.rotation = turn * holder.rotation;
            holder.position += point - visual.TransformPoint(hold.Anchor + anchorShift);
        }

        /// <summary>Держит ли основная рука пистолет парой (вторая рука ставит свой зеркально).</summary>
        internal bool DualHold => HoldActive && DualWield;

        /// <summary>Поставить предмет по кисти скрытого рига (клип действия, дальний LOD).</summary>
        private void PlaceHoldInHand()
        {
            bool right = _hold.Right.Active;
            RoaHandSpec spec = right ? _hold.Right : _hold.Left;
            RoaHandGrip grip = SourceGrip(!right);
            if (grip == null || !grip.Ready) return;
            grip.HeldFrame(spec.Radius, out Vector3 centre, out Vector3 axis, out Vector3 back);
            Vector3 currentAxis = _visualRoot.TransformDirection(spec.Axis);
            Vector3 currentBack = _visualRoot.TransformDirection(spec.Back);
            if (Vector3.Cross(currentAxis, currentBack).sqrMagnitude < 1e-6f) return;
            Quaternion turn = Quaternion.LookRotation(axis, back)
                * Quaternion.Inverse(Quaternion.LookRotation(currentAxis, currentBack));
            _weapon.rotation = turn * _weapon.rotation;
            _weapon.position += centre - _visualRoot.TransformPoint(spec.Centre);
        }

        private RoaHandGrip _sourceRightGrip;
        private RoaHandGrip _sourceLeftGrip;

        private RoaHandGrip SourceGrip(bool left)
        {
            RoaHandGrip grip = left ? _sourceLeftGrip : _sourceRightGrip;
            if (grip != null) return grip;
            string side = left ? "_l" : "_r";
            Transform hand = Bone(_bones, "hand" + side);
            if (hand == null || _frame == null) return null;
            var bind = new System.Collections.Generic.Dictionary<Transform, Matrix4x4>();
            foreach (SkinnedMeshRenderer skin in _frame.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (skin.sharedMesh == null) continue;
                Transform[] bones = skin.bones;
                Matrix4x4[] poses = skin.sharedMesh.bindposes;
                bool mine = false;
                foreach (Transform bone in bones) if (bone == hand) { mine = true; break; }
                if (!mine) continue;
                for (int i = 0; i < bones.Length && i < poses.Length; i++)
                    if (bones[i] != null && !bind.ContainsKey(bones[i]))
                        bind[bones[i]] = skin.transform.localToWorldMatrix * poses[i].inverse;
                break;
            }
            Transform[] Chain(string name) => new[]
            {
                Bone(_bones, name + "_01" + side), Bone(_bones, name + "_02" + side), Bone(_bones, name + "_03" + side)
            };
            grip = new RoaHandGrip(hand, left, bind, Chain("index"), Chain("middle"), Chain("thumb"));
            if (left) _sourceLeftGrip = grip; else _sourceRightGrip = grip;
            return grip;
        }

        private RoaHandTarget Target(RoaHandSpec spec, RoaFingerPose fingers)
        {
            if (!spec.Active) return default;
            return new RoaHandTarget
            {
                Active = true,
                Centre = _visualRoot.TransformPoint(spec.Centre),
                Axis = _visualRoot.TransformDirection(spec.Axis),
                Back = _visualRoot.TransformDirection(spec.Back),
                Radius = spec.Radius,
                Fingers = fingers
            };
        }

        /// <summary>Места кистей на уже поставленном предмете, с перезарядкой левой руки.</summary>
        private void PublishHands(bool leftFree)
        {
            RoaHandSpec rightSpec = _hold.Right;
            rightSpec.Centre += rightSpec.Axis * RoaHoldStance.TopHandSlide(_hold, SwingPhase());
            RoaHandTarget right = Target(rightSpec, RoaHoldStance.FingersFor(_hold, true, _raise, RecoilWeight > 0.02f));
            if (_hold.Kind == RoaHoldKind.LongGun)
            {
                // Приклад в плече: правый локоть вниз и назад, не выше ~50° от вертикали.
                right.Elbow = FrameDirection(new Vector3(0.2f, -1f, -0.25f), ChestYaw());
                right.HasElbow = true;
            }
            if (_hold.Kind == RoaHoldKind.HipGun)
            {
                // Задняя рукоять у бедра: локоть вниз и назад, прижат к корпусу.
                right.Elbow = FrameDirection(new Vector3(0.05f, -1f, -0.35f), ChestYaw());
                right.HasElbow = true;
            }
            if (_hold.Kind == RoaHoldKind.Launcher)
            {
                // Рукоять трубы у самого плеча: локоть вниз и назад, а не крылом в сторону.
                right.Elbow = FrameDirection(new Vector3(0.12f, -1f, -0.3f), ChestYaw());
                right.HasElbow = true;
            }
            HoldRight = right;
            RoaHandTarget left = leftFree ? default : Target(_hold.Left, RoaHoldStance.FingersFor(_hold, false, _raise));
            float phase = ReloadPhase();
            if (left.Active && phase >= 0f && _hold.Firearm)
            {
                // Перезарядка: левая кисть уходит к магазину (или затвору) и возвращается.
                RoaHoldAnchors.Entry e = _hold.Entry;
                Vector3 local = e.hasMagazine ? e.magazineCentre + Vector3.left * 0.03f : e.trigger + new Vector3(-0.03f, 0.04f, 0.02f);
                float raw = phase < ReloadEdge ? phase / ReloadEdge : (phase > 1f - ReloadEdge ? (1f - phase) / ReloadEdge : 1f);
                float t = Mathf.Clamp01(raw);
                t = t * t * (3f - 2f * t);
                left.Centre = Vector3.Lerp(left.Centre, _visualRoot.TransformPoint(local), t);
                left.Axis = Vector3.Slerp(left.Axis, _visualRoot.TransformDirection(Vector3.down), t).normalized;
                left.Back = Vector3.Slerp(left.Back, _visualRoot.TransformDirection(Vector3.left), t).normalized;
                if (t > 0.5f) left.Fingers = RoaFingerPose.Wrap;
            }
            if (!left.Active && !leftFree && (_hold.Kind == RoaHoldKind.OneHand || _hold.Kind == RoaHoldKind.Knife
                || _hold.Kind == RoaHoldKind.Tonfa) && SwingPhase() >= 0f)
            {
                // Удар одной рукой: свободная рука приподнята для равновесия.
                float swing = SwingPhase();
                float weight = Mathf.Sin(Mathf.Clamp01(swing) * Mathf.PI);
                if (weight > 0.02f)
                    left = new RoaHandTarget
                    {
                        Active = true,
                        Centre = FramePoint(Vector3.Lerp(new Vector3(-0.22f, 0.92f, 0.08f), new Vector3(-0.24f, 1.12f, 0.24f), weight), ChestYaw(), ChestTravel()),
                        Axis = _frame.forward, Back = -_frame.right, Radius = 0.03f,
                        Fingers = RoaFingerPose.Relaxed
                    };
            }
            if (!left.Active && !leftFree && _hold.Kind == RoaHoldKind.Throwable)
            {
                // Бросок: левая рука вытянута к цели для равновесия.
                float weight = RoaHoldStance.ThrowBalance(ThrowPhase(), out Vector3 point);
                if (weight > 0.02f)
                {
                    Vector3 ready = new Vector3(-0.2f, 0.95f, 0.1f);
                    left = new RoaHandTarget
                    {
                        Active = true,
                        Centre = FramePoint(Vector3.Lerp(ready, point, weight), ChestYaw(), ChestTravel()),
                        Axis = _frame.right, Back = _frame.up, Radius = 0.03f,
                        Fingers = RoaFingerPose.Relaxed
                    };
                }
            }
            if (left.Active && (_hold.Kind == RoaHoldKind.Launcher || _hold.Kind == RoaHoldKind.PowerTool))
            {
                // Левая под трубой или на передней дуге: локоть вниз, не крылом в сторону.
                left.Elbow = FrameDirection(new Vector3(0.1f, -1f, 0.1f), ChestYaw());
                left.HasElbow = true;
            }
            HoldLeft = left;
        }

        /// <summary>Аптечка в правой руке и её ручка (кейс висит за ручку отвесно).</summary>
        public Transform MedicalCase => WeaponId == "medkit" ? _weapon : null;
        public Transform MedicalHandle => WeaponId == "medkit" ? _socketGrip : null;

        /// <summary>Хват по модели: стойка, наведение, отдача и места кистей.</summary>
        private void ApplyHold(Vector3 aimPoint, bool hasAim)
        {
            PrimaryHandSolved = false;
            SupportHandSolved = false;
            UpdateRaise();
            bool firearm = _hold.Firearm;
            if (firearm) ApplyFirearmRecoil();
            float swing = _hold.Kind == RoaHoldKind.Throwable ? ThrowPhase() : SwingPhase();
            RoaHoldPose pose = DualWield ? RoaHoldStance.SampleDual(_raise, false) : RoaHoldStance.Sample(_hold, _raise, swing);
            float reload = ReloadPhase();
            if (firearm && reload >= 0f)
            {
                // Перезарядка: оружие опущено и завалено на бок, магазином к левой руке.
                float w = Mathf.Sin(Mathf.Clamp01(reload) * Mathf.PI);
                pose.Forward = Quaternion.AngleAxis(16f * w, Vector3.right) * pose.Forward;
                pose.Up = Quaternion.AngleAxis(-28f * w, pose.Forward) * pose.Up;
                pose.Point += new Vector3(-0.04f, -0.05f, 0.04f) * w;
            }
            if (!firearm) ApplyMeleeSpine(pose.Spine);
            HoldHeadPitch = pose.HeadPitch;
            HoldHeadRoll = pose.HeadRoll;

            Quaternion yaw = ChestYaw();
            Vector3 travel = StanceTravel();
            PlaceHold(pose, yaw, travel);

            if (firearm)
            {
                UpdateObstruction();
                if (hasAim && _socketMuzzle != null && _socketGrip != null)
                {
                    float residual = ConvergeToAim(aimPoint);
                    if (Mathf.Abs(residual) > 0.002f)
                    {
                        float applied = RotateTorsoTowardAim(residual);
                        if (Mathf.Abs(applied) >= 0.0005f)
                        {
                            TorsoResidual = applied;
                            PlaceHold(pose, ChestYaw(), StanceTravel());
                            ConvergeToAim(aimPoint);
                        }
                    }
                }
                ApplyReadyRaise();
                ApplyWeaponKick();
            }

            PublishHands(DualWield);
            SolveSourceHands();
        }

        /// <summary>Скрытые руки тянутся туда же, куда видимые: снаряды и травмы берут их кисти.</summary>
        private void SolveSourceHands()
        {
            RoaHandGrip right = SourceGrip(false), left = SourceGrip(true);
            if (HoldRight.Active && _primaryArm != null && _primaryArm.Ready && right != null && right.Ready)
            {
                Quaternion rotation = right.RotationFor(HoldRight.Axis, HoldRight.Back);
                PrimaryHandSolved = _primaryArm.Solve(right.WristFor(HoldRight, rotation), rotation, ArmPole(false));
            }
            if (HoldLeft.Active && _supportArm != null && _supportArm.Ready && left != null && left.Ready)
            {
                Quaternion rotation = left.RotationFor(HoldLeft.Axis, HoldLeft.Back);
                SupportHandSolved = _supportArm.Solve(left.WristFor(HoldLeft, rotation), rotation, ArmPole(true));
            }
        }
    }
}
