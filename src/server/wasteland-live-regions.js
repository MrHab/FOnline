'use strict';

const LIVE_REGION_SCHEMA = 'realm.wastelandLiveRegion.v1';
const LIVE_EVENT_SCHEMA = 'realm.wastelandLiveEvent.v1';
const PUBLIC_LIVE_ACTIVITY_LIMIT = 3;
const DEFAULT_AFTERMATH_HOURS = 18;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function rounded(value) {
  return Math.round(clamp(value));
}

function metric(value, bands) {
  const current = rounded(value);
  const band = bands.find(row => current < row.until) || bands[bands.length - 1];
  return {
    value: current,
    state: band.state,
    label: band.label,
    tone: band.tone
  };
}

const SUPPLY_BANDS = [
  { until: 25, state: 'critical', label: 'критическое', tone: 'danger' },
  { until: 45, state: 'shortage', label: 'дефицит', tone: 'warning' },
  { until: 72, state: 'stable', label: 'стабильное', tone: 'stable' },
  { until: 101, state: 'abundant', label: 'избыток', tone: 'good' }
];

const SECURITY_BANDS = [
  { until: 25, state: 'dangerous', label: 'опасно', tone: 'danger' },
  { until: 45, state: 'unrest', label: 'тревожно', tone: 'warning' },
  { until: 72, state: 'stable', label: 'спокойно', tone: 'stable' },
  { until: 101, state: 'secure', label: 'защищено', tone: 'good' }
];

const INFLUENCE_BANDS = [
  { until: 25, state: 'collapsing', label: 'теряется', tone: 'danger' },
  { until: 45, state: 'contested', label: 'оспаривается', tone: 'warning' },
  { until: 72, state: 'stable', label: 'устойчивое', tone: 'stable' },
  { until: 101, state: 'strong', label: 'сильное', tone: 'good' }
];

function normalizeAftermath(row = {}, siteId = '') {
  if (!row || typeof row !== 'object') return null;
  const expiresHour = Math.max(0, Number(row.expiresHour || 0));
  if (expiresHour <= 0) return null;
  return {
    kind: String(row.kind || '').slice(0, 48),
    outcome: ['success', 'failure', 'partial'].includes(String(row.outcome || '').toLowerCase())
      ? String(row.outcome).toLowerCase()
      : 'partial',
    title: String(row.title || '').slice(0, 120),
    text: String(row.text || '').slice(0, 320),
    siteId: String(row.siteId || siteId || '').slice(0, 80),
    startedHour: Math.max(0, Number(row.startedHour || 0)),
    expiresHour,
    deltas: {
      supply: clamp(row.deltas?.supply || 0, -40, 40),
      security: clamp(row.deltas?.security || 0, -40, 40),
      influence: clamp(row.deltas?.influence || 0, -40, 40)
    },
    participantCount: Math.max(0, Math.floor(Number(row.participantCount || 0))),
    contribution: Math.max(0, Math.floor(Number(row.contribution || 0)))
  };
}

function normalizeLiveRegion(row = {}, siteId = '') {
  const source = row && typeof row === 'object' ? row : {};
  return {
    schema: LIVE_REGION_SCHEMA,
    siteId: String(source.siteId || siteId || '').slice(0, 80),
    lastUpdatedHour: Math.max(0, Number(source.lastUpdatedHour || 0)),
    cooldownUntil: Math.max(0, Number(source.cooldownUntil || 0)),
    lastActivityKind: String(source.lastActivityKind || '').slice(0, 48),
    lastOutcome: String(source.lastOutcome || '').slice(0, 24),
    aftermath: normalizeAftermath(source.aftermath, source.siteId || siteId)
  };
}

function normalizeLiveRegions(rows = {}) {
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return {};
  return Object.fromEntries(Object.entries(rows)
    .map(([siteId, row]) => [String(siteId).slice(0, 80), normalizeLiveRegion(row, siteId)])
    .filter(([siteId]) => !!siteId));
}

function activeAftermath(row = {}, worldHour = 0) {
  const aftermath = normalizeAftermath(row?.aftermath, row?.siteId || '');
  return aftermath && aftermath.expiresHour > Number(worldHour || 0) ? aftermath : null;
}

function deriveLiveRegion(site = {}, context = {}) {
  const worldHour = Number(context.worldHour || 0);
  const market = context.market && typeof context.market === 'object' ? context.market : {};
  const control = context.control && typeof context.control === 'object' ? context.control : {};
  const stored = normalizeLiveRegion(context.stored, site.id || '');
  const aftermath = activeAftermath(stored, worldHour);
  const deltas = aftermath?.deltas || {};
  const stockTotal = Object.values(site.stockpile || {}).reduce((sum, amount) => sum + Math.max(0, Number(amount || 0)), 0);
  const supplyBase = market.state === 'blockade'
    ? 18
    : market.state === 'shortage'
      ? 38
      : market.state === 'supplied'
        ? 82
        : clamp(62 - Number(market.scarcity || 0) * 0.72
          + Number(market.abundance || 0) * 0.22
          + Math.min(12, stockTotal * 0.12));
  const activeConflictPenalty = site.activeConflict ? 20 : 0;
  const securityBase = clamp(
    (Number.isFinite(Number(site.security)) ? Number(site.security) : 50)
    - Number(site.danger || 0) * 3
    - activeConflictPenalty
    + (Number(site.threatSuppressedUntil || 0) > worldHour ? 8 : 0)
    + (Number(site.defenseBoostUntil || 0) > worldHour ? 8 : 0)
  );
  const pressure = Number(control.pressure || site.controlPressure || 0);
  const powerDelta = Number(control.friendlyPower || 0) - Number(control.hostilePower || 0);
  const neutralBase = String(site.owner || 'neutral') === 'neutral' ? 52 : 68;
  const influenceBase = clamp(neutralBase - Math.max(0, pressure) * 3.2 + Math.min(12, Math.max(-18, powerDelta * 0.16)));
  const supply = metric(supplyBase + Number(deltas.supply || 0), SUPPLY_BANDS);
  const security = metric(securityBase + Number(deltas.security || 0), SECURITY_BANDS);
  const influence = metric(influenceBase + Number(deltas.influence || 0), INFLUENCE_BANDS);
  const metrics = [
    { ...supply, key: 'supply', title: 'Снабжение' },
    { ...security, key: 'security', title: 'Безопасность' },
    { ...influence, key: 'influence', title: 'Влияние' }
  ];
  const weakest = metrics.slice().sort((left, right) => left.value - right.value)[0];
  const dangerCount = metrics.filter(row => row.tone === 'danger').length;
  const warningCount = metrics.filter(row => row.tone === 'warning').length;
  const overallState = dangerCount > 0 ? 'critical' : warningCount > 0 ? 'unstable' : 'stable';
  const overallLabel = overallState === 'critical' ? 'нужна помощь' : overallState === 'unstable' ? 'напряжённо' : 'стабильно';
  const siteType = String(site.type || '').toLowerCase();
  let nextActivityKind = '';
  let nextActivityLabel = '';
  if (supply.value < 45) {
    nextActivityKind = siteType === 'resource' ? 'resource_expedition' : 'escort_caravan';
    nextActivityLabel = siteType === 'resource' ? 'Вылазка за ресурсами' : 'Караван снабжения';
  } else if (security.value < 38) {
    nextActivityKind = siteType === 'outpost' ? 'outpost_defense' : 'distress_signal';
    nextActivityLabel = siteType === 'outpost' ? 'Защита аванпоста' : 'Сигнал бедствия';
  } else if (influence.value < 42) {
    nextActivityKind = 'assault_diversion';
    nextActivityLabel = 'Штурм или диверсия';
  } else if (siteType === 'pointofinterest' && Number(site.reconIntelUntil || 0) <= worldHour) {
    nextActivityKind = 'recon_expedition';
    nextActivityLabel = 'Разведка';
  }
  return {
    schema: LIVE_REGION_SCHEMA,
    siteId: String(site.id || '').slice(0, 80),
    siteName: String(site.name || site.id || '').slice(0, 120),
    supply,
    security,
    influence,
    overallState,
    overallLabel,
    cause: weakest.key,
    causeLabel: `${weakest.title}: ${weakest.label}`,
    urgency: Math.round(clamp((100 - weakest.value) + dangerCount * 15 + warningCount * 6, 0, 140)),
    nextActivity: nextActivityKind ? { kind: nextActivityKind, label: nextActivityLabel } : null,
    cooldownUntil: stored.cooldownUntil,
    aftermath,
    updatedHour: Number(worldHour.toFixed(2))
  };
}

function activityConsequences(kind = '', success = true) {
  const rows = {
    resource_expedition: success
      ? { supply: 20, security: 3, influence: 0, title: 'Запасы пополнены', text: 'Добытые ресурсы стабилизировали снабжение района.' }
      : { supply: -10, security: -5, influence: 0, title: 'Вылазка сорвалась', text: 'Дефицит усилился, а дороги стали опаснее.' },
    recon_expedition: success
      ? { supply: 0, security: 14, influence: 5, title: 'Маршруты разведаны', text: 'Засады отмечены, ближайшие операции стали безопаснее.' }
      : { supply: 0, security: -8, influence: -4, title: 'Разведданных нет', text: 'Угрозы сохранили инициативу в этом районе.' },
    outpost_defense: success
      ? { supply: 4, security: 20, influence: 10, title: 'Аванпост удержан', text: 'Оборона укрепила безопасность и влияние защитников.' }
      : { supply: -8, security: -18, influence: -12, title: 'Оборона прорвана', text: 'Район временно потерял защиту и часть снабжения.' },
    distress_signal: success
      ? { supply: 4, security: 15, influence: 6, title: 'Люди спасены', text: 'Сигнал закрыт, дороги вокруг снова под наблюдением.' }
      : { supply: -5, security: -12, influence: -6, title: 'Помощь не успела', text: 'Нападение усилило страх и активность врагов.' },
    assault_diversion: success
      ? { supply: 3, security: 9, influence: 18, title: 'Угроза подавлена', text: 'Вражеское влияние ослабло, район получил передышку.' }
      : { supply: -4, security: -10, influence: -12, title: 'Операция провалена', text: 'Противник укрепился, но последствия останутся временными.' },
    escort_caravan: success
      ? { supply: 22, security: 4, influence: 5, title: 'Караван прибыл', text: 'Груз пополнил запасы и оживил местную торговлю.' }
      : { supply: -14, security: -8, influence: -4, title: 'Караван потерян', text: 'Поставки сорваны, на маршруте выросла угроза.' }
  };
  return rows[kind] || (success
    ? { supply: 4, security: 4, influence: 4, title: 'Событие завершено', text: 'Игроки временно улучшили положение района.' }
    : { supply: -3, security: -3, influence: -3, title: 'Событие сорвалось', text: 'Положение района временно ухудшилось.' });
}

function applyActivityOutcome(stored = {}, data = {}) {
  const now = Math.max(0, Number(data.worldHour || 0));
  const kind = String(data.kind || '').slice(0, 48);
  const success = data.success !== false;
  const grade = String(data.grade || (success ? 'completed' : 'failed')).toLowerCase();
  const gradeScale = grade === 'mastered' ? 1.35 : grade === 'bonus' ? 1.18 : 1;
  const consequence = activityConsequences(kind, success);
  const durationHours = Math.max(6, Number(data.durationHours || DEFAULT_AFTERMATH_HOURS));
  const row = normalizeLiveRegion(stored, data.siteId || '');
  row.lastUpdatedHour = now;
  row.cooldownUntil = Math.max(row.cooldownUntil, now + (success ? 6 : 3));
  row.lastActivityKind = kind;
  row.lastOutcome = success ? 'success' : 'failure';
  row.aftermath = normalizeAftermath({
    kind,
    outcome: success ? 'success' : 'failure',
    title: consequence.title,
    text: consequence.text,
    siteId: data.siteId,
    startedHour: now,
    expiresHour: now + durationHours,
    deltas: {
      supply: consequence.supply * gradeScale,
      security: consequence.security * gradeScale,
      influence: consequence.influence * gradeScale
    },
    participantCount: data.participantCount,
    contribution: data.contribution
  }, data.siteId || '');
  return row;
}

function lifecycleStage(task = {}, worldHour = 0) {
  const now = Number(worldHour || 0);
  const created = Number(task.createdHour || 0);
  const expires = Math.max(created, Number(task.expiresHour || created));
  const age = Math.max(0, now - created);
  if (now >= expires) return { key: 'expired', label: 'Сигнал погас', order: 4 };
  if (age < 0.25) return { key: 'warning', label: 'Поступил сигнал', order: 1 };
  if (age < 0.75) return { key: 'preparation', label: 'Сбор участников', order: 2 };
  return { key: 'active', label: 'Основная фаза', order: 3 };
}

function activityCause(kind = '', region = {}) {
  const key = {
    escort_caravan: 'supply',
    resource_expedition: 'supply',
    recon_expedition: 'security',
    outpost_defense: 'security',
    distress_signal: 'security',
    assault_diversion: 'influence'
  }[String(kind || '')] || region.cause || 'security';
  const title = key === 'supply' ? 'Снабжение' : key === 'influence' ? 'Влияние' : 'Безопасность';
  const label = region?.[key]?.label || 'нестабильно';
  return { key, label: `${title}: ${label}` };
}

function communityGoal(task = {}) {
  const details = task.details && typeof task.details === 'object' ? task.details : {};
  if (task.type === 'recon_expedition') return Math.max(1, Number(details.targetPoints || 3));
  if (task.type === 'assault_diversion') return Math.max(1, Number(details.targetSabotage || details.targetKills || 4));
  if (task.type === 'resource_expedition') return Math.max(1, Number(details.targetUnits || 6));
  return Math.max(1, Number(details.targetKills || 6));
}

function publicHelpSignal(row = null, now = Date.now()) {
  if (!row || typeof row !== 'object' || row.active === false) return null;
  const expiresAt = Math.max(0, Number(row.expiresAt || 0));
  if (expiresAt > 0 && expiresAt <= Number(now || Date.now())) return null;
  return {
    active: true,
    requestedByName: String(row.requestedByName || 'Выживший').slice(0, 48),
    message: String(row.message || 'Отряду нужна помощь.').slice(0, 160),
    requestedAt: Math.max(0, Number(row.requestedAt || 0)),
    expiresAt,
    responderCount: Math.max(0, Math.floor(Number(row.responderCount
      ?? row.responderCharacterIds?.length
      ?? 0))),
    responderNames: Array.isArray(row.responderNames)
      ? row.responderNames.map(value => String(value || '').slice(0, 48)).filter(Boolean).slice(0, 8)
      : []
  };
}

function buildLiveEvent(task = {}, region = {}, worldHour = 0) {
  const details = task.details && typeof task.details === 'object' ? task.details : {};
  const synced = details.community && typeof details.community === 'object' ? details.community : {};
  const stage = lifecycleStage(task, worldHour);
  const consequence = activityConsequences(String(task.type || ''), true);
  const recommendedCause = activityCause(task.type, region);
  const cause = details.liveEvent?.cause || recommendedCause.key;
  const causeLabel = details.liveEvent?.causeLabel || recommendedCause.label;
  const goal = Math.max(1, Number(synced.goal || communityGoal(task)));
  const progress = clamp(Number(synced.progress || 0), 0, goal * 4);
  const helpSignal = publicHelpSignal(details.helpSignal);
  return {
    schema: LIVE_EVENT_SCHEMA,
    cause,
    causeLabel,
    stage: stage.key,
    stageLabel: stage.label,
    stageOrder: stage.order,
    consequencePreview: consequence.text,
    helpSignal,
    community: {
      progress: Math.floor(progress),
      goal: Math.floor(goal),
      percent: Math.round(clamp(progress / goal * 100)),
      participantCount: Math.max(0, Math.floor(Number(synced.participantCount || 0))),
      participantNames: Array.isArray(synced.participantNames)
        ? synced.participantNames.map(value => String(value || '').slice(0, 48)).filter(Boolean).slice(0, 8)
        : []
    }
  };
}

function liveActivityPriority(task = {}, region = {}, worldHour = 0) {
  const liveEvent = buildLiveEvent(task, region, worldHour);
  const acceptedWeight = task.details?.community?.participantCount ? 80 : 0;
  const stageWeight = liveEvent.stage === 'active' ? 45 : liveEvent.stage === 'preparation' ? 25 : 10;
  return Number(region.urgency || 0) * 10
    + clamp(Number(task.priority || 0), 0, 5) * 75
    + (region.nextActivity?.kind === String(task.type || '') ? 240 : 0)
    + acceptedWeight
    + stageWeight;
}

module.exports = {
  LIVE_EVENT_SCHEMA,
  LIVE_REGION_SCHEMA,
  PUBLIC_LIVE_ACTIVITY_LIMIT,
  activeAftermath,
  activityCause,
  activityConsequences,
  applyActivityOutcome,
  buildLiveEvent,
  deriveLiveRegion,
  lifecycleStage,
  liveActivityPriority,
  normalizeLiveRegion,
  normalizeLiveRegions,
  publicHelpSignal
};
