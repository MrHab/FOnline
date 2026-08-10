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

function statementSource(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing statement ${marker}`);
  const end = source.indexOf(';\n', start);
  assert(end > start, `Cannot extract statement ${marker}`);
  return source.slice(start, end + 1);
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
const actorVisuals = read('public/js/game/04_player_model_visuals.js');
const modernActorRuntime = read('public/js/game/04a_player_model_modern_runtime.js');
const remoteLocomotion = read('public/js/game/05b_remote_player_locomotion.js');
const socketRoom = read('public/js/game/05c_multiplayer_socket_room.js');
const enemyModels = read('public/js/game/05f_enemy_models_location_flow.js');
const explosions = read('public/js/game/06b_explosions_speech.js');
const combatModes = read('public/js/game/06c_combat_stats_modes.js');
const combat = read('public/js/game/06d_combat_damage_shooting.js');
const resources = read('public/js/game/06e_combat_targeting_loot_resources.js');
const containers = read('public/js/game/05d_world_containers_security.js');
const worldSync = read('public/js/game/05e_ground_items_world_sync.js');
const quests = read('public/js/game/07c_trader_dialogues_quests.js');
const loot = read('public/js/game/07e_loot_interaction.js');
const input = read('public/js/game/08f_input_events_proximity.js');
const interaction = read('public/js/game/08b_interaction_quick_access.js');
const worldContextTargets = read('public/js/game/08d_world_context_targets.js');
const mobilePanels = read('public/js/game/08a_mobile_controls_panels.js');
const mobileControls = read('public/js/game/08c_hud_edit_windows_touch.js');
const updateLoop = read('public/js/game/09_update_fog_movement_ai.js');
const globalMapState = read('public/js/game/10_global_map_state_logs_config.js');
const globalMapTerritories = read('public/js/game/11c_global_map_sites_territory.js');
const globalMapParties = read('public/js/game/11d_global_map_parties.js');
const globalMapWorldStatus = read('public/js/game/12a_global_map_world_status.js');
const globalMapPanel = read('public/js/game/12b_global_map_panel_window.js');
const globalMapTravel = read('public/js/game/12c_global_map_travel_encounters.js');
const globalMapEntry = read('public/js/game/12d_global_map_entry_ambush_controls.js');
const hudLoop = read('public/js/game/13_minimap_hud_loop.js');
const authBootstrap = read('public/js/game/01_bootstrap_online_save.js');
const worldMaterials = read('public/js/game/02a_materials_static_models.js');
const locationLoading = read('public/js/game/02c_map_locations_collision.js');
const playerVisuals = read('public/js/game/04_player_model_visuals.js');
const characterCreation = read('public/js/game/08_character_creation_save.js');
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
    'const player = { x: 4, y: 0, z: 7, hp: 10, attackTarget: { id: "enemy" } };',
    'const playerGroup = { position: { set(x, y, z) { playerGroup.last = { x, y, z }; } } };',
    'const multiplayer = {};',
    'let characterProfile = null;',
    functionSource(socketRoom, 'applyServerLocalPositionAck'),
    functionSource(socketRoom, 'applyServerAuthoritativePlayerState'),
    'return { player, playerGroup, multiplayer, applyServerAuthoritativePlayerState };'
  ].join('\n'))();
  positionRuntime.applyServerAuthoritativePlayerState({ x: 40, z: 70, hp: 9 });
  assert.deepStrictEqual(
    { x: positionRuntime.player.x, z: positionRuntime.player.z },
    { x: 4, z: 7 },
    'an ordinary self ACK must preserve the locally predicted position'
  );
  assert.strictEqual(positionRuntime.player.attackTarget?.id, 'enemy');
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
  assert.strictEqual(positionRuntime.player.attackTarget, null);
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
    'const player = { attackTarget: { id: "enemy" } };',
    'const multiplayer = { socket: { connected: true }, joined: true };',
    'function stopAutoFire() { autoFireStops += 1; mouseFireHeld = false; }',
    'function stopTouchAim() { touchAimStops += 1; }',
    'function resetVirtualMove() { virtualMoveResets += 1; virtualMove.active = false; }',
    'function cancelQuickUseRadial() { radialCancels += 1; quickUseRadialState = null; }',
    'function clearGlobalMapCameraKeys() { globalMapKeyClears += 1; GLOBAL_MAP_3D.keyPan = {}; }',
    'function sendImmediateMultiplayerState(reason) { idleReasons.push(reason); }',
    functionSource(input, 'clearAllGameplayInput'),
    'return {',
    '  run: clearAllGameplayInput, keys, player, buttons, virtualMove, idleReasons, GLOBAL_MAP_3D,',
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
  assert.strictEqual(runtime.player.attackTarget, null);
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

function assertMovementAccuracyIntent() {
  const runtime = new Function([
    'const keys = {};',
    'const virtualMove = { active: false, forward: 0, right: 0 };',
    functionSource(remoteLocomotion, 'hasLocalMovementIntent'),
    functionSource(combatModes, 'isPlayerMovingForAccuracy'),
    'return { keys, virtualMove, moving: isPlayerMovingForAccuracy };'
  ].join('\n'))();

  assert.strictEqual(runtime.moving(), false,
    'an idle player is treated as moving for accuracy');
  runtime.keys.KeyW = true;
  assert.strictEqual(runtime.moving(), true,
    'keyboard movement does not apply the movement accuracy penalty');
  runtime.keys.KeyW = false;
  runtime.virtualMove.active = true;
  runtime.virtualMove.forward = 0.8;
  assert.strictEqual(runtime.moving(), true,
    'mobile-stick movement does not apply the movement accuracy penalty');

  const preInputRuntime = new Function([
    functionSource(remoteLocomotion, 'hasLocalMovementIntent'),
    functionSource(combatModes, 'isPlayerMovingForAccuracy'),
    'return isPlayerMovingForAccuracy;'
  ].join('\n'))();
  assert.strictEqual(preInputRuntime(), false,
    'movement accuracy probing before input initialization must fail closed');
  assert(!functionBody(remoteLocomotion, 'hasLocalMovementIntent').includes('targetPath'),
    'movement intent still depends on removed click-to-move state');
  assert(functionBody(combatModes, 'isPlayerMovingForAccuracy').includes('hasLocalMovementIntent()'),
    'combat accuracy does not use live keyboard/mobile movement intent');
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
    'const equippedToolId = serverActiveWeaponId(p)',
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

function assertGlobalMapSnapshotPerformance() {
  assertContainsAll('wasteland snapshot pacing', globalMapState, [
    'const WASTELAND_SIM_ACTIVE_FETCH_MS = 5000',
    'const WASTELAND_SIM_IDLE_FETCH_MS = 15000',
    'wastelandSimLastFetchAt = performance.now()'
  ]);
  const visualSignature = functionBody(globalMapState, 'wastelandSimVisualSignatureFromState');
  const partyFieldsStart = visualSignature.indexOf('compactRows(state.parties');
  const partyFieldsEnd = visualSignature.indexOf('),', partyFieldsStart);
  const partyFields = visualSignature.slice(partyFieldsStart, partyFieldsEnd);
  assert(partyFieldsStart >= 0 && !partyFields.includes("'x'") && !partyFields.includes("'y'")
    && !partyFields.includes("'targetX'") && !partyFields.includes("'targetY'"),
    'party movement still invalidates all heavy global-map geometry');

  const partySignature = functionBody(globalMapParties, 'globalMapWorldParties3DSignature');
  assert(!partySignature.includes('row?.x') && !partySignature.includes('row?.y'),
    'party marker identity still includes continuously changing coordinates');

  const territorySignature = functionBody(globalMapTerritories, 'globalMapFactionTerritory3DSignature');
  assert(!territorySignature.includes('row.strength'),
    'territory geometry is still rebuilt for opacity-only strength changes');
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

function assertDeferredWorldRuntime() {
  const runtimeBody = functionBody(hudLoop, 'ensureWorldRuntimeReady');
  assertContainsAll('deferred world runtime bootstrap', runtimeBody, [
    'ensureWorldDataReady()',
    'ensureWorldMaterials()',
    'createPlayerModel()',
    'await preloadStaticWorldModels()',
    "document.body.dataset.worldRuntime = 'ready'"
  ]);

  const startupBody = functionBody(locationLoading, 'runGameStartupLoading');
  assert(
    startupBody.indexOf('await ensureWorldRuntimeReady()') >= 0
      && startupBody.indexOf('await ensureWorldRuntimeReady()') < startupBody.indexOf('await preloadLocationAssets('),
    'startup loading does not initialize the deferred world runtime before location assets'
  );
  assert(
    functionBody(authBootstrap, 'selectServerCharacter').includes('await ensureWorldDataReady()'),
    'existing characters can resolve their saved location before world data is ready'
  );
  const characterCreationBody = functionBody(characterCreation, 'createCharacterFromForm');
  const startupLoadingIndex = characterCreationBody.indexOf('await runGameStartupLoading(');
  assert(startupLoadingIndex >= 0, 'new character creation does not use the startup loading screen');
  assert(
    !characterCreationBody.slice(0, startupLoadingIndex).includes('await ensureWorldDataReady()'),
    'new character creation waits for world data before showing the startup loading screen'
  );

  assert(worldMaterials.includes('function createWorldMaterialSet()'),
    'world materials are not isolated behind a lazy factory');
  assert(worldMaterials.includes('function preloadStaticWorldModels()'),
    'static GLB preloading is not controlled by the world runtime bootstrap');
  assert(worldMaterials.includes('const stateKey = STATIC_MODEL_URLS[key] || key;'),
    'static model aliases do not share state by their resolved GLB URL');
  assert(worldMaterials.includes('state.pending.push({ holder, key, opts });')
    && worldMaterials.includes('applyStaticModel(entry.holder, entry.key || key, entry.opts || {});'),
  'shared GLB state does not retain each pending holder alias');
  assert(!worldMaterials.includes('Object.keys(STATIC_MODEL_URLS).forEach(requestStaticModel);'),
    'all static GLB models are still requested while the auth shell loads');
  assert(!worldMaterials.includes('registerDayNightTerrainMaterial(mats.'),
    'terrain registration still forces all world materials during auth bootstrap');
  assert(!playerVisuals.includes('\n  createPlayerModel();'),
    'the player model is still built before a character enters the world');

  const authShellTail = hudLoop.slice(hudLoop.lastIndexOf("addLog('Быстрые слоты:"));
  assert(authShellTail.includes('bootstrapProfile();'),
    'the lightweight auth profile bootstrap is missing');
  assert(!authShellTail.includes('buildWorld();') && !authShellTail.includes('loadWorldDataConfig();'),
    'the auth shell still builds or fetches world state before character selection');
}

function assertServerAuthoritativeWorldStateRequests() {
  const requestBody = functionBody(worldSync, 'requestWorldStateFromServer');
  assertContainsAll('authoritative world-state request', requestBody, [
    "socket.emit('requestWorldState'",
    'networkPayloadIsForCurrentRoom(ack.state)',
    'applyNetworkWorldState(ack.state'
  ]);
  assertContainsAll(
    'world-state init fallback',
    functionBody(worldSync, 'initWorldSyncFromServer'),
    ["requestWorldStateFromServer('serverInitFallback')"]
  );
  assert(!worldSync.includes("socket.emit('worldState'"),
    'the client still uploads worldState snapshots');
  assert(!worldSync.includes('function serializeWorldState'),
    'the client still serializes authoritative world state for upload');
  assert(!updateLoop.includes('maybeSyncWorldState'),
    'the update loop still schedules obsolete world-state uploads');
  assert(!server.includes("socket.on('worldState'"),
    'the production server still accepts client worldState uploads');
  assert(!server.includes('function sanitizeWorldState'),
    'the production server still keeps the obsolete client world-state sanitizer');

  const serverRequest = socketEventSource(server, 'requestWorldState');
  assertContainsAll('server world-state request contract', serverRequest, [
    "if (typeof ack !== 'function') return",
    'ensureRoomWorld(room)',
    'state: currentRoomWorldState(room)'
  ]);
  assert(!serverRequest.includes('data.state'),
    'requestWorldState still ingests a client-provided world snapshot');
  assert(!serverRequest.includes("socket.emit('worldState'"),
    'requestWorldState still has a non-ACK response path');
  assert(!serverRequest.includes('io.to('),
    'an addressable world-state resync still broadcasts to the whole room');
}

function assertServerNetworkHotPath() {
  const progressionProfileSource = functionSource(server, 'serverStateHasProgressionProfile');
  const hasProgressionProfile = new Function(
    `${progressionProfileSource}\nreturn serverStateHasProgressionProfile;`
  )();
  assert.strictEqual(hasProgressionProfile({
    seq: 7,
    x: 1,
    z: 2,
    vx: 0.5,
    vz: 0,
    angle: 0.25,
    moving: true,
    turning: false,
    crouching: false
  }), false, 'a compact movement packet still enters the progression hot path');
  assert.strictEqual(hasProgressionProfile({ profileOnly: true }), true,
    'an explicit profile-only packet no longer applies progression normalization');
  assert.strictEqual(hasProgressionProfile({ reason: 'startProfile' }), true,
    'a reliable movement-transition profile no longer applies progression normalization');
  assert.strictEqual(hasProgressionProfile({ skillRanks: {} }), true,
    'a skill profile no longer applies the authoritative progression budget');
  assert.strictEqual(hasProgressionProfile({ talentRanks: {} }), true,
    'a talent profile no longer applies the authoritative progression budget');

  const stateHandler = socketEventSource(server, 'state');
  assertContainsAll('state progression hot-path guard', stateHandler, [
    'const progressionChanged = serverStateHasProgressionProfile(data)',
    '? serverApplyProgressionRequest(p, data)',
    ": false;"
  ]);

  const movementPayload = statementSource(socketRoom, 'const movementPayload =');
  assertContainsAll('compact movement payload', movementPayload, [
    'seq:', 'x:', 'z:', 'vx:', 'vz:', 'angle:', 'moving:', 'turning:', 'crouching:'
  ]);
  for (const field of ['hp:', 'maxHp:', 'name:', 'deviceType:', 'controlType:', 'skillRanks:', 'talentRanks:']) {
    assert(!movementPayload.includes(field), `movement hot packet still carries ${field.slice(0, -1)}`);
  }
  const profilePayload = statementSource(socketRoom, 'const profilePayload =');
  assertContainsAll('profile packet compatibility', profilePayload, [
    'profileOnly: true',
    "? 'profile'",
    "? 'idleProfile' : 'startProfile'",
    'hp:', 'maxHp:', 'name:', 'deviceType:', 'controlType:', 'skillRanks:', 'talentRanks:'
  ]);
  assert(!profilePayload.includes('profileOnly: periodicProfileSync'),
    'a start/stop profile companion can still enter the movement branch');

  const writerSource = functionSource(server, 'writeJsonAtomic');
  const makeFs = failRename => {
    const files = new Map([['runtime.json', 'durable']]);
    return {
      files,
      api: {
        writeFileSync(file, contents, encoding) {
          assert.strictEqual(encoding, 'utf8');
          files.set(file, contents);
        },
        renameSync(source, target) {
          if (failRename) throw new Error('injected rename failure');
          files.set(target, files.get(source));
          files.delete(source);
        },
        existsSync: file => files.has(file),
        unlinkSync: file => files.delete(file)
      }
    };
  };
  const compactFs = makeFs(false);
  const compactWriter = new Function('fs', `${writerSource}\nreturn writeJsonAtomic;`)(compactFs.api);
  const runtimeState = { version: 2, characters: { player: { x: 1, z: 2 } } };
  compactWriter('runtime.json', runtimeState);
  assert.strictEqual(compactFs.files.get('runtime.json'), JSON.stringify(runtimeState),
    'runtime JSON persistence is not compact');
  assert(!compactFs.files.has('runtime.json.tmp'),
    'successful atomic persistence left its temp file behind');
  compactWriter('authored.json', runtimeState, { pretty: true });
  assert.strictEqual(compactFs.files.get('authored.json'), JSON.stringify(runtimeState, null, 2),
    'the explicit authored-data formatting option was lost');
  assertContainsAll('authored JSON write formatting', server, [
    'writeJsonAtomic(file, location, { pretty: true })',
    'writeJsonAtomic(GLOBAL_MAP_FILE, GLOBAL_MAP, { pretty: true })'
  ]);
  assertContainsAll('compact runtime JSON write call sites', server, [
    '() => writeJsonAtomic(USERS_FILE, usersDb)',
    'function persistSaves() { writeJsonAtomic(SAVES_FILE, savesDb); }'
  ]);

  const failingFs = makeFs(true);
  const failingWriter = new Function('fs', `${writerSource}\nreturn writeJsonAtomic;`)(failingFs.api);
  assert.throws(() => failingWriter('runtime.json', runtimeState), /injected rename failure/,
    'atomic persistence swallowed a rename failure');
  assert.strictEqual(failingFs.files.get('runtime.json'), 'durable',
    'a failed atomic persistence replaced the previous durable file');
  assert(!failingFs.files.has('runtime.json.tmp'),
    'failed atomic persistence left a partial temp file behind');

  const resourceEmitter = functionSource(server, 'emitResourceUpdate');
  assert(resourceEmitter.includes("emit('resourceUpdated', payload)"),
    'resource mutations no longer broadcast their reliable delta');
  assert(!resourceEmitter.includes("emit('worldState'"),
    'resource delta still broadcasts a redundant full world snapshot');
  const harvestHandler = socketEventSource(server, 'harvestResource');
  assertContainsAll('harvest delta contract', harvestHandler, [
    'resource: publicRes',
    'emitResourceUpdate(room, resource, socket.id, item)'
  ]);
  assert(!harvestHandler.includes('worldState:'),
    'harvest ACK still duplicates the full world snapshot');
  const resourceListenerStart = socketRoom.indexOf("multiplayer.socket.on('resourceUpdated'");
  const resourceListenerEnd = socketRoom.indexOf("multiplayer.socket.on('enemySnapshot'", resourceListenerStart);
  assert(resourceListenerStart >= 0 && resourceListenerEnd > resourceListenerStart,
    'missing client resourceUpdated listener');
  const resourceListener = socketRoom.slice(resourceListenerStart, resourceListenerEnd);
  assert(resourceListener.includes('applyNetworkResources([data.resource], null)'),
    'client resource delta no longer updates the resource runtime');
  assert(functionBody(worldSync, 'applyNetworkResources').includes('map[node.tz][node.tx] = TILE_TYPES.GRASS'),
    'a depleted resource delta no longer removes its collision tile');
  const applyResourceSnapshotSource = functionSource(resources, 'applyServerResourceSnapshot');
  let appliedResourceArgs = null;
  const applyResourceSnapshot = new Function(
    'applyNetworkResources',
    'findResourceNode',
    `${applyResourceSnapshotSource}\nreturn applyServerResourceSnapshot;`
  )(
    (rows, stateMap) => { appliedResourceArgs = { rows, stateMap }; },
    snapshot => ({ ...snapshot, resolved: true })
  );
  const resourceWithoutWorldState = { id: 'ore_delta', tx: 2, tz: 3, hp: 0, maxHp: 3 };
  const resolvedResource = applyResourceSnapshot({ id: 'old' }, { resource: resourceWithoutWorldState });
  assert.deepStrictEqual(appliedResourceArgs, { rows: [resourceWithoutWorldState], stateMap: null },
    'harvest client still requires worldState.map alongside its resource ACK delta');
  assert.strictEqual(resolvedResource.resolved, true,
    'harvest client did not resolve a resource ACK that omitted worldState');
  assert(server.includes("reason: 'resourceRespawn'"),
    'resource respawn no longer keeps its full compatibility reconciliation');
}

function assertEnemySnapshotFanout() {
  const publicEnemyBody = functionBody(server, 'publicEnemy');
  const viewerHostilityField = /hostileToPlayer:\s*viewer[\s\S]*?actorHostilityKeys\(e, false\)\?\.size\),/;
  assert(viewerHostilityField.test(publicEnemyBody),
    'publicEnemy viewer-specific hostility field is missing');
  assert(!/\bviewer\b/.test(publicEnemyBody.replace(viewerHostilityField, '')),
    'publicEnemy gained a viewer-dependent field outside hostileToPlayer');

  const playersBySocket = new Map([
    ['viewer-a', { hostileEnemyIds: new Set(['enemy-a']), enemyFrameVersion: 1 }],
    ['viewer-b', { hostileEnemyIds: new Set(['enemy-b']), enemyFrameVersion: 1 }]
  ]);
  const emissions = [];
  const makeTarget = (socketId, volatile = false) => ({
    get volatile() { return makeTarget(socketId, true); },
    emit(event, payload) { emissions.push({ socketId, volatile, event, payload }); }
  });
  const fakeIo = { to: socketId => makeTarget(socketId, false) };
  let publicEnemyCalls = 0;
  let publicEnemyRows = [];
  let publicEnemyFrameCalls = 0;
  const makePublicEnemy = (enemy, viewer = null) => {
    publicEnemyCalls += 1;
    const row = {
      id: enemy.id,
      name: enemy.name,
      hostileToPlayer: viewer ? viewer.hostileEnemyIds.has(enemy.id) : false,
      inventory: [{ id: 'water', qty: enemy.qty }],
      personality: { label: 'calm', traits: ['patient'] },
      aiState: 'idle',
      dead: false
    };
    publicEnemyRows.push(row);
    return row;
  };
  const makePublicEnemyFrame = (enemy, viewer = null) => {
    publicEnemyFrameCalls += 1;
    return {
      id: enemy.id,
      x: Number(enemy.x || 0),
      z: Number(enemy.z || 0),
      hp: Number(enemy.hp || 1),
      aiState: 'idle',
      flags: viewer && viewer.hostileEnemyIds.has(enemy.id) ? 8 : 0
    };
  };
  const runtime = new Function(
    'players',
    'io',
    'publicEnemy',
    'publicEnemyFrame',
    'serverActorHostileToPlayer',
    'roomNeedsHotEnemySnapshots',
    'LEGACY_ENEMY_SNAPSHOT_INTERVAL_MS',
    'Date',
    [
      functionSource(server, 'publicEnemySnapshotForViewer'),
      functionSource(server, 'publicEnemyFrameForViewer'),
      functionSource(server, 'emitFullEnemySnapshotToSockets'),
      functionSource(server, 'emitEnemySnapshot'),
      'return { emitEnemySnapshot };'
    ].join('\n')
  )(
    playersBySocket,
    fakeIo,
    makePublicEnemy,
    makePublicEnemyFrame,
    (enemy, viewer) => viewer.hostileEnemyIds.has(enemy.id),
    () => true,
    360,
    { now: () => 1000 }
  );
  const room = {
    id: 'room-a',
    locationId: 'location-a',
    sockets: new Set(['viewer-a', 'viewer-b']),
    enemies: new Map([
      ['enemy-a', { id: 'enemy-a', name: 'A', qty: 1 }],
      ['enemy-b', { id: 'enemy-b', name: 'B', qty: 2 }]
    ]),
    lastEnemySnapshotAt: 0,
    enemyFrameSeq: 0
  };

  runtime.emitEnemySnapshot(room, false);
  assert.strictEqual(publicEnemyCalls, 0,
    'routine enemy fanout still builds the heavyweight publicEnemy schema');
  assert.strictEqual(publicEnemyFrameCalls, room.enemies.size,
    'routine enemy fanout rebuilt its shared frame for every viewer');
  assert.strictEqual(emissions.length, room.sockets.size,
    'routine enemy frame did not preserve one payload per viewer');
  assert(emissions.every(row => row.event === 'enemyFrame' && row.volatile === true),
    'routine enemy frames must use volatile transport');
  const viewerA = emissions.find(row => row.socketId === 'viewer-a')?.payload;
  const viewerB = emissions.find(row => row.socketId === 'viewer-b')?.payload;
  assert.deepStrictEqual(Object.keys(viewerA || {}), ['roomId', 'locationId', 't', 'seq', 'enemies'],
    'enemy frame outer payload shape changed');
  assert.strictEqual(viewerA.seq, 1, 'first enemy frame sequence is not monotonic from one');
  assert.deepStrictEqual(viewerA.enemies.map(row => row.id), ['enemy-a', 'enemy-b'],
    'enemy frame order no longer follows the room enemy map');
  assert.deepStrictEqual(viewerA.enemies.map(row => !!(row.flags & 8)), [true, false],
    'viewer A did not receive its own hostility overlay');
  assert.deepStrictEqual(viewerB.enemies.map(row => !!(row.flags & 8)), [false, true],
    'viewer B did not receive its own hostility overlay');
  for (let index = 0; index < viewerA.enemies.length; index += 1) {
    const left = viewerA.enemies[index];
    const right = viewerB.enemies[index];
    assert.notStrictEqual(left, right,
      'two viewers received the same mutable top-level enemy frame');
    assert.deepStrictEqual(
      { ...left, flags: left.flags & ~8 },
      { ...right, flags: right.flags & ~8 },
      'viewer enemy frames differ outside the hostility flag'
    );
  }
  viewerA.enemies[0].hp = 0;
  assert.strictEqual(viewerB.enemies[0].hp, 1,
    'one viewer frame mutation leaked into another viewer payload');

  emissions.length = 0;
  publicEnemyCalls = 0;
  publicEnemyFrameCalls = 0;
  runtime.emitEnemySnapshot(room, false);
  assert.strictEqual(publicEnemyCalls, 0,
    'enemy snapshot interval gate no longer prevents redundant reconstruction');
  assert.strictEqual(publicEnemyFrameCalls, 0,
    'enemy frame interval gate no longer prevents redundant reconstruction');
  assert.strictEqual(emissions.length, 0,
    'enemy snapshot interval gate no longer preserves the existing frequency');

  runtime.emitEnemySnapshot(room, true);
  assert.strictEqual(publicEnemyCalls, room.enemies.size,
    'forced enemy fanout rebuilt publicEnemy more than once per enemy');
  assert.strictEqual(emissions.length, room.sockets.size,
    'forced enemy snapshot did not preserve one payload per viewer');
  assert(emissions.every(row => row.event === 'enemySnapshot' && row.volatile === false),
    'forced enemy snapshots must remain reliable');
  assert.deepStrictEqual(Object.keys(emissions[0].payload), ['roomId', 'locationId', 't', 'enemies'],
    'forced enemySnapshot schema gained frame-only fields');

  room.sockets = new Set(['viewer-a']);
  emissions.length = 0;
  publicEnemyCalls = 0;
  publicEnemyRows = [];
  runtime.emitEnemySnapshot(room, true);
  assert.strictEqual(publicEnemyCalls, room.enemies.size,
    'a single-viewer enemy snapshot rebuilt an enemy more than once');
  assert.strictEqual(emissions.length, 1,
    'a single-viewer room did not receive exactly one enemy snapshot');
  assert.strictEqual(emissions[0].payload.enemies[0], publicEnemyRows[0],
    'a single-viewer room still pays for a fan-out copy or recursive freeze');
  assert.deepStrictEqual(emissions[0].payload.enemies.map(row => row.hostileToPlayer), [true, false],
    'the direct single-viewer path lost viewer-specific hostility');

  playersBySocket.get('viewer-a').enemyFrameVersion = 0;
  room.lastEnemySnapshotAt = 0;
  emissions.length = 0;
  publicEnemyCalls = 0;
  runtime.emitEnemySnapshot(room, false);
  assert.strictEqual(publicEnemyCalls, room.enemies.size,
    'legacy enemy fallback did not build one shared full row per enemy');
  assert.strictEqual(emissions.length, 1,
    'legacy enemy fallback did not target the incompatible viewer exactly once');
  assert.strictEqual(emissions[0].event, 'enemySnapshot');
  assert.strictEqual(emissions[0].volatile, false,
    'legacy enemy fallback must stay reliable for an already-open old tab');
}

function assertEnemyFrameBudgetAndSparseMerge() {
  const worldStateApply = functionBody(worldSync, 'applyNetworkWorldState');
  assertContainsAll('authoritative enemy stream isolation from worldState', worldStateApply, [
    'const authoritativeEnemyStream = multiplayer.serverAuthoritativeEnemies === true',
    'if (!authoritativeEnemyStream)',
    'if (!authoritativeEnemyStream) applyNetworkEnemies(state.enemies'
  ]);
  const frameRuntime = new Function(
    'serverActorHostileToPlayer',
    'actorHostilityKeys',
    'Date',
    [
      functionSource(server, 'publicEnemyFrame'),
      'return { publicEnemyFrame };'
    ].join('\n')
  )(
    () => true,
    () => new Set(),
    { now: () => 5000 }
  );
  const frameRows = Array.from({ length: 100 }, (_, index) => frameRuntime.publicEnemyFrame({
    id: `onsite_guard_${String(index).padStart(3, '0')}`,
    x: 12.345 + index * 0.01,
    z: -23.456 - index * 0.01,
    vx: 1,
    vz: -0.5,
    speed: 2.45,
    hp: 100,
    aiState: 'investigate',
    hostileToPlayer: true,
    lookX: null,
    lookZ: null,
    npcScheduleState: 'work',
    npcSpeechUntil: 0
  }, null, 5000));
  const encodedBytes = Buffer.byteLength(JSON.stringify({
    roomId: 'settlement#crowded-scene',
    locationId: 'settlement',
    t: 5000,
    seq: 77,
    enemies: frameRows
  }), 'utf8');
  assert(encodedBytes <= 15 * 1024,
    `100-NPC enemyFrame exceeded 15 KiB: ${encodedBytes} bytes`);
  const allowedFrameFields = new Set([
    'id', 'x', 'z', 'hp', 'aiState', 'flags', 'vx', 'vz',
    'lookX', 'lookZ', 'scheduleState', 'speechText', 'speechId', 'speechMs'
  ]);
  for (const row of frameRows) {
    assertContainsAll('enemyFrame absolute row', JSON.stringify(row), ['"id"', '"x"', '"z"', '"hp"', '"aiState"', '"flags"']);
    const unexpected = Object.keys(row).filter(key => !allowedFrameFields.has(key));
    assert.deepStrictEqual(unexpected, [], `enemyFrame leaked static fields: ${unexpected.join(', ')}`);
  }

  const sparseBody = functionBody(worldSync, 'applyNetworkEnemyFrame');
  assertContainsAll('sparse enemy frame merger', sparseBody, [
    'rebuildNetworkEnemyIndex()',
    'enemyIndex.get(String(saved.id))',
    'enemy.hostileToPlayer = !!(flags & 8)',
    'updateEnemyNetworkMotion(enemy, saved)'
  ]);
  const forbiddenSparseWork = [
    'enemies.find(',
    'createEnemyFromNetworkSnapshot',
    'enemyEquipmentFromData',
    'updateEnemyEquipmentVisuals',
    'normalizeNpcInventoryWithLegacyCaps',
    'traderStock',
    'traderMarket',
    'applyNetworkFogVisibilityNow',
    'refreshNetworkFogVisibilityNow'
  ];
  const leakedSparseWork = forbiddenSparseWork.filter(snippet => sparseBody.includes(snippet));
  assert.deepStrictEqual(leakedSparseWork, [],
    `sparse enemy merger regained heavyweight work: ${leakedSparseWork.join(', ')}`);

  const equipment = { weapon: 'rifle' };
  const inventory = [{ id: 'water', qty: 2 }];
  const traderMarket = { state: 'scarce' };
  const mesh = {
    rotation: { z: 0 },
    position: { y: 0 },
    userData: { hpBar: { visible: true } }
  };
  const enemy = {
    id: 'enemy-a',
    x: 0,
    z: 0,
    visualX: 0,
    visualZ: 0,
    serverTargetX: 0,
    serverTargetZ: 0,
    hp: 50,
    dead: false,
    speed: 2.4,
    hostileToPlayer: false,
    equipment,
    inventory,
    traderMarket,
    speechText: '',
    speechId: '',
    speechUntil: 0,
    mesh
  };
  const untouched = { id: 'enemy-b', hp: 99, dead: false };
  const runtimeEnemies = [enemy, untouched];
  let motionCalls = 0;
  let corpseLocks = 0;
  let corpseCalls = 0;
  let resetCalls = 0;
  const sparseRuntime = new Function(
    'enemies',
    'applyEnemySpeechSnapshot',
    'lockEnemyCorpsePosition',
    'resetEnemyVisualController',
    'updateEnemyNetworkMotion',
    'makeCorpse',
    [
      'const networkEnemyById = new Map();',
      functionSource(worldSync, 'rebuildNetworkEnemyIndex'),
      functionSource(worldSync, 'networkEnemyScheduleLabel'),
      functionSource(worldSync, 'applyNetworkEnemyFrame'),
      'return { applyNetworkEnemyFrame };'
    ].join('\n')
  )(
    runtimeEnemies,
    (target, saved) => {
      target.speechText = String(saved.speechText || '');
      target.speechId = String(saved.speechId || '');
      target.speechUntil = Number(saved.speechMs || 0);
    },
    (target, saved) => {
      corpseLocks += 1;
      target.x = Number(saved.x || 0);
      target.z = Number(saved.z || 0);
    },
    (target, x, z) => {
      resetCalls += 1;
      target.x = x;
      target.z = z;
      target.visualX = x;
      target.visualZ = z;
    },
    (target, saved) => {
      motionCalls += 1;
      target.serverTargetX = Number(saved.x || 0);
      target.serverTargetZ = Number(saved.z || 0);
    },
    target => {
      corpseCalls += 1;
      target.dead = true;
      target.hp = 0;
    }
  );
  const applied = sparseRuntime.applyNetworkEnemyFrame([
    { id: 'enemy-a', x: 1.25, z: -0.75, vx: 1, vz: 0, hp: 37, aiState: 'investigate', lookX: 3, lookZ: 4, scheduleState: 'work', flags: 1 | 8 | 16 },
    { id: 'unknown-structural-id', x: 9, z: 9, hp: 10, aiState: 'idle', flags: 0 }
  ]);
  assert.strictEqual(applied, 1, 'sparse enemy frame created or counted an unknown structural id');
  assert.strictEqual(runtimeEnemies.length, 2, 'sparse enemy frame changed enemy membership');
  assert.strictEqual(motionCalls, 1, 'sparse enemy frame did not use the motion controller exactly once');
  assert.strictEqual(enemy.hp, 37, 'sparse enemy frame did not apply absolute HP');
  assert.strictEqual(enemy.hostileToPlayer, true, 'sparse enemy frame lost viewer hostility');
  assert.deepStrictEqual([enemy.lookX, enemy.lookZ], [3, 4], 'sparse enemy frame did not apply look coordinates');
  assert.deepStrictEqual([enemy.scheduleState, enemy.scheduleLabel], ['work', 'работает'],
    'sparse enemy frame did not preserve NPC schedule state');
  assert.strictEqual(untouched.hp, 99, 'sparse enemy frame mutated an omitted enemy');
  assert.strictEqual(enemy.equipment, equipment, 'sparse enemy frame rebuilt equipment');
  assert.strictEqual(enemy.inventory, inventory, 'sparse enemy frame rebuilt inventory');
  assert.strictEqual(enemy.traderMarket, traderMarket, 'sparse enemy frame rebuilt trader state');

  sparseRuntime.applyNetworkEnemyFrame([
    { id: 'enemy-a', x: 1.25, z: -0.75, hp: 0, aiState: 'dead', flags: 2 | 4 | 8 }
  ]);
  assert.strictEqual(corpseLocks, 1, 'sparse death frame did not lock the authoritative corpse position');
  assert.strictEqual(corpseCalls, 1, 'sparse death frame did not perform the one-time corpse transition');
  sparseRuntime.applyNetworkEnemyFrame([
    { id: 'enemy-a', x: 1.5, z: -0.5, hp: 20, aiState: 'idle', flags: 0 }
  ]);
  assert.strictEqual(resetCalls, 1, 'sparse revive frame did not reset the visual controller');
  assert.strictEqual(enemy.dead, false, 'sparse revive frame left the enemy dead');
  assert.strictEqual(enemy.equipment, equipment, 'death/revive sparse frames rebuilt equipment');
}

function assertEnemyFrameSequenceGuard() {
  const multiplayerState = {
    roomId: 'room-a',
    lastEnemySnapshotT: 100,
    lastEnemyFrameRoomId: '',
    lastEnemyFrameSeq: 0,
    lastEnemyFrameSnapshotT: 0
  };
  const runtime = new Function(
    'multiplayer',
    'networkPayloadIsForCurrentRoom',
    [
      functionSource(socketRoom, 'resetNetworkEnemyFrameSequence'),
      functionSource(socketRoom, 'networkEnemyFrameIsFresh'),
      'return { resetNetworkEnemyFrameSequence, networkEnemyFrameIsFresh };'
    ].join('\n')
  )(
    multiplayerState,
    data => data?.roomId === multiplayerState.roomId
  );
  runtime.resetNetworkEnemyFrameSequence({ roomId: 'room-a', t: 100 });
  assert.strictEqual(runtime.networkEnemyFrameIsFresh({ roomId: 'room-a', t: 100, seq: 1 }), false,
    'frame at the reliable full-snapshot baseline was accepted');
  assert.strictEqual(runtime.networkEnemyFrameIsFresh({ roomId: 'room-a', t: 101, seq: 1 }), true,
    'first post-snapshot enemy frame was rejected');
  assert.strictEqual(runtime.networkEnemyFrameIsFresh({ roomId: 'room-a', t: 102, seq: 1 }), false,
    'duplicate enemy frame sequence was accepted');
  assert.strictEqual(runtime.networkEnemyFrameIsFresh({ roomId: 'room-a', t: 103, seq: 0 }), false,
    'invalid zero enemy frame sequence was accepted');
  assert.strictEqual(runtime.networkEnemyFrameIsFresh({ roomId: 'room-a', t: 102, seq: 2 }), true,
    'newer enemy frame sequence was rejected');
  assert.strictEqual(runtime.networkEnemyFrameIsFresh({ roomId: 'room-b', t: 104, seq: 3 }), false,
    'enemy frame from another room was accepted');
  multiplayerState.lastEnemySnapshotT = 200;
  runtime.resetNetworkEnemyFrameSequence({ roomId: 'room-a', t: 200 });
  assert.strictEqual(runtime.networkEnemyFrameIsFresh({ roomId: 'room-a', t: 201, seq: 1 }), true,
    'reliable full snapshot did not reset the frame sequence baseline');

  const fullListenerStart = socketRoom.indexOf("multiplayer.socket.on('enemySnapshot'");
  const frameListenerStart = socketRoom.indexOf("multiplayer.socket.on('enemyFrame'", fullListenerStart);
  const nextListenerStart = socketRoom.indexOf("multiplayer.socket.on('groundItemsSnapshot'", frameListenerStart);
  assert(fullListenerStart >= 0 && frameListenerStart > fullListenerStart && nextListenerStart > frameListenerStart,
    'enemySnapshot/enemyFrame listener ordering is missing');
  assert(socketRoom.slice(fullListenerStart, frameListenerStart).includes('resetNetworkEnemyFrameSequence(data || {})'),
    'reliable enemySnapshot no longer resets the frame baseline');
  assertContainsAll('enemyFrame client listener', socketRoom.slice(frameListenerStart, nextListenerStart), [
    'networkEnemyFrameIsFresh(data || {})',
    'applyNetworkEnemyFrame(data.enemies || [])'
  ]);
}

function assertEnemyHotPathAvoidsForcedFullSnapshots() {
  const eventContracts = [
    ['npcQuestAction', 'emitEnemyTradeUpdated(room, actor)'],
    ['explosionAttack', 'enemies: enemyTargets.map(publicEnemy)'],
    ['enemyHit', 'enemy: publicEnemy(enemy)'],
    ['harvestResource', 'emitResourceUpdate(room, resource, socket.id, item)'],
    ['npcTradeExchange', 'emitEnemyTradeUpdated(room, actor)'],
    ['robEncounterActor', 'encounterFactionHostile']
  ];
  for (const [eventName, authoritySignal] of eventContracts) {
    const handler = socketEventSource(server, eventName);
    assert(!handler.includes('emitEnemySnapshot(room, true)'),
      `${eventName} still forces a heavyweight full enemySnapshot`);
    assert(handler.includes(authoritySignal), `${eventName} lost its authoritative ACK/event replacement`);
  }
  assert(socketEventSource(server, 'join').includes('emitEnemyBaselineForSocket(room, socket.id)'),
    'join no longer sends a targeted enemy baseline with structural fallback');
  for (const structuralEvent of ['releaseCorpseLoot', 'lootEnemy']) {
    assert(socketEventSource(server, structuralEvent).includes('emitEnemySnapshot(room, true)'),
      `${structuralEvent} no longer preserves reliable structural enemySnapshot reconciliation`);
  }
  const explosionClient = functionBody(explosions, 'applyExplosionDamage');
  assertContainsAll('partial explosion ACK reconciliation', explosionClient, [
    'applyNetworkEnemies(ack.enemies, { allowPositionSync: true, fromServer: true, pruneMissing: false })',
    'applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false })'
  ]);
}

function assertOnsiteWorldZoneSnapshotChangeDetection() {
  const setupBody = functionBody(server, 'setupWorldZoneBattleRoom');
  assertContainsAll('world-zone battle change result', setupBody, [
    'let changed = false',
    'if (changed) {',
    'return { ready: true, changed }'
  ]);
  const onsiteBody = functionBody(server, 'syncWorldOnsitePartyTransfers');
  assert(onsiteBody.includes('if (actorSetup.changed && room.sockets?.size > 0) emitEnemySnapshot(room, true)'),
    'onsite world sync no longer gates forced full snapshots on a real setup change');

  const room = {
    id: 'onsite-room',
    locationId: 'settlement',
    sockets: new Set(['viewer-a']),
    enemies: new Map(),
    onsiteWorldZoneIds: new Set()
  };
  const roomsRuntime = new Map([[room.id, room]]);
  let setupChanged = false;
  let forcedSnapshots = 0;
  const runtime = new Function(
    'WASTELAND_SIM',
    'worldTransferId',
    'normalizeLocationId',
    'sanitizeEncounterRoomId',
    'getOrCreateRoom',
    'ensureRoomWorld',
    'setupWorldZoneBattleRoom',
    'serverNpcIsNaturalCreature',
    'NPC_INVENTORY_VERSION',
    'worldZoneActorSnapshotsFromRoom',
    'onlinePlayerForWorldPartyMember',
    'runServerWorldTransferOnce',
    'WORLD_ONSITE_TRANSFERS',
    'transferPlayerToServerRoom',
    'rooms',
    'refreshRoomWorldState',
    'emitEnemySnapshot',
    [
      functionSource(server, 'syncWorldOnsitePartyTransfers'),
      'return { syncWorldOnsitePartyTransfers };'
    ].join('\n')
  )(
    {},
    value => String(value || ''),
    value => String(value || 'settlement'),
    value => String(value || ''),
    () => room,
    () => {},
    () => ({ ready: true, changed: setupChanged }),
    () => false,
    1,
    () => [],
    () => null,
    () => false,
    new Set(),
    () => false,
    roomsRuntime,
    () => {},
    (targetRoom, force) => {
      if (targetRoom === room && force === true) forcedSnapshots += 1;
    }
  );
  const simState = {
    worldZones: [{
      id: 'zone-a',
      status: 'active',
      locationId: 'settlement',
      roomId: room.id,
      partyId: 'party-a',
      details: { onsiteParty: true, actors: [{ id: 'actor-a', inventoryVersion: 1 }] }
    }],
    parties: {}
  };
  runtime.syncWorldOnsitePartyTransfers(simState);
  assert.strictEqual(forcedSnapshots, 0,
    'unchanged onsite world transfer still forced a full enemySnapshot');
  setupChanged = true;
  runtime.syncWorldOnsitePartyTransfers(simState);
  assert.strictEqual(forcedSnapshots, 1,
    'real onsite actor setup change did not force structural reconciliation');
}

function assertEventDrivenMobilePanelState() {
  const updateBody = functionBody(mobilePanels, 'updateMobilePanelState');
  assertContainsAll('mobile panel state deduplication', updateBody, [
    'const signature = [',
    'if (signature === mobilePanelStateSignature) return false',
    'mobilePanelStateSignature = signature'
  ]);
  assert(!updateBody.includes("getElementById('player-action-window')"),
    'mobile panel state still queries the non-blocking player action window');

  const observerBody = functionBody(mobilePanels, 'initMobilePanelStateObserver');
  assertContainsAll('mobile panel mutation observer', observerBody, [
    'new MutationObserver(() => updateMobilePanelState())',
    "attributeFilter: ['class', 'style']",
    "mobilePanelStateSignature = ''",
    'updateMobilePanelState()'
  ]);
  assertContainsAll(
    'mobile panel observer initialization',
    functionBody(mobileControls, 'initMobileControls'),
    ['initMobilePanelStateObserver()']
  );
  assert(!mobileControls.includes('setInterval(updateMobilePanelState'),
    'mobile controls still poll panel state on a fixed interval');
  assert(!hudLoop.includes('mobilePanelStateTimer'),
    'the render loop still polls mobile panel state');

  const runtime = new Function([
    "'use strict';",
    'function makeClassList(initial = []) {',
    '  const values = new Set(initial);',
    '  return {',
    '    writes: 0,',
    '    add(...names) { this.writes += 1; names.forEach(name => values.add(name)); },',
    '    remove(...names) { this.writes += 1; names.forEach(name => values.delete(name)); },',
    '    contains(name) { return values.has(name); },',
    '    toggle(name, force) {',
    '      this.writes += 1;',
    "      const next = typeof force === 'boolean' ? force : !values.has(name);",
    '      if (next) values.add(name); else values.delete(name);',
    '      return next;',
    '    }',
    '  };',
    '}',
    "function makeElement(id) { return { id, style: { display: 'none' }, classList: makeClassList() }; }",
    'const elementIds = [',
    "  'loot-window', 'trader-window', 'storage-window', 'character-screen',",
    "  'game-settings-panel', 'tutorial-window', 'inventory-window', 'talents-window',",
    "  'craft-window', 'map-window', 'global-map-window', 'game-confirm-panel'",
    '];',
    'const elements = Object.fromEntries(elementIds.map(id => [id, makeElement(id)]));',
    'const body = { classList: makeClassList() };',
    'const document = { body, getElementById(id) { return elements[id] || null; } };',
    'const uiWindows = {',
    "  inventory: elements['inventory-window'], talents: elements['talents-window'],",
    "  craft: elements['craft-window'], map: elements['map-window'], globalMap: elements['global-map-window']",
    '};',
    'let traderWindowOpen = false;',
    'let storageWindowOpen = false;',
    'let mobileControls = true;',
    'let crouchSyncCalls = 0;',
    'function isMobileControlsEnabled() { return mobileControls; }',
    'function syncMobileCrouchButton() { crouchSyncCalls += 1; }',
    'const observerInstances = [];',
    'class MutationObserver {',
    '  constructor(callback) { this.callback = callback; this.observed = []; observerInstances.push(this); }',
    '  observe(target, options) { this.observed.push({ target, options }); }',
    '  disconnect() { this.observed = []; }',
    '  fire() { this.callback([]); }',
    '}',
    "let mobilePanelStateSignature = '';",
    'let mobilePanelStateObserver = null;',
    statementSource(mobilePanels, 'const MOBILE_PANEL_STATE_OBSERVED_IDS'),
    functionSource(mobilePanels, 'updateMobilePanelState'),
    functionSource(mobilePanels, 'initMobilePanelStateObserver'),
    'return {',
    '  init: initMobilePanelStateObserver,',
    '  update: updateMobilePanelState,',
    '  setPanel(id, visible) { elements[id].classList.toggle("visible", !!visible); },',
    '  setMobile(value) { mobileControls = !!value; },',
    '  fire() { observerInstances[0].fire(); },',
    '  bodyHas(name) { return body.classList.contains(name); },',
    '  bodyWrites() { return body.classList.writes; },',
    '  crouchSyncCalls() { return crouchSyncCalls; },',
    '  observed() { return observerInstances[0]?.observed || []; }',
    '};'
  ].join('\n'))();

  runtime.init();
  assert.strictEqual(runtime.observed().length, 11,
    'mobile panel observer does not cover every static blocking panel');
  assert(runtime.observed().every(row => row.options?.attributes === true
    && row.options?.attributeFilter?.join(',') === 'class,style'),
  'mobile panel observer watches more than class/style attributes');
  const initialWrites = runtime.bodyWrites();
  const initialCrouchSyncCalls = runtime.crouchSyncCalls();
  assert.strictEqual(runtime.update(), false,
    'unchanged mobile panel state was not deduplicated');
  assert.strictEqual(runtime.bodyWrites(), initialWrites,
    'unchanged mobile panel state still wrote body classes');
  assert.strictEqual(runtime.crouchSyncCalls(), initialCrouchSyncCalls,
    'unchanged mobile panel state still rewrote the crouch control');

  runtime.setPanel('inventory-window', true);
  runtime.fire();
  assert(runtime.bodyHas('game-ui-panel-open') && runtime.bodyHas('mobile-ui-panel-open'),
    'opening an observed mobile panel did not update body state');
  const openWrites = runtime.bodyWrites();
  runtime.fire();
  assert.strictEqual(runtime.bodyWrites(), openWrites,
    'a repeated observer callback rewrote unchanged body state');

  runtime.setPanel('inventory-window', false);
  runtime.fire();
  assert(!runtime.bodyHas('game-ui-panel-open') && !runtime.bodyHas('mobile-ui-panel-open'),
    'closing the last observed mobile panel did not clear body state');
  runtime.setMobile(false);
  runtime.setPanel('inventory-window', true);
  runtime.fire();
  assert(runtime.bodyHas('game-ui-panel-open') && !runtime.bodyHas('mobile-ui-panel-open'),
    'desktop panel state incorrectly enables the mobile-only body class');
}

function assertActorAnimationLod() {
  const remoteRuntime = new Function([
    statementSource(remoteLocomotion, 'const REMOTE_ANIMATION_LOD_NEAR_DISTANCE'),
    statementSource(remoteLocomotion, 'const REMOTE_ANIMATION_LOD_MID_DISTANCE'),
    statementSource(remoteLocomotion, 'const REMOTE_ANIMATION_LOD_MID_INTERVAL'),
    statementSource(remoteLocomotion, 'const REMOTE_ANIMATION_LOD_FAR_INTERVAL'),
    statementSource(remoteLocomotion, 'const REMOTE_ANIMATION_LOD_MAX_DT'),
    functionSource(remoteLocomotion, 'remoteAnimationLodInterval'),
    functionSource(remoteLocomotion, 'consumeRemoteAnimationLodDt'),
    'return { interval: remoteAnimationLodInterval, consume: consumeRemoteAnimationLodDt };'
  ].join('\n'))();
  assert.strictEqual(remoteRuntime.interval(2, false, true), Infinity,
    'hidden remote players must not run heavy animation work');
  assert.strictEqual(remoteRuntime.interval(40, true, true), 0,
    'important remote-player animation must stay full-rate');
  assert.strictEqual(remoteRuntime.interval(8, true, false), 0,
    'near remote-player animation must stay full-rate');
  assert.strictEqual(remoteRuntime.interval(14, true, false), 0.05,
    'mid-distance remote-player animation must run near 20 Hz');
  assert.strictEqual(remoteRuntime.interval(24, true, false), 0.08,
    'far remote-player animation must run near 12.5 Hz');

  const farRemote = {};
  assert.strictEqual(remoteRuntime.consume(farRemote, 0.016, 0.08, 'idle'), 0.016,
    'the first remote animation state must be applied immediately');
  for (let frame = 0; frame < 3; frame += 1) {
    assert.strictEqual(remoteRuntime.consume(farRemote, 0.02, 0.08, 'idle'), 0,
      'far remote animation ran before its accumulated interval');
  }
  assert(Math.abs(remoteRuntime.consume(farRemote, 0.02, 0.08, 'idle') - 0.08) < 1e-8,
    'far remote animation did not receive its accumulated frame time');

  const changedRemote = {};
  remoteRuntime.consume(changedRemote, 0.016, 0.05, 'idle');
  remoteRuntime.consume(changedRemote, 0.016, 0.05, 'idle');
  assert(Math.abs(remoteRuntime.consume(changedRemote, 0.016, 0.05, 'moving') - 0.032) < 1e-8,
    'a remote locomotion state change waited for the LOD interval');
  const hiddenRemote = {};
  for (let frame = 0; frame < 5; frame += 1) {
    assert.strictEqual(remoteRuntime.consume(hiddenRemote, 0.05, Infinity, 'hidden'), 0,
      'hidden remote animation unexpectedly advanced');
  }
  assert(Math.abs(remoteRuntime.consume(hiddenRemote, 0.016, 0.08, 'visible') - 0.08) < 1e-8,
    'remote animation catch-up exceeded or lost the bounded accumulated time');

  const enemyRuntime = new Function([
    statementSource(enemyModels, 'const ENEMY_ANIMATION_LOD_NEAR_DISTANCE'),
    statementSource(enemyModels, 'const ENEMY_ANIMATION_LOD_CLOSE_DISTANCE'),
    statementSource(enemyModels, 'const ENEMY_ANIMATION_LOD_MID_DISTANCE'),
    statementSource(enemyModels, 'const ENEMY_ANIMATION_LOD_CLOSE_INTERVAL'),
    statementSource(enemyModels, 'const ENEMY_ANIMATION_LOD_MID_INTERVAL'),
    statementSource(enemyModels, 'const ENEMY_ANIMATION_LOD_FAR_INTERVAL'),
    statementSource(enemyModels, 'const ENEMY_ANIMATION_LOD_MAX_DT'),
    functionSource(enemyModels, 'enemyAnimationLodInterval'),
    functionSource(enemyModels, 'consumeEnemyAnimationLodDt'),
    'return { interval: enemyAnimationLodInterval, consume: consumeEnemyAnimationLodDt };'
  ].join('\n'))();
  assert.strictEqual(enemyRuntime.interval(2, false, true), Infinity,
    'hidden enemies must not run heavy animation work');
  assert.strictEqual(enemyRuntime.interval(40, true, true), 0,
    'important enemy animation must stay full-rate');
  assert.strictEqual(enemyRuntime.interval(4, true, false), 0,
    'near enemy animation must stay full-rate');
  assert.strictEqual(enemyRuntime.interval(8, true, false), 1 / 30,
    'close enemy animation must run near 30 Hz');
  assert.strictEqual(enemyRuntime.interval(14, true, false), 0.05,
    'mid-distance enemy animation must run near 20 Hz');
  assert.strictEqual(enemyRuntime.interval(24, true, false), 0.08,
    'far enemy animation must run near 12.5 Hz');
  const hiddenEnemy = {};
  for (let frame = 0; frame < 5; frame += 1) {
    assert.strictEqual(enemyRuntime.consume(hiddenEnemy, 0.05, Infinity, 'hidden'), 0,
      'hidden enemy animation unexpectedly advanced');
  }
  assert(Math.abs(enemyRuntime.consume(hiddenEnemy, 0.016, 0.08, 'visible') - 0.08) < 1e-8,
    'enemy animation catch-up exceeded or lost the bounded accumulated time');

  const remoteUpdate = functionBody(remoteLocomotion, 'updateRemotePlayers');
  assertContainsAll('fog-hidden remote fast path', remoteUpdate, [
    'if (g.visible === false)',
    'g.position.set(netX, 0, netZ)',
    'row.visualVelX = 0',
    'row.visualVelZ = 0'
  ]);
  const movementIndex = remoteUpdate.indexOf('updateRemoteVisualLocomotion(row, dt, now)');
  const lodGateIndex = remoteUpdate.indexOf('if (animationDt <= 0) return');
  const animationIndex = remoteUpdate.indexOf('updateCharacterLocomotionAnimation(g, animationDt');
  assert(movementIndex >= 0 && movementIndex < lodGateIndex && lodGateIndex < animationIndex,
    'remote root interpolation is no longer independent from heavy animation LOD');
  assertContainsAll('remote animation LOD bundle', remoteUpdate, [
    'applyCharacterCrouchVisual(g, !!g.userData.crouching, animationDt)',
    'applyCharacterInjuryVisual(g, injuries, animationDt)',
    'updateWeaponVisualAnimation(g.userData.parts?.weaponGroup, animationDt, remoteWeaponOwner)',
    'updateCharacterMeleeAnimation(g, animationDt)'
  ]);

  const enemyUpdate = functionBody(enemyModels, 'animateEnemyVisual');
  const heavyImportanceStart = enemyUpdate.indexOf('const heavyImportant =');
  const heavyImportanceEnd = enemyUpdate.indexOf('let animationDt = dt;', heavyImportanceStart);
  const heavyImportance = enemyUpdate.slice(heavyImportanceStart, heavyImportanceEnd);
  assertContainsAll('enemy full-rate animation importance', heavyImportance, [
    'attackWindowActive',
    'meleeWindowActive',
    'Number(enemy.flash || 0) > 0.02',
    'player.attackTarget === enemy',
    'hoveredEnemy === enemy'
  ]);
  assert(!heavyImportance.includes("=== 'chase'")
    && !heavyImportance.includes('enemy.targetId')
    && !heavyImportance.includes('enemy.factionTargetId'),
  'ordinary chase/target state still forces full-rate enemy animation');
  const enemyLodSetupIndex = enemyUpdate.indexOf('let animationDt = dt;');
  const enemyLodGateIndex = enemyUpdate.indexOf('if (animationDt <= 0) return', enemyLodSetupIndex);
  const enemyRestoreIndex = enemyUpdate.indexOf('enemyAnimRestoreActorParts(parts, animationRestoreK)');
  assert(enemyLodSetupIndex >= 0 && enemyLodGateIndex > enemyLodSetupIndex && enemyLodGateIndex < enemyRestoreIndex,
    'enemy procedural pose is restored on frames skipped by heavy animation LOD');
  assertContainsAll('enemy heavy animation LOD bundle', enemyUpdate, [
    'const heavyActor = !!(',
    'enemyAnimationLodInterval(distanceToPlayer, visible, heavyImportant)',
    'if (animationDt <= 0) return',
    'updateCharacterLocomotionAnimation(mesh, animationDt',
    'updateEnemyStaticGlbAnimation(enemy, animationDt',
    'updateWeaponVisualAnimation(mesh.userData.enemyWeaponGroup, animationDt, enemy)',
    'updateCharacterMeleeAnimation(mesh, animationDt)'
  ]);
  assert(/idleVisualAnimTimer[\s\S]{0,180}Number\(animationDt \|\| 0\.016\)/.test(enemyUpdate),
    'enemy fallback idle timer ignores the time accumulated by heavy animation LOD');

  const updateEnemies = functionBody(updateLoop, 'updateEnemies');
  assertContainsAll('fog-hidden enemy fast path', updateEnemies, [
    'if (e.mesh.visible === false)',
    'e.mesh.position.set(tx, 0, tz)',
    'applyEnemyFlashVisual(e, dt)'
  ]);

  const proceduralRuntime = new Function([
    functionSource(modernActorRuntime, 'modernAnimationHasVisibleMesh'),
    functionSource(modernActorRuntime, 'modernProceduralRigNeedsAnimation'),
    'return modernProceduralRigNeedsAnimation;'
  ].join('\n'))();
  const characterRoot = {};
  const hiddenBase = { isMesh: true, visible: false };
  assert.strictEqual(proceduralRuntime({}, characterRoot), true,
    'actors without a captured procedural fallback were incorrectly fast-pathed');
  assert.strictEqual(proceduralRuntime({ proceduralCharacterBaseMeshes: [hiddenBase] }, characterRoot), false,
    'fully hidden procedural fallback still runs its locomotion rig');
  assert.strictEqual(proceduralRuntime({
    proceduralCharacterBaseMeshes: [hiddenBase],
    backpack: { isMesh: true, visible: true }
  }, characterRoot), true, 'visible fallback equipment no longer animates with the procedural rig');
  assert.strictEqual(proceduralRuntime({
    proceduralCharacterBaseMeshes: [hiddenBase],
    weaponGroup: { visible: true, parent: {}, children: [{ isMesh: true, visible: true }] }
  }, characterRoot), true, 'an unmounted visible weapon no longer keeps its procedural anchor animated');
  assert.strictEqual(proceduralRuntime({
    proceduralCharacterBaseMeshes: [hiddenBase],
    weaponGroup: { visible: true, parent: characterRoot, children: [{ isMesh: true, visible: true }] }
  }, characterRoot), false, 'a GLB-mounted approved weapon incorrectly keeps the hidden procedural rig active');

  const modernUpdate = functionBody(modernActorRuntime, 'updateCharacterLocomotionAnimation');
  const glbUpdateIndex = modernUpdate.indexOf('updateCharacterGlbAnimation(actor, dt, animationState) === true');
  const approvedGripIndex = modernUpdate.indexOf('updateModernApprovedWeaponGrip(actor, weaponId)');
  const hiddenRigGateIndex = modernUpdate.indexOf('if (!modernProceduralRigNeedsAnimation(parts, actor.userData.characterGlbRuntime.root)) return');
  const proceduralAnimationIndex = modernUpdate.indexOf('const crouching =');
  assert(glbUpdateIndex >= 0
    && approvedGripIndex > glbUpdateIndex
    && hiddenRigGateIndex > approvedGripIndex
    && proceduralAnimationIndex > hiddenRigGateIndex,
  'the successful GLB fast path no longer preserves approved grip before skipping the hidden procedural rig');
}

function assertCrowdedActorInteractionBudget() {
  assertContainsAll('shared actor interaction proxy', actorVisuals, [
    'const actorInteractionProxyGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false)',
    'const actorInteractionProxyMaterial = new THREE.MeshBasicMaterial({ visible: false })',
    'function attachActorInteractionProxy(actor, options = {})'
  ]);
  assertContainsAll('enemy interaction proxy attachment', enemyModels, [
    "attachActorInteractionProxy(group, {",
    'radius: Math.max(0.48, ringRadius * Number(type.scale || 1))'
  ]);
  assertContainsAll('remote-player interaction proxy attachment', remoteLocomotion, [
    "attachActorInteractionProxy(g, { radius: 0.68, height: 2.1 })"
  ]);
  const enemyRaycast = functionBody(worldContextTargets, 'findEnemyFromEvent');
  assert(enemyRaycast.includes('raycaster.intersectObjects(proxies, false)'),
    'enemy pointer targeting does not use low-poly actor proxies');
  assert(!enemyRaycast.includes('raycaster.intersectObjects(enemyMeshes, true)'),
    'enemy pointer targeting still recursively raycasts every skinned mesh');
  const remoteRaycast = functionBody(worldContextTargets, 'findRemotePlayerFromEvent');
  assert(remoteRaycast.includes('raycaster.intersectObjects(proxies, false)'),
    'remote-player pointer targeting does not use low-poly actor proxies');
  assert(!remoteRaycast.includes('raycaster.intersectObjects(roots, true)'),
    'remote-player pointer targeting still recursively raycasts every skinned mesh');
  assert(interaction.includes('const INTERACTION_TARGET_CACHE_MS = 360;'),
    'stationary cursor target cache is too short for crowded rooms');
  assertContainsAll('pointer hover frame budget', input, [
    'let pointerHoverFrame = 0;',
    'function updatePointerHoverFromScreen()',
    'pointerHoverFrame = requestAnimationFrame(updatePointerHoverFromScreen)'
  ]);
  const hudLoop = read('public/js/game/13_minimap_hud_loop.js');
  const minimapBudget = functionBody(hudLoop, 'maybeDrawHudMinimaps');
  assertContainsAll('visible minimap draw budget', minimapBudget, [
    'minimapCanvasIsVisible(miniCanvas)',
    'minimapCanvasIsVisible(mobileCanvas)',
    'minimapCanvasIsVisible(desktopCanvas)'
  ]);
}

function assertRemotePlayerStateFastPath() {
  const freshnessRuntime = new Function([
    functionSource(remoteLocomotion, 'remotePlayerStateIsStale'),
    'return remotePlayerStateIsStale;'
  ].join('\n'))();
  const marker = { lastPlayerStateSeq: 7, lastPlayerStateServerT: 1000 };
  assert.strictEqual(freshnessRuntime(marker, { seq: 7 }, 1001), true,
    'duplicate compact player state is accepted');
  assert.strictEqual(freshnessRuntime(marker, { seq: 8 }, 999), true,
    'older compact player timestamp is accepted');
  assert.strictEqual(freshnessRuntime(marker, { seq: 8 }, 1000), false,
    'higher sequence with the same server timestamp is rejected');
  const upsertBody = functionBody(remoteLocomotion, 'upsertRemotePlayer');
  const freshnessIndex = upsertBody.indexOf('if (remotePlayerStateIsStale(row, data, serverT)) return');
  const motionMutationIndex = upsertBody.indexOf('row.data.id = data.id');
  const profileMergeIndex = upsertBody.indexOf('row.data = { ...row.data, ...data }');
  assert(freshnessIndex >= 0 && freshnessIndex < motionMutationIndex,
    'compact player freshness is checked after mutating the remote row');
  assert(profileMergeIndex > motionMutationIndex,
    'compact movement packet still uses the full profile object spread');
  const stateBranchEnd = upsertBody.indexOf('} else {\n      row.data = { ...row.data, ...data }', motionMutationIndex);
  const stateBranch = upsertBody.slice(motionMutationIndex, stateBranchEnd);
  for (const staticField of ['name', 'appearance', 'equipment', 'weapon', 'injuries', 'hp', 'level']) {
    assert(!stateBranch.includes(`row.data.${staticField}`),
      `compact movement packet mutates static field ${staticField}`);
  }
  assertContainsAll('cached remote visibility path', upsertBody, [
    "typeof updateEntityRtsFogVisibility === 'function'",
    'updateEntityRtsFogVisibility(row.group, row.group.userData.targetX, row.group.userData.targetZ, fogOptions)'
  ]);
}

async function main() {
  assertAuthorityModes();
  assertAuthorityTransitionCleanup();
  assertGameplayAckGuards();
  await assertJoinAndCorrectionContracts();
  assertInputLifecycle();
  assertMovementAccuracyIntent();
  assertHarvestIntegrity();
  assertInputDeadman();
  assertGlobalMapMotionIntegrity();
  assertGlobalMapSnapshotPerformance();
  assertBlockedGameplayGates();
  assertDeferredWorldRuntime();
  assertServerAuthoritativeWorldStateRequests();
  assertServerNetworkHotPath();
  assertEnemySnapshotFanout();
  assertEnemyFrameBudgetAndSparseMerge();
  assertEnemyFrameSequenceGuard();
  assertEnemyHotPathAvoidsForcedFullSnapshots();
  assertOnsiteWorldZoneSnapshotChangeDetection();
  assertEventDrivenMobilePanelState();
  assertActorAnimationLod();
  assertCrowdedActorInteractionBudget();
  assertRemotePlayerStateFastPath();
  console.log('Client-state integrity checks passed: authority, guarded gameplay ACKs, join/reconnect, movement accuracy, compact network hot paths, sparse sequenced enemy frames, onsite-zone change detection, actor animation LOD, global-map motion, deferred world bootstrap, input lifecycle, harvest, world-state resync, event-driven mobile panels and dead-man switch.');
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
