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
const playerVisualSource = fs.readFileSync(path.join(root, 'public/js/game/04_player_model_visuals.js'), 'utf8');
const modernVisualSource = fs.readFileSync(path.join(root, 'public/js/game/04a_player_model_modern_runtime.js'), 'utf8');
const remoteVisualSource = fs.readFileSync(path.join(root, 'public/js/game/05a_remote_actor_equipment.js'), 'utf8');
const globalMapVisualSource = fs.readFileSync(path.join(root, 'public/js/game/11a_global_map_player_models.js'), 'utf8');
const shootingVisualSource = fs.readFileSync(path.join(root, 'public/js/game/06d_combat_damage_shooting.js'), 'utf8');
const updateVisualSource = fs.readFileSync(path.join(root, 'public/js/game/09_update_fog_movement_ai.js'), 'utf8');
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

for (const id of ['pistol', 'laserPistol']) {
  const dualLine = new RegExp(`\\n\\s*${id}: \\{[^\\n]*hands: 1, dualWield: true`);
  assert(dualLine.test(serverSource), `Server weapon ${id} must allow dual-pistol use`);
  assert(dualLine.test(clientSource), `Client weapon ${id} must allow dual-pistol use`);
}
assert(!/\n\s*knife: \{[^\n]*dualWield: true/.test(serverSource), 'A knife must not unlock paired pistol fire');
assert(serverSource.includes("id: 'dual'")
  && serverSource.includes('hitBonus: -0.15')
  && serverSource.includes('hitCap: 0.78')
  && serverSource.includes('rangeMul: 0.85'),
'Server paired volley must own its AP/accuracy/range rules');
assert((serverSource.match(/for \(const entry of spend\.entries\)/g) || []).length >= 2,
  'NPC and PvP damage must resolve each paired bullet independently');
assert(shootingVisualSource.includes("player.dualPistolNextHandSlot = bullets[0].slot === 'weapon' ? 'offhand' : 'weapon'"),
  'Single pistol fire must alternate the next hand');
assert(shootingVisualSource.includes('setTimeout(draw, 90 * index)'),
  'Paired volley visuals must draw right then left with a short delay');
assert(shootingVisualSource.includes("pair ? 'два пистолета' : w.name"),
  'Reload must cover both equipped pistols');

assert(clientSource.includes("offhand: 'Левая рука'"), 'Client equipment UI must expose the left-hand slot');
assert(serverSource.includes("offhand: new Set([...VALID_HAND_EQUIPMENT, ''])"), 'Server must authorize the offhand slot');
assert(combatClientSource.includes("equipment?.[activeSlot] || w?.id"), 'Combat snapshots must target the active hand runtime id');
assert(modernVisualSource.includes("modernCharacterJoint(torsoRig, [-0.5, 0.34, -0.27])"), 'Character models must expose a mirrored left-hand weapon mount');
assert(playerVisualSource.includes("[playerParts.offhandWeaponGroup, leftWeaponId, 'offhand']"), 'Local equipment visuals must render the left-hand slot separately');
assert(playerVisualSource.includes('function activeActorWeaponGroup(actor)'), 'Weapon effects must be able to resolve the active hand');
assert(shootingVisualSource.includes('activeActorWeaponGroup(playerGroup)'), 'Local recoil must use the active hand mount');
assert(updateVisualSource.includes('updateWeaponVisualAnimation(playerParts.offhandWeaponGroup'), 'The left-hand weapon mount must receive visual animation updates');
assert(remoteVisualSource.includes("[parts.offhandWeaponGroup, eq.offhand, 'offhand']"), 'Remote player visuals must render offhand weapons');
assert(globalMapVisualSource.includes("[parts.offhandWeaponGroup, leftWeaponId, 'offhand']"), 'Global-map player visuals must preserve offhand placement');

console.log('Equipment hand checks passed: slots, active-hand fallback, two-handed occupancy, grip metadata, and per-hand visuals are valid.');
