'use strict';
// Устойчивость позы: правки, которые Unity вносит ПОСЛЕ анимации (поза
// направления, присед, реакция на удар, травмы), обязаны сниматься перед
// следующим кадром.
//
// Почему это отдельная проверка: Legacy Animation перестаёт писать кость, когда
// клип её больше не трогает (закончился Once-клип, статичные ноги в attack), и
// несnятая аддитивная правка складывается сама с собой кадр за кадром. На
// практике у стреляющего НПС нога уезжала выше головы. Проверяются рантайм
// Unity и его пробники.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UNITY_GAME = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game');
const UNITY_WORLD = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'World');

async function main() {
  const playerController = fs.readFileSync(path.join(UNITY_GAME, 'RoaPlayerController.cs'), 'utf8');
  const locomotionPresentation = fs.readFileSync(path.join(UNITY_GAME, 'RoaLocomotionPresentation.cs'), 'utf8');
  const characterView = fs.readFileSync(path.join(UNITY_GAME, 'RoaCharacterView.cs'), 'utf8');
  const hitReaction = fs.readFileSync(path.join(UNITY_GAME, 'RoaHitReaction.cs'), 'utf8');
  const presentationLod = fs.readFileSync(path.join(UNITY_GAME, 'RoaActorPresentationLod.cs'), 'utf8');
  const groundShadow = fs.readFileSync(path.join(UNITY_GAME, 'RoaActorGroundShadow.cs'), 'utf8');
  const hitProbe = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaHitReactionProbe.cs'), 'utf8');
  const remoteDeathProbe = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaRemoteDeathProbe.cs'), 'utf8');
  const npcCombatProbe = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaNpcCombatBehaviorProbe.cs'), 'utf8');
  const characterPreviewProbe = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaCharacterPreviewProbe.cs'), 'utf8');
  const auditRunner = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs'), 'utf8');
  const enemies = fs.readFileSync(path.join(UNITY_GAME, 'RoaEnemies.cs'), 'utf8');
  const ikChain = fs.readFileSync(path.join(UNITY_GAME, 'RoaIkChain.cs'), 'utf8');
  const weaponView = fs.readFileSync(path.join(UNITY_GAME, 'RoaWeaponView.cs'), 'utf8');
  const remotePlayers = fs.readFileSync(path.join(UNITY_GAME, 'RoaRemotePlayers.cs'), 'utf8');
  const combat = fs.readFileSync(path.join(UNITY_GAME, 'RoaCombat.cs'), 'utf8');
  const locationLoader = fs.readFileSync(path.join(UNITY_WORLD, 'RoaLocationLoader.cs'), 'utf8');

  assert(playerController.includes('Vector3 actual = (transform.position - before) / frameDt;')
    && playerController.includes('ResolveCollisionVelocity(')
    && playerController.includes('SmoothVisualVelocity(')
    && locomotionPresentation.includes('Vector3.ProjectOnPlane(requestedVelocity, collisionNormal)')
    && locomotionPresentation.includes('return target / targetSpeed * nextSpeed;')
    && !playerController.includes('Vector3.MoveTowards(_visualVelocity, actual'),
  'Unity locomotion no longer uses collision-resolved displacement with direction-safe speed smoothing');
  assert(playerController.includes('_controller.enableOverlapRecovery = true;')
    && playerController.includes('OnControllerColliderHit'),
  'Unity CharacterController lost overlap recovery or collision diagnostics');
  assert(characterView.includes('_weapon.CancelAttackPose()')
    && characterView.includes('_animation.Play(_currentClip, PlayMode.StopAll)')
    && characterView.includes('_animation.Stop();')
    && enemies.includes('ResolveSnapshotDeadState(wasDead, snapshotDead)')
    && enemies.includes('enemy.Moving = !resolvedDead')
    && enemies.includes('enemy.Snapshot["dead"] = resolvedDead;')
    && enemies.includes('InstallPresentationBody(root, bodyProfile,')
    && enemies.includes('ResolvePresentationContact(presentedPosition,')
    && enemies.includes('contactConstrained ? 1f : 0f)')
    && enemies.includes('CombatMotionLocked(enemy.Dead, enemy.ThreatActive,')
    && enemies.includes('enemy.ActionUntil, enemy.ReactionUntil, Time.time)')
    && enemies.includes('enemy.Hp = ResolveFrameHealth(previousHp, frameHp, deadFrame,')
    && npcCombatProbe.includes('RoaCharacterView.IsActorCollider(capsule, null)')
    && auditRunner.includes('typeof(RoaNpcCombatBehaviorProbe)'),
  'Unity combat pose no longer keeps death authoritative over stale movement');
  assert(characterView.includes('SetGroundingLod(bool active)')
    && characterView.includes('_groundShadow.SetActive(active)')
    && presentationLod.includes('DesktopNearDistance = 20f')
    && presentationLod.includes('MobileNearDistance = 12f')
    && presentationLod.includes('if (!visible) return RoaActorPresentationTier.Hidden;')
    && characterView.includes('SetPresentationLod(RoaActorPresentationTier tier)')
    && characterView.includes('AnimationCullingType.BasedOnRenderers')
    && characterView.includes('ResetProceduralPresentation()')
    && remotePlayers.includes('RoaActorPresentationLod.Select(')
    && enemies.includes('RoaActorPresentationLod.Select('),
  'Unity actor presentation lost visibility/distance LOD or stale-state reset');
  assert(groundShadow.includes('public sealed class RoaActorGroundShadow')
    && groundShadow.includes('ProceduralActorContactShadow')
    && groundShadow.includes('_renderer.sharedMaterial = _sharedMaterial;')
    && groundShadow.includes('Shader.Find("Sprites/Default")')
    && groundShadow.includes('mesh.colors = new[] { Color.white')
    && groundShadow.includes('Quaternion.FromToRotation(Vector3.up, groundNormal)')
    && characterView.includes('_groundShadow.UpdatePose(actorPosition, groundY, normal'),
  'Unity humanoids lost the shared slope-aware procedural contact shadow');
  assert(auditRunner.includes('typeof(RoaLocomotionContactProbe)'),
  'Locomotion contact probe is not part of the batch Unity audit');
  assert(characterPreviewProbe.includes('for (int frame = 0; frame < 32; frame++)')
    && characterPreviewProbe.includes('hurt.time = Mathf.Min(0.14f')
    && characterPreviewProbe.includes('animation.IsPlaying("death") && !animation.IsPlaying("run")'),
  'Real GLB probe no longer sweeps the run clip or guards the hurt/death clip handoff');
  assert(ikChain.includes('Vector3? pole')
    && ikChain.includes('ApplyPoleConstraint(pole.Value)')
    && weaponView.includes('ArmPole(true)')
    && weaponView.includes('ArmPole(false)'),
  'Unity arm IK lost elbow pole constraints');
  assert(weaponView.includes('Physics.SphereCastNonAlloc')
    && weaponView.includes('ObstructionAmount(start, end, ObstructionRadius, _owner, _weapon)')
    && weaponView.includes('SmoothObstruction(_obstructedBlend, target, Time.deltaTime)')
    && weaponView.includes('1f - Mathf.Exp(-rate * Mathf.Clamp(dt, 0f, 0.1f))')
    && !weaponView.includes('ObstructionProbes'),
  'Unity weapon obstruction lost distance-aware owner filtering or frame-rate independent smoothing');
  assert(hitReaction.includes('public sealed class RoaHitReaction')
    && hitReaction.includes('public static float Envelope(float elapsed)')
    && hitReaction.includes('public static PoseSample Sample(Vector2 localSource, float weight)')
    && hitReaction.includes('actor.InverseTransformDirection(delta.normalized)')
    && characterView.includes('bool fullBody = !_hitReaction.Ready')
    && characterView.includes('if (locomoting && _presentationTier == RoaActorPresentationTier.Near)')
    && characterView.includes('_hitReaction.Apply(Time.deltaTime)')
    && characterView.indexOf('_hitReaction.Apply(Time.deltaTime)') < characterView.indexOf('_weapon.Apply(_aimPoint, _hasAim)')
    && combat.includes('Player.View?.PlayHit(source, damage, critical)')
    && remotePlayers.includes('remote.View.PlayHit(source, damage, critical)')
    && hitProbe.includes('[РЕАКЦИЯ НА УРОН] готово:')
    && auditRunner.includes('typeof(RoaHitReactionProbe)')
    && characterPreviewProbe.includes('ROA_UNITY_HIT_CAPTURE'),
  'Unity directional hit reaction lost locomotion preservation, source wiring, IK order or visual probe');
  assert(remotePlayers.includes('private const float DeathVisualLifetime = 3.2f;')
    && remotePlayers.includes('_remotes.Remove(id);')
    && remotePlayers.includes('remote.View?.SetDead(true);')
    && remotePlayers.includes('collider.enabled = false;')
    && remotePlayers.includes('UpdateDeathVisuals(Time.unscaledTime);')
    && remotePlayers.includes('BeginRemoteDeath(player.Id, Time.unscaledTime)')
    && characterView.includes('if (_dead) SetDead(true);')
    && remoteDeathProbe.includes('[СМЕРТЬ ИГРОКА] готово:')
    && remoteDeathProbe.includes('RoaEnemies.ResolveSnapshotDeadState(true, false)')
    && remoteDeathProbe.includes('view.ApplyDeathSettleForDiagnostics(RoaCharacterView.DeathSettleSeconds)')
    && characterView.includes('DeathSettleWeightAt(float elapsed)')
    && characterView.includes('ApplyDeathSettleForDiagnostics(deathElapsed)')
    && characterView.includes('FreezeDeathPose(deathElapsed)')
    && characterView.includes('death.time = FinalDeathPoseTime(death)')
    && characterView.includes('GroundDeathForDiagnostics(deathGroundY)')
    && characterView.includes('DeathContactBones')
    && characterView.includes('TryGetDeathShadowCenter(out Vector3 corpseCenter)')
    && groundShadow.includes('Mathf.Lerp(1.12f, 2.10f, deathWeight)')
    && auditRunner.includes('typeof(RoaRemoteDeathProbe)')
    && characterPreviewProbe.includes('ROA_UNITY_DEATH_CAPTURE')
    && characterPreviewProbe.includes('утверждённый death-клип снова обрезан до фазы наклона')
    && characterPreviewProbe.includes('deathGroundGap > -0.06f && deathGroundGap < 0.12f')
    && characterPreviewProbe.includes('камера не обновила skinned bounds финального death-кадра')
    && characterPreviewProbe.includes('повторное заземление изменило высоту тела между кадрами')
    && characterPreviewProbe.includes('loaded.DeathGroundContactBones == 4'),
  'Unity remote player death lost non-targetable retained visual, expiry, late-load recovery or visual probe');

  assert(remotePlayers.includes('RoaCombatFx.TryShotEndpoints(payload, out start, out end)')
    && remotePlayers.includes('remote.View.SetAim(remote.AimPoint, Time.time < remote.AimUntil)')
    && remotePlayers.includes('remote.TargetYawDeg = RoaCoords.AngleToYawDeg'),
  'Unity remote combat pose no longer follows the relayed shot direction');
  assert(characterView.includes('nextState.normalizedTime = phase;')
    && characterView.includes('SyncedLocomotionPhase(previous, clip')
    && characterView.includes('FastGaitPhaseOffset = -1f / 6f')
    && characterView.includes('IsCyclicLocomotion'),
  'Unity locomotion transitions no longer preserve contact-aligned gait phase');
  assert(locationLoader.includes('SceneManager.LoadSceneAsync(unitySceneName, LoadSceneMode.Additive)')
    && locationLoader.includes('unityScene.TryGetObject(entry.Id, out GameObject sceneObject)')
    && locationLoader.includes('_objectRoots[entry.Id] = sceneObject;')
    && locationLoader.includes('unityScene.ReplaceServerStaticGeometry')
    && !locationLoader.includes('AddComponent<BoxCollider>'),
  'Unity no longer preserves authored scene geometry/colliders without legacy fallback duplicates');

  // Процедурные смещения костей (травмы, презентация активности, реакция на
  // удар) аддитивны. Legacy Animation перестаёт писать кости после клипа Once,
  // и без окна Begin/End смещение копилось бы каждый кадр (нога уходила по кругу).
  const characterViewSource = fs.readFileSync(path.join(UNITY_GAME, 'RoaCharacterView.cs'), 'utf8')
    .replace(/\r\n/g, '\n');
  // Окно открывается ДО направленной позы/приседа (RoaCharacterPose тоже пишет
  // таз и позвоночник аддитивно) и закрывается после травм.
  const beginAt = characterViewSource.indexOf('BeginBoneOffsets();\n            if (_pose.Ready)');
  const poseApplyAt = characterViewSource.indexOf('_pose.Apply();');
  const activityAt = characterViewSource.indexOf('ApplyActivityPresentation(Time.deltaTime);');
  const endAt = characterViewSource.indexOf('ApplyInjuryPose();\n            EndBoneOffsets();');
  assert(beginAt > 0 && poseApplyAt > beginAt && activityAt > poseApplyAt && endAt > activityAt,
    'RoaCharacterView: поза, активность, удар и травмы должны идти внутри окна BeginBoneOffsets/EndBoneOffsets');
  assert(characterViewSource.includes('"pelvis"') && characterViewSource.includes('"neck_01"'),
    'RoaCharacterView: таз и шея (neck_01) должны быть зарегистрированы в окне смещений');
  const frozenBoneProbeSource = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaFrozenBoneProbe.cs'), 'utf8');
  assert(frozenBoneProbeSource.includes('view.UpdateLocomotion(Vector3.zero, 0f, false, true)')
    && frozenBoneProbeSource.includes('crouchDrift < 0.5f')
    && frozenBoneProbeSource.includes('таз кувыркается в приседе на замороженной анимации'),
    'RoaFrozenBoneProbe: нет проверки, что таз не кувыркается в приседе на замороженной анимации');
  assert(characterViewSource.includes('bone.localRotation = state.Base;')
    && characterViewSource.includes('entry.Value.Written = entry.Key.localRotation;')
    && characterViewSource.includes('_boneOffsets.Clear();'),
    'RoaCharacterView: смещения костей больше не откатываются на замороженной анимации');
  assert(characterPreviewProbe.includes('animation.Stop();')
    && characterPreviewProbe.includes('frozenDrift < 0.5f')
    && characterPreviewProbe.includes('нога с переломом крутится на замороженной анимации')
    && characterPreviewProbe.includes('healedDrift < 0.5f'),
    'RoaCharacterPreviewProbe: нет проверки, что нога с переломом не крутится на замороженной анимации');
  // Синхронный пробник на теле из каталога префабов: работает без сети и без
  // фокуса окна редактора (через RoaAgentGate executeMenu).
  const frozenBoneProbePath = path.join(ROOT, 'unity-client', 'Assets', 'Editor', 'RoaFrozenBoneProbe.cs');
  const frozenBoneProbe = fs.readFileSync(frozenBoneProbePath, 'utf8');
  assert(frozenBoneProbe.includes('[MenuItem("Realm of Ashes/Проверить заморозку костей (перелом ноги)")]')
    && frozenBoneProbe.includes('animation.Stop();')
    && frozenBoneProbe.includes('for (int frame = 0; frame < 60; frame++)')
    && frozenBoneProbe.includes('drift < 0.5f && maxDrift < 0.5f')
    && frozenBoneProbe.includes('healed < 0.5f')
    && frozenBoneProbe.includes('["brokenLeg"] = true'),
    'RoaFrozenBoneProbe: синхронная проверка заморозки костей потеряла перелом ноги, 60 кадров или допуски');
  assert(/guid:\s*[0-9a-f]{32}/i.test(fs.readFileSync(frozenBoneProbePath + '.meta', 'utf8')),
    'RoaFrozenBoneProbe.cs.meta отсутствует или без GUID');

  console.log(
    'Character pose stability OK: окно смещений костей Unity, смерть, реакция на удар, LOD '
    + 'и пробники заморозки костей на месте'
  );
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
