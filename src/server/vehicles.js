'use strict';

// Транспорт — предмет в слоте «vehicle». Игрок вызывает его и отпускает сам,
// а сервер решает, можно ли сесть, и держит скорость седока: клиент по-прежнему
// двигает себя сам, но бюджет расстояния за пакет сервер считает по транспорту.
const VEHICLE_SLOT = 'vehicle';
const VEHICLE_KINDS = new Set(['motorcycle']);
const MAX_VEHICLE_SPEED = 20;
const DEFAULT_TOGGLE_COOLDOWN_MS = 700;

// Почему седок оказался на земле: клиент подбирает по причине строку для игрока.
const DISMOUNT_REASONS = new Set(['request', 'hit', 'downed', 'stunned', 'unequipped', 'death']);

function safeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function normalizeVehicleCatalog(raw = {}, itemCatalog = {}) {
  const items = new Map((Array.isArray(itemCatalog?.items) ? itemCatalog.items : []).map(item => [item.id, item]));
  const vehicles = [];
  const seen = new Set();
  for (const input of Array.isArray(raw?.vehicles) ? raw.vehicles : []) {
    const itemId = safeId(input?.itemId);
    const item = items.get(itemId);
    if (!item || item.slot !== VEHICLE_SLOT) {
      throw new Error(`Kromka vehicle ${itemId || '<empty>'} is not a catalog item with the ${VEHICLE_SLOT} slot`);
    }
    if (seen.has(itemId)) throw new Error(`Kromka vehicle ${itemId} is listed twice`);
    const kind = safeId(input?.kind);
    if (!VEHICLE_KINDS.has(kind)) throw new Error(`Kromka vehicle ${itemId} has an unknown kind: ${kind}`);
    const speed = Number(input?.speed);
    if (!Number.isFinite(speed) || speed <= 0 || speed > MAX_VEHICLE_SPEED) {
      throw new Error(`Kromka vehicle ${itemId} has an invalid speed: ${input?.speed}`);
    }
    const cooldown = Number(input?.toggleCooldownMs ?? DEFAULT_TOGGLE_COOLDOWN_MS);
    vehicles.push(Object.freeze({
      itemId,
      name: item.name,
      kind,
      speed: Number(speed.toFixed(2)),
      toggleCooldownMs: Number.isFinite(cooldown) ? Math.max(0, Math.min(10000, Math.floor(cooldown))) : DEFAULT_TOGGLE_COOLDOWN_MS
    }));
    seen.add(itemId);
  }
  for (const item of items.values()) {
    if (item.slot === VEHICLE_SLOT && !seen.has(item.id)) {
      throw new Error(`Kromka item ${item.id} takes the ${VEHICLE_SLOT} slot but has no vehicle definition`);
    }
  }
  return Object.freeze({
    schema: String(raw?.schema || 'kromka.vehicles.v1'),
    version: Math.max(1, Math.floor(Number(raw?.version || 1))),
    vehicles: Object.freeze(vehicles),
    byItemId: Object.freeze(Object.fromEntries(vehicles.map(vehicle => [vehicle.itemId, vehicle])))
  });
}

function vehicleForItem(catalog = {}, itemId = '') {
  return catalog?.byItemId?.[safeId(itemId)] || null;
}

/**
 * Почему сесть нельзя, или пустая строка. state — то, что сервер знает об игроке:
 * vehicle (надетый транспорт или null), dead, downed, stunned, inRoom,
 * lastToggleAt и now.
 */
function vehicleMountRefusal(state = {}) {
  const vehicle = state.vehicle || null;
  if (!vehicle) return 'Транспорта нет: наденьте мотоцикл в слот «Транспорт».';
  if (state.dead || state.downed) return 'Без сознания в седло не сесть.';
  if (state.stunned) return 'Оглушение: подождите, пока пройдёт.';
  if (!state.inRoom) return 'Транспорт вызывается только на месте.';
  return vehicleToggleRefusal(vehicle, state.lastToggleAt, state.now);
}

/** Слишком частое «сел — слез» подряд: у мотоцикла тоже есть стартер. */
function vehicleToggleRefusal(vehicle = {}, lastToggleAt = 0, now = Date.now()) {
  const cooldown = Math.max(0, Number(vehicle?.toggleCooldownMs || 0));
  const since = Number(now) - Number(lastToggleAt || 0);
  return Number.isFinite(since) && since >= 0 && since < cooldown ? 'Не так часто: мотоцикл ещё не заглох.' : '';
}

/** То, что видят все: на чём игрок едет. Пешком — null. */
function publicMountedVehicle(mounted = null) {
  if (!mounted || !mounted.itemId) return null;
  return {
    itemId: mounted.itemId,
    kind: mounted.kind,
    speed: mounted.speed
  };
}

function mountedVehicleState(vehicle = {}, now = Date.now()) {
  return {
    itemId: vehicle.itemId,
    kind: vehicle.kind,
    speed: vehicle.speed,
    since: Number(now)
  };
}

function normalizeDismountReason(reason = '') {
  const value = safeId(reason);
  return DISMOUNT_REASONS.has(value) ? value : 'request';
}

module.exports = {
  VEHICLE_SLOT,
  normalizeVehicleCatalog,
  vehicleForItem,
  vehicleMountRefusal,
  vehicleToggleRefusal,
  publicMountedVehicle,
  mountedVehicleState,
  normalizeDismountReason
};
