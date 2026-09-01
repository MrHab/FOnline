'use strict';

const { safeId } = require('./wasteland-sim-utils');

// Player-facing political factions are deliberately narrower than the world
// simulation's territorial groups. Free caravans still own sites, trade,
// remember robberies and defend their camp, but players do not join them and
// never build a reputation meter with them.
const JOINABLE_WORLD_FACTIONS = new Set(['old_klim', 'scrap_union', 'relay_order']);
const TERRITORIAL_WORLD_FACTIONS = new Set([...JOINABLE_WORLD_FACTIONS, 'caravans']);
const INDEPENDENT_WORLD_FACTIONS = new Set(['caravans', 'neutral']);
const HOSTILE_WORLD_FACTIONS = new Set(['raiders', 'mutants', 'wild']);
const FACTION_CAPITAL_SITES = {
  settlement: 'old_klim',
  scrapTown: 'scrap_union',
  relayStation: 'relay_order',
  caravanCamp: 'caravans'
};
const FACTION_CAPITAL_SITE_IDS = new Set(Object.keys(FACTION_CAPITAL_SITES));

function factionGroup(faction = '') {
  const key = safeId(String(faction || '').toLowerCase(), 'wild');
  if (key === 'raiders' || key === 'raider') return 'raiders';
  if (key === 'caravan' || key === 'caravans') return 'caravans';
  if (key === 'klim_patrol' || key === 'old_klim') return 'old_klim';
  if (key === 'scrap' || key === 'scrap_town' || key === 'scrap_union') return 'scrap_union';
  if (key === 'relay' || key === 'relay_station' || key === 'relay_order') return 'relay_order';
  if (key === 'super_mutant' || key === 'super_mutants' || key === 'mutant' || key === 'mutants') return 'mutants';
  if (['ghouls', 'radscorpions', 'mutant_ants', 'geckos', 'ash_wolves', 'monsters', 'wild'].includes(key)) return 'wild';
  return key || 'wild';
}

function isJoinableWorldFaction(faction = '') {
  return JOINABLE_WORLD_FACTIONS.has(factionGroup(faction));
}

function isTerritorialWorldFaction(faction = '') {
  return TERRITORIAL_WORLD_FACTIONS.has(factionGroup(faction));
}

function factionCategory(faction = '') {
  const group = factionGroup(faction);
  if (JOINABLE_WORLD_FACTIONS.has(group)) return 'major';
  if (INDEPENDENT_WORLD_FACTIONS.has(group)) return 'independent';
  if (HOSTILE_WORLD_FACTIONS.has(group)) return 'hostile';
  return 'independent';
}

function factionLabel(faction = '') {
  const key = factionGroup(faction);
  if (key === 'old_klim') return 'Старый Клим';
  if (key === 'caravans') return 'вольные караваны';
  if (key === 'scrap_union') return 'Свалочный союз';
  if (key === 'relay_order') return 'техники Ретранслятора';
  if (key === 'raiders') return 'рейдеры';
  if (key === 'mutants') return 'супермутанты';
  if (key === 'wild') return 'дикие твари';
  if (key === 'neutral') return 'нейтралы';
  return key;
}

function capitalFactionForSite(siteOrId = '') {
  const id = typeof siteOrId === 'string' ? siteOrId : siteOrId?.id;
  return FACTION_CAPITAL_SITES[String(id || '')] || '';
}

function isFactionCapitalSite(siteOrId = '') {
  const id = typeof siteOrId === 'string' ? siteOrId : siteOrId?.id;
  return FACTION_CAPITAL_SITE_IDS.has(String(id || ''));
}

function siteUsesFactionCapitalLocation(site = {}) {
  return FACTION_CAPITAL_SITE_IDS.has(String(site?.locationId || ''));
}

function isCapitalProtectedSite(site = {}) {
  return isFactionCapitalSite(site) || siteUsesFactionCapitalLocation(site);
}

function protectFactionCapitalSite(site = {}) {
  const faction = capitalFactionForSite(site);
  if (!site || !faction) return false;
  site.capital = true;
  site.capitalFaction = faction;
  site.owner = faction;
  site.pvpMode = 'peaceful';
  site.activeConflict = null;
  site.raidUntil = 0;
  site.lastRaidFaction = '';
  site.controlPressure = 0;
  site.supplyDisruptedUntil = 0;
  return true;
}

module.exports = {
  FACTION_CAPITAL_SITE_IDS,
  FACTION_CAPITAL_SITES,
  HOSTILE_WORLD_FACTIONS,
  INDEPENDENT_WORLD_FACTIONS,
  JOINABLE_WORLD_FACTIONS,
  TERRITORIAL_WORLD_FACTIONS,
  capitalFactionForSite,
  factionCategory,
  factionGroup,
  factionLabel,
  isCapitalProtectedSite,
  isFactionCapitalSite,
  isJoinableWorldFaction,
  isTerritorialWorldFaction,
  protectFactionCapitalSite,
  siteUsesFactionCapitalLocation
};
