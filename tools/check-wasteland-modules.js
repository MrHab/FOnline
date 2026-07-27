#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pointToInfrastructureDistance } = require('../src/server/global-infrastructure');
const {
  CAPITAL_CLEAR_RADIUS_POINTS,
  ROAD_SITE_LAYOUT_VERSION,
  districtInterestMapSize,
  districtInterestPointIsWater,
  districtInterestSites,
  globalMapPointInCapitalClearZone,
  globalMapRoadRows
} = require('../src/server/wasteland-district-sites');
const {
  factionGroup,
  factionLabel,
  isJoinableWorldFaction,
  protectFactionCapitalSite
} = require('../src/server/wasteland-factions');
const {
  globalMapCellCenter,
  mapPointKm,
  pointDistanceKm
} = require('../src/server/wasteland-map-geometry');
const { localizeLegacyWorldText } = require('../src/server/wasteland-localization');
const {
  ensureUniqueWorldSiteLocalProfiles,
  ensureUniqueWorldSiteLocationIds,
  worldSiteLocationId,
  worldSiteLocationSeed
} = require('../src/server/wasteland-site-instances');
const {
  addStockpile,
  compactStockpile,
  stockpileSummary,
  stockpileTotal,
  takeStockpile
} = require('../src/server/wasteland-stockpile');
const {
  WORLD_PARTY_SPEED_PROFILE_VERSION,
  effectiveWorldPartySpeedKmh,
  normalizeWorldPartySpeedKmh
} = require('../src/server/wasteland-party-speed');
const {
  normalizePartyPlayerMember,
  normalizePartyPlayerMembers,
  syncPatrolDutyWindow,
  worldPartyPlayerLimit
} = require('../src/server/wasteland-party-membership');
const {
  readJson,
  seededRandom,
  writeJsonAtomic
} = require('../src/server/wasteland-sim-utils');
const { normalizeWorldTask } = require('../src/server/wasteland-world-tasks');

const ROOT = path.resolve(__dirname, '..');
const globalMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/global-map.json'), 'utf8'));

function checkFactions() {
  assert.strictEqual(factionGroup('super_mutants'), 'mutants');
  assert.strictEqual(factionGroup('scrap_town'), 'scrap_union');
  assert.strictEqual(factionLabel('relay'), 'техники Ретранслятора');
  assert.strictEqual(isJoinableWorldFaction('old_klim'), true);
  assert.strictEqual(isJoinableWorldFaction('raiders'), false);

  const capital = {
    id: 'settlement',
    owner: 'raiders',
    pvpMode: 'pvpFullDrop',
    activeConflict: { id: 'stale' },
    raidUntil: 100,
    lastRaidFaction: 'raiders',
    controlPressure: -20,
    supplyDisruptedUntil: 100
  };
  assert.strictEqual(protectFactionCapitalSite(capital), true);
  assert.deepStrictEqual({
    capital: capital.capital,
    capitalFaction: capital.capitalFaction,
    owner: capital.owner,
    pvpMode: capital.pvpMode,
    activeConflict: capital.activeConflict,
    raidUntil: capital.raidUntil,
    lastRaidFaction: capital.lastRaidFaction,
    controlPressure: capital.controlPressure,
    supplyDisruptedUntil: capital.supplyDisruptedUntil
  }, {
    capital: true,
    capitalFaction: 'old_klim',
    owner: 'old_klim',
    pvpMode: 'peaceful',
    activeConflict: null,
    raidUntil: 0,
    lastRaidFaction: '',
    controlPressure: 0,
    supplyDisruptedUntil: 0
  });
}

function checkMapGeometry() {
  const size = districtInterestMapSize(globalMap);
  assert.strictEqual(size.cols, 30);
  assert.strictEqual(size.rows, 30);
  assert.strictEqual(size.cellPoints, 30);
  assert.strictEqual(mapPointKm(globalMap), 1 / 3);
  assert.deepStrictEqual(globalMapCellCenter({ x: 0, y: 0 }, globalMap), { x: 15, y: 15 });
  assert(Math.abs(pointDistanceKm({ x: 0, y: 0 }, { x: 30, y: 40 }, globalMap) - 50 / 3) < 1e-9);
}

function checkDistrictSites() {
  const first = districtInterestSites(globalMap, 0, {});
  const repeated = districtInterestSites(globalMap, 0, {});
  assert.deepStrictEqual(repeated, first, 'district generation is not deterministic');

  const sites = Object.values(first);
  const roads = globalMapRoadRows(globalMap);
  assert(sites.length >= 80, 'district generation produced too few sites');
  assert.strictEqual(new Set(sites.map(site => site.id)).size, sites.length);
  assert.strictEqual(new Set(sites.map(site => site.locationId)).size, sites.length);
  assert.strictEqual(new Set(sites.map(site => site.name)).size, sites.length);
  for (const site of sites) {
    assert.strictEqual(site.locationId, worldSiteLocationId(site.id));
    assert.strictEqual(site.roadLayoutVersion, ROAD_SITE_LAYOUT_VERSION);
    assert(!districtInterestPointIsWater(globalMap, site.x, site.y, 0), `${site.id} is in water`);
    assert(!globalMapPointInCapitalClearZone(globalMap, site, CAPITAL_CLEAR_RADIUS_POINTS, site.id),
      `${site.id} is inside a capital clear zone`);
    for (const road of roads) {
      const requiredDistance = 20 + Number(road.width || 0) * 0.5;
      const distance = pointToInfrastructureDistance(site, road);
      assert(distance > requiredDistance, `${site.id} overlaps ${road.id}`);
    }
  }
}

function checkSiteInstances() {
  assert.strictEqual(worldSiteLocationId('a'.repeat(80)).length, 32);
  assert.notStrictEqual(worldSiteLocationSeed(2026, 'alpha'), worldSiteLocationSeed(2026, 'beta'));

  const sites = {
    alpha: { id: 'alpha', locationId: 'randomRuinedRoad', templateLocationId: '' },
    beta: { id: 'beta', locationId: 'randomRuinedRoad', templateLocationId: '' }
  };
  assert.strictEqual(ensureUniqueWorldSiteLocationIds(sites), true);
  assert.notStrictEqual(sites.alpha.locationId, sites.beta.locationId);
  assert.strictEqual(ensureUniqueWorldSiteLocalProfiles(sites), false);
  assert.notStrictEqual(
    `${sites.alpha.localWidthTiles}x${sites.alpha.localHeightTiles}`,
    `${sites.beta.localWidthTiles}x${sites.beta.localHeightTiles}`
  );
}

function checkStockpiles() {
  const stock = { water: 10, scrap: 4 };
  addStockpile(stock, { water: 10 }, 0);
  assert.deepStrictEqual(stock, { water: 10, scrap: 4 });
  addStockpile(stock, { water: 4, medicine: 2 }, 0.5);
  assert.deepStrictEqual(stock, { water: 12, scrap: 4, medicine: 1 });
  assert.deepStrictEqual(takeStockpile(stock, { water: 5, scrap: 8 }), { water: 5, scrap: 4 });
  assert.strictEqual(stockpileTotal(stock), 8);
  assert.deepStrictEqual(compactStockpile({ water: 3.9, scrap: 0.2, medicine: -1 }), { water: 3 });
  assert(stockpileSummary({ water: 3, medicine: 1 }).includes('вода'));
}

function checkTaskNormalization() {
  const task = normalizeWorldTask({
    id: 'legacy task',
    type: 'deliver supplies',
    status: 'unknown',
    title: 'Old Klim Supply Caravan',
    createdHour: 12,
    priority: 99,
    reward: { xp: 12.8, silver: 17.9, reputation: 2.9 },
    details: { demand: { water: 2 } }
  }, 5);
  assert.strictEqual(task.id, 'legacy_task');
  assert.strictEqual(task.type, 'deliver_supplies');
  assert.strictEqual(task.status, 'active');
  assert.strictEqual(task.title, 'Снабженческий караван Старого Клима');
  assert.strictEqual(task.expiresHour, 48);
  assert.strictEqual(task.priority, 5);
  assert.deepStrictEqual(task.reward, { xp: 12, caps: 17, reputation: 2 });
  assert.notStrictEqual(task.details, undefined);
  assert.strictEqual(localizeLegacyWorldText('Raiders vs patrol'), 'Рейдеры против патруля');
}

function checkPartySpeed() {
  assert.strictEqual(
    normalizeWorldPartySpeedKmh({ kind: 'caravan', faction: 'caravans', speedKmh: 2, baseSpeedKmh: 10 }),
    26
  );
  assert.strictEqual(
    normalizeWorldPartySpeedKmh({
      kind: 'caravan',
      faction: 'caravans',
      speedKmh: 9,
      speedProfileVersion: WORLD_PARTY_SPEED_PROFILE_VERSION
    }),
    9
  );
  assert.strictEqual(effectiveWorldPartySpeedKmh({ kind: 'caravan', faction: 'caravans', speedKmh: 100 }), 42);
  assert.strictEqual(normalizeWorldPartySpeedKmh({ kind: 'patrol', speedKmh: 20 }), 36);
}

function checkPartyMembership() {
  const member = normalizePartyPlayerMember({
    characterId: 'character one',
    userId: 'user one',
    name: '<Alice>',
    factionId: 'old_klim'
  }, 0, 12);
  assert.strictEqual(member.characterId, 'character_one');
  assert.strictEqual(member.userId, 'user_one');
  assert.strictEqual(member.name, 'Alice');
  assert.strictEqual(member.factionId, 'old_klim');
  assert.strictEqual(member.joinedHour, 12);

  assert.strictEqual(worldPartyPlayerLimit({ kind: 'patrol' }), 5);
  assert.strictEqual(worldPartyPlayerLimit({ kind: 'caravan', supplyRole: 'heavy' }), 10);

  const playerMembers = Array.from({ length: 7 }, (_, index) => ({
    characterId: `character_${index + 1}`
  }));
  const normalized = normalizePartyPlayerMembers({ kind: 'patrol', playerMembers }, 20);
  assert.strictEqual(normalized.length, 5);
  assert.deepStrictEqual(
    normalized.map(row => row.characterId),
    ['character_3', 'character_4', 'character_5', 'character_6', 'character_7']
  );

  const task = { type: 'join_patrol', details: {}, expiresHour: 0 };
  const dutyMembers = [
    { joinedHour: 10, lastSeenHour: 10 },
    { joinedHour: 12, lastSeenHour: 12 }
  ];
  syncPatrolDutyWindow(task, dutyMembers, 15);
  assert.strictEqual(task.details.dutyStartedHour, 15);
  assert.strictEqual(task.details.dutyEndsHour, 21);
  assert.strictEqual(task.expiresHour, 22);
  syncPatrolDutyWindow(task, [], 16);
  assert.strictEqual(task.details.dutyStartedHour, undefined);
  assert.strictEqual(task.details.dutyEndsHour, undefined);
}

function checkPartyModuleBoundaries() {
  const simulation = fs.readFileSync(path.join(ROOT, 'src/server/wasteland-sim.js'), 'utf8');
  assert(simulation.includes("require('./wasteland-party-speed')"));
  assert(simulation.includes("require('./wasteland-party-membership')"));
  assert(!simulation.includes('function normalizeWorldPartySpeedKmh'));
  assert(!simulation.includes('function normalizePartyPlayerMember'));
  assert(!simulation.includes('function pruneInvalidWorldPartyPlayerMembers'));
  assert(!simulation.includes('function createPlayerAmbushZone'));
  assert(!simulation.includes('function partyCanTriggerPlayerAmbush'));
  assert(!simulation.includes('function triggerPlayerAmbushZone'));
  assert(!simulation.includes('player_ambushes_disabled'));
}

function checkPersistenceAndRandom() {
  const firstRng = seededRandom('stable');
  const secondRng = seededRandom('stable');
  assert.deepStrictEqual([firstRng(), firstRng(), firstRng()], [secondRng(), secondRng(), secondRng()]);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-wasteland-modules-'));
  const stateFile = path.join(tempDir, 'wasteland-sim.json');
  fs.writeFileSync(stateFile, '{broken', 'utf8');
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    assert.deepStrictEqual(readJson(stateFile, { schema: 'fallback' }), { schema: 'fallback' });
  } finally {
    console.error = originalError;
  }
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(fs.readdirSync(tempDir).filter(name => name.includes('.corrupt-')).length, 1);

  writeJsonAtomic(stateFile, { schema: 'saved' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), { schema: 'saved' });
  for (const name of fs.readdirSync(tempDir)) fs.unlinkSync(path.join(tempDir, name));
  fs.rmdirSync(tempDir);
}

checkFactions();
checkMapGeometry();
checkDistrictSites();
checkSiteInstances();
checkStockpiles();
checkTaskNormalization();
checkPartySpeed();
checkPartyMembership();
checkPartyModuleBoundaries();
checkPersistenceAndRandom();

console.log('Wasteland module checks passed: factions, geometry, district sites, instances, stockpiles, tasks, parties and persistence.');
