const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { normalizeWorldTask } = require('../src/server/wasteland-world-tasks');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const { normalizeRecipeCatalog, normalizeTraderProfiles } = require('../src/server/faction-economy');
const { isRetiredEnvironmentModel } = require('../src/server/retired-environment-models');

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

function functionSource(source, name) {
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
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

const errors = [];
const server = readText('server.js');
const wastelandSim = readText('src/server/wasteland-sim.js');
const wastelandPartySpeed = readText('src/server/wasteland-party-speed.js');
const quests = readJson('data/quests.json');
const locationDir = path.join(ROOT, 'data', 'locations');

function requireText(label, source, needle) {
  if (!source.includes(needle)) errors.push(`${label}: missing guard "${needle}"`);
}

function rejectText(label, source, needle) {
  if (source.includes(needle)) errors.push(`${label}: forbidden economy generator "${needle}"`);
}

// Выключатели ECONOMY_RULES (случайные таблицы, пополнение контейнеров) стережёт
// поведением tools/check-world-containers.js, перки поиска — tools/check-loot-perks.js:
// обе идут в `npm run check:economy` следом за этой проверкой.
requireText('server inventory limits', server, 'SERVER_ITEM_STACK_LIMITS');
requireText('server save economy sanitizer', functionBody(server, 'safeSaveState'), 'sanitizePersistedEconomyState(state);');
requireText('server inventory sanitizer', functionBody(server, 'sanitizeServerInventorySnapshot'), 'serverItemStackLimit(id)');
const inventoryLimitContext = {
  SERVER_ITEM_IDS: new Set(['water', 'scrap']),
  serverBaseItemId: value => String(value || ''),
  serverItemStackLimit: id => id === 'water' ? 10 : 20,
  serverInventoryQty: (rows, id) => (Array.isArray(rows) ? rows : [])
    .filter(row => row?.id === id)
    .reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.qty || 0))), 0),
  serverItemWeight: id => id === 'water' ? 1 : 2,
  sanitizeCarrySnapshot: player => {
    const weight = (Array.isArray(player?.inventory) ? player.inventory : [])
      .reduce((sum, row) => sum + inventoryLimitContext.serverItemWeight(row.id) * Number(row.qty || 0), 0);
    const carry = { weight, capacity: Number(player?.capacity || 100), serverCapacity: Number(player?.capacity || 100), updatedAt: 1 };
    player.carry = carry;
    return carry;
  }
};
vm.createContext(inventoryLimitContext);
vm.runInContext(functionSource(server, 'serverLimitItemsByCarry'), inventoryLimitContext);
const stackLimited = inventoryLimitContext.serverLimitItemsByCarry(
  { inventory: [{ id: 'water', qty: 9 }], capacity: 100 },
  {},
  [{ id: 'water', qty: 3 }],
  { apply: false }
);
if (stackLimited.items.length !== 1
  || stackLimited.items[0].id !== 'water'
  || stackLimited.items[0].qty !== 1
  || stackLimited.stackBlocked !== true
  || stackLimited.weightBlocked !== false) {
  errors.push('server loot limiter does not preserve overflow at the source when an inventory stack is nearly full');
}
const duplicateStackRows = inventoryLimitContext.serverLimitItemsByCarry(
  { inventory: [{ id: 'water', qty: 8 }], capacity: 100 },
  {},
  [{ id: 'water', qty: 2 }, { id: 'water', qty: 2 }],
  { apply: false }
);
if (duplicateStackRows.items.reduce((sum, row) => sum + row.qty, 0) !== 2
  || duplicateStackRows.stackBlocked !== true) {
  errors.push('server loot limiter does not share remaining stack capacity across duplicate item rows');
}
const weightLimited = inventoryLimitContext.serverLimitItemsByCarry(
  { inventory: [], capacity: 1 },
  {},
  [{ id: 'water', qty: 3 }],
  { apply: false }
);
if (weightLimited.items.length !== 1
  || weightLimited.items[0].qty !== 1
  || weightLimited.weightBlocked !== true) {
  errors.push('server loot limiter no longer enforces carry weight while applying stack limits');
}
const serverNpcQuestAction = functionBody(server, 'performServerNpcQuestAction');
requireText('server npc quest caps', serverNpcQuestAction, 'const paidSilver = Math.min(requestedSilver, serverNpcInventoryCaps(actor));');
requireText('server npc quest caps', serverNpcQuestAction, 'serverNpcSetInventoryCaps(actor, serverNpcInventoryCaps(actor) - paidSilver);');
const legacyWorldTaskReward = normalizeWorldTask({ id: 'legacy_reward', reward: { silver: 37.9 } }, 0);
if (legacyWorldTaskReward?.reward?.caps !== 37) {
  errors.push('world task rewards: legacy silver reward is not normalized into integer caps');
}
requireText('world task rewards', functionBody(wastelandSim, 'fundWorldTaskCapsRewardFromSite'), 'stock.silver = Math.max(0, available - deducted);');
requireText('server authored crafting output index', server, 'const SERVER_CRAFT_RECIPE_OUTPUTS = KROMKA_FIELD_RECIPE_INDEXES.outputs');
requireText('server crafting inventory transaction', server, 'function serverInventoryApplyCraftTransaction');
const serverCrafting = functionBody(server, 'recordWastelandCraftingStationFee');
requireText('server crafting uses inventory transaction', serverCrafting, 'serverInventoryApplyCraftTransaction(player.inventory || [], recipeId, fee, actor,');
requireText('server crafting previews clan modifiers', serverCrafting, 'serverPreviewClanCraftBenefit(');
requireText('server crafting commits clan modifiers only after carry validation', serverCrafting, 'serverCommitClanCraftBenefit(clanContext.runtime, clanPreview);');
requireText('server crafting uses authoritative room', serverCrafting, "rooms.get(String(player?.roomId || ''))");
requireText('server crafting uses authoritative location', serverCrafting, 'normalizeLocationId(playerRoom.locationId');
requireText('server crafting rejects forged location', serverCrafting, 'normalizeLocationId(requestedLocationId) !== locationId');
requireText('server crafting uses authoritative fee', serverCrafting, 'let fee = requiredFee;');
requireText('server crafting charges the authoritative plot fee', serverCrafting, 'fee = plotCharge.fee;');
requireText('server crafting refuses a lower plot fee', serverCrafting, 'if (requestedFee < plotCharge.fee)');
rejectText('server crafting client-selected location', serverCrafting, 'normalizeLocationId(data.locationId ||');
requireText('server crafting blocks world-map requests', server, 'if (!p || !p.roomId || p.onGlobalMap || p.dead');
requireText('server crafting station model guard', functionBody(server, 'serverCraftingObjectMatchesStation'), 'SERVER_CRAFT_STATION_MODELS[key]');
// Экономика v3: торговых автоматов нет — ни обработчиков на сервере, ни
// запросов из клиентов (Unity-клиент проверяет check-unity-client-parity).
// Торгуют только люди в столицах и скупщик Ядра.
rejectText('server trade machine', server, 'tradeMachineMarketState');
rejectText('server trade machine', server, 'tradeMachineExchange');
requireText('world retail stock transaction', functionBody(wastelandSim, 'applyRetailTransaction'), 'site.stockpile = next;');
requireText('server NPC trade only from capital traders', functionBody(server, 'serverNpcTradeOpen'), 'locationIsFactionCapital(LOCATIONS[id])');
requireText('world visible production deposit', functionBody(wastelandSim, 'performVisibleSiteWork'), "kind: 'visible_craft'");
requireText('world caravan join guard', functionBody(wastelandSim, 'joinWorldParty'), 'caravanStagingIsOpen(party)');
requireText('world caravan minimum speed constant', wastelandPartySpeed, 'const CARAVAN_MIN_SPEED_KMH = 4;');
requireText('world caravan minimum speed normalization', functionBody(wastelandPartySpeed, 'normalizeWorldPartySpeedKmh'), 'worldPartyMinimumSpeedKmh(party, defaults)');
requireText('world caravan minimum movement speed', functionBody(wastelandSim, 'moveParty'), 'effectiveWorldPartySpeedKmh(party)');
requireText('world caravan minimum published speed', functionBody(wastelandSim, 'publicParty'), 'effectiveWorldPartySpeedKmh(party)');
requireText('server resource site room identity', functionBody(server, 'getOrCreateRoom'), 'worldSiteIdFromRoomId(id, loc)');
requireText('server resource site output nodes', functionBody(server, 'ensureWastelandSiteResourceNodes'), 'wastelandSiteResourceRows(site)');
requireText('server resource site output nodes', functionBody(server, 'ensureWastelandSiteResourceNodes'), 'siteOutputResource: true');
requireText('server camel-case resource aliases', server, "ammoparts: 'ammoParts'");

rejectText('world artificial time cap', functionBody(wastelandSim, 'tick'), 'cappedHours');

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

const defaultSitesList = defaultSiteRows();
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
  // Доски заданий убраны из всех локаций по решению дизайна: контракты
  // берутся через Пип-бой и с глобальной карты, а не у объекта в мире.
  // Поэтому наличие доски на экономической площадке больше не требуется.
  if ((site.type === 'production' || site.type === 'outpost' || site.production) && !locationHasCraftingStation(loc)) {
    errors.push(`world economy site ${site.id}: missing authored crafting station in ${relPath}`);
  }
  // Торговые автоматы убраны из всех локаций по решению дизайна. Автомат был
  // лишь игровой лавкой над складом площадки (tradeMachineMarketState), а не
  // участником симуляции экономики, поэтому производственная площадка
  // больше не обязана его иметь.
}

const capitalStorageFactions = {
  settlement: 'old_klim',
  scrapTown: 'scrap_union',
  relayStation: 'relay_order',
  caravanCamp: 'caravans'
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
  if (isRetiredEnvironmentModel(row.model)) {
    if (fs.existsSync(modelPath)) errors.push(`Retired station GLB returned: ${row.file}`);
  } else if (!fs.existsSync(modelPath)) errors.push(`crafting station model is missing: ${row.file}`);
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
    const nativeStation = expected && isRetiredEnvironmentModel(expected.model);
    if (!expected || row.model !== expected.model
      || (nativeStation ? (row.unityAuthored !== true || row.url || row.file) : actualFile !== expected.file)) {
      errors.push(`location ${loc.id || file}: crafting station ${row.id || 'unknown'} has the wrong dedicated model for ${ids[0]} (${relPath})`);
    }
    if (nativeStation && !loc.unityScene) {
      // Scene file names no longer equal location ids (wasteland -> KromkaGloomDetour):
      // a native station needs the explicit unityScene binding, never a derived path.
      errors.push(`location ${loc.id}: native crafting station ${row.id} has no unityScene binding`);
    } else if (nativeStation) {
      const sceneFile = path.join(ROOT, 'unity-client', loc.unityScene);
      const scene = fs.existsSync(sceneFile) ? fs.readFileSync(sceneFile, 'utf8') : '';
      if (!scene.includes(`_stableObjectId: ${row.id}\n`) && !scene.includes(`_stableObjectId: ${row.id}\r\n`)) {
        errors.push(`location ${loc.id}: native crafting station ${row.id} has no authored scene anchor`);
      }
    }
  });
  const capitalStorageFaction = capitalStorageFactions[loc.id] || '';
  // Базы фракций Сердцевины — не столицы: одно личное хранилище для своей
  // фракции без обязательного набора станков.
  const baseStorageFaction = String(loc.territoryRole || '') === 'base' ? String(loc.factionAccess || '') : '';
  if (!capitalStorageFaction && !baseStorageFaction && warehouseRows.length) {
    errors.push(`location ${loc.id || file}: storage is only allowed in faction capitals (${relPath})`);
  }
  if (baseStorageFaction) {
    if (warehouseRows.length !== 1) {
      errors.push(`faction base ${loc.id}: expected exactly one storage, found ${warehouseRows.length} (${relPath})`);
    } else if (String(warehouseRows[0].interactive?.storageFaction || '') !== baseStorageFaction) {
      errors.push(`faction base ${loc.id}: storage faction mismatch (${relPath})`);
    }
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
  // Сна у NPC нет: личных коек и спальных корпусов в локациях не бывает.
  const bed = (loc.objects || []).find(row => {
    const role = String(row.role || row.entity?.role || row.interactive?.role || '').toLowerCase();
    const tags = locationTags(row);
    return role === 'bed' || role === 'sleep' || tags.includes('personal-bed') || tags.includes('sleep');
  });
  if (bed) errors.push(`location ${loc.id || file}: NPCs do not sleep, remove the bed ${bed.id || bed.model} from ${relPath}`);
}

// Награда лаборатории тематическая: её сейфы гарантируют компонент своей семьи,
// иначе старшие тиры стабилизации не из чего собрать.
function checkLaboratoryRewards() {
  const territory = readJson('data/kromka/territory.json');
  for (const lab of territory.labs || []) {
    const definition = readJson(`data/locations/${lab.id}.json`);
    const component = (lab.rewardComponents || [])[0];
    if (!component) {
      errors.push(`laboratory ${lab.id}: rewardComponents is empty, the lab has no economic purpose`);
      continue;
    }
    const safes = (definition.containers || []).filter(row => ['outer_vault', 'inner_vault', 'inner_cabinet'].includes(row.id));
    if (safes.length !== 3) {
      errors.push(`laboratory ${lab.id}: expected three safes, found ${safes.length}`);
      continue;
    }
    for (const safe of safes) {
      const loot = Array.isArray(safe.loot) ? safe.loot : [];
      if (!loot.some(row => row.id === component && Number(row.qty) > 0)) {
        errors.push(`laboratory ${lab.id}: safe ${safe.id} does not yield its family component ${component}`);
      }
      if (safe.lootTable !== true) {
        errors.push(`laboratory ${lab.id}: safe ${safe.id} must still roll its tier table on top of the themed reward`);
      }
    }
  }
}

// Награда мирового босса: сейфы установки не могут быть пустыми — случайные
// таблицы в проекте выключены, поэтому добыча авторская.
function checkWorldBossRewards() {
  const reactor = readJson('data/locations/coreLabCenterReactor.json');
  const vaults = (reactor.containers || []).filter(row => row.bossLoot);
  if (vaults.length < 2) {
    errors.push('world boss: the installation must keep at least two reward containers');
    return;
  }
  for (const vault of vaults) {
    const loot = Array.isArray(vault.loot) ? vault.loot : [];
    if (!loot.length) {
      errors.push(`world boss: container ${vault.id} is empty, defeating the Custodian would give nothing`);
      continue;
    }
    if (!loot.some(row => row.id === 'stabilizerCatalyst' && Number(row.qty) > 0)) {
      errors.push(`world boss: container ${vault.id} does not yield stabilization catalysts`);
    }
    if (vault.locked !== true) errors.push(`world boss: container ${vault.id} must stay locked until the victory`);
  }
  const families = new Set(vaults.flatMap(row => (row.loot || []).map(entry => entry.id)));
  for (const component of ['bioReagent', 'circuitModule', 'alloyPlate', 'spectrumSample']) {
    if (!families.has(component)) {
      errors.push(`world boss: the reward misses the ${component} family component`);
    }
  }
}

function checkPersistentFactionEconomy() {
  const recipeData = readJson('data/economy-recipes.json');
  const traderData = readJson('data/traders.json');
  const recipes = normalizeRecipeCatalog(recipeData);
  const traders = normalizeTraderProfiles(traderData);
  const stationIds = new Set(Object.keys(craftingStationModels));
  const rawResources = new Set(['water', 'oil', 'scrap', 'ore', 'wood', 'chemicals']);

  if (recipeData.schema !== 'realm.economyRecipes.v1' || Object.keys(recipes).length < 20) {
    errors.push('faction economy: authored recipe catalog is missing or unexpectedly small');
  }
  for (const recipe of Object.values(recipes)) {
    if (!stationIds.has(recipe.station)) errors.push(`faction economy recipe ${recipe.id}: unknown station ${recipe.station}`);
    for (const inputId of Object.keys(recipe.inputs || {})) {
      if (!rawResources.has(inputId) && !recipes[inputId]) errors.push(`faction economy recipe ${recipe.id}: input ${inputId} cannot be produced or harvested`);
    }
  }
  for (const profile of Object.values(traders)) {
    for (const row of profile.stock) {
      if (!rawResources.has(row.id) && !recipes[row.id]) errors.push(`faction trader ${profile.id}: ${row.id} has no production recipe`);
      if (row.shelfMin > row.shelfTarget || row.shelfTarget > row.shelfMax) errors.push(`faction trader ${profile.id}: invalid shelf targets for ${row.id}`);
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-faction-economy-'));
  try {
    const stateFile = path.join(tempDir, 'wasteland-sim.json');
    let sim = createWastelandSimulation({ stateFile, traderProfiles: traderData, saveIntervalMs: 3000 });
    const context = { siteId: 'settlement', role: 'merchant', marketKey: 'settlement:economy_guard' };
    sim.state().sites.settlement.stockpile.ammo9 = 12;
    const initial = sim.applyTraderSupply('oldKlim', traderData.profiles.oldKlim, context);
    const initialAmmo = initial.stock.find(row => row.id === 'ammo9');
    if (!initialAmmo || !initial.marketKey) throw new Error('persistent market did not initialize authored stock');
    const bought = sim.applyNpcTraderTransaction('oldKlim', {
      buys: [{ id: 'ammo9', qty: 1 }],
      silverDelta: initialAmmo.price,
      marketKey: initial.marketKey
    }, context);
    if (!bought.ok || bought.stock.find(row => row.id === 'ammo9')?.qty !== initialAmmo.qty - 1) {
      throw new Error('persistent market did not retain a purchase');
    }

    sim.save(true);
    sim = createWastelandSimulation({ stateFile, traderProfiles: traderData, saveIntervalMs: 3000 });
    const reloaded = sim.applyTraderSupply('oldKlim', traderData.profiles.oldKlim, context);
    if (reloaded.stock.find(row => row.id === 'ammo9')?.qty !== initialAmmo.qty - 1) {
      throw new Error('persistent market purchase disappeared after reload');
    }
    const remainingAmmo = reloaded.stock.find(row => row.id === 'ammo9')?.qty || 0;
    const emptied = sim.applyNpcTraderTransaction('oldKlim', {
      buys: [{ id: 'ammo9', qty: remainingAmmo }],
      silverDelta: 0,
      marketKey: reloaded.marketKey
    }, context);
    if (!emptied.ok) throw new Error('persistent market could not be emptied for restock test');
    const settlement = sim.state().sites.settlement;
    settlement.stockpile.ammo9 = 7;
    settlement.retailMarkets[reloaded.marketKey].lastRestockHour = -999;
    const restocked = sim.applyTraderSupply('oldKlim', traderData.profiles.oldKlim, context);
    if ((restocked.stock.find(row => row.id === 'ammo9')?.qty || 0) !== 7 || Number(settlement.stockpile.ammo9 || 0) !== 0) {
      throw new Error('retail restock did not move real stock from the faction warehouse');
    }

  } catch (error) {
    errors.push(`faction economy runtime: ${error.message}`);
  } finally {
    const resolvedTemp = path.resolve(tempDir);
    const resolvedRoot = path.resolve(os.tmpdir());
    if (resolvedTemp.startsWith(`${resolvedRoot}${path.sep}`) && path.basename(resolvedTemp).startsWith('realm-faction-economy-')) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
}

checkPersistentFactionEconomy();
checkLaboratoryRewards();
checkWorldBossRewards();

if (errors.length) {
  console.error('Economy generation guard failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Economy generation guard OK');
