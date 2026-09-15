'use strict';

/**
 * Механики боковых лабораторий Сердцевины.
 *
 * У каждой лаборатории своя угроза, но правило одно: шкала копится сама, на
 * пике объявляется удар и бьёт по секторам зала, а узлы на стенах сбрасывают
 * шкалу. Разница между лабораториями — в данных:
 *
 * - «Росток»: споры копятся, заражённые секции травят; вентиляция чистит зал.
 * - «Цепь»: перегрузка копится, разряды бьют; щиты перераспределяют питание и
 *   на время лишают охранную машину защиты.
 * - «Сплав»: нагрев копится, зал обжигает; охлаждение сбрасывает нагрев, а
 *   перегретые противники получают больше урона.
 * - «Спектр»: импульсы идут последовательностью по секторам, излучатели
 *   смещают её и дают проход.
 *
 * Модуль чистый: время приходит аргументом, никаких таймеров внутри.
 */

const HAZARD_KINDS = new Set(['spores', 'discharge', 'heat', 'pulse']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cleanId(value = '', max = 48) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
}

/** Авторское описание механики лаборатории. */
function normalizeLabMechanics(input = {}) {
  const src = input && typeof input === 'object' ? input : null;
  if (!src || !src.hazard) return null;
  const hazardRaw = src.hazard && typeof src.hazard === 'object' ? src.hazard : {};
  const kind = HAZARD_KINDS.has(String(hazardRaw.kind)) ? String(hazardRaw.kind) : 'discharge';
  return {
    meterLabel: String(src.meterLabel || 'Угроза').slice(0, 32),
    hazard: {
      kind,
      displayName: String(hazardRaw.displayName || 'Удар зала').slice(0, 64),
      buildMs: Math.max(5000, Math.floor(Number(hazardRaw.buildMs || 45000))),
      telegraphMs: Math.max(1000, Math.floor(Number(hazardRaw.telegraphMs || 4000))),
      damage: Math.max(1, Math.floor(Number(hazardRaw.damage || 14))),
      radius: clamp(Number(hazardRaw.radius || 6), 1, 40),
      distance: clamp(Number(hazardRaw.distance || 8), 0, 40),
      sectors: clamp(Math.floor(Number(hazardRaw.sectors || 4)), 1, 8),
      active: clamp(Math.floor(Number(hazardRaw.active || 2)), 1, 8)
    },
    nodes: (Array.isArray(src.nodes) ? src.nodes : []).map((row, index) => ({
      id: cleanId(row?.id) || `node_${index + 1}`,
      displayName: String(row?.displayName || 'Узел зала').slice(0, 64),
      action: String(row?.action || 'vent').replace(/[^a-zA-Z]/g, '').slice(0, 16) || 'vent',
      // Доля шкалы, которую сбрасывает узел, и его перезарядка.
      relief: clamp(Number(row?.relief ?? 1), 0.1, 1),
      cooldownMs: Math.max(1000, Math.floor(Number(row?.cooldownMs || 30000))),
      // Сколько секунд после срабатывания действует побочный эффект узла:
      // открытый проход у «Спектра», снятая защита машины у «Цепи».
      effectMs: Math.max(0, Math.floor(Number(row?.effectMs || 0)))
    })),
    guard: src.guard && typeof src.guard === 'object' ? {
      displayName: String(src.guard.displayName || 'Охранная машина').slice(0, 64),
      modelKey: cleanId(src.guard.modelKey, 48),
      hp: Math.max(1, Math.floor(Number(src.guard.hp || 420))),
      // Машина защищена, пока шкала выше порога и узлы не сняли питание.
      shieldAboveMeter: clamp(Number(src.guard.shieldAboveMeter ?? 0.5), 0, 1)
    } : null,
    // Перегретые противники получают больше урона при высокой шкале.
    overheat: src.overheat && typeof src.overheat === 'object' ? {
      aboveMeter: clamp(Number(src.overheat.aboveMeter ?? 0.6), 0, 1),
      damageBonus: clamp(Number(src.overheat.damageBonus ?? 0.35), 0, 2)
    } : null
  };
}

/** Состояние зала: шкала, объявленный удар и перезарядки узлов. */
function normalizeLabState(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const nodes = {};
  for (const [id, row] of Object.entries(src.nodes && typeof src.nodes === 'object' ? src.nodes : {})) {
    const key = cleanId(id);
    if (!key) continue;
    nodes[key] = {
      readyAt: Math.max(0, Math.floor(Number(row?.readyAt || 0))),
      effectUntil: Math.max(0, Math.floor(Number(row?.effectUntil || 0)))
    };
  }
  return {
    meter: clamp(Number(src.meter || 0), 0, 1),
    updatedAt: Math.max(0, Math.floor(Number(src.updatedAt || 0))),
    telegraphedAt: Math.max(0, Math.floor(Number(src.telegraphedAt || 0))),
    sectorOffset: Math.max(0, Math.floor(Number(src.sectorOffset || 0))),
    nodes
  };
}

/** Сектора, по которым ударит зал. Безопасные остаются для прохода. */
function labHazardSectors(state = {}, mechanics = null, center = { x: 0, z: 0 }) {
  if (!mechanics) return [];
  const hazard = mechanics.hazard;
  const offset = Math.max(0, Math.floor(Number(state?.sectorOffset || 0)));
  const rows = [];
  for (let i = 0; i < Math.min(hazard.active, hazard.sectors); i += 1) {
    const sector = (offset + i * 2) % hazard.sectors;
    const angle = (sector / hazard.sectors) * Math.PI * 2;
    rows.push({
      id: `${hazard.kind}_${sector}`,
      sector,
      x: Number((Number(center?.x || 0) + Math.cos(angle) * hazard.distance).toFixed(2)),
      z: Number((Number(center?.z || 0) + Math.sin(angle) * hazard.distance).toFixed(2)),
      radius: hazard.radius,
      damage: hazard.damage,
      displayName: hazard.displayName
    });
  }
  return rows;
}

/**
 * Шаг зала: шкала копится, на пике объявляется удар, после телеграфа бьёт по
 * секторам и смещает их. Возвращает события для сервера.
 */
function tickLab(state = {}, mechanics = null, now = Date.now()) {
  const events = [];
  if (!mechanics) return events;
  const hazard = mechanics.hazard;
  if (!state.updatedAt) {
    state.updatedAt = Number(now);
    return events;
  }
  const elapsed = Math.max(0, Number(now) - Number(state.updatedAt));
  state.updatedAt = Number(now);
  if (!state.telegraphedAt) {
    state.meter = clamp(Number(state.meter || 0) + elapsed / hazard.buildMs, 0, 1);
    if (state.meter >= 1) {
      state.telegraphedAt = Number(now);
      events.push({
        type: 'telegraph', kind: hazard.kind, displayName: hazard.displayName,
        inMs: hazard.telegraphMs, sectors: labHazardSectors(state, mechanics)
      });
    }
    return events;
  }
  if (Number(now) - Number(state.telegraphedAt) < hazard.telegraphMs) return events;
  events.push({ type: 'hazard', kind: hazard.kind, displayName: hazard.displayName });
  state.telegraphedAt = 0;
  state.meter = 0;
  state.sectorOffset = (Math.max(0, Math.floor(Number(state.sectorOffset || 0))) + 1) % hazard.sectors;
  return events;
}

/**
 * Использование узла зала: сбрасывает часть шкалы, уходит в перезарядку и на
 * время включает свой побочный эффект. Отказ объясняется строкой.
 */
function activateLabNode(state = {}, mechanics = null, nodeId = '', now = Date.now()) {
  const node = (mechanics?.nodes || []).find(row => row.id === cleanId(nodeId));
  if (!node) return { ok: false, error: 'Этот узел здесь не работает.' };
  const entry = state.nodes[node.id] || (state.nodes[node.id] = { readyAt: 0, effectUntil: 0 });
  if (Number(entry.readyAt || 0) > Number(now)) {
    return { ok: false, error: `Узел перезаряжается ещё ${Math.ceil((Number(entry.readyAt) - Number(now)) / 1000)} с.` };
  }
  const before = Number(state.meter || 0);
  state.meter = clamp(before - node.relief, 0, 1);
  entry.readyAt = Number(now) + node.cooldownMs;
  if (node.effectMs > 0) entry.effectUntil = Number(now) + node.effectMs;
  // Узел, сработавший в окне объявления, снимает удар: зал успели усмирить.
  // Ради этого механика и нужна — иначе объявление было бы неотвратимым.
  state.telegraphedAt = 0;
  if (node.action === 'shift') {
    state.sectorOffset = (Math.max(0, Math.floor(Number(state.sectorOffset || 0))) + 1) % mechanics.hazard.sectors;
  }
  return { ok: true, node, meter: state.meter, relieved: Number((before - state.meter).toFixed(3)) };
}

/** Охранная машина защищена, пока шкала высока и никто не снял питание. */
function labGuardShielded(state = {}, mechanics = null, now = Date.now()) {
  if (!mechanics?.guard) return false;
  const disabled = Object.values(state?.nodes || {}).some(row => Number(row?.effectUntil || 0) > Number(now));
  if (disabled) return false;
  return Number(state?.meter || 0) >= Number(mechanics.guard.shieldAboveMeter || 0.5);
}

/** Множитель урона по перегретым противникам зала. */
function labOverheatDamageMultiplier(state = {}, mechanics = null) {
  if (!mechanics?.overheat) return 1;
  return Number(state?.meter || 0) >= Number(mechanics.overheat.aboveMeter || 0.6)
    ? 1 + Number(mechanics.overheat.damageBonus || 0)
    : 1;
}

/** Снимок зала для клиента: шкала, объявленный удар и готовность узлов. */
function publicLabState(state = {}, mechanics = null, center = { x: 0, z: 0 }, now = Date.now()) {
  if (!mechanics) return null;
  return {
    meterLabel: mechanics.meterLabel,
    meter: Number(clamp(Number(state?.meter || 0), 0, 1).toFixed(3)),
    hazardName: mechanics.hazard.displayName,
    telegraph: Number(state?.telegraphedAt || 0) > 0,
    telegraphInSeconds: Number(state?.telegraphedAt || 0) > 0
      ? Math.max(0, Math.round((Number(state.telegraphedAt) + mechanics.hazard.telegraphMs - Number(now)) / 1000))
      : 0,
    sectors: labHazardSectors(state, mechanics, center),
    // Имя охранной машины заодно говорит клиенту, что она в этом зале есть:
    // окно эффекта узла снимает щит только с неё и больше ни на что не влияет.
    guardName: mechanics.guard ? mechanics.guard.displayName : '',
    guardShielded: labGuardShielded(state, mechanics, now),
    nodes: (mechanics.nodes || []).map(node => ({
      id: node.id,
      displayName: node.displayName,
      action: node.action,
      readyInSeconds: Math.max(0, Math.round((Number(state?.nodes?.[node.id]?.readyAt || 0) - Number(now)) / 1000)),
      effectSeconds: Math.max(0, Math.round((Number(state?.nodes?.[node.id]?.effectUntil || 0) - Number(now)) / 1000))
    }))
  };
}

module.exports = {
  activateLabNode,
  labGuardShielded,
  labHazardSectors,
  labOverheatDamageMultiplier,
  normalizeLabMechanics,
  normalizeLabState,
  publicLabState,
  tickLab
};
