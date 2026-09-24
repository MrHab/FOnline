#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
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

        [MenuItem("Realm of Ashes/PolygonApocalypse/Validate inventory art")]
        public static void ValidateApocalypseInventory()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../data/kromka/items.json"));
            JObject catalog = JObject.Parse(File.ReadAllText(path));
            if (!RoaItemData.ApplyCatalog(catalog, out string error))
                throw new InvalidOperationException(error);
            int count = 0;
            foreach (JToken row in catalog["items"] as JArray ?? new JArray())
            {
                string id = row["id"]?.ToString();
                Texture2D texture = Resources.Load<Texture2D>("RealmUi/items/item_" + id);
                Sprite icon = RoaApocalypseItemIcons.For(id);
                Require(texture != null && icon != null && icon.texture == texture,
                    "нет игрового значка: " + id);
                count++;
            }
            Require(RoaItemData.Name("smg") == "ПП «Шорох»", "старое оружие не обновлено");
            Require(RoaItemInfo.Desc("smg") == RoaItemData.Description("smg"),
                "описание оружия осталось старым");
            Require(RoaGearData.Tier("smg") == 3, "тир оружия не загружен");
            Require(RoaApocalypseModels.Weapon("smg")?.name == "SM_Wep_SubMGun_01",
                "старый пистолет-пулемёт не получил модель пака");
            Require(RoaApocalypseModels.Weapon("pickaxe")?.name == "SM_Wep_Spade_01",
                "инструмент добычи не получил модель пака");
            Debug.Log("[ROA APOCALYPSE] Inventory art PASS: " + count
                + " catalog items, new names, descriptions, tiers and pack prefabs.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new System.InvalidOperationException("[ПРЕДМЕТЫ/ВЕС] " + message);
        }
    }
}
#endif
