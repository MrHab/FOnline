using System;
using System.Collections;
using System.Collections.Generic;
using Kromka;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// 3D-карта мира. Авторская сцена KromkaGlobalMap — рельеф, реки, дороги и города —
    /// грузится поверх текущей зоны и рисуется своей камерой в своём слое: локальный мир
    /// в это время не рисуется, но живёт. Поверх рельефа лежит сетка зон: цвет опасности,
    /// границы с проёмами открытых ворот и путь до выбранной цели; флажок — где стоит
    /// игрок. Камера: сдвиг, масштаб и поворот мышью, клавишами и жестами.
    ///
    /// Координаты: точка карты — километры от северо-западного угла мира (ось y — на юг),
    /// в сцене это ×0,1 от центра карты, север — к +z, высота — запечённый рельеф.
    /// Сцена стоит в начале координат, как и локальный мир, поэтому её коллайдеры
    /// выключаются, а выбор точки считается по рельефу, без физики.
    /// </summary>
    public sealed class RoaWorldMap3D : MonoBehaviour
    {
        public const int MapLayer = 30;
        public const float WorldScale = 0.1f;
        public const float MinDistance = 2.5f;
        public const float MaxDistance = 42f;
        public const float MinPitch = 30f;
        public const float MaxPitch = 86f;

        private const float FillLift = 0.035f;
        private const float LineLift = 0.05f;
        private const float RouteLift = 0.07f;
        private const int FillSteps = 5;
        private const float TapPixels = 9f;
        private const float TapSeconds = 0.6f;

        private static readonly Color FillTint = new Color(1f, 1f, 1f, 0.2f);
        private static readonly Color LineColor = new Color(0.03f, 0.03f, 0.02f, 0.62f);
        private static readonly Color RouteColor = new Color(1f, 0.78f, 0.25f, 0.95f);
        private static readonly Color RouteFill = new Color(1f, 0.78f, 0.25f, 0.24f);
        private static readonly Color PlayerColor = new Color(0.96f, 0.27f, 0.2f, 1f);
        private static readonly Color SelectionColor = new Color(1f, 0.9f, 0.55f, 1f);

        public bool IsOpen { get; private set; }
        public bool IsLoading { get; private set; }
        public bool Ready { get { return _root != null; } }
        public string FailReason { get; private set; } = string.Empty;
        public Camera MapCamera { get { return _camera; } }
        public float Distance { get { return _distance; } }
        public bool InputEnabled = true;
        public bool HasZones { get { return _zonesView != null; } }

        /// <summary>Клик (или касание) по карте: точка карты в километрах.</summary>
        public event Action<Vector2> PointPicked;

        private Scene _scene;
        private Transform _root;
        private RoaGlobalMapRelief _relief;
        private Camera _camera;
        private Camera _hiddenMain;
        private int _hiddenMainMask;
        private bool _savedFog;
        private AmbientMode _savedAmbientMode;
        private Color _savedAmbient;
        private bool _mobile;
        private float _widthKm = 380f;
        private float _heightKm = 300f;
        private GameObject _zonesView;
        private GameObject _routeView;
        private Transform _playerMarker;
        private Transform _selectionMarker;
        private Material _overlayMaterial;
        private Material _markerMaterial;
        private readonly List<Mesh> _meshes = new List<Mesh>();
        private readonly List<Material> _materials = new List<Material>();
        private Vector2 _lastMouse;

        private Vector3 _anchor;
        private float _yaw;
        private float _pitch = 56f;
        private float _distance = 14f;
        private Vector2 _pressAt;
        private float _pressTime;
        private bool _pressOverUi;
        private bool _dragging;
        private float _pinchDistance;
        private float _pinchAngle;
        private Vector2 _pinchCentre;

        // --- открыть и закрыть --------------------------------------------------------------------------

        /// <summary>Загрузить сцену (один раз) и показать карту. mobile — упрощённая детализация.</summary>
        public IEnumerator Open(bool mobile)
        {
            if (IsOpen || IsLoading) yield break;
            _mobile = mobile;
            FailReason = string.Empty;
            if (_root == null)
            {
                IsLoading = true;
                yield return LoadScene();
                IsLoading = false;
                if (_root == null) yield break;
            }
            SetSceneActive(true);
            EnsureCamera();
            // Главная камера остаётся включённой (на неё смотрят подписи и туман войны), но
            // ничего не рисует: мир под картой не тратит кадр.
            _hiddenMain = Camera.main != _camera ? Camera.main : null;
            if (_hiddenMain != null)
            {
                _hiddenMainMask = _hiddenMain.cullingMask;
                _hiddenMain.cullingMask = 0;
            }
            _camera.enabled = true;
            ExcludeForeignLights();
            _savedFog = RenderSettings.fog;
            _savedAmbientMode = RenderSettings.ambientMode;
            _savedAmbient = RenderSettings.ambientLight;
            RenderSettings.fog = false;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.5f, 0.49f, 0.45f, 1f);
            IsOpen = true;
            ApplyCamera();
        }

        public void Close()
        {
            if (!IsOpen) return;
            IsOpen = false;
            _dragging = false;
            if (_camera != null) _camera.enabled = false;
            if (_hiddenMain != null) _hiddenMain.cullingMask = _hiddenMainMask;
            _hiddenMain = null;
            RenderSettings.fog = _savedFog;
            RenderSettings.ambientMode = _savedAmbientMode;
            RenderSettings.ambientLight = _savedAmbient;
            if (_root == null) return;
            // На телефоне память дороже мгновенного повторного открытия.
            if (_mobile)
            {
                ReleaseOverlays();
                SceneManager.UnloadSceneAsync(_scene);
                _root = null;
                _playerMarker = _selectionMarker = null;
            }
            else
            {
                SetSceneActive(false);
            }
        }

        private void SetSceneActive(bool active)
        {
            if (!_scene.IsValid() || !_scene.isLoaded) return;
            foreach (GameObject top in _scene.GetRootGameObjects())
            {
                // Маркеры и слои карты живут под корнем сцены и переключаются вместе с ним.
                if (top.activeSelf != active) top.SetActive(active);
            }
        }

        /// <summary>Пробы редактора: подключить уже открытую сцену карты без загрузки и открыть вид.</summary>
        public void AttachForProbe(Scene scene, RoaUnityGlobalMapScene authored, bool mobile)
        {
            _mobile = mobile;
            _scene = scene;
            _root = authored.transform;
            _relief = Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            Isolate(scene);
            if (mobile) ReduceDetail();
            _playerMarker = Marker("WorldMapPlayer", PlayerColor, 0.22f);
            _selectionMarker = Marker("WorldMapSelection", SelectionColor, 0.16f);
            _selectionMarker.gameObject.SetActive(false);
            EnsureCamera();
            IsOpen = true;
            ApplyCamera();
        }

        /// <summary>Снять кадр камеры карты в PNG (пробы).</summary>
        public void CaptureTo(string file, int width, int height)
        {
            ApplyCamera();
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            _camera.targetTexture = target;
            _camera.Render();
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = target;
            var image = new Texture2D(width, height, TextureFormat.RGB24, false);
            image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            image.Apply();
            RenderTexture.active = previous;
            System.IO.File.WriteAllBytes(file, image.EncodeToPNG());
            _camera.targetTexture = null;
            DestroyImmediate(target);
            DestroyImmediate(image);
        }

        public void SetView(float yaw, float pitch)
        {
            _yaw = yaw;
            _pitch = Mathf.Clamp(pitch, MinPitch, MaxPitch);
            ApplyCamera();
        }

        private IEnumerator LoadScene()
        {
            string name = KromkaLocationSceneCatalog.WorldMapSceneName;
            Scene scene = SceneManager.GetSceneByName(name);
            if (!scene.IsValid() || !scene.isLoaded)
            {
                AsyncOperation load = SceneManager.LoadSceneAsync(name, LoadSceneMode.Additive);
                if (load == null)
                {
                    FailReason = "Сцена карты мира не входит в сборку.";
                    yield break;
                }
                while (!load.isDone) yield return null;
                scene = SceneManager.GetSceneByName(name);
            }
            RoaUnityGlobalMapScene authored = null;
            foreach (GameObject top in scene.GetRootGameObjects())
            {
                authored = top.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (authored != null) break;
            }
            if (authored == null)
            {
                FailReason = "В сцене карты мира нет RoaUnityGlobalMapScene.";
                SceneManager.UnloadSceneAsync(scene);
                yield break;
            }
            _scene = scene;
            _root = authored.transform;
            _relief = Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            Isolate(scene);
            if (_mobile) ReduceDetail();
            _playerMarker = Marker("WorldMapPlayer", PlayerColor, 0.22f);
            _selectionMarker = Marker("WorldMapSelection", SelectionColor, 0.16f);
            _selectionMarker.gameObject.SetActive(false);
        }

        /// <summary>
        /// Сцена карты стоит там же, где локальный мир: её объекты уходят в свой слой, свет
        /// светит только ему, коллайдеры и камеры сцены выключены — местный мир их не заметит.
        /// </summary>
        private static void Isolate(Scene scene)
        {
            foreach (GameObject top in scene.GetRootGameObjects())
            {
                foreach (Transform node in top.GetComponentsInChildren<Transform>(true)) node.gameObject.layer = MapLayer;
                foreach (Light light in top.GetComponentsInChildren<Light>(true)) light.cullingMask = 1 << MapLayer;
                foreach (Collider collider in top.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
                foreach (Camera camera in top.GetComponentsInChildren<Camera>(true)) camera.enabled = false;
                foreach (AudioListener listener in top.GetComponentsInChildren<AudioListener>(true)) listener.enabled = false;
            }
        }

        /// <summary>Свет локального мира не должен светить на карту (и наоборот — см. Isolate).</summary>
        private void ExcludeForeignLights()
        {
            foreach (Light light in FindObjectsByType<Light>(FindObjectsInactive.Include))
            {
                if (light == null || light.gameObject.scene == _scene) continue;
                light.cullingMask &= ~(1 << MapLayer);
            }
        }

        /// <summary>Телефон: без края мира, частиц и теней — рельеф, реки, дороги и города остаются.</summary>
        private void ReduceDetail()
        {
            Transform edge = FindDeep(_root, "WorldEdge_AUTHORED");
            if (edge != null) edge.gameObject.SetActive(false);
            foreach (ParticleSystem particles in _root.GetComponentsInChildren<ParticleSystem>(true)) particles.gameObject.SetActive(false);
            foreach (Light light in _root.GetComponentsInChildren<Light>(true)) light.shadows = LightShadows.None;
            foreach (Renderer renderer in _root.GetComponentsInChildren<Renderer>(true)) renderer.shadowCastingMode = ShadowCastingMode.Off;
        }

        private void EnsureCamera()
        {
            if (_camera != null) return;
            var go = new GameObject("WorldMap3DCamera");
            go.transform.SetParent(transform, false);
            _camera = go.AddComponent<Camera>();
            _camera.cullingMask = 1 << MapLayer;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = new Color(0.035f, 0.04f, 0.035f, 1f);
            _camera.nearClipPlane = 0.05f;
            _camera.farClipPlane = 400f;
            _camera.fieldOfView = 40f;
            _camera.depth = 40f;
            _camera.enabled = false;
        }

        // --- координаты ---------------------------------------------------------------------------------

        public void SetWorldSize(float widthKm, float heightKm)
        {
            _widthKm = Mathf.Max(1f, widthKm);
            _heightKm = Mathf.Max(1f, heightKm);
        }

        public float ReliefAt(Vector2 point)
        {
            return _relief != null && _relief.Ready ? _relief.HeightAt(point.x, point.y) : 0f;
        }

        /// <summary>Точка карты (км) в локальных координатах сцены с подъёмом над рельефом.</summary>
        public Vector3 PointToLocal(Vector2 point, float lift)
        {
            return new Vector3((point.x - _widthKm * 0.5f) * WorldScale, ReliefAt(point) + lift,
                (_heightKm * 0.5f - point.y) * WorldScale);
        }

        public Vector2 LocalToPoint(Vector3 local)
        {
            return new Vector2(local.x / WorldScale + _widthKm * 0.5f, _heightKm * 0.5f - local.z / WorldScale);
        }

        public Vector3 PointToWorld(Vector2 point, float lift)
        {
            Vector3 local = PointToLocal(point, lift);
            return _root != null ? _root.TransformPoint(local) : local;
        }

        /// <summary>Экранная точка карты; false — за камерой или карта закрыта.</summary>
        public bool PointToScreen(Vector2 point, float lift, out Vector2 screen)
        {
            screen = Vector2.zero;
            if (!IsOpen || _camera == null || _root == null) return false;
            Vector3 at = _camera.WorldToScreenPoint(PointToWorld(point, lift));
            if (at.z <= 0f) return false;
            screen = new Vector2(at.x, at.y);
            return at.x >= -40f && at.y >= -40f && at.x <= Screen.width + 40f && at.y <= Screen.height + 40f;
        }

        /// <summary>Точка карты под экранной точкой: луч идёт шагами до рельефа.</summary>
        public bool ScreenToPoint(Vector2 screen, out Vector2 point)
        {
            point = Vector2.zero;
            if (_camera == null || _root == null) return false;
            Ray ray = _camera.ScreenPointToRay(screen);
            Vector3 origin = _root.InverseTransformPoint(ray.origin);
            Vector3 direction = _root.InverseTransformDirection(ray.direction).normalized;
            if (direction.y >= -0.001f) return false;
            float step = 0.04f;
            Vector3 previous = origin;
            for (int i = 0; i < 4000; i++)
            {
                Vector3 at = origin + direction * (step * i);
                Vector2 candidate = LocalToPoint(at);
                float ground = ReliefAt(candidate);
                if (at.y <= ground)
                {
                    // Уточнение между двумя шагами: точка пересечения луча с рельефом.
                    Vector3 hit = Vector3.Lerp(previous, at, 0.5f);
                    point = LocalToPoint(hit);
                    return point.x >= 0f && point.y >= 0f && point.x <= _widthKm && point.y <= _heightKm;
                }
                previous = at;
            }
            return false;
        }

        // --- слои карты: зоны, путь, маркеры --------------------------------------------------------------

        /// <summary>Сетка зон на рельефе: заливка цветом опасности и границы с проёмами открытых ворот.</summary>
        public void ShowZones(ICollection<JObject> zones, float zoneKm, Func<string, Color> colorOf)
        {
            if (_root == null || zones == null) return;
            if (_zonesView != null) Discard(_zonesView);
            _zonesView = new GameObject("WorldMapZones");
            _zonesView.layer = MapLayer;
            _zonesView.transform.SetParent(_root, false);
            Dictionary<int, JObject> cells = RoaWorldMapRoute.CellIndex(zones);

            var fill = new MeshBuilder();
            var lines = new MeshBuilder();
            foreach (JObject zone in zones)
            {
                int col = RoaWorldMapRoute.Col(zone), row = RoaWorldMapRoute.Row(zone);
                Color color = colorOf(zone["mode"]?.ToString());
                AddDrapedCell(fill, new Vector2(col * zoneKm, row * zoneKm), zoneKm, new Color(color.r, color.g, color.b, FillTint.a), FillLift);
                // Каждую общую границу рисует одна зона: северную и западную; внешние края — свои.
                AddEdge(lines, zone, cells, col, row, 'n', zoneKm);
                AddEdge(lines, zone, cells, col, row, 'w', zoneKm);
                if (!cells.ContainsKey((col + 1) * 1000 + row)) AddEdge(lines, zone, cells, col, row, 'e', zoneKm);
                if (!cells.ContainsKey(col * 1000 + row + 1)) AddEdge(lines, zone, cells, col, row, 's', zoneKm);
            }
            AddMesh(_zonesView.transform, "Fill", fill, 3001);
            AddMesh(_zonesView.transform, "Borders", lines, 3002);
        }

        /// <summary>Путь по зонам: золотая заливка зон пути и линия через их центры.</summary>
        public void ShowRoute(IReadOnlyList<JObject> path, float zoneKm)
        {
            if (_routeView != null) Discard(_routeView);
            _routeView = null;
            if (_root == null || path == null || path.Count == 0) return;
            _routeView = new GameObject("WorldMapRoute");
            _routeView.layer = MapLayer;
            _routeView.transform.SetParent(_root, false);
            var fill = new MeshBuilder();
            var line = new MeshBuilder();
            Vector2 previous = Vector2.zero;
            for (int i = 0; i < path.Count; i++)
            {
                int col = RoaWorldMapRoute.Col(path[i]), row = RoaWorldMapRoute.Row(path[i]);
                AddDrapedCell(fill, new Vector2(col * zoneKm, row * zoneKm), zoneKm, RouteFill, RouteLift - 0.01f);
                Vector2 centre = new Vector2((col + 0.5f) * zoneKm, (row + 0.5f) * zoneKm);
                if (i > 0) AddDrapedRibbon(line, previous, centre, 1.4f, RouteColor, RouteLift);
                previous = centre;
            }
            AddMesh(_routeView.transform, "RouteFill", fill, 3003);
            AddMesh(_routeView.transform, "RouteLine", line, 3004);
        }

        public void SetPlayer(Vector2? point)
        {
            if (_playerMarker == null) return;
            _playerMarker.gameObject.SetActive(point.HasValue);
            if (point.HasValue) _playerMarker.localPosition = PointToLocal(point.Value, 0f);
        }

        public void SetSelection(Vector2? point)
        {
            if (_selectionMarker == null) return;
            _selectionMarker.gameObject.SetActive(point.HasValue);
            if (point.HasValue) _selectionMarker.localPosition = PointToLocal(point.Value, 0f);
        }

        /// <summary>Навести камеру на точку карты.</summary>
        public void FocusOn(Vector2 point, float distance = -1f)
        {
            _anchor = PointToLocal(point, 0f);
            if (distance > 0f) _distance = Mathf.Clamp(distance, MinDistance, MaxDistance);
            ApplyCamera();
        }

        // --- камера и ввод --------------------------------------------------------------------------------

        private void LateUpdate()
        {
            if (!IsOpen || _camera == null || _root == null) return;
            if (InputEnabled)
            {
                if (Input.touchSupported && Input.touchCount > 0) UpdateTouch();
                else UpdateMouse();
                UpdateKeys();
            }
            ApplyCamera();
        }

        private void UpdateMouse()
        {
            Vector2 mouse = Input.mousePosition;
            Vector2 delta = mouse - _lastMouse;
            _lastMouse = mouse;
            if (Input.GetMouseButtonDown(0))
            {
                _pressAt = mouse;
                _pressTime = Time.unscaledTime;
                _pressOverUi = OverUi(-1);
                _dragging = false;
            }
            if (Input.GetMouseButton(0) && !_pressOverUi)
            {
                if (!_dragging && (mouse - _pressAt).magnitude > TapPixels) _dragging = true;
                if (_dragging) Pan(delta);
            }
            if (Input.GetMouseButtonUp(0) && !_pressOverUi && !_dragging && Time.unscaledTime - _pressTime <= TapSeconds)
                Pick(mouse);
            if ((Input.GetMouseButton(1) || Input.GetMouseButton(2)) && !OverUi(-1))
            {
                _yaw += delta.x * 0.3f;
                _pitch = Mathf.Clamp(_pitch - delta.y * 0.2f, MinPitch, MaxPitch);
            }
            float scroll = Input.mouseScrollDelta.y;
            if (Mathf.Abs(scroll) > 0.01f && !OverUi(-1)) Zoom(Mathf.Pow(0.88f, scroll));
        }

        private void UpdateTouch()
        {
            if (Input.touchCount == 1)
            {
                Touch touch = Input.GetTouch(0);
                if (touch.phase == TouchPhase.Began)
                {
                    _pressAt = touch.position;
                    _pressTime = Time.unscaledTime;
                    _pressOverUi = OverUi(touch.fingerId);
                    _dragging = false;
                }
                else if (!_pressOverUi && touch.phase == TouchPhase.Moved)
                {
                    if (!_dragging && (touch.position - _pressAt).magnitude > TapPixels * 1.6f) _dragging = true;
                    if (_dragging) Pan(touch.deltaPosition);
                }
                else if (!_pressOverUi && touch.phase == TouchPhase.Ended && !_dragging && Time.unscaledTime - _pressTime <= TapSeconds)
                {
                    Pick(touch.position);
                }
                _pinchDistance = 0f;
                return;
            }
            if (Input.touchCount < 2) return;
            // Два пальца: щипок — масштаб, поворот пальцев — поворот карты, сдвиг вверх-вниз — наклон.
            Touch a = Input.GetTouch(0), b = Input.GetTouch(1);
            _dragging = true;
            float distance = (a.position - b.position).magnitude;
            float angle = Mathf.Atan2(b.position.y - a.position.y, b.position.x - a.position.x) * Mathf.Rad2Deg;
            Vector2 centre = (a.position + b.position) * 0.5f;
            if (_pinchDistance > 1f && a.phase != TouchPhase.Began && b.phase != TouchPhase.Began)
            {
                Zoom(_pinchDistance / Mathf.Max(1f, distance));
                _yaw -= Mathf.DeltaAngle(_pinchAngle, angle);
                _pitch = Mathf.Clamp(_pitch - (centre.y - _pinchCentre.y) * 0.15f, MinPitch, MaxPitch);
            }
            _pinchDistance = distance;
            _pinchAngle = angle;
            _pinchCentre = centre;
        }

        private void UpdateKeys()
        {
            float x = (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow) ? 1f : 0f)
                - (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow) ? 1f : 0f);
            float z = (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow) ? 1f : 0f)
                - (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow) ? 1f : 0f);
            if (Mathf.Abs(x) + Mathf.Abs(z) < 0.01f) return;
            float speed = Mathf.Max(1.5f, _distance * 0.9f) * Time.unscaledDeltaTime;
            Quaternion yaw = Quaternion.Euler(0f, _yaw, 0f);
            _anchor += yaw * new Vector3(x, 0f, z).normalized * speed;
            ClampAnchor();
        }

        /// <summary>Сдвиг карты за пальцем или мышью: экранные пиксели в единицы сцены у земли.</summary>
        private void Pan(Vector2 pixels)
        {
            float unitsPerPixel = 2f * _distance * Mathf.Tan(_camera.fieldOfView * 0.5f * Mathf.Deg2Rad) / Mathf.Max(1, Screen.height);
            Quaternion yaw = Quaternion.Euler(0f, _yaw, 0f);
            float pitchStretch = 1f / Mathf.Max(0.35f, Mathf.Sin(_pitch * Mathf.Deg2Rad));
            _anchor -= yaw * new Vector3(pixels.x * unitsPerPixel, 0f, pixels.y * unitsPerPixel * pitchStretch);
            ClampAnchor();
        }

        private void Zoom(float factor)
        {
            _distance = Mathf.Clamp(_distance * factor, MinDistance, MaxDistance);
        }

        private void ClampAnchor()
        {
            float halfW = _widthKm * 0.5f * WorldScale, halfH = _heightKm * 0.5f * WorldScale;
            _anchor.x = Mathf.Clamp(_anchor.x, -halfW, halfW);
            _anchor.z = Mathf.Clamp(_anchor.z, -halfH, halfH);
            _anchor.y = ReliefAt(LocalToPoint(_anchor));
        }

        private void ApplyCamera()
        {
            if (_camera == null || _root == null) return;
            Quaternion rotation = Quaternion.Euler(_pitch, _yaw, 0f);
            Vector3 target = _root.TransformPoint(_anchor);
            _camera.transform.SetPositionAndRotation(target - rotation * Vector3.forward * _distance, rotation);
        }

        private void Pick(Vector2 screen)
        {
            if (ScreenToPoint(screen, out Vector2 point)) PointPicked?.Invoke(point);
        }

        private static bool OverUi(int pointerId)
        {
            return EventSystem.current != null && EventSystem.current.IsPointerOverGameObject(pointerId);
        }

        // --- сетка --------------------------------------------------------------------------------------

        /// <summary>Клетка зоны, лежащая на рельефе: сетка FillSteps×FillSteps с высотой в каждом узле.</summary>
        private void AddDrapedCell(MeshBuilder mesh, Vector2 corner, float size, Color color, float lift)
        {
            int first = mesh.Vertices.Count;
            for (int j = 0; j <= FillSteps; j++)
            {
                for (int i = 0; i <= FillSteps; i++)
                {
                    Vector2 point = corner + new Vector2(size * i / FillSteps, size * j / FillSteps);
                    mesh.Vertices.Add(PointToLocal(point, lift));
                    mesh.Colors.Add(color);
                }
            }
            int stride = FillSteps + 1;
            for (int j = 0; j < FillSteps; j++)
            {
                for (int i = 0; i < FillSteps; i++)
                {
                    int a = first + j * stride + i;
                    mesh.Triangles.AddRange(new[] { a, a + stride, a + 1, a + 1, a + stride, a + stride + 1 });
                }
            }
        }

        /// <summary>Граница зоны по стороне: сплошная, у открытых ворот — с проёмом посередине.</summary>
        private void AddEdge(MeshBuilder mesh, JObject zone, Dictionary<int, JObject> cells, int col, int row, char side, float size)
        {
            Vector2 a, b;
            switch (side)
            {
                case 'n': a = new Vector2(col * size, row * size); b = new Vector2((col + 1) * size, row * size); break;
                case 's': a = new Vector2(col * size, (row + 1) * size); b = new Vector2((col + 1) * size, (row + 1) * size); break;
                case 'w': a = new Vector2(col * size, row * size); b = new Vector2(col * size, (row + 1) * size); break;
                default: a = new Vector2((col + 1) * size, row * size); b = new Vector2((col + 1) * size, (row + 1) * size); break;
            }
            RoaWorldMapRoute.Step(col, row, side, out int nc, out int nr);
            bool open = RoaWorldMapRoute.IsOpen(zone, side) && cells.ContainsKey(nc * 1000 + nr);
            if (!open)
            {
                AddDrapedRibbon(mesh, a, b, 0.35f, LineColor, LineLift);
                return;
            }
            // Проём ворот — треть стороны посередине.
            AddDrapedRibbon(mesh, a, Vector2.Lerp(a, b, 0.36f), 0.35f, LineColor, LineLift);
            AddDrapedRibbon(mesh, Vector2.Lerp(a, b, 0.64f), b, 0.35f, LineColor, LineLift);
        }

        /// <summary>Лента по рельефу между двумя точками карты; ширина — в километрах.</summary>
        private void AddDrapedRibbon(MeshBuilder mesh, Vector2 from, Vector2 to, float widthKm, Color color, float lift)
        {
            Vector2 along = to - from;
            float length = along.magnitude;
            if (length < 0.01f) return;
            Vector2 side = new Vector2(-along.y, along.x) / length * (widthKm * 0.5f);
            int steps = Mathf.Max(1, Mathf.CeilToInt(length / 2.5f));
            int first = mesh.Vertices.Count;
            for (int i = 0; i <= steps; i++)
            {
                Vector2 at = Vector2.Lerp(from, to, (float)i / steps);
                mesh.Vertices.Add(PointToLocal(at - side, lift));
                mesh.Vertices.Add(PointToLocal(at + side, lift));
                mesh.Colors.Add(color);
                mesh.Colors.Add(color);
            }
            for (int i = 0; i < steps; i++)
            {
                int a = first + i * 2;
                mesh.Triangles.AddRange(new[] { a, a + 2, a + 1, a + 1, a + 2, a + 3 });
            }
        }

        private void AddMesh(Transform parent, string name, MeshBuilder data, int queue)
        {
            if (data.Vertices.Count == 0) return;
            var mesh = new Mesh { name = "WorldMap" + name };
            if (data.Vertices.Count > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(data.Vertices);
            mesh.SetColors(data.Colors);
            mesh.SetTriangles(data.Triangles, 0);
            mesh.RecalculateBounds();
            _meshes.Add(mesh);
            var go = new GameObject(name);
            go.layer = MapLayer;
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = OverlayMaterial(queue);
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        private Material OverlayMaterial(int queue)
        {
            if (_overlayMaterial == null) _overlayMaterial = TransparentMaterial("WorldMapOverlay");
            var material = new Material(_overlayMaterial) { renderQueue = queue };
            _materials.Add(material);
            return material;
        }

        private Transform Marker(string name, Color color, float size)
        {
            var root = new GameObject(name);
            root.layer = MapLayer;
            root.transform.SetParent(_root, false);
            if (_markerMaterial == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
                _markerMaterial = new Material(shader) { name = "WorldMapMarker" };
            }
            var material = new Material(_markerMaterial) { color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            // Флажок: древко и шар над ним — видно при любом масштабе камеры.
            GameObject pole = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            pole.name = "Pole";
            Discard(pole.GetComponent<Collider>());
            pole.layer = MapLayer;
            pole.transform.SetParent(root.transform, false);
            pole.transform.localScale = new Vector3(size * 0.12f, size * 1.6f, size * 0.12f);
            pole.transform.localPosition = new Vector3(0f, size * 1.6f, 0f);
            pole.GetComponent<Renderer>().sharedMaterial = material;
            GameObject head = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            head.name = "Head";
            Discard(head.GetComponent<Collider>());
            head.layer = MapLayer;
            head.transform.SetParent(root.transform, false);
            head.transform.localScale = Vector3.one * size;
            head.transform.localPosition = new Vector3(0f, size * 3.3f, 0f);
            head.GetComponent<Renderer>().sharedMaterial = material;
            return root.transform;
        }

        private static Material TransparentMaterial(string name)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Particles/Unlit")
                ?? Shader.Find("Sprites/Default")
                ?? Shader.Find("Unlit/Transparent");
            var material = new Material(shader) { name = name };
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            if (material.HasProperty("_Color")) material.SetColor("_Color", Color.white);
            if (material.HasProperty("_ColorMode")) material.SetFloat("_ColorMode", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.EnableKeyword("_ALPHABLEND_ON");
            material.DisableKeyword("_ALPHATEST_ON");
            material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            return material;
        }

        /// <summary>Удаление и в игре, и в пробах редактора (там Destroy запрещён).</summary>
        private static void Discard(UnityEngine.Object target)
        {
            if (target == null) return;
            if (Application.isPlaying) Destroy(target);
            else DestroyImmediate(target);
        }

        private static Transform FindDeep(Transform root, string name)
        {
            foreach (Transform node in root.GetComponentsInChildren<Transform>(true))
                if (node.name == name) return node;
            return null;
        }

        private void ReleaseOverlays()
        {
            if (_zonesView != null) Destroy(_zonesView);
            if (_routeView != null) Destroy(_routeView);
            _zonesView = _routeView = null;
            foreach (Mesh mesh in _meshes) if (mesh != null) Destroy(mesh);
            _meshes.Clear();
            foreach (Material material in _materials) if (material != null) Destroy(material);
            _materials.Clear();
        }

        private void OnDestroy()
        {
            ReleaseOverlays();
            if (_overlayMaterial != null) Destroy(_overlayMaterial);
            if (_markerMaterial != null) Destroy(_markerMaterial);
        }

        private sealed class MeshBuilder
        {
            public readonly List<Vector3> Vertices = new List<Vector3>();
            public readonly List<Color> Colors = new List<Color>();
            public readonly List<int> Triangles = new List<int>();
        }
    }
}
