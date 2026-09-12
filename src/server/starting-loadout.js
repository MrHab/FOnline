'use strict';

const rawCharacterProgression = require('../../data/kromka/character-progression.json');
const { normalizeCharacterProgressionCatalog } = require('./kromka-character-progression');

const characterProgression = normalizeCharacterProgressionCatalog(rawCharacterProgression);
const quickStartPreset = characterProgression.quickStarts.find(row => row.id === 'independentMercenary')
  || characterProgression.quickStarts[0];
if (!quickStartPreset) throw new Error('Character progression catalog has no quick-start preset.');
const QUICK_START_SPECIAL = Object.freeze({ ...quickStartPreset.special });
const QUICK_START_SKILLS = Object.freeze([...quickStartPreset.taggedSkills]);
const QUICK_START_TRAITS = Object.freeze([...quickStartPreset.traits]);

function exactSet(values = [], expected = []) {
  if (!Array.isArray(values) || values.length !== expected.length) return false;
  const actual = new Set(values.map(String));
  return actual.size === expected.length && expected.every(value => actual.has(value));
}

function isQuickStartBuild(input = {}) {
  const special = input?.special && typeof input.special === 'object' ? input.special : {};
  if (!Object.entries(QUICK_START_SPECIAL).every(([id, value]) => Number(special[id]) === value)) return false;
  return exactSet(input.taggedSkills, QUICK_START_SKILLS)
    && exactSet(input.traits, QUICK_START_TRAITS);
}

function buildStartingLoadout(input = {}, now = Date.now()) {
  const traits = Array.isArray(input.traits) ? input.traits.map(String) : [];
  const quickStart = isQuickStartBuild(input);
  const inventory = new Map();
  const add = (id, qty) => {
    const count = Math.max(0, Math.floor(Number(qty || 0)));
    if (!id || count <= 0) return;
    inventory.set(id, (inventory.get(id) || 0) + count);
  };

  add('knife', 1);
  add('water', 1);
  add('food', 1);
  add('medkit', 1);
  add('scrap', 2);
  add('leather', 1);
  add('boots', 1);
  add('silver', traits.includes('traderStart') ? 18 : 6);
  if (quickStart) {
    add('pistol', 1);
    add('ammo9', 18);
  }
  if (traits.includes('scavengerStart')) add('scrap', 3);
  if (traits.includes('craftsmanStart')) {
    add('pickaxe', 1);
    add('axe', 1);
  }

  return {
    quickStart,
    equipment: {
      weapon: quickStart ? 'pistol' : 'fists',
      offhand: '',
      armor: 'leather',
      helmet: '',
      boots: 'boots',
      backpack: ''
    },
    inventory: [...inventory.entries()].map(([id, qty]) => ({ id, qty })),
    itemRuntime: quickStart
      ? {
          pistol: {
            baseId: 'pistol',
            loaded: 1,
            condition: 100,
            weaponMods: {},
            createdAt: Math.max(0, Number(now || 0))
          }
        }
      : {}
  };
}

function buildTutorialStartingLoadout() {
  return { inventory: [], itemRuntime: {}, equipment: {
    weapon: 'fists', offhand: '', armor: '', helmet: '', boots: '', backpack: ''
  } };
}

function buildTutorialSupplies(input = {}) {
  const loadout = buildStartingLoadout(input);
  const supplies = new Map(loadout.inventory.map(row => [row.id, row.qty]));
  // Every build learns the same actions, including custom melee builds.
  for (const [id, qty] of [['pistol', 1], ['ammo9', 24], ['medkit', 2], ['pickaxe', 1], ['axe', 1]])
    supplies.set(id, Math.max(qty, supplies.get(id) || 0));
  supplies.delete('scrap');
  return [...supplies].map(([id, qty]) => ({ id, qty }));
}

module.exports = {
  QUICK_START_SPECIAL,
  QUICK_START_SKILLS,
  QUICK_START_TRAITS,
  isQuickStartBuild,
  buildStartingLoadout,
  buildTutorialStartingLoadout,
  buildTutorialSupplies
};
