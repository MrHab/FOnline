#!/usr/bin/env node
'use strict';

// Сетевая проверка зон мира на реальном сервере (изолированный DATA_DIR):
// членство во фракции на путях входа, скрытые свойства артефактов до платной
// стабилизации, разбор с идемпотентным requestId, личные комнаты PvE-области
// и «Искать следы», аванпосты и публичные события в /api/wasteland и /health,
// мировой босс в снимке комнаты установки, зал боковой лаборатории и правила
// его узлов, незабранная награда босса после перезапуска.

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

  // Член «Управы» на глобальной карте у самого узла Сердцевины: его маршрут
  // проверяет, что ворота срабатывают и без точного попадания в узел.
  const courier = stateFor('harvest');
  courier.territoryFaction = membership('uprava');
  courier.globalMap = { onWorldMap: true, playerX: 190, playerY: 162 };

  // Член «Управы» в зале боковой лаборатории «Цепь».
  const technician = stateFor('modification');
  technician.currentLocationId = 'coreLabCircuit';
  technician.serverLocationContext = { locationId: 'coreLabCircuit' };
  technician.territoryFaction = membership('uprava');

  // Второй член фракции в той же лаборатории: подземелья общие, личных копий
  // наград там нет — обоих ждёт одна комната и одни сейфы.
  const rival = stateFor('strictAp');
  rival.currentLocationId = 'coreLabCircuit';
  rival.serverLocationContext = { locationId: 'coreLabCircuit' };
  rival.territoryFaction = membership('contour');

  // Член «Управы» внутри установки «Объекта Ноль».
  const raider = stateFor('progression');
  raider.currentLocationId = 'coreLabCenterReactor';
  raider.serverLocationContext = { locationId: 'coreLabCenterReactor' };
  raider.territoryFaction = membership('uprava');

  // Двое в одном публичном событии: комната общая, враги и тайник — одни.
  for (const role of ['dualPistols', 'equipmentAp']) {
    const visitor = stateFor(role);
    visitor.currentLocationId = 'randomDryBasin';
    visitor.serverLocationContext = {
      locationId: 'randomDryBasin',
      roomId: 'randomDryBasin#pubev_gari_den_1',
      worldZoneId: 'pubev_gari_den_1'
    };
  }

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
  // Правила зоны за переходом приходят вместе с самим переходом: клиент
  // предупреждает до входа, а не после прибытия.
  const definitions = await getJson('/api/locations');
  assert.equal(definitions.status, 200);
  const baseDefinition = definitions.json.locations.coreBaseUprava;
  const metro = (baseDefinition.transitions || []).find(row => row.id === 'metro_platform');
  assert(metro && metro.targetZoneRules, 'The metro platform carries the rules of the zone behind it: ' + JSON.stringify(metro || {}).slice(0, 200));
  assert.equal(metro.targetPvpMode, 'pvpBlack', 'The territory is a black zone (economy v3).');
  assert.equal(metro.targetZoneRules.loss, 'all', 'Death in the territory drops everything.');
  assert.equal(metro.targetZoneRules.confirmBeforeEntry, true, 'The territory asks for confirmation before entry.');
  assert(String(metro.targetZoneRules.lossLabel || '').length > 0, 'The rules explain what is lost on death.');
  const labDoor = (definitions.json.locations.coreZone.transitions || []).find(row => row.id === 'enter_coreLabSprout');
  assert.equal(labDoor.targetZoneRules.mode, 'pvpBlack', 'A laboratory inherits the rules of the territory.');
  const settlementExit = (definitions.json.locations.settlement.transitions || [])
    .find(row => row.targetZoneRules && row.targetZoneRules.mode === 'peaceful');
  if (settlementExit) assert.equal(settlementExit.targetZoneRules.confirmBeforeEntry, false, 'A peaceful transition does not ask.');
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
  // Маршрут к Сердцевине, завершившийся точкой рядом с узлом, тоже открывает
  // ворота: игрок не должен «доехать и ничего не получить».
  await h.connectAndJoin(accounts.harvest);
  await request(accounts.harvest, 'globalTravelStart',
    { targetLocationId: 'coreZone', worldPoint: { x: 196, y: 156 } });
  const nearGate = await (async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await h.socketAck(accounts.harvest.socket, 'globalTravelArrive',
        { targetLocationId: 'coreZone', worldPoint: { x: 196, y: 156 } });
      if (!/ещё нужно дойти/.test(response.error || '')) return response;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error('the traveller never reached the point near the territory node');
  })();
  assert.equal(nearGate.ok, true, 'Arriving near the node still opens the gate: ' + JSON.stringify(nearGate).slice(0, 300));
  assert.equal(nearGate.targetLocationId, 'coreBaseUprava',
    'A route aimed at the territory routes to the base even when the arrival degrades to a map point.');
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
  // Логово угодий в единственном экземпляре: двое вошедших порознь
  // оказываются в одной комнате и видят одного и того же главаря.
  assert.equal(roomA, 'antHive#lair', 'A hunting-ground lair is one shared room: ' + roomA);
  assert.equal(roomA, roomB, 'Two visitors of the same lair meet each other, not their own copies.');
  assert.equal(accounts.cadence.join.worldState.pvpMode, 'pve');
  assert.equal(accounts.cadence.join.worldState.pveArea.personal, false);
  // В логове следы не ищут: главарь и так здесь, а встречи живут снаружи.
  const tracks = await h.socketAck(accounts.cadence.socket, 'pveAreaAction', { action: 'searchTracks' });
  assert(!tracks.ok && /логове/.test(tracks.error), 'A lair refuses the tracks hunt: ' + JSON.stringify(tracks));
  // Подделанный roomId больше не уводит в чужую комнату: у логова она одна.
  const forgedRoom = await h.socketAck(accounts.cadence.socket, 'changeLocation', { locationId: 'antHive', roomId: 'antHive#pve_someone_else' });
  assert(!forgedRoom.ok || forgedRoom.roomId === 'antHive#lair', 'A forged room id never opens a room of its own.');
  // Область видна на карте до входа: границы, опасность, обитатели и добыча.
  const wastelandAreas = await getJson('/api/wasteland');
  const areaRows = wastelandAreas.json.pveAreas || [];
  assert.equal(areaRows.length, 5, 'Every persistent PvE area reaches the client: ' + JSON.stringify(areaRows).slice(0, 200));
  const hive = areaRows.find(row => row.locationId === 'antHive');
  assert(hive && hive.radiusPoints > 0 && hive.x > 0 && hive.y > 0, 'The area carries its centre and borders.');
  assert(hive.danger >= 1 && hive.inhabitants.length > 0 && hive.lootCategories.length > 0,
    'The area names its danger, inhabitants and loot categories: ' + JSON.stringify(hive));
  // В логове стоит главарь со свитой — и оба вошедших видят одних и тех же.
  const lairEnemies = accounts.cadence.join.worldState.enemies || [];
  assert(lairEnemies.some(row => String(row.name || '').includes('Пыльник-матка')),
    'The lair must greet its visitors with the mini boss: ' + JSON.stringify(lairEnemies.map(r => r.name)).slice(0, 200));
  assert(lairEnemies.length >= 2 && lairEnemies.length <= 6,
    'A lair holds the boss and its escort, nothing else: ' + JSON.stringify(lairEnemies.map(r => [r.name, r.faction])));
  const lairFactions = new Set(lairEnemies.map(row => String(row.faction || '')));
  assert(lairFactions.size === 1,
    'The lair must not fight itself in front of the player: ' + JSON.stringify([...lairFactions]));
  // Карточка обещает ровно то, что обитатели логова несут на самом деле. Раньше
  // она читала таблицы добычи, которые в мире не разыгрываются, и сулила химикаты
  // и электронику там, где с пыльника падает один трофей.
  const promised = (hive.rewardPreview || []).map(row => row.id);
  const carried = new Set(lairEnemies.flatMap(row => (row.inventory || []).map(item => item.id)));
  assert(carried.size > 0, 'The inhabitants of the lair carry their drop: ' + JSON.stringify(lairEnemies.map(r => r.inventory)).slice(0, 200));
  assert.deepEqual([...promised].sort(), [...carried].sort(),
    'The hive card must promise what its inhabitants drop, no more and no less: ' + JSON.stringify({ promised, carried: [...carried] }));
  assert.equal(hive.rewardPreview[0].name, 'Трофей', 'The reward reaches the card under its inventory name.');
  // Депо держат люди: с них падают марки и останки снаряжения (само снаряжение
  // с трупа не падает), а в логове стоят узлы деталей патронов, электроники и лома.
  const depot = areaRows.find(row => row.locationId === 'oldDepot');
  assert.deepEqual(depot.rewardPreview.map(row => row.id), ['silver', 'weaponParts', 'scrap', 'ammoParts'],
    'The depot card names marks, gear remains and the lair nodes: ' + JSON.stringify(depot.rewardPreview));
  const gearIds = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kromka', 'items.json'))).items
    .filter(row => ['weapons', 'armor', 'tools', 'artifacts'].includes(row.category)).map(row => row.id));
  for (const area of areaRows) {
    assert(area.rewardPreview.length > 0, `${area.id}: the card previews a reward`);
    for (const reward of area.rewardPreview) {
      assert(!gearIds.has(reward.id), `${area.id}: the card promises ${reward.id}, but gear comes from player crafting only`);
    }
  }
  console.log('PASS one shared lair with its boss and escort, tracks and areas on the world map, cards promise the real drop');

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
  // Логово — общая реальность: оба игрока попадают в одну комнату события и
  // видят одних и тех же врагов, а не личные копии.
  await h.connectAndJoin(accounts.dualPistols);
  await h.connectAndJoin(accounts.equipmentAp);
  assert.equal(accounts.dualPistols.join.roomId, 'randomDryBasin#pubev_gari_den_1',
    'A visitor lands in the room of the event: ' + accounts.dualPistols.join.roomId);
  assert.equal(accounts.equipmentAp.join.roomId, accounts.dualPistols.join.roomId,
    'Both visitors share one room of the event.');
  const firstEnemies = (accounts.dualPistols.join.worldState.enemies || []).map(row => row.id).sort();
  const secondEnemies = (accounts.equipmentAp.join.worldState.enemies || []).map(row => row.id).sort();
  assert(firstEnemies.length > 0, 'The lair is inhabited: ' + JSON.stringify(firstEnemies).slice(0, 200));
  assert.deepEqual(secondEnemies, firstEnemies, 'Both visitors see the same enemies, not personal copies.');
  const firstEvent = accounts.dualPistols.join.worldState.publicEvent;
  const secondEvent = accounts.equipmentAp.join.worldState.publicEvent;
  assert(firstEvent && firstEvent.id === 'pubev_gari_den_1', 'The room carries the event: ' + JSON.stringify(firstEvent || {}).slice(0, 200));
  assert.equal(secondEvent?.id, firstEvent.id, 'The event state is shared by the room.');
  assert.equal(secondEvent?.cleared, firstEvent.cleared, 'Clearing the lair is a shared goal.');
  const eventPvp = accounts.dualPistols.join.zoneRules || accounts.dualPistols.join.worldState.zoneRules;
  if (eventPvp) assert.equal(eventPvp.loss, 'none', 'A public event costs no items on death: ' + JSON.stringify(eventPvp));
  console.log('PASS two players share one public event room');

  console.log('PASS outposts, public events and health');

  // --- мировой босс -----------------------------------------------------------------------------
  await h.connectAndJoin(accounts.progression);
  assert.equal(accounts.progression.join.locationId, 'coreLabCenterReactor', 'A faction member enters the installation.');
  const boss = accounts.progression.join.worldState.worldBoss;
  assert(boss && boss.phase === 'shielded' && boss.nodesTotal === 4 && boss.nodesAlive === 4, 'The Custodian starts shielded by four nodes: ' + JSON.stringify(boss));
  console.log('PASS world boss snapshot');

  // --- зал боковой лаборатории -------------------------------------------------------------------
  await h.connectAndJoin(accounts.modification);
  assert.equal(accounts.modification.join.locationId, 'coreLabCircuit', 'A faction member enters the side laboratory.');
  const hall = accounts.modification.join.worldState.labHall;
  assert(hall && hall.meterLabel === 'Перегрузка' && hall.hazardName && hall.nodes.length === 2,
    'The hall snapshot carries its meter, hazard and nodes: ' + JSON.stringify(hall).slice(0, 300));
  assert(hall.sectors.length >= 1 && hall.sectors.every(row => Number.isFinite(row.x) && Number.isFinite(row.z)),
    'The snapshot names the sectors that will burn.');
  assert(!('seed' in hall), 'The hall snapshot stays public.');
  const unknownNode = await h.socketAck(accounts.modification.socket, 'labNodeAction', { nodeId: 'node_zzz' });
  assert(!unknownNode.ok && /узл/i.test(unknownNode.error), 'An unknown node is refused: ' + JSON.stringify(unknownNode));
  // Узел работает только вблизи: от точки прибытия щиты недосягаемы.
  const farNode = await h.socketAck(accounts.modification.socket, 'labNodeAction', { nodeId: 'node_a' });
  assert(!farNode.ok && /Подойдите/i.test(farNode.error), 'A distant node is refused: ' + JSON.stringify(farNode));
  const otherHall = await h.socketAck(accounts.progression.socket, 'labNodeAction', { nodeId: 'node_a' });
  assert(!otherHall.ok, 'The installation has no hall nodes: ' + JSON.stringify(otherHall));
  // Внутренняя часть опаснее внешней: за герметичной секцией стоят те же
  // виды, но откормленные, и сервер выдаёт им авторские характеристики.
  const labEnemies = accounts.modification.join.worldState.enemies || [];
  const byName = name => labEnemies.filter(row => String(row.name || '') === name);
  assert(byName('Слухач').every(row => row.maxHp === 54), 'The outer guards keep the ordinary stats of their kind: '
    + JSON.stringify(byName('Слухач').map(row => row.maxHp)));
  assert(byName('Складень').some(row => row.maxHp === 252), 'The inner guard is fed up on health: '
    + JSON.stringify(byName('Складень').map(row => row.maxHp)));
  assert(byName('Выжженный').some(row => row.maxHp === 87), 'The second inner guard is reinforced too: '
    + JSON.stringify(byName('Выжженный').map(row => row.maxHp)));
  // Лаборатория — общая реальность: второй игрок, пусть даже из другой
  // фракции, попадает в ту же комнату и видит те же контейнеры.
  await h.connectAndJoin(accounts.strictAp);
  assert.equal(accounts.strictAp.join.locationId, 'coreLabCircuit');
  assert.equal(accounts.strictAp.join.roomId, accounts.modification.join.roomId,
    'Two players share one laboratory room: ' + accounts.strictAp.join.roomId + ' vs ' + accounts.modification.join.roomId);
  const mine = (accounts.modification.join.worldState.containers || []).map(row => row.id).sort();
  const theirs = (accounts.strictAp.join.worldState.containers || []).map(row => row.id).sort();
  assert(mine.length >= 3 && theirs.length >= 3, 'The laboratory keeps its safes: ' + JSON.stringify(mine));
  assert.deepEqual(theirs, mine, 'Both players see the same safes, not personal copies.');
  assert.equal(accounts.strictAp.join.worldState.labHall?.roomId, accounts.modification.join.worldState.labHall?.roomId,
    'The hall threat is shared by the room, not owned by a player.');
  console.log('PASS laboratory hall snapshot, node range, the dangerous inner section and the shared room');

  // --- награда побеждённого босса переживает перезапуск -------------------------------------------
  for (const account of Object.values(accounts)) h.closeSocket(account);
  await h.stopServer();
  const restartSaves = JSON.parse(fs.readFileSync(savesPath));
  const defeatedAt = Date.now() - 60000;
  restartSaves.worldBosses = {
    zeroCustodian: {
      bossId: 'zeroCustodian', defeatedAt, respawnAt: defeatedAt + 5400000, kills: 1,
      // Один сейф уже обобрали, второй так и остался нетронутым.
      reward: { unlockedAt: defeatedAt, claimed: ['boss_vault_a'] }
    }
  };
  fs.writeFileSync(savesPath, JSON.stringify(restartSaves, null, 2));
  await h.startServer();
  await h.connectAndJoin(accounts.progression);
  const afterRestart = accounts.progression.join.worldState;
  assert.equal(afterRestart.worldBoss.phase, 'defeated', 'The defeated boss stays defeated after a restart.');
  const vaults = Object.fromEntries((afterRestart.containers || [])
    .filter(row => String(row.defId || '').startsWith('boss_vault'))
    .map(row => [row.defId, row]));
  assert(vaults.boss_vault_a && vaults.boss_vault_b, 'The installation keeps both reward containers: ' + JSON.stringify(Object.keys(vaults)));
  assert.equal(vaults.boss_vault_a.locked, true, 'The looted reward does not open a second time.');
  assert.equal(vaults.boss_vault_b.locked, false, 'The untouched reward waits for its owner after the restart.');
  assert.equal(vaults.boss_vault_b.terminalLocked, false, 'The untouched reward is not held by the terminal either.');
  assert(vaults.boss_vault_b.empty === false, 'The restored reward is not empty: ' + JSON.stringify(vaults.boss_vault_b).slice(0, 200));
  console.log('PASS the untouched boss reward survives a restart');
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
