'use strict';

// Транспорт — предмет в слоте «vehicle». Игрок вызывает его и отпускает сам,
// а сервер решает, можно ли сесть, и держит скорость седока: клиент по-прежнему
// двигает себя сам, но бюджет расстояния за пакет сервер считает по транспорту.
//
// data/kromka/vehicles.json описывает группу предметов (tierGroup): вид, общую
// управляемость и строку на каждый тир, в котором предмет существует, — скорость,
// разгон, повороты и грузоподъёмность. Каждый тировый вариант (motorcycleT4)
// получает собственную запись каталога.
const VEHICLE_SLOT = 'vehicle';
const VEHICLE_KINDS = new Set(['moped', 'motorcycle', 'pickup', 'truck']);
const MAX_VEHICLE_SPEED = 20;
const DEFAULT_TOGGLE_COOLDOWN_MS = 700;
const DEFAULT_REVERSE_SPEED = 3.5;

// Почему седок оказался на земле: клиент подбирает по причине строку для игрока.
const DISMOUNT_REASONS = new Set(['request', 'hit', 'downed', 'stunned', 'unequipped', 'death']);

function safeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function boundedNumber(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label}: ${value}`);
  return Number(number.toFixed(2));
}

/**
 * Корпус транспорта в плане: прямоугольник length × width, центр которого
 * смещён от точки водителя на offsetX (вправо) и offsetZ (вперёд), в метрах.
 * Водитель пикапа сидит слева, поэтому корпус лежит правее него. pivotX/pivotZ —
 * ось поворота (задний мост машины) от водителя же: машина разворачивается
 * вокруг неё, а не вокруг водителя, иначе длинная корма грузовика мела бы стены.
 */
function normalizeHull(input = {}, label = 'vehicle') {
  const bad = key => `Kromka vehicle ${label} has an invalid hull ${key}`;
  const hull = {
    length: boundedNumber(input?.length, 0.5, 12, bad('length')),
    width: boundedNumber(input?.width, 0.3, 4, bad('width')),
    offsetX: boundedNumber(input?.offsetX ?? 0, -6, 6, bad('offsetX')),
    offsetZ: boundedNumber(input?.offsetZ ?? 0, -6, 6, bad('offsetZ')),
    pivotX: boundedNumber(input?.pivotX ?? 0, -6, 6, bad('pivotX')),
    pivotZ: boundedNumber(input?.pivotZ ?? 0, -6, 6, bad('pivotZ'))
  };
  // Ось поворота лежит внутри корпуса.
  if (Math.abs(hull.pivotX - hull.offsetX) > hull.width / 2 || Math.abs(hull.pivotZ - hull.offsetZ) > hull.length / 2) {
    throw new Error(bad('pivot (outside the hull)'));
  }
  return Object.freeze(hull);
}

/**
 * Корпус для проверок сервера — цепочка кругов вдоль оси транспорта: радиус —
 * полуширина (не меньше minRadius, тела водителя), шаг между центрами не больше
 * радиуса. Круги вписаны в прямоугольник, поэтому сервер чуть мягче клиента,
 * который проверяет сам прямоугольник: честный клиент не получает поправок.
 * angle — серверный угол (радианы): «вперёд» = (sin, cos), «вправо» = (cos, −sin).
 */
function vehicleHullCircles(hull = null, x = 0, z = 0, angle = 0, minRadius = 0) {
  if (!hull) return [];
  const radius = Math.max(Number(minRadius || 0), Number(hull.width || 0) / 2);
  const half = Math.max(0, Number(hull.length || 0) / 2 - radius);
  const count = half > 0 ? Math.ceil((2 * half) / radius) + 1 : 1;
  const sin = Math.sin(Number(angle || 0));
  const cos = Math.cos(Number(angle || 0));
  const centerX = Number(x || 0) + cos * Number(hull.offsetX || 0) + sin * Number(hull.offsetZ || 0);
  const centerZ = Number(z || 0) - sin * Number(hull.offsetX || 0) + cos * Number(hull.offsetZ || 0);
  const circles = [];
  for (let i = 0; i < count; i += 1) {
    const along = count === 1 ? 0 : -half + (2 * half * i) / (count - 1);
    circles.push({ x: centerX + sin * along, z: centerZ + cos * along, r: radius });
  }
  return circles;
}

function normalizeVehicleCatalog(raw = {}, itemCatalog = {}) {
  const items = Array.isArray(itemCatalog?.items) ? itemCatalog.items : [];
  const byId = new Map(items.map(item => [item.id, item]));
  const vehicles = [];
  const seen = new Set();
  const groups = new Set();
  for (const input of Array.isArray(raw?.vehicles) ? raw.vehicles : []) {
    const group = safeId(input?.itemId);
    const base = byId.get(group);
    if (!base || base.slot !== VEHICLE_SLOT) {
      throw new Error(`Kromka vehicle ${group || '<empty>'} is not a catalog item with the ${VEHICLE_SLOT} slot`);
    }
    if (groups.has(group)) throw new Error(`Kromka vehicle ${group} is listed twice`);
    groups.add(group);
    const kind = safeId(input?.kind);
    if (!VEHICLE_KINDS.has(kind)) throw new Error(`Kromka vehicle ${group} has an unknown kind: ${kind}`);
    const label = key => `Kromka vehicle ${group} has an invalid ${key}`;
    const cooldown = Number(input?.toggleCooldownMs ?? DEFAULT_TOGGLE_COOLDOWN_MS);
    const shared = {
      kind,
      acceleration: boundedNumber(input?.acceleration, 2, 40, label('acceleration')),
      turnStillDeg: boundedNumber(input?.turnStillDeg, 20, 360, label('turnStillDeg')),
      turnFullDeg: boundedNumber(input?.turnFullDeg, 10, 360, label('turnFullDeg')),
      reverseSpeed: boundedNumber(input?.reverseSpeed ?? DEFAULT_REVERSE_SPEED, 0.5, 8, label('reverseSpeed')),
      hull: normalizeHull(input?.hull, group),
      toggleCooldownMs: Number.isFinite(cooldown) ? Math.max(0, Math.min(10000, Math.floor(cooldown))) : DEFAULT_TOGGLE_COOLDOWN_MS
    };
    if (shared.turnFullDeg > shared.turnStillDeg) throw new Error(`Kromka vehicle ${group} turns faster at speed than standing`);

    // Варианты группы: тировые (tierGroup) или сам предмет, если тиров у него нет.
    const variants = base.tierGroup
      ? items.filter(item => item.tierGroup === base.tierGroup)
      : [base];
    const rows = new Map();
    for (const row of Array.isArray(input?.tiers) ? input.tiers : []) {
      const tier = Number(row?.tier || 0);
      if (rows.has(tier)) throw new Error(`Kromka vehicle ${group} lists tier ${tier} twice`);
      rows.set(tier, row);
    }
    for (const item of variants) {
      const tier = Number(item.tier || 0);
      const row = rows.get(tier);
      if (!row) throw new Error(`Kromka vehicle ${group} has no stats for tier ${tier} (${item.id})`);
      rows.delete(tier);
      if (seen.has(item.id)) throw new Error(`Kromka vehicle ${item.id} is listed twice`);
      seen.add(item.id);
      const speed = Number(row.speed);
      if (!Number.isFinite(speed) || speed <= 0 || speed > MAX_VEHICLE_SPEED) {
        throw new Error(`Kromka vehicle ${item.id} has an invalid speed: ${row.speed}`);
      }
      vehicles.push(Object.freeze({
        itemId: item.id,
        group,
        tier,
        name: item.name,
        ...shared,
        speed: Number(speed.toFixed(2)),
        carryKg: boundedNumber(row.carryKg ?? 0, 0, 1000, label(`carryKg of tier ${tier}`))
      }));
    }
    if (rows.size) throw new Error(`Kromka vehicle ${group} has stats for missing tiers: ${[...rows.keys()].join(', ')}`);
  }
  for (const item of items) {
    if (item.slot === VEHICLE_SLOT && !seen.has(item.id)) {
      throw new Error(`Kromka item ${item.id} takes the ${VEHICLE_SLOT} slot but has no vehicle definition`);
    }
  }
  return Object.freeze({
    schema: String(raw?.schema || 'kromka.vehicles.v2'),
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
  if (!vehicle) return 'Транспорта нет: наденьте его в слот «Транспорт».';
  if (state.dead || state.downed) return 'Без сознания за руль не сесть.';
  if (state.stunned) return 'Оглушение: подождите, пока пройдёт.';
  if (!state.inRoom) return 'Транспорт вызывается только на месте.';
  if (state.blocked) return 'Здесь транспорту не встать: отойдите от стен, укрытий и людей.';
  return vehicleToggleRefusal(vehicle, state.lastToggleAt, state.now);
}

/** Слишком частое «сел — слез» подряд: у мотора тоже есть стартер. */
function vehicleToggleRefusal(vehicle = {}, lastToggleAt = 0, now = Date.now()) {
  const cooldown = Math.max(0, Number(vehicle?.toggleCooldownMs || 0));
  const since = Number(now) - Number(lastToggleAt || 0);
  return Number.isFinite(since) && since >= 0 && since < cooldown ? 'Не так часто: мотор ещё не заглох.' : '';
}

// Управляемость, которую клиент берёт из седла: своя у каждого транспорта.
const HANDLING_KEYS = ['acceleration', 'turnStillDeg', 'turnFullDeg', 'reverseSpeed'];

/** То, что видят все: на чём игрок едет и как этот транспорт слушается руля. Пешком — null. */
function publicMountedVehicle(mounted = null) {
  if (!mounted || !mounted.itemId) return null;
  const view = {
    itemId: mounted.itemId,
    kind: mounted.kind,
    speed: mounted.speed
  };
  for (const key of HANDLING_KEYS) if (Number.isFinite(mounted[key])) view[key] = mounted[key];
  if (mounted.hull) view.hull = { ...mounted.hull };
  return view;
}

function mountedVehicleState(vehicle = {}, now = Date.now()) {
  const state = {
    itemId: vehicle.itemId,
    kind: vehicle.kind,
    speed: vehicle.speed
  };
  for (const key of HANDLING_KEYS) if (Number.isFinite(vehicle[key])) state[key] = vehicle[key];
  if (vehicle.hull) state.hull = vehicle.hull;
  state.since = Number(now);
  return state;
}

/** Сколько килограммов добавляет надетый транспорт: багажник, кузов, кунг. */
function vehicleCarryKg(vehicle = null) {
  return Math.max(0, Number(vehicle?.carryKg || 0));
}

/** Характеристики для клиента: подсказка предмета, грузоподъёмность и управление. */
function publicVehicleCatalog(catalog = {}) {
  return (Array.isArray(catalog?.vehicles) ? catalog.vehicles : []).map(vehicle => ({
    itemId: vehicle.itemId,
    group: vehicle.group,
    tier: vehicle.tier,
    kind: vehicle.kind,
    speed: vehicle.speed,
    acceleration: vehicle.acceleration,
    turnStillDeg: vehicle.turnStillDeg,
    turnFullDeg: vehicle.turnFullDeg,
    reverseSpeed: vehicle.reverseSpeed,
    carryKg: vehicle.carryKg,
    hull: vehicle.hull ? { ...vehicle.hull } : null
  }));
}

function normalizeDismountReason(reason = '') {
  const value = safeId(reason);
  return DISMOUNT_REASONS.has(value) ? value : 'request';
}

module.exports = {
  VEHICLE_SLOT,
  VEHICLE_KINDS,
  normalizeVehicleCatalog,
  vehicleHullCircles,
  vehicleForItem,
  vehicleMountRefusal,
  vehicleToggleRefusal,
  publicMountedVehicle,
  mountedVehicleState,
  vehicleCarryKg,
  publicVehicleCatalog,
  normalizeDismountReason
};
