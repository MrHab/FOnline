#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaWeaponReadinessProbe
    {
        [MenuItem("Realm of Ashes/Проверить готовность оружия")]
        private static void Run()
        {
            try
            {
                RoaWeaponReadiness.Frame ready = RoaWeaponReadiness.Evaluate(
                    true, true, 24, 8f, 3, 0f, false, 0f);
                RoaWeaponReadiness.Frame cooldown = RoaWeaponReadiness.Evaluate(
                    true, true, 24, 8f, 3, 0.24f, false, 0f);
                RoaWeaponReadiness.Frame empty = RoaWeaponReadiness.Evaluate(
                    true, false, 24, 8f, 3, 0f, false, 0f);
                RoaWeaponReadiness.Frame depleted = RoaWeaponReadiness.Evaluate(
                    true, false, 0, 8f, 3, 0f, false, 0f);
                RoaWeaponReadiness.Frame lowAp = RoaWeaponReadiness.Evaluate(
                    false, true, 0, 1.5f, 3, 0f, false, 0f);
                RoaWeaponReadiness.Frame reloadPending = RoaWeaponReadiness.Evaluate(
                    true, false, 0, 0f, 8, 4f, true, 0f);
                RoaWeaponReadiness.Frame attackPending = RoaWeaponReadiness.Evaluate(
                    true, true, 24, 8f, 3, 0f, false, 0f, true);
                RoaWeaponReadiness.Frame reloading = RoaWeaponReadiness.Evaluate(
                    true, true, 24, 8f, 3, 0f, false, 0.5f);

                float acceptedRetry = RoaCombat.AuthoritativeRetrySeconds(new JObject
                {
                    ["combat"] = new JObject { ["cooldownRemainingMs"] = 438 }
                });
                float rejectedRetry = RoaCombat.AuthoritativeRetrySeconds(new JObject
                {
                    ["retryAfterMs"] = 317,
                    ["combat"] = new JObject { ["cooldownRemainingMs"] = 290 }
                });
                int injuredAimedCost = RoaCombatPreview.EffectiveApCost(
                    new JObject
                    {
                        ["equipment"] = new JObject { ["weapon"] = "pistol" },
                        ["injuries"] = new JObject { ["brokenArm"] = true }
                    },
                    new JObject { ["weapon"] = "pistol" }, "aimed");

                Require(ready.Kind == RoaWeaponReadinessKind.Ready && ready.CanAttack,
                    "ready weapon is not reported as attackable");
                Require(cooldown.Kind == RoaWeaponReadinessKind.Cooldown
                    && cooldown.Label.Contains("0"),
                    "authoritative cooldown is not visible");
                Require(empty.Kind == RoaWeaponReadinessKind.Empty && empty.Label.Contains("R"),
                    "empty magazine does not teach the reload input");
                Require(depleted.Kind == RoaWeaponReadinessKind.NoAmmo,
                    "depleted reserve is indistinguishable from a reloadable magazine");
                Require(lowAp.Kind == RoaWeaponReadinessKind.LowActionPoints
                    && lowAp.Label.Contains("3"),
                    "missing AP does not explain the required cost");
                Require(reloadPending.Kind == RoaWeaponReadinessKind.ReloadPending,
                    "reload request does not override stale weapon state");
                Require(attackPending.Kind == RoaWeaponReadinessKind.AttackPending
                    && !attackPending.CanAttack,
                    "a second speculative shot can start before the first ACK");
                Require(reloading.Kind == RoaWeaponReadinessKind.Reloading,
                    "accepted reload has no bounded presentation state");
                Require(Mathf.Abs(acceptedRetry - 0.438f) < 0.0001f
                    && Mathf.Abs(rejectedRetry - 0.317f) < 0.0001f,
                    "client retry timing does not preserve authoritative cooldown/retryAfter");
                Require(injuredAimedCost == 6,
                    "HUD/input AP cost ignores the broken-arm server penalty");

                Debug.Log("[ГОТОВНОСТЬ ОРУЖИЯ] готово: ACK/cooldown/AP/ammo/reload и честный темп проверены.");
            }
            catch (Exception error)
            {
                Debug.LogError("[ГОТОВНОСТЬ ОРУЖИЯ] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
