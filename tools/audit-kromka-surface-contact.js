'use strict';

// Read-only diagnostics against the rendered triangles, not the analytic
// authoring height field. Reports are generated under ignored Build/.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const meshRoot = path.join(root, 'unity-client/Assets/Art/Kromka/Meshes');

function readMesh(name) {
  const text = fs.readFileSync(path.join(meshRoot, name + '.asset'), 'utf8');
  const count = Number(text.match(/m_VertexCount: (\d+)/)[1]);
  const data = Buffer.from(text.match(/_typelessdata: ([0-9a-f]+)/i)[1], 'hex');
  const stride = data.length / count;
  if (!Number.isInteger(stride) || stride < 12) throw new Error('Unsupported mesh layout');
  const vertices = Array.from({ length: count }, (_, i) => {
    const offset = i * stride;
    return [data.readFloatLE(offset), data.readFloatLE(offset + 4), data.readFloatLE(offset + 8)];
  });
  const indexData = Buffer.from(text.match(/m_IndexBuffer: ([0-9a-f]+)/i)[1], 'hex');
  const step = /m_IndexFormat: 1/.test(text) ? 4 : 2;
  const indices = Array.from({ length: indexData.length / step }, (_, i) =>
    step === 4 ? indexData.readUInt32LE(i * step) : indexData.readUInt16LE(i * step));
  return { vertices, indices };
}

const terrain = readMesh('Kromka_GlobalRelief');
const cells = new Map();
const cellSize = 0.5;
const cellKey = (x, z) => Math.floor(x / cellSize) + ':' + Math.floor(z / cellSize);
for (let i = 0; i < terrain.indices.length; i += 3) {
  const t = terrain.indices.slice(i, i + 3).map(index => terrain.vertices[index]);
  const minX = Math.floor(Math.min(...t.map(v => v[0])) / cellSize);
  const maxX = Math.floor(Math.max(...t.map(v => v[0])) / cellSize);
  const minZ = Math.floor(Math.min(...t.map(v => v[2])) / cellSize);
  const maxZ = Math.floor(Math.max(...t.map(v => v[2])) / cellSize);
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    const key = x + ':' + z;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
}

function terrainHeight(x, z) {
  let height = null;
  for (const [a, b, c] of cells.get(cellKey(x, z)) || []) {
    const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(den) < 1e-10) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-5) continue;
    const y = u * a[1] + v * b[1] + w * c[1];
    height = height === null ? y : Math.max(height, y);
  }
  return height;
}

const water = readMesh('Kromka_GlobalWater_Clean');
const authoring = fs.readFileSync(path.join(root,
  'unity-client/Assets/Editor/KromkaGlobalMapWaterAuthoring.cs'), 'utf8');
const riverPoints = authoring.match(/Vector2\[\] TesmaPath\s*=\s*\{([\s\S]*?)\};/)[1]
  .match(/new Vector2\(/g).length;
const subdivisions = Number(authoring.match(/RiverSubdivisions = (\d+)/)[1]);
const rows = (riverPoints - 1) * subdivisions + 1;
const expectedVertices = rows * 3 + 3 * 66;
if (water.vertices.length !== expectedVertices)
  throw new Error(`Expected one Tesma channel and three pools (${expectedVertices} vertices)`);
const samples = [];
for (let row = 0; row < rows; row++) {
  const a = water.vertices[row * 3 + 1];
  const b = water.vertices[Math.min(rows - 1, row + 1) * 3 + 1];
  for (const fraction of row === rows - 1 ? [0] : [0, 0.5]) {
    const p = a.map((value, i) => value + (b[i] - value) * fraction);
    const ground = terrainHeight(p[0], p[2]);
    samples.push({ row: row + fraction, mapX: +(190 + p[0] * 10).toFixed(2),
      mapY: +(150 - p[2] * 10).toFixed(2), water: p[1], ground,
      clearance: ground === null ? null : p[1] - ground });
  }
}
const submerged = samples.filter(sample => sample.clearance !== null && sample.clearance < -0.005);
const floating = samples.filter(sample => sample.clearance !== null && sample.clearance > 0.075);
const uphillRows = Array.from({ length: rows - 1 }, (_, row) => row + 1)
  .filter(row => water.vertices[row * 3 + 1][1] > water.vertices[(row - 1) * 3 + 1][1] + 0.000001);
// The third authored toxic lake is the actual receiving basin. Its plane must
// meet the outlet and cover its XZ position; a nearby but higher lake is not a sink.
const sinkWater = readMesh('Kromka_GlobalWater_Toxic');
const sink = sinkWater.vertices[132];
const outlet = water.vertices[(rows - 1) * 3 + 1];
const outletLakeLevelGap = outlet[1] - sink[1];
const outletInsideLake = Math.hypot((outlet[0] - sink[0]) / 2.2,
  (outlet[2] - sink[2]) / 1.2) < 0.85;
const confluenceValid = outletInsideLake && outletLakeLevelGap >= -0.001
  && outletLakeLevelGap <= 0.005;
const crownLake = water.vertices[rows * 3 + 66];
const crownOverlaps = Array.from({ length: rows }, (_, row) => water.vertices[row * 3 + 1])
  .filter(v => Math.hypot((v[0] - crownLake[0]) / 2.6, (v[2] - crownLake[2]) / 1.5) < .88);
const crownLakeMaximumSeam = Math.max(...crownOverlaps.map(v => Math.abs(v[1] - crownLake[1])));
const crownLakeConnected = crownOverlaps.length > 3 && crownLakeMaximumSeam < .005;
const poolEdges = [];
for (const [name, mesh, start, segments] of [
  ['clean', water, rows * 3, [64, 64, 64]], ['toxic', sinkWater, 0, [64, 64, 64, 56]],
  ['karst', readMesh('Kromka_GlobalWater_Karst'), 0, [40, 40, 40, 40, 40, 40]]]) {
  let base = start;
  for (let pool = 0; pool < segments.length; pool++) {
    const points = mesh.vertices.slice(base + 1, base + 1 + segments[pool]);
    const missingEdges = points.filter(p => terrainHeight(p[0], p[2]) === null).length;
    const gaps = points.filter(p => terrainHeight(p[0], p[2]) !== null).map(p => p[1] - terrainHeight(p[0], p[2]));
    poolEdges.push({ name, pool, exposedEdges: gaps.filter(g => g > .08).length,
      missingEdges, maxEdgeGap: Math.max(...gaps), minEdgeGap: Math.min(...gaps) });
    base += segments[pool] + 2;
  }
}
const report = { generatedAt: new Date().toISOString(), terrainVertices: terrain.vertices.length,
  riverSamples: samples.length, missingGround: samples.filter(s => s.ground === null).length,
  riverChannels: 1, cleanReservoirs: 3, uphillRows: uphillRows.length,
  outletLakeLevelGap, outletInsideLake, confluenceValid,
  crownLakeConnected, crownLakeMaximumSeam, poolEdges,
  submergedCentreSamples: submerged.length, excessiveCentreClearanceSamples: floating.length,
  minimumClearance: Math.min(...samples.filter(s => s.clearance !== null).map(s => s.clearance)),
  maximumClearance: Math.max(...samples.filter(s => s.clearance !== null).map(s => s.clearance)),
  samples };
const output = path.join(root, 'Build/KromkaSceneCaptures/surface-contact-audit.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, samples: undefined,
  worstSubmerged: submerged.sort((a, b) => a.clearance - b.clearance).slice(0, 8),
  worstFloating: floating.sort((a, b) => b.clearance - a.clearance).slice(0, 8), output }, null, 2));
if (process.argv.includes('--check') && (report.missingGround || submerged.length
    || floating.length || uphillRows.length || !confluenceValid || !crownLakeConnected
    || poolEdges.some(pool => pool.exposedEdges || pool.missingEdges))) process.exitCode = 1;
module.exports = { terrainHeight, readMesh };
