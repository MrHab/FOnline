using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Смысловые имена для цвета ПУТНИКа и процедурная скруглённая плитка.
    ///
    /// Значения намеренно те же, что у констант RoaPipboyCanvas: фосфорно-зелёный
    /// терминал остаётся, меняется только раскладка. Файл нужен ради того, чтобы
    /// новая вёрстка ссылалась на роль цвета («подпись», «граница плитки»), а не
    /// плодила литералы: в старом экране их набралось под восемьдесят.
    ///
    /// Плитка повторяет приём RoaGlobalMapCanvas.MapLabelPlateSprite (скругление
    /// через 9-slice), но живёт здесь, а не переносится оттуда: тот файл читает
    /// tools/check-unity-visual-cohesion.js, и правка ради стиля роняла бы проверку.
    /// </summary>
    public static class RoaUiPalette
    {
        // --- Ink: текст -----------------------------------------------------
        /// <summary>Имя предмета, значение стата — самое яркое, что есть на экране.</summary>
        public static readonly Color InkPrimary = new Color(0.827f, 0.933f, 0.541f, 1f);   // #d3ee8a
        /// <summary>Подпись слева от значения, тип слота, категория.</summary>
        public static readonly Color InkLabel = new Color(0.624f, 0.859f, 0.478f, 0.55f);
        /// <summary>Честный ноль: защиты нет, но строку показать обязаны.</summary>
        public static readonly Color InkMuted = new Color(0.624f, 0.859f, 0.478f, 0.32f);
        /// <summary>Тёплый акцент: вес, состояние, активная вкладка.</summary>
        public static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);
        /// <summary>Перегруз и прочее, о чём игрок обязан споткнуться взглядом.</summary>
        public static readonly Color Negative = new Color(0.898f, 0.412f, 0.318f, 1f);

        // --- Поверхности ----------------------------------------------------
        public static readonly Color TileBg = new Color(0.055f, 0.125f, 0.078f, 0.92f);
        public static readonly Color TileSelected = new Color(0.145f, 0.267f, 0.129f, 0.98f);
        public static readonly Color TileBorder = new Color(0.533f, 0.686f, 0.396f, 0.34f);
        public static readonly Color EquippedEdge = new Color(1f, 0.82f, 0.42f, 1f);
        public static readonly Color PanelBg = new Color(0.03f, 0.07f, 0.04f, 1f);
        public static readonly Color PanelBorder = new Color(0.49f, 0.804f, 0.369f, 0.32f);
        public static readonly Color Divider = new Color(0.49f, 0.804f, 0.369f, 0.22f);

        /// <summary>
        /// Цвет имени предмета по тиру. RoaGearData.TierTint для нулевого тира отдаёт
        /// Color.clear — для подписи это прозрачный, то есть невидимый текст, поэтому
        /// здесь нетированные предметы получают обычный яркий цвет.
        /// </summary>
        public static Color TierInk(int tier)
        {
            if (tier < 1 || tier > 5) return InkPrimary;
            Color tint = RoaGearData.TierTint(tier);
            return tint.a > 0.01f ? tint : InkPrimary;
        }

        private static Sprite _plate;

        /// <summary>
        /// Белая плитка со скруглением под 9-slice: итоговый цвет задаёт Image.color.
        /// Одна текстура на весь интерфейс — Image.sprite её только ссылается.
        /// </summary>
        public static Sprite Plate()
        {
            if (_plate != null) return _plate;
            const int size = 24;
            const float radius = 5f;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                name = "PipboyPlate"
            };
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float dx = Mathf.Max(0f, Mathf.Max(radius - x, x - (size - 1 - radius)));
                    float dy = Mathf.Max(0f, Mathf.Max(radius - y, y - (size - 1 - radius)));
                    float corner = Mathf.Sqrt(dx * dx + dy * dy);
                    float alpha = Mathf.Clamp01(radius - corner + 0.5f);
                    pixels[y * size + x] = new Color(1f, 1f, 1f, alpha);
                }
            }
            texture.SetPixels(pixels);
            texture.Apply(false, false);
            _plate = Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f),
                                   100f, 0, SpriteMeshType.FullRect, new Vector4(6f, 6f, 6f, 6f));
            return _plate;
        }
    }
}
