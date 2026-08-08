'use strict';

const path = require('path');
const {
  infrastructureSegmentIsLand,
  planInfrastructureRoute,
  pointToSegmentDistance
} = require('./global-infrastructure');
const {
  WORLD_PARTY_REWARD_INTEGRITY_VERSION,
  isWorldPartyTask,
  worldPartyTaskIsActiveForParty
} = require('./world-party-integrity');
const {
  clamp,
  clone,
  readJson,
  safeId,
  safeTransferIdentity,
  seededRandom,
  writeJsonAtomic
} = require('./wasteland-sim-utils');
const {
  ensureUniqueWorldSiteLocalProfiles,
  ensureUniqueWorldSiteLocationIds,
  worldSiteLocationId,
  worldSiteLocationSeed
} = require('./wasteland-site-instances');
const {
  addStockpile,
  compactStockpile,
  emptyStockpile,
  stockpileSummary,
  stockpileTotal,
  takeStockpile
} = require('./wasteland-stockpile');
const {
  FACTION_CAPITAL_SITES,
  factionGroup,
  factionLabel,
  isCapitalProtectedSite,
  isFactionCapitalSite,
  isJoinableWorldFaction,
  protectFactionCapitalSite
} = require('./wasteland-factions');
const {
  globalMapCellCenter,
  mapNode,
  mapPointKm,
  pointDistanceKm,
  siteEntryRadiusKm
} = require('./wasteland-map-geometry');
const {
  CAPITAL_CLEAR_RADIUS_POINTS,
  NEAR_CAPITAL_SITE_LAYOUT_VERSION,
  ROAD_SITE_LAYOUT_VERSION,
  districtInterestCellCenter,
  districtInterestMapSize,
  districtInterestPointIsWater,
  districtInterestSites,
  globalMapPointInCapitalClearZone,
  globalMapPointInRoadCorridor,
  globalMapRoadClearance,
  globalMapRoadRows,
  isRoadOutpostSite,
  nearestCapitalClearLandPoint,
  nearestRoadClearLandPoint
} = require('./wasteland-district-sites');
const { localizeLegacyWorldText } = require('./wasteland-localization');
const { normalizeWorldTask } = require('./wasteland-world-tasks');
const {
  WORLD_PARTY_SPEED_PROFILE_VERSION,
  boostedWorldPartySpeedKmh,
  effectiveWorldPartySpeedKmh,
  normalizeWorldPartySpeedKmh
} = require('./wasteland-party-speed');
const {
  normalizePartyPlayerMember,
  normalizePartyPlayerMembers,
  normalizedWorldPartyMemberKey,
  pruneInvalidWorldPartyPlayerMembers,
  safeMemberName,
  syncPatrolDutyWindow,
  worldPartyPlayerCount,
  worldPartyPlayerLimit
} = require('./wasteland-party-membership');
const {
  NPC_CAPS_INVENTORY_VERSION,
  materializeNpcCapsInventory
} = require('./npc-inventory');
const {
  normalizeMarketStockRows,
  normalizeRecipeCatalog,
  normalizeRetailMarket,
  normalizeTraderPlanRows,
  normalizeTraderProfiles,
  retailMarketKey
} = require('./faction-economy');

const SCHEMA = 'realm.wastelandSim.v1';
const VERSION = 1;
const DEFAULT_GAME_DAY_REAL_MS = 60 * 60 * 1000;
const MAX_EVENT_COUNT = 90;
const MAX_WORLD_TASK_COUNT = 80;
const MAX_WORLD_TASK_HISTORY_COUNT = 400;
const MAX_WORLD_ZONE_COUNT = 80;
const WORLD_SIM_MAX_STEP_HOURS = 1;
const WORLD_SIM_MAX_CATCHUP_STEPS = 360;
const FACTION_ECONOMY_PLAN_INTERVAL_HOURS = 1;
const RETAIL_MARKET_BOOTSTRAP_VERSION = 2;
const MAX_PRODUCTION_QUEUE_ROWS = 8;
const LEGACY_SITE_NAMES = {
  settlement: 'Old Klim Caravan Yard',
  scrapTown: 'Scrap Post',
  relayStation: 'Relay Station',
  scrapFields: 'Scrap Fields',
  dryWaterPump: 'Dry Water Pump',
  ironMine: 'Abandoned Mine',
  oilPump: 'Old Oil Pump',
  roadOutpost: 'Old Road Outpost',
  oldDepot: 'Old Military Depot'
};
const LEGACY_PARTY_NAMES = {
  klim_supply_caravan: 'Old Klim Supply Caravan',
  klim_road_patrol: 'Old Klim Road Patrol',
  raider_road_band: 'Road Raider Band',
  mutant_roamers: 'Mutant Roamers'
};
const LEGACY_FACTION_NAMES = {
  old_klim: 'Old Klim Caravan Yard',
  caravans: 'Free Caravans',
  raiders: 'Raiders',
  mutants: 'Mutants',
  wild: 'Wasteland Wildlife',
  neutral: 'Neutral Wastelanders'
};
const PARTY_REFORM_HOURS = {
  caravan: 18,
  patrol: 12,
  raider: 30,
  monster: 20
};
const PARTY_REFORM_VISIBLE_MAX_HOURS = 6;
const CARAVAN_STAGING_REAL_MINUTES = 10;
const CARAVAN_POST_BATTLE_REAL_MINUTES = 2;
const CARAVAN_ESCORT_MIN_PLAYERS = 5;
const HEAVY_CARAVAN_ESCORT_MIN_PLAYERS = 10;
const SURPLUS_TRADE_THRESHOLD = 95;
const SURPLUS_TRADE_COOLDOWN_HOURS = 24;
const RESOURCE_EXPORT_THRESHOLD = 42;
const RESOURCE_EXPORT_COOLDOWN_HOURS = 7;
const PRODUCTION_EXPORT_THRESHOLD = 34;
const PRODUCTION_EXPORT_COOLDOWN_HOURS = 8;
const FIXED_LAIR_RESPAWN_HOURS = 24;
const FIXED_LAIR_STATE_VERSION = 3;
const WORLD_INFRASTRUCTURE_LAYOUT_VERSION = 2;
const WORLD_PARTY_AUTONOMY_VERSION = 1;
const PARTY_DECISION_MIN_HOURS = 0.6;
const PARTY_DECISION_MAX_HOURS = 2.2;
const PARTY_SITE_EXIT_GRACE_HOURS = 0.5;
const PARTY_ONSITE_DEPARTURE_REAL_MINUTES = 1;
const PARTY_DYNAMIC_HUNT_DISTANCE_KM = 48;
const PUBLIC_PARTY_MOTION_LOOKAHEAD_MS = 7500;
const CARAVAN_PUBLIC_THREAT_RISK = 48;
const PARTY_CLASH_ENGAGE_DISTANCE_KM = 5;
const PARTY_CLASH_SITE_LINK_DISTANCE_KM = 9;
const PARTY_CLASH_ACTORS_VERSION = 3;
const FIXED_LAIR_SLOTS = {
  raider_road_band: {
    siteId: 'oldDepot',
    x: 510,
    y: 510,
    locationId: 'oldDepot',
    title: 'Логово рейдеров: Дорожная банда',
    text: 'Рейдеры держат постоянную базу у старого военного склада. После зачистки сюда приходят новые банды примерно раз в игровые сутки.'
  },
  mutant_roamers: {
    siteId: 'mutantCrater',
    x: 465,
    y: 330,
    locationId: 'mutantCrater',
    title: 'Логово супермутантов: Бродячие супермутанты',
    text: 'Супермутанты облюбовали район заброшенного рудника. После зачистки логово снова оживает примерно через игровые сутки.'
  },
  radscorpion_brood: {
    siteId: 'radscorpionNestSite',
    x: 390,
    y: 210,
    locationId: 'radscorpionNest',
    title: 'Логово радскорпионов',
    text: 'Радскорпионы держат постоянную нору у сухой каменной гряды. После зачистки гнездо оживает примерно через игровые сутки.'
  },
  gecko_pack_party: {
    siteId: 'geckoCanyon',
    x: 315,
    y: 390,
    locationId: 'randomDryBasin',
    title: 'Логово гекконов',
    text: 'Гекконы греются на камнях сухого каньона. После зачистки стая возвращается примерно через игровые сутки.'
  },
  ant_swarm_party: {
    siteId: 'antHive',
    x: 570,
    y: 450,
    locationId: 'antHive',
    title: 'Муравьиное логово',
    text: 'Большие мутировавшие муравьи держат туннели в сухой низине. После зачистки рой оживает примерно через игровые сутки.'
  }
};

function worldPartyVisualRadiusPoints(party = {}) {
  const kind = String(party.kind || '').toLowerCase();
  const faction = factionGroup(party.faction || '');
  const speciesText = [party.species, party.visual, party.name].map(value => String(value || '').toLowerCase()).join(' ');
  let radius = 5.8;
  if (kind === 'caravan') radius = 8.2;
  else if (kind === 'patrol') radius = 6.4;
  else if (faction === 'raiders' || kind === 'raider') radius = 6.2;
  else if (faction === 'mutants') radius = 7;
  else if (/radscorpion|scorpion/.test(speciesText)) radius = 7.2;
  else if (/gecko/.test(speciesText)) radius = 6.8;
  else if (/brahmin/.test(speciesText)) radius = 7.4;
  else if (/ant/.test(speciesText)) radius = 6;
  else if (/wolf/.test(speciesText)) radius = 6.4;
  return clamp(radius, 5.2, 8.8);
}

function partySiteTouchRadiusKm(party = {}, site = {}, globalMap = {}) {
  return siteEntryRadiusKm(site, globalMap) + worldPartyVisualRadiusPoints(party) * mapPointKm(globalMap);
}

function partyContactDistanceKm(left = {}, right = {}, globalMap = {}) {
  return (worldPartyVisualRadiusPoints(left) + worldPartyVisualRadiusPoints(right)) * mapPointKm(globalMap);
}

function defaultResourceRichness(site = {}) {
  const type = String(site.type || '').toLowerCase();
  const danger = clamp(site.danger || 0, 0, 5);
  if (type === 'resource') return clamp(74 - danger * 4, 35, 92);
  if (type === 'pointofinterest') return clamp(46 - danger * 2, 18, 65);
  return 0;
}

function siteTypeKey(site = {}) {
  return String(typeof site === 'string' ? site : site?.type || '').toLowerCase();
}

function isHarvestSite(site = {}) {
  const type = siteTypeKey(site);
  if (site?.districtInterest && !Object.keys(site.output || {}).length) return false;
  return type === 'resource' || type === 'pointofinterest';
}

function isProductionSite(site = {}) {
  return siteTypeKey(site) === 'production';
}

function isContestedWorldSite(site = {}) {
  if (isCapitalProtectedSite(site)) return false;
  const type = siteTypeKey(site);
  return type === 'resource' || type === 'pointofinterest' || type === 'outpost' || type === 'production';
}

function isSettlementServiceSite(site = {}) {
  const type = siteTypeKey(site);
  return type === 'settlement' || type === 'outpost' || type === 'production';
}

function isSupportDemandSite(site = {}) {
  if (site?.districtInterest && !Object.keys(site.output || {}).length) return false;
  return isContestedWorldSite(site);
}

function resourceOwnerMultiplier(owner = '') {
  const group = factionGroup(owner);
  if (group === 'old_klim' || group === 'caravans') return 1.12;
  if (group === 'neutral') return 0.86;
  if (group === 'raiders') return 0.58;
  if (group === 'mutants' || group === 'wild') return 0.22;
  return 0.74;
}

function resourceActivityPercent(site = {}, worldHour = 0) {
  const type = String(site.type || '').toLowerCase();
  if (type === 'production' || type === 'outpost') {
    const security = clamp(site.security ?? siteDefaultSecurityFallback(site), 0, 100);
    const workforce = clamp(site.workforce ?? site.prosperity ?? 30, 0, 100);
    const prosperity = clamp(site.prosperity ?? workforce, 0, 100);
    const stock = stockpileTotal(site.stockpile || {});
    const stockMul = clamp(stock / 36, 0.35, 1.35);
    const disruptedMul = Number(site.supplyDisruptedUntil || 0) > Number(worldHour || 0) ? 0.7 : 1;
    const base = security * 0.38 + workforce * 0.42 + prosperity * 0.20;
    return clamp(Math.round(base * stockMul * disruptedMul), 3, 160);
  }
  if (!isHarvestSite(site)) return 0;
  const security = clamp(site.security ?? siteDefaultSecurityFallback(site), 0, 100);
  const richness = clamp(site.resourceRichness ?? defaultResourceRichness(site), 0, 100);
  const depletion = clamp(site.resourceDepletion ?? 0, 0, 100);
  const workforce = clamp(site.workforce ?? (type === 'resource' ? 50 : 18), 0, 100);
  const disruptedMul = Number(site.supplyDisruptedUntil || 0) > Number(worldHour || 0) ? 0.7 : 1;
  const safetyMul = clamp((security + 25) / 100, 0.2, 1.25);
  const richnessMul = clamp(0.45 + richness / 100, 0.25, 1.45);
  const depletionMul = clamp(1 - depletion / 115, 0.12, 1);
  const workforceMul = clamp(workforce / 50, 0.08, 1.8);
  return clamp(Math.round(100 * resourceOwnerMultiplier(site.owner) * safetyMul * richnessMul * depletionMul * workforceMul * disruptedMul), 3, 180);
}

function siteDefaultSecurityFallback(site = {}) {
  const danger = clamp(site.danger || 1, 0, 5);
  const type = String(site.type || '').toLowerCase();
  if (type === 'resource') return Math.max(18, 48 - danger * 7);
  if (type === 'pointofinterest') return Math.max(12, 42 - danger * 6);
  if (type === 'production') return 44;
  return 35;
}


function defaultFactions() {
  return {
    old_klim: {
      id: 'old_klim',
      name: 'Караванный двор Старого Клима',
      color: '#93d982',
      relations: { raiders: -100, mutants: -80, wild: -55, neutral: 20, caravans: 70, scrap_union: 35, relay_order: 55 }
    },
    caravans: {
      id: 'caravans',
      name: 'Вольные караваны',
      color: '#efd078',
      relations: { old_klim: 70, raiders: -100, mutants: -80, wild: -45, neutral: 20, scrap_union: 55, relay_order: 55 }
    },
    scrap_union: {
      id: 'scrap_union',
      name: 'Союз Свалочного поста',
      color: '#d7a95e',
      relations: { old_klim: 35, caravans: 55, relay_order: 25, raiders: -95, mutants: -75, wild: -50, neutral: 20 }
    },
    relay_order: {
      id: 'relay_order',
      name: 'Техники Ретранслятора',
      color: '#7fcfff',
      relations: { old_klim: 55, caravans: 55, scrap_union: 25, raiders: -90, mutants: -80, wild: -45, neutral: 25 }
    },
    raiders: {
      id: 'raiders',
      name: 'Рейдеры',
      color: '#ff7b53',
      relations: { old_klim: -100, caravans: -100, scrap_union: -95, relay_order: -90, mutants: -70, wild: -40, neutral: -70 }
    },
    mutants: {
      id: 'mutants',
      name: 'Супермутанты',
      color: '#c681ff',
      relations: { old_klim: -80, caravans: -80, scrap_union: -75, relay_order: -80, raiders: -70, wild: -55, neutral: -70 }
    },
    wild: {
      id: 'wild',
      name: 'Дикие твари пустоши',
      color: '#b88cff',
      relations: { old_klim: -55, caravans: -45, scrap_union: -50, relay_order: -45, raiders: -40, mutants: -55, neutral: -35 }
    },
    neutral: {
      id: 'neutral',
      name: 'Нейтральные жители пустоши',
      color: '#9fd7ff',
      relations: { old_klim: 20, caravans: 20, scrap_union: 20, relay_order: 25, raiders: -70, mutants: -70, wild: -35 }
    }
  };
}

function defaultSites(globalMap = {}) {
  const settlement = mapNode(globalMap, 'settlement') || { x: 255, y: 615 };
  const scrapTown = mapNode(globalMap, 'scrapTown') || { x: 555, y: 645 };
  const relayStation = mapNode(globalMap, 'relayStation') || { x: 675, y: 315 };
  const sites = {
    settlement: {
      id: 'settlement',
      type: 'settlement',
      name: 'Караванный двор Старого Клима',
      x: settlement.x,
      y: settlement.y,
      owner: 'old_klim',
      pvpMode: 'peaceful',
      capital: true,
      capitalFaction: 'old_klim',
      locationId: 'settlement',
      traderProfiles: ['oldKlim', 'guardKlimPatrol'],
      productionCapabilities: ['ammo_bench', 'weapon_bench', 'tool_bench', 'repair_bench', 'chem_station'],
      stockpile: { ...emptyStockpile(), silver: 520, water: 18, scrap: 14, ore: 7, medicine: 5, ammoParts: 8 },
      security: 62,
      prosperity: 40
    },
    scrapTown: {
      id: 'scrapTown',
      type: 'settlement',
      name: 'Свалочный пост',
      x: scrapTown.x,
      y: scrapTown.y,
      owner: 'scrap_union',
      pvpMode: 'peaceful',
      capital: true,
      capitalFaction: 'scrap_union',
      locationId: 'scrapTown',
      traderProfiles: ['scrap'],
      productionCapabilities: ['ammo_bench', 'weapon_bench', 'tool_bench', 'repair_bench', 'chem_station'],
      stockpile: { ...emptyStockpile(), silver: 420, scrap: 42, ore: 12, ammoParts: 10 },
      security: 38,
      prosperity: 32,
      workers: [
        { role: 'trader', label: 'торговец ломом', count: 1 },
        { role: 'worker', label: 'сборщики металлолома', count: 8 },
        { role: 'guard', label: 'ополчение', count: 4 }
      ]
    },
    relayStation: {
      id: 'relayStation',
      type: 'settlement',
      name: 'Станция Ретранслятор',
      x: relayStation.x,
      y: relayStation.y,
      owner: 'relay_order',
      pvpMode: 'peaceful',
      capital: true,
      capitalFaction: 'relay_order',
      locationId: 'relayStation',
      traderProfiles: ['relay'],
      productionCapabilities: ['ammo_bench', 'energy_bench', 'weapon_bench', 'tool_bench', 'repair_bench', 'chem_station'],
      stockpile: { ...emptyStockpile(), silver: 460, electronics: 28, chemicals: 12, medicine: 4 },
      security: 45,
      prosperity: 36,
      workers: [
        { role: 'trader', label: 'техник-торговец', count: 1 },
        { role: 'mechanic', label: 'ремонтники антенн', count: 5 },
        { role: 'guard', label: 'охранники станции', count: 3 }
      ]
    },
    scrapFields: {
      id: 'scrapFields',
      type: 'resource',
      name: 'Поля металлолома',
      ...globalMapCellCenter({ x: 675, y: 765 }, globalMap),
      owner: 'scrap_union',
      pvpMode: 'pvp',
      locationId: 'resourceScrapFields',
      nearCapitalLayoutVersion: NEAR_CAPITAL_SITE_LAYOUT_VERSION,
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Ресурсная точка Свалочного союза у столицы. Добыча: лом, детали патронов. Кормит литейную и патронные караваны.',
      output: { scrap: 16, ammoParts: 5 },
      stockpile: { ...emptyStockpile(), silver: 70, scrap: 30, ammoParts: 8 },
      danger: 2,
      resourceRichness: 78,
      resourceDepletion: 12,
      workforce: 46
    },
    dryWaterPump: {
      id: 'dryWaterPump',
      type: 'resource',
      name: 'Старая водяная помпа',
      ...globalMapCellCenter({ x: 285, y: 555 }, globalMap),
      owner: 'old_klim',
      pvpMode: 'pvp',
      locationId: 'resourceDryWaterPump',
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Сухая насосная станция с редкими рабочими колодцами. Даёт воду и немного химикатов.',
      output: { water: 18, chemicals: 3 },
      stockpile: { ...emptyStockpile(), silver: 80, water: 30, chemicals: 5 },
      danger: 1,
      resourceRichness: 66,
      resourceDepletion: 18,
      workforce: 56
    },
    oldKlimFarm: {
      id: 'oldKlimFarm',
      type: 'resource',
      name: 'Сухая ферма Старого Клима',
      ...globalMapCellCenter({ x: 315, y: 735 }, globalMap),
      owner: 'old_klim',
      pvpMode: 'pvp',
      locationId: 'resourceOldKlimFarm',
      nearCapitalLayoutVersion: NEAR_CAPITAL_SITE_LAYOUT_VERSION,
      note: 'Ресурсная точка Старого Клима у столицы. Добыча: еда, вода, медикаменты и древесина с изгородей и сада. Внутри есть огород, травы и бак с водой.',
      output: { food: 10, water: 6, medicine: 2, wood: 6 },
      stockpile: { ...emptyStockpile(), silver: 70, food: 26, water: 18, medicine: 6, wood: 14 },
      danger: 1,
      resourceRichness: 66,
      resourceDepletion: 12,
      workforce: 48,
      workers: [
        { role: 'worker', label: 'фермеры', count: 6 },
        { role: 'guard', label: 'караул Старого Клима', count: 2 }
      ]
    },
    ironMine: {
      id: 'ironMine',
      type: 'resource',
      name: 'Заброшенный рудник',
      ...globalMapCellCenter({ x: 470, y: 500 }, globalMap),
      owner: 'scrap_union',
      pvpMode: 'pvpFullDrop',
      locationId: 'resourceIronMine',
      note: 'Заброшенная шахта с опасными штольнями. Основной источник руды и металлического лома.',
      output: { ore: 20, scrap: 4 },
      stockpile: { ...emptyStockpile(), silver: 90, ore: 36, scrap: 7 },
      danger: 3,
      resourceRichness: 88,
      resourceDepletion: 24,
      workforce: 34
    },
    oilPump: {
      id: 'oilPump',
      type: 'resource',
      name: 'Старая нефтяная качалка',
      ...globalMapCellCenter({ x: 645, y: 585 }, globalMap),
      owner: 'relay_order',
      pvpMode: 'pvpFullDrop',
      locationId: 'resourceOilPump',
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Старая нефтяная качалка среди ржавых цистерн. Здесь можно добывать нефть, резать цистерны на лом и снимать брус со старых креплений вышки.',
      output: { oil: 14, scrap: 8, wood: 4 },
      stockpile: { ...emptyStockpile(), silver: 95, oil: 24, scrap: 18, wood: 10 },
      danger: 3.5,
      resourceRichness: 72,
      resourceDepletion: 30,
      workforce: 30
    },
    chemSpring: {
      id: 'chemSpring',
      type: 'resource',
      name: 'Химический родник',
      ...globalMapCellCenter({ x: 555, y: 214 }, globalMap),
      owner: 'relay_order',
      pvpMode: 'pvp',
      locationId: 'resourceChemSpring',
      note: 'Минеральный химический источник в северных техпустошах. Сюда ходят патрули Ретранслятора и дикие твари.',
      output: { chemicals: 16, water: 4 },
      stockpile: { ...emptyStockpile(), silver: 85, chemicals: 26, water: 8 },
      danger: 2,
      resourceRichness: 70,
      resourceDepletion: 16,
      workforce: 34
    },
    klimQuarry: {
      id: 'klimQuarry',
      type: 'resource',
      name: 'Каменоломня Старого Клима',
      ...globalMapCellCenter({ x: 386, y: 735 }, globalMap),
      owner: 'old_klim',
      pvpMode: 'pvp',
      locationId: 'resourceKlimQuarry',
      note: 'Южная каменоломня Старого Клима. Камень, руда и вытащенный из породы металл идут на ремонт аванпостов и дорог.',
      output: { ore: 12, scrap: 9 },
      stockpile: { ...emptyStockpile(), silver: 75, ore: 24, scrap: 20 },
      danger: 2,
      resourceRichness: 68,
      resourceDepletion: 18,
      workforce: 42
    },
    siliconRidge: {
      id: 'siliconRidge',
      type: 'resource',
      name: 'Кремниевая гряда',
      ...globalMapCellCenter({ x: 825, y: 195 }, globalMap),
      owner: 'relay_order',
      pvpMode: 'pvp',
      locationId: 'resourceSiliconRidge',
      nearCapitalLayoutVersion: NEAR_CAPITAL_SITE_LAYOUT_VERSION,
      note: 'Ресурсная точка Ретранслятора у столицы. Добыча: электроника, химикаты. Сюда ходят техники за платами и реагентами.',
      output: { electronics: 10, chemicals: 4 },
      stockpile: { ...emptyStockpile(), silver: 90, electronics: 18, chemicals: 7 },
      danger: 2.5,
      resourceRichness: 74,
      resourceDepletion: 20,
      workforce: 32
    },
    tireDepot: {
      id: 'tireDepot',
      type: 'resource',
      name: 'Склад старых покрышек',
      ...globalMapCellCenter({ x: 565, y: 810 }, globalMap),
      owner: 'scrap_union',
      pvpMode: 'pvp',
      locationId: 'resourceTireDepot',
      note: 'Южный склад старых покрышек и дорожного хлама. Свалочный союз собирает здесь резину, лом, топливо и доски от поддонов.',
      output: { scrap: 10, oil: 5, wood: 5 },
      stockpile: { ...emptyStockpile(), silver: 80, scrap: 22, oil: 8, wood: 12 },
      danger: 2,
      resourceRichness: 64,
      resourceDepletion: 22,
      workforce: 36
    },
    mutantCrater: {
      id: 'mutantCrater',
      type: 'lair',
      name: 'Кратер супермутантов',
      ...globalMapCellCenter({ x: 463, y: 332 }, globalMap),
      owner: 'mutants',
      pvpMode: 'pvpFullDrop',
      locationId: 'mutantCrater',
      note: 'Опасный кратер в центральной пустоши. Бродячие супермутанты возвращаются сюда после вылазок.',
      stockpile: { ...emptyStockpile(), silver: 45, ammoParts: 8, scrap: 12 },
      danger: 5,
      resourceRichness: 20,
      resourceDepletion: 50,
      workforce: 0
    },
    radscorpionNestSite: {
      id: 'radscorpionNestSite',
      type: 'lair',
      name: 'Гнездо радскорпионов',
      ...globalMapCellCenter({ x: 283, y: 131 }, globalMap),
      owner: 'wild',
      pvpMode: 'pvpFullDrop',
      locationId: 'radscorpionNest',
      note: 'Сухая каменная гряда с норами радскорпионов. Выводок выходит отсюда на охоту.',
      stockpile: { ...emptyStockpile(), silver: 30, chemicals: 5 },
      danger: 4,
      resourceRichness: 18,
      resourceDepletion: 55,
      workforce: 0
    },
    geckoCanyon: {
      id: 'geckoCanyon',
      type: 'lair',
      name: 'Каньон гекконов',
      ...globalMapCellCenter({ x: 258, y: 361 }, globalMap),
      owner: 'wild',
      pvpMode: 'pvpFullDrop',
      locationId: 'geckoCanyon',
      note: 'Каньон в диких охотничьих землях. Стаи гекконов прячутся среди горячих камней.',
      stockpile: { ...emptyStockpile(), silver: 25, chemicals: 4 },
      danger: 3.5,
      resourceRichness: 16,
      resourceDepletion: 50,
      workforce: 0
    },
    antHive: {
      id: 'antHive',
      type: 'lair',
      name: 'Муравьиный улей',
      ...globalMapCellCenter({ x: 590, y: 447 }, globalMap),
      owner: 'wild',
      pvpMode: 'pvpFullDrop',
      locationId: 'antHive',
      note: 'Сухая низина с туннелями мутировавших муравьев. Рой выходит отсюда к свалочным дорогам.',
      stockpile: { ...emptyStockpile(), silver: 28, chemicals: 3 },
      danger: 4,
      resourceRichness: 18,
      resourceDepletion: 52,
      workforce: 0
    },
    roadOutpost: {
      id: 'roadOutpost',
      type: 'outpost',
      name: 'Дорожный аванпост Старого Клима',
      ...globalMapCellCenter({ x: 405, y: 600 }, globalMap),
      owner: 'old_klim',
      pvpMode: 'pvp',
      locationId: 'roadOutpost',
      roadOutpost: true,
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Дорожный аванпост Старого Клима. Патрули контролируют путь между ресурсными точками.',
      stockpile: { ...emptyStockpile(), silver: 140, water: 6, ammoParts: 4 },
      security: 55,
      production: { ammo9: 18, stim: 2 },
      productionCapabilities: ['ammo_bench', 'chem_station'],
      workers: [
        { role: 'guard', label: 'дорожный патруль', count: 6 },
        { role: 'quartermaster', label: 'интендант', count: 1 },
        { role: 'medic', label: 'фельдшер', count: 1 }
      ]
    },
    scrapOutpost: {
      id: 'scrapOutpost',
      type: 'outpost',
      name: 'Сторожевой пост Свалочного союза',
      ...globalMapCellCenter({ x: 525, y: 705 }, globalMap),
      owner: 'scrap_union',
      pvpMode: 'pvp',
      locationId: 'scrapOutpost',
      roadOutpost: true,
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Передовой пост Свалочного союза у старой трассы. Охраняет караваны лома, рудник и литейную.',
      stockpile: { ...emptyStockpile(), silver: 130, scrap: 12, ammoParts: 8, water: 5 },
      security: 46,
      prosperity: 24,
      production: { ammoParts: 6, repairKit: 1 },
      productionCapabilities: ['ammo_bench', 'tool_bench', 'repair_bench'],
      workers: [
        { role: 'guard', label: 'ополчение Свалочного союза', count: 5 },
        { role: 'quartermaster', label: 'снабженец', count: 1 },
        { role: 'mechanic', label: 'полевой механик', count: 1 }
      ]
    },
    relayOutpost: {
      id: 'relayOutpost',
      type: 'outpost',
      name: 'Узел охраны Ретранслятора',
      ...globalMapCellCenter({ x: 705, y: 405 }, globalMap),
      owner: 'relay_order',
      pvpMode: 'pvp',
      locationId: 'relayOutpost',
      roadOutpost: true,
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Малый охранный узел техников Ретранслятора. Контролирует подходы к станции, нефтяной качалке и техмастерской.',
      stockpile: { ...emptyStockpile(), silver: 150, electronics: 10, energyCell: 12, napalm: 8, water: 4 },
      security: 50,
      prosperity: 26,
      production: { energyCell: 4, napalm: 2, electronics: 2 },
      productionCapabilities: ['energy_bench', 'chem_station', 'repair_bench'],
      workers: [
        { role: 'guard', label: 'охранники Ретранслятора', count: 4 },
        { role: 'quartermaster', label: 'интендант узла', count: 1 },
        { role: 'mechanic', label: 'техник связи', count: 1 }
      ]
    },
    klimAmmoWorks: {
      id: 'klimAmmoWorks',
      type: 'production',
      name: 'Патронная мастерская Старого Клима',
      ...globalMapCellCenter({ x: 345, y: 705 }, globalMap),
      owner: 'old_klim',
      pvpMode: 'pvp',
      locationId: 'klimAmmoWorks',
      nearCapitalLayoutVersion: NEAR_CAPITAL_SITE_LAYOUT_VERSION,
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Производственная точка Старого Клима у столицы. Производит: патроны 9мм, патроны .223. Станки: патронный, оружейный, ремонтный.',
      stockpile: { ...emptyStockpile(), silver: 180, scrap: 20, ore: 12, ammoParts: 18 },
      security: 48,
      prosperity: 28,
      production: { ammo9: 28, ammo556: 12 },
      productionCapabilities: ['ammo_bench', 'weapon_bench', 'repair_bench'],
      workers: [
        { role: 'craftsman', label: 'оружейники', count: 4 },
        { role: 'guard', label: 'караульные', count: 3 }
      ]
    },
    scrapFoundry: {
      id: 'scrapFoundry',
      type: 'production',
      name: 'Литейная Свалочного поста',
      ...globalMapCellCenter({ x: 615, y: 765 }, globalMap),
      owner: 'scrap_union',
      pvpMode: 'pvp',
      locationId: 'scrapFoundry',
      nearCapitalLayoutVersion: NEAR_CAPITAL_SITE_LAYOUT_VERSION,
      note: 'Производственная точка Свалочного союза у столицы. Производит: оружейные детали, детали патронов. Станки: оружейный, патронный, ремонтный, инструментальный.',
      stockpile: { ...emptyStockpile(), silver: 170, scrap: 52, ore: 18, ammoParts: 8 },
      security: 42,
      prosperity: 34,
      production: { weaponParts: 2, ammoParts: 12 },
      productionCapabilities: ['weapon_bench', 'ammo_bench', 'tool_bench', 'repair_bench'],
      workers: [
        { role: 'worker', label: 'литейщики', count: 7 },
        { role: 'mechanic', label: 'механики пресса', count: 2 },
        { role: 'guard', label: 'сторожа', count: 3 }
      ]
    },
    relayWorkshop: {
      id: 'relayWorkshop',
      type: 'production',
      name: 'Техмастерская Ретранслятора',
      ...globalMapCellCenter({ x: 795, y: 285 }, globalMap),
      owner: 'relay_order',
      pvpMode: 'pvp',
      locationId: 'relayWorkshop',
      nearCapitalLayoutVersion: NEAR_CAPITAL_SITE_LAYOUT_VERSION,
      note: 'Производственная точка Ретранслятора у столицы. Производит: электронику, энергоячейки, напалм, ремкомплекты. Станки: энергетический, ремонтный, химический.',
      stockpile: { ...emptyStockpile(), silver: 190, electronics: 24, chemicals: 14, oil: 10, napalm: 12, scrap: 12 },
      security: 46,
      prosperity: 38,
      production: { electronics: 4, energyCell: 10, napalm: 6, repairKit: 1 },
      productionCapabilities: ['energy_bench', 'chem_station', 'repair_bench'],
      workers: [
        { role: 'mechanic', label: 'техники', count: 6 },
        { role: 'trader', label: 'кладовщик', count: 1 },
        { role: 'guard', label: 'охранники', count: 3 }
      ]
    },
    solarArray: {
      id: 'solarArray',
      type: 'production',
      name: 'Солнечная станция Ретранслятора',
      ...globalMapCellCenter({ x: 585, y: 225 }, globalMap),
      owner: 'relay_order',
      pvpMode: 'pvp',
      locationId: 'solarArray',
      nearCapitalLayoutVersion: NEAR_CAPITAL_SITE_LAYOUT_VERSION,
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Производственная точка Ретранслятора у столицы. Производит: энергоячейки, электронику. Станки: энергетический, ремонтный.',
      stockpile: { ...emptyStockpile(), silver: 130, electronics: 18, energyCell: 42, scrap: 8 },
      security: 46,
      prosperity: 36,
      production: { energyCell: 16, electronics: 2 },
      productionCapabilities: ['energy_bench', 'repair_bench'],
      workers: [
        { role: 'mechanic', label: 'энергетики', count: 4 },
        { role: 'guard', label: 'охрана станции', count: 2 }
      ]
    },
    oldDepot: {
      id: 'oldDepot',
      type: 'pointOfInterest',
      name: 'Старый военный склад',
      ...globalMapCellCenter({ x: 555, y: 495 }, globalMap),
      owner: 'raiders',
      pvpMode: 'pvpFullDrop',
      locationId: 'oldDepot',
      roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
      note: 'Старый военный склад, занятый рейдерами. Опасное место с шансом найти боеприпасы и электронику.',
      stockpile: { ...emptyStockpile(), silver: 110, ammoParts: 28, electronics: 8, medicine: 3 },
      danger: 4,
      resourceRichness: 38,
      resourceDepletion: 54,
      workforce: 10,
      workers: [
        { role: 'boss', label: 'главарь', count: 1 },
        { role: 'raider', label: 'рейдеры', count: 8 },
        { role: 'looter', label: 'мародеры', count: 3 }
      ]
    }
  };
  return {
    ...sites,
    ...districtInterestSites(globalMap, 0, sites)
  };
}

function defaultParties() {
  return {
    klim_supply_caravan: {
      id: 'klim_supply_caravan',
      name: 'Снабженческий караван Старого Клима',
      kind: 'caravan',
      faction: 'old_klim',
      state: 'moving',
      homeSiteId: 'settlement',
      destinationSiteId: 'scrapFields',
      route: ['scrapFields', 'settlement', 'dryWaterPump', 'oldKlimFarm', 'settlement', 'klimAmmoWorks', 'roadOutpost', 'settlement'],
      routeIndex: 0,
      x: 260,
      y: 600,
      speedKmh: 24,
      strength: 58,
      members: 5,
      cargo: {},
      cargoCapacity: 70,
      collectScale: 1,
      preferredResources: ['scrap', 'ammoParts', 'water', 'chemicals'],
      supplyRole: 'mixed',
      respawnHours: 18,
      inventory: [{ id: 'water', qty: 6 }, { id: 'ammo556', qty: 24 }]
    },
    klim_water_caravan: {
      id: 'klim_water_caravan',
      name: 'Водовоз Старого Клима',
      kind: 'caravan',
      faction: 'old_klim',
      state: 'moving',
      homeSiteId: 'settlement',
      destinationSiteId: 'dryWaterPump',
      route: ['dryWaterPump', 'oldKlimFarm', 'settlement', 'roadOutpost', 'settlement'],
      routeIndex: 0,
      x: 260,
      y: 600,
      speedKmh: 22,
      strength: 46,
      members: 4,
      cargo: {},
      cargoCapacity: 60,
      collectScale: 1.15,
      preferredResources: ['water', 'food', 'medicine', 'chemicals'],
      supplyRole: 'water',
      respawnHours: 14,
      inventory: [{ id: 'water', qty: 10 }, { id: 'ammo9', qty: 24 }]
    },
    klim_heavy_caravan: {
      id: 'klim_heavy_caravan',
      name: 'Тяжелый караван Старого Клима',
      kind: 'caravan',
      faction: 'old_klim',
      state: 'moving',
      homeSiteId: 'settlement',
      destinationSiteId: 'ironMine',
      route: ['ironMine', 'settlement', 'scrapFields', 'settlement', 'scrapTown', 'settlement'],
      routeIndex: 0,
      x: 260,
      y: 600,
      speedKmh: 20,
      strength: 70,
      members: 6,
      cargo: {},
      cargoCapacity: 95,
      collectScale: 1.2,
      preferredResources: ['ore', 'scrap', 'ammoParts', 'weaponParts'],
      supplyRole: 'heavy',
      respawnHours: 20,
      inventory: [{ id: 'water', qty: 8 }, { id: 'ammo556', qty: 36 }]
    },
    free_oil_caravan: {
      id: 'free_oil_caravan',
      name: 'Вольный нефтяной караван',
      kind: 'caravan',
      faction: 'caravans',
      state: 'moving',
      homeSiteId: 'relayStation',
      destinationSiteId: 'oilPump',
      route: ['oilPump', 'relayStation', 'settlement', 'scrapTown'],
      routeIndex: 0,
      x: 620,
      y: 410,
      speedKmh: 23,
      strength: 52,
      members: 5,
      cargo: {},
      cargoCapacity: 75,
      collectScale: 1.05,
      preferredResources: ['oil', 'electronics', 'chemicals', 'scrap'],
      supplyRole: 'oil',
      respawnHours: 22,
      inventory: [{ id: 'water', qty: 5 }, { id: 'ammo9', qty: 30 }]
    },
    scrap_salvage_caravan: {
      id: 'scrap_salvage_caravan',
      name: 'Караван лома Свалочного поста',
      kind: 'caravan',
      faction: 'scrap_union',
      state: 'moving',
      homeSiteId: 'scrapTown',
      destinationSiteId: 'scrapFields',
      route: ['scrapFields', 'scrapOutpost', 'scrapFoundry', 'scrapTown', 'ironMine', 'scrapOutpost', 'scrapTown'],
      routeIndex: 0,
      x: 555,
      y: 645,
      speedKmh: 21,
      strength: 50,
      members: 5,
      cargo: {},
      cargoCapacity: 85,
      collectScale: 1.12,
      preferredResources: ['scrap', 'ore', 'ammoParts', 'weaponParts'],
      supplyRole: 'scrap',
      respawnHours: 20,
      inventory: [{ id: 'water', qty: 4 }, { id: 'ammo9', qty: 18 }]
    },
    relay_tech_caravan: {
      id: 'relay_tech_caravan',
      name: 'Техкараван Ретранслятора',
      kind: 'caravan',
      faction: 'relay_order',
      state: 'moving',
      homeSiteId: 'relayStation',
      destinationSiteId: 'relayWorkshop',
      route: ['relayWorkshop', 'solarArray', 'relayOutpost', 'relayStation', 'siliconRidge', 'oilPump', 'relayOutpost', 'relayStation', 'settlement'],
      routeIndex: 0,
      x: 675,
      y: 315,
      speedKmh: 22,
      strength: 55,
      members: 5,
      cargo: {},
      cargoCapacity: 70,
      collectScale: 1.05,
      preferredResources: ['electronics', 'chemicals', 'oil', 'energyCell'],
      supplyRole: 'tech',
      respawnHours: 20,
      inventory: [{ id: 'energyCell', qty: 20 }, { id: 'repairKit', qty: 1 }]
    },
    klim_road_patrol: {
      id: 'klim_road_patrol',
      name: 'Патруль Старого Клима',
      kind: 'patrol',
      faction: 'old_klim',
      state: 'moving',
      homeSiteId: 'settlement',
      destinationSiteId: 'roadOutpost',
      route: ['roadOutpost', 'oldKlimFarm', 'klimAmmoWorks', 'scrapFields', 'settlement', 'dryWaterPump', 'oilPump', 'settlement'],
      routeIndex: 0,
      x: 260,
      y: 600,
      speedKmh: 28,
      strength: 72,
      members: 4,
      respawnHours: 12,
      cargo: {}
    },
    scrap_militia_patrol: {
      id: 'scrap_militia_patrol',
      name: 'Ополчение Свалочного поста',
      kind: 'patrol',
      faction: 'scrap_union',
      state: 'moving',
      homeSiteId: 'scrapTown',
      destinationSiteId: 'scrapFoundry',
      route: ['scrapOutpost', 'scrapFoundry', 'scrapFields', 'scrapTown', 'ironMine', 'scrapOutpost', 'scrapTown'],
      routeIndex: 0,
      x: 555,
      y: 645,
      speedKmh: 26,
      strength: 62,
      members: 4,
      respawnHours: 14,
      cargo: {}
    },
    relay_guard_patrol: {
      id: 'relay_guard_patrol',
      name: 'Охрана Ретранслятора',
      kind: 'patrol',
      faction: 'relay_order',
      state: 'moving',
      homeSiteId: 'relayStation',
      destinationSiteId: 'relayWorkshop',
      route: ['relayOutpost', 'relayWorkshop', 'solarArray', 'relayStation', 'siliconRidge', 'oilPump', 'relayOutpost', 'relayStation'],
      routeIndex: 0,
      x: 675,
      y: 315,
      speedKmh: 27,
      strength: 64,
      members: 4,
      respawnHours: 14,
      cargo: {}
    },
    raider_road_band: {
      id: 'raider_road_band',
      name: 'Дорожная банда рейдеров',
      kind: 'raider',
      faction: 'raiders',
      state: 'hunting',
      homeSiteId: 'oldDepot',
      destinationSiteId: 'roadOutpost',
      route: ['oldDepot', 'roadOutpost', 'scrapFields', 'klimAmmoWorks', 'scrapOutpost', 'oldDepot'],
      routeIndex: 0,
      x: 510,
      y: 510,
      speedKmh: 30,
      strength: 64,
      members: 6,
      respawnHours: 30,
      cargo: {}
    },
    mutant_roamers: {
      id: 'mutant_roamers',
      name: 'Бродячие супермутанты',
      kind: 'monster',
      faction: 'mutants',
      species: 'mutant',
      state: 'roaming',
      homeSiteId: 'mutantCrater',
      destinationSiteId: 'siliconRidge',
      route: ['mutantCrater', 'siliconRidge', 'relayOutpost', 'oilPump', 'mutantCrater', 'ironMine'],
      routeIndex: 0,
      x: 465,
      y: 330,
      speedKmh: 22,
      strength: 50,
      members: 5,
      respawnHours: 20,
      cargo: {}
    },
    radscorpion_brood: {
      id: 'radscorpion_brood',
      name: 'Выводок радскорпионов',
      kind: 'monster',
      faction: 'wild',
      species: 'radscorpion',
      state: 'roaming',
      homeSiteId: 'radscorpionNestSite',
      destinationSiteId: 'chemSpring',
      route: ['radscorpionNestSite', 'chemSpring', 'geckoCanyon', 'radscorpionNestSite'],
      routeIndex: 0,
      x: 390,
      y: 210,
      baseSpeedKmh: 18,
      speedKmh: boostedWorldPartySpeedKmh(18, { kind: 'monster', faction: 'wild' }),
      speedProfileVersion: WORLD_PARTY_SPEED_PROFILE_VERSION,
      strength: 44,
      members: 5,
      respawnHours: 24,
      cargo: {}
    },
    gecko_pack_party: {
      id: 'gecko_pack_party',
      name: 'Стая гекконов',
      kind: 'monster',
      faction: 'wild',
      species: 'gecko',
      state: 'roaming',
      homeSiteId: 'geckoCanyon',
      destinationSiteId: 'dryWaterPump',
      route: ['geckoCanyon', 'dryWaterPump', 'klimQuarry', 'geckoCanyon'],
      routeIndex: 0,
      x: 315,
      y: 390,
      speedKmh: 24,
      strength: 38,
      members: 6,
      respawnHours: 24,
      cargo: {}
    },
    ant_swarm_party: {
      id: 'ant_swarm_party',
      name: 'Рой мутировавших муравьёв',
      kind: 'monster',
      faction: 'wild',
      species: 'mutantAnt',
      state: 'roaming',
      homeSiteId: 'antHive',
      destinationSiteId: 'tireDepot',
      route: ['antHive', 'scrapFields', 'tireDepot', 'antHive', 'oldDepot'],
      routeIndex: 0,
      x: 570,
      y: 450,
      speedKmh: 25,
      strength: 42,
      members: 7,
      respawnHours: 24,
      cargo: {}
    }
  };
}

function normalizeSiteWorker(input = {}, index = 0) {
  const role = safeId(input.role || input.kind || `worker_${index + 1}`, `worker_${index + 1}`);
  const label = String(input.label || input.name || role).trim().slice(0, 64) || role;
  const count = clamp(Math.round(Number(input.count || input.qty || 1)), 1, 99);
  const worker = { role, label, count };
  if (input.id) worker.id = safeId(input.id, `${role}_${index + 1}`);
  if (input.sourceSiteId) worker.sourceSiteId = safeId(input.sourceSiteId, '');
  if (input.sourcePartyId) worker.sourcePartyId = safeId(input.sourcePartyId, '');
  if (input.dispatchedHour !== undefined) worker.dispatchedHour = Number(input.dispatchedHour || 0);
  if (input.arrivedHour !== undefined) worker.arrivedHour = Number(input.arrivedHour || 0);
  if (input.real === true) worker.real = true;
  if (input.equipment && typeof input.equipment === 'object') worker.equipment = clone(input.equipment);
  return worker;
}

function defaultSiteWorkers(site = {}) {
  const type = String(site.type || '').toLowerCase();
  const owner = factionGroup(site.owner || 'neutral');
  if (owner === 'raiders') return [{ role: 'raider', label: '\u0440\u0435\u0439\u0434\u0435\u0440\u044b', count: type === 'settlement' ? 8 : 6 }];
  if (owner === 'mutants') return [{ role: 'mutant', label: '\u0441\u0443\u043f\u0435\u0440\u043c\u0443\u0442\u0430\u043d\u0442\u044b', count: type === 'settlement' ? 6 : 5 }];
  if (owner === 'wild') return [{ role: 'wild_creature', label: '\u0434\u0438\u043a\u0438\u0435 \u0442\u0432\u0430\u0440\u0438', count: type === 'settlement' ? 8 : 5 }];
  if (type === 'settlement') {
    return [
      { role: 'trader', label: 'торговец', count: 1 },
      { role: 'guard', label: owner === 'relay_order' ? 'охранники станции' : owner === 'scrap_union' ? 'ополчение' : 'охрана', count: 4 },
      { role: 'worker', label: 'местные жители', count: 8 }
    ];
  }
  if (type === 'resource') {
    return [
      { role: 'worker', label: 'добытчики', count: Math.max(2, Math.round(Number(site.workforce || 30) / 10)) },
      { role: 'guard', label: 'сторожа', count: Math.max(1, Math.round(Number(site.security || 20) / 20)) }
    ];
  }
  if (type === 'outpost') {
    return [
      { role: 'guard', label: 'гарнизон', count: Math.max(3, Math.round(Number(site.security || 40) / 12)) },
      { role: 'worker', label: 'рабочие', count: Math.max(1, Math.round(Number(site.prosperity || site.workforce || 20) / 18)) }
    ];
  }
  if (type === 'production') {
    return [
      { role: 'craftsman', label: 'мастера', count: Math.max(2, Math.round(Number(site.workforce || site.prosperity || 28) / 14)) },
      { role: 'hauler', label: 'грузчики', count: Math.max(1, Math.round(Number(site.prosperity || 24) / 24)) },
      { role: 'guard', label: 'охрана', count: Math.max(2, Math.round(Number(site.security || 36) / 18)) }
    ];
  }
  if (owner === 'raiders') return [{ role: 'raider', label: 'рейдеры', count: 6 }];
  if (owner === 'mutants') return [{ role: 'mutant', label: 'супермутанты', count: 5 }];
  return [{ role: 'scavenger', label: 'сталкеры', count: 2 }];
}

function siteWorkSummary(site = {}) {
  const workers = Array.isArray(site.workers) ? site.workers : [];
  return workers
    .filter(row => row && Number(row.count || 0) > 0)
    .map(row => `${row.label || row.role}: ${Math.round(Number(row.count || 0))}`)
    .slice(0, 4)
    .join(', ');
}

function claimableWorldFaction(faction = '') {
  const group = factionGroup(faction || '');
  return isJoinableWorldFaction(group) ? group : 'neutral';
}

function capitalSiteIdForFaction(faction = '') {
  const group = factionGroup(faction || '');
  if (group === 'caravans') return 'settlement';
  for (const [siteId, factionId] of Object.entries(FACTION_CAPITAL_SITES)) {
    if (factionId === group) return siteId;
  }
  return '';
}

function siteSupportWorkerLabel(role = '', faction = '') {
  const group = factionGroup(faction || '');
  const key = String(role || '').toLowerCase();
  if (key === 'guard') {
    if (group === 'old_klim' || group === 'caravans') return 'охрана Старого Клима';
    if (group === 'scrap_union') return 'ополчение Свалочного союза';
    if (group === 'relay_order') return 'охрана Ретранслятора';
    return 'охрана';
  }
  if (key === 'craftsman') {
    if (group === 'relay_order') return 'техники Ретранслятора';
    if (group === 'scrap_union') return 'мастера Свалочного союза';
    return 'мастера';
  }
  if (key === 'mechanic') {
    if (group === 'relay_order') return 'техники Ретранслятора';
    return 'механики';
  }
  if (key === 'hauler') return 'грузчики снабжения';
  if (key === 'scavenger') {
    if (group === 'scrap_union') return 'сборщики Свалочного союза';
    if (group === 'relay_order') return 'поисковая группа Ретранслятора';
    return 'разведчики Старого Клима';
  }
  if (group === 'old_klim' || group === 'caravans') return 'поселенцы Старого Клима';
  if (group === 'scrap_union') return 'рабочие Свалочного союза';
  if (group === 'relay_order') return 'техники Ретранслятора';
  return 'рабочие';
}

function desiredSiteSupportPlan(site = {}, faction = '') {
  const type = siteTypeKey(site);
  const rows =
    type === 'production'
      ? [{ role: 'guard', count: 2 }, { role: 'craftsman', count: 2 }, { role: 'hauler', count: 1 }]
      : type === 'outpost'
        ? [{ role: 'guard', count: 4 }, { role: 'worker', count: 1 }]
        : type === 'resource'
          ? [{ role: 'guard', count: 2 }, { role: 'worker', count: 3 }]
          : [{ role: 'guard', count: 1 }, { role: 'scavenger', count: 2 }];
  return rows.map(row => ({
    role: row.role,
    label: siteSupportWorkerLabel(row.role, faction),
    count: Math.max(1, Math.round(Number(row.count || 1)))
  }));
}

function supportRoleKitOptions(role = '', faction = '') {
  const key = String(role || '').toLowerCase();
  const group = factionGroup(faction || '');
  if (key === 'guard') {
    const rifleKit = {
      cost: { water: 1, food: 1, medicine: 1, weaponParts: 1, ammo556: 12 },
      cargo: { water: 1, food: 1, medicine: 1, ammo556: 6 },
      equipment: {
        weapon: group === 'relay_order' ? 'laserPistol' : 'rifle',
        armor: group === 'scrap_union' ? 'leather' : 'ballisticVest',
        helmet: group === 'old_klim' || group === 'caravans' ? 'helmet' : null
      }
    };
    const pistolKit = {
      cost: { water: 1, food: 1, medicine: 1, weaponParts: 1, ammo9: 18 },
      cargo: { water: 1, food: 1, medicine: 1, ammo9: 8 },
      equipment: { weapon: 'pistol', armor: 'leather', helmet: group === 'old_klim' ? 'helmet' : null }
    };
    const improvisedKit = {
      cost: { medicine: 1, ammoParts: 2 },
      cargo: { medicine: 1, ammoParts: 1 },
      equipment: { weapon: 'pistol', armor: 'leather' }
    };
    const energyKit = {
      cost: { electronics: 1, energyCell: 10 },
      cargo: { energyCell: 5 },
      equipment: { weapon: 'laserPistol', armor: 'leather' }
    };
    return group === 'relay_order'
      ? [energyKit, rifleKit, pistolKit, improvisedKit]
      : [rifleKit, pistolKit, improvisedKit];
  }
  if (key === 'craftsman' || key === 'mechanic') {
    return [
      { cost: { water: 1, scrap: 2 }, cargo: { water: 1, scrap: 1 }, equipment: { weapon: 'knife' } },
      { cost: { electronics: 1 }, cargo: { electronics: 1 }, equipment: { weapon: 'knife' } },
      { cost: { chemicals: 1, oil: 1 }, cargo: { chemicals: 1 }, equipment: { weapon: 'knife' } }
    ];
  }
  if (key === 'hauler') {
    return [
      { cost: { water: 1, food: 1 }, cargo: { water: 1, food: 1 }, equipment: {} },
      { cost: { water: 1 }, cargo: { water: 1 }, equipment: {} },
      { cost: { scrap: 1 }, cargo: { scrap: 1 }, equipment: {} }
    ];
  }
  return [
    { cost: { water: 1, food: 1 }, cargo: { water: 1, food: 1 }, equipment: { weapon: 'pickaxe' } },
    { cost: { water: 1 }, cargo: { water: 1 }, equipment: { weapon: 'pickaxe' } },
    { cost: { food: 1 }, cargo: { food: 1 }, equipment: { weapon: 'pickaxe' } },
    { cost: { scrap: 1 }, cargo: { scrap: 1 }, equipment: { weapon: 'pickaxe' } }
  ];
}

function stockpileHasCost(stockpile = {}, cost = {}) {
  return Object.entries(cost || {}).every(([id, amount]) => {
    const need = Math.max(0, Math.ceil(Number(amount || 0)));
    return need <= 0 || Math.floor(Number(stockpile?.[id] || 0)) >= need;
  });
}

function chooseSupportRoleKit(stockpile = {}, role = '', faction = '') {
  return supportRoleKitOptions(role, faction).find(option => stockpileHasCost(stockpile, option.cost)) || null;
}

function buildSiteSupportDispatch(state = {}, site = {}, faction = '') {
  const factionId = claimableWorldFaction(faction || site.owner || '');
  const capitalId = capitalSiteIdForFaction(factionId);
  const capital = capitalId ? state.sites?.[capitalId] : null;
  if (!capital || !isJoinableWorldFaction(factionId)) {
    return { ok: false, reason: 'no_capital', capitalId, workers: [], crew: 0 };
  }
  const stock = capital.stockpile || (capital.stockpile = emptyStockpile());
  const plan = desiredSiteSupportPlan(site, factionId);
  const workersByRole = new Map();
  const totalCost = {};
  const cargo = {};
  const equipmentByRole = {};
  let crew = 0;

  for (const row of plan) {
    for (let i = 0; i < Number(row.count || 0); i++) {
      const kit = chooseSupportRoleKit(stock, row.role, factionId);
      if (!kit) break;
      takeStockpile(stock, kit.cost);
      addStockpile(totalCost, kit.cost);
      addStockpile(cargo, kit.cargo || {});
      const key = row.role;
      const prev = workersByRole.get(key) || { role: row.role, label: row.label, count: 0 };
      prev.count += 1;
      prev.real = true;
      prev.sourceSiteId = capital.id;
      prev.dispatchedHour = Number(state.worldHour || 0);
      if (kit.equipment && Object.keys(kit.equipment).length) {
        equipmentByRole[key] = equipmentByRole[key] || kit.equipment;
      }
      workersByRole.set(key, prev);
      crew++;
    }
  }

  const workers = [...workersByRole.values()].map((worker, index) => normalizeSiteWorker({
    ...worker,
    id: `support_${safeId(site.id || 'site')}_${safeId(worker.role || 'worker')}_${index + 1}`,
    equipment: equipmentByRole[worker.role] || undefined
  }, index));
  if (!workers.length) {
    return { ok: false, reason: 'not_enough_supplies', capitalId: capital.id, workers: [], crew: 0, cost: totalCost, cargo };
  }
  return {
    ok: true,
    capital,
    capitalId: capital.id,
    faction: factionId,
    workers,
    crew,
    cost: compactStockpile(totalCost),
    cargo: compactStockpile(cargo)
  };
}

function dispatchSiteSupportFromCapital(state = {}, site = {}, faction = '', opts = {}) {
  if (!site || !state?.sites || !state?.parties) return { ok: false, reason: 'bad_state' };
  const factionId = claimableWorldFaction(faction || site.owner || '');
  if (!isJoinableWorldFaction(factionId)) {
    site.workers = [];
    site.workSummary = '';
    site.supportDispatch = null;
    return { ok: false, reason: 'neutral_owner' };
  }
  const existingId = safeId(site.supportDispatch?.partyId || '', '');
  const existingParty = existingId ? state.parties[existingId] : null;
  if (existingParty && !existingParty.destroyed && existingParty.state !== 'destroyed') {
    return { ok: true, reason: 'already_in_transit', party: existingParty, dispatch: site.supportDispatch };
  }
  const built = buildSiteSupportDispatch(state, site, factionId);
  if (!built.ok) {
    site.workers = [];
    site.workSummary = '';
    site.supportDispatch = {
      status: 'blocked',
      reason: built.reason,
      sourceSiteId: built.capitalId || '',
      faction: factionId,
      createdHour: Number(state.worldHour || 0),
      workers: [],
      cargo: {},
      cost: built.cost || {}
    };
    return built;
  }
  const partyId = safeId(`support_${site.id}_${factionId}_${Math.floor(Number(state.worldHour || 0) * 10)}`, `support_${site.id}_${Date.now()}`);
  const party = {
    id: partyId,
    name: `Подкрепление: ${site.name || site.id}`,
    kind: 'support',
    faction: factionId,
    state: 'moving',
    homeSiteId: built.capital.id,
    destinationSiteId: site.id,
    route: [],
    routeIndex: 0,
    x: Number(built.capital.x || 0),
    y: Number(built.capital.y || 0),
    baseSpeedKmh: 22,
    speedKmh: boostedWorldPartySpeedKmh(22, { kind: 'support', faction: factionId }),
    speedProfileVersion: WORLD_PARTY_SPEED_PROFILE_VERSION,
    strength: 12 + built.crew * 5,
    members: built.crew,
    cargoCapacity: Math.max(12, Math.ceil(stockpileTotal(built.cargo) + 8)),
    cargo: built.cargo,
    dynamic: true,
    respawnDisabled: true,
    supportSiteId: site.id,
    supportWorkers: built.workers,
    supportCost: built.cost,
    createdHour: Number(state.worldHour || 0),
    reason: String(opts.reason || 'site_support').slice(0, 48)
  };
  state.parties[partyId] = party;
  site.workers = [];
  site.workSummary = '';
  site.supportDispatch = {
    status: 'moving',
    partyId,
    sourceSiteId: built.capital.id,
    faction: factionId,
    createdHour: Number(state.worldHour || 0),
    crew: built.crew,
    workers: built.workers.map(worker => ({ role: worker.role, label: worker.label, count: worker.count })),
    cargo: built.cargo,
    cost: built.cost
  };
  return { ok: true, party, dispatch: site.supportDispatch, capital: built.capital };
}

function siteHasLegacyClaimScavengers(site = {}, defaults = {}) {
  if (!site || !isContestedWorldSite(site)) return false;
  if (!isJoinableWorldFaction(site.owner || '')) return false;
  if (site.supportDispatch && typeof site.supportDispatch === 'object') return false;
  const defaultOwner = defaults && defaults.owner ? factionGroup(defaults.owner) : '';
  const owner = factionGroup(site.owner || '');
  const ownerChanged = !!defaultOwner && defaultOwner !== owner;
  const wasCleared = String(site.lastThreatSuppressedBy || '').includes('cleared')
    || Number(site.threatSuppressedUntil || 0) > 0
    || Number(site.lastSupportTaskHour || 0) > 0;
  const workers = Array.isArray(site.workers) ? site.workers : [];
  if (workers.length !== 1) return false;
  const row = workers[0] || {};
  const role = String(row.role || '').toLowerCase();
  return (ownerChanged || wasCleared) && role === 'scavenger' && Math.round(Number(row.count || 0)) <= 2 && !row.real;
}

function normalizeWorldZone(input = {}, worldHour = 0, globalMap = {}) {
  if (!input || typeof input !== 'object') return null;
  const kind = safeId(input.kind || 'event', 'event');
  const id = safeId(input.id || `${kind}_${Math.floor(Number(worldHour || 0) * 10)}`, `${kind}_${Math.floor(Number(worldHour || 0) * 10)}`);
  const point = globalMapCellCenter({
    x: Number.isFinite(Number(input.x)) ? Number(input.x) : 0,
    y: Number.isFinite(Number(input.y)) ? Number(input.y) : 0
  }, globalMap);
  const statusRaw = String(input.status || 'active');
  const status = ['active', 'looted', 'resolved', 'expired'].includes(statusRaw) ? statusRaw : 'active';
  const createdHour = Number.isFinite(Number(input.createdHour)) ? Number(input.createdHour) : Number(worldHour || 0);
  const details = input.details && typeof input.details === 'object' ? clone(input.details) : {};
  if (details.simBattle) {
    details.actors = Array.isArray(details.actors)
      ? details.actors.map((actor, index) => normalizeBattleActor(actor, index, worldHour)).filter(Boolean)
      : [];
    details.battleState = String(details.battleState || 'active').slice(0, 32);
    details.lastBattleHour = Number.isFinite(Number(details.lastBattleHour)) ? Number(details.lastBattleHour) : createdHour;
  }
  return {
    id,
    kind,
    status,
    title: localizeLegacyWorldText(input.title || input.name || kind).slice(0, 120),
    text: localizeLegacyWorldText(input.text || input.description || '').slice(0, 420),
    x: Number(point.x.toFixed(2)),
    y: Number(point.y.toFixed(2)),
    radius: clamp(input.radius ?? 8, 2, 28),
    priority: clamp(input.priority ?? 2, 0, 5),
    sourceType: String(input.sourceType || '').slice(0, 32),
    sourceId: String(input.sourceId || '').slice(0, 80),
    siteId: safeId(input.siteId || '', ''),
    partyId: safeId(input.partyId || '', ''),
    threatPartyId: safeId(input.threatPartyId || '', ''),
    faction: safeId(input.faction || '', ''),
    targetFaction: safeId(input.targetFaction || '', ''),
    encounterId: safeId(input.encounterId || '', ''),
    locationId: safeId(input.locationId || '', ''),
    roomId: String(input.roomId || '').replace(/[^a-zA-Z0-9_#-]/g, '').slice(0, 96),
    pvpMode: String(input.pvpMode || 'pvp').slice(0, 32),
    ownerPlayerId: safeId(input.ownerPlayerId || '', ''),
    ownerName: safeMemberName(input.ownerName || '', ''),
    createdHour,
    expiresHour: Number.isFinite(Number(input.expiresHour)) ? Number(input.expiresHour) : createdHour + 72,
    resolvedHour: Number.isFinite(Number(input.resolvedHour)) ? Number(input.resolvedHour) : 0,
    details
  };
}

function normalizeBattleActor(input = {}, index = 0, worldHour = 0) {
  if (!input || typeof input !== 'object') return null;
  const side = String(input.side || 'attacker').toLowerCase() === 'defender' ? 'defender' : 'attacker';
  const id = safeId(input.id || `${side}_${index}`, `${side}_${index}`);
  const maxHp = clamp(input.maxHp ?? input.hp ?? 40, 1, 400);
  const dead = !!input.dead || Number(input.hp || 0) <= 0;
  let actor = {
    id,
    side,
    name: String(input.name || (side === 'defender' ? 'Охранник каравана' : 'Налетчик')).slice(0, 96),
    faction: safeId(input.faction || (side === 'defender' ? 'caravans' : 'raiders'), side === 'defender' ? 'caravans' : 'raiders'),
    role: String(input.role || (side === 'defender' ? 'guard' : 'raider')).slice(0, 32),
    species: String(input.species || '').slice(0, 32),
    typeName: String(input.typeName || input.name || '').slice(0, 96),
    visual: String(input.visual || '').slice(0, 32),
    modelKey: String(input.modelKey || input.model || '').slice(0, 64),
    tx: clamp(input.tx ?? (side === 'defender' ? 16 + index : 23 + index), 1, 38),
    tz: clamp(input.tz ?? (18 + (index % 3)), 1, 38),
    hp: dead ? 0 : clamp(input.hp ?? maxHp, 1, maxHp),
    maxHp,
    atk: clamp(input.atk ?? (side === 'defender' ? 10 : 9), 1, 80),
    speed: clamp(input.speed ?? 1.8, 0.1, 6),
    equipment: input.equipment && typeof input.equipment === 'object' ? clone(input.equipment) : {},
    inventory: Array.isArray(input.inventory)
      ? input.inventory.slice(0, 160).map(row => ({
        id: safeId(row?.id || row?.itemId || '', ''),
        qty: clamp(Math.floor(Number(row?.qty ?? row?.count ?? 0)), 0, 9999)
      })).filter(row => row.id && row.qty > 0)
      : undefined,
    inventoryVersion: Math.max(0, Math.floor(Number(input.inventoryVersion || 0))),
    loot: Array.isArray(input.loot) ? input.loot.slice(0, 24).map(row => ({ ...row })) : [],
    hostileToPlayer: input.hostileToPlayer,
    canDialogue: input.canDialogue,
    stationary: input.stationary,
    tradeProfile: String(input.tradeProfile || input.traderProfile || '').slice(0, 64),
    traderStock: Array.isArray(input.traderStock) ? input.traderStock.slice(0, 48).map(row => ({ ...row })) : undefined,
    traderBuyInterests: Array.isArray(input.traderBuyInterests) ? input.traderBuyInterests.slice(0, 24) : undefined,
    dead,
    diedHour: dead ? (Number.isFinite(Number(input.diedHour)) ? Number(input.diedHour) : Number(worldHour || 0)) : 0
  };
  actor = normalizeBattleActorIdentity(actor, index);
  const wallet = materializeNpcCapsInventory({
    id: actor.id,
    role: actor.role,
    faction: actor.faction,
    inventory: actor.inventory,
    inventoryVersion: actor.inventoryVersion,
    caps: input.caps,
    traderCaps: input.traderCaps
  }, {
    seed: actor.id,
    role: actor.role,
    faction: actor.faction,
    naturalCreature: factionGroup(actor.faction || '') === 'wild'
  });
  actor.inventory = wallet.inventory;
  actor.inventoryVersion = wallet.inventoryVersion;
  return actor;
}

const WILD_CREATURE_BATTLE_PROFILES = [
  {
    visual: 'radscorpion',
    typeName: 'Радскорпион',
    name: 'Радскорпион',
    eliteName: 'Матерый радскорпион',
    hp: 76,
    atk: 14,
    speed: 1.9,
    aliases: ['radscorpion', 'scorpion', 'скорпион']
  },
  {
    visual: 'mutantAnt',
    typeName: 'Большой мутировавший муравей',
    name: 'Большой мутировавший муравей',
    eliteName: 'Матерый мутировавший муравей',
    hp: 52,
    atk: 10,
    speed: 2.55,
    aliases: ['mutantant', 'mutant_ant', 'ant_swarm', 'ant', 'мурав']
  },
  {
    visual: 'gecko',
    typeName: 'Геккон пустоши',
    name: 'Геккон пустоши',
    eliteName: 'Матерый геккон',
    hp: 46,
    atk: 9,
    speed: 2.7,
    aliases: ['gecko', 'геккон']
  },
  {
    visual: 'wolf',
    typeName: 'Пепельный волк',
    name: 'Пепельный волк',
    eliteName: 'Матерый пепельный волк',
    hp: 36,
    atk: 8,
    speed: 3.15,
    aliases: ['ashwolf', 'ash_wolf', 'wolf', 'волк']
  },
  {
    visual: 'ghoul',
    typeName: 'Гуль',
    name: 'Гуль',
    eliteName: 'Дикий гуль',
    hp: 42,
    atk: 7,
    speed: 2.85,
    aliases: ['ghoul', 'гул']
  }
];

function wildCreatureBattleProfile(seed = '', index = 0) {
  const text = String(seed || '').toLowerCase();
  const compact = text.replace(/[^a-z0-9а-яё]+/gi, '').toLowerCase();
  for (const profile of WILD_CREATURE_BATTLE_PROFILES) {
    if ((profile.aliases || []).some(alias => compact.includes(String(alias).replace(/[^a-z0-9а-яё]+/gi, '').toLowerCase()))) {
      return profile;
    }
  }
  const rng = seededRandom(`${seed || 'wild'}:${index}:creature-profile`);
  return WILD_CREATURE_BATTLE_PROFILES[Math.floor(rng() * WILD_CREATURE_BATTLE_PROFILES.length) % WILD_CREATURE_BATTLE_PROFILES.length];
}

function wildCreatureProfileForParty(party = {}, index = 0) {
  return wildCreatureBattleProfile([
    party.species,
    party.visual,
    party.typeName,
    party.id,
    party.name,
    party.homeSiteId,
    party.destinationSiteId
  ].filter(Boolean).join(' '), index);
}

function wildCreatureEncounterId(profile = {}) {
  const visual = String(profile.visual || '').toLowerCase();
  if (visual === 'gecko') return 'gecko_pack';
  if (visual === 'firegecko' || visual === 'fire_gecko') return 'fire_gecko_ambush';
  if (visual === 'mutantant' || visual === 'mutant_ant') return 'mutant_ant_swarm';
  if (visual === 'ghoul') return 'ghoul_pack';
  return 'radscorpion_nest';
}

function retuneBattleActorVitals(actor = {}, hp = 40, atk = 8, speed = 1.8) {
  const oldMax = Math.max(1, Number(actor.maxHp || actor.hp || hp || 40));
  const nextMax = Math.max(oldMax, Math.round(Number(hp || oldMax)));
  const ratio = actor.dead ? 0 : clamp(Number(actor.hp || oldMax) / oldMax, 0, 1);
  actor.maxHp = nextMax;
  actor.hp = actor.dead ? 0 : Math.max(1, Math.round(nextMax * ratio));
  actor.atk = Math.max(Number(actor.atk || 0), Number(atk || 1));
  actor.speed = Math.max(Number(actor.speed || 0), Number(speed || 1.8));
}

function hostileBattleActorLoadout(group = '', index = 0) {
  if (group === 'mutants') return { weapon: index % 2 ? 'rifle' : 'axe', armor: 'combatArmor', boots: 'boots' };
  if (group === 'raiders') {
    const rows = [
      { weapon: 'rifle', armor: 'leather', helmet: 'helmet', boots: 'boots' },
      { weapon: 'shotgun', armor: 'leather', boots: 'boots' },
      { weapon: 'pistol', armor: 'leather', boots: 'boots' },
      { weapon: 'axe', armor: 'leather', boots: 'boots' }
    ];
    return rows[index % rows.length];
  }
  return {};
}

function normalizeBattleActorIdentity(actor = {}, index = 0) {
  const group = factionGroup(actor.faction || '');
  const seed = `${actor.id || ''} ${actor.species || ''} ${actor.visual || ''} ${actor.name || ''} ${actor.typeName || ''} ${actor.role || ''}`;
  if (group === 'wild') {
    const profile = wildCreatureBattleProfile(seed, index);
    const generic = /хищник|мутир|creature|monster|guard|охран|налет|напада/i.test(String(actor.name || ''));
    actor.name = generic ? (index === 0 ? profile.eliteName : profile.name) : actor.name;
    actor.role = 'monster';
    actor.species = profile.visual;
    actor.typeName = profile.typeName;
    actor.visual = profile.visual;
    actor.modelKey = '';
    actor.equipment = {};
    actor.loot = [];
    actor.canDialogue = false;
    actor.stationary = false;
    actor.tradeProfile = '';
    actor.traderStock = undefined;
    actor.traderBuyInterests = undefined;
    retuneBattleActorVitals(actor, profile.hp, profile.atk, profile.speed);
    return actor;
  }
  if (group === 'mutants') {
    actor.role = 'mutant';
    actor.typeName = actor.typeName || 'Супермутант';
    actor.visual = actor.visual || 'mutant';
    if (!actor.equipment || !Object.keys(actor.equipment).length) actor.equipment = hostileBattleActorLoadout(group, index);
    retuneBattleActorVitals(actor, 120, 18, 1.75);
    return actor;
  }
  if (group === 'raiders') {
    actor.role = 'raider';
    actor.typeName = actor.typeName || 'Рейдер';
    actor.visual = actor.visual || 'raider';
    if (!actor.equipment || !Object.keys(actor.equipment).length) actor.equipment = hostileBattleActorLoadout(group, index);
    retuneBattleActorVitals(actor, 55, 9, 2.45);
  }
  return actor;
}

function defaultState(globalMap = {}) {
  const sites = defaultSites(globalMap);
  const parties = defaultParties();
  for (const party of Object.values(parties)) {
    const home = sites[party.homeSiteId] || sites.settlement;
    party.x = Number(home?.x || party.x || 0);
    party.y = Number(home?.y || party.y || 0);
  }
  return {
    schema: SCHEMA,
    version: VERSION,
    worldHour: 0,
    lastTickAt: Date.now(),
    updatedAt: Date.now(),
    factions: defaultFactions(),
    sites,
    parties,
    events: [],
    worldTasks: [],
    worldTaskHistory: [],
    worldZones: [],
    stats: {
      caravansArrived: 0,
      caravansLost: 0,
      battlesResolved: 0,
      resourceRaids: 0,
      resourceRaidsRepelled: 0,
      encountersResolved: 0,
      worldTasksCreated: 0,
      worldTasksCompleted: 0,
      worldTasksFailed: 0,
      worldTasksResolved: 0,
      resourcesDelivered: {}
    }
  };
}

function isFixedLairWorldZoneRecord(zone = {}) {
  if (!zone || typeof zone !== 'object') return false;
  const details = zone.details && typeof zone.details === 'object' ? zone.details : {};
  const kind = String(zone.kind || '').toLowerCase();
  const sourceType = String(zone.sourceType || '').toLowerCase();
  const id = String(zone.id || '');
  return !!(details.fixedLair
    || details.lair
    || kind === 'lair'
    || sourceType === 'lair'
    || id.startsWith('lair_'));
}

function isFixedLairWorldTaskRecord(task = {}) {
  if (!task || typeof task !== 'object') return false;
  const details = task.details && typeof task.details === 'object' ? task.details : {};
  const type = String(task.type || '').toLowerCase();
  const objective = String(task.objective || details.objective || '').toLowerCase();
  const zoneId = String(task.worldZoneId || details.worldZoneId || '');
  return !!(type === 'clear_lair'
    || objective === 'clear_visible_lair'
    || details.fixedLair
    || zoneId.startsWith('lair_'));
}

function normalizeState(input, globalMap = {}) {
  const base = defaultState(globalMap);
  const src = input && typeof input === 'object' ? input : {};
  const state = {
    ...base,
    ...src,
    schema: SCHEMA,
    version: VERSION,
    factions: { ...base.factions, ...(src.factions && typeof src.factions === 'object' ? src.factions : {}) },
    sites: { ...base.sites, ...(src.sites && typeof src.sites === 'object' ? src.sites : {}) },
    parties: { ...base.parties, ...(src.parties && typeof src.parties === 'object' ? src.parties : {}) },
    events: Array.isArray(src.events) ? src.events.slice(0, MAX_EVENT_COUNT).map(event => (
      event && typeof event === 'object'
        ? { ...event, title: localizeLegacyWorldText(event.title || '') }
        : event
    )) : [],
    worldTasks: Array.isArray(src.worldTasks) ? src.worldTasks : [],
    worldTaskHistory: Array.isArray(src.worldTaskHistory) ? src.worldTaskHistory : [],
    worldZones: Array.isArray(src.worldZones) ? src.worldZones.slice(0, MAX_WORLD_ZONE_COUNT) : [],
    stats: { ...base.stats, ...(src.stats && typeof src.stats === 'object' ? src.stats : {}) }
  };
  for (const [id, faction] of Object.entries(state.factions)) {
    const defaults = base.factions[id] || {};
    const currentName = String(faction?.name || '').trim();
    faction.id = safeId(faction?.id || id, id);
    faction.name = (!currentName || currentName === LEGACY_FACTION_NAMES[id])
      ? String(defaults.name || currentName || id).slice(0, 96)
      : currentName.slice(0, 96);
    faction.color = String(faction.color || defaults.color || '#9fd7ff').slice(0, 16);
    faction.relations = {
      ...(defaults.relations || {}),
      ...(faction.relations && typeof faction.relations === 'object' ? faction.relations : {})
    };
  }
  for (const [id, site] of Object.entries(state.sites)) {
    const defaults = base.sites[id] || {};
    site.id = safeId(site.id || id, id);
    site.type = String(site.type || 'pointOfInterest').slice(0, 32);
    if (defaults.type === 'production' && site.type === 'outpost') site.type = 'production';
    const currentName = String(site.name || '').trim();
    site.name = (!currentName || currentName === LEGACY_SITE_NAMES[id])
      ? String(defaults.name || currentName || id).slice(0, 96)
      : currentName.slice(0, 96);
    site.owner = safeId(site.owner || 'neutral', 'neutral');
    if (site.owner === 'neutral' && defaults.owner && defaults.owner !== 'neutral') {
      site.owner = safeId(defaults.owner, defaults.owner);
    }
    const nearCapitalLayoutVersion = Math.max(0, Math.floor(Number(defaults.nearCapitalLayoutVersion || 0)));
    const currentNearCapitalLayoutVersion = Math.max(0, Math.floor(Number(site.nearCapitalLayoutVersion || 0)));
    const refreshNearCapitalLayout = nearCapitalLayoutVersion > 0 && currentNearCapitalLayoutVersion < nearCapitalLayoutVersion;
    if (refreshNearCapitalLayout) {
      site.x = defaults.x;
      site.y = defaults.y;
      if (defaults.owner) site.owner = safeId(defaults.owner, defaults.owner);
      if (defaults.note) site.note = defaults.note;
      if (defaults.output && typeof defaults.output === 'object') site.output = { ...defaults.output };
      if (defaults.production && typeof defaults.production === 'object') site.production = { ...defaults.production };
      if (defaults.pvpMode) site.pvpMode = defaults.pvpMode;
      site.nearCapitalLayoutVersion = nearCapitalLayoutVersion;
    } else if (nearCapitalLayoutVersion > 0) {
      site.nearCapitalLayoutVersion = currentNearCapitalLayoutVersion || nearCapitalLayoutVersion;
    }
    const roadLayoutVersion = Math.max(0, Math.floor(Number(defaults.roadLayoutVersion || 0)));
    const currentRoadLayoutVersion = Math.max(0, Math.floor(Number(site.roadLayoutVersion || 0)));
    if (roadLayoutVersion > 0 && currentRoadLayoutVersion < roadLayoutVersion) {
      site.x = defaults.x;
      site.y = defaults.y;
      site.roadLayoutVersion = roadLayoutVersion;
    } else if (roadLayoutVersion > 0) {
      site.roadLayoutVersion = currentRoadLayoutVersion || roadLayoutVersion;
    }
    site.roadOutpost = isRoadOutpostSite(site);
    const isDistrictInterestSite = !!(site.districtInterest || defaults.districtInterest);
    const instanceLocationId = worldSiteLocationId(site.id);
    if (isDistrictInterestSite) {
      const legacyTemplateLocationId = site.locationId && site.locationId !== instanceLocationId ? site.locationId : '';
      site.templateLocationId = safeId(
        site.templateLocationId || legacyTemplateLocationId || defaults.templateLocationId || defaults.locationId || 'randomRuinedRoad',
        'randomRuinedRoad'
      );
      site.locationId = instanceLocationId;
      const defaultIdentityVersion = Math.max(0, Math.floor(Number(defaults.identityVersion || 0)));
      const currentIdentityVersion = Math.max(0, Math.floor(Number(site.identityVersion || 0)));
      if (defaultIdentityVersion > currentIdentityVersion) {
        site.name = String(defaults.name || site.name || site.id).slice(0, 96);
        site.note = String(defaults.note || site.note || '').slice(0, 240);
        site.description = String(defaults.description || defaults.note || site.description || site.note || '').slice(0, 480);
        site.landmark = String(defaults.landmark || site.landmark || '').slice(0, 80);
        site.sectorCode = String(defaults.sectorCode || site.sectorCode || '').slice(0, 24);
        site.identityVersion = defaultIdentityVersion;
      }
    } else {
      site.locationId = safeId(site.locationId || defaults.locationId || '', '');
      site.templateLocationId = safeId(site.templateLocationId || defaults.templateLocationId || '', '');
    }
    site.note = String(site.note || defaults.note || '').slice(0, 240);
    site.description = String(site.description || defaults.description || site.note || defaults.note || '').slice(0, 480);
    const normalizedPoint = globalMapCellCenter({
      x: Number.isFinite(Number(site.x)) ? Number(site.x) : 0,
      y: Number.isFinite(Number(site.y)) ? Number(site.y) : 0
    }, globalMap);
    const capitalClearPoint = !isFactionCapitalSite(site) && !isDistrictInterestSite && globalMapPointInCapitalClearZone(globalMap, normalizedPoint, CAPITAL_CLEAR_RADIUS_POINTS, site.id)
      ? nearestCapitalClearLandPoint(globalMap, normalizedPoint, site.id)
      : normalizedPoint;
    const point = !isFactionCapitalSite(site) && !isRoadOutpostSite(site) && globalMapPointInRoadCorridor(globalMap, capitalClearPoint)
      ? nearestRoadClearLandPoint(globalMap, capitalClearPoint, site.id)
      : capitalClearPoint;
    site.x = point.x;
    site.y = point.y;
    site.stockpile = { ...emptyStockpile(), ...(site.stockpile || {}) };
    site.resourceRichness = clamp(site.resourceRichness ?? defaults.resourceRichness ?? defaultResourceRichness(site), 0, 100);
    site.resourceDepletion = clamp(site.resourceDepletion ?? defaults.resourceDepletion ?? 0, 0, 100);
    site.workforce = clamp(site.workforce ?? defaults.workforce ?? (isHarvestSite(site) ? 45 : isProductionSite(site) ? 35 : 0), 0, 100);
    const computedActivity = resourceActivityPercent(site, Number(state.worldHour || 0));
    site.resourceActivity = clamp(
      isProductionSite(site) && Number(site.resourceActivity || 0) <= 0
        ? computedActivity
        : (site.resourceActivity ?? computedActivity),
      0,
      180
    );
    site.lastHarvestHour = Number.isFinite(Number(site.lastHarvestHour)) ? Number(site.lastHarvestHour) : 0;
    site.protectionLevel = clamp(site.protectionLevel ?? 0, 0, 100);
    site.protectedBySiteId = safeId(site.protectedBySiteId || '', '');
    site.raidUntil = Number.isFinite(Number(site.raidUntil)) ? Number(site.raidUntil) : 0;
    site.lastRaidHour = Number.isFinite(Number(site.lastRaidHour)) ? Number(site.lastRaidHour) : -999;
    site.lastRaidFaction = safeId(site.lastRaidFaction || '', '');
    const capitalProtected = protectFactionCapitalSite(site) || isCapitalProtectedSite(site);
    if (capitalProtected) {
      site.activeConflict = null;
      site.raidUntil = 0;
      site.lastRaidFaction = '';
      site.controlPressure = 0;
    }
    const rawConflict = site.activeConflict && typeof site.activeConflict === 'object' ? site.activeConflict : null;
    const conflictIsActive = rawConflict && rawConflict.active !== false && String(rawConflict.status || 'active') === 'active';
    const legacyRaidActive = !rawConflict && site.raidUntil > Number(state.worldHour || 0);
    if (conflictIsActive || legacyRaidActive) {
      const attackersRaw = conflictIsActive && Array.isArray(rawConflict.attackers) && rawConflict.attackers.length
        ? rawConflict.attackers
        : [{ faction: site.lastRaidFaction || 'wild', power: 36, source: 'legacy_raid', count: 1 }];
      site.activeConflict = {
        id: safeId(rawConflict?.id || `site_conflict_${site.id}_${Math.floor(Number(state.worldHour || 0) * 10)}`, `site_conflict_${site.id}`),
        active: true,
        kind: String(rawConflict?.kind || 'raid').slice(0, 32),
        status: 'active',
        startedHour: Number.isFinite(Number(rawConflict?.startedHour)) ? Number(rawConflict.startedHour) : Number(state.worldHour || 0),
        updatedHour: Number.isFinite(Number(rawConflict?.updatedHour)) ? Number(rawConflict.updatedHour) : Number(state.worldHour || 0),
        expiresHour: Number.isFinite(Number(rawConflict?.expiresHour))
          ? Math.max(Number(rawConflict.expiresHour), site.raidUntil || 0)
          : Math.max(site.raidUntil || 0, Number(state.worldHour || 0) + 10),
        ownerAtStart: safeId(rawConflict?.ownerAtStart || site.owner || 'neutral', 'neutral'),
        progress: clamp(rawConflict?.progress ?? Math.max(0, site.controlPressure || 0), -12, 18),
        attackers: attackersRaw
          .map((row, index) => ({
            faction: safeId(row?.faction || row?.targetFaction || site.lastRaidFaction || 'wild', 'wild'),
            power: clamp(row?.power ?? 24, 1, 500),
            partyId: safeId(row?.partyId || '', ''),
            source: String(row?.source || 'raid').slice(0, 32),
            count: Math.max(1, Math.floor(Number(row?.count || 1))),
            firstHour: Number.isFinite(Number(row?.firstHour)) ? Number(row.firstHour) : Number(rawConflict?.startedHour || state.worldHour || 0),
            lastHour: Number.isFinite(Number(row?.lastHour)) ? Number(row.lastHour) : Number(state.worldHour || 0),
            order: index
          }))
          .filter(row => row.faction && row.faction !== 'neutral')
          .slice(0, 8)
      };
      site.raidUntil = Math.max(site.raidUntil || 0, site.activeConflict.expiresHour || 0);
    } else {
      site.activeConflict = null;
      if (site.raidUntil <= Number(state.worldHour || 0)) site.raidUntil = 0;
    }
    site.traderProfiles = Array.isArray(site.traderProfiles) ? site.traderProfiles.map(x => safeId(x)).filter(Boolean) : [];
    site.output = site.output && typeof site.output === 'object'
      ? compactStockpile(site.output)
      : (defaults.output && typeof defaults.output === 'object' ? compactStockpile(defaults.output) : {});
    site.production = site.production && typeof site.production === 'object'
      ? compactStockpile(site.production)
      : (defaults.production && typeof defaults.production === 'object' ? compactStockpile(defaults.production) : {});
    site.productionCapabilities = (Array.isArray(site.productionCapabilities) && site.productionCapabilities.length
      ? site.productionCapabilities
      : (Array.isArray(defaults.productionCapabilities) ? defaults.productionCapabilities : []))
      .map(value => safeId(value, ''))
      .filter(Boolean)
      .slice(0, 12);
    site.productionQueue = (Array.isArray(site.productionQueue) ? site.productionQueue : [])
      .map((row, index) => ({
        id: safeId(row?.id || `production_${site.id}_${index}`, `production_${site.id}_${index}`),
        itemId: safeId(row?.itemId || row?.id || '', ''),
        outputQty: Math.max(1, Math.floor(Number(row?.outputQty || row?.qty || 1))),
        remainingHours: Math.max(0, Number(row?.remainingHours || 0)),
        workHours: Math.max(0.1, Number(row?.workHours || row?.remainingHours || 1)),
        priority: clamp(row?.priority ?? 50, 1, 100),
        reservedInputs: compactStockpile(row?.reservedInputs || row?.inputs || {}),
        createdHour: Number.isFinite(Number(row?.createdHour)) ? Number(row.createdHour) : Number(state.worldHour || 0)
      }))
      .filter(row => row.itemId && row.outputQty > 0)
      .slice(0, MAX_PRODUCTION_QUEUE_ROWS);
    site.productionDemand = compactStockpile(site.productionDemand || {});
    site.retailDemand = compactStockpile(site.retailDemand || {});
    site.retailMarkets = Object.fromEntries(Object.entries(site.retailMarkets && typeof site.retailMarkets === 'object' ? site.retailMarkets : {})
      .map(([key, market]) => {
        const normalized = normalizeRetailMarket(market, key);
        return normalized.key ? [normalized.key, normalized] : null;
      })
      .filter(Boolean)
      .slice(0, 24));
    site.supportDispatch = site.supportDispatch && typeof site.supportDispatch === 'object'
      ? {
          status: String(site.supportDispatch.status || '').slice(0, 32),
          reason: String(site.supportDispatch.reason || '').slice(0, 64),
          partyId: safeId(site.supportDispatch.partyId || '', ''),
          sourceSiteId: safeId(site.supportDispatch.sourceSiteId || '', ''),
          faction: safeId(site.supportDispatch.faction || site.owner || '', ''),
          createdHour: Number.isFinite(Number(site.supportDispatch.createdHour)) ? Number(site.supportDispatch.createdHour) : 0,
          arrivedHour: Number.isFinite(Number(site.supportDispatch.arrivedHour)) ? Number(site.supportDispatch.arrivedHour) : 0,
          crew: Math.max(0, Math.round(Number(site.supportDispatch.crew || 0))),
          workers: Array.isArray(site.supportDispatch.workers)
            ? site.supportDispatch.workers.map(normalizeSiteWorker).slice(0, 12)
            : [],
          cargo: compactStockpile(site.supportDispatch.cargo || {}),
          cost: compactStockpile(site.supportDispatch.cost || {})
        }
      : null;
    const legacyClaimScavengers = siteHasLegacyClaimScavengers(site, defaults);
    if (legacyClaimScavengers) site.needsCapitalSupport = true;
    const supportIsPending = site.supportDispatch
      && site.supportDispatch.status
      && site.supportDispatch.status !== 'arrived';
    const forceOwnerWorkers = ['raiders', 'mutants', 'wild'].includes(factionGroup(site.owner || 'neutral'));
    const workerSource = forceOwnerWorkers
      ? defaultSiteWorkers(site)
      : (legacyClaimScavengers || supportIsPending)
        ? []
      : Array.isArray(site.workers) && site.workers.length
      ? site.workers
      : (Array.isArray(defaults.workers) && defaults.workers.length ? defaults.workers : defaultSiteWorkers(site));
    site.workers = workerSource.slice(0, 12).map(normalizeSiteWorker);
    site.workSummary = siteWorkSummary(site);
    if (defaults.districtInterest || site.districtInterest) {
      site.districtInterest = true;
      site.activityKind = safeId(site.activityKind || defaults.activityKind || 'interest', 'interest');
      site.districtKey = String(site.districtKey || defaults.districtKey || '').slice(0, 24);
      site.districtX = Math.max(0, Math.floor(Number(site.districtX ?? defaults.districtX ?? 0)));
      site.districtY = Math.max(0, Math.floor(Number(site.districtY ?? defaults.districtY ?? 0)));
      site.interestCycle = Math.max(0, Math.floor(Number(site.interestCycle ?? defaults.interestCycle ?? 0)));
      site.interestExpiresHour = Number.isFinite(Number(site.interestExpiresHour ?? defaults.interestExpiresHour))
        ? Number(site.interestExpiresHour ?? defaults.interestExpiresHour)
        : 0;
      site.landmark = String(site.landmark || defaults.landmark || '').slice(0, 80);
      site.sectorCode = String(site.sectorCode || defaults.sectorCode || '').slice(0, 24);
      site.identityVersion = Math.max(0, Math.floor(Number(site.identityVersion || defaults.identityVersion || 0)));
    }
  }
  ensureUniqueWorldSiteLocationIds(state.sites);
  for (const [id, party] of Object.entries(state.parties)) {
    const defaults = base.parties[id] || {};
    party.id = safeId(party.id || id, id);
    const currentName = String(party.name || '').trim();
    party.name = (!currentName || currentName === LEGACY_PARTY_NAMES[id])
      ? String(defaults.name || currentName || id).slice(0, 96)
      : currentName.slice(0, 96);
    party.kind = String(party.kind || defaults.kind || 'party').slice(0, 32);
    party.faction = safeId(party.faction || defaults.faction || 'neutral', 'neutral');
    const partyFactionGroup = factionGroup(party.faction || defaults.faction || '');
    const partyKindLower = String(party.kind || '').toLowerCase();
    if (partyFactionGroup === 'mutants') {
      party.species = safeId(defaults.species || 'mutant', 'mutant');
    } else if (partyKindLower === 'monster' || partyFactionGroup === 'wild') {
      party.species = safeId(party.species || defaults.species || wildCreatureProfileForParty({ ...defaults, ...party }).visual || '', '');
    } else {
      party.species = safeId(defaults.species || '', '');
    }
    party.state = String(party.state || defaults.state || 'moving').slice(0, 32);
    party.stagingSiteId = safeId(party.stagingSiteId || '', '');
    party.stagingTaskId = safeId(party.stagingTaskId || '', '');
    party.stagingStartedHour = Number.isFinite(Number(party.stagingStartedHour)) ? Number(party.stagingStartedHour) : 0;
    party.stagingUntilHour = Number.isFinite(Number(party.stagingUntilHour)) ? Number(party.stagingUntilHour) : 0;
    party.stagingMinPlayers = Math.max(0, Math.floor(Number(party.stagingMinPlayers || 0)));
    party.stagingJoinClosed = !!party.stagingJoinClosed;
    party.recoverUntilHour = Number.isFinite(Number(party.recoverUntilHour)) ? Number(party.recoverUntilHour) : 0;
    party.homeSiteId = safeId(party.homeSiteId || defaults.homeSiteId || 'settlement', 'settlement');
    party.destinationSiteId = safeId(party.destinationSiteId || defaults.destinationSiteId || '', '');
    party.x = Number.isFinite(Number(party.x)) ? Number(party.x) : 0;
    party.y = Number.isFinite(Number(party.y)) ? Number(party.y) : 0;
    party.baseSpeedKmh = clamp(party.baseSpeedKmh || defaults.baseSpeedKmh || defaults.speedKmh || party.speedKmh || 20, 1, 90);
    party.speedKmh = normalizeWorldPartySpeedKmh(party, defaults);
    party.speedProfileVersion = WORLD_PARTY_SPEED_PROFILE_VERSION;
    party.strength = clamp(party.strength || defaults.strength || 10, 1, 500);
    party.members = clamp(party.members || defaults.members || 1, 0, 200);
    party.route = Array.isArray(party.route) && party.route.length
      ? party.route.map(x => safeId(x)).filter(Boolean)
      : (Array.isArray(defaults.route) ? defaults.route.slice() : []);
    if (Array.isArray(defaults.route) && defaults.route.length) {
      const defaultRoute = defaults.route.map(x => safeId(x)).filter(Boolean);
      const missingNewOutpost = defaultRoute.some(routeId => (routeId === 'scrapOutpost' || routeId === 'relayOutpost') && !party.route.includes(routeId));
      if (missingNewOutpost) party.route = defaultRoute.slice();
      for (const routeId of defaultRoute) {
        if (state.sites[routeId] && !party.route.includes(routeId)) party.route.push(routeId);
      }
    }
    party.routeIndex = Math.max(0, Math.floor(Number(party.routeIndex || 0)));
    const autonomyVersion = Math.max(0, Math.floor(Number(party.autonomyVersion || 0)));
    const refreshAutonomy = autonomyVersion < WORLD_PARTY_AUTONOMY_VERSION;
    party.targetPartyId = refreshAutonomy ? '' : safeId(party.targetPartyId || '', '');
    party.decisionKind = refreshAutonomy ? '' : safeId(party.decisionKind || '', '');
    party.decisionReason = refreshAutonomy ? '' : safeId(party.decisionReason || '', '');
    party.decisionScore = refreshAutonomy ? 0 : Number(party.decisionScore || 0);
    party.decisionAtHour = refreshAutonomy ? 0 : Number(party.decisionAtHour || 0);
    party.nextDecisionHour = refreshAutonomy ? 0 : Number(party.nextDecisionHour || 0);
    party.autonomyVersion = WORLD_PARTY_AUTONOMY_VERSION;
    party.siteExitIgnoreId = safeId(party.siteExitIgnoreId || '', '');
    party.siteExitIgnoreUntilHour = Number.isFinite(Number(party.siteExitIgnoreUntilHour)) ? Number(party.siteExitIgnoreUntilHour) : 0;
    party.siteVisitHours = Object.fromEntries(Object.entries(party.siteVisitHours && typeof party.siteVisitHours === 'object' ? party.siteVisitHours : {})
      .map(([siteId, visitHour]) => [safeId(siteId || '', ''), Number(visitHour)])
      .filter(([siteId, visitHour]) => siteId && Number.isFinite(visitHour))
      .sort((left, right) => right[1] - left[1])
      .slice(0, 24));
    const infrastructureLayoutVersion = Math.max(0, Math.floor(Number(party.infrastructureLayoutVersion || 0)));
    const refreshInfrastructureRoute = infrastructureLayoutVersion < WORLD_INFRASTRUCTURE_LAYOUT_VERSION;
    party.infrastructureRoutePoints = (refreshInfrastructureRoute ? [] : (Array.isArray(party.infrastructureRoutePoints) ? party.infrastructureRoutePoints : []))
      .slice(0, 160)
      .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    party.infrastructureRouteIndex = refreshInfrastructureRoute
      ? 1
      : Math.max(1, Math.floor(Number(party.infrastructureRouteIndex || 1)));
    party.infrastructureDestinationSiteId = refreshInfrastructureRoute
      ? ''
      : safeId(party.infrastructureDestinationSiteId || '', '');
    party.infrastructureAvoidanceSignature = refreshInfrastructureRoute
      ? ''
      : String(party.infrastructureAvoidanceSignature || '').slice(0, 480);
    party.infrastructureLayoutVersion = WORLD_INFRASTRUCTURE_LAYOUT_VERSION;
    party.cargo = party.cargo && typeof party.cargo === 'object' ? party.cargo : {};
    party.cargoCapacity = clamp(party.cargoCapacity || defaults.cargoCapacity || 0, 0, 1000);
    party.collectScale = clamp(party.collectScale || defaults.collectScale || 1, 0.1, 5);
    party.preferredResources = Array.isArray(party.preferredResources) && party.preferredResources.length
      ? party.preferredResources.map(x => safeId(x)).filter(Boolean)
      : (Array.isArray(defaults.preferredResources) ? defaults.preferredResources.slice() : []);
    party.supplyRole = safeId(party.supplyRole || defaults.supplyRole || '', '');
    party.respawnHours = clamp(party.respawnHours || defaults.respawnHours || PARTY_REFORM_HOURS[party.kind] || 24, 1, 240);
    party.inventory = Array.isArray(party.inventory)
      ? party.inventory
      : (Array.isArray(defaults.inventory) ? clone(defaults.inventory) : []);
    party.actorSnapshots = (Array.isArray(party.actorSnapshots) ? party.actorSnapshots : [])
      .slice(0, 16)
      .map((actor, index) => normalizeBattleActor(actor, index, state.worldHour))
      .filter(actor => actor && !actor.dead && Number(actor.hp || 0) > 0);
    party.engagedZoneId = safeId(party.engagedZoneId || '', '');
    party.engagedUntilHour = Number.isFinite(Number(party.engagedUntilHour)) ? Number(party.engagedUntilHour) : 0;
    party.onsiteZoneId = safeId(party.onsiteZoneId || '', '');
    party.onsiteSiteId = safeId(party.onsiteSiteId || '', '');
    party.onsiteReason = String(party.onsiteReason || '').slice(0, 48);
    party.onsiteUntilHour = Number.isFinite(Number(party.onsiteUntilHour)) ? Number(party.onsiteUntilHour) : 0;
    party.onsiteDepartureRequestedHour = Number.isFinite(Number(party.onsiteDepartureRequestedHour)) ? Number(party.onsiteDepartureRequestedHour) : 0;
    party.playerMembers = normalizePartyPlayerMembers(party, state.worldHour);
    party.dynamic = !!party.dynamic;
    party.respawnDisabled = !!party.respawnDisabled;
    party.supportSiteId = safeId(party.supportSiteId || '', '');
    party.supportWorkers = Array.isArray(party.supportWorkers)
      ? party.supportWorkers.map(normalizeSiteWorker).slice(0, 12)
      : [];
    party.supportCost = compactStockpile(party.supportCost || {});
    party.createdHour = Number.isFinite(Number(party.createdHour)) ? Number(party.createdHour) : 0;
  }
  for (const site of Object.values(state.sites)) {
    if (!site?.needsCapitalSupport) continue;
    delete site.needsCapitalSupport;
    if (!isJoinableWorldFaction(site.owner || '')) continue;
    if (site.supportDispatch && site.supportDispatch.status === 'moving') continue;
    dispatchSiteSupportFromCapital(state, site, site.owner, { reason: 'legacy_claim_migration' });
  }
  const normalizedWorldTasks = state.worldTasks
    .map(task => normalizeWorldTask(task, state.worldHour))
    .filter(task => {
      if (!task) return false;
      if (isFixedLairWorldTaskRecord(task)) return false;
      const site = state.sites[task.siteId];
      return !(isCapitalProtectedSite(site || { id: task.siteId }) && ['defend_resource', 'retake_site'].includes(String(task.type || '')));
    });
  const activeWorldTasks = normalizedWorldTasks.filter(task => task.status === 'active');
  const finishedWorldTasks = normalizedWorldTasks.filter(task => task.status !== 'active');
  state.worldTasks = [
    ...activeWorldTasks,
    ...finishedWorldTasks.slice(0, Math.max(0, MAX_WORLD_TASK_COUNT - activeWorldTasks.length))
  ];
  const historicalTasks = [
    ...state.worldTaskHistory,
    ...finishedWorldTasks
  ]
    .map(task => normalizeWorldTask(task, state.worldHour))
    .filter(task => task && task.status !== 'active')
    .sort((a, b) => Number(b.completedHour || b.createdHour || 0) - Number(a.completedHour || a.createdHour || 0));
  const historicalIds = new Set();
  state.worldTaskHistory = historicalTasks
    .filter(task => {
      if (historicalIds.has(task.id)) return false;
      historicalIds.add(task.id);
      return true;
    })
    .slice(0, MAX_WORLD_TASK_HISTORY_COUNT);
  pruneInvalidWorldPartyPlayerMembers(state);
  state.worldZones = state.worldZones
    .map(zone => normalizeWorldZone(zone, state.worldHour, globalMap))
    .filter(zone => {
      if (!zone) return false;
      if (isFixedLairWorldZoneRecord(zone)) return false;
      const siteId = zone.siteId || zone.sourceId || zone.details?.siteId;
      const site = state.sites[siteId];
      return !(isCapitalProtectedSite(site || { id: siteId }) && (zone.sourceType === 'site_conflict' || zone.details?.siteConflict));
    })
    .slice(0, MAX_WORLD_ZONE_COUNT);
  return state;
}

function createWastelandSimulation(options = {}) {
  const stateFile = options.stateFile || path.join(options.dataDir || process.cwd(), 'wasteland-sim.json');
  const gameDayRealMs = Math.max(60000, Number(options.gameDayRealMs || DEFAULT_GAME_DAY_REAL_MS));
  const saveIntervalMs = Math.max(3000, Number(options.saveIntervalMs || 15000));
  const getGlobalMap = typeof options.getGlobalMap === 'function' ? options.getGlobalMap : () => ({});
  const itemIds = options.itemIds instanceof Set ? options.itemIds : new Set(options.itemIds || []);
  const economyRecipes = normalizeRecipeCatalog(options.economyRecipes);
  const traderProfiles = normalizeTraderProfiles(options.traderProfiles);
  let state = normalizeState(readJson(stateFile, defaultState(getGlobalMap())), getGlobalMap());
  let dirty = false;
  let lastSaveAt = 0;
  let partyMovementTracks = new Map();

  function save(force = false) {
    const now = Date.now();
    if (!force && (!dirty || now - lastSaveAt < saveIntervalMs)) return false;
    state.updatedAt = now;
    writeJsonAtomic(stateFile, state);
    dirty = false;
    lastSaveAt = now;
    return true;
  }

  function addEvent(type, title, details = {}) {
    const event = {
      ...(details && typeof details === 'object' ? details : {}),
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: String(type || 'event').slice(0, 40),
      title: localizeLegacyWorldText(title || type || 'event').slice(0, 140),
      worldHour: Number(Number(state.worldHour || 0).toFixed(2)),
      at: Date.now()
    };
    state.events.unshift(event);
    state.events = state.events.slice(0, MAX_EVENT_COUNT);
    dirty = true;
    return event;
  }

  function realMinutesToWorldHours(minutes = 0) {
    return Math.max(0, Number(minutes || 0) * 60000 / gameDayRealMs * 24);
  }

  function rewardForWorldTask(type = '', site = {}, priority = 1) {
    const danger = clamp(site?.danger || 0, 0, 5);
    const p = clamp(priority, 0, 5);
    if (type === 'defend_resource') return { xp: 80 + Math.round(danger * 18 + p * 10), caps: 45 + Math.round(danger * 12 + p * 8), reputation: 2 };
    if (type === 'deliver_supplies') return { xp: 55 + Math.round(p * 10), caps: 28 + Math.round(p * 7), reputation: 1 };
    if (type === 'escort_caravan') return { xp: 90 + Math.round(p * 12), caps: 55 + Math.round(danger * 10 + p * 14), reputation: 2 };
    if (type === 'join_patrol') return { xp: 80 + Math.round(p * 14), caps: 42 + Math.round(p * 10), reputation: 2 };
    if (type === 'retake_site') return { xp: 120 + Math.round(danger * 20), caps: 70 + Math.round(danger * 16 + p * 10), reputation: 3 };
    if (type === 'clear_lair') return { xp: 135 + Math.round(danger * 18 + p * 16), caps: 85 + Math.round(danger * 14 + p * 12), reputation: 3 };
    return { xp: 50, caps: 20, reputation: 1 };
  }

  function worldTaskRewardFactionId(task = {}) {
    const party = task.partyId ? state.parties?.[task.partyId] : null;
    const issuer = task.issuerSiteId ? state.sites?.[task.issuerSiteId] : null;
    const target = task.siteId ? state.sites?.[task.siteId] : null;
    const candidates = isWorldPartyTask(task)
      ? [party?.faction, issuer?.owner, issuer?.faction, target?.owner, target?.faction, task.faction]
      : [issuer?.owner, issuer?.faction, target?.owner, target?.faction, task.faction, party?.faction];
    for (const candidate of candidates) {
      const factionId = factionGroup(candidate || '');
      if (isJoinableWorldFaction(factionId)) return factionId;
    }
    return '';
  }

  function backfillCompletedWorldTaskRewardFactions() {
    let changed = 0;
    for (const task of [
      ...(Array.isArray(state.worldTasks) ? state.worldTasks : []),
      ...(Array.isArray(state.worldTaskHistory) ? state.worldTaskHistory : [])
    ]) {
      if (!task || task.status !== 'completed' || Number(task.reward?.reputation || 0) <= 0) continue;
      task.details = task.details && typeof task.details === 'object' ? task.details : {};
      const frozenFactionId = factionGroup(task.details.rewardFactionId || '');
      if (isJoinableWorldFaction(frozenFactionId)) {
        if (task.details.rewardFactionId !== frozenFactionId) {
          task.details.rewardFactionId = frozenFactionId;
          changed += 1;
        }
        continue;
      }
      const rewardFactionId = worldTaskRewardFactionId(task);
      if (!rewardFactionId) continue;
      task.details.rewardFactionId = rewardFactionId;
      changed += 1;
    }
    if (changed > 0) {
      dirty = true;
      save(true);
    }
    return changed;
  }

  backfillCompletedWorldTaskRewardFactions();

  function worldTaskIssuerSiteId(type = '', site = null, data = {}) {
    const explicit = safeId(data.issuerSiteId || data.boardSiteId || '', '');
    if (explicit && state.sites[explicit]) return explicit;
    if (site && isSettlementServiceSite(site)) return site.id;
    if (site?.protectedBySiteId && state.sites[site.protectedBySiteId]) return site.protectedBySiteId;
    const targetOwner = site?.owner || 'old_klim';
    const candidates = Object.values(state.sites)
      .filter(row => row && isSettlementServiceSite(row))
      .map(row => {
        const dist = site ? pointDistanceKm(site, row, getGlobalMap()) : 0;
        const sameOwner = factionGroup(row.owner) === factionGroup(targetOwner) ? 0 : 1;
        const friendly = relation(row.owner, targetOwner) >= -10 ? 0 : 1;
        const typeScore = row.type === 'settlement' ? 0 : 0.25;
        return { row, score: sameOwner * 20 + friendly * 40 + dist + typeScore };
      })
      .sort((a, b) => a.score - b.score);
    return candidates[0]?.row?.id || 'settlement';
  }

  function archiveWorldTask(task = null) {
    const archived = normalizeWorldTask(task, state.worldHour);
    if (!archived || archived.status === 'active') return false;
    state.worldTaskHistory = [
      archived,
      ...(Array.isArray(state.worldTaskHistory) ? state.worldTaskHistory : [])
        .filter(row => row && String(row.id || '') !== archived.id)
    ]
      .sort((a, b) => Number(b.completedHour || b.createdHour || 0) - Number(a.completedHour || a.createdHour || 0))
      .slice(0, MAX_WORLD_TASK_HISTORY_COUNT);
    dirty = true;
    return true;
  }

  function compactWorldTasks() {
    const active = [];
    const finished = [];
    for (const task of Array.isArray(state.worldTasks) ? state.worldTasks : []) {
      if (!task) continue;
      if (task.status === 'active') active.push(task);
      else {
        archiveWorldTask(task);
        finished.push(task);
      }
    }
    const finishedLimit = Math.max(0, MAX_WORLD_TASK_COUNT - active.length);
    state.worldTasks = [...active, ...finished.slice(0, finishedLimit)];
  }

  function createWorldTask(type = 'world_task', data = {}) {
    const site = data.siteId ? state.sites[data.siteId] : null;
    const now = Number(state.worldHour || 0);
    const taskType = safeId(type, 'world_task');
    const key = String(data.key || [taskType, data.siteId || '', data.partyId || '', data.targetFaction || '', data.objective || ''].join(':')).slice(0, 140);
    const existing = state.worldTasks.find(task => task && task.status === 'active' && task.key === key && Number(task.expiresHour || 0) > now);
    if (existing) {
      existing.expiresHour = Math.max(Number(existing.expiresHour || 0), now + Math.max(8, Number(data.durationHours || 36)));
      existing.priority = clamp(Math.max(Number(existing.priority || 0), Number(data.priority || 1)), 0, 5);
      existing.text = String(data.text || existing.text || '').slice(0, 320);
      existing.issuerSiteId = worldTaskIssuerSiteId(taskType, site, data);
      dirty = true;
      return existing;
    }
    const priority = clamp(data.priority ?? 1, 0, 5);
    const task = normalizeWorldTask({
      id: `${taskType}_${safeId(data.siteId || data.partyId || 'world')}_${Math.floor(now * 10)}_${Math.random().toString(36).slice(2, 6)}`,
      key,
      type: taskType,
      status: 'active',
      title: data.title || taskType,
      text: data.text || '',
      siteId: data.siteId || '',
      issuerSiteId: worldTaskIssuerSiteId(taskType, site, data),
      partyId: data.partyId || '',
      targetFaction: data.targetFaction || '',
      objective: data.objective || '',
      createdHour: now,
      expiresHour: now + Math.max(8, Number(data.durationHours || 36)),
      priority,
      reward: data.reward || rewardForWorldTask(taskType, site, priority),
      details: data.details || {}
    }, now);
    if (!task) return null;
    state.worldTasks.unshift(task);
    compactWorldTasks();
    state.stats.worldTasksCreated = Number(state.stats.worldTasksCreated || 0) + 1;
    addEvent('world_task_added', `Новое задание: ${task.title}.`, {
      taskId: task.id,
      taskType: task.type,
      siteId: task.siteId,
      partyId: task.partyId
    });
    dirty = true;
    return task;
  }

  function finishWorldTask(task, status = 'completed', reason = '', details = {}) {
    if (!task || task.status !== 'active') return null;
    const nextStatus = String(status || 'completed').toLowerCase();
    task.status = ['completed', 'resolved', 'failed', 'expired'].includes(nextStatus)
      ? nextStatus
      : 'completed';
    task.completedHour = Number(state.worldHour || 0);
    const trustedGroupReward = task.status === 'completed' && isWorldPartyTask(task)
      ? {
        ...partyRewardPlayerDetails(state.parties[task.partyId] || {}, task.id),
        worldPartyRewardIntegrityVersion: WORLD_PARTY_REWARD_INTEGRITY_VERSION
      }
      : {};
    const rewardFactionId = task.status === 'completed'
      ? worldTaskRewardFactionId(task)
      : '';
    task.details = {
      ...(task.details || {}),
      finishReason: reason,
      ...details,
      ...trustedGroupReward,
      ...(rewardFactionId ? { rewardFactionId } : {})
    };
    removeWorldTaskPartyMembers(task);
    if (task.status === 'completed') state.stats.worldTasksCompleted = Number(state.stats.worldTasksCompleted || 0) + 1;
    else if (task.status === 'failed') state.stats.worldTasksFailed = Number(state.stats.worldTasksFailed || 0) + 1;
    else state.stats.worldTasksResolved = Number(state.stats.worldTasksResolved || 0) + 1;
    const eventType = task.status === 'completed'
      ? 'world_task_completed'
      : task.status === 'failed'
        ? 'world_task_failed'
        : 'world_task_resolved';
    const eventText = task.status === 'completed'
      ? 'Задание выполнено'
      : task.status === 'failed'
        ? 'Задание провалено'
        : 'Задание решено силами мира';
    addEvent(eventType, `${eventText}: ${task.title}.`, {
      taskId: task.id,
      taskType: task.type,
      siteId: task.siteId,
      reward: task.reward
    });
    archiveWorldTask(task);
    dirty = true;
    return task;
  }

  function finishActiveWorldTasks(filter, status = 'completed', reason = '', details = {}) {
    const finished = [];
    if (typeof filter !== 'function') return finished;
    for (const task of state.worldTasks) {
      if (!task || task.status !== 'active') continue;
      if (!filter(task)) continue;
      const row = finishWorldTask(task, status, reason, details);
      if (row) finished.push(row);
    }
    return finished;
  }

  function stableWorldRoomId(locationId = 'randomAshGrove', zoneId = 'zone') {
    const loc = safeId(locationId || 'randomAshGrove', 'randomAshGrove');
    const zone = safeId(zoneId || 'zone', 'zone');
    return `${loc}#${zone}`.slice(0, 96);
  }

  function sharedRealityRoomId(locationId = 'settlement') {
    return safeId(locationId || 'settlement', 'settlement').slice(0, 96);
  }

  function worldZoneRoomId(zone = {}, fallbackId = 'zone') {
    const locationId = worldZoneLocationId(zone);
    if (zone.sourceType === 'site_conflict'
      || zone.details?.siteConflict
      || zone.sourceType === 'party_onsite'
      || zone.details?.onsiteParty
      || zone.details?.siteLinkedClash) return sharedRealityRoomId(locationId);
    const existing = String(zone.roomId || '');
    if (existing && existing.startsWith(`${locationId}#`)) return existing;
    return stableWorldRoomId(locationId, zone.id || fallbackId);
  }

  function worldZoneEncounterId(zone = {}) {
    const partyId = safeId(zone.partyId || zone.sourceId || zone.details?.partyId || '', '');
    const party = partyId ? state.parties[partyId] : null;
    if (String(zone.kind || '').toLowerCase() === 'lair' && party) return partyMeetingEncounterId(party);
    return safeId(zone.encounterId || encounterIdForWorldContact(zone), 'caravan_patrol_vs_ghouls');
  }

  function worldZoneLocationId(zone = {}) {
    const siteId = safeId(zone.siteId || zone.details?.siteId || '', '');
    const linkedSite = siteId ? state.sites[siteId] : null;
    if (linkedSite?.locationId && (zone.sourceType === 'site_conflict'
      || zone.details?.siteConflict
      || zone.sourceType === 'party_onsite'
      || zone.details?.onsiteParty
      || zone.details?.siteLinkedClash)) {
      return safeId(linkedSite.locationId, 'randomAshGrove');
    }
    const partyId = safeId(zone.partyId || zone.sourceId || zone.details?.partyId || '', '');
    const party = partyId ? state.parties[partyId] : null;
    if (String(zone.kind || '').toLowerCase() === 'lair' && party) {
      const slot = fixedLairSlotForParty(party);
      if (slot?.locationId) return safeId(slot.locationId, 'randomAshGrove');
      return safeId(lairLocationIdForParty(party), 'randomAshGrove');
    }
    return safeId(zone.locationId || locationIdForWorldContact({ ...zone, encounterId: worldZoneEncounterId(zone) }), 'randomAshGrove');
  }

  function worldZoneById(id = '') {
    const key = safeId(id, '');
    if (!key) return null;
    const zone = (Array.isArray(state.worldZones) ? state.worldZones : []).find(row => row && row.id === key) || null;
    if (zone) ensureCaravanBattleMerchant(zone);
    if (zone) refreshSiteConflictZoneActors(zone);
    return zone;
  }

  function isDeprecatedPartyMeetingZone(zone = {}) {
    if (!zone || typeof zone !== 'object') return false;
    const id = String(zone.id || '');
    return id.startsWith('party_meeting_')
      || String(zone.sourceType || '') === 'party_zone'
      || zone.details?.deprecatedPartyEncounter === true;
  }

  function cleanupDeprecatedPartyMeetingZones() {
    const before = Array.isArray(state.worldZones) ? state.worldZones.length : 0;
    state.worldZones = (Array.isArray(state.worldZones) ? state.worldZones : [])
      .filter(zone => !isDeprecatedPartyMeetingZone(zone));
    if (state.worldZones.length !== before) {
      dirty = true;
      return true;
    }
    return false;
  }

  function cleanupFinishedTransientWorldZones() {
    const before = Array.isArray(state.worldZones) ? state.worldZones.length : 0;
    state.worldZones = (Array.isArray(state.worldZones) ? state.worldZones : [])
      .filter(zone => {
        if (!zone || typeof zone !== 'object') return false;
        if (zone.details?.fixedLair) return true;
        const status = String(zone.status || 'active');
        if (status !== 'resolved' && status !== 'expired') return true;
        return false;
      });
    if (state.worldZones.length !== before) {
      dirty = true;
      return true;
    }
    return false;
  }

  function cleanupFixedLairWorldArtifacts() {
    const beforeZones = Array.isArray(state.worldZones) ? state.worldZones.length : 0;
    const beforeTasks = Array.isArray(state.worldTasks) ? state.worldTasks.length : 0;
    state.worldZones = (Array.isArray(state.worldZones) ? state.worldZones : [])
      .filter(zone => !isFixedLairWorldZoneRecord(zone));
    state.worldTasks = (Array.isArray(state.worldTasks) ? state.worldTasks : [])
      .filter(task => !isFixedLairWorldTaskRecord(task));
    const changed = state.worldZones.length !== beforeZones || state.worldTasks.length !== beforeTasks;
    if (changed) dirty = true;
    return changed;
  }

  function normalizeDistrictInterestSite(input = {}, prev = {}) {
    const id = safeId(input.id || prev.id || 'district_interest', 'district_interest');
    const instanceLocationId = worldSiteLocationId(id);
    const legacyTemplateLocationId = prev.locationId && prev.locationId !== instanceLocationId ? prev.locationId : '';
    const site = {
      ...prev,
      ...input,
      id,
      type: normalizeSiteType(input.type || prev.type || 'pointOfInterest'),
      name: String(input.name || prev.name || 'Точка интереса').slice(0, 96),
      owner: safeId(input.owner || prev.owner || 'neutral', 'neutral'),
      pvpMode: normalizePvpMode(input.pvpMode || prev.pvpMode || 'pvp'),
      locationId: instanceLocationId,
      templateLocationId: safeId(
        input.templateLocationId || prev.templateLocationId || legacyTemplateLocationId || 'randomRuinedRoad',
        'randomRuinedRoad'
      ),
      note: String(input.note || prev.note || '').slice(0, 240),
      description: String(input.description || input.note || prev.description || prev.note || '').slice(0, 480),
      landmark: String(input.landmark || prev.landmark || '').slice(0, 80),
      sectorCode: String(input.sectorCode || prev.sectorCode || '').slice(0, 24),
      identityVersion: Math.max(0, Math.floor(Number(input.identityVersion || prev.identityVersion || 0))),
      stockpile: { ...emptyStockpile(), ...(input.stockpile || {}) },
      output: compactStockpile(input.output || {}),
      production: {},
      traderProfiles: [],
      workers: [],
      supportDispatch: null,
      activeConflict: prev.activeConflict && String(prev.activeConflict.status || 'active') === 'active' ? prev.activeConflict : null,
      raidUntil: prev.activeConflict ? Number(prev.raidUntil || 0) : 0,
      lastRaidFaction: prev.activeConflict ? safeId(prev.lastRaidFaction || '', '') : '',
      districtInterest: true,
      activityKind: safeId(input.activityKind || prev.activityKind || 'interest', 'interest'),
      districtKey: String(input.districtKey || prev.districtKey || '').slice(0, 24),
      districtX: Math.max(0, Math.floor(Number(input.districtX ?? prev.districtX ?? 0))),
      districtY: Math.max(0, Math.floor(Number(input.districtY ?? prev.districtY ?? 0))),
      interestCycle: Math.max(0, Math.floor(Number(input.interestCycle ?? prev.interestCycle ?? 0))),
      interestExpiresHour: Number.isFinite(Number(input.interestExpiresHour ?? prev.interestExpiresHour))
        ? Number(input.interestExpiresHour ?? prev.interestExpiresHour)
        : 0
    };
    const globalMap = getGlobalMap();
    const normalizedPoint = globalMapCellCenter({ x: input.x ?? prev.x ?? 0, y: input.y ?? prev.y ?? 0 }, globalMap);
    const point = globalMapPointInRoadCorridor(globalMap, normalizedPoint)
      ? nearestRoadClearLandPoint(globalMap, normalizedPoint, site.id)
      : normalizedPoint;
    site.x = point.x;
    site.y = point.y;
    site.danger = clamp(input.danger ?? prev.danger ?? 1, 0, 5);
    site.security = clamp(input.security ?? prev.security ?? siteDefaultSecurityFallback(site), 0, 100);
    site.prosperity = clamp(input.prosperity ?? prev.prosperity ?? 0, 0, 100);
    site.controlPressure = clamp(prev.activeConflict ? (prev.controlPressure ?? 0) : 0, -30, 30);
    site.resourceRichness = clamp(input.resourceRichness ?? prev.resourceRichness ?? defaultResourceRichness(site), 0, 100);
    site.resourceDepletion = clamp(input.resourceDepletion ?? prev.resourceDepletion ?? 0, 0, 100);
    site.workforce = clamp(input.workforce ?? prev.workforce ?? (isHarvestSite(site) ? 12 : 0), 0, 100);
    site.resourceActivity = resourceActivityPercent(site, state.worldHour);
    site.workers = (Array.isArray(input.workers) && input.workers.length
      ? input.workers
      : (Array.isArray(prev.workers) && prev.workers.length ? prev.workers : defaultSiteWorkers(site)))
      .slice(0, 12)
      .map(normalizeSiteWorker);
    site.workSummary = siteWorkSummary(site);
    return site;
  }

  function maintainDistrictInterestSites(hours = 0) {
    void hours;
    const reservedSites = Object.fromEntries(Object.entries(state.sites || {}).filter(([, site]) => site && !site.districtInterest));
    const expected = districtInterestSites(getGlobalMap(), state.worldHour, reservedSites);
    const expectedIds = new Set(Object.keys(expected));
    for (const [id, next] of Object.entries(expected)) {
      const prev = state.sites[id] || {};
      const activeConflict = prev.activeConflict && String(prev.activeConflict.status || 'active') === 'active';
      const needsRefresh = !prev.id
        || !prev.districtInterest
        || Number(prev.interestCycle ?? -1) !== Number(next.interestCycle ?? 0)
        || String(prev.activityKind || '') !== String(next.activityKind || '')
        || String(prev.name || '') !== String(next.name || '')
        || String(prev.note || '') !== String(next.note || '')
        || String(prev.description || '') !== String(next.description || '')
        || Number(prev.identityVersion || 0) !== Number(next.identityVersion || 0)
        || String(prev.locationId || '') !== String(next.locationId || '')
        || String(prev.templateLocationId || '') !== String(next.templateLocationId || '')
        || Math.abs(Number(prev.x || 0) - Number(next.x || 0)) > 0.1
        || Math.abs(Number(prev.y || 0) - Number(next.y || 0)) > 0.1;
      if (!needsRefresh || activeConflict) continue;
      state.sites[id] = normalizeDistrictInterestSite(next, prev);
      dirty = true;
    }
    for (const [id, site] of Object.entries(state.sites || {})) {
      if (!site?.districtInterest || expectedIds.has(id)) continue;
      if (site.activeConflict && String(site.activeConflict.status || 'active') === 'active') continue;
      delete state.sites[id];
      dirty = true;
    }
    if (ensureUniqueWorldSiteLocationIds(state.sites)) dirty = true;
  }

  function normalizeSharedRealityWorldZoneRooms() {
    let changed = false;
    (Array.isArray(state.worldZones) ? state.worldZones : []).forEach(zone => {
      if (!zone || typeof zone !== 'object') return;
      if (zone.sourceType !== 'site_conflict'
        && !zone.details?.siteConflict
        && zone.sourceType !== 'party_onsite'
        && !zone.details?.onsiteParty
        && !zone.details?.siteLinkedClash) return;
      const locationId = worldZoneLocationId(zone);
      if (zone.locationId !== locationId) {
        zone.locationId = locationId;
        changed = true;
      }
      const expected = sharedRealityRoomId(locationId);
      if (zone.roomId !== expected) {
        zone.roomId = expected;
        changed = true;
      }
    });
    if (changed) dirty = true;
    return changed;
  }

  function worldZoneReferencesParty(zone = {}, partyId = '') {
    const key = safeId(partyId, '');
    if (!key || !zone) return false;
    const sourceParts = String(zone.sourceId || '').split(':').filter(Boolean);
    const joinedPartyIds = [
      ...(Array.isArray(zone.details?.joinedPartyIds) ? zone.details.joinedPartyIds : []),
      ...(Array.isArray(zone.details?.joinedParties) ? zone.details.joinedParties.map(row => row?.partyId) : [])
    ].map(id => safeId(id || '', '')).filter(Boolean);
    return String(zone.partyId || '') === key
      || String(zone.threatPartyId || '') === key
      || String(zone.details?.partyId || '') === key
      || String(zone.details?.threatPartyId || '') === key
      || String(zone.details?.sourcePartyId || '') === key
      || joinedPartyIds.includes(key)
      || sourceParts.includes(key);
  }

  function cleanupDestroyedPartyWorldZones() {
    const destroyed = new Set(Object.values(state.parties || {})
      .filter(party => party && (party.destroyed || party.state === 'destroyed'))
      .map(party => String(party.id || ''))
      .filter(Boolean));
    if (!destroyed.size) return false;
    const changed = markWorldZonesLooted(zone => {
      if (!zone || zone.status !== 'active') return false;
      for (const partyId of destroyed) {
        if (worldZoneReferencesParty(zone, partyId)) return true;
      }
      return false;
    }, { reason: 'destroyed_party_cleanup' });
    return changed > 0;
  }

  function normalizePartyClashZones() {
    let changed = false;
    const now = Number(state.worldHour || 0);
    (Array.isArray(state.worldZones) ? state.worldZones : []).forEach(zone => {
      if (!zone || zone.status !== 'active' || zone.sourceType !== 'party_clash') return;
      const leftParty = state.parties[safeId(zone.partyId || zone.details?.partyId || '', '')] || null;
      const rightParty = state.parties[safeId(zone.threatPartyId || zone.details?.threatPartyId || '', '')] || null;
      if (!leftParty || !rightParty) return;
      const site = partyClashSiteContext(leftParty, rightParty, zone);
      const distKm = pointDistanceKm(leftParty, rightParty, getGlobalMap());
      if (!site && distKm > PARTY_CLASH_ENGAGE_DISTANCE_KM) {
        zone.status = 'expired';
        zone.resolvedHour = now;
        zone.expiresHour = now;
        zone.details = {
          ...(zone.details || {}),
          invalidatedByRadius: true,
          invalidatedDistanceKm: Number(distKm.toFixed(2))
        };
        releaseEngagedParty(leftParty, zone.id);
        releaseEngagedParty(rightParty, zone.id);
        changed = true;
        return;
      }
      if (!site) return;
      const locationId = safeId(site.locationId || zone.locationId || '', 'randomAshGrove');
      const expectedRoomId = sharedRealityRoomId(locationId);
      const sides = partyClashSides(leftParty, rightParty, site);
      const defenderParty = sides.left === 'defender' ? leftParty : rightParty;
      const attackerParty = sides.left === 'attacker' ? leftParty : rightParty;
      if (zone.siteId !== site.id
        || zone.locationId !== locationId
        || zone.roomId !== expectedRoomId
        || zone.faction !== defenderParty.faction
        || zone.targetFaction !== attackerParty.faction
        || !zone.details?.siteLinkedClash
        || Number(zone.details?.partyClashActorsVersion || 0) !== PARTY_CLASH_ACTORS_VERSION) {
        zone.siteId = site.id;
        zone.locationId = locationId;
        zone.roomId = expectedRoomId;
        zone.faction = defenderParty.faction || '';
        zone.targetFaction = attackerParty.faction || '';
        zone.title = `Стычка у локации: ${site.name || site.id}`;
        zone.text = `${leftParty.name || leftParty.id} и ${rightParty.name || rightParty.id} сцепились у ${site.name || site.id}. Внутри локации идет живой бой.`;
        zone.details = {
          ...(zone.details || {}),
          siteLinkedClash: true,
          siteId: site.id,
          siteName: site.name || '',
          locationId,
          partyClashActorsVersion: PARTY_CLASH_ACTORS_VERSION,
          partySides: {
            ...(zone.details?.partySides || {}),
            [leftParty.id]: sides.left,
            [rightParty.id]: sides.right
          },
          actors: buildPartyClashActors(leftParty, rightParty, site, zone.details?.actors || [])
        };
        changed = true;
      }
    });
    if (changed) dirty = true;
    return changed;
  }

  function cleanupWorldZonesForSingleReality() {
    const a = cleanupDeprecatedPartyMeetingZones();
    const b = cleanupFinishedTransientWorldZones();
    const c = normalizePartyClashZones();
    const d = normalizeSharedRealityWorldZoneRooms();
    const e = cleanupDestroyedPartyWorldZones();
    return a || b || c || d || e;
  }

  function activeBattleZoneForParty(partyId = '') {
    const key = safeId(partyId, '');
    if (!key) return null;
    const now = Number(state.worldHour || 0);
    const zone = (Array.isArray(state.worldZones) ? state.worldZones : []).find(row => row
      && row.status === 'active'
      && (!Number(row.expiresHour || 0) || Number(row.expiresHour || 0) > now)
      && (row.details?.simBattle || row.details?.partyEncounter)
      && worldZoneReferencesParty(row, key)) || null;
    if (zone) ensureCaravanBattleMerchant(zone);
    if (zone) refreshSiteConflictZoneActors(zone);
    return zone;
  }

  function activeBattleZoneForRoom(roomId = '') {
    const key = String(roomId || '').trim();
    if (!key) return null;
    const now = Number(state.worldHour || 0);
    const zone = (Array.isArray(state.worldZones) ? state.worldZones : []).find(zone => zone
      && zone.status === 'active'
      && (!Number(zone.expiresHour || 0) || Number(zone.expiresHour || 0) > now)
      && (zone.details?.simBattle || zone.details?.partyEncounter)
      && String(zone.roomId || stableWorldRoomId(worldZoneLocationId(zone), zone.id)) === key) || null;
    if (zone) ensureCaravanBattleMerchant(zone);
    if (zone) refreshSiteConflictZoneActors(zone);
    return zone;
  }

  function caravanBattleDefenderActors(party = {}) {
    const count = Math.max(3, Math.min(7, Math.round(Number(party.members || 4))));
    const actors = [caravanMerchantActor(party, {
      tx: 18,
      tz: 18,
      hp: 52,
      maxHp: 52,
      atk: 5,
      stationary: false
    })];
    const loadouts = [
      { weapon: 'rifle', armor: 'leather', helmet: 'helmet', boots: 'boots' },
      { weapon: 'shotgun', armor: 'ballisticVest', helmet: 'helmet', boots: 'boots' },
      { weapon: 'pistol', armor: 'leather', helmet: 'helmet', boots: 'boots' },
      { weapon: 'assaultRifle', armor: 'combatArmor', helmet: 'assaultHelmet', boots: 'reinforcedBoots' }
    ];
    for (let i = 1; i < count; i++) {
      actors.push({
        id: `${party.id}_guard_${i}`,
        side: 'defender',
        name: i === 1 ? 'Старший охранник каравана' : 'Охранник каравана',
        faction: party.faction || 'caravans',
        role: 'guard',
        tx: 14 + (i % 3) * 2,
        tz: 17 + Math.floor(i / 3) * 3,
        hp: 56 + Math.min(20, Number(party.strength || 40) * 0.12),
        maxHp: 56 + Math.min(20, Number(party.strength || 40) * 0.12),
        atk: 8 + Math.min(7, Number(party.strength || 40) / 18),
        equipment: loadouts[i % loadouts.length],
        loot: []
      });
    }
    return actors;
  }

  function caravanBattleAttackerActors(threatParty = {}, threat = {}) {
    const faction = factionGroup(threatParty.faction || threat.threatFaction || 'raiders');
    const count = Math.max(3, Math.min(8, Math.round(Number(threatParty.members || 4))));
    const isWild = faction === 'wild' || String(threatParty.kind || '') === 'monster';
    const isMutant = faction === 'mutants';
    const actors = [];
    for (let i = 0; i < count; i++) {
      const base = {
        id: `${threatParty.id || 'threat'}_${i}`,
        side: 'attacker',
        faction: threatParty.faction || threat.threatFaction || 'raiders',
        tx: 23 + (i % 4),
        tz: 16 + Math.floor(i / 4) * 3,
        hp: isMutant ? 110 : isWild ? 58 : 56,
        maxHp: isMutant ? 110 : isWild ? 58 : 56,
        atk: isMutant ? 16 : isWild ? 11 : 10,
        loot: []
      };
      if (isMutant) {
        actors.push({ ...base, name: i === 0 ? 'Супермутант-налетчик' : 'Супермутант', role: 'mutant', typeName: 'Супермутант', equipment: { weapon: i % 2 ? 'rifle' : 'axe', armor: 'combatArmor', boots: 'boots' } });
      } else if (isWild) {
        const profile = wildCreatureProfileForParty(threatParty, i);
        actors.push({
          ...base,
          name: i === 0 ? profile.eliteName : profile.name,
          role: 'monster',
          species: profile.visual,
          typeName: profile.typeName,
          visual: profile.visual,
          equipment: {}
        });
      } else {
        const loadouts = [
          { weapon: 'rifle', armor: 'leather', helmet: 'helmet', boots: 'boots' },
          { weapon: 'shotgun', armor: 'leather', boots: 'boots' },
          { weapon: 'pistol', armor: 'leather', boots: 'boots' },
          { weapon: 'axe', armor: 'leather', boots: 'boots' }
        ];
        actors.push({ ...base, name: i === 0 ? 'Рейдер-налетчик' : 'Рейдер', role: 'raider', typeName: 'Рейдер', equipment: loadouts[i % loadouts.length], loot: [] });
      }
    }
    return actors;
  }

  function loadoutForFaction(faction = '', index = 0, role = '') {
    const group = factionGroup(faction);
    if (group === 'mutants') return { weapon: index % 2 ? 'rifle' : 'axe', armor: 'combatArmor', boots: 'boots' };
    if (group === 'raiders') {
      const rows = [
        { weapon: 'rifle', armor: 'leather', helmet: 'helmet', boots: 'boots' },
        { weapon: 'shotgun', armor: 'leather', boots: 'boots' },
        { weapon: 'pistol', armor: 'leather', boots: 'boots' },
        { weapon: 'axe', armor: 'leather', boots: 'boots' }
      ];
      return rows[index % rows.length];
    }
    if (group === 'wild') return {};
    if (role === 'merchant') return { weapon: 'pistol', armor: 'leather', boots: 'boots', backpack: 'backpack' };
    const rows = [
      { weapon: 'rifle', armor: 'leather', helmet: 'helmet', boots: 'boots' },
      { weapon: 'shotgun', armor: 'ballisticVest', helmet: 'helmet', boots: 'boots' },
      { weapon: 'pistol', armor: 'leather', helmet: 'helmet', boots: 'boots' },
      { weapon: 'assaultRifle', armor: 'combatArmor', helmet: 'assaultHelmet', boots: 'reinforcedBoots' }
    ];
    return rows[index % rows.length];
  }

  function actorNameForFaction(faction = '', index = 0, role = '') {
    const group = factionGroup(faction);
    if (role === 'merchant') return 'Караванщик';
    if (group === 'old_klim') return index === 0 ? 'Старший патрульный Старого Клима' : 'Патрульный Старого Клима';
    if (group === 'scrap_union') return index === 0 ? 'Старший ополченец Свалочного поста' : 'Ополченец Свалочного поста';
    if (group === 'relay_order') return index === 0 ? 'Старший техник-охранник' : 'Охранник ретранслятора';
    if (group === 'caravans') return index === 0 ? 'Старший охранник каравана' : 'Охранник каравана';
    if (group === 'mutants') return index === 0 ? 'Супермутант-вожак' : 'Супермутант';
    if (group === 'raiders') return index === 0 ? 'Рейдер-вожак' : 'Рейдер';
    return index === 0 ? 'Хищник пустоши' : 'Мутировавшее существо';
  }

  function factionStartsHostileToPlayer(faction = '') {
    const group = factionGroup(faction);
    return group === 'raiders' || group === 'mutants' || group === 'wild';
  }

  function protectedBySite(site = {}) {
    const protectorId = safeId(site.protectedBySiteId || '', '');
    if (!protectorId) return null;
    const protector = state.sites[protectorId] || null;
    if (!protector || !protector.owner) return null;
    if (!isJoinableWorldFaction(protector.owner)) return null;
    return protector;
  }

  function stockpileItemTradePrice(itemId = '') {
    const id = safeId(itemId || '');
    const prices = {
      water: 6,
      oil: 10,
      wood: 3,
      ore: 4,
      scrap: 4,
      chemicals: 7,
      medicine: 12,
      electronics: 9,
      ammoParts: 3,
      ammo9: 3,
      ammo556: 5,
      shotgunShell: 6,
      energyCell: 5,
      napalm: 7,
      repairKit: 22,
      weaponParts: 18
    };
    return prices[id] || 5;
  }

  function stockpileTradeRows(stockpile = {}) {
    return Object.entries(compactStockpile(stockpile || {}))
      .map(([id, qty]) => ({
        id,
        qty: Math.max(0, Math.floor(Number(qty || 0))),
        price: stockpileItemTradePrice(id)
      }))
      .filter(row => row.qty > 0);
  }

  function partyTraderStockRows(party = {}) {
    return mergeStockRows([
      ...(Array.isArray(party.inventory) ? party.inventory : []),
      ...stockpileTradeRows(party.cargo || {})
    ]).slice(0, 32);
  }

  function caravanMerchantActor(party = {}, overrides = {}) {
    const partyId = safeId(party.id || 'caravan', 'caravan');
    const faction = safeId(party.faction || 'caravans', 'caravans');
    const traderStock = partyTraderStockRows(party);
    const interests = Array.isArray(party.preferredResources) ? party.preferredResources.slice(0, 12) : [];
    const maxHp = Math.max(1, Number(overrides.maxHp ?? overrides.hp ?? 54));
    return {
      id: `${partyId}_merchant`,
      side: 'defender',
      name: 'Караванщик',
      typeName: 'Караванщик',
      faction,
      role: 'merchant',
      visual: 'caravanMerchant',
      modelKey: 'caravanMerchant',
      tx: overrides.tx ?? 18,
      tz: overrides.tz ?? 18,
      hp: Math.max(1, Number(overrides.hp ?? maxHp)),
      maxHp,
      atk: clamp(overrides.atk ?? 5, 1, 80),
      equipment: loadoutForFaction(faction, 0, 'merchant'),
      canDialogue: true,
      stationary: overrides.stationary ?? true,
      hostileToPlayer: false,
      tradeProfile: 'caravan',
      traderStock,
      traderBuyInterests: interests,
      inventory: [{
        id: 'silver',
        qty: Math.max(80, Math.round(120 + Number(party.strength || 40) * 3))
      }],
      inventoryVersion: NPC_CAPS_INVENTORY_VERSION,
      loot: traderStock.slice(0, 12).map(row => ({ id: row.id, qty: row.qty }))
    };
  }

  function ensureCaravanBattleMerchant(zone = null) {
    if (!zone || zone.status !== 'active' || !zone.details?.simBattle || String(zone.kind || '') !== 'caravan') return false;
    const party = state.parties[safeId(zone.partyId || zone.details?.partyId || '', '')] || null;
    if (!party || String(party.kind || '').toLowerCase() !== 'caravan') return false;
    const actors = Array.isArray(zone.details.actors) ? zone.details.actors : [];
    const template = caravanMerchantActor(party, { stationary: false });
    const existingIndex = actors.findIndex(actor => actor && (actor.id === template.id || String(actor.role || '').toLowerCase() === 'merchant'));
    if (existingIndex >= 0) {
      const previous = actors[existingIndex] || {};
      const dead = !!previous.dead || Number(previous.hp || template.hp) <= 0;
      const hp = dead ? 0 : clamp(previous.hp ?? template.hp, 1, template.maxHp);
      actors[existingIndex] = normalizeBattleActor({
        ...previous,
        ...template,
        hp,
        dead,
        diedHour: previous.diedHour || 0,
        inventory: Array.isArray(previous.inventory) ? previous.inventory : template.inventory,
        inventoryVersion: Array.isArray(previous.inventory)
          ? Math.max(0, Math.floor(Number(previous.inventoryVersion || 0)))
          : Number(template.inventoryVersion || 0)
      }, existingIndex, state.worldHour);
    } else {
      actors.unshift(normalizeBattleActor(template, 0, state.worldHour));
    }
    zone.details.actors = actors.map((actor, index) => normalizeBattleActor(actor, index, state.worldHour)).filter(Boolean);
    dirty = true;
    return true;
  }

  function partyIsHostileEncounterParty(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const group = factionGroup(party.faction || '');
    return ['raider', 'monster', 'hostile'].includes(kind) || ['raiders', 'mutants', 'wild'].includes(group);
  }

  function applyPartyActorSnapshots(party = {}, actors = []) {
    const snapshots = new Map((Array.isArray(party.actorSnapshots) ? party.actorSnapshots : [])
      .map(actor => [safeId(actor?.id || '', ''), actor])
      .filter(([id, actor]) => id && actor && !actor.dead && Number(actor.hp || 0) > 0));
    if (!snapshots.size) return actors;
    return actors.map(actor => {
      const snapshot = snapshots.get(safeId(actor?.id || '', ''));
      if (!snapshot) return actor;
      const maxHp = clamp(snapshot.maxHp ?? actor.maxHp ?? actor.hp ?? 40, 1, 400);
      return {
        ...actor,
        hp: clamp(snapshot.hp ?? maxHp, 1, maxHp),
        maxHp,
        equipment: snapshot.equipment && typeof snapshot.equipment === 'object' ? clone(snapshot.equipment) : actor.equipment,
        inventory: Array.isArray(snapshot.inventory) ? snapshot.inventory.map(row => ({ ...row })) : actor.inventory,
        inventoryVersion: Number(snapshot.inventoryVersion || actor.inventoryVersion || 0)
      };
    });
  }

  function partyEncounterActors(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const faction = party.faction || 'caravans';
    const group = factionGroup(faction);
    const hostileParty = partyIsHostileEncounterParty(party);
    const defaultMembers = Number(defaultParties()[party.id]?.members || 0);
    const rawMembers = Number(party.members || defaultMembers || (kind === 'patrol' ? 4 : 5));
    const minCount = hostileParty ? Math.max(3, Math.min(5, defaultMembers || 3)) : 2;
    const count = Math.max(minCount, Math.min(7, Math.round(rawMembers)));
    if (hostileParty) {
      return applyPartyActorSnapshots(party, caravanBattleAttackerActors({ ...party, members: count }, { threatFaction: faction })
        .slice(0, count)
        .map((actor, index) => ({
          ...actor,
          side: 'attacker',
          tx: 15 + (index % 4) * 2,
          tz: 16 + Math.floor(index / 4) * 3,
          hostileToPlayer: true,
          canDialogue: false,
          stationary: false,
          loot: Array.isArray(actor.loot) ? actor.loot : []
        })));
    }
    const actors = [];
    if (kind === 'caravan') {
      actors.push(caravanMerchantActor(party, { stationary: true }));
    }
    const guardCount = kind === 'caravan' ? Math.max(1, count - 1) : count;
    for (let i = 0; i < guardCount; i++) {
      actors.push({
        id: `${party.id}_${kind === 'patrol' ? 'patrol' : 'guard'}_${i}`,
        side: 'defender',
        name: actorNameForFaction(faction, i, 'guard'),
        faction,
        role: 'guard',
        tx: 14 + (i % 4) * 2,
        tz: 16 + Math.floor(i / 4) * 3,
        hp: 54 + Math.min(28, Number(party.strength || 45) * 0.18),
        maxHp: 54 + Math.min(28, Number(party.strength || 45) * 0.18),
        atk: 8 + Math.min(8, Number(party.strength || 45) / 18),
        equipment: loadoutForFaction(faction, i, 'guard'),
        canDialogue: true,
        loot: []
      });
    }
    return applyPartyActorSnapshots(party, actors);
  }

  function partyMeetingLocationId(party = {}) {
    const group = factionGroup(party.faction || '');
    if (String(party.kind || '').toLowerCase() === 'patrol') return 'randomAshGrove';
    if (group === 'mutants') return 'randomDryBasin';
    if (group === 'wild') return 'randomDryBasin';
    return 'randomRuinedRoad';
  }

  function partyMeetingRoomId(party = {}) {
    return stableWorldRoomId(partyMeetingLocationId(party), `party_${safeId(party.id || '', 'party')}`);
  }

  function partyMeetingEncounterId(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const group = factionGroup(party.faction || '');
    if (kind === 'patrol') return 'world_patrol_meeting';
    if (kind === 'caravan') return 'world_caravan_meeting';
    if (group === 'mutants') return 'super_mutant_lair';
    if (group === 'wild') return wildCreatureEncounterId(wildCreatureProfileForParty(party));
    return 'raider_ambush';
  }

  function partyEncounterSnapshot(partyId = '') {
    const key = safeId(partyId, '');
    const party = key ? state.parties[key] : null;
    if (!party || party.destroyed || party.state === 'destroyed') return null;
    const kind = String(party.kind || '').toLowerCase();
    const hostileParty = partyIsHostileEncounterParty(party);
    if (kind !== 'caravan' && kind !== 'patrol' && !hostileParty) return null;
    const actors = partyEncounterActors(party)
      .map((actor, index) => normalizeBattleActor(actor, index, state.worldHour))
      .filter(Boolean);
    return {
      id: party.id,
      name: party.name || '',
      kind,
      faction: party.faction || '',
      x: Number(party.x || 0),
      y: Number(party.y || 0),
      locationId: partyMeetingLocationId(party),
      roomId: partyMeetingRoomId(party),
      encounterId: partyMeetingEncounterId(party),
      pvpMode: 'pvp',
      actors
    };
  }

  function partyEncounterZoneId(party = {}) {
    return safeId(`party_encounter_${party.id || 'party'}`, `party_encounter_${party.id || 'party'}`);
  }

  function beginPartyEncounterZone(input = {}) {
    const partyId = safeId(input.partyId || input.worldPartyId || input.id || '', '');
    const party = partyId ? state.parties[partyId] : null;
    if (!party || party.destroyed || party.state === 'destroyed') return { ok: false, error: 'party_unavailable' };
    const existing = activeBattleZoneForParty(party.id);
    if (existing) return { ok: true, zone: existing };
    const kind = String(party.kind || '').toLowerCase();
    const hostileParty = partyIsHostileEncounterParty(party);
    if (kind !== 'caravan' && kind !== 'patrol' && !hostileParty) return { ok: false, error: 'party_not_encounterable' };
    const actors = partyEncounterActors(party)
      .map((actor, index) => normalizeBattleActor(actor, index, state.worldHour))
      .filter(Boolean);
    if (!actors.length) return { ok: false, error: 'party_has_no_actors' };
    const id = partyEncounterZoneId(party);
    const locationId = partyMeetingLocationId(party);
    const encounterId = partyMeetingEncounterId(party);
    const zone = upsertWorldZone({
      id,
      kind: hostileParty ? 'battle' : (kind === 'patrol' ? 'patrol' : 'caravan'),
      title: `Встреча: ${party.name || party.id}`,
      text: `${party.name || 'Отряд пустоши'} находится в живой встрече. Пока встреча активна, сам отряд снят с глобальной карты.`,
      x: party.x,
      y: party.y,
      radius: Math.max(9, Number(input.radius || 0)),
      priority: hostileParty ? 5 : 3,
      sourceType: 'player_party_encounter',
      sourceId: party.id,
      partyId: party.id,
      faction: party.faction || '',
      targetFaction: hostileParty ? (party.faction || '') : '',
      encounterId,
      locationId,
      roomId: stableWorldRoomId(locationId, id),
      pvpMode: 'pvp',
      durationHours: hostileParty ? 12 : 6,
      details: {
        partyEncounter: true,
        realTimePartyEncounter: true,
        simulationDisabled: true,
        playerInitiated: true,
        startedByPlayerId: safeId(input.playerId || input.ownerPlayerId || '', ''),
        startedByPlayerName: String(input.playerName || input.ownerName || '').slice(0, 64),
        partyId: party.id,
        partyKind: kind,
        partyName: party.name || '',
        createdFromWorldParty: true,
        actors
      }
    });
    party.state = 'engaged';
    party.engagedZoneId = zone.id;
    party.engagedUntilHour = Number(state.worldHour || 0) + Math.max(6, Number(input.durationHours || (hostileParty ? 12 : 6)));
    addEvent('party_encounter_started', `Встреча с отрядом: ${party.name || party.id}.`, {
      zoneId: zone.id,
      partyId: party.id,
      playerId: safeId(input.playerId || '', ''),
      x: Number(Number(party.x || 0).toFixed(1)),
      y: Number(Number(party.y || 0).toFixed(1))
    });
    dirty = true;
    return { ok: true, zone };
  }

  function mergeWorldZoneActorSnapshots(zone = {}, snapshots = []) {
    if (!zone || !zone.details || !Array.isArray(zone.details.actors) || !Array.isArray(snapshots) || !snapshots.length) return false;
    const byId = new Map();
    snapshots.forEach(row => {
      const id = safeId(row?.actorId || row?.worldBattleActorId || row?.id || '', '');
      if (id) byId.set(id, row);
    });
    if (!byId.size) return false;
    let changed = false;
    zone.details.actors = zone.details.actors.map((actor, index) => {
      const snapshot = byId.get(actor.id);
      if (!snapshot) return actor;
      const maxHp = clamp(snapshot.maxHp ?? actor.maxHp ?? actor.hp ?? 40, 1, 400);
      const hp = clamp(snapshot.hp ?? actor.hp ?? maxHp, 0, maxHp);
      const dead = !!snapshot.dead || hp <= 0;
      const diedHour = dead ? (actor.diedHour || Number(state.worldHour || 0)) : 0;
      const tx = Number.isFinite(Number(snapshot.tx)) ? clamp(Math.round(Number(snapshot.tx)), 0, 63) : actor.tx;
      const tz = Number.isFinite(Number(snapshot.tz)) ? clamp(Math.round(Number(snapshot.tz)), 0, 63) : actor.tz;
      const equipment = snapshot.equipment && typeof snapshot.equipment === 'object' ? clone(snapshot.equipment) : actor.equipment;
      const inventory = Array.isArray(snapshot.inventory) ? snapshot.inventory.map(row => ({ ...row })) : actor.inventory;
      const inventoryVersion = Math.max(0, Math.floor(Number(snapshot.inventoryVersion || actor.inventoryVersion || 0)));
      if (Number(actor.maxHp || 0) !== maxHp
        || Number(actor.hp || 0) !== hp
        || !!actor.dead !== dead
        || Number(actor.diedHour || 0) !== diedHour
        || Number(actor.tx || 0) !== Number(tx || 0)
        || Number(actor.tz || 0) !== Number(tz || 0)
        || JSON.stringify(actor.equipment || {}) !== JSON.stringify(equipment || {})
        || JSON.stringify(actor.inventory) !== JSON.stringify(inventory)
        || Number(actor.inventoryVersion || 0) !== inventoryVersion) changed = true;
      return normalizeBattleActor({ ...actor, maxHp, hp, dead, diedHour, tx, tz, equipment, inventory, inventoryVersion }, index, state.worldHour);
    });
    if (changed) dirty = true;
    return changed;
  }

  function syncOnsitePartyActors(context = {}) {
    const zoneId = safeId(context.worldZoneId || context.zoneId || '', '');
    const zone = zoneId ? worldZoneById(zoneId) : null;
    if (!zone || zone.status !== 'active' || !zone.details?.onsiteParty) return false;
    const changed = mergeWorldZoneActorSnapshots(zone, Array.isArray(context.actors) ? context.actors : []);
    if (changed) save(false);
    return changed;
  }

  function partyEncounterAliveActors(zone = {}) {
    return (Array.isArray(zone.details?.actors) ? zone.details.actors : [])
      .filter(actor => actor && !actor.dead && Number(actor.hp || 0) > 0);
  }

  function finishPartyEncounterZone(input = {}) {
    const zoneId = safeId(input.worldZoneId || input.zoneId || '', '');
    const zone = zoneId ? worldZoneById(zoneId) : activeBattleZoneForRoom(String(input.roomId || ''));
    if (!zone || zone.status !== 'active' || !zone.details?.partyEncounter) return { ok: false, error: 'party_encounter_not_active' };
    mergeWorldZoneActorSnapshots(zone, input.actors || []);
    const party = state.parties[safeId(zone.partyId || zone.details?.partyId || '', '')] || null;
    const aliveActors = partyEncounterAliveActors(zone);
    const deadActors = (Array.isArray(zone.details?.actors) ? zone.details.actors : [])
      .filter(actor => actor && (actor.dead || Number(actor.hp || 0) <= 0));
    const partyAlive = aliveActors.length > 0;
    zone.status = 'resolved';
    zone.resolvedHour = Number(state.worldHour || 0);
    zone.expiresHour = Number(state.worldHour || 0);
    zone.details = {
      ...(zone.details || {}),
      battleState: partyAlive ? 'party_left_alive' : 'party_destroyed',
      outcome: partyAlive ? 'party_left_alive' : 'party_destroyed',
      completedHour: Number(state.worldHour || 0),
      completedReason: String(input.reason || 'party_encounter_closed').slice(0, 64),
      aliveActorCount: aliveActors.length,
      deadActorCount: deadActors.length
    };
    if (party) {
      if (partyAlive) {
        if (deadActors.length > 0) {
          party.members = clamp(Number(party.members || 1) - deadActors.length, 1, 200);
          party.strength = clamp(Number(party.strength || 1) - deadActors.length * 4, 1, 500);
        }
        releaseEngagedParty(party, zone.id);
        if (String(party.kind || '').toLowerCase() === 'caravan' && deadActors.length > 0) {
          party.state = 'recovering';
          party.recoverUntilHour = Number(state.worldHour || 0) + realMinutesToWorldHours(CARAVAN_POST_BATTLE_REAL_MINUTES);
        }
      } else {
        destroyWorldParty(party, 'party_encounter_destroyed');
      }
    }
    addEvent(partyAlive ? 'party_encounter_closed' : 'world_party_destroyed', partyAlive
      ? `${party?.name || zone.title || 'Отряд'} вернулся на глобальную карту.`
      : `${party?.name || zone.title || 'Отряд'} уничтожен во встрече.`, {
      zoneId: zone.id,
      partyId: party?.id || zone.partyId || '',
      aliveActorCount: aliveActors.length,
      deadActorCount: deadActors.length,
      reason: String(input.reason || '').slice(0, 64)
    });
    dirty = true;
    return { ok: true, zone, party: party ? publicParty(party) : null, partyAlive };
  }

  function partyClashCandidateSiteIds(party = {}) {
    return [
      party.onsiteSiteId,
      party.supportSiteId,
      party.destinationSiteId,
      party.lastSiteId,
      party.homeSiteId
    ].map(id => safeId(id || '', '')).filter(Boolean);
  }

  function partyClashSiteContext(leftParty = {}, rightParty = {}, point = {}) {
    const globalMap = getGlobalMap();
    const ids = [...new Set([
      ...partyClashCandidateSiteIds(leftParty),
      ...partyClashCandidateSiteIds(rightParty)
    ])];
    let best = null;
    for (const id of ids) {
      const site = state.sites[id];
      if (!site || !site.locationId) continue;
      const distKm = pointDistanceKm(point, site, globalMap);
      const maxKm = Math.max(PARTY_CLASH_SITE_LINK_DISTANCE_KM, siteEntryRadiusKm(site, globalMap) + 4);
      if (distKm > maxKm) continue;
      if (!best || distKm < best.distKm) best = { site, distKm };
    }
    if (!best) {
      const nearest = nearestSite(point, site => site && site.locationId);
      if (nearest) {
        const maxKm = Math.max(siteEntryRadiusKm(nearest.site, globalMap) + 2, 6);
        if (nearest.distKm <= maxKm) best = nearest;
      }
    }
    return best?.site || null;
  }

  function partyClashSides(leftParty = {}, rightParty = {}, site = null) {
    const leftHostileToSite = !!(site?.owner && hostile(leftParty.faction, site.owner));
    const rightHostileToSite = !!(site?.owner && hostile(rightParty.faction, site.owner));
    let left = 'defender';
    let right = 'attacker';
    let includeSiteDefenders = false;

    if (site?.owner && leftHostileToSite !== rightHostileToSite) {
      left = leftHostileToSite ? 'attacker' : 'defender';
      right = rightHostileToSite ? 'attacker' : 'defender';
      includeSiteDefenders = true;
    } else if (site?.owner && !leftHostileToSite && !rightHostileToSite) {
      includeSiteDefenders = true;
    }

    // A two-party clash must always keep the hostile parties on opposite sides.
    // If both parties are hostile to the site, its defenders cannot safely ally
    // with either one without turning the encounter into an unsupported 3-way fight.
    if (left === right) right = left === 'attacker' ? 'defender' : 'attacker';
    return { left, right, includeSiteDefenders };
  }

  function partyClashActorsForParty(party = {}, side = 'defender', counters = { defender: 0, attacker: 0 }) {
    return partyEncounterActors(party).map(actor => {
      const key = side === 'attacker' ? 'attacker' : 'defender';
      const slot = counters[key] || 0;
      counters[key] = slot + 1;
      return {
        ...actor,
        side: key,
        tx: key === 'defender' ? 14 + (slot % 4) * 2 : 23 + (slot % 4),
        tz: 16 + Math.floor(slot / 4) * 3,
        canDialogue: false,
        stationary: false
      };
    });
  }

  function buildPartyClashActors(leftParty = {}, rightParty = {}, site = null, previousActors = []) {
    const sides = partyClashSides(leftParty, rightParty, site);
    const leftSide = sides.left;
    const rightSide = sides.right;
    const counters = { defender: 0, attacker: 0 };
    const siteDefenders = site && sides.includeSiteDefenders && !isCapitalProtectedSite(site)
      ? siteDefenderActors(site).map(actor => {
        const slot = counters.defender++;
        return {
          ...actor,
          side: 'defender',
          tx: 12 + (slot % 4) * 2,
          tz: 15 + Math.floor(slot / 4) * 3,
          canDialogue: false,
          stationary: false
        };
      })
      : [];
    const previousById = new Map((Array.isArray(previousActors) ? previousActors : [])
      .map(actor => [String(actor?.id || ''), actor])
      .filter(([id]) => !!id));
    return [
      ...siteDefenders,
      ...partyClashActorsForParty(leftParty, leftSide, counters),
      ...partyClashActorsForParty(rightParty, rightSide, counters)
    ].map((actor, index) => {
      const old = previousById.get(String(actor.id || ''));
      return normalizeBattleActor({
        ...actor,
        hp: old?.hp ?? actor.hp,
        maxHp: old?.maxHp ?? actor.maxHp,
        dead: old?.dead ?? actor.dead,
        diedHour: old?.diedHour ?? actor.diedHour ?? 0,
        equipment: old?.equipment ?? actor.equipment,
        inventory: old?.inventory ?? actor.inventory,
        inventoryVersion: old?.inventoryVersion ?? actor.inventoryVersion
      }, index, state.worldHour);
    }).filter(Boolean);
  }

  function createPartyClashZone(leftParty = {}, rightParty = {}) {
    if (!leftParty || !rightParty || leftParty.destroyed || rightParty.destroyed) return null;
    if (leftParty.state === 'destroyed' || rightParty.state === 'destroyed') return null;
    const existing = activeBattleZoneForParty(leftParty.id) || activeBattleZoneForParty(rightParty.id);
    if (existing) return existing;
    const id = safeId(`party_clash_${leftParty.id}_${rightParty.id}_${Math.floor(Number(state.worldHour || 0) * 10)}`, `party_clash_${leftParty.id}_${rightParty.id}`);
    const x = (Number(leftParty.x || 0) + Number(rightParty.x || 0)) / 2;
    const y = (Number(leftParty.y || 0) + Number(rightParty.y || 0)) / 2;
    const site = partyClashSiteContext(leftParty, rightParty, { x, y });
    const sides = partyClashSides(leftParty, rightParty, site);
    const leftSide = sides.left;
    const rightSide = sides.right;
    const defenderParty = leftSide === 'defender' ? leftParty : rightParty;
    const attackerParty = leftSide === 'attacker' ? leftParty : rightParty;
    const counters = { defender: 0, attacker: 0 };
    const siteDefenders = site && sides.includeSiteDefenders && !isCapitalProtectedSite(site)
      ? siteDefenderActors(site).map(actor => {
        const slot = counters.defender++;
        return {
          ...actor,
          side: 'defender',
          tx: 12 + (slot % 4) * 2,
          tz: 15 + Math.floor(slot / 4) * 3,
          canDialogue: false,
          stationary: false
        };
      })
      : [];
    const actors = [
      ...siteDefenders,
      ...partyClashActorsForParty(leftParty, leftSide, counters),
      ...partyClashActorsForParty(rightParty, rightSide, counters)
    ].map((actor, index) => normalizeBattleActor(actor, index, state.worldHour)).filter(Boolean);
    const siteLinked = !!site;
    const locationId = siteLinked
      ? safeId(site.locationId || locationIdForWorldContact({ kind: 'battle', targetFaction: attackerParty.faction || '' }), 'randomAshGrove')
      : 'randomAshGrove';
    const encounterId = siteLinked
      ? encounterIdForWorldContact({ kind: 'raid', targetFaction: attackerParty.faction || '' })
      : encounterIdForWorldContact({ kind: 'battle', targetFaction: attackerParty.faction || '' });
    const title = siteLinked ? `Стычка у локации: ${site.name || site.id}` : 'Стычка на дороге';
    const text = siteLinked
      ? `${leftParty.name || leftParty.id} и ${rightParty.name || rightParty.id} сцепились у ${site.name || site.id}. Внутри локации идет живой бой.`
      : `${leftParty.name || leftParty.id} и ${rightParty.name || rightParty.id} уже сражаются. Если войти, вы попадете в текущую фазу боя.`;
    const zone = upsertWorldZone({
      id,
      kind: 'battle',
      title: 'Стычка на дороге',
      text: `${leftParty.name || leftParty.id} и ${rightParty.name || rightParty.id} уже сражаются. Если войти, вы попадете в текущую фазу боя.`,
      title,
      text,
      x,
      y,
      radius: 11,
      priority: 4,
      sourceType: 'party_clash',
      sourceId: `${leftParty.id}:${rightParty.id}`,
      partyId: leftParty.id,
      threatPartyId: rightParty.id,
      faction: defenderParty.faction || '',
      targetFaction: attackerParty.faction || '',
      encounterId,
      locationId,
      roomId: siteLinked ? sharedRealityRoomId(locationId) : stableWorldRoomId(locationId, id),
      pvpMode: 'pvp',
      durationHours: 8,
      details: {
        simBattle: true,
        realTimeBattle: true,
        simulationDisabled: true,
        battleState: 'active',
        siteLinkedClash: siteLinked,
        siteId: site?.id || '',
        siteName: site?.name || '',
        partyClashActorsVersion: siteLinked ? PARTY_CLASH_ACTORS_VERSION : 0,
        partyId: leftParty.id,
        partyName: leftParty.name || '',
        threatPartyId: rightParty.id,
        threatName: rightParty.name || '',
        partySides: {
          [leftParty.id]: leftSide,
          [rightParty.id]: rightSide
        },
        joinedParties: [],
        lastBattleHour: Number(state.worldHour || 0),
        actors
      }
    });
    leftParty.state = 'engaged';
    leftParty.engagedZoneId = zone.id;
    leftParty.engagedUntilHour = Number(state.worldHour || 0) + 8;
    rightParty.state = 'engaged';
    rightParty.engagedZoneId = zone.id;
    rightParty.engagedUntilHour = Number(state.worldHour || 0) + 8;
    dirty = true;
    return zone;
  }

  function siteDefenderActors(site = {}) {
    const faction = site.owner || 'neutral';
    const count = Math.max(3, Math.min(8, Math.round((Number(site.security || siteDefaultSecurity(site)) / 18) + 2)));
    const actors = [];
    for (let i = 0; i < count; i++) {
      actors.push({
        id: `${site.id}_defender_${i}`,
        side: 'defender',
        name: actorNameForFaction(faction, i, 'guard'),
        faction,
        role: 'guard',
        tx: 14 + (i % 4) * 2,
        tz: 17 + Math.floor(i / 4) * 3,
        hp: 54 + Math.min(32, Number(site.security || 35) * 0.24),
        maxHp: 54 + Math.min(32, Number(site.security || 35) * 0.24),
        atk: 8 + Math.min(8, Number(site.security || 35) / 16),
        equipment: loadoutForFaction(faction, i, 'guard'),
        hostileToPlayer: factionStartsHostileToPlayer(faction),
        loot: []
      });
    }
    const protector = protectedBySite(site);
    if (protector) {
      const protectorFaction = protector.owner || 'neutral';
      const protection = Math.max(0, Number(site.protectionLevel || 0));
      const supportCount = Math.max(1, Math.min(3, 1 + Math.floor(protection / 35)));
      for (let i = 0; i < supportCount; i++) {
        const index = actors.length;
        actors.push({
          id: `${site.id}_protector_${protector.id}_${i}`,
          side: 'defender',
          name: actorNameForFaction(protectorFaction, i, 'guard'),
          faction: protectorFaction,
          role: 'guard',
          tx: 12 + (i % 3) * 2,
          tz: 15 + Math.floor(i / 3) * 3,
          hp: 58 + Math.min(34, Number(protector.security || siteDefaultSecurity(protector)) * 0.22),
          maxHp: 58 + Math.min(34, Number(protector.security || siteDefaultSecurity(protector)) * 0.22),
          atk: 9 + Math.min(9, Number(protector.security || 40) / 15),
          equipment: loadoutForFaction(protectorFaction, index, 'guard'),
          hostileToPlayer: factionStartsHostileToPlayer(protectorFaction),
          loot: []
        });
      }
    }
    const workers = Array.isArray(site.workers) && site.workers.length ? site.workers : defaultSiteWorkers(site);
    workers.forEach((worker, workerIndex) => {
      const role = String(worker?.role || '').toLowerCase();
      if (!role || role === 'guard' || role === 'worker' || role === 'scavenger' || role === 'hauler') return;
      const spawnCount = Math.max(1, Math.min(2, Math.round(Number(worker.count || 1))));
      for (let i = 0; i < spawnCount; i++) {
        const index = actors.length;
        const label = worker.label || role;
        actors.push({
          id: `${site.id}_worker_${role}_${i}`,
          side: 'defender',
          name: `${site.name || site.id}: ${label}`,
          faction,
          role,
          tx: 13 + (workerIndex % 4) * 3,
          tz: 21 + Math.floor(workerIndex / 4) * 3 + i,
          hp: 44 + Math.min(24, Number(site.security || 35) * 0.16),
          maxHp: 44 + Math.min(24, Number(site.security || 35) * 0.16),
          atk: role === 'medic' ? 5 : 6,
          equipment: worker.equipment && typeof worker.equipment === 'object'
            ? clone(worker.equipment)
            : loadoutForFaction(faction, index, role),
          hostileToPlayer: factionStartsHostileToPlayer(faction),
          canDialogue: true,
          stationary: false,
          loot: []
        });
      }
    });
    return actors;
  }

  function siteAttackerActors(site = {}) {
    const attackers = siteConflictAttackers(site);
    const actors = [];
    attackers.forEach((row, rowIndex) => {
      const faction = row.faction || site.lastRaidFaction || 'raiders';
      const group = factionGroup(faction);
      const count = Math.max(2, Math.min(6, Math.round(Number(row.count || 1) + Number(row.power || 24) / 28)));
      for (let i = 0; i < count; i++) {
        const index = actors.length;
        actors.push({
          id: `${site.id}_attacker_${rowIndex}_${i}`,
          side: 'attacker',
          name: actorNameForFaction(faction, i, 'attacker'),
          faction,
          role: group === 'mutants' ? 'mutant' : group === 'raiders' ? 'raider' : 'monster',
          typeName: group === 'mutants' ? 'Супермутант' : group === 'raiders' ? 'Рейдер' : 'Хищник пустоши',
          tx: 23 + (index % 5),
          tz: 15 + Math.floor(index / 5) * 3,
          hp: group === 'mutants' ? 112 : group === 'wild' ? 58 : 58,
          maxHp: group === 'mutants' ? 112 : group === 'wild' ? 58 : 58,
          atk: group === 'mutants' ? 16 : group === 'wild' ? 11 : 10,
          equipment: loadoutForFaction(faction, i, 'attacker'),
          hostileToPlayer: factionStartsHostileToPlayer(faction),
          loot: []
        });
      }
    });
    return actors;
  }

  function refreshSiteConflictZoneActors(zone = {}) {
    if (!zone || zone.status !== 'active') return false;
    if (zone.sourceType !== 'site_conflict' && !zone.details?.siteConflict) return false;
    const site = state.sites[safeId(zone.siteId || zone.details?.siteId || '', '')] || null;
    if (!site || !activeSiteConflict(site)) return false;
    const previous = Array.isArray(zone.details?.actors) ? zone.details.actors : [];
    const previousById = new Map(previous.map(actor => [String(actor?.id || ''), actor]).filter(([id]) => !!id));
    const next = [
      ...siteDefenderActors(site),
      ...siteAttackerActors(site)
    ].map((actor, index) => {
      const old = previousById.get(String(actor.id || ''));
      if (!old) return normalizeBattleActor(actor, index, state.worldHour);
      return normalizeBattleActor({
        ...actor,
        hp: old.hp,
        dead: old.dead,
        diedHour: old.diedHour,
        tx: old.tx ?? actor.tx,
        tz: old.tz ?? actor.tz,
        equipment: old.equipment ?? actor.equipment,
        inventory: old.inventory ?? actor.inventory,
        inventoryVersion: old.inventoryVersion ?? actor.inventoryVersion,
        canDialogue: old.canDialogue ?? actor.canDialogue,
        stationary: old.stationary ?? actor.stationary
      }, index, state.worldHour);
    }).filter(Boolean);
    const oldSignature = previous.map(actor => `${actor.id}:${actor.faction}:${actor.side}:${actor.dead ? 1 : 0}:${Math.round(Number(actor.hp || 0))}:${Number(actor.inventoryVersion || 0)}:${JSON.stringify(actor.equipment || {})}:${JSON.stringify(actor.inventory || [])}`).join('|');
    const nextSignature = next.map(actor => `${actor.id}:${actor.faction}:${actor.side}:${actor.dead ? 1 : 0}:${Math.round(Number(actor.hp || 0))}:${Number(actor.inventoryVersion || 0)}:${JSON.stringify(actor.equipment || {})}:${JSON.stringify(actor.inventory || [])}`).join('|');
    if (oldSignature === nextSignature) return false;
    zone.details = {
      ...(zone.details || {}),
      simBattle: true,
      realTimeBattle: true,
      simulationDisabled: true,
      siteConflict: true,
      siteId: site.id,
      conflict: siteConflictPublicSummary(site),
      actors: next
    };
    dirty = true;
    return true;
  }

  function createCaravanBattleZone(party = {}, threat = {}) {
    if (!party || String(party.kind || '') !== 'caravan') return null;
    const existing = activeBattleZoneForParty(party.id);
    if (existing) {
      ensureCaravanBattleMerchant(existing);
      return existing;
    }
    const threatParty = threat.threatPartyId ? state.parties[threat.threatPartyId] : null;
    const encounterId = encounterIdForWorldContact({ kind: 'caravan', targetFaction: threat.threatFaction || threatParty?.faction || '', source: 'caravan' });
    const id = safeId(`caravan_battle_${party.id}_${Math.floor(Number(state.worldHour || 0) * 10)}`, `caravan_battle_${party.id}`);
    const actors = [
      ...caravanBattleDefenderActors(party),
      ...caravanBattleAttackerActors(threatParty || {}, threat)
    ].map((actor, index) => normalizeBattleActor(actor, index, state.worldHour)).filter(Boolean);
    const zone = upsertWorldZone({
      id,
      kind: 'caravan',
      title: `Налет на караван: ${party.name || party.id}`,
      text: `${party.name || 'Караван'} остановлен налетом. Бой идет сам по себе; если войти в событие, вы увидите текущую обстановку.`,
      x: party.x,
      y: party.y,
      radius: 10,
      priority: Math.max(4, Number(threat.riskLevel || 0) >= 75 ? 5 : 4),
      sourceType: 'caravan_battle',
      sourceId: party.id,
      partyId: party.id,
      threatPartyId: threat.threatPartyId || threatParty?.id || '',
      faction: party.faction || 'caravans',
      targetFaction: threat.threatFaction || threatParty?.faction || '',
      encounterId,
      locationId: 'randomRuinedRoad',
      roomId: stableWorldRoomId('randomRuinedRoad', id),
      pvpMode: 'pvp',
      durationHours: 12,
      details: {
        simBattle: true,
        realTimeBattle: true,
        simulationDisabled: true,
        battleState: 'active',
        partyId: party.id,
        partyName: party.name || '',
        threatPartyId: threat.threatPartyId || threatParty?.id || '',
        threatName: threat.threatName || threatParty?.name || '',
        partySides: {
          [party.id]: 'defender',
          ...(threatParty?.id ? { [threatParty.id]: 'attacker' } : {})
        },
        joinedParties: [],
        riskLevel: threat.riskLevel || 0,
        lastBattleHour: Number(state.worldHour || 0),
        cargo: compactStockpile(party.cargo || {}),
        actors
      }
    });
    party.state = 'engaged';
    party.engagedZoneId = zone.id;
    party.engagedUntilHour = Number(state.worldHour || 0) + 12;
    if (threatParty) {
      threatParty.state = 'engaged';
      threatParty.engagedZoneId = zone.id;
      threatParty.engagedUntilHour = Number(state.worldHour || 0) + 12;
    }
    addEvent('caravan_battle_started', `Налет на караван: ${party.name || party.id}.`, {
      zoneId: zone.id,
      partyId: party.id,
      threatPartyId: threat.threatPartyId || '',
      x: Number(Number(party.x || 0).toFixed(1)),
      y: Number(Number(party.y || 0).toFixed(1))
    });
    dirty = true;
    return zone;
  }

  function releaseEngagedParty(party = null, zoneId = '') {
    if (!party || String(party.engagedZoneId || '') !== String(zoneId || '')) return false;
    party.state = String(party.kind || '') === 'caravan' || String(party.kind || '') === 'patrol' ? 'moving' : (String(party.kind || '') === 'monster' ? 'roaming' : 'hunting');
    delete party.engagedZoneId;
    delete party.engagedUntilHour;
    return true;
  }

  function partyOnsiteZoneId(party = {}, site = {}) {
    return safeId(`onsite_${party.id || 'party'}_${site.id || 'site'}`, `onsite_${party.id || 'party'}`);
  }

  function partyCanEnterSiteInstance(party = {}, site = {}) {
    if (!party || !site || !party.id || !site.id || party.destroyed || party.state === 'destroyed') return false;
    if (!site.locationId) return false;
    const stateKey = String(party.state || '').toLowerCase();
    if (stateKey === 'engaged' || stateKey === 'onsite' || stateKey === 'recovering') return false;
    const kind = String(party.kind || '').toLowerCase();
    if (isCapitalProtectedSite(site) && hostile(party.faction, site.owner)) return false;
    return ['caravan', 'patrol', 'raider', 'monster', 'support'].includes(kind) || partyIsHostileEncounterParty(party);
  }

  function partyOnsiteDwellHours(party = {}, site = {}, reason = '') {
    const kind = String(party.kind || '').toLowerCase();
    if (reason === 'unload') return 0.75;
    if (reason === 'harvest') return 1.25;
    if (site.owner && site.owner !== 'neutral' && hostile(party.faction, site.owner) && !isCapitalProtectedSite(site)) return 8;
    if (kind === 'caravan') return 1;
    if (kind === 'patrol') return 1.5;
    return 3;
  }

  function partyOnsiteHostileVisit(party = {}, site = {}) {
    return !!(party && site
      && site.owner
      && site.owner !== 'neutral'
      && hostile(party.faction, site.owner)
      && !isCapitalProtectedSite(site));
  }

  function partyOnsiteActors(party = {}, site = {}, hostileVisit = false) {
    const partyActors = partyEncounterActors(party)
      .map((actor, index) => normalizeBattleActor({
        ...actor,
        side: hostileVisit ? 'attacker' : actor.side,
        tx: hostileVisit ? (23 + (index % 4)) : (actor.tx ?? (15 + (index % 4) * 2)),
        tz: hostileVisit ? (16 + Math.floor(index / 4) * 3) : (actor.tz ?? (17 + Math.floor(index / 4) * 3)),
        hostileToPlayer: hostileVisit ? true : actor.hostileToPlayer,
        canDialogue: hostileVisit ? false : actor.canDialogue,
        stationary: hostileVisit ? false : actor.stationary
      }, index, state.worldHour))
      .filter(Boolean);
    if (!hostileVisit) return partyActors;
    const defenders = siteDefenderActors(site)
      .map((actor, index) => normalizeBattleActor(actor, index, state.worldHour))
      .filter(Boolean);
    return [...defenders, ...partyActors];
  }

  function refreshOnsitePartyZoneActors(zone = null, party = null, site = null) {
    if (!zone || !zone.details?.onsiteParty || !party || !site) return false;
    const hostileVisit = partyOnsiteHostileVisit(party, site);
    const nextActors = partyOnsiteActors(party, site, hostileVisit);
    if (!nextActors.length) return false;
    const previous = Array.isArray(zone.details?.actors) ? zone.details.actors : [];
    const previousById = new Map(previous.map(actor => [String(actor?.id || ''), actor]).filter(([id]) => !!id));
    const merged = nextActors.map((actor, index) => {
      const old = previousById.get(String(actor.id || ''));
      if (!old) return normalizeBattleActor(actor, index, state.worldHour);
      return normalizeBattleActor({
        ...actor,
        hp: old.hp,
        dead: old.dead,
        diedHour: old.diedHour,
        equipment: old.equipment ?? actor.equipment,
        inventory: old.inventory ?? actor.inventory,
        inventoryVersion: old.inventoryVersion ?? actor.inventoryVersion,
        canDialogue: old.canDialogue ?? actor.canDialogue,
        stationary: old.stationary ?? actor.stationary
      }, index, state.worldHour);
    }).filter(Boolean);
    const oldSignature = previous.map(actor => `${actor.id}:${actor.side}:${actor.faction}:${actor.role}:${actor.dead ? 1 : 0}:${Math.round(Number(actor.hp || 0))}:${Number(actor.inventoryVersion || 0)}:${JSON.stringify(actor.equipment || {})}:${JSON.stringify(actor.inventory || [])}`).join('|');
    const nextSignature = merged.map(actor => `${actor.id}:${actor.side}:${actor.faction}:${actor.role}:${actor.dead ? 1 : 0}:${Math.round(Number(actor.hp || 0))}:${Number(actor.inventoryVersion || 0)}:${JSON.stringify(actor.equipment || {})}:${JSON.stringify(actor.inventory || [])}`).join('|');
    const nextKind = hostileVisit ? 'raid' : 'visit';
    const changed = oldSignature !== nextSignature
      || zone.kind !== nextKind
      || !!zone.details.hostileOnsiteRaid !== hostileVisit
      || !!zone.details.simBattle !== hostileVisit
      || !!zone.details.siteConflict !== hostileVisit
      || (hostileVisit && (zone.faction !== (site.owner || '') || zone.targetFaction !== (party.faction || '')));
    if (!changed) return false;
    zone.kind = nextKind;
    zone.priority = hostileVisit ? Math.max(4, Number(zone.priority || 0)) : zone.priority;
    if (hostileVisit) {
      zone.faction = site.owner || '';
      zone.targetFaction = party.faction || '';
      zone.threatPartyId = party.id || zone.threatPartyId || '';
    }
    zone.details = {
      ...(zone.details || {}),
      hostileOnsiteRaid: hostileVisit,
      simBattle: hostileVisit,
      siteConflict: hostileVisit,
      realTimeBattle: hostileVisit || zone.details?.realTimeBattle,
      simulationDisabled: hostileVisit || zone.details?.simulationDisabled,
      conflict: hostileVisit ? siteConflictPublicSummary(site) : zone.details?.conflict,
      actors: merged
    };
    dirty = true;
    return true;
  }

  function clearPartyOnsiteState(party = {}) {
    delete party.onsiteZoneId;
    delete party.onsiteSiteId;
    delete party.onsiteReason;
    delete party.onsiteUntilHour;
    delete party.onsiteDepartureRequestedHour;
  }

  function releaseOnsiteParty(party = null, zoneId = '', reason = 'completed') {
    if (!party || String(party.onsiteZoneId || '') !== String(zoneId || '')) return false;
    const zone = worldZoneById(zoneId);
    const site = state.sites[party.onsiteSiteId || zone?.siteId || party.lastSiteId || ''] || null;
    if (zone && zone.status === 'active') {
      zone.status = 'resolved';
      zone.resolvedHour = Number(state.worldHour || 0);
      zone.expiresHour = Number(state.worldHour || 0);
      zone.details = {
        ...(zone.details || {}),
        completedHour: Number(state.worldHour || 0),
        outcome: reason
      };
    }
    clearPartyOnsiteState(party);
    const kind = String(party.kind || '').toLowerCase();
    party.state = kind === 'caravan' || kind === 'patrol' ? 'moving' : (kind === 'monster' ? 'roaming' : 'hunting');
    chooseNextDestination(party, { avoidSiteId: site?.id || party.lastSiteId || '' });
    if (site) placePartyOutsideSiteCircle(party, site);
    dirty = true;
    return true;
  }

  function requestOnsitePartyDeparture(party = null, zone = null, reason = 'site_task_completed') {
    if (!party || !zone || zone.status !== 'active' || !zone.details?.onsiteParty) return false;
    const requestedHour = Number(state.worldHour || 0);
    if (!zone.details.departureRequested) {
      zone.details = {
        ...(zone.details || {}),
        departureRequested: true,
        departureReason: String(reason || 'site_task_completed').slice(0, 64),
        departureRequestedHour: requestedHour
      };
      party.onsiteDepartureRequestedHour = requestedHour;
      addEvent('party_leaving_site', `${party.name || party.id} is leaving ${zone.details?.siteName || zone.siteId || 'site'}.`, {
        partyId: party.id,
        siteId: zone.siteId || party.onsiteSiteId || '',
        zoneId: zone.id,
        reason: String(reason || '').slice(0, 64)
      });
      dirty = true;
    }
    party.onsiteDepartureRequestedHour = Number(party.onsiteDepartureRequestedHour || zone.details?.departureRequestedHour || requestedHour);
    return true;
  }

  function completeOnsitePartyDeparture(input = {}) {
    const zoneId = safeId(input.worldZoneId || input.zoneId || '', '');
    const zone = zoneId ? worldZoneById(zoneId) : null;
    if (!zone || zone.status !== 'active' || !zone.details?.onsiteParty) return { ok: false, error: 'onsite_party_not_active' };
    const party = state.parties[safeId(zone.partyId || zone.details?.partyId || '', '')] || null;
    if (!party || String(party.onsiteZoneId || '') !== zone.id) return { ok: false, error: 'onsite_party_missing' };
    mergeWorldZoneActorSnapshots(zone, input.actors || []);
    const actors = Array.isArray(zone.details?.actors) ? zone.details.actors : [];
    const partyActors = zone.details?.hostileOnsiteRaid
      ? actors.filter(actor => actor && factionGroup(actor.faction || '') === factionGroup(party.faction || ''))
      : actors;
    const aliveActors = partyActors.filter(actor => actor && !actor.dead && Number(actor.hp || 0) > 0);
    const deadActors = partyActors.filter(actor => actor && (actor.dead || Number(actor.hp || 0) <= 0));
    party.actorSnapshots = aliveActors.slice(0, 16).map((actor, index) => normalizeBattleActor({
      ...actor,
      dead: false,
      diedHour: 0
    }, index, state.worldHour)).filter(Boolean);
    if (!aliveActors.length) {
      zone.status = 'resolved';
      zone.resolvedHour = Number(state.worldHour || 0);
      zone.expiresHour = Number(state.worldHour || 0);
      zone.details = {
        ...(zone.details || {}),
        completedHour: Number(state.worldHour || 0),
        outcome: 'party_destroyed_onsite',
        aliveActorCount: 0,
        deadActorCount: deadActors.length
      };
      destroyWorldParty(party, 'onsite_party_destroyed');
      addEvent('world_party_destroyed', `${party.name || party.id} was destroyed inside ${zone.details?.siteName || zone.siteId || 'site'}.`, {
        partyId: party.id,
        siteId: zone.siteId || '',
        zoneId: zone.id
      });
      dirty = true;
      return { ok: true, partyAlive: false, zone, party: publicParty(party) };
    }
    if (deadActors.length > 0) {
      party.members = clamp(Math.min(Number(party.members || aliveActors.length), aliveActors.length), 1, 200);
      party.strength = clamp(Number(party.strength || 1) - deadActors.length * 4, 1, 500);
    }
    requestOnsitePartyDeparture(party, zone, input.reason || zone.details?.departureReason || 'physical_exit');
    releaseOnsiteParty(party, zone.id, input.reason || zone.details?.departureReason || 'physical_exit');
    addEvent('party_left_site', `${party.name || party.id} physically left ${zone.details?.siteName || zone.siteId || 'site'}.`, {
      partyId: party.id,
      siteId: zone.siteId || '',
      zoneId: zone.id,
      aliveActorCount: aliveActors.length,
      deadActorCount: deadActors.length
    });
    dirty = true;
    return { ok: true, partyAlive: true, zone, party: publicParty(party) };
  }

  function updateOnsiteParty(party = {}, hours = 0) {
    if (!party || String(party.state || '').toLowerCase() !== 'onsite') return false;
    const zoneId = safeId(party.onsiteZoneId || '', '');
    const zone = zoneId ? worldZoneById(zoneId) : null;
    const site = state.sites[party.onsiteSiteId || zone?.siteId || party.lastSiteId || ''] || null;
    if (site) {
      party.x = Number(site.x || party.x || 0);
      party.y = Number(site.y || party.y || 0);
      party.lastSiteId = site.id;
    }
    if (!zone || zone.status !== 'active') {
      clearPartyOnsiteState(party);
      const kind = String(party.kind || '').toLowerCase();
      party.state = kind === 'caravan' || kind === 'patrol' ? 'moving' : (kind === 'monster' ? 'roaming' : 'hunting');
      chooseNextDestination(party, { avoidSiteId: site?.id || party.lastSiteId || '' });
      if (site) placePartyOutsideSiteCircle(party, site);
      dirty = true;
      return true;
    }
    if (zone.details?.departureRequested === true) {
      const requestedHour = Number(zone.details?.departureRequestedHour || party.onsiteDepartureRequestedHour || state.worldHour || 0);
      party.onsiteDepartureRequestedHour = requestedHour;
      const fallbackAfterHour = requestedHour + realMinutesToWorldHours(PARTY_ONSITE_DEPARTURE_REAL_MINUTES);
      if (Number(state.worldHour || 0) >= fallbackAfterHour) {
        completeOnsitePartyDeparture({
          worldZoneId: zone.id,
          reason: 'physical_exit_timeout',
          actors: Array.isArray(zone.details?.actors) ? zone.details.actors : []
        });
      }
      return true;
    }
    const hostileVisit = partyOnsiteHostileVisit(party, site);
    const kind = String(party.kind || '').toLowerCase();
    const arrivedHour = Number(zone.details?.arrivedHour || 0);
    const lastRaidHour = Number(site?.lastRaidHour || -999);
    const recentlyCapturedByParty = site
      && !hostileVisit
      && (kind === 'raider' || kind === 'monster' || partyIsHostileEncounterParty(party))
      && factionGroup(site.owner || '') === factionGroup(party.faction || '')
      && arrivedHour >= lastRaidHour
      && arrivedHour - lastRaidHour <= 0.5
      && Number(state.worldHour || 0) - lastRaidHour <= 4;
    if (recentlyCapturedByParty) {
      requestOnsitePartyDeparture(party, zone, 'captured_site_exit');
      return true;
    }
    if (hostileVisit && site && !activeSiteConflict(site)) {
      joinSiteConflict(site, party.faction || 'raiders', {
        source: 'party_onsite_refresh',
        partyId: party.id,
        power: partyPower(party),
        count: Math.max(1, Math.round(Number(party.members || 1))),
        durationHours: Math.max(8, partyOnsiteDwellHours(party, site, String(party.onsiteReason || '')) + 4)
      });
    }
    if (site) refreshOnsitePartyZoneActors(zone, party, site);
    if (hostileVisit && site && activeSiteConflict(site)) {
      party.onsiteUntilHour = Math.max(Number(party.onsiteUntilHour || 0), Number(state.worldHour || 0) + Math.max(1, Number(hours || 0) * 2));
      return true;
    }
    if (site && String(party.kind || '').toLowerCase() === 'caravan' && party.stagingSiteId === site.id && !party.stagingJoinClosed && Number(party.stagingUntilHour || 0) > 0) {
      let destination = state.sites[party.destinationSiteId];
      if (!destination || destination.id === site.id) destination = chooseNextDestination(party);
      const minPlayers = Number(party.stagingMinPlayers || caravanStagingMinPlayers(party));
      const joined = worldPartyPlayerCount(party);
      updateCaravanStagingTask(party, site, destination, false);
      const enoughPlayers = minPlayers > 0 && joined >= minPlayers;
      const waitExpired = Number(state.worldHour || 0) >= Number(party.stagingUntilHour || 0);
      if (!enoughPlayers && !waitExpired) {
        party.onsiteUntilHour = Math.max(Number(party.onsiteUntilHour || 0), Number(party.stagingUntilHour || 0));
        return true;
      }
      party.stagingJoinClosed = true;
      updateCaravanStagingTask(party, site, destination, true);
      addEvent('caravan_departed', `${party.name} left ${site?.name || party.stagingSiteId || 'site'} for ${destination?.name || party.destinationSiteId || 'route'}.`, {
        partyId: party.id,
        siteId: site?.id || '',
        destinationSiteId: destination?.id || party.destinationSiteId || '',
        playerCount: joined,
        minPlayers,
        reason: enoughPlayers ? 'group_ready' : 'wait_expired',
        cargo: compactStockpile(party.cargo || {})
      });
      requestOnsitePartyDeparture(party, zone, enoughPlayers ? 'caravan_group_ready' : 'caravan_wait_expired');
      return true;
    }
    if (Number(state.worldHour || 0) < Number(party.onsiteUntilHour || 0)) return true;
    requestOnsitePartyDeparture(party, zone, 'site_task_completed');
    return true;
  }

  function beginPartyOnsiteVisit(party = {}, site = {}, options = {}) {
    if (!partyCanEnterSiteInstance(party, site)) return null;
    const locationId = safeId(site.locationId || '', '');
    if (!locationId) return null;
    const id = partyOnsiteZoneId(party, site);
    const reason = String(options.reason || '').slice(0, 48);
    const hostileVisit = partyOnsiteHostileVisit(party, site);
    const actors = partyOnsiteActors(party, site, hostileVisit);
    if (!actors.length) return null;
    if (hostileVisit) {
      joinSiteConflict(site, party.faction || 'raiders', {
        source: 'party_arrival',
        partyId: party.id,
        power: partyPower(party),
        count: Math.max(1, Math.round(Number(party.members || 1))),
        durationHours: Math.max(8, partyOnsiteDwellHours(party, site, reason) + 4)
      });
    }
    const now = Number(state.worldHour || 0);
    const dwellHours = Math.max(0.25, Number(options.dwellHours || 0) || partyOnsiteDwellHours(party, site, reason));
    const zone = upsertWorldZone({
      id,
      kind: hostileVisit ? 'raid' : 'visit',
      title: `${party.name || party.id} @ ${site.name || site.id}`,
      text: `${party.name || 'Party'} is physically present at ${site.name || site.id}.`,
      x: site.x,
      y: site.y,
      radius: 2,
      priority: hostileVisit ? 4 : 1,
      sourceType: 'party_onsite',
      sourceId: party.id,
      siteId: site.id,
      partyId: party.id,
      threatPartyId: hostileVisit ? party.id : '',
      faction: hostileVisit ? (site.owner || '') : (party.faction || ''),
      targetFaction: hostileVisit ? (party.faction || '') : (site.owner || ''),
      encounterId: partyMeetingEncounterId(party),
      locationId,
      roomId: sharedRealityRoomId(locationId),
      pvpMode: site.pvpMode || 'pvp',
      durationHours: Math.max(8, dwellHours + 1),
      details: {
        onsiteParty: true,
        hostileOnsiteRaid: hostileVisit,
        simBattle: hostileVisit,
        siteConflict: hostileVisit,
        realTimeBattle: hostileVisit,
        simulationDisabled: hostileVisit,
        conflict: hostileVisit ? siteConflictPublicSummary(site) : null,
        hidden: true,
        visible: false,
        partyId: party.id,
        partyKind: String(party.kind || ''),
        partyName: party.name || '',
        siteId: site.id,
        siteName: site.name || '',
        arrivalReason: reason,
        arrivalFromX: Number.isFinite(Number(options.arrivalFrom?.x)) ? Number(options.arrivalFrom.x) : Number(party.x || site.x || 0),
        arrivalFromY: Number.isFinite(Number(options.arrivalFrom?.y)) ? Number(options.arrivalFrom.y) : Number(party.y || site.y || 0),
        arrivedHour: now,
        resolveAfterHour: now + dwellHours,
        actors
      }
    });
    if (!zone) return null;
    party.state = 'onsite';
    party.onsiteZoneId = zone.id;
    party.onsiteSiteId = site.id;
    party.onsiteReason = reason;
    party.onsiteUntilHour = now + dwellHours;
    party.x = Number(site.x || party.x || 0);
    party.y = Number(site.y || party.y || 0);
    party.lastSiteId = site.id;
    addEvent('party_entered_site', `${party.name || party.id} entered ${site.name || site.id}.`, {
      partyId: party.id,
      siteId: site.id,
      locationId,
      zoneId: zone.id,
      reason
    });
    dirty = true;
    return zone;
  }

  function destroyWorldParty(party = null, reason = 'battle') {
    if (!party) return false;
    party.destroyed = true;
    party.state = 'destroyed';
    party.destroyedAtHour = Number(state.worldHour || 0);
    party.reformAtHour = Number(state.worldHour || 0) + Math.max(1, Number(party.respawnHours || PARTY_REFORM_HOURS[party.kind] || 24));
    party.destroyedReason = String(reason || 'battle').slice(0, 64);
    delete party.engagedZoneId;
    delete party.engagedUntilHour;
    clearPartyOnsiteState(party);
    return true;
  }

  function battleActors(zone = {}) {
    ensureCaravanBattleMerchant(zone);
    const actors = Array.isArray(zone.details?.actors) ? zone.details.actors : [];
    zone.details.actors = actors.map((actor, index) => normalizeBattleActor(actor, index, state.worldHour)).filter(Boolean);
    return zone.details.actors;
  }

  function battleSideAlive(actors = [], side = '') {
    return actors.some(actor => actor && actor.side === side && !actor.dead && Number(actor.hp || 0) > 0);
  }

  function isCaravanBattleZone(zone = {}, party = null) {
    const row = party || (zone.partyId ? state.parties[zone.partyId] : null);
    return String(row?.kind || '').toLowerCase() === 'caravan'
      || String(zone.kind || '').toLowerCase() === 'caravan'
      || String(zone.sourceType || '').toLowerCase() === 'caravan_battle';
  }

  function defenderLostBattleOutcome(zone = {}) {
    if (zone.details?.siteConflict) return 'site_captured';
    return isCaravanBattleZone(zone) ? 'caravan_destroyed' : 'world_party_destroyed';
  }

  function attackerLostBattleOutcome(zone = {}) {
    if (zone.details?.siteConflict) return 'site_defended';
    return isCaravanBattleZone(zone) ? 'caravan_defended' : 'world_battle_resolved';
  }

  function completeJoinedBattleParties(zone = {}, outcome = 'resolved') {
    const joined = Array.isArray(zone.details?.joinedParties) ? zone.details.joinedParties : [];
    const site = zone.details?.siteConflict ? state.sites[zone.siteId || zone.details?.siteId || ''] : null;
    const defenderLost = ['caravan_destroyed', 'world_party_destroyed', 'site_captured'].includes(String(outcome || ''));
    const attackerLost = ['caravan_defended', 'world_battle_resolved', 'site_defended'].includes(String(outcome || ''));
    const losingSide = defenderLost ? 'defender' : attackerLost ? 'attacker' : '';
    joined.forEach(row => {
      const party = state.parties[safeId(row?.partyId || '', '')];
      if (!party || party.destroyed || party.state === 'destroyed') return;
      if (losingSide && String(row.side || '') === losingSide) {
        destroyWorldParty(party, 'joined_world_battle_lost');
      } else {
        releaseEngagedParty(party, zone.id);
        if (site) {
          party.lastSiteId = site.id;
          chooseNextDestination(party);
          placePartyOutsideSiteCircle(party, site);
        }
      }
    });
  }

  function completeBattleZone(zone = {}, outcome = 'resolved', details = {}) {
    if (!zone || zone.status !== 'active') return false;
    let party = zone.partyId ? state.parties[zone.partyId] : null;
    let threatParty = zone.threatPartyId ? state.parties[zone.threatPartyId] : null;
    zone.status = 'resolved';
    zone.resolvedHour = Number(state.worldHour || 0);
    zone.expiresHour = Number(state.worldHour || 0);
    zone.details = {
      ...(zone.details || {}),
      battleState: outcome,
      outcome,
      completedHour: Number(state.worldHour || 0),
      ...details
    };
    state.stats.battlesResolved = Number(state.stats.battlesResolved || 0) + 1;
    if (zone.details?.siteConflict) {
      const site = state.sites[zone.siteId || zone.details.siteId || ''] || null;
      const conflict = site ? activeSiteConflict(site) : null;
      if (site && conflict) {
        if (outcome === 'caravan_destroyed' || outcome === 'site_captured') captureSiteFromConflict(site, conflict);
        else repelSiteConflict(site, conflict);
      }
      if (zone.details?.hostileOnsiteRaid && party) {
        if (outcome === 'site_captured') {
          party.x = Number(site?.x || zone.x || party.x || 0);
          party.y = Number(site?.y || zone.y || party.y || 0);
          party.lastSiteId = site?.id || zone.siteId || party.lastSiteId || '';
          party.state = 'onsite';
          party.onsiteZoneId = zone.id;
          party.onsiteSiteId = site?.id || zone.siteId || party.onsiteSiteId || '';
          party.onsiteUntilHour = Number(state.worldHour || 0);
          zone.status = 'active';
          zone.resolvedHour = 0;
          zone.expiresHour = Number(state.worldHour || 0) + realMinutesToWorldHours(PARTY_ONSITE_DEPARTURE_REAL_MINUTES) + 1;
          zone.details = {
            ...(zone.details || {}),
            simBattle: false,
            siteConflict: false,
            realTimeBattle: false,
            simulationDisabled: false,
            battleCompleted: true
          };
          requestOnsitePartyDeparture(party, zone, 'captured_site_exit');
        } else {
          destroyWorldParty(party, 'site_raid_lost');
        }
      }
      completeJoinedBattleParties(zone, outcome);
      dirty = true;
      return true;
    }
    const assignedSides = zone.details?.partySides && typeof zone.details.partySides === 'object'
      ? zone.details.partySides
      : {};
    if (party && threatParty
      && String(assignedSides[party.id] || 'defender') === 'attacker'
      && String(assignedSides[threatParty.id] || 'attacker') === 'defender') {
      [party, threatParty] = [threatParty, party];
    }
    completeJoinedBattleParties(zone, outcome);
    const isCaravanBattle = isCaravanBattleZone(zone, party);
    const defenderLost = outcome === 'caravan_destroyed' || outcome === 'world_party_destroyed';
    if (defenderLost) {
      destroyWorldParty(party, isCaravanBattle ? 'caravan_battle' : 'world_battle_lost');
      if (threatParty && !threatParty.destroyed) releaseEngagedParty(threatParty, zone.id);
      if (isCaravanBattle) state.stats.caravansLost = Number(state.stats.caravansLost || 0) + 1;
      addEvent(isCaravanBattle ? 'caravan_destroyed' : 'world_party_destroyed', isCaravanBattle
        ? `${party?.name || 'Караван'} разбит в налете.`
        : `${party?.name || 'Отряд'} разбит в стычке.`, {
        zoneId: zone.id,
        partyId: party?.id || '',
        threatPartyId: threatParty?.id || '',
        x: Number(Number(zone.x || 0).toFixed(1)),
        y: Number(Number(zone.y || 0).toFixed(1))
      });
    } else {
      releaseEngagedParty(party, zone.id);
      if (party && String(party.kind || '').toLowerCase() === 'caravan' && !party.destroyed) {
        party.state = 'recovering';
        party.recoverUntilHour = Number(state.worldHour || 0) + realMinutesToWorldHours(CARAVAN_POST_BATTLE_REAL_MINUTES);
      }
      if (threatParty) {
        suppressPartyThreat(threatParty, 12, {
          reason: isCaravanBattle ? 'caravan_battle_lost' : 'world_battle_lost',
          encounterId: zone.encounterId || '',
          strengthDrop: 8,
          memberDrop: 1
        });
        destroyWorldParty(threatParty, isCaravanBattle ? 'caravan_battle_lost' : 'world_battle_lost');
      }
      addEvent(isCaravanBattle ? 'caravan_defended' : 'world_battle_resolved', isCaravanBattle
        ? `${party?.name || 'Караван'} отбился от налета.`
        : `${party?.name || 'Отряд'} победил в стычке.`, {
        zoneId: zone.id,
        partyId: party?.id || '',
        threatPartyId: threatParty?.id || '',
        x: Number(Number(zone.x || 0).toFixed(1)),
        y: Number(Number(zone.y || 0).toFixed(1))
      });
    }
    if (defenderLost && isCaravanBattle) {
      finishActiveWorldTasks(
        task => task.type === 'escort_caravan' && (!task.partyId || task.partyId === zone.partyId),
        'failed',
        outcome,
        { zoneId: zone.id, partyId: zone.partyId || '', threatPartyId: zone.threatPartyId || '' }
      );
    } else if (isCaravanBattle) {
      state.worldTasks
        .filter(task => task && task.status === 'active' && task.type === 'escort_caravan' && (!task.partyId || task.partyId === zone.partyId))
        .forEach(task => {
          task.details = {
            ...(task.details || {}),
            lastBattleOutcome: outcome,
            lastBattleZoneId: zone.id,
            lastThreatPartyId: zone.threatPartyId || '',
            recovering: true,
            resumeAfterHour: party?.recoverUntilHour || 0
          };
          task.updatedHour = Number(Number(state.worldHour || 0).toFixed(2));
        });
    }
    dirty = true;
    return true;
  }

  function maintainBattleZone(zone = {}, hours = 0) {
    if (!zone || zone.status !== 'active' || !zone.details?.simBattle) return false;
    const actors = battleActors(zone);
    if (!battleSideAlive(actors, 'defender')) {
      return completeBattleZone(zone, defenderLostBattleOutcome(zone), {
        resolvedBy: 'server_realtime_battle'
      });
    }
    if (!battleSideAlive(actors, 'attacker')) {
      return completeBattleZone(zone, attackerLostBattleOutcome(zone), {
        resolvedBy: 'server_realtime_battle'
      });
    }
    if (!zone.details.realTimeBattle || !zone.details.simulationDisabled) {
      zone.details.realTimeBattle = true;
      zone.details.simulationDisabled = true;
      dirty = true;
      return true;
    }
    return false;
  }

  function maintainWorldZoneBattles(hours = 0) {
    (Array.isArray(state.worldZones) ? state.worldZones : [])
      .filter(zone => zone && zone.status === 'active' && zone.details?.simBattle)
      .forEach(zone => maintainBattleZone(zone, hours));
  }

  function syncBattleZoneActors(context = {}) {
    const zoneId = safeId(context.worldZoneId || context.zoneId || '', '');
    const roomId = String(context.roomId || '').replace(/[^a-zA-Z0-9_#-]/g, '').slice(0, 96);
    const zone = zoneId ? worldZoneById(zoneId) : activeBattleZoneForRoom(roomId);
    if (!zone || zone.status !== 'active' || !zone.details?.simBattle) return false;
    const snapshots = Array.isArray(context.actors) ? context.actors : [];
    const byId = new Map();
    snapshots.forEach(row => {
      const id = safeId(row?.actorId || row?.worldBattleActorId || row?.id || '', '');
      if (id) byId.set(id, row);
    });
    if (!byId.size) return false;
    let changed = false;
    const actors = battleActors(zone).map((actor, index) => {
      const snapshot = byId.get(actor.id);
      if (!snapshot) return actor;
      const maxHp = clamp(snapshot.maxHp ?? actor.maxHp ?? actor.hp ?? 40, 1, 400);
      const hp = clamp(snapshot.hp ?? actor.hp ?? maxHp, 0, maxHp);
      const dead = !!snapshot.dead || hp <= 0;
      const diedHour = dead ? (actor.diedHour || Number(state.worldHour || 0)) : 0;
      const tx = Number.isFinite(Number(snapshot.tx)) ? clamp(Math.round(Number(snapshot.tx)), 0, 63) : actor.tx;
      const tz = Number.isFinite(Number(snapshot.tz)) ? clamp(Math.round(Number(snapshot.tz)), 0, 63) : actor.tz;
      const equipment = snapshot.equipment && typeof snapshot.equipment === 'object' ? clone(snapshot.equipment) : actor.equipment;
      const inventory = Array.isArray(snapshot.inventory) ? snapshot.inventory.map(row => ({ ...row })) : actor.inventory;
      const inventoryVersion = Math.max(0, Math.floor(Number(snapshot.inventoryVersion || actor.inventoryVersion || 0)));
      if (Number(actor.maxHp || 0) !== maxHp
        || Number(actor.hp || 0) !== hp
        || !!actor.dead !== dead
        || Number(actor.diedHour || 0) !== diedHour
        || Number(actor.tx || 0) !== Number(tx || 0)
        || Number(actor.tz || 0) !== Number(tz || 0)
        || JSON.stringify(actor.equipment || {}) !== JSON.stringify(equipment || {})
        || JSON.stringify(actor.inventory) !== JSON.stringify(inventory)
        || Number(actor.inventoryVersion || 0) !== inventoryVersion) {
        changed = true;
      }
      return normalizeBattleActor({
        ...actor,
        maxHp,
        hp,
        dead,
        diedHour,
        tx,
        tz,
        equipment,
        inventory,
        inventoryVersion
      }, index, state.worldHour);
    });
    zone.details.actors = actors;
    if (!zone.details.realTimeBattle || !zone.details.simulationDisabled) {
      zone.details.realTimeBattle = true;
      zone.details.simulationDisabled = true;
      changed = true;
    }
    zone.details.lastServerBattleSyncHour = Number(state.worldHour || 0);
    const defendersAlive = battleSideAlive(actors, 'defender');
    const attackersAlive = battleSideAlive(actors, 'attacker');
    if (!defendersAlive) {
      return completeBattleZone(zone, defenderLostBattleOutcome(zone), {
        resolvedBy: 'server_realtime_battle',
        roomId
      });
    }
    if (!attackersAlive) {
      return completeBattleZone(zone, attackerLostBattleOutcome(zone), {
        resolvedBy: 'server_realtime_battle',
        roomId
      });
    }
    if (changed) dirty = true;
    return changed;
  }

  function upsertWorldZone(input = {}) {
    const now = Number(state.worldHour || 0);
    const base = normalizeWorldZone({
      ...input,
      id: input.id || `${input.kind || 'zone'}_${Math.floor(now * 10)}`,
      createdHour: input.createdHour ?? now,
      expiresHour: input.expiresHour ?? (now + Math.max(8, Number(input.durationHours || 72)))
    }, now, getGlobalMap());
    if (!base) return null;
    base.encounterId = worldZoneEncounterId(base);
    base.locationId = worldZoneLocationId(base);
    base.roomId = String(worldZoneRoomId(base, base.id)).replace(/[^a-zA-Z0-9_#-]/g, '').slice(0, 96);
    const index = state.worldZones.findIndex(zone => zone && zone.id === base.id);
    if (index >= 0) {
      const prev = state.worldZones[index];
      const prevDetails = prev.details && typeof prev.details === 'object' ? prev.details : {};
      const baseDetails = base.details && typeof base.details === 'object' ? base.details : {};
      const fixedLair = base.kind === 'lair' && (baseDetails.fixedLair || prevDetails.fixedLair);
      const fixedRespawnHours = Math.max(1, Number(baseDetails.fixedLairRespawnHours || prevDetails.fixedLairRespawnHours || FIXED_LAIR_RESPAWN_HOURS));
      const clearedHour = Number(prev.resolvedHour || prevDetails.clearedHour || 0);
      const baseFixedVersion = Number(baseDetails.fixedLairVersion || 0);
      const prevFixedVersion = Number(prevDetails.fixedLairVersion || 0);
      const fixedLairNeedsVersionRefresh = fixedLair && baseFixedVersion > 0 && prevFixedVersion !== baseFixedVersion;
      const canReactivateFixedLair = fixedLair
        && prev.status === 'looted'
        && (fixedLairNeedsVersionRefresh || Number(now || 0) >= clearedHour + fixedRespawnHours);
      const reactivateTransient = !fixedLair && prev.status !== 'active' && base.status === 'active';
      const keepLooted = fixedLair && prev.status === 'looted' && !canReactivateFixedLair;
      state.worldZones[index] = normalizeWorldZone({
        ...prev,
        ...base,
        createdHour: canReactivateFixedLair || reactivateTransient ? base.createdHour : (prev.createdHour || base.createdHour),
        status: keepLooted ? 'looted' : base.status,
        resolvedHour: canReactivateFixedLair || reactivateTransient ? 0 : (prev.resolvedHour || base.resolvedHour),
        details: fixedLair
          ? {
            ...(canReactivateFixedLair ? {} : prevDetails),
            ...baseDetails,
            clearCount: Number(prevDetails.clearCount || 0) + (canReactivateFixedLair ? 1 : 0),
            lastRefreshedHour: canReactivateFixedLair ? now : (baseDetails.lastRefreshedHour || prevDetails.lastRefreshedHour || 0)
          }
          : (reactivateTransient ? baseDetails : { ...prevDetails, ...baseDetails })
      }, now, getGlobalMap());
      state.worldZones[index].encounterId = worldZoneEncounterId(state.worldZones[index]);
      state.worldZones[index].locationId = worldZoneLocationId(state.worldZones[index]);
      state.worldZones[index].roomId = String(worldZoneRoomId(state.worldZones[index], state.worldZones[index].id)).replace(/[^a-zA-Z0-9_#-]/g, '').slice(0, 96);
    } else {
      state.worldZones.unshift(base);
      state.worldZones = state.worldZones.slice(0, MAX_WORLD_ZONE_COUNT);
    }
    dirty = true;
    return index >= 0 ? state.worldZones[index] : base;
  }

  function worldZoneNearPoint(zone = {}, point = null, maxKm = 18) {
    const p = normalizeWorldPoint(point || {});
    if (!zone || !p) return false;
    return pointDistanceKm(zone, p, getGlobalMap()) <= Math.max(0.5, Number(maxKm || 18));
  }

  function markWorldZonesLooted(filter, details = {}) {
    if (typeof filter !== 'function') return 0;
    let changed = 0;
    const now = Number(state.worldHour || 0);
    state.worldZones.forEach(zone => {
      if (!zone || zone.status !== 'active' || !filter(zone)) return;
      const zoneDetails = zone.details && typeof zone.details === 'object' ? zone.details : {};
      const fixedRespawnHours = Math.max(1, Number(zoneDetails.fixedLairRespawnHours || FIXED_LAIR_RESPAWN_HOURS));
      zone.status = 'looted';
      zone.resolvedHour = now;
      zone.expiresHour = Math.max(Number(zone.expiresHour || 0), now + (zoneDetails.fixedLair ? fixedRespawnHours : 96));
      zone.details = {
        ...zoneDetails,
        looted: true,
        clearedHour: now,
        nextRefreshHour: zoneDetails.fixedLair ? now + fixedRespawnHours : undefined,
        ...details
      };
      changed++;
    });
    if (changed) dirty = true;
    return changed;
  }

  function updatePlayerAmbushInterceptions() {
    const before = Array.isArray(state.worldZones) ? state.worldZones.length : 0;
    state.worldZones = (Array.isArray(state.worldZones) ? state.worldZones : [])
      .filter(zone => zone?.details?.playerAmbush !== true);
    const removedAmbushes = state.worldZones.length !== before;
    if (removedAmbushes) dirty = true;
    return removedAmbushes;
  }

  function completeWorldTaskDelivery(taskId = '', data = {}) {
    const id = String(taskId || '').trim();
    const task = state.worldTasks.find(row => row && String(row.id || '') === id);
    if (!task || task.status !== 'active') return { ok: false, error: 'Задание уже недоступно.' };
    if (task.type !== 'deliver_supplies') return { ok: false, error: 'Это задание нельзя закрыть доставкой припасов.' };
    const site = task.siteId ? state.sites[task.siteId] : null;
    if (!site) return { ok: false, error: 'Точка доставки больше не найдена.' };
    const delivered = compactStockpile(data.delivered && typeof data.delivered === 'object' ? data.delivered : {});
    if (stockpileTotal(delivered) <= 0) return { ok: false, error: 'Нужно передать припасы.' };

    site.stockpile = site.stockpile && typeof site.stockpile === 'object' ? site.stockpile : emptyStockpile();
    const playerId = safeId(data.playerId || data.characterId || 'player', 'player');
    addStockpile(site.stockpile, delivered, 1);
    site.supplyDisruptedUntil = 0;
    site.prosperity = clamp(Number(site.prosperity || 0) + 3 + Number(task.priority || 1), 0, 100);
    site.security = clamp(Number(site.security || siteDefaultSecurity(site)) + 2 + Number(task.priority || 1), 0, 100);
    if (isSupportDemandSite(site)) {
      site.workforce = clamp(Number(site.workforce || 0) + 4 + Number(task.priority || 1), 0, 100);
      site.resourceActivity = resourceActivityPercent(site, state.worldHour);
    }
    if (task.details?.resourceSupport && isSupportDemandSite(site)) {
      const relief = task.details.relief && typeof task.details.relief === 'object' ? task.details.relief : {};
      site.workforce = clamp(Number(site.workforce || 0) + Number(relief.workforce || 8), 0, 100);
      site.security = clamp(Number(site.security || siteDefaultSecurity(site)) + Number(relief.security || 6), 0, 100);
      site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) - Number(relief.depletion || 4), 0, 100);
      site.threatSuppressedUntil = Math.max(Number(site.threatSuppressedUntil || 0), Number(state.worldHour || 0) + Number(relief.activityHours || 18));
      site.raidUntil = Math.max(0, Math.min(Number(site.raidUntil || 0), Number(state.worldHour || 0) + 2));
      site.resourceActivity = resourceActivityPercent(site, state.worldHour);
      site.lastSupportDeliveryHour = state.worldHour;
      site.supportBoostUntil = Math.max(Number(site.supportBoostUntil || 0), Number(state.worldHour || 0) + Number(relief.activityHours || 18));
      addEvent('resource_support_delivered', `${site.name}: доставка поддержки восстановила добычу.`, {
        taskId: id,
        siteId: site.id,
        playerId,
        supportReason: task.details.supportReason || '',
        delivered
      });
    }

    const finished = finishWorldTask(task, 'completed', 'player_delivery', {
      playerId,
      delivered,
      deliveredHour: Number(Number(state.worldHour || 0).toFixed(2))
    });
    addEvent('player_supply_delivery', `${site.name}: игрок доставил припасы (${stockpileSummary(delivered)}).`, {
      taskId: id,
      siteId: site.id,
      playerId,
      delivered
    });
    dirty = true;
    save(true);
    return { ok: true, task: finished, sim: publicState() };
  }

  function applyExpiredWorldTaskConsequences(task = {}) {
    const now = Number(state.worldHour || 0);
    const priority = clamp(Number(task.priority || 1), 1, 5);
    const details = task.details && typeof task.details === 'object' ? task.details : {};
    const site = task.siteId ? state.sites[task.siteId] : null;
    const party = task.partyId ? state.parties[task.partyId] : null;
    const siteSecurity = row => clamp(
      Number.isFinite(Number(row?.security)) ? Number(row.security) : siteDefaultSecurity(row || {}),
      0,
      100
    );
    const refreshResourceActivity = row => {
      if (!row || !isSupportDemandSite(row)) return;
      row.resourceActivity = resourceActivityPercent(row, now);
    };

    if (task.type === 'deliver_supplies' && site) {
      const disruptionHours = details.resourceSupport ? 18 + priority * 3 : 12 + priority * 2;
      site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), now + disruptionHours);
      site.security = clamp(siteSecurity(site) - (2 + priority), 0, 100);
      site.prosperity = clamp(Number(site.prosperity || 0) - (1 + priority * 0.8), 0, 100);

      if (details.resourceSupport && isSupportDemandSite(site)) {
        site.workforce = clamp(Number(site.workforce || 0) - (4 + priority), 0, 100);
        site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) + 2 + priority, 0, 100);
        site.raidUntil = Math.max(Number(site.raidUntil || 0), now + (details.supportReason === 'raid' ? 12 : 4 + priority));
        site.supportBoostUntil = 0;
        refreshResourceActivity(site);
        addEvent('resource_support_failed', `${site.name}: поддержка добычи сорвалась, точка просела.`, {
          taskId: task.id,
          siteId: site.id,
          supportReason: details.supportReason || '',
          demand: details.demand || {}
        });
      } else {
        addEvent('supply_delivery_failed', `${site.name}: доставка припасов сорвалась, снабжение ухудшилось.`, {
          taskId: task.id,
          siteId: site.id,
          demand: details.demand || {}
        });
      }
      dirty = true;
      return true;
    }

    if (task.type === 'escort_caravan' && party) {
      const wasDestroyed = !!party.destroyed || party.state === 'destroyed';
      const home = state.sites[party.homeSiteId || task.siteId || 'settlement'];
      if (!wasDestroyed) {
        const cargoLossShare = clamp(0.12 + priority * 0.04, 0.12, 0.36);
        const cargo = compactStockpile(party.cargo || {});
        const lostCargo = {};
        for (const [key, amount] of Object.entries(cargo)) {
          const lost = Math.floor(Number(amount || 0) * cargoLossShare);
          if (lost > 0) {
            cargo[key] = Math.max(0, Number(cargo[key] || 0) - lost);
            lostCargo[key] = lost;
          }
        }
        party.cargo = compactStockpile(cargo);
        party.members = clamp(Number(party.members || 1) - (priority >= 4 ? 1 : 0), 1, 200);
        party.strength = clamp(Number(party.strength || 1) - (2 + priority * 2), 1, 500);
        party.threatSuppressedUntil = 0;
        party.lastEscortFailedHour = now;
        if (home) {
          home.supplyDisruptedUntil = Math.max(Number(home.supplyDisruptedUntil || 0), now + 10 + priority * 2);
          home.security = clamp(siteSecurity(home) - 2, 0, 100);
        }
        addEvent('caravan_escort_failed', `${party.name}: сопровождение сорвалось, караван понес потери.`, {
          taskId: task.id,
          partyId: party.id,
          siteId: home?.id || '',
          lostCargo
        });
      }
      dirty = true;
      return !wasDestroyed;
    }

    if (task.type === 'join_patrol' && party) {
      const home = state.sites[party.homeSiteId || task.siteId || 'settlement'];
      party.strength = clamp(Number(party.strength || 1) - (2 + priority * 2), 1, 500);
      party.members = clamp(Number(party.members || 1) - (priority >= 4 ? 1 : 0), 1, 200);
      party.lastPatrolFailedHour = now;
      if (home) home.security = clamp(siteSecurity(home) - (1 + priority), 0, 100);
      addEvent('patrol_support_failed', `${party.name}: патруль вышел без поддержки и понёс потери.`, {
        taskId: task.id,
        partyId: party.id,
        siteId: home?.id || ''
      });
      dirty = true;
      return true;
    }

    if (task.type === 'defend_resource' && site) {
      const holdControl = task.objective === 'hold_control';
      const pressureDelta = holdControl ? 4 + priority : 2 + priority;
      site.security = clamp(siteSecurity(site) - (holdControl ? 5 + priority : 4 + priority), 0, 100);
      site.controlPressure = clamp(Number(site.controlPressure || 0) + pressureDelta, -30, 30);
      site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), now + (holdControl ? 12 : 8) + priority);
      if (!holdControl) site.raidUntil = Math.max(Number(site.raidUntil || 0), now + 8 + priority);
      refreshResourceActivity(site);
      addEvent(holdControl ? 'control_defense_failed' : 'resource_defense_failed', `${site.name}: оборону не успели усилить, давление на точку выросло.`, {
        taskId: task.id,
        siteId: site.id,
        objective: task.objective || '',
        targetFaction: task.targetFaction || ''
      });
      dirty = true;
      return true;
    }

    if (task.type === 'retake_site' && site) {
      const ownerGroup = factionGroup(site.owner || 'neutral');
      site.security = clamp(siteSecurity(site) + (3 + priority), 0, 100);
      site.controlPressure = clamp(Number(site.controlPressure || 0) - (3 + priority), -30, 30);
      site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), now + 14 + priority * 2);
      if (isSupportDemandSite(site)) {
        site.workforce = clamp(Number(site.workforce || 0) - (3 + priority), 0, 100);
        site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) + 2 + Math.floor(priority / 2), 0, 100);
        refreshResourceActivity(site);
      }
      addEvent('retake_site_failed', `${site.name}: попытка вернуть контроль сорвалась, ${factionLabel(ownerGroup)} укрепились.`, {
        taskId: task.id,
        siteId: site.id,
        owner: site.owner || ''
      });
      dirty = true;
      return true;
    }

    return false;
  }

  function expireWorldTasks() {
    const now = Number(state.worldHour || 0);
    for (const task of state.worldTasks) {
      if (!task || task.status !== 'active') continue;
      if (['escort_caravan', 'join_patrol'].includes(String(task.type || '')) && task.partyId) {
        const party = state.parties[task.partyId];
        if (!party || party.destroyed || party.state === 'destroyed') {
          task.status = 'resolved';
          task.completedHour = now;
          task.details = { ...(task.details || {}), finishReason: 'world_task_group_unavailable' };
          removeWorldTaskPartyMembers(task);
          state.stats.worldTasksResolved = Number(state.stats.worldTasksResolved || 0) + 1;
          addEvent('world_task_group_unavailable', `Заявка снята: ${task.title}. Отряд уже недоступен.`, {
            taskId: task.id,
            taskType: task.type,
            partyId: task.partyId,
            siteId: task.siteId
          });
          archiveWorldTask(task);
          continue;
        }
      }
      if (Number(task.expiresHour || 0) > now) continue;
      task.status = 'expired';
      task.completedHour = now;
      const consequenceApplied = applyExpiredWorldTaskConsequences(task);
      task.details = { ...(task.details || {}), finishReason: 'expired', consequenceApplied };
      removeWorldTaskPartyMembers(task);
      state.stats.worldTasksFailed = Number(state.stats.worldTasksFailed || 0) + 1;
      addEvent('world_task_expired', `Задание провалено: ${task.title}.`, {
        taskId: task.id,
        taskType: task.type,
        siteId: task.siteId,
        partyId: task.partyId,
        consequenceApplied
      });
      archiveWorldTask(task);
    }
    state.worldTasks = state.worldTasks
      .sort((a, b) => {
        const activeDelta = (a.status === 'active' ? 1 : 0) - (b.status === 'active' ? 1 : 0);
        if (activeDelta) return -activeDelta;
        return Number(b.createdHour || 0) - Number(a.createdHour || 0);
      });
    compactWorldTasks();
    state.worldZones = (Array.isArray(state.worldZones) ? state.worldZones : [])
      .map(zone => {
        if (!zone || zone.status !== 'active') return zone;
        if (Number(zone.expiresHour || 0) > now) return zone;
        return { ...zone, status: 'expired', resolvedHour: now };
      })
      .filter(zone => {
        if (!zone) return false;
        const details = zone.details && typeof zone.details === 'object' ? zone.details : {};
        if (details.fixedLair) return zone.status === 'active' || zone.status === 'looted' || Number(zone.resolvedHour || 0) + 96 > now;
        return zone.status === 'active' || zone.status === 'looted';
      })
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.createdHour || 0) - Number(a.createdHour || 0))
      .slice(0, MAX_WORLD_ZONE_COUNT);
    cleanupWorldZonesForSingleReality();
  }

  function relation(a, b) {
    if (!a || !b || a === b) return 100;
    const row = state.factions[a] || {};
    const rel = row.relations && Number(row.relations[b]);
    return Number.isFinite(rel) ? rel : 0;
  }

  function hostile(a, b) {
    return relation(a, b) <= -35 || relation(b, a) <= -35;
  }

  function partyPower(party = {}) {
    const playerEscortPower = Array.isArray(party.playerMembers) ? party.playerMembers.length * 7 : 0;
    return Math.max(1, Number(party.strength || 0) + Number(party.members || 0) * 4 + playerEscortPower);
  }

  function partyCargoFillPercent(party = {}) {
    const capacity = Math.max(0, Number(party.cargoCapacity || 0));
    if (capacity <= 0) return 0;
    return clamp(Math.round(stockpileTotal(party.cargo || {}) / capacity * 100), 0, 999);
  }

  function partyThreatInfo(party = {}) {
    if (!party || party.destroyed || party.state === 'destroyed' || party.state === 'engaged' || party.state === 'onsite') {
      return { riskLevel: 0, riskLabel: 'нет', threatPartyId: '', threatName: '', threatDistanceKm: 0 };
    }
    const nearest = nearestParty(party, other =>
      other && other.id !== party.id && !other.destroyed && other.state !== 'destroyed' && other.state !== 'engaged' && other.state !== 'onsite' && hostile(party.faction, other.faction)
    );
    if (!nearest) {
      return { riskLevel: 0, riskLabel: 'спокойно', threatPartyId: '', threatName: '', threatDistanceKm: 0 };
    }
    const distKm = Number(nearest.distKm || 0);
    const distancePressure = clamp(1 - distKm / 45, 0, 1);
    const powerPressure = clamp(partyPower(nearest.party) / partyPower(party), 0, 3);
    const cargoPressure = String(party.kind || '') === 'caravan' ? partyCargoFillPercent(party) / 100 : 0;
    const suppressedMul = Number(party.threatSuppressedUntil || 0) > Number(state.worldHour || 0) ? 0.42 : 1;
    const riskLevel = clamp(Math.round((distancePressure * 52 + powerPressure * 18 + cargoPressure * 18) * suppressedMul), 0, 100);
    const riskLabel = riskLevel >= 75 ? 'критично' : riskLevel >= 55 ? 'опасно' : riskLevel >= 35 ? 'риск' : 'спокойно';
    return {
      riskLevel,
      riskLabel,
      threatPartyId: nearest.party.id || '',
      threatName: nearest.party.name || nearest.party.id || '',
      threatKind: nearest.party.kind || '',
      threatFaction: nearest.party.faction || '',
      threatDistanceKm: Number(distKm.toFixed(1)),
      threatPower: Number(partyPower(nearest.party).toFixed(1))
    };
  }

  function partyPublicStatusText(party = {}, threat = partyThreatInfo(party)) {
    if (String(party.state || '').toLowerCase() === 'forming') {
      const remainingHours = Math.max(0, Number(party.reformAtHour || 0) - Number(state.worldHour || 0));
      return remainingHours > 0
        ? `формируется на базе · выход через ${Math.max(1, Math.ceil(remainingHours))} ч`
        : 'формируется на базе · готовится выйти на маршрут';
    }
    const parts = [];
    const departureLabel = String(party.state || '').toLowerCase() === 'onsite' && Number(party.onsiteDepartureRequestedHour || 0) > 0
      ? 'выходит из локации'
      : '';
    const stateLabel = departureLabel || ({
      moving: 'в пути',
      staging: 'ждет сопровождение',
      recovering: 'перегруппировка',
      forming: 'формируется на базе',
      engaged: 'в бою',
      onsite: 'в локации',
      hunting: 'ищет добычу',
      roaming: 'бродит',
      destroyed: 'разбит'
    }[String(party.state || '').toLowerCase()] || String(party.state || 'отряд'));
    parts.push(stateLabel);
    const destination = state.sites[party.destinationSiteId];
    const targetParty = state.parties[party.targetPartyId || ''];
    if (targetParty && partyTargetIsAvailable(targetParty)) parts.push(`к ${targetParty.name || targetParty.id}`);
    else if (destination) parts.push(`к ${destination.name || destination.id}`);
    const cargo = compactStockpile(party.cargo || {});
    if (stockpileTotal(cargo) > 0) parts.push(`груз ${stockpileSummary(cargo)}`);
    if (String(party.kind || '') === 'caravan') {
      parts.push(`загрузка ${partyCargoFillPercent(party)}%`);
    }
    const playerCount = Array.isArray(party.playerMembers) ? party.playerMembers.length : 0;
    if (playerCount > 0) parts.push(`игроков в группе ${playerCount}`);
    parts.push(`охрана ${Math.round(partyPower(party))}`);
    if (threat?.riskLevel >= 35) {
      parts.push(`${threat.riskLabel}: ${threat.threatName || 'угроза'} в ${threat.threatDistanceKm} км`);
    }
    return parts.filter(Boolean).join(' · ');
  }

  function partyLeaderPublicMember(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    if (kind === 'caravan') {
      return { id: `${party.id || 'caravan'}_merchant`, name: 'Караванщик', role: 'Глава каравана', type: 'npc', leader: true };
    }
    if (kind === 'patrol') {
      return { id: `${party.id || 'patrol'}_leader`, name: 'Командир патруля', role: 'Глава отряда', type: 'npc', leader: true };
    }
    return { id: `${party.id || 'party'}_leader`, name: party.name || 'Лидер отряда', role: 'Глава отряда', type: 'npc', leader: true };
  }

  function partyNpcPublicMembers(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const count = Math.max(0, Math.round(Number(party.members || 0)) - 1);
    const role = kind === 'caravan' ? 'Охрана каравана' : kind === 'patrol' ? 'Патрульный' : 'Участник отряда';
    const name = kind === 'caravan' ? 'Охранник каравана' : kind === 'patrol' ? 'Патрульный' : 'Боец отряда';
    return Array.from({ length: Math.min(12, count) }, (_, index) => ({
      id: `${party.id || 'party'}_${kind === 'patrol' ? 'patrol' : 'guard'}_${index + 1}`,
      name: index === 0 && kind === 'caravan' ? 'Старший охранник каравана' : name,
      role,
      type: 'npc',
      leader: false
    }));
  }

  function partyPlayerPublicMembers(party = {}) {
    return Array.isArray(party.playerMembers) ? party.playerMembers.map((row, index) => ({
      id: `${party.id || 'party'}_player_${index + 1}`,
      name: row.name || 'Игрок',
      role: 'Сопровождение',
      type: 'player',
      leader: false,
      factionId: row.factionId || '',
      taskId: row.taskId || '',
      joinedHour: row.joinedHour || 0
    })).slice(0, worldPartyPlayerLimit(party)) : [];
  }

  function publicPartyMovementRoutePoints(party = {}) {
    const routeIndex = Math.max(1, Math.floor(Number(party.infrastructureRouteIndex || 1)));
    const route = [{ x: party.x, y: party.y }, ...(
      Array.isArray(party.infrastructureRoutePoints) ? party.infrastructureRoutePoints : []
    ).slice(routeIndex, routeIndex + 64)]
      .map(point => ({ x: Number(point?.x || 0), y: Number(point?.y || 0) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!route.length) return [{ x: 0, y: 0 }];

    const pointKm = Math.max(0.001, mapPointKm(getGlobalMap()));
    const lookaheadWorldHours = PUBLIC_PARTY_MOTION_LOOKAHEAD_MS / gameDayRealMs * 24;
    let remainingPoints = Math.max(0, effectiveWorldPartySpeedKmh(party) * lookaheadWorldHours / pointKm);
    const visibleRoute = [route[0]];
    for (let index = 1; index < route.length && remainingPoints > 0.001; index++) {
      const from = visibleRoute[visibleRoute.length - 1];
      const to = route[index];
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance <= 0.001) continue;
      if (distance <= remainingPoints + 0.001) {
        visibleRoute.push(to);
        remainingPoints = Math.max(0, remainingPoints - distance);
        continue;
      }
      const progress = remainingPoints / distance;
      visibleRoute.push({
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress
      });
      remainingPoints = 0;
    }
    return visibleRoute
      .map(point => ({
        x: Number(point.x.toFixed(2)),
        y: Number(point.y.toFixed(2))
      }))
      .filter((point, index, rows) => index === 0
        || Math.hypot(point.x - rows[index - 1].x, point.y - rows[index - 1].y) > 0.01);
  }

  function publicParty(party = {}) {
    const threat = partyThreatInfo(party);
    const destination = state.sites[party.destinationSiteId];
    const home = state.sites[party.homeSiteId];
    const targetParty = state.parties[party.targetPartyId || ''];
    const cargo = compactStockpile(party.cargo || {});
    const leader = partyLeaderPublicMember(party);
    const npcMembers = partyNpcPublicMembers(party);
    const playerMembers = partyPlayerPublicMembers(party);
    const playerMemberLimit = worldPartyPlayerLimit(party);
    const npcMemberCount = Math.max(1, Math.round(Number(party.members || 1)));
    const movementRoutePoints = publicPartyMovementRoutePoints(party);
    return {
      id: party.id,
      name: party.name,
      kind: party.kind,
      faction: party.faction,
      species: party.species || '',
      visual: party.visual || party.species || '',
      encounterId: partyMeetingEncounterId(party),
      state: party.state,
      destroyed: !!party.destroyed,
      dynamic: !!party.dynamic,
      respawnDisabled: !!party.respawnDisabled,
      x: Number(Number(party.x || 0).toFixed(2)),
      y: Number(Number(party.y || 0).toFixed(2)),
      speedKmh: Number(effectiveWorldPartySpeedKmh(party).toFixed(1)),
      movementRoutePoints,
      homeSiteId: party.homeSiteId || '',
      homeSiteName: home?.name || '',
      destinationSiteId: party.destinationSiteId || '',
      destinationSiteName: destination?.name || '',
      targetPartyId: partyTargetIsAvailable(targetParty) ? targetParty.id : '',
      targetPartyName: partyTargetIsAvailable(targetParty) ? (targetParty.name || targetParty.id) : '',
      decisionKind: party.decisionKind || '',
      decisionReason: party.decisionReason || '',
      decisionAtHour: party.decisionAtHour || 0,
      nextDecisionHour: party.nextDecisionHour || 0,
      route: Array.isArray(party.route) ? party.route.slice(0, 16) : [],
      cargoCapacity: party.cargoCapacity || 0,
      cargo,
      cargoTotal: Math.floor(stockpileTotal(cargo)),
      cargoFillPercent: partyCargoFillPercent(party),
      cargoSummary: stockpileSummary(cargo),
      supplyRole: party.supplyRole || '',
      members: party.members,
      leader,
      leaderId: leader.id,
      leaderName: leader.name,
      leaderRole: leader.role,
      npcMembers,
      npcMemberCount,
      playerMemberLimit,
      playerSlotsLeft: Math.max(0, playerMemberLimit - playerMembers.length),
      playerMemberCount: playerMembers.length,
      playerMembers,
      groupMembers: [leader, ...npcMembers, ...playerMembers].slice(0, 30),
      groupMemberCount: npcMemberCount + playerMembers.length,
      stagingSiteId: party.stagingSiteId || '',
      stagingUntilHour: party.stagingUntilHour || 0,
      stagingMinPlayers: party.stagingMinPlayers || 0,
      stagingJoinClosed: !!party.stagingJoinClosed,
      onsiteZoneId: party.onsiteZoneId || '',
      onsiteSiteId: party.onsiteSiteId || '',
      onsiteReason: party.onsiteReason || '',
      onsiteUntilHour: party.onsiteUntilHour || 0,
      onsiteDepartureRequested: Number(party.onsiteDepartureRequestedHour || 0) > 0,
      engagedZoneId: party.engagedZoneId || '',
      engagedUntilHour: party.engagedUntilHour || 0,
      recoverUntilHour: party.recoverUntilHour || 0,
      reformAtHour: party.reformAtHour || 0,
      formationStartedHour: party.formationStartedHour || 0,
      strength: Number(Number(party.strength || 0).toFixed(1)),
      escortPower: Number(partyPower(party).toFixed(1)),
      riskLevel: threat.riskLevel,
      riskLabel: threat.riskLabel,
      threatPartyId: threat.threatPartyId || '',
      threatName: threat.threatName || '',
      threatKind: threat.threatKind || '',
      threatDistanceKm: threat.threatDistanceKm || 0,
      statusText: partyPublicStatusText(party, threat),
      threatSuppressedUntil: party.threatSuppressedUntil || 0,
      lastLoadedHour: party.lastLoadedHour || 0,
      lastLoadedSiteId: party.lastLoadedSiteId || '',
      lastDeliveryHour: party.lastDeliveryHour || 0,
      reformAtHour: party.reformAtHour || 0
    };
  }

  function siteControlIntel(site = {}) {
    if (!isContestedWorldSite(site)) {
      return {
        owner: site.owner || 'neutral',
        ownerLabel: factionLabel(site.owner || 'neutral'),
        pressure: 0,
        state: 'stable',
        stateLabel: 'стабильно',
        hostilePower: 0,
        friendlyPower: 0,
        strongestHostileFaction: '',
        strongestHostileName: '',
        strongestHostileDistanceKm: 0
      };
    }
    const globalMap = getGlobalMap();
    let hostilePower = 0;
    let friendlyPower = 0;
    let strongestHostile = null;
    for (const party of Object.values(state.parties)) {
      if (!party || party.destroyed || party.state === 'destroyed') continue;
      const distKm = pointDistanceKm(site, party, globalMap);
      if (distKm > 10) continue;
      const proximity = 1 - Math.min(1, distKm / 10);
      const power = partyPower(party) * proximity;
      if (hostile(party.faction, site.owner)) {
        hostilePower += power;
        if (!strongestHostile || power > strongestHostile.power) strongestHostile = { party, power, distKm };
      } else if (factionGroup(party.faction) === factionGroup(site.owner) || relation(party.faction, site.owner) > 20) {
        friendlyPower += power;
      }
    }
    const pressure = Number(Number(site.controlPressure || 0).toFixed(2));
    let stateKey = 'stable';
    if (pressure >= 12 || Number(site.security || 0) < 24) stateKey = 'critical';
    else if (pressure >= 7) stateKey = 'contested';
    else if (pressure <= -7) stateKey = 'secured';
    else if (hostilePower > friendlyPower + 18) stateKey = 'threatened';
    const stateLabel = {
      stable: 'стабильно',
      threatened: 'рядом угроза',
      contested: 'спорная зона',
      critical: 'на грани потери',
      secured: 'контроль укрепляется'
    }[stateKey] || 'стабильно';
    return {
      owner: site.owner || 'neutral',
      ownerLabel: factionLabel(site.owner || 'neutral'),
      pressure,
      state: stateKey,
      stateLabel,
      hostilePower: Number(hostilePower.toFixed(1)),
      friendlyPower: Number(friendlyPower.toFixed(1)),
      strongestHostileFaction: strongestHostile?.party?.faction || '',
      strongestHostileName: strongestHostile?.party?.name || '',
      strongestHostileKind: strongestHostile?.party?.kind || '',
      strongestHostileDistanceKm: strongestHostile ? Number(strongestHostile.distKm.toFixed(1)) : 0
    };
  }

  function partyDecisionInterval(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    const base = kind === 'patrol' ? 0.75 : kind === 'raider' || kind === 'monster' ? 0.9 : 1.15;
    const rng = seededRandom(`party-decision:${party.id || 'party'}:${Math.floor(Number(state.worldHour || 0) / 6)}`);
    return clamp(base + rng() * 0.75, PARTY_DECISION_MIN_HOURS, PARTY_DECISION_MAX_HOURS);
  }

  function partyMissionLocksDestination(party = {}) {
    const kind = String(party.kind || '').toLowerCase();
    return kind === 'support'
      || !!party.resourceExport
      || !!party.productionExport
      || !!party.interFactionTrade
      || !!party.supportSiteId
      || (!!party.stagingJoinClosed && !!party.destinationSiteId)
      || (String(party.state || '').toLowerCase() === 'staging' && !!party.destinationSiteId);
  }

  function partyTargetIsAvailable(target = null) {
    if (!target || target.destroyed || target.state === 'destroyed') return false;
    return !['engaged', 'onsite', 'recovering'].includes(String(target.state || '').toLowerCase());
  }

  function partySiteRelationScore(party = {}, site = {}) {
    const faction = factionGroup(party.faction || 'neutral');
    const owner = factionGroup(site.owner || 'neutral');
    if (owner === faction) return 2;
    if (owner === 'neutral') return 0.5;
    if (hostile(faction, owner)) return -2;
    return relation(faction, owner) >= 20 || relation(owner, faction) >= 20 ? 1 : 0;
  }

  function partySiteRecentPenalty(party = {}, site = {}) {
    const visited = Number(party.siteVisitHours?.[site.id] ?? -9999);
    const age = Number(state.worldHour || 0) - visited;
    if (age >= 24) return 0;
    return Math.max(0, 32 - age * 1.25);
  }

  function partyDecisionTieBreak(party = {}, key = '') {
    const rng = seededRandom(`party-choice:${party.id || 'party'}:${key}:${Math.floor(Number(state.worldHour || 0) / 12)}`);
    return rng() * 2.5;
  }

  function bestPartyDecision(rows = []) {
    return (Array.isArray(rows) ? rows : [])
      .filter(row => row && Number.isFinite(Number(row.score)))
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))[0] || null;
  }

  function partyRetreatDecision(party = {}, threat = null) {
    const info = threat || partyThreatInfo(party);
    if (!info?.threatPartyId || Number(info.threatDistanceKm || Infinity) > 30) return null;
    if (Number(info.riskLevel || 0) < 62 || Number(info.threatPower || 0) <= partyPower(party) * 1.03) return null;
    const home = state.sites[party.homeSiteId || ''];
    const candidates = Object.values(state.sites || {})
      .filter(site => site && site.locationId && isSettlementServiceSite(site) && partySiteRelationScore(party, site) >= 1)
      .map(site => ({
        site,
        kind: 'retreat',
        reason: 'stronger_hostile_nearby',
        score: 400 + Number(site.security || 0) * 1.4 - pointDistanceKm(party, site, getGlobalMap()) * 2
          + (home && site.id === home.id ? 45 : 0)
      }));
    const fallback = bestPartyDecision(candidates)?.site || home || null;
    return fallback ? { site: fallback, kind: 'retreat', reason: 'stronger_hostile_nearby', score: 400 } : null;
  }

  function caravanAutonomyDecisions(party = {}) {
    const globalMap = getGlobalMap();
    const cargoTotal = stockpileTotal(party.cargo || {});
    const capacity = Math.max(1, Number(party.cargoCapacity || 1));
    const fill = clamp(cargoTotal / capacity, 0, 2);
    const preferred = new Set((Array.isArray(party.preferredResources) ? party.preferredResources : []).map(id => safeId(id, '')).filter(Boolean));
    const rows = [];
    if (cargoTotal > 0) {
      Object.values(state.sites || {}).forEach(site => {
        if (!site?.locationId || !isSettlementServiceSite(site) || !caravanCanDeliverToSite(party, site)) return;
        const demand = Object.keys(party.cargo || {}).reduce((sum, key) => (
          sum + Math.max(0, 18 - Number(site.stockpile?.[key] || 0))
        ), 0);
        const conflictPenalty = activeSiteConflict(site) ? 180 : 0;
        rows.push({
          site,
          kind: 'deliver',
          reason: demand > 12 ? 'market_shortage' : 'cargo_loaded',
          score: 115 + fill * 145 + demand * 2.4 + partySiteRelationScore(party, site) * 18
            - pointDistanceKm(party, site, globalMap) * 1.25 - conflictPenalty
            - partySiteRecentPenalty(party, site) + partyDecisionTieBreak(party, site.id)
        });
      });
    }
    if (fill < 0.86) {
      Object.values(state.sites || {}).forEach(site => {
        if (!site?.locationId || !isHarvestSite(site) || partySiteRelationScore(party, site) < 0) return;
        const output = site.output && typeof site.output === 'object' ? site.output : {};
        const matching = Object.entries(output).reduce((sum, [key, value]) => (
          sum + ((!preferred.size || preferred.has(safeId(key, ''))) ? Number(value || 0) : 0)
        ), 0);
        if (matching <= 0) return;
        rows.push({
          site,
          kind: 'harvest',
          reason: 'resource_demand',
          score: 105 + matching * 3 + Number(site.resourceActivity || 0) * 0.35
            + Number(site.resourceRichness || 0) * 0.25 - fill * 90
            - Number(site.danger || 0) * 11 - pointDistanceKm(party, site, globalMap) * 1.1
            - (activeSiteConflict(site) ? 190 : 0) - partySiteRecentPenalty(party, site)
            + partyDecisionTieBreak(party, site.id)
        });
      });
    }
    return rows;
  }

  function patrolAutonomyDecisions(party = {}) {
    const globalMap = getGlobalMap();
    const rows = [];
    Object.values(state.sites || {}).forEach(site => {
      if (!site?.locationId || partySiteRelationScore(party, site) < 1) return;
      const conflict = activeSiteConflict(site);
      const contested = isContestedWorldSite(site);
      rows.push({
        site,
        kind: conflict ? 'defend' : 'patrol',
        reason: conflict ? 'friendly_site_attacked' : (Number(site.security || 0) < 35 ? 'weak_friendly_site' : 'area_patrol'),
        score: (conflict ? 330 : contested ? 92 : 58) + Math.max(0, 55 - Number(site.security || 0))
          - pointDistanceKm(party, site, globalMap) * (conflict ? 1.15 : 0.9)
          - partySiteRecentPenalty(party, site) + partyDecisionTieBreak(party, site.id)
      });
    });
    Object.values(state.parties || {}).forEach(target => {
      if (!partyTargetIsAvailable(target) || target.id === party.id || !hostile(party.faction, target.faction)) return;
      const distance = pointDistanceKm(party, target, globalMap);
      if (distance > PARTY_DYNAMIC_HUNT_DISTANCE_KM) return;
      const ratio = partyPower(party) / Math.max(1, partyPower(target));
      if (ratio < 0.72 && distance > 12) return;
      rows.push({
        targetParty: target,
        kind: 'intercept',
        reason: 'hostile_group_detected',
        score: 255 + Math.min(70, ratio * 24) - distance * 2.1
          + (String(target.kind || '').toLowerCase() === 'raider' ? 28 : 0)
          + partyDecisionTieBreak(party, target.id)
      });
    });
    return rows;
  }

  function hostileAutonomyDecisions(party = {}) {
    const globalMap = getGlobalMap();
    const kind = String(party.kind || '').toLowerCase();
    const rows = [];
    Object.values(state.parties || {}).forEach(target => {
      if (!partyTargetIsAvailable(target) || target.id === party.id || !hostile(party.faction, target.faction)) return;
      const distance = pointDistanceKm(party, target, globalMap);
      if (distance > PARTY_DYNAMIC_HUNT_DISTANCE_KM) return;
      const ratio = partyPower(party) / Math.max(1, partyPower(target));
      if (ratio < 0.62 && distance > 10) return;
      const cargoValue = String(target.kind || '').toLowerCase() === 'caravan' ? partyCargoFillPercent(target) : 0;
      rows.push({
        targetParty: target,
        kind: kind === 'monster' ? 'hunt' : 'ambush',
        reason: cargoValue > 0 ? 'vulnerable_caravan' : 'hostile_group_nearby',
        score: 230 + cargoValue * 0.9 + Math.min(80, ratio * 26) - distance * 2.2
          + partyDecisionTieBreak(party, target.id)
      });
    });
    Object.values(state.sites || {}).forEach(site => {
      if (!site?.locationId || isCapitalProtectedSite(site) || site.id === party.homeSiteId) return;
      const relationScore = partySiteRelationScore(party, site);
      if (relationScore >= 1) return;
      const stockValue = stockpileTotal(site.stockpile || {});
      const security = Number(site.security ?? siteDefaultSecurity(site));
      rows.push({
        site,
        kind: kind === 'monster' ? 'forage' : 'raid',
        reason: security < 35 ? 'weak_location' : 'valuable_location',
        score: 105 + Math.min(90, stockValue * 0.45) - security * 1.15
          - pointDistanceKm(party, site, globalMap) * 1.05 - partySiteRecentPenalty(party, site)
          + partyDecisionTieBreak(party, site.id)
      });
    });
    return rows;
  }

  function routePreferenceDecisions(party = {}) {
    const globalMap = getGlobalMap();
    return [...new Set((Array.isArray(party.route) ? party.route : []).map(id => safeId(id, '')).filter(Boolean))]
      .map(id => state.sites[id])
      .filter(Boolean)
      .map(site => ({
        site,
        kind: 'roam',
        reason: 'local_activity',
        score: 52 - pointDistanceKm(party, site, globalMap) * 0.45
          - partySiteRecentPenalty(party, site) + partyDecisionTieBreak(party, site.id)
      }));
  }

  function applyPartyDecision(party = {}, decision = null) {
    if (!party || !decision) return null;
    const targetParty = decision.targetParty && partyTargetIsAvailable(decision.targetParty) ? decision.targetParty : null;
    const site = !targetParty && decision.site && state.sites[decision.site.id] ? state.sites[decision.site.id] : null;
    if (!targetParty && !site) return null;
    const nextTargetPartyId = targetParty?.id || '';
    const nextSiteId = site?.id || '';
    const changed = String(party.targetPartyId || '') !== nextTargetPartyId
      || String(party.destinationSiteId || '') !== nextSiteId;
    party.targetPartyId = nextTargetPartyId;
    party.destinationSiteId = nextSiteId;
    party.decisionKind = safeId(decision.kind || 'roam', 'roam');
    party.decisionReason = safeId(decision.reason || 'world_state', 'world_state');
    party.decisionScore = Number(Number(decision.score || 0).toFixed(2));
    party.decisionAtHour = Number(state.worldHour || 0);
    party.nextDecisionHour = Number(state.worldHour || 0) + partyDecisionInterval(party);
    party.autonomyVersion = WORLD_PARTY_AUTONOMY_VERSION;
    if (changed) clearPartyInfrastructureRoute(party);
    dirty = true;
    return targetParty || site;
  }

  function chooseNextDestination(party, options = {}) {
    if (!party || party.destroyed || party.state === 'destroyed') return null;
    const avoidSiteId = safeId(options.avoidSiteId || '', '');
    if (avoidSiteId && String(party.destinationSiteId || '') === avoidSiteId) {
      party.destinationSiteId = '';
      party.targetPartyId = '';
      party.nextDecisionHour = 0;
      clearPartyInfrastructureRoute(party);
    }
    const lockedSite = state.sites[party.supportSiteId || party.destinationSiteId || ''] || null;
    if (partyMissionLocksDestination(party) && lockedSite && lockedSite.id !== avoidSiteId) {
      return applyPartyDecision(party, {
        site: lockedSite,
        kind: 'mission',
        reason: party.supportSiteId ? 'support_dispatch' : 'cargo_mission',
        score: 1000
      });
    }
    const retreat = partyRetreatDecision(party);
    if (retreat) return applyPartyDecision(party, retreat);
    const kind = String(party.kind || '').toLowerCase();
    let rows = [];
    if (kind === 'caravan') rows = caravanAutonomyDecisions(party);
    else if (kind === 'patrol') rows = patrolAutonomyDecisions(party);
    else if (kind === 'raider' || kind === 'monster' || partyIsHostileEncounterParty(party)) rows = hostileAutonomyDecisions(party);
    rows.push(...routePreferenceDecisions(party));
    if (avoidSiteId) rows = rows.filter(row => String(row?.site?.id || '') !== avoidSiteId);
    const home = state.sites[party.homeSiteId || ''] || state.sites[party.lastSiteId || ''] || state.sites.settlement || null;
    if (home && home.id !== avoidSiteId) rows.push({
      site: home,
      kind: 'return',
      reason: 'no_better_goal',
      score: 36 - pointDistanceKm(party, home, getGlobalMap()) * 0.25 + partyDecisionTieBreak(party, home.id)
    });
    const decision = bestPartyDecision(rows);
    if (decision) return applyPartyDecision(party, decision);
    if (options.keepCurrent !== false) {
      const target = state.parties[party.targetPartyId || ''];
      if (partyTargetIsAvailable(target)) return target;
      const current = state.sites[party.destinationSiteId || ''];
      if (current && current.id !== avoidSiteId) return current;
    }
    return null;
  }

  function refreshPartyDecision(party = {}, force = false) {
    if (!party || party.destroyed || party.state === 'destroyed') return null;
    const target = state.parties[party.targetPartyId || ''];
    const destination = state.sites[party.destinationSiteId || ''];
    const invalidTarget = !!party.targetPartyId && !partyTargetIsAvailable(target);
    const invalidDestination = !!party.destinationSiteId && !destination;
    if (!force && !invalidTarget && !invalidDestination && Number(state.worldHour || 0) < Number(party.nextDecisionHour || 0)) {
      return target || destination || null;
    }
    return chooseNextDestination(party, { keepCurrent: false });
  }

  function caravanCanDeliverToSite(party = {}, site = {}) {
    if (!party || !site || !isSettlementServiceSite(site)) return false;
    const faction = factionGroup(party.faction || '');
    const owner = factionGroup(site.owner || 'neutral');
    if (!owner || owner === 'neutral') return true;
    if (owner === faction) return true;
    return !hostile(faction, owner) && (relation(faction, owner) >= 20 || relation(owner, faction) >= 20);
  }

  function caravanFallbackDestination(party = {}, blockedSite = null) {
    const faction = factionGroup(party.faction || '');
    const home = state.sites[party.homeSiteId || ''];
    const candidates = Object.values(state.sites || {})
      .filter(site => site
        && site.id !== blockedSite?.id
        && isSettlementServiceSite(site)
        && caravanCanDeliverToSite(party, site))
      .map(site => {
        const dist = pointDistanceKm(party, site, getGlobalMap());
        const isHome = home && site.id === home.id ? -18 : 0;
        const isCapital = isFactionCapitalSite(site) ? -8 : 0;
        const need = stockpileTotal(resourceSiteSupportDemand(site, resourceSiteSupportReason(site) || 'low_stock'));
        return { site, score: dist - need * 1.25 + isHome + isCapital };
      })
      .sort((a, b) => a.score - b.score);
    return candidates[0]?.site || (home && caravanCanDeliverToSite(party, home) ? home : null);
  }

  function rerouteCaravanIfDestinationInvalid(party = {}, destination = null, reason = 'destination_lost') {
    if (!party || String(party.kind || '').toLowerCase() !== 'caravan') return destination;
    if (stockpileTotal(party.cargo || {}) <= 0) return destination;
    if (!destination || !isSettlementServiceSite(destination) || caravanCanDeliverToSite(party, destination)) return destination;
    const fallback = caravanFallbackDestination(party, destination);
    if (!fallback || fallback.id === destination.id) return destination;
    party.destinationSiteId = fallback.id;
    addEvent('caravan_rerouted', `${party.name} развернулся: ${destination.name || destination.id} больше не безопасна для доставки. Новый пункт: ${fallback.name || fallback.id}.`, {
      partyId: party.id,
      fromSiteId: destination.id,
      toSiteId: fallback.id,
      reason,
      cargo: compactStockpile(party.cargo || {})
    });
    dirty = true;
    return fallback;
  }

  function caravanStagingMinPlayers(party = {}) {
    return String(party.supplyRole || '').toLowerCase() === 'heavy'
      ? HEAVY_CARAVAN_ESCORT_MIN_PLAYERS
      : CARAVAN_ESCORT_MIN_PLAYERS;
  }

  function caravanStagingIsOpen(party = {}) {
    if (!party || String(party.kind || '').toLowerCase() !== 'caravan' || party.stagingJoinClosed) return false;
    const stateKey = String(party.state || '').toLowerCase();
    return stateKey === 'staging'
      || (stateKey === 'onsite' && String(party.onsiteReason || '').toLowerCase() === 'staging' && !!party.stagingSiteId);
  }

  function clearCaravanStaging(party = {}) {
    if (!party) return;
    party.stagingSiteId = '';
    party.stagingTaskId = '';
    party.stagingStartedHour = 0;
    party.stagingUntilHour = 0;
    party.stagingMinPlayers = 0;
    party.stagingJoinClosed = false;
  }

  function updateCaravanStagingTask(party = {}, site = {}, destination = null, departed = false) {
    const task = state.worldTasks.find(row => row && row.status === 'active' && (
      row.id === party.stagingTaskId || row.key === `escort_caravan:${party.id}`
    ));
    if (!task) return null;
    task.siteId = site.id || task.siteId || party.homeSiteId || '';
    task.issuerSiteId = task.issuerSiteId || site.id || party.homeSiteId || '';
    task.partyId = party.id || task.partyId || '';
    const playerLimit = worldPartyPlayerLimit(party, task);
    const taskMembers = Array.isArray(party.playerMembers)
      ? party.playerMembers.filter(member => member?.taskId === task.id).slice(0, playerLimit)
      : [];
    task.details = {
      ...(task.details || {}),
      staging: !departed,
      joinOpen: !departed,
      joinClosed: !!departed,
      stagingSiteId: site.id || '',
      destinationSiteId: destination?.id || party.destinationSiteId || '',
      minPlayers: Number(party.stagingMinPlayers || caravanStagingMinPlayers(party)),
      playerLimit,
      joinedPlayers: taskMembers.map(row => row.id).filter(Boolean),
      playerCount: taskMembers.length,
      waitUntilHour: Number(party.stagingUntilHour || 0),
      departedHour: departed ? Number(state.worldHour || 0) : Number(task.details?.departedHour || 0),
      cargo: compactStockpile(party.cargo || {})
    };
    dirty = true;
    return task;
  }

  function createCaravanStagingTask(party = {}, site = {}, destination = null) {
    const minPlayers = caravanStagingMinPlayers(party);
    const task = createWorldTask('escort_caravan', {
      key: `escort_caravan:${party.id}`,
      title: `${String(party.supplyRole || '').toLowerCase() === 'heavy' ? 'Тяжелый караван' : 'Караван'} ждет сопровождение: ${party.name}`,
      text: `${party.name} стоит у ${site.name || site.id} и ждет сопровождение перед выходом ${destination ? `к ${destination.name}` : 'по маршруту'}. Набор закрывается после выхода каравана.`,
      siteId: site.id || party.homeSiteId || 'settlement',
      partyId: party.id,
      targetFaction: '',
      objective: String(party.supplyRole || '').toLowerCase() === 'heavy' ? 'escort_heavy_caravan' : 'escort_regular_caravan',
      durationHours: Math.max(12, realMinutesToWorldHours(CARAVAN_STAGING_REAL_MINUTES) + 24),
      priority: String(party.supplyRole || '').toLowerCase() === 'heavy' ? 4 : 3,
      details: {
        staging: true,
        joinOpen: true,
        stagingSiteId: site.id || '',
        destinationSiteId: destination?.id || party.destinationSiteId || '',
        minPlayers,
        playerLimit: worldPartyPlayerLimit(party),
        waitRealMinutes: CARAVAN_STAGING_REAL_MINUTES,
        waitUntilHour: Number(party.stagingUntilHour || 0),
        cargo: compactStockpile(party.cargo || {})
      }
    });
    if (task) party.stagingTaskId = task.id;
    updateCaravanStagingTask(party, site, destination, false);
    return task;
  }

  function beginCaravanStaging(party = {}, site = {}) {
    if (!party || String(party.kind || '').toLowerCase() !== 'caravan' || !site) return false;
    if (stockpileTotal(party.cargo || {}) <= 0) return false;
    let destination = state.sites[party.destinationSiteId];
    if (!destination || destination.id === site.id) destination = chooseNextDestination(party);
    if (!destination || destination.id === site.id) return false;
    const now = Number(state.worldHour || 0);
    party.state = 'staging';
    party.x = Number(site.x || party.x || 0);
    party.y = Number(site.y || party.y || 0);
    party.stagingSiteId = site.id || '';
    party.stagingStartedHour = now;
    party.stagingUntilHour = now + realMinutesToWorldHours(CARAVAN_STAGING_REAL_MINUTES);
    party.stagingMinPlayers = caravanStagingMinPlayers(party);
    party.stagingJoinClosed = false;
    createCaravanStagingTask(party, site, destination);
    addEvent('caravan_staging', `${party.name} ждет сопровождение у ${site.name || site.id}.`, {
      partyId: party.id,
      siteId: site.id,
      destinationSiteId: destination.id,
      minPlayers: party.stagingMinPlayers,
      waitUntilHour: party.stagingUntilHour,
      cargo: compactStockpile(party.cargo || {})
    });
    dirty = true;
    return true;
  }

  function beginCaravanStagingOnsite(party = {}, site = {}, options = {}) {
    if (!beginCaravanStaging(party, site)) return false;
    const zone = beginPartyOnsiteVisit(party, site, {
      reason: 'staging',
      dwellHours: Math.max(0.25, Number(party.stagingUntilHour || 0) - Number(state.worldHour || 0)),
      arrivalFrom: options.arrivalFrom
    });
    if (zone) return true;
    const stagingTaskId = String(party.stagingTaskId || '');
    if (stagingTaskId) state.worldTasks = state.worldTasks.filter(task => String(task?.id || '') !== stagingTaskId);
    state.events = state.events.filter(event => !(event?.type === 'caravan_staging' && String(event?.partyId || '') === String(party.id || '')));
    clearCaravanStaging(party);
    party.state = 'moving';
    return false;
  }

  function updateCaravanStaging(party = {}, hours = 0) {
    if (!party || String(party.state || '').toLowerCase() !== 'staging') return false;
    const site = state.sites[party.stagingSiteId] || state.sites[party.lastSiteId] || state.sites[party.homeSiteId];
    let destination = state.sites[party.destinationSiteId];
    if (!destination || destination.id === site?.id) destination = chooseNextDestination(party);
    if (site) {
      party.x = Number(site.x || party.x || 0);
      party.y = Number(site.y || party.y || 0);
      const zone = beginPartyOnsiteVisit(party, site, {
        reason: 'staging',
        dwellHours: Math.max(0.25, Number(party.stagingUntilHour || 0) - Number(state.worldHour || 0))
      });
      if (zone) return true;
    }
    const now = Number(state.worldHour || 0);
    const minPlayers = Number(party.stagingMinPlayers || caravanStagingMinPlayers(party));
    const joined = worldPartyPlayerCount(party);
    updateCaravanStagingTask(party, site || {}, destination, false);
    const enoughPlayers = minPlayers > 0 && joined >= minPlayers;
    const waitExpired = now >= Number(party.stagingUntilHour || 0);
    if (!enoughPlayers && !waitExpired) return true;
    party.state = 'moving';
    party.stagingJoinClosed = true;
    updateCaravanStagingTask(party, site || {}, destination, true);
    addEvent('caravan_departed', `${party.name} вышел из ${site?.name || party.stagingSiteId || 'точки'} к ${destination?.name || party.destinationSiteId || 'маршруту'}.`, {
      partyId: party.id,
      siteId: site?.id || '',
      destinationSiteId: destination?.id || party.destinationSiteId || '',
      playerCount: joined,
      minPlayers,
      reason: enoughPlayers ? 'group_ready' : 'wait_expired',
      cargo: compactStockpile(party.cargo || {})
    });
    dirty = true;
    return false;
  }

  function partyRewardPlayerDetails(party = {}, taskId = '') {
    const id = safeId(taskId || '', '');
    const members = Array.isArray(party.playerMembers)
      ? party.playerMembers.filter(member => member && (!id || member.taskId === id))
      : [];
    const rewardPlayerIds = [];
    const rewardCharacterIds = [];
    const rewardMemberKeys = [];
    const rewardPlayerNames = [];
    members.forEach(member => {
      [member.id, member.playerId, member.characterId].forEach(value => {
        const id = safeId(value || '', '');
        if (id && !rewardPlayerIds.includes(id)) rewardPlayerIds.push(id);
      });
      const characterId = safeId(member.characterId || member.id || '', '');
      if (characterId && !rewardCharacterIds.includes(characterId)) rewardCharacterIds.push(characterId);
      const memberKey = normalizedWorldPartyMemberKey(member.userId || '', characterId);
      if (memberKey && !rewardMemberKeys.includes(memberKey)) rewardMemberKeys.push(memberKey);
      const name = safeMemberName(member.name || '', '');
      if (name && !rewardPlayerNames.includes(name)) rewardPlayerNames.push(name);
    });
    return {
      rewardPlayerIds: rewardPlayerIds.slice(0, 24),
      rewardCharacterIds: rewardCharacterIds.slice(0, 24),
      rewardMemberKeys: rewardMemberKeys.slice(0, 24),
      rewardPlayerNames: rewardPlayerNames.slice(0, 24),
      rewardPlayerCount: members.length
    };
  }

  function fundWorldTaskCapsRewardFromSite(task = null, payerSite = null, playerCount = 1) {
    if (!task || !payerSite) return 0;
    const reward = task.reward && typeof task.reward === 'object' ? task.reward : {};
    const requestedPerPlayer = Math.max(0, Math.floor(Number(reward.caps || 0)));
    const recipients = Math.max(1, Math.floor(Number(playerCount || 1)));
    if (requestedPerPlayer <= 0) return 0;
    const stock = payerSite.stockpile || (payerSite.stockpile = emptyStockpile());
    const available = Math.max(0, Math.floor(Number(stock.silver || 0)));
    const totalRequested = requestedPerPlayer * recipients;
    const totalPaid = Math.min(available, totalRequested);
    const paidPerPlayer = Math.floor(totalPaid / recipients);
    const deducted = paidPerPlayer * recipients;
    stock.silver = Math.max(0, available - deducted);
    task.reward = {
      ...reward,
      caps: paidPerPlayer
    };
    task.details = {
      ...(task.details || {}),
      rewardPayerSiteId: payerSite.id || '',
      rewardCapsRequested: requestedPerPlayer,
      rewardCapsPerPlayer: paidPerPlayer,
      rewardCapsTotal: deducted,
      rewardCapsLimitedByTreasury: paidPerPlayer < requestedPerPlayer
    };
    return paidPerPlayer;
  }

  function deliverCargo(party, site) {
    if (!party || !site) return;
    const cargo = compactStockpile(party.cargo && typeof party.cargo === 'object' ? party.cargo : {});
    const keys = Object.keys(cargo).filter(key => Number(cargo[key] || 0) > 0);
    party.cargo = cargo;
    if (!keys.length) return;
    const delivered = clone(cargo);
    addStockpile(site.stockpile, delivered);
    party.cargo = {};
    clearCaravanStaging(party);
    if (party.kind === 'caravan') {
      state.stats.caravansArrived = Number(state.stats.caravansArrived || 0) + 1;
      state.stats.resourcesDelivered = addStockpile(state.stats.resourcesDelivered || {}, delivered);
      party.lastDeliveryHour = state.worldHour;
      site.lastSupplyHour = state.worldHour;
      site.lastDelivery = {
        partyId: party.id,
        cargo: clone(delivered),
        worldHour: Number(Number(state.worldHour || 0).toFixed(2))
      };
      site.marketSupplyBoostUntil = Math.max(Number(site.marketSupplyBoostUntil || 0), Number(state.worldHour || 0) + 24);
      site.supplyDisruptedUntil = 0;
      site.prosperity = clamp(Number(site.prosperity || 0) + 2, 0, 100);
      addEvent('caravan_arrived', `${party.name} доставил груз в ${site.name}: ${stockpileSummary(delivered)}.`, {
        partyId: party.id,
        siteId: site.id,
        cargo: clone(delivered)
      });
      const isTradeOutbound = party.interFactionTrade && site.id !== party.homeSiteId;
      if (isTradeOutbound && party.homeSiteId && state.sites[party.homeSiteId]) {
        const returnCaps = Math.max(20, Math.floor(stockpileTotal(delivered) * 1.35));
        party.cargo = { silver: returnCaps };
        party.destinationSiteId = party.homeSiteId;
        party.route = [party.homeSiteId];
        party.routeIndex = 0;
        party.returningFromTrade = true;
        state.worldTasks
          .filter(task => task && task.status === 'active' && task.type === 'escort_caravan' && task.partyId === party.id)
          .forEach(task => {
            const taskMembers = Array.isArray(party.playerMembers)
              ? party.playerMembers.filter(member => member?.taskId === task.id).slice(0, worldPartyPlayerLimit(party, task))
              : [];
            task.details = {
              ...(task.details || {}),
              finishReason: 'caravan_returning',
              stage: 'returning',
              joinOpen: false,
              joinClosed: true,
              returning: true,
              returnStartedHour: Number(state.worldHour || 0),
              returnSiteId: party.homeSiteId,
              destinationSiteId: party.homeSiteId,
              tradeDestinationSiteId: site.id,
              returnCargo: clone(party.cargo),
              cargo: clone(delivered),
              playerLimit: worldPartyPlayerLimit(party, task),
              playerCount: taskMembers.length,
              joinedPlayers: taskMembers.map(row => row.id).filter(Boolean)
            };
            task.text = `${party.name} завершил обмен и возвращается домой. Награда будет доступна после возвращения каравана.`;
            task.targetSiteId = party.homeSiteId;
            task.targetSiteName = state.sites[party.homeSiteId]?.name || party.homeSiteId;
          });
        addEvent('caravan_returning', `${party.name} завершил обмен и возвращается в ${state.sites[party.homeSiteId].name || party.homeSiteId}.`, {
            partyId: party.id,
          fromSiteId: site.id,
          toSiteId: party.homeSiteId,
          returnCargo: clone(party.cargo)
        });
        dirty = true;
        return;
      }
      const escortTasks = state.worldTasks
        .filter(task => task && task.status === 'active' && task.type === 'escort_caravan' && task.partyId === party.id);
      escortTasks.forEach(task => {
        const escortReward = partyRewardPlayerDetails(party, task.id);
        const hasPlayerEscorts = Number(escortReward.rewardPlayerCount || 0) > 0;
        if (hasPlayerEscorts) fundWorldTaskCapsRewardFromSite(task, site, escortReward.rewardPlayerCount);
        finishWorldTask(task, hasPlayerEscorts ? 'completed' : 'resolved', 'caravan_arrived', {
          partyId: party.id,
          siteId: site.id,
          arrivalSiteId: site.id,
          arrivalLocationId: site.locationId || '',
          cargo: clone(delivered),
          ...escortReward
        });
      });
      finishActiveWorldTasks(
        task => task.type === 'deliver_supplies' && task.siteId === site.id,
        'resolved',
        'caravan_delivery',
        { partyId: party.id, cargo: clone(delivered) }
      );
      if (party.resourceExport) {
        addEvent('resource_export_delivered', `${party.name} разгрузился в ${site.name || site.id}.`, {
          partyId: party.id,
          siteId: site.id,
          cargo: clone(delivered)
        });
        delete state.parties[party.id];
        dirty = true;
        return true;
      }
      if (party.productionExport) {
        addEvent('production_export_delivered', `${party.name} разгрузился в ${site.name || site.id}.`, {
          partyId: party.id,
          siteId: site.id,
          cargo: clone(delivered)
        });
        delete state.parties[party.id];
        dirty = true;
        return true;
      }
      if (party.interFactionTrade && party.returningFromTrade && site.id === party.homeSiteId) {
        delete state.parties[party.id];
        dirty = true;
        return true;
      }
    }
    return false;
  }

  function collectResources(party, site) {
    if (!party || !site || !isHarvestSite(site)) return;
    if (site.owner && site.owner !== 'neutral' && hostile(party.faction, site.owner)) {
      addEvent('resource_blocked', `${party.name} не смог загрузиться в ${site.name}: точку удерживают ${factionLabel(site.owner)}.`, {
        partyId: party.id,
        siteId: site.id,
        owner: site.owner
      });
      return;
    }
    const produced = site.output && typeof site.output === 'object' ? site.output : {};
    addStockpile(site.stockpile, produced, 0.35);
    const activityMul = clamp(Number(site.resourceActivity || resourceActivityPercent(site, state.worldHour)) / 100, 0.15, 1.4);
    const capacity = Math.max(0, Math.floor(Number(party.cargoCapacity || 0)));
    const capacityLeft = capacity > 0 ? Math.max(0, capacity - Math.floor(stockpileTotal(party.cargo || {}))) : 999;
    if (capacityLeft <= 0) return;
    const preferred = Array.isArray(party.preferredResources) && party.preferredResources.length
      ? new Set(party.preferredResources.map(x => safeId(x)))
      : null;
    const wanted = {};
    let remaining = capacityLeft;
    Object.entries(produced)
      .filter(([key]) => !preferred || preferred.has(safeId(key)))
      .forEach(([key, value]) => {
        if (remaining <= 0) return;
        const want = Math.max(0, Math.floor(Number(value || 0) * Number(party.collectScale || 1) * activityMul));
        const take = Math.min(remaining, want);
        if (take > 0) {
          wanted[key] = take;
          remaining -= take;
        }
      });
    const cargo = takeStockpile(site.stockpile, wanted);
    if (Object.keys(cargo).length) {
      party.cargo = party.cargo || {};
      addStockpile(party.cargo, cargo);
      party.lastLoadedHour = state.worldHour;
      party.lastLoadedSiteId = site.id;
      site.lastHarvestHour = state.worldHour;
      site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) + stockpileTotal(cargo) * 0.08, 0, 100);
      addEvent('resource_loaded', `${party.name} загрузился в ${site.name}: ${stockpileSummary(cargo)}.`, {
        partyId: party.id,
        siteId: site.id,
        cargo
      });
    }
  }

  function siteDefaultSecurity(site = {}) {
    if (Number.isFinite(Number(site.security))) return Number(site.security);
    const danger = clamp(site.danger || 1, 0, 5);
    if (site.type === 'resource') return Math.max(18, 48 - danger * 7);
    if (site.type === 'pointOfInterest') return Math.max(12, 42 - danger * 6);
    if (site.type === 'production') return 44;
    return 35;
  }

  function completeSiteSupportArrival(party = {}, site = {}) {
    if (!party || !site || String(party.kind || '').toLowerCase() !== 'support') return false;
    if (safeId(party.supportSiteId || party.destinationSiteId || '', '') !== safeId(site.id || '', '')) return false;
    const now = Number(state.worldHour || 0);
    const workers = Array.isArray(party.supportWorkers)
      ? party.supportWorkers.map((worker, index) => normalizeSiteWorker({
          ...worker,
          real: true,
          sourcePartyId: party.id,
          sourceSiteId: party.homeSiteId || '',
          arrivedHour: now
        }, index)).filter(worker => worker && Number(worker.count || 0) > 0)
      : [];
    if (workers.length) {
      site.workers = workers;
      site.workSummary = siteWorkSummary(site);
      site.workforce = clamp(Math.max(Number(site.workforce || 0), 34 + stockpileTotal(workers.reduce((acc, worker) => {
        acc[worker.role || 'worker'] = Number(worker.count || 0);
        return acc;
      }, {})) * 4), 0, 100);
      site.security = clamp(Math.max(Number(site.security ?? siteDefaultSecurity(site)), 22 + Number(party.strength || 0) * 0.45), 0, 100);
      site.prosperity = clamp(Math.max(Number(site.prosperity || 0), 16), 0, 100);
    } else {
      site.workers = [];
      site.workSummary = '';
    }
    if (party.cargo && typeof party.cargo === 'object') {
      site.stockpile = site.stockpile || emptyStockpile();
      addStockpile(site.stockpile, party.cargo);
    }
    site.supportDispatch = {
      status: 'arrived',
      partyId: party.id,
      sourceSiteId: safeId(party.homeSiteId || '', ''),
      faction: safeId(party.faction || site.owner || '', ''),
      createdHour: Number(party.createdHour || 0),
      arrivedHour: now,
      crew: Math.max(0, Math.round(Number(party.members || 0))),
      workers,
      cargo: compactStockpile(party.cargo || {}),
      cost: compactStockpile(party.supportCost || {})
    };
    site.resourceActivity = resourceActivityPercent(site, now);
    addEvent('site_support_arrived', `${party.name || 'Support'} arrived at ${site.name || site.id}.`, {
      partyId: party.id,
      siteId: site.id,
      faction: party.faction || site.owner || '',
      crew: site.supportDispatch.crew,
      cargo: site.supportDispatch.cargo
    });
    delete state.parties[party.id];
    dirty = true;
    return true;
  }

  function partyMovementTarget(party = {}) {
    const targetParty = state.parties[party.targetPartyId || ''];
    if (partyTargetIsAvailable(targetParty)) {
      return {
        id: `moving_${targetParty.id}`,
        x: Number(targetParty.x || 0),
        y: Number(targetParty.y || 0),
        name: targetParty.name || targetParty.id,
        targetPartyId: targetParty.id,
        movingParty: true
      };
    }
    return state.sites[party.destinationSiteId || ''] || null;
  }

  function recordPartyMovementPoint(party = {}, point = {}, progress = 0) {
    const partyId = safeId(party.id || '', '');
    if (!partyId) return;
    const track = partyMovementTracks.get(partyId) || [];
    const row = {
      x: Number(point.x ?? party.x ?? 0),
      y: Number(point.y ?? party.y ?? 0),
      t: clamp(progress, 0, 1)
    };
    const previous = track[track.length - 1];
    if (previous && Math.abs(Number(previous.t || 0) - row.t) <= 0.000001) {
      track[track.length - 1] = row;
    } else {
      track.push(row);
    }
    partyMovementTracks.set(partyId, track);
  }

  function movementTrackForParty(party = {}) {
    const track = (partyMovementTracks.get(safeId(party.id || '', '')) || [])
      .filter(point => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Number.isFinite(Number(point.t)))
      .sort((left, right) => Number(left.t || 0) - Number(right.t || 0));
    if (!track.length) {
      const point = { x: Number(party.x || 0), y: Number(party.y || 0) };
      return [{ ...point, t: 0 }, { ...point, t: 1 }];
    }
    if (Number(track[0].t || 0) > 0) track.unshift({ ...track[0], t: 0 });
    if (Number(track[track.length - 1].t || 0) < 1) {
      track.push({ x: Number(party.x || 0), y: Number(party.y || 0), t: 1 });
    }
    return track;
  }

  function movementTrackPointAt(track = [], progress = 0) {
    const t = clamp(progress, 0, 1);
    if (!track.length) return { x: 0, y: 0 };
    if (t <= Number(track[0].t || 0)) return { x: Number(track[0].x || 0), y: Number(track[0].y || 0) };
    for (let index = 1; index < track.length; index += 1) {
      const left = track[index - 1];
      const right = track[index];
      if (t > Number(right.t || 0) + 0.000001) continue;
      const span = Math.max(0.000001, Number(right.t || 0) - Number(left.t || 0));
      const local = clamp((t - Number(left.t || 0)) / span, 0, 1);
      return {
        x: Number(left.x || 0) + (Number(right.x || 0) - Number(left.x || 0)) * local,
        y: Number(left.y || 0) + (Number(right.y || 0) - Number(left.y || 0)) * local
      };
    }
    const last = track[track.length - 1];
    return { x: Number(last.x || 0), y: Number(last.y || 0) };
  }

  function partyTrackCircleContact(party = {}, center = {}, radiusKm = 0) {
    const track = movementTrackForParty(party);
    const radiusPoints = Math.max(0, Number(radiusKm || 0)) / mapPointKm(getGlobalMap());
    for (let index = 1; index < track.length; index += 1) {
      const from = track[index - 1];
      const to = track[index];
      const local = segmentCircleFirstHitProgress(from, to, center, radiusPoints);
      if (local === null) continue;
      const t = Number(from.t || 0) + (Number(to.t || 0) - Number(from.t || 0)) * local;
      return {
        t,
        point: {
          x: Number(from.x || 0) + (Number(to.x || 0) - Number(from.x || 0)) * local,
          y: Number(from.y || 0) + (Number(to.y || 0) - Number(from.y || 0)) * local
        }
      };
    }
    return null;
  }

  function sweptPartyContact(left = {}, right = {}, radiusKm = 0) {
    const leftTrack = movementTrackForParty(left);
    const rightTrack = movementTrackForParty(right);
    const radiusPoints = Math.max(0, Number(radiusKm || 0)) / mapPointKm(getGlobalMap());
    const breakpoints = [...new Set([
      0,
      1,
      ...leftTrack.map(point => Number(point.t || 0)),
      ...rightTrack.map(point => Number(point.t || 0))
    ].map(value => Number(clamp(value, 0, 1).toFixed(8))))].sort((a, b) => a - b);
    for (let index = 1; index < breakpoints.length; index += 1) {
      const t0 = breakpoints[index - 1];
      const t1 = breakpoints[index];
      if (t1 < t0) continue;
      const left0 = movementTrackPointAt(leftTrack, t0);
      const left1 = movementTrackPointAt(leftTrack, t1);
      const right0 = movementTrackPointAt(rightTrack, t0);
      const right1 = movementTrackPointAt(rightTrack, t1);
      const rx = left0.x - right0.x;
      const ry = left0.y - right0.y;
      const vx = (left1.x - left0.x) - (right1.x - right0.x);
      const vy = (left1.y - left0.y) - (right1.y - right0.y);
      const c = rx * rx + ry * ry - radiusPoints * radiusPoints;
      let local = null;
      if (c <= 0) {
        local = 0;
      } else {
        const a = vx * vx + vy * vy;
        const b = 2 * (rx * vx + ry * vy);
        const discriminant = b * b - 4 * a * c;
        if (a > 0.00000001 && discriminant >= 0) {
          const root = Math.sqrt(discriminant);
          const first = (-b - root) / (2 * a);
          const second = (-b + root) / (2 * a);
          if (first >= 0 && first <= 1) local = first;
          else if (second >= 0 && second <= 1) local = second;
        }
      }
      if (local === null) continue;
      const t = t0 + (t1 - t0) * local;
      return {
        t,
        leftPoint: movementTrackPointAt(leftTrack, t),
        rightPoint: movementTrackPointAt(rightTrack, t)
      };
    }
    return null;
  }

  function partyAvoidanceZones(party = {}, destination = null) {
    const globalMap = getGlobalMap();
    const pointKm = mapPointKm(globalMap);
    const targetPartyId = safeId(destination?.targetPartyId || party.targetPartyId || '', '');
    const rows = [];
    const kind = String(party.kind || '').toLowerCase();
    const ratioThreshold = kind === 'caravan' || kind === 'support' ? 0.78 : kind === 'patrol' ? 1.35 : 1.18;
    for (const other of Object.values(state.parties || {})) {
      if (!partyTargetIsAvailable(other) || other.id === party.id || other.id === targetPartyId) continue;
      if (!hostile(party.faction, other.faction)) continue;
      const distanceKm = pointDistanceKm(party, other, globalMap);
      if (distanceKm > 42) continue;
      const ratio = partyPower(other) / Math.max(1, partyPower(party));
      if (ratio < ratioThreshold) continue;
      const radiusKm = clamp(7 + ratio * 4, 8, 18);
      rows.push({
        id: `party_${other.id}`,
        x: Number(other.x || 0),
        y: Number(other.y || 0),
        radius: radiusKm / pointKm,
        weight: clamp(ratio, 0.8, 3.5)
      });
    }
    for (const zone of Array.isArray(state.worldZones) ? state.worldZones : []) {
      if (!zone || zone.status !== 'active') continue;
      if (!['battle', 'raid', 'ambush'].includes(String(zone.kind || '').toLowerCase())) continue;
      if (worldZoneReferencesParty(zone, party.id)) continue;
      if (destination && zone.siteId && String(zone.siteId) === String(destination.id || '')) continue;
      const radiusKm = Math.max(5, Number(zone.radius || 0) * pointKm + 5);
      rows.push({
        id: `zone_${safeId(zone.id || '', 'hazard')}`,
        x: Number(zone.x || 0),
        y: Number(zone.y || 0),
        radius: radiusKm / pointKm,
        weight: 1.7
      });
    }
    for (const site of Object.values(state.sites || {})) {
      if (!site?.locationId || partyCanEnterSiteInstance(party, site)) continue;
      if (destination && String(destination.id || '') === String(site.id || '')) continue;
      const radiusKm = partySiteTouchRadiusKm(party, site, globalMap) + 1.5;
      rows.push({
        id: `blocked_site_${safeId(site.id || '', 'site')}`,
        x: Number(site.x || 0),
        y: Number(site.y || 0),
        radius: radiusKm / pointKm,
        weight: 2.4
      });
    }
    return rows.slice(0, 24);
  }

  function partyAvoidanceSignature(zones = []) {
    return zones.map(zone => `${zone.id}:${Math.round(Number(zone.x || 0) / 6)}:${Math.round(Number(zone.y || 0) / 6)}:${Math.round(Number(zone.radius || 0))}`).join('|').slice(0, 480);
  }

  function partyRouteCrossesAvoidance(route = [], zones = []) {
    if (!zones.length) return false;
    for (let index = 1; index < route.length; index += 1) {
      for (const zone of zones) {
        if (pointToSegmentDistance(zone, route[index - 1], route[index]) < Number(zone.radius || 0)) return true;
      }
    }
    return false;
  }

  function partyTerrainStepCost(globalMap = {}, from = {}, to = {}, roads = [], zones = []) {
    const distance = Math.hypot(Number(to.x || 0) - Number(from.x || 0), Number(to.y || 0) - Number(from.y || 0));
    const size = districtInterestMapSize(globalMap);
    const cx = clamp(Math.floor(Number(to.x || 0) / size.cellPoints), 0, size.cols - 1);
    const cy = clamp(Math.floor(Number(to.y || 0) / size.cellPoints), 0, size.rows - 1);
    const texture = String(globalMap.cells?.[`${cx}:${cy}`]?.texture || '').toLowerCase();
    const terrainFactor = texture === 'rocky_hills' ? 1.24 : texture === 'dry_lake' ? 1.1 : texture === 'scrap_field' ? 1.08 : 1;
    const nearestRoad = globalMapRoadClearance(globalMap, to, roads, 0);
    const roadFactor = nearestRoad && nearestRoad.distance <= nearestRoad.width * 0.5 + 4 ? 0.68 : 1;
    let hazardPenalty = 0;
    for (const zone of zones) {
      const radius = Math.max(1, Number(zone.radius || 1));
      const edgeDistance = pointToSegmentDistance(zone, from, to);
      if (edgeDistance < radius) {
        hazardPenalty += 650 * Number(zone.weight || 1) * (1.15 - edgeDistance / radius);
      } else if (edgeDistance < radius * 1.65) {
        hazardPenalty += 55 * Number(zone.weight || 1) * (1 - (edgeDistance - radius) / (radius * 0.65));
      }
    }
    return distance * terrainFactor * roadFactor + hazardPenalty;
  }

  function simplifyPartyTerrainRoute(points = []) {
    const compact = [];
    for (const point of points) {
      const previous = compact[compact.length - 1];
      if (!previous || Math.hypot(Number(point.x || 0) - Number(previous.x || 0), Number(point.y || 0) - Number(previous.y || 0)) > 0.05) {
        compact.push({ x: Number(point.x || 0), y: Number(point.y || 0) });
      }
    }
    if (compact.length <= 2) return compact;
    const result = [compact[0]];
    for (let index = 1; index < compact.length - 1; index += 1) {
      const a = result[result.length - 1];
      const b = compact[index];
      const c = compact[index + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      const cross = Math.abs(abx * bcy - aby * bcx);
      const scale = Math.max(1, Math.hypot(abx, aby) * Math.hypot(bcx, bcy));
      if (cross / scale > 0.0025) result.push(b);
    }
    result.push(compact[compact.length - 1]);
    return result;
  }

  function planPartyTerrainRoute(party = {}, destination = {}, zones = []) {
    const globalMap = getGlobalMap();
    const size = districtInterestMapSize(globalMap);
    const roads = globalMapRoadRows(globalMap);
    const cellFor = point => ({
      cx: clamp(Math.floor(Number(point.x || 0) / size.cellPoints), 0, size.cols - 1),
      cy: clamp(Math.floor(Number(point.y || 0) / size.cellPoints), 0, size.rows - 1)
    });
    const startCell = cellFor(party);
    const finishCell = cellFor(destination);
    const keyFor = (cx, cy) => `${cx}:${cy}`;
    const startKey = keyFor(startCell.cx, startCell.cy);
    const finishKey = keyFor(finishCell.cx, finishCell.cy);
    const open = new Set([startKey]);
    const cameFrom = new Map();
    const score = new Map([[startKey, 0]]);
    const estimate = new Map([[startKey, Math.hypot(finishCell.cx - startCell.cx, finishCell.cy - startCell.cy) * size.cellPoints]]);
    const pointByKey = new Map([[startKey, { x: Number(party.x || 0), y: Number(party.y || 0), ...startCell }]]);
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let guard = 0;
    while (open.size && guard < size.cols * size.rows * 4) {
      guard += 1;
      let currentKey = '';
      let currentEstimate = Infinity;
      for (const key of open) {
        const value = Number(estimate.get(key) ?? Infinity);
        if (value < currentEstimate) {
          currentEstimate = value;
          currentKey = key;
        }
      }
      if (!currentKey) break;
      if (currentKey === finishKey) {
        const keys = [currentKey];
        while (cameFrom.has(keys[keys.length - 1])) keys.push(cameFrom.get(keys[keys.length - 1]));
        keys.reverse();
        const route = [{ x: Number(party.x || 0), y: Number(party.y || 0) }];
        keys.slice(1).forEach(key => {
          const point = pointByKey.get(key);
          if (point) route.push({ x: point.x, y: point.y });
        });
        route.push({ x: Number(destination.x || 0), y: Number(destination.y || 0) });
        return simplifyPartyTerrainRoute(route).slice(0, 160);
      }
      open.delete(currentKey);
      const current = pointByKey.get(currentKey);
      if (!current) continue;
      for (const [dx, dy] of directions) {
        const cx = current.cx + dx;
        const cy = current.cy + dy;
        if (cx < 0 || cy < 0 || cx >= size.cols || cy >= size.rows) continue;
        const key = keyFor(cx, cy);
        const isFinish = key === finishKey;
        const next = isFinish
          ? { x: Number(destination.x || 0), y: Number(destination.y || 0), cx, cy }
          : districtInterestCellCenter(globalMap, cx, cy);
        next.cx = cx;
        next.cy = cy;
        if (!isFinish && districtInterestPointIsWater(globalMap, next.x, next.y, 0)) continue;
        if (!infrastructureSegmentIsLand(globalMap, current, next)) continue;
        const tentative = Number(score.get(currentKey) || 0) + partyTerrainStepCost(globalMap, current, next, roads, zones);
        if (tentative + 0.001 >= Number(score.get(key) ?? Infinity)) continue;
        cameFrom.set(key, currentKey);
        score.set(key, tentative);
        estimate.set(key, tentative + Math.hypot(finishCell.cx - cx, finishCell.cy - cy) * size.cellPoints);
        pointByKey.set(key, next);
        open.add(key);
      }
    }
    return [];
  }

  function segmentCircleFirstHitProgress(from = {}, to = {}, center = {}, radius = 0) {
    const dx = Number(to.x || 0) - Number(from.x || 0);
    const dy = Number(to.y || 0) - Number(from.y || 0);
    const fx = Number(from.x || 0) - Number(center.x || 0);
    const fy = Number(from.y || 0) - Number(center.y || 0);
    const radiusSquared = Math.max(0, Number(radius || 0)) ** 2;
    if (fx * fx + fy * fy <= radiusSquared) return 0;
    const a = dx * dx + dy * dy;
    if (a <= 0.000001) return null;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radiusSquared;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const first = (-b - root) / (2 * a);
    const second = (-b + root) / (2 * a);
    if (first >= 0 && first <= 1) return first;
    if (second >= 0 && second <= 1) return second;
    return null;
  }

  function partySiteContactAlongSegment(party = {}, from = {}, to = {}) {
    const globalMap = getGlobalMap();
    const pointKm = mapPointKm(globalMap);
    let best = null;
    for (const site of Object.values(state.sites || {})) {
      if (!site?.locationId || !partyCanEnterSiteInstance(party, site)) continue;
      const radiusPoints = partySiteTouchRadiusKm(party, site, globalMap) / pointKm;
      const startDistance = Math.hypot(Number(from.x || 0) - Number(site.x || 0), Number(from.y || 0) - Number(site.y || 0));
      const ignored = String(party.siteExitIgnoreId || '') === String(site.id || '')
        && (Number(state.worldHour || 0) < Number(party.siteExitIgnoreUntilHour || 0) || startDistance <= radiusPoints + 1.5);
      if (ignored) continue;
      const progress = segmentCircleFirstHitProgress(from, to, site, radiusPoints);
      if (progress === null) continue;
      if (!best || progress < best.progress) best = { site, progress, radiusPoints };
    }
    return best;
  }

  function placePartyOutsideSiteCircle(party = {}, site = {}) {
    if (!party || !site) return false;
    const globalMap = getGlobalMap();
    const size = districtInterestMapSize(globalMap);
    const destination = partyMovementTarget(party);
    let dx = Number(destination?.x ?? site.x) - Number(site.x || 0);
    let dy = Number(destination?.y ?? site.y) - Number(site.y || 0);
    if (Math.hypot(dx, dy) <= 0.001) {
      const rng = seededRandom(`party-site-exit:${party.id || 'party'}:${site.id || 'site'}:${Math.floor(Number(state.worldHour || 0))}`);
      const angle = rng() * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    }
    const length = Math.hypot(dx, dy) || 1;
    const baseAngle = Math.atan2(dy / length, dx / length);
    const radiusPoints = partySiteTouchRadiusKm(party, site, globalMap) / mapPointKm(globalMap) + 2;
    const offsets = [0, -0.35, 0.35, -0.8, 0.8, Math.PI];
    for (const offset of offsets) {
      const angle = baseAngle + offset;
      const candidate = {
        x: clamp(Number(site.x || 0) + Math.cos(angle) * radiusPoints, 0, size.width - 0.001),
        y: clamp(Number(site.y || 0) + Math.sin(angle) * radiusPoints, 0, size.height - 0.001)
      };
      if (districtInterestPointIsWater(globalMap, candidate.x, candidate.y, 0)) continue;
      if (!infrastructureSegmentIsLand(globalMap, site, candidate)) continue;
      party.x = candidate.x;
      party.y = candidate.y;
      party.siteExitIgnoreId = site.id;
      party.siteExitIgnoreUntilHour = Number(state.worldHour || 0) + PARTY_SITE_EXIT_GRACE_HOURS;
      clearPartyInfrastructureRoute(party);
      dirty = true;
      return true;
    }
    party.siteExitIgnoreId = site.id;
    party.siteExitIgnoreUntilHour = Number(state.worldHour || 0) + PARTY_SITE_EXIT_GRACE_HOURS;
    return false;
  }

  function clearPartyInfrastructureRoute(party = {}) {
    party.infrastructureRoutePoints = [];
    party.infrastructureRouteIndex = 1;
    party.infrastructureDestinationSiteId = '';
    party.infrastructureAvoidanceSignature = '';
    party.infrastructureLayoutVersion = WORLD_INFRASTRUCTURE_LAYOUT_VERSION;
  }

  function partyInfrastructureRoute(party = {}, destination = {}, globalMap = {}) {
    if (Math.max(0, Math.floor(Number(party.infrastructureLayoutVersion || 0))) < WORLD_INFRASTRUCTURE_LAYOUT_VERSION) {
      clearPartyInfrastructureRoute(party);
    }
    const destinationId = safeId(destination?.id || '', '');
    const avoidanceZones = partyAvoidanceZones(party, destination);
    const avoidanceSignature = partyAvoidanceSignature(avoidanceZones);
    const cached = Array.isArray(party.infrastructureRoutePoints) ? party.infrastructureRoutePoints : [];
    const cachedIndex = Math.max(1, Math.floor(Number(party.infrastructureRouteIndex || 1)));
    const cachedTarget = cached[cached.length - 1];
    const targetMovedThreshold = destination.movingParty ? 5 : 0.5;
    const targetMoved = !cachedTarget || Math.hypot(Number(cachedTarget.x || 0) - Number(destination.x || 0), Number(cachedTarget.y || 0) - Number(destination.y || 0)) > targetMovedThreshold;
    if (party.infrastructureDestinationSiteId === destinationId
      && party.infrastructureAvoidanceSignature === avoidanceSignature
      && cached.length >= 2 && cachedIndex < cached.length && !targetMoved) {
      return cached;
    }
    const kind = String(party.kind || '').toLowerCase();
    const infrastructureBias = kind === 'monster' ? 1.28 : (kind === 'raider' ? 1.08 : 1);
    const baseRoute = planInfrastructureRoute(globalMap, party, destination, { infrastructureBias });
    const terrainRoute = (baseRoute.length < 2 || partyRouteCrossesAvoidance(baseRoute, avoidanceZones))
      ? planPartyTerrainRoute(party, destination, avoidanceZones)
      : [];
    const route = terrainRoute.length >= 2 ? terrainRoute : baseRoute;
    party.infrastructureRoutePoints = route;
    party.infrastructureRouteIndex = 1;
    party.infrastructureDestinationSiteId = destinationId;
    party.infrastructureAvoidanceSignature = avoidanceSignature;
    party.infrastructureLayoutVersion = WORLD_INFRASTRUCTURE_LAYOUT_VERSION;
    dirty = true;
    return route;
  }

  function onPartyArrived(party, site) {
    if (!party || !site) return;
    const arrivalFrom = { x: Number(party.x || site.x || 0), y: Number(party.y || site.y || 0) };
    clearPartyInfrastructureRoute(party);
    party.x = site.x;
    party.y = site.y;
    party.lastSiteId = site.id;
    party.siteVisitHours = { ...(party.siteVisitHours || {}), [site.id]: Number(state.worldHour || 0) };
    if (completeSiteSupportArrival(party, site)) return;
    let onsiteReason = '';
    if (party.kind === 'caravan') {
      const cargoBefore = stockpileTotal(party.cargo || {});
      if (isHarvestSite(site)) collectResources(party, site);
      const cargoAfter = stockpileTotal(party.cargo || {});
      if (isHarvestSite(site) && cargoAfter > cargoBefore && beginCaravanStagingOnsite(party, site, { arrivalFrom })) {
        return;
      }
      if (isHarvestSite(site) && cargoAfter > cargoBefore) onsiteReason = 'harvest';
      if (isSettlementServiceSite(site)) {
        if (caravanCanDeliverToSite(party, site)) {
          const beforeDelivery = stockpileTotal(party.cargo || {});
          const partyRemoved = deliverCargo(party, site);
          if (partyRemoved || !state.parties[party.id]) return;
          if (beforeDelivery > 0) onsiteReason = 'unload';
        }
        else {
          const fallback = rerouteCaravanIfDestinationInvalid(party, site, 'arrival_owner_changed');
          if (fallback && fallback.id !== site.id) return;
        }
      }
    }
    if (beginPartyOnsiteVisit(party, site, { reason: onsiteReason || 'arrival', arrivalFrom })) return;
    chooseNextDestination(party);
  }

  function moveParty(party, hours) {
    if (!party || party.destroyed || party.state === 'destroyed') return;
    if (party.state === 'engaged' && activeBattleZoneForParty(party.id)) return;
    if (party.state === 'engaged') releaseEngagedParty(party, party.engagedZoneId || '');
    if (String(party.state || '').toLowerCase() === 'onsite' && updateOnsiteParty(party, hours)) return;
    if (String(party.state || '').toLowerCase() === 'staging' && updateCaravanStaging(party, hours)) return;
    if (String(party.state || '').toLowerCase() === 'recovering') {
      if (Number(state.worldHour || 0) < Number(party.recoverUntilHour || 0)) return;
      party.state = 'moving';
      party.recoverUntilHour = 0;
      addEvent('caravan_recovered', `${party.name} перегруппировался и продолжает маршрут.`, {
        partyId: party.id,
        destinationSiteId: party.destinationSiteId || ''
      });
    }
    refreshPartyDecision(party, false);
    const speedKmh = effectiveWorldPartySpeedKmh(party);
    if (Number(party.speedKmh) !== speedKmh) {
      party.speedKmh = speedKmh;
      dirty = true;
    }
    let remainingKm = Math.max(0, speedKmh * Math.max(0, hours));
    if (remainingKm <= 0.001) return;
    const movementBudgetKm = remainingKm;
    let consumedKm = 0;
    const globalMap = getGlobalMap();
    for (let guard = 0; guard < 64 && remainingKm > 0.001; guard++) {
      if (!state.parties[party.id] || party.destroyed || party.state === 'destroyed') return;
      const stateKey = String(party.state || '').toLowerCase();
      if (stateKey === 'engaged' || stateKey === 'onsite' || stateKey === 'staging' || stateKey === 'recovering') return;
      let dest = partyMovementTarget(party);
      if (!dest) {
        refreshPartyDecision(party, true);
        dest = partyMovementTarget(party);
      }
      if (!dest) return;
      if (!dest.movingParty) dest = rerouteCaravanIfDestinationInvalid(party, dest, 'owner_changed_on_route') || dest;
      const route = partyInfrastructureRoute(party, dest, globalMap);
      if (route.length < 2) return;
      let routeIndex = Math.max(1, Math.floor(Number(party.infrastructureRouteIndex || 1)));
      if (routeIndex >= route.length) routeIndex = route.length - 1;
      const waypoint = route[routeIndex] || dest;
      const finalWaypoint = routeIndex >= route.length - 1;
      const distKm = pointDistanceKm(party, waypoint, globalMap);
      const targetParty = dest.movingParty ? state.parties[dest.targetPartyId || ''] : null;
      const entryRadiusKm = dest.movingParty
        ? partyContactDistanceKm(party, targetParty || {}, globalMap)
        : partySiteTouchRadiusKm(party, dest, globalMap);
      if (finalWaypoint && distKm <= entryRadiusKm + 0.001) {
        if (!dest.movingParty && partyCanEnterSiteInstance(party, dest)) onPartyArrived(party, dest);
        dirty = true;
        return;
      }
      if (!finalWaypoint && distKm <= 0.001) {
        party.infrastructureRouteIndex = routeIndex + 1;
        dirty = true;
        continue;
      }
      const requiredKm = finalWaypoint ? Math.max(0, distKm - entryRadiusKm) : distKm;
      const stepKm = Math.min(remainingKm, requiredKm);
      const reachesWaypoint = stepKm + 0.001 >= requiredKm;
      const progress = distKm > 0 ? Math.max(0, Math.min(1, stepKm / distKm)) : 1;
      const from = { x: Number(party.x || 0), y: Number(party.y || 0) };
      const nextPoint = {
        x: from.x + (Number(waypoint.x || from.x) - from.x) * progress,
        y: from.y + (Number(waypoint.y || from.y) - from.y) * progress
      };
      const siteContact = partySiteContactAlongSegment(party, from, nextPoint);
      if (siteContact) {
        party.x = from.x + (nextPoint.x - from.x) * siteContact.progress;
        party.y = from.y + (nextPoint.y - from.y) * siteContact.progress;
        consumedKm += stepKm * siteContact.progress;
        recordPartyMovementPoint(party, party, consumedKm / movementBudgetKm);
        onPartyArrived(party, siteContact.site);
        dirty = true;
        return;
      }
      party.x = nextPoint.x;
      party.y = nextPoint.y;
      consumedKm += stepKm;
      recordPartyMovementPoint(party, party, consumedKm / movementBudgetKm);
      remainingKm = Math.max(0, remainingKm - stepKm);
      if (reachesWaypoint && !finalWaypoint) {
        party.infrastructureRouteIndex = routeIndex + 1;
        dirty = true;
        continue;
      }
      if (reachesWaypoint && finalWaypoint) {
        if (!dest.movingParty && partyCanEnterSiteInstance(party, dest)) onPartyArrived(party, dest);
        dirty = true;
        return;
      }
      dirty = true;
      break;
    }
  }

  function updateCaravanThreats(hours) {
    for (const party of Object.values(state.parties)) {
      if (!party || party.destroyed || party.state === 'destroyed' || String(party.kind || '') !== 'caravan') continue;
      if (['onsite', 'recovering'].includes(String(party.state || '').toLowerCase())) continue;
      if (party.state === 'engaged' && activeBattleZoneForParty(party.id)) continue;
      const threat = partyThreatInfo(party);
      const now = Number(state.worldHour || 0);
      const destination = state.sites[party.destinationSiteId];
      const home = state.sites[party.homeSiteId || 'settlement'];
      if (threat.riskLevel < 42 || Number(threat.threatDistanceKm || 0) > 32) {
        party.threatWatchProgress = Math.max(0, Number(party.threatWatchProgress || 0) - hours * 0.5);
        if (String(party.state || '').toLowerCase() === 'staging' && now - Number(party.lastEscortListingHour || -999) >= 18 && (destination || stockpileTotal(party.cargo || {}) > 0)) {
          party.lastEscortListingHour = now;
          createWorldTask('escort_caravan', {
            key: `escort_caravan:${party.id}`,
            title: `Сопроводить караван: ${party.name}`,
            text: `${party.name} готовит переход ${destination ? `к ${destination.name}` : 'по маршруту'} с грузом ${stockpileSummary(party.cargo || {}) || 'припасов'}. Присоединитесь к каравану и идите вместе с группой, пока она не доберется до безопасной точки.`,
            siteId: home?.id || party.homeSiteId || 'settlement',
            partyId: party.id,
            targetFaction: threat.threatFaction || '',
            objective: 'escort_regular_caravan',
            durationHours: 36,
            priority: 2,
            details: {
              x: Number(Number(party.x || 0).toFixed(1)),
              y: Number(Number(party.y || 0).toFixed(1)),
              destinationSiteId: party.destinationSiteId || '',
              riskLevel: threat.riskLevel,
              cargo: compactStockpile(party.cargo || {})
            }
          });
        }
        continue;
      }
      party.threatWatchProgress = Number(party.threatWatchProgress || 0) + Math.max(0, Number(hours || 0));
      if (party.threatWatchProgress < 1.5) continue;
      party.threatWatchProgress = 0;
      const lastEventHour = Number(party.lastThreatEventHour || -999);
      if (Number(state.worldHour || 0) - lastEventHour < 7 && threat.riskLevel < 72) continue;
      party.lastThreatEventHour = Number(state.worldHour || 0);
      party.lastEscortListingHour = Number(state.worldHour || 0);
      const priority = threat.riskLevel >= 75 ? 5 : threat.riskLevel >= 58 ? 4 : 3;
      party.nextDecisionHour = 0;
      refreshPartyDecision(party, true);
      addEvent('caravan_threat', `${party.name}: замечена угроза на маршруте (${threat.threatName}, ${threat.threatDistanceKm} км).`, {
        partyId: party.id,
        threatPartyId: threat.threatPartyId,
        riskLevel: threat.riskLevel,
        response: party.decisionKind || 'reroute',
        x: Number(Number(party.x || 0).toFixed(1)),
        y: Number(Number(party.y || 0).toFixed(1))
      });
      createWorldTask('escort_caravan', {
        key: `escort_caravan:${party.id}`,
        title: `Прикрыть караван: ${party.name}`,
        text: `${party.name} обнаружил рядом ${threat.threatName || 'опасный отряд'} и меняет маршрут; риск ${threat.riskLevel}%. Бой начнется только при физическом столкновении групп.`,
        siteId: home?.id || party.homeSiteId || 'settlement',
        partyId: party.id,
        targetFaction: threat.threatFaction || '',
        objective: 'escort_threatened_caravan',
        durationHours: 28,
        priority,
        details: {
          x: Number(Number(party.x || 0).toFixed(1)),
          y: Number(Number(party.y || 0).toFixed(1)),
          destinationSiteId: party.destinationSiteId || '',
          threatPartyId: threat.threatPartyId || '',
          riskLevel: threat.riskLevel,
          cargo: compactStockpile(party.cargo || {})
        }
      });
    }
  }

  function updatePatrolThreats(hours) {
    for (const party of Object.values(state.parties)) {
      if (!party || party.destroyed || party.state === 'destroyed' || String(party.kind || '') !== 'patrol') continue;
      const threat = partyThreatInfo(party);
      const now = Number(state.worldHour || 0);
      const home = state.sites[party.homeSiteId || 'settlement'];
      if (threat.riskLevel < 36 || Number(threat.threatDistanceKm || 0) > 28) {
        party.patrolWatchProgress = Math.max(0, Number(party.patrolWatchProgress || 0) - hours * 0.45);
        if (now - Number(party.lastPatrolListingHour || -999) >= 16) {
          party.lastPatrolListingHour = now;
          createWorldTask('join_patrol', {
            key: `join_patrol:${party.id}`,
            title: `Выйти с патрулем: ${party.name}`,
            text: `${party.name} выходит на плановый маршрут возле ${home?.name || 'поселения'}. Присоединитесь к группе и патрулируйте дорогу вместе с отрядом.`,
            siteId: home?.id || party.homeSiteId || 'settlement',
            partyId: party.id,
            targetFaction: threat.threatFaction || '',
            objective: 'join_regular_patrol',
            durationHours: 30,
            priority: 2,
            details: {
              x: Number(Number(party.x || 0).toFixed(1)),
              y: Number(Number(party.y || 0).toFixed(1)),
              destinationSiteId: party.destinationSiteId || '',
              riskLevel: threat.riskLevel
            }
          });
        }
        continue;
      }
      party.patrolWatchProgress = Number(party.patrolWatchProgress || 0) + Math.max(0, Number(hours || 0));
      if (party.patrolWatchProgress < 1.25) continue;
      party.patrolWatchProgress = 0;
      const lastEventHour = Number(party.lastPatrolTaskHour || -999);
      if (Number(state.worldHour || 0) - lastEventHour < 8 && threat.riskLevel < 66) continue;
      party.lastPatrolTaskHour = Number(state.worldHour || 0);
      party.lastPatrolListingHour = Number(state.worldHour || 0);
      const priority = threat.riskLevel >= 70 ? 5 : threat.riskLevel >= 52 ? 4 : 3;
      addEvent('patrol_threat', `${party.name}: рядом замечена угроза (${threat.threatName}, ${threat.threatDistanceKm} км).`, {
        partyId: party.id,
        threatPartyId: threat.threatPartyId,
        riskLevel: threat.riskLevel,
        x: Number(Number(party.x || 0).toFixed(1)),
        y: Number(Number(party.y || 0).toFixed(1))
      });
      createWorldTask('join_patrol', {
        key: `join_patrol:${party.id}`,
        title: `Выйти с патрулем: ${party.name}`,
        text: `${party.name} ведёт маршрут возле ${home?.name || 'поселения'}. Рядом ${threat.threatName || 'опасный отряд'}; риск ${threat.riskLevel}%. Присоединитесь к патрулю и помогите удержать дорогу.`,
        siteId: home?.id || party.homeSiteId || 'settlement',
        partyId: party.id,
        targetFaction: threat.threatFaction || '',
        objective: 'join_active_patrol',
        durationHours: 24,
        priority,
        details: {
          x: Number(Number(party.x || 0).toFixed(1)),
          y: Number(Number(party.y || 0).toFixed(1)),
          destinationSiteId: party.destinationSiteId || '',
          threatPartyId: threat.threatPartyId || '',
          riskLevel: threat.riskLevel
        }
      });
    }
  }

  function completeJoinedPatrolTasks() {
    const now = Number(state.worldHour || 0);
    for (const task of state.worldTasks) {
      if (!task || task.status !== 'active' || String(task.type || '') !== 'join_patrol') continue;
      const dutyEndsHour = Number(task.details?.dutyEndsHour || 0);
      if (!Number.isFinite(dutyEndsHour) || dutyEndsHour <= 0 || now < dutyEndsHour) continue;
      const party = state.parties[task.partyId];
      if (!party || party.destroyed || party.state === 'destroyed') continue;
      const rewardDetails = partyRewardPlayerDetails(party, task.id);
      if (Number(rewardDetails.rewardPlayerCount || 0) <= 0) continue;
      finishWorldTask(task, 'completed', 'patrol_duty_completed', {
        partyId: party.id,
        dutyStartedHour: Number(task.details?.dutyStartedHour || task.createdHour || now),
        dutyEndsHour,
        patrolCompletedHour: now
      });
    }
  }

  function lairLocationIdForParty(party = {}) {
    const faction = factionGroup(party.faction || '');
    const id = String(party.id || '').toLowerCase();
    if (faction === 'raiders') return 'randomRuinedRoad';
    if (faction === 'mutants') return 'randomDryBasin';
    if (id.includes('ant') || id.includes('scorpion') || id.includes('gecko')) return 'randomDryBasin';
    return 'randomAshGrove';
  }

  function lairTitleForParty(party = {}) {
    const faction = factionGroup(party.faction || '');
    if (faction === 'raiders') return `Зачистить логово: ${party.name || 'рейдеры'}`;
    if (faction === 'mutants') return `Зачистить логово: ${party.name || 'мутанты'}`;
    return `Зачистить гнездо: ${party.name || 'твари пустоши'}`;
  }

  function worldGridInfo() {
    const grid = getGlobalMap().grid || {};
    const cols = Math.max(1, Math.round(Number(grid.cols || 30)));
    const rows = Math.max(1, Math.round(Number(grid.rows || 30)));
    const cellPoints = Math.max(1, Math.round(Number(grid.cellPoints || 30)));
    return { cols, rows, cellPoints };
  }

  function worldCellKey(point = {}) {
    const { cols, rows, cellPoints } = worldGridInfo();
    const px = clamp(point.x, 0, Math.max(0, cols * cellPoints - 0.001));
    const py = clamp(point.y, 0, Math.max(0, rows * cellPoints - 0.001));
    const cx = clamp(Math.floor(px / cellPoints), 0, cols - 1);
    const cy = clamp(Math.floor(py / cellPoints), 0, rows - 1);
    return `${cx}:${cy}`;
  }

  function worldCellCenterByOffset(point = {}, dx = 0, dy = 0) {
    const { cols, rows, cellPoints } = worldGridInfo();
    const px = clamp(point.x, 0, Math.max(0, cols * cellPoints - 0.001));
    const py = clamp(point.y, 0, Math.max(0, rows * cellPoints - 0.001));
    const cx = clamp(Math.floor(px / cellPoints) + Math.round(Number(dx || 0)), 0, cols - 1);
    const cy = clamp(Math.floor(py / cellPoints) + Math.round(Number(dy || 0)), 0, rows - 1);
    return {
      x: Math.round((cx + 0.5) * cellPoints),
      y: Math.round((cy + 0.5) * cellPoints)
    };
  }

  function fixedLairPointBlocked(point = {}, slotId = '') {
    const globalMap = getGlobalMap();
    const cellKey = worldCellKey(point);
    for (const site of Object.values(state.sites || {})) {
      if (!site) continue;
      if (worldCellKey(site) === cellKey) return true;
      if (pointDistanceKm(point, site, globalMap) < 7.5) return true;
    }
    const zones = Array.isArray(state.worldZones) ? state.worldZones : [];
    for (const zone of zones) {
      if (!zone || zone.id === slotId) continue;
      if (zone.status !== 'active' && zone.status !== 'looted') continue;
      if (!['lair', 'ambush'].includes(String(zone.kind || ''))) continue;
      if (worldCellKey(zone) === cellKey || pointDistanceKm(point, zone, globalMap) < 7.5) return true;
    }
    return false;
  }

  function fixedLairSafePointForParty(party = {}, explicit = null, home = null) {
    const base = {
      x: explicit?.x ?? home?.x ?? party.x ?? 0,
      y: explicit?.y ?? home?.y ?? party.y ?? 0
    };
    const slotId = `lair_${safeId(party.id || '', '')}`;
    const rings = [
      [[0, 0]],
      [[1, 0], [-1, 0], [0, 1], [0, -1]],
      [[1, 1], [-1, 1], [1, -1], [-1, -1]],
      [[2, 0], [-2, 0], [0, 2], [0, -2]],
      [[2, 1], [-2, 1], [2, -1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]],
      [[2, 2], [-2, 2], [2, -2], [-2, -2]]
    ];
    const seed = Math.abs(String(party.id || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0));
    for (const ring of rings) {
      const pivot = seed % Math.max(1, ring.length);
      const rotated = ring.slice(pivot).concat(ring.slice(0, pivot));
      for (const [dx, dy] of rotated) {
        const candidate = worldCellCenterByOffset(base, dx, dy);
        if (!fixedLairPointBlocked(candidate, slotId)) return candidate;
      }
    }
    return globalMapCellCenter(base, getGlobalMap());
  }

  function fixedLairSlotForParty(party = {}) {
    const partyId = safeId(party.id || '', '');
    if (!partyId) return null;
    const explicit = FIXED_LAIR_SLOTS[partyId] || null;
    const home = state.sites[explicit?.siteId || party.homeSiteId || ''] || state.sites[party.homeSiteId || ''] || state.sites.oldDepot || state.sites.settlement;
    const point = fixedLairSafePointForParty(party, explicit, home);
    const locationId = safeId(explicit?.locationId || lairLocationIdForParty(party), 'randomAshGrove');
    return {
      id: `lair_${partyId}`,
      partyId,
      siteId: safeId(explicit?.siteId || home?.id || party.homeSiteId || '', ''),
      x: point.x,
      y: point.y,
      locationId,
      title: explicit?.title || lairTitleForParty(party).replace(/^Зачистить\s+/i, ''),
      text: explicit?.text || `${party.name || 'Враждебная группа'} держит постоянное логово в пустоши. После зачистки точка обновляется примерно раз в игровые сутки.`,
      respawnHours: Math.max(1, Number(explicit?.respawnHours || FIXED_LAIR_RESPAWN_HOURS))
    };
  }

  function updateVisibleLairs(hours) {
    void hours;
    cleanupFixedLairWorldArtifacts();
  }

  function resolveFriendlyPartyContact(left = {}, right = {}, contact = null) {
    const now = Number(state.worldHour || 0);
    const contactKey = [left.id, right.id].sort().join(':');
    if (left.lastFriendlyContactKey === contactKey && now - Number(left.lastFriendlyContactHour || 0) < 4) return false;
    left.lastFriendlyContactKey = contactKey;
    left.lastFriendlyContactHour = now;
    right.lastFriendlyContactKey = contactKey;
    right.lastFriendlyContactHour = now;
    left.nextDecisionHour = Math.min(Number(left.nextDecisionHour || now), now + 0.2);
    right.nextDecisionHour = Math.min(Number(right.nextDecisionHour || now), now + 0.2);
    const leftPoint = contact?.leftPoint || left;
    const rightPoint = contact?.rightPoint || right;
    addEvent('party_contact', `${left.name || left.id} встретился с ${right.name || right.id}; отряды обменялись сведениями об обстановке.`, {
      partyId: left.id,
      targetPartyId: right.id,
      x: Number(((Number(leftPoint.x || 0) + Number(rightPoint.x || 0)) * 0.5).toFixed(1)),
      y: Number(((Number(leftPoint.y || 0) + Number(rightPoint.y || 0)) * 0.5).toFixed(1))
    });
    dirty = true;
    return true;
  }

  function battleSideFactions(zone = {}, side = 'defender') {
    const factions = (Array.isArray(zone.details?.actors) ? zone.details.actors : [])
      .filter(actor => actor && actor.side === side && actor.faction)
      .map(actor => factionGroup(actor.faction || ''))
      .filter(Boolean);
    const fallback = side === 'defender' ? (zone.faction || '') : (zone.targetFaction || '');
    if (fallback && !factions.length) factions.push(factionGroup(fallback));
    return [...new Set(factions)];
  }

  function battleJoinSide(zone = {}, party = {}) {
    if (!zone || !party || worldZoneReferencesParty(zone, party.id)) return '';
    const defenderFactions = battleSideFactions(zone, 'defender');
    const attackerFactions = battleSideFactions(zone, 'attacker');
    if (!defenderFactions.length || !attackerFactions.length) return '';
    const partyFaction = factionGroup(party.faction || 'neutral');
    const sideAffinity = factions => factions.reduce((best, faction) => {
      if (partyFaction === faction) return Math.max(best, 100);
      return Math.max(best, relation(partyFaction, faction), relation(faction, partyFaction));
    }, -100);
    const hostileToDefender = defenderFactions.some(faction => hostile(partyFaction, faction));
    const hostileToAttacker = attackerFactions.some(faction => hostile(partyFaction, faction));
    if (!hostileToDefender && !hostileToAttacker) return '';
    if (hostileToDefender && !hostileToAttacker) return 'attacker';
    if (hostileToAttacker && !hostileToDefender) return 'defender';
    return sideAffinity(defenderFactions) >= sideAffinity(attackerFactions) ? 'defender' : 'attacker';
  }

  function detachPartyOnsiteZoneForBattle(party = {}, battleZone = {}) {
    const onsiteZone = worldZoneById(party.onsiteZoneId || '');
    if (onsiteZone && onsiteZone.id !== battleZone.id && onsiteZone.status === 'active') {
      onsiteZone.status = 'resolved';
      onsiteZone.resolvedHour = Number(state.worldHour || 0);
      onsiteZone.expiresHour = Number(state.worldHour || 0);
      onsiteZone.details = {
        ...(onsiteZone.details || {}),
        outcome: 'joined_shared_battle',
        completedHour: Number(state.worldHour || 0)
      };
    }
    clearPartyOnsiteState(party);
  }

  function joinPartyToActiveBattle(party = {}, zone = {}) {
    if (!party || !zone || zone.status !== 'active' || !zone.details?.simBattle) return false;
    if (worldZoneReferencesParty(zone, party.id)) return false;
    const stateKey = String(party.state || '').toLowerCase();
    if (party.destroyed || stateKey === 'destroyed' || stateKey === 'engaged' || stateKey === 'recovering') return false;
    if (stateKey === 'onsite' && String(party.onsiteSiteId || '') !== String(zone.siteId || zone.details?.siteId || '')) return false;
    const side = battleJoinSide(zone, party);
    if (!side) return false;
    const contactRadiusKm = (Math.max(0, Number(zone.radius || 0)) + worldPartyVisualRadiusPoints(party)) * mapPointKm(getGlobalMap());
    const contact = partyTrackCircleContact(party, zone, contactRadiusKm);
    if (!contact) return false;
    const counters = { defender: 0, attacker: 0 };
    (Array.isArray(zone.details?.actors) ? zone.details.actors : []).forEach(actor => {
      if (actor?.side === 'defender') counters.defender += 1;
      if (actor?.side === 'attacker') counters.attacker += 1;
    });
    const actors = partyClashActorsForParty(party, side, counters)
      .map((actor, index) => normalizeBattleActor(actor, index + counters.defender + counters.attacker, state.worldHour))
      .filter(Boolean);
    if (!actors.length) return false;
    if (stateKey === 'onsite') detachPartyOnsiteZoneForBattle(party, zone);
    party.x = Number(contact.point.x || party.x || zone.x || 0);
    party.y = Number(contact.point.y || party.y || zone.y || 0);
    party.state = 'engaged';
    party.engagedZoneId = zone.id;
    party.engagedUntilHour = Math.max(Number(zone.expiresHour || 0), Number(state.worldHour || 0) + 8);
    clearPartyInfrastructureRoute(party);
    const joinedParties = Array.isArray(zone.details?.joinedParties) ? zone.details.joinedParties.filter(row => row?.partyId !== party.id) : [];
    joinedParties.push({ partyId: party.id, partyName: party.name || '', faction: party.faction || '', side, joinedHour: Number(state.worldHour || 0) });
    zone.details = {
      ...(zone.details || {}),
      realTimeBattle: true,
      simulationDisabled: true,
      joinedParties,
      joinedPartyIds: joinedParties.map(row => row.partyId),
      partySides: { ...(zone.details?.partySides || {}), [party.id]: side },
      actors: [...(Array.isArray(zone.details?.actors) ? zone.details.actors : []), ...actors]
    };
    addEvent('party_joined_battle', `${party.name || party.id} вступил в уже идущий бой.`, {
      zoneId: zone.id,
      partyId: party.id,
      side,
      x: Number(Number(contact.point.x || zone.x || 0).toFixed(1)),
      y: Number(Number(contact.point.y || zone.y || 0).toFixed(1))
    });
    dirty = true;
    return true;
  }

  function joinPartiesTouchingActiveBattles(parties = []) {
    const zones = (Array.isArray(state.worldZones) ? state.worldZones : [])
      .filter(zone => zone && zone.status === 'active' && zone.details?.simBattle);
    for (const party of parties) {
      if (!party || party.destroyed || ['destroyed', 'engaged', 'recovering'].includes(String(party.state || '').toLowerCase())) continue;
      for (const zone of zones) {
        if (joinPartyToActiveBattle(party, zone)) break;
      }
    }
  }

  function resolvePartyContacts() {
    const parties = Object.values(state.parties).filter(p => p && !p.destroyed && p.state !== 'destroyed');
    const globalMap = getGlobalMap();
    const encounterZones = (Array.isArray(state.worldZones) ? state.worldZones : [])
      .filter(zone => zone && zone.status === 'active' && zone.details?.partyEncounter && !zone.details?.simBattle);
    for (const party of parties) {
      if (!party || party.destroyed || party.state === 'destroyed' || party.state === 'engaged' || party.state === 'onsite' || party.state === 'recovering') continue;
      for (const zone of encounterZones) {
        if (!zone || zone.status !== 'active' || zone.details?.simBattle) continue;
        const baseParty = state.parties[safeId(zone.partyId || zone.details?.partyId || '', '')] || null;
        if (!baseParty || baseParty.id === party.id || baseParty.destroyed || baseParty.state === 'destroyed') continue;
        if (!hostile(party.faction, baseParty.faction)) continue;
        const zoneContact = partyTrackCircleContact(party, zone, PARTY_CLASH_ENGAGE_DISTANCE_KM);
        if (!zoneContact) continue;
        const counters = { defender: 0, attacker: 0 };
        (Array.isArray(zone.details.actors) ? zone.details.actors : []).forEach(actor => {
          if (actor?.side === 'defender') counters.defender += 1;
          if (actor?.side === 'attacker') counters.attacker += 1;
        });
        const joinActors = partyClashActorsForParty(party, 'attacker', counters)
          .map((actor, index) => normalizeBattleActor(actor, index + counters.defender + counters.attacker, state.worldHour))
          .filter(Boolean);
        if (!joinActors.length) continue;
        zone.kind = 'battle';
        zone.title = `Стычка на дороге: ${baseParty.name || baseParty.id}`;
        zone.text = `${party.name || party.id} вмешался во встречу с ${baseParty.name || baseParty.id}. Внутри идет живой бой.`;
        zone.priority = Math.max(4, Number(zone.priority || 0));
        zone.threatPartyId = party.id;
        zone.targetFaction = party.faction || '';
        zone.details = {
          ...(zone.details || {}),
          simBattle: true,
          realTimeBattle: true,
          simulationDisabled: true,
          battleState: 'active',
          joinedPartyId: party.id,
          joinedPartyName: party.name || '',
          threatPartyId: party.id,
          threatName: party.name || '',
          actors: [...(Array.isArray(zone.details.actors) ? zone.details.actors : []), ...joinActors]
        };
        party.state = 'engaged';
        party.engagedZoneId = zone.id;
        party.engagedUntilHour = Number(state.worldHour || 0) + 8;
        addEvent('party_joined_encounter', `${party.name || party.id} вмешался во встречу ${baseParty.name || baseParty.id}.`, {
          zoneId: zone.id,
          partyId: party.id,
          targetPartyId: baseParty.id
        });
        dirty = true;
        break;
      }
    }
    joinPartiesTouchingActiveBattles(parties);
    for (let i = 0; i < parties.length; i++) {
      const a = parties[i];
      if (!a || a.destroyed || a.state === 'destroyed' || a.state === 'engaged' || a.state === 'onsite' || a.state === 'recovering') continue;
      for (let j = i + 1; j < parties.length; j++) {
        const b = parties[j];
        if (!b || b.destroyed || b.state === 'destroyed' || b.state === 'engaged' || b.state === 'onsite' || b.state === 'recovering') continue;
        const contactDistanceKm = partyContactDistanceKm(a, b, globalMap);
        const contact = sweptPartyContact(a, b, contactDistanceKm);
        if (!contact) continue;
        if (!hostile(a.faction, b.faction)) {
          resolveFriendlyPartyContact(a, b, contact);
          continue;
        }
        a.x = Number(contact.leftPoint.x || a.x || 0);
        a.y = Number(contact.leftPoint.y || a.y || 0);
        b.x = Number(contact.rightPoint.x || b.x || 0);
        b.y = Number(contact.rightPoint.y || b.y || 0);
        clearPartyInfrastructureRoute(a);
        clearPartyInfrastructureRoute(b);
        const aIsCaravan = String(a.kind || '').toLowerCase() === 'caravan';
        const bIsCaravan = String(b.kind || '').toLowerCase() === 'caravan';
        if (aIsCaravan || bIsCaravan) {
          const caravan = aIsCaravan ? a : b;
          const threatParty = caravan === a ? b : a;
          createCaravanBattleZone(caravan, {
            threatPartyId: threatParty.id,
            threatName: threatParty.name || threatParty.id,
            threatFaction: threatParty.faction || '',
            threatDistanceKm: Number(contactDistanceKm.toFixed(1)),
            riskLevel: 100
          });
        } else {
          createPartyClashZone(a, b);
        }
        if (a.state === 'engaged') break;
      }
    }
    joinPartiesTouchingActiveBattles(parties);
  }

  function productionInputRecipe(itemId = '') {
    const id = safeId(itemId || '');
    return economyRecipes[id]?.inputs || null;
  }

  function siteCanCraftRecipe(site = {}, recipe = null) {
    if (!site || !recipe) return false;
    const group = factionGroup(site.owner || 'neutral');
    if (recipe.factions.length && !recipe.factions.includes(group)) return false;
    const capabilities = new Set(Array.isArray(site.productionCapabilities) ? site.productionCapabilities : []);
    return capabilities.has(recipe.station) || Number(site.production?.[recipe.id] || 0) > 0;
  }

  function factionEconomySites(faction = '') {
    const group = factionGroup(faction || 'neutral');
    return Object.values(state.sites || {}).filter(site => site
      && factionGroup(site.owner || 'neutral') === group
      && isSettlementServiceSite(site));
  }

  function addEconomyAmount(target = {}, itemId = '', qty = 0) {
    const id = safeId(itemId || '', '');
    const amount = Math.max(0, Number(qty || 0));
    if (!id || amount <= 0) return;
    target[id] = Number((Number(target[id] || 0) + amount).toFixed(3));
  }

  function factionEconomyAvailable(faction = '') {
    const available = {};
    for (const site of factionEconomySites(faction)) {
      for (const [id, qty] of Object.entries(site.stockpile || {})) addEconomyAmount(available, id, qty);
      for (const market of Object.values(site.retailMarkets || {})) {
        for (const row of normalizeMarketStockRows(market?.stock || [])) addEconomyAmount(available, row.id, row.qty);
      }
      for (const row of Array.isArray(site.productionQueue) ? site.productionQueue : []) {
        addEconomyAmount(available, row.itemId, row.outputQty);
      }
    }
    for (const party of Object.values(state.parties || {})) {
      if (!party || party.destroyed || factionGroup(party.faction || '') !== factionGroup(faction || '')) continue;
      for (const [id, qty] of Object.entries(party.cargo || {})) addEconomyAmount(available, id, qty);
    }
    return available;
  }

  function factionEconomyTargets(faction = '') {
    const targets = {};
    for (const site of factionEconomySites(faction)) {
      const includedProfiles = new Set();
      for (const profileId of Array.isArray(site.traderProfiles) ? site.traderProfiles : []) {
        const profile = traderProfiles[profileId];
        if (!profile) continue;
        includedProfiles.add(profile.id);
        for (const row of profile.stock) addEconomyAmount(targets, row.id, Math.max(row.shelfTarget, row.shelfMin) * 1.35);
      }
      for (const market of Object.values(site.retailMarkets || {})) {
        if (!market || (market.profileId && includedProfiles.has(market.profileId))) continue;
        for (const row of normalizeTraderPlanRows(market.plan || [])) {
          addEconomyAmount(targets, row.id, Math.max(row.shelfTarget, row.shelfMin) * 1.35);
        }
      }
      for (const [id, qty] of Object.entries(site.productionDemand || {})) addEconomyAmount(targets, id, qty);
      for (const [id, qty] of Object.entries(site.retailDemand || {})) addEconomyAmount(targets, id, qty);
    }
    return targets;
  }

  function productionCandidateSites(faction = '', recipe = null) {
    return factionEconomySites(faction)
      .filter(site => siteCanCraftRecipe(site, recipe))
      .sort((a, b) => {
        const queueDelta = Number(a.productionQueue?.length || 0) - Number(b.productionQueue?.length || 0);
        if (queueDelta) return queueDelta;
        return resourceActivityPercent(b, state.worldHour) - resourceActivityPercent(a, state.worldHour)
          || String(a.id || '').localeCompare(String(b.id || ''));
      });
  }

  function productionInputAvailability(site = {}, recipe = null) {
    if (!site || !recipe) return { ratio: 0, missing: {} };
    const stock = site.stockpile || {};
    const missing = {};
    let ratio = 1;
    for (const [id, need] of Object.entries(recipe.inputs || {})) {
      const required = Math.max(0, Number(need || 0));
      const have = Math.max(0, Number(stock[id] || 0));
      if (required > 0) ratio = Math.min(ratio, have / required);
      if (have + 0.0001 < required) missing[id] = Number((required - have).toFixed(3));
    }
    return { ratio: clamp(ratio, 0, 1), missing };
  }

  function enqueueFactionProduction(site = {}, recipe = null, priority = 50) {
    if (!site || !recipe || !siteCanCraftRecipe(site, recipe)) return { ok: false, missing: {} };
    site.productionQueue = Array.isArray(site.productionQueue) ? site.productionQueue : [];
    if (site.productionQueue.length >= MAX_PRODUCTION_QUEUE_ROWS) return { ok: false, missing: {}, full: true };
    if (site.productionQueue.some(row => row.itemId === recipe.id)) return { ok: false, missing: {}, queued: true };
    const inputState = productionInputAvailability(site, recipe);
    if (Object.keys(inputState.missing).length) {
      site.productionDemand = site.productionDemand || {};
      for (const [id, qty] of Object.entries(inputState.missing)) {
        site.productionDemand[id] = Math.max(Number(site.productionDemand[id] || 0), qty);
      }
      return { ok: false, missing: inputState.missing };
    }
    const stock = site.stockpile || (site.stockpile = emptyStockpile());
    const reservedInputs = {};
    for (const [id, need] of Object.entries(recipe.inputs)) {
      const qty = Math.max(0, Number(need || 0));
      stock[id] = Math.max(0, Number(stock[id] || 0) - qty);
      if (qty > 0) reservedInputs[id] = qty;
      if (site.productionDemand) site.productionDemand[id] = Math.max(0, Number(site.productionDemand[id] || 0) - qty);
    }
    const workforceMul = clamp((Number(site.workforce || 35) + Number(site.prosperity || 25)) / 100, 0.45, 1.6);
    const workHours = Math.max(0.25, Number(recipe.workHours || 1) / workforceMul);
    const row = {
      id: safeId(`production_${site.id}_${recipe.id}_${Math.floor(Number(state.worldHour || 0) * 100)}_${site.productionQueue.length}`, `production_${site.id}_${recipe.id}`),
      itemId: recipe.id,
      outputQty: recipe.outputQty,
      remainingHours: Number(workHours.toFixed(3)),
      workHours: Number(workHours.toFixed(3)),
      priority: clamp(priority, 1, 100),
      reservedInputs,
      createdHour: Number(state.worldHour || 0)
    };
    site.productionQueue.push(row);
    site.lastProductionOrder = { itemId: recipe.id, outputQty: recipe.outputQty, createdHour: row.createdHour };
    dirty = true;
    return { ok: true, row };
  }

  function planFactionProduction(hours = 0) {
    state.factionEconomyPlanProgress = Number(state.factionEconomyPlanProgress || 0) + Math.max(0, Number(hours || 0));
    if (state.factionEconomyPlanProgress < FACTION_ECONOMY_PLAN_INTERVAL_HOURS) return false;
    state.factionEconomyPlanProgress %= FACTION_ECONOMY_PLAN_INTERVAL_HOURS;
    const factions = [...new Set(Object.values(state.sites || {})
      .map(site => factionGroup(site?.owner || 'neutral'))
      .filter(isJoinableWorldFaction))];
    let planned = 0;
    for (const faction of factions) {
      const available = factionEconomyAvailable(faction);
      const targets = factionEconomyTargets(faction);
      const orders = Object.entries(targets)
        .map(([id, target]) => {
          const recipe = economyRecipes[id];
          const have = Math.max(0, Number(available[id] || 0));
          const deficit = Math.max(0, Number(target || 0) - have);
          const zeroBonus = have < 0.001 ? 140 : 0;
          const ratio = target > 0 ? deficit / target : 0;
          return { id, recipe, deficit, priority: zeroBonus + ratio * 100 + Math.min(35, deficit) };
        })
        .filter(row => row.recipe && row.deficit > 0.001)
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      for (const order of orders.slice(0, 24)) {
        const candidates = productionCandidateSites(faction, order.recipe);
        if (!candidates.length) continue;
        candidates.sort((a, b) => productionInputAvailability(b, order.recipe).ratio - productionInputAvailability(a, order.recipe).ratio);
        let result = null;
        for (const site of candidates) {
          result = enqueueFactionProduction(site, order.recipe, Math.min(100, order.priority));
          if (result.ok || result.queued) break;
          if (!result.full && Object.keys(result.missing || {}).length) break;
        }
        if (result?.ok) {
          addEconomyAmount(available, order.id, order.recipe.outputQty);
          planned++;
        }
      }
    }
    if (planned > 0) dirty = true;
    return planned > 0;
  }

  function advanceFactionProduction(hours = 0) {
    const elapsed = Math.max(0, Number(hours || 0));
    if (elapsed <= 0) return false;
    let changed = false;
    for (const site of Object.values(state.sites || {})) {
      const queue = Array.isArray(site?.productionQueue) ? site.productionQueue : [];
      if (!queue.length) continue;
      const activityMul = site.activeConflict
        ? 0.45
        : Number(site.raidUntil || 0) > Number(state.worldHour || 0)
          ? 0.35
          : Number(site.supplyDisruptedUntil || 0) > Number(state.worldHour || 0)
            ? 0.65
            : 1;
      const completed = [];
      for (const row of queue) {
        row.remainingHours = Math.max(0, Number(row.remainingHours || 0) - elapsed * activityMul);
        if (row.remainingHours <= 0.0001) completed.push(row);
      }
      for (const row of completed) {
        site.stockpile = site.stockpile || emptyStockpile();
        site.stockpile[row.itemId] = Number((Number(site.stockpile[row.itemId] || 0) + Number(row.outputQty || 0)).toFixed(3));
        site.lastWarehouseDeposit = {
          kind: 'planned_craft',
          cargo: { [row.itemId]: row.outputQty },
          worldHour: Number(Number(state.worldHour || 0).toFixed(2))
        };
        addEvent('planned_production_completed', `${site.name}: готово ${row.itemId} x${row.outputQty}.`, {
          siteId: site.id,
          itemId: row.itemId,
          qty: row.outputQty
        });
      }
      if (completed.length) {
        const completedIds = new Set(completed.map(row => row.id));
        site.productionQueue = queue.filter(row => !completedIds.has(row.id));
        site.lastProductionHour = Number(state.worldHour || 0);
      }
      changed = true;
    }
    if (changed) dirty = true;
    return changed;
  }

  function craftIntoStockpile(stock = {}, itemId = '', targetQty = 0) {
    const qty = Math.max(0, Number(targetQty || 0));
    if (qty <= 0) return 0;
    const recipe = productionInputRecipe(itemId);
    if (!recipe) return 0;
    let possible = qty;
    for (const [key, need] of Object.entries(recipe)) {
      const perUnit = Math.max(0, Number(need || 0));
      if (perUnit <= 0) continue;
      possible = Math.min(possible, Math.max(0, Number(stock[key] || 0)) / perUnit);
    }
    const produced = Math.max(0, Number(possible.toFixed(3)));
    if (produced <= 0) return 0;
    for (const [key, need] of Object.entries(recipe)) {
      stock[key] = Math.max(0, Number(stock[key] || 0) - Math.max(0, Number(need || 0)) * produced);
    }
    stock[itemId] = Math.max(0, Number(stock[itemId] || 0) + produced);
    return produced;
  }

  function runSiteProduction(stock = {}, production = {}, cycles = 1, workerMul = 1) {
    const produced = {};
    const mul = Math.max(0, Number(cycles || 0) * Number(workerMul || 1));
    for (const [itemId, amount] of Object.entries(production || {})) {
      const targetQty = Math.max(0, Number(amount || 0) * mul);
      const qty = craftIntoStockpile(stock, itemId, targetQty);
      if (qty > 0) produced[itemId] = qty;
    }
    return produced;
  }

  function performVisibleSiteWork(siteId = '', opts = {}) {
    const key = safeId(siteId || '', '');
    const site = key ? state.sites[key] : null;
    if (!site) return { ok: false, error: 'missing_site' };

    const kind = String(opts.kind || '').trim().toLowerCase();
    const workerMul = clamp(Number(opts.workerMul ?? 1), 0.15, 2.5);
    const stock = site.stockpile || (site.stockpile = emptyStockpile());
    const now = Number(state.worldHour || 0);

    if (kind === 'harvest' && isHarvestSite(site)) {
      const output = site.output && typeof site.output === 'object' ? site.output : {};
      if (!Object.keys(output).length) return { ok: false, error: 'no_output' };
      const activity = resourceActivityPercent(site, now);
      const produced = {};
      const mul = 0.035 * workerMul * clamp(activity / 100, 0.05, 1.6);
      for (const [id, amount] of Object.entries(output)) {
        const qty = Math.max(0, Number(amount || 0) * mul);
        if (qty > 0) produced[id] = Number(qty.toFixed(3));
      }
      if (!Object.keys(produced).length) return { ok: false, error: 'empty_output' };
      addStockpile(stock, produced, 1);
      site.lastWarehouseDeposit = {
        kind: 'visible_harvest',
        cargo: compactStockpile(produced),
        worldHour: Number(now.toFixed(2))
      };
      site.lastHarvestHour = now;
      site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) + stockpileTotal(produced) * 0.035, 0, 100);
      site.resourceActivity = resourceActivityPercent(site, now);
      site.lastVisibleWorkHour = now;
      site.lastVisibleWork = { kind: 'harvest', produced: clone(produced), worldHour: Number(now.toFixed(2)) };
      dirty = true;
      save(false);
      return { ok: true, kind: 'harvest', produced, stockpile: compactStockpile(stock) };
    }

    const production = site.production && typeof site.production === 'object' ? site.production : {};
    const canProduce = Object.keys(production).length > 0 && (isProductionSite(site) || site.type === 'outpost' || site.type === 'settlement');
    if ((kind === 'craft' || kind === 'production') && canProduce) {
      const workforceMul = clamp((Number(site.workforce || 35) + Number(site.prosperity || 25)) / 120, 0.25, 1.35);
      const produced = runSiteProduction(stock, production, 0.055, workerMul * workforceMul);
      site.resourceActivity = resourceActivityPercent(site, now);
      site.lastVisibleWorkHour = now;
      if (!Object.keys(produced).length) {
        site.lastVisibleWork = { kind: 'craft', stalled: true, worldHour: Number(now.toFixed(2)) };
        dirty = true;
        save(false);
        return { ok: false, error: 'missing_inputs', stockpile: compactStockpile(stock) };
      }
      site.lastWarehouseDeposit = {
        kind: 'visible_craft',
        cargo: compactStockpile(produced),
        worldHour: Number(now.toFixed(2))
      };
      site.lastVisibleWork = { kind: 'craft', produced: clone(produced), worldHour: Number(now.toFixed(2)) };
      dirty = true;
      save(false);
      return { ok: true, kind: 'craft', produced, stockpile: compactStockpile(stock) };
    }

    return { ok: false, error: 'unsupported_kind' };
  }

  function produceAtSettlements(hours) {
    for (const site of Object.values(state.sites)) {
      if (!site || !isSettlementServiceSite(site)) continue;
      site.productionProgress = Number(site.productionProgress || 0) + hours;
      if (site.productionProgress < 6) continue;
      const cycles = Math.floor(site.productionProgress / 6);
      site.productionProgress -= cycles * 6;
      const stock = site.stockpile || (site.stockpile = emptyStockpile());
      const produced = {};
      const addProduced = (id, qty) => {
        const amount = Math.max(0, Number(qty || 0));
        if (amount > 0) produced[id] = Number((Number(produced[id] || 0) + amount).toFixed(3));
      };
      const ammoCycles = Math.min(cycles, Math.floor(Number(stock.scrap || 0) / 4), Math.floor(Number(stock.ammoParts || 0) / 2));
      if (ammoCycles > 0) {
        stock.scrap -= 4 * ammoCycles;
        stock.ammoParts -= 2 * ammoCycles;
        const ammo9 = 24 * ammoCycles;
        const ammo556 = 12 * ammoCycles;
        stock.ammo9 = Number(stock.ammo9 || 0) + ammo9;
        stock.ammo556 = Number(stock.ammo556 || 0) + ammo556;
        addProduced('ammo9', ammo9);
        addProduced('ammo556', ammo556);
      }
      const medicineCycles = Math.min(cycles, Math.floor(Number(stock.water || 0) / 3), Math.floor(Number(stock.chemicals || 0) / 1));
      if (medicineCycles > 0) {
        stock.water -= 3 * medicineCycles;
        stock.chemicals -= 1 * medicineCycles;
        const medicine = 2 * medicineCycles;
        stock.medicine = Number(stock.medicine || 0) + medicine;
        addProduced('medicine', medicine);
      }
      const weaponPartCycles = Math.min(cycles, Math.floor(Number(stock.ore || 0) / 5), Math.floor(Number(stock.scrap || 0) / 3));
      if (weaponPartCycles > 0) {
        stock.ore -= 5 * weaponPartCycles;
        stock.scrap -= 3 * weaponPartCycles;
        stock.weaponParts = Number(stock.weaponParts || 0) + weaponPartCycles;
        addProduced('weaponParts', weaponPartCycles);
      }
      if (site.production && typeof site.production === 'object') {
        const workerMul = clamp((Number(site.workforce || 35) + Number(site.prosperity || 25)) / 120, 0.35, 1.35);
        addStockpile(produced, runSiteProduction(stock, site.production, cycles, workerMul), 1);
      }
      if (Object.keys(produced).length) {
        site.lastWarehouseDeposit = {
          kind: 'npc_craft',
          cargo: compactStockpile(produced),
          worldHour: Number(Number(state.worldHour || 0).toFixed(2))
        };
        site.lastProductionHour = Number(state.worldHour || 0);
      }
      dirty = true;
    }
  }

  function resourceSiteSupportDemand(site = {}, reason = 'support') {
    if (!isSupportDemandSite(site)) return {};
    const output = site.output && typeof site.output === 'object' ? site.output : {};
    const activity = resourceActivityPercent(site, state.worldHour);
    const security = clamp(site.security ?? siteDefaultSecurity(site), 0, 100);
    const workforce = clamp(site.workforce ?? 0, 0, 100);
    const depletion = clamp(site.resourceDepletion ?? 0, 0, 100);
    const demand = {};
    const add = (id, amount) => {
      const qty = Math.max(0, Math.ceil(Number(amount || 0)));
      if (qty > 0) demand[id] = Math.max(qty, Math.ceil(Number(demand[id] || 0)));
    };

    if (isProductionSite(site)) {
      const stock = site.stockpile || {};
      const production = site.production && typeof site.production === 'object' ? site.production : {};
      const lowStock = stockpileTotal(stock) < 24;
      const missingCore = Number(stock.scrap || 0) < 8 || Number(stock.ore || 0) < 6 || Number(stock.ammoParts || 0) < 6;
      if (lowStock || missingCore || reason === 'stalled' || reason === 'low_stock') {
        add('scrap', Math.max(4, 10 - Number(stock.scrap || 0)));
        add('ore', Math.max(2, 8 - Number(stock.ore || 0)));
        if (production.energyCell || production.electronics || production.repairKit) {
          add('electronics', Math.max(2, 6 - Number(stock.electronics || 0)));
        }
        if (production.ammo9 || production.ammo556 || production.ammoParts) {
          add('ammoParts', Math.max(3, 8 - Number(stock.ammoParts || 0)));
        }
      }
      if (security < 42 || Number(site.raidUntil || 0) > Number(state.worldHour || 0) || Math.abs(Number(site.controlPressure || 0)) > 6) {
        add('ammoParts', 4);
        add('medicine', 2);
      }
      return compactStockpile(demand);
    }

    if (activity < 30 || workforce < 38 || reason === 'stalled') {
      add('water', 2 + Math.ceil(Math.max(0, 42 - workforce) / 12));
      add('medicine', workforce < 28 ? 3 : 1);
      if (output.oil || output.chemicals) add('chemicals', 2);
      else add('scrap', 3);
    }
    if (security < 42 || Number(site.raidUntil || 0) > Number(state.worldHour || 0) || Math.abs(Number(site.controlPressure || 0)) > 6) {
      add('ammoParts', 3 + Math.ceil(Math.max(0, 45 - security) / 12));
      add('medicine', 2);
    }
    if (depletion > 68 || reason === 'depleted') {
      add('scrap', output.ore || output.scrap ? 5 : 3);
      add(output.oil ? 'chemicals' : 'electronics', output.oil || output.electronics ? 2 : 1);
    }
    if (!Object.keys(demand).length && stockpileTotal(site.stockpile || {}) < 18) {
      add('water', 2);
      add('scrap', 2);
    }
    return compactStockpile(demand);
  }

  function resourceSiteSupportReason(site = {}) {
    if (!isSupportDemandSite(site)) return '';
    if (Number(site.supportBoostUntil || 0) > Number(state.worldHour || 0)) return '';
    const activity = resourceActivityPercent(site, state.worldHour);
    const security = clamp(site.security ?? siteDefaultSecurity(site), 0, 100);
    const workforce = clamp(site.workforce ?? 0, 0, 100);
    const depletion = clamp(site.resourceDepletion ?? 0, 0, 100);
    if (isProductionSite(site)) {
      const stock = site.stockpile || {};
      if (Number(site.raidUntil || 0) > Number(state.worldHour || 0)) return 'raid';
      if (security < 34 || Math.abs(Number(site.controlPressure || 0)) > 8) return 'security';
      if (workforce < 26 || activity < 35) return 'stalled';
      if (stockpileTotal(stock) < 18 || Number(stock.scrap || 0) < 4) return 'low_stock';
      return '';
    }
    if (Number(site.raidUntil || 0) > Number(state.worldHour || 0)) return 'raid';
    if (depletion > 82) return 'depleted';
    if (activity < 25 || workforce < 26) return 'stalled';
    if (security < 34 || Math.abs(Number(site.controlPressure || 0)) > 8) return 'security';
    if (stockpileTotal(site.stockpile || {}) < 12) return 'low_stock';
    return '';
  }

  function maybeCreateResourceSupportTask(site = {}, reason = '') {
    const supportReason = reason || resourceSiteSupportReason(site);
    if (!site || !supportReason) return null;
    const demand = resourceSiteSupportDemand(site, supportReason);
    if (!Object.keys(demand).length) return null;
    const now = Number(state.worldHour || 0);
    if (now - Number(site.lastSupportTaskHour || -999) < 10 && supportReason !== 'raid') return null;
    site.lastSupportTaskHour = now;
    const priority = supportReason === 'raid' ? 5 : supportReason === 'depleted' ? 4 : supportReason === 'stalled' ? 3 : 2;
    const productionSite = isProductionSite(site);
    const reasonText = supportReason === 'raid'
      ? 'точка под налетом'
      : supportReason === 'depleted'
        ? 'месторождение истощается'
        : supportReason === 'stalled'
          ? (productionSite ? 'производство почти стоит' : 'добыча почти стоит')
          : supportReason === 'security'
            ? 'охрана просела'
            : 'запасы на точке низкие';
    const supportLabel = productionSite ? 'производства' : 'добычи';
    const activityLabel = productionSite ? 'производства' : 'добычи';
    addEvent('resource_support_needed', `${site.name}: нужна поддержка ${supportLabel} (${stockpileSummary(demand)}).`, {
      siteId: site.id,
      reason: supportReason,
      demand
    });
    return createWorldTask('deliver_supplies', {
      key: `resource_support:${site.id}:${supportReason}`,
      title: `Поддержать ${supportLabel}: ${site.name}`,
      text: `${site.name}: ${reasonText}. Доставьте ${stockpileSummary(demand)}, чтобы поднять рабочих, безопасность и активность ${activityLabel}.`,
      siteId: site.id,
      objective: 'support_resource_site',
      durationHours: supportReason === 'raid' ? 24 : 42,
      priority,
      details: {
        demand,
        resourceSupport: true,
        supportReason,
        relief: {
          workforce: supportReason === 'stalled' ? 12 : 8,
          security: supportReason === 'security' || supportReason === 'raid' ? 12 : 6,
          depletion: supportReason === 'depleted' ? 10 : 4,
          activityHours: supportReason === 'raid' ? 18 : 24
        }
      }
    });
  }

  function produceAtResourceSites(hours) {
    for (const site of Object.values(state.sites)) {
      if (!site || !isHarvestSite(site)) continue;
      site.resourceProgress = Number(site.resourceProgress || 0) + hours;
      if (site.resourceProgress < 4) continue;
      const cycles = Math.floor(site.resourceProgress / 4);
      site.resourceProgress -= cycles * 4;
      const output = site.output && typeof site.output === 'object'
        ? site.output
        : {};
      if (!Object.keys(output).length) continue;
      const activity = resourceActivityPercent(site, state.worldHour);
      site.resourceActivity = activity;
      const productionMul = cycles * 0.24 * clamp(activity / 100, 0.03, 1.8);
      const produced = {};
      Object.entries(output).forEach(([id, amount]) => {
        const qty = Math.max(0, Number(amount || 0) * productionMul);
        if (qty > 0) produced[id] = qty;
      });
      addStockpile(site.stockpile || (site.stockpile = emptyStockpile()), output, productionMul);
      if (Object.keys(produced).length) {
        site.lastWarehouseDeposit = {
          kind: 'npc_harvest',
          cargo: compactStockpile(produced),
          worldHour: Number(Number(state.worldHour || 0).toFixed(2))
        };
      }
      const activeDrain = cycles * 0.3 * clamp(activity / 100, 0, 1.5);
      const naturalRecovery = cycles * (Number(state.worldHour || 0) - Number(site.lastHarvestHour || 0) > 18 ? 0.42 : 0.16);
      site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) + activeDrain - naturalRecovery, 0, 100);
      if (activity < 25 && Number(state.worldHour || 0) - Number(site.lastStalledEventHour || -999) >= 24) {
        site.lastStalledEventHour = state.worldHour;
        addEvent('resource_stalled', `${site.name}: добыча почти остановилась. Нужны безопасность и рабочие.`, {
          siteId: site.id,
          owner: site.owner,
          activity
        });
        maybeCreateResourceSupportTask(site, 'stalled');
      }
      if (Number(site.resourceDepletion || 0) > 82 && Number(state.worldHour || 0) - Number(site.lastDepletedEventHour || -999) >= 24) {
        site.lastDepletedEventHour = state.worldHour;
        addEvent('resource_depleted', `${site.name}: месторождение сильно истощено. Добыча замедляется.`, {
          siteId: site.id,
          depletion: site.resourceDepletion
        });
        maybeCreateResourceSupportTask(site, 'depleted');
      }
      const supportReason = resourceSiteSupportReason(site);
      if (supportReason && Number(state.worldHour || 0) - Number(site.lastSupportCheckHour || -999) >= 12) {
        site.lastSupportCheckHour = state.worldHour;
        maybeCreateResourceSupportTask(site, supportReason);
      }
      if (Number(state.worldHour || 0) - Number(site.lastProductionEventHour || -999) >= 24) {
        site.lastProductionEventHour = state.worldHour;
        addEvent('resource_produced', `${site.name} накопила ресурсы: ${stockpileSummary(site.stockpile)}. Активность: ${activity}%.`, {
          siteId: site.id,
          owner: site.owner,
          activity,
          depletion: site.resourceDepletion,
          stockpile: clone(site.stockpile)
        });
      }
      dirty = true;
    }
  }

  function consumeSettlementSupplies(hours) {
    for (const site of Object.values(state.sites)) {
      if (!site || !isSettlementServiceSite(site)) continue;
      site.consumptionProgress = Number(site.consumptionProgress || 0) + hours;
      if (site.consumptionProgress < 6) continue;
      const cycles = Math.floor(site.consumptionProgress / 6);
      site.consumptionProgress -= cycles * 6;
      const stock = site.stockpile || (site.stockpile = emptyStockpile());
      const demand = {
        water: Math.max(1, Math.round((Number(site.prosperity || 25) / 35 + 0.7) * cycles)),
        medicine: Math.max(0, Math.floor((100 - Number(site.security || siteDefaultSecurity(site))) / 45) * cycles),
        ammoParts: (site.type === 'outpost' || site.type === 'production') ? Math.max(1, cycles) : Math.max(0, Math.floor(cycles / 2))
      };
      const taken = takeStockpile(stock, demand);
      const shortage = Object.entries(demand).some(([key, need]) => Number(taken[key] || 0) < Number(need || 0));
      if (shortage) {
        site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), Number(state.worldHour || 0) + 10);
        site.prosperity = clamp(Number(site.prosperity || 0) - 1.5 * cycles, 0, 100);
        site.security = clamp(Number(site.security || siteDefaultSecurity(site)) - 1 * cycles, 0, 100);
        if (Number(state.worldHour || 0) - Number(site.lastShortageEventHour || -999) >= 18) {
          site.lastShortageEventHour = state.worldHour;
          addEvent('supply_shortage', `${site.name}: нехватка снабжения (${stockpileSummary(demand)}).`, {
            siteId: site.id,
            demand,
            taken
          });
          createWorldTask('deliver_supplies', {
            key: `deliver_supplies:${site.id}`,
            title: `Доставить припасы: ${site.name}`,
            text: `${site.name} испытывает нехватку: ${stockpileSummary(demand)}. Доставьте припасы до того, как безопасность и производство просядут сильнее.`,
            siteId: site.id,
            objective: 'deliver_supplies',
            durationHours: 48,
            priority: (site.type === 'outpost' || site.type === 'production') ? 3 : 2,
            details: { demand, taken }
          });
        }
      } else {
        site.prosperity = clamp(Number(site.prosperity || 0) + 0.35 * cycles, 0, 100);
        site.security = clamp(Number(site.security || siteDefaultSecurity(site)) + ((site.type === 'outpost' || site.type === 'production') ? 0.3 : 0.12) * cycles, 0, 100);
      }
      dirty = true;
    }
  }

  function surplusTradeCargoForSite(site = {}) {
    if (!site || !isSettlementServiceSite(site)) return {};
    const stock = site.stockpile && typeof site.stockpile === 'object' ? site.stockpile : {};
    const reserve = site.type === 'settlement' ? 55 : site.type === 'production' ? 42 : 32;
    const preferred = new Set([
      ...Object.keys(site.production || {}),
      ...Object.keys(stock)
    ]);
    const cargo = {};
    let total = 0;
    // Готовые изделия делаются малыми партиями: пары кирок никогда не наберётся
    // больше общего резерва, и они оставались на производстве навсегда, пока
    // прилавки стояли пустыми. Если другая точка фракции этот товар прямо
    // запрашивает, резерв опускается — так же, как это уже сделано для вывоза с
    // ресурсных точек.
    const reserveFor = id => (remoteFactionDemand(site, id) > 0 ? Math.min(4, reserve) : reserve);
    Object.entries(stock)
      .filter(([id, amount]) => preferred.has(id) && Number(amount || 0) > reserveFor(id))
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .forEach(([id, amount]) => {
        if (total >= 140) return;
        const excess = Math.floor(Number(amount || 0) - reserveFor(id));
        const take = Math.min(excess, 70, 140 - total);
        if (take > 0) {
          cargo[id] = take;
          total += take;
        }
      });
    return stockpileTotal(cargo) >= SURPLUS_TRADE_THRESHOLD ? compactStockpile(cargo) : {};
  }

  function chooseSurplusTradeDestination(source = {}, cargo = {}) {
    const sourceFaction = factionGroup(source.owner || 'caravans');
    const fakeParty = { faction: sourceFaction, cargo };
    const globalMap = getGlobalMap();
    const rows = Object.values(state.sites || {})
      .filter(site => site
        && site.id !== source.id
        && isSettlementServiceSite(site)
        && caravanCanDeliverToSite(fakeParty, site))
      .map(site => {
        const demand = resourceSiteSupportDemand(site, 'low_stock');
        const matchingNeed = Object.keys(cargo).reduce((sum, id) => sum + Math.min(Number(cargo[id] || 0), Number(demand[id] || 0)), 0);
        const tradeBonus = factionGroup(site.owner || '') !== sourceFaction ? -18 : 0;
        const capitalBonus = isFactionCapitalSite(site) ? -8 : 0;
        const distance = pointDistanceKm(source, site, globalMap);
        return { site, score: distance - matchingNeed * 2.4 + tradeBonus + capitalBonus };
      })
      .sort((a, b) => a.score - b.score);
    return rows[0]?.site || null;
  }

  function createSurplusTradeCaravan(source = {}) {
    if (!source || !isSettlementServiceSite(source)) return null;
    const now = Number(state.worldHour || 0);
    if (now - Number(source.lastSurplusTradeHour || -999) < SURPLUS_TRADE_COOLDOWN_HOURS) return null;
    const active = Object.values(state.parties || {}).some(party => party
      && party.interFactionTrade
      && !party.destroyed
      && party.state !== 'destroyed'
      && party.homeSiteId === source.id);
    if (active) return null;
    const cargoPlan = surplusTradeCargoForSite(source);
    if (!Object.keys(cargoPlan).length) return null;
    const destination = chooseSurplusTradeDestination(source, cargoPlan);
    if (!destination || destination.id === source.id) return null;
    const cargo = takeStockpile(source.stockpile || (source.stockpile = emptyStockpile()), cargoPlan);
    if (stockpileTotal(cargo) < SURPLUS_TRADE_THRESHOLD) {
      addStockpile(source.stockpile, cargo);
      return null;
    }
    const faction = isJoinableWorldFaction(source.owner || '') ? factionGroup(source.owner || '') : 'caravans';
    const partyId = safeId(`trade_${source.id}_${Math.floor(now * 10)}`, `trade_${source.id}_${Date.now()}`);
    const party = {
      id: partyId,
      name: `Тяжелый торговый караван: ${source.name || source.id}`,
      kind: 'caravan',
      faction,
      state: 'moving',
      homeSiteId: source.id,
      destinationSiteId: destination.id,
      route: [destination.id, source.id],
      routeIndex: 0,
      x: Number(source.x || 0),
      y: Number(source.y || 0),
      baseSpeedKmh: 18,
      speedKmh: boostedWorldPartySpeedKmh(18, { kind: 'caravan', faction }),
      speedProfileVersion: WORLD_PARTY_SPEED_PROFILE_VERSION,
      strength: 74,
      members: 8,
      cargoCapacity: Math.max(140, Math.ceil(stockpileTotal(cargo) + 40)),
      cargo,
      preferredResources: Object.keys(cargo),
      supplyRole: 'heavy',
      dynamic: true,
      respawnDisabled: true,
      interFactionTrade: true,
      tradeDestinationSiteId: destination.id,
      createdHour: now
    };
    state.parties[partyId] = party;
    source.lastSurplusTradeHour = now;
    if (!beginCaravanStagingOnsite(party, source)) {
      addStockpile(source.stockpile, cargo);
      delete state.parties[partyId];
      return null;
    }
    addEvent('surplus_trade_caravan', `${party.name} готовит обменный рейс в ${destination.name || destination.id}: ${stockpileSummary(cargo)}.`, {
      partyId,
      sourceSiteId: source.id,
      destinationSiteId: destination.id,
      cargo: clone(cargo)
    });
    dirty = true;
    return party;
  }

  function createSurplusTradeCaravans(hours) {
    for (const site of Object.values(state.sites || {})) {
      if (!site || !isSettlementServiceSite(site)) continue;
      site.surplusTradeProgress = Number(site.surplusTradeProgress || 0) + Math.max(0, Number(hours || 0));
      if (site.surplusTradeProgress < 6) continue;
      site.surplusTradeProgress = 0;
      createSurplusTradeCaravan(site);
    }
  }

  function productionInputDemand(site = {}) {
    const production = site.production && typeof site.production === 'object' ? site.production : {};
    const demand = { ...(site.productionDemand && typeof site.productionDemand === 'object' ? site.productionDemand : {}) };
    Object.entries(site.retailDemand && typeof site.retailDemand === 'object' ? site.retailDemand : {}).forEach(([id, qty]) => {
      demand[id] = Math.max(Number(demand[id] || 0), Math.max(0, Number(qty || 0)));
    });
    Object.entries(production).forEach(([itemId, amount]) => {
      const recipe = productionInputRecipe(itemId);
      if (!recipe) return;
      const scale = Math.max(1, Math.ceil(Number(amount || 0) / 5));
      Object.entries(recipe).forEach(([id, need]) => {
        const qty = Math.max(0, Math.ceil(Number(need || 0) * scale));
        if (qty > 0) demand[id] = Math.max(qty, Math.ceil(Number(demand[id] || 0)));
      });
    });
    return compactStockpile(demand);
  }

  function remoteFactionDemand(source = {}, itemId = '') {
    const owner = factionGroup(source.owner || 'neutral');
    return Object.values(state.sites || {}).reduce((sum, site) => {
      if (!site || site.id === source.id || factionGroup(site.owner || 'neutral') !== owner || !isSettlementServiceSite(site)) return sum;
      return sum + Math.max(0, Number(productionInputDemand(site)[itemId] || 0));
    }, 0);
  }

  function cargoDemandAtSite(cargo = {}, site = {}) {
    const demand = productionInputDemand(site);
    return Object.entries(cargo || {}).reduce((sum, [id, qty]) => (
      sum + Math.min(Math.max(0, Number(qty || 0)), Math.max(0, Number(demand[id] || 0)))
    ), 0);
  }

  function resourceExportCargoForSite(source = {}) {
    if (!source || !isHarvestSite(source)) return {};
    const ownerGroup = factionGroup(source.owner || 'neutral');
    if (!isJoinableWorldFaction(ownerGroup) && ownerGroup !== 'neutral' && ownerGroup !== 'caravans') return {};
    const stock = source.stockpile && typeof source.stockpile === 'object' ? source.stockpile : {};
    const outputKeys = Object.keys(source.output || {}).filter(Boolean);
    if (!outputKeys.length) return {};
    const normalReserve = source.type === 'pointOfInterest' ? 20 : 18;
    const cargo = {};
    let total = 0;
    let demandDriven = 0;
    outputKeys
      .sort((a, b) => Number(stock[b] || 0) - Number(stock[a] || 0))
      .forEach(id => {
        if (total >= 90) return;
        const have = Math.max(0, Math.floor(Number(stock[id] || 0)));
        const requested = Math.max(0, Math.ceil(remoteFactionDemand(source, id)));
        const reserve = requested > 0 ? Math.min(6, normalReserve) : normalReserve;
        const available = Math.max(0, have - reserve);
        const take = Math.min(available, requested > 0 ? requested : 60, 90 - total);
        if (take > 0) {
          cargo[id] = take;
          total += take;
          if (requested > 0) demandDriven += take;
        }
      });
    return demandDriven > 0 || stockpileTotal(cargo) >= RESOURCE_EXPORT_THRESHOLD ? compactStockpile(cargo) : {};
  }

  function chooseResourceExportDestination(source = {}, cargo = {}) {
    const ownerGroup = factionGroup(source.owner || 'neutral');
    const faction = isJoinableWorldFaction(ownerGroup) ? ownerGroup : 'caravans';
    const fakeParty = { faction, cargo };
    const globalMap = getGlobalMap();
    const candidates = Object.values(state.sites || {})
      .filter(site => site
        && site.id !== source.id
        && isSettlementServiceSite(site)
        && caravanCanDeliverToSite(fakeParty, site))
      .map(site => {
        const supportDemand = resourceSiteSupportDemand(site, 'low_stock');
        const inputDemand = productionInputDemand(site);
        const matchingSupport = Object.keys(cargo).reduce((sum, id) => sum + Math.min(Number(cargo[id] || 0), Number(supportDemand[id] || 0)), 0);
        const matchingInputs = Object.keys(cargo).reduce((sum, id) => sum + Math.min(Number(cargo[id] || 0), Number(inputDemand[id] || 0)), 0);
        const distance = pointDistanceKm(source, site, globalMap);
        const productionBonus = isProductionSite(site) ? -16 : site.type === 'outpost' ? -7 : 0;
        const capitalBonus = isFactionCapitalSite(site) ? -5 : 0;
        return { site, score: distance - matchingInputs * 3 - matchingSupport * 1.7 + productionBonus + capitalBonus };
      })
      .sort((a, b) => a.score - b.score);
    return candidates[0]?.site || null;
  }

  function createResourceExportCaravan(source = {}) {
    if (!source || !isHarvestSite(source)) return null;
    const now = Number(state.worldHour || 0);
    if (now - Number(source.lastResourceExportHour || -999) < RESOURCE_EXPORT_COOLDOWN_HOURS) return null;
    const active = Object.values(state.parties || {}).some(party => party
      && party.resourceExport
      && !party.destroyed
      && party.state !== 'destroyed'
      && party.homeSiteId === source.id);
    if (active) return null;
    const cargoPlan = resourceExportCargoForSite(source);
    if (!Object.keys(cargoPlan).length) return null;
    const destination = chooseResourceExportDestination(source, cargoPlan);
    if (!destination || destination.id === source.id) return null;
    const cargo = takeStockpile(source.stockpile || (source.stockpile = emptyStockpile()), cargoPlan);
    if (stockpileTotal(cargo) < RESOURCE_EXPORT_THRESHOLD && cargoDemandAtSite(cargo, destination) <= 0) {
      addStockpile(source.stockpile, cargo);
      return null;
    }
    const ownerGroup = factionGroup(source.owner || 'neutral');
    const faction = isJoinableWorldFaction(ownerGroup) ? ownerGroup : 'caravans';
    const partyId = safeId(`resource_${source.id}_${Math.floor(now * 10)}`, `resource_${source.id}_${Date.now()}`);
    const party = {
      id: partyId,
      name: `Ресурсный караван: ${source.name || source.id}`,
      kind: 'caravan',
      faction,
      state: 'moving',
      homeSiteId: source.id,
      destinationSiteId: destination.id,
      route: [destination.id],
      routeIndex: 0,
      x: Number(source.x || 0),
      y: Number(source.y || 0),
      baseSpeedKmh: 18,
      speedKmh: boostedWorldPartySpeedKmh(18, { kind: 'caravan', faction }),
      speedProfileVersion: WORLD_PARTY_SPEED_PROFILE_VERSION,
      strength: 36 + Math.min(24, stockpileTotal(cargo) / 4),
      members: Math.max(4, Math.min(8, 3 + Math.ceil(stockpileTotal(cargo) / 24))),
      cargoCapacity: Math.max(70, Math.ceil(stockpileTotal(cargo) + 18)),
      cargo,
      preferredResources: Object.keys(cargo),
      supplyRole: 'resource_export',
      dynamic: true,
      respawnDisabled: true,
      resourceExport: true,
      resourceSourceSiteId: source.id,
      createdHour: now
    };
    state.parties[partyId] = party;
    source.lastResourceExportHour = now;
    if (!beginCaravanStagingOnsite(party, source)) {
      addStockpile(source.stockpile, cargo);
      delete state.parties[partyId];
      return null;
    }
    addEvent('resource_export_caravan', `${party.name} готовит отправку в ${destination.name || destination.id}: ${stockpileSummary(cargo)}.`, {
      partyId,
      sourceSiteId: source.id,
      destinationSiteId: destination.id,
      cargo: clone(cargo)
    });
    dirty = true;
    return party;
  }

  function createResourceExportCaravans(hours) {
    for (const site of Object.values(state.sites || {})) {
      if (!site || !isHarvestSite(site)) continue;
      site.resourceExportProgress = Number(site.resourceExportProgress || 0) + Math.max(0, Number(hours || 0));
      if (site.resourceExportProgress < 3) continue;
      site.resourceExportProgress = 0;
      createResourceExportCaravan(site);
    }
  }

  function productionExportSite(source = {}) {
    const type = siteTypeKey(source);
    return type === 'production' || type === 'outpost';
  }

  function productionExportOutputKeys(source = {}) {
    const production = source.production && typeof source.production === 'object' ? source.production : {};
    const stock = source.stockpile && typeof source.stockpile === 'object' ? source.stockpile : {};
    const authored = Object.keys(production).filter(id => productionInputRecipe(id));
    const producedGoods = [
      'ammo9',
      'ammo556',
      'shotgunShell',
      'rocketAmmo',
      'ammoParts',
      'energyCell',
      'napalm',
      'repairKit',
      'electronics',
      'weaponParts',
      'stim',
      'medkit',
      'doctorBag',
      'antibiotics',
      'medicine'
    ];
    return Array.from(new Set([
      ...authored,
      ...producedGoods.filter(id => Number(stock[id] || 0) > 0),
      ...Object.keys(economyRecipes).filter(id => Number(stock[id] || 0) > 0)
    ]));
  }

  function productionExportCargoForSite(source = {}) {
    if (!source || !productionExportSite(source)) return {};
    const ownerGroup = factionGroup(source.owner || 'neutral');
    if (!isJoinableWorldFaction(ownerGroup) && ownerGroup !== 'caravans') return {};
    const stock = source.stockpile && typeof source.stockpile === 'object' ? source.stockpile : {};
    const outputKeys = productionExportOutputKeys(source);
    if (!outputKeys.length) return {};
    const normalReserve = siteTypeKey(source) === 'outpost' ? 26 : 18;
    const cargo = {};
    let total = 0;
    let demandDriven = 0;
    outputKeys
      .sort((a, b) => Number(stock[b] || 0) - Number(stock[a] || 0))
      .forEach(id => {
        if (total >= 95) return;
        const have = Math.max(0, Math.floor(Number(stock[id] || 0)));
        const requested = Math.max(0, Math.ceil(remoteFactionDemand(source, id)));
        const reserve = requested > 0 ? 0 : normalReserve;
        const available = Math.max(0, have - reserve);
        const take = Math.min(available, requested > 0 ? requested : 64, 95 - total);
        if (take > 0) {
          cargo[id] = take;
          total += take;
          if (requested > 0) demandDriven += take;
        }
      });
    return demandDriven > 0 || stockpileTotal(cargo) >= PRODUCTION_EXPORT_THRESHOLD ? compactStockpile(cargo) : {};
  }

  function productionGoodsDemand(site = {}) {
    if (!site || !isSettlementServiceSite(site)) return {};
    const stock = site.stockpile && typeof site.stockpile === 'object' ? site.stockpile : {};
    const type = siteTypeKey(site);
    const capitalMul = isFactionCapitalSite(site) ? 1.8 : 1;
    const outpostMul = type === 'outpost' ? 1.25 : 1;
    const desired = {
      ammo9: Math.round((type === 'settlement' ? 260 : 110) * capitalMul * outpostMul),
      ammo556: Math.round((type === 'settlement' ? 130 : 72) * capitalMul * outpostMul),
      shotgunShell: Math.round((type === 'settlement' ? 48 : 28) * capitalMul * outpostMul),
      rocketAmmo: Math.round((type === 'settlement' ? 8 : 5) * capitalMul * outpostMul),
      ammoParts: Math.round((type === 'production' ? 38 : 22) * capitalMul),
      energyCell: Math.round((type === 'settlement' ? 72 : 44) * capitalMul * outpostMul),
      napalm: Math.round((type === 'settlement' ? 18 : 10) * capitalMul * outpostMul),
      repairKit: Math.round((type === 'settlement' ? 18 : 10) * capitalMul),
      electronics: Math.round((type === 'production' ? 32 : 18) * capitalMul),
      weaponParts: Math.round((type === 'settlement' ? 26 : 14) * capitalMul),
      stim: Math.round((type === 'settlement' ? 38 : 18) * capitalMul),
      medkit: Math.round((type === 'settlement' ? 24 : 12) * capitalMul),
      doctorBag: Math.round((type === 'settlement' ? 8 : 4) * capitalMul),
      antibiotics: Math.round((type === 'settlement' ? 18 : 9) * capitalMul),
      medicine: Math.round((type === 'settlement' ? 60 : 24) * capitalMul)
    };
    const inputDemand = productionInputDemand(site);
    Object.entries(inputDemand).forEach(([id, qty]) => {
      desired[id] = Math.max(Number(desired[id] || 0), Number(qty || 0) + 12);
    });
    const demand = {};
    Object.entries(desired).forEach(([id, wanted]) => {
      const need = Math.max(0, Math.ceil(Number(wanted || 0) - Number(stock[id] || 0)));
      if (need > 0) demand[id] = need;
    });
    return compactStockpile(demand);
  }

  function chooseProductionExportDestination(source = {}, cargo = {}) {
    const sourceFaction = factionGroup(source.owner || 'neutral');
    const faction = isJoinableWorldFaction(sourceFaction) ? sourceFaction : 'caravans';
    const fakeParty = { faction, cargo };
    const globalMap = getGlobalMap();
    const capitalId = capitalSiteIdForFaction(faction);
    const rows = Object.values(state.sites || {})
      .filter(site => site
        && site.id !== source.id
        && isSettlementServiceSite(site)
        && caravanCanDeliverToSite(fakeParty, site))
      .map(site => {
        const demand = productionGoodsDemand(site);
        const matchingNeed = Object.keys(cargo).reduce((sum, id) => sum + Math.min(Number(cargo[id] || 0), Number(demand[id] || 0)), 0);
        const owner = factionGroup(site.owner || 'neutral');
        const sameOwnerBonus = owner === faction ? -18 : 0;
        const capitalBonus = site.id === capitalId ? -16 : isFactionCapitalSite(site) ? -6 : 0;
        const outpostBonus = siteTypeKey(site) === 'outpost' ? -7 : 0;
        const productionPenalty = siteTypeKey(site) === 'production' && matchingNeed <= 0 ? 16 : 0;
        const distance = pointDistanceKm(source, site, globalMap);
        return { site, matchingNeed, score: distance - matchingNeed * 2.8 + sameOwnerBonus + capitalBonus + outpostBonus + productionPenalty };
      })
      .filter(row => row.matchingNeed > 0 || row.site.id === capitalId || siteTypeKey(row.site) === 'outpost')
      .sort((a, b) => a.score - b.score);
    return rows[0]?.site || null;
  }

  function createProductionExportCaravan(source = {}) {
    if (!source || !productionExportSite(source)) return null;
    const now = Number(state.worldHour || 0);
    if (now - Number(source.lastProductionExportHour || -999) < PRODUCTION_EXPORT_COOLDOWN_HOURS) return null;
    const active = Object.values(state.parties || {}).some(party => party
      && party.productionExport
      && !party.destroyed
      && party.state !== 'destroyed'
      && party.homeSiteId === source.id);
    if (active) return null;
    const cargoPlan = productionExportCargoForSite(source);
    if (!Object.keys(cargoPlan).length) return null;
    const destination = chooseProductionExportDestination(source, cargoPlan);
    if (!destination || destination.id === source.id) return null;
    const cargo = takeStockpile(source.stockpile || (source.stockpile = emptyStockpile()), cargoPlan);
    if (stockpileTotal(cargo) < PRODUCTION_EXPORT_THRESHOLD && cargoDemandAtSite(cargo, destination) <= 0) {
      addStockpile(source.stockpile, cargo);
      return null;
    }
    const ownerGroup = factionGroup(source.owner || 'neutral');
    const faction = isJoinableWorldFaction(ownerGroup) ? ownerGroup : 'caravans';
    const partyId = safeId(`production_${source.id}_${Math.floor(now * 10)}`, `production_${source.id}_${Date.now()}`);
    const party = {
      id: partyId,
      name: `Производственный караван: ${source.name || source.id}`,
      kind: 'caravan',
      faction,
      state: 'moving',
      homeSiteId: source.id,
      destinationSiteId: destination.id,
      route: [destination.id],
      routeIndex: 0,
      x: Number(source.x || 0),
      y: Number(source.y || 0),
      baseSpeedKmh: 18,
      speedKmh: boostedWorldPartySpeedKmh(18, { kind: 'caravan', faction }),
      speedProfileVersion: WORLD_PARTY_SPEED_PROFILE_VERSION,
      strength: 42 + Math.min(28, stockpileTotal(cargo) / 3.5),
      members: Math.max(5, Math.min(9, 4 + Math.ceil(stockpileTotal(cargo) / 22))),
      cargoCapacity: Math.max(80, Math.ceil(stockpileTotal(cargo) + 22)),
      cargo,
      preferredResources: Object.keys(cargo),
      supplyRole: 'production_export',
      dynamic: true,
      respawnDisabled: true,
      productionExport: true,
      productionSourceSiteId: source.id,
      createdHour: now
    };
    state.parties[partyId] = party;
    source.lastProductionExportHour = now;
    if (!beginCaravanStagingOnsite(party, source)) {
      addStockpile(source.stockpile, cargo);
      delete state.parties[partyId];
      return null;
    }
    addEvent('production_export_caravan', `${party.name} готовит доставку в ${destination.name || destination.id}: ${stockpileSummary(cargo)}.`, {
      partyId,
      sourceSiteId: source.id,
      destinationSiteId: destination.id,
      cargo: clone(cargo)
    });
    dirty = true;
    return party;
  }

  function createProductionExportCaravans(hours) {
    for (const site of Object.values(state.sites || {})) {
      if (!site || !productionExportSite(site)) continue;
      site.productionExportProgress = Number(site.productionExportProgress || 0) + Math.max(0, Number(hours || 0));
      if (site.productionExportProgress < 4) continue;
      site.productionExportProgress = 0;
      createProductionExportCaravan(site);
    }
  }

  function siteConflictTaskKey(site = {}) {
    return `site_conflict:${safeId(site.id || 'site', 'site')}`;
  }

  function activeSiteConflict(site = {}) {
    const conflict = site && site.activeConflict && typeof site.activeConflict === 'object' ? site.activeConflict : null;
    if (!conflict || conflict.active === false || String(conflict.status || 'active') !== 'active') return null;
    const owner = factionGroup(site.owner || 'neutral');
    const attackers = Array.isArray(conflict.attackers)
      ? conflict.attackers.filter(row => row && row.faction && factionGroup(row.faction) !== owner && hostile(row.faction, owner))
      : [];
    if (!attackers.length) {
      conflict.active = false;
      conflict.status = 'invalid';
      conflict.completedHour = Number(state.worldHour || 0);
      site.activeConflict = null;
      site.raidUntil = 0;
      dirty = true;
      return null;
    }
    conflict.attackers = attackers;
    return conflict;
  }

  function siteConflictAttackers(site = {}) {
    const conflict = activeSiteConflict(site);
    return conflict ? conflict.attackers : [];
  }

  function siteConflictPrimaryFaction(site = {}) {
    const attackers = siteConflictAttackers(site);
    if (!attackers.length) return safeId(site.lastRaidFaction || 'wild', 'wild');
    return attackers
      .slice()
      .sort((a, b) => Number(b.power || 0) - Number(a.power || 0) || Number(a.order || 0) - Number(b.order || 0))[0].faction;
  }

  function siteConflictAttackerNames(site = {}) {
    const names = siteConflictAttackers(site)
      .map(row => factionLabel(row.faction))
      .filter(Boolean);
    return Array.from(new Set(names)).slice(0, 4).join(', ') || factionLabel(site.lastRaidFaction || 'wild');
  }

  function siteConflictPublicSummary(site = {}) {
    const conflict = activeSiteConflict(site);
    if (!conflict) return null;
    const attackers = siteConflictAttackers(site);
    return {
      id: conflict.id || siteConflictTaskKey(site),
      kind: conflict.kind || 'raid',
      startedHour: Number(conflict.startedHour || 0),
      updatedHour: Number(conflict.updatedHour || 0),
      expiresHour: Number(conflict.expiresHour || site.raidUntil || 0),
      ownerAtStart: conflict.ownerAtStart || site.owner || '',
      primaryFaction: siteConflictPrimaryFaction(site),
      attackerNames: siteConflictAttackerNames(site),
      progress: Number(Number(conflict.progress || 0).toFixed(2)),
      attackersPower: Number(Number(conflict.attackersPower || 0).toFixed(1)),
      defendersPower: Number(Number(conflict.defendersPower || 0).toFixed(1)),
      attackers: attackers.map(row => ({
        faction: row.faction,
        label: factionLabel(row.faction),
        power: Number(Number(row.power || 0).toFixed(1)),
        count: Number(row.count || 1),
        partyId: row.partyId || ''
      }))
    };
  }

  function siteConflictTitle(site = {}) {
    return `Налёт: ${site.name || site.id}`;
  }

  function siteConflictText(site = {}) {
    const conflict = activeSiteConflict(site);
    const pressure = conflict ? Number(conflict.progress || 0) : Number(site.controlPressure || 0);
    const stateText = pressure >= 8
      ? 'Атакующие почти прорвали оборону.'
      : pressure <= -3
        ? 'Оборона постепенно оттесняет нападающих.'
        : 'Схватка продолжается, исход ещё не решён.';
    return `${siteConflictAttackers(site).length > 1 ? 'Несколько групп' : siteConflictAttackerNames(site)} сражаются за точку. ${stateText}`;
  }

  function ensureSiteConflictTask(site = {}) {
    const conflict = activeSiteConflict(site);
    if (!conflict) return null;
    const key = siteConflictTaskKey(site);
    const primaryFaction = siteConflictPrimaryFaction(site);
    const task = createWorldTask('defend_resource', {
      key,
      title: siteConflictTitle(site),
      text: siteConflictText(site),
      siteId: site.id,
      targetFaction: primaryFaction,
      objective: 'site_conflict',
      durationHours: Math.max(10, Number(conflict.expiresHour || state.worldHour || 0) - Number(state.worldHour || 0) + 4),
      priority: Number(conflict.progress || 0) > 8 ? 5 : 4,
      details: {
        conflictId: conflict.id || key,
        attackers: siteConflictAttackers(site).map(row => ({ ...row })),
        conflictProgress: Number(Number(conflict.progress || 0).toFixed(2))
      }
    });
    if (task) {
      task.title = siteConflictTitle(site);
      task.text = siteConflictText(site);
      task.targetFaction = primaryFaction;
      task.objective = 'site_conflict';
      task.expiresHour = Math.max(Number(task.expiresHour || 0), Number(conflict.expiresHour || 0));
      task.details = {
        ...(task.details || {}),
        conflictId: conflict.id || key,
        attackers: siteConflictAttackers(site).map(row => ({ ...row })),
        conflictProgress: Number(Number(conflict.progress || 0).toFixed(2))
      };
    }
    finishActiveWorldTasks(
      taskRow => taskRow.siteId === site.id
        && ['defend_resource', 'retake_site'].includes(String(taskRow.type || ''))
        && taskRow.key !== key
        && taskRow.id !== task?.id,
      'resolved',
      'merged_site_conflict',
      { conflictId: conflict.id || key }
    );
    dirty = true;
    return task;
  }

  function joinSiteConflict(site = {}, faction = '', data = {}) {
    if (!site || !site.id || !isContestedWorldSite(site)) return null;
    if (isCapitalProtectedSite(site)) return null;
    const attackerFaction = factionGroup(faction || data.attackerFaction || site.lastRaidFaction || 'wild');
    if (!attackerFaction || attackerFaction === 'neutral') return null;
    const ownerFaction = factionGroup(site.owner || 'neutral');
    if (attackerFaction === ownerFaction || !hostile(attackerFaction, ownerFaction)) return activeSiteConflict(site);
    const now = Number(state.worldHour || 0);
    const durationHours = clamp(data.durationHours ?? 14, 4, 48);
    const wasActive = !!activeSiteConflict(site);
    const conflict = wasActive
      ? activeSiteConflict(site)
      : {
          id: `site_conflict_${safeId(site.id, 'site')}_${Math.floor(now * 10)}`,
          active: true,
          kind: data.kind || 'raid',
          status: 'active',
          startedHour: now,
          updatedHour: now,
          expiresHour: now + durationHours,
          ownerAtStart: site.owner || 'neutral',
          progress: clamp(Math.max(0, Number(site.controlPressure || 0)), -12, 18),
          attackers: []
        };
    site.activeConflict = conflict;
    conflict.updatedHour = now;
    conflict.expiresHour = Math.max(Number(conflict.expiresHour || 0), now + durationHours);
    const power = clamp(data.power ?? 24, 1, 500);
    const existing = conflict.attackers.find(row => factionGroup(row.faction) === attackerFaction);
    if (existing) {
      existing.power = clamp(Math.max(Number(existing.power || 0), power) + power * 0.18, 1, 500);
      existing.count = Math.max(1, Math.floor(Number(existing.count || 1))) + 1;
      existing.lastHour = now;
      if (data.partyId) existing.partyId = safeId(data.partyId, existing.partyId || '');
      existing.source = String(data.source || existing.source || 'raid').slice(0, 32);
    } else {
      conflict.attackers.push({
        faction: attackerFaction,
        power,
        partyId: safeId(data.partyId || '', ''),
        source: String(data.source || 'raid').slice(0, 32),
        count: 1,
        firstHour: now,
        lastHour: now,
        order: conflict.attackers.length
      });
    }
    conflict.attackers = conflict.attackers.slice(0, 8);
    site.raidUntil = Math.max(Number(site.raidUntil || 0), Number(conflict.expiresHour || 0));
    site.lastRaidHour = now;
    site.lastRaidFaction = siteConflictPrimaryFaction(site);
    site.controlPressure = clamp(Number(site.controlPressure || 0) + clamp(power / 90, 0.25, 3), -30, 30);
    site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), now + 8);
    if (!wasActive) {
      state.stats.resourceRaids = Number(state.stats.resourceRaids || 0) + 1;
      addEvent('site_conflict_started', `${site.name}: начался налёт. ${factionLabel(attackerFaction)} атакуют точку.`, {
        siteId: site.id,
        attackerFaction,
        attackPower: Number(power.toFixed(1))
      });
    } else if (now - Number(conflict.lastJoinEventHour || -999) >= 2) {
      conflict.lastJoinEventHour = now;
      addEvent('site_conflict_joined', `${site.name}: ${factionLabel(attackerFaction)} вступили в уже идущую схватку.`, {
        siteId: site.id,
        attackerFaction,
        attackPower: Number(power.toFixed(1))
      });
    }
    ensureSiteConflictTask(site);
    if (data.createSupport !== false) maybeCreateResourceSupportTask(site, 'raid');
    dirty = true;
    return conflict;
  }

  function conflictNearbyPower(site = {}, predicate = () => false) {
    const globalMap = getGlobalMap();
    let powerTotal = 0;
    for (const party of Object.values(state.parties)) {
      if (!party || party.destroyed || party.state === 'destroyed') continue;
      if (!predicate(party)) continue;
      const distKm = pointDistanceKm(site, party, globalMap);
      if (distKm > 7.5) continue;
      const proximity = 1 - Math.min(1, distKm / 7.5);
      powerTotal += partyPower(party) * proximity;
    }
    return powerTotal;
  }

  function finishSiteConflict(site = {}, result = 'repelled', details = {}) {
    const conflict = activeSiteConflict(site);
    const primaryFaction = siteConflictPrimaryFaction(site);
    if (conflict) {
      conflict.active = false;
      conflict.status = result;
      conflict.result = result;
      conflict.completedHour = Number(state.worldHour || 0);
      conflict.details = { ...(conflict.details || {}), ...details };
    }
    site.activeConflict = null;
    site.raidUntil = 0;
    site.lastRaidFaction = primaryFaction;
    finishActiveWorldTasks(
      task => task.siteId === site.id && ['defend_resource', 'retake_site'].includes(String(task.type || '')),
      'resolved',
      `site_conflict_${result}`,
      { conflictId: conflict?.id || siteConflictTaskKey(site), ...details }
    );
    dirty = true;
  }

  function captureSiteFromConflict(site = {}, conflict = activeSiteConflict(site)) {
    if (!site || !conflict) return;
    if (isCapitalProtectedSite(site)) {
      protectFactionCapitalSite(site);
      return;
    }
    const oldOwner = site.owner || 'neutral';
    const newOwner = siteConflictPrimaryFaction(site);
    const attackPower = Number(conflict.attackersPower || 0);
    const defensePower = Number(conflict.defendersPower || 0);
    const lossMul = clamp((attackPower - defensePower + 28) / 145, 0.08, 0.36);
    const lost = {};
    for (const [id, amount] of Object.entries(site.stockpile || {})) {
      const loss = Math.floor(Number(amount || 0) * lossMul);
      if (loss > 0) lost[id] = loss;
    }
    takeStockpile(site.stockpile || (site.stockpile = emptyStockpile()), lost);
    site.owner = newOwner;
    if (isJoinableWorldFaction(newOwner)) {
      site.workers = [];
      site.workSummary = '';
      dispatchSiteSupportFromCapital(state, site, newOwner, { reason: 'conflict_capture' });
    } else {
      site.workers = defaultSiteWorkers(site);
      site.workSummary = siteWorkSummary(site);
      site.supportDispatch = null;
    }
    site.security = clamp(22 + attackPower * 0.06, 16, 58);
    site.controlPressure = 0;
    site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), Number(state.worldHour || 0) + 18);
    if (isHarvestSite(site) || isProductionSite(site)) {
      const ownerGroup = factionGroup(newOwner);
      const workforceDelta = ownerGroup === 'old_klim' || ownerGroup === 'caravans'
        ? 8
        : ownerGroup === 'raiders'
          ? -10
          : -16;
      site.workforce = clamp(Number(site.workforce || 0) + workforceDelta, 0, 100);
      if (isHarvestSite(site)) site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) + (workforceDelta < 0 ? 3 : -2), 0, 100);
      site.resourceActivity = resourceActivityPercent(site, state.worldHour);
    }
    addEvent('site_control_changed', `${site.name} захвачена: ${factionLabel(newOwner)}.`, {
      siteId: site.id,
      oldOwner,
      newOwner,
      lost,
      attackers: siteConflictAttackers(site).map(row => ({ ...row })),
      attackPower: Number(attackPower.toFixed(1)),
      defensePower: Number(defensePower.toFixed(1))
    });
    finishSiteConflict(site, 'captured', { oldOwner, newOwner, lost });
  }

  function clearedSiteClaimFaction(faction = '') {
    const group = factionGroup(faction || '');
    return isJoinableWorldFaction(group) ? group : 'neutral';
  }

  function siteOwnerIsHostileToClearer(site = {}, clearerFaction = '') {
    const owner = factionGroup(site.owner || 'neutral');
    const clearer = clearedSiteClaimFaction(clearerFaction);
    if (!owner || owner === 'neutral' || owner === clearer) return false;
    if (owner === 'raiders' || owner === 'mutants' || owner === 'wild') return true;
    if (clearer === 'neutral') return false;
    return hostile(owner, clearer);
  }

  function resolveWorldZonesForClaimedSite(site = {}, details = {}) {
    const siteId = safeId(site.id || '', '');
    if (!siteId) return 0;
    return markWorldZonesLooted(zone => {
      if (!zone) return false;
      const zoneSiteId = safeId(zone.siteId || zone.sourceId || zone.details?.siteId || '', '');
      if (zoneSiteId === siteId) return true;
      const zoneLocationId = safeId(zone.locationId || zone.details?.locationId || '', '');
      return !!site.locationId && zoneLocationId === safeId(site.locationId || '', '');
    }, details);
  }

  function suppressHomeThreatPartiesForClaimedSite(site = {}, newOwner = 'neutral') {
    const siteId = safeId(site.id || '', '');
    if (!siteId) return 0;
    const now = Number(state.worldHour || 0);
    let changed = 0;
    Object.values(state.parties || {}).forEach(party => {
      if (!party || party.destroyed || party.state === 'destroyed') return;
      if (safeId(party.homeSiteId || '', '') !== siteId) return;
      if (!hostile(party.faction, newOwner) && factionGroup(party.faction) !== factionGroup(site.owner || 'neutral')) return;
      party.state = 'defeated';
      party.destroyed = true;
      party.destroyedAtHour = now;
      party.reformAtHour = Math.max(Number(party.reformAtHour || 0), now + Math.max(12, Number(party.respawnHours || 24)));
      party.engagedZoneId = '';
      party.engagedUntilHour = 0;
      clearPartyOnsiteState(party);
      party.members = Math.max(0, Math.floor(Number(party.members || 0) * 0.35));
      party.strength = Math.max(0, Math.round(Number(party.strength || 0) * 0.35));
      changed++;
    });
    if (changed) dirty = true;
    return changed;
  }

  function claimClearedSite(input = {}) {
    const siteId = safeId(input.siteId || '', '');
    const locationId = safeId(input.locationId || '', '');
    const site = (siteId && state.sites[siteId])
      || Object.values(state.sites || {}).find(row => row && locationId && safeId(row.locationId || '', '') === locationId)
      || null;
    if (!site) return { ok: false, reason: 'site_not_found' };
    if (isCapitalProtectedSite(site)) {
      protectFactionCapitalSite(site);
      dirty = true;
      save(true);
      return { ok: false, reason: 'capital_protected', siteId: site.id, owner: site.owner };
    }
    const oldOwner = factionGroup(site.owner || 'neutral');
    const newOwner = clearedSiteClaimFaction(input.playerFaction || input.worldFactionId || input.factionId || input.playerFactionId || '');
    if (!siteOwnerIsHostileToClearer(site, newOwner)) {
      return { ok: false, reason: 'owner_not_hostile', siteId: site.id, oldOwner, newOwner };
    }
    if (oldOwner === newOwner) {
      return { ok: false, reason: 'already_owned', siteId: site.id, oldOwner, newOwner };
    }

    const now = Number(state.worldHour || 0);
    const previousOwner = site.owner || 'neutral';
    site.owner = newOwner;
    site.activeConflict = null;
    site.raidUntil = 0;
    site.lastRaidFaction = '';
    site.controlPressure = 0;
    site.threatSuppressedUntil = Math.max(Number(site.threatSuppressedUntil || 0), now + 18);
    site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), now + 6);
    site.security = newOwner === 'neutral'
      ? clamp(Math.max(12, Number(site.security ?? siteDefaultSecurity(site)) * 0.45), 0, 100)
      : clamp(Math.max(24, Number(site.security ?? siteDefaultSecurity(site)) * 0.58), 0, 100);
    site.prosperity = newOwner === 'neutral'
      ? clamp(Number(site.prosperity || 0) * 0.72, 0, 100)
      : clamp(Math.max(18, Number(site.prosperity || 0)), 0, 100);
    if (isHarvestSite(site) || isProductionSite(site)) {
      site.workforce = newOwner === 'neutral'
        ? clamp(Math.max(16, Number(site.workforce || 0) * 0.52), 0, 100)
        : clamp(Math.max(32, Number(site.workforce || 0)), 0, 100);
      if (isHarvestSite(site)) site.resourceDepletion = clamp(Number(site.resourceDepletion || 0) + 2, 0, 100);
      site.resourceActivity = resourceActivityPercent(site, now);
    }
    if (isJoinableWorldFaction(newOwner)) {
      site.workers = [];
      site.workSummary = '';
      dispatchSiteSupportFromCapital(state, site, newOwner, { reason: 'player_cleared_site' });
    } else {
      site.workers = defaultSiteWorkers(site);
      site.workSummary = siteWorkSummary(site);
      site.supportDispatch = null;
    }
    resolveWorldZonesForClaimedSite(site, {
      reason: 'player_cleared_site',
      oldOwner: previousOwner,
      newOwner,
      playerId: safeId(input.playerId || input.characterId || '', ''),
      playerName: safeMemberName(input.playerName || '', '')
    });
    suppressHomeThreatPartiesForClaimedSite(site, newOwner);
    finishActiveWorldTasks(
      task => task.siteId === site.id && ['clear_lair', 'defend_resource', 'retake_site'].includes(String(task.type || '')),
      'completed',
      'player_claimed_site',
      {
        siteId: site.id,
        oldOwner: previousOwner,
        newOwner,
        playerId: safeId(input.playerId || input.characterId || '', '')
      }
    );
    addEvent('site_player_claimed', `${site.name} claimed by ${factionLabel(newOwner)} after clearing.`, {
      siteId: site.id,
      oldOwner: previousOwner,
      newOwner,
      playerId: safeId(input.playerId || input.characterId || '', ''),
      playerName: safeMemberName(input.playerName || '', '')
    });
    dirty = true;
    save(true);
    return {
      ok: true,
      siteId: site.id,
      locationId: site.locationId || '',
      oldOwner: previousOwner,
      newOwner,
      ownerLabel: factionLabel(newOwner)
    };
  }

  function repelSiteConflict(site = {}, conflict = activeSiteConflict(site)) {
    if (!site || !conflict) return;
    const pressureDamage = clamp(Number(conflict.progress || 0) / 18, 0, 0.18);
    const lost = {};
    if (pressureDamage > 0) {
      for (const [id, amount] of Object.entries(site.stockpile || {})) {
        const loss = Math.floor(Number(amount || 0) * pressureDamage);
        if (loss > 0) lost[id] = loss;
      }
      takeStockpile(site.stockpile || (site.stockpile = emptyStockpile()), lost);
    }
    site.security = clamp(Number(site.security ?? siteDefaultSecurity(site)) + 3, 0, 100);
    site.danger = clamp(Number(site.danger || 0) - 0.18, 0, 5);
    site.controlPressure = clamp(Number(site.controlPressure || 0) - 5, -30, 30);
    site.threatSuppressedUntil = Math.max(Number(site.threatSuppressedUntil || 0), Number(state.worldHour || 0) + 8);
    state.stats.resourceRaidsRepelled = Number(state.stats.resourceRaidsRepelled || 0) + 1;
    addEvent('site_conflict_repelled', `${site.name}: налёт отбили.`, {
      siteId: site.id,
      attackers: siteConflictAttackers(site).map(row => ({ ...row })),
      lost,
      attackPower: Number(Number(conflict.attackersPower || 0).toFixed(1)),
      defensePower: Number(Number(conflict.defendersPower || 0).toFixed(1))
    });
    finishSiteConflict(site, 'repelled', { lost });
  }

  function resolveSiteConflicts(hours) {
    const elapsed = Math.max(0, Number(hours || 0));
    const now = Number(state.worldHour || 0);
    for (const site of Object.values(state.sites)) {
      if (isCapitalProtectedSite(site)) {
        protectFactionCapitalSite(site);
        site.activeConflict = null;
        site.raidUntil = 0;
        continue;
      }
      const conflict = activeSiteConflict(site);
      if (!conflict) {
        if (site && Number(site.raidUntil || 0) <= now) site.raidUntil = 0;
        continue;
      }
      ensureSiteConflictTask(site);
      const attackers = siteConflictAttackers(site);
      if (!attackers.length) {
        finishSiteConflict(site, 'expired', {});
        continue;
      }
      const attackBase = attackers.reduce((sum, row) => {
        const age = Math.max(0, now - Number(row.firstHour || now));
        const stamina = clamp(1 - age / 96 * 0.25, 0.72, 1.08);
        return sum + Number(row.power || 0) * stamina;
      }, 0);
      const owner = factionGroup(site.owner || 'neutral');
      const nearbyAttackers = conflictNearbyPower(site, party => hostile(party.faction, owner));
      const nearbyDefenders = conflictNearbyPower(site, party => {
        const group = factionGroup(party.faction || '');
        return group === owner || relation(group, owner) > 20;
      });
      const defenseBase = clamp(site.security ?? siteDefaultSecurity(site), 0, 100) * 0.72
        + clamp(site.protectionLevel || 0, 0, 100) * 0.7
        + Number(site.workforce || 0) * 0.18
        + nearbyDefenders;
      const attackPower = attackBase + nearbyAttackers * 0.9;
      const defensePower = defenseBase;
      conflict.attackersPower = attackPower;
      conflict.defendersPower = defensePower;
      const delta = ((attackPower - defensePower) / 70) * elapsed;
      conflict.progress = clamp(Number(conflict.progress || 0) + delta, -8, 16);
      conflict.updatedHour = now;
      site.raidUntil = Math.max(Number(site.raidUntil || 0), Number(conflict.expiresHour || 0));
      site.controlPressure = clamp(Number(site.controlPressure || 0) + delta * 0.7, -30, 30);
      site.security = clamp(Number(site.security ?? siteDefaultSecurity(site)) - Math.max(0, delta) * 1.6 + Math.max(0, -delta) * 0.9, 0, 100);
      if (site.security < 30) site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), now + 8);
      const conflictAge = now - Number(conflict.startedHour || now);
      const expired = Number(conflict.expiresHour || 0) <= now || conflictAge > 36;
      if (conflictAge >= 1.25 && (conflict.progress >= 10 || (site.security <= 8 && attackPower > defensePower * 0.82) || (expired && conflict.progress > 1.5 && attackPower > defensePower * 0.72))) {
        captureSiteFromConflict(site, conflict);
      } else if (conflictAge >= 1.25 && (conflict.progress <= -4 || (expired && defensePower >= attackPower * 0.82))) {
        repelSiteConflict(site, conflict);
      }
      site.resourceActivity = resourceActivityPercent(site, state.worldHour);
      dirty = true;
    }
  }

  function updateSiteControl(hours) {
    const parties = Object.values(state.parties).filter(p => p && !p.destroyed && p.state !== 'destroyed');
    const globalMap = getGlobalMap();
    for (const site of Object.values(state.sites)) {
      if (!site || !isContestedWorldSite(site)) continue;
      site.security = siteDefaultSecurity(site);
      let hostilePower = 0;
      let friendlyPower = 0;
      let strongestHostile = null;
      for (const party of parties) {
        const distKm = pointDistanceKm(site, party, globalMap);
        if (distKm > 6.5) continue;
        const proximity = 1 - Math.min(1, distKm / 6.5);
        const power = (Number(party.strength || 0) + Number(party.members || 0) * 4) * proximity;
        if (hostile(party.faction, site.owner)) {
          hostilePower += power;
          if (!strongestHostile || power > strongestHostile.power) strongestHostile = { faction: party.faction, power, party };
        } else if (factionGroup(party.faction) === factionGroup(site.owner) || relation(party.faction, site.owner) > 20) {
          friendlyPower += power;
        }
      }
      const pressure = (hostilePower - friendlyPower) / 90 * Math.max(0, hours);
      if (Math.abs(pressure) < 0.01) {
        site.controlPressure = Number(site.controlPressure || 0) * Math.pow(0.96, Math.max(0, hours));
        continue;
      }
      site.controlPressure = clamp(Number(site.controlPressure || 0) + pressure, -30, 30);
      site.security = clamp(Number(site.security || 0) - Math.max(0, pressure) * 2.5 + Math.max(0, -pressure) * 1.4, 0, 100);
      if (strongestHostile && site.controlPressure > 7 && site.security < 36) {
        joinSiteConflict(site, strongestHostile.faction, {
          source: 'control',
          power: strongestHostile.power,
          partyId: strongestHostile.party?.id || '',
          durationHours: site.controlPressure > 11 ? 24 : 18
        });
      }
      dirty = true;
    }
  }

  function outpostProtectionFor(site = {}) {
    if (!site || !isHarvestSite(site)) return null;
    const globalMap = getGlobalMap();
    let best = null;
    let total = 0;
    for (const candidate of Object.values(state.sites)) {
      if (!candidate || candidate.id === site.id) continue;
      if (candidate.type !== 'outpost' && candidate.type !== 'settlement' && candidate.type !== 'production') continue;
      const rel = relation(candidate.owner, site.owner);
      const sameSide = factionGroup(candidate.owner) === factionGroup(site.owner) || rel >= 20 || site.owner === 'neutral';
      if (!sameSide || hostile(candidate.owner, site.owner)) continue;
      const radius = candidate.type === 'settlement' ? 48 : candidate.type === 'production' ? 28 : 34;
      const distKm = pointDistanceKm(site, candidate, globalMap);
      if (distKm > radius) continue;
      const proximity = 1 - distKm / radius;
      const power = clamp(Number(candidate.security || siteDefaultSecurity(candidate)), 0, 100) * proximity * (candidate.type === 'settlement' ? 0.55 : candidate.type === 'production' ? 0.65 : 1);
      total += power;
      if (!best || power > best.power) best = { site: candidate, power, distKm };
    }
    if (!best) return null;
    return {
      site: best.site,
      level: clamp(total, 0, 100),
      distKm: best.distKm
    };
  }

  function applyOutpostProtection(hours) {
    for (const site of Object.values(state.sites)) {
      if (!site || !isHarvestSite(site)) continue;
      const protection = outpostProtectionFor(site);
      const prevProtector = String(site.protectedBySiteId || '');
      if (protection) {
        site.protectionLevel = Number(protection.level.toFixed(1));
        site.protectedBySiteId = protection.site.id;
        site.security = clamp(Number(site.security || siteDefaultSecurity(site)) + (0.18 + protection.level / 420) * hours, 0, 100);
        site.workforce = clamp(Number(site.workforce || 0) + (0.06 + protection.level / 1200) * hours, 0, 100);
        site.danger = clamp(Number(site.danger || 0) - protection.level * 0.0008 * hours, 0, 5);
        if (prevProtector !== protection.site.id && Number(state.worldHour || 0) - Number(site.lastProtectionEventHour || -999) >= 8) {
          site.lastProtectionEventHour = state.worldHour;
          addEvent('site_protected', `${protection.site.name} прикрывает ${site.name}.`, {
            siteId: site.id,
            protectorId: protection.site.id,
            protection: site.protectionLevel
          });
        }
      } else {
        site.protectionLevel = clamp(Number(site.protectionLevel || 0) - hours * 3, 0, 100);
        site.protectedBySiteId = '';
        if (site.type === 'resource') {
          site.security = clamp(Number(site.security || siteDefaultSecurity(site)) - Number(site.danger || 0) * 0.06 * hours, 0, 100);
        }
      }
      site.resourceActivity = resourceActivityPercent(site, state.worldHour);
      dirty = true;
    }
  }

  function deterministicRoll(key = '', salt = 0) {
    const text = String(key || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const raw = Math.sin((Number(state.worldHour || 0) + salt) * 12.9898 + Math.abs(hash) * 0.0007) * 43758.5453;
    return raw - Math.floor(raw);
  }

  function chooseRaidFaction(site = {}) {
    const nearestRaider = nearestParty(site, party => String(party.kind || '') === 'raider')?.party;
    const nearestMonster = nearestParty(site, party => String(party.kind || '') === 'monster')?.party;
    const raiderPressure = nearestRaider ? Math.max(0, 1 - pointDistanceKm(site, nearestRaider, getGlobalMap()) / 52) : 0;
    const monsterPressure = nearestMonster ? Math.max(0, 1 - pointDistanceKm(site, nearestMonster, getGlobalMap()) / 42) : 0;
    let preferred = Number(site.danger || 0) >= 3 ? 'raiders' : 'wild';
    if (raiderPressure >= monsterPressure && raiderPressure > 0.15) preferred = 'raiders';
    else if (monsterPressure > 0.12) preferred = factionGroup(nearestMonster.faction || 'wild');
    const owner = factionGroup(site.owner || 'neutral');
    const candidates = [preferred, 'raiders', 'mutants', 'wild', 'old_klim', 'caravans'];
    return candidates.find(faction => faction && factionGroup(faction) !== owner && hostile(faction, site.owner)) || preferred;
  }

  function resolveResourceRaids(hours) {
    for (const site of Object.values(state.sites)) {
      if (!site || (!isHarvestSite(site) && !isProductionSite(site))) continue;
      if (Number(site.threatSuppressedUntil || 0) > Number(state.worldHour || 0)) continue;
      site.raidCheckProgress = Number(site.raidCheckProgress || 0) + hours;
      if (site.raidCheckProgress < 6) continue;
      const checks = Math.floor(site.raidCheckProgress / 6);
      site.raidCheckProgress -= checks * 6;
      for (let i = 0; i < checks; i++) {
        if (Number(state.worldHour || 0) - Number(site.lastRaidHour || -999) < 12) continue;
        const danger = clamp(site.danger || 0, 0, 5);
        const security = clamp(site.security ?? siteDefaultSecurity(site), 0, 100);
        const protection = clamp(site.protectionLevel || 0, 0, 100);
        const stockValue = Math.min(40, stockpileTotal(site.stockpile || {}) / 8);
        const chance = clamp(0.08 + danger * 0.045 + (100 - security) * 0.0018 + stockValue * 0.002 - protection * 0.0018, 0.015, 0.42);
        if (deterministicRoll(`${site.id}:raid:${checks}:${i}`, i + checks) > chance) continue;
        const attackerFaction = chooseRaidFaction(site);
        const attackPower = 18 + danger * 14 + deterministicRoll(`${site.id}:power`, i) * 32;
        const defensePower = security * 0.7 + protection * 0.9 + Number(site.workforce || 0) * 0.22;
        site.lastRaidHour = state.worldHour;
        site.lastRaidFaction = attackerFaction;
        if (attackPower > defensePower || activeSiteConflict(site)) {
          joinSiteConflict(site, attackerFaction, {
            source: 'raid',
            power: attackPower,
            durationHours: 14,
            details: {
              attackPower: Number(attackPower.toFixed(1)),
              defensePower: Number(defensePower.toFixed(1))
            }
          });
        } else {
          site.security = clamp(security + 1.5, 0, 100);
          site.danger = clamp(Number(site.danger || 0) - 0.12, 0, 5);
          site.threatSuppressedUntil = Math.max(Number(site.threatSuppressedUntil || 0), Number(state.worldHour || 0) + 8);
          state.stats.resourceRaidsRepelled = Number(state.stats.resourceRaidsRepelled || 0) + 1;
          addEvent('resource_raid_repelled', `${site.name}: налёт отбили благодаря охране${site.protectedBySiteId ? ' и аванпосту' : ''}.`, {
            siteId: site.id,
            attackerFaction,
            attackPower: Number(attackPower.toFixed(1)),
            defensePower: Number(defensePower.toFixed(1))
          });
          finishActiveWorldTasks(
            task => task.type === 'defend_resource' && task.siteId === site.id && (!task.targetFaction || task.targetFaction === attackerFaction),
            'resolved',
            'raid_repelled',
            { attackerFaction }
          );
        }
        site.resourceActivity = resourceActivityPercent(site, state.worldHour);
        dirty = true;
      }
    }
  }

  function reformDestroyedParties() {
    const defaultsById = defaultParties();
    for (const party of Object.values(state.parties)) {
      if (!party || (!party.destroyed && !['destroyed', 'forming'].includes(String(party.state || '').toLowerCase()))) continue;
      const defaults = defaultsById[party.id] || {};
      if (party.respawnDisabled || (party.dynamic && !defaultsById[party.id])) continue;
      const respawnHours = Number(party.respawnHours || defaults.respawnHours || PARTY_REFORM_HOURS[party.kind] || 24);
      const destroyedAt = Number.isFinite(Number(party.destroyedAtHour)) ? Number(party.destroyedAtHour) : Number(state.worldHour || 0);
      const reformAt = Number.isFinite(Number(party.reformAtHour)) ? Number(party.reformAtHour) : destroyedAt + respawnHours;
      party.reformAtHour = reformAt;
      const home = state.sites[party.homeSiteId || defaults.homeSiteId || 'settlement'] || state.sites.settlement;
      const now = Number(state.worldHour || 0);
      const visibleHours = Math.min(PARTY_REFORM_VISIBLE_MAX_HOURS, Math.max(1, respawnHours * 0.25));
      if (now < reformAt) {
        if (now >= reformAt - visibleHours && String(party.state || '').toLowerCase() !== 'forming') {
          party.state = 'forming';
          party.x = Number(home?.x || defaults.x || party.x || 0);
          party.y = Number(home?.y || defaults.y || party.y || 0);
          party.route = [];
          party.routeIndex = 0;
          party.targetPartyId = '';
          party.destinationSiteId = home?.id || party.homeSiteId || defaults.homeSiteId || '';
          party.formationStartedHour = now;
          addEvent('party_forming', `${party.name} собирает новый состав на базе ${home?.name || home?.id || ''}.`, {
            partyId: party.id,
            siteId: home?.id || '',
            reformAtHour: reformAt
          });
          dirty = true;
        }
        continue;
      }
      party.destroyed = false;
      const kind = String(defaults.kind || party.kind || '').toLowerCase();
      party.state = String(defaults.state || (kind === 'raider' ? 'hunting' : kind === 'monster' ? 'roaming' : 'moving')).slice(0, 32);
      party.x = Number(home?.x || defaults.x || party.x || 0);
      party.y = Number(home?.y || defaults.y || party.y || 0);
      party.strength = clamp(defaults.strength || party.strength || 10, 1, 500);
      party.members = clamp(defaults.members || party.members || 1, 1, 200);
      party.cargo = {};
      party.route = Array.isArray(defaults.route) && defaults.route.length ? defaults.route.slice() : (Array.isArray(party.route) ? party.route : []);
      party.routeIndex = 0;
      clearCaravanStaging(party);
      clearPartyOnsiteState(party);
      party.targetPartyId = '';
      party.nextDecisionHour = 0;
      clearPartyInfrastructureRoute(party);
      party.recoverUntilHour = 0;
      party.lastSiteId = home?.id || party.homeSiteId || '';
      party.destinationSiteId = String(defaults.destinationSiteId || party.destinationSiteId || '').slice(0, 64);
      delete party.destroyedAtHour;
      delete party.reformAtHour;
      delete party.formationStartedHour;
      chooseNextDestination(party);
      addEvent('party_reformed', `${party.name} снова вышел на маршрут.`, {
        partyId: party.id,
        siteId: home?.id || ''
      });
      dirty = true;
    }
  }

  function tickWorldSimStep(stepHours = 0) {
    const hours = Math.max(0, Number(stepHours || 0));
    if (hours <= 0) return;
    state.worldHour = Number(Number(state.worldHour || 0) + hours);
    maintainDistrictInterestSites(hours);
    reformDestroyedParties();
    maintainWorldZoneBattles(hours);
    partyMovementTracks = new Map();
    Object.values(state.parties).forEach(party => recordPartyMovementPoint(party, party, 0));
    Object.values(state.parties).forEach(party => moveParty(party, hours));
    Object.values(state.parties).forEach(party => recordPartyMovementPoint(party, party, 1));
    updatePlayerAmbushInterceptions();
    updateCaravanThreats(hours);
    updatePatrolThreats(hours);
    updateVisibleLairs(hours);
    resolvePartyContacts();
    completeJoinedPatrolTasks();
    updateSiteControl(hours);
    applyOutpostProtection(hours);
    resolveResourceRaids(hours);
    resolveSiteConflicts(hours);
    produceAtResourceSites(hours);
    createResourceExportCaravans(hours);
    advanceFactionProduction(hours);
    produceAtSettlements(hours);
    planFactionProduction(hours);
    restockRetailMarkets();
    createProductionExportCaravans(hours);
    consumeSettlementSupplies(hours);
    createSurplusTradeCaravans(hours);
    expireWorldTasks();
  }

  function tick(now = Date.now(), opts = {}) {
    const last = Number(state.lastTickAt || now);
    const elapsedMs = Math.max(0, Number(now || Date.now()) - last);
    const hours = Number.isFinite(Number(opts.hours))
      ? Math.max(0, Number(opts.hours))
      : elapsedMs / gameDayRealMs * 24;
    state.lastTickAt = now;
    if (hours <= 0.001 && !opts.force) return false;
    const totalHours = Math.max(0, Number(hours || 0));
    const rawSteps = Math.max(1, Math.ceil(totalHours / WORLD_SIM_MAX_STEP_HOURS));
    const steps = Math.min(WORLD_SIM_MAX_CATCHUP_STEPS, rawSteps);
    const stepHours = totalHours / steps;
    for (let i = 0; i < steps; i += 1) tickWorldSimStep(stepHours);
    save(false);
    return true;
  }

  function syncGlobalMap(globalMap = getGlobalMap()) {
    const nodes = Array.isArray(globalMap.nodes) ? globalMap.nodes : [];
    nodes.forEach(node => {
      const id = safeId(node?.id || '');
      if (!id) return;
      const site = state.sites[id];
      if (!site) return;
      const point = globalMapCellCenter({ x: Number(node.x || site.x || 0), y: Number(node.y || site.y || 0) }, globalMap);
      site.x = point.x;
      site.y = point.y;
      if (node.kind) site.type = node.kind === 'settlement' ? 'settlement' : site.type;
      if (node.note) site.note = String(node.note || '').slice(0, 240);
    });
    maintainDistrictInterestSites(0);
    dirty = true;
    save(false);
  }

  function mergeStockRows(rows) {
    const out = [];
    const byId = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const id = safeId(row?.id || '');
      if (!id || (itemIds.size && !itemIds.has(id))) return;
      const qty = Math.max(0, Math.floor(Number(row.qty || 0)));
      if (qty <= 0) return;
      const price = Math.max(1, Math.round(Number(row.price || 1)));
      if (byId.has(id)) byId.get(id).qty += qty;
      else {
        const next = { id, qty, price };
        byId.set(id, next);
        out.push(next);
      }
    });
    return out;
  }

  function traderItemSupplyKeys(itemId = '') {
    const id = safeId(itemId || '');
    const map = {
      water: ['water'],
      oil: ['oil'],
      wood: ['wood'],
      scrap: ['scrap'],
      ore: ['ore'],
      chemicals: ['chemicals'],
      medicine: ['medicine'],
      electronics: ['electronics'],
      ammoParts: ['ammoParts'],
      food: ['food'],
      weaponParts: ['weaponParts'],
      repairKit: ['repairKit', 'scrap', 'electronics'],
      handPump: ['handPump', 'scrap', 'electronics'],
      pickaxe: ['pickaxe', 'scrap'],
      axe: ['axe', 'scrap', 'wood'],
      ammo9: ['ammo9', 'ammoParts'],
      ammo556: ['ammo556', 'ammoParts'],
      shotgunShell: ['shotgunShell', 'ammoParts'],
      rocketAmmo: ['rocketAmmo', 'ammoParts', 'electronics'],
      napalm: ['napalm', 'oil', 'chemicals'],
      pistol: ['scrap', 'ammoParts'],
      rifle: ['weaponParts', 'scrap', 'ammoParts'],
      assaultRifle: ['weaponParts', 'scrap', 'ammoParts'],
      machineGun: ['weaponParts', 'scrap', 'ammoParts'],
      shotgun: ['weaponParts', 'scrap', 'ammoParts'],
      rocketLauncher: ['weaponParts', 'scrap', 'electronics'],
      laserPistol: ['electronics'],
      plasmaRifle: ['electronics', 'chemicals'],
      flamethrower: ['oil', 'scrap'],
      energyCell: ['energyCell', 'electronics'],
      stim: ['medicine'],
      medkit: ['medicine'],
      doctorBag: ['medicine', 'electronics'],
      antibiotics: ['medicine', 'chemicals'],
      leather: ['scrap'],
      metalArmor: ['scrap'],
      ballisticVest: ['scrap', 'ammoParts'],
      combatArmor: ['scrap', 'electronics'],
      hazmatSuit: ['chemicals'],
      heavyArmor: ['scrap', 'electronics'],
      energySuit: ['electronics', 'chemicals'],
      helmet: ['scrap'],
      tacticalHelmet: ['scrap', 'electronics'],
      assaultHelmet: ['scrap', 'electronics'],
      boots: ['boots', 'scrap'],
      scoutBoots: ['scoutBoots', 'scrap'],
      reinforcedBoots: ['reinforcedBoots', 'scrap'],
      backpack: ['backpack', 'scrap']
    };
    return map[id] || [];
  }

  function nearbyResourceAccess(site = {}) {
    const globalMap = getGlobalMap();
    const owner = site.owner || 'neutral';
    const outputs = {};
    let friendlyPower = 0;
    let hostilePower = 0;
    let friendlySites = 0;
    let hostileSites = 0;
    for (const other of Object.values(state.sites)) {
      if (!other || other.id === site.id) continue;
      if (other.type !== 'resource' && other.type !== 'pointOfInterest') continue;
      const distance = pointDistanceKm(site, other, globalMap);
      if (distance > 95) continue;
      const proximity = clamp(1 - distance / 95, 0.05, 1);
      const activity = clamp(resourceActivityPercent(other, state.worldHour) / 100, 0, 1.8);
      const output = other.output && typeof other.output === 'object' ? other.output : {};
      const power = proximity * activity * Math.max(1, stockpileTotal(output));
      if (factionGroup(other.owner) === factionGroup(owner) || relation(other.owner, owner) > 20) {
        friendlyPower += power;
        friendlySites += 1;
        for (const [id, amount] of Object.entries(output)) {
          outputs[id] = Number(outputs[id] || 0) + Math.max(0, Number(amount || 0)) * proximity * activity;
        }
      } else if (hostile(other.owner, owner)) {
        hostilePower += power;
        hostileSites += 1;
      }
    }
    return {
      outputs,
      friendlyPower: Number(friendlyPower.toFixed(2)),
      hostilePower: Number(hostilePower.toFixed(2)),
      friendlySites,
      hostileSites
    };
  }

  function siteMarketIntel(site = {}) {
    if (!site) {
      return {
        state: 'unknown',
        stateLabel: 'нет данных',
        scarcity: 0,
        abundance: 0,
        priceMultiplier: 1,
        quantityMultiplier: 1,
        capsMultiplier: 1,
        resourceAccess: { outputs: {}, friendlyPower: 0, hostilePower: 0, friendlySites: 0, hostileSites: 0 }
      };
    }
    const now = Number(state.worldHour || 0);
    const pile = site.stockpile || {};
    const totalStock = stockpileTotal(pile);
    const disrupted = Number(site.supplyDisruptedUntil || 0) > now;
    const recentlySupplied = Number(site.marketSupplyBoostUntil || 0) > now;
    const prosperity = clamp(Number(site.prosperity || 0), 0, 100);
    const security = clamp(
      Number.isFinite(Number(site.security)) ? Number(site.security) : siteDefaultSecurity(site),
      0,
      100
    );
    const control = siteControlIntel(site);
    const resourceAccess = nearbyResourceAccess(site);
    const lowStockPressure = clamp((38 - totalStock) * 1.1, 0, 42);
    const securityPressure = clamp((42 - security) * 0.75, 0, 36);
    const controlPressure = clamp(
      (control.state === 'critical' ? 28 : control.state === 'contested' ? 18 : control.state === 'threatened' ? 10 : 0)
      + Math.max(0, resourceAccess.hostilePower - resourceAccess.friendlyPower) * 0.35,
      0,
      42
    );
    const disruptionPressure = disrupted ? 34 : 0;
    const prosperityBuffer = prosperity * 0.14;
    const abundance = clamp(
      (recentlySupplied ? 24 : 0)
      + clamp(totalStock / 2.2, 0, 34)
      + clamp(resourceAccess.friendlyPower * 0.45, 0, 26)
      + prosperity * 0.12,
      0,
      100
    );
    const scarcity = clamp(
      lowStockPressure
      + securityPressure
      + controlPressure
      + disruptionPressure
      - prosperityBuffer
      - (recentlySupplied ? 10 : 0),
      0,
      100
    );
    let stateKey = 'stable';
    if (disrupted || scarcity >= 62) stateKey = 'blockade';
    else if (scarcity >= 34) stateKey = 'shortage';
    else if (abundance >= 58 && scarcity < 18) stateKey = 'supplied';
    const priceMultiplier = clamp(1 + scarcity * 0.011 - abundance * 0.0012, 0.94, 2.45);
    const quantityMultiplier = clamp(1 - scarcity * 0.008 + abundance * 0.0012, 0.18, 1.05);
    const capsMultiplier = clamp(1 - scarcity * 0.0045 + abundance * 0.0015 + prosperity * 0.0008, 0.42, 1.22);
    const stateLabel = {
      stable: 'рынок стабилен',
      supplied: 'рынок снабжен',
      shortage: 'дефицит',
      blockade: 'снабжение нарушено',
      unknown: 'нет данных'
    }[stateKey] || 'рынок стабилен';
    return {
      state: stateKey,
      stateLabel,
      scarcity: Math.round(scarcity),
      abundance: Math.round(abundance),
      priceMultiplier: Number(priceMultiplier.toFixed(3)),
      quantityMultiplier: Number(quantityMultiplier.toFixed(3)),
      capsMultiplier: Number(capsMultiplier.toFixed(3)),
      resourceAccess,
      disrupted,
      recentlySupplied
    };
  }

  function applyItemMarket(row = {}, site = {}, market = siteMarketIntel(site)) {
    const keys = traderItemSupplyKeys(row.id);
    let localSupply = 0;
    let routeSupply = 0;
    keys.forEach(key => {
      localSupply += Number(site?.stockpile?.[key] || 0);
      routeSupply += Number(market?.resourceAccess?.outputs?.[key] || 0);
    });
    const specificSupply = localSupply + routeSupply * 0.65;
    const shortageMul = keys.length && specificSupply < 8 ? 1.22 + (8 - specificSupply) * 0.045 : 1;
    const abundanceMul = keys.length && specificSupply > 32 ? 0.96 : 1;
    const itemQtyMul = keys.length && specificSupply < 8 ? 0.58 : (keys.length && specificSupply > 32 ? 1.02 : 1);
    return {
      ...row,
      qty: Math.max(1, Math.floor(Number(row.qty || 0) * Number(market.quantityMultiplier || 1) * itemQtyMul)),
      price: Math.max(1, Math.round(Number(row.price || 1) * Number(market.priceMultiplier || 1) * shortageMul * abundanceMul))
    };
  }

  function traderStockUnitCost(itemId = '') {
    const id = safeId(itemId || '');
    if (['water', 'oil', 'wood', 'scrap', 'ore'].includes(id)) return 1;
    if (['ammo9', 'ammo556', 'shotgunShell', 'energyCell', 'napalm'].includes(id)) return 0.22;
    if (id === 'rocketAmmo') return 1.6;
    if (id === 'stim') return 0.65;
    if (id === 'medkit') return 1.6;
    if (id === 'doctorBag') return 3.4;
    if (id === 'antibiotics') return 0.9;
    if (['repairKit', 'pickaxe', 'axe', 'handPump', 'boots', 'scoutBoots', 'reinforcedBoots', 'helmet', 'backpack'].includes(id)) return 3.5;
    if (['pistol', 'knife'].includes(id)) return 5.5;
    if (['rifle', 'shotgun', 'laserPistol'].includes(id)) return 9;
    if (['assaultRifle', 'flamethrower', 'plasmaRifle'].includes(id)) return 14;
    if (['machineGun', 'rocketLauncher'].includes(id)) return 20;
    if (['leather', 'metalArmor', 'ballisticVest', 'hazmatSuit'].includes(id)) return 8;
    if (['combatArmor', 'heavyArmor', 'energySuit'].includes(id)) return 18;
    if (['tacticalHelmet', 'assaultHelmet'].includes(id)) return 7;
    return 1;
  }

  function backedTraderQuantity(row = {}, site = {}) {
    const requested = Math.max(0, Math.floor(Number(row.qty || 0)));
    if (requested <= 0) return 0;
    const keys = traderItemSupplyKeys(row.id);
    if (!keys.length) return requested;
    const previewStock = clone(site.stockpile || {});
    const fulfilled = consumeStockpileForTraderItem(previewStock, row.id, requested);
    return clamp(Math.floor(fulfilled + 0.0001), 0, requested);
  }

  function traderSite(profileId = '', context = {}) {
    const contextSiteId = safeId(context.siteId || context.worldSiteId || '');
    if (contextSiteId && state.sites[contextSiteId]) return state.sites[contextSiteId];
    const id = String(profileId || context.traderProfile || context.tradeProfile || '').trim();
    for (const site of Object.values(state.sites)) {
      if (Array.isArray(site.traderProfiles) && site.traderProfiles.includes(id)) return site;
    }
    if (String(context.locationId || '') && state.sites[context.locationId]) return state.sites[context.locationId];
    return null;
  }

  function consumeStockpileForTraderItem(stock = {}, itemId = '', qty = 0) {
    const id = safeId(itemId || '');
    let remaining = Math.max(0, Number(qty || 0));
    if (!id || remaining <= 0) return 0;

    const direct = Math.min(Math.max(0, Number(stock[id] || 0)), remaining);
    if (direct > 0) {
      stock[id] = Math.max(0, Number(stock[id] || 0) - direct);
      remaining -= direct;
    }
    if (remaining <= 0) return qty;

    const recipe = productionInputRecipe(id);
    if (recipe) {
      let craftable = remaining;
      for (const [key, need] of Object.entries(recipe)) {
        const perUnit = Math.max(0, Number(need || 0));
        if (perUnit <= 0) continue;
        craftable = Math.min(craftable, Math.max(0, Number(stock[key] || 0)) / perUnit);
      }
      craftable = Math.max(0, Number(craftable.toFixed(3)));
      if (craftable > 0) {
        for (const [key, need] of Object.entries(recipe)) {
          stock[key] = Math.max(0, Number(stock[key] || 0) - Math.max(0, Number(need || 0)) * craftable);
        }
        remaining -= craftable;
      }
    }
    if (remaining <= 0) return qty;

    const keys = traderItemSupplyKeys(id).filter(key => key !== id);
    const unitCost = traderStockUnitCost(id);
    let needed = remaining * unitCost;
    for (const key of keys) {
      if (needed <= 0) break;
      const take = Math.min(Math.max(0, Number(stock[key] || 0)), needed);
      if (take <= 0) continue;
      stock[key] = Math.max(0, Number(stock[key] || 0) - take);
      needed -= take;
    }
    return Math.max(0, Number(qty || 0) - needed / Math.max(0.001, unitCost));
  }

  function consumeTraderStock(profileId = '', rows = [], context = {}) {
    const site = traderSite(profileId, context);
    const soldRows = mergeStockRows(rows);
    if (!site || !soldRows.length) return { ok: false, consumed: 0, siteId: site?.id || '' };
    const stock = site.stockpile || (site.stockpile = emptyStockpile());
    let consumed = 0;
    for (const row of soldRows) {
      consumed += consumeStockpileForTraderItem(stock, row.id, row.qty);
    }
    if (consumed > 0) {
      site.resourceActivity = resourceActivityPercent(site, state.worldHour);
      dirty = true;
      save(false);
    }
    return { ok: consumed > 0, consumed, siteId: site.id };
  }

  function receiveTraderStock(profileId = '', rows = [], context = {}) {
    const site = traderSite(profileId, context);
    const boughtRows = mergeStockRows(rows);
    if (!site || !boughtRows.length) return { ok: false, received: 0, siteId: site?.id || '' };
    const stock = site.stockpile || (site.stockpile = emptyStockpile());
    let received = 0;
    for (const row of boughtRows) {
      const qty = Math.max(0, Number(row.qty || 0));
      if (!row.id || qty <= 0) continue;
      stock[row.id] = Math.max(0, Number(stock[row.id] || 0) + qty);
      received += qty;
    }
    if (received > 0) {
      site.resourceActivity = resourceActivityPercent(site, state.worldHour);
      dirty = true;
      save(false);
    }
    return { ok: received > 0, received, siteId: site.id };
  }

  function retailMarketCapsTarget(site = {}, market = {}, intel = siteMarketIntel(site)) {
    let caps = Math.floor(Math.max(0, Number(market.baseCaps || 0)) * Number(intel.capsMultiplier || 1));
    if (intel.recentlySupplied) caps += 60;
    caps += Math.min(180, Math.floor(Number(site.prosperity || 0) * 1.2));
    return clamp(caps, 0, 999999);
  }

  function refreshSiteRetailDemand(site = {}) {
    if (!site) return {};
    const demand = {};
    const covered = new Set();
    for (const market of Object.values(site.retailMarkets || {})) {
      const stock = normalizeMarketStockRows(market?.stock || []);
      if (market?.profileId) covered.add(market.profileId);
      for (const planRow of normalizeTraderPlanRows(market?.plan || [])) {
        const current = Number(stock.find(row => row.id === planRow.id)?.qty || 0);
        addEconomyAmount(demand, planRow.id, Math.max(0, planRow.shelfTarget - current));
      }
    }
    // Рынок торговца заводится лишь при обращении игрока, а его ключ включает
    // роль конкретного НПС и заранее неизвестен. Но спрос знать заранее можно:
    // берём его прямо из авторского профиля лавки. Иначе фракция не знала, что
    // везти, пока к торговцу кто-нибудь не подойдёт, и полки стояли пустыми.
    for (const profileId of Array.isArray(site.traderProfiles) ? site.traderProfiles : []) {
      if (covered.has(profileId)) continue;
      const profile = traderProfiles[profileId];
      if (!profile) continue;
      for (const planRow of normalizeTraderPlanRows(profile.stock || [])) {
        const inStore = Number(site.stockpile?.[planRow.id] || 0);
        addEconomyAmount(demand, planRow.id, Math.max(0, planRow.shelfTarget - inStore));
      }
    }
    site.retailDemand = compactStockpile(demand);
    return site.retailDemand;
  }

  function restockRetailMarket(site = {}, market = {}, force = false) {
    if (!site || !market?.key) return false;
    const now = Number(state.worldHour || 0);
    const pile = site.stockpile || (site.stockpile = emptyStockpile());
    const stock = normalizeMarketStockRows(market.stock || []);
    const plan = normalizeTraderPlanRows(market.plan || []);
    const urgent = plan.some(planRow => {
      const current = Number(stock.find(row => row.id === planRow.id)?.qty || 0);
      return current < planRow.shelfMin && Number(pile[planRow.id] || 0) >= 1;
    });
    if (!force && !urgent && now - Number(market.lastRestockHour || 0) < Number(market.restockHours || 24)) return false;
    const intel = siteMarketIntel(site);
    for (const planRow of plan) {
      const adjusted = applyItemMarket({ id: planRow.id, qty: planRow.shelfTarget, price: planRow.price }, site, intel);
      const target = Math.max(planRow.shelfMin, Math.floor(Number(adjusted.qty || 0)));
      const max = Math.max(target, Math.floor(Number(planRow.shelfMax || target) * Number(intel.quantityMultiplier || 1)));
      let row = stock.find(entry => entry.id === planRow.id);
      if (!row) {
        row = { id: planRow.id, qty: 0, price: adjusted.price };
        stock.push(row);
      }
      // Цена реагирует на остаток именно этого товара у этого торговца:
      // пустеющая полка дорожает, затоваренная дешевеет. Прежний расчёт смотрел
      // только на склад сырья и не различал, есть ли товар в продаже.
      const fill = target > 0 ? clamp(row.qty / target, 0, 2) : 1;
      const shelfMul = fill >= 1
        ? Math.max(0.82, 1 - (fill - 1) * 0.18)
        : Math.min(1.45, 1 + (1 - fill) * 0.45);
      row.price = Math.max(1, Math.round(Number(adjusted.price || 1) * shelfMul));
      if (row.qty > max) {
        const overflow = row.qty - max;
        row.qty = max;
        pile[row.id] = Number((Number(pile[row.id] || 0) + overflow).toFixed(3));
      }
      const needed = Math.max(0, target - row.qty);
      const moved = Math.min(needed, Math.max(0, Math.floor(Number(pile[row.id] || 0))));
      if (moved > 0) {
        pile[row.id] = Math.max(0, Number(pile[row.id] || 0) - moved);
        row.qty += moved;
      }
    }
    const capsTarget = retailMarketCapsTarget(site, market, intel);
    const capsNeeded = Math.max(0, capsTarget - Number(market.caps || 0));
    const capsMoved = Math.min(capsNeeded, Math.max(0, Math.floor(Number(pile.silver || 0))));
    if (capsMoved > 0) {
      pile.silver = Math.max(0, Number(pile.silver || 0) - capsMoved);
      market.caps = Math.max(0, Math.floor(Number(market.caps || 0) + capsMoved));
    }
    market.stock = normalizeMarketStockRows(stock);
    market.lastRestockHour = now;
    market.updatedHour = now;
    dirty = true;
    return true;
  }

  function ensureRetailMarket(site = {}, profileId = '', trade = {}, context = {}) {
    if (!site) return null;
    site.retailMarkets = site.retailMarkets && typeof site.retailMarkets === 'object' ? site.retailMarkets : {};
    const key = retailMarketKey(profileId, { ...context, siteId: site.id });
    const incomingPlan = normalizeTraderPlanRows(trade.stock || trade.plan || []);
    let market = site.retailMarkets[key] ? normalizeRetailMarket(site.retailMarkets[key], key) : null;
    if (!market) {
      market = normalizeRetailMarket({
        key,
        profileId,
        role: context.role,
        restockHours: trade.restockHours ?? context.restockHours ?? traderProfiles[profileId]?.restockHours ?? 24,
        baseCaps: trade.caps,
        caps: 0,
        plan: incomingPlan,
        stock: [],
        lastRestockHour: Number(state.worldHour || 0)
      }, key);
    }
    if (incomingPlan.length) market.plan = incomingPlan;
    market.profileId = safeId(profileId || market.profileId || '', '');
    market.role = safeId(context.role || market.role || 'trader', 'trader');
    market.restockHours = clamp(trade.restockHours ?? context.restockHours ?? market.restockHours ?? 24, 1, 720);
    market.baseCaps = Math.max(0, Math.floor(Number(trade.caps ?? market.baseCaps ?? 0)));
    if (market.bootstrapVersion < RETAIL_MARKET_BOOTSTRAP_VERSION) {
      market.stock = [];
      market.caps = 0;
      market.lastRestockHour = -999;
      market.bootstrapVersion = RETAIL_MARKET_BOOTSTRAP_VERSION;
      market.updatedHour = Number(state.worldHour || 0);
      dirty = true;
      restockRetailMarket(site, market, true);
    } else {
      restockRetailMarket(site, market, false);
    }
    site.retailMarkets[key] = market;
    refreshSiteRetailDemand(site);
    return market;
  }

  function restockRetailMarkets() {
    let changed = false;
    for (const site of Object.values(state.sites || {})) {
      for (const [key, rawMarket] of Object.entries(site?.retailMarkets || {})) {
        const market = normalizeRetailMarket(rawMarket, key);
        if (restockRetailMarket(site, market, false)) changed = true;
        site.retailMarkets[key] = market;
      }
      refreshSiteRetailDemand(site);
    }
    return changed;
  }

  function applyTradeMachineTransaction(siteId = '', trade = {}) {
    const key = safeId(siteId || trade.siteId || '', '');
    const site = key ? state.sites[key] : null;
    if (!site) return { ok: false, error: 'missing_site', siteId: key };

    const buys = mergeStockRows(trade.buys || trade.buyRows || [])
      .filter(row => row.id !== 'silver' && row.qty > 0);
    const sells = mergeStockRows(trade.sells || trade.sellRows || [])
      .filter(row => row.id !== 'silver' && row.qty > 0);
    const silverDelta = Math.round(Number(trade.silverDelta || 0));
    let marketKey = String(trade.marketKey || '').trim().replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 120);
    if (!marketKey) {
      const candidates = Object.entries(site.retailMarkets || {}).filter(([, rawMarket]) => {
        const candidateStock = normalizeMarketStockRows(rawMarket?.stock || []);
        return buys.every(row => Number(candidateStock.find(entry => entry.id === row.id)?.qty || 0) >= row.qty);
      });
      if (candidates.length === 1) marketKey = candidates[0][0];
    }
    const storedMarket = marketKey && site.retailMarkets?.[marketKey]
      ? normalizeRetailMarket(site.retailMarkets[marketKey], marketKey)
      : null;
    if (storedMarket) {
      const nextStock = normalizeMarketStockRows(storedMarket.stock || []);
      const nextCaps = Math.floor(Number(storedMarket.caps || 0)) + silverDelta;
      if (nextCaps < 0) {
        return { ok: false, error: 'insufficient_site_silver', siteId: site.id, silver: storedMarket.caps };
      }
      for (const row of buys) {
        const offer = nextStock.find(entry => entry.id === row.id);
        if (!offer || Number(offer.qty || 0) < row.qty) {
          return { ok: false, error: 'insufficient_site_stock', itemId: row.id, siteId: site.id };
        }
        offer.qty -= row.qty;
      }
      const resaleRows = mergeStockRows(trade.resaleRows || sells);
      for (const row of sells) {
        const resale = resaleRows.find(entry => entry.id === row.id);
        let offer = nextStock.find(entry => entry.id === row.id);
        if (!offer) {
          offer = { id: row.id, qty: 0, price: Math.max(1, Math.round(Number(resale?.price || 1))) };
          nextStock.push(offer);
        }
        offer.qty += row.qty;
      }
      storedMarket.stock = normalizeMarketStockRows(nextStock);
      storedMarket.caps = nextCaps;
      storedMarket.updatedHour = Number(state.worldHour || 0);
      storedMarket.sales = storedMarket.sales && typeof storedMarket.sales === 'object' ? storedMarket.sales : {};
      for (const row of buys) {
        const sale = storedMarket.sales[row.id] || { bought: 0, sold: 0 };
        sale.bought = Math.max(0, Number(sale.bought || 0) + row.qty);
        sale.lastHour = Number(state.worldHour || 0);
        storedMarket.sales[row.id] = sale;
      }
      for (const row of sells) {
        const sale = storedMarket.sales[row.id] || { bought: 0, sold: 0 };
        sale.sold = Math.max(0, Number(sale.sold || 0) + row.qty);
        sale.lastHour = Number(state.worldHour || 0);
        storedMarket.sales[row.id] = sale;
      }
      site.retailMarkets[marketKey] = storedMarket;
      refreshSiteRetailDemand(site);
      site.lastTradeMachineHour = Number(state.worldHour || 0);
      site.lastTradeMachineTransaction = { playerId: String(trade.playerId || '').slice(0, 64), buys, sells, silverDelta, marketKey };
      dirty = true;
      save(true);
      return { ok: true, siteId: site.id, marketKey, stock: clone(storedMarket.stock), caps: storedMarket.caps, market: clone(storedMarket) };
    }
    const next = {
      ...emptyStockpile(),
      ...(site.stockpile && typeof site.stockpile === 'object' ? clone(site.stockpile) : {})
    };
    const nextSilver = Math.floor(Number(next.silver || 0)) + silverDelta;
    if (nextSilver < 0) {
      return { ok: false, error: 'insufficient_site_silver', siteId: site.id, silver: Math.floor(Number(next.silver || 0)) };
    }

    for (const row of buys) {
      const consumed = consumeStockpileForTraderItem(next, row.id, row.qty);
      if (consumed + 0.0001 < row.qty) {
        return { ok: false, error: 'insufficient_site_stock', itemId: row.id, siteId: site.id };
      }
    }
    for (const row of sells) {
      next[row.id] = Math.max(0, Number(next[row.id] || 0)) + Math.max(0, Number(row.qty || 0));
    }

    next.silver = nextSilver;
    site.stockpile = next;
    site.resourceActivity = resourceActivityPercent(site, state.worldHour);
    site.lastTradeMachineHour = Number(state.worldHour || 0);
    site.lastTradeMachineTransaction = {
      playerId: String(trade.playerId || '').slice(0, 64),
      buys,
      sells,
      silverDelta
    };
    dirty = true;
    save(true);
    return { ok: true, siteId: site.id, stockpile: clone(site.stockpile) };
  }

  function applyNpcTraderTransaction(profileId = '', trade = {}, context = {}) {
    const site = traderSite(profileId, context);
    if (!site) return { ok: false, error: 'missing_site', siteId: '' };
    const key = retailMarketKey(profileId, { ...context, siteId: site.id });
    if (!site.retailMarkets?.[key]) {
      ensureRetailMarket(site, profileId, {
        stock: trade.plan || trade.baseStock || trade.stock || [],
        caps: trade.baseCaps ?? trade.caps ?? 0,
        restockHours: trade.restockHours
      }, { ...context, siteId: site.id, marketKey: key });
    }
    return applyTradeMachineTransaction(site.id, { ...trade, marketKey: key });
  }

  function syncTraderMarket(profileId = '', snapshot = {}, context = {}) {
    const site = traderSite(profileId, context);
    if (!site) return { ok: false, error: 'missing_site' };
    const key = retailMarketKey(profileId, { ...context, siteId: site.id });
    const market = site.retailMarkets?.[key] ? normalizeRetailMarket(site.retailMarkets[key], key) : null;
    if (!market) return { ok: false, error: 'missing_market', marketKey: key };
    if (Array.isArray(snapshot.stock)) market.stock = normalizeMarketStockRows(snapshot.stock);
    if (Number.isFinite(Number(snapshot.caps))) market.caps = Math.max(0, Math.floor(Number(snapshot.caps)));
    market.updatedHour = Number(state.worldHour || 0);
    site.retailMarkets[key] = market;
    refreshSiteRetailDemand(site);
    dirty = true;
    save(false);
    return { ok: true, siteId: site.id, marketKey: key, stock: clone(market.stock), caps: market.caps };
  }

  function applyTraderSupply(profileId, trade = {}, context = {}) {
    const site = traderSite(profileId, context);
    const stock = mergeStockRows(trade.stock || []);
    let caps = Math.max(0, Math.floor(Number(trade.caps || 0)));
    if (!site) return { ...trade, stock, caps };
    const persistent = ensureRetailMarket(site, profileId, {
      ...trade,
      stock: trade.stock || stock,
      caps,
      restockHours: trade.restockHours ?? traderProfiles[profileId]?.restockHours ?? 24
    }, context);
    const market = siteMarketIntel(site);
    return {
      ...trade,
      stock: normalizeMarketStockRows(persistent?.stock || []),
      baseStock: normalizeTraderPlanRows(persistent?.plan || trade.stock || []),
      caps: Math.max(0, Math.floor(Number(persistent?.caps || 0))),
      baseCaps: Math.max(0, Math.floor(Number(persistent?.baseCaps || caps))),
      restockHours: Number(persistent?.restockHours || trade.restockHours || 24),
      marketKey: String(persistent?.key || ''),
      market: {
        siteId: site.id,
        marketKey: String(persistent?.key || ''),
        state: market.state,
        stateLabel: market.stateLabel,
        scarcity: market.scarcity,
        abundance: market.abundance,
        priceMultiplier: market.priceMultiplier,
        quantityMultiplier: market.quantityMultiplier
      }
    };
  }

  function normalizeWorldPoint(point = {}) {
    const x = Number(point.x ?? point.playerX ?? point.worldX);
    const y = Number(point.y ?? point.playerY ?? point.worldY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function nearestSite(point = {}, filter = null) {
    const p = normalizeWorldPoint(point);
    if (!p) return null;
    let best = null;
    let bestDist = Infinity;
    const globalMap = getGlobalMap();
    for (const site of Object.values(state.sites)) {
      if (!site || (typeof filter === 'function' && !filter(site))) continue;
      const dist = pointDistanceKm(p, site, globalMap);
      if (dist < bestDist) {
        best = site;
        bestDist = dist;
      }
    }
    return best ? { site: best, distKm: bestDist } : null;
  }

  function nearestParty(point = {}, filter = null) {
    const p = normalizeWorldPoint(point);
    if (!p) return null;
    let best = null;
    let bestDist = Infinity;
    const globalMap = getGlobalMap();
    for (const party of Object.values(state.parties)) {
      if (!party || party.destroyed || party.state === 'destroyed') continue;
      if (typeof filter === 'function' && !filter(party)) continue;
      const dist = pointDistanceKm(p, party, globalMap);
      if (dist < bestDist) {
        best = party;
        bestDist = dist;
      }
    }
    return best ? { party: best, distKm: bestDist } : null;
  }

  function suppressSiteThreat(site, hours = 12, details = {}) {
    if (!site) return false;
    site.threatSuppressedUntil = Math.max(
      Number(site.threatSuppressedUntil || 0),
      Number(state.worldHour || 0) + Math.max(1, Number(hours || 1))
    );
    site.lastThreatSuppressedBy = String(details.reason || details.encounterId || 'encounter').slice(0, 64);
    site.security = clamp(Number(site.security || 0) + Number(details.securityBonus || 0), 0, 100);
    site.danger = clamp(Number(site.danger || 0) - Number(details.dangerDrop || 0), 0, 5);
    dirty = true;
    return true;
  }

  function suppressPartyThreat(party, hours = 8, details = {}) {
    if (!party) return false;
    party.threatSuppressedUntil = Math.max(
      Number(party.threatSuppressedUntil || 0),
      Number(state.worldHour || 0) + Math.max(1, Number(hours || 1))
    );
    if (Number(details.strengthDrop || 0) > 0) {
      party.strength = clamp(Number(party.strength || 0) - Number(details.strengthDrop || 0), 1, 500);
    }
    if (Number(details.memberDrop || 0) > 0) {
      party.members = clamp(Number(party.members || 0) - Number(details.memberDrop || 0), 1, 200);
    }
    party.lastThreatSuppressedBy = String(details.reason || details.encounterId || 'encounter').slice(0, 64);
    dirty = true;
    return true;
  }

  function worldTaskTargetNear(task = {}, point = null, maxKm = 16) {
    const target = normalizeWorldPoint(task.details || {});
    const p = normalizeWorldPoint(point || {});
    if (!target || !p) return false;
    return pointDistanceKm(target, p, getGlobalMap()) <= Math.max(0.5, Number(maxKm || 16));
  }

  function applyEncounterOutcomeToSettlements(context = {}) {
    const point = normalizeWorldPoint(context.worldPoint || context.point || {});
    const killedGroups = new Set((context.deadFactions || []).map(factionGroup));
    const aliveGroups = new Set((context.aliveFactions || []).map(factionGroup));
    const encounterId = safeId(context.encounterId || '', 'encounter');
    const explicitPartyId = safeId(context.worldPartyId || context.partyId || '', '');
    const explicitParty = explicitPartyId ? state.parties[explicitPartyId] : null;
    const worldZoneId = safeId(context.worldZoneId || context.zoneId || '', '');
    const explicitSite = state.sites[safeId(context.siteId || context.worldSiteId || '', '')] || null;
    const worldBattleZone = worldZoneId ? worldZoneById(worldZoneId) : null;
    const zoneSite = worldBattleZone ? state.sites[worldBattleZone.siteId || ''] || null : null;
    const playerInvolved = !!context.playerInvolved;
    const now = Number(state.worldHour || 0);
    let explicitCaravanLossCounted = false;
    const oldKlimSite = nearestSite(point || state.sites.settlement, site => site.owner === 'old_klim')?.site || state.sites.settlement;
    const nearestSettlement = nearestSite(point || oldKlimSite, site => isSettlementServiceSite(site))?.site || oldKlimSite;

    if (explicitParty
      && !explicitParty.destroyed
      && explicitParty.state !== 'destroyed'
      && !(worldBattleZone?.details?.simBattle && worldZoneReferencesParty(worldBattleZone, explicitParty.id))) {
      const partyGroup = factionGroup(explicitParty.faction || '');
      const partyCleared = !!partyGroup && killedGroups.has(partyGroup) && !aliveGroups.has(partyGroup);
      const partyKind = String(explicitParty.kind || '').toLowerCase();
      const caravanLeaderKilled = partyKind === 'caravan' && (!!context.caravanLeaderKilled || String(context.outcome || context.reason || '') === 'caravan_leader_killed');
      if (partyCleared || caravanLeaderKilled) {
        const destroyReason = caravanLeaderKilled
          ? 'caravan_leader_killed'
          : (playerInvolved ? 'player_encounter_cleared' : 'encounter_cleared');
        destroyWorldParty(explicitParty, destroyReason);
        if (partyKind === 'caravan') {
          state.stats.caravansLost = Number(state.stats.caravansLost || 0) + 1;
          explicitCaravanLossCounted = true;
          finishActiveWorldTasks(
            task => task.type === 'escort_caravan' && task.partyId === explicitParty.id,
            'failed',
            destroyReason,
            { encounterId, partyId: explicitParty.id, playerId: context.playerId || '' }
          );
        }
        addEvent('world_party_destroyed', `${explicitParty.name || explicitParty.id} уничтожен в пустоши.`, {
          encounterId,
          partyId: explicitParty.id,
          faction: explicitParty.faction || '',
          reason: destroyReason,
          x: point ? Number(point.x.toFixed(1)) : Number(Number(explicitParty.x || 0).toFixed(1)),
          y: point ? Number(point.y.toFixed(1)) : Number(Number(explicitParty.y || 0).toFixed(1))
        });
        markWorldZonesLooted(zone => {
          const source = String(zone.sourceId || '');
          return String(zone.partyId || '') === explicitParty.id
            || String(zone.threatPartyId || '') === explicitParty.id
            || source === explicitParty.id
            || source.split(':').includes(explicitParty.id);
        }, {
          encounterId,
          partyId: explicitParty.id,
          playerId: context.playerId || '',
          reason: 'world_party_destroyed'
        });
        dirty = true;
      }
    }

    if (worldZoneId) {
      const battleZone = worldBattleZone || worldZoneById(worldZoneId);
      let handledBattleZone = false;
      if (battleZone?.details?.simBattle) {
        handledBattleZone = true;
        const defenderGroup = factionGroup(battleZone.faction || state.parties[battleZone.partyId]?.faction || '');
        const attackerGroup = factionGroup(battleZone.targetFaction || state.parties[battleZone.threatPartyId]?.faction || '');
        if (defenderGroup && killedGroups.has(defenderGroup) && !aliveGroups.has(defenderGroup)) {
          const battleOutcome = defenderLostBattleOutcome(battleZone);
          if (completeBattleZone(battleZone, battleOutcome, { playerInvolved, encounterId }) && battleOutcome === 'caravan_destroyed') {
            explicitCaravanLossCounted = true;
          }
        } else if ((attackerGroup && killedGroups.has(attackerGroup) && !aliveGroups.has(attackerGroup))
          || (!aliveGroups.has('raiders') && killedGroups.has('raiders'))
          || (!aliveGroups.has('wild') && killedGroups.has('wild'))
          || (!aliveGroups.has('mutants') && killedGroups.has('mutants'))) {
          completeBattleZone(battleZone, attackerLostBattleOutcome(battleZone), { playerInvolved, encounterId });
        }
      }
      if (!handledBattleZone) markWorldZonesLooted(zone => zone.id === worldZoneId, {
        encounterId,
        playerId: context.playerId || '',
        reason: 'zone_resolved'
      });
    }

    if (killedGroups.has('caravans')) {
      const site = nearestSettlement || oldKlimSite;
      if (site) {
        site.supplyDisruptedUntil = Math.max(Number(site.supplyDisruptedUntil || 0), Number(state.worldHour || 0) + 18);
        site.security = clamp(Number(site.security || 0) - (playerInvolved ? 6 : 3), 0, 100);
        site.prosperity = clamp(Number(site.prosperity || 0) - (playerInvolved ? 4 : 2), 0, 100);
      }
      if (!explicitCaravanLossCounted) state.stats.caravansLost = Number(state.stats.caravansLost || 0) + 1;
      addEvent(playerInvolved ? 'caravan_robbed' : 'caravan_lost', playerInvolved
        ? 'Караван ограблен в пустоши.'
        : 'Караван пропал в пустоши.', {
        encounterId,
        siteId: site?.id || '',
        x: point ? Number(point.x.toFixed(1)) : undefined,
        y: point ? Number(point.y.toFixed(1)) : undefined
      });
    }

    if (killedGroups.has('old_klim')) {
      const site = oldKlimSite || nearestSettlement;
      if (site) {
        site.security = clamp(Number(site.security || 0) - (playerInvolved ? 8 : 4), 0, 100);
        site.prosperity = clamp(Number(site.prosperity || 0) - 2, 0, 100);
      }
      addEvent(playerInvolved ? 'patrol_attacked' : 'patrol_lost', playerInvolved
        ? 'Патруль Старого Клима попал под атаку.'
        : 'Патруль Старого Клима потерял людей на дороге.', {
        encounterId,
        siteId: site?.id || '',
        x: point ? Number(point.x.toFixed(1)) : undefined,
        y: point ? Number(point.y.toFixed(1)) : undefined
      });
    }

    const raidersCleared = killedGroups.has('raiders') && !aliveGroups.has('raiders');
    if (raidersCleared) {
      const raiderSite = nearestSite(point || state.sites.oldDepot, site => String(site.owner || '') === 'raiders')?.site || state.sites.oldDepot;
      const raiderParty = nearestParty(point || raiderSite, party => String(party.kind || '') === 'raider')?.party;
      suppressSiteThreat(raiderSite, 20, { encounterId, reason: 'raiders_cleared', dangerDrop: 0.45 });
      suppressPartyThreat(raiderParty, 12, { encounterId, reason: 'raiders_cleared', strengthDrop: 8, memberDrop: 1 });
      if (oldKlimSite) oldKlimSite.security = clamp(Number(oldKlimSite.security || 0) + 3, 0, 100);
      addEvent('raiders_cleared', 'Рейдерская угроза на дороге подавлена.', {
        encounterId,
        siteId: raiderSite?.id || '',
        partyId: raiderParty?.id || '',
        x: point ? Number(point.x.toFixed(1)) : undefined,
        y: point ? Number(point.y.toFixed(1)) : undefined
      });
      finishActiveWorldTasks(
        task => (
          ['defend_resource', 'retake_site'].includes(task.type)
            && (!task.targetFaction || task.targetFaction === 'raiders')
            && (!task.siteId
              || task.siteId === (raiderSite?.id || '')
              || task.siteId === (nearestSettlement?.id || '')
              || worldTaskTargetNear(task, point, 18))
        ) || (
          task.type === 'clear_lair'
            && (!task.targetFaction || factionGroup(task.targetFaction) === 'raiders')
            && (!task.partyId || task.partyId === (raiderParty?.id || '') || worldTaskTargetNear(task, point, 18))
        ),
        playerInvolved ? 'completed' : 'resolved',
        playerInvolved ? 'player_cleared_raiders' : 'world_cleared_raiders',
        { encounterId, siteId: raiderSite?.id || '', partyId: raiderParty?.id || '', playerId: context.playerId || '' }
      );
      markWorldZonesLooted(
        zone => zone.kind === 'lair'
          && factionGroup(zone.targetFaction || zone.faction) === 'raiders'
          && (!zone.partyId || zone.partyId === (raiderParty?.id || '') || worldZoneNearPoint(zone, point, 18)),
        { encounterId, siteId: raiderSite?.id || '', partyId: raiderParty?.id || '', playerId: context.playerId || '' }
      );
    }

    const wildCleared = (killedGroups.has('wild') || killedGroups.has('mutants')) && !aliveGroups.has('wild') && !aliveGroups.has('mutants');
    if (wildCleared) {
      const wildSite = nearestSite(point || state.sites.scrapFields, site => isContestedWorldSite(site))?.site;
      const wildParty = nearestParty(point || wildSite, party => String(party.kind || '') === 'monster')?.party;
      suppressSiteThreat(wildSite, 14, { encounterId, reason: 'wildlife_cleared', dangerDrop: 0.35, securityBonus: 1 });
      suppressPartyThreat(wildParty, 8, { encounterId, reason: 'wildlife_cleared', strengthDrop: 5, memberDrop: 1 });
      addEvent('wildlife_cleared', 'Опасная стая в пустоши уничтожена.', {
        encounterId,
        siteId: wildSite?.id || '',
        partyId: wildParty?.id || '',
        x: point ? Number(point.x.toFixed(1)) : undefined,
        y: point ? Number(point.y.toFixed(1)) : undefined
      });
      finishActiveWorldTasks(
        task => (
          task.type === 'defend_resource'
            && (!task.targetFaction || ['wild', 'mutants'].includes(factionGroup(task.targetFaction)))
            && (!task.siteId
              || task.siteId === (wildSite?.id || '')
              || task.siteId === (nearestSettlement?.id || '')
              || worldTaskTargetNear(task, point, 18))
        ) || (
          task.type === 'clear_lair'
            && (!task.targetFaction || ['wild', 'mutants'].includes(factionGroup(task.targetFaction)))
            && (!task.partyId || task.partyId === (wildParty?.id || '') || worldTaskTargetNear(task, point, 18))
        ),
        playerInvolved ? 'completed' : 'resolved',
        playerInvolved ? 'player_cleared_wildlife' : 'world_cleared_wildlife',
        { encounterId, siteId: wildSite?.id || '', partyId: wildParty?.id || '', playerId: context.playerId || '' }
      );
      markWorldZonesLooted(
        zone => zone.kind === 'lair'
          && ['wild', 'mutants'].includes(factionGroup(zone.targetFaction || zone.faction))
          && (!zone.partyId || zone.partyId === (wildParty?.id || '') || worldZoneNearPoint(zone, point, 18)),
        { encounterId, siteId: wildSite?.id || '', partyId: wildParty?.id || '', playerId: context.playerId || '' }
      );
    }

    if ((encounterId.includes('patrol') || encounterId.includes('vs')) && (killedGroups.has('wild') || killedGroups.has('raiders')) && aliveGroups.has('old_klim')) {
      if (oldKlimSite) oldKlimSite.security = clamp(Number(oldKlimSite.security || 0) + 2, 0, 100);
      addEvent('patrol_success', 'Патруль Старого Клима выжил в дорожной стычке.', {
        encounterId,
        siteId: oldKlimSite?.id || ''
      });
    }

    const localEventResolved = raidersCleared || wildCleared
      || ((encounterId.includes('patrol') || encounterId.includes('vs') || encounterId.includes('raid'))
        && (killedGroups.has('wild') || killedGroups.has('mutants') || killedGroups.has('raiders') || killedGroups.has('old_klim')));
    const nearestConflictSite = point ? nearestSite(point, site => activeSiteConflict(site) || Number(site.raidUntil || 0) > now) : null;
    const conflictSite = explicitSite
      || zoneSite
      || (nearestConflictSite && nearestConflictSite.distKm <= 18 ? nearestConflictSite.site : null);
    if (localEventResolved && conflictSite) {
      const conflict = activeSiteConflict(conflictSite);
      if (conflict) {
        const defenderGroup = factionGroup(conflictSite.owner || conflict.ownerAtStart || 'neutral');
        const defenderLost = defenderGroup && killedGroups.has(defenderGroup) && !aliveGroups.has(defenderGroup);
        const attackerStillAlive = siteConflictAttackers(conflictSite)
          .some(row => aliveGroups.has(factionGroup(row.faction)));
        if (defenderLost && attackerStillAlive) captureSiteFromConflict(conflictSite, conflict);
        else finishSiteConflict(conflictSite, 'repelled', {
          encounterId,
          playerId: context.playerId || '',
          reason: 'encounter_resolved'
        });
      } else {
        conflictSite.raidUntil = Math.min(Number(conflictSite.raidUntil || 0), now);
      }
      dirty = true;
    }
    if (localEventResolved && nearestSettlement) {
      nearestSettlement.raidUntil = Math.min(Number(nearestSettlement.raidUntil || 0), now);
      nearestSettlement.controlPressure = Number(nearestSettlement.controlPressure || 0) > 0
        ? Math.max(0, Number(nearestSettlement.controlPressure || 0) - 12)
        : Math.min(0, Number(nearestSettlement.controlPressure || 0) + 12);
      dirty = true;
    }
  }

  function recordEncounterOutcome(context = {}) {
    const encounterId = safeId(context.encounterId || '', 'encounter');
    const outcome = String(context.outcome || context.reason || 'resolved').slice(0, 48);
    const point = normalizeWorldPoint(context.worldPoint || context.point || {});
    applyEncounterOutcomeToSettlements({ ...context, encounterId, worldPoint: point });
    state.stats.encountersResolved = Number(state.stats.encountersResolved || 0) + 1;
    addEvent('encounter_outcome', `Событие мира завершено: ${encounterId}.`, {
      encounterId,
      outcome,
      roomId: String(context.roomId || '').slice(0, 64),
      playerInvolved: !!context.playerInvolved,
      aliveFactions: Array.isArray(context.aliveFactions) ? context.aliveFactions.slice(0, 12) : [],
      deadFactions: Array.isArray(context.deadFactions) ? context.deadFactions.slice(0, 12) : [],
      x: point ? Number(point.x.toFixed(1)) : undefined,
      y: point ? Number(point.y.toFixed(1)) : undefined
    });
    dirty = true;
    save(true);
    return publicState();
  }

  function removePlayerFromWorldParties(memberInput = {}, exceptPartyId = '') {
    const member = memberInput && typeof memberInput === 'object'
      ? memberInput
      : { characterId: memberInput, id: memberInput };
    const memberKey = normalizedWorldPartyMemberKey(member.userId || '', member.characterId || '');
    const legacyId = safeId(member.characterId || member.id || member.playerId || '', '');
    if (!memberKey && !legacyId) return 0;
    let removed = 0;
    Object.values(state.parties).forEach(party => {
      if (!party || party.id === exceptPartyId || !Array.isArray(party.playerMembers)) return;
      const before = party.playerMembers.length;
      party.playerMembers = party.playerMembers.filter(row => {
        if (!row) return false;
        const rowKey = normalizedWorldPartyMemberKey(row.userId || '', row.characterId || '');
        if (memberKey && rowKey) return rowKey !== memberKey;
        return row.id !== legacyId && row.playerId !== legacyId && row.characterId !== legacyId;
      });
      const partyRemoved = before - party.playerMembers.length;
      removed += partyRemoved;
      if (partyRemoved > 0) syncWorldPartyPlayerTaskDetails(party);
    });
    return removed;
  }

  function findWorldTaskById(id = '') {
    const key = String(id || '').trim();
    if (!key) return null;
    return state.worldTasks.find(row => row && String(row.id || '') === key) || null;
  }

  function syncWorldPartyPlayerTaskDetails(party = {}, preferredTask = null) {
    if (!party?.id) return;
    const tasks = state.worldTasks.filter(task => task
      && task.status === 'active'
      && task.partyId === party.id
      && ['escort_caravan', 'join_patrol'].includes(String(task.type || '').toLowerCase()));
    if (preferredTask?.status === 'active' && !tasks.includes(preferredTask)) tasks.push(preferredTask);
    tasks.forEach(task => {
      task.details = task.details && typeof task.details === 'object' ? task.details : {};
      const playerLimit = worldPartyPlayerLimit(party, task);
      task.details.playerLimit = playerLimit;
      const taskMembers = Array.isArray(party.playerMembers)
        ? party.playerMembers.filter(row => row?.taskId === task.id).slice(0, playerLimit)
        : [];
      task.details.joinedPlayers = taskMembers.map(row => row?.id).filter(Boolean);
      task.details.playerCount = taskMembers.length;
      syncPatrolDutyWindow(task, taskMembers, state.worldHour);
    });
  }

  function removeWorldTaskPartyMembers(task = {}) {
    if (!isWorldPartyTask(task) || !task.id || !task.partyId) return 0;
    const party = state.parties[task.partyId];
    if (!party || !Array.isArray(party.playerMembers)) return 0;
    const before = party.playerMembers.length;
    party.playerMembers = party.playerMembers.filter(member => member?.taskId !== task.id);
    const removed = before - party.playerMembers.length;
    if (removed > 0) {
      syncWorldPartyPlayerTaskDetails(party);
      dirty = true;
    }
    return removed;
  }

  function joinWorldParty(data = {}) {
    const task = findWorldTaskById(data.taskId || data.worldTaskId || '');
    const taskType = String(task?.type || '').toLowerCase();
    if (!task) return { ok: false, error: 'Для вступления нужна существующая работа пустоши.' };
    if (task.status !== 'active' || Number(task.expiresHour || 0) <= Number(state.worldHour || 0)) {
      return { ok: false, error: 'Эта работа уже недоступна.' };
    }
    if (!['escort_caravan', 'join_patrol'].includes(taskType)) return { ok: false, error: 'Это задание не присоединяет к группе.' };
    const partyId = safeId(task.partyId || '', '');
    if (!partyId) return { ok: false, error: 'У работы больше нет связанной группы.' };
    const requestedPartyId = safeId(data.partyId || '', '');
    if (requestedPartyId && requestedPartyId !== partyId) return { ok: false, error: 'Работа относится к другой группе.' };
    const party = partyId ? state.parties[partyId] : null;
    if (!party || party.destroyed || party.state === 'destroyed') return { ok: false, error: 'Группа уже недоступна.' };
    if (!worldPartyTaskIsActiveForParty(task, party, state.worldHour)) {
      return { ok: false, error: 'Тип группы не соответствует этой работе.' };
    }
    const kind = String(party.kind || '').toLowerCase();
    if (kind === 'caravan' && !caravanStagingIsOpen(party)) {
      return { ok: false, error: 'Караван уже вышел в путь. Набор сопровождения закрыт.' };
    }
    const requiredFaction = factionGroup(party.faction || '');
    const playerFaction = factionGroup(data.factionId || data.worldFactionId || data.playerFactionId || '');
    if (isJoinableWorldFaction(requiredFaction) && playerFaction !== requiredFaction) {
      return { ok: false, error: `Нужно состоять во фракции: ${factionLabel(requiredFaction)}.` };
    }
    const characterId = safeId(data.characterId || '', '');
    if (!characterId) return { ok: false, error: 'Не удалось определить персонажа.' };
    const userId = safeId(data.userId || data.accountId || '', '');
    if (!userId) return { ok: false, error: 'Не удалось определить аккаунт персонажа.' };
    const member = normalizePartyPlayerMember({
      playerId: data.playerId || data.socketId || '',
      socketId: data.socketId || '',
      userId,
      characterId,
      factionId: requiredFaction,
      name: data.name || data.playerName || '',
      taskId: task.id
    }, 0, state.worldHour);
    if (!member) return { ok: false, error: 'Не удалось определить игрока.' };
    const memberKey = normalizedWorldPartyMemberKey(member.userId, member.characterId);
    const playerLimit = worldPartyPlayerLimit(party, task);
    party.playerMembers = Array.isArray(party.playerMembers) ? party.playerMembers.filter(Boolean).slice(-playerLimit) : [];
    let existingIndex = party.playerMembers.findIndex(row => (
      normalizedWorldPartyMemberKey(row?.userId || '', row?.characterId || '') === memberKey
    ));
    if (existingIndex < 0 && worldPartyPlayerCount(party) >= playerLimit) {
      return { ok: false, error: `В этой группе уже максимум игроков: ${playerLimit}. НПС не занимают места игроков.` };
    }
    if (existingIndex >= 0 && party.playerMembers[existingIndex]?.taskId === task.id) {
      return { ok: true, replay: true, party: publicParty(party), taskId: task.id, sim: publicState() };
    }
    removePlayerFromWorldParties(member, party.id);
    existingIndex = party.playerMembers.findIndex(row => (
      normalizedWorldPartyMemberKey(row?.userId || '', row?.characterId || '') === memberKey
    ));
    if (existingIndex >= 0) {
      party.playerMembers[existingIndex] = { ...party.playerMembers[existingIndex], ...member, lastSeenHour: Number(state.worldHour || 0) };
    } else {
      party.playerMembers.push(member);
    }
    party.playerMembers = party.playerMembers.slice(-playerLimit);
    task.details = task.details && typeof task.details === 'object' ? task.details : {};
    task.details.lastJoinedPlayer = member.name;
    task.details.lastJoinHour = Number(Number(state.worldHour || 0).toFixed(2));
    task.details.minPlayers = Number(party.stagingMinPlayers || task.details.minPlayers || 0);
    syncWorldPartyPlayerTaskDetails(party, task);
    addEvent('world_party_joined', `${member.name} присоединился к группе "${party.name || party.id}".`, {
      partyId: party.id,
      taskId: task.id
    });
    dirty = true;
    save(true);
    return { ok: true, party: publicParty(party), taskId: task.id, sim: publicState() };
  }

  function reconcileWorldPartyMembers(authoritativeCharacters = [], options = {}) {
    const result = pruneInvalidWorldPartyPlayerMembers(state, authoritativeCharacters, options);
    dirty = true;
    save(true);
    return result;
  }

  function leaveWorldParty(data = {}) {
    const member = normalizePartyPlayerMember({
      playerId: data.playerId || data.socketId || '',
      socketId: data.socketId || '',
      userId: data.userId || data.accountId || '',
      characterId: data.characterId || '',
      name: data.name || data.playerName || ''
    }, 0, state.worldHour);
    const memberKey = normalizedWorldPartyMemberKey(member?.userId || '', member?.characterId || '');
    if (!member || !memberKey) return { ok: false, error: 'Не удалось определить игрока.' };
    const partyId = safeId(data.partyId || '', '');
    const parties = partyId && state.parties[partyId] ? [state.parties[partyId]] : Object.values(state.parties);
    let leftParty = null;
    let removed = 0;
    parties.forEach(party => {
      if (!party || !Array.isArray(party.playerMembers)) return;
      const before = party.playerMembers.length;
      party.playerMembers = party.playerMembers.filter(row => (
        row && normalizedWorldPartyMemberKey(row.userId || '', row.characterId || '') !== memberKey
      ));
      if (party.playerMembers.length !== before) {
        removed += before - party.playerMembers.length;
        leftParty = party;
      }
    });
    if (removed > 0 && leftParty) {
      syncWorldPartyPlayerTaskDetails(leftParty);
      addEvent('world_party_left', `${member.name} покинул группу "${leftParty.name || leftParty.id}".`, {
        partyId: leftParty.id
      });
      dirty = true;
      save(true);
    }
    return { ok: true, removed, party: leftParty ? publicParty(leftParty) : null, sim: publicState() };
  }

  function partyThreatZone(party) {
    if (!party || party.destroyed || party.state === 'destroyed') return null;
    const kind = String(party.kind || '').toLowerCase();
    const suppressed = Number(party.threatSuppressedUntil || 0) > Number(state.worldHour || 0);
    const suppressMul = suppressed ? 0.45 : 1;
    const base = {
      id: `party_${safeId(party.id || kind || 'party')}`,
      sourceType: 'party',
      sourceId: party.id,
      name: party.name || party.id || 'Party',
      kind: party.kind || 'party',
      faction: party.faction || '',
      species: party.species || '',
      x: Number(Number(party.x || 0).toFixed(2)),
      y: Number(Number(party.y || 0).toFixed(2))
    };
    if (kind === 'raider') {
      return {
        ...base,
        radiusKm: 18,
        chanceBonus: 0.18 * suppressMul,
        difficultyBonus: 1.15 * suppressMul,
        label: suppressed ? 'suppressed raider activity' : 'raider activity',
        suppressedUntil: party.threatSuppressedUntil || 0,
        weights: { raider_ambush: 8, raiders_vs_patrol: 4, caravan_patrol_vs_ghouls: 1 }
      };
    }
    if (kind === 'monster') {
      const encounterId = partyMeetingEncounterId(party);
      const weights = encounterId === 'fire_gecko_ambush'
        ? { fire_gecko_ambush: 6, gecko_pack: 2 }
        : { [encounterId]: 8 };
      return {
        ...base,
        radiusKm: 15,
        chanceBonus: 0.14 * suppressMul,
        difficultyBonus: 0.9 * suppressMul,
        label: suppressed ? 'scattered monster migration' : 'monster migration',
        suppressedUntil: party.threatSuppressedUntil || 0,
        weights
      };
    }
    if (kind === 'patrol') {
      return {
        ...base,
        radiusKm: 12,
        chanceBonus: -0.05,
        difficultyBonus: -0.35,
        label: 'patrol route',
        weights: { peaceful_caravan: 2, caravan_patrol_vs_ghouls: 3, radscorpions_vs_patrol: 2, raiders_vs_patrol: 2 }
      };
    }
    if (kind === 'caravan') {
      return {
        ...base,
        radiusKm: 10,
        chanceBonus: 0.03,
        difficultyBonus: 0.05,
        label: 'caravan route',
        weights: { peaceful_caravan: 5, raider_ambush: 1 }
      };
    }
    return null;
  }

  function siteThreatZone(site) {
    if (!site) return null;
    const type = String(site.type || '').toLowerCase();
    const owner = String(site.owner || '').toLowerCase();
    const isRaider = owner === 'raiders';
    const isWild = isContestedWorldSite(site);
    if (!isRaider && !isWild) return null;
    const pvpFullDrop = String(site.pvpMode || '') === 'pvpFullDrop';
    const suppressed = Number(site.threatSuppressedUntil || 0) > Number(state.worldHour || 0);
    const suppressMul = suppressed ? 0.45 : 1;
    const protectionMul = clamp(1 - Number(site.protectionLevel || 0) / 160, 0.35, 1);
    const raidMul = Number(site.raidUntil || 0) > Number(state.worldHour || 0) ? 1.6 : 1;
    return {
      id: `site_${safeId(site.id || site.name || 'site')}`,
      sourceType: 'site',
      sourceId: site.id,
      name: site.name || site.id || 'Site',
      kind: type || 'site',
      faction: site.owner || '',
      x: Number(Number(site.x || 0).toFixed(2)),
      y: Number(Number(site.y || 0).toFixed(2)),
      radiusKm: isRaider ? 16 : (pvpFullDrop ? 13 : 9),
      chanceBonus: (isRaider ? 0.12 : (pvpFullDrop ? 0.07 : 0.035)) * suppressMul * protectionMul * raidMul,
      difficultyBonus: (isRaider ? 0.8 : (pvpFullDrop ? 0.55 : 0.22)) * suppressMul * protectionMul * raidMul,
      label: Number(site.raidUntil || 0) > Number(state.worldHour || 0)
        ? (type === 'production' ? 'production raid' : 'resource raid')
        : suppressed
          ? (isRaider ? 'suppressed raider territory' : type === 'production' ? 'secured production' : 'secured resource')
          : (isRaider ? 'raider territory' : type === 'production' ? 'contested production' : 'contested resource'),
      suppressedUntil: site.threatSuppressedUntil || 0,
      raidUntil: site.raidUntil || 0,
      protectionLevel: site.protectionLevel || 0,
      weights: isRaider
        ? { raider_ambush: 6, raiders_vs_patrol: 2, ghoul_pack: 1 }
        : { peaceful_caravan: 1, radscorpion_nest: 2, mutant_ant_swarm: 2, gecko_pack: 2, ants_vs_geckos: 1 }
    };
  }

  function publicThreatZones() {
    const zones = [];
    Object.values(state.parties).forEach(party => {
      const zone = partyThreatZone(party);
      if (zone) zones.push(zone);
    });
    Object.values(state.sites).forEach(site => {
      const zone = siteThreatZone(site);
      if (zone) zones.push(zone);
    });
    return zones.slice(0, 64);
  }

  function siteVisibleOnPublicGlobalMap(site = {}) {
    if (!site) return false;
    if (isFactionCapitalSite(site)) return true;
    return !globalMapPointInCapitalClearZone(getGlobalMap(), site, CAPITAL_CLEAR_RADIUS_POINTS, site.id);
  }

  function siteTerritoryWeight(site = {}) {
    const type = String(site.type || '').toLowerCase();
    if (type === 'settlement') return 1.0;
    if (type === 'outpost') return 0.72;
    if (type === 'production') return 0.66;
    if (type === 'resource') return 0.58;
    if (type === 'pointofinterest') return 0.48;
    return 0.35;
  }

  function publicTerritories() {
    const globalMap = getGlobalMap() || {};
    const grid = globalMap.grid && typeof globalMap.grid === 'object' ? globalMap.grid : {};
    const cols = clamp(Math.round(Number(grid.cols || 30)), 1, 80);
    const rows = clamp(Math.round(Number(grid.rows || 30)), 1, 80);
    const cellPoints = Math.max(1, Number(grid.cellPoints || 30));
    const pointIsWater = (x = 0, y = 0) => districtInterestPointIsWater(globalMap, x, y, 0);
    const borderSideIsWater = (row = {}, side = '') => {
      const cx = Number(row.cx || 0);
      const cy = Number(row.cy || 0);
      const left = cx * cellPoints;
      const right = (cx + 1) * cellPoints;
      const top = cy * cellPoints;
      const bottom = (cy + 1) * cellPoints;
      const samples = side === 'N'
        ? [[left + cellPoints * 0.18, top], [left + cellPoints * 0.5, top], [right - cellPoints * 0.18, top]]
        : side === 'E'
        ? [[right, top + cellPoints * 0.18], [right, top + cellPoints * 0.5], [right, bottom - cellPoints * 0.18]]
        : side === 'S'
        ? [[left + cellPoints * 0.18, bottom], [left + cellPoints * 0.5, bottom], [right - cellPoints * 0.18, bottom]]
        : side === 'W'
        ? [[left, top + cellPoints * 0.18], [left, top + cellPoints * 0.5], [left, bottom - cellPoints * 0.18]]
        : [];
      return samples.some(([x, y]) => pointIsWater(x, y));
    };
    const sources = Object.values(state.sites)
      .filter(site => site && site.owner && factionGroup(site.owner) !== 'neutral' && siteVisibleOnPublicGlobalMap(site))
      .map(site => ({
        site,
        weight: siteTerritoryWeight(site),
        owner: factionGroup(site.owner),
        color: state.factions[factionGroup(site.owner)]?.color || '#9fd7ff'
      }));
    const out = [];
    if (!sources.length) return out;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const point = { x: (cx + 0.5) * cellPoints, y: (cy + 0.5) * cellPoints };
        if (pointIsWater(point.x, point.y)) continue;
        let best = null;
        let bestScore = Infinity;
        sources.forEach(source => {
          const dist = pointDistanceKm(point, source.site, globalMap);
          const security = clamp(source.site.security ?? siteDefaultSecurity(source.site), 0, 100);
          const prosperity = clamp(source.site.prosperity ?? 0, 0, 100);
          const pressure = Math.abs(Number(source.site.controlPressure || 0));
          const score = dist / Math.max(0.2, source.weight) - security * 0.025 - prosperity * 0.015 + pressure * 0.08;
          if (score < bestScore) {
            best = source;
            bestScore = score;
          }
        });
        if (!best) continue;
        const maxScore = 18 + best.weight * 14;
        const normalizedScore = Math.min(bestScore, maxScore);
        out.push({
          cx,
          cy,
          owner: best.owner,
          ownerLabel: factionLabel(best.owner),
          color: best.color,
          sourceSiteId: best.site.id || '',
          strength: Number(clamp(1 - normalizedScore / maxScore, 0.12, 1).toFixed(3))
        });
      }
    }
    const byCell = new Map(out.map(row => [`${row.cx}:${row.cy}`, row]));
    out.forEach(row => {
      const edges = [];
      const neighbors = [
        ['N', row.cx, row.cy - 1],
        ['E', row.cx + 1, row.cy],
        ['S', row.cx, row.cy + 1],
        ['W', row.cx - 1, row.cy]
      ];
      neighbors.forEach(([side, nx, ny]) => {
        const neighbor = byCell.get(`${nx}:${ny}`);
        if ((!neighbor || neighbor.owner !== row.owner) && !borderSideIsWater(row, side)) edges.push(side);
      });
      row.borders = edges.join('');
      row.frontier = edges.length > 0;
      row.borderCount = edges.length;
    });
    return out;
  }

  function encounterIdForWorldContact(input = {}) {
    const kind = String(input.kind || '').toLowerCase();
    const faction = factionGroup(input.faction || input.targetFaction || input.threatFaction || '');
    const source = String(input.source || '').toLowerCase();
    const wildProfile = faction === 'wild'
      ? wildCreatureProfileForParty({
          species: input.species || input.creature || input.visual || '',
          visual: input.visual || '',
          typeName: input.typeName || '',
          id: input.partyId || input.sourceId || input.id || '',
          name: input.name || input.title || input.threatName || ''
        })
      : null;
    if (kind === 'lair' && faction === 'raiders') return 'raider_ambush';
    if (kind === 'lair' && faction === 'mutants') return 'super_mutant_lair';
    if (kind === 'lair' && faction === 'wild') return wildCreatureEncounterId(wildProfile);
    if (source.includes('caravan') && faction === 'raiders') return 'raider_ambush';
    if (source.includes('caravan') && (faction === 'wild' || faction === 'mutants')) return 'caravan_patrol_vs_ghouls';
    if (faction === 'raiders') return 'raiders_vs_patrol';
    if (faction === 'mutants') return 'super_mutant_lair';
    if (faction === 'wild') return kind === 'raid' ? wildCreatureEncounterId(wildProfile) : 'caravan_patrol_vs_ghouls';
    if (kind === 'caravan') return 'peaceful_caravan';
    return 'caravan_patrol_vs_ghouls';
  }

  function locationIdForWorldContact(input = {}) {
    const explicit = safeId(input.locationId || '', '');
    if (explicit) return explicit;
    const kind = String(input.kind || '').toLowerCase();
    const faction = factionGroup(input.faction || input.targetFaction || input.threatFaction || '');
    const encounterId = safeId(input.encounterId || encounterIdForWorldContact(input), '');
    if (kind === 'caravan' || encounterId.includes('caravan')) return 'randomRuinedRoad';
    if (faction === 'raiders' || encounterId.includes('raider')) return 'randomRuinedRoad';
    if (faction === 'mutants' || encounterId.includes('mutant') || encounterId.includes('super_mutant')) return 'randomDryBasin';
    if (faction === 'wild' || encounterId.includes('scorpion') || encounterId.includes('ant') || encounterId.includes('gecko')) return 'randomDryBasin';
    if (kind === 'battle' || kind === 'raid' || kind === 'siege') return 'randomAshGrove';
    return 'randomAshGrove';
  }

  function publicWorldTaskDetails(task = {}) {
    const details = clone(task?.details || {});
    delete details.rewardMemberKeys;
    delete details.arrivalTransferredPlayerIds;
    delete details.rewardPlayerIds;
    delete details.rewardCharacterIds;
    delete details.eligibleRewardPlayerIds;
    delete details.eligibleRewardCharacterIds;
    delete details.joinedPlayers;
    delete details.playerId;
    delete details.characterId;
    return details;
  }

  function publicWorldEvent(event = {}) {
    return redactPublicIdentityFields(clone(event || {}));
  }

  function redactPublicIdentityFields(value) {
    if (Array.isArray(value)) return value.map(redactPublicIdentityFields);
    if (!value || typeof value !== 'object') return value;
    const hiddenKeys = new Set([
      'userId',
      'accountId',
      'accountLogin',
      'characterId',
      'playerId',
      'socketId',
      'ownerPlayerId',
      'startedByPlayerId'
    ]);
    const out = {};
    for (const [key, row] of Object.entries(value)) {
      if (hiddenKeys.has(key)) continue;
      out[key] = redactPublicIdentityFields(row);
    }
    return out;
  }

  function publicState() {
    cleanupWorldZonesForSingleReality();
    const serverNow = Date.now();
    const publicTask = task => {
      const target = task?.siteId ? state.sites[task.siteId] : null;
      const targetParty = task?.partyId ? state.parties[task.partyId] : null;
      const issuerId = worldTaskIssuerSiteId(task?.type || '', target, task || {});
      const issuer = issuerId ? state.sites[issuerId] : null;
      const taskType = String(task?.type || '');
      const targetPartyKind = String(targetParty?.kind || '').toLowerCase();
      const targetPlayerLimit = targetParty ? worldPartyPlayerLimit(targetParty, task) : 0;
      const targetPlayerCount = targetParty ? worldPartyPlayerCount(targetParty) : 0;
      const targetPartyHasPlayerSlot = !targetPlayerLimit || targetPlayerCount < targetPlayerLimit;
      const canJoinParty = !!(targetParty
        && !targetParty.destroyed
        && targetParty.state !== 'destroyed'
        && targetPartyHasPlayerSlot
        && ((taskType === 'join_patrol' && targetPartyKind === 'patrol')
          || (taskType === 'escort_caravan'
            && targetPartyKind === 'caravan'
            && caravanStagingIsOpen(targetParty))));
      const targetPoint = normalizeWorldPoint(task?.details || {});
      const taskZone = String(task?.type || '') === 'clear_lair'
        ? worldZoneById(task?.details?.worldZoneId || task?.worldZoneId || '')
        : null;
      const targetLocationId = String(taskZone
        ? worldZoneLocationId(taskZone)
        : (String(task?.type || '') === 'clear_lair' && targetParty
          ? lairLocationIdForParty(targetParty)
          : (task?.details?.locationId || target?.locationId || ''))).slice(0, 80);
      const details = publicWorldTaskDetails(task);
      return {
        ...task,
        details: String(task?.type || '') === 'clear_lair'
          ? {
            ...details,
            locationId: targetLocationId,
            encounterId: taskZone ? worldZoneEncounterId(taskZone) : (task.details?.encounterId || (targetParty ? partyMeetingEncounterId(targetParty) : ''))
          }
          : details,
        issuerSiteId: issuerId,
        issuerSiteName: issuer?.name || '',
        targetSiteName: target?.name || '',
        targetPartyName: targetParty?.name || '',
        targetX: targetPoint ? Number(targetPoint.x.toFixed(2)) : undefined,
        targetY: targetPoint ? Number(targetPoint.y.toFixed(2)) : undefined,
        targetLocationId,
        targetPartyKind: targetParty?.kind || '',
        actionMode: canJoinParty ? 'join_party' : '',
        joinPartyId: canJoinParty ? targetParty.id : '',
        joinPartyName: canJoinParty ? targetParty.name : '',
        joinPartyFaction: canJoinParty ? targetParty.faction : '',
        joinPartyKind: canJoinParty ? targetParty.kind : '',
        joinPartyPlayerCount: targetParty ? targetPlayerCount : 0,
        joinPartyPlayerLimit: targetParty ? targetPlayerLimit : 0,
        joinPartySlotsLeft: targetParty ? Math.max(0, targetPlayerLimit - targetPlayerCount) : 0,
        targetPartyDestroyed: !!targetParty?.destroyed
      };
    };
    const taskBoardWeight = task => {
      const active = task?.status === 'active' ? 10000 : 0;
      const type = String(task?.type || '');
      const targetParty = task?.partyId ? state.parties[task.partyId] : null;
      const targetPartyKind = String(targetParty?.kind || '').toLowerCase();
      const targetPlayerLimit = targetParty ? worldPartyPlayerLimit(targetParty, task) : 0;
      const targetPlayerCount = targetParty ? worldPartyPlayerCount(targetParty) : 0;
      const targetPartyHasPlayerSlot = !targetPlayerLimit || targetPlayerCount < targetPlayerLimit;
      const joinable = targetParty && !targetParty.destroyed && targetParty.state !== 'destroyed'
        && targetPartyHasPlayerSlot
        && ((type === 'join_patrol' && targetPartyKind === 'patrol')
          || (type === 'escort_caravan'
            && targetPartyKind === 'caravan'
            && caravanStagingIsOpen(targetParty)));
      const groupWeight = joinable ? 2200 : type === 'clear_lair' ? 900 : 0;
      const urgentWeight = type === 'defend_resource' || type === 'retake_site' ? 450 : 0;
      return active + groupWeight + urgentWeight + clamp(Number(task?.priority || 0), 0, 5) * 90 + Number(task?.createdHour || 0) / 1000;
    };
    return {
      schema: state.schema,
      version: state.version,
      worldHour: Number(Number(state.worldHour || 0).toFixed(2)),
      gameDayRealMs,
      updatedAt: state.updatedAt,
      sampledAt: Math.min(serverNow, Math.max(0, Number(state.lastTickAt || serverNow))),
      serverNow,
      factions: state.factions,
      sites: Object.values(state.sites).filter(siteVisibleOnPublicGlobalMap).map(site => {
        const productionNeedReason = resourceSiteSupportReason(site);
        const productionNeed = productionNeedReason ? resourceSiteSupportDemand(site, productionNeedReason) : {};
        const control = siteControlIntel(site);
        const market = siteMarketIntel(site);
        return {
          id: site.id,
          type: site.type,
          name: site.name,
          x: Number(Number(site.x || 0).toFixed(2)),
          y: Number(Number(site.y || 0).toFixed(2)),
          owner: site.owner,
          pvpMode: site.pvpMode || 'pvp',
          capital: !!site.capital,
          capitalFaction: site.capitalFaction || '',
          locationId: site.locationId || '',
          templateLocationId: site.templateLocationId || '',
          note: site.note || '',
          description: site.description || site.note || '',
          landmark: site.landmark || '',
          sectorCode: site.sectorCode || '',
          localProfileVersion: site.localProfileVersion || 0,
          localWidthTiles: site.localWidthTiles || 0,
          localHeightTiles: site.localHeightTiles || 0,
          localSizeLabel: site.localSizeLabel || '',
          localContentSeed: site.localContentSeed || 0,
          localLayoutVariant: site.localLayoutVariant || 0,
          localContentVariant: site.localContentVariant || 0,
          output: site.output || {},
          production: site.production || {},
          stockpile: site.stockpile || {},
          productionNeed,
          productionNeedReason,
          productionNeedSummary: Object.keys(productionNeed).length ? stockpileSummary(productionNeed) : '',
          control,
          ownerLabel: control.ownerLabel,
          controlState: control.state,
          controlStateLabel: control.stateLabel,
          controlThreatName: control.strongestHostileName,
          controlThreatFaction: control.strongestHostileFaction,
          controlThreatDistanceKm: control.strongestHostileDistanceKm,
          hostilePower: control.hostilePower,
          friendlyPower: control.friendlyPower,
          marketState: market.state,
          marketStateLabel: market.stateLabel,
          marketScarcity: market.scarcity,
          marketAbundance: market.abundance,
          marketPriceMultiplier: market.priceMultiplier,
          marketQuantityMultiplier: market.quantityMultiplier,
          danger: site.danger || 0,
          security: site.security,
          prosperity: site.prosperity,
          resourceRichness: site.resourceRichness || 0,
          resourceDepletion: site.resourceDepletion || 0,
          resourceActivity: site.resourceActivity || 0,
          workforce: site.workforce || 0,
          workers: Array.isArray(site.workers) ? site.workers.slice(0, 12) : [],
          workSummary: site.workSummary || siteWorkSummary(site),
          lastHarvestHour: site.lastHarvestHour || 0,
          protectionLevel: site.protectionLevel || 0,
          protectedBySiteId: site.protectedBySiteId || '',
          raidUntil: site.raidUntil || 0,
          activeConflict: siteConflictPublicSummary(site),
          lastRaidHour: site.lastRaidHour || 0,
          lastRaidFaction: site.lastRaidFaction || '',
          controlPressure: Number(Number(site.controlPressure || 0).toFixed(2)),
          supplyDisruptedUntil: site.supplyDisruptedUntil || 0,
          threatSuppressedUntil: site.threatSuppressedUntil || 0,
          supportBoostUntil: site.supportBoostUntil || 0,
          marketSupplyBoostUntil: site.marketSupplyBoostUntil || 0,
          districtInterest: !!site.districtInterest,
          activityKind: site.activityKind || '',
          districtKey: site.districtKey || '',
          interestExpiresHour: site.interestExpiresHour || 0,
          lastSupplyHour: site.lastSupplyHour || 0,
          lastDelivery: site.lastDelivery || null,
          lastWarehouseDeposit: site.lastWarehouseDeposit || null,
          supportDispatch: site.supportDispatch || null,
          traderProfiles: site.traderProfiles || [],
          productionCapabilities: site.productionCapabilities || [],
          productionQueue: (Array.isArray(site.productionQueue) ? site.productionQueue : []).map(row => ({
            itemId: row.itemId,
            outputQty: row.outputQty,
            remainingHours: Number(Number(row.remainingHours || 0).toFixed(2)),
            priority: row.priority
          })),
          productionDemand: site.productionDemand || {},
          retailDemand: site.retailDemand || {},
          retailMarkets: Object.values(site.retailMarkets || {}).map(row => ({
            key: row.key,
            profileId: row.profileId,
            caps: row.caps,
            stockKinds: normalizeMarketStockRows(row.stock || []).filter(entry => entry.qty > 0).length,
            targetKinds: normalizeTraderPlanRows(row.plan || []).length,
            lastRestockHour: row.lastRestockHour
          }))
        };
      }),
      parties: Object.values(state.parties).map(publicParty),
      threatZones: publicThreatZones(),
      territories: publicTerritories(),
      worldZones: [],
      worldContacts: [],
      events: state.events.slice(0, 30).map(publicWorldEvent),
      worldTasks: state.worldTasks
        .slice()
        .sort((a, b) => {
          const weightDelta = taskBoardWeight(b) - taskBoardWeight(a);
          if (Math.abs(weightDelta) > 0.0001) return weightDelta;
          return Number(b.createdHour || 0) - Number(a.createdHour || 0);
        })
        .slice(0, 30)
        .map(publicTask),
      stats: state.stats
    };
  }

  function publicWorldTasks(ids = []) {
    const orderedIds = [...new Set((Array.isArray(ids) ? ids : [])
      .map(id => safeId(id || '', ''))
      .filter(Boolean))]
      .slice(0, 300);
    if (!orderedIds.length) return [];
    const currentPublic = new Map(publicState().worldTasks.map(task => [String(task?.id || ''), task]));
    const allTasks = [
      ...(Array.isArray(state.worldTasks) ? state.worldTasks : []),
      ...(Array.isArray(state.worldTaskHistory) ? state.worldTaskHistory : [])
    ];
    const rawById = new Map(allTasks.map(task => [String(task?.id || ''), task]));
    return orderedIds.map(id => {
      if (currentPublic.has(id)) return currentPublic.get(id);
      const task = rawById.get(id);
      if (!task) return null;
      const target = task.siteId ? state.sites[task.siteId] : null;
      const targetParty = task.partyId ? state.parties[task.partyId] : null;
      const issuerId = worldTaskIssuerSiteId(task.type || '', target, task);
      const issuer = issuerId ? state.sites[issuerId] : null;
      const targetPoint = normalizeWorldPoint(task.details || {});
      const taskZone = String(task.type || '') === 'clear_lair'
        ? worldZoneById(task.details?.worldZoneId || task.worldZoneId || '')
        : null;
      const targetLocationId = String(taskZone
        ? worldZoneLocationId(taskZone)
        : (task.details?.locationId || target?.locationId || '')).slice(0, 80);
      return {
        ...task,
        details: publicWorldTaskDetails(task),
        issuerSiteId: issuerId,
        issuerSiteName: issuer?.name || '',
        targetSiteName: target?.name || '',
        targetPartyName: targetParty?.name || '',
        targetX: targetPoint ? Number(targetPoint.x.toFixed(2)) : undefined,
        targetY: targetPoint ? Number(targetPoint.y.toFixed(2)) : undefined,
        targetLocationId,
        targetPartyKind: targetParty?.kind || '',
        targetPartyDestroyed: !!targetParty?.destroyed
      };
    }).filter(Boolean);
  }

  function recordWorldTaskPlayerTransfer(taskId = '', playerIds = []) {
    const id = safeId(taskId || '', '');
    const transferredIds = [...new Set((Array.isArray(playerIds) ? playerIds : [playerIds])
      .map(value => safeTransferIdentity(value || ''))
      .filter(Boolean))]
      .slice(0, 20);
    if (!id || !transferredIds.length) return false;
    let changed = false;
    for (const tasks of [state.worldTasks, state.worldTaskHistory]) {
      for (const task of Array.isArray(tasks) ? tasks : []) {
        if (!task || String(task.id || '') !== id) continue;
        task.details = task.details && typeof task.details === 'object' ? task.details : {};
        const previous = (Array.isArray(task.details.arrivalTransferredPlayerIds)
          ? task.details.arrivalTransferredPlayerIds
          : [])
          .map(value => safeTransferIdentity(value || ''))
          .filter(Boolean);
        const next = [...new Set([...previous, ...transferredIds])].slice(-100);
        if (next.length === previous.length && next.every((value, index) => value === previous[index])) continue;
        task.details.arrivalTransferredPlayerIds = next;
        changed = true;
      }
    }
    if (changed) {
      dirty = true;
      save(true);
    }
    return changed;
  }

  function parseStockpileObject(input = {}) {
    const out = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    Object.entries(input).forEach(([key, value]) => {
      const id = safeId(key, '');
      if (!id) return;
      const amount = Number(value || 0);
      if (Number.isFinite(amount) && amount >= 0) out[id] = Number(amount.toFixed(3));
    });
    return out;
  }

  function normalizeSiteType(value = '') {
    const key = String(value || '').trim();
    if (key === 'settlement' || key === 'resource' || key === 'outpost' || key === 'production' || key === 'pointOfInterest') return key;
    if (key.toLowerCase() === 'poi' || key.toLowerCase() === 'pointofinterest') return 'pointOfInterest';
    return 'resource';
  }

  function normalizePvpMode(value = '') {
    const key = String(value || '').trim();
    if (key === 'peaceful' || key === 'pvp' || key === 'pvpFullDrop') return key;
    return 'pvp';
  }

  function upsertSite(input = {}) {
    const id = safeId(input.id || input.name || 'world_site', 'world_site');
    const prev = state.sites[id] || {};
    const globalMap = getGlobalMap();
    const point = globalMapCellCenter({ x: input.x ?? prev.x ?? 0, y: input.y ?? prev.y ?? 0 }, globalMap);
    const requestedLocationId = safeId(input.locationId || prev.templateLocationId || prev.locationId || '', '');
    const duplicateLocationSite = requestedLocationId
      ? Object.values(state.sites || {}).find(row => row && row.id !== id && row.locationId === requestedLocationId)
      : null;
    const templateLocationId = safeId(
      input.templateLocationId || (input.locationId ? input.locationId : prev.templateLocationId) || duplicateLocationSite?.templateLocationId || '',
      ''
    );
    const useLocationInstance = !!(templateLocationId || duplicateLocationSite);
    const site = {
      ...prev,
      id,
      type: normalizeSiteType(input.type || prev.type),
      name: String(input.name || prev.name || id).trim().slice(0, 96) || id,
      x: point.x,
      y: point.y,
      owner: safeId(input.owner || prev.owner || 'neutral', 'neutral'),
      pvpMode: normalizePvpMode(input.pvpMode || prev.pvpMode || 'pvp'),
      locationId: useLocationInstance ? worldSiteLocationId(id) : requestedLocationId,
      templateLocationId: useLocationInstance ? (templateLocationId || requestedLocationId) : '',
      note: String(input.note || prev.note || '').trim().slice(0, 240),
      description: String(input.description || input.note || prev.description || prev.note || '').trim().slice(0, 480),
      security: clamp(input.security ?? prev.security ?? siteDefaultSecurity(prev), 0, 100),
      prosperity: input.prosperity === '' || input.prosperity === null
        ? prev.prosperity
        : clamp(input.prosperity ?? prev.prosperity ?? 0, 0, 100),
      danger: clamp(input.danger ?? prev.danger ?? 0, 0, 5),
      controlPressure: clamp(input.controlPressure ?? prev.controlPressure ?? 0, -30, 30),
      stockpile: parseStockpileObject(input.stockpile || prev.stockpile || emptyStockpile()),
      output: parseStockpileObject(input.output || prev.output || {}),
      production: parseStockpileObject(input.production || prev.production || {}),
      productionCapabilities: Array.isArray(input.productionCapabilities)
        ? input.productionCapabilities.map(row => safeId(row, '')).filter(Boolean).slice(0, 12)
        : (Array.isArray(prev.productionCapabilities) ? prev.productionCapabilities : []),
      productionQueue: Array.isArray(prev.productionQueue) ? prev.productionQueue : [],
      productionDemand: parseStockpileObject(prev.productionDemand || {}),
      retailDemand: parseStockpileObject(prev.retailDemand || {}),
      retailMarkets: prev.retailMarkets && typeof prev.retailMarkets === 'object' ? prev.retailMarkets : {},
      traderProfiles: Array.isArray(input.traderProfiles)
        ? input.traderProfiles.map(row => safeId(row, '')).filter(Boolean).slice(0, 12)
        : (Array.isArray(prev.traderProfiles) ? prev.traderProfiles : [])
    };
    site.resourceRichness = clamp(input.resourceRichness ?? prev.resourceRichness ?? defaultResourceRichness(site), 0, 100);
    site.resourceDepletion = clamp(input.resourceDepletion ?? prev.resourceDepletion ?? 0, 0, 100);
    site.workforce = clamp(input.workforce ?? prev.workforce ?? (isHarvestSite(site) ? 45 : isProductionSite(site) ? 35 : 0), 0, 100);
    site.protectionLevel = clamp(input.protectionLevel ?? prev.protectionLevel ?? 0, 0, 100);
    site.protectedBySiteId = safeId(input.protectedBySiteId || prev.protectedBySiteId || '', '');
    site.raidUntil = Number.isFinite(Number(input.raidUntil ?? prev.raidUntil)) ? Number(input.raidUntil ?? prev.raidUntil) : 0;
    site.lastRaidHour = Number.isFinite(Number(input.lastRaidHour ?? prev.lastRaidHour)) ? Number(input.lastRaidHour ?? prev.lastRaidHour) : -999;
    site.lastRaidFaction = safeId(input.lastRaidFaction || prev.lastRaidFaction || '', '');
    site.activeConflict = input.activeConflict && typeof input.activeConflict === 'object'
      ? clone(input.activeConflict)
      : (prev.activeConflict && typeof prev.activeConflict === 'object' ? clone(prev.activeConflict) : null);
    site.resourceActivity = resourceActivityPercent(site, state.worldHour);
    state.sites[id] = site;
    ensureUniqueWorldSiteLocationIds(state.sites);
    dirty = true;
    addEvent('site_edited', `${site.name} обновлена на глобальной карте.`, {
      siteId: id,
      x: Number(site.x.toFixed(1)),
      y: Number(site.y.toFixed(1)),
      owner: site.owner,
      siteType: site.type
    });
    save(true);
    return publicState();
  }

  function deleteSite(id = '') {
    const key = safeId(id, '');
    const site = key ? state.sites[key] : null;
    if (!site || site.type === 'settlement') return publicState();
    delete state.sites[key];
    dirty = true;
    addEvent('site_deleted', `${site.name || key} удалена с глобальной карты.`, { siteId: key });
    save(true);
    return publicState();
  }

  function reset() {
    state = defaultState(getGlobalMap());
    dirty = true;
    save(true);
    return publicState();
  }

  syncGlobalMap(getGlobalMap());
  expireWorldTasks();
  save(true);

  return {
    tick,
    save,
    reset,
    publicState,
    publicWorldTasks,
    recordWorldTaskPlayerTransfer,
    syncGlobalMap,
    applyTraderSupply,
    applyNpcTraderTransaction,
    consumeTraderStock,
    receiveTraderStock,
    applyTradeMachineTransaction,
    syncTraderMarket,
    performVisibleSiteWork,
    recordEncounterOutcome,
    syncBattleZoneActors,
    syncOnsitePartyActors,
    completeOnsitePartyDeparture,
    beginPartyEncounterZone,
    finishPartyEncounterZone,
    partyEncounterSnapshot,
    worldZoneById,
    activeBattleZoneForRoom,
    claimClearedSite,
    completeWorldTaskDelivery,
    joinWorldParty,
    leaveWorldParty,
    reconcileWorldPartyMembers,
    upsertSite,
    deleteSite,
    state: () => state
  };
}

module.exports = {
  ROAD_SITE_LAYOUT_VERSION,
  createWastelandSimulation,
  worldSiteLocationId,
  worldSiteLocationSeed,
  ensureUniqueWorldSiteLocalProfiles
};
