'use strict';

// Мешок и рюкзак с добычей. Что выпало при смерти, лежит одним контейнером в
// шаге от тела, а не на самом трупе и не россыпью по земле: убитый NPC или
// зверь роняет мешок, погибший игрок — рюкзак. Контейнер обыскивают как любой
// другой; опустевший исчезает сразу, нетронутый — по сроку своего вида.
// Модуль чистый: сервер кладёт контейнер в комнату, сохраняет и выдаёт добычу.

const LOOT_BAG_KINDS = Object.freeze({
  sack: Object.freeze({ label: 'Мешок', ttlMs: 10 * 60 * 1000 }),
  backpack: Object.freeze({ label: 'Рюкзак', ttlMs: 30 * 60 * 1000 })
});
// Контейнер лежит в шаге от тела: у ног остаются тело и туша со шкурой.
const LOOT_BAG_OFFSET_M = 0.85;

function lootBagKind(kind) {
  return Object.prototype.hasOwnProperty.call(LOOT_BAG_KINDS, kind) ? kind : 'sack';
}

/** Строки добычи без пустых, без кулаков и с одним рядом на предмет. */
function mergeLootRows(rows = [], isItem = () => true) {
  const merged = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || '');
    const qty = Math.floor(Number(row?.qty || 0));
    if (!id || id === 'fists' || qty <= 0 || !isItem(id)) continue;
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
}

/** Имя в окне обыска: «Мешок — Крысюк», «Рюкзак — Вера». */
function lootBagName(kind, ownerName = '') {
  const label = LOOT_BAG_KINDS[lootBagKind(kind)].label;
  const owner = String(ownerName || '').trim().slice(0, 48);
  return owner ? `${label} — ${owner}` : label;
}

/**
 * Точка контейнера: в шаге от тела по направлению turn01 (0..1). Если там
 * стоять нельзя (canStand(x, z) === false), пробуются ещё три стороны, а потом
 * контейнер ложится у самого тела.
 */
function lootBagPoint(origin, turn01 = 0, canStand = () => true) {
  const x0 = Number(origin?.x || 0), z0 = Number(origin?.z || 0);
  for (let step = 0; step < 4; step++) {
    const angle = (Number(turn01) + step * 0.25) * Math.PI * 2;
    const x = x0 + Math.cos(angle) * LOOT_BAG_OFFSET_M;
    const z = z0 + Math.sin(angle) * LOOT_BAG_OFFSET_M;
    if (canStand(x, z)) return { x, z };
  }
  return { x: x0, z: z0 };
}

/**
 * Запись контейнера или null, если класть нечего. records — записи экземпляров
 * по id предмета (оружие с магазином и модулями, артефакты); лишние обрезаются
 * до количества в добыче.
 */
function buildLootBag({ id, kind, ownerName = '', x, z, tx, tz, rows, records = {}, now, source = {}, isItem = () => true }) {
  const loot = mergeLootRows(rows, isItem);
  if (!id || !loot.length) return null;
  const bagKind = lootBagKind(kind);
  const runtime = {};
  for (const row of loot) {
    const list = Array.isArray(records?.[row.id]) ? records[row.id].filter(Boolean).slice(0, row.qty) : [];
    if (list.length) runtime[row.id] = list;
  }
  return {
    id: String(id),
    defId: 'lootBag',
    lootBag: true,
    kind: bagKind,
    name: lootBagName(bagKind, ownerName),
    tier: 'bag',
    tx: Number(tx || 0),
    tz: Number(tz || 0),
    x: Number(Number(x || 0).toFixed(3)),
    z: Number(Number(z || 0).toFixed(3)),
    locked: false,
    terminalLocked: false,
    loot,
    itemRuntimeRecords: runtime,
    sourceType: String(source.type || ''),
    sourceId: String(source.id || '').slice(0, 96),
    sourceFaction: String(source.faction || '').slice(0, 32),
    killerId: String(source.killerId || '').slice(0, 96),
    traderBalance: source.traderBalance === true,
    createdAt: now,
    expiresAt: now + LOOT_BAG_KINDS[bagKind].ttlMs
  };
}

/** Пора ли убрать контейнер: истёк срок или в нём ничего не осталось. */
function lootBagSpent(bag, now = Date.now()) {
  return !bag || now >= Number(bag.expiresAt || 0) || !mergeLootRows(bag.loot).length;
}

/** Забрать записи экземпляров для qty взятых единиц itemId (их больше в контейнере нет). */
function takeLootBagRecords(bag, itemId, qty) {
  const list = Array.isArray(bag?.itemRuntimeRecords?.[itemId]) ? bag.itemRuntimeRecords[itemId] : [];
  const taken = list.splice(0, Math.max(0, Math.floor(Number(qty || 0))));
  if (!list.length && bag?.itemRuntimeRecords) delete bag.itemRuntimeRecords[itemId];
  return taken;
}

/**
 * Контейнер из сохранения: только свои поля, живые предметы и записи экземпляров
 * (sanitizeRecord(record, itemId) → запись или null). Истёкший и пустой — null.
 */
function restoreLootBag(raw = {}, { now = Date.now(), isItem = () => true, sanitizeRecord = record => record } = {}) {
  const records = {};
  for (const [itemId, list] of Object.entries(raw?.itemRuntimeRecords || {})) {
    if (!Array.isArray(list)) continue;
    records[itemId] = list.map(record => sanitizeRecord(record, itemId)).filter(Boolean);
  }
  const createdAt = Math.floor(Number(raw?.createdAt || 0));
  const bag = buildLootBag({
    id: String(raw?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96),
    kind: raw?.kind,
    x: raw?.x,
    z: raw?.z,
    tx: raw?.tx,
    tz: raw?.tz,
    rows: raw?.loot,
    records,
    now: createdAt,
    source: { type: raw?.sourceType, id: raw?.sourceId, faction: raw?.sourceFaction, killerId: raw?.killerId, traderBalance: raw?.traderBalance === true },
    isItem
  });
  if (!bag || !createdAt) return null;
  bag.name = String(raw?.name || bag.name).slice(0, 80);
  bag.expiresAt = Math.min(bag.expiresAt, Math.floor(Number(raw?.expiresAt || bag.expiresAt)));
  return lootBagSpent(bag, now) ? null : bag;
}

/** Запись для сохранения: без служебных полей комнаты. */
function persistedLootBag(bag = {}) {
  return {
    id: bag.id,
    kind: bag.kind,
    name: bag.name,
    x: bag.x,
    z: bag.z,
    tx: bag.tx,
    tz: bag.tz,
    loot: mergeLootRows(bag.loot),
    itemRuntimeRecords: bag.itemRuntimeRecords || {},
    sourceType: bag.sourceType || '',
    sourceId: bag.sourceId || '',
    sourceFaction: bag.sourceFaction || '',
    killerId: bag.killerId || '',
    traderBalance: bag.traderBalance === true,
    createdAt: bag.createdAt,
    expiresAt: bag.expiresAt
  };
}

module.exports = {
  LOOT_BAG_KINDS,
  LOOT_BAG_OFFSET_M,
  lootBagKind,
  mergeLootRows,
  lootBagName,
  lootBagPoint,
  buildLootBag,
  lootBagSpent,
  takeLootBagRecords,
  restoreLootBag,
  persistedLootBag
};
