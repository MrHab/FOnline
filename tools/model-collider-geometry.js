'use strict';

// Player collision is a two-dimensional projection of the part of a model that
// intersects the character between the ankles and the waist.  Using the full
// visual Box3 made painted shadows, roof overhangs, wires and tree crowns act as
// invisible walls.
const WALK_COLLISION_MIN_Y = 0.18;
const WALK_COLLISION_MAX_Y = 0.95;
const MAX_COLLIDER_PARTS = 24;
const MIN_PART_SIZE = 0.06;

const NON_BLOCKING_MODEL_FILES = new Set([
  'asphalt_slab.glb',
  'trader_floor_slab.glb',
  'trader_roof_block.glb',
  'mod_floor_tile.glb',
  'mod_floor_wood.glb',
  'mod_roof_metal.glb',
  'mod_roof_wood.glb'
]);

const NON_COLLIDING_MESH_NAME = /(?:painted_contact_shadow|ground_pebble_detail|ground_detail|loose_scrap_flake|discarded_bolt_detail)/i;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clipPolygonAtY(polygon, planeY, keepAbove) {
  if (!polygon.length) return [];
  const output = [];
  let previous = polygon[polygon.length - 1];
  let previousInside = keepAbove ? previous.y >= planeY : previous.y <= planeY;
  for (const current of polygon) {
    const currentInside = keepAbove ? current.y >= planeY : current.y <= planeY;
    if (currentInside !== previousInside) {
      const dy = current.y - previous.y;
      const t = Math.abs(dy) > 1e-9 ? (planeY - previous.y) / dy : 0;
      output.push({
        x: previous.x + (current.x - previous.x) * t,
        y: planeY,
        z: previous.z + (current.z - previous.z) * t
      });
    }
    if (currentInside) output.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

function clippedTriangleToWalkSlab(a, b, c, minY, maxY) {
  let polygon = clipPolygonAtY([a, b, c], minY, true);
  polygon = clipPolygonAtY(polygon, maxY, false);
  return polygon;
}

function meshIsCollisionCandidate(mesh) {
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position || mesh.visible === false) return false;
  const ownRule = String(mesh.userData?.realmCollision || mesh.userData?.collision || '').toLowerCase();
  if (mesh.userData?.collision === false || ownRule === 'none' || ownRule === 'ignore' || ownRule === 'visual') return false;
  if (NON_COLLIDING_MESH_NAME.test(String(mesh.name || ''))) return false;
  return true;
}

function meshWalkProjectionBounds(THREE, mesh, minY, maxY) {
  const position = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const vertex = i => {
    const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    return { x: point.x, y: point.y, z: point.z };
  };
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  let triangles = 0;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const a = vertex(index ? index.getX(offset) : offset);
    const b = vertex(index ? index.getX(offset + 1) : offset + 1);
    const c = vertex(index ? index.getX(offset + 2) : offset + 2);
    const polygon = clippedTriangleToWalkSlab(a, b, c, minY, maxY);
    if (!polygon.length) continue;
    triangles += 1;
    polygon.forEach(point => {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minZ = Math.min(bounds.minZ, point.z);
      bounds.maxZ = Math.max(bounds.maxZ, point.z);
    });
  }
  if (!triangles || ![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)) return null;
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const halfX = Math.max(MIN_PART_SIZE * 0.5, (bounds.maxX - bounds.minX) * 0.5);
  const halfZ = Math.max(MIN_PART_SIZE * 0.5, (bounds.maxZ - bounds.minZ) * 0.5);
  return {
    minX: centerX - halfX,
    maxX: centerX + halfX,
    minZ: centerZ - halfZ,
    maxZ: centerZ + halfZ,
    sourceMeshes: 1,
    sourceTriangles: triangles
  };
}

function rectWidth(rect) { return Math.max(0, rect.maxX - rect.minX); }
function rectDepth(rect) { return Math.max(0, rect.maxZ - rect.minZ); }
function rectArea(rect) { return rectWidth(rect) * rectDepth(rect); }

function rectContains(outer, inner, epsilon = 0.025) {
  return outer.minX <= inner.minX + epsilon && outer.maxX >= inner.maxX - epsilon &&
    outer.minZ <= inner.minZ + epsilon && outer.maxZ >= inner.maxZ - epsilon;
}

function rectUnion(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
    sourceMeshes: finite(a.sourceMeshes) + finite(b.sourceMeshes),
    sourceTriangles: finite(a.sourceTriangles) + finite(b.sourceTriangles)
  };
}

function intervalOverlap(aMin, aMax, bMin, bMax) {
  return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
}

function intervalGap(aMin, aMax, bMin, bMax) {
  return Math.max(0, Math.max(aMin, bMin) - Math.min(aMax, bMax));
}

function shouldMergeAlignedRects(a, b) {
  const overlapX = intervalOverlap(a.minX, a.maxX, b.minX, b.maxX);
  const overlapZ = intervalOverlap(a.minZ, a.maxZ, b.minZ, b.maxZ);
  const xRatio = overlapX / Math.max(MIN_PART_SIZE, Math.min(rectWidth(a), rectWidth(b)));
  const zRatio = overlapZ / Math.max(MIN_PART_SIZE, Math.min(rectDepth(a), rectDepth(b)));
  const gapX = intervalGap(a.minX, a.maxX, b.minX, b.maxX);
  const gapZ = intervalGap(a.minZ, a.maxZ, b.minZ, b.maxZ);
  return (xRatio >= 0.82 && gapZ <= 0.08) || (zRatio >= 0.82 && gapX <= 0.08);
}

function occupiedRatio(rects, union, samples = 28) {
  if (!rects.length || rectArea(union) <= 1e-8) return 0;
  let occupied = 0;
  for (let z = 0; z < samples; z += 1) {
    const pz = union.minZ + (z + 0.5) / samples * rectDepth(union);
    for (let x = 0; x < samples; x += 1) {
      const px = union.minX + (x + 0.5) / samples * rectWidth(union);
      if (rects.some(rect => px >= rect.minX && px <= rect.maxX && pz >= rect.minZ && pz <= rect.maxZ)) occupied += 1;
    }
  }
  return occupied / (samples * samples);
}

function simplifyProjectionRects(input) {
  let rects = input
    .filter(rect => rectArea(rect) > 0.0004)
    .sort((a, b) => rectArea(b) - rectArea(a));
  rects = rects.filter((rect, index) => !rects.slice(0, index).some(outer => rectContains(outer, rect)));

  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        if (!shouldMergeAlignedRects(rects[i], rects[j])) continue;
        rects[i] = rectUnion(rects[i], rects[j]);
        rects.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }

  const union = rects.reduce((result, rect) => result ? rectUnion(result, rect) : { ...rect }, null);
  if (union && occupiedRatio(rects, union) >= 0.72) return [union];

  while (rects.length > MAX_COLLIDER_PARTS) {
    let best = null;
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const combined = rectUnion(rects[i], rects[j]);
        const waste = rectArea(combined) - rectArea(rects[i]) - rectArea(rects[j]);
        if (!best || waste < best.waste) best = { i, j, combined, waste };
      }
    }
    if (!best) break;
    rects[best.i] = best.combined;
    rects.splice(best.j, 1);
  }
  return rects;
}

function boundsRecord(minX, maxX, minY, maxY, minZ, maxZ) {
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    center: { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5, z: (minZ + maxZ) * 0.5 }
  };
}

function computeWalkCollision(THREE, scene, fileName = '', options = {}) {
  const minY = finite(options.minY, WALK_COLLISION_MIN_Y);
  const maxY = finite(options.maxY, WALK_COLLISION_MAX_Y);
  if (NON_BLOCKING_MODEL_FILES.has(String(fileName || '').toLowerCase())) {
    return { mode: 'none', reason: 'non-blocking-surface', slab: { minY, maxY }, parts: [] };
  }

  scene.updateMatrixWorld(true);
  const meshRects = [];
  let candidateMeshes = 0;
  scene.traverse(mesh => {
    if (!meshIsCollisionCandidate(mesh)) return;
    candidateMeshes += 1;
    const rect = meshWalkProjectionBounds(THREE, mesh, minY, maxY);
    if (rect) meshRects.push(rect);
  });
  const rects = simplifyProjectionRects(meshRects);
  if (!rects.length) {
    return { mode: 'none', reason: 'no-geometry-in-walk-slab', slab: { minY, maxY }, parts: [], candidateMeshes };
  }

  const aggregate = rects.reduce((result, rect) => result ? rectUnion(result, rect) : { ...rect }, null);
  const parts = rects.map(rect => ({
    ...boundsRecord(rect.minX, rect.maxX, minY, maxY, rect.minZ, rect.maxZ),
    sourceMeshes: rect.sourceMeshes,
    sourceTriangles: rect.sourceTriangles
  }));
  return {
    mode: 'solid',
    method: 'walk-slab-mesh-projection-v1',
    slab: { minY, maxY },
    candidateMeshes,
    sourcePartCount: meshRects.length,
    ...boundsRecord(aggregate.minX, aggregate.maxX, minY, maxY, aggregate.minZ, aggregate.maxZ),
    parts
  };
}

module.exports = {
  MAX_COLLIDER_PARTS,
  NON_BLOCKING_MODEL_FILES,
  WALK_COLLISION_MAX_Y,
  WALK_COLLISION_MIN_Y,
  computeWalkCollision,
  meshIsCollisionCandidate
};
