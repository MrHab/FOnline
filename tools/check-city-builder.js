#!/usr/bin/env node
'use strict';

// Конструктор городов: каждый город мира собирается дважды байт в байт, стоит за
// своей стеной с воротами на открытые стороны, ведёт улицы к площади и не теряет
// ничего авторского — станки, хранилище, аукционера, квестовые объекты и тайники.
// Отдельно проверяется правило города: хранилище и аукционер стоят в банке.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZoneRuntime } = require('../src/server/zone-runtime');
const { CITY_BUILDER_VERSION, TILES, WALL_HALF } = require('../src/server/city-builder');

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const runtime = createZoneRuntime({ graph, zonesDir: path.join(root, 'data', 'zones'), normalize: row => row });
const authoredOf = id => JSON.parse(fs.readFileSync(path.join(root, 'data', 'locations', `${id}.json`), 'utf8'));
// Разложенный в сцену город хранит прежнее авторское содержимое слепком: по нему
// конструктор и проверяется, иначе с последним городом проверка осталась бы без
// единого города — а конструктор по-прежнему даёт новому городу первую раскладку.
const snapshotOf = id => JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'city-backups', `${id}.json`), 'utf8'));
const CENTRE = TILES / 2;
const inside = (rect, tile) => tile.tx >= rect[0] && tile.tx <= rect[2] && tile.tz >= rect[1] && tile.tz <= rect[3];

const cities = runtime.cities();
assert(cities.length >= 6, `the world has ${cities.length} cities`);
let objects = 0;
let carried = 0;
const handAuthored = [];
for (const city of cities) {
  const live = authoredOf(city.locationId);
  let authored = live;
  if (live.cityAuthored === true) {
    handAuthored.push(city.locationId);
    assert.equal(live.unityScene, `Assets/Scenes/Kromka/Locations/${city.locationId}.unity`,
      `${city.locationId}: a city laid into a scene must point at it`);
    assert(fs.existsSync(path.join(root, 'unity-client', live.unityScene)),
      `${city.locationId}: ${live.unityScene} is missing`);
    authored = snapshotOf(city.locationId);
  }
  const built = runtime.cityDefinition(city.locationId, authored);
  const again = runtime.cityDefinition(city.locationId, authored);
  assert.equal(JSON.stringify(built), JSON.stringify(again), `${city.locationId}: the city is built the same way twice`);
  assert.equal(built.builderVersion, CITY_BUILDER_VERSION);
  assert.equal(built.map.width, TILES * 2, `${city.locationId}: a city fills its sector`);
  assert.equal(built.name, authored.name, `${city.locationId}: the city keeps its name`);
  assert.equal(built.pvpMode, city.zone.mode, `${city.locationId}: the city keeps the rules of its sector`);
  objects += built.objects.length;

  // --- стена и ворота ---------------------------------------------------------------------
  const plan = built.cityPlan;
  const open = Object.entries(city.zone.edges).filter(([, edge]) => edge.open).map(([dir]) => dir).sort();
  assert.deepEqual(plan.gates.map(gate => gate.dir).sort(), open, `${city.locationId}: a gate on every open side`);
  const walls = built.objects.filter(object => object.tags.includes('city-wall'));
  assert(walls.length > 40, `${city.locationId}: the city wall has ${walls.length} sections`);
  for (const side of open) {
    const entry = built[{ north: 'entryFromNorth', south: 'entryFromSouth', west: 'entryFromWest', east: 'entryFromEast' }[side]];
    assert(entry, `${city.locationId}: no entry point for arrivals from the ${side}`);
    const depth = side === 'north' || side === 'south' ? entry.tz : entry.tx;
    const outside = side === 'north' || side === 'west' ? depth < CENTRE - WALL_HALF : depth > CENTRE + WALL_HALF;
    assert(!outside, `${city.locationId}: the ${side} arrival stands outside the city wall`);
    // Проём ворот: в створе стены секций нет.
    const gateTile = { tx: side === 'west' ? CENTRE - WALL_HALF : side === 'east' ? CENTRE + WALL_HALF : CENTRE,
                       tz: side === 'north' ? CENTRE - WALL_HALF : side === 'south' ? CENTRE + WALL_HALF : CENTRE };
    const blocked = walls.some(object => Math.hypot(object.position.x - (gateTile.tx - CENTRE + 0.5) * 2,
      object.position.z - (gateTile.tz - CENTRE + 0.5) * 2) < 4);
    assert(!blocked, `${city.locationId}: the ${side} gate is walled up`);
  }

  // --- банк: хранилище и аукционер внутри здания -------------------------------------------
  assert(plan.bank && plan.bank.rect && plan.bank.door, `${city.locationId}: the city has no bank`);
  assert(inside(plan.bank.rect, plan.bank.storage), `${city.locationId}: the vault stands outside the bank`);
  assert(inside(plan.bank.rect, plan.bank.auction), `${city.locationId}: the auctioneer stands outside the bank`);
  const tileOf = object => ({ tx: Math.round(object.position.x / 2 + CENTRE - 0.5), tz: Math.round(object.position.z / 2 + CENTRE - 0.5) });
  const auctioneer = built.objects.find(object => String(object?.entity?.service || '') === 'auction');
  if (auctioneer) assert(inside(plan.bank.rect, tileOf(auctioneer)), `${city.locationId}: the authored auctioneer is not in the bank`);
  const vault = built.objects.find(object => /capital_storage/.test(String(object.id || '')));
  if (vault) assert(inside(plan.bank.rect, tileOf(vault)), `${city.locationId}: the faction vault is not in the bank`);

  // Границу стены в метрах читает клиент: внутри неё он не сыплет покров земли.
  const wallBox = built.zone.cityWall;
  assert(wallBox && wallBox.minX < wallBox.maxX && wallBox.minZ < wallBox.maxZ,
    `${city.locationId}: the zone block carries no city wall in metres`);
  assert(Math.abs(wallBox.minX - (plan.wall.min - TILES / 2 + 0.5) * 2) < 0.01,
    `${city.locationId}: the wall in metres disagrees with the wall in tiles`);

  // --- кварталы и площадь -------------------------------------------------------------------
  assert(plan.market.traders.length >= 4, `${city.locationId}: the market has ${plan.market.traders.length} stalls`);
  // Станков город не ставит: они появляются, только когда игрок выиграл участок
  // на торгах и построил станок сам.
  assert(!built.objects.some(object => String(object?.interactive?.kind || '') === 'craftingStation'),
    `${city.locationId}: the city still carries crafting stations of its own`);
  assert(plan.homes.length >= 3, `${city.locationId}: the city has ${plan.homes.length} homes`);

  // --- участки под застройку ----------------------------------------------------------------
  // Город читается участками: у каждого квартала свои, и часть стоит свободной.
  const plots = built.objects.filter(object => object.tags.includes('city-plot'));
  const plotIds = new Set(plots.map(object => object.id.replace(/_(ground|edge|post|fence|sign|board)[\w-]*$/, '')));
  assert.equal(plotIds.size, 32, `${city.locationId}: the city has ${plotIds.size} building plots`);
  const free = new Set(plots.filter(object => object.tags.includes('plot-free')).map(object => object.id.replace(/_(ground|edge|post|fence|sign|board)[\w-]*$/, '')));
  assert(free.size >= 16, `${city.locationId}: only ${free.size} plots are left free for building`);
  // У свободного участка есть табличка торгов: с неё игрок и выкупает участок.
  const boards = built.objects.filter(object => String(object?.interactive?.kind || '') === 'plotBoard');
  assert.equal(boards.length, free.size, `${city.locationId}: ${boards.length} boards for ${free.size} free plots`);
  const planOpen = (plan.plots || []).filter(row => row.open).length;
  assert.equal(planOpen, free.size, `${city.locationId}: the plan lists ${planOpen} open plots, the city shows ${free.size}`);
  for (const board of boards) {
    assert((plan.plots || []).some(row => row.id === board.interactive.plotId),
      `${city.locationId}: board ${board.id} names a plot the plan does not know`);
  }
  for (const district of ['bank', 'market', 'workshop', 'homes']) {
    assert(plots.some(object => object.tags.includes(`city-${district}`)),
      `${city.locationId}: the ${district} quarter has no plots`);
  }
  for (const anchor of [plan.plaza, plan.board, plan.dispatcher, plan.medic]) {
    assert(anchor && Math.abs(anchor.tx - CENTRE) <= 12 && Math.abs(anchor.tz - CENTRE) <= 12,
      `${city.locationId}: a square anchor stands away from the plaza: ${JSON.stringify(anchor)}`);
  }

  // --- авторское содержимое не теряется -----------------------------------------------------
  const wanted = (authored.objects || []).filter(object => object.interactive || object.entity?.kind === 'npc' || (object.tags || []).includes('quest'));
  const kit = require(path.join(root, 'data', 'zones', 'kit.json')).prefabs;
  for (const object of wanted) {
    const moved = built.objects.find(row => row.id === object.id);
    assert(moved, `${city.locationId}: the authored ${object.id} is gone from the city`);
    assert.equal(JSON.stringify(moved.interactive || null), JSON.stringify(object.interactive || null),
      `${city.locationId}: ${object.id} lost what makes it work`);
    // Клиент строит город из набора: у вещи должен быть его ключ, у живого NPC — нет.
    if (object.entity?.kind === 'npc') assert(!moved.prefab, `${city.locationId}: ${object.id} is a live NPC and needs no prefab`);
    else assert(kit[moved.prefab], `${city.locationId}: ${object.id} has no prefab of the kit (${moved.prefab})`);
    carried += 1;
  }
  // Ящиков с лутом в городе нет по решению дизайна: добыча — дело пустоши.
  assert.equal(built.containers.length, 0, `${city.locationId}: the city still carries ${built.containers.length} loot boxes`);
  assert.equal(built.anomalyFields.length, (authored.anomalyFields || []).length, `${city.locationId}: the city keeps its anomalies`);

  // --- застроенные участки: мастерская ремесла и мастер у входа, как в Albion -------------
  // Город собирается так же, как сервер: из живого определения и списка построек.
  const stations = ['ammo_bench', 'weapon_bench', 'tool_bench', 'repair_bench', 'energy_bench', 'chem_station'];
  const openPlots = (live.cityPlan?.plots || []).filter(row => row.open);
  const withWorkshops = runtime.cityDefinition(city.locationId, live,
    openPlots.map((row, index) => ({ plotId: row.id, station: stations[index % stations.length] })));
  assert.notEqual(withWorkshops.revision, runtime.cityDefinition(city.locationId, live).revision,
    `${city.locationId}: a built plot must change the city revision`);
  for (const row of openPlots) {
    const station = withWorkshops.objects.find(object => object.id === `station_${row.id}`);
    const master = withWorkshops.objects.find(object => object.id === `master_${row.id}`);
    assert(station && master, `${city.locationId}: ${row.id} is built without a workshop or a master`);
    // Забор свободного участка уходит вместе с его площадкой: мастерская стоит на своём основании.
    assert(!withWorkshops.objects.some(object => String(object.id).startsWith(`${row.id}_edge`)),
      `${city.locationId}: the built ${row.id} keeps its plot fence`);
    assert.equal(station.interactive?.plotId, row.id);
    assert.equal(master.entity?.stationObjectId, station.id);
    assert(!master.prefab, `${city.locationId}: the live master of ${row.id} must not carry a kit prefab`);
    const yaw = station.rotation.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    assert(station.collisionParts.length > 0, `${city.locationId}: the ${station.prefab} on ${row.id} has no collision`);
    for (const part of station.collisionParts) {
      const centre = {
        x: station.position.x + part.center.x * cos + part.center.z * sin,
        z: station.position.z - part.center.x * sin + part.center.z * cos
      };
      // Мастерская не выходит за свой участок: каждая её преграда в квадрате участка.
      const half = 6.2;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const lx = sx * part.size.x / 2;
        const lz = sz * part.size.z / 2;
        const corner = { x: centre.x + lx * cos + lz * sin, z: centre.z - lx * sin + lz * cos };
        assert(Math.abs(corner.x - station.position.x) <= half && Math.abs(corner.z - station.position.z) <= half,
          `${city.locationId}: the ${station.prefab} on ${row.id} sticks out of its plot`);
      }
      // Мастер стоит у рабочего места, а не внутри преграды мастерской.
      const dx = master.position.x - centre.x;
      const dz = master.position.z - centre.z;
      const along = { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
      const clear = Math.max(Math.abs(along.x) - part.size.x / 2, Math.abs(along.z) - part.size.z / 2);
      assert(clear >= 0.4, `${city.locationId}: the master of ${row.id} stands in the ${station.prefab} (${clear.toFixed(2)} m clear)`);
    }
    // От улицы до мастера проходит игрок: ни витрина, ни штабели двора его не запирают.
    assert(reachesMaster(withWorkshops.objects, station, master),
      `${city.locationId}: a player cannot walk from the street to the master of ${row.id} (${station.prefab})`);
  }
}

/** Преграды объекта в плане: повёрнутые прямоугольники его collisionParts. */
function blockersOf(object) {
  if (object?.collision !== 'solid' || !Array.isArray(object.collisionParts)) return [];
  const yaw = Number(object.rotation?.y) || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const sx = Number(object.scale?.x) || 1;
  const sz = Number(object.scale?.z) || 1;
  return object.collisionParts.map(part => {
    const cx = (part.center?.x || 0) * sx;
    const cz = (part.center?.z || 0) * sz;
    return {
      x: object.position.x + cx * cos + cz * sin, z: object.position.z - cx * sin + cz * cos,
      hx: Math.abs(part.size.x * sx) / 2, hz: Math.abs(part.size.z * sz) / 2, cos, sin
    };
  });
}

/**
 * Поиск в ширину по сетке 0,25 м в пределах участка: игрок радиусом 0,35 м
 * идёт от лицевого края участка (улица) и должен встать в 1,3 м от мастера.
 */
function reachesMaster(objects, station, master) {
  const radius = 0.35;
  const step = 0.25;
  const reach = 7.6;
  const near = objects.filter(object => Math.hypot(object.position.x - station.position.x, object.position.z - station.position.z) < 12);
  const blockers = near.flatMap(blockersOf);
  const yaw = station.rotation.y;
  const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const front = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const world = (u, v) => ({ x: station.position.x + side.x * u + front.x * v, z: station.position.z + side.z * u + front.z * v });
  const blocked = point => blockers.some(b => {
    const dx = point.x - b.x;
    const dz = point.z - b.z;
    return Math.abs(dx * b.cos - dz * b.sin) <= b.hx + radius && Math.abs(dx * b.sin + dz * b.cos) <= b.hz + radius;
  });
  const cells = Math.round(reach * 2 / step);
  const seen = new Set();
  const queue = [];
  for (let i = 0; i <= cells; i++) {
    const cell = [i, cells];
    if (!blocked(world(-reach + i * step, reach))) { seen.add(cell.join()); queue.push(cell); }
  }
  while (queue.length) {
    const [i, j] = queue.shift();
    const point = world(-reach + i * step, -reach + j * step);
    if (Math.hypot(point.x - master.position.x, point.z - master.position.z) <= 1.3) return true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni > cells || nj > cells || seen.has(`${ni},${nj}`)) continue;
      seen.add(`${ni},${nj}`);
      if (!blocked(world(-reach + ni * step, -reach + nj * step))) queue.push([ni, nj]);
    }
  }
  return false;
}

if (handAuthored.length) {
  console.log(`Города, разложенные в свои сцены и правимые руками: ${handAuthored.join(', ')}`);
}
console.log(`City builder OK: ${cities.length} cities built twice byte for byte (${objects} objects), each behind its own wall with a gate per open side, vault and auctioneer inside the bank, ${carried} authored objects carried into their districts.`);
