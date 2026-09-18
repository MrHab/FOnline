#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  DEFAULT_PENDING_LOCATION_TRANSITION_TTL_MS,
  sanitizePendingLocationTransition,
  stagePendingLocationTransition
} = require('../src/server/global-arrival-transition');


const now = 10_000;
const player = { onGlobalMap: false, pendingLocationTransition: null };
const staged = stagePendingLocationTransition(player, {
  targetLocationId: 'old_klim',
  roomId: 'old_klim#assault-01',
  worldZoneId: 'zone-1',
  partyId: 'party-1',
  siteId: 'old_klim_gate',
  encounterId: 'assault_diversion',
  encounter: true,
  pvpMode: 'pvp',
  worldPoint: { x: 34.5, y: 61.25 },
  entryKey: 'entryFromWorld'
}, now);

assert(staged && player.onGlobalMap === true,
  'phase-one arrival must keep the character recoverable on the world map');
assert.strictEqual(staged.locationId, 'old_klim',
  'browser-compatible pendingWorldDrop locationId is missing');
assert.strictEqual(staged.targetLocationId, 'old_klim',
  'Unity/server targetLocationId is missing');
assert.strictEqual(staged.roomId, 'old_klim#assault-01',
  'ephemeral room id was damaged while making the transition durable');
assert.strictEqual(staged.expiresAt, now + DEFAULT_PENDING_LOCATION_TRANSITION_TTL_MS,
  'arrival recovery window is not the documented bounded TTL');
assert(sanitizePendingLocationTransition(staged, staged.expiresAt - 1),
  'valid transition expired too early');
assert.strictEqual(sanitizePendingLocationTransition(staged, staged.expiresAt), null,
  'expired transition became reusable');
assert.strictEqual(sanitizePendingLocationTransition({
  targetLocationId: 'old_klim',
  worldPoint: { x: 'bad', y: 1 },
  expiresAt: now + 1000
}, now), null, 'malformed world point became a valid transition');

console.log('Journey flow OK: durable arrival ticket with a bounded TTL and strict validation');
