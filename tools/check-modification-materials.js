'use strict';
// Материалы модификаций оружия должны быть добываемы игроком.
//
// Каталог модификаций требует scrap, weaponParts, electronics и wood. Из них
// weaponParts не добывался ни одним способом: ни узла добычи, ни рецепта у
// игрока, ни лута, ни торговца — пятнадцать модификаций из двадцати нельзя
// было собрать в принципе. Рецепты экономики поселений (data/economy-recipes)
// работают только у НПС и игроку недоступны, поэтому в счёт не идут.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const server = read('server.js');
const items = read('public', 'js', 'game', '03_items_inventory_core.js');
const loot = read('data', 'loot-tables.json');
const traders = read('data', 'traders.json');

// --- Что требуют модификации ---
const catalog = /const SERVER_WEAPON_MODIFICATION_CATALOG = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(server);
assert(catalog, 'каталог модификаций не найден');
const required = new Map();
for (const match of catalog[1].matchAll(/cost: \{([^}]*)\}/g)) {
  for (const pair of match[1].split(',')) {
    const key = pair.split(':')[0].trim();
    if (key) required.set(key, (required.get(key) || 0) + 1);
  }
}
assert(required.size > 0, 'у модификаций не осталось стоимости — проверьте каталог');

// --- Что игрок может получить ---
const recipeBlock = /const CRAFT_RECIPES = \[([\s\S]*?)\n  \];/.exec(items);
assert(recipeBlock, 'список рецептов игрока не найден');
const crafted = new Set([...recipeBlock[1].matchAll(/out: \{ id: '([^']+)'/g)].map(m => m[1]));

const harvested = new Set();
const locationsDir = path.join(ROOT, 'data', 'locations');
for (const file of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json'))) {
  const location = JSON.parse(fs.readFileSync(path.join(locationsDir, file), 'utf8'));
  for (const object of location.objects || []) {
    const raw = String(object.resourceType || object.resource || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase() === 'weaponparts' ? 'weaponParts'
      : raw.toLowerCase() === 'ammoparts' ? 'ammoParts'
        : raw;
    harvested.add(key);
  }
}

function sources(material) {
  const found = [];
  if (harvested.has(material)) found.push('добыча');
  if (crafted.has(material)) found.push('крафт игрока');
  if (loot.includes(`"${material}"`)) found.push('лут');
  if (traders.includes(`"${material}"`)) found.push('торговцы');
  return found;
}

const unreachable = [];
for (const material of required.keys()) {
  if (!sources(material).length) unreachable.push(material);
}
assert(unreachable.length === 0,
  `модификации требуют материалы, которых игроку негде взять: ${unreachable.join(', ')}`);

// --- Крафт деталей идёт на профильных станках ---
const stationBlock = /const CRAFT_RECIPE_STATIONS = \{([\s\S]*?)\n  \};/.exec(items);
assert(stationBlock, 'список станков не найден');
for (const [recipe, station] of [['weaponpartscraft', 'weapon_bench'], ['electronicscraft', 'energy_bench']]) {
  assert(new RegExp(`${recipe}:\\s*'${station}'`).test(stationBlock[1]),
    `рецепт ${recipe} должен быть привязан к станку ${station}`);
}

// --- Цена совпадает с экономикой поселений ---
// Иначе игрок и НПС собирают одни и те же детали по разной цене.
const economy = JSON.parse(read('data', 'economy-recipes.json'));
const economyRows = Array.isArray(economy.recipes)
  ? economy.recipes
  : Object.entries(economy.recipes).map(([id, row]) => ({ id, ...row }));
for (const [recipeId, material] of [['weaponpartscraft', 'weaponParts'], ['electronicscraft', 'electronics']]) {
  const economyRow = economyRows.find(row => row.id === material);
  assert(economyRow, `в экономике поселений нет рецепта ${material}`);
  const clientRow = new RegExp(`id: '${recipeId}'[^\\n]*cost: \\{([^}]*)\\}`).exec(recipeBlock[1]);
  assert(clientRow, `рецепт ${recipeId} не найден у игрока`);
  const clientCost = {};
  for (const pair of clientRow[1].split(',')) {
    const [key, value] = pair.split(':').map(part => part.trim());
    if (key) clientCost[key] = Number(value);
  }
  for (const [key, value] of Object.entries(economyRow.inputs || {})) {
    assert(clientCost[key] === value,
      `${recipeId}: ${key} стоит ${clientCost[key]} у игрока и ${value} в экономике поселений`);
  }
}

const summary = [...required.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([material, count]) => `${material}×${count} (${sources(material).join(', ')})`)
  .join('; ');
console.log(`Modification materials OK: ${summary}.`);
