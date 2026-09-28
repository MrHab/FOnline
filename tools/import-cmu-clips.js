#!/usr/bin/env node
'use strict';
// Переносит клипы CMU Graphics Lab Motion Capture Database (BVH, версия Bruce Hahne
// «MotionBuilder-friendly») в ревью-GLB человекоподобного НПС. Скелет CMU другой,
// поэтому перенос идёт по мировым поворотам костей:
//   наш_мир(t) = H * Δ(t) * C^-1 * наш_покой_мир,  Δ(t) = мир_CMU(t) * мир_CMU(0)^-1,
// где кадр 0 файла — T-поза исполнителя, C доворачивает направление кости CMU в этой
// позе на направление нашей кости в покое, H снимает средний курс исполнителя.
// Таз двигается по ходу CMU, масштабированному длиной ног; поступательный ход по
// земле вычитается (клип на месте, скорость хода печатается для ClipNaturalSpeeds).
// Из отрезка берётся одна петля: ищутся два кадра с самой похожей позой и скоростью,
// остаток разности разносится по петле.
//
// Использование:
//   node tools/import-cmu-clips.js <каталог с BVH>
// Перезаписывает ревью-GLB и SHA в его отчёте; одобрение критика и SHA в
// tools/build-approved-humanoid-assets.js обновляются осознанно, после ревью.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseGlb, compactGlb, writeGlb, readAccessor } = require('./lib/glb');
const { parseBvh, pose, qmul, qinv, qnorm, qrot, qaxis } = require('./lib/bvh');

const ROOT = path.join(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-humanoid-npc-v6', 'base');
const GLB_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6.glb');
const REPORT_FILE = path.join(REVIEW_DIR, 'npc_humanoid_base_unified_v6-report.json');

// Имя клипа ← файл CMU, отрезок ровного хода (с) и длина петли (с). mirror —
// отражение слева направо (исполнитель шёл в другую сторону).
const CLIPS = {
  // Осанка и руки — от шага (у исполнителя руки висят плетьми), грудь приподнята,
  // перенос стопы выше.
  strafe_left: { file: '69_42', from: 1.0, to: 4.0, period: [0.8, 1.6], posture: 'walk', postureArms: true, lift: 10, headUp: 26, swingLift: 2.2 },
  strafe_right: { file: '69_42', from: 1.0, to: 4.0, period: [0.8, 1.6], mirror: true, posture: 'walk', postureArms: true, lift: 10, headUp: 26, swingLift: 2.2 },
  // Быстрый боковой шаг приставным (баскетбольная защита): ноги и таз — CMU 06_09,
  // верх корпуса — из бокового шага.
  strafe_run_left: { file: '06_09', from: 0.2, to: 2.5, period: [0.4, 1.4], posture: 'walk', upper: 'strafe_left', lift: 10, headUp: 15, swingLift: 1.3 },
  strafe_run_right: { file: '06_09', from: 0.2, to: 2.5, period: [0.4, 1.4], mirror: true, posture: 'walk', upper: 'strafe_right', lift: 10, headUp: 15, swingLift: 1.3 },
  // Присед (136_09 — вперёд, 136_11 — назад и стойка на месте перед шагом): высота
  // таза у всех трёх одна, переход стойка ↔ шаг не прыгает.
  // Исполнитель крадётся сильно согнувшись; тактический присед держит грудь выше.
  crouch_walk: { file: '136_09', from: 3.0, to: 9.0, period: [0.8, 1.8], lift: 34, neckTuck: 12 },
  crouch_walk_back: { file: '136_11', from: 2.0, to: 9.0, period: [0.8, 1.8], lift: 34, neckTuck: 12 },
  crouch_idle: { file: '136_11', from: 0.1, to: 1.3, period: [0.8, 1.1], lift: 34, neckTuck: 12 },
  // Подбор с земли: подсед с наклоном, кисть у пола, подъём с предметом у груди
  // (глубокий присед на корточки у нашего скелета проваливается в сед).
  pickup: { file: '69_68', from: 2.2, to: 3.95, once: true, timeScale: 0.77 },
  // Сбор волокна: присед на согнутых коленях, рука перебирает у земли, взгляд на
  // руки (у клипа UAL был наклон на прямых ногах).
  harvest: { file: '139_06', from: 4.1, to: 6.7, period: [1.0, 2.3], groundEveryFrame: true, headUp: 10 }
};

// Клипы под другим именем: бег пригнувшись строится из бега (ниже таз, те же
// траектории стоп), бег спиной в приседе — прежний UAL; оба нужны на скоростях, до
// которых шаг в приседе не разгоняется.
const ALIASES = { crouch_run: 'run', crouch_run_back: 'crouch_walk_back' };
const RETIRED = ['sword_idle', 'sword_attack'];

// Клипы UAL, у которых после переноса стопы висят над землёй (наклон к земле,
// еда, ящик, работа на колене): таз в каждом кадре опускается до касания.
const GROUND = ['chest_open', 'consume', 'kneel_work'];

// Перекройка клипов UAL: scale — доля размаха кости вокруг её среднего поворота
// (меньше 1 — короче шаг и ниже колено), bounce — доля вертикального хода таза,
// lean — наклон поясницы вперёд, градусы. Ход назад UAL — «высокое колено»; у
// живого бегущего назад шаг короткий и низкий, корпус над носками.
const RESHAPE = {
  walk_back: { scale: { thigh_l: 0.65, thigh_r: 0.65, calf_l: 0.9, calf_r: 0.9 }, lean: -2, groundEveryFrame: true },
  // Смерть UAL: после касания спиной ноги взлетали, руки тянулись «как на пресс».
  // Руки с середины падения, а ноги и корпус к касанию уходят в итоговую позу
  // лёжа: тело без сознания не отпружинивает.
  // Стопы прижаты к полу всё падение и лёжа (legs.pinUntil): колени складываются,
  // тело оседает, а не падает доской с поднятыми ногами.
  death: { settle: { from: { arms: 99, legs: 0.95, trunk: 0.85 }, blend: 0.3, limpArms: 0.15 }, noGround: true, legs: { drop: 0, pinUntil: 99 } },
  // legs: таз выше/ниже (drop, м) и стопы шире (abduct, м) при тех же траекториях
  // стоп — ноги пересчитываются IK. Бег спиной UAL сидел в полуприседе с коленями
  // внутрь: таз выше, корпус прямее.
  run_back: { scale: { thigh_l: 0.55, thigh_r: 0.55, calf_l: 0.5, calf_r: 0.5, upperarm_l: 0.7, upperarm_r: 0.7 }, lean: -10, legs: { drop: -0.05, abduct: 0.04 } },
  // Бег пригнувшись — бег с тазом на 14 см ниже и корпусом на 22° вперёд.
  crouch_run: { lean: 22, legs: { drop: 0.14 } },
  // Подбор: на подъёме исполнитель прогибается назад — корпус к концу уходит в стойку.
  pickup: { settle: { from: { trunk: 0.9 }, blend: 0.35, target: 'idle' }, noGround: true }
};

// Наша кость ← сустав CMU и сустав, на который кость смотрит в T-позе.
const MAP = {
  pelvis: ['Hips'],
  spine_01: ['LowerBack', 'Spine'],
  spine_02: ['Spine', 'Spine1'],
  spine_03: ['Spine1', 'Neck1'],
  neck_01: ['Neck1', 'Head'],
  head: ['Head'],
  clavicle_l: ['LeftShoulder', 'LeftArm'],
  upperarm_l: ['LeftArm', 'LeftForeArm'],
  lowerarm_l: ['LeftForeArm', 'LeftHand'],
  hand_l: ['LeftHand', 'LeftHandIndex1'],
  clavicle_r: ['RightShoulder', 'RightArm'],
  upperarm_r: ['RightArm', 'RightForeArm'],
  lowerarm_r: ['RightForeArm', 'RightHand'],
  hand_r: ['RightHand', 'RightHandIndex1'],
  thigh_l: ['LeftUpLeg', 'LeftLeg'],
  calf_l: ['LeftLeg', 'LeftFoot'],
  foot_l: ['LeftFoot', 'LeftToeBase'],
  ball_l: ['LeftToeBase'],
  thigh_r: ['RightUpLeg', 'RightLeg'],
  calf_r: ['RightLeg', 'RightFoot'],
  foot_r: ['RightFoot', 'RightToeBase'],
  ball_r: ['RightToeBase']
};
// Кость, на которую смотрит наша кость в покое. Направление доворачивается только у
// конечностей: суставы позвоночника и ключиц у CMU стоят иначе (ключица CMU растёт из
// середины груди), их T-позы несравнимы — там переносится только разность с T-позой.
const OUR_CHILD = {
  upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', hand_l: 'middle_01_l',
  upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', hand_r: 'middle_01_r',
  thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l',
  thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r'
};
// Кости, по которым сравниваются позы при поиске петли.
const LOOP_BONES = ['Hips', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftArm', 'RightArm', 'Spine1'];
const FPS = 30;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const yawQ = rad => [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot4(a, b))));

function fromTo(a, b) {
  const na = scale(a, 1 / Math.hypot(...a));
  const nb = scale(b, 1 / Math.hypot(...b));
  const c = [na[1] * nb[2] - na[2] * nb[1], na[2] * nb[0] - na[0] * nb[2], na[0] * nb[1] - na[1] * nb[0]];
  const d = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
  if (d < -0.9999) return [1, 0, 0, 0];
  return qnorm([c[0], c[1], c[2], 1 + d]);
}

function slerp(a, b, t) {
  let d = dot4(a, b);
  const bb = d < 0 ? b.map(v => -v) : b;
  d = Math.abs(d);
  if (d > 0.9995) return qnorm(a.map((v, i) => v + (bb[i] - v) * t));
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin(th * (1 - t)) / s;
  const wb = Math.sin(th * t) / s;
  return qnorm(a.map((v, i) => v * wa + bb[i] * wb));
}

// Отражение позы CMU относительно плоскости YZ: левое ↔ правое.
function mirrorPose(world) {
  const out = new Map();
  for (const [name, value] of world) {
    const other = name.startsWith('Left') ? 'Right' + name.slice(4)
      : name.startsWith('Right') ? 'Left' + name.slice(5)
        : name === 'LHipJoint' ? 'RHipJoint' : name === 'RHipJoint' ? 'LHipJoint'
          : name === 'LThumb' ? 'RThumb' : name === 'RThumb' ? 'LThumb' : name;
    out.set(other, { r: [value.r[0], -value.r[1], -value.r[2], value.r[3]], p: [-value.p[0], value.p[1], value.p[2]] });
  }
  return out;
}

// Мировые повороты и позиции покоя нашего скелета (в осях npc_humanoid_root).
function ourRestWorld(json) {
  const parent = new Map();
  json.nodes.forEach((node, index) => (node.children || []).forEach(child => parent.set(child, index)));
  const rootIndex = json.nodes.findIndex(node => node.name === 'root');
  const world = new Map();
  const visit = (index, parentWorld) => {
    const node = json.nodes[index];
    const r = qnorm(qmul(parentWorld.r, node.rotation || [0, 0, 0, 1]));
    const p = add(parentWorld.p, qrot(parentWorld.r, node.translation || [0, 0, 0]));
    world.set(node.name, { r, p, index });
    (node.children || []).forEach(child => visit(child, { r, p }));
  };
  visit(rootIndex, { r: [0, 0, 0, 1], p: [0, 0, 0] });
  return { world, parent, rootIndex };
}

const POSTURE_BONES = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'];
const ARM_BONES = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r'];
const UPPER_BONES = ['spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'];

function meanRotation(list) {
  const sum = [0, 0, 0, 0];
  for (const q of list) {
    const sign = dot4(q, list[0]) < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) sum[i] += q[i] * sign;
  }
  return qnorm(sum);
}

function meanClipRotation(ours, clipName, boneName) {
  const clip = ours.json.animations.find(row => row.name === clipName);
  const node = ours.json.nodes.findIndex(row => row.name === boneName);
  const channel = clip.channels.find(row => row.target.node === node && row.target.path === 'rotation');
  return meanRotation(readAccessor(ours, clip.samplers[channel.sampler].output));
}

// Мировые позиции костей по локальным поворотам клипа (остальное — покой).
function forward(json, rest, localOf) {
  const world = new Map();
  const visit = (index, parentWorld) => {
    const node = json.nodes[index];
    const own = localOf(node.name);
    const r = qnorm(qmul(parentWorld.r, own ? own.r : node.rotation || [0, 0, 0, 1]));
    const p = add(parentWorld.p, qrot(parentWorld.r, own ? own.t : node.translation || [0, 0, 0]));
    world.set(node.name, { r, p });
    (node.children || []).forEach(child => visit(child, { r, p }));
  };
  visit(rest.rootIndex, { r: [0, 0, 0, 1], p: [0, 0, 0] });
  return world;
}

function sampleChannel(ours, sampler, t) {
  const times = readAccessor(ours, sampler.input).map(row => row[0]);
  const values = readAccessor(ours, sampler.output);
  if (t <= times[0] || times.length === 1) return values[0];
  let i = 1;
  while (i < times.length - 1 && times[i] < t) i++;
  if (t >= times[i]) return values[i];
  if (sampler.interpolation === 'STEP') return values[i - 1];
  const w = (t - times[i - 1]) / (times[i] - times[i - 1]);
  const a = values[i - 1], b = values[i];
  if (a.length === 4) return slerp(a, b, w);
  return a.map((v, k) => v + (b[k] - v) * w);
}

// Таз клипа опускается в каждом кадре так, чтобы нижняя точка стоп касалась земли.
// Поза клипа в момент t: локальные ключи костей и мировые позиции.
function clipWorldAt(ours, rest, clip, t) {
  const local = new Map();
  for (const row of clip.channels) {
    const bone = ours.json.nodes[row.target.node].name;
    if (!local.has(bone)) local.set(bone, {});
    local.get(bone)[row.target.path === 'rotation' ? 'r' : row.target.path === 'translation' ? 't' : 's'] = sampleChannel(ours, clip.samplers[row.sampler], t);
  }
  const world = forward(ours.json, rest, bone => {
    const own = local.get(bone);
    const node = ours.json.nodes[rest.world.has(bone) ? rest.world.get(bone).index : 0];
    return own && own.r ? { r: own.r, t: own.t || node.translation || [0, 0, 0] } : null;
  });
  return { local, world };
}

// Две кости: колено для бедра a и голени b так, чтобы лодыжка пришла в target,
// колено — в плоскости, заданной прежним коленом.
function solveKnee(hip, target, a, b, oldKnee) {
  const toTarget = sub(target, hip);
  let d = Math.hypot(...toTarget);
  const reach = Math.min(d, a + b - 1e-4);
  const dir = scale(toTarget, 1 / d);
  const pole0 = sub(oldKnee, hip);
  const along = dir[0] * pole0[0] + dir[1] * pole0[1] + dir[2] * pole0[2];
  let pole = sub(pole0, scale(dir, along));
  const poleLen = Math.hypot(...pole) || 1;
  pole = scale(pole, 1 / poleLen);
  const x = (a * a - b * b + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  return { knee: add(hip, add(scale(dir, x), scale(pole, h))), ankle: add(hip, scale(dir, reach)) };
}

function legClip(ours, rest, name, legs, addData) {
  const clip = ours.json.animations.find(row => row.name === name);
  if (clip.extras && clip.extras.legs) return `${name}: legs already set`;
  const pelvisIndex = rest.world.get('pelvis').index;
  const channel = bone => pathName => clip.channels.find(row =>
    ours.json.nodes[row.target.node].name === bone && row.target.path === pathName);
  const times = readAccessor(ours, clip.samplers[channel('pelvis')('rotation').sampler].input).map(v => v[0]);
  const rootUp = qrot(qinv(rest.world.get('root').r), [0, 1, 0]);
  const out = { pelvis: [], thigh_l: [], calf_l: [], foot_l: [], thigh_r: [], calf_r: [], foot_r: [] };
  // Просадка по фазе: в полёте и касании — полная, в середине опоры (таз и так
  // внизу) — половина, иначе колено складывается до «на коленях».
  const heights = times.map(t => clipWorldAt(ours, rest, clip, t).world.get('pelvis').p[1]);
  const low = Math.min(...heights), high = Math.max(...heights);
  for (const [key, t] of times.entries()) {
    const { local, world } = clipWorldAt(ours, rest, clip, t);
    const drop = legs.drop * (legs.drop > 0 && high > low ? 0.5 + 0.5 * (heights[key] - low) / (high - low) : 1);
    const pelvisT = local.get('pelvis').t.map((v, i) => v - rootUp[i] * drop);
    out.pelvis.push(pelvisT);
    // Мир после сдвига таза: всё ниже таза сдвигается на drop вниз.
    const down = [0, -drop, 0];
    const pelvisWorld = world.get('pelvis');
    for (const side of ['l', 'r']) {
      const thighW = world.get('thigh_' + side), calfW = world.get('calf_' + side), footW = world.get('foot_' + side);
      const hip = add(thighW.p, down);
      const outward = [side === 'l' ? 1 : -1, 0, 0];
      let target = add(footW.p, scale(outward, legs.abduct || 0));
      // Стопа прижата к полу до pinUntil (с плавным отпусканием за 0.2 с).
      if (legs.pinUntil !== undefined) {
        const pin = Math.min(1, Math.max(0, (legs.pinUntil - t) / 0.2));
        const floor = rest.world.get('foot_' + side).p[1];
        if (target[1] > floor) target = [target[0], target[1] + (floor - target[1]) * pin, target[2]];
      }
      const a = Math.hypot(...sub(calfW.p, thighW.p)), b = Math.hypot(...sub(footW.p, calfW.p));
      const solved = solveKnee(hip, target, a, b, add(calfW.p, down));
      const thighNew = qnorm(qmul(fromTo(sub(calfW.p, thighW.p), sub(solved.knee, hip)), thighW.r));
      // Голень: после поворота бедра — к новой лодыжке.
      const calfAfter = qnorm(qmul(qmul(thighNew, qinv(thighW.r)), calfW.r));
      const shinDir = qrot(qmul(calfAfter, qinv(calfW.r)), sub(footW.p, calfW.p));
      const calfNew = qnorm(qmul(fromTo(shinDir, sub(solved.ankle, solved.knee)), calfAfter));
      out['thigh_' + side].push(qnorm(qmul(qinv(pelvisWorld.r), thighNew)));
      out['calf_' + side].push(qnorm(qmul(qinv(thighNew), calfNew)));
      // Стопа сохраняет мировой поворот.
      out['foot_' + side].push(qnorm(qmul(qinv(calfNew), footW.r)));
    }
  }
  const input = addData(times.map(t => [t]), 'SCALAR', true);
  for (const [bone, values] of Object.entries(out)) {
    const row = channel(bone)(bone === 'pelvis' ? 'translation' : 'rotation');
    for (let i = 1; i < values.length; i++) if (values[i].length === 4 && dot4(values[i], values[i - 1]) < 0) values[i] = values[i].map(v => -v);
    clip.samplers.push({ input, output: addData(values, bone === 'pelvis' ? 'VEC3' : 'VEC4'), interpolation: 'LINEAR' });
    row.sampler = clip.samplers.length - 1;
  }
  clip.extras = { ...(clip.extras || {}), legs: true };
  return `${name}: legs re-solved (pelvis ${legs.drop > 0 ? 'down' : 'up'} ${Math.abs(legs.drop * 100).toFixed(0)} cm${legs.pinUntil !== undefined ? ', feet pinned' : ''})`;
}

function reshapeClip(ours, rest, name, spec, addData) {
  const clip = ours.json.animations.find(row => row.name === name);
  // Уже перекроен (повторный прогон) — второй раз не сжимается.
  if (clip.extras && clip.extras.reshaped) return `${name}: already reshaped`;
  const channel = (bone, pathName) => clip.channels.find(row =>
    ours.json.nodes[row.target.node].name === bone && row.target.path === pathName);
  const rewrite = (row, values, type) => {
    const sampler = clip.samplers[row.sampler];
    clip.samplers.push({ input: sampler.input, output: addData(values, type), interpolation: sampler.interpolation });
    row.sampler = clip.samplers.length - 1;
  };
  // Кость ноги сжимается вокруг опорной позы (стопа своей стороны ниже всего):
  // опора остаётся на земле, укорачивается замах. Остальные — вокруг среднего.
  // Опорные позы снимаются до правок: правка кости меняет позу клипа.
  const pivots = new Map();
  for (const bone of Object.keys(spec.scale || {})) {
    const side = bone.endsWith('_l') ? 'l' : bone.endsWith('_r') ? 'r' : null;
    if (!side || !/^(thigh|calf|foot)/.test(bone)) continue;
    const sampler = clip.samplers[channel(bone, 'rotation').sampler];
    const times = readAccessor(ours, sampler.input).map(v => v[0]);
    let best = 0, lowest = Infinity;
    times.forEach((t, key) => {
      const { world } = clipWorldAt(ours, rest, clip, t);
      const low = Math.min(world.get('foot_' + side).p[1], world.get('ball_' + side).p[1]);
      if (low < lowest) { lowest = low; best = key; }
    });
    pivots.set(bone, readAccessor(ours, sampler.output)[best]);
  }
  for (const [bone, k] of Object.entries(spec.scale || {})) {
    const row = channel(bone, 'rotation');
    const values = readAccessor(ours, clip.samplers[row.sampler].output);
    const mean = pivots.get(bone) || meanRotation(values);
    rewrite(row, values.map(q => {
      const aligned = dot4(q, mean) < 0 ? q.map(v => -v) : q;
      return qnorm(qmul(mean, slerp([0, 0, 0, 1], qmul(qinv(mean), aligned), k)));
    }), 'VEC4');
  }
  if (spec.bounce !== undefined) {
    const row = channel('pelvis', 'translation');
    const values = readAccessor(ours, clip.samplers[row.sampler].output);
    // В осях root высота — Z.
    const mean = values.reduce((sum, v) => sum + v[2], 0) / values.length;
    rewrite(row, values.map(v => [v[0], v[1], mean + (v[2] - mean) * spec.bounce]), 'VEC3');
  }
  if (spec.settle) {
    const groups = {
      arms: ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'],
      legs: ['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'],
      trunk: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head']
    };
    for (const [group, from] of Object.entries(spec.settle.from)) {
      for (const bone of groups[group]) {
        const row = channel(bone, 'rotation');
        const sampler = clip.samplers[row.sampler];
        const times = readAccessor(ours, sampler.input).map(v => v[0]);
        const values = readAccessor(ours, sampler.output);
        // Цель — последняя поза клипа или средняя поза другого (settle.target).
        const final = spec.settle.target ? meanClipRotation(ours, spec.settle.target, bone) : values[values.length - 1];
        // Обмякшие руки: с подкоса коленей висят как в стойке (без взмаха в стороны),
        // к касанию земли ложатся в позу лёжа.
        const limp = group === 'arms' && spec.settle.limpArms !== undefined ? meanClipRotation(ours, 'idle', bone) : null;
        const limpFrom = spec.settle.limpArms;
        const ramp = (t, start) => { const w = Math.min(1, Math.max(0, (t - start) / spec.settle.blend)); return w * w * (3 - 2 * w); };
        rewrite(row, values.map((q, key) => {
          const hung = limp ? slerp(q, limp, ramp(times[key], limpFrom)) : q;
          return slerp(hung, final, ramp(times[key], from));
        }), 'VEC4');
      }
    }
  }
  if (spec.lean) {
    const row = channel('spine_01', 'rotation');
    const values = readAccessor(ours, clip.samplers[row.sampler].output);
    const lean = qaxis([1, 0, 0], spec.lean);
    rewrite(row, values.map(q => qnorm(qmul(q, lean))), 'VEC4');
  }
  clip.extras = { ...(clip.extras || {}), reshaped: true };
  return `${name}: reshaped`;
}

function groundClip(ours, rest, name, addData, perFrame = true) {
  const clip = ours.json.animations.find(row => row.name === name);
  const pelvisIndex = rest.world.get('pelvis').index;
  const channel = (node, pathName) => clip.channels.find(row => row.target.node === node && row.target.path === pathName);
  const timing = clip.samplers[channel(pelvisIndex, 'rotation').sampler];
  const times = readAccessor(ours, timing.input).map(row => row[0]);
  const translation = channel(pelvisIndex, 'translation');
  const rootUp = qrot(qinv(rest.world.get('root').r), [0, 1, 0]);
  let most = 0;
  const values = times.map(t => {
    const { local, world } = clipWorldAt(ours, rest, clip, t);
    let low = Infinity;
    for (const side of ['l', 'r']) {
      low = Math.min(low,
        world.get('foot_' + side).p[1] - rest.world.get('foot_' + side).p[1],
        world.get('ball_' + side).p[1] - rest.world.get('ball_' + side).p[1]);
    }
    if (Math.abs(low) > Math.abs(most)) most = low;
    return { t: local.get('pelvis').t, low };
  });
  // Петля с полётом (бег) садится одним сдвигом: в полёте стопы и должны быть в воздухе.
  const lowest = Math.min(...values.map(row => row.low));
  if (!perFrame) most = lowest;
  const pelvisT = values.map(row => row.t.map((v, i) => v - rootUp[i] * (perFrame ? row.low : lowest)));
  // Уже на земле (повторный прогон) — файл не трогается.
  if (Math.abs(most) < 0.0005) return `${name}: already grounded`;
  clip.samplers.push({ input: addData(times.map(t => [t]), 'SCALAR', true), output: addData(pelvisT, 'VEC3'), interpolation: 'LINEAR' });
  translation.sampler = clip.samplers.length - 1;
  return `${name}: grounded per frame, largest correction ${(most * 100).toFixed(1)} cm`;
}

function hipsYaw(frame) {
  const f = qrot(frame.get('Hips').r, [0, 0, 1]);
  return Math.atan2(f[0], f[2]);
}

function importClip(name, spec, dir, ours, rest, done) {
  const bvh = parseBvh(path.join(dir, spec.file + '.bvh'));
  const hz = 1 / bvh.frameTime;
  const read = f => (spec.mirror ? mirrorPose(pose(bvh, f)) : pose(bvh, f));
  const ref = read(0);
  if (angle(ref.get('Hips').r, [0, 0, 0, 1]) > 0.05) throw new Error(`${spec.file}: frame 0 is not the T-pose`);

  const first = Math.round(spec.from * hz);
  const last = Math.min(bvh.frames.length - 1, Math.round(spec.to * hz));
  const frames = [];
  for (let f = first; f <= last; f++) frames.push(read(f));

  // Петля: пара кадров с самой похожей позой (без курса) и скоростью.
  const relative = frame => {
    const unyaw = yawQ(-hipsYaw(frame));
    return LOOP_BONES.map(bone => qmul(unyaw, frame.get(bone).r));
  };
  const rel = frames.map(relative);
  const lag = Math.round(hz / 15);
  const cost = (i, j) => {
    let sum = 0;
    for (let b = 0; b < LOOP_BONES.length; b++) {
      sum += angle(rel[i][b], rel[j][b]);
      sum += angle(rel[i + lag][b], rel[j + lag][b]);
    }
    return sum + Math.abs(frames[i].get('Hips').p[1] - frames[j].get('Hips').p[1]) * 0.2;
  };
  // Разовое действие (spec.once) — весь отрезок как есть, без петли.
  let best = spec.once ? { i: 0, j: frames.length - 1, cost: 0 } : null;
  const minPeriod = spec.once ? Infinity : Math.round(spec.period[0] * hz);
  const maxPeriod = spec.once ? 0 : Math.round(spec.period[1] * hz);
  for (let i = 0; i + minPeriod + lag < frames.length; i++) {
    for (let j = i + minPeriod; j <= Math.min(i + maxPeriod, frames.length - 1 - lag); j++) {
      const c = cost(i, j);
      if (!best || c < best.cost) best = { i, j, cost: c };
    }
  }
  if (!best) throw new Error(`${name}: the segment is shorter than one loop`);

  // Средний курс и ход по земле за петлю.
  let sx = 0, sz = 0;
  for (let f = best.i; f <= best.j; f++) { const y = hipsYaw(frames[f]); sx += Math.sin(y); sz += Math.cos(y); }
  const heading = Math.atan2(sx, sz);
  const H = yawQ(-heading);
  const period = (best.j - best.i) / hz;
  const hipsStart = frames[best.i].get('Hips').p;
  const travel = spec.once ? [0, 0, 0] : qrot(H, sub(frames[best.j].get('Hips').p, hipsStart));

  // Масштаб: высота таза над стопами в T-позе.
  const ourPelvis = rest.world.get('pelvis');
  const ourLeg = ourPelvis.p[1] - (rest.world.get('foot_l').p[1] + rest.world.get('foot_r').p[1]) / 2;
  const cmuLeg = ref.get('Hips').p[1] - (ref.get('LeftFoot').p[1] + ref.get('RightFoot').p[1]) / 2;
  const k = ourLeg / cmuLeg;

  // Доворот направления каждой кости CMU в T-позе на направление нашей кости.
  const correction = {};
  for (const [bone, [joint, child]] of Object.entries(MAP)) {
    if (!child || !OUR_CHILD[bone]) { correction[bone] = [0, 0, 0, 1]; continue; }
    const cmuDir = sub(ref.get(child).p, ref.get(joint).p);
    const ourDir = sub(rest.world.get(OUR_CHILD[bone]).p, rest.world.get(bone).p);
    correction[bone] = qinv(fromTo(cmuDir, ourDir));
  }

  // Кадры 30 к/с: мировые повороты наших костей → локальные.
  const count = Math.max(2, Math.round(period * FPS));
  const sample = (t, joint) => {
    const x = best.i + t * hz;
    const a = Math.floor(x), w = x - a;
    const b = Math.min(a + 1, frames.length - 1);
    const qa = frames[a].get(joint).r, qb = frames[b].get(joint).r;
    const pa = frames[a].get(joint).p, pb = frames[b].get(joint).p;
    return { r: slerp(qa, qb, w), p: add(pa, scale(sub(pb, pa), w)) };
  };
  const tracks = new Map(Object.keys(MAP).map(bone => [bone, { r: [], t: [] }]));
  const order = [...rest.world.keys()].filter(bone => MAP[bone]);
  // Выпрямление груди (spec.lift, градусы): поясница и грудной отдел отклоняются
  // назад, шея и голова возвращают взгляд. Доля копится вниз по цепи.
  const liftShare = new Map();
  if (spec.lift || spec.headUp || spec.neckTuck) {
    const own = { spine_01: 0.3, spine_02: 0.35, spine_03: 0.35, neck_01: -0.5, head: -0.5 };
    for (const bone of order) {
      let share = 0;
      for (let at = rest.world.get(bone).index; at !== undefined; at = rest.parent.get(at)) share += own[ours.json.nodes[at].name] || 0;
      liftShare.set(bone, share);
    }
  }
  // Голова выше (spec.headUp, градусы): шея и голова поровну, взгляд не в пол.
  const headShare = new Map(order.map(bone => [bone, bone === 'neck_01' ? 0.5 : bone === 'head' ? 1 : 0]));
  // Шея назад (spec.neckTuck, градусы), голова держит взгляд: не «гриф» с шеей вперёд.
  const tuckShare = new Map(order.map(bone => [bone, bone === 'neck_01' ? 1 : 0]));
  for (let key = 0; key <= count; key++) {
    const t = key * period / count;
    const world = new Map();
    for (const bone of order) {
      const [joint] = MAP[bone];
      const s = sample(t, joint);
      const delta = qmul(s.r, qinv(ref.get(joint).r));
      let q = qnorm(qmul(H, qmul(delta, qmul(correction[bone], rest.world.get(bone).r))));
      if (spec.lift || spec.headUp || spec.neckTuck) q = qnorm(qmul(qaxis([1, 0, 0], -(spec.lift || 0) * liftShare.get(bone)
        - (spec.headUp || 0) * headShare.get(bone) - (spec.neckTuck || 0) * tuckShare.get(bone)), q));
      world.set(bone, q);
    }
    for (const bone of order) {
      const node = ours.json.nodes[rest.world.get(bone).index];
      const parentName = ours.json.nodes[rest.parent.get(rest.world.get(bone).index)].name;
      const parentWorld = world.get(parentName) || rest.world.get(parentName).r;
      tracks.get(bone).r.push(qnorm(qmul(qinv(parentWorld), world.get(bone))));
      if (bone === 'pelvis') {
        const hips = sample(t, 'Hips').p;
        const moved = qrot(H, sub(hips, hipsStart));
        const along = sub(moved, scale(travel, t / period));
        const offset = [along[0] * k, (hips[1] - ref.get('Hips').p[1]) * k, along[2] * k];
        const rootWorld = rest.world.get('root');
        const local = qrot(qinv(rootWorld.r), add(sub(ourPelvis.p, rootWorld.p), offset));
        tracks.get(bone).t.push(local);
      } else {
        tracks.get(bone).t.push(node.translation || [0, 0, 0]);
      }
    }
  }
  // Горизонтальный ход таза — вокруг нуля; петля замыкается разносом остатка.
  const pelvisT = tracks.get('pelvis').t;
  // Разовое действие начинается с места стойки: вычитается первый кадр.
  const mean = spec.once ? pelvisT[0].slice()
    : pelvisT.slice(0, count).reduce((m, v) => add(m, scale(v, 1 / count)), [0, 0, 0]);
  const restLocal = ours.json.nodes[ourPelvis.index].translation;
  for (let key = 0; key <= count; key++) {
    const v = pelvisT[key];
    // В осях root (Z вверх): X/Y — земля, Z — высота.
    pelvisT[key] = [v[0] - mean[0] + restLocal[0], v[1] - mean[1] + restLocal[1], v[2]];
  }
  for (const [, track] of spec.once ? [] : tracks) {
    const q0 = track.r[0], qn = track.r[count];
    const fix = qmul(qinv(qn), q0);
    const t0 = track.t[0], tn = track.t[count];
    for (let key = 0; key <= count; key++) {
      const w = key / count;
      track.r[key] = qnorm(qmul(track.r[key], slerp([0, 0, 0, 1], fix, w)));
      track.t[key] = add(track.t[key], scale(sub(t0, tn), w));
      if (key && dot4(track.r[key], track.r[key - 1]) < 0) track.r[key] = track.r[key].map(v => -v);
    }
  }
  // Верх корпуса из другого клипа (spec.upper) по той же фазе петли: у исполнителя
  // руки заняты (ведёт мяч), ноги и таз — свои.
  if (spec.upper) {
    const source = done.get(spec.upper);
    for (const bone of UPPER_BONES) {
      const from = source.tracks.get(bone).r;
      tracks.get(bone).r = [...Array(count + 1).keys()].map(key => {
        const x = key / count * source.count;
        const a = Math.floor(x);
        return slerp(from[a], from[Math.min(a + 1, source.count)], x - a);
      });
    }
  }
  // Осанка — от нашего клипа (spec.posture): средний поворот позвоночника, шеи и
  // головы берётся из него, от CMU остаются только колебания вокруг среднего.
  // Исполнители CMU часто смотрят под ноги и сутулятся.
  if (spec.posture) {
    for (const bone of spec.postureArms ? POSTURE_BONES.concat(ARM_BONES) : POSTURE_BONES) {
      const track = tracks.get(bone);
      const target = meanClipRotation(ours, spec.posture, bone);
      const fix = qmul(target, qinv(meanRotation(track.r.slice(0, count))));
      track.r = track.r.map(q => qnorm(qmul(fix, q)));
    }
  }
  // Выше шаг (spec.swingLift): колено в переносе сгибается сильнее, опора та же —
  // голень сжимается от опорной позы своей стороны. У исполнителя боковой шаг
  // почти волочит стопы (1–4 см над полом).
  if (spec.swingLift) {
    for (const side of ['l', 'r']) {
      let stance = 0, lowest = Infinity;
      for (let key = 0; key < count; key++) {
        const world = forward(ours.json, rest, bone => tracks.get(bone) && { r: tracks.get(bone).r[key], t: tracks.get(bone).t[key] });
        const low = Math.min(world.get('foot_' + side).p[1], world.get('ball_' + side).p[1]);
        if (low < lowest) { lowest = low; stance = key; }
      }
      const track = tracks.get('calf_' + side);
      const pivot = track.r[stance];
      track.r = track.r.map(q => {
        const aligned = dot4(q, pivot) < 0 ? q.map(v => -v) : q;
        return qnorm(qmul(pivot, slerp([0, 0, 0, 1], qmul(qinv(pivot), aligned), spec.swingLift)));
      });
    }
  }
  // Стопы на земле: самая низкая точка стопы или носка — как в покое. У петли
  // сдвиг один на всю петлю (шаг отрывает обе стопы только в полёте бега); у
  // разового действия — в каждом кадре: ноги другого скелета в глубоком приседе
  // поднимают стопы иначе, чем у исполнителя.
  const lows = [];
  for (let key = 0; key <= count; key++) {
    const world = forward(ours.json, rest, bone => tracks.get(bone) && { r: tracks.get(bone).r[key], t: tracks.get(bone).t[key] });
    let low = Infinity;
    for (const side of ['l', 'r']) {
      low = Math.min(low,
        world.get('foot_' + side).p[1] - rest.world.get('foot_' + side).p[1],
        world.get('ball_' + side).p[1] - rest.world.get('ball_' + side).p[1]);
    }
    lows.push(low);
  }
  const lowest = Math.min(...lows);
  const rootUp = qrot(qinv(rest.world.get('root').r), [0, 1, 0]);
  tracks.get('pelvis').t.forEach((v, key) => {
    const drop = spec.once || spec.groundEveryFrame ? lows[key] : lowest;
    for (let i = 0; i < 3; i++) v[i] -= rootUp[i] * drop;
  });
  const speed = Math.hypot(travel[0], travel[2]) * k / period;
  const dirDeg = Math.atan2(travel[0], travel[2]) * 180 / Math.PI;
  return { name, tracks, count, period, speed, dirDeg, loopCost: best.cost, heading: heading * 180 / Math.PI, k, lowest };
}

function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) throw new Error('usage: node tools/import-cmu-clips.js <cmu bvh dir>');
  const ours = parseGlb(GLB_FILE);
  const rest = ourRestWorld(ours.json);
  const idle = ours.json.animations.find(row => row.name === 'idle');
  const bones = [...new Set(idle.channels.map(channel => channel.target.node))];

  const chunks = [ours.bin];
  let offset = ours.bin.length;
  const addData = (values, type, withRange) => {
    const data = Buffer.from(Float32Array.from(values.flat()).buffer);
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

  // Клипы, которые игра не играет и критик отклонил (фэнтезийный меч).
  ours.json.animations = ours.json.animations.filter(row => !RETIRED.includes(row.name));
  for (const [alias, name] of Object.entries(ALIASES)) {
    if (ours.json.animations.some(row => row.name === alias)) continue;
    const source = ours.json.animations.find(row => row.name === name);
    ours.json.animations.push({ ...JSON.parse(JSON.stringify(source)), name: alias });
  }

  const lines = [];
  const done = new Map();
  for (const [name, spec] of Object.entries(CLIPS)) {
    const clip = importClip(name, spec, dir, ours, rest, done);
    done.set(name, clip);
    ours.json.animations = ours.json.animations.filter(item => item.name !== name);
    // timeScale > 1 — клип медленнее исходника.
    const length = clip.period * (spec.timeScale || 1);
    const times = [...Array(clip.count + 1).keys()].map(key => [key * length / clip.count]);
    const timeAccessor = addData(times, 'SCALAR', true);
    const constantTimes = addData([[0], [length]], 'SCALAR', true);
    const animation = { name, channels: [], samplers: [] };
    const put = (node, pathName, input, output, interpolation) => {
      animation.samplers.push({ input, output, interpolation });
      animation.channels.push({ sampler: animation.samplers.length - 1, target: { node, path: pathName } });
    };
    for (const node of bones) {
      const ourNode = ours.json.nodes[node];
      const track = clip.tracks.get(ourNode.name);
      const r = ourNode.rotation || [0, 0, 0, 1];
      const t = ourNode.translation || [0, 0, 0];
      const s = ourNode.scale || [1, 1, 1];
      if (track) put(node, 'rotation', timeAccessor, addData(track.r, 'VEC4'), 'LINEAR');
      else put(node, 'rotation', constantTimes, addData([r, r], 'VEC4'), 'STEP');
      if (track && ourNode.name === 'pelvis') put(node, 'translation', timeAccessor, addData(track.t, 'VEC3'), 'LINEAR');
      else put(node, 'translation', constantTimes, addData([t, t], 'VEC3'), 'STEP');
      put(node, 'scale', constantTimes, addData([s, s], 'VEC3'), 'STEP');
    }
    ours.json.animations.push(animation);
    lines.push(`${name}: CMU ${spec.file}${spec.mirror ? ' mirrored' : ''}, loop ${clip.period.toFixed(3)} s (cost ${clip.loopCost.toFixed(2)}), `
      + `speed ${clip.speed.toFixed(2)} m/s toward ${clip.dirDeg.toFixed(0)}°, heading ${clip.heading.toFixed(0)}°, scale ${clip.k.toFixed(4)}, grounded ${(clip.lowest * 100).toFixed(1)} cm`);
  }

  // Перекройка и посадка — после импорта CMU: часть правит клипы CMU (подбор).
  // Новые данные читаются обратно (посадка перекроенного клипа): буфер собирается заново.
  const flush = () => { ours.bin = Buffer.concat(chunks); chunks.splice(0, chunks.length, ours.bin); };
  for (const [name, spec] of Object.entries(RESHAPE)) {
    lines.push(reshapeClip(ours, rest, name, spec, addData));
    flush();
    if (spec.legs) {
      lines.push(legClip(ours, rest, name, spec.legs, addData));
      flush();
    }
    // Лёжа нижняя точка — спина, не стопы: смерть сажает на землю рантайм.
    if (!spec.noGround) lines.push(groundClip(ours, rest, name, addData, !!spec.groundEveryFrame));
  }
  flush();
  for (const name of GROUND) lines.push(groundClip(ours, rest, name, addData));
  const bin = compactGlb(ours.json, Buffer.concat(chunks));
  writeGlb(GLB_FILE, ours.json, bin);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(GLB_FILE)).digest('hex').toUpperCase();
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  report.sha256 = sha;
  report.animations = ours.json.animations.map(row => row.name);
  report.cmuImport = {
    source: 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by Bruce Hahne',
    clips: Object.fromEntries(Object.entries(CLIPS).map(([name, spec]) => [name, spec.file + (spec.mirror ? ' mirrored' : '')])),
    aliases: ALIASES
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
  console.log(`CMU clips imported into ${path.relative(ROOT, GLB_FILE)} (sha ${sha})`);
  console.log(lines.join('\n'));
}

main();
