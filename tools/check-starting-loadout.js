'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  QUICK_START_SPECIAL,
  QUICK_START_SKILLS,
  QUICK_START_TRAITS,
  isQuickStartBuild,
  buildTutorialStartingLoadout,
  buildTutorialSupplies
} = require('../src/server/starting-loadout');
const startTraits = require('../data/kromka/character-progression.json').startTraits.items;

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const unityCreator = fs.readFileSync(path.join(root,
  'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterCreator.cs'), 'utf8');

const quick = {
  special: { ...QUICK_START_SPECIAL },
  taggedSkills: [...QUICK_START_SKILLS].reverse(),
  traits: [...QUICK_START_TRAITS].reverse()
};
assert.strictEqual(isQuickStartBuild(quick), true, 'Exact Unity quick-start build was not recognized');
assert.strictEqual(isQuickStartBuild({ ...quick, special: { ...quick.special, agi: 6 } }), false,
  'A modified SPECIAL build received the quick-start loadout');
assert.strictEqual(isQuickStartBuild({ ...quick, taggedSkills: ['lightWeapons', 'repair'] }), false,
  'A modified skill build received the quick-start loadout');
assert.strictEqual(isQuickStartBuild({ ...quick, traits: [...quick.traits, 'traderStart'] }), false,
  'A payload with an added trait received the quick-start loadout');

assert(unityCreator.includes('JObject preset = catalog["quickStarts"]?.First as JObject;')
  && unityCreator.includes('QuickStartSpecial.Clear();')
  && unityCreator.includes('QuickStartSkills = StringArray(preset["taggedSkills"] as JArray);')
  && unityCreator.includes('QuickStartTraits = StringArray(preset["traits"] as JArray);')
  && unityCreator.includes('QuickStartSpecial.TryGetValue(stat.Id, out int value)'),
  'Unity quick start is not populated from the shared catalog');
assert(server.includes("require('./src/server/starting-loadout')")
  && server.includes('buildTutorialStartingLoadout()')
  && server.includes('const equipment = startingLoadout.equipment;')
  && server.includes('serverInventoryRowsToObject(startingLoadout.inventory)')
  && server.includes('itemRuntime: startingLoadout.itemRuntime'),
  'Authoritative character creation is not wired to the guarded starting loadout');

const empty = buildTutorialStartingLoadout();
assert.deepStrictEqual(empty.inventory, []);
assert.deepStrictEqual(empty.itemRuntime, {});
assert.equal(empty.equipment.weapon, 'fists');
assert(Object.entries(empty.equipment).every(([slot, id]) => slot === 'weapon' || !id));

// The crate is the whole start, and it holds the same rows for every build: the
// quick start, a custom melee build, and each start trait. The trader's marks
// are the only difference, so a trait card may promise nothing else "на старте".
const crate = build => Object.fromEntries(buildTutorialSupplies(build).map(row => [row.id, row.qty]));
const standard = {
  knife: 1, water: 1, food: 1, medkit: 2, leather: 1, boots: 1, silver: 6,
  pistol: 1, ammo9: 24, pickaxe: 1, axe: 1
};
const builds = [quick, { traits: [], taggedSkills: ['melee'] }, { ...quick, traits: ['craftsmanStart', 'scavengerStart'] }];
for (const build of builds) {
  assert.deepStrictEqual(crate(build), standard, `The supply crate differs for traits ${JSON.stringify(build.traits)}`);
}
for (const { id } of startTraits) {
  assert.deepStrictEqual(crate({ traits: [id] }), id === 'traderStart' ? { ...standard, silver: 18 } : standard,
    `Start trait ${id} changes the supply crate: say so on its card and pin the difference here`);
}
console.log('Starting loadout OK: empty tutorial start; every build and start trait collects the same crate, only the trader\'s marks differ');
