#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createWorldActivityEncounterLayout,
  selectWorldActivityEncounterWave
} = require('../src/server/world-activity-layout');
const {
  createOutpostDefense,
  applyWorldActivityEnemyKill
} = require('../src/server/world-activity-runtime');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const server = read('server.js');
const runtime = read('src/server/world-activity-runtime.js');
const navigation = read('unity-client/Assets/Scripts/Game/RoaWorldActivityNavigation.cs');
const canvas = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs');
const minimap = read('unity-client/Assets/Scripts/Game/RoaMinimap.cs');
const mapWindow = read('unity-client/Assets/Scripts/Game/RoaMapWindowCanvas.cs');
const zoneMarker = read('unity-client/Assets/Scripts/Game/RoaActivityZoneMarker.cs');
const probe = read('unity-client/Assets/Editor/RoaEncounterLayoutProbe.cs');
const audit = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const pkg = JSON.parse(read('package.json'));

const layout = createWorldActivityEncounterLayout({
  bounds: { minX: 8, minZ: 8, maxX: 47, maxZ: 47 },
  seed: 'encounter_layout_audit',
  resolveSafeTile: (tx, tz) => ({ tx, tz }),
  tileToWorld: (tx, tz) => ({ x: tx * 2, z: tz * 2 })
});
assert(layout && layout.lanes.length === 4,
  'four readable activity approach lanes were not authored');
assert(layout.objectiveBounds.width < 40 && layout.objectiveBounds.height < 40,
  'activity objectives are still scattered over the complete location');
const compactLayout = createWorldActivityEncounterLayout({
  bounds: { minX: 0, minZ: 0, maxX: 7, maxZ: 7 },
  seed: 'compact_encounter',
  resolveSafeTile: (tx, tz) => ({ tx, tz }),
  tileToWorld: (tx, tz) => ({ x: tx * 2, z: tz * 2 })
});
assert(compactLayout && compactLayout.lanes.length === 4,
  'compact 8x8 locations lose one or more authored approach lanes');
const coverAwareLayout = createWorldActivityEncounterLayout({
  bounds: { minX: 0, minZ: 0, maxX: 39, maxZ: 39 },
  seed: 'cover_aware_encounter',
  resolveSafeTile: (tx, tz) => ({ tx, tz }),
  scoreFocusTile: (tx, tz) => tx > 20 && tz > 20 ? 100 : 0,
  tileToWorld: (tx, tz) => ({ x: tx * 2, z: tz * 2 })
});
assert(coverAwareLayout.focus.tx > 20 && coverAwareLayout.focus.tz > 20,
  'encounter focus ignores the authored nearby-cover score');

const activity = createOutpostDefense({
  taskId: 'encounter_layout_audit', target: 6, maxTarget: 9,
  encounter: layout, now: 100000
});
const first = selectWorldActivityEncounterWave(activity, activity.encounter);
applyWorldActivityEnemyKill(activity, { enemyId: 'lane_target_1', now: 101000 });
applyWorldActivityEnemyKill(activity, { enemyId: 'lane_target_2', now: 102000 });
const second = selectWorldActivityEncounterWave(activity, activity.encounter);
assert(first && second && first.waveNumber === 1 && second.waveNumber === 2
  && first.lane.id !== second.lane.id,
'authored kill thresholds no longer advance the attack direction');
for (let index = 3; index <= 9; index += 1)
  applyWorldActivityEnemyKill(activity, { enemyId: `lane_target_${index}`, now: 100000 + index * 1000 });
assert.strictEqual(selectWorldActivityEncounterWave(activity, activity.encounter), null,
  'completed maximum still advertises an incoming attack lane');

assert(runtime.includes('encounter: normalizeEncounterLayout(row.encounter)')
  && runtime.includes('encounter: activity.encounter ?'),
'authoritative activity snapshots lost the staged encounter layout');
assert(server.includes('function serverWorldActivityEncounterLayout')
  && server.includes('function serverWorldActivityFocusScore')
  && server.includes('scoreFocusTile: (tx, tz) => serverWorldActivityFocusScore(room, tx, tz)')
  && server.includes('function updateServerWorldActivityEncounter')
  && server.includes('requirePreferredSpawn: !!candidate')
  && server.includes('opts.requirePreferredSpawn === true'),
'server combatants can fall back to an unrelated random location');
assert(server.includes('serverWorldActivityReconPoints(room, 8, activity.encounter)')
  && server.includes('serverWorldActivityOperationPoints(room, sabotagePoints, encounter)'),
'recovered or authored objectives are no longer constrained to the staged operation zone');

assert(canvas.includes('EncounterStatusText(_activity)')
  && canvas.includes('CreateActivityWorldBeacon("AttackLane:"')
  && canvas.includes('AddComponent<RoaActivityZoneMarker>().Configure(radius, Accent)')
  && canvas.includes('новое направление атаки'),
'Unity HUD/world presentation lost the active attack lane');
assert(zoneMarker.includes('public sealed class RoaActivityZoneMarker')
  && zoneMarker.includes('private const int Segments = 72;')
  && !zoneMarker.includes('AddComponent<Collider>'),
'staged activity area lost its bounded collider-free world perimeter');
assert(navigation.includes('new WorldLabelFrame("attack_lane"')
  && navigation.includes('RoaMinimap.MarkerKind.Threat'),
'world labels or minimap no longer show the incoming threat direction');
assert(minimap.includes('Threat,') && minimap.includes('case MarkerKind.Threat:')
  && mapWindow.includes('case RoaMinimap.MarkerKind.Threat:'),
'threat lane has no distinct minimap/full-map presentation');
assert(probe.includes('[ENCOUNTER LAYOUT 5.4] готово')
  && audit.includes('typeof(RoaEncounterLayoutProbe)'),
'Encounter Layout 5.4 is not covered by the mandatory Unity audit');
assert(pkg.scripts['check:unity-encounter-layout']
  && pkg.scripts.precheck.includes('check:unity-encounter-layout'),
'Encounter Layout 5.4 is absent from the repository verification chain');

console.log('Encounter Layout 5.4 check passed: compact objectives, directed waves, world labels and threat maps are protected.');
