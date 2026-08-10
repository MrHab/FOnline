#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const multiplayerClientSource = fs.readFileSync(
  path.join(ROOT, 'public', 'js', 'game', '05c_multiplayer_socket_room.js'),
  'utf8'
);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const signatureEnd = source.indexOf(') {', start);
  const bodyStart = signatureEnd >= 0 ? source.indexOf('{', signatureEnd) : -1;
  assert(bodyStart >= 0, `missing body for ${name}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function assertSpatialIntegration() {
  for (const marker of [
    "require('./src/server/room-actor-spatial-index')",
    'function rebuildRoomEnemySpatialIndex(',
    'function ensureRoomEnemySpatialIndex(',
    'function roomEnemySpatialCandidates(',
    'return [...room.enemies.values()];'
  ]) {
    assert(serverSource.includes(marker), `missing spatial integration marker: ${marker}`);
  }

  const update = extractFunction(serverSource, 'updateServerEnemies');
  const startRebuild = update.indexOf('rebuildRoomEnemySpatialIndex(room, roomEnemySpatialMovementPadding(room, dt));');
  const factionUpdate = update.indexOf('updateEncounterFactionCombat(room, dt, roomPlayers)');
  const endRebuild = update.lastIndexOf('rebuildRoomEnemySpatialIndex(room, 0);');
  assert(startRebuild >= 0 && startRebuild < factionUpdate,
    'AI tick does not build its broad-phase snapshot before faction movement');
  assert(update.includes('try {') && update.includes('} finally {') && endRebuild > factionUpdate,
    'AI tick does not publish a final spatial snapshot from finally');

  const separation = extractFunction(serverSource, 'enemySeparationVector');
  const bodyBlocked = extractFunction(serverSource, 'isEnemyBodyBlockedAt');
  const collisionPenalty = extractFunction(serverSource, 'roomEnemyCollisionPenalty');
  const factionFoe = extractFunction(serverSource, 'findNearestFactionFoe');
  assert(separation.includes('roomEnemySpatialCandidates(') && separation.includes('d2 > r2'),
    'enemy separation lost broad phase or its exact distance test');
  assert(bodyBlocked.includes('roomEnemySpatialCandidates(') && bodyBlocked.includes('nextDist >= minDist'),
    'enemy body collision lost broad phase or its exact narrow phase');
  assert(collisionPenalty.includes('roomEnemySpatialCandidates(')
    && collisionPenalty.includes('circleRotatedBlockerPenalty('),
  'player/enemy collision lost broad phase or transformed-blocker narrow phase');
  assert(factionFoe.includes('detectionRange * 1.8')
    && factionFoe.includes('roomHasHighLineOfSight('),
  'faction target broad phase no longer covers memory range or exact LOS');
}

function assertAdaptiveSpatialMovementPadding() {
  const source = extractFunction(serverSource, 'roomEnemySpatialMovementPadding');
  const context = vm.createContext({
    EMPTY_ROOM_AI_MAX_DT: 0.5,
    ROOM_ENEMY_SPATIAL_MOVEMENT_PADDING: 12,
    Map
  });
  vm.runInContext(`${source}\nthis.padding = roomEnemySpatialMovementPadding;`, context);

  const typicalRoom = {
    enemies: new Map(Array.from({ length: 100 }, (_, index) => [
      `typical-${index}`,
      { id: `typical-${index}`, speed: 3, dead: false }
    ]))
  };
  const typical = context.padding(typicalRoom, 0.25);
  assert(typical >= 1.5 && typical <= 1.6,
    `ordinary active-room padding is not tight enough: ${typical}`);

  const maximumRoom = { enemies: new Map([['fast', { id: 'fast', speed: 20, dead: false }]]) };
  const maximum = context.padding(maximumRoom, 0.5);
  assert(maximum >= 11.7 && maximum <= 12,
    `long speed-20 tick lost its conservative coverage: ${maximum}`);
}

function assertRemainingEnemyAiScansUseCrowdIndexes() {
  const meleeGoal = extractFunction(serverSource, 'enemyMeleeGoalNearTarget');
  assert(meleeGoal.includes('room.enemyAttackersByTargetId instanceof Map')
    && meleeGoal.includes('roomEnemySpatialCandidates(room, tx, tz, 7.5)')
    && !meleeGoal.includes('for (const other of room.enemies.values())'),
  'melee surround-slot selection returned to a per-attacker full room scan');

  const corpseTarget = extractFunction(serverSource, 'serverNpcCorpseLootTarget');
  assert(corpseTarget.includes('roomEnemySpatialCandidates(room, enemy.x, enemy.z, radius'),
    'NPC corpse search returned to a full room scan');

  const factionFoes = extractFunction(serverSource, 'npcHasLiveFactionFoes');
  const cacheBuilder = extractFunction(serverSource, 'rebuildRoomEnemyAiLookupCaches');
  assert(factionFoes.includes('room.enemyLiveFactionGroups instanceof Set')
    && cacheBuilder.includes('room.enemyAttackersByTargetId = attackersByTargetId;'),
  'scheduled/stationary NPC faction checks no longer reuse per-tick lookup caches');

  const update = extractFunction(serverSource, 'updateServerEnemies');
  assert(update.includes('rebuildRoomEnemyAiLookupCaches(room);')
    && update.includes('const hasLiveFoes = npcHasLiveFactionFoes(room, enemy);'),
  'active AI tick bypasses the cached crowd lookups');
}

function assertStructuralEnemyChangesStayReliable() {
  const update = extractFunction(serverSource, 'updateServerEnemies');
  assert(update.includes('let enemyStructureChanged = ensureRoomWorld(room) === true;'),
    'enemy AI tick does not track structural spawn/removal changes');
  assert(update.includes('const spawned = spawnServerEnemy(')
    && update.includes('enemyStructureChanged = true;'),
  'enemy respawns no longer mark the room structure dirty');
  assert(update.includes('roomEnemyDelete(room, enemy.id)')
    && update.includes('return enemyStructureChanged;'),
  'corpse cleanup or AI return value no longer preserves structural changes');

  const ensureWorld = extractFunction(serverSource, 'ensureRoomWorld');
  assert((ensureWorld.match(/return true;/g) || []).length >= 2,
    'same-size world/occupant regeneration no longer marks enemy structure dirty');

  const markDirty = extractFunction(serverSource, 'markRoomEnemyStructureDirty');
  const setEnemy = extractFunction(serverSource, 'roomEnemySet');
  const deleteEnemy = extractFunction(serverSource, 'roomEnemyDelete');
  const clearEnemies = extractFunction(serverSource, 'clearRoomEnemies');
  assert(markDirty.includes('room.enemyStructureDirty = true;')
    && markDirty.includes('room.enemySpatialIndex = null;')
    && markDirty.includes('room.enemySpatialSourceSize = -1;')
    && setEnemy.includes('markRoomEnemyStructureDirty(room)')
    && deleteEnemy.includes('markRoomEnemyStructureDirty(room)')
    && clearEnemies.includes('markRoomEnemyStructureDirty(room)'),
  'one of the centralized enemy structure mutations no longer persists the dirty flag');
  assert.strictEqual((serverSource.match(/room\.enemies\.set\(/g) || []).length, 1,
    'an enemy insertion bypasses the centralized structural-dirty helper');
  assert.strictEqual((serverSource.match(/room\.enemies\.delete\(/g) || []).length, 1,
    'an enemy removal bypasses the centralized structural-dirty helper');
  assert.strictEqual((serverSource.match(/room\.enemies\.clear\(/g) || []).length, 1,
    'an enemy clear bypasses the centralized structural-dirty helper');

  const emit = extractFunction(serverSource, 'emitEnemySnapshot');
  assert(emit.includes('const reliable = !!force || !!room.enemyStructureDirty;')
    && emit.includes('if (reliable)')
    && emit.includes('room.enemyStructureDirty = false;'),
  'persistent structural dirtiness no longer upgrades the next enemy packet to a reliable snapshot');

  const activeTickStart = serverSource.indexOf('// 2) Потом серверный AI мобов.');
  const activeTickEnd = serverSource.indexOf('// 3) Финальный актуальный snapshot по комнатам', activeTickStart);
  assert(activeTickStart >= 0 && activeTickEnd > activeTickStart, 'missing active enemy AI tick');
  const activeTick = serverSource.slice(activeTickStart, activeTickEnd);
  assert(activeTick.includes('const enemyStructureChanged = updateServerEnemies(room, enemyDt);')
    && activeTick.includes('emitEnemySnapshot(room, enemyStructureChanged);'),
  'spawn/removal changes are not upgraded to a reliable full enemy snapshot');
}

function assertEnemyFrameCompatibilityFallback() {
  assert(multiplayerClientSource.includes('enemyFrameVersion: 1,'),
    'current clients no longer advertise enemyFrame support during join');
  assert(serverSource.includes('const enemyFrameVersion = Number(data.enemyFrameVersion || 0) >= 1 ? 1 : 0;')
    && serverSource.includes('enemyFrameVersion,'),
  'join no longer records the negotiated enemyFrame capability');

  const emit = extractFunction(serverSource, 'emitEnemySnapshot');
  assert(emit.includes('Number(viewer?.enemyFrameVersion || 0) >= 1')
    && emit.includes('LEGACY_ENEMY_SNAPSHOT_INTERVAL_MS')
    && emit.includes('emitFullEnemySnapshotToSockets(room, legacySocketIds, now);'),
  'open legacy tabs no longer receive the throttled full-snapshot fallback');
  const legacyFull = extractFunction(serverSource, 'emitFullEnemySnapshotToSockets');
  assert(legacyFull.includes("io.to(socketId).emit('enemySnapshot'") && !legacyFull.includes('.volatile'),
    'legacy reconciliation is no longer a reliable full enemy snapshot');

  const joinBaseline = extractFunction(serverSource, 'emitEnemyBaselineForSocket');
  assert(joinBaseline.includes('if (room.enemyStructureDirty)')
    && joinBaseline.includes('emitEnemySnapshot(room, true);')
    && joinBaseline.includes('emitFullEnemySnapshotToSockets(room, [socketId], Date.now());'),
  'joining clients no longer get a targeted baseline with structural broadcast fallback');
  const joinHandler = serverSource.slice(
    serverSource.indexOf("socket.on('join'"),
    serverSource.indexOf("socket.on('equipmentAction'", serverSource.indexOf("socket.on('join'"))
  );
  assert(joinHandler.includes('emitEnemyBaselineForSocket(room, socket.id);'),
    'join still broadcasts a heavyweight enemy baseline to every existing player');
}

function assertViewerSpecificEnemyDeltas() {
  const tradeFanout = extractFunction(serverSource, 'emitEnemyTradeUpdated');
  assert(tradeFanout.includes('enemy: publicEnemy(actor, viewer)')
    && tradeFanout.includes("io.to(socketId).emit('enemyTradeUpdated'"),
  'NPC trade/quest deltas no longer preserve per-viewer hostility');
  assert(!serverSource.includes("io.to(room.id).emit('enemyTradeUpdated'"),
    'a room-wide NPC delta still leaks another viewer\'s hostility state');

  const robbery = serverSource.slice(
    serverSource.indexOf("socket.on('robEncounterActor'"),
    serverSource.indexOf("socket.on('inspectCorpse'", serverSource.indexOf("socket.on('robEncounterActor'"))
  );
  assert(robbery.includes('enemies: factionEnemies.map(enemy => publicEnemy(enemy, viewer))'),
    'robbery faction delta no longer builds a viewer-specific enemy list');
}

function assertWorldStateRefreshIsCoalesced() {
  const refresh = extractFunction(serverSource, 'refreshRoomWorldState');
  const current = extractFunction(serverSource, 'currentRoomWorldState');
  let now = 1000;
  let builds = 0;
  const context = vm.createContext({
    ROOM_WORLD_STATE_REFRESH_MIN_MS: 200,
    Date: { now: () => now },
    publicWorldState: () => ({ build: ++builds })
  });
  vm.runInContext(`${refresh}\n${current}\nthis.api = { refreshRoomWorldState, currentRoomWorldState };`, context);
  const room = {};
  context.api.refreshRoomWorldState(room);
  now = 1050;
  context.api.refreshRoomWorldState(room);
  context.api.refreshRoomWorldState(room);
  assert.strictEqual(builds, 1, 'hot actions still rebuild the heavyweight world state per event');
  assert.strictEqual(room.worldStateDirty, true, 'coalesced world-state changes are not remembered');
  context.api.currentRoomWorldState(room);
  assert.strictEqual(builds, 2, 'join/broadcast did not force pending world-state reconciliation');
  assert.strictEqual(room.worldStateDirty, false, 'forced world-state reconciliation stayed dirty');
}

function assertMotionPacketContract() {
  const source = extractFunction(serverSource, 'publicPlayerMovement');
  const context = vm.createContext({
    clampPlayerVelocity: value => Math.max(-20, Math.min(20, Number(value) || 0))
  });
  vm.runInContext(`${source}\nthis.publicPlayerMovement = publicPlayerMovement;`, context);
  const packet = context.publicPlayerMovement({
    id: 'socket-1234567890',
    movementSeq: 42,
    characterId: 'must-not-leak',
    name: 'Heavy static profile data',
    deviceType: 'desktop',
    controlType: 'keyboard_mouse',
    x: 12.34567,
    z: -9.87654,
    vx: 1.23456,
    vz: -2.34567,
    angle: 1.234567,
    crouching: true,
    moving: true,
    turning: false,
    hp: 73,
    maxHp: 120,
    dead: false,
    locationId: 'settlement',
    roomId: 'settlement'
  });
  assert.deepStrictEqual(
    Object.keys(packet).sort(),
    ['angle', 'crouching', 'id', 'moving', 'seq', 'turning', 'vx', 'vz', 'x', 'z'].sort(),
    'playerState motion payload regained static/profile fields'
  );
  const bytes = Buffer.byteLength(JSON.stringify(packet));
  assert(bytes <= 250, `motion packet exceeds 250 bytes: ${bytes}`);
  assert(serverSource.includes('const minRelayMs = 50;'), 'playerState relay is no longer capped at 20Hz');
  assert(serverSource.includes('const movementTransition = p.moving !== p.lastRelayedMoving;'),
    'movement stop/start transitions are no longer relayed immediately');
  assert(serverSource.includes('const crouchingTransition = p.crouching !== p.lastRelayedCrouching;')
    && serverSource.includes('const turningTransition = p.turning !== p.lastRelayedTurning;')
    && serverSource.includes('const reliableStateTransition = movementTransition || crouchingTransition;')
    && serverSource.includes('const movementTransport = reliableStateTransition ? roomRelay : (roomRelay.volatile || roomRelay);'),
  'discrete movement/stance transitions can be dropped with volatile intermediate packets');
}

function assertPlayerSnapshotIsLazyAndVolatile() {
  const start = serverSource.indexOf('// 3) Финальный актуальный snapshot по комнатам');
  const end = serverSource.indexOf('}, 1000 / TICK_RATE);', start);
  assert(start >= 0 && end > start, 'missing final player snapshot loop');
  const source = serverSource.slice(start, end);
  const collectReferences = source.indexOf('byRoom.get(p.roomId).push(p);');
  const cadenceGate = source.indexOf('room.lastPlayerSnapshotAt || 0) < 1000');
  const serializeDueRoom = source.indexOf('const list = roomPlayers.map(publicPlayer);');
  const volatileEmit = source.indexOf("io.to(roomId).volatile.emit('snapshot'");
  assert(collectReferences >= 0 && cadenceGate > collectReferences && serializeDueRoom > cadenceGate,
    'publicPlayer is serialized before the room snapshot cadence gate');
  assert(volatileEmit > serializeDueRoom, 'full room snapshot is not emitted through the volatile transport');
  assert(!source.includes('push(publicPlayer(p))'), 'main tick eagerly rebuilds full player snapshots');
}

function assertCollisionCacheInvalidation() {
  const start = serverSource.indexOf('const ENEMY_BODY_RADIUS_CACHE = new WeakMap();');
  const end = serverSource.indexOf('\nfunction roomEnemyCollisionPenalty(', start);
  assert(start >= 0 && end > start, 'missing enemy collision cache section');
  const cacheSource = serverSource.slice(start, end);
  const counters = { radius: 0, blockers: 0 };
  const context = vm.createContext({
    SERVER_MODEL_COLLIDERS: {},
    serverEnemyModelKeyForVisual: visual => String(visual || ''),
    serverModelFileForRef: modelKey => `${modelKey}.glb`,
    modelColliderRadius: (_catalog, file, scale) => {
      counters.radius++;
      return (file.startsWith('model-b') ? 3 : 2) * scale;
    },
    resolveActorFacingIntent: (_enemy, vx, vz) => Math.hypot(Number(vx || 0), Number(vz || 0)) > 0.001
      ? { dx: Number(vx || 0), dz: Number(vz || 0) }
      : null,
    resolveActorFacingYaw: (_enemy, dx, dz) => Math.atan2(dx, dz),
    transformedModelBlockers: (_catalog, file, transform) => {
      counters.blockers++;
      return [{
        file,
        x: transform.x + transform.scaleX,
        z: transform.z,
        halfX: transform.scaleX,
        halfZ: transform.scaleZ * 0.5,
        rotationY: transform.rotationY
      }];
    },
    buildRoomActorSpatialIndex: () => ({ records: [] }),
    queryRoomActorSpatialIndex: () => []
  });
  vm.runInContext(`${cacheSource}\nthis.tested = { enemyBodyRadius, enemyMovementCollisionBlockers };`, context);

  const bodyActor = { modelKey: 'model-a', scale: 1 };
  const firstRadius = context.tested.enemyBodyRadius(bodyActor);
  assert.strictEqual(context.tested.enemyBodyRadius(bodyActor), firstRadius);
  assert.strictEqual(counters.radius, 1, 'body-radius cache missed an unchanged model/scale');
  bodyActor.scale = 2;
  assert.notStrictEqual(context.tested.enemyBodyRadius(bodyActor), firstRadius);
  assert.strictEqual(counters.radius, 2, 'body-radius cache ignored a scale change');
  bodyActor.modelKey = 'model-b';
  assert.strictEqual(context.tested.enemyBodyRadius(bodyActor), 6);
  assert.strictEqual(counters.radius, 3, 'body-radius cache ignored a model change');

  const movingActor = { modelKey: 'model-a', scale: 1, x: 4, z: -2, vx: 1, vz: 0 };
  const firstBlockers = context.tested.enemyMovementCollisionBlockers(movingActor);
  assert.strictEqual(context.tested.enemyMovementCollisionBlockers(movingActor), firstBlockers);
  assert.strictEqual(counters.blockers, 1, 'movement-blocker cache missed an unchanged transform');
  movingActor.x = 5;
  assert.notStrictEqual(context.tested.enemyMovementCollisionBlockers(movingActor), firstBlockers);
  movingActor.z = -3;
  context.tested.enemyMovementCollisionBlockers(movingActor);
  movingActor.scale = 1.5;
  context.tested.enemyMovementCollisionBlockers(movingActor);
  movingActor.vx = 0;
  movingActor.vz = 1;
  context.tested.enemyMovementCollisionBlockers(movingActor);
  movingActor.modelKey = 'model-b';
  const finalBlockers = context.tested.enemyMovementCollisionBlockers(movingActor);
  assert.strictEqual(counters.blockers, 6,
    'movement-blocker cache did not invalidate for position, scale, yaw, and model keys');
  assert.strictEqual(finalBlockers[0].file, 'model-b.glb', 'invalidated blocker cache returned stale output');
  assert.strictEqual(finalBlockers[0].x, 6.5, 'invalidated blocker cache changed exact transform output');
}

assertSpatialIntegration();
assertAdaptiveSpatialMovementPadding();
assertRemainingEnemyAiScansUseCrowdIndexes();
assertStructuralEnemyChangesStayReliable();
assertEnemyFrameCompatibilityFallback();
assertViewerSpecificEnemyDeltas();
assertWorldStateRefreshIsCoalesced();
assertMotionPacketContract();
assertPlayerSnapshotIsLazyAndVolatile();
assertCollisionCacheInvalidation();
console.log('Crowded-room performance checks passed: spatial broad phase, collision caches, and compact volatile player streams are guarded.');
