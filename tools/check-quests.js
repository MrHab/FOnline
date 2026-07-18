const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath, fallback = null) {
  const file = path.join(ROOT, relPath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(dirRel, matcher = () => true) {
  const dir = path.join(ROOT, dirRel);
  if (!fs.existsSync(dir)) return [];
  const result = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (matcher(full)) {
        result.push(full);
      }
    }
  }
  return result;
}

function clientInventorySource() {
  return [
    '03_items_inventory_core.js',
    '03a_pipboy_social_world_tasks.js',
    '03b_inventory_actions_ui.js',
    '03c_skills_perks_tooltips.js',
    '03d_item_context_repair_crafting.js'
  ].map(name => readText(path.join('public', 'js', 'game', name))).join('\n');
}

function itemIdsFromClient() {
  const source = clientInventorySource();
  const block = source.match(/const ITEMS\s*=\s*\{([\s\S]*?)\n\s*\};/);
  const ids = new Set(['silver']);
  if (!block) return ids;
  const re = /^\s*([A-Za-z0-9_]+)\s*:\s*\{/gm;
  let match;
  while ((match = re.exec(block[1]))) ids.add(match[1]);
  return ids;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

const errors = [];
const warnings = [];
const itemIds = itemIdsFromClient();
const questsData = readJson('data/quests.json', { quests: {} });
const quests = questsData && typeof questsData.quests === 'object' ? questsData.quests : {};
const questIds = Object.keys(quests);

if (!questIds.length) {
  errors.push('В data/quests.json нет квестов.');
}

for (const [questId, quest] of Object.entries(quests)) {
  const required = quest?.requirements?.items || {};
  const rewardItems = Array.isArray(quest?.reward?.items) ? quest.reward.items : [];

  for (const [itemId, qty] of Object.entries(required)) {
    if (!itemIds.has(itemId)) errors.push(`${questId}: требуемый предмет "${itemId}" не найден в ITEMS.`);
    if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) errors.push(`${questId}: некорректное количество для "${itemId}".`);
  }

  for (const reward of rewardItems) {
    const itemId = String(reward?.id || '').trim();
    if (!itemId) errors.push(`${questId}: награда содержит предмет без id.`);
    else if (!itemIds.has(itemId)) errors.push(`${questId}: предмет награды "${itemId}" не найден в ITEMS.`);
    if (!Number.isFinite(Number(reward?.qty)) || Number(reward.qty) <= 0) errors.push(`${questId}: некорректное количество награды "${itemId}".`);
  }

  if (!quest?.name && !quest?.title) warnings.push(`${questId}: нет названия квеста.`);
  if (!quest?.requirements?.items && !quest?.requirements?.event) warnings.push(`${questId}: нет условий завершения.`);
  if (!quest?.reward?.xp && !quest?.reward?.silver && !rewardItems.length) warnings.push(`${questId}: нет награды.`);
}

const referenceFiles = [
  path.join(ROOT, 'server.js'),
  ...listFiles('src/server', file => file.endsWith('.js')),
  ...listFiles('public/js/game', file => file.endsWith('.js')),
  ...listFiles('data/locations', file => file.endsWith('.json'))
];

for (const questId of questIds) {
  const hits = referenceFiles.filter(file => fs.readFileSync(file, 'utf8').includes(questId));
  if (!hits.length) errors.push(`${questId}: квест нигде не привязан к НПС, торговцу или локации.`);
}

const clientProgress = clientInventorySource();
const groupsBlock = clientProgress.match(/function currentNpcQuestGroups\(\)\s*\{([\s\S]*?)\n\s*function renderPipboyInfoPanels/);
for (const questId of questIds) {
  if (!groupsBlock || !groupsBlock[1].includes(`state.${questId}`)) {
    errors.push(`${questId}: квест не отображается в журнале заданий пип-боя.`);
  }
}

const serverSim = readText('src/server/wasteland-sim.js');
[
  ['доставка ресурсов', 'function completeWorldTaskDelivery'],
  ['завершение боя на карте', 'function applyEncounterOutcomeToSettlements'],
  ['зачистка точки', 'function claimClearedSite'],
  ['единое завершение задачи', 'function finishWorldTask']
].forEach(([label, needle]) => {
  if (!serverSim.includes(needle)) errors.push(`Мировые задания: не найден путь завершения "${label}".`);
});

const sim = readJson('data/wasteland-sim.json', null);
if (sim) {
  const sites = sim.sites && typeof sim.sites === 'object' ? sim.sites : {};
  const parties = sim.parties && typeof sim.parties === 'object' ? sim.parties : {};
  const activeTasks = asArray(sim.worldTasks).filter(task => task && task.status === 'active');
  const supportedTypes = new Set(['deliver_supplies', 'defend_resource', 'retake_site', 'clear_lair', 'escort_caravan', 'join_patrol']);

  for (const task of activeTasks) {
    const id = String(task.id || '').trim() || '<без id>';
    const type = String(task.type || '').trim();
    if (!supportedTypes.has(type)) {
      warnings.push(`${id}: неизвестный тип мирового задания "${type}".`);
      continue;
    }
    if (type === 'deliver_supplies') {
      if (!task.siteId || !sites[task.siteId]) warnings.push(`${id}: доставка не указывает существующую точку сдачи.`);
      if (!task.details?.demand || !Object.keys(task.details.demand).length) warnings.push(`${id}: доставка не содержит список ресурсов.`);
    }
    if (['defend_resource', 'retake_site'].includes(type) && (!task.siteId || !sites[task.siteId])) {
      warnings.push(`${id}: боевое задание не указывает существующую точку.`);
    }
    if (['escort_caravan', 'join_patrol'].includes(type)) {
      const partyId = task.joinPartyId || task.partyId;
      if (!partyId || !parties[partyId]) warnings.push(`${id}: задание отряда не указывает существующий отряд.`);
    }
    if (type === 'clear_lair') {
      const hasParty = task.partyId && parties[task.partyId];
      const hasPoint = Number.isFinite(Number(task.targetX ?? task.details?.x)) && Number.isFinite(Number(task.targetY ?? task.details?.y));
      if (!hasParty && !hasPoint && !task.siteId) warnings.push(`${id}: зачистка не указывает логово, отряд или координаты.`);
    }
  }
}

if (warnings.length) {
  console.log('Предупреждения проверки квестов:');
  warnings.forEach(line => console.log(`- ${line}`));
}

if (errors.length) {
  console.error('Ошибки проверки квестов:');
  errors.forEach(line => console.error(`- ${line}`));
  process.exit(1);
}

console.log(`Проверка квестов пройдена: ${questIds.length} обычных квестов, ${itemIds.size} предметов.`);
