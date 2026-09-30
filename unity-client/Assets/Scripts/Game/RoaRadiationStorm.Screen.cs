using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Буря на экране. Камера смотрит почти сверху и видит мир метров на пятнадцать
    /// вперёд: стена бури попадает в кадр только в последние секунды. Поэтому
    /// подход виден свечением с тех краёв экрана, откуда идёт стена, а под бурей
    /// кадр затягивает летящая пылевая муть (два слоя шума, сносимых ветром бури).
    /// Слой лежит под HUD и прячется, когда открыто окно поверх мира.
    /// </summary>
    public sealed partial class RoaRadiationStorm
    {
        private const int HazePixels = 128;

        private static readonly Vector2[] EdgeNormals = { Vector2.up, Vector2.down, Vector2.left, Vector2.right };

        private Canvas _screenCanvas;
        private RawImage _hazeNear;
        private RawImage _hazeFar;
        private readonly RawImage[] _edges = new RawImage[4];
        private Texture2D _hazeTexture;
        private Texture2D _edgeTextureV;
        private Texture2D _edgeTextureH;
        private string _screenState = string.Empty;

        private void UpdateScreen(Vector3 player, bool local, Vector2 dl)
        {
            bool blocked = RoaGameBootstrap.BlocksWorldHud;
            float haze = 0f, edge = 0f;
            string state = "нет";
            if (local)
            {
                RoaRadiationStormPath.Sample here = Here;
                if (here.Inside) { haze = Presence * (Sheltered ? 0.36f : 0.58f); state = "над игроком"; }
                else if (here.AheadKm > 0d) { edge = Presence * 1.25f; state = here.AheadKm < FeelAheadKm ? "подход" : "далеко"; }
                else { haze = Presence * 0.3f; state = "прошла"; }
                if (blocked) haze = edge = 0f;
            }
            LogScreenState(state, haze, edge, blocked);
            if (haze <= 0.004f && edge <= 0.004f)
            {
                if (_screenCanvas != null && _screenCanvas.gameObject.activeSelf) _screenCanvas.gameObject.SetActive(false);
                return;
            }
            EnsureScreen();
            if (!_screenCanvas.gameObject.activeSelf) _screenCanvas.gameObject.SetActive(true);

            // Куда на экране бежит ветер бури; стена — с противоположной стороны.
            Vector2 wind = Vector2.down;
            Camera camera = Camera.main;
            if (camera != null)
            {
                Vector3 a = camera.WorldToScreenPoint(player);
                Vector3 b = camera.WorldToScreenPoint(player + new Vector3(dl.x, 0f, dl.y) * 10f);
                var screen = new Vector2(b.x - a.x, b.y - a.y);
                if (a.z > 0f && b.z > 0f && screen.sqrMagnitude > 1e-4f) wind = screen.normalized;
            }

            bool hazeOn = haze > 0.004f;
            _hazeNear.enabled = _hazeFar.enabled = hazeOn;
            if (hazeOn)
            {
                float speed = Mathf.Lerp(0.25f, 0.95f, Presence);
                ScrollHaze(_hazeNear, wind, speed, new Color(0.36f, 0.38f, 0.24f, haze));
                ScrollHaze(_hazeFar, wind, speed * 0.55f, new Color(0.27f, 0.31f, 0.19f, haze * 0.85f));
            }
            Vector2 toStorm = -wind;
            for (int i = 0; i < _edges.Length; i++)
            {
                float facing = Mathf.Max(0f, Vector2.Dot(toStorm, EdgeNormals[i]));
                float alpha = Mathf.Clamp01(edge * Mathf.Pow(facing, 0.8f));
                _edges[i].enabled = alpha > 0.004f;
                if (_edges[i].enabled) _edges[i].color = new Color(0.6f, 0.95f, 0.34f, alpha);
            }
        }

        /// <summary>Лог смены состояния бури у игрока: чем она сейчас видна на экране.</summary>
        private void LogScreenState(string state, float haze, float edge, bool blocked)
        {
            if (state == _screenState) return;
            _screenState = state;
            if (state == "нет") return;
            Debug.Log($"[ROA] Буря выброса: {state} (присутствие {Presence:0.00}, муть {haze:0.00}, край {edge:0.00}"
                + (blocked ? ", окно поверх мира" : string.Empty) + (Sheltered ? ", укрытие" : string.Empty) + ")");
        }

        private static void ScrollHaze(RawImage image, Vector2 wind, float speed, Color color)
        {
            Rect rect = image.uvRect;
            // Сдвиг uv против хода узора: картинка едет по ветру.
            rect.position -= wind * (speed * Time.unscaledDeltaTime) * new Vector2(1f / rect.width, 1f / rect.height);
            rect.position = new Vector2(Mathf.Repeat(rect.x, 1f), Mathf.Repeat(rect.y, 1f));
            image.uvRect = rect;
            image.color = color;
        }

        private void EnsureScreen()
        {
            if (_screenCanvas != null) return;
            var canvasObject = new GameObject("StormScreenCanvas", typeof(RectTransform), typeof(Canvas));
            canvasObject.transform.SetParent(transform, false);
            _screenCanvas = canvasObject.GetComponent<Canvas>();
            _screenCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
            // Под HUD (30): мир в пыли, а панели читаются.
            _screenCanvas.sortingOrder = 4;
            _hazeTexture = BuildHazeTexture();
            _edgeTextureV = BuildEdgeTexture(false);
            _edgeTextureH = BuildEdgeTexture(true);
            Transform root = canvasObject.transform;
            _hazeFar = ScreenImage(root, "HazeFar", _hazeTexture, Vector2.zero, Vector2.one);
            _hazeFar.uvRect = new Rect(0.37f, 0.11f, 1.3f, 0.75f);
            _hazeNear = ScreenImage(root, "HazeNear", _hazeTexture, Vector2.zero, Vector2.one);
            _hazeNear.uvRect = new Rect(0f, 0f, 2.4f, 1.4f);
            // Свечение подхода: четыре полосы у краёв, яркие у самого края.
            _edges[0] = ScreenImage(root, "EdgeTop", _edgeTextureV, new Vector2(0f, 0.52f), Vector2.one);
            _edges[1] = ScreenImage(root, "EdgeBottom", _edgeTextureV, Vector2.zero, new Vector2(1f, 0.48f));
            _edges[1].uvRect = new Rect(0f, 1f, 1f, -1f);
            _edges[2] = ScreenImage(root, "EdgeLeft", _edgeTextureH, Vector2.zero, new Vector2(0.42f, 1f));
            _edges[2].uvRect = new Rect(1f, 0f, -1f, 1f);
            _edges[3] = ScreenImage(root, "EdgeRight", _edgeTextureH, new Vector2(0.58f, 0f), Vector2.one);
        }

        private static RawImage ScreenImage(Transform parent, string name, Texture texture, Vector2 anchorMin, Vector2 anchorMax)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(RawImage));
            go.transform.SetParent(parent, false);
            var rect = (RectTransform)go.transform;
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.offsetMin = rect.offsetMax = Vector2.zero;
            var image = go.GetComponent<RawImage>();
            image.texture = texture;
            image.raycastTarget = false;
            image.enabled = false;
            return image;
        }

        /// <summary>Бесшовный шум пыли: fbm из решёток, кратных размеру текстуры.</summary>
        private static Texture2D BuildHazeTexture()
        {
            var texture = new Texture2D(HazePixels, HazePixels, TextureFormat.RGBA32, false)
            {
                name = "StormHaze",
                wrapMode = TextureWrapMode.Repeat,
                filterMode = FilterMode.Bilinear
            };
            var random = new System.Random(911);
            int[] cells = { 4, 8, 16, 32 };
            float[] weights = { 0.5f, 0.28f, 0.15f, 0.07f };
            var grids = new float[cells.Length][];
            for (int g = 0; g < cells.Length; g++)
            {
                grids[g] = new float[cells[g] * cells[g]];
                for (int i = 0; i < grids[g].Length; i++) grids[g][i] = (float)random.NextDouble();
            }
            var pixels = new Color32[HazePixels * HazePixels];
            for (int y = 0; y < HazePixels; y++)
            {
                for (int x = 0; x < HazePixels; x++)
                {
                    float value = 0f;
                    for (int g = 0; g < cells.Length; g++)
                    {
                        int n = cells[g];
                        float fx = x / (float)HazePixels * n, fy = y / (float)HazePixels * n;
                        int x0 = Mathf.FloorToInt(fx), y0 = Mathf.FloorToInt(fy);
                        float tx = fx - x0, ty = fy - y0;
                        tx = tx * tx * (3f - 2f * tx);
                        ty = ty * ty * (3f - 2f * ty);
                        float a = grids[g][(y0 % n) * n + x0 % n];
                        float b = grids[g][(y0 % n) * n + (x0 + 1) % n];
                        float c = grids[g][((y0 + 1) % n) * n + x0 % n];
                        float d = grids[g][((y0 + 1) % n) * n + (x0 + 1) % n];
                        value += Mathf.Lerp(Mathf.Lerp(a, b, tx), Mathf.Lerp(c, d, tx), ty) * weights[g];
                    }
                    // Клочья: гуща плотная, но и в просветах остаётся пыль.
                    float alpha = Mathf.Clamp01(0.25f + (value - 0.3f) / 0.45f);
                    pixels[y * HazePixels + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(alpha * alpha * 255f));
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false);
            return texture;
        }

        /// <summary>Градиент края: у одного конца плотно, к другому сходит на нет.</summary>
        private static Texture2D BuildEdgeTexture(bool horizontal)
        {
            const int length = 64;
            var texture = new Texture2D(horizontal ? length : 4, horizontal ? 4 : length, TextureFormat.RGBA32, false)
            {
                name = horizontal ? "StormEdgeGlowH" : "StormEdgeGlowV",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear
            };
            var pixels = new Color32[length * 4];
            for (int i = 0; i < length; i++)
            {
                float t = i / (float)(length - 1);
                byte alpha = (byte)Mathf.RoundToInt(Mathf.Pow(t, 2.2f) * 255f);
                for (int j = 0; j < 4; j++)
                {
                    int index = horizontal ? j * length + i : i * 4 + j;
                    pixels[index] = new Color32(255, 255, 255, alpha);
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false);
            return texture;
        }

        private void HideScreen()
        {
            if (_screenCanvas != null) _screenCanvas.gameObject.SetActive(false);
        }

        private void ReleaseScreen()
        {
            if (_screenCanvas != null) Destroy(_screenCanvas.gameObject);
            if (_hazeTexture != null) Destroy(_hazeTexture);
            if (_edgeTextureV != null) Destroy(_edgeTextureV);
            if (_edgeTextureH != null) Destroy(_edgeTextureH);
            _screenCanvas = null;
        }
    }
}
