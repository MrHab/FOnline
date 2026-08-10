const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const THREE = require('three');

const root = path.resolve(__dirname, '..');
const modelDirectory = path.join(root, 'public', 'assets', 'models', 'characters', 'base');
const manifestPath = path.join(modelDirectory, 'manifest.json');
const runtimePath = path.join(root, 'public', 'js', 'game', '04b_character_glb_runtime.js');
const playerVisualPath = path.join(root, 'public', 'js', 'game', '04_player_model_visuals.js');
const modernRuntimePath = path.join(root, 'public', 'js', 'game', '04a_player_model_modern_runtime.js');
const remoteRuntimePath = path.join(root, 'public', 'js', 'game', '05b_remote_player_locomotion.js');
const socketRuntimePath = path.join(root, 'public', 'js', 'game', '05c_multiplayer_socket_room.js');
const enemyRuntimePath = path.join(root, 'public', 'js', 'game', '05f_enemy_models_location_flow.js');
const creatorPath = path.join(root, 'public', 'js', 'game', '08_character_creation_save.js');
const updatePath = path.join(root, 'public', 'js', 'game', '09_update_fog_movement_ai.js');
const indexPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'server.js');
const expectedKeys = new Set([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const expectedFaces = {
  female: ['female_01', 'female_02', 'female_03', 'female_04'],
  male: ['male_01', 'male_02', 'male_03', 'male_04']
};
const expectedHair = [
  'shaved',
  'short_crop',
  'side_swept',
  'mohawk',
  'braids',
  'tied_back',
  'long',
  'buns'
];
const expectedHairColors = [
  ['hair_01', '#1A1512'],
  ['hair_02', '#2A1B16'],
  ['hair_03', '#4B3023'],
  ['hair_04', '#6B452A'],
  ['hair_05', '#8A6040'],
  ['hair_06', '#A27A4B'],
  ['hair_07', '#7B7D76'],
  ['hair_08', '#5B2922']
];

function glbJson(buffer, fileName) {
  assert(buffer.length >= 20, `${fileName}: truncated GLB`);
  assert.strictEqual(buffer.toString('ascii', 0, 4), 'glTF', `${fileName}: invalid GLB magic`);
  assert.strictEqual(buffer.readUInt32LE(4), 2, `${fileName}: GLB must use glTF 2.0`);
  const declaredLength = buffer.readUInt32LE(8);
  assert.strictEqual(declaredLength, buffer.length, `${fileName}: stale GLB byte length`);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    assert(chunkEnd <= buffer.length, `${fileName}: invalid GLB chunk length`);
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(buffer.subarray(chunkStart, chunkEnd).toString('utf8').replace(/\0+$/g, ''));
    }
    offset = chunkEnd;
  }
  throw new Error(`${fileName}: missing JSON chunk`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.schema, 'realm.character-model-catalog.v1');
assert.strictEqual(manifest.source?.license, 'CC0-1.0');
assert.strictEqual(manifest.files?.length, expectedKeys.size);
assert(!Object.prototype.hasOwnProperty.call(manifest, 'generatedAt'), 'character manifest must be deterministic');

const actualKeys = new Set();
for (const row of manifest.files) {
  const key = `${row.sex}_${row.bodyType}`;
  assert(expectedKeys.has(key), `unexpected character combination: ${key}`);
  assert(!actualKeys.has(key), `duplicate character combination: ${key}`);
  actualKeys.add(key);

  const fileName = path.basename(String(row.file || ''));
  assert.strictEqual(fileName, `character_${key}.glb`, `${key}: non-canonical file name`);
  const filePath = path.join(modelDirectory, fileName);
  const buffer = fs.readFileSync(filePath);
  assert(buffer.length <= 5.5 * 1024 * 1024, `${fileName}: exceeds the browser asset budget`);
  assert.strictEqual(row.bytes, buffer.length, `${fileName}: manifest byte count is stale`);
  assert.strictEqual(
    row.sha256,
    crypto.createHash('sha256').update(buffer).digest('hex'),
    `${fileName}: manifest hash is stale`
  );

  const json = glbJson(buffer, fileName);
  assert.strictEqual(json.asset?.version, '2.0', `${fileName}: asset version is not glTF 2.0`);
  assert(Array.isArray(json.meshes) && json.meshes.length >= 1 && json.meshes.length <= 4, `${fileName}: invalid mesh count`);
  assert(Array.isArray(json.materials) && json.materials.length <= 4, `${fileName}: too many materials`);
  assert(Array.isArray(json.skins) && json.skins.length === 1, `${fileName}: expected one humanoid skin`);
  assert(json.skins[0].joints?.length >= 60, `${fileName}: incomplete humanoid rig`);
  const nodeNames = new Set((json.nodes || []).map(node => String(node.name || '').toLowerCase()));
  assert(nodeNames.has('face_eyes'), `${fileName}: separate animated eye mesh is missing`);
  assert(nodeNames.has('face_eyebrows'), `${fileName}: separate animated eyebrow mesh is missing`);
  const animations = new Set((json.animations || []).map(animation => String(animation.name || '').toLowerCase()));
  for (const animation of ['idle', 'walk', 'run']) {
    assert(animations.has(animation), `${fileName}: missing ${animation} animation`);
  }
}
assert.deepStrictEqual(actualKeys, expectedKeys);

const runtime = fs.readFileSync(runtimePath, 'utf8');
const playerVisual = fs.readFileSync(playerVisualPath, 'utf8');
const modernRuntime = fs.readFileSync(modernRuntimePath, 'utf8');
const remoteRuntime = fs.readFileSync(remoteRuntimePath, 'utf8');
const socketRuntime = fs.readFileSync(socketRuntimePath, 'utf8');
const enemyRuntime = fs.readFileSync(enemyRuntimePath, 'utf8');
const creator = fs.readFileSync(creatorPath, 'utf8');
const update = fs.readFileSync(updatePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
assert(runtime.includes('/assets/models/characters/base/character_${characterAppearanceKey(input)}.glb'));
assert(runtime.includes('setCharacterCreationPreviewAppearance'));
assert(runtime.includes('applyCharacterGlbAppearance'));
for (const id of [
  ...expectedFaces.female,
  ...expectedFaces.male,
  ...expectedHair,
  ...expectedHairColors.map(([id]) => id)
]) {
  assert(runtime.includes(`'${id}'`), `character appearance option is missing: ${id}`);
}
assert(runtime.includes('function applyCharacterGlbVisualVariants('));
assert(runtime.includes('function applyCharacterFaceShape('));
assert(runtime.includes('function addCharacterHairVariant('));
assert(runtime.includes('function ensureCharacterFacialRuntime(')
  && runtime.includes('function updateCharacterFacialAnimation(')
  && runtime.includes("root.userData.characterFacialState = dead"),
  'character faces do not expose blink and reaction animation states');
assert(runtime.includes('runtime.blinkUntil = runtime.elapsed + 0.105;')
  && runtime.includes("hurt: !!state.hurt || hitReactionActive")
  && runtime.includes('attacking: facialAttackActive'),
  'natural blink, hit or attack facial reactions are missing');
assert(runtime.includes('applyCharacterFaceShapeFrame(runtime.root);'));
assert(runtime.includes('updateCharacterFacialAnimation(runtime.root, frameDt,'),
  'in-game GLB faces are not animated each frame');
assert(runtime.includes('applyCharacterFaceShapeFrame(characterPreviewState.model);'));
assert(runtime.includes('updateCharacterFacialAnimation(characterPreviewState.model, dt, { preview: true });'),
  'character creator preview does not animate the face');
assert(runtime.includes('function characterTurnInPlaceState(')
  && modernRuntime.includes('characterTurnInPlaceState(actor, state.facingAngle, moving, dt)'),
  'stationary cursor turns do not enter turn-in-place locomotion');
assert(runtime.includes('function triggerActorAttackAnimationPulse(')
  && runtime.includes('function actorAttackAnimationPulseState(')
  && runtime.includes('function characterOneShotRestart('),
  'GLB characters do not expose repeatable one-shot attack pulses');
assert(playerVisual.includes('triggerActorAttackAnimationPulse(actor, opts.attackToken || opts.t || 0)'),
  'melee events do not pulse the GLB attack action');
assert(socketRuntime.includes('triggerActorAttackAnimationPulse(enemyShooter.mesh, data.t || 0)'),
  'ranged NPC shots do not pulse the GLB attack action');
assert(socketRuntime.includes('attackToken: data.t || 0'),
  'melee NPC events lose their unique attack token');
assert(enemyRuntime.includes('attackToken: attackAnimation.token')
  && enemyRuntime.includes('characterOneShotRestart(runtime, action, state.attackToken)'),
  'NPC or creature animation updates do not restart attacks from event tokens');
assert(runtime.includes('characterPreviewState.requestedAppearance = appearance;'));
assert(runtime.includes('characterPreviewState.requestedAppearance || appearance'),
  'creator preview drops appearance changes while a body model is loading');
assert(runtime.includes('characterPreviewState.requestId += 1;')
  && runtime.includes('characterPreviewState.requestedKey = key;'),
  'creator preview does not cancel a stale body-model request');
assert(runtime.includes('root.rotation.y = Math.PI;'), 'runtime GLB does not face the cursor direction');
assert(runtime.includes("canvas.addEventListener('pointermove'"), 'creator preview does not follow the cursor');
assert(update.includes('facePoint(pointerWorld.x, pointerWorld.z)'),
  'the local player does not face the world cursor');
assert(update.includes('moveX: animationMoveX')
  && update.includes('moveZ: animationMoveZ')
  && update.includes('facingAngle: player.angle'),
  'local locomotion does not receive movement relative to cursor facing');
assert(remoteRuntime.includes('moveX: visualMoveX')
  && remoteRuntime.includes('moveZ: visualMoveZ')
  && remoteRuntime.includes('facingAngle: Number(g.rotation.y || 0) - Math.PI'),
  'remote locomotion does not receive visual movement relative to facing');
assert(modernRuntime.includes("typeof characterDirectionalLocomotionState === 'function'")
  && modernRuntime.includes('parts.motionRoot.rotation.y = lowerBodyYaw;')
  && modernRuntime.includes('dt * phaseSpeed * actor.userData.modernPlaybackRate'),
  'procedural equipment rig does not follow directional locomotion');
assert(index.includes('id="creator-face-options"')
  && index.includes('id="creator-hair-options"')
  && index.includes('id="creator-hair-color-options"'),
  'face, hairstyle or hair color controls are missing from character creation');
assert(creator.includes('creatorAppearance = { ...creatorAppearance, faceId: option.id }'));
assert(creator.includes('creatorAppearance = { ...creatorAppearance, hairId: option.id }'));
assert(creator.includes('creatorAppearance = { ...creatorAppearance, hairColorId: option.id }'));
assert(creator.includes('function renderCharacterAppearanceStepper('));
assert(creator.includes("previous.textContent = '←'") && creator.includes("next.textContent = '→'"),
  'character appearance choices are not rendered as arrow steppers');

const server = fs.readFileSync(serverPath, 'utf8');
assert(server.includes("const SERVER_CHARACTER_SEXES = new Set(['female', 'male'])"));
assert(server.includes("const SERVER_CHARACTER_BODY_TYPES = new Set(['slim', 'medium', 'large'])"));
for (const id of [
  ...expectedFaces.female,
  ...expectedFaces.male,
  ...expectedHair,
  ...expectedHairColors.map(([id]) => id)
]) {
  assert(server.includes(`'${id}'`), `server appearance allowlist is missing: ${id}`);
}
assert(server.includes('const faceId = defaults.faceIds.has(rawFaceId) ? rawFaceId : defaults.faceId;'));
assert(server.includes('const hairId = SERVER_CHARACTER_HAIR_IDS.has(rawHairId) ? rawHairId : defaults.hairId;'));
assert(server.includes('const hairColorId = SERVER_CHARACTER_HAIR_COLOR_IDS.has(rawHairColorId) ? rawHairColorId'));
assert(server.includes('appearance: sanitizeCharacterAppearance(p.appearance || {})'));

const compatibilityContext = vm.createContext({ THREE, console, performance });
vm.runInContext(`${runtime}
this.__characterAppearanceFitApi = {
  CHARACTER_BODY_TYPES,
  CHARACTER_FACE_OPTIONS,
  CHARACTER_HAIR_OPTIONS,
  CHARACTER_HAIR_COLOR_OPTIONS,
  normalizeCharacterAppearance,
  characterFaceFitProfile,
  characterVariantMaterial,
  addCharacterHairVariant,
  applyCharacterFaceShape,
  ensureCharacterFacialRuntime,
  updateCharacterFacialAnimation,
  characterHeadRestMatrix,
  attachCharacterVariantToHead,
  characterDirectionalLocomotionState,
  characterTurnInPlaceState,
  triggerActorAttackAnimationPulse,
  actorAttackAnimationPulseState,
  characterOneShotRestart,
  setCharacterGlbAction,
  applyCharacterGlbDirectionalPose,
  clearCharacterGlbDirectionalPose
};`, compatibilityContext, { filename: runtimePath });
const fitApi = compatibilityContext.__characterAppearanceFitApi;
assert(fitApi, 'character appearance fit API could not be inspected');

const attackPulseActor = { userData: {} };
assert.deepStrictEqual(
  { ...fitApi.actorAttackAnimationPulseState(attackPulseActor, true) },
  { token: 0, active: true },
  'persistent attack fallback is missing before the first combat event'
);
assert.strictEqual(fitApi.triggerActorAttackAnimationPulse(attackPulseActor, 101), 101);
assert.deepStrictEqual(
  { ...fitApi.actorAttackAnimationPulseState(attackPulseActor, false) },
  { token: 101, active: true },
  'a combat event does not activate its attack window'
);
attackPulseActor.userData.attackAnimationUntil = 0;
assert.strictEqual(fitApi.actorAttackAnimationPulseState(attackPulseActor, true).active, false,
  'persistent AI state incorrectly keeps attacks active after event-driven animation starts');

const attackRuntime = { attackAnimationToken: 0 };
assert.strictEqual(fitApi.characterOneShotRestart(attackRuntime, 'attack', 101), true);
assert.strictEqual(fitApi.characterOneShotRestart(attackRuntime, 'attack', 101), false,
  'one combat event restarts the same action more than once');
assert.strictEqual(fitApi.characterOneShotRestart(attackRuntime, 'attack', 102), true,
  'a later combat event cannot restart the finished attack action');
const actionCalls = { reset: 0, play: 0 };
const repeatedAttackAction = {
  reset() { actionCalls.reset += 1; return this; },
  setEffectiveWeight() { return this; },
  setEffectiveTimeScale() { return this; },
  play() { actionCalls.play += 1; return this; }
};
const repeatedAttackRuntime = {
  actions: { attack: repeatedAttackAction },
  currentAction: 'attack'
};
fitApi.setCharacterGlbAction(repeatedAttackRuntime, 'attack', 0);
assert.deepStrictEqual(actionCalls, { reset: 0, play: 0 },
  'a stable frame restarts the attack clip without a new event');
fitApi.setCharacterGlbAction(repeatedAttackRuntime, 'attack', 0, { restart: true });
assert.deepStrictEqual(actionCalls, { reset: 1, play: 1 },
  'a new event does not reset and replay the current attack clip');

const facialRoot = new THREE.Group();
facialRoot.name = 'character_glb_test_face';
const facialEyes = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.01));
facialEyes.name = 'face_eyes';
facialEyes.userData.realm_character_layer = 'eyes';
facialEyes.position.set(0, 1.72, -0.08);
const facialBrows = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.01));
facialBrows.name = 'face_eyebrows';
facialBrows.userData.realm_character_layer = 'eyebrows';
facialBrows.position.set(0, 1.76, -0.085);
facialRoot.add(facialEyes, facialBrows);
assert.strictEqual(fitApi.updateCharacterFacialAnimation(facialRoot, 0.016, {}), true,
  'facial runtime did not initialize from the separate face meshes');
const facialRuntime = fitApi.ensureCharacterFacialRuntime(facialRoot);
const baseBrowY = facialRuntime.browsBasePosition.y;
facialRuntime.nextBlink = facialRuntime.elapsed + 0.01;
fitApi.updateCharacterFacialAnimation(facialRoot, 0.02, {});
assert.strictEqual(facialEyes.visible, false, 'natural blink did not close the eyes');
assert.strictEqual(facialRoot.userData.characterFacialState, 'blink');
fitApi.updateCharacterFacialAnimation(facialRoot, 0.08, {});
fitApi.updateCharacterFacialAnimation(facialRoot, 0.08, {});
assert.strictEqual(facialEyes.visible, true, 'eyes stayed closed after a natural blink');
fitApi.updateCharacterFacialAnimation(facialRoot, 0.016, { hurt: true });
assert.strictEqual(facialEyes.visible, false, 'hit reaction did not close the eyes');
assert.strictEqual(facialRoot.userData.characterFacialState, 'hurt');
assert(facialBrows.position.y < baseBrowY, 'hit reaction did not lower the brows');
for (let frame = 0; frame < 4; frame += 1) {
  fitApi.updateCharacterFacialAnimation(facialRoot, 0.08, { hurt: false });
}
assert.strictEqual(facialEyes.visible, true, 'hit reaction left the eyes permanently closed');
fitApi.updateCharacterFacialAnimation(facialRoot, 0.08, { attacking: true });
assert.strictEqual(facialRoot.userData.characterFacialState, 'attack');
assert(facialBrows.position.y < baseBrowY, 'attack reaction did not focus the brows');
fitApi.updateCharacterFacialAnimation(facialRoot, 0.08, { talking: true });
assert.strictEqual(facialRoot.userData.characterFacialState, 'talk');
fitApi.updateCharacterFacialAnimation(facialRoot, 0.016, { dead: true });
assert.strictEqual(facialEyes.visible, false, 'death reaction did not close the eyes');
assert.strictEqual(facialRoot.userData.characterFacialState, 'dead');

function closeTo(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`);
}

const forwardLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 6,
  facingAngle: 0,
  moveX: 0,
  moveZ: 1
});
assert.strictEqual(forwardLocomotion.direction, 'forward');
assert.strictEqual(forwardLocomotion.action, 'run');
assert(forwardLocomotion.playbackRate > 0);
closeTo(forwardLocomotion.lowerBodyYaw, 0, 1e-7, 'forward lower-body yaw');

const backwardLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 6,
  facingAngle: 0,
  moveX: 0,
  moveZ: -1
});
assert.strictEqual(backwardLocomotion.direction, 'backward');
assert.strictEqual(backwardLocomotion.action, 'walk');
assert(backwardLocomotion.playbackRate < 0, 'backpedal does not reverse the walk cycle');
assert(backwardLocomotion.strideScale < forwardLocomotion.strideScale,
  'backpedal stride is not shortened');
closeTo(backwardLocomotion.lowerBodyYaw, 0, 1e-7, 'backward lower-body yaw');

const rightLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 4,
  facingAngle: 0,
  moveX: 1,
  moveZ: 0
});
const leftLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 4,
  facingAngle: 0,
  moveX: -1,
  moveZ: 0
});
assert.strictEqual(rightLocomotion.direction, 'right');
assert.strictEqual(leftLocomotion.direction, 'left');
assert(rightLocomotion.lowerBodyYaw > 0 && leftLocomotion.lowerBodyYaw < 0,
  'strafe does not turn the lower body toward movement');
closeTo(
  rightLocomotion.lowerBodyYaw + rightLocomotion.upperBodyYaw,
  0,
  1e-7,
  'right strafe cursor-facing compensation'
);
closeTo(
  leftLocomotion.lowerBodyYaw + leftLocomotion.upperBodyYaw,
  0,
  1e-7,
  'left strafe cursor-facing compensation'
);

assert.strictEqual(fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 4,
  facingAngle: 0,
  moveX: 1,
  moveZ: 1
}).direction, 'forward_right');
assert.strictEqual(fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 4,
  facingAngle: 0,
  moveX: 1,
  moveZ: -1
}).direction, 'backward_right');
assert.strictEqual(fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 4,
  facingAngle: Math.PI / 2,
  moveX: 1,
  moveZ: 0
}).direction, 'forward');
assert.strictEqual(fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 4,
  facingAngle: Math.PI / 2,
  moveX: 0,
  moveZ: -1
}).direction, 'right');
assert.strictEqual(fitApi.characterDirectionalLocomotionState({
  moving: false,
  speed: 0,
  facingAngle: 0,
  moveX: 0,
  moveZ: 0
}).direction, 'idle');

const turningActor = { userData: {} };
assert.strictEqual(
  fitApi.characterTurnInPlaceState(turningActor, 0, false, 0.016).turning,
  false,
  'the initial facing sample starts an unwanted turn animation'
);
const rightTurnState = fitApi.characterTurnInPlaceState(turningActor, Math.PI / 2, false, 0.016);
assert(rightTurnState.turning && rightTurnState.amount > 0,
  'a stationary right turn does not produce a positive turn-in-place signal');
assert.strictEqual(
  fitApi.characterTurnInPlaceState(turningActor, Math.PI / 2, false, 0.016).turning,
  true,
  'a one-frame cursor turn is not held long enough to show a footstep'
);
const rightTurnLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: false,
  turning: true,
  turnAmount: rightTurnState.amount
});
const leftTurnLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: false,
  turning: true,
  turnAmount: -rightTurnState.amount
});
assert.strictEqual(rightTurnLocomotion.direction, 'turn_right');
assert.strictEqual(leftTurnLocomotion.direction, 'turn_left');
assert.strictEqual(rightTurnLocomotion.action, 'turn');
assert(rightTurnLocomotion.locomoting && rightTurnLocomotion.strideScale > 0,
  'turn-in-place does not drive the legs');
assert(rightTurnLocomotion.lowerBodyYaw > 0 && leftTurnLocomotion.lowerBodyYaw < 0,
  'turn-in-place does not rotate the pelvis in the turn direction');
const wrappedTurnActor = { userData: {} };
fitApi.characterTurnInPlaceState(wrappedTurnActor, Math.PI - 0.05, false, 0.016);
assert(fitApi.characterTurnInPlaceState(wrappedTurnActor, -Math.PI + 0.05, false, 0.016).amount > 0,
  'turn-in-place chooses the long direction across the angle wrap');
assert.strictEqual(
  fitApi.characterTurnInPlaceState(turningActor, Math.PI / 2, true, 0.016).turning,
  false,
  'turn-in-place remains active during physical movement'
);

const directionalRoot = new THREE.Group();
const directionalBones = {};
for (const key of ['pelvis', 'spine01', 'spine02', 'spine03', 'neck', 'head']) {
  directionalBones[key] = new THREE.Group();
}
const directionalRuntime = {
  root: directionalRoot,
  baseRotationY: Math.PI,
  directionalMoveBlend: 0,
  directionalLowerBodyYaw: 0,
  directionalSideAmount: 0,
  directionalForwardAmount: 1,
  directionalPoseOffsets: [],
  locomotionBones: directionalBones
};
fitApi.applyCharacterGlbDirectionalPose(directionalRuntime, rightLocomotion, 0.2);
closeTo(
  directionalRoot.rotation.y,
  Math.PI + rightLocomotion.lowerBodyYaw,
  1e-7,
  'GLB lower-body movement heading'
);
assert.strictEqual(directionalRuntime.directionalPoseOffsets.length, 6,
  'directional GLB pose is not distributed over the upper-body rig');
fitApi.clearCharacterGlbDirectionalPose(directionalRuntime);
assert.strictEqual(directionalRuntime.directionalPoseOffsets.length, 0);
for (const [key, bone] of Object.entries(directionalBones)) {
  closeTo(bone.quaternion.angleTo(new THREE.Quaternion()), 0, 1e-7, `${key} pose cleanup`);
}

function finiteBox(box, label) {
  for (const value of [
    box.min.x, box.min.y, box.min.z,
    box.max.x, box.max.y, box.max.z
  ]) {
    assert(Number.isFinite(value), `${label}: non-finite geometry bound`);
  }
}

function disposeGroup(group) {
  group.traverse(object => {
    object.geometry?.dispose?.();
  });
}

let compatibilityCount = 0;
for (const sex of ['female', 'male']) {
  assert.deepStrictEqual(
    Array.from(fitApi.CHARACTER_FACE_OPTIONS[sex], option => option.id),
    expectedFaces[sex],
    `${sex}: face catalog drifted`
  );
  assert.deepStrictEqual(
    Array.from(fitApi.CHARACTER_HAIR_OPTIONS, option => option.id),
    expectedHair,
    'hairstyle catalog drifted'
  );
  assert.deepStrictEqual(
    Array.from(fitApi.CHARACTER_HAIR_COLOR_OPTIONS, option => [option.id, option.hex]),
    expectedHairColors,
    'hair color catalog drifted'
  );
  for (const bodyType of ['slim', 'medium', 'large']) {
    for (const faceId of expectedFaces[sex]) {
      for (const hairId of expectedHair) {
        for (const [hairColorId, hairHex] of expectedHairColors) {
          const appearance = fitApi.normalizeCharacterAppearance({
            sex,
            bodyType,
            faceId,
            hairId,
            hairColorId
          });
          assert.strictEqual(appearance.faceId, faceId, `${faceId}: normalization rejected a face`);
          assert.strictEqual(appearance.hairId, hairId, `${hairId}: normalization rejected a hairstyle`);
          assert.strictEqual(appearance.hairColorId, hairColorId, `${hairColorId}: normalization rejected a hair color`);
          const fit = fitApi.characterFaceFitProfile(appearance);
          assert(Array.isArray(fit.headScale) && fit.headScale.length === 3, `${faceId}: invalid head fit`);
          assert(Array.isArray(fit.scalpScale) && fit.scalpScale.length === 2, `${faceId}: invalid scalp fit`);
          assert(fit.headScale.every(Number.isFinite), `${faceId}: non-finite head scale`);
          assert(fit.scalpScale.every(Number.isFinite), `${faceId}: non-finite scalp scale`);

          const group = new THREE.Group();
          const material = fitApi.characterVariantMaterial(hairHex);
          const expectedColor = new THREE.Color(hairHex);
          expectedColor.convertSRGBToLinear();
          assert(Math.max(
            Math.abs(material.color.r - expectedColor.r),
            Math.abs(material.color.g - expectedColor.g),
            Math.abs(material.color.b - expectedColor.b)
          ) < 1e-7,
            `${hairColorId}: hair palette was not converted from sRGB to linear light`);
          const built = fitApi.addCharacterHairVariant(group, material, appearance);
          if (hairId === 'shaved') {
            assert.strictEqual(built, false, `${hairId}: shaved style unexpectedly built geometry`);
            assert.strictEqual(group.children.length, 0, `${hairId}: shaved style contains geometry`);
            material.dispose();
          } else {
            assert.strictEqual(built, true, `${hairId}: hairstyle builder did not run`);
            assert(group.children.length > 0, `${hairId}: hairstyle has no geometry`);
            group.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(group);
            finiteBox(bounds, `${sex}/${bodyType}/${faceId}/${hairId}/${hairColorId}`);
            assert(bounds.min.y >= 1.25, `${hairId}: hairstyle falls through the upper torso`);
            assert(bounds.max.y <= 2.05, `${hairId}: hairstyle exceeds the character height budget`);
            assert(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) <= 0.2,
              `${hairId}: hairstyle exceeds the head width budget`);
            assert(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) <= 0.25,
              `${hairId}: hairstyle exceeds the head depth budget`);

            const cap = group.getObjectByName('hair_variant_scalp');
            if (hairId === 'mohawk') {
              assert(!cap, 'mohawk must keep shaved sides instead of a scalp cap');
            } else {
              assert(cap?.isMesh, `${hairId}: scalp contact cap is missing`);
              cap.updateMatrixWorld(true);
              const capBounds = new THREE.Box3().setFromObject(cap);
              finiteBox(capBounds, `${sex}/${bodyType}/${faceId}/${hairId}/${hairColorId}/scalp`);
              assert(capBounds.max.y >= fit.top + 0.02 && capBounds.max.y <= fit.top + 0.03,
                `${hairId}: scalp cap floats above or sinks into the head`);
              assert(capBounds.min.y <= fit.top - 0.065,
                `${hairId}: scalp cap does not cover the hairline`);
              assert(capBounds.min.x <= -0.08 * fit.scalpScale[0]
                && capBounds.max.x >= 0.08 * fit.scalpScale[0],
              `${hairId}: scalp cap does not cover the face profile width`);
              const capNormals = cap.geometry?.attributes?.normal;
              assert(capNormals && capNormals.getY(0) > 0.9,
                `${hairId}: scalp cap normals face inward`);
            }
          }
          disposeGroup(group);
          compatibilityCount += 1;
        }
      }
    }
  }
}
assert.strictEqual(compatibilityCount, 1536, 'appearance compatibility matrix is incomplete');

const attachmentRoot = new THREE.Group();
const attachmentNeck = new THREE.Group();
const attachmentHead = new THREE.Group();
attachmentHead.name = 'head';
attachmentNeck.position.set(0.02, 1.42, -0.01);
attachmentHead.position.set(-0.02, 0.34, 0.015);
attachmentNeck.add(attachmentHead);
attachmentRoot.add(attachmentNeck);
const attachmentAppearance = fitApi.normalizeCharacterAppearance({
  sex: 'female',
  bodyType: 'large',
  faceId: 'female_03',
  hairId: 'buns',
  hairColorId: 'hair_08'
});
fitApi.characterHeadRestMatrix(attachmentRoot);
fitApi.applyCharacterFaceShape(attachmentRoot, attachmentAppearance);
const firstAttachment = new THREE.Group();
fitApi.attachCharacterVariantToHead(attachmentRoot, firstAttachment, attachmentAppearance);
attachmentNeck.rotation.x = 0.19;
attachmentHead.rotation.z = -0.13;
attachmentRoot.updateMatrixWorld(true);
const changedDuringAnimation = new THREE.Group();
fitApi.attachCharacterVariantToHead(attachmentRoot, changedDuringAnimation, attachmentAppearance);
firstAttachment.updateMatrix();
changedDuringAnimation.updateMatrix();
firstAttachment.matrix.elements.forEach((value, index) => {
  assert(Math.abs(value - changedDuringAnimation.matrix.elements[index]) < 1e-7,
    'hairstyle attachment drifted when changed during animation');
});

console.log(
  'Character models OK: 6 GLB bases, 8 faces, 8 hairstyles, 8 hair colors, '
  + '1536 fit combinations, stable rest-pose attachment, 8-way cursor-relative locomotion and turn-in-place steps, '
  + 'blink/hurt/attack/talk/death facial reactions, rig/animations and hashes checked'
);
