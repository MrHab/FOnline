'use strict';

const QUEST_STATE_VERSION = 3;

function safeId(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 128);
}

function objectiveProgressKey(questId = '', objectiveId = '') {
  return `${safeId(questId)}:${safeId(objectiveId)}`.slice(0, 220);
}

function objectiveEventMatches(binding = {}, context = {}) {
  const type = String(binding.type || '');
  const source = String(context.source || '');
  const locationId = String(context.locationId || '');
  const locations = [binding.locationId, ...(Array.isArray(binding.locationIds) ? binding.locationIds : [])]
    .map(id => String(id || '')).filter(Boolean);
  if (type === 'location') return source === 'location_arrival' && locations.includes(locationId);
  if (type === 'dialogue' || type === 'allies') {
    const actors = (Array.isArray(binding.npcIds) ? binding.npcIds : []).map(String);
    return ['npc_dialogue', 'npc_dialogue_action'].includes(source) && actors.includes(String(context.actorId || ''));
  }
  if (type === 'object' || type === 'objects') {
    const objects = (Array.isArray(binding.objectIds) ? binding.objectIds : []).map(String);
    return source === 'quest_object'
      && (!locations.length || locations.includes(locationId))
      && objects.includes(String(context.objectId || ''));
  }
  if (type === 'anomaly') {
    const types = (Array.isArray(binding.anomalyTypes) ? binding.anomalyTypes : []).map(String);
    return source === 'bolt_discharge' && (!types.length || types.includes(String(context.anomalyType || '')));
  }
  if (type === 'artifact') return source === 'artifact_pickup';
  return false;
}

function allQuests(catalog = {}) {
  return [...(catalog.campaign || []), ...(catalog.factionQuests || []), ...(catalog.mechanicQuests || []), ...(catalog.personalQuests || [])];
}

function indexes(catalog = {}) {
  return Object.fromEntries(allQuests(catalog).map(row => [String(row.id), row]));
}

function initialQuestState() {
  return { version: QUEST_STATE_VERSION, active: {}, completed: {}, outcomeTags: [], knownSecrets: [], rewardClaims: [], repeatCounts: {}, objectiveProgress: {} };
}

function sanitizeQuestState(input = {}, catalog = {}) {
  const byId = indexes(catalog);
  const source = input && typeof input === 'object' ? input : {};
  const out = initialQuestState();
  out.active = Object.fromEntries(Object.entries(source.active || {}).map(([id, row]) => {
    const quest = byId[id]; if (!quest) return null;
    return [id, {
      objectiveIndex: Math.max(0, Math.min((quest.objectives || []).length, Math.floor(Number(row?.objectiveIndex || 0)))),
      startedAt: Math.max(0, Number(row?.startedAt || 0)),
      awaitingOutcome: row?.awaitingOutcome === true,
      awaitingTurnIn: row?.awaitingTurnIn === true
    }];
  }).filter(Boolean));
  out.completed = Object.fromEntries(Object.entries(source.completed || {}).map(([id, row]) => byId[id] ? [id, { outcomeId: String(row?.outcomeId || '').slice(0, 64), completedAt: Math.max(0, Number(row?.completedAt || 0)) }] : null).filter(Boolean));
  out.outcomeTags = [...new Set((Array.isArray(source.outcomeTags) ? source.outcomeTags : []).map(value => String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 96)).filter(Boolean))].slice(0, 128);
  out.knownSecrets = [...new Set((Array.isArray(source.knownSecrets) ? source.knownSecrets : []).map(value => String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 96)).filter(Boolean))].slice(0, 128);
  out.rewardClaims = [...new Set((Array.isArray(source.rewardClaims) ? source.rewardClaims : []).map(value => String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 96)).filter(Boolean))].slice(0, 256);
  out.repeatCounts = Object.fromEntries(Object.entries(source.repeatCounts || {}).map(([id, count]) => [String(id).slice(0, 64), Math.max(0, Math.floor(Number(count || 0))) ]).filter(([id]) => id));
  out.objectiveProgress = Object.fromEntries(Object.entries(source.objectiveProgress || {}).map(([key, values]) => {
    const cleanKey = String(key || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 220);
    const cleanValues = [...new Set((Array.isArray(values) ? values : []).map(safeId).filter(Boolean))].slice(0, 16);
    return cleanKey && cleanValues.length ? [cleanKey, cleanValues] : null;
  }).filter(Boolean));
  return out;
}

function completedCampaignOrder(state = {}, catalog = {}) {
  return (catalog.campaign || []).filter(row => state.completed?.[row.id]).reduce((max, row) => Math.max(max, Number(row.order || 0)), -1);
}

function startQuest(stateInput = {}, questId = '', catalog = {}, context = {}, now = Date.now()) {
  const state = sanitizeQuestState(stateInput, catalog);
  const quest = indexes(catalog)[String(questId || '')];
  if (!quest) return { ok: false, error: 'Неизвестное авторское задание.', state };
  if (state.completed[quest.id]) return { ok: false, error: 'Это задание уже завершено.', state };
  if (state.active[quest.id]) return { ok: true, alreadyStarted: true, state };
  if ((quest.prerequisites || []).some(id => !state.completed[id])) return { ok: false, error: 'Сначала завершите предыдущую часть цепочки.', state };
  if (Number(quest.hiddenUntilStage || -1) > completedCampaignOrder(state, catalog) + 1) return { ok: false, error: 'Источник задания пока неизвестен.', state };
  if (quest.factionId && Number(context.reputation?.[quest.factionId] || 0) < Number(quest.minReputation || -1000)) return { ok: false, error: 'Заказчик пока не доверяет вам эту работу.', state };
  if ((catalog.campaign || []).includes(quest)) {
    const previous = (catalog.campaign || []).find(row => Number(row.order) === Number(quest.order) - 1);
    if (previous && !state.completed[previous.id]) return { ok: false, error: 'Предыдущая глава ещё не завершена.', state };
  }
  state.active[quest.id] = {
    objectiveIndex: 0,
    startedAt: Number(now),
    awaitingOutcome: false,
    awaitingTurnIn: false
  };
  return { ok: true, state, quest };
}

function advanceQuest(stateInput = {}, questId = '', event = {}, catalog = {}, now = Date.now()) {
  const state = sanitizeQuestState(stateInput, catalog);
  const quest = indexes(catalog)[String(questId || '')];
  const active = state.active[String(questId || '')];
  if (!quest || !active) return { ok: false, error: 'Задание не активно.', state };
  if (event.authoritative !== true) return { ok: false, error: 'Цель должна быть подтверждена событием игрового мира.', state };
  if (active.awaitingOutcome) return { ok: false, error: 'Сначала выберите исход.', state };
  if (active.awaitingTurnIn) return { ok: false, error: 'Вернитесь к заказчику и сдайте дело в диалоге.', state };
  const expected = String((quest.objectives || [])[active.objectiveIndex] || '');
  if (!expected || String(event.action || '') !== expected) return { ok: false, error: 'Это действие не продвигает текущую цель.', expected, state };
  const requiredLocation = contextLocationRequired(quest, active.objectiveIndex);
  if (requiredLocation && String(event.locationId || '') !== requiredLocation) return { ok: false, error: 'Цель находится в другой локации.', state };
  delete state.objectiveProgress[objectiveProgressKey(quest.id, expected)];
  active.objectiveIndex += 1;
  if (active.objectiveIndex < (quest.objectives || []).length) return { ok: true, advanced: true, state, nextObjective: quest.objectives[active.objectiveIndex] };
  if ((quest.outcomes || []).length) { active.awaitingOutcome = true; return { ok: true, awaitingOutcome: true, state }; }
  active.awaitingTurnIn = true;
  return { ok: true, awaitingTurnIn: true, state };
}

function recordQuestObjectiveProgress(stateInput = {}, questId = '', objectiveId = '', token = '', required = 1, catalog = {}) {
  const state = sanitizeQuestState(stateInput, catalog);
  const quest = indexes(catalog)[String(questId || '')];
  const active = state.active[String(questId || '')];
  if (!quest || !active) return { ok: false, error: 'Quest is not active.', state };
  if (active.awaitingOutcome) return { ok: false, error: 'Choose the quest outcome first.', state };
  if (active.awaitingTurnIn) return { ok: false, error: 'Turn the quest in to its giver first.', state };
  const expected = String((quest.objectives || [])[active.objectiveIndex] || '');
  if (!expected || expected !== String(objectiveId || '')) return { ok: false, error: 'This action does not advance the current objective.', expected, state };
  const cleanToken = safeId(token);
  if (!cleanToken) return { ok: false, error: 'Objective progress token is missing.', state };
  const target = Math.max(1, Math.min(16, Math.floor(Number(required || 1))));
  const key = objectiveProgressKey(quest.id, expected);
  const tokens = Array.isArray(state.objectiveProgress[key]) ? [...state.objectiveProgress[key]] : [];
  const duplicate = tokens.includes(cleanToken);
  if (!duplicate) tokens.push(cleanToken);
  state.objectiveProgress[key] = tokens.slice(0, target);
  const current = state.objectiveProgress[key].length;
  return { ok: true, state, duplicate, current, target, complete: current >= target };
}

function contextLocationRequired(quest = {}, index = 0) {
  return String(quest.objectiveLocations?.[index] || '');
}

function completeQuest(state, quest, outcomeId = '', catalog = {}, now = Date.now()) {
  if (state.completed[quest.id]) return { ok: true, duplicate: true, state, reward: null };
  let selected = null;
  if ((quest.outcomes || []).length) {
    if (typeof quest.outcomes[0] === 'string') {
      if (!quest.outcomes.includes(outcomeId)) return { ok: false, error: 'Недоступный исход.', state };
      selected = { id: outcomeId, outcomeTag: `${quest.id}:${outcomeId}` };
    } else {
      selected = quest.outcomes.find(row => row.id === outcomeId);
      if (!selected) return { ok: false, error: 'Недоступный исход.', state };
    }
  }
  delete state.active[quest.id];
  state.completed[quest.id] = { outcomeId: selected?.id || '', completedAt: Number(now) };
  const tag = selected?.outcomeTag || (selected?.id ? `${quest.id}:${selected.id}` : '');
  if (tag && !state.outcomeTags.includes(tag)) state.outcomeTags.push(tag);
  for (const secret of [quest.secret, ...(quest.reveals || [])].filter(Boolean)) if (!state.knownSecrets.includes(secret)) state.knownSecrets.push(secret);
  const claimId = `quest:${quest.id}`;
  const reward = state.rewardClaims.includes(claimId) ? null : { ...(quest.reward || {}), ...(selected?.reward || {}) };
  if (reward) state.rewardClaims.push(claimId);
  return { ok: true, completed: true, outcomeId: selected?.id || '', outcomeTag: tag, reward, state };
}

function chooseQuestOutcome(stateInput = {}, questId = '', outcomeId = '', catalog = {}, now = Date.now()) {
  const state = sanitizeQuestState(stateInput, catalog);
  const quest = indexes(catalog)[String(questId || '')];
  const active = state.active[String(questId || '')];
  if (!quest || !active?.awaitingOutcome) return { ok: false, error: 'Выбор исхода сейчас недоступен.', state };
  return completeQuest(state, quest, String(outcomeId || ''), catalog, now);
}

function turnInQuest(stateInput = {}, questId = '', catalog = {}, now = Date.now()) {
  const state = sanitizeQuestState(stateInput, catalog);
  const quest = indexes(catalog)[String(questId || '')];
  const active = state.active[String(questId || '')];
  if (!quest || !active?.awaitingTurnIn || active.awaitingOutcome || (quest.outcomes || []).length) {
    return { ok: false, error: 'Сдача этого дела сейчас недоступна.', state };
  }
  return completeQuest(state, quest, '', catalog, now);
}

function repeatableReward(stateInput = {}, templateId = '', catalog = {}) {
  const state = sanitizeQuestState(stateInput, catalog);
  const template = (catalog.repeatableTemplates || []).find(row => row.id === templateId);
  if (!template) return { ok: false, error: 'Неизвестный шаблон контракта.', state };
  const count = Number(state.repeatCounts[templateId] || 0);
  state.repeatCounts[templateId] = count + 1;
  const multiplier = Math.max(0.35, 1 - count * 0.12);
  return { ok: true, state, reward: { silver: Math.max(1, Math.floor(Number(template.baseReward || 0) * multiplier)) } };
}

function publicQuestJournal(stateInput = {}, catalog = {}) {
  const state = sanitizeQuestState(stateInput, catalog);
  const stage = completedCampaignOrder(state, catalog) + 1;
  const visible = quest => Number(quest.hiddenUntilStage || -1) <= stage || !!state.active[quest.id] || !!state.completed[quest.id];
  const locked = quest => {
    if ((quest.prerequisites || []).some(id => !state.completed[id])) return true;
    if ((catalog.campaign || []).includes(quest)) {
      const previous = (catalog.campaign || []).find(row => Number(row.order) === Number(quest.order) - 1);
      if (previous && !state.completed[previous.id]) return true;
    }
    return false;
  };
  const objectiveLabel = objectiveId => String(catalog.objectiveLabels?.[objectiveId] || 'Продолжить расследование');
  const objectiveHint = binding => {
    const locations = [binding?.locationId, ...(Array.isArray(binding?.locationIds) ? binding.locationIds : [])]
      .map(id => String(catalog.locationLabels?.[id] || id || '')).filter(Boolean);
    const npcs = (Array.isArray(binding?.npcIds) ? binding.npcIds : [])
      .map(id => String(catalog.npcLabels?.[id] || id || '')).filter(Boolean);
    const type = String(binding?.type || '');
    if (type === 'location') return locations.length ? `Посетите: ${locations.join(', ')}.` : 'Доберитесь до отмеченной точки.';
    if (type === 'object' || type === 'objects') return locations.length
      ? `Найдите и используйте объект задания: ${locations.join(', ')}.`
      : 'Найдите и используйте объект задания.';
    if (type === 'dialogue' || type === 'allies') return npcs.length ? `Поговорите с: ${npcs.join(', ')}.` : 'Поговорите с указанным персонажем.';
    if (type === 'anomaly') return 'Найдите указанную аномалию и воздействуйте на неё болтом.';
    if (type === 'artifact') return 'Подберите требуемый артефакт в игровом мире.';
    return '';
  };
  const publicOutcomes = quest => (quest.outcomes || []).map(row => {
    const id = String(typeof row === 'string' ? row : row?.id || '');
    return {
      ...(row && typeof row === 'object' ? row : {}),
      id,
      label: String((row && typeof row === 'object' ? row.label : '') || catalog.outcomeLabels?.[id] || 'Принять решение')
    };
  }).filter(row => row.id);
  const view = quest => {
    const active = state.active[quest.id];
    const currentObjective = active ? String(quest.objectives?.[active.objectiveIndex] || '') : '';
    const binding = catalog.objectiveBindings?.[currentObjective] || {};
    const target = Math.max(1, Math.min(16, Math.floor(Number(binding.required || 1))));
    const current = currentObjective ? (state.objectiveProgress[objectiveProgressKey(quest.id, currentObjective)] || []).length : 0;
    const status = state.completed[quest.id] ? 'completed' : active
      ? (active.awaitingOutcome ? 'choice' : active.awaitingTurnIn ? 'turnin' : 'active')
      : locked(quest) ? 'locked' : 'available';
    const dialogue = catalog.questDialogues?.[quest.id] || quest.dialogue || {};
    const dialogueKey = status === 'available' ? 'briefing'
      : status === 'active' ? 'progress'
      : status === 'choice' || status === 'turnin' ? 'resolution'
      : status === 'completed' ? 'after' : 'locked';
    return {
      id: quest.id, title: quest.title, summary: quest.summary || '', factionId: quest.factionId || '', npcId: quest.npcId || quest.giverNpcId || '',
      status,
      dialogue: String(dialogue[status] || dialogue[dialogueKey]
        || (status === 'locked' ? dialogue.briefing : dialogue.progress) || ''),
      objectiveIndex: Number(active?.objectiveIndex || 0),
      currentObjective,
      currentObjectiveLabel: currentObjective ? objectiveLabel(currentObjective) : '',
      currentObjectiveHint: currentObjective ? objectiveHint(binding) : '',
      currentObjectiveNpcIds: currentObjective && ['dialogue', 'allies'].includes(String(binding.type || ''))
        ? (binding.npcIds || []).map(String)
        : [],
      currentObjectiveInteraction: currentObjective ? String(binding.type || '') : '',
      objectiveProgressCurrent: target > 1 ? current : 0,
      objectiveProgressTarget: target > 1 ? target : 0,
      outcomes: active?.awaitingOutcome ? publicOutcomes(quest) : [],
      outcomeId: state.completed[quest.id]?.outcomeId || ''
    };
  };
  return {
    version: QUEST_STATE_VERSION,
    campaign: (catalog.campaign || []).filter(visible).map(view),
    factions: Object.fromEntries(Object.entries(catalog.factionChains || {}).map(([factionId, ids]) => [factionId, ids.map(id => indexes(catalog)[id]).filter(quest => quest && visible(quest)).map(view)]).filter(([id]) => id !== 'continuity' || stage >= 3)),
    mechanic: (catalog.mechanicQuests || []).filter(visible).map(view),
    personal: (catalog.personalQuests || []).filter(visible).map(view),
    knownSecrets: [...state.knownSecrets], outcomeTags: [...state.outcomeTags]
  };
}

module.exports = { QUEST_STATE_VERSION, advanceQuest, allQuests, chooseQuestOutcome, initialQuestState, objectiveEventMatches, objectiveProgressKey, publicQuestJournal, recordQuestObjectiveProgress, repeatableReward, sanitizeQuestState, startQuest, turnInQuest };
