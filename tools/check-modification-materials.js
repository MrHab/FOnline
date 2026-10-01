'use strict';
// Материалы модификаций оружия должны быть добываемы игроком.
//
// Материалы модификаций должны иметь реальные игровые источники. Редкие
// компоненты приходят только из авторских тайников и наград.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const server = read('server.js');
const fieldRecipes = JSON.parse(read('data', 'kromka', 'field-recipes.json'));
const traders = JSON.parse(read('data', 'traders.json'));
const quests = JSON.parse(read('data', 'quests.json'));

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
// Рецепты игрока — полевой каталог Кромки (data/kromka/field-recipes.json).
const recipes = Array.isArray(fieldRecipes.recipes) ? fieldRecipes.recipes : [];
assert(recipes.length > 0, 'список рецептов игрока не найден');
const crafted = new Set(recipes.map(row => row?.output?.id).filter(Boolean));
const economy = JSON.parse(read('data', 'economy-recipes.json')).recipes;

const harvested = new Set();
const looted = new Set();
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
  for (const container of location.containers || [])
    for (const row of container.loot || []) looted.add(row.id);
}
const zonesDir = path.join(ROOT, 'data', 'zones', 'authored');
for (const file of fs.readdirSync(zonesDir).filter(name => name.endsWith('.json'))) {
  const zone = JSON.parse(fs.readFileSync(path.join(zonesDir, file), 'utf8'));
  for (const container of zone.containers || [])
    for (const row of container.loot || []) looted.add(row.id);
}
const sold = new Set(Object.values(traders.profiles).flatMap(profile => (profile.stock || []).map(row => row.id)));

function sources(material) {
  const found = [];
  if (harvested.has(material)) found.push('добыча');
  if (crafted.has(material)) found.push('крафт игрока');
  if (looted.has(material)) found.push('лут');
  if (sold.has(material)) found.push('торговцы');
  return found;
}

const unreachable = [];
for (const material of required.keys()) {
  if (!sources(material).length) unreachable.push(material);
}
assert(unreachable.length === 0,
  `модификации требуют материалы, которых игроку негде взять: ${unreachable.join(', ')}`);

for (const id of ['scrap', 'electronics', 'weaponParts']) {
  assert(looted.has(id), `${id}: редкий материал отсутствует в авторских тайниках`);
  assert(Object.values(quests.quests || {}).some(quest => (quest.reward?.items || []).some(row => row.id === id && row.qty > 0)),
    `${id}: редкий материал отсутствует в наградах заданий`);
  assert(!harvested.has(id) && !crafted.has(id) && !economy[id] && !sold.has(id),
    `${id}: редкий материал доступен вне лута или наград`);
}

const summary = [...required.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([material, count]) => `${material}×${count} (${sources(material).join(', ')})`)
  .join('; ');
console.log(`Modification materials OK: ${summary}.`);
