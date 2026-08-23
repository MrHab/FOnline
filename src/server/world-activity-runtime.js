'use strict';

const WORLD_ACTIVITY_SCHEMA = 'realm.worldActivity.v1';
const WORLD_ACTIVITY_KIND_RESOURCE_EXPEDITION = 'resource_expedition';
const WORLD_ACTIVITY_KIND_RECON_EXPEDITION = 'recon_expedition';
const WORLD_ACTIVITY_ACTIVE_STATUSES = new Set(['active', 'extracting']);

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
  const status = String(row.status || '').toLowerCase() === 'completed' ? 'completed' : 'pending';
  return {
    id: safeId(row.id, `point_${index + 1}`),
    label: String(row.label || `Точка наблюдения ${index + 1}`).slice(0, 80),
    x: Number(Number(row.x || 0).toFixed(2)),
    z: Number(Number(row.z || 0).toFixed(2)),
    status,
    completedAt: status === 'completed' ? Math.max(0, Number(row.completedAt || 0)) : 0
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
    contributed: Math.max(0, Math.floor(Number(row.contributed || 0))),
    joinedAt: Math.max(0, Number(row.joinedAt || Date.now())),
    lastActiveAt: Math.max(0, Number(row.lastActiveAt || row.joinedAt || Date.now()))
  };
}

function worldActivityThreatTier(threat = 0) {
  const value = clamp(threat, 0, 100);
  if (value >= 75) return 3;
  if (value >= 50) return 2;
  if (value >= 25) return 1;
  return 0;
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
    phase: status === 'active' ? 'scavenging' : status === 'extracting' ? 'extraction' : status,
    startedAt,
    endsAt,
    durationMs,
    lastTickAt: clamp(Number(row.lastTickAt || startedAt), startedAt, Math.max(endsAt, now)),
    threat,
    threatTier: worldActivityThreatTier(threat),
    objectives,
    extractionOpen: status === 'extracting',
    allowedItemIds: uniqueStrings(row.allowedItemIds),
    interactionPoints: (Array.isArray(row.interactionPoints) ? row.interactionPoints : []).slice(0, 8).map(normalizeInteractionPoint),
    participants,
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
  return activity;
}

function recordWorldActivityParticipant(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return false;
  const participant = normalizeParticipant(data, activity.participants.length);
  const index = activity.participants.findIndex(row => row.key === participant.key);
  if (index >= 0) {
    const current = activity.participants[index];
    activity.participants[index] = {
      ...current,
      ...participant,
      contributed: Math.max(current.contributed, participant.contributed),
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
  if (activity.kind !== WORLD_ACTIVITY_KIND_RECON_EXPEDITION) return { changed: false, reason: 'wrong_kind' };
  const pointId = safeId(data.pointId || data.objectivePointId);
  const point = activity.interactionPoints.find(row => row.id === pointId);
  if (!point || point.status === 'completed') return { changed: false, reason: 'point_unavailable' };
  const objective = activity.objectives.find(row => row.id === 'recon_points');
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
  activity.threat = clamp(activity.threat + 10, 0, 100);
  activity.threatTier = worldActivityThreatTier(activity.threat);
  recordWorldActivityParticipant(activity, {
    ...data,
    contributed: 0,
    joinedAt: now,
    lastActiveAt: now
  });
  const participantKey = String(data.characterId || data.userId || data.socketId || '');
  const participant = activity.participants.find(row => row.key === participantKey);
  if (participant) participant.contributed += 1;
  if (objective.current >= objective.target) {
    activity.status = 'extracting';
    activity.phase = 'extraction';
    activity.extractionOpen = true;
  }
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

function tickWorldActivity(activity, now = Date.now()) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return { changed: false, expired: false };
  const tickAt = Math.max(activity.lastTickAt, Number(now || Date.now()));
  const elapsedMs = Math.max(0, tickAt - activity.lastTickAt);
  const previousTier = activity.threatTier;
  const previousThreat = activity.threat;
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
    activity.revision += 1;
    return { changed: true, expired: true, threatTierAdvanced: activity.threatTier > previousTier, previousThreatTier: previousTier, threatTier: activity.threatTier };
  }
  const changed = Math.abs(activity.threat - previousThreat) >= 0.01 || activity.threatTier !== previousTier;
  if (changed) activity.revision += 1;
  return { changed, expired: false, threatTierAdvanced: activity.threatTier > previousTier, previousThreatTier: previousTier, threatTier: activity.threatTier };
}

function extractWorldActivity(activity, data = {}) {
  if (!activity || !WORLD_ACTIVITY_ACTIVE_STATUSES.has(activity.status)) return { ok: false, error: 'Активность уже завершена.' };
  const objective = activity.objectives.find(row => row.required) || activity.objectives[0];
  if (!activity.extractionOpen || !objective || objective.current < objective.target) {
    return { ok: false, error: 'Сначала выполните основную цель.' };
  }
  const now = Math.max(activity.startedAt, Number(data.now || Date.now()));
  recordWorldActivityParticipant(activity, { ...data, joinedAt: now, lastActiveAt: now });
  const grade = objective.current >= objective.maxTarget
    ? 'mastered'
    : objective.current >= objective.bonusTarget
      ? 'bonus'
      : 'completed';
  activity.status = 'completed';
  activity.phase = 'completed';
  activity.extractionOpen = false;
  activity.completedAt = now;
  activity.result = {
    grade,
    extractedBy: String(data.characterId || data.userId || '').slice(0, 180),
    objectiveCurrent: objective.current,
    threat: Math.round(activity.threat)
  };
  activity.revision += 1;
  return { ok: true, grade, result: { ...activity.result } };
}

function publicWorldActivity(activity) {
  if (!activity) return null;
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
    interactionPoints: activity.interactionPoints.map(point => ({ id: point.id, label: point.label, x: point.x, z: point.z, status: point.status })),
    revision: activity.revision,
    result: activity.result ? { ...activity.result } : null,
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
  createResourceExpedition,
  createReconExpedition,
  normalizeWorldActivity,
  publicWorldActivity,
  recordWorldActivityParticipant,
  applyWorldActivityHarvest,
  applyWorldActivityInteraction,
  tickWorldActivity,
  extractWorldActivity,
  worldActivityThreatTier,
  worldActivityRewardCharacterIds
};
