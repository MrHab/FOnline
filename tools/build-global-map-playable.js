#!/usr/bin/env node
'use strict';

// Играбельный контур глобальной карты для сервера. Контур нарисован в сцене
// Unity (KromkaGlobalMap.unity, BoundaryLine → RoaGlobalMapBoundary) в
// локальных координатах карты; клиент по нему отбрасывает клики за краем.
// Сервер знает о нём из data/kromka/global-map-playable.json — точки
// переведены в точки карты (1 точка = 1 км): x = 10·X + ширина/2,
// y = высота/2 − 10·Z, как RoaGlobalMap.PointToWorld в обратную сторону.
//
//   node tools/build-global-map-playable.js          — записать данные
//   node tools/build-global-map-playable.js --check  — сверить данные со сценой

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCENE = 'unity-client/Assets/Scenes/Kromka/KromkaGlobalMap.unity';
const OUTPUT = 'data/kromka/global-map-playable.json';
const MAP_WORLD_SCALE = 0.1;

function sceneBlocks(text) {
  const byId = new Map();
  for (const block of text.split(/(?=^--- !u!)/m)) {
    const head = block.match(/^--- !u!(\d+) &(-?\d+)/);
    if (head) byId.set(head[2], { type: head[1], text: block });
  }
  return byId;
}

function field(block, name) {
  return block.text.match(new RegExp(`m_${name}: (\\{[^}]*\\}|\\S+)`))?.[1] || '';
}

function assertIdentityChain(byId, gameObjectId) {
  const transform = [...byId.values()].find(block => block.type === '4' && block.text.includes(`m_GameObject: {fileID: ${gameObjectId}}`));
  let current = transform;
  for (let guard = 0; current && guard < 32; guard += 1) {
    const position = field(current, 'LocalPosition');
    const rotation = field(current, 'LocalRotation');
    const scale = field(current, 'LocalScale');
    if (position !== '{x: 0, y: 0, z: 0}' || rotation !== '{x: 0, y: 0, z: 0, w: 1}' || scale !== '{x: 1, y: 1, z: 1}') {
      throw new Error(`The boundary is nested under a moved transform (${position} ${rotation} ${scale}); convert through it before exporting.`);
    }
    const father = field(current, 'Father').match(/fileID: (-?\d+)/)?.[1];
    if (!father || father === '0') return;
    current = byId.get(father);
  }
}

function extractPlayableBoundary(root = ROOT) {
  const text = fs.readFileSync(path.join(root, SCENE), 'utf8');
  const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json'), 'utf8'));
  const width = Number(map.grid.cols) * Number(map.grid.cellPoints);
  const height = Number(map.grid.rows) * Number(map.grid.cellPoints);
  const byId = sceneBlocks(text);
  const components = [...byId.values()].filter(block => block.type === '114'
    && /m_EditorClassIdentifier: Assembly-CSharp::RealmOfAshes\.World\.RoaGlobalMapBoundary/.test(block.text));
  if (components.length !== 1) throw new Error(`Expected one RoaGlobalMapBoundary in ${SCENE}, found ${components.length}.`);
  const component = components[0];
  const gameObjectId = field(component, 'GameObject').match(/fileID: (-?\d+)/)?.[1];
  assertIdentityChain(byId, gameObjectId);
  const listStart = component.text.indexOf('_localPoints:');
  const points = [];
  for (const line of component.text.slice(listStart).split(/\r?\n/).slice(1)) {
    const match = line.match(/^\s*- \{x: (-?[\d.eE+-]+), y: (-?[\d.eE+-]+), z: (-?[\d.eE+-]+)\}/);
    if (!match) break;
    const x = Number(match[1]) / MAP_WORLD_SCALE + width / 2;
    const y = height / 2 - Number(match[3]) / MAP_WORLD_SCALE;
    points.push([Number(x.toFixed(2)), Number(y.toFixed(2))]);
  }
  if (points.length < 3) throw new Error('The playable boundary has fewer than three points.');
  return {
    schema: 'kromka.globalMapPlayable.v1',
    note: 'Играбельный контур глобальной карты в точках карты (1 точка = 1 км). Источник — BoundaryLine сцены KromkaGlobalMap; обновлять: node tools/build-global-map-playable.js.',
    source: SCENE,
    width,
    height,
    points
  };
}

if (require.main === module) {
  const fresh = extractPlayableBoundary();
  const target = path.join(ROOT, OUTPUT);
  if (process.argv.includes('--check')) {
    const current = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (JSON.stringify(current.points) !== JSON.stringify(fresh.points) || current.width !== fresh.width || current.height !== fresh.height) {
      console.error(`${OUTPUT} is out of date with ${SCENE}; run node tools/build-global-map-playable.js`);
      process.exit(1);
    }
    console.log(`Global map playable boundary OK: ${fresh.points.length} points match the Unity scene.`);
  } else {
    fs.writeFileSync(target, `${JSON.stringify(fresh, null, 2)}\n`);
    console.log(`Wrote ${OUTPUT}: ${fresh.points.length} points.`);
  }
}

module.exports = { extractPlayableBoundary };
