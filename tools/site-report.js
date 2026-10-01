#!/usr/bin/env node
'use strict';

// Отчёт о собранной площадке места по данным сервера (после site-apply и экспорта
// Unity): куда игрок дойдёт от входа по той коллизии, которую видит сервер, — до
// каждого NPC, тайника и точки обзора; не стоит ли кто-то внутри преграды; сколько
// двора проходимо. Пишет Build/sites/<id>/renders/site-report.json и карту
// проходимости walk.png (чёрное — преграда, светлое — дошёл, серое — свободно, но
// недостижимо, рамка — островок, красные точки — недостижимые цели).
//
//   node tools/site-report.js Build/sites/<id>/layout.json

const fs = require('node:fs');
const path = require('node:path');
const { circleBlockerPenalty, createLocationCollision } = require('../src/server/location-collision');
const { normalizeSite, siteContains } = require('../src/server/zone-sites');

const ROOT = path.resolve(__dirname, '..');
const STEP = 0.25;
const PLAYER_RADIUS = 0.35;
const MARGIN = 14;

function main() {
  const layoutFile = process.argv[2];
  if (!layoutFile) throw new Error('usage: node tools/site-report.js <layout.json>');
  const layout = JSON.parse(fs.readFileSync(path.resolve(layoutFile), 'utf8'));
  const site = layout.site;
  const zone = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'zones', 'authored', `${site.zone}.json`), 'utf8'));
  const yaw = Number(site.rotationY || 0) * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const world = (row = {}) => ({
    x: site.center.x + Number(row.x || 0) * cos + Number(row.z || 0) * sin,
    z: site.center.z - Number(row.x || 0) * sin + Number(row.z || 0) * cos
  });
  const area = normalizeSite({ id: site.id, x: site.center.x, z: site.center.z, halfX: site.size.x / 2, halfZ: site.size.z / 2, rotationY: yaw });

  const { locationObjectBlockers } = createLocationCollision({ tile: 2 });
  const reach = Math.hypot(site.size.x, site.size.z) / 2 + MARGIN;
  const blockers = (zone.objects || []).flatMap(row => locationObjectBlockers(row))
    .filter(blocker => Math.hypot(blocker.x - site.center.x, blocker.z - site.center.z) < reach + 12);

  const minX = site.center.x - reach;
  const minZ = site.center.z - reach;
  const n = Math.ceil(reach * 2 / STEP);
  const cellX = i => minX + (i + 0.5) * STEP;
  const cellZ = j => minZ + (j + 0.5) * STEP;
  // Ведро преград по клеткам 4 м: иначе 60 тыс. клеток × все преграды.
  const buckets = new Map();
  const bucketKey = (x, z) => `${Math.floor(x / 4)}:${Math.floor(z / 4)}`;
  for (const blocker of blockers) {
    const r = Math.hypot(blocker.halfX || 0, blocker.halfZ || 0) + PLAYER_RADIUS;
    for (let bx = Math.floor((blocker.x - r) / 4); bx <= Math.floor((blocker.x + r) / 4); bx++) {
      for (let bz = Math.floor((blocker.z - r) / 4); bz <= Math.floor((blocker.z + r) / 4); bz++) {
        const key = `${bx}:${bz}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(blocker);
      }
    }
  }
  const blockedAt = (x, z, radius = PLAYER_RADIUS) => (buckets.get(bucketKey(x, z)) || [])
    .some(blocker => circleBlockerPenalty(x, z, radius, blocker) > 1e-6);
  // Край зоны — стена.
  const half = Number(zone.map?.width || 320) / 2;
  const free = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = cellX(i), z = cellZ(j);
      free[j * n + i] = Math.abs(x) < half - 1 && Math.abs(z) < half - 1 && !blockedAt(x, z) ? 1 : 0;
    }
  }
  const index = point => ({ i: Math.floor((point.x - minX) / STEP), j: Math.floor((point.z - minZ) / STEP) });
  const nearestFree = (point, radius) => {
    const at = index(point);
    const cells = Math.ceil(radius / STEP);
    let best = null;
    for (let di = -cells; di <= cells; di++) {
      for (let dj = -cells; dj <= cells; dj++) {
        const i = at.i + di, j = at.j + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || !free[j * n + i]) continue;
        const d = Math.hypot(di, dj) * STEP;
        if (d <= radius && (!best || d < best.d)) best = { i, j, d };
      }
    }
    return best;
  };

  const start = world(layout.approach || { x: site.size.x / 2 + 6, z: 0 });
  const origin = nearestFree(start, 3);
  const reached = new Uint8Array(n * n);
  if (origin) {
    const queue = [origin.j * n + origin.i];
    reached[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head];
      const i = cell % n, j = Math.floor(cell / n);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const next = b * n + a;
        if (reached[next] || !free[next]) continue;
        // По диагонали — только если оба соседа свободны: не сквозь угол.
        if (di && dj && (!free[j * n + a] || !free[b * n + i])) continue;
        reached[next] = 1;
        queue.push(next);
      }
    }
  }
  const reachable = (point, radius) => {
    const at = index(point);
    const cells = Math.ceil(radius / STEP);
    for (let di = -cells; di <= cells; di++) {
      for (let dj = -cells; dj <= cells; dj++) {
        const i = at.i + di, j = at.j + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        if (reached[j * n + i] && Math.hypot(di, dj) * STEP <= radius) return true;
      }
    }
    return false;
  };

  const targets = [
    ...(layout.npcs || []).map(row => ({ kind: 'npc', id: row.id, point: world(row), radius: 1.6 })),
    ...(layout.containers || []).map(row => ({ kind: 'container', id: row.id, point: world(row), radius: 2.4 })),
    ...(layout.viewpoints || []).map(row => ({ kind: 'viewpoint', id: row.label, point: world(row), radius: 2.5 }))
  ];
  const problems = [];
  const results = targets.map(target => {
    const ok = reachable(target.point, target.radius);
    const inside = target.kind === 'npc' && blockedAt(target.point.x, target.point.z, 0.3);
    const onSite = siteContains(area, target.point.x, target.point.z);
    if (!ok) problems.push(`${target.kind} ${target.id}: unreachable from the entrance`);
    if (inside) problems.push(`${target.kind} ${target.id}: stands inside collision`);
    if (target.kind !== 'viewpoint' && !onSite) problems.push(`${target.kind} ${target.id}: outside the site`);
    return { kind: target.kind, id: target.id, x: Math.round(target.point.x * 100) / 100, z: Math.round(target.point.z * 100) / 100, reachable: ok, insideCollision: inside, onSite };
  });

  let siteCells = 0, siteFree = 0, siteReached = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!siteContains(area, cellX(i), cellZ(j))) continue;
      siteCells++;
      if (free[j * n + i]) siteFree++;
      if (reached[j * n + i]) siteReached++;
    }
  }
  if (!origin) problems.push('the approach point is inside collision');
  const report = {
    site: site.id, zone: site.zone,
    blockers: blockers.length,
    siteFreeShare: Math.round(siteFree / Math.max(1, siteCells) * 1000) / 1000,
    siteReachedShare: Math.round(siteReached / Math.max(1, siteCells) * 1000) / 1000,
    freeButUnreachableShare: Math.round((siteFree - siteReached) / Math.max(1, siteCells) * 1000) / 1000,
    targets: results,
    problems
  };
  const outDir = path.join(path.dirname(path.resolve(layoutFile)), 'renders');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'site-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeWalkMap(path.join(outDir, 'walk.png'), n, free, reached, area, cellX, cellZ, results.filter(row => !row.reachable || row.insideCollision), minX, minZ)
    .catch(error => console.error('walk.png:', error.message));
  console.log(JSON.stringify({ ...report, targets: `${results.filter(row => row.reachable).length}/${results.length} reachable` }, null, 2));
}

async function writeWalkMap(file, n, free, reached, area, cellX, cellZ, bad, minX, minZ) {
  let sharp;
  try { sharp = require('sharp'); } catch (_) { return; }
  const pixels = Buffer.alloc(n * n * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Сверху север: строка изображения 0 — наибольший z.
      const offset = ((n - 1 - j) * n + i) * 3;
      const cell = j * n + i;
      let colour = free[cell] ? (reached[cell] ? [236, 226, 196] : [150, 150, 150]) : [25, 25, 25];
      const inside = siteContains(area, cellX(i), cellZ(j));
      const edge = inside && !siteContains(area, cellX(i), cellZ(j), -STEP * 1.5);
      if (edge) colour = [40, 170, 70];
      pixels[offset] = colour[0]; pixels[offset + 1] = colour[1]; pixels[offset + 2] = colour[2];
    }
  }
  for (const row of bad) {
    const ci = Math.floor((row.x - minX) / STEP), cj = Math.floor((row.z - minZ) / STEP);
    for (let di = -3; di <= 3; di++) {
      for (let dj = -3; dj <= 3; dj++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const offset = ((n - 1 - j) * n + i) * 3;
        pixels[offset] = 220; pixels[offset + 1] = 30; pixels[offset + 2] = 30;
      }
    }
  }
  await sharp(pixels, { raw: { width: n, height: n, channels: 3 } }).png().toFile(file);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
