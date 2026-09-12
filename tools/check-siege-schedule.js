'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fixedRoomId, nextChallengeWindow, occurrenceAtOrAfter, parseWindow, upcomingWindows } = require('../src/server/siege-scheduler');
const root = path.resolve(__dirname, '..');
const bases = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/clan-bases.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/sieges.json'), 'utf8'));
assert(parseWindow('TUE 17:00'));
assert.equal(parseWindow('TUE 25:00'), null);
const monday = Date.UTC(2026, 8, 7, 12, 0, 0);
assert.equal(new Date(occurrenceAtOrAfter('TUE 17:00', monday)).toISOString(), '2026-09-08T17:00:00.000Z');
const windows = upcomingWindows(bases, monday, 15 * 86400000);
assert(windows.length >= 32, 'Two immutable windows per base must be visible across two weeks.');
for (const base of bases.bases) {
  const next = nextChallengeWindow(base, monday, config);
  assert(next.startAt >= monday + config.announceLeadMs, 'Challenge must be announced at least 24 hours ahead.');
}
assert.equal(fixedRoomId('hydro2', 'siege_hydro2_123'), 'clanSiege#hydro2#siege_hydro2_123');
console.log('Siege schedule check passed: UTC recurrence, 24h notice and fixed room identity.');
