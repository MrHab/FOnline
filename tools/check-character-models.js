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
const expectedHair = {
  female: ['shaved', 'tied_back'],
  male: ['shaved', 'short_crop']
};
const expectedHairCatalog = ['shaved', 'short_crop', 'tied_back'];
const legacyServerHair = [
  ...expectedHairCatalog,
  'side_swept',
  'mohawk',
  'braids',
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
  const authoredHairNodes = (json.nodes || []).filter(node => (
    String(node.extras?.realm_character_layer || '').toLowerCase() === 'hair'
  ));
  const expectedHairNode = row.sex === 'female' ? 'hair_tied_back' : 'hair_short_crop';
  assert.deepStrictEqual(
    authoredHairNodes.map(node => String(node.name || '').toLowerCase()),
    [expectedHairNode],
    `${fileName}: authored hair node drifted`
  );
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
assert(runtime.includes('/assets/models/characters/base/character_${key}.glb'));
assert(runtime.includes('CHARACTER_GLB_ASSET_VERSIONS[key]'));
assert(runtime.includes('return `${baseUrl}?v=${encodeURIComponent(version)}`'));
for (const row of manifest.files) {
  const key = `${row.sex}_${row.bodyType}`;
  assert(
    runtime.includes(`${key}: '${row.sha256.slice(0, 16)}'`),
    `${key}: runtime GLB cache fingerprint is stale`
  );
}
assert(runtime.includes('setCharacterCreationPreviewAppearance'));
assert(runtime.includes('applyCharacterGlbAppearance'));
assert(runtime.includes('CHARACTER_GLB_ACTOR_RETRY_MAX_DELAY_MS')
  && runtime.includes('function cancelPendingCharacterGlbAppearance('),
  'live GLB-only actors do not keep retrying safely after transient body-load failures');
assert(!runtime.includes('CHARACTER_GLB_ACTOR_RETRY_ROUNDS'),
  'live GLB-only actors still stop retrying after a finite number of failures');
for (const id of [
  ...expectedFaces.female,
  ...expectedFaces.male,
  ...expectedHairCatalog,
  ...expectedHairColors.map(([id]) => id)
]) {
  assert(runtime.includes(`'${id}'`), `character appearance option is missing: ${id}`);
}
assert(runtime.includes('function applyCharacterGlbVisualVariants('));
assert(runtime.includes('function characterHairOptionsForSex('));
assert(runtime.includes('function applyCharacterFaceShape('));
assert(!runtime.includes('function addCharacterHairVariant(')
  && !runtime.includes('function addCharacterHairPiece(')
  && !runtime.includes('new THREE.IcosahedronGeometry(')
  && !runtime.includes('new THREE.BufferGeometry()'),
'character runtime restored generated hairstyle geometry');
assert(runtime.includes("obj.visible = !helmetOn && appearance.hairId !== 'shaved'")
  && runtime.includes('material.userData.characterGlbHairTintId ='),
  'authored GLB hair visibility or per-instance tint is missing');
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
const glbRuntime = fs.readFileSync(runtimePath, 'utf8');
const approvedRuntime = fs.readFileSync(path.join(root, 'public', 'js', 'game', '04d_approved_humanoid_assets_runtime.js'), 'utf8');
// Авторские клипы локомоции: задний ход и ходьба в приседе выбираются рантаймом
// (с фолбэком на реверс, пока клип не догрузился) и подвешиваются всем гуманоидам.
assert(glbRuntime.includes("locomotionAction = 'crouch_walk'")
  && glbRuntime.includes("locomotionAction = 'walk_back'")
  && glbRuntime.includes("locomotionAction = 'run_back'")
  && glbRuntime.includes("locomotionAction = 'crouch_walk_back'")
  && glbRuntime.includes('authoredBackClip ? 1 : locomotion.playbackRate'),
  'runtime does not select a dedicated clip for every locomotion direction');
// Отход в приседе обязан иметь свой клип: раньше присед перехватывал выбор
// до проверки направления и играл crouch_walk задом наперёд.
assert(glbRuntime.includes('const crouchBack = locomotion.backward && runtime.actions?.crouch_walk_back;'),
  'crouch keeps hijacking clip selection before the direction check');
// Сами значения натуральных скоростей сверяет с клипами
// tools/check-locomotion-clip-sync.js — здесь только их наличие.
assert(glbRuntime.includes('walk_back:') && glbRuntime.includes('run_back:') && glbRuntime.includes('crouch_walk:'),
  'stride-sync natural speeds for authored locomotion clips are missing');
assert(/APPROVED_LOOP_LOCOMOTION_CLIPS = Object\.freeze\(\[[\s\S]*?'crouch_walk_back'[\s\S]*?\]\)/.test(approvedRuntime),
  'players do not receive the authored loop locomotion clips');
// Ноги не должны перекидываться рывком: угловая скорость разворота таза
// ограничена, а угол непрерывен на границе «вперёд/назад» (гистерезис).
assert(glbRuntime.includes('CHARACTER_LOWER_BODY_YAW_RATE')
  && /maxYawStep = CHARACTER_LOWER_BODY_YAW_RATE/.test(glbRuntime),
  'lower-body yaw is not rate limited');
assert(glbRuntime.includes('state.previousBackward') && glbRuntime.includes('characterWrapAngle(relativeAngle + Math.PI)'),
  'backward mode has no hysteresis or continuous path yaw');
// Высоты в IK стоп считаются от настоящей земли (с поправкой на kneeFlex),
// иначе в приседе стопа уходит под пол.
assert(glbRuntime.includes('const height = animated.y - groundY - rest + flex;')
  && glbRuntime.includes('.setY(groundY + rest + Math.max(0, height));'),
  'foot IK does not reason in real-ground space');
assert(glbRuntime.includes('CHARACTER_KNEE_FLEX_CROUCH = 0.26'),
  'deepened crouch knee flex is missing');
assert(modernRuntime.includes('updateCharacterGlbAnimation(actor, dt, animationState) === true')
  && modernRuntime.includes('updateModernApprovedWeaponGrip(actor, modernAnimationWeaponId(actor))')
  && !modernRuntime.includes('parts.motionRoot')
  && !modernRuntime.includes('parts.torsoRig'),
  'authored GLB locomotion bridge or weapon-grip update is missing');
assert(index.includes('id="creator-face-options"')
  && index.includes('id="creator-hair-options"')
  && index.includes('id="creator-hair-color-options"'),
  'face, hairstyle or hair color controls are missing from character creation');
assert(creator.includes('creatorAppearance = { ...creatorAppearance, faceId: option.id }'));
assert(creator.includes('creatorAppearance = { ...creatorAppearance, hairId: option.id }'));
assert(creator.includes('creatorAppearance = { ...creatorAppearance, hairColorId: option.id }'));
assert(creator.includes('characterHairOptionsForSex(creatorAppearance.sex)'),
  'character creator exposes hairstyles from the opposite sex');
assert(creator.includes('function renderCharacterAppearanceStepper('));
assert(creator.includes("previous.textContent = '←'") && creator.includes("next.textContent = '→'"),
  'character appearance choices are not rendered as arrow steppers');

const server = fs.readFileSync(serverPath, 'utf8');
assert(server.includes("const SERVER_CHARACTER_SEXES = new Set(['female', 'male'])"));
assert(server.includes("const SERVER_CHARACTER_BODY_TYPES = new Set(['slim', 'medium', 'large'])"));
for (const id of [
  ...expectedFaces.female,
  ...expectedFaces.male,
  ...legacyServerHair,
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
  characterHairOptionsForSex,
  normalizeCharacterAppearance,
  applyCharacterGlbVisualVariants,
  characterFaceFitProfile,
  applyCharacterFaceShape,
  ensureCharacterFacialRuntime,
  updateCharacterFacialAnimation,
  characterDirectionalLocomotionState,
  characterTurnInPlaceState,
  triggerActorAttackAnimationPulse,
  actorAttackAnimationPulseState,
  characterOneShotRestart,
  setCharacterGlbAction,
  applyCharacterGlbDirectionalPose,
  clearCharacterGlbDirectionalPose,
  captureCharacterFootIkRest,
  captureCharacterUpperBodyRest,
  applyCharacterUpperBodySwayDamping,
  solveCharacterLegChain,
  compatibleCharacterSkeletonMeshes,
  shareCompatibleCharacterSkeletons
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
// Задний ход на скорости бега играет реверс run: walk, разогнанный втрое
// strideSync'ом, выглядел как судорожное семенение.
assert.strictEqual(backwardLocomotion.action, 'run');
assert(backwardLocomotion.playbackRate < 0, 'backpedal does not reverse the locomotion cycle');
assert(backwardLocomotion.strideScale < forwardLocomotion.strideScale,
  'backpedal stride is not shortened');
closeTo(backwardLocomotion.lowerBodyYaw, 0, 1e-7, 'backward lower-body yaw');

const slowBackwardLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 2,
  facingAngle: 0,
  moveX: 0,
  moveZ: -1
});
assert.strictEqual(slowBackwardLocomotion.action, 'walk');
assert(slowBackwardLocomotion.playbackRate < 0, 'slow backpedal does not reverse the walk cycle');

// Диагональ назад: ось шага доворачивается до противоположной движению,
// чтобы реверс клипа шёл строго вдоль фактического пути.
const diagonalBackwardLocomotion = fitApi.characterDirectionalLocomotionState({
  moving: true,
  speed: 6,
  facingAngle: 0,
  moveX: Math.SQRT1_2,
  moveZ: -Math.SQRT1_2
});
assert.strictEqual(diagonalBackwardLocomotion.direction, 'backward_right');
closeTo(diagonalBackwardLocomotion.lowerBodyYaw, -Math.PI / 4, 1e-6, 'diagonal backpedal step axis');

// Прижим размаха верха: клип run мотает голову на ±40°, рантайм обязан
// прижимать шею/голову к рест-позе во время локомоции и не трогать их в idle.
const swayRuntime = {
  currentAction: 'run',
  locomotionBones: {
    spine02: new THREE.Bone(),
    spine03: new THREE.Bone(),
    neck: new THREE.Bone(),
    head: new THREE.Bone()
  }
};
fitApi.captureCharacterUpperBodyRest(swayRuntime);
const swayEuler = new THREE.Euler();
const clipHeadYaw = 0.7;
for (let frame = 0; frame < 90; frame++) {
  swayRuntime.locomotionBones.head.quaternion.setFromEuler(swayEuler.set(0, clipHeadYaw, 0));
  fitApi.applyCharacterUpperBodySwayDamping(swayRuntime, 0.016);
}
const dampedHeadYaw = swayEuler.setFromQuaternion(swayRuntime.locomotionBones.head.quaternion, 'YXZ').y;
assert(dampedHeadYaw < clipHeadYaw * 0.3,
  `locomotion head sway is not damped (yaw ${dampedHeadYaw.toFixed(3)} rad)`);
swayRuntime.currentAction = 'idle';
for (let frame = 0; frame < 90; frame++) {
  swayRuntime.locomotionBones.head.quaternion.setFromEuler(swayEuler.set(0, clipHeadYaw, 0));
  fitApi.applyCharacterUpperBodySwayDamping(swayRuntime, 0.016);
}
const idleHeadYaw = swayEuler.setFromQuaternion(swayRuntime.locomotionBones.head.quaternion, 'YXZ').y;
assert(Math.abs(idleHeadYaw - clipHeadYaw) < 0.05,
  `idle head pose must stay untouched by sway damping (yaw ${idleHeadYaw.toFixed(3)} rad)`);

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
// Разворот таза ограничен по угловой скорости, поэтому цель берётся не за
// один кадр: гоняем кадры до сходимости и попутно следим, что ни один кадр не
// перекидывает ноги быстрее человеческого разворота.
let previousYaw = directionalRuntime.directionalLowerBodyYaw;
let maxYawRate = 0;
for (let frame = 0; frame < 240; frame += 1) {
  // Как в рантайме: поза снимается перед каждым кадром.
  if (frame > 0) fitApi.clearCharacterGlbDirectionalPose(directionalRuntime);
  fitApi.applyCharacterGlbDirectionalPose(directionalRuntime, rightLocomotion, 1 / 60);
  maxYawRate = Math.max(maxYawRate, Math.abs(directionalRuntime.directionalLowerBodyYaw - previousYaw) * 60);
  previousYaw = directionalRuntime.directionalLowerBodyYaw;
}
closeTo(
  directionalRoot.rotation.y,
  Math.PI + rightLocomotion.lowerBodyYaw,
  1e-3,
  'GLB lower-body movement heading'
);
assert(maxYawRate <= 5.3,
  `lower-body yaw whips at ${maxYawRate.toFixed(1)} rad/s; the rate limit is meant to keep it human`);
assert.strictEqual(directionalRuntime.directionalPoseOffsets.length, 6,
  'directional GLB pose is not distributed over the upper-body rig');
fitApi.clearCharacterGlbDirectionalPose(directionalRuntime);
assert.strictEqual(directionalRuntime.directionalPoseOffsets.length, 6,
  'directional GLB pose scratch was discarded instead of being reused');
assert.strictEqual(directionalRuntime.directionalPoseOffsetCount, 0,
  'directional GLB pose scratch remains logically active after cleanup');
for (const [key, bone] of Object.entries(directionalBones)) {
  // Допуск на накопленную ошибку float: выше прогнано 240 циклов
  // «наложить позу / снять позу» через умножение кватернионов.
  closeTo(bone.quaternion.angleTo(new THREE.Quaternion()), 0, 1e-5, `${key} pose cleanup`);
}

const legActor = new THREE.Group();
const legRoot = new THREE.Group();
const thigh = new THREE.Bone();
const calf = new THREE.Bone();
const foot = new THREE.Bone();
thigh.name = 'thigh_l';
calf.name = 'calf_l';
foot.name = 'foot_l';
thigh.position.set(0, 1, 0);
calf.position.set(0, -0.52, 0);
foot.position.set(0, -0.48, 0);
thigh.add(calf);
calf.add(foot);
legRoot.add(thigh);
legActor.add(legRoot);
legActor.updateMatrixWorld(true);
const legRuntime = { root: legRoot };
fitApi.captureCharacterFootIkRest(legActor, legRuntime);
const legChain = legRuntime.footIk?.chains?.l;
const legScratch = legRuntime.footIk?.solveScratch?.l;
assert(Array.isArray(legChain) && legChain.length === 3 && legScratch,
  'foot IK did not cache its left-leg chain and solve scratch');
const legScratchPositions = legScratch.positions.slice();
const legScratchObjects = [
  legScratch.base,
  legScratch.direction,
  legScratch.currentStart,
  legScratch.currentEnd,
  legScratch.currentDirection,
  legScratch.wantedDirection,
  legScratch.delta,
  legScratch.currentWorld,
  legScratch.parentWorld
];
const legTarget = new THREE.Vector3(0.18, 0.25, 0.12);
const solveLeg = () => fitApi.solveCharacterLegChain(
  legRoot,
  ['thigh_l', 'calf_l', 'foot_l'],
  legTarget,
  legChain,
  legScratch
);
assert.strictEqual(solveLeg(), true, 'cached foot IK failed its first reachable solve');
legRoot.updateMatrixWorld(true);
const firstLegEnd = foot.getWorldPosition(new THREE.Vector3());
const firstLegQuaternions = legChain.map(bone => bone.quaternion.clone());
legChain.forEach(bone => bone.quaternion.identity());
legRoot.updateMatrixWorld(true);
assert.strictEqual(solveLeg(), true, 'cached foot IK failed after resetting the same chain');
legRoot.updateMatrixWorld(true);
const secondLegEnd = foot.getWorldPosition(new THREE.Vector3());
assert(firstLegEnd.distanceTo(secondLegEnd) < 1e-7
  && secondLegEnd.distanceTo(legTarget) < 0.002,
'reused foot IK scratch changed the solved endpoint');
legChain.forEach((bone, index) => {
  assert(bone.quaternion.angleTo(firstLegQuaternions[index]) < 1e-7,
    `reused foot IK scratch changed bone ${bone.name}`);
});
assert.strictEqual(legRuntime.footIk.chains.l, legChain,
  'foot IK replaced its cached bone chain');
assert.strictEqual(legRuntime.footIk.solveScratch.l, legScratch,
  'foot IK replaced its cached solve scratch');
legScratchPositions.forEach((value, index) => {
  assert.strictEqual(legScratch.positions[index], value,
    `foot IK replaced scratch position ${index}`);
});
[
  legScratch.base,
  legScratch.direction,
  legScratch.currentStart,
  legScratch.currentEnd,
  legScratch.currentDirection,
  legScratch.wantedDirection,
  legScratch.delta,
  legScratch.currentWorld,
  legScratch.parentWorld
].forEach((value, index) => {
  assert.strictEqual(value, legScratchObjects[index],
    `foot IK replaced scratch object ${index}`);
});

const skeletonShareRoot = new THREE.Group();
const skeletonShareBoneRoot = new THREE.Bone();
const skeletonShareBoneChild = new THREE.Bone();
skeletonShareBoneRoot.name = 'skeleton_share_root';
skeletonShareBoneChild.name = 'skeleton_share_child';
skeletonShareBoneChild.position.set(0, 0.8, 0);
skeletonShareBoneRoot.add(skeletonShareBoneChild);
skeletonShareRoot.add(skeletonShareBoneRoot);
skeletonShareRoot.updateMatrixWorld(true);
const skeletonShareBones = [skeletonShareBoneRoot, skeletonShareBoneChild];
const skeletonShareInverses = skeletonShareBones.map(bone => (
  new THREE.Matrix4().copy(bone.matrixWorld).invert()
));
const skeletonShareGeometry = new THREE.BufferGeometry();
skeletonShareGeometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute([0.2, 0.45, -0.1], 3)
);
skeletonShareGeometry.setAttribute(
  'skinIndex',
  new THREE.Uint16BufferAttribute([0, 1, 0, 0], 4)
);
skeletonShareGeometry.setAttribute(
  'skinWeight',
  new THREE.Float32BufferAttribute([0.35, 0.65, 0, 0], 4)
);
const makeSkeletonShareMesh = ({
  bones = skeletonShareBones,
  inverses = skeletonShareInverses,
  bindMatrix = new THREE.Matrix4(),
  bindMode = 'attached'
} = {}) => {
  const mesh = new THREE.SkinnedMesh(
    skeletonShareGeometry,
    new THREE.MeshBasicMaterial({ skinning: true })
  );
  mesh.bindMode = bindMode;
  mesh.bind(
    new THREE.Skeleton(bones, inverses.map(matrix => matrix.clone())),
    bindMatrix.clone()
  );
  skeletonShareRoot.add(mesh);
  return mesh;
};
const skeletonShareCanonical = makeSkeletonShareMesh();
const skeletonShareCandidate = makeSkeletonShareMesh();
const distinctBoneRoot = skeletonShareBoneRoot.clone(true);
const skeletonShareDistinctBones = makeSkeletonShareMesh({
  bones: [distinctBoneRoot, distinctBoneRoot.children[0]]
});
const changedInverseMatrices = skeletonShareInverses.map(matrix => matrix.clone());
changedInverseMatrices[1].elements[12] += 0.01;
const skeletonShareChangedInverse = makeSkeletonShareMesh({ inverses: changedInverseMatrices });
const skeletonShareChangedBind = makeSkeletonShareMesh({
  bindMatrix: new THREE.Matrix4().makeTranslation(0.01, 0, 0)
});
const skeletonShareChangedMode = makeSkeletonShareMesh({ bindMode: 'detached' });
const incompatibleSkeletons = [
  skeletonShareDistinctBones,
  skeletonShareChangedInverse,
  skeletonShareChangedBind,
  skeletonShareChangedMode
].map(mesh => mesh.skeleton);
const candidateSkeletonBeforeShare = skeletonShareCandidate.skeleton;
const candidateBindMatrixBeforeShare = skeletonShareCandidate.bindMatrix.clone();
const candidateBindMatrixInverseBeforeShare = skeletonShareCandidate.bindMatrixInverse.clone();
const candidateBindModeBeforeShare = skeletonShareCandidate.bindMode;
const candidateBoneInversesBeforeShare = skeletonShareCandidate.skeleton.boneInverses.map(matrix => (
  matrix.clone()
));
const skinnedShareVertex = mesh => {
  mesh.skeleton.update();
  const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0);
  mesh.boneTransform(0, vertex);
  return vertex;
};
skeletonShareBoneChild.rotation.set(0.17, -0.08, 0.23);
skeletonShareRoot.updateMatrixWorld(true);
const candidateSkinBeforeShare = skinnedShareVertex(skeletonShareCandidate);
assert.strictEqual(
  fitApi.compatibleCharacterSkeletonMeshes(skeletonShareCanonical, skeletonShareCandidate),
  true,
  'equivalent primitive skeletons were not recognized as compatible'
);
assert.strictEqual(fitApi.shareCompatibleCharacterSkeletons(skeletonShareRoot), 1,
  'character skeleton sharing did not replace exactly one compatible duplicate');
assert.strictEqual(skeletonShareCandidate.skeleton, skeletonShareCanonical.skeleton,
  'compatible primitive meshes do not share one Skeleton identity');
assert.notStrictEqual(skeletonShareCandidate.skeleton, candidateSkeletonBeforeShare,
  'compatible primitive mesh retained its duplicate Skeleton object');
assert(skeletonShareCandidate.bindMatrix.equals(candidateBindMatrixBeforeShare)
  && skeletonShareCandidate.bindMatrixInverse.equals(candidateBindMatrixInverseBeforeShare)
  && skeletonShareCandidate.bindMode === candidateBindModeBeforeShare,
'skeleton sharing changed a primitive bind transform or bind mode');
candidateBoneInversesBeforeShare.forEach((matrix, index) => {
  assert(skeletonShareCandidate.skeleton.boneInverses[index].equals(matrix),
    `skeleton sharing changed bone inverse ${index}`);
});
const candidateSkinAfterShare = skinnedShareVertex(skeletonShareCandidate);
assert(candidateSkinAfterShare.distanceTo(candidateSkinBeforeShare) < 1e-7,
  'skeleton sharing changed the CPU-skinned vertex result');
[
  skeletonShareDistinctBones,
  skeletonShareChangedInverse,
  skeletonShareChangedBind,
  skeletonShareChangedMode
].forEach((mesh, index) => {
  assert.strictEqual(mesh.skeleton, incompatibleSkeletons[index],
    'an incompatible primitive skeleton was shared');
});

let compatibilityCount = 0;
assert.deepStrictEqual(
  Array.from(fitApi.CHARACTER_HAIR_OPTIONS, option => option.id),
  expectedHairCatalog,
  'authored hairstyle catalog drifted'
);
for (const sex of ['female', 'male']) {
  assert.deepStrictEqual(
    Array.from(fitApi.CHARACTER_FACE_OPTIONS[sex], option => option.id),
    expectedFaces[sex],
    `${sex}: face catalog drifted`
  );
  assert.deepStrictEqual(
    Array.from(fitApi.characterHairOptionsForSex(sex), option => option.id),
    expectedHair[sex],
    `${sex}: sex-compatible hairstyle catalog drifted`
  );
  assert.deepStrictEqual(
    Array.from(fitApi.CHARACTER_HAIR_COLOR_OPTIONS, option => [option.id, option.hex]),
    expectedHairColors,
    'hair color catalog drifted'
  );
  for (const bodyType of ['slim', 'medium', 'large']) {
    for (const faceId of expectedFaces[sex]) {
      for (const hairId of expectedHair[sex]) {
        for (const [hairColorId] of expectedHairColors) {
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
          compatibilityCount += 1;
        }
      }
    }
  }

  const unsupportedHair = legacyServerHair.filter(hairId => !expectedHair[sex].includes(hairId));
  const authoredDefault = sex === 'female' ? 'tied_back' : 'short_crop';
  unsupportedHair.forEach(hairId => {
    assert.strictEqual(
      fitApi.normalizeCharacterAppearance({ sex, hairId }).hairId,
      authoredDefault,
      `${sex}/${hairId}: unsupported legacy hairstyle did not normalize to the authored default`
    );
  });

  const hairRoot = new THREE.Group();
  const hairMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  hairMaterial.userData.characterGlbInstanceMaterial = true;
  const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), hairMaterial);
  hairMesh.name = sex === 'female' ? 'hair_tied_back' : 'hair_short_crop';
  hairMesh.userData.realm_character_layer = 'hair';
  hairRoot.add(hairMesh);
  for (const hairId of expectedHair[sex]) {
    for (const [hairColorId, hairHex] of expectedHairColors) {
      fitApi.applyCharacterGlbVisualVariants(hairRoot, { sex, hairId, hairColorId });
      assert.strictEqual(hairMesh.visible, hairId !== 'shaved',
        `${sex}/${hairId}: authored hair visibility is wrong`);
      assert.strictEqual(hairMaterial.userData.characterGlbHairTintId, hairColorId,
        `${sex}/${hairId}/${hairColorId}: per-instance tint marker is missing`);
      const expectedColor = new THREE.Color(hairHex);
      expectedColor.convertSRGBToLinear?.();
      assert(Math.max(
        Math.abs(hairMaterial.color.r - expectedColor.r),
        Math.abs(hairMaterial.color.g - expectedColor.g),
        Math.abs(hairMaterial.color.b - expectedColor.b)
      ) < 1e-7,
        `${sex}/${hairId}/${hairColorId}: authored hair material was not tinted`);
    }
  }
  const visibleAppearance = { sex, hairId: authoredDefault, hairColorId: 'hair_03' };
  fitApi.applyCharacterGlbVisualVariants(hairRoot, visibleAppearance, { helmetOn: true });
  assert.strictEqual(hairMesh.visible, false, `${sex}: helmet did not hide authored hair`);
  fitApi.applyCharacterGlbVisualVariants(hairRoot, visibleAppearance, { helmetOn: false });
  assert.strictEqual(hairMesh.visible, true, `${sex}: removing a helmet did not restore authored hair`);
  hairMesh.geometry.dispose();
  hairMaterial.dispose();
}
assert.strictEqual(compatibilityCount, 384, 'appearance compatibility matrix is incomplete');

const sharedTemplateHairRoot = new THREE.Group();
const sharedTemplateHairMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff' });
sharedTemplateHairMaterial.userData.characterGlbTemplateMaterial = true;
sharedTemplateHairMaterial.userData.characterGlbInstanceMaterial = false;
const sharedTemplateHairMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 0.1, 0.1),
  sharedTemplateHairMaterial
);
sharedTemplateHairMesh.name = 'hair_short_crop';
sharedTemplateHairMesh.userData.realm_character_layer = 'hair';
sharedTemplateHairRoot.add(sharedTemplateHairMesh);
const sharedTemplateColor = sharedTemplateHairMaterial.color.clone();
fitApi.applyCharacterGlbVisualVariants(sharedTemplateHairRoot, {
  sex: 'male',
  hairId: 'short_crop',
  hairColorId: 'hair_08'
});
assert(sharedTemplateHairMaterial.color.equals(sharedTemplateColor),
  'appearance tint mutated an immutable shared GLB template material');
assert.strictEqual(sharedTemplateHairMaterial.userData.characterGlbHairTintId, undefined,
  'shared GLB template material received an instance tint marker');
sharedTemplateHairMesh.geometry.dispose();
sharedTemplateHairMaterial.dispose();

console.log(
  'Character models OK: 6 GLB bases, 8 faces, 2 sex-compatible hairstyles each, 8 hair colors, '
  + '384 normalized appearance combinations, authored GLB hair visibility/tinting, 8-way cursor-relative locomotion and turn-in-place steps, '
  + 'blink/hurt/attack/talk/death facial reactions, rig/animations and hashes checked'
);
