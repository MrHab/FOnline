#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));
const catalog = readJson('data/mutants.json');
const encounters = readJson('data/encounters.json');
const server = read('server.js');

assert.strictEqual(catalog.schema, 'kromka.mutants.v1');
const required = ['burned', 'fold', 'gari', 'rykhlyak', 'listener', 'mourner', 'lantern', 'dustling'];
assert.deepStrictEqual(catalog.types.map(row => row.id).sort(), required.slice().sort(),
  'Kromka needs exactly its eight canonical creature types');
assert.deepStrictEqual(catalog.legacyAliases, {
  ghoul: 'burned',
  superMutant: 'fold',
  ashWolf: 'gari',
  radScorpion: 'rykhlyak',
  mutantAnt: 'dustling',
  gecko: 'listener',
  fireGecko: 'mourner'
}, 'Legacy creatures need stable migration aliases');

for (const creature of catalog.types) {
  assert(creature.displayName && creature.pluralName && creature.description.length >= 55,
    `${creature.id}: identity and ecology must be authored`);
  for (const key of ['hp', 'attack', 'speed', 'xp', 'scale'])
    assert(Number.isFinite(creature.stats?.[key]), `${creature.id}: missing stat ${key}`);
  assert(creature.senses?.hearingShotRange > 0 && creature.senses?.visionRange >= 0,
    `${creature.id}: senses must be concrete`);
  assert(Array.isArray(creature.attacks) && creature.attacks.length >= 1
    && creature.attacks.every(row => row.id && row.damageType && row.telegraphMs > 0),
  `${creature.id}: attacks need readable server timing`);
  for (const damageType of ['physical', 'ballistic', 'energy', 'toxic', 'radiation', 'anomaly'])
    assert(Number.isFinite(creature.resistances?.[damageType]), `${creature.id}: missing ${damageType} resistance`);
  assert(creature.injuryProfile && creature.loot?.table && Number.isFinite(creature.loot?.trophyQty),
    `${creature.id}: injury and trophy profiles are required`);
  assert(creature.modelKey === `kromka${creature.id === 'rykhlyak' ? 'Rykhlyak' : creature.id[0].toUpperCase() + creature.id.slice(1)}`,
    `${creature.id}: unexpected canonical model key`);
}

assert.strictEqual(catalog.types.find(row => row.id === 'burned').classification, 'human',
  'Выжженные remain human in gameplay classification');
assert.strictEqual(catalog.types.find(row => row.id === 'lantern').hostileByDefault, false,
  'Фонарники must remain peaceful by default');
assert(catalog.types.find(row => row.id === 'listener').senses.hearingShotRange >= 20
  && catalog.types.find(row => row.id === 'listener').senses.visionRange <= 3,
  'Слухачи must be blind and hearing-driven');

const used = new Set();
const obsoleteNames = /гул|супермутант|радскорпион|мутировавш(?:ий|ие) мурав|геккон|пепельн(?:ый|ые) волк/i;
for (const encounter of Object.values(encounters.encounters || {})) {
  assert(!obsoleteNames.test(encounter.name || ''), `Released encounter retains an obsolete creature name: ${encounter.name}`);
  for (const actor of encounter.actors || []) {
    assert(!obsoleteNames.test(actor.name || ''), `Released actor retains an obsolete creature name: ${actor.name}`);
    if (!actor.creatureTypeId) continue;
    assert(required.includes(actor.creatureTypeId), `${actor.name}: unknown creatureTypeId`);
    used.add(actor.creatureTypeId);
  }
}
assert.deepStrictEqual([...used].sort(), required.slice().sort(),
  'Every canonical creature needs a released encounter');
assert(server.includes('creatureTypeId: String(opts.creatureTypeId || type.creatureTypeId')
  && server.includes('creatureTypeId: String(e.creatureTypeId ||')
  && server.includes('KROMKA_MUTANT_BY_ID[String(enemy?.creatureTypeId ||'),
  'Server must spawn, replicate and mitigate damage by explicit creatureTypeId');
assert(server.includes('injuryProfile: attackProfile.injuryProfile')
  && server.includes('attackId: String(attackProfile.attackId ||'),
  'Canonical attack and injury profiles are not used by authoritative combat');

console.log('Kromka mutants OK: eight explicit species, encounters, combat profiles and migration aliases');
