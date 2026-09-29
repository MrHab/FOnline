#!/usr/bin/env node
'use strict';

// Все переходы мира на настоящем сервере. Игрока ставит тестовый qaTravel, а
// переходит он обычным changeLocation — с проверками сервера и его коллизией.
//
// - Зона в зону: каждая открытая сторона в трёх точках полосы ведёт к соседу
//   этой стороны, игрок выходит напротив точки пересечения, не в полосе соседа
//   (иначе его вынесло бы обратно) и может шагнуть дальше.
// - Зона и город: портал у края зоны ведёт в город к воротам той же стороны,
//   портал в проёме этих ворот — обратно к порталу зоны; прибытие не в портале.
// - Места: портал зоны ведёт в место, край места — обратно к порталу; скрытые
//   места (базы фракций) выводят краем в свою зону.
//
// Ошибки собираются списком: один прогон показывает все сломанные переходы.

process.env.NODE_ENV = 'test';
process.env.KROMKA_TEST_TRAVEL = '1';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const { SIDES, zoneById, zoneLocationId } = require('../src/server/zone-graph');

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const accounts = {};
const problems = [];
const stats = { edges: 0, bandBlocked: 0, cityPortals: 0, places: 0, gated: 0, hidden: 0 };
// Полный обход (KROMKA_FULL=1): три точки каждой стороны и шаг после каждого
// прибытия. Обычный — середина стороны, шаг только после порталов.
const FULL = process.env.KROMKA_FULL === '1';
const ALONG = FULL ? [0.15, 0.5, 0.85] : [0.5];
const BAND = 2;
const INSET_M = 9;
const NUDGE_M = 10;

const getJson = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});
const definitions = new Map();
async function definition(id) {
  if (!definitions.has(id)) definitions.set(id, (await getJson(`/api/locations/${id}`)).location);
  return definitions.get(id);
}

const tiles = def => ({ w: Number(def.map.width) / 2, h: Number(def.map.depth) / 2 });
const worldOf = (def, tile) => {
  const d = tiles(def);
  return { x: (Number(tile.tx) - d.w / 2 + 0.5) * 2, z: (Number(tile.tz) - d.h / 2 + 0.5) * 2 };
};
const tileOf = (def, point) => {
  const d = tiles(def);
  return { tx: Math.floor(point.x / 2 + d.w / 2), tz: Math.floor(point.z / 2 + d.h / 2) };
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inBand = (def, point, side) => {
  const d = tiles(def);
  const tile = tileOf(def, point);
  if (side === 'north') return tile.tz <= BAND;
  if (side === 'south') return tile.tz >= d.h - 1 - BAND;
  if (side === 'west') return tile.tx <= BAND;
  return tile.tx >= d.w - 1 - BAND;
};
/** Точка полосы стороны `side` на доле `along` её длины (крайняя клетка). */
function bandPoint(def, side, along) {
  const halfW = Number(def.map.width) / 2;
  const halfH = Number(def.map.depth) / 2;
  if (side === 'north') return { x: -halfW + along * halfW * 2, z: -halfH + 1 };
  if (side === 'south') return { x: -halfW + along * halfW * 2, z: halfH - 1 };
  if (side === 'west') return { x: -halfW + 1, z: -halfH + along * halfH * 2 };
  return { x: halfW - 1, z: -halfH + along * halfH * 2 };
}
/** Где должен выйти пересёкший сторону `side` в соседе `def`. */
function expectedArrival(def, side, crossedAt) {
  const halfW = Number(def.map.width) / 2;
  const halfH = Number(def.map.depth) / 2;
  const clampAlong = (value, half) => Math.max(-half + INSET_M, Math.min(half - INSET_M, value));
  if (side === 'north') return { x: clampAlong(crossedAt.x, halfW), z: halfH - INSET_M };
  if (side === 'south') return { x: clampAlong(crossedAt.x, halfW), z: -halfH + INSET_M };
  if (side === 'west') return { x: halfW - INSET_M, z: clampAlong(crossedAt.z, halfH) };
  return { x: -halfW + INSET_M, z: clampAlong(crossedAt.z, halfH) };
}

let walker = null;
const timing = { place: 0, change: 0, step: 0 };
const timed = async (key, work) => { const t = Date.now(); try { return await work(); } finally { timing[key] += Date.now() - t; } };
const place = (to, point = {}) => timed('place', async () => {
  const ack = await h.socketAck(walker.socket, 'qaTravel', { to, ...point });
  return ack?.ok ? { x: Number(ack.x), z: Number(ack.z) } : null;
});
const change = to => timed('change', () => h.socketAck(walker.socket, 'changeLocation', { locationId: to }));
const fail = (where, text) => problems.push(`${where}: ${text}`);

// Номер пакета движения растёт через все шаги: сервер отбрасывает номер не больше
// последнего принятого, а переход его не сбрасывает.
let movementSeq = 1;

/**
 * Шаг от точки прибытия: игрок не застрял в объекте. Пробует четыре направления
 * (к центру первым) и считает шаг, если хоть одно дало больше метра.
 */
async function canStepInward(def, from) {
  return timed('step', async () => {
    const centre = Math.hypot(from.x, from.z) > 0.5 ? { x: -from.x, z: -from.z } : { x: 1, z: 0 };
    const directions = [centre, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    for (const direction of directions) {
      const length = Math.hypot(direction.x, direction.z);
      const target = { x: from.x + direction.x / length * 2.5, z: from.z + direction.z / length * 2.5 };
      const state = { x: from.x, z: from.z };
      for (let frame = 0; frame < 8 && distance(state, target) > 0.4; frame += 1) {
        const dx = target.x - state.x;
        const dz = target.z - state.z;
        const span = Math.max(0.001, Math.hypot(dx, dz));
        const ack = await h.socketAck(walker.socket, 'state', {
          seq: movementSeq++, x: target.x, z: target.z, angle: Math.atan2(dx, dz), moving: true, turning: false, crouching: false,
          vx: 5.5 * dx / span, vz: 5.5 * dz / span
        });
        const self = ack?.self || ack || {};
        if (Number.isFinite(Number(self.x))) state.x = Number(self.x);
        if (Number.isFinite(Number(self.z))) state.z = Number(self.z);
        await zoneWalk.delay(60);
      }
      if (distance(state, from) >= 1) return true;
    }
    if (process.env.KROMKA_VERBOSE) console.log('    stuck at', JSON.stringify(from));
    return false;
  });
}

async function checkEdge(zone, def, gate) {
  const target = await definition(gate.to);
  for (const along of ALONG) {
    const where = `${zone.id} ${gate.direction} → ${gate.to} @${along}`;
    const at = await place(zone.id, bandPoint(def, gate.direction, along));
    if (!at) { fail(where, 'qaTravel refused'); continue; }
    // Точка полосы занята объектом — сервер сдвинул игрока внутрь: здесь край не пройти.
    if (!inBand(def, at, gate.direction)) { stats.bandBlocked += 1; continue; }
    const over = await change(gate.to);
    stats.edges += 1;
    if (!over?.ok || over.locationId !== gate.to) { fail(where, `crossing refused: ${over?.error || JSON.stringify(over).slice(0, 120)}`); continue; }
    const arrival = { x: Number(over.x), z: Number(over.z) };
    const expected = expectedArrival(target, gate.direction, at);
    if (distance(arrival, expected) > NUDGE_M) fail(where, `lands at ${arrival.x.toFixed(1)},${arrival.z.toFixed(1)}, expected ${expected.x.toFixed(1)},${expected.z.toFixed(1)}`);
    if (inBand(target, arrival, SIDES[gate.direction].opposite)) fail(where, 'lands inside the strip back and would bounce');
    if (FULL && !(await canStepInward(target, arrival))) fail(where, `stuck on arrival at ${arrival.x.toFixed(1)},${arrival.z.toFixed(1)}`);
  }
}

async function checkCityPortal(zone, def, gate) {
  const where = `${zone.id} ${gate.direction} → ${gate.to}`;
  const city = await definition(gate.to);
  const portal = worldOf(def, gate);
  const at = await place(zone.id, portal);
  if (!at || distance(at, portal) > Number(gate.radius || 5)) { fail(where, 'the zone portal stands in a blocked spot'); return; }
  const into = await change(gate.to);
  stats.cityPortals += 1;
  if (!into?.ok || into.locationId !== gate.to) { fail(where, `portal refused: ${into?.error || ''}`); return; }
  const arrival = { x: Number(into.x), z: Number(into.z) };
  const entry = city[gate.entryKey] ? worldOf(city, city[gate.entryKey]) : null;
  if (!entry || distance(arrival, entry) > 6) fail(where, `lands away from ${gate.entryKey} of the city`);
  const back = (city.transitions || []).find(row => row.type === 'zoneGate' && row.crossing === 'portal'
    && row.direction === SIDES[gate.direction].opposite);
  if (!back || back.to !== zone.id) { fail(where, `the city has no gate portal back to ${zone.id} on its ${SIDES[gate.direction].opposite} side`); return; }
  const backPortal = worldOf(city, back);
  if (distance(arrival, backPortal) <= Number(back.radius || 5) + 1) fail(where, 'lands inside the city gate portal and would bounce back');
  if (!(await canStepInward(city, arrival))) fail(where, 'stuck on arrival in the city');
  // Обратно: портал в проёме ворот города выводит к порталу зоны.
  const cityWhere = `${gate.to} ${back.direction} → ${zone.id}`;
  const atGate = await place(gate.to, backPortal);
  if (!atGate || distance(atGate, backPortal) > Number(back.radius || 5)) { fail(cityWhere, 'the gate portal stands in a blocked spot'); return; }
  const out = await change(zone.id);
  stats.cityPortals += 1;
  if (!out?.ok || out.locationId !== zone.id) { fail(cityWhere, `gate portal refused: ${out?.error || ''}`); return; }
  const outAt = { x: Number(out.x), z: Number(out.z) };
  const zoneEntry = def[back.entryKey] ? worldOf(def, def[back.entryKey]) : null;
  if (!zoneEntry || distance(outAt, zoneEntry) > 6) fail(cityWhere, `lands away from ${back.entryKey} of the zone`);
  if (distance(outAt, portal) <= Number(gate.radius || 5) + 1) fail(cityWhere, 'lands inside the zone portal and would bounce back');
}

/** Выйти из места краем: пробуем середины сторон, пока сервер не поставит в полосу. */
async function leavePlaceByEdge(placeId, zoneId) {
  const placeDef = await definition(placeId);
  if (placeDef.parentZone?.id !== zoneId) return { error: `the place edge leads to ${placeDef.parentZone?.id || 'nowhere'}` };
  for (const side of ['north', 'south', 'west', 'east']) {
    for (const along of [0.5, 0.3, 0.7]) {
      const at = await place(placeId, bandPoint(placeDef, side, along));
      if (!at || !inBand(placeDef, at, side)) continue;
      const out = await change(zoneId);
      if (out?.ok) return { out, entryKey: placeDef.parentZone.entryKey };
    }
  }
  return { error: 'no edge of the place leads out' };
}

async function checkPlace(zone, def, row) {
  const where = `${zone.id} → ${row.to}`;
  const portal = worldOf(def, row);
  const at = await place(zone.id, portal);
  if (!at || distance(at, portal) > Number(row.radius || 3.2) + 1) { fail(where, 'the place portal stands in a blocked spot'); return; }
  const into = await change(row.to);
  // В Сердцевину пускает только контракт с фракцией: портал на месте и просит его.
  if (!into?.ok && into?.contractRequired === true) { stats.gated += 1; return; }
  stats.places += 1;
  if (!into?.ok || into.locationId !== row.to) { fail(where, `portal refused: ${into?.error || ''}`); return; }
  const placeDef = await definition(row.to);
  if (!(await canStepInward(placeDef, { x: Number(into.x), z: Number(into.z) }))) fail(where, 'stuck on arrival in the place');
  const left = await leavePlaceByEdge(row.to, zone.id);
  if (left.error) { fail(`${row.to} → ${zone.id}`, left.error); return; }
  const outAt = { x: Number(left.out.x), z: Number(left.out.z) };
  const entry = def[left.entryKey] ? worldOf(def, def[left.entryKey]) : null;
  if (!entry || distance(outAt, entry) > 6) fail(`${row.to} → ${zone.id}`, `lands away from ${left.entryKey}`);
  if (distance(outAt, portal) <= Number(row.radius || 3.2) + 1) fail(`${row.to} → ${zone.id}`, 'lands inside the place portal and would bounce back');
}

async function checkHiddenPlace(zone, placeId) {
  stats.hidden += 1;
  if (!(await place(placeId))) { fail(`${placeId} → ${zone.id}`, 'qaTravel refused'); return; }
  const left = await leavePlaceByEdge(placeId, zone.id);
  if (left.error) fail(`${placeId} → ${zone.id}`, left.error);
}

(async () => {
  await h.bootstrapCharacters(accounts);
  const start = graph.zones.find(zone => !zone.city);
  zoneWalk.placeInZone(h, accounts, 'untargeted', start.id, { x: 0, z: 0 });
  await h.startServer();
  const started = Date.now();
  try {
    walker = accounts.untargeted;
    await h.connectAndJoin(walker);
    // KROMKA_ZONES=z_08_12,sluiceCity — только эти секторы (для разбора одной поломки).
    const only = new Set(String(process.env.KROMKA_ZONES || '').split(',').map(id => id.trim()).filter(Boolean));
    for (const zone of graph.zones) {
      if (only.size && !only.has(zone.id) && !only.has(zone.city || '')) continue;
      const zoneStarted = Date.now();
      if (process.env.KROMKA_VERBOSE) console.log(`… ${zone.city || zone.id}`);
      if (zone.city) {
        // Город: по порталу ворот на каждую открытую сторону, к соседу этой стороны.
        const city = await definition(zone.city);
        const open = Object.keys(zone.edges || {}).filter(side => zone.edges[side].open).sort();
        const portals = (city.transitions || []).filter(row => row.type === 'zoneGate' && row.crossing === 'portal');
        if (portals.map(row => row.direction).sort().join() !== open.join()) fail(zone.city, `gate portals ${portals.map(row => row.direction).join(',')} vs open sides ${open.join(',')}`);
        for (const row of portals) {
          const expected = zoneLocationId(zoneById(graph, zone.edges[row.direction].to));
          if (row.to !== expected) fail(zone.city, `the ${row.direction} gate portal leads to ${row.to}, not ${expected}`);
        }
        if (city.allowGlobalMapExit !== false) fail(zone.city, 'the city edge is still an exit');
        continue;
      }
      const def = await definition(zone.id);
      const gates = (def.transitions || []).filter(row => row.type === 'zoneGate');
      for (const [side, edge] of Object.entries(zone.edges || {})) {
        const gate = gates.find(row => row.direction === side);
        const neighbour = zoneById(graph, edge.to);
        const expected = zoneLocationId(neighbour);
        if (!edge.open) { if (gate) fail(zone.id, `a gate on the closed ${side} side`); continue; }
        if (!gate) { fail(zone.id, `no gate on the open ${side} side`); continue; }
        if (gate.to !== expected) { fail(zone.id, `the ${side} gate leads to ${gate.to}, not ${expected}`); continue; }
        const crossing = neighbour.city ? 'portal' : 'edge';
        if (gate.crossing !== crossing) { fail(zone.id, `the ${side} gate is ${gate.crossing}, not ${crossing}`); continue; }
        if (crossing === 'edge') await checkEdge(zone, def, gate);
        else await checkCityPortal(zone, def, gate);
      }
      if (def.exit) fail(zone.id, 'a zone must not carry an exit row');
      for (const row of (def.transitions || []).filter(item => item.type === 'location')) await checkPlace(zone, def, row);
      for (const hidden of (zone.places || []).filter(item => item.hidden)) await checkHiddenPlace(zone, hidden.locationId);
      if (process.env.KROMKA_VERBOSE) console.log(`  ${zone.id}: ${Date.now() - zoneStarted} ms, problems so far ${problems.length}, ${JSON.stringify(timing)}`);
    }
  } finally {
    h.closeSocket(walker);
    await h.stopServer();
    h.cleanupSync();
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (problems.length) {
    console.error(`Zone transitions: ${problems.length} problem(s) in ${seconds} s:\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`Zone transitions network OK in ${seconds} s: ${stats.edges} edge crossings land opposite and can walk on (${stats.bandBlocked} strip spots taken by objects), ${stats.cityPortals} city portal trips both ways, ${stats.places} places in by portal and out by the edge, ${stats.gated} contract-gated portal(s), ${stats.hidden} hidden bases out by the edge.`);
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
