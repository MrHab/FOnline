#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const {
  WORLD_PARTY_REWARD_INTEGRITY_VERSION,
  WORLD_TASK_CLAIM_LIMIT,
  migrateDuplicateCharacterIds,
  sanitizeWorldTaskClaimIds,
  worldPartyMemberIdentityKey,
  worldTaskClaimEligible,
  worldPartyTaskIsActiveForParty
} = require('../src/server/world-party-integrity');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-world-party-integrity-'));

function testMap() {
  return {
    grid: { cols: 4, rows: 4, cellPoints: 30, cellKm: 10 },
    nodes: [],
    infrastructure: [],
    cells: Object.fromEntries(Array.from({ length: 16 }, (_, index) => {
      const cx = index % 4;
      const cy = Math.floor(index / 4);
      return [`${cx}:${cy}`, { terrain: 'Пустошь', texture: 'grass', territoryOwner: 'neutral', difficulty: 1 }];
    }))
  };
}

function party(id, kind = 'patrol', faction = 'old_klim', options = {}) {
  return {
    id,
    name: id,
    kind,
    faction,
    state: options.state || (kind === 'caravan' ? 'staging' : 'moving'),
    destroyed: !!options.destroyed,
    x: 30,
    y: 30,
    speedKmh: 20,
    baseSpeedKmh: 20,
    strength: 50,
    members: 5,
    homeSiteId: 'settlement',
    destinationSiteId: '',
    route: [],
    cargo: {},
    playerMembers: Array.isArray(options.playerMembers) ? options.playerMembers : [],
    stagingSiteId: kind === 'caravan' ? 'settlement' : '',
    stagingJoinClosed: !!options.stagingJoinClosed
  };
}

function task(id, type, partyId, options = {}) {
  return {
    id,
    key: id,
    type,
    status: options.status || 'active',
    title: id,
    text: '',
    siteId: 'settlement',
    issuerSiteId: 'settlement',
    partyId,
    targetFaction: '',
    objective: '',
    createdHour: 90,
    expiresHour: options.expiresHour ?? 200,
    completedHour: 0,
    priority: 2,
    reward: { xp: 10, caps: 10, reputation: 1 },
    details: {}
  };
}

function member(characterId, taskId, options = {}) {
  return {
    id: characterId,
    playerId: options.playerId || `socket_${characterId}`,
    userId: options.userId || `user_${characterId}`,
    characterId,
    name: options.name || characterId,
    factionId: options.factionId ?? 'old_klim',
    taskId,
    joinedHour: options.joinedHour ?? 100,
    lastSeenHour: options.joinedHour ?? 100
  };
}

function simulation(name) {
  const stateFile = path.join(tempRoot, `${name}.json`);
  const sim = createWastelandSimulation({
    stateFile,
    getGlobalMap: testMap,
    gameDayRealMs: 60 * 60 * 1000,
    saveIntervalMs: 3000
  });
  const state = sim.state();
  state.worldHour = 100;
  state.parties = {};
  state.worldTasks = [];
  state.worldTaskHistory = [];
  state.worldZones = [];
  state.events = [];
  return { sim, state, stateFile };
}

function joinPayload(taskId = 'task_patrol_a', partyId = 'patrol_a', overrides = {}) {
  return {
    taskId,
    partyId,
    socketId: 'socket_player',
    playerId: 'socket_player',
    userId: 'user_player',
    characterId: 'character_player',
    factionId: 'old_klim',
    name: 'Player',
    ...overrides
  };
}

function assertJoinContract() {
  const { sim, state } = simulation('join-contract');
  state.parties.patrol_a = party('patrol_a');
  state.parties.patrol_b = party('patrol_b');
  state.parties.caravan_a = party('caravan_a', 'caravan');
  state.worldTasks = [
    task('task_patrol_a', 'join_patrol', 'patrol_a'),
    task('task_patrol_b', 'join_patrol', 'patrol_b'),
    task('task_caravan_a', 'escort_caravan', 'caravan_a'),
    task('task_completed', 'join_patrol', 'patrol_a', { status: 'completed' }),
    task('task_expired_hour', 'join_patrol', 'patrol_a', { expiresHour: 99 }),
    task('task_not_group', 'deliver_supplies', 'patrol_a'),
    task('task_wrong_kind', 'escort_caravan', 'patrol_a')
  ];
  const beforePower = sim.publicState().parties.find(row => row.id === 'patrol_a').escortPower;
  const rejected = [
    ['missing task id', joinPayload('', 'patrol_a')],
    ['unknown task', joinPayload('unknown_task', 'patrol_a')],
    ['completed task', joinPayload('task_completed', 'patrol_a')],
    ['expired active task', joinPayload('task_expired_hour', 'patrol_a')],
    ['non-group task', joinPayload('task_not_group', 'patrol_a')],
    ['mismatched party', joinPayload('task_patrol_a', 'patrol_b')],
    ['mismatched kind', joinPayload('task_wrong_kind', 'patrol_a')],
    ['forged faction', joinPayload('task_patrol_a', 'patrol_a', { factionId: 'scrap_union' })],
    ['missing character', joinPayload('task_patrol_a', 'patrol_a', { characterId: '' })]
  ];
  for (const [label, payload] of rejected) {
    const result = sim.joinWorldParty(payload);
    assert.strictEqual(result?.ok, false, `${label} unexpectedly joined a world party`);
    assert.strictEqual(state.parties.patrol_a.playerMembers.length, 0, `${label} mutated the target party`);
  }

  state.parties.patrol_a.destroyed = true;
  assert.strictEqual(sim.joinWorldParty(joinPayload())?.ok, false, 'destroyed party accepted a member');
  state.parties.patrol_a.destroyed = false;
  state.parties.caravan_a.stagingJoinClosed = true;
  assert.strictEqual(sim.joinWorldParty(joinPayload('task_caravan_a', 'caravan_a'))?.ok, false, 'closed caravan accepted an escort');
  state.parties.caravan_a.stagingJoinClosed = false;

  state.parties.patrol_a.playerMembers = Array.from({ length: 30 }, (_, index) => member(`full_${index}`, 'task_patrol_a'));
  assert.strictEqual(sim.joinWorldParty(joinPayload())?.ok, false, 'full party accepted another member');
  state.parties.patrol_a.playerMembers = [];

  const joined = sim.joinWorldParty(joinPayload());
  assert.strictEqual(joined?.ok, true, 'valid task-bound join failed');
  assert.strictEqual(state.parties.patrol_a.playerMembers.length, 1, 'valid join did not create exactly one member');
  assert.strictEqual(state.parties.patrol_a.playerMembers[0].taskId, 'task_patrol_a', 'member was not bound to the accepted task');
  assert.deepStrictEqual(state.worldTasks[0].details.joinedPlayers, ['character_player'], 'task roster was not synchronized');
  const afterPower = sim.publicState().parties.find(row => row.id === 'patrol_a').escortPower;
  assert.strictEqual(afterPower - beforePower, 7, 'one player did not contribute exactly one player-power unit');

  const eventsAfterJoin = state.events.length;
  const replay = sim.joinWorldParty(joinPayload());
  assert.strictEqual(replay?.ok, true, 'idempotent replay failed');
  assert.strictEqual(replay?.replay, true, 'idempotent replay was not identified');
  assert.strictEqual(state.parties.patrol_a.playerMembers.length, 1, 'idempotent replay duplicated the member');
  assert.strictEqual(state.events.length, eventsAfterJoin, 'idempotent replay emitted another world event');

  const moved = sim.joinWorldParty(joinPayload('task_patrol_b', 'patrol_b'));
  assert.strictEqual(moved?.ok, true, 'valid reassignment at simulation boundary failed');
  assert.strictEqual(state.parties.patrol_a.playerMembers.length, 0, 'reassignment left the member in the previous party');
  assert.deepStrictEqual(state.worldTasks[0].details.joinedPlayers, [], 'previous task kept a stale joined-player snapshot');
  assert.strictEqual(state.parties.patrol_b.playerMembers.length, 1, 'reassignment did not create the new membership');
}

function assertReconciliationContract() {
  const { sim, state } = simulation('reconciliation');
  state.parties.patrol_a = party('patrol_a');
  state.parties.patrol_b = party('patrol_b');
  state.worldTasks = [
    task('task_patrol_a', 'join_patrol', 'patrol_a'),
    task('task_patrol_b', 'join_patrol', 'patrol_b'),
    task('task_finished', 'join_patrol', 'patrol_a', { status: 'failed' })
  ];
  state.parties.patrol_a.playerMembers = [
    member('keep_latest', 'task_patrol_a', { joinedHour: 101 }),
    member('taskless', ''),
    member('not_accepted', 'task_patrol_a'),
    member('wrong_faction', 'task_patrol_a', { factionId: 'scrap_union' }),
    member('finished', 'task_finished')
  ];
  state.parties.patrol_b.playerMembers = [
    member('keep_latest', 'task_patrol_b', { joinedHour: 105 })
  ];
  const result = sim.reconcileWorldPartyMembers([
    { userId: 'user_keep_latest', characterId: 'keep_latest', factionId: 'old_klim', acceptedTaskIds: ['task_patrol_a', 'task_patrol_b'] },
    { userId: 'user_not_accepted', characterId: 'not_accepted', factionId: 'old_klim', acceptedTaskIds: [] },
    { userId: 'user_wrong_faction', characterId: 'wrong_faction', factionId: 'scrap_union', acceptedTaskIds: ['task_patrol_a'] },
    { userId: 'user_finished', characterId: 'finished', factionId: 'old_klim', acceptedTaskIds: ['task_finished'] }
  ]);
  assert.strictEqual(result.kept, 1, 'reconciliation kept more than one authoritative membership');
  assert(result.removed >= 5, 'reconciliation did not remove every invalid or duplicate membership');
  assert.deepStrictEqual(state.parties.patrol_a.playerMembers, [], 'older duplicate or invalid party members survived reconciliation');
  assert.deepStrictEqual(state.parties.patrol_b.playerMembers.map(row => row.characterId), ['keep_latest'], 'newest valid membership was not retained');
  assert.deepStrictEqual(state.worldTasks[0].details.joinedPlayers, [], 'old task details survived reconciliation');
  assert.deepStrictEqual(state.worldTasks[1].details.joinedPlayers, ['keep_latest'], 'kept task details were not rebuilt');
}

function assertLegacyWorldIdentityMigration() {
  const { sim, state } = simulation('legacy-world-identity-migration');
  state.parties.exact_party = party('exact_party');
  state.parties.ambiguous_party = party('ambiguous_party');
  state.worldTasks = [
    task('task_exact', 'join_patrol', 'exact_party'),
    task('task_ambiguous', 'join_patrol', 'ambiguous_party')
  ];
  state.parties.exact_party.playerMembers = [
    member('shared_character', 'task_exact', { userId: 'account_b' })
  ];
  state.parties.ambiguous_party.playerMembers = [{
    ...member('shared_character', 'task_ambiguous', { userId: 'account_a' }),
    userId: ''
  }];
  const historical = task('task_historical', 'join_patrol', 'archived_party', { status: 'completed' });
  historical.details = {
    rewardMemberKeys: ['account_b:shared_character', 'account_a:shared_character'],
    arrivalTransferredPlayerIds: ['account_b:shared_character', 'account_a:shared_character'],
    rewardPlayerIds: ['shared_character', 'safe_socket'],
    rewardCharacterIds: ['shared_character', 'safe_character'],
    eligibleRewardPlayerIds: ['shared_character', 'safe_socket'],
    eligibleRewardCharacterIds: ['shared_character', 'safe_character'],
    joinedPlayers: ['shared_character', 'safe_character'],
    playerId: 'shared_character',
    ownerPlayerId: 'shared_character'
  };
  state.worldTaskHistory = [historical];
  state.events = [{
    id: 'legacy_identity_event',
    playerId: 'shared_character',
    characterId: 'shared_character',
    details: { startedByPlayerId: 'shared_character' }
  }];
  state.worldZones = [{
    id: 'legacy_identity_zone',
    sourceType: 'player',
    sourceId: 'shared_character',
    details: { playerAmbush: true, characterId: 'shared_character' }
  }];

  const result = sim.reconcileWorldPartyMembers([
    {
      userId: 'account_a',
      characterId: 'shared_character',
      factionId: 'old_klim',
      acceptedTaskIds: ['task_ambiguous']
    },
    {
      userId: 'account_b',
      characterId: 'server_character_b',
      factionId: 'old_klim',
      acceptedTaskIds: ['task_exact']
    }
  ], {
    legacyCharacterIdRemaps: [{
      userId: 'account_b',
      previousCharacterId: 'shared_character',
      characterId: 'server_character_b'
    }]
  });

  assert.deepStrictEqual(
    state.parties.exact_party.playerMembers.map(row => ({
      userId: row.userId,
      characterId: row.characterId,
      playerId: row.playerId,
      socketId: row.socketId
    })),
    [{ userId: 'account_b', characterId: 'server_character_b', playerId: '', socketId: '' }],
    'an exact account/legacy-character membership was not remapped to the new character id'
  );
  assert.deepStrictEqual(state.parties.ambiguous_party.playerMembers, [],
    'an account-less colliding legacy membership was reassigned to the retained character owner');
  assert(result.remappedReferences >= 2, 'exact persisted reward/arrival identities were not migrated');
  assert(result.removedAmbiguousReferences >= 8, 'ambiguous persisted character references were not purged');
  assert.deepStrictEqual(historical.details.rewardMemberKeys.sort(), [
    'account_a:shared_character',
    'account_b:server_character_b'
  ].sort(), 'reward member keys were not migrated by exact account/character identity');
  assert.deepStrictEqual(historical.details.arrivalTransferredPlayerIds.sort(), [
    'account_a:shared_character',
    'account_b:server_character_b'
  ].sort(), 'arrival transfer keys were not migrated by exact account/character identity');
  assert.deepStrictEqual(historical.details.rewardCharacterIds, ['safe_character'],
    'ambiguous legacy character ids survived the reward snapshot');
  assert.deepStrictEqual(historical.details.rewardPlayerIds, ['safe_socket'],
    'ambiguous legacy character ids survived the player reward snapshot');
  assert.strictEqual(historical.details.playerId, undefined,
    'ambiguous scalar player identity survived archived task migration');
  assert.strictEqual(state.events[0].playerId, undefined,
    'ambiguous scalar identity survived event migration');
  assert.strictEqual(state.worldZones[0].sourceId, undefined,
    'ambiguous player-authored zone source survived migration');
}

function assertReloadAndExpiryCleanup() {
  const first = simulation('reload-cleanup');
  first.state.parties.patrol_a = party('patrol_a', 'patrol', 'old_klim', {
    playerMembers: [member('valid_on_reload', 'task_patrol_a'), member('phantom_on_reload', '')]
  });
  first.state.worldTasks = [task('task_patrol_a', 'join_patrol', 'patrol_a')];
  first.sim.save(true);
  const reloaded = createWastelandSimulation({
    stateFile: first.stateFile,
    getGlobalMap: testMap,
    gameDayRealMs: 60 * 60 * 1000,
    saveIntervalMs: 3000
  });
  assert.deepStrictEqual(
    reloaded.state().parties.patrol_a.playerMembers.map(row => row.characterId),
    ['valid_on_reload'],
    'taskless legacy member survived simulation reload'
  );

  const expiry = simulation('expiry-cleanup');
  expiry.state.parties.patrol_a = party('patrol_a', 'patrol', 'old_klim', {
    playerMembers: [member('expiring_player', 'task_expiring')]
  });
  expiry.state.worldTasks = [task('task_expiring', 'join_patrol', 'patrol_a', { expiresHour: 100.005 })];
  expiry.sim.tick(Date.now() + 1000, { hours: 0.01, force: true });
  assert.strictEqual(
    expiry.state.worldTasks.find(row => row.id === 'task_expiring')?.status,
    'expired',
    'task did not enter a terminal state'
  );
  assert.deepStrictEqual(expiry.state.parties.patrol_a.playerMembers, [], 'expired task left player power in the party');
}

function assertPatrolDutyCompletion() {
  const { sim, state } = simulation('patrol-duty-completion');
  state.parties.patrol_a = party('patrol_a');
  state.worldTasks = [task('task_patrol_a', 'join_patrol', 'patrol_a')];
  const joined = sim.joinWorldParty(joinPayload());
  assert.strictEqual(joined?.ok, true, 'player could not start a patrol duty');
  const patrolTask = state.worldTasks.find(row => row.id === 'task_patrol_a');
  assert.strictEqual(Number(patrolTask?.details?.dutyEndsHour), 106,
    'patrol join did not establish a bounded six-hour duty');
  patrolTask.details.dutyEndsHour = 100.005;
  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });
  assert.strictEqual(patrolTask.status, 'completed', 'served patrol duty did not complete successfully');
  assert.strictEqual(patrolTask.details.finishReason, 'patrol_duty_completed', 'patrol completion reason was not recorded');
  assert.strictEqual(
    patrolTask.details.worldPartyRewardIntegrityVersion,
    WORLD_PARTY_REWARD_INTEGRITY_VERSION,
    'patrol completion did not stamp a trusted reward snapshot'
  );
  assert.deepStrictEqual(patrolTask.details.rewardCharacterIds, ['character_player'],
    'patrol completion rewarded a member from another task');
  assert.strictEqual(sim.publicWorldTasks(['task_patrol_a'])[0]?.details?.rewardMemberKeys, undefined,
    'public task payload leaked internal account/character reward identities');
  assert.deepStrictEqual(state.parties.patrol_a.playerMembers, [],
    'completed patrol duty left player power attached to the party');
  assert.strictEqual(patrolTask.details.rewardFactionId, 'old_klim',
    'patrol completion did not freeze its reputation faction');
  assert.strictEqual(
    worldTaskClaimEligible(patrolTask, { userId: 'user_player', characterId: 'character_player' }, true),
    true,
    'completed patrol duty could not be claimed by its accepted participant'
  );
  state.parties.patrol_a.faction = 'scrap_union';
  if (state.sites.settlement) state.sites.settlement.owner = 'scrap_union';
  sim.save(true);
  const frozenReload = createWastelandSimulation({
    stateFile: path.join(tempRoot, 'patrol-duty-completion.json'),
    getGlobalMap: testMap,
    gameDayRealMs: 60 * 60 * 1000,
    saveIntervalMs: 3000
  });
  const reloadedPatrolTask = [
    ...(frozenReload.state().worldTasks || []),
    ...(frozenReload.state().worldTaskHistory || [])
  ].find(row => row?.id === 'task_patrol_a');
  assert.strictEqual(reloadedPatrolTask?.details?.rewardFactionId, 'old_klim',
    'later party/site ownership changes rewrote the completed task reputation faction');

  const reset = simulation('patrol-duty-reset');
  reset.state.parties.patrol_a = party('patrol_a');
  reset.state.worldTasks = [task('task_patrol_a', 'join_patrol', 'patrol_a')];
  assert.strictEqual(reset.sim.joinWorldParty(joinPayload())?.ok, true, 'initial patrol duty join failed');
  assert.strictEqual(reset.sim.leaveWorldParty({
    partyId: 'patrol_a',
    playerId: 'socket_player',
    userId: 'user_player',
    characterId: 'character_player',
    name: 'Player'
  })?.removed, 1, 'patrol cancel did not remove its exact account/character member');
  assert.strictEqual(reset.state.worldTasks[0].details.dutyEndsHour, undefined,
    'empty patrol roster retained an old reward deadline');
  reset.sim.tick(Date.now() + 1000, { hours: 7, force: true });
  assert.strictEqual(reset.sim.joinWorldParty(joinPayload())?.ok, true, 'patrol rejoin after a cancelled duty failed');
  const resetTask = reset.state.worldTasks.find(row => row.id === 'task_patrol_a');
  assert.strictEqual(Number(resetTask?.details?.dutyEndsHour), 113,
    'patrol rejoin reused the cancelled duty deadline');
  reset.sim.tick(Date.now() + 2000, { hours: 0.01, force: true });
  assert.strictEqual(resetTask.status, 'active',
    'patrol rejoin completed immediately without serving a new duty');

  const migration = simulation('patrol-duty-migration');
  migration.state.parties.patrol_a = party('patrol_a', 'patrol', 'old_klim', {
    playerMembers: [member('legacy_member', 'task_patrol_a')]
  });
  migration.state.worldTasks = [task('task_patrol_a', 'join_patrol', 'patrol_a')];
  migration.sim.reconcileWorldPartyMembers([{
    userId: 'user_legacy_member',
    characterId: 'legacy_member',
    factionId: 'old_klim',
    acceptedTaskIds: ['task_patrol_a']
  }]);
  assert.strictEqual(Number(migration.state.worldTasks[0].details.dutyEndsHour), 106,
    'valid migrated patrol membership received no conservative duty window');

  const lateJoin = simulation('patrol-duty-late-join');
  lateJoin.state.parties.patrol_a = party('patrol_a');
  lateJoin.state.worldTasks = [task('task_patrol_a', 'join_patrol', 'patrol_a')];
  assert.strictEqual(lateJoin.sim.joinWorldParty(joinPayload())?.ok, true, 'first patrol member could not join');
  lateJoin.state.worldHour = 105.99;
  assert.strictEqual(lateJoin.sim.joinWorldParty(joinPayload('task_patrol_a', 'patrol_a', {
    socketId: 'socket_late',
    playerId: 'socket_late',
    userId: 'user_late',
    characterId: 'character_late',
    name: 'Late'
  }))?.ok, true, 'late patrol member could not join');
  const lateTask = lateJoin.state.worldTasks[0];
  assert.strictEqual(Number(lateTask.details.dutyStartedHour), 100,
    'late join rewrote the original patrol start');
  assert.strictEqual(Number(lateTask.details.dutyEndsHour), 111.99,
    'late join did not extend duty until every current member serves six hours');
  lateJoin.sim.tick(Date.now() + 3000, { hours: 0.02, force: true });
  assert.strictEqual(lateTask.status, 'active',
    'patrol rewarded a late member at the earlier participant deadline');
  assert.strictEqual(lateJoin.state.parties.patrol_a.playerMembers.length, 2,
    'early patrol deadline detached current members');
  assert.strictEqual(lateTask.details.rewardMemberKeys, undefined,
    'early patrol deadline created a reward snapshot');
  lateJoin.sim.tick(Date.now() + 4000, { hours: 6, force: true });
  assert.strictEqual(lateTask.status, 'completed', 'extended patrol duty did not complete');
  assert.deepStrictEqual(
    [...lateTask.details.rewardMemberKeys].sort(),
    [
      worldPartyMemberIdentityKey('user_late', 'character_late'),
      worldPartyMemberIdentityKey('user_player', 'character_player')
    ].sort(),
    'extended patrol reward snapshot did not contain every exact account/character member'
  );
}

function assertRewardEligibility() {
  const groupTask = task('reward_group', 'join_patrol', 'patrol_a');
  groupTask.status = 'completed';
  groupTask.details = {
    rewardCharacterIds: ['character_player'],
    rewardMemberKeys: [worldPartyMemberIdentityKey('user_player', 'character_player')],
    worldPartyRewardIntegrityVersion: WORLD_PARTY_REWARD_INTEGRITY_VERSION
  };
  const player = { id: 'socket_player', characterId: 'character_player', userId: 'user_player' };
  assert.strictEqual(worldTaskClaimEligible(groupTask, player, true), true, 'accepted participant could not claim');
  assert.strictEqual(worldTaskClaimEligible({ ...groupTask, details: {} }, player, true), false, 'accepted-only group claim was allowed');
  assert.strictEqual(worldTaskClaimEligible(groupTask, player, false), false, 'snapshot-only group claim was allowed');
  assert.strictEqual(
    worldTaskClaimEligible(groupTask, { ...player, userId: 'user_attacker' }, true),
    false,
    'another account with the same public character id could claim the reward'
  );
  const legacySharedSnapshot = {
    ...groupTask,
    details: { rewardCharacterIds: ['character_player', 'character_other'] }
  };
  assert.strictEqual(worldTaskClaimEligible(legacySharedSnapshot, player, true), false,
    'an untrusted legacy cross-task reward snapshot authorized a claim');
  assert.strictEqual(worldTaskClaimEligible({
    ...groupTask,
    id: 'reward_other',
    details: {
      rewardCharacterIds: ['character_other'],
      rewardMemberKeys: [worldPartyMemberIdentityKey('user_other', 'character_other')],
      worldPartyRewardIntegrityVersion: WORLD_PARTY_REWARD_INTEGRITY_VERSION
    }
  }, player, true), false, 'a trusted snapshot for another participant authorized a claim');
  const regularTask = task('reward_regular', 'deliver_supplies', '');
  assert.strictEqual(worldTaskClaimEligible(regularTask, player, true), true, 'ordinary accepted task lost its claim contract');
  assert.strictEqual(worldPartyTaskIsActiveForParty(task('pair', 'join_patrol', 'patrol_a'), party('patrol_a'), 100), true,
    'valid task/party pairing was rejected by the shared invariant');
}

function assertLegacyCharacterIdMigration() {
  const database = {
    characters: {
      account_c: {
        shared_character: {
          id: 'shared_character',
          summary: { id: 'shared_character' },
          state: { characterProfile: { serverCharacterId: 'shared_character', name: 'C' }, marker: 'keep-c' }
        }
      },
      account_b: {
        shared_character: {
          id: 'shared_character',
          summary: { id: 'shared_character' },
          state: { characterProfile: { serverCharacterId: 'shared_character', name: 'B' }, marker: 'keep-b' }
        }
      },
      account_a: {
        shared_character: {
          id: 'shared_character',
          summary: { id: 'shared_character' },
          state: {
            characterProfile: { serverCharacterId: 'shared_character', name: 'A' },
            marker: 'keep-a',
            socialState: {
              friends: [{ id: 'shared_character' }, { id: 'safe_friend' }],
              friendRequests: [{ characterId: 'shared_character' }, { id: 'safe_request' }],
              clanInvites: [{ playerId: 'shared_character' }, { id: 'safe_invite' }],
              clan: {
                id: 'clan_a',
                name: 'Clan A',
                members: [{ id: 'shared_character' }, { id: 'safe_member' }]
              }
            }
          }
        }
      }
    }
  };
  const generated = ['shared_character', '!!!', 'server_character_1', 'server_character_1', 'server_character_2'];
  const normalizeId = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const remapped = migrateDuplicateCharacterIds(database, () => generated.shift() || 'server_character_3', normalizeId);
  assert.strictEqual(remapped.length, 2, 'legacy duplicate character ids were not remapped N-1 times');
  assert(database.characters.account_a.shared_character, 'deterministic first owner did not retain its character id');
  const allRows = Object.values(database.characters).flatMap(store => Object.values(store));
  assert.strictEqual(new Set(allRows.map(row => row.id)).size, 3, 'legacy remap did not make every character id unique');
  for (const accountId of ['account_b', 'account_c']) {
    assert.strictEqual(database.characters[accountId].shared_character, undefined,
      `${accountId} retained the old colliding store key`);
    const [row] = Object.values(database.characters[accountId]);
    assert(row && row.id !== 'shared_character', `${accountId} kept the colliding character id`);
    assert.strictEqual(row.state.characterProfile.serverCharacterId, row.id,
      `${accountId} profile id was not migrated`);
    assert.strictEqual(row.summary.id, row.id, `${accountId} summary id was not migrated`);
    assert.strictEqual(row.state.marker, accountId === 'account_b' ? 'keep-b' : 'keep-c',
      `${accountId} lost unrelated saved payload`);
  }
  const migratedSocial = database.characters.account_a.shared_character.state.socialState;
  assert.deepStrictEqual(migratedSocial.friends.map(row => row.id), ['safe_friend'],
    'ambiguous legacy id survived the friends list');
  assert.deepStrictEqual(migratedSocial.friendRequests.map(row => row.id), ['safe_request'],
    'ambiguous legacy id survived incoming friend requests');
  assert.deepStrictEqual(migratedSocial.clanInvites.map(row => row.id), ['safe_invite'],
    'ambiguous legacy id survived clan invites');
  assert.deepStrictEqual(migratedSocial.clan.members.map(row => row.id), ['safe_member'],
    'ambiguous legacy id survived the clan member roster');
  assert.strictEqual(
    migrateDuplicateCharacterIds(database, () => 'server_character_4', normalizeId).length,
    0,
    'legacy character-id migration was not idempotent'
  );

  const row = (id, marker) => ({
    id,
    summary: { id },
    state: {
      marker,
      characterProfile: { serverCharacterId: id, name: marker }
    }
  });
  const reservedKeyDatabase = {
    characters: {
      account_a: {
        shared_reserved: row('shared_reserved', 'retained')
      },
      account_b: {
        reserved_store_key: row('other_character', 'must-survive'),
        shared_reserved: row('shared_reserved', 'remapped')
      }
    }
  };
  const reservedGenerated = ['reserved_store_key', 'safe_generated_character'];
  const reservedRemaps = migrateDuplicateCharacterIds(
    reservedKeyDatabase,
    () => reservedGenerated.shift() || 'fallback_generated_character',
    normalizeId
  );
  assert.strictEqual(reservedRemaps[0]?.characterId, 'safe_generated_character',
    'generator reused an existing store key as a character id');
  assert.strictEqual(reservedKeyDatabase.characters.account_b.other_character?.state?.marker, 'must-survive',
    'legacy migration did not preserve and canonically re-key a character stored under a stale lookup key');
  assert.strictEqual(reservedKeyDatabase.characters.account_b.reserved_store_key, undefined,
    'legacy migration left a non-canonical character store key');
  assert.strictEqual(Object.keys(reservedKeyDatabase.characters.account_b).length, 2,
    'legacy migration lost a row while avoiding a reserved store key');

  const sameAccountDatabase = {
    characters: {
      account_same: {
        slot_one: row('same_account_shared', 'one'),
        slot_two: row('same_account_shared', 'two')
      }
    }
  };
  const sameAccountRemaps = migrateDuplicateCharacterIds(
    sameAccountDatabase,
    () => 'same_account_remapped',
    normalizeId
  );
  assert.strictEqual(sameAccountRemaps.length, 1,
    'same-account duplicate character ids were not detected');
  assert.strictEqual(sameAccountRemaps[0].previousMemberKeyAmbiguous, true,
    'same-account duplicate did not mark its old composite identity as ambiguous');
  assert(sameAccountDatabase.characters.account_same.same_account_shared,
    'retained same-account character was not re-keyed to its canonical id');
  assert.strictEqual(sameAccountDatabase.characters.account_same.slot_one, undefined,
    'retained same-account character kept an unreachable legacy store key');

  const ambiguous = simulation('same-account-legacy-identity');
  ambiguous.state.parties.ambiguous_party = party('ambiguous_party');
  ambiguous.state.worldTasks = [task('ambiguous_task', 'join_patrol', 'ambiguous_party')];
  ambiguous.state.parties.ambiguous_party.playerMembers = [
    member('same_account_shared', 'ambiguous_task', { userId: 'account_same' })
  ];
  const ambiguousHistory = task('ambiguous_history', 'deliver_supplies', '', { status: 'completed' });
  ambiguousHistory.details = {
    rewardMemberKeys: ['account_same:same_account_shared'],
    arrivalTransferredPlayerIds: ['account_same:same_account_shared']
  };
  ambiguous.state.worldTaskHistory = [ambiguousHistory];
  ambiguous.sim.reconcileWorldPartyMembers([
    {
      userId: 'account_same',
      characterId: 'same_account_shared',
      factionId: 'old_klim',
      acceptedTaskIds: ['ambiguous_task']
    },
    {
      userId: 'account_same',
      characterId: 'same_account_remapped',
      factionId: 'old_klim',
      acceptedTaskIds: ['ambiguous_task']
    }
  ], { legacyCharacterIdRemaps: sameAccountRemaps });
  assert.deepStrictEqual(ambiguous.state.parties.ambiguous_party.playerMembers, [],
    'ambiguous same-account membership was assigned to one of two characters');
  assert.deepStrictEqual(ambiguousHistory.details.rewardMemberKeys, [],
    'ambiguous same-account reward was transferred to the remapped character');
  assert.deepStrictEqual(ambiguousHistory.details.arrivalTransferredPlayerIds, [],
    'ambiguous same-account arrival marker was transferred to the remapped character');
}

function assertReputationFactionBackfill() {
  const first = simulation('reputation-faction-backfill');
  first.state.sites.issuer_board = {
    id: 'issuer_board',
    type: 'settlement',
    owner: 'old_klim',
    faction: 'old_klim',
    x: 20,
    y: 20
  };
  first.state.sites.hostile_lair = {
    id: 'hostile_lair',
    type: 'lair',
    owner: 'raiders',
    faction: 'raiders',
    x: 30,
    y: 30
  };
  first.state.parties.hostile_party = party('hostile_party', 'patrol', 'raiders');
  const completed = task('hostile_delivery', 'deliver_supplies', 'hostile_party', { status: 'completed' });
  completed.issuerSiteId = 'issuer_board';
  completed.siteId = 'hostile_lair';
  completed.faction = 'raiders';
  completed.details = { rewardFactionId: 'raiders' };
  first.state.worldTasks = [completed];
  first.sim.save(true);

  const reloaded = createWastelandSimulation({
    stateFile: first.stateFile,
    getGlobalMap: testMap,
    gameDayRealMs: 60 * 60 * 1000,
    saveIntervalMs: 3000
  });
  const reloadedTask = [
    ...(reloaded.state().worldTasks || []),
    ...(reloaded.state().worldTaskHistory || [])
  ].find(row => row.id === completed.id);
  assert.strictEqual(reloadedTask?.details?.rewardFactionId, 'old_klim',
    'a hostile target/party captured reputation before the joinable issuer faction');

  reloaded.state().sites.issuer_board.owner = 'scrap_union';
  reloaded.state().sites.issuer_board.faction = 'scrap_union';
  reloaded.state().parties.hostile_party.faction = 'caravans';
  reloaded.save(true);
  const restarted = createWastelandSimulation({
    stateFile: first.stateFile,
    getGlobalMap: testMap,
    gameDayRealMs: 60 * 60 * 1000,
    saveIntervalMs: 3000
  });
  assert.strictEqual(
    [
      ...(restarted.state().worldTasks || []),
      ...(restarted.state().worldTaskHistory || [])
    ].find(row => row.id === completed.id)?.details?.rewardFactionId,
    'old_klim',
    'the completed-task reputation faction changed after world ownership changed'
  );
}

function assertClaimLedgerContract() {
  const claims799 = Array.from({ length: 799 }, (_, index) => `claim_${index}`);
  assert.strictEqual(sanitizeWorldTaskClaimIds(claims799).length, 799, 'claim ledger truncated below its limit');
  const claims801 = Array.from({ length: 801 }, (_, index) => `claim_${index}`);
  const capped = sanitizeWorldTaskClaimIds(claims801);
  assert.strictEqual(WORLD_TASK_CLAIM_LIMIT, 800, 'claim ledger no longer covers retained world-task history');
  assert.strictEqual(capped.length, 800, 'claim ledger did not enforce its exact limit');
  assert.strictEqual(capped[0], 'claim_1', 'claim ledger did not retain the newest 800 entries');
  assert.strictEqual(capped.at(-1), 'claim_800', 'claim ledger lost its newest entry');
  const duplicateHeavy = sanitizeWorldTaskClaimIds([
    'older_unique',
    ...Array.from({ length: 900 }, () => 'duplicate'),
    'newer_unique',
    'bad claim!',
    ''
  ]);
  assert.deepStrictEqual(duplicateHeavy, ['older_unique', 'duplicate', 'newer_unique', 'badclaim'],
    'claim ledger sliced before deduplication or normalized entries inconsistently');
  assert.deepStrictEqual(sanitizeWorldTaskClaimIds(duplicateHeavy), duplicateHeavy,
    'claim ledger sanitizer is not idempotent');
}

function assertPublicIdentityRedaction() {
  const { sim, state } = simulation('public-identity-redaction');
  const secretDetails = {
    rewardMemberKeys: ['account:character'],
    arrivalTransferredPlayerIds: ['account:character'],
    rewardPlayerIds: ['socket_secret'],
    rewardCharacterIds: ['character_secret'],
    eligibleRewardPlayerIds: ['socket_secret'],
    eligibleRewardCharacterIds: ['character_secret'],
    joinedPlayers: ['character_secret'],
    playerId: 'socket_secret',
    characterId: 'character_secret',
    harmless: 'visible'
  };
  const current = task('redaction_current', 'deliver_supplies', '');
  current.details = { ...secretDetails };
  const archived = task('redaction_archived', 'deliver_supplies', '', { status: 'completed' });
  archived.details = { ...secretDetails };
  state.worldTasks = [current];
  state.worldTaskHistory = [archived];
  state.parties.redaction_party = party('redaction_party', 'patrol', 'old_klim', {
    playerMembers: [member('character_secret', 'redaction_current', { userId: 'account_secret' })]
  });
  state.events = [{
    id: 'secret_event',
    type: 'test',
    title: 'test',
    userId: 'account_secret',
    accountId: 'account_secret',
    characterId: 'character_secret',
    playerId: 'socket_secret',
    socketId: 'socket_secret',
    ownerPlayerId: 'socket_secret'
  }];
  state.worldZones = [{
    id: 'secret_zone',
    status: 'active',
    sourceType: 'player',
    sourceId: 'character_secret',
    details: {
      playerId: 'socket_secret',
      startedByPlayerId: 'character_secret',
      actors: [{ id: 'actor', inventory: [{ id: 'silver', qty: 999 }] }]
    }
  }];
  const rows = [
    sim.publicState().worldTasks.find(row => row.id === current.id),
    ...sim.publicWorldTasks([current.id, archived.id])
  ].filter(Boolean);
  const hiddenFields = Object.keys(secretDetails).filter(key => key !== 'harmless');
  for (const row of rows) {
    for (const field of hiddenFields) {
      assert.strictEqual(row.details?.[field], undefined,
        `public task ${row.id} leaked private field ${field}`);
    }
    assert.strictEqual(row.details?.harmless, 'visible', `public task ${row.id} lost harmless details`);
  }
  const publicEvent = sim.publicState().events.find(row => row.id === 'secret_event');
  for (const field of ['userId', 'accountId', 'characterId', 'playerId', 'socketId', 'ownerPlayerId']) {
    assert.strictEqual(publicEvent?.[field], undefined, `public world event leaked ${field}`);
  }
  assert.deepStrictEqual(sim.publicState().worldZones, [],
    'public wasteland state exposed hidden world zones, actors, or loot');
  const publicPartyMember = sim.publicState().parties
    .find(row => row.id === 'redaction_party')?.playerMembers?.[0];
  assert.strictEqual(publicPartyMember?.characterId, undefined,
    'public world-party roster exposed a stable character id');
  assert.notStrictEqual(publicPartyMember?.id, 'character_secret',
    'public world-party roster reused the stable character id as its row id');
}

function assertPublicMotionSnapshot() {
  const { sim, state } = simulation('public-motion-snapshot');
  const firstSampleAt = Date.now() - 6000;
  state.lastTickAt = firstSampleAt;
  state.parties.motion_party = {
    ...party('motion_party'),
    x: 30,
    y: 30,
    infrastructureRouteIndex: 2,
    infrastructureRoutePoints: [
      { x: 30, y: 30 },
      { x: 45, y: 30 },
      { x: 45, y: 45 },
      { x: 60, y: 45 }
    ]
  };

  const first = sim.publicState();
  const publicParty = first.parties.find(row => row.id === 'motion_party');
  assert.strictEqual(first.sampledAt, firstSampleAt,
    'public motion snapshot is not anchored to the authoritative simulation tick');
  assert(first.serverNow >= first.sampledAt,
    'public motion snapshot does not expose a comparable server clock');
  assert.deepStrictEqual(publicParty.movementRoutePoints, [
    { x: 30, y: 30 },
    { x: 32.12, y: 32.12 }
  ], 'public motion snapshot does not preserve the authoritative near-term route segment');
  assert(publicParty.movementRoutePoints.every(point => point.x < 45 && point.y < 45),
    'public motion snapshot leaked route geometry beyond the interpolation horizon');

  const repeated = sim.publicState();
  assert.strictEqual(repeated.sampledAt, first.sampledAt,
    'reading public state without a simulation tick changed the motion sample');
  const nextSampleAt = Date.now() - 1000;
  sim.tick(nextSampleAt, { hours: 0.01, force: true });
  assert.strictEqual(sim.publicState().sampledAt, nextSampleAt,
    'a simulation tick did not advance the public motion sample');
}

function assertUnrelatedEncounterCannotFinishEscorts() {
  const { sim, state } = simulation('unrelated-raider-victory');
  state.parties.caravan_a = party('caravan_a', 'caravan', 'caravans', {
    state: 'moving',
    playerMembers: [member('escort_a', 'escort_a', { userId: 'account_a' })]
  });
  state.parties.caravan_b = party('caravan_b', 'caravan', 'caravans', {
    state: 'moving',
    playerMembers: [member('escort_b', 'escort_b', { userId: 'account_b' })]
  });
  state.worldTasks = [
    task('escort_a', 'escort_caravan', 'caravan_a'),
    task('escort_b', 'escort_caravan', 'caravan_b')
  ];
  sim.recordEncounterOutcome({
    encounterId: 'unrelated_raider_fight',
    worldPoint: { x: 90, y: 90 },
    deadFactions: ['raiders'],
    aliveFactions: ['old_klim'],
    playerInvolved: true,
    playerId: 'unrelated_player'
  });
  assert.deepStrictEqual(state.worldTasks.map(row => row.status), ['active', 'active'],
    'an unrelated raider victory completed a caravan escort');
  assert.strictEqual(state.parties.caravan_a.playerMembers.length, 1,
    'an unrelated fight removed the first caravan escort');
  assert.strictEqual(state.parties.caravan_b.playerMembers.length, 1,
    'an unrelated fight removed the second caravan escort');
}

function serverSourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `server test section is missing start marker: ${startMarker}`);
  assert(end > start, `server test section is missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function evaluateServerFunctions(source, sections, names, globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(
    `${sections.map(([start, end]) => serverSourceSection(source, start, end)).join('\n')}\n`
      + `this.__testedFunctions = { ${names.join(', ')} };`,
    context
  );
  return context.__testedFunctions;
}

function assertServerPersistenceFaultRecovery() {
  const serverSource = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const originalState = { marker: 'durable' };
  const originalSummary = { id: 'character_player', marker: 'durable' };
  const row = {
    state: originalState,
    updatedAt: 10,
    summary: originalSummary
  };
  let persistenceShouldThrow = true;
  const persistenceApi = evaluateServerFunctions(
    serverSource,
    [['function persistActivePlayerStates(', 'function publicTravelPartyMember(']],
    ['persistActivePlayerState', 'persistActivePlayerStates'],
    {
      performance: { now: () => 1 },
      activePlayerPersistenceMetrics: {
        writeAttempts: 0,
        writeFailures: 0,
        rowsStaged: 0,
        coalescedWritesAvoided: 0,
        writeTotalMs: 0,
        writeMaxMs: 0
      },
      normalizeCharacterId: value => String(value || ''),
      ensureUserCharacterStore: () => ({ character_player: row }),
      mergeAuthoritativeCharacterState: () => ({ marker: 'next' }),
      summarizeState: () => ({ id: 'character_player', marker: 'next' }),
      persistSaves: () => {
        if (persistenceShouldThrow) throw new Error('injected disk failure');
      }
    }
  );
  assert.throws(
    () => persistenceApi.persistActivePlayerState({ userId: 'account_player', characterId: 'character_player' }),
    /injected disk failure/,
    'active-player persistence swallowed an injected atomic-write failure'
  );
  assert.strictEqual(row.state, originalState,
    'failed active-player persistence left a newer state in the in-memory save database');
  assert.strictEqual(row.summary, originalSummary,
    'failed active-player persistence left a newer summary in the in-memory save database');
  assert.strictEqual(row.updatedAt, 10,
    'failed active-player persistence left a newer timestamp in the in-memory save database');
  persistenceShouldThrow = false;
  assert.strictEqual(
    persistenceApi.persistActivePlayerState({ userId: 'account_player', characterId: 'character_player' }),
    true,
    'active-player persistence could not recover after an injected write failure'
  );
  assert.strictEqual(row.state.marker, 'next',
    'successful retry did not commit the new active-player state');

  let attachmentPersistCalls = 0;
  const attachmentEmissions = [];
  const attachmentApi = evaluateServerFunctions(
    serverSource,
    [['function syncServerPlayerWorldPartyAttachment(', 'function syncWorldPartyPlayerAttachments(']],
    ['syncServerPlayerWorldPartyAttachment'],
    {
      console: { error() {} },
      serverWorldPartyAttachmentForPlayer: () => null,
      sanitizeServerWorldTaskIds: values => [...new Set((Array.isArray(values) ? values : []).map(String))],
      sanitizeServerGlobalMapPoint: point => point && ({ x: Number(point.x || 0), y: Number(point.y || 0) }),
      serverPlayerActiveWorldPartyTask: () => null,
      persistActivePlayerState: () => {
        attachmentPersistCalls++;
        if (attachmentPersistCalls === 1) throw new Error('injected attachment write failure');
        return true;
      },
      emitAuthoritativePlayerState: (_player, payload) => attachmentEmissions.push(payload),
      removePlayerFromIndependentGlobalTravelSessions() {},
      serverPlayerIsInAttachedPartyRoom: () => false,
      io: { sockets: { sockets: new Map() } },
      leaveCurrentRoom() {}
    }
  );
  const simState = {
    parties: {
      party_player: { id: 'party_player', x: 18, y: 22 }
    }
  };
  const player = {
    id: 'socket_player',
    attachedPartyId: 'party_player',
    attachedPartyTaskId: 'task_player',
    roomId: '',
    onGlobalMap: false,
    worldTaskAccepted: ['task_player'],
    worldTaskTrackedId: 'task_player'
  };
  const failedAttachment = attachmentApi.syncServerPlayerWorldPartyAttachment(
    player,
    simState,
    { persist: true, emit: true }
  );
  assert.strictEqual(failedAttachment.pending, true,
    'attachment sync did not retain a retry marker after an injected persistence failure');
  assert.strictEqual(player.worldPartyAttachmentPersistPending, true,
    'attachment persistence retry flag was not set');
  assert.strictEqual(attachmentEmissions.length, 0,
    'attachment state was emitted before its durable save succeeded');
  const recoveredAttachment = attachmentApi.syncServerPlayerWorldPartyAttachment(
    player,
    simState,
    { persist: true, emit: true }
  );
  assert.strictEqual(attachmentPersistCalls, 2,
    'unchanged attachment state was not persisted again after the injected failure');
  assert.strictEqual(recoveredAttachment.changed, true,
    'attachment retry was hidden from the task-lifecycle dedupe path');
  assert.strictEqual(player.worldPartyAttachmentPersistPending, false,
    'successful attachment retry did not clear the persistence marker');
  assert.strictEqual(player.worldPartyAttachmentEmitPending, false,
    'successful attachment retry did not clear the emission marker');
  assert.strictEqual(attachmentEmissions.length, 1,
    'attachment retry did not emit exactly one authoritative detached state');
  assert.strictEqual(attachmentEmissions[0]?.reason, 'worldPartyDetached',
    'attachment retry emitted the wrong authoritative state reason');

  const joinLikePlayer = {
    id: 'socket_join',
    attachedPartyId: 'party_player',
    attachedPartyTaskId: 'task_player',
    roomId: '',
    onGlobalMap: false,
    worldTaskAccepted: [],
    worldTaskTrackedId: ''
  };
  attachmentApi.syncServerPlayerWorldPartyAttachment(
    joinLikePlayer,
    simState,
    { persist: false, emit: false }
  );
  assert.strictEqual(joinLikePlayer.worldPartyAttachmentPersistPending, true,
    'join/task attachment mutation without an inline save did not schedule a durable retry');
}

function assertGlobalTravelLeaderDisconnectRecovery() {
  const serverSource = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const globalTravelSessions = new Map();
  const emitted = [];
  const persisted = [];
  const persistenceErrors = [];
  let failingPersistId = '';
  const leader = {
    id: 'socket_leader', name: 'Leader', onGlobalMap: true,
    globalWorldPoint: { x: 10, y: 20 }, pendingLocationTransition: null
  };
  const follower = {
    id: 'socket_follower', name: 'Follower', onGlobalMap: true,
    globalWorldPoint: { x: 10, y: 20 }, pendingLocationTransition: null
  };
  const players = new Map([[leader.id, leader], [follower.id, follower]]);
  const api = evaluateServerFunctions(
    serverSource,
    [['function cleanupGlobalTravelSessionsForSocket(', 'function publicPlayerMovement(']],
    ['cleanupGlobalTravelSessionsForSocket'],
    {
      globalTravelSessions,
      players,
      serverGlobalTravelCurrentPoint: () => ({ x: 33, y: 44 }),
      persistActivePlayerStates: members => {
        persisted.push(...members.map(member => member.id));
        if (members.some(member => member.id === failingPersistId)) throw new Error('injected global travel write failure');
        return true;
      },
      console: { error: (...args) => persistenceErrors.push(args) },
      io: {
        sockets: {
          sockets: new Map([[follower.id, {
            emit: (eventName, payload) => emitted.push({ eventName, payload })
          }]])
        }
      }
    }
  );
  globalTravelSessions.set(leader.id, {
    id: 'travel_a', leaderId: leader.id, leaderName: leader.name,
    memberIds: [leader.id, follower.id], terminating: false
  });
  api.cleanupGlobalTravelSessionsForSocket(leader.id);
  assert.strictEqual(globalTravelSessions.size, 0,
    'leader disconnect retained a dead global travel session');
  assert.deepStrictEqual(persisted.sort(), [follower.id, leader.id].sort(),
    'leader disconnect did not persist every released member at the route point');
  assert.strictEqual(emitted.length, 1,
    'leader disconnect did not emit exactly one release to the remaining follower');
  assert.strictEqual(emitted[0].eventName, 'globalTravelGroupReleased');
  assert.deepStrictEqual(
    {
      previousLeaderId: emitted[0].payload.previousLeaderId,
      leaderId: emitted[0].payload.leaderId,
      worldPoint: emitted[0].payload.worldPoint
    },
    {
      previousLeaderId: leader.id,
      leaderId: follower.id,
      worldPoint: { x: 33, y: 44 }
    },
    'released follower did not receive a self-led authoritative world-map state'
  );

  emitted.length = 0;
  globalTravelSessions.set(leader.id, {
    id: 'travel_b', leaderId: leader.id, leaderName: leader.name,
    memberIds: [leader.id, follower.id], terminating: false
  });
  api.cleanupGlobalTravelSessionsForSocket(follower.id);
  assert.strictEqual(globalTravelSessions.get(leader.id)?.memberIds.length, 1,
    'follower disconnect incorrectly dissolved the leader route');
  assert.strictEqual(globalTravelSessions.get(leader.id)?.memberIds[0], leader.id);
  assert.strictEqual(emitted.length, 0,
    'follower disconnect emitted a false leader-release event');

  emitted.length = 0;
  persisted.length = 0;
  failingPersistId = leader.id;
  globalTravelSessions.set(leader.id, {
    id: 'travel_c', leaderId: leader.id, leaderName: leader.name,
    memberIds: [leader.id, follower.id], terminating: false
  });
  api.cleanupGlobalTravelSessionsForSocket(leader.id);
  assert.strictEqual(globalTravelSessions.size, 0,
    'failed release persistence retained the dead leader session lock');
  assert.deepStrictEqual(persisted, [leader.id, follower.id],
    'one failed release persistence prevented later members from being processed');
  assert.strictEqual(emitted.length, 1,
    'one failed release persistence prevented the online follower release event');
  assert.strictEqual(emitted[0].payload.leaderId, follower.id,
    'persistence failure released the follower under the wrong leader');
  assert.strictEqual(persistenceErrors.length, 1,
    'release persistence failure was not contained and reported exactly once');
}

function assertServerWorldTransferFaultRecovery() {
  const serverSource = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const transferErrors = [];
  const transferEvents = [];
  const departureEvents = [];
  let persistCalls = 0;
  let removeTravelCalls = 0;
  let hostilityCalls = 0;
  let refreshCalls = 0;
  let joinCalls = 0;
  let leaveCalls = 0;
  const player = {
    id: 'socket_player',
    userId: 'account_player',
    characterId: 'character_player',
    name: 'Player',
    hp: 85,
    maxHp: 100,
    roomId: 'old_room',
    locationId: 'settlement',
    lastVisitedSettlementId: 'settlement',
    onGlobalMap: true,
    input: { forward: 1, right: -1 },
    vx: 3,
    vz: -2,
    moving: true,
    x: 4,
    z: 5,
    angle: 0.5
  };
  const oldRoom = {
    id: 'old_room',
    locationId: 'settlement',
    sockets: new Set([player.id])
  };
  const targetRoom = {
    id: 'target_room',
    locationId: 'randomRuinedRoad',
    sockets: new Set(),
    worldState: { id: 'target_world' },
    encounterId: 'test_encounter',
    worldZoneId: 'zone_test',
    worldPartyId: 'party_test',
    worldSiteId: 'site_test',
    encounterWorldPoint: { x: 30, y: 40 }
  };
  const rooms = new Map([
    [oldRoom.id, oldRoom],
    [targetRoom.id, targetRoom]
  ]);
  const socket = {
    id: player.id,
    rooms: new Set([player.id, oldRoom.id]),
    join(roomId) {
      joinCalls++;
      this.rooms.add(roomId);
    },
    leave(roomId) {
      leaveCalls++;
      this.rooms.delete(roomId);
    },
    to(roomId) {
      return {
        emit(eventName, payload) {
          departureEvents.push({ roomId, eventName, payload });
        }
      };
    },
    emit(eventName, payload) {
      transferEvents.push({ eventName, payload });
    }
  };
  const players = new Map([[player.id, player]]);
  const transferApi = evaluateServerFunctions(
    serverSource,
    [['function snapshotServerWorldTransferPlayer(', 'function syncWorldBattleRooms(']],
    [
      'snapshotServerWorldTransferPlayer',
      'restoreServerWorldTransferPlayer',
      'movePlayerSocketToServerRoom',
      'transferPlayerToServerRoom'
    ],
    {
      console: { error: (...args) => transferErrors.push(args) },
      Set,
      rooms,
      players,
      io: { sockets: { sockets: new Map([[player.id, socket]]) } },
      MAP_SIZE: 1000,
      playerSpawnWorld: () => ({ x: 10, z: 20 }),
      findRoomSafeSpawnWorld: () => ({ x: 11, z: 21 }),
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      rememberPlayerSettlement: p => {
        p.lastVisitedSettlementId = 'target_settlement';
      },
      persistActivePlayerState: () => {
        persistCalls++;
        if (persistCalls === 1) throw new Error('injected transfer write failure');
        return persistCalls >= 3;
      },
      markRoomEmptyIfNeeded() {},
      removePlayerFromIndependentGlobalTravelSessions: () => {
        removeTravelCalls++;
      },
      applyRememberedEncounterHostilityForPlayer: () => {
        hostilityCalls++;
      },
      refreshRoomWorldState: () => {
        refreshCalls++;
      },
      publicPlayer: p => ({ id: p.id, roomId: p.roomId }),
      currentRoomWorldState: room => room.worldState,
      emitEnemyBaselineForSocket() {},
      emitGroundItemsSnapshot() {},
      emitWorldContainersSnapshot() {}
    }
  );
  const projectPlayer = p => ({
    roomId: p.roomId,
    locationId: p.locationId,
    lastVisitedSettlementId: p.lastVisitedSettlementId,
    onGlobalMap: p.onGlobalMap,
    input: { ...(p.input || {}) },
    vx: p.vx,
    vz: p.vz,
    moving: p.moving,
    x: p.x,
    z: p.z,
    angle: p.angle
  });
  const before = projectPlayer(player);
  for (const expectedPersistCalls of [1, 2]) {
    assert.strictEqual(
      transferApi.transferPlayerToServerRoom(player, targetRoom, {
        reason: 'faultTest',
        angle: 1.25
      }),
      false,
      'world transfer succeeded despite an injected persistence failure'
    );
    assert.deepStrictEqual(projectPlayer(player), before,
      'failed world transfer did not restore every mutated player field');
    assert.strictEqual(persistCalls, expectedPersistCalls,
      'world transfer persistence was called an unexpected number of times');
    assert(oldRoom.sockets.has(player.id),
      'failed world transfer removed the player from the old room');
    assert(!targetRoom.sockets.has(player.id),
      'failed world transfer added the player to the target room');
    assert(socket.rooms.has(oldRoom.id) && !socket.rooms.has(targetRoom.id),
      'failed world transfer changed Socket.IO room membership');
    assert.strictEqual(removeTravelCalls, 0,
      'failed world transfer destroyed an independent travel session');
    assert.strictEqual(hostilityCalls, 0,
      'failed world transfer changed target-room hostility');
    assert.strictEqual(refreshCalls, 0,
      'failed world transfer refreshed the target room before persistence');
    assert.strictEqual(transferEvents.length, 0,
      'failed world transfer notified the client');
  }
  assert.strictEqual(
    transferApi.transferPlayerToServerRoom(player, targetRoom, {
      reason: 'faultTest',
      angle: 1.25
    }),
    true,
    'world transfer did not recover after injected persistence failures'
  );
  assert.strictEqual(persistCalls, 3, 'world transfer did not make exactly three persistence attempts');
  assert.strictEqual(player.roomId, targetRoom.id, 'successful retry did not move the player state');
  assert.strictEqual(player.locationId, targetRoom.locationId, 'successful retry kept the old location');
  assert.strictEqual(player.x, 11, 'successful retry did not use the safe target spawn');
  assert.strictEqual(player.z, 21, 'successful retry did not use the safe target spawn');
  assert.strictEqual(player.angle, 1.25, 'successful retry did not apply the requested entry angle');
  assert(!oldRoom.sockets.has(player.id) && targetRoom.sockets.has(player.id),
    'successful retry did not atomically replace room membership');
  assert(!socket.rooms.has(oldRoom.id) && socket.rooms.has(targetRoom.id),
    'successful retry did not replace Socket.IO room membership');
  assert.strictEqual(joinCalls, 1, 'successful retry joined the target room more than once');
  assert.strictEqual(leaveCalls, 1, 'successful retry left the old room more than once');
  assert.strictEqual(removeTravelCalls, 1, 'successful retry did not clear independent travel exactly once');
  assert.strictEqual(hostilityCalls, 1, 'successful retry did not restore remembered hostility exactly once');
  assert.strictEqual(refreshCalls, 1, 'successful retry did not refresh the target room exactly once');
  assert.strictEqual(
    transferEvents.filter(row => row.eventName === 'serverWorldTransfer').length,
    1,
    'successful retry did not emit exactly one authoritative world transfer'
  );
  assert.strictEqual(
    departureEvents.filter(row => row.eventName === 'playerLeft' && row.roomId === oldRoom.id).length,
    1,
    'successful retry did not emit exactly one old-room departure'
  );

  const dedupeApi = evaluateServerFunctions(
    serverSource,
    [['function transferSetAddLimited(', 'function prepareWorldZoneTransferRoom(']],
    ['runServerWorldTransferOnce'],
    { console: { error() {} } }
  );
  const dedupe = new Set();
  assert.strictEqual(
    dedupeApi.runServerWorldTransferOnce(dedupe, 'transfer_key', () => {
      throw new Error('injected callback failure');
    }),
    false,
    'deduplicated transfer leaked an injected callback exception'
  );
  assert.strictEqual(dedupe.has('transfer_key'), false,
    'thrown transfer callback left a permanent dedupe marker');
  assert.strictEqual(
    dedupeApi.runServerWorldTransferOnce(dedupe, 'transfer_key', () => false),
    false,
    'deduplicated transfer changed a failed callback result'
  );
  assert.strictEqual(dedupe.has('transfer_key'), false,
    'failed transfer callback left a permanent dedupe marker');
  assert.strictEqual(
    dedupeApi.runServerWorldTransferOnce(dedupe, 'transfer_key', () => true),
    true,
    'deduplicated transfer did not accept a successful retry'
  );
  assert.strictEqual(dedupe.has('transfer_key'), true,
    'successful transfer did not retain its dedupe marker');
  assert.strictEqual(
    dedupeApi.runServerWorldTransferOnce(dedupe, 'transfer_key', () => true),
    null,
    'completed transfer executed again despite its dedupe marker'
  );
}

function assertSocketAndClientContract() {
  const serverSource = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const pipboySource = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'game', '03a_pipboy_social_world_tasks.js'), 'utf8');
  const globalMapSource = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'game', '10_global_map_state_logs_config.js'), 'utf8');
  const multiplayerSource = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'game', '05c_multiplayer_socket_room.js'), 'utf8');
  const clientSource = `${pipboySource}\n${globalMapSource}`;
  assert(!clientSource.includes("emit('worldTaskJoinParty'"), 'client still emits the legacy join event');
  assert(!clientSource.includes("emit('worldTaskLeaveParty'"), 'client still emits the legacy leave event');
  assert(globalMapSource.includes("emit('worldTaskAction', { action: 'cancel', taskId: leavingTaskId }"),
    'detaching from a party does not cancel the authoritative task');
  const joinHandler = serverSource.slice(
    serverSource.indexOf("socket.on('worldTaskJoinParty'"),
    serverSource.indexOf("socket.on('worldTaskAction'", serverSource.indexOf("socket.on('worldTaskJoinParty'"))
  );
  const leaveHandler = serverSource.slice(
    serverSource.indexOf("socket.on('worldTaskLeaveParty'"),
    serverSource.indexOf("socket.on('tradeMachineMarketState'", serverSource.indexOf("socket.on('worldTaskLeaveParty'"))
  );
  assert(joinHandler.includes('ok: false') && !joinHandler.includes('WASTELAND_SIM.joinWorldParty'),
    'legacy join handler can still mutate simulation state');
  assert(leaveHandler.includes('ok: false') && !leaveHandler.includes('WASTELAND_SIM.leaveWorldParty'),
    'legacy leave handler can still desynchronize accepted state');
  assert(serverSource.includes('worldTaskClaimEligible(task, player, accepted, worldTransferId)'),
    'server claim path does not use the shared group reward invariant');
  assert(serverSource.includes('WORLD_TASK_CLAIM_LIMIT: SERVER_WORLD_TASK_CLAIM_LIMIT')
    && serverSource.includes('sanitizeWorldTaskClaimIds: sanitizeServerWorldTaskClaimIds'),
  'server does not use the shared bounded unique claim ledger');
  assert(serverSource.includes('worldTaskClaimEligible(task, p, participated, worldTransferId)'),
    'arrival transfer bypasses the trusted group reward invariant');
  const arrivalTransfer = serverSource.slice(
    serverSource.indexOf('function syncWorldCaravanArrivalTransfers('),
    serverSource.indexOf('function syncWorldOnsitePartyTransfers(', serverSource.indexOf('function syncWorldCaravanArrivalTransfers('))
  );
  assert(
    arrivalTransfer.includes('const participated = accepted || alreadyClaimed;')
      && arrivalTransfer.includes('const persistentPlayerId = worldPartyServerMemberKey(p)'),
    'claiming before the arrival poll can suppress transfer or collapse account identity'
  );
  const travelStart = serverSource.slice(
    serverSource.indexOf("socket.on('globalTravelStart'"),
    serverSource.indexOf("socket.on('globalTravelEnterWorld'", serverSource.indexOf("socket.on('globalTravelStart'"))
  );
  assert(travelStart.includes('serverPlayerActiveWorldPartyTask(leader)'),
    'independent global travel can start without cancelling active world-party work');
  assert(travelStart.includes('members.find(member => serverPlayerActiveWorldPartyTask(member))'),
    'a travel leader can take an attached follower onto an independent route');
  assert(travelStart.includes('if (candidateExisting?.terminating) globalTravelSessions.delete(socket.id)')
    && travelStart.includes('candidateExisting && !candidateExisting.terminating'),
  'a completed route can remain authoritative and reject a new destination');
  const enterWorld = serverSource.slice(
    serverSource.indexOf("socket.on('globalTravelEnterWorld'"),
    serverSource.indexOf("socket.on('globalTravelCancel'", serverSource.indexOf("socket.on('globalTravelEnterWorld'"))
  );
  assert(enterWorld.includes('serverPlayerActiveWorldPartyTask(leader)'),
    'an attached player can enter an independent world route without cancelling group work');
  assert(enterWorld.includes('party.find(member => serverPlayerActiveWorldPartyTask(member))'),
    'world entry can carry a nearby attached member onto an independent route');
  const arrivalHandler = serverSource.slice(
    serverSource.indexOf('function handleServerGlobalTravelArrival('),
    serverSource.indexOf('function globalTravelMemberIsFollower(', serverSource.indexOf('function handleServerGlobalTravelArrival('))
  );
  const arrivalSocketHandler = serverSource.slice(
    serverSource.indexOf("socket.on('globalTravelArrive'"),
    serverSource.indexOf("socket.on('shoot'", serverSource.indexOf("socket.on('globalTravelArrive'"))
  );
  assert(arrivalSocketHandler.includes('handleServerGlobalTravelArrival(socket, data, ack)')
    && !arrivalSocketHandler.includes('globalTravelSessions')
    && !arrivalSocketHandler.includes('emitGlobalTravelToParty')
    && !arrivalSocketHandler.includes('pendingLocationTransition'),
  'globalTravelArrive socket handler contains a second unreachable implementation instead of one authoritative delegate');
  assert(arrivalHandler.includes('find(member => serverPlayerActiveWorldPartyTask(member) || member.attachedPartyTaskId)'),
    'a legacy independent route can arrive with a member attached to a world party');
  const travelDescriptor = serverSource.slice(
    serverSource.indexOf('function serverGlobalTravelPublicDescriptor('),
    serverSource.indexOf('function serverGlobalWorldPartyRadius(', serverSource.indexOf('function serverGlobalTravelPublicDescriptor('))
  );
  assert(travelDescriptor.includes('session.terminating'),
    'terminal global travel can still be serialized as an active route');
  assert(arrivalHandler.indexOf('session.terminating = true') >= 0
    && arrivalHandler.indexOf('session.terminating = true') < arrivalHandler.indexOf('persistActivePlayerStates(arrivingMembers)'),
  'global travel arrival persists players before suppressing the completed route descriptor');
  const travelCleanup = serverSource.slice(
    serverSource.indexOf('function cleanupGlobalTravelSessionsForSocket('),
    serverSource.indexOf('function publicPlayerMovement(', serverSource.indexOf('function cleanupGlobalTravelSessionsForSocket('))
  );
  assert(travelCleanup.indexOf('session.terminating = true') >= 0
    && travelCleanup.indexOf('session.terminating = true') < travelCleanup.indexOf('persistActivePlayerStates(membersToPersist)'),
  'leader disconnect persists players before suppressing the cancelled route descriptor');
  assert(travelCleanup.indexOf('globalTravelSessions.delete(leaderId)') >= 0
    && travelCleanup.indexOf('globalTravelSessions.delete(leaderId)') < travelCleanup.indexOf('persistActivePlayerStates(membersToPersist)')
    && travelCleanup.includes("console.error('Global travel release persistence failed:'"),
  'leader disconnect can leave a follower locked when one release save fails');
  const travelCancel = serverSource.slice(
    serverSource.indexOf("socket.on('globalTravelCancel'"),
    serverSource.indexOf("socket.on('globalMapCreateAmbush'", serverSource.indexOf("socket.on('globalTravelCancel'"))
  );
  assert(travelCancel.indexOf('session.terminating = true') >= 0
    && travelCancel.indexOf('session.terminating = true') < travelCancel.indexOf('persistActivePlayerStates(cancellingMembers)'),
  'global travel cancellation persists players before suppressing the cancelled route descriptor');
  assert(serverSource.includes('syncWorldPartyPlayerAttachments(simState);'),
    'world-party attachment is not reconciled on the server tick');
  assert(serverSource.includes('if (!p.attachedPartyTaskId) {')
    && serverSource.includes('attachedPartyId: worldTransferId(savedGlobalMap.attachedPartyId'),
  'reconnect creates an independent route instead of restoring server world-party attachment');
  assert(serverSource.includes('attachedPartyId,')
    && serverSource.includes('attachedPartyTaskId,'),
  'authoritative global-map state omits server world-party attachment');
  const authoritativeGlobalMap = serverSource.slice(
    serverSource.indexOf('function serverAuthoritativeGlobalMapState('),
    serverSource.indexOf('function publicAuthoritativePlayerState(', serverSource.indexOf('function serverAuthoritativeGlobalMapState('))
  );
  assert(authoritativeGlobalMap.includes('travelLeaderId: session?.leaderId')
    && authoritativeGlobalMap.includes('travelLeaderName: session?.leaderName'),
  'authoritative global-map state omits the reconnect-safe travel leader');
  assert(serverSource.includes('SERVER_JOINABLE_WORLD_FACTIONS.has(frozenFactionId)'),
    'reward reputation does not prioritize the faction frozen at task completion');
  assert(serverSource.includes("p.worldTaskRecordFingerprint = serverWorldTaskRecordFingerprint(p);"),
    'join/action paths do not initialize the task lifecycle fingerprint');
  const lifecycleSync = serverSource.slice(
    serverSource.indexOf('function syncWorldPartyPlayerAttachments('),
    serverSource.indexOf('function onlinePlayerForWorldPartyMember(', serverSource.indexOf('function syncWorldPartyPlayerAttachments('))
  );
  assert(
    lifecycleSync.includes('previousTaskFingerprint !== taskFingerprint')
      && lifecycleSync.includes("emitAuthoritativePlayerState(p, { reason: 'worldTaskLifecycle' })"),
    'accepted players do not receive a personalized self snapshot when a shared task becomes terminal'
  );
  const attachmentReconcile = globalMapSource.slice(
    globalMapSource.indexOf('function reconcileGlobalMapWorldPartyAttachment('),
    globalMapSource.indexOf('function applyWastelandSimState(', globalMapSource.indexOf('function reconcileGlobalMapWorldPartyAttachment('))
  );
  assert(
    attachmentReconcile.includes("task.status === 'active'")
      && attachmentReconcile.includes("String(task.partyId || '') === attachedPartyId")
      && !attachmentReconcile.includes('member?.characterId'),
    'client attachment still depends on globally exposed character identities'
  );
  assert(
    multiplayerSource.includes("completedWorldTaskId === String(globalMapState.attachedPartyTaskId || '').trim()")
      && multiplayerSource.includes('clearGlobalMapWorldPartyAttachmentLocal(data.worldPoint, { save: false })'),
    'terminal world transfer leaves the completed task attached on the client'
  );
  assert(attachmentReconcile.includes('&& (!task || ('),
    'a truncated top-30 task list is treated as a terminal attachment state');
  assert(multiplayerSource.includes('globalMapState.attachedPartyId = String(snapshot.globalMap.attachedPartyId')
    && multiplayerSource.includes('globalMapState.attachedPartyTaskId = String(snapshot.globalMap.attachedPartyTaskId'),
  'authoritative attachment is not synchronized while the player is in a local room');
  assert(pipboySource.includes("if (typeof multiplayer === 'object' && multiplayer?.joined) return false;"),
    'online reward UI remains fail-open without personalized eligibility');
  assert(serverSource.includes('syncWorldPlayerAmbushTransfers(simState);'),
    'triggered player ambushes are not transferred into their server room');
  assert(serverSource.includes("? 'В засаду вошёл отряд. Локация ожила.'")
    && serverSource.includes(": 'Ваш отряд попал в засаду.'"),
  'player ambush transfer still sends corrupted UI text');
  for (const setName of [
    'WORLD_ESCORT_BATTLE_TRANSFERS',
    'WORLD_AMBUSH_TRANSFERS',
    'WORLD_ESCORT_ARRIVAL_TRANSFERS',
    'WORLD_ONSITE_TRANSFERS'
  ]) {
    assert(serverSource.includes(`runServerWorldTransferOnce(${setName}, key`),
      `${setName} bypasses exception-safe transfer deduplication`);
  }
  const transferDedupe = serverSourceSection(
    serverSource,
    'function runServerWorldTransferOnce(',
    'function prepareWorldZoneTransferRoom('
  );
  assert(transferDedupe.includes('finally') && transferDedupe.includes('if (!transferred) set.delete(key);'),
    'failed server world transfer can permanently retain its dedupe marker');
  const arrivalTransferMarker = serverSourceSection(
    serverSource,
    'function syncWorldCaravanArrivalTransfers(',
    'function syncWorldOnsitePartyTransfers('
  );
  assert(
    arrivalTransferMarker.indexOf('recordWorldTaskPlayerTransfer')
      < arrivalTransferMarker.lastIndexOf('});'),
    'arrival transfer dedupe commits before its durable arrival marker'
  );
  const respawnFlow = serverSourceSection(
    serverSource,
    'function serverRespawnPlayer(',
    'function serverEnemyTypeIndexByName('
  );
  assert(respawnFlow.includes("failServerPlayerActiveWorldActivities(p, 'player_died')")
    && respawnFlow.includes('...detachServerPlayerFromActiveWorldParties(p)')
    && respawnFlow.indexOf('failServerPlayerActiveWorldActivities')
      < respawnFlow.indexOf('detachServerPlayerFromActiveWorldParties')
    && respawnFlow.includes("emitAuthoritativePlayerState(p, { reason: 'deathRespawn', detachedWorldTaskIds });"),
  'death/respawn does not atomically fail personal activities and detach active world-party work');
  const savedLocationContext = serverSource.slice(
    serverSource.indexOf('function serverLocationContextFromPlayer('),
    serverSource.indexOf('function mergeAuthoritativeCharacterState(', serverSource.indexOf('function serverLocationContextFromPlayer('))
  );
  assert(savedLocationContext.includes('room?.onsiteWorldZoneIds instanceof Set')
    && savedLocationContext.includes('String(zone.partyId || zone.details?.partyId || \'\') === attachedPartyId')
    && savedLocationContext.includes('worldZoneId: onsiteZone?.id'),
  'shared onsite-party context cannot survive reconnect without a visible double transfer');
  const publicPlayerBody = serverSource.slice(
    serverSource.indexOf('function publicPlayer('),
    serverSource.indexOf('function serverAuthoritativeGlobalMapState(', serverSource.indexOf('function publicPlayer('))
  );
  assert(!publicPlayerBody.includes('accountLogin'),
    'public room player payload exposes the account login');
  assert(serverSource.includes('if (player.onGlobalMap) {')
    && serverSource.includes('const roomSiteId = String(room?.worldSiteId || \'\');'),
  'world-site actions still trust stale global-map coordinates while the player is local');
  assert(serverSource.includes('characterIdOwnerUserIds(characterId)'),
    'new character creation does not defend global character-id collisions');
  assert(serverSource.includes('savesDb.characterIdMigrationJournal?.remaps')
    && serverSource.includes('delete savesDb.characterIdMigrationJournal;')
    && serverSource.indexOf('delete savesDb.characterIdMigrationJournal;')
      > serverSource.indexOf('const WORLD_PARTY_RECONCILIATION = reconcileSavedWorldPartyMembers();'),
  'legacy character-id remaps are not journaled until wasteland reconciliation is durably saved');
  assert(serverSource.includes('legacyCharacterIdRemaps: LEGACY_CHARACTER_ID_REMAPS'),
    'startup reconciliation does not receive persisted character-id remaps');
}

try {
  assertJoinContract();
  assertReconciliationContract();
  assertLegacyWorldIdentityMigration();
  assertReloadAndExpiryCleanup();
  assertPatrolDutyCompletion();
  assertRewardEligibility();
  assertLegacyCharacterIdMigration();
  assertReputationFactionBackfill();
  assertClaimLedgerContract();
  assertPublicIdentityRedaction();
  assertPublicMotionSnapshot();
  assertUnrelatedEncounterCannotFinishEscorts();
  assertServerPersistenceFaultRecovery();
  assertGlobalTravelLeaderDisconnectRecovery();
  assertServerWorldTransferFaultRecovery();
  assertSocketAndClientContract();
  console.log('World-party integrity check passed: authoritative attachment, reconnect-safe travel leaders, motion snapshots, late-join patrol duty, bounded claims, trusted rewards, and public redaction.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
