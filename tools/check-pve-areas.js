#!/usr/bin/env node
'use strict';

// Постоянные PvE-области: данные, личные комнаты с проверкой владельца,
// правила зоны без PvP и без потери вещей, плановые встречи под управляемым
// временем, «Искать следы», затишье после зачистки и сброс пустой комнаты.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const pve = require('../src/server/pve-areas');
const { zoneRules, zoneModeAllowsPvp, zoneModeLossPolicy } = require('../src/server/zone-rules');
const { deathLootPolicy } = require('../src/server/kromka-death-loot');
const catalog = pve.normalizePveAreaCatalog(JSON.parse(read('data/kromka/pve-areas.json')));
const mutants = JSON.parse(read('data/mutants.json'));
const mutantIds = new Set(mutants.types.map(row => row.id));

// --- данные ---------------------------------------------------------------------
assert(catalog.areas.length >= 5, 'At least five persistent PvE areas.');
assert.deepEqual(catalog.rules, {
  rollIntervalMs: 90000, calmAfterClearMs: 45000, rollChance: 0.35, tracksCooldownMs: 30000,
  tracksChance: 0.8, maxAlive: 8, spawnMinPlayerDistance: 14, roomIdleResetMs: 600000,
  // Встречи приходят к идущему: между проверками отряд проходит свою долю пути.
  distancePerRollM: 90,
  // Обстоятельства встречи: засада подводит стаю вплотную, смешанная приводит
  // соседа другого вида.
  ambushChance: 0.25, ambushMinPlayerDistance: 6, mixedChance: 0.25, mixedCompanionCount: 1
});
for (const area of catalog.areas) {
  const location = JSON.parse(read(`data/locations/${area.locationId}.json`));
  assert.equal(location.pvpMode, 'pve', `${area.id}: the location must use the pve zone mode.`);
  assert.equal(location.privateInstance, true, `${area.id}: the location must be a private instance.`);
  assert.equal(location.pveArea, true, `${area.id}: the location must be flagged as a PvE area.`);
  assert(!location.randomTemplate && !location.encounterOnly, `${area.id}: a persistent area is not a temporary template.`);
  for (const pack of area.packs) {
    assert(pack.creatureTypeId ? mutantIds.has(pack.creatureTypeId) : pack.typeName === 'Налётчик', `${area.id}/${pack.id}: unknown creature.`);
    assert(pack.count[0] >= 1 && pack.count[1] >= pack.count[0] && pack.weight > 0);
  }
}
assert.equal(pve.pveAreaForLocation(catalog, 'antHive').displayName, 'Колония Пыльников');
assert.equal(pve.pveAreaForLocation(catalog, 'settlement'), null);

// --- правила зоны ----------------------------------------------------------------
assert.equal(zoneModeAllowsPvp('pve'), false, 'No PvP inside PvE areas.');
assert.equal(zoneModeLossPolicy('pve'), 'none', 'Nothing is lost on death in PvE areas.');
assert.deepEqual(deathLootPolicy('pve'), { mode: 'pve', loss: 'none' });
assert.equal(zoneRules('pve').pvp, false);

// --- личные комнаты и владелец ----------------------------------------------------
assert.equal(pve.pveRoomId('antHive', 'char-a'), 'antHive#pve_char-a');
assert.equal(pve.pveRoomOwner('antHive#pve_char-a', 'antHive'), 'char-a');
assert.equal(pve.pveRoomOwner('antHive#site_x', 'antHive'), '');
assert(pve.pveRoomAllowed('antHive#pve_char-a', 'antHive', 'char-a'), 'The owner enters their room.');
assert(!pve.pveRoomAllowed('antHive#pve_char-a', 'antHive', 'char-b'), 'A stranger never enters someone else\'s room.');
assert(pve.pveRoomAllowed('antHive#pve_char-a', 'antHive', 'char-b', new Set(['char-b'])), 'A party member admitted by the server enters.');
assert(!pve.pveRoomAllowed('geckoCanyon#pve_char-a', 'antHive', 'char-a'), 'Room ids are bound to their location.');
assert.equal(pve.pveOwnerKey('bad id!'), 'badid');

// --- встречи под управляемым временем --------------------------------------------------
const area = pve.pveAreaForLocation(catalog, 'antHive');
const rules = catalog.rules;
const t0 = 1000000;
const state = pve.createPveRoomState(area, rules, t0, 'char-a');
assert.equal(state.ownerKey, 'char-a');
const first = pve.initialPacks(state, area, () => 0);
assert.equal(first.length, 1, 'The first entry spawns the authored initial pack.');
assert.equal(first[0].creatureTypeId, 'dustling');
assert.equal(first[0].spawnCount, 2, 'Random zero picks the minimum pack size.');
assert.deepEqual(pve.initialPacks(state, area, () => 0), [], 'Initial packs spawn once per room.');

assert.equal(pve.rollPveEncounter(state, area, rules, t0 + 1000, { random: () => 0, aliveCount: 2, occupied: true }).reason, 'cooldown');
assert.equal(pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0, aliveCount: 2, occupied: false }).reason, 'empty', 'Empty rooms never roll.');
// Стоящий отряд не собирает зверей: проверка ждёт пройденного пути и не
// тратит интервал впустую.
const still = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0, aliveCount: 2, occupied: true });
assert.equal(still.reason, 'still', 'Standing still means no encounter check at all.');
assert.equal(state.rolls, 0, 'A refused check does not count as a roll.');
assert.equal(state.nextRollAt, t0 + rules.rollIntervalMs, 'A refused check does not spend the interval.');
assert.equal(pve.notePveDistance(state, rules.distancePerRollM / 2), rules.distancePerRollM / 2, 'Travel accumulates.');
assert.equal(pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0, aliveCount: 2, occupied: true }).reason,
  'still', 'Half the way is not enough.');
pve.notePveDistance(state, rules.distancePerRollM / 2);
const quiet = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0.99, aliveCount: 2, occupied: true });
assert.equal(state.distanceSinceRollM, 0, 'A check resets the travelled distance.');
assert.equal(quiet.reason, 'quiet');
assert.equal(state.rolls, 1);
assert.equal(state.nextRollAt, t0 + rules.rollIntervalMs * 2, 'A roll schedules the next one a full interval later.');
pve.notePveDistance(state, rules.distancePerRollM);
const spawned = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs * 2, { random: () => 0, aliveCount: 2, occupied: true });
assert.equal(spawned.reason, 'spawned');
assert(spawned.spawn && spawned.spawn.spawnCount >= 2);
pve.notePveDistance(state, rules.distancePerRollM);
assert.equal(pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs * 3, { random: () => 0, aliveCount: rules.maxAlive, occupied: true }).reason, 'crowded');

// Зачистка → затишье: плановая проверка ждёт конца затишья.
assert(!pve.notePveAlive(state, rules, 3, t0 + rules.rollIntervalMs * 3 + 1000), 'Alive enemies are not a clear.');
const clearAt = t0 + rules.rollIntervalMs * 3 + 2000;
assert(pve.notePveAlive(state, rules, 0, clearAt), 'Killing the last enemy clears the area.');
assert.equal(state.kills, 3);
assert.equal(state.calmUntil, clearAt + rules.calmAfterClearMs);
assert.equal(state.lastResult, 'cleared');
assert(state.nextRollAt >= state.calmUntil, 'No scheduled roll lands inside the calm window.');
assert(!pve.notePveAlive(state, rules, 0, clearAt + 10), 'A clear is reported once.');
state.nextRollAt = clearAt + 1000;
pve.notePveDistance(state, rules.distancePerRollM);
assert.equal(pve.rollPveEncounter(state, area, rules, clearAt + 1000, { random: () => 0, aliveCount: 0, occupied: true }).reason, 'calm', 'A forced early roll still respects the calm.');

// «Искать следы»: своя перезарядка, работает в затишье, повышенный шанс.
const tracks = pve.searchTracks(state, area, rules, clearAt + 2000, { random: () => 0.5, aliveCount: 0 });
assert.equal(tracks.reason, 'tracked');
assert(tracks.spawn && tracks.spawn.spawnCount >= 1);
assert.equal(state.calmUntil, 0, 'Tracks break the calm on purpose.');
assert.equal(state.tracksReadyAt, clearAt + 2000 + rules.tracksCooldownMs);
const again = pve.searchTracks(state, area, rules, clearAt + 3000, { random: () => 0, aliveCount: 1 });
assert(!again.ok && again.reason === 'cooldown' && again.readyInMs > 0);
const none = pve.searchTracks(state, area, rules, clearAt + 2000 + rules.tracksCooldownMs, { random: () => 0.95, aliveCount: 1 });
assert(none.ok && none.reason === 'noTracks');
const crowded = pve.searchTracks(state, area, rules, clearAt + 2000 + rules.tracksCooldownMs * 2, { random: () => 0, aliveCount: rules.maxAlive });
assert(crowded.ok && crowded.reason === 'crowded');

// Публичный снимок без внутренних ключей.
const snapshot = pve.publicPveRoomState(state, area, rules, clearAt + 2000 + rules.tracksCooldownMs * 2, { aliveCount: 1, members: 2 });
assert.equal(snapshot.mode, 'pve');
assert.equal(snapshot.personal, true);
assert.equal(snapshot.members, 2);
assert.equal(snapshot.tracksLabel, 'Искать следы');
assert(snapshot.lastResultLabel.length > 0);
assert(!('ownerKey' in snapshot) && !('nextRollAt' in snapshot));
assert.equal(pve.publicPveRoomState(null, area, rules), null);

// Сброс пустой комнаты по простою.
assert(!pve.pveRoomIdle(state, rules, 0, clearAt), 'An occupied room never idles.');
assert(!pve.pveRoomIdle(state, rules, clearAt, clearAt + rules.roomIdleResetMs - 1));
assert(pve.pveRoomIdle(state, rules, clearAt, clearAt + rules.roomIdleResetMs));

// Выбор группы по весам детерминирован инжектированным генератором.
const oldDepot = pve.pveAreaForLocation(catalog, 'oldDepot');
assert.equal(pve.choosePack(oldDepot, () => 0.99).typeName, 'Налётчик');
assert.equal(pve.choosePack(oldDepot, () => 0).creatureTypeId, 'burned');

// --- серверные контракты -------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  "const KROMKA_PVE_AREA_CATALOG = normalizePveAreaCatalog(readJson(KROMKA_PVE_AREAS_FILE",
  'function serverResolvePveRoomId(player = {}, locationId = \'\', requestedRoomId = \'\')',
  '? serverResolvePveRoomId(p, locationId, effectiveRoomId || requestedRoomId)',
  '? serverResolvePveRoomId({ characterId, userId: auth.user.id }, locationId, savedRoomId)',
  'if (pveJoinRoomId) serverPveRoomEntered(room, p, Date.now());',
  '? serverResolvePveRoomId(leader, targetLocationId, \'\')',
  "roomId: resolution.encounterRoomId || pveArrivalRoomId || '',",
  "socket.on('pveAreaAction'",
  "emit('pveAreaState', payload)",
  'serverTickPveRooms(Date.now())',
  'pveArea: room.pveState'
]) assert(server.includes(needle), `server.js is missing the PvE area contract: ${needle}`);
const socketClient = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
assert(socketClient.includes('_connection.On("pveAreaState"') && socketClient.includes('OnPveAreaState?.Invoke(payload)'), 'Unity must route pveAreaState.');
assert(read('unity-client/Assets/Scripts/Game/RoaPveAreaNet.cs').includes('EmitWithAck("pveAreaAction"'), 'Unity must be able to search for tracks.');

// --- область видна на карте до входа -------------------------------------------
const mapNodes = JSON.parse(read('data/global-map.json')).nodes;
const pointFor = locationId => {
  const node = mapNodes.find(row => row.locationId === locationId || row.id === locationId);
  return node ? { x: node.x, y: node.y } : null;
};
const publicAreas = pve.publicPveAreaCatalog(catalog, pointFor);
assert.equal(publicAreas.length, catalog.areas.length, 'Every area reaches the client.');
for (const row of publicAreas) {
  assert(row.x > 0 && row.y > 0, `${row.id}: the area has a centre on the world map`);
  assert(row.radiusPoints >= 4, `${row.id}: the area has borders`);
  assert(row.danger >= 1 && row.danger <= 5, `${row.id}: the area declares its danger`);
  assert(row.inhabitants.length > 0, `${row.id}: the area names its inhabitants`);
  assert(row.lootCategories.length > 0, `${row.id}: the area names its loot categories`);
  assert.equal(row.personal, true, `${row.id}: the encounter is personal`);
}
assert(server.includes('pveAreas: publicPveAreaCatalog(KROMKA_PVE_AREA_CATALOG, serverGlobalMapPointForLocation)'),
  '/api/wasteland must publish the area catalog: without it the client cannot draw borders.');
const clientMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
for (const token of ['_wasteland["pveAreas"]', 'DrawWorldRing("PveArea:', 'PveAreaLabel(', 'PveAreaAt('])
  assert(clientMap.includes(token), `RoaGlobalMap must show the area: ${token}`);

// --- обстоятельства встречи ------------------------------------------------------
// Одна и та же область встречает по-разному: обычно стая бродит поодаль,
// иногда поджидает вплотную, иногда приводит соседа другого вида.
{
  const area = catalog.areas.find(row => row.packs.length > 1);
  assert(area, 'An area with more than one pack is needed for mixed encounters.');
  const pack = area.packs[0];
  const kinds = new Map();
  for (let i = 0; i < 400; i += 1) {
    const roll = i / 400;
    const circumstance = pve.chooseCircumstance(area, pack, catalog.rules, () => roll);
    kinds.set(circumstance.kind, (kinds.get(circumstance.kind) || 0) + 1);
    if (circumstance.kind === 'mixed') {
      assert(circumstance.companion && circumstance.companion.id !== pack.id,
        'A mixed encounter brings a neighbour of another kind.');
      assert(area.packs.some(row => row.id === circumstance.companion.id),
        'The companion is authored for this very area.');
      assert(circumstance.companion.spawnCount >= 1);
    }
    if (circumstance.kind !== 'mixed') assert.equal(circumstance.companion, null);
  }
  assert.deepEqual([...kinds.keys()].sort(), ['ambush', 'mixed', 'wandering'], 'All three circumstances happen.');
  assert(kinds.get('wandering') > kinds.get('ambush'), 'Wandering stays the usual case.');

  // Обстоятельство доезжает до сервера вместе с пачкой и до игрока — словами.
  const state = pve.createPveRoomState(area, catalog.rules, 0, 'char-x');
  pve.notePveDistance(state, catalog.rules.distancePerRollM);
  const rolled = pve.rollPveEncounter(state, area, catalog.rules, catalog.rules.rollIntervalMs, {
    aliveCount: 0, occupied: true, random: () => 0.01
  });
  assert(rolled.spawn && rolled.spawn.circumstance, 'The roll carries the circumstance: ' + JSON.stringify(rolled.spawn || {}));
  assert.equal(rolled.spawn.circumstance.kind, 'ambush', 'A low roll means an ambush.');
  const view = pve.publicPveRoomState(state, area, catalog.rules, catalog.rules.rollIntervalMs, { aliveCount: 3, members: 1 });
  assert.equal(view.lastCircumstance, 'ambush');
  assert(view.lastResultLabel.includes('засада'), 'The player is told about the ambush: ' + view.lastResultLabel);

  // По следам идут сами — засады не бывает.
  const tracked = pve.createPveRoomState(area, catalog.rules, 0, 'char-y');
  const tracks = pve.searchTracks(tracked, area, catalog.rules, catalog.rules.tracksCooldownMs, {
    aliveCount: 0, random: () => 0.01
  });
  assert(tracks.ok && tracks.spawn, 'Tracks lead to a group: ' + JSON.stringify(tracks));
  assert.notEqual(tracks.spawn.circumstance.kind, 'ambush', 'Following tracks is never an ambush.');
}

// Сервер обязан различать обстоятельства: засада появляется ближе и сразу
// идёт на игрока, смешанная приводит спутника.
{
  const serverSource = read('server.js');
  for (const token of [
    "const ambush = circumstance?.kind === 'ambush';",
    'spawned.push(...serverSpawnPvePack(room, area, { ...circumstance.companion, circumstance: null }, now));',
    'minPlayerDistance: ambush ? rules.ambushMinPlayerDistance : rules.spawnMinPlayerDistance',
    'if (prey?.player) aggroEnemyFromHit(room, enemy, prey.player, now);'
  ]) assert(serverSource.includes(token), `server.js must honour the encounter circumstances: ${token}`);
}

// Сервер обязан считать пройденный путь и показывать остаток игроку.
{
  const serverSource = read('server.js');
  for (const token of [
    'function serverNotePveTravel(room, occupants = []) {',
    'serverNotePveTravel(room, occupants);',
    'if (mark) best = Math.max(best, Math.hypot(x - mark.x, z - mark.z));'
  ]) assert(serverSource.includes(token), `server.js must count the travelled path: ${token}`);
  const area = catalog.areas[0];
  const state = pve.createPveRoomState(area, catalog.rules, 0, 'char-z');
  const view = pve.publicPveRoomState(state, area, catalog.rules, 0, { aliveCount: 0, members: 1 });
  assert.equal(view.distanceToRollM, catalog.rules.distancePerRollM, 'A standing party sees the whole way ahead.');
  pve.notePveDistance(state, 30);
  assert.equal(pve.publicPveRoomState(state, area, catalog.rules, 0, { aliveCount: 0, members: 1 }).distanceToRollM,
    catalog.rules.distancePerRollM - 30, 'The remaining way shrinks as the party walks.');
}

console.log(`PvE areas OK: ${catalog.areas.length} persistent areas, personal rooms with owner checks, no PvP/no loss, timed encounter rolls, tracks and idle reset.`);
