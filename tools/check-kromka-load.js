'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { sanitizePersonalBase, publicPersonalBase } = require('../src/server/personal-bases');
const { sanitizeResidentState, calculateResidentBonuses } = require('../src/server/base-residents');
const { reconcileArtifactSpawns } = require('../src/server/artifact-spawns');
const { addChallenge, registerMember, lockRosters } = require('../src/server/siege-qualification');
const { createSiegeEvent, tickSiege } = require('../src/server/siege-resolution');

const root = path.resolve(__dirname, '..');
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const baseCatalog = read('data', 'kromka', 'base-building.json');
const residentCatalog = read('data', 'base-residents.json');
const artifactCatalog = read('data', 'artifacts.json');
const siegeConfig = read('data', 'kromka', 'sieges.json');
const started = performance.now();

let publicObjects = 0;
for (let index = 0; index < 2000; index += 1) {
  const base = sanitizePersonalBase({
    tier: 4,
    objects: Array.from({ length: 80 }, (_, i) => ({ id: `o${i}`, typeId: i % 2 ? 'wall_scrap' : 'bed_fold', x: i % 20, z: Math.floor(i / 20) })),
    residentStates: { zoya_splint: { recruited: true, assigned: true, loyalty: 80 } },
    inventory: { scrap: 500, water: 80 }
  }, `account-${index}`, baseCatalog, 1_800_000_000_000);
  sanitizeResidentState(base, residentCatalog);
  calculateResidentBonuses(base, residentCatalog);
  publicObjects += publicPersonalBase(base, baseCatalog).objects.length;
}
assert.equal(publicObjects, 160000);

let spawned = 0;
for (let index = 0; index < 500; index += 1) {
  const room = { locationId: `load-${index}` };
  // Поле объявляет тип аномалии: вид артефакта берётся из него, иначе волна
  // ничего не породит — единственный природный источник вида.
  const fieldTypes = ['pull', 'seam', 'carousel', 'glass', 'dew'];
  const fields = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, type: fieldTypes[i % fieldTypes.length], x: i * 3, z: index % 7, radius: 2 }));
  spawned += reconcileArtifactSpawns(room, { id: room.locationId, macroRegion: 'glasslands' }, { phase: 'active', shiftId: 'load-shift', strength: 3 }, artifactCatalog, fields, 1000).artifacts.length;
}
assert.equal(spawned, 1500);

const now = 1_800_000_000_000;
for (let eventIndex = 0; eventIndex < 24; eventIndex += 1) {
  const startAt = now + 2 * 86400000;
  const event = createSiegeEvent({ id: `load-${eventIndex}`, baseId: `b${eventIndex}`, defenderClanId: 'def', startAt }, siegeConfig, now);
  assert(addChallenge(event, 'atk', now, siegeConfig.pledge).ok);
  const defender = { id: 'def', members: {} };
  const attacker = { id: 'atk', members: {} };
  for (let i = 0; i < 20; i += 1) {
    defender.members[`d${i}`] = { joinedAt: now - siegeConfig.membershipMinAgeMs - 1 };
    attacker.members[`a${i}`] = { joinedAt: now - siegeConfig.membershipMinAgeMs - 1 };
    assert(registerMember(event, defender, `d${i}`, now, siegeConfig).ok);
    assert(registerMember(event, attacker, `a${i}`, now, siegeConfig).ok);
  }
  assert(lockRosters(event, event.rosterLocksAt));
  tickSiege(event, startAt, siegeConfig);
  assert.equal(event.status, 'active');
}

const elapsedMs = performance.now() - started;
assert(elapsedMs < 5000, `synthetic MMO-state pass is unexpectedly slow: ${elapsedMs.toFixed(0)}ms`);
console.log(`Kromka load check passed: 2,000 bases, 500 artifact rooms and 24 concurrent 20x20 siege rosters in ${elapsedMs.toFixed(0)}ms.`);
