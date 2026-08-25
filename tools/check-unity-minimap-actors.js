'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const minimap = read(game, 'RoaMinimap.cs');
const enemies = read(game, 'RoaEnemies.cs');
const hud = read(game, 'RoaHudCanvas.cs');
const mapWindow = read(game, 'RoaMapWindowCanvas.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaMinimapProbe.cs');

for (const kind of ['Enemy', 'FriendlyNpc', 'ServiceNpc']) {
  assert(minimap.includes(kind), 'Minimap marker kind is missing: ' + kind);
  assert(hud.includes('MarkerKind.' + kind), 'HUD minimap has no style for ' + kind);
  assert(mapWindow.includes('MarkerKind.' + kind), 'Map window has no style for ' + kind);
}
assert(enemies.includes('ClassifyMinimapActor(enemy.Snapshot)')
  && enemies.includes('snapshot?["hostileToPlayer"]?.ToObject<bool>() ?? true'),
  'Live actor markers are not classified by authoritative hostility');
assert(enemies.includes('MarkerKind.FriendlyNpc')
  && enemies.includes('MarkerKind.ServiceNpc')
  && enemies.includes('snapshot?["traderProfile"]')
  && enemies.includes('snapshot?["serviceAvailable"]'),
  'Friendly and service actors are not separated by server snapshot fields');
assert(probe.includes('RoaMinimapProbe.request')
  && probe.includes('public static void RunBatch()')
  && probe.includes('актёры=враг/мирный/сервис'),
  'Unity editor probe does not cover all actor marker meanings');

console.log('Unity minimap actors OK: hostile, friendly and service NPC markers are distinct');
