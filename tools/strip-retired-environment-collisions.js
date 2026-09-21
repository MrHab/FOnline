'use strict';

const fs = require('fs');
const path = require('path');
const {
  isRetiredEnvironmentModel
} = require('../src/server/retired-environment-models');
const { locationScenePath, readPlacedObjectMarkers } = require('./kromka-scene-markers');

const root = path.resolve(__dirname, '..');
const locationsDir = path.join(root, 'data', 'locations');

function structuralDelta(line, open, close) {
  let delta = 0;
  let quoted = false;
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === open) delta += 1;
    else if (char === close) delta -= 1;
  }
  return delta;
}

function directPropertyIndex(lines, indent, property) {
  const prefix = `${indent}"${property}"`;
  return lines.findIndex(line => line.startsWith(prefix));
}

function stripObjectBlock(block, markers) {
  const json = block.join('\n').trim().replace(/},$/, '}');
  const object = JSON.parse(json);
  if (!isRetiredEnvironmentModel(object.model)) return { block, collisions: 0, parts: 0 };

  const modelLine = block.find(line => /^\s*"model"\s*:/.test(line));
  if (!modelLine) return { block, collisions: 0, parts: 0 };
  const indent = modelLine.match(/^\s*/)[0];
  let collisions = 0;
  let parts = 0;

  // Geometry built in the Unity scene under a retired key (the oil site's pump
  // jack) keeps the collision its scene marker exports; only GLB leftovers go.
  const unityAuthoredBlocker = markers.get(String(object.id || ''))?.blocksMovement === true;
  const collisionIndex = directPropertyIndex(block, indent, 'collision');
  if (collisionIndex >= 0 && !unityAuthoredBlocker
    && String(object.collision || '').toLowerCase() !== 'none') {
    block[collisionIndex] = block[collisionIndex]
      .replace(/("collision"\s*:\s*)"[^"]*"/, '$1"none"');
    collisions += 1;
  }

  const partsIndex = directPropertyIndex(block, indent, 'collisionParts');
  if (partsIndex >= 0) {
    let balance = 0;
    let end = -1;
    for (let index = partsIndex; index < block.length; index += 1) {
      balance += structuralDelta(block[index], '[', ']');
      if (balance === 0) {
        end = index;
        break;
      }
    }
    if (end < partsIndex) throw new Error(`Unclosed collisionParts for ${object.id || object.model}`);
    const propertyHadComma = /,\s*$/.test(block[end]);
    block.splice(partsIndex, end - partsIndex + 1);
    if (!propertyHadComma) {
      for (let index = partsIndex - 1; index >= 0; index -= 1) {
        if (!block[index].trim()) continue;
        block[index] = block[index].replace(/,\s*$/, '');
        break;
      }
    }
    parts += 1;
  }

  return { block, collisions, parts };
}

function stripFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const finalEol = source.endsWith('\r\n') || source.endsWith('\n');
  const lines = source.split(/\r?\n/);
  if (finalEol) lines.pop();
  const scenePath = locationScenePath(JSON.parse(source), root);
  const markers = scenePath && fs.existsSync(scenePath) ? readPlacedObjectMarkers(scenePath) : new Map();
  const output = [];
  let depth = 0;
  let block = null;
  let collisions = 0;
  let parts = 0;

  for (const line of lines) {
    const before = depth;
    depth += structuralDelta(line, '{', '}');
    if (block == null && before === 1 && /^\s*\{\s*$/.test(line)) block = [];
    if (block != null) {
      block.push(line);
      if (depth === 1) {
        const stripped = stripObjectBlock(block, markers);
        output.push(...stripped.block);
        collisions += stripped.collisions;
        parts += stripped.parts;
        block = null;
      }
    } else {
      output.push(line);
    }
  }

  if (block != null || depth !== 0) throw new Error(`Unbalanced JSON structure: ${file}`);
  const updated = output.join(eol) + (finalEol ? eol : '');
  JSON.parse(updated);
  if (updated !== source) fs.writeFileSync(file, updated, 'utf8');
  return { collisions, parts, changed: updated !== source };
}

let collisionCount = 0;
let partCount = 0;
let fileCount = 0;
for (const name of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json')).sort()) {
  const result = stripFile(path.join(locationsDir, name));
  collisionCount += result.collisions;
  partCount += result.parts;
  if (result.changed) fileCount += 1;
}

console.log(`Retired environment collisions removed: ${collisionCount} blockers and ${partCount} exact part sets across ${fileCount} location files.`);
