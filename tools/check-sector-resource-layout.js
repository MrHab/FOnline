'use strict';

const assert = require('node:assert/strict');
const catalog = require('../data/kromka/sector-surfaces.json');
const {placementRadius} = require('./lib/sector-placement');

// These sectors received resource placements as part of the terrain migration.
// Existing resource intersections elsewhere are reported without changing their
// authored layout in this focused package.
const migrated = new Set([
  'z_03_12', 'z_04_12', 'z_05_12', 'z_07_04', 'z_08_01', 'z_08_14',
  'z_09_01', 'z_09_13', 'z_09_14', 'z_10_04', 'z_10_14', 'z_11_01',
  'z_11_04', 'z_11_13', 'z_12_13', 'z_13_02', 'z_13_03', 'z_13_13'
]);
const defects = [];
let resources = 0;
let legacyOverlaps = 0;

for (const profile of catalog.profiles) {
  const definition = profile.locationId === profile.zoneId
    ? require(`../data/zones/authored/${profile.zoneId}.json`)
    : require(`../data/locations/${profile.locationId}.json`);
  const moves = new Map((profile.placements || []).filter(row => !row.remove).map(row => [row.id, row]));
  const removed = new Set((profile.placements || []).filter(row => row.remove).map(row => row.id));
  const rows = (definition.objects || []).filter(row => row.resourceType || row.resource).map(row => {
    assert(!removed.has(row.id), `${profile.zoneId}/${row.id} resource removed by terrain planner`);
    const source = row.surfaceSourcePosition || row.position;
    const move = moves.get(row.id);
    const position = move ? {x: move.x, z: move.z} : source;
    assert(Number.isFinite(position?.x) && Number.isFinite(position?.z), `${profile.zoneId}/${row.id} position`);
    return {id: row.id, x: position.x, z: position.z, radius: placementRadius(row)};
  });
  resources += rows.length;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius;
    if (gap >= -1e-5) continue;
    if (migrated.has(profile.zoneId)) defects.push({zone: profile.zoneId, a: a.id, b: b.id, overlap: -gap});
    else legacyOverlaps++;
  }
}

assert.equal(catalog.profiles.length, 197);
assert.deepEqual(defects, [], 'Migrated resource footprints overlap');
console.log(`Sector resource layout: ${migrated.size} migrated zones clear, ${resources} resources, ${legacyOverlaps} pre-existing overlaps outside scope`);
