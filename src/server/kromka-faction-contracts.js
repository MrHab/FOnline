'use strict';

const KROMKA_FACTION_IDS = Object.freeze([
  'uprava', 'free_artels', 'contour', 'tract_league', 'seconds', 'continuity'
]);
const KROMKA_FACTION_ID_SET = new Set(KROMKA_FACTION_IDS);
const KROMKA_FACTION_ALIASES = Object.freeze({
  old_klim: 'uprava',
  klim_patrol: 'uprava',
  scrap: 'free_artels',
  scrap_town: 'free_artels',
  scrap_union: 'free_artels',
  relay: 'contour',
  relay_station: 'contour',
  relay_order: 'contour',
  caravan: 'tract_league',
  caravans: 'tract_league'
});
const PLAYER_FACTION_MODEL_VERSION = 3;

function canonicalKromkaFactionId(value = '') {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  const canonical = KROMKA_FACTION_ALIASES[key] || key;
  return KROMKA_FACTION_ID_SET.has(canonical) ? canonical : '';
}

function sanitizeKromkaReputation(input = {}) {
  const out = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const [rawFaction, rawValue] of Object.entries(source)) {
    const factionId = canonicalKromkaFactionId(rawFaction);
    if (!factionId) continue;
    out[factionId] = Math.max(-1000, Math.min(9999, Math.floor(Number(rawValue || 0))));
  }
  return out;
}

function sanitizeKromkaContracts(input = {}, now = Date.now()) {
  const out = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const [rawFaction, rawContract] of Object.entries(source)) {
    const factionId = canonicalKromkaFactionId(rawFaction);
    if (!factionId || !rawContract || typeof rawContract !== 'object') continue;
    const expiresAt = Math.max(0, Math.floor(Number(rawContract.expiresAt || 0)));
    const taskId = String(rawContract.taskId || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 120);
    if (!taskId && expiresAt > 0 && expiresAt <= now) continue;
    out[factionId] = {
      taskId,
      issuedAt: Math.max(0, Math.floor(Number(rawContract.issuedAt || now))),
      expiresAt,
      source: String(rawContract.source || 'contract').slice(0, 32)
    };
  }
  return out;
}

function migrateKromkaPlayerFactionState(state = {}, now = Date.now()) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const profile = state.characterProfile && typeof state.characterProfile === 'object'
    ? state.characterProfile
    : (state.characterProfile = {});
  const legacyFactionId = canonicalKromkaFactionId(profile.worldFactionId || profile.factionId || '');
  profile.factionId = '';
  profile.worldFactionId = '';
  delete profile.factionJoinedAt;
  delete profile.factionName;

  const reputation = sanitizeKromkaReputation({
    ...(profile.worldFactionReputation && typeof profile.worldFactionReputation === 'object' ? profile.worldFactionReputation : {}),
    ...(state.worldFactionReputation && typeof state.worldFactionReputation === 'object' ? state.worldFactionReputation : {})
  });
  if (legacyFactionId) reputation[legacyFactionId] = Math.max(25, Number(reputation[legacyFactionId] || 0));
  state.worldFactionReputation = reputation;
  profile.worldFactionReputation = { ...reputation };
  delete state.archivedWorldFactionReputation;
  delete profile.archivedWorldFactionReputation;

  const contracts = sanitizeKromkaContracts(state.factionContracts || profile.factionContracts || {}, now);
  if (legacyFactionId && !contracts[legacyFactionId]) {
    contracts[legacyFactionId] = {
      taskId: '',
      issuedAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      source: 'legacy-transition'
    };
  }
  state.factionContracts = contracts;
  profile.factionContracts = { ...contracts };
  state.worldFactionModelVersion = PLAYER_FACTION_MODEL_VERSION;
  return state;
}

module.exports = {
  KROMKA_FACTION_ALIASES,
  KROMKA_FACTION_IDS,
  PLAYER_FACTION_MODEL_VERSION,
  canonicalKromkaFactionId,
  migrateKromkaPlayerFactionState,
  sanitizeKromkaContracts,
  sanitizeKromkaReputation
};
