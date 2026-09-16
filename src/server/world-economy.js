'use strict';

const fs = require('node:fs');

/**
 * Экономика v3 (библия 14.5, 16.5, KRM-21): какие части прежней живой пустоши
 * ещё работают и числа лестницы зон. Все значения читаются из
 * `data/kromka/economy.json`; отсутствующее поле берёт значение по умолчанию,
 * поэтому старый файл не ломает сервер.
 */
const DEFAULT_WORLD_MODEL = Object.freeze({
  // Потребление поселений, население, миграция, беженцы и аварийные поставки.
  settlementLife: false,
  // Добыча и производство поселений, закупочные и сырьевые задания.
  npcProduction: false,
  // Постоянные, экспортные и торговые караваны вместе с сопровождением.
  worldCaravans: false,
  // Полки NPC-торговцев; выключаются вместе с появлением аукционов.
  npcTraders: true,
  // Станки NPC; выключаются вместе с появлением участков.
  npcStations: true,
  // Снаряжение с трупов NPC; заменяется останками и Чёрным рынком.
  npcGearDrops: true,
  // Отряды NPC на глобальной карте; уходят вместе с опасными клетками.
  visibleWorldParties: true
});

const DEFAULT_ZONES = Object.freeze({
  // Ниже этого состояния оружие не стреляет, а броня не защищает.
  brokenBelowCondition: 10,
  // Износ надетого при смерти по режиму зоны, в процентах состояния.
  deathWear: Object.freeze({ pve: 5, pvp: 5, pvpFullDrop: 20 }),
  // Чёрная зона: выпадает всё, каждая единица может стать ломом.
  blackDrop: Object.freeze({
    trashChance: 0.33,
    trashItemId: 'scrap',
    // Лом от уничтоженного — доля базовой цены в пересчёте на цену лома.
    trashValueShare: 0.25,
    droppedWearMin: 20,
    droppedWearMax: 40
  }),
  // Множитель богатства добычи по цвету зоны.
  lootMultiplier: Object.freeze({
    peaceful: 1,
    pve: 1.25,
    pvp: 1.33,
    pvpFullDrop: 2.25,
    pvpBlack: 2.6,
    pvpEvent: 1
  })
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeWorldModel(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_WORLD_MODEL)) {
    out[key] = typeof src[key] === 'boolean' ? src[key] : fallback;
  }
  return Object.freeze(out);
}

function normalizeZones(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const wearSrc = src.deathWear && typeof src.deathWear === 'object' ? src.deathWear : {};
  const deathWear = {};
  for (const [mode, fallback] of Object.entries(DEFAULT_ZONES.deathWear)) {
    deathWear[mode] = finite(wearSrc[mode], fallback, 0, 100);
  }
  const blackSrc = src.blackDrop && typeof src.blackDrop === 'object' ? src.blackDrop : {};
  const wearMin = finite(blackSrc.droppedWearMin, DEFAULT_ZONES.blackDrop.droppedWearMin, 0, 100);
  const blackDrop = {
    trashChance: finite(blackSrc.trashChance, DEFAULT_ZONES.blackDrop.trashChance, 0, 1),
    trashItemId: String(blackSrc.trashItemId || DEFAULT_ZONES.blackDrop.trashItemId).slice(0, 64),
    trashValueShare: finite(blackSrc.trashValueShare, DEFAULT_ZONES.blackDrop.trashValueShare, 0, 1),
    droppedWearMin: wearMin,
    droppedWearMax: finite(blackSrc.droppedWearMax, DEFAULT_ZONES.blackDrop.droppedWearMax, wearMin, 100)
  };
  const lootSrc = src.lootMultiplier && typeof src.lootMultiplier === 'object' ? src.lootMultiplier : {};
  const lootMultiplier = {};
  for (const [mode, fallback] of Object.entries(DEFAULT_ZONES.lootMultiplier)) {
    lootMultiplier[mode] = finite(lootSrc[mode], fallback, 0, 20);
  }
  return Object.freeze({
    brokenBelowCondition: finite(src.brokenBelowCondition, DEFAULT_ZONES.brokenBelowCondition, 0, 99),
    deathWear: Object.freeze(deathWear),
    blackDrop: Object.freeze(blackDrop),
    lootMultiplier: Object.freeze(lootMultiplier)
  });
}

function normalizeWorldEconomy(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return Object.freeze({
    worldModel: normalizeWorldModel(src.worldModel),
    zones: normalizeZones(src.zones)
  });
}

function loadWorldEconomy(file = '') {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Economy config unreadable, defaults used:', file, error.message);
  }
  return normalizeWorldEconomy(raw);
}

/** Износ надетого при смерти в зоне, проценты; 0 — износа нет. */
function zoneDeathWear(economy = {}, mode = 'peaceful') {
  return Number(economy?.zones?.deathWear?.[mode] || 0);
}

/** Множитель богатства добычи в зоне. */
function zoneLootMultiplier(economy = {}, mode = 'peaceful') {
  const value = Number(economy?.zones?.lootMultiplier?.[mode]);
  return Number.isFinite(value) ? value : 1;
}

/** Предмет с таким состоянием не работает, пока его не починят. */
function conditionIsBroken(economy = {}, condition = 100) {
  const limit = Number(economy?.zones?.brokenBelowCondition ?? DEFAULT_ZONES.brokenBelowCondition);
  return Number.isFinite(Number(condition)) && Number(condition) < limit;
}

module.exports = {
  DEFAULT_WORLD_MODEL,
  DEFAULT_ZONES,
  normalizeWorldEconomy,
  loadWorldEconomy,
  zoneDeathWear,
  zoneLootMultiplier,
  conditionIsBroken
};
