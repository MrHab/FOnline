'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TERRITORY_MEMBERSHIP_VERSION, canJoinTerritoryFaction, joinTerritoryFaction,
  leaveTerritoryFaction, publicTerritoryMembership, sanitizeTerritoryMembership,
  territoryChangeCooldownMs, territoryFactionIds, territoryLocationAccess
} = require('../src/server/territory-membership');
const { migrateRetiredCoreLocation, RETIRED_CORE_LOCATIONS } = require('../src/server/core-migration');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const catalog = read('data/kromka/territory.json');
const zone = read('data/locations/coreZone.json');
const exterior = read('data/zones/authored/z_09_07.json');
const now = 1_900_000_000_000;
const cooldown = territoryChangeCooldownMs(catalog);

assert.equal(catalog.schema, 'kromka.territory.v1');
assert.equal(catalog.zoneLocationId, 'coreZone');
assert.equal(catalog.worldEntranceZoneId, 'z_09_07');
assert.deepStrictEqual(territoryFactionIds(catalog), ['uprava', 'free_artels', 'contour', 'tract_league', 'seconds']);
assert.equal(cooldown, 259200000);
assert.deepStrictEqual(sanitizeTerritoryMembership(null, catalog), {
  version: TERRITORY_MEMBERSHIP_VERSION, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: []
});
assert.equal(canJoinTerritoryFaction(null, 'unknown', catalog, now).ok, false);
const joined = joinTerritoryFaction(null, 'seconds', catalog, now, { reputation: 0 });
assert.equal(joined.ok, true);
assert.equal(joined.membership.factionId, 'seconds');
assert.equal(joined.membership.changeAllowedAt, now + cooldown);
assert.equal(joinTerritoryFaction(joined.membership, 'uprava', catalog, now + cooldown - 1).ok, false);
const switched = joinTerritoryFaction(joined.membership, 'uprava', catalog, now + cooldown);
assert.equal(switched.ok, true);
assert.equal(switched.previousFactionId, 'seconds');
assert.equal(leaveTerritoryFaction(switched.membership, catalog, now + cooldown + 1).ok, false);
assert.equal(leaveTerritoryFaction(switched.membership, catalog, now + cooldown * 2).ok, true);

const member = publicTerritoryMembership(joined.membership, catalog, now);
assert.equal(member.capitalLocationId, 'secondHaven');
assert.equal(member.changeLocked, true);
assert.equal(territoryLocationAccess(zone, null, catalog).allowed, false);
assert.equal(territoryLocationAccess(zone, joined.membership, catalog).allowed, true);
assert.equal(territoryLocationAccess(read('data/locations/coreLabSprout.json'), joined.membership, catalog).allowed, true);
for (const id of RETIRED_CORE_LOCATIONS) {
  const retired = read(`data/locations/${id}.json`);
  assert.equal(territoryLocationAccess(retired, joined.membership, catalog).allowed, false, `${id} is retired`);
  const saved = {
    currentLocationId: id, player: { x: 17, z: -8, xp: 900, inventory: [{ id: 'scrap', qty: 7 }] },
    quests: { core: { complete: true } }, factionStorages: { seconds: [{ id: 'medicine', qty: 4 }] },
    serverLocationContext: { locationId: id, roomId: id }
  };
  assert.equal(migrateRetiredCoreLocation(saved), true);
  assert.equal(saved.currentLocationId, 'z_09_07');
  assert.deepStrictEqual([saved.player.x, saved.player.z], [29, -1]);
  assert.equal(saved.player.xp, 900);
  assert.deepStrictEqual(saved.player.inventory, [{ id: 'scrap', qty: 7 }]);
  assert.deepStrictEqual(saved.factionStorages.seconds, [{ id: 'medicine', qty: 4 }]);
  assert.deepStrictEqual(saved.quests, { core: { complete: true } });
  assert.equal(saved.serverLocationContext, null);
  assert.equal(migrateRetiredCoreLocation(saved), false, 'migration is idempotent');
}

assert.equal(zone.pvpMode, 'pvpBlack');
assert.equal(zone.id, 'coreZone');
assert.equal(zone.noGlobalMapEntry, true);
assert.equal(zone.allowGlobalMapExit, false);
assert.equal(zone.transitions.filter(row => row.to === 'z_09_07').length, 1);
assert.equal(zone.transitions.find(row => row.to === 'z_09_07').entryKey, 'entryFromPlace_coreZone');
assert(exterior.transitions.some(row => row.to === 'coreZone' && row.entryKey === 'entryFromWorld'));
assert(exterior.entryFromPlace_coreZone, 'the exterior has an arrival point from Core');
assert.equal(zone.worldZones.filter(row => ['factionPlatform', 'outpostCapture'].includes(row.type)).length, 0);
assert(!zone.transitions.some(row => /^(coreBase|coreMarket)/.test(String(row.to || ''))));
assert(!zone.objects.some(row => /^(platform_|outpost|room_coreZone_(transport|platform|boarding_platform)_)/.test(String(row.id || ''))));
const worldExit=zone.transitions.find(row => row.id === 'exit_to_world');
assert(worldExit && worldExit.to === 'z_09_07' && worldExit.radius > 0
  && Math.hypot(worldExit.x - zone.entryFromWorld.x, worldExit.z - zone.entryFromWorld.z) < 20,
  'The Core exit is an on-foot portal near the arrival point');

for (const faction of catalog.factions) {
  const city = read(`data/locations/${faction.capitalLocationId}.json`);
  assert(city.objects.some(row => row.entity?.service === 'registrar' && row.entity?.territoryFactionId === faction.id),
    `${faction.capitalLocationId} has its faction registrar`);
}
for (const lab of [...catalog.labs.map(row => row.id), ...catalog.centralLab.levels.map(row => row.id)]) {
  const scene = read(`data/locations/${lab}.json`);
  assert.equal(scene.pvpMode, 'pvpBlack');
  assert.equal(territoryLocationAccess(scene, joined.membership, catalog).allowed, true);
  assert(scene.transitions.some(row => ['coreZone', 'coreLabCenterService', 'coreLabCenterResearch'].includes(row.to)), lab + ' has a way back toward Core');
}
assert(read('data/locations/coreLabCenterReactor.json').objects.some(row => row.entity?.worldBoss === true));

console.log('Territory membership OK: five city registrars, direct shared Core route, retained labs/boss, safe legacy migration.');
