'use strict';

const { localizeLegacyWorldText } = require('./wasteland-localization');
const { clamp, clone, safeId } = require('./wasteland-sim-utils');

const WORLD_OPERATION_SCHEMA = 'realm.worldOperation.v1';
const WORLD_OPERATION_PHASES = new Set([
  'preparing',
  'loading',
  'traveling',
  'patrolling',
  'holding',
  'engaged',
  'unloading',
  'returning',
  'completed',
  'failed',
  'cancelled'
]);
const WORLD_OPERATION_TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled']);

function finiteHour(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : Number(fallback || 0);
}

function shortText(value = '', maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeOperationCargo(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .map(([key, value]) => [safeId(key, ''), Math.max(0, Math.floor(Number(value || 0)))])
    .filter(([key, value]) => key && value > 0)
    .slice(0, 32));
}

function operationStatusForPhase(phase = '') {
  if (phase === 'completed') return 'completed';
  if (phase === 'failed') return 'failed';
  if (phase === 'cancelled') return 'cancelled';
  return 'active';
}

function normalizeWorldOperation(input = {}, worldHour = 0) {
  if (!input || typeof input !== 'object') return null;
  if (!input.id && !input.kind && !input.schema && !input.assignment?.assigneeId) return null;
  const createdHour = finiteHour(input.createdHour, worldHour);
  const phase = WORLD_OPERATION_PHASES.has(String(input.phase || ''))
    ? String(input.phase)
    : 'preparing';
  const goal = input.goal && typeof input.goal === 'object' ? input.goal : {};
  const assignment = input.assignment && typeof input.assignment === 'object' ? input.assignment : {};
  const rawOutcome = input.outcome && typeof input.outcome === 'object' ? input.outcome : null;
  const id = safeId(input.id || `operation_${input.kind || 'world'}_${Math.floor(createdHour * 10)}`,
    `operation_${Math.floor(createdHour * 10)}`);
  const outcome = rawOutcome ? {
    result: safeId(rawOutcome.result || operationStatusForPhase(phase), ''),
    reason: safeId(rawOutcome.reason || '', ''),
    siteId: safeId(rawOutcome.siteId || input.destinationSiteId || '', ''),
    cargo: normalizeOperationCargo(rawOutcome.cargo || {}),
    deliveredUnits: Math.max(0, Math.floor(Number(rawOutcome.deliveredUnits || 0))),
    npcLosses: Math.max(0, Math.floor(Number(rawOutcome.npcLosses || 0)))
  } : null;
  return {
    schema: WORLD_OPERATION_SCHEMA,
    id,
    kind: safeId(input.kind || 'world_operation', 'world_operation'),
    status: operationStatusForPhase(phase),
    phase,
    visibility: ['background', 'collaborative', 'authored'].includes(String(input.visibility || ''))
      ? String(input.visibility)
      : 'collaborative',
    issuerFactionId: safeId(input.issuerFactionId || '', ''),
    requestTaskId: safeId(input.requestTaskId || '', ''),
    escortTaskId: safeId(input.escortTaskId || assignment.taskId || '', ''),
    sourceSiteId: safeId(input.sourceSiteId || '', ''),
    destinationSiteId: safeId(input.destinationSiteId || goal.targetSiteId || '', ''),
    goal: {
      kind: safeId(goal.kind || input.kind || 'world_operation', 'world_operation'),
      reason: safeId(goal.reason || 'world_need', 'world_need'),
      summary: shortText(goal.summary || '', 220),
      targetSiteId: safeId(goal.targetSiteId || input.destinationSiteId || '', '')
    },
    assignment: {
      kind: ['party', 'agent', 'player'].includes(String(assignment.kind || ''))
        ? String(assignment.kind)
        : 'party',
      assigneeId: safeId(assignment.assigneeId || assignment.id || '', ''),
      taskId: safeId(assignment.taskId || '', ''),
      leaderId: safeId(assignment.leaderId || '', ''),
      leaderName: shortText(assignment.leaderName || '', 64),
      leaderRole: shortText(assignment.leaderRole || '', 64),
      acceptedHour: finiteHour(assignment.acceptedHour, createdHour),
      leaseUntilHour: finiteHour(assignment.leaseUntilHour, 0)
    },
    demand: normalizeOperationCargo(input.demand || {}),
    cargo: normalizeOperationCargo(input.cargo || {}),
    createdHour,
    updatedHour: finiteHour(input.updatedHour, createdHour),
    departureHour: finiteHour(input.departureHour, 0),
    completedHour: finiteHour(input.completedHour, 0),
    revision: Math.max(1, Math.floor(Number(input.revision || 1))),
    outcome
  };
}

function createSupplyOperation(input = {}, worldHour = 0) {
  const createdHour = finiteHour(input.createdHour, worldHour);
  const partyId = safeId(input.partyId || input.assignment?.assigneeId || 'caravan', 'caravan');
  return normalizeWorldOperation({
    ...input,
    id: input.id || `supply_${partyId}_${Math.floor(createdHour * 10)}`,
    kind: 'supply_delivery',
    status: 'active',
    phase: input.phase || 'preparing',
    visibility: input.visibility || 'collaborative',
    createdHour,
    updatedHour: createdHour,
    assignment: {
      kind: 'party',
      assigneeId: partyId,
      acceptedHour: createdHour,
      ...(input.assignment && typeof input.assignment === 'object' ? input.assignment : {})
    },
    goal: {
      kind: 'supply_delivery',
      reason: 'site_shortage',
      ...(input.goal && typeof input.goal === 'object' ? input.goal : {})
    }
  }, worldHour);
}

function createPatrolOperation(input = {}, worldHour = 0) {
  const createdHour = finiteHour(input.createdHour, worldHour);
  const partyId = safeId(input.partyId || input.assignment?.assigneeId || 'patrol', 'patrol');
  return normalizeWorldOperation({
    ...input,
    id: input.id || `patrol_${partyId}_${Math.floor(createdHour * 10)}`,
    kind: 'patrol_mission',
    status: 'active',
    phase: input.phase || 'patrolling',
    visibility: input.visibility || 'collaborative',
    createdHour,
    updatedHour: createdHour,
    assignment: {
      kind: 'party',
      assigneeId: partyId,
      leaderId: `${partyId}_leader`,
      leaderName: 'Командир патруля',
      leaderRole: 'Глава отряда',
      acceptedHour: createdHour,
      ...(input.assignment && typeof input.assignment === 'object' ? input.assignment : {})
    },
    goal: {
      kind: 'patrol_mission',
      reason: 'area_patrol',
      ...(input.goal && typeof input.goal === 'object' ? input.goal : {})
    }
  }, worldHour);
}

function transitionWorldOperation(input = {}, phase = '', worldHour = 0, patch = {}) {
  const current = normalizeWorldOperation(input, worldHour);
  if (!current) return null;
  const delta = patch && typeof patch === 'object' ? patch : {};
  const nextPhase = WORLD_OPERATION_PHASES.has(String(phase || '')) ? String(phase) : current.phase;
  if (WORLD_OPERATION_TERMINAL_PHASES.has(current.phase) && nextPhase !== current.phase) return current;
  const now = finiteHour(worldHour, current.updatedHour);
  const merged = {
    ...current,
    ...delta,
    phase: nextPhase,
    status: operationStatusForPhase(nextPhase),
    goal: {
      ...current.goal,
      ...(delta.goal && typeof delta.goal === 'object' ? delta.goal : {})
    },
    assignment: {
      ...current.assignment,
      ...(delta.assignment && typeof delta.assignment === 'object' ? delta.assignment : {})
    },
    outcome: Object.prototype.hasOwnProperty.call(delta, 'outcome')
      ? delta.outcome
      : current.outcome,
    departureHour: nextPhase === 'traveling' && Number(current.departureHour || 0) <= 0
      ? now
      : finiteHour(delta.departureHour, current.departureHour),
    completedHour: ['completed', 'failed', 'cancelled'].includes(nextPhase)
      ? (Number(current.completedHour || 0) > 0 ? current.completedHour : now)
      : finiteHour(delta.completedHour, current.completedHour),
    updatedHour: current.updatedHour,
    revision: current.revision
  };
  const candidate = normalizeWorldOperation(merged, worldHour);
  if (JSON.stringify(candidate) === JSON.stringify(current)) return current;
  candidate.updatedHour = now;
  candidate.revision = current.revision + 1;
  return candidate;
}

function worldOperationStage(input = {}) {
  const phase = String(input?.phase || 'preparing');
  if (String(input?.kind || '') === 'patrol_mission') {
    const patrolRows = {
      preparing: { key: 'preparation', label: 'Сбор патруля' },
      loading: { key: 'preparation', label: 'Подготовка патруля' },
      traveling: { key: 'active', label: 'Патруль в пути' },
      patrolling: { key: 'active', label: 'Патрулирование маршрута' },
      holding: { key: 'active', label: 'Удержание позиции' },
      engaged: { key: 'active', label: 'Патруль вступил в бой' },
      unloading: { key: 'active', label: 'Разбор операции' },
      returning: { key: 'active', label: 'Возвращение патруля' },
      completed: { key: 'completed', label: 'Патрулирование завершено' },
      failed: { key: 'failed', label: 'Патруль потерян' },
      cancelled: { key: 'expired', label: 'Выход отменён' }
    };
    return patrolRows[phase] || patrolRows.patrolling;
  }
  const rows = {
    preparing: { key: 'preparation', label: 'Сбор каравана' },
    loading: { key: 'preparation', label: 'Погрузка' },
    traveling: { key: 'active', label: 'Караван в пути' },
    patrolling: { key: 'active', label: 'Патрулирование' },
    holding: { key: 'active', label: 'Удержание позиции' },
    engaged: { key: 'active', label: 'Караван атакован' },
    unloading: { key: 'active', label: 'Разгрузка' },
    returning: { key: 'active', label: 'Возвращение' },
    completed: { key: 'completed', label: 'Доставка завершена' },
    failed: { key: 'failed', label: 'Караван потерян' },
    cancelled: { key: 'expired', label: 'Операция отменена' }
  };
  return rows[phase] || rows.preparing;
}

function normalizeWorldTask(input = {}, worldHour = 0) {
  if (!input || typeof input !== 'object') return null;
  const type = safeId(input.type || 'world_task', 'world_task');
  const id = safeId(input.id || `${type}_${Date.now()}`, `${type}_${Date.now()}`);
  const status = ['active', 'completed', 'resolved', 'expired', 'failed'].includes(String(input.status || 'active'))
    ? String(input.status || 'active')
    : 'active';
  const createdHour = Number.isFinite(Number(input.createdHour)) ? Number(input.createdHour) : Number(worldHour || 0);
  const expiresHour = Number.isFinite(Number(input.expiresHour)) ? Number(input.expiresHour) : createdHour + 36;
  const reward = input.reward && typeof input.reward === 'object' ? input.reward : {};
  const details = input.details && typeof input.details === 'object' ? clone(input.details) : {};
  if (details.operation) {
    const operation = normalizeWorldOperation(details.operation, worldHour);
    if (operation) details.operation = operation;
    else delete details.operation;
  }
  return {
    id,
    key: String(input.key || id).slice(0, 140),
    type,
    status,
    title: localizeLegacyWorldText(input.title || input.name || type).slice(0, 120),
    text: localizeLegacyWorldText(input.text || '').slice(0, 320),
    siteId: safeId(input.siteId || '', ''),
    issuerSiteId: safeId(input.issuerSiteId || input.boardSiteId || '', ''),
    partyId: safeId(input.partyId || '', ''),
    targetFaction: safeId(input.targetFaction || '', ''),
    objective: String(input.objective || '').slice(0, 80),
    createdHour,
    expiresHour,
    completedHour: Number.isFinite(Number(input.completedHour)) ? Number(input.completedHour) : 0,
    priority: clamp(input.priority ?? 1, 0, 5),
    reward: {
      xp: Math.max(0, Math.floor(Number(reward.xp || 0))),
      caps: Math.max(0, Math.floor(Number(reward.caps ?? reward.silver ?? 0))),
      reputation: Math.max(0, Math.floor(Number(reward.reputation || 0)))
    },
    details
  };
}

module.exports = {
  WORLD_OPERATION_SCHEMA,
  createPatrolOperation,
  createSupplyOperation,
  normalizeWorldOperation,
  transitionWorldOperation,
  worldOperationStage,
  normalizeWorldTask
};
