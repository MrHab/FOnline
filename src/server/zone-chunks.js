'use strict';

// Куски‑заготовки конструктора зон. Кусок — участок 40×40 м с объектами набора
// (data/zones/kit.json) и якорями: тайник, ресурс, зона появления, логово, якорь
// события, аномалия. Файлы лежат в data/zones/chunks и правятся руками или
// экспортируются из Unity. Модуль чистый: читает каталог и проверяет его.

const fs = require('node:fs');
const path = require('node:path');

const SLOT_METRES = 40;
const SLOT_HALF = SLOT_METRES / 2;
const CHUNK_KINDS = Object.freeze(['filler', 'cover', 'poi', 'landmark', 'resource', 'lair', 'place']);
const ANCHOR_TYPES = Object.freeze(['container', 'resource', 'spawnArea', 'lair', 'eventAnchor', 'anomaly']);
const ROTATIONS = Object.freeze([0, 90, 180, 270]);

function fail(id, message) { throw new Error(`zone chunk "${id}": ${message}`); }
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48); }
function finite(value) { return Number.isFinite(Number(value)); }

// Префаб набора: габариты меша в его осях при масштабе 1 (size [x, z], height),
// центр меша относительно пивота в осях сервера, авторский масштаб [x, y, z] и
// доворот turn, после которого длинная сторона лежит вдоль X.
function normalizeKit(raw = {}) {
  const prefabs = {};
  const triple = (value, fallback) => (Array.isArray(value) && value.length === 3 && value.every(n => Number(n) > 0) ? value.map(Number) : fallback);
  for (const [key, row] of Object.entries(raw.prefabs || {})) {
    const id = safeId(key);
    const size = Array.isArray(row?.size) ? row.size.map(Number) : [];
    if (!id || size.length !== 2 || !size.every(n => n > 0)) throw new Error(`zone kit: prefab "${key}" needs size [x, z]`);
    const center = Array.isArray(row.center) && row.center.length === 2 ? row.center.map(Number) : [0, 0];
    const turn = Number(row.turn || 0);
    if (![0, 90, 180, 270].includes(turn)) throw new Error(`zone kit: prefab "${key}" has turn ${row.turn}`);
    prefabs[id] = Object.freeze({
      name: String(row.name || id).slice(0, 60),
      size: Object.freeze([size[0], size[1]]),
      height: Math.max(0.05, Number(row.height || 1)),
      center: Object.freeze([center[0] || 0, center[1] || 0]),
      scale: Object.freeze(triple(row.scale, [1, 1, 1])),
      turn,
      solid: row.solid === true,
      vision: row.vision === true,
      resource: row.resource ? safeId(row.resource) : '',
      hp: Math.max(1, Math.round(Number(row.hp || 5)))
    });
  }
  return Object.freeze(prefabs);
}

function normalizeChunk(raw = {}, kit = {}) {
  const id = safeId(raw.id);
  if (!id) throw new Error('zone chunk without id');
  if (raw.schema !== 'kromka.zoneChunk.v1') fail(id, 'schema must be kromka.zoneChunk.v1');
  if (!CHUNK_KINDS.includes(raw.kind)) fail(id, `kind must be one of ${CHUNK_KINDS.join(', ')}`);
  const rotations = (Array.isArray(raw.rotations) && raw.rotations.length ? raw.rotations : ROTATIONS).map(Number);
  if (!rotations.every(r => ROTATIONS.includes(r))) fail(id, 'rotations must be 0, 90, 180 or 270');
  const seen = new Set();
  const objects = (Array.isArray(raw.objects) ? raw.objects : []).map(row => {
    const objectId = safeId(row?.id);
    const prefab = safeId(row?.prefab);
    if (!objectId || seen.has(objectId)) fail(id, `object id "${row?.id}" is empty or repeated`);
    seen.add(objectId);
    if (!kit[prefab]) fail(id, `object "${objectId}" uses prefab "${row?.prefab}" that is not in the kit`);
    if (!finite(row.x) || !finite(row.z) || Math.abs(row.x) > SLOT_HALF || Math.abs(row.z) > SLOT_HALF) {
      fail(id, `object "${objectId}" must sit inside the ${SLOT_METRES} m slot`);
    }
    const scale = finite(row.s) && Number(row.s) > 0 ? Number(row.s) : 1;
    return Object.freeze({
      id: objectId, prefab, x: Number(row.x), z: Number(row.z), ry: finite(row.ry) ? Number(row.ry) : 0, s: scale,
      solid: typeof row.solid === 'boolean' ? row.solid : kit[prefab].solid,
      tags: Object.freeze((Array.isArray(row.tags) ? row.tags : []).map(safeId).filter(Boolean))
    });
  });
  const anchors = (Array.isArray(raw.anchors) ? raw.anchors : []).map(row => {
    const anchorId = safeId(row?.id);
    if (!anchorId || seen.has(anchorId)) fail(id, `anchor id "${row?.id}" is empty or repeated`);
    seen.add(anchorId);
    if (!ANCHOR_TYPES.includes(row.type)) fail(id, `anchor "${anchorId}" has unknown type "${row.type}"`);
    if (!finite(row.x) || !finite(row.z) || Math.abs(row.x) > SLOT_HALF || Math.abs(row.z) > SLOT_HALF) {
      fail(id, `anchor "${anchorId}" must sit inside the slot`);
    }
    if (row.type === 'resource' && !kit[safeId(row.prefab)]?.resource) fail(id, `resource anchor "${anchorId}" needs a kit prefab that is a resource`);
    return Object.freeze({
      id: anchorId, type: row.type, x: Number(row.x), z: Number(row.z),
      radius: finite(row.radius) ? Math.max(1, Number(row.radius)) : 0,
      prefab: safeId(row.prefab), tier: safeId(row.tier), anomalyType: safeId(row.anomalyType)
    });
  });
  // Россыпь: мелочь (кусты, камни, мусор) раскладывается конструктором по зерну зоны,
  // чтобы кусок 40×40 м не приходилось заполнять руками предмет за предметом.
  const scatter = (Array.isArray(raw.scatter) ? raw.scatter : []).map((row, index) => {
    const prefabs = (Array.isArray(row?.prefabs) ? row.prefabs : []).map(safeId);
    if (!prefabs.length || !prefabs.every(key => kit[key])) fail(id, `scatter ${index} needs kit prefabs`);
    const count = Array.isArray(row.count) ? row.count.map(Number) : [Number(row.count || 0), Number(row.count || 0)];
    if (!(count[0] >= 0 && count[1] >= count[0] && count[1] <= 80)) fail(id, `scatter ${index} count must be [min, max] up to 80`);
    const radius = Math.min(SLOT_HALF - 0.5, Math.max(1, Number(row.radius || SLOT_HALF - 1)));
    const scale = Array.isArray(row.scale) ? row.scale.map(Number) : [0.85, 1.2];
    return Object.freeze({
      prefabs: Object.freeze(prefabs), count: Object.freeze([Math.round(count[0]), Math.round(count[1])]), radius,
      x: finite(row.x) ? Number(row.x) : 0, z: finite(row.z) ? Number(row.z) : 0,
      spacing: Math.max(0.5, Number(row.spacing || 2)),
      scale: Object.freeze([Math.max(0.3, scale[0] || 1), Math.max(0.3, scale[1] || scale[0] || 1)]),
      solid: typeof row.solid === 'boolean' ? row.solid : null
    });
  });
  return Object.freeze({
    id, kind: raw.kind, name: String(raw.name || id).slice(0, 60), scatter: Object.freeze(scatter),
    biomes: Object.freeze((Array.isArray(raw.biomes) && raw.biomes.length ? raw.biomes : ['*']).map(String)),
    modes: Object.freeze((Array.isArray(raw.modes) && raw.modes.length ? raw.modes : ['*']).map(String)),
    weight: Math.max(1, Math.round(Number(raw.weight || 1))),
    maxPerZone: Math.max(1, Math.round(Number(raw.maxPerZone || 99))),
    rotations: Object.freeze(rotations), objects: Object.freeze(objects), anchors: Object.freeze(anchors)
  });
}

/** Каталог: набор префабов и куски, отсортированные по id, чтобы выбор не зависел от порядка файлов на диске. */
function loadZoneCatalog(zonesDir) {
  const kit = normalizeKit(JSON.parse(fs.readFileSync(path.join(zonesDir, 'kit.json'), 'utf8')));
  const chunkDir = path.join(zonesDir, 'chunks');
  const chunks = fs.readdirSync(chunkDir).filter(name => name.endsWith('.json')).sort()
    .map(name => {
      const chunk = normalizeChunk(JSON.parse(fs.readFileSync(path.join(chunkDir, name), 'utf8')), kit);
      if (`${chunk.id}.json` !== name) fail(chunk.id, `file must be named ${chunk.id}.json`);
      return chunk;
    });
  return Object.freeze({ kit, chunks: Object.freeze(chunks) });
}

/** Поворот точки куска вокруг центра слота по часовой стрелке, если смотреть сверху (как Y‑поворот в Unity). */
function rotatePoint(x, z, degrees) {
  switch (((degrees % 360) + 360) % 360) {
    case 90: return { x: z, z: -x };
    case 180: return { x: -x, z: -z };
    case 270: return { x: -z, z: x };
    default: return { x, z };
  }
}

/** Половины сторон прямоугольника, охватывающего повёрнутый блокер. */
function rotatedHalfExtents(width, depth, degrees) {
  const a = degrees * Math.PI / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { hx: (width * c + depth * s) / 2, hz: (width * s + depth * c) / 2 };
}

function chunkFits(chunk, biome, mode) {
  return (chunk.biomes.includes('*') || chunk.biomes.includes(biome))
    && (chunk.modes.includes('*') || chunk.modes.includes(mode));
}

module.exports = {
  ANCHOR_TYPES, CHUNK_KINDS, ROTATIONS, SLOT_METRES,
  chunkFits, loadZoneCatalog, normalizeChunk, normalizeKit, rotatePoint, rotatedHalfExtents
};
