'use strict';

const REFUGEE_FLOW_VERSION = 1;
const DEFAULT_MAX_ACTIVE_GROUPS = 24;
const DEFAULT_MAX_HISTORY = 48;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function safeId(value = '', fallback = '') {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return id || fallback;
}

function textHash(value = '') {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function refugeeConfig(config = {}) {
  const source = config.refugees && typeof config.refugees === 'object' ? config.refugees : {};
  return {
    maxActiveGroups: Math.max(4, Math.floor(Number(source.maxActiveGroups || DEFAULT_MAX_ACTIVE_GROUPS))),
    maxHistory: Math.max(8, Math.floor(Number(source.maxHistory || DEFAULT_MAX_HISTORY))),
    travelSpeedKmh: clamp(source.travelSpeedKmh || 7, 2, 18),
    minimumDestinationSecurity: clamp(source.minimumDestinationSecurity ?? 35, 0, 100),
    minimumWaterReserveDays: clamp(source.minimumWaterReserveDays ?? 1.5, 0.25, 30),
    departureDelayHoursMin: clamp(source.departureDelayHoursMin ?? 2, 0, 24),
    departureDelayHoursMax: clamp(source.departureDelayHoursMax ?? 8, 0, 48),
    humanitarianTaskDurationHours: Math.max(24, Number(source.humanitarianTaskDurationHours || 72)),
    arrivalTensionPer100: clamp(source.arrivalTensionPer100 ?? 10, 0, 40)
  };
}

function settlementLife(site = {}) {
  return site.settlementLife && typeof site.settlementLife === 'object'
    ? site.settlementLife
    : {};
}

function waterReserveDays(site = {}) {
  const life = settlementLife(site);
  const recorded = Number(life.reserveDays?.water);
  if (Number.isFinite(recorded)) return Math.max(0, recorded);
  const population = Math.max(1, Number(life.population || 80));
  const water = Math.max(0, Number(site.stockpile?.water || 0));
  return round(water / Math.max(1, population / 100 * 8), 2);
}

function viableSettlement(site = {}, originSiteId = '', config = {}) {
  const rules = refugeeConfig(config);
  if (!site || safeId(site.id || '') === safeId(originSiteId || '')) return false;
  if (String(site.type || '').toLowerCase() !== 'settlement') return false;
  if (site.destroyed === true || site.offMap === true || site.roadAccess === false) return false;
  if (!Number.isFinite(Number(site.x)) || !Number.isFinite(Number(site.y))) return false;
  const life = settlementLife(site);
  if (String(life.condition || '').toLowerCase() === 'crisis') return false;
  if (Number(site.security || 0) < rules.minimumDestinationSecurity) return false;
  return waterReserveDays(site) >= rules.minimumWaterReserveDays;
}

function selectRefugeeDestination(origin = {}, sites = {}, config = {}) {
  const rows = Array.isArray(sites) ? sites : Object.values(sites || {});
  return rows
    .filter(site => viableSettlement(site, origin.id, config))
    .map(site => {
      const distance = Math.hypot(Number(site.x || 0) - Number(origin.x || 0), Number(site.y || 0) - Number(origin.y || 0));
      const securityPenalty = Math.max(0, 70 - Number(site.security || 0)) * 0.04;
      const waterPenalty = 1 / Math.max(0.25, waterReserveDays(site));
      const tensionPenalty = Number(settlementLife(site).tension || 0) * 0.01;
      return { site, score: distance + securityPenalty + waterPenalty + tensionPenalty };
    })
    .sort((left, right) => left.score - right.score || String(left.site.id).localeCompare(String(right.site.id)))[0]?.site || null;
}

function normalizeRefugeeFlow(flow = {}) {
  const members = Math.max(1, Math.floor(Number(flow.members || 1)));
  const status = ['assembling', 'moving', 'stranded', 'arrived'].includes(String(flow.status || ''))
    ? String(flow.status)
    : 'moving';
  return {
    version: REFUGEE_FLOW_VERSION,
    id: safeId(flow.id || '', 'refugees'),
    kind: 'refugees',
    name: String(flow.name || 'Группа беженцев').slice(0, 96),
    faction: 'neutral',
    originSiteId: safeId(flow.originSiteId || '', ''),
    originSiteName: String(flow.originSiteName || '').slice(0, 96),
    destinationSiteId: safeId(flow.destinationSiteId || '', ''),
    destinationSiteName: String(flow.destinationSiteName || '').slice(0, 96),
    causeCode: safeId(flow.causeCode || 'settlement_crisis', 'settlement_crisis'),
    motive: String(flow.motive || 'Ищут безопасное поселение с водой.').slice(0, 220),
    members,
    x: Number.isFinite(Number(flow.x)) ? Number(flow.x) : 0,
    y: Number.isFinite(Number(flow.y)) ? Number(flow.y) : 0,
    speedKmh: clamp(flow.speedKmh || 7, 2, 18),
    supplies: {
      water: Math.max(0, Math.floor(Number(flow.supplies?.water || 0))),
      food: Math.max(0, Math.floor(Number(flow.supplies?.food || 0))),
      medicine: Math.max(0, Math.floor(Number(flow.supplies?.medicine || 0)))
    },
    status,
    createdHour: Math.max(0, Number(flow.createdHour || 0)),
    departAtHour: Math.max(0, Number(flow.departAtHour || 0)),
    lastUpdatedHour: Math.max(0, Number(flow.lastUpdatedHour || flow.createdHour || 0)),
    arrivedHour: Math.max(0, Number(flow.arrivedHour || 0)),
    nextRerouteHour: Math.max(0, Number(flow.nextRerouteHour || 0))
  };
}

function normalizeRefugeeState(input = {}, config = {}) {
  const rules = refugeeConfig(config);
  const source = input && typeof input === 'object' ? input : {};
  const activeRows = Array.isArray(source.active) ? source.active : Object.values(source.active || {});
  const active = {};
  for (const row of activeRows.slice(0, rules.maxActiveGroups)) {
    const flow = normalizeRefugeeFlow(row);
    if (flow.id && flow.status !== 'arrived') active[flow.id] = flow;
  }
  return {
    version: REFUGEE_FLOW_VERSION,
    sequence: Math.max(0, Math.floor(Number(source.sequence || 0))),
    active,
    history: (Array.isArray(source.history) ? source.history : [])
      .map(normalizeRefugeeFlow)
      .filter(flow => flow.status === 'arrived')
      .slice(0, rules.maxHistory)
  };
}

function refugeeDepartureDelay(originId = '', worldHour = 0, config = {}) {
  const rules = refugeeConfig(config);
  const min = Math.min(rules.departureDelayHoursMin, rules.departureDelayHoursMax);
  const max = Math.max(rules.departureDelayHoursMin, rules.departureDelayHoursMax);
  if (max <= min) return min;
  return round(min + (textHash(`${originId}:${Math.floor(Number(worldHour || 0) / 24)}`) % 1000) / 999 * (max - min), 2);
}

function createRefugeeFlow(refugeeState = {}, origin = {}, migrated = 0, sites = {}, worldHour = 0, config = {}) {
  const rules = refugeeConfig(config);
  const count = Math.max(0, Math.floor(Number(migrated || 0)));
  if (!origin?.id || count <= 0) return { flow: null, created: false };
  const normalized = normalizeRefugeeState(refugeeState, config);
  Object.assign(refugeeState, normalized);
  const sameOrigin = Object.values(refugeeState.active).find(flow => (
    flow.originSiteId === safeId(origin.id) && Number(worldHour || 0) - Number(flow.createdHour || 0) < 24
  ));
  if (sameOrigin) {
    sameOrigin.members += count;
    sameOrigin.supplies.water += Math.max(1, Math.ceil(count * 0.04));
    sameOrigin.supplies.food += Math.max(1, Math.ceil(count * 0.03));
    sameOrigin.lastUpdatedHour = Number(worldHour || 0);
    return { flow: sameOrigin, created: false };
  }
  const activeRows = Object.values(refugeeState.active);
  if (activeRows.length >= rules.maxActiveGroups) {
    const mergeTarget = activeRows.sort((a, b) => Number(a.createdHour || 0) - Number(b.createdHour || 0))[0];
    mergeTarget.members += count;
    mergeTarget.lastUpdatedHour = Number(worldHour || 0);
    return { flow: mergeTarget, created: false, capacityMerged: true };
  }
  const destination = selectRefugeeDestination(origin, sites, config);
  refugeeState.sequence += 1;
  const delay = refugeeDepartureDelay(origin.id, worldHour, config);
  const id = `refugees_${safeId(origin.id, 'origin')}_${Math.floor(Number(worldHour || 0) * 10)}_${refugeeState.sequence}`;
  const flow = normalizeRefugeeFlow({
    id,
    name: `Беженцы из ${origin.name || origin.id}`,
    originSiteId: origin.id,
    originSiteName: origin.name || origin.id,
    destinationSiteId: destination?.id || '',
    destinationSiteName: destination?.name || '',
    causeCode: origin.settlementLife?.causeCode || 'settlement_crisis',
    motive: destination
      ? `Покинули ${origin.name || origin.id} из-за кризиса. Идут в ${destination.name || destination.id}: там есть вода и охрана.`
      : `Покинули ${origin.name || origin.id} из-за кризиса, но безопасный путь пока не найден.`,
    members: count,
    x: origin.x,
    y: origin.y,
    speedKmh: rules.travelSpeedKmh,
    supplies: {
      water: Math.max(1, Math.ceil(count * 0.04)),
      food: Math.max(1, Math.ceil(count * 0.03)),
      medicine: Math.max(0, Math.ceil(count * 0.008))
    },
    status: destination ? 'assembling' : 'stranded',
    createdHour: worldHour,
    departAtHour: Number(worldHour || 0) + delay,
    lastUpdatedHour: worldHour,
    nextRerouteHour: Number(worldHour || 0) + 6
  });
  refugeeState.active[flow.id] = flow;
  return { flow, created: true };
}

function addArrivalsToSettlement(site = {}, members = 0, config = {}) {
  const count = Math.max(0, Math.floor(Number(members || 0)));
  if (!site || count <= 0) return 0;
  const life = settlementLife(site);
  life.population = Math.max(1, Math.floor(Number(life.population || 1))) + count;
  life.tension = clamp(Number(life.tension || 0) + count / 100 * refugeeConfig(config).arrivalTensionPer100, 0, 100);
  life.lastRefugeeArrival = count;
  site.settlementLife = life;
  return count;
}

function advanceRefugeeFlows(refugeeState = {}, sites = {}, hours = 0, worldHour = 0, options = {}) {
  const config = options.config || {};
  const rules = refugeeConfig(config);
  const normalized = normalizeRefugeeState(refugeeState, config);
  Object.assign(refugeeState, normalized);
  const pointKm = Math.max(0.001, Number(options.pointKm || 1));
  const arrivals = [];
  const reroutes = [];
  for (const flow of Object.values(refugeeState.active)) {
    if (!flow) continue;
    let destination = sites?.[flow.destinationSiteId] || null;
    if ((!destination || !viableSettlement(destination, flow.originSiteId, config))
      && Number(worldHour || 0) >= Number(flow.nextRerouteHour || 0)) {
      destination = selectRefugeeDestination({ id: flow.originSiteId, x: flow.x, y: flow.y }, sites, config);
      flow.destinationSiteId = safeId(destination?.id || '', '');
      flow.destinationSiteName = String(destination?.name || '').slice(0, 96);
      flow.status = destination ? 'moving' : 'stranded';
      flow.nextRerouteHour = Number(worldHour || 0) + 6;
      reroutes.push(flow.id);
    }
    if (!destination) {
      flow.status = 'stranded';
      flow.lastUpdatedHour = Number(worldHour || 0);
      continue;
    }
    if (Number(worldHour || 0) < Number(flow.departAtHour || 0)) {
      flow.status = 'assembling';
      continue;
    }
    flow.status = 'moving';
    const dx = Number(destination.x || 0) - Number(flow.x || 0);
    const dy = Number(destination.y || 0) - Number(flow.y || 0);
    const distancePoints = Math.hypot(dx, dy);
    const travelPoints = Math.max(0, Number(flow.speedKmh || rules.travelSpeedKmh) * Math.max(0, Number(hours || 0)) / pointKm);
    if (distancePoints <= Math.max(0.25, travelPoints)) {
      flow.x = Number(destination.x || 0);
      flow.y = Number(destination.y || 0);
      flow.status = 'arrived';
      flow.arrivedHour = Number(worldHour || 0);
      flow.lastUpdatedHour = Number(worldHour || 0);
      addArrivalsToSettlement(destination, flow.members, config);
      arrivals.push({ flow: { ...flow, supplies: { ...flow.supplies } }, destination });
      delete refugeeState.active[flow.id];
      refugeeState.history = [flow, ...refugeeState.history]
        .sort((a, b) => Number(b.arrivedHour || 0) - Number(a.arrivedHour || 0))
        .slice(0, rules.maxHistory);
      continue;
    }
    const progress = distancePoints > 0 ? travelPoints / distancePoints : 1;
    flow.x = round(Number(flow.x || 0) + dx * progress, 4);
    flow.y = round(Number(flow.y || 0) + dy * progress, 4);
    flow.lastUpdatedHour = Number(worldHour || 0);
  }
  return { arrivals, reroutes, activeCount: Object.keys(refugeeState.active).length };
}

function publicRefugeeFlow(flow = {}, sites = {}) {
  const normalized = normalizeRefugeeFlow(flow);
  const destination = sites?.[normalized.destinationSiteId] || null;
  const statusLabel = {
    assembling: 'собираются у выхода',
    moving: 'в пути',
    stranded: 'застряли без безопасного маршрута',
    arrived: 'прибыли'
  }[normalized.status] || normalized.status;
  const movementRoutePoints = [{ x: round(normalized.x), y: round(normalized.y) }];
  if (destination && normalized.status === 'moving') {
    movementRoutePoints.push({ x: round(destination.x), y: round(destination.y) });
  }
  return {
    ...normalized,
    state: normalized.status,
    destroyed: false,
    dynamic: true,
    respawnDisabled: true,
    strength: Math.max(1, Math.ceil(normalized.members / 8)),
    visual: 'wastelandSettler',
    encounterId: '',
    movementRoutePoints,
    destinationSiteName: destination?.name || normalized.destinationSiteName,
    decisionKind: 'migration',
    decisionReason: normalized.causeCode,
    statusText: `${normalized.members} чел. · ${statusLabel}. ${normalized.motive}`,
    canEncounter: false,
    aggregated: true
  };
}

function settlementSceneVariant(site = {}, config = {}, worldHour = 0) {
  if (!site || String(site.type || '').toLowerCase() !== 'settlement') return null;
  const life = settlementLife(site);
  const condition = String(life.condition || 'stable').toLowerCase();
  const threatened = Number(site.security || 0) < 45
    || Number(site.raidUntil || 0) > Number(worldHour || 0)
    || !!site.activeConflict;
  const queue = condition === 'shortage' || condition === 'crisis';
  const repairs = condition === 'recovering' || Number(life.integrity ?? 100) < 60;
  const actors = [];
  if (queue) actors.push({ role: 'civilian', label: 'житель в очереди за пайком', count: condition === 'crisis' ? 4 : 3, activity: 'queue' });
  if (threatened) actors.push({ role: 'guard', label: 'ополченец у баррикады', count: Number(site.security || 0) < 25 ? 4 : 2, activity: 'barricade' });
  if (repairs) actors.push({ role: 'mechanic', label: 'ремонтник аварийной бригады', count: condition === 'recovering' ? 3 : 2, activity: 'repair' });
  let remaining = 8;
  const boundedActors = actors.map(row => {
    const count = Math.max(0, Math.min(remaining, Math.floor(Number(row.count || 0))));
    remaining -= count;
    return { ...row, count };
  }).filter(row => row.count > 0);
  const tags = [];
  if (queue) tags.push('ration_queue');
  if (threatened) tags.push('barricades');
  if (repairs) tags.push('repair_crew');
  return {
    version: REFUGEE_FLOW_VERSION,
    code: condition,
    causeCode: String(life.causeCode || 'stable_supplies').slice(0, 48),
    label: {
      stable: 'обычная жизнь',
      shortage: 'очереди за пайками',
      crisis: 'кризисный режим',
      recovering: 'восстановление'
    }[condition] || 'обычная жизнь',
    queue,
    barricades: threatened,
    repairCrew: repairs,
    actorBudget: boundedActors.reduce((sum, row) => sum + row.count, 0),
    actors: boundedActors,
    environmentTags: tags,
    revisionKey: `${condition}:${threatened ? 1 : 0}:${repairs ? 1 : 0}`
  };
}

module.exports = {
  REFUGEE_FLOW_VERSION,
  addArrivalsToSettlement,
  advanceRefugeeFlows,
  createRefugeeFlow,
  normalizeRefugeeFlow,
  normalizeRefugeeState,
  publicRefugeeFlow,
  refugeeConfig,
  selectRefugeeDestination,
  settlementSceneVariant,
  viableSettlement,
  waterReserveDays
};
