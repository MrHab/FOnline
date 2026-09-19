#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  CANONICAL_SPECIAL_IDS,
  normalizeCharacterProgressionCatalog,
  publicCharacterProgressionCatalog,
  resolveQuickStart,
  validateCharacterDraft
} = require('../src/server/kromka-character-progression');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const raw = JSON.parse(read('data/kromka/character-progression.json'));
const catalog = normalizeCharacterProgressionCatalog(raw);
const terminology = JSON.parse(read('data/kromka/terminology.json'));

assert.equal(catalog.schema, 'realm.kromka.character-progression.v1');
assert.equal(catalog.special.budget, 40);
assert.deepEqual(catalog.special.stats.map(row => row.id), CANONICAL_SPECIAL_IDS);
assert.equal(catalog.skills.items.length, 15);
assert.equal(catalog.perks.items.length, 41);
assert.equal(catalog.startTraits.items.length, 6);
for (const group of [catalog.special.stats, catalog.skills.items, catalog.perks.items, catalog.startTraits.items]) {
  assert.equal(new Set(group.map(row => row.id)).size, group.length, 'catalog IDs must be unique');
  group.forEach(row => {
    assert(row.name && row.description, `${row.id}: visible name and description are required`);
  });
}

const expectedNames = {
  str: 'Мощь', per: 'Наблюдательность', end: 'Стойкость', cha: 'Влияние',
  int: 'Интеллект', agi: 'Реакция', luck: 'Чутьё'
};
for (const stat of catalog.special.stats) assert.equal(stat.name, expectedNames[stat.id]);
const oldNames = ['Сила', 'Восприятие', 'Выносливость', 'Харизма', 'Ловкость'];
for (const oldName of oldNames) {
  assert(!catalog.special.stats.some(row => row.name === oldName), `old visible stat name returned: ${oldName}`);
}
const visibleCatalogText = [
  ...catalog.special.stats,
  ...catalog.skills.items,
  ...catalog.perks.items,
  ...catalog.startTraits.items,
  ...catalog.quickStarts
].flatMap(row => [row.name, row.description, row.group]).filter(Boolean).join('\n');
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const rule of terminology.rules || []) {
  for (const legacy of rule.legacy || []) {
    const escaped = escapeRegExp(legacy);
    const pattern = rule.match === 'word'
      ? new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu')
      : new RegExp(escaped, 'iu');
    assert(!pattern.test(visibleCatalogText), `legacy visible catalog term returned: ${legacy}`);
  }
}

const quick = resolveQuickStart(catalog, 'quick');
assert(quick, 'legacy quick-start alias must resolve');
assert.equal(Object.values(quick.special).reduce((sum, value) => sum + value, 0), 40);
for (const alias of quick.aliases) assert.equal(resolveQuickStart(catalog, alias)?.id, quick.id);

const appearance = {
  schema: 'realm.character-appearance.v1', sex: 'male', bodyType: 'medium',
  faceId: 'male_01', hairId: 'short_crop', skinToneId: 'skin_03', hairColorId: 'hair_03'
};
const valid = validateCharacterDraft({
  appearance,
  special: quick.special,
  taggedSkills: quick.taggedSkills,
  traits: quick.traits
}, catalog);
assert.equal(valid.ok, true);
assert.equal(validateCharacterDraft({ ...valid, special: { ...quick.special, str: 4 } }, catalog).ok, false,
  'under-budget SPECIAL draft must be rejected');
assert.equal(validateCharacterDraft({ ...valid, special: { ...quick.special, str: 6 } }, catalog).ok, false,
  'over-budget SPECIAL draft must be rejected');
assert.equal(validateCharacterDraft({ ...valid, taggedSkills: ['lightWeapons', 'lightWeapons'] }, catalog).ok, false,
  'duplicate tagged skills must be rejected');
assert.deepEqual(publicCharacterProgressionCatalog(catalog), JSON.parse(JSON.stringify(catalog)));

const server = read('server.js');
for (const marker of [
  "require('./src/server/kromka-character-progression')",
  "app.get('/api/kromka/character-progression'",
  'validateCharacterDraft(data, KROMKA_CHARACTER_PROGRESSION_CATALOG)',
  'KROMKA_CHARACTER_PROGRESSION_CATALOG.skills.items.map',
  'KROMKA_CHARACTER_PROGRESSION_CATALOG.perks.items.map',
  'progressionLedger: { version: CHARACTER_PROGRESSION_MODEL_VERSION, skillSteps: {} }',
  'serverApplyProgressionProposal(p, data, { strict: true })'
]) assert(server.includes(marker), `server progression contract missing: ${marker}`);

const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const creator = read('unity-client/Assets/Scripts/Game/RoaCharacterCreator.cs');
const progression = read('unity-client/Assets/Scripts/Game/RoaProgressionData.cs');
const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
for (const marker of [
  '/api/kromka/character-progression',
  'RoaProgressionData.ApplyCatalog(catalog',
  'RoaCharacterCreator.ApplyCatalog(catalog',
  'ProgressionCatalogVersion++'
]) assert(bootstrap.includes(marker), `Unity catalog loading contract missing: ${marker}`);
assert(creator.includes('QuickStartSpecial') && creator.includes('public static string StatName(string id)'),
  'Unity creator does not consume the catalog quick-start/stat terminology');
assert(progression.includes('public static bool ApplyCatalog(JObject catalog, out string error)'),
  'Unity PIP progression definitions do not accept the server catalog');
assert(pipboy.includes('RoaCharacterCreator.StatName(talent.Stat)'),
  'Unity requirement text still exposes internal SPECIAL IDs');
assert(socket.includes('EmitWithAck("state", payload, ack =>')
  && pipboy.includes('HandleProgressionAck'),
  'Unity progression rejection reason is not returned to the player');

console.log('Kromka character progression OK: 7 stats, 15 skills, 41 perks, 40-point quick start, shared Unity/server catalog.');
