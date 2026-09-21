'use strict';

// Movement and line-of-sight blockers of authored location objects.
//
// The Unity client stops a player with the scene's colliders; the server stops
// players, enemies and shots with the oriented boxes built here from the same
// row. A row describes its blockers in one of three ways, most exact first:
//   collisionParts  several boxes in the object's own frame (a yard is five walls
//                   around open ground, a ring is sixteen turned segments);
//   collisionSize   one exact box;
//   footprint       one box rounded to whole tiles, the legacy fallback.
// Kromka scenes export collisionParts (KromkaWorldSceneExporter), so the server
// blocks exactly what the client blocks.

const { transformedBounds } = require('./model-colliders');

// Building-kit blocks are placed on the tile grid and ignore the row's scale.
const MODULE_MODEL_KEYS = new Set([
  'traderWallBlock', 'traderWindowBlock', 'traderFloorSlab', 'traderRoofBlock',
  'wallWoodBlock', 'wallBrickBlock', 'wallMetalBlock',
  'roofWoodBlock', 'roofMetalBlock', 'floorWoodBlock', 'floorTileBlock'
]);

const BLOCKING_COLLISIONS = new Set(['solid', 'block', 'blocked', 'wall', 'resource']);

const PASS_THROUGH_KINDS = new Set([
  'craftingstation', 'jobboard', 'trademachine', 'vendingmachine', 'container', 'storage'
]);

const PASS_THROUGH_TAGS = new Set([
  'interactive', 'crafting-station', 'jobboard', 'questboard', 'trademachine',
  'vendingmachine', 'container', 'storage', 'personal-storage', 'ground-item',
  'loot-item', 'pickup', 'pass-through', 'no-player-collision'
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function locationObjectTags(row = {}) {
  return (Array.isArray(row.tags) ? row.tags : [])
    .map(tag => String(tag || '').trim().toLowerCase())
    .filter(Boolean);
}

function locationObjectIsNpc(row = {}) {
  const entity = row && row.entity && typeof row.entity === 'object' ? row.entity : {};
  const entityKind = String(entity.kind || row.entity || '').trim().toLowerCase();
  return entityKind === 'npc'
    || entityKind === 'enemy'
    || entityKind === 'monster'
    || locationObjectTags(row).some(tag => ['npc', 'enemy', 'monster', 'living', 'friendly', 'guard', 'merchant', 'trader'].includes(tag))
    || /^(enemy|npc|tradernpc|caravanmerchant|caravanguard|klimpatrolguard|wastelandsettler|friendlybrahmin)/i.test(String(row.model || ''));
}

function locationObjectPosition(row = {}) {
  const pos = row.position && typeof row.position === 'object' ? row.position : row;
  return {
    x: Number(pos.x || 0),
    y: Number(pos.y || 0),
    z: Number(pos.z || 0)
  };
}

function locationObjectScale(row = {}) {
  if (MODULE_MODEL_KEYS.has(String(row.model || ''))) return { x: 1, y: 1, z: 1 };
  const scale = row.scale && typeof row.scale === 'object' ? row.scale : {};
  const uniform = Number(row.scale || 1);
  const fallback = Number.isFinite(uniform) ? uniform : 1;
  return {
    x: Number.isFinite(Number(scale.x)) ? Number(scale.x) : fallback,
    y: Number.isFinite(Number(scale.y)) ? Number(scale.y) : fallback,
    z: Number.isFinite(Number(scale.z)) ? Number(scale.z) : fallback
  };
}

function locationObjectRotationY(row = {}) {
  const rotation = row.rotation && typeof row.rotation === 'object' ? row.rotation : {};
  const value = Number(rotation.y ?? row.rotationY ?? (typeof row.rotation === 'number' ? row.rotation : 0));
  return Number.isFinite(value) ? value : 0;
}

function locationObjectOcclusionRole(row = {}) {
  return String(row.occlusion?.role || '').trim().toLowerCase();
}

function locationObjectAllowsPlayerOverlap(row = {}) {
  const explicit = String(row.playerCollision ?? row.movementCollision ?? '').trim().toLowerCase();
  if (row.playerCollision === false || ['none', 'off', 'disabled', 'pass', 'pass-through', 'passthrough'].includes(explicit)) return true;
  const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
  const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
  const kinds = [interactive.kind, entity.kind, row.kind]
    .map(value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter(Boolean);
  const tags = [
    ...locationObjectTags(row),
    ...locationObjectTags(entity),
    ...locationObjectTags(interactive)
  ];
  return kinds.some(kind => PASS_THROUGH_KINDS.has(kind)) || tags.some(tag => PASS_THROUGH_TAGS.has(tag));
}

function collisionBlocksMovement(collision) {
  return BLOCKING_COLLISIONS.has(String(collision || '').trim().toLowerCase());
}

function createLocationCollision({ tile = 2, isNpc = locationObjectIsNpc } = {}) {
  function locationObjectBlocksMovement(row = {}) {
    if (isNpc(row)) return false;
    const tags = locationObjectTags(row);
    const role = locationObjectOcclusionRole(row);
    if (role === 'roof' || role === 'floor' || tags.includes('roof') || tags.includes('floor')) return false;
    if (locationObjectAllowsPlayerOverlap(row)) return false;
    return collisionBlocksMovement(String(row.collision || '').toLowerCase());
  }

  function locationObjectFootprintCells(row = {}) {
    const placement = row.placement && typeof row.placement === 'object' ? row.placement : {};
    const cells = placement.cells && typeof placement.cells === 'object' ? placement.cells : {};
    const footprint = row.footprint && typeof row.footprint === 'object' ? row.footprint : {};
    const scale = row.scale && typeof row.scale === 'object' ? row.scale : {};
    const lockedModule = MODULE_MODEL_KEYS.has(String(row.model || ''));
    const sx = Math.max(1, Math.round(Number(cells.x || footprint.x / tile || (lockedModule ? 1 : scale.x) || 1)));
    const sz = Math.max(1, Math.round(Number(cells.z || footprint.z / tile || (lockedModule ? 1 : scale.z) || 1)));
    return { sx: clamp(sx, 1, 12), sz: clamp(sz, 1, 12) };
  }

  function locationObjectCollisionSize(row = {}) {
    const exact = row.collisionSize && typeof row.collisionSize === 'object' ? row.collisionSize : {};
    const width = Number(exact.width || exact.x || 0);
    const depth = Number(exact.depth || exact.z || 0);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(depth) && depth > 0) {
      return {
        width: clamp(width, 0.4, tile * 12),
        depth: clamp(depth, 0.4, tile * 12),
        exact: true
      };
    }
    const fp = locationObjectFootprintCells(row);
    return { width: fp.sx * tile, depth: fp.sz * tile, exact: false };
  }

  function locationObjectCollisionParts(row = {}) {
    const parts = Array.isArray(row.collisionParts) ? row.collisionParts : [];
    if (!parts.length) return [];
    const pos = locationObjectPosition(row);
    const scale = locationObjectScale(row);
    const rotationY = locationObjectRotationY(row);
    const transform = { x: pos.x, z: pos.z, rotationY, scaleX: scale.x, scaleZ: scale.z };
    return parts.map(part => {
      const center = part?.center && typeof part.center === 'object' ? part.center : {};
      const centerX = Number(center.x ?? part?.x ?? 0);
      const centerZ = Number(center.z ?? part?.z ?? 0);
      if (![centerX, centerZ].every(Number.isFinite)) return null;
      // A tank, a mound or a pillar is round. Boxes cannot follow a circle: two of them
      // leave notches a quarter of the radius deep, so the part says `radius` instead.
      if (part?.radius !== undefined) {
        const radius = Number(part.radius);
        if (!Number.isFinite(radius) || radius <= 0) return null;
        const placed = transformedBounds({
          center: { x: centerX, z: centerZ },
          size: { x: radius * 2, z: radius * 2 }
        }, transform);
        if (!placed) return null;
        // Physics scales a sphere by its largest axis, never into an ellipse.
        const worldRadius = radius * Math.max(Math.abs(scale.x), Math.abs(scale.z));
        return { x: placed.x, z: placed.z, halfX: worldRadius, halfZ: worldRadius, rotationY: 0, round: true };
      }
      const size = part?.size && typeof part.size === 'object' ? part.size : {};
      const width = Number(size.x ?? size.width ?? part?.width);
      const depth = Number(size.z ?? size.depth ?? part?.depth);
      // A part may be turned inside its object: the segments of a ring, a pipe laid
      // across a yard. Same convention as the row's own rotation.y.
      const partYaw = Number(part?.rotationY ?? 0);
      if (![width, depth, partYaw].every(Number.isFinite) || width <= 0 || depth <= 0) return null;
      const bounds = transformedBounds({
        center: { x: centerX, z: centerZ },
        size: { x: width, z: depth }
      }, transform);
      if (bounds && partYaw !== 0) bounds.rotationY -= partYaw;
      return bounds;
    }).filter(Boolean);
  }

  function locationObjectBlockers(row = {}) {
    if (!row || typeof row !== 'object') return [];
    if (!locationObjectBlocksMovement(row)) return [];
    const pos = locationObjectPosition(row);
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return [];
    const authoredParts = locationObjectCollisionParts(row);
    // objectId lets an interaction look past the object it is aimed at: a pump jack
    // must not hide itself from the player who harvests it.
    const objectId = String(row.id || '');
    if (authoredParts.length) return authoredParts.map((part, partIndex) => ({
      id: `${String(row.id || row.model || '').slice(0, 56)}:${partIndex}`,
      objectId,
      ...part,
      modelRef: String(row.model || 'authored-object')
    }));
    const rotationY = locationObjectRotationY(row);
    const size = locationObjectCollisionSize(row);
    return [{
      id: String(row.id || row.model || '').slice(0, 64),
      objectId,
      x: pos.x,
      z: pos.z,
      halfX: Math.max(0.2, size.width * 0.5),
      halfZ: Math.max(0.2, size.depth * 0.5),
      // Authored yaw follows the client's visual convention, the inverse of the 2D OBB math.
      rotationY: -rotationY,
      modelRef: String(row.model || 'authored-object')
    }];
  }

  return {
    locationObjectBlocksMovement,
    locationObjectFootprintCells,
    locationObjectCollisionSize,
    locationObjectCollisionParts,
    locationObjectBlockers
  };
}

// How deep a circle sinks into a blocker (an oriented box, or a disc when
// `round`); 0 when they do not touch.
function circleBlockerPenalty(x, z, radius, blocker) {
  if (!blocker) return 0;
  const dx = Number(x || 0) - Number(blocker.x || 0);
  const dz = Number(z || 0) - Number(blocker.z || 0);
  if (blocker.round) {
    const reach = Math.max(0.01, Number(radius || 0)) + Math.max(0.01, Number(blocker.halfX || 0));
    return Math.max(0, reach - Math.hypot(dx, dz));
  }
  const rot = Number(blocker.rotationY || 0);
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const halfX = Math.max(0.01, Number(blocker.halfX || 0));
  const halfZ = Math.max(0.01, Number(blocker.halfZ || 0));
  const nearestX = clamp(localX, -halfX, halfX);
  const nearestZ = clamp(localZ, -halfZ, halfZ);
  const collisionRadius = Math.max(0.01, Number(radius || 0));
  const outsideDistance = Math.hypot(localX - nearestX, localZ - nearestZ);
  if (outsideDistance > 0) return Math.max(0, collisionRadius - outsideDistance);
  return collisionRadius + Math.min(halfX - Math.abs(localX), halfZ - Math.abs(localZ));
}

module.exports = {
  MODULE_MODEL_KEYS,
  circleBlockerPenalty,
  collisionBlocksMovement,
  createLocationCollision,
  locationObjectAllowsPlayerOverlap,
  locationObjectIsNpc,
  locationObjectOcclusionRole,
  locationObjectPosition,
  locationObjectRotationY,
  locationObjectScale,
  locationObjectTags
};
