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
const clientSource = fs.readFileSync(path.join(root, 'public/js/game/03_items_inventory_core.js'), 'utf8');
const combatClientSource = fs.readFileSync(path.join(root, 'public/js/game/06c_combat_stats_modes.js'), 'utf8');
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
  assert(weaponLine.test(clientSource), `Client weapon ${id} must declare hands: ${hands}`);
}

assert(clientSource.includes("offhand: 'Левая рука'"), 'Client equipment UI must expose the left-hand slot');
assert(serverSource.includes("offhand: new Set([...VALID_HAND_EQUIPMENT, ''])"), 'Server must authorize the offhand slot');
assert(combatClientSource.includes("equipment?.[activeSlot] || w?.id"), 'Combat snapshots must target the active hand runtime id');

console.log('Equipment hand checks passed: right/left slots, active-hand fallback, two-handed occupancy, and weapon grip metadata are valid.');
