using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Транспорт под седоком: модель из /assets/models/vehicles, вращение колёс по
    /// пройденному пути, руль по скорости поворота и наклон в вираже.
    ///
    /// Узлы модели собирает tools/blender/build_vehicle_models.py: body, steer
    /// (вилка, фара и руль; его локальная Y — рулевая ось), wheel_front под steer,
    /// wheel_rear, и пустые точки seat, grip_l/r, peg_l/r — к ним тянется поза
    /// седока (RoaRiderPose). Начало модели — земля под бёдрами седока, поэтому
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
        }

        private const float MaxSteerDeg = 26f;
        private const float MaxLeanDeg = 17f;
        private const float AppearSeconds = 0.28f;
        private const float LeaveSeconds = 0.22f;

        private static readonly Dictionary<string, Task<GltfImport>> ModelCache =
            new Dictionary<string, Task<GltfImport>>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetModelCache() => RoaModelImportLifetime.Clear(ModelCache);

        private Transform _model;
        private Transform _body;
        private Transform _steer;
        private Transform _wheelFront;
        private Transform _wheelRear;
        private Transform _seat;
        private Transform _gripLeft;
        private Transform _gripRight;
        private Transform _pegLeft;
        private Transform _pegRight;
        private Quaternion _steerBase;
        private Quaternion _wheelFrontBase;
        private Quaternion _wheelRearBase;
        private Vector3 _bodyBase;
        private float _wheelRadius = 0.32f;
        private float _wheelAngle;
        private float _appear;
        private bool _leaving;
        private int _loadRequest;

        public string ItemId { get; private set; } = string.Empty;
        public bool Ready { get; private set; }
        public bool Leaving { get { return _leaving; } }

        /// <summary>Крен в вираже, градусы вокруг оси «вперёд»: минус — вправо.</summary>
        public float LeanDeg { get; private set; }
        public float SteerDeg { get; private set; }
        public float WheelAngleDeg { get { return _wheelAngle; } }

        /// <summary>Сколько транспорта уже «на месте»: 0 — только вызван или уехал, 1 — стоит.</summary>
        public float Presence { get { return Ready ? EaseOut(_appear) : 0f; } }

        public event System.Action VisualChanged;

        public static RoaVehicleView Create(Transform parent, string baseUrl, string itemId)
        {
            var root = new GameObject("Vehicle:" + itemId);
            root.transform.SetParent(parent, false);
            var view = root.AddComponent<RoaVehicleView>();
            view.ItemId = itemId ?? string.Empty;
            root.transform.localScale = Vector3.one * 0.001f;
            _ = view.Load(baseUrl);
            return view;
        }

        /// <summary>
        /// Транспорт из уже созданной модели, сразу «на месте»: так его ставят
        /// редакторские пробы, где модель берётся из импортированного GLB.
        /// </summary>
        public static RoaVehicleView CreateFromModel(Transform parent, string itemId, GameObject model)
        {
            var root = new GameObject("Vehicle:" + itemId);
            root.transform.SetParent(parent, false);
            var view = root.AddComponent<RoaVehicleView>();
            view.ItemId = itemId ?? string.Empty;
            model.transform.SetParent(root.transform, false);
            if (!view.Bind(model.transform)) return view;
            view._appear = 1f;
            root.transform.localScale = Vector3.one;
            return view;
        }

        /// <summary>Отпустить транспорт: он быстро «уезжает» и удаляет себя.</summary>
        public void Dismiss()
        {
            _leaving = true;
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

        /// <summary>Привязать узлы уже созданной модели. Открыт для редакторских проб.</summary>
        public bool Bind(Transform model)
        {
            _model = model;
            _body = FindDeep(model, "body");
            _steer = FindDeep(model, "steer");
            _wheelFront = FindDeep(model, "wheel_front");
            _wheelRear = FindDeep(model, "wheel_rear");
            _seat = FindDeep(model, "seat");
            Transform gripA = FindDeep(model, "grip_l");
            Transform gripB = FindDeep(model, "grip_r");
            Transform pegA = FindDeep(model, "peg_l");
            Transform pegB = FindDeep(model, "peg_r");
            if (_body == null || _steer == null || _wheelFront == null || _wheelRear == null || _seat == null
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
            _wheelFrontBase = _wheelFront.localRotation;
            _wheelRearBase = _wheelRear.localRotation;
            _bodyBase = _model.localPosition;
            // Ось колеса стоит на высоте радиуса: земля — начало модели.
            _wheelRadius = Mathf.Max(0.12f, transform.InverseTransformPoint(_wheelRear.position).y);

            RoaApocalypseVisuals.AttachStatic(model, RoaApocalypseModels.Vehicle(ItemId));

            foreach (Renderer renderer in model.GetComponentsInChildren<Renderer>(true))
            {
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }
            Ready = true;
            VisualChanged?.Invoke();
            return true;
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
            return true;
        }

        private Vector3 FullSize(Vector3 world)
        {
            Vector3 local = transform.InverseTransformPoint(world);
            Vector3 offset = transform.rotation * local;
            return transform.position + offset;
        }

        /// <summary>
        /// Анимация езды за кадр. speed — ход вдоль мотоцикла со знаком, м/с: он
        /// смотрит на курсор и может катиться назад (колёса крутятся назад) или
        /// боком (колёса стоят). yawRateDeg — скорость поворота корпуса, град/с
        /// (плюс — направо). Возвращает крен.
        /// </summary>
        public float Step(float speed, float yawRateDeg, float dt)
        {
            dt = Mathf.Clamp(dt, 0f, 0.1f);
            if (!Ready) return 0f;

            float pace = Mathf.Abs(speed);
            _wheelAngle = Mathf.Repeat(_wheelAngle + speed * dt / _wheelRadius * Mathf.Rad2Deg, 360f);
            _wheelFront.localRotation = _wheelFrontBase * Quaternion.AngleAxis(_wheelAngle, Vector3.right);
            _wheelRear.localRotation = _wheelRearBase * Quaternion.AngleAxis(_wheelAngle, Vector3.right);

            // Руль: на малой скорости тот же поворот требует большего угла; задним
            // ходом руль в поворот встаёт зеркально.
            float steerGain = Mathf.Lerp(0.2f, 0.045f, Mathf.InverseLerp(0.5f, 11f, pace)) * Mathf.Sign(speed);
            float steerTarget = pace > 0.2f ? Mathf.Clamp(yawRateDeg * steerGain, -MaxSteerDeg, MaxSteerDeg) : SteerDeg;
            SteerDeg = Mathf.Lerp(SteerDeg, steerTarget, 1f - Mathf.Exp(-9f * dt));
            _steer.localRotation = _steerBase * Quaternion.AngleAxis(SteerDeg, Vector3.up);

            // Крен уравновешивает боковое ускорение v·ω: вправо — отрицательный угол вокруг «вперёд».
            float lateral = speed * yawRateDeg * Mathf.Deg2Rad;
            float leanTarget = Mathf.Clamp(-Mathf.Atan2(lateral, 9.81f) * Mathf.Rad2Deg, -MaxLeanDeg, MaxLeanDeg);
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
            transform.localScale = Vector3.one * Mathf.Max(0.001f, Presence);
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
