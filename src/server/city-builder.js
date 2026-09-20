'use strict';

// Конструктор городов. Город занимает сектор целиком (320 × 320 м), и сервер
// собирает его из того же набора префабов, что и зоны: клиент уже умеет строить
// такие локации на лету, и новых ассетов городу не нужно.
//
// План города — как в Albion: стена по периметру с воротами на открытые стороны,
// от каждых ворот прямая улица к центральной площади, вокруг площади кольцевая
// дорога, а между улицами — четыре квартала со своим делом:
//
//        北 (север)
//   ┌───────┴───────┐
//   │ рынок │ БАНК  │   БАНК — отдельное здание: внутри хранилище фракции
//   ├───площадь─────┤         и аукционист, вход смотрит на площадь.
//   │ жильё │мастер.│
//   └───────────────┘
//
// Авторское содержимое города (квестовые объекты, тайники, аномалии) переносится
// в новый план по id: квесты ссылаются на эти объекты, терять их нельзя.
//
// Модуль чистый и детерминированный: один рецепт — один и тот же город байт в
// байт. Меняя правила сборки, поднимайте CITY_BUILDER_VERSION.

const crypto = require('node:crypto');

const CITY_BUILDER_VERSION = 1;
const TILE = 2;
const TILES = 160;
const CENTRE = TILES / 2;
// Стена стоит внутри сектора: снаружи остаётся поле, а край сектора — выход к соседям.
const WALL_HALF = 46;
const GATE_HALF = 4;
const STREET_HALF = 3;
const PLAZA_HALF = 9;
const RING_RADIUS = 28;
const WALL_STEP = 3.6; // длина секции стены из лома в тайлах (7,2 м)
const DIRECTIONS = Object.freeze({
  north: { entry: 'entryFromNorth', dx: 0, dz: -1 },
  south: { entry: 'entryFromSouth', dx: 0, dz: 1 },
  west: { entry: 'entryFromWest', dx: -1, dz: 0 },
  east: { entry: 'entryFromEast', dx: 1, dz: 0 }
});
const DISTRICTS = Object.freeze({
  // Прямоугольники кварталов в тайлах от центра: [dx0, dz0, dx1, dz1].
  bank: [12, -34, 34, -16],
  market: [-34, -34, -12, -16],
  workshop: [12, 16, 34, 34],
  homes: [-34, 16, -12, 34]
});

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round2(value) { return Math.round(Number(value) * 100) / 100; }
function camel(key) { return String(key).replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase()); }
function tileCentre(t) { return (t - CENTRE + 0.5) * TILE; }
function metresToTile(m) { return clamp(Math.floor(m / TILE + CENTRE), 0, TILES - 1); }

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) ^ Math.imul(CITY_BUILDER_VERSION, 0x9E3779B1);
  const next = () => {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: list => list[Math.floor(next() * list.length) % list.length]
  };
}

function normalizeCityRecipe(recipe = {}) {
  const gates = (Array.isArray(recipe.gates) ? recipe.gates : [])
    .filter(gate => DIRECTIONS[gate?.dir])
    .map(gate => ({ dir: gate.dir, to: String(gate.to || ''), toTitle: String(gate.toTitle || ''), toMode: String(gate.toMode || ''), road: gate.road === true }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
  if (!gates.length) throw new Error(`city ${recipe.cityId}: a city needs at least one gate`);
  const carry = recipe.carry && typeof recipe.carry === 'object' ? recipe.carry : {};
  return {
    cityId: String(recipe.cityId || ''),
    name: String(recipe.name || recipe.cityId || ''),
    seed: Number(recipe.seed) >>> 0,
    region: String(recipe.region || ''),
    groundPreset: String(recipe.groundPreset || recipe.region || ''),
    mode: String(recipe.mode || 'peaceful'),
    faction: String(recipe.faction || ''),
    n: Number(recipe.n) || 0,
    col: Number(recipe.col) || 0,
    row: Number(recipe.row) || 0,
    gates,
    carry: {
      objects: Array.isArray(carry.objects) ? carry.objects : [],
      containers: Array.isArray(carry.containers) ? carry.containers : [],
      anomalyFields: Array.isArray(carry.anomalyFields) ? carry.anomalyFields : []
    }
  };
}

/** Город из рецепта и набора префабов: обычное определение `realm.location.v1`. */
function buildCity(recipe, kit) {
  const plan = normalizeCityRecipe(recipe);
  if (!kit || typeof kit !== 'object') throw new Error(`city ${plan.cityId}: the prefab kit is missing`);
  const rng = seededRandom(plan.seed);
  const objects = [];
  const open = []; // прямоугольники улиц и площади: в них ничего не ставим

  const put = (id, prefab, tx, tz, degrees = 0, tags = []) => {
    const entry = kit[prefab];
    if (!entry) throw new Error(`city ${plan.cityId}: the kit has no prefab ${prefab}`);
    const scale = entry.scale || [1, 1, 1];
    const turn = ((Number(entry.turn) || 0) + degrees) % 360;
    const width = round2(entry.size[0] * scale[0]);
    const depth = round2(entry.size[1] * scale[2]);
    objects.push({
      id, model: camel(prefab), prefab, name: entry.name,
      position: { x: round2(tileCentre(tx)), y: 0, z: round2(tileCentre(tz)) },
      rotation: { x: 0, y: round2(turn * Math.PI / 180), z: 0 },
      scale: { x: round2(scale[0]), y: round2(scale[1]), z: round2(scale[2]) },
      collision: entry.solid ? 'solid' : 'none',
      collisionSize: { x: width, z: depth },
      footprint: { x: width, z: depth },
      vision: { blocks: !!entry.vision },
      role: entry.solid ? 'cover' : 'scenery',
      tags: [...new Set([...tags, 'city-kit'])]
    });
    return objects[objects.length - 1];
  };
  const inOpen = (tx, tz) => open.some(box => tx >= box[0] && tx <= box[2] && tz >= box[1] && tz <= box[3]);

  // --- улицы и площадь: сначала свободные места, потом всё остальное ------------------------
  const plaza = [CENTRE - PLAZA_HALF, CENTRE - PLAZA_HALF, CENTRE + PLAZA_HALF, CENTRE + PLAZA_HALF];
  open.push(plaza);
  for (const gate of plan.gates) {
    const dir = DIRECTIONS[gate.dir];
    if (dir.dz) {
      const from = dir.dz < 0 ? 0 : CENTRE;
      open.push([CENTRE - STREET_HALF, from, CENTRE + STREET_HALF, from + CENTRE]);
    } else {
      const from = dir.dx < 0 ? 0 : CENTRE;
      open.push([from, CENTRE - STREET_HALF, from + CENTRE, CENTRE + STREET_HALF]);
    }
  }

  // Вокруг авторской аномалии ничего не ставим: к ней должен быть подход.
  for (const field of plan.carry.anomalyFields) {
    const tx = metresToTile(Number(field.x) || 0);
    const tz = metresToTile(Number(field.z) || 0);
    const radius = clamp(Math.ceil((Number(field.radius) || 4) / TILE), 2, 10);
    open.push([tx - radius, tz - radius, tx + radius, tz + radius]);
  }

  // --- стена по периметру с проёмами ворот --------------------------------------------------
  const wall = { min: CENTRE - WALL_HALF, max: CENTRE + WALL_HALF };
  const gateDirs = new Set(plan.gates.map(gate => gate.dir));
  let wallIndex = 0;
  for (const [side, fixedTile, along] of [
    ['north', wall.min, 'x'], ['south', wall.max, 'x'], ['west', wall.min, 'z'], ['east', wall.max, 'z']
  ]) {
    const hasGate = gateDirs.has(side);
    for (let t = wall.min; t <= wall.max; t += WALL_STEP) {
      const tile = Math.round(t);
      if (hasGate && Math.abs(tile - CENTRE) <= GATE_HALF) continue;
      const [tx, tz] = along === 'x' ? [tile, fixedTile] : [fixedTile, tile];
      put(`wall_${wallIndex++}`, 'scrap_wall_segment', tx, tz, along === 'x' ? 0 : 90, ['city-wall', side]);
    }
    if (!hasGate) continue;
    // Ворота города: две вышки по краям проёма.
    for (const offset of [-GATE_HALF - 1, GATE_HALF + 1]) {
      const [tx, tz] = along === 'x' ? [CENTRE + offset, fixedTile] : [fixedTile, CENTRE + offset];
      put(`gate_tower_${side}_${offset > 0 ? 'b' : 'a'}`, 'scrap_watch_tower', tx, tz, 0, ['city-gate', side]);
    }
  }

  // --- кварталы -----------------------------------------------------------------------------
  const anchors = {};
  const building = (id, rect, doorSide, tags) => {
    const [x0, z0, x1, z1] = rect;
    const door = { tx: doorSide === 'west' || doorSide === 'east' ? (doorSide === 'west' ? x0 : x1) : Math.round((x0 + x1) / 2),
                   tz: doorSide === 'north' || doorSide === 'south' ? (doorSide === 'north' ? z0 : z1) : Math.round((z0 + z1) / 2) };
    let index = 0;
    for (let tx = x0; tx <= x1; tx += WALL_STEP) {
      for (const tz of [z0, z1]) {
        const tile = Math.round(tx);
        const side = tz === z0 ? 'north' : 'south';
        if (side === doorSide && Math.abs(tile - door.tx) <= 2) continue;
        put(`${id}_w${index++}`, 'scrap_wall_segment', tile, tz, 0, tags);
      }
    }
    for (let tz = z0 + WALL_STEP; tz <= z1 - WALL_STEP; tz += WALL_STEP) {
      for (const tx of [x0, x1]) {
        const tile = Math.round(tz);
        const side = tx === x0 ? 'west' : 'east';
        if (side === doorSide && Math.abs(tile - door.tz) <= 2) continue;
        put(`${id}_w${index++}`, 'scrap_wall_segment', tx, tile, 90, tags);
      }
    }
    return { rect, door, centre: { tx: Math.round((x0 + x1) / 2), tz: Math.round((z0 + z1) / 2) } };
  };
  const rectOf = key => DISTRICTS[key].map((value, i) => (i % 2 === 0 ? CENTRE + value : CENTRE + value));

  // Банк: отдельное здание, вход смотрит на площадь; внутри хранилище и аукционист.
  const bankRect = rectOf('bank');
  const bank = building('bank', bankRect, 'west', ['city-building', 'bank']);
  anchors.bank = {
    door: bank.door,
    storage: { tx: bank.centre.tx + 4, tz: bank.centre.tz - 3 },
    auction: { tx: bank.centre.tx - 3, tz: bank.centre.tz + 2 },
    rect: bankRect
  };
  // Вывеска стоит сбоку от проёма: в самом проёме ей не место, через него ходят.
  put('bank_sign', 'highway_sign', bank.door.tx - 2, bank.door.tz - 4, 90, ['city-building', 'bank', 'sign']);
  put('bank_counter', 'workshop_bench', anchors.bank.auction.tx + 2, anchors.bank.auction.tz, 0, ['bank', 'counter']);
  put('bank_crates', 'cargo_stack', anchors.bank.storage.tx - 2, anchors.bank.storage.tz + 1, 0, ['bank']);

  // Рынок: ряды прилавков, у каждого — место торговца.
  const marketRect = rectOf('market');
  anchors.market = { rect: marketRect, traders: [] };
  let stall = 0;
  for (let tz = marketRect[1] + 3; tz <= marketRect[3] - 3; tz += 6) {
    for (let tx = marketRect[0] + 3; tx <= marketRect[2] - 3; tx += 7) {
      put(`market_stall_${stall}`, 'storage_lean_to', tx, tz, stall % 2 ? 90 : 0, ['city-market', 'stall']);
      put(`market_crate_${stall}`, 'cargo_stack', tx + 2, tz + 1, 0, ['city-market']);
      anchors.market.traders.push({ tx, tz: tz + 2 });
      stall += 1;
    }
  }

  // Мастерские: верстаки, стойка и ремонт.
  const workshopRect = rectOf('workshop');
  anchors.workshop = { rect: workshopRect, repair: { tx: workshopRect[0] + 4, tz: workshopRect[1] + 4 }, benches: [] };
  let bench = 0;
  for (let tz = workshopRect[1] + 3; tz <= workshopRect[3] - 3; tz += 6) {
    for (let tx = workshopRect[0] + 3; tx <= workshopRect[2] - 3; tx += 8) {
      put(`workshop_bench_${bench}`, 'workshop_bench', tx, tz, bench % 2 ? 90 : 0, ['city-workshop', 'bench']);
      anchors.workshop.benches.push({ tx, tz: tz + 2 });
      bench += 1;
    }
  }
  put('workshop_rack', 'armory_rack', workshopRect[0] + 4, workshopRect[3] - 4, 0, ['city-workshop']);
  put('workshop_scrap', 'scrap_heap', workshopRect[2] - 4, workshopRect[3] - 4, 0, ['city-workshop']);

  // Жилой квартал: лачуги, грядки и костёр.
  const homesRect = rectOf('homes');
  anchors.homes = [];
  let home = 0;
  for (let tz = homesRect[1] + 3; tz <= homesRect[3] - 3; tz += 7) {
    for (let tx = homesRect[0] + 3; tx <= homesRect[2] - 3; tx += 8) {
      put(`home_${home}`, 'wasteland_shack', tx, tz, home % 2 ? 90 : 0, ['city-home']);
      if (home % 2 === 0) put(`home_garden_${home}`, 'garden_patch', tx + 3, tz + 2, 0, ['city-home', 'garden']);
      anchors.homes.push({ tx, tz: tz + 3 });
      home += 1;
    }
  }
  put('homes_fire', 'campfire_rest', homesRect[2] - 4, homesRect[1] + 4, 0, ['city-home', 'rest']);

  // --- площадь: ориентир, доска работ, диспетчер, лазарет ------------------------------------
  const landmark = plan.mode === 'peaceful' && plan.region === 'northern_sluices' ? 'water_tank' : 'relay_antenna';
  put('plaza_landmark', landmark, CENTRE, CENTRE - 4, 0, ['city-plaza', 'landmark']);
  put('plaza_board', 'highway_sign', CENTRE - 5, CENTRE + 3, 0, ['city-plaza', 'board']);
  put('plaza_well', 'water_tank', CENTRE + 5, CENTRE + 3, 0, ['city-plaza']);
  anchors.plaza = { tx: CENTRE, tz: CENTRE };
  anchors.board = { tx: CENTRE - 5, tz: CENTRE + 5 };
  anchors.dispatcher = { tx: CENTRE + 6, tz: CENTRE - 2 };
  anchors.medic = { tx: CENTRE - 6, tz: CENTRE - 2 };

  // Дороги: полоса плит вдоль каждой улицы и кольцо у площади.
  let slab = 0;
  for (const gate of plan.gates) {
    const dir = DIRECTIONS[gate.dir];
    for (let step = PLAZA_HALF; step <= WALL_HALF; step += 3) {
      const tx = CENTRE + dir.dx * step;
      const tz = CENTRE + dir.dz * step;
      put(`street_${slab++}`, 'asphalt_slab', tx, tz, dir.dx ? 0 : 90, ['city-street', gate.dir]);
    }
  }
  for (let angle = 0; angle < 360; angle += 15) {
    const tx = Math.round(CENTRE + Math.cos(angle * Math.PI / 180) * RING_RADIUS);
    const tz = Math.round(CENTRE + Math.sin(angle * Math.PI / 180) * RING_RADIUS);
    put(`ring_${slab++}`, 'asphalt_slab', tx, tz, angle % 90 < 45 ? 0 : 90, ['city-street', 'ring']);
  }

  // --- за стеной: поле, редкие кусты и сухие деревья -----------------------------------------
  let wildIndex = 0;
  for (let i = 0; i < 260; i += 1) {
    const tx = rng.int(6, TILES - 7);
    const tz = rng.int(6, TILES - 7);
    const outside = tx < wall.min - 2 || tx > wall.max + 2 || tz < wall.min - 2 || tz > wall.max + 2;
    if (!outside || inOpen(tx, tz)) continue;
    const prefab = rng.pick(['dry_bush', 'dry_bush', 'deadwood', 'dead_tree_b', 'perimeter_debris', 'garden_patch']);
    put(`wild_${wildIndex++}`, prefab, tx, tz, rng.int(0, 359), ['city-field']);
  }

  // --- авторское содержимое: каждый объект едет в свой квартал -------------------------------
  // Станки — в мастерские, хранилище и касса — в банк, квестовые вещи — на площадь,
  // остальное интерактивное — на рынок. Позицию меняем, всё прочее оставляем как есть:
  // квесты, крафт и торговля ссылаются на эти объекты по id.
  const plazaRing = [
    { tx: CENTRE - 7, tz: CENTRE - 7 }, { tx: CENTRE + 7, tz: CENTRE - 7 },
    { tx: CENTRE - 7, tz: CENTRE + 7 }, { tx: CENTRE + 7, tz: CENTRE + 7 },
    { tx: CENTRE - 3, tz: CENTRE + 7 }, { tx: CENTRE + 3, tz: CENTRE + 7 },
    { tx: CENTRE - 7, tz: CENTRE - 2 }, { tx: CENTRE + 7, tz: CENTRE - 2 }
  ];
  const districtOf = object => {
    const kind = String(object?.interactive?.kind || '');
    const role = String(object?.interactive?.role || '');
    const service = String(object?.entity?.service || '');
    const tags = Array.isArray(object?.tags) ? object.tags : [];
    // Аукционер сидит в банке — там же, где хранилище: это правило города.
    if (service === 'auction' || role === 'storage' || kind === 'container' || tags.includes('storage')) return 'bank';
    if (service === 'repair' || kind === 'craftingStation' || tags.includes('workbench')) return 'workshop';
    if (kind === 'questObject' || tags.includes('quest')) return 'plaza';
    if (service === 'medic' || service === 'doctor') return 'plaza';
    return 'market';
  };
  // В банке первое место — стойка аукциониста, второе — хранилище, дальше вдоль стены.
  const slots = {
    workshop: anchors.workshop.benches.map(bench => ({ tx: bench.tx + 2, tz: bench.tz })),
    bank: [
      { tx: anchors.bank.auction.tx, tz: anchors.bank.auction.tz },
      { tx: anchors.bank.storage.tx, tz: anchors.bank.storage.tz },
      { tx: anchors.bank.storage.tx - 3, tz: anchors.bank.storage.tz + 3 }
    ],
    plaza: plazaRing,
    market: anchors.market.traders.map(trader => ({ tx: trader.tx + 2, tz: trader.tz - 2 }))
  };
  // Вид авторского объекта в собранном городе. Клиент строит такую локацию из
  // набора префабов, поэтому у каждой вещи должен быть ключ набора: берём одноимённый
  // (`waterTank` → `water_tank`), а станкам и сундукам даём ближайший по смыслу.
  const KIT_BY_MODEL = Object.freeze({
    craft_station_ammo: 'workshop_bench', craft_station_chem: 'workshop_bench',
    craft_station_energy: 'workshop_bench', craft_station_repair: 'workshop_bench',
    craft_station_tools: 'workshop_bench', craft_station_weapon: 'armory_rack',
    storage_chest: 'cargo_stack'
  });
  const DISTRICT_KIT = Object.freeze({ bank: 'cargo_stack', workshop: 'workshop_bench', plaza: 'highway_sign', market: 'storage_lean_to' });
  const kitKeyFor = (object, district) => {
    const direct = String(object.model || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    return kit[direct] ? direct : (KIT_BY_MODEL[direct] || DISTRICT_KIT[district] || 'cargo_stack');
  };

  const used = { workshop: 0, bank: 0, plaza: 0, market: 0 };
  const carried = plan.carry.objects.map(object => {
    const district = districtOf(object);
    const list = slots[district].length ? slots[district] : plazaRing;
    const index = used[district]++;
    const spot = list[index % list.length];
    const shift = Math.floor(index / list.length) * 3;
    const tile = { tx: clamp(spot.tx + shift, 4, TILES - 5), tz: clamp(spot.tz, 4, TILES - 5) };
    // Живые сущности (NPC) присылает сервер: префаб им не нужен и вреден — клиент
    // поставил бы рядом с торговцем его двойника из набора.
    const live = String(object?.entity?.kind || '') === 'npc';
    return {
      ...object,
      ...(live ? {} : { prefab: kitKeyFor(object, district) }),
      position: { x: round2(tileCentre(tile.tx)), y: Number(object?.position?.y) || 0, z: round2(tileCentre(tile.tz)) },
      tags: [...new Set([...(object.tags || []), 'city-authored', `city-${district}`])]
    };
  });
  const containers = plan.carry.containers.map((row, index) => {
    // Тайники города стоят в банке и в мастерских: они авторские, место должно быть осмысленным.
    const spot = index % 2 === 0 ? anchors.bank.storage : anchors.workshop.repair;
    const tile = { tx: clamp(spot.tx + (index % 2 === 0 ? -2 : 2), 4, TILES - 5), tz: clamp(spot.tz + 2 + index, 4, TILES - 5) };
    return { ...row, tx: tile.tx, tz: tile.tz, x: round2(tileCentre(tile.tx)), y: 0.1, z: round2(tileCentre(tile.tz)) };
  });
  // Аномалии остаются там, где их поставил автор: их же координаты держит лор
  // (`data/kromka/locations.json`), по которому сервер рождает артефакты.
  const anomalyFields = plan.carry.anomalyFields.map(row => ({ ...row }));

  // --- точки входа: у каждых ворот, внутри стены ---------------------------------------------
  const entries = {};
  for (const gate of plan.gates) {
    const dir = DIRECTIONS[gate.dir];
    entries[dir.entry] = {
      tx: CENTRE + dir.dx * (WALL_HALF - 6),
      tz: CENTRE + dir.dz * (WALL_HALF - 6)
    };
  }
  const hub = { tx: CENTRE, tz: CENTRE + 6 };

  const definition = {
    schema: 'realm.location.v1', version: 1, id: plan.cityId, name: plan.name, seed: plan.seed,
    kind: 'zone', generated: true, cityZone: true, builderVersion: CITY_BUILDER_VERSION, revision: '',
    safe: plan.mode === 'peaceful', pvpMode: plan.mode, noRespawn: false, enemyCap: 0, spawnCount: 0,
    allowGlobalMapExit: true, runtimeMode: 'generated', macroRegion: plan.region,
    ground: { preset: plan.groundPreset }, map: { width: TILES * TILE, depth: TILES * TILE, origin: 'center' },
    grid: { snap: true, step: TILE }, units: 'game-meters',
    spawn: { ...hub }, entryFromWorld: { ...hub }, ...entries,
    transitions: [],
    worldZones: [],
    objects: [...objects, ...carried],
    containers, anomalyFields,
    zone: { col: plan.col, row: plan.row, n: plan.n, region: plan.region, mode: plan.mode, city: plan.cityId },
    cityPlan: {
      faction: plan.faction,
      wall: { min: wall.min, max: wall.max },
      plaza: anchors.plaza, board: anchors.board, dispatcher: anchors.dispatcher, medic: anchors.medic,
      bank: anchors.bank, market: anchors.market, workshop: anchors.workshop, homes: anchors.homes,
      gates: plan.gates.map(gate => ({
        dir: gate.dir, to: gate.to,
        tx: CENTRE + DIRECTIONS[gate.dir].dx * WALL_HALF,
        tz: CENTRE + DIRECTIONS[gate.dir].dz * WALL_HALF
      }))
    }
  };
  definition.revision = cityRevision(definition);
  return definition;
}

function cityRevision(definition) {
  const { revision, ...content } = definition;
  return `c${CITY_BUILDER_VERSION}-${crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 8)}`;
}

module.exports = { CITY_BUILDER_VERSION, DIRECTIONS, TILES, WALL_HALF, buildCity, cityRevision, normalizeCityRecipe };
