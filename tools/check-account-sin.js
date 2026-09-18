#!/usr/bin/env node
'use strict';

// Синь и премиум экономики v3 (библия 14.5): счёт аккаунта, зачисление и
// списание, покупка и продление премиума, фокус — копится только под
// премиумом, не выше предела, и тратится на заказы у станков.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sin = require('../src/server/account-sin');
const { loadWorldEconomy, normalizeWorldEconomy } = require('../src/server/world-economy');

const DAY = 24 * 3600000;
const economy = loadWorldEconomy(path.join(__dirname, '..', 'data', 'kromka', 'economy.json'));
const config = economy.accountSin;
const plain = value => JSON.parse(JSON.stringify(value));

// --- настройки ------------------------------------------------------------------------
assert.equal(normalizeWorldEconomy({}).worldModel.accountSin, false, 'without settings sin stays a backpack item');
assert.equal(economy.worldModel.accountSin, true, 'v3 keeps sin on the account');
assert.equal(config.itemId, 'blue', 'sin cassettes are the blue item');
assert.equal(config.premium.auctionTaxPct, 0.04);
assert.equal(config.premium.xpMultiplier, 1.5);
assert.equal(config.premium.npcMarksMultiplier, 1.5);
assert.equal(config.premium.gatherMultiplier, 1.5);
assert.equal(config.focus.perDay, 10000);
assert.equal(config.focus.cap, 30000);
assert.equal(economy.auctions.premiumTaxPct, config.premium.auctionTaxPct, 'the auction and the premium agree on the tax');

// --- счёт -----------------------------------------------------------------------------
{
  const store = sin.normalizeAccountStore({ 'bad id!': { sin: -5 }, good: { sin: 12.7, premiumUntil: 'x' } }, config);
  assert.deepEqual(Object.keys(store).sort(), ['badid', 'good']);
  assert.equal(store.badid.sin, 0);
  assert.equal(store.good.sin, 12);
  assert.equal(store.good.premiumUntil, 0);
  const account = sin.accountFor(store, 'player-1', config);
  assert.equal(sin.accountFor(store, 'player-1', config), account, 'one account per id');
  assert.equal(sin.accountFor(store, '', config), null);
  assert.equal(sin.creditSin(account, config, 500, 'grant', 1), 500);
  assert.equal(sin.creditSin(account, config, -3, 'bad', 2), 0);
  assert.equal(sin.spendSin(account, config, 600, 'x', 3).ok, false, 'no overdraft');
  assert.equal(account.sin, 500);
  assert.deepEqual(plain(sin.spendSin(account, config, 200, 'siege', 4)), { ok: true, spent: 200 });
  assert.equal(account.sin, 300);
  assert.deepEqual(account.ledger.map(row => [row.delta, row.reason]), [[500, 'grant'], [-200, 'siege']]);
}

// --- премиум и фокус --------------------------------------------------------------------
{
  const store = {};
  const account = sin.accountFor(store, 'p', config);
  const t0 = 100 * DAY;
  sin.creditSin(account, config, config.premium.priceSin * 2, 'grant', t0);
  assert.equal(sin.premiumActive(account, t0), false);
  assert.equal(sin.spendFocus(account, config, 1, t0), false, 'no focus without premium');
  const first = sin.buyPremium(account, config, t0);
  assert(first.ok && account.premiumUntil === t0 + config.premium.days * DAY);
  assert.equal(sin.premiumActive(account, t0 + DAY), true);
  const second = sin.buyPremium(account, config, t0 + DAY);
  assert.equal(second.premiumUntil, t0 + 2 * config.premium.days * DAY, 'a renewal extends from the end of the term');
  assert.equal(sin.buyPremium(account, config, t0 + DAY).ok, false, 'premium costs sin');
  // Фокус: сутки премиума — суточная норма, не выше предела.
  assert.equal(Math.round(sin.refreshFocus(account, config, t0 + 2 * DAY)), config.focus.perDay * 2);
  assert.equal(sin.refreshFocus(account, config, t0 + 10 * DAY), config.focus.cap, 'focus stops at the cap');
  const cost = sin.focusCostFor(config, 15);
  assert.equal(cost, Math.max(config.focus.minCost, 15 * config.focus.costPerValue));
  assert.equal(sin.spendFocus(account, config, cost, t0 + 10 * DAY), true);
  assert.equal(Math.round(account.focus), config.focus.cap - cost);
  // Премиум кончился — фокус больше не копится и не тратится.
  const end = account.premiumUntil;
  const left = account.focus;
  sin.refreshFocus(account, config, end + 5 * DAY);
  assert(account.focus <= config.focus.cap && account.focus >= left, 'focus accrues only up to the premium end');
  assert.equal(sin.spendFocus(account, config, 1, end + 5 * DAY), false);
  // Показ фокуса учитывает накопленное, не меняя счёт.
  {
    const shown = sin.accountFor({}, 'shown', config);
    shown.premiumUntil = t0 + 30 * DAY;
    shown.focusUpdatedAt = t0;
    assert.equal(sin.publicAccount(shown, config, t0 + 2 * DAY).focus, 2 * config.focus.perDay, 'the shown focus includes the accrual');
    assert.equal(shown.focus, 0, 'showing does not change the account');
    assert.equal(Math.round(sin.focusAt(shown, config, t0 + DAY)), config.focus.perDay);
  }
  const view = sin.publicAccount(account, config, end + 5 * DAY);
  assert.deepEqual(Object.keys(view).sort(), ['focus', 'focusCap', 'focusCostPerValue', 'focusMinCost', 'marks', 'premium', 'premiumDays', 'premiumPriceSin', 'premiumUntil', 'sin']);
  assert.equal(view.premium, false);
  assert.equal(view.premiumUntil, 0);
}

// --- бонусы премиума подключены к серверу --------------------------------------------
{
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const [hook, label] of [
    ["Number(amount || 0) * serverPremiumMultiplier(p, 'xpMultiplier')", 'premium XP'],
    ["serverPremiumMultiplier(p, 'gatherMultiplier')", 'premium gathering'],
    ["serverPremiumMultiplier(p, 'npcMarksMultiplier')", 'premium NPC marks'],
    ["serverPremiumMultiplier(p, 'baseJobSpeedMultiplier')", 'premium base jobs'],
    ["plot && data.useFocus === true ? serverCraftFocusCost(player, plotOutput)", 'focus only when the player asks for it'],
    ["plotReturnRate(WORLD_ECONOMY.plots, locationId, requiredStation, focusCost > 0)", 'the focus bonus on returns'],
    ['serverNpcHoldsTraderBalance(enemy) ? 1', 'no premium marks from trader cash'],
    ['serverHarvestXp(Math.max(1, Math.round(qty / premiumGather)))', 'harvest XP without a double premium'],
    ['id => serverCostItemQty(p, id)', 'base jobs priced in sin'],
    ['saved = persistActivePlayerState(player) === true', 'cassettes saved with the account'],
    ['return !!account && sinPremiumActive(account, Date.now())', 'the auction premium tax'],
    ['serverConvertSinCassettes(p);', 'cassettes onto the account'],
    ['const sinCost = account ?', 'sin prices paid from the account'],
    ['else delete view.marks;', 'no account marks balance without marks on the account'],
    ['player.marksOnAccount = false;\n  return false;', 'a failed marks migration keeps the account untouched']
  ]) assert(server.includes(hook), `server.js wires ${label}`);
}

console.log('Account sin OK: an account balance with a ledger and no overdraft, premium bought and extended with sin, focus that accrues only under premium, caps and pays for crafting returns, and the premium bonuses wired into the server.');
