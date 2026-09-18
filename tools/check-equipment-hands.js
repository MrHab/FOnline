#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  activeWeaponId,
  activeWeaponSlot,
  isTwoHandedWeapon,
  normalizeHandEquipment,
  weaponHands
} = require('../src/server/equipment-hands');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const defs = {
  fists: { id: 'fists', hands: 1 },
  pistol: { id: 'pistol', hands: 1 },
  knife: { id: 'knife', hands: 1 },
  rifle: { id: 'rifle', hands: 2 },
  shotgun: { id: 'shotgun', hands: 2 }
};

assert.strictEqual(weaponHands(defs.pistol, defs), 1, 'Pistol must be one-handed');
assert.strictEqual(weaponHands('rifle', defs), 2, 'Rifle must be two-handed');
assert.strictEqual(isTwoHandedWeapon('shotgun', defs), true, 'Shotgun must occupy both hands');

assert.deepStrictEqual(
  normalizeHandEquipment({ weapon: 'rifle', offhand: 'pistol' }, defs),
  { weapon: 'rifle', offhand: '' },
  'A two-handed primary weapon must clear the offhand'
);
assert.deepStrictEqual(
  normalizeHandEquipment({ weapon: 'fists', offhand: 'shotgun' }, defs),
  { weapon: 'shotgun', offhand: '' },
  'A legacy two-handed offhand weapon must migrate to the primary hand slot'
);
assert.strictEqual(activeWeaponSlot({ weapon: 'pistol', offhand: 'knife' }, defs), 'weapon');
assert.strictEqual(activeWeaponId({ weapon: 'pistol', offhand: 'knife' }, defs), 'pistol');
assert.strictEqual(activeWeaponSlot({ weapon: 'fists', offhand: 'knife' }, defs), 'offhand');
assert.strictEqual(activeWeaponId({ weapon: 'fists', offhand: 'knife' }, defs), 'knife');
assert.strictEqual(activeWeaponId({ weapon: 'fists', offhand: '' }, defs), 'fists');

const expectedHands = {
  pistol: 1,
  rifle: 2,
  assaultRifle: 2,
  machineGun: 2,
  laserPistol: 1,
  flamethrower: 2,
  plasmaRifle: 2,
  shotgun: 2,
  rocketLauncher: 2,
  knife: 1,
  pickaxe: 2,
  axe: 2,
  handPump: 2,
  fists: 1
};

for (const [id, hands] of Object.entries(expectedHands)) {
  const weaponLine = new RegExp(`\\n\\s*${id}: \\{[^\\n]*hands: ${hands}(?:,| \\})`);
  assert(weaponLine.test(serverSource), `Server weapon ${id} must declare hands: ${hands}`);
}

for (const id of ['pistol', 'laserPistol']) {
  const dualLine = new RegExp(`\\n\\s*${id}: \\{[^\\n]*hands: 1, dualWield: true`);
  assert(dualLine.test(serverSource), `Server weapon ${id} must allow dual-pistol use`);
}
assert(!/\n\s*knife: \{[^\n]*dualWield: true/.test(serverSource), 'A knife must not unlock paired pistol fire');
assert(serverSource.includes("id: 'dual'")
  && serverSource.includes('hitBonus: -0.15')
  && serverSource.includes('hitCap: 0.78')
  && serverSource.includes('rangeMul: 0.85'),
'Server paired volley must own its AP/accuracy/range rules');
assert((serverSource.match(/for \(const entry of spend\.entries\)/g) || []).length >= 2,
  'NPC and PvP damage must resolve each paired bullet independently');

assert(serverSource.includes("offhand: serverCatalogItemIdsForSlot('offhand', true)"), 'Server must authorize the offhand slot from the item catalog');

console.log('Equipment hand checks passed: slots, active-hand fallback, two-handed occupancy, grip metadata, and paired-pistol rules are valid.');
