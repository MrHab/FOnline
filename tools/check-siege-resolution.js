'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { addChallenge } = require('../src/server/siege-qualification');
const { applyObjective, applyResolutionOnce, createSiegeEvent, tickSiege } = require('../src/server/siege-resolution');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/sieges.json'), 'utf8'));
const start = 1_800_000_000_000;
const event = createSiegeEvent({ id: 'siege-test', baseId: 'hydro2', defenderClanId: 'def', startAt: start, roomId: 'clanSiege#hydro2#siege-test' }, config, start - config.announceLeadMs);
assert(addChallenge(event, 'atk', start - config.announceLeadMs, config.pledge).ok);
tickSiege(event, start, config); assert.equal(event.phase, 'relay');
assert(applyObjective(event, { action: 'captureRelay', objectiveId: 'relay_a', clanId: 'atk', characterId: 'a1' }, start + 1000, config).ok);
assert(applyObjective(event, { action: 'captureRelay', objectiveId: 'relay_b', clanId: 'atk', characterId: 'a2' }, start + 2000, config).ok);
assert.equal(event.phase, 'breach');
for (let i = 0; i < 40; i++) assert(applyObjective(event, { action: 'damageGate', clanId: 'atk', characterId: `a${i}` }, start + 3000, config).ok);
assert.equal(event.phase, 'core'); assert.equal(event.gateHp, 0);
assert(applyObjective(event, { action: 'captureCore', clanId: 'atk', characterId: 'a-core' }, start + 4000, config).ok);
tickSiege(event, start + 4000 + config.coreHoldMs, config);
assert.equal(event.status, 'resolved'); assert.equal(event.winnerClanId, 'atk');
const clans = {
  clans: { def: { id: 'def', baseId: 'hydro2', storage: { private_token: 7 } }, atk: { id: 'atk', baseId: '', storage: {} } },
  bases: { hydro2: { id: 'hydro2', ownerClanId: 'def', lastWeeklyBenefitAt: start - 1, benefitCredits: { 'cost:oil': 0.8 }, benefitOrderCooldowns: { order: start + 99999 }, history: [] } }
};
assert(applyResolutionOnce(event, clans, config, event.resolvedAt).captured);
const rewarded = clans.clans.atk.storage.silver;
assert(applyResolutionOnce(event, clans, config, event.resolvedAt + 1).duplicate, 'Resolution must be idempotent.');
assert.equal(clans.clans.atk.storage.silver, rewarded, 'Repeated resolution must not duplicate rewards.');
assert.equal(clans.clans.def.storage.private_token, 7, 'The former owner keeps all personal/clan storage rows.');
assert.equal(clans.bases.hydro2.ownerClanId, 'atk');
assert.equal(clans.bases.hydro2.lastWeeklyBenefitAt, 0, 'New owner must receive a fresh weekly economy cycle.');
assert.deepEqual(clans.bases.hydro2.benefitCredits, {}, 'New owner must not inherit fractional production credits.');
assert.deepEqual(clans.bases.hydro2.benefitOrderCooldowns, {}, 'New owner must not inherit old order cooldowns.');
console.log('Siege resolution check passed: three phases, one ownership transfer, no duplicated reward or looted storage.');
