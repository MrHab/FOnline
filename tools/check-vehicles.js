#!/usr/bin/env node
'use strict';

// Транспорт без сервера: каталог связан с предметами, отказы «сесть» говорят
// игроку причину, а публичное состояние седока отдаёт только нужное.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeItemCatalog } = require('../src/server/kromka-items');
const {
  normalizeVehicleCatalog,
  vehicleForItem,
  vehicleMountRefusal,
  vehicleToggleRefusal,
  publicMountedVehicle,
  mountedVehicleState,
  normalizeDismountReason
} = require('../src/server/vehicles');

const ROOT = path.resolve(__dirname, '..');
const json = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const items = normalizeItemCatalog(json('data/kromka/items.json'));
const catalog = normalizeVehicleCatalog(json('data/kromka/vehicles.json'), items);

const motorcycle = vehicleForItem(catalog, 'motorcycle');
assert(motorcycle, 'the motorcycle must be a vehicle');
assert.equal(motorcycle.kind, 'motorcycle');
assert.equal(motorcycle.name, 'Армейский мотоцикл', 'the vehicle name comes from the item catalog');
// Пешком клиент упирается в потолок 7 м/с; транспорт обязан быть заметно быстрее.
assert(motorcycle.speed >= 9 && motorcycle.speed <= 14, `motorcycle speed ${motorcycle.speed} is out of the tuned band`);
assert.equal(vehicleForItem(catalog, 'backpack'), null, 'ordinary gear is not a vehicle');
assert.equal(vehicleForItem(catalog, ''), null);

// Каталог не принимает транспорт, который нельзя надеть в слот транспорта...
assert.throws(() => normalizeVehicleCatalog({ vehicles: [{ itemId: 'backpack', kind: 'motorcycle', speed: 10 }] }, items),
  /vehicle slot/);
// ...с неизвестным видом, безумной скоростью или повтором...
assert.throws(() => normalizeVehicleCatalog({ vehicles: [{ itemId: 'motorcycle', kind: 'tank', speed: 10 }] }, items),
  /unknown kind/);
assert.throws(() => normalizeVehicleCatalog({ vehicles: [{ itemId: 'motorcycle', kind: 'motorcycle', speed: 90 }] }, items),
  /invalid speed/);
assert.throws(() => normalizeVehicleCatalog({ vehicles: [
  { itemId: 'motorcycle', kind: 'motorcycle', speed: 10 },
  { itemId: 'motorcycle', kind: 'motorcycle', speed: 10 }
] }, items), /listed twice/);
// ...и предмет слота транспорта без описания транспорта.
assert.throws(() => normalizeVehicleCatalog({ vehicles: [] }, items), /has no vehicle definition/);

const now = 1_000_000;
const ready = { vehicle: motorcycle, inRoom: true, lastToggleAt: 0, now };
assert.equal(vehicleMountRefusal(ready), '', 'a conscious rider with a worn motorcycle may mount');
assert.match(vehicleMountRefusal({ ...ready, vehicle: null }), /слот «Транспорт»/);
assert.match(vehicleMountRefusal({ ...ready, downed: true }), /Без сознания/);
assert.match(vehicleMountRefusal({ ...ready, dead: true }), /Без сознания/);
assert.match(vehicleMountRefusal({ ...ready, stunned: true }), /Оглушение/);
assert.match(vehicleMountRefusal({ ...ready, inRoom: false }), /только на месте/);
assert.match(vehicleMountRefusal({ ...ready, lastToggleAt: now - motorcycle.toggleCooldownMs + 1 }), /Не так часто/);
assert.equal(vehicleMountRefusal({ ...ready, lastToggleAt: now - motorcycle.toggleCooldownMs }), '');
assert.equal(vehicleToggleRefusal(motorcycle, now + 5000, now), '', 'a clock step back never locks the rider out');

const mounted = mountedVehicleState(motorcycle, now);
assert.deepEqual(mounted, { itemId: 'motorcycle', kind: 'motorcycle', speed: motorcycle.speed, since: now });
assert.deepEqual(publicMountedVehicle(mounted), { itemId: 'motorcycle', kind: 'motorcycle', speed: motorcycle.speed },
  'observers get the vehicle, not server bookkeeping');
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
const context = vm.createContext({
  PLAYER_SPEED: 7,
  PLAYER_COLLISION_RADIUS: 0.48,
  clamp: (value, min, max) => Math.max(min, Math.min(max, Number(value))),
  rooms: new Map(),
  playerWorldExtent: () => 140,
  isArtifactStunned: () => false,
  serverArtifactEffects: () => ({ speedPct: 0 }),
  serverClosedLocationMovementBounds: () => null,
  serverPointInsideClosedLocationBounds: () => true,
  isRoomTerrainWalkableWorld: () => true,
  roomStaticCollisionMoveAllowed: () => true,
  roomEnemyCollisionMoveAllowed: () => true
});
vm.runInContext(`${functionSource('clampPlayerVelocity')}\n${functionSource('serverApplyMovementProposal')}\n`
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

console.log(`Vehicles OK: ${catalog.vehicles.length} vehicle(s), motorcycle ${motorcycle.speed} m/s, mount refusals, `
  + 'public state and the saddle movement budget.');
