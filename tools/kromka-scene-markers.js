'use strict';

// Reads the KromkaPlacedObjectAuthoring markers of a Kromka location scene.
// KromkaWorldSceneExporter turns these flags into the server's `collision` and
// `vision`, so the scene is authored data that checks pair with data/locations.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLACED_OBJECT_SCRIPT_GUID = 'da467f951bfa613fd5b8f17562a30404';
// The collision modes locationObjectBlocksMovement() in server.js stops a player on.
const SERVER_BLOCKING_COLLISIONS = new Set(['solid', 'block', 'blocked', 'wall', 'resource']);

function collisionBlocksMovement(collision) {
  return SERVER_BLOCKING_COLLISIONS.has(String(collision || '').trim().toLowerCase());
}

function locationScenePath(definition, root = ROOT) {
  const scene = String(definition?.unityScene || '').trim();
  return scene ? path.join(root, 'unity-client', scene) : '';
}

function readPlacedObjectMarkers(scenePath) {
  const markers = new Map();
  for (const document of fs.readFileSync(scenePath, 'utf8').split(/^--- !u!/m)) {
    if (!document.startsWith('114 ') || !document.includes(`guid: ${PLACED_OBJECT_SCRIPT_GUID}`)) continue;
    const field = name => (document.match(new RegExp(`^  ${name}:[ \\t]*(.*?)\\r?$`, 'm')) || [])[1];
    const id = field('_stableObjectId') || '';
    if (!id) throw new Error(`${scenePath}: placed-object marker without _stableObjectId`);
    if (markers.has(id)) throw new Error(`${scenePath}: duplicate placed-object marker ${id}`);
    const tagBlock = document.match(/^  _gameplayTags:[ \t]*\r?\n((?:  - .*\r?\n)*)/m);
    markers.set(id, {
      id,
      archetype: field('_serverArchetypeId') || '',
      role: field('_role') || '',
      tags: tagBlock ? tagBlock[1].split(/\r?\n/).filter(Boolean).map(line => line.slice(4).trim()) : [],
      blocksMovement: field('_blocksMovement') === '1',
      blocksVision: field('_blocksVision') === '1',
      lowCover: field('_lowCover') === '1'
    });
  }
  return markers;
}

module.exports = {
  PLACED_OBJECT_SCRIPT_GUID,
  collisionBlocksMovement,
  locationScenePath,
  readPlacedObjectMarkers
};
