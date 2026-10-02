'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const river = require('../src/server/dam-road-river');

const accounts = {};
const zone = require('../data/zones/authored/z_10_10.json');
const rail = require('../data/kromka/dam-road-rail.json');
const { createLocationCollision, circleBlockerPenalty } = require('../src/server/location-collision');
const collision = createLocationCollision();
const railBlockers = zone.objects.flatMap(object => collision.locationObjectBlocksMovement(object)
  ? collision.locationObjectBlockers(object).map(blocker => ({ ...blocker, id: object.id })) : []);
require('node:child_process').execFileSync(process.execPath,
  [path.join(__dirname, 'build-dam-road-rail.js'), '--check']);
assert.equal(rail.route, 'ore_freight_rail');
assert.equal(rail.gauge, 1.52);
assert.equal(rail.points[0].x, -160);
assert.equal(rail.points.at(-1).x, 160);
for (let i = 0; i < rail.points.length; i++) {
  const p = rail.points[i];
  assert(!river.isWaterAt(p.x, p.z, 0.48), `railway enters water at ${p.x}, ${p.z}`);
  if (Math.abs(p.x) < 155) for (const blocker of railBlockers) {
    assert(circleBlockerPenalty(p.x, p.z, 0.48, blocker) < 0.03,
      `railway is blocked by ${blocker.id} at ${p.x}, ${p.z}`);
  }
  if (p.x >= -124 && p.x <= -12) assert.equal(p.z, -106, 'track misses the shared bridge and checkpoint');
  if (i > 0) {
    const prev = rail.points[i - 1];
    assert(Math.hypot(p.x - prev.x, p.z - prev.z) < 0.8, 'gap in the continuous railway');
  }
}
assert(Math.abs(rail.points.at(-1).z + 97.92) < 0.01, 'east railway exit misses the next global-map segment');
const bridgeWest = river.profile.bridge.x - river.profile.bridge.halfWidth - 2;
const bridgeEast = river.profile.bridge.x + river.profile.bridge.halfWidth + 2;
const spillway = river.banksAt(-116);
const spillwayWest = spillway.center - spillway.halfWidth;
const rows = Array.from({ length: 160 }, () => Array(160).fill(0));
const waterCount = river.paintWaterTiles(rows, 2, 3);
assert(waterCount > 2000, 'the Tesma must fill the sector, not only the spillway');
for (const object of zone.objects) {
  if (!object.position) continue;
  const bank = river.banksAt(object.position.z);
  if (!bank || Math.abs(object.position.x - bank.center) >= bank.halfWidth) continue;
  assert(object.tags?.includes('canal') || object.tags?.includes('bridge'),
    `${object.id} is standing in the river outside the bridge or spillway`);
}
for (const key of ['spawn', 'entryFromWorld', 'entryFromEast', 'entryFromNorth',
  'entryFromSouth', 'entryFromWest']) {
  const point = zoneWalk.world(zone[key]);
  assert(!river.isWaterAt(point.x, point.z, 0.48), `${key} is under water`);
}
for (const z of [-159, -140, -116, -90, 0, 80, 159]) {
  const banks = river.banksAt(z);
  assert(banks && river.isWaterAt(banks.center, z), `river gap at z=${z}`);
}
for (const z of [-107.5, -106, -104.5]) {
  for (let x = bridgeWest; x <= bridgeEast; x += 0.5) {
    assert(!river.isWaterAt(x, z, 0.48), 'the bridge must stay walkable');
  }
}
assert(!river.crossesWater(bridgeWest, -106, bridgeEast, -106, 0.48), 'the bridge crossing is blocked');
assert(river.crossesWater(bridgeWest, -116, bridgeEast, -116, 0.48), 'the spillway can be jumped');
assert(river.isWaterAt(river.profile.bridge.x - 13, -90)
  && river.isWaterAt(river.profile.bridge.x + 13, -90), 'the expanded channel is missing');
assert(river.crossesWater(-54, 80, 28, 80, 0.48), 'the upstream river can be jumped');
for (const tz of [0, 1, 158, 159]) {
  const z = (tz - 79.5) * 2;
  const banks = river.banksAt(z);
  const tx = Math.floor(banks.center / 2 + 80);
  assert.equal(rows[tz][tx], 3, `water does not reach sector edge tz=${tz}`);
}

function place(role, point, vehicle = false) {
  zoneWalk.placeInZone(h, accounts, role, zone.id, point);
  if (!vehicle) return;
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const account = accounts[role];
  const state = saves.characters[users.users[account.login].id][account.characterId].state;
  state.inventory = { ...(state.inventory || {}), motorcycle: 1 };
  fs.writeFileSync(savesPath, JSON.stringify(saves));
}

async function step(account, x, z) {
  const ack = await h.socketAck(account.socket, 'state', {
    seq: account.movementSeq = (account.movementSeq || 0) + 1,
    x, z, angle: 0, moving: true, turning: false, crouching: false,
    vx: 5, vz: 0
  });
  const self = ack?.self || ack;
  assert(Number.isFinite(Number(self.x)) && Number.isFinite(Number(self.z)), 'movement ack lacks a position');
  return { x: Number(self.x), z: Number(self.z) };
}

(async () => {
  await h.bootstrapCharacters(accounts);
  place('target', { x: -55, z: 80 });
  place('trade', { x: spillwayWest - 3, z: -116 }, true);
  place('progression', { x: bridgeWest, z: -107.5 });
  place('cadence', { x: bridgeWest, z: -104.5 }, true);
  await h.startServer();
  try {
    const walker = accounts.target;
    await h.connectAndJoin(walker);
    const authoritativeMap = walker.join.worldState?.map;
    assert.equal(authoritativeMap?.length, 160, 'the server did not send the sector terrain');
    for (const tz of [0, 1, 158, 159]) {
      const z = (tz - 79.5) * 2;
      const tx = Math.floor(river.banksAt(z).center / 2 + 80);
      assert.equal(authoritativeMap[tz][tx], 3,
        `the server opened a dry bypass at edge tile ${tx},${tz}`);
    }
    let position = { x: Number(walker.join.self.x), z: Number(walker.join.self.z) };
    assert(!river.isWaterAt(position.x, position.z, 0.48), 'walker spawned in water');
    for (let i = 0; i < 35; i++) {
      position = await step(walker, 25, 80);
      assert(!river.isWaterAt(position.x, position.z, 0.48), 'walker entered upstream water');
      await zoneWalk.delay(55);
    }
    assert(position.x < -45, `walker crossed the upstream bank at x=${position.x}`);

    const rider = accounts.trade;
    await h.connectAndJoin(rider);
    const equip = await h.socketAck(rider.socket, 'equipmentAction', {
      requestId: 'dam-road-ride', slot: 'vehicle', itemRuntimeId: 'motorcycle',
      expectedRevision: rider.join.self.equipmentRevision
    });
    assert(equip.ok, 'motorcycle could not be equipped');
    const mount = await h.socketAck(rider.socket, 'vehicleAction', { action: 'mount' });
    assert(mount.ok && mount.mounted, 'motorcycle could not be mounted');
    position = { x: Number(rider.join.self.x), z: Number(rider.join.self.z) };
    for (let i = 0; i < 40; i++) {
      position = await step(rider, spillway.center + spillway.halfWidth + 3, -116);
      assert(!river.isWaterAt(position.x, position.z, 0.48),
        `motorcycle entered the spillway at x=${position.x}`);
      await zoneWalk.delay(55);
    }
    assert(position.x < spillwayWest - 0.4 && position.x > spillwayWest - 3.5,
      `motorcycle failed to reach and stop at the bank: x=${position.x}`);

    const bridge = accounts.progression;
    await h.connectAndJoin(bridge);
    position = { x: Number(bridge.join.self.x), z: Number(bridge.join.self.z) };
    for (let i = 0; i < 220 && position.x < bridgeEast - 0.5; i++) {
      position = await step(bridge, bridgeEast, -107.5);
      assert(!river.isWaterAt(position.x, position.z, 0.48), 'bridge approach entered water');
      await zoneWalk.delay(55);
    }
    assert(position.x >= bridgeEast - 0.5, `bridge could not be crossed; stopped at x=${position.x}`);
    assert(Math.abs(position.z + 107.5) < 0.6,
      `walker was pushed out of the southern bridge lane to z=${position.z}`);
    for (let i = 0; i < 220 && position.x > bridgeWest + 0.5; i++) {
      position = await step(bridge, bridgeWest, -107.5);
      assert(!river.isWaterAt(position.x, position.z, 0.48), 'return across bridge entered water');
      await zoneWalk.delay(55);
    }
    assert(position.x <= bridgeWest + 0.5, `bridge could not be crossed back; stopped at x=${position.x}`);

    const bridgeRider = accounts.cadence;
    await h.connectAndJoin(bridgeRider);
    const bridgeEquip = await h.socketAck(bridgeRider.socket, 'equipmentAction', {
      requestId: 'dam-road-bridge-ride', slot: 'vehicle', itemRuntimeId: 'motorcycle',
      expectedRevision: bridgeRider.join.self.equipmentRevision
    });
    assert(bridgeEquip.ok, 'bridge motorcycle could not be equipped');
    const bridgeMount = await h.socketAck(bridgeRider.socket, 'vehicleAction', { action: 'mount' });
    assert(bridgeMount.ok && bridgeMount.mounted, 'bridge motorcycle could not be mounted');
    position = { x: Number(bridgeRider.join.self.x), z: Number(bridgeRider.join.self.z) };
    for (let i = 0; i < 200 && position.x < bridgeEast - 0.5; i++) {
      position = await step(bridgeRider, bridgeEast, -104.5);
      assert(!river.isWaterAt(position.x, position.z, 0.48), 'motorcycle left the bridge into water');
      await zoneWalk.delay(55);
    }
    assert(position.x >= bridgeEast - 0.5,
      `motorcycle could not reach the east bank by bridge; stopped at x=${position.x}`);
    assert(Math.abs(position.z + 104.5) < 0.6,
      `motorcycle was pushed out of the northern bridge lane to z=${position.z}`);
    for (let i = 0; i < 200 && position.x > bridgeWest + 0.5; i++) {
      position = await step(bridgeRider, bridgeWest, -104.5);
      assert(!river.isWaterAt(position.x, position.z, 0.48), 'returning motorcycle left the bridge into water');
      await zoneWalk.delay(55);
    }
    assert(position.x <= bridgeWest + 0.5,
      `motorcycle could not return to the west bank by bridge; stopped at x=${position.x}`);
    console.log('Dam-road river network OK: player and motorcycle stop at water and cross by bridge; entries stay dry.');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }
})().catch(error => {
  console.error(error.stack || error);
  const logs = h.serverLogs().trim();
  if (logs) console.error(logs.slice(-4000));
  process.exitCode = 1;
}).finally(() => h.cleanupSync());
