#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const models = read('unity-client/Assets/Scripts/Game/RoaEnemyModels.cs');
const enemies = read('unity-client/Assets/Scripts/Game/RoaEnemies.cs');
const presentation = read('unity-client/Assets/Scripts/Game/RoaKromkaMutantPresentation.cs');

const ids = ['Burned', 'Fold', 'Gari', 'Rykhlyak', 'Dustling', 'Listener', 'Mourner', 'Lantern'];
for (const id of ids) {
  assert(models.includes(`"kromka${id}"`), `Unity model registry lacks kromka${id}`);
  assert(enemies.includes(`case "kromka${id}"`), `Unity collision body lacks kromka${id}`);
  assert(presentation.includes(`Build${id}()`), `Unity silhouette lacks ${id}`);
}
assert(models.includes('{ "kromkaFold", Wasteland + "npc_ghoul.glb" }')
  && !models.includes('{ "kromkaFold", Wasteland + "npc_super_mutant.glb" }'),
  'Складни may not ship as the old supermutant silhouette');
for (const cue of ['KeratinPlate', 'BoneShoulder', 'EarLeft', 'WingLeft', 'LanternBulb', 'ColonySegment', 'EmberFissure', 'TissueLeft'])
  assert(presentation.includes(cue), `Missing top-down silhouette cue: ${cue}`);
assert(enemies.includes('mutantPresentation.Configure(row["creatureTypeId"]')
  && enemies.includes('KromkaPresentation?.SetThreat(')
  && enemies.includes('KromkaPresentation?.PlayImpact('),
  'Unity creatures must receive identity and attack telegraphs from server state');
assert(presentation.includes('PrimitiveType') && presentation.includes('LightType.Point')
  && presentation.includes('Renderer') && presentation.includes('Destroy(collider)'),
  'Lore silhouette layer must be visible without changing authoritative collision');
assert(/guid:\s*[0-9a-f]{32}/i.test(read('unity-client/Assets/Scripts/Game/RoaKromkaMutantPresentation.cs.meta')),
  'Kromka mutant presentation has no Unity GUID');

console.log('Unity Kromka mutants OK: eight top-down silhouettes and server-driven combat tells');
