#!/usr/bin/env node
'use strict';

// Места, стоящие площадкой прямо в своей зоне (src/server/zone-sites.js):
// геометрия повёрнутой площадки та же, что у Unity (поворот вокруг Y как у
// eulerAngles.y), безопасный островок важнее обычной площадки, негодные строки
// отбрасываются; граф помечает место из overrides.sites площадкой, закреплённая
// зона обязана нести её строку и не нести портала; сохранение в таком месте
// просыпается в его зоне у точки места.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeSite, normalizeSites, siteAt, safeSiteAt, siteContains, siteCorners, siteLocalPoint } = require('../src/server/zone-sites');
const { frozenZoneProblems } = require('../src/server/zone-runtime');
const { migrateSaveStateToZones } = require('../src/server/zone-migration');

const root = path.resolve(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));

// Повёрнутая на 90° площадка: её ширина (локальная X) лежит вдоль мировой Z,
// глубина — вдоль X. У Unity поворот на +90° уводит локальную +X в мировую −Z.
{
  const site = normalizeSite({ id: 'post', name: 'Пост', safe: true, x: 10, z: -5, halfX: 6, halfZ: 3, rotationY: Math.PI / 2 });
  assert.ok(siteContains(site, 12.9, -5), 'depth runs along world X after a quarter turn');
  assert.ok(!siteContains(site, 15, -5), 'the width no longer runs along world X');
  assert.ok(siteContains(site, 10, 0.9), 'the width runs along world Z');
  assert.ok(siteContains(site, 15, -5, 2.1), 'a margin widens the site on every side');
  const local = siteLocalPoint(site, 10, -11);
  assert.ok(Math.abs(local.x - 6) < 0.01 && Math.abs(local.z) < 0.01, 'world -Z is the local +X of a +90° turn, as in Unity');
  for (const corner of siteCorners(site)) {
    const point = siteLocalPoint(site, corner.x, corner.z);
    assert.ok(Math.abs(Math.abs(point.x) - 6) < 1e-3 && Math.abs(Math.abs(point.z) - 3) < 1e-3, 'corners sit on the edges');
  }
}

// Строки: без id или размера — мимо, дубли id — один раз, размер можно дать как size.
{
  const sites = normalizeSites([
    { id: 'a', x: 0, z: 0, size: { x: 10, z: 4 } },
    { id: 'a', x: 50, z: 50, halfX: 1, halfZ: 1 },
    { id: '', x: 0, z: 0, halfX: 5, halfZ: 5 },
    { id: 'flat', x: 0, z: 0, halfX: 5, halfZ: 0 },
    null
  ]);
  assert.deepEqual(sites.map(site => [site.id, site.halfX, site.halfZ, site.safe]), [['a', 5, 2, false]]);
}

// Перекрытие: островок важнее; вне обоих — ничего.
{
  const sites = normalizeSites([
    { id: 'yard', x: 0, z: 0, halfX: 20, halfZ: 20 },
    { id: 'post', x: 5, z: 5, halfX: 4, halfZ: 4, safe: true }
  ]);
  assert.equal(siteAt(sites, 6, 6).id, 'post');
  assert.equal(siteAt(sites, -15, 0).id, 'yard');
  assert.equal(safeSiteAt(sites, -15, 0), null);
  assert.equal(siteAt(sites, 40, 40), null);
}

// Граф: каждое место из overrides.sites — площадка своей зоны с тем же признаком
// островка; портальных мест в этом списке нет.
const graph = readJson('data', 'kromka', 'zone-graph.json');
const overrides = readJson('data', 'kromka', 'zone-graph.overrides.json');
const siteRules = overrides.sites || {};
for (const [id, rule] of Object.entries(siteRules)) {
  const zone = graph.zones.find(row => (row.places || []).some(place => place.locationId === id));
  assert.ok(zone, `${id}: a site must be a place of some zone`);
  const place = zone.places.find(row => row.locationId === id);
  assert.equal(place.site, true, `${id}: the graph marks it as a site (npm run build:zone-graph)`);
  assert.equal(!!place.safe, rule.safe === true, `${id}: the safe flag follows overrides.sites`);
}
for (const zone of graph.zones) {
  for (const place of zone.places || []) {
    if (place.site) assert.ok(siteRules[place.locationId], `${place.locationId}: a site the overrides do not list`);
  }
}

// Закреплённая зона с местом-площадкой: строка площадки обязательна, портала нет,
// признак островка тот же, что в графе.
{
  const zone = JSON.parse(JSON.stringify(graph.zones.find(row => (row.places || []).some(place => !place.hidden && !place.site))));
  const place = zone.places.find(row => !row.hidden && !row.site);
  place.site = true;
  place.safe = true;
  const fakeGraph = { ...graph, zones: graph.zones.map(row => row.id === zone.id ? zone : row) };
  const definition = readJson('data', 'zones', 'authored', `${zone.id}.json`);
  const withoutSite = frozenZoneProblems(fakeGraph, definition);
  assert.ok(withoutSite.some(problem => problem.includes(`no site ${place.locationId}`)), 'a site needs its row');
  assert.ok(withoutSite.some(problem => problem.includes(`${place.locationId} is a site, not a portal`)), 'a site has no portal');
  const fixed = {
    ...definition,
    transitions: (definition.transitions || []).filter(row => row.to !== place.locationId),
    sites: [{ id: place.locationId, name: place.name, safe: false, x: 0, z: 0, halfX: 10, halfZ: 10, rotationY: 0 }]
  };
  assert.ok(frozenZoneProblems(fakeGraph, fixed).some(problem => problem.includes('must be a safe island')), 'the island flag must match');
  fixed.sites[0].safe = true;
  assert.deepEqual(frozenZoneProblems(fakeGraph, fixed).filter(problem => problem.includes(place.locationId)), []);

  // Сохранение в месте, ставшем площадкой, просыпается в его зоне у точки места.
  const state = { currentLocationId: place.locationId, player: { x: 3, z: 4 }, placesRevision: 99, zoneFrameRevision: 99 };
  const out = migrateSaveStateToZones(state, fakeGraph);
  assert.deepEqual([out.changed, out.zoneId, out.reason], [true, zone.id, 'placeBecameSite']);
  assert.equal(state.currentLocationId, zone.id);
  const tile = share => Math.min(135, Math.max(24, Math.round(share * 159)));
  assert.deepEqual([state.player.x, state.player.z], [(tile(place.u) - 79.5) * 2, (tile(1 - place.v) - 79.5) * 2], 'at the place point, where the portal used to be');
  const again = migrateSaveStateToZones(state, fakeGraph);
  assert.equal(again.reason, '', 'a second migration leaves the character where it is');
}

console.log(`zone sites: PASS (${Object.keys(siteRules).length} sites in the graph)`);
