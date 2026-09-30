#!/usr/bin/env node
'use strict';

// Вносит в данные мира то, что площадка места (аванпост, точка добычи, кланбаза в
// своей зоне, src/server/zone-sites.js) не может описать сценой Unity: строку площадки,
// тайники, живые строки НПС, строки квестовых объектов, место в `sites` графа зон — и
// убирает портал места и всё, что конструктор зоны положил под площадку (тайники,
// логова, зоны появления, якоря событий, аномалии). Геометрию ставит потом Unity:
// Kromka.EditorTools.KromkaSiteBuilder по тому же макету, а его экспорт дописывает
// позиции и коллизию к строкам, которые записал этот инструмент.
//
//   node tools/site-apply.js Build/sites/<id>/layout.json [--check]
//
// Макет — `roa.siteLayout.v1`; координаты объектов — метры в осях площадки (её центр,
// +Z — её «север» при повороте 0). Повторный запуск заменяет прежнее целиком.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { normalizeSite, siteContains } = require('../src/server/zone-sites');

const ROOT = path.resolve(__dirname, '..');
const TILES = 160;
const TILE = 2;
const OVERRIDES = path.join(ROOT, 'data', 'kromka', 'zone-graph.overrides.json');
const LOOT_TABLES = path.join(ROOT, 'data', 'loot-tables.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
}

function metresToTile(metres) {
  return Math.min(TILES - 1, Math.max(0, Math.floor(metres / TILE + TILES / 2)));
}

function tileCentre(tile) {
  return (Number(tile) - TILES / 2 + 0.5) * TILE;
}

function safeId(value, limit = 96) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

/** Точка макета (оси площадки) в метрах сектора и поворот в градусах. */
function placer(site) {
  const yaw = Number(site.rotationY || 0) * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return (row = {}) => {
    const lx = Number(row.x || 0);
    const lz = Number(row.z || 0);
    return {
      x: round(site.center.x + lx * cos + lz * sin),
      z: round(site.center.z - lx * sin + lz * cos),
      yawDeg: Number(site.rotationY || 0) + Number(row.rotY || 0)
    };
  };
}

function validate(layout, lootTiers) {
  const problems = [];
  if (layout?.schema !== 'roa.siteLayout.v1') problems.push('schema must be roa.siteLayout.v1');
  const site = layout?.site || {};
  if (!safeId(site.id) || safeId(site.id) !== site.id) problems.push('site.id: latin letters, digits, _ and -');
  if (!/^z_\d\d_\d\d$/.test(String(site.zone || ''))) problems.push('site.zone must be z_CC_RR');
  if (!Number.isFinite(Number(site.center?.x)) || !Number.isFinite(Number(site.center?.z))) problems.push('site.center {x, z}');
  if (!(Number(site.size?.x) > 4) || !(Number(site.size?.z) > 4)) problems.push('site.size {x, z} in metres, more than 4');
  const ids = new Set();
  const seen = (kind, id) => {
    const key = safeId(id);
    if (!key || key !== id) problems.push(`${kind} ${JSON.stringify(id)}: id must be latin letters, digits, _ and -`);
    else if (ids.has(key)) problems.push(`${kind} ${key}: duplicate id`);
    ids.add(key);
  };
  for (const row of layout.objects || []) {
    seen('object', row.id);
    if (!String(row.prefab || '').trim()) problems.push(`object ${row.id}: no prefab`);
    if (row.scale !== undefined) problems.push(`object ${row.id}: models keep their authored size, no scale`);
  }
  for (const row of layout.npcs || []) seen('npc', row.id);
  for (const row of layout.containers || []) {
    seen('container', row.id);
    if (!lootTiers.includes(String(row.tier || ''))) problems.push(`container ${row.id}: tier must be one of ${lootTiers.join(', ')}`);
    if (!Array.isArray(row.loot) || !row.loot.length) problems.push(`container ${row.id}: an authored loot list is required`);
    if (row.visual && !(layout.objects || []).some(object => object.id === row.visual)) problems.push(`container ${row.id}: visual ${row.visual} is not an object of the layout`);
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const layoutFile = args.find(arg => !arg.startsWith('--'));
  if (!layoutFile) throw new Error('usage: node tools/site-apply.js <layout.json> [--check]');
  const layout = readJson(path.resolve(layoutFile));
  const lootTiers = Object.keys(readJson(LOOT_TABLES).containers || {});
  const problems = validate(layout, lootTiers);
  if (problems.length) throw new Error(`layout ${layoutFile}:\n  ${problems.join('\n  ')}`);

  const site = layout.site;
  const siteId = site.id;
  const zoneFile = path.join(ROOT, 'data', 'zones', 'authored', `${site.zone}.json`);
  if (!fs.existsSync(zoneFile)) throw new Error(`${site.zone} is not a frozen zone (data/zones/authored)`);
  const zone = readJson(zoneFile);
  const place = placer(site);
  const siteRow = normalizeSite({
    id: siteId, name: site.name || siteId, kind: site.kind || '', safe: site.safe === true,
    x: site.center.x, z: site.center.z, halfX: site.size.x / 2, halfZ: site.size.z / 2,
    rotationY: Number(site.rotationY || 0) * Math.PI / 180
  });
  const margin = Number(layout.clear?.margin ?? 6);
  // Точечная расчистка за полосой (камень-засада у выхода) — clear.points в осях площадки.
  const spots = (layout.clear?.points || []).map(point => ({ ...place(point), r: Number(point.r ?? 2) }));
  const under = (x, z) => siteContains(siteRow, x, z, margin)
    || spots.some(spot => Math.hypot(x - spot.x, z - spot.z) <= spot.r);
  const report = { site: siteId, zone: site.zone, removed: {} };
  const drop = (label, list, pointOf) => {
    if (!Array.isArray(list)) return list;
    const kept = list.filter(row => {
      const point = pointOf(row);
      return !(point && under(point.x, point.z));
    });
    if (kept.length !== list.length) report.removed[label] = list.length - kept.length;
    return kept;
  };
  const tilePoint = row => (Number.isFinite(Number(row?.x)) && Number.isFinite(Number(row?.z))
    ? { x: Number(row.x), z: Number(row.z) }
    : Number.isFinite(Number(row?.tx)) ? { x: tileCentre(row.tx), z: tileCentre(row.tz) } : null);

  // Портал места и его точка выхода больше не нужны: место стоит в секторе.
  const portals = (zone.transitions || []).filter(row => row.to === siteId).length;
  zone.transitions = (zone.transitions || []).filter(row => row.to !== siteId);
  if (portals) report.removed.portals = portals;
  const exitKey = `entryFromPlace_${siteId}`.slice(0, 32);
  if (zone[exitKey]) { delete zone[exitKey]; report.removed.exitPoint = exitKey; }

  // Прежние строки этой площадки уходят целиком — их пишет только этот инструмент.
  const ownRow = row => row?.site === siteId;
  zone.containers = drop('containers', (zone.containers || []).filter(row => !ownRow(row)), tilePoint);
  zone.anomalyFields = drop('anomalyFields', zone.anomalyFields || [], tilePoint);
  for (const list of ['spawnAreas', 'lairs', 'eventAnchors']) {
    if (zone.zone && Array.isArray(zone.zone[list])) zone.zone[list] = drop(list, zone.zone[list], tilePoint);
  }
  zone.objects = (zone.objects || []).filter(row => !ownRow(row));

  // Тропа зоны к месту кончается у его входа (approach в осях площадки), а не в ограде.
  const navNode = (zone.zone?.nav?.nodes || []).find(node => node.id === `place_${siteId}`);
  if (navNode && layout.approach) {
    const point = place(layout.approach);
    Object.assign(navNode, { tx: metresToTile(point.x), tz: metresToTile(point.z) });
    report.approach = { tx: navNode.tx, tz: navNode.tz };
  }

  zone.sites = [...(zone.sites || []).filter(row => row?.id !== siteId), {
    id: siteRow.id, name: siteRow.name, kind: siteRow.kind, safe: siteRow.safe,
    x: siteRow.x, z: siteRow.z, halfX: siteRow.halfX, halfZ: siteRow.halfZ, rotationY: siteRow.rotationY
  }].sort((a, b) => a.id.localeCompare(b.id));

  const takenIds = new Set((zone.objects || []).map(row => String(row.id || '')));
  const claim = id => {
    if (takenIds.has(id)) throw new Error(`${site.zone}: id ${id} is already used by another row of the zone`);
    takenIds.add(id);
  };

  // Тайники: строки определения, у которых вид — объект макета (sceneVisual) или
  // обычный ящик-маркер клиента.
  for (const row of layout.containers || []) {
    const point = place(row);
    zone.containers.push({
      id: row.id, name: String(row.name || 'Тайник').slice(0, 64), tier: row.tier,
      tx: metresToTile(point.x), tz: metresToTile(point.z), x: point.x, y: 0.1, z: point.z,
      rotationY: round(point.yawDeg * Math.PI / 180), locked: row.locked === true,
      ...(row.locked && row.lockDifficulty ? { lockDifficulty: row.lockDifficulty } : {}),
      loot: row.loot.map(item => ({ id: String(item.id), qty: Math.max(1, Math.round(Number(item.qty || 1))) })),
      ...(row.visual ? { sceneVisual: true } : {}),
      site: siteId
    });
  }

  // НПС — живые строки: сервер ставит по ним актёров, экспорт Unity двигает их по якорям.
  for (const npc of layout.npcs || []) {
    claim(npc.id);
    const point = place(npc);
    const named = npc.named === true;
    const entity = {
      kind: 'npc',
      ...(named ? { spawnedBy: 'named', npcId: npc.id } : {}),
      role: String(npc.role || (named ? 'civilian' : 'guard')),
      faction: String(npc.faction || 'uprava'),
      hostileToPlayer: false,
      canDialogue: named || npc.dialogue === true,
      stationary: npc.stationary !== false,
      ...(npc.service ? { service: String(npc.service) } : {}),
      ...(npc.appearance ? { appearance: { schema: 'realm.character-appearance.v1', ...npc.appearance } } : {}),
      ...(npc.equipment ? { equipment: npc.equipment } : {})
    };
    const tags = ['npc', 'living', 'friendly', ...(named ? ['unique', 'quest_giver'] : []), ...(npc.tags || [])];
    zone.objects.push({
      id: npc.id, model: 'wastelandSettler', name: String(npc.name || npc.id).slice(0, 64),
      position: { x: point.x, y: 0, z: point.z }, rotation: { x: 0, y: round(point.yawDeg * Math.PI / 180), z: 0 },
      scale: { x: 1, y: 1, z: 1 }, collision: 'solid', tags: [...new Set(tags)], footprint: { x: 2, z: 2 },
      entity, vision: { mode: 'none' }, site: siteId
    });
  }

  // Строки объектов, которым нужны свои поля сверх геометрии: имя, подсказка, цель
  // задания. Геометрию, коллизию и теги экспорт Unity допишет к ним сам.
  for (const row of layout.objects || []) {
    if (!row.name && !row.quest && !row.hover) continue;
    const id = safeId(`${siteId}_${row.id}`);
    claim(id);
    const point = place(row);
    zone.objects.push({
      id, name: String(row.name || row.id).slice(0, 64),
      position: { x: point.x, y: round(row.y || 0), z: point.z },
      rotation: { x: 0, y: round(point.yawDeg * Math.PI / 180), z: 0 },
      ...(row.quest ? { interactive: { questObjective: String(row.quest) }, questObjective: String(row.quest) } : {}),
      ...(row.hover ? { hover: row.hover } : {}),
      tags: [...new Set(['site', `site-${siteId}`, ...(row.quest ? ['quest-object'] : []), ...(row.tags || [])])],
      site: siteId
    });
  }

  const overrides = readJson(OVERRIDES);
  const sites = { ...(overrides.sites || {}) };
  sites[siteId] = site.safe === true ? { safe: true } : {};
  overrides.sites = Object.fromEntries(Object.entries(sites).sort(([a], [b]) => a.localeCompare(b)));

  report.containers = (layout.containers || []).length;
  report.npcs = (layout.npcs || []).length;
  report.objectRows = (layout.objects || []).filter(row => row.name || row.quest || row.hover).length;
  if (check) {
    console.log(JSON.stringify({ ok: true, dryRun: true, ...report }, null, 2));
    return;
  }
  writeJson(zoneFile, zone);
  writeJson(OVERRIDES, overrides);
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-zone-graph.js')], { cwd: ROOT, stdio: 'inherit' });
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
