'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { addChallenge, lockRosters, registerMember } = require('../src/server/siege-qualification');
const { createSiegeEvent } = require('../src/server/siege-resolution');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/sieges.json'), 'utf8'));
const now = 1_800_000_000_000; const startAt = now + 2 * 86400000;
const event = createSiegeEvent({ id: 'load-20x20', baseId: 'hydro2', defenderClanId: 'def', startAt }, config, now);
assert(addChallenge(event, 'atk', now, config.pledge).ok);
const defender = { id: 'def', members: {} }; const attacker = { id: 'atk', members: {} };
for (let i = 0; i < 21; i++) {
  defender.members[`d${i}`] = { joinedAt: now - config.membershipMinAgeMs - 1 };
  attacker.members[`a${i}`] = { joinedAt: now - config.membershipMinAgeMs - 1 };
}
for (let i = 0; i < 20; i++) {
  assert(registerMember(event, defender, `d${i}`, now, config).ok);
  assert(registerMember(event, attacker, `a${i}`, now, config).ok);
}
assert(!registerMember(event, attacker, 'a20', now, config).ok, 'The 21st attacker must be rejected.');
attacker.members.fresh = { joinedAt: now - 1000 };
assert(!registerMember(event, attacker, 'fresh', now, config).ok, 'A fresh member must fail the 72-hour gate.');
assert(lockRosters(event, event.rosterLocksAt));
assert(!registerMember(event, attacker, 'a20', event.rosterLocksAt, config).ok, 'Roster mutation must stop one hour before battle.');
assert.equal(event.rosters.def.length, 20); assert.equal(event.rosters.atk.length, 20);
console.log('Siege roster/load check passed: server accepts 20x20, rejects overflow and enforces 72h/1h locks.');
