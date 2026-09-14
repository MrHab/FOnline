'use strict';

// Фракционный аукцион Сердцевины. Лоты видят и покупают только члены
// фракции; предметы и артефакты лежат на сервере до продажи, отмены или
// истечения. Выручка и возвраты складываются в «полку» продавца и забираются
// у аукционера. Время инжектируется — проверки без ожидания.

const STORE_VERSION = 1;

const DEFAULT_RULES = Object.freeze({
  listingLifetimeMs: 86400000,
  maxListingsPerSeller: 8,
  maxListingsPerFaction: 200,
  feePct: 0.05,
  minPrice: 1,
  maxPrice: 200000,
  maxQtyPerListing: 200
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function cleanId(value = '', max = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
}

function normalizeAuctionRules(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    listingLifetimeMs: Math.max(60000, Math.floor(Number(src.listingLifetimeMs || DEFAULT_RULES.listingLifetimeMs))),
    maxListingsPerSeller: Math.max(1, Math.floor(Number(src.maxListingsPerSeller || DEFAULT_RULES.maxListingsPerSeller))),
    maxListingsPerFaction: Math.max(1, Math.floor(Number(src.maxListingsPerFaction || DEFAULT_RULES.maxListingsPerFaction))),
    feePct: clamp(Number(src.feePct ?? DEFAULT_RULES.feePct), 0, 0.5),
    minPrice: Math.max(1, Math.floor(Number(src.minPrice || DEFAULT_RULES.minPrice))),
    maxPrice: Math.max(1, Math.floor(Number(src.maxPrice || DEFAULT_RULES.maxPrice))),
    maxQtyPerListing: Math.max(1, Math.floor(Number(src.maxQtyPerListing || DEFAULT_RULES.maxQtyPerListing)))
  };
}

function sanitizeRecords(records = []) {
  return (Array.isArray(records) ? records : [])
    .filter(row => row && typeof row === 'object' && cleanId(row.id, 96))
    .map(row => JSON.parse(JSON.stringify(row)));
}

function sanitizeListing(input = {}) {
  const id = cleanId(input?.id, 64);
  const factionId = cleanId(input?.factionId, 32);
  const itemId = cleanId(input?.itemId, 64);
  const sellerCharacterId = cleanId(input?.sellerCharacterId, 96);
  const qty = Math.max(0, Math.floor(Number(input?.qty || 0)));
  const price = Math.max(0, Math.floor(Number(input?.price || 0)));
  if (!id || !factionId || !itemId || !sellerCharacterId || qty <= 0 || price <= 0) return null;
  return {
    id,
    factionId,
    itemId,
    qty,
    price,
    sellerCharacterId,
    sellerName: String(input?.sellerName || '').slice(0, 48),
    records: sanitizeRecords(input?.records),
    createdAt: Math.max(0, Math.floor(Number(input?.createdAt || 0))),
    expiresAt: Math.max(0, Math.floor(Number(input?.expiresAt || 0)))
  };
}

function sanitizeShelf(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    silver: Math.max(0, Math.floor(Number(src.silver || 0))),
    items: (Array.isArray(src.items) ? src.items : [])
      .map(row => ({
        itemId: cleanId(row?.itemId, 64),
        qty: Math.max(0, Math.floor(Number(row?.qty || 0))),
        records: sanitizeRecords(row?.records),
        reason: String(row?.reason || 'returned').slice(0, 16),
        at: Math.max(0, Math.floor(Number(row?.at || 0)))
      }))
      .filter(row => row.itemId && row.qty > 0),
    sales: Math.max(0, Math.floor(Number(src.sales || 0)))
  };
}

function normalizeAuctionStore(input = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const factions = {};
  for (const [factionId, raw] of Object.entries(src.factions && typeof src.factions === 'object' ? src.factions : {})) {
    const id = cleanId(factionId, 32);
    if (!id || !raw || typeof raw !== 'object') continue;
    const listings = {};
    for (const [listingId, row] of Object.entries(raw.listings && typeof raw.listings === 'object' ? raw.listings : {})) {
      const clean = sanitizeListing({ ...row, id: row?.id || listingId, factionId: id });
      if (clean) listings[clean.id] = clean;
    }
    const shelves = {};
    for (const [characterId, shelf] of Object.entries(raw.shelves && typeof raw.shelves === 'object' ? raw.shelves : {})) {
      const key = cleanId(characterId, 96);
      if (key) shelves[key] = sanitizeShelf(shelf);
    }
    factions[id] = { listings, shelves, counter: Math.max(0, Math.floor(Number(raw.counter || 0))) };
  }
  return { version: STORE_VERSION, factions };
}

function ensureFaction(store = {}, factionId = '') {
  if (!store.factions || typeof store.factions !== 'object') store.factions = {};
  const id = cleanId(factionId, 32);
  if (!store.factions[id]) store.factions[id] = { listings: {}, shelves: {}, counter: 0 };
  return store.factions[id];
}

function ensureShelf(store = {}, factionId = '', characterId = '') {
  const faction = ensureFaction(store, factionId);
  const key = cleanId(characterId, 96);
  if (!faction.shelves[key]) faction.shelves[key] = sanitizeShelf({});
  return faction.shelves[key];
}

function activeListings(store = {}, factionId = '', now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  if (!faction) return [];
  return Object.values(faction.listings).filter(row => row.expiresAt > Number(now)).sort((a, b) => a.createdAt - b.createdAt);
}

// Выставить лот: предметы уже сняты сервером с инвентаря продавца.
function createListing(store = {}, input = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const factionId = cleanId(input.factionId, 32);
  const sellerCharacterId = cleanId(input.sellerCharacterId, 96);
  const itemId = cleanId(input.itemId, 64);
  const qty = Math.floor(Number(input.qty || 0));
  const price = Math.floor(Number(input.price || 0));
  if (!factionId || !sellerCharacterId) return { ok: false, error: 'Аукцион доступен только членам фракции.' };
  if (!itemId || qty <= 0) return { ok: false, error: 'Выберите предмет и количество.' };
  if (qty > rules.maxQtyPerListing) return { ok: false, error: `Не больше ${rules.maxQtyPerListing} в одном лоте.` };
  if (!Number.isFinite(price) || price < rules.minPrice || price > rules.maxPrice) return { ok: false, error: `Цена от ${rules.minPrice} до ${rules.maxPrice} марок.` };
  const faction = ensureFaction(store, factionId);
  const live = activeListings(store, factionId, now);
  if (live.filter(row => row.sellerCharacterId === sellerCharacterId).length >= rules.maxListingsPerSeller) {
    return { ok: false, error: `У вас уже ${rules.maxListingsPerSeller} лотов.` };
  }
  if (live.length >= rules.maxListingsPerFaction) return { ok: false, error: 'Аукцион фракции переполнен.' };
  faction.counter += 1;
  const listing = sanitizeListing({
    id: `lot_${factionId}_${faction.counter}`,
    factionId,
    itemId,
    qty,
    price,
    sellerCharacterId,
    sellerName: input.sellerName,
    records: input.records,
    createdAt: now,
    expiresAt: Number(now) + rules.listingLifetimeMs
  });
  if (!listing) return { ok: false, error: 'Лот не удалось создать.' };
  faction.listings[listing.id] = listing;
  return { ok: true, listing };
}

// Покупка: покупатель платит цену, продавец получает цену минус сбор на полку.
function buyListing(store = {}, factionId = '', listingId = '', buyerCharacterId = '', rules = DEFAULT_RULES, now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const listing = faction?.listings?.[cleanId(listingId, 64)];
  if (!listing) return { ok: false, error: 'Лот уже снят.' };
  if (listing.expiresAt <= Number(now)) return { ok: false, error: 'Срок лота истёк.' };
  if (listing.sellerCharacterId === cleanId(buyerCharacterId, 96)) return { ok: false, error: 'Свой лот можно только снять.' };
  delete faction.listings[listing.id];
  const fee = Math.floor(listing.price * rules.feePct);
  const payout = Math.max(0, listing.price - fee);
  const shelf = ensureShelf(store, factionId, listing.sellerCharacterId);
  shelf.silver += payout;
  shelf.sales += 1;
  return { ok: true, listing, fee, payout };
}

function cancelListing(store = {}, factionId = '', listingId = '', sellerCharacterId = '', now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const listing = faction?.listings?.[cleanId(listingId, 64)];
  if (!listing) return { ok: false, error: 'Лот уже снят.' };
  if (listing.sellerCharacterId !== cleanId(sellerCharacterId, 96)) return { ok: false, error: 'Это не ваш лот.' };
  delete faction.listings[listing.id];
  const shelf = ensureShelf(store, factionId, listing.sellerCharacterId);
  shelf.items.push({ itemId: listing.itemId, qty: listing.qty, records: listing.records, reason: 'cancelled', at: Number(now) });
  return { ok: true, listing };
}

// Истёкшие лоты возвращаются продавцу на полку; вызывается по тику.
function expireListings(store = {}, now = Date.now()) {
  const expired = [];
  for (const [factionId, faction] of Object.entries(store?.factions || {})) {
    for (const listing of Object.values(faction.listings)) {
      if (listing.expiresAt > Number(now)) continue;
      delete faction.listings[listing.id];
      const shelf = ensureShelf(store, factionId, listing.sellerCharacterId);
      shelf.items.push({ itemId: listing.itemId, qty: listing.qty, records: listing.records, reason: 'expired', at: Number(now) });
      expired.push(listing);
    }
  }
  return expired;
}

// Забрать полку целиком: сервер применяет rows/silver к инвентарю и вызывает
// commitShelfClaim только после успешного зачисления.
function shelfFor(store = {}, factionId = '', characterId = '') {
  const shelf = store?.factions?.[cleanId(factionId, 32)]?.shelves?.[cleanId(characterId, 96)];
  return shelf ? sanitizeShelf(shelf) : sanitizeShelf({});
}

function commitShelfClaim(store = {}, factionId = '', characterId = '', claimed = {}) {
  const shelf = ensureShelf(store, factionId, characterId);
  shelf.silver = Math.max(0, shelf.silver - Math.max(0, Math.floor(Number(claimed.silver || 0))));
  const claimedItems = Array.isArray(claimed.items) ? claimed.items : [];
  if (claimedItems.length) {
    const remaining = [];
    // Несколько возвратов одного предмета в одну секунду делят ключ — суммируем.
    const wanted = new Map();
    for (const row of claimedItems) {
      const key = `${row.itemId}:${row.at}`;
      wanted.set(key, (wanted.get(key) || 0) + Math.max(0, Math.floor(Number(row.qty || 0))));
    }
    for (const row of shelf.items) {
      const key = `${row.itemId}:${row.at}`;
      const take = wanted.get(key) || 0;
      if (take <= 0) { remaining.push(row); continue; }
      if (take >= row.qty) { wanted.set(key, take - row.qty); continue; }
      remaining.push({ ...row, qty: row.qty - take });
      wanted.set(key, 0);
    }
    shelf.items = remaining;
  }
  return shelf;
}

function publicListing(listing = {}, now = Date.now(), viewerCharacterId = '') {
  return {
    id: listing.id,
    itemId: listing.itemId,
    qty: listing.qty,
    price: listing.price,
    sellerName: listing.sellerName || 'Член фракции',
    mine: listing.sellerCharacterId === cleanId(viewerCharacterId, 96),
    remainingSeconds: Math.max(0, Math.round((Number(listing.expiresAt) - Number(now)) / 1000)),
    artifactCount: listing.records.filter(row => row?.artifact).length
  };
}

function publicAuction(store = {}, factionId = '', viewerCharacterId = '', rules = DEFAULT_RULES, now = Date.now()) {
  const shelf = shelfFor(store, factionId, viewerCharacterId);
  return {
    factionId: cleanId(factionId, 32),
    feePct: rules.feePct,
    listingLifetimeHours: Math.round(rules.listingLifetimeMs / 3600000),
    listings: activeListings(store, factionId, now).map(row => publicListing(row, now, viewerCharacterId)),
    shelf: {
      silver: shelf.silver,
      items: shelf.items.map(row => ({ itemId: row.itemId, qty: row.qty, reason: row.reason, at: row.at })),
      sales: shelf.sales
    }
  };
}

module.exports = {
  DEFAULT_RULES,
  STORE_VERSION,
  activeListings,
  buyListing,
  cancelListing,
  commitShelfClaim,
  createListing,
  expireListings,
  normalizeAuctionRules,
  normalizeAuctionStore,
  publicAuction,
  publicListing,
  shelfFor
};
