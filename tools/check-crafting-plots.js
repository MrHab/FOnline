#!/usr/bin/env node
'use strict';

// Участки столиц экономики v3 (библия 14.5): торги за аренду станка, возврат
// перебитых ставок, продление и смена арендатора, плата за пользование
// (арендатору, а на свободном участке — сгорает), возврат материалов по
// формуле 1 − 1/(1 + бонус/100) и нормализация сохранения.

const assert = require('node:assert/strict');
const path = require('node:path');
const plots = require('../src/server/crafting-plots');
const { loadWorldEconomy } = require('../src/server/world-economy');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const economy = loadWorldEconomy(path.join(__dirname, '..', 'data', 'kromka', 'economy.json'));
const config = economy.plots;
const plain = value => JSON.parse(JSON.stringify(value));

// --- настройки ------------------------------------------------------------------------
assert.equal(economy.worldModel.npcStations, false, 'v3 turns NPC stations into plots');
assert.equal(config.leaseDays, 7);
assert.equal(config.auctionHours, 24);
assert.equal(config.plotBonus, 18);
assert.equal(config.regionBonus, 15);
assert(config.excludedLocations.includes('tutorialCaravanYard') && config.excludedLocations.includes('personalBase'));
assert.equal(plots.plotIdFor('scrapTown', 'capital_station_scrap_union_weapon_bench'), 'scrapTown__capital_station_scrap_union_weapon_bench');
assert.equal(plots.plotIdFor('', 'x'), '');

// --- возврат материалов --------------------------------------------------------------
{
  const base = plots.plotReturnRate(config, 'sluiceCity', 'weapon_bench');
  assert.equal(Number(base.toFixed(4)), Number((1 - 1 / 1.18).toFixed(4)), 'a plot returns 15.25% of materials');
  const regionalLocation = Object.keys(config.regions)[0];
  const regionalStation = config.regions[regionalLocation][0];
  assert.equal(Number(plots.plotReturnRate(config, regionalLocation, regionalStation).toFixed(4)), Number((1 - 1 / 1.33).toFixed(4)),
    'a profile region adds +15 bonus');
  assert.equal(Number(plots.plotReturnRate(config, 'x', 'y', true).toFixed(4)), Number((1 - 1 / 1.77).toFixed(4)), 'premium focus adds +59');
  const rows = plots.rollPlotReturns([{ id: 'scrap', qty: 10 }, { id: 'silver', qty: 5 }, { id: 'wood', qty: 1 }], 0.25, () => 0.4);
  assert.deepEqual(plain(rows), [{ id: 'scrap', qty: 3 }], '2.5 scrap → 2 + roll; marks never return; 0.25 wood fails the roll');
}

// --- торги ---------------------------------------------------------------------------------
{
  const t0 = 10 * DAY;
  const state = plots.normalizeCraftingPlotState(null, config);
  const plot = plots.ensurePlot(state, config, { locationId: 'scrapTown', objectId: 'bench', station: 'weapon_bench' });
  assert.equal(plots.auctionOpen(plot, config, t0), true, 'a free plot is open for bids');
  assert.equal(plots.placePlotBid(state, config, plot.id, { characterId: 'a', name: 'А' }, config.minBid - 1, t0).ok, false, 'a bid below the minimum is refused');
  const first = plots.placePlotBid(state, config, plot.id, { characterId: 'a', name: 'А' }, config.minBid, t0);
  assert(first.ok && first.refunded === null);
  assert.equal(plot.auctionEndsAt, t0 + config.auctionHours * HOUR, 'the auction of a free plot runs for a day from the first bid');
  assert.equal(plots.placePlotBid(state, config, plot.id, { characterId: 'a', name: 'А' }, 999, t0 + 1).ok, false, 'the leader does not outbid itself');
  const need = plots.minNextBid(plot, config);
  assert.equal(need, Math.ceil(config.minBid * (1 + config.bidStepPct)));
  const second = plots.placePlotBid(state, config, plot.id, { characterId: 'b', name: 'Б' }, need, t0 + 2);
  assert.deepEqual(plain(second.refunded), { characterId: 'a', amount: config.minBid }, 'the outbid mark returns to its owner');
  assert.equal(state.payouts.a, config.minBid);
  assert.equal(plots.takePayout(state, 'a', 10), 10, 'a payout can be taken in part');
  assert.equal(plots.takePayout(state, 'a'), config.minBid - 10);
  assert.equal(state.payouts.a, undefined);
  // Ставка в последние минуты продлевает торги.
  const late = plot.auctionEndsAt - 60000;
  plots.placePlotBid(state, config, plot.id, { characterId: 'c', name: 'В' }, plots.minNextBid(plot, config), late);
  assert.equal(plot.auctionEndsAt, late + config.extendMinutes * 60000, 'a late bid extends the auction');
  // Итоги: победитель арендует участок, ставка сгорает.
  assert.deepEqual(plots.settleCraftingPlots(state, config, plot.auctionEndsAt - 1), []);
  const settleAt = plot.auctionEndsAt;
  const changes = plots.settleCraftingPlots(state, config, settleAt);
  assert.equal(changes[0].kind, 'leased');
  assert.equal(plot.lessee.characterId, 'c');
  assert.equal(plot.leaseEndsAt, settleAt + config.leaseDays * DAY);
  assert.equal(plot.bid, null);
  assert.equal(state.payouts.b, need, 'the second bidder got the stake back as well');
  // Во время аренды торги закрыты, за сутки до конца — открыты.
  assert.equal(plots.auctionOpen(plot, config, settleAt + DAY), false);
  assert.equal(plots.placePlotBid(state, config, plot.id, { characterId: 'd', name: 'Г' }, 5000, settleAt + DAY).ok, false);
  const renewAt = plot.leaseEndsAt - 2 * HOUR;
  assert.equal(plots.auctionOpen(plot, config, renewAt), true);
  // Арендатор продлевает: торги кончаются вместе с арендой.
  assert(plots.placePlotBid(state, config, plot.id, { characterId: 'c', name: 'В' }, config.minBid, renewAt).ok);
  assert.equal(plot.auctionEndsAt, plot.leaseEndsAt, 'a leased plot auction ends with the lease');
  plots.setPlotFee(state, config, plot.id, 'c', 0.12, renewAt);
  const oldEnd = plot.leaseEndsAt;
  assert.equal(plots.settleCraftingPlots(state, config, oldEnd)[0].kind, 'renewed');
  assert.equal(plot.leaseEndsAt, oldEnd + config.leaseDays * DAY, 'the renewal continues from the end of the lease');
  assert.equal(plot.feePct, 0.12, 'a renewing lessee keeps its fee');
  // Никто не продлил — аренда кончается, участок снова свободен.
  const expire = plots.settleCraftingPlots(state, config, plot.leaseEndsAt);
  assert.equal(expire[0].kind, 'expired');
  assert.equal(plot.lessee, null);
  assert.equal(plot.feePct, config.defaultFeePct);
}

// --- плата арендатора ------------------------------------------------------------------
{
  const now = 50 * DAY;
  const state = plots.normalizeCraftingPlotState({
    plots: {
      p1: { locationId: 'scrapTown', objectId: 'bench', station: 'tool_bench', lessee: { characterId: 'owner', name: 'Хозяин' },
        leaseStartsAt: now - DAY, leaseEndsAt: now + DAY, feePct: 0.1 }
    }
  }, config);
  const plot = state.plots.p1;
  assert.equal(plots.setPlotFee(state, config, 'p1', 'stranger', 0.2, now).ok, false, 'only the lessee sets the fee');
  assert.equal(plots.setPlotFee(state, config, 'p1', 'owner', config.maxFeePct + 0.01, now).ok, false);
  assert.equal(plots.setPlotFee(state, config, 'p1', 'owner', 0.2, now).ok, true);
  assert.deepEqual(plain(plots.plotCraftFee(plot, config, 'guest', 90, 2, now)), { fee: 18, payee: 'owner', leased: true, own: false });
  assert.deepEqual(plain(plots.plotCraftFee(plot, config, 'owner', 90, 2, now)), { fee: 0, payee: null, leased: true, own: true },
    'the lessee works for free');
  assert.equal(plots.plotCraftFee(plot, config, 'guest', 5, 2, now).fee, 2, 'the recipe fee is the floor');
  const free = plots.plotCraftFee(plot, config, 'guest', 90, 2, now + 2 * DAY);
  assert.deepEqual(plain(free), { fee: Math.ceil(90 * config.unleasedFeePct), payee: null, leased: false, own: false },
    'an unleased plot charges the settlement rate, which burns');
  const view = plots.publicPlot(plot, config, 'owner', now);
  assert.equal(view.mine, true);
  assert.equal(view.feePct, 0.2);
  assert(!JSON.stringify(view).includes('"owner"'), 'the public view never leaks character ids');
  assert.equal(plots.publicPlot(plot, config, 'guest', now).mine, false);
}

// --- испорченное сохранение ----------------------------------------------------------
{
  const state = plots.normalizeCraftingPlotState({
    plots: { 'bad id!': { lessee: { characterId: '' }, bid: { characterId: 'x', amount: -5 }, feePct: 99 } },
    payouts: { good: 12, bad: -3, '': 7 }
  }, config);
  const row = state.plots.badid;
  assert(row && row.lessee === null && row.bid === null && row.feePct === config.maxFeePct);
  assert.deepEqual(plain(state.payouts), { good: 12 });
}

console.log('Crafting plots OK: lease auctions with refunds, late-bid extension, renewal and expiry, lessee fees and burned settlement fees, 15–43% material returns, and a clean saved state.');
