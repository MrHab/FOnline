#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  pruneIdleRooms,
  resolveEphemeralRoomIdleTtlMs,
  temporaryRoomContextIsResumable
} = require('../src/server/room-lifecycle');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function room(options = {}) {
  return {
    id: options.id || 'room',
    sockets: new Set(options.sockets || []),
    createdAt: options.createdAt || 1,
    emptySince: options.emptySince || 0,
    disposable: options.disposable === true,
    activeOwner: options.activeOwner === true
  };
}

function assertTemporaryContextRules() {
  assert.strictEqual(
    temporaryRoomContextIsResumable({ temporaryLocation: false }),
    true,
    'normal authored locations unexpectedly require a temporary room context'
  );
  assert.strictEqual(
    temporaryRoomContextIsResumable({ temporaryLocation: true }),
    false,
    'a temporary location without a room id can be resumed'
  );
  assert.strictEqual(
    temporaryRoomContextIsResumable({
      temporaryLocation: true,
      roomId: 'randomRuinedRoad#legacy',
      roomExists: true
    }),
    true,
    'an existing legacy temporary room cannot reconnect'
  );
  assert.strictEqual(
    temporaryRoomContextIsResumable({
      temporaryLocation: true,
      roomId: 'randomRuinedRoad#pruned'
    }),
    false,
    'a pruned legacy temporary room can be resurrected by reconnect'
  );
  assert.strictEqual(
    temporaryRoomContextIsResumable({
      temporaryLocation: true,
      roomId: 'randomRuinedRoad#active',
      worldZoneId: 'zone_active',
      activeWorldZone: { id: 'zone_active', status: 'active' }
    }),
    true,
    'an active world-zone room cannot reconnect'
  );
  assert.strictEqual(
    temporaryRoomContextIsResumable({
      temporaryLocation: true,
      roomId: 'randomRuinedRoad#expired',
      worldZoneId: 'zone_expired',
      activeWorldZone: null
    }),
    false,
    'an expired world-zone room can be resurrected by reconnect'
  );
}

function assertIdleTtlRules() {
  assert.strictEqual(
    resolveEphemeralRoomIdleTtlMs({ sessionLockMs: 120_000 }),
    900_000,
    'the default room TTL changed'
  );
  assert.strictEqual(
    resolveEphemeralRoomIdleTtlMs({ configuredTtlMs: -1, sessionLockMs: -1 }),
    900_000,
    'invalid negative configuration bypasses the safe default'
  );
  assert.strictEqual(
    resolveEphemeralRoomIdleTtlMs({ configuredTtlMs: 1, sessionLockMs: 120_000 }),
    240_000,
    'configuration can shorten the reconnect safety floor'
  );
  assert.strictEqual(
    resolveEphemeralRoomIdleTtlMs({ configuredTtlMs: 300_000, sessionLockMs: 360_000 }),
    720_000,
    'room cleanup can precede the session reconnect guard'
  );
}

function assertIdleRoomPruning() {
  const now = 1_000_000;
  const ttl = 60_000;
  const rooms = new Map([
    ['shared', room({ id: 'shared', emptySince: 1, disposable: false })],
    ['occupied', room({ id: 'occupied', emptySince: 1, disposable: true, sockets: ['socket-1'] })],
    ['recent', room({ id: 'recent', emptySince: now - ttl + 1, disposable: true })],
    ['active', room({ id: 'active', emptySince: 1, disposable: true, activeOwner: true })],
    ['expired', room({ id: 'expired', emptySince: now - ttl, disposable: true })],
    ['never-used', room({ id: 'never-used', createdAt: now - ttl - 1, disposable: true })]
  ]);

  const removed = pruneIdleRooms(rooms, {
    now,
    idleTtlMs: ttl,
    shouldPruneRoom: candidate => candidate.disposable === true,
    hasActiveOwner: candidate => candidate.activeOwner === true
  });

  assert.deepStrictEqual(removed, ['expired', 'never-used']);
  assert.deepStrictEqual([...rooms.keys()], ['shared', 'occupied', 'recent', 'active']);
}

function assertProductionIntegration() {
  for (const snippet of [
    'temporaryRoomContextIsResumable({',
    'function pruneExpiredEphemeralRooms(',
    'pruneExpiredEphemeralRooms(Date.now());',
    'roomExists: rooms.has(savedTemporaryRoomId),',
    'room.emptySince = Date.now();',
    'room.emptySince = 0;'
  ]) {
    assert(serverSource.includes(snippet), `production server is missing room lifecycle integration: ${snippet}`);
  }
  const pruneStart = serverSource.indexOf('function pruneExpiredEphemeralRooms(');
  const pruneEnd = serverSource.indexOf('\nfunction invalidateRoomsForLocation(', pruneStart);
  const pruneSource = serverSource.slice(pruneStart, pruneEnd);
  assert(pruneSource.includes('!locationUsesSharedReality(loc)'),
    'production room pruning can delete a shared location reality');
  assert(pruneSource.includes('hasActiveOwner: roomHasActiveWorldOwner'),
    'production room pruning does not preserve an active world-zone owner');
}

assertTemporaryContextRules();
assertIdleTtlRules();
assertIdleRoomPruning();
assertProductionIntegration();
console.log('Room lifecycle checks passed: stale reconnects are rejected and inactive encounter rooms are pruned safely.');
