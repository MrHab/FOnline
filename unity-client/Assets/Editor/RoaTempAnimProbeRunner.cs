#if UNITY_EDITOR
using System;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    // Временный запуск проб персонажа по одной (удалить после проверки).
    public static class RoaTempAnimProbeRunner
    {
        public static void RunAll()
        {
            var probes = new (string, Action)[]
            {
                ("FrozenBone", RoaFrozenBoneProbe.Run),
                ("HitReaction", RoaHitReactionProbe.Run),
                ("RemoteDeath", RoaRemoteDeathProbe.Run),
                ("PresentationLod", RoaActorPresentationLodProbe.Run),
                ("CombatFlow", RoaCombatFlowProbe.Run),
                ("LocomotionContact", RoaLocomotionContactProbe.Run),
                ("DualWield", RoaDualWieldProbe.Run),
                ("WeaponCollision", RoaWeaponCollisionProbe.Run)
            };
            foreach (var (name, run) in probes)
            {
                try { run(); Debug.Log("[TEMP RUNNER] DONE " + name); }
                catch (Exception error) { Debug.LogError("[TEMP RUNNER] THROW " + name + ": " + error.Message); }
            }
            EditorApplication.Exit(0);
        }
    }
}
#endif
