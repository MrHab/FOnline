#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const TRIANGLE_BUDGET = 12_000;

const DEFINITIONS = Object.freeze([
  {
    itemId: 'leather',
    directory: ['unified-equipment-leather-jacket-v1', 'jacket'],
    prefix: 'equipment_leather_jacket_unified_v1',
    meshCount: 2,
    creator: 'Quaternius',
    license: 'CC0-1.0',
    materials: [
      'jacket_weathered_oxblood_leather',
      'jacket_dark_edge_leather',
      'jacket_tarnished_hardware'
    ]
  },
  {
    itemId: 'metalArmor',
    directory: ['unified-equipment-metal-armor-v1', 'armor'],
    prefix: 'equipment_metal_armor_unified_v1',
    meshCount: 1,
    creator: 'Quaternius',
    license: 'CC0-1.0',
    materials: [
      'metal_armour_charcoal_padding',
      'metal_armour_worn_steel',
      'metal_armour_oxidised_edges',
      'metal_armour_aged_straps'
    ]
  },
  {
    itemId: 'ballisticVest',
    directory: ['unified-equipment-ballistic-vest-v1', 'vest'],
    prefix: 'equipment_ballistic_vest_unified_v1',
    meshCount: 1,
    creator: 'Quaternius',
    license: 'CC0-1.0',
    materials: [
      'ballistic_vest_faded_olive_carrier',
      'ballistic_vest_charcoal_insert',
      'ballistic_vest_dusty_webbing',
      'ballistic_vest_oxidised_hardware',
      'ballistic_vest_faded_repair_cloth'
    ]
  },
  {
    itemId: 'combatArmor',
    directory: ['unified-equipment-combat-armor-v1', 'armor'],
    prefix: 'equipment_combat_armor_unified_v1',
    meshCount: 1,
    creator: 'Manaos',
    license: 'CC-BY',
    materials: [
      'combat_armor_chipped_olive_composite',
      'combat_armor_black_shock_strip',
      'combat_armor_tarnished_alloy',
      'combat_armor_faded_tan_repair',
      'combat_armor_graphite_underlayer'
    ]
  },
  {
    itemId: 'heavyArmor',
    directory: ['unified-equipment-heavy-armor-v1', 'armor'],
    prefix: 'equipment_heavy_armor_unified_v1',
    meshCount: 1,
    creator: 'Manaos',
    license: 'CC-BY',
    materials: [
      'heavy_armor_black_padded_underlayer',
      'heavy_armor_worn_gunmetal',
      'heavy_armor_olive_composite_inserts',
      'heavy_armor_aged_webbing',
      'heavy_armor_oxidised_hardware',
      'heavy_armor_faded_hazard_repair'
    ]
  },
  {
    itemId: 'hazmatSuit',
    directory: ['unified-equipment-hazmat-suit-v1', 'suit'],
    prefix: 'equipment_hazmat_suit_unified_v1',
    meshCount: 2,
    creator: 'Quaternius',
    license: 'CC0-1.0',
    materials: [
      'hazmat_faded_mustard_canvas',
      'hazmat_aged_black_rubber',
      'hazmat_oxidized_filter_metal',
      'hazmat_scratched_smoke_visor',
      'hazmat_dusty_olive_repairs',
      'hazmat_faded_warning_panel'
    ]
  },
  {
    itemId: 'energySuit',
    directory: ['unified-equipment-energy-suit-v1', 'suit'],
    prefix: 'equipment_energy_suit_unified_v1',
    meshCount: 2,
    creator: 'Quaternius',
    license: 'CC0-1.0',
    materials: [
      'energy_suit_weathered_graphite_composite',
      'energy_suit_aged_charcoal_insulation',
      'energy_suit_tarnished_copper_channels',
      'energy_suit_cyan_field_glass',
      'energy_suit_chipped_blue_ceramic',
      'energy_suit_oxidized_service_patch'
    ]
  }
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)} is not a GLB`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${path.basename(file)} is not glTF 2`);
  const jsonLength = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/g, '').trim());
}

function gltfTriangleCount(gltf) {
  return (gltf.meshes || []).reduce((meshTotal, mesh) => meshTotal + (mesh.primitives || []).reduce(
    (primitiveTotal, primitive) => {
      assert.strictEqual(primitive.mode ?? 4, 4, 'armor primitives must use TRIANGLES mode');
      const count = Number.isInteger(primitive.indices)
        ? gltf.accessors?.[primitive.indices]?.count
        : gltf.accessors?.[primitive.attributes?.POSITION]?.count;
      assert(Number.isInteger(count) && count > 0, 'armor primitive has no countable geometry');
      return primitiveTotal + count / 3;
    },
    0
  ), 0);
}

function assertFile(file, label) {
  assert(fs.existsSync(file), `${label} is missing: ${file}`);
  assert(fs.statSync(file).size > 0, `${label} is empty: ${file}`);
}

function checkDefinition(root, definition) {
  const reviewDirectory = path.join(root, 'docs', 'art', 'reviews', ...definition.directory);
  const summaryFile = path.join(reviewDirectory, 'fit-report-all.json');
  assertFile(summaryFile, `${definition.itemId} family report`);
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  assert.strictEqual(summary.itemId, definition.itemId);
  assert.strictEqual(summary.triangleBudgetPerVariant, TRIANGLE_BUDGET);
  assert.deepStrictEqual(summary.bodyIds, BODY_IDS);
  assert.strictEqual(summary.variantCount, BODY_IDS.length);
  assert.strictEqual(summary.variants?.length, BODY_IDS.length);

  const triangleCounts = [];
  for (const bodyId of BODY_IDS) {
    const stem = `${definition.prefix}_${bodyId}`;
    const glbFile = path.join(reviewDirectory, `${stem}.glb`);
    const reportFile = path.join(reviewDirectory, `${stem}.report.json`);
    const frontRender = path.join(reviewDirectory, `${stem}_front.png`);
    assertFile(glbFile, `${definition.itemId} ${bodyId} GLB`);
    assertFile(reportFile, `${definition.itemId} ${bodyId} report`);
    assertFile(frontRender, `${definition.itemId} ${bodyId} front render`);

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const gltf = parseGlb(glbFile);
    const triangles = gltfTriangleCount(gltf);
    assert.strictEqual(report.assetId, stem);
    assert.strictEqual(report.itemId, definition.itemId);
    assert.strictEqual(report.bodyId, bodyId);
    assert.strictEqual(report.slot, 'armor');
    assert.strictEqual(report.reviewOnly, true);
    assert.strictEqual(report.runtimeIntegrationAllowed, false);
    assert.strictEqual(report.sha256, sha256(glbFile), `${stem} checksum is stale`);
    assert.strictEqual(report.source?.creator, definition.creator);
    assert.strictEqual(report.source?.license, definition.license);
    assert.strictEqual(report.source?.geometryOrigin, 'downloaded_refit');
    assert(/^[A-F0-9]{64}(\/[A-F0-9]{64})?$/.test(report.source?.sha256 || ''), `${stem} source hash is invalid`);
    assert.strictEqual(gltf.skins?.length, 1, `${stem} must use one skin`);
    assert.strictEqual(gltf.skins[0].joints?.length, 65, `${stem} must use the 65-bone player rig`);
    assert.strictEqual(gltf.meshes?.length, definition.meshCount, `${stem} mesh count changed`);
    assert.deepStrictEqual(
      (gltf.materials || []).map(material => material.name).sort(),
      [...definition.materials].sort(),
      `${stem} material set changed`
    );
    for (const mesh of gltf.meshes || []) {
      for (const primitive of mesh.primitives || []) {
        assert(Number.isInteger(primitive.attributes?.JOINTS_0), `${stem} has unskinned geometry`);
        assert(Number.isInteger(primitive.attributes?.WEIGHTS_0), `${stem} has geometry without weights`);
      }
    }
    assert.strictEqual(report.actualGlb?.triangles, triangles, `${stem} triangle report is stale`);
    assert.strictEqual(report.actualGlb?.meshes, definition.meshCount);
    assert(triangles > 0 && triangles <= TRIANGLE_BUDGET, `${stem} exceeds ${TRIANGLE_BUDGET} triangles`);
    triangleCounts.push(triangles);
  }

  for (const suffix of ['_back.png', '_detail.png', '_review.blend']) {
    assertFile(path.join(reviewDirectory, `${definition.prefix}_male_medium${suffix}`), `${definition.itemId} review extra`);
  }
  return {
    itemId: definition.itemId,
    variants: BODY_IDS.length,
    minTriangles: Math.min(...triangleCounts),
    maxTriangles: Math.max(...triangleCounts),
    license: definition.license
  };
}

function checkItems(itemIds = DEFINITIONS.map(definition => definition.itemId), root = REPOSITORY_ROOT) {
  const wanted = new Set(itemIds);
  const selected = DEFINITIONS.filter(definition => wanted.has(definition.itemId));
  assert.strictEqual(selected.length, wanted.size, `unknown armor item: ${[...wanted].filter(id => !selected.some(def => def.itemId === id)).join(', ')}`);
  const rows = selected.map(definition => checkDefinition(root, definition));
  for (const row of rows) {
    console.log(`${row.itemId}: ${row.variants} variants, ${row.minTriangles}-${row.maxTriangles} triangles, ${row.license}`);
  }
  console.log(`Free armor replacements OK: ${rows.length} families stay within ${TRIANGLE_BUDGET} triangles.`);
  return rows;
}

if (require.main === module) {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : REPOSITORY_ROOT;
  const itemIds = process.argv.filter((value, index) => index > 1 && value !== '--root' && index !== rootIndex + 1);
  checkItems(itemIds.length ? itemIds : undefined, root);
}

module.exports = { BODY_IDS, DEFINITIONS, TRIANGLE_BUDGET, checkItems };
