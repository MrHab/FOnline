'use strict';

// Зоны мира на сервере. Каждая зона графа — обычная локация `z_CC_RR` в общем
// каталоге LOCATIONS: при старте туда кладётся лёгкая заглушка, а полное
// определение собирает конструктор при первом входе (сборка всех 197 зон сразу
// стоила бы секунды на каждом старте и десятки мегабайт памяти). Закреплённая
// зона берётся из data/zones/authored/<id>.json вместо генератора.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SIDES, zoneById, zoneLocationId, zoneOfLocation, zoneRecipe } = require('./zone-graph');
const { loadZoneCatalog } = require('./zone-chunks');
const { TILES, buildZone } = require('./zone-builder');
const { buildCity } = require('./city-builder');

const METRES = TILES * 2;
const SIDE_ENTRY = Object.freeze({ north: 'entryFromNorth', south: 'entryFromSouth', west: 'entryFromWest', east: 'entryFromEast' });
// Город — сектор целиком: приходящий из соседнего сектора встаёт у своей стороны
// города, но за выходной полосой (2 тайла), иначе его тут же вынесет обратно.
const CITY_ENTRY_INSET = 5;

/** Точки входа города по сторонам: север — малые tz, запад — малые tx. */
function cityEntryPoints(bounds = {}) {
  const midX = Math.round((Number(bounds.minX || 0) + Number(bounds.maxX || 0)) / 2);
  const midZ = Math.round((Number(bounds.minZ || 0) + Number(bounds.maxZ || 0)) / 2);
  return {
    entryFromNorth: { tx: midX, tz: Math.min(midZ, Number(bounds.minZ || 0) + CITY_ENTRY_INSET) },
    entryFromSouth: { tx: midX, tz: Math.max(midZ, Number(bounds.maxZ || 0) - CITY_ENTRY_INSET) },
    entryFromWest: { tx: Math.min(midX, Number(bounds.minX || 0) + CITY_ENTRY_INSET), tz: midZ },
    entryFromEast: { tx: Math.max(midX, Number(bounds.maxX || 0) - CITY_ENTRY_INSET), tz: midZ }
  };
}

/**
 * Что в закреплённой зоне разошлось с графом: ворота на каждой открытой стороне
 * ведут к соседу этой стороны, у каждых есть точка входа, у каждого места —
 * портал и выход. Пустой список — зона годится.
 */
function frozenZoneProblems(graph, definition) {
  const zone = zoneById(graph, definition?.id);
  if (!zone) return [`${definition?.id}: not a zone of the graph`];
  const problems = [];
  const gates = (definition.transitions || []).filter(row => row.type === 'zoneGate');
  for (const [side, edge] of Object.entries(zone.edges || {})) {
    const gate = gates.find(row => row.direction === side);
    const target = zoneLocationId(zoneById(graph, edge.to));
    if (edge.open && (!gate || gate.to !== target)) problems.push(`${zone.id}: the ${side} gate must lead to ${target}`);
    if (!edge.open && gate) problems.push(`${zone.id}: the ${side} side is closed in the graph but has a gate`);
    if (edge.open && !definition[SIDE_ENTRY[side]]) problems.push(`${zone.id}: no ${SIDE_ENTRY[side]} for arrivals from the ${side}`);
  }
  for (const place of zone.places || []) {
    if (!definition[`entryFromPlace_${place.locationId}`]) problems.push(`${zone.id}: no exit point from ${place.locationId}`);
    if (!place.hidden && !(definition.transitions || []).some(row => row.to === place.locationId)) problems.push(`${zone.id}: no portal to ${place.locationId}`);
  }
  return problems;
}

function createZoneRuntime({ graph, zonesDir, normalize, validate = () => {}, log = () => {} }) {
  if (!graph || !Array.isArray(graph.zones)) throw new Error('zone runtime needs the zone graph');
  let catalog = null;
  const authoredDir = path.join(zonesDir, 'authored');
  const built = new Set();
  // Города — тоже секторы, но их локации авторские: конструктор их не собирает.
  const ids = new Set(graph.zones.filter(zone => !zone.city).map(zone => zone.id));
  const cityZones = graph.zones.filter(zone => zone.city);

  function stub(zone) {
    return normalize({
      schema: 'realm.location.v1', id: zone.id, name: zone.title, seed: zone.seed,
      kind: 'zone', generated: true, zoneStub: true, runtimeMode: 'generated',
      safe: zone.mode === 'peaceful', pvpMode: zone.mode, noRespawn: true, enemyCap: 0, spawnCount: 0,
      allowGlobalMapExit: false, noGlobalMapEntry: true, macroRegion: zone.region,
      map: { width: METRES, depth: METRES, origin: 'center' },
      spawn: { tx: TILES / 2, tz: TILES / 2 },
      objects: [], transitions: [], containers: [], anomalyFields: [], worldZones: [],
      zone: { col: zone.col, row: zone.row, n: zone.n, region: zone.region, mode: zone.mode, difficulty: zone.difficulty }
    });
  }

  function registerStubs(locations) {
    for (const zone of graph.zones) {
      if (zone.city) continue;
      if (locations[zone.id] && !locations[zone.id].zoneStub) continue;
      locations[zone.id] = stub(zone);
    }
    return ids.size;
  }

  function isZone(id) { return ids.has(String(id || '')); }

  /** Сектор мира: сгенерированная зона или город, занявший сектор целиком. */
  function isSector(id) { return isZone(id) || !!cityOf(id); }

  function cityOf(id) { return cityZones.find(zone => zone.city === String(id || '')) || null; }

  /** Города-секторы: `[{ locationId, zone }]`. */
  function cities() { return cityZones.map(zone => ({ locationId: zone.city, zone })); }

  /**
   * Рецепт города: ворота открытых сторон и авторское содержимое, которое город
   * обязан сохранить — станки, хранилище, квестовые объекты, тайники и аномалии.
   */
  function cityRecipe(locationId, authored = {}) {
    const zone = cityOf(locationId);
    if (!zone) return null;
    const objects = (Array.isArray(authored.objects) ? authored.objects : [])
      // Переносим всё, за что цепляется игра: станки, хранилище, квестовые вещи и
      // авторских NPC-служб (аукционер, медик, ремонтник, торговцы).
      .filter(object => object && (object.interactive || object.entity?.kind === 'npc' || (object.tags || []).includes('quest')));
    return {
      cityId: locationId,
      name: String(authored.name || zone.name || locationId),
      seed: zone.seed,
      region: zone.region,
      groundPreset: String(authored.ground?.preset || zone.ground || zone.region),
      mode: zone.mode,
      faction: String(authored.factionId || authored.capitalFaction || ''),
      n: zone.n, col: zone.col, row: zone.row,
      gates: Object.entries(zone.edges).filter(([, edge]) => edge.open).map(([dir, edge]) => {
        const other = zoneById(graph, edge.to);
        return { dir, to: zoneLocationId(other), toTitle: other.title, toMode: other.mode, road: !!edge.road };
      }),
      carry: {
        objects,
        containers: Array.isArray(authored.containers) ? authored.containers : [],
        anomalyFields: Array.isArray(authored.anomalyFields) ? authored.anomalyFields : []
      }
    };
  }

  /**
   * Город целиком: конструктор ставит стену с воротами, улицы, площадь и кварталы,
   * а авторские поля локации (имя, правила, профиль, фракция) остаются прежними.
   * Ссылку на старую сцену Unity город не наследует: его собирают на лету.
   */
  function cityDefinition(locationId, authored = {}) {
    const zone = cityOf(locationId);
    if (!zone) return null;
    if (!catalog) catalog = loadZoneCatalog(zonesDir);
    const built = buildCity(cityRecipe(locationId, authored), catalog.kit);
    const keep = {};
    for (const key of ['safe', 'settlement', 'respawnAllowed', 'respawn', 'visualProfile', 'kromkaVisualProfile',
      'ambientProfile', 'anomalyDensity', 'territoryId', 'territoryRole', 'factionId', 'migrationArrival',
      'migrationSpawnId', 'worldRevision']) {
      if (authored[key] !== undefined) keep[key] = authored[key];
    }
    return { ...built, ...keep, id: locationId, name: built.name, pvpMode: built.pvpMode, cityZone: true };
  }

  /** Ворота города: сторона, сосед (его локация) и точка входа в нём. */
  function cityGates(locationId) {
    const zone = cityOf(locationId);
    if (!zone) return [];
    return Object.entries(zone.edges)
      .filter(([, edge]) => edge.open)
      .map(([side, edge]) => {
        const other = zoneById(graph, edge.to);
        const to = zoneLocationId(other);
        // `id` и `n` — чтобы клиент читал ворота города той же моделью, что и выход места.
        return {
          side, id: to, to, n: other.n, title: other.title, mode: other.mode,
          entryKey: SIDE_ENTRY[SIDES[side].opposite], road: !!edge.road
        };
      });
  }

  function definitionFor(id) {
    const authoredFile = path.join(authoredDir, `${id}.json`);
    if (fs.existsSync(authoredFile)) {
      const authored = JSON.parse(fs.readFileSync(authoredFile, 'utf8'));
      if (authored.id !== id) throw new Error(`zone ${id}: authored file carries id ${authored.id}`);
      const problems = frozenZoneProblems(graph, authored);
      if (problems.length) throw new Error(`frozen zone ${id} no longer fits the graph: ${problems.join('; ')}`);
      // Ревизия закреплённой зоны — от её содержимого: правка файла меняет её для клиентов.
      const { revision, ...content } = authored;
      const hash = crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 8);
      return { ...content, generated: true, frozen: true, revision: `f-${hash}` };
    }
    if (!catalog) catalog = loadZoneCatalog(zonesDir);
    return buildZone(zoneRecipe(graph, id), catalog);
  }

  /** Полное определение зоны в каталоге: строит его при первом обращении. Не зона — ничего не делает. */
  function ensure(locations, id) {
    const key = String(id || '');
    if (!ids.has(key)) return locations[key] || null;
    if (locations[key] && !locations[key].zoneStub) return locations[key];
    const startedAt = Date.now();
    const definition = normalize(definitionFor(key));
    validate(definition);
    locations[key] = definition;
    built.add(key);
    log(`zone ${key} built in ${Date.now() - startedAt} ms (${definition.objects.length} objects)`);
    return definition;
  }

  /** Что знает о секторе клиент: номер, название, цвет и куда ведут ворота. Город — тоже сектор. */
  function view(locationId) {
    const zone = zoneOfLocation(graph, locationId);
    if (!zone) return null;
    return {
      id: zoneLocationId(zone), n: zone.n, title: zone.title, name: zone.name, mode: zone.mode, difficulty: zone.difficulty,
      col: zone.col, row: zone.row, cols: graph.grid.cols, rows: graph.grid.rows,
      ...(zone.city ? { city: zone.city } : {}),
      gates: Object.entries(zone.edges).filter(([, edge]) => edge.open).map(([dir, edge]) => {
        const other = zoneById(graph, edge.to);
        return { dir, to: zoneLocationId(other), n: other.n, title: other.title, mode: other.mode, road: !!edge.road };
      }),
      places: zone.places.filter(place => !place.hidden).map(place => ({ locationId: place.locationId, name: place.name }))
    };
  }

  /**
   * Обзорная карта мира: сетка зон с цветами, номерами и открытыми воротами,
   * места зон (скрытые базы — нет) и столицы. Своё положение игрок берёт из self.zone.
   * nameOf(locationId) — имя места, как его видит игрок.
   */
  function worldMap(nameOf = () => '') {
    return {
      schema: 'kromka.worldMap.v1',
      worldRevision: graph.worldRevision,
      cols: graph.grid.cols,
      rows: graph.grid.rows,
      zoneKm: graph.grid.zoneKm,
      capitals: [...(graph.capitals || [])],
      zones: graph.zones.map(zone => ({
        id: zoneLocationId(zone), n: zone.n, col: zone.col, row: zone.row, title: zone.title, region: zone.region, mode: zone.mode,
        ...(zone.city ? { city: zone.city } : {}),
        // Открытые стороны: n, e, s, w.
        gates: ['north', 'east', 'south', 'west'].filter(side => zone.edges[side]?.open).map(side => side[0]).join(''),
        places: zone.places.filter(place => !place.hidden).map(place => ({
          id: place.locationId, name: nameOf(place.locationId) || place.name, kind: place.kind,
          u: Number(Number(place.u).toFixed(3)), v: Number(Number(place.v).toFixed(3))
        }))
      }))
    };
  }

  const parentByPlace = new Map();
  for (const zone of graph.zones) for (const place of zone.places) parentByPlace.set(place.locationId, zone.id);

  /** Зона, в которую выводит край места (поселения, логова, базы); не место зон — ''. */
  function parentZoneOf(locationId) { return parentByPlace.get(String(locationId || '')) || ''; }

  /** Что клиент знает о выходе из места: куда ведёт край и с какой точки входа он окажется в зоне. */
  function parentZoneView(locationId) {
    const zone = zoneById(graph, parentZoneOf(locationId));
    if (!zone) return null;
    return {
      id: zone.id, n: zone.n, title: zone.title, mode: zone.mode,
      entryKey: `entryFromPlace_${locationId}`.slice(0, 32)
    };
  }

  return {
    graph, registerStubs, isZone, isSector, ensure, view, worldMap,
    cities, cityOf, cityGates, cityRecipe, cityDefinition,
    parentZoneOf, parentZoneView, builtCount: () => built.size
  };
}

module.exports = { CITY_ENTRY_INSET, SIDE_ENTRY, cityEntryPoints, createZoneRuntime, frozenZoneProblems };
