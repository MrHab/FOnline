'use strict';

// Зоны мира на сервере. Каждая зона графа — обычная локация `z_CC_RR` в общем
// каталоге LOCATIONS: при старте туда кладётся лёгкая заглушка, а полное
// определение собирает конструктор при первом входе (сборка всех 197 зон сразу
// стоила бы секунды на каждом старте и десятки мегабайт памяти). Закреплённая
// зона берётся из data/zones/authored/<id>.json вместо генератора.

const fs = require('node:fs');
const path = require('node:path');
const { zoneById, zoneRecipe } = require('./zone-graph');
const { loadZoneCatalog } = require('./zone-chunks');
const { TILES, buildZone } = require('./zone-builder');

const METRES = TILES * 2;

function createZoneRuntime({ graph, zonesDir, normalize, validate = () => {}, log = () => {} }) {
  if (!graph || !Array.isArray(graph.zones)) throw new Error('zone runtime needs the zone graph');
  let catalog = null;
  const authoredDir = path.join(zonesDir, 'authored');
  const built = new Set();
  const ids = new Set(graph.zones.map(zone => zone.id));

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
      if (locations[zone.id] && !locations[zone.id].zoneStub) continue;
      locations[zone.id] = stub(zone);
    }
    return graph.zones.length;
  }

  function isZone(id) { return ids.has(String(id || '')); }

  function definitionFor(id) {
    const authoredFile = path.join(authoredDir, `${id}.json`);
    if (fs.existsSync(authoredFile)) {
      const authored = JSON.parse(fs.readFileSync(authoredFile, 'utf8'));
      if (authored.id !== id) throw new Error(`zone ${id}: authored file carries id ${authored.id}`);
      return { ...authored, generated: true, frozen: true };
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

  /** Что знает о зоне клиент: номер, название, цвет и куда ведут ворота. */
  function view(locationId) {
    const zone = zoneById(graph, locationId);
    if (!zone) return null;
    return {
      id: zone.id, n: zone.n, title: zone.title, name: zone.name, mode: zone.mode, difficulty: zone.difficulty,
      col: zone.col, row: zone.row, cols: graph.grid.cols, rows: graph.grid.rows,
      gates: Object.entries(zone.edges).filter(([, edge]) => edge.open).map(([dir, edge]) => {
        const other = zoneById(graph, edge.to);
        return { dir, to: edge.to, n: other.n, title: other.title, mode: other.mode, road: !!edge.road };
      }),
      places: zone.places.map(place => ({ locationId: place.locationId, name: place.name }))
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

  return { graph, registerStubs, isZone, ensure, view, parentZoneOf, parentZoneView, builtCount: () => built.size };
}

module.exports = { createZoneRuntime };
