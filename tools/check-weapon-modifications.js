#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_FILE = path.join(ROOT, 'public', 'js', 'game', '04e_weapon_modification_workbench.js');
const SERVER_FILE = path.join(ROOT, 'server.js');
const ITEM_FILE = path.join(ROOT, 'public', 'js', 'game', '03_items_inventory_core.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractFrozenObject(source, name, nextMarker) {
  const marker = `const ${name} = Object.freeze(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} is missing`);
  const end = source.indexOf(nextMarker, start + marker.length);
  assert(end > start, `${name} end marker is missing`);
  const expression = source.slice(start + marker.length, end).trim().replace(/;$/, '').replace(/\)$/, '');
  return vm.runInNewContext(`(${expression})`, Object.create(null), { timeout: 1000 });
}

function contractRow(mod) {
  return {
    id: String(mod.id || ''),
    slot: String(mod.slot || ''),
    weaponIds: Array.isArray(mod.weaponIds) ? [...mod.weaponIds] : null,
    excludeWeaponIds: Array.isArray(mod.excludeWeaponIds) ? [...mod.excludeWeaponIds] : null,
    cost: { ...(mod.cost || {}) },
    effects: { ...(mod.effects || {}) }
  };
}

function compatible(mod, weapon) {
  if (!weapon.ammoType) return false;
  if (mod.slot === 'forend' && weapon.hands !== 2) return false;
  if (mod.weaponIds && !mod.weaponIds.includes(weapon.id)) return false;
  if (mod.excludeWeaponIds && mod.excludeWeaponIds.includes(weapon.id)) return false;
  return true;
}

function applyEffects(base, mods) {
  const totals = {
    damageMul: 1,
    rangeMul: 1,
    magMul: 1,
    fireRateMul: 1,
    reloadApDelta: 0,
    accuracyBonus: 0,
    autoPenaltyReduction: 0,
    noiseMul: 1
  };
  for (const mod of mods) {
    const effects = mod.effects || {};
    for (const key of ['damageMul', 'rangeMul', 'magMul', 'fireRateMul', 'noiseMul']) {
      totals[key] *= Number(effects[key] || 1);
    }
    for (const key of ['reloadApDelta', 'accuracyBonus', 'autoPenaltyReduction']) {
      totals[key] += Number(effects[key] || 0);
    }
  }
  return {
    dmg: base.dmg.map(value => Math.max(1, Math.round(value * totals.damageMul))),
    range: Math.max(0.4, Number((base.range * totals.rangeMul).toFixed(1))),
    magSize: Math.max(1, Math.round(base.magSize * totals.magMul)),
    fireRate: Math.max(0.045, Number((base.fireRate * totals.fireRateMul).toFixed(3))),
    reloadApCost: Math.max(1, Math.round(base.reloadApCost + totals.reloadApDelta)),
    accuracyBonus: Number(totals.accuracyBonus.toFixed(4)),
    noiseMul: Number(totals.noiseMul.toFixed(4))
  };
}

const clientSource = read(CLIENT_FILE);
const serverSource = read(SERVER_FILE);
const itemSource = read(ITEM_FILE);
const clientCatalog = extractFrozenObject(
  clientSource,
  'WEAPON_MODIFICATION_CATALOG',
  'const WEAPON_MODIFICATION_BASE_STATS'
);
const serverCatalog = extractFrozenObject(
  serverSource,
  'SERVER_WEAPON_MODIFICATION_CATALOG',
  'function serverWeaponModificationCompatible'
);

const clientIds = Object.keys(clientCatalog).sort();
const serverIds = Object.keys(serverCatalog).sort();
assert.deepStrictEqual(clientIds, serverIds, 'client/server modification IDs differ');
assert(clientIds.length >= 12, 'weapon modification catalog is unexpectedly small');

for (const id of clientIds) {
  const clientMod = clientCatalog[id];
  const serverMod = serverCatalog[id];
  assert.strictEqual(clientMod.id, id, `${id}: client id field differs from catalog key`);
  assert.strictEqual(serverMod.id, id, `${id}: server id field differs from catalog key`);
  assert(['barrel', 'scope', 'magazine', 'forend'].includes(clientMod.slot), `${id}: unknown slot`);
  assert(clientMod.name && clientMod.desc && clientMod.icon, `${id}: client presentation is incomplete`);
  assert(Object.keys(clientMod.cost || {}).length > 0, `${id}: cost is empty`);
  assert(Object.keys(clientMod.effects || {}).length > 0, `${id}: effects are empty`);
  assert.deepStrictEqual(contractRow(clientMod), contractRow(serverMod), `${id}: client/server contract differs`);
  for (const [materialId, qty] of Object.entries(clientMod.cost || {})) {
    assert(new RegExp(`\\b${materialId}:\\s*\\{`).test(itemSource), `${id}: unknown material ${materialId}`);
    assert(Number.isInteger(qty) && qty > 0, `${id}: invalid ${materialId} cost`);
  }
}

const weapons = [
  { id: 'pistol', hands: 1, ammoType: 'ammo9' },
  { id: 'rifle', hands: 2, ammoType: 'ammo556' },
  { id: 'assaultRifle', hands: 2, ammoType: 'ammo556' },
  { id: 'machineGun', hands: 2, ammoType: 'ammo556' },
  { id: 'laserPistol', hands: 1, ammoType: 'energyCell' },
  { id: 'flamethrower', hands: 2, ammoType: 'napalm' },
  { id: 'plasmaRifle', hands: 2, ammoType: 'energyCell' },
  { id: 'shotgun', hands: 2, ammoType: 'shotgunShell' },
  { id: 'rocketLauncher', hands: 2, ammoType: 'rocketAmmo' }
];

for (const weapon of weapons) {
  for (const slot of ['barrel', 'scope', 'magazine']) {
    assert(clientIds.some(id => clientCatalog[id].slot === slot && compatible(clientCatalog[id], weapon)), `${weapon.id}: no ${slot} option`);
  }
  const forends = clientIds.filter(id => clientCatalog[id].slot === 'forend' && compatible(clientCatalog[id], weapon));
  assert.strictEqual(forends.length > 0, weapon.hands === 2, `${weapon.id}: forend availability does not match handedness`);
}

const tunedRifle = applyEffects(
  { dmg: [13, 19], range: 18, magSize: 30, fireRate: 0.42, reloadApCost: 4 },
  [clientCatalog.barrel_suppressor, clientCatalog.scope_marksman, clientCatalog.mag_extended, clientCatalog.forend_grip]
);
assert.deepStrictEqual(tunedRifle, {
  dmg: [13, 19],
  range: 19,
  magSize: 41,
  fireRate: 0.42,
  reloadApCost: 5,
  accuracyBonus: 0.15,
  noiseMul: 0.42
}, 'combined modification effects changed unexpectedly');

for (const requiredSnippet of [
  "action === 'modifyweapon'",
  'performServerModifyWeapon(p, data)',
  'serverResolveWeaponRuntimeRequest(',
  'serverInventoryWeightWithEquipment(nextInventory, player.equipment || {})',
  'weaponModifications: serverWeaponModificationSnapshot(p)',
  'weaponMods: sanitizeServerWeaponModifications('
]) {
  assert(serverSource.includes(requiredSnippet), `server authority/persistence hook is missing: ${requiredSnippet}`);
}

for (const requiredSnippet of [
  "action: 'modifyWeapon'",
  "modal.setAttribute('aria-hidden', 'false')",
  'function weaponModificationMountRoot()',
  'document.fullscreenElement',
  "document.getElementById('game-container') || document.body",
  'root.appendChild(modal)',
  'loadWeaponModificationModel(itemId)',
  'applyWeaponModificationStats(target)'
]) {
  assert(clientSource.includes(requiredSnippet), `client workbench hook is missing: ${requiredSnippet}`);
}
assert(!clientSource.includes('document.body.appendChild(modal)'), 'workbench modal must stay inside the game fullscreen root');

console.log(`Weapon modification contract OK (${clientIds.length} modifications, ${weapons.length} weapons).`);
