using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Единый масштаб uGUI-канв. Десктопный референс 1440×810 не превращает
    /// шрифты 10–13 pt в нечитаемые 7–9 пикселей на распространённых
    /// ноутбучных экранах и при этом оставляет достаточно места игровому миру.
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
            return mobile ? new Vector2(1280f, 720f) : new Vector2(1440f, 810f);
        }

        public static void Apply(CanvasScaler scaler)
        {
            Apply(scaler, Application.isMobilePlatform);
        }

        public static void Apply(CanvasScaler scaler, bool mobile)
        {
            if (scaler == null) return;
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = ReferenceFor(mobile);
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = 0.5f;
            scaler.referencePixelsPerUnit = 100f;
            Canvas canvas = scaler.GetComponent<Canvas>();
            if (canvas != null) canvas.pixelPerfect = true;
        }
    }
}
