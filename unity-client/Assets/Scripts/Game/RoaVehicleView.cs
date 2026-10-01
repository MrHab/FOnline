using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Транспорт под седоком: вращение колёс по пройденному пути, руль по
    /// скорости поворота и наклон в вираже (у двухколёсных).
    ///
    /// Модели два вида. Мотоцикл — GLB из /assets/models/vehicles, узлы которого
    /// собирает tools/blender/build_vehicle_models.py: body, steer (вилка, фара и
    /// руль; его локальная Y — рулевая ось), wheel_front под steer, wheel_rear и
    /// пустые точки seat, grip_l/r, peg_l/r. Мопед, пикап и грузовик — префабы
    /// пакета (RoaApocalypseModels.Vehicle): их колёса и руль находятся по именам
    /// узлов, а точки седока задаёт разметка PackRig, снятая с моделей в
    /// натуральную величину. Начало транспорта — земля под бёдрами седока, поэтому
    /// транспорт ставится прямо в узел персонажа.
    ///
    /// Вид ничего не решает: едет тот, кто его несёт (RoaCharacterView), со
    /// скоростью, которую держит сервер.
    /// </summary>
    public sealed class RoaVehicleView : MonoBehaviour
    {
        /// <summary>Мировые точки, за которые держится седок, и оси транспорта.</summary>
        public struct Anchors
        {
            public Vector3 Seat;
            public Vector3 GripLeft;
            public Vector3 GripRight;
            public Vector3 PegLeft;
            public Vector3 PegRight;
            public Vector3 Forward;
            public Vector3 Right;
            public Vector3 Up;
            /// <summary>Водитель сидит в кабине (ноги вперёд к педалям), а не верхом.</summary>
            public bool Cab;
        }

        /// <summary>
        /// Разметка транспорта из префаба пакета, в метрах пространства префаба
        /// (+Z — вперёд, начало — земля под центром). Точки сняты с моделей
        /// пакета PolygonApocalypse: седло и подножка мопеда — по верхней
        /// поверхности меша, в машинах — от обода руля (салон пакет не моделирует,
        /// кузов закрыт, поэтому водитель посажен по размерам человека).
        /// </summary>
        private sealed class PackRig
        {
            public string Kind;
            public bool Cab;
            public float MaxLeanDeg;
            public float MaxSteerDeg;
            /// <summary>Во сколько раз руль в кабине поворачивается сильнее колёс.</summary>
            public float SteeringRatio;
            public string SteerNode;
            /// <summary>Узлы, которые поворачиваются вместе с рулём вокруг своей локальной Y (вилка мопеда).</summary>
            public string[] SteerFollowers;
            public Vector3 Seat;
            public Vector3 GripLeft;
            public Vector3 GripRight;
            public Vector3 PegLeft;
            public Vector3 PegRight;
        }

        private static readonly PackRig[] PackRigs =
        {
            new PackRig
            {
                // SM_Veh_Moped_01: седло 0,9 м на z −0,45…−0,1, пол-подножка 0,36 м на
                // z 0…0,2, рукояти на концах руля (узел Handles, ширина 0,76 м).
                Kind = "moped", Cab = false, MaxLeanDeg = 15f, MaxSteerDeg = 28f, SteeringRatio = 1f,
                SteerNode = "SM_Veh_Moped_Handles_01",
                SteerFollowers = new[] { "SM_Veh_Moped_FrontWheel_Cover_01" },
                Seat = new Vector3(0f, 0.9f, -0.15f),
                GripLeft = new Vector3(-0.31f, 1.16f, 0.27f),
                GripRight = new Vector3(0.31f, 1.16f, 0.27f),
                PegLeft = new Vector3(-0.13f, 0.37f, 0.12f),
                PegRight = new Vector3(0.13f, 0.37f, 0.12f)
            },
            new PackRig
            {
                // SM_Veh_Ute_01: левый руль, обод Ø0,5 м с центром (−0,44; 1,66; 0,69); руки на «9 и 3 часа».
                Kind = "pickup", Cab = true, MaxLeanDeg = 0f, MaxSteerDeg = 30f, SteeringRatio = 4f,
                SteerNode = "SM_Veh_Ute_SteeringW_01",
                SteerFollowers = new string[0],
                Seat = new Vector3(-0.44f, 1.2f, 0.17f),
                GripLeft = new Vector3(-0.67f, 1.65f, 0.69f),
                GripRight = new Vector3(-0.21f, 1.65f, 0.69f),
                PegLeft = new Vector3(-0.56f, 0.9f, 1.0f),
                PegRight = new Vector3(-0.32f, 0.9f, 1.0f)
            },
            new PackRig
            {
                // SM_Veh_Army_Truck_01: левый руль, обод Ø0,58 м с центром (−0,43; 1,86; 1,24); руки на «9 и 3 часа».
                Kind = "truck", Cab = true, MaxLeanDeg = 0f, MaxSteerDeg = 28f, SteeringRatio = 5f,
                SteerNode = "SM_Veh_Army_Truck_01_SteeringW",
                SteerFollowers = new string[0],
                Seat = new Vector3(-0.43f, 1.4f, 0.72f),
                GripLeft = new Vector3(-0.69f, 1.84f, 1.235f),
                GripRight = new Vector3(-0.17f, 1.84f, 1.235f),
                PegLeft = new Vector3(-0.55f, 1.1f, 1.55f),
                PegRight = new Vector3(-0.31f, 1.1f, 1.55f)
            }
        };

        private const float MotorcycleMaxSteerDeg = 26f;
        private const float MotorcycleMaxLeanDeg = 17f;
        private const float AppearSeconds = 0.28f;
        private const float LeaveSeconds = 0.22f;

        private static readonly Dictionary<string, Task<GltfImport>> ModelCache =
            new Dictionary<string, Task<GltfImport>>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetModelCache() => RoaModelImportLifetime.Clear(ModelCache);

        private sealed class Wheel
        {
            public Transform Node;
            public Quaternion Base;
            public bool Steers;
        }

        private Transform _model;
        private Transform _steer;
        private Quaternion _steerBase;
        private Vector3 _steerAxis = Vector3.up;
        private readonly List<Transform> _steerFollowers = new List<Transform>();
        private readonly List<Quaternion> _steerFollowerBases = new List<Quaternion>();
        private readonly List<Wheel> _wheels = new List<Wheel>();
        private Transform _seat;
        private Transform _gripLeft;
        private Transform _gripRight;
        private Transform _pegLeft;
        private Transform _pegRight;
        private Vector3 _bodyBase;
        private float _wheelRadius = 0.32f;
        private float _wheelAngle;
        private float _maxSteerDeg = MotorcycleMaxSteerDeg;
        private float _maxLeanDeg = MotorcycleMaxLeanDeg;
        private float _steeringRatio = 1f;
        private bool _cab;
        private float _appear;
        private bool _leaving;
        private int _loadRequest;

        public string ItemId { get; private set; } = string.Empty;
        public string Kind { get; private set; } = string.Empty;
        public bool Ready { get; private set; }
        public bool Leaving { get { return _leaving; } }
        public bool Cab { get { return _cab; } }

        /// <summary>Сколько метров от точки седока назад до заднего моста: оттуда летит пыль.</summary>
        public float RearWheelOffset { get; private set; } = 0.72f;

        /// <summary>Крен в вираже, градусы вокруг оси «вперёд»: минус — вправо.</summary>
        public float LeanDeg { get; private set; }
        public float SteerDeg { get; private set; }
        public float WheelAngleDeg { get { return _wheelAngle; } }

        /// <summary>Сколько транспорта уже «на месте»: 0 — только вызван или уехал, 1 — стоит.</summary>
        public float Presence { get { return Ready ? EaseOut(_appear) : 0f; } }

        public event System.Action VisualChanged;

        public static RoaVehicleView Create(Transform parent, string baseUrl, string itemId)
        {
            RoaVehicleView view = CreateRoot(parent, itemId);
            if (string.IsNullOrEmpty(RoaVehicleCatalog.ModelPath(itemId)))
            {
                // Транспорт пакета грузится сразу: его префаб уже в сборке.
                GameObject prefab = RoaApocalypseModels.Vehicle(itemId);
                if (prefab == null) Debug.LogWarning("[ROA] Нет модели транспорта для " + itemId);
                else view.BindPack(prefab);
            }
            else
            {
                _ = view.Load(baseUrl);
            }
            return view;
        }

        /// <summary>
        /// Транспорт из уже созданной модели, сразу «на месте»: так его ставят
        /// редакторские пробы, где модель берётся из импортированного GLB.
        /// </summary>
        public static RoaVehicleView CreateFromModel(Transform parent, string itemId, GameObject model)
        {
            RoaVehicleView view = CreateRoot(parent, itemId);
            model.transform.SetParent(view.transform, false);
            if (!view.Bind(model.transform)) return view;
            view._appear = 1f;
            return view;
        }

        /// <summary>Транспорт из префаба пакета, сразу «на месте» (редакторские пробы).</summary>
        public static RoaVehicleView CreateFromPack(Transform parent, string itemId, GameObject prefab)
        {
            RoaVehicleView view = CreateRoot(parent, itemId);
            if (view.BindPack(prefab)) view._appear = 1f;
            return view;
        }

        private static RoaVehicleView CreateRoot(Transform parent, string itemId)
        {
            var root = new GameObject("Vehicle:" + itemId);
            root.transform.SetParent(parent, false);
            var view = root.AddComponent<RoaVehicleView>();
            view.ItemId = itemId ?? string.Empty;
            view.Kind = RoaVehicleCatalog.Kind(itemId);
            return view;
        }

        /// <summary>Отпустить транспорт: он быстро «уезжает» и удаляет себя.</summary>
        public void Dismiss()
        {
            _leaving = true;
            SetSolidHull(default(RoaVehicleCatalog.Hull));
        }

        private BoxCollider _solidHull;

        /// <summary>
        /// Твёрдый корпус чужого транспорта (self.vehicle.hull другого игрока): об
        /// него упираются пешеход и машина этого клиента. Свой транспорт корпуса-
        /// коллайдера не несёт — им сталкивается RoaPlayerController.
        /// </summary>
        public void SetSolidHull(RoaVehicleCatalog.Hull hull)
        {
            if (!hull.Valid || _leaving)
            {
                if (_solidHull != null) Destroy(_solidHull.gameObject);
                _solidHull = null;
                return;
            }
            if (_solidHull == null)
            {
                var body = new GameObject("SolidHull");
                body.transform.SetParent(transform, false);
                _solidHull = body.AddComponent<BoxCollider>();
            }
            _solidHull.size = hull.Size;
            _solidHull.transform.localPosition = hull.LocalCenter;
            _solidHull.transform.localRotation = Quaternion.identity;
        }

        private async Task Load(string baseUrl)
        {
            int request = ++_loadRequest;
            string path = RoaVehicleCatalog.ModelPath(ItemId);
            if (string.IsNullOrEmpty(path))
            {
                Debug.LogWarning("[ROA] Нет модели транспорта для " + ItemId);
                return;
            }
            string url = (baseUrl ?? string.Empty).TrimEnd('/') + path;
            GltfImport import = await LoadCached(url);
            if (this == null || request != _loadRequest) return;
            if (import == null)
            {
                Debug.LogWarning("[ROA] Модель транспорта не загрузилась: " + url);
                return;
            }
            var holder = new GameObject("VehicleModel");
            holder.transform.SetParent(transform, false);
            if (!await import.InstantiateMainSceneAsync(holder.transform))
            {
                if (holder != null) Destroy(holder);
                Debug.LogWarning("[ROA] Не удалось создать модель транспорта " + ItemId);
                return;
            }
            if (this == null || request != _loadRequest)
            {
                if (holder != null) Destroy(holder);
                return;
            }
            Bind(holder.transform);
        }

        /// <summary>Привязать узлы уже созданной GLB-модели мотоцикла. Открыт для редакторских проб.</summary>
        public bool Bind(Transform model)
        {
            _model = model;
            _steer = FindDeep(model, "steer");
            Transform wheelFront = FindDeep(model, "wheel_front");
            Transform wheelRear = FindDeep(model, "wheel_rear");
            _seat = FindDeep(model, "seat");
            Transform gripA = FindDeep(model, "grip_l");
            Transform gripB = FindDeep(model, "grip_r");
            Transform pegA = FindDeep(model, "peg_l");
            Transform pegB = FindDeep(model, "peg_r");
            if (FindDeep(model, "body") == null || _steer == null || wheelFront == null || wheelRear == null || _seat == null
                || gripA == null || gripB == null || pegA == null || pegB == null)
            {
                Debug.LogWarning("[ROA] У модели транспорта " + ItemId + " нет узлов колёс, руля или седла.");
                return false;
            }

            // Стороны берутся по положению, а не по имени: зеркалирование оси X при
            // импорте glTF не должно скрестить седоку руки и ноги.
            bool gripSwap = transform.InverseTransformPoint(gripA.position).x > transform.InverseTransformPoint(gripB.position).x;
            _gripLeft = gripSwap ? gripB : gripA;
            _gripRight = gripSwap ? gripA : gripB;
            bool pegSwap = transform.InverseTransformPoint(pegA.position).x > transform.InverseTransformPoint(pegB.position).x;
            _pegLeft = pegSwap ? pegB : pegA;
            _pegRight = pegSwap ? pegA : pegB;

            _steerBase = _steer.localRotation;
            _steerAxis = Vector3.up;
            _wheels.Clear();
            _wheels.Add(new Wheel { Node = wheelFront, Base = wheelFront.localRotation });
            _wheels.Add(new Wheel { Node = wheelRear, Base = wheelRear.localRotation });
            _bodyBase = _model.localPosition;
            // Ось колеса стоит на высоте радиуса: земля — начало модели.
            _wheelRadius = Mathf.Max(0.12f, transform.InverseTransformPoint(wheelRear.position).y);
            RearWheelOffset = Mathf.Max(0.2f, -transform.InverseTransformPoint(wheelRear.position).z);
            _maxSteerDeg = MotorcycleMaxSteerDeg;
            _maxLeanDeg = MotorcycleMaxLeanDeg;
            _steeringRatio = 1f;
            _cab = false;

            RoaApocalypseVisuals.AttachStatic(model, RoaApocalypseModels.Vehicle(ItemId));
            FinishBind(model);
            return true;
        }

        /// <summary>Собрать транспорт из префаба пакета по его разметке PackRig.</summary>
        public bool BindPack(GameObject prefab)
        {
            PackRig rig = null;
            foreach (PackRig candidate in PackRigs)
                if (candidate.Kind == Kind) rig = candidate;
            if (prefab == null || rig == null)
            {
                Debug.LogWarning("[ROA] Нет разметки седока для транспорта " + ItemId + " (" + Kind + ").");
                return false;
            }

            // Префаб — в натуральную величину; сдвигается только целиком, чтобы
            // седло оказалось над началом транспорта, то есть над персонажем.
            GameObject instance = Instantiate(prefab, transform, false);
            instance.name = "VehicleModel";
            RoaApocalypseVisuals.SetNativeWorldScale(instance.transform, prefab.transform.localScale);
            instance.transform.localRotation = Quaternion.identity;
            instance.transform.localPosition = new Vector3(-rig.Seat.x, 0f, -rig.Seat.z);
            foreach (Transform node in instance.GetComponentsInChildren<Transform>(true))
                node.gameObject.layer = gameObject.layer;
            foreach (Collider collider in instance.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            foreach (Animator animator in instance.GetComponentsInChildren<Animator>(true)) animator.enabled = false;
            _model = instance.transform;

            _steer = FindDeep(_model, rig.SteerNode);
            if (_steer == null)
            {
                Debug.LogWarning("[ROA] У модели транспорта " + ItemId + " нет руля " + rig.SteerNode + ".");
                return false;
            }
            _steerBase = _steer.localRotation;
            // Руль мопеда поворачивается вокруг рулевой колонки (локальная Y узла
            // руля), рулевое колесо машины — вокруг своей оси (локальная Z).
            _steerAxis = rig.Cab ? Vector3.forward : Vector3.up;
            _steerFollowers.Clear();
            _steerFollowerBases.Clear();
            foreach (string name in rig.SteerFollowers)
            {
                Transform follower = FindDeep(_model, name);
                if (follower == null) continue;
                _steerFollowers.Add(follower);
                _steerFollowerBases.Add(follower.localRotation);
            }

            // Колёса — узлы с Wheel в имени (без брони и крыльев); передние — те,
            // что впереди седла. В кабине передние колёса ещё и поворачиваются.
            _wheels.Clear();
            float rearZ = 0f;
            float radius = 0f;
            foreach (Transform node in _model.GetComponentsInChildren<Transform>(true))
            {
                string name = node.name;
                if (name.IndexOf("Wheel", System.StringComparison.Ordinal) < 0 || name.Contains("Armour")
                    || name.Contains("Cover") || name.Contains("Spike") || name.Contains("SteeringW")) continue;
                Renderer renderer = node.GetComponent<Renderer>();
                if (renderer == null) continue;
                float z = _model.InverseTransformPoint(node.position).z;
                bool front = z > rig.Seat.z;
                _wheels.Add(new Wheel { Node = node, Base = node.localRotation, Steers = rig.Cab && front });
                if (!front) rearZ = Mathf.Min(rearZ, z);
                radius = Mathf.Max(radius, renderer.bounds.extents.y / Mathf.Max(0.0001f, transform.lossyScale.y));
            }
            if (_wheels.Count < 2)
            {
                Debug.LogWarning("[ROA] У модели транспорта " + ItemId + " не нашлось колёс.");
                return false;
            }
            _wheelRadius = Mathf.Max(0.12f, radius);
            RearWheelOffset = Mathf.Max(0.2f, rig.Seat.z - rearZ);

            // Точки седока — пустые узлы: руки держатся за руль и поворачиваются с ним.
            _seat = Anchor("seat", _model, rig.Seat);
            _gripLeft = Anchor("grip_l", _steer, _model.TransformPoint(rig.GripLeft), true);
            _gripRight = Anchor("grip_r", _steer, _model.TransformPoint(rig.GripRight), true);
            _pegLeft = Anchor("peg_l", _model, rig.PegLeft);
            _pegRight = Anchor("peg_r", _model, rig.PegRight);

            _bodyBase = _model.localPosition;
            _maxSteerDeg = rig.MaxSteerDeg;
            _maxLeanDeg = rig.MaxLeanDeg;
            _steeringRatio = rig.SteeringRatio;
            _cab = rig.Cab;
            FinishBind(_model);
            return true;
        }

        private static Transform Anchor(string name, Transform parent, Vector3 point, bool world = false)
        {
            var anchor = new GameObject(name).transform;
            anchor.SetParent(parent, false);
            if (world) anchor.position = point;
            else anchor.localPosition = point;
            return anchor;
        }

        private void FinishBind(Transform model)
        {
            foreach (Renderer renderer in model.GetComponentsInChildren<Renderer>(true))
            {
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }
            Ready = true;
            VisualChanged?.Invoke();
        }

        /// <summary>
        /// Точки седока в мире — такими, какими они будут у транспорта в полный
        /// рост: пока он «подъезжает», седок уже садится на место, а не приседает
        /// вслед растущей модели. Руль, подвеска и крен учтены.
        /// </summary>
        public bool TryGetAnchors(out Anchors anchors)
        {
            anchors = default(Anchors);
            if (!Ready || _seat == null) return false;
            anchors.Seat = FullSize(_seat.position);
            anchors.GripLeft = FullSize(_gripLeft.position);
            anchors.GripRight = FullSize(_gripRight.position);
            anchors.PegLeft = FullSize(_pegLeft.position);
            anchors.PegRight = FullSize(_pegRight.position);
            anchors.Forward = transform.forward;
            anchors.Right = transform.right;
            anchors.Up = transform.up;
            anchors.Cab = _cab;
            return true;
        }

        private Vector3 FullSize(Vector3 world)
        {
            Vector3 local = transform.InverseTransformPoint(world);
            Vector3 offset = transform.rotation * local;
            return transform.position + offset;
        }

        /// <summary>
        /// Анимация езды за кадр. speed — ход вдоль транспорта со знаком, м/с: он
        /// смотрит на курсор и может катиться назад (колёса крутятся назад) или
        /// боком (колёса стоят). yawRateDeg — скорость поворота корпуса, град/с
        /// (плюс — направо). Возвращает крен (у машин всегда ноль).
        /// </summary>
        public float Step(float speed, float yawRateDeg, float dt)
        {
            dt = Mathf.Clamp(dt, 0f, 0.1f);
            if (!Ready) return 0f;

            float pace = Mathf.Abs(speed);
            _wheelAngle = Mathf.Repeat(_wheelAngle + speed * dt / _wheelRadius * Mathf.Rad2Deg, 360f);

            // Руль: на малой скорости тот же поворот требует большего угла; задним
            // ходом руль в поворот встаёт зеркально.
            float steerGain = Mathf.Lerp(0.2f, 0.045f, Mathf.InverseLerp(0.5f, 11f, pace)) * Mathf.Sign(speed);
            float steerTarget = pace > 0.2f ? Mathf.Clamp(yawRateDeg * steerGain, -_maxSteerDeg, _maxSteerDeg) : SteerDeg;
            SteerDeg = Mathf.Lerp(SteerDeg, steerTarget, 1f - Mathf.Exp(-9f * dt));
            // Рулевое колесо смотрит на водителя: поворот направо — против часовой вокруг его оси.
            float steerNodeDeg = _cab ? -SteerDeg * _steeringRatio : SteerDeg;
            _steer.localRotation = _steerBase * Quaternion.AngleAxis(steerNodeDeg, _steerAxis);
            for (int i = 0; i < _steerFollowers.Count; i++)
                _steerFollowers[i].localRotation = _steerFollowerBases[i] * Quaternion.AngleAxis(SteerDeg, Vector3.up);
            foreach (Wheel wheel in _wheels)
            {
                Quaternion spin = Quaternion.AngleAxis(_wheelAngle, Vector3.right);
                wheel.Node.localRotation = wheel.Steers
                    ? wheel.Base * Quaternion.AngleAxis(SteerDeg, Vector3.up) * spin
                    : wheel.Base * spin;
            }

            // Крен уравновешивает боковое ускорение v·ω: вправо — отрицательный угол вокруг «вперёд».
            float lateral = speed * yawRateDeg * Mathf.Deg2Rad;
            float leanTarget = Mathf.Clamp(-Mathf.Atan2(lateral, 9.81f) * Mathf.Rad2Deg, -_maxLeanDeg, _maxLeanDeg);
            LeanDeg = Mathf.Lerp(LeanDeg, leanTarget, 1f - Mathf.Exp(-5f * dt));

            // Мотор дрожит на холостых, подвеска покачивается на ходу.
            float t = Time.time;
            float ride = Mathf.InverseLerp(0.3f, 9f, pace);
            float idle = (1f - ride) * Mathf.Sin(t * 57f) * 0.0035f;
            float bump = ride * (Mathf.Sin(t * 8.3f) * 0.006f + Mathf.Sin(t * 13.1f) * 0.003f);
            _model.localPosition = _bodyBase + Vector3.up * (idle + bump);
            return LeanDeg;
        }

        private void UpdatePresence(float dt)
        {
            if (_leaving)
            {
                _appear = Mathf.MoveTowards(_appear, 0f, dt / LeaveSeconds);
                if (_appear <= 0f)
                {
                    Destroy(gameObject);
                    return;
                }
            }
            else if (Ready)
            {
                _appear = Mathf.MoveTowards(_appear, 1f, dt / AppearSeconds);
            }
        }

        private void Update()
        {
            // Появление и уход живут сами по себе: отпущенный транспорт доигрывает
            // уход, даже когда седок уже не спрашивает его о точках.
            UpdatePresence(Mathf.Clamp(Time.deltaTime, 0f, 0.1f));
        }

        private static float EaseOut(float t)
        {
            t = Mathf.Clamp01(t);
            float inverse = 1f - t;
            return 1f - inverse * inverse * inverse;
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

        private static async Task<GltfImport> LoadCached(string url)
        {
            if (ModelCache.TryGetValue(url, out Task<GltfImport> cached)) return await cached;
            Task<GltfImport> loading = LoadImport(url);
            ModelCache[url] = loading;
            GltfImport result = await loading;
            if (result == null) ModelCache.Remove(url);
            return result;
        }

        private static async Task<GltfImport> LoadImport(string url)
        {
            var import = new GltfImport();
            var settings = new ImportSettings { AnimationMethod = AnimationMethod.None };
            if (await import.Load(RoaModelUrl.Lite(url), settings)) return import;
            import.Dispose();
            return null;
        }
    }
}
