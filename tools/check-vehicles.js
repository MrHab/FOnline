#!/usr/bin/env node
'use strict';

// Транспорт без сервера: каталог связан с предметами, отказы «сесть» говорят
// игроку причину, а публичное состояние седока отдаёт только нужное.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readTieredCatalogs, buildTieredCatalogs } = require('../src/server/kromka-tiers');
const {
  normalizeVehicleCatalog,
  vehicleForItem,
  vehicleMountRefusal,
  vehicleToggleRefusal,
  publicMountedVehicle,
  mountedVehicleState,
  vehicleCarryKg,
  vehicleHullCircles,
  publicVehicleCatalog,
  normalizeDismountReason
} = require('../src/server/vehicles');

const ROOT = path.resolve(__dirname, '..');
const json = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
// Тот же развёрнутый по тирам каталог, что у сервера: варианты motorcycleT3 и т. п.
const { itemCatalog: items, recipeCatalog: recipes } = readTieredCatalogs(path.join(ROOT, 'data'));
const rawVehicles = json('data/kromka/vehicles.json');
const catalog = normalizeVehicleCatalog(rawVehicles, items);
const itemIds = new Set(items.items.map(item => item.id));

const motorcycle = vehicleForItem(catalog, 'motorcycle');
assert(motorcycle, 'the motorcycle must be a vehicle');
assert.equal(motorcycle.kind, 'motorcycle');
assert.equal(motorcycle.tier, 2, 'the authored motorcycle id is its tier 2 variant, so old saves keep it');
assert.equal(motorcycle.name, 'Армейский мотоцикл', 'the vehicle name comes from the item catalog');
assert.equal(vehicleForItem(catalog, 'backpack'), null, 'ordinary gear is not a vehicle');
assert.equal(vehicleForItem(catalog, ''), null);

// Линейка: мопед — только T1, мотоцикл, пикап и грузовик — T2–T5.
const ladder = {
  moped: ['moped'],
  motorcycle: ['motorcycle', 'motorcycleT3', 'motorcycleT4', 'motorcycleT5'],
  pickup: ['pickup', 'pickupT3', 'pickupT4', 'pickupT5'],
  armyTruck: ['armyTruck', 'armyTruckT3', 'armyTruckT4', 'armyTruckT5']
};
for (const [group, ids] of Object.entries(ladder)) {
  const variants = catalog.vehicles.filter(vehicle => vehicle.group === group).map(vehicle => vehicle.itemId);
  assert.deepEqual(variants.sort(), [...ids].sort(), `${group} exists in exactly its tiers`);
  for (const tier of [1, 2, 3, 4, 5]) {
    const suffixed = `${group}T${tier}`;
    if (!ids.includes(suffixed)) assert(!itemIds.has(suffixed), `${suffixed} must not exist`);
  }
  // Выше тир — не медленнее и не меньше груза; рецепт есть у каждого варианта и только у них.
  const byTier = ids.map(id => vehicleForItem(catalog, id));
  for (let i = 1; i < byTier.length; i += 1) {
    assert(byTier[i].tier > byTier[i - 1].tier && byTier[i].speed > byTier[i - 1].speed
      && byTier[i].carryKg > byTier[i - 1].carryKg, `${byTier[i].itemId} must outclass ${byTier[i - 1].itemId}`);
  }
  const crafted = recipes.recipes.filter(recipe => catalog.byItemId[recipe.output.id]?.group === group);
  assert.deepEqual(crafted.map(recipe => recipe.output.id).sort(), [...ids].sort(), `${group} has one recipe per tier`);
}
const vehicle = id => vehicleForItem(catalog, id);
for (const tier of [2, 3, 4, 5]) {
  const suffix = tier === 2 ? '' : `T${tier}`;
  const [bike, pickup, truck] = ['motorcycle', 'pickup', 'armyTruck'].map(group => vehicle(group + suffix));
  // В каждом тире: мотоцикл быстрее всех, грузовик везёт больше всех, пикап — между ними.
  assert(bike.speed > pickup.speed && pickup.speed > truck.speed, `tier ${tier}: speed must go bike > pickup > truck`);
  assert(truck.carryKg > pickup.carryKg && pickup.carryKg > bike.carryKg, `tier ${tier}: cargo must go truck > pickup > bike`);
  assert(bike.turnFullDeg > pickup.turnFullDeg && pickup.turnFullDeg > truck.turnFullDeg, `tier ${tier}: the truck turns widest`);
}
const fastest = catalog.vehicles.reduce((best, row) => row.speed > best.speed ? row : best);
assert.equal(fastest.group, 'motorcycle', 'the motorcycle is the fastest vehicle in the game');
assert(vehicle('moped').speed < vehicle('motorcycle').speed && vehicle('moped').carryKg < vehicle('pickup').carryKg,
  'the T1 moped is the cheap entry vehicle');
assert.equal(vehicleCarryKg(vehicle('armyTruckT5')), vehicle('armyTruckT5').carryKg);
assert.equal(vehicleCarryKg(null), 0);
assert.deepEqual(Object.keys(publicVehicleCatalog(catalog)[0]).sort(),
  ['acceleration', 'carryKg', 'group', 'hull', 'itemId', 'kind', 'reverseSpeed', 'speed', 'tier', 'turnFullDeg', 'turnStillDeg']);

// Корпус: машины крупнее мотоциклов, водитель пикапа и грузовика сидит слева
// (корпус правее него), а цепочка кругов лежит внутри прямоугольника корпуса и
// закрывает его от носа до кормы без дыр шире радиуса.
assert(vehicle('armyTruck').hull.length > vehicle('pickup').hull.length
  && vehicle('pickup').hull.length > vehicle('motorcycle').hull.length, 'hull length grows bike < pickup < truck');
assert(vehicle('pickup').hull.offsetX > 0.3 && vehicle('armyTruck').hull.offsetX > 0.3, 'the driver sits on the left of a car');
for (const row of catalog.vehicles) {
  const { hull } = row;
  for (const angle of [0, 0.7, Math.PI / 2, 2.5]) {
    const circles = vehicleHullCircles(hull, 3, -2, angle, 0.48);
    const forward = [Math.sin(angle), Math.cos(angle)];
    const right = [Math.cos(angle), -Math.sin(angle)];
    const local = circles.map(c => {
      const dx = c.x - 3;
      const dz = c.z + 2;
      return { along: dx * forward[0] + dz * forward[1], side: dx * right[0] + dz * right[1], r: c.r };
    });
    for (const c of local) {
      assert(Math.abs(c.side - hull.offsetX) < 1e-9, `${row.itemId}: hull circles stay on the hull axis`);
      assert(c.along - c.r >= hull.offsetZ - hull.length / 2 - 1e-9 || c.r > hull.length / 2 - 1e-9,
        `${row.itemId}: a hull circle sticks out behind the hull`);
    }
    const front = Math.max(...local.map(c => c.along + c.r));
    const back = Math.min(...local.map(c => c.along - c.r));
    assert(Math.abs(front - Math.max(hull.offsetZ + hull.length / 2, hull.offsetZ + local[0].r)) < 1e-6
      && Math.abs(back - Math.min(hull.offsetZ - hull.length / 2, hull.offsetZ - local[0].r)) < 1e-6,
      `${row.itemId}: the hull chain reaches the nose and the tail`);
    for (let i = 1; i < local.length; i += 1) {
      assert(Math.abs(local[i].along - local[i - 1].along) <= local[0].r + 1e-9, `${row.itemId}: gaps in the hull chain`);
    }
  }
}

// Каталог не принимает транспорт, который нельзя надеть в слот транспорта...
const row = (extra = {}) => ({ ...rawVehicles.vehicles.find(entry => entry.itemId === 'motorcycle'), ...extra });
const others = rawVehicles.vehicles.filter(entry => entry.itemId !== 'motorcycle');
const withMotorcycle = (...rows) => ({ vehicles: [...others, ...rows] });
assert.throws(() => normalizeVehicleCatalog(withMotorcycle(row(), row({ itemId: 'backpack' })), items), /vehicle slot/);
// ...с неизвестным видом, безумной скоростью, повтором или без строки на один из тиров...
assert.throws(() => normalizeVehicleCatalog(withMotorcycle(row({ kind: 'tank' })), items), /unknown kind/);
assert.throws(() => normalizeVehicleCatalog(withMotorcycle(row({ tiers: row().tiers.map(t => ({ ...t, speed: 90 })) })), items),
  /invalid speed/);
assert.throws(() => normalizeVehicleCatalog(withMotorcycle(row(), row()), items), /listed twice/);
assert.throws(() => normalizeVehicleCatalog(withMotorcycle(row({ tiers: row().tiers.slice(1) })), items), /no stats for tier 2/);
assert.throws(() => normalizeVehicleCatalog(withMotorcycle(row({ tiers: [...row().tiers, { tier: 1, speed: 8 }] })), items),
  /missing tiers: 1/);
assert.throws(() => normalizeVehicleCatalog(withMotorcycle(row({ turnFullDeg: 400 })), items), /turnFullDeg/);
// ...и предмет слота транспорта без описания транспорта.
assert.throws(() => normalizeVehicleCatalog({ vehicles: [] }, items), /has no vehicle definition/);

// tierRange: авторский тир обязан входить в диапазон, диапазон — в T1–T5.
const tierSources = { items: json('data/kromka/items.json'), recipes: json('data/kromka/field-recipes.json'), tiers: json('data/kromka/tiers.json') };
const withMotorcycleRange = tierRange => ({
  ...tierSources,
  items: { ...tierSources.items, items: tierSources.items.items.map(item => item.id === 'motorcycle' ? { ...item, tierRange } : item) }
});
assert.throws(() => buildTieredCatalogs(withMotorcycleRange([3, 5])), /invalid tierRange/);
assert.throws(() => buildTieredCatalogs(withMotorcycleRange([2, 6])), /invalid tierRange/);
assert.throws(() => buildTieredCatalogs(withMotorcycleRange('2-5')), /invalid tierRange/);
assert(!('tierRange' in items.items.find(item => item.id === 'motorcycle')), 'tierRange is authoring data, not a catalog field');

const now = 1_000_000;
const ready = { vehicle: motorcycle, inRoom: true, lastToggleAt: 0, now };
assert.equal(vehicleMountRefusal(ready), '', 'a conscious rider with a worn motorcycle may mount');
assert.match(vehicleMountRefusal({ ...ready, vehicle: null }), /слот «Транспорт»/);
assert.match(vehicleMountRefusal({ ...ready, downed: true }), /Без сознания/);
assert.match(vehicleMountRefusal({ ...ready, dead: true }), /Без сознания/);
assert.match(vehicleMountRefusal({ ...ready, stunned: true }), /Оглушение/);
assert.match(vehicleMountRefusal({ ...ready, inRoom: false }), /только на месте/);
assert.match(vehicleMountRefusal({ ...ready, blocked: true }), /не встать/);
assert.match(vehicleMountRefusal({ ...ready, lastToggleAt: now - motorcycle.toggleCooldownMs + 1 }), /Не так часто/);
assert.equal(vehicleMountRefusal({ ...ready, lastToggleAt: now - motorcycle.toggleCooldownMs }), '');
assert.equal(vehicleToggleRefusal(motorcycle, now + 5000, now), '', 'a clock step back never locks the rider out');

const handling = ({ acceleration, turnStillDeg, turnFullDeg, reverseSpeed }) => ({ acceleration, turnStillDeg, turnFullDeg, reverseSpeed });
const mounted = mountedVehicleState(motorcycle, now);
assert.deepEqual(mounted, { itemId: 'motorcycle', kind: 'motorcycle', speed: motorcycle.speed, ...handling(motorcycle),
  hull: motorcycle.hull, since: now });
assert.deepEqual(publicMountedVehicle(mounted), { itemId: 'motorcycle', kind: 'motorcycle', speed: motorcycle.speed,
  ...handling(motorcycle), hull: { ...motorcycle.hull } }, 'observers get the vehicle, its handling and hull, not server bookkeeping');
assert.equal(publicMountedVehicle(mountedVehicleState(vehicle('armyTruckT4'), now)).turnFullDeg, vehicle('armyTruckT4').turnFullDeg);
assert.equal(publicMountedVehicle(null), null);
assert.equal(normalizeDismountReason('hit'), 'hit');
assert.equal(normalizeDismountReason('<script>'), 'request');

// Бюджет движения сервера — та самая функция из server.js, без комнаты: седок
// проезжает за пакет столько, сколько позволяет транспорт, пешеход — нет, а
// только что спешенный ещё короткое время укладывается в бюджет седла.
const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function functionSource(name) {
  const start = serverSource.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return serverSource.slice(start, serverSource.indexOf('\n}', start) + 2);
}
// Комната «wall» — стена по x = 5 (всё, что заходит за неё, упирается).
const WALL_X = 5;
const context = vm.createContext({
  PLAYER_SPEED: 7,
  PLAYER_COLLISION_RADIUS: 0.48,
  clamp: (value, min, max) => Math.max(min, Math.min(max, Number(value))),
  rooms: new Map([['wall', { id: 'wall' }]]),
  playerWorldExtent: () => 140,
  isArtifactStunned: () => false,
  serverArtifactEffects: () => ({ speedPct: 0 }),
  serverClosedLocationMovementBounds: () => null,
  serverPointInsideClosedLocationBounds: () => true,
  isRoomTerrainWalkableWorld: () => true,
  roomStaticCollisionMoveAllowed: (room, fx, fz, x, z, r) => x + r <= WALL_X,
  roomEnemyCollisionMoveAllowed: () => true,
  roomStaticCollisionPenaltyAt: (room, x, z, r) => Math.max(0, x + r - WALL_X),
  roomEnemyCollisionPenalty: () => 0,
  vehicleHullCircles
});
vm.runInContext(`${functionSource('clampPlayerVelocity')}\n${functionSource('serverVehicleHullPenalty')}\n`
  + `${functionSource('serverApplyMovementProposal')}\n`
  + 'this.api = { clampPlayerVelocity, serverApplyMovementProposal };', context);
const { clampPlayerVelocity, serverApplyMovementProposal } = context.api;
const stepX = (player, distance, now) => {
  const before = player.x;
  serverApplyMovementProposal(player, { x: player.x + distance, z: 0 }, now);
  return player.x - before;
};
const actor = extra => ({ x: 0, z: 0, lastMovementProposalAt: 1000, ...extra });
// 150 мс между пакетами: пешеход укладывается в 7 * 0,15 * 1,35 + 0,22 = 1,64 м.
const walked = stepX(actor(), 2.2, 1150);
assert(walked > 1.6 && walked < 1.7, `a walker is capped near 1.64 m per packet, got ${walked}`);
const rider = actor({ mountedVehicle: mountedVehicleState(motorcycle, 0) });
assert(Math.abs(stepX(rider, 2.2, 1150) - 2.2) < 1e-9, 'a rider covers the whole 2.2 m step');
const jump = stepX(rider, 40, 1300);
assert(jump < motorcycle.speed * 0.15 * 1.35 + 0.23, `even a rider cannot teleport, moved ${jump}`);
const graced = actor({ vehicleGraceSpeed: motorcycle.speed, vehicleGraceUntil: 1500 });
assert(Math.abs(stepX(graced, 2.2, 1150) - 2.2) < 1e-9, 'a rider knocked off keeps the saddle budget briefly');
const expired = actor({ vehicleGraceSpeed: motorcycle.speed, vehicleGraceUntil: 1100 });
assert(stepX(expired, 2.2, 1150) < 1.7, 'after the grace window the rider walks');
assert.equal(clampPlayerVelocity(40), 7 * 1.35, 'relayed walking velocity keeps the walking ceiling');
assert.equal(clampPlayerVelocity(40, motorcycle.speed), motorcycle.speed * 1.35, 'a rider relays the vehicle speed');

// Корпус у стены: грузовик носом к стене (угол π/2 — «вперёд» по +x) встаёт,
// когда в стену упирается нос, а не водитель; пешеход с той же точки проходит дальше.
const truck = vehicle('armyTruck');
const noseAhead = truck.hull.offsetZ + truck.hull.length / 2;
const driver = extra => actor({ roomId: 'wall', angle: Math.PI / 2, mountedVehicle: mountedVehicleState(truck, 0), ...extra });
const nearWall = WALL_X - noseAhead - 0.5;
const cab = driver({ x: nearWall });
serverApplyMovementProposal(cab, { x: nearWall + 1, z: 0, angle: Math.PI / 2 }, 1150);
assert(Math.abs(cab.x - nearWall) < 1e-9, `the truck nose stops at the wall, moved ${cab.x - nearWall}`);
const shorter = driver({ x: nearWall });
serverApplyMovementProposal(shorter, { x: nearWall + 0.4, z: 0, angle: Math.PI / 2 }, 1150);
assert(Math.abs(shorter.x - nearWall - 0.4) < 1e-9, 'the truck drives up to the wall');
const walker = actor({ roomId: 'wall', x: nearWall });
serverApplyMovementProposal(walker, { x: nearWall + 1, z: 0 }, 1150);
assert(walker.x > nearWall + 0.9, 'a pedestrian at the same spot is not stopped by an absent truck');
// Вдоль стены ехать можно; развернуть корпус носом в стену — нельзя, угол остаётся.
const alongside = driver({ x: WALL_X - truck.hull.offsetX - truck.hull.width / 2 - 0.3, angle: 0 });
const turn = serverApplyMovementProposal(alongside, { x: alongside.x, z: 0.5, angle: Math.PI / 2 }, 1150);
assert.equal(turn.angle, 0, 'the truck cannot swing its hull into the wall');
assert(Math.abs(alongside.z - 0.5) < 1e-9, 'the truck still drives along the wall');
const away = serverApplyMovementProposal(driver({ x: -3, angle: 0 }), { x: -3, z: 0.5, angle: -Math.PI / 2 }, 1150);
assert.equal(away.angle, -Math.PI / 2, 'turning in open space is accepted');
// Уже упёршийся корпус может отъехать назад, а не застревает.
const stuck = driver({ x: WALL_X - noseAhead + 0.3 });
serverApplyMovementProposal(stuck, { x: stuck.x - 0.5, z: 0, angle: Math.PI / 2 }, 1150);
assert(stuck.x < WALL_X - noseAhead, 'a hull pressed into the wall backs out');

// Грузоподъёмность — те самые функции из server.js: транспорт прибавляет свой
// carryKg, только пока игрок за рулём; надетый в слот, но пешком — ничего.
const carryContext = vm.createContext({
  KROMKA_VEHICLE_CATALOG: catalog,
  serverStatValue: () => 5,
  serverBaseItemId: id => String(id || ''),
  serverArtifactEffects: () => ({ carryKg: 0 }),
  serverPlayerInventoryWeight: p => Number(p.weight || 0),
  vehicleForItem,
  vehicleCarryKg
});
vm.runInContext(`${functionSource('serverCarryCapacity')}\n${functionSource('serverMountedVehicleDefinition')}\n`
  + `${functionSource('serverOnFootOverload')}\n`
  + 'this.carry = serverCarryCapacity; this.overload = serverOnFootOverload;', carryContext);
const walkingCapacity = carryContext.carry({ equipment: {} });
for (const row of catalog.vehicles) {
  assert.equal(carryContext.carry({ equipment: { vehicle: row.itemId } }), walkingCapacity,
    `${row.itemId} worn on foot must not carry anything`);
  assert.equal(carryContext.carry({ equipment: { vehicle: row.itemId }, mountedVehicle: mountedVehicleState(row, 0) }),
    walkingCapacity + row.carryKg, `${row.itemId} at the wheel must add its ${row.carryKg} kg`);
}
const loadedCab = { weight: walkingCapacity + 100, equipment: { vehicle: 'armyTruck' }, mountedVehicle: mountedVehicleState(truck, 0) };
assert.deepEqual(JSON.parse(JSON.stringify(carryContext.overload(loadedCab))), { weight: walkingCapacity + 100, capacity: walkingCapacity },
  'a loaded truck would overload its driver on foot');
assert.equal(carryContext.overload({ ...loadedCab, weight: walkingCapacity }), null, 'a light load leaves the cab freely');

console.log(`Vehicles OK: ${catalog.vehicles.length} vehicle(s) in 4 groups, motorcycle ${motorcycle.speed} m/s, tier ladder, `
  + 'hull chains, hull vs wall on move and turn, mount refusals, public state with handling, carry at the wheel only '
  + 'and the saddle movement budget.');
