'use strict';

// Рождение артефактов аномалиями. Состояние каждого авторского поля живёт в
// сохранениях сервера (savesDb.anomalyBirths) и переживает перезапуск:
// неподобранный артефакт остаётся в поле, а занятое поле не рожает второй.
// Время и генератор случайных чисел инжектируются — проверки идут без ожидания.

const { hash32 } = require('./shift-cycle');
const { pickBirthType } = require('./artifact-instances');

const DEFAULT_RULES = Object.freeze({
  checkIntervalMs: 60000,
  baseChance: 0.002,
  peakChance: 0.02,
  decayMs: 1800000,
  maxPerField: 1,
  refreshOnEmission: true
});

const STORE_VERSION = 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function cleanId(value = '', max = 96) {
  return String(value || '').replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, max);
}

function birthRules(catalog = {}) {
  const src = catalog?.births && typeof catalog.births === 'object' ? catalog.births : {};
  return {
    checkIntervalMs: Math.max(1000, Math.floor(Number(src.checkIntervalMs || DEFAULT_RULES.checkIntervalMs))),
    baseChance: clamp(Number(src.baseChance ?? DEFAULT_RULES.baseChance), 0, 1),
    peakChance: clamp(Number(src.peakChance ?? DEFAULT_RULES.peakChance), 0, 1),
    decayMs: Math.max(1000, Math.floor(Number(src.decayMs || DEFAULT_RULES.decayMs))),
    maxPerField: Math.max(1, Math.floor(Number(src.maxPerField || DEFAULT_RULES.maxPerField))),
    refreshOnEmission: src.refreshOnEmission !== false
  };
}

function sanitizeBirthRow(row = {}) {
  const id = cleanId(row?.id, 160);
  const fieldId = cleanId(row?.fieldId);
  const typeId = cleanId(row?.typeId, 48);
  const itemId = cleanId(row?.itemId, 64);
  if (!id || !fieldId || !typeId || !itemId) return null;
  return {
    id,
    fieldId,
    typeId,
    itemId,
    tier: clamp(Math.floor(Number(row?.tier || 1)), 1, 5),
    seed: String(row?.seed || id).slice(0, 160),
    sourceAnomalyType: cleanId(row?.sourceAnomalyType, 32),
    x: Number(Number(row?.x || 0).toFixed(3)),
    z: Number(Number(row?.z || 0).toFixed(3)),
    bornAt: Math.max(0, Math.floor(Number(row?.bornAt || 0))),
    emissionId: cleanId(row?.emissionId, 48)
  };
}

function sanitizeNpcClaim(row = {}) {
  const id = cleanId(row.id, 160);
  const locationId = cleanId(row.locationId);
  const groupId = cleanId(row.groupId);
  const memberId = cleanId(row.memberId, 24);
  const typeId = cleanId(row.typeId, 48);
  const itemId = cleanId(row.itemId, 64);
  if (!id || !locationId || !groupId || !memberId || !typeId || !itemId) return null;
  return {
    id, locationId, groupId, memberId, typeId, itemId,
    tier: clamp(Math.floor(Number(row.tier || 1)), 1, 5),
    claimedAt: Math.max(0, Math.floor(Number(row.claimedAt || 0))),
    consumedAt: Math.max(0, Math.floor(Number(row.consumedAt || 0)))
  };
}

function normalizeBirthStore(input = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const locations = {};
  for (const [rawId, rawLoc] of Object.entries(src.locations && typeof src.locations === 'object' ? src.locations : {})) {
    const locationId = cleanId(rawId);
    if (!locationId || !rawLoc || typeof rawLoc !== 'object') continue;
    const lastCheckAt = {};
    for (const [fieldId, at] of Object.entries(rawLoc.lastCheckAt && typeof rawLoc.lastCheckAt === 'object' ? rawLoc.lastCheckAt : {})) {
      const id = cleanId(fieldId);
      if (id) lastCheckAt[id] = Math.max(0, Math.floor(Number(at || 0)));
    }
    const artifacts = {};
    for (const [fieldId, row] of Object.entries(rawLoc.artifacts && typeof rawLoc.artifacts === 'object' ? rawLoc.artifacts : {})) {
      const id = cleanId(fieldId);
      const clean = sanitizeBirthRow({ ...row, fieldId: row?.fieldId || id });
      if (id && clean) artifacts[id] = clean;
    }
    locations[locationId] = {
      lastCheckAt,
      artifacts,
      lastEmissionId: cleanId(rawLoc.lastEmissionId, 48),
      births: Math.max(0, Math.floor(Number(rawLoc.births || 0)))
    };
  }
  const npcClaims = {};
  for (const [rawId, row] of Object.entries(src.npcClaims && typeof src.npcClaims === 'object' ? src.npcClaims : {})) {
    const claim = sanitizeNpcClaim({ ...row, id: row?.id || rawId });
    // Consumed IDs remain in the global claimedArtifactIds ledger; retaining
    // full claim rows here only grows saves.
    if (claim && !claim.consumedAt) npcClaims[claim.id] = claim;
  }
  return { version: STORE_VERSION, locations, npcClaims };
}

function ensureLocation(store = {}, locationId = '') {
  if (!store.locations || typeof store.locations !== 'object') store.locations = {};
  const id = cleanId(locationId);
  if (!store.locations[id]) store.locations[id] = { lastCheckAt: {}, artifacts: {}, lastEmissionId: '', births: 0 };
  return store.locations[id];
}

// Шанс рождения за одну проверку: пик сразу после активной фазы выброса,
// линейное затухание к базе за decayMs реального времени.
function birthChance(now = 0, emissionEndAt = 0, rules = DEFAULT_RULES) {
  const base = clamp(Number(rules.baseChance), 0, 1);
  const peak = Math.max(base, clamp(Number(rules.peakChance), 0, 1));
  const end = Number(emissionEndAt || 0);
  if (!end || Number(now) < end) return base;
  const elapsed = Number(now) - end;
  const decay = Math.max(1, Number(rules.decayMs || 1));
  if (elapsed >= decay) return base;
  return base + (peak - base) * (1 - elapsed / decay);
}

// Момент окончания последней активной фазы выброса по циклу сдвига.
function lastEmissionEndAt(cycle = {}, now = Date.now()) {
  if (!cycle || typeof cycle.state !== 'function') return 0;
  const state = cycle.state(now);
  const cycleMs = Number(cycle.cycleMs || 0);
  const activeMs = Number(cycle.activeMs || 0);
  const afterglowMs = Number(cycle.afterglowMs || 0);
  if (!cycleMs) return 0;
  const activeStartOffset = cycleMs - afterglowMs - activeMs;
  const cycleStart = Number(state.nextShiftAt || 0) - activeStartOffset;
  const activeEnd = cycleStart + cycleMs - afterglowMs;
  return Number(now) >= activeEnd ? activeEnd : activeEnd - cycleMs;
}

function currentEmissionId(cycle = {}, now = Date.now()) {
  if (!cycle || typeof cycle.state !== 'function') return '';
  const state = cycle.state(now);
  return ['active', 'afterglow'].includes(String(state.phase || '')) ? String(state.shiftId || '') : '';
}

function fieldPosition(field = {}, seed = '') {
  const angle = (hash32(`${seed}:angle`) % 628) / 100;
  const radius = Math.max(0.35, Math.min(Number(field.radius || 1.5) * 0.62, 2.2));
  return {
    x: Number((Number(field.x || 0) + Math.cos(angle) * radius).toFixed(3)),
    z: Number((Number(field.z || 0) + Math.sin(angle) * radius).toFixed(3))
  };
}

function usableFields(fields = [], catalog = {}) {
  const sources = catalog.anomalySources && typeof catalog.anomalySources === 'object' ? catalog.anomalySources : {};
  return (Array.isArray(fields) ? fields : []).filter(field => field && cleanId(field.id)
    && Number.isFinite(Number(field.x)) && Number.isFinite(Number(field.z))
    && Array.isArray(sources[String(field.type || '')]) && sources[String(field.type || '')].length);
}

function makeBirth(locationId, field, catalog, now, emissionId, seedSalt = '', instanceSalt = '') {
  const seed = `${locationId}:${cleanId(field.id)}:${now}:${seedSalt}`;
  const pick = pickBirthType(String(field.type || ''), field.tierRange, catalog, seed);
  if (!pick) return null;
  const id = `birth:${cleanId(locationId)}:${cleanId(field.id)}:${hash32(seed).toString(36)}`;
  const position = fieldPosition(field, id);
  // Зерно экземпляра не выводится из публичного id: свойства считаются хешем
  // от зерна, и совпадение позволило бы клиенту вычислить скрытый ролл до
  // стабилизации. Соль приходит от сервера и остаётся только в записи.
  const instanceSeed = instanceSalt ? `${seed}:${instanceSalt}` : id;
  return sanitizeBirthRow({
    id,
    fieldId: field.id,
    typeId: pick.type.id,
    itemId: pick.type.itemId,
    tier: pick.tier,
    seed: instanceSeed,
    sourceAnomalyType: String(field.type || ''),
    x: position.x,
    z: position.z,
    bornAt: now,
    emissionId
  });
}

// Одна проверка в минуту на свободное поле. Возвращает рождённые и
// обновлённые записи, чтобы сервер мог сохранить состояние и обновить комнаты.
function tickLocationBirths(store = {}, locationId = '', fields = [], catalog = {}, now = Date.now(), options = {}) {
  const rules = birthRules(catalog);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  // Соль экземпляра: сервер передаёт источник случайности, чтобы зерно нельзя
  // было восстановить по публичному id находки. Пустая соль оставляет прежнее
  // детерминированное поведение для проверок.
  const instanceSalt = typeof options.instanceSalt === 'function'
    ? options.instanceSalt
    : () => String(options.instanceSalt || '');
  const emissionEndAt = Number(options.emissionEndAt || 0);
  const emissionId = cleanId(options.emissionId || '', 48);
  const loc = ensureLocation(store, locationId);
  const births = [];
  const refreshed = [];
  const candidates = usableFields(fields, catalog);
  // Новый выброс обновляет неподобранные находки: вид и тир перерождаются.
  if (rules.refreshOnEmission && emissionId && loc.lastEmissionId !== emissionId) {
    loc.lastEmissionId = emissionId;
    for (const field of candidates) {
      const existing = loc.artifacts[cleanId(field.id)];
      if (!existing) continue;
      const next = makeBirth(locationId, field, catalog, now, emissionId, 'refresh', instanceSalt());
      if (!next) continue;
      loc.artifacts[cleanId(field.id)] = next;
      refreshed.push(next);
    }
  }
  let checked = 0;
  for (const field of candidates) {
    const fieldId = cleanId(field.id);
    if (loc.artifacts[fieldId]) continue;
    const last = Number(loc.lastCheckAt[fieldId] || 0);
    if (last && now - last < rules.checkIntervalMs) continue;
    loc.lastCheckAt[fieldId] = now;
    checked += 1;
    const chance = birthChance(now, emissionEndAt, rules);
    if (random() >= chance) continue;
    const birth = makeBirth(locationId, field, catalog, now, emissionId, 'birth', instanceSalt());
    if (!birth) continue;
    loc.artifacts[fieldId] = birth;
    loc.births += 1;
    births.push(birth);
  }
  return { births, refreshed, checked, chance: birthChance(now, emissionEndAt, rules) };
}

function liveBirths(store = {}, locationId = '') {
  const loc = store?.locations?.[cleanId(locationId)];
  return loc ? Object.values(loc.artifacts || {}) : [];
}

function findBirth(store = {}, locationId = '', artifactId = '') {
  return liveBirths(store, locationId).find(row => row.id === String(artifactId || '')) || null;
}

// Подбор освобождает поле: следующая проверка может родить новый артефакт.
function claimBirth(store = {}, locationId = '', artifactId = '') {
  const loc = store?.locations?.[cleanId(locationId)];
  if (!loc) return null;
  for (const [fieldId, row] of Object.entries(loc.artifacts || {})) {
    if (row.id !== String(artifactId || '')) continue;
    delete loc.artifacts[fieldId];
    return row;
  }
  return null;
}

// The birth and the NPC owner move in one savesDb snapshot. The caller must
// commit that snapshot before making the claimed artifact usable in combat.
function claimBirthForNpc(store = {}, locationId = '', artifactId = '', owner = {}, now = Date.now()) {
  const groupId = cleanId(owner.groupId);
  const memberId = cleanId(owner.memberId, 24);
  const id = cleanId(artifactId, 160);
  const locId = cleanId(locationId);
  if (!groupId || !memberId || !id || !locId) return null;
  if (!store.npcClaims || typeof store.npcClaims !== 'object') store.npcClaims = {};
  if (store.npcClaims[id] || Object.values(store.npcClaims).some(row =>
    !row.consumedAt && row.groupId === groupId && row.memberId === memberId)) return null;
  const birth = claimBirth(store, locId, id);
  if (!birth) return null;
  const claim = sanitizeNpcClaim({ ...birth, locationId: locId, groupId, memberId, claimedAt: now });
  if (!claim) {
    ensureLocation(store, locId).artifacts[birth.fieldId] = birth;
    return null;
  }
  store.npcClaims[id] = claim;
  return claim;
}

function npcClaimForMember(store = {}, groupId = '', memberId = '') {
  const group = cleanId(groupId);
  const member = cleanId(memberId, 24);
  if (!group || !member) return null;
  return Object.values(store.npcClaims || {}).find(row =>
    !row.consumedAt && row.groupId === group && row.memberId === member) || null;
}

function consumeNpcClaim(store = {}, groupId = '', memberId = '', now = Date.now()) {
  const claim = npcClaimForMember(store, groupId, memberId);
  if (!claim) return null;
  claim.consumedAt = Math.max(1, Math.floor(Number(now) || Date.now()));
  delete store.npcClaims[claim.id];
  return claim;
}

function publicBirthSummary(store = {}, locationId = '') {
  const loc = store?.locations?.[cleanId(locationId)];
  return {
    locationId: cleanId(locationId),
    liveCount: loc ? Object.keys(loc.artifacts || {}).length : 0,
    births: loc ? Number(loc.births || 0) : 0
  };
}

module.exports = {
  DEFAULT_RULES,
  STORE_VERSION,
  birthChance,
  birthRules,
  claimBirth,
  claimBirthForNpc,
  consumeNpcClaim,
  currentEmissionId,
  findBirth,
  lastEmissionEndAt,
  liveBirths,
  normalizeBirthStore,
  npcClaimForMember,
  publicBirthSummary,
  tickLocationBirths,
  usableFields
};
