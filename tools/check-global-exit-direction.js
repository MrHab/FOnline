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
const client = fs.readFileSync(path.join(ROOT, 'public/js/game/12b_global_map_panel_window.js'), 'utf8');
const exitVisuals = fs.readFileSync(path.join(ROOT, 'public/js/game/02d_trader_spawn_props.js'), 'utf8');
const wasteland = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/locations/wasteland.json'), 'utf8'));

assert.strictEqual(normalizeGlobalExitDirection('NORTH'), 'north');
assert.strictEqual(normalizeGlobalExitDirection('forged'), '');
assert.strictEqual(globalExitDirectionFromTile({ tx: 19, tz: 0 }, 38, 38), 'north');
assert.strictEqual(globalExitDirectionFromTile({ tx: 19, tz: 37 }, 38, 38), 'south');
assert.strictEqual(globalExitDirectionFromTile({ tx: 0, tz: 19 }, 38, 38), 'west');
assert.strictEqual(globalExitDirectionFromTile({ tx: 37, tz: 19 }, 38, 38), 'east');

const center = { x: 450, y: 450 };
const bounds = { width: 900, height: 900 };
assert.deepStrictEqual(directedGlobalExitPoint(center, 'north', 22, bounds), { x: 450, y: 428 });
assert.deepStrictEqual(directedGlobalExitPoint(center, 'south', 22, bounds), { x: 450, y: 472 });
assert.deepStrictEqual(directedGlobalExitPoint(center, 'west', 22, bounds), { x: 428, y: 450 });
assert.deepStrictEqual(directedGlobalExitPoint(center, 'east', 22, bounds), { x: 472, y: 450 });
assert.deepStrictEqual(directedGlobalExitPoint({ x: 2, y: 2 }, 'north', 22, bounds), { x: 2, y: 0 });

assert(server.includes('const exitDirection = serverGlobalExitDirection(leader);'),
  'server does not derive the exit side from the authoritative player position');
assert(!server.includes('serverGlobalExitPoint(leader, data.worldPoint'),
  'server still trusts a client world point when leaving a location');
assert(client.includes('exitDirection,\n        worldPoint: globalMapPlayerPoint()'),
  'client does not report the local edge used to leave the location');
assert(Array.isArray(wasteland.worldZones) && wasteland.worldZones.some(row => row?.id === 'world_exit_edges'),
  'wasteland test fixture must expose its authored global-map edge exit');
assert(!client.includes("if (currentLocation.id === 'wasteland') return false;"),
  'wasteland edge exits are still disabled on the client');
assert(!exitVisuals.includes("if (currentLocation.id === 'wasteland') return;"),
  'wasteland global-map exit bands are still hidden');

console.log('Global exit direction check passed: north, south, west and east stay aligned across maps, including the Ash Forest.');
