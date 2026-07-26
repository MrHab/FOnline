'use strict';

const { safeId } = require('./wasteland-sim-utils');

const WORLD_SITE_LOCAL_PROFILE_VERSION = 1;
const WORLD_SITE_LOCAL_MIN_TILES = 20;
const WORLD_SITE_LOCAL_SIZE_VARIANTS = 18;

function stableWorldSiteHash(value = '') {
  let hash = 0x811c9dc5;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function worldSiteLocationId(siteId = '') {
  const site = safeId(siteId || 'site', 'site');
  const full = `world_${site}`;
  if (full.length <= 32) return full;
  const suffix = stableWorldSiteHash(site).toString(16).padStart(8, '0');
  return `${full.slice(0, 23)}_${suffix}`;
}

function worldSiteLocationSeed(baseSeed = 1, siteId = '') {
  const seed = (Math.floor(Number(baseSeed) || 1) ^ stableWorldSiteHash(siteId || 'site')) >>> 0;
  return seed || 1;
}

function ensureUniqueWorldSiteLocalProfiles(sites = {}) {
  let changed = false;
  const rows = Object.values(sites || {})
    .filter(site => site && site.id && site.locationId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const preservedSizeOwners = new Map();
  for (const site of rows) {
    const width = Math.floor(Number(site.localWidthTiles || 0));
    const height = Math.floor(Number(site.localHeightTiles || 0));
    const key = `${width}x${height}`;
    const valid = Number(site.localProfileVersion || 0) === WORLD_SITE_LOCAL_PROFILE_VERSION
      && width >= WORLD_SITE_LOCAL_MIN_TILES
      && width < WORLD_SITE_LOCAL_MIN_TILES + WORLD_SITE_LOCAL_SIZE_VARIANTS
      && height >= WORLD_SITE_LOCAL_MIN_TILES
      && height < WORLD_SITE_LOCAL_MIN_TILES + WORLD_SITE_LOCAL_SIZE_VARIANTS;
    if (valid && !preservedSizeOwners.has(key)) preservedSizeOwners.set(key, String(site.id));
  }
  const usedSizes = new Set(preservedSizeOwners.keys());
  const poolSize = WORLD_SITE_LOCAL_SIZE_VARIANTS * WORLD_SITE_LOCAL_SIZE_VARIANTS;

  for (const site of rows) {
    const oldWidth = Math.floor(Number(site.localWidthTiles || 0));
    const oldHeight = Math.floor(Number(site.localHeightTiles || 0));
    const oldKey = `${oldWidth}x${oldHeight}`;
    const oldProfileIsValid = Number(site.localProfileVersion || 0) === WORLD_SITE_LOCAL_PROFILE_VERSION
      && oldWidth >= WORLD_SITE_LOCAL_MIN_TILES
      && oldWidth < WORLD_SITE_LOCAL_MIN_TILES + WORLD_SITE_LOCAL_SIZE_VARIANTS
      && oldHeight >= WORLD_SITE_LOCAL_MIN_TILES
      && oldHeight < WORLD_SITE_LOCAL_MIN_TILES + WORLD_SITE_LOCAL_SIZE_VARIANTS
      && preservedSizeOwners.get(oldKey) === String(site.id);

    let width = oldWidth;
    let height = oldHeight;
    if (!oldProfileIsValid) {
      const slot = stableWorldSiteHash(`${site.id}:local-size`) % poolSize;
      for (let probe = 0; probe < poolSize; probe += 1) {
        const candidate = (slot + probe) % poolSize;
        const candidateWidth = WORLD_SITE_LOCAL_MIN_TILES + candidate % WORLD_SITE_LOCAL_SIZE_VARIANTS;
        const candidateHeight = WORLD_SITE_LOCAL_MIN_TILES + Math.floor(candidate / WORLD_SITE_LOCAL_SIZE_VARIANTS);
        const candidateKey = `${candidateWidth}x${candidateHeight}`;
        if (usedSizes.has(candidateKey)) continue;
        width = candidateWidth;
        height = candidateHeight;
        break;
      }
    }

    const sizeKey = `${width}x${height}`;
    usedSizes.add(sizeKey);
    const contentSeed = worldSiteLocationSeed(0x6d2b79f5, site.id);
    const layoutVariant = stableWorldSiteHash(`${site.id}:layout`) % 12;
    const contentVariant = stableWorldSiteHash(`${site.id}:content`) % 16;
    const sizeLabel = `${width * 2}×${height * 2} м`;
    if (site.localProfileVersion !== WORLD_SITE_LOCAL_PROFILE_VERSION
      || site.localWidthTiles !== width
      || site.localHeightTiles !== height
      || site.localSizeLabel !== sizeLabel
      || site.localContentSeed !== contentSeed
      || site.localLayoutVariant !== layoutVariant
      || site.localContentVariant !== contentVariant) changed = true;
    site.localProfileVersion = WORLD_SITE_LOCAL_PROFILE_VERSION;
    site.localWidthTiles = width;
    site.localHeightTiles = height;
    site.localSizeLabel = sizeLabel;
    site.localContentSeed = contentSeed;
    site.localLayoutVariant = layoutVariant;
    site.localContentVariant = contentVariant;
  }
  return changed;
}

function ensureUniqueWorldSiteLocationIds(sites = {}) {
  let changed = false;
  const rows = Object.values(sites || {}).filter(site => site && site.id && site.locationId);
  const groups = new Map();
  rows.forEach(site => {
    const locationId = safeId(site.locationId || '', '');
    if (!locationId) return;
    if (!groups.has(locationId)) groups.set(locationId, []);
    groups.get(locationId).push(site);
  });
  for (const [locationId, group] of groups.entries()) {
    if (group.length < 2) continue;
    const canonical = group.find(site => String(site.id || '') === locationId && !site.templateLocationId) || null;
    for (const site of group) {
      if (site === canonical) continue;
      const instanceId = worldSiteLocationId(site.id);
      const templateLocationId = safeId(site.templateLocationId || locationId, locationId);
      if (site.locationId !== instanceId || site.templateLocationId !== templateLocationId) changed = true;
      site.templateLocationId = templateLocationId;
      site.locationId = instanceId;
    }
  }
  return ensureUniqueWorldSiteLocalProfiles(sites) || changed;
}

module.exports = {
  ensureUniqueWorldSiteLocalProfiles,
  ensureUniqueWorldSiteLocationIds,
  worldSiteLocationId,
  worldSiteLocationSeed
};
