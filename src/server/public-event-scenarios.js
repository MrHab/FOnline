'use strict';

/**
 * Механики сценариев публичных событий: опорные объекты (защитный генератор,
 * радиостанция, гнёзда подкреплений), обозначенный удар главаря или матки и
 * опасные участки земли.
 *
 * Модуль чистый: время приходит аргументом, случайность инжектируется. Сервер
 * отвечает за акторов и урон, здесь живёт только состояние сценария.
 *
 * Правило спецификации: у базы налётчиков — главарь, защитный генератор,
 * обозначенные гранатные удары и подкрепления через радиостанцию; у логова —
 * матка, гнёзда подкреплений, обозначенный рывок и опасные участки земли.
 */

const SUPPORT_KINDS = new Set(['shield', 'reinforcement']);
const STRIKE_KINDS = new Set(['grenade', 'dash']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cleanId(value = '', max = 48) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
}

/** Авторское описание механик сценария: опоры, удар и опасная земля. */
function normalizeScenarioTemplate(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const supports = (Array.isArray(src.supports) ? src.supports : [])
    .map((row, index) => ({
      id: cleanId(row?.id) || `support_${index + 1}`,
      kind: SUPPORT_KINDS.has(String(row?.kind)) ? String(row.kind) : 'reinforcement',
      displayName: String(row?.displayName || 'Опора сценария').slice(0, 64),
      modelKey: cleanId(row?.modelKey, 48),
      hp: Math.max(1, Math.floor(Number(row?.hp || 220))),
      x: Number(row?.x || 0),
      z: Number(row?.z || 0),
      // Подкрепление выходит раз в intervalMs, пока опора цела, но не больше
      // maxAlive живых бойцов одновременно.
      intervalMs: Math.max(3000, Math.floor(Number(row?.intervalMs || 25000))),
      maxAlive: Math.max(1, Math.floor(Number(row?.maxAlive || 4))),
      squad: Math.max(1, Math.floor(Number(row?.squad || 1)))
    }));
  const strikeRaw = src.strike && typeof src.strike === 'object' ? src.strike : null;
  const strike = strikeRaw && STRIKE_KINDS.has(String(strikeRaw.kind)) ? {
    kind: String(strikeRaw.kind),
    displayName: String(strikeRaw.displayName || 'Удар').slice(0, 64),
    intervalMs: Math.max(4000, Math.floor(Number(strikeRaw.intervalMs || 18000))),
    telegraphMs: Math.max(500, Math.floor(Number(strikeRaw.telegraphMs || 2500))),
    radius: clamp(Number(strikeRaw.radius || 4), 1, 20),
    damage: Math.max(1, Math.floor(Number(strikeRaw.damage || 24)))
  } : null;
  const hazardsRaw = src.hazards && typeof src.hazards === 'object' ? src.hazards : null;
  const hazards = hazardsRaw ? {
    count: clamp(Math.floor(Number(hazardsRaw.count || 0)), 0, 6),
    radius: clamp(Number(hazardsRaw.radius || 4), 1, 16),
    distance: clamp(Number(hazardsRaw.distance || 9), 1, 40),
    damage: Math.max(1, Math.floor(Number(hazardsRaw.damage || 12))),
    displayName: String(hazardsRaw.displayName || 'Опасная земля').slice(0, 64)
  } : { count: 0, radius: 4, distance: 9, damage: 12, displayName: 'Опасная земля' };
  return { supports, strike, hazards };
}

/** Состояние сценария внутри события: живые опоры, таймеры удара и земли. */
function normalizeScenarioState(input = {}, template = null) {
  const src = input && typeof input === 'object' ? input : {};
  const alive = new Set((Array.isArray(src.destroyed) ? src.destroyed : []).map(row => cleanId(row)));
  return {
    destroyed: [...alive],
    spawned: src.spawned === true,
    reinforcementAt: Object.fromEntries((template?.supports || [])
      .map(row => [row.id, Math.max(0, Math.floor(Number(src.reinforcementAt?.[row.id] || 0)))])),
    strike: {
      nextAt: Math.max(0, Math.floor(Number(src.strike?.nextAt || 0))),
      telegraphedAt: Math.max(0, Math.floor(Number(src.strike?.telegraphedAt || 0))),
      x: Number(src.strike?.x || 0),
      z: Number(src.strike?.z || 0)
    },
    hazardOffset: Math.max(0, Math.floor(Number(src.hazardOffset || 0)))
  };
}

function supportAlive(state = {}, supportId = '') {
  return !(Array.isArray(state?.destroyed) ? state.destroyed : []).includes(cleanId(supportId));
}

/** Главарь под защитой, пока цела хотя бы одна опора вида `shield`. */
function scenarioBossShielded(state = {}, template = null) {
  return (template?.supports || []).some(row => row.kind === 'shield' && supportAlive(state, row.id));
}

function noteSupportDestroyed(state = {}, supportId = '') {
  const id = cleanId(supportId);
  if (!id || !supportAlive(state, id)) return false;
  state.destroyed = [...(Array.isArray(state.destroyed) ? state.destroyed : []), id];
  return true;
}

/** Опасные участки земли логова: смещаются после каждого удара. */
function scenarioHazards(state = {}, template = null, center = { x: 0, z: 0 }) {
  const hazards = template?.hazards;
  if (!hazards || hazards.count <= 0) return [];
  const offset = Math.max(0, Math.floor(Number(state?.hazardOffset || 0)));
  const rows = [];
  for (let i = 0; i < hazards.count; i += 1) {
    const angle = ((offset + i * 2) % 6) / 6 * Math.PI * 2;
    rows.push({
      id: `ground_${(offset + i * 2) % 6}`,
      x: Number((Number(center?.x || 0) + Math.cos(angle) * hazards.distance).toFixed(2)),
      z: Number((Number(center?.z || 0) + Math.sin(angle) * hazards.distance).toFixed(2)),
      radius: hazards.radius,
      damage: hazards.damage,
      displayName: hazards.displayName
    });
  }
  return rows;
}

/**
 * Шаг сценария. Возвращает события для сервера: обозначение удара, сам удар и
 * вызов подкрепления. Удар бьёт по точке, выбранной на момент обозначения, —
 * у игрока есть время уйти.
 */
function tickScenario(state = {}, template = null, options = {}, now = Date.now()) {
  const events = [];
  if (!state || !template) return events;
  const bossAlive = options.bossAlive !== false;
  const strike = template.strike;
  if (strike && bossAlive) {
    if (!state.strike.nextAt) state.strike.nextAt = Number(now) + strike.intervalMs;
    if (!state.strike.telegraphedAt && Number(now) >= Number(state.strike.nextAt) - strike.telegraphMs) {
      const target = typeof options.pickTarget === 'function' ? options.pickTarget() : null;
      if (target) {
        state.strike.telegraphedAt = Number(now);
        state.strike.x = Number(Number(target.x || 0).toFixed(2));
        state.strike.z = Number(Number(target.z || 0).toFixed(2));
        events.push({
          type: 'strikeTelegraph', kind: strike.kind, displayName: strike.displayName,
          x: state.strike.x, z: state.strike.z, radius: strike.radius, inMs: Math.max(0, Number(state.strike.nextAt) - Number(now))
        });
      } else {
        state.strike.nextAt = Number(now) + strike.intervalMs;
      }
    }
    if (state.strike.telegraphedAt && Number(now) >= Number(state.strike.nextAt)) {
      events.push({
        type: 'strike', kind: strike.kind, displayName: strike.displayName,
        x: state.strike.x, z: state.strike.z, radius: strike.radius, damage: strike.damage
      });
      state.strike.telegraphedAt = 0;
      state.strike.nextAt = Number(now) + strike.intervalMs;
      state.hazardOffset = (Math.max(0, Math.floor(Number(state.hazardOffset || 0))) + 1) % 6;
    }
  }
  for (const support of template.supports || []) {
    if (support.kind !== 'reinforcement' || !supportAlive(state, support.id)) continue;
    const due = Number(state.reinforcementAt?.[support.id] || 0);
    if (!due) {
      state.reinforcementAt[support.id] = Number(now) + support.intervalMs;
      continue;
    }
    if (Number(now) < due) continue;
    state.reinforcementAt[support.id] = Number(now) + support.intervalMs;
    if (Number(options.hostilesAlive || 0) >= support.maxAlive) continue;
    events.push({
      type: 'reinforcement', supportId: support.id, displayName: support.displayName,
      squad: support.squad, x: support.x, z: support.z
    });
  }
  return events;
}

/** Снимок сценария для клиента: что ещё цело и когда прилетит удар. */
/**
 * Сторона света для опоры: к цели ведёт не один коридор, и игрок должен
 * заранее знать, с какой стороны стоит генератор, а с какой — гнездо, чтобы
 * выбрать подход, а не идти в лоб.
 */
function supportSide(x = 0, z = 0) {
  const dx = Number(x || 0);
  const dz = Number(z || 0);
  if (Math.abs(dx) < 1 && Math.abs(dz) < 1) return 'в центре';
  const vertical = Math.abs(dz) >= Math.abs(dx) * 0.5 ? (dz >= 0 ? 'север' : 'юг') : '';
  const horizontal = Math.abs(dx) >= Math.abs(dz) * 0.5 ? (dx >= 0 ? 'восток' : 'запад') : '';
  if (vertical && horizontal) return `${vertical}о-${horizontal}`;
  return vertical || horizontal;
}

function publicScenario(state = {}, template = null, center = { x: 0, z: 0 }, now = Date.now()) {
  if (!template) return null;
  const supports = (template.supports || []).map(row => ({
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    side: supportSide(row.x, row.z),
    alive: supportAlive(state, row.id)
  }));
  const strike = template.strike ? {
    kind: template.strike.kind,
    displayName: template.strike.displayName,
    telegraph: Number(state?.strike?.telegraphedAt || 0) > 0,
    inSeconds: Math.max(0, Math.round((Number(state?.strike?.nextAt || 0) - Number(now)) / 1000)),
    x: Number(state?.strike?.x || 0),
    z: Number(state?.strike?.z || 0),
    radius: template.strike.radius
  } : null;
  return {
    supports,
    shielded: scenarioBossShielded(state, template),
    strike,
    hazards: scenarioHazards(state, template, center)
  };
}

module.exports = {
  noteSupportDestroyed,
  supportSide,
  normalizeScenarioState,
  normalizeScenarioTemplate,
  publicScenario,
  scenarioBossShielded,
  scenarioHazards,
  supportAlive,
  tickScenario
};
