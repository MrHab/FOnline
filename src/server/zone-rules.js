'use strict';

const { deathLootPolicy } = require('./kromka-death-loot');

/**
 * Режимы зон — лестница экономики v3 (библия 16.5): мирная, синяя (`pve`),
 * жёлтая (`pvp`), красная (`pvpFullDrop`), чёрная (`pvpBlack`) и события.
 * Внутренний id `pvpFullDrop` сохранён ради совместимости данных, сохранений и
 * замороженного legacy-клиента, но его правило — частичная потеря: выпадает
 * инвентарь, экипировка сохраняется. Полная потеря — только `pvpBlack`.
 */
const ZONE_MODES = Object.freeze(['peaceful', 'pve', 'pvp', 'pvpEvent', 'pvpFullDrop', 'pvpBlack']);
const ZONE_MODE_SET = new Set(ZONE_MODES);
const ZONE_MODE_ALIASES = Object.freeze({
  peace: 'peaceful',
  safe: 'peaceful',
  safezone: 'peaceful',
  no_pvp: 'peaceful',
  nopvp: 'peaceful',
  noncombat: 'peaceful',
  social: 'peaceful',
  base: 'peaceful',
  pve: 'pve',
  pvearea: 'pve',
  pve_area: 'pve',
  hunting: 'pve',
  encounter_pve: 'pve',
  pvpevent: 'pvpEvent',
  pvp_event: 'pvpEvent',
  event: 'pvpEvent',
  publicevent: 'pvpEvent',
  public_event: 'pvpEvent',
  lair: 'pvpEvent',
  pvpfulldrop: 'pvpFullDrop',
  fullpvp: 'pvpFullDrop',
  fulldrop: 'pvpFullDrop',
  full_drop: 'pvpFullDrop',
  'pvp-full-drop': 'pvpFullDrop',
  pvp_full_drop: 'pvpFullDrop',
  partialdrop: 'pvpFullDrop',
  partial_drop: 'pvpFullDrop',
  bagdrop: 'pvpFullDrop',
  bag_drop: 'pvpFullDrop',
  red: 'pvpFullDrop',
  redzone: 'pvpFullDrop',
  pvpblack: 'pvpBlack',
  pvp_black: 'pvpBlack',
  black: 'pvpBlack',
  blackzone: 'pvpBlack',
  black_zone: 'pvpBlack',
  territory: 'pvpBlack',
  pvp: 'pvp',
  danger: 'pvp',
  dangerous: 'pvp',
  unsafe: 'pvp',
  true: 'pvp',
  combat: 'pvp'
});

const ZONE_MODE_LABELS = Object.freeze({
  peaceful: 'Мирная зона: PvP отключён',
  pve: 'PvE: PvP запрещено, предметы сохраняются',
  pvp: 'PvP: предметы сохраняются, экипировка изнашивается',
  pvpEvent: 'PvP: предметы сохраняются',
  pvpFullDrop: 'PvP: инвентарь выпадает, экипировка сохраняется',
  pvpBlack: 'PvP: выпадает всё, часть становится ломом'
});

const ZONE_LOSS_LABELS = Object.freeze({
  none: 'Предметы при смерти сохраняются.',
  consumables: 'При смерти выпадает половина каждой стопки расходников.',
  inventory: 'При смерти выпадает содержимое инвентаря, включая запасное снаряжение, '
    + 'материалы и любые артефакты в инвентаре. Экипировка, экипированный рюкзак, '
    + 'экипированный контейнер и установленные в него стабилизированные артефакты сохраняются.',
  all: 'При смерти выпадает всё: экипировка, рюкзак, контейнер и установленные артефакты. '
    + 'Каждый выпавший предмет может стать ломом. Марки и сюжетные предметы сохраняются.'
});

const ZONE_ACCESS_LABELS = Object.freeze({
  open: 'Вход открыт всем.',
  personal: 'Встреча доступна только создавшему её персонажу.',
  faction: 'Вход только для членов фракции.',
  ownFaction: 'Вход только для членов своей фракции.'
});

function normalizeZoneMode(input, safeFallback = true) {
  if (typeof input === 'boolean') return input ? 'pvp' : (safeFallback ? 'peaceful' : 'pvp');
  const raw = String(input || '').trim();
  if (ZONE_MODE_SET.has(raw)) return raw;
  const low = raw.toLowerCase();
  if (ZONE_MODE_ALIASES[low]) return ZONE_MODE_ALIASES[low];
  return safeFallback ? 'peaceful' : 'pvp';
}

function zoneModeAllowsPvp(mode = 'peaceful') {
  const normalized = normalizeZoneMode(mode, true);
  return normalized !== 'peaceful' && normalized !== 'pve';
}

function zoneModeIsSafe(mode = 'peaceful') {
  return normalizeZoneMode(mode, true) === 'peaceful';
}

function zoneModeLossPolicy(mode = 'peaceful') {
  return deathLootPolicy(normalizeZoneMode(mode, true)).loss;
}

function zoneRules(mode = 'peaceful', extra = {}) {
  const normalized = normalizeZoneMode(mode, true);
  const loss = zoneModeLossPolicy(normalized);
  const access = String(extra.access || 'open');
  const pvp = zoneModeAllowsPvp(normalized);
  const rules = {
    mode: normalized,
    label: ZONE_MODE_LABELS[normalized] || normalized,
    pvp,
    pvpLabel: pvp
      ? (extra.factionPvp ? 'PvP разрешено между разными фракциями.' : 'PvP разрешено.')
      : 'PvP запрещено.',
    loss,
    lossLabel: ZONE_LOSS_LABELS[loss] || ZONE_LOSS_LABELS.none,
    access,
    accessLabel: ZONE_ACCESS_LABELS[access] || ZONE_ACCESS_LABELS.open,
    safe: zoneModeIsSafe(normalized),
    confirmBeforeEntry: loss === 'inventory' || loss === 'all' || normalized === 'pvpEvent'
  };
  if (extra.territoryId) rules.territoryId = String(extra.territoryId).slice(0, 32);
  if (extra.factionId) rules.factionId = String(extra.factionId).slice(0, 32);
  if (extra.title) rules.title = String(extra.title).slice(0, 80);
  return rules;
}

module.exports = {
  ZONE_MODES,
  ZONE_MODE_SET,
  ZONE_MODE_ALIASES,
  ZONE_MODE_LABELS,
  ZONE_LOSS_LABELS,
  ZONE_ACCESS_LABELS,
  normalizeZoneMode,
  zoneModeAllowsPvp,
  zoneModeIsSafe,
  zoneModeLossPolicy,
  zoneRules
};
