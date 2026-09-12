'use strict';

const RETIRED_ENVIRONMENT_MODELS = Object.freeze([
  ['armory_rack', 'armoryRack'],
  ['asphalt_slab', 'asphaltSlab'],
  ['barrel_cluster', 'barrelCluster'],
  ['brahmin_pen', 'brahminPen'],
  ['cactus', 'cactus'],
  ['campfire_rest', 'campfireRest'],
  ['car_wreck', 'carWreck'],
  ['cargo_stack', 'cargoStack'],
  ['concrete_wall', 'concreteWall'],
  ['cot_bed', 'cotBed'],
  ['craft_station_ammo', 'craftStationAmmo'],
  ['craft_station_chem', 'craftStationChem'],
  ['craft_station_energy', 'craftStationEnergy'],
  ['craft_station_repair', 'craftStationRepair'],
  ['craft_station_tools', 'craftStationTools'],
  ['craft_station_weapon', 'craftStationWeapon'],
  ['crate', 'crate'],
  ['dead_tree_a', 'deadTreeA'],
  ['dead_tree_b', 'deadTreeB'],
  ['dead_tree_c', 'deadTreeC'],
  ['deadwood', 'deadwood'],
  ['dry_bush', 'dryBush'],
  ['fence_segment', 'fenceSegment'],
  ['garden_patch', 'gardenPatch'],
  ['highway_sign', 'highwaySign'],
  ['job_board', 'jobBoard'],
  ['latrine_outhouse', 'latrineOuthouse'],
  ['low_ruined_wall', 'lowRuinedWall'],
  ['mod_floor_tile', 'floorTileBlock'],
  ['mod_floor_wood', 'floorWoodBlock'],
  ['mod_roof_metal', 'roofMetalBlock'],
  ['mod_roof_wood', 'roofWoodBlock'],
  ['mod_wall_brick', 'wallBrickBlock'],
  ['mod_wall_metal', 'wallMetalBlock'],
  ['mod_wall_wood', 'wallWoodBlock'],
  ['oil_pump_jack', 'oilPumpJack'],
  ['open_scrap_gate', 'openScrapGate'],
  ['ore_outcrop', 'oreOutcrop'],
  ['perimeter_debris', 'perimeterDebris'],
  ['relay_antenna', 'relayAntenna'],
  ['roadblock_barricade', 'roadblockBarricade'],
  ['rubble_rock', 'rubbleRock'],
  ['ruined_billboard', 'ruinedBillboard'],
  ['rust_barrel_v1', 'rustBarrel'],
  ['scrap_heap', 'scrapHeap'],
  ['scrap_wall_segment', 'scrapWallSegment'],
  ['scrap_watch_tower', 'scrapWatchTower'],
  ['storage_chest', 'storageChest'],
  ['storage_lean_to', 'storageLeanTo'],
  ['tire_stack', 'tireStack'],
  ['trade_machine', 'tradeMachine'],
  ['trader_awning', 'traderAwning'],
  ['trader_floor_slab', 'traderFloorSlab'],
  ['trader_roof_block', 'traderRoofBlock'],
  ['trader_wall_block', 'traderWallBlock'],
  ['trader_window_block', 'traderWindowBlock'],
  ['utility_pole', 'utilityPole'],
  ['wasteland_shack', 'wastelandShack'],
  ['watch_post', 'watchPost'],
  ['water_tank', 'waterTank'],
  ['workshop_bench', 'workshopBench']
]);

const RETIRED_OLD_KLIM_MODEL_KEYS = Object.freeze([
  'old_klim_caravan',
  'old_klim_cliff_corner',
  'old_klim_cliff_end',
  'old_klim_cliff_straight',
  'old_klim_loading_canopy',
  'old_klim_rock_scatter_a',
  'old_klim_rock_scatter_b',
  'old_klim_rock_scatter_c',
  'old_klim_scrub_amber',
  'old_klim_scrub_blue_a',
  'old_klim_scrub_blue_b',
  'old_klim_trade_hall',
  'old_klim_trade_hall_roof'
]);

const RETIRED_ENVIRONMENT_MODEL_KEYS = new Set([
  ...RETIRED_ENVIRONMENT_MODELS.flat(),
  ...RETIRED_OLD_KLIM_MODEL_KEYS
]);

function isRetiredEnvironmentModel(model = '') {
  return RETIRED_ENVIRONMENT_MODEL_KEYS.has(String(model || '').trim());
}

function stripRetiredEnvironmentCollisions(definition = {}) {
  let changed = 0;
  for (const object of Array.isArray(definition.objects) ? definition.objects : []) {
    if (!object || !isRetiredEnvironmentModel(object.model)) continue;
    if (String(object.collision || '').toLowerCase() !== 'none') {
      object.collision = 'none';
      changed += 1;
    }
    for (const field of ['collisionParts', 'collisionSize', 'modelCollision']) {
      if (!Object.prototype.hasOwnProperty.call(object, field)) continue;
      delete object[field];
      changed += 1;
    }
  }
  return changed;
}

module.exports = {
  RETIRED_ENVIRONMENT_MODELS,
  RETIRED_OLD_KLIM_MODEL_KEYS,
  RETIRED_ENVIRONMENT_MODEL_KEYS,
  isRetiredEnvironmentModel,
  stripRetiredEnvironmentCollisions
};
