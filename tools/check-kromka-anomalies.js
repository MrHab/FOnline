#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const anomalies = readJson('data/anomalies.json');
const locations = readJson('data/kromka/locations.json');

assert.strictEqual(anomalies.schema, 'kromka.anomalies.v1');
assert.deepStrictEqual(anomalies.bolt, {
  rangeMeters: 10,
  cooldownMs: 750,
  magneticRangeMeters: 13,
  magneticEdgeToleranceMeters: 1.5,
  magneticDischargeBonusMs: 2000
}, 'Bolt rules changed without an explicit anomaly schema update');

const expected = new Map([
  ['pull', ['Тяга', 4000]],
  ['seam', ['Шов', 3000]],
  ['carousel', ['Карусель', 5000]],
  ['glass', ['Стекло', 4000]],
  ['dew', ['Роса', 5000]],
  ['sink', ['Провал', 4000]],
  ['chime', ['Звон', 6000]],
  ['mute', ['Молчун', 5000]]
]);
assert.strictEqual(anomalies.types.length, expected.size, 'Exactly eight canonical anomaly types are required');
for (const type of anomalies.types) {
  assert(expected.has(type.id), `Unknown anomaly type: ${type.id}`);
  assert.strictEqual(type.displayName, expected.get(type.id)[0], `Wrong display name for ${type.id}`);
  assert.strictEqual(type.dischargeMs, expected.get(type.id)[1], `Wrong discharge for ${type.id}`);
  assert(type.damagePerSecond > 0 && type.damageType && type.statusEffect,
    `${type.id} needs concrete damage and status gameplay`);
  assert(type.visualProfile && type.audioProfile && type.readability.length >= 35,
    `${type.id} needs a persistent readable audiovisual signature`);
}

const seenFields = new Set();
const usedTypes = new Set();
let trainingFields = 0;
const permanentFields = [];
for (const location of locations.locations) {
  for (const field of location.anomalyFields || []) {
    assert(!seenFields.has(field.id), `Duplicate anomaly id: ${field.id}`);
    seenFields.add(field.id);
    assert(expected.has(field.type), `${location.id}: unknown anomaly type ${field.type}`);
    assert(Number.isFinite(field.x) && Number.isFinite(field.z), `${field.id}: position must be authored`);
    assert(field.radius >= 0.75 && field.radius <= 12, `${field.id}: unreasonable radius`);
    assert(field.placement === 'authored' || field.placement === 'authored-slot'
      || field.placement === 'unity-authored',
      `${field.id}: runtime random placement is forbidden`);
    usedTypes.add(field.type);
    if (field.training === true) trainingFields++;
    if (field.permanentDischarge === true) permanentFields.push(field.id);
  }
}
assert.deepStrictEqual([...usedTypes].sort(), [...expected.keys()].sort(),
  'Every anomaly type must be represented by an authored field');
assert(trainingFields >= 1, 'The caravan-yard tutorial needs a harmlessly staged bolt lesson');
assert.deepStrictEqual(permanentFields, ['twelve-seam-01'],
  'Only the prologue Seam may stay discharged permanently');

console.log(`Kromka anomaly data OK: ${expected.size} visible types, ${seenFields.size} authored fields, one reusable bolt`);
