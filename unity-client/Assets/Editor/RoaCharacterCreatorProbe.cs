#if UNITY_EDITOR
using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCharacterCreatorProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить создание персонажа";

        [MenuItem(MenuPath)]
        private static void Run()
        {
            try
            {
                var creator = new RoaCharacterCreator();
                Require(creator.SpecialSum == 35 && creator.PointsLeft == 5,
                        "начальный бюджет SPECIAL должен оставлять 5 очков");
                foreach (string id in new[] { "per", "end", "int", "agi", "luck" })
                    Require(creator.AdjustStat(id, 1), "не удалось поднять " + id);
                Require(creator.SpecialSum == 40 && creator.PointsLeft == 0,
                        "SPECIAL не собрал канонические 40 очков");
                Require(!creator.AdjustStat("str", 1), "SPECIAL позволил превысить бюджет");

                Require(creator.ToggleSkill("lightWeapons"), "не выбрался профильный навык");
                Require(creator.ToggleSkill("doctor"), "не выбрался второй профильный навык");
                Require(!creator.ToggleSkill("science") && creator.SelectedSkillCount == 2,
                        "удалось выбрать больше двух навыков");
                Require(creator.ToggleTrait("trainedEye"), "не выбрался стартовый перк");
                Require(creator.ToggleTrait("educatedStart"), "не выбрался второй стартовый перк");
                Require(!creator.ToggleTrait("bruiser") && creator.SelectedTraitCount == 2,
                        "удалось выбрать больше двух перков");

                creator.SetSex("female");
                Require(creator.Appearance.Sex == "female"
                        && creator.Appearance.FaceId == "female_01"
                        && creator.Appearance.HairId == "tied_back"
                        && RoaCharacterCreator.AppearanceIsValid(creator.Appearance),
                        "женская внешность не нормализовалась");
                Require(creator.Ready("Пыль"), "полный валидный черновик не готов к созданию");

                CharacterSpecial special = creator.BuildSpecial();
                Require(special.Total == 40 && special.Perception == 6 && special.Agility == 6,
                        "сетевой SPECIAL отличается от формы");
                Require(creator.SkillBasePercent("lightWeapons", false) == 33
                        && creator.SkillBasePercent("lightWeapons", true) == 38,
                        "предпросмотр базы профильного навыка не совпал с web");

                RoaCharacterCreator.DerivedStats derived = creator.Derived();
                Require(derived.MaxHp == 109 && derived.MaxAp == 8 && derived.Hit == 9
                        && derived.VisionRadius == 10 && derived.CriticalChance == 6,
                        "производные параметры не совпали с web");

                var request = new JoinRequest
                {
                    CharacterId = "probe",
                    Name = "Пыль",
                    Appearance = creator.Appearance,
                    Special = special,
                    TaggedSkills = creator.TaggedSkills,
                    Traits = creator.SelectedTraits
                };
                JObject json = JObject.Parse(JsonConvert.SerializeObject(request));
                Require(json["special"]?["str"]?.Value<int>() == 5
                        && json["special"]?["per"]?.Value<int>() == 6
                        && json["appearance"]?["schema"]?.ToString() == "realm.character-appearance.v1"
                        && json["appearance"]?["skinToneId"]?.ToString() == "skin_03"
                        && json["taggedSkills"] is JArray skills && skills.Count == 2
                        && json["traits"] is JArray traits && traits.Count == 2,
                        "join потерял SPECIAL, навыки или перки");

                var automatic = new RoaCharacterCreator();
                automatic.PrepareAutomaticDefault();
                Require(automatic.Ready("Странник") && automatic.BuildSpecial().Total == 40,
                        "отладочный авто-вход не создаёт валидного персонажа");

                Debug.Log("[СОЗДАНИЕ ПЕРСОНАЖА] готово: SPECIAL=" + special.Total
                    + ", навыки=" + creator.SelectedSkillCount
                    + ", перки=" + creator.SelectedTraitCount
                    + ", ОЗ/ОД=" + derived.MaxHp + "/" + derived.MaxAp);
            }
            catch (Exception error)
            {
                Debug.LogError("[СОЗДАНИЕ ПЕРСОНАЖА] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
