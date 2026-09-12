'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  claimBase, ensureBaseStates, ensureClan, installModule, publicClanState,
  releaseInactiveBases, sanitizeClanStore
} = require('../src/server/kromka-clans');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/clan-bases.json'), 'utf8'));
const globalMap = JSON.parse(fs.readFileSync(path.join(root, 'data/global-map.json'), 'utf8'));
assert.equal(catalog.bases.length, 8, 'Kromka requires exactly eight public clan bases.');
assert(catalog.bases.every(row => row.siegeWindowsUtc.length === 2), 'Every base needs two weekly siege windows.');
assert.equal(new Set(catalog.bases.map(row => row.id)).size, 8, 'Clan base ids must be unique.');
assert.equal(new Set(catalog.bases.map(row => row.locationId)).size, 8, 'Clan base location ids must be unique.');

for (const profile of catalog.bases) {
  const file = path.join(root, 'data/locations', `${profile.locationId}.json`);
  assert(fs.existsSync(file), `Missing authored clan location ${profile.locationId}.`);
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(location.id, profile.locationId);
  assert(!location.privateInstance && location.pvpMode !== 'peaceful', `${profile.locationId} must be a public PvP location.`);
  assert((location.objects || []).some(row => (row.tags || []).includes('command-core')), `${profile.locationId} is missing its command core.`);
  assert((globalMap.nodes || []).some(row => row.locationId === profile.locationId), `${profile.locationId} must be on the lore-first global map.`);
}

const now = 1_800_000_000_000;
const store = sanitizeClanStore({});
ensureBaseStates(store, catalog, now);
const clan = ensureClan(store, { id: 'clan-a', name: 'Проверяющие', role: 'Основатель' }, { characterId: 'char-a', name: 'Аудитор' }, now);
assert(clan);
assert(claimBase(store, clan.id, 'hydro2', 'char-a', catalog, now).ok, 'Founder must be able to claim a neutral base.');
assert(!claimBase(store, clan.id, 'filter_t6', 'char-a', catalog, now).ok, 'One clan must never own two public bases.');
const moduleResult = installModule(store, clan.id, 'hydro2', 'gate_left', 'reinforced_gate', 'char-a', catalog, now + 1);
assert(moduleResult.ok && moduleResult.cost.scrap > 0, 'Compatible fixed-socket module must install with an explicit cost.');
assert(!installModule(store, clan.id, 'hydro2', 'yard', 'reinforced_gate', 'char-a', catalog, now + 2).ok, 'Module/socket compatibility must be server validated.');
const publicState = publicClanState(store, clan.id, catalog);
assert.equal(publicState.bases.length, 8);
assert.equal(publicState.modules.length, catalog.modules.length);
assert.deepEqual(publicState.moduleSockets, catalog.moduleSockets);
assert.equal(releaseInactiveBases(store, catalog, now + catalog.inactiveReturnMs + 1).length, 1, 'Inactive holdings must return to the neutral garrison.');
assert.equal(store.bases.hydro2.ownerClanId, '');

console.log('Kromka clan base check passed: eight public holdings, one-base limit, modules and inactivity return.');
