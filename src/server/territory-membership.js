'use strict';

/**
 * Принадлежность персонажа к фракции для центральной территории (Сердцевины).
 *
 * Это отдельное от репутации и временных контрактов понятие: оно сохраняется
 * между сессиями, проверяется сервером на каждом пути входа на территорию и
 * имеет настраиваемый кулдаун смены. Репутация и контракты не изменяются.
 */
const TERRITORY_MEMBERSHIP_VERSION = 1;
const DEFAULT_CHANGE_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const MAX_HISTORY = 12;

function safeId(value = '', limit = 32) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function territoryFactionIds(catalog = {}) {
  return (Array.isArray(catalog?.factions) ? catalog.factions : [])
    .map(row => safeId(row?.id))
    .filter(Boolean);
}

function territoryFactionRow(catalog = {}, factionId = '') {
  const id = safeId(factionId);
  return (Array.isArray(catalog?.factions) ? catalog.factions : []).find(row => safeId(row?.id) === id) || null;
}

function territoryChangeCooldownMs(catalog = {}) {
  const value = Number(catalog?.rules?.factionChangeCooldownMs);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_CHANGE_COOLDOWN_MS;
}

function sanitizeTerritoryMembership(input = {}, catalog = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const known = new Set(territoryFactionIds(catalog));
  const factionId = safeId(src.factionId);
  const history = (Array.isArray(src.history) ? src.history : [])
    .map(row => ({
      factionId: safeId(row?.factionId),
      action: safeId(row?.action, 16) || 'join',
      at: Math.max(0, Math.floor(Number(row?.at || 0)))
    }))
    .filter(row => row.at > 0)
    .slice(-MAX_HISTORY);
  return {
    version: TERRITORY_MEMBERSHIP_VERSION,
    factionId: known.has(factionId) ? factionId : '',
    joinedAt: known.has(factionId) ? Math.max(0, Math.floor(Number(src.joinedAt || 0))) : 0,
    changeAllowedAt: Math.max(0, Math.floor(Number(src.changeAllowedAt || 0))),
    history
  };
}

function territoryMembershipActive(membership = {}) {
  return !!safeId(membership?.factionId);
}

/**
 * Проверка возможности вступить. Причины отказа — пользовательские строки.
 */
function canJoinTerritoryFaction(membership = {}, factionId = '', catalog = {}, now = Date.now(), options = {}) {
  const current = sanitizeTerritoryMembership(membership, catalog);
  const target = safeId(factionId);
  if (!territoryFactionRow(catalog, target)) {
    return { ok: false, error: 'Эта фракция не открывает доступ к Сердцевине.' };
  }
  if (current.factionId === target) {
    return { ok: false, error: 'Вы уже состоите в этой фракции.', alreadyMember: true };
  }
  if (current.changeAllowedAt > now) {
    return {
      ok: false,
      error: 'Смена фракции пока закрыта.',
      retryAt: current.changeAllowedAt,
      remainingMs: current.changeAllowedAt - now
    };
  }
  const requiredReputation = Number(catalog?.rules?.joinRequiresReputation);
  const reputation = Number(options.reputation);
  if (Number.isFinite(requiredReputation) && Number.isFinite(reputation) && reputation < requiredReputation) {
    return { ok: false, error: 'Репутация с этой фракцией слишком низка для вступления.' };
  }
  return { ok: true, switching: !!current.factionId };
}

function joinTerritoryFaction(membership = {}, factionId = '', catalog = {}, now = Date.now(), options = {}) {
  const check = canJoinTerritoryFaction(membership, factionId, catalog, now, options);
  if (!check.ok) return { ok: false, error: check.error, membership: sanitizeTerritoryMembership(membership, catalog), retryAt: check.retryAt || 0 };
  const current = sanitizeTerritoryMembership(membership, catalog);
  const target = safeId(factionId);
  const cooldown = territoryChangeCooldownMs(catalog);
  const next = sanitizeTerritoryMembership({
    factionId: target,
    joinedAt: now,
    changeAllowedAt: now + cooldown,
    history: [...current.history, { factionId: target, action: current.factionId ? 'switch' : 'join', at: now }]
  }, catalog);
  return { ok: true, membership: next, switched: !!current.factionId, previousFactionId: current.factionId };
}

function leaveTerritoryFaction(membership = {}, catalog = {}, now = Date.now()) {
  const current = sanitizeTerritoryMembership(membership, catalog);
  if (!current.factionId) return { ok: false, error: 'Вы не состоите ни в одной фракции.', membership: current };
  if (current.changeAllowedAt > now) {
    return { ok: false, error: 'Выход из фракции пока закрыт.', membership: current, retryAt: current.changeAllowedAt };
  }
  const cooldown = territoryChangeCooldownMs(catalog);
  const next = sanitizeTerritoryMembership({
    factionId: '',
    joinedAt: 0,
    changeAllowedAt: now + cooldown,
    history: [...current.history, { factionId: current.factionId, action: 'leave', at: now }]
  }, catalog);
  return { ok: true, membership: next, previousFactionId: current.factionId };
}

/**
 * Правило доступа к локации территории. Локация без `territoryId` открыта.
 * `factionAccess: 'territory'` — любой член доступной фракции; конкретный id —
 * только члены этой фракции (базы).
 */
function territoryLocationAccess(loc = {}, membership = {}, catalog = {}) {
  const territoryId = safeId(loc?.territoryId);
  if (!territoryId) return { allowed: true, territoryId: '', requiredFactionId: '', access: 'open' };
  const current = sanitizeTerritoryMembership(membership, catalog);
  const required = safeId(loc?.factionAccess || 'territory');
  if (required === 'territory' || required === '') {
    return current.factionId
      ? { allowed: true, territoryId, requiredFactionId: '', access: 'faction', factionId: current.factionId }
      : { allowed: false, territoryId, requiredFactionId: '', access: 'faction', error: 'Вход в Сердцевину открыт только членам фракции. Вступите у регистратора на базе или в столице фракции.' };
  }
  if (current.factionId === required) {
    return { allowed: true, territoryId, requiredFactionId: required, access: 'ownFaction', factionId: current.factionId };
  }
  const row = territoryFactionRow(catalog, required);
  return {
    allowed: false,
    territoryId,
    requiredFactionId: required,
    access: 'ownFaction',
    error: `Вход только для членов фракции «${row?.baseDisplayName ? row.baseDisplayName.replace(/^Узел /, '') : required}».`
  };
}

function publicTerritoryMembership(membership = {}, catalog = {}, now = Date.now()) {
  const current = sanitizeTerritoryMembership(membership, catalog);
  const row = territoryFactionRow(catalog, current.factionId);
  return {
    version: TERRITORY_MEMBERSHIP_VERSION,
    territoryId: safeId(catalog?.id || 'core'),
    factionId: current.factionId,
    baseLocationId: row ? safeId(row.baseLocationId, 64) : '',
    joinedAt: current.joinedAt,
    changeAllowedAt: current.changeAllowedAt,
    changeLocked: current.changeAllowedAt > now,
    changeCooldownMs: territoryChangeCooldownMs(catalog),
    availableFactionIds: territoryFactionIds(catalog)
  };
}

module.exports = {
  TERRITORY_MEMBERSHIP_VERSION,
  DEFAULT_CHANGE_COOLDOWN_MS,
  canJoinTerritoryFaction,
  joinTerritoryFaction,
  leaveTerritoryFaction,
  publicTerritoryMembership,
  sanitizeTerritoryMembership,
  territoryChangeCooldownMs,
  territoryFactionIds,
  territoryFactionRow,
  territoryLocationAccess,
  territoryMembershipActive
};
