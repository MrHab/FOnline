#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  createWorldActivityEncounterLayout,
  selectWorldActivityEncounterWave
} = require('../src/server/world-activity-layout');
const {
  createOutpostDefense,
  applyWorldActivityEnemyKill
} = require('../src/server/world-activity-runtime');


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

console.log('Encounter layout OK: compact objectives, four lanes and directed waves');
