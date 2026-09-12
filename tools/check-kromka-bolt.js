#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createAnomalySystem, pointSegmentDistance } = require('../src/server/anomalies');

const catalog = {
  bolt: {
    rangeMeters: 10, cooldownMs: 750, magneticRangeMeters: 13,
    magneticEdgeToleranceMeters: 1.5, magneticDischargeBonusMs: 2000
  },
  types: [
    { id: 'chime', displayName: 'Звон', damageType: 'electric', damagePerSecond: 12,
      dischargeMs: 6000, statusEffect: 'электризация', visualProfile: 'blue-arcs', audioProfile: 'ring' }
  ]
};
const locations = { locations: [
  { id: 'yard', anomalyFields: [{ id: 'yard-chime', type: 'chime', x: 5, z: 0, radius: 1, placement: 'authored' }] },
  { id: 'edge', anomalyFields: [{ id: 'edge-chime', type: 'chime', x: 5, z: 1.4, radius: 1, placement: 'authored' }] },
  { id: 'story', anomalyFields: [{ id: 'story-chime', type: 'chime', x: 5, z: 0, radius: 1,
    placement: 'authored', permanentDischarge: true }] }
] };
const system = createAnomalySystem({ catalog, locations });

assert.strictEqual(pointSegmentDistance(5, 2, 0, 0, 10, 0).distance, 2,
  'Server segment distance is not deterministic');
const hit = system.throwBolt({ roomId: 'r1', locationId: 'yard', playerId: 'p1',
  from: { x: 0, z: 0 }, target: { x: 10, z: 0 }, now: 1000, hasLineOfThrow: () => true });
assert(hit.ok && hit.hit && hit.anomaly.id === 'yard-chime', 'One ordinary bolt must discharge the first crossed field');
assert.strictEqual(hit.anomaly.dischargedUntil, 7000, 'Ordinary discharge must use the authored type duration');
assert.strictEqual(system.snapshot('r1', 'yard', 2000).fields[0].active, false,
  'Discharge state must be shared for the room');
assert.strictEqual(system.evaluatePlayer({ roomId: 'r1', locationId: 'yard', playerId: 'p2', x: 5, z: 0, now: 2500 }), null,
  'A discharged anomaly must not damage another player');

const cooldown = system.throwBolt({ roomId: 'r1', locationId: 'yard', playerId: 'p1',
  from: { x: 0, z: 0 }, target: { x: 2, z: 0 }, now: 1200 });
assert(!cooldown.ok && cooldown.retryAfterMs === 550, '750 ms throw cooldown is not enforced');
const blocked = system.throwBolt({ roomId: 'r1', locationId: 'yard', playerId: 'p3',
  from: { x: 0, z: 0 }, target: { x: 8, z: 0 }, now: 2000, hasLineOfThrow: () => false });
assert(!blocked.ok && /препятствие/.test(blocked.error), 'Server line-of-throw must block a bolt');
const tooFar = system.throwBolt({ roomId: 'r1', locationId: 'yard', playerId: 'p4',
  from: { x: 0, z: 0 }, target: { x: 10.2, z: 0 }, now: 3000 });
assert(!tooFar.ok && tooFar.maxRange === 10, 'Ordinary bolt may not exceed ten metres');
const regularMiss = system.throwBolt({ roomId: 'r2', locationId: 'edge', playerId: 'p5',
  from: { x: 0, z: 0 }, target: { x: 10, z: 0 }, now: 4000 });
assert(regularMiss.ok && !regularMiss.hit, 'Ordinary bolt may not use magnetic edge tolerance');
const magneticHit = system.throwBolt({ roomId: 'r3', locationId: 'edge', playerId: 'p6',
  from: { x: 0, z: 0 }, target: { x: 12, z: 0 }, magnetic: true, now: 5000 });
assert(magneticHit.ok && magneticHit.hit && magneticHit.anomaly.dischargedUntil === 13000,
  'Quest magnetic bolt must add range, tolerance and two seconds of discharge');
const activeAgain = system.evaluatePlayer({ roomId: 'r1', locationId: 'yard', playerId: 'p7',
  x: 5, z: 0, now: 7001 });
assert(activeAgain && activeAgain.damage === 6 && activeAgain.damageType === 'electric',
  'Reactivated field must apply authoritative 500 ms exposure damage');
assert.strictEqual(activeAgain.statusEffect, 'электризация', 'Localized status labels must not be stripped to empty IDs');
system.evaluatePlayer({ roomId: 'r1', locationId: 'yard', playerId: 'p7', x: 20, z: 0, now: 7010 });
assert.strictEqual(system.evaluatePlayer({ roomId: 'r1', locationId: 'yard', playerId: 'p7', x: 5, z: 0, now: 7020 }), null,
  'Boundary re-entry must not multiply damage');
assert.strictEqual(hit.anomaly.contact.x, 4, 'Bolt reacts at the first edge, not the centre or requested endpoint');
system.evaluatePlayer({ roomId: 'r1', locationId: 'yard', playerId: 'p7', x: 20, z: 0, now: 8000 });
assert.equal(system.evaluatePlayer({ roomId: 'r1', locationId: 'yard', playerId: 'p7', x: 5, z: 0, now: 9000 }).damage, 6,
  'Time spent outside a hazard must not accumulate damage on re-entry');
const wallBehind = system.throwBolt({ roomId: 'wall-behind', locationId: 'yard', playerId: 'wall-p',
  from: { x: 0, z: 0 }, target: { x: 10, z: 0 }, now: 1000, hasLineOfThrow: (_ax, _az, bx) => bx < 6 });
assert(wallBehind.ok && wallBehind.hit, 'A wall behind the contact point must not block discharge');
const authored = createAnomalySystem({ catalog: require('../data/anomalies.json'), locations: require('../data/kromka/locations.json') });
const dew = authored.authoredFields('cascadeRegenerator').find(field => field.type === 'dew');
assert.equal(dew.damageType, 'toxic', 'Dew must use the combat toxic-resistance channel');
const layered = createAnomalySystem({ catalog, locations: { locations: [{ id: 'layered', anomalyFields: [
  { id: 'small', type: 'chime', x: 4, z: 0, radius: 0.75 },
  { id: 'large', type: 'chime', x: 6, z: 0, radius: 3 }
] }] } });
const layeredThrow = now => layered.throwBolt({ roomId: 'layered', locationId: 'layered', playerId: 'p',
  from: { x: 0, z: 0 }, target: { x: 10, z: 0 }, now });
assert.equal(layeredThrow(1000).anomaly.id, 'large', 'Earliest circle entry wins, not nearest centre');
assert.equal(layeredThrow(2000).anomaly.id, 'small', 'Discharged fields do not swallow later bolts');

const permanentHit = system.throwBolt({ roomId: 'story-room', locationId: 'story', playerId: 'story-player',
  from: { x: 0, z: 0 }, target: { x: 10, z: 0 }, now: 8000 });
assert(permanentHit.ok && permanentHit.hit && permanentHit.anomaly.permanentlyDischarged === true,
  'A story-only permanent anomaly must record its one-time discharge');
const permanentSnapshot = system.snapshot('story-room', 'story', 8000 + 24 * 60 * 60 * 1000).fields[0];
assert.strictEqual(permanentSnapshot.active, false, 'A permanently discharged story anomaly reactivated');
assert.strictEqual(permanentSnapshot.permanentlyDischarged, true,
  'Permanent discharge state was not exposed to clients');
assert.strictEqual(system.evaluatePlayer({ roomId: 'story-room', locationId: 'story', playerId: 'late-player',
  x: 5, z: 0, now: 8000 + 24 * 60 * 60 * 1000 }), null,
  'A permanently discharged story anomaly resumed dealing damage');

console.log('Kromka bolt authority OK: range, obstruction, shared timers and permanent story discharge');
