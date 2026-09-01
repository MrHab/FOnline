'use strict';

const DEFAULT_PENDING_LOCATION_TRANSITION_TTL_MS = 90 * 1000;

function safeId(value, maxLength = 64) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_:-]/g, '')
    .slice(0, Math.max(1, Number(maxLength) || 64));
}

function safePoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function safeRoomId(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_:#-]/g, '')
    .slice(0, 120);
}

/**
 * Return the small, durable transition ticket that clients may use after a
 * reconnect. Expired or malformed tickets never become valid again merely by
 * being loaded from a save.
 */
function sanitizePendingLocationTransition(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const targetLocationId = safeId(value.targetLocationId || value.locationId, 64);
  const worldPoint = safePoint(value.worldPoint);
  const expiresAt = Math.floor(Number(value.expiresAt || 0));
  if (!targetLocationId || !worldPoint || !Number.isFinite(expiresAt) || expiresAt <= Number(now || 0)) {
    return null;
  }
  return {
    // locationId keeps the browser client's established pendingWorldDrop
    // contract; targetLocationId is the explicit Unity/server contract.
    locationId: targetLocationId,
    targetLocationId,
    roomId: safeRoomId(value.roomId),
    worldZoneId: safeId(value.worldZoneId, 64),
    partyId: safeId(value.partyId, 80),
    siteId: safeId(value.siteId, 64),
    encounterId: safeId(value.encounterId, 64),
    encounter: !!(value.encounter || value.encounterId || value.worldZoneId),
    pvpMode: String(value.pvpMode || 'pvp').slice(0, 24),
    worldPoint,
    entryKey: safeId(value.entryKey || 'entryFromWorld', 32),
    expiresAt
  };
}

/**
 * Stage phase one of a global-map arrival. The player deliberately remains on
 * the world map until changeLocation consumes this ticket and commits phase
 * two, so a lost acknowledgement or reconnect cannot strand the character.
 */
function stagePendingLocationTransition(player, value, now = Date.now(), ttlMs = DEFAULT_PENDING_LOCATION_TRANSITION_TTL_MS) {
  if (!player || typeof player !== 'object') return null;
  const ttl = Math.max(15 * 1000, Math.floor(Number(ttlMs) || DEFAULT_PENDING_LOCATION_TRANSITION_TTL_MS));
  const ticket = sanitizePendingLocationTransition({
    ...(value || {}),
    expiresAt: Number(now || 0) + ttl
  }, now);
  player.pendingLocationTransition = ticket;
  if (ticket) player.onGlobalMap = true;
  return ticket;
}

module.exports = {
  DEFAULT_PENDING_LOCATION_TRANSITION_TTL_MS,
  sanitizePendingLocationTransition,
  stagePendingLocationTransition
};
