#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const server = read('server.js');
const map = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const partyCheck = read('tools/check-world-party-integrity.js');
const activityRuntime = read('src/server/world-activity-runtime.js');

function body(source, name, next = '\nfunction ') {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const end = source.indexOf(next, start + 10);
  return source.slice(start, end < 0 ? source.length : end);
}

const restore = body(server, 'serverRestoredGlobalTravelSession');
assert(restore.includes('travel.serverAuthoritative !== true'), 'client-authored routes can be restored');
assert(restore.includes('routePoints') && restore.includes('arrivalAt') && restore.includes('targetWorldSiteId'),
  'saved route identity/timing is incomplete');
assert(server.includes('const restoredTravel = serverRestoredGlobalTravelSession(p, savedGlobalMap, startedAt)'),
  'join does not restore an authoritative route');

const contact = body(server, 'serverGlobalTravelEncounterContact');
assert(contact.includes('serverGlobalTravelCurrentPoint(session, now)'), 'contact is not checked against route position');
assert(contact.includes('serverGlobalZoneVisible(row)') && contact.includes('state.parties?.[id]'),
  'server does not validate both zone and party contacts');

const handlerStart = server.indexOf("socket.on('globalTravelEncounterDecision'");
const handlerEnd = server.indexOf("socket.on('worldTaskJoinParty'", handlerStart);
const handler = server.slice(handlerStart, handlerEnd);
assert(handler.includes('serverGlobalTravelEncounterContact(session, encounterId, now)'),
  'encounter decision trusts a client contact');
assert(!handler.includes('safeName(data.title'), 'encounter title is still client-authored');
assert(handler.includes('SERVER_GLOBAL_ENCOUNTER_DECISION_MS')
  && handler.includes('scheduleServerGlobalTravelEncounterTimeout(session)'),
  'leader decision has no finite server timer');
assert(handler.includes("!['enter', 'skip'].includes(decision)"), 'server accepts unsupported encounter decisions');
assert(server.includes('session?.pendingEncounter?.pauseAt'), 'route does not pause while the leader decides');
assert(map.includes('leaderDecisionTimeout') && map.includes('Время решения истекло.'),
  'Unity does not clear a timed-out decision');

assert(partyCheck.includes('leader disconnect retained a dead global travel session')
  && partyCheck.includes("arrivalHandler.indexOf('session.terminating = true')")
  && partyCheck.includes('successful retry joined the target room more than once'),
  'travel regression suite lacks disconnect/single-arrival/atomic-transfer scenarios');
assert(activityRuntime.includes('function worldActivityRewardCharacterIds(activity)')
  && activityRuntime.includes('(activity?.participants || []).map(row => row.characterId)'),
  'world activities have no participant-bound reward authority');

console.log('KRM-18 travel authority OK: persisted routes, validated contacts, leader timeout and group integrity are guarded.');
