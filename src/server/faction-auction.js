'use strict';

// Фракционный аукцион Сердцевины. Лоты видят и покупают только члены
// фракции; предметы и артефакты лежат на сервере до продажи, отмены или
// истечения. Лот выставляется в категорию на выбранный срок со стартовой
// ценой и, если продавец захотел, ценой немедленного выкупа. Покупатели
// повышают ставку — марки претендента держит сам лот, перебитая ставка
// возвращается на полку. Выручка приходит продавцу за вычетом налога на
// продажу; возвраты тоже ложатся на «полку» и забираются у аукционера.
// Время инжектируется — проверки без ожидания.

const STORE_VERSION = 2;

// Категории повторяют каталог предметов (src/server/kromka-items.js), чтобы
// сервер клал в лот собственную категорию предмета без отдельной таблицы.
const CATEGORY_LABELS = Object.freeze({
  weapons: 'Оружие',
  armor: 'Броня',
  ammo: 'Патроны',
  aid: 'Медицина',
  artifacts: 'Артефакты',
  tools: 'Инструменты',
  materials: 'Материалы',
  strategic: 'Стратегическое',
  misc: 'Разное'
});
const CATEGORY_IDS = Object.freeze(Object.keys(CATEGORY_LABELS));
const DEFAULT_CATEGORY = 'misc';

const HOUR_MS = 3600000;

const DEFAULT_RULES = Object.freeze({
  // Сроки выставления на выбор продавца; последний — предложение по умолчанию.
  durationChoicesMs: Object.freeze([6 * HOUR_MS, 12 * HOUR_MS, 24 * HOUR_MS, 48 * HOUR_MS]),
  listingLifetimeMs: 24 * HOUR_MS,
  maxListingsPerSeller: 8,
  maxListingsPerFaction: 200,
  taxPct: 0.05,
  minBidStepPct: 0.05,
  // Ставка в последние минуты продлевает торги: снайпинг на последней секунде
  // не отбирает лот у того, кто готов платить больше.
  antiSnipeMs: 120000,
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

function cleanCategory(value = '') {
  const id = cleanId(value, 24);
  return CATEGORY_IDS.includes(id) ? id : DEFAULT_CATEGORY;
}

function normalizeDurationChoices(input, fallback = DEFAULT_RULES.durationChoicesMs) {
  const list = (Array.isArray(input) ? input : [])
    .map(value => Math.floor(Number(value || 0)))
    .filter(value => Number.isFinite(value) && value >= 600000 && value <= 30 * 24 * HOUR_MS);
  const unique = [...new Set(list)].sort((a, b) => a - b);
  return unique.length ? Object.freeze(unique) : fallback;
}

function normalizeAuctionRules(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const durationChoicesMs = normalizeDurationChoices(src.durationChoicesMs);
  const listingLifetimeMs = Math.max(60000, Math.floor(Number(src.listingLifetimeMs || DEFAULT_RULES.listingLifetimeMs)));
  return {
    durationChoicesMs,
    // Срок по умолчанию всегда один из предложенных, иначе форма продавца
    // показала бы цифру, которую сервер не примет.
    listingLifetimeMs: durationChoicesMs.includes(listingLifetimeMs)
      ? listingLifetimeMs
      : durationChoicesMs[durationChoicesMs.length - 1],
    maxListingsPerSeller: Math.max(1, Math.floor(Number(src.maxListingsPerSeller || DEFAULT_RULES.maxListingsPerSeller))),
    maxListingsPerFaction: Math.max(1, Math.floor(Number(src.maxListingsPerFaction || DEFAULT_RULES.maxListingsPerFaction))),
    // feePct — имя прежнего сбора; авторские данные с ним продолжают работать.
    taxPct: clamp(Number(src.taxPct ?? src.feePct ?? DEFAULT_RULES.taxPct), 0, 0.5),
    minBidStepPct: clamp(Number(src.minBidStepPct ?? DEFAULT_RULES.minBidStepPct), 0.01, 0.5),
    antiSnipeMs: Math.max(0, Math.floor(Number(src.antiSnipeMs ?? DEFAULT_RULES.antiSnipeMs))),
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
  // Лоты первой версии знали одну цену: она становится и стартовой, и выкупом.
  const legacyPrice = Math.max(0, Math.floor(Number(input?.price || 0)));
  const startPrice = Math.max(0, Math.floor(Number(input?.startPrice || legacyPrice)));
  const buyoutPrice = Math.max(0, Math.floor(Number(input?.buyoutPrice ?? legacyPrice)));
  if (!id || !factionId || !itemId || !sellerCharacterId || qty <= 0 || startPrice <= 0) return null;
  const bidderCharacterId = cleanId(input?.bidderCharacterId, 96);
  const bidAmount = bidderCharacterId ? Math.max(0, Math.floor(Number(input?.bidAmount || 0))) : 0;
  const createdAt = Math.max(0, Math.floor(Number(input?.createdAt || 0)));
  const expiresAt = Math.max(0, Math.floor(Number(input?.expiresAt || 0)));
  return {
    id,
    factionId,
    itemId,
    category: cleanCategory(input?.category),
    qty,
    startPrice,
    buyoutPrice: buyoutPrice >= startPrice ? buyoutPrice : 0,
    bidAmount,
    bidderCharacterId: bidAmount > 0 ? bidderCharacterId : '',
    bidderName: bidAmount > 0 ? String(input?.bidderName || '').slice(0, 48) : '',
    bidAt: bidAmount > 0 ? Math.max(0, Math.floor(Number(input?.bidAt || 0))) : 0,
    bids: Math.max(0, Math.floor(Number(input?.bids || 0))),
    sellerCharacterId,
    sellerName: String(input?.sellerName || '').slice(0, 48),
    records: sanitizeRecords(input?.records),
    createdAt,
    durationMs: Math.max(0, Math.floor(Number(input?.durationMs || Math.max(0, expiresAt - createdAt)))),
    expiresAt
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
  return Object.values(faction.listings)
    .filter(row => row.expiresAt > Number(now))
    .sort((a, b) => a.expiresAt - b.expiresAt || a.createdAt - b.createdAt);
}

// Следующая допустимая ставка: стартовая цена, пока ставок нет, дальше — шаг
// от текущей. Шаг никогда не меньше одной марки, иначе дешёвый лот не сдвинуть.
function minimumBid(listing = {}, rules = DEFAULT_RULES) {
  const current = Math.max(0, Math.floor(Number(listing?.bidAmount || 0)));
  if (current <= 0) return Math.max(1, Math.floor(Number(listing?.startPrice || 1)));
  return current + Math.max(1, Math.floor(current * rules.minBidStepPct));
}

function saleTax(price = 0, rules = DEFAULT_RULES) {
  return Math.floor(Math.max(0, Math.floor(Number(price || 0))) * rules.taxPct);
}

// Перебитая ставка возвращается прежнему претенденту на полку целиком: налог
// берётся только с состоявшейся продажи.
function refundBid(store = {}, factionId = '', listing = {}, now = Date.now()) {
  const amount = Math.max(0, Math.floor(Number(listing?.bidAmount || 0)));
  const characterId = cleanId(listing?.bidderCharacterId, 96);
  if (amount <= 0 || !characterId) return null;
  const shelf = ensureShelf(store, factionId, characterId);
  shelf.silver += amount;
  listing.bidAmount = 0;
  listing.bidderCharacterId = '';
  listing.bidderName = '';
  listing.bidAt = 0;
  return { characterId, amount, at: Number(now) };
}

// Налог на продажу удерживается с продавца: покупатель платит объявленную цену.
function payoutSeller(store = {}, factionId = '', listing = {}, price = 0, rules = DEFAULT_RULES) {
  const tax = saleTax(price, rules);
  const payout = Math.max(0, Math.floor(Number(price || 0)) - tax);
  const shelf = ensureShelf(store, factionId, listing.sellerCharacterId);
  shelf.silver += payout;
  shelf.sales += 1;
  return { tax, payout };
}

// Выставить лот: предметы уже сняты сервером с инвентаря продавца.
function createListing(store = {}, input = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const factionId = cleanId(input.factionId, 32);
  const sellerCharacterId = cleanId(input.sellerCharacterId, 96);
  const itemId = cleanId(input.itemId, 64);
  const qty = Math.floor(Number(input.qty || 0));
  const startPrice = Math.floor(Number(input.startPrice ?? input.price ?? 0));
  const buyoutPrice = Math.floor(Number(input.buyoutPrice || 0));
  const durationMs = Math.floor(Number(input.durationMs || rules.listingLifetimeMs));
  if (!factionId || !sellerCharacterId) return { ok: false, error: 'Аукцион доступен только членам фракции.' };
  if (!itemId || qty <= 0) return { ok: false, error: 'Выберите предмет и количество.' };
  if (qty > rules.maxQtyPerListing) return { ok: false, error: `Не больше ${rules.maxQtyPerListing} в одном лоте.` };
  if (!Number.isFinite(startPrice) || startPrice < rules.minPrice || startPrice > rules.maxPrice) {
    return { ok: false, error: `Стартовая цена от ${rules.minPrice} до ${rules.maxPrice} марок.` };
  }
  if (buyoutPrice !== 0) {
    if (!Number.isFinite(buyoutPrice) || buyoutPrice > rules.maxPrice) return { ok: false, error: `Цена выкупа не больше ${rules.maxPrice} марок.` };
    if (buyoutPrice < startPrice) return { ok: false, error: 'Выкуп не может быть дешевле стартовой цены.' };
  }
  if (!rules.durationChoicesMs.includes(durationMs)) return { ok: false, error: 'Такого срока выставления нет.' };
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
    category: input.category,
    qty,
    startPrice,
    buyoutPrice,
    sellerCharacterId,
    sellerName: input.sellerName,
    records: input.records,
    createdAt: now,
    durationMs,
    expiresAt: Number(now) + durationMs
  });
  if (!listing) return { ok: false, error: 'Лот не удалось создать.' };
  faction.listings[listing.id] = listing;
  return { ok: true, listing };
}

// Ставка: марки претендента держит лот до конца торгов или до перебитой
// ставки. Сервер снимает их с покупателя только после ok.
function placeBid(store = {}, factionId = '', listingId = '', bidder = {}, amount = 0, rules = DEFAULT_RULES, now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const listing = faction?.listings?.[cleanId(listingId, 64)];
  const characterId = cleanId(bidder?.characterId, 96);
  const value = Math.floor(Number(amount || 0));
  if (!listing) return { ok: false, error: 'Лот уже снят.' };
  if (listing.expiresAt <= Number(now)) return { ok: false, error: 'Срок лота истёк.' };
  if (!characterId) return { ok: false, error: 'Аукцион доступен только членам фракции.' };
  if (listing.sellerCharacterId === characterId) return { ok: false, error: 'На свой лот ставку не сделать.' };
  if (listing.bidderCharacterId === characterId) return { ok: false, error: 'Ваша ставка уже ведёт.' };
  const minimum = minimumBid(listing, rules);
  if (!Number.isFinite(value) || value < minimum) return { ok: false, error: `Ставка от ${minimum} марок.` };
  if (value > rules.maxPrice) return { ok: false, error: `Ставка не больше ${rules.maxPrice} марок.` };
  if (listing.buyoutPrice > 0 && value >= listing.buyoutPrice) {
    return { ok: false, error: `Такую сумму выгоднее отдать за выкуп: ${listing.buyoutPrice} марок.` };
  }
  const refund = refundBid(store, factionId, listing, now);
  listing.bidAmount = value;
  listing.bidderCharacterId = characterId;
  listing.bidderName = String(bidder?.name || '').slice(0, 48);
  listing.bidAt = Number(now);
  listing.bids += 1;
  // Продление против снайпинга: после ставки лот живёт минимум antiSnipeMs.
  let extended = false;
  if (rules.antiSnipeMs > 0 && listing.expiresAt - Number(now) < rules.antiSnipeMs) {
    listing.expiresAt = Number(now) + rules.antiSnipeMs;
    extended = true;
  }
  return { ok: true, listing, amount: value, refund, extended, nextBid: minimumBid(listing, rules) };
}

// Немедленный выкуп: лот закрывается, ставка прежнего претендента уходит к нему
// на полку, продавец получает цену за вычетом налога на продажу.
function buyoutListing(store = {}, factionId = '', listingId = '', buyerCharacterId = '', rules = DEFAULT_RULES, now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const listing = faction?.listings?.[cleanId(listingId, 64)];
  if (!listing) return { ok: false, error: 'Лот уже снят.' };
  if (listing.expiresAt <= Number(now)) return { ok: false, error: 'Срок лота истёк.' };
  if (listing.buyoutPrice <= 0) return { ok: false, error: 'У этого лота нет цены выкупа.' };
  if (listing.sellerCharacterId === cleanId(buyerCharacterId, 96)) return { ok: false, error: 'Свой лот можно только снять.' };
  delete faction.listings[listing.id];
  const price = listing.buyoutPrice;
  const refund = refundBid(store, factionId, listing, now);
  const { tax, payout } = payoutSeller(store, factionId, listing, price, rules);
  return { ok: true, listing, price, tax, payout, refund };
}

// Снять лот можно, пока никто не поставил: чужая ставка уже держит марки.
function cancelListing(store = {}, factionId = '', listingId = '', sellerCharacterId = '', now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const listing = faction?.listings?.[cleanId(listingId, 64)];
  if (!listing) return { ok: false, error: 'Лот уже снят.' };
  if (listing.sellerCharacterId !== cleanId(sellerCharacterId, 96)) return { ok: false, error: 'Это не ваш лот.' };
  if (listing.bidAmount > 0) return { ok: false, error: 'На лот уже сделана ставка — торги идут до конца срока.' };
  delete faction.listings[listing.id];
  const shelf = ensureShelf(store, factionId, listing.sellerCharacterId);
  shelf.items.push({ itemId: listing.itemId, qty: listing.qty, records: listing.records, reason: 'cancelled', at: Number(now) });
  return { ok: true, listing };
}

// Конец срока: со ставкой лот уходит победителю на полку, а продавцу ложится
// выручка за вычетом налога; без ставок предметы возвращаются продавцу.
// Вызывается по тику.
function expireListings(store = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const resolved = [];
  for (const [factionId, faction] of Object.entries(store?.factions || {})) {
    for (const listing of Object.values(faction.listings)) {
      if (listing.expiresAt > Number(now)) continue;
      delete faction.listings[listing.id];
      if (listing.bidAmount > 0 && listing.bidderCharacterId) {
        const price = listing.bidAmount;
        const winnerCharacterId = listing.bidderCharacterId;
        const winnerShelf = ensureShelf(store, factionId, winnerCharacterId);
        winnerShelf.items.push({ itemId: listing.itemId, qty: listing.qty, records: listing.records, reason: 'won', at: Number(now) });
        const { tax, payout } = payoutSeller(store, factionId, listing, price, rules);
        resolved.push({ ...listing, resolution: 'sold', price, tax, payout, winnerCharacterId });
        continue;
      }
      const shelf = ensureShelf(store, factionId, listing.sellerCharacterId);
      shelf.items.push({ itemId: listing.itemId, qty: listing.qty, records: listing.records, reason: 'expired', at: Number(now) });
      resolved.push({ ...listing, resolution: 'expired' });
    }
  }
  return resolved;
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

/**
 * Состояние артефакта видно до покупки: вид, тир и признак стабилизации, а у
 * исследованного — его точные свойства. Проекцию передаёт сервер, чтобы модуль
 * аукциона не знал про каталог артефактов; без неё остаётся только счётчик.
 */
function publicListing(listing = {}, now = Date.now(), viewerCharacterId = '', projectArtifact = null, rules = DEFAULT_RULES) {
  const artifactRows = listing.records.filter(row => row?.artifact);
  const viewer = cleanId(viewerCharacterId, 96);
  return {
    id: listing.id,
    itemId: listing.itemId,
    category: listing.category,
    qty: listing.qty,
    startPrice: listing.startPrice,
    buyoutPrice: listing.buyoutPrice,
    bid: listing.bidAmount,
    // Имя лидера видно всем, идентификатор — никому.
    bidderName: listing.bidAmount > 0 ? (listing.bidderName || 'Член фракции') : '',
    bids: listing.bids,
    nextBid: minimumBid(listing, rules),
    leading: listing.bidAmount > 0 && listing.bidderCharacterId === viewer,
    sellerName: listing.sellerName || 'Член фракции',
    mine: listing.sellerCharacterId === viewer,
    remainingSeconds: Math.max(0, Math.round((Number(listing.expiresAt) - Number(now)) / 1000)),
    durationHours: Math.max(1, Math.round(Number(listing.durationMs || 0) / HOUR_MS)),
    artifactCount: artifactRows.length,
    artifacts: typeof projectArtifact === 'function'
      ? artifactRows.map(row => projectArtifact(row.artifact)).filter(Boolean)
      : []
  };
}

function publicAuction(store = {}, factionId = '', viewerCharacterId = '', rules = DEFAULT_RULES, now = Date.now(), options = {}) {
  const shelf = shelfFor(store, factionId, viewerCharacterId);
  const projectArtifact = typeof options?.projectArtifact === 'function' ? options.projectArtifact : null;
  const listings = activeListings(store, factionId, now)
    .map(row => publicListing(row, now, viewerCharacterId, projectArtifact, rules));
  const counts = new Map();
  for (const row of listings) counts.set(row.category, (counts.get(row.category) || 0) + 1);
  return {
    factionId: cleanId(factionId, 32),
    taxPct: rules.taxPct,
    minBidStepPct: rules.minBidStepPct,
    antiSnipeSeconds: Math.round(rules.antiSnipeMs / 1000),
    listingLifetimeHours: Math.round(rules.listingLifetimeMs / HOUR_MS),
    durationChoicesHours: rules.durationChoicesMs.map(value => Math.round(value / HOUR_MS)),
    limits: {
      minPrice: rules.minPrice,
      maxPrice: rules.maxPrice,
      maxQtyPerListing: rules.maxQtyPerListing,
      maxListingsPerSeller: rules.maxListingsPerSeller
    },
    categories: CATEGORY_IDS.map(id => ({ id, label: CATEGORY_LABELS[id], count: counts.get(id) || 0 })),
    mineCount: listings.filter(row => row.mine).length,
    leadingCount: listings.filter(row => row.leading).length,
    listings,
    shelf: {
      silver: shelf.silver,
      items: shelf.items.map(row => ({ itemId: row.itemId, qty: row.qty, reason: row.reason, at: row.at })),
      sales: shelf.sales
    }
  };
}

module.exports = {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  DEFAULT_RULES,
  STORE_VERSION,
  activeListings,
  buyoutListing,
  cancelListing,
  commitShelfClaim,
  createListing,
  expireListings,
  minimumBid,
  normalizeAuctionRules,
  normalizeAuctionStore,
  placeBid,
  publicAuction,
  publicListing,
  saleTax,
  shelfFor
};
