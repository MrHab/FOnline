using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Запечённая поза хвата оружия: локальные трансформы 41 кости верха тела
    /// плюс матрица крепления оружия относительно правой кисти.
    ///
    /// Источник — /assets/models/weapons/approved_assault_rifle_grip.glb: там
    /// лежит однокадровая анимация assault_rifle_grip на том же риге и узел
    /// approved_assault_rifle_mount.
    ///
    /// Поза применяется ЗАПИСЬЮ трансформов по имени кости, а не проигрыванием
    /// клипа. Это важно: Legacy-клип привязывается по полному пути, а корень
    /// базовой модели переименован ради клипов локомоции (см. RoaCharacterView).
    /// Запись по имени от путей не зависит — так же поступает и web-клиент.
    ///
    /// Данные общие для всех персонажей, поэтому грузятся один раз.
    /// </summary>
    public static class RoaWeaponGrip
    {
        private const string GripUrl = "/assets/models/weapons/approved_assault_rifle_grip.glb";
        private const string MountNodeName = "approved_assault_rifle_mount";
        private const string PrimaryHandBone = "hand_r";

        /// <summary>
        /// Кости, которые задаёт поза хвата. APPROVED_ASSAULT_RIFLE_GRIP_BONES,
        /// 04d_approved_humanoid_assets_runtime.js:5.
        /// </summary>
        private static readonly string[] GripBones =
        {
            "spine_01", "spine_02", "spine_03",
            "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
            "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
            "index_01_l", "index_02_l", "index_03_l",
            "middle_01_l", "middle_02_l", "middle_03_l",
            "ring_01_l", "ring_02_l", "ring_03_l",
            "pinky_01_l", "pinky_02_l", "pinky_03_l",
            "thumb_01_l", "thumb_02_l", "thumb_03_l",
            "index_01_r", "index_02_r", "index_03_r",
            "middle_01_r", "middle_02_r", "middle_03_r",
            "ring_01_r", "ring_02_r", "ring_03_r",
            "pinky_01_r", "pinky_02_r", "pinky_03_r",
            "thumb_01_r", "thumb_02_r", "thumb_03_r"
        };

        public struct BonePose
        {
            public Quaternion Rotation;
            public Vector3 Position;
            public bool HasPosition;
        }

        /// <summary>Локальные трансформы костей позы, по имени кости.</summary>
        public static Dictionary<string, BonePose> Pose { get; private set; }

        /// <summary>
        /// Крепление оружия относительно правой кисти: hand_r⁻¹ · mount.
        /// Портирует primaryHandToMount, 04d:919.
        /// </summary>
        public static Matrix4x4 HandToMount { get; private set; }

        /// <summary>Ориентация левой кисти на цевье. supportHandQuaternion, 04d:923.</summary>
        public static Quaternion SupportHandRotation { get; private set; }

        /// <summary>
        /// Поправка положения левой кисти относительно сокета цевья:
        /// supportHandPosition − APPROVED_ASSAULT_SUPPORT_SOCKET (04d:925).
        /// </summary>
        public static Vector3 SupportHandOffset { get; private set; }

        /// <summary>APPROVED_ASSAULT_SUPPORT_SOCKET, 04d:85.</summary>
        private static readonly Vector3 SupportSocket = new Vector3(-0.01f, 0.105f, -0.33f);

        private const string SupportHandBone = "hand_l";

        public static bool Ready { get; private set; }

        private static Task _loading;

        public static Task Ensure(string baseUrl)
        {
            if (Ready) return Task.CompletedTask;
            return _loading ?? (_loading = Load(baseUrl));
        }

        private static async Task Load(string baseUrl)
        {
            var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };
            var import = new GltfImport();

            if (!await import.Load(RoaModelUrl.Lite(baseUrl.TrimEnd('/') + GripUrl), settings))
            {
                Debug.LogError("[ROA] Поза хвата не загрузилась: " + GripUrl);
                import.Dispose();
                return;
            }

            // Временный экземпляр: снимаем с него позу и сразу уничтожаем.
            //
            // Объект обязан быть АКТИВНЫМ: AnimationClip.SampleAnimation на
            // выключенном объекте не применяется, и вместо позы хвата снималась бы
            // поза привязки. Признак промаха — HandToMount длиной больше 0.1 м.
            //
            // Чтобы мишень не мелькнула в кадре, отправляем её далеко под сцену:
            // HandToMount считается как hand⁻¹ · mount и от положения корня не зависит.
            var probe = new GameObject("RoaGripProbe");
            probe.transform.position = new Vector3(0f, -10000f, 0f);

            if (!await import.InstantiateMainSceneAsync(probe.transform))
            {
                Debug.LogError("[ROA] Экземпляр позы хвата не создан.");
                Object.Destroy(probe);
                import.Dispose();
                return;
            }

            AnimationClip[] clips = import.GetAnimationClips();
            AnimationClip grip = null;

            if (clips != null)
            {
                foreach (AnimationClip clip in clips)
                {
                    if (clip == null) continue;
                    if (clip.name.ToLowerInvariant() == "assault_rifle_grip") { grip = clip; break; }
                }
            }

            if (grip == null)
            {
                Debug.LogError("[ROA] В GLB нет клипа assault_rifle_grip.");
                Object.Destroy(probe);
                import.Dispose();
                return;
            }

            // Сэмплировать надо на КОРНЕ СЦЕНЫ glTF, а не на своей обёртке.
            // glTFast создаёт промежуточный объект (обычно "Scene"), поэтому
            // относительно обёртки пути клипа становятся "Scene/character_root/..."
            // и не разрешаются: SampleAnimation молча ничего не делает.
            // Признак промаха — кисть не поворачивается совсем.
            GameObject sampleRoot = probe.transform.childCount > 0
                ? probe.transform.GetChild(0).gameObject
                : probe;

            // Клип однокадровый; веб берёт середину — берём её же.
            grip.legacy = true;
            grip.SampleAnimation(sampleRoot, grip.length * 0.5f);

            var pose = new Dictionary<string, BonePose>(GripBones.Length);
            var index = new Dictionary<string, Transform>();

            foreach (Transform t in probe.GetComponentsInChildren<Transform>(true))
                if (!index.ContainsKey(t.name)) index[t.name] = t;

            int missing = 0;
            foreach (string boneName in GripBones)
            {
                Transform bone;
                if (!index.TryGetValue(boneName, out bone)) { missing++; continue; }

                pose[boneName] = new BonePose
                {
                    Rotation = bone.localRotation,
                    Position = bone.localPosition,
                    HasPosition = true
                };
            }

            Transform hand;
            Transform mount;
            Transform supportHand;
            index.TryGetValue(PrimaryHandBone, out hand);
            index.TryGetValue(MountNodeName, out mount);
            index.TryGetValue(SupportHandBone, out supportHand);

            if (hand == null || mount == null || supportHand == null || missing > 0)
            {
                Debug.LogError("[ROA] Поза хвата неполная: нет " + missing + " костей"
                    + (hand == null ? ", нет hand_r" : "")
                    + (supportHand == null ? ", нет hand_l" : "")
                    + (mount == null ? ", нет " + MountNodeName : ""));
                Object.Destroy(probe);
                import.Dispose();
                return;
            }

            Pose = pose;
            HandToMount = hand.worldToLocalMatrix * mount.localToWorldMatrix;

            // Левая кисть на цевье: её поза снимается относительно крепления,
            // а затем из положения вычитается сокет цевья — остаётся поправка,
            // которую можно приложить к сокету любого оружия.
            Matrix4x4 mountToSupport = mount.worldToLocalMatrix * supportHand.localToWorldMatrix;
            SupportHandRotation = mountToSupport.rotation;
            SupportHandOffset = (Vector3)mountToSupport.GetColumn(3) - SupportSocket;

            // Крепление сидит практически в кисти. Заметное смещение означает,
            // что поза не применилась и снялась поза привязки — молча продолжать
            // нельзя, оружие улетит от руки.
            float mountDistance = ((Vector3)HandToMount.GetColumn(3)).magnitude;
            if (mountDistance > 0.25f)
            {
                Debug.LogError("[ROA] Крепление оружия в " + mountDistance.ToString("F3")
                    + " м от кисти — поза хвата не применилась.");
                Object.Destroy(probe);
                import.Dispose();
                return;
            }

            Ready = true;

            Object.Destroy(probe);
            import.Dispose();

            Debug.Log("[ROA] Поза хвата загружена: " + pose.Count + " костей.");
        }

        /// <summary>
        /// Записать оружейную позу рук и пальцев после клипа, сохранив уже
        /// рассчитанные движение, упор и реакцию на попадание позвоночника.
        /// </summary>
        public static void ApplyTo(Dictionary<string, Transform> bones)
        {
            Write(bones, false);
        }

        /// <summary>
        /// Только пальцы. Нужно ближнему бою: там позу рук и корпуса задаёт
        /// стойка оружия, а сжатая кисть берётся из общего хвата
        /// (applyApprovedMeleeFingerPose, 04d:1638).
        /// </summary>
        public static void ApplyFingersTo(Dictionary<string, Transform> bones)
        {
            Write(bones, true);
        }

        private static void Write(Dictionary<string, Transform> bones, bool fingersOnly)
        {
            if (!Ready || bones == null) return;

            foreach (KeyValuePair<string, BonePose> entry in Pose)
            {
                if (fingersOnly && !IsFinger(entry.Key)) continue;
                if (!fingersOnly && IsGripTorsoBone(entry.Key)) continue;

                Transform bone;
                if (!bones.TryGetValue(entry.Key, out bone) || bone == null) continue;

                bone.localRotation = entry.Value.Rotation;
                if (entry.Value.HasPosition) bone.localPosition = entry.Value.Position;
            }
        }

        private static bool IsGripTorsoBone(string boneName)
        {
            return boneName == "spine_01"
                || boneName == "spine_02"
                || boneName == "spine_03";
        }

        /// <summary>Имена вида index_01_l, thumb_03_r и т.д. approvedGripBoneIsFinger(), 04d:1630.</summary>
        private static bool IsFinger(string boneName)
        {
            if (string.IsNullOrEmpty(boneName)) return false;

            return boneName.StartsWith("index_")
                || boneName.StartsWith("middle_")
                || boneName.StartsWith("ring_")
                || boneName.StartsWith("pinky_")
                || boneName.StartsWith("thumb_");
        }

        public static IReadOnlyList<string> BoneNames { get { return GripBones; } }
    }
}
