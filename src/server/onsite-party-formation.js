'use strict';

const ONSITE_PARTY_LANE_SPACING = 1.42;
const ONSITE_PARTY_WORK_SLOTS = Object.freeze([
  Object.freeze({ lateral: 0, depth: -1.8 }),
  Object.freeze({ lateral: -2.15, depth: -2.55 }),
  Object.freeze({ lateral: 2.15, depth: -2.55 }),
  Object.freeze({ lateral: -3.15, depth: -4.45 }),
  Object.freeze({ lateral: 0, depth: -4.75 }),
  Object.freeze({ lateral: 3.15, depth: -4.45 }),
  Object.freeze({ lateral: 0, depth: -6.8 })
]);

function formationIndex(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function onsitePartyLaneOffset(index = 0, spacing = ONSITE_PARTY_LANE_SPACING) {
  const slot = formationIndex(index);
  if (slot === 0) return 0;
  const magnitude = Math.ceil(slot / 2);
  const side = slot % 2 === 1 ? -1 : 1;
  return side * magnitude * Math.max(0.8, Number(spacing) || ONSITE_PARTY_LANE_SPACING);
}

function onsitePartyWorkOffset(index = 0) {
  const slot = formationIndex(index);
  if (slot < ONSITE_PARTY_WORK_SLOTS.length) return { ...ONSITE_PARTY_WORK_SLOTS[slot] };

  const overflow = slot - ONSITE_PARTY_WORK_SLOTS.length;
  const row = Math.floor(overflow / 4);
  const column = overflow % 4;
  return {
    lateral: -4.2 + column * 2.8 + (row % 2 ? 0.7 : 0),
    depth: -8.9 - row * 2.25
  };
}

function finitePoint(point = null) {
  return {
    x: Number.isFinite(Number(point?.x)) ? Number(point.x) : 0,
    z: Number.isFinite(Number(point?.z)) ? Number(point.z) : 0
  };
}

function orientOnsitePartyOffset(basePoint = null, approachPoint = null, offset = null) {
  const base = finitePoint(basePoint);
  const approach = finitePoint(approachPoint);
  const lateral = Number.isFinite(Number(offset?.lateral)) ? Number(offset.lateral) : 0;
  const depth = Number.isFinite(Number(offset?.depth)) ? Number(offset.depth) : 0;
  let forwardX = base.x - approach.x;
  let forwardZ = base.z - approach.z;
  let length = Math.hypot(forwardX, forwardZ);
  if (length < 0.001) {
    forwardX = 0;
    forwardZ = 1;
    length = 1;
  }
  forwardX /= length;
  forwardZ /= length;
  const rightX = forwardZ;
  const rightZ = -forwardX;
  return {
    x: base.x + rightX * lateral + forwardX * depth,
    z: base.z + rightZ * lateral + forwardZ * depth
  };
}

module.exports = {
  ONSITE_PARTY_LANE_SPACING,
  onsitePartyLaneOffset,
  onsitePartyWorkOffset,
  orientOnsitePartyOffset
};
