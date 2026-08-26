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
                VerifyCanvasLayoutAndInput();

                Debug.Log("[МОБИЛЬНОЕ УПРАВЛЕНИЕ] готово: stick="
                    + diagonal.x.ToString("0.00") + ":" + diagonal.y.ToString("0.00")
                    + ", fire=" + fire.width.ToString("0") + "px, compact="
                    + compactFire.width.ToString("0") + "px, multitouch-zones=independent, canvas=safe/held/states");
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

        private static void VerifyCanvasLayoutAndInput()
        {
            const int width = 896;
            const int height = 414;
            Rect safe = new Rect(24f, 12f, 848f, 390f);
            RoaMobileControlsCanvas.Layout layout =
                RoaMobileControlsCanvas.CalculateLayout(width, height, safe);
            Vector2 railGui = new Vector2(layout.Map.center.x, height - layout.Map.center.y);
            Require(!RoaMobileControls.IsJoystickStart(railGui, width, height, safe),
                    "left shortcut rail can no longer steal the floating joystick finger");
            var rects = new[]
            {
                layout.Inventory, layout.Map, layout.Pipboy, layout.Menu,
                layout.Fire, layout.Interact, layout.Target, layout.Crouch,
                layout.Reload, layout.Mode, layout.Player
            };
            for (int i = 0; i < rects.Length; i++)
            {
                Require(Contains(layout.SafeArea, rects[i]),
                        "mobile Canvas control leaves the device safe area");
                for (int j = 0; j < i; j++)
                    Require(!rects[i].Overlaps(rects[j]),
                            "mobile Canvas controls overlap on compact landscape");
            }

            var root = new GameObject("Mobile Canvas probe");
            try
            {
                RoaMobileControls controls = root.AddComponent<RoaMobileControls>();
                controls.ForceVisible = true;
                controls.CanvasDriven = true;
                int menuRequests = 0;
                controls.MenuRequested = () => menuRequests++;
                RoaMobileControlsCanvas canvas = root.AddComponent<RoaMobileControlsCanvas>();
                canvas.Configure(controls);
                var state = new RoaMobileControlsCanvas.Presentation
                {
                    Visible = true,
                    TargetSelected = true,
                    Crouching = true,
                    FireMode = "Одиночный",
                    JoystickActive = true,
                    JoystickBase = new Vector2(220f, 108f),
                    JoystickPoint = new Vector2(258f, 132f),
                    JoystickRadius = 54f
                };
                canvas.PresentNow(state, width, height, safe);
                Require(canvas.CanvasReady && canvas.InputReady
                        && canvas.ButtonCount == 11 && canvas.ActiveButtonCount == 11
                        && canvas.GameplayButtonsVisible && canvas.JoystickVisible,
                        "mobile uGUI Canvas, touch targets or joystick visual is incomplete");
                Require(canvas.ButtonLabel("Target") == "ЦЕЛЬ ✓"
                        && canvas.ButtonLabel("Crouch") == "ВСТАТЬ"
                        && canvas.ButtonLabel("Mode") == "ОДИНОЧНЫЙ",
                        "mobile Canvas does not reflect live target, stance or fire mode");
                Require(canvas.TryGetButtonScreenRect("Fire", out Rect fireRect)
                        && RectNear(fireRect, layout.Fire),
                        "mobile Canvas fire visual differs from its touch layout");
                Require(canvas.SimulatePressForProbe("Fire", true)
                        && controls.FireHeldForCanvas,
                        "mobile Canvas pointer-down does not start held fire");
                Require(canvas.SimulatePressForProbe("Fire", false)
                        && !controls.FireHeldForCanvas,
                        "mobile Canvas pointer-up does not stop held fire");
                Require(canvas.SimulateClickForProbe("Menu") && menuRequests == 1,
                        "mobile Canvas menu button is not connected to gameplay control");

                state.InputSuppressed = true;
                state.JoystickActive = true;
                canvas.PresentNow(state, width, height, safe);
                Require(canvas.ActiveButtonCount == 1 && !canvas.GameplayButtonsVisible
                        && !canvas.JoystickVisible && canvas.ButtonLabel("Menu") == "ЗАКРЫТЬ",
                        "suppressed mobile input does not collapse to one clear close action");

                state.InputSuppressed = false;
                state.PanelOpen = true;
                canvas.PresentNow(state, width, height, safe);
                Require(canvas.ActiveButtonCount == 4 && !canvas.GameplayButtonsVisible,
                        "mobile panel state does not hide conflicting gameplay controls");

                controls.SetFireHeld(true);
                state.Visible = false;
                canvas.PresentNow(state, width, height, safe);
                Require(!canvas.Visible && !controls.FireHeldForCanvas,
                        "hidden mobile Canvas leaves held fire latched");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static bool Contains(Rect outer, Rect inner)
        {
            const float epsilon = 0.01f;
            return inner.xMin >= outer.xMin - epsilon && inner.yMin >= outer.yMin - epsilon
                && inner.xMax <= outer.xMax + epsilon && inner.yMax <= outer.yMax + epsilon;
        }

        private static bool RectNear(Rect a, Rect b)
        {
            return Near(a.x, b.x) && Near(a.y, b.y)
                && Near(a.width, b.width) && Near(a.height, b.height);
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
