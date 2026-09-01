#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PENDING_LOCATION_TRANSITION_TTL_MS,
  sanitizePendingLocationTransition,
  stagePendingLocationTransition
} = require('../src/server/global-arrival-transition');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const server = read('server.js');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const map = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const probe = read('unity-client/Assets/Editor/RoaJourneyFlowProbe.cs');
const meta = read('unity-client/Assets/Editor/RoaJourneyFlowProbe.cs.meta');
const audit = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const docs = read('docs/UNITY_PORT.md');
const pkg = JSON.parse(read('package.json'));

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

[
  "pendingWorldDrop: sanitizePendingLocationTransition(p.pendingLocationTransition, serverNow)",
  'stagePendingLocationTransition(member, {',
  'member.onGlobalMap = true;',
  'pendingLocationTransition: savedPendingLocationTransition',
  'if (!p.attachedPartyTaskId && !p.pendingLocationTransition)',
  'persistActivePlayerStates([p]);',
  '&& !transitionTicket && !sameLocation'
].forEach(contract => assert(server.includes(contract),
  `server journey-flow contract is missing: ${contract}`));

[
  'public const float GameplayAckTimeoutSeconds = 10f;',
  'public void EmitWithAck(string eventName, object payload, float timeoutSeconds, Action<JObject> onAck)',
  'AckFailure(eventName, false, true)',
  'ExpirePendingAcks();',
  'FailPendingAcks(false, true);',
  'if (!_pendingAcks.TryGetValue(requestId, out request)) return;'
].forEach(contract => assert(socket.includes(contract),
  `Unity ACK watchdog is missing: ${contract}`));

[
  'RestorePendingLocationEntry(pendingDrop);',
  'if (_pendingEntry) ResumePendingLocationEntry();',
  'ShouldAutoRetryLocationEntry(_locationEntryAttempts, true)',
  'LocationEntryFailureRetryable(ack)',
  'roomId = arrival["encounterRoomId"]?.ToString()',
  'deviceType = Application.isMobilePlatform ? "mobile" : "desktop"',
  'TokenTrue(ack["ok"])'
].forEach(contract => assert(map.includes(contract),
  `Unity arrival recovery is missing: ${contract}`));

assert(probe.includes('[MenuItem("Realm of Ashes/Проверить Journey Flow 5.2")]')
  && probe.includes('AckRequestExpired')
  && probe.includes('ShouldAutoRetryLocationEntry'),
  'Journey Flow 5.2 probe is incomplete');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\s*$/m.test(meta),
  'Journey Flow probe meta is missing or malformed');
assert(audit.includes('typeof(RoaJourneyFlowProbe)'),
  'full Unity audit does not include Journey Flow 5.2');
assert(docs.includes('## Journey Flow 5.2'),
  'Journey Flow 5.2 is undocumented');
assert(pkg.scripts['check:unity-journey-flow']
  && pkg.scripts.precheck.includes('check:unity-journey-flow'),
  'Journey Flow checker is not wired into npm precheck');

console.log('Unity Journey Flow 5.2 OK: bounded ACKs, durable arrival ticket, reconnect recovery and idempotent entry');
