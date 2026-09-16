#!/usr/bin/env node
'use strict';

// Чёрный рынок экономики v3 (библия 14.5): скупка без потолка по количеству,
// казна из доли марок NPC, склад по полосам ценности → добыча NPC, рост цены
// пустой полосы, возврат цен к норме, «продажный» скупщик и усталость зоны.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
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
} = require('../src/server/black-market');

const root = path.resolve(__dirname, '..');
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
const config = normalizeBlackMarketConfig(economy.blackMarket);
const PRICES = { knife: 8, pistol: 40, leather: 30, rifle: 80, heavyArmor: 300, rocketLauncher: 900 };
const priceOf = id => PRICES[id] || 0;
const accepts = id => ['knife', 'pistol', 'leather', 'rifle', 'heavyArmor', 'rocketLauncher'].includes(id);
const HOUR = 3600000;

// --- настройки из data/kromka/economy.json ----------------------------------------
assert.equal(config.hubLocationId, 'coreMarket', 'the market lives in the core hub');
assert.equal(config.service, 'blackMarket');
assert.deepEqual([...config.categories], ['weapons', 'armor'], 'the market buys weapons and armour only');
assert.equal(config.treasuryShare, 0.2, 'a fifth of NPC marks funds the market');
assert.deepEqual(config.bands.map(band => band.id), ['cheap', 'common', 'good', 'rare', 'elite']);
assert.equal(bandIndex(config, 8), 0);
assert.equal(bandIndex(config, 40), 1);
assert.equal(bandIndex(config, 900), 4);

// --- смета и продажа ---------------------------------------------------------------
{
  const state = normalizeBlackMarketState({}, config, 0);
  assert.equal(state.treasury, config.startingTreasury);
  assert.equal(blackMarketUnitPrice(state, config, 40, 100), Math.floor(40 * config.priceShare));
  assert.equal(blackMarketUnitPrice(state, config, 40, 50), Math.floor(40 * config.priceShare * 0.5), 'a worn item is worth less');
  const broken = quoteBlackMarketSale(state, config, [{ id: 'pistol', qty: 1, conditions: [5] }], priceOf, accepts);
  assert.equal(broken.ok, false, 'the market refuses broken items');
  const food = quoteBlackMarketSale(state, config, [{ id: 'food', qty: 1 }], priceOf, accepts);
  assert.equal(food.ok, false, 'the market refuses what is not equipment');
  const quote = quoteBlackMarketSale(state, config, [
    { id: 'pistol', qty: 2, conditions: [100, 50] },
    { id: 'leather', qty: 1, condition: 80 }
  ], priceOf, accepts);
  assert.equal(quote.ok, true);
  assert.equal(quote.total, 18 + 9 + 10);
  const sale = applyBlackMarketSale(state, config, quote, priceOf, 1000);
  assert.equal(sale.ok, true);
  assert.equal(state.treasury, config.startingTreasury - 37, 'the treasury pays for the sale');
  assert.deepEqual(state.stock.pistol.map(row => row.c), [100, 50], 'the stock keeps the condition of every unit');
  assert(state.bands.common.multiplier < 1, 'selling lowers the band price');
  const poor = normalizeBlackMarketState({ treasury: 5 }, config, 0);
  const refused = applyBlackMarketSale(poor, config, quote, priceOf, 1000);
  assert.equal(refused.ok, false, 'an empty treasury cannot buy');
  assert.equal(poor.treasury, 5);
}

// --- казна из марок NPC ---------------------------------------------------------------
{
  const state = normalizeBlackMarketState({ treasury: 0 }, config, 0);
  assert.equal(fundBlackMarket(state, config, 20), 16, 'the corpse keeps four fifths of its marks');
  assert.equal(state.treasury, 4);
  assert.equal(fundBlackMarket(state, config, 3), 3, 'small change is not split');
}

// --- добыча NPC со склада --------------------------------------------------------------
{
  const state = normalizeBlackMarketState({
    treasury: 0,
    stock: { pistol: [{ c: 70, t: 20 }], leather: [{ c: 90, t: 10 }], knife: [{ c: 100, t: 5 }] }
  }, config, 0);
  const first = takeBlackMarketLoot(state, config, 45, priceOf);
  assert.deepEqual(first, { itemId: 'leather', condition: 90 }, 'the oldest item of the budget band drops first');
  const second = takeBlackMarketLoot(state, config, 45, priceOf);
  assert.deepEqual(second, { itemId: 'pistol', condition: 70 });
  const before = state.bands.common.multiplier;
  const fallback = takeBlackMarketLoot(state, config, 45, priceOf);
  assert.deepEqual(fallback, { itemId: 'knife', condition: 100 }, 'an empty band falls back to a cheaper one');
  assert(state.bands.common.multiplier > before, 'an empty band raises its buy price');
  assert.equal(state.bands.common.unmet, 1);
  assert.equal(takeBlackMarketLoot(state, config, 45, priceOf), null, 'an empty market gives nothing');
  assert.equal(state.dropped, 3);
  const rich = normalizeBlackMarketState({ stock: { rocketLauncher: [{ c: 100, t: 1 }] } }, config, 0);
  assert.equal(takeBlackMarketLoot(rich, config, 100, priceOf), null, 'a weak NPC never drops an elite item');
  // Бюджет 25 попадает в полосу до 60: пистолет за 40 дороже бюджета, но
  // полоса полная — он выпадает, и цена полосы не растёт.
  const full = normalizeBlackMarketState({ stock: { pistol: [{ c: 100, t: 1 }, { c: 100, t: 2 }] } }, config, 0);
  assert.deepEqual(takeBlackMarketLoot(full, config, 25, priceOf), { itemId: 'pistol', condition: 100 },
    'a stocked band is drawn even when the item costs more than the budget');
  assert.equal(full.bands.common.multiplier, 1, 'a stocked band does not raise its price');
}

// --- потолок цены, пока работают NPC-торговцы ----------------------------------------
{
  const state = normalizeBlackMarketState({ bands: { common: { multiplier: 2.5 } } }, config, 0);
  assert.equal(config.npcResaleCapShare, 0.38);
  assert.equal(blackMarketUnitPrice(state, config, 40, 100), Math.floor(40 * config.priceShare * 2.5), 'no cap without NPC traders');
  assert.equal(blackMarketUnitPrice(state, config, 40, 100, config.npcResaleCapShare), Math.floor(40 * 0.38),
    'NPC-bought gear never sells to the market above the cheapest NPC price');
  assert.equal(blackMarketUnitPrice(state, config, 40, 50, config.npcResaleCapShare), Math.floor(40 * 0.38 * 0.5));
  const capped = quoteBlackMarketSale(state, config, [{ id: 'pistol', qty: 1 }], priceOf, accepts, config.npcResaleCapShare);
  assert.equal(capped.total, Math.floor(40 * 0.38));
}

// --- время: цены возвращаются, дешёвый склад уничтожается -------------------------------
{
  const state = normalizeBlackMarketState({
    lastDecayAt: 0,
    bands: { common: { multiplier: 1.5 }, good: { multiplier: 0.8 } },
    stock: { knife: Array.from({ length: 50 }, (_, t) => ({ c: 100, t })), pistol: [{ c: 100, t: 1 }] }
  }, config, 0);
  const decay = decayBlackMarket(state, config, priceOf, 24 * HOUR);
  assert(state.bands.common.multiplier < 1.5 && state.bands.common.multiplier >= 1);
  assert(state.bands.good.multiplier > 0.8 && state.bands.good.multiplier <= 1);
  assert.equal(decay.destroyed, 5, 'a tenth of the cheap stock disappears per day');
  assert.equal(state.stock.knife.length, 45);
  assert.equal(state.stock.knife[0].t, 5, 'the oldest cheap items go first');
  assert.equal(state.stock.pistol.length, 1, 'more valuable bands are kept');
  let small = 0;
  const hourly = normalizeBlackMarketState({ lastDecayAt: 0, stock: { knife: Array.from({ length: 20 }, (_, t) => ({ c: 100, t })) } }, config, 0);
  for (let hour = 1; hour <= 24; hour += 1) small += decayBlackMarket(hourly, config, priceOf, hour * HOUR).destroyed;
  // Склад тает по ходу суток, поэтому почасовой итог чуть меньше суточного, но
  // частые тики не теряют дробную долю.
  assert(small >= 1 && small <= 2, 'hourly ticks keep destroying the cheap stock: ' + small);
}

// --- усталость зоны -----------------------------------------------------------------
{
  const tracker = {};
  let factor = 1;
  for (let kill = 1; kill <= config.fatigue.freeKills; kill += 1) factor = blackMarketFatigueFactor(tracker, config, 1000);
  assert.equal(factor, 1, 'the first kills keep the full budget');
  factor = blackMarketFatigueFactor(tracker, config, 1000);
  assert(factor < 1, 'farming a zone lowers the budget');
  for (let kill = 0; kill < 500; kill += 1) factor = blackMarketFatigueFactor(tracker, config, 1000);
  assert.equal(factor, config.fatigue.minFactor, 'the budget never drops below the floor');
  assert.equal(blackMarketFatigueFactor(tracker, config, 1000 + config.fatigue.windowMinutes * 60000 + 1), 1, 'a quiet window resets it');
}

// --- сохранение ------------------------------------------------------------------------
{
  const state = normalizeBlackMarketState({ stock: { knife: [{ c: 100, t: 1 }] } }, config, 0);
  decayBlackMarket(state, config, priceOf, HOUR);
  const restored = normalizeBlackMarketState(JSON.parse(JSON.stringify(serializeBlackMarketState(state))), config, 0);
  assert.deepEqual(restored.stock, { knife: [{ c: 100, t: 1 }] });
  const pub = publicBlackMarketState(restored, config);
  assert.equal(pub.stockCount, 1);
  assert.equal(pub.bands.length, 5);
}

console.log('Black market OK: unlimited buying from the treasury, marks share, band-ordered NPC loot, rising price of an empty band, price relaxation, corrupt merchant and zone fatigue.');
