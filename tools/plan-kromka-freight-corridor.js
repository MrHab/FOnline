'use strict';
// Read-only authoring aid. Never writes generated geometry or scene files.
const fs = require('node:fs');
const inventory = JSON.parse(fs.readFileSync('Build/KromkaSceneCaptures/physical-scene-audit.json', 'utf8'));
const relocations = { Keys_StationShed: [186, 224], Keys_GarageCooperative: [230, 184],
  Keys_CaravanOffice: [234, 205], Keys_BrokenDepot: [230, 222] };
const obstacles = inventory.models.filter(o => o.footprint < 4 && !o.name.includes('RoadBridge'))
  .map(o => ({ name: o.name, p: relocations[o.name] || [190 + o.worldX * 10, 150 - o.worldZ * 10], r: o.footprint * 5.5 + 1.2 }));
const key = p => `${p[0]},${p[1]}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function free(p) { return obstacles.every(o => {
  const dx = p[0] - o.p[0], dy = p[1] - o.p[1];
  return Math.abs(dx) > o.r || Math.abs(dy) > o.r || dx * dx + dy * dy > o.r * o.r;
}); }
function visible(a, b) {
  const steps = Math.ceil(dist(a, b) / .5);
  for (let i = 0; i <= steps; i++) if (!free(a.map((v, k) => v + (b[k] - v) * i / steps))) return false;
  return true;
}
function solve(start, end, minX, maxX, maxY = 265) {
  for (const p of [start, end]) {
    const blocked = obstacles.filter(o => dist(p, o.p) <= o.r).map(o => o.name);
    if (blocked.length) throw Error(`Anchor ${p} blocked by ${blocked.join(', ')}`);
  }
  const open = [{ p: start, g: 0, f: dist(start, end), prev: null }], best = new Map([[key(start), 0]]);
  while (open.length) {
    let at = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[at].f) at = i;
    const current = open.splice(at, 1)[0];
    if (dist(current.p, end) <= 3 && visible(current.p, end)) {
      const path = [end]; for (let n = current; n; n = n.prev) path.push(n.p); path.reverse();
      const simple = [path[0]];
      for (let i = 0; i < path.length - 1;) {
        let j = path.length - 1; while (j > i + 1 && !visible(path[i], path[j])) j--;
        simple.push(path[j]); i = j;
      }
      return simple;
    }
    for (const dx of [-2, 0, 2]) for (const dy of [-2, 0, 2]) {
      if (!dx && !dy) continue;
      const p = [current.p[0] + dx, current.p[1] + dy];
      if (p[0] < minX || p[0] > maxX || p[1] < 135 || p[1] > maxY || !visible(current.p, p)) continue;
      const g = current.g + Math.hypot(dx, dy), id = key(p);
      if (g >= (best.get(id) ?? Infinity)) continue;
      best.set(id, g); open.push({ p, g, f: g + dist(p, end), prev: current });
    }
  }
  const reached = [...best.keys()].map(id => id.split(',').map(Number));
  throw Error(`No free rail approach to ${end}: visited ${best.size}, eastmost ${Math.max(...reached.map(p => p[0]))}`);
}
const west = solve([28, 246], [185, 215], 20, 187);
// Freight terminates at the science belt's western service yard, not through
// the sealed laboratories and their protected equipment farther east.
const east = solve([211, 219], [275, 185], 205, 285, 225);
const path = [...west, [199, 217], ...east];
console.log(JSON.stringify({ relocation: relocations, path }, null, 2));
