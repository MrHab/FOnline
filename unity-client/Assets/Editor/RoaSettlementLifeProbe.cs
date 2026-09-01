#if UNITY_EDITOR
using System;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaSettlementLifeProbe
    {
        [MenuItem("Realm of Ashes/Проверить Settlement Life 5.1")]
        public static void Run()
        {
            GameObject root = null;
            try
            {
                Require(RoaEnemies.NpcActivityLabel("work", "use") == "РАБОТАЕТ"
                    && RoaEnemies.NpcActivityLabel("shop", "use") == "ТОРГУЕТ"
                    && RoaEnemies.NpcActivityLabel("guard", "use") == "НА ПОСТУ"
                    && RoaEnemies.NpcActivityLabel("social", "use") == "ОБЩАЕТСЯ"
                    && RoaEnemies.NpcActivityLabel("work", "travel") == "ИДЁТ К МЕСТУ",
                    "занятия жителей не читаются над HP");

                string worker = RoaEnemies.NpcCombatFactionLine(
                    "old_klim", false, "work", false, false, "work", "use");
                string alarm = RoaEnemies.NpcCombatFactionLine(
                    "old_klim", false, "alarm", false, false, "work", "use");
                string resumed = RoaEnemies.NpcCombatFactionLine(
                    "old_klim", false, "work", false, false, "work", "use");
                Require(worker.StartsWith("РАБОТАЕТ · ")
                    && alarm.StartsWith("ТРЕВОГА · ")
                    && resumed.StartsWith("РАБОТАЕТ · "),
                    "тревога не перекрывает распорядок или распорядок не возвращается");

                Require(RoaEnemies.ResolveNpcActivityVisual(
                        "craft", "use", "work", "work", false, false) == "work"
                    && RoaEnemies.ResolveNpcActivityVisual(
                        "shop", "use", "shop", "work", false, false) == "shop"
                    && RoaEnemies.ResolveNpcActivityVisual(
                        "social", "use", "social", "social", false, false) == "social",
                    "серверные visualAction не превращаются в различимые позы");
                Require(string.IsNullOrEmpty(RoaEnemies.ResolveNpcActivityVisual(
                        "work", "travel", "walk", "work", false, false))
                    && string.IsNullOrEmpty(RoaEnemies.ResolveNpcActivityVisual(
                        "work", "use", "work", "combat", false, false))
                    && string.IsNullOrEmpty(RoaEnemies.ResolveNpcActivityVisual(
                        "work", "use", "work", "work", true, false))
                    && string.IsNullOrEmpty(RoaEnemies.ResolveNpcActivityVisual(
                        "work", "use", "work", "work", false, true)),
                    "работа может перебить путь, бой или смерть");

                float phaseA = RoaEnemies.StableActivityPhase01("worker-a");
                float phaseB = RoaEnemies.StableActivityPhase01("worker-b");
                Require(phaseA >= 0f && phaseA <= 1f && phaseB >= 0f && phaseB <= 1f
                    && !Mathf.Approximately(phaseA, phaseB),
                    "жители снова получили синхронную фазу жестов");

                root = new GameObject("Settlement life probe");
                RoaCharacterView view = root.AddComponent<RoaCharacterView>();
                view.SetActivityPresentation("SoCiAl", phaseA);
                Require(view.ActivityPresentation == "social"
                    && Mathf.Approximately(view.ActivityPresentationWeight, 0f),
                    "процедурный слой не принимает занятие безопасно до загрузки модели");

                Debug.Log("[SETTLEMENT LIFE 5.1] готово: работа/торговля/пост/общение читаются, "
                    + "тревога имеет приоритет, жители двигаются в разных фазах.");
            }
            catch (Exception error)
            {
                Debug.LogError("[SETTLEMENT LIFE 5.1] ошибка: " + error.Message);
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
