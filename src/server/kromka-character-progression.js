'use strict';

const CHARACTER_PROGRESSION_SCHEMA = 'realm.kromka.character-progression.v1';
const CHARACTER_PROGRESSION_MODEL_VERSION = 1;
const CANONICAL_SPECIAL_IDS = Object.freeze(['str', 'per', 'end', 'cha', 'int', 'agi', 'luck']);

function finiteInt(value, fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function cleanId(value, maxLength = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, maxLength);
}

function cleanText(value, fallback = '', maxLength = 1200) {
  const text = String(value ?? '').trim().slice(0, maxLength);
  return text || fallback;
}

function uniqueRows(rows = [], normalizer) {
  const out = [];
  const ids = new Set();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizer(raw || {});
    if (!row?.id || ids.has(row.id)) continue;
    ids.add(row.id);
    out.push(row);
  }
  return out;
}

function normalizeRequirements(input = {}, skillIds = new Set(), perkIds = new Set()) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = { level: finiteInt(source.level, 1, 1, 200) };
  for (const id of CANONICAL_SPECIAL_IDS) {
    const value = finiteInt(source[id], 0, 0, 99);
    if (value > 0) out[id] = value;
  }
  const skills = {};
  for (const [rawId, rawValue] of Object.entries(source.skill || {})) {
    const id = cleanId(rawId);
    if (!skillIds.has(id)) continue;
    const value = finiteInt(rawValue, 0, 0, 100);
    if (value > 0) skills[id] = value;
  }
  if (Object.keys(skills).length) out.skill = skills;
  const talents = (Array.isArray(source.talent) ? source.talent : [source.talent])
    .map(value => cleanId(value))
    .filter((id, index, all) => id && perkIds.has(id) && all.indexOf(id) === index);
  if (talents.length) out.talent = talents;
  return out;
}

function assertExactIds(label, actual, expected) {
  if (actual.length !== expected.length || expected.some(id => !actual.includes(id))) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function normalizeCharacterProgressionCatalog(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  if (source.schema !== CHARACTER_PROGRESSION_SCHEMA) {
    throw new Error(`Character progression schema must be ${CHARACTER_PROGRESSION_SCHEMA}.`);
  }

  const specialSource = source.special || {};
  const stats = uniqueRows(specialSource.stats, raw => ({
    id: cleanId(raw.id),
    code: cleanText(raw.code, cleanId(raw.id).toUpperCase(), 8),
    name: cleanText(raw.name, cleanId(raw.id), 80),
    description: cleanText(raw.description, '', 1200)
  }));
  assertExactIds('character stats', stats.map(row => row.id), CANONICAL_SPECIAL_IDS);

  const skillsSource = source.skills || {};
  const skills = uniqueRows(skillsSource.items, raw => ({
    id: cleanId(raw.id),
    name: cleanText(raw.name, cleanId(raw.id), 100),
    group: cleanText(raw.group, 'Прочее', 80),
    description: cleanText(raw.description, '', 1200)
  }));
  if (skills.length !== 16) throw new Error(`Character progression must define 16 skills, got ${skills.length}.`);
  const skillIds = new Set(skills.map(row => row.id));

  const traitsSource = source.startTraits || {};
  const traits = uniqueRows(traitsSource.items, raw => ({
    id: cleanId(raw.id),
    name: cleanText(raw.name, cleanId(raw.id), 100),
    description: cleanText(raw.description, '', 1200)
  }));
  if (traits.length !== 6) throw new Error(`Character progression must define 6 start traits, got ${traits.length}.`);
  const traitIds = new Set(traits.map(row => row.id));

  const rawPerks = uniqueRows(source.perks?.items, raw => ({
    id: cleanId(raw.id),
    name: cleanText(raw.name, cleanId(raw.id), 100),
    group: cleanText(raw.group, 'Прочее', 80),
    maxRank: finiteInt(raw.maxRank, 1, 1, 20),
    rawRequirements: raw.requirements,
    description: cleanText(raw.description, '', 1600)
  }));
  if (rawPerks.length !== 41) throw new Error(`Character progression must define 41 perks, got ${rawPerks.length}.`);
  const perkIds = new Set(rawPerks.map(row => row.id));
  const perks = rawPerks.map(({ rawRequirements, ...row }) => ({
    ...row,
    requirements: normalizeRequirements(rawRequirements, skillIds, perkIds)
  }));

  const min = finiteInt(specialSource.min, 1, 1, 10);
  const max = finiteInt(specialSource.max, 10, min, 20);
  const budget = finiteInt(specialSource.budget, 40, min * stats.length, max * stats.length);
  const effectiveMax = finiteInt(specialSource.effectiveMax, 15, max, 30);
  const taggedMin = finiteInt(source.taggedSkills?.min, 1, 0, skills.length);
  const taggedMax = finiteInt(source.taggedSkills?.max, 2, taggedMin, skills.length);
  const traitMin = finiteInt(traitsSource.min, 1, 0, traits.length);
  const traitMax = finiteInt(traitsSource.max, 2, traitMin, traits.length);

  const quickStarts = uniqueRows(source.quickStarts, raw => {
    const special = {};
    for (const id of CANONICAL_SPECIAL_IDS) special[id] = finiteInt(raw.special?.[id], 5, min, max);
    const taggedSkills = (Array.isArray(raw.taggedSkills) ? raw.taggedSkills : [])
      .map(value => cleanId(value)).filter((id, index, all) => skillIds.has(id) && all.indexOf(id) === index)
      .slice(0, taggedMax);
    const selectedTraits = (Array.isArray(raw.traits) ? raw.traits : [])
      .map(value => cleanId(value)).filter((id, index, all) => traitIds.has(id) && all.indexOf(id) === index)
      .slice(0, traitMax);
    return {
      id: cleanId(raw.id),
      aliases: (Array.isArray(raw.aliases) ? raw.aliases : []).map(value => cleanId(value))
        .filter((id, index, all) => id && all.indexOf(id) === index),
      name: cleanText(raw.name, cleanId(raw.id), 100),
      special,
      taggedSkills,
      traits: selectedTraits
    };
  });
  for (const preset of quickStarts) {
    const total = CANONICAL_SPECIAL_IDS.reduce((sum, id) => sum + preset.special[id], 0);
    if (total !== budget) throw new Error(`Quick-start ${preset.id} spends ${total}/${budget} character points.`);
    if (preset.taggedSkills.length < taggedMin || preset.traits.length < traitMin) {
      throw new Error(`Quick-start ${preset.id} does not satisfy character selection minimums.`);
    }
  }

  const catalog = {
    schema: CHARACTER_PROGRESSION_SCHEMA,
    version: finiteInt(source.version, CHARACTER_PROGRESSION_MODEL_VERSION, 1, 9999),
    modelVersion: CHARACTER_PROGRESSION_MODEL_VERSION,
    special: { budget, min, max, effectiveMax, stats },
    taggedSkills: {
      min: taggedMin,
      max: taggedMax,
      bonusPercent: finiteInt(source.taggedSkills?.bonusPercent, 5, 0, 50)
    },
    startTraits: { min: traitMin, max: traitMax, items: traits },
    skills: { pointsPerLevel: finiteInt(skillsSource.pointsPerLevel, 5, 0, 100), items: skills },
    perks: {
      levelInterval: finiteInt(source.perks?.levelInterval, 3, 1, 100),
      items: perks
    },
    quickStarts
  };
  return Object.freeze(catalog);
}

function publicCharacterProgressionCatalog(catalog) {
  return JSON.parse(JSON.stringify(catalog));
}

function exactUniqueIds(values, allowed) {
  if (!Array.isArray(values)) return null;
  const out = values.map(value => cleanId(value));
  if (out.some(id => !id || !allowed.has(id))) return null;
  if (new Set(out).size !== out.length) return null;
  return out;
}

function validateCharacterDraft(data = {}, catalog) {
  if (!catalog) return { ok: false, error: 'Каталог развития персонажа недоступен.' };
  const source = data && typeof data === 'object' ? data : {};
  const stats = catalog.special.stats;
  const rawSpecial = source.special;
  if (!rawSpecial || typeof rawSpecial !== 'object' || Array.isArray(rawSpecial)) {
    return { ok: false, error: 'Распределите характеристики персонажа.' };
  }
  const special = {};
  for (const stat of stats) {
    const raw = Number(rawSpecial[stat.id]);
    if (!Number.isInteger(raw) || raw < catalog.special.min || raw > catalog.special.max) {
      return {
        ok: false,
        error: `${stat.name}: нужно целое значение от ${catalog.special.min} до ${catalog.special.max}.`
      };
    }
    special[stat.id] = raw;
  }
  const total = stats.reduce((sum, stat) => sum + special[stat.id], 0);
  if (total !== catalog.special.budget) {
    return { ok: false, error: `Характеристики должны использовать ровно ${catalog.special.budget} очков; сейчас ${total}.` };
  }

  const skillIds = new Set(catalog.skills.items.map(row => row.id));
  const taggedSkills = exactUniqueIds(source.taggedSkills, skillIds);
  if (!taggedSkills || taggedSkills.length < catalog.taggedSkills.min || taggedSkills.length > catalog.taggedSkills.max) {
    return {
      ok: false,
      error: `Выберите от ${catalog.taggedSkills.min} до ${catalog.taggedSkills.max} разных профильных навыков.`
    };
  }
  const traitIds = new Set(catalog.startTraits.items.map(row => row.id));
  const traits = exactUniqueIds(source.traits, traitIds);
  if (!traits || traits.length < catalog.startTraits.min || traits.length > catalog.startTraits.max) {
    return {
      ok: false,
      error: `Выберите от ${catalog.startTraits.min} до ${catalog.startTraits.max} разных стартовых перков.`
    };
  }
  return { ok: true, special, taggedSkills, traits };
}

function resolveQuickStart(catalog, value = '') {
  const id = cleanId(value);
  if (!id || !catalog) return null;
  return catalog.quickStarts.find(row => row.id === id || row.aliases.includes(id)) || null;
}

module.exports = {
  CANONICAL_SPECIAL_IDS,
  CHARACTER_PROGRESSION_MODEL_VERSION,
  CHARACTER_PROGRESSION_SCHEMA,
  normalizeCharacterProgressionCatalog,
  publicCharacterProgressionCatalog,
  resolveQuickStart,
  validateCharacterDraft
};
