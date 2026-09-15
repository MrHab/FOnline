#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Зоны мира в клиенте: баннер режима зоны, панель аванпостов/событий/босса/PvE
    /// и карточки артефактов с тиром. Проверяются чистые форматтеры на серверных
    /// снимках — без сокета и без ожидания.
    /// </summary>
    public static class RoaWorldZonesUiProbe
    {
        [MenuItem("Realm of Ashes/Probe/World zones UI")]
        public static void Run()
        {
            Require(RoaHudCanvas.ZoneModeBannerText("pve").Contains("PvE") && RoaHudCanvas.ZoneModeBannerText("pve").Contains("СОХРАНЯЮТСЯ"),
                "PvE banner must promise no PvP and no loss");
            Require(RoaHudCanvas.ZoneModeBannerText("pvpEvent").Contains("СОХРАНЯЮТСЯ"), "Event banner must promise no loss");
            Require(RoaHudCanvas.ZoneModeBannerText("pvpFullDrop").Contains("ЭКИПИРОВКА ЦЕЛА") && !RoaHudCanvas.ZoneModeBannerText("pvpFullDrop").Contains("ПОЛН"),
                "Territory banner must describe partial loss, never full loot");

            var territory = JObject.Parse(@"{'zoneLocationId':'coreZone','factionNames':{'uprava':'Управа','free_artels':'Артели'},'outposts':[
                {'id':'north','displayName':'Северный','ownerFactionId':'uprava','eventStatus':'closed','eventOpensInMs':754000,'capture':{'progress':{},'leadingFactionId':'','contested':false},'garrison':{'state':'arrived'}},
                {'id':'east','displayName':'Восточный','ownerFactionId':'','eventStatus':'open','eventOpensInMs':0,'capture':{'progress':{'free_artels':0.42},'leadingFactionId':'free_artels','contested':true},'garrison':{'state':'enroute'}}]}");
            string outposts = RoaWorldEventsPresentation.DescribeOutposts(territory, "coreZone");
            Require(outposts.Contains("Северный: Управа") && outposts.Contains("захват через 12:34") && outposts.Contains("прибыл"), "Locked outpost shows owner, countdown and garrison");
            Require(outposts.Contains("Восточный: нейтральный") && outposts.Contains("ЗАХВАТ ОТКРЫТ") && outposts.Contains("Артели 42%") && outposts.Contains("ОСПАРИВАЕТСЯ") && outposts.Contains("в пути"),
                "Open outpost shows capture progress, contest and garrison state");
            Require(RoaWorldEventsPresentation.DescribeOutposts(territory, "settlement") == string.Empty, "Outposts stay hidden outside the core zone");

            var publicEvent = JObject.Parse(@"{'roomId':'randomAshGrove#pubev_1','displayName':'Логово Гари','remainingSeconds':1500,'warning':false,'cleared':true,'chestOpen':false,'chestClaimed':false,'chestOpensInSeconds':50}");
            string eventText = RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 5);
            Require(eventText.Contains("ЛОГОВО ГАРИ · 24:55") && eventText.Contains("откроется через 45 с") && eventText.Contains("PvP разрешено"),
                "Cleared event counts the contested chest down with elapsed time");
            publicEvent["warning"] = true; publicEvent["chestOpen"] = true;
            Require(RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 0).Contains("СКОРО ЗАКРОЕТСЯ")
                && RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 0).Contains("ТАЙНИК ОТКРЫТ"),
                "Warning and open chest are announced");
            Require(RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "otherRoom", 0) == string.Empty, "Events of other rooms are hidden");
            publicEvent["rejoinInSeconds"] = 70;
            Require(RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 10).Contains("через 60 с"), "Death rejoin delay is shown");

            var boss = JObject.Parse(@"{'roomId':'coreLabCenterReactor','displayName':'Хранитель Нуля','phase':'shielded','phaseLabel':'Щит активен','nodesAlive':2,'nodesTotal':4,'pulseInSeconds':12,'pulseTelegraph':false,'bossHp':1800,'bossMaxHp':1800,'pulseRadius':9}");
            string bossText = RoaWorldEventsPresentation.DescribeWorldBoss(boss, "coreLabCenterReactor", 2);
            Require(bossText.Contains("Узлы щита: 2/4") && bossText.Contains("Импульс через 10 с") && bossText.Contains("HP 1800/1800"), "Shielded boss shows nodes, pulse and HP");
            boss["phase"] = "vulnerable"; boss["vulnerableSeconds"] = 30; boss["pulseTelegraph"] = true;
            string vulnerable = RoaWorldEventsPresentation.DescribeWorldBoss(boss, "coreLabCenterReactor", 0);
            Require(vulnerable.Contains("уязвим ещё 30 с") && vulnerable.Contains("ИМПУЛЬС!"), "Vulnerability window and telegraph are announced");
            boss["phase"] = "defeated"; boss["respawnInSeconds"] = 5400;
            Require(RoaWorldEventsPresentation.DescribeWorldBoss(boss, "coreLabCenterReactor", 0).Contains("90:00"), "Defeated boss shows the respawn timer");

            var pve = JObject.Parse(@"{'roomId':'antHive#pve_char','displayName':'Колония Пыльников','alive':3,'calmSeconds':0,'tracksReadyInSeconds':0,'tracksLabel':'Искать следы','lastResultLabel':'Слышно движение: появилась новая группа.'}");
            string pveText = RoaWorldEventsPresentation.DescribePveArea(pve, "antHive#pve_char", 0);
            Require(pveText.Contains("личная встреча") && pveText.Contains("PvP отключён") && pveText.Contains("Врагов рядом: 3") && pveText.Contains("новая группа"),
                "PvE area line shows personal mode, enemies and last result");
            Require(RoaWorldEventsPresentation.Clock(754) == "12:34", "Clock formatting");

            var record = JObject.Parse(@"{'id':'r1','typeId':'spring','itemId':'artifactSpring','tier':4,'tierShort':'Т4','tierName':'Чистый','stabilized':false,'hot':true,
                'stabilizationCost':{'silver':320,'items':[{'id':'stabilizerCatalyst','qty':2},{'id':'circuitModule','qty':1}]},'salvageYields':[{'id':'stabilizerCatalyst','qty':1}]}");
            string raw = RoaPipboyCanvas.ArtifactCardSummary(record, 1);
            string tierHex = ColorUtility.ToHtmlStringRGB(RoaGearData.TierTint(4));
            Require(raw.Contains("<color=#" + tierHex + ">Т4 Чистый</color>"), "Artifact card tints the tier with the shared equipment scale");
            Require(raw.Contains("сырой") && raw.Contains("скрыты до стабилизации") && raw.Contains("320 марок"), "Raw artifact hides properties and shows the stabilization price");
            Require(raw.Contains("разбор: " + RoaItemData.Name("stabilizerCatalyst") + " ×1"), "Salvage yields are listed");
            record["stabilized"] = true; record["hot"] = false; record["revealed"] = true;
            record["benefit"] = "Скорость +8%"; record["cost"] = "Электрический урон +20%";
            record["properties"] = JObject.Parse(@"{'benefitMul':1.79,'drawbackMul':0.87}");
            string stable = RoaPipboyCanvas.ArtifactCardSummary(record, 2);
            Require(stable.Contains("стабильный") && stable.Contains("Скорость +8% (×1.79)") && stable.Contains("экз. ×2") && !stable.Contains("скрыты"),
                "Stabilized artifact shows its revealed properties");
            string preview = RoaPipboyCanvas.ArtifactPreviewLabel(JObject.Parse(@"{'delta':{'speedPct':0.06,'carryKg':-4,'resistances':{'ballistic':0.12}}}"));
            Require(preview.Contains("скорость +6%") && preview.Contains("груз (кг) -4") && preview.Contains("сопр. ballistic +12%"), "Preview delta lists changed stats");
            Require(RoaPipboyCanvas.ArtifactPreviewLabel(JObject.Parse(@"{'delta':{}}")) == "Характеристики не изменятся.", "Empty delta is explained");

            // Окно контракта у ворот Сердцевины: доли фракций, выбранная строка
            // и причина отказа. Числа форматируются инвариантной культурой.
            var contract = JObject.Parse(@"{'displayName':'Сердцевина','signedCharacters':12,'characters':30,'canSign':true,'factions':[
                {'factionId':'uprava','displayName':'Управа','baseDisplayName':'Узел Управы','characters':8,'sharePct':66.7,'canSign':true,'reason':''},
                {'factionId':'contour','displayName':'Контур','baseDisplayName':'Узел Контура','characters':4,'sharePct':33.3,'canSign':false,'reason':'Смена фракции пока закрыта.'}]}");
            string intro = RoaGlobalMapCanvas.ContractIntroText(contract);
            Require(intro.Contains("Сердцевина") && intro.Contains("12"), "Contract window explains the territory and how many signed");
            Require(RoaGlobalMapCanvas.ContractIntroText(JObject.Parse(@"{'signedCharacters':0}")).Contains("не подписал никто"),
                "An empty territory says so instead of showing zeroes");
            string upravaRow = RoaGlobalMapCanvas.ContractRowText((JObject)contract["factions"][0], true);
            Require(upravaRow.Contains("Управа") && upravaRow.Contains("66.7%") && upravaRow.Contains("8 чел.") && upravaRow.Contains("Узел Управы"),
                "Faction row shows the share, the people and the base: " + upravaRow);
            Require(upravaRow.StartsWith("> "), "The selected faction is marked in the row");
            string contourRow = RoaGlobalMapCanvas.ContractRowText((JObject)contract["factions"][1], false);
            Require(contourRow.Contains("33.3%") && contourRow.Contains("Смена фракции пока закрыта."),
                "A faction that cannot be signed explains why: " + contourRow);

            var go = new GameObject("WorldEventsProbe");
            try
            {
                var presentation = go.AddComponent<RoaWorldEventsPresentation>();
                presentation.Configure(null);
                Require(go.GetComponentInChildren<Canvas>(true) != null, "World events presentation builds its canvas without a socket");
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
            Debug.Log("[WORLD ZONES UI] OK: zone banners, outpost/event/boss/PvE lines, artifact tier cards, preview deltas and the faction contract window.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[WORLD ZONES UI] " + message);
        }
    }
}
#endif
