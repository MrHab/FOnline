#!/usr/bin/env node
'use strict';

// Рождение артефактов аномалиями под управляемым временем: кривая шанса после
// выброса, одна проверка в минуту на свободное поле, один артефакт на поле,
// вид по типу аномалии, освобождение поля подбором, обновление новым выбросом,
// сохранение и слияние с состоянием комнаты.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const catalog = JSON.parse(read('data/artifacts.json'));
const anomalies = JSON.parse(read('data/anomalies.json'));
const births = require('../src/server/anomaly-artifact-births');
const { createShiftCycle } = require('../src/server/shift-cycle');
const { mergeBirthArtifacts, pickupArtifact } = require('../src/server/artifact-spawns');
const { baseTierOfType } = require('../src/server/artifact-instances');

const close = (a, b, message) => assert(Math.abs(Number(a) - Number(b)) < 1e-9, message || `${a} != ${b}`);
const rules = births.birthRules(catalog);
assert.deepEqual(rules, { checkIntervalMs: 60000, baseChance: 0.002, peakChance: 0.02, decayMs: 1800000, maxPerField: 1, refreshOnEmission: true });

// --- кривая шанса -------------------------------------------------------------
close(births.birthChance(5000, 0, rules), 0.002, 'Before any emission the chance is the base.');
close(births.birthChance(10000, 10000, rules), 0.02, 'Right after the active phase the chance peaks.');
close(births.birthChance(10000 + 900000, 10000, rules), 0.011, 'Halfway through the decay the chance is halfway.');
close(births.birthChance(10000 + 1800000, 10000, rules), 0.002, 'After thirty real minutes the chance is back to base.');
close(births.birthChance(9000, 10000, rules), 0.002, 'A future emission does not raise the chance early.');

// --- конец активной фазы по циклу сдвига ---------------------------------------
const cycle = createShiftCycle(catalog.shift);
const activeStart = catalog.shift.cycleMs - catalog.shift.activeMs - catalog.shift.afterglowMs;
const activeEnd = activeStart + catalog.shift.activeMs;
assert.equal(cycle.state(activeEnd).phase, 'afterglow');
assert.equal(births.lastEmissionEndAt(cycle, activeEnd), activeEnd);
assert.equal(births.lastEmissionEndAt(cycle, activeEnd + 5000), activeEnd);
assert.equal(births.lastEmissionEndAt(cycle, catalog.shift.cycleMs + 1000), activeEnd, 'The calm phase remembers the previous emission.');
assert(births.lastEmissionEndAt(cycle, activeStart - 1) < 0, 'No emission has ended before the first active phase.');
assert.equal(births.currentEmissionId(cycle, activeStart + 1), 'shift_0');
assert.equal(births.currentEmissionId(cycle, activeStart - 1), '');

// --- поля всех восьми типов ----------------------------------------------------
const fields = anomalies.types.map((type, index) => ({
  id: `f-${type.id}`, type: type.id, x: index * 10, z: 3, radius: 3, tierRange: index < 4 ? [1, 3] : [3, 5]
}));
fields.push({ id: 'f-unknown', type: 'volcano', x: 99, z: 99, radius: 3 });
assert.equal(births.usableFields(fields, catalog).length, anomalies.types.length, 'Unknown anomaly types never birth artifacts.');

// Потолок тира поля ниже базового тира всех видов аномалии: рождения нет.
const lowSeam = births.normalizeBirthStore({});
const lowResult = births.tickLocationBirths(lowSeam, 'low', [{ id: 'low-seam', type: 'seam', x: 0, z: 0, radius: 3, tierRange: [1, 2] }], catalog, 5000, { random: () => 0 });
assert.equal(lowResult.checked, 1);
assert.equal(lowResult.births.length, 0, 'A Seam on the outskirts cannot birth a tier-three Bloodkin.');

const store = births.normalizeBirthStore({});
let randomCalls = 0;
const always = () => { randomCalls += 1; return 0; };
const never = () => { randomCalls += 1; return 0.999; };
const t0 = 1000000;
const first = births.tickLocationBirths(store, 'zone', fields, catalog, t0, { emissionEndAt: t0 - 1000, emissionId: 'shift_7', random: always });
assert.equal(first.checked, 8, 'Every usable free field is checked once.');
assert.equal(first.births.length, 8, 'A winning roll births exactly one artifact per field.');
for (const row of first.births) {
  const field = fields.find(entry => entry.id === row.fieldId);
  assert(catalog.anomalySources[field.type].includes(row.typeId), `${row.fieldId}: kind ${row.typeId} is not born by ${field.type}.`);
  const type = catalog.types.find(entry => entry.id === row.typeId);
  assert(row.tier >= Math.max(field.tierRange[0], baseTierOfType(type)) && row.tier <= field.tierRange[1], `${row.fieldId}: tier ${row.tier} outside the field range.`);
  assert(row.id.startsWith('birth:zone:') && row.seed === row.id && row.bornAt === t0 && row.emissionId === 'shift_7');
  assert(Math.hypot(row.x - field.x, row.z - field.z) <= 2.3, 'The artifact lies inside the anomaly field.');
}
randomCalls = 0;
const again = births.tickLocationBirths(store, 'zone', fields, catalog, t0 + 1000, { emissionEndAt: t0 - 1000, emissionId: 'shift_7', random: always });
assert.equal(again.checked, 0, 'Occupied fields are not checked at all.');
assert.equal(randomCalls, 0, 'No random roll is spent on an occupied field.');
assert.equal(births.liveBirths(store, 'zone').length, 8, 'One artifact per anomaly field.');

// --- подбор освобождает поле, интервал в минуту ---------------------------------
const claimed = births.claimBirth(store, 'zone', first.births[0].id);
assert(claimed && claimed.fieldId === first.births[0].fieldId);
assert.equal(births.claimBirth(store, 'zone', first.births[0].id), null, 'A claimed artifact cannot be claimed twice.');
assert.equal(births.liveBirths(store, 'zone').length, 7);
const early = births.tickLocationBirths(store, 'zone', fields, catalog, t0 + 30000, { emissionEndAt: t0 - 1000, emissionId: 'shift_7', random: always });
assert.equal(early.checked, 0, 'A freed field waits for the next minute check.');
const later = births.tickLocationBirths(store, 'zone', fields, catalog, t0 + 60000, { emissionEndAt: t0 - 1000, emissionId: 'shift_7', random: never });
assert.equal(later.checked, 1, 'Only the freed field is checked after a minute.');
assert.equal(later.births.length, 0, 'A losing roll births nothing.');
const rebirth = births.tickLocationBirths(store, 'zone', fields, catalog, t0 + 120000, { emissionEndAt: t0 - 1000, emissionId: 'shift_7', random: always });
assert.equal(rebirth.births.length, 1, 'The freed field births again on a winning roll.');
assert.notEqual(rebirth.births[0].id, first.births[0].id, 'A new birth never reuses a claimed id.');

// --- обновление новым выбросом ----------------------------------------------------
const before = births.liveBirths(store, 'zone').map(row => row.id);
const refresh = births.tickLocationBirths(store, 'zone', fields, catalog, t0 + 180000, { emissionEndAt: t0 + 170000, emissionId: 'shift_8', random: never });
assert.equal(refresh.refreshed.length, 8, 'Every unclaimed artifact is re-rolled by the next emission.');
const after = births.liveBirths(store, 'zone').map(row => row.id);
assert(after.every(id => !before.includes(id)), 'Refreshed artifacts get new ids.');
assert.equal(births.liveBirths(store, 'zone').length, 8, 'Refresh never adds a second artifact to a field.');
const noRefresh = births.tickLocationBirths(store, 'zone', fields, catalog, t0 + 240000, { emissionEndAt: t0 + 170000, emissionId: 'shift_8', random: never });
assert.equal(noRefresh.refreshed.length, 0, 'The same emission refreshes only once.');

// --- сохранение ---------------------------------------------------------------------
const restored = births.normalizeBirthStore(JSON.parse(JSON.stringify(store)));
assert.deepEqual(restored, store, 'The birth store survives a JSON round trip unchanged.');
assert.deepEqual(births.normalizeBirthStore({ locations: { '!!!': { artifacts: { x: { id: '' } } }, broken: null } }), { version: 1, locations: {} });
assert.deepEqual(births.normalizeBirthStore({ locations: { zone: { artifacts: { f: { id: 'x', fieldId: 'f', typeId: 'spring' } } } } }).locations.zone.artifacts, {},
  'A birth row without an item id is dropped instead of crashing.');
assert.equal(births.publicBirthSummary(store, 'zone').liveCount, 8);

// --- слияние с комнатой и подбор ----------------------------------------------------
const room = { id: 'room', locationId: 'zone', kromkaArtifactState: { shiftId: 'shift_8', artifacts: [
  { id: 'artifact:shift_8:zone:0', typeId: 'spring', itemId: 'artifactSpring', tier: 1, seed: 'w', x: 50, z: 50, hot: true, stabilized: false, pickedUp: false }
] } };
assert(mergeBirthArtifacts(room, births.liveBirths(store, 'zone')), 'Merging live births changes the room.');
assert.equal(room.kromkaArtifactState.artifacts.length, 9, 'Wave artifacts and births coexist.');
assert(!mergeBirthArtifacts(room, births.liveBirths(store, 'zone')), 'Merging again is idempotent.');
const target = room.kromkaArtifactState.artifacts.find(row => row.birth === true);
const player = { characterId: 'c', x: target.x, z: target.z, inventory: [], equipment: { detector: 'artifactDetectorMk1' }, artifactRecords: [], artifactSlots: [] };
const pickup = pickupArtifact(room, player, target.id, catalog, t0 + 300000);
assert(pickup.ok && pickup.birth && pickup.record.sourceAnomalyType === target.sourceAnomalyType && pickup.record.tier === target.tier);
births.claimBirth(store, 'zone', target.id);
assert(mergeBirthArtifacts(room, births.liveBirths(store, 'zone')), 'A claimed birth disappears from the room.');
assert(!room.kromkaArtifactState.artifacts.some(row => row.id === target.id));
assert.equal(room.kromkaArtifactState.artifacts.length, 8);

// --- серверная привязка --------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  'savesDb.anomalyBirths = normalizeArtifactBirthStore(savesDb.anomalyBirths)',
  'serverTickAnomalyBirths(Date.now())',
  'mergeBirthArtifacts(room, liveArtifactBirths(serverArtifactBirthStore(), room.locationId))',
  'claimArtifactBirth(serverArtifactBirthStore(), room.locationId, result.record.id)',
  'artifactEmissionEndAt(KROMKA_SHIFT_CYCLE, now)',
  'function serverLocationAnomalyFields('
]) assert(server.includes(needle), `server.js is missing the birth contract: ${needle}`);

console.log('Anomaly artifact births OK: post-emission chance decay, one check per minute per free field, one artifact per anomaly, kinds by anomaly type, claim/refresh/persist and room merge.');
