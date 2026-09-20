const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const editorFile = path.join(root, 'public', 'dev-location-editor.html');
const unityModelsFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaEnemyModels.cs');
const serverFile = path.join(root, 'server.js');
const modelsDir = path.join(root, 'public', 'assets', 'models', 'wasteland');

const editor = fs.readFileSync(editorFile, 'utf8');
const unityModels = fs.readFileSync(unityModelsFile, 'utf8');
const server = fs.readFileSync(serverFile, 'utf8');
const issues = [];

function fail(message) {
  issues.push(message);
}

function extractConstExpression(source, constName) {
  const marker = `const ${constName} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing const ${constName}`);
  let i = start + marker.length;
  while (/\s/.test(source[i] || '')) i += 1;
  const opener = source[i];
  const closer = opener === '[' ? ']' : opener === '{' ? '}' : '';
  if (!closer) throw new Error(`Cannot extract ${constName}: unsupported opener "${opener}"`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === opener) depth += 1;
    if (ch === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(start + marker.length, i + 1).trim();
    }
  }
  throw new Error(`Cannot extract ${constName}: no closing bracket`);
}

function evalExpression(source, constName) {
  const expression = extractConstExpression(source, constName);
  return vm.runInNewContext(`(${expression})`, {});
}

function extractNamedFunction(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker}`);
  const paramsOpen = source.indexOf('(', start + marker.length);
  if (paramsOpen < 0) throw new Error(`Missing parameters for ${marker}`);
  let paramsDepth = 0;
  let paramsClose = -1;
  for (let index = paramsOpen; index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1;
    else if (source[index] === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsClose = index;
        break;
      }
    }
  }
  const open = paramsClose >= 0 ? source.indexOf('{', paramsClose) : -1;
  if (open < 0) throw new Error(`Missing body for ${marker}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed body for ${marker}`);
}

// The Unity client renders editor actor models through RoaEnemyModels.Urls.
function readUnityModelUrls() {
  const base = unityModels.match(/const string Wasteland = "([^"]+)";/)?.[1];
  if (!base) throw new Error('Missing RoaEnemyModels.Wasteland base URL');
  return Object.fromEntries(Array.from(
    unityModels.matchAll(/\{\s*"(\w+)",\s*Wasteland\s*\+\s*"([^"]+\.glb)"\s*\}/g),
    match => [match[1], `${base}${match[2]}`]
  ));
}

function hasTag(row, tag) {
  return Array.isArray(row?.tags) && row.tags.map(x => String(x || '').toLowerCase()).includes(tag);
}

function publicAssetPath(url) {
  const clean = String(url || '').split(/[?#]/)[0].replace(/^\/+/, '');
  return path.join(root, 'public', clean.replace(/\//g, path.sep));
}

const modelLibrary = evalExpression(editor, 'MODEL_LIBRARY').map(row => ({
  ...row,
  url: row.url || `/assets/models/wasteland/${row.file}`
}));
const entityRules = evalExpression(editor, 'MODEL_ENTITY_RULES');
const placementRules = evalExpression(editor, 'MODEL_PLACEMENT_RULES');
const generationProfiles = evalExpression(editor, 'NPC_AUTO_GENERATION_PROFILES');
const unityModelUrls = readUnityModelUrls();
const mergeAuthoredObjectMetadata = vm.runInNewContext(
  `(${extractNamedFunction(editor, 'mergeAuthoredObjectMetadata')})`,
  {}
);

const caravanCamp = JSON.parse(fs.readFileSync(path.join(root, 'data', 'locations', 'caravanCamp.json'), 'utf8'));
const saylaSource = caravanCamp.objects.find(row => row.id === 'caravan_sayla');
const storageSource = caravanCamp.objects.find(row => row.id === 'capital_storage_caravans');
const saylaRoundTrip = mergeAuthoredObjectMetadata({
  id: saylaSource.id,
  model: saylaSource.model,
  position: { x: -6, y: 0, z: 4 },
  entity: { kind: 'npc', role: 'merchant', faction: 'old_klim', stationary: true }
}, saylaSource);
const storageRoundTrip = mergeAuthoredObjectMetadata({
  id: storageSource.id,
  model: storageSource.model,
  position: storageSource.position
}, storageSource);
if (saylaRoundTrip.entity?.npcId !== 'caravan_sayla' || saylaRoundTrip.entity?.routineId !== 'caravan_sayla') {
  fail('location editor round-trip drops authored npcId/routineId');
}
if (saylaRoundTrip.entity?.faction !== 'caravans' || saylaRoundTrip.entity?.stationary !== true) {
  fail('location editor round-trip overwrites authored NPC metadata with model defaults');
}
if (saylaRoundTrip.position?.x !== -6 || saylaRoundTrip.position?.z !== 4) {
  fail('location editor round-trip lets stale authored coordinates overwrite edited coordinates');
}
if (storageRoundTrip.interactive?.kind !== storageSource.interactive?.kind || storageRoundTrip.role !== storageSource.role) {
  fail('location editor round-trip drops authored interaction metadata');
}
if (!editor.includes('createPlacedObject(def, { ...object, authoredSource: object })')
  || !editor.includes('mergeAuthoredObjectMetadata(generated, object.authoredSource)')) {
  fail('location editor does not wire authored object metadata through import and export');
}

const libraryByKey = new Map();
for (const model of modelLibrary) {
  if (!model.key) {
    fail('MODEL_LIBRARY contains a row without key');
    continue;
  }
  if (libraryByKey.has(model.key)) fail(`MODEL_LIBRARY has duplicate key "${model.key}"`);
  libraryByKey.set(model.key, model);
  if (!model.file) fail(`MODEL_LIBRARY.${model.key} has no file`);
  else if (!fs.existsSync(path.join(modelsDir, model.file))) fail(`MODEL_LIBRARY.${model.key} points to missing ${model.file}`);
  if (!unityModelUrls[model.key]) fail(`RoaEnemyModels has no Unity entry for editor model "${model.key}"`);
  else if (path.basename(unityModelUrls[model.key]) !== model.file) {
    fail(`RoaEnemyModels.${model.key} uses ${path.basename(unityModelUrls[model.key])}, editor uses ${model.file}`);
  }
  if (!fs.existsSync(publicAssetPath(model.url))) fail(`MODEL_LIBRARY.${model.key} url points to missing ${model.url}`);
}

const expectedNpcKeys = [
  'traderNpc',
  'caravanMerchant',
  'caravanGuard',
  'klimPatrolGuard',
  'wastelandSettler',
  'friendlyBrahmin',
  'enemyRaider',
  'enemyGhoul',
  'enemySuperMutant',
  'enemyAshWolf',
  'enemyRadscorpion',
  'enemyMutantAnt',
  'enemyGecko',
  'enemyFireGecko'
];

const merchantKeys = new Set(['traderNpc', 'caravanMerchant']);
const guardKeys = new Set(['caravanGuard', 'klimPatrolGuard']);
const naturalKeys = new Map([
  ['friendlyBrahmin', { role: 'animal', species: 'brahmin', faction: 'caravan', equipmentProfile: 'none', canDialogue: false }],
  ['enemyGhoul', { role: 'monster', species: 'ghoul', faction: 'ghouls', equipmentProfile: 'natural' }],
  ['enemyAshWolf', { role: 'monster', species: 'ashWolf', faction: 'ash_wolves', equipmentProfile: 'natural' }],
  ['enemyRadscorpion', { role: 'monster', species: 'radScorpion', faction: 'radscorpions', equipmentProfile: 'natural' }],
  ['enemyMutantAnt', { role: 'monster', species: 'mutantAnt', faction: 'mutant_ants', equipmentProfile: 'natural' }],
  ['enemyGecko', { role: 'monster', species: 'gecko', faction: 'geckos', equipmentProfile: 'natural' }],
  ['enemyFireGecko', { role: 'monster', species: 'fireGecko', faction: 'geckos', equipmentProfile: 'natural' }]
]);

for (const key of expectedNpcKeys) {
  if (!libraryByKey.has(key)) fail(`NPC model "${key}" is missing from MODEL_LIBRARY`);
  if (!entityRules[key]) fail(`NPC model "${key}" has no MODEL_ENTITY_RULES entry`);
  if (!placementRules[key]) fail(`NPC model "${key}" has no MODEL_PLACEMENT_RULES entry`);
  if (!generationProfiles[key]) fail(`NPC model "${key}" has no NPC_AUTO_GENERATION_PROFILES entry`);
}

for (const key of Object.keys(entityRules)) {
  if (!libraryByKey.has(key)) fail(`MODEL_ENTITY_RULES.${key} has no matching MODEL_LIBRARY row`);
}
for (const key of Object.keys(generationProfiles)) {
  if (!libraryByKey.has(key)) fail(`NPC_AUTO_GENERATION_PROFILES.${key} has no matching MODEL_LIBRARY row`);
}

for (const key of merchantKeys) {
  const entity = entityRules[key] || {};
  const generation = generationProfiles[key] || {};
  if (entity.role !== 'merchant') fail(`${key} must have role=merchant`);
  if (entity.hostileToPlayer !== false) fail(`${key} must be non-hostile`);
  if (!entity.traderProfile && !generation.tradeProfile) fail(`${key} must define a trader/trade profile`);
  if (!hasTag(entity, 'merchant') && !hasTag(entity, 'trader')) fail(`${key} must be tagged as merchant/trader`);
  if (naturalKeys.has(key)) fail(`${key} cannot be a natural creature`);
}

for (const key of guardKeys) {
  const entity = entityRules[key] || {};
  const generation = generationProfiles[key] || {};
  if (entity.role !== 'guard') fail(`${key} must have role=guard`);
  if (entity.hostileToPlayer !== false) fail(`${key} must be non-hostile by default`);
  if (!generation.tradeProfile) fail(`${key} must define guard trade profile for patrol/barter dialog`);
  if (!hasTag(entity, 'guard')) fail(`${key} must be tagged as guard`);
}

for (const [key, expected] of naturalKeys.entries()) {
  const entity = entityRules[key] || {};
  const generation = generationProfiles[key] || {};
  if (entity.role !== expected.role) fail(`${key} must have role=${expected.role}`);
  if (entity.species !== expected.species) fail(`${key} must have species=${expected.species}`);
  if (entity.faction !== expected.faction) fail(`${key} must have faction=${expected.faction}`);
  if (expected.canDialogue === false && entity.canDialogue !== false) fail(`${key} must explicitly disable dialogue`);
  if (entity.traderProfile || entity.tradeProfile || generation.tradeProfile || generation.traderProfile) {
    fail(`${key} is a creature/monster and must not have trader profiles`);
  }
  if (generation.equipmentProfile !== expected.equipmentProfile) {
    fail(`${key} must use equipmentProfile=${expected.equipmentProfile}, got ${generation.equipmentProfile || 'empty'}`);
  }
  if (hasTag(entity, 'merchant') || hasTag(entity, 'trader')) fail(`${key} must not be tagged merchant/trader`);
  if (key.startsWith('enemy') && entity.hostileToPlayer !== true) fail(`${key} must be hostile by default`);
}

const serverRequiredSnippets = [
  'friendlyBrahmin',
  'enemyMutantAnt',
  'caravanMerchant',
  'klimPatrolGuard',
  'serverEncounterActorVisualModel',
  'normalizeServerNaturalCreatureState'
];
for (const snippet of serverRequiredSnippets) {
  if (!server.includes(snippet)) fail(`server.js missing expected NPC/model mapping snippet "${snippet}"`);
}

if (issues.length) {
  throw new Error(`Editor model check failed:\n${issues.map(issue => `- ${issue}`).join('\n')}`);
}

console.log(`Editor models OK: ${modelLibrary.length} model(s), ${expectedNpcKeys.length} NPC/creature rule(s) checked`);
