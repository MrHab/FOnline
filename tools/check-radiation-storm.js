#!/usr/bin/env node
'use strict';

// Радиационная буря выброса: путь по карте и то, как её видит сервер.
//
// Модуль (src/server/radiation-storm.js):
// - путь детерминирован shiftId, направление случайно по кругу;
// - до активной фазы мир свободен, после неё тоже, а за фазу буря накрывает
//   каждую точку мира, в каждой — несколько минут;
// - рамки соседних секторов сходятся на общей стороне, город занимает ту же
//   клетку, что зона.
//
// Настоящий сервер (KROMKA_TEST_SHIFT_EPOCH_MS ставит середину прохода бури):
// - artifactState несёт бурю и рамку сцены игрока, «над игроком» совпадает с
//   модулем для его точки;
// - северные, южные, западные и восточные ворота зоны лежат по рамке на своей
//   стороне сектора: буря в зоне стоит там же, где на карте относительно ворот;
// - под бурей вне укрытия идёт урон shiftExposure, впереди бури и в укрытии —
//   нет.

process.env.NODE_ENV = 'test';
process.env.KROMKA_TEST_TRAVEL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createShiftCycle } = require('../src/server/shift-cycle');
const storms = require('../src/server/radiation-storm');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'artifacts.json'), 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const grid = graph.grid;
const bounds = { minX: 0, minY: 0, maxX: grid.cols * grid.zoneKm, maxY: grid.rows * grid.zoneKm };
const cycleOf = epochMs => createShiftCycle(catalog.shift, { epochMs });
const cycle = cycleOf(0);
const activeOffset = cycle.cycleMs - cycle.afterglowMs - cycle.activeMs;

// --- Модуль ---------------------------------------------------------------------

function checkModule() {
  const model = storms.createRadiationStorm(cycle, catalog.shift.storm, bounds);
  const headings = new Set();
  for (let index = 3; index < 19; index += 1) {
    const activeStart = index * cycle.cycleMs + activeOffset;
    const storm = model.at(activeStart + 1000);
    assert.deepEqual(model.at(activeStart + 5000), { ...storm, phase: storm.phase }, 'the storm path must not change inside a cycle');
    assert.equal(storm.id, `shift_${index}`);
    assert.equal(storm.activeStartAt, activeStart);
    assert.equal(storm.activeEndAt, activeStart + cycle.activeMs);
    headings.add(Math.floor(((storm.headingDeg % 360) + 360) % 360 / 90));
    assert.equal(model.at(index * cycle.cycleMs + 1000), null, 'no storm in the calm phase');
    assert(model.at(index * cycle.cycleMs + 1000, { forecast: true }), 'an early forecast shows the coming storm');
    const warning = model.at(activeStart - cycle.warningMs + 1000);
    assert.equal(warning.phase, 'warning');
    assert.equal(warning.id, storm.id, 'the warning shows the same storm');
    let exposure = Infinity;
    let longest = 0;
    for (let x = 0; x <= bounds.maxX; x += 10) {
      for (let y = 0; y <= bounds.maxY; y += 10) {
        assert(!storms.sampleStorm(storm, x, y, activeStart - 1).inside, `${storm.id}: (${x}, ${y}) is under the storm before it enters the world`);
        assert(!storms.sampleStorm(storm, x, y, storm.activeEndAt + 1).inside, `${storm.id}: (${x}, ${y}) is under the storm after it left the world`);
        const row = storms.sampleStorm(storm, x, y, activeStart);
        assert(row.reachedAt >= activeStart && row.passedAt <= storm.activeEndAt, `${storm.id}: (${x}, ${y}) is crossed outside the active phase`);
        const middle = Math.round((row.reachedAt + row.passedAt) / 2);
        assert(storms.sampleStorm(storm, x, y, middle).inside, `${storm.id}: (${x}, ${y}) is never under the storm`);
        assert(!storms.sampleStorm(storm, x, y, row.reachedAt - 2000).inside, `${storm.id}: (${x}, ${y}) is covered before the front reaches it`);
        const ahead = storms.sampleStorm(storm, x, y, row.reachedAt - 60000);
        assert(Math.abs(ahead.etaMs - 60000) < 50, `${storm.id}: (${x}, ${y}) ETA ${ahead.etaMs} ms a minute before the front`);
        exposure = Math.min(exposure, row.passedAt - row.reachedAt);
        longest = Math.max(longest, row.passedAt - row.reachedAt);
      }
    }
    assert(exposure >= 60000, `${storm.id}: the thinnest part of the storm lasts ${exposure} ms`);
    assert(longest <= 8 * 60000, `${storm.id}: the thickest part of the storm lasts ${longest} ms`);
  }
  assert.equal(headings.size, 4, `storm headings must come from every quarter, got ${[...headings]}`);

  // Рамки: соседние секторы сходятся на общей стороне; город 160 м — та же клетка.
  const a = storms.sectorFrame(8, 6, grid.zoneKm, 320, 320);
  const north = storms.sectorFrame(8, 5, grid.zoneKm, 320, 320);
  const east = storms.sectorFrame(9, 6, grid.zoneKm, 320, 320);
  const city = storms.sectorFrame(8, 6, grid.zoneKm, 160, 160);
  const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  assert(same(storms.localToGlobal(a, 37, -160), storms.localToGlobal(north, 37, 160)), 'the north edge of a zone must meet the south edge of its north neighbour');
  assert(same(storms.localToGlobal(a, 160, 12), storms.localToGlobal(east, -160, 12)), 'the east edge of a zone must meet the west edge of its east neighbour');
  assert(same(storms.localToGlobal(a, 160, 160), storms.localToGlobal(city, 80, 80)), 'a city covers the same 20 km sector as a zone');
  assert(same(storms.localToGlobal(storms.placeFrame(100, 50), 0, 16), { x: 100, y: 49 }), 'a place scene keeps north at +Z at zone scale');
}

// --- Сервер ---------------------------------------------------------------------

function zoneCentre(zone) {
  return { x: (zone.col + 0.5) * grid.zoneKm, y: (zone.row + 0.5) * grid.zoneKm };
}

/** Момент прохода и зоны: одна глубоко под бурей, одна далеко впереди, одна-укрытие под бурей. */
function pickScenario() {
  for (let index = 0; index < 24; index += 1) {
    const model = storms.createRadiationStorm(cycle, catalog.shift.storm, bounds);
    const activeStart = index * cycle.cycleMs + activeOffset;
    const storm = model.at(activeStart + 1);
    for (let minute = 8; minute <= 22; minute += 1) {
      const t0 = activeStart + minute * 60000;
      // Окно проверки: минута до и две после t0.
      const margin = (point, test) => [t0 - 60000, t0, t0 + 120000].every(t => test(storms.sampleStorm(storm, point.x, point.y, t)));
      const deep = row => row.inside && row.intensity >= 0.99;
      const zones = graph.zones.filter(zone => !zone.city);
      const exposed = zones.find(zone => zone.mode !== 'peaceful' && margin(zoneCentre(zone), deep));
      const ahead = zones.find(zone => zone.mode !== 'peaceful' && margin(zoneCentre(zone), row => !row.inside && row.aheadKm > 30));
      const shelter = graph.zones.find(zone => (zone.city || zone.mode === 'peaceful') && margin(zoneCentre(zone), deep));
      if (exposed && ahead && shelter) return { index, t0, activeStart, exposed, ahead, shelter, storm };
    }
  }
  throw new Error('no cycle gives a zone under the storm, a zone ahead of it and a shelter under it');
}

function tileToWorld(def, tile) {
  return {
    x: (Number(tile.tx) - Number(def.map.width) / 4 + 0.5) * 2,
    z: (Number(tile.tz) - Number(def.map.depth) / 4 + 0.5) * 2
  };
}

async function checkServer() {
  const h = require('./check-combat-runtime');
  const zoneWalk = require('./lib/zone-walk');
  const http = require('node:http');
  const accounts = {};
  const scenario = pickScenario();
  const getJson = route => new Promise((resolve, reject) => {
    http.get(h.baseUrl() + route, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on('error', reject);
  });
  await h.bootstrapCharacters(accounts);
  const walker = accounts.untargeted;
  zoneWalk.placeInZone(h, accounts, 'untargeted', scenario.exposed.id, { x: 0, z: 0 });
  // Эпоха: через 12 с после старта сервера идёт минута t0 прохода бури scenario.index.
  const startAt = Date.now() + 12000;
  process.env.KROMKA_TEST_SHIFT_EPOCH_MS = String(startAt - scenario.t0);
  const epoch = Number(process.env.KROMKA_TEST_SHIFT_EPOCH_MS);
  const model = storms.createRadiationStorm(cycleOf(epoch), catalog.shift.storm, bounds);
  await h.startServer();
  try {
    await h.connectAndJoin(walker);
    const states = [];
    const hits = [];
    walker.socket.on('artifactState', payload => states.push({ at: Date.now(), payload }));
    walker.socket.on('playerStatusEffect', payload => { if (payload?.effect === 'shiftExposure') hits.push({ at: Date.now(), payload }); });
    const waitFor = async (test, ms, label) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const found = test();
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`${label} within ${ms} ms`);
    };
    const stateIn = (locationId, since) => waitFor(() => states.find(row => row.at >= since && row.payload?.locationId === locationId && row.payload?.shift?.storm), 6000, `no artifactState with a storm in ${locationId}`);
    const expectFrame = (storm, zone, where) => {
      const frame = storm.frame;
      assert(frame, `${where}: the storm carries no frame of the player's scene`);
      assert.equal(frame.ox, (zone.col + 0.5) * grid.zoneKm, `${where}: frame origin x`);
      assert.equal(frame.oy, (zone.row + 0.5) * grid.zoneKm, `${where}: frame origin y`);
      assert(frame.kz > 0, `${where}: north of a sector is −Z (small tz), the frame must grow y with z`);
    };

    // 1. Под бурей в опасной зоне: буря, рамка, «над игроком» и урон.
    const waitStart = Math.max(0, startAt - Date.now() + 500);
    await new Promise(resolve => setTimeout(resolve, waitStart));
    const since = Date.now();
    const first = (await stateIn(scenario.exposed.id, since)).payload.shift;
    const storm = first.storm;
    const expected = model.at(Date.now());
    for (const key of ['id', 'dirX', 'dirY', 'lead0Km', 'speedKmPerSec', 'activeStartAt', 'activeEndAt', 'widthKm']) {
      assert.equal(storm[key], expected[key], `artifactState storm.${key}`);
    }
    assert.equal(first.phase, 'active');
    expectFrame(storm, scenario.exposed, scenario.exposed.id);
    assert.equal(storm.here?.inside, true, `${scenario.exposed.id}: the player at the zone centre must be under the storm`);
    await waitFor(() => hits.find(row => row.at >= since), 4500, `no shiftExposure damage under the storm in ${scenario.exposed.id}`);

    // 2. Ворота зоны лежат по рамке на своей стороне сектора.
    const def = (await getJson(`/api/locations/${scenario.exposed.id}`)).location;
    const gates = (def.transitions || []).filter(row => row.type === 'zoneGate');
    assert(gates.length >= 2, `${scenario.exposed.id}: expected gates to compare with the frame`);
    for (const gate of gates) {
      const local = tileToWorld(def, gate);
      const global = storms.localToGlobal(storm.frame, local.x, local.z);
      const d = { x: global.x - storm.frame.ox, y: global.y - storm.frame.oy };
      const side = Math.abs(d.x) > Math.abs(d.y) ? (d.x > 0 ? 'east' : 'west') : (d.y > 0 ? 'south' : 'north');
      assert.equal(side, gate.direction, `${scenario.exposed.id}: the ${gate.direction} gate lands on the ${side} side of the sector on the map`);
    }

    // 3. Впереди бури: урона нет, ETA сходится с модулем.
    const aheadSince = Date.now();
    const moved = await h.socketAck(walker.socket, 'qaTravel', { to: scenario.ahead.id, x: 0, z: 0 });
    assert(moved?.ok, `qaTravel to ${scenario.ahead.id} failed: ${moved?.error || ''}`);
    const aheadState = (await stateIn(scenario.ahead.id, aheadSince + 50)).payload.shift.storm;
    expectFrame(aheadState, scenario.ahead, scenario.ahead.id);
    assert.equal(aheadState.here?.inside, false, `${scenario.ahead.id}: the zone ahead must not be under the storm yet`);
    const centre = zoneCentre(scenario.ahead);
    const eta = storms.sampleStorm(expected, centre.x + Number(moved.x) * aheadState.frame.kx, centre.y + Number(moved.z) * aheadState.frame.kz, Date.now()).etaMs / 1000;
    assert(Math.abs(aheadState.here.etaSeconds - eta) <= 3, `${scenario.ahead.id}: ETA ${aheadState.here.etaSeconds} s vs ${eta.toFixed(1)} s`);
    await new Promise(resolve => setTimeout(resolve, 3600));
    assert(!hits.some(row => row.at >= aheadSince + 700), `${scenario.ahead.id}: damage ahead of the storm`);

    // 4. Укрытие под бурей: буря над игроком, урона нет.
    const shelterId = scenario.shelter.city || scenario.shelter.id;
    const shelterSince = Date.now();
    const sheltered = await h.socketAck(walker.socket, 'qaTravel', { to: shelterId, x: 0, z: 0 });
    assert(sheltered?.ok, `qaTravel to ${shelterId} failed: ${sheltered?.error || ''}`);
    const shelterShift = (await stateIn(shelterId, shelterSince + 50)).payload.shift;
    expectFrame(shelterShift.storm, scenario.shelter, shelterId);
    assert.equal(shelterShift.sheltered, true, `${shelterId}: must be a shelter`);
    assert.equal(shelterShift.storm.here?.inside, true, `${shelterId}: the storm must pass over the shelter too`);
    await new Promise(resolve => setTimeout(resolve, 3600));
    assert(!hits.some(row => row.at >= shelterSince + 700), `${shelterId}: damage inside a shelter`);
    return scenario;
  } finally {
    h.closeSocket(walker);
    await h.stopServer();
    h.cleanupSync();
  }
}

(async () => {
  checkModule();
  const scenario = await checkServer();
  console.log(`Radiation storm OK: deterministic paths from every quarter cross the whole world inside the active phase; `
    + `on a real server ${scenario.storm.id} covers ${scenario.exposed.id} (damage), not yet ${scenario.ahead.id} (no damage, ETA), `
    + `${scenario.shelter.city || scenario.shelter.id} is sheltered; zone gates sit on their side of the storm frame.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
