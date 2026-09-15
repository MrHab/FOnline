#!/usr/bin/env node
'use strict';

// Unity-клиент зон мира: панель аванпостов/событий/босса/PvE, карточки
// артефактов с тиром и предпросмотром, сервисы базы в диалоге, сетевые
// обёртки и пробa аудита. Проверяется по исходникам, без редактора.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const presentation = read('unity-client/Assets/Scripts/Game/RoaWorldEventsPresentation.cs');
for (const token of [
  '_socket.OnTerritoryOutpostState += ApplyTerritory;',
  '_socket.OnPublicEventState += ApplyPublicEvent;',
  '_socket.OnWorldBossState += ApplyWorldBoss;',
  '_socket.OnPveAreaState += ApplyPveArea;',
  'public static string DescribeOutposts(JObject territory, string locationId)',
  'public static string DescribePublicEvent(JObject payload, string roomId, int elapsedSeconds)',
  'public static string DescribeWorldBoss(JObject payload, string roomId, int elapsedSeconds)',
  'public static string DescribePveArea(JObject payload, string roomId, int elapsedSeconds)',
  'RoaPveAreaNet.SearchTracks(_socket',
  'RoaTerritoryNet.RequestTerritoryState(_socket',
  'Application.isMobilePlatform'
]) assert(presentation.includes(token), `RoaWorldEventsPresentation is missing ${token}`);
assert(!/полн(ый|ого|ым) (лут|дроп)/i.test(presentation), 'The HUD must never call the territory mode full loot.');

const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
assert(bootstrap.includes('AddComponent<RoaWorldEventsPresentation>()') && bootstrap.includes('worldEvents.Configure(Socket)'),
  'Bootstrap must configure the world events presentation.');

const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');
for (const token of [
  'public static string ArtifactCardSummary(JObject record, int count)',
  'RoaGearData.TierTint(tier)',
  'свойства скрыты до стабилизации',
  'SubmitArtifactAction("preview", id',
  'SubmitArtifactAction("salvage", id',
  'public static string ArtifactPreviewLabel(JObject preview)',
  'ArtifactCostLabel(record["stabilizationCost"] as JObject)'
]) assert(pipboy.includes(token), `RoaPipboyCanvas is missing ${token}`);

const dialogue = read('unity-client/Assets/Scripts/Game/RoaDialogueCanvas.cs');
for (const token of ['AddServiceOptions()', '"medic"', '"registrar"', '"auction"', '"artifactLab"',
  'RoaTerritoryNet.UseMedic', 'RoaTerritoryNet.JoinFaction', 'RoaTerritoryNet.LeaveFaction',
  'SubmitArtifactAction("stabilize"'])
  assert(dialogue.includes(token), `RoaDialogueCanvas is missing ${token}`);
// Аукционер открывает собственный экран, поэтому торги живут не в диалоге.
const auctionCanvas = read('unity-client/Assets/Scripts/Game/RoaAuctionCanvas.cs');
for (const token of ['RoaAuctionNet.Bid', 'RoaAuctionNet.Buyout', 'RoaAuctionNet.Cancel', 'RoaAuctionNet.Claim',
  'RoaAuctionNet.ListItem'])
  assert(auctionCanvas.includes(token), `RoaAuctionCanvas is missing ${token}`);
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
assert(interaction.includes('public string NpcService') && interaction.includes('public string NpcTerritoryFactionId'),
  'RoaInteraction must expose the NPC service.');

// Смена правил зоны на местном переходе (база → Сердцевина → лаборатория)
// предупреждается до входа, а не после прибытия.
for (const token of [
  'public static bool TransitionNeedsConfirmation(JObject rules, string acknowledgedMode)',
  'public static string TransitionZoneWarning(JObject rules, string label)',
  '["targetZoneRules"] = transition.TargetZoneRules != null',
  'if (TransitionNeedsConfirmation(targetRules, _acknowledgedZoneMode)'
]) assert(interaction.includes(token), `RoaInteraction must warn about the zone behind a transition: ${token}`);
// Артефакт в списке склада и контейнера показывает тир и состояние — раньше
// строка была обычной «предмет × количество».
const lootCanvas = read('unity-client/Assets/Scripts/Game/RoaLootCanvas.cs');
for (const token of [
  'public static string ArtifactRowSuffix(JObject artifact)',
  'RoaGearData.TierTint(tier)',
  'stable ? "стабилизирован" : "сырой"',
  'RoaInteraction.ArtifactForRuntimeId('
]) assert(lootCanvas.includes(token), `RoaLootCanvas must show the artifact state in a row: ${token}`);
for (const token of [
  'public static JObject ArtifactForRuntimeId(JArray records, string runtimeId)',
  'public JArray StorageRuntimeRecords',
  'public JArray InventoryRuntimeRecords'
]) assert(interaction.includes(token), `RoaInteraction must expose instance records to the list: ${token}`);
assert(read('server.js').includes('storageWeaponRuntime: storageFaction ? serverFactionStorageWeaponRuntimeSnapshot(p, storageFaction) : [],'),
  'The server must send the faction storage instance records with the public artifact projection.');

const locationModel = read('unity-client/Assets/Scripts/World/RoaLocationData.cs');
for (const token of ['[JsonProperty("targetPvpMode")] public string TargetPvpMode;',
  '[JsonProperty("targetZoneRules")] public JObject TargetZoneRules;'])
  assert(locationModel.includes(token), `LocationTransition must carry the rules of the zone behind it: ${token}`);
assert(read('server.js').includes('function serverTransitionZoneRules(row = {}) {'),
  'The server must publish the rules of the zone behind every transition.');
assert(read('unity-client/Assets/Editor/RoaWorldZonesUiProbe.cs').includes('RoaInteraction.TransitionNeedsConfirmation('),
  'The editor probe must cover the transition warning.');

const inventory = read('unity-client/Assets/Scripts/Game/RoaInventory.cs');
assert(inventory.includes('Socket.EmitWithAck("salvageArtifact", payload, onAck)'), 'Salvage must reach the server.');
for (const file of ['RoaTerritoryNet.cs', 'RoaPveAreaNet.cs', 'RoaAuctionNet.cs'])
  assert(fs.existsSync(path.join(root, 'unity-client/Assets/Scripts/Game', file)), `${file} is missing`);

const recovery = read('unity-client/Assets/Scripts/Game/RoaRecoveryCanvas.cs');
assert(!/полн(ый|ого|ым) (лут|дроп)/i.test(recovery), 'Recovery texts must describe partial loss, never full loot.');

const audit = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
assert(audit.includes('typeof(RoaWorldZonesUiProbe)'), 'The world zones UI probe must run with RoaClientAuditRunner.Run.');
const probe = read('unity-client/Assets/Editor/RoaWorldZonesUiProbe.cs');
assert(probe.includes('RoaWorldEventsPresentation.DescribeOutposts') && probe.includes('RoaPipboyCanvas.ArtifactCardSummary'),
  'The probe must cover outposts and artifact cards.');
assert(probe.includes('RoaGlobalMapCanvas.ContractRowText') && probe.includes('RoaGlobalMapCanvas.ContractIntroText'),
  'The probe must cover the faction contract window at the territory gate.');
// Карточка стабилизированного артефакта показывает значения экземпляра, а не
// типовое описание вида; сырая — природный источник и цену стабилизации.
for (const token of ['ArtifactEffectList(', 'ArtifactSourceLabel(', "properties[\"primary\"]", "properties[\"drawback\"]"])
  assert(pipboy.includes(token), `RoaPipboyCanvas is missing ${token}`);
assert(!/benefit \+ " \(×"/.test(pipboy), 'The stabilized card must not fall back to the type text with a multiplier.');
assert(dialogue.includes('AuctionArtifactLine('), 'The auction lot must describe the artifact state before purchase.');
assert(auctionCanvas.includes('AuctionArtifactLine('), 'The auction screen must show the artifact state before purchase.');
assert(auctionCanvas.includes('на полке у аукционера'), 'The buyer must see where the lot is handed over.');
const auctionModule = read('src/server/faction-auction.js');
assert(auctionModule.includes('projectArtifact'), 'The auction projection must be able to expose artifact state.');
assert(read('server.js').includes('projectArtifact: record => publicArtifactRecord(record, KROMKA_ARTIFACT_CATALOG)'),
  'The server must project auction artifacts through the public record.');

console.log('Unity world zones UI OK: world events HUD, tier-tinted artifact cards with preview and salvage, base service dialogues, net wrappers and audit probe.');
