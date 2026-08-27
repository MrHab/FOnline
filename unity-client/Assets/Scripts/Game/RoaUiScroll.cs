using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public static class RoaUiScroll
    {
        public const float DefaultWheelSensitivity = 32f;

        public static void Configure(ScrollRect scroll, float sensitivity = DefaultWheelSensitivity)
        {
            if (scroll == null) return;
            scroll.horizontal = false;
            scroll.vertical = true;
            scroll.scrollSensitivity = Mathf.Max(18f, sensitivity);
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.inertia = true;
            scroll.decelerationRate = 0.12f;

            RectTransform viewport = scroll.viewport != null
                ? scroll.viewport
                : scroll.transform as RectTransform;
            if (viewport == null) return;
            scroll.viewport = viewport;
            Graphic target = viewport.GetComponent<Graphic>();
            if (target == null)
            {
                Image catcher = viewport.gameObject.AddComponent<Image>();
                catcher.color = Color.clear;
                target = catcher;
            }
            target.raycastTarget = true;
        }
    }
}
