'use strict';

const ONBOARDING_VERSION = 2;

// Only authoritative gameplay handlers record these facts; dialogue requests
// never supply them. Keep them in the character save across room recreation.
const EVIDENCE_KEYS = ['suppliesTaken', 'equipmentWorn', 'weaponReloaded', 'targetHit', 'coverUsed',
  'npcHealed', 'oreGathered', 'woodGathered', 'kitCrafted', 'weaponRepaired', 'chimeDischarged'];

function sanitizeEvidence(input = {}) {
  return Object.fromEntries(EVIDENCE_KEYS.map(key => [key,
    Math.max(0, Math.min(9999, Math.floor(Number(input[key]) || 0)))]));
}

function recordOnboardingEvidence(state, key, amount = 1) {
  if (!state || state.phase !== 'tutorial' || !EVIDENCE_KEYS.includes(key)) return false;
  state.evidence = sanitizeEvidence(state.evidence);
  state.evidence[key] = Math.min(9999, state.evidence[key] + Math.max(0, Math.floor(Number(amount) || 0)));
  state.updatedAt = Date.now();
  return true;
}

function lessonRequirements(step = {}, state = {}) {
  const evidence = sanitizeEvidence(state.evidence);
  return (step.requirements || []).map(row => ({ ...row,
    current: evidence[row.key] || 0,
    complete: (evidence[row.key] || 0) >= Number(row.count || 1)
  }));
}

function safeId(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 96);
}

function phaseRows(catalog = {}, phase = 'tutorial') {
  return Array.isArray(catalog?.[phase]?.steps) ? catalog[phase].steps : [];
}

function initialKromkaOnboarding(catalog = {}, options = {}) {
  const tutorial = phaseRows(catalog, 'tutorial');
  const mission = phaseRows(catalog, 'firstMission');
  return {
    version: ONBOARDING_VERSION,
    phase: 'tutorial',
    stepId: safeId(tutorial[0]?.id || 'contract'),
    completedTutorialSteps: [],
    completedMissionSteps: [],
    tutorialCompleted: false,
    missionCompleted: false,
    canSkipTutorial: options.accountCompleted === true,
    outcomeTags: [],
    evidence: sanitizeEvidence(),
    issuedSupplies: {},
    startedAt: Math.max(0, Number(options.now || Date.now())),
    updatedAt: Math.max(0, Number(options.now || Date.now()))
  };
}

function sanitizeStringArray(value, max = 32) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const id = safeId(raw);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeKromkaOnboarding(input = {}, catalog = {}, options = {}) {
  const base = initialKromkaOnboarding(catalog, options);
  const tutorialIds = new Set(phaseRows(catalog, 'tutorial').map(row => safeId(row.id)));
  const missionIds = new Set(phaseRows(catalog, 'firstMission').map(row => safeId(row.id)));
  const phase = ['tutorial', 'firstMission', 'complete'].includes(input?.phase) ? input.phase : base.phase;
  const legacyPractice = phase === 'tutorial' && Number(input?.version || 1) < ONBOARDING_VERSION;
  const completedTutorialSteps = sanitizeStringArray(input?.completedTutorialSteps)
    .filter(id => tutorialIds.has(id) && (!legacyPractice || ['contract', 'inspection'].includes(id)));
  const completedMissionSteps = sanitizeStringArray(input?.completedMissionSteps).filter(id => missionIds.has(id));
  const rows = phase === 'tutorial' ? phaseRows(catalog, 'tutorial') : phaseRows(catalog, 'firstMission');
  const completed = phase === 'tutorial' ? completedTutorialSteps : completedMissionSteps;
  const expected = rows.find(row => !completed.includes(safeId(row.id)));
  return {
    version: ONBOARDING_VERSION,
    phase,
    stepId: phase === 'complete' ? '' : safeId(expected?.id || input?.stepId || base.stepId),
    completedTutorialSteps,
    completedMissionSteps,
    tutorialCompleted: input?.tutorialCompleted === true || phase !== 'tutorial',
    missionCompleted: input?.missionCompleted === true || phase === 'complete',
    canSkipTutorial: input?.canSkipTutorial === true || options.accountCompleted === true,
    outcomeTags: sanitizeStringArray(input?.outcomeTags, 16),
    // Одноразовые подсказки мира (первые ворота, карта мира): показаны — больше не повторяются.
    hintsShown: sanitizeStringArray(input?.hintsShown, 16),
    evidence: sanitizeEvidence(input?.evidence),
    issuedSupplies: Object.fromEntries(Object.entries(input?.issuedSupplies || {})
      .slice(0, 40).map(([id, qty]) => [safeId(id), Math.max(0, Math.min(999, Math.floor(Number(qty) || 0)))])),
    startedAt: Math.max(0, Number(input?.startedAt || base.startedAt)),
    updatedAt: Math.max(0, Number(input?.updatedAt || base.updatedAt))
  };
}

function currentStep(state = {}, catalog = {}) {
  const phase = state.phase === 'firstMission' ? 'firstMission' : 'tutorial';
  return phaseRows(catalog, phase).find(row => safeId(row.id) === safeId(state.stepId)) || null;
}

function onboardingNpc(catalog = {}, npcId = '') {
  const id = safeId(npcId);
  return (Array.isArray(catalog?.npcs) ? catalog.npcs : [])
    .find(row => safeId(row?.id) === id) || null;
}

function publicKromkaOnboarding(input = {}, catalog = {}, now = Date.now()) {
  const state = sanitizeKromkaOnboarding(input, catalog, { now });
  const step = state.phase === 'complete' ? null : currentStep(state, catalog);
  const npc = step ? onboardingNpc(catalog, step.npcId) : null;
  const rows = state.phase === 'firstMission' ? phaseRows(catalog, 'firstMission') : phaseRows(catalog, 'tutorial');
  const completed = state.phase === 'firstMission' ? state.completedMissionSteps : state.completedTutorialSteps;
  const requirements = lessonRequirements(step || {}, state);
  const pending = requirements.find(row => !row.complete);
  return {
    schema: 'kromka.onboarding-state.v1',
    ...state,
    title: state.phase === 'firstMission' ? String(catalog?.firstMission?.title || '')
      : state.phase === 'tutorial' ? String(catalog?.tutorial?.title || '') : 'Пролог завершён',
    progress: { completed: completed.length, total: rows.length },
    step: step ? {
      id: safeId(step.id), title: String(step.title || ''), action: safeId(step.action),
      cinematicId: safeId(step.cinematicId),
      instruction: String(step.instruction || ''), x: Number(step.x || 0), z: Number(step.z || 0),
      radius: Math.max(1, Number(step.radius || 3)), button: String(step.button || ''),
      npcId: safeId(step.npcId), npcName: String(npc?.displayName || ''),
      dialogue: String(step.dialogue || ''),
      requirements,
      ready: !pending,
      hint: String(pending?.hint || step.hint || ''),
      mobileHint: String(pending?.mobileHint || step.mobileHint || pending?.hint || step.hint || ''),
      target: pending?.target || null,
      choices: (Array.isArray(step.choices) ? step.choices : []).map(choice => ({
        id: safeId(choice.id), label: String(choice.label || ''), outcomeTag: safeId(choice.outcomeTag)
      }))
    } : null,
    serverNow: Number(now)
  };
}

function advanceKromkaOnboarding(input = {}, action = '', context = {}, catalog = {}) {
  const now = Math.max(0, Number(context.now || Date.now()));
  const state = sanitizeKromkaOnboarding(input, catalog, {
    now, accountCompleted: context.accountCompleted === true
  });
  if (state.phase === 'complete') return { ok: false, error: 'Пролог уже завершён.', state };
  const step = currentStep(state, catalog);
  if (!step || safeId(action) !== safeId(step.action)) {
    return { ok: false, error: 'Сначала завершите текущий этап подготовки.', state };
  }
  const requiredNpcId = safeId(step.npcId);
  if (requiredNpcId && safeId(context.npcId) !== requiredNpcId) {
    return { ok: false, error: 'Завершите этот этап в диалоге с указанным персонажем.', state };
  }
  const requiredLocation = state.phase === 'tutorial'
    ? safeId(catalog.tutorialLocationId) : safeId(catalog.firstMissionLocationId);
  if (safeId(context.locationId) !== requiredLocation) {
    return { ok: false, error: 'Эта цель находится в другой локации.', state };
  }
  const missing = lessonRequirements(step, state).find(row => !row.complete);
  if (missing) return { ok: false, error: String(missing.hint || 'Сначала выполните действие задания.'), state };
  if (!(requiredNpcId && context.dialogueValidated === true)) {
    const distance = Math.hypot(Number(context.x || 0) - Number(step.x || 0),
      Number(context.z || 0) - Number(step.z || 0));
    if (distance > Math.max(1, Number(step.radius || 3)) + 0.75) {
      return { ok: false, error: 'Подойдите к отмеченной цели.', state };
    }
  }
  const choices = Array.isArray(step.choices) ? step.choices : [];
  if (choices.length) {
    const choice = choices.find(row => safeId(row.id) === safeId(context.choiceId));
    if (!choice) return { ok: false, error: 'Выберите один из доступных вариантов.', state };
    const outcome = safeId(choice.outcomeTag);
    if (outcome && !state.outcomeTags.includes(outcome)) state.outcomeTags.push(outcome);
  }

  const phase = state.phase;
  const completedKey = phase === 'tutorial' ? 'completedTutorialSteps' : 'completedMissionSteps';
  const id = safeId(step.id);
  if (!state[completedKey].includes(id)) state[completedKey].push(id);
  const rows = phaseRows(catalog, phase);
  const next = rows.find(row => !state[completedKey].includes(safeId(row.id)));
  let transition = null;
  let completed = false;
  if (next) state.stepId = safeId(next.id);
  else if (phase === 'tutorial') {
    state.phase = 'firstMission';
    state.stepId = safeId(phaseRows(catalog, 'firstMission')[0]?.id || 'recover');
    state.tutorialCompleted = true;
    transition = {
      locationId: safeId(catalog.firstMissionLocationId),
      reason: 'kromkaFirstMission',
      cinematicId: safeId(step.cinematicId)
    };
  } else {
    state.phase = 'complete';
    state.stepId = '';
    state.missionCompleted = true;
    completed = true;
    transition = { locationId: safeId(catalog.arrivalLocationId || 'settlement'), reason: 'kromkaPrologueComplete' };
  }
  state.updatedAt = now;
  return { ok: true, state, completedStepId: id, transition, completed };
}

function skipKromkaTutorial(input = {}, catalog = {}, context = {}) {
  const state = sanitizeKromkaOnboarding(input, catalog, context);
  if (!state.canSkipTutorial || context.accountCompleted !== true) {
    return { ok: false, error: 'Первую подготовку на аккаунте пропустить нельзя.', state };
  }
  state.completedTutorialSteps = phaseRows(catalog, 'tutorial').map(row => safeId(row.id));
  state.tutorialCompleted = true;
  state.phase = 'firstMission';
  state.stepId = safeId(phaseRows(catalog, 'firstMission')[0]?.id || 'recover');
  state.updatedAt = Math.max(0, Number(context.now || Date.now()));
  return {
    ok: true, skipped: true, state,
    transition: { locationId: safeId(catalog.firstMissionLocationId), reason: 'kromkaTutorialSkipped' }
  };
}

module.exports = {
  ONBOARDING_VERSION,
  advanceKromkaOnboarding,
  initialKromkaOnboarding,
  publicKromkaOnboarding,
  recordOnboardingEvidence,
  lessonRequirements,
  sanitizeKromkaOnboarding,
  skipKromkaTutorial
};
