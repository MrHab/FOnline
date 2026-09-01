#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_PARTS_DIR = path.join(ROOT, 'public', 'js', 'game');
const CLIENT_PART_FILES = fs.readdirSync(CLIENT_PARTS_DIR)
  .filter(name => name.endsWith('.js'))
  .sort();
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
const clientSource = CLIENT_PART_FILES
  .map(name => fs.readFileSync(path.join(CLIENT_PARTS_DIR, name), 'utf8'))
  .join('\n');
const unityClientSource = readFilesRecursive(UNITY_CLIENT_DIR, '.cs').join('\n');

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
const serverPartyEmits = collectMatches(
  serverSource,
  /\bemitGlobalTravelToParty\(\s*[^,\n]+,\s*(['"])([^'"]+)\1/g
);
const clientHandlers = sortedUnique(collectMatches(
  clientSource,
  /\b(?:multiplayer\.socket|socket)\.(?:on|once)\(\s*(['"])([^'"]+)\1/g
));
const unityClientHandlers = sortedUnique(collectMatches(
  unityClientSource,
  /\b_connection\.On\(\s*"([^"]+)"/g,
  1
));

const clientDirectEmits = collectMatches(
  clientSource,
  /\.emit\(\s*(['"])([^'"]+)\1/g
);
const clientGuardedEmits = collectMatches(
  clientSource,
  /\bemitGuardedMultiplayerGameplayAction\(\s*(['"])([^'"]+)\1/g
);
const unityClientEmits = collectMatches(
  unityClientSource,
  /\b(?:EmitWithAck|Emit)\(\s*"([^"]+)"/g,
  1
);
const serverHandlers = sortedUnique(collectMatches(
  serverSource,
  /\bsocket\.on\(\s*(['"])([^'"]+)\1/g
));

const serverDynamicEmitArguments = collectMatches(
  serverSource,
  /\.emit\(\s*(?!['"`])([A-Za-z_$][\w$]*)/g,
  1
);
const clientDynamicEmitArguments = collectMatches(
  clientSource,
  /\.emit\(\s*(?!['"`])([A-Za-z_$][\w$]*)/g,
  1
);

assert.deepStrictEqual(
  serverDynamicEmitArguments,
  ['eventName'],
  'Every dynamic server emit must stay inside emitGlobalTravelToParty so its literal call sites can be audited'
);
assert.deepStrictEqual(
  clientDynamicEmitArguments,
  ['eventName'],
  'Every dynamic client emit must stay inside emitGuardedMultiplayerGameplayAction so its literal call sites can be audited'
);
assert.strictEqual(
  countMatches(serverSource, /\.emit\(/g),
  serverDirectEmits.length + serverDynamicEmitArguments.length,
  'The production server contains an unsupported non-literal Socket.IO emit'
);
assert.strictEqual(
  countMatches(clientSource, /\.emit\(/g),
  clientDirectEmits.length + clientDynamicEmitArguments.length,
  'The browser client contains an unsupported non-literal Socket.IO emit'
);

const serverPartyCallCount = countMatches(serverSource, /\bemitGlobalTravelToParty\(/g)
  - countMatches(serverSource, /\bfunction emitGlobalTravelToParty\(/g);
assert.strictEqual(
  serverPartyEmits.length,
  serverPartyCallCount,
  'Every emitGlobalTravelToParty call must use a literal event name'
);

const clientGuardedCallCount = countMatches(clientSource, /\bemitGuardedMultiplayerGameplayAction\(/g)
  - countMatches(clientSource, /\bfunction emitGuardedMultiplayerGameplayAction\(/g);
assert.strictEqual(
  clientGuardedEmits.length,
  clientGuardedCallCount,
  'Every emitGuardedMultiplayerGameplayAction call must use a literal event name'
);

const serverEmits = sortedUnique([...serverDirectEmits, ...serverPartyEmits]);
const clientEmits = sortedUnique([...clientDirectEmits, ...clientGuardedEmits, ...unityClientEmits]);
const clientHandlerSet = new Set([...clientHandlers, ...unityClientHandlers]);
const serverHandlerSet = new Set(serverHandlers);
const serverEventsWithoutClientHandler = serverEmits
  .filter(eventName => !clientHandlerSet.has(eventName));
const clientEventsWithoutServerHandler = clientEmits
  .filter(eventName => !serverHandlerSet.has(eventName));
const clientHandlersWithoutServerEmit = clientHandlers
  .filter(eventName => !serverEmits.includes(eventName));
const serverHandlersWithoutClientEmit = serverHandlers
  .filter(eventName => !clientEmits.includes(eventName));

assert.deepStrictEqual(
  serverEventsWithoutClientHandler,
  [],
  `Production server emits event(s) without a shipped-client handler: ${serverEventsWithoutClientHandler.join(', ')}`
);
assert.deepStrictEqual(
  clientEventsWithoutServerHandler,
  [],
  `Shipped client emits event(s) without a production server handler: ${clientEventsWithoutServerHandler.join(', ')}`
);
assert.deepStrictEqual(
  clientHandlersWithoutServerEmit,
  ['connect', 'connect_error', 'disconnect'],
  'Browser handlers without a production server emit must stay limited to Socket.IO transport lifecycle events'
);
assert.deepStrictEqual(
  serverHandlersWithoutClientEmit,
  [
    'changeRoom',
    'disconnect',
    'globalMapCreateAmbush',
    'input',
    'worldTaskJoinParty',
    'worldTaskLeaveParty'
  ],
  'Server handlers without a current shipped-client emit must stay limited to transport and documented compatibility events'
);

console.log(
  `Socket event contract OK: ${serverEmits.length} server event(s), `
  + `${clientEmits.length} client event(s), ${serverHandlers.length} server handler(s), `
  + `${clientHandlers.length} browser handler(s), ${CLIENT_PART_FILES.length} browser part(s) and Unity scripts audited`
);
