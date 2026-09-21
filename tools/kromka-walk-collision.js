'use strict';

// Which part of a Unity scene collider stops a walking body, as the server sees it:
// a 2D shape on the ground plane. Mirrors KromkaWalkCollision in
// unity-client/Assets/Editor/KromkaWorldSceneExporter.cs, which writes these shapes
// into `collisionParts`; tools/check-kromka-collision-parity.js recomputes them from
// the scene YAML and compares, so a scene and its data cannot drift apart.
//
// A player is a 1.8 m capsule that steps over 0.25 m (RoaPlayerController) on ground
// whose top lies at y = -0.05 (Ground_EDITABLE). Only what a collider has between the
// step and the head counts: a roof, a gantry beam or a water tank on legs is walked
// under, and a slanted conveyor blocks only where its belt comes down to head height.

const WALK_BAND_BOTTOM = 0.2;
const WALK_BAND_TOP = 1.75;
// A sliver thinner than this is a grazing contact (a panel edge 5 mm below head
// height), not an obstacle the server should turn into a wall.
const MIN_PART_SIZE = 0.05;
const UPRIGHT = 0.999;
const HORIZONTAL = 0.001;

const BOX_EDGES = [];
for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) BOX_EDGES.push([a, a | bit]);

// Half away from zero, like Math.Round(value, 3, MidpointRounding.AwayFromZero) in the exporter.
function round3(value) {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

// Unity yaw of a frame whose local X points along the ground direction (x, z).
function yawOf(x, z) {
  return Math.atan2(-z, x);
}

// A rectangle turned by half a turn is the same rectangle.
function halfTurn(angle) {
  let value = angle % Math.PI;
  if (value > Math.PI / 2) value -= Math.PI;
  if (value <= -Math.PI / 2) value += Math.PI;
  return value;
}

function distanceToBand(low, high) {
  if (high < WALK_BAND_BOTTOM) return WALK_BAND_BOTTOM - high;
  if (low > WALK_BAND_TOP) return low - WALK_BAND_TOP;
  return 0;
}

// The tightest rectangle, turned by `yaw`, around ground points.
function rectangleAround(points, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, z] of points) {
    const u = x * cos - z * sin;
    const v = x * sin + z * cos;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const u = (minU + maxU) / 2;
  const v = (minV + maxV) / 2;
  return { x: u * cos + v * sin, z: -u * sin + v * cos, sizeX: maxU - minU, sizeZ: maxV - minV, yaw };
}

function boxShape(corners, axes) {
  const points = [];
  for (const corner of corners)
    if (corner[1] >= WALK_BAND_BOTTOM && corner[1] <= WALK_BAND_TOP) points.push([corner[0], corner[2]]);
  for (const [a, b] of BOX_EDGES) {
    const from = corners[a];
    const to = corners[b];
    for (const level of [WALK_BAND_BOTTOM, WALK_BAND_TOP]) {
      if ((from[1] - level) * (to[1] - level) >= 0) continue;
      const t = (level - from[1]) / (to[1] - from[1]);
      points.push([from[0] + (to[0] - from[0]) * t, from[2] + (to[2] - from[2]) * t]);
    }
  }
  if (!points.length) return null;
  // The frame follows the box's most level axis, so an upright or merely pitched box
  // keeps its own rectangle instead of a larger world-aligned one.
  let level = 0;
  for (let index = 1; index < 3; index++)
    if (Math.abs(axes[index][1]) < Math.abs(axes[level][1]) - 1e-6) level = index;
  const length = Math.hypot(axes[level][0], axes[level][2]) || 1;
  return rectangleAround(points, yawOf(axes[level][0] / length, axes[level][2] / length));
}

function boxCornersOfCapsule(shape) {
  const half = [shape.radius, shape.radius, shape.radius];
  half[shape.direction] = Math.max(shape.height / 2, shape.radius);
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const local = [(i & 1) ? half[0] : -half[0], (i & 2) ? half[1] : -half[1], (i & 4) ? half[2] : -half[2]];
    corners.push([0, 1, 2].map(row => shape.center[row]
      + shape.axes[0][row] * local[0] * shape.scale[0]
      + shape.axes[1][row] * local[1] * shape.scale[1]
      + shape.axes[2][row] * local[2] * shape.scale[2]));
  }
  return corners;
}

// World-space ground shapes of one collider: { x, z, radius } or { x, z, sizeX, sizeZ, yaw }.
function colliderShapes(shape) {
  if (shape.kind === 'box') {
    const rectangle = boxShape(shape.corners, shape.axes);
    return rectangle ? [rectangle] : [];
  }
  if (shape.kind === 'sphere') {
    const radius = shape.radius * Math.max(...shape.scale);
    const away = distanceToBand(shape.center[1], shape.center[1]);
    if (away >= radius) return [];
    return [{ x: shape.center[0], z: shape.center[2], radius: Math.sqrt(radius * radius - away * away) }];
  }
  if (shape.kind !== 'capsule') throw new Error(`no ground shape for a ${shape.kind} collider`);
  const axis = shape.axes[shape.direction];
  const around = [0, 1, 2].filter(index => index !== shape.direction);
  const radius = shape.radius * Math.max(shape.scale[around[0]], shape.scale[around[1]]);
  const straight = Math.max(0, shape.height * shape.scale[shape.direction] / 2 - radius);
  if (Math.abs(axis[1]) > UPRIGHT) {
    const away = distanceToBand(shape.center[1] - straight, shape.center[1] + straight);
    if (away >= radius) return [];
    return [{ x: shape.center[0], z: shape.center[2], radius: Math.sqrt(radius * radius - away * away) }];
  }
  if (Math.abs(axis[1]) < HORIZONTAL) {
    // A pipe: as wide as the chord of its round section at body height, as long as its
    // straight run; the rounded ends add the side of the square inscribed in them.
    const away = distanceToBand(shape.center[1], shape.center[1]);
    if (away >= radius) return [];
    const chord = Math.sqrt(radius * radius - away * away);
    const length = Math.hypot(axis[0], axis[2]) || 1;
    return [{
      x: shape.center[0],
      z: shape.center[2],
      sizeX: (straight + chord * Math.SQRT1_2) * 2,
      sizeZ: chord * 2,
      yaw: yawOf(axis[0] / length, axis[2] / length)
    }];
  }
  // A leaning capsule has no simple ground shape; its bounding box errs on the blocking side.
  const rectangle = boxShape(boxCornersOfCapsule(shape), shape.axes);
  return rectangle ? [rectangle] : [];
}

// The collisionParts of a row, in the frame the server decodes them in
// (src/server/location-collision.js): offset from the row position, turned back by
// the row's yaw, divided by the row's scale.
function walkCollisionParts(colliders, row) {
  const position = row.position || {};
  const yaw = Number(row.rotation?.y || 0);
  const scaleX = Math.abs(Number(row.scale?.x)) > 1e-6 ? Number(row.scale.x) : 1;
  const scaleZ = Math.abs(Number(row.scale?.z)) > 1e-6 ? Number(row.scale.z) : 1;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const parts = [];
  for (const collider of colliders) {
    for (const shape of colliderShapes(collider)) {
      if (shape.radius !== undefined ? shape.radius * 2 < MIN_PART_SIZE
        : Math.min(shape.sizeX, shape.sizeZ) < MIN_PART_SIZE) continue;
      const dx = shape.x - Number(position.x || 0);
      const dz = shape.z - Number(position.z || 0);
      const part = { center: { x: round3((dx * cos - dz * sin) / scaleX), z: round3((dx * sin + dz * cos) / scaleZ) } };
      if (shape.radius !== undefined) part.radius = round3(shape.radius / Math.max(Math.abs(scaleX), Math.abs(scaleZ)));
      else {
        part.size = { x: round3(shape.sizeX / Math.abs(scaleX)), z: round3(shape.sizeZ / Math.abs(scaleZ)) };
        const turned = round3(halfTurn(shape.yaw - yaw));
        if (turned !== 0) part.rotationY = turned;
      }
      parts.push(part);
    }
  }
  return parts;
}

// The ground extent of every solid collider of a row, overhead parts included: its
// `footprint` (the minimap draws it; the server falls back to it only without parts).
function colliderFootprint(colliders) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const take = (x, z, pad) => {
    minX = Math.min(minX, x - pad); maxX = Math.max(maxX, x + pad);
    minZ = Math.min(minZ, z - pad); maxZ = Math.max(maxZ, z + pad);
  };
  for (const shape of colliders) {
    if (shape.kind === 'box') for (const corner of shape.corners) take(corner[0], corner[2], 0);
    else if (shape.kind === 'sphere') take(shape.center[0], shape.center[2], shape.radius * Math.max(...shape.scale));
    else {
      const axis = shape.axes[shape.direction];
      const around = [0, 1, 2].filter(index => index !== shape.direction);
      const radius = shape.radius * Math.max(shape.scale[around[0]], shape.scale[around[1]]);
      const straight = Math.max(0, shape.height * shape.scale[shape.direction] / 2 - radius);
      for (const side of [1, -1]) take(shape.center[0] + axis[0] * straight * side, shape.center[2] + axis[2] * straight * side, radius);
    }
  }
  if (minX === Infinity) return null;
  return { x: round3(Math.max(0.2, maxX - minX)), z: round3(Math.max(0.2, maxZ - minZ)) };
}

module.exports = {
  MIN_PART_SIZE,
  WALK_BAND_BOTTOM,
  WALK_BAND_TOP,
  colliderFootprint,
  colliderShapes,
  walkCollisionParts
};
