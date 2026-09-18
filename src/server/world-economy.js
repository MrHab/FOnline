'use strict';

const fs = require('node:fs');
const { normalizeBlackMarketConfig } = require('./black-market');
const { normalizeCityAuctionConfig } = require('./city-auctions');
const { normalizeCraftingPlotConfig } = require('./crafting-plots');
const { normalizeDangerCellConfig } = require('./danger-cells');
const { normalizeAccountSinConfig } = require('./account-sin');

/**
 * Экономика v3 (библия 14.5, 16.5, KRM-22): какие части прежней живой пустоши
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
  // Торговля с NPC-торговцами.
  npcTraders: true,
  // Торговля с любым мирным NPC вне столиц; иначе торгуют только торговцы-люди
  // в столицах фракций и на базах Сердцевины (и скупщик Чёрного рынка).
  wildTraders: true,
  // Станки NPC без аренды; выключенный флаг превращает станки поселений в
  // участки с торгами за аренду и платой арендатору.
  npcStations: true,
  // Снаряжение с трупов NPC; заменяется останками и Чёрным рынком.
  npcGearDrops: true,
  // Отряды NPC на глобальной карте; уходят вместе с опасными клетками.
  visibleWorldParties: true,
  // Опасные клетки: цвет клетки карты по правилам и серверные стычки в пути.
  dangerCells: false,
  // Синь на счёте аккаунта, обменник сини и премиум.
  accountSin: false,
  // Марки на счёте аккаунта: общие для его персонажей, не выпадают.
  accountMarks: false,
  // A-Life опасных клеток: постоянные группы монстров и налётчиков на сетке
  // мелких клеток приходят в сцены (data/kromka/danger-ecology.json).
  dangerEcology: false,
  // Враждебные отряды прежней живой пустоши (налётчики, мутанты, звери). Под
  // A-Life их место заняли группы клеток, и прежние снимаются.
  hostileWorldParties: true,
  // Чёрный рынок в хабе Сердцевины: скупка снаряжения и добыча NPC с его склада.
  blackMarket: true,
  // Своя книга ордеров у каждой столицы вместо общей, налог v3 и довоенный запас.
  cityAuctions: false
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
  // Множитель богатства добычи по цвету зоны: марки с NPC, позже — бюджет
  // Чёрного рынка.
  lootMultiplier: Object.freeze({
    peaceful: 1,
    pve: 1.25,
    pvp: 1.33,
    pvpFullDrop: 2.25,
    pvpBlack: 2.6,
    pvpEvent: 1
  }),
  // Множитель выхода ресурсных узлов по цвету зоны.
  gatherYield: Object.freeze({
    peaceful: 1,
    pve: 1,
    pvp: 1.25,
    pvpFullDrop: 1.6,
    pvpBlack: 2,
    pvpEvent: 1
  })
});

// Останки снаряжения NPC: снаряжение с трупа не падает (его делают только
// игроки), а превращается в детали и лом. Числа — на единицу предмета, share —
// доля, которая действительно достаётся (дробная часть бросается).
const DEFAULT_NPC_REMNANTS = Object.freeze({
  share: 0.5,
  firearm: Object.freeze({ weaponParts: 1, scrap: 2 }),
  melee: Object.freeze({ scrap: 1 }),
  armor: Object.freeze({ scrap: 3 })
});
const NPC_REMNANT_KINDS = Object.freeze(['firearm', 'melee', 'armor']);

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
  const gatherSrc = src.gatherYield && typeof src.gatherYield === 'object' ? src.gatherYield : {};
  const gatherYield = {};
  for (const [mode, fallback] of Object.entries(DEFAULT_ZONES.gatherYield)) {
    gatherYield[mode] = finite(gatherSrc[mode], fallback, 0, 20);
  }
  return Object.freeze({
    brokenBelowCondition: finite(src.brokenBelowCondition, DEFAULT_ZONES.brokenBelowCondition, 0, 99),
    deathWear: Object.freeze(deathWear),
    blackDrop: Object.freeze(blackDrop),
    lootMultiplier: Object.freeze(lootMultiplier),
    gatherYield: Object.freeze(gatherYield)
  });
}

function normalizeNpcRemnants(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { share: finite(src.share, DEFAULT_NPC_REMNANTS.share, 0, 1) };
  for (const kind of NPC_REMNANT_KINDS) {
    const rows = src[kind] && typeof src[kind] === 'object' ? src[kind] : DEFAULT_NPC_REMNANTS[kind];
    const table = {};
    for (const [id, qty] of Object.entries(rows || {})) {
      const safeId = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const amount = finite(qty, 0, 0, 100);
      if (safeId && amount > 0) table[safeId] = amount;
    }
    out[kind] = Object.freeze(table);
  }
  return Object.freeze(out);
}

function normalizeWorldEconomy(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return Object.freeze({
    worldModel: normalizeWorldModel(src.worldModel),
    // Места торговли людей помимо столиц и баз Сердцевины (Ключи).
    npcTradeHubs: Object.freeze((Array.isArray(src.npcTradeHubs?.locations) ? src.npcTradeHubs.locations : [])
      .map(id => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64))
      .filter(Boolean)),
    zones: normalizeZones(src.zones),
    npcRemnants: normalizeNpcRemnants(src.npcRemnants),
    blackMarket: normalizeBlackMarketConfig(src.blackMarket),
    auctions: normalizeCityAuctionConfig(src.auctions),
    plots: normalizeCraftingPlotConfig(src.plots),
    dangerCells: normalizeDangerCellConfig(src.dangerCells),
    accountSin: normalizeAccountSinConfig(src.accountSin),
    sinExchange: Object.freeze({
      orderFee: Math.max(0, Math.floor(Number(src.accountSin?.exchange?.orderFee ?? 10) || 0)),
      durationChoicesHours: Object.freeze((Array.isArray(src.accountSin?.exchange?.durationChoicesHours)
        ? src.accountSin.exchange.durationChoicesHours : [24, 72, 168, 720]).map(Number).filter(value => value > 0)),
      maxQtyPerOrder: Math.max(1, Math.floor(Number(src.accountSin?.exchange?.maxQtyPerOrder) || 100000)),
      maxPrice: Math.max(1, Math.floor(Number(src.accountSin?.exchange?.maxPrice) || 100000)),
      maxOrdersPerTrader: Math.max(1, Math.floor(Number(src.accountSin?.exchange?.maxOrdersPerTrader) || 10))
    })
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

/** Множитель выхода ресурсного узла в зоне. */
function zoneGatherYield(economy = {}, mode = 'peaceful') {
  const value = Number(economy?.zones?.gatherYield?.[mode]);
  return Number.isFinite(value) ? value : 1;
}

/**
 * Дробное количество в целое: целая часть гарантирована, дробная выпадает с
 * соответствующим шансом. Так множители 1,25 и 0,5 честно работают на малых
 * числах.
 */
function rollQuantity(amount = 0, random = Math.random) {
  const value = Math.max(0, Number(amount) || 0);
  const whole = Math.floor(value);
  return whole + (random() < value - whole ? 1 : 0);
}

/**
 * Останки снаряжения NPC. `gear` — строки { id, qty, kind }, где kind один из
 * firearm, melee, armor. Возвращает строки деталей и лома, слитые по id.
 */
function npcRemnantRows(economy = {}, gear = [], random = Math.random) {
  const remnants = economy?.npcRemnants || normalizeNpcRemnants({});
  const totals = new Map();
  for (const row of Array.isArray(gear) ? gear : []) {
    const table = remnants[row?.kind];
    const qty = Math.max(0, Math.floor(Number(row?.qty || 0)));
    if (!table || qty <= 0) continue;
    for (const [id, perUnit] of Object.entries(table)) {
      const amount = rollQuantity(perUnit * qty * remnants.share, random);
      if (amount > 0) totals.set(id, (totals.get(id) || 0) + amount);
    }
  }
  return [...totals.entries()].map(([id, qty]) => ({ id, qty }));
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
  zoneGatherYield,
  rollQuantity,
  npcRemnantRows,
  conditionIsBroken
};
