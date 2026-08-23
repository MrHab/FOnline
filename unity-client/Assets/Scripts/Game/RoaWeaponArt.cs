using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Силуэт оружия для центра оружейной консоли.
    ///
    /// Web показывает там инлайн-SVG на каждый ствол (itemArtHtml). SVG в Unity
    /// нет, зато есть сами GLB-модели оружия — те же, что держит персонаж.
    /// Модель рендерится один раз в RenderTexture камерой на служебном слое
    /// и дальше живёт как обычная текстура; смена оружия — новый рендер.
    ///
    /// Сцена спрятана на Y = −10500: слой у неё общий с превью персонажа (31),
    /// но обе камеры близорукие (far 20 м), и на таком расстоянии друг друга
    /// они не видят.
    /// </summary>
    public sealed class RoaWeaponArt : MonoBehaviour
    {
        public string BaseUrl = "http://127.0.0.1:3000";

        private const float SceneY = -10500f;
        private const int Width = 512;
        private const int Height = 192;

        private Transform _sceneRoot;
        private Camera _camera;
        private RenderTexture _texture;
        private GameObject _model;
        private string _loadedWeaponId = string.Empty;
        private string _loadingWeaponId = string.Empty;

        /// <summary>Готовый кадр; null, пока оружие без модели (кулаки) или грузится.</summary>
        public Texture ArtTexture { get; private set; }

        /// <summary>Показать оружие. Пустой id и кулаки гасят арт.</summary>
        public void Show(string weaponId)
        {
            weaponId = weaponId ?? string.Empty;
            if (weaponId == _loadedWeaponId || weaponId == _loadingWeaponId) return;

            if (string.IsNullOrEmpty(weaponId) || weaponId == "fists")
            {
                Clear(weaponId);
                return;
            }

            _loadingWeaponId = weaponId;
            _ = LoadAndRender(weaponId);
        }

        private void Clear(string weaponId)
        {
            if (_model != null) Destroy(_model);
            _model = null;
            ArtTexture = null;
            _loadedWeaponId = weaponId;
            _loadingWeaponId = string.Empty;
        }

        private async Task LoadAndRender(string weaponId)
        {
            EnsureScene();

            string url = BaseUrl.TrimEnd('/') + "/assets/models/weapons/weapon_" + weaponId + ".glb";
            var import = new GltfImport();

            if (!await import.Load(RoaModelUrl.Lite(url)))
            {
                // Нет модели — нет арта; консоль переживёт, но след в логе обязателен.
                Debug.LogWarning("[ROA] Арт оружия не загрузился: " + url);
                import.Dispose();
                if (_loadingWeaponId == weaponId) Clear(weaponId);
                return;
            }

            // Пока грузили, оружие могли сменить ещё раз — этот рендер уже никому не нужен.
            if (_loadingWeaponId != weaponId) { import.Dispose(); return; }

            if (_model != null) Destroy(_model);
            _model = new GameObject("WeaponArt:" + weaponId);
            _model.transform.SetParent(_sceneRoot, false);

            if (!await import.InstantiateMainSceneAsync(_model.transform))
            {
                Debug.LogWarning("[ROA] Арт оружия не создан: " + weaponId);
                import.Dispose();
                if (_loadingWeaponId == weaponId) Clear(weaponId);
                return;
            }

            SetLayerRecursively(_model, RoaCharacterPreview.PreviewLayer);
            FrameAndRender();

            _loadedWeaponId = weaponId;
            _loadingWeaponId = string.Empty;
            import.Dispose();
        }

        /// <summary>
        /// Поставить модель в профиль и отрендерить один кадр.
        ///
        /// Оружие в GLB лежит стволом вдоль Z (в руках персонаж смотрит по +Z),
        /// а камера сцены смотрит с +X — значит без поворота модель видна сбоку,
        /// в полный профиль. Первый вариант поворачивал её на 90° и рисовал
        /// ствол В ТОРЕЦ: на скриншоте от винтовки оставалась точка.
        /// Экранное «вправо» у этой камеры — мировой −Z, поэтому для позы
        /// «стволом вправо», как на web-артах, модель разворачивается на 180°.
        /// </summary>
        private void FrameAndRender()
        {
            _model.transform.localPosition = Vector3.zero;
            _model.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);

            Bounds bounds = ComputeBounds(_model);
            if (bounds.size.sqrMagnitude < 0.000001f)
            {
                Debug.LogWarning("[ROA] У модели оружия нет рендереров — арт пуст.");
                return;
            }

            // Центрируем модель относительно корня сцены.
            _model.transform.localPosition = -(bounds.center - _sceneRoot.position);

            // orthographicSize — половина ВЫСОТЫ кадра; ширина = size × aspect.
            // Вписываем и длину ствола (ось Z в мире → горизонталь кадра),
            // и высоту оружия, с небольшим полем.
            float aspect = (float)Width / Height;
            float halfLength = Mathf.Max(bounds.extents.z, bounds.extents.x);
            float halfHeight = bounds.extents.y;
            _camera.orthographicSize = Mathf.Max(0.03f,
                Mathf.Max(halfHeight * 1.25f, halfLength * 1.1f / aspect));
            _camera.Render();

            ArtTexture = _texture;
        }

        private static Bounds ComputeBounds(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) return new Bounds(root.transform.position, Vector3.zero);

            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private void EnsureScene()
        {
            if (_sceneRoot != null) return;

            var root = new GameObject("WeaponArtScene");
            root.transform.SetParent(transform, false);
            root.transform.position = new Vector3(0f, SceneY, 0f);
            _sceneRoot = root.transform;

            var cameraObject = new GameObject("WeaponArtCamera");
            cameraObject.transform.SetParent(_sceneRoot, false);
            cameraObject.transform.localPosition = new Vector3(3f, 0f, 0f);
            cameraObject.transform.LookAt(_sceneRoot.position);
            cameraObject.layer = RoaCharacterPreview.PreviewLayer;

            _camera = cameraObject.AddComponent<Camera>();
            _camera.enabled = false;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
            _camera.orthographic = true;
            _camera.nearClipPlane = 0.05f;
            _camera.farClipPlane = 20f;
            _camera.cullingMask = 1 << RoaCharacterPreview.PreviewLayer;

            var lightObject = new GameObject("WeaponArtLight");
            lightObject.transform.SetParent(_sceneRoot, false);
            lightObject.transform.localPosition = new Vector3(2.2f, 2.6f, -1.4f);
            lightObject.transform.LookAt(_sceneRoot.position);
            lightObject.layer = RoaCharacterPreview.PreviewLayer;
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(1f, 0.9f, 0.72f);
            light.intensity = 1.5f;
            light.shadows = LightShadows.None;
            light.cullingMask = 1 << RoaCharacterPreview.PreviewLayer;

            _texture = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32)
            {
                name = "RoaWeaponArt",
                useMipMap = false,
                autoGenerateMips = false
            };
            _texture.Create();
            _camera.targetTexture = _texture;
        }

        private static void SetLayerRecursively(GameObject root, int layer)
        {
            root.layer = layer;
            foreach (Transform child in root.transform) SetLayerRecursively(child.gameObject, layer);
        }

        private void OnDestroy()
        {
            if (_texture != null)
            {
                _texture.Release();
                Destroy(_texture);
            }
        }
    }
}
