'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  KROMKA_DAMAGE_TYPES,
  resolveDamageMitigation,
  resolveWeaponDamage
} = require('../src/server/kromka-combat-contract');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepStrictEqual(KROMKA_DAMAGE_TYPES, [
  'ballistic', 'explosive', 'energy', 'fire',
  'electric', 'toxic', 'radiation', 'anomalous'
]);

const ordered = resolveDamageMitigation(100, {
  type: 'ballistic', threshold: 10, protection: 0.20, resistance: 0.25
});
assert.strictEqual(ordered.afterThreshold, 90);
assert.strictEqual(ordered.afterProtection, 72);
assert.strictEqual(ordered.afterResistance, 54);
assert.strictEqual(ordered.damage, 54);
assert.strictEqual(ordered.absorbed, 46);

const critical = resolveWeaponDamage({
  rawDamage: 50,
  luck: 10,
  weapon: { ammoType: '9mm', damageType: 'ballistic' },
  profile: { threshold: 10, protection: 0.20, resistance: 0.25 },
  rng: () => 0
});
assert.strictEqual(critical.critical, true);
assert.strictEqual(critical.baseRawDamage, 50);
assert.strictEqual(critical.raw, 100, 'critical must happen before armor');
assert.strictEqual(critical.damage, 54);

const melee = resolveWeaponDamage({
  rawDamage: 40,
  luck: 15,
  weapon: { damageType: 'ballistic' },
  profile: {},
  rng: () => 0
});
assert.strictEqual(melee.critical, false, 'ordinary melee must not use the firearm critical roll');

const vulnerable = resolveDamageMitigation(20, {
  type: 'fire', threshold: 0, protection: 0, resistance: -0.5
});
assert.strictEqual(vulnerable.damage, 30, 'negative resistance must remain a vulnerability');

const minimum = resolveDamageMitigation(100, {
  threshold: 100, protection: 0.85, resistance: 0.85
});
assert.strictEqual(minimum.damage, 12, 'legacy 12% floor must apply after all protection stages');

const server = read('server.js');
assert(server.includes("require('./src/server/kromka-combat-contract')"));
assert(server.includes('profile: serverEnemyArmorProfile(enemy, type)'));
assert(server.includes('profile: serverArmorProfile(target, damageType)'));
assert(server.includes('combatProtection: serverPublicCombatProtection(e, true)'));
assert(server.includes('combatProtection: serverPublicCombatProtection(p, false)'));
assert(!server.includes("name.includes('рейдер')"), 'NPC armor must not be inferred from a display name');

const preview = read('unity-client/Assets/Scripts/Game/RoaCombatPreview.cs');
assert(preview.includes('target?["combatProtection"]?[type]'));
assert(preview.includes('afterThreshold * (1f - protection)'));
assert(preview.includes('afterProtection * (1f - resistance)'));
assert(preview.includes('public int RequiredStrength;'));

console.log('Kromka combat contract: OK (8 damage types, ordered critical/threshold/armor/resistance, shared PvE/PvP profiles).');
