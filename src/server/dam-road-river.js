'use strict';

const profile = require('../../data/kromka/dam-road-river-profile.json');

function banksAt(z) {
  if (!Number.isFinite(z) || Math.abs(z) > profile.depth * 0.5) return null;
  const index = (z / profile.depth + 0.5) * profile.segments;
  const low = Math.max(0, Math.min(profile.segments, Math.floor(index)));
  const high = Math.min(profile.segments, low + 1);
  const blend = index - low;
  return {
    center: profile.centers[low] * (1 - blend) + profile.centers[high] * blend,
    halfWidth: profile.halfWidths[low] * (1 - blend) + profile.halfWidths[high] * blend
  };
}

function isWaterAt(x, z, radius = 0) {
  const banks = banksAt(z);
  if (!banks || !Number.isFinite(x)) return false;
  const clearance = Math.max(0, Number(radius) || 0);
  if (Math.abs(x - profile.bridge.x) + clearance <= profile.bridge.halfWidth
    && Math.abs(z - profile.bridge.z) + clearance <= profile.bridge.halfDepth) return false;
  return Math.abs(x - banks.center) <= banks.halfWidth + clearance;
}

function crossesWater(fromX, fromZ, toX, toZ, radius = 0) {
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(distance / 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isWaterAt(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t, radius)) return true;
  }
  return false;
}

function paintWaterTiles(map, tileSize = 2, waterType = 3) {
  const depth = map.length;
  const width = map[0]?.length || 0;
  let count = 0;
  for (let tz = 0; tz < depth; tz++) {
    const z = (tz - depth / 2 + 0.5) * tileSize;
    const banks = banksAt(z);
    if (!banks) continue;
    for (let tx = 0; tx < width; tx++) {
      const x = (tx - width / 2 + 0.5) * tileSize;
      if (!isWaterAt(x, z)) continue;
      map[tz][tx] = waterType;
      count++;
    }
  }
  return count;
}

module.exports = { profile, banksAt, isWaterAt, crossesWater, paintWaterTiles };
