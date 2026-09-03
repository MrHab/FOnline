#if UNITY_EDITOR
using System;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaNpcCombatBehaviorProbe
    {
        [MenuItem("Realm of Ashes/Проверить NPC Combat Readability 4.7")]
        public static void Run()
        {
            GameObject root = null;
            try
            {
                root = new GameObject("NPC combat behavior probe");
                root.AddComponent<RoaVisibilityGate>();
                RoaEnemies.BodyProfile humanoid = RoaEnemies.PresentationBodyProfile(
                    "enemyRaider", true);
                CapsuleCollider capsule = RoaEnemies.InstallPresentationBody(root,
                    humanoid, out Rigidbody body);

                Require(capsule != null && !capsule.isTrigger && capsule.enabled
                    && Mathf.Approximately(capsule.radius, 0.38f)
                    && capsule.height >= 1.8f,
                    "у человекоподобного NPC нет полноценного твёрдого тела");
                Require(body != null && body.isKinematic && !body.useGravity
                    && body.detectCollisions,
                    "тело NPC не настроено как управляемое сетевой презентацией");
                Require(RoaCharacterView.IsActorCollider(capsule, null),
                    "контроллер игрока не распознаёт коллайдер NPC как актёра");

                Vector3 player = new Vector3(3f, 0.9f, -2f);
                Vector3 overlapping = new Vector3(3.1f, 0f, -2f);
                Vector3 separated = RoaEnemies.ResolvePresentationContact(overlapping,
                    player, 0.81f, 45f);
                Vector2 planar = new Vector2(separated.x - player.x,
                    separated.z - player.z);
                Require(Mathf.Abs(planar.magnitude - 0.81f) < 0.001f
                    && Mathf.Approximately(separated.y, overlapping.y),
                    "визуальный NPC не вышел из контакта, не меняя высоту земли");

                Vector3 exactOverlap = RoaEnemies.ResolvePresentationContact(player,
                    player, 0.81f, 137f);
                Require(new Vector2(exactOverlap.x - player.x,
                    exactOverlap.z - player.z).magnitude > 0.80f,
                    "полное совпадение позиций не получило устойчивое направление выхода");
                Require(Mathf.Approximately(RoaEnemies.StableContactAngle("raider-a"),
                        RoaEnemies.StableContactAngle("raider-a"))
                    && !Mathf.Approximately(RoaEnemies.StableContactAngle("raider-a"),
                        RoaEnemies.StableContactAngle("raider-b")),
                    "направление выхода из контакта недетерминировано");

                Require(RoaEnemies.CombatMotionLocked(true, false, 0f, 10f)
                    && RoaEnemies.CombatMotionLocked(false, true, 0f, 10f)
                    && RoaEnemies.CombatMotionLocked(false, false, 10.2f, 10f)
                    && !RoaEnemies.CombatMotionLocked(false, false, 9.9f, 10f),
                    "атака или смерть больше не имеют приоритета над ходьбой");
                Require(RoaEnemies.CombatMotionLocked(false, false, 0f, 10.2f, 10f)
                    && !RoaEnemies.CombatMotionLocked(false, false, 0f, 9.9f, 10f),
                    "реакция на попадание не владеет движением в своём коротком окне");
                Require(RoaEnemies.ResolveFrameHealth(80, 55, false, false) == 55
                    && RoaEnemies.ResolveFrameHealth(80, 55, false, true) == 80
                    && RoaEnemies.ResolveFrameHealth(80, 0, true, false) == 0,
                    "компактный сетевой кадр теряет HP, ломает melee-контакт или смерть");
                Require(RoaEnemies.IsCombatAiState("attack")
                    && RoaEnemies.IsCombatAiState("stagger")
                    && !RoaEnemies.IsCombatAiState("idle"),
                    "боевые состояния NPC классифицируются непоследовательно");
                Require(RoaEnemies.NpcCombatFactionLine("raiders", true,
                        "attack", true).StartsWith("АТАКУЕТ ВАС · ")
                    && RoaEnemies.NpcCombatFactionLine("raiders", true,
                        "chase", false).StartsWith("СБЛИЖАЕТСЯ · ")
                    && RoaEnemies.NpcCombatFactionLine("old_klim", false,
                        "idle", false).StartsWith("МИРНЫЙ · "),
                    "плашка NPC не объясняет принадлежность и текущую угрозу");

                RoaEnemies.SetPresentationBodyAlive(capsule, body, false);
                Require(!capsule.enabled && !body.detectCollisions,
                    "труп продолжает блокировать игрока");
                RoaEnemies.SetPresentationBodyAlive(capsule, body, true);
                Require(capsule.enabled && body.detectCollisions,
                    "живой NPC не восстановил физическое тело");

                Debug.Log("[NPC COMBAT 4.7] готово: HP=live-frame, реакция=приоритет, "
                    + "угроза=читаема, смерть=атомарна, контакт/foot IK=защищены.");
            }
            catch (Exception error)
            {
                Debug.LogError("[NPC COMBAT 4.7] ошибка: " + error.Message);
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
