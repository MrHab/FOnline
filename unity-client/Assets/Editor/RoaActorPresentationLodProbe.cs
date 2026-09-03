#if UNITY_EDITOR
using System;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaActorPresentationLodProbe
    {
        [MenuItem("Realm of Ashes/Проверить LOD анимации персонажей")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                Vector3 observer = Vector3.zero;
                Require(RoaActorPresentationLod.Select(Vector3.zero, observer, false, false,
                            RoaActorPresentationTier.Near) == RoaActorPresentationTier.Hidden,
                    "невидимый персонаж не перешёл в Hidden LOD");
                Require(RoaActorPresentationLod.Select(new Vector3(17.9f, 0f, 0f), observer, true, false,
                            RoaActorPresentationTier.Far) == RoaActorPresentationTier.Near,
                    "дальний персонаж не вернулся в Near LOD внутри desktop-порога");
                Require(RoaActorPresentationLod.Select(new Vector3(19f, 0f, 0f), observer, true, false,
                            RoaActorPresentationTier.Far) == RoaActorPresentationTier.Far,
                    "desktop-гистерезис не удержал Far LOD");
                Require(RoaActorPresentationLod.Select(new Vector3(19.9f, 7f, 0f), observer, true, false,
                            RoaActorPresentationTier.Near) == RoaActorPresentationTier.Near,
                    "LOD ошибочно учитывает высоту камеры вместо плоской дистанции");
                Require(RoaActorPresentationLod.Select(new Vector3(12.1f, 0f, 0f), observer, true, true,
                            RoaActorPresentationTier.Near) == RoaActorPresentationTier.Far,
                    "mobile-порог не снижает стоимость дальнего персонажа");

                host = new GameObject("ActorPresentationLodProbe");
                var view = host.AddComponent<RoaCharacterView>();
                view.SetPresentationLod(RoaActorPresentationTier.Far);
                Require(view.PresentationTier == RoaActorPresentationTier.Far
                        && !view.ProceduralPresentationActive,
                    "Far LOD оставил процедурную позу активной");
                view.SetPresentationLod(RoaActorPresentationTier.Hidden);
                Require(view.PresentationTier == RoaActorPresentationTier.Hidden,
                    "CharacterView не принял Hidden LOD");
                view.SetPresentationLod(RoaActorPresentationTier.Near);
                Require(view.ProceduralPresentationActive,
                    "Near LOD не вернул полную позу");

                Debug.Log("[LOD ПЕРСОНАЖЕЙ] готово: Near "
                    + RoaActorPresentationLod.DesktopNearDistance + "/"
                    + RoaActorPresentationLod.MobileNearDistance
                    + " м, дальние без процедурного IK, невидимые с renderer culling");
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
