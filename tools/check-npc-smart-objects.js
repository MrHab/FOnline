'use strict';

const assert = require('assert');
const {
  buildActivitySlotCatalog,
  buildActivitySlotIndexes,
  pruneActivityReservations,
  releaseActivityReservation,
  reserveActivitySlot
} = require('../src/server/npc-smart-objects');

const location = {
  id: 'test_camp',
  objects: [
    {
      id: 'beds',
      position: { x: 4, y: 0, z: 8 },
      rotation: { y: 1.5 },
      activitySlots: [
        { id: 'named_bed', type: 'guard', capacity: 1, ownerNpcId: 'named', visualAction: 'guard' },
        { id: 'shared_bed', type: 'guard', capacity: 1, position: { x: 6, y: 0, z: 8 } }
      ]
    },
    {
      id: 'fire',
      position: { x: 0, y: 0, z: 0 },
      activitySlots: [{ id: 'fire_social', type: 'social', capacity: 2 }]
    }
  ]
};

const slots = buildActivitySlotCatalog(location);
const indexes = buildActivitySlotIndexes(slots);
assert.strictEqual(slots.length, 3, 'all authored slots should be indexed once');
assert.deepStrictEqual(slots.find(slot => slot.id === 'named_bed').position, { x: 4, y: 0, z: 8 });
assert.strictEqual(slots.find(slot => slot.id === 'named_bed').facing, 1.5);

const reservations = new Map();
const named = { id: 'actor_named', npcId: 'named', role: 'merchant' };
const workerA = { id: 'actor_a', npcId: 'worker_a', role: 'worker' };
const workerB = { id: 'actor_b', npcId: 'worker_b', role: 'worker' };

const namedSlot = reserveActivitySlot({ slots, reservations, npc: named, target: { slotId: 'named_bed' }, locationId: location.id });
assert.strictEqual(namedSlot?.id, 'named_bed', 'owner should reserve their personal slot');
assert.strictEqual(
  reserveActivitySlot({ slots, reservations, npc: workerA, target: { slotId: 'named_bed' }, locationId: location.id }),
  null,
  'other NPCs must not use an owned slot'
);

const workerSlot = reserveActivitySlot({ slots, reservations, npc: workerA, target: { slotType: 'guard' }, locationId: location.id });
assert.strictEqual(workerSlot?.id, 'shared_bed');
assert.strictEqual(
  reserveActivitySlot({ slots, reservations, npc: workerB, target: { slotType: 'guard' }, locationId: location.id }),
  null,
  'capacity-one slot must not stack NPCs'
);

releaseActivityReservation(reservations, workerA);
assert.strictEqual(
  reserveActivitySlot({ slots, reservations, npc: workerB, target: { slotType: 'guard' }, locationId: location.id })?.id,
  'shared_bed',
  'released slots should be reusable'
);

const fireA = reserveActivitySlot({ slots, reservations, npc: workerA, target: { slotType: 'social' }, locationId: location.id });
const fireB = reserveActivitySlot({ slots, reservations, npc: workerB, target: { slotType: 'social' }, locationId: location.id });
assert.strictEqual(fireA?.id, 'fire_social');
assert.strictEqual(fireB?.id, 'fire_social', 'capacity-two slot should accept two NPCs');

assert.strictEqual(pruneActivityReservations(reservations, actorId => actorId !== 'actor_a'), 1);
assert(!reservations.get('fire_social')?.has('actor_a'));

const fastReservations = new Map([['shared_bed', new Set([workerB.id])]]);
const guardedSlots = new Proxy(slots, {
  get(target, property, receiver) {
    if (property === 'filter' || property === 'find' || property === 'sort') {
      throw new Error(`steady-state reservation unexpectedly called slots.${String(property)}`);
    }
    return Reflect.get(target, property, receiver);
  }
});
assert.strictEqual(
  reserveActivitySlot({
    slots: guardedSlots,
    slotById: indexes.byId,
    slotsByType: indexes.byType,
    reservations: fastReservations,
    npc: workerB,
    target: { slotType: 'guard' },
    currentSlotId: 'shared_bed',
    locationId: location.id
  })?.id,
  'shared_bed',
  'a valid current reservation must use the O(1) indexed fast path'
);

console.log(`NPC smart objects OK: ${slots.length} slots, ownership, capacity and release verified.`);
