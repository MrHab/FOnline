'use strict';

// Поиск пути врага по сетке тайлов комнаты. Модуль чистый: проходимость тайла и
// перевод тайла в мировые координаты даёт вызывающий, поэтому путь верен для
// комнаты любого размера — от двора 28×28 до зоны 160×160 тайлов.

const STEPS = Object.freeze([
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]
]);
const DEFAULT_MAX_ITERATIONS = 900;

function pathKey(tx, tz) { return `${tx},${tz}`; }

/** Ближайший проходимый тайл по кольцам вокруг точки; `null`, если в радиусе такого нет. */
function nearestOpenTile(isOpen, tx, tz, maxRadius = 8) {
  tx = Math.round(Number(tx || 0));
  tz = Math.round(Number(tz || 0));
  if (isOpen(tx, tz)) return { tx, tz };
  for (let r = 1; r <= maxRadius; r++) {
    let best = null;
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!isOpen(tx + dx, tz + dz)) continue;
        const d = Math.hypot(dx, dz);
        if (d < bestD) { bestD = d; best = { tx: tx + dx, tz: tz + dz }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Запрещаем срезать угол между водой/деревом/камнем. Иначе моб визуально
// пытается протиснуться через диагональную щель и снова выглядит застрявшим.
function canUseDiagonalStep(isOpen, tx, tz, nx, nz) {
  const dx = nx - tx;
  const dz = nz - tz;
  if (Math.abs(dx) !== 1 || Math.abs(dz) !== 1) return true;
  return isOpen(tx + dx, tz) && isOpen(tx, tz + dz);
}

/**
 * A* по восьми направлениям. Возвращает точки пути без стартового тайла
 * (`[]`, если старт и цель совпали) или `null`, если путь не найден либо
 * исчерпан предел итераций.
 *
 * @param {object} options
 * @param {(tx:number, tz:number) => boolean} options.isOpen проходим ли тайл
 * @param {(tx:number, tz:number) => {x:number, z:number}} options.toWorld центр тайла в мире этой комнаты
 */
function findGridPath({ isOpen, toWorld, startTx, startTz, goalTx, goalTz, maxIterations = DEFAULT_MAX_ITERATIONS, startSnapRadius = 3, goalSnapRadius = 8 }) {
  const start = nearestOpenTile(isOpen, startTx, startTz, startSnapRadius);
  const goal = nearestOpenTile(isOpen, goalTx, goalTz, goalSnapRadius);
  if (!start || !goal) return null;
  if (start.tx === goal.tx && start.tz === goal.tz) return [];
  const startKey = pathKey(start.tx, start.tz);
  const goalKey = pathKey(goal.tx, goal.tz);
  const open = [{ tx: start.tx, tz: start.tz, key: startKey, f: Math.hypot(goal.tx - start.tx, goal.tz - start.tz) }];
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();
  let iterations = 0;
  while (open.length && iterations++ < maxIterations) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    if (!current || closed.has(current.key)) continue;
    if (current.key === goalKey) {
      const out = [];
      let key = current.key;
      while (key && key !== startKey) {
        const [x, z] = key.split(',').map(Number);
        out.push({ tx: x, tz: z, ...toWorld(x, z) });
        key = cameFrom.get(key);
      }
      out.reverse();
      return out;
    }
    closed.add(current.key);
    const baseG = gScore.get(current.key) ?? Infinity;
    for (const [dx, dz, cost] of STEPS) {
      const nx = current.tx + dx;
      const nz = current.tz + dz;
      if (!isOpen(nx, nz)) continue;
      if (!canUseDiagonalStep(isOpen, current.tx, current.tz, nx, nz)) continue;
      const key = pathKey(nx, nz);
      if (closed.has(key)) continue;
      const nextG = baseG + cost;
      if (nextG >= (gScore.get(key) ?? Infinity)) continue;
      cameFrom.set(key, current.key);
      gScore.set(key, nextG);
      open.push({ tx: nx, tz: nz, key, f: nextG + Math.hypot(goal.tx - nx, goal.tz - nz) });
    }
  }
  return null;
}

module.exports = {
  DEFAULT_MAX_ITERATIONS,
  canUseDiagonalStep,
  findGridPath,
  nearestOpenTile,
  pathKey
};
