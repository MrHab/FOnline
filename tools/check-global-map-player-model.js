'use strict';
// Модель игрока на глобальной карте не должна стоять в T-позе.
//
// Карта загружала персонажа, но миксер анимаций никто не крутил, поэтому
// модель оставалась в позе привязки — с разведёнными в стороны руками.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const playerModels = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '11a_global_map_player_models.js'), 'utf8');
const dynamicRender = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '11e_global_map_tasks_dynamic_render.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '04b_character_glb_runtime.js'), 'utf8');

// --- Проводка ---
assert(playerModels.includes('function updateGlobalMapPlayerModelAnimation('),
  'на глобальной карте нет обновления анимации модели игрока');
assert(playerModels.includes('updateCharacterGlbAnimation(modelRoot, frameDt,'),
  'модель на карте больше не использует общий рантайм анимаций');
assert(/footIk: false/.test(playerModels),
  'IK стоп на карте включён: маркер уменьшен и приподнят, привязывать стопы не к чему');
assert(dynamicRender.includes('updateGlobalMapPlayerModelAnimation(dynamic.playerMarker, dt)'),
  'цикл отрисовки карты снова не обновляет анимацию модели игрока');

// --- Модель обязана выйти из позы привязки ---
async function main() {
  global.ProgressEvent = global.ProgressEvent || class ProgressEvent {};
  global.self = global.self || global;
  global.createImageBitmap = global.createImageBitmap || (async () => ({ width: 1, height: 1, close() {} }));
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const data = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'characters', 'base', 'character_male_medium.glb'));
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));

  const context = vm.createContext({ THREE, console, performance });
  vm.runInContext(`${runtimeSource}
this.__mapPoseApi = {
  updateCharacterGlbAnimation,
  characterGlbActions,
  setCharacterGlbAction,
  captureCharacterFootIkRest,
  captureCharacterUpperBodyRest
};`, context, { filename: '04b_character_glb_runtime.js' });
  const api = context.__mapPoseApi;

  const root = gltf.scene;
  root.rotation.y = Math.PI;
  const mixer = new THREE.AnimationMixer(root);
  const runtime = {
    key: 'male_medium',
    appearance: { sex: 'male', bodyType: 'medium' },
    root,
    mixer,
    actions: api.characterGlbActions(mixer, gltf.animations || []),
    currentAction: '',
    attackAnimationToken: 0,
    baseRotationY: Math.PI,
    modelScale: 1,
    directionalMoveBlend: 0,
    directionalLowerBodyYaw: 0,
    directionalSideAmount: 0,
    directionalForwardAmount: 1,
    directionalTurnAmount: 0,
    directionalPlaybackRate: 1,
    directionalWasMoving: false,
    directionalPoseOffsets: [],
    locomotionBones: {
      pelvis: root.getObjectByName('pelvis'),
      spine01: root.getObjectByName('spine_01'),
      spine02: root.getObjectByName('spine_02'),
      spine03: root.getObjectByName('spine_03'),
      neck: root.getObjectByName('neck_01'),
      head: root.getObjectByName('head')
    }
  };
  const actor = new THREE.Group();
  actor.add(root);
  actor.userData.characterGlbRuntime = runtime;
  api.captureCharacterFootIkRest(actor, runtime);
  api.captureCharacterUpperBodyRest(runtime);

  const arm = root.getObjectByName('upperarm_l');
  assert(arm, 'в базовой модели нет кости плеча');
  const bindPose = arm.quaternion.clone();

  // Тот же вызов, что делает карта: стоим на месте, IK стоп выключен.
  for (let frame = 0; frame < 60; frame += 1) {
    api.updateCharacterGlbAnimation(actor, 1 / 60, {
      moving: false,
      speed: 0,
      moveX: 0,
      moveZ: 0,
      facingAngle: 0,
      footIk: false,
      turning: false,
      turnAmount: 0
    });
  }
  const idleShift = arm.quaternion.angleTo(bindPose) * 180 / Math.PI;
  assert(idleShift > 5,
    `модель осталась в позе привязки: плечо сдвинулось всего на ${idleShift.toFixed(1)}°`);

  // В пути должна играть ходьба, а не стойка.
  api.updateCharacterGlbAnimation(actor, 1 / 60, {
    moving: true,
    speed: 1.6,
    moveX: 0,
    moveZ: 1.6 / 60,
    facingAngle: 0,
    footIk: false,
    turning: false,
    turnAmount: 0
  });
  assert.strictEqual(runtime.currentAction, 'walk',
    `в пути на карте проигрывается «${runtime.currentAction}» вместо ходьбы`);

  console.log(`Global map player model OK: не в T-позе (плечо ${idleShift.toFixed(0)}° от позы привязки), в пути играет ходьба.`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
