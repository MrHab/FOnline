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

// A new character is created empty-handed.
function buildTutorialStartingLoadout() {
  return { inventory: [], itemRuntime: {}, equipment: {
    weapon: 'fists', offhand: '', armor: '', helmet: '', boots: '', backpack: ''
  } };
}

// Everything a new character is given: the supply crate of the tutorial yard and
// the skip-tutorial path both issue exactly this list. Every build learns the
// same actions, including the quick start and custom melee builds, so every
// build gets the same rows. The trader's marks are all a start trait changes.
function buildTutorialSupplies(input = {}) {
  const traits = Array.isArray(input.traits) ? input.traits.map(String) : [];
  return [
    ['knife', 1], ['water', 1], ['food', 1], ['medkit', 2], ['leather', 1], ['boots', 1],
    ['silver', traits.includes('traderStart') ? 18 : 6],
    ['pistol', 1], ['ammo9', 24], ['pickaxe', 1], ['axe', 1]
  ].map(([id, qty]) => ({ id, qty }));
}

module.exports = {
  QUICK_START_SPECIAL,
  QUICK_START_SKILLS,
  QUICK_START_TRAITS,
  isQuickStartBuild,
  buildTutorialStartingLoadout,
  buildTutorialSupplies
};
