'use strict';

/**
 * Участки поселений экономики v3 (библия 14.5, KRM-22): каждый станок
 * поселения — столицы, аванпоста или мастерской — участок, которым владеет
 * поселение. Право аренды разыгрывается на торгах:
 * ставки открыты, пока участок свободен или до конца аренды осталось меньше
 * срока торгов; победитель получает участок на leaseDays, ставка сгорает, а
 * перебитые ставки возвращаются владельцам. Арендатор назначает плату за
 * пользование станком — долю стоимости результата, она уходит ему; сам он
 * работает бесплатно. Свободный участок берёт высокую плату поселения, и она
 * сгорает. Станок участка возвращает часть материалов:
 * 1 − 1/(1 + бонус/100), бонус участка 18, профильный регион +15.
 *
 * Модуль не знает о сервере: время, цены и случайность передаются снаружи.
 */

const CRAFTING_PLOTS_VERSION = 1;
const HOUR_MS = 3600000;

const DEFAULT_CONFIG = Object.freeze({
  leaseDays: 7,
  auctionHours: 24,
  // Ставка в последние минуты продлевает торги, чтобы участок не уводили в
  // последнюю секунду.
  extendMinutes: 5,
  minBid: 100,
  bidStepPct: 0.05,
  defaultFeePct: 0.05,
  maxFeePct: 0.3,
  unleasedFeePct: 0.15,
  plotBonus: 18,
  regionBonus: 15,
  premiumFocusBonus: 59,
  regions: Object.freeze({}),
  excludedLocations: Object.freeze(['tutorialCaravanYard', 'personalBase'])
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeId(value = '', limit = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function normalizeCraftingPlotConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const regions = {};
  for (const [locationId, stations] of Object.entries(src.regions && typeof src.regions === 'object' ? src.regions : {})) {
    const id = safeId(locationId);
    const list = (Array.isArray(stations) ? stations : []).map(value => safeId(value, 32)).filter(Boolean);
    if (id && list.length) regions[id] = Object.freeze(list);
  }
  const excluded = Array.isArray(src.excludedLocations) ? src.excludedLocations : DEFAULT_CONFIG.excludedLocations;
  const maxFeePct = finite(src.maxFeePct, DEFAULT_CONFIG.maxFeePct, 0, 5);
  return Object.freeze({
    leaseDays: finite(src.leaseDays, DEFAULT_CONFIG.leaseDays, 0.01, 365),
    auctionHours: finite(src.auctionHours, DEFAULT_CONFIG.auctionHours, 0.01, 24 * 30),
    extendMinutes: finite(src.extendMinutes, DEFAULT_CONFIG.extendMinutes, 0, 120),
    minBid: Math.floor(finite(src.minBid, DEFAULT_CONFIG.minBid, 1, 1e9)),
    bidStepPct: finite(src.bidStepPct, DEFAULT_CONFIG.bidStepPct, 0, 10),
    defaultFeePct: finite(src.defaultFeePct, DEFAULT_CONFIG.defaultFeePct, 0, maxFeePct),
    maxFeePct,
    unleasedFeePct: finite(src.unleasedFeePct, DEFAULT_CONFIG.unleasedFeePct, 0, 5),
    plotBonus: finite(src.plotBonus, DEFAULT_CONFIG.plotBonus, 0, 1000),
    regionBonus: finite(src.regionBonus, DEFAULT_CONFIG.regionBonus, 0, 1000),
    premiumFocusBonus: finite(src.premiumFocusBonus, DEFAULT_CONFIG.premiumFocusBonus, 0, 1000),
    regions: Object.freeze(regions),
    excludedLocations: Object.freeze(excluded.map(value => safeId(value)).filter(Boolean))
  });
}

function plotIdFor(locationId = '', objectId = '') {
  const location = safeId(locationId);
  const object = safeId(objectId, 96);
  return location && object ? `${location}__${object}` : '';
}

function cleanPerson(input = null) {
  const characterId = safeId(input?.characterId, 96);
  if (!characterId) return null;
  return { characterId, name: String(input?.name || '').slice(0, 48) };
}

function cleanTime(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function sanitizePlot(input = {}, id = '', config = DEFAULT_CONFIG) {
  const src = input && typeof input === 'object' ? input : {};
  const lessee = cleanPerson(src.lessee);
  const bidder = cleanPerson(src.bid);
  const amount = Math.floor(Number(src.bid?.amount) || 0);
  return {
    id,
    locationId: safeId(src.locationId),
    objectId: safeId(src.objectId, 96),
    station: safeId(src.station, 32),
    lessee,
    leaseStartsAt: lessee ? cleanTime(src.leaseStartsAt) : 0,
    leaseEndsAt: lessee ? cleanTime(src.leaseEndsAt) : 0,
    feePct: finite(src.feePct, config.defaultFeePct, 0, config.maxFeePct),
    bid: bidder && amount > 0 ? { ...bidder, amount, at: cleanTime(src.bid.at) } : null,
    auctionEndsAt: bidder && amount > 0 ? cleanTime(src.auctionEndsAt) : 0,
    earned: Math.max(0, Math.floor(Number(src.earned) || 0))
  };
}

function normalizeCraftingPlotState(input = {}, config = DEFAULT_CONFIG) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const plots = {};
  for (const [rawId, row] of Object.entries(src.plots && typeof src.plots === 'object' ? src.plots : {})) {
    const id = String(rawId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 170);
    if (id) plots[id] = sanitizePlot(row, id, config);
  }
  const payouts = {};
  for (const [characterId, amount] of Object.entries(src.payouts && typeof src.payouts === 'object' ? src.payouts : {})) {
    const key = safeId(characterId, 96);
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (key && value > 0) payouts[key] = value;
  }
  return { version: CRAFTING_PLOTS_VERSION, plots, payouts };
}

/** Участок станка: создаётся при первом обращении, владелец — поселение. */
function ensurePlot(state, config, { locationId = '', objectId = '', station = '' } = {}) {
  const id = plotIdFor(locationId, objectId);
  if (!id) return null;
  if (!state.plots[id]) {
    state.plots[id] = sanitizePlot({ locationId, objectId, station }, id, config);
  } else if (station && !state.plots[id].station) {
    state.plots[id].station = safeId(station, 32);
  }
  return state.plots[id];
}

function leaseActive(plot, now = Date.now()) {
  return !!plot?.lessee && Number(plot.leaseEndsAt) > Number(now);
}

/** Торги открыты, пока участок свободен или аренда кончается в пределах срока торгов. */
function auctionOpen(plot, config, now = Date.now()) {
  if (!plot) return false;
  if (!leaseActive(plot, now)) return true;
  return Number(plot.leaseEndsAt) - Number(now) <= config.auctionHours * HOUR_MS;
}

function minNextBid(plot, config) {
  if (!plot?.bid) return config.minBid;
  return Math.max(config.minBid, Math.ceil(plot.bid.amount * (1 + config.bidStepPct)), plot.bid.amount + 1);
}

function creditPayout(state, characterId = '', amount = 0) {
  const key = safeId(characterId, 96);
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!key || value <= 0) return 0;
  state.payouts[key] = (state.payouts[key] || 0) + value;
  return value;
}

/** Забрать выплаты игрока (не больше limit). Возвращает сумму. */
function takePayout(state, characterId = '', limit = Infinity) {
  const key = safeId(characterId, 96);
  const pending = key ? state.payouts[key] || 0 : 0;
  const amount = Math.max(0, Math.min(pending, Math.floor(Number(limit))));
  if (amount <= 0) return 0;
  if (amount >= pending) delete state.payouts[key];
  else state.payouts[key] = pending - amount;
  return amount;
}

/**
 * Ставка на аренду. Марки ставки сервер уже снял с игрока; перебитая ставка
 * возвращается прежнему участнику выплатой. Возвращает { ok, plot, refunded }.
 */
function placePlotBid(state, config, plotId = '', bidder = {}, amount = 0, now = Date.now()) {
  const plot = state.plots[plotId];
  const person = cleanPerson(bidder);
  const value = Math.floor(Number(amount) || 0);
  if (!plot) return { ok: false, error: 'Такого участка нет.' };
  if (!person) return { ok: false, error: 'Участник торгов не опознан.' };
  if (!auctionOpen(plot, config, now)) {
    return { ok: false, error: 'Торги откроются за сутки до конца нынешней аренды.' };
  }
  if (plot.bid?.characterId === person.characterId) return { ok: false, error: 'Ваша ставка уже лидирует.' };
  const minimum = minNextBid(plot, config);
  if (value < minimum) return { ok: false, error: `Ставка не меньше ${minimum} марок.` };
  let refunded = null;
  if (plot.bid) {
    creditPayout(state, plot.bid.characterId, plot.bid.amount);
    refunded = { characterId: plot.bid.characterId, amount: plot.bid.amount };
  }
  const baseEnd = leaseActive(plot, now) ? Number(plot.leaseEndsAt) : Number(now) + config.auctionHours * HOUR_MS;
  const extendMs = config.extendMinutes * 60000;
  let endsAt = plot.auctionEndsAt > 0 ? plot.auctionEndsAt : baseEnd;
  if (extendMs > 0 && endsAt - Number(now) < extendMs) endsAt = Number(now) + extendMs;
  plot.bid = { ...person, amount: value, at: Math.floor(Number(now)) };
  plot.auctionEndsAt = Math.floor(endsAt);
  return { ok: true, plot, refunded };
}

/** Арендатор меняет плату за пользование станком. */
function setPlotFee(state, config, plotId = '', characterId = '', feePct = 0, now = Date.now()) {
  const plot = state.plots[plotId];
  if (!plot) return { ok: false, error: 'Такого участка нет.' };
  if (!leaseActive(plot, now) || plot.lessee.characterId !== safeId(characterId, 96)) {
    return { ok: false, error: 'Плату назначает только арендатор участка.' };
  }
  const value = Number(feePct);
  if (!Number.isFinite(value) || value < 0 || value > config.maxFeePct) {
    return { ok: false, error: `Плата — от 0 до ${Math.round(config.maxFeePct * 100)}% стоимости изделия.` };
  }
  plot.feePct = Number(value.toFixed(4));
  return { ok: true, plot };
}

/**
 * Итоги торгов и конец аренды. Победитель получает участок: если он уже
 * арендатор — продлевает, иначе аренда начинается сейчас (или с конца
 * текущей). Возвращает список изменений.
 */
function settleCraftingPlots(state, config, now = Date.now()) {
  const changes = [];
  const leaseMs = config.leaseDays * 24 * HOUR_MS;
  for (const plot of Object.values(state.plots)) {
    if (plot.bid && Number(plot.auctionEndsAt) <= Number(now)) {
      const winner = plot.bid;
      const renewing = plot.lessee?.characterId === winner.characterId;
      // Продление идёт от конца нынешней аренды, новая аренда — не раньше неё.
      const start = Math.max(Number(now), leaseActive(plot, now) ? Number(plot.leaseEndsAt) : 0);
      if (renewing) {
        plot.leaseEndsAt = Math.floor(Math.max(Number(plot.leaseEndsAt), Number(now)) + leaseMs);
      } else {
        plot.lessee = { characterId: winner.characterId, name: winner.name };
        plot.leaseStartsAt = Math.floor(start);
        plot.leaseEndsAt = Math.floor(start + leaseMs);
        plot.feePct = config.defaultFeePct;
      }
      plot.bid = null;
      plot.auctionEndsAt = 0;
      changes.push({ plotId: plot.id, kind: renewing ? 'renewed' : 'leased', characterId: winner.characterId, rent: winner.amount });
      continue;
    }
    if (plot.lessee && !leaseActive(plot, now) && !plot.bid) {
      changes.push({ plotId: plot.id, kind: 'expired', characterId: plot.lessee.characterId });
      plot.lessee = null;
      plot.leaseStartsAt = 0;
      plot.leaseEndsAt = 0;
      plot.feePct = config.defaultFeePct;
    }
  }
  return changes;
}

/**
 * Плата за один заказ на станке участка. value — стоимость изделия по базовой
 * цене, baseFee — прежняя комиссия рецепта. Возвращает { fee, payee, leased }:
 * payee — кому уходит плата (null — сгорает).
 */
// Доля стоимости с округлением вверх; произведение сначала округляется до
// миллионных, чтобы 15 × 0,2 не превращалось в 3,0000000000000004 → 4.
function shareOf(worth, pct) {
  return Math.ceil(Number((worth * pct).toFixed(6)));
}

function plotCraftFee(plot, config, userCharacterId = '', value = 0, baseFee = 0, now = Date.now()) {
  const worth = Math.max(0, Number(value) || 0);
  const floor = Math.max(0, Math.floor(Number(baseFee) || 0));
  if (plot && leaseActive(plot, now)) {
    if (plot.lessee.characterId === safeId(userCharacterId, 96)) return { fee: 0, payee: null, leased: true, own: true };
    return { fee: Math.max(floor, shareOf(worth, plot.feePct)), payee: plot.lessee.characterId, leased: true, own: false };
  }
  return { fee: Math.max(floor, shareOf(worth, config.unleasedFeePct)), payee: null, leased: false, own: false };
}

/** Доля возвращённых материалов: 1 − 1/(1 + бонус/100). */
function plotReturnRate(config, locationId = '', station = '', premium = false) {
  const regional = (config.regions[safeId(locationId)] || []).includes(safeId(station, 32));
  const bonus = config.plotBonus + (regional ? config.regionBonus : 0) + (premium ? config.premiumFocusBonus : 0);
  return bonus > 0 ? 1 - 1 / (1 + bonus / 100) : 0;
}

/** Возврат материалов: целая часть гарантирована, дробная — шансом. */
function rollPlotReturns(requirements = [], rate = 0, random = Math.random) {
  const out = [];
  for (const row of Array.isArray(requirements) ? requirements : []) {
    const id = safeId(row?.id);
    const qty = Math.max(0, Number(row?.qty) || 0);
    if (!id || id === 'silver' || qty <= 0 || rate <= 0) continue;
    const exact = qty * rate;
    const amount = Math.floor(exact) + (random() < exact - Math.floor(exact) ? 1 : 0);
    if (amount > 0) out.push({ id, qty: amount });
  }
  return out;
}

/** Публичный вид участка для игрока viewer. */
function publicPlot(plot, config, viewerCharacterId = '', now = Date.now()) {
  const viewer = safeId(viewerCharacterId, 96);
  const active = leaseActive(plot, now);
  return {
    plotId: plot.id,
    objectId: plot.objectId,
    station: plot.station,
    leased: active,
    lesseeName: active ? plot.lessee.name : '',
    mine: active && plot.lessee.characterId === viewer,
    leaseEndsAt: active ? plot.leaseEndsAt : 0,
    feePct: active ? plot.feePct : config.unleasedFeePct,
    unleasedFeePct: config.unleasedFeePct,
    maxFeePct: config.maxFeePct,
    returnRate: Number(plotReturnRate(config, plot.locationId, plot.station).toFixed(4)),
    // Возврат заказа с фокусом премиума — для переключателя в окне станка.
    focusReturnRate: Number(plotReturnRate(config, plot.locationId, plot.station, true).toFixed(4)),
    auction: {
      open: auctionOpen(plot, config, now),
      highestBid: plot.bid ? plot.bid.amount : 0,
      leading: !!plot.bid && plot.bid.characterId === viewer,
      bidderName: plot.bid ? plot.bid.name : '',
      endsAt: plot.bid ? plot.auctionEndsAt : 0,
      minBid: minNextBid(plot, config)
    }
  };
}

module.exports = {
  CRAFTING_PLOTS_VERSION,
  DEFAULT_CRAFTING_PLOT_CONFIG: DEFAULT_CONFIG,
  normalizeCraftingPlotConfig,
  normalizeCraftingPlotState,
  plotIdFor,
  ensurePlot,
  leaseActive,
  auctionOpen,
  minNextBid,
  creditPayout,
  takePayout,
  placePlotBid,
  setPlotFee,
  settleCraftingPlots,
  plotCraftFee,
  plotReturnRate,
  rollPlotReturns,
  publicPlot
};
