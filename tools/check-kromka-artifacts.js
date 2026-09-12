'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { calculateArtifactEffects, sanitizeArtifactLoadout } = require('../src/server/artifact-effects');
const { pickupArtifact, publicArtifactsForPlayer, reconcileArtifactSpawns } = require('../src/server/artifact-spawns');
const { createShiftCycle } = require('../src/server/shift-cycle');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'artifacts.json'), 'utf8'));
assert.equal(catalog.types.length, 13, 'The released artifact catalog must contain exactly 13 authored types.');
assert.equal(new Set(catalog.types.map(row => row.id)).size, 13, 'Artifact ids must be unique.');
assert.deepEqual(catalog.detectors.map(row => [row.signalRange, row.revealRange]), [[12, 3], [18, 5], [24, 7]]);
assert.deepEqual(catalog.belts.map(row => row.slots), [2, 3, 4]);

const cycle = createShiftCycle(catalog.shift);
const activeAt = catalog.shift.cycleMs - catalog.shift.activeMs - catalog.shift.afterglowMs + 1;
assert.equal(cycle.state(activeAt).phase, 'active');
assert.equal(cycle.state(activeAt + catalog.shift.activeMs).phase, 'afterglow');

const room = { locationId: 'artifactTest' };
const location = { id: 'artifactTest', macroRegion: 'glasslands' };
const shift = { phase: 'active', shiftId: 'shift-test', strength: 2 };
const fields = [{ id: 'a', x: 1, z: 2, radius: 2 }, { id: 'b', x: 9, z: 2, radius: 2 }];
const first = reconcileArtifactSpawns(room, location, shift, catalog, fields, 1000);
assert.equal(first.artifacts.length, 2);
assert.equal(reconcileArtifactSpawns(room, location, shift, catalog, fields, 2000), first, 'Same Shift must not duplicate spawns.');

const player = {
  characterId: 'artifact-tester', x: first.artifacts[0].x, z: first.artifacts[0].z,
  inventory: [{ id: 'artifactContainer', qty: 1 }],
  equipment: { detector: 'artifactDetectorMk1', artifactBelt: 'artifactBelt2' },
  artifactRecords: [], artifactSlots: []
};
assert(publicArtifactsForPlayer(room, player, catalog).some(row => row.revealed), 'Mk1 must reveal an artifact inside three metres.');
const pickup = pickupArtifact(room, player, first.artifacts[0].id, catalog, 3000);
assert(pickup.ok && pickup.record.hot && !pickup.record.stabilized, 'Pickup must occupy a hot container.');
assert(!pickupArtifact(room, player, first.artifacts[0].id, catalog, 3001).ok, 'A claimed spawn cannot be picked twice.');
player.inventory.push({ id: pickup.record.itemId, qty: 1 }); // server handler commits the inventory after pickup

player.artifactRecords[0].hot = false;
player.artifactRecords[0].stabilized = true;
player.artifactSlots = [player.artifactRecords[0].id];
sanitizeArtifactLoadout(player, catalog);
assert.equal(calculateArtifactEffects(player, catalog).artifactTypeIds.length, 1);

const spring = catalog.types.find(row => row.id === 'spring');
const spring2 = { ...player.artifactRecords[0], id: 'duplicate', typeId: spring.id, itemId: spring.itemId };
player.artifactRecords = [spring2, { ...spring2, id: 'duplicate-2' }];
player.inventory = [{ id: spring.itemId, qty: 2 }];
player.artifactSlots = ['duplicate', 'duplicate-2'];
const effects = calculateArtifactEffects(player, catalog);
assert(effects.speedPct <= catalog.rules.maxSpeedBonusPct, 'Effects must respect the speed cap.');

console.log('Kromka artifact loop check passed: Shift, detector, hot container, loadout and caps.');
