'use strict';

const WORLD_ACTIVITY_SCHEMA = 'realm.worldActivity.v1';
const WORLD_ACTIVITY_KIND_RESOURCE_EXPEDITION = 'resource_expedition';
const WORLD_ACTIVITY_KIND_RECON_EXPEDITION = 'recon_expedition';
const WORLD_ACTIVITY_KIND_OUTPOST_DEFENSE = 'outpost_defense';
const WORLD_ACTIVITY_KIND_DISTRESS_SIGNAL = 'distress_signal';
const WORLD_ACTIVITY_KIND_ASSAULT_DIVERSION = 'assault_diversion';
const WORLD_ACTIVITY_ACTIVE_STATUSES = new Set(['active', 'extracting']);
const WORLD_ACTIVITY_PING_TYPES = new Set(['move', 'danger', 'loot']);
const WORLD_ACTIVITY_PING_DURATION_MS = Object.freeze({
  move: 10000,
  danger: 7000,
  loot: 15000
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function safeId(value = '', fallback = '') {
  const normalized = String(value || '')
    .replace(/[^a-zA-Z0-9_#-]/g, '')
    .slice(0, 96);
  return normalized || fallback;
}

function uniqueStrings(rows = [], max = 24, length = 64) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map(value => String(value || '').trim().slice(0, length))
    .filter(Boolean))]
    .slice(0, max);
}

function normalizeObjective(row = {}, index = 0) {
  const target = Math.max(1, Math.floor(Number(row.target || 1)));
  const bonusTarget = Math.max(target, Math.floor(Number(row.bonusTarget || target)));
  const maxTarget = Math.max(bonusTarget, Math.floor(Number(row.maxTarget || bonusTarget)));
  const current = clamp(Math.floor(Number(row.current || 0)), 0, maxTarget);
  return {
    id: safeId(row.id, `objective_${index}`),
    type: safeId(row.type, 'counter'),
    label: String(row.label || 'Выполнить задачу').slice(0, 120),
    current,
    target,
    bonusTarget,
    maxTarget,
    required: row.required !== false,
    status: current >= maxTarget
      ? 'mastered'
      : current >= bonusTarget
        ? 'bonus'
        : current >= target
          ? 'completed'
          : 'active'
  };
}

function normalizeInteractionPoint(row = {}, index = 0) {
  const rawStatus = String(row.status || '').toLowerCase();
  const status = ['completed', 'locked', 'disabled'].includes(rawStatus) ? rawStatus : 'pending';
  return {
    id: safeId(row.id, `point_${index + 1}`),
    label: String(row.label || `Точка наблюдения ${index + 1}`).slice(0, 80),
    x: Number(Number(row.x || 0).toFixed(2)),
    z: Number(Number(row.z || 0).toFixed(2)),
    status,
    completedAt: status === 'completed' ? Math.max(0, Number(row.completedAt || 0)) : 0
  };
}

function normalizeEncounterLayout(row = null) {
  if (!row || typeof row !== 'object') return null;
  const lanes = (Array.isArray(row.lanes) ? row.lanes : [])
    .slice(0, 4)
    .map((lane, index) => ({
      id: safeId(lane?.id, `lane_${index + 1}`),
      label: String(lane?.label || `НАПРАВЛЕНИЕ ${index + 1}`).slice(0, 32),
      tx: Math.round(Number(lane?.tx || 0)),
      tz: Math.round(Number(lane?.tz || 0)),
      x: Number(Number(lane?.x || 0).toFixed(2)),
      z: Number(Number(lane?.z || 0).toFixed(2))
    }));
  if (!lanes.length) return null;
  const focus = row.focus && typeof row.focus === 'object' ? row.focus : {};
  const objectiveBounds = row.objectiveBounds && typeof row.objectiveBounds === 'object'
    ? row.objectiveBounds : {};
  return {
    schema: String(row.schema || 'realm.worldActivityEncounter.v1').slice(0, 64),
    seedOffset: Math.max(0, Math.floor(Number(row.seedOffset || 0))),
    focus: {
      tx: Math.round(Number(focus.tx || 0)),
      tz: Math.round(Number(focus.tz || 0)),
      x: Number(Number(focus.x || 0).toFixed(2)),
      z: Number(Number(focus.z || 0).toFixed(2)),
      radius: clamp(Number(focus.radius || 8), 4, 80)
    },
    objectiveBounds: {
      minX: Math.round(Number(objectiveBounds.minX || 0)),
      minZ: Math.round(Number(objectiveBounds.minZ || 0)),
      maxX: Math.round(Number(objectiveBounds.maxX || 0)),
      maxZ: Math.round(Number(objectiveBounds.maxZ || 0))
    },
    lanes,
    activeLaneId: safeId(row.activeLaneId),
    waveNumber: Math.max(0, Math.floor(Number(row.waveNumber || 0))),
    waveCount: clamp(Math.floor(Number(row.waveCount || 3)), 1, 4),
    revision: Math.max(1, Math.floor(Number(row.revision || 1)))
  };
}

function normalizeParticipant(row = {}, index = 0) {
  const userId = String(row.userId || '').slice(0, 180);
  const characterId = String(row.characterId || '').slice(0, 180);
  const socketId = String(row.socketId || '').slice(0, 180);
  const key = characterId || userId || socketId || `participant_${index}`;
  return {
    key,
    userId,
    characterId,
    socketId,
    name: String(row.name || 'Выживший').slice(0, 48),
    joinedVia: ['quick_join', 'help_signal', 'direct'].includes(String(row.joinedVia || '').toLowerCase())
      ? String(row.joinedVia).toLowerCase()
      : 'direct',
    contributed: Math.max(0, Math.floor(Number(row.contributed || 0))),
    downed: row.downed === true,
    downedUntil: row.downed === true ? Math.max(0, Number(row.downedUntil || 0)) : 0,
    joinedAt: Math.max(0, Number(row.joinedAt || Date.now())),
    lastActiveAt: Math.max(0, Number(row.lastActiveAt || row.joinedAt || Date.now()))
  };
}

function normalizeWorldActivityPing(row = {}, index = 0, now = Date.now()) {
  const createdAt = Math.max(0, Number(row.createdAt || now));
  const type = String(row.type || '').toLowerCase();
  const normalizedType = WORLD_ACTIVITY_PING_TYPES.has(type) ? type : 'move';
  const expiresAt = Math.max(createdAt, Number(row.expiresAt
    || createdAt + WORLD_ACTIVITY_PING_DURATION_MS[normalizedType]));
  if (expiresAt <= Number(now || Date.now())) return null;
  return {
    id: safeId(row.id, `ping_${createdAt}_${index}`),
    type: normalizedType,
    label: String(row.label || '').trim().slice(0, 48),
    ownerName: String(row.ownerName || 'Выживший').slice(0, 48),
    ownerKey: String(row.ownerKey || '').slice(0, 180),
    x: Number(Number(row.x || 0).toFixed(2)),
    z: Number(Number(row.z || 0).toFixed(2)),
    createdAt,
    expiresAt
  };
}

function normalizeHelpSignal(row = null, now = Date.now()) {
  if (!row || typeof row !== 'object') return null;
  const requestedAt = Math.max(0, Number(row.requestedAt || now));
  const expiresAt = Math.max(requestedAt, Number(row.expiresAt || requestedAt));
  if (expiresAt <= Number(now || Date.now())) return null;
  return {
    active: true,
    requestedByCharacterId: String(row.requestedByCharacterId || '').slice(0, 180),
    requestedByName: String(row.requestedByName || 'Выживший').slice(0, 48),
    message: String(row.message || 'Отряду нужна помощь.').slice(0, 160),
    requestedAt,
    expiresAt,
    responderCharacterIds: uniqueStrings(row.responderCharacterIds, 24, 180),
    responderNames: uniqueStrings(row.responderNames, 8, 48)
  };
}

function normalizeRally(row = null, now = Date.now()) {
  if (!row || typeof row !== 'object') return null;
  const createdAt = Math.max(0, Number(row.createdAt || now));
  const expiresAt = Math.max(createdAt, Number(row.expiresAt || createdAt));
  if (expiresAt <= Number(now || Date.now())) return null;
  return {
    active: true,
    createdAt,
    expiresAt,
    nextTaskId: safeId(row.nextTaskId),
    voterCharacterIds: uniqueStrings(row.voterCharacterIds, 24, 180),
    voterNames: uniqueStrings(row.voterNames, 8, 48)
  };
}

function worldActivityThreatTier(threat = 0) {
  const value = clamp(threat, 0, 100);
  if (value >= 75) return 3;
  if (value >= 50) return 2;
  if (value >= 25) return 1;
  return 0;
}

function markWorldActivityProgress(activity, now = Date.now()) {
  if (!activity) return;
  const progressAt = Math.max(Number(activity.startedAt || 0), Number(now || Date.now()));
  const phase = safeId(activity.phase, 'active');
  if (!activity.stageStartedAt || String(activity.lastProgressPhase || '') !== phase) {
    activity.stageStartedAt = progressAt;
  }
  activity.lastProgressAt = progressAt;
  activity.lastProgressPhase = phase;
}

function normalizeWorldActivity(row = {}, now = Date.now()) {
  if (!row || typeof row !== 'object') return null;
  const kind = safeId(row.kind, 'world_activity');
  const startedAt = Math.max(0, Number(row.startedAt || now));
  const durationMs = Math.max(60000, Number(row.durationMs || 8 * 60 * 1000));
  const endsAt = Math.max(startedAt + 60000, Number(row.endsAt || startedAt + durationMs));
  const objectives = (Array.isArray(row.objectives) ? row.objectives : [])
    .slice(0, 8)
    .map(normalizeObjective);
  const requiredComplete = objectives
    .filter(objective => objective.required)
    .every(objective => objective.current >= objective.target);
  const status = WORLD_ACTIVITY_ACTIVE_STATUSES.has(String(row.status || '').toLowerCase())
    ? (requiredComplete ? 'extracting' : 'active')
    : ['completed', 'partial', 'failed', 'expired'].includes(String(row.status || '').toLowerCase())
      ? String(row.status).toLowerCase()
      : (requiredComplete ? 'extracting' : 'active');
  const phase = status === 'active'
    ? safeId(row.phase, 'scavenging')
    : status === 'extracting' ? 'extraction' : status;
  const threat = clamp(row.threat || 0, 0, 100);
  const participants = (Array.isArray(row.participants) ? row.participants : [])
    .slice(0, 24)
    .map(normalizeParticipant)
    .filter((participant, index, all) => all.findIndex(row => row.key === participant.key) === index);
  return {
    schema: WORLD_ACTIVITY_SCHEMA,
    id: safeId(row.id, `${kind}_${startedAt}`),
    kind,
    taskId: safeId(row.taskId),
    roomId: safeId(row.roomId),
    locationId: safeId(row.locationId),
    siteId: safeId(row.siteId),
    title: String(row.title || 'Активность пустоши').slice(0, 100),
    status,
    phase,
    startedAt,
    endsAt,
    durationMs,
    lastTickAt: clamp(Number(row.lastTickAt || startedAt), startedAt, Math.max(endsAt, now)),
    stageStartedAt: clamp(Number(row.stageStartedAt || startedAt), startedAt, Math.max(endsAt, now)),
    lastProgressAt: clamp(Number(row.lastProgressAt || startedAt), startedAt, Math.max(endsAt, now)),
    lastProgressPhase: safeId(row.lastProgressPhase, phase),
    threat,
    threatTier: worldActivityThreatTier(threat),
    objectives,
    extractionOpen: status === 'extracting',
    allowedItemIds: uniqueStrings(row.allowedItemIds),
    interactionPoints: (Array.isArray(row.interactionPoints) ? row.interactionPoints : []).slice(0, 8).map(normalizeInteractionPoint),
    encounter: normalizeEncounterLayout(row.encounter),
    creditedEntityIds: uniqueStrings(row.creditedEntityIds, 64, 96),
    approach: ['assault', 'diversion'].includes(String(row.approach || '').toLowerCase()) ? String(row.approach).toLowerCase() : '',
    participants,
    pings: (Array.isArray(row.pings) ? row.pings : [])
      .slice(-8)
      .map((ping, index) => normalizeWorldActivityPing(ping, index, now))
      .filter(Boolean),
    helpSignal: normalizeHelpSignal(row.helpSignal, now),
    rally: normalizeRally(row.rally, now),
    director: row.director && typeof row.director === 'object' ? {
      schema: String(row.director.schema || 'realm.worldActivityDirector.v1').slice(0, 64),
      cue: safeId(row.director.cue),
      warning: safeId(row.director.warning),
      stalled: row.director.stalled === true,
      recoveryCount: Math.max(0, Math.floor(Number(row.director.recoveryCount || 0))),
      updatedAt: Math.max(0, Number(row.director.updatedAt || 0))
    } : null,
    revision: Math.max(1, Math.floor(Number(row.revision || 1))),
    result: row.result && typeof row.result === 'object' ? { ...row.result } : null,
    completedAt: Math.max(0, Number(row.completedAt || 0))
  };
}

function createResourceExpedition(options = {}) {
  const now = Math.max(0, Number(options.now || Date.now()));
  const target = Math.max(3, Math.floor(Number(options.target || 6)));
  const bonusTarget = Math.max(target, Math.floor(Number(options.bonusTarget || target + 3)));
  const maxTarget = Math.max(bonusTarget, Math.floor(Number(options.maxTarget || bonusTarget + 3)));
  const taskId = safeId(options.taskId, `resource_task_${now}`);
  return normalizeWorldActivity({
    id: safeId(options.id, `activity_${taskId}`),
    kind: WORLD_ACTIVITY_KIND_RESOURCE_EXPEDITION,
    taskId,
    roomId: options.roomId,
    locationId: options.locationId,
    siteId: options.siteId,
    title: options.title || 'Вылазка за ресурсами',
    status: 'active',
    startedAt: now,
    durationMs: Math.max(3 * 60 * 1000, Number(options.durationMs || 8 * 60 * 1000)),
    threat: clamp(options.threat || 0, 0, 100),
    allowedItemIds: options.allowedItemIds,
    encounter: options.encounter,
    helpSignal: options.helpSignal,
    objectives: [{
      id: 'resources',
      type: 'collect',
      label: options.objectiveLabel || 'Собрать ресурсы',
      current: 0,
      target,
      bonusTarget,
      maxTarget,
      required: true
    }],
    participants: [],
    revision: 1
  }, now);
}

function createReconExpedition(options = {}) {
  const now = Math.max(0, Number(options.now || Date.now()));
  const points = (Array.isArray(options.interactionPoints) ? options.interactionPoints : [])
    .slice(0, 8)
    .map(normalizeInteractionPoint);
  const maxTarget = Math.max(1, points.length);
  const target = Math.min(maxTarget, Math.max(1, Math.floor(Number(options.target || Math.min(3, maxTarget)))));
  const bonusTarget = Math.min(maxTarget, Math.max(target, Math.floor(Number(options.bonusTarget || Math.min(4, maxTarget)))));
  const taskId = safeId(options.taskId, `recon_task_${now}`);
  const activity = normalizeWorldActivity({
    id: safeId(options.id, `activity_${taskId}`),
    kind: WORLD_ACTIVITY_KIND_RECON_EXPEDITION,
    taskId,
    roomId: options.roomId,
    locationId: options.locationId,
    siteId: options.siteId,
    title: options.title || 'Разведка местности',
    status: 'active',
    startedAt: now,
    durationMs: Math.max(3 * 60 * 1000, Number(options.durationMs || 6 * 60 * 1000)),
    threat: clamp(options.threat || 0, 0, 100),
    interactionPoints: points,
    encounter: options.encounter,
    helpSignal: options.helpSignal,
    objectives: [{
      id: 'recon_points',
      type: 'interact',
      label: options.objectiveLabel || 'Проверить точки наблюдения',
      current: 0,
      target,
      bonusTarget,
      maxTarget,
      required: true
    }],
    participants: [],
    revision: 1
  }, now);
  activity.phase = 'surveying';
  markWorldActivityProgress(activity, now);
  return activity;
}

function createOutpostDefense(options = {}) {
  const now = Math.max(0, Number(options.now || Date.now()));
  const target = Math.max(3, Math.floor(Number(options.target || 6)));
  const bonusTarget = Math.max(target, Math.floor(Number(options.bonusTarget || 8)));
  const maxTarget = Math.max(bonusTarget, Math.floor(Number(options.maxTarget || 9)));
  const taskId = safeId(options.taskId, `defense_task_${now}`);
  const activity = normalizeWorldActivity({
    id: safeId(options.id, `activity_${taskId}`),
    kind: WORLD_ACTIVITY_KIND_OUTPOST_DEFENSE,
    taskId,
    roomId: options.roomId,
    locationId: options.locationId,
    siteId: options.siteId,
    title: options.title || 'Защита аванпоста',
    status: 'active',
    startedAt: now,
    durationMs: Math.max(3 * 60 * 1000, Number(options.durationMs || 6 * 60 * 1000)),
    threat: Math.max(25, clamp(options.threat || 25, 0, 100)),
    creditedEntityIds: [],
    encounter: options.encounter,
    helpSignal: options.helpSignal,
    objectives: [{
      id: 'attackers',
      type: 'defend',
      label: options.objectiveLabel || 'Отразить нападение',
      current: 0,
      target,
      bonusTarget,
      maxTarget,
      required: true
    }],
    participants: [],
    revision: 1
  }, now);
  activity.phase = 'defending';
  markWorldActivityProgress(activity, now);
  return activity;
}

function createDistressSignal(options = {}) {
  const now = Math.max(0, Number(options.now || Date.now()));
  const points = (Array.isArray(options.interactionPoints) ? options.interactionPoints : [])
    .slice(0, 1)
    .map(normalizeInteractionPoint);
  const target = Math.max(2, Math.floor(Number(options.target || 4)));
  const bonusTarget = Math.max(target, Math.floor(Number(options.bonusTarget || 6)));
  const maxTarget = Math.max(bonusTarget, Math.floor(Number(options.maxTarget || 9)));
  const taskId = safeId(options.taskId, `distress_task_${now}`);
  const activity = normalizeWorldActivity({
    id: safeId(options.id, `activity_${taskId}`),
    kind: WORLD_ACTIVITY_KIND_DISTRESS_SIGNAL,
    taskId,
    roomId: options.roomId,
    locationId: options.locationId,
    siteId: options.siteId,
    title: options.title || 'Сигнал бедствия',
    status: 'active',
    startedAt: now,
    durationMs: Math.max(3 * 60 * 1000, Number(options.durationMs || 6 * 60 * 1000)),
    threat: 0,
    interactionPoints: points,
    encounter: options.encounter,
    creditedEntityIds: [],
    helpSignal: options.helpSignal,
    objectives: [{
      id: 'distress_signal',
      type: 'interact',
      label: 'Найти источник сигнала',
      current: 0,
      target: 1,
      bonusTarget: 1,
      maxTarget: 1,
      required: true
    }, {
      id: 'attackers',
      type: 'defend',
      label: 'Зачистить засаду',
      current: 0,
      target,
      bonusTarget,
      maxTarget,
      required: true
    }],
    participants: [],
    revision: 1
  }, now);
  activity.phase = 'searching';
  markWorldActivityProgress(activity, now);
  return activity;
}

function createAssaultDiversion(options = {}) {
  const now = Math.max(0, Number(options.now || Date.now()));
  const points = (Array.isArray(options.interactionPoints) ? options.interactionPoints : [])
    .slice(0, 8)
    .map(normalizeInteractionPoint);
  const targetKills = Math.max(3, Math.floor(Number(options.targetKills || 5)));
  const bonusKills = Math.max(targetKills, Math.floor(Number(options.bonusKills || 7)));
  const maxKills = Math.max(bonusKills, Math.floor(Number(options.maxKills || 9)));
  const sabotagePoints = Math.max(1, points.filter(point => point.id.startsWith('sabotage_')).length);
  const targetSabotage = Math.min(sabotagePoints, Math.max(1, Math.floor(Number(options.targetSabotage || 3))));
  const bonusSabotage = Math.min(sabotagePoints, Math.max(targetSabotage, Math.floor(Number(options.bonusSabotage || 4))));
  const taskId = safeId(options.taskId, `operation_task_${now}`);
  const activity = normalizeWorldActivity({
    id: safeId(options.id, `activity_${taskId}`),
    kind: WORLD_ACTIVITY_KIND_ASSAULT_DIVERSION,
    taskId,
    roomId: options.roomId,
    locationId: options.locationId,
    siteId: options.siteId,
    title: options.title || 'Штурм или диверсия',
    status: 'active',
    startedAt: now,
    durationMs: Math.max(4 * 60 * 1000, Number(options.durationMs || 8 * 60 * 1000)),
    threat: 0,
    interactionPoints: points,
    encounter: options.encounter,
    creditedEntityIds: [],
    helpSignal: options.helpSignal,
    approach: '',
    objectives: [{
      id: 'approach', type: 'choice', label: 'Выбрать подход', current: 0,
      target: 1, bonusTarget: 1, maxTarget: 1, required: true
    }, {
      id: 'attackers', type: 'assault', label: 'Сломить защитников', current: 0,
      target: targetKills, bonusTarget: bonusKills, maxTarget: maxKills, required: false
    }, {
      id: 'sabotage', type: 'interact', label: 'Вывести объекты из строя', current: 0,
      target: targetSabotage, bonusTarget: bonusSabotage, maxTarget: sabotagePoints, required: false
    }],
    participants: [],
    revision: 1
  }, now);
  for (const point of activity.interactionPoints) {
    if (point.id.startsWith('sabotage_')) point.status = 'locked';
  }
  activity.phase = 'planning';
  markWorldActivityProgress(activity, now);
  return activity;
}

function recordWorldActivityParticipant(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return false;
  const participant = normalizeParticipant(data, activity.participants.length);
  const index = activity.participants.findIndex(row => row.key === participant.key);
  if (index >= 0) {
    const current = activity.participants[index];
    const downedExplicit = Object.prototype.hasOwnProperty.call(data, 'downed');
    activity.participants[index] = {
      ...current,
      ...participant,
      joinedVia: current.joinedVia === 'help_signal' || participant.joinedVia === 'help_signal'
        ? 'help_signal'
        : current.joinedVia === 'quick_join' || participant.joinedVia === 'quick_join'
          ? 'quick_join'
          : 'direct',
      contributed: Math.max(current.contributed, participant.contributed),
      downed: downedExplicit ? participant.downed : current.downed,
      downedUntil: downedExplicit ? participant.downedUntil : current.downedUntil,
      joinedAt: Math.min(current.joinedAt, participant.joinedAt),
      lastActiveAt: Math.max(current.lastActiveAt, participant.lastActiveAt)
    };
    return false;
  }
  activity.participants.push(participant);
  activity.participants = activity.participants.slice(0, 24);
  activity.revision += 1;
  return true;
}

function setWorldActivityParticipantDowned(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return false;
  const characterId = String(data.characterId || '');
  const userId = String(data.userId || '');
  const socketId = String(data.socketId || '');
  const participant = activity.participants.find(row => (
    (characterId && row.characterId === characterId)
    || (userId && row.userId === userId)
    || (socketId && row.socketId === socketId)
  ));
  if (!participant) return false;
  const downed = data.downed === true;
  const downedUntil = downed ? Math.max(0, Number(data.downedUntil || 0)) : 0;
  if (participant.downed === downed && participant.downedUntil === downedUntil) return false;
  participant.downed = downed;
  participant.downedUntil = downedUntil;
  participant.lastActiveAt = Math.max(participant.lastActiveAt, Number(data.now || Date.now()));
  activity.revision += 1;
  return true;
}

function createWorldActivityPing(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) {
    return { ok: false, error: 'Активность уже завершена.' };
  }
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  const type = String(data.type || '').toLowerCase();
  if (!WORLD_ACTIVITY_PING_TYPES.has(type)) return { ok: false, error: 'Неизвестный тип метки.' };
  const ownerKey = String(data.characterId || data.userId || data.socketId || data.name || '').slice(0, 180);
  const ping = normalizeWorldActivityPing({
    id: `ping_${type}_${now}_${Math.max(1, Number(activity.revision || 1))}`,
    type,
    label: data.label,
    ownerName: data.name,
    ownerKey,
    x: data.x,
    z: data.z,
    createdAt: now,
    expiresAt: now + WORLD_ACTIVITY_PING_DURATION_MS[type]
  }, 0, now);
  activity.pings = (Array.isArray(activity.pings) ? activity.pings : [])
    .map((row, index) => normalizeWorldActivityPing(row, index, now))
    .filter(row => row && (!ownerKey || row.ownerKey !== ownerKey));
  activity.pings.push(ping);
  activity.pings = activity.pings.slice(-8);
  recordWorldActivityParticipant(activity, { ...data, lastActiveAt: now });
  activity.revision += 1;
  const { ownerKey: _ownerKey, ...publicPing } = ping;
  return { ok: true, ping: publicPing };
}

function requestWorldActivityHelp(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) {
    return { ok: false, error: 'Активность уже завершена.' };
  }
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  const current = normalizeHelpSignal(activity.helpSignal, now);
  if (current) {
    return {
      ok: false,
      error: 'Сигнал помощи уже передан.',
      helpSignal: current
    };
  }
  const durationMs = clamp(Number(data.durationMs || 150000), 60000, 300000);
  activity.helpSignal = normalizeHelpSignal({
    requestedByCharacterId: data.characterId,
    requestedByName: data.name,
    message: data.message || 'Отряд вступил в бой и запрашивает подкрепление.',
    requestedAt: now,
    expiresAt: now + durationMs,
    responderCharacterIds: [],
    responderNames: []
  }, now);
  recordWorldActivityParticipant(activity, {
    ...data,
    joinedVia: data.joinedVia || 'direct',
    joinedAt: now,
    lastActiveAt: now
  });
  activity.revision += 1;
  return { ok: true, helpSignal: { ...activity.helpSignal } };
}

function recordWorldActivityHelpResponse(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) {
    return { ok: false, error: 'Активность уже завершена.' };
  }
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  const helpSignal = normalizeHelpSignal(activity.helpSignal, now);
  if (!helpSignal) return { ok: false, error: 'Сигнал помощи уже погас.' };
  const characterId = String(data.characterId || '').slice(0, 180);
  const name = String(data.name || 'Выживший').slice(0, 48);
  const alreadyResponded = !!characterId && helpSignal.responderCharacterIds.includes(characterId);
  if (characterId && !helpSignal.responderCharacterIds.includes(characterId)) {
    helpSignal.responderCharacterIds.push(characterId);
  }
  if (name && !helpSignal.responderNames.includes(name)) helpSignal.responderNames.push(name);
  helpSignal.responderCharacterIds = helpSignal.responderCharacterIds.slice(0, 24);
  helpSignal.responderNames = helpSignal.responderNames.slice(0, 8);
  activity.helpSignal = helpSignal;
  const participantAdded = recordWorldActivityParticipant(activity, {
    ...data,
    joinedVia: 'help_signal',
    joinedAt: now,
    lastActiveAt: now
  });
  const changed = !alreadyResponded || participantAdded;
  if (changed) activity.revision += 1;
  return { ok: true, changed, helpSignal: { ...helpSignal } };
}

function requestWorldActivityRally(activity, data = {}) {
  if (!activity || activity.status !== 'completed' || activity.result?.grade === 'failed') {
    return { ok: false, error: 'Продолжить можно только после успешной вылазки.' };
  }
  const now = Math.max(activity.completedAt || activity.startedAt, Number(data.now || Date.now()));
  const characterId = String(data.characterId || '').slice(0, 180);
  const participated = activity.participants.some(row => characterId
    ? row.characterId === characterId
    : row.userId && row.userId === String(data.userId || ''));
  if (!participated) return { ok: false, error: 'Персонаж не состоял во временном отряде.' };
  const rally = normalizeRally(activity.rally, now) || normalizeRally({
    createdAt: now,
    expiresAt: now + 60000,
    nextTaskId: data.nextTaskId,
    voterCharacterIds: [],
    voterNames: []
  }, now);
  if (!rally) return { ok: false, error: 'Время сбора отряда истекло.' };
  if (!rally.nextTaskId && data.nextTaskId) rally.nextTaskId = safeId(data.nextTaskId);
  if (characterId && !rally.voterCharacterIds.includes(characterId)) rally.voterCharacterIds.push(characterId);
  const name = String(data.name || 'Выживший').slice(0, 48);
  if (name && !rally.voterNames.includes(name)) rally.voterNames.push(name);
  rally.voterCharacterIds = rally.voterCharacterIds.slice(0, 24);
  rally.voterNames = rally.voterNames.slice(0, 8);
  activity.rally = rally;
  activity.revision += 1;
  return {
    ok: true,
    nextTaskId: rally.nextTaskId,
    voteCount: rally.voterCharacterIds.length,
    ready: rally.voterCharacterIds.length >= Math.min(2, Math.max(1, activity.participants.length)),
    rally: { ...rally }
  };
}

function applyWorldActivityHarvest(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return { changed: false, reason: 'inactive' };
  if (activity.kind !== WORLD_ACTIVITY_KIND_RESOURCE_EXPEDITION) return { changed: false, reason: 'wrong_kind' };
  const itemId = safeId(data.itemId);
  if (activity.allowedItemIds.length && !activity.allowedItemIds.includes(itemId)) return { changed: false, reason: 'wrong_resource' };
  const objective = activity.objectives.find(row => row.id === 'resources');
  if (!objective) return { changed: false, reason: 'missing_objective' };
  const qty = Math.max(0, Math.floor(Number(data.qty || 0)));
  if (qty <= 0 || objective.current >= objective.maxTarget) return { changed: false, reason: 'no_progress' };
  const previousTier = activity.threatTier;
  const credited = Math.min(qty, objective.maxTarget - objective.current);
  objective.current += credited;
  objective.status = objective.current >= objective.maxTarget
    ? 'mastered'
    : objective.current >= objective.bonusTarget
      ? 'bonus'
      : objective.current >= objective.target
        ? 'completed'
        : 'active';
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  activity.threat = clamp(activity.threat + credited * 5, 0, 100);
  activity.threatTier = worldActivityThreatTier(activity.threat);
  recordWorldActivityParticipant(activity, {
    ...data,
    contributed: 0,
    joinedAt: now,
    lastActiveAt: now
  });
  const participantKey = String(data.characterId || data.userId || data.socketId || '');
  const participant = activity.participants.find(row => row.key === participantKey);
  if (participant) participant.contributed += credited;
  if (objective.current >= objective.target) {
    activity.status = 'extracting';
    activity.phase = 'extraction';
    activity.extractionOpen = true;
  }
  markWorldActivityProgress(activity, now);
  activity.revision += 1;
  return {
    changed: true,
    credited,
    threatTierAdvanced: activity.threatTier > previousTier,
    previousThreatTier: previousTier,
    threatTier: activity.threatTier,
    extractionOpened: activity.extractionOpen,
    objective: { ...objective }
  };
}

function applyWorldActivityInteraction(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return { changed: false, reason: 'inactive' };
  if (activity.kind === WORLD_ACTIVITY_KIND_ASSAULT_DIVERSION) {
    const pointId = safeId(data.pointId || data.objectivePointId);
    const point = activity.interactionPoints.find(row => row.id === pointId);
    if (!point || point.status !== 'pending') return { changed: false, reason: 'point_unavailable' };
    const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
    const previousTier = activity.threatTier;
    let credited = 0;
    if (!activity.approach) {
      const approach = pointId === 'approach_assault'
        ? 'assault'
        : pointId === 'approach_diversion' ? 'diversion' : '';
      if (!approach) return { changed: false, reason: 'choose_approach' };
      activity.approach = approach;
      point.status = 'completed';
      point.completedAt = now;
      for (const candidate of activity.interactionPoints) {
        if (candidate.id.startsWith('approach_') && candidate.id !== pointId) candidate.status = 'disabled';
        if (candidate.id.startsWith('sabotage_')) candidate.status = approach === 'diversion' ? 'pending' : 'disabled';
      }
      const routeObjective = activity.objectives.find(row => row.id === 'approach');
      const branchObjective = activity.objectives.find(row => row.id === (approach === 'assault' ? 'attackers' : 'sabotage'));
      if (routeObjective) {
        routeObjective.current = 1;
        routeObjective.status = 'mastered';
      }
      if (branchObjective) branchObjective.required = true;
      activity.phase = approach === 'assault' ? 'assaulting' : 'sabotaging';
      activity.threat = approach === 'assault' ? 25 : 0;
      credited = 1;
    } else {
      if (activity.approach !== 'diversion' || !pointId.startsWith('sabotage_')) {
        return { changed: false, reason: 'wrong_approach' };
      }
      const objective = activity.objectives.find(row => row.id === 'sabotage');
      if (!objective || objective.current >= objective.maxTarget) return { changed: false, reason: 'no_progress' };
      point.status = 'completed';
      point.completedAt = now;
      objective.current = Math.min(objective.maxTarget, objective.current + 1);
      objective.status = objective.current >= objective.maxTarget
        ? 'mastered'
        : objective.current >= objective.bonusTarget
          ? 'bonus'
          : objective.current >= objective.target ? 'completed' : 'active';
      activity.threat = clamp(activity.threat + 15, 0, 100);
      credited = 1;
    }
    activity.threatTier = worldActivityThreatTier(activity.threat);
    recordWorldActivityParticipant(activity, {
      ...data,
      contributed: 0,
      joinedAt: now,
      lastActiveAt: now
    });
    const participantKey = String(data.characterId || data.userId || data.socketId || '');
    const participant = activity.participants.find(row => row.key === participantKey);
    if (participant) participant.contributed += credited;
    const requiredComplete = activity.objectives
      .filter(row => row.required)
      .every(row => row.current >= row.target);
    if (requiredComplete) {
      activity.status = 'extracting';
      activity.phase = 'extraction';
      activity.extractionOpen = true;
    }
    markWorldActivityProgress(activity, now);
    activity.revision += 1;
    return {
      changed: true,
      pointId,
      approach: activity.approach,
      threatTierAdvanced: activity.threatTier > previousTier,
      previousThreatTier: previousTier,
      threatTier: activity.threatTier,
      extractionOpened: activity.extractionOpen
    };
  }
  const recon = activity.kind === WORLD_ACTIVITY_KIND_RECON_EXPEDITION;
  const distress = activity.kind === WORLD_ACTIVITY_KIND_DISTRESS_SIGNAL;
  if (!recon && !distress) return { changed: false, reason: 'wrong_kind' };
  const pointId = safeId(data.pointId || data.objectivePointId);
  const point = activity.interactionPoints.find(row => row.id === pointId);
  if (!point || point.status === 'completed') return { changed: false, reason: 'point_unavailable' };
  const objective = activity.objectives.find(row => row.id === (distress ? 'distress_signal' : 'recon_points'));
  if (!objective || objective.current >= objective.maxTarget) return { changed: false, reason: 'no_progress' };
  const previousTier = activity.threatTier;
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  point.status = 'completed';
  point.completedAt = now;
  objective.current = Math.min(objective.maxTarget, objective.current + 1);
  objective.status = objective.current >= objective.maxTarget
    ? 'mastered'
    : objective.current >= objective.bonusTarget
      ? 'bonus'
      : objective.current >= objective.target
        ? 'completed'
        : 'active';
  activity.threat = clamp(activity.threat + (distress ? 25 : 10), 0, 100);
  activity.threatTier = worldActivityThreatTier(activity.threat);
  if (distress && objective.current >= objective.target) activity.phase = 'ambush';
  recordWorldActivityParticipant(activity, {
    ...data,
    contributed: 0,
    joinedAt: now,
    lastActiveAt: now
  });
  const participantKey = String(data.characterId || data.userId || data.socketId || '');
  const participant = activity.participants.find(row => row.key === participantKey);
  if (participant) participant.contributed += 1;
  const requiredComplete = activity.objectives
    .filter(row => row.required)
    .every(row => row.current >= row.target);
  if (requiredComplete) {
    activity.status = 'extracting';
    activity.phase = 'extraction';
    activity.extractionOpen = true;
  }
  markWorldActivityProgress(activity, now);
  activity.revision += 1;
  return {
    changed: true,
    pointId,
    threatTierAdvanced: activity.threatTier > previousTier,
    previousThreatTier: previousTier,
    threatTier: activity.threatTier,
    extractionOpened: activity.extractionOpen,
    objective: { ...objective }
  };
}

function applyWorldActivityEnemyKill(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return { changed: false, reason: 'inactive' };
  const assaultOperation = activity.kind === WORLD_ACTIVITY_KIND_ASSAULT_DIVERSION && activity.approach === 'assault';
  if (![WORLD_ACTIVITY_KIND_OUTPOST_DEFENSE, WORLD_ACTIVITY_KIND_DISTRESS_SIGNAL].includes(activity.kind)
    && !assaultOperation) {
    return { changed: false, reason: 'wrong_kind' };
  }
  const enemyId = safeId(data.enemyId || data.entityId);
  if (!enemyId || activity.creditedEntityIds.includes(enemyId)) return { changed: false, reason: 'already_credited' };
  const objective = activity.objectives.find(row => row.id === 'attackers');
  if (!objective || objective.current >= objective.maxTarget) return { changed: false, reason: 'no_progress' };
  const previousTier = activity.threatTier;
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  activity.creditedEntityIds.push(enemyId);
  activity.creditedEntityIds = activity.creditedEntityIds.slice(-64);
  objective.current = Math.min(objective.maxTarget, objective.current + 1);
  objective.status = objective.current >= objective.maxTarget
    ? 'mastered'
    : objective.current >= objective.bonusTarget
      ? 'bonus'
      : objective.current >= objective.target
        ? 'completed'
        : 'active';
  activity.threat = clamp(activity.threat + 25, 0, 100);
  activity.threatTier = worldActivityThreatTier(activity.threat);
  const participantKey = String(data.characterId || data.userId || data.socketId || '');
  if (participantKey) {
    recordWorldActivityParticipant(activity, {
      ...data,
      contributed: 0,
      joinedAt: now,
      lastActiveAt: now
    });
    const participant = activity.participants.find(row => row.key === participantKey);
    if (participant) participant.contributed += 1;
  }
  const requiredComplete = activity.objectives
    .filter(row => row.required)
    .every(row => row.current >= row.target);
  if (requiredComplete) {
    activity.status = 'extracting';
    activity.phase = 'extraction';
    activity.extractionOpen = true;
  }
  markWorldActivityProgress(activity, now);
  activity.revision += 1;
  return {
    changed: true,
    enemyId,
    threatTierAdvanced: activity.threatTier > previousTier,
    previousThreatTier: previousTier,
    threatTier: activity.threatTier,
    extractionOpened: activity.extractionOpen,
    objective: { ...objective }
  };
}

function tickWorldActivity(activity, now = Date.now()) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return { changed: false, expired: false };
  const tickAt = Math.max(activity.lastTickAt, Number(now || Date.now()));
  const elapsedMs = Math.max(0, tickAt - activity.lastTickAt);
  const previousTier = activity.threatTier;
  const previousThreat = activity.threat;
  const hadHelpSignal = !!activity.helpSignal;
  const previousPingCount = Array.isArray(activity.pings) ? activity.pings.length : 0;
  activity.helpSignal = normalizeHelpSignal(activity.helpSignal, tickAt);
  activity.pings = (Array.isArray(activity.pings) ? activity.pings : [])
    .map((row, index) => normalizeWorldActivityPing(row, index, tickAt))
    .filter(Boolean);
  activity.lastTickAt = tickAt;
  if (elapsedMs > 0) {
    activity.threat = clamp(activity.threat + elapsedMs / 30000, 0, 100);
    activity.threatTier = worldActivityThreatTier(activity.threat);
  }
  if (tickAt >= activity.endsAt) {
    activity.status = 'failed';
    activity.phase = 'failed';
    activity.extractionOpen = false;
    activity.completedAt = tickAt;
    activity.result = { grade: 'failed', reason: 'time_expired' };
    markWorldActivityProgress(activity, tickAt);
    activity.revision += 1;
    return { changed: true, expired: true, threatTierAdvanced: activity.threatTier > previousTier, previousThreatTier: previousTier, threatTier: activity.threatTier };
  }
  const changed = Math.abs(activity.threat - previousThreat) >= 0.01
    || activity.threatTier !== previousTier
    || (hadHelpSignal && !activity.helpSignal)
    || activity.pings.length !== previousPingCount;
  if (changed) activity.revision += 1;
  return { changed, expired: false, threatTierAdvanced: activity.threatTier > previousTier, previousThreatTier: previousTier, threatTier: activity.threatTier };
}

function extractWorldActivity(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return { ok: false, error: 'Активность уже завершена.' };
  const objectives = activity.objectives.filter(row => row.required);
  if (!activity.extractionOpen || !objectives.length || objectives.some(row => row.current < row.target)) {
    return { ok: false, error: 'Сначала выполните основную цель.' };
  }
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  recordWorldActivityParticipant(activity, { ...data, joinedAt: now, lastActiveAt: now });
  const grade = objectives.every(row => row.current >= row.maxTarget)
    ? 'mastered'
    : objectives.every(row => row.current >= row.bonusTarget)
      ? 'bonus'
      : 'completed';
  const objectiveCurrent = objectives.reduce((sum, row) => sum + row.current, 0);
  activity.status = 'completed';
  activity.phase = 'completed';
  activity.extractionOpen = false;
  activity.helpSignal = null;
  activity.pings = [];
  activity.rally = normalizeRally({
    createdAt: now,
    expiresAt: now + 60000,
    nextTaskId: '',
    voterCharacterIds: [],
    voterNames: []
  }, now);
  activity.completedAt = now;
  activity.result = {
    grade,
    extractedBy: String(data.characterId || data.userId || '').slice(0, 180),
    objectiveCurrent,
    threat: Math.round(activity.threat)
  };
  markWorldActivityProgress(activity, now);
  activity.revision += 1;
  return { ok: true, grade, result: { ...activity.result } };
}

function publicWorldActivity(activity) {
  if (!activity) return null;
  const now = Date.now();
  const helpSignal = normalizeHelpSignal(activity.helpSignal, now);
  const rally = normalizeRally(activity.rally, now);
  const squadMembers = activity.participants.slice(0, 24).map(participant => ({
    name: participant.name,
    contributed: participant.contributed,
    joinedVia: participant.joinedVia,
    downed: participant.downed === true,
    downedUntil: participant.downed === true ? participant.downedUntil : 0
  }));
  return {
    schema: WORLD_ACTIVITY_SCHEMA,
    id: activity.id,
    kind: activity.kind,
    taskId: activity.taskId,
    roomId: activity.roomId,
    locationId: activity.locationId,
    siteId: activity.siteId,
    title: activity.title,
    status: activity.status,
    phase: activity.phase,
    startedAt: activity.startedAt,
    endsAt: activity.endsAt,
    threat: Math.round(activity.threat),
    threatTier: activity.threatTier,
    objectives: activity.objectives.map(objective => ({ ...objective })),
    extractionOpen: activity.extractionOpen,
    participantCount: activity.participants.length,
    participantNames: uniqueStrings(activity.participants.map(row => row.name), 8, 48),
    squad: {
      id: `activity_squad_${activity.id}`,
      temporary: true,
      recommendedSize: 8,
      memberCount: activity.participants.length,
      sharedObjectives: true,
      sharedRewards: true,
      members: squadMembers
    },
    helpSignal: helpSignal ? {
      active: true,
      requestedByName: helpSignal.requestedByName,
      message: helpSignal.message,
      requestedAt: helpSignal.requestedAt,
      expiresAt: helpSignal.expiresAt,
      responderCount: helpSignal.responderCharacterIds.length,
      responderNames: helpSignal.responderNames
    } : null,
    pings: (Array.isArray(activity.pings) ? activity.pings : [])
      .map((ping, index) => normalizeWorldActivityPing(ping, index, now))
      .filter(Boolean)
      .map(ping => {
        const { ownerKey: _ownerKey, ...publicPing } = ping;
        return publicPing;
      }),
    rally: rally ? {
      active: true,
      expiresAt: rally.expiresAt,
      nextTaskId: rally.nextTaskId,
      voteCount: rally.voterCharacterIds.length,
      voterNames: rally.voterNames,
      ready: rally.voterCharacterIds.length >= Math.min(2, Math.max(1, activity.participants.length))
    } : null,
    interactionPoints: activity.interactionPoints.map(point => ({ id: point.id, label: point.label, x: point.x, z: point.z, status: point.status })),
    approach: activity.approach,
    encounter: activity.encounter ? {
      schema: String(activity.encounter.schema || '').slice(0, 64),
      focus: {
        x: Number(Number(activity.encounter.focus?.x || 0).toFixed(2)),
        z: Number(Number(activity.encounter.focus?.z || 0).toFixed(2)),
        radius: clamp(Number(activity.encounter.focus?.radius || 8), 4, 80)
      },
      lanes: (Array.isArray(activity.encounter.lanes) ? activity.encounter.lanes : []).map(lane => ({
        id: String(lane.id || '').slice(0, 24),
        label: String(lane.label || '').slice(0, 32),
        x: Number(Number(lane.x || 0).toFixed(2)),
        z: Number(Number(lane.z || 0).toFixed(2))
      })),
      activeLaneId: String(activity.encounter.activeLaneId || '').slice(0, 24),
      waveNumber: Math.max(0, Math.floor(Number(activity.encounter.waveNumber || 0))),
      waveCount: clamp(Math.floor(Number(activity.encounter.waveCount || 3)), 1, 4),
      revision: Math.max(1, Math.floor(Number(activity.encounter.revision || 1)))
    } : null,
    director: activity.director ? {
      schema: String(activity.director.schema || '').slice(0, 64),
      cue: String(activity.director.cue || '').slice(0, 48),
      warning: String(activity.director.warning || '').slice(0, 32),
      stalled: activity.director.stalled === true,
      recoveryCount: Math.max(0, Math.floor(Number(activity.director.recoveryCount || 0))),
      updatedAt: Math.max(0, Number(activity.director.updatedAt || 0))
    } : null,
    revision: activity.revision,
    result: activity.result ? {
      grade: String(activity.result.grade || '').slice(0, 24),
      objectiveCurrent: Math.max(0, Math.floor(Number(activity.result.objectiveCurrent || 0))),
      threat: clamp(Math.round(Number(activity.result.threat || 0)), 0, 100),
      reason: String(activity.result.reason || '').slice(0, 48)
    } : null,
    completedAt: activity.completedAt
  };
}

function worldActivityRewardCharacterIds(activity) {
  return uniqueStrings((activity?.participants || []).map(row => row.characterId), 24, 180);
}

module.exports = {
  WORLD_ACTIVITY_SCHEMA,
  WORLD_ACTIVITY_KIND_RESOURCE_EXPEDITION,
  WORLD_ACTIVITY_KIND_RECON_EXPEDITION,
  WORLD_ACTIVITY_KIND_OUTPOST_DEFENSE,
  WORLD_ACTIVITY_KIND_DISTRESS_SIGNAL,
  WORLD_ACTIVITY_KIND_ASSAULT_DIVERSION,
  createResourceExpedition,
  createReconExpedition,
  createOutpostDefense,
  createDistressSignal,
  createAssaultDiversion,
  normalizeWorldActivity,
  publicWorldActivity,
  recordWorldActivityParticipant,
  requestWorldActivityHelp,
  recordWorldActivityHelpResponse,
  requestWorldActivityRally,
  createWorldActivityPing,
  setWorldActivityParticipantDowned,
  applyWorldActivityHarvest,
  applyWorldActivityInteraction,
  applyWorldActivityEnemyKill,
  tickWorldActivity,
  extractWorldActivity,
  worldActivityThreatTier,
  worldActivityRewardCharacterIds
};
