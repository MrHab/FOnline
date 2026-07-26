#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('./check-client-endpoint-selection');
require('./check-client-text-integrity');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function functionSource(source, name) {
  const match = new RegExp(`\\bfunction\\s+${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).exec(source);
  const start = match ? match.index : -1;
  assert(start >= 0, `Missing function ${name}`);
  const paramsOpen = source.indexOf('(', start);
  assert(paramsOpen >= 0, `Missing parameter list for ${name}`);
  let paramsDepth = 0;
  let paramsClose = -1;
  for (let index = paramsOpen; index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1;
    else if (source[index] === ')' && --paramsDepth === 0) {
      paramsClose = index;
      break;
    }
  }
  const open = source.indexOf('{', paramsClose);
  const close = matchingBrace(source, open);
  assert(open >= 0 && close > open, `Cannot extract function ${name}`);
  return source.slice(start, close + 1);
}

function functionBody(source, name) {
  const fn = functionSource(source, name);
  return fn.slice(fn.indexOf('{') + 1, -1);
}

function arrowDeclarationSource(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing declaration ${marker}`);
  const arrow = source.indexOf('=>', start);
  const open = source.indexOf('{', arrow);
  const close = matchingBrace(source, open);
  assert(arrow >= 0 && open >= 0 && close > open, `Cannot extract declaration ${marker}`);
  let end = close + 1;
  if (source[end] === ';') end += 1;
  return source.slice(start, end);
}

function socketEventSource(source, eventName) {
  const marker = `socket.on('${eventName}'`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing server socket event ${eventName}`);
  const end = source.indexOf('\n  socket.on(', start + marker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function assertContainsAll(label, source, snippets) {
  const missing = snippets.filter(snippet => !source.includes(snippet));
  assert.strictEqual(missing.length, 0, `${label} is missing: ${missing.join(' | ')}`);
}

const core = read('public/js/game/05_multiplayer_core_state.js');
const socketRoom = read('public/js/game/05c_multiplayer_socket_room.js');
const explosions = read('public/js/game/06b_explosions_speech.js');
const combat = read('public/js/game/06d_combat_damage_shooting.js');
const resources = read('public/js/game/06e_combat_targeting_loot_resources.js');
const containers = read('public/js/game/05d_world_containers_security.js');
const quests = read('public/js/game/07c_trader_dialogues_quests.js');
const loot = read('public/js/game/07e_loot_interaction.js');
const input = read('public/js/game/08f_input_events_proximity.js');
const interaction = read('public/js/game/08b_interaction_quick_access.js');
const updateLoop = read('public/js/game/09_update_fog_movement_ai.js');
const globalMapState = read('public/js/game/10_global_map_state_logs_config.js');
const globalMapWorldStatus = read('public/js/game/12a_global_map_world_status.js');
const globalMapPanel = read('public/js/game/12b_global_map_panel_window.js');
const globalMapTravel = read('public/js/game/12c_global_map_travel_encounters.js');
const globalMapEntry = read('public/js/game/12d_global_map_entry_ambush_controls.js');
const hudLoop = read('public/js/game/13_minimap_hud_loop.js');
const server = read('server.js');

function authorityRuntime() {
  return new Function([
    'const serverSession = { token: "" };',
    'let gameStarted = false;',
    'let characterProfile = null;',
    'let selectedServerCharacterId = "char-a";',
    'let activeCharacterLeaseId = "";',
    'function getClientInstanceId() { return "tab-a"; }',
    'const multiplayer = {',
    '  authorityMode: "offline-local",',
    '  onlineSessionRequired: false,',
    '  serverAuthoritativeEnemies: false,',
    '  socket: null,',
    '  joined: false,',
    '  joinedSocketId: "", joinedSessionToken: "", joinedCharacterId: "",',
    '  joinedClientInstanceId: "", characterLeaseId: ""',
    '};',
    functionSource(core, 'currentMultiplayerJoinContext'),
    functionSource(core, 'multiplayerJoinContextIsCurrent'),
    functionSource(core, 'multiplayerJoinedContextMatchesCurrent'),
    functionSource(core, 'clientWorldRequiresServer'),
    functionSource(core, 'clientAuthorityMode'),
    functionSource(core, 'clientGameplayIsBlocked'),
    functionSource(core, 'enemiesAreServerAuthoritative'),
    functionSource(core, 'clientEnemyStateMayUseLocalFallback'),
    functionSource(core, 'groundItemsAreServerAuthoritative'),
    functionSource(core, 'worldContainersAreServerAuthoritative'),
    'return {',
    '  serverSession, multiplayer, clientAuthorityMode, clientGameplayIsBlocked,',
    '  setGameStarted: value => { gameStarted = !!value; },',
    '  setProfile: value => { characterProfile = value; },',
    '  bindCurrent: () => {',
    '    activeCharacterLeaseId = "lease-a";',
    '    multiplayer.characterLeaseId = "lease-a";',
    '    multiplayer.joinedSessionToken = serverSession.token;',
    '    multiplayer.joinedCharacterId = selectedServerCharacterId;',
    '    multiplayer.joinedClientInstanceId = getClientInstanceId();',
    '  },',
    '  enemiesAreServerAuthoritative, clientEnemyStateMayUseLocalFallback,',
    '  groundItemsAreServerAuthoritative, worldContainersAreServerAuthoritative',
    '};'
  ].join('\n'))();
}

function assertAuthorityModes() {
  const runtime = authorityRuntime();
  assert.strictEqual(runtime.clientAuthorityMode(), 'offline-local',
    'unauthenticated local play must remain the only local simulation mode');
  assert.strictEqual(runtime.clientEnemyStateMayUseLocalFallback(), true,
    'offline-local mode must allow local enemy simulation');
  assert.strictEqual(runtime.groundItemsAreServerAuthoritative(), false,
    'offline-local mode must not pretend to have a server lease');

  runtime.setGameStarted(true);
  assert.strictEqual(runtime.clientAuthorityMode(), 'offline-local',
    'a genuinely local started world must remain offline-local');
  runtime.multiplayer.onlineSessionRequired = true;
  assert.strictEqual(runtime.clientAuthorityMode(), 'blocked',
    'clearing an expired token must not turn a sticky online world into offline simulation');
  runtime.multiplayer.onlineSessionRequired = false;
  runtime.setGameStarted(false);

  runtime.serverSession.token = 'session-token';
  runtime.multiplayer.authorityMode = 'server';
  assert.strictEqual(runtime.clientAuthorityMode(), 'blocked',
    'an authenticated client without a joined socket must fail closed');
  assert.strictEqual(runtime.clientGameplayIsBlocked(), true,
    'an authenticated disconnected client must block gameplay');
  assert.strictEqual(runtime.clientEnemyStateMayUseLocalFallback(), false,
    'an authenticated disconnected client must not start local AI');

  runtime.multiplayer.socket = { connected: true, id: 'socket-current' };
  runtime.multiplayer.joined = true;
  runtime.multiplayer.joinedSocketId = 'socket-stale';
  runtime.multiplayer.serverAuthoritativeEnemies = true;
  runtime.bindCurrent();
  assert.strictEqual(runtime.clientAuthorityMode(), 'blocked',
    'a stale joined socket id must not restore server authority');

  runtime.multiplayer.joinedSocketId = 'socket-current';
  assert.strictEqual(runtime.clientAuthorityMode(), 'server',
    'a joined current socket must restore server authority');
  assert.strictEqual(runtime.enemiesAreServerAuthoritative(), true,
    'enemy authority must be enabled only in server mode');
  assert.strictEqual(runtime.groundItemsAreServerAuthoritative(), true,
    'ground items must be server-authoritative in server mode');
  assert.strictEqual(runtime.worldContainersAreServerAuthoritative(), true,
    'world containers must be server-authoritative in server mode');
}

function assertAuthorityTransitionCleanup() {
  const runtime = new Function([
    'const multiplayer = { authorityMode: "server", authorityReason: "", serverAuthoritativeEnemies: true };',
    'const document = { body: { dataset: {} } };',
    'const calls = { input: [], world: 0, stamps: 0 };',
    'function clearClientGameplayInput(reason) { calls.input.push(reason); }',
    'function clearNetworkRoomEntities() { calls.world += 1; }',
    'function resetNetworkSnapshotStamps() { calls.stamps += 1; }',
    functionSource(core, 'setClientAuthorityMode'),
    'return { multiplayer, document, calls, setClientAuthorityMode };'
  ].join('\n'))();

  assert.strictEqual(runtime.setClientAuthorityMode('blocked', 'disconnect'), true);
  assert.strictEqual(runtime.multiplayer.authorityMode, 'blocked');
  assert.strictEqual(runtime.multiplayer.serverAuthoritativeEnemies, false);
  assert.strictEqual(runtime.document.body.dataset.authorityMode, 'blocked');
  assert.deepStrictEqual(runtime.calls, { input: ['disconnect'], world: 1, stamps: 1 },
    'entering blocked mode must neutralize input and clear stale network state');

  runtime.setClientAuthorityMode('blocked', 'repeat');
  assert.deepStrictEqual(runtime.calls, { input: ['disconnect'], world: 1, stamps: 1 },
    'repeated blocked state must not repeatedly clear the world without force');

  runtime.setClientAuthorityMode('blocked', 'forced', { force: true, clearWorld: false });
  assert.deepStrictEqual(runtime.calls, { input: ['disconnect', 'forced'], world: 1, stamps: 1 },
    'a forced blocked transition must reset input but may preserve an explicitly retained world');
}

function gameplayAckGuardRuntime() {
  return new Function([
    'const emitted = [];',
    'let selectedServerCharacterId = "character-a";',
    'let clientInstanceId = "client-a";',
    'let activeCharacterLeaseId = "lease-a";',
    'const serverSession = { token: "token-a" };',
    'const socket = {',
    '  connected: true,',
    '  id: "socket-a",',
    '  emit(eventName, payload, ack) { emitted.push({ eventName, payload, ack }); }',
    '};',
    'const multiplayer = {',
    '  socket, socketGeneration: 7, roomId: "room-a", joined: true,',
    '  joinedSocketId: "socket-a", joinedSessionToken: "token-a",',
    '  joinedCharacterId: "character-a", joinedClientInstanceId: "client-a",',
    '  characterLeaseId: "lease-a"',
    '};',
    'function getClientInstanceId() { return clientInstanceId; }',
    functionSource(core, 'currentMultiplayerJoinContext'),
    functionSource(core, 'multiplayerJoinContextIsCurrent'),
    functionSource(core, 'multiplayerJoinedContextMatchesCurrent'),
    functionSource(core, 'captureMultiplayerGameplayAckContext'),
    functionSource(core, 'multiplayerGameplayAckContextIsCurrent'),
    functionSource(core, 'emitGuardedMultiplayerGameplayAction'),
    'let mutations = 0;',
    'function emitMutation() {',
    '  return emitGuardedMultiplayerGameplayAction("lootEnemy", { enemyId: "enemy-a" }, ack => {',
    '    if (ack?.ok) mutations += 1;',
    '  });',
    '}',
    'return {',
    '  multiplayer, socket, emitted, emitMutation,',
    '  mutations: () => mutations,',
    '  setSelectedCharacter: value => { selectedServerCharacterId = value; },',
    '  restoreJoinContext: () => {',
    '    selectedServerCharacterId = "character-a";',
    '    clientInstanceId = "client-a";',
    '    activeCharacterLeaseId = "lease-a";',
    '    serverSession.token = "token-a";',
    '    socket.connected = true;',
    '    multiplayer.socket = socket;',
    '    multiplayer.socketGeneration = 7;',
    '    multiplayer.roomId = "room-a";',
    '    multiplayer.joined = true;',
    '    multiplayer.joinedSocketId = "socket-a";',
    '    multiplayer.joinedSessionToken = "token-a";',
    '    multiplayer.joinedCharacterId = "character-a";',
    '    multiplayer.joinedClientInstanceId = "client-a";',
    '    multiplayer.characterLeaseId = "lease-a";',
    '  }',
    '};'
  ].join('\n'))();
}

function assertGameplayAckGuards() {
  const runtime = gameplayAckGuardRuntime();

  assert.strictEqual(runtime.emitMutation(), true,
    'a joined current gameplay action must be emitted');
  assert.strictEqual(runtime.emitted.length, 1);
  runtime.multiplayer.socketGeneration += 1;
  runtime.emitted.shift().ack({ ok: true });
  assert.strictEqual(runtime.mutations(), 0,
    'a late gameplay ACK must not mutate state after socket generation changes');

  runtime.restoreJoinContext();
  assert.strictEqual(runtime.emitMutation(), true);
  runtime.multiplayer.roomId = 'room-b';
  runtime.emitted.shift().ack({ ok: true });
  assert.strictEqual(runtime.mutations(), 0,
    'a late gameplay ACK must not mutate state after a same-socket room change');

  runtime.restoreJoinContext();
  assert.strictEqual(runtime.emitMutation(), true);
  runtime.socket.connected = false;
  runtime.emitted.shift().ack({ ok: true });
  assert.strictEqual(runtime.mutations(), 0,
    'a late gameplay ACK must not mutate state after disconnect');

  runtime.restoreJoinContext();
  assert.strictEqual(runtime.emitMutation(), true);
  runtime.setSelectedCharacter('character-b');
  runtime.emitted.shift().ack({ ok: true });
  assert.strictEqual(runtime.mutations(), 0,
    'a late gameplay ACK must not mutate state after join identity changes');

  runtime.restoreJoinContext();
  assert.strictEqual(runtime.emitMutation(), true);
  runtime.emitted.shift().ack({ ok: true });
  assert.strictEqual(runtime.mutations(), 1,
    'a current gameplay ACK must still apply exactly once');

  for (const [source, eventName] of [
    [loot, 'lootEnemy'],
    [resources, 'harvestResource'],
    [containers, 'pickLock'],
    [containers, 'hackTerminal'],
    [containers, 'openWorldContainer'],
    [containers, 'lootWorldContainer'],
    [explosions, 'explosionAttack'],
    [explosions, 'enemyHit'],
    [combat, 'combatAttack'],
    [combat, 'enemyHit'],
    [combat, 'playerHit'],
    [combat, 'reloadWeapon']
  ]) {
    assert(
      source.includes(`emitGuardedMultiplayerGameplayAction('${eventName}'`),
      `${eventName} ACK is not protected by the shared gameplay context guard`
    );
  }
  assert(
    socketRoom.includes("multiplayer.socket.emit('changeLocation'"),
    'authoritative location-transition ACKs must remain outside the same-room gameplay guard'
  );
}

function joinFsmRuntime() {
  return new Function([
    'const authorityCalls = [];',
    'const waiterResults = [];',
    'const statusLines = [];',
    'const timers = [];',
    'let selectedServerCharacterId = "char-a";',
    'let activeCharacterLeaseId = "";',
    'const serverSession = { token: "token-a", login: "tester" };',
    'const characterProfile = { name: "Tester", special: {}, lastVisitedSettlementId: "settlement" };',
    'const selectedCharacterCalls = [];',
    'const localStorage = { setItem() {} };',
    'const SERVER_CHARACTER_KEY = "character-key";',
    'const currentLocation = { id: "settlement", name: "Settlement", pvpMode: "peaceful" };',
    'const globalMapState = {};',
    'const player = { x: 1, z: 2, angle: 0, crouching: false, hp: 10, maxHp: 10, ap: 6, maxAp: 6, level: 1 };',
    'const DEFAULT_SPECIAL = {};',
    'function makeSocket(id) {',
    '  return {',
    '    id, connected: true, active: true, emitted: [], disconnects: 0, connects: 0,',
    '    emit(eventName, payload, ack) { this.emitted.push({ eventName, payload, ack }); },',
    '    disconnect() { this.disconnects += 1; },',
    '    connect() { this.connects += 1; }',
    '  };',
    '}',
    'const initialSocket = makeSocket("socket-a");',
    'const multiplayer = {',
    '  socket: initialSocket, socketGeneration: 7, joinAttemptId: 0, joinInFlight: false,',
    '  joinPromise: null, joinAttemptResolve: null, joinSocketId: "", joinSessionToken: "",',
    '  joinCharacterId: "", joinClientInstanceId: "", joinTimer: null, transportState: "connected",',
    '  joined: false, joinedSocketId: "", joinedSessionToken: "", joinedCharacterId: "",',
    '  joinedClientInstanceId: "", characterLeaseId: "", roomId: "", pendingEntryKey: "",',
    '  onlineSessionRequired: true, serverAuthoritativeEnemies: false',
    '};',
    'function getDeviceId() { return "device-a"; }',
    'function getClientInstanceId() { return "tab-a"; }',
    'function getDeviceType() { return "desktop"; }',
    'function getDeviceControlType() { return "keyboard"; }',
    'function setSelectedServerCharacterForSaveContext(value, options) {',
    '  selectedServerCharacterId = String(value || "");',
    '  selectedCharacterCalls.push({ value: selectedServerCharacterId, options });',
    '  return selectedServerCharacterId;',
    '}',
    'function multiplayerCombatSnapshot() { return {}; }',
    'function multiplayerCarrySnapshot() { return {}; }',
    'function multiplayerInventorySnapshot() { return []; }',
    'function multiplayerSkillSnapshot() { return {}; }',
    'function multiplayerTalentSnapshot() { return {}; }',
    'function multiplayerTraitSnapshot() { return []; }',
    'function multiplayerTaggedSkillsSnapshot() { return []; }',
    'function multiplayerWeaponId() { return "fists"; }',
    'function multiplayerEquipmentSnapshot() { return {}; }',
    'function multiplayerInjurySnapshot() { return {}; }',
    'function rememberCurrentSettlementLocation() { return "settlement"; }',
    'function setClientAuthorityMode(mode, reason) { authorityCalls.push({ mode, reason }); multiplayer.authorityMode = mode; }',
    'function resolveMultiplayerJoinWaiters(ok) { waiterResults.push(!!ok); }',
    'function resetNetworkPingMeasurement() {}',
    'let appliedStates = 0;',
    'function applyServerAuthoritativePlayerState() { appliedStates += 1; }',
    'function resetNetworkSnapshotStamps() {}',
    'function markStartupNetworkEvent() {}',
    'function clearNetworkRoomEntities() {}',
    'function upsertRemotePlayer() {}',
    'function initWorldSyncFromServer() {}',
    'function setOnlineStatus(value) { statusLines.push(value); }',
    'function setReadout(value) { statusLines.push(value); }',
    'function addLog() {}',
    'function setTimeout(callback, ms) { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer; }',
    'function clearTimeout(timer) { if (timer) timer.cleared = true; }',
    functionSource(core, 'currentMultiplayerJoinContext'),
    functionSource(core, 'multiplayerJoinContextIsCurrent'),
    functionSource(core, 'remapMultiplayerPendingJoinContext'),
    functionSource(core, 'multiplayerJoinAttemptMatchesCurrent'),
    functionSource(core, 'multiplayerJoinedContextMatchesCurrent'),
    functionSource(core, 'clearMultiplayerJoinedContext'),
    functionSource(socketRoom, 'multiplayerSocketGenerationMatches'),
    functionSource(socketRoom, 'cancelMultiplayerJoinAttempt'),
    functionSource(socketRoom, 'joinMultiplayerRoom'),
    'return {',
    '  multiplayer, initialSocket, timers, authorityCalls, waiterResults, statusLines, selectedCharacterCalls,',
    '  join: joinMultiplayerRoom, appliedStates: () => appliedStates, selectedCharacter: () => selectedServerCharacterId,',
    '  fireTimer: (timer, includeCleared = false) => { if (timer && (includeCleared || !timer.cleared)) timer.callback(); },',
    '  rotate: () => {',
    '    cancelMultiplayerJoinAttempt("test-rotate");',
    '    multiplayer.socketGeneration += 1;',
    '    const next = makeSocket("socket-b");',
    '    multiplayer.socket = next;',
    '    clearMultiplayerJoinedContext();',
    '    return next;',
    '  }',
    '};'
  ].join('\n'))();
}

async function assertJoinAndCorrectionContracts() {
  const waitRuntime = new Function([
    'const serverSession = { token: "token-a" };',
    'let selectedServerCharacterId = "char-a";',
    'let activeCharacterLeaseId = "lease-a";',
    'function getClientInstanceId() { return "tab-a"; }',
    'const multiplayer = {',
    '  joined: true, roomId: "", joinedSocketId: "socket-global",',
    '  joinedSessionToken: "token-a", joinedCharacterId: "char-a",',
    '  joinedClientInstanceId: "tab-a", characterLeaseId: "lease-a",',
    '  socket: { connected: true, id: "socket-global" }, joinWaiters: []',
    '};',
    functionSource(core, 'currentMultiplayerJoinContext'),
    functionSource(core, 'multiplayerJoinContextIsCurrent'),
    functionSource(core, 'remapMultiplayerPendingJoinContext'),
    functionSource(core, 'multiplayerJoinedContextMatchesCurrent'),
    functionSource(core, 'resolveMultiplayerJoinWaiters'),
    functionSource(core, 'waitForMultiplayerJoin'),
    'return {',
    '  multiplayer, waitForMultiplayerJoin, resolveMultiplayerJoinWaiters, remapMultiplayerPendingJoinContext,',
    '  setCharacter: value => { selectedServerCharacterId = value; },',
    '  bindCurrent: () => {',
    '    multiplayer.joined = true;',
    '    multiplayer.joinedSessionToken = serverSession.token;',
    '    multiplayer.joinedCharacterId = selectedServerCharacterId;',
    '    multiplayer.joinedClientInstanceId = getClientInstanceId();',
    '  }',
    '};'
  ].join('\n'))();
  assert.strictEqual(await waitRuntime.waitForMultiplayerJoin(5), true,
    'a joined global-map session with an empty roomId must satisfy the join wait');
  waitRuntime.multiplayer.joinedSocketId = 'socket-stale';
  const staleSocketWait = waitRuntime.waitForMultiplayerJoin(5000);
  waitRuntime.resolveMultiplayerJoinWaiters(false);
  assert.strictEqual(await staleSocketWait, false,
    'a stale joined socket must not satisfy the join wait');
  waitRuntime.multiplayer.joinedSocketId = 'socket-global';
  waitRuntime.multiplayer.joined = false;
  const characterAWait = waitRuntime.waitForMultiplayerJoin(5000);
  waitRuntime.setCharacter('char-b');
  waitRuntime.bindCurrent();
  waitRuntime.resolveMultiplayerJoinWaiters(true);
  assert.strictEqual(await characterAWait, false,
    'a waiter captured for character A must not resolve from character B join');
  waitRuntime.setCharacter('char-a');
  waitRuntime.multiplayer.joined = false;
  const remappedWait = waitRuntime.waitForMultiplayerJoin(5000);
  waitRuntime.remapMultiplayerPendingJoinContext({
    sessionToken: 'token-a',
    characterId: 'char-a',
    clientInstanceId: 'tab-a'
  }, 'char-remapped');
  waitRuntime.setCharacter('char-remapped');
  waitRuntime.bindCurrent();
  waitRuntime.resolveMultiplayerJoinWaiters(true);
  assert.strictEqual(await remappedWait, true,
    'a server-approved collision remap must atomically rebind the pending join waiter');

  const joinedRuntime = joinFsmRuntime();
  const firstJoin = joinedRuntime.join();
  const duplicateJoin = joinedRuntime.join();
  assert.strictEqual(firstJoin, duplicateJoin,
    'parallel join calls must share the exact same promise');
  assert.strictEqual(joinedRuntime.initialSocket.emitted.length, 1,
    'parallel join calls must emit one join request');
  joinedRuntime.initialSocket.emitted[0].ack({
    ok: true,
    roomId: '',
    characterLeaseId: 'lease-a',
    self: {},
    players: []
  });
  assert.strictEqual(await firstJoin, true);
  assert.strictEqual(joinedRuntime.multiplayer.joined, true);
  assert.strictEqual(joinedRuntime.multiplayer.joinedCharacterId, 'char-a');
  assert.strictEqual(joinedRuntime.multiplayer.characterLeaseId, 'lease-a');
  assert.strictEqual(joinedRuntime.appliedStates(), 1);

  const remappedRuntime = joinFsmRuntime();
  const remappedJoin = remappedRuntime.join();
  remappedRuntime.initialSocket.emitted[0].ack({
    ok: true,
    characterId: 'char-remapped',
    roomId: '',
    characterLeaseId: 'lease-remapped',
    self: { characterId: 'char-remapped' },
    players: []
  });
  assert.strictEqual(await remappedJoin, true);
  assert.strictEqual(remappedRuntime.selectedCharacter(), 'char-remapped');
  assert.strictEqual(remappedRuntime.multiplayer.joinedCharacterId, 'char-remapped');
  assert.strictEqual(remappedRuntime.multiplayer.characterLeaseId, 'lease-remapped');
  assert.strictEqual(remappedRuntime.selectedCharacterCalls.at(-1)?.options?.preserveMultiplayerJoin, true,
    'an accepted server remap must not invalidate its own in-flight socket');

  const inconsistentRuntime = joinFsmRuntime();
  const inconsistentJoin = inconsistentRuntime.join();
  inconsistentRuntime.initialSocket.emitted[0].ack({
    ok: true,
    characterId: 'char-remapped-a',
    roomId: '',
    characterLeaseId: 'lease-bad',
    self: { characterId: 'char-remapped-b' },
    players: []
  });
  assert.strictEqual(await inconsistentJoin, false);
  assert.strictEqual(inconsistentRuntime.multiplayer.joined, false);
  assert.strictEqual(inconsistentRuntime.selectedCharacter(), 'char-a',
    'an inconsistent remap ACK must not alter the selected character');
  assert.strictEqual(inconsistentRuntime.initialSocket.disconnects, 1);

  const staleRuntime = joinFsmRuntime();
  const staleJoin = staleRuntime.join();
  const oldTimer = staleRuntime.timers[0];
  const oldAck = staleRuntime.initialSocket.emitted[0].ack;
  const replacementSocket = staleRuntime.rotate();
  oldAck({ ok: true, roomId: 'old-room', characterLeaseId: 'old-lease', self: {}, players: [] });
  assert.strictEqual(await staleJoin, false);
  staleRuntime.fireTimer(oldTimer, true);
  assert.strictEqual(staleRuntime.multiplayer.socket, replacementSocket);
  assert.strictEqual(replacementSocket.disconnects, 0,
    'a stale timeout must not disconnect the replacement socket');
  assert.strictEqual(staleRuntime.multiplayer.joined, false);
  assert.strictEqual(staleRuntime.appliedStates(), 0,
    'a stale join callback must not apply player state');

  const timeoutRuntime = joinFsmRuntime();
  const timedOutJoin = timeoutRuntime.join();
  timeoutRuntime.fireTimer(timeoutRuntime.timers[0]);
  assert.strictEqual(await timedOutJoin, false);
  assert.strictEqual(timeoutRuntime.initialSocket.disconnects, 1);
  assert.strictEqual(timeoutRuntime.initialSocket.connects, 1,
    'a current join timeout must perform one controlled reconnect');
  assert(timeoutRuntime.authorityCalls.some(call => call.mode === 'blocked' && call.reason === 'join-timeout'));

  const joinBody = functionBody(socketRoom, 'joinMultiplayerRoom');
  assertContainsAll('join single-flight contract', joinBody, [
    'multiplayerJoinedContextMatchesCurrent(socket)',
    'multiplayer.joinInFlight',
    'multiplayerJoinAttemptMatchesCurrent(socket)',
    'return multiplayer.joinPromise',
    'multiplayerSocketGenerationMatches(socket, socketGeneration)',
    '!multiplayerJoinContextIsCurrent(joinContext)',
    'remapMultiplayerPendingJoinContext(joinContext, ackCharacterId)',
    '{ preserveMultiplayerJoin: true }',
    "setClientAuthorityMode('blocked', 'join-timeout'",
    "setClientAuthorityMode('server', ack.alreadyJoined ? 'join-idempotent' : 'join-accepted')"
  ]);

  const applyStateBody = functionBody(socketRoom, 'applyServerAuthoritativePlayerState');
  assertContainsAll('authoritative position policy', applyStateBody, [
    "const positionMode = String(options.positionMode || '')",
    "positionMode === 'transition' || positionMode === 'correction'",
    'applyServerLocalPositionAck(snapshot)'
  ]);
  assert.strictEqual((applyStateBody.match(/applyServerLocalPositionAck\(snapshot\)/g) || []).length, 1,
    'ordinary authoritative acknowledgements must not contain another unconditional position snap');
  assertContainsAll('movement correction event', socketRoom, [
    "const positionMode = reason === 'movementCorrection' ? 'correction' : 'preserve'",
    "applyServerAuthoritativePlayerState(data || {}, { positionMode })",
    "{ positionMode: 'transition' }"
  ]);
  const positionRuntime = new Function([
    'const player = { x: 4, y: 0, z: 7, hp: 10, targetPath: [{ x: 8 }], attackTarget: { id: "enemy" } };',
    'const marker = { visible: true };',
    'const playerGroup = { position: { set(x, y, z) { playerGroup.last = { x, y, z }; } } };',
    'const multiplayer = {};',
    'let characterProfile = null;',
    functionSource(socketRoom, 'applyServerLocalPositionAck'),
    functionSource(socketRoom, 'applyServerAuthoritativePlayerState'),
    'return { player, marker, playerGroup, multiplayer, applyServerAuthoritativePlayerState };'
  ].join('\n'))();
  positionRuntime.applyServerAuthoritativePlayerState({ x: 40, z: 70, hp: 9 });
  assert.deepStrictEqual(
    { x: positionRuntime.player.x, z: positionRuntime.player.z },
    { x: 4, z: 7 },
    'an ordinary self ACK must preserve the locally predicted position'
  );
  assert.deepStrictEqual(positionRuntime.player.targetPath, [{ x: 8 }],
    'an ordinary self ACK must preserve the active path');
  assert.strictEqual(positionRuntime.player.attackTarget?.id, 'enemy');
  assert.strictEqual(positionRuntime.marker.visible, true);
  assert.strictEqual(positionRuntime.player.hp, 9,
    'preserving position must not suppress other authoritative player fields');

  positionRuntime.applyServerAuthoritativePlayerState(
    { x: 40, z: 70 },
    { positionMode: 'correction' }
  );
  assert.deepStrictEqual(
    { x: positionRuntime.player.x, z: positionRuntime.player.z },
    { x: 40, z: 70 },
    'an explicit correction must snap to the authoritative position'
  );
  assert.deepStrictEqual(positionRuntime.player.targetPath, []);
  assert.strictEqual(positionRuntime.player.attackTarget, null);
  assert.strictEqual(positionRuntime.marker.visible, false);
  assert.deepStrictEqual(positionRuntime.playerGroup.last, { x: 40, y: 0, z: 70 });

  const serverJoin = socketEventSource(server, 'join');
  assertContainsAll('same-socket idempotent join', serverJoin, [
    'const joinedPlayer = players.get(socket.id)',
    'sameJoinedIdentity',
    'currentJoinedSocketAck(joinedPlayer, { alreadyJoined: true })',
    'Этот сокет уже присоединён к другому персонажу или игровой сессии.'
  ]);
}

function inputRuntime() {
  return new Function([
    'const keys = { KeyW: true, KeyA: true, Space: true };',
    'let mouseFireHeld = true;',
    'let touchFireHeld = true;',
    'let touchAimFireHeld = true;',
    'let touchFireTimer = 4;',
    'const virtualMove = { active: true };',
    'let autoFireStops = 0;',
    'let touchAimStops = 0;',
    'let virtualMoveResets = 0;',
    'let radialCancels = 0;',
    'let globalMapKeyClears = 0;',
    'const GLOBAL_MAP_3D = { keyPan: { KeyW: true }, dragging: true, dragX: 12, dragY: 9 };',
    'const idleReasons = [];',
    'const buttons = [{ active: true, classList: { remove(name) { if (name === "active") buttons[0].active = false; } } }];',
    'const document = { querySelectorAll() { return buttons; } };',
    'let quickUseRadialState = { open: true };',
    'const player = { targetPath: [{ x: 1 }], attackTarget: { id: "enemy" } };',
    'const marker = { visible: true };',
    'const multiplayer = { socket: { connected: true }, joined: true };',
    'function stopAutoFire() { autoFireStops += 1; mouseFireHeld = false; }',
    'function stopTouchAim() { touchAimStops += 1; }',
    'function resetVirtualMove() { virtualMoveResets += 1; virtualMove.active = false; }',
    'function cancelQuickUseRadial() { radialCancels += 1; quickUseRadialState = null; }',
    'function clearGlobalMapCameraKeys() { globalMapKeyClears += 1; GLOBAL_MAP_3D.keyPan = {}; }',
    'function sendImmediateMultiplayerState(reason) { idleReasons.push(reason); }',
    functionSource(input, 'clearAllGameplayInput'),
    'return {',
    '  run: clearAllGameplayInput, keys, player, marker, buttons, virtualMove, idleReasons, GLOBAL_MAP_3D,',
    '  state: () => ({ mouseFireHeld, touchFireHeld, touchAimFireHeld, touchFireTimer,',
    '    autoFireStops, touchAimStops, virtualMoveResets, radialCancels, globalMapKeyClears, quickUseRadialState })',
    '};'
  ].join('\n'))();
}

function assertInputLifecycle() {
  const runtime = inputRuntime();
  runtime.run('blur');
  assert(Object.values(runtime.keys).every(value => value === false),
    'lifecycle reset must release every keyboard key');
  assert.deepStrictEqual(runtime.state(), {
    mouseFireHeld: false,
    touchFireHeld: false,
    touchAimFireHeld: false,
    touchFireTimer: 0,
    autoFireStops: 1,
    touchAimStops: 1,
    virtualMoveResets: 1,
    radialCancels: 1,
    globalMapKeyClears: 1,
    quickUseRadialState: null
  });
  assert.strictEqual(runtime.virtualMove.active, false);
  assert.deepStrictEqual(runtime.player.targetPath, []);
  assert.strictEqual(runtime.player.attackTarget, null);
  assert.strictEqual(runtime.marker.visible, false);
  assert.strictEqual(runtime.buttons[0].active, false);
  assert.deepStrictEqual(runtime.GLOBAL_MAP_3D.keyPan, {});
  assert.strictEqual(runtime.GLOBAL_MAP_3D.dragging, false);
  assert.strictEqual(runtime.GLOBAL_MAP_3D.dragX, 0);
  assert.strictEqual(runtime.GLOBAL_MAP_3D.dragY, 0);
  assert.deepStrictEqual(runtime.idleReasons, ['idle'],
    'a connected lifecycle reset must immediately publish neutral input');

  runtime.run('disconnect', { sendIdle: false });
  assert.deepStrictEqual(runtime.idleReasons, ['idle'],
    'authority cleanup must be able to suppress an idle packet on a dead transport');

  assert(
    /window\.addEventListener\(['"]blur['"],\s*\(\)\s*=>\s*clearAllGameplayInput\(['"]blur['"]\)\)/.test(input),
    'window blur is not wired to the complete gameplay-input reset'
  );
  assert(
    /window\.addEventListener\(['"]pagehide['"],\s*\(\)\s*=>\s*clearAllGameplayInput\(['"]pagehide['"]\)\)/.test(input),
    'pagehide is not wired to the complete gameplay-input reset'
  );
  const visibilityBody = hudLoop.slice(
    hudLoop.indexOf("document.addEventListener('visibilitychange'"),
    hudLoop.indexOf("document.addEventListener('visibilitychange'") + 700
  );
  assertContainsAll('visibility lifecycle reset', visibilityBody, [
    'document.hidden',
    "clearAllGameplayInput('visibility-hidden')"
  ]);
}

function harvestRuntime() {
  const finishHarvest = arrowDeclarationSource(resources, 'const finishHarvest =');
  return new Function([
    'let player = { ap: 10 };',
    'const tool = { condition: 90, icon: "tool" };',
    'const itemId = "ore";',
    'const pos = { x: 2, z: 3 };',
    'let res = { id: "resource" };',
    'const ITEMS = { ore: { name: "Руда", icon: "ore" } };',
    'const HARVEST_AP_COST = 2;',
    'const calls = { snapshot: 0, inventory: 0, add: 0, xp: 0, saves: 0 };',
    'function applyServerAuthoritativePlayerState(self) {',
    '  calls.snapshot += 1;',
    '  if (Number.isFinite(Number(self.toolCondition))) tool.condition = Number(self.toolCondition);',
    '  if (Number.isFinite(Number(self.ap))) player.ap = Number(self.ap);',
    '}',
    'function applyServerInventorySnapshot() { calls.inventory += 1; }',
    'function addItem() { calls.add += 1; return true; }',
    'function createFloatingText() {}',
    'function addLog() {}',
    'function harvestActionXp(qty) { return 3 + qty; }',
    'function awardCharacterActionXp() { calls.xp += 1; }',
    'function applyServerResourceSnapshot(current) { return current; }',
    'function renderInventoryIfVisibleDeferred() {}',
    'function renderWeaponReadout() {}',
    'function queueSave() { calls.saves += 1; }',
    finishHarvest,
    'return { finishHarvest, tool, calls, player };'
  ].join('\n'))();
}

function assertHarvestIntegrity() {
  const authoritative = harvestRuntime();
  assert.strictEqual(authoritative.finishHarvest(2, {
    self: { toolCondition: 74, ap: 7 },
    item: { id: 'ore', qty: 2 },
    xp: 5,
    apCost: 2
  }), true);
  assert.strictEqual(authoritative.tool.condition, 74,
    'a server-confirmed harvest must not apply client tool wear after its self snapshot');
  assert.strictEqual(authoritative.player.ap, 7,
    'a server-confirmed harvest must keep authoritative AP');
  assert.strictEqual(authoritative.calls.add, 0,
    'a server-confirmed harvest must not add the item locally a second time');
  assert.strictEqual(authoritative.calls.xp, 0,
    'a server-confirmed harvest must not grant local XP a second time');

  const offline = harvestRuntime();
  assert.strictEqual(offline.finishHarvest(2), true);
  assert.strictEqual(offline.tool.condition, 88.5,
    'offline-local harvest must still apply one local tool-wear step');
  assert.strictEqual(offline.player.ap, 8,
    'offline-local harvest must still spend AP locally');
  assert.strictEqual(offline.calls.add, 1);
  assert.strictEqual(offline.calls.xp, 1);

  const serverHarvest = socketEventSource(server, 'harvestResource');
  assertContainsAll('server harvest condition contract', serverHarvest, [
    "const equippedToolId = serverBaseItemId(p.equipment?.weapon || '')",
    'if (equippedToolId !== expectedTool)',
    'serverPlayerItemCondition(p, expectedTool)',
    'condition > 40',
    'serverWearPlayerItem(p, expectedTool, 1.5)',
    'self: publicAuthoritativePlayerState(p)'
  ]);
}

function assertInputDeadman() {
  const expireInput = new Function(
    'LEGACY_INPUT_DEADMAN_MS',
    `${functionSource(server, 'expireLegacyPlayerInput')}\nreturn expireLegacyPlayerInput;`
  )(1250);
  const now = 5000;
  const fresh = {
    input: { forward: 1, right: -0.5 },
    lastLegacyInputAt: now - 1000,
    moving: true,
    turning: true,
    vx: 4,
    vz: -2
  };
  assert.strictEqual(expireInput(fresh, now), false,
    'fresh legacy input must not be expired');
  assert.deepStrictEqual(fresh.input, { forward: 1, right: -0.5 });

  const stale = {
    input: { forward: 1, right: -0.5 },
    lastLegacyInputAt: now - 2000,
    moving: true,
    turning: true,
    vx: 4,
    vz: -2
  };
  assert.strictEqual(expireInput(stale, now), true,
    'stale held input must trigger the server dead-man switch');
  assert.deepStrictEqual(stale, {
    input: { forward: 0, right: 0 },
    lastLegacyInputAt: now - 2000,
    moving: false,
    turning: false,
    vx: 0,
    vz: 0
  });

  const idle = {
    input: { forward: 0, right: 0 },
    lastLegacyInputAt: 0,
    moving: false,
    turning: false,
    vx: 0,
    vz: 0
  };
  assert.strictEqual(expireInput(idle, now), false,
    'already neutral input must not report a dead-man transition');
  assertContainsAll('server dead-man wiring', server, [
    'const LEGACY_INPUT_DEADMAN_MS',
    'p.lastLegacyInputAt = p.lastInputAt',
    'expireLegacyPlayerInput(p, playerTickNow)'
  ]);
}

function assertGlobalMapMotionIntegrity() {
  const motionRuntime = new Function([
    'let now = 100;',
    'const performance = { now: () => now };',
    'const GLOBAL_MAP_POINT_KM = 1 / 3;',
    'const GLOBAL_MAP_WORLD_DAY_REAL_MS = 60000;',
    'const WASTELAND_SIM_MAX_EXTRAPOLATION_MS = 7500;',
    'let wastelandSimLastAppliedAt = 0;',
    'let WASTELAND_SIM_STATE = { gameDayRealMs: 60000, sampledAt: 0, serverNow: 0, sampleAgeMs: 0 };',
    'function clampGlobalMapPoint(x, y) {',
    '  const point = x && typeof x === "object" ? x : { x, y };',
    '  return { x: Number(point?.x || 0), y: Number(point?.y || 0) };',
    '}',
    'function globalMapPointDistance(left, right) {',
    '  return Math.hypot(Number(left?.x || 0) - Number(right?.x || 0), Number(left?.y || 0) - Number(right?.y || 0));',
    '}',
    'function globalMapWorldPartyDestroyed() { return false; }',
    'function globalMapWorldPartyDestinationPoint() { return { x: 140, y: 140 }; }',
    functionSource(globalMapState, 'globalMapRouteDistance'),
    functionSource(globalMapState, 'globalMapPointAtRouteProgress'),
    functionSource(globalMapState, 'globalMapWastelandSnapshotIsStale'),
    functionSource(globalMapState, 'globalMapWastelandMotionClock'),
    functionSource(globalMapWorldStatus, 'globalMapEstimatedWorldHoursSinceSimUpdate'),
    functionSource(globalMapWorldStatus, 'globalMapWorldPartyMotionRoute'),
    functionSource(globalMapWorldStatus, 'globalMapWorldPartyDisplayPoint'),
    'function apply(sim) {',
    '  if (globalMapWastelandSnapshotIsStale(WASTELAND_SIM_STATE, sim)) return false;',
    '  const clock = globalMapWastelandMotionClock(WASTELAND_SIM_STATE, sim, wastelandSimLastAppliedAt, performance.now());',
    '  wastelandSimLastAppliedAt = clock.appliedAt;',
    '  WASTELAND_SIM_STATE = { ...WASTELAND_SIM_STATE, ...sim, ...clock };',
    '  return true;',
    '}',
    'return {',
    '  setNow: value => { now = Number(value || 0); },',
    '  apply,',
    '  display: party => globalMapWorldPartyDisplayPoint(party),',
    '  clock: () => ({ ...WASTELAND_SIM_STATE, appliedAt: wastelandSimLastAppliedAt })',
    '};'
  ].join('\n'))();
  const movingParty = {
    x: 100,
    y: 100,
    speedKmh: 1,
    state: 'moving',
    movementRoutePoints: [
      { x: 100, y: 100 },
      { x: 106, y: 100 },
      { x: 106, y: 110 }
    ]
  };

  assert.strictEqual(motionRuntime.apply({ gameDayRealMs: 60000 }), true,
    'an initial legacy wasteland snapshot without motion clocks was rejected');
  motionRuntime.setNow(4000);
  assert.deepStrictEqual(motionRuntime.display(movingParty), { x: 100, y: 100 },
    'pure legacy wasteland mode still extrapolates and resets its marker');
  motionRuntime.setNow(4100);
  assert.strictEqual(
    motionRuntime.apply({ sampledAt: 1000, serverNow: 1000, gameDayRealMs: 60000 }),
    true,
    'a fresh wasteland snapshot was rejected'
  );
  assert.deepStrictEqual(motionRuntime.display(movingParty), { x: 100, y: 100 },
    'a fresh world-party sample must start at its authoritative point');
  motionRuntime.setNow(9100);
  assert.deepStrictEqual(motionRuntime.display(movingParty), { x: 106, y: 100 },
    'attached world-party motion does not reach the authoritative waypoint smoothly');
  assert.strictEqual(
    motionRuntime.apply({ sampledAt: 1000, serverNow: 6000, gameDayRealMs: 60000 }),
    true,
    'a newer read of the same wasteland sample was rejected'
  );
  assert.deepStrictEqual(motionRuntime.display(movingParty), { x: 106, y: 100 },
    'a duplicate wasteland snapshot rewound attached world-party motion');
  const acceptedClock = motionRuntime.clock();
  assert.strictEqual(motionRuntime.apply({ sampledAt: 900, serverNow: 7000, gameDayRealMs: 60000 }), false,
    'an out-of-order wasteland snapshot was accepted');
  assert.deepStrictEqual(motionRuntime.clock(), acceptedClock,
    'rejecting an out-of-order wasteland snapshot still mutated its motion clock');
  assert.strictEqual(motionRuntime.apply({ sampledAt: 1000, serverNow: 5000, gameDayRealMs: 60000 }), false,
    'an older server read of the same wasteland sample was accepted');
  assert.deepStrictEqual(motionRuntime.clock(), acceptedClock,
    'rejecting an older server read still rewound its motion clock');
  motionRuntime.setNow(11100);
  const afterTurn = motionRuntime.display(movingParty);
  assert(Math.abs(afterTurn.x - 106) < 0.0001 && Math.abs(afterTurn.y - 102.4) < 0.0001,
    'attached world-party motion cut across an authoritative route turn');
  assert.deepStrictEqual(motionRuntime.display({
    ...movingParty,
    movementRoutePoints: [{ x: 100, y: 100 }]
  }), { x: 100, y: 100 }, 'an explicit stopped world-party route extrapolated toward a legacy destination');
  const modernClock = motionRuntime.clock();
  assert.strictEqual(motionRuntime.apply({ gameDayRealMs: 60000 }), false,
    'a legacy wasteland snapshot downgraded an established timestamped stream');
  assert.deepStrictEqual(motionRuntime.clock(), modernClock,
    'rejecting a legacy schema downgrade still mutated the motion clock');
  motionRuntime.setNow(12000);
  assert.deepStrictEqual(motionRuntime.display(movingParty), { x: 106, y: 103 },
    'a rejected legacy schema downgrade still rolled the marker back');

  const playerPointRuntime = new Function([
    'const globalMapState = { playerX: 0, playerY: 0, selectedX: 0, selectedY: 0 };',
    'const attached = { x: 10, y: 20 };',
    'function globalMapAttachedParty() { return attached; }',
    'function globalMapWorldPartyDisplayPoint() { return { x: 11, y: 22 }; }',
    'function clampGlobalMapPoint(x, y) { return { x: Number(x || 0), y: Number(y || 0) }; }',
    functionSource(globalMapState, 'globalMapPlayerPoint'),
    'return { point: globalMapPlayerPoint(), state: globalMapState };'
  ].join('\n'))();
  assert.deepStrictEqual(playerPointRuntime.point, { x: 11, y: 22 },
    'attached player marker still uses raw world-party coordinates');
  assert.strictEqual(playerPointRuntime.state.playerX, 11,
    'attached display point was not retained as the player world point');

  const progressRuntime = new Function([
    functionSource(globalMapState, 'globalMapClamp01'),
    functionSource(globalMapState, 'globalMapSafeNumber'),
    functionSource(globalMapState, 'globalMapServerTravelProgress'),
    'return globalMapServerTravelProgress;'
  ].join('\n'))();
  assert.strictEqual(progressRuntime({
    durationMs: 2000,
    elapsedMs: 200,
    serverNow: 900000,
    startedAt: 100
  }, 2, 200, 0), 0.15, 'travel ACK progress ignored authoritative elapsed time plus half-RTT');
  assert.strictEqual(progressRuntime({ durationMs: 2000, elapsedMs: 200 }, 2, 0, 0.25), 0.25,
    'travel ACK progress rewound optimistic client movement');

  const startTravelBody = functionBody(globalMapTravel, 'startGlobalTravel');
  const followerTravelBody = functionBody(globalMapTravel, 'handleGlobalTravelStarted');
  assertContainsAll('global travel timing handshake', startTravelBody, [
    'const requestStartedAt = performance.now()',
    'globalMapServerTravelProgress(',
    'optimisticProgress'
  ]);
  assert(!startTravelBody.includes('Date.now() - Number(ack.startedAt'),
    'leader travel ACK still depends on browser/server wall-clock equality');
  assert(followerTravelBody.includes('globalMapServerTravelProgress(data, duration)')
    && !followerTravelBody.includes('Date.now() - Number(data.startedAt'),
  'follower travel start still depends on browser/server wall-clock equality');
  assert(functionBody(globalMapPanel, 'renderGlobalMapRuntimeFrame')
    .includes('globalMapState.attachedPartyId'),
  'attached world-party movement does not keep active snapshot polling');
  assert(functionBody(server, 'serverAuthoritativeGlobalMapState')
    .includes('travel: serverGlobalTravelPublicDescriptor(session, serverNow)'),
  'authoritative player snapshots can still erase an active global travel session');
}

function assertBlockedGameplayGates() {
  const updateBody = functionBody(updateLoop, 'update');
  const blockedIndex = updateBody.indexOf('clientGameplayIsBlocked()');
  assert(blockedIndex >= 0, 'the main update loop does not recognize blocked authority');
  assert(blockedIndex < updateBody.indexOf('sendMultiplayerState(dt)'),
    'blocked authority is checked only after normal network/world updates');
  assertContainsAll('blocked update loop', updateBody.slice(blockedIndex, blockedIndex + 1100), [
    'clearAllGameplayInput',
    'updateRemotePlayers',
    'return'
  ]);

  for (const [source, name] of [
    [interaction, 'performUniversalInteract'],
    [explosions, 'applyExplosionDamage'],
    [combat, 'applyWeaponDamage'],
    [combat, 'shootAtPoint'],
    [combat, 'tryAttack'],
    [combat, 'reloadWeapon'],
    [containers, 'openWorldContainerWindow'],
    [containers, 'takeWorldContainerItem'],
    [containers, 'takeAllWorldContainerLoot'],
    [quests, 'robEncounterActor'],
    [loot, 'openLootWindow'],
    [loot, 'takeLootItem'],
    [loot, 'takeAllLoot'],
    [globalMapPanel, 'openGlobalMapFromLocationExit'],
    [globalMapWorldStatus, 'openGlobalMapWorldPartyEncounter'],
    [globalMapTravel, 'startGlobalTravel'],
    [globalMapTravel, 'cancelGlobalTravel'],
    [globalMapTravel, 'selectGlobalMapDestination'],
    [globalMapTravel, 'resolveGlobalEncounter'],
    [globalMapTravel, 'enterGlobalLocalLocation'],
    [globalMapEntry, 'enterCurrentGlobalSettlement']
  ]) {
    const body = functionBody(source, name);
    assert(
      body.indexOf('rejectBlockedGameplayAction') >= 0
        && body.indexOf('rejectBlockedGameplayAction') < 220,
      `${name} does not fail closed before mutating gameplay state`
    );
  }
  assertContainsAll('world-party detach blocked gate', functionBody(globalMapState, 'detachGlobalMapWorldParty'), [
    'options.skipServerCancel',
    'rejectBlockedGameplayAction'
  ]);
  assertContainsAll('resource authority gate', functionBody(resources, 'interactResource'), [
    'clientGameplayIsBlocked()',
    'resourcesAreServerAuthoritative()'
  ]);
  for (const name of ['ensureCorpseLoot', 'removeCorpse', 'killEnemy']) {
    assertContainsAll(`${name} local fallback gate`, functionBody(resources, name), [
      'clientEnemyStateMayUseLocalFallback'
    ]);
  }
  assertContainsAll('local enemy fallback gate', updateLoop, [
    'clientEnemyStateMayUseLocalFallback()',
    "if (typeof clientEnemyStateMayUseLocalFallback === 'function' && !clientEnemyStateMayUseLocalFallback()) return"
  ]);
}

async function main() {
  assertAuthorityModes();
  assertAuthorityTransitionCleanup();
  assertGameplayAckGuards();
  await assertJoinAndCorrectionContracts();
  assertInputLifecycle();
  assertHarvestIntegrity();
  assertInputDeadman();
  assertGlobalMapMotionIntegrity();
  assertBlockedGameplayGates();
  console.log('Client-state integrity checks passed: authority, guarded gameplay ACKs, join/reconnect, global-map motion, input lifecycle, harvest and dead-man switch.');
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
