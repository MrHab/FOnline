#if UNITY_EDITOR
using System;
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
                RoaWeaponReadiness.Frame pending = RoaWeaponReadiness.Evaluate(
                    true, false, 0, 0f, 8, 4f, true, 0f);
                RoaWeaponReadiness.Frame reloading = RoaWeaponReadiness.Evaluate(
                    true, true, 24, 8f, 3, 0f, false, 0.5f);

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
                Require(pending.Kind == RoaWeaponReadinessKind.ReloadPending,
                    "reload request does not override stale weapon state");
                Require(reloading.Kind == RoaWeaponReadinessKind.Reloading,
                    "accepted reload has no bounded presentation state");

                Debug.Log("[ГОТОВНОСТЬ ОРУЖИЯ] готово: ready/cooldown/empty/ammo/AP/reload различимы.");
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
