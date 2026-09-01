using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaCombatPresentationFx
    {
        private const float DamageFeedbackLife = 0.62f;

        private Canvas _damageCanvas;
        private RawImage _damageOverlay;
        private RawImage _damageDirection;
        private Texture2D _damageDirectionTexture;
        private Vector3 _damageSourceWorld;
        private Vector3 _damageTargetWorld;
        private bool _damageHasDirection;

        public bool DamageCanvasReady { get { return _damageCanvas != null && _damageOverlay != null; } }
        public bool DamageDirectionVisible
        {
            get { return _damageDirection != null && _damageDirection.gameObject.activeSelf; }
        }

        public void PlayDamagePulse(int damage, Vector3 targetWorld, Vector3 sourceWorld)
        {
            float strength = Mathf.Lerp(0.28f, 0.82f, Mathf.InverseLerp(2f, 55f, damage));
            _damageStrength = Mathf.Max(_damageStrength, strength);
            _damageStarted = Time.unscaledTime;
            _damageTargetWorld = targetWorld;
            _damageSourceWorld = sourceWorld;
            Vector3 delta = sourceWorld - targetWorld;
            delta.y = 0f;
            _damageHasDirection = delta.sqrMagnitude > 0.12f * 0.12f;
            EnsureDamageCanvas();
            CameraRig?.AddImpulse(Mathf.Lerp(0.045f, 0.14f, strength));
        }

        private void EnsureDamageCanvas()
        {
            if (_damageCanvas != null) return;
            if (_damageVignette == null) _damageVignette = CreateDamageVignette();
            if (_damageDirectionTexture == null) _damageDirectionTexture = CreateDamageDirectionTexture();

            var root = new GameObject("CombatDamageFeedback", typeof(RectTransform), typeof(Canvas),
                                      typeof(CanvasScaler));
            root.transform.SetParent(transform, false);
            _damageCanvas = root.GetComponent<Canvas>();
            _damageCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _damageCanvas.sortingOrder = 65;
            RoaUiScale.Apply(root.GetComponent<CanvasScaler>());

            var overlay = new GameObject("Vignette", typeof(RectTransform), typeof(RawImage));
            overlay.transform.SetParent(root.transform, false);
            RectTransform overlayRect = (RectTransform)overlay.transform;
            overlayRect.anchorMin = Vector2.zero;
            overlayRect.anchorMax = Vector2.one;
            overlayRect.offsetMin = Vector2.zero;
            overlayRect.offsetMax = Vector2.zero;
            _damageOverlay = overlay.GetComponent<RawImage>();
            _damageOverlay.texture = _damageVignette;
            _damageOverlay.color = new Color(1f, 1f, 1f, 0f);
            _damageOverlay.raycastTarget = false;

            var direction = new GameObject("SourceDirection", typeof(RectTransform), typeof(RawImage));
            direction.transform.SetParent(root.transform, false);
            RectTransform directionRect = (RectTransform)direction.transform;
            directionRect.anchorMin = directionRect.anchorMax = new Vector2(0.5f, 0.5f);
            directionRect.pivot = new Vector2(0.5f, 0.5f);
            directionRect.sizeDelta = new Vector2(104f, 64f);
            _damageDirection = direction.GetComponent<RawImage>();
            _damageDirection.texture = _damageDirectionTexture;
            _damageDirection.raycastTarget = false;
            direction.SetActive(false);
            root.SetActive(false);
        }

        private void UpdateDamageFeedback(float now)
        {
            if (_damageStrength <= 0.001f)
            {
                ClearDamageFeedback();
                return;
            }

            float t = (now - _damageStarted) / DamageFeedbackLife;
            if (t >= 1f)
            {
                _damageStrength = 0f;
                ClearDamageFeedback();
                return;
            }

            EnsureDamageCanvas();
            bool show = !RoaGameBootstrap.BlocksWorldHud;
            if (_damageCanvas.gameObject.activeSelf != show) _damageCanvas.gameObject.SetActive(show);
            if (!show) return;

            float fade = (1f - t) * (1f - t);
            float heartbeat = 0.88f + Mathf.Sin(t * Mathf.PI * 5f) * 0.12f;
            _damageOverlay.color = new Color(1f, 1f, 1f, _damageStrength * fade * heartbeat);

            Vector2 direction = Vector2.zero;
            Camera camera = CameraRig != null ? CameraRig.GetComponent<Camera>() : Camera.main;
            bool directional = _damageHasDirection
                && TryDamageScreenDirection(camera, _damageTargetWorld, _damageSourceWorld, out direction);
            if (_damageDirection.gameObject.activeSelf != directional)
                _damageDirection.gameObject.SetActive(directional);
            if (!directional) return;

            RectTransform rect = _damageDirection.rectTransform;
            float scale = Mathf.Max(0.01f, _damageCanvas.scaleFactor);
            float radius = Mathf.Min(Screen.width, Screen.height) * 0.235f / scale;
            rect.anchoredPosition = direction * radius;
            float angle = Mathf.Atan2(direction.y, direction.x) * Mathf.Rad2Deg - 90f;
            rect.localRotation = Quaternion.Euler(0f, 0f, angle);
            rect.localScale = Vector3.one * Mathf.Lerp(1.12f, 0.92f, t);
            _damageDirection.color = new Color(1f, 0.74f, 0.52f,
                Mathf.Clamp01(_damageStrength * 1.28f) * Mathf.Sqrt(fade));
        }

        private void ClearDamageFeedback()
        {
            if (_damageOverlay != null) _damageOverlay.color = new Color(1f, 1f, 1f, 0f);
            if (_damageDirection != null && _damageDirection.gameObject.activeSelf)
                _damageDirection.gameObject.SetActive(false);
            if (_damageCanvas != null && _damageCanvas.gameObject.activeSelf)
                _damageCanvas.gameObject.SetActive(false);
        }

        private void DestroyDamageCanvas()
        {
            if (_damageCanvas != null) DestroyOwnedObject(_damageCanvas.gameObject);
            _damageCanvas = null;
            _damageOverlay = null;
            _damageDirection = null;
            DestroyOwnedObject(_damageDirectionTexture);
            _damageDirectionTexture = null;
        }

        public static bool TryDamageScreenDirection(Camera camera, Vector3 targetWorld,
                                                    Vector3 sourceWorld, out Vector2 direction)
        {
            direction = Vector2.zero;
            if (camera == null) return false;
            Vector3 delta = sourceWorld - targetWorld;
            delta.y = 0f;
            if (delta.sqrMagnitude < 0.12f * 0.12f) return false;
            direction = new Vector2(Vector3.Dot(delta, camera.transform.right),
                                    Vector3.Dot(delta, camera.transform.up));
            if (direction.sqrMagnitude < 0.0001f) return false;
            direction.Normalize();
            return true;
        }

        private static Texture2D CreateDamageDirectionTexture()
        {
            const int width = 96;
            const int height = 64;
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false, true)
            {
                name = "ProceduralDamageDirection",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp
            };
            var pixels = new Color32[width * height];
            Vector2 tip = new Vector2(0f, 0.72f);
            Vector2 left = new Vector2(-0.72f, -0.42f);
            Vector2 right = new Vector2(0.72f, -0.42f);
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    Vector2 point = new Vector2((x + 0.5f) / width * 2f - 1f,
                                                (y + 0.5f) / height * 2f - 1f);
                    float distance = Mathf.Min(DistanceToSegment(point, tip, left),
                                               DistanceToSegment(point, tip, right));
                    float stroke = Mathf.InverseLerp(0.19f, 0.055f, distance);
                    float alpha = stroke * stroke * (3f - 2f * stroke);
                    float tipGlow = Mathf.Clamp01(1f - Vector2.Distance(point, tip) / 0.30f) * 0.18f;
                    alpha = Mathf.Clamp01(alpha + tipGlow);
                    pixels[y * width + x] = new Color32(255, 125, 72,
                        (byte)Mathf.RoundToInt(alpha * 255f));
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            return texture;
        }

        private static float DistanceToSegment(Vector2 point, Vector2 start, Vector2 end)
        {
            Vector2 segment = end - start;
            float length = segment.sqrMagnitude;
            if (length <= 0.0001f) return Vector2.Distance(point, start);
            float t = Mathf.Clamp01(Vector2.Dot(point - start, segment) / length);
            return Vector2.Distance(point, start + segment * t);
        }
    }
}
