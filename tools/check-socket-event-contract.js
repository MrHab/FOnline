#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UNITY_CLIENT_DIR = path.join(ROOT, 'unity-client', 'Assets', 'Scripts');

function readFilesRecursive(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? readFilesRecursive(target, extension)
      : entry.name.endsWith(extension) ? [fs.readFileSync(target, 'utf8')] : [];
  });
}

const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const unityClientSource = readFilesRecursive(UNITY_CLIENT_DIR, '.cs').join('\n');
assert(unityClientSource, 'Unity client scripts were not found');

function collectMatches(source, pattern, eventGroup = 2) {
  const matches = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) matches.push(match[eventGroup]);
  return matches;
}

function countMatches(source, pattern) {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(source) !== null) count += 1;
  return count;
}

function sortedUnique(events) {
  return [...new Set(events)].sort();
}

const serverDirectEmits = collectMatches(
  serverSource,
  /\.emit\(\s*(['"])([^'"]+)\1/g
);
const unityClientHandlers = sortedUnique(collectMatches(
  unityClientSource,
  /\b_connection\.On\(\s*"([^"]+)"/g,
  1
));

// Unity sends through RoaSocketClient.Emit/EmitWithAck; join/state use the lower
// transport (EmitAsync) directly. The same detection as
// check-unity-client-parity.js, which also audits the closed domains of the
// runtime-chosen events below (corpse/container loot, terminal/lock security,
// NPC trade) and fails on any other dynamic EmitWithAck call site.
const unityClientLiteralEmits = [];
for (const match of unityClientSource.matchAll(
  /\b(?:Socket\.)?Emit(?:WithAck)?\(\s*"([^"]+)"|\b[A-Za-z_][A-Za-z0-9_]*\.EmitAsync\(\s*"([^"]+)"/g
)) unityClientLiteralEmits.push(match[1] || match[2]);
const unityDynamicEmits = [
  'lootEnemy', 'lootWorldContainer',
  'hackTerminal', 'pickLock',
  'npcTradeExchange'
];
const serverHandlers = sortedUnique(collectMatches(
  serverSource,
  /\bsocket\.on\(\s*(['"])([^'"]+)\1/g
));

assert.strictEqual(
  countMatches(serverSource, /\.emit\(/g),
  serverDirectEmits.length,
  'Every server Socket.IO emit must name its event literally so the contract can be audited'
);

const serverEmits = sortedUnique(serverDirectEmits);
const clientEmits = sortedUnique([...unityClientLiteralEmits, ...unityDynamicEmits]);
const clientHandlerSet = new Set(unityClientHandlers);
const serverHandlerSet = new Set(serverHandlers);
const serverEventsWithoutClientHandler = serverEmits
  .filter(eventName => !clientHandlerSet.has(eventName));
const clientEventsWithoutServerHandler = clientEmits
  .filter(eventName => !serverHandlerSet.has(eventName));
const clientHandlersWithoutServerEmit = unityClientHandlers
  .filter(eventName => !serverEmits.includes(eventName));
const serverHandlersWithoutClientEmit = serverHandlers
  .filter(eventName => !clientEmits.includes(eventName));

assert.deepStrictEqual(
  serverEventsWithoutClientHandler,
  [],
  `Production server emits event(s) without a Unity client handler: ${serverEventsWithoutClientHandler.join(', ')}`
);
assert.deepStrictEqual(
  clientEventsWithoutServerHandler,
  [],
  `Unity client emits event(s) without a production server handler: ${clientEventsWithoutServerHandler.join(', ')}`
);
assert.deepStrictEqual(
  clientHandlersWithoutServerEmit,
  [],
  'Unity handlers without a production server emit are dead; Socket.IO transport lifecycle uses the '
    + `OnConnected/OnConnectError/OnDisconnected callbacks: ${clientHandlersWithoutServerEmit.join(', ')}`
);
assert.deepStrictEqual(
  serverHandlersWithoutClientEmit,
  [
    'changeRoom',
    'disconnect',
    'input',
    'qaTravel',
    'worldTaskJoinParty',
    'worldTaskLeaveParty'
  ],
  'Server handlers without a current Unity client emit must stay limited to transport and documented compatibility events'
);

console.log(
  `Socket event contract OK: ${serverEmits.length} server event(s), `
  + `${clientEmits.length} Unity event(s), ${serverHandlers.length} server handler(s), `
  + `${unityClientHandlers.length} Unity handler(s) audited`
);
