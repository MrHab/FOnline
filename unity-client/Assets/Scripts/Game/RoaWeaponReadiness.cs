using UnityEngine;

namespace RealmOfAshes.Game
{
    public enum RoaWeaponReadinessKind
    {
        Ready,
        AttackPending,
        Cooldown,
        ReloadPending,
        Reloading,
        Empty,
        NoAmmo,
        LowActionPoints
    }

    /// <summary>
    /// Pure readiness rule shared by the weapon console and input gate.
    /// All values still come from authoritative combat ACKs/snapshots.
    /// </summary>
    public static class RoaWeaponReadiness
    {
        public struct Frame
        {
            public RoaWeaponReadinessKind Kind;
            public string Label;
            public bool CanAttack;
        }

        public static Frame Evaluate(bool usesAmmo, bool hasLoadedRound, int reserveAmmo,
                                     float actionPoints, int actionPointCost,
                                     float cooldownSeconds, bool reloadPending,
                                     float reloadRemainingSeconds, bool attackPending = false)
        {
            if (attackPending)
                return State(RoaWeaponReadinessKind.AttackPending, "ВЫСТРЕЛ…", false);

            if (reloadPending)
                return State(RoaWeaponReadinessKind.ReloadPending, "ПОДТВЕРЖДЕНИЕ R…", false);

            if (reloadRemainingSeconds > 0.01f)
                return State(RoaWeaponReadinessKind.Reloading, "ПЕРЕЗАРЯДКА", false);

            if (usesAmmo && !hasLoadedRound)
            {
                return reserveAmmo > 0
                    ? State(RoaWeaponReadinessKind.Empty, "ПУСТО · R", false)
                    : State(RoaWeaponReadinessKind.NoAmmo, "НЕТ ПАТРОНОВ", false);
            }

            if (actionPoints + 0.001f < Mathf.Max(0, actionPointCost))
                return State(RoaWeaponReadinessKind.LowActionPoints,
                    "НУЖНО " + Mathf.Max(0, actionPointCost) + " ОД", false);

            if (cooldownSeconds > 0.045f)
            {
                float shown = Mathf.Ceil(cooldownSeconds * 10f) * 0.1f;
                return State(RoaWeaponReadinessKind.Cooldown,
                    "ГОТОВО ЧЕРЕЗ " + shown.ToString("0.0") + " С", false);
            }

            return State(RoaWeaponReadinessKind.Ready, "ГОТОВО", true);
        }

        private static Frame State(RoaWeaponReadinessKind kind, string label, bool canAttack)
        {
            return new Frame { Kind = kind, Label = label, CanAttack = canAttack };
        }
    }
}
