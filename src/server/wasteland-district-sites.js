'use strict';

const {
  normalizeGlobalInfrastructure,
  pointToInfrastructureDistance
} = require('./global-infrastructure');
const {
  FACTION_CAPITAL_SITE_IDS,
  FACTION_CAPITAL_SITES,
  factionGroup
} = require('./wasteland-factions');
const {
  globalMapCellCenter,
  mapNode
} = require('./wasteland-map-geometry');
const { worldSiteLocationId } = require('./wasteland-site-instances');
const { emptyStockpile } = require('./wasteland-stockpile');
const { clamp, safeId, seededRandom } = require('./wasteland-sim-utils');

const DISTRICT_INTEREST_SECTOR_CELLS = 3;
const DISTRICT_INTEREST_REFRESH_HOURS = 72;
const DISTRICT_INTEREST_WATER_MARGIN_POINTS = 18;
const CAPITAL_CLEAR_RADIUS_POINTS = 100;
const NEAR_CAPITAL_SITE_LAYOUT_VERSION = 1;
const ROAD_LOCATION_CLEARANCE_POINTS = 20;
const ROAD_SITE_LAYOUT_VERSION = 1;
const ROAD_OUTPOST_SITE_IDS = new Set(['roadOutpost', 'scrapOutpost', 'relayOutpost']);
const DISTRICT_INTEREST_COASTLINE = [
  { x: 0.105, y: 0.00 }, { x: 0.070, y: 0.08 }, { x: 0.082, y: 0.16 }, { x: 0.055, y: 0.25 },
  { x: 0.106, y: 0.36 }, { x: 0.090, y: 0.48 }, { x: 0.142, y: 0.62 }, { x: 0.126, y: 0.73 },
  { x: 0.184, y: 0.86 }, { x: 0.154, y: 1.00 }
];

function districtInterestCycleFor(sx = 0, sy = 0, worldHour = 0) {
  const rng = seededRandom(`district-interest-offset:${sx}:${sy}`);
  const offset = Math.floor(rng() * DISTRICT_INTEREST_REFRESH_HOURS);
  return Math.max(0, Math.floor((Number(worldHour || 0) + offset) / DISTRICT_INTEREST_REFRESH_HOURS));
}

function districtInterestMapSize(globalMap = {}) {
  const grid = globalMap.grid || {};
  const cols = Math.max(1, Math.round(Number(grid.cols || 30)));
  const rows = Math.max(1, Math.round(Number(grid.rows || 30)));
  const cellPoints = Math.max(1, Math.round(Number(grid.cellPoints || 30)));
  return { cols, rows, cellPoints, width: cols * cellPoints, height: rows * cellPoints };
}

function districtInterestCellIsOcean(cell = {}) {
  const terrain = String(cell.terrain || '').toLowerCase();
  const texture = String(cell.texture || '').toLowerCase();
  return terrain === 'океан' || terrain === 'ocean' || texture === 'water' || texture === 'ocean' || texture === 'sea' || cell.water === true;
}

function districtInterestCoastNormXAtY(ny = 0) {
  const y = clamp(ny, 0, 1);
  const points = DISTRICT_INTEREST_COASTLINE;
  if (y <= points[0].y) return points[0].x;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (y <= b.y) {
      const t = (y - a.y) / Math.max(0.0001, b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return points[points.length - 1].x;
}

function districtInterestPointIsWater(globalMap = {}, x = 0, y = 0, marginPoints = 0) {
  const size = districtInterestMapSize(globalMap);
  const px = clamp(x, 0, Math.max(0, size.width - 0.001));
  const py = clamp(y, 0, Math.max(0, size.height - 0.001));
  const nx = px / Math.max(1, size.width);
  const ny = py / Math.max(1, size.height);
  if (nx <= districtInterestCoastNormXAtY(ny) + Math.max(0, Number(marginPoints || 0)) / Math.max(1, size.width)) return true;
  const cx = clamp(Math.floor(px / size.cellPoints), 0, size.cols - 1);
  const cy = clamp(Math.floor(py / size.cellPoints), 0, size.rows - 1);
  const cell = (globalMap.cells && globalMap.cells[`${cx}:${cy}`]) || {};
  return districtInterestCellIsOcean(cell);
}

function globalMapCapitalPoints(globalMap = {}) {
  const nodes = Array.isArray(globalMap.nodes) ? globalMap.nodes : [];
  const capitalRows = nodes.filter(node => node && (
    node.capital === true ||
    node.capitalFaction ||
    FACTION_CAPITAL_SITE_IDS.has(String(node.id || ''))
  ));
  const rows = capitalRows.length
    ? capitalRows
    : Object.keys(FACTION_CAPITAL_SITES)
      .map(id => mapNode(globalMap, id) || null)
      .filter(Boolean);
  return rows
    .map(row => ({
      id: safeId(row.id || '', ''),
      x: Number(row.x || 0),
      y: Number(row.y || 0)
    }))
    .filter(row => row.id && Number.isFinite(row.x) && Number.isFinite(row.y));
}

function globalMapPointInCapitalClearZone(globalMap = {}, point = {}, radius = CAPITAL_CLEAR_RADIUS_POINTS, exceptId = '') {
  const px = Number(point.x || 0);
  const py = Number(point.y || 0);
  const skipId = safeId(exceptId || '', '');
  return globalMapCapitalPoints(globalMap).some(capital => (
    capital.id !== skipId &&
    Math.hypot(px - capital.x, py - capital.y) <= Math.max(0, Number(radius || CAPITAL_CLEAR_RADIUS_POINTS))
  ));
}

function isRoadOutpostSite(siteOrId = '') {
  const id = typeof siteOrId === 'string' ? siteOrId : siteOrId?.id;
  return ROAD_OUTPOST_SITE_IDS.has(String(id || ''));
}

function globalMapRoadRows(globalMap = {}) {
  return normalizeGlobalInfrastructure(globalMap.infrastructure || [], globalMap)
    .filter(row => row.type === 'road' && row.points.length >= 2);
}

function globalMapRoadClearance(globalMap = {}, point = {}, roads = null, clearance = ROAD_LOCATION_CLEARANCE_POINTS) {
  const roadRows = Array.isArray(roads) ? roads : globalMapRoadRows(globalMap);
  let nearest = null;
  for (const road of roadRows) {
    const distance = pointToInfrastructureDistance(point, road);
    const requiredDistance = Math.max(0, Number(clearance || 0)) + Number(road.width || 0) * 0.5;
    if (!nearest || distance < nearest.distance) {
      nearest = { id: road.id, distance, requiredDistance, width: Number(road.width || 0) };
    }
  }
  return nearest;
}

function globalMapPointInRoadCorridor(globalMap = {}, point = {}, clearance = ROAD_LOCATION_CLEARANCE_POINTS, roads = null) {
  const nearest = globalMapRoadClearance(globalMap, point, roads, clearance);
  return !!nearest && nearest.distance <= nearest.requiredDistance;
}

function nearestRoadClearLandPoint(globalMap = {}, point = {}, exceptId = '') {
  const size = districtInterestMapSize(globalMap);
  const start = globalMapCellCenter(point, globalMap);
  const roads = globalMapRoadRows(globalMap);
  const candidateIsValid = candidate => (
    !districtInterestPointIsWater(globalMap, candidate.x, candidate.y, DISTRICT_INTEREST_WATER_MARGIN_POINTS)
    && !globalMapPointInCapitalClearZone(globalMap, candidate, CAPITAL_CLEAR_RADIUS_POINTS, exceptId)
    && !globalMapPointInRoadCorridor(globalMap, candidate, ROAD_LOCATION_CLEARANCE_POINTS, roads)
  );
  if (candidateIsValid(start)) return start;
  let nearest = null;
  for (let cy = 0; cy < size.rows; cy += 1) {
    for (let cx = 0; cx < size.cols; cx += 1) {
      const candidate = districtInterestCellCenter(globalMap, cx, cy);
      if (!candidateIsValid(candidate)) continue;
      const distance = Math.hypot(candidate.x - start.x, candidate.y - start.y);
      if (!nearest || distance < nearest.distance) nearest = { ...candidate, distance };
    }
  }
  return nearest ? { x: nearest.x, y: nearest.y } : start;
}

function nearestCapitalClearLandPoint(globalMap = {}, point = {}, exceptId = '') {
  const size = districtInterestMapSize(globalMap);
  const start = globalMapCellCenter(point, globalMap);
  if (!districtInterestPointIsWater(globalMap, start.x, start.y, 0) && !globalMapPointInCapitalClearZone(globalMap, start, CAPITAL_CLEAR_RADIUS_POINTS, exceptId)) {
    return start;
  }
  const skipId = safeId(exceptId || '', '');
  const capitals = globalMapCapitalPoints(globalMap).filter(row => row.id !== skipId);
  const nearest = capitals
    .map(row => ({ row, dist: Math.hypot(start.x - row.x, start.y - row.y) }))
    .sort((a, b) => a.dist - b.dist)[0]?.row || null;
  const baseAngle = nearest ? Math.atan2(start.y - nearest.y, start.x - nearest.x) : 0;
  const minDistance = CAPITAL_CLEAR_RADIUS_POINTS + size.cellPoints * 0.75;
  const maxDistance = Math.max(size.width, size.height);
  const angleOffsets = [0, -0.32, 0.32, -0.72, 0.72, -1.15, 1.15, Math.PI];
  for (let distance = minDistance; distance <= maxDistance; distance += size.cellPoints * 0.5) {
    for (const offset of angleOffsets) {
      const angle = baseAngle + offset;
      const candidate = globalMapCellCenter({
        x: (nearest?.x ?? start.x) + Math.cos(angle) * distance,
        y: (nearest?.y ?? start.y) + Math.sin(angle) * distance
      }, globalMap);
      if (districtInterestPointIsWater(globalMap, candidate.x, candidate.y, DISTRICT_INTEREST_WATER_MARGIN_POINTS)) continue;
      if (globalMapPointInCapitalClearZone(globalMap, candidate, CAPITAL_CLEAR_RADIUS_POINTS, exceptId)) continue;
      return candidate;
    }
  }
  return start;
}

function districtInterestCellCenter(globalMap = {}, cx = 0, cy = 0) {
  const size = districtInterestMapSize(globalMap);
  return globalMapCellCenter({
    x: (clamp(cx, 0, size.cols - 1) + 0.5) * size.cellPoints,
    y: (clamp(cy, 0, size.rows - 1) + 0.5) * size.cellPoints
  }, globalMap);
}

function districtInterestPointKey(point = {}) {
  return `${Number(point.x || 0).toFixed(2)}:${Number(point.y || 0).toFixed(2)}`;
}

function nearestDistrictInterestLandCell(globalMap = {}, centerCx = 0, centerCy = 0, occupiedPoints = null) {
  const size = districtInterestMapSize(globalMap);
  const roads = globalMapRoadRows(globalMap);
  let best = null;
  for (let cy = 0; cy < size.rows; cy += 1) {
    for (let cx = 0; cx < size.cols; cx += 1) {
      const cell = (globalMap.cells && globalMap.cells[`${cx}:${cy}`]) || {};
      if (districtInterestCellIsOcean(cell)) continue;
      const point = districtInterestCellCenter(globalMap, cx, cy);
      if (occupiedPoints?.has(districtInterestPointKey(point))) continue;
      if (districtInterestPointIsWater(globalMap, point.x, point.y, DISTRICT_INTEREST_WATER_MARGIN_POINTS)) continue;
      if (globalMapPointInCapitalClearZone(globalMap, point)) continue;
      if (globalMapPointInRoadCorridor(globalMap, point, ROAD_LOCATION_CLEARANCE_POINTS, roads)) continue;
      const dist = Math.hypot(cx - centerCx, cy - centerCy);
      if (!best || dist < best.dist) best = { cx, cy, cell, dist };
    }
  }
  return best;
}

function districtInterestCells(globalMap = {}, sx = 0, sy = 0) {
  const { cols, rows } = districtInterestMapSize(globalMap);
  const startX = sx * DISTRICT_INTEREST_SECTOR_CELLS;
  const startY = sy * DISTRICT_INTEREST_SECTOR_CELLS;
  const centerCx = clamp(startX + 1, 0, cols - 1);
  const centerCy = clamp(startY + 1, 0, rows - 1);
  const cells = [];
  const roads = globalMapRoadRows(globalMap);
  let sectorHasLand = false;
  for (let cy = startY; cy < Math.min(rows, startY + DISTRICT_INTEREST_SECTOR_CELLS); cy += 1) {
    for (let cx = startX; cx < Math.min(cols, startX + DISTRICT_INTEREST_SECTOR_CELLS); cx += 1) {
      const cell = (globalMap.cells && globalMap.cells[`${cx}:${cy}`]) || {};
      if (districtInterestCellIsOcean(cell)) continue;
      sectorHasLand = true;
      const point = districtInterestCellCenter(globalMap, cx, cy);
      if (districtInterestPointIsWater(globalMap, point.x, point.y, DISTRICT_INTEREST_WATER_MARGIN_POINTS)) continue;
      if (globalMapPointInCapitalClearZone(globalMap, point)) continue;
      if (globalMapPointInRoadCorridor(globalMap, point, ROAD_LOCATION_CLEARANCE_POINTS, roads)) continue;
      const dist = Math.hypot(cx - centerCx, cy - centerCy);
      cells.push({ cx, cy, cell, dist });
    }
  }
  if (!cells.length && sectorHasLand) {
    const fallback = nearestDistrictInterestLandCell(globalMap, centerCx, centerCy);
    if (fallback) cells.push(fallback);
  }
  return cells.sort((a, b) => a.dist - b.dist);
}

function districtInterestVariantPool(terrain = '', owner = 'neutral') {
  const text = String(terrain || '').toLowerCase();
  const group = factionGroup(owner || 'neutral');
  const rows = [
    {
      key: 'wrecked_truck',
      weight: 4,
      name: 'Разграбленный грузовик',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: 'neutral',
      stockpile: { scrap: 12, ammoParts: 4, silver: 16 },
      danger: 1.6,
      security: 18,
      note: 'Старый грузовик у дороги. Вокруг еще можно найти лом, детали и следы недавних мародеров.'
    },
    {
      key: 'caravan_camp',
      weight: 3,
      name: 'Караванный привал',
      type: 'pointOfInterest',
      locationId: 'randomAshGrove',
      owner: 'caravans',
      stockpile: { water: 8, medicine: 2, silver: 22 },
      danger: 1.1,
      security: 34,
      note: 'Временный привал вольных караванщиков. Здесь встречаются торговцы, охрана и случайные путники.'
    },
    {
      key: 'old_klim_watch',
      weight: group === 'old_klim' || text.includes('клим') || text.includes('караван') ? 5 : 1,
      name: 'Дозорный костер Старого Клима',
      type: 'pointOfInterest',
      locationId: 'randomAshGrove',
      owner: 'old_klim',
      stockpile: { water: 5, medicine: 1, ammoParts: 3, silver: 12 },
      danger: 1.2,
      security: 38,
      note: 'Малый дозор Старого Клима держит огонь и дорожный знак. Тут можно переждать путь, но место видно издалека.'
    },
    {
      key: 'field_clinic',
      weight: group === 'old_klim' || group === 'caravans' || text.includes('дорог') ? 3 : 1,
      name: 'Полевой перевязочный пункт',
      type: 'pointOfInterest',
      locationId: 'randomAshGrove',
      owner: group === 'old_klim' ? 'old_klim' : 'caravans',
      stockpile: { medicine: 4, water: 4, silver: 10 },
      danger: 1,
      security: 28,
      note: 'Брезентовый пункт первой помощи у старой тропы. Его ставят там, где караваны чаще всего теряют людей.'
    },
    {
      key: 'scrap_cache',
      weight: text.includes('свалоч') || text.includes('дорог') ? 5 : 2,
      name: 'Свалочный тайник',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: group === 'scrap_union' ? 'scrap_union' : 'neutral',
      stockpile: { scrap: 18, ammoParts: 5, silver: 10 },
      danger: 1.8,
      security: 20,
      note: 'Спрятанная куча полезного хлама. За ней могут следить сборщики или мародеры.'
    },
    {
      key: 'prospector_claim',
      weight: group === 'scrap_union' || text.includes('свалоч') || text.includes('низин') ? 4 : 1,
      name: 'Старательская заявка',
      type: 'resource',
      locationId: 'randomDryBasin',
      owner: group === 'scrap_union' ? 'scrap_union' : 'neutral',
      output: { ore: 4, scrap: 2 },
      stockpile: { ore: 12, scrap: 7, silver: 9 },
      danger: 2,
      security: 20,
      workforce: 10,
      note: 'Застолбленная старателями трещина с бедной рудой. Место небольшое, но вокруг него быстро вспыхивают споры.'
    },
    {
      key: 'tech_wreck',
      weight: text.includes('тех') || text.includes('ретранслятор') ? 5 : 2,
      name: 'Разбитый техузел',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: group === 'relay_order' ? 'relay_order' : 'neutral',
      stockpile: { electronics: 6, chemicals: 3, scrap: 8, silver: 12 },
      danger: 2.2,
      security: 22,
      note: 'Обломки старого технического узла. Электроника здесь ценная, но место часто привлекает охотников за деталями.'
    },
    {
      key: 'relay_beacon',
      weight: group === 'relay_order' || text.includes('ретранслятор') || text.includes('тех') ? 6 : 1,
      name: 'Аварийный маяк Ретранслятора',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: 'relay_order',
      stockpile: { electronics: 7, chemicals: 2, silver: 14 },
      danger: 1.8,
      security: 32,
      note: 'Мигающий маяк техников Ретранслятора. Он помогает караванам держать курс, пока батареи и антенны живы.'
    },
    {
      key: 'old_bunker_vent',
      weight: text.includes('тех') || text.includes('централь') || group === 'relay_order' ? 3 : 1,
      name: 'Вентиляция старого убежища',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: 'neutral',
      stockpile: { electronics: 5, chemicals: 3, scrap: 6, silver: 8 },
      danger: 2.7,
      security: 10,
      note: 'Из земли торчит ржавая вентиляция довоенного убежища. Внутрь не пройти, но вокруг много снятых панелей и проводки.'
    },
    {
      key: 'water_pocket',
      weight: text.includes('низин') || text.includes('клим') ? 4 : 1,
      name: 'Мелкий водосбор',
      type: 'resource',
      locationId: 'randomDryBasin',
      owner: group === 'old_klim' ? 'old_klim' : 'neutral',
      output: { water: 6, chemicals: 1 },
      stockpile: { water: 16, chemicals: 3, silver: 8 },
      danger: 1.4,
      security: 24,
      workforce: 12,
      note: 'Небольшой водосбор в низине. Его можно использовать, пока колодец не пересох или его не заняли чужие.'
    },
    {
      key: 'ore_scars',
      weight: text.includes('централь') || text.includes('охотнич') ? 2 : 1,
      name: 'Рваная рудная жила',
      type: 'resource',
      locationId: 'randomDryBasin',
      owner: group === 'mutants' || group === 'wild' ? 'neutral' : group,
      output: { ore: 5, scrap: 2 },
      stockpile: { ore: 14, scrap: 6, silver: 7 },
      danger: 2.5,
      security: 16,
      workforce: 10,
      note: 'Открытая рудная жила среди трещин. Добыча рискованная, но место быстро окупает вылазку.'
    },
    {
      key: 'burned_farmstead',
      weight: text.includes('низин') || text.includes('клим') || group === 'old_klim' ? 3 : 1,
      name: 'Сгоревший хутор',
      type: 'pointOfInterest',
      locationId: 'randomAshGrove',
      owner: 'neutral',
      stockpile: { food: 3, water: 3, scrap: 8, silver: 6 },
      danger: 1.9,
      security: 14,
      note: 'Остатки маленького хутора на краю старых земель Клима. В погребах еще попадаются припасы, если их не забрали раньше.'
    },
    {
      key: 'smuggler_drop',
      weight: group === 'caravans' || text.includes('дорог') || text.includes('рейдер') ? 3 : 1,
      name: 'Контрабандный сброс',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: 'neutral',
      stockpile: { electronics: 3, ammoParts: 6, medicine: 1, silver: 32 },
      danger: 2.8,
      security: 10,
      note: 'Тайный груз у старой дороги. Караванщики не признают его своим, а рейдеры слишком часто знают, где искать.'
    },
    {
      key: 'raider_pickup',
      weight: group === 'raiders' || text.includes('рейдер') ? 6 : 1,
      name: 'Рейдерский схрон',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: 'raiders',
      stockpile: { ammoParts: 8, scrap: 8, medicine: 1, silver: 28 },
      danger: 3.4,
      security: 12,
      note: 'Место, где рейдеры прячут добычу перед перегоном к базе. Рядом почти всегда есть следы засады.'
    },
    {
      key: 'beast_tracks',
      weight: group === 'wild' || text.includes('охотнич') ? 6 : 2,
      name: 'Следы диких тварей',
      type: 'pointOfInterest',
      locationId: 'randomDryBasin',
      owner: 'wild',
      stockpile: { chemicals: 4, medicine: 1, silver: 8 },
      danger: 3.1,
      security: 8,
      note: 'Свежие следы крупной стаи. Здесь можно найти добычу, но шум быстро привлекает хищников.'
    },
    {
      key: 'ghoul_ruins',
      weight: text.includes('дорог') || text.includes('тех') || group === 'wild' ? 3 : 1,
      name: 'Гулкие руины',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: 'wild',
      stockpile: { medicine: 2, chemicals: 4, scrap: 5, silver: 9 },
      danger: 3.2,
      security: 7,
      note: 'Пустые стены звенят от ветра и чужих шагов. Такие руины часто занимают одичавшие и падальщики.'
    },
    {
      key: 'ant_tunnels',
      weight: group === 'wild' || text.includes('охотнич') || text.includes('централь') ? 4 : 1,
      name: 'Муравьиные туннели',
      type: 'pointOfInterest',
      locationId: 'randomDryBasin',
      owner: 'wild',
      stockpile: { chemicals: 5, medicine: 1, scrap: 4, silver: 7 },
      danger: 3.6,
      security: 5,
      note: 'Свежие провалы в сухой земле ведут к туннелям мутировавших муравьев. Надолго здесь не задерживаются.'
    },
    {
      key: 'mutant_marks',
      weight: group === 'mutants' || text.includes('опас') ? 6 : 1,
      name: 'Метки супермутантов',
      type: 'pointOfInterest',
      locationId: 'randomDryBasin',
      owner: 'mutants',
      stockpile: { ammoParts: 4, scrap: 14, chemicals: 2, silver: 12 },
      danger: 4,
      security: 6,
      note: 'Грубые знаки на камнях предупреждают, что сюда заходят супермутанты. Ценное обычно лежит рядом с опасностью.'
    },
    {
      key: 'road_shrine',
      weight: text.includes('дорог') || group === 'caravans' ? 3 : 1,
      name: 'Дорожный памятный знак',
      type: 'pointOfInterest',
      locationId: 'randomRuinedRoad',
      owner: 'neutral',
      stockpile: { medicine: 1, water: 2, silver: 18 },
      danger: 1.3,
      security: 18,
      note: 'Самодельный знак у обочины: имена пропавших караванщиков, жестянки от воды и старые гильзы вместо цветов.'
    }
  ];
  return rows.filter(row => Number(row.weight || 0) > 0);
}

function pickWeightedDistrictInterestVariant(pool = [], rng = Math.random) {
  const total = pool.reduce((sum, row) => sum + Math.max(0, Number(row.weight || 0)), 0);
  if (total <= 0) return pool[0] || null;
  let roll = rng() * total;
  for (const row of pool) {
    roll -= Math.max(0, Number(row.weight || 0));
    if (roll <= 0) return row;
  }
  return pool[pool.length - 1] || null;
}

const DISTRICT_INTEREST_IDENTITY_VERSION = 1;
const DISTRICT_LANDMARK_ADJECTIVES = [
  'Пепельный', 'Ржавый', 'Сухой', 'Забытый', 'Серый', 'Костяной',
  'Горелый', 'Ветреный', 'Мёртвый', 'Дальний', 'Кремнёвый', 'Тихий'
];
const DISTRICT_LANDMARK_NOUNS = [
  'рубеж', 'перевал', 'овраг', 'тракт', 'курган', 'разлом',
  'пустырь', 'кряж', 'предел', 'узел', 'склон', 'проход'
];

function districtInterestTerrainDescription(terrain = '') {
  const text = String(terrain || '').toLowerCase();
  if (text.includes('road') || text.includes('дорог') || text.includes('тракт')) return 'Через район проходит разрушенная дорога.';
  if (text.includes('ash') || text.includes('пеп') || text.includes('forest') || text.includes('лес')) return 'Район покрыт пеплом и редким сухостоем.';
  if (text.includes('basin') || text.includes('dry') || text.includes('низин') || text.includes('пуст')) return 'Местность образует сухую ветреную низину.';
  if (text.includes('hill') || text.includes('rock') || text.includes('кам') || text.includes('скал')) return 'Рельеф изрезан каменными грядами.';
  return 'Рельеф и следы прежней жизни здесь не повторяют соседние районы.';
}

function districtInterestIdentity(variant = {}, sx = 0, sy = 0, sectorCols = 1, terrain = '') {
  const ordinal = Math.max(0, Math.floor(Number(sy || 0))) * Math.max(1, Math.floor(Number(sectorCols || 1)))
    + Math.max(0, Math.floor(Number(sx || 0)));
  const adjective = DISTRICT_LANDMARK_ADJECTIVES[ordinal % DISTRICT_LANDMARK_ADJECTIVES.length];
  const noun = DISTRICT_LANDMARK_NOUNS[Math.floor(ordinal / DISTRICT_LANDMARK_ADJECTIVES.length) % DISTRICT_LANDMARK_NOUNS.length];
  const sectorCode = `${Math.max(0, sx) + 1}-${Math.max(0, sy) + 1}`;
  const repeatedTitlePool = ordinal >= DISTRICT_LANDMARK_ADJECTIVES.length * DISTRICT_LANDMARK_NOUNS.length;
  const landmark = `${adjective} ${noun}${repeatedTitlePool ? ` ${sectorCode}` : ''}`;
  const baseName = String(variant.name || 'Точка интереса').trim();
  const baseNote = String(variant.note || 'Неизученная активность в этом районе пустоши.').trim();
  const name = `${baseName} — ${landmark}`.slice(0, 96);
  const terrainLine = districtInterestTerrainDescription(terrain);
  const description = `${baseNote} Это отдельный участок «${landmark}» в секторе ${sectorCode}. ${terrainLine}`.slice(0, 480);
  return {
    name,
    note: description.slice(0, 240),
    description,
    landmark,
    sectorCode,
    identityVersion: DISTRICT_INTEREST_IDENTITY_VERSION
  };
}

function districtInterestSites(globalMap = {}, worldHour = 0, reservedSites = {}) {
  const grid = globalMap.grid || {};
  const cols = Math.max(1, Math.round(Number(grid.cols || 30)));
  const rows = Math.max(1, Math.round(Number(grid.rows || 30)));
  const sectorCols = Math.ceil(cols / DISTRICT_INTEREST_SECTOR_CELLS);
  const sectorRows = Math.ceil(rows / DISTRICT_INTEREST_SECTOR_CELLS);
  const out = {};
  const occupiedPoints = new Set(Object.values(reservedSites || {})
    .filter(Boolean)
    .map(districtInterestPointKey));
  for (let sy = 0; sy < sectorRows; sy += 1) {
    for (let sx = 0; sx < sectorCols; sx += 1) {
      const cells = districtInterestCells(globalMap, sx, sy);
      let picked = cells.find(cell => !occupiedPoints.has(districtInterestPointKey(districtInterestCellCenter(globalMap, cell.cx, cell.cy))));
      if (!picked && cells.length) picked = nearestDistrictInterestLandCell(globalMap, sx * DISTRICT_INTEREST_SECTOR_CELLS + 1, sy * DISTRICT_INTEREST_SECTOR_CELLS + 1, occupiedPoints);
      if (!picked) continue;
      const cycle = districtInterestCycleFor(sx, sy, worldHour);
      const terrain = String(picked.cell.terrain || '');
      const owner = factionGroup(picked.cell.territoryOwner || 'neutral');
      const rng = seededRandom(`district-interest:${sx}:${sy}:${terrain}:${owner}`);
      const variant = pickWeightedDistrictInterestVariant(districtInterestVariantPool(terrain, owner), rng);
      if (!variant) continue;
      const id = `district_interest_${sx}_${sy}`;
      const identity = districtInterestIdentity(variant, sx, sy, sectorCols, terrain);
      const point = districtInterestCellCenter(globalMap, picked.cx, picked.cy);
      occupiedPoints.add(districtInterestPointKey(point));
      const dangerBase = clamp(Number(picked.cell.difficulty || 1.5) + Number(variant.danger || 0) * 0.45, 0.5, 5);
      const pvpMode = String(picked.cell.pvpMode || variant.pvpMode || '').trim()
        || (dangerBase >= 3.4 || ['raiders', 'mutants', 'wild'].includes(factionGroup(variant.owner || owner)) ? 'pvpFullDrop' : 'pvp');
      out[id] = {
        id,
        type: variant.type || 'pointOfInterest',
        name: identity.name,
        x: point.x,
        y: point.y,
        owner: variant.owner || owner || 'neutral',
        pvpMode,
        locationId: worldSiteLocationId(id),
        templateLocationId: variant.locationId || 'randomRuinedRoad',
        note: identity.note,
        description: identity.description,
        landmark: identity.landmark,
        sectorCode: identity.sectorCode,
        identityVersion: identity.identityVersion,
        output: { ...(variant.output || {}) },
        stockpile: { ...emptyStockpile(), ...(variant.stockpile || {}) },
        danger: dangerBase,
        security: clamp(variant.security ?? (42 - dangerBase * 7), 4, 58),
        prosperity: 0,
        resourceRichness: clamp(variant.resourceRichness ?? (variant.output ? 46 + rng() * 24 : 18 + rng() * 22), 0, 100),
        workforce: clamp(variant.workforce ?? (variant.output ? 8 + rng() * 18 : 0), 0, 40),
        districtInterest: true,
        activityKind: variant.key || 'interest',
        districtKey: `${sx}:${sy}`,
        districtX: sx,
        districtY: sy,
        roadLayoutVersion: ROAD_SITE_LAYOUT_VERSION,
        interestCycle: cycle,
        interestExpiresHour: (cycle + 1) * DISTRICT_INTEREST_REFRESH_HOURS - Math.floor(seededRandom(`district-interest-offset:${sx}:${sy}`)() * DISTRICT_INTEREST_REFRESH_HOURS)
      };
    }
  }
  return out;
}

module.exports = {
  CAPITAL_CLEAR_RADIUS_POINTS,
  NEAR_CAPITAL_SITE_LAYOUT_VERSION,
  ROAD_SITE_LAYOUT_VERSION,
  districtInterestCellCenter,
  districtInterestMapSize,
  districtInterestPointIsWater,
  districtInterestSites,
  globalMapPointInCapitalClearZone,
  globalMapPointInRoadCorridor,
  globalMapRoadClearance,
  globalMapRoadRows,
  isRoadOutpostSite,
  nearestCapitalClearLandPoint,
  nearestRoadClearLandPoint
};
