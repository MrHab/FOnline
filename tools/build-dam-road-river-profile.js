'use strict';

// Deterministically project the authored global-map Tesma mesh into z_10_10.
// Unity renders the same mesh; the server uses this sampled profile for movement.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const meshPath = path.join(root, 'unity-client/Assets/Resources/RealmOfAshes/DamRoadRiverSource.asset');
const reliefPath = path.join(root, 'unity-client/Assets/Resources/RealmOfAshes/GlobalMapRelief.asset');
const outputPath = path.join(root, 'data/kromka/dam-road-river-profile.json');
const segments = 256;
const depth = 320;
const width = 320;
const mapWest = 195.8;
const mapSpan = 20;
const canalX = -104.755;
const canalHalfWidth = 14.6;

function field(text, name) {
  const match = text.match(new RegExp('^\\s*' + name + ': ([^\\r\\n]+)', 'm'));
  if (!match) throw new Error('Missing ' + name);
  return match[1].trim();
}

function smoothstep(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function build() {
  const yaml = fs.readFileSync(meshPath, 'utf8');
  const relief = fs.readFileSync(reliefPath, 'utf8');
  const indexData = Buffer.from(field(yaml, 'm_IndexBuffer'), 'hex');
  const vertexData = Buffer.from(field(yaml, '_typelessdata'), 'hex');
  const vertexCount = Number(field(yaml, 'm_VertexCount'));
  const indexCount = Number(field(yaml, 'indexCount'));
  const vertexStride = vertexData.length / vertexCount;
  if (vertexStride !== 32 || indexData.length < indexCount * 2) {
    throw new Error('Unexpected source water mesh layout');
  }
  const vertices = Array.from({ length: vertexCount }, (_, i) => ({
    x: vertexData.readFloatLE(i * vertexStride),
    z: vertexData.readFloatLE(i * vertexStride + 8)
  }));
  const indices = Array.from({ length: indexCount }, (_, i) => indexData.readUInt16LE(i * 2));
  const mapWidth = Number(field(relief, 'WidthPoints'));
  const mapHeight = Number(field(relief, 'HeightPoints'));
  const round = value => Number(value.toFixed(4));
  const centers = [];
  const halfWidths = [];
  for (let step = 0; step <= segments; step++) {
    const z = (step / segments - 0.5) * depth;
    const mapY = 220 - (z / depth + 0.5) * mapSpan;
    const sourceZ = (mapHeight * 0.5 - mapY) * 0.1;
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < indices.length; i += 3) {
      for (let side = 0; side < 3; side++) {
        const a = vertices[indices[i + side]];
        const b = vertices[indices[i + (side + 1) % 3]];
        if ((a.z - sourceZ) * (b.z - sourceZ) > 0 || Math.abs(a.z - b.z) < 0.000001) continue;
        const x = a.x + (b.x - a.x) * ((sourceZ - a.z) / (b.z - a.z));
        if (x < -1 || x > 3) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    if (!Number.isFinite(left) || right - left < 0.01) throw new Error('Tesma misses z=' + z);
    let projectedLeft = Math.max(-width * 0.5,
      ((left / 0.1 + mapWidth * 0.5 - mapWest) / mapSpan - 0.5) * width);
    let projectedRight = Math.min(width * 0.5,
      ((right / 0.1 + mapWidth * 0.5 - mapWest) / mapSpan - 0.5) * width);
    const pinch = smoothstep(-depth * 0.5, -115, z) * (1 - smoothstep(-72, 0, z));
    const erosion = (1 - pinch) * Math.sin(Math.PI * step / segments);
    projectedLeft += erosion * (0.9 * Math.sin(z * 0.19)
      + 0.35 * Math.sin(z * 0.47 + 0.4));
    projectedRight += erosion * (0.75 * Math.sin(z * 0.16 + 1.3)
      + 0.28 * Math.sin(z * 0.39 + 2.1));
    centers.push(round((projectedLeft + projectedRight) * 0.5 * (1 - pinch) + canalX * pinch));
    halfWidths.push(round((projectedRight - projectedLeft) * 0.5 * (1 - pinch)
      + canalHalfWidth * pinch));
  }
  return JSON.stringify({
    schema: 'roa.damRoadRiverProfile.v1',
    locationId: 'z_10_10',
    width, depth, segments,
    bridge: { x: canalX, z: -106, halfWidth: 18, halfDepth: 3.6 },
    centers, halfWidths
  }, null, 2) + '\n';
}

const generated = build();
if (process.argv.includes('--check')) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== generated) {
    throw new Error('Dam-road river profile is stale; run node tools/build-dam-road-river-profile.js');
  }
  console.log('Dam-road river profile matches the authored global water mesh.');
} else {
  fs.writeFileSync(outputPath, generated);
  console.log('Wrote ' + path.relative(root, outputPath));
}
