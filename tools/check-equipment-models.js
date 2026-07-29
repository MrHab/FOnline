'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  validateProduction
} = require('./art/validate-service-boots-service-scout-production');

const root = path.resolve(__dirname, '..');
const manifestFile = path.join(
  root,
  'public',
  'assets',
  'models',
  'characters',
  'service-scout-boots-manifest.json'
);
const runtimeFile = path.join(
  root,
  'public',
  'js',
  'game',
  '04b_service_scout_boots_runtime.js'
);
const visualsFile = path.join(
  root,
  'public',
  'js',
  'game',
  '04_player_model_visuals.js'
);

const production = validateProduction();
assert(
  production.valid,
  `Service Scout production is invalid:\n${production.issues.join('\n')}`
);
assert.strictEqual(production.stats.glbs, 18, 'runtime boot GLB matrix changed');
assert.strictEqual(production.stats.variants, 6, 'runtime boot body matrix changed');
assert.strictEqual(production.stats.physicalItemId, 'scoutBoots', 'physical item binding changed');

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
assert.strictEqual(manifest.defaultVariant, 'male_medium', 'default runtime variant changed');
assert.strictEqual(manifest.files?.length, 18, 'runtime manifest must publish 18 GLBs');
for (const url of manifest.files) {
  const file = path.join(root, 'public', String(url).replace(/^\//, ''));
  assert(fs.existsSync(file), `runtime boot GLB is missing: ${url}`);
}

const runtimeSource = fs.readFileSync(runtimeFile, 'utf8');
const visualsSource = fs.readFileSync(visualsFile, 'utf8');
[
  'function serviceScoutVariantForParts(parts = {})',
  'function attachServiceScoutTemplates(parts, variant, manifest, templates)',
  'function syncServiceScoutBootVisual(parts = {}, bootsId = \'\')'
].forEach(marker => {
  assert(runtimeSource.includes(marker), `Service Scout runtime integration is missing: ${marker}`);
});
assert(
  visualsSource.includes('syncServiceScoutBootVisual(parts, bootsId)'),
  'equipment visual switch does not bind the physical scoutBoots item'
);

console.log(
  'Equipment models OK: 18 Service Scout GLBs, 6 body variants, '
  + '3 LOD tiers and physical scoutBoots authority'
);
