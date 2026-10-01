'use strict';

// Транспорт на настоящем сервере: мотоцикл надевается в слот, садятся на него
// через vehicleAction, комната видит седока, верхом не атакуют, а удар
// аномалии, снятие транспорта и просьба игрока ссаживают его.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(list, predicate, label, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = list.find(predicate);
    if (found) return found;
    await delay(40);
  }
  throw new Error(`${label}: timed out; got ${JSON.stringify(list.slice(-4))}`);
}

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  for (const role of ['trade', 'target']) {
    const account = accounts[role];
    const state = saves.characters[users.users[account.login].id][account.characterId].state;
    state.currentLocationId = 'solarArray';
    state.serverLocationContext = { locationId: 'solarArray' };
    Object.assign(state.player, { x: 4, z: 3 });
    if (role === 'trade') state.inventory = { ...(state.inventory || {}), motorcycle: 1 };
    // Второму игроку — грузовик T4 и 90 лома (126 кг): с надетым грузовиком это помещается, без него — перегруз.
    if (role === 'target') state.inventory = { ...(state.inventory || {}), armyTruckT4: 1, motorcycle: 1, scrap: 90 };
  }
  fs.writeFileSync(savesPath, JSON.stringify(saves)); // Isolated disposable DATA_DIR only.
  await h.startServer(); // Includes /health.
  await h.connectAndJoin(accounts.trade);
  await h.connectAndJoin(accounts.target);
  const rider = accounts.trade;
  const observer = accounts.target;
  assert.equal(rider.join.self.vehicle, null, 'Nobody rides after joining');
  assert.equal(rider.join.worldState.anomalies.roomId, observer.join.worldState.anomalies.roomId,
    'Rider and observer share the room');

  const riderEvents = [];
  const observerEvents = [];
  rider.socket.on('playerVehicle', payload => riderEvents.push(payload));
  observer.socket.on('playerVehicle', payload => observerEvents.push(payload));

  const empty = await h.socketAck(rider.socket, 'vehicleAction', { action: 'toggle' });
  assert.equal(empty.ok, false, 'A rider without a worn vehicle cannot mount');
  assert.match(empty.error, /слот «Транспорт»/);

  const equip = await h.socketAck(rider.socket, 'equipmentAction', {
    requestId: 'vehicle-check-equip',
    slot: 'vehicle',
    itemRuntimeId: 'motorcycle',
    expectedRevision: rider.join.self.equipmentRevision
  });
  assert(equip.ok, JSON.stringify(equip));
  assert.equal(equip.self.equipmentRuntime.vehicle, 'motorcycle', 'The motorcycle sits in the vehicle slot');
  assert(!(equip.self.inventory || []).some(row => row.id === 'motorcycle'), 'A worn motorcycle leaves the bag');

  const mount = await h.socketAck(rider.socket, 'vehicleAction', { action: 'toggle' });
  assert(mount.ok && mount.mounted, JSON.stringify(mount));
  assert.equal(mount.vehicle.itemId, 'motorcycle');
  assert(mount.vehicle.speed > 7, 'The server rides faster than the walking ceiling');
  assert(mount.vehicle.turnFullDeg > 0 && mount.vehicle.acceleration > 0, `the saddle carries the handling: ${JSON.stringify(mount.vehicle)}`);
  assert.deepEqual(mount.self.vehicle, mount.vehicle, 'The authoritative self carries the mounted vehicle');
  const seen = await waitFor(observerEvents, row => row.id === rider.join.self.id && row.vehicle, 'observer sees the rider mount');
  assert.equal(seen.vehicle.itemId, 'motorcycle');
  await waitFor(riderEvents, row => row.vehicle, 'the rider hears their own mount');

  const attack = await h.socketAck(rider.socket, 'combatAttack', { attackToken: 'vehicle-check-attack', mode: 'single' });
  assert.equal(attack.ok, false, 'Nobody attacks from the saddle');
  assert.match(attack.error, /За рулём не стреляют/);

  // Поздний вход видит седока сразу, без отдельного события.
  h.closeSocket(observer);
  await delay(200);
  await h.connectAndJoin(observer);
  observer.socket.on('playerVehicle', payload => observerEvents.push(payload));
  const riderInJoin = (observer.join.players || []).find(row => row.id === rider.join.self.id);
  assert(riderInJoin?.vehicle?.itemId === 'motorcycle', `late joiner must see the rider mounted: ${JSON.stringify(riderInJoin)}`);

  // Стартер: слезть можно сразу, а снова сесть — только после паузы.
  const off = await h.socketAck(rider.socket, 'vehicleAction', { action: 'dismount' });
  assert(off.ok && !off.mounted && off.self.vehicle === null, JSON.stringify(off));
  await waitFor(observerEvents, row => row.id === rider.join.self.id && !row.vehicle && row.reason === 'request',
    'observer sees the requested dismount');
  const tooSoon = await h.socketAck(rider.socket, 'vehicleAction', { action: 'mount' });
  assert.equal(tooSoon.ok, false);
  assert.match(tooSoon.error, /Не так часто/);
  await delay(750);
  const again = await h.socketAck(rider.socket, 'vehicleAction', { action: 'mount' });
  assert(again.ok && again.mounted, JSON.stringify(again));

  // Снятый транспорт ссаживает седока тем же ответом.
  await delay(250);
  const unequip = await h.socketAck(rider.socket, 'equipmentAction', {
    requestId: 'vehicle-check-unequip',
    slot: 'vehicle',
    itemRuntimeId: '',
    expectedRevision: again.self.equipmentRevision
  });
  assert(unequip.ok && unequip.self.vehicle === null, JSON.stringify(unequip));
  await waitFor(observerEvents, row => !row.vehicle && row.reason === 'unequipped', 'observer sees the unequipped dismount');

  // Удар аномалии выбивает из седла: въезжаем в «Звон» по свободной линии броска.
  const reequip = await h.socketAck(rider.socket, 'equipmentAction', {
    requestId: 'vehicle-check-reequip',
    slot: 'vehicle',
    itemRuntimeId: 'motorcycle',
    expectedRevision: unequip.self.equipmentRevision
  });
  assert(reequip.ok, JSON.stringify(reequip));
  await delay(750);
  const ride = await h.socketAck(rider.socket, 'vehicleAction', { action: 'mount' });
  assert(ride.ok && ride.mounted, JSON.stringify(ride));
  const chime = rider.join.worldState.anomalies.fields.find(field => field.type === 'chime');
  assert(chime?.active, 'The test needs the charged chime field');
  let seq = 1000;
  let position = { x: Number(ride.self.x), z: Number(ride.self.z) };
  for (let step = 0; step < 40 && Math.hypot(position.x - chime.x, position.z - chime.z) > chime.radius * 0.5; step++) {
    const dx = chime.x - position.x;
    const dz = chime.z - position.z;
    const length = Math.hypot(dx, dz);
    const move = Math.min(length, 1.0);
    const state = await h.socketAck(rider.socket, 'state', {
      seq: ++seq,
      x: position.x + dx / length * move,
      z: position.z + dz / length * move,
      angle: Math.atan2(dx, dz),
      vx: dx / length * 10,
      vz: dz / length * 10,
      moving: true,
      crouching: false,
      turning: false
    });
    position = { x: Number(state.self.x), z: Number(state.self.z) };
    await delay(110);
  }
  assert(Math.hypot(position.x - chime.x, position.z - chime.z) <= chime.radius,
    `the rider must reach the chime field: ${JSON.stringify({ position, chime })}`);
  const knocked = await waitFor(riderEvents, row => !row.vehicle && ['hit', 'stunned'].includes(row.reason),
    'the anomaly knocks the rider off');
  const status = await h.socketAck(rider.socket, 'state', {
    seq: ++seq, x: position.x, z: position.z, angle: 0, vx: 0, vz: 0, moving: false, crouching: false, turning: false
  });
  assert.equal(status.self.vehicle, null, 'After the hit the rider walks');

  // Грузовик (второй игрок): свой тир, своя управляемость, а кузов держит груз,
  // только пока игрок за рулём. Пешком с грузовиком в слоте лом (126 кг) — перегруз.
  const driver = observer;
  const truck = await h.socketAck(driver.socket, 'equipmentAction', {
    requestId: 'vehicle-check-truck',
    slot: 'vehicle',
    itemRuntimeId: 'armyTruckT4',
    expectedRevision: driver.join.self.equipmentRevision
  });
  assert(truck.ok && truck.self.equipmentRuntime.vehicle === 'armyTruckT4', JSON.stringify(truck));
  const cab = await h.socketAck(driver.socket, 'vehicleAction', { action: 'mount' });
  assert(cab.ok && cab.vehicle.itemId === 'armyTruckT4' && cab.vehicle.kind === 'truck', JSON.stringify(cab));
  assert(cab.vehicle.speed < mount.vehicle.speed + 1 && cab.vehicle.turnFullDeg < mount.vehicle.turnFullDeg,
    `the truck is slower to turn than the motorcycle: ${JSON.stringify(cab.vehicle)}`);
  assert(cab.vehicle.hull?.length > 6 && cab.vehicle.hull.width > 2, `the saddle carries the truck hull: ${JSON.stringify(cab.vehicle)}`);
  // Выйти с полным кузовом нельзя: груз пешком не унести.
  const leave = await h.socketAck(driver.socket, 'vehicleAction', { action: 'dismount' });
  assert.equal(leave.ok, false, `a loaded driver must not leave the cab: ${JSON.stringify({ ok: leave.ok, error: leave.error })}`);
  assert.match(leave.error, /Груз не унести пешком: 1\d\d\.\d\/\d+\.\d кг/);
  assert.equal(leave.self.vehicle?.itemId, 'armyTruckT4', 'the driver stays at the wheel');
  // Снять или сменить транспорт за рулём — тоже выйти.
  for (const [requestId, itemRuntimeId] of [['vehicle-check-truck-off', ''], ['vehicle-check-truck-swap', 'motorcycle']]) {
    const refused = await h.socketAck(driver.socket, 'equipmentAction', {
      requestId, slot: 'vehicle', itemRuntimeId, expectedRevision: leave.self.equipmentRevision
    });
    assert.equal(refused.ok, false, `a loaded truck cannot be swapped for ${itemRuntimeId || 'nothing'}`);
    assert.match(refused.error, /Груз не унести пешком/);
    assert.equal(refused.self.equipmentRuntime.vehicle, 'armyTruckT4', 'the truck stays worn');
    assert.equal(refused.self.vehicle?.itemId, 'armyTruckT4', 'and the driver stays at the wheel');
  }
  console.log(`Vehicle network OK: /health, equip into the vehicle slot, mount/cooldown/dismount events, late join, `
    + `no attacks from the saddle, unequip and ${knocked.reason} dismount, truck handling and hull, cargo carried only at the wheel.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
