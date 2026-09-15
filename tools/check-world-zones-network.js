#!/usr/bin/env node
'use strict';

// Сетевая проверка зон мира на реальном сервере (изолированный DATA_DIR):
// членство во фракции на путях входа, скрытые свойства артефактов до платной
// стабилизации, разбор с идемпотентным requestId, личные комнаты PvE-области
// и «Искать следы», аванпосты и публичные события в /api/wasteland и /health,
// мировой босс в снимке комнаты установки.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const qty = (self, id) => (self.inventory || []).filter(r => r.id === id).reduce((s, r) => s + r.qty, 0);
const getJson = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch (error) { reject(error); } });
  }).on('error', reject);
});

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const membership = factionId => ({ version: 1, factionId, joinedAt: Date.now() - 1000, changeAllowedAt: Date.now() + 72 * 3600000, history: [] });

  // Член «Управы» с сырым артефактом Т2 и компонентами для стабилизации Т2.
  const collector = stateFor('trade');
  collector.currentLocationId = 'personalBase';
  collector.serverLocationContext = { locationId: 'personalBase' };
  collector.inventory.silver = 1000;
  collector.inventory.chemicals = 4;
  collector.inventory.electronics = 2;
  collector.inventory.artifactWarmer = 1;
  collector.inventory.artifactVein = 1;
  collector.inventory.artifactBelt2 = 1;
  collector.equipment.artifactBelt = 'artifactBelt2';
  collector.artifactRecords = [
    { id: 'zone_raw_warmer', typeId: 'warmer', itemId: 'artifactWarmer', tier: 2, seed: 'zone:raw:warmer', hot: true, stabilized: false, recordVersion: 2, ownerCharacterId: accounts.trade.characterId },
    { id: 'zone_raw_vein', typeId: 'vein', itemId: 'artifactVein', tier: 1, seed: 'zone:raw:vein', hot: true, stabilized: false, recordVersion: 2, ownerCharacterId: accounts.trade.characterId }
  ];
  collector.artifactSlots = [];
  collector.territoryFaction = membership('uprava');
  const baseModule = require(path.join(__dirname, '..', 'src/server/personal-bases'));
  saves.personalBases ||= {};
  const baseUserId = users.users[accounts.trade.login].id;
  const base = baseModule.createPersonalBase(baseUserId);
  base.rights = { granted: true, outcomeId: 'official', questId: 'personal_aktov_air_rights', grantedAt: Date.now() - 100000 };
  saves.personalBases[baseUserId] = base;

  // Член «Артелей», чьё сохранение указывает на чужую базу — при reconnect его вернут.
  const intruder = stateFor('target');
  intruder.currentLocationId = 'coreBaseUprava';
  intruder.serverLocationContext = { locationId: 'coreBaseUprava' };
  intruder.territoryFaction = membership('free_artels');

  // Двое без группы в одной PvE-области — у каждого своя комната.
  for (const role of ['cadence', 'persistence']) {
    const state = stateFor(role);
    state.currentLocationId = 'antHive';
    state.serverLocationContext = { locationId: 'antHive' };
    state.inventory.artifactDetectorMk1 = 1;
    state.equipment.detector = 'artifactDetectorMk1';
  }

  // Наёмник без контракта стоит на глобальной карте у узла Сердцевины: там
  // подписывают первый контракт и оттуда заводят на базу фракции.
  const mercenary = stateFor('untargeted');
  mercenary.territoryFaction = { version: 1, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: [] };
  mercenary.globalMap = { onWorldMap: true, playerX: 190, playerY: 156 };

  // Член «Управы» внутри установки «Объекта Ноль».
  const raider = stateFor('progression');
  raider.currentLocationId = 'coreLabCenterReactor';
  raider.serverLocationContext = { locationId: 'coreLabCenterReactor' };
  raider.territoryFaction = membership('uprava');

  // Активное публичное событие, чтобы /api/wasteland и /health его показали.
  saves.publicEvents = { version: 1, lastSpawnAt: Date.now(), startedAt: Date.now(), counter: 1, events: {
    pubev_gari_den_1: {
      id: 'pubev_gari_den_1', templateId: 'gari_den', kind: 'monsterLair', displayName: 'Логово Гари', text: '', locationId: 'randomDryBasin',
      encounterId: 'gari_pack', roomId: 'randomDryBasin#pubev_gari_den_1', pvpMode: 'pvpEvent', x: 125, y: 95,
      createdAt: Date.now(), warningAt: Date.now() + 1500000, expiresAt: Date.now() + 1800000, status: 'active', cleared: false,
      chest: { opensAt: 0, claimedAt: 0, claimedBy: '' }, deaths: {}, visits: 0
    }
  } };
  fs.writeFileSync(savesPath, JSON.stringify(saves, null, 2));
  await h.startServer();

  const request = async (account, event, data) => {
    const response = await h.socketAck(account.socket, event, data);
    assert.equal(response.ok, true, event + ': ' + JSON.stringify(response).slice(0, 8000));
    return response;
  };

  // --- членство и доступ ------------------------------------------------------------
  await h.connectAndJoin(accounts.target);
  assert.notEqual(accounts.target.join.locationId, 'coreBaseUprava', 'A member of another faction is not reconnected into a foreign base.');
  const membershipState = await request(accounts.target, 'territoryFactionAction', { action: 'state' });
  assert.equal(membershipState.membership.factionId, 'free_artels');
  assert.equal(membershipState.membership.changeLocked, true, 'The 72-hour change cooldown is reported.');
  const forbidden = await h.socketAck(accounts.target.socket, 'changeLocation', { locationId: 'coreBaseUprava' });
  assert(!forbidden.ok && forbidden.zoneRules, 'A foreign base rejects entry and still explains the zone rules.');
  console.log('PASS territory membership on reconnect and transitions');

  // --- контракт наёмника у ворот Сердцевины -----------------------------------------
  const publicMap = await getJson('/api/global-map');
  const nodeIds = (publicMap.json.map?.nodes || []).map(node => node.id);
  assert(nodeIds.includes('coreZone'), 'The territory node stays on the map: it is the only entrance.');
  for (const baseId of ['coreBaseUprava', 'coreBaseArtels', 'coreBaseContour', 'coreBaseLeague']) {
    assert(!nodeIds.includes(baseId), `Faction base markers are hidden from the client map: ${baseId}`);
  }
  await h.connectAndJoin(accounts.untargeted);
  const gateOffer = await request(accounts.untargeted, 'territoryFactionAction', { action: 'offer' });
  assert.equal(gateOffer.atGate, true, 'A player standing at the territory node is at the contract gate.');
  assert.equal(gateOffer.contract.canSign, true, 'A character without a contract may sign one.');
  assert.equal(gateOffer.contract.factions.length, 4, 'The window offers every territory faction.');
  assert(gateOffer.contract.factions.every(row => typeof row.sharePct === 'number' && row.displayName),
    'Every faction row carries a share and a display name: ' + JSON.stringify(gateOffer.contract.factions).slice(0, 400));
  // Маршрут к узлу Сердцевины: без контракта сервер возвращает предложение,
  // после подписи тот же маршрут заводит на базу выбранной фракции.
  await request(accounts.untargeted, 'globalTravelStart',
    { targetLocationId: 'coreZone', worldPoint: { x: 190, y: 150 } });
  const arriveAtGate = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await h.socketAck(accounts.untargeted.socket, 'globalTravelArrive',
        { targetLocationId: 'coreZone', worldPoint: { x: 190, y: 150 } });
      if (!/ещё нужно дойти/.test(response.error || '')) return response;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error('the traveller never reached the territory node');
  };
  const refused = await arriveAtGate();
  assert.equal(refused.ok, false, 'Without a contract the gate does not let the traveller in.');
  assert.equal(refused.contractRequired, true, 'The refusal carries the contract offer: ' + JSON.stringify(refused).slice(0, 400));
  assert.equal(refused.contract.factions.length, 4);
  const signed = await request(accounts.untargeted, 'territoryFactionAction',
    { action: 'join', factionId: 'contour', requestId: 'gate-contract-1' });
  assert.equal(signed.atGate, true);
  assert.equal(signed.membership.factionId, 'contour', 'Signing at the gate joins the chosen faction.');
  assert.equal(signed.contract.baseLocationId, 'coreBaseContour', 'The contract names the base the player will arrive at.');
  const arrived = await arriveAtGate();
  assert.equal(arrived.ok, true, 'A signed contract opens the territory gate: ' + JSON.stringify(arrived).slice(0, 400));
  assert.equal(arrived.targetLocationId, 'coreBaseContour', 'The gate routes the traveller to the base of the signed faction.');
  assert.equal(arrived.entryKey, 'entryFromWorld');
  assert.equal(arrived.pvpMode, 'peaceful', 'The base is a protected area, not the contested zone.');
  const entered = await request(accounts.untargeted, 'changeLocation',
    { locationId: 'coreBaseContour', entryKey: 'entryFromWorld' });
  assert.equal(entered.locationId, 'coreBaseContour', 'The traveller really lands on the faction base.');
  const switchAtGate = await h.socketAck(accounts.untargeted.socket, 'territoryFactionAction',
    { action: 'join', factionId: 'uprava', requestId: 'gate-contract-2' });
  assert(!switchAtGate.ok && /регистратора/.test(switchAtGate.error || ''),
    'Switching factions still requires the registrar on the base.');
  const farFromGate = await h.socketAck(accounts.target.socket, 'territoryFactionAction',
    { action: 'join', factionId: 'uprava', requestId: 'far-contract-1' });
  assert(!farFromGate.ok, 'A contract is not signed from an arbitrary location.');
  console.log('PASS mercenary contract at the territory gate and hidden base markers');

  // --- артефакты: скрытые свойства, платная стабилизация, разбор ---------------------------
  await h.connectAndJoin(accounts.trade);
  const self = accounts.trade.join.self;
  const rawWarmer = self.artifactRecords.find(row => row.id === 'zone_raw_warmer');
  assert(rawWarmer && rawWarmer.tier === 2 && rawWarmer.tierColor === '#d8d2c0' && !rawWarmer.revealed, 'A raw artifact shows its tier and colour.');
  assert(!('properties' in rawWarmer) && !('seed' in rawWarmer), 'Hidden properties and the seed never reach the client before stabilization.');
  assert(!JSON.stringify(self).includes('zone:raw:warmer'), 'The seed does not leak anywhere in the player state.');
  const quote = await request(accounts.trade, 'stabilizeArtifact', { recordId: 'zone_raw_warmer', action: 'quote' });
  assert.deepEqual(quote.cost, { silver: 90, items: [{ id: 'chemicals', qty: 2 }, { id: 'electronics', qty: 1 }] }, 'Tier two stabilization price.');
  const stable = await request(accounts.trade, 'stabilizeArtifact', { recordId: 'zone_raw_warmer', requestId: 'zone_stabilize_1' });
  assert(stable.record.revealed && stable.record.properties && stable.record.properties.effects.resistances.fire > 0, 'Stabilization reveals fixed properties.');
  assert.equal(qty(stable.self, 'silver'), 910);
  assert.equal(qty(stable.self, 'chemicals'), 2);
  const replay = await request(accounts.trade, 'stabilizeArtifact', { recordId: 'zone_raw_warmer', requestId: 'zone_stabilize_1' });
  assert(replay.reused && qty(replay.self, 'silver') === 910, 'Replaying the stabilization request does not charge twice.');
  const equip = await request(accounts.trade, 'artifactLoadoutAction', { action: 'preview', recordId: 'zone_raw_warmer' });
  assert(equip.preview && equip.delta && equip.delta.resistances && equip.delta.resistances.fire > 0, 'Preview reports the container delta without equipping.');
  const salvageQuote = await request(accounts.trade, 'salvageArtifact', { recordId: 'zone_raw_vein', action: 'quote' });
  assert.deepEqual(salvageQuote.yields, [{ id: 'chemicals', qty: 1 }]);
  const salvaged = await request(accounts.trade, 'salvageArtifact', { recordId: 'zone_raw_vein', requestId: 'zone_salvage_1' });
  assert.equal(qty(salvaged.self, 'artifactVein'), 0);
  assert.equal(qty(salvaged.self, 'chemicals'), 3);
  const salvageReplay = await request(accounts.trade, 'salvageArtifact', { recordId: 'zone_raw_vein', requestId: 'zone_salvage_1' });
  assert(salvageReplay.reused && qty(salvageReplay.self, 'chemicals') === 3, 'Salvage is idempotent by requestId.');
  console.log('PASS hidden artifact properties, paid stabilization, preview and salvage');

  // --- PvE-область: личные комнаты и следы ------------------------------------------------
  await h.connectAndJoin(accounts.cadence);
  await h.connectAndJoin(accounts.persistence);
  const roomA = accounts.cadence.join.roomId;
  const roomB = accounts.persistence.join.roomId;
  assert(roomA.startsWith('antHive#pve_') && roomB.startsWith('antHive#pve_') && roomA !== roomB, 'Each solo visitor gets a personal PvE room.');
  assert.equal(accounts.cadence.join.worldState.pvpMode, 'pve');
  assert.equal(accounts.cadence.join.worldState.pveArea.personal, true);
  const tracks = await request(accounts.cadence, 'pveAreaAction', { action: 'searchTracks' });
  assert(['tracked', 'noTracks', 'crowded'].includes(tracks.reason), 'Searching for tracks returns a server verdict.');
  const tracksAgain = await h.socketAck(accounts.cadence.socket, 'pveAreaAction', { action: 'searchTracks' });
  assert(!tracksAgain.ok && /Подождите/.test(tracksAgain.error), 'Tracks respect their cooldown.');
  const forgedRoom = await h.socketAck(accounts.cadence.socket, 'changeLocation', { locationId: 'antHive', roomId: roomB });
  assert(!forgedRoom.ok || forgedRoom.roomId !== roomB, 'A forged room id never enters someone else\'s personal room.');
  // Область видна на карте до входа: границы, опасность, обитатели и добыча.
  const wastelandAreas = await getJson('/api/wasteland');
  const areaRows = wastelandAreas.json.pveAreas || [];
  assert.equal(areaRows.length, 5, 'Every persistent PvE area reaches the client: ' + JSON.stringify(areaRows).slice(0, 200));
  const hive = areaRows.find(row => row.locationId === 'antHive');
  assert(hive && hive.radiusPoints > 0 && hive.x > 0 && hive.y > 0, 'The area carries its centre and borders.');
  assert(hive.danger >= 1 && hive.inhabitants.length > 0 && hive.lootCategories.length > 0,
    'The area names its danger, inhabitants and loot categories: ' + JSON.stringify(hive));
  console.log('PASS personal PvE rooms, tracks and areas on the world map');

  // --- аванпосты, публичные события, здоровье -------------------------------------------------
  const territory = await request(accounts.trade, 'requestTerritoryState', {});
  assert.equal(territory.territory.outposts.length, 3);
  assert(territory.territory.outposts.every(row => row.eventStatus === 'open'), 'Neutral outposts start with the capture event open.');
  assert(Array.isArray(territory.catalog.factions) && territory.catalog.factions.length === 4, 'The territory catalog names the four factions.');
  const wasteland = await getJson('/api/wasteland');
  assert.equal(wasteland.status, 200);
  assert.equal(wasteland.json.publicEvents.length, 1);
  assert.equal(wasteland.json.publicEvents[0].id, 'pubev_gari_den_1');
  assert(!('deaths' in wasteland.json.publicEvents[0]), 'Public event projections stay public.');
  assert(wasteland.json.publicEvents[0].worldZoneId === 'pubev_gari_den_1' && wasteland.json.publicEvents[0].radius > 0
    && wasteland.json.publicEvents[0].x === 125 && wasteland.json.publicEvents[0].y === 95, 'The event carries its world-map zone id and point for travel.');
  const health = await getJson('/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.kromka?.publicEvents ?? health.json.operations?.publicEvents ?? health.json.publicEvents, 1, '/health counts public events: ' + JSON.stringify(health.json).slice(0, 300));
  // Сценарий события: опасность и мини-босс доходят до клиента.
  const eventRow = (wasteland.json.publicEvents || [])[0];
  assert(eventRow && eventRow.danger >= 1, 'The event carries its danger: ' + JSON.stringify(eventRow).slice(0, 200));
  assert(eventRow.boss && eventRow.boss.displayName, 'The event names its mini boss: ' + JSON.stringify(eventRow.boss));
  console.log('PASS outposts, public events and health');

  // --- мировой босс -----------------------------------------------------------------------------
  await h.connectAndJoin(accounts.progression);
  assert.equal(accounts.progression.join.locationId, 'coreLabCenterReactor', 'A faction member enters the installation.');
  const boss = accounts.progression.join.worldState.worldBoss;
  assert(boss && boss.phase === 'shielded' && boss.nodesTotal === 4 && boss.nodesAlive === 4, 'The Custodian starts shielded by four nodes: ' + JSON.stringify(boss));
  console.log('PASS world boss snapshot');
})().catch(error => {
  console.error(error.stack);
  const logs = h.serverLogs().trim();
  if (logs) console.error(logs.slice(-5000));
  process.exitCode = 1;
}).finally(async () => {
  for (const account of Object.values(accounts)) h.closeSocket(account);
  await h.stopServer();
  h.cleanupSync();
});
