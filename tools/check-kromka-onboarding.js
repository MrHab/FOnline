#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  advanceKromkaOnboarding,
  initialKromkaOnboarding,
  recordOnboardingEvidence,
  sanitizeKromkaOnboarding,
  publicKromkaOnboarding,
  skipKromkaTutorial
} = require('../src/server/kromka-onboarding');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/onboarding.json'), 'utf8'));
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const unity = fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Game/RoaKromkaOnboarding.cs'), 'utf8');
const interaction = fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Game/RoaInteraction.cs'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs'), 'utf8');
const cinematic = fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Game/RoaCaravanDepartureCinematic.cs'), 'utf8');
const cinematicProbe = fs.readFileSync(path.join(root,
  'unity-client/Assets/Editor/RoaCaravanDepartureCinematicProbe.cs'), 'utf8');
const auditRunner = fs.readFileSync(path.join(root,
  'unity-client/Assets/Editor/RoaClientAuditRunner.cs'), 'utf8');
const dialogue = fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Game/RoaDialogueCanvas.cs'), 'utf8');
const socket = fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Net/RoaSocketClient.cs'), 'utf8');
const location = JSON.parse(fs.readFileSync(path.join(root,
  'data/locations/tutorialCaravanYard.json'), 'utf8'));
const firstMissionLocation = JSON.parse(fs.readFileSync(path.join(root,
  'data/locations/randomRuinedRoad.json'), 'utf8'));

assert.strictEqual(catalog.tutorial.steps.length, 12, 'Preparation must teach twelve practical stages');
assert.strictEqual(catalog.firstMission.steps.length, 6, 'First mission must have six authored objectives');
const departure = catalog.tutorial.steps.find(step => step.id === 'departure');
assert.strictEqual(departure?.cinematicId, 'caravan_departure_ambush',
  'Departure must explicitly author its cinematic');
assert.strictEqual(location.privateInstance, true, 'Every player needs a private tutorial yard');
assert.strictEqual(location.allowGlobalMapExit, false, 'Tutorial yard must not expose a global-map exit');
assert.strictEqual(location.name, 'Сборный двор №12');
const tutorialCover = location.objects.find(row => row.id === 'yard_cover_a');
assert(tutorialCover, 'Tutorial cover must retain its stable objective ID');
assert.strictEqual(tutorialCover.model, 'tutorialRoadBarrier', 'Tutorial cover must use the current imported Unity barrier');
assert.strictEqual(tutorialCover.collision, 'solid', 'Replacing the cover must not disable collision');
assert.strictEqual(tutorialCover.vision.blocks, true, 'Replacing the cover must preserve its vision blocker');
assert.deepStrictEqual(tutorialCover.footprint, { x: 3.2, z: 0.8 });
assert.deepStrictEqual(tutorialCover.position, { x: 0, y: 0, z: 14 });
const onboardingNpcs = new Map((catalog.npcs || []).map(npc => [npc.id, npc]));
const asya = onboardingNpcs.get('ambush_guide');
const keysStep = catalog.firstMission.steps.find(step => step.id === 'keys');
const northExitEdge = Number(firstMissionLocation.map?.depth || 76) / 2 - 4;
assert(asya, 'Guide Asya must be authored for the prologue location.');
assert.strictEqual(asya.displayName, 'Проводница Ася');
assert.strictEqual(asya.locationId, catalog.firstMissionLocationId,
  'Guide Asya must be spawned on the Broken Tract.');
assert.strictEqual(Number(asya.x), Number(keysStep?.x));
assert.strictEqual(Number(asya.z), Number(keysStep?.z));
assert(Math.abs(Number(asya.x)) <= 1
  && northExitEdge - Number(asya.z) >= 2
  && northExitEdge - Number(asya.z) <= 8,
  'Guide Asya must stand on the road immediately inside the locked northern exit.');
for (const [phase, locationId] of [['tutorial', catalog.tutorialLocationId], ['firstMission', catalog.firstMissionLocationId]]) {
  for (const step of catalog[phase].steps) {
    if (!step.button && !(step.choices || []).length) continue;
    const npc = onboardingNpcs.get(step.npcId);
    assert(npc, `${phase}/${step.id}: every dialogue action needs an authored NPC.`);
    assert.equal(npc.locationId, locationId, `${phase}/${step.id}: dialogue NPC is in the wrong location.`);
    assert(Math.hypot(Number(npc.x) - Number(step.x), Number(npc.z) - Number(step.z)) <= Number(step.radius || 3),
      `${phase}/${step.id}: dialogue NPC is outside the objective radius.`);
  }
}

let state = initialKromkaOnboarding(catalog, { now: 1000 });
assert.strictEqual(state.phase, 'tutorial');
assert.strictEqual(state.stepId, 'contract');
assert.strictEqual(state.canSkipTutorial, false, 'First account run must be mandatory');
assert.strictEqual(skipKromkaTutorial(state, catalog, { now: 1100, accountCompleted: false }).ok, false,
  'Fresh account bypassed mandatory preparation');
let outOfOrder = advanceKromkaOnboarding(state, 'depart_caravan', {
  now: 1200, locationId: catalog.tutorialLocationId, x: 0, z: 24
}, catalog);
assert.strictEqual(outOfOrder.ok, false, 'Tutorial stages may not be completed out of order');
let tooFar = advanceKromkaOnboarding(state, 'sign_contract', {
  now: 1300, locationId: catalog.tutorialLocationId, x: 30, z: 30, npcId: 'yard_contract_clerk'
}, catalog);
assert.strictEqual(tooFar.ok, false, 'Server accepted a remote tutorial interaction');
let withoutDialogueNpc = advanceKromkaOnboarding(state, 'sign_contract', {
  now: 1300, locationId: catalog.tutorialLocationId, x: 0, z: -20
}, catalog);
assert.strictEqual(withoutDialogueNpc.ok, false, 'Server accepted a dialogue stage without its NPC');

for (const step of catalog.tutorial.steps) {
  const context = { locationId: catalog.tutorialLocationId, x: step.x, z: step.z, npcId: step.npcId };
  for (const requirement of step.requirements || []) {
    assert.strictEqual(advanceKromkaOnboarding(state, step.action, context, catalog).ok, false,
      `${step.id}: dialogue bypassed missing ${requirement.key}`);
    assert(requirement.hint && requirement.mobileHint, `${step.id}: keyboard and touch hints are required`);
    assert(publicKromkaOnboarding(state, catalog).step.target, `${step.id}: missing practice objective marker`);
    recordOnboardingEvidence(state, requirement.key, requirement.count || 1);
  }
  assert.strictEqual(publicKromkaOnboarding(state, catalog).step.ready, true);
  const result = advanceKromkaOnboarding(state, step.action, {
    now: state.updatedAt + 1000,
    locationId: catalog.tutorialLocationId,
    x: step.x,
    z: step.z,
    npcId: step.npcId || ''
  }, catalog);
  assert(result.ok, `Tutorial step failed: ${step.id} (${result.error || ''})`);
  state = result.state;
  if (step.id === 'departure') {
    assert.strictEqual(result.transition.locationId, catalog.firstMissionLocationId);
    assert.strictEqual(result.transition.cinematicId, departure.cinematicId,
      'Server progression did not preserve the authored cinematic id');
    assert.strictEqual(state.phase, 'firstMission');
  }
}

for (const step of catalog.firstMission.steps) {
  const choiceId = step.choices?.[0]?.id || '';
  const result = advanceKromkaOnboarding(state, step.action, {
    now: state.updatedAt + 1000,
    locationId: catalog.firstMissionLocationId,
    x: step.x,
    z: step.z,
    npcId: step.npcId || '',
    choiceId
  }, catalog);
  assert(result.ok, `First mission step failed: ${step.id} (${result.error || ''})`);
  state = result.state;
  if (step.id === 'survivors') assert(state.outcomeTags.includes('intro_saved_scout'));
  if (step.id === 'keys') {
    assert(result.completed && result.transition.locationId === 'settlement');
    assert.strictEqual(state.phase, 'complete');
  }
}
assert.strictEqual(publicKromkaOnboarding(state, catalog).step, null);
const legacy = sanitizeKromkaOnboarding({ version: 1, phase: 'tutorial', completedTutorialSteps:
  ['contract', 'inspection', 'equipment', 'range', 'cover', 'first_aid'] }, catalog);
assert.deepStrictEqual(legacy.completedTutorialSteps, ['contract', 'inspection'],
  'Legacy incomplete tutorial must not preserve dialogue-only practice');
assert.equal(legacy.stepId, 'equipment');

const repeat = initialKromkaOnboarding(catalog, { accountCompleted: true, now: 5000 });
const skipped = skipKromkaTutorial(repeat, catalog, { accountCompleted: true, now: 6000 });
assert(skipped.ok && skipped.state.phase === 'firstMission', 'Returning account cannot skip only the tutorial');
assert.strictEqual(skipped.transition.cinematicId, undefined,
  'Account-level tutorial skip must not replay the first-run cinematic');

assert(server.includes("const startLocationId = 'tutorialCaravanYard'")
  && server.includes("socket.on('kromkaOnboardingAction'")
  && server.includes("room.encounterId = 'kromka_caravan_twelve_ambush'")
  && server.includes("result.anomaly?.id === 'training-chime-01'")
  && server.includes("serverRecordTutorialFact(p, 'coverUsed')")
  && server.includes("serverRecordTutorialFact(p, 'targetHit')")
  && server.includes("serverRecordTutorialFact(healer, 'npcHealed')")
  && server.includes("serverRecordTutorialFact(player, 'weaponRepaired')")
  && server.includes('ensureKromkaOnboardingLocationActors')
  && server.includes('serverKromkaOnboardingActor')
  && server.includes('serverNpcIsKromkaOnboardingProtected')
  && server.includes('actor.kromkaOnboardingProtected = true')
  && server.includes('actor.kromkaOnboardingAnchorX = targetX')
  && server.includes('actor.kromkaOnboardingAnchorZ = targetZ')
  && server.includes('roomEnemyDelete(room, actor.id)')
  && server.includes('cinematicId: result.transition.cinematicId')
  && server.includes("cinematicId: String(options.cinematicId || '')")
  && server.includes("'Сначала начните диалог с этим персонажем.'")
  && server.includes("locationId}#${privateRoomOwnerId}"),
  'Server is missing private routing, authoritative progression or real mechanic gates');
assert(socket.includes('OnKromkaOnboardingState')
  && socket.includes('_connection.On("kromkaOnboardingState"'),
  'Unity does not receive onboarding authority');
assert(unity.includes('KromkaOnboardingCanvas')
  && unity.includes('KromkaStoryObjective')
  && unity.includes('_socket.OnJoined += ApplyJoined')
  && unity.includes('ApplyAuthoritativeSelf(ack?.Self)')
  && unity.includes('DistanceToStep() <= StepRadius()')
  && unity.includes('CollectPublicSnapshots(_npcSnapshots)')
  && unity.includes('["kromkaOnboardingNpcId"]')
  && unity.includes('TryGetPosition(actorId')
  && !unity.includes('private void Submit(')
  && !unity.includes('KeyCode.E')
  && interaction.includes('NpcOnboardingAction')
  && interaction.includes('["enemyId"] = actorId')
  && dialogue.includes('Interaction.NpcOnboarding()')
  && dialogue.includes('ТЕКУЩАЯ ЦЕЛЬ'),
  'Unity preparation is not routed through nearby NPC dialogue');
assert(interaction.includes('TryPlayDeparture(cinematicId')
  && interaction.includes('SubmitNpcOnboardingAction(actorId, action, choiceId)')
  && bootstrap.includes('CaravanDepartureCinematic.Configure(this, Socket, CameraRig)')
  && bootstrap.includes('Active._cinematicActive')
  && cinematic.includes('yard_caravan_truck')
  && cinematic.includes('yard_gate_left')
  && cinematic.includes('yard_gate_right')
  && cinematic.includes('OnServerWorldTransfer += HandleServerWorldTransfer')
  && cinematic.includes('AmbushLocationId = "randomRuinedRoad"')
  && cinematic.includes('Time.unscaledDeltaTime')
  && cinematic.includes('SetCinematicActive(true)')
  && cinematic.includes('SetCinematicActive(false)')
  && cinematic.includes('ПРОПУСТИТЬ')
  && cinematicProbe.includes('full-screen input blocker is missing')
  && auditRunner.includes('typeof(RoaCaravanDepartureCinematicProbe)'),
  'Unity departure/ambush cinematic is not completely wired or audited');
assert(server.includes('if (loc.allowGlobalMapExit === false) return false;')
  && server.includes("p.kromkaOnboarding?.phase === 'firstMission'")
  && server.includes('serverClosedLocationMovementBounds(player, room, PLAYER_COLLISION_RADIUS)')
  && server.includes('serverPointInsideClosedLocationBounds(toX, toZ, closedBounds)')
  && server.includes('serverClosedLocationMovementBounds(p, room, PLAYER_COLLISION_RADIUS)')
  && server.includes('serverPointInsideClosedLocationBounds(nextX, nextZ, closedBounds)'),
  'Tutorial and prologue edges are not blocked by the server');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Game/RoaKromkaOnboarding.cs.meta'), 'utf8')),
  'Onboarding component metadata is invalid');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(fs.readFileSync(path.join(root,
  'unity-client/Assets/Scripts/Game/RoaCaravanDepartureCinematic.cs.meta'), 'utf8')),
  'Cinematic component metadata is invalid');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(fs.readFileSync(path.join(root,
  'unity-client/Assets/Editor/RoaCaravanDepartureCinematicProbe.cs.meta'), 'utf8')),
  'Cinematic probe metadata is invalid');

console.log('Kromka onboarding OK: twelve evidence-gated lessons, six-step ambush mission, choices and Keys arrival');
