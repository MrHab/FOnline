'use strict';

const BASE_SCHEMA_VERSION = 1;

function cleanId(value = '', max = 96) {
  return String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, max);
}

function createPersonalBase(accountId = '', now = Date.now()) {
  return {
    schemaVersion: BASE_SCHEMA_VERSION,
    accountId: cleanId(accountId),
    rights: { granted: false, outcomeId: '', questId: 'personal_aktov_air_rights', grantedAt: 0 },
    tier: 1,
    objects: [],
    permissions: {},
    jobs: [],
    residents: [],
    residentStates: {},
    inventory: {},
    inventoryRuntime: {},
    createdAt: Number(now),
    updatedAt: Number(now)
  };
}

function sanitizePersonalBase(input = {}, accountId = '', catalog = {}, now = Date.now()) {
  const base = { ...createPersonalBase(accountId, now), ...(input && typeof input === 'object' ? input : {}) };
  base.schemaVersion = BASE_SCHEMA_VERSION;
  base.accountId = cleanId(accountId || base.accountId);
  const outcomes = new Set((catalog.rightsQuest?.outcomes || []).map(row => row.id));
  base.rights = {
    granted: base.rights?.granted === true,
    outcomeId: outcomes.has(String(base.rights?.outcomeId || '')) ? String(base.rights.outcomeId) : '',
    questId: String(catalog.rightsQuest?.id || 'personal_aktov_air_rights'),
    grantedAt: Math.max(0, Number(base.rights?.grantedAt || 0))
  };
  base.tier = Math.max(1, Math.min((catalog.tiers || []).length || 1, Math.floor(Number(base.tier || 1))));
  const validTypes = new Set((catalog.objects || []).map(row => row.id));
  const seen = new Set();
  base.objects = (Array.isArray(base.objects) ? base.objects : []).map((row, index) => {
    const id = cleanId(row?.id || `built_${index}`);
    const typeId = cleanId(row?.typeId);
    if (!id || seen.has(id) || !validTypes.has(typeId)) return null;
    seen.add(id);
    return { id, typeId, x: Number(row.x || 0), z: Number(row.z || 0), rotation: Number(row.rotation || 0), builtAt: Math.max(0, Number(row.builtAt || 0)) };
  }).filter(Boolean).slice(0, 160);
  base.permissions = Object.fromEntries(Object.entries(base.permissions || {}).slice(0, 32).map(([id, value]) => [cleanId(id), {
    visit: value?.visit === true, build: value?.build === true, storage: value?.storage === true, stations: value?.stations === true
  }]).filter(([id]) => id));
  base.jobs = (Array.isArray(base.jobs) ? base.jobs : []).map(row => ({
    id: cleanId(row?.id), typeId: cleanId(row?.typeId), startedAt: Math.max(0, Number(row?.startedAt || 0)), completesAt: Math.max(0, Number(row?.completesAt || 0)), claimed: row?.claimed === true
  })).filter(row => row.id && row.typeId);
  // Never evict paid, unclaimed production when trimming the history.
  base.jobs = [...base.jobs.filter(row => !row.claimed), ...base.jobs.filter(row => row.claimed).slice(-10)];
  base.residents = (Array.isArray(base.residents) ? base.residents : []).map(value => cleanId(value)).filter(Boolean).slice(0, 8);
  base.residentStates = base.residentStates && typeof base.residentStates === 'object' ? base.residentStates : {};
  base.inventory = Object.fromEntries(Object.entries(base.inventory || {}).map(([id, qty]) => [cleanId(id, 64), Math.max(0, Math.floor(Number(qty || 0))) ]).filter(([id, qty]) => id && qty > 0));
  base.inventoryRuntime = base.inventoryRuntime && typeof base.inventoryRuntime === 'object' && !Array.isArray(base.inventoryRuntime)
    ? base.inventoryRuntime : {};
  base.createdAt = Math.max(0, Number(base.createdAt || now));
  base.updatedAt = Math.max(base.createdAt, Number(base.updatedAt || now));
  return base;
}

function publicPersonalBase(base = {}, catalog = {}, now = Date.now()) {
  const tier = (catalog.tiers || []).find(row => Number(row.level) === Number(base.tier)) || catalog.tiers?.[0] || {};
  const energy = (base.objects || []).reduce((sum, placed) => sum + Number((catalog.objects || []).find(row => row.id === placed.typeId)?.energy || 0), 0);
  const water = (base.objects || []).reduce((sum, placed) => sum + Number((catalog.objects || []).find(row => row.id === placed.typeId)?.water || 0), 0);
  return {
    schemaVersion: BASE_SCHEMA_VERSION,
    rights: { ...base.rights }, tier: base.tier, tierProfile: tier,
    objects: (base.objects || []).map(row => ({ ...row })),
    jobs: (base.jobs || []).map(row => ({ ...row, ready: !row.claimed && Number(row.completesAt || 0) <= now })),
    residents: [...(base.residents || [])], permissions: { ...(base.permissions || {}) },
    energy, water, objectCount: (base.objects || []).length,
    inventory: { ...(base.inventory || {}) }, inventoryWeaponRuntime: Object.values(base.inventoryRuntime || {}), updatedAt: base.updatedAt
  };
}

module.exports = { BASE_SCHEMA_VERSION, createPersonalBase, publicPersonalBase, sanitizePersonalBase };
