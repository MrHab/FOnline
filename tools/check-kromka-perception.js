'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const globalMapPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaGlobalMap.cs');
const actorViewPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaGlobalMapActorView.cs');
const activityCanvasPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaWorldActivityCanvas.cs');

const server = fs.readFileSync(serverPath, 'utf8');
const globalMap = fs.readFileSync(globalMapPath, 'utf8');
const actorView = fs.readFileSync(actorViewPath, 'utf8');
const activityCanvas = fs.readFileSync(activityCanvasPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function handlerBody(name) {
  const start = server.indexOf(`socket.on('${name}'`);
  assert(start >= 0, `Missing socket handler: ${name}`);
  const next = server.indexOf("socket.on('", start + 12);
  return server.slice(start, next >= 0 ? next : server.length);
}

assert(/function serverInteractionHasLineOfSight\([\s\S]*roomHasHighLineOfSight/.test(server),
  'Context interactions must reuse the authoritative room line-of-sight contract.');
assert(/roomStaticCollisionBlocksSegment[\s\S]*isRoomFullVisionBlocker/.test(
  server.slice(server.indexOf('function roomHasHighLineOfSight'), server.indexOf('function enemyCanSeePlayer'))),
  'Authoritative LoS must include precise static collision and authored vision blockers.');

[
  'npcDialogueFocus', 'tradeMachineMarketState', 'storageTransfer', 'tradeMachineExchange',
  'harvestResource', 'syncNpcTradeState', 'npcTradeExchange', 'robEncounterActor',
  'inspectCorpse', 'lootEnemy', 'pickupGroundItem', 'pickLock', 'hackTerminal',
  'openWorldContainer', 'lootWorldContainer'
].forEach(name => assert(handlerBody(name).includes('serverInteractionHasLineOfSight'),
  `${name} must reject targets behind an obstacle.`));

assert(handlerBody('healPlayer').includes('serverInteractionHasLineOfSight'),
  'Player healing must reject targets behind an obstacle.');
assert(handlerBody('socialAction').includes('serverInteractionHasLineOfSight'),
  'Local social interactions must reject targets behind an obstacle.');
assert(handlerBody('playerTradeAction').includes('serverInteractionHasLineOfSight'),
  'An active player trade must be cancelled when an obstacle separates participants.');
assert(/function serverNpcQuestActor[\s\S]*serverInteractionHasLineOfSight/.test(server),
  'NPC quest mutations must validate the current authoritative line of sight.');
assert(/function serverKromkaQuestObject[\s\S]*serverInteractionHasLineOfSight/.test(server),
  'Quest object interactions must validate the current authoritative line of sight.');
assert(/function recordWastelandCraftingStationFee[\s\S]*interaction_blocked/.test(server),
  'Crafting must reject stations behind an obstacle.');

assert(globalMap.includes('StrategicMinimumCameraAnchorY = 0f'), 'Global CameraAnchor minimum Y must be 0.');
assert(globalMap.includes('StrategicMinimumCameraDistanceValue = 1f'), 'Global camera minimum distance must be 1.');
assert(globalMap.includes('StrategicMaximumCameraDistanceValue = 20f'), 'Global camera maximum distance must be 20.');
assert(/_playerActor[\s\S]{0,500}StrategicActorPresentationTier\(\s*mapTier, true, false/.test(globalMap),
  'The player marker must always enter the strategic presentation policy as visible.');
assert(/if \(mapTier != MapDetailTier\.Near\) return RoaActorPresentationTier\.Far/.test(globalMap),
  'Camera detail tiers may reduce animation cost but must not hide strategic actors.');
assert(actorView.includes('ApplyPresentationBudget')
    && actorView.includes('bool visible = _presentationTier != RoaActorPresentationTier.Hidden'),
  'Strategic actors must use a presentation budget without destroying identity.');
assert(activityCanvas.includes('ApplyPingHighlight') && activityCanvas.includes('danger') && activityCanvas.includes('loot'),
  'The world-activity UI must render server-backed danger/help/loot signals.');

console.log('KRM-19 perception, interaction authority, and camera contract OK');
