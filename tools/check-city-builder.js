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
const CENTRE = TILES / 2;
const inside = (rect, tile) => tile.tx >= rect[0] && tile.tx <= rect[2] && tile.tz >= rect[1] && tile.tz <= rect[3];

const cities = runtime.cities();
assert(cities.length >= 6, `the world has ${cities.length} cities`);
let objects = 0;
let carried = 0;
for (const city of cities) {
  const authored = authoredOf(city.locationId);
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

}

console.log(`City builder OK: ${cities.length} cities built twice byte for byte (${objects} objects), each behind its own wall with a gate per open side, vault and auctioneer inside the bank, ${carried} authored objects carried into their districts.`);
