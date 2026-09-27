'use strict';

const ALLOWED_CATEGORIES = new Set([
  'weapons', 'armor', 'aid', 'ammo', 'tools', 'materials', 'misc',
  'currency', 'strategic', 'artifacts'
]);
const ALLOWED_SLOTS = new Set([
  '', 'weapon', 'offhand', 'armor', 'helmet', 'boots', 'backpack',
  'detector', 'artifactBelt', 'artifact', 'vehicle'
]);
const ALLOWED_CONDITION_MODES = new Set(['none', 'shared', 'runtime']);
const ALLOWED_ACQUISITION = new Set([
  'intrinsic', 'craft', 'trade', 'loot', 'resource', 'reward', 'quest', 'anomaly'
]);

function safeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function uniqueSafeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(safeId).filter(Boolean))];
}

function normalizeItemCatalog(raw = {}) {
  const source = Array.isArray(raw?.items) ? raw.items : [];
  const items = [];
  const ids = new Set();
  for (const input of source) {
    const id = safeId(input?.id);
    if (!id || ids.has(id)) throw new Error(`Kromka item catalog has an invalid or duplicate id: ${id || '<empty>'}`);
    const name = String(input?.name || '').trim().slice(0, 96);
    const weight = Number(input?.weight);
    const basePrice = Math.max(0, Math.floor(Number(input?.basePrice || 0)));
    const category = String(input?.category || '').trim();
    const slot = String(input?.slot || '').trim();
    const conditionMode = String(input?.conditionMode || 'none').trim();
    const stackLimit = Math.max(0, Math.floor(Number(input?.stackLimit || 0)));
    const tier = Number(input?.tier ?? 0);
    if (!name) throw new Error(`Kromka item ${id} has no display name`);
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`Kromka item ${id} has an invalid weight`);
    if (!ALLOWED_CATEGORIES.has(category)) throw new Error(`Kromka item ${id} has an invalid category: ${category}`);
    if (!ALLOWED_SLOTS.has(slot)) throw new Error(`Kromka item ${id} has an invalid slot: ${slot}`);
    if (!ALLOWED_CONDITION_MODES.has(conditionMode)) throw new Error(`Kromka item ${id} has an invalid condition mode: ${conditionMode}`);
    if (!Number.isInteger(tier) || tier < 0 || tier > 5) throw new Error(`Kromka item ${id} has an invalid tier`);
    if (id !== 'fists' && stackLimit < 1) throw new Error(`Kromka item ${id} has no stack capacity`);
    const acquisition = uniqueSafeIds(input?.acquisition);
    if (!acquisition.length || acquisition.some(value => !ALLOWED_ACQUISITION.has(value))) {
      throw new Error(`Kromka item ${id} has an invalid acquisition route`);
    }
    const compatibleSlots = uniqueSafeIds(input?.compatibleSlots);
    if (compatibleSlots.some(value => !ALLOWED_SLOTS.has(value))) {
      throw new Error(`Kromka item ${id} has an invalid compatible slot`);
    }
    items.push(Object.freeze({
      id,
      name,
      description: String(input?.description || '').trim().slice(0, 240),
      tier,
      weight: Number(weight.toFixed(3)),
      basePrice,
      category,
      stackLimit,
      slot,
      compatibleSlots,
      conditionMode,
      ammoType: safeId(input?.ammoType),
      hands: Math.max(0, Math.min(2, Math.floor(Number(input?.hands || 0)))),
      harvestTool: safeId(input?.harvestTool),
      modificationSlots: uniqueSafeIds(input?.modificationSlots),
      acquisition,
      // Тиры (src/server/kromka-tiers.js): группа вариантов, исходный предмет
      // варианта, семейство материала и облик, по которому клиент ищет модель.
      tierGroup: safeId(input?.tierGroup),
      variantOf: safeId(input?.variantOf),
      family: safeId(input?.family),
      materialKind: safeId(input?.materialKind),
      visualId: safeId(input?.visualId)
    }));
    ids.add(id);
  }
  if (!items.length) throw new Error('Kromka item catalog is empty');
  for (const item of items) {
    if (item.ammoType && !ids.has(item.ammoType)) throw new Error(`Kromka item ${item.id} references unknown ammo ${item.ammoType}`);
    if (item.variantOf && !ids.has(item.variantOf)) throw new Error(`Kromka item ${item.id} is a variant of unknown ${item.variantOf}`);
  }
  return Object.freeze({
    schema: String(raw?.schema || 'kromka.items.v1'),
    version: Math.max(1, Math.floor(Number(raw?.version || 1))),
    items: Object.freeze(items)
  });
}

function itemCatalogIndexes(catalog = {}) {
  const byId = Object.create(null);
  const weights = Object.create(null);
  const stackLimits = Object.create(null);
  const basePrices = Object.create(null);
  const categories = Object.create(null);
  for (const item of Array.isArray(catalog?.items) ? catalog.items : []) {
    byId[item.id] = item;
    weights[item.id] = item.weight;
    stackLimits[item.id] = item.stackLimit;
    basePrices[item.id] = item.basePrice;
    categories[item.id] = item.category;
  }
  return {
    byId: Object.freeze(byId),
    weights: Object.freeze(weights),
    stackLimits: Object.freeze(stackLimits),
    basePrices: Object.freeze(basePrices),
    categories: Object.freeze(categories)
  };
}

function publicItemCatalog(catalog = {}) {
  return {
    schema: String(catalog?.schema || 'kromka.items.v1'),
    version: Math.max(1, Math.floor(Number(catalog?.version || 1))),
    items: (Array.isArray(catalog?.items) ? catalog.items : []).map(item => ({ ...item }))
  };
}

function normalizeFieldRecipeCatalog(raw = {}, itemCatalog = {}) {
  const itemIds = new Set((Array.isArray(itemCatalog?.items) ? itemCatalog.items : []).map(row => row.id));
  const recipes = [];
  const ids = new Set();
  for (const input of Array.isArray(raw?.recipes) ? raw.recipes : []) {
    const id = safeId(input?.id);
    const station = safeId(input?.station);
    const outputId = safeId(input?.output?.id);
    const outputQty = Math.max(1, Math.floor(Number(input?.output?.qty || 1)));
    if (!id || ids.has(id)) throw new Error(`Kromka field recipe has an invalid or duplicate id: ${id || '<empty>'}`);
    if (!station || !itemIds.has(outputId)) throw new Error(`Kromka field recipe ${id} has an invalid station or output`);
    const inputs = {};
    for (const [rawId, rawQty] of Object.entries(input?.inputs || {})) {
      const itemId = safeId(rawId);
      const qty = Math.max(0, Math.floor(Number(rawQty || 0)));
      if (!itemIds.has(itemId) || qty < 1) throw new Error(`Kromka field recipe ${id} has an invalid input: ${itemId}`);
      inputs[itemId] = qty;
    }
    if (!Object.keys(inputs).length) throw new Error(`Kromka field recipe ${id} has no inputs`);
    recipes.push(Object.freeze({
      id,
      name: String(input?.name || outputId).trim().slice(0, 96),
      station,
      inputs: Object.freeze(inputs),
      silverFee: Math.max(0, Math.floor(Number(input?.silverFee || 0))),
      workSeconds: Math.max(1, Math.floor(Number(input?.workSeconds || 1))),
      output: Object.freeze({ id: outputId, qty: outputQty }),
      // Тир рецепта, группа его вариантов, профессия и уровень доступа.
      tier: Math.max(0, Math.min(5, Math.floor(Number(input?.tier || 0)))),
      recipeGroup: safeId(input?.recipeGroup),
      profession: safeId(input?.profession),
      level: Math.max(0, Math.floor(Number(input?.level || 0)))
    }));
    ids.add(id);
  }
  if (!recipes.length) throw new Error('Kromka field recipe catalog is empty');
  return Object.freeze({
    schema: String(raw?.schema || 'kromka.fieldRecipes.v1'),
    version: Math.max(1, Math.floor(Number(raw?.version || 1))),
    recipes: Object.freeze(recipes)
  });
}

function fieldRecipeCatalogIndexes(catalog = {}) {
  const costs = Object.create(null);
  const outputs = Object.create(null);
  const stations = Object.create(null);
  const byId = Object.create(null);
  for (const recipe of Array.isArray(catalog?.recipes) ? catalog.recipes : []) {
    byId[recipe.id] = recipe;
    costs[recipe.id] = recipe.inputs;
    outputs[recipe.id] = recipe.output;
    stations[recipe.id] = recipe.station;
  }
  return {
    byId: Object.freeze(byId),
    costs: Object.freeze(costs),
    outputs: Object.freeze(outputs),
    stations: Object.freeze(stations)
  };
}

function publicFieldRecipeCatalog(catalog = {}) {
  return {
    schema: String(catalog?.schema || 'kromka.fieldRecipes.v1'),
    version: Math.max(1, Math.floor(Number(catalog?.version || 1))),
    recipes: (Array.isArray(catalog?.recipes) ? catalog.recipes : []).map(recipe => ({
      ...recipe,
      inputs: { ...recipe.inputs },
      output: { ...recipe.output }
    }))
  };
}

module.exports = {
  ALLOWED_CATEGORIES,
  ALLOWED_CONDITION_MODES,
  ALLOWED_SLOTS,
  fieldRecipeCatalogIndexes,
  itemCatalogIndexes,
  normalizeFieldRecipeCatalog,
  normalizeItemCatalog,
  publicFieldRecipeCatalog,
  publicItemCatalog
};
