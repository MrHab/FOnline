#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  fieldRecipeCatalogIndexes,
  itemCatalogIndexes,
  normalizeFieldRecipeCatalog,
  normalizeItemCatalog
} = require('../src/server/kromka-items');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const json = relative => JSON.parse(read(relative));

const catalog = normalizeItemCatalog(json('data/kromka/items.json'));
const packWeapons = json('data/kromka/apocalypse-weapons.json').weapons;
const throwableIds = new Set(packWeapons
  .filter(row => row.kind === 'throwable').map(row => row.itemId));
const indexes = itemCatalogIndexes(catalog);
const recipes = normalizeFieldRecipeCatalog(json('data/kromka/field-recipes.json'), catalog);
const recipeIndexes = fieldRecipeCatalogIndexes(recipes);
for (const weapon of packWeapons) {
  const item = indexes.byId[weapon.itemId];
  assert(item, `${weapon.itemId}: pack model has no playable item`);
  assert(item.description && item.tier >= 1 && item.tier <= 5,
    `${weapon.itemId}: pack item has no description or tier`);
  if (weapon.itemId.startsWith('polygon')) {
    assert.strictEqual(item.category, 'weapons', `${weapon.itemId}: pack weapon is outside the weapon catalog`);
    const recipe = recipeIndexes.byId[weapon.itemId + 'craft'];
    assert(recipe && recipe.output.id === weapon.itemId && recipe.station === 'weapon_bench',
      `${weapon.itemId}: pack weapon has no workbench recipe`);
  }
  if (item.category === 'weapons')
    assert.strictEqual(item.name, weapon.name, `${weapon.itemId}: old display name remains`);
}
for (const id of [...new Set([...packWeapons.map(row => row.itemId),
  'sawedOffShotgun', 'backpack', 'leather', 'metalArmor', 'ballisticVest',
  'combatArmor', 'hazmatSuit', 'heavyArmor', 'energySuit', 'boots',
  'scoutBoots', 'reinforcedBoots', 'assaultBoots', 'helmet', 'tacticalHelmet'])]) {
  const icon = fs.readFileSync(path.join(ROOT,
    'unity-client/Assets/Resources/RealmUi/items', `item_${id}.png`));
  assert(icon.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    `${id}: inventory art is not a PNG`);
  assert(icon.readUInt32BE(16) === 256 && icon.readUInt32BE(20) === 256,
    `${id}: inventory art is not a full-size rendered model`);
}
const server = read('server.js');
const itemData = read('unity-client/Assets/Scripts/Game/RoaItemData.cs');
const itemCategories = read('unity-client/Assets/Scripts/Game/RoaItemCategories.cs');
const craftingData = read('unity-client/Assets/Scripts/Game/RoaCraftingData.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const quickbar = read('unity-client/Assets/Scripts/Game/RoaQuickbar.cs');

assert(catalog.items.length >= 79, `expected the complete Kromka catalog, got ${catalog.items.length} items`);
assert(recipes.recipes.length >= 48, `expected the complete field recipe catalog, got ${recipes.recipes.length} recipes`);
assert.strictEqual(indexes.byId.silver.name, 'Марки Тракта');
assert.strictEqual(indexes.byId.blue.weight, 0.4);
assert.strictEqual(indexes.byId.artifactDetectorMk1.slot, 'detector');
assert.strictEqual(indexes.byId.artifactBelt2.slot, 'artifactBelt');
assert.strictEqual(indexes.byId.motorcycle.slot, 'vehicle');
assert.strictEqual(indexes.byId.fists.stackLimit, 0);

for (const item of catalog.items) {
  assert(Number.isFinite(item.weight) && item.weight >= 0, `${item.id}: invalid weight`);
  assert(Number.isInteger(item.basePrice) && item.basePrice >= 0, `${item.id}: invalid base price`);
  assert(item.category, `${item.id}: missing category`);
  assert(item.conditionMode, `${item.id}: missing condition mode`);
  assert(item.acquisition.length > 0, `${item.id}: missing acquisition route`);
  if (item.slot && item.id !== 'fists') {
    assert(item.compatibleSlots.length > 0, `${item.id}: missing equipment compatibility`);
  }
  if (item.conditionMode === 'runtime') {
    assert(item.ammoType && (throwableIds.has(item.id)
      ? item.modificationSlots.length === 0 : item.modificationSlots.length >= 3),
      `${item.id}: runtime weapon lacks magazine/modification identity`);
  }
}

for (const recipe of recipes.recipes) {
  assert(indexes.byId[recipe.output.id], `${recipe.id}: unknown output ${recipe.output.id}`);
  for (const inputId of Object.keys(recipe.inputs)) {
    assert(indexes.byId[inputId], `${recipe.id}: unknown input ${inputId}`);
  }
  assert(recipe.workSeconds >= 1, `${recipe.id}: work time is missing`);
  assert(recipe.silverFee >= 0, `${recipe.id}: invalid fee`);
  assert.strictEqual(recipeIndexes.outputs[recipe.id].id, recipe.output.id);
}

const artifactCatalog = json('data/artifacts.json');
for (const row of artifactCatalog.types || []) assert(indexes.byId[row.itemId], `unknown artifact item ${row.itemId}`);
for (const row of artifactCatalog.detectors || []) assert(indexes.byId[row.itemId], `unknown detector item ${row.itemId}`);
for (const row of artifactCatalog.belts || []) assert(indexes.byId[row.itemId], `unknown belt item ${row.itemId}`);

const traderCatalog = json('data/traders.json');
for (const [profileId, profile] of Object.entries(traderCatalog.profiles || {})) {
  for (const row of profile.stock || []) {
    assert(indexes.byId[row.id], `${profileId}: trader references unknown item ${row.id}`);
    assert(row.price > 0 && row.qty > 0, `${profileId}/${row.id}: invalid authored stock`);
  }
}

[
  "const SERVER_ITEM_IDS = new Set(Object.keys(KROMKA_ITEM_INDEXES.byId))",
  'const SERVER_ITEM_STACK_LIMITS = KROMKA_ITEM_INDEXES.stackLimits',
  'const SERVER_ITEM_WEIGHTS = KROMKA_ITEM_INDEXES.weights',
  'const SERVER_CRAFT_RECIPE_COSTS = KROMKA_FIELD_RECIPE_INDEXES.costs',
  'const SERVER_CRAFT_RECIPE_OUTPUTS = KROMKA_FIELD_RECIPE_INDEXES.outputs',
  'const SERVER_CRAFT_RECIPE_STATIONS = KROMKA_FIELD_RECIPE_INDEXES.stations',
  "app.get('/api/kromka/items'",
  'publicFieldRecipeCatalog(KROMKA_FIELD_RECIPE_CATALOG)',
  "serverCatalogItemIdsForSlot('detector', true)",
  "serverCatalogItemIdsForSlot('artifactBelt', true)"
].forEach(contract => assert(server.includes(contract), `server item authority is missing: ${contract}`));
assert(!server.includes('const SERVER_ITEM_WEIGHTS = {'), 'server still carries a second weight table');
assert(!server.includes('const SERVER_CRAFT_RECIPE_COSTS = {'), 'server still carries a second player recipe table');

[
  'public static bool ApplyCatalog(JObject catalog, out string error)',
  'public static int BasePrice(string itemOrRuntimeId)',
  'public static int StackLimit(string itemOrRuntimeId)',
  'public static string Category(string itemOrRuntimeId)'
].forEach(contract => assert(itemData.includes(contract), `Unity item catalog is missing: ${contract}`));
assert(itemCategories.includes('RoaItemData.Category(id)'), 'Unity categories do not use the authoritative item catalog');
assert(craftingData.includes('public static bool ApplyCatalog(JObject catalog, out string error)'),
  'Unity crafting does not consume the authored field recipes');
assert(bootstrap.includes('StartCoroutine(FetchItemCatalog())')
  && bootstrap.includes('RoaCraftingData.ApplyCatalog(fieldRecipes'),
  'Unity does not load both item and recipe catalogs');
assert(quickbar.includes('public const int SlotCount = 6;'), 'Unity quickbar is not fixed to six reference slots');

console.log(`KRM-17 item authority OK: ${catalog.items.length} items, ${recipes.recipes.length} field recipes, 9 equipment slots and 6 quick slots.`);
