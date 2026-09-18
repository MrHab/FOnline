'use strict';

/**
 * Синь и премиум экономики v3 (библия 14.5, KRM-22). Синь — валюта аккаунта,
 * аналог золота Albion: лежит на счёте, а не в рюкзаке, поэтому не выпадает
 * и не теряется. Кассеты сини, попавшие в рюкзак (награды, склады, старые
 * сохранения), зачисляются на счёт. За синь покупается премиум: налог
 * аукциона 4%, +50% опыта, марок с NPC и выхода при сборе, фокус для
 * возврата материалов на станках и ускоренные работы на личной базе.
 * Фокус копится, пока премиум активен, и тратится на заказы у станков.
 *
 * Модуль не знает о сервере: время передаётся снаружи.
 */

const ACCOUNT_SIN_VERSION = 1;
const DAY_MS = 24 * 3600000;

const DEFAULT_CONFIG = Object.freeze({
  itemId: 'blue',
  premium: Object.freeze({
    priceSin: 300,
    days: 30,
    xpMultiplier: 1.5,
    npcMarksMultiplier: 1.5,
    gatherMultiplier: 1.5,
    baseJobSpeedMultiplier: 1.5,
    auctionTaxPct: 0.04
  }),
  focus: Object.freeze({
    perDay: 10000,
    cap: 30000,
    costPerValue: 10,
    minCost: 50
  }),
  ledgerLimit: 40,
  maxSin: 1000000000
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeId(value = '', limit = 96) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function normalizeAccountSinConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const premium = src.premium && typeof src.premium === 'object' ? src.premium : {};
  const focus = src.focus && typeof src.focus === 'object' ? src.focus : {};
  const perDay = finite(focus.perDay, DEFAULT_CONFIG.focus.perDay, 0, 1e7);
  return Object.freeze({
    itemId: safeId(src.itemId || DEFAULT_CONFIG.itemId, 64),
    premium: Object.freeze({
      priceSin: Math.floor(finite(premium.priceSin, DEFAULT_CONFIG.premium.priceSin, 1, 1e9)),
      days: finite(premium.days, DEFAULT_CONFIG.premium.days, 1, 3650),
      xpMultiplier: finite(premium.xpMultiplier, DEFAULT_CONFIG.premium.xpMultiplier, 1, 10),
      npcMarksMultiplier: finite(premium.npcMarksMultiplier, DEFAULT_CONFIG.premium.npcMarksMultiplier, 1, 10),
      gatherMultiplier: finite(premium.gatherMultiplier, DEFAULT_CONFIG.premium.gatherMultiplier, 1, 10),
      baseJobSpeedMultiplier: finite(premium.baseJobSpeedMultiplier, DEFAULT_CONFIG.premium.baseJobSpeedMultiplier, 1, 10),
      auctionTaxPct: finite(premium.auctionTaxPct, DEFAULT_CONFIG.premium.auctionTaxPct, 0, 1)
    }),
    focus: Object.freeze({
      perDay,
      cap: finite(focus.cap, DEFAULT_CONFIG.focus.cap, perDay, 1e8),
      costPerValue: finite(focus.costPerValue, DEFAULT_CONFIG.focus.costPerValue, 0, 1e6),
      minCost: Math.floor(finite(focus.minCost, DEFAULT_CONFIG.focus.minCost, 0, 1e7))
    }),
    ledgerLimit: Math.floor(finite(src.ledgerLimit, DEFAULT_CONFIG.ledgerLimit, 0, 1000)),
    maxSin: Math.floor(finite(src.maxSin, DEFAULT_CONFIG.maxSin, 1, 9e15))
  });
}

function sanitizeAccount(input = {}, config = DEFAULT_CONFIG) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const ledger = (Array.isArray(src.ledger) ? src.ledger : [])
    .map(row => ({
      at: Math.max(0, Math.floor(Number(row?.at) || 0)),
      delta: Math.floor(Number(row?.delta) || 0),
      reason: String(row?.reason || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 40)
    }))
    .filter(row => row.delta !== 0)
    .slice(-config.ledgerLimit);
  return {
    version: ACCOUNT_SIN_VERSION,
    sin: Math.floor(finite(src.sin, 0, 0, config.maxSin)),
    premiumUntil: Math.max(0, Math.floor(Number(src.premiumUntil) || 0)),
    focus: finite(src.focus, 0, 0, config.focus.cap),
    focusUpdatedAt: Math.max(0, Math.floor(Number(src.focusUpdatedAt) || 0)),
    ledger
  };
}

function normalizeAccountStore(input = {}, config = DEFAULT_CONFIG) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [id, row] of Object.entries(src)) {
    const key = safeId(id);
    if (key) out[key] = sanitizeAccount(row, config);
  }
  return out;
}

function accountFor(store, accountId = '', config = DEFAULT_CONFIG) {
  const key = safeId(accountId);
  if (!key) return null;
  if (!store[key]) store[key] = sanitizeAccount({}, config);
  return store[key];
}

function premiumActive(account, now = Date.now()) {
  return !!account && Number(account.premiumUntil) > Number(now);
}

/** Запас фокуса на момент now: копится только под премиумом, не выше предела. */
function focusAt(account, config, now = Date.now()) {
  if (!account) return 0;
  const last = Number(account.focusUpdatedAt) || Number(now);
  const until = Math.min(Number(now), Math.max(last, Number(account.premiumUntil) || 0));
  const focus = Number(account.focus) || 0;
  return until > last ? Math.min(config.focus.cap, focus + (until - last) / DAY_MS * config.focus.perDay) : focus;
}

function refreshFocus(account, config, now = Date.now()) {
  if (!account) return 0;
  account.focus = focusAt(account, config, now);
  account.focusUpdatedAt = Math.floor(Number(now));
  return account.focus;
}

function record(account, config, delta, reason, now) {
  if (!delta) return;
  account.ledger.push({ at: Math.floor(Number(now)), delta, reason: String(reason || '').slice(0, 40) });
  if (account.ledger.length > config.ledgerLimit) account.ledger.splice(0, account.ledger.length - config.ledgerLimit);
}

/** Зачисление сини. Возвращает зачисленное (упирается в предел счёта). */
function creditSin(account, config, amount = 0, reason = '', now = Date.now()) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!account || value <= 0) return 0;
  const credited = Math.min(value, config.maxSin - account.sin);
  account.sin += credited;
  record(account, config, credited, reason, now);
  return credited;
}

/** Списание сини: всё или ничего. */
function spendSin(account, config, amount = 0, reason = '', now = Date.now()) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!account || value <= 0) return { ok: value === 0 };
  if (account.sin < value) return { ok: false, error: `Не хватает сини: нужно ${value}, на счёте ${account.sin}.` };
  account.sin -= value;
  record(account, config, -value, reason, now);
  return { ok: true, spent: value };
}

/** Покупка премиума: продлевает от конца текущего срока. */
function buyPremium(account, config, now = Date.now()) {
  refreshFocus(account, config, now);
  const paid = spendSin(account, config, config.premium.priceSin, 'premium', now);
  if (!paid.ok) return paid;
  const start = Math.max(Number(now), Number(account.premiumUntil) || 0);
  account.premiumUntil = Math.floor(start + config.premium.days * DAY_MS);
  return { ok: true, premiumUntil: account.premiumUntil, spent: paid.spent };
}

/** Стоимость фокуса заказа: от стоимости изделия. */
function focusCostFor(config, value = 0) {
  return Math.max(config.focus.minCost, Math.ceil(Math.max(0, Number(value) || 0) * config.focus.costPerValue));
}

/**
 * Трата фокуса на заказ. Возвращает true, если фокус списан и заказ получает
 * бонус премиума к возврату материалов.
 */
function spendFocus(account, config, cost = 0, now = Date.now()) {
  if (!premiumActive(account, now)) return false;
  refreshFocus(account, config, now);
  const value = Math.max(0, Number(cost) || 0);
  if (account.focus < value) return false;
  account.focus -= value;
  return true;
}

function publicAccount(account, config, now = Date.now()) {
  const active = premiumActive(account, now);
  return {
    sin: account ? account.sin : 0,
    premium: active,
    premiumUntil: active ? account.premiumUntil : 0,
    premiumPriceSin: config.premium.priceSin,
    premiumDays: config.premium.days,
    focus: Math.floor(focusAt(account, config, now)),
    focusCap: config.focus.cap,
    // Цена фокуса заказа считается и в клиенте: 10 за марку стоимости изделия.
    focusCostPerValue: config.focus.costPerValue,
    focusMinCost: config.focus.minCost
  };
}

module.exports = {
  ACCOUNT_SIN_VERSION,
  DEFAULT_ACCOUNT_SIN_CONFIG: DEFAULT_CONFIG,
  normalizeAccountSinConfig,
  normalizeAccountStore,
  accountFor,
  premiumActive,
  refreshFocus,
  focusAt,
  creditSin,
  spendSin,
  buyPremium,
  focusCostFor,
  spendFocus,
  publicAccount
};
