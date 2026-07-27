const fs = require('fs');
const path = require('path');
const { normalizeWorldTask } = require('../src/server/wasteland-world-tasks');

const ROOT = path.resolve(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const paramsOpen = source.indexOf('(', start);
  if (paramsOpen < 0) return '';
  let parenDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') parenDepth++;
    else if (ch === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        paramsClose = i;
        break;
      }
    }
  }
  if (paramsClose < 0) return '';
  const open = source.indexOf('{', paramsClose);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

const errors = [];
const server = readText('server.js');
const wastelandSim = readText('src/server/wasteland-sim.js');
const wastelandPartySpeed = readText('src/server/wasteland-party-speed.js');
const clientInventory = [
  '03_items_inventory_core.js',
  '03a_pipboy_social_world_tasks.js',
  '03b_inventory_actions_ui.js',
  '03c_skills_perks_tooltips.js',
  '03d_item_context_repair_crafting.js'
].map(name => readText(path.join('public', 'js', 'game', name))).join('\n');
const clientNetwork = [
  '05_multiplayer_core_state.js',
  '05a_remote_actor_equipment.js',
  '05b_remote_player_locomotion.js',
  '05c_multiplayer_socket_room.js',
  '05d_world_containers_security.js',
  '05e_ground_items_world_sync.js',
  '05f_enemy_models_location_flow.js'
].map(name => readText(path.join('public', 'js', 'game', name))).join('\n');
const clientTradeStorage = [
  '07_quantity_confirm_carry.js',
  '07a_storage_window.js',
  '07b_trader_market_state.js',
  '07c_trader_dialogues_quests.js',
  '07d_trader_barter_ui.js',
  '07e_loot_interaction.js',
  '07f_quickbar_drag_slots.js'
].map(name => readText(path.join('public', 'js', 'game', name))).join('\n');
const clientWorldObjects = readText(path.join('public', 'js', 'game', '02a_materials_static_models.js'));
const clientWorldBuild = readText(path.join('public', 'js', 'game', '02e_trader_yard_world_build.js'));
const clientQuickInteraction = readText(path.join('public', 'js', 'game', '08b_interaction_quick_access.js'));
const clientWorldContext = readText(path.join('public', 'js', 'game', '08d_world_context_targets.js'));
const clientMobileInteraction = readText(path.join('public', 'js', 'game', '08e_mobile_player_action_menus.js'));
const clientGlobalMap = readText(path.join('public', 'js', 'game', '10_global_map_state_logs_config.js'));
const quests = readJson('data/quests.json');
const locationDir = path.join(ROOT, 'data', 'locations');

function requireText(label, source, needle) {
  if (!source.includes(needle)) errors.push(`${label}: missing guard "${needle}"`);
}

function rejectText(label, source, needle) {
  if (source.includes(needle)) errors.push(`${label}: forbidden economy generator "${needle}"`);
}

requireText('server economy rules', server, 'randomLootTables: false');
requireText('server economy rules', server, 'progressionLootBonus: false');
requireText('server economy rules', server, 'dailyContainerRestock: false');
requireText('server enemy loot', functionBody(server, 'rollEnemyLootServer'), 'if (!ECONOMY_RULES.randomLootTables) return [];');
requireText('server progression loot', functionBody(server, 'addServerProgressionLootBonus'), 'if (!ECONOMY_RULES.progressionLootBonus) return false;');
requireText('server container restock', functionBody(server, 'restockRoomWorldContainersIfNeeded'), 'if (!ECONOMY_RULES.dailyContainerRestock && !force) return false;');
requireText('server inventory limits', server, 'SERVER_ITEM_STACK_LIMITS');
requireText('server save economy sanitizer', functionBody(server, 'safeSaveState'), 'sanitizePersistedEconomyState(state);');
requireText('server inventory sanitizer', functionBody(server, 'sanitizeServerInventorySnapshot'), 'serverItemStackLimit(id)');
const clientEnemyLootBody = functionBody(clientNetwork, 'rollEnemyLoot').trim();
if (clientEnemyLootBody !== 'return [];') {
  errors.push('client enemy loot: the disabled client-side generator must remain an empty stub');
}
requireText('client base storage restock', functionBody(clientTradeStorage, 'restockBaseStorage'), 'return false;');
requireText('npc quest caps', functionBody(clientTradeStorage, 'awardNpcQuest'), 'const paidMoney = payNpcQuestCaps(money);');
const legacyWorldTaskReward = normalizeWorldTask({ id: 'legacy_reward', reward: { silver: 37.9 } }, 0);
if (legacyWorldTaskReward?.reward?.caps !== 37) {
  errors.push('world task rewards: legacy silver reward is not normalized into integer caps');
}
requireText('world task rewards', functionBody(wastelandSim, 'fundWorldTaskCapsRewardFromSite'), 'stock.silver = Math.max(0, available - deducted);');
requireText('world task reward delivery', functionBody(clientNetwork, 'applyServerWorldTransferState'), 'claimWorldTaskReward(data.completedWorldTaskId)');
requireText('client crafting station search', functionBody(clientInventory, 'craftRecipe'), 'const station = nearbyCraftingStation(recipe);');
requireText('client crafting server fee', functionBody(clientInventory, 'craftRecipe'), "multiplayer.socket.emit('craftingStationUsed'");
requireText('client crafting sends inventory snapshot', functionBody(clientInventory, 'craftRecipe'), 'inventory: multiplayerInventorySnapshot()');
requireText('client crafting applies server inventory', functionBody(clientInventory, 'craftRecipe'), 'applyServerInventorySnapshot(ack.inventory)');
requireText('client crafting offline block', functionBody(clientInventory, 'craftRecipe'), 'if (!multiplayer?.socket?.connected)');
requireText('server crafting output table', server, 'const SERVER_CRAFT_RECIPE_OUTPUTS = {');
requireText('server crafting inventory transaction', server, 'function serverInventoryApplyCraftTransaction');
requireText('server crafting uses inventory transaction', functionBody(server, 'recordWastelandCraftingStationFee'), 'serverInventoryApplyCraftTransaction(player.inventory || [], recipeId, fee, actor)');
requireText('server crafting station model guard', functionBody(server, 'serverCraftingObjectMatchesStation'), 'SERVER_CRAFT_STATION_MODELS[key]');
requireText('client crafting station model guard', functionBody(clientInventory, 'craftingObjectMatchesStation'), 'staticModelFileName(modelUrl) === def.modelFile');
requireText('client crafting stations render as static interactives', functionBody(clientWorldObjects, 'locationObjectIsEntity'), "entityKind === 'craftingstation'");
requireText('client crafting station authored registration', functionBody(clientWorldObjects, 'createAuthoredLocationObjects'), 'locationCraftingStations.push(station);');
requireText('client crafting station world reset', functionBody(clientWorldBuild, 'clearWorld'), 'locationCraftingStations.length = 0;');
requireText('client crafting station pointer targeting', functionBody(clientWorldContext, 'buildWorldContextTarget'), 'findCraftingStationFromEvent(clientX, clientY)');
requireText('client crafting station context action', functionBody(clientWorldContext, 'buildWorldContextOptions'), 'openCraftingStationWindow(target.station)');
requireText('client crafting station keyboard interaction', functionBody(clientQuickInteraction, 'performCursorTargetInteraction'), "target.type === 'craftingStation'");
requireText('client crafting station mobile interaction', functionBody(clientMobileInteraction, 'buildMobileWorldContextTarget'), 'findNearbyCraftingStation(CRAFTING_STATION_INTERACT_DISTANCE)');
requireText('client trade machine server market request', functionBody(clientTradeStorage, 'requestTradeMachineMarket'), "emit('tradeMachineMarketState'");
requireText('client trade machine server exchange', functionBody(clientTradeStorage, 'submitServerTradeMachineExchange'), "emit('tradeMachineExchange'");
requireText('server trade machine state handler', server, "socket.on('tradeMachineMarketState'");
requireText('server trade machine exchange handler', server, "socket.on('tradeMachineExchange'");
requireText('server trade machine atomic world transaction', functionBody(server, 'performServerTradeMachineExchange'), 'WASTELAND_SIM.applyTradeMachineTransaction');
requireText('world trade machine stock transaction', functionBody(wastelandSim, 'applyTradeMachineTransaction'), 'site.stockpile = next;');
requireText('world visible production deposit', functionBody(wastelandSim, 'performVisibleSiteWork'), "kind: 'visible_craft'");
requireText('world npc production deposit', functionBody(wastelandSim, 'produceAtSettlements'), "kind: 'npc_craft'");
requireText('world npc ammo production cycles', functionBody(wastelandSim, 'produceAtSettlements'), 'const ammoCycles = Math.min(cycles');
requireText('world npc medicine production cycles', functionBody(wastelandSim, 'produceAtSettlements'), 'const medicineCycles = Math.min(cycles');
requireText('world npc weapon part production cycles', functionBody(wastelandSim, 'produceAtSettlements'), 'const weaponPartCycles = Math.min(cycles');
requireText('world caravan staging wait', wastelandSim, 'const CARAVAN_STAGING_REAL_MINUTES = 10;');
requireText('world caravan regular escort size', wastelandSim, 'const CARAVAN_ESCORT_MIN_PLAYERS = 5;');
requireText('world caravan heavy escort size', wastelandSim, 'const HEAVY_CARAVAN_ESCORT_MIN_PLAYERS = 10;');
requireText('world caravan post battle wait', wastelandSim, 'const CARAVAN_POST_BATTLE_REAL_MINUTES = 2;');
requireText('world caravan closes joins on departure', wastelandSim, 'party.stagingJoinClosed = true;');
requireText('world caravan join guard', functionBody(wastelandSim, 'joinWorldParty'), 'caravanStagingIsOpen(party)');
requireText('world caravan staging exists inside a local scene', functionBody(wastelandSim, 'beginCaravanStagingOnsite'), 'beginPartyOnsiteVisit(party, site');
requireText('world caravan battle recovery', functionBody(wastelandSim, 'completeBattleZone'), 'party.state = \'recovering\';');
requireText('world caravan battle recovery delay', functionBody(wastelandSim, 'completeBattleZone'), 'realMinutesToWorldHours(CARAVAN_POST_BATTLE_REAL_MINUTES)');
requireText('world caravan route recovery hold', functionBody(wastelandSim, 'moveParty'), "String(party.state || '').toLowerCase() === 'recovering'");
requireText('world surplus trade caravan creates physical onsite staging', functionBody(wastelandSim, 'createSurplusTradeCaravan'), 'beginCaravanStagingOnsite(party, source)');
requireText('world caravan minimum speed constant', wastelandPartySpeed, 'const CARAVAN_MIN_SPEED_KMH = 4;');
requireText('world caravan minimum speed normalization', functionBody(wastelandPartySpeed, 'normalizeWorldPartySpeedKmh'), 'worldPartyMinimumSpeedKmh(party, defaults)');
requireText('world caravan minimum movement speed', functionBody(wastelandSim, 'moveParty'), 'effectiveWorldPartySpeedKmh(party)');
requireText('world caravan minimum published speed', functionBody(wastelandSim, 'publicParty'), 'effectiveWorldPartySpeedKmh(party)');
requireText('world resource export threshold', wastelandSim, 'const RESOURCE_EXPORT_THRESHOLD = 42;');
requireText('world resource export creates physical onsite staging', functionBody(wastelandSim, 'createResourceExportCaravan'), 'beginCaravanStagingOnsite(party, source)');
requireText('world resource export removes stockpile cargo', functionBody(wastelandSim, 'createResourceExportCaravan'), 'takeStockpile(source.stockpile');
requireText('world resource export tick', functionBody(wastelandSim, 'tickWorldSimStep'), 'createResourceExportCaravans(hours)');
requireText('world production export threshold', wastelandSim, 'const PRODUCTION_EXPORT_THRESHOLD = 34;');
requireText('world production export creates physical onsite staging', functionBody(wastelandSim, 'createProductionExportCaravan'), 'beginCaravanStagingOnsite(party, source)');
requireText('world production export removes stockpile cargo', functionBody(wastelandSim, 'createProductionExportCaravan'), 'takeStockpile(source.stockpile');
requireText('world production export tick', functionBody(wastelandSim, 'tickWorldSimStep'), 'createProductionExportCaravans(hours)');
requireText('server resource site room identity', functionBody(server, 'getOrCreateRoom'), 'worldSiteIdFromRoomId(id, loc)');
requireText('server resource site output nodes', functionBody(server, 'ensureWastelandSiteResourceNodes'), 'wastelandSiteResourceRows(site)');
requireText('server resource site output nodes', functionBody(server, 'ensureWastelandSiteResourceNodes'), 'siteOutputResource: true');
requireText('server camel-case resource aliases', server, "ammoparts: 'ammoParts'");
requireText('client authoritative resource map', functionBody(clientNetwork, 'applyNetworkWorldState'), 'authoritativeResourceSnapshotLocationId');
requireText('client authoritative resource map', functionBody(clientNetwork, 'applyNetworkWorldState'), 'map[z] = state.map[z].slice(0, MAP_W)');
requireText('client resource template filtering', functionBody(clientWorldObjects, 'authoredResourceObjectIsVisible'), 'authoritativeResourceSnapshotLocationId');
requireText('global map resource labels', functionBody(clientGlobalMap, 'updateGlobalMapCursor'), "['Можно добыть', cursorResourceNames]");

rejectText('client startup inventory', clientInventory, 'inventory.set(id, start)');
rejectText('client startup inventory', clientInventory, 'ammo9: 42');
rejectText('client startup inventory', clientInventory, 'rocketAmmo: 6');
rejectText('npc quest caps', functionBody(clientTradeStorage, 'awardNpcQuest'), "addItem('silver', money");
rejectText('world npc ammo overproduction', functionBody(wastelandSim, 'produceAtSettlements'), '24 * cycles');
rejectText('world artificial time cap', functionBody(wastelandSim, 'tick'), 'cappedHours');
rejectText('client crafting local resource removal', functionBody(clientInventory, 'craftRecipe'), 'Object.entries(recipe.cost).forEach(([id, qty]) => removeItem(id, qty))');
rejectText('client crafting local result creation', functionBody(clientInventory, 'craftRecipe'), 'addCraftedItem(recipe, outQty)');
const traderBaseStockRows = functionBody(clientTradeStorage, 'traderBaseStockRows');
if (!traderBaseStockRows.includes('return [];')) {
  errors.push('client trade: traderBaseStockRows must not fall back to generated stock.');
}

for (const [questId, quest] of Object.entries(quests.quests || {})) {
  const rewardItems = Array.isArray(quest?.reward?.items) ? quest.reward.items : [];
  if (rewardItems.length) errors.push(`quest ${questId}: item rewards must stay empty in the closed economy.`);
}

function defaultSiteRows() {
  const body = functionBody(wastelandSim, 'defaultSites');
  const rows = [];
  const siteRegex = /\n\s{4}([a-zA-Z0-9_]+):\s*{[\s\S]*?\n\s{4}}(?=,\n\s{4}[a-zA-Z0-9_]+:|\n\s{2}};)/g;
  let match;
  while ((match = siteRegex.exec(body))) {
    const id = match[1];
    const block = match[0];
    rows.push({
      id,
      type: ((block.match(/type:\s*'([^']+)'/) || [])[1] || '').toLowerCase(),
      owner: ((block.match(/owner:\s*'([^']+)'/) || [])[1] || '').toLowerCase(),
      locationId: (block.match(/locationId:\s*'([^']+)'/) || [])[1] || '',
      production: /production:\s*{/.test(block),
      output: siteOutputRows(block),
      workerSpawnCount: siteWorkerSpawnCount(block)
    });
  }
  return rows;
}

function siteOutputRows(siteBlock = '') {
  const outputBlock = (siteBlock.match(/output:\s*{([^}]*)}/) || [])[1] || '';
  const output = {};
  const outputRegex = /(?:'([^']+)'|"([^"]+)"|([a-zA-Z0-9_]+))\s*:\s*(-?\d+(?:\.\d+)?)/g;
  let match;
  while ((match = outputRegex.exec(outputBlock))) {
    const resourceId = match[1] || match[2] || match[3] || '';
    if (resourceId) output[resourceId] = Number(match[4]);
  }
  return output;
}

function siteWorkerSpawnCount(siteBlock = '') {
  const workerBlock = (siteBlock.match(/workers:\s*\[([\s\S]*?)\n\s{6}\]/) || [])[1] || '';
  if (!workerBlock) return 0;
  let total = 0;
  const workerRegex = /role:\s*'([^']+)'[\s\S]*?count:\s*(\d+)/g;
  let match;
  while ((match = workerRegex.exec(workerBlock))) {
    const role = String(match[1] || '').toLowerCase();
    const count = Math.max(1, Math.round(Number(match[2] || 1)));
    if (role === 'guard') total += Math.min(3, count);
    else if (role === 'worker') total += Math.min(3, Math.max(1, Math.round(count / 3)));
    else total += 1;
  }
  return total;
}

function locationWarehouseRows(loc = {}) {
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  return objects.filter(row => {
    const tags = (Array.isArray(row.tags) ? row.tags : []).map(tag => String(tag || '').toLowerCase());
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const role = String(interactive.role || row.role || '').toLowerCase();
    const containerType = String(interactive.containerType || row.containerType || '').toLowerCase();
    const model = String(row.model || row.url || '').toLowerCase();
    return model.includes('storagechest')
      || role === 'storage'
      || role === 'factionwarehouse'
      || containerType === 'storage'
      || containerType === 'factionwarehouse'
      || tags.includes('storage')
      || tags.includes('personal-storage')
      || tags.includes('faction-warehouse');
  });
}

function locationHasCraftingStation(loc = {}) {
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  return objects.some(row => !!(row.craftingStation
    || row.stationType
    || row.workstation
    || row.craftingStations
    || row.stationTypes
    || row.workstationTypes
    || row.entity?.craftingStation
    || row.entity?.craftingStations
    || row.entity?.stationTypes
    || row.interactive?.craftingStation
    || row.interactive?.craftingStations
    || row.interactive?.stationTypes));
}

function locationHasTradeMachine(loc = {}, siteId = '') {
  const key = String(siteId || '');
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  return objects.some(row => {
    const tags = (Array.isArray(row.tags) ? row.tags : []).map(tag => String(tag || '').toLowerCase());
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const kind = String(interactive.kind || entity.kind || row.kind || '').toLowerCase();
    const machineSiteId = String(interactive.siteId || interactive.marketSiteId || entity.siteId || row.siteId || '');
    const stock = Array.isArray(interactive.stock) ? interactive.stock : (Array.isArray(entity.stock) ? entity.stock : []);
    const isMachine = kind === 'trademachine' || tags.includes('trademachine') || tags.includes('vendingmachine');
    return isMachine && stock.length > 0 && (!key || machineSiteId === key);
  });
}

function locationHasJobBoard(loc = {}, siteId = '') {
  const key = String(siteId || '');
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  return objects.some(row => {
    const tags = (Array.isArray(row.tags) ? row.tags : []).map(tag => String(tag || '').toLowerCase());
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const kind = String(interactive.kind || entity.kind || row.kind || '').toLowerCase();
    const boardSiteId = String(interactive.boardSiteId || entity.boardSiteId || row.boardSiteId || '');
    const isBoard = tags.includes('jobboard') || tags.includes('questboard') || kind === 'jobboard';
    return isBoard && (!key || boardSiteId === key);
  });
}

function locationModelText(row = {}) {
  return `${row.id || ''} ${row.model || ''} ${row.url || ''} ${row.name || ''}`.toLowerCase();
}

function locationTags(row = {}) {
  return Array.isArray(row.tags) ? row.tags.map(tag => String(tag || '').toLowerCase()) : [];
}

function locationObjectPosition(row = {}) {
  const pos = row.position && typeof row.position === 'object' ? row.position : row;
  return {
    x: Number(pos.x ?? row.x ?? 0),
    z: Number(pos.z ?? row.z ?? 0)
  };
}

function locationSleepRows(loc = {}) {
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  return objects.filter(row => {
    const role = String(row.role || row.entity?.role || row.interactive?.role || '').toLowerCase();
    const tags = locationTags(row);
    const text = locationModelText(row);
    return role === 'bed' || tags.includes('personal-bed') || text.includes('cot_bed') || text.includes('bedroll');
  });
}

function locationAuthoredNpcRows(loc = {}) {
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  return objects.filter(row => {
    const role = String(row.role || row.entity?.role || row.interactive?.role || '').toLowerCase();
    const tags = locationTags(row);
    const model = String(row.model || row.url || '').toLowerCase();
    if (['npc', 'merchant', 'trader', 'guard', 'worker', 'civilian', 'animal', 'monster', 'raider'].includes(role)) return true;
    if (row.entity && typeof row.entity === 'object' && (row.entity.kind === 'npc' || row.entity.type === 'npc')) return true;
    if (tags.some(tag => ['npc', 'merchant', 'trader', 'guard', 'worker', 'civilian', 'animal', 'monster', 'friendly', 'enemy'].includes(tag))) return true;
    return model.includes('/npc_') || model.includes('trader_npc.glb') || model.includes('brahmin.glb');
  });
}

function locationSleepModuleRows(loc = {}, kind = '') {
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  return objects.filter(row => {
    const text = locationModelText(row);
    const tags = locationTags(row);
    const inSleepGroup = tags.includes('sleep-house')
      || tags.includes('sleep-quarters')
      || text.includes('sleep_house')
      || text.includes('sleep_quarters');
    if (!inSleepGroup) return false;
    if (kind === 'floor') return text.includes('mod_floor') || text.includes('trader_floor');
    if (kind === 'wall') return text.includes('mod_wall') || text.includes('trader_wall');
    if (kind === 'roof') return text.includes('mod_roof') || text.includes('trader_roof');
    return false;
  });
}

function sameGridCell(a = {}, b = {}) {
  const pa = locationObjectPosition(a);
  const pb = locationObjectPosition(b);
  return Math.abs(pa.x - pb.x) <= 0.35 && Math.abs(pa.z - pb.z) <= 0.35;
}

function locationSleepShelterProblem(loc = {}) {
  const beds = locationSleepRows(loc);
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  const prefab = objects.find(row => {
    const text = locationModelText(row);
    return text.includes('bunkhouse_shack') || text.includes('bunkhouse') || text.includes('barrack');
  });
  if (prefab) return `sleep prefab is forbidden (${prefab.id || prefab.model || prefab.url || 'unknown object'})`;
  const floors = locationSleepModuleRows(loc, 'floor');
  const walls = locationSleepModuleRows(loc, 'wall');
  const roofs = locationSleepModuleRows(loc, 'roof');
  if (!beds.length && !floors.length && !walls.length && !roofs.length) return '';
  if (!floors.length && !walls.length && !roofs.length) return '';
  if (!floors.length) return 'missing modular sleep floor blocks';
  if (walls.length < 4) return 'missing modular sleep wall blocks';
  if (!roofs.length) return 'missing modular sleep roof blocks';
  const uncovered = beds.find(bed => !floors.some(floor => sameGridCell(bed, floor)) || !roofs.some(roof => sameGridCell(bed, roof)));
  if (uncovered) return `bed ${uncovered.id || uncovered.model || uncovered.url || 'unknown'} is not placed on a modular sleep floor under a modular roof`;
  return '';
}

const defaultSitesList = defaultSiteRows();
const workerSleepersByLocation = new Map();
const hostileOwners = new Set(['raiders', 'mutants', 'wild', 'wildlife', 'ghouls', 'radscorpions', 'mutant_ants', 'geckos', 'super_mutants']);
const harvestableSiteResources = new Set(['ore', 'wood', 'scrap', 'water', 'oil', 'chemicals', 'medicine', 'food', 'electronics', 'ammoParts', 'weaponParts']);

for (const site of defaultSitesList) {
  if (site.type !== 'resource') continue;
  const output = Object.entries(site.output || {}).filter(([, amount]) => Number(amount || 0) > 0);
  if (!output.length) {
    errors.push(`world resource site ${site.id || 'unknown'}: missing positive output resources`);
    continue;
  }
  for (const [resourceId] of output) {
    if (!harvestableSiteResources.has(resourceId)) {
      errors.push(`world resource site ${site.id || 'unknown'}: unsupported harvest resource ${resourceId}`);
    }
  }
}

for (const site of defaultSitesList) {
  if (site.locationId && site.workerSpawnCount > 0 && !hostileOwners.has(site.owner)) {
    workerSleepersByLocation.set(site.locationId, (workerSleepersByLocation.get(site.locationId) || 0) + site.workerSpawnCount);
  }
  const economic = ['resource', 'production', 'outpost', 'pointofinterest'].includes(site.type);
  if (!economic) continue;
  const relPath = path.join('data', 'locations', `${site.locationId}.json`);
  const fullPath = path.join(locationDir, `${site.locationId}.json`);
  if (!site.locationId || !fs.existsSync(fullPath)) {
    errors.push(`world economy site ${site.id}: missing authored location file ${relPath}`);
    continue;
  }
  const loc = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (loc.id !== site.locationId) {
    errors.push(`world economy site ${site.id}: location file id mismatch ${relPath}`);
  }
  if (['resource', 'production', 'outpost'].includes(site.type) && !locationHasJobBoard(loc, site.id)) {
    errors.push(`world economy site ${site.id}: missing authored job board in ${relPath}`);
  }
  if ((site.type === 'production' || site.type === 'outpost' || site.production) && !locationHasCraftingStation(loc)) {
    errors.push(`world economy site ${site.id}: missing authored crafting station in ${relPath}`);
  }
  if (site.type === 'production' && !locationHasTradeMachine(loc, site.id)) {
    errors.push(`world economy site ${site.id}: missing server-backed production trade machine in ${relPath}`);
  }
  const sleepProblem = locationSleepShelterProblem(loc);
  if (sleepProblem) {
    errors.push(`world economy site ${site.id}: invalid modular sleep building in ${relPath}: ${sleepProblem}`);
  }
}

const capitalStorageFactions = {
  settlement: 'old_klim',
  scrapTown: 'scrap_union',
  relayStation: 'relay_order'
};

const craftingStationModels = {
  ammo_bench: { model: 'craftStationAmmo', file: 'craft_station_ammo.glb' },
  weapon_bench: { model: 'craftStationWeapon', file: 'craft_station_weapon.glb' },
  tool_bench: { model: 'craftStationTools', file: 'craft_station_tools.glb' },
  repair_bench: { model: 'craftStationRepair', file: 'craft_station_repair.glb' },
  energy_bench: { model: 'craftStationEnergy', file: 'craft_station_energy.glb' },
  chem_station: { model: 'craftStationChem', file: 'craft_station_chem.glb' }
};

if (new Set(Object.values(craftingStationModels).map(row => row.file)).size !== Object.keys(craftingStationModels).length) {
  errors.push('crafting station model catalog must assign a distinct GLB to every station type');
}
for (const row of Object.values(craftingStationModels)) {
  const modelPath = path.join(ROOT, 'public', 'assets', 'models', 'wasteland', row.file);
  if (!fs.existsSync(modelPath)) errors.push(`crafting station model is missing: ${row.file}`);
}

function dedicatedCraftingStationRows(loc = {}) {
  return (Array.isArray(loc.objects) ? loc.objects : []).filter(row => {
    const kind = String(row?.interactive?.kind || row?.entity?.kind || '').toLowerCase();
    return kind === 'craftingstation' || Array.isArray(row?.craftingStations);
  });
}

for (const file of fs.readdirSync(locationDir).filter(name => name.endsWith('.json'))) {
  const relPath = path.join('data', 'locations', file);
  const loc = JSON.parse(fs.readFileSync(path.join(locationDir, file), 'utf8'));
  const warehouseRows = locationWarehouseRows(loc);
  const stationRows = dedicatedCraftingStationRows(loc);
  stationRows.forEach(row => {
    const ids = [...new Set([
      ...(Array.isArray(row.craftingStations) ? row.craftingStations : []),
      ...(Array.isArray(row.interactive?.craftingStations) ? row.interactive.craftingStations : []),
      ...(Array.isArray(row.entity?.craftingStations) ? row.entity.craftingStations : [])
    ].map(id => String(id || '').toLowerCase()).filter(Boolean))];
    if (ids.length !== 1) {
      errors.push(`location ${loc.id || file}: crafting station ${row.id || 'unknown'} must expose exactly one station type (${relPath})`);
      return;
    }
    const expected = craftingStationModels[ids[0]];
    const actualFile = path.basename(String(row.url || row.file || '')).toLowerCase();
    if (!expected || row.model !== expected.model || actualFile !== expected.file) {
      errors.push(`location ${loc.id || file}: crafting station ${row.id || 'unknown'} has the wrong dedicated model for ${ids[0]} (${relPath})`);
    }
  });
  const capitalStorageFaction = capitalStorageFactions[loc.id] || '';
  if (!capitalStorageFaction && warehouseRows.length) {
    errors.push(`location ${loc.id || file}: storage is only allowed in faction capitals (${relPath})`);
  }
  if (capitalStorageFaction) {
    if (warehouseRows.length !== 1) {
      errors.push(`capital ${loc.id}: expected exactly one storage, found ${warehouseRows.length} (${relPath})`);
    } else if (String(warehouseRows[0].interactive?.storageFaction || '') !== capitalStorageFaction) {
      errors.push(`capital ${loc.id}: storage faction mismatch (${relPath})`);
    }
    const capitalStationIds = new Set(stationRows.flatMap(row => Array.isArray(row.craftingStations) ? row.craftingStations : []));
    const missingStations = Object.keys(craftingStationModels).filter(id => !capitalStationIds.has(id));
    if (stationRows.length !== Object.keys(craftingStationModels).length || missingStations.length) {
      errors.push(`capital ${loc.id}: expected all dedicated crafting stations; missing ${missingStations.join(', ') || 'none'} (${relPath})`);
    }
  }
  const sleepProblem = locationSleepShelterProblem(loc);
  if (sleepProblem) {
    errors.push(`location ${loc.id || file}: invalid modular sleep building in ${relPath}: ${sleepProblem}`);
  }
  const authoredNpcCount = locationAuthoredNpcRows(loc).length;
  const workerNpcCount = Math.min(workerSleepersByLocation.get(loc.id) || 0, loc.safe ? 14 : 10);
  const expectedSleepers = authoredNpcCount + workerNpcCount;
  const beds = locationSleepRows(loc).length;
  if (expectedSleepers > 0 && beds < expectedSleepers) {
    errors.push(`location ${loc.id || file}: not enough personal beds in ${relPath}: ${beds} beds for ${expectedSleepers} NPCs`);
  }
}

if (errors.length) {
  console.error('Economy generation guard failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Economy generation guard OK');
