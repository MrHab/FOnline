'use strict';

const loreNames = new Map(require('../../data/kromka/locations.json').locations
  .map(location => [location.id, location.displayName]));

// Spatial authority belongs to Unity. The procedural generator remains available
// only to legacy-map fixtures; a missing flag must never revive it in Kromka.
function usesAuthoredWorldSites(map = {}) {
  return map.worldRevision === 'kromka-1' || map.sitePlacement === 'unity-authored';
}

function authoredNodeForSite(map = {}, site = {}) {
  const keys = new Set([site.id, site.locationId].filter(Boolean));
  return (Array.isArray(map.nodes) ? map.nodes : []).find(node => node
    && (keys.has(node.id) || keys.has(node.locationId))) || null;
}

function isPlacedWorldSite(map, site) {
  return !!site && !site.districtInterest && !String(site.id || '').startsWith('district_interest_')
    && !!authoredNodeForSite(map, site);
}

function authoredSiteName(map, site) {
  const node = authoredNodeForSite(map, site);
  return node ? String(node.label || loreNames.get(node.locationId || node.id) || site.name || site.id).slice(0, 96) : site.name;
}

// Preserve the complete old records, including inventories and progress, without
// letting obsolete procedural sites participate in new simulation/events. No
// authored location IDs, character saves or quest histories are rewritten.
function archiveUnplacedWorldSites(state, map) {
  if (!usesAuthoredWorldSites(map)) return false;
  const removed = Object.entries(state.sites || {}).filter(([, site]) => !isPlacedWorldSite(map, site));
  if (!removed.length) return false;
  const archive = state.retiredWorldSites ||= {
    schema: 'realm.retiredWorldSites.v1', reason: 'unity-authored-placement',
    sites: {}, parties: {}, worldTasks: [], worldZones: [], cargoLedger: {}
  };
  const refs = new Set();
  for (const [id, site] of removed) {
    archive.sites[id] = site;
    refs.add(id);
    if (site.locationId) refs.add(site.locationId);
    delete state.sites[id];
  }
  const referenceKeys = new Set(['siteId', 'worldSiteId', 'sourceSiteId', 'targetSiteId',
    'fromSiteId', 'toSiteId', 'homeSiteId', 'destinationSiteId', 'originSiteId', 'locationId', 'roomId', 'route',
    'partyId', 'caravanId', 'escortPartyId', 'targetPartyId', 'worldZoneId', 'zoneId']);
  function referencesRetired(value, key = '') {
    if (typeof value === 'string') return (referenceKeys.has(key) || key.endsWith('SiteId')) && refs.has(value);
    if (Array.isArray(value)) return value.some(row => referencesRetired(row, key));
    return value && typeof value === 'object'
      && Object.entries(value).some(([field, row]) => referencesRetired(row, field));
  }
  for (const key of ['parties', 'cargoLedger']) {
    archive[key] ||= {};
    for (const [id, row] of Object.entries(state[key] || {})) {
      if (!referencesRetired(row)) continue;
      archive[key][id] = row;
      if (key === 'parties') refs.add(id);
      delete state[key][id];
    }
  }
  for (const key of ['worldZones', 'worldTasks']) {
    archive[key] ||= [];
    state[key] = (state[key] || []).filter(row => {
      if (!referencesRetired(row)) return true;
      archive[key].push(row);
      if (row.id) refs.add(row.id);
      return false;
    });
  }
  return true;
}

module.exports = { usesAuthoredWorldSites, authoredNodeForSite, authoredSiteName, isPlacedWorldSite, archiveUnplacedWorldSites };
