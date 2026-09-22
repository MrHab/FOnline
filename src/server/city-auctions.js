'use strict';

/**
 * Аукционы столиц экономики v3 (библия 14.5, KRM-22): у каждой столицы своя
 * книга ордеров, списки не связаны — товар везут ногами. Налог с продажи 8%
 * (4% с премиумом), сбор за ордер 2,5%, ордера живут до 30 дней; житель-
 * Торговец личной базы снижает налог. Прежняя общая книга переезжает один раз:
 * её ордера снимаются, а полки ждут владельца у первого аукционера, к которому
 * он подойдёт.
 *
 * Механика книги — src/server/faction-market.js; модуль не знает о сервере.
 */

const {
  expireOrders,
  normalizeMarketRules,
  normalizeMarketStore,
  sanitizeShelf
} = require('./faction-market');

const CITY_MARKETS_VERSION = 1;
const HOUR_MS = 3600000;

const DEFAULT_CONFIG = Object.freeze({
  taxPct: 0.08,
  premiumTaxPct: 0.04,
  setupFeePct: 0.025,
  durationChoicesHours: Object.freeze([24, 72, 168, 720]),
  listingLifetimeHours: 720,
  maxOrdersPerTrader: 30,
  maxOrders: 1500,
  // Доля бонуса торговли жителей, которая снижает налог: 20% бонуса при доле 1
  // превращают налог 8% в 6,4%.
  residentTaxShare: 1
});

function safeId(value = '', limit = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeCityAuctionConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const taxPct = finite(src.taxPct, DEFAULT_CONFIG.taxPct, 0, 1);
  const hoursSrc = Array.isArray(src.durationChoicesHours) && src.durationChoicesHours.length
    ? src.durationChoicesHours
    : DEFAULT_CONFIG.durationChoicesHours;
  const rules = normalizeMarketRules({
    durationChoicesMs: hoursSrc.map(hours => Math.floor(Number(hours) * HOUR_MS)),
    listingLifetimeMs: Math.floor(finite(src.listingLifetimeHours, DEFAULT_CONFIG.listingLifetimeHours, 1, 720) * HOUR_MS),
    maxOrdersPerTrader: Math.floor(finite(src.maxOrdersPerTrader, DEFAULT_CONFIG.maxOrdersPerTrader, 1, 1000)),
    maxOrders: Math.floor(finite(src.maxOrders, DEFAULT_CONFIG.maxOrders, 1, 100000)),
    taxPct,
    setupFeePct: finite(src.setupFeePct, DEFAULT_CONFIG.setupFeePct, 0, 1)
  });
  return Object.freeze({
    taxPct,
    premiumTaxPct: finite(src.premiumTaxPct, DEFAULT_CONFIG.premiumTaxPct, 0, 1),
    residentTaxShare: finite(src.residentTaxShare, DEFAULT_CONFIG.residentTaxShare, 0, 5),
    rules: Object.freeze(rules)
  });
}

function mergeShelves(target = null, shelf = {}) {
  const clean = sanitizeShelf(shelf);
  if (!target) return clean;
  return {
    silver: target.silver + clean.silver,
    items: target.items.concat(clean.items),
    sales: target.sales + clean.sales
  };
}

/**
 * Одноразовый переезд общей книги: каждый ордер снимается (товар и
 * замороженные марки ложатся на полку), полки переходят в legacyShelves.
 */
function migrateLegacyMarket(markets, legacyInput = null, now = Date.now()) {
  const legacy = normalizeMarketStore(legacyInput);
  let orders = 0;
  for (const order of Object.values(legacy.orders)) {
    order.expiresAt = 0;
    orders += 1;
  }
  expireOrders(legacy, undefined, now);
  let shelves = 0;
  for (const [characterId, shelf] of Object.entries(legacy.shelves)) {
    const key = safeId(characterId, 96);
    const clean = sanitizeShelf(shelf);
    if (!key || (clean.silver <= 0 && !clean.items.length)) continue;
    markets.legacyShelves[key] = mergeShelves(markets.legacyShelves[key] || null, clean);
    shelves += 1;
  }
  markets.migratedAt = Math.max(1, Math.floor(Number(now) || 1));
  return { orders, shelves };
}

function normalizeCityMarkets(input = {}, legacyInput = null, now = Date.now()) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const books = {};
  for (const [hubId, book] of Object.entries(src.books && typeof src.books === 'object' ? src.books : {})) {
    const id = safeId(hubId);
    if (id) books[id] = normalizeMarketStore(book);
  }
  const legacyShelves = {};
  for (const [characterId, shelf] of Object.entries(src.legacyShelves && typeof src.legacyShelves === 'object' ? src.legacyShelves : {})) {
    const key = safeId(characterId, 96);
    const clean = sanitizeShelf(shelf);
    if (key && (clean.silver > 0 || clean.items.length)) legacyShelves[key] = clean;
  }
  const markets = {
    version: CITY_MARKETS_VERSION,
    books,
    legacyShelves,
    migratedAt: Math.max(0, Math.floor(Number(src.migratedAt) || 0))
  };
  if (!markets.migratedAt) migrateLegacyMarket(markets, legacyInput, now);
  return markets;
}

function cityBook(markets, hubId = '') {
  const id = safeId(hubId);
  if (!id) return null;
  if (!markets.books[id]) markets.books[id] = normalizeMarketStore(null);
  return markets.books[id];
}

/** Полка из общей книги переезжает к аукционеру, у которого владелец сейчас стоит. */
function adoptLegacyShelf(markets, hubId = '', characterId = '') {
  const key = safeId(characterId, 96);
  const shelf = key ? markets.legacyShelves[key] : null;
  const book = shelf ? cityBook(markets, hubId) : null;
  if (!shelf || !book) return false;
  book.shelves[key] = mergeShelves(book.shelves[key] ? sanitizeShelf(book.shelves[key]) : null, shelf);
  delete markets.legacyShelves[key];
  return true;
}

/** Ставка налога продавца: премиум, затем скидка от жителей базы. */
function sellerTaxPct(config, seller = {}) {
  const base = seller.premium ? config.premiumTaxPct : config.taxPct;
  const resident = finite(seller.residentPct, 0, 0, 1) * config.residentTaxShare;
  return Number(Math.max(0, base * (1 - Math.min(1, resident))).toFixed(4));
}

function rulesForSeller(config, seller = {}) {
  return { ...config.rules, taxPct: sellerTaxPct(config, seller) };
}

function expireCityMarkets(markets, now = Date.now()) {
  let resolved = 0;
  for (const book of Object.values(markets.books)) resolved += expireOrders(book, undefined, now).length;
  return resolved;
}

module.exports = {
  CITY_MARKETS_VERSION,
  DEFAULT_CITY_AUCTION_CONFIG: DEFAULT_CONFIG,
  normalizeCityAuctionConfig,
  normalizeCityMarkets,
  migrateLegacyMarket,
  cityBook,
  adoptLegacyShelf,
  sellerTaxPct,
  rulesForSeller,
  expireCityMarkets
};
