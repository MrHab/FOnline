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
            wall.transform.position = new Vector3(0f, 0f, 0.42f);
            wall.transform.localScale = new Vector3(1f, 1f, 0.025f);
            Physics.SyncTransforms();

            Vector3 start = new Vector3(0f, 0f, 0.08f);
            Vector3 end = new Vector3(0f, 0f, 0.95f);
            float nearAmount = RoaWeaponView.ObstructionAmount(start, end, 0.18f,
                owner.transform, weapon.transform);

            wall.transform.position = new Vector3(0f, 0f, 0.84f);
            Physics.SyncTransforms();
            float farAmount = RoaWeaponView.ObstructionAmount(start, end, 0.18f,
                owner.transform, weapon.transform);

            Object.DestroyImmediate(wall);
            Physics.SyncTransforms();

            float selfAmount = RoaWeaponView.ObstructionAmount(start, end, 0.18f,
                owner.transform, weapon.transform);

            float thirtyFps = 0f;
            for (int i = 0; i < 30; i++)
                thirtyFps = RoaWeaponView.SmoothObstruction(thirtyFps, 0.72f, 1f / 30f);
            float highFps = 0f;
            for (int i = 0; i < 144; i++)
                highFps = RoaWeaponView.SmoothObstruction(highFps, 0.72f, 1f / 144f);

            Object.DestroyImmediate(owner);

            if (nearAmount < 0.75f)
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] близкая тонкая стена не дала полный упор");
            if (farAmount <= 0.08f || farAmount >= nearAmount - 0.2f)
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] дальняя стена не дала частичный подъём");
            if (selfAmount > 0f)
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] собственный коллайдер принят за стену");
            if (Mathf.Abs(thirtyFps - highFps) > 0.002f)
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] скорость подъёма зависит от FPS");

            float threshold = RoaWeaponView.FireBlockThreshold;
            if (RoaWeaponView.BlocksFire("pistol", threshold - 0.01f)
                || !RoaWeaponView.BlocksFire("pistol", threshold)
                || !RoaWeaponView.BlocksFire("pistol", 0f, threshold + 0.01f)
                || RoaWeaponView.BlocksFire("knife", 1f))
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] механический запрет не совпал с high-ready");

            float bumpStart = RoaWeaponView.ContactBumpEnvelope(0f);
            float bumpPeak = RoaWeaponView.ContactBumpEnvelope(0.09f);
            float bumpEnd = RoaWeaponView.ContactBumpEnvelope(0.18f);
            if (bumpStart > 0.001f || bumpPeak < 0.99f || bumpEnd > 0.001f)
                throw new System.Exception("[КОЛЛИЗИЯ ОРУЖИЯ] контактный толчок не имеет чистой огибающей");

            Debug.Log("[КОЛЛИЗИЯ ОРУЖИЯ] готово: near=" + nearAmount.ToString("0.00")
                + ", far=" + farAmount.ToString("0.00") + ", запрет="
                + threshold.ToString("0.00") + ", 30/144 FPS="
                + thirtyFps.ToString("0.000") + "/" + highFps.ToString("0.000"));
        }

        public static void RunBatch()
        {
            Run();
        }
    }
}
