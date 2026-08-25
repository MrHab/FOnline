using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Проверяет непрерывную коллизию ствола без запуска сцены.</summary>
    public static class RoaWeaponCollisionProbe
    {
        [MenuItem("Realm of Ashes/Проверить коллизию оружия")]
        public static void Run()
        {
            var owner = new GameObject("ProbeOwner");
            var ownBody = owner.AddComponent<CapsuleCollider>();
            ownBody.radius = 0.35f;
            ownBody.height = 1.8f;

            var weapon = new GameObject("ProbeWeapon");
            weapon.transform.SetParent(owner.transform, false);
            weapon.AddComponent<BoxCollider>().size = new Vector3(0.1f, 0.1f, 0.5f);

            var wall = GameObject.CreatePrimitive(PrimitiveType.Cube);
            wall.name = "ThinProbeWall";
            wall.transform.position = new Vector3(0f, 0f, 0.52f);
            wall.transform.localScale = new Vector3(1f, 1f, 0.025f);
            Physics.SyncTransforms();

            Vector3 start = new Vector3(0f, 0f, 0.08f);
            Vector3 end = new Vector3(0f, 0f, 0.95f);
            bool blocked = RoaWeaponView.IsSegmentBlocked(start, end, 0.18f,
                owner.transform, weapon.transform);

            Object.DestroyImmediate(wall);
            Physics.SyncTransforms();

            bool selfBlocked = RoaWeaponView.IsSegmentBlocked(start, end, 0.18f,
                owner.transform, weapon.transform);

            Object.DestroyImmediate(owner);

            if (!blocked)
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] тонкая стена не обнаружена");
            if (selfBlocked)
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] собственный коллайдер принят за стену");

            Debug.Log("[КОЛЛИЗИЯ ОРУЖИЯ] готово: непрерывный щуп видит тонкую стену и игнорирует владельца");
        }

        public static void RunBatch()
        {
            Run();
        }
    }
}
