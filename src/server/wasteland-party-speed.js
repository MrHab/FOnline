'use strict';

const { factionGroup } = require('./wasteland-factions');
const { clamp } = require('./wasteland-sim-utils');

const WORLD_PARTY_SPEED_PROFILE_VERSION = 2;
const WORLD_PARTY_SPEED_MULTIPLIER = 1.45;
const CARAVAN_MIN_SPEED_KMH = 4;
const WORLD_PARTY_SPEED_FLOORS = Object.freeze({
  caravan: 26,
  support: 30,
  patrol: 36,
  raider: 34,
  monster: 32,
  default: 28
});
const WORLD_PARTY_SPEED_CAPS = Object.freeze({
  caravan: 42,
  support: 42,
  patrol: 54,
  raider: 52,
  monster: 48,
  default: 50
});

function worldPartySpeedKind(party = {}, defaults = {}) {
  const kind = String(party.kind || defaults.kind || '').toLowerCase();
  const faction = factionGroup(party.faction || defaults.faction || '');
  if (kind === 'support') return 'support';
  if (kind === 'patrol') return 'patrol';
  if (kind === 'raider' || faction === 'raiders') return 'raider';
  if (kind === 'monster' || faction === 'wild' || faction === 'mutants') return 'monster';
  if (kind === 'caravan') return 'caravan';
  return 'default';
}

function worldPartyMinimumSpeedKmh(party = {}, defaults = {}) {
  const kind = String(party.kind || defaults.kind || '').toLowerCase();
  return kind === 'caravan' ? CARAVAN_MIN_SPEED_KMH : 1;
}

function boostedWorldPartySpeedKmh(baseSpeed = 20, party = {}, defaults = {}) {
  const kind = worldPartySpeedKind(party, defaults);
  const raw = Number.isFinite(Number(baseSpeed)) ? Number(baseSpeed) : Number(defaults.speedKmh || 20);
  const floor = Number(WORLD_PARTY_SPEED_FLOORS[kind] || WORLD_PARTY_SPEED_FLOORS.default);
  const cap = Number(WORLD_PARTY_SPEED_CAPS[kind] || WORLD_PARTY_SPEED_CAPS.default);
  return clamp(Math.max(raw * WORLD_PARTY_SPEED_MULTIPLIER, floor), worldPartyMinimumSpeedKmh(party, defaults), cap);
}

function effectiveWorldPartySpeedKmh(party = {}, defaults = {}) {
  const kind = worldPartySpeedKind(party, defaults);
  const cap = Number(WORLD_PARTY_SPEED_CAPS[kind] || WORLD_PARTY_SPEED_CAPS.default);
  const raw = Number.isFinite(Number(party.speedKmh))
    ? Number(party.speedKmh)
    : Number(defaults.speedKmh || 20);
  return clamp(raw, worldPartyMinimumSpeedKmh(party, defaults), cap);
}

function normalizeWorldPartySpeedKmh(party = {}, defaults = {}) {
  const raw = Number.isFinite(Number(party.speedKmh))
    ? Number(party.speedKmh)
    : Number(defaults.speedKmh || 20);
  const kind = worldPartySpeedKind(party, defaults);
  const cap = Number(WORLD_PARTY_SPEED_CAPS[kind] || WORLD_PARTY_SPEED_CAPS.default);
  const minimum = worldPartyMinimumSpeedKmh(party, defaults);
  if (Number(party.speedProfileVersion || 0) >= WORLD_PARTY_SPEED_PROFILE_VERSION) {
    return clamp(raw, minimum, cap);
  }
  const base = Number.isFinite(Number(party.baseSpeedKmh))
    ? Number(party.baseSpeedKmh)
    : Number(defaults.baseSpeedKmh || defaults.speedKmh || raw || 20);
  return Math.max(clamp(raw, minimum, cap), boostedWorldPartySpeedKmh(base, party, defaults));
}

module.exports = {
  CARAVAN_MIN_SPEED_KMH,
  WORLD_PARTY_SPEED_PROFILE_VERSION,
  boostedWorldPartySpeedKmh,
  effectiveWorldPartySpeedKmh,
  normalizeWorldPartySpeedKmh,
  worldPartyMinimumSpeedKmh,
  worldPartySpeedKind
};
