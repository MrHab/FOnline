// Запекает авторские клипы локомоции (walk_back, crouch_walk) в ревью-GLB
// человекоподобного НПС по описаниям tools/blender/authored_locomotion_clips.json.
//
// Клипы выводятся из проверенного walk, а не рисуются с нуля: механика опоры
// и переноса (опорная нога метёт монотонно и разворачивается в воздухе)
// наследуется, поэтому клип гарантированно «покрывает землю». Размах ног
// масштабируется, характер позы задаётся статичными оффсетами.
//
// Использование: node tools/bake-authored-locomotion-clips.js
// Перезаписывает ревью-GLB и отчёт; SHA в tools/build-approved-humanoid-assets.js
// и одобрение критика после этого обновляются осознанно.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-humanoid-npc-v6', 'base');
const GLB_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6.glb');
const REPORT_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6-report.json');
const TABLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'blender', 'authored_locomotion_clips.json'), 'utf8'));

const FPS = Number(TABLES.fps || 24);
const LEG_BONES = new Set(TABLES.legBones || []);

function parseGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8').replace(/\0+$/, ''));
  const binHeaderAt = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeaderAt);
  const bin = buf.slice(binHeaderAt + 8, binHeaderAt + 8 + binLen);
  return { json, bin };
}

function writeGlb(file, json, bin) {
  let jsonText = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonText.length % 4)) % 4;
  if (jsonPad) jsonText = Buffer.concat([jsonText, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binOut = binPad ? Buffer.concat([bin, Buffer.alloc(binPad, 0)]) : bin;
  const total = 12 + 8 + jsonText.length + 8 + binOut.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonText.length, 12);
  out.writeUInt32LE(0x4E4F534A, 16);
  jsonText.copy(out, 20);
  const binAt = 20 + jsonText.length;
  out.writeUInt32LE(binOut.length, binAt);
  out.writeUInt32LE(0x004E4942, binAt + 4);
  binOut.copy(out, binAt + 8);
  fs.writeFileSync(file, out);
}

function accessorValues(json, bin, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const row = [];
    for (let c = 0; c < comps; c++) row.push(bin.readFloatLE(off + (k * comps + c) * 4));
    out.push(row);
  }
  return out;
}

function quatFromEulerXYZ([x, y, z]) {
  const cx = Math.cos(x / 2); const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2); const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2); const sz = Math.sin(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz
  ];
}

function quatMultiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}

function quatNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function quatSlerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let end = b.slice();
  if (dot < 0) { end = end.map(v => -v); dot = -dot; }
  if (dot > 0.9995) {
    return quatNormalize(a.map((v, i) => v + (end[i] - v) * t));
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return quatNormalize(a.map((v, i) => v * wa + end[i] * wb));
}

// Линейная выборка канала анимации в момент времени t.
function sampleChannel(times, values, t, isQuat) {
  const last = times.length - 1;
  if (t <= times[0]) return values[0].slice();
  if (t >= times[last]) return values[last].slice();
  let i = 0;
  while (i < last && times[i + 1] < t) i++;
  const t0 = times[i];
  const t1 = times[i + 1];
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = values[i];
  const b = values[i + 1];
  if (isQuat) return quatSlerp(a, b, u);
  return a.map((av, c) => av + (b[c] - av) * u);
}

function main() {
  const { json, bin } = parseGlb(GLB_FILE);
  const nodeNames = json.nodes.map(node => node.name || '');
  const joints = json.skins[0].joints;

  // Перезапекание: старые версии выводимых клипов снимаем, осиротевшие
  // аксессоры отсекает финальная компактизация буфера.
  const derivedNames = new Set(Object.keys(TABLES.clips));
  json.animations = (json.animations || []).filter(anim => !derivedNames.has(anim.name));
  const clipByName = new Map(json.animations.map(anim => [anim.name, anim]));

  // Поза покоя: первый сэмпл idle, фолбэк — rest узла.
  const idle = clipByName.get('idle');
  if (!idle) throw new Error('idle clip missing in review GLB');
  const restPose = new Map();
  for (const nodeIndex of joints) {
    const node = json.nodes[nodeIndex];
    const base = {
      translation: (node.translation || [0, 0, 0]).slice(),
      rotation: (node.rotation || [0, 0, 0, 1]).slice(),
      scale: (node.scale || [1, 1, 1]).slice()
    };
    for (const ch of idle.channels) {
      if (ch.target.node !== nodeIndex) continue;
      base[ch.target.path] = accessorValues(json, bin, idle.samplers[ch.sampler].output)[0].slice();
    }
    restPose.set(nodeIndex, base);
  }

  const chunks = [bin];
  let binOffset = bin.length;
  const alignTo4 = () => {
    const pad = (4 - (binOffset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad, 0)); binOffset += pad; }
  };
  const pushAccessor = (rows, type, withMinMax) => {
    alignTo4();
    const flat = rows.flat();
    const data = Buffer.alloc(flat.length * 4);
    flat.forEach((v, i) => data.writeFloatLE(v, i * 4));
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: data.length });
    chunks.push(data);
    binOffset += data.length;
    const accessor = { bufferView: viewIndex, componentType: 5126, count: rows.length, type };
    if (withMinMax) {
      const cols = rows[0].length;
      accessor.min = Array.from({ length: cols }, (_, c) => Math.min(...rows.map(r => r[c])));
      accessor.max = Array.from({ length: cols }, (_, c) => Math.max(...rows.map(r => r[c])));
    }
    json.accessors.push(accessor);
    return json.accessors.length - 1;
  };

  for (const [clipName, clip] of Object.entries(TABLES.clips)) {
    if (clipByName.has(clipName)) throw new Error(`clip ${clipName} already exists in review GLB`);
    const source = clipByName.get(clip.derivedFrom);
    if (!source) throw new Error(`source clip ${clip.derivedFrom} missing for ${clipName}`);

    // Каналы источника по узлу и типу.
    const sourceChannels = new Map();
    let duration = 0;
    for (const ch of source.channels) {
      const sampler = source.samplers[ch.sampler];
      const times = accessorValues(json, bin, sampler.input).map(row => row[0]);
      const values = accessorValues(json, bin, sampler.output);
      duration = Math.max(duration, times[times.length - 1]);
      if (!sourceChannels.has(ch.target.node)) sourceChannels.set(ch.target.node, {});
      sourceChannels.get(ch.target.node)[ch.target.path] = { times, values };
    }

    const strideScale = Number(clip.legStrideScale ?? 1);
    const additive = clip.additive || {};
    const frameCount = Math.max(2, Math.round(duration * FPS) + 1);
    const times = [];
    for (let f = 0; f < frameCount; f++) times.push([(f / (frameCount - 1)) * duration]);
    const inputAccessor = pushAccessor(times, 'SCALAR', true);

    const samplers = [];
    const channels = [];
    for (const nodeIndex of joints) {
      const name = nodeNames[nodeIndex];
      const rest = restPose.get(nodeIndex);
      const src = sourceChannels.get(nodeIndex) || {};
      const add = additive[name] || {};
      const addQuat = add.rotation ? quatFromEulerXYZ(add.rotation) : null;
      const addLoc = add.location || null;
      const scaleLeg = LEG_BONES.has(name) ? strideScale : 1;

      const translations = [];
      const rotations = [];
      const scales = [];
      let prevQuat = null;
      for (let f = 0; f < frameCount; f++) {
        const tRaw = times[f][0];
        const t = clip.timeReverse ? Math.max(0, duration - tRaw) : tRaw;

        let quat = src.rotation
          ? sampleChannel(src.rotation.times, src.rotation.values, t, true)
          : rest.rotation.slice();
        // Размах ног масштабируется как отклонение от позы покоя.
        if (scaleLeg !== 1) quat = quatSlerp(rest.rotation, quat, scaleLeg);
        if (addQuat) quat = quatMultiply(quat, addQuat);
        quat = quatNormalize(quat);
        if (prevQuat) {
          const dot = quat[0] * prevQuat[0] + quat[1] * prevQuat[1] + quat[2] * prevQuat[2] + quat[3] * prevQuat[3];
          if (dot < 0) quat = quat.map(v => -v);
        }
        prevQuat = quat;
        rotations.push(quat);

        let loc = src.translation
          ? sampleChannel(src.translation.times, src.translation.values, t, false)
          : rest.translation.slice();
        if (scaleLeg !== 1) loc = loc.map((v, c) => rest.translation[c] + (v - rest.translation[c]) * scaleLeg);
        if (addLoc) loc = [loc[0] + addLoc[0], loc[1] + addLoc[2], loc[2] + addLoc[1]];
        translations.push(loc);

        scales.push(src.scale
          ? sampleChannel(src.scale.times, src.scale.values, t, false)
          : rest.scale.slice());
      }

      for (const [pathName, rows, type] of [
        ['translation', translations, 'VEC3'],
        ['rotation', rotations, 'VEC4'],
        ['scale', scales, 'VEC3']
      ]) {
        const outputAccessor = pushAccessor(rows, type, false);
        samplers.push({ input: inputAccessor, interpolation: 'LINEAR', output: outputAccessor });
        channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex, path: pathName } });
      }
    }
    json.animations.push({ name: clipName, samplers, channels });
    clipByName.set(clipName, json.animations[json.animations.length - 1]);
    console.log(`запечён ${clipName}: источник ${clip.derivedFrom}${clip.timeReverse ? ' (реверс)' : ''},`
      + ` размах ног ${(strideScale * 100).toFixed(0)}%, ${channels.length} каналов,`
      + ` ${frameCount} кадров, ${duration.toFixed(3)} с`);
  }

  // Компактизация: в новый буфер переносим только используемые bufferView'ы,
  // иначе каждое перезапекание тащило бы за собой мёртвые байты прошлых версий.
  const stagedBin = Buffer.concat(chunks);
  const usedViews = new Set();
  for (const accessor of json.accessors) {
    if (Number.isInteger(accessor.bufferView)) usedViews.add(accessor.bufferView);
  }
  for (const image of json.images || []) {
    if (Number.isInteger(image.bufferView)) usedViews.add(image.bufferView);
  }
  const referencedAccessors = new Set();
  const noteAccessor = (index) => { if (Number.isInteger(index)) referencedAccessors.add(index); };
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      Object.values(prim.attributes || {}).forEach(noteAccessor);
      noteAccessor(prim.indices);
      for (const targetSet of prim.targets || []) Object.values(targetSet).forEach(noteAccessor);
    }
  }
  for (const skin of json.skins || []) noteAccessor(skin.inverseBindMatrices);
  for (const anim of json.animations || []) {
    for (const sampler of anim.samplers || []) { noteAccessor(sampler.input); noteAccessor(sampler.output); }
  }
  const keptViewIndices = [...usedViews].filter(index => (
    json.accessors.some((accessor, i) => accessor.bufferView === index && referencedAccessors.has(i))
  ) || (json.images || []).some(image => image.bufferView === index));
  keptViewIndices.sort((a, b) => a - b);
  const viewRemap = new Map();
  const compactChunks = [];
  let compactOffset = 0;
  for (const oldIndex of keptViewIndices) {
    const view = json.bufferViews[oldIndex];
    const pad = (4 - (compactOffset % 4)) % 4;
    if (pad) { compactChunks.push(Buffer.alloc(pad, 0)); compactOffset += pad; }
    const slice = stagedBin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    compactChunks.push(slice);
    viewRemap.set(oldIndex, { index: viewRemap.size, byteOffset: compactOffset });
    compactOffset += view.byteLength;
  }
  const newBufferViews = keptViewIndices.map(oldIndex => ({
    ...json.bufferViews[oldIndex],
    buffer: 0,
    byteOffset: viewRemap.get(oldIndex).byteOffset
  }));
  const accessorRemap = new Map();
  const newAccessors = [];
  json.accessors.forEach((accessor, index) => {
    if (!referencedAccessors.has(index)) return;
    accessorRemap.set(index, newAccessors.length);
    newAccessors.push({
      ...accessor,
      bufferView: Number.isInteger(accessor.bufferView)
        ? viewRemap.get(accessor.bufferView).index
        : accessor.bufferView
    });
  });
  const remapAccessor = (index) => (Number.isInteger(index) ? accessorRemap.get(index) : index);
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      for (const key of Object.keys(prim.attributes || {})) prim.attributes[key] = remapAccessor(prim.attributes[key]);
      if (Number.isInteger(prim.indices)) prim.indices = remapAccessor(prim.indices);
      for (const targetSet of prim.targets || []) {
        for (const key of Object.keys(targetSet)) targetSet[key] = remapAccessor(targetSet[key]);
      }
    }
  }
  for (const skin of json.skins || []) {
    if (Number.isInteger(skin.inverseBindMatrices)) skin.inverseBindMatrices = remapAccessor(skin.inverseBindMatrices);
  }
  for (const anim of json.animations || []) {
    for (const sampler of anim.samplers || []) {
      sampler.input = remapAccessor(sampler.input);
      sampler.output = remapAccessor(sampler.output);
    }
  }
  for (const image of json.images || []) {
    if (Number.isInteger(image.bufferView)) image.bufferView = viewRemap.get(image.bufferView).index;
  }
  json.bufferViews = newBufferViews;
  json.accessors = newAccessors;
  const newBin = Buffer.concat(compactChunks);
  json.buffers[0].byteLength = newBin.length;
  writeGlb(GLB_FILE, json, newBin);

  const sha = crypto.createHash('sha256').update(fs.readFileSync(GLB_FILE)).digest('hex').toUpperCase();
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  report.requiredAnimations = ['idle', 'walk', 'run', 'turn', ...Object.keys(TABLES.clips), 'attack', 'hurt', 'death'];
  report.actualGlb.animations = json.animations.map(anim => anim.name);
  report.sha256 = sha;
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
  console.log('review sha256:', sha);
}

main();
