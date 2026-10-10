'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { territoryContractOffer, territoryFactionShares } = require('../src/server/territory-contract');
const { joinTerritoryFaction } = require('../src/server/territory-membership');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const catalog = read('data/kromka/territory.json');
const names = Object.fromEntries(read('data/kromka/factions.json').factions.map(row => [row.id, row.displayName]));
const now = 1_900_000_000_000;

const empty = territoryFactionShares([], catalog);
assert.equal(empty.characters, 0);
assert.equal(empty.signed, 0);
assert.equal(empty.factions.length, 5);
assert(empty.factions.every(row => row.sharePct === 0));

const shares = territoryFactionShares([
  { factionId: 'seconds' }, { factionId: 'seconds' }, { factionId: 'uprava' },
  { factionId: 'unknown' }, { factionId: '' }
], catalog);
assert.equal(shares.characters, 5);
assert.equal(shares.signed, 3);
assert.equal(shares.factions.find(row => row.factionId === 'seconds').sharePct, 66.7);
assert.equal(shares.factions.find(row => row.factionId === 'uprava').sharePct, 33.3);

const offer = territoryContractOffer({ catalog, factionNames: names, membership: null, shares, now });
assert.equal(offer.signed, false);
assert.equal(offer.canSign, true);
assert.equal(offer.factions.length, 5);
assert.equal(offer.factions.find(row => row.factionId === 'seconds').capitalLocationId, 'secondHaven');
assert(offer.factions.every(row => row.canSign));
assert(!Object.hasOwn(offer, 'baseLocationId'));
assert(offer.factions.every(row => !Object.hasOwn(row, 'baseLocationId')));

const joined = joinTerritoryFaction(null, 'seconds', catalog, now);
assert.equal(joined.ok, true);
const signed = territoryContractOffer({ catalog, factionNames: names, membership: joined.membership, shares, now: now + 1 });
assert.equal(signed.factionId, 'seconds');
assert.equal(signed.capitalLocationId, 'secondHaven');
assert.equal(signed.canSign, false);
assert.equal(signed.changeLocked, true);

const core = read('data/locations/coreZone.json');
const world = read('data/zones/authored/z_09_07.json');
assert(world.transitions.some(row => row.to === 'coreZone' && row.entryKey === 'entryFromWorld'));
assert(core.transitions.some(row => row.to === 'z_09_07' && row.entryKey === 'entryFromPlace_coreZone'));
assert(!core.transitions.some(row => /^(coreBase|coreMarket)/.test(String(row.to || ''))));
const map = read('data/global-map.json');
assert.equal(map.nodes.find(row => row.id === 'coreZone')?.hidden, false);
for (const id of ['coreBaseUprava', 'coreBaseArtels', 'coreBaseContour', 'coreBaseLeague']) {
  assert.equal(map.nodes.find(row => row.id === id)?.hidden, true, `${id} remains a hidden legacy id`);
}

console.log('Territory contract OK: five city factions, share calculation, no base routing, one on-foot Core portal.');
