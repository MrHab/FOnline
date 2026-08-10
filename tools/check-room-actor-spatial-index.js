#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildRoomActorSpatialIndex,
  queryRoomActorSpatialIndex,
  spatialCellCoordinate
} = require('../src/server/room-actor-spatial-index');

function actor(id, x, z, extra = {}) {
  return { id, x, z, hp: 100, dead: false, ...extra };
}

function assertNegativeCoordinatesAndBoundaries() {
  assert.strictEqual(spatialCellCoordinate(-0.001, 8), -1);
  assert.strictEqual(spatialCellCoordinate(-8, 8), -1);
  assert.strictEqual(spatialCellCoordinate(-8.001, 8), -2);
  assert.strictEqual(spatialCellCoordinate(0, 8), 0);

  const rows = [
    actor('negative-near-zero', -0.001, -0.001),
    actor('positive-boundary', 8, 0),
    actor('negative-boundary', -8, 0),
    actor('negative-beyond', -8.001, 0)
  ];
  const index = buildRoomActorSpatialIndex(rows, { cellSize: 8 });
  const nearby = queryRoomActorSpatialIndex(index, -8, 0, 0.01);
  assert(nearby.includes(rows[2]), 'actor on a negative cell boundary was lost');
  assert(nearby.includes(rows[3]), 'actor immediately beyond a negative cell boundary was lost');
}

function assertDeduplicationExclusionAndStableOrder() {
  const first = actor('first', 9, 0);
  const second = actor('second', -9, 0);
  const third = actor('third', 1, 0);
  const duplicateId = actor('second', 0, 0);
  const deadDuplicateBeforeLive = actor('first-living-copy', 0, 0, { dead: true });
  const liveAfterDeadDuplicate = actor('first-living-copy', 2, 0);
  const index = buildRoomActorSpatialIndex(
    [first, second, first, third, duplicateId, deadDuplicateBeforeLive, liveAfterDeadDuplicate],
    { cellSize: 8 }
  );

  assert.strictEqual(index.size, 4, 'duplicate object or actor id was indexed twice');
  assert.deepStrictEqual(
    queryRoomActorSpatialIndex(index, 0, 0, 20),
    [first, second, third, liveAfterDeadDuplicate],
    'query order does not match stable source iteration order'
  );
  assert.deepStrictEqual(
    queryRoomActorSpatialIndex(index, 0, 0, 20, { excludeActor: second, excludeId: 'third' }),
    [first, liveAfterDeadDuplicate],
    'object/id exclusions were not both applied'
  );
  assert.deepStrictEqual(
    queryRoomActorSpatialIndex(index, 0, 0, 20, { exclude: first }),
    [second, third, liveAfterDeadDuplicate],
    'the object shorthand exclusion failed'
  );
  assert.deepStrictEqual(
    queryRoomActorSpatialIndex(index, 0, 0, 20, { exclude: 'second' }),
    [first, third, liveAfterDeadDuplicate],
    'the id shorthand exclusion failed'
  );
}

function assertLivingFilteringAndRebuild() {
  const moving = actor('moving', 60, 60);
  const dead = actor('dead', 0, 0, { dead: true });
  const zeroHp = actor('zero-hp', 0, 0, { hp: 0 });
  const removed = actor('removed', 0, 0, { _removed: true });
  const becomesDead = actor('becomes-dead', 1, 1);
  const before = buildRoomActorSpatialIndex([moving, dead, zeroHp, removed, becomesDead], { cellSize: 6 });

  assert.strictEqual(before.size, 2, 'dead, removed, or zero-hp actors entered the index');
  becomesDead.dead = true;
  assert(!queryRoomActorSpatialIndex(before, 0, 0, 3).includes(becomesDead),
    'an actor that died after build remained queryable');
  moving.x = 1;
  moving.z = -1;
  assert(!queryRoomActorSpatialIndex(before, 0, 0, 3).includes(moving),
    'a moved actor unexpectedly changed cells without a rebuild');
  const after = buildRoomActorSpatialIndex([moving, becomesDead], { cellSize: 6 });
  assert.deepStrictEqual(queryRoomActorSpatialIndex(after, 0, 0, 3), [moving],
    'move + rebuild did not update spatial membership');
}

function assertPaddingExpandsCandidateCoverage() {
  const edge = actor('padded-edge', 3, 0);
  const index = buildRoomActorSpatialIndex([edge], { cellSize: 2 });
  assert(!queryRoomActorSpatialIndex(index, 0, 0, 1).includes(edge),
    'un-padded query scanned beyond its cell bounds');
  assert(queryRoomActorSpatialIndex(index, 0, 0, 1, { padding: 2.1 }).includes(edge),
    'query padding did not expand broad-phase coverage');

  const defaultPadded = buildRoomActorSpatialIndex([edge], { cellSize: 2, padding: 2.1 });
  assert(queryRoomActorSpatialIndex(defaultPadded, 0, 0, 1).includes(edge),
    'index default query padding was ignored');
}

function seededRandom(seed = 0x5f3759df) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function assertCompletenessAgainstBruteForce() {
  const random = seededRandom();
  const rows = Array.from({ length: 180 }, (_, index) => actor(
    `random-${index}`,
    random() * 400 - 200,
    random() * 400 - 200,
    index % 17 === 0 ? { dead: true } : (index % 29 === 0 ? { _removed: true } : {})
  ));
  const index = buildRoomActorSpatialIndex(rows, { cellSize: 9 });
  const sourceOrder = new Map(rows.map((row, order) => [row, order]));

  for (let queryIndex = 0; queryIndex < 80; queryIndex++) {
    const x = random() * 360 - 180;
    const z = random() * 360 - 180;
    const radius = random() * 24;
    const padding = random() * 3;
    const reach = radius + padding;
    const candidates = queryRoomActorSpatialIndex(index, x, z, radius, { padding });
    const candidateSet = new Set(candidates);
    const exact = rows.filter(row => !row.dead && !row._removed && row.hp > 0
      && Math.hypot(row.x - x, row.z - z) <= reach);

    assert.strictEqual(candidateSet.size, candidates.length, 'query returned a duplicate candidate');
    for (const expected of exact) {
      assert(candidateSet.has(expected), `broad phase missed ${expected.id} inside query ${queryIndex}`);
    }
    for (let i = 1; i < candidates.length; i++) {
      assert(sourceOrder.get(candidates[i - 1]) < sourceOrder.get(candidates[i]),
        'candidate order changed between spatial cells');
    }
  }
}

function assertSparseSceneCandidateReduction() {
  const rows = [];
  for (let z = 0; z < 12; z++) {
    for (let x = 0; x < 12; x++) {
      rows.push(actor(`sparse-${x}-${z}`, x * 30 - 165, z * 30 - 165));
    }
  }
  const index = buildRoomActorSpatialIndex(rows, { cellSize: 10 });
  const candidates = queryRoomActorSpatialIndex(index, 0, 0, 12, { padding: 2 });

  assert(rows.length >= 100, 'sparse reduction fixture no longer covers a crowded room');
  assert(candidates.length <= rows.length * 0.1,
    `sparse query retained too many candidates: ${candidates.length}/${rows.length}`);
}

assertNegativeCoordinatesAndBoundaries();
assertDeduplicationExclusionAndStableOrder();
assertLivingFilteringAndRebuild();
assertPaddingExpandsCandidateCoverage();
assertCompletenessAgainstBruteForce();
assertSparseSceneCandidateReduction();
console.log('Room actor spatial-index checks passed: deterministic broad phase is complete and sparse queries strongly reduce candidates.');
