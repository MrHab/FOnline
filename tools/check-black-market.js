#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeBlackMarketConfig, normalizeBlackMarketState, serializeBlackMarketState,
  blackMarketUnitPrice, quoteBlackMarketSale, applyBlackMarketSale,
  fundBlackMarket, takeBlackMarketLoot, decayBlackMarket,
  blackMarketFatigueFactor, publicBlackMarketState
} = require('../src/server/black-market');
const { blackMarketBids, settleBlackMarketAsks } = require('../src/server/black-market-auction');
const { normalizeMarketStore, normalizeMarketRules, placeSellOrder, cancelOrder, shelfFor } = require('../src/server/faction-market');

const economy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kromka', 'economy.json'), 'utf8'));
const config = normalizeBlackMarketConfig(economy.blackMarket);
const prices = { knife: 8, pistol: 40, leather: 30, rifle: 80, heavyArmor: 300, rocketLauncher: 900 };
const priceOf = id => prices[id] || 0;
const accepts = id => Object.hasOwn(prices, id);
const HOUR = 3600000;

assert.equal(economy.worldModel.npcTraders, false, 'equipment enters the market through players');
assert.equal(config.hubLocationId, 'coreMarket');
assert.deepEqual([...config.categories], ['weapons', 'armor']);
assert.equal(config.treasuryShare, 0.2);

{
  const state = normalizeBlackMarketState({ stock: { leather: [{ c: 80, t: 1 }] } }, config, 0);
  assert.equal(takeBlackMarketLoot(state, config, 45, priceOf, ['leather', 'pistol'], () => 0.9), null,
    'a roll for pistol cannot substitute stocked leather');
  assert.equal(state.orders.pistol.qty, 1);
  assert.equal(state.stock.leather.length, 1);
  assert.deepEqual(takeBlackMarketLoot(state, config, 45, priceOf, ['leather', 'pistol'], () => 0.1),
    { itemId: 'leather', condition: 80 });
}

// A loot roll creates demand for its exact item. An item in the same value
// band gets neither an order nor a price.
{
  const state = normalizeBlackMarketState({}, config, 0);
  assert.equal(blackMarketUnitPrice(state, config, 40, 100, 0, 'pistol'), 0);
  assert.equal(quoteBlackMarketSale(state, config, [{ id: 'pistol', qty: 1 }], priceOf, accepts).ok, false);
  assert.equal(takeBlackMarketLoot(state, config, 45, priceOf, ['pistol'], () => 0), null);
  assert.equal(state.orders.pistol.qty, 1);
  assert.equal(state.orders.pistol.multiplier, 1.04);
  assert.equal(blackMarketUnitPrice(state, config, 30, 100, 0, 'leather'), 0);
  takeBlackMarketLoot(state, config, 45, priceOf, ['pistol'], () => 0);
  assert.equal(state.orders.pistol.qty, 2);
  assert.equal(state.orders.pistol.multiplier, 1.08);
  assert.equal(state.bands.common.unmet, 2);

  assert.equal(quoteBlackMarketSale(state, config, [{ id: 'pistol', qty: 1, conditions: [5] }], priceOf, accepts).ok, false);
  assert.equal(quoteBlackMarketSale(state, config, [{ id: 'food', qty: 1 }], priceOf, accepts).ok, false);
  assert.equal(quoteBlackMarketSale(state, config, [{ id: 'pistol', qty: 3 }], priceOf, accepts).ok, false);
  assert.equal(quoteBlackMarketSale(state, config, [
    { id: 'pistol', qty: 1 }, { id: 'pistol', qty: 2 }
  ], priceOf, accepts).ok, false, 'split rows cannot overfill an order');

  const quote = quoteBlackMarketSale(state, config, [{ id: 'pistol', qty: 2, conditions: [100, 50] }], priceOf, accepts);
  assert.equal(quote.ok, true);
  assert.deepEqual(quote.lines[0].units, [19, 9]);
  const before = state.treasury;
  assert.equal(applyBlackMarketSale(state, config, quote, priceOf, 1000).ok, true);
  assert.equal(state.treasury, before - 28);
  assert.equal(state.orders.pistol, undefined, 'filled orders disappear');
  assert.deepEqual(state.stock.pistol.map(row => row.c), [100, 50]);
  assert.equal(applyBlackMarketSale(state, config, quote, priceOf, 1000).ok, false, 'a stale quote cannot buy again');
  assert.deepEqual(takeBlackMarketLoot(state, config, 45, priceOf, ['pistol'], () => 0),
    { itemId: 'pistol', condition: 100 });
  assert.deepEqual(takeBlackMarketLoot(state, config, 45, priceOf, ['pistol'], () => 0),
    { itemId: 'pistol', condition: 50 });
  assert.equal(takeBlackMarketLoot(state, config, 45, priceOf, ['pistol'], () => 0), null);
  assert.equal(state.orders.pistol.qty, 1);
  assert.equal(state.dropped, 2);
}

// A budget cannot request elite gear, and demand never exceeds stock capacity.
{
  const state = normalizeBlackMarketState({}, config, 0);
  assert.equal(takeBlackMarketLoot(state, config, 40, priceOf, ['rocketLauncher'], () => 0), null);
  assert.equal(state.orders.rocketLauncher, undefined);
  for (let i = 0; i < config.maxStockPerItem + 10; i += 1) {
    takeBlackMarketLoot(state, config, 1000, priceOf, ['rocketLauncher'], () => 0);
  }
  assert.equal(state.orders.rocketLauncher.qty, config.maxStockPerItem);
  assert.equal(state.orders.rocketLauncher.multiplier, config.maxMultiplier);
}

// NPC marks fund purchases, and an empty treasury cannot pay for an order.
{
  const state = normalizeBlackMarketState({ treasury: 0, orders: { knife: { qty: 1, multiplier: 1 } } }, config, 0);
  const quote = quoteBlackMarketSale(state, config, [{ id: 'knife', qty: 1 }], priceOf, accepts);
  assert.equal(applyBlackMarketSale(state, config, quote, priceOf, 1000).ok, false);
  assert.equal(fundBlackMarket(state, config, 20), 16);
  assert.equal(state.treasury, 4);
  assert.equal(applyBlackMarketSale(state, config, quote, priceOf, 1000).ok, true);
  assert.equal(state.treasury, 1);
  assert.equal(fundBlackMarket(state, config, 3), 3);
}

// Legacy saves retain their money and stock. New orders survive a restart.
{
  const state = normalizeBlackMarketState({ version: 1, treasury: 12, stock: { knife: [{ c: 80, t: 1 }] } }, config, 0);
  assert.equal(state.treasury, 12);
  assert.deepEqual(state.stock.knife, [{ c: 80, t: 1 }]);
  takeBlackMarketLoot(state, config, 45, priceOf, ['pistol'], () => 0);
  const restored = normalizeBlackMarketState(JSON.parse(JSON.stringify(serializeBlackMarketState(state))), config, 0);
  assert.deepEqual(restored.orders, state.orders);
  assert.deepEqual(restored.stock, state.stock);
  const publicState = publicBlackMarketState(restored, config, priceOf);
  assert.equal(publicState.orders.pistol, 1);
  assert.deepEqual(publicState.buyOrders, [{ id: 'pistol', qty: 1, price: 18 }]);
}

// Time relaxes outstanding prices; low-value stock is still removed.
{
  const state = normalizeBlackMarketState({ lastDecayAt: 0,
    orders: { pistol: { qty: 2, multiplier: 1.5 } },
    stock: { knife: Array.from({ length: 50 }, (_, t) => ({ c: 100, t })) }
  }, config, 0);
  const result = decayBlackMarket(state, config, priceOf, 24 * HOUR);
  assert.equal(result.destroyed, 5);
  assert.equal(result.pricesChanged, true, 'price decay must be persisted');
  assert.equal(state.stock.knife.length, 45);
  assert(state.orders.pistol.multiplier < 1.5 && state.orders.pistol.multiplier >= 1);
}

{
  const tracker = {};
  for (let i = 0; i < config.fatigue.freeKills; i += 1) {
    assert.equal(blackMarketFatigueFactor(tracker, config, 1000), 1);
  }
  assert(blackMarketFatigueFactor(tracker, config, 1000) < 1);
  assert.equal(blackMarketFatigueFactor(tracker, config, 1000 + config.fatigue.windowMinutes * 60000 + 1), 1);
}

// A player ask keeps its item in the auction book until the NPC bid reaches it.
{
  const state = normalizeBlackMarketState({ treasury: 1000,
    orders: { pistol: { qty: 1, multiplier: 1 } }
  }, config, 0);
  const book = normalizeMarketStore();
  const rules = normalizeMarketRules({ durationChoicesMs: [24 * HOUR],
    listingLifetimeMs: 24 * HOUR, taxPct: 0.08 });
  const ask = placeSellOrder(book, { ownerCharacterId: 'seller', ownerName: 'Seller',
    itemId: 'pistol', category: 'weapons', qty: 1, price: 20,
    condition: 75, durationMs: 24 * HOUR }, rules, 1000);
  assert(ask.ok && ask.restingQty === 1);
  assert.equal(settleBlackMarketAsks(state, book, config, priceOf, accepts, 0, rules, 1001).length, 0);
  for (let i = 0; i < 20 && blackMarketUnitPrice(state, config, 40, 75, 0, 'pistol') < 20; i += 1) {
    takeBlackMarketLoot(state, config, 45, priceOf, ['pistol'], () => 0);
  }
  assert(blackMarketBids(state, config, priceOf)[0].price >= 20);
  const fills = settleBlackMarketAsks(state, book, config, priceOf, accepts, 0, rules, 1002);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].price, 20, 'An NPC taking a resting ask pays the ask price.');
  assert.equal(state.treasury, 980);
  assert.deepEqual(state.stock.pistol.map(row => row.c), [75]);
  assert.equal(shelfFor(book, 'seller').silver, 19, 'The seller receives the ask minus auction tax.');
  assert.equal(book.orders[ask.order.id], undefined);

  const waiting = placeSellOrder(book, { ownerCharacterId: 'seller', itemId: 'pistol',
    category: 'weapons', qty: 1, price: 100, condition: 55,
    durationMs: 24 * HOUR }, rules, 2000);
  assert(waiting.ok);
  assert(cancelOrder(book, waiting.order.id, 'seller', 2001).ok);
  assert.equal(shelfFor(book, 'seller').items[0].condition, 55,
    'A cancelled worn item keeps its condition on the auction shelf.');
}

console.log('Black market OK: exact-item demand orders, capped purchases, player-made loot, treasury and persistence.');
