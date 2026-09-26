'use strict';

// Тиры мира по образцу Albion: зона опасности N растит ресурсы и держит врагов
// только тира N, а оружие, броня и инструменты существуют во всех пяти тирах.
// Модуль разворачивает авторские данные (data/kromka/tiers.json, items.json,
// field-recipes.json) в полный каталог вариантов и считает прокачку профессий.

const TIER_COUNT = 5;
const TIERED_CATEGORIES = new Set(['weapons', 'armor', 'tools']);
const PROFESSION_KINDS = new Set(['gather', 'refine', 'craft']);
const CRAFT_LINES = new Set(['melee', 'firearms', 'heavy', 'throwing', 'armor', 'tools']);

function safeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function clampTier(value) {
  return Math.max(1, Math.min(TIER_COUNT, Math.round(Number(value) || 1)));
}

function tierArray(value, fallback, min, max) {
  const source = Array.isArray(value) ? value : [];
  return Object.freeze(Array.from({ length: TIER_COUNT }, (_, index) => finite(source[index], fallback, min, max)));
}

function normalizeMaterialRow(row = {}, familyId, kind) {
  const ids = (Array.isArray(row.ids) ? row.ids : []).map(safeId);
  const names = (Array.isArray(row.names) ? row.names : []).map(name => String(name || '').trim().slice(0, 96));
  if (ids.length !== TIER_COUNT || ids.some(id => !id) || new Set(ids).size !== TIER_COUNT) {
    throw new Error(`Kromka tier family ${familyId} needs ${TIER_COUNT} unique ${kind} ids`);
  }
  if (names.length !== TIER_COUNT || names.some(name => !name)) {
    throw new Error(`Kromka tier family ${familyId} needs ${TIER_COUNT} ${kind} names`);
  }
  return Object.freeze({
    ids: Object.freeze(ids),
    names: Object.freeze(names),
    weight: finite(row.weight, 1, 0, 100),
    basePrice: Math.max(0, Math.floor(finite(row.basePrice, 0, 0, 1e6))),
    stackLimit: Math.max(1, Math.floor(finite(row.stackLimit, 200, 1, 10000))),
    visual: safeId(row.visual)
  });
}

function normalizeTierConfig(raw = {}) {
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : []).map((row, index) => {
    if (Number(row?.tier) !== index + 1) throw new Error(`Kromka tiers must be listed 1..${TIER_COUNT} in order`);
    return Object.freeze({
      tier: index + 1,
      name: String(row.name || `T${index + 1}`).slice(0, 16),
      power: finite(row.power, 1, 0.1, 10),
      durability: finite(row.durability, 1, 0.1, 10),
      price: finite(row.price, 1, 0.1, 1000),
      modSlots: Math.floor(finite(row.modSlots, 4, 0, 8)),
      level: Math.floor(finite(row.level, 0, 0, 1000)),
      xp: Math.floor(finite(row.xp, 10, 0, 1e6))
    });
  });
  if (tiers.length !== TIER_COUNT) throw new Error(`Kromka tiers must define exactly ${TIER_COUNT} tiers`);

  const prof = raw.professions || {};
  const skills = (Array.isArray(prof.skills) ? prof.skills : []).map(row => {
    const id = safeId(row?.id);
    const kind = String(row?.kind || '');
    if (!id || !PROFESSION_KINDS.has(kind)) throw new Error(`Kromka profession ${id || '<empty>'} is invalid`);
    const line = kind === 'craft' ? String(row.line || '') : '';
    if (kind === 'craft' && !CRAFT_LINES.has(line)) throw new Error(`Kromka profession ${id} has an unknown craft line`);
    return Object.freeze({
      id, kind, line,
      family: kind === 'craft' ? '' : safeId(row.family),
      name: String(row.name || id).slice(0, 64)
    });
  });
  if (new Set(skills.map(row => row.id)).size !== skills.length) throw new Error('Kromka professions have duplicate ids');

  const families = (Array.isArray(raw.families) ? raw.families : []).map(row => {
    const id = safeId(row?.id);
    if (!id) throw new Error('Kromka tier family has no id');
    return Object.freeze({
      id,
      name: String(row.name || id).slice(0, 48),
      resourceType: safeId(row.resourceType),
      harvestTool: safeId(row.harvestTool),
      refineStation: safeId(row.refineStation),
      raw: normalizeMaterialRow(row.raw, id, 'raw'),
      refined: normalizeMaterialRow(row.refined, id, 'refined')
    });
  });
  if (!families.length) throw new Error('Kromka tiers define no resource families');
  for (const family of families) {
    for (const kind of ['gather', 'refine']) {
      if (!skills.some(skill => skill.kind === kind && skill.family === family.id)) {
        throw new Error(`Kromka tier family ${family.id} has no ${kind} profession`);
      }
    }
  }
  for (const line of CRAFT_LINES) {
    if (!skills.some(skill => skill.kind === 'craft' && skill.line === line)) {
      throw new Error(`Kromka craft line ${line} has no profession`);
    }
  }

  const refining = raw.refining || {};
  const hideDrops = raw.hideDrops || {};
  const locationTiers = {};
  for (const [key, value] of Object.entries(raw.locationTiers || {})) {
    const id = safeId(key);
    if (id && key !== 'note' && Number(value) >= 1) locationTiers[id] = clampTier(value);
  }
  const enemies = raw.enemies || {};
  const enemySpecies = {};
  for (const [key, row] of Object.entries(enemies.species || {})) {
    const id = safeId(key);
    const tiersOfSpecies = (Array.isArray(row?.tiers) ? row.tiers : []).map(clampTier);
    if (!id || !tiersOfSpecies.length) throw new Error(`Kromka enemy tier row ${key} is invalid`);
    enemySpecies[id] = Object.freeze({ baseTier: clampTier(row.baseTier), tiers: Object.freeze([...new Set(tiersOfSpecies)]) });
  }
  const qty = Array.isArray(hideDrops.qty) ? hideDrops.qty : [1, 2];
  return Object.freeze({
    schema: 'kromka.tiers.v1',
    version: Math.max(1, Math.floor(Number(raw.version || 1))),
    tiers: Object.freeze(tiers),
    professions: Object.freeze({
      maxLevel: Math.floor(finite(prof.maxLevel, 100, 1, 1000)),
      xpCurve: finite(prof.xpCurve, 25, 1, 1e6),
      gatherBonusPerLevel: finite(prof.gatherBonusPerLevel, 0, 0, 0.05),
      skills: Object.freeze(skills)
    }),
    families: Object.freeze(families),
    refining: Object.freeze({
      rawPerTier: tierArray(refining.rawPerTier, 2, 1, 50),
      previousRefined: Math.floor(finite(refining.previousRefined, 1, 0, 50)),
      silverFee: tierArray(refining.silverFee, 1, 0, 1000),
      workSeconds: tierArray(refining.workSeconds, 2, 1, 600),
      priceMarkup: finite(refining.priceMarkup, 1.1, 1, 5)
    }),
    locationTiers: Object.freeze(locationTiers),
    enemies: Object.freeze({
      hpExponent: finite(enemies.hpExponent, 1.5, 0, 5),
      attackExponent: finite(enemies.attackExponent, 1, 0, 5),
      xpExponent: finite(enemies.xpExponent, 2, 0, 5),
      species: Object.freeze(enemySpecies)
    }),
    hideDrops: Object.freeze({
      qty: Object.freeze([Math.floor(finite(qty[0], 1, 0, 50)), Math.floor(finite(qty[1], 2, 0, 50))]),
      species: Object.freeze((Array.isArray(hideDrops.species) ? hideDrops.species : []).map(safeId).filter(Boolean))
    })
  });
}

function tierRow(config, tier) {
  return config.tiers[clampTier(tier) - 1];
}

/** Отношение параметра тира `to` к параметру тира `from` (power, durability, price). */
function tierRatio(config, fromTier, toTier, key) {
  const from = Number(tierRow(config, fromTier)?.[key] || 1);
  const to = Number(tierRow(config, toTier)?.[key] || 1);
  return from > 0 ? to / from : 1;
}

/** id варианта: авторский тир сохраняет исходный id, остальные получают суффикс T<n>. */
function tierVariantId(baseId, tier, authoredTier) {
  const id = safeId(baseId);
  const n = clampTier(tier);
  return n === clampTier(authoredTier) ? id : `${id}T${n}`;
}

function materialItem(family, kind, tier, existing, basePrice) {
  const row = family[kind];
  const id = row.ids[tier - 1];
  const base = existing || {};
  return {
    ...base,
    id,
    name: row.names[tier - 1],
    weight: base.weight ?? row.weight,
    basePrice: tier === 1 && existing ? base.basePrice : basePrice,
    category: 'materials',
    stackLimit: base.stackLimit || row.stackLimit,
    conditionMode: 'none',
    acquisition: base.acquisition || (kind === 'raw' ? ['resource', 'trade', 'loot'] : ['craft', 'trade']),
    description: base.description || `${kind === 'raw' ? 'Сырьё' : 'Полуфабрикат'} семейства «${family.name}», тир ${tier}.`,
    tier,
    tierGroup: row.ids[0],
    family: family.id,
    materialKind: kind,
    ...(tier > 1 ? { variantOf: row.ids[0] } : {}),
    ...(row.visual && !existing ? { visualId: row.visual } : {})
  };
}

/**
 * Разворачивает авторский каталог предметов: семейства материалов T1–T5 и
 * варианты оружия, брони и инструментов во всех тирах. Возвращает сырой каталог
 * той же схемы — его затем проверяет normalizeItemCatalog.
 */
function expandItemCatalogSource(rawCatalog = {}, config) {
  const source = Array.isArray(rawCatalog?.items) ? rawCatalog.items : [];
  const byId = new Map(source.map(item => [safeId(item?.id), item]));
  const materialIds = new Set(config.families.flatMap(family => [...family.raw.ids, ...family.refined.ids]));
  const out = [];
  const emitted = new Set();
  const push = item => {
    if (emitted.has(item.id)) throw new Error(`Kromka tier expansion produced a duplicate id: ${item.id}`);
    emitted.add(item.id);
    out.push(item);
  };

  for (const item of source) {
    const id = safeId(item?.id);
    if (materialIds.has(id)) continue;
    const authoredTier = Number(item?.tier || 0);
    if (!TIERED_CATEGORIES.has(String(item?.category || '')) || id === 'fists' || !(authoredTier >= 1)) {
      push(item);
      continue;
    }
    const slots = Array.isArray(item.modificationSlots) ? item.modificationSlots : [];
    for (let tier = 1; tier <= TIER_COUNT; tier += 1) {
      const variantId = tierVariantId(id, tier, authoredTier);
      if (tier !== authoredTier && byId.has(variantId)) {
        throw new Error(`Kromka item ${variantId} collides with a generated tier variant`);
      }
      const variant = {
        ...item,
        id: variantId,
        tier,
        tierGroup: id,
        basePrice: tier === authoredTier
          ? item.basePrice
          : Math.max(1, Math.round(Number(item.basePrice || 0) * tierRatio(config, authoredTier, tier, 'price'))),
        // Младшие тиры открывают меньше слотов модулей; авторский тир и выше
        // сохраняют все свои слоты, чтобы уже поставленные модули не пропали.
        ...(item.modificationSlots ? {
          modificationSlots: tier >= authoredTier ? [...slots] : slots.slice(0, tierRow(config, tier).modSlots)
        } : {}),
        ...(tier === authoredTier ? {} : { variantOf: id })
      };
      push(variant);
    }
  }

  for (const family of config.families) {
    let previousRefinedPrice = 0;
    for (let tier = 1; tier <= TIER_COUNT; tier += 1) {
      const rawPrice = Math.max(1, Math.round(family.raw.basePrice * tierRatio(config, 1, tier, 'price')));
      const rawItem = materialItem(family, 'raw', tier, byId.get(family.raw.ids[tier - 1]), rawPrice);
      push(rawItem);
      const rawQty = config.refining.rawPerTier[tier - 1];
      const previous = tier > 1 ? config.refining.previousRefined * previousRefinedPrice : 0;
      const refinedPrice = Math.max(1, Math.round((rawQty * rawItem.basePrice + previous) * config.refining.priceMarkup));
      push(materialItem(family, 'refined', tier, byId.get(family.refined.ids[tier - 1]), refinedPrice));
      previousRefinedPrice = refinedPrice;
    }
  }
  // Облик варианта — облик исходного предмета: клиент ищет модель и иконку по visualId.
  const visualOf = new Map();
  const resolveVisual = item => {
    if (visualOf.has(item.id)) return visualOf.get(item.id);
    const parent = item.variantOf ? out.find(row => row.id === item.variantOf) : null;
    const visual = safeId(item.visualId) || (parent ? resolveVisual(parent) : '') || item.id;
    visualOf.set(item.id, visual);
    return visual;
  };
  for (const item of out) {
    const visual = resolveVisual(item);
    if (visual !== item.id) item.visualId = visual;
  }
  return { ...rawCatalog, items: out };
}

function professionForCraftLine(config, line) {
  return config.professions.skills.find(skill => skill.kind === 'craft' && skill.line === line) || null;
}

function professionForFamily(config, kind, familyId) {
  return config.professions.skills.find(skill => skill.kind === kind && skill.family === familyId) || null;
}

/**
 * Разворачивает рецепты. Рецепт с выходом из тиражируемой группы даёт пять
 * рецептов: ключ входа «$metal» становится полуфабрикатом семейства этого
 * тира, а авторская линия ремесла (line) задаёт профессию. Переработка сырья
 * в полуфабрикаты генерируется из семейств. itemIndex — развёрнутые предметы по id.
 */
function expandFieldRecipeSource(rawRecipes = {}, itemIndex = {}, config) {
  const families = new Map(config.families.map(family => [family.id, family]));
  const out = [];
  for (const recipe of Array.isArray(rawRecipes?.recipes) ? rawRecipes.recipes : []) {
    const outputId = safeId(recipe?.output?.id);
    const output = itemIndex[outputId];
    const placeholders = Object.keys(recipe?.inputs || {}).filter(key => key.startsWith('$'));
    if (!output?.tierGroup || output.materialKind) {
      if (placeholders.length) throw new Error(`Kromka recipe ${recipe.id} uses family inputs for an untiered output`);
      out.push(recipe);
      continue;
    }
    const authoredTier = Number(output.tier || 1);
    const profession = professionForCraftLine(config, String(recipe.line || ''));
    if (!profession) throw new Error(`Kromka recipe ${recipe.id} has no craft line`);
    for (let tier = 1; tier <= TIER_COUNT; tier += 1) {
      const inputs = {};
      for (const [key, qty] of Object.entries(recipe.inputs || {})) {
        let itemId = key;
        if (key.startsWith('$')) {
          const family = families.get(key.slice(1));
          if (!family) throw new Error(`Kromka recipe ${recipe.id} references unknown family ${key}`);
          itemId = family.refined.ids[tier - 1];
        }
        inputs[itemId] = (inputs[itemId] || 0) + qty;
      }
      const costRatio = Math.sqrt(tierRatio(config, authoredTier, tier, 'price'));
      const { line: _line, ...authored } = recipe;
      out.push({
        ...authored,
        id: tierVariantId(recipe.id, tier, authoredTier),
        inputs,
        silverFee: Math.max(1, Math.round(Number(recipe.silverFee || 1) * costRatio)),
        workSeconds: Math.max(1, Math.round(Number(recipe.workSeconds || 1) * Math.sqrt(costRatio))),
        output: { ...recipe.output, id: tierVariantId(output.tierGroup, tier, authoredTier) },
        tier,
        recipeGroup: safeId(recipe.id),
        profession: profession.id,
        level: tierRow(config, tier).level
      });
    }
  }
  for (const family of config.families) {
    const profession = professionForFamily(config, 'refine', family.id);
    for (let tier = 1; tier <= TIER_COUNT; tier += 1) {
      const refinedId = family.refined.ids[tier - 1];
      const inputs = { [family.raw.ids[tier - 1]]: config.refining.rawPerTier[tier - 1] };
      if (tier > 1 && config.refining.previousRefined > 0) {
        inputs[family.refined.ids[tier - 2]] = config.refining.previousRefined;
      }
      out.push({
        id: `${refinedId}refine`,
        name: family.refined.names[tier - 1],
        station: family.refineStation,
        inputs,
        silverFee: config.refining.silverFee[tier - 1],
        workSeconds: config.refining.workSeconds[tier - 1],
        output: { id: refinedId, qty: 1 },
        tier,
        recipeGroup: `${family.refined.ids[0]}refine`,
        profession: profession.id,
        level: tierRow(config, tier).level
      });
    }
  }
  return { ...rawRecipes, recipes: out };
}

/**
 * Цена тиражируемого изделия не ниже стоимости его материалов: иначе высокий
 * тир, собранный из цепочки полуфабрикатов, продавался бы дешевле сырья.
 * Материалы оцениваются по базовой цене, серебро — по номиналу.
 */
function priceTieredItemsFromRecipes(rawCatalog = {}, rawRecipes = {}, config) {
  const items = Array.isArray(rawCatalog?.items) ? rawCatalog.items : [];
  const byId = new Map(items.map(item => [item.id, item]));
  const markup = config.refining.priceMarkup;
  const costOf = new Map();
  for (const recipe of Array.isArray(rawRecipes?.recipes) ? rawRecipes.recipes : []) {
    const output = byId.get(recipe?.output?.id);
    if (!output?.tierGroup || output.materialKind || !recipe.tier) continue;
    let cost = 0;
    for (const [id, qty] of Object.entries(recipe.inputs || {})) {
      cost += (id === 'silver' ? 1 : Number(byId.get(id)?.basePrice || 0)) * Number(qty || 0);
    }
    cost = cost / Math.max(1, Number(recipe.output.qty || 1)) + Number(recipe.silverFee || 0);
    costOf.set(output.id, Math.max(costOf.get(output.id) || 0, cost));
  }
  return {
    ...rawCatalog,
    items: items.map(item => {
      const cost = costOf.get(item.id);
      if (!cost) return item;
      const floor = Math.round(cost * markup);
      return floor > Number(item.basePrice || 0) ? { ...item, basePrice: floor } : item;
    })
  };
}

// --- волокно в зонах --------------------------------------------------------------------------

const FIBER_PREFAB = 'dry_bush';
const FIBER_EVERY = 20;
const FIBER_HP = 4;

function stableHash(text = '') {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Сухие кусты зоны — точки сбора волокна: каждый FIBER_EVERY-й по устойчивому
 * хэшу id. Выбор детерминирован, поэтому сервер и клиент видят те же кусты.
 */
function designateFiberNodes(definition = {}) {
  if (!Array.isArray(definition.objects)) return definition;
  const objects = definition.objects.map(row => {
    const prefab = String(row?.prefab || row?.model || '');
    if (prefab !== FIBER_PREFAB || row.resourceType || stableHash(String(row.id || '')) % FIBER_EVERY !== 0) return row;
    const tags = Array.isArray(row.tags) ? row.tags : [];
    return {
      ...row,
      resourceType: 'fiber',
      hp: FIBER_HP,
      maxHp: FIBER_HP,
      tags: [...new Set([...tags, 'resource', 'fiber'])]
    };
  });
  return { ...definition, objects };
}

// --- боевые параметры вариантов ------------------------------------------------------------

/** Оружие тира `toTier` из авторского описания тира `fromTier`: урон растёт по power. */
function scaleWeaponForTier(weapon = {}, config, fromTier, toTier, variantId) {
  const ratio = tierRatio(config, fromTier, toTier, 'power');
  const dmg = Array.isArray(weapon.dmg) ? weapon.dmg : [0, 0];
  return {
    ...weapon,
    id: variantId,
    tier: clampTier(toTier),
    dmg: [Math.max(1, Math.round(dmg[0] * ratio)), Math.max(1, Math.round(dmg[1] * ratio))]
  };
}

/** Броня тира `toTier`: доля защиты и пороги растут по power. */
function scaleArmorForTier(armor = {}, config, fromTier, toTier) {
  const ratio = tierRatio(config, fromTier, toTier, 'power');
  const protection = {};
  for (const [type, value] of Object.entries(armor.protection || {})) {
    protection[type] = Math.round(Math.min(0.6, Number(value || 0) * ratio) * 1000) / 1000;
  }
  const thresholds = {};
  for (const [type, value] of Object.entries(armor.thresholds || {})) {
    thresholds[type] = Math.max(0, Math.round(Number(value || 0) * ratio));
  }
  return { ...armor, protection, thresholds };
}

/**
 * Множители врага вида `speciesId` в зоне тира `zoneTier` относительно его
 * базового тира: здоровье, урон и опыт растут вместе с силой снаряжения игроков.
 * Ниже базового тира вид не слабеет — авторская расстановка сильных видов цела.
 */
function enemyTierScale(config, speciesId, zoneTier) {
  const row = config.enemies.species[safeId(speciesId)];
  if (!row) return { tier: clampTier(zoneTier), hp: 1, attack: 1, xp: 1 };
  const ratio = Math.max(1, tierRatio(config, row.baseTier, zoneTier, 'power'));
  return {
    tier: clampTier(zoneTier),
    hp: Math.pow(ratio, config.enemies.hpExponent),
    attack: Math.pow(ratio, config.enemies.attackExponent),
    xp: Math.pow(ratio, config.enemies.xpExponent)
  };
}

/** Живёт ли вид в зонах этого тира (логова и группы A-Life). Неизвестный вид — везде. */
function speciesLivesInTier(config, speciesId, tier) {
  const row = config.enemies.species[safeId(speciesId)];
  return !row || row.tiers.includes(clampTier(tier));
}

/** Множитель износа предмета: стойкие высокие тиры изнашиваются медленнее. */
function tierWearMultiplier(config, tier) {
  const durability = Number(tierRow(config, tier)?.durability || 1);
  return durability > 0 ? 1 / durability : 1;
}

// --- профессии -------------------------------------------------------------------------------

function professionLevel(config, xp = 0) {
  const value = Math.max(0, Number(xp) || 0);
  return Math.min(config.professions.maxLevel, Math.floor(Math.sqrt(value / config.professions.xpCurve)));
}

function professionXpForLevel(config, level = 0) {
  const n = Math.max(0, Math.min(config.professions.maxLevel, Math.floor(Number(level) || 0)));
  return Math.ceil(config.professions.xpCurve * n * n);
}

function sanitizeProfessionXp(config, raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const cap = professionXpForLevel(config, config.professions.maxLevel);
  const out = {};
  for (const skill of config.professions.skills) {
    const value = Math.floor(Number(source[skill.id] || 0));
    if (value > 0) out[skill.id] = Math.min(cap, value);
  }
  return out;
}

/** Старший тир, открытый уровнем профессии. */
function professionMaxTier(config, xp = 0) {
  const level = professionLevel(config, xp);
  let max = 1;
  for (const row of config.tiers) if (level >= row.level) max = row.tier;
  return max;
}

function professionAllowsTier(config, xp = 0, tier = 1) {
  return professionLevel(config, xp) >= tierRow(config, tier).level;
}

/** Опыт за единицу работы тира (добытая единица, переработка, изделие). */
function professionXpForWork(config, tier = 1, units = 1) {
  return Math.max(0, Math.round(tierRow(config, tier).xp * Math.max(0, Number(units) || 0)));
}

/** Начисляет опыт профессии в словарь xp; возвращает сводку для ответа клиенту. */
function grantProfessionXp(config, xpMap, skillId, amount) {
  const skill = config.professions.skills.find(row => row.id === skillId);
  if (!skill || !xpMap || typeof xpMap !== 'object') return null;
  const before = Math.max(0, Math.floor(Number(xpMap[skillId] || 0)));
  const cap = professionXpForLevel(config, config.professions.maxLevel);
  const after = Math.min(cap, before + Math.max(0, Math.floor(Number(amount) || 0)));
  xpMap[skillId] = after;
  const levelBefore = professionLevel(config, before);
  const level = professionLevel(config, after);
  return { id: skillId, name: skill.name, gained: after - before, xp: after, level, leveledUp: level > levelBefore };
}

/** Шанс лишней единицы добычи от уровня профессии. */
function professionGatherBonus(config, xp = 0) {
  return professionLevel(config, xp) * config.professions.gatherBonusPerLevel;
}

function publicProfessions(config, xpMap = {}) {
  return config.professions.skills.map(skill => {
    const xp = Math.max(0, Math.floor(Number(xpMap?.[skill.id] || 0)));
    const level = professionLevel(config, xp);
    return {
      id: skill.id,
      kind: skill.kind,
      family: skill.family,
      line: skill.line,
      name: skill.name,
      xp,
      level,
      levelXp: professionXpForLevel(config, level),
      nextLevelXp: level >= config.professions.maxLevel ? xp : professionXpForLevel(config, level + 1),
      maxTier: professionMaxTier(config, xp)
    };
  });
}

function publicTierConfig(config) {
  return {
    schema: config.schema,
    version: config.version,
    tiers: config.tiers.map(row => ({ ...row })),
    professions: {
      maxLevel: config.professions.maxLevel,
      skills: config.professions.skills.map(row => ({ ...row }))
    },
    families: config.families.map(family => ({
      id: family.id,
      name: family.name,
      resourceType: family.resourceType,
      harvestTool: family.harvestTool,
      raw: [...family.raw.ids],
      refined: [...family.refined.ids]
    }))
  };
}

/**
 * Полные каталоги игры из авторских файлов: предметы и рецепты во всех тирах.
 * Этот же путь проходят сервер и проверки, поэтому они видят одни и те же ряды.
 */
function buildTieredCatalogs({ items = {}, recipes = {}, tiers = {} } = {}) {
  const { normalizeItemCatalog, normalizeFieldRecipeCatalog } = require('./kromka-items');
  const config = normalizeTierConfig(tiers);
  const itemSource = expandItemCatalogSource(items, config);
  const recipeSource = expandFieldRecipeSource(recipes, Object.fromEntries(itemSource.items.map(item => [item.id, item])), config);
  const itemCatalog = normalizeItemCatalog(priceTieredItemsFromRecipes(itemSource, recipeSource, config));
  const recipeCatalog = normalizeFieldRecipeCatalog(recipeSource, itemCatalog);
  return { config, itemCatalog, recipeCatalog };
}

/** То же из каталога data/kromka репозитория (или другого data-каталога). */
function readTieredCatalogs(dataDir) {
  const fs = require('fs');
  const path = require('path');
  const json = name => JSON.parse(fs.readFileSync(path.join(dataDir, 'kromka', name), 'utf8'));
  return buildTieredCatalogs({ items: json('items.json'), recipes: json('field-recipes.json'), tiers: json('tiers.json') });
}

module.exports = {
  TIER_COUNT,
  buildTieredCatalogs,
  readTieredCatalogs,
  normalizeTierConfig,
  tierRow,
  tierRatio,
  tierVariantId,
  expandItemCatalogSource,
  expandFieldRecipeSource,
  priceTieredItemsFromRecipes,
  designateFiberNodes,
  professionForCraftLine,
  professionForFamily,
  scaleWeaponForTier,
  scaleArmorForTier,
  tierWearMultiplier,
  enemyTierScale,
  speciesLivesInTier,
  professionLevel,
  professionXpForLevel,
  sanitizeProfessionXp,
  professionMaxTier,
  professionAllowsTier,
  professionXpForWork,
  grantProfessionXp,
  professionGatherBonus,
  publicProfessions,
  publicTierConfig
};
