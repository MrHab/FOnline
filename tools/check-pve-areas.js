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
  tracksChance: 0.8, maxAlive: 8, spawnMinPlayerDistance: 14, roomIdleResetMs: 600000
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
const quiet = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0.99, aliveCount: 2, occupied: true });
assert.equal(quiet.reason, 'quiet');
assert.equal(state.rolls, 1);
assert.equal(state.nextRollAt, t0 + rules.rollIntervalMs * 2, 'A roll schedules the next one a full interval later.');
const spawned = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs * 2, { random: () => 0, aliveCount: 2, occupied: true });
assert.equal(spawned.reason, 'spawned');
assert(spawned.spawn && spawned.spawn.spawnCount >= 2);
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

console.log(`PvE areas OK: ${catalog.areas.length} persistent areas, personal rooms with owner checks, no PvP/no loss, timed encounter rolls, tracks and idle reset.`);
