'use strict';

// Every permanent marker authored on the active global map is enterable. The
// journal can still gate a location's story purpose, while private, encounter
// and siege instances remain outside this public-map release list.
const LOCATION_RELEASE_SCHEMA = 'realm.locationRelease.v1';
const LOCATION_RELEASE_VERSION = 3;
const RELEASED_LOCATION_IDS = Object.freeze([
  'klimAmmoWorks',
  'resourceKlimQuarry',
  'sluiceCity',
  'clanHydroNode2',
  'settlement',
  'roadOutpost',
  'resourceDryWaterPump',
  'resourceOldKlimFarm',
  'clanFilterT6',
  'scrapTown',
  'scrapOutpost',
  'scrapFoundry',
  'resourceIronMine',
  'resourceScrapFields',
  'antHive',
  'clanOreExchange',
  'clanFactoryCycle',
  'caravanCamp',
  'oldDepot',
  'resourceTireDepot',
  'clanDepotBypass',
  'resourceSiliconRidge',
  'geckoCanyon',
  'secondHaven',
  'clanChalkSluice',
  'relayStation',
  'relayOutpost',
  'relayWorkshop',
  'solarArray',
  'mutantCrater',
  'vectorLab',
  'clanRelayEast',
  'resourceChemSpring',
  'resourceOilPump',
  'radscorpionNest',
  'balanceBunker',
  'cascadeRegenerator',
  'clanFortZero',
  'wasteland'
]);

const RELEASED_LOCATION_ID_SET = new Set(RELEASED_LOCATION_IDS);

function normalizeReleasedLocationId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function isReleasedLocationId(value = '') {
  return RELEASED_LOCATION_ID_SET.has(normalizeReleasedLocationId(value));
}

function publicLocationRelease() {
  return {
    schema: LOCATION_RELEASE_SCHEMA,
    version: LOCATION_RELEASE_VERSION,
    locationIds: [...RELEASED_LOCATION_IDS]
  };
}

module.exports = {
  LOCATION_RELEASE_SCHEMA,
  LOCATION_RELEASE_VERSION,
  RELEASED_LOCATION_IDS,
  isReleasedLocationId,
  publicLocationRelease
};
