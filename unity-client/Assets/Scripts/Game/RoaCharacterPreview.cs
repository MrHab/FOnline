using System;
using System.Threading.Tasks;
using RealmOfAshes.Net;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Live GLB preview used by the character creator. The preview has its own
    /// camera, render texture and lights, and lives far outside the playable
    /// world on an isolated layer so it cannot leak into the game camera.
    /// </summary>
    public sealed class RoaCharacterPreview : MonoBehaviour
    {
        public const int PreviewLayer = 31;
        private const float PreviewWorldY = -10000f;
        private const int MinimumTextureSide = 220;
        private const int MaximumTextureSide = 640;

        private Transform _sceneRoot;
        private Camera _camera;
        private RenderTexture _texture;
        private GameObject _modelObject;
        private RoaCharacterView _view;
        private CharacterAppearance _wantedAppearance;
        private string _wantedFingerprint = string.Empty;
        private string _loadingModelKey = string.Empty;
        private int _requestId;
        private bool _visible;
        private float _pointerOffset;
        private bool _pointerActive;

        public RenderTexture Texture { get { return _texture; } }
        public string StatusText { get; private set; } = string.Empty;
        public bool IsReady { get { return _view != null && _view.Ready; } }
        public bool IsVisible { get { return _visible; } }
        public string RequestedModelKey { get { return ModelKey(_wantedAppearance); } }

        public void Show(string baseUrl, CharacterAppearance appearance, int width, int height)
        {
            _visible = true;
            EnsureScene();
            EnsureTexture(width, height);
            if (_sceneRoot != null && !_sceneRoot.gameObject.activeSelf)
                _sceneRoot.gameObject.SetActive(true);

            if (appearance == null)
            {
                StatusText = "Внешность не выбрана.";
                return;
            }

            string fingerprint = Fingerprint(appearance);
            if (fingerprint == _wantedFingerprint) return;

            _wantedAppearance = Clone(appearance);
            _wantedFingerprint = fingerprint;
            string modelKey = ModelKey(_wantedAppearance);

            if (_view != null && _view.Ready && _view.BodyKey == modelKey
                && _view.ApplyAppearance(_wantedAppearance))
            {
                StatusText = AppearanceLabel(_wantedAppearance);
                return;
            }

            // Several face/hair clicks can arrive while the same body is loading.
            // Keep the latest draft and apply it when that one request completes.
            if (!string.IsNullOrEmpty(_loadingModelKey) && _loadingModelKey == modelKey)
            {
                StatusText = "Загрузка: " + AppearanceLabel(_wantedAppearance) + "…";
                return;
            }

            StartModelLoad((baseUrl ?? string.Empty).TrimEnd('/'), modelKey);
        }

        public void SetVisible(bool visible)
        {
            if (visible)
            {
                _visible = true;
                if (_sceneRoot != null) _sceneRoot.gameObject.SetActive(true);
                return;
            }
            if (!_visible && _modelObject == null && string.IsNullOrEmpty(_loadingModelKey)) return;

            _visible = false;
            _requestId++;
            _loadingModelKey = string.Empty;
            _wantedFingerprint = string.Empty;
            _wantedAppearance = null;
            StatusText = string.Empty;
            DestroyModel();
            if (_sceneRoot != null) _sceneRoot.gameObject.SetActive(false);
        }

        private string _equipmentSignature = string.Empty;

        /// <summary>Надеть на превью-модель экипировку (панель персонажа PIP-ASH); повтор с тем же набором — без запроса.</summary>
        public void ApplyEquipment(string baseUrl, JObject equipment)
        {
            if (!IsReady || equipment == null) return;
            string signature = equipment.ToString(Newtonsoft.Json.Formatting.None) + "|" + _view.GetEntityId();
            if (signature == _equipmentSignature) return;
            _equipmentSignature = signature;
            _ = ApplyEquipmentAsync((baseUrl ?? string.Empty).TrimEnd('/'), equipment);
        }

        private async Task ApplyEquipmentAsync(string baseUrl, JObject equipment)
        {
            RoaCharacterView view = _view;
            await view.EquipItems(baseUrl, equipment);
            // Меши экипировки создаются после загрузки модели — переводим их на слой превью,
            // иначе камера превью их не видит (cullingMask), а модель остаётся в белье.
            if (this != null && _modelObject != null && view == _view) SetLayerRecursively(_modelObject, PreviewLayer);
        }

        /// <summary>Угол обзора камеры превью: больше — фигура мельче (панель персонажа PIP-ASH).</summary>
        public float FieldOfView
        {
            get { return _camera != null ? _camera.fieldOfView : 28f; }
            set { EnsureScene(); if (_camera != null) _camera.fieldOfView = value; }
        }

        public void SetPointer(float normalizedX, bool active)
        {
            _pointerActive = active;
            _pointerOffset = active ? Mathf.Clamp(normalizedX, -1f, 1f) * 20f : 0f;
        }

        public bool RenderNow()
        {
            if (!_visible || _camera == null || _texture == null || !IsReady) return false;
            _camera.targetTexture = _texture;
            if (GraphicsSettings.currentRenderPipeline != null)
            {
                var request = new RenderPipeline.StandardRequest { destination = _texture };
                RenderPipeline.SubmitRenderRequest(_camera, request);
            }
            else _camera.Render();
            return true;
        }

        public static Vector2Int TextureSize(int width, int height)
        {
            return new Vector2Int(
                Mathf.Clamp(width, MinimumTextureSide, MaximumTextureSide),
                Mathf.Clamp(height, MinimumTextureSide, MaximumTextureSide));
        }

        private void LateUpdate()
        {
            if (!_visible || !IsReady) return;
            if (_modelObject != null)
            {
                float idle = _pointerActive ? 0f : Mathf.Sin(Time.unscaledTime * 0.55f) * 4.5f;
                float cameraYaw = Mathf.Atan2(2.45f, 3.15f) * Mathf.Rad2Deg;
                float target = cameraYaw + _pointerOffset + idle;
                Vector3 euler = _modelObject.transform.localEulerAngles;
                euler.y = Mathf.MoveTowardsAngle(euler.y, target, Time.unscaledDeltaTime * 90f);
                _modelObject.transform.localEulerAngles = euler;
            }
            RenderNow();
        }

        private void OnDestroy()
        {
            _requestId++;
            DestroyModel();
            ReleaseTexture();
        }

        private void StartModelLoad(string baseUrl, string modelKey)
        {
            int request = ++_requestId;
            _loadingModelKey = modelKey;
            StatusText = "Загрузка: " + AppearanceLabel(_wantedAppearance) + "…";
            DestroyModel();
            _ = LoadModel(baseUrl, modelKey, request);
        }

        private async Task LoadModel(string baseUrl, string modelKey, int request)
        {
            GameObject candidate = null;
            try
            {
                candidate = new GameObject("CharacterPreviewModel");
                candidate.transform.SetParent(_sceneRoot, false);
                SetLayerRecursively(candidate, PreviewLayer);
                RoaCharacterView candidateView = candidate.AddComponent<RoaCharacterView>();
                await candidateView.Load(baseUrl, ToJson(_wantedAppearance));

                if (this == null || request != _requestId || ModelKey(_wantedAppearance) != modelKey)
                {
                    DisposeObject(candidate);
                    return;
                }
                if (!candidateView.Ready)
                {
                    StatusText = "Не удалось загрузить модель.";
                    _loadingModelKey = string.Empty;
                    DisposeObject(candidate);
                    return;
                }

                _modelObject = candidate;
                _view = candidateView;
                candidate = null;
                SetLayerRecursively(_modelObject, PreviewLayer);
                _view.ApplyAppearance(_wantedAppearance);
                float cameraYaw = Mathf.Atan2(2.45f, 3.15f) * Mathf.Rad2Deg;
                _modelObject.transform.localRotation = Quaternion.Euler(0f, cameraYaw, 0f);
                _loadingModelKey = string.Empty;
                StatusText = AppearanceLabel(_wantedAppearance);
            }
            catch (Exception error)
            {
                if (this != null && request == _requestId)
                {
                    _loadingModelKey = string.Empty;
                    StatusText = "Не удалось загрузить модель.";
                    Debug.LogError("[ROA] Предпросмотр персонажа: " + error);
                }
                if (candidate != null) DisposeObject(candidate);
            }
        }

        private void EnsureScene()
        {
            if (_sceneRoot != null) return;

            GameObject root = new GameObject("CharacterPreviewScene");
            root.transform.SetParent(transform, false);
            root.transform.position = new Vector3(0f, PreviewWorldY, 0f);
            _sceneRoot = root.transform;
            SetLayerRecursively(root, PreviewLayer);

            GameObject cameraObject = new GameObject("CharacterPreviewCamera");
            cameraObject.transform.SetParent(_sceneRoot, false);
            cameraObject.transform.localPosition = new Vector3(2.45f, 1.45f, 3.15f);
            cameraObject.transform.LookAt(_sceneRoot.position + new Vector3(0f, 0.92f, 0f));
            cameraObject.layer = PreviewLayer;
            _camera = cameraObject.AddComponent<Camera>();
            _camera.enabled = false;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = new Color(0.025f, 0.03f, 0.027f, 0f);
            _camera.fieldOfView = 28f;
            _camera.nearClipPlane = 0.05f;
            _camera.farClipPlane = 20f;
            _camera.allowHDR = true;
            _camera.allowMSAA = false;
            _camera.cullingMask = 1 << PreviewLayer;

            CreateLight("CharacterPreviewKey", new Vector3(-2.6f, 4.2f, 2.8f),
                new Color(1f, 0.84f, 0.61f), 1.65f);
            CreateLight("CharacterPreviewFill", new Vector3(2.4f, 2.2f, -2.1f),
                new Color(0.55f, 0.66f, 0.74f), 0.92f);
            CreateLight("CharacterPreviewRim", new Vector3(0f, 2.4f, -3f),
                new Color(0.84f, 0.48f, 0.31f), 0.72f);
        }

        private void CreateLight(string name, Vector3 localPosition, Color color, float intensity)
        {
            GameObject lightObject = new GameObject(name);
            lightObject.transform.SetParent(_sceneRoot, false);
            lightObject.transform.localPosition = localPosition;
            lightObject.transform.LookAt(_sceneRoot.position + new Vector3(0f, 0.9f, 0f));
            lightObject.layer = PreviewLayer;
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.shadows = LightShadows.None;
            light.cullingMask = 1 << PreviewLayer;
        }

        private void EnsureTexture(int width, int height)
        {
            Vector2Int size = TextureSize(width, height);
            if (_texture != null && _texture.width == size.x && _texture.height == size.y) return;

            ReleaseTexture();
            _texture = new RenderTexture(size.x, size.y, 24, RenderTextureFormat.ARGB32)
            {
                name = "RoaCharacterPreview",
                antiAliasing = 1,
                useMipMap = false,
                autoGenerateMips = false
            };
            _texture.Create();
            if (_camera != null) _camera.targetTexture = _texture;
        }

        private void ReleaseTexture()
        {
            if (_texture == null) return;
            if (_camera != null && _camera.targetTexture == _texture) _camera.targetTexture = null;
            _texture.Release();
            DisposeObject(_texture);
            _texture = null;
        }

        private void DestroyModel()
        {
            if (_modelObject != null) DisposeObject(_modelObject);
            _modelObject = null;
            _view = null;
        }

        private static void SetLayerRecursively(GameObject root, int layer)
        {
            if (root == null) return;
            foreach (Transform child in root.GetComponentsInChildren<Transform>(true))
                child.gameObject.layer = layer;
        }

        private static Newtonsoft.Json.Linq.JObject ToJson(CharacterAppearance appearance)
        {
            return appearance != null
                ? Newtonsoft.Json.Linq.JObject.FromObject(appearance)
                : new Newtonsoft.Json.Linq.JObject();
        }

        private static CharacterAppearance Clone(CharacterAppearance appearance)
        {
            return new CharacterAppearance
            {
                Schema = appearance.Schema,
                Sex = appearance.Sex,
                BodyType = appearance.BodyType,
                FaceId = appearance.FaceId,
                HairId = appearance.HairId,
                SkinToneId = appearance.SkinToneId,
                HairColorId = appearance.HairColorId
            };
        }

        private static string Fingerprint(CharacterAppearance appearance)
        {
            return appearance == null ? string.Empty : string.Join(":", new[]
            {
                appearance.Sex ?? string.Empty,
                appearance.BodyType ?? string.Empty,
                appearance.FaceId ?? string.Empty,
                appearance.HairId ?? string.Empty,
                appearance.SkinToneId ?? string.Empty,
                appearance.HairColorId ?? string.Empty
            });
        }

        private static string ModelKey(CharacterAppearance appearance)
        {
            return appearance == null ? string.Empty
                : RoaCharacterView.ModelKey(ToJson(appearance));
        }

        private static string AppearanceLabel(CharacterAppearance appearance)
        {
            if (appearance == null) return string.Empty;
            string sex = appearance.Sex == "female" ? "Женский" : "Мужской";
            string body = appearance.BodyType == "slim" ? "стройное"
                : appearance.BodyType == "large" ? "крепкое" : "среднее";
            return sex + " · " + body + " телосложение";
        }

        private static void DisposeObject(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
