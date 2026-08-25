'use strict';
// Устойчивость позы: правки, которые рантайм вносит ПОСЛЕ микшера (IK стоп,
// прижим верха тела), обязаны сниматься перед следующим микшером.
//
// Почему это отдельная проверка: three.js не записывает кость, если значение
// клипа не изменилось с прошлого кадра (PropertyMixer сравнивает с тем, что
// записал сам). В клипах со статичными ногами — например, в боевом attack —
// микшер перестаёт их трогать, и несnятая правка IK складывается сама с собой
// кадр за кадром. На практике у стреляющего НПС нога уезжала выше головы.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_SOURCE = path.join(ROOT, 'public', 'js', 'game', '04b_character_glb_runtime.js');
const CHARACTER_FILE = path.join(ROOT, 'public', 'assets', 'models', 'characters', 'base', 'character_male_medium.glb');
const DONOR_FILE = path.join(ROOT, 'public', 'assets', 'models', 'characters', 'npc', 'npc_humanoid_animations.glb');
const UNITY_GAME = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game');
const UNITY_WORLD = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'World');

const MAX_FOOT_DRIFT = 0.03;   // м, за 6 секунд непрерывной анимации
const ONE_SHOT_CLIPS = ['attack', 'hurt', 'death'];

async function main() {
  const playerController = fs.readFileSync(path.join(UNITY_GAME, 'RoaPlayerController.cs'), 'utf8');
  const characterView = fs.readFileSync(path.join(UNITY_GAME, 'RoaCharacterView.cs'), 'utf8');
  const footIk = fs.readFileSync(path.join(UNITY_GAME, 'RoaFootIk.cs'), 'utf8');
  const presentationLod = fs.readFileSync(path.join(UNITY_GAME, 'RoaActorPresentationLod.cs'), 'utf8');
  const groundShadow = fs.readFileSync(path.join(UNITY_GAME, 'RoaActorGroundShadow.cs'), 'utf8');
  const groundingProbe = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaGroundingProbe.cs'), 'utf8');
  const auditRunner = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs'), 'utf8');
  const enemies = fs.readFileSync(path.join(UNITY_GAME, 'RoaEnemies.cs'), 'utf8');
  const ikChain = fs.readFileSync(path.join(UNITY_GAME, 'RoaIkChain.cs'), 'utf8');
  const weaponView = fs.readFileSync(path.join(UNITY_GAME, 'RoaWeaponView.cs'), 'utf8');
  const remotePlayers = fs.readFileSync(path.join(UNITY_GAME, 'RoaRemotePlayers.cs'), 'utf8');
  const locationLoader = fs.readFileSync(path.join(UNITY_WORLD, 'RoaLocationLoader.cs'), 'utf8');

  assert(playerController.includes('Vector3 actual = (transform.position - before) / frameDt;')
    && playerController.includes('_visualVelocity = Vector3.MoveTowards'),
  'Unity locomotion no longer uses collision-resolved displacement with visual smoothing');
  assert(playerController.includes('_controller.enableOverlapRecovery = true;')
    && playerController.includes('OnControllerColliderHit'),
  'Unity CharacterController lost overlap recovery or collision diagnostics');
  assert(footIk.includes('Physics.SphereCastNonAlloc')
    && footIk.includes('side.LockNormal = surfaceNormal;')
    && footIk.includes('ApplyFootNormal(side, contactNormal, normalWeight)'),
  'Unity foot IK no longer follows per-foot ground height and normal');
  assert(footIk.includes('DesktopMaxDistance = 20f')
    && footIk.includes('MobileMaxDistance = 12f')
    && footIk.includes('public static bool ShouldRun(')
    && footIk.includes('public void Reset()')
    && characterView.includes('SetGroundingLod(bool active)')
    && characterView.includes('if (_groundingActive)')
    && presentationLod.includes('DesktopNearDistance = 20f')
    && presentationLod.includes('MobileNearDistance = 12f')
    && presentationLod.includes('if (!visible) return RoaActorPresentationTier.Hidden;')
    && characterView.includes('SetPresentationLod(RoaActorPresentationTier tier)')
    && characterView.includes('AnimationCullingType.BasedOnRenderers')
    && characterView.includes('ResetProceduralPresentation()')
    && remotePlayers.includes('RoaActorPresentationLod.Select(')
    && enemies.includes('RoaActorPresentationLod.Select('),
  'Unity foot IK lost visibility/distance LOD or stale-state reset');
  assert(groundShadow.includes('public sealed class RoaActorGroundShadow')
    && groundShadow.includes('ProceduralActorContactShadow')
    && groundShadow.includes('_renderer.sharedMaterial = _sharedMaterial;')
    && groundShadow.includes('Shader.Find("Sprites/Default")')
    && groundShadow.includes('mesh.colors = new[] { Color.white')
    && groundShadow.includes('Quaternion.FromToRotation(Vector3.up, groundNormal)')
    && characterView.includes('_groundShadow.UpdatePose(transform.position, groundY, normal'),
  'Unity humanoids lost the shared slope-aware procedural contact shadow');
  assert(groundingProbe.includes('[КОНТАКТ С ЗЕМЛЁЙ] готово:')
    && groundingProbe.includes('ik.GroundProbeCount == 2')
    && groundingProbe.includes('rightFoot.position.y > leftFoot.position.y + 0.12f')
    && groundingProbe.includes('SharedUsers == usersBefore')
    && auditRunner.includes('typeof(RoaGroundingProbe)'),
  'Unity grounding probe no longer verifies step height, LOD and shared-resource cleanup');
  assert(ikChain.includes('Vector3? pole')
    && ikChain.includes('ApplyPoleConstraint(pole.Value)')
    && weaponView.includes('ArmPole(true)')
    && weaponView.includes('ArmPole(false)'),
  'Unity arm IK lost elbow pole constraints');
  assert(weaponView.includes('Physics.SphereCastNonAlloc')
    && weaponView.includes('IsSegmentBlocked(start, end, ObstructionRadius, _owner, _weapon)')
    && !weaponView.includes('ObstructionProbes'),
  'Unity weapon obstruction is no longer a continuous owner-filtered sweep');
  assert(remotePlayers.includes('RoaCombatFx.TryShotEndpoints(payload, out start, out end)')
    && remotePlayers.includes('remote.View.SetAim(remote.AimPoint, Time.time < remote.AimUntil)')
    && remotePlayers.includes('remote.TargetYawDeg = RoaCoords.AngleToYawDeg'),
  'Unity remote combat pose no longer follows the relayed shot direction');
  assert(characterView.includes('nextState.normalizedTime = phase;')
    && characterView.includes('IsCyclicLocomotion'),
  'Unity locomotion transitions no longer preserve gait phase');
  assert(locationLoader.includes('root.InverseTransformPoint(sourceTransform.TransformPoint(point))')
    && locationLoader.includes('filter.sharedMesh.bounds'),
  'Unity fallback colliders are no longer rebuilt in object-local space');

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

  const runtimeSource = fs.readFileSync(RUNTIME_SOURCE, 'utf8');
  const context = vm.createContext({ THREE, console, performance });
  vm.runInContext(`${runtimeSource}
this.__poseApi = {
  characterTurnInPlaceState,
  updateCharacterGlbAnimation,
  setCharacterGlbAction,
  captureCharacterFootIkRest,
  captureCharacterUpperBodyRest,
  characterGlbActions
};`, context, { filename: '04b_character_glb_runtime.js' });
  const api = context.__poseApi;

  // Правки после микшера обязаны иметь парное снятие перед ним.
  assert(runtimeSource.includes('function clearCharacterFootIkPose('),
    'нет снятия позы IK стоп перед микшером');
  assert(runtimeSource.includes('function clearCharacterUpperSwayPose('),
    'нет снятия прижима верха тела перед микшером');
  assert(/clearCharacterGlbDirectionalPose\(runtime\);\s*\n\s*clearCharacterFootIkPose\(runtime\);\s*\n\s*clearCharacterUpperSwayPose\(runtime\);/.test(runtimeSource),
    'снятие поз не выполняется перед mixer.update');

  const character = await load(CHARACTER_FILE);
  const donor = await load(DONOR_FILE);

  const root = character.scene;
  root.rotation.y = Math.PI;
  const mixer = new THREE.AnimationMixer(root);
  const actions = api.characterGlbActions(mixer, character.animations || []);
  for (const clip of donor.animations || []) {
    const name = String(clip.name).toLowerCase();
    if (actions[name]) continue;
    const action = mixer.clipAction(clip, root);
    action.enabled = true;
    if (ONE_SHOT_CLIPS.includes(name)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    actions[name] = action;
  }

  const actor = new THREE.Group();
  actor.add(root);
  const runtime = {
    key: 'male_medium',
    appearance: { sex: 'male', bodyType: 'medium' },
    root,
    mixer,
    actions,
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
  actor.userData.characterGlbRuntime = runtime;
  api.captureCharacterFootIkRest(actor, runtime);
  api.captureCharacterUpperBodyRest(runtime);
  api.setCharacterGlbAction(runtime, 'idle', 0);

  const head = root.getObjectByName('head');
  const feet = { l: root.getObjectByName('foot_l'), r: root.getObjectByName('foot_r') };
  assert(head && feet.l && feet.r, 'в базовой модели нет головы или стоп');

  const DT = 1 / 60;
  const worldY = (object) => object.getWorldPosition(new THREE.Vector3()).y;
  let token = 0;
  let maxFoot = -Infinity;
  let minHead = Infinity;
  actor.position.set(0, 0, 0);
  actor.rotation.y = Math.PI;

  // Шесть секунд стрельбы очередями на месте — режим, в котором ноги
  // статичны и микшер перестаёт их писать.
  for (let frame = 0; frame < 360; frame += 1) {
    const phase = (frame * DT) % 0.75;
    const attacking = phase < 0.35;
    if (attacking && phase < DT) token += 1;
    const turnInPlace = api.characterTurnInPlaceState(actor, 0, false, DT);
    api.updateCharacterGlbAnimation(actor, DT, {
      moving: false,
      speed: 0,
      moveX: 0,
      moveZ: 0,
      facingAngle: 0,
      attacking,
      attackToken: token,
      footIk: true,
      turning: turnInPlace.turning,
      turnAmount: turnInPlace.amount
    });
    actor.updateMatrixWorld(true);
    maxFoot = Math.max(maxFoot, worldY(feet.l), worldY(feet.r));
    minHead = Math.min(minHead, worldY(head));
  }

  const restHeight = Math.max(
    Number(runtime.footIk?.restHeights?.l || 0),
    Number(runtime.footIk?.restHeights?.r || 0)
  );
  assert(restHeight > 0, 'высота покоя стоп не захвачена');
  const drift = maxFoot - restHeight;
  assert(
    drift <= MAX_FOOT_DRIFT,
    `стопа стреляющего НПС уходит на ${drift.toFixed(2)} м выше опоры `
    + `(допуск ${MAX_FOOT_DRIFT} м) — правка после микшера копится кадр за кадром`
  );
  assert(
    maxFoot < minHead - 0.8,
    `стопа поднимается почти до головы: стопа ${maxFoot.toFixed(2)} м, голова ${minHead.toFixed(2)} м`
  );

  console.log(
    `Character pose stability OK: 6 с стрельбы на месте, стопа не выше `
    + `${drift.toFixed(3)} м над опорой, голова ${minHead.toFixed(2)} м`
  );
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
