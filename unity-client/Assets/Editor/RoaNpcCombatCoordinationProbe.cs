#if UNITY_EDITOR
using System;
using RealmOfAshes.Game;
using UnityEditor;

namespace RealmOfAshes.EditorTools
{
    public static class RoaNpcCombatCoordinationProbe
    {
        [MenuItem("Realm of Ashes/Проверить NPC Coordination 5.0")]
        public static void Run()
        {
            try
            {
                Require(RoaEnemies.IsCombatAiState("pressure")
                    && RoaEnemies.IsCombatAiState("attack")
                    && !RoaEnemies.IsCombatAiState("idle"),
                    "ожидающий своей атаки NPC выпал из боевого состояния");

                Require(RoaEnemies.NpcIntentLabel("pressure", true, false) == "ИЩЕТ МОМЕНТ"
                    && RoaEnemies.NpcIntentLabel("reload", true, false) == "ПЕРЕЗАРЯЖАЕТСЯ"
                    && RoaEnemies.NpcIntentLabel("retreat", true, false) == "ОТСТУПАЕТ"
                    && RoaEnemies.NpcIntentLabel("chase", true, false) == "СБЛИЖАЕТСЯ",
                    "боевые намерения NPC не различаются в HUD");
                Require(RoaEnemies.NpcIntentLabel("attack", true, true, false) == "АТАКУЕТ ВАС"
                    && RoaEnemies.NpcIntentLabel("attack", true, true, true) == "ЦЕЛИТСЯ В ВАС",
                    "личная ближняя и дальняя угроза не различаются");

                string pressureLine = RoaEnemies.NpcCombatFactionLine(
                    "raiders", true, "pressure", false);
                string friendlyLine = RoaEnemies.NpcCombatFactionLine(
                    "old_klim", false, "idle", false);
                Require(pressureLine.StartsWith("ИЩЕТ МОМЕНТ · ")
                    && friendlyLine.StartsWith("МИРНЫЙ · "),
                    "строка над HP потеряла намерение или принадлежность");

                var entry = new RoaActorNameplates.Entry
                {
                    Faction = pressureLine,
                    Hp = 75,
                    MaxHp = 100,
                    Hostile = true
                };
                RoaActorNameplates.Presentation presentation =
                    RoaActorNameplates.ResolvePresentation(entry, false, 6f, 20f);
                Require(presentation.ShowFaction && presentation.ShowHealthText
                    && presentation.Alpha >= 0.68f,
                    "активное намерение врага исчезает на боевой дистанции");

                Require(RoaEnemies.ResolveFrameDeadState(true, false, false)
                    && RoaEnemies.CombatMotionLocked(true, false, 0f, 0f, 10f),
                    "поздний кадр может оживить движение погибшего NPC");

                UnityEngine.Debug.Log("[NPC COORDINATION 5.0] готово: атаки=ротация 1/2/3, "
                    + "намерения=сближение/давление/атака/перезарядка/отступление, смерть=терминальна.");
            }
            catch (Exception error)
            {
                UnityEngine.Debug.LogError("[NPC COORDINATION 5.0] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
