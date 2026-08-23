#if UNITY_EDITOR
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.Editor
{
    public static class RoaQuickbarProbe
    {
        [MenuItem("Realm of Ashes/Probe/Quickbar Contract")]
        public static void Run()
        {
            CheckLayout(1920, 1080);
            CheckLayout(896, 414);
            if (RoaInventory.BaseId("ui_pistol_a1_b2") != "pistol")
                throw new System.Exception("Runtime item id was not reduced to its base id.");
            if (RoaInventory.BaseId("ammo9") != "ammo9")
                throw new System.Exception("Stack item id changed unexpectedly.");
            if (RoaQuickbar.RadialSelection(new Vector2(0f, -100f), 8) != 0
                || RoaQuickbar.RadialSelection(new Vector2(100f, 0f), 8) != 2
                || RoaQuickbar.RadialSelection(new Vector2(0f, 100f), 8) != 4
                || RoaQuickbar.RadialSelection(new Vector2(-100f, 0f), 8) != 6
                || RoaQuickbar.RadialSelection(new Vector2(2f, 2f), 8) != -1)
                throw new System.Exception("Desktop radial selection differs from the browser contract.");
            Vector2 clamped = RoaQuickbar.ClampRadialCenter(Vector2.zero, 896, 414);
            if (clamped.x <= 0f || clamped.y <= 0f)
                throw new System.Exception("Desktop radial center was not clamped into the viewport.");
            Debug.Log("[ROA PROBE] Quickbar contract OK: 8 slots, runtime ids, radial and landscape bounds.");
        }

        private static void CheckLayout(int width, int height)
        {
            Rect rect = RoaQuickbar.BarRect(width, height);
            if (rect.x < 304f || rect.xMax > width - 11f || rect.y < 0f || rect.yMax > height)
                throw new System.Exception("Quickbar is outside " + width + "x" + height + ": " + rect);
            if (rect.width < 570f && width >= 896)
                throw new System.Exception("Quickbar slots are too narrow at " + width + "x" + height + ".");
        }
    }
}
#endif
