#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaHudCanvasProbe
    {
        [MenuItem("Realm of Ashes/Probe/Adaptive HUD")]
        public static void Run()
        {
            var occupied = new List<Rect>();
            Require(RoaActorNameplates.TryResolveScreenRect(new Vector2(-20f, -10f), occupied,
                                                            800, 480, out Rect first),
                    "first nameplate was not placed");
            Require(first.xMin >= 6f && first.yMin >= 6f && first.xMax <= 794f && first.yMax <= 474f,
                    "nameplate escaped the screen safe margin");
            occupied.Add(first);
            Require(RoaActorNameplates.TryResolveScreenRect(new Vector2(-20f, -10f), occupied,
                                                            800, 480, out Rect second),
                    "overlapping nameplate was not relocated");
            Require(!first.Overlaps(second), "relocated nameplates still overlap");
            Require(typeof(RoaHudCanvas).IsSubclassOf(typeof(MonoBehaviour)),
                    "adaptive HUD is not a Unity component");
            Debug.Log("[ROA PROBE] Adaptive HUD OK: safe nameplates and Canvas owner.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
