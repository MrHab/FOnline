#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const server = read('server.js');
const director = read('src/server/world-activity-director.js');
const runtime = read('src/server/world-activity-runtime.js');
const canvas = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs');
const probe = read('unity-client/Assets/Editor/RoaMissionDirectorProbe.cs');
const audit = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const pkg = JSON.parse(read('package.json'));

for (const type of [
  'escort_caravan',
  'distress_signal',
  'recon_expedition',
  'resource_expedition',
  'outpost_defense',
  'assault_diversion'
]) {
  assert(server.includes(`'${type}'`), `playable activity contract lost ${type}`);
}

assert(director.includes("const WORLD_ACTIVITY_DIRECTOR_SCHEMA = 'realm.worldActivityDirector.v1';")
  && director.includes('function planWorldActivityDirector')
  && director.includes('remainingRequired')
  && director.includes('spawnCount')
  && director.includes('recoveryNeeded'),
'the server mission director no longer guarantees a recoverable combat budget');
assert(runtime.includes('lastProgressAt:')
  && runtime.includes('stageStartedAt:')
  && runtime.includes('director: activity.director ?'),
'activity snapshots lost their stage/progress/director lifecycle state');
assert(server.includes('function recoverServerWorldActivityPoints')
  && server.includes('function spawnServerWorldActivityCombatants')
  && server.includes('function updateServerWorldActivityDirector')
  && server.includes('updateServerWorldActivityDirector(room, now, { immediate: true });'),
'the authoritative room loop no longer repairs lost points or combat targets');
assert(server.includes('const preferredTask = selectRoomWorldActivityTask')
  && server.includes('Empty/stale room activities must never mask'),
'a stale room activity can mask the operation tracked by an arriving player');
assert(server.includes("if (['outpost_defense', 'distress_signal', 'assault_diversion'].includes(activity.kind)) return 0;"),
'legacy threat waves can double-spawn combat objectives outside the director');

assert(canvas.includes('MissionDirectorTransitionMessage(_activity, next)')
  && canvas.includes('MissionTimeWarningLevel(seconds)')
  && canvas.includes('ЦЕЛЬ ВОССТАНОВЛЕНА')
  && canvas.includes('ОСТАЛОСЬ 15 СЕКУНД'),
'Unity HUD no longer announces repaired stages or terminal time pressure');
assert(probe.includes('[MISSION DIRECTOR 5.3] готово')
  && probe.includes('MissionDirectorTransitionMessage')
  && probe.includes('MissionTimeWarningLevel(60f) == 1'),
'Mission Director 5.3 editor probe lost its transition/timer assertions');
assert(audit.includes('typeof(RoaMissionDirectorProbe)'),
'full Unity audit does not include Mission Director 5.3');
assert(pkg.scripts['check:unity-mission-director']
  && pkg.scripts.precheck.includes('check:unity-mission-director'),
'Mission Director 5.3 is not wired into the repository verification chain');

console.log('Mission Director 5.3 check passed: six activity paths, recovery pacing and Unity stage feedback are protected.');
