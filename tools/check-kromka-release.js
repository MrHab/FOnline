'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { migrateSavedStateToKromka } = require('../src/server/kromka-save-migration');

const root = path.resolve(__dirname, '..');
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const source = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const map = read('data', 'global-map.json');
const migration = read('data', 'generated', 'kromka', 'save-migration.json');
const personal = read('data', 'locations', 'personalBase.json');
const siege = read('data', 'locations', 'clanSiege.json');
const clans = read('data', 'kromka', 'clan-bases.json');

assert(personal.privateInstance === true && !(map.nodes || []).some(row => row.locationId === 'personalBase' || row.id === 'personalBase'),
  'personal bases must remain private and absent from the global map');
assert(siege.privateInstance === true && siege.noGlobalMap === true, 'sieges need isolated scheduled rooms');
for (const profile of clans.bases) {
  const location = read('data', 'locations', `${profile.locationId}.json`);
  assert(location.privateInstance !== true && location.pvpMode !== 'peaceful', `${profile.locationId} is not a public clan-war location`);
}
for (const id of ['sluiceCity', 'secondHaven', 'vectorLab', 'balanceBunker', 'cascadeRegenerator']) {
  const location = read('data', 'locations', `${id}.json`);
  assert(location.objects.length >= 10, `${id} is still a placeholder rather than a lore-authored location`);
}

for (let i = 0; i < 100; i += 1) {
  const state = { worldRevision: 'legacy', globalMap: { playerX: i * 9, playerY: (99 - i) * 9 }, inventory: [{ id: 'scrap', qty: i + 1 }], artifactRecords: [{ id: `a${i}` }] };
  const before = JSON.stringify({ inventory: state.inventory, artifactRecords: state.artifactRecords });
  assert(migrateSavedStateToKromka(state, migration, map).migrated);
  assert.equal(state.worldRevision, 'kromka-1');
  assert.equal(JSON.stringify({ inventory: state.inventory, artifactRecords: state.artifactRecords }), before, 'migration lost owned state');
}

const server = source('server.js');
for (const token of ['createKromkaStateStore', 'KROMKA_STATE_STORE.recover()', 'publicKromkaOperationsMetrics', 'worldRevision: \'kromka-1\'']) {
  assert(server.includes(token), `server release contract is missing ${token}`);
}
// Стабилизация и пояс живут в ПУТНИКе: отдельной панели детектора в клиенте
// нет, её мёртвые поля убраны.
const artifactNet = source('unity-client', 'Assets', 'Scripts', 'Game', 'RoaInventory.cs');
for (const token of ['stabilizeArtifact', 'artifactLoadoutAction'])
  assert(artifactNet.includes(token), `artifact actions are missing ${token}`);
const artifactUi = source('unity-client', 'Assets', 'Scripts', 'Game', 'RoaPipboyCanvas.cs');
for (const token of ['Установить на пояс', 'Снять с пояса', 'Стабилизировать ('])
  assert(artifactUi.includes(token), `artifact UI is missing ${token}`);

console.log('Kromka release check passed: private/player bases, public clan war, save migration, operations and artifact controls.');
