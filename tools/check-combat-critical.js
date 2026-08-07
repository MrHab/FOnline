const fs = require('fs');
const path = require('path');
const {
  CRITICAL_SHOT_DAMAGE_MULTIPLIER,
  criticalShotChanceFromLuck,
  resolveCriticalShot
} = require('../src/server/combat-critical');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const clientStatsSource = fs.readFileSync(path.join(root, 'public/js/game/06c_combat_stats_modes.js'), 'utf8');
const clientDamageSource = fs.readFileSync(path.join(root, 'public/js/game/06d_combat_damage_shooting.js'), 'utf8');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

invariant(CRITICAL_SHOT_DAMAGE_MULTIPLIER === 2, 'Critical shots must deal exactly double raw damage');
invariant(criticalShotChanceFromLuck(1) === 0.01, 'Luck 1 must give 1% critical chance');
invariant(criticalShotChanceFromLuck(5) === 0.05, 'Luck 5 must give 5% critical chance');
invariant(criticalShotChanceFromLuck(15) === 0.15, 'Effective Luck 15 must give 15% critical chance');
invariant(criticalShotChanceFromLuck(99) === 0.15, 'Critical chance must respect the effective Luck cap');

const pistol = { ammoType: 'ammo9' };
const fists = { ammoType: null };
const critical = resolveCriticalShot(21, 10, pistol, () => 0.099);
const normal = resolveCriticalShot(21, 10, pistol, () => 0.10);
const melee = resolveCriticalShot(21, 15, fists, () => 0);
invariant(critical.critical && critical.rawDamage === 42 && critical.multiplier === 2,
  'Successful critical roll must double raw firearm damage');
invariant(!normal.critical && normal.rawDamage === 21 && normal.multiplier === 1,
  'Rolls at or above the critical threshold must keep normal damage');
invariant(!melee.critical && melee.chance === 0 && melee.rawDamage === 21,
  'Weapons without ammunition must not trigger critical shots');

for (const snippet of [
  "resolveCriticalShot(raw, serverStatValue(p, 'luck'), weapon)",
  "resolveCriticalShot(raw, serverStatValue(attacker, 'luck'), weapon)",
  'critical: criticalShot.critical',
  'criticalChance: Math.round(criticalShot.chance * 100)'
]) {
  invariant(serverSource.includes(snippet), `Server critical-shot integration missing: ${snippet}`);
}
for (const snippet of [
  'function criticalShotChance',
  "Number(statValue('luck') || 5)",
  'return luck / 100;',
  'CRITICAL_SHOT_DAMAGE_MULTIPLIER'
]) {
  invariant(clientStatsSource.includes(snippet), `Client critical-shot formula missing: ${snippet}`);
}
for (const snippet of [
  'rollCriticalShot(raw, w)',
  'ack.critical === true',
  'КРИТ!'
]) {
  invariant(clientDamageSource.includes(snippet), `Client critical-shot feedback missing: ${snippet}`);
}

console.log('Combat critical OK: Luck 1–15 gives 1–15% firearm critical chance and critical hits deal x2 raw damage.');
