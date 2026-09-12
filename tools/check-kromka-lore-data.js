'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const kromkaDir = path.join(root, 'data', 'kromka');
const errors = [];

function readJson(name) {
  const file = path.join(kromkaDir, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`data/kromka/${name}: ${error.message}`);
    return null;
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${label} is required`);
}

function uniqueRows(rows, label) {
  const byId = new Map();
  for (const [index, row] of (rows || []).entries()) {
    const id = String(row?.id || '');
    requiredString(id, `${label}[${index}].id`);
    if (!id) continue;
    if (byId.has(id)) errors.push(`${label}[${index}].id duplicates ${id}`);
    else byId.set(id, row);
  }
  return byId;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function expectSchema(value, expected, label) {
  if (value?.schema !== expected) errors.push(`${label}: expected schema ${expected}`);
  if (value?.version !== 1) errors.push(`${label}: expected version 1`);
}

const canon = readJson('canon.json');
const factionsData = readJson('factions.json');
const locationsData = readJson('locations.json');
const migrations = readJson('migration-aliases.json');
const npcsData = readJson('npcs.json');
const economy = readJson('economy.json');

if (canon) expectSchema(canon, 'kromka.canon.v1', 'data/kromka/canon.json');
if (factionsData) expectSchema(factionsData, 'kromka.factions.v1', 'data/kromka/factions.json');
if (locationsData) expectSchema(locationsData, 'kromka.locations.v1', 'data/kromka/locations.json');
if (migrations) expectSchema(migrations, 'kromka.migrationAliases.v1', 'data/kromka/migration-aliases.json');
if (npcsData) expectSchema(npcsData, 'kromka.npcs.v1', 'data/kromka/npcs.json');
if (economy) expectSchema(economy, 'kromka.economy.v1', 'data/kromka/economy.json');

if (canon) {
  if (canon.game?.displayName !== 'Кромка') errors.push('canon game.displayName must be Кромка');
  if (canon.game?.camera !== 'perspective-top-down') errors.push('canon camera must remain perspective-top-down');
  if (canon.game?.permanentCompanions !== false) errors.push('canon must forbid permanent companions');
  if (canon.authority?.runtimeState !== 'server') errors.push('canon runtime authority must be server');
  if (canon.authority?.spatialAuthoring !== 'unity') errors.push('canon spatial authoring authority must be unity');
  if (canon.world?.revision !== 'kromka-1') errors.push('canon world revision must be kromka-1');
  const designDocument = path.join(root, String(canon.designDocument || '').replace(/\//g, path.sep));
  if (!fs.existsSync(designDocument)) errors.push('canon designDocument does not exist');
}
if (economy) {
  if (economy.currency?.itemId !== 'silver') errors.push('economy currency must use the existing silver item id');
  if (economy.strategicResource?.itemId !== 'blue') errors.push('economy strategic resource must use item id blue');
  if (economy.strategicResource?.displayName !== 'Синь') errors.push('economy strategic resource must be named Синь');
  if (economy.strategicResource?.ordinaryCurrency !== false) errors.push('Синь must not be an ordinary currency');
  if (canon?.world?.strategicResource !== economy.strategicResource?.displayName?.toLowerCase()) {
    errors.push('economy strategic resource must match canon');
  }
}

const unityAuthoringContracts = [
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaLocationAuthoring.cs',
    tokens: [
      'class KromkaLocationAuthoring',
      'CurrentWorldRevision = "kromka-1"'
    ]
  },
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaPlacedObjectAuthoring.cs',
    tokens: ['class KromkaPlacedObjectAuthoring']
  },
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaSpawnAuthoring.cs',
    tokens: ['class KromkaSpawnAuthoring']
  },
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaAnomalyAuthoring.cs',
    tokens: ['class KromkaAnomalyAuthoring']
  },
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaWorldAuthoring.cs',
    tokens: ['class KromkaWorldAuthoring']
  },
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaWorldLocationAuthoring.cs',
    tokens: ['class KromkaWorldLocationAuthoring']
  },
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaRouteAuthoring.cs',
    tokens: ['class KromkaRouteAuthoring']
  },
  {
    file: 'unity-client/Assets/Scripts/Kromka/Authoring/KromkaRegionAuthoring.cs',
    tokens: ['class KromkaRegionAuthoring']
  }
];
for (const contract of unityAuthoringContracts) {
  const file = path.join(root, contract.file.replace(/\//g, path.sep));
  if (!fs.existsSync(file)) {
    errors.push(`${contract.file} is missing`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  for (const token of contract.tokens) {
    if (!source.includes(token)) errors.push(`${contract.file} is missing authoring contract ${token}`);
  }
}

const regions = uniqueRows(locationsData?.regions, 'locations.regions');
const locations = uniqueRows(locationsData?.locations, 'locations.locations');
const factions = uniqueRows(factionsData?.factions, 'factions.factions');
const npcs = uniqueRows(npcsData?.npcs, 'npcs.npcs');

const expectedFactions = new Set(['uprava', 'free_artels', 'contour', 'tract_league', 'seconds', 'continuity']);
if (!sameSet(new Set(factions.keys()), expectedFactions)) {
  errors.push(`canonical faction ids must be exactly: ${[...expectedFactions].join(', ')}`);
}
if (factionsData?.playerMembership !== 'contract-reputation') {
  errors.push('factions.playerMembership must be contract-reputation');
}

for (const [id, faction] of factions) {
  const label = `faction ${id}`;
  ['displayName', 'leaderId', 'capitalLocationId', 'visibility', 'promise', 'price', 'secret', 'patrolDoctrine', 'economicPlan'].forEach(field => {
    requiredString(faction[field], `${label}.${field}`);
  });
  if (faction.joinable !== false) errors.push(`${label}.joinable must be false`);
  if (!['public', 'hidden'].includes(faction.visibility)) errors.push(`${label}.visibility must be public or hidden`);
  if (!Array.isArray(faction.colors) || faction.colors.length !== 3) errors.push(`${label}.colors must contain three colors`);
  if (!Array.isArray(faction.visualTags) || faction.visualTags.length < 2) errors.push(`${label}.visualTags must contain at least two tags`);
  if (!Array.isArray(faction.contractFamilies) || faction.contractFamilies.length < 3) errors.push(`${label}.contractFamilies must contain at least three types`);
  const expectedRelations = new Set([...expectedFactions].filter(otherId => otherId !== id));
  if (!sameSet(new Set(Object.keys(faction.relations || {})), expectedRelations)) {
    errors.push(`${label}.relations must cover every other canonical faction`);
  }
  if (!locations.has(faction.capitalLocationId)) errors.push(`${label} has unknown capital ${faction.capitalLocationId}`);
  if (!npcs.has(faction.leaderId)) errors.push(`${label} has unknown leader ${faction.leaderId}`);
}

const expectedRegionIds = new Set([
  'northern_sluices', 'middle_vein', 'ore_arc', 'tract_isthmus',
  'chalk_lowland', 'glasslands', 'zero_basin', 'silent_ring'
]);
if (!sameSet(new Set(regions.keys()), expectedRegionIds)) {
  errors.push(`canonical region ids must be exactly: ${[...expectedRegionIds].join(', ')}`);
}

const unityScenes = new Set();
const supportedVirtualRegions = new Set(['off_map', 'regional']);
const supportedTypes = new Set([
  'settlement', 'faction_capital', 'caravan_hub', 'road_outpost', 'industrial_site',
  'resource_site', 'raid_complex', 'mutant_lair', 'encounter_template',
  'boundary_expedition', 'tutorial', 'story_complex', 'personal_base', 'clan_base'
]);
for (const [id, location] of locations) {
  const label = `location ${id}`;
  ['displayName', 'locationType', 'macroRegion', 'visualProfile', 'ambientProfile',
    'worldRevision', 'migrationSpawnId', 'unityScene'].forEach(field => {
    requiredString(location[field], `${label}.${field}`);
  });
  if (!supportedTypes.has(location.locationType)) errors.push(`${label} has unsupported locationType ${location.locationType}`);
  if (!regions.has(location.macroRegion) && !supportedVirtualRegions.has(location.macroRegion)) {
    errors.push(`${label} has unknown macroRegion ${location.macroRegion}`);
  }
  if (location.worldRevision !== 'kromka-1') errors.push(`${label}.worldRevision must be kromka-1`);
  if (!Number.isFinite(location.anomalyDensity) || location.anomalyDensity < 0 || location.anomalyDensity > 1) {
    errors.push(`${label}.anomalyDensity must be between 0 and 1`);
  }
  if (!Array.isArray(location.landmarkTags) || location.landmarkTags.length === 0) {
    errors.push(`${label}.landmarkTags must be a non-empty array`);
  }
  if (typeof location.legacyStable !== 'boolean') errors.push(`${label}.legacyStable must be boolean`);
  if (!/^Assets\/Scenes\/Kromka\/Locations\/[A-Za-z0-9_-]+\.unity$/.test(location.unityScene || '')) {
    errors.push(`${label}.unityScene must point to an editable Kromka location scene`);
  }
  if (unityScenes.has(location.unityScene)) errors.push(`${label}.unityScene duplicates ${location.unityScene}`);
  unityScenes.add(location.unityScene);
}

if (locationsData?.worldRevision !== canon?.world?.revision) {
  errors.push('locations worldRevision must match canon world revision');
}
if (locationsData?.unityGlobalMapScene !== canon?.authority?.globalMapScene) {
  errors.push('locations unityGlobalMapScene must match canon authority.globalMapScene');
}
if ((locationsData?.locations || []).filter(row => row.locationType === 'clan_base').length !== 8) {
  errors.push('locations must define exactly eight fixed clan bases');
}

const preservedLocationIds = new Set(migrations?.preservedLocationIds || []);
const legacyLocations = new Set((locationsData?.locations || []).filter(row => row.legacyStable).map(row => row.id));
if (!sameSet(preservedLocationIds, legacyLocations)) {
  errors.push('migration preservedLocationIds must exactly match locations marked legacyStable');
}
for (const id of preservedLocationIds) {
  const legacyFile = path.join(root, 'data', 'locations', `${id}.json`);
  if (!fs.existsSync(legacyFile)) errors.push(`preserved location ${id} has no data/locations/${id}.json`);
}

const factionAliases = migrations?.factions || {};
for (const [legacyId, canonicalId] of Object.entries(factionAliases)) {
  if (factions.has(legacyId)) errors.push(`legacy faction alias ${legacyId} is also canonical`);
  if (!factions.has(canonicalId)) errors.push(`legacy faction alias ${legacyId} targets unknown ${canonicalId}`);
}
for (const requiredAlias of ['old_klim', 'scrap_union', 'relay_order', 'caravans']) {
  if (!factionAliases[requiredAlias]) errors.push(`missing faction migration alias ${requiredAlias}`);
}

const personalQuestIds = new Set();
for (const [id, npc] of npcs) {
  const label = `npc ${id}`;
  ['displayName', 'role', 'homeLocationId', 'personalQuestId', 'secret'].forEach(field => {
    requiredString(npc[field], `${label}.${field}`);
  });
  if (npc.factionId !== null && !factions.has(npc.factionId)) errors.push(`${label} has unknown faction ${npc.factionId}`);
  if (!locations.has(npc.homeLocationId)) errors.push(`${label} has unknown home location ${npc.homeLocationId}`);
  if (personalQuestIds.has(npc.personalQuestId)) errors.push(`${label} duplicates personal quest ${npc.personalQuestId}`);
  personalQuestIds.add(npc.personalQuestId);
}
if (npcs.size !== 11) errors.push(`expected 10 principal NPCs and quest mechanic Avenir, found ${npcs.size}`);

if (errors.length) {
  console.error(`Kromka lore data check failed (${errors.length}):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Kromka lore data check passed (${regions.size} regions, ${locations.size} locations, ${factions.size} factions, ${npcs.size} named NPCs).`);
