#!/usr/bin/env node
'use strict';

// Рантайм-модели транспорта: файл совпадает с манифестом, у мотоцикла есть
// подвижные части и точки для седока, и стоят они там, где их ждёт поза езды:
// седло на высоте бедра, руль впереди и выше седла, подножки у земли, колёса
// касаются земли. Лицензия исходника (CC-BY) обязана лежать рядом с ассетами.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeItemCatalog } = require('../src/server/kromka-items');
const { normalizeVehicleCatalog } = require('../src/server/vehicles');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'assets', 'models', 'vehicles');
const LICENSES = path.join(ROOT, 'public', 'assets', 'licenses', 'VEHICLE_MODELS.md');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)}: not a GLB`);
  const length = data.readUInt32LE(12);
  assert.equal(data.toString('ascii', 16, 20), 'JSON');
  return { data, gltf: JSON.parse(data.subarray(20, 20 + length).toString('utf8').trim()) };
}

function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

function multiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

// Мировые позиции узлов (glTF: Y вверх, +Z вперёд), без масштабов: экспорт их не ставит.
function worldNodes(gltf) {
  const parents = new Map();
  gltf.nodes.forEach((node, index) => (node.children || []).forEach(child => parents.set(child, index)));
  const cache = new Map();
  const world = index => {
    if (cache.has(index)) return cache.get(index);
    const node = gltf.nodes[index];
    assert(!node.scale || node.scale.every(value => Math.abs(value - 1) < 1e-6), `${node.name}: scaled node`);
    const local = { t: node.translation || [0, 0, 0], r: node.rotation || [0, 0, 0, 1] };
    let result = local;
    if (parents.has(index)) {
      const parent = world(parents.get(index));
      const offset = rotate(parent.r, local.t);
      result = { t: [parent.t[0] + offset[0], parent.t[1] + offset[1], parent.t[2] + offset[2]], r: multiply(parent.r, local.r) };
    }
    cache.set(index, result);
    return result;
  };
  const byName = new Map();
  gltf.nodes.forEach((node, index) => byName.set(node.name, {
    node, index, parent: parents.has(index) ? gltf.nodes[parents.get(index)].name : '', ...world(index)
  }));
  return byName;
}

const manifest = json(path.join(DIR, 'manifest.json'));
assert.equal(manifest.schema, 'realm.vehicle-model-manifest.v1');
assert.match(manifest.version, /^vehicles-1-[0-9a-f]{8}$/);
const items = normalizeItemCatalog(json(path.join(ROOT, 'data', 'kromka', 'items.json')));
const vehicles = normalizeVehicleCatalog(json(path.join(ROOT, 'data', 'kromka', 'vehicles.json')), items);
const licenses = fs.readFileSync(LICENSES, 'utf8');

assert.deepEqual(manifest.models.map(row => row.itemId).sort(), vehicles.vehicles.map(row => row.itemId).sort(),
  'every vehicle needs exactly one runtime model');
for (const model of manifest.models) {
  const file = path.join(DIR, model.file);
  const { data, gltf } = parseGlb(file);
  assert.equal(sha256(data), model.sha256, `${model.file}: SHA differs from the manifest; rebuild with npm run build:vehicles`);
  assert(fs.existsSync(`${file}.meta`), `${model.file}: Unity imports the models package and needs the tracked .meta`);

  let triangles = 0;
  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) triangles += gltf.accessors[primitive.indices].count / 3;
  }
  assert.equal(triangles, model.triangles, `${model.file}: triangle count differs from the manifest`);
  assert(triangles <= 6000, `${model.file}: ${triangles} triangles is too heavy for a per-player model`);
  assert(!(gltf.images || []).length, `${model.file}: flat-colour model must not grow textures`);

  const nodes = worldNodes(gltf);
  const need = (name, parent, mesh) => {
    const row = nodes.get(name);
    assert(row, `${model.file}: missing node ${name}`);
    assert.equal(row.parent, parent, `${model.file}: ${name} must hang under ${parent || 'the scene'}`);
    assert.equal(Number.isInteger(row.node.mesh), mesh, `${model.file}: ${name} ${mesh ? 'needs' : 'must not carry'} a mesh`);
    return row;
  };
  const root = need('vehicle_motorcycle', '', false);
  need('body', 'vehicle_motorcycle', true);
  const steer = need('steer', 'vehicle_motorcycle', true);
  const front = need('wheel_front', 'steer', true);
  const rear = need('wheel_rear', 'vehicle_motorcycle', true);
  const seat = need('seat', 'vehicle_motorcycle', false);
  const grips = ['grip_l', 'grip_r'].map(name => need(name, 'steer', false));
  const pegs = ['peg_l', 'peg_r'].map(name => need(name, 'vehicle_motorcycle', false));
  ['exhaust_l', 'exhaust_r'].forEach(name => need(name, 'vehicle_motorcycle', false));
  assert.deepEqual(root.t, [0, 0, 0], 'the model origin is the ground under the rider');

  const radius = Number(model.wheelRadius);
  for (const wheel of [front, rear]) {
    assert(Math.abs(wheel.t[1] - radius) < 0.01, `${wheel.node.name}: the axle must sit one radius above the ground`);
    assert(Math.abs(wheel.t[0]) < 0.001, `${wheel.node.name}: the wheel is off the centre line`);
    // Колесо крутится вокруг своей оси X: в покое его поворот нулевой.
    const rotation = multiply(wheel.r, [0, 0, 0, 1]);
    assert(Math.abs(Math.abs(rotation[3]) - 1) < 1e-4, `${wheel.node.name}: the wheel frame must be the bike frame`);
  }
  assert(front.t[2] > 0.8 && rear.t[2] < -0.5, 'the front wheel leads (+Z) and the rear trails');
  assert(seat.t[1] > 0.7 && seat.t[1] < 0.9 && Math.abs(seat.t[2]) < 0.05, 'the seat sits at hip height above the origin');
  for (const grip of grips) {
    assert(grip.t[1] > seat.t[1] + 0.2 && grip.t[1] < 1.25, `${grip.node.name}: the grip must be above the seat`);
    assert(grip.t[2] > seat.t[2] + 0.2, `${grip.node.name}: the grip must be ahead of the rider`);
    assert(Math.abs(grip.t[0]) > 0.3 && Math.abs(grip.t[0]) < 0.6, `${grip.node.name}: the grips span the handlebar`);
  }
  assert(grips[0].t[0] * grips[1].t[0] < 0, 'one grip on each side');
  for (const peg of pegs) {
    assert(peg.t[1] < 0.3 && peg.t[2] > seat.t[2], `${peg.node.name}: the foot peg sits low and ahead of the seat`);
  }
  assert(pegs[0].t[0] * pegs[1].t[0] < 0, 'one foot peg on each side');
  // Рулевая ось наклонена назад: верх оси позади низа, как у настоящей вилки.
  const axis = rotate(steer.r, [0, 1, 0]);
  assert(axis[1] > 0.85 && axis[2] < -0.2, `steering axis ${axis.map(v => v.toFixed(3))} must be raked back`);

  const source = model.source || {};
  assert.match(source.sha256 || '', /^[0-9A-F]{64}$/, `${model.file}: the donor must be pinned by SHA-256`);
  assert(source.license && source.licenseUrl && source.page && source.creator, `${model.file}: incomplete source licence`);
  assert(licenses.includes(source.page) && licenses.includes(source.sha256) && licenses.includes(source.attribution),
    `${model.file}: VEHICLE_MODELS.md must carry the donor page, SHA and attribution`);
}
console.log(`Vehicle models OK: ${manifest.models.map(row => `${row.file} ${row.triangles} tris`).join(', ')}; `
  + 'wheels, steering, seat, grips and pegs in riding positions; licence recorded.');
