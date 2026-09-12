'use strict';

const BOLT_COOLDOWN_MS = 750;
const BOLT_RANGE_METERS = 10;
const MAGNETIC_BOLT_RANGE_METERS = 13;
const MAGNETIC_EDGE_TOLERANCE_METERS = 1.5;
const MAGNETIC_DISCHARGE_BONUS_MS = 2000;
const EXPOSURE_TICK_MS = 500;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_:#-]/g, '').slice(0, 120);
}

function pointSegmentDistance(px, pz, ax, az, bx, bz) {
  const abX = bx - ax;
  const abZ = bz - az;
  const lengthSq = abX * abX + abZ * abZ;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abX + (pz - az) * abZ) / lengthSq)) : 0;
  const x = ax + abX * t;
  const z = az + abZ * t;
  return { distance: Math.hypot(px - x, pz - z), t, x, z };
}

function segmentCircleEntry(cx, cz, radius, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, ox = ax - cx, oz = az - cz;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a <= 1e-12) return null;
  const b = 2 * (ox * dx + oz * dz), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

function createAnomalySystem(options = {}) {
  const catalog = options.catalog && typeof options.catalog === 'object' ? options.catalog : {};
  const locations = options.locations && typeof options.locations === 'object' ? options.locations : {};
  const typeById = new Map((Array.isArray(catalog.types) ? catalog.types : []).map(row => [safeId(row?.id), row]));
  const locationById = new Map((Array.isArray(locations.locations) ? locations.locations : []).map(row => [safeId(row?.id), row]));
  const nodeState = new Map();
  const playerThrowAt = new Map();
  const playerExposureAt = new Map();
  const playerExposureInside = new Set();
  const bolt = catalog.bolt && typeof catalog.bolt === 'object' ? catalog.bolt : {};
  const range = Math.max(1, finite(bolt.rangeMeters, BOLT_RANGE_METERS));
  const cooldownMs = Math.max(100, finite(bolt.cooldownMs, BOLT_COOLDOWN_MS));
  const magneticRange = Math.max(range, finite(bolt.magneticRangeMeters, MAGNETIC_BOLT_RANGE_METERS));
  const magneticTolerance = Math.max(0, finite(bolt.magneticEdgeToleranceMeters, MAGNETIC_EDGE_TOLERANCE_METERS));
  const magneticBonusMs = Math.max(0, finite(bolt.magneticDischargeBonusMs, MAGNETIC_DISCHARGE_BONUS_MS));

  function authoredFields(locationId = '') {
    const location = locationById.get(safeId(locationId));
    const rows = Array.isArray(location?.anomalyFields) ? location.anomalyFields : [];
    return rows.map(row => {
      const type = typeById.get(safeId(row?.type));
      if (!type) return null;
      return {
        id: safeId(row.id),
        type: safeId(type.id),
        displayName: String(type.displayName || type.id || '').slice(0, 80),
        damageType: type.damageType === 'chemical' ? 'toxic' : safeId(type.damageType || 'anomalous'),
        damagePerSecond: Math.max(0, finite(type.damagePerSecond, 0)),
        dischargeMs: Math.max(500, finite(row.dischargeMs, type.dischargeMs || 4000)),
        statusEffect: String(type.statusEffect || '').trim().slice(0, 80),
        visualProfile: safeId(row.visualProfile || type.visualProfile || ''),
        audioProfile: safeId(row.audioProfile || type.audioProfile || ''),
        readability: String(type.readability || '').slice(0, 300),
        x: finite(row.x),
        z: finite(row.z),
        radius: Math.max(0.75, finite(row.radius, 2.5)),
        placement: row.placement === 'authored-slot' ? 'authored-slot' : 'authored',
        permanentDischarge: row.permanentDischarge === true,
        training: row.training === true
      };
    }).filter(row => row?.id);
  }

  function stateFor(roomId, field) {
    const key = `${safeId(roomId)}:${field.id}`;
    if (!nodeState.has(key)) nodeState.set(key, {
      dischargedUntil: 0,
      permanentlyDischarged: false,
      lastTriggeredAt: 0,
      revision: 0
    });
    return nodeState.get(key);
  }

  function snapshot(roomId = '', locationId = '', now = Date.now()) {
    return {
      schema: 'kromka.anomaly-state.v1',
      roomId: safeId(roomId),
      locationId: safeId(locationId),
      serverNow: now,
      bolt: { rangeMeters: range, cooldownMs, magneticRangeMeters: magneticRange },
      fields: authoredFields(locationId).map(field => {
        const state = stateFor(roomId, field);
        return {
          ...field,
          active: state.permanentlyDischarged !== true && now >= Number(state.dischargedUntil || 0),
          dischargedUntil: Number(state.dischargedUntil || 0),
          permanentlyDischarged: state.permanentlyDischarged === true,
          lastTriggeredAt: Number(state.lastTriggeredAt || 0),
          revision: Number(state.revision || 0)
        };
      })
    };
  }

  function throwBolt(request = {}) {
    const now = Number.isFinite(Number(request.now)) ? Number(request.now) : Date.now();
    const roomId = safeId(request.roomId);
    const locationId = safeId(request.locationId);
    const playerId = safeId(request.playerId || request.player?.id);
    const fromX = finite(request.from?.x ?? request.player?.x, NaN);
    const fromZ = finite(request.from?.z ?? request.player?.z, NaN);
    const toX = finite(request.target?.x, NaN);
    const toZ = finite(request.target?.z, NaN);
    if (!roomId || !locationId || !playerId) return { ok: false, error: 'Бросок не привязан к комнате.' };
    if (![fromX, fromZ, toX, toZ].every(Number.isFinite)) return { ok: false, error: 'Неверная точка броска.' };
    const upgraded = request.magnetic === true;
    const maxRange = upgraded ? magneticRange : range;
    const distance = Math.hypot(toX - fromX, toZ - fromZ);
    if (distance > maxRange + 0.05) return { ok: false, error: `Болт долетает только на ${maxRange} м.`, maxRange };
    const previousThrowAt = Number(playerThrowAt.get(playerId) || 0);
    if (now - previousThrowAt < cooldownMs) {
      return { ok: false, error: 'Подождите перед следующим броском.', retryAfterMs: cooldownMs - (now - previousThrowAt) };
    }
    const tolerance = upgraded ? magneticTolerance : 0;
    const hits = authoredFields(locationId)
      .filter(field => {
        const state = stateFor(roomId, field);
        return !state.permanentlyDischarged && now >= state.dischargedUntil;
      })
      .map(field => ({ field, t: segmentCircleEntry(field.x, field.z, field.radius + tolerance, fromX, fromZ, toX, toZ) }))
      .filter(row => row.t !== null)
      .sort((left, right) => left.t - right.t);
    const hit = hits[0] || null;
    // A wall behind the first field cannot block contact with its near edge.
    const contactT = hit ? hit.t : 1;
    const contact = { x: fromX + (toX - fromX) * contactT, z: fromZ + (toZ - fromZ) * contactT };
    if (typeof request.hasLineOfThrow === 'function' && !request.hasLineOfThrow(fromX, fromZ, contact.x, contact.z)) {
      return { ok: false, error: 'Линию броска перекрывает препятствие.' };
    }
    playerThrowAt.set(playerId, now);
    let anomaly = null;
    if (hit) {
      const state = stateFor(roomId, hit.field);
      state.lastTriggeredAt = now;
      state.permanentlyDischarged = hit.field.permanentDischarge === true;
      state.dischargedUntil = state.permanentlyDischarged
        ? 0
        : now + hit.field.dischargeMs + (upgraded ? magneticBonusMs : 0);
      state.revision += 1;
      anomaly = {
        id: hit.field.id,
        type: hit.field.type,
        displayName: hit.field.displayName,
        x: hit.field.x,
        z: hit.field.z,
        radius: hit.field.radius,
        contact,
        dischargedUntil: state.dischargedUntil,
        permanentlyDischarged: state.permanentlyDischarged,
        revision: state.revision
      };
    }
    return {
      ok: true,
      roomId,
      locationId,
      playerId,
      magnetic: upgraded,
      from: { x: Number(fromX.toFixed(3)), z: Number(fromZ.toFixed(3)) },
      to: { x: Number(toX.toFixed(3)), z: Number(toZ.toFixed(3)) },
      hit: !!hit,
      anomaly,
      t: now
    };
  }

  function evaluatePlayer(request = {}) {
    const now = Number.isFinite(Number(request.now)) ? Number(request.now) : Date.now();
    const roomId = safeId(request.roomId);
    const locationId = safeId(request.locationId);
    const playerId = safeId(request.playerId || request.player?.id);
    const x = finite(request.x ?? request.player?.x, NaN);
    const z = finite(request.z ?? request.player?.z, NaN);
    if (!roomId || !locationId || !playerId || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const field = authoredFields(locationId)
      .filter(row => {
        const state = stateFor(roomId, row);
        return state.permanentlyDischarged !== true && now >= Number(state.dischargedUntil || 0);
      })
      .filter(row => Math.hypot(x - row.x, z - row.z) <= row.radius)
      .sort((left, right) => right.damagePerSecond - left.damagePerSecond)[0];
    if (!field) {
      // Keep the previous damage tick: stepping out and back in within a frame
      // must not repeatedly grant a fresh 500 ms hit at the boundary.
      playerExposureInside.delete(playerId);
      return null;
    }
    const previousAt = Number(playerExposureAt.get(playerId) || 0);
    if (previousAt > 0 && now - previousAt < EXPOSURE_TICK_MS) return null;
    const elapsedMs = previousAt > 0 && playerExposureInside.has(playerId)
      ? Math.min(1000, Math.max(EXPOSURE_TICK_MS, now - previousAt)) : EXPOSURE_TICK_MS;
    playerExposureAt.set(playerId, now);
    playerExposureInside.add(playerId);
    return {
      roomId,
      locationId,
      playerId,
      anomalyId: field.id,
      anomalyType: field.type,
      anomalyName: field.displayName,
      damageType: field.damageType,
      damage: Math.max(1, Math.round(field.damagePerSecond * elapsedMs / 1000)),
      statusEffect: field.statusEffect,
      statusDurationMs: 1200,
      sourceX: field.x,
      sourceZ: field.z,
      t: now
    };
  }

  function releasePlayer(playerId = '') {
    const id = safeId(playerId);
    playerThrowAt.delete(id);
    playerExposureAt.delete(id);
    playerExposureInside.delete(id);
  }

  return { authoredFields, evaluatePlayer, releasePlayer, snapshot, throwBolt };
}

module.exports = {
  BOLT_COOLDOWN_MS,
  BOLT_RANGE_METERS,
  EXPOSURE_TICK_MS,
  MAGNETIC_BOLT_RANGE_METERS,
  createAnomalySystem,
  pointSegmentDistance,
  segmentCircleEntry
};
