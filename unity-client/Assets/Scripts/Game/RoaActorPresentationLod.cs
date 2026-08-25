using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Стоимость визуальной позы удалённого персонажа.</summary>
    public enum RoaActorPresentationTier
    {
        Hidden,
        Far,
        Near
    }

    /// <summary>
    /// Единое правило LOD для игроков и человекоподобных NPC. Оно не меняет
    /// серверное движение, коллайдеры или бой — только стоимость визуальной позы.
    /// </summary>
    public static class RoaActorPresentationLod
    {
        public const float DesktopNearDistance = 20f;
        public const float MobileNearDistance = 12f;
        public const float DesktopNearReentryDistance = 18f;
        public const float MobileNearReentryDistance = 10.5f;

        public static RoaActorPresentationTier Select(Vector3 actor, Vector3 observer,
                                                       bool visible, bool mobile,
                                                       RoaActorPresentationTier previous)
        {
            if (!visible) return RoaActorPresentationTier.Hidden;

            float limit = previous == RoaActorPresentationTier.Near
                ? (mobile ? MobileNearDistance : DesktopNearDistance)
                : (mobile ? MobileNearReentryDistance : DesktopNearReentryDistance);
            float dx = actor.x - observer.x;
            float dz = actor.z - observer.z;
            return dx * dx + dz * dz <= limit * limit
                ? RoaActorPresentationTier.Near
                : RoaActorPresentationTier.Far;
        }
    }
}
