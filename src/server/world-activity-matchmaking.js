'use strict';

const QUICK_WORLD_ACTIVITY_TYPES = new Set([
  'distress_signal',
  'recon_expedition',
  'resource_expedition',
  'outpost_defense',
  'assault_diversion'
]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function taskPoint(task = {}) {
  const details = task.details && typeof task.details === 'object' ? task.details : {};
  const x = number(task.targetX ?? details.x, Number.NaN);
  const y = number(task.targetY ?? details.y, Number.NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function helpSignalForTask(task = {}, now = Date.now()) {
  const signal = task.liveEvent?.helpSignal || task.details?.helpSignal || null;
  if (!signal || signal.active === false) return null;
  const expiresAt = Math.max(0, number(signal.expiresAt));
  if (expiresAt > 0 && expiresAt <= now) return null;
  return signal;
}

function quickWorldActivityScore(task = {}, options = {}) {
  const accepted = new Set(Array.isArray(options.acceptedTaskIds) ? options.acceptedTaskIds.map(String) : []);
  const id = String(task.id || '');
  const liveEvent = task.liveEvent && typeof task.liveEvent === 'object' ? task.liveEvent : {};
  const community = liveEvent.community && typeof liveEvent.community === 'object' ? liveEvent.community : {};
  let score = number(task.priority) * 10000;
  if (accepted.has(id)) score += 2000000;
  if (helpSignalForTask(task, options.now)) score += 1000000;
  const participants = Math.max(0, Math.floor(number(community.participantCount ?? task.participantCount)));
  if (participants > 0) score += 200000 + Math.min(8, participants) * 5000;
  if (String(liveEvent.stage || '') === 'active') score += 30000;
  else if (String(liveEvent.stage || '') === 'preparation') score += 15000;
  const point = taskPoint(task);
  if (point && Number.isFinite(number(options.playerX, Number.NaN)) && Number.isFinite(number(options.playerY, Number.NaN))) {
    score -= Math.hypot(point.x - number(options.playerX), point.y - number(options.playerY)) * 120;
  }
  const worldHour = number(options.worldHour, Number.NaN);
  const expiresHour = number(task.expiresHour, Number.NaN);
  if (Number.isFinite(worldHour) && Number.isFinite(expiresHour)) {
    const hoursLeft = Math.max(0, expiresHour - worldHour);
    score += Math.max(0, 8 - hoursLeft) * 12000;
  }
  return score;
}

function selectQuickWorldActivityTask(rows = [], options = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter(task => task
      && task.status === 'active'
      && QUICK_WORLD_ACTIVITY_TYPES.has(String(task.type || ''))
      && (task.siteId || task.details?.locationId))
    .sort((left, right) => {
      const delta = quickWorldActivityScore(right, options) - quickWorldActivityScore(left, options);
      if (Math.abs(delta) > 0.001) return delta;
      return String(left.id || '').localeCompare(String(right.id || ''));
    })[0] || null;
}

function roomWorldActivityScore(task = {}, players = [], now = Date.now()) {
  const id = String(task.id || '');
  let acceptedCount = 0;
  let trackedCount = 0;
  for (const player of Array.isArray(players) ? players : []) {
    const accepted = new Set(Array.isArray(player?.worldTaskAccepted)
      ? player.worldTaskAccepted.map(String)
      : []);
    if (!accepted.has(id)) continue;
    acceptedCount += 1;
    if (String(player?.worldTaskTrackedId || '') === id) trackedCount += 1;
  }
  let score = number(task.priority) * 10000;
  score += acceptedCount * 200000;
  score += trackedCount * 5000000;
  if (helpSignalForTask(task, now)) score += 1000000;
  return score;
}

/**
 * Select the operation that should materialize in an entered world-site room.
 * A player's tracked operation always wins over older accepted tasks at the
 * same site; this keeps global-map arrival and room gameplay deterministic.
 */
function selectRoomWorldActivityTask(rows = [], players = [], options = {}) {
  const now = number(options.now, Date.now());
  return (Array.isArray(rows) ? rows : [])
    .filter(task => task && task.status === 'active'
      && QUICK_WORLD_ACTIVITY_TYPES.has(String(task.type || '')))
    .sort((left, right) => {
      const delta = roomWorldActivityScore(right, players, now)
        - roomWorldActivityScore(left, players, now);
      if (Math.abs(delta) > 0.001) return delta;
      return String(left.id || '').localeCompare(String(right.id || ''));
    })[0] || null;
}

module.exports = {
  QUICK_WORLD_ACTIVITY_TYPES,
  helpSignalForTask,
  quickWorldActivityScore,
  selectQuickWorldActivityTask,
  roomWorldActivityScore,
  selectRoomWorldActivityTask
};
