#if UNITY_EDITOR
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaHitReactionProbe
    {
        [MenuItem("Realm of Ashes/Проверить реакцию на попадание")]
        public static void Run()
        {
            GameObject actor = new GameObject("HitReactionActor");
            try
            {
                Transform parent = actor.transform;
                Transform spine01 = Bone(parent, "spine_01");
                Transform spine02 = Bone(spine01, "spine_02");
                Transform spine03 = Bone(spine02, "spine_03");
                Transform neck = Bone(spine03, "neck_01");
                Transform head = Bone(neck, "head");

                var reaction = new RoaHitReaction();
                reaction.Bind(actor.transform);
                Require(reaction.Ready, "цепь позвоночника не привязалась");
                Require(RoaHitReaction.Envelope(0f) == 0f
                        && RoaHitReaction.Envelope(RoaHitReaction.ImpactSeconds) > 0.99f
                        && RoaHitReaction.Envelope(RoaHitReaction.Duration) == 0f,
                        "огибающая не имеет быстрого удара и полного возврата");

                RoaHitReaction.PoseSample right = RoaHitReaction.Sample(Vector2.right, 1f);
                RoaHitReaction.PoseSample left = RoaHitReaction.Sample(Vector2.left, 1f);
                RoaHitReaction.PoseSample front = RoaHitReaction.Sample(Vector2.up, 1f);
                RoaHitReaction.PoseSample rear = RoaHitReaction.Sample(Vector2.down, 1f);
                Require(right.Spine03.z < -0.04f && left.Spine03.z > 0.04f,
                        "боковые попадания не дают противоположный крен");
                Require(front.Spine02.x < -0.06f && rear.Spine02.x > 0.06f,
                        "переднее и заднее попадание не дают противоположный наклон");

                reaction.Trigger(actor.transform, actor.transform.position + actor.transform.right * 3f,
                                 true, 46, true);
                reaction.Apply(RoaHitReaction.ImpactSeconds);
                Require(reaction.Active && reaction.LocalSourceDirection.x > 0.98f,
                        "мировой источник не преобразовался в локальное направление");
                Require(Quaternion.Angle(Quaternion.identity, spine02.localRotation) > 3f
                        && Quaternion.Angle(Quaternion.identity, head.localRotation) > 1f,
                        "пиковая реакция не изменила позвоночник и голову");

                for (int i = 0; i < 6; i++) reaction.Apply(0.08f);
                Require(!reaction.Active && reaction.CurrentWeight == 0f,
                        "реакция не завершилась за отведённое время");
                Debug.Log("[РЕАКЦИЯ НА УРОН] готово: направление=±крен/±наклон, "
                    + "пик=" + RoaHitReaction.ImpactSeconds.ToString("0.00")
                    + "с, возврат=" + RoaHitReaction.Duration.ToString("0.00") + "с");
            }
            finally
            {
                Object.DestroyImmediate(actor);
            }
        }

        private static Transform Bone(Transform parent, string name)
        {
            var node = new GameObject(name);
            node.transform.SetParent(parent, false);
            node.transform.localPosition = Vector3.up * 0.2f;
            return node.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new System.InvalidOperationException(message);
        }
    }
}
#endif
