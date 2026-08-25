'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isQuickStartBuild,
  buildStartingLoadout
} = require('../src/server/starting-loadout');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const unityCreator = fs.readFileSync(path.join(root,
  'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterCreator.cs'), 'utf8');

const quick = {
  special: { str: 5, per: 7, end: 6, cha: 5, int: 5, agi: 7, luck: 5 },
  taggedSkills: ['wanderer', 'lightWeapons'],
  traits: ['scavengerStart', 'trainedEye']
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
assert.strictEqual(items.scrap, 3, 'Scavenger quick start lost its trait items');
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
assert.strictEqual(customItems.pickaxe, 1);
assert.strictEqual(customItems.axe, 1);
assert.deepStrictEqual(custom.itemRuntime, {});

assert(unityCreator.includes('AdjustStat("per", 1); AdjustStat("per", 1);')
  && unityCreator.includes('AdjustStat("end", 1);')
  && unityCreator.includes('AdjustStat("agi", 1); AdjustStat("agi", 1);')
  && unityCreator.includes('ToggleSkill("lightWeapons");')
  && unityCreator.includes('ToggleSkill("wanderer");')
  && unityCreator.includes('ToggleTrait("trainedEye");')
  && unityCreator.includes('ToggleTrait("scavengerStart");'),
  'Unity quick-start preset drifted from the server-recognized template');
assert(server.includes("require('./src/server/starting-loadout')")
  && server.includes('buildStartingLoadout({ special, taggedSkills, traits }, now)')
  && server.includes('const equipment = startingLoadout.equipment;')
  && server.includes('serverInventoryRowsToObject(startingLoadout.inventory)')
  && server.includes('itemRuntime: startingLoadout.itemRuntime'),
  'Authoritative character creation is not wired to the guarded starting loadout');

console.log('Starting loadout OK: exact quick-start preset gets one loaded pistol and 18 rounds; custom builds do not');
