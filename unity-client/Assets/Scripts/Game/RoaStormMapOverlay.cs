using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Буря выброса поверх плоской карты: миникарта и карта локации (кадр — сцена
    /// игрока, через рамку бури) и кадр зоны в окне карты мира (кадр — квадрат
    /// карты). Каждый пиксель слоя спрашивает у RoaRadiationStormPath, что над
    /// его точкой карты, поэтому фронт здесь стоит там же, где стена в сцене и
    /// полоса на 3D-карте. Слой — дочерний RawImage на весь родитель: поворот и
    /// масштаб миникарты он получает от родителя.
    /// </summary>
    [RequireComponent(typeof(RawImage))]
    public sealed class RoaStormMapOverlay : MonoBehaviour
    {
        private const int Pixels = 64;
        private const float RefreshSeconds = 0.2f;

        private static readonly Color32 Clear = new Color32(0, 0, 0, 0);

        private bool _mapArea;
        private Vector2 _cornerKm;
        private float _sizeKm = 20f;
        private RawImage _image;
        private Texture2D _texture;
        private Color32[] _pixels;
        private float _nextAt;

        /// <summary>Слой бури во весь родитель, поверх его картинки и под его дочерними метками.</summary>
        public static RoaStormMapOverlay Attach(RectTransform parent, string name = "StormOverlay")
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(RawImage));
            go.transform.SetParent(parent, false);
            var rect = (RectTransform)go.transform;
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.offsetMin = rect.offsetMax = Vector2.zero;
            var image = go.GetComponent<RawImage>();
            image.raycastTarget = false;
            image.enabled = false;
            return go.AddComponent<RoaStormMapOverlay>();
        }

        /// <summary>Кадр — сцена игрока: u — на восток (+X), v — вверх (+Z), как у снимка миникарты.</summary>
        public void ShowScene()
        {
            _mapArea = false;
            _nextAt = 0f;
        }

        /// <summary>Кадр — квадрат карты мира: corner — северо-западный угол (км), верх кадра — север.</summary>
        public void ShowMapArea(Vector2 cornerKm, float sizeKm)
        {
            _mapArea = true;
            _cornerKm = cornerKm;
            _sizeKm = Mathf.Max(0.1f, sizeKm);
            _nextAt = 0f;
        }

        private void Awake()
        {
            _image = GetComponent<RawImage>();
        }

        private void OnDestroy()
        {
            if (_texture != null) Destroy(_texture);
        }

        private void LateUpdate()
        {
            if (Time.unscaledTime < _nextAt) return;
            _nextAt = Time.unscaledTime + RefreshSeconds;
            RoaRadiationStorm storm = RoaRadiationStorm.Active;
            bool drawn = storm != null && storm.Path != null && Paint(storm);
            if (_image.enabled != drawn) _image.enabled = drawn;
        }

        private bool Paint(RoaRadiationStorm storm)
        {
            RoaRadiationStormPath path = storm.Path;
            RoaRadiationStormFrame frame = storm.Frame;
            float width = 0f, depth = 0f, kmPerPixel;
            if (_mapArea) kmPerPixel = _sizeKm / Pixels;
            else
            {
                RoaGameBootstrap bootstrap = RoaGameBootstrap.Active;
                var location = bootstrap != null && bootstrap.Loader != null ? bootstrap.Loader.Current : null;
                if (location == null || !storm.FrameMatchesScene) return false;
                width = location.WorldWidth;
                depth = location.WorldDepth;
                if (width <= 0f || depth <= 0f) return false;
                kmPerPixel = width * (float)System.Math.Abs(frame.Kx) / Pixels;
            }
            EnsureTexture();
            double now = storm.ServerNowMs;
            bool any = false;
            for (int j = 0; j < Pixels; j++)
            {
                float v = (j + 0.5f) / Pixels;
                for (int i = 0; i < Pixels; i++)
                {
                    float u = (i + 0.5f) / Pixels;
                    Vector2 point = _mapArea
                        ? new Vector2(_cornerKm.x + u * _sizeKm, _cornerKm.y + (1f - v) * _sizeKm)
                        : frame.LocalToGlobal((u - 0.5f) * width, (v - 0.5f) * depth);
                    Color32 tone = Tone(path.SampleAt(point.x, point.y, now), kmPerPixel);
                    _pixels[j * Pixels + i] = tone;
                    if (tone.a > 0) any = true;
                }
            }
            if (!any) return false;
            _texture.SetPixels32(_pixels);
            _texture.Apply(false);
            _image.texture = _texture;
            _image.color = Color.white;
            return true;
        }

        /// <summary>
        /// Цвет точки: внутри бури — зелёная муть гуще к стене, передняя кромка —
        /// яркая линия в пару пикселей, перед ней — слабое свечение подхода.
        /// </summary>
        public static Color32 Tone(RoaRadiationStormPath.Sample sample, float kmPerPixel)
        {
            float edge = Mathf.Max(0.05f, kmPerPixel * 1.6f);
            if (sample.Inside)
            {
                if (sample.DepthKm < edge) return new Color32(196, 255, 120, 235);
                byte alpha = (byte)Mathf.RoundToInt(Mathf.Lerp(70f, 150f, sample.Intensity));
                return new Color32(118, 176, 58, alpha);
            }
            if (sample.AheadKm > 0d)
            {
                if (sample.AheadKm < edge) return new Color32(196, 255, 120, 160);
                float glow = 1f - Mathf.Clamp01((float)(sample.AheadKm / Mathf.Max(edge * 5f, 2.5f)));
                return glow > 0.02f ? new Color32(214, 236, 110, (byte)Mathf.RoundToInt(55f * glow)) : Clear;
            }
            float tail = 1f - Mathf.Clamp01((float)(sample.BehindKm / Mathf.Max(edge * 3f, 1.5f)));
            return tail > 0.02f ? new Color32(118, 150, 70, (byte)Mathf.RoundToInt(60f * tail)) : Clear;
        }

        private void EnsureTexture()
        {
            if (_texture != null) return;
            _texture = new Texture2D(Pixels, Pixels, TextureFormat.RGBA32, false)
            {
                name = "StormMapOverlay",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear
            };
            _pixels = new Color32[Pixels * Pixels];
        }
    }
}
