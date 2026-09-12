'use strict';

const CLAN_STATE_VERSION = 1;
const clean = (value = '', max = 80) => String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, max);

function sanitizeClanStore(input = {}) {
  const store = input && typeof input === 'object' ? input : {};
  if (!store.clans || typeof store.clans !== 'object') store.clans = {};
  if (!store.bases || typeof store.bases !== 'object') store.bases = {};
  for (const clan of Object.values(store.clans)) {
    if (!clan || typeof clan !== 'object') continue;
    if (!clan.storage || typeof clan.storage !== 'object' || Array.isArray(clan.storage)) clan.storage = {};
    if (!clan.storageRuntime || typeof clan.storageRuntime !== 'object' || Array.isArray(clan.storageRuntime)) clan.storageRuntime = {};
    if (!clan.protectedRallyCooldowns || typeof clan.protectedRallyCooldowns !== 'object' || Array.isArray(clan.protectedRallyCooldowns)) clan.protectedRallyCooldowns = {};
  }
  for (const base of Object.values(store.bases)) {
    if (!base || typeof base !== 'object') continue;
    if (!base.modules || typeof base.modules !== 'object' || Array.isArray(base.modules)) base.modules = {};
    if (!base.benefitCredits || typeof base.benefitCredits !== 'object' || Array.isArray(base.benefitCredits)) base.benefitCredits = {};
    if (!base.benefitOrderCooldowns || typeof base.benefitOrderCooldowns !== 'object' || Array.isArray(base.benefitOrderCooldowns)) base.benefitOrderCooldowns = {};
    if (!Array.isArray(base.history)) base.history = [];
  }
  store.version = CLAN_STATE_VERSION;
  return store;
}

function ensureClan(storeInput = {}, socialClan = {}, player = {}, now = Date.now()) {
  const store = sanitizeClanStore(storeInput);
  const id = clean(socialClan.id);
  if (!id || !String(socialClan.name || '').trim()) return null;
  if (!store.clans[id]) store.clans[id] = { id, name: String(socialClan.name).slice(0, 42), members: {}, storage: {}, storageRuntime: {}, modules: {}, baseId: '', log: [], createdAt: now, lastActiveAt: now };
  const clan = store.clans[id];
  if (!clan.storage || typeof clan.storage !== 'object' || Array.isArray(clan.storage)) clan.storage = {};
  if (!clan.storageRuntime || typeof clan.storageRuntime !== 'object' || Array.isArray(clan.storageRuntime)) clan.storageRuntime = {};
  const memberId = clean(player.characterId);
  if (memberId) {
    const current = clan.members[memberId] || {};
    clan.members[memberId] = { characterId: memberId, name: String(player.name || '').slice(0, 42), role: String(socialClan.role || current.role || 'Участник').slice(0, 28), joinedAt: Number(current.joinedAt || now), lastSeenAt: now };
  }
  clan.lastActiveAt = now;
  return clan;
}

function canManage(clan = {}, characterId = '') {
  const role = String(clan.members?.[clean(characterId)]?.role || '');
  return role === 'Основатель' || role === 'Офицер';
}

function ensureBaseStates(storeInput = {}, catalog = {}, now = Date.now()) {
  const store = sanitizeClanStore(storeInput);
  for (const profile of catalog.bases || []) {
    if (!store.bases[profile.id]) store.bases[profile.id] = { id: profile.id, ownerClanId: '', claimedAt: 0, lastUpkeepAt: now, lastWeeklyBenefitAt: 0, modules: {}, garrison: 0, benefitCredits: {}, benefitOrderCooldowns: {}, history: [] };
    const base = store.bases[profile.id];
    if (!base.modules || typeof base.modules !== 'object') base.modules = {};
    if (!base.benefitCredits || typeof base.benefitCredits !== 'object') base.benefitCredits = {};
    if (!base.benefitOrderCooldowns || typeof base.benefitOrderCooldowns !== 'object') base.benefitOrderCooldowns = {};
    if (!Array.isArray(base.history)) base.history = [];
  }
  return store.bases;
}

function claimBase(storeInput = {}, clanId = '', baseId = '', characterId = '', catalog = {}, now = Date.now()) {
  const store = sanitizeClanStore(storeInput); ensureBaseStates(store, catalog, now);
  const clan = store.clans[clean(clanId)]; const base = store.bases[clean(baseId)];
  if (!clan || !base) return { ok: false, error: 'Клан или база не найдены.' };
  if (!canManage(clan, characterId)) return { ok: false, error: 'Нужна роль основателя или офицера.' };
  if (clan.baseId && clan.baseId !== base.id) return { ok: false, error: 'Один клан может владеть только одной публичной базой.' };
  if (base.ownerClanId && base.ownerClanId !== clan.id) return { ok: false, error: 'База занята; её можно оспорить только в окно осады.' };
  if (base.ownerClanId === clan.id) return { ok: true, duplicate: true, base };
  base.ownerClanId = clan.id; base.claimedAt = now; base.lastUpkeepAt = now; base.lastWeeklyBenefitAt = 0;
  base.benefitCredits = {}; base.benefitOrderCooldowns = {};
  clan.baseId = base.id; clan.lastActiveAt = now;
  base.history.push({ type: 'claim', clanId: clan.id, at: now }); clan.log.push({ type: 'base_claim', baseId: base.id, at: now });
  return { ok: true, base };
}

function releaseInactiveBases(storeInput = {}, catalog = {}, now = Date.now()) {
  const store = sanitizeClanStore(storeInput); ensureBaseStates(store, catalog, now);
  const ttl = Number(catalog.inactiveReturnMs || 14 * 86400000); const released = [];
  for (const base of Object.values(store.bases)) {
    if (!base.ownerClanId) continue;
    const clan = store.clans[base.ownerClanId];
    if (clan && now - Number(clan.lastActiveAt || 0) < ttl && now - Number(base.lastUpkeepAt || 0) < ttl) continue;
    if (clan) clan.baseId = '';
    base.history.push({ type: 'npc_return', previousClanId: base.ownerClanId, at: now });
    base.ownerClanId = ''; base.modules = {}; base.lastWeeklyBenefitAt = 0;
    base.benefitCredits = {}; base.benefitOrderCooldowns = {}; released.push(base.id);
  }
  return released;
}

function installModule(storeInput = {}, clanId = '', baseId = '', socketId = '', moduleId = '', characterId = '', catalog = {}, now = Date.now()) {
  const store = sanitizeClanStore(storeInput); const clan = store.clans[clean(clanId)]; const base = store.bases[clean(baseId)];
  const profile = (catalog.modules || []).find(row => row.id === moduleId);
  if (!clan || !base || base.ownerClanId !== clan.id) return { ok: false, error: 'Эта база не принадлежит клану.' };
  if (!canManage(clan, characterId)) return { ok: false, error: 'Недостаточно прав.' };
  if (!profile || !(profile.allowedSockets || []).includes(socketId)) return { ok: false, error: 'Модуль не подходит к этой позиции.' };
  if (base.modules[socketId]) return { ok: false, error: 'Позиция уже занята.' };
  base.modules[socketId] = profile.id; clan.lastActiveAt = now;
  return { ok: true, cost: { ...(profile.cost || {}) }, module: { socketId, moduleId: profile.id } };
}

function publicClanState(storeInput = {}, clanId = '', catalog = {}) {
  const store = sanitizeClanStore(storeInput); ensureBaseStates(store, catalog);
  const clan = store.clans[clean(clanId)] || null;
  return {
    clan: clan ? { id: clan.id, name: clan.name, members: Object.values(clan.members || {}), storage: { ...(clan.storage || {}) }, storageWeaponRuntime: Object.values(clan.storageRuntime || {}), baseId: clan.baseId, log: (clan.log || []).slice(-40) } : null,
    bases: (catalog.bases || []).map(profile => ({ ...profile, runtime: { ...(store.bases[profile.id] || {}) }, ownerName: store.clans[store.bases[profile.id]?.ownerClanId]?.name || 'Нейтральный гарнизон' })),
    moduleSockets: [...(catalog.moduleSockets || [])],
    modules: (catalog.modules || []).map(profile => ({ ...profile }))
  };
}

module.exports = { CLAN_STATE_VERSION, canManage, claimBase, ensureBaseStates, ensureClan, installModule, publicClanState, releaseInactiveBases, sanitizeClanStore };
