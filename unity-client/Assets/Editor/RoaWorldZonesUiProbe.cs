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
                {'id':'east','displayName':'Восточный','ownerFactionId':'','eventStatus':'open','eventOpensInMs':0,'capture':{'progress':{'free_artels':0.42},'leadingFactionId':'free_artels','contested':true},'garrison':{'state':'enroute'},'retiring':[{'factionId':'free_artels','progress':0.4}]}],
                'rules':{'captureHoldMs':180000,'captureDecayRate':0.5,'contestPausesProgress':true}}");
            string outposts = RoaWorldEventsPresentation.DescribeOutposts(territory, "coreZone");
            Require(outposts.Contains("Северный: Управа") && outposts.Contains("захват через 12:34") && outposts.Contains("прибыл"), "Locked outpost shows owner, countdown and garrison");
            Require(outposts.Contains("Восточный: нейтральный") && outposts.Contains("ЗАХВАТ ОТКРЫТ") && outposts.Contains("Артели 42%") && outposts.Contains("ОСПАРИВАЕТСЯ") && outposts.Contains("в пути"),
                "Open outpost shows capture progress, contest and garrison state");
            Require(outposts.Contains("удержание") && outposts.Contains("оспаривание останавливает прогресс"),
                "Capture rules from the snapshot are shown: " + outposts);
            Require(outposts.Contains("отходит: Артели 40%"), "A retiring column of the previous owner is named: " + outposts);
            Require(RoaWorldEventsPresentation.DescribeOutposts(territory, "settlement") == string.Empty, "Outposts stay hidden outside the core zone");

            var publicEvent = JObject.Parse(@"{'roomId':'randomAshGrove#pubev_1','displayName':'Логово Гари','remainingSeconds':1500,'warning':false,'cleared':true,'chestOpen':false,'chestClaimed':false,'chestOpensInSeconds':50,
                'danger':3,'boss':{'displayName':'Вожак Гари','alive':false,'killed':true}}");
            string eventText = RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 5);
            Require(eventText.Contains("ЛОГОВО ГАРИ · 24:55") && eventText.Contains("откроется через 45 с") && eventText.Contains("PvP разрешено"),
                "Cleared event counts the contested chest down with elapsed time");
            Require(eventText.Contains("опасность 3") && eventText.Contains("Вожак Гари: повержен"),
                "Event line shows its danger and the mini boss: " + eventText);
            publicEvent["warning"] = true; publicEvent["chestOpen"] = true;
            Require(RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 0).Contains("СКОРО ЗАКРОЕТСЯ")
                && RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 0).Contains("ТАЙНИК ОТКРЫТ"),
                "Warning and open chest are announced");
            Require(RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "otherRoom", 0) == string.Empty, "Events of other rooms are hidden");
            // Механики сценария в строке события: целые опоры, щит главаря и
            // обозначенный удар.
            var scenario = JObject.Parse(@"{'supports':[{'id':'shield_generator','displayName':'Защитный генератор','alive':true},
                {'id':'radio_mast','displayName':'Радиостанция','alive':false}],'shielded':true,
                'strike':{'kind':'grenade','displayName':'Гранатный удар','telegraph':false,'inSeconds':7,'x':9,'z':-4},
                'hazards':[{'id':'ground_0'}]}");
            string scenarioLine = RoaWorldEventsPresentation.ScenarioLine(scenario);
            Require(scenarioLine.Contains("цело: Защитный генератор") && !scenarioLine.Contains("Радиостанция"),
                "Only intact supports are listed: " + scenarioLine);
            Require(scenarioLine.Contains("ГЛАВАРЬ ПОД ЩИТОМ"), "A shielded leader is announced: " + scenarioLine);
            Require(scenarioLine.Contains("Гранатный удар через 7 с"), "The coming strike is counted down: " + scenarioLine);
            Require(scenarioLine.Contains("опасная земля: 1"), "Dangerous ground is announced: " + scenarioLine);
            Require(scenarioLine.Contains("удар с: "), "The telegraphed strike names the side it comes from: " + scenarioLine);
            scenario["strike"]["telegraph"] = true;
            Require(RoaWorldEventsPresentation.ScenarioLine(scenario).Contains("ГРАНАТНЫЙ УДАР!"),
                "A telegraphed strike shouts");
            Require(RoaWorldEventsPresentation.ScenarioLine(null) == string.Empty, "Without a scenario the line stays empty");

            // Стороны опор: отряд видит, с какой стороны что стоит, и выбирает
            // подход, а не идёт одним коридором.
            var sided = JObject.Parse(@"{'supports':[{'id':'a','displayName':'Гнездо','alive':true,'side':'северо-восток'},
                {'id':'b','displayName':'Нора','alive':true,'side':'юго-запад'}]}");
            string sidedLine = RoaWorldEventsPresentation.ScenarioLine(sided);
            Require(sidedLine.Contains("Гнездо (северо-восток)") && sidedLine.Contains("Нора (юго-запад)"),
                "Each intact support names its side: " + sidedLine);
            var sideless = JObject.Parse(@"{'supports':[{'id':'a','displayName':'Гнездо','alive':true}]}");
            Require(RoaWorldEventsPresentation.ScenarioLine(sideless).Contains("цело: Гнездо"),
                "An old server without sides still renders");

            // Вскрытие тайника: кнопка показывает долю канала и паузу при чужих.
            Require(RoaWorldEventsPresentation.ChestButtonLabel(null) == "ВСКРЫТЬ ТАЙНИК",
                "Without an active channel the button offers to start it");
            var opening = JObject.Parse(@"{'characterId':'char-a','progressMs':4000,'channelMs':8000,'contested':false}");
            Require(RoaWorldEventsPresentation.ChestButtonLabel(opening) == "ВСКРЫТИЕ 50%",
                "The button shows the share of the channel: " + RoaWorldEventsPresentation.ChestButtonLabel(opening));
            opening["contested"] = true;
            Require(RoaWorldEventsPresentation.ChestButtonLabel(opening).Contains("ОСПАРИВАЕТСЯ"),
                "A contested channel is announced on the button");
            publicEvent["rejoinInSeconds"] = 70;
            Require(RoaWorldEventsPresentation.DescribePublicEvent(publicEvent, "randomAshGrove#pubev_1", 10).Contains("через 60 с"), "Death rejoin delay is shown");

            var boss = JObject.Parse(@"{'roomId':'coreLabCenterReactor','displayName':'Хранитель Нуля','phase':'shielded','phaseLabel':'Щит активен','nodesAlive':2,'nodesTotal':4,'pulseInSeconds':12,'pulseTelegraph':false,'bossHp':1800,'bossMaxHp':1800,'pulseRadius':9,'hazards':[{'id':'hazard_0','x':9,'z':0,'radius':5},{'id':'hazard_2','x':-4.5,'z':7.8,'radius':5}]}");
            string bossText = RoaWorldEventsPresentation.DescribeWorldBoss(boss, "coreLabCenterReactor", 2);
            Require(bossText.Contains("Узлы щита: 2/4") && bossText.Contains("Импульс через 10 с") && bossText.Contains("HP 1800/1800"), "Shielded boss shows nodes, pulse and HP");
            // Горящие участки арены называются сторонами от самой установки,
            // а не числом: игроку важно, куда не вставать.
            Require(bossText.Contains("горит: ") && (bossText.Contains("восток") || bossText.Contains("север")),
                "The changing arena names its burning sides: " + bossText);
            boss["phase"] = "vulnerable"; boss["vulnerableSeconds"] = 30; boss["pulseTelegraph"] = true;
            string vulnerable = RoaWorldEventsPresentation.DescribeWorldBoss(boss, "coreLabCenterReactor", 0);
            Require(vulnerable.Contains("уязвим ещё 30 с") && vulnerable.Contains("ИМПУЛЬС!"), "Vulnerability window and telegraph are announced");
            boss["phase"] = "defeated"; boss["respawnInSeconds"] = 5400;
            Require(RoaWorldEventsPresentation.DescribeWorldBoss(boss, "coreLabCenterReactor", 0).Contains("90:00"), "Defeated boss shows the respawn timer");

            var pve = JObject.Parse(@"{'roomId':'antHive#pve_char','displayName':'Колония Пыльников','alive':3,'calmSeconds':0,'tracksReadyInSeconds':0,'tracksLabel':'Искать следы','lastResultLabel':'Слышно движение: появилась новая группа.'}");
            string pveText = RoaWorldEventsPresentation.DescribePveArea(pve, "antHive#pve_char", 0);
            Require(pveText.Contains("личная встреча") && pveText.Contains("PvP отключён") && pveText.Contains("Врагов рядом: 3") && pveText.Contains("новая группа"),
                "PvE area line shows personal mode, enemies and last result");
            // Встречи приходят к идущему: остаток пути назван прямо, иначе
            // тишина в области выглядит поломкой.
            pve["distanceToRollM"] = 40;
            string walking = RoaWorldEventsPresentation.DescribePveArea(pve, "antHive#pve_char", 0);
            Require(walking.Contains("идти ещё 40 м"), "The area says how far the party still has to walk: " + walking);
            pve["calmSeconds"] = 30;
            Require(!RoaWorldEventsPresentation.DescribePveArea(pve, "antHive#pve_char", 0).Contains("идти ещё"),
                "During the calm after a clear the walk counter stays quiet");
            pve["calmSeconds"] = 0;
            pve["distanceToRollM"] = 0;
            Require(!RoaWorldEventsPresentation.DescribePveArea(pve, "antHive#pve_char", 0).Contains("идти ещё"),
                "A party that has walked its share is not nagged");

            Require(RoaWorldEventsPresentation.Clock(754) == "12:34", "Clock formatting");

            // Постоянная PvE-область на карте: название, опасность, обитатели и
            // характерные категории добычи видны до входа.
            var area = JObject.Parse(@"{'id':'antHive','displayName':'Колония Пыльников','danger':2,
                'inhabitants':['рой пыльников','пара рыхляков'],
                'lootCategories':['хитин и железы пыльников','ремесленный лом']}");
            string areaLine = RoaGlobalMap.PveAreaLabel(area);
            Require(areaLine.Contains("ОБЛАСТЬ: Колония Пыльников") && areaLine.Contains("опасность 2"),
                "Area summary names the area and its danger: " + areaLine);
            Require(areaLine.Contains("обитатели: рой пыльников, пара рыхляков"), "Area summary lists its inhabitants: " + areaLine);
            Require(areaLine.Contains("добыча: хитин и железы пыльников"), "Area summary lists loot categories: " + areaLine);
            Require(areaLine.Contains("встреча личная"), "Area summary explains that the encounter is personal");
            Require(RoaGlobalMap.PveAreaLabel(null) == string.Empty, "Without an area the summary stays empty");

            // Зал боковой лаборатории: шкала угрозы, объявленный удар и
            // готовность узлов на стенах.
            var lab = JObject.Parse(@"{'roomId':'coreLabCircuit','meterLabel':'Перегрузка','meter':0.62,
                'hazardName':'Разряд по залу','telegraph':false,'telegraphInSeconds':0,'guardShielded':true,
                'nodes':[{'id':'node_a','displayName':'Распределительный щит','readyInSeconds':0},
                         {'id':'node_b','displayName':'Распределительный щит','readyInSeconds':12}]}");
            string labText = RoaWorldEventsPresentation.DescribeLabHall(lab, "coreLabCircuit");
            Require(labText.Contains("ПЕРЕГРУЗКА: 62%"), "The hall shows its meter: " + labText);
            Require(labText.Contains("МАШИНА ПОД ПИТАНИЕМ"), "A shielded guard machine is announced: " + labText);
            Require(labText.Contains("Распределительный щит (12 с)"), "A recharging node shows its timer: " + labText);
            lab["telegraph"] = true; lab["telegraphInSeconds"] = 3;
            lab["sectors"] = JArray.Parse(@"[{'id':'discharge_0','x':8,'z':0,'radius':7},{'id':'discharge_2','x':-4,'z':-7,'radius':7}]");
            string labStrike = RoaWorldEventsPresentation.DescribeLabHall(lab, "coreLabCircuit");
            Require(labStrike.Contains("РАЗРЯД ПО ЗАЛУ!") && labStrike.Contains("3 с"), "The announced strike is counted down: " + labStrike);
            Require(labStrike.Contains("восток") && labStrike.Contains("юго-запад"),
                "The announced strike says which sides it will burn: " + labStrike);
            Require(RoaWorldEventsPresentation.HazardSides(null) == string.Empty, "Without sectors no sides are named");
            Require(RoaWorldEventsPresentation.CompassSide(0f, 0f) == "центр", "The centre of the hall is named plainly");
            lab["telegraph"] = false;
            lab["nodes"][1]["readyInSeconds"] = 0;
            Require(RoaWorldEventsPresentation.DescribeLabHall(lab, "coreLabCircuit").Contains("Распределительный щит ×2"),
                "Identical ready nodes collapse into one row");
            // Снятое питание — это и есть окно, когда машину можно бить.
            lab["guardShielded"] = false;
            lab["nodes"][0]["action"] = "power";
            lab["nodes"][0]["effectSeconds"] = 14;
            string labPower = RoaWorldEventsPresentation.DescribeLabHall(lab, "coreLabCircuit");
            Require(labPower.Contains("ПИТАНИЕ СНЯТО: 14 с"),
                "The node effect window says how long the guard machine stays open: " + labPower);
            lab["nodes"][0]["action"] = "shift";
            Require(RoaWorldEventsPresentation.DescribeLabHall(lab, "coreLabCircuit").Contains("Распределительный щит: 14 с"),
                "Any other node signs its window with its own name");
            lab["nodes"][0]["effectSeconds"] = 0;
            Require(RoaWorldEventsPresentation.NodeEffectLine(null) == string.Empty, "Without nodes no window is shown");
            Require(RoaWorldEventsPresentation.DescribeLabHall(lab, "coreLabAlloy") == string.Empty, "Another hall's state is not shown");
            Require(RoaWorldEventsPresentation.DescribeLabHall(null, "coreLabCircuit") == string.Empty, "Without a hall the line stays empty");

            // Переход со сменой правил зоны: первое нажатие предупреждает,
            // второе входит. Мирные переходы не переспрашивают.
            var coreRules = JObject.Parse(@"{'mode':'pvpFullDrop','label':'Сердцевина','loss':'inventory',
                'lossLabel':'Выпадает рюкзак; экипировка и артефакты остаются.','pvpLabel':'PvP разрешено между разными фракциями.',
                'confirmBeforeEntry':true}");
            Require(RoaInteraction.TransitionNeedsConfirmation(coreRules, string.Empty), "Entering the territory asks for confirmation");
            Require(!RoaInteraction.TransitionNeedsConfirmation(coreRules, "pvpFullDrop"), "The already acknowledged mode does not ask twice");
            string warning = RoaInteraction.TransitionZoneWarning(coreRules, "Платформа метро");
            Require(warning.Contains("Платформа метро") && warning.Contains("Выпадает рюкзак") && warning.Contains("Нажмите ещё раз"),
                "The warning names the transition, the loss and how to continue: " + warning);
            var peacefulRules = JObject.Parse(@"{'mode':'peaceful','label':'Мирная зона','loss':'none','confirmBeforeEntry':false}");
            Require(!RoaInteraction.TransitionNeedsConfirmation(peacefulRules, string.Empty), "A peaceful transition does not ask");
            Require(!RoaInteraction.TransitionNeedsConfirmation(null, string.Empty), "Without rules the transition works as before");
            Require(RoaInteraction.TransitionZoneWarning(null, "Выход") == string.Empty, "Without rules there is no warning");

            // Артефакт в списке склада или контейнера: тир в цвете шкалы
            // экипировки и состояние, свойства сырого по-прежнему скрыты.
            var storageRecords = JArray.Parse(@"[{'id':'rt_1','baseId':'artifactSpring','artifact':{'id':'a1','typeId':'spring','tier':4,
                'tierShort':'Т4','tierName':'Чистый','stabilized':false,'hot':true}}]");
            JObject rowArtifact = RoaInteraction.ArtifactForRuntimeId(storageRecords, "rt_1");
            Require(rowArtifact != null, "The row finds its instance record by runtime id");
            Require(RoaInteraction.ArtifactForRuntimeId(storageRecords, "rt_2") == null, "A foreign runtime id finds nothing");
            string rowSuffix = RoaLootCanvas.ArtifactRowSuffix(rowArtifact);
            string rowTier = ColorUtility.ToHtmlStringRGB(RoaGearData.TierTint(4));
            Require(rowSuffix.Contains("<color=#" + rowTier + ">Т4 Чистый</color>"), "The row tints the tier with the shared scale: " + rowSuffix);
            Require(rowSuffix.Contains("сырой"), "A raw instance is named raw in the list: " + rowSuffix);
            rowArtifact["stabilized"] = true; rowArtifact["hot"] = false;
            Require(RoaLootCanvas.ArtifactRowSuffix(rowArtifact).Contains("стабилизирован"), "A stabilized instance says so");
            Require(RoaLootCanvas.ArtifactRowSuffix(null) == string.Empty, "An ordinary item keeps its plain row");

            // Итог эффектов пояса: рядом с показателем назван его потолок,
            // а на самом потолке так и сказано.
            var beltEffects = JObject.Parse(@"{'artifactTypeIds':['spring','vein'],'speedPct':0.09,'apRegenPct':0.12,'carryKg':8,
                'maxHpFlat':10,'regenHpPerSecond':0.2,'meleeDamagePct':0.05,
                'caps':{'speedPct':0.18,'carryKg':30,'regenHpPerSecond':1,'resistancePct':0.6,'secondarySimilarEffectMultiplier':0.5}}");
            string totals = RoaPipboyCanvas.BeltTotalsLine(beltEffects);
            Require(totals.Contains("скорость +9% (до +18%)"), "The speed total names its ceiling: " + totals);
            Require(totals.Contains("груз +8 кг (до +30 кг)"), "The carry total names its ceiling: " + totals);
            Require(totals.StartsWith("пояс (2):"), "The line says how many artifacts are on the belt: " + totals);
            beltEffects["speedPct"] = 0.18;
            Require(RoaPipboyCanvas.BeltTotalsLine(beltEffects).Contains("скорость +18% (предел)"),
                "At the ceiling the line says so");
            var noCaps = JObject.Parse(@"{'artifactTypeIds':['spring'],'speedPct':0.09}");
            Require(!RoaPipboyCanvas.BeltTotalsLine(noCaps).Contains("до +"),
                "Without caps from the server the line stays as it was");
            Require(RoaPipboyCanvas.BeltTotalsLine(JObject.Parse(@"{'artifactTypeIds':[]}")) == "пояс пуст",
                "An empty belt says so");

            // Панель сдвига: окно повышенного рождения после выброса названо
            // прямо, вместе с остатком времени и множителем находок.
            var quietShift = JObject.Parse(@"{'phase':'calm','remainingMs':0,'strength':1,'fieldsExcited':false}");
            Require(RoaKromkaShiftAndDetector.ShiftLine(quietShift) == string.Empty, "A quiet world shows no shift line");
            var excitedShift = JObject.Parse(@"{'phase':'calm','remainingMs':0,'strength':1,'fieldsExcited':true,
                'fieldsExcitedSeconds':900,'fieldsChanceMultiplier':5.5}");
            string excitedLine = RoaKromkaShiftAndDetector.ShiftLine(excitedShift);
            Require(excitedLine.Contains("ПОЛЯ АКТИВНЫ: ещё 15 мин"), "The excited window is counted down: " + excitedLine);
            Require(excitedLine.Contains("находки ×5.5") || excitedLine.Contains("находки ×5,5"),
                "The line says how much richer the fields are: " + excitedLine);
            // Подсказка подбора: строкой, которой находку и поднимают, видно,
            // что именно лежит под ногами.
            string hintMk1 = RoaKromkaShiftAndDetector.PickupHintText("G", 0, null, null);
            Require(hintMk1 == "G — забрать находку", "Mk1 offers to take the find without naming it: " + hintMk1);
            string hintMk2 = RoaKromkaShiftAndDetector.PickupHintText("G", 3, "#efd078", null);
            Require(hintMk2.Contains("забрать находку") && hintMk2.Contains("<color=#efd078>"),
                "Mk2 names the tier in the pickup hint: " + hintMk2);
            string hintMk3 = RoaKromkaShiftAndDetector.PickupHintText("G", 4, "", "Жила");
            Require(hintMk3.Contains("забрать: Жила") && hintMk3.Contains(RoaGearData.TierShortLabel(4)),
                "Mk3 names the find and its tier in the pickup hint: " + hintMk3);
            RoaHudCanvas.FormatInteractionPrompt(hintMk3, false, out string pickupKey, out string pickupAction);
            Require(pickupKey == "G" && pickupAction.Contains("Жила"),
                "The HUD prompt splits the pickup hint into a key and an action: " + pickupKey + " / " + pickupAction);


            var activeShift = JObject.Parse(@"{'phase':'active','remainingMs':45000,'strength':3,'sheltered':false,'fieldsExcited':false}");
            string activeLine = RoaKromkaShiftAndDetector.ShiftLine(activeShift);
            Require(activeLine.Contains("СДВИГ ИДЁТ") && activeLine.Contains("сила 3") && activeLine.Contains("ИЩИТЕ УКРЫТИЕ"),
                "An active shift keeps its old line: " + activeLine);

            // Аванпост и база объясняются словами, а не только процентами.
            string outpostRules = RoaWorldEventsPresentation.OutpostVersusBaseLabel();
            Require(outpostRules.Contains("захватывается присутствием") && outpostRules.Contains("хранилища здесь нет"),
                "The panel explains what an outpost is: " + outpostRules);
            Require(outpostRules.Contains("База фракции не захватывается") && outpostRules.Contains("PvP отключён"),
                "The panel explains how a base differs: " + outpostRules);

            var record = JObject.Parse(@"{'id':'r1','typeId':'spring','itemId':'artifactSpring','tier':4,'tierShort':'Т4','tierName':'Чистый','stabilized':false,'hot':true,
                'stabilizationCost':{'silver':320,'items':[{'id':'stabilizerCatalyst','qty':2},{'id':'circuitModule','qty':1}]},'salvageYields':[{'id':'stabilizerCatalyst','qty':1}]}");
            string raw = RoaPipboyCanvas.ArtifactCardSummary(record, 1);
            string tierHex = ColorUtility.ToHtmlStringRGB(RoaGearData.TierTint(4));
            Require(raw.Contains("<color=#" + tierHex + ">Т4 Чистый</color>"), "Artifact card tints the tier with the shared equipment scale");
            Require(raw.Contains("сырой") && raw.Contains("скрыты до стабилизации") && raw.Contains("320 марок"), "Raw artifact hides properties and shows the stabilization price");
            Require(raw.Contains("разбор: " + RoaItemData.Name("stabilizerCatalyst") + " ×1"), "Salvage yields are listed");
            record["stabilized"] = true; record["hot"] = false; record["revealed"] = true;
            record["benefit"] = "Скорость +8%"; record["cost"] = "Электрический урон +20%";
            record["properties"] = JObject.Parse(@"{'benefitMul':1.79,'drawbackMul':0.87,
                'primary':{'key':'speedPct','value':0.1432},'secondary':[{'key':'apRegenPct','value':0.179}],
                'drawback':[{'key':'resistances.electric','value':-0.174}]}");
            string stable = RoaPipboyCanvas.ArtifactCardSummary(record, 2);
            Require(stable.Contains("стабильный") && stable.Contains("экз. ×2") && !stable.Contains("скрыты"),
                "Stabilized artifact no longer hides its properties");
            Require(stable.Contains("скорость +14%") && stable.Contains("восст. ОД +18%"),
                "Stabilized card shows the exact instance values, not the type description: " + stable);
            Require(stable.Contains("недостатки: сопр. electric -17%"),
                "Stabilized card lists the drawback with its number: " + stable);
            Require(RoaPipboyCanvas.ArtifactSourceLabel("carousel") == "Карусель", "Raw artifact names its natural source");
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
            // Подпись связывает на срок, и срок этот приходит в самом предложении.
            Require(!intro.Contains("сменить фракцию"), "Without a published cooldown nothing is promised: " + intro);
            contract["changeCooldownMs"] = 259200000L;
            string bound = RoaGlobalMapCanvas.ContractIntroText(contract);
            Require(bound.Contains("сменить фракцию можно будет только через 72 ч."),
                "The contract window says how long the choice binds before it is signed: " + bound);
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
            Debug.Log("[WORLD ZONES UI] OK: zone banners, outpost/event/boss/PvE/lab-hall lines, transition zone warnings, artifact tier cards, list rows, belt caps, excited fields, detector readout and the outpost/base difference, preview deltas and the faction contract window.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[WORLD ZONES UI] " + message);
        }
    }
}
#endif
