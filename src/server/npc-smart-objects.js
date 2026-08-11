'use strict';

const DEFAULT_SLOT_CAPACITY = 1;
const MAX_SLOT_CAPACITY = 16;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeId(value = '', fallback = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_:-]/g, '_')
    .slice(0, 96);
  return normalized || fallback;
}

function safeType(value = '', fallback = 'sandbox') {
  const normalized = safeId(value, fallback).toLowerCase();
  if (normalized === 'merchant' || normalized === 'trade') return 'shop';
  if (normalized === 'campfire' || normalized === 'rest') return 'social';
  if (normalized === 'workbench' || normalized === 'craft') return 'work';
  if (normalized === 'guardpost') return 'guard';
  return normalized;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePoint(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    x: finiteNumber(source.x, finiteNumber(base.x, 0)),
    y: finiteNumber(source.y, finiteNumber(base.y, 0)),
    z: finiteNumber(source.z, finiteNumber(base.z, 0))
  };
}

function stableHash(value = '') {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function activityVisualAction(type = '') {
  const normalized = safeType(type);
  if (normalized === 'shop') return 'shop';
  if (normalized === 'social') return 'social';
  if (normalized === 'eat') return 'eat';
  if (normalized === 'guard' || normalized === 'patrol') return 'guard';
  if (normalized === 'work') return 'work';
  return 'idle';
}

function normalizeActivitySlot(row = {}, slot = {}, slotIndex = 0) {
  if (!row || typeof row !== 'object' || !slot || typeof slot !== 'object') return null;
  const objectId = safeId(row.id || row.objectId || row.model, `object_${slotIndex + 1}`);
  const type = safeType(slot.type || slot.activity || row.role || 'sandbox');
  const id = safeId(slot.id, `${objectId}:${type}:${slotIndex + 1}`);
  if (!id || !type) return null;
  const rowPosition = normalizePoint(row.position || row);
  const position = normalizePoint(slot.position, rowPosition);
  const rowRotation = row.rotation && typeof row.rotation === 'object' ? row.rotation : {};
  const facing = finiteNumber(slot.facing ?? slot.rotationY, finiteNumber(rowRotation.y, 0));
  return {
    id,
    type,
    objectId,
    capacity: clamp(Math.floor(finiteNumber(slot.capacity, DEFAULT_SLOT_CAPACITY)), 1, MAX_SLOT_CAPACITY),
    ownerNpcId: safeId(slot.ownerNpcId || ''),
    role: safeId(slot.role || '').toLowerCase(),
    faction: safeId(slot.faction || '').toLowerCase(),
    position,
    facing,
    visualAction: safeType(slot.visualAction || activityVisualAction(type), 'idle'),
    tags: (Array.isArray(slot.tags) ? slot.tags : [])
      .map(tag => safeType(tag, ''))
      .filter(Boolean)
      .slice(0, 16)
  };
}

function buildActivitySlotCatalog(location = {}) {
  const rows = Array.isArray(location?.objects) ? location.objects : [];
  const slots = [];
  const ids = new Set();
  for (const row of rows) {
    const authoredSlots = Array.isArray(row?.activitySlots) ? row.activitySlots : [];
    authoredSlots.forEach((source, index) => {
      const slot = normalizeActivitySlot(row, source, index);
      if (!slot || ids.has(slot.id)) return;
      ids.add(slot.id);
      slots.push(slot);
    });
  }
  slots.sort((left, right) => left.id.localeCompare(right.id));
  return slots;
}

function buildActivitySlotIndexes(slots = []) {
  const byId = new Map();
  const byType = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    if (!slot || !slot.id || byId.has(slot.id)) continue;
    byId.set(slot.id, slot);
    if (!byType.has(slot.type)) byType.set(slot.type, []);
    byType.get(slot.type).push(slot);
  }
  return { byId, byType };
}

function npcIdentity(npc = {}) {
  return safeId(npc.npcId || npc.npcProfile?.npcId || npc.npcProfile?.id || npc.id || npc.name, 'npc');
}

function slotAvailableForNpc(slot = {}, npc = {}, target = {}) {
  if (!slot || !slot.id) return false;
  const npcId = npcIdentity(npc);
  const role = safeId(npc.role || npc.encounterRole || '').toLowerCase();
  const faction = safeId(npc.faction || '').toLowerCase();
  const requestedId = safeId(target.slotId || target.id || '');
  const requestedType = safeType(target.slotType || target.type || '', '');
  if (requestedId && slot.id !== requestedId) return false;
  if (requestedType && slot.type !== requestedType) return false;
  if (slot.ownerNpcId && slot.ownerNpcId !== npcId) return false;
  if (slot.role && slot.role !== role) return false;
  if (slot.faction && slot.faction !== faction) return false;
  return true;
}

function reservationSet(reservations, slotId) {
  if (!(reservations instanceof Map)) return new Set();
  const current = reservations.get(slotId);
  if (current instanceof Set) return current;
  const next = new Set();
  reservations.set(slotId, next);
  return next;
}

function releaseActivityReservation(reservations, npcOrId = '') {
  if (!(reservations instanceof Map)) return 0;
  const npcId = typeof npcOrId === 'object' ? safeId(npcOrId.id || npcIdentity(npcOrId)) : safeId(npcOrId);
  if (!npcId) return 0;
  let released = 0;
  for (const [slotId, actors] of reservations) {
    if (!(actors instanceof Set) || !actors.delete(npcId)) continue;
    released += 1;
    if (!actors.size) reservations.delete(slotId);
  }
  return released;
}

function pruneActivityReservations(reservations, actorIsActive = null) {
  if (!(reservations instanceof Map) || typeof actorIsActive !== 'function') return 0;
  let removed = 0;
  for (const [slotId, actors] of reservations) {
    if (!(actors instanceof Set)) {
      reservations.delete(slotId);
      continue;
    }
    for (const actorId of [...actors]) {
      if (actorIsActive(actorId)) continue;
      actors.delete(actorId);
      removed += 1;
    }
    if (!actors.size) reservations.delete(slotId);
  }
  return removed;
}

function reserveActivitySlot(options = {}) {
  const slots = Array.isArray(options.slots) ? options.slots : [];
  const reservations = options.reservations instanceof Map ? options.reservations : new Map();
  const npc = options.npc && typeof options.npc === 'object' ? options.npc : {};
  const actorId = safeId(npc.id || npcIdentity(npc), npcIdentity(npc));
  const identity = npcIdentity(npc);
  const target = options.target && typeof options.target === 'object' ? options.target : {};
  const currentSlotId = safeId(options.currentSlotId || '');
  const slotById = options.slotById instanceof Map ? options.slotById : null;
  const slotsByType = options.slotsByType instanceof Map ? options.slotsByType : null;
  const current = currentSlotId
    ? (slotById ? slotById.get(currentSlotId) : slots.find(slot => slot?.id === currentSlotId))
    : null;
  // Steady state is the hot path. A valid reservation can be reused with two
  // map lookups, without pruning, filtering or sorting the location catalog.
  if (current && slotAvailableForNpc(current, npc, target)) {
    const actors = reservations.get(current.id);
    if (actors instanceof Set && actors.has(actorId)) return current;
    if (!(actors instanceof Set) || actors.size < current.capacity) {
      reservationSet(reservations, current.id).add(actorId);
      return current;
    }
  }
  const requestedId = safeId(target.slotId || target.id || '');
  const requestedType = safeType(target.slotType || target.type || '', '');
  const candidatePool = requestedId && slotById
    ? [slotById.get(requestedId)].filter(Boolean)
    : requestedType && slotsByType
      ? (slotsByType.get(requestedType) || [])
      : slots;
  const candidates = candidatePool.filter(slot => slotAvailableForNpc(slot, npc, target));
  const locationId = safeId(options.locationId || 'location');
  candidates.sort((left, right) => {
    const leftOwned = left.ownerNpcId === identity ? 1 : 0;
    const rightOwned = right.ownerNpcId === identity ? 1 : 0;
    if (leftOwned !== rightOwned) return rightOwned - leftOwned;
    const leftHash = stableHash(`${locationId}:${identity}:${left.id}`);
    const rightHash = stableHash(`${locationId}:${identity}:${right.id}`);
    return leftHash - rightHash || left.id.localeCompare(right.id);
  });
  for (const slot of candidates) {
    const actors = reservationSet(reservations, slot.id);
    if (actors.has(actorId)) return slot;
    if (actors.size >= slot.capacity) continue;
    actors.add(actorId);
    return slot;
  }
  return null;
}

module.exports = {
  buildActivitySlotCatalog,
  buildActivitySlotIndexes,
  normalizeActivitySlot,
  npcIdentity,
  pruneActivityReservations,
  releaseActivityReservation,
  reserveActivitySlot,
  slotAvailableForNpc
};
