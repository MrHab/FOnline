'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPersonalBase, sanitizePersonalBase, publicPersonalBase } = require('../src/server/personal-bases');
const { placeObject, removeObject, validatePlacement } = require('../src/server/base-construction');
const { adjustedJobInput, claimBaseJob, startBaseJob } = require('../src/server/base-jobs');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/base-building.json'), 'utf8'));
const location = JSON.parse(fs.readFileSync(path.join(root, 'data/locations/personalBase.json'), 'utf8'));
assert(location.privateInstance && location.safe && location.id === 'personalBase');
assert.equal(catalog.tiers.length, 4);
assert.deepEqual(catalog.tiers.map(row => [row.size, row.residentLimit, row.stationLimit, row.objectLimit]), [[20, 2, 2, 40], [28, 4, 4, 80], [36, 6, 7, 120], [44, 8, 10, 160]]);
assert.equal(catalog.rightsQuest.outcomes.length, 3);

const a = createPersonalBase('account-a', 100);
const b = createPersonalBase('account-b', 100);
assert.notEqual(a.accountId, b.accountId, 'Bases must be keyed by account, not shared.');
a.rights.granted = true;
const stock = { scrap: 999, wood: 999, electronics: 999, oil: 999 };
const qty = id => stock[id] || 0;
const placed = placeObject(a, { typeId: 'generator_small', x: 2.4, z: 1.6, rotation: 88 }, catalog, qty, 200);
assert(placed.ok);
assert.deepEqual([placed.object.x, placed.object.z, placed.object.rotation], [2, 2, 90], 'Placement must snap to server grid and rotation.');
assert(!validatePlacement(a, { typeId: 'storage_crate', x: 2, z: 2, rotation: 0 }, catalog).ok, 'Colliding build must be rejected.');
assert(!validatePlacement(a, { typeId: 'wall_scrap', x: 30, z: 30 }, catalog).ok, 'Out-of-bounds build must be rejected.');
assert(removeObject(a, placed.object.id, catalog, 300).ok, 'Built objects must be removable with a partial refund.');

const bench = placeObject(a, { typeId: 'repair_bench', x: -3, z: 0 }, catalog, qty, 400);
assert(bench.ok);
const job = startBaseJob(a, 'parts', catalog, qty, 500);
assert(job.ok && !claimBaseJob(a, job.record.id, catalog, 501).ok, 'Offline job cannot be claimed early.');
assert(claimBaseJob(a, job.record.id, catalog, job.record.completesAt).ok, 'Offline job is calculated by completion timestamp.');
const roundTrip = sanitizePersonalBase(JSON.parse(JSON.stringify(a)), 'account-a', catalog, 999);
assert.equal(publicPersonalBase(roundTrip, catalog).objects.length, 1, 'Compact state must survive serialization.');

const globalMap = JSON.parse(fs.readFileSync(path.join(root, 'data/global-map.json'), 'utf8'));
assert(!(globalMap.nodes || []).some(row => row.locationId === 'personalBase' || row.id === 'personalBase'), 'Private bases must never occupy a global-map node.');
// Жители меняют очередь и вход работ: Торговец добавляет места, Агроном
// бережёт воду грядки, но вход никогда не обнуляется.
{
  const queue = createPersonalBase('queue-test', 1);
  queue.rights.granted = true;
  const station = (catalog.jobs || [])[0];
  queue.objects.push({ id: 'station', typeId: station.stationTypeId });
  const plenty = () => 999;
  for (let i = 0; i < 6; i++) assert(startBaseJob(queue, station.id, catalog, plenty, 1000 + i, { queueLimit: 6 }).ok, `order ${i + 1} fits a queue of six`);
  const full = startBaseJob(queue, station.id, catalog, plenty, 2000, { queueLimit: 6 });
  assert(!full.ok && full.error.includes('6'), 'The seventh order is refused and the limit is named.');
  const defaultQueue = createPersonalBase('queue-default', 1);
  defaultQueue.objects.push({ id: 'station', typeId: station.stationTypeId });
  for (let i = 0; i < 4; i++) assert(startBaseJob(defaultQueue, station.id, catalog, plenty, 1000 + i).ok);
  assert(!startBaseJob(defaultQueue, station.id, catalog, plenty, 2000).ok, 'Without residents the queue stays at four.');
  assert.deepEqual(adjustedJobInput({ input: { water: 3, seeds: 1 } }, { water: 0.15 }), { water: 2, seeds: 1 },
    'A water saving takes at least one unit and never touches other inputs.');
  assert.deepEqual(adjustedJobInput({ input: { water: 1 } }, { water: 0.9 }), { water: 1 }, 'A saving never zeroes an input.');
}

console.log('Kromka personal base check passed: account isolation, construction, persistence, offline jobs, resident queue and input savings.');
