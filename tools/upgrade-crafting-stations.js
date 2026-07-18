const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const locationsDir = path.join(root, 'data', 'locations');

const STATIONS = Object.freeze({
  ammo_bench: { name: 'Патронный станок', model: 'craftStationAmmo', file: 'craft_station_ammo.glb' },
  weapon_bench: { name: 'Оружейный верстак', model: 'craftStationWeapon', file: 'craft_station_weapon.glb' },
  tool_bench: { name: 'Инструментальный верстак', model: 'craftStationTools', file: 'craft_station_tools.glb' },
  repair_bench: { name: 'Ремонтный верстак', model: 'craftStationRepair', file: 'craft_station_repair.glb' },
  energy_bench: { name: 'Энергетический стенд', model: 'craftStationEnergy', file: 'craft_station_energy.glb' },
  chem_station: { name: 'Химический стол', model: 'craftStationChem', file: 'craft_station_chem.glb' }
});

const LOCATION_LAYOUTS = Object.freeze({
  klimAmmoWorks: {
    remove: ['klim_workbench_01'], owner: 'old_klim', kind: 'production',
    rows: [
      ['klim_ammo_bench', 'ammo_bench', -7, -6, 0],
      ['klim_weapon_bench', 'weapon_bench', -4, -6, 0],
      ['klim_repair_bench', 'repair_bench', -1, -6, 0]
    ]
  },
  scrapFoundry: {
    remove: ['foundry_workbench_01'], owner: 'scrap_union', kind: 'production',
    rows: [
      ['foundry_weapon_bench', 'weapon_bench', -9, -5, 0],
      ['foundry_ammo_bench', 'ammo_bench', -6, -5, 0],
      ['foundry_repair_bench', 'repair_bench', -3, -5, 0],
      ['foundry_tool_bench', 'tool_bench', 0, -5, 0]
    ]
  },
  relayWorkshop: {
    remove: ['relay_workbench_01'], owner: 'relay_order', kind: 'production',
    rows: [
      ['relay_energy_bench', 'energy_bench', -8, -6, 0],
      ['relay_repair_bench', 'repair_bench', -5, -6, 0],
      ['relay_chem_station', 'chem_station', -2, -6, 0]
    ]
  },
  solarArray: {
    remove: ['solar_workbench_01'], owner: 'relay_order', kind: 'production',
    rows: [
      ['solar_energy_bench', 'energy_bench', -1.7, 7, 0],
      ['solar_repair_bench', 'repair_bench', 1.7, 7, 0]
    ]
  },
  roadOutpost: {
    remove: ['road_outpost_bench'], owner: 'old_klim', kind: 'outpost',
    rows: [
      ['road_outpost_ammo_bench', 'ammo_bench', -4, 17, 0],
      ['road_outpost_repair_bench', 'repair_bench', 0, 17, 0]
    ]
  },
  scrapOutpost: {
    remove: ['scrap_outpost_bench'], owner: 'scrap_union', kind: 'outpost',
    rows: [
      ['scrap_outpost_repair_bench', 'repair_bench', -37, -17, 0],
      ['scrap_outpost_tool_bench', 'tool_bench', -34, -17, 0],
      ['scrap_outpost_ammo_bench', 'ammo_bench', -31, -17, 0]
    ]
  },
  relayOutpost: {
    remove: ['relay_outpost_bench'], owner: 'relay_order', kind: 'outpost',
    rows: [
      ['relay_outpost_energy_bench', 'energy_bench', 3, 7, -0.45],
      ['relay_outpost_repair_bench', 'repair_bench', 6, 7, -0.45],
      ['relay_outpost_chem_station', 'chem_station', 9, 7, -0.45]
    ]
  },
  settlement: {
    removePrefix: 'capital_station_', owner: 'old_klim', kind: 'capital',
    rows: capitalRows('old_klim', [-14, -10, -6], [-8, -4])
  },
  scrapTown: {
    removePrefix: 'capital_station_', owner: 'scrap_union', kind: 'capital',
    rows: capitalRows('scrap_union', [-14, -10, -6], [-8, -4])
  },
  relayStation: {
    removePrefix: 'capital_station_', owner: 'relay_order', kind: 'capital',
    rows: capitalRows('relay_order', [-15, -11, -7], [-4, 0])
  }
});

function capitalRows(owner, xs, zs) {
  const ids = Object.keys(STATIONS);
  return ids.map((stationId, index) => [
    `capital_station_${owner}_${stationId}`,
    stationId,
    xs[index % 3],
    zs[Math.floor(index / 3)],
    0
  ]);
}

function craftingStationRow(locationId, owner, kind, row) {
  const [id, stationId, x, z, rotationY] = row;
  const def = STATIONS[stationId];
  if (!def) throw new Error(`Unknown crafting station ${stationId}`);
  return {
    id,
    model: def.model,
    name: def.name,
    url: `/assets/models/wasteland/${def.file}`,
    position: { x, y: 0, z },
    rotation: { x: 0, y: rotationY || 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    collision: 'solid',
    tags: ['cover', 'workshop', 'crafting-station', stationId],
    vision: { mode: 'cover' },
    craftingStations: [stationId],
    stationSiteId: locationId,
    worksiteId: locationId,
    stationOwner: owner,
    stationKind: kind,
    interactive: {
      kind: 'craftingStation',
      craftingStations: [stationId],
      stationSiteId: locationId
    },
    entity: {
      kind: 'craftingStation',
      craftingStations: [stationId],
      stationSiteId: locationId
    }
  };
}

for (const [locationId, layout] of Object.entries(LOCATION_LAYOUTS)) {
  const file = path.join(locationsDir, `${locationId}.json`);
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  const objects = Array.isArray(location.objects) ? location.objects : [];
  const remove = new Set([...(layout.remove || []), ...layout.rows.map(row => row[0])]);
  const firstRemovedIndex = objects.findIndex(row => remove.has(String(row?.id || '')));
  const retained = objects.filter(row => {
    const id = String(row?.id || '');
    if (remove.has(id)) return false;
    if (layout.removePrefix && id.startsWith(layout.removePrefix)) return false;
    return true;
  });
  const stationRows = layout.rows.map(row => craftingStationRow(locationId, layout.owner, layout.kind, row));
  const insertAt = firstRemovedIndex >= 0 ? Math.min(firstRemovedIndex, retained.length) : retained.length;
  retained.splice(insertAt, 0, ...stationRows);
  location.objects = retained;
  fs.writeFileSync(file, `${JSON.stringify(location, null, 2)}\n`, 'utf8');
  console.log(`${locationId}: ${stationRows.length} dedicated crafting station(s)`);
}
