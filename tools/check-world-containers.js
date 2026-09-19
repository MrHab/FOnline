#!/usr/bin/env node
'use strict';

// Мировые контейнеры в экономике v3 (библия 14.5, 17.2). Случайных таблиц нет,
// поэтому контейнер отдаёт только авторский список — и пустой авторский
// контейнер значит «взломал и ничего не нашёл». Проверяется поведение настоящих
// функций server.js под настоящими выключателями ECONOMY_RULES, правила
// авторской добычи и совпадение данных Сердцевины с их генератором.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const items = new Map(readJson('data/kromka/items.json').items.map(row => [row.id, row]));
const economy = readJson('data/kromka/economy.json');
const territory = readJson('data/kromka/territory.json');
const lootTables = readJson('data/loot-tables.json');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

// --- выключатели экономики: поведение, а не текст -------------------------------------
{
  const rules = /const ECONOMY_RULES = Object\.freeze\(\{[\s\S]*?\}\);/.exec(source);
  assert(rules, 'server.js must declare ECONOMY_RULES');
  let respawned = 0;
  const context = vm.createContext({
    Object, Array, Number, String, Math, Map, Set,
    SERVER_ITEM_IDS: new Set(items.keys()),
    SERVER_CONTAINER_LOOT_TABLES: lootTables.containers,
    SERVER_ENEMY_LOOT_TABLES: lootTables.enemies,
    serverBaseItemId: id => String(id || ''),
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    addLootStack: (loot, id, qty) => { if (qty > 0) loot.push({ id, qty }); return loot; },
    currentGameDayIndex: () => 7,
    spawnRoomWorldContainers: () => { respawned += 1; },
    refreshRoomWorldState: () => {},
    emitWorldContainersSnapshot: () => {}
  });
  vm.runInContext(rules[0].replace('const ECONOMY_RULES', 'var ECONOMY_RULES'), context);
  for (const name of [
    'rollIntRange', 'normalizeContainerLootTier', 'normalizeEnemyLootTier', 'rollServerLootTable',
    'rollContainerLootTable', 'rollEnemyStartingInventoryServer', 'rollWorldContainerLootServer',
    'restockRoomWorldContainersIfNeeded'
  ]) vm.runInContext(functionSource(name), context);
  const room = { rng: () => 0, worldReady: true, containersRestockDay: 1, sockets: new Set() };
  const plain = value => JSON.parse(JSON.stringify(value));

  // Бросок 0 проходит любой шанс таблицы: включённая таблица обязательно что-то дала бы.
  for (const tier of Object.keys(lootTables.containers)) {
    assert.deepEqual(plain(context.rollWorldContainerLootServer(room, { tier })), [],
      `a ${tier} container without an authored list must stay empty: random tables are off`);
  }
  for (const lootTier of Object.keys(lootTables.enemies)) {
    assert.deepEqual(plain(context.rollEnemyStartingInventoryServer(room, { lootTier, startingCaps: 5 })), [],
      `a ${lootTier} enemy must not start with a rolled inventory`);
  }
  const authored = [{ id: 'scrap', qty: 4 }, { id: 'medicine', qty: 2 }];
  assert.deepEqual(plain(context.rollWorldContainerLootServer(room, { tier: 'rare', loot: authored })), authored,
    'a container yields exactly its authored list');
  assert.deepEqual(plain(context.rollWorldContainerLootServer(room, { tier: 'rare', loot: authored, lootTable: true })), authored,
    'the tier table is not rolled on top of the authored reward either');
  assert.deepEqual(plain(context.rollWorldContainerLootServer(room, {
    loot: [{ id: 'scrap', qty: 0 }, { id: 'noSuchItem', qty: 3 }, { id: 'ore', qty: 2.9 }]
  })), [{ id: 'ore', qty: 2 }], 'unknown items and empty stacks never reach a container');
  assert.equal(context.restockRoomWorldContainersIfNeeded(room), false, 'a new game day does not refill containers');
  assert.equal(respawned, 0, 'containers are built once per room, a looted cache stays looted');
}

// --- авторские контейнеры ---------------------------------------------------------------
const locationsDir = path.join(root, 'data', 'locations');
const containers = [];
for (const file of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json')).sort()) {
  const location = JSON.parse(fs.readFileSync(path.join(locationsDir, file), 'utf8'));
  for (const row of Array.isArray(location.containers) ? location.containers : []) {
    containers.push({ location, row, key: `${location.id}/${row.id}`, loot: Array.isArray(row.loot) ? row.loot : [] });
  }
}
assert(containers.length > 0, 'the world has authored containers');

// Ящик снаряжения учебного двора сервер наполняет сам — личным набором персонажа.
const CODE_FILLED = new Set(['tutorialCaravanYard/yard_supply']);
// Снаряжение делают только игроки: в контейнере лежат материалы, расходники и марки.
const ALLOWED_CATEGORIES = new Set(['materials', 'aid', 'misc', 'ammo', 'currency']);
// Семейные компоненты стабилизации дают только лаборатории Сердцевины и Хранитель.
const familyComponents = new Set(territory.labs.map(lab => (lab.rewardComponents || [])[0]).filter(Boolean));
const labLocations = new Set([...territory.labs.map(lab => lab.id), ...territory.centralLab.levels.map(level => level.id)]);
assert.equal(familyComponents.size, territory.labs.length, 'every laboratory names its family component');

const value = entry => entry.loot.reduce((sum, row) => sum + items.get(row.id).basePrice * row.qty, 0);
const protectedBy = row => (row.locked ? 1 : 0) + (row.terminalLocked ? 1 : 0);

for (const entry of containers) {
  if (CODE_FILLED.has(entry.key)) {
    assert.equal(entry.loot.length, 0, `${entry.key}: the server issues this crate itself`);
    continue;
  }
  assert(entry.loot.length > 0,
    `${entry.key}: an authored container without a loot list is always empty — author its loot or remove it`);
  const seen = new Set();
  for (const row of entry.loot) {
    const item = items.get(row.id);
    assert(item, `${entry.key}: unknown item ${row.id}`);
    assert(!seen.has(row.id), `${entry.key}: ${row.id} is listed twice`);
    seen.add(row.id);
    assert(Number.isInteger(row.qty) && row.qty > 0 && row.qty <= item.stackLimit, `${entry.key}: bad quantity of ${row.id}: ${row.qty}`);
    assert(ALLOWED_CATEGORIES.has(item.category),
      `${entry.key}: ${row.id} is ${item.category} — gear enters the world through player crafting only`);
    if (familyComponents.has(row.id)) {
      assert(labLocations.has(entry.location.id), `${entry.key}: the family component ${row.id} belongs to the laboratories`);
    }
    if (row.id === 'silver') {
      assert(protectedBy(entry.row) > 0 && entry.location.pvpMode !== 'peaceful',
        `${entry.key}: marks wait behind a lock in a dangerous zone, not in an open box of a safe town`);
    }
  }
}

// --- лестница ценности ------------------------------------------------------------------
// Богатство зоны задаёт экономика (zones.lootMultiplier), а не эта проверка. Сейфы
// лабораторий и награда Хранителя в лестницу не входят: их цена — незаменимый
// компонент, а не сумма базовых цен.
const richness = mode => Number(economy.zones.lootMultiplier[mode] ?? 1);
const caches = containers.filter(entry => !CODE_FILLED.has(entry.key) && !entry.row.bossLoot
  && !entry.loot.some(row => familyComponents.has(row.id)));
const zones = [...new Set(caches.map(entry => entry.location.pvpMode))].sort((a, b) => richness(a) - richness(b));
assert(zones.length >= 4, 'caches lie in safe, yellow, red and black zones: ' + zones.join(', '));
const span = rows => ({ min: Math.min(...rows.map(value)), max: Math.max(...rows.map(value)) });
let poorerOpen = null;
for (const zone of zones) {
  const inZone = caches.filter(entry => entry.location.pvpMode === zone);
  const open = inZone.filter(entry => protectedBy(entry.row) === 0);
  const single = inZone.filter(entry => protectedBy(entry.row) === 1);
  const double = inZone.filter(entry => protectedBy(entry.row) === 2);
  assert(open.length > 0, `${zone}: the zone keeps an open cache to compare with`);
  if (poorerOpen) {
    assert(span(open).min > poorerOpen.max,
      `${zone}: an open cache (${span(open).min}) must be worth more than any open cache of a poorer zone (${poorerOpen.max})`);
  }
  poorerOpen = span(open);
  if (single.length) {
    assert(span(single).min > span(open).max,
      `${zone}: a lock or a terminal must pay — ${span(single).min} against an open ${span(open).max}`);
  }
  if (double.length) {
    assert(span(double).min > span([...open, ...single]).max,
      `${zone}: a lock with a terminal must pay the most — ${span(double).min} against ${span([...open, ...single]).max}`);
  }
}

// --- генератор Сердцевины и данные говорят одно и то же ---------------------------------
// Перезапуск генератора стирает геометрию, которую дописал экспортёр Unity, поэтому
// строки правят и в нём, и в JSON; здесь видно, что они не разошлись.
{
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-territory-'));
  try {
    execFileSync(process.execPath, [path.join(root, 'tools', 'build-kromka-territory-locations.js'), `--out=${out}`], { stdio: 'pipe' });
    const generated = fs.readdirSync(out).filter(name => name.endsWith('.json'));
    assert(generated.length > 0, 'the territory generator writes its locations');
    for (const file of generated) {
      const fresh = JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
      const committed = JSON.parse(fs.readFileSync(path.join(locationsDir, file), 'utf8'));
      assert.deepEqual(committed.containers || [], fresh.containers || [],
        `${file}: containers differ from tools/build-kromka-territory-locations.js — change both`);
    }
  } finally {
    const resolved = path.resolve(out);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('kromka-territory-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

const total = containers.reduce((sum, entry) => sum + (CODE_FILLED.has(entry.key) ? 0 : value(entry)), 0);
console.log(`World containers OK: ${containers.length} authored containers, none empty, no gear inside, `
  + `value rises ${zones.join(' < ')} and with protection, ${Math.round(total)} marks-equivalent per room lifetime, `
  + 'random tables and daily restock stay off, the Core generator matches the data.');
