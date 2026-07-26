'use strict';

function finiteTimestamp(value, fallback = 0) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function resolveEphemeralRoomIdleTtlMs(options = {}) {
  const configuredTtlMs = Number(options.configuredTtlMs);
  const sessionLockMs = Number(options.sessionLockMs);
  const defaultTtlMs = finiteTimestamp(options.defaultTtlMs, 15 * 60 * 1000);
  const minimumTtlMs = finiteTimestamp(options.minimumTtlMs, 4 * 60 * 1000);
  return Math.max(
    minimumTtlMs,
    Number.isFinite(sessionLockMs) && sessionLockMs > 0 ? sessionLockMs * 2 : 0,
    Number.isFinite(configuredTtlMs) && configuredTtlMs > 0 ? configuredTtlMs : defaultTtlMs
  );
}

function temporaryRoomContextIsResumable(options = {}) {
  if (options.temporaryLocation !== true) return true;
  if (!String(options.roomId || '')) return false;
  const worldZoneId = String(options.worldZoneId || '');
  if (worldZoneId) return !!options.activeWorldZone;
  return options.roomExists === true;
}

function pruneIdleRooms(rooms, options = {}) {
  if (!(rooms instanceof Map)) throw new TypeError('rooms must be a Map');
  const now = finiteTimestamp(options.now, Date.now());
  const idleTtlMs = Math.max(0, Number(options.idleTtlMs) || 0);
  const shouldPruneRoom = typeof options.shouldPruneRoom === 'function'
    ? options.shouldPruneRoom
    : () => false;
  const hasActiveOwner = typeof options.hasActiveOwner === 'function'
    ? options.hasActiveOwner
    : () => false;
  const removed = [];

  for (const [roomId, room] of rooms.entries()) {
    if (!room || Number(room.sockets?.size || 0) > 0) continue;
    if (shouldPruneRoom(room) !== true || hasActiveOwner(room) === true) continue;
    const idleSince = finiteTimestamp(room.emptySince, finiteTimestamp(room.createdAt, now));
    if (now - idleSince < idleTtlMs) continue;
    if (!rooms.delete(roomId)) continue;
    removed.push(String(roomId));
  }

  return removed;
}

module.exports = {
  pruneIdleRooms,
  resolveEphemeralRoomIdleTtlMs,
  temporaryRoomContextIsResumable
};
