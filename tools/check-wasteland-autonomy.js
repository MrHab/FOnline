#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-of-ashes-autonomy-'));

function testMap() {
  const cells = {};
  for (let cy = 0; cy < 30; cy += 1) {
    for (let cx = 0; cx < 30; cx += 1) {
      cells[`${cx}:${cy}`] = {
        terrain: 'Пустошь',
        texture: 'grass',
        territoryOwner: 'neutral',
        difficulty: 1
      };
    }
  }
  return {
    grid: { cols: 30, rows: 30, cellPoints: 30, cellKm: 10 },
    nodes: [],
    infrastructure: [],
    cells
  };
}

function site(id, x, y, options = {}) {
  return {
    id,
    type: options.type || 'pointOfInterest',
    name: options.name || id,
    x,
    y,
    owner: options.owner || 'neutral',
    locationId: options.locationId || 'randomAshGrove',
    pvpMode: 'pvp',
    security: options.security ?? 30,
    danger: options.danger ?? 1,
    stockpile: { ...(options.stockpile || {}) },
    output: { ...(options.output || {}) },
    ...(options.extra || {})
  };
}

function party(id, kind, faction, x, y, options = {}) {
  return {
    id,
    name: options.name || id,
    kind,
    faction,
    state: options.state || (kind === 'monster' ? 'roaming' : kind === 'raider' ? 'hunting' : 'moving'),
    x,
    y,
    speedKmh: options.speedKmh ?? 40,
    baseSpeedKmh: options.speedKmh ?? 40,
    speedProfileVersion: 2,
    strength: options.strength ?? 60,
    members: options.members ?? 5,
    homeSiteId: options.homeSiteId || '',
    destinationSiteId: options.destinationSiteId || '',
    targetPartyId: options.targetPartyId || '',
    nextDecisionHour: options.nextDecisionHour ?? 999,
    route: options.route || [],
    routeIndex: 0,
    cargo: options.cargo || {},
    playerMembers: [],
    ...(options.extra || {})
  };
}

function simulation(name) {
  const map = testMap();
  const sim = createWastelandSimulation({
    stateFile: path.join(tempRoot, `${name}.json`),
    getGlobalMap: () => map,
    gameDayRealMs: 60 * 60 * 1000
  });
  const state = sim.state();
  state.worldHour = 100;
  state.parties = {};
  state.worldZones = [];
  state.worldTasks = [];
  state.events = [];
  return { sim, state };
}

function assertIntermediateSiteEntry() {
  const { sim, state } = simulation('site-entry');
  state.sites.crossing = site('crossing', 450, 90);
  state.sites.destination = site('destination', 660, 90);
  state.parties.support = party('support', 'support', 'old_klim', 360, 90, {
    speedKmh: 42,
    strength: 24,
    members: 3,
    destinationSiteId: 'destination',
    extra: { supportSiteId: 'destination' }
  });

  sim.tick(Date.now() + 1000, { hours: 1, force: true });

  const support = state.parties.support;
  assert(support, 'support party disappeared before reaching its mission site');
  assert.strictEqual(support.state, 'onsite', 'party did not enter an incidental location whose circle it crossed');
  assert.strictEqual(support.onsiteSiteId, 'crossing', 'party skipped the first touched location circle');
  assert(state.worldZones.some(zone => zone.status === 'active' && zone.details?.onsiteParty && zone.partyId === support.id),
    'entering a site did not create a shared onsite reality');
}

function assertCompletedVisitChoosesAnotherLocation() {
  const { sim, state } = simulation('completed-site-visit');
  state.sites.current = site('current', 390, 90, { owner: 'old_klim' });
  state.sites.alternate = site('alternate', 480, 90, { owner: 'old_klim' });
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 360, 90, {
    speedKmh: 48,
    destinationSiteId: 'current',
    nextDecisionHour: 999
  });

  sim.tick(Date.now() + 1000, { hours: 0.1, force: true });
  const patrol = state.parties.patrol;
  assert.strictEqual(patrol.state, 'onsite', 'party did not enter the destination before the completed-visit check');
  patrol.onsiteUntilHour = state.worldHour;
  sim.tick(Date.now() + 2000, { hours: 0.01, force: true });

  const departingZone = state.worldZones.find(row => row.id === patrol.onsiteZoneId);
  assert.strictEqual(patrol.state, 'onsite', 'party left the global site before its local actors reached an exit');
  assert.strictEqual(departingZone?.details?.departureRequested, true, 'completed site work did not request a physical local exit');
  const departure = sim.completeOnsitePartyDeparture({
    worldZoneId: departingZone.id,
    roomId: departingZone.roomId,
    reason: 'test_physical_exit',
    actors: (departingZone.details?.actors || []).map((actor, index) => ({
      actorId: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      dead: actor.dead,
      inventory: index === 0 ? [{ id: 'scrap', qty: 3 }] : actor.inventory
    }))
  });

  assert.strictEqual(departure?.ok, true, 'server could not acknowledge the local party exit');
  assert(patrol.actorSnapshots?.some(actor => actor.inventory?.some(row => row.id === 'scrap' && row.qty === 3)),
    'items carried by a local party actor were lost when the party returned to the global map');
  assert.notStrictEqual(patrol.state, 'onsite', 'party stayed inside a completed location visit');
  assert.notStrictEqual(patrol.destinationSiteId, 'current', 'party immediately selected the location it had just left');
  assert.strictEqual(patrol.siteExitIgnoreId, 'current', 'completed visit did not receive a re-entry guard');
  sim.tick(Date.now() + 3000, { hours: 0.01, force: true });
  assert.notStrictEqual(patrol.state, 'onsite', 'party immediately re-entered the location it had just left');
}

function assertLootedTransientOnsiteZoneReactivates() {
  const { sim, state } = simulation('onsite-zone-reactivation');
  state.sites.current = site('current', 390, 90, { owner: 'old_klim' });
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 360, 90, {
    speedKmh: 48,
    destinationSiteId: 'current',
    nextDecisionHour: 999
  });

  sim.tick(Date.now() + 1000, { hours: 0.1, force: true });
  const patrol = state.parties.patrol;
  const zoneId = patrol.onsiteZoneId;
  const zone = state.worldZones.find(row => row.id === zoneId);
  assert(zone, 'first onsite visit did not create a transient world zone');
  zone.status = 'looted';
  zone.resolvedHour = state.worldHour;
  zone.details = { ...(zone.details || {}), looted: true, clearedHour: state.worldHour };
  patrol.state = 'moving';
  delete patrol.onsiteZoneId;
  delete patrol.onsiteSiteId;
  delete patrol.onsiteReason;
  delete patrol.onsiteUntilHour;
  patrol.x = 360;
  patrol.y = 90;
  patrol.destinationSiteId = 'current';
  patrol.nextDecisionHour = 999;
  patrol.siteExitIgnoreId = '';
  patrol.siteExitIgnoreUntilHour = 0;
  patrol.infrastructureRoutePoints = [];
  patrol.infrastructureRouteIndex = 1;
  patrol.infrastructureDestinationSiteId = '';

  sim.tick(Date.now() + 2000, { hours: 0.1, force: true });
  const reused = state.worldZones.find(row => row.id === zoneId);
  assert.strictEqual(patrol.state, 'onsite', 'party did not re-enter a previously used location instance');
  assert.strictEqual(reused?.status, 'active', 'reused transient onsite zone remained looted instead of reactivating');
  assert(!reused?.details?.looted, 'reused transient onsite zone kept stale looted state');
  sim.tick(Date.now() + 3000, { hours: 0.01, force: true });
  assert.strictEqual(patrol.state, 'onsite', 'reactivated onsite zone was discarded on the following tick');
}

function assertSituationalReplanning() {
  const { sim, state } = simulation('replanning');
  state.sites.routine = site('routine', 660, 90, { owner: 'old_klim', security: 70 });
  state.sites.attacked = site('attacked', 390, 90, {
    owner: 'old_klim',
    security: 18,
    extra: {
      activeConflict: {
        id: 'test_raid',
        active: true,
        status: 'active',
        attackers: [{ faction: 'raiders', power: 80, count: 6 }]
      }
    }
  });
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 300, 90, {
    speedKmh: 54,
    destinationSiteId: 'routine',
    homeSiteId: 'routine',
    nextDecisionHour: 0,
    route: ['routine']
  });

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const patrol = state.parties.patrol;
  assert.strictEqual(patrol.destinationSiteId, 'attacked', 'patrol ignored a nearby attack and kept its fixed route');
  assert.strictEqual(patrol.decisionKind, 'defend', 'patrol did not explain its situational priority as defense');
  assert.strictEqual(patrol.decisionReason, 'friendly_site_attacked', 'patrol decision did not reflect the current world event');
}

function patrolMissionVerticalSliceFixture(name, options = {}) {
  const { sim, state } = simulation(name);
  const conflictId = 'vertical_patrol_conflict';
  const targetExtra = options.defense
    ? {
        activeConflict: {
          id: conflictId,
          active: true,
          kind: 'raid',
          status: 'active',
          startedHour: state.worldHour,
          updatedHour: state.worldHour,
          expiresHour: state.worldHour + 18,
          ownerAtStart: 'old_klim',
          progress: 2,
          attackers: [{
            faction: 'raiders',
            power: 80,
            count: 6,
            firstHour: state.worldHour,
            lastHour: state.worldHour,
            order: 0
          }]
        }
      }
    : {};
  state.sites = {
    vertical_patrol_home: site('vertical_patrol_home', 270, 90, {
      type: 'settlement',
      owner: 'old_klim',
      locationId: 'world_vertical_patrol_home',
      security: 82,
      stockpile: { silver: 500 }
    }),
    vertical_patrol_target: site('vertical_patrol_target', 390, 90, {
      type: 'resource',
      owner: 'old_klim',
      locationId: 'world_vertical_patrol_target',
      security: options.defense ? 18 : 4,
      output: { scrap: 1 },
      extra: targetExtra
    })
  };
  const defenseTask = options.defense ? {
    id: 'vertical_patrol_defense_request',
    key: 'site_conflict:vertical_patrol_target',
    type: 'defend_resource',
    status: 'active',
    title: 'Defend the vertical patrol target',
    siteId: 'vertical_patrol_target',
    issuerSiteId: 'vertical_patrol_home',
    targetFaction: 'raiders',
    objective: 'site_conflict',
    createdHour: state.worldHour,
    expiresHour: state.worldHour + 24,
    priority: 5,
    reward: {},
    details: { conflictId }
  } : null;
  state.worldTasks = defenseTask ? [defenseTask] : [];
  state.parties.vertical_patrol_party = party(
    'vertical_patrol_party',
    'patrol',
    'old_klim',
    300,
    90,
    {
      name: 'Vertical Patrol',
      speedKmh: Number(options.speedKmh ?? 1),
      strength: 92,
      members: 5,
      homeSiteId: 'vertical_patrol_home',
      destinationSiteId: 'vertical_patrol_home',
      nextDecisionHour: 0,
      route: ['vertical_patrol_home']
    }
  );

  const startedAt = Date.now();
  sim.tick(startedAt + 1000, { hours: 0.01, force: true });

  const patrol = state.parties.vertical_patrol_party;
  const missionTask = state.worldTasks.find(task => task?.type === 'patrol_mission'
    && task.partyId === patrol.id);
  const participationTask = state.worldTasks.find(task => task?.type === 'join_patrol'
    && task.partyId === patrol.id);
  return {
    sim,
    state,
    patrol,
    target: state.sites.vertical_patrol_target,
    defenseTask,
    missionTask,
    participationTask,
    startedAt
  };
}

function assertPatrolPublicFeedSeparatesNpcStatusFromPlayerParticipation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-public-feed-contract');
  const { sim, patrol, missionTask, participationTask } = fixture;
  const patrolRows = snapshot => snapshot.worldTasks.filter(task => (
    task?.partyId === patrol.id && ['patrol_mission', 'join_patrol'].includes(task.type)
  ));
  const activityRows = snapshot => snapshot.worldActivities.filter(task => (
    task?.partyId === patrol.id && ['patrol_mission', 'join_patrol'].includes(task.type)
  ));

  let snapshot = sim.publicState();
  assert.deepStrictEqual(patrolRows(snapshot).map(task => task.type), ['join_patrol'],
    'public task board duplicated the NPC patrol mission beside its join window');
  assert.deepStrictEqual(activityRows(snapshot).map(task => task.type), ['join_patrol'],
    'live activity feed duplicated the NPC patrol mission beside its join window');
  assert.strictEqual(patrolRows(snapshot)[0]?.actionMode, 'join_party',
    'open patrol participation did not expose its server-authoritative join action');

  for (let index = 0; index < 5; index += 1) {
    joinPatrolVerticalSlicePlayer(fixture, `public-feed-${index}`);
  }
  snapshot = sim.publicState();
  assert.deepStrictEqual(patrolRows(snapshot).map(task => task.type), ['join_patrol'],
    'a full patrol hid the accepted participation task from its current members');
  assert.strictEqual(patrolRows(snapshot)[0]?.actionMode, '',
    'a full patrol still advertised a join action');
  assert.strictEqual(patrolRows(snapshot)[0]?.joinPartySlotsLeft, 0,
    'a full patrol exposed an incorrect player-slot count');

  patrol.playerMembers = [];
  participationTask.status = 'resolved';
  snapshot = sim.publicState();
  const mission = patrolRows(snapshot).find(task => task.id === missionTask.id);
  assert(mission, 'NPC patrol status disappeared after its participation window closed');
  assert.strictEqual(mission.actionMode, 'status_only',
    'NPC patrol mission did not expose an explicit status-only action contract');
  assert.strictEqual(mission.statusOnly, true,
    'NPC patrol mission was not marked as status-only');
  assert.strictEqual(mission.npcOnly, true,
    'NPC patrol mission was not marked as NPC-owned');
}

function assertPatrolDefenseAssignmentSynchronizesWorldTasks() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-defense-assignment', { defense: true });
  const { patrol, target, defenseTask, missionTask } = fixture;
  const operation = missionTask?.details?.operation;

  assert.strictEqual(patrol.decisionKind, 'defend',
    'patrol did not convert the active friendly conflict into a defense decision');
  assert(missionTask, 'defense decision did not create an authoritative patrol mission');
  assert.strictEqual(operation?.phase, 'traveling',
    'patrol defense operation claimed to hold the site before physically arriving');
  assert.strictEqual(operation?.goal?.reason, 'friendly_site_attacked',
    'patrol defense operation lost the world-state reason for its assignment');
  assert.strictEqual(operation?.goal?.targetSiteId, target.id,
    'patrol defense operation targeted the wrong conflict site');
  assert.strictEqual(defenseTask?.status, 'active',
    'defend_resource request closed when the patrol merely accepted it');
  assert.strictEqual(defenseTask?.details?.operationId, operation?.id,
    'defend_resource request did not synchronize the patrol operation id');
  assert.strictEqual(defenseTask?.details?.assignedPartyId, patrol.id,
    'defend_resource request did not synchronize the assigned patrol id');
  assert.strictEqual(defenseTask?.details?.npcAssignment?.status, 'active',
    'defend_resource request does not expose an active NPC assignment');
}

function prepareVerticalPatrolArrival(fixture) {
  const { patrol, target } = fixture;
  patrol.x = target.x - 10;
  patrol.y = target.y;
  patrol.state = 'moving';
  patrol.baseSpeedKmh = 54;
  patrol.speedKmh = 54;
  patrol.destinationSiteId = target.id;
  patrol.nextDecisionHour = 999;
  patrol.infrastructureRoutePoints = [];
  patrol.infrastructureRouteIndex = 1;
  patrol.infrastructureDestinationSiteId = '';
}

function assertPatrolArrivalCompletesMissionOperation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-arrival-completion');
  const { sim, patrol, target, missionTask, startedAt } = fixture;
  assert(missionTask?.details?.operation, 'arrival regression has no patrol operation to complete');

  prepareVerticalPatrolArrival(fixture);
  sim.tick(startedAt + 2000, { hours: 0.1, force: true });

  const operation = missionTask.details?.operation;
  assert.strictEqual(patrol.lastSiteId, target.id,
    'patrol did not physically arrive at its mission target');
  assert.strictEqual(missionTask.status, 'resolved',
    'authoritative patrol mission stayed active after target arrival');
  assert.strictEqual(operation?.phase, 'completed',
    'patrol operation did not enter the completed phase on arrival');
  assert.strictEqual(operation?.status, 'completed',
    'arrived patrol operation retained an active status');
  assert.strictEqual(operation?.outcome?.siteId, target.id,
    'arrived patrol operation recorded the wrong terminal site');
  assert(Number(operation?.completedHour || 0) > 0,
    'arrived patrol operation has no completion time');
}

function assertPatrolRepelledConflictCompletesMissionOperation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-conflict-repelled', { defense: true });
  const { sim, state, target, defenseTask, missionTask, startedAt } = fixture;
  assert(missionTask?.details?.operation, 'conflict regression has no patrol operation to complete');

  target.activeConflict.startedHour = state.worldHour - 2;
  target.activeConflict.progress = -6;
  sim.tick(startedAt + 2000, { hours: 0.01, force: true });

  const operation = missionTask.details?.operation;
  assert.strictEqual(target.activeConflict, null,
    'defended site kept an active conflict after the repel condition');
  assert.strictEqual(defenseTask.status, 'resolved',
    'defend_resource request stayed active after its conflict was repelled');
  assert.strictEqual(missionTask.status, 'resolved',
    'authoritative patrol mission stayed active after its conflict was repelled');
  assert.strictEqual(operation?.phase, 'completed',
    'repelled conflict did not complete the patrol operation');
  assert.strictEqual(operation?.status, 'completed',
    'repelled patrol operation retained an active status');
  assert.strictEqual(operation?.outcome?.siteId, target.id,
    'repelled patrol operation recorded the wrong conflict site');
}

function assertDefendingPatrolHoldsOnsiteUntilConflictEnds() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-defense-holds-onsite', { defense: true });
  const { sim, state, patrol, target, missionTask, startedAt } = fixture;
  prepareVerticalPatrolArrival(fixture);
  sim.tick(startedAt + 2000, { hours: 0.1, force: true });

  assert.strictEqual(patrol.state, 'onsite',
    'defending patrol did not enter the attacked site');
  assert.strictEqual(patrol.onsiteSiteId, target.id,
    'defending patrol entered the wrong site');
  assert(target.activeConflict,
    'defense-hold regression resolved the conflict before the patrol could hold it');
  assert.strictEqual(missionTask.details?.operation?.phase, 'holding',
    'arrived defending patrol did not transition from traveling to holding');

  sim.tick(startedAt + 3000, { hours: 2, force: true });
  const onsiteZone = state.worldZones.find(zone => zone?.id === patrol.onsiteZoneId);
  assert(target.activeConflict,
    'defense-hold regression unexpectedly ended the conflict during the dwell check');
  assert.strictEqual(patrol.state, 'onsite',
    'defending patrol left while its assigned site conflict was still active');
  assert.strictEqual(onsiteZone?.details?.departureRequested, undefined,
    'defending patrol requested departure while its assigned conflict was active');
  assert.strictEqual(missionTask.status, 'active',
    'defending patrol mission ended before the site conflict');
  assert.strictEqual(missionTask.details?.operation?.phase, 'holding',
    'defending patrol stopped holding before the site conflict ended');

  target.activeConflict.startedHour = state.worldHour - 2;
  target.activeConflict.progress = -6;
  sim.tick(startedAt + 4000, { hours: 0.01, force: true });
  assert.strictEqual(target.activeConflict, null,
    'defense-hold regression did not resolve the forced repel condition');
  assert.strictEqual(missionTask.status, 'resolved',
    'defending patrol mission stayed active after the conflict ended');
  assert.strictEqual(missionTask.details?.operation?.phase, 'completed',
    'defending patrol operation did not complete after the conflict ended');
}

function assertPatrolDoesNotReinforceCapturedTarget() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-captured-target-revalidation');
  const { sim, patrol, target, missionTask, startedAt } = fixture;
  assert.strictEqual(missionTask.details?.operation?.goal?.kind, 'reinforce_site',
    'captured-target regression did not start with a reinforcement mission');
  target.type = 'test_site';
  target.owner = 'raiders';
  target.security = 17;
  prepareVerticalPatrolArrival(fixture);
  sim.tick(startedAt + 2000, { hours: 0.1, force: true });

  const operation = missionTask.details?.operation;
  assert.strictEqual(target.security, 17,
    'patrol reinforced a target captured by a hostile faction before arrival');
  assert.strictEqual(missionTask.status, 'failed',
    'captured patrol target was recorded as a successful mission');
  assert.strictEqual(operation?.phase, 'failed',
    'captured patrol target left the operation active or completed');
  assert.strictEqual(operation?.outcome?.reason, 'patrol_target_became_hostile',
    'captured patrol target recorded the wrong terminal reason');
  assert.strictEqual(patrol.assignment, null,
    'failed captured-target mission remained assigned to the patrol');
}

function joinPatrolVerticalSlicePlayer(fixture, suffix) {
  const joined = fixture.sim.joinWorldParty({
    taskId: fixture.participationTask?.id,
    partyId: fixture.patrol.id,
    playerId: `vertical-patrol-player-${suffix}`,
    userId: `vertical-patrol-account-${suffix}`,
    characterId: `vertical-patrol-character-${suffix}`,
    name: `Vertical Patrol Player ${suffix}`,
    factionId: 'old_klim'
  });
  assert.strictEqual(joined?.ok, true,
    `${suffix}: player could not join the patrol participation task`);
}

function assertPatrolParticipationTerminalKeepsNpcOperationActive() {
  const completed = patrolMissionVerticalSliceFixture('patrol-participation-duty-completed');
  assert(completed.missionTask?.details?.operation,
    'completed-duty regression has no active NPC patrol operation');
  assert(completed.participationTask,
    'completed-duty regression has no patrol participation task');
  joinPatrolVerticalSlicePlayer(completed, 'completed');
  completed.participationTask.details.dutyEndsHour = completed.state.worldHour;
  completed.sim.tick(completed.startedAt + 2000, { hours: 0.01, force: true });

  assert.strictEqual(completed.participationTask.status, 'completed',
    'finished player duty did not complete join_patrol participation');
  assert.strictEqual(completed.missionTask.status, 'active',
    'finished player duty terminated the live authoritative patrol mission');
  assert.strictEqual(completed.missionTask.details?.operation?.status, 'active',
    'finished player duty terminated the live NPC patrol operation');
  assert.strictEqual(completed.patrol.assignment?.operationId,
    completed.missionTask.details?.operation?.id,
    'finished player duty detached the living patrol from its NPC operation');
  assert.strictEqual(completed.patrol.playerMembers.length, 0,
    'completed patrol participation left the rewarded player attached to the party');

  const expired = patrolMissionVerticalSliceFixture('patrol-participation-duty-expired');
  assert(expired.missionTask?.details?.operation,
    'expired-duty regression has no active NPC patrol operation');
  assert(expired.participationTask,
    'expired-duty regression has no patrol participation task');
  joinPatrolVerticalSlicePlayer(expired, 'expired');
  expired.participationTask.expiresHour = expired.state.worldHour;
  expired.sim.tick(expired.startedAt + 2000, { hours: 0.01, force: true });

  assert.strictEqual(expired.participationTask.status, 'expired',
    'expired player duty did not close join_patrol participation');
  assert.strictEqual(expired.missionTask.status, 'active',
    'participation expiry terminated the live authoritative patrol mission');
  assert.strictEqual(expired.missionTask.details?.operation?.status, 'active',
    'participation expiry terminated the live NPC patrol operation');
  assert.strictEqual(expired.patrol.assignment?.operationId,
    expired.missionTask.details?.operation?.id,
    'participation expiry detached the living patrol from its NPC operation');
  assert.strictEqual(expired.patrol.playerMembers.length, 0,
    'expired patrol participation left the player attached to the party');
}

function assertPatrolOperationRewardRequiresCompletedDuty() {
  const early = patrolMissionVerticalSliceFixture('patrol-operation-early-duty-no-reward');
  joinPatrolVerticalSlicePlayer(early, 'early-operation');
  prepareVerticalPatrolArrival(early);
  early.sim.tick(early.startedAt + 2000, { hours: 0.1, force: true });

  assert.strictEqual(early.missionTask.status, 'resolved',
    'early-duty regression did not finish the NPC patrol operation');
  assert.strictEqual(early.participationTask.status, 'resolved',
    'short patrol participation was incorrectly marked reward-complete');
  assert.strictEqual(Number(early.participationTask.details?.rewardEligibleCount || 0), 0,
    'short patrol participation produced an eligible reward recipient');
  assert.strictEqual(Number(early.participationTask.details?.rewardPlayerCount || 0), 0,
    'short patrol participation received a trusted group reward snapshot');
  assert.strictEqual((early.participationTask.details?.rewardMemberKeys || []).length, 0,
    'short patrol participation retained a claimable reward identity');
  assert.strictEqual(early.patrol.playerMembers.length, 0,
    'short-duty player remained attached after the NPC operation ended');

  const served = patrolMissionVerticalSliceFixture('patrol-operation-served-duty-reward');
  joinPatrolVerticalSlicePlayer(served, 'served-operation');
  const servedMember = served.patrol.playerMembers.find(member => member?.taskId === served.participationTask.id);
  assert(servedMember, 'served-duty regression did not attach the patrol player');
  servedMember.joinedHour = served.state.worldHour - 6.1;
  served.participationTask.details.dutyStartedHour = servedMember.joinedHour;
  served.participationTask.details.dutyEndsHour = served.state.worldHour - 0.1;
  prepareVerticalPatrolArrival(served);
  served.sim.tick(served.startedAt + 2000, { hours: 0.1, force: true });

  assert.strictEqual(served.missionTask.status, 'resolved',
    'served-duty regression did not finish the NPC patrol operation');
  assert.strictEqual(served.participationTask.status, 'completed',
    'confirmed patrol duty did not complete the participation reward');
  assert.strictEqual(served.participationTask.details?.rewardEligibleCount, 1,
    'confirmed patrol duty did not record one eligible recipient');
  assert.strictEqual(served.participationTask.details?.rewardPlayerCount, 1,
    'confirmed patrol duty did not produce a trusted reward snapshot');
  assert.strictEqual((served.participationTask.details?.rewardMemberKeys || []).length, 1,
    'confirmed patrol duty did not retain its claimable reward identity');
  assert.strictEqual(served.patrol.playerMembers.length, 0,
    'served-duty player remained attached after the operation reward');
}

function assertDestroyedPatrolFailsMissionOperation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-destroyed-failure');
  const { sim, patrol, missionTask } = fixture;
  assert(missionTask?.details?.operation, 'destruction regression has no patrol operation to fail');

  sim.recordEncounterOutcome({
    encounterId: 'vertical_raiders_vs_patrol',
    worldPartyId: patrol.id,
    worldPoint: { x: patrol.x, y: patrol.y },
    deadFactions: ['old_klim'],
    aliveFactions: ['raiders'],
    playerInvolved: false
  });

  const operation = missionTask.details?.operation;
  assert.strictEqual(patrol.state, 'destroyed',
    'patrol destruction regression did not destroy the physical world party');
  assert.strictEqual(missionTask.status, 'failed',
    'destroyed patrol did not fail its authoritative patrol mission');
  assert.strictEqual(operation?.phase, 'failed',
    'destroyed patrol operation did not enter the failed phase');
  assert.strictEqual(operation?.status, 'failed',
    'destroyed patrol operation retained an active status');
  assert(Number(operation?.completedHour || 0) > 0,
    'destroyed patrol operation has no terminal time');
}

function assertRetailStockIsActuallyBacked() {
  const { sim, state } = simulation('retail-stock');
  state.sites.ammoWorks = site('ammoWorks', 390, 90, {
    type: 'production',
    owner: 'old_klim',
    locationId: 'klimAmmoWorks',
    stockpile: {
      ammo9: 18,
      ammo556: 18,
      ammoParts: 0,
      scrap: 0,
      silver: 500
    }
  });

  const market = sim.applyTraderSupply('ammoWorksMachine', {
    stock: [
      { id: 'ammo9', price: 3, qty: 120 },
      { id: 'ammo556', price: 5, qty: 80 }
    ],
    caps: 500
  }, { siteId: 'ammoWorks' });
  const offer = market.stock.find(row => row.id === 'ammo9');

  assert(offer, 'ammo workshop stopped offering its available 9mm ammunition');
  assert.strictEqual(offer.qty, 18, 'the site shop advertised more ammunition than the site can deliver');
  const purchase = sim.applyRetailTransaction('ammoWorks', {
    buys: [{ id: 'ammo9', qty: offer.qty }],
    silverDelta: offer.qty * offer.price,
    playerId: 'economy-check'
  });
  assert(purchase.ok, 'the site shop could not deliver the full quantity shown in its market');
  assert.strictEqual(Math.floor(Number(state.sites.ammoWorks.stockpile.ammo9 || 0)), 0,
    'successful ammunition purchase did not consume the real site stock');
}

function assertWorldTaskOutcomeStatsStayAccurate() {
  const { sim, state } = simulation('world-task-outcome-stats');
  state.sites.destination = site('destination', 660, 90, { owner: 'old_klim' });
  state.worldTasks = [
    {
      id: 'expired_delivery',
      key: 'expired_delivery',
      type: 'deliver_supplies',
      status: 'active',
      title: 'Expired delivery',
      siteId: 'destination',
      createdHour: 90,
      expiresHour: 99,
      priority: 2,
      reward: {},
      details: {}
    },
    {
      id: 'unavailable_patrol',
      key: 'unavailable_patrol',
      type: 'join_patrol',
      status: 'active',
      title: 'Unavailable patrol',
      partyId: 'missing_patrol',
      createdHour: 99,
      expiresHour: 200,
      priority: 1,
      reward: {},
      details: {}
    }
  ];

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  assert.strictEqual(Number(state.stats.worldTasksFailed || 0), 1,
    'expired task was not counted as a failed world task');
  assert.strictEqual(Number(state.stats.worldTasksResolved || 0), 1,
    'task removed because its world party vanished was not counted as resolved');
}

function assertFactionCaravanLossIsCountedAndFailsEscort() {
  const { sim, state } = simulation('faction-caravan-loss');
  state.parties.faction_caravan = party('faction_caravan', 'caravan', 'old_klim', 390, 90, {
    speedKmh: 30,
    strength: 55,
    members: 6,
    homeSiteId: 'settlement',
    destinationSiteId: 'scrapTown'
  });
  state.worldTasks = [{
    id: 'escort_faction_caravan',
    key: 'escort_faction_caravan',
    type: 'escort_caravan',
    status: 'active',
    title: 'Escort faction caravan',
    partyId: 'faction_caravan',
    siteId: 'settlement',
    createdHour: 99,
    expiresHour: 200,
    priority: 3,
    reward: {},
    details: {}
  }];

  sim.recordEncounterOutcome({
    encounterId: 'faction_caravan_ambush',
    worldPartyId: 'faction_caravan',
    worldPoint: { x: 390, y: 90 },
    deadFactions: ['old_klim'],
    aliveFactions: ['raiders'],
    playerInvolved: true,
    playerId: 'economy-check'
  });

  const escort = state.worldTasks.find(task => task.id === 'escort_faction_caravan');
  assert.strictEqual(state.parties.faction_caravan.state, 'destroyed', 'defeated faction caravan stayed alive');
  assert.strictEqual(Number(state.stats.caravansLost || 0), 1, 'faction-owned caravan loss was not counted exactly once');
  assert.strictEqual(escort?.status, 'failed', 'escort task did not fail when its faction-owned caravan was destroyed');
  assert.strictEqual(Number(state.stats.worldTasksFailed || 0), 1, 'failed caravan escort was missing from task statistics');
  assert.strictEqual(Number(state.stats.encountersResolved || 0), 1, 'recorded encounter was missing from simulation statistics');
}

function assertOnsiteZoneMigratesToUniqueLocationRoom() {
  const { sim, state } = simulation('onsite-zone-unique-location-room');
  state.sites.unique_site = site('unique_site', 360, 90, {
    locationId: 'world_unique_site',
    extra: { templateLocationId: 'randomAshGrove' }
  });
  state.worldZones = [{
    id: 'onsite_test_unique_site',
    kind: 'visit',
    status: 'active',
    sourceType: 'party_onsite',
    siteId: 'unique_site',
    partyId: 'test_party',
    locationId: 'randomAshGrove',
    roomId: 'randomAshGrove#1',
    createdHour: 90,
    expiresHour: 200,
    details: { onsiteParty: true, siteId: 'unique_site' }
  }];

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const zone = state.worldZones.find(row => row.id === 'onsite_test_unique_site');
  assert.strictEqual(zone?.locationId, 'world_unique_site',
    'onsite zone kept the shared template instead of its unique global-map location');
  assert.strictEqual(zone?.roomId, 'world_unique_site',
    'onsite zone did not migrate into the single shared reality of its unique location');
}

function assertOnsitePartiesCanMaterializeInSafeLocations() {
  const setupStart = serverSource.indexOf('function setupWorldZoneBattleRoom');
  const setupEnd = serverSource.indexOf('function attachActiveWorldZoneToSharedRoom', setupStart);
  assert(setupStart >= 0 && setupEnd > setupStart, 'world-zone room setup block is missing');
  const setupBody = serverSource.slice(setupStart, setupEnd);
  assert(setupBody.includes('allowSafeLocation: true'),
    'physical onsite-party actors are still rejected by the safe-location spawn guard');
}

try {
  assertIntermediateSiteEntry();
  assertCompletedVisitChoosesAnotherLocation();
  assertLootedTransientOnsiteZoneReactivates();
  assertSituationalReplanning();
  assertPatrolPublicFeedSeparatesNpcStatusFromPlayerParticipation();
  assertPatrolDefenseAssignmentSynchronizesWorldTasks();
  assertPatrolArrivalCompletesMissionOperation();
  assertPatrolRepelledConflictCompletesMissionOperation();
  assertDefendingPatrolHoldsOnsiteUntilConflictEnds();
  assertPatrolDoesNotReinforceCapturedTarget();
  assertPatrolParticipationTerminalKeepsNpcOperationActive();
  assertPatrolOperationRewardRequiresCompletedDuty();
  assertDestroyedPatrolFailsMissionOperation();
  assertRetailStockIsActuallyBacked();
  assertWorldTaskOutcomeStatsStayAccurate();
  assertFactionCaravanLossIsCountedAndFailsEscort();
  assertOnsiteZoneMigratesToUniqueLocationRoom();
  assertOnsitePartiesCanMaterializeInSafeLocations();
  console.log('Wasteland autonomy check passed: stable site visits, linked patrol operations, unique onsite rooms, zone reactivation, situational goals, accurate task stats and backed trade stock.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
