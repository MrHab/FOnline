'use strict';

// Сбор ресурсов как в Albion Online: игрок кликает по узлу, и сбор идёт циклами.
// Каждый цикл длится по тиру узла, даёт единицу сырья и снимает один заряд узла.
// Узлы T1 берут голыми руками, выше нужен инструмент своей группы не ниже тира
// на один меньше узла (топор T1 рубит T2), а инструмент тира узла ещё и ускоряет
// цикл. Шаг в сторону или полученный урон прерывают сбор.
// Модуль чистый: сервер передаёт ему конфиг тиров, узел, игрока и время.

// Сервер принимает цикл чуть раньше клиентского таймера: сеть и кадр клиента
// не должны съедать цикл целиком.
const CYCLE_EARLY_MS = 150;

function clampTier(value) {
  return Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));
}

/** Длительность одного цикла сбора; toolTier — тир подходящего инструмента (0 — без него). */
function gatherCycleMs(config, nodeTier, toolTier = 0) {
  const gathering = config.gathering;
  const tier = clampTier(nodeTier);
  const base = Number(gathering.cycleMs[tier - 1]);
  const withTool = Number(toolTier) >= tier;
  return Math.round(withTool ? base * gathering.toolSpeed : base);
}

/** Сколько зарядов у свежего узла этого тира. */
function nodeCharges(config, nodeTier) {
  return Math.max(1, Math.round(Number(config.gathering.charges[clampTier(nodeTier) - 1])));
}

/** Инструмент помогает, только если он своего семейства и не ниже тира узла. */
function toolHelps(tool, nodeTier) {
  return !!tool && Number(tool.tier || 0) >= clampTier(nodeTier);
}

/**
 * Какой инструмент нужен узлу: 0 — никакой (узлы до toolFreeTier, T1), выше —
 * своей группы тира на один меньше узла. Так инструмент тира N делается из
 * сырья тира N, добытого инструментом тира N−1, и цепочка не замыкается.
 */
function requiredToolTier(config, nodeTier) {
  const tier = clampTier(nodeTier);
  return tier > config.gathering.toolFreeTier ? Math.max(1, tier - 1) : 0;
}

/** Хватает ли инструмента (или его отсутствия) для узла этого тира. */
function toolAllowsNode(config, tool, nodeTier) {
  const need = requiredToolTier(config, nodeTier);
  return need === 0 || Number(tool?.tier || 0) >= need;
}

/**
 * Начать сбор: запоминаем узел, точку, где стоит игрок, и время готовности
 * первого цикла. Всё остальное сервер проверяет до вызова.
 */
function beginGatherSession({ config, resource, player, roomId = '', tool = null, now }) {
  const tier = clampTier(resource.tier);
  const helps = toolHelps(tool, tier);
  const cycleMs = gatherCycleMs(config, tier, helps ? tool.tier : 0);
  return {
    resourceId: String(resource.id),
    roomId: String(roomId || ''),
    tier,
    toolId: helps ? String(tool.id || '') : '',
    cycleMs,
    anchorX: Number(player.x || 0),
    anchorZ: Number(player.z || 0),
    startedAt: now,
    readyAt: now + cycleMs,
    cycles: 0
  };
}

/**
 * Можно ли засчитать очередной цикл. Отказ с stop: true завершает сессию:
 * игрок ушёл, его ранили или он собирает другой узел.
 */
function checkGatherCycle(config, session, { resourceId, roomId = '', player, now, lastDamageAt = 0 }) {
  if (!session) return { ok: false, stop: true, error: 'Сначала начните сбор — кликните по ресурсу.' };
  if (String(resourceId) !== session.resourceId || String(roomId || '') !== session.roomId) return { ok: false, stop: true, error: 'Сбор идёт с другого ресурса.' };
  const moved = Math.hypot(Number(player.x || 0) - session.anchorX, Number(player.z || 0) - session.anchorZ);
  if (moved > config.gathering.moveToleranceM) return { ok: false, stop: true, reason: 'moved', error: 'Сбор прерван: вы отошли.' };
  if (Number(lastDamageAt || 0) > session.startedAt) return { ok: false, stop: true, reason: 'damaged', error: 'Сбор прерван: вас атаковали.' };
  if (now < session.readyAt - CYCLE_EARLY_MS) return { ok: false, stop: false, reason: 'early', error: 'Сбор ещё идёт.' };
  return { ok: true };
}

/** Засчитать цикл: следующий будет готов через ту же длительность. */
function advanceGatherSession(session, now) {
  session.cycles += 1;
  session.readyAt = now + session.cycleMs;
  return session;
}

/** Туша со шкурой: временный узел «hide» на месте убитого зверя. */
function carcassResource(config, { enemyId, tx, tz, tier, charges, now }) {
  const n = clampTier(tier);
  return {
    id: `hide_${String(enemyId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`,
    tx,
    tz,
    type: 'hide',
    tier: n,
    hp: charges,
    maxHp: charges,
    carcass: true,
    carcassEnemyId: String(enemyId),
    expiresAt: now + config.gathering.carcassMs
  };
}

module.exports = {
  CYCLE_EARLY_MS,
  gatherCycleMs,
  nodeCharges,
  toolHelps,
  requiredToolTier,
  toolAllowsNode,
  beginGatherSession,
  checkGatherCycle,
  advanceGatherSession,
  carcassResource
};
