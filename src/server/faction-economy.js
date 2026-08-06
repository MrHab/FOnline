'use strict';

const DEFAULT_RECIPE_DATA = require('../../data/economy-recipes.json');
const DEFAULT_TRADER_DATA = require('../../data/traders.json');

function safeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeStockObject(input = {}) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [rawId, rawQty] of Object.entries(input)) {
    const id = safeId(rawId);
    const qty = Math.max(0, Number(rawQty || 0));
    if (id && Number.isFinite(qty) && qty > 0) out[id] = Number(qty.toFixed(3));
  }
  return out;
}

function normalizeRecipeCatalog(raw = DEFAULT_RECIPE_DATA) {
  const source = raw && typeof raw === 'object' && raw.recipes && typeof raw.recipes === 'object'
    ? raw.recipes
    : raw;
  const out = {};
  for (const [rawId, row] of Object.entries(source || {})) {
    if (!row || typeof row !== 'object') continue;
    const id = safeId(row.id || rawId);
    const station = safeId(row.station || row.stationId);
    const inputs = normalizeStockObject(row.inputs);
    if (!id || !station || !Object.keys(inputs).length) continue;
    out[id] = {
      id,
      station,
      workHours: clamp(row.workHours ?? 1, 0.1, 720),
      outputQty: Math.max(1, Math.floor(Number(row.outputQty ?? row.qty ?? 1))),
      inputs,
      factions: Array.isArray(row.factions) ? row.factions.map(safeId).filter(Boolean).slice(0, 12) : []
    };
  }
  return out;
}

function defaultShelfPriority(id = '', target = 1) {
  if (['water', 'food', 'stim', 'medkit', 'ammo9', 'ammo556', 'shotgunShell', 'energyCell'].includes(id)) return 90;
  if (['repairKit', 'antibiotics', 'doctorBag', 'napalm', 'rocketAmmo'].includes(id)) return 78;
  if (['pistol', 'rifle', 'shotgun', 'leather', 'helmet', 'boots', 'backpack'].includes(id)) return 70;
  if (target <= 1) return 58;
  return 64;
}

function normalizeTraderPlanRows(rows = []) {
  const byId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = safeId(row?.id || row?.itemId);
    const target = Math.max(0, Math.floor(Number(row?.shelfTarget ?? row?.qty ?? row?.count ?? 0)));
    if (!id || target <= 0) continue;
    const minDefault = target <= 1 ? 0 : Math.max(1, Math.floor(target * 0.3));
    const shelfMin = clamp(Math.floor(Number(row?.shelfMin ?? minDefault)), 0, target);
    const shelfMax = Math.max(target, Math.floor(Number(row?.shelfMax ?? Math.ceil(target * 1.35))));
    const next = {
      id,
      price: Math.max(1, Math.round(Number(row?.price ?? 1))),
      shelfMin,
      shelfTarget: target,
      shelfMax,
      priority: clamp(Math.round(Number(row?.priority ?? defaultShelfPriority(id, target))), 1, 100)
    };
    const existing = byId.get(id);
    if (!existing) byId.set(id, next);
    else {
      existing.shelfMin += next.shelfMin;
      existing.shelfTarget += next.shelfTarget;
      existing.shelfMax += next.shelfMax;
      existing.priority = Math.max(existing.priority, next.priority);
    }
  }
  return [...byId.values()];
}

function normalizeMarketStockRows(rows = []) {
  const byId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = safeId(row?.id || row?.itemId);
    const qty = Math.max(0, Math.floor(Number(row?.qty ?? row?.count ?? 0)));
    if (!id || qty <= 0) continue;
    const existing = byId.get(id);
    if (existing) existing.qty += qty;
    else byId.set(id, { id, qty, price: Math.max(1, Math.round(Number(row?.price ?? 1))) });
  }
  return [...byId.values()].slice(0, 96);
}

function normalizeRetailMarket(input = {}, fallbackKey = '') {
  const row = input && typeof input === 'object' ? input : {};
  const key = String(row.key || fallbackKey || '').trim().replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 120);
  return {
    key,
    profileId: safeId(row.profileId || row.traderProfile || ''),
    role: safeId(row.role || 'trader'),
    restockHours: clamp(Math.floor(Number(row.restockHours ?? 24)), 1, 720),
    lastRestockHour: Number.isFinite(Number(row.lastRestockHour)) ? Number(row.lastRestockHour) : -999,
    baseCaps: Math.max(0, Math.floor(Number(row.baseCaps ?? row.caps ?? 0))),
    caps: Math.max(0, Math.floor(Number(row.caps || 0))),
    plan: normalizeTraderPlanRows(row.plan || row.baseStock || []),
    stock: normalizeMarketStockRows(row.stock),
    sales: row.sales && typeof row.sales === 'object' && !Array.isArray(row.sales) ? { ...row.sales } : {},
    bootstrapVersion: Math.max(0, Math.floor(Number(row.bootstrapVersion || 0))),
    updatedHour: Number.isFinite(Number(row.updatedHour)) ? Number(row.updatedHour) : 0
  };
}

function normalizeTraderProfiles(raw = DEFAULT_TRADER_DATA) {
  const source = raw && typeof raw === 'object' && raw.profiles && typeof raw.profiles === 'object'
    ? raw.profiles
    : raw;
  const out = {};
  for (const [rawId, row] of Object.entries(source || {})) {
    if (!row || typeof row !== 'object') continue;
    const id = safeId(row.id || rawId);
    if (!id) continue;
    out[id] = {
      id,
      caps: Math.max(0, Math.floor(Number(row.caps || 0))),
      restockHours: clamp(Math.floor(Number(row.restockHours ?? 24)), 1, 720),
      stock: normalizeTraderPlanRows(row.stock)
    };
  }
  return out;
}

function retailMarketKey(profileId = '', context = {}) {
  const explicit = String(context.marketKey || '').trim().replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 120);
  if (explicit) return explicit;
  const siteId = safeId(context.siteId || context.worldSiteId || context.locationId || 'site');
  const profile = safeId(profileId || context.traderProfile || context.tradeProfile || 'market');
  const role = safeId(context.role || 'trader');
  return `${siteId}:${profile}:${role}`.slice(0, 120);
}

module.exports = {
  DEFAULT_RECIPE_DATA,
  DEFAULT_TRADER_DATA,
  normalizeRecipeCatalog,
  normalizeMarketStockRows,
  normalizeRetailMarket,
  normalizeTraderPlanRows,
  normalizeTraderProfiles,
  retailMarketKey
};
