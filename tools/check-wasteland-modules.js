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
  JOINABLE_WORLD_FACTIONS,
  TERRITORIAL_WORLD_FACTIONS,
  factionCategory,
  factionGroup,
  factionLabel,
  isJoinableWorldFaction,
  isTerritorialWorldFaction,
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
const {
  WORLD_OPERATION_SCHEMA,
  createPatrolOperation,
  createSupplyOperation,
  normalizeWorldTask,
  transitionWorldOperation,
  worldOperationStage
} = require('../src/server/wasteland-world-tasks');

const ROOT = path.resolve(__dirname, '..');
const globalMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/global-map.json'), 'utf8'));

function checkFactions() {
  assert.strictEqual(factionGroup('super_mutants'), 'mutants');
  assert.strictEqual(factionGroup('scrap_town'), 'scrap_union');
  assert.strictEqual(factionLabel('relay'), 'техники Ретранслятора');
  assert.strictEqual(isJoinableWorldFaction('old_klim'), true);
  assert.strictEqual(isJoinableWorldFaction('caravans'), false);
  assert.strictEqual(isJoinableWorldFaction('raiders'), false);
  assert.strictEqual(isTerritorialWorldFaction('caravans'), true);
  assert.strictEqual(isTerritorialWorldFaction('neutral'), false);
  assert.strictEqual(factionCategory('old_klim'), 'major');
  assert.strictEqual(factionCategory('caravans'), 'independent');
  assert.strictEqual(factionCategory('neutral'), 'independent');
  assert.strictEqual(factionCategory('ghouls'), 'hostile');

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

function checkFactionPresentationContract() {
  const expected = ['old_klim', 'scrap_union', 'relay_order'];
  assert.deepStrictEqual([...JOINABLE_WORLD_FACTIONS].sort(), [...expected].sort(),
    'server player-faction allowlist must contain exactly the three main factions');
  assert.deepStrictEqual([...TERRITORIAL_WORLD_FACTIONS].sort(), [...expected, 'caravans'].sort(),
    'territorial simulation must retain caravans without making them a player faction');

  const pipboy = fs.readFileSync(path.join(ROOT, 'unity-client/Assets/Scripts/Game/RoaPipboy.cs'), 'utf8');
  const canvas = fs.readFileSync(path.join(ROOT, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs'), 'utf8');
  const quotedIds = source => [...String(source || '').matchAll(/['\"]([a-z0-9_]+)['\"]/g)]
    .map(match => match[1]);

  const unityAllowlist = pipboy.match(/PrimaryFactionIds\s*=\s*\{([^}]*)\}/);
  assert(unityAllowlist, 'Unity PIP-Boy main-faction allowlist is missing');
  assert.deepStrictEqual(quotedIds(unityAllowlist[1]), expected,
    'Unity RoaPipboy does not show exactly the three server player factions');
  const unityJoinability = pipboy.slice(
    pipboy.indexOf('public static bool IsJoinableFaction('),
    pipboy.indexOf('public static string FactionLabel(', pipboy.indexOf('public static bool IsJoinableFaction('))
  );
  assert.deepStrictEqual(quotedIds(unityJoinability), expected,
    'Unity faction joinability drifted from its three-card PIP-Boy allowlist');

  assert(canvas.includes('foreach (string id in RoaPipboy.PrimaryFactionIds)'),
    'RoaPipboyCanvas no longer renders the shared three-faction allowlist');
  assert(canvas.includes('RoaPipboy.PrimaryFactionIds.Length'),
    'RoaPipboyCanvas dashboard no longer counts the shared three-faction allowlist');
  assert(!/\bFactionIds\s*=/.test(canvas),
    'RoaPipboyCanvas reintroduced a separate faction allowlist that can drift');
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

function checkWorldOperations() {
  const operation = createSupplyOperation({
    partyId: 'resource_dryWaterPump_1000',
    issuerFactionId: 'old_klim',
    sourceSiteId: 'dryWaterPump',
    destinationSiteId: 'settlement',
    cargo: { water: 48, invalid: -3 },
    goal: {
      reason: 'site_shortage',
      summary: 'Поселению нужна вода.',
      targetSiteId: 'settlement'
    },
    assignment: {
      leaderId: 'resource_dryWaterPump_1000_merchant',
      leaderName: 'Караванщик',
      leaderRole: 'Глава каравана',
      leaseUntilHour: 40
    },
    createdHour: 10
  }, 10);
  assert.strictEqual(operation.schema, WORLD_OPERATION_SCHEMA);
  assert.strictEqual(operation.kind, 'supply_delivery');
  assert.strictEqual(operation.phase, 'preparing');
  assert.strictEqual(operation.assignment.assigneeId, 'resource_dryWaterPump_1000');
  assert.strictEqual(operation.assignment.leaderName, 'Караванщик');
  assert.deepStrictEqual(operation.cargo, { water: 48 });

  const traveling = transitionWorldOperation(operation, 'traveling', 12, {
    assignment: { taskId: 'escort_water' }
  });
  assert.strictEqual(traveling.phase, 'traveling');
  assert.strictEqual(traveling.departureHour, 12);
  assert.strictEqual(traveling.revision, operation.revision + 1);
  assert.deepStrictEqual(worldOperationStage(traveling), { key: 'active', label: 'Караван в пути' });
  assert.strictEqual(transitionWorldOperation(traveling, 'traveling', 13).revision, traveling.revision,
    'an unchanged operation transition must be idempotent');

  const completed = transitionWorldOperation(traveling, 'completed', 18, {
    outcome: {
      result: 'delivered',
      reason: 'caravan_arrived',
      siteId: 'settlement',
      cargo: { water: 48 },
      deliveredUnits: 48,
      npcLosses: 0
    }
  });
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(completed.completedHour, 18);
  assert.strictEqual(completed.outcome.deliveredUnits, 48);

  const failed = transitionWorldOperation(traveling, 'failed', 19, {
    outcome: {
      result: 'failed',
      reason: 'caravan_destroyed',
      siteId: 'roadOutpost',
      cargo: {},
      deliveredUnits: 0,
      npcLosses: 4
    }
  });
  const cancelled = transitionWorldOperation(traveling, 'cancelled', 20, {
    outcome: {
      result: 'cancelled',
      reason: 'route_abandoned',
      siteId: 'dryWaterPump',
      cargo: { water: 48 },
      deliveredUnits: 0,
      npcLosses: 0
    }
  });
  for (const terminal of [completed, failed, cancelled]) {
    for (const activePhase of ['traveling', 'preparing']) {
      const reopened = transitionWorldOperation(terminal, activePhase, 24, {
        outcome: {
          result: 'reopened',
          reason: 'invalid_terminal_transition',
          siteId: 'dryWaterPump',
          cargo: { water: 1 },
          deliveredUnits: 1,
          npcLosses: 0
        }
      });
      assert.deepStrictEqual(reopened, terminal,
        `${terminal.phase} world operation must not reopen as ${activePhase}`);
    }

    const enrichedOutcome = {
      ...terminal.outcome,
      npcLosses: Number(terminal.outcome?.npcLosses || 0) + 1
    };
    const enriched = transitionWorldOperation(terminal, terminal.phase, 25, {
      outcome: enrichedOutcome
    });
    assert.strictEqual(enriched.phase, terminal.phase,
      'same-terminal outcome enrichment must preserve the terminal phase');
    assert.strictEqual(enriched.completedHour, terminal.completedHour,
      'same-terminal outcome enrichment must preserve the first completion time');
    assert.strictEqual(enriched.revision, terminal.revision + 1,
      'same-terminal outcome enrichment must advance the operation revision');
    assert.deepStrictEqual(enriched.outcome, enrichedOutcome,
      'same-terminal transition must publish the authoritative outcome enrichment');
    assert.strictEqual(
      transitionWorldOperation(enriched, terminal.phase, 26, { outcome: enrichedOutcome }).revision,
      enriched.revision,
      'repeating the same terminal outcome must be idempotent'
    );
  }

  const task = normalizeWorldTask({
    id: 'escort_water',
    type: 'escort_caravan',
    details: { operation: completed }
  }, 20);
  assert.notStrictEqual(task.details.operation, completed);
  assert.strictEqual(task.details.operation.assignment.leaderName, 'Караванщик');
}

function checkPatrolWorldOperations() {
  const operation = createPatrolOperation({
    partyId: 'klim_road_patrol',
    issuerFactionId: 'old_klim',
    sourceSiteId: 'settlement',
    destinationSiteId: 'roadOutpost',
    goal: {
      summary: 'Патруль проверяет дорогу.',
      targetSiteId: 'roadOutpost'
    },
    createdHour: 30
  }, 30);
  assert.strictEqual(operation.schema, WORLD_OPERATION_SCHEMA);
  assert.strictEqual(operation.id, 'patrol_klim_road_patrol_300');
  assert.strictEqual(operation.kind, 'patrol_mission');
  assert.strictEqual(operation.status, 'active');
  assert.strictEqual(operation.phase, 'patrolling');
  assert.strictEqual(operation.goal.kind, 'patrol_mission');
  assert.strictEqual(operation.goal.reason, 'area_patrol');
  assert.strictEqual(operation.goal.targetSiteId, 'roadOutpost');
  assert.strictEqual(operation.assignment.kind, 'party');
  assert.strictEqual(operation.assignment.assigneeId, 'klim_road_patrol');
  assert.strictEqual(operation.assignment.leaderId, 'klim_road_patrol_leader');
  assert.strictEqual(operation.assignment.leaderName, 'Командир патруля');
  assert.deepStrictEqual(worldOperationStage(operation), {
    key: 'active',
    label: 'Патрулирование маршрута'
  });

  const holding = transitionWorldOperation(operation, 'holding', 32, {
    goal: { reason: 'friendly_site_attacked' }
  });
  assert.strictEqual(holding.phase, 'holding');
  assert.strictEqual(holding.status, 'active');
  assert.strictEqual(holding.goal.reason, 'friendly_site_attacked');
  assert.strictEqual(holding.revision, operation.revision + 1);
  assert.deepStrictEqual(worldOperationStage(holding), {
    key: 'active',
    label: 'Удержание позиции'
  });
  assert.deepStrictEqual(
    transitionWorldOperation(holding, 'holding', 33, { goal: { reason: 'friendly_site_attacked' } }),
    holding,
    'repeating the same patrol phase and goal must be idempotent'
  );

  const terminalOperations = [
    transitionWorldOperation(holding, 'completed', 36, {
      outcome: {
        result: 'patrol_completed',
        reason: 'patrol_duty_completed',
        siteId: 'roadOutpost',
        npcLosses: 0
      }
    }),
    transitionWorldOperation(holding, 'failed', 37, {
      outcome: {
        result: 'failed',
        reason: 'patrol_destroyed',
        siteId: 'roadOutpost',
        npcLosses: 4
      }
    }),
    transitionWorldOperation(holding, 'cancelled', 38, {
      outcome: {
        result: 'cancelled',
        reason: 'mission_abandoned',
        siteId: 'settlement',
        npcLosses: 0
      }
    })
  ];
  for (const terminal of terminalOperations) {
    assert.strictEqual(terminal.status, terminal.phase);
    assert(terminal.completedHour >= 36);
    assert.notStrictEqual(worldOperationStage(terminal).key, 'active');
    for (const activePhase of ['patrolling', 'holding', 'traveling']) {
      assert.deepStrictEqual(
        transitionWorldOperation(terminal, activePhase, 40),
        terminal,
        `${terminal.phase} patrol operation must not reopen as ${activePhase}`
      );
    }
    assert.deepStrictEqual(
      transitionWorldOperation(terminal, terminal.phase, 41, { outcome: terminal.outcome }),
      terminal,
      'repeating the same terminal patrol outcome must be idempotent'
    );
  }

  const missionTask = normalizeWorldTask({
    id: 'patrol_mission_road_outpost',
    type: 'patrol_mission',
    partyId: 'klim_road_patrol',
    siteId: 'roadOutpost',
    details: { operation: holding }
  }, 32);
  assert.notStrictEqual(missionTask.details.operation, holding);
  assert.strictEqual(missionTask.details.operation.kind, 'patrol_mission');
  assert.strictEqual(missionTask.details.operation.phase, 'holding');
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
  const savedJson = fs.readFileSync(stateFile, 'utf8');
  assert.strictEqual(savedJson, '{"schema":"saved"}');
  assert.deepStrictEqual(JSON.parse(savedJson), { schema: 'saved' });
  for (const name of fs.readdirSync(tempDir)) fs.unlinkSync(path.join(tempDir, name));
  fs.rmdirSync(tempDir);
}

checkFactions();
checkFactionPresentationContract();
checkMapGeometry();
checkDistrictSites();
checkSiteInstances();
checkStockpiles();
checkTaskNormalization();
checkWorldOperations();
checkPatrolWorldOperations();
checkPartySpeed();
checkPartyMembership();
checkPartyModuleBoundaries();
checkPersistenceAndRandom();

console.log('Wasteland module checks passed: factions, geometry, district sites, instances, stockpiles, tasks, parties and persistence.');
