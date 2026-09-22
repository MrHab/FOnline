'use strict';

const HOUR = 3600000;
const RETENTION = 28 * 24 * HOUR;
const MAX_ACTIVITY = 5000;
const id = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
const positive = value => Number.isSafeInteger(value) && value > 0;

// Hourly aggregates keep price history bounded without discarding volume on
// busy markets. Individual receipts are a separate, bounded recent journal.
function normalizeHistory(input = {}) {
  const history = Object.create(null);
  for (const [key, rows] of Object.entries(input || {})) {
    if (!id(key) || !Array.isArray(rows)) continue;
    history[id(key)] = rows.filter(row => row && positive(row.qty) && positive(row.value)
      && Number.isSafeInteger(row.at) && positive(row.min) && positive(row.max)
      && positive(row.trades)).map(row => ({ at: row.at, qty: row.qty, value: row.value,
      min: row.min, max: row.max, trades: row.trades })).sort((a, b) => a.at - b.at).slice(-673);
  }
  return history;
}

function normalizeActivity(input = []) {
  return (Array.isArray(input) ? input : []).filter(row => row && id(row.owner)
    && ['bought', 'sold', 'cancelled', 'expired', 'updated'].includes(row.kind))
    .slice(-MAX_ACTIVITY).map(row => ({ owner: id(row.owner), kind: row.kind,
      itemId: id(row.itemId), qty: Math.max(0, Math.floor(Number(row.qty) || 0)),
      price: Math.max(0, Math.floor(Number(row.price) || 0)),
      tax: Math.max(0, Math.floor(Number(row.tax) || 0)), at: Math.max(0, Math.floor(Number(row.at) || 0)) }));
}

function recordActivity(store, owner, kind, order, now, tax = 0) {
  if (!Array.isArray(store.activity)) store.activity = [];
  store.activity.push({ owner, kind, itemId: order.itemId, qty: order.qty,
    price: order.price, tax, at: now });
  if (store.activity.length > MAX_ACTIVITY) store.activity.splice(0, store.activity.length - MAX_ACTIVITY);
}

function recordTrade(store, itemId, qty, price, buyer, seller, tax, now) {
  if (!store.history) store.history = {};
  const at = Math.floor(now / HOUR) * HOUR;
  const rows = (store.history[itemId] || []).filter(row => row.at >= at - RETENTION);
  let bucket = rows.find(row => row.at === at);
  if (!bucket) { bucket = { at, qty: 0, value: 0, min: price, max: price, trades: 0 }; rows.push(bucket); }
  bucket.qty += qty;
  bucket.value += qty * price;
  bucket.min = Math.min(bucket.min, price);
  bucket.max = Math.max(bucket.max, price);
  bucket.trades += 1;
  store.history[itemId] = rows;
  const order = { itemId, qty, price };
  recordActivity(store, buyer, 'bought', order, now);
  recordActivity(store, seller, 'sold', order, now, tax);
}

function publicHistory(store, itemId, now) {
  const key = id(itemId);
  const source = store.history && Object.prototype.hasOwnProperty.call(store.history, key) ? store.history[key] : null;
  const rows = (Array.isArray(source) ? source : []).filter(row => row.at <= now);
  return [24, 168, 672].map(hours => {
    const cutoff = Math.floor(now / HOUR) * HOUR - (hours - 1) * HOUR;
    const points = rows.filter(row => row.at >= cutoff);
    const qty = points.reduce((sum, row) => sum + row.qty, 0);
    const value = points.reduce((sum, row) => sum + row.value, 0);
    return { hours, qty, average: qty ? Math.round(value / qty * 100) / 100 : 0,
      min: points.length ? Math.min(...points.map(row => row.min)) : 0,
      max: points.length ? Math.max(...points.map(row => row.max)) : 0,
      trades: points.reduce((sum, row) => sum + row.trades, 0) };
  });
}

function publicActivity(store, owner) {
  return (store.activity || []).filter(row => row.owner === owner).slice(-50).reverse()
    .map(({ owner: ignored, ...row }) => row);
}

module.exports = { normalizeHistory, normalizeActivity, recordActivity, recordTrade, publicHistory, publicActivity };
