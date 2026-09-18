#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(ROOT, 'server.js');
const ITEM_CATALOG_FILE = path.join(ROOT, 'data', 'kromka', 'items.json');
const UNITY_FILE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaWeaponModificationData.cs');
const UNITY_INVENTORY_FILE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaInventory.cs');

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

function quotedList(source) {
  return [...String(source || '').matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

// RoaWeaponModificationData.cs: Mod(id, slot, name, effect, Cost(...), weaponIds|null, excludeWeaponIds)
// plus the workbench preview Effects(description, damage×, range×, accuracy+, magazine×, magazine+, rate×, reload AP+).
function extractUnityCatalog(source) {
  const catalog = {};
  const modPattern = /Mod\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*Cost\(([^)]*)\)(?:,\s*(?:null|Only\(([^)]*)\)))?(?:,\s*Only\(([^)]*)\))?\)/g;
  for (const row of source.matchAll(modPattern)) {
    const tokens = [...row[5].matchAll(/"([^"]+)"|(-?\d+)/g)].map(token => token[1] ?? Number(token[2]));
    const cost = {};
    for (let index = 0; index + 1 < tokens.length; index += 2) cost[tokens[index]] = tokens[index + 1];
    catalog[row[1]] = {
      id: row[1],
      slot: row[2],
      name: row[3],
      desc: row[4],
      cost,
      weaponIds: row[6] === undefined ? null : quotedList(row[6]),
      excludeWeaponIds: row[7] === undefined ? null : quotedList(row[7]),
      effects: null
    };
  }
  const effectPattern = /\{\s*"([^"]+)",\s*new Effects\("((?:[^"\\]|\\.)*)",\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*(-?\d+),\s*(-?[\d.]+)f,\s*(-?\d+)\)\s*\}/g;
  for (const row of source.matchAll(effectPattern)) {
    const [damageMul, rangeMul, accuracyBonus, magMul, magazineBonus, fireRateMul, reloadApDelta] = row.slice(3).map(Number);
    assert(catalog[row[1]], `${row[1]}: Unity preview effects have no modification definition`);
    catalog[row[1]].effects = { description: row[2], damageMul, rangeMul, accuracyBonus, magMul, magazineBonus, fireRateMul, reloadApDelta };
  }
  return catalog;
}

// Unity previews only these effects; noise and auto-fire penalty stay server-side.
function contractRow(mod) {
  const effects = mod.effects || {};
  return {
    id: String(mod.id || ''),
    slot: String(mod.slot || ''),
    weaponIds: Array.isArray(mod.weaponIds) ? [...mod.weaponIds].sort() : null,
    excludeWeaponIds: Array.isArray(mod.excludeWeaponIds) ? [...mod.excludeWeaponIds].sort() : null,
    cost: { ...(mod.cost || {}) },
    effects: {
      damageMul: Number(effects.damageMul ?? 1),
      rangeMul: Number(effects.rangeMul ?? 1),
      accuracyBonus: Number(effects.accuracyBonus ?? 0),
      magMul: Number(effects.magMul ?? 1),
      fireRateMul: Number(effects.fireRateMul ?? 1),
      reloadApDelta: Number(effects.reloadApDelta ?? 0)
    }
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

const serverSource = read(SERVER_FILE);
const unitySource = read(UNITY_FILE);
const unityInventorySource = read(UNITY_INVENTORY_FILE);
const itemIds = new Set((JSON.parse(read(ITEM_CATALOG_FILE)).items || []).map(item => String(item?.id || '')));
const serverCatalog = extractFrozenObject(
  serverSource,
  'SERVER_WEAPON_MODIFICATION_CATALOG',
  'function serverWeaponModificationCompatible'
);
const unityCatalog = extractUnityCatalog(unitySource);

const serverIds = Object.keys(serverCatalog).sort();
const unityIds = Object.keys(unityCatalog).sort();
assert.deepStrictEqual(unityIds, serverIds, 'Unity/server modification IDs differ');
assert(serverIds.length >= 12, 'weapon modification catalog is unexpectedly small');

for (const id of serverIds) {
  const serverMod = serverCatalog[id];
  const unityMod = unityCatalog[id];
  assert.strictEqual(serverMod.id, id, `${id}: server id field differs from catalog key`);
  assert(['barrel', 'scope', 'magazine', 'forend'].includes(serverMod.slot), `${id}: unknown slot`);
  assert(unityMod.effects, `${id}: Unity workbench preview effects are missing`);
  assert(unityMod.name && unityMod.desc && unityMod.effects.description, `${id}: Unity presentation is incomplete`);
  assert.strictEqual(unityMod.effects.magazineBonus, 0, `${id}: Unity flat magazine bonus has no server counterpart`);
  assert(Object.keys(serverMod.cost || {}).length > 0, `${id}: cost is empty`);
  assert(Object.keys(serverMod.effects || {}).length > 0, `${id}: effects are empty`);
  assert.deepStrictEqual(contractRow(unityMod), contractRow(serverMod), `${id}: Unity/server contract differs`);
  for (const [materialId, qty] of Object.entries(serverMod.cost || {})) {
    assert(itemIds.has(materialId), `${id}: unknown material ${materialId}`);
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
    assert(serverIds.some(id => serverCatalog[id].slot === slot && compatible(serverCatalog[id], weapon)), `${weapon.id}: no ${slot} option`);
  }
  const forends = serverIds.filter(id => serverCatalog[id].slot === 'forend' && compatible(serverCatalog[id], weapon));
  assert.strictEqual(forends.length > 0, weapon.hands === 2, `${weapon.id}: forend availability does not match handedness`);
}

const tunedRifle = applyEffects(
  { dmg: [13, 19], range: 18, magSize: 30, fireRate: 0.42, reloadApCost: 4 },
  [serverCatalog.barrel_suppressor, serverCatalog.scope_marksman, serverCatalog.mag_extended, serverCatalog.forend_grip]
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

assert(unityInventorySource.includes('["action"] = "modifyWeapon"'),
  'Unity workbench does not send the server modifyWeapon action');

console.log(`Weapon modification contract OK (${serverIds.length} modifications, ${weapons.length} weapons).`);
