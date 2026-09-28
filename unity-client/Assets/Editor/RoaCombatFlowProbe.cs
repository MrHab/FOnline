#if UNITY_EDITOR
using System;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCombatFlowProbe
    {
        [MenuItem("Realm of Ashes/Probes/Combat target selection")]
        public static void Run()
        {
            GameObject host = new GameObject("Combat target selection probe");
            try
            {
                GameObject playerObject = new GameObject("Player");
                playerObject.transform.SetParent(host.transform, false);
                playerObject.AddComponent<CharacterController>();
                RoaPlayerController player = playerObject.AddComponent<RoaPlayerController>();
                RoaEnemies enemies = host.AddComponent<RoaEnemies>();
                RoaCombat combat = host.AddComponent<RoaCombat>();
                combat.Player = player;
                combat.Enemies = enemies;

                Vector3 target = new Vector3(1.1f, 0f, 0f);
                RoaCoords.ToServer(target, out float x, out float z);
                enemies.ApplyPublicEnemy(new JObject
                {
                    ["id"] = "combat-probe-target",
                    ["name"] = "Мишень",
                    ["trainingTarget"] = true,
                    ["x"] = x,
                    ["z"] = z,
                    ["hp"] = 100,
                    ["maxHp"] = 100,
                    ["scale"] = 1f,
                    ["dead"] = false
                });

                // Луч по земле проходит мимо врага, хотя курсор находится
                // в обычном радиусе выбора и нож достаёт до его позиции.
                Vector3 groundCursor = new Vector3(0.1f, 0f, 2.2f);
                Require(!enemies.TryFindTargetAlongRay(Vector3.zero, groundCursor, 1.35f,
                    out _, out _, out _, out _), "test ray unexpectedly found the target");
                MethodInfo resolve = typeof(RoaCombat).GetMethod("TryResolvePrimaryTarget",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Require(resolve != null, "combat target resolver is missing");
                object[] args = { groundCursor, null, Vector3.zero, null, Vector3.zero, null };
                bool found = (bool)resolve.Invoke(combat, args);
                Require(found && (string)args[1] == "combat-probe-target",
                    "a nearby melee target became an untargeted attack");

                JObject rangedCombat = new JObject { ["weapon"] = "polygonAssaultRifle02" };
                Require(RoaCombatPreview.EffectiveRange(null, rangedCombat, "single") > 10f,
                    "PolygonApocalypse rifle lost its ranged combat profile");
                Debug.Log("[COMBAT TARGET PROBE] PASS: nearby melee selection and pack rifle range");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
