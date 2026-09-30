#!/usr/bin/env node
'use strict';

// Погода на настоящем сервере. Игроки в зоне с речным суглинком и в городе входят
// в ясную погоду (проверки закрепляют её) и получают её в состоянии комнаты.
// Разработчик закрепляет ливень через /api/dev/weather — обе комнаты получают
// weatherState: в суглинке грязи полная мера, на мостовой города втрое меньше.
// Сервер режет пешеходу шаг ровно на множитель грязи, новый вход в ливень
// приносит ливень, неизвестная погода отклоняется, а null возвращает живое поле.

process.env.DEV_API_MODE = 'local';

const assert = require('node:assert/strict');
const http = require('node:http');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const { groundMudFactor, WEATHER_EFFECT_LIMITS } = require('../src/server/weather');

const accounts = {};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const LOAM_ZONE = 'z_08_11';
const LOAM_ENTRY = { tx: 81, tz: 9 };
// Пауза между пакетами длиннее потолка сервера (0,75 с): бюджет шага точно известен.
const STEP_PAUSE_MS = 820;
const walkBudget = multiplier => 7 * multiplier * 0.75 * 1.35 + 0.22;

function devRequest(method, route, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? '' : JSON.stringify(body);
    const url = new URL(h.baseUrl() + route);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'x-dev-local': '1',
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitFor(predicate, label, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function stepToward(account, from, direction, meters = 12) {
  await delay(STEP_PAUSE_MS);
  const result = await h.socketAck(account.socket, 'state', {
    seq: ++account.weatherSeq,
    x: from.x + direction.x * meters,
    z: from.z + direction.z * meters,
    angle: Math.atan2(direction.x, direction.z),
    moving: true, turning: false, crouching: false,
    vx: direction.x * 5, vz: direction.z * 5
  });
  const self = result?.self || result || {};
  const to = { x: Number(self.x), z: Number(self.z) };
  assert(Number.isFinite(to.x) && Number.isFinite(to.z), `state ack carries the position: ${JSON.stringify(result).slice(0, 300)}`);
  return { to, moved: Math.hypot(to.x - from.x, to.z - from.z), self };
}

(async () => {
  await h.bootstrapCharacters(accounts);
  zoneWalk.placeInZone(h, accounts, 'untargeted', LOAM_ZONE, zoneWalk.world(LOAM_ENTRY));
  zoneWalk.placeInZone(h, accounts, 'harvest', 'settlement', { x: 0, z: -22 });
  await h.startServer();
  const loamPlayer = accounts.untargeted;
  const cityPlayer = accounts.harvest;
  await h.connectAndJoin(loamPlayer);
  await h.connectAndJoin(cityPlayer);
  loamPlayer.weatherSeq = 1000;
  cityPlayer.weatherSeq = 1000;

  // Вход: погода приходит в состоянии комнаты, проверки идут в закреплённую ясную.
  const joinedWeather = cityPlayer.join.worldState?.weather;
  assert(joinedWeather, 'the join world state carries the weather');
  assert.equal(joinedWeather.state, 'clear');
  assert.equal(joinedWeather.forced, true, 'checks pin the weather');
  assert.equal(joinedWeather.effects.moveSpeedMultiplier, 1);
  assert.equal(loamPlayer.join.self.locationId || loamPlayer.join.worldState.locationId, LOAM_ZONE);
  const loamRoomId = loamPlayer.join.worldState.roomId;
  const cityRoomId = cityPlayer.join.worldState.roomId;
  assert(loamRoomId && cityRoomId && loamRoomId !== cityRoomId, 'the two players stand in different rooms');

  // Свободный отрезок в городе в ясную погоду: шаг проходит полный бюджет пешехода.
  const start = { x: Number(cityPlayer.join.self.x), z: Number(cityPlayer.join.self.z) };
  const directions = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  let free = null;
  let position = start;
  for (const direction of directions) {
    const { to, moved, self } = await stepToward(cityPlayer, position, direction);
    if (Math.abs(moved - walkBudget(1)) < 0.01) { free = { direction, from: position, to, self }; position = to; break; }
    position = to;
  }
  assert(free, 'a clear walker covers the full budget along one open axis of the city');
  assert.equal(Number(free.self?.artifactRuntime?.wetSeconds || 0), 0, 'nobody is wet in clear weather');

  // Ливень: обе комнаты получают weatherState.
  const received = { loam: [], city: [] };
  loamPlayer.socket.on('weatherState', payload => received.loam.push(payload));
  cityPlayer.socket.on('weatherState', payload => received.city.push(payload));
  const pinned = await devRequest('POST', '/api/dev/weather', { override: 'storm' });
  assert.equal(pinned.status, 200, JSON.stringify(pinned.json));
  assert.equal(pinned.json.override.rain, 1);
  const loamStorm = await waitFor(() => received.loam.find(row => row.weather?.state === 'storm'), 'loam storm');
  const cityStorm = await waitFor(() => received.city.find(row => row.weather?.state === 'storm'), 'city storm');
  assert.equal(loamStorm.roomId, loamRoomId, 'the broadcast names the room');
  assert.equal(cityStorm.roomId, cityRoomId);
  assert.equal(received.loam.some(row => row.roomId === cityRoomId), false, 'a room hears only its own weather');
  const loamMove = 1 - WEATHER_EFFECT_LIMITS.mudMovePenalty * groundMudFactor('river_loam');
  const cityMove = 1 - WEATHER_EFFECT_LIMITS.mudMovePenalty * groundMudFactor('city');
  assert(Math.abs(loamStorm.weather.effects.moveSpeedMultiplier - loamMove) < 0.0015, JSON.stringify(loamStorm.weather));
  assert(Math.abs(cityStorm.weather.effects.moveSpeedMultiplier - cityMove) < 0.0015, JSON.stringify(cityStorm.weather));
  assert(loamStorm.weather.mud > cityStorm.weather.mud * 2, 'river loam turns to mud, city streets stay paved');
  assert.equal(loamStorm.weather.effects.hearingMultiplier, cityStorm.weather.effects.hearingMultiplier,
    'the rain masks footsteps the same everywhere');
  assert(loamStorm.weather.effects.visionMultiplier < 1 && loamStorm.weather.effects.rangedAccuracyMultiplier < 1);

  const listed = await devRequest('GET', '/api/dev/weather');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.rooms.map(row => row.roomId).sort(), [cityRoomId, loamRoomId].sort());

  // Тот же свободный отрезок назад в ливень: сервер пускает ровно бюджет с грязью.
  const back = { x: -free.direction.x, z: -free.direction.z };
  const stormStep = await stepToward(cityPlayer, free.to, back);
  assert(Math.abs(stormStep.moved - walkBudget(cityStorm.weather.effects.moveSpeedMultiplier)) < 0.01,
    `mud shortens the authoritative step: ${stormStep.moved.toFixed(3)} m vs ${walkBudget(cityStorm.weather.effects.moveSpeedMultiplier).toFixed(3)} m`);
  assert(stormStep.moved < walkBudget(1) - 0.2, 'the storm step is visibly shorter than the clear one');
  // Под ливнем игрок мокнет, как в росе аномалии: «Громник» тогда оглушает током.
  assert(Number(stormStep.self?.artifactRuntime?.wetSeconds || 0) > 20,
    `a player in the downpour is wet: ${JSON.stringify(stormStep.self?.artifactRuntime || null)}`);

  // Новый вход в ливень приносит ливень сразу, до следующей рассылки.
  h.closeSocket(loamPlayer);
  await delay(700);
  await h.connectAndJoin(loamPlayer);
  assert.equal(loamPlayer.join.worldState.weather.state, 'storm', 'a fresh join already carries the downpour');

  // Неизвестная погода отклоняется и не сбрасывает закреплённую.
  const refused = await devRequest('POST', '/api/dev/weather', { override: 'hail' });
  assert.equal(refused.status, 400);
  assert.equal((await devRequest('GET', '/api/dev/weather')).json.override.rain, 1, 'a refused request keeps the storm');

  // null — снова живое поле.
  const live = await devRequest('POST', '/api/dev/weather', { override: null });
  assert.equal(live.status, 200);
  assert.equal(live.json.override, null);
  const afterLive = await devRequest('GET', '/api/dev/weather');
  assert.equal(afterLive.json.override, null);

  console.log(`Weather network OK: /health, Socket.IO join weather, dev storm broadcast to 2 rooms, loam ×${loamMove.toFixed(3)} `
    + `vs city ×${cityMove.toFixed(3)} walking, authoritative step ${walkBudget(1).toFixed(2)} -> ${stormStep.moved.toFixed(2)} m, soaked in the downpour, `
    + 'fresh join, refused override, live field restored.');
})().catch(error => {
  console.error(error);
  const logs = h.serverLogs().trim();
  if (logs) console.error(logs.slice(-4000));
  process.exitCode = 1;
}).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
