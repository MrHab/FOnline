using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Значок игрока на миникарте: Resources/RealmUi/minimap-player.png — значок
    /// «navigation» из Material Design Icons (Apache 2.0, лицензия лежит рядом с
    /// картинкой). Белый с альфой, поэтому HUD красит его своим цветом. Остриё
    /// смотрит вверх при нулевом повороте — на миникарте это −Z Unity.
    /// Если файла нет, значок рисуется треугольником в коде: HUD не должен
    /// оставаться без маркера игрока.
    /// </summary>
    public static class RoaMinimapPlayerIcon
    {
        private const int FallbackPixels = 64;
        private static Sprite _sprite;

        public static Sprite Sprite
        {
            get
            {
                if (_sprite != null) return _sprite;
                Texture2D texture = Resources.Load<Texture2D>("RealmUi/minimap-player");
                if (texture == null)
                {
                    Debug.LogWarning("[ROA] Нет значка RealmUi/minimap-player — маркер игрока рисуется треугольником.");
                    texture = BuildTriangle();
                }
                _sprite = Sprite.Create(texture, new Rect(0f, 0f, texture.width, texture.height),
                                        new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect);
                _sprite.name = "MinimapPlayer";
                return _sprite;
            }
        }

        private static Texture2D BuildTriangle()
        {
            var texture = new Texture2D(FallbackPixels, FallbackPixels, TextureFormat.RGBA32, false)
            {
                name = "MinimapPlayerFallback",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                hideFlags = HideFlags.DontSave
            };
            var pixels = new Color32[FallbackPixels * FallbackPixels];
            for (int y = 0; y < FallbackPixels; y++)
            {
                // Треугольник остриём вверх: чем ниже строка, тем он шире.
                float t = y / (FallbackPixels - 1f);
                float half = Mathf.Lerp(0.5f, 0.04f, t) * FallbackPixels;
                float centre = FallbackPixels * 0.5f;
                for (int x = 0; x < FallbackPixels; x++)
                {
                    bool inside = Mathf.Abs(x + 0.5f - centre) <= half && y <= FallbackPixels * 0.92f;
                    pixels[y * FallbackPixels + x] = inside ? new Color32(255, 255, 255, 255) : new Color32(255, 255, 255, 0);
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            return texture;
        }
    }
}
