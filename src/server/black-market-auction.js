'use strict';

const { blackMarketUnitPrice, quoteBlackMarketSale, applyBlackMarketSale } = require('./black-market');
const { activeOrders, takeSellOrder } = require('./faction-market');

/** NPC demand is projected into the auction book without placing player-owned buy orders. */
function blackMarketBids(state, config, priceOf, capShare = 0) {
  let available = Math.max(0, Math.floor(Number(state?.treasury) || 0));
  const bids = [];
  for (const itemId of Object.keys(state?.orders || {}).sort()) {
    const demand = state.orders[itemId];
    const price = blackMarketUnitPrice(state, config, priceOf(itemId), 100, capShare, itemId);
    if (price <= 0 || demand.qty <= 0) continue;
    const qty = Math.min(demand.qty, Math.floor(available / price));
    if (qty <= 0) continue;
    bids.push({ id: `bm_${itemId}`, side: 'buy', itemId, qty, price,
      ownerName: 'Чёрный рынок', mine: false, filled: 0, remainingSeconds: 0,
      durationHours: 0, condition: 100, npc: true });
    available -= qty * price;
  }
  return bids;
}

/** Fill resting player asks when NPC demand reaches their price. Payout stays on the auction shelf. */
function settleBlackMarketAsks(state, book, config, priceOf, accepts, capShare, rules, now = Date.now()) {
  const fills = [];
  const asks = activeOrders(book, now).filter(row => row.side === 'sell' && accepts(row.itemId))
    .sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
  for (const ask of asks) {
    const bid = blackMarketBids(state, config, priceOf, capShare).find(row => row.itemId === ask.itemId);
    if (!bid || bid.qty <= 0) continue;
    const take = Math.min(ask.qty, bid.qty);
    const conditions = Array(take).fill(ask.condition ?? 100);
    const quote = quoteBlackMarketSale(state, config,
      [{ id: ask.itemId, qty: take, conditions }], priceOf, accepts, capShare);
    if (!quote.ok || quote.lines[0].units.some(price => price < ask.price)) continue;
    const cost = take * ask.price;
    // Validate stock and treasury on a draft before crediting the seller.
    const draft = structuredClone(state);
    const payment = applyBlackMarketSale(draft, config,
      { ...quote, total: cost, lines: quote.lines.map(line => ({ ...line, units: Array(take).fill(ask.price), total: cost })) },
      priceOf, now);
    if (!payment.ok) continue;
    const sale = takeSellOrder(book, ask.id, 'blackmarket', take, rules, now);
    if (!sale.ok) continue;
    Object.assign(state, draft);
    fills.push({ orderId: ask.id, sellerCharacterId: ask.ownerCharacterId,
      itemId: ask.itemId, qty: take, price: ask.price, proceeds: sale.payout,
      records: sale.records });
  }
  return fills;
}

module.exports = { blackMarketBids, settleBlackMarketAsks };
