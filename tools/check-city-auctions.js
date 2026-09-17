#!/usr/bin/env node
'use strict';

// Аукционы столиц экономики v3 (библия 14.5): своя книга у каждой столицы,
// налог 8% (4% с премиумом) со скидкой от жителей базы, сбор 2,5%, сроки до
// 30 дней, ставка продавца фиксируется в ордере, общая книга переезжает один
// раз и не теряет ни товара, ни марок.

const assert = require('node:assert/strict');
const path = require('node:path');
const market = require('../src/server/faction-market');
const {
  normalizeCityAuctionConfig,
  normalizeCityMarkets,
  migrateLegacyMarket,
  cityBook,
  adoptLegacyShelf,
  sellerTaxPct,
  rulesForSeller,
  expireCityMarkets
} = require('../src/server/city-auctions');
const { loadWorldEconomy } = require('../src/server/world-economy');

const HOUR = 3600000;
const economy = loadWorldEconomy(path.join(__dirname, '..', 'data', 'kromka', 'economy.json'));
const config = economy.auctions;
const plain = value => JSON.parse(JSON.stringify(value));

// --- настройки ------------------------------------------------------------------------
assert.equal(economy.worldModel.cityAuctions, true, 'v3 splits the book by capital');
assert.equal(config.taxPct, 0.08);
assert.equal(config.premiumTaxPct, 0.04);
assert.equal(config.rules.setupFeePct, 0.025);
assert.deepEqual(config.rules.durationChoicesMs.map(ms => ms / HOUR), [24, 72, 168, 720], 'orders live up to 30 days');
assert.equal(config.rules.listingLifetimeMs, 168 * HOUR);
assert.equal(normalizeCityAuctionConfig({}).rules.taxPct, 0.08, 'defaults match the bible');

// --- налог продавца -------------------------------------------------------------------
assert.equal(sellerTaxPct(config, {}), 0.08);
assert.equal(sellerTaxPct(config, { premium: true }), 0.04);
assert.equal(sellerTaxPct(config, { residentPct: 0.2 }), 0.064, 'a base Trader resident lowers the tax');
assert.equal(sellerTaxPct(config, { premium: true, residentPct: 0.2 }), 0.032);
assert.equal(sellerTaxPct(config, { residentPct: 7 }), 0, 'a broken bonus never makes the tax negative');
assert.equal(rulesForSeller(config, { residentPct: 0.1 }).taxPct, 0.072);
assert.equal(rulesForSeller(config, {}).setupFeePct, 0.025);

// --- ставка фиксируется в ордере ------------------------------------------------------
{
  const t0 = 1_000_000;
  const book = market.normalizeMarketStore(null);
  const seller = rulesForSeller(config, { premium: true });
  const buyer = rulesForSeller(config, {});
  const placed = market.placeSellOrder(book, {
    ownerCharacterId: 'seller', ownerName: 'Продавец', itemId: 'ammo9', category: 'ammo',
    qty: 10, price: 100, durationMs: 24 * HOUR, taxPct: seller.taxPct
  }, seller, t0);
  assert(placed.ok && placed.order.taxPct === 0.04, 'the resting order keeps the premium rate: ' + JSON.stringify(plain(placed)));
  assert.equal(placed.setupFee, 25, 'setup fee 2.5% of 1000');
  // Покупатель без премиума забирает часть: налог считается по ставке продавца.
  const bought = market.takeSellOrder(book, placed.order.id, 'buyer', 5, buyer, t0 + 1);
  assert.equal(bought.tax, 20, 'premium seller pays 4% of 500');
  assert.equal(market.shelfFor(book, 'seller').silver, 480);
  // Встречный ордер на выкуп тоже платит продавцу по его ставке.
  const crossing = market.placeBuyOrder(book, {
    ownerCharacterId: 'buyer', ownerName: 'Покупатель', itemId: 'ammo9', category: 'ammo',
    qty: 5, price: 100, durationMs: 24 * HOUR
  }, buyer, t0 + 2);
  assert.equal(crossing.fills[0].tax, 20);
  assert.equal(market.shelfFor(book, 'seller').silver, 960);
  // Ордер без записанной ставки (прежний) платит по ставке книги.
  const old = market.placeSellOrder(book, {
    ownerCharacterId: 'old', ownerName: 'Старый', itemId: 'ammo9', category: 'ammo',
    qty: 1, price: 100, durationMs: 24 * HOUR
  }, buyer, t0 + 3);
  assert.equal(old.order.taxPct, undefined);
  assert.equal(market.takeSellOrder(book, old.order.id, 'buyer', 1, buyer, t0 + 4).tax, 8);
  assert.equal(market.publicMarket(book, 'buyer', buyer, t0 + 5, { marketId: 'scrapTown', marketName: 'Раздолье' }).marketName, 'Раздолье');
}

// --- книги столиц не связаны ----------------------------------------------------------
{
  const markets = normalizeCityMarkets(null, null, 5);
  const sluice = cityBook(markets, 'sluiceCity');
  const scrap = cityBook(markets, 'scrapTown');
  assert.notEqual(sluice, scrap);
  market.placeSellOrder(sluice, {
    ownerCharacterId: 'a', ownerName: 'А', itemId: 'ammo9', category: 'ammo', qty: 3, price: 5, durationMs: 24 * HOUR
  }, config.rules, 10);
  assert.equal(market.activeOrders(scrap, 11).length, 0, 'an order in one capital is not in another');
  assert.equal(market.activeOrders(cityBook(markets, 'sluiceCity'), 11).length, 1);
  assert.equal(cityBook(markets, ''), null, 'no book without a capital');
  assert.equal(expireCityMarkets(markets, 10 + 25 * HOUR), 1, 'expiry runs over every capital');
  assert.equal(market.shelfFor(sluice, 'a').items[0].qty, 3, 'the expired lot returns to the seller in that capital');
}

// --- переезд общей книги -------------------------------------------------------------
{
  const legacy = market.normalizeMarketStore(null);
  market.placeSellOrder(legacy, {
    ownerCharacterId: 'seller', ownerName: 'Продавец', itemId: 'leather', category: 'armor', qty: 1, price: 40,
    durationMs: 24 * HOUR, records: [{ id: 'rt_1', baseId: 'leather' }]
  }, market.normalizeMarketRules({}), 1);
  market.placeBuyOrder(legacy, {
    ownerCharacterId: 'buyer', ownerName: 'Покупатель', itemId: 'ammo9', category: 'ammo', qty: 4, price: 3,
    durationMs: 24 * HOUR
  }, market.normalizeMarketRules({}), 2);
  legacy.shelves.seller = { silver: 7, items: [], sales: 0 };
  const saved = plain(legacy);
  const markets = normalizeCityMarkets(null, saved, 100);
  assert(markets.migratedAt === 100, 'the migration is recorded once');
  assert.equal(markets.legacyShelves.seller.silver, 7);
  assert.deepEqual(plain(markets.legacyShelves.seller.items.map(row => [row.itemId, row.qty, row.records.length])), [['leather', 1, 1]],
    'the listed item returns with its instance record');
  assert.equal(markets.legacyShelves.buyer.silver, 12, 'frozen marks return to the buyer');
  // Повторная загрузка не переносит книгу второй раз.
  const reloaded = normalizeCityMarkets(plain(markets), saved, 200);
  assert.equal(reloaded.migratedAt, 100);
  assert.equal(reloaded.legacyShelves.buyer.silver, 12, 'the second load does not double the shelves');
  // Полка переезжает к первому аукционеру, у которого стоит владелец.
  assert.equal(adoptLegacyShelf(reloaded, 'scrapTown', 'buyer'), true);
  assert.equal(adoptLegacyShelf(reloaded, 'sluiceCity', 'buyer'), false, 'a shelf moves only once');
  assert.equal(market.shelfFor(cityBook(reloaded, 'scrapTown'), 'buyer').silver, 12);
  assert.equal(reloaded.legacyShelves.buyer, undefined);
  // Своя полка в столице складывается с переехавшей.
  cityBook(reloaded, 'relayStation').shelves.seller = { silver: 5, items: [], sales: 2 };
  assert.equal(adoptLegacyShelf(reloaded, 'relayStation', 'seller'), true);
  const merged = market.shelfFor(cityBook(reloaded, 'relayStation'), 'seller');
  assert.deepEqual([merged.silver, merged.items.length, merged.sales], [12, 1, 2]);
}

// --- повторный переезд: общую книгу снова использовали --------------------------------
{
  const markets = normalizeCityMarkets(null, { shelves: { a: { silver: 3, items: [], sales: 0 } } }, 1);
  const again = market.normalizeMarketStore(null);
  market.placeBuyOrder(again, {
    ownerCharacterId: 'a', ownerName: 'А', itemId: 'ammo9', category: 'ammo', qty: 2, price: 5, durationMs: 24 * HOUR
  }, market.normalizeMarketRules({}), 2);
  const moved = migrateLegacyMarket(markets, plain(again), 3);
  assert.deepEqual(plain(moved), { orders: 1, shelves: 1 });
  assert.equal(markets.legacyShelves.a.silver, 13, 'a second migration adds to the waiting shelf');
  assert.equal(markets.migratedAt, 3);
}

console.log('City auctions OK: a book per capital, 8%/4% tax with the resident discount, 2.5% setup fee, up to 30-day orders, the seller rate kept in the order, and a one-time migration of the shared book onto owner shelves.');
