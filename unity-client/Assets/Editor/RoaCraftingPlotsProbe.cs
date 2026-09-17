#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Комиссия заказа на участке станка (экономика v3) считается на клиенте
    /// так же, как сервер (plotCraftFee): без участка — комиссия рецепта,
    /// своему арендатору — даром, гостю — доля стоимости изделия по ставке
    /// арендатора, свободный участок — ставка поселения, не меньше комиссии.
    /// Unity.exe -batchmode -executeMethod RealmOfAshes.EditorTools.RoaCraftingPlotsProbe.Run -quit
    /// </summary>
    public static class RoaCraftingPlotsProbe
    {
        [MenuItem("Realm of Ashes/Проверить плату участков станков")]
        public static void Run()
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            JObject items = JObject.Parse(File.ReadAllText(Path.Combine(root, "data/kromka/items.json")));
            Require(RoaItemData.ApplyCatalog(items, out string itemError), "каталог предметов отклонён: " + itemError);
            JObject recipes = JObject.Parse(File.ReadAllText(Path.Combine(root, "data/kromka/field-recipes.json")));
            Require(RoaCraftingData.ApplyCatalog(recipes, out string recipeError), "каталог рецептов отклонён: " + recipeError);

            RoaCraftRecipe knife = RoaCraftingData.Recipes.FirstOrDefault(row => row.Id == "knifecraft");
            RoaCraftRecipe pistol = RoaCraftingData.Recipes.FirstOrDefault(row => row.Id == "pistolcraft");
            Require(knife != null && pistol != null, "в каталоге нет ножа или пистолета");
            int knifePrice = RoaItemData.BasePrice("knife");
            int pistolPrice = RoaItemData.BasePrice("pistol");

            try
            {
                RoaCraftingPlots.Clear();
                Require(knife.Fee == knife.BaseFee, "без участка комиссия не совпадает с рецептом");

                RoaCraftingPlots.Apply(JObject.Parse(
                    "{\"locationId\":\"scrapTown\",\"payout\":7,\"plots\":["
                    + "{\"plotId\":\"a\",\"objectId\":\"bench_weapon\",\"station\":\"weapon_bench\",\"leased\":true,\"mine\":false,\"feePct\":0.2},"
                    + "{\"plotId\":\"b\",\"objectId\":\"bench_tool\",\"station\":\"tool_bench\",\"leased\":false,\"mine\":false,\"feePct\":0.15}]}"));
                Require(RoaCraftingPlots.LastPayout == 7, "выплата участков не прочитана");
                Require(RoaCraftingPlots.ForObject("bench_tool")?["plotId"]?.ToString() == "b", "участок не находится по объекту");
                // 15 × 0,2 в double — 3,0000000000000004; плата всё равно 3, как на сервере.
                int expectedKnife = Math.Max(knife.BaseFee, (int)Math.Ceiling(Math.Round(knifePrice * 0.2d, 6)));
                Require(knife.Fee == expectedKnife, "плата гостя за нож " + knife.Fee + " вместо " + expectedKnife);
                int expectedPistol = Math.Max(pistol.BaseFee, (int)Math.Ceiling(Math.Round(pistolPrice * 0.2d, 6)));
                Require(pistol.Fee == expectedPistol, "плата гостя за пистолет " + pistol.Fee + " вместо " + expectedPistol);

                RoaCraftingPlots.Apply(JObject.Parse(
                    "{\"locationId\":\"scrapTown\",\"plots\":[{\"plotId\":\"a\",\"objectId\":\"bench_weapon\",\"station\":\"weapon_bench\",\"leased\":true,\"mine\":true,\"feePct\":0.2}]}"));
                Require(knife.Fee == 0, "арендатор платит за свой станок");

                RoaCraftingPlots.Apply(JObject.Parse(
                    "{\"locationId\":\"scrapTown\",\"plots\":[{\"plotId\":\"a\",\"objectId\":\"bench_weapon\",\"station\":\"weapon_bench\",\"leased\":false,\"mine\":false,\"feePct\":0}]}"));
                Require(knife.Fee == knife.BaseFee, "плата ниже комиссии рецепта");
                Debug.Log("RoaCraftingPlotsProbe: knife " + expectedKnife + ", pistol " + expectedPistol + "\nOK");
            }
            finally
            {
                RoaCraftingPlots.Clear();
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("RoaCraftingPlotsProbe: " + message);
        }
    }
}
#endif
