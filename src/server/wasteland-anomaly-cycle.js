'use strict';

const { hash32 } = require('./shift-cycle');

const ACTIVE_PHASES = new Set(['warning', 'active', 'afterglow']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function safeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 96);
}

function normalizeLocations(locations = []) {
  return (Array.isArray(locations) ? locations : [])
    .filter(row => row && typeof row === 'object')
    .map(row => ({
      id: safeId(row.id || ''),
      regionId: safeId(row.macroRegion || row.regionId || 'unknown', 'unknown'),
      fieldCount: (Array.isArray(row.anomalyFields) ? row.anomalyFields : [])
        .filter(field => field && Number.isFinite(Number(field.x)) && Number.isFinite(Number(field.z))).length,
      excluded: row.offMap === true || String(row.macroRegion || row.regionId || '') === 'off_map'
        || /^tutorial/i.test(String(row.id || ''))
    }))
    .filter(row => row.id && row.fieldCount > 0 && !row.excluded);
}

function locationRegionIndex(locations = []) {
  return Object.fromEntries(normalizeLocations(locations).map(row => [row.id, row.regionId]));
}

function regionRows(locations = [], config = {}) {
  const configured = Array.isArray(config.regions) ? config.regions : [];
  const configuredRows = configured.map(row => typeof row === 'string'
    ? { id: safeId(row), weight: 1 }
    : { id: safeId(row?.id || ''), weight: Math.max(0.1, Number(row?.weight || 1)) }).filter(row => row.id);
  if (configuredRows.length) return configuredRows;
  return [...new Set(normalizeLocations(locations).map(row => row.regionId))]
    .sort()
    .map(id => ({ id, weight: 1 }));
}

function affectedRegions(shift = {}, locations = [], config = {}) {
  const rows = regionRows(locations, config);
  if (!rows.length) return [];
  const strength = clamp(Math.floor(Number(shift.strength || 1)), 1, 3);
  const baseCount = Math.max(1, Math.floor(Number(config.minimumAffectedRegions || 1)));
  const count = Math.min(rows.length, baseCount + strength - 1);
  return rows
    .map(row => ({
      ...row,
      score: hash32(`${safeId(shift.shiftId || 'shift')}:${row.id}`) / row.weight
    }))
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id))
    .slice(0, count)
    .map(row => row.id);
}

function shiftCopy(shift = {}, locations = [], config = {}) {
  const phase = ['calm', 'warning', 'active', 'afterglow'].includes(String(shift.phase || ''))
    ? String(shift.phase) : 'calm';
  const strength = clamp(Math.floor(Number(shift.strength || 1)), 1, 3);
  const selectedRegions = affectedRegions(shift, locations, config);
  const visible = ACTIVE_PHASES.has(phase);
  const eligible = normalizeLocations(locations)
    .filter(row => selectedRegions.includes(row.regionId));
  const hotspots = visible ? eligible.map(row => ({
    locationId: row.id,
    regionId: row.regionId,
    fieldCount: row.fieldCount,
    intensity: strength,
    artifactCount: Math.min(row.fieldCount, strength),
    causeCode: 'shift_wave'
  })) : [];
  const phaseText = phase === 'warning'
    ? 'волна приближается'
    : phase === 'active'
      ? 'аномальная волна проходит через районы'
      : phase === 'afterglow'
        ? 'в аномалиях остался послевкус волны'
        : 'поле пока спокойно';
  return {
    shiftId: safeId(shift.shiftId || ''),
    phase,
    strength,
    causeCode: 'shift_wave',
    affectedRegions: selectedRegions,
    affectedLocationIds: hotspots.map(row => row.locationId),
    hotspots,
    reason: phaseText,
    forecast: visible
      ? 'в отмеченных аномалиях появятся артефакты; дороги станут опаснее'
      : 'следующая волна затронет часть региона',
    actions: visible
      ? ['укрыться на активной фазе', 'после волны взять детектор и болты']
      : ['проверить прогноз', 'запастись медикаментами'],
    phaseStartedAt: Math.max(0, Number(shift.phaseStartedAt || 0)),
    phaseEndsAt: Math.max(0, Number(shift.phaseEndsAt || 0)),
    nextShiftAt: Math.max(0, Number(shift.nextShiftAt || 0)),
    updatedAt: Math.max(0, Number(shift.serverNow || Date.now()))
  };
}

function siteLocationId(site = {}) {
  return safeId(site.templateLocationId || site.locationId || site.id || '');
}

function applyAnomalyShift(existing = {}, shift = {}, sites = {}, options = {}) {
  const locations = options.locations || [];
  const config = options.config || {};
  const previous = existing && typeof existing === 'object' ? existing : {};
  const next = {
    ...shiftCopy(shift, locations, config),
    lastAppliedShiftId: safeId(previous.lastAppliedShiftId || ''),
    history: Array.isArray(previous.history) ? previous.history.slice(0, 11) : []
  };
  const shouldApply = next.phase === 'active' && next.shiftId && next.lastAppliedShiftId !== next.shiftId;
  const impactedSites = [];
  if (shouldApply) {
    const regionByLocation = locationRegionIndex(locations);
    for (const site of Object.values(sites || {})) {
      if (!site || typeof site !== 'object') continue;
      const locationId = siteLocationId(site);
      const regionId = regionByLocation[locationId] || '';
      if (!regionId || !next.affectedRegions.includes(regionId)) continue;
      site.anomalyPressure = clamp(Number(site.anomalyPressure || 0) + next.strength * 8, 0, 100);
      site.shiftExposureUntilHour = Number((Number(options.worldHour || 0) + 2 + next.strength * 2).toFixed(2));
      site.lastShiftImpact = {
        shiftId: next.shiftId,
        causeCode: next.causeCode,
        strength: next.strength,
        regionId,
        reason: next.reason,
        forecast: next.forecast,
        actions: next.actions,
        worldHour: Number(Number(options.worldHour || 0).toFixed(2))
      };
      if (site.settlementLife && typeof site.settlementLife === 'object') {
        // A background Shift may strain a protected settlement, but it never
        // changes ownership, population or the protected minimum.
        site.settlementLife.tension = clamp(Number(site.settlementLife.tension || 0) + next.strength * 2, 0, 100);
        site.settlementLife.integrity = clamp(Number(site.settlementLife.integrity || 100) - next.strength * 0.5, 40, 100);
      }
      impactedSites.push({ siteId: safeId(site.id || ''), locationId, regionId });
    }
    next.lastAppliedShiftId = next.shiftId;
    next.history = [{
      shiftId: next.shiftId,
      strength: next.strength,
      affectedRegions: next.affectedRegions,
      impactedSiteIds: impactedSites.map(row => row.siteId),
      worldHour: Number(Number(options.worldHour || 0).toFixed(2))
    }, ...next.history.filter(row => row?.shiftId !== next.shiftId)].slice(0, 12);
  }
  const changed = JSON.stringify({ ...previous, updatedAt: 0 }) !== JSON.stringify({ ...next, updatedAt: 0 });
  return { state: next, applied: shouldApply, changed, impactedSites };
}

function artifactOpportunity(cycle = {}, locationId = '', shiftId = '') {
  const id = safeId(locationId || '');
  if (!id || !ACTIVE_PHASES.has(String(cycle.phase || ''))) return null;
  if (shiftId && safeId(cycle.shiftId || '') !== safeId(shiftId)) return null;
  const row = (Array.isArray(cycle.hotspots) ? cycle.hotspots : [])
    .find(entry => safeId(entry?.locationId || '') === id);
  return row ? { ...row, shiftId: safeId(cycle.shiftId || ''), phase: String(cycle.phase || '') } : null;
}

function publicAnomalyCycle(cycle = {}) {
  return {
    shiftId: safeId(cycle.shiftId || ''),
    phase: String(cycle.phase || 'calm'),
    strength: clamp(Math.floor(Number(cycle.strength || 1)), 1, 3),
    causeCode: 'shift_wave',
    affectedRegions: Array.isArray(cycle.affectedRegions) ? cycle.affectedRegions.map(safeId).filter(Boolean) : [],
    affectedLocationIds: Array.isArray(cycle.affectedLocationIds) ? cycle.affectedLocationIds.map(safeId).filter(Boolean) : [],
    hotspots: (Array.isArray(cycle.hotspots) ? cycle.hotspots : []).map(row => ({ ...row })),
    reason: String(cycle.reason || ''),
    forecast: String(cycle.forecast || ''),
    actions: Array.isArray(cycle.actions) ? cycle.actions.map(String).slice(0, 4) : [],
    phaseEndsAt: Math.max(0, Number(cycle.phaseEndsAt || 0)),
    nextShiftAt: Math.max(0, Number(cycle.nextShiftAt || 0)),
    updatedAt: Math.max(0, Number(cycle.updatedAt || 0))
  };
}

module.exports = {
  ACTIVE_PHASES,
  affectedRegions,
  applyAnomalyShift,
  artifactOpportunity,
  normalizeLocations,
  publicAnomalyCycle
};
