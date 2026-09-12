'use strict';

function indexes(catalog = {}) {
  return Object.fromEntries((catalog.residents || []).map(row => [String(row.id), row]));
}

function sanitizeResidentState(base = {}, catalog = {}) {
  const byId = indexes(catalog);
  const raw = base.residentStates && typeof base.residentStates === 'object' ? base.residentStates : {};
  base.residentStates = Object.fromEntries(Object.entries(raw).map(([id, state]) => {
    if (!byId[id]) return null;
    return [id, {
      recruited: state?.recruited === true,
      assigned: state?.assigned === true,
      loyalty: Math.max(0, Math.min(100, Math.floor(Number(state?.loyalty ?? 50)))),
      personalQuestCompleted: state?.personalQuestCompleted === true,
      personalQuestStarted: state?.personalQuestStarted === true || state?.personalQuestCompleted === true,
      personalQuestCompletedAt: Math.max(0, Number(state?.personalQuestCompletedAt || 0)),
      recruitedAt: Math.max(0, Number(state?.recruitedAt || 0))
    }];
  }).filter(Boolean));
  base.residents = Object.entries(base.residentStates).filter(([, state]) => state.recruited && state.assigned).map(([id]) => id).slice(0, 8);
  return base;
}

function residentLimit(base = {}, baseCatalog = {}) {
  return Number((baseCatalog.tiers || []).find(row => Number(row.level) === Number(base.tier))?.residentLimit || 0);
}

function canAssign(base = {}, residentId = '', catalog = {}, baseCatalog = {}) {
  sanitizeResidentState(base, catalog);
  const byId = indexes(catalog);
  const resident = byId[residentId];
  const state = base.residentStates?.[residentId];
  if (!resident || !state?.recruited) return { ok: false, error: 'Этот специалист ещё не живёт на базе.' };
  const builtTypes = new Set((base.objects || []).map(row => String(row?.typeId || '')));
  const missingObject = (resident.requiredObjectTypeIds || []).find(typeId => !builtTypes.has(String(typeId || '')));
  if (missingObject) return { ok: false, error: `${resident.displayName}: сначала постройте объект «${missingObject}».` };
  if (state.assigned) return { ok: true };
  if (base.residents.length >= residentLimit(base, baseCatalog)) return { ok: false, error: 'На базе нет свободного места для жителя.' };
  for (const activeId of base.residents) {
    const active = byId[activeId];
    if ((resident.conflicts || []).includes(activeId) || (active?.conflicts || []).includes(residentId)) {
      return { ok: false, error: `${resident.displayName} не согласен работать вместе с ${active.displayName}.` };
    }
  }
  return { ok: true };
}

function applyResidentAction(base = {}, action = '', residentId = '', catalog = {}, baseCatalog = {}, now = Date.now(), context = {}) {
  const byId = indexes(catalog);
  const resident = byId[residentId];
  if (!resident) return { ok: false, error: 'Неизвестный кандидат.' };
  sanitizeResidentState(base, catalog);
  let state = base.residentStates[residentId];
  if (action === 'recruit') {
    if (state?.recruited) return { ok: false, error: 'Специалист уже принят.' };
    base.residentStates[residentId] = state = { recruited: true, assigned: false, loyalty: 50, personalQuestStarted: false, personalQuestCompleted: false, personalQuestCompletedAt: 0, recruitedAt: Number(now) };
    const check = canAssign(base, residentId, catalog, baseCatalog);
    if (!check.ok) return { ok: true, recruited: true, assigned: false, warning: check.error };
    base.residentStates[residentId].assigned = true;
  } else if (action === 'assign') {
    const check = canAssign(base, residentId, catalog, baseCatalog);
    if (!check.ok) return check;
    base.residentStates[residentId].assigned = true;
  } else if (action === 'unassign') {
    if (!state?.recruited) return { ok: false, error: 'Специалист не принят.' };
    state.assigned = false;
  } else if (action === 'startQuest') {
    if (!state?.recruited || state.personalQuestStarted) return { ok: false, error: 'Личное дело уже начато или недоступно.' };
    state.personalQuestStarted = true;
  } else if (action === 'completeQuest') {
    if (!state?.recruited || !state.personalQuestStarted || state.personalQuestCompleted) {
      return { ok: false, error: 'Сначала откройте незавершённое личное дело.' };
    }
    const requirement = resident.questRequirement && typeof resident.questRequirement === 'object'
      ? resident.questRequirement : {};
    const itemId = String(requirement.itemId || '');
    const qty = Math.max(0, Math.floor(Number(requirement.qty || 0)));
    if (!itemId || qty < 1 || typeof context.inventoryQty !== 'function' || typeof context.consumeItem !== 'function') {
      return { ok: false, error: 'У личного дела нет серверного условия завершения.' };
    }
    if (Math.max(0, Math.floor(Number(context.inventoryQty(itemId) || 0))) < qty) {
      return { ok: false, error: `Для личного дела нужно принести ${itemId} ×${qty}.` };
    }
    if (context.consumeItem(itemId, qty) !== true) {
      return { ok: false, error: 'Не удалось передать требуемые предметы.' };
    }
    state.personalQuestCompleted = true;
    state.personalQuestStarted = true;
    state.loyalty = Math.min(100, state.loyalty + 25);
    state.personalQuestCompletedAt = Number(now);
  } else return { ok: false, error: 'Неизвестное действие жителя.' };
  base.updatedAt = Number(now);
  sanitizeResidentState(base, catalog);
  return { ok: true, residentId, state: base.residentStates[residentId] };
}

function calculateResidentBonuses(base = {}, catalog = {}) {
  sanitizeResidentState(base, catalog);
  const byId = indexes(catalog);
  const threshold = Number(catalog.loyaltyThreshold || 35);
  const bonuses = {};
  const active = [];
  const builtTypes = new Set((base.objects || []).map(row => String(row?.typeId || '')));
  for (const id of base.residents || []) {
    const state = base.residentStates[id];
    const resident = byId[id];
    if (!resident || !state?.recruited || !state.assigned || state.loyalty < threshold) continue;
    if ((resident.requiredObjectTypeIds || []).some(typeId => !builtTypes.has(String(typeId || '')))) continue;
    active.push(id);
    for (const [key, value] of Object.entries(resident.bonus || {})) {
      if (typeof value === 'boolean') bonuses[key] = bonuses[key] || value;
      else bonuses[key] = Number(bonuses[key] || 0) + Number(value || 0);
    }
  }
  return { activeResidentIds: active, ...bonuses };
}

function publicResidents(base = {}, catalog = {}, baseCatalog = {}) {
  sanitizeResidentState(base, catalog);
  return {
    limit: residentLimit(base, baseCatalog),
    assigned: [...(base.residents || [])],
    states: { ...(base.residentStates || {}) },
    candidates: (catalog.residents || []).map(row => ({ ...row })),
    bonuses: calculateResidentBonuses(base, catalog)
  };
}

module.exports = { applyResidentAction, calculateResidentBonuses, canAssign, publicResidents, residentLimit, sanitizeResidentState };
