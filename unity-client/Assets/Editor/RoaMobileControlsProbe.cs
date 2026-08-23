#if UNITY_EDITOR
using System;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaMobileControlsProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить мобильное управление";

        [MenuItem(MenuPath)]
        private static void Run()
        {
            try
            {
                Require(RoaMobileControls.NormalizeJoystick(new Vector2(3f, 2f), 54f) == Vector2.zero,
                        "joystick deadzone is too small");
                Vector2 right = RoaMobileControls.NormalizeJoystick(new Vector2(40f, 0f), 54f);
                Vector2 forward = RoaMobileControls.NormalizeJoystick(new Vector2(0f, -40f), 54f);
                Vector2 diagonal = RoaMobileControls.NormalizeJoystick(new Vector2(40f, -40f), 54f);
                Require(Near(right.x, 1f) && Near(right.y, 0f), "right direction is incorrect");
                Require(Near(forward.x, 0f) && Near(forward.y, 1f), "forward direction lost GUI Y inversion");
                Require(Near(diagonal.magnitude, 1f), "joystick incorrectly changes movement speed");

                Require(RoaMobileControls.IsJoystickStart(new Vector2(200f, 800f), 1920, 1080),
                        "landscape left play area does not start the joystick");
                Require(!RoaMobileControls.IsJoystickStart(new Vector2(1200f, 800f), 1920, 1080),
                        "right action area starts the joystick");
                Require(!RoaMobileControls.IsJoystickStart(new Vector2(100f, 40f), 1920, 1080),
                        "top panel shortcut starts the joystick");

                Rect fire = RoaMobileControls.FireRect(1920, 1080);
                Require(fire.xMax <= 1920f && fire.yMax <= 1080f && fire.width >= 76f,
                        "fire button is outside the landscape safe area");
                Rect compactFire = RoaMobileControls.FireRect(896, 414);
                Require(compactFire.x >= 0f && compactFire.y >= 0f && compactFire.width == 76f,
                        "compact landscape fire button is not touch-sized");

                VerifyIndependentTouchZones(1920, 1080);
                VerifyIndependentTouchZones(896, 414);

                Debug.Log("[МОБИЛЬНОЕ УПРАВЛЕНИЕ] готово: stick="
                    + diagonal.x.ToString("0.00") + ":" + diagonal.y.ToString("0.00")
                    + ", fire=" + fire.width.ToString("0") + "px, compact="
                    + compactFire.width.ToString("0") + "px, multitouch-zones=independent");
            }
            catch (Exception error)
            {
                Debug.LogError("[МОБИЛЬНОЕ УПРАВЛЕНИЕ] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static bool Near(float a, float b)
        {
            return Mathf.Abs(a - b) < 0.0001f;
        }

        private static void VerifyIndependentTouchZones(int width, int height)
        {
            MethodInfo actionRect = typeof(RoaMobileControls).GetMethod(
                "ActionRect", BindingFlags.NonPublic | BindingFlags.Static);
            Require(actionRect != null, "mobile action layout helper is missing");
            Rect fire = RoaMobileControls.FireRect(width, height);
            var actions = new Rect[6];
            for (int i = 0; i < actions.Length; i++)
            {
                actions[i] = (Rect)actionRect.Invoke(null, new object[] { width, height, i + 1 });
                Require(actions[i].xMin >= 0f && actions[i].yMin >= 0f
                        && actions[i].xMax <= width && actions[i].yMax <= height,
                        "mobile action button leaves the landscape viewport");
                Require(actions[i].width >= 54f && actions[i].height >= 54f,
                        "mobile action button is smaller than the touch target");
                Require(!actions[i].Overlaps(fire),
                        "mobile action button overlaps held fire");
                for (int j = 0; j < i; j++)
                    Require(!actions[i].Overlaps(actions[j]),
                            "mobile action buttons overlap each other");
            }

            Vector2 joystickFinger = new Vector2(Mathf.Min(220f, width * 0.25f), height * 0.72f);
            Vector2 fireFinger = fire.center;
            Require(RoaMobileControls.IsJoystickStart(joystickFinger, width, height),
                    "first simultaneous finger cannot own the joystick");
            Require(fire.Contains(fireFinger),
                    "second simultaneous finger cannot hold fire");
            Require(joystickFinger.x < actions[1].xMin && joystickFinger.x < fire.xMin,
                    "joystick and action fingers do not have independent screen zones");
        }
    }
}
#endif
