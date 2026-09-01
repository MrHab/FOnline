#if UNITY_EDITOR
using System;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCombatFlowProbe
    {
        [MenuItem("Realm of Ashes/Проверить Combat Flow 4.8")]
        private static void Run()
        {
            GameObject root = null;
            try
            {
                Require(RoaCharacterView.ResolveCombatPresentationPhase(
                            true, true, true, true)
                        == RoaCharacterView.CombatPresentationPhase.Death,
                    "death is not the highest presentation priority");
                Require(RoaCharacterView.ResolveCombatPresentationPhase(
                            false, true, true, true)
                        == RoaCharacterView.CombatPresentationPhase.Reaction,
                    "reaction no longer interrupts attack and locomotion");
                Require(RoaCharacterView.ResolveCombatPresentationPhase(
                            false, false, true, true)
                        == RoaCharacterView.CombatPresentationPhase.Attack,
                    "attack no longer owns the body above gait");
                Require(RoaCharacterView.ResolveCombatPresentationPhase(
                            false, false, false, true)
                        == RoaCharacterView.CombatPresentationPhase.Locomotion,
                    "locomotion phase is not reachable after combat recovery");

                Require(RoaEnemies.AttackPresentationBlocked(false, 10.3f, 10.2f)
                        && !RoaEnemies.AttackPresentationBlocked(false, 10.3f, 10.3f)
                        && RoaEnemies.AttackPresentationBlocked(true, 0f, 10.3f),
                    "a stale attack can cancel stagger or restart a corpse");
                Require(RoaEnemies.AnimateAttackAtTelegraph(false)
                        && !RoaEnemies.AnimateAttackAtTelegraph(true)
                        && !RoaEnemies.AnimateAttackAtImpact(false, true)
                        && RoaEnemies.AnimateAttackAtImpact(false, false)
                        && RoaEnemies.AnimateAttackAtImpact(true, true),
                    "melee wind-up and ranged recoil no longer occur at their proper events");
                Require(RoaEnemies.AttackRootLockSeconds(0.52f, false) > 0.73f
                        && RoaEnemies.AttackRootLockSeconds(0.38f, true) < 0.49f,
                    "attack root lock lost melee follow-through or bounded ranged recovery");

                Require(!RoaCombat.UiBlocksAttack(false, false, false, false, false)
                        && RoaCombat.UiBlocksAttack(false, true, false, false, false)
                        && RoaCombat.UiBlocksAttack(false, false, false, false, true),
                    "PIP-ASH or the global map no longer blocks combat input");

                foreach (float deadline in new[] { 0.24f, 0.52f, 0.80f })
                {
                    float swing = RoaMeleeGrip.SwingSecondsForImpact(deadline);
                    Require(Mathf.Abs(RoaMeleeGrip.StrikeContactSeconds(swing) - deadline) < 0.002f,
                        "NPC melee contact drifted from server deadline " + deadline);
                }

                Require(Mathf.Abs(RoaCharacterView.DeathYawForImpact(Vector2.up)) < 0.1f
                        && Mathf.Abs(RoaCharacterView.DeathYawForImpact(Vector2.right) - 90f) < 0.1f
                        && Mathf.Abs(Mathf.Abs(RoaCharacterView.DeathYawForImpact(Vector2.down)) - 180f) < 0.1f
                        && Mathf.Abs(RoaCharacterView.DeathYawForImpact(Vector2.left) + 90f) < 0.1f,
                    "directional death variants no longer face the impact source");

                float normalImpulse = RoaCombatPresentationFx.ConfirmationImpulse(false, false, 3f);
                float criticalImpulse = RoaCombatPresentationFx.ConfirmationImpulse(true, false, 3f);
                float killImpulse = RoaCombatPresentationFx.ConfirmationImpulse(true, true, 3f);
                Require(normalImpulse > 0f && normalImpulse < criticalImpulse
                        && criticalImpulse < killImpulse && killImpulse < 0.06f
                        && RoaCombatPresentationFx.ConfirmationImpulse(true, true, 20f) == 0f,
                    "confirmation camera impulse is not bounded by strength and distance");
                Color ballistic = RoaCombatPresentationFx.ConfirmedImpactColor("rifle", false, false);
                Color laser = RoaCombatPresentationFx.ConfirmedImpactColor("laserPistol", false, false);
                Color plasma = RoaCombatPresentationFx.ConfirmedImpactColor("plasmaRifle", false, false);
                Require(laser.b > ballistic.b && plasma.g > ballistic.g,
                    "energy impacts are no longer distinguishable from ballistic hits");

                root = new GameObject("Combat Flow 4.8 probe");
                RoaCombatPresentationFx fx = root.AddComponent<RoaCombatPresentationFx>();
                fx.PlayConfirmedHit(new Vector3(2f, 0f, 1f), Vector3.zero,
                    "rifle", false, false);
                Transform impact = root.transform.Find("LayeredImpactFx");
                Transform dust = impact != null ? impact.Find("ImpactDust") : null;
                Require(impact != null && impact.gameObject.activeSelf && dust != null
                        && dust.GetComponent<Renderer>() != null
                        && dust.localPosition.y < -0.9f,
                    "pooled body impact lost its grounded dust layer");

                Debug.Log("[COMBAT FLOW 4.8] готово: приоритет=death>reaction>attack>gait, "
                    + "melee=server-contact, ranged=impact-recoil, смерть=8 направлений, "
                    + "VFX=цвет+пыль+ограниченный импульс, UI=без стрельбы.");
            }
            catch (Exception error)
            {
                Debug.LogError("[COMBAT FLOW 4.8] ошибка: " + error.Message);
            }
            finally
            {
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
