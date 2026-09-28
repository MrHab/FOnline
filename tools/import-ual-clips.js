#!/usr/bin/env node
'use strict';
// Переносит клипы Quaternius Universal Animation Library (CC0) в ревью-GLB
// человекоподобного НПС: скелет UAL — то же семейство, что наш (Quaternius UBC,
// те же имена костей), но позы покоя и длины костей немного другие. Поэтому
// кадр не копируется, а переносится разностью с покоем в осях самой кости:
//   наш_кадр = наш_покой * (покой_UAL)^-1 * кадр_UAL,
// а ход таза масштабируется по его высоте. Остальные смещения и масштабы костей —
// покой нашего скелета, как в прежних клипах (у каждого клипа есть дорожки всех
// костей, иначе смена клипа оставила бы кость в чужой позе).
//
// Использование:
//   node tools/import-ual-clips.js <UAL1_Standard.glb> <UAL2_Standard.glb>
// Исходник — версия без root motion (Unreal-Godot/UAL1_Standard.glb). Перезаписывает
// ревью-GLB и SHA в его отчёте; одобрение критика и SHA в
// tools/build-approved-humanoid-assets.js обновляются осознанно, после ревью.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-humanoid-npc-v6', 'base');
const GLB_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6.glb');
const REPORT_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6-report.json');

// Имя клипа в игре ← клип UAL (timeScale < 1 — клип короче). Прежние idle/attack/
// hurt/death заменяются: стойка без полушага, удар из стойки, попадание в грудь и
// падение на спину на месте вместо прыжка вперёд. walk/run остаются: это те же
// клипы UAL, запечённые раньше.
const CLIPS = {
  idle: { source: 'Idle_Loop' },
  attack: { source: 'Punch_Jab', timeScale: 0.6 },
  hurt: { source: 'Hit_Chest' },
  death: { source: 'Death01' },
  crouch_idle: { source: 'Crouch_Idle_Loop' },
  hit_head: { source: 'Hit_Head' },
  punch_cross: { source: 'Punch_Cross', timeScale: 0.6 },
  pistol_idle: { source: 'Pistol_Idle_Loop' },
  pistol_shoot: { source: 'Pistol_Shoot' },
  pistol_reload: { source: 'Pistol_Reload' },
  sword_idle: { source: 'Sword_Idle' },
  sword_attack: { source: 'Sword_Attack' },
  pickup: { source: 'PickUp_Table' },
  kneel_work: { source: 'Fixing_Kneeling' },
  // UAL2: добыча, еда и аптечка, ящик. Hit_Knockback (падение без подъёма) и
  // Melee_Hook (заканчивается выпадом) критик отклонил.
  chop: { source: 'TreeChopping_Loop', pack: 2 },
  harvest: { source: 'Farm_Harvest', pack: 2 },
  consume: { source: 'Consume', pack: 2 },
  chest_open: { source: 'Chest_Open', pack: 2 }
};

const RETIRED = ['hit_knockback', 'melee_hook'];

const { parseGlb, compactGlb, writeGlb, readAccessor } = require('./lib/glb');

// Кватернионы glTF: [x, y, z, w].
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qinv = q => { const n = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]; return [-q[0] / n, -q[1] / n, -q[2] / n, q[3] / n]; };
const qnorm = q => { const n = Math.hypot(...q) || 1; return q.map(v => v / n); };

function main() {
  const sources = [process.argv[2], process.argv[3]];
  if (sources.some(file => !file || !fs.existsSync(file)))
    throw new Error('usage: node tools/import-ual-clips.js <UAL1_Standard.glb> <UAL2_Standard.glb>');
  const packs = { 1: parseGlb(sources[0]), 2: parseGlb(sources[1]) };
  const ual = packs[1];
  const ours = parseGlb(GLB_FILE);

  // Кости нашего скелета — узлы, которые двигает прежний клип idle.
  const idle = ours.json.animations.find(row => row.name === 'idle');
  const bones = [...new Set(idle.channels.map(channel => channel.target.node))];
  const ualByName = new Map(ual.json.nodes.map((node, index) => [String(node.name).toLowerCase(), index]));
  const rest = node => ({
    t: node.translation || [0, 0, 0],
    r: node.rotation || [0, 0, 0, 1],
    s: node.scale || [1, 1, 1]
  });
  const pelvisOurs = ours.json.nodes.find(node => node.name === 'pelvis');
  const pelvisUal = ual.json.nodes[ualByName.get('pelvis')];
  const heightScale = Math.hypot(...rest(pelvisOurs).t) / Math.hypot(...rest(pelvisUal).t);

  const chunks = [ours.bin];
  let offset = ours.bin.length;
  const addData = (values, type, withRange) => {
    const floats = Float32Array.from(values.flat());
    const data = Buffer.from(floats.buffer);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    ours.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    chunks.push(data);
    offset += data.length;
    const accessor = { bufferView: ours.json.bufferViews.length - 1, componentType: 5126, count: values.length, type };
    if (withRange) { accessor.min = [Math.min(...values.map(v => v[0]))]; accessor.max = [Math.max(...values.map(v => v[0]))]; }
    ours.json.accessors.push(accessor);
    return ours.json.accessors.length - 1;
  };

  // Отклонённые критиком клипы удаляются и из уже импортированного файла.
  ours.json.animations = ours.json.animations.filter(item => !RETIRED.includes(item.name));
  const imported = [];
  for (const [name, row] of Object.entries(CLIPS)) {
    const ualName = row.source;
    const timeScale = row.timeScale || 1;
    // Обе библиотеки — один скелет UAL: покой берётся из первой, кадры — из своей.
    const pack = packs[row.pack || 1];
    const clip = pack.json.animations.find(item => item.name === ualName);
    const packByName = new Map(pack.json.nodes.map((node, index) => [String(node.name).toLowerCase(), index]));
    if (!clip) throw new Error(`UAL clip ${ualName} is missing`);
    ours.json.animations = ours.json.animations.filter(item => item.name !== name);
    const byTarget = new Map();
    for (const channel of clip.channels) {
      const node = pack.json.nodes[channel.target.node];
      byTarget.set(String(node.name).toLowerCase() + ':' + channel.target.path, clip.samplers[channel.sampler]);
    }
    let end = 0;
    for (const sampler of clip.samplers) end = Math.max(end, ...readAccessor(pack, sampler.input).map(key => key[0] * timeScale));
    const constantTimes = addData([[0], [end]], 'SCALAR', true);
    const animation = { name, channels: [], samplers: [] };
    const put = (node, pathName, input, output, interpolation) => {
      animation.samplers.push({ input, output, interpolation });
      animation.channels.push({ sampler: animation.samplers.length - 1, target: { node, path: pathName } });
    };
    for (const node of bones) {
      const ourNode = ours.json.nodes[node];
      const key = String(ourNode.name).toLowerCase();
      const ourRest = rest(ourNode);
      const ualIndex = packByName.get(key);
      const ualRest = ualIndex != null ? rest(pack.json.nodes[ualIndex]) : null;

      const rotation = ualRest ? byTarget.get(key + ':rotation') : null;
      if (rotation) {
        const times = readAccessor(pack, rotation.input).map(key => [key[0] * timeScale]);
        const correction = qmul(ourRest.r, qinv(ualRest.r));
        let previous = null;
        const values = readAccessor(pack, rotation.output).map(q => {
          let out = qnorm(qmul(correction, q));
          // Соседние ключи — в одном полушарии, иначе интерполяция крутит кость вспять.
          if (previous && out.reduce((sum, v, i) => sum + v * previous[i], 0) < 0) out = out.map(v => -v);
          previous = out;
          return out;
        });
        put(node, 'rotation', addData(times, 'SCALAR', true), addData(values, 'VEC4'), 'LINEAR');
      } else {
        put(node, 'rotation', constantTimes, addData([ourRest.r, ourRest.r], 'VEC4'), 'STEP');
      }

      const translation = key === 'pelvis' && ualRest ? byTarget.get(key + ':translation') : null;
      if (translation) {
        const times = readAccessor(pack, translation.input).map(key => [key[0] * timeScale]);
        const values = readAccessor(pack, translation.output)
          .map(t => t.map((v, i) => ourRest.t[i] + (v - ualRest.t[i]) * heightScale));
        put(node, 'translation', addData(times, 'SCALAR', true), addData(values, 'VEC3'), 'LINEAR');
      } else {
        put(node, 'translation', constantTimes, addData([ourRest.t, ourRest.t], 'VEC3'), 'STEP');
      }
      put(node, 'scale', constantTimes, addData([ourRest.s, ourRest.s], 'VEC3'), 'STEP');
    }
    ours.json.animations.push(animation);
    imported.push(`${name} (${ualName}, ${end.toFixed(2)} s)`);
  }

  const bin = compactGlb(ours.json, Buffer.concat(chunks));
  writeGlb(GLB_FILE, ours.json, bin);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(GLB_FILE)).digest('hex').toUpperCase();
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  report.sha256 = sha;
  report.animations = ours.json.animations.map(row => row.name);
  report.ualImport = { source: 'Quaternius Universal Animation Library (CC0)', clips: Object.keys(CLIPS), heightScale: Number(heightScale.toFixed(4)) };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
  console.log(`UAL clips imported: ${imported.length} into ${path.relative(ROOT, GLB_FILE)} (sha ${sha}), pelvis scale ${heightScale.toFixed(3)}`);
  console.log(imported.join('\n'));
}

main();
