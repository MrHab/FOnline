'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { calculateArtifactEffects } = require('../src/server/artifact-effects');

const root = path.resolve(__dirname, '..');
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const artifacts = read('data', 'artifacts.json');
const bases = read('data', 'kromka', 'base-building.json');
const clans = read('data', 'kromka', 'clan-bases.json');
const sieges = read('data', 'kromka', 'sieges.json');

for (const type of artifacts.types) {
  assert(type.benefit && type.cost, `${type.id} needs a visible benefit and cost`);
  assert(Object.keys(type.effects || {}).length > 0, `${type.id} has no mechanical effects`);
}
const records = artifacts.types.map((type, index) => ({ id: `r${index}`, typeId: type.id, itemId: type.itemId, stabilized: true, hot: false }));
const player = { equipment: { artifactBelt: 'artifactBelt4' }, artifactRecords: records, artifactSlots: records.slice(0, 4).map(row => row.id) };
const effects = calculateArtifactEffects(player, artifacts);
assert(effects.speedPct <= artifacts.rules.maxSpeedBonusPct);
assert(effects.carryKg <= artifacts.rules.maxCarryBonusKg);
assert(effects.regenHpPerSecond <= artifacts.rules.maxRegenHpPerSecond);
for (const value of Object.values(effects.resistances || {})) assert(value <= artifacts.rules.maxResistancePct);

for (const job of bases.jobs) {
  assert(job.durationMs >= 30 * 60 * 1000, `${job.id} is too fast for an MMO base job`);
  assert(Object.values(job.input).every(value => value > 0) && Object.values(job.output).every(value => value > 0));
}
assert.equal(clans.bases.length, 8);
for (const base of clans.bases) {
  assert(Object.keys(base.upkeep || {}).length >= 2, `${base.id} has no meaningful upkeep`);
  assert(!Object.keys(base.benefit || {}).some(key => /damage|health|resistance|armor/i.test(key)), `${base.id} gives direct PvP combat power`);
}
assert(sieges.pledge.silver > 0 && sieges.pledge.blue > 0, 'siege challenge needs both common and strategic stakes');
assert(sieges.reward.winnerSilver < sieges.pledge.silver * 4, 'siege reward creates an uncontrolled silver faucet');

console.log('Kromka balance check passed: artifact caps, base production pacing, upkeep and siege stakes.');
