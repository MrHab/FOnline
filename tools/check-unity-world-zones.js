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
  'RoaAuctionNet.Buy', 'RoaAuctionNet.Cancel', 'RoaAuctionNet.Claim', 'SubmitArtifactAction("stabilize"'])
  assert(dialogue.includes(token), `RoaDialogueCanvas is missing ${token}`);
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
assert(interaction.includes('public string NpcService') && interaction.includes('public string NpcTerritoryFactionId'),
  'RoaInteraction must expose the NPC service.');

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

console.log('Unity world zones UI OK: world events HUD, tier-tinted artifact cards with preview and salvage, base service dialogues, net wrappers and audit probe.');
