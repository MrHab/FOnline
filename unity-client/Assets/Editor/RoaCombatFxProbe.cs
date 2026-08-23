#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCombatFxProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить боевые эффекты";

        [MenuItem(MenuPath)]
        private static void Run()
        {
            try
            {
                RoaCombatFx.WeaponFxProfile laser = RoaCombatFx.ProfileFor("laserPistol");
                RoaCombatFx.WeaponFxProfile plasma = RoaCombatFx.ProfileFor("plasmaRifle");
                RoaCombatFx.WeaponFxProfile fallback = RoaCombatFx.ProfileFor("unknown");
                Require(ColorNear(laser.Tracer, Hex("#ff5b84")) && Near(laser.TracerLife, 0.22f),
                        "laser profile differs from web client");
                Require(ColorNear(plasma.Tracer, Hex("#75ffa8")) && Near(plasma.FlashLife, 0.10f),
                        "plasma profile differs from web client");
                Require(ColorNear(fallback.Tracer, Hex("#ffd56a")) && Near(fallback.TracerLife, 0.16f),
                        "default firearm profile differs from web client");

                var exact = new JObject
                {
                    ["startX"] = 2f,
                    ["startY"] = 1.05f,
                    ["startZ"] = 3f,
                    ["endX"] = 8f,
                    ["endZ"] = -4f
                };
                Vector3 start;
                Vector3 end;
                Require(RoaCombatFx.TryShotEndpoints(exact, out start, out end),
                        "exact shot endpoints were rejected");
                Require(Near(start.x, 2f) && Near(start.z, -3f)
                        && Near(end.x, 8f) && Near(end.z, 4f),
                        "shot endpoints lost the server-to-Unity Z inversion");

                var directional = new JObject
                {
                    ["originX"] = -1f,
                    ["originZ"] = 2f,
                    ["dirX"] = 1f,
                    ["dirZ"] = 0f,
                    ["endDist"] = 5f
                };
                Require(RoaCombatFx.TryShotEndpoints(directional, out start, out end)
                        && Near(end.x, 4f) && Near(end.z, -2f),
                        "directional shot fallback has an incorrect endpoint");

                VerifyRuntimeVisuals();

                Debug.Log("[БОЕВЫЕ ЭФФЕКТЫ] готово: laser=" + laser.TracerLife.ToString("0.00")
                    + "s, plasma=" + plasma.TracerLife.ToString("0.00")
                    + "s, Z=" + start.z.ToString("0.0") + "→" + end.z.ToString("0.0")
                    + ", runtime=tracer/flash/explosion/clear");
            }
            catch (Exception error)
            {
                Debug.LogError("[БОЕВЫЕ ЭФФЕКТЫ] ошибка: " + error.Message);
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

        private static bool ColorNear(Color a, Color b)
        {
            return Near(a.r, b.r) && Near(a.g, b.g) && Near(a.b, b.b);
        }

        private static Color Hex(string value)
        {
            Color color;
            if (!ColorUtility.TryParseHtmlString(value, out color))
                throw new InvalidOperationException("invalid test color " + value);
            return color;
        }

        private static void VerifyRuntimeVisuals()
        {
            var root = new GameObject("Combat FX probe");
            try
            {
                RoaCombatFx fx = root.AddComponent<RoaCombatFx>();
                for (int i = 0; i < 5; i++)
                    fx.PlayShot(new Vector3(i, 1.1f, 0f), new Vector3(i + 6f, 1.1f, 2f),
                                i % 2 == 0 ? "machineGun" : "laserPistol");
                Require(fx.ActiveTracerCount == 5 && fx.ActiveFlashCount == 5,
                        "automatic queue did not activate five pooled tracers/flashes");
                LineRenderer[] lines = root.GetComponentsInChildren<LineRenderer>(true);
                Require(Array.FindAll(lines, line => line.gameObject.activeSelf && line.positionCount == 2).Length == 5,
                        "active tracer geometry is incomplete");

                fx.PlayExplosion(new Vector3(2f, 0f, -3f), 4.2f);
                Require(fx.ActiveExplosionCount == 1,
                        "rocket explosion visual was not created");
                Transform explosion = root.transform.Find("ExplosionFx");
                Require(explosion != null && explosion.GetComponent<LineRenderer>() != null
                        && explosion.GetComponent<Light>() != null
                        && explosion.Find("Core") != null,
                        "rocket explosion is missing its ring, core or light");

                fx.Clear();
                Require(fx.ActiveTracerCount == 0 && fx.ActiveFlashCount == 0
                        && fx.ActiveExplosionCount == 0,
                        "combat visual pools did not clear cleanly");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }
    }
}
#endif
