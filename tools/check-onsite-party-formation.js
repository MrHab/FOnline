#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ONSITE_PARTY_LANE_SPACING,
  onsitePartyLaneOffset,
  onsitePartyWorkOffset,
  orientOnsitePartyOffset
} = require('../src/server/onsite-party-formation');

const ROOT = path.resolve(__dirname, '..');

function distance(a, b) {
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.z || 0) - Number(b.z || 0));
}

function minimumPairDistance(points) {
  let minimum = Infinity;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      minimum = Math.min(minimum, distance(points[left], points[right]));
    }
  }
  return minimum;
}

const lanes = Array.from({ length: 7 }, (_, index) => onsitePartyLaneOffset(index));
assert.deepStrictEqual(lanes.slice(0, 5), [0, -ONSITE_PARTY_LANE_SPACING, ONSITE_PARTY_LANE_SPACING, -ONSITE_PARTY_LANE_SPACING * 2, ONSITE_PARTY_LANE_SPACING * 2], 'formation does not open from the leader outwards');
assert.strictEqual(new Set(lanes.map(value => value.toFixed(3))).size, lanes.length, 'entry or exit lanes overlap');
const sortedLanes = [...lanes].sort((a, b) => a - b);
for (let index = 1; index < sortedLanes.length; index += 1) {
  assert(sortedLanes[index] - sortedLanes[index - 1] >= 1.4, 'adjacent entry lanes are too close');
}

const base = { x: 20, z: 18 };
const approach = { x: 20, z: 2 };
const workPoints = Array.from({ length: 7 }, (_, index) => orientOnsitePartyOffset(base, approach, onsitePartyWorkOffset(index)));
assert(minimumPairDistance(workPoints) >= 2.04, 'onsite work formation still allows actors to stand shoulder-to-shoulder');
assert(distance(workPoints[0], base) >= 1.79, 'formation leader overlaps the authored interaction anchor');
assert(workPoints.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)), 'formation produced non-finite coordinates');
assert.deepStrictEqual(onsitePartyWorkOffset(6), onsitePartyWorkOffset(6), 'formation is not deterministic');
assert.notDeepStrictEqual(onsitePartyWorkOffset(7), onsitePartyWorkOffset(11), 'overflow formation slots repeat');

const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
assert(serverSource.includes("require('./src/server/onsite-party-formation')"), 'server does not use the authoritative onsite formation module');
assert(serverSource.includes('onsitePartyLaneOffset(index)'), 'server routes do not use unique formation lanes');
assert(serverSource.includes('enemy.x = onsiteRoute.entry.x;'), 'onsite actors lose their exact lane position to tile quantization');
assert(serverSource.includes('orientOnsitePartyOffset(base, entryPoint, onsitePartyWorkOffset(index))'), 'server work points do not use the spaced formation');
assert(!serverSource.includes('const spread = ((index % 5) - 2) * 0.72;'), 'legacy repeating five-lane spread is still active');

console.log(`[onsite-formation] ok: ${lanes.length} unique lanes, minimum work spacing ${minimumPairDistance(workPoints).toFixed(2)}m`);
