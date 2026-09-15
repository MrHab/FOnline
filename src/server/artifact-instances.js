'use strict';

// Экземпляры артефактов. Каждая запись — один физический артефакт со своим
// тиром и seed; свойства не хранятся, а детерминированно выводятся из
// (вид, тир, seed), поэтому клиент не может их подделать, а до стабилизации
// они вообще не покидают сервер (см. publicArtifactRecord).

const { hash32 } = require('./shift-cycle');

const RECORD_VERSION = 2;
const RARITY_BASE_TIER = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
const TIER_COLORS = ['', '#8a939b', '#d8d2c0', '#efd078', '#9fd7ff', '#ff9a54'];

// Полярность числовых эффектов: положительное значение — польза или цена?
const BENEFIT_WHEN_POSITIVE = new Set([
  'speedPct', 'apRegenPct', 'carryKg', 'meleeDamagePct', 'maxHpFlat', 'medkitEffectPct',
  'regenHpPerSecond', 'maxApPct', 'hearingRangePct', 'knockbackResistance', 'stimDurationPct',
  'detectorTraceDurationPct', 'lowHealthHeal'
]);
const BENEFIT_WHEN_NEGATIVE = new Set([
  'movementNoisePct', 'waterUsePct', 'regenDelaySeconds', 'radiationOnTrigger', 'lowHealthCooldownSeconds'
]);

/**
 * Направление пользы эффекта: +1 — «больше лучше», −1 — «меньше лучше».
 * Один источник правды для масштабирования экземпляра и для сложения набора:
 * по нему же отличают преимущество от недостатка.
 */
function artifactEffectBenefitSign(key = '') {
  return BENEFIT_WHEN_NEGATIVE.has(String(key)) ? -1 : 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function cleanId(value = '', max = 96) {
  return String(value || '').replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, max);
}

function artifactIndexes(catalog = {}) {
  return {
    byId: Object.fromEntries((catalog.types || []).map(row => [String(row.id), row])),
    byItem: Object.fromEntries((catalog.types || []).map(row => [String(row.itemId), row])),
    detectors: Object.fromEntries((catalog.detectors || []).map(row => [String(row.itemId), row])),
    belts: Object.fromEntries((catalog.belts || []).map(row => [String(row.itemId), row]))
  };
}

function tierRows(catalog = {}) {
  const rows = Array.isArray(catalog.tiers) ? catalog.tiers : [];
  const out = [];
  for (let tier = 1; tier <= 5; tier += 1) {
    const row = rows.find(entry => Number(entry?.tier) === tier) || {};
    out.push({
      tier,
      short: String(row.short || `Т${tier}`),
      displayName: String(row.displayName || `Тир ${tier}`),
      color: String(row.color || TIER_COLORS[tier]),
      benefitScale: Math.max(0.1, Number(row.benefitScale || 1)),
      drawbackScale: Math.max(0.1, Number(row.drawbackScale || 1)),
      stabilization: row.stabilization && typeof row.stabilization === 'object' ? row.stabilization : { silver: 0, items: [] },
      salvage: row.salvage && typeof row.salvage === 'object' ? row.salvage : { items: [], familyComponentQty: 0 }
    });
  }
  return out;
}

function tierRow(catalog = {}, tier = 1) {
  const rows = tierRows(catalog);
  return rows[clamp(Math.floor(Number(tier || 1)), 1, 5) - 1];
}

function tierColor(catalog = {}, tier = 1) {
  return tierRow(catalog, tier).color;
}

function baseTierOfType(type = {}) {
  const explicit = Math.floor(Number(type?.baseTier || 0));
  if (explicit >= 1 && explicit <= 5) return explicit;
  return RARITY_BASE_TIER[String(type?.rarity || 'common')] || 1;
}

function unit(seed = '', salt = '') {
  return hash32(`${seed}:${salt}`) / 0xffffffff;
}

// Тир экземпляра: не ниже базового тира вида и внутри диапазона поля.
function rollTier(type = {}, range = null, seed = '', catalog = {}) {
  const base = baseTierOfType(type);
  const min = clamp(Math.max(base, Math.floor(Number(range?.[0] || base))), 1, 5);
  const max = clamp(Math.max(min, Math.floor(Number(range?.[1] || min))), min, 5);
  const weights = Array.isArray(catalog.instanceRoll?.tierOffsetWeights) && catalog.instanceRoll.tierOffsetWeights.length
    ? catalog.instanceRoll.tierOffsetWeights.map(Number)
    : [0.55, 0.3, 0.15];
  let cursor = unit(seed, 'tier') * weights.slice(0, max - min + 1).reduce((sum, weight) => sum + Math.max(0, weight), 0);
  let tier = min;
  for (let offset = 0; offset <= max - min; offset += 1) {
    cursor -= Math.max(0, Number(weights[offset] || 0));
    tier = min + offset;
    if (cursor <= 0) break;
  }
  return clamp(tier, min, max);
}

function scaleValue(key, value, benefitMul, drawbackMul) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return number;
  const positiveBenefit = BENEFIT_WHEN_POSITIVE.has(key);
  const negativeBenefit = BENEFIT_WHEN_NEGATIVE.has(key);
  if (!positiveBenefit && !negativeBenefit) return number;
  const benefit = (positiveBenefit && number > 0) || (negativeBenefit && number < 0);
  return Number((number * (benefit ? benefitMul : drawbackMul)).toFixed(4));
}

// Свойства экземпляра. Записи без seed (миграция старых сохранений и
// «восстановленные» строки инвентаря) получают ровно базовые значения вида
// на его базовом тире, поэтому старые персонажи ничего не теряют.
function instanceProperties(record = {}, catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const type = indexes.byId[String(record?.typeId || '')] || indexes.byItem[String(record?.itemId || '')];
  if (!type) return null;
  const tiers = tierRows(catalog);
  const base = baseTierOfType(type);
  const tier = clamp(Math.floor(Number(record?.tier || base)), 1, 5);
  const seed = String(record?.seed || '');
  const spreadB = clamp(Number(catalog.instanceRoll?.benefitSpread ?? 0.3), 0, 0.9);
  const spreadD = clamp(Number(catalog.instanceRoll?.drawbackSpread ?? 0.3), 0, 0.9);
  const qBenefit = seed ? unit(seed, 'benefit') : 0.5;
  const qDrawback = seed ? unit(seed, 'drawback') : 0.5;
  const benefitMul = Number(((tiers[tier - 1].benefitScale / tiers[base - 1].benefitScale) * (1 + (qBenefit - 0.5) * spreadB)).toFixed(4));
  const drawbackMul = Number(((tiers[tier - 1].drawbackScale / tiers[base - 1].drawbackScale) * (1 - (qDrawback - 0.5) * spreadD)).toFixed(4));
  const effects = {};
  const primary = [];
  const drawback = [];
  for (const [key, value] of Object.entries(type.effects || {})) {
    if (key === 'resistances') {
      effects.resistances = {};
      for (const [damageType, amount] of Object.entries(value || {})) {
        const scaled = Number(amount) > 0
          ? Number((Number(amount) * benefitMul).toFixed(4))
          : Number((Number(amount) * drawbackMul).toFixed(4));
        effects.resistances[damageType] = scaled;
        (scaled > 0 ? primary : drawback).push({ key: `resistances.${damageType}`, value: scaled });
      }
    } else if (typeof value === 'boolean') {
      effects[key] = value;
    } else {
      const scaled = scaleValue(key, value, benefitMul, drawbackMul);
      effects[key] = scaled;
      const positiveBenefit = BENEFIT_WHEN_POSITIVE.has(key);
      const negativeBenefit = BENEFIT_WHEN_NEGATIVE.has(key);
      if ((positiveBenefit && scaled > 0) || (negativeBenefit && scaled < 0)) primary.push({ key, value: scaled });
      else if ((positiveBenefit && scaled < 0) || (negativeBenefit && scaled > 0)) drawback.push({ key, value: scaled });
    }
  }
  return {
    typeId: type.id,
    tier,
    quality: Number(((qBenefit + (1 - qDrawback)) / 2).toFixed(3)),
    benefitMul,
    drawbackMul,
    effects,
    primary: primary[0] || null,
    secondary: primary.slice(1),
    drawback
  };
}

function itemRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({ id: cleanId(row?.id, 64), qty: Math.max(0, Math.floor(Number(row?.qty || 0))) }))
    .filter(row => row.id && row.qty > 0);
}

function familyComponentId(type = {}, catalog = {}) {
  const family = catalog.families?.[String(type?.family || '')];
  return cleanId(family?.componentItemId || '', 64);
}

function stabilizationCost(record = {}, catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const type = indexes.byId[String(record?.typeId || '')];
  const row = tierRow(catalog, record?.tier || baseTierOfType(type || {}));
  const items = itemRows(row.stabilization.items);
  const componentQty = Math.max(0, Math.floor(Number(row.stabilization.familyComponentQty || 0)));
  const componentId = type ? familyComponentId(type, catalog) : '';
  if (componentQty > 0 && componentId) items.push({ id: componentId, qty: componentQty });
  return { silver: Math.max(0, Math.floor(Number(row.stabilization.silver || 0))), items };
}

function salvageYields(record = {}, catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const type = indexes.byId[String(record?.typeId || '')];
  const row = tierRow(catalog, record?.tier || baseTierOfType(type || {}));
  const items = itemRows(row.salvage.items);
  const componentQty = Math.max(0, Math.floor(Number(row.salvage.familyComponentQty || 0)));
  const componentId = type ? familyComponentId(type, catalog) : '';
  if (componentQty > 0 && componentId) items.push({ id: componentId, qty: componentQty });
  return items;
}

function sanitizeArtifactRecords(input = [], catalog = {}) {
  const indexes = artifactIndexes(catalog);
  const seen = new Set();
  return (Array.isArray(input) ? input : []).map((row, index) => {
    const type = indexes.byId[String(row?.typeId || '')] || indexes.byItem[String(row?.itemId || '')];
    if (!type) return null;
    const id = cleanId(row?.id || `artifact_record_${index}`);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const legacy = Math.floor(Number(row?.recordVersion || 0)) < RECORD_VERSION;
    const stabilized = row?.stabilized === true && row?.hot !== true;
    const base = baseTierOfType(type);
    const legacyRarity = String(row?.rarity || '').toLowerCase();
    const legacyTier = RARITY_BASE_TIER[legacyRarity] || base;
    const tierInput = Math.floor(Number(row?.tier || 0));
    return {
      id,
      typeId: type.id,
      itemId: type.itemId,
      hot: !stabilized,
      stabilized,
      // Инвариант: раскрытие свойств и есть стабилизация. Подделать
      // revealed без stabilized (или наоборот) в сохранении нельзя.
      revealed: stabilized,
      // Миграция старой записи: тир берётся из её прежней редкости (common → Т1,
      // uncommon → Т2, rare → Т3), иначе редкая находка старого мира
      // обесценивалась бы до обычной. Зерно остаётся пустым намеренно: без него
      // свойства равны авторским базовым значениям вида, то есть у старого
      // артефакта они не меняются задним числом. Новые экземпляры рождаются с
      // зерном и катятся как положено.
      tier: tierInput >= 1 && tierInput <= 5 ? tierInput : (legacy ? legacyTier : base),
      seed: legacy ? String(row?.seed || '') : String(row?.seed || '').slice(0, 160),
      sourceAnomalyType: cleanId(row?.sourceAnomalyType, 32),
      sourceFieldId: cleanId(row?.sourceFieldId, 96),
      containerId: '',
      ownerCharacterId: String(row?.ownerCharacterId || '').slice(0, 96),
      spawnedByShiftId: String(row?.spawnedByShiftId || '').slice(0, 96),
      spawnedAtMs: Math.max(0, Math.floor(Number(row?.spawnedAtMs || 0))),
      acquiredAt: Math.max(0, Number(row?.acquiredAt || 0)),
      recordVersion: RECORD_VERSION
    };
  }).filter(Boolean);
}

function stabilizeRecord(record = {}) {
  record.hot = false;
  record.stabilized = true;
  record.revealed = true;
  record.containerId = '';
  return record;
}

// Проекция для клиента: seed никогда не уходит, свойства — только после
// стабилизации. Вид, тир, цвет и стоимость услуг видны всегда.
function publicArtifactRecord(record = {}, catalog = {}, options = {}) {
  const indexes = artifactIndexes(catalog);
  const type = indexes.byId[String(record?.typeId || '')];
  const tier = tierRow(catalog, record?.tier || baseTierOfType(type || {}));
  const revealed = record?.revealed === true && record?.stabilized === true;
  const out = {
    id: String(record?.id || ''),
    typeId: String(record?.typeId || ''),
    itemId: String(record?.itemId || ''),
    displayName: String(type?.displayName || ''),
    hot: record?.hot === true,
    stabilized: record?.stabilized === true,
    revealed,
    tier: tier.tier,
    tierShort: tier.short,
    tierName: tier.displayName,
    tierColor: tier.color,
    family: String(type?.family || ''),
    sourceAnomalyType: String(record?.sourceAnomalyType || ''),
    ownerCharacterId: String(record?.ownerCharacterId || ''),
    acquiredAt: Math.max(0, Number(record?.acquiredAt || 0)),
    stabilizationCost: stabilizationCost(record, catalog),
    salvageYields: salvageYields(record, catalog),
    recordVersion: RECORD_VERSION
  };
  if (revealed || options.includeHidden === true) {
    const properties = instanceProperties(record, catalog);
    if (properties) {
      out.properties = properties;
      out.benefit = String(type?.benefit || '');
      out.cost = String(type?.cost || '');
    }
  }
  return out;
}

function publicArtifactCatalog(catalog = {}) {
  return {
    schema: String(catalog.schema || 'kromka.artifacts.v2'),
    version: Math.max(1, Math.floor(Number(catalog.version || 1))),
    tiers: tierRows(catalog).map(row => ({ tier: row.tier, short: row.short, displayName: row.displayName, color: row.color })),
    families: Object.fromEntries(Object.entries(catalog.families || {}).map(([id, row]) => [id, {
      displayName: String(row?.displayName || id), componentItemId: String(row?.componentItemId || '')
    }])),
    anomalySources: Object.fromEntries(Object.entries(catalog.anomalySources || {}).map(([anomaly, ids]) => [anomaly, (Array.isArray(ids) ? ids : []).map(String)])),
    stabilization: {
      serviceId: String(catalog.stabilization?.serviceId || 'artifactLab'),
      personalBaseAllowed: catalog.stabilization?.personalBaseAllowed !== false,
      costByTier: tierRows(catalog).map(row => ({ tier: row.tier, silver: Math.max(0, Math.floor(Number(row.stabilization.silver || 0))), items: itemRows(row.stabilization.items) }))
    },
    salvage: tierRows(catalog).map(row => ({ tier: row.tier, items: itemRows(row.salvage.items), familyComponentQty: Math.max(0, Math.floor(Number(row.salvage.familyComponentQty || 0))) })),
    births: { ...(catalog.births || {}) },
    detectors: (catalog.detectors || []).map(row => ({ ...row })),
    belts: (catalog.belts || []).map(row => ({ ...row })),
    types: (catalog.types || []).map(row => ({
      id: row.id, itemId: row.itemId, displayName: row.displayName, rarity: row.rarity,
      baseTier: baseTierOfType(row), family: String(row.family || ''), color: row.color,
      effects: row.effects || {}, benefit: row.benefit || '', cost: row.cost || ''
    }))
  };
}

// Вид и тир рождённого артефакта по типу аномалии: таблица anomalySources,
// затем фильтр по диапазону тира поля (виды с базовым тиром выше потолка поля
// там не рождаются).
function pickBirthType(anomalyType = '', tierRange = null, catalog = {}, seed = '') {
  const indexes = artifactIndexes(catalog);
  const ids = (Array.isArray(catalog.anomalySources?.[String(anomalyType || '')]) ? catalog.anomalySources[String(anomalyType || '')] : [])
    .map(String).filter(id => indexes.byId[id]);
  const max = tierRange ? clamp(Math.floor(Number(tierRange[1] || 5)), 1, 5) : 5;
  const candidates = ids.map(id => indexes.byId[id]).filter(type => baseTierOfType(type) <= max);
  if (!candidates.length) return null;
  const type = candidates[Math.floor(unit(seed, 'kind') * candidates.length) % candidates.length];
  return { type, tier: rollTier(type, tierRange, seed, catalog) };
}

module.exports = {
  RECORD_VERSION,
  TIER_COLORS,
  artifactEffectBenefitSign,
  artifactIndexes,
  baseTierOfType,
  instanceProperties,
  pickBirthType,
  publicArtifactCatalog,
  publicArtifactRecord,
  rollTier,
  salvageYields,
  sanitizeArtifactRecords,
  stabilizationCost,
  stabilizeRecord,
  tierColor,
  tierRow,
  tierRows
};
