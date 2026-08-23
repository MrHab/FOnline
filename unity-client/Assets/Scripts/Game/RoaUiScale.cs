using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Единый масштаб uGUI-канв. Web-раскладка рассчитана на 1920×1080; на
    /// мобильных (в т.ч. мобильный браузер WebGL — Application.isMobilePlatform)
    /// референс уменьшается до 1280×720, чтобы текст и кнопки были в 1,5 раза
    /// крупнее, как у мобильных стилей web-клиента.
    /// </summary>
    public static class RoaUiScale
    {
        public static Vector2 Reference
        {
            get { return Application.isMobilePlatform ? new Vector2(1280f, 720f) : new Vector2(1920f, 1080f); }
        }

        public static void Apply(CanvasScaler scaler)
        {
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = Reference;
            scaler.matchWidthOrHeight = 0.5f;
        }
    }
}
