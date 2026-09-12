'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  QUICK_START_SPECIAL,
  QUICK_START_SKILLS,
  QUICK_START_TRAITS,
  isQuickStartBuild,
  buildStartingLoadout,
  buildTutorialStartingLoadout,
  buildTutorialSupplies
} = require('../src/server/starting-loadout');

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

const loadout = buildStartingLoadout(quick, 123456);
const items = Object.fromEntries(loadout.inventory.map(row => [row.id, row.qty]));
assert.strictEqual(loadout.quickStart, true);
assert.strictEqual(loadout.equipment.weapon, 'pistol', 'Quick start does not equip its intended pistol');
assert.strictEqual(items.pistol, 1, 'Quick start did not receive exactly one pistol');
assert.strictEqual(items.ammo9, 18, 'Quick start did not receive its authored 18 rounds');
assert.strictEqual(items.knife, 1, 'Quick start lost the universal backup knife');
assert.strictEqual(items.scrap, 5, 'Scavenger quick start lost tutorial or trait scrap');
assert.strictEqual(items.medkit, 1, 'Mercenary preparation requires one first-aid kit');
assert.strictEqual(items.food, 1, 'Mercenary preparation requires one dry ration');
assert.strictEqual(items.leather, 1, 'Mercenary preparation requires basic clothing');
assert.strictEqual(items.boots, 1, 'Mercenary preparation requires basic footwear');
assert.strictEqual(loadout.equipment.armor, 'leather');
assert.strictEqual(loadout.equipment.boots, 'boots');
assert.deepStrictEqual(loadout.itemRuntime.pistol, {
  baseId: 'pistol', loaded: 1, condition: 100, weaponMods: {}, createdAt: 123456
}, 'Quick-start pistol does not begin loaded and in full condition');

const custom = buildStartingLoadout({
  special: quick.special,
  taggedSkills: ['melee', 'repair'],
  traits: ['craftsmanStart']
}, 99);
const customItems = Object.fromEntries(custom.inventory.map(row => [row.id, row.qty]));
assert.strictEqual(custom.quickStart, false);
assert.strictEqual(custom.equipment.weapon, 'fists', 'Custom character was force-equipped with a firearm');
assert.strictEqual(customItems.pistol, undefined, 'Custom character received a bonus quick-start pistol');
assert.strictEqual(customItems.ammo9, undefined, 'Custom character received bonus quick-start ammunition');
assert.strictEqual(customItems.scrap, 2, 'Custom mercenary lost tutorial repair material');
assert.strictEqual(customItems.pickaxe, 1);
assert.strictEqual(customItems.axe, 1);
assert.deepStrictEqual(custom.itemRuntime, {});

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
for (const build of [quick, { traits: [], taggedSkills: ['melee'] }]) {
  const supplies = Object.fromEntries(buildTutorialSupplies(build).map(row => [row.id, row.qty]));
  for (const id of ['pistol', 'leather', 'boots', 'pickaxe', 'axe']) assert.equal(supplies[id], 1);
  assert.equal(supplies.ammo9, 24);
  assert.equal(supplies.medkit, 2);
  assert.equal(supplies.scrap, undefined);
}
console.log('Starting loadout OK: empty tutorial start; all builds collect their practical equipment from the crate');
