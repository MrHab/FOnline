'use strict';

const { randomUUID } = require('node:crypto');
const {
  RECORD_VERSION,
  artifactIndexes,
  baseTierOfType,
  instanceProperties,
  sanitizeArtifactRecords
} = require('./artifact-instances');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function beltCapacity(player = {}, catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const beltId = String(player.equipment?.artifactBelt || '');
  return Math.max(0, Math.floor(Number(indexes.belts[beltId]?.slots || 0)));
}

// Установленные экземпляры: только стабилизированные (раскрытые) записи,
// по одному на вид — два одинаковых артефакта не складываются.
function equippedArtifactInstances(player = {}, catalog = {}, slotsOverride = null) {
  const indexes = artifactIndexes(catalog);
  const records = ownedArtifactRecords(player, catalog);
  const recordsById = Object.fromEntries(records.map(row => [row.id, row]));
  const source = Array.isArray(slotsOverride) ? slotsOverride : (Array.isArray(player.artifactSlots) ? player.artifactSlots : []);
  const slots = source.slice(0, beltCapacity(player, catalog));
  const seenTypes = new Set();
  const out = [];
  for (const recordId of slots) {
    const record = recordsById[String(recordId || '')];
    if (!record || !record.stabilized || record.hot || record.revealed !== true || seenTypes.has(record.typeId)) continue;
    const type = indexes.byId[record.typeId];
    if (!type) continue;
    const properties = instanceProperties(record, catalog);
    if (!properties) continue;
    seenTypes.add(record.typeId);
    out.push({ record, type, properties });
  }
  return out;
}

function equippedArtifactTypes(player = {}, catalog = {}) {
  return equippedArtifactInstances(player, catalog).map(row => row.type);
}

// Одинаковые эффекты разных артефактов: сильнейший полностью, остальные по 50%.
function diminishingSum(values = [], secondaryMultiplier = 0.5) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => Math.abs(b) - Math.abs(a));
  return sorted.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : secondaryMultiplier), 0);
}

// Направление пользы: у большинства эффектов «больше — лучше», но шум движения,
// расход воды, задержка регенерации, перезарядка спасения и полученная радиация
// полезны в минус. Знак нужен, чтобы отличать преимущество от недостатка.
const LOWER_IS_BETTER_EFFECTS = new Set([
  'waterUsePct',
  'movementNoisePct',
  'regenDelaySeconds',
  'lowHealthCooldownSeconds',
  'radiationOnTrigger'
]);

function artifactEffectBenefitSign(key = '') {
  return LOWER_IS_BETTER_EFFECTS.has(String(key)) ? -1 : 1;
}

/**
 * Сложение одного эффекта с нескольких артефактов: преимущества по правилу
 * «сильнейшее полностью, остальные вполовину», недостатки — полностью. Правило
 * баланса Сердцевины: снизить можно выгоду от набора, но не его цену.
 */
function combineEffectValues(values = [], benefitSign = 1, secondaryMultiplier = 0.5) {
  const benefits = [];
  let drawbacks = 0;
  for (const raw of values) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value === 0) continue;
    if (value * benefitSign > 0) benefits.push(value);
    else drawbacks += value;
  }
  return diminishingSum(benefits, secondaryMultiplier) + drawbacks;
}

function calculateArtifactEffects(player = {}, catalog = {}, slotsOverride = null) {
  const instances = equippedArtifactInstances(player, catalog, slotsOverride);
  const buckets = {};
  const resistances = {};
  const flags = {};
  const push = (key, value) => {
    if (!Number.isFinite(Number(value)) || Number(value) === 0) return;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(Number(value));
  };
  for (const instance of instances) {
    const effects = instance.properties.effects || {};
    for (const [key, value] of Object.entries(effects)) {
      if (key === 'resistances') {
        for (const [damageType, amount] of Object.entries(value || {})) {
          if (!resistances[damageType]) resistances[damageType] = [];
          resistances[damageType].push(Number(amount || 0));
        }
      } else if (typeof value === 'boolean') flags[key] = flags[key] || value;
      else push(key, value);
    }
  }
  const rules = catalog.rules || {};
  const secondary = clamp(Number(rules.secondarySimilarEffectMultiplier ?? 0.5), 0, 1);
  const get = key => combineEffectValues(buckets[key] || [], artifactEffectBenefitSign(key), secondary);
  const resolvedResistances = {};
  for (const [damageType, values] of Object.entries(resistances)) {
    resolvedResistances[damageType] = clamp(combineEffectValues(values, 1, secondary), -0.5, Number(rules.maxResistancePct || 0.6));
  }
  return {
    artifactTypeIds: instances.map(row => row.type.id),
    artifactRecordIds: instances.map(row => row.record.id),
    artifactTiers: instances.map(row => row.properties.tier),
    speedPct: clamp(get('speedPct'), -0.45, Number(rules.maxSpeedBonusPct || 0.18)),
    apRegenPct: clamp(get('apRegenPct'), -0.8, 1),
    carryKg: clamp(get('carryKg'), -30, Number(rules.maxCarryBonusKg || 30)),
    meleeDamagePct: clamp(get('meleeDamagePct'), -0.5, 1),
    maxHpFlat: clamp(get('maxHpFlat'), -100, 150),
    medkitEffectPct: clamp(get('medkitEffectPct'), -0.8, 1),
    waterUsePct: clamp(get('waterUsePct'), -0.5, 1.5),
    regenHpPerSecond: clamp(get('regenHpPerSecond'), 0, Number(rules.maxRegenHpPerSecond || 1)),
    regenDelaySeconds: Math.max(0, get('regenDelaySeconds')),
    maxApPct: clamp(get('maxApPct'), -0.6, 1),
    movementNoisePct: clamp(get('movementNoisePct'), -0.8, 1),
    hearingRangePct: clamp(get('hearingRangePct'), -0.8, 1),
    knockbackResistance: clamp(get('knockbackResistance'), 0, 0.8),
    stimDurationPct: clamp(get('stimDurationPct'), 0, 1),
    detectorTraceDurationPct: clamp(get('detectorTraceDurationPct'), 0, 1),
    lowHealthThresholdPct: clamp(get('lowHealthThresholdPct'), 0, 0.95),
    lowHealthHeal: Math.max(0, get('lowHealthHeal')),
    lowHealthDurationSeconds: Math.max(1, get('lowHealthDurationSeconds')),
    lowHealthCooldownSeconds: Math.max(1, get('lowHealthCooldownSeconds')),
    radiationOnTrigger: Math.max(0, get('radiationOnTrigger')),
    resistances: resolvedResistances,
    flags
  };
}

// Разница эффектов между текущим поясом и гипотетическим набором слотов —
// предпросмотр «что изменится», если установить/снять артефакт.
function previewArtifactEffects(player = {}, catalog = {}, nextSlots = []) {
  const before = calculateArtifactEffects(player, catalog);
  const after = calculateArtifactEffects(player, catalog, nextSlots);
  const delta = {};
  for (const key of Object.keys(after)) {
    if (typeof after[key] === 'number' && Number(after[key]) !== Number(before[key] || 0)) {
      delta[key] = Number((Number(after[key]) - Number(before[key] || 0)).toFixed(4));
    }
  }
  const resistances = {};
  for (const key of new Set([...Object.keys(before.resistances || {}), ...Object.keys(after.resistances || {})])) {
    const diff = Number(after.resistances?.[key] || 0) - Number(before.resistances?.[key] || 0);
    if (diff !== 0) resistances[key] = Number(diff.toFixed(4));
  }
  if (Object.keys(resistances).length) delta.resistances = resistances;
  return { before, after, delta };
}

function sanitizeArtifactLoadout(player = {}, catalog = {}) {
  const indexes = artifactIndexes(catalog);
  if (!player.equipment || typeof player.equipment !== 'object') player.equipment = {};
  if (!indexes.detectors[String(player.equipment.detector || '')]) player.equipment.detector = '';
  if (!indexes.belts[String(player.equipment.artifactBelt || '')]) player.equipment.artifactBelt = '';
  player.artifactRecords = ownedArtifactRecords(player, catalog);
  // Recover metadata missing from legacy transfers and commodity purchases.
  // Recovered items must be stabilized before they can grant bonuses.
  for (const row of player.inventory || []) {
    const type = indexes.byItem[row.id];
    if (!type) continue;
    const missing = Math.min(64 - player.artifactRecords.length, Math.max(0, Number(row.qty || 0)
      - player.artifactRecords.filter(record => record.itemId === row.id).length));
    for (let i = 0; i < missing; i++) player.artifactRecords.push({
      id: `artifact_record_${randomUUID()}`, itemId: row.id, typeId: type.id,
      hot: true, stabilized: false, revealed: false, tier: baseTierOfType(type), seed: '',
      sourceAnomalyType: '', sourceFieldId: '', containerId: '',
      ownerCharacterId: String(player.characterId || ''), spawnedByShiftId: '', spawnedAtMs: 0,
      acquiredAt: Date.now(), recordVersion: RECORD_VERSION
    });
  }
  const recordIds = new Set(player.artifactRecords.map(row => row.id));
  const capacity = beltCapacity(player, catalog);
  const seen = new Set();
  player.artifactSlots = (Array.isArray(player.artifactSlots) ? player.artifactSlots : [])
    .map(value => String(value || ''))
    .filter(id => id && recordIds.has(id) && !seen.has(id) && seen.add(id))
    .slice(0, capacity);
  return player;
}

function ownedArtifactRecords(player = {}, catalog = {}) {
  const counts = new Map();
  for (const row of player.inventory || []) counts.set(row.id, (counts.get(row.id) || 0) + Math.max(0, Math.floor(Number(row.qty || 0))));
  return sanitizeArtifactRecords(player.artifactRecords, catalog).filter(row => {
    const qty = counts.get(row.itemId) || 0;
    if (!qty) return false;
    counts.set(row.itemId, qty - 1);
    return true;
  });
}

function claimedArtifactIdsFromSaves(saves = {}) {
  const ids = new Set((Array.isArray(saves.claimedArtifactIds) ? saves.claimedArtifactIds : []).filter(id => typeof id === 'string' && id));
  for (const account of Object.values(saves.characters || {})) {
    for (const character of Object.values(account || {})) {
      const records = character?.state?.artifactRecords;
      for (const record of Array.isArray(records) ? records : []) if (record?.id) ids.add(String(record.id));
    }
  }
  return ids;
}

module.exports = {
  claimedArtifactIdsFromSaves,
  ownedArtifactRecords,
  artifactEffectBenefitSign,
  artifactIndexes,
  beltCapacity,
  calculateArtifactEffects,
  equippedArtifactInstances,
  equippedArtifactTypes,
  previewArtifactEffects,
  sanitizeArtifactLoadout,
  sanitizeArtifactRecords
};
