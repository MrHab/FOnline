'use strict';

// Local cutout of the authored freight railway. The checkpoint's existing
// shared bridge/yard is straight; smooth approaches join it to the map route.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const route = read('data/global-map.json').infrastructure.find(row => row.id === 'ore_freight_rail');
if (!route || route.type !== 'railway') throw new Error('Authored freight railway is missing');
const source = route.points.map(p => ({ x: (p.x - 205.8) * 16, z: (210 - p.y) * 16 }));
function mapZ(x) {
  for (let i = 1; i < source.length; i++) {
    const a = source[i - 1], b = source[i];
    if (x >= a.x && x <= b.x) return a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x);
  }
  throw new Error('Railway does not cover x=' + x);
}
function blend(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * t * (10 + t * (-15 + t * 6));
}
function localZ(x) {
  // Preserve exact map alignment outside the checkpoint approaches.
  if (x < -124) return mapZ(x) * (1 - blend(-160, -124, x)) - 106 * blend(-160, -124, x);
  if (x <= -12) return -106;
  // Round the authored map polyline's turn without a kink in the track.
  let z = mapZ(x);
  const corner = source.find(p => Math.abs(p.x - 83.2) < 0.01);
  if (corner && x > corner.x - 20 && x < corner.x + 20) {
    const d = x - (corner.x - 20);
    z = corner.z + 20 / 6 - d / 6 + (0.6 + 1 / 6) * d * d / 80;
  }
  return -106 + (z + 106) * blend(-12, 63.2, x);
}
const points = Array.from({ length: 641 }, (_, i) => {
  const x = -160 + i * 0.5;
  return { x, z: Number(localZ(x).toFixed(5)) };
});
const profile = {
  schema: 'roa.damRoadRail.v1', route: route.id,
  mapWest: 195.8, mapSpan: 20, width: 320, depth: 320,
  bridgeZ: -106, straightFromX: -124, straightToX: -12,
  gauge: 1.52, sleeperSpacing: 0.7, points
};
const content = JSON.stringify(profile, null, 2) + '\n';
const output = 'data/kromka/dam-road-rail.json';
const resource = 'unity-client/Assets/Resources/RealmOfAshes/DamRoadRail.json';
const layoutFile = 'data/kromka/site-layouts/roadOutpost.json';
const layout = read(layoutFile);
layout.clear.points = layout.clear.points.filter(p => p.route !== route.id);
for (let i = 0; i < points.length; i += 8) {
  const p = points[i];
  layout.clear.points.push({ x: Number((p.x - layout.site.center.x).toFixed(5)),
    z: Number((p.z - layout.site.center.z).toFixed(5)), r: 6, route: route.id });
}
if (process.argv.includes('--check')) {
  for (const file of [output, resource]) {
    if (fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n') !== content)
      throw new Error(file + ' is stale; run tools/build-dam-road-rail.js');
  }
  if (JSON.stringify(read(layoutFile).clear.points) !== JSON.stringify(layout.clear.points))
    throw new Error('Railway clearance corridor is stale');
} else {
  for (const file of [output, resource]) fs.writeFileSync(path.join(root, file), content);
  fs.writeFileSync(path.join(root, layoutFile), JSON.stringify(layout, null, 2) + '\n');
}
console.log('[dam-road-rail] PASS: map cutout, continuous bridge approaches, ' + points.length + ' samples');
