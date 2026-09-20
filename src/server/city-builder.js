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

const CITY_BUILDER_VERSION = 2;
const TILE = 2;
// Город компактный, как в Albion: 160 × 160 м, от ворот до ворот ≈30 с бега. Зона
// пустоши вдвое больше (320 м) — сектор с городом просто меньше остальных.
const TILES = 80;
const CENTRE = TILES / 2;
// Стена стоит внутри локации: снаружи остаётся поле, а край — выход к соседям.
const WALL_HALF = 34;
const GATE_HALF = 3;
const STREET_HALF = 3;
const PLAZA_HALF = 8;
const RING_RADIUS = 10;
const WALL_STEP = 3.6; // длина секции стены из лома в тайлах (7,2 м)
const DIRECTIONS = Object.freeze({
  north: { entry: 'entryFromNorth', dx: 0, dz: -1 },
  south: { entry: 'entryFromSouth', dx: 0, dz: 1 },
  west: { entry: 'entryFromWest', dx: -1, dz: 0 },
  east: { entry: 'entryFromEast', dx: 1, dz: 0 }
});
const DISTRICT_NAMES = Object.freeze({
  bank: 'Банковский квартал', market: 'Рынок', workshop: 'Мастерские', homes: 'Жилой квартал'
});
const DISTRICTS = Object.freeze({
  // Прямоугольники кварталов в тайлах от центра: [dx0, dz0, dx1, dz1].
  bank: [6, -28, 26, -8],
  market: [-26, -28, -6, -8],
  workshop: [6, 8, 26, 28],
  homes: [-26, 8, -6, 28]
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

  const put = (id, prefab, tx, tz, degrees = 0, tags = [], shape = null) => {
    const entry = kit[prefab];
    if (!entry) throw new Error(`city ${plan.cityId}: the kit has no prefab ${prefab}`);
    const base = entry.scale || [1, 1, 1];
    const scale = shape?.scale ? [base[0] * shape.scale[0], base[1] * shape.scale[1], base[2] * shape.scale[2]] : base;
    const turn = ((Number(entry.turn) || 0) + degrees) % 360;
    const width = round2(entry.size[0] * scale[0]);
    const depth = round2(entry.size[1] * scale[2]);
    objects.push({
      id, model: camel(prefab), prefab, name: entry.name,
      position: { x: round2(tileCentre(tx)), y: round2(Number(shape?.y) || 0), z: round2(tileCentre(tz)) },
      rotation: { x: 0, y: round2(turn * Math.PI / 180), z: 0 },
      scale: { x: round2(scale[0]), y: round2(scale[1]), z: round2(scale[2]) },
      collision: entry.solid ? 'solid' : 'none',
      // Коробка коллизии — та же, что у зон: по ней клиент ставит коллайдер, а
      // без него игрок проходил бы сквозь стену и курсор не находил бы постройку.
      ...(entry.solid ? {
        collisionParts: [{
          center: { x: round2((entry.center?.[0] || 0) * scale[0]), z: round2((entry.center?.[1] || 0) * scale[2]) },
          size: { x: width, z: depth },
          height: round2(Math.max(0.4, (Number(entry.height) || 1) * scale[1]))
        }]
      } : {}),
      collisionSize: { width, depth },
      footprint: { x: width, z: depth },
      vision: { blocks: !!entry.vision },
      role: entry.solid ? 'cover' : 'scenery',
      tags: [...new Set([...tags, 'city-kit'])],
      ...(shape?.hover ? { hover: shape.hover } : {})
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

  // --- план города: площадь, кольцо, улицы и поле участков -----------------------------------
  // Схема списана с городов Albion: в середине площадь со службами, вокруг неё
  // кольцевая дорога, от неё улицы к воротам, а всё прочее место — участки под
  // застройку. Занятые держат здание квартала, свободные ждут строителя.
  //
  //        север
  //   ┌──────┬──────┐
  //   │ рынок│ банк │   Каждый квартал — сетка 3 × 3 участка по 14 × 14 м
  //   ├──площадь────┤   с проездами в четыре метра между ними.
  //   │ жильё│мастер│
  //   └──────┴──────┘
  const anchors = {};
  const building = (id, rect, doorSide, tags, hover = null) => {
    const [x0, z0, x1, z1] = rect;
    const door = { tx: doorSide === 'west' || doorSide === 'east' ? (doorSide === 'west' ? x0 : x1) : Math.round((x0 + x1) / 2),
                   tz: doorSide === 'north' || doorSide === 'south' ? (doorSide === 'north' ? z0 : z1) : Math.round((z0 + z1) / 2) };
    // Ряд секций центрируем по стороне: иначе стена выступает за участок и
    // слипается с соседним домом, а дом перестаёт читаться отдельным зданием.
    const run = (from, to) => {
      const length = to - from;
      const count = Math.max(1, Math.round(length / WALL_STEP));
      const step = length / count;
      const line = [];
      for (let i = 0; i < count; i += 1) line.push(Math.round(from + step * (i + 0.5)));
      return line;
    };
    let index = 0;
    for (const tile of run(x0, x1)) {
      for (const tz of [z0, z1]) {
        const side = tz === z0 ? 'north' : 'south';
        if (side === doorSide && Math.abs(tile - door.tx) <= 2) continue;
        put(`${id}_w${index++}`, 'scrap_wall_segment', tile, tz, 0, tags, hover ? { hover } : null);
      }
    }
    for (const tile of run(z0, z1)) {
      for (const tx of [x0, x1]) {
        const side = tx === x0 ? 'west' : 'east';
        // Проём двери — один пролёт: иначе на короткой стене не осталось бы стены.
        if (side === doorSide && Math.abs(tile - door.tz) <= 2) continue;
        put(`${id}_w${index++}`, 'scrap_wall_segment', tx, tile, 90, tags, hover ? { hover } : null);
      }
    }
    return { rect, door, centre: { tx: Math.round((x0 + x1) / 2), tz: Math.round((z0 + z1) / 2) } };
  };

  // Участок — 14 × 14 м, по каждой стороне пролёт забора: границу видно, а войти
  // можно с любого угла. На свободном стоит вывеска «под застройку».
  const PLOT_HALF = 3;
  const PLOT_ROWS = [14, 22, 30];
  const QUARTERS = Object.freeze([
    { key: 'bank', dx: 1, dz: -1 },
    { key: 'market', dx: -1, dz: -1 },
    { key: 'workshop', dx: 1, dz: 1 },
    { key: 'homes', dx: -1, dz: 1 }
  ]);
  const plots = [];
  const markPlot = (centre, district, built) => {
    const id = `plot_${plots.length}`;
    const tags = ['city-plot', `city-${district}`, built ? 'plot-built' : 'plot-free'];
    const hover = built
      ? { title: 'Застроенный участок', subtitle: DISTRICT_NAMES[district] || '', lines: ['Размер: 14 × 14 м'] }
      : { title: 'Участок под застройку', subtitle: DISTRICT_NAMES[district] || '',
          lines: ['Свободен', 'Размер: 14 × 14 м'] };
    // Площадка участка: ровное основание под застройку. По ней участок видно и с
    // земли, и на карте — как в Albion, где свободный участок это готовая площадка.
    put(`${id}_ground`, 'road_tile', centre.tx, centre.tz, 0, tags,
      { hover, scale: [(PLOT_HALF * 2 + 1) * TILE / 4, 1, (PLOT_HALF * 2 + 1) * TILE / 4] });
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      put(`${id}_edge${dx}${dz}`, 'fence_segment',
        centre.tx + dx * PLOT_HALF, centre.tz + dz * PLOT_HALF, dx ? 90 : 0, tags, { hover });
    }
    if (!built) {
      // Вывеска смотрит на площадь: с этой стороны участок и обходят.
      const toCentre = Math.abs(centre.tx - CENTRE) > Math.abs(centre.tz - CENTRE)
        ? { dx: centre.tx > CENTRE ? -1 : 1, dz: 0 }
        : { dx: 0, dz: centre.tz > CENTRE ? -1 : 1 };
      put(`${id}_sign`, 'highway_sign', centre.tx + toCentre.dx * (PLOT_HALF - 1),
        centre.tz + toCentre.dz * (PLOT_HALF - 1), toCentre.dx ? 90 : 0, [...tags, 'sign'], { hover });
    }
    const plot = { id, tx: centre.tx, tz: centre.tz, half: PLOT_HALF, district, built };
    plots.push(plot);
    return plot;
  };
  const plotRect = plot => [plot.tx - plot.half, plot.tz - plot.half, plot.tx + plot.half, plot.tz + plot.half];
  /** Участки квартала: сетка 3 × 3 от ближнего к площади угла к дальнему. */
  const quarterPlots = quarter => {
    const grid = [];
    for (const rowZ of PLOT_ROWS) {
      for (const rowX of PLOT_ROWS) {
        grid.push({ tx: CENTRE + quarter.dx * rowX, tz: CENTRE + quarter.dz * rowZ });
      }
    }
    return grid;
  };
  const quarterOf = key => QUARTERS.find(quarter => quarter.key === key);
  /** Сетка квартала от ближнего к площади участка к дальнему. */
  const byDistance = grid => [...grid].sort((a, b) =>
    (Math.abs(a.tx - CENTRE) + Math.abs(a.tz - CENTRE)) - (Math.abs(b.tx - CENTRE) + Math.abs(b.tz - CENTRE)));

  // Банк занимает ближний к площади угол квартала — четыре участка под одно
  // здание: хранилище и аукционер должны стоять далеко друг от друга.
  const bankGrid = quarterPlots(quarterOf('bank'));
  const bankInner = [bankGrid[0], bankGrid[1], bankGrid[3], bankGrid[4]];
  const bankRect = [
    Math.min(...bankInner.map(spot => spot.tx)) - PLOT_HALF, Math.min(...bankInner.map(spot => spot.tz)) - PLOT_HALF,
    Math.max(...bankInner.map(spot => spot.tx)) + PLOT_HALF, Math.max(...bankInner.map(spot => spot.tz)) + PLOT_HALF
  ];
  const BANK_HOVER = { title: 'Банк', subtitle: DISTRICT_NAMES.bank,
                       lines: ['Хранилище игрока — в дальнем углу', 'Аукционер принимает у входа'] };
  // Под банком та же площадка, что и под участками: он занимает четыре из них.
  put('bank_ground', 'road_tile', Math.round((bankRect[0] + bankRect[2]) / 2), Math.round((bankRect[1] + bankRect[3]) / 2),
    0, ['city-building', 'bank'], { hover: BANK_HOVER, scale: [(bankRect[2] - bankRect[0] + 1) * TILE / 4, 1, (bankRect[3] - bankRect[1] + 1) * TILE / 4] });
  const bank = building('bank', bankRect, 'west', ['city-building', 'bank'], BANK_HOVER);
  // Аукционер садится у входа, хранилище стоит в дальнем углу: иначе их подсказки
  // взаимодействия перекрывают друг друга — до обеих меньше пяти метров.
  anchors.bank = {
    door: bank.door,
    storage: { tx: bankRect[2] - 2, tz: bankRect[3] - 2 },
    auction: { tx: bankRect[0] + 2, tz: bankRect[1] + 2 },
    rect: bankRect
  };
  put('bank_vault', 'storage_chest', anchors.bank.storage.tx, anchors.bank.storage.tz, 0, ['bank', 'vault'], { hover: BANK_HOVER });
  put('bank_counter', 'trade_machine', anchors.bank.auction.tx + 2, anchors.bank.auction.tz, 90, ['bank', 'counter'], { hover: BANK_HOVER });
  put('bank_crates', 'cargo_stack', bank.centre.tx, bank.centre.tz, 0, ['bank'], { hover: BANK_HOVER });
  put('bank_sign', 'highway_sign', bank.door.tx - 1, bank.door.tz - 3, 90, ['city-building', 'bank', 'sign'], { hover: BANK_HOVER });
  for (const spare of bankGrid) {
    if (bankInner.includes(spare)) continue;
    markPlot(spare, 'bank', false);
  }

  // Рынок: навесы торговцев на ближних к площади участках.
  const marketGrid = byDistance(quarterPlots(quarterOf('market')));
  anchors.market = { rect: [marketGrid[0].tx, marketGrid[0].tz, marketGrid[8].tx, marketGrid[8].tz], traders: [] };
  let stall = 0;
  for (let index = 0; index < marketGrid.length; index += 1) {
    const trades = index < 4;
    const plot = markPlot(marketGrid[index], 'market', trades);
    if (!trades) continue;
    put(`market_awning_${stall}`, 'trader_awning', plot.tx, plot.tz, stall % 2 ? 90 : 0, ['city-market', 'stall'],
      { hover: { title: 'Торговый ряд', subtitle: DISTRICT_NAMES.market, lines: ['Здесь стоят торговцы города'] } });
    put(`market_crate_${stall}`, 'cargo_stack', plot.tx + 1, plot.tz + 1, 0, ['city-market']);
    anchors.market.traders.push({ tx: plot.tx, tz: plot.tz + 1 });
    stall += 1;
  }

  // Мастерские: ремесленный дом на каждом из ближних участков, станки внутри.
  const workshopGrid = byDistance(quarterPlots(quarterOf('workshop')));
  anchors.workshop = { rect: [workshopGrid[0].tx, workshopGrid[0].tz, workshopGrid[8].tx, workshopGrid[8].tz],
                       repair: { tx: 0, tz: 0 }, benches: [], houses: [] };
  for (let index = 0; index < workshopGrid.length; index += 1) {
    const craft = index < 4;
    const plot = markPlot(workshopGrid[index], 'workshop', craft);
    if (!craft) continue;
    const doorSide = Math.abs(plot.tx - CENTRE) > Math.abs(plot.tz - CENTRE)
      ? (plot.tx > CENTRE ? 'west' : 'east')
      : (plot.tz > CENTRE ? 'north' : 'south');
    const house = building(`workshop_house_${index}`, plotRect(plot), doorSide,
      ['city-building', 'city-workshop', 'craft-house'],
      { title: 'Мастерская', subtitle: DISTRICT_NAMES.workshop,
        lines: ['Внутри стоят станки квартала', 'Заказ у чужого станка — со сбором'] });
    anchors.workshop.houses.push({ tx: house.centre.tx, tz: house.centre.tz, door: house.door, rect: plotRect(plot) });
    for (const dx of [-1, 1]) anchors.workshop.benches.push({ tx: house.centre.tx + dx, tz: house.centre.tz });
  }
  // Ремонтник стоит у двери первой мастерской, а не внутри: к нему идут с улицы,
  // и загонять его за стену — значит прятать сервис от игрока.
  const firstHouse = anchors.workshop.houses[0];
  anchors.workshop.repair = {
    tx: firstHouse.door.tx + (firstHouse.door.tx < firstHouse.tx ? -2 : firstHouse.door.tx > firstHouse.tx ? 2 : 0),
    tz: firstHouse.door.tz + (firstHouse.door.tz < firstHouse.tz ? -2 : firstHouse.door.tz > firstHouse.tz ? 2 : 0)
  };

  // Жильё: лачуга на ближних участках, дальние свободны.
  const homeGrid = byDistance(quarterPlots(quarterOf('homes')));
  anchors.homes = [];
  for (let index = 0; index < homeGrid.length; index += 1) {
    const lived = index < 4;
    const plot = markPlot(homeGrid[index], 'homes', lived);
    if (!lived) continue;
    put(`home_${index}`, 'wasteland_shack', plot.tx, plot.tz, index % 2 ? 90 : 0, ['city-home'],
      { hover: { title: 'Жилой дом', subtitle: DISTRICT_NAMES.homes, lines: ['Здесь живут горожане'] } });
    anchors.homes.push({ tx: plot.tx, tz: plot.tz + 2 });
  }
  put('homes_fire', 'campfire_rest', anchors.homes[0].tx + 3, anchors.homes[0].tz, 0, ['city-home', 'rest']);

  // --- площадь: ориентир, доска работ, диспетчер, лазарет ------------------------------------
  const landmark = plan.mode === 'peaceful' && plan.region === 'northern_sluices' ? 'water_tank' : 'relay_antenna';
  put('plaza_landmark', landmark, CENTRE, CENTRE - 4, 0, ['city-plaza', 'landmark']);
  anchors.plaza = { tx: CENTRE, tz: CENTRE };
  anchors.board = { tx: CENTRE - 5, tz: CENTRE + 5 };
  anchors.dispatcher = { tx: CENTRE + 6, tz: CENTRE - 2 };
  anchors.medic = { tx: CENTRE - 6, tz: CENTRE - 2 };
  // Доска работ — настоящая доска: у неё игрок берёт вылазки.
  put('plaza_board', 'job_board', anchors.board.tx, anchors.board.tz - 1, 0, ['city-plaza', 'board'],
    { hover: { title: 'Доска работ', subtitle: 'Площадь',
               lines: ['Вылазки и подряды города', 'Быстрый подбор — у самой доски'] } });
  put('plaza_well', 'water_tank', CENTRE + 5, CENTRE + 3, 0, ['city-plaza']);
  put('plaza_medic_post', 'cot_bed', anchors.medic.tx, anchors.medic.tz - 2, 0, ['city-plaza', 'medic'],
    { hover: { title: 'Лазарет', subtitle: 'Площадь', lines: ['Медик лечит раны за марки'] } });
  put('plaza_dispatch_post', 'trader_awning', anchors.dispatcher.tx, anchors.dispatcher.tz - 2, 0, ['city-plaza', 'dispatcher'],
    { hover: { title: 'Диспетчер переноса', subtitle: 'Площадь', lines: ['Платный перенос в другую столицу'] } });

  // Дороги: кольцо вокруг площади и улицы от него к каждым воротам. Плита
  // набора — 4 × 4 м; берём её вдвое крупнее (масштаб по всем осям, иначе
  // повёрнутое полотно растягивает только вдоль одной) и кладём встык.
  const ROAD = { scale: [2, 2, 2] };
  let slab = 0;
  for (const gate of plan.gates) {
    const dir = DIRECTIONS[gate.dir];
    // Улица идёт от кольца к воротам: площадь остаётся площадью, а не перекрёстком.
    for (let step = RING_RADIUS; step <= WALL_HALF; step += 4) {
      const tx = CENTRE + dir.dx * step;
      const tz = CENTRE + dir.dz * step;
      put(`street_${slab++}`, 'road_tile', tx, tz, 0, ['city-street', gate.dir], ROAD);
    }
  }
  for (let along = -RING_RADIUS; along <= RING_RADIUS; along += 4) {
    for (const fixed of [-RING_RADIUS, RING_RADIUS]) {
      put(`ring_${slab++}`, 'road_tile', CENTRE + along, CENTRE + fixed, 0, ['city-street', 'ring'], ROAD);
      put(`ring_${slab++}`, 'road_tile', CENTRE + fixed, CENTRE + along, 0, ['city-street', 'ring'], ROAD);
    }
  }

  // --- за стеной: поле, редкие кусты и сухие деревья -----------------------------------------
  let wildIndex = 0;
  for (let i = 0; i < 120; i += 1) {
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
  // В банке место даёт роль: аукционер садится к стойке, хранилище встаёт на
  // своё место у стены. Иначе их развело бы по порядку строк в авторском файле.
  const bankSeat = object => {
    if (String(object?.entity?.service || '') === 'auction') return anchors.bank.auction;
    if (String(object?.interactive?.role || '') === 'storage' || String(object?.interactive?.kind || '') === 'container') {
      return anchors.bank.storage;
    }
    return null;
  };
  const slots = {
    workshop: anchors.workshop.benches.map(bench => ({ tx: bench.tx, tz: bench.tz })),
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
    storage_locker: 'storage_chest', supply_crate: 'cargo_stack', notice_board: 'job_board'
  });
  const DISTRICT_KIT = Object.freeze({ bank: 'cargo_stack', workshop: 'workshop_bench', plaza: 'highway_sign', market: 'storage_lean_to' });
  const kitKeyFor = (object, district) => {
    const direct = String(object.model || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    return kit[direct] ? direct : (KIT_BY_MODEL[direct] || DISTRICT_KIT[district] || 'cargo_stack');
  };

  /** Подсказка при наведении: что это за вещь и что с ней делают в городе. */
  const carriedHover = (object, district) => {
    const kind = String(object?.interactive?.kind || '');
    const role = String(object?.interactive?.role || '');
    const title = String(object?.name || '').trim() || 'Городская вещь';
    if (kind === 'craftingStation') {
      // Ключ станка нужен клиенту: по нему он находит участок и показывает арендатора.
      const stations = Array.isArray(object?.interactive?.craftingStations) ? object.interactive.craftingStations : [];
      return { title, subtitle: DISTRICT_NAMES.workshop, station: String(stations[0] || ''),
               lines: ['Станок мастерских', 'Участок сдаётся в аренду: у своего — без сбора'] };
    }
    if (role === 'storage' || kind === 'container') {
      return { title, subtitle: DISTRICT_NAMES.bank, lines: ['Хранилище игрока', 'Вещи лежат и после выхода из игры'] };
    }
    if (kind === 'questObject') return { title, subtitle: 'Задание', lines: ['Точка задания'] };
    return { title, subtitle: DISTRICT_NAMES[district] || '', lines: [] };
  };

  const used = { workshop: 0, bank: 0, plaza: 0, market: 0 };
  const carried = plan.carry.objects.map(object => {
    const district = districtOf(object);
    const seat = district === 'bank' ? bankSeat(object) : null;
    const list = seat ? [seat] : (slots[district].length ? slots[district] : plazaRing);
    const index = seat ? 0 : used[district]++;
    const spot = list[index % list.length];
    const shift = seat ? 0 : Math.floor(index / list.length) * 3;
    const tile = { tx: clamp(spot.tx + shift, 4, TILES - 5), tz: clamp(spot.tz, 4, TILES - 5) };
    // Живые сущности (NPC) присылает сервер: префаб им не нужен и вреден — клиент
    // поставил бы рядом с торговцем его двойника из набора.
    const live = String(object?.entity?.kind || '') === 'npc';
    return {
      ...object,
      ...(live ? {} : { prefab: kitKeyFor(object, district), hover: carriedHover(object, district) }),
      position: { x: round2(tileCentre(tile.tx)), y: Number(object?.position?.y) || 0, z: round2(tileCentre(tile.tz)) },
      tags: [...new Set([...(object.tags || []), 'city-authored', `city-${district}`])]
    };
  });
  // Ящиков с лутом в городе нет: город — место торговли и ремонта, а не поля с добычей.
  const containers = [];
  // Аномалии остаются там, где их поставил автор: их же координаты держит лор
  // (`data/kromka/locations.json`), по которому сервер рождает артефакты.
  // Квестовые вещи и точки взаимодействия помечаем столбом с указателем: игрок
  // должен видеть, куда идти, а не искать нужный ящик среди похожих.
  let markIndex = 0;
  for (const object of carried) {
    const kind = String(object?.interactive?.kind || '');
    if (kind !== 'questObject' && kind !== 'craftingStation' && String(object?.interactive?.role || '') !== 'storage') continue;
    // Указатель ставим со стороны площади: с этой стороны к вещи и подходят, а у
    // стены он мешал бы и самой вещи, и стене.
    const tile = { tx: metresToTile(object.position.x), tz: metresToTile(object.position.z) };
    const towards = (value) => (value < CENTRE ? 1 : -1);
    put(`interaction_mark_${markIndex++}`, 'highway_sign',
      tile.tx + towards(tile.tx), tile.tz + towards(tile.tz), 45,
      ['city-interaction', kind === 'questObject' ? 'quest' : 'service']);
  }

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
    // `cityWall` в метрах: за стеной клиент сыплет мелкий покров пустоши, внутри —
    // нет, там улицы и дворы, а не бурьян.
    zone: {
      col: plan.col, row: plan.row, n: plan.n, region: plan.region, mode: plan.mode, city: plan.cityId,
      cityWall: { minX: round2(tileCentre(wall.min)), minZ: round2(tileCentre(wall.min)),
                  maxX: round2(tileCentre(wall.max)), maxZ: round2(tileCentre(wall.max)) }
    },
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
