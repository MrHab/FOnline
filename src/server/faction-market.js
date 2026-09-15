'use strict';

// Рынок Сердцевины: книга ордеров фракции у аукционера базы. Торговля идёт не
// ставками, а встречными ордерами — как на бирже. Продавец выставляет ордер на
// продажу по цене за штуку, покупатель — ордер на выкуп; совпавшие ордера
// исполняются сразу, частями, по цене того ордера, который стоял в книге
// первым. Мгновенные «купить сейчас» и «продать сейчас» бьют по лучшей цене
// книги.
//
// Размещение ордера стоит сбора, состоявшаяся продажа — налога. Предметы и
// марки лежат на сервере: ордер на продажу держит товар, ордер на выкуп —
// марки. Всё, что пришло, пока торговца не было у стойки, ждёт на его полке.
// Время инжектируется — проверки без ожидания.

const STORE_VERSION = 3;

// Категории повторяют каталог предметов (src/server/kromka-items.js), чтобы
// сервер клал в ордер собственную категорию предмета без отдельной таблицы.
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
  // Сроки ордера на выбор торговца: 6 часов, сутки, трое суток, неделя.
  durationChoicesMs: Object.freeze([6 * HOUR_MS, 24 * HOUR_MS, 72 * HOUR_MS, 168 * HOUR_MS]),
  listingLifetimeMs: 24 * HOUR_MS,
  maxOrdersPerTrader: 12,
  maxOrdersPerFaction: 300,
  // Налог берётся с состоявшейся продажи, сбор — за место в книге.
  taxPct: 0.05,
  setupFeePct: 0.015,
  minPrice: 1,
  maxPrice: 200000,
  maxQtyPerOrder: 500
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

function normalizeMarketRules(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const durationChoicesMs = normalizeDurationChoices(src.durationChoicesMs);
  const listingLifetimeMs = Math.max(60000, Math.floor(Number(src.listingLifetimeMs || DEFAULT_RULES.listingLifetimeMs)));
  return {
    durationChoicesMs,
    // Срок по умолчанию всегда один из предложенных, иначе форма торговца
    // показала бы цифру, которую сервер не примет.
    listingLifetimeMs: durationChoicesMs.includes(listingLifetimeMs)
      ? listingLifetimeMs
      : durationChoicesMs[durationChoicesMs.length - 1],
    maxOrdersPerTrader: Math.max(1, Math.floor(Number(src.maxOrdersPerTrader || src.maxListingsPerSeller || DEFAULT_RULES.maxOrdersPerTrader))),
    maxOrdersPerFaction: Math.max(1, Math.floor(Number(src.maxOrdersPerFaction || src.maxListingsPerFaction || DEFAULT_RULES.maxOrdersPerFaction))),
    // feePct — имя прежнего сбора; авторские данные с ним продолжают работать.
    taxPct: clamp(Number(src.taxPct ?? src.feePct ?? DEFAULT_RULES.taxPct), 0, 0.5),
    setupFeePct: clamp(Number(src.setupFeePct ?? DEFAULT_RULES.setupFeePct), 0, 0.2),
    minPrice: Math.max(1, Math.floor(Number(src.minPrice || DEFAULT_RULES.minPrice))),
    maxPrice: Math.max(1, Math.floor(Number(src.maxPrice || DEFAULT_RULES.maxPrice))),
    maxQtyPerOrder: Math.max(1, Math.floor(Number(src.maxQtyPerOrder || src.maxQtyPerListing || DEFAULT_RULES.maxQtyPerOrder)))
  };
}

function sanitizeRecords(records = []) {
  return (Array.isArray(records) ? records : [])
    .filter(row => row && typeof row === 'object' && cleanId(row.id, 96))
    .map(row => JSON.parse(JSON.stringify(row)));
}

function sanitizeOrder(input = {}) {
  const id = cleanId(input?.id, 64);
  const factionId = cleanId(input?.factionId, 32);
  const itemId = cleanId(input?.itemId, 64);
  const ownerCharacterId = cleanId(input?.ownerCharacterId || input?.sellerCharacterId, 96);
  const side = input?.side === 'buy' ? 'buy' : 'sell';
  const qty = Math.max(0, Math.floor(Number(input?.qty || 0)));
  // Лоты прежнего аукциона знали цену выкупа или стартовую — обе становятся
  // ценой ордера на продажу.
  const price = Math.max(0, Math.floor(Number(input?.price ?? input?.buyoutPrice ?? input?.startPrice ?? 0)));
  if (!id || !factionId || !itemId || !ownerCharacterId || qty <= 0 || price <= 0) return null;
  const createdAt = Math.max(0, Math.floor(Number(input?.createdAt || 0)));
  const expiresAt = Math.max(0, Math.floor(Number(input?.expiresAt || 0)));
  return {
    id,
    factionId,
    side,
    itemId,
    category: cleanCategory(input?.category),
    qty,
    filled: Math.max(0, Math.floor(Number(input?.filled || 0))),
    price,
    // Ордер на выкуп держит марки покупателя до исполнения, отмены или срока.
    escrow: side === 'buy' ? Math.max(0, Math.floor(Number(input?.escrow ?? qty * price))) : 0,
    ownerCharacterId,
    ownerName: String(input?.ownerName || input?.sellerName || '').slice(0, 48),
    records: side === 'sell' ? sanitizeRecords(input?.records) : [],
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

function normalizeMarketStore(input = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const factions = {};
  for (const [factionId, raw] of Object.entries(src.factions && typeof src.factions === 'object' ? src.factions : {})) {
    const id = cleanId(factionId, 32);
    if (!id || !raw || typeof raw !== 'object') continue;
    const orders = {};
    for (const [orderId, row] of Object.entries(raw.orders && typeof raw.orders === 'object' ? raw.orders : {})) {
      const clean = sanitizeOrder({ ...row, id: row?.id || orderId, factionId: id });
      if (clean) orders[clean.id] = clean;
    }
    const shelves = {};
    for (const [characterId, shelf] of Object.entries(raw.shelves && typeof raw.shelves === 'object' ? raw.shelves : {})) {
      const key = cleanId(characterId, 96);
      if (key) shelves[key] = sanitizeShelf(shelf);
    }
    // Лоты прежнего аукциона переезжают в книгу ордерами на продажу, а марки
    // непобедившей ставки возвращаются претенденту на полку.
    for (const [listingId, row] of Object.entries(raw.listings && typeof raw.listings === 'object' ? raw.listings : {})) {
      const clean = sanitizeOrder({ ...row, id: row?.id || listingId, factionId: id, side: 'sell' });
      if (clean) orders[clean.id] = clean;
      const bidder = cleanId(row?.bidderCharacterId, 96);
      const bid = Math.max(0, Math.floor(Number(row?.bidAmount || 0)));
      if (!bidder || bid <= 0) continue;
      if (!shelves[bidder]) shelves[bidder] = sanitizeShelf({});
      shelves[bidder].silver += bid;
    }
    factions[id] = { orders, shelves, counter: Math.max(0, Math.floor(Number(raw.counter || 0))) };
  }
  return { version: STORE_VERSION, factions };
}

function ensureFaction(store = {}, factionId = '') {
  if (!store.factions || typeof store.factions !== 'object') store.factions = {};
  const id = cleanId(factionId, 32);
  if (!store.factions[id]) store.factions[id] = { orders: {}, shelves: {}, counter: 0 };
  const faction = store.factions[id];
  if (!faction.orders || typeof faction.orders !== 'object') faction.orders = {};
  if (!faction.shelves || typeof faction.shelves !== 'object') faction.shelves = {};
  return faction;
}

function ensureShelf(store = {}, factionId = '', characterId = '') {
  const faction = ensureFaction(store, factionId);
  const key = cleanId(characterId, 96);
  if (!faction.shelves[key]) faction.shelves[key] = sanitizeShelf({});
  return faction.shelves[key];
}

function activeOrders(store = {}, factionId = '', now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  if (!faction) return [];
  return Object.values(faction.orders)
    .filter(row => row.expiresAt > Number(now) && row.qty > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Встречная сторона книги по предмету: продажи от дешёвых, выкупы от дорогих,
// при равной цене первым стоит тот, кто встал в книгу раньше.
function bookSide(store = {}, factionId = '', itemId = '', side = 'sell', now = Date.now()) {
  const wanted = cleanId(itemId, 64);
  const rows = activeOrders(store, factionId, now).filter(row => row.itemId === wanted && row.side === side);
  rows.sort((a, b) => (side === 'sell' ? a.price - b.price : b.price - a.price) || a.createdAt - b.createdAt);
  return rows;
}

function bestPrice(store = {}, factionId = '', itemId = '', side = 'sell', now = Date.now()) {
  const rows = bookSide(store, factionId, itemId, side, now);
  return rows.length ? rows[0].price : 0;
}

function setupFeeFor(qty = 0, price = 0, rules = DEFAULT_RULES) {
  return Math.floor(Math.max(0, Math.floor(Number(qty || 0))) * Math.max(0, Math.floor(Number(price || 0))) * rules.setupFeePct);
}

function saleTax(value = 0, rules = DEFAULT_RULES) {
  return Math.floor(Math.max(0, Math.floor(Number(value || 0))) * rules.taxPct);
}

function ordersOf(store = {}, factionId = '', characterId = '', now = Date.now()) {
  const owner = cleanId(characterId, 96);
  return activeOrders(store, factionId, now).filter(row => row.ownerCharacterId === owner);
}

function validateOrderRequest(store, input = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const factionId = cleanId(input.factionId, 32);
  const ownerCharacterId = cleanId(input.ownerCharacterId, 96);
  const itemId = cleanId(input.itemId, 64);
  const qty = Math.floor(Number(input.qty || 0));
  const price = Math.floor(Number(input.price || 0));
  const durationMs = Math.floor(Number(input.durationMs || rules.listingLifetimeMs));
  if (!factionId || !ownerCharacterId) return { ok: false, error: 'Рынок открыт только членам фракции.' };
  if (!itemId || qty <= 0) return { ok: false, error: 'Выберите предмет и количество.' };
  if (qty > rules.maxQtyPerOrder) return { ok: false, error: `Не больше ${rules.maxQtyPerOrder} в одном ордере.` };
  if (!Number.isFinite(price) || price < rules.minPrice || price > rules.maxPrice) {
    return { ok: false, error: `Цена за штуку от ${rules.minPrice} до ${rules.maxPrice} марок.` };
  }
  if (!rules.durationChoicesMs.includes(durationMs)) return { ok: false, error: 'Такого срока ордера нет.' };
  if (ordersOf(store, factionId, ownerCharacterId, now).length >= rules.maxOrdersPerTrader) {
    return { ok: false, error: `У вас уже ${rules.maxOrdersPerTrader} ордеров.` };
  }
  if (activeOrders(store, factionId, now).length >= rules.maxOrdersPerFaction) {
    return { ok: false, error: 'Книга ордеров фракции переполнена.' };
  }
  return { ok: true, factionId, ownerCharacterId, itemId, qty, price, durationMs };
}

function newOrderId(faction = {}, factionId = '', side = 'sell') {
  faction.counter += 1;
  return `${side === 'buy' ? 'buy' : 'lot'}_${factionId}_${faction.counter}`;
}

// Ордер на продажу. Предметы уже сняты сервером с продавца; сбор за размещение
// сервер берёт отдельно и только после ok.
function placeSellOrder(store = {}, input = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const check = validateOrderRequest(store, input, rules, now);
  if (!check.ok) return check;
  const { factionId, ownerCharacterId, itemId, qty, price, durationMs } = check;
  const records = sanitizeRecords(input.records);
  if (records.length && qty !== 1) {
    return { ok: false, error: 'Предмет с собственным состоянием выставляется по одному.' };
  }
  const faction = ensureFaction(store, factionId);

  const fills = [];
  let remaining = qty;
  let proceeds = 0;
  let tax = 0;
  for (const buy of bookSide(store, factionId, itemId, 'buy', now)) {
    if (remaining <= 0 || buy.price < price) break;
    if (buy.ownerCharacterId === ownerCharacterId) continue;
    const take = Math.min(remaining, buy.qty);
    const value = take * buy.price;
    const fillTax = saleTax(value, rules);
    const buyerShelf = ensureShelf(store, factionId, buy.ownerCharacterId);
    buyerShelf.items.push({ itemId, qty: take, records, reason: 'bought', at: Number(now) });
    buy.qty -= take;
    buy.filled += take;
    buy.escrow = Math.max(0, buy.escrow - value);
    if (buy.qty <= 0) delete faction.orders[buy.id];
    remaining -= take;
    proceeds += value - fillTax;
    tax += fillTax;
    fills.push({ orderId: buy.id, buyerCharacterId: buy.ownerCharacterId, qty: take, price: buy.price, tax: fillTax });
  }
  if (fills.length) ensureShelf(store, factionId, ownerCharacterId).sales += fills.length;

  let order = null;
  if (remaining > 0) {
    order = sanitizeOrder({
      id: newOrderId(faction, factionId, 'sell'),
      factionId,
      side: 'sell',
      itemId,
      category: input.category,
      qty: remaining,
      price,
      ownerCharacterId,
      ownerName: input.ownerName,
      records,
      createdAt: now,
      durationMs,
      expiresAt: Number(now) + durationMs
    });
    if (!order) return { ok: false, error: 'Ордер не удалось создать.' };
    faction.orders[order.id] = order;
  }
  return {
    ok: true,
    order,
    fills,
    soldQty: qty - remaining,
    restingQty: remaining,
    proceeds,
    tax,
    setupFee: setupFeeFor(qty, price, rules)
  };
}

// Ордер на выкуп. Марки сервер снимает после ok: `spent` ушло встречным
// продавцам, `escrow` держит остаток ордера, `setupFee` — сбор книги.
function placeBuyOrder(store = {}, input = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const check = validateOrderRequest(store, input, rules, now);
  if (!check.ok) return check;
  const { factionId, ownerCharacterId, itemId, qty, price, durationMs } = check;
  const faction = ensureFaction(store, factionId);

  const fills = [];
  const bought = [];
  let remaining = qty;
  let spent = 0;
  for (const sell of bookSide(store, factionId, itemId, 'sell', now)) {
    if (remaining <= 0 || sell.price > price) break;
    if (sell.ownerCharacterId === ownerCharacterId) continue;
    const take = Math.min(remaining, sell.qty);
    const value = take * sell.price;
    const fillTax = saleTax(value, rules);
    const sellerShelf = ensureShelf(store, factionId, sell.ownerCharacterId);
    sellerShelf.silver += value - fillTax;
    sellerShelf.sales += 1;
    sell.qty -= take;
    sell.filled += take;
    const records = sell.qty <= 0 ? sell.records : [];
    if (sell.qty <= 0) delete faction.orders[sell.id];
    remaining -= take;
    spent += value;
    bought.push({ itemId, qty: take, records, price: sell.price });
    fills.push({ orderId: sell.id, sellerCharacterId: sell.ownerCharacterId, qty: take, price: sell.price, tax: fillTax });
  }

  let order = null;
  let escrow = 0;
  if (remaining > 0) {
    escrow = remaining * price;
    order = sanitizeOrder({
      id: newOrderId(faction, factionId, 'buy'),
      factionId,
      side: 'buy',
      itemId,
      category: input.category,
      qty: remaining,
      price,
      escrow,
      ownerCharacterId,
      ownerName: input.ownerName,
      createdAt: now,
      durationMs,
      expiresAt: Number(now) + durationMs
    });
    if (!order) return { ok: false, error: 'Ордер не удалось создать.' };
    faction.orders[order.id] = order;
  }
  return {
    ok: true,
    order,
    fills,
    bought,
    boughtQty: qty - remaining,
    restingQty: remaining,
    spent,
    escrow,
    setupFee: setupFeeFor(qty, price, rules)
  };
}

// «Купить сейчас»: снять товар с конкретного ордера на продажу. Покупатель
// платит цену ордера, продавцу на полку ложится цена минус налог.
function takeSellOrder(store = {}, factionId = '', orderId = '', buyerCharacterId = '', qty = 0, rules = DEFAULT_RULES, now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const order = faction?.orders?.[cleanId(orderId, 64)];
  const buyer = cleanId(buyerCharacterId, 96);
  if (!order || order.side !== 'sell') return { ok: false, error: 'Ордер уже снят.' };
  if (order.expiresAt <= Number(now)) return { ok: false, error: 'Срок ордера истёк.' };
  if (order.ownerCharacterId === buyer) return { ok: false, error: 'Свой ордер можно только отменить.' };
  const take = Math.max(1, Math.min(Math.floor(Number(qty || 0)) || order.qty, order.qty));
  const cost = take * order.price;
  const tax = saleTax(cost, rules);
  const sellerShelf = ensureShelf(store, factionId, order.ownerCharacterId);
  sellerShelf.silver += cost - tax;
  sellerShelf.sales += 1;
  order.qty -= take;
  order.filled += take;
  const records = order.qty <= 0 ? order.records : [];
  if (order.qty <= 0) delete faction.orders[order.id];
  return { ok: true, order, qty: take, price: order.price, cost, tax, payout: cost - tax, records };
}

// «Продать сейчас»: отдать товар в конкретный ордер на выкуп. Продавец получает
// цену ордера минус налог, товар уходит покупателю на полку.
function takeBuyOrder(store = {}, factionId = '', orderId = '', sellerCharacterId = '', qty = 0, records = [], rules = DEFAULT_RULES, now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const order = faction?.orders?.[cleanId(orderId, 64)];
  const seller = cleanId(sellerCharacterId, 96);
  if (!order || order.side !== 'buy') return { ok: false, error: 'Ордер уже снят.' };
  if (order.expiresAt <= Number(now)) return { ok: false, error: 'Срок ордера истёк.' };
  if (order.ownerCharacterId === seller) return { ok: false, error: 'Свой ордер можно только отменить.' };
  const take = Math.max(1, Math.min(Math.floor(Number(qty || 0)) || order.qty, order.qty));
  const value = take * order.price;
  const tax = saleTax(value, rules);
  const buyerShelf = ensureShelf(store, factionId, order.ownerCharacterId);
  buyerShelf.items.push({ itemId: order.itemId, qty: take, records: sanitizeRecords(records), reason: 'bought', at: Number(now) });
  order.qty -= take;
  order.filled += take;
  order.escrow = Math.max(0, order.escrow - value);
  if (order.qty <= 0) delete faction.orders[order.id];
  ensureShelf(store, factionId, seller).sales += 1;
  return { ok: true, order, qty: take, price: order.price, value, tax, proceeds: value - tax };
}

// Отмена: ордер на продажу возвращает товар, ордер на выкуп — удержанные марки.
// Сбор за размещение не возвращается.
function cancelOrder(store = {}, factionId = '', orderId = '', ownerCharacterId = '', now = Date.now()) {
  const faction = store?.factions?.[cleanId(factionId, 32)];
  const order = faction?.orders?.[cleanId(orderId, 64)];
  if (!order) return { ok: false, error: 'Ордер уже снят.' };
  if (order.ownerCharacterId !== cleanId(ownerCharacterId, 96)) return { ok: false, error: 'Это не ваш ордер.' };
  delete faction.orders[order.id];
  const shelf = ensureShelf(store, factionId, order.ownerCharacterId);
  if (order.side === 'buy') shelf.silver += order.escrow;
  else shelf.items.push({ itemId: order.itemId, qty: order.qty, records: order.records, reason: 'cancelled', at: Number(now) });
  return { ok: true, order };
}

// Конец срока: непроданный товар и неизрасходованные марки ложатся владельцу
// на полку. Вызывается по тику.
function expireOrders(store = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const resolved = [];
  for (const [factionId, faction] of Object.entries(store?.factions || {})) {
    for (const order of Object.values(faction.orders || {})) {
      if (order.expiresAt > Number(now)) continue;
      delete faction.orders[order.id];
      const shelf = ensureShelf(store, factionId, order.ownerCharacterId);
      if (order.side === 'buy') shelf.silver += order.escrow;
      else shelf.items.push({ itemId: order.itemId, qty: order.qty, records: order.records, reason: 'expired', at: Number(now) });
      resolved.push({ ...order, resolution: 'expired' });
    }
  }
  return resolved;
}

// Положить на полку то, что не поместилось в рюкзак покупателя прямо сейчас:
// купленное по ордеру не может пропасть из-за веса.
function creditShelfItems(store = {}, factionId = '', characterId = '', rows = [], now = Date.now()) {
  const shelf = ensureShelf(store, factionId, characterId);
  for (const row of Array.isArray(rows) ? rows : []) {
    const itemId = cleanId(row?.itemId, 64);
    const qty = Math.max(0, Math.floor(Number(row?.qty || 0)));
    if (!itemId || qty <= 0) continue;
    shelf.items.push({
      itemId,
      qty,
      records: sanitizeRecords(row?.records),
      reason: String(row?.reason || 'bought').slice(0, 16),
      at: Number(now)
    });
  }
  return shelf;
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
    // Несколько поступлений одного предмета в одну секунду делят ключ — суммируем.
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
 * рынка не знал про каталог артефактов; без неё остаётся только счётчик.
 */
function publicOrder(order = {}, now = Date.now(), viewerCharacterId = '', projectArtifact = null) {
  const artifactRows = (order.records || []).filter(row => row?.artifact);
  return {
    id: order.id,
    side: order.side,
    itemId: order.itemId,
    category: order.category,
    qty: order.qty,
    filled: order.filled,
    price: order.price,
    total: order.qty * order.price,
    ownerName: order.ownerName || 'Член фракции',
    mine: order.ownerCharacterId === cleanId(viewerCharacterId, 96),
    remainingSeconds: Math.max(0, Math.round((Number(order.expiresAt) - Number(now)) / 1000)),
    durationHours: Math.max(1, Math.round(Number(order.durationMs || 0) / HOUR_MS)),
    artifactCount: artifactRows.length,
    artifacts: typeof projectArtifact === 'function'
      ? artifactRows.map(row => projectArtifact(row.artifact)).filter(Boolean)
      : []
  };
}

// Сводка книги по предметам: сколько предлагают и почём, сколько выкупают и
// почём. По ней экран строит список товаров, не пересчитывая ордера сам.
function marketItems(orders = []) {
  const rows = new Map();
  for (const order of orders) {
    let row = rows.get(order.itemId);
    if (!row) {
      row = { itemId: order.itemId, category: order.category, sellQty: 0, sellPrice: 0, buyQty: 0, buyPrice: 0, mine: false };
      rows.set(order.itemId, row);
    }
    if (order.mine) row.mine = true;
    if (order.side === 'sell') {
      row.sellQty += order.qty;
      row.sellPrice = row.sellPrice ? Math.min(row.sellPrice, order.price) : order.price;
    } else {
      row.buyQty += order.qty;
      row.buyPrice = Math.max(row.buyPrice, order.price);
    }
  }
  return [...rows.values()].sort((a, b) => b.sellQty + b.buyQty - (a.sellQty + a.buyQty));
}

function publicMarket(store = {}, factionId = '', viewerCharacterId = '', rules = DEFAULT_RULES, now = Date.now(), options = {}) {
  const shelf = shelfFor(store, factionId, viewerCharacterId);
  const projectArtifact = typeof options?.projectArtifact === 'function' ? options.projectArtifact : null;
  const orders = activeOrders(store, factionId, now)
    .map(row => publicOrder(row, now, viewerCharacterId, projectArtifact));
  const items = marketItems(orders);
  const counts = new Map();
  for (const row of items) counts.set(row.category, (counts.get(row.category) || 0) + 1);
  return {
    factionId: cleanId(factionId, 32),
    taxPct: rules.taxPct,
    setupFeePct: rules.setupFeePct,
    listingLifetimeHours: Math.round(rules.listingLifetimeMs / HOUR_MS),
    durationChoicesHours: rules.durationChoicesMs.map(value => Math.round(value / HOUR_MS)),
    limits: {
      minPrice: rules.minPrice,
      maxPrice: rules.maxPrice,
      maxQtyPerOrder: rules.maxQtyPerOrder,
      maxOrdersPerTrader: rules.maxOrdersPerTrader
    },
    categories: CATEGORY_IDS.map(id => ({ id, label: CATEGORY_LABELS[id], count: counts.get(id) || 0 })),
    items,
    orders,
    mineCount: orders.filter(row => row.mine).length,
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
  activeOrders,
  bestPrice,
  bookSide,
  cancelOrder,
  commitShelfClaim,
  creditShelfItems,
  expireOrders,
  marketItems,
  normalizeMarketRules,
  normalizeMarketStore,
  ordersOf,
  placeBuyOrder,
  placeSellOrder,
  publicMarket,
  publicOrder,
  saleTax,
  setupFeeFor,
  shelfFor,
  takeBuyOrder,
  takeSellOrder
};
