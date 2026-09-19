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
  normalizeRefugeeFlow,
  normalizeRefugeeState,
  publicRefugeeFlow,
  refugeeConfig,
  settlementSceneVariant
};
