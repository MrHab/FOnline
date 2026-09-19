'use strict';

// A Kromka location row and its Unity scene marker must agree on movement.
// KromkaWorldSceneExporter derives `collision` from the marker's BlocksMovement,
// so a row that says "none" under a marker that says "blocks" turns solid on the
// authoritative server with the next export of that scene. 319 rows sat in that
// state from the Kromka integration on, and every fix had to avoid full exports.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  collisionBlocksMovement,
  locationScenePath,
  readPlacedObjectMarkers
} = require('./kromka-scene-markers');

const ROOT = path.resolve(__dirname, '..');
const locationsDir = path.join(ROOT, 'data', 'locations');

const mismatches = [];
const unexported = [];
let scenes = 0;
let pairs = 0;
let blocking = 0;

for (const file of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json')).sort()) {
  const definition = JSON.parse(fs.readFileSync(path.join(locationsDir, file), 'utf8'));
  const scenePath = locationScenePath(definition, ROOT);
  if (!scenePath) continue;
  assert(fs.existsSync(scenePath), `${file}: Unity scene ${definition.unityScene} is missing`);
  const markers = readPlacedObjectMarkers(scenePath);
  assert(markers.size > 0, `${file}: ${definition.unityScene} has no placed-object markers`);
  scenes += 1;

  const rows = new Map((Array.isArray(definition.objects) ? definition.objects : [])
    .filter(row => row && row.id)
    .map(row => [String(row.id), row]));
  for (const marker of markers.values()) {
    // The exporter skips terrain markers: the ground has no server row.
    if (marker.role === 'terrain') continue;
    const row = rows.get(marker.id);
    if (!row) {
      unexported.push(`${file}: ${marker.id}`);
      continue;
    }
    pairs += 1;
    const dataBlocks = collisionBlocksMovement(row.collision);
    if (dataBlocks) blocking += 1;
    if (dataBlocks !== marker.blocksMovement) {
      mismatches.push(`${file}: ${marker.id} (${row.model || marker.archetype}) collision "${row.collision}"`
        + ` vs marker _blocksMovement ${marker.blocksMovement ? 1 : 0}`);
    }
  }
}

assert(scenes > 0 && pairs > 0, 'no Kromka location row was paired with a Unity scene marker');
assert.deepStrictEqual(unexported, [],
  'Unity scene markers without a data/locations row (the scene was never exported)');
assert.deepStrictEqual(mismatches, [],
  'data/locations collision disagrees with the Unity marker; a scene export would silently flip it');

console.log(`Kromka collision parity OK: ${pairs} rows in ${scenes} Unity scenes match their markers`
  + ` (${blocking} block movement).`);
