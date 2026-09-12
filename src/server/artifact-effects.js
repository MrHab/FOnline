'use strict';

const { randomUUID } = require('node:crypto');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function artifactIndexes(catalog = {}) {
  return {
    byId: Object.fromEntries((catalog.types || []).map(row => [String(row.id), row])),
    byItem: Object.fromEntries((catalog.types || []).map(row => [String(row.itemId), row])),
    detectors: Object.fromEntries((catalog.detectors || []).map(row => [String(row.itemId), row])),
    belts: Object.fromEntries((catalog.belts || []).map(row => [String(row.itemId), row]))
  };
}

function sanitizeArtifactRecords(input = [], catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const seen = new Set();
  return (Array.isArray(input) ? input : []).map((row, index) => {
    const type = indexes.byId[String(row?.typeId || '')] || indexes.byItem[String(row?.itemId || '')];
    if (!type) return null;
    const id = String(row?.id || `artifact_record_${index}`).replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 96);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      typeId: type.id,
      itemId: type.itemId,
      hot: row?.hot === true && row?.stabilized !== true,
      stabilized: row?.stabilized === true,
      containerId: String(row?.containerId || '').slice(0, 96),
      ownerCharacterId: String(row?.ownerCharacterId || '').slice(0, 96),
      spawnedByShiftId: String(row?.spawnedByShiftId || '').slice(0, 96),
      acquiredAt: Math.max(0, Number(row?.acquiredAt || 0))
    };
  }).filter(Boolean);
}

function beltCapacity(player = {}, catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const beltId = String(player.equipment?.artifactBelt || '');
  return Math.max(0, Math.floor(Number(indexes.belts[beltId]?.slots || 0)));
}

function equippedArtifactTypes(player = {}, catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const records = ownedArtifactRecords(player, catalog);
  const recordsById = Object.fromEntries(records.map(row => [row.id, row]));
  const slots = (Array.isArray(player.artifactSlots) ? player.artifactSlots : []).slice(0, beltCapacity(player, catalog));
  const seenTypes = new Set();
  const types = [];
  for (const recordId of slots) {
    const record = recordsById[String(recordId || '')];
    if (!record || !record.stabilized || record.hot || seenTypes.has(record.typeId)) continue;
    const type = indexes.byId[record.typeId];
    if (!type) continue;
    seenTypes.add(record.typeId);
    types.push(type);
  }
  return types;
}

function diminishingSum(values = []) {
  return values.reduce((sum, value, index) => sum + Number(value || 0) * (index === 0 ? 1 : 0.5), 0);
}

function calculateArtifactEffects(player = {}, catalog = {}) {
  const types = equippedArtifactTypes(player, catalog);
  const buckets = {};
  const resistances = {};
  const flags = {};
  const push = (key, value) => {
    if (!Number.isFinite(Number(value)) || Number(value) === 0) return;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(Number(value));
  };
  for (const type of types) {
    const effects = type.effects || {};
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
  const get = key => diminishingSum(buckets[key] || []);
  const resolvedResistances = {};
  for (const [damageType, values] of Object.entries(resistances)) {
    resolvedResistances[damageType] = clamp(diminishingSum(values), -0.5, Number(rules.maxResistancePct || 0.6));
  }
  return {
    artifactTypeIds: types.map(row => row.id),
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
      hot: false, stabilized: false, containerId: '', ownerCharacterId: String(player.characterId || ''),
      spawnedByShiftId: '', acquiredAt: Date.now()
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
  artifactIndexes,
  beltCapacity,
  calculateArtifactEffects,
  equippedArtifactTypes,
  sanitizeArtifactLoadout,
  sanitizeArtifactRecords
};
