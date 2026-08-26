using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Единый масштаб uGUI-канв. Десктопный референс 1600×900 сохраняет
    /// свободное место вокруг игрового мира, но не превращает шрифты 11–13 pt
    /// в нечитаемые 7–9 пикселей на распространённых ноутбучных экранах.
    /// На мобильных референс остаётся 1280×720 и дополняется локальной
    /// мобильной раскладкой каждого экрана.
    /// </summary>
    public static class RoaUiScale
    {
        public static Vector2 Reference
        {
            get { return ReferenceFor(Application.isMobilePlatform); }
        }

        public static Vector2 ReferenceFor(bool mobile)
        {
            return mobile ? new Vector2(1280f, 720f) : new Vector2(1600f, 900f);
        }

        public static void Apply(CanvasScaler scaler)
        {
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = Reference;
            scaler.matchWidthOrHeight = 0.5f;
        }
    }
}
