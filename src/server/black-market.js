'use strict';

/**
 * Чёрный рынок экономики v3 (библия 14.5, KRM-22): единственный скупщик
 * снаряжения игроков и единственный источник снаряжения в добыче NPC.
 *
 * - Рынок только покупает и платит из казны. Казну пополняет доля марок,
 *   которые иначе выпали бы с NPC, поэтому новых марок он не создаёт.
 * - Купленное лежит на складе по полосам ценности; убитый NPC с бюджетом
 *   добычи забирает со склада предмет своей полосы (первым пришёл — первым
 *   выпал). Нет предмета — растёт цена скупки этой полосы.
 * - Каждая продажа слегка сбивает цену полосы, со временем цены возвращаются к
 *   норме, а часть дешёвого склада рынок уничтожает («продажный скупщик»).
 *
 * Модуль не знает о сервере: цены предметов и случайность передаются снаружи.
 */

const BLACK_MARKET_VERSION = 1;

const DEFAULT_CONFIG = Object.freeze({
  service: 'blackMarket',
  hubLocationId: 'coreMarket',
  categories: Object.freeze(['weapons', 'armor']),
  treasuryShare: 0.2,
  startingTreasury: 3000,
  priceShare: 0.45,
  // Самая низкая цена NPC-торговца — 0,5625 базы: полку сервер не опускает ниже
  // 0,75 базы (SERVER_TRADE_SHELF_FLOOR_SHARE), наибольшая скидка — 0,25.
  npcResaleCapShare: 0.55,
  minCondition: 10,
  bands: Object.freeze([
    Object.freeze({ id: 'cheap', maxValue: 20 }),
    Object.freeze({ id: 'common', maxValue: 60 }),
    Object.freeze({ id: 'good', maxValue: 150 }),
    Object.freeze({ id: 'rare', maxValue: 400 }),
    Object.freeze({ id: 'elite', maxValue: 1000000 })
  ]),
  demandStep: 0.04,
  supplyStep: 0.01,
  minMultiplier: 0.6,
  maxMultiplier: 2.5,
  relaxPerHour: 0.02,
  maxStockPerItem: 60,
  dropChance: 0.3,
  budgetPerXp: 2,
  minBudget: 15,
  corruptSharePerDay: 0.1,
  corruptBands: Object.freeze(['cheap']),
  fatigue: Object.freeze({ windowMinutes: 20, freeKills: 30, perKill: 0.02, minFactor: 0.4 })
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeId(value = '', limit = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function normalizeBlackMarketConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const bandsSrc = Array.isArray(src.bands) && src.bands.length ? src.bands : DEFAULT_CONFIG.bands;
  const bands = bandsSrc
    .map(row => ({ id: safeId(row?.id), maxValue: finite(row?.maxValue, 0, 1, 1e9) }))
    .filter(row => row.id && row.maxValue > 0)
    .sort((a, b) => a.maxValue - b.maxValue);
  const fatigueSrc = src.fatigue && typeof src.fatigue === 'object' ? src.fatigue : {};
  const minMultiplier = finite(src.minMultiplier, DEFAULT_CONFIG.minMultiplier, 0.05, 1);
  const categories = Array.isArray(src.categories) && src.categories.length ? src.categories : DEFAULT_CONFIG.categories;
  return Object.freeze({
    service: safeId(src.service || DEFAULT_CONFIG.service, 32),
    hubLocationId: safeId(src.hubLocationId || DEFAULT_CONFIG.hubLocationId),
    categories: Object.freeze(categories.map(value => safeId(value, 32)).filter(Boolean)),
    treasuryShare: finite(src.treasuryShare, DEFAULT_CONFIG.treasuryShare, 0, 1),
    startingTreasury: Math.floor(finite(src.startingTreasury, DEFAULT_CONFIG.startingTreasury, 0, 1e9)),
    priceShare: finite(src.priceShare, DEFAULT_CONFIG.priceShare, 0.01, 5),
    npcResaleCapShare: finite(src.npcResaleCapShare, DEFAULT_CONFIG.npcResaleCapShare, 0, 5),
    minCondition: finite(src.minCondition, DEFAULT_CONFIG.minCondition, 0, 100),
    bands: Object.freeze(bands.length ? bands.map(Object.freeze) : DEFAULT_CONFIG.bands),
    demandStep: finite(src.demandStep, DEFAULT_CONFIG.demandStep, 0, 1),
    supplyStep: finite(src.supplyStep, DEFAULT_CONFIG.supplyStep, 0, 1),
    minMultiplier,
    maxMultiplier: finite(src.maxMultiplier, DEFAULT_CONFIG.maxMultiplier, Math.max(1, minMultiplier), 20),
    relaxPerHour: finite(src.relaxPerHour, DEFAULT_CONFIG.relaxPerHour, 0, 1),
    maxStockPerItem: Math.floor(finite(src.maxStockPerItem, DEFAULT_CONFIG.maxStockPerItem, 1, 10000)),
    dropChance: finite(src.dropChance, DEFAULT_CONFIG.dropChance, 0, 1),
    budgetPerXp: finite(src.budgetPerXp, DEFAULT_CONFIG.budgetPerXp, 0, 1000),
    minBudget: finite(src.minBudget, DEFAULT_CONFIG.minBudget, 0, 1e6),
    corruptSharePerDay: finite(src.corruptSharePerDay, DEFAULT_CONFIG.corruptSharePerDay, 0, 1),
    corruptBands: Object.freeze((Array.isArray(src.corruptBands) ? src.corruptBands : DEFAULT_CONFIG.corruptBands)
      .map(value => safeId(value)).filter(Boolean)),
    fatigue: Object.freeze({
      windowMinutes: finite(fatigueSrc.windowMinutes, DEFAULT_CONFIG.fatigue.windowMinutes, 1, 1440),
      freeKills: Math.floor(finite(fatigueSrc.freeKills, DEFAULT_CONFIG.fatigue.freeKills, 0, 100000)),
      perKill: finite(fatigueSrc.perKill, DEFAULT_CONFIG.fatigue.perKill, 0, 1),
      minFactor: finite(fatigueSrc.minFactor, DEFAULT_CONFIG.fatigue.minFactor, 0, 1)
    })
  });
}

function bandIndex(config, value) {
  const amount = Math.max(0, Number(value) || 0);
  const index = config.bands.findIndex(band => amount <= band.maxValue);
  return index < 0 ? config.bands.length - 1 : index;
}

function normalizeBlackMarketState(raw = {}, config = normalizeBlackMarketConfig(), now = Date.now()) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const bandsSrc = src.bands && typeof src.bands === 'object' ? src.bands : {};
  const bands = {};
  for (const band of config.bands) {
    const row = bandsSrc[band.id] && typeof bandsSrc[band.id] === 'object' ? bandsSrc[band.id] : {};
    bands[band.id] = {
      multiplier: finite(row.multiplier, 1, config.minMultiplier, config.maxMultiplier),
      unmet: Math.max(0, Math.floor(Number(row.unmet) || 0)),
      sold: Math.max(0, Math.floor(Number(row.sold) || 0))
    };
  }
  const stock = {};
  const stockSrc = src.stock && typeof src.stock === 'object' ? src.stock : {};
  for (const [rawId, rows] of Object.entries(stockSrc)) {
    const id = safeId(rawId);
    if (!id || !Array.isArray(rows)) continue;
    const clean = rows
      .map(row => ({ c: finite(row?.c, 100, 1, 100), t: Math.max(0, Math.floor(Number(row?.t) || 0)) }))
      .slice(-config.maxStockPerItem);
    if (clean.length) stock[id] = clean;
  }
  return {
    version: BLACK_MARKET_VERSION,
    treasury: Math.max(0, Math.floor(Number.isFinite(Number(src.treasury)) ? Number(src.treasury) : config.startingTreasury)),
    bands,
    stock,
    destroyed: Math.max(0, Math.floor(Number(src.destroyed) || 0)),
    dropped: Math.max(0, Math.floor(Number(src.dropped) || 0)),
    lastDecayAt: Math.max(0, Math.floor(Number.isFinite(Number(src.lastDecayAt)) ? Number(src.lastDecayAt) : Number(now) || 0))
  };
}

/**
 * Цена скупки одной единицы: база × доля × множитель полосы × состояние.
 * capShare > 0 ограничивает цену целого предмета долей базы — пока в мире
 * есть NPC-торговцы, скупщик не должен платить больше их самой низкой цены.
 */
function blackMarketUnitPrice(state, config, basePrice = 0, condition = 100, capShare = 0) {
  const base = Math.max(0, Number(basePrice) || 0);
  if (base <= 0) return 0;
  const band = config.bands[bandIndex(config, base)];
  const multiplier = Number(state?.bands?.[band.id]?.multiplier || 1);
  const conditionFactor = Math.min(1, Math.max(0.1, (Number(condition) || 0) / 100));
  const cap = Number(capShare) > 0 ? base * Number(capShare) : Infinity;
  return Math.max(1, Math.floor(Math.min(base * config.priceShare * multiplier, cap) * conditionFactor));
}

/**
 * Смета продажи. rows: { id, qty, conditions?: number[] } — у экземплярного
 * оружия своё состояние на каждую единицу, у остального одно на базовый id.
 * accepts(id) решает, скупает ли рынок такой предмет.
 */
function quoteBlackMarketSale(state, config, rows = [], priceOf = () => 0, accepts = () => true, capShare = 0) {
  const lines = [];
  let total = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = safeId(row?.id);
    const qty = Math.max(0, Math.floor(Number(row?.qty) || 0));
    if (!id || qty <= 0) continue;
    if (!accepts(id)) return { ok: false, error: 'Скупщик берёт только оружие и броню.', itemId: id };
    const conditions = Array.from({ length: qty }, (_, index) => finite(
      Array.isArray(row.conditions) ? row.conditions[index] ?? row.condition : row.condition, 100, 1, 100
    ));
    if (conditions.some(value => value < config.minCondition)) {
      return { ok: false, error: `Скупщик не берёт вещи с состоянием ниже ${config.minCondition}%.`, itemId: id };
    }
    const units = conditions.map(value => blackMarketUnitPrice(state, config, priceOf(id), value, capShare));
    if (units.some(value => value <= 0)) return { ok: false, error: 'У этого предмета нет цены скупки.', itemId: id };
    const sum = units.reduce((acc, value) => acc + value, 0);
    lines.push({ id, qty, conditions, units, total: sum });
    total += sum;
  }
  return { ok: true, total, lines };
}

/** Продажа по готовой смете: казна платит, предметы ложатся на склад. */
function applyBlackMarketSale(state, config, quote, priceOf = () => 0, now = Date.now()) {
  if (!quote?.ok) return { ok: false, error: quote?.error || 'Сделка не собрана.' };
  if (state.treasury < quote.total) {
    return { ok: false, error: 'У скупщика сейчас не хватает марок. Загляните позже.' };
  }
  state.treasury -= quote.total;
  let destroyed = 0;
  for (const line of quote.lines) {
    const band = config.bands[bandIndex(config, priceOf(line.id))];
    const bandState = state.bands[band.id];
    const rows = state.stock[line.id] || (state.stock[line.id] = []);
    for (const condition of line.conditions) {
      rows.push({ c: condition, t: now });
      bandState.sold += 1;
      bandState.multiplier = Math.max(config.minMultiplier, bandState.multiplier - config.supplyStep);
    }
    if (rows.length > config.maxStockPerItem) {
      // Сверх вместимости скупщик оставляет себе лишнее: предметы уходят из мира.
      destroyed += rows.length - config.maxStockPerItem;
      rows.splice(0, rows.length - config.maxStockPerItem);
    }
  }
  state.destroyed += destroyed;
  return { ok: true, paid: quote.total, destroyed };
}

/** Доля марок убитого NPC уходит в казну. Возвращает, сколько марок осталось в трупе. */
function fundBlackMarket(state, config, marks = 0) {
  const total = Math.max(0, Math.floor(Number(marks) || 0));
  const share = Math.floor(total * config.treasuryShare);
  state.treasury += share;
  return total - share;
}

/**
 * Предмет для добычи NPC с бюджетом budget. Бюджет выбирает полосу, и из неё
 * берётся самый старый предмет, даже если он дороже самого бюджета: иначе
 * полный склад полосы не расходовался бы, а её цена росла. Пустая полоса
 * поднимает свою цену скупки, и тогда рынок пробует полосу ниже.
 * Возвращает { itemId, condition } или null.
 */
function takeBlackMarketLoot(state, config, budget = 0, priceOf = () => 0) {
  const start = bandIndex(config, budget);
  for (let index = start; index >= 0; index -= 1) {
    const band = config.bands[index];
    let bestId = '';
    let bestAt = Infinity;
    for (const [id, rows] of Object.entries(state.stock)) {
      if (!rows.length || bandIndex(config, priceOf(id)) !== index) continue;
      if (rows[0].t < bestAt) { bestAt = rows[0].t; bestId = id; }
    }
    if (bestId) {
      const row = state.stock[bestId].shift();
      if (!state.stock[bestId].length) delete state.stock[bestId];
      state.dropped += 1;
      return { itemId: bestId, condition: row.c };
    }
    if (index === start) {
      const bandState = state.bands[band.id];
      bandState.unmet += 1;
      bandState.multiplier = Math.min(config.maxMultiplier, bandState.multiplier + config.demandStep);
    }
  }
  return null;
}

/**
 * Течение времени: цены полос возвращаются к единице, а дешёвый склад
 * понемногу уничтожается — самые старые предметы первыми.
 */
function decayBlackMarket(state, config, priceOf = () => 0, now = Date.now()) {
  const last = Number.isFinite(Number(state.lastDecayAt)) ? Number(state.lastDecayAt) : Number(now);
  const hours = Math.max(0, (Number(now) - last) / 3600000);
  if (hours <= 0) return { destroyed: 0 };
  state.lastDecayAt = Number(now);
  const relax = config.relaxPerHour * hours;
  for (const band of config.bands) {
    const row = state.bands[band.id];
    if (row.multiplier > 1) row.multiplier = Math.max(1, row.multiplier - relax);
    else if (row.multiplier < 1) row.multiplier = Math.min(1, row.multiplier + relax);
  }
  const corruptBands = new Set(config.corruptBands);
  const share = Math.min(1, config.corruptSharePerDay * hours / 24);
  let destroyed = 0;
  for (const [id, rows] of Object.entries(state.stock)) {
    const band = config.bands[bandIndex(config, priceOf(id))];
    if (!corruptBands.has(band.id) || !rows.length) continue;
    // Дробная часть накапливается в самой записи, чтобы частые тики не
    // обнуляли уничтожение.
    const exact = rows.length * share + Number(rows.corruptCarry || 0);
    const count = Math.min(rows.length, Math.floor(exact));
    rows.corruptCarry = exact - count;
    if (count > 0) {
      rows.splice(0, count);
      destroyed += count;
    }
    if (!rows.length) delete state.stock[id];
  }
  state.destroyed += destroyed;
  return { destroyed };
}

/**
 * Усталость зоны: за окно времени первые freeKills убийств дают полный
 * бюджет, каждое следующее срезает perKill, но не ниже minFactor.
 */
function blackMarketFatigueFactor(tracker = {}, config, now = Date.now()) {
  const windowMs = config.fatigue.windowMinutes * 60000;
  if (!tracker.windowStart || now - tracker.windowStart > windowMs) {
    tracker.windowStart = now;
    tracker.kills = 0;
  }
  tracker.kills = Math.max(0, Math.floor(Number(tracker.kills) || 0)) + 1;
  const over = Math.max(0, tracker.kills - config.fatigue.freeKills);
  return Math.max(config.fatigue.minFactor, 1 - over * config.fatigue.perKill);
}

function publicBlackMarketState(state, config) {
  return {
    version: BLACK_MARKET_VERSION,
    treasury: state.treasury,
    stockCount: Object.values(state.stock).reduce((sum, rows) => sum + rows.length, 0),
    bands: config.bands.map(band => ({
      id: band.id,
      maxValue: band.maxValue,
      multiplier: Number(state.bands[band.id].multiplier.toFixed(3)),
      unmet: state.bands[band.id].unmet
    }))
  };
}

function serializeBlackMarketState(state) {
  const stock = {};
  for (const [id, rows] of Object.entries(state.stock)) stock[id] = rows.map(row => ({ c: row.c, t: row.t }));
  return { ...state, stock };
}

module.exports = {
  BLACK_MARKET_VERSION,
  DEFAULT_BLACK_MARKET_CONFIG: DEFAULT_CONFIG,
  normalizeBlackMarketConfig,
  normalizeBlackMarketState,
  serializeBlackMarketState,
  bandIndex,
  blackMarketUnitPrice,
  quoteBlackMarketSale,
  applyBlackMarketSale,
  fundBlackMarket,
  takeBlackMarketLoot,
  decayBlackMarket,
  blackMarketFatigueFactor,
  publicBlackMarketState
};
