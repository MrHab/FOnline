'use strict';
// Синхронизация клипов локомоции с рантаймом.
//
// Рантайм подгоняет темп клипа под скорость актёра по таблице «натуральных»
// скоростей (CHARACTER_CLIP_NATURAL_SPEEDS в 04b): сколько земли клип покрывает
// при единичном темпе. Если пин расходится с клипом, опорная стопа скользит —
// именно так и появлялись «глючащие ноги». Здесь скорость меряется прямо по
// GLB и сверяется с пином.
//
// Дополнительно проверяется механика: у здорового клипа ходьбы травел за цикл
// заметно больше размаха одной стопы (опорная нога метёт монотонно, а
// разворачивается в воздухе). Клип, нарисованный так, что нога разворачивается
// стоя на земле, даёт низкое отношение и гасит travel сам себя.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILE = path.join(ROOT, 'public', 'assets', 'models', 'characters', 'npc', 'npc_humanoid_animations.glb');
const CHARACTER_FILE = path.join(ROOT, 'public', 'assets', 'models', 'characters', 'base', 'character_male_medium.glb');
const RUNTIME_SOURCE = path.join(ROOT, 'public', 'js', 'game', '04b_character_glb_runtime.js');
const UNITY_CHARACTER_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterView.cs');

// Скорости, на которых рантайм реально играет эти клипы (скорость игрока 4.2,
// порог бега 3.4, присед 0.62 от базовой). Темп = скорость / натуральная.
const CLIP_USAGE = {
  walk: { speed: 2.0, direction: 1 },
  run: { speed: 4.2, direction: 1 },
  walk_back: { speed: 2.0, direction: -1 },
  run_back: { speed: 4.2, direction: -1 },
  crouch_walk: { speed: 2.6, direction: 1 },
  crouch_walk_back: { speed: 2.6, direction: -1 }
};
const MAX_PIN_ERROR = 0.12;      // допуск пина к замеру
const MAX_TEMPO = 1.8;           // темп выше — клип выглядит суетливым
const MIN_TEMPO = 0.55;
const MIN_TRAVEL_RATIO = 1.25;   // травел за цикл / размах одной стопы
const MAX_LOOP_GAP = 0.006;      // замкнутость петли, м
const FAST_PHASE_OFFSET = -1 / 6;  // run/crouch опережают walk по контакту стоп
const MAX_PHASE_HEIGHT_RMS = 0.10;
const MAX_PHASE_STANCE_MISMATCH = 0.15;

function readPins() {
  const source = fs.readFileSync(RUNTIME_SOURCE, 'utf8');
  const block = source.match(/CHARACTER_CLIP_NATURAL_SPEEDS = Object\.freeze\(\{([\s\S]*?)\}\)/);
  assert(block, '04b: не найдена таблица CHARACTER_CLIP_NATURAL_SPEEDS');
  const pins = {};
  for (const row of block[1].matchAll(/(\w+):\s*([0-9.]+)/g)) pins[row[1]] = Number(row[2]);
  return pins;
}

async function main() {
  global.ProgressEvent = global.ProgressEvent || class ProgressEvent {};
  global.self = global.self || global;
  global.createImageBitmap = global.createImageBitmap || (async () => ({ width: 1, height: 1, close() {} }));
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const load = (file) => {
    const data = fs.readFileSync(file);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  };

  const pins = readPins();
  const unityCharacterSource = fs.readFileSync(UNITY_CHARACTER_SOURCE, 'utf8');
  assert(
    unityCharacterSource.includes('FastGaitPhaseOffset = -1f / 6f')
      && unityCharacterSource.includes('SyncedLocomotionPhase(previous, clip')
      && unityCharacterSource.includes('LocomotionPhaseOffset(nextClip)')
      && unityCharacterSource.includes('- LocomotionPhaseOffset(previousClip)'),
    'Unity runtime no longer compensates the measured slow/fast gait phase offset'
  );
  const character = await load(CHARACTER_FILE);
  const donor = await load(RUNTIME_FILE);
  const clips = new Map();
  for (const clip of character.animations || []) clips.set(clip.name, clip);
  for (const clip of donor.animations || []) if (!clips.has(clip.name)) clips.set(clip.name, clip);

  const root = character.scene;
  const mixer = new THREE.AnimationMixer(root);
  const footL = root.getObjectByName('foot_l');
  const footR = root.getObjectByName('foot_r');
  const pelvis = root.getObjectByName('pelvis');
  assert(footL && footR && pelvis, 'в базовой модели нет костей стоп или таза');

  const reported = [];
  const phaseProfiles = new Map();
  for (const [name, usage] of Object.entries(CLIP_USAGE)) {
    const clip = clips.get(name);
    assert(clip, `клип локомоции отсутствует: ${name}`);
    assert(pins[name] !== undefined, `04b: нет пина натуральной скорости для ${name}`);

    mixer.stopAllAction();
    const action = mixer.clipAction(clip, root);
    action.reset();
    action.play();

    const N = 240;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      mixer.setTime(clip.duration * i / N);
      root.updateMatrixWorld(true);
      samples.push({
        l: footL.getWorldPosition(new THREE.Vector3()),
        r: footR.getWorldPosition(new THREE.Vector3()),
        p: pelvis.getWorldPosition(new THREE.Vector3())
      });
    }

    phaseProfiles.set(name, samples.map(sample => sample.l.y - sample.r.y));

    // Травел: перемещение опорной стопы (той, что ниже) назад по Z.
    let travel = 0;
    for (let i = 1; i <= N; i++) {
      const prev = samples[i - 1];
      const cur = samples[i];
      const side = (prev.l.y + cur.l.y) <= (prev.r.y + cur.r.y) ? 'l' : 'r';
      travel += -(cur[side].z - prev[side].z);
    }
    const measured = travel / clip.duration;
    const pin = pins[name];

    let sweep = 0;
    for (const side of ['l', 'r']) {
      let min = Infinity;
      let max = -Infinity;
      for (const sample of samples) {
        const z = sample[side].z - sample.p.z;
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
      sweep = Math.max(sweep, max - min);
    }
    const loopGap = Math.max(
      samples[0].l.distanceTo(samples[N].l),
      samples[0].r.distanceTo(samples[N].r)
    );

    // Направление: клипы заднего хода обязаны ехать назад.
    assert(
      Math.sign(measured) === usage.direction,
      `${name}: клип едет не в ту сторону (замер ${measured.toFixed(2)} м/с, ожидалось направление ${usage.direction})`
    );
    const magnitude = Math.abs(measured);
    const pinError = Math.abs(magnitude - pin) / pin;
    assert(
      pinError <= MAX_PIN_ERROR,
      `${name}: пин натуральной скорости ${pin} расходится с клипом ${magnitude.toFixed(2)} м/с `
      + `на ${(pinError * 100).toFixed(0)}% — stride-sync даст скольжение стоп`
    );
    const tempo = usage.speed / pin;
    assert(
      tempo >= MIN_TEMPO && tempo <= MAX_TEMPO,
      `${name}: рантайм играет клип с темпом ${tempo.toFixed(2)} на скорости ${usage.speed} м/с `
      + `(допустимо ${MIN_TEMPO}..${MAX_TEMPO})`
    );
    const travelRatio = Math.abs(travel) / sweep;
    assert(
      travelRatio >= MIN_TRAVEL_RATIO,
      `${name}: травел за цикл (${Math.abs(travel).toFixed(2)} м) слишком мал против размаха стопы `
      + `(${sweep.toFixed(2)} м) — опорная нога разворачивается, стоя на земле`
    );
    assert(
      loopGap <= MAX_LOOP_GAP,
      `${name}: петля не замкнута, разрыв ${(loopGap * 1000).toFixed(1)} мм`
    );
    reported.push(`${name} ${magnitude.toFixed(2)}м/с темп ${tempo.toFixed(2)}`);
  }

  const phaseReports = [];
  for (const [slow, fast] of [
    ['walk', 'run'],
    ['walk', 'crouch_walk'],
    ['walk_back', 'run_back'],
    ['walk_back', 'crouch_walk_back']
  ]) {
    const source = phaseProfiles.get(slow);
    const target = phaseProfiles.get(fast);
    assert(source?.length === target?.length && source.length > 0,
      `${slow}/${fast}: нет профиля высоты стоп`);
    const count = source.length;
    const offsetSteps = Math.round(FAST_PHASE_OFFSET * count);
    let wrong = 0;
    let corrected = 0;
    let wrongSquare = 0;
    let correctedSquare = 0;
    for (let i = 0; i < count; i += 1) {
      const shifted = (i + offsetSteps + count) % count;
      const wrongDelta = source[i] - target[i];
      const correctedDelta = source[i] - target[shifted];
      wrongSquare += wrongDelta * wrongDelta;
      correctedSquare += correctedDelta * correctedDelta;
      if ((source[i] <= 0) !== (target[i] <= 0)) wrong += 1;
      if ((source[i] <= 0) !== (target[shifted] <= 0)) corrected += 1;
    }
    wrong /= count;
    corrected /= count;
    const wrongRms = Math.sqrt(wrongSquare / count);
    const correctedRms = Math.sqrt(correctedSquare / count);
    const stanceReliable = fast === 'crouch_walk_back'
      || corrected <= MAX_PHASE_STANCE_MISMATCH;
    assert(
      correctedRms <= MAX_PHASE_HEIGHT_RMS
        && correctedRms + 0.03 <= wrongRms
        && stanceReliable,
      `${slow}->${fast}: сдвиг -1/6 не выровнял контактную фазу `
        + `(RMS ${wrongRms.toFixed(3)}→${correctedRms.toFixed(3)} м, `
        + `опора ${(wrong * 100).toFixed(0)}→${(corrected * 100).toFixed(0)}%)`
    );
    phaseReports.push(`${slow}/${fast} RMS ${wrongRms.toFixed(3)}→${correctedRms.toFixed(3)}м`);
  }

  console.log(`Locomotion clip sync OK: ${reported.join(', ')}; gait phase mismatch ${phaseReports.join(', ')}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
