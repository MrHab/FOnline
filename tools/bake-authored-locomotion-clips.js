// Запекает авторские клипы локомоции (walk_back, crouch_walk) в ревью-GLB
// человекоподобного НПС по таблицам tools/blender/authored_locomotion_clips.json.
//
// Обычно клипы печёт Blender-билдер tools/blender/build_unified_humanoid_npc_review.py
// (единственный источник таблиц — общий JSON). Этот запекатель — эквивалентный
// путь без Blender: соответствие математики проверено по клипу turn —
// относительный кватернион узла GLB совпадает с авторским Euler-оффсетом
// ось-в-ось, а смещение root-кости отображается перестановкой (x, z, y).
//
// Использование: node tools/bake-authored-locomotion-clips.js
// Перезаписывает ревью-GLB и отчёт; SHA в tools/build-approved-humanoid-assets.js
// после этого нужно обновить вручную (осознанный шаг пере-одобрения).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-humanoid-npc-v6', 'base');
const GLB_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6.glb');
const REPORT_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6-report.json');
const TABLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'blender', 'authored_locomotion_clips.json'), 'utf8'));

const FPS = Number(TABLES.fps || 24);

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

// Гладкая интерполяция компоненты между ключами (аналог auto-clamped bezier).
function smoothstep(u) { return u * u * (3 - 2 * u); }

function sampleOffset(frames, boneName, key, frame) {
  // frames: [[frameNo, pose], ...] по возрастанию; значение компоненты для кадра.
  const value = (pose) => {
    const tr = pose[boneName];
    const fallback = key === 'rotation' ? [0, 0, 0] : [0, 0, 0];
    return tr && tr[key] ? tr[key] : fallback;
  };
  if (frame <= frames[0][0]) return value(frames[0][1]);
  for (let i = 0; i < frames.length - 1; i++) {
    const [fa, pa] = frames[i];
    const [fb, pb] = frames[i + 1];
    if (frame >= fa && frame <= fb) {
      const u = fb === fa ? 0 : smoothstep((frame - fa) / (fb - fa));
      const a = value(pa);
      const b = value(pb);
      return a.map((av, c) => av + (b[c] - av) * u);
    }
  }
  return value(frames[frames.length - 1][1]);
}

function main() {
  const { json, bin } = parseGlb(GLB_FILE);
  const nodeNames = json.nodes.map(node => node.name || '');
  const joints = json.skins[0].joints;
  const idle = (json.animations || []).find(anim => anim.name === 'idle');
  if (!idle) throw new Error('idle clip missing in review GLB');

  // Базлайн: первые сэмплы idle по каждому узлу; фолбэк — rest узла.
  const baseline = new Map();
  for (const nodeIndex of joints) {
    const node = json.nodes[nodeIndex];
    const base = {
      translation: (node.translation || [0, 0, 0]).slice(),
      rotation: (node.rotation || [0, 0, 0, 1]).slice(),
      scale: (node.scale || [1, 1, 1]).slice()
    };
    for (const ch of idle.channels) {
      if (ch.target.node !== nodeIndex) continue;
      const values = accessorValues(json, bin, idle.samplers[ch.sampler].output);
      base[ch.target.path] = values[0].slice();
    }
    baseline.set(nodeIndex, base);
  }

  const existing = new Set((json.animations || []).map(anim => anim.name));
  const chunks = [bin];
  let binOffset = bin.length;
  const alignTo4 = () => {
    const pad = (4 - (binOffset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad, 0)); binOffset += pad; }
  };
  const pushFloats = (rows) => {
    alignTo4();
    const flat = rows.flat();
    const data = Buffer.alloc(flat.length * 4);
    flat.forEach((v, i) => data.writeFloatLE(v, i * 4));
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: data.length });
    chunks.push(data);
    binOffset += data.length;
    return viewIndex;
  };
  const pushAccessor = (rows, type, withMinMax) => {
    const viewIndex = pushFloats(rows);
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const accessor = {
      bufferView: viewIndex,
      componentType: 5126,
      count: rows.length,
      type
    };
    if (withMinMax) {
      const cols = rows[0].length;
      accessor.min = Array.from({ length: cols }, (_, c) => Math.min(...rows.map(r => r[c])));
      accessor.max = Array.from({ length: cols }, (_, c) => Math.max(...rows.map(r => r[c])));
    }
    json.accessors.push(accessor);
    return json.accessors.length - 1;
  };

  for (const [clipName, clip] of Object.entries(TABLES.clips)) {
    if (existing.has(clipName)) throw new Error(`clip ${clipName} already exists in review GLB`);
    const frames = clip.frames;
    const firstFrame = frames[0][0];
    const lastFrame = frames[frames.length - 1][0];
    const times = [];
    for (let f = firstFrame; f <= lastFrame; f++) times.push([(f - firstFrame) / FPS]);
    const inputAccessor = pushAccessor(times, 'SCALAR', true);
    const samplers = [];
    const channels = [];
    for (const nodeIndex of joints) {
      const name = nodeNames[nodeIndex];
      const base = baseline.get(nodeIndex);
      const translations = [];
      const rotations = [];
      const scales = [];
      let prevQuat = null;
      for (let f = firstFrame; f <= lastFrame; f++) {
        const rotOffset = sampleOffset(frames, name, 'rotation', f);
        const locOffset = sampleOffset(frames, name, 'location', f);
        let quat = quatMultiply(base.rotation, quatFromEulerXYZ(rotOffset));
        if (prevQuat) {
          const dot = quat[0] * prevQuat[0] + quat[1] * prevQuat[1] + quat[2] * prevQuat[2] + quat[3] * prevQuat[3];
          if (dot < 0) quat = quat.map(v => -v);
        }
        prevQuat = quat;
        rotations.push(quat);
        // Авторские оси кости (x, y, z) -> оси узла GLB (x, z, y): проверено по turn.
        translations.push([
          base.translation[0] + locOffset[0],
          base.translation[1] + locOffset[2],
          base.translation[2] + locOffset[1]
        ]);
        scales.push(base.scale.slice());
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
    console.log(`baked ${clipName}: ${channels.length} каналов, ${times.length} кадров, ${(times[times.length - 1][0]).toFixed(3)} с`);
  }

  const newBin = Buffer.concat(chunks);
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
