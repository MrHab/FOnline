'use strict';

// Мировой босс «Объекта Ноль». Чистая машина состояний: щит из узлов,
// фаза уязвимости после их уничтожения, телеграфируемые импульсы, поражение,
// перерождение по реальному времени. Время инжектируется — проверки без
// ожидания; сервер лишь применяет события к акторам комнаты.

const DEFAULT_RULES = Object.freeze({
  shieldNodeHp: 320,
  vulnerableMs: 45000,
  pulseIntervalMs: 20000,
  pulseTelegraphMs: 3000,
  pulseRadius: 9,
  pulseDamage: 28,
  respawnMs: 5400000,
  nodeRestoreMs: 0
});

const PHASE_LABELS = Object.freeze({
  shielded: 'Щит активен: уничтожьте узлы',
  vulnerable: 'Уязвим! Бейте Хранителя',
  defeated: 'Повержен',
  restoring: 'Возвращается'
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function cleanId(value = '', max = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
}

function normalizeWorldBossRules(input = {}, override = {}) {
  const src = { ...(input && typeof input === 'object' ? input : {}), ...(override && typeof override === 'object' ? override : {}) };
  return {
    shieldNodeHp: Math.max(1, Math.floor(Number(src.shieldNodeHp || DEFAULT_RULES.shieldNodeHp))),
    vulnerableMs: Math.max(1000, Math.floor(Number(src.vulnerableMs || DEFAULT_RULES.vulnerableMs))),
    pulseIntervalMs: Math.max(2000, Math.floor(Number(src.pulseIntervalMs || DEFAULT_RULES.pulseIntervalMs))),
    pulseTelegraphMs: Math.max(500, Math.floor(Number(src.pulseTelegraphMs || DEFAULT_RULES.pulseTelegraphMs))),
    pulseRadius: clamp(Number(src.pulseRadius || DEFAULT_RULES.pulseRadius), 1, 60),
    pulseDamage: Math.max(1, Math.floor(Number(src.pulseDamage || DEFAULT_RULES.pulseDamage))),
    respawnMs: Math.max(60000, Math.floor(Number(src.respawnMs || DEFAULT_RULES.respawnMs))),
    nodeRestoreMs: Math.max(0, Math.floor(Number(src.nodeRestoreMs ?? DEFAULT_RULES.nodeRestoreMs)))
  };
}

function createBossState(def = {}, nodes = [], rules = DEFAULT_RULES, now = Date.now()) {
  return {
    bossId: cleanId(def.id || 'worldBoss'),
    displayName: String(def.displayName || 'Мировой босс').slice(0, 96),
    phase: 'shielded',
    nodes: (Array.isArray(nodes) ? nodes : []).map((node, index) => ({
      id: cleanId(node?.id || `node_${index + 1}`),
      x: Number(node?.x || 0),
      z: Number(node?.z || 0),
      alive: true,
      actorId: ''
    })),
    vulnerableUntil: 0,
    cycles: 0,
    pulse: { nextAt: Number(now) + rules.pulseIntervalMs, telegraphedAt: 0, count: 0 },
    defeatedAt: 0,
    respawnAt: 0,
    restoredAt: Number(now),
    kills: 0
  };
}

function persistedBossState(state = {}) {
  return {
    bossId: String(state?.bossId || ''),
    defeatedAt: Math.max(0, Math.floor(Number(state?.defeatedAt || 0))),
    respawnAt: Math.max(0, Math.floor(Number(state?.respawnAt || 0))),
    kills: Math.max(0, Math.floor(Number(state?.kills || 0)))
  };
}

// Перезапуск: побеждённый босс остаётся побеждённым до своего respawnAt.
function applyPersistedBossState(state = {}, persisted = null, now = Date.now()) {
  if (!state || !persisted) return state;
  state.kills = Math.max(0, Math.floor(Number(persisted.kills || 0)));
  const respawnAt = Math.max(0, Math.floor(Number(persisted.respawnAt || 0)));
  if (respawnAt > Number(now)) {
    state.phase = 'defeated';
    state.defeatedAt = Math.max(0, Math.floor(Number(persisted.defeatedAt || 0)));
    state.respawnAt = respawnAt;
    for (const node of state.nodes) node.alive = false;
  }
  return state;
}

function aliveNodes(state = {}) {
  return (state?.nodes || []).filter(node => node.alive);
}

function bossDamageMultiplier(state = null) {
  if (!state) return 1;
  return state.phase === 'vulnerable' ? 1 : 0;
}

// Уничтожен узел щита: когда все узлы мертвы — фаза уязвимости.
function noteShieldNodeDestroyed(state = {}, nodeId = '', rules = DEFAULT_RULES, now = Date.now()) {
  const node = (state?.nodes || []).find(row => row.id === cleanId(nodeId));
  if (!node || !node.alive || state.phase === 'defeated') return { changed: false, vulnerable: false };
  node.alive = false;
  if (aliveNodes(state).length > 0) return { changed: true, vulnerable: false };
  state.phase = 'vulnerable';
  state.vulnerableUntil = Number(now) + rules.vulnerableMs;
  state.cycles += 1;
  return { changed: true, vulnerable: true };
}

function noteBossDefeated(state = {}, rules = DEFAULT_RULES, now = Date.now()) {
  if (!state || state.phase === 'defeated') return false;
  state.phase = 'defeated';
  state.defeatedAt = Number(now);
  state.respawnAt = Number(now) + rules.respawnMs;
  state.kills += 1;
  state.vulnerableUntil = 0;
  for (const node of state.nodes) node.alive = false;
  return true;
}

function bossRespawnDue(state = {}, now = Date.now()) {
  return !!state && state.phase === 'defeated' && Number(now) >= Number(state.respawnAt || 0);
}

function restoreBoss(state = {}, rules = DEFAULT_RULES, now = Date.now()) {
  state.phase = 'shielded';
  state.vulnerableUntil = 0;
  state.defeatedAt = 0;
  state.respawnAt = 0;
  state.restoredAt = Number(now);
  state.pulse = { nextAt: Number(now) + rules.pulseIntervalMs, telegraphedAt: 0, count: 0 };
  for (const node of state.nodes) { node.alive = true; node.actorId = ''; }
  return state;
}

// Тик: конец уязвимости (щит и узлы восстанавливаются), телеграф импульса за
// pulseTelegraphMs и сам импульс. Возвращает список событий для сервера.
function tickWorldBoss(state = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const events = [];
  if (!state) return events;
  if (state.phase === 'defeated') {
    if (bossRespawnDue(state, now)) {
      restoreBoss(state, rules, now);
      events.push({ type: 'respawn' });
    }
    return events;
  }
  if (state.phase === 'vulnerable' && Number(now) >= Number(state.vulnerableUntil || 0)) {
    state.phase = 'shielded';
    state.vulnerableUntil = 0;
    for (const node of state.nodes) { node.alive = true; node.actorId = ''; }
    events.push({ type: 'shieldRestored' });
  }
  const pulse = state.pulse;
  if (!pulse.telegraphedAt && Number(now) >= Number(pulse.nextAt) - rules.pulseTelegraphMs) {
    pulse.telegraphedAt = Number(now);
    events.push({ type: 'pulseTelegraph', inMs: Math.max(0, Number(pulse.nextAt) - Number(now)) });
  }
  if (Number(now) >= Number(pulse.nextAt)) {
    pulse.count += 1;
    pulse.nextAt = Number(now) + rules.pulseIntervalMs;
    pulse.telegraphedAt = 0;
    events.push({ type: 'pulse', radius: rules.pulseRadius, damage: rules.pulseDamage });
  }
  return events;
}

function publicWorldBoss(state = null, rules = DEFAULT_RULES, now = Date.now(), extra = {}) {
  if (!state) return null;
  const telegraph = state.phase !== 'defeated' && Number(state.pulse?.telegraphedAt || 0) > 0;
  return {
    bossId: state.bossId,
    displayName: state.displayName,
    phase: state.phase,
    phaseLabel: PHASE_LABELS[state.phase] || state.phase,
    nodesAlive: aliveNodes(state).length,
    nodesTotal: (state.nodes || []).length,
    vulnerableSeconds: state.phase === 'vulnerable' ? Math.max(0, Math.round((Number(state.vulnerableUntil) - Number(now)) / 1000)) : 0,
    pulseInSeconds: state.phase === 'defeated' ? 0 : Math.max(0, Math.round((Number(state.pulse?.nextAt || 0) - Number(now)) / 1000)),
    pulseTelegraph: telegraph,
    pulseRadius: rules.pulseRadius,
    defeated: state.phase === 'defeated',
    respawnInSeconds: state.phase === 'defeated' ? Math.max(0, Math.round((Number(state.respawnAt) - Number(now)) / 1000)) : 0,
    cycles: Number(state.cycles || 0),
    kills: Number(state.kills || 0),
    bossHp: Math.max(0, Math.round(Number(extra.bossHp || 0))),
    bossMaxHp: Math.max(0, Math.round(Number(extra.bossMaxHp || 0))),
    rewardOpen: state.phase === 'defeated'
  };
}

module.exports = {
  DEFAULT_RULES,
  PHASE_LABELS,
  aliveNodes,
  applyPersistedBossState,
  bossDamageMultiplier,
  bossRespawnDue,
  createBossState,
  normalizeWorldBossRules,
  noteBossDefeated,
  noteShieldNodeDestroyed,
  persistedBossState,
  publicWorldBoss,
  restoreBoss,
  tickWorldBoss
};
