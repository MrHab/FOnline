'use strict';

// The Unity release intentionally exposes a small, finished slice of the
// authored world. Hidden locations stay in the simulation and in the location
// catalog so encounters, old saves and a future rotation can still use them.
const LOCATION_RELEASE_SCHEMA = 'realm.locationRelease.v1';
const LOCATION_RELEASE_VERSION = 1;
const RELEASED_LOCATION_IDS = Object.freeze([
  'settlement',
  'scrapTown',
  'relayStation',
  'caravanCamp',
  'oldDepot',
  'roadOutpost',
  'scrapFoundry',
  'relayWorkshop'
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
