#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  buildStaticCollisionSpatialIndex,
  queryStaticCollisionSpatialIndex,
  staticCollisionBlockerBounds
} = require('../src/server/static-collision-spatial-index');
const { segmentIntersectsRotatedBlocker } = require('../src/server/enemy-ai');

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

function assertStaticCollisionSpatialBroadPhase() {
  const blockers = [];
  for (let z = 0; z < 30; z++) {
    for (let x = 0; x < 30; x++) {
      blockers.push({
        id: `blocker-${x}-${z}`,
        x: x * 6 - 87,
        z: z * 6 - 87,
        halfX: 0.45 + ((x * 7 + z * 3) % 5) * 0.12,
        halfZ: 0.4 + ((x * 2 + z * 11) % 4) * 0.15,
        rotationY: ((x * 17 + z * 13) % 19) * Math.PI / 19
      });
    }
  }
  // A large rotated authored wall exercises multi-cell indexing and deduplication.
  blockers.push({ id: 'large-wall', x: 4, z: -3, halfX: 18, halfZ: 0.75, rotationY: Math.PI / 5 });

  const index = buildStaticCollisionSpatialIndex(blockers, { cellSize: 8 });
  assert.strictEqual(index.size, blockers.length, 'static blocker index dropped a valid authored blocker');
  assert.throws(
    () => buildStaticCollisionSpatialIndex([{ x: 0, z: 0, halfX: Infinity, halfZ: 1 }]),
    /must be finite/,
    'malformed static geometry no longer triggers the exact full-scan fallback'
  );
  assert.throws(
    () => buildStaticCollisionSpatialIndex([{ x: 0, z: 0, halfX: Number.MAX_VALUE, halfZ: Number.MAX_VALUE }]),
    /derived blocker bounds must be finite|cell coordinate exceeds/,
    'derived blocker-bound overflow no longer triggers the exact full-scan fallback'
  );
  assert.throws(
    () => buildStaticCollisionSpatialIndex([{ x: 0, z: 0, halfX: 1_000_000, halfZ: 1_000_000 }]),
    /cell budget exceeded/,
    'huge finite blocker can allocate an unbounded number of spatial cells'
  );
  assert.throws(
    () => queryStaticCollisionSpatialIndex(index, 0, 0, Infinity, 1),
    /must be finite/,
    'malformed collision queries no longer trigger the exact full-scan fallback'
  );
  assert.throws(
    () => queryStaticCollisionSpatialIndex(index, -1_000_000, -1_000_000, 1_000_000, 1_000_000),
    /query cell budget exceeded/,
    'huge finite collision query can scan an unbounded number of spatial cells'
  );
  let indexedCandidates = 0;
  let exhaustiveCandidates = 0;
  for (let sample = 0; sample < 240; sample++) {
    const centerX = ((sample * 37) % 181) - 90;
    const centerZ = ((sample * 61) % 181) - 90;
    const reach = 0.35 + (sample % 7) * 0.18;
    const query = {
      minX: centerX - reach,
      maxX: centerX + reach,
      minZ: centerZ - reach,
      maxZ: centerZ + reach
    };
    const expected = blockers.filter(blocker => {
      const bounds = staticCollisionBlockerBounds(blocker);
      return bounds.minX <= query.maxX
        && bounds.maxX >= query.minX
        && bounds.minZ <= query.maxZ
        && bounds.maxZ >= query.minZ;
    });
    const actual = queryStaticCollisionSpatialIndex(
      index,
      query.minX,
      query.minZ,
      query.maxX,
      query.maxZ
    );
    assert.deepStrictEqual(
      actual.map(blocker => blocker.id),
      expected.map(blocker => blocker.id),
      `static collision broad phase changed deterministic candidates for sample ${sample}`
    );
    indexedCandidates += actual.length;
    exhaustiveCandidates += blockers.length;
  }
  assert(indexedCandidates < exhaustiveCandidates * 0.04,
    `static collision broad phase is not selective enough: ${indexedCandidates}/${exhaustiveCandidates}`);

  const collisionContext = vm.createContext({
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    segmentIntersectsRotatedBlocker,
    roomStaticCollisionCandidates: (_room, minX, minZ, maxX, maxZ) => (
      queryStaticCollisionSpatialIndex(index, minX, minZ, maxX, maxZ)
    )
  });
  vm.runInContext([
    extractFunction(serverSource, 'circleIntersectsRotatedBlocker'),
    extractFunction(serverSource, 'roomStaticCollisionBlocksSegment'),
    extractFunction(serverSource, 'circleRotatedBlockerPenalty'),
    extractFunction(serverSource, 'roomStaticCollisionPenaltyAt'),
    extractFunction(serverSource, 'roomStaticCollisionBlocksCircle'),
    'this.collision = { roomStaticCollisionBlocksSegment, circleRotatedBlockerPenalty, roomStaticCollisionPenaltyAt, roomStaticCollisionBlocksCircle };'
  ].join('\n'), collisionContext);
  for (let sample = 0; sample < 360; sample++) {
    const x = ((sample * 43) % 197) - 98;
    const z = ((sample * 71) % 197) - 98;
    const radius = 0.04 + (sample % 11) * 0.075;
    const toX = x + ((sample * 29) % 31) - 15;
    const toZ = z + ((sample * 47) % 31) - 15;
    const opts = { startPadding: (sample % 4) * 0.08, endPadding: (sample % 5) * 0.07 };
    const expectedSegment = blockers.some(blocker => (
      segmentIntersectsRotatedBlocker(x, z, toX, toZ, blocker, radius, opts)
    ));
    const indexedSegment = collisionContext.collision.roomStaticCollisionBlocksSegment(
      {}, x, z, toX, toZ, radius, opts
    );
    assert.strictEqual(indexedSegment, expectedSegment,
      `static segment broad phase changed exact collision result for sample ${sample}`);

    let expectedPenalty = 0;
    for (const blocker of blockers) {
      expectedPenalty = Math.max(
        expectedPenalty,
        collisionContext.collision.circleRotatedBlockerPenalty(x, z, radius, blocker)
      );
    }
    const indexedPenalty = collisionContext.collision.roomStaticCollisionPenaltyAt({}, x, z, radius);
    assert.strictEqual(indexedPenalty, expectedPenalty,
      `static penalty broad phase changed exact collision result for sample ${sample}`);
    assert.strictEqual(
      collisionContext.collision.roomStaticCollisionBlocksCircle({}, x, z, radius),
      expectedPenalty > 0.0001,
      `static circle broad phase changed exact collision result for sample ${sample}`
    );
  }
}

function assertStaticCollisionSpatialIntegration() {
  for (const marker of [
    "require('./src/server/static-collision-spatial-index')",
    'function rebuildRoomStaticCollisionSpatialIndex(',
    'function roomStaticCollisionCandidates('
  ]) {
    assert(serverSource.includes(marker), `missing static collision spatial marker: ${marker}`);
  }

  const objects = extractFunction(serverSource, 'roomStaticCollisionObjects');
  assert(objects.includes('rebuildRoomStaticCollisionSpatialIndex(room, room.staticCollisionObjects)')
    && objects.includes('rebuildRoomStaticCollisionSpatialIndex(room, blockers)'),
  'authored static collision cache no longer keeps its spatial index synchronized');

  const segment = extractFunction(serverSource, 'roomStaticCollisionBlocksSegment');
  const penalty = extractFunction(serverSource, 'roomStaticCollisionPenaltyAt');
  const circle = extractFunction(serverSource, 'roomStaticCollisionBlocksCircle');
  assert(segment.includes('roomStaticCollisionCandidates(')
    && segment.includes('segmentIntersectsRotatedBlocker('),
  'segment collision lost its spatial broad phase or exact rotated narrow phase');
  assert(penalty.includes('roomStaticCollisionCandidates(')
    && penalty.includes('circleRotatedBlockerPenalty('),
  'static collision penalty lost its spatial broad phase or exact rotated narrow phase');
  assert(circle.includes('roomStaticCollisionCandidates(')
    && circle.includes('circleIntersectsRotatedBlocker('),
  'circle collision lost its spatial broad phase or exact rotated narrow phase');

  const walkability = extractFunction(serverSource, 'isEnemyPathTileOpen');
  assert(walkability.includes('isRoomWalkableWorld('),
    'NPC pathfinding no longer routes through authoritative room walkability');
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
  const factionUpdate = update.indexOf('updateEncounterFactionCombat(room, dt, roomPlayers, roomPlayersById)');
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
  const formationActors = extractFunction(serverSource, 'activeMeleeFormationActorIds');
  const reservation = extractFunction(serverSource, 'roomMeleeFormationReservation');
  const cacheBuilder = extractFunction(serverSource, 'rebuildRoomEnemyAiLookupCaches');
  assert(meleeGoal.includes('roomMeleeFormationReservation(room, enemy, target)')
    && reservation.includes('activeMeleeFormationActorIds(room, targetId)')
    && formationActors.includes('room?.enemyMeleeFormationActorsByTargetId instanceof Map')
    && cacheBuilder.includes('room.enemyMeleeFormationActorsByTargetId = formationActorsByTargetId;')
    && cacheBuilder.includes('reconcileNpcMeleeSlotReservations(state.slots, activeIds)')
    && !meleeGoal.includes('for (const other of room.enemies.values())'),
  'melee surround-slot selection returned to a per-attacker full room scan');

  const corpseTarget = extractFunction(serverSource, 'serverNpcCorpseLootTarget');
  assert(corpseTarget.includes('roomEnemySpatialCandidates(room, enemy.x, enemy.z, radius'),
    'NPC corpse search returned to a full room scan');

  const factionFoes = extractFunction(serverSource, 'npcHasLiveFactionFoes');
  assert(factionFoes.includes('room.enemyLiveFactionGroups instanceof Set')
    && cacheBuilder.includes('room.enemyAttackersByTargetId = attackersByTargetId;'),
  'scheduled/stationary NPC faction checks no longer reuse per-tick lookup caches');

  const update = extractFunction(serverSource, 'updateServerEnemies');
  assert(update.includes('rebuildRoomEnemyAiLookupCaches(room);')
    && update.includes('const hasLiveFoes = npcHasLiveFactionFoes(room, enemy);'),
  'active AI tick bypasses the cached crowd lookups');
}

function assertEnemyPlayerTargetLookupsAreIndexed() {
  const lookup = extractFunction(serverSource, 'roomPlayerById');
  assert(lookup.includes('roomPlayersById instanceof Map')
    && lookup.includes('roomPlayersById.get(key)'),
  'player target lookup no longer uses the per-room ID map');

  const immediateThreat = extractFunction(serverSource, 'chooseImmediatePlayerThreat');
  const factionThreat = extractFunction(serverSource, 'chooseFactionCombatPlayerThreat');
  const factionCombat = extractFunction(serverSource, 'updateEncounterFactionCombat');
  const update = extractFunction(serverSource, 'updateServerEnemies');
  assert(immediateThreat.includes('roomPlayerById(roomPlayers, roomPlayersById, currentTargetId)')
    && factionThreat.includes('roomPlayerById(roomPlayers, roomPlayersById, currentTargetId)')
    && factionCombat.includes('roomPlayersById)'),
  'one of the enemy threat paths returned to repeated linear player lookup');
  assert(update.includes('const roomPlayersById = new Map(')
    && update.includes('updateEncounterFactionCombat(room, dt, roomPlayers, roomPlayersById)')
    && (update.match(/roomPlayerById\(roomPlayers, roomPlayersById, enemy\.targetId\)/g) || []).length >= 2
    && !update.includes('roomPlayers.find('),
  'active AI tick no longer builds or consistently reuses its player ID lookup');
}

function assertCrowdEventScansAreCoalesced() {
  const factionCombat = extractFunction(serverSource, 'updateEncounterFactionCombat');
  assert(factionCombat.includes('const liveFactionGroups = new Set(')
    && factionCombat.includes('const oneFactionCrowd = liveFactionGroups.size <= 1;')
    && factionCombat.includes('const factionTarget = oneFactionCrowd')
    && factionCombat.includes(': findNearestFactionFoe(')
    && !factionCombat.includes('for (const faction of liveFactionGroups)'),
  'peaceful same-faction crowds returned to per-actor spatial foe scans');

  const noise = extractFunction(serverSource, 'addRoomNoise');
  assert.strictEqual((noise.match(/activeNoiseInvestigatorsNear\(/g) || []).length, 1,
    'one noise event rescans every NPC once per reacting NPC');
  assert(noise.includes('let activeInvestigatorsHere = activeNoiseInvestigatorsNear(')
    && noise.includes('const alreadyInvestigatingHere = activeInvestigatorsHere;')
    && noise.includes('activeInvestigatorsHere++;'),
  'noise investigator cluster count no longer preserves sequential assignments without quadratic rescans');
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

function assertCrowdedEnemyFanoutCoalescesEquivalentViews() {
  const viewers = new Map();
  for (let index = 0; index < 8; index++) {
    viewers.set(`viewer-${index}`, {
      enemyFrameVersion: 1,
      hostile: index < 4
    });
  }
  const emissions = [];
  const makeTarget = (targets, volatile = false) => ({
    get volatile() { return makeTarget(targets, true); },
    emit(event, payload) {
      emissions.push({
        targets: Array.isArray(targets) ? [...targets] : [targets],
        volatile,
        event,
        payload
      });
    }
  });
  const enemies = new Map(Array.from({ length: 12 }, (_, index) => [
    `enemy-${index}`,
    { id: `enemy-${index}`, x: index, z: -index, hp: 10 }
  ]));
  let fullRows = 0;
  let frameRows = 0;
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
      extractFunction(serverSource, 'publicEnemySnapshotForViewer'),
      extractFunction(serverSource, 'publicEnemyFrameForViewer'),
      extractFunction(serverSource, 'publicEnemyActivityDelta'),
      extractFunction(serverSource, 'syncRoomEnemyActivityRevisions'),
      extractFunction(serverSource, 'emitEnemyActivityDelta'),
      extractFunction(serverSource, 'emitFullEnemySnapshotToSockets'),
      extractFunction(serverSource, 'emitEnemySnapshot'),
      'return { emitEnemySnapshot };'
    ].join('\n')
  )(
    viewers,
    { to: targets => makeTarget(targets) },
    enemy => {
      fullRows++;
      return { id: enemy.id, hostileToPlayer: false, inventory: [{ id: 'water', qty: 1 }] };
    },
    enemy => {
      frameRows++;
      return { id: enemy.id, x: enemy.x, z: enemy.z, hp: enemy.hp, aiState: 'idle', flags: 0 };
    },
    (_enemy, viewer) => viewer.hostile === true,
    () => true,
    360,
    { now: () => 1000 }
  );
  const room = {
    id: 'crowded-room',
    locationId: 'settlement',
    sockets: new Set(viewers.keys()),
    enemies,
    lastEnemySnapshotAt: 0,
    enemyFrameSeq: 0
  };

  runtime.emitEnemySnapshot(room, false);
  assert.strictEqual(frameRows, enemies.size,
    'crowded enemy frame rebuilt base rows per viewer');
  assert.strictEqual(emissions.length, 2,
    'eight viewers with two hostility views were not coalesced into two frame encodes');
  assert(emissions.every(row => row.volatile && row.event === 'enemyFrame' && row.targets.length === 4),
    'coalesced realtime groups lost volatile transport or exact recipients');
  assert.deepStrictEqual(
    emissions.map(row => !!(row.payload.enemies[0].flags & 8)),
    [true, false],
    'coalesced frame groups lost their viewer-specific hostility overlay'
  );

  emissions.length = 0;
  runtime.emitEnemySnapshot(room, true);
  assert.strictEqual(fullRows, enemies.size,
    'crowded reliable snapshot rebuilt heavyweight base rows per viewer');
  assert.strictEqual(emissions.length, 2,
    'eight viewers with two hostility views were not coalesced into two reliable encodes');
  assert(emissions.every(row => !row.volatile && row.event === 'enemySnapshot' && row.targets.length === 4),
    'coalesced reliable groups lost exact recipients or transport reliability');
  assert.deepStrictEqual(
    emissions.map(row => row.payload.enemies[0].hostileToPlayer),
    [true, false],
    'coalesced reliable groups lost their viewer-specific hostility overlay'
  );
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
  assert(serverSource.includes('hardMovementApplied || emergencyTransitionApplied'),
    'playerState relay is no longer coupled to a bounded movement decision');
  assert(serverSource.includes('const movementTransition = p.moving !== p.lastRelayedMoving;'),
    'movement stop/start transitions are no longer relayed immediately');
  assert(serverSource.includes('const crouchingTransition = p.crouching !== p.lastRelayedCrouching;')
    && serverSource.includes('const turningTransition = p.turning !== p.lastRelayedTurning;')
    && serverSource.includes('const reliableStateTransition = movementTransition || crouchingTransition;')
    && serverSource.includes('const movementTransport = reliableStateTransition ? roomRelay : (roomRelay.volatile || roomRelay);'),
  'discrete movement/stance transitions can be dropped with volatile intermediate packets');
}

function assertMovementIngressBudgetAndMetrics() {
  assert(multiplayerClientSource.includes('const stateSendInterval = movingNow ? 0.050'),
    'moving clients no longer align their hot packet cadence with the 20Hz server relay');
  assert(multiplayerClientSource.includes('|| justStarted || justStopped)'),
    'the 20Hz cadence can delay immediate movement start/stop transitions');
  assert(multiplayerClientSource.includes('multiplayer.movementSendAccumulator - stateSendInterval'),
    'low-FPS clients quantize the 20Hz cadence down to every second rendered frame');

  const positionSource = extractFunction(serverSource, 'serverStateHasFiniteMovementPosition');
  const transitionSource = extractFunction(serverSource, 'serverMovementPacketHasReliableTransition');
  const consumeSource = extractFunction(serverSource, 'serverConsumeMovementRateToken');
  const decisionSource = extractFunction(serverSource, 'serverMovementPacketBudgetDecision');
  const emergencySource = extractFunction(serverSource, 'serverApplyEmergencyMovementTransition');
  const proposalSource = extractFunction(serverSource, 'serverApplyMovementProposal');
  const context = vm.createContext({
    MAP_SIZE: 140,
    PLAYER_SPEED: 7,
    PLAYER_COLLISION_RADIUS: 0.48,
    PLAYER_STATE_TOKEN_INTERVAL_MS: 50,
    PLAYER_STATE_TOKEN_CAPACITY: 2,
    PLAYER_TRANSITION_EMERGENCY_INTERVAL_MS: 250,
    PLAYER_TRANSITION_EMERGENCY_CAPACITY: 1,
    clamp: (value, min, max) => Math.max(min, Math.min(max, Number(value))),
    rooms: new Map(),
    isRoomTerrainWalkableWorld: () => true,
    roomStaticCollisionMoveAllowed: () => true,
    roomEnemyCollisionMoveAllowed: () => true
  });
  vm.runInContext(
    `${positionSource}\n${transitionSource}\n${consumeSource}\n${decisionSource}\n${emergencySource}\n${proposalSource}\n`
      + 'this.api = { serverStateHasFiniteMovementPosition, serverMovementPacketHasReliableTransition, serverMovementPacketBudgetDecision, serverApplyEmergencyMovementTransition, serverApplyMovementProposal };',
    context
  );
  const packet = (seq, moving = true, crouching = false) => ({
    seq, x: seq / 100, z: 2, vx: moving ? 1 : 0, vz: 0,
    angle: 0, moving, turning: false, crouching
  });

  // Reproduce the client's capped fractional accumulator at 30 FPS using the
  // same floating-point comparison. It emits ~66ms/34ms intervals while
  // remaining 20Hz long-term.
  const fractionalTimes = [1000];
  let accumulator = 0;
  for (let frame = 1; frame <= 30; frame++) {
    accumulator += 1 / 30;
    if (accumulator < 0.05) continue;
    fractionalTimes.push(1000 + Math.round(frame * 1000 / 30));
    accumulator = Math.min(0.05, Math.max(0, accumulator - 0.05));
  }
  assert(fractionalTimes.some((time, index) => index > 0 && time - fractionalTimes[index - 1] < 40),
    '30 FPS regression sequence contains no fractional short interval');
  const fractionalPlayer = { moving: false, crouching: false };
  const acceptedTimes = [];
  const relayTimes = [];
  fractionalTimes.forEach((time, index) => {
    const row = packet(index + 1, true, false);
    const decision = context.api.serverMovementPacketBudgetDecision(fractionalPlayer, row, time);
    if (!decision.hardAllowed) return;
    acceptedTimes.push(time);
    fractionalPlayer.moving = row.moving;
    fractionalPlayer.crouching = row.crouching;
    relayTimes.push(time);
  });
  assert.deepStrictEqual(acceptedTimes, fractionalTimes,
    'token credit rejects legitimate 30 FPS fractional 20Hz ingress');
  assert.deepStrictEqual(relayTimes, fractionalTimes,
    'relay budget turns the legitimate 33ms fractional frame into a 99ms gap');

  const modifiedPlayer = { moving: true, crouching: false };
  const modifiedFirst = context.api.serverMovementPacketBudgetDecision(
    modifiedPlayer,
    { ...packet(90), foo: 'bypass-attempt', hp: 9999 },
    2500
  );
  const modifiedSecond = context.api.serverMovementPacketBudgetDecision(
    modifiedPlayer,
    { ...packet(91), foo: 'bypass-attempt', hp: 9999 },
    2500
  );
  assert.strictEqual(modifiedFirst.hardAllowed, true,
    'finite positional compatibility packet did not enter the hard movement budget');
  assert.strictEqual(modifiedSecond.hardAllowed, false,
    'an extra foo/hp key bypasses the depleted hard movement budget');

  const burstPlayer = { moving: false, crouching: false, x: 0, z: 0, angle: 0, vx: 0, vz: 0 };
  let collisionProcessed = 0;
  let emergencyTransitions = 0;
  let relays = 0;
  for (let index = 0; index < 100; index++) {
    const time = 3000 + index * 5;
    const row = {
      ...packet(100 + index, index % 2 === 0, index % 3 === 0),
      x: 120,
      z: 0,
      vx: 999,
      foo: 'modified-client',
      hp: 9999
    };
    const decision = context.api.serverMovementPacketBudgetDecision(burstPlayer, row, time);
    if (decision.hardAllowed) {
      context.api.serverApplyMovementProposal(burstPlayer, row, time);
      burstPlayer.moving = row.moving;
      burstPlayer.crouching = row.crouching;
      collisionProcessed++;
      relays++;
      continue;
    }
    if (!decision.emergencyTransition) continue;
    const before = { x: burstPlayer.x, z: burstPlayer.z, angle: burstPlayer.angle };
    assert.strictEqual(context.api.serverApplyEmergencyMovementTransition(burstPlayer, row), true);
    assert.deepStrictEqual(
      { x: burstPlayer.x, z: burstPlayer.z, angle: burstPlayer.angle },
      before,
      'metadata-only transition applied the unbudgeted client position or angle'
    );
    emergencyTransitions++;
    relays++;
  }
  assert(collisionProcessed >= 9 && collisionProcessed <= 11,
    `500ms toggle flood escaped the 20Hz collision budget: ${collisionProcessed}`);
  assert(emergencyTransitions <= 3,
    `toggle flood escaped the 4Hz emergency transition budget: ${emergencyTransitions}`);
  assert(relays <= collisionProcessed + 3,
    `toggle flood escaped the combined hard/emergency relay bound: ${relays}`);
  assert(burstPlayer.x < 8,
    `unbudgeted toggle positions produced a speedhack-sized displacement: ${burstPlayer.x}`);

  const assertImmediateMetadataTransition = (label, initial, desired) => {
    const player = { x: 5, z: 7, angle: 1.25, vx: initial.moving ? 2 : 0, vz: 0, ...initial };
    const drain = packet(500, initial.moving, initial.crouching);
    assert.strictEqual(context.api.serverMovementPacketBudgetDecision(player, drain, 5000).hardAllowed, true);
    const malicious = { ...packet(501, desired.moving, desired.crouching), x: 120, z: 120, vx: 999, angle: 9 };
    const decision = context.api.serverMovementPacketBudgetDecision(player, malicious, 5000);
    assert.strictEqual(decision.hardAllowed, false, `${label}: transition received a free positional token`);
    assert.strictEqual(decision.emergencyTransition, true, `${label}: single metadata transition was delayed`);
    const beforePosition = { x: player.x, z: player.z, angle: player.angle };
    const beforeVelocity = { vx: player.vx, vz: player.vz };
    assert.strictEqual(context.api.serverApplyEmergencyMovementTransition(player, malicious), true);
    assert.deepStrictEqual({ x: player.x, z: player.z, angle: player.angle }, beforePosition,
      `${label}: emergency transition trusted client transform`);
    assert.strictEqual(player.moving, desired.moving, `${label}: moving metadata was not immediate`);
    assert.strictEqual(player.crouching, desired.crouching, `${label}: crouching metadata was not immediate`);
    if (!desired.moving) assert.strictEqual(Math.hypot(player.vx, player.vz), 0, `${label}: stop retained velocity`);
    else assert.deepStrictEqual({ vx: player.vx, vz: player.vz }, beforeVelocity,
      `${label}: emergency transition trusted client velocity`);
  };
  assertImmediateMetadataTransition('start', { moving: false, crouching: false }, { moving: true, crouching: false });
  assertImmediateMetadataTransition('stop', { moving: true, crouching: false }, { moving: false, crouching: false });
  assertImmediateMetadataTransition('crouch', { moving: true, crouching: false }, { moving: true, crouching: true });

  const stateHandlerStart = serverSource.indexOf("socket.on('state'");
  const stateHandlerEnd = serverSource.indexOf("socket.on('equipmentAction'", stateHandlerStart);
  const stateHandler = serverSource.slice(stateHandlerStart, stateHandlerEnd);
  assert(stateHandler.includes('incomingMovementSeq <= lastAcceptedSeq'),
    'duplicate movement sequences still repeat authoritative collision work');
  assert(stateHandler.includes('serverMovementPacketBudgetDecision(p, data, stateReceivedAt)')
    && stateHandler.includes('realtimeNetworkMetrics.movementPacketsRateDropped++')
    && stateHandler.includes('realtimeNetworkMetrics.movementPacketsAccepted++'),
  'movement ingress accepted/dropped counters are no longer wired to the hot path');
  assert(stateHandler.includes('serverApplyMovementProposal(p, data, stateReceivedAt)')
    && stateHandler.includes('movementProposalTotalMs')
    && stateHandler.includes('movementProposalMaxMs'),
  'authoritative movement proposal timing is no longer observable');
  assert(stateHandler.includes('playerStateFanoutDeliveries')
    && stateHandler.includes('playerStateReliableTransitions')
    && stateHandler.includes('hardMovementApplied || emergencyTransitionApplied')
    && stateHandler.includes('playerStateEmergencyTransitions++'),
  'movement fanout and reliable-transition counters are no longer observable');
  const budgetStart = stateHandler.indexOf('const movementBudget =');
  const profileStart = stateHandler.indexOf('const progressionChanged =');
  assert(budgetStart >= 0 && profileStart > budgetStart
    && !stateHandler.slice(budgetStart, profileStart).includes('return;'),
  'rate-limited positional data skips compatible profile processing');
  assert(stateHandler.includes('serverApplyEmergencyMovementTransition(p, data)')
    && !extractFunction(serverSource, 'serverApplyEmergencyMovementTransition').includes('player.x =')
    && !extractFunction(serverSource, 'serverApplyEmergencyMovementTransition').includes('player.z ='),
  'emergency transition can apply an unbudgeted client transform');
  assert(serverSource.includes('realtimeNetwork: publicRealtimeNetworkMetrics()')
    && serverSource.includes("strategy: 'tokenBucket'")
    && serverSource.includes('targetHz: PLAYER_STATE_TARGET_HZ')
    && serverSource.includes('burstPackets: PLAYER_STATE_TOKEN_CAPACITY')
    && serverSource.includes('emergencyTransitionHz: PLAYER_TRANSITION_EMERGENCY_TARGET_HZ'),
  'bounded token-credit contract is missing from /health');
}

function assertJoinRoomSnapshotsAreTargeted() {
  const groundSource = extractFunction(serverSource, 'emitGroundItemsSnapshot');
  const containerSource = extractFunction(serverSource, 'emitWorldContainersSnapshot');
  let now = 1000;
  const emissions = [];
  const metrics = { targetedRoomSnapshots: 0, avoidedRoomSnapshotDeliveries: 0 };
  const context = vm.createContext({
    Date: { now: () => now },
    realtimeNetworkMetrics: metrics,
    publicGroundItem: item => ({ ...item }),
    publicWorldContainer: item => ({ ...item }),
    io: {
      to(target) {
        return {
          emit(event, payload) { emissions.push({ target, event, payload }); }
        };
      }
    }
  });
  vm.runInContext(
    `${containerSource}\n${groundSource}\nthis.api = { emitWorldContainersSnapshot, emitGroundItemsSnapshot };`,
    context
  );
  const room = {
    id: 'crowded-room',
    locationId: 'settlement',
    sockets: new Set(['joining', 'other-a', 'other-b']),
    groundItems: new Map([['ground', { id: 'ground' }]]),
    containers: new Map([['box', { id: 'box' }]])
  };
  context.api.emitGroundItemsSnapshot(room, true, 'joining');
  context.api.emitWorldContainersSnapshot(room, true, 'joining');
  assert.deepStrictEqual(emissions.map(row => row.target), ['joining', 'joining'],
    'joining player snapshots are still broadcast to the entire crowded room');
  assert.strictEqual(room.lastGroundSnapshotAt, undefined,
    'a targeted ground snapshot consumed the room-wide cadence gate');
  assert.strictEqual(room.lastContainerSnapshotAt, undefined,
    'a targeted container snapshot consumed the room-wide cadence gate');
  assert.strictEqual(metrics.targetedRoomSnapshots, 2);
  assert.strictEqual(metrics.avoidedRoomSnapshotDeliveries, 4);

  now = 1001;
  context.api.emitGroundItemsSnapshot(room, false);
  context.api.emitWorldContainersSnapshot(room, false);
  assert.deepStrictEqual(emissions.slice(2).map(row => row.target), ['crowded-room', 'crowded-room'],
    'targeted join delivery suppressed the next legitimate room-wide snapshot');

  for (const marker of [
    'emitGroundItemsSnapshot(room, true, socket.id);',
    'emitWorldContainersSnapshot(room, true, socket.id);'
  ]) {
    const matches = serverSource.split(marker).length - 1;
    assert(matches >= 3, `${marker} is not used by join, room change, and world transfer`);
  }
  assert(serverSource.includes('emitGroundItemsSnapshot(settlement, true, p.id);')
    && serverSource.includes('emitWorldContainersSnapshot(settlement, true, p.id);'),
  'respawn still broadcasts unchanged ground/container baselines to existing players');
}

function assertPartyPersistenceIsBatched() {
  const source = extractFunction(serverSource, 'persistActivePlayerStates');
  const makeRuntime = failWrite => {
    const stores = {
      userA: {
        charA: { state: { x: 0 }, updatedAt: 1, summary: { x: 0 } },
        charB: { state: { x: 0 }, updatedAt: 1, summary: { x: 0 } }
      }
    };
    let writes = 0;
    let clock = 0;
    const context = vm.createContext({
      performance: { now: () => ++clock },
      activePlayerPersistenceMetrics: {
        writeAttempts: 0,
        writeFailures: 0,
        rowsStaged: 0,
        coalescedWritesAvoided: 0,
        writeTotalMs: 0,
        writeMaxMs: 0
      },
      normalizeCharacterId: value => String(value || ''),
      ensureUserCharacterStore: userId => stores[userId] || {},
      mergeAuthoritativeCharacterState: (current, _previous, player) => ({ ...current, x: player.x }),
      summarizeState: state => ({ x: state.x }),
      persistSaves: () => {
        writes++;
        if (failWrite) throw new Error('injected batch write failure');
      }
    });
    vm.runInContext(`${source}\nthis.persistActivePlayerStates = persistActivePlayerStates;`, context);
    return { context, stores, writes: () => writes };
  };

  const success = makeRuntime(false);
  assert.strictEqual(success.context.persistActivePlayerStates([
    { userId: 'userA', characterId: 'charA', x: 5 },
    { userId: 'userA', characterId: 'charB', x: 8 },
    { userId: 'userA', characterId: 'charA', x: 99 }
  ]), true);
  assert.strictEqual(success.writes(), 1, 'one party transition performs more than one synchronous save write');
  assert.strictEqual(success.stores.userA.charA.state.x, 5, 'duplicate party member was persisted twice');
  assert.strictEqual(success.stores.userA.charB.state.x, 8);
  assert.strictEqual(success.context.activePlayerPersistenceMetrics.coalescedWritesAvoided, 1,
    'batched party persistence does not expose its avoided synchronous write count');

  const failure = makeRuntime(true);
  const previousA = failure.stores.userA.charA.state;
  const previousB = failure.stores.userA.charB.state;
  assert.throws(() => failure.context.persistActivePlayerStates([
    { userId: 'userA', characterId: 'charA', x: 5 },
    { userId: 'userA', characterId: 'charB', x: 8 }
  ]), /injected batch write failure/);
  assert.strictEqual(failure.stores.userA.charA.state, previousA,
    'failed party persistence left the first in-memory row ahead of disk');
  assert.strictEqual(failure.stores.userA.charB.state, previousB,
    'failed party persistence left the second in-memory row ahead of disk');
  assert.strictEqual(failure.context.activePlayerPersistenceMetrics.writeFailures, 1,
    'failed active-player batch writes are not observable');

  for (const marker of [
    'persistActivePlayerStates(arrivingMembers);',
    'persistActivePlayerStates(enteringMembers);',
    'persistActivePlayerStates(cancellingMembers);',
    'persistActivePlayerStates(membersToPersist);'
  ]) assert(serverSource.includes(marker), `global travel does not use batched persistence: ${marker}`);
  assert(serverSource.includes('activePlayerPersistence: publicActivePlayerPersistenceMetrics()'),
    'active-player write latency and coalescing metrics are missing from /health');
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
    // The isolated cache harness deliberately uses synthetic model keys that are
    // not present in the production catalog. Preserve them here so the test keeps
    // exercising cache invalidation when an actor switches GLB identity.
    serverEnemyModelKeyForIdentity: actor => String(actor?.modelKey || actor?.model || actor?.visual || ''),
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

assertStaticCollisionSpatialBroadPhase();
assertStaticCollisionSpatialIntegration();
assertSpatialIntegration();
assertAdaptiveSpatialMovementPadding();
assertRemainingEnemyAiScansUseCrowdIndexes();
assertEnemyPlayerTargetLookupsAreIndexed();
assertCrowdEventScansAreCoalesced();
assertStructuralEnemyChangesStayReliable();
assertEnemyFrameCompatibilityFallback();
assertCrowdedEnemyFanoutCoalescesEquivalentViews();
assertViewerSpecificEnemyDeltas();
assertWorldStateRefreshIsCoalesced();
assertMotionPacketContract();
assertMovementIngressBudgetAndMetrics();
assertJoinRoomSnapshotsAreTargeted();
assertPartyPersistenceIsBatched();
assertPlayerSnapshotIsLazyAndVolatile();
assertCollisionCacheInvalidation();
console.log('Crowded-room performance checks passed: actor/static broad phases, collision caches, fractional 20Hz movement ingress/relay, targeted join snapshots, batched party saves, and compact volatile streams are guarded.');
