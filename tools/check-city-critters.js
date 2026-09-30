#!/usr/bin/env node
'use strict';

// Городская живность как модуль: места зверьков в городе, сроки возрождения,
// бегство от удара и число шкур в туше. Настоящий город и бой — в
// check-city-critters-network.js.

const assert = require('node:assert/strict');
const path = require('node:path');
const critters = require('../src/server/city-critters');

const config = critters.normalizeCityCritters(require(path.join('..', 'data', 'kromka', 'city-critters.json')));
assert.equal(config.species, 'rat', 'the city critter is the rat of the catalogue');
assert(config.perCity >= 1 && config.respawnMs >= 5000, 'every city holds critters that come back: ' + JSON.stringify(config));
assert(config.hideQty[0] >= 1 && config.hideQty[1] >= config.hideQty[0], 'a critter carcass holds at least one hide');
assert.throws(() => critters.normalizeCityCritters({ schema: 'other' }), /schema/);
assert.throws(() => critters.normalizeCityCritters({}), /species/);
console.log('PASS the city critter config is authored and bounded');

// Места: не больше perCity, не ближе spacingTiles, тот же город — те же места.
const grid = [];
for (let tz = 0; tz < 40; tz++) for (let tx = 0; tx < 40; tx++) grid.push({ tx, tz });
const slots = critters.planSlots(config, 'relayStation', grid);
assert.equal(slots.length, config.perCity, 'a roomy city gets a critter for every slot');
for (const [index, slot] of slots.entries()) {
  for (const other of slots.slice(index + 1)) {
    assert(Math.hypot(slot.tx - other.tx, slot.tz - other.tz) >= config.spacingTiles, 'critter slots keep their spacing');
  }
}
assert.deepEqual(critters.planSlots(config, 'relayStation', [...grid].reverse()), slots,
  'the slots of a city do not depend on the order of its tiles');
assert.notDeepEqual(critters.planSlots(config, 'sluiceCity', grid), slots, 'another city gets other slots');
assert.equal(critters.planSlots(config, 'relayStation', [{ tx: 3, tz: 3 }, { tx: 4, tz: 3 }]).length, 1,
  'a cramped yard holds fewer critters, never two on top of each other');
assert.deepEqual(critters.planSlots(config, 'relayStation', []), [], 'a city without a yard has no critters');
console.log(`PASS a city gets up to ${config.perCity} deterministic, spaced critter slots`);

// Возрождение: пустое место заселяется сразу, живой зверёк держит место,
// погибший возвращается через respawnMs после смерти, пропавший — после пропажи.
const slot = { id: 'critter_1', tx: 1, tz: 1, enemyId: '', respawnAt: 0 };
const lookup = rows => id => rows[id] || null;
assert.deepEqual(critters.dueSlots(config, [slot], lookup({}), 1000), [slot], 'an empty slot is filled at once');
slot.enemyId = 'rat_a';
assert.deepEqual(critters.dueSlots(config, [slot], lookup({ rat_a: { alive: true } }), 2000), [], 'a live critter keeps its slot');
const diedAt = 5000;
assert.deepEqual(critters.dueSlots(config, [slot], lookup({ rat_a: { alive: false, diedAt } }), diedAt + 10), [],
  'a slain critter does not come back at once');
assert.equal(slot.respawnAt, diedAt + config.respawnMs, 'the countdown starts at the death');
assert.deepEqual(critters.dueSlots(config, [slot], lookup({}), diedAt + config.respawnMs - 1), [],
  'the removed corpse keeps the countdown of the death');
assert.deepEqual(critters.dueSlots(config, [slot], lookup({}), diedAt + config.respawnMs), [slot],
  'the slot is due once the respawn time has passed');
const lost = { id: 'critter_2', tx: 9, tz: 9, enemyId: 'rat_b', respawnAt: 0 };
assert.deepEqual(critters.dueSlots(config, [lost], lookup({}), 7000), [], 'a critter lost with a rebuilt room is not back at once');
assert.equal(lost.respawnAt, 7000 + config.respawnMs, 'a lost critter comes back a respawn time after it was missed');
console.log(`PASS a slain city critter comes back ${config.respawnMs / 1000} s after its death`);

// Бегство: прочь от угрозы, отклонение не больше 35°, вплотную — в сторону по броску.
const from = { x: 10, z: 0 };
const threat = { x: 0, z: 0 };
for (const turn of [0, 0.25, 0.5, 0.75, 0.999]) {
  const point = critters.fleePoint(from, threat, config.fleeDistance, turn);
  const away = Math.atan2(point.z - from.z, point.x - from.x);
  assert(Math.abs(Math.hypot(point.x - from.x, point.z - from.z) - config.fleeDistance) < 1e-9, 'the critter runs its flee distance');
  assert(Math.abs(away) <= 0.62, `the critter runs away from the threat (turn ${turn}: ${away})`);
}
const cornered = critters.fleePoint(threat, threat, 5, 0.25);
assert(Math.abs(Math.hypot(cornered.x, cornered.z) - 5) < 1e-9, 'a critter hit point-blank still runs off');
console.log('PASS a startled critter runs away from its attacker');

const charges = new Set([0, 0.2, 0.5, 0.8, 0.9999].map(roll => critters.hideCharges(config, roll)));
for (const value of charges) assert(value >= config.hideQty[0] && value <= config.hideQty[1], `hide count ${value} is in range`);
assert(charges.has(config.hideQty[0]) && charges.has(config.hideQty[1]), 'both ends of the hide range occur');
console.log(`PASS a critter carcass holds ${config.hideQty.join('–')} hides`);

console.log('City critters OK: authored config, deterministic spaced slots, respawn after death, flight from the attacker, hide count.');
