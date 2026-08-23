#if UNITY_EDITOR
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.Editor
{
    public static class RoaItemDataProbe
    {
        [MenuItem("Realm of Ashes/Probe/Item Catalog and Carry")]
        public static void Run()
        {
            Require(RoaItemData.Contains("pistol"), "pistol отсутствует в каталоге");
            Require(RoaItemData.Contains("ui_assaultRifle_a_b"), "runtime-id не разрешён");
            Require(RoaItemData.Name("doctorBag") == "Набор доктора", "неверная подпись предмета");
            Require(Mathf.Abs(RoaItemData.Weight("ammo9") - 0.025f) < 0.0001f, "неверный вес боеприпаса");
            Require(Mathf.Abs(RoaItemData.Weight("heavyArmor") - 14f) < 0.0001f, "неверный вес брони");
            Require(Mathf.Abs(RoaItemData.CarryCapacity(5, false) - 70f) < 0.0001f, "неверная базовая грузоподъёмность");
            Require(Mathf.Abs(RoaItemData.CarryCapacity(5, true) - 90f) < 0.0001f, "неверный бонус рюкзака");
            Require(Mathf.Abs(RoaItemData.CarryCapacity(99, false) - 150f) < 0.0001f, "Сила не ограничена серверным максимумом");
            Debug.Log("[ПРЕДМЕТЫ/ВЕС] готово.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new System.InvalidOperationException("[ПРЕДМЕТЫ/ВЕС] " + message);
        }
    }
}
#endif
