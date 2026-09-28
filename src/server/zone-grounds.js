'use strict';

// Угодья — биомы Кромки, как в Albion Online (библия, раздел 4.5). Каждая зона
// принадлежит угодьям одного из пяти городов: зона лежит в клине от Ключей в
// сторону этого города. У угодий три семейства ресурсов — основное, второе и
// третье, — двух семейств нет совсем. Узлы зоны растут из семейств угодий в
// долях 50/30/20; шкуры узлами не бывают — их дают звери угодий. Город
// перерабатывает с бонусом семейство, которого в его угодьях нет. Модуль
// чистый: данные — data/kromka/grounds.json, его собирает
// tools/build-zone-grounds.js.

const RANK_SHARES = Object.freeze([0.5, 0.3, 0.2]);
const NODE_FAMILIES = Object.freeze(['ore', 'wood', 'fiber', 'oil']);
const ALL_FAMILIES = Object.freeze(['ore', 'wood', 'fiber', 'oil', 'hide']);

function safeId(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
}

/**
 * Клинья: зона принадлежит угодьям города, чьё направление от центра ближе
 * всего к направлению на зону. Центр (Ключи) угодий не имеет.
 */
function assignGroundsByWedges(zones = [], center = { col: 0, row: 0 }, cities = []) {
  const directions = cities.map(city => ({ id: city.id, angle: Math.atan2(city.row - center.row, city.col - center.col) }));
  const out = {};
  for (const zone of zones) {
    if (zone.col === center.col && zone.row === center.row) continue;
    const angle = Math.atan2(zone.row - center.row, zone.col - center.col);
    let best = null;
    let bestGap = Infinity;
    for (const direction of directions) {
      let gap = Math.abs(angle - direction.angle) % (2 * Math.PI);
      gap = Math.min(gap, 2 * Math.PI - gap);
      if (gap < bestGap) { bestGap = gap; best = direction.id; }
    }
    if (best) out[zone.id] = best;
  }
  return out;
}

function normalizeGrounds(raw = {}) {
  const grounds = {};
  for (const [key, row] of Object.entries(raw.grounds || {})) {
    const id = safeId(key);
    const families = (Array.isArray(row?.families) ? row.families : []).map(safeId).filter(f => ALL_FAMILIES.includes(f));
    if (!id || families.length !== 3 || new Set(families).size !== 3) throw new Error(`Grounds ${key} need three distinct families`);
    const refine = safeId(row.refine);
    if (!ALL_FAMILIES.includes(refine) || families.includes(refine)) throw new Error(`Grounds ${key} must refine a family they lack`);
    grounds[id] = Object.freeze({
      id,
      name: String(row.name || id),
      cityLocationId: safeId(row.cityLocationId),
      families: Object.freeze(families),
      refine
    });
  }
  const zones = {};
  for (const [zoneId, groundsId] of Object.entries(raw.zones || {})) {
    if (grounds[safeId(groundsId)]) zones[safeId(zoneId)] = safeId(groundsId);
  }
  const hotspots = {};
  for (const [zoneId, row] of Object.entries(raw.hotspots || {})) {
    const family = safeId(row?.family);
    if (!ALL_FAMILIES.includes(family)) continue;
    hotspots[safeId(zoneId)] = Object.freeze({ family, name: String(row.name || ''), tier: Math.max(1, Math.min(5, Math.floor(Number(row.tier) || 1))) });
  }
  const byCity = {};
  for (const row of Object.values(grounds)) if (row.cityLocationId) byCity[row.cityLocationId] = row.id;
  return Object.freeze({
    centerLocationId: safeId(raw.centerLocationId),
    grounds: Object.freeze(grounds),
    zones: Object.freeze(zones),
    hotspots: Object.freeze(hotspots),
    byCity: Object.freeze(byCity),
    hotspotFactor: Math.max(1, Number(raw.hotspotFactor) || 2)
  });
}

/** Угодья зоны мира или города; null — у локации угодий нет (Ключи, обучение, личная база). */
function groundsFor(config, { zoneId = '', cityLocationId = '' } = {}) {
  if (cityLocationId && safeId(cityLocationId) === config.centerLocationId) return null;
  const byCity = cityLocationId ? config.byCity[safeId(cityLocationId)] : '';
  const id = byCity || config.zones[safeId(zoneId)] || '';
  return id ? config.grounds[id] : null;
}

/** Доля семейства в узлах угодий: основное 50%, второе 30%, третье 20%, прочие 0. */
function familyShare(ground, family) {
  const rank = ground ? ground.families.indexOf(family) : -1;
  return rank >= 0 ? RANK_SHARES[rank] : 0;
}

/**
 * Сколько узлов каждого семейства держит локация с total узлами. Шкуры узлов
 * не имеют, поэтому их доля делится между семействами-узлами. Жила удваивает
 * узлы своего семейства. Без угодий — поровну, как было.
 */
function nodeTargets(config, ground, total, hotspotFamily = '') {
  const count = Math.max(1, Math.floor(Number(total) || 1));
  const weights = {};
  for (const family of NODE_FAMILIES) weights[family] = ground ? familyShare(ground, family) : 1;
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const exact = NODE_FAMILIES.map(family => ({ family, value: sum > 0 ? count * weights[family] / sum : 0 }));
  const targets = {};
  let given = 0;
  for (const row of exact) { targets[row.family] = Math.floor(row.value); given += targets[row.family]; }
  exact.sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)) || b.value - a.value);
  for (let i = 0; given < count && i < exact.length; i++) {
    if (exact[i].value <= 0) continue;
    targets[exact[i].family] += 1;
    given += 1;
  }
  if (hotspotFamily && targets[hotspotFamily] > 0) targets[hotspotFamily] *= config.hotspotFactor;
  return targets;
}

/**
 * Семейство для узла, которого в угодьях нет: детерминированно по хешу id,
 * с весами долей угодий.
 */
function replacementFamily(ground, hash01) {
  const pool = NODE_FAMILIES.filter(family => familyShare(ground, family) > 0);
  if (!pool.length) return '';
  const total = pool.reduce((sum, family) => sum + familyShare(ground, family), 0);
  let left = Math.max(0, Math.min(0.999999, Number(hash01) || 0)) * total;
  for (const family of pool) {
    left -= familyShare(ground, family);
    if (left < 0) return family;
  }
  return pool[pool.length - 1];
}

/**
 * Вес вида зверя со шкурой в логовах угодий: где шкуры основные — вдвое чаще,
 * вторые — как обычно, третьи — вдвое реже, где шкур нет — не заводится.
 * Жила шкур утраивает вес. Прочие виды (мутанты, налётчики) не меняются.
 */
function beastWeight(config, ground, { hideBeast = false, hotspotFamily = '' } = {}) {
  if (!hideBeast || !ground) return 1;
  const rank = ground.families.indexOf('hide');
  const base = rank === 0 ? 2 : rank === 1 ? 1 : rank === 2 ? 0.5 : 0;
  return hotspotFamily === 'hide' ? base * 3 : base;
}

/** Семейство, которое город перерабатывает с бонусом (его в угодьях города нет). */
function cityRefineFamily(config, cityLocationId = '') {
  const id = config.byCity[safeId(cityLocationId)];
  return id ? config.grounds[id].refine : '';
}

/**
 * Пояса опасности — как на Королевском материке Albion (библия, 4.4). По
 * расстоянию в шагах сетки от Ключей (D), от ближайшего города (d) и от края
 * мира (E) и по углу от Ключей до ближайшего направления на город зона
 * получает «опасность»: ближе к центру и дальше от направлений на города —
 * опаснее. Самые опасные quotas.red зон красные, следующие quotas.yellow —
 * жёлтые, остальные синие; соседи Ключей всегда красные; синяя зона у красной
 * становится жёлтой, красная у города — жёлтой. Тир: синие у края и деревни —
 * 1, прочие синие — 2, жёлтые — 3, красные — 4, красные в двух шагах от Ключей — 5.
 * Возвращает {zoneId: {mode, tier}}; город и Ключи — мирные, тир 1.
 */
function computeBelts({ zones = [], center, cities = [], villages = [], quotas = { red: 46, yellow: 66 } }) {
  const key = (col, row) => `${col},${row}`;
  const byCell = new Map(zones.map(zone => [key(zone.col, zone.row), zone]));
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const bfs = starts => {
    const dist = new Map();
    let queue = starts.map(([col, row]) => key(col, row)).filter(cell => byCell.has(cell));
    for (const cell of queue) dist.set(cell, 0);
    while (queue.length) {
      const next = [];
      for (const cell of queue) {
        const [col, row] = cell.split(',').map(Number);
        for (const [dc, dr] of N4) {
          const other = key(col + dc, row + dr);
          if (!byCell.has(other) || dist.has(other)) continue;
          dist.set(other, dist.get(cell) + 1);
          next.push(other);
        }
      }
      queue = next;
    }
    return dist;
  };
  const cityCells = cities.map(city => [city.col, city.row]);
  const dCenter = bfs([[center.col, center.row]]);
  const dCity = bfs(cityCells);
  const edgeCells = zones.filter(zone => N4.some(([dc, dr]) => !byCell.has(key(zone.col + dc, zone.row + dr)))).map(zone => [zone.col, zone.row]);
  const dEdge = bfs(edgeCells);
  const cityAngles = cities.map(city => Math.atan2(city.row - center.row, city.col - center.col));
  const colour = new Map();
  const candidates = [];
  for (const zone of zones) {
    const cell = key(zone.col, zone.row);
    const D = dCenter.get(cell) ?? 99;
    const d = dCity.get(cell) ?? 99;
    const E = dEdge.get(cell) ?? 0;
    if (D === 0) { colour.set(cell, 'M'); continue; }
    if (d === 0) { colour.set(cell, 'C'); continue; }
    const r = D / (D + E);
    const angle = Math.atan2(zone.row - center.row, zone.col - center.col);
    let gap = Math.min(...cityAngles.map(cityAngle => {
      const diff = Math.abs(angle - cityAngle) % (2 * Math.PI);
      return Math.min(diff, 2 * Math.PI - diff);
    }));
    gap = Math.min(1, gap / (Math.PI / 5));
    candidates.push({ cell, danger: (1 - r) + 0.55 * gap * (r > 0.25 ? 1 : 0) - (d === 1 ? 5 : 0) - (d === 2 ? 0.25 : 0) });
  }
  candidates.sort((a, b) => b.danger - a.danger);
  candidates.forEach((row, index) => colour.set(row.cell, index < quotas.red ? 'R' : index < quotas.red + quotas.yellow ? 'Y' : 'B'));
  for (const zone of zones) {
    const cell = key(zone.col, zone.row);
    const D = dCenter.get(cell) ?? 99;
    if (D > 0 && D <= 1) colour.set(cell, 'R');
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const zone of zones) {
      const cell = key(zone.col, zone.row);
      if (colour.get(cell) !== 'B') continue;
      if (N4.some(([dc, dr]) => ['R', 'M'].includes(colour.get(key(zone.col + dc, zone.row + dr))))) colour.set(cell, 'Y');
    }
  }
  for (const zone of zones) {
    const cell = key(zone.col, zone.row);
    if (dCity.get(cell) === 1 && colour.get(cell) === 'R') colour.set(cell, 'Y');
  }
  const villageSet = new Set(villages);
  const MODES = { M: 'peaceful', C: 'peaceful', B: 'pve', Y: 'pvp', R: 'pvpFullDrop' };
  const out = {};
  for (const zone of zones) {
    const cell = key(zone.col, zone.row);
    const c = colour.get(cell);
    let tier = c === 'B' ? ((dEdge.get(cell) ?? 0) === 0 ? 1 : 2) : c === 'Y' ? 3 : c === 'R' ? ((dCenter.get(cell) ?? 99) <= 2 ? 5 : 4) : 1;
    if (villageSet.has(zone.id)) tier = 1;
    out[zone.id] = { mode: MODES[c], tier };
  }
  return out;
}

module.exports = {
  computeBelts,
  RANK_SHARES,
  NODE_FAMILIES,
  ALL_FAMILIES,
  assignGroundsByWedges,
  normalizeGrounds,
  groundsFor,
  familyShare,
  nodeTargets,
  replacementFamily,
  beastWeight,
  cityRefineFamily
};
