#!/usr/bin/env node
'use strict';

// Путь врага строится по сетке той комнаты, где он стоит. Раньше точки пути
// переводились в мир по сетке 38×38 независимо от комнаты, и в большой сцене
// враг шёл не туда. Модуль чистый, поэтому проверяется без сервера.

const assert = require('node:assert/strict');
const { findGridPath, nearestOpenTile, canUseDiagonalStep } = require('../src/server/enemy-pathing');

const TILE = 2;
const toWorldFor = dims => (tx, tz) => ({ x: (tx - dims.w / 2 + 0.5) * TILE, z: (tz - dims.h / 2 + 0.5) * TILE });

function grid(w, h, walls = []) {
  const blocked = new Set(walls.map(([x, z]) => `${x},${z}`));
  return { w, h, isOpen: (tx, tz) => tx >= 0 && tz >= 0 && tx < w && tz < h && !blocked.has(`${tx},${tz}`) };
}

// --- зона 160×160: точки пути лежат в мире этой комнаты -------------------------------
{
  const dims = { w: 160, h: 160 };
  // Стена поперёк с одним проёмом: путь обязан пройти через проём.
  const walls = [];
  for (let x = 0; x < 160; x++) if (x !== 140) walls.push([x, 80]);
  const room = grid(dims.w, dims.h, walls);
  const toWorld = toWorldFor(dims);
  const path = findGridPath({ isOpen: room.isOpen, toWorld, startTx: 138, startTz: 70, goalTx: 138, goalTz: 90, maxIterations: 4000 });
  assert(path && path.length > 0, 'a detour through the gap exists');
  assert(path.some(step => step.tx === 140 && step.tz === 80), 'the path goes through the only gap in the wall');
  for (const step of path) {
    assert.deepEqual({ x: step.x, z: step.z }, toWorld(step.tx, step.tz), 'every waypoint is the centre of its tile in this room');
    assert(room.isOpen(step.tx, step.tz), 'the path never enters a blocked tile');
  }
  const last = path[path.length - 1];
  assert.deepEqual([last.tx, last.tz], [138, 90], 'the path ends on the goal tile');
  // Тот же тайл в сетке 38×38 лежал бы совсем в другом месте мира: это и был баг.
  const wrong = toWorldFor({ w: 38, h: 38 })(last.tx, last.tz);
  assert.notDeepEqual({ x: last.x, z: last.z }, wrong, 'waypoints must not be computed with the default 38×38 grid');
  assert(Math.abs(last.x) <= dims.w * TILE / 2 && Math.abs(last.z) <= dims.h * TILE / 2, 'waypoints stay inside the room');
  // Шаги соседние: путь непрерывен.
  let prev = { tx: 138, tz: 70 };
  for (const step of path) {
    assert(Math.max(Math.abs(step.tx - prev.tx), Math.abs(step.tz - prev.tz)) === 1, 'consecutive waypoints are adjacent tiles');
    prev = step;
  }
}

// --- обычная комната 38×38 ведёт себя как раньше --------------------------------------
{
  const dims = { w: 38, h: 38 };
  const room = grid(dims.w, dims.h);
  const path = findGridPath({ isOpen: room.isOpen, toWorld: toWorldFor(dims), startTx: 5, startTz: 5, goalTx: 9, goalTz: 9 });
  assert.equal(path.length, 4, 'an open diagonal takes four steps');
  assert.deepEqual(findGridPath({ isOpen: room.isOpen, toWorld: toWorldFor(dims), startTx: 5, startTz: 5, goalTx: 5, goalTz: 5 }), [], 'standing on the goal is an empty path');
}

// --- углы не срезаются, заблокированная цель притягивается к ближайшему тайлу ----------
{
  const room = grid(10, 10, [[5, 4], [4, 5]]);
  assert.equal(canUseDiagonalStep(room.isOpen, 4, 4, 5, 5), false, 'a diagonal between two blocked tiles is refused');
  assert.equal(canUseDiagonalStep(room.isOpen, 1, 1, 2, 2), true);
  const path = findGridPath({ isOpen: room.isOpen, toWorld: toWorldFor({ w: 10, h: 10 }), startTx: 4, startTz: 4, goalTx: 5, goalTz: 5 });
  assert(path && path.length > 1, 'the corner is walked around, not cut');
  assert.deepEqual(nearestOpenTile(room.isOpen, 5, 4, 3), { tx: 5, tz: 3 }, 'a blocked tile snaps to the nearest open neighbour');
  assert.equal(nearestOpenTile(() => false, 5, 5, 3), null, 'no open tile in range');
}

// --- замкнутая цель и предел итераций дают null, а не зависание ------------------------
{
  const walls = [];
  for (let x = 40; x <= 60; x++) { walls.push([x, 40]); walls.push([x, 60]); }
  for (let z = 40; z <= 60; z++) { walls.push([40, z]); walls.push([60, z]); }
  const room = grid(160, 160, walls);
  const sealed = findGridPath({ isOpen: room.isOpen, toWorld: toWorldFor({ w: 160, h: 160 }), startTx: 10, startTz: 10, goalTx: 50, goalTz: 50 });
  assert.equal(sealed, null, 'a sealed goal is unreachable');
  const far = findGridPath({ isOpen: grid(160, 160).isOpen, toWorld: toWorldFor({ w: 160, h: 160 }), startTx: 2, startTz: 2, goalTx: 157, goalTz: 157, maxIterations: 50 });
  assert.equal(far, null, 'the iteration cap ends the search');
}

console.log('Enemy pathing OK: waypoints use the room\'s own grid (160×160 verified), detours, corner rule, snapping and the iteration cap.');
