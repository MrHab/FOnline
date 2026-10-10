#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ecology = require('../src/server/danger-ecology');
const alife = require('../src/server/open-world-alife');
const captureAwards = require('../src/server/alife-capture-awards');
const { siteActorVisualAction } = require('../src/server/alife-visual-action');
const { zoneRecipe } = require('../src/server/zone-graph');
const { normalizeRecipe } = require('../src/server/zone-builder');
const terrain = require('../src/server/sector-terrain');
const { createLocationCollision, circleBlockerPenalty } = require('../src/server/location-collision');

const catalog = alife.normalizeCatalog(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/kromka/open-world-alife.json'), 'utf8')));
assert.equal(catalog.huntingGrounds.length, 3);
assert.equal(catalog.outposts.length, 2);
assert(catalog.outposts.every(site => site.displayName && !site.displayName.startsWith('alife_')),
  'outposts have player-facing names in authored data');
const merchantStock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/traders.json'), 'utf8')).profiles.caravan.stock;
assert(['ammo9', 'medkit', 'antibiotics', 'repairKit'].every(itemId => merchantStock.some(row => row.id === itemId)),
  'caravan profile offers the required consumables');
assert(catalog.caravanRobberyRewards[1].length && catalog.caravanRobberyRewards[5].length,
  'robbery has its own tier reward tables');
assert.notDeepEqual(catalog.caravanRobberyRewards[1], merchantStock,
  'robbery reward is not the remaining trade stock');
for (const zoneId of catalog.anomalyRoutes) {
  const zone = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/zones/authored', `${zoneId}.json`), 'utf8'));
  assert((zone.anomalyFields || []).length >= 3, `${zoneId}: stalker route targets a large anomaly cluster`);
}

function sourcePoint(row) {
  const point = row.surfaceSourcePoint || row;
  return { x: Number(point.x), z: Number(point.z) };
}
function runtimePoint(row) {
  return { x: Number(row.x ?? row.tx * 2 - 159), z: Number(row.z ?? row.tz * 2 - 159) };
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const square = dx * dx + dz * dz;
  const t = square ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / square)) : 0;
  return Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t);
}

for (const site of catalog.huntingGrounds) {
  const zone = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/zones/authored', `${site.locationId}.json`), 'utf8'));
  const spawn = (zone.zone?.spawnAreas || []).find(row => row.tx === site.tx && row.tz === site.tz);
  assert(spawn, `${site.id}: the authored area has an actual spawn anchor`);
  assert.equal(site.x, sourcePoint(spawn).x);
  assert.equal(site.z, sourcePoint(spawn).z);
  assert(site.radius <= Number(spawn.radius), `${site.id}: the whole hunting area stays in the authored spawn area`);
  const nodes = new Map((zone.zone?.nav?.nodes || []).map(row => [row.id, row]));
  for (const [from, to] of zone.zone?.nav?.links || []) {
    if (from.startsWith('surface_') || to.startsWith('surface_')) continue;
    if (!nodes.has(from) || !nodes.has(to)) continue;
    const distance = distanceToSegment(site, sourcePoint(nodes.get(from)), sourcePoint(nodes.get(to)));
    assert(distance > site.radius + 3, `${site.id}: the whole hunting area must clear a navigable road (${distance.toFixed(1)} m)`);
  }
  for (const obj of zone.objects || []) {
    if (obj.collision !== 'solid' || obj.role === 'cover') continue;
    const point = obj.surfaceSourcePosition || obj.position;
    if (!point) continue;
    assert(Math.hypot(site.x - Number(point.x), site.z - Number(point.z)) > site.radius + 2,
      `${site.id}: the whole hunting area must clear buildings and solid obstacles (${obj.id})`);
  }
}
console.log('PASS authored hunting areas clear road links and non-cover solid objects across their full radius');

// The same authored sectors also contain regular fixed dens. Validate their
// exact anchors, not just the hunting circles, before using them for guards.
for (const locationId of [...new Set(catalog.huntingGrounds.map(site => site.locationId))]) {
  const zone = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/zones/authored', `${locationId}.json`), 'utf8'));
  const nodes = new Map((zone.zone?.nav?.nodes || []).map(row => [row.id, row]));
  for (const den of zone.zone?.lairs || []) {
    const point = sourcePoint(den);
    for (const [from, to] of zone.zone?.nav?.links || []) {
      if (from.startsWith('surface_') || to.startsWith('surface_')) continue;
      if (!nodes.has(from) || !nodes.has(to)) continue;
      assert(distanceToSegment(point, sourcePoint(nodes.get(from)), sourcePoint(nodes.get(to))) > 3,
        `${locationId}:${den.id}: fixed den must clear a road`);
    }
    for (const obj of zone.objects || []) {
      if (obj.collision !== 'solid' || obj.role === 'cover') continue;
      const obstacle = obj.surfaceSourcePosition || obj.position;
      if (!obstacle) continue;
      assert(Math.hypot(point.x - Number(obstacle.x), point.z - Number(obstacle.z)) > 2,
        `${locationId}:${den.id}: fixed den must clear a building (${obj.id})`);
    }
  }
}
console.log('PASS fixed den anchors clear roads and solid objects in the authored hunting sectors');

const graph = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/kromka/zone-graph.json'), 'utf8'));
const collider = createLocationCollision();
let expectedLairs = 0;
for (const zone of graph.zones) {
  if (zone.city || !ecology.LIVING_MODES.includes(zone.mode)) continue;
  const loc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/zones/authored', `${zone.id}.json`), 'utf8'));
  const nodes = new Map((loc.zone?.nav?.nodes || []).map(row => [row.id, row]));
  const links = (loc.zone?.nav?.links || []).filter(([a, b]) => !a.startsWith('surface_')
    && !b.startsWith('surface_') && nodes.has(a) && nodes.has(b));
  const blockers = (loc.objects || []).flatMap(row => collider.locationObjectBlockers(row));
  const count = normalizeRecipe(zoneRecipe(graph, zone.id)).budget.lairs;
  const placed = [];
  expectedLairs += count;
  for (let slot = 0; slot < count; slot++) {
    const id = `lair_${zone.id}_${slot}`;
    const anchor = catalog.lairAnchorsById[id];
    assert(anchor && anchor.locationId === zone.id, `${id}: fixed anchor exists in authoring`);
    assert.equal(anchor.x, anchor.tx * 2 - 159, `${id}: x matches tile`);
    assert.equal(anchor.z, anchor.tz * 2 - 159, `${id}: z matches tile`);
    assert(Math.abs(anchor.x) <= 145 && Math.abs(anchor.z) <= 145, `${id}: guards remain inside sector`);
    assert(placed.every(other => Math.hypot(anchor.x - other.x, anchor.z - other.z) >= 2),
      `${id}: two lairs cannot share a spawn point`);
    placed.push(anchor);
    for (const [a, b] of links) assert(distanceToSegment(anchor, runtimePoint(nodes.get(a)), runtimePoint(nodes.get(b))) > 3.5,
      `${id}: lair must clear the navigable road`);
    for (const blocker of blockers) assert.equal(circleBlockerPenalty(anchor.x, anchor.z, 0.8, blocker), 0,
      `${id}: lair must clear authored buildings and solid obstacles (${blocker.objectId})`);
    assert(!terrain.isWaterAt(zone.id, anchor.x, anchor.z, 0.8), `${id}: lair must stand on dry ground`);
    let steepApproaches = 0;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]])
      if (terrain.steepUphill(zone.id, anchor.x + dx, anchor.z + dz, anchor.x, anchor.z)) steepApproaches++;
    assert(steepApproaches < 2, `${id}: lair must have multiple walkable approaches`);
  }
}
assert.equal(expectedLairs, 237);
assert.equal(catalog.lairAnchors.length, expectedLairs, 'the authored catalog covers each active lair exactly once');
console.log('PASS all 237 fixed lairs have distinct authored anchors clear of roads, colliders, water and impassable slopes');

for (const def of catalog.outposts) {
  const zone = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/kromka/zone-graph.json'), 'utf8'))
    .zones.find(row => row.id === def.locationId);
  const place = zone?.places?.find(row => row.locationId === def.siteLocationId);
  assert(place && place.kind === 'outpost', `${def.id}: live outpost is placed in its playable zone`);
  assert(Math.abs(def.x - (def.bounds.minX + def.bounds.maxX) / 2) <= 2
    && Math.abs(def.z - (def.bounds.minZ + def.bounds.maxZ) / 2) <= 2,
  `${def.id}: boss and map marker stand at the centre of the authored walls`);
  assert(Math.abs(Number(place.u) - (def.x + 160) / 320) < 0.01
    && Math.abs(Number(place.v) - (160 - def.z) / 320) < 0.01,
  `${def.id}: global map place points to the same physical outpost`);
  assert(Math.abs(def.x) + def.radius < 160 && Math.abs(def.z) + def.radius < 160,
    `${def.id}: outpost boundary stays inside its sector`);
  assert(def.bounds && def.bounds.minX < def.x && def.bounds.maxX > def.x
    && def.bounds.minZ < def.z && def.bounds.maxZ > def.z,
  `${def.id}: capture boundary covers the authored structure`);
  assert(alife.within(def, { x: def.bounds.maxX - 1, z: def.bounds.maxZ - 1 }),
    `${def.id}: far corner inside the walls counts for capture and shelter`);
  assert(!alife.within(def, { x: def.bounds.maxX + 1, z: def.bounds.maxZ - 1 }),
    `${def.id}: space outside the wall does not count`);
}
console.log('PASS outpost boundaries match authored playable sector sites');

const config = ecology.normalizeEcologyConfig({
  stationaryLairs: true, clearedLairRespawnMinutes: 5,
  lairs: { capacity: { pvp: 1 }, refillMinutes: { pvp: 5 } },
  species: [{ id: 'pack', kind: 'monster', members: [{ type: 'beast', min: 3, max: 3 }], habitat: { pvp: 1 } }]
});
const candidates = [{ id: 'fixed', sx: 1, sy: 2, mode: 'pvp', speciesId: 'pack' },
  { id: 'hunting', kind: 'huntingGround', sx: 1, sy: 2, mode: 'pvp', speciesId: 'pack', tx: 7, tz: 8, x: 1, z: 2 }];
const state = ecology.emptyEcologyState('fixed-world');
ecology.resetLairs(state, ecology.buildLairs(config, candidates, 'fixed-world'), 'fixed-world');
const occupied = { occupied: () => true, occupiedCells: [{ sx: 1, sy: 2 }], createMember: () => ({ maxHp: 40 }) };
let now = 1_000_000;
let events = ecology.tickEcology(state, config, occupied, now, () => 0.5);
assert.equal(events.filter(event => event.type === 'spawn').length, 2, 'initial groups appear even with players in the zone');
const fixedGroup = [...state.groups.values()].find(group => group.lairId === 'fixed');
assert(fixedGroup);
ecology.tickEcology(state, config, occupied, now + 60000, () => 0.5);
assert.deepEqual([fixedGroup.sx, fixedGroup.sy], [1, 2], 'guards never cross into another zone');
for (const member of [...fixedGroup.members]) ecology.memberKilled(state, config, fixedGroup.id, member.id, now);
assert.equal(state.lairs.get('fixed').refillAt, now + 5 * 60000, 'full clear sets an exact five minute timer');
events = ecology.tickEcology(state, config, occupied, now + 5 * 60000 - 1, () => 0.5);
assert(!events.some(event => event.groupId === fixedGroup.id || event.type === 'spawn' && event.sx === 1 && event.sy === 2));
events = ecology.tickEcology(state, config, occupied, now + 5 * 60000, () => 0.5);
assert(events.some(event => event.type === 'spawn' && state.groups.get(event.groupId)?.lairId === 'fixed'));
const hunting = [...state.groups.values()].find(group => group.lairId === 'hunting');
for (const member of [...hunting.members]) ecology.memberKilled(state, config, hunting.id, member.id, now);
assert.equal(state.lairs.get('hunting').lootClaimed, true, 'hunting ground never creates a searchable lair reward');
console.log('PASS fixed lair guards remain local, clear and return after five minutes; hunting grounds have monster loot only');

const migrated = ecology.emptyEcologyState('before-anchor-move');
migrated.lairs.set('lair_z_06_10_1', { id: 'lair_z_06_10_1', speciesId: 'raider_band',
  tx: 88, tz: 9, x: 17, z: -141, destroyedAt: 9000, refillAt: 309000,
  lootClaimed: false, loot: [{ id: 'scrap', qty: 3 }], claimRoomId: 'old-room' });
ecology.resetLairs(migrated, [{ id: 'lair_z_06_10_1', speciesId: 'new-roll',
  tx: 82, tz: 15, x: 5, z: -129, destroyedAt: 0, refillAt: 0, lootClaimed: true, loot: [] }],
'after-anchor-move', { retainSpecies: old => old.speciesId === 'raider_band' });
assert.deepEqual({ speciesId: migrated.lairs.get('lair_z_06_10_1').speciesId,
  tx: migrated.lairs.get('lair_z_06_10_1').tx,
  destroyedAt: migrated.lairs.get('lair_z_06_10_1').destroyedAt,
  refillAt: migrated.lairs.get('lair_z_06_10_1').refillAt,
  loot: migrated.lairs.get('lair_z_06_10_1').loot },
{ speciesId: 'raider_band', tx: 82, destroyedAt: 9000, refillAt: 309000, loot: [{ id: 'scrap', qty: 3 }] },
'moving a stable lair anchor preserves its species, 5-minute cooldown and unclaimed cache');

const roaming = ecology.normalizeEcologyConfig({ stationaryLairs: true,
  lairs: { capacity: { pvp: 0 } },
  species: [
    { id: 'marauders', kind: 'traveller', faction: 'raiders', hostile: true,
      members: [{ type: 'raider', min: 2, max: 2 }], habitat: { pvp: 1 },
      travel: { mode: 'poi', count: 1, restMinutes: [0, 0], respawnMinutes: 30 } },
    { id: 'wandering', kind: 'traveller', faction: 'gari', hostile: true,
      members: [{ type: 'gari', min: 3, max: 3 }], habitat: { pvp: 1 },
      travel: { mode: 'road', count: 1, restMinutes: [0, 0], respawnMinutes: 30 } }
  ]
});
const roamingState = ecology.emptyEcologyState('mobile');
const routeStops = [{ id: 'first', sx: 1, sy: 1 }, { id: 'second', sx: 2, sy: 1 }];
const roamingContext = { occupied: () => false, occupiedCells: [], modeAt: () => 'pvp',
  cities: () => [], pointsOfInterest: () => routeStops, roadStops: () => routeStops,
  route: (from, to) => [from, to], createMember: () => ({ maxHp: 40 }) };
ecology.tickEcology(roamingState, roaming, roamingContext, 1_000_000, () => 0);
assert.equal(roamingState.groups.size, 2);
assert([...roamingState.groups.values()].every(group => !group.lairId), 'mobile groups have no fixed lair');
ecology.tickEcology(roamingState, roaming, roamingContext, 1_000_001, () => 0.9);
assert([...roamingState.groups.values()].every(group => group.route?.length === 2),
  'marauders and wandering beasts plan routes between authored stops');
console.log('PASS marauders and wandering packs travel between POIs or road stops without acquiring lairs');

const outpost = catalog.outposts[0];
let outposts = alife.normalizeState({}, catalog);
let runtime = outposts.outposts.get(outpost.id);
assert.equal(alife.publicOutpost(outpost, runtime).displayName, outpost.displayName,
  'the live outpost map and capture UI receive the authored name');
let tick = 1_000_000;
const attacker = { id: 'one', faction: 'uprava', x: outpost.x, z: outpost.z };
const ally = { id: 'two', faction: 'uprava', x: outpost.x, z: outpost.z };
const defender = { id: 'three', faction: outpost.ownerFaction, x: outpost.x, z: outpost.z };
alife.tickOutpost(outposts, outpost, tick, { players: [attacker, ally] });
tick += 10000;
alife.tickOutpost(outposts, outpost, tick, { players: [attacker, ally] });
assert.equal(alife.publicOutpost(outpost, runtime).capturePercent, 0, 'boss gates capture');
assert.deepEqual([alife.publicCaptureTask(outpost, runtime).phase,
  alife.publicCaptureTask(outpost, runtime).progressPercent], ['defeatBoss', 0]);
alife.setBossAlive(outposts, outpost, false);
tick += 10000;
alife.tickOutpost(outposts, outpost, tick, { players: [attacker, defender] });
assert.equal(alife.publicOutpost(outpost, runtime).capturePercent, 0, 'equal presence pauses capture');
assert.equal(alife.publicCaptureTask(outpost, runtime).phase, 'hold');
assert.equal(alife.publicCaptureTask(outpost, runtime).requiredSeconds, 180);
let captured = null;
for (let i = 0; i < 18; i += 1) {
  tick += 10000;
  captured = alife.tickOutpost(outposts, outpost, tick, { players: [attacker, ally] }).find(event => event.type === 'captured') || captured;
}
assert(captured, 'three cumulative minutes under numerical advantage capture the outpost');
assert.equal(runtime.ownerFaction, 'uprava');
assert.equal(runtime.bossAlive, true, 'new owner receives a boss');
assert.equal(captured.contributions.one, captured.contributions.two, 'equal personal contribution yields equal share');
assert.equal(alife.normalizeState(alife.serializeState(outposts), catalog).outposts.get(outpost.id).ownerFaction, 'uprava');
outposts.pendingXp.one = 75;
assert.equal(alife.normalizeState(alife.serializeState(outposts), catalog).pendingXp.one, 75,
  'an absent contributor keeps an XP award across restart');
const ledger = {};
assert.equal(captureAwards.stageAwards(ledger, outpost.id, runtime.garrisonGeneration,
  { one: 2, two: 1 }, 300).length, 2);
assert.equal(captureAwards.pendingAwards(ledger, 'one')[0].xp, 200);
const restartedLedger = JSON.parse(JSON.stringify(ledger));
assert.equal(captureAwards.stageAwards(restartedLedger, outpost.id, runtime.garrisonGeneration,
  { one: 2, two: 1 }, 300).length, 0, 'replayed capture cannot duplicate a durable award');
restartedLedger[captureAwards.awardId(outpost.id, runtime.garrisonGeneration, 'one')].appliedAt = 123;
assert.equal(captureAwards.pendingAwards(restartedLedger, 'one').length, 0,
  'applied award is not returned after restart');
console.log('PASS boss gate, tie pause, three minute capture, contributions, new boss and persistence');

outposts = alife.normalizeState({}, catalog);
runtime = outposts.outposts.get(outpost.id);
const patrol = Array.from({ length: 4 }, () => ({ faction: 'uprava', x: outpost.x, z: outpost.z }));
let patrolTime = 2_000_000;
alife.tickOutpost(outposts, outpost, patrolTime, { patrols: patrol, offscreen: true });
for (let i = 0; i < 6; i += 1) {
  patrolTime += 10000;
  alife.tickOutpost(outposts, outpost, patrolTime, { patrols: patrol, offscreen: true });
}
assert.equal(runtime.bossAlive, false, 'an on-site NPC patrol defeats the mandatory boss offscreen');
let patrolCapture = null;
for (let i = 0; i < 18; i += 1) {
  patrolTime += 10000;
  patrolCapture = alife.tickOutpost(outposts, outpost, patrolTime, { patrols: patrol, offscreen: true })
    .find(event => event.type === 'captured') || patrolCapture;
}
assert(patrolCapture && runtime.ownerFaction === 'uprava', 'the NPC patrol then holds the outpost for three minutes');
assert.deepEqual(patrolCapture.contributions, {}, 'NPC patrol capture does not grant player XP');
console.log('PASS offscreen NPC patrol defeats the boss, holds for three minutes and captures without player XP');

const fallen = alife.normalizeState({}, catalog);
assert.equal(alife.markGuardDead(fallen, outpost, 1), true);
assert.equal(alife.markGuardDead(fallen, outpost, 1), false, 'one guard death is counted once');
assert.deepEqual(alife.normalizeState(alife.serializeState(fallen), catalog).outposts.get(outpost.id).garrisonDeadSlots, [1],
  'a killed guard stays absent after restart and corpse cleanup');
const fallenRuntime = fallen.outposts.get(outpost.id);
alife.tickOutpost(fallen, outpost, tick, { stormInside: true });
alife.tickOutpost(fallen, outpost, tick + 1000, { stormInside: false });
assert.deepEqual(fallenRuntime.garrisonDeadSlots, [], 'a new raider generation receives a fresh garrison');
console.log('PASS guard casualties persist until owner generation changes');

let actor = { hp: 60, maxHp: 100, alifeBaseMaxHp: 100 };
alife.scaleDefenderHealth(actor, 3);
assert.deepEqual([actor.hp, actor.maxHp], [150, 190], 'more attackers add effective HP while preserving 40 damage');
alife.scaleDefenderHealth(actor, 0);
assert.deepEqual([actor.hp, actor.maxHp], [60, 100], 'fewer attackers keep the same 40 damage');
actor = { hp: 100, maxHp: 100, alifeBaseMaxHp: 100 };
alife.scaleDefenderHealth(actor, 3);
assert.deepEqual([actor.hp, actor.maxHp], [190, 190], 'a fresh defender gains real HP when attackers grow');
actor.hp -= 35;
alife.scaleDefenderHealth(actor, 1);
assert.deepEqual([actor.hp, actor.maxHp], [95, 130], 'scaling down retains all 35 damage');
alife.scaleDefenderHealth(actor, 3);
assert.deepEqual([actor.hp, actor.maxHp], [155, 190], 'scaling back up never erases damage');
console.log('PASS outpost defender scaling raises effective HP and preserves damage');

outposts = alife.normalizeState({}, catalog);
runtime = outposts.outposts.get(outpost.id);
alife.tickOutpost(outposts, outpost, tick, { stormInside: true });
alife.tickOutpost(outposts, outpost, tick + 1000, { stormInside: false });
assert.equal(runtime.ownerFaction, 'raiders', 'an empty outpost belongs to raiders after the storm');
assert.equal(runtime.bossAlive, true);
outposts = alife.normalizeState({}, catalog);
runtime = outposts.outposts.get(outpost.id);
alife.tickOutpost(outposts, outpost, tick, { stormInside: true, players: [{ id: 'neutral', faction: '', x: outpost.x, z: outpost.z }] });
alife.tickOutpost(outposts, outpost, tick + 1000, { stormInside: false });
assert.equal(runtime.ownerFaction, outpost.ownerFaction, 'a neutral player sheltering prevents raider takeover');
console.log('PASS storm takeover and neutral shelter follow the persistent outpost state');

const coverActor = {
  ecologySiteId: 'alife_scrap_outpost', targetId: 'attacker',
  x: 12, z: 8, tacticalGoalX: 12.3, tacticalGoalZ: 8.2,
  tacticalGoalKind: 'cover', tacticalGoalUntil: 12000, tacticalHoldUntil: 12000
};
assert.deepEqual(siteActorVisualAction(coverActor, 10000, 'chase', false),
  { action: 'cover', startedAt: 10000 }, 'an actor holding its chosen cover shows the cover action');
assert.deepEqual(siteActorVisualAction(coverActor, 10100, 'chase', false),
  { action: 'cover', startedAt: 10000 }, 'cover start time stays stable across snapshots');
assert.deepEqual(siteActorVisualAction(coverActor, 10200, 'chase', true),
  { action: 'combat', startedAt: 10200 }, 'moving toward cover retains combat locomotion');
assert.deepEqual(siteActorVisualAction(coverActor, 10300, 'chase', false),
  { action: 'cover', startedAt: 10300 }, 'a new cover hold starts a new action interval');
assert.equal(siteActorVisualAction(coverActor, 10400, 'attack', false).action, 'combat',
  'attacking takes priority over the cover pose');
assert.equal(siteActorVisualAction(coverActor, 10500, 'stagger', false).action, 'combat',
  'hit reaction takes priority over the cover pose');
coverActor.tacticalGoalKind = 'flank';
assert.equal(siteActorVisualAction(coverActor, 10520, 'chase', false).action, 'combat',
  'a flank goal cannot masquerade as cover');
coverActor.tacticalGoalKind = 'cover';
coverActor.x = 15;
assert.equal(siteActorVisualAction(coverActor, 10540, 'chase', false).action, 'combat',
  'a stale cover goal does not play before the actor reaches it');
coverActor.x = 12;
coverActor.tacticalHoldUntil = 10550;
assert.equal(siteActorVisualAction(coverActor, 10560, 'chase', false).action, 'combat',
  'an expired cover hold does not keep its pose');
coverActor.dead = true;
assert.equal(siteActorVisualAction(coverActor, 10600, 'dead', false).action, 'death',
  'death takes priority over the cover pose');
const emergingActor = { ecologySiteId: 'lair_one', ecologyVisualAction: 'emerge',
  ecologyVisualActionStartedAt: 9000 };
assert.deepEqual(siteActorVisualAction(emergingActor, 10000, 'idle', false),
  { action: 'emerge', startedAt: 9000 }, 'emergence keeps its authoritative start time');
assert.equal(siteActorVisualAction(emergingActor, 10600, 'idle', false).action, 'guard',
  'a site actor guards again after emergence');
console.log('PASS site actors show cover only while holding a tactical goal; combat, death and emergence retain priority');
