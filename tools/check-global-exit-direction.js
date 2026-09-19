#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeGlobalExitDirection,
  globalExitDirectionFromTile,
  directedGlobalExitPoint
} = require('../src/server/global-exit-direction');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const wasteland = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/locations/wasteland.json'), 'utf8'));

assert.strictEqual(normalizeGlobalExitDirection('NORTH'), 'north');
assert.strictEqual(normalizeGlobalExitDirection('forged'), '');
// Сцены Кромки строятся в Unity: север — +Z, старший ряд тайлов.
assert.strictEqual(globalExitDirectionFromTile({ tx: 19, tz: 37 }, 38, 38), 'north');
assert.strictEqual(globalExitDirectionFromTile({ tx: 19, tz: 0 }, 38, 38), 'south');
assert.strictEqual(globalExitDirectionFromTile({ tx: 0, tz: 19 }, 38, 38), 'west');
assert.strictEqual(globalExitDirectionFromTile({ tx: 37, tz: 19 }, 38, 38), 'east');

const center = { x: 450, y: 450 };
const bounds = { width: 900, height: 900 };
assert.deepStrictEqual(directedGlobalExitPoint(center, 'north', 22, bounds), { x: 450, y: 428 });
assert.deepStrictEqual(directedGlobalExitPoint(center, 'south', 22, bounds), { x: 450, y: 472 });
assert.deepStrictEqual(directedGlobalExitPoint(center, 'west', 22, bounds), { x: 428, y: 450 });
assert.deepStrictEqual(directedGlobalExitPoint(center, 'east', 22, bounds), { x: 472, y: 450 });
assert.deepStrictEqual(directedGlobalExitPoint({ x: 2, y: 2 }, 'north', 22, bounds), { x: 2, y: 0 });

// Реальный выход из Караванного двора Старого Клима (узел 195:705, радиус 15):
// смещённая ось получает дробное значение, и клиент обязан разобрать его как
// число. На ru-RU Unity-клиент превращал 173.3 в "173,3" и получал 0 — точка
// уезжала на край карты (0, 705) / (195, 0), хотя сервер считал верно.
const settlementCenter = { x: 195, y: 705 };
const settlementDistance = 15 + 5.2 + 1.5;
const westExit = directedGlobalExitPoint(settlementCenter, 'west', settlementDistance, bounds);
const northExit = directedGlobalExitPoint(settlementCenter, 'north', settlementDistance, bounds);
assert.ok(Math.abs(westExit.x - 173.3) < 1e-9 && westExit.y === 705, `west exit drifted: ${JSON.stringify(westExit)}`);
assert.ok(westExit.x > 0 && !Number.isInteger(westExit.x), 'west exit must stay near the settlement with a fractional x');
assert.ok(Math.abs(northExit.y - 683.3) < 1e-9 && northExit.x === 195, `north exit drifted: ${JSON.stringify(northExit)}`);
assert.ok(northExit.y > 0 && !Number.isInteger(northExit.y), 'north exit must stay near the settlement with a fractional y');

// Unity-клиент: числовые JToken нельзя читать через token.ToString() + TryParse —
// JValue.ToString() форматирует double текущей культурой и инвариантный разбор
// "173,3" молча даёт fallback. Перед таким разбором обязан стоять путь для
// JTokenType.Integer/Float (Value<float>()) либо ToObject<>().
const unityScripts = path.join(ROOT, 'unity-client', 'Assets', 'Scripts');
if (fs.existsSync(unityScripts)) {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name))
    : (entry.name.endsWith('.cs') ? [path.join(dir, entry.name)] : []));
  const cultureSensitive = /(?:float|double|int)\.TryParse\(\s*token\.ToString\(\)/g;
  const offenders = [];
  for (const file of walk(unityScripts)) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = cultureSensitive.exec(source)) !== null) {
      const functionStart = source.lastIndexOf('private static', match.index);
      const body = source.slice(Math.max(0, functionStart), match.index);
      const guarded = /JTokenType\.(?:Integer|Float)/.test(body) || /ToObject<(?:float|double|int)>/.test(body);
      if (!guarded) offenders.push(`${path.relative(ROOT, file)}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `Unity client parses numeric JToken via token.ToString() without a culture-safe numeric path: ${offenders.join(', ')}`);
}

assert(server.includes('const exitDirection = serverGlobalExitDirection(leader);'),
  'server does not derive the exit side from the authoritative player position');
assert(!server.includes('serverGlobalExitPoint(leader, data.worldPoint'),
  'server still trusts a client world point when leaving a location');
assert(Array.isArray(wasteland.worldZones) && wasteland.worldZones.some(row => row?.id === 'world_exit_edges'),
  'wasteland test fixture must expose its authored global-map edge exit');
assert(server.includes('const innerOffset = WORLD_MAP_EXIT_BAND_TILES - 1;'),
  'server global-map exit validation does not match the client band width');

console.log('Global exit direction check passed: direction and trigger width stay aligned with every location playable bound.');
