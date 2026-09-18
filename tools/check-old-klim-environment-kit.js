#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'old-klim-environment-kit-v1');
const REPORT_FILE = path.join(REVIEW_DIR, 'technical-report.json');
const RUNTIME_DIR = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const MANIFEST_FILE = path.join(RUNTIME_DIR, 'old-klim-environment-kit-manifest.json');
const GENERATOR = path.join(ROOT, 'tools', 'blender', 'build_old_klim_environment_kit.py');
const COLLIDER_FILE = path.join(RUNTIME_DIR, 'model-colliders.json');
const LOCATION_FILE = path.join(ROOT, 'data', 'locations', 'settlement.json');
const EXPECTED = Object.freeze({
  old_klim_trade_hall: { kind: 'hero_structure', maxMaterials: 3, maxPrimitives: 5, maxTriangles: 6500 },
  old_klim_trade_hall_roof: { kind: 'cutaway_roof', maxMaterials: 2, maxPrimitives: 2, maxTriangles: 2200 },
  old_klim_cliff_straight: { kind: 'cliff_module_straight', maxMaterials: 2, maxPrimitives: 2, maxTriangles: 1800 },
  old_klim_cliff_corner: { kind: 'cliff_module_corner', maxMaterials: 2, maxPrimitives: 2, maxTriangles: 2200 },
  old_klim_cliff_end: { kind: 'cliff_module_end', maxMaterials: 2, maxPrimitives: 2, maxTriangles: 1800 },
  old_klim_loading_canopy: { kind: 'loading_yard_canopy', maxMaterials: 2, maxPrimitives: 2, maxTriangles: 1600 },
  old_klim_caravan: { kind: 'caravan_prop', maxMaterials: 3, maxPrimitives: 3, maxTriangles: 3200 },
  old_klim_scrub_blue_a: { kind: 'scrub_scatter', maxMaterials: 1, maxPrimitives: 1, maxTriangles: 750 },
  old_klim_scrub_blue_b: { kind: 'scrub_scatter', maxMaterials: 1, maxPrimitives: 1, maxTriangles: 750 },
  old_klim_scrub_amber: { kind: 'scrub_scatter', maxMaterials: 1, maxPrimitives: 1, maxTriangles: 750 },
  old_klim_rock_scatter_a: { kind: 'rock_scatter', maxMaterials: 1, maxPrimitives: 1, maxTriangles: 240 },
  old_klim_rock_scatter_b: { kind: 'rock_scatter', maxMaterials: 1, maxPrimitives: 1, maxTriangles: 280 },
  old_klim_rock_scatter_c: { kind: 'rock_scatter', maxMaterials: 1, maxPrimitives: 1, maxTriangles: 240 }
});
const NON_BLOCKING_IDS = new Set([
  'old_klim_trade_hall_roof',
  'old_klim_scrub_blue_a',
  'old_klim_scrub_blue_b',
  'old_klim_scrub_amber',
  'old_klim_rock_scatter_a',
  'old_klim_rock_scatter_b',
  'old_klim_rock_scatter_c'
]);
const BLOCKING_IDS = new Set([
  'old_klim_trade_hall',
  'old_klim_cliff_straight',
  'old_klim_cliff_corner',
  'old_klim_cliff_end',
  'old_klim_loading_canopy',
  'old_klim_caravan'
]);

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)}: bad GLB signature`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${path.basename(file)}: glTF 2 is required`);
  assert.strictEqual(data.readUInt32LE(8), data.length, `${path.basename(file)}: GLB length is inconsistent`);
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trim());
    if (type === 'BIN\0') binary = chunk;
    offset += 8 + length;
  }
  assert(json && binary, `${path.basename(file)}: JSON or BIN chunk is missing`);
  return { data, json };
}

assert(fs.existsSync(REPORT_FILE), 'Old Klim technical report is missing');
assert(fs.existsSync(MANIFEST_FILE), 'Old Klim runtime manifest is missing');
assert(fs.existsSync(GENERATOR), 'Old Klim Blender generator is missing');
assert(fs.existsSync(COLLIDER_FILE), 'Model collider catalog is missing');
assert(fs.existsSync(LOCATION_FILE), 'Old Klim authored location is missing');
const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const colliderCatalog = JSON.parse(fs.readFileSync(COLLIDER_FILE, 'utf8'));
const location = JSON.parse(fs.readFileSync(LOCATION_FILE, 'utf8'));
const expectedIds = Object.keys(EXPECTED);

assert.strictEqual(report.schema, 'realm.old-klim-environment-report.v1');
assert.strictEqual(manifest.schema, 'realm.old-klim-environment-kit.v1');
assert.strictEqual(report.assetVersion, 'old-klim-caravan-yard-v1');
assert.strictEqual(manifest.assetVersion, report.assetVersion);
assert.strictEqual(report.style, 'geometry_b_material_colours');
assert.strictEqual(manifest.style, report.style);
assert.strictEqual(report.rasterTextureDependencies, 0);
assert.strictEqual(manifest.rasterTextureDependencies, 0);
assert.deepStrictEqual(Object.keys(report.models), expectedIds, 'Unexpected review model order');
assert.deepStrictEqual(Object.keys(manifest.models), expectedIds, 'Unexpected runtime model order');
const generatorSha = sha256(fs.readFileSync(GENERATOR));
assert.strictEqual(report.generatorSha256, generatorSha, 'Generator changed without rebuilding the review');
assert.strictEqual(manifest.generatorSha256, generatorSha, 'Generator changed without rebuilding runtime assets');

const totals = { bytes: 0, meshes: 0, primitives: 0, vertices: 0, triangles: 0 };
for (const modelId of expectedIds) {
  const limits = EXPECTED[modelId];
  const review = report.models[modelId];
  const runtime = manifest.models[modelId];
  assert(review && runtime, `${modelId}: report or manifest entry missing`);
  assert.strictEqual(review.kind, limits.kind, `${modelId}: wrong model kind`);
  assert.strictEqual(runtime.kind, limits.kind, `${modelId}: runtime kind differs`);
  assert(['unique', 'limited', 'required'].includes(review.instancing), `${modelId}: invalid instancing policy`);
  if (review.instancing === 'required') {
    assert(review.primitives <= 2, `${modelId}: instanced model must stay at one or two primitives`);
  }
  const reviewFile = path.join(REVIEW_DIR, review.file);
  const expectedRuntimePath = `/assets/models/wasteland/${modelId}.glb`;
  assert.strictEqual(runtime.runtimeFile, expectedRuntimePath, `${modelId}: unstable runtime path`);
  const runtimeFile = path.join(ROOT, 'public', runtime.runtimeFile.replace(/^\//, ''));
  assert(fs.existsSync(reviewFile), `${modelId}: review GLB is missing`);
  assert(fs.existsSync(runtimeFile), `${modelId}: runtime GLB is missing`);
  assert(colliderCatalog.models?.[`${modelId}.glb`], `${modelId}: collider catalog entry is missing`);
  const collisionMode = colliderCatalog.models[`${modelId}.glb`].collision?.mode;
  if (NON_BLOCKING_IDS.has(modelId)) {
    assert.strictEqual(collisionMode, 'none', `${modelId}: set dressing must be non-blocking`);
  }
  if (BLOCKING_IDS.has(modelId)) {
    assert.strictEqual(collisionMode, 'solid', `${modelId}: major prop collider is missing`);
  }
  const reviewData = fs.readFileSync(reviewFile);
  const runtimeData = fs.readFileSync(runtimeFile);
  assert(reviewData.equals(runtimeData), `${modelId}: runtime GLB differs from reviewed GLB`);
  assert.strictEqual(sha256(reviewData), review.sha256, `${modelId}: review SHA mismatch`);
  assert.strictEqual(sha256(runtimeData), runtime.sha256, `${modelId}: runtime SHA mismatch`);
  assert.strictEqual(review.bytes, reviewData.length, `${modelId}: byte count mismatch`);

  const parsed = parseGlb(reviewFile);
  const gltf = parsed.json;
  assert.strictEqual((gltf.images || []).length, 0, `${modelId}: raster images are forbidden`);
  assert.strictEqual((gltf.textures || []).length, 0, `${modelId}: texture dependencies are forbidden`);
  assert.strictEqual((gltf.samplers || []).length, 0, `${modelId}: texture samplers are forbidden`);
  const rootNode = (gltf.nodes || []).find(node => node.extras?.realm_model_id === modelId);
  assert(rootNode, `${modelId}: root extras are missing`);
  assert.strictEqual(rootNode.extras.realm_schema, 'realm.old-klim-environment-model.v1');
  assert.strictEqual(rootNode.extras.realm_asset_version, report.assetVersion);
  assert.strictEqual(rootNode.extras.realm_style, report.style);
  assert.strictEqual(rootNode.extras.realm_kind, limits.kind);
  assert.strictEqual(rootNode.extras.realm_collision_policy, 'authored_location_unchanged');
  const materials = (gltf.materials || []).length;
  const meshes = (gltf.meshes || []).length;
  const primitives = (gltf.meshes || []).reduce((sum, mesh) => sum + (mesh.primitives || []).length, 0);
  const triangles = (gltf.meshes || []).reduce((meshTotal, mesh) => (
    meshTotal + (mesh.primitives || []).reduce((primitiveTotal, primitive) => {
      const accessor = gltf.accessors?.[primitive.indices];
      assert(accessor, `${modelId}: indexed geometry is required`);
      return primitiveTotal + Number(accessor.count || 0) / 3;
    }, 0)
  ), 0);
  const vertices = (gltf.meshes || []).reduce((meshTotal, mesh) => (
    meshTotal + (mesh.primitives || []).reduce((primitiveTotal, primitive) => {
      const accessor = gltf.accessors?.[primitive.attributes?.POSITION];
      assert(accessor, `${modelId}: POSITION accessor is missing`);
      return primitiveTotal + Number(accessor.count || 0);
    }, 0)
  ), 0);
  assert(materials >= 1 && materials <= limits.maxMaterials, `${modelId}: material budget exceeded`);
  assert(meshes >= 1 && meshes <= limits.maxPrimitives, `${modelId}: mesh budget exceeded`);
  assert(primitives >= 1 && primitives <= limits.maxPrimitives, `${modelId}: primitive budget exceeded`);
  assert(triangles > 0 && triangles <= limits.maxTriangles, `${modelId}: triangle budget exceeded`);
  assert.strictEqual(review.materials, materials, `${modelId}: reported materials differ`);
  assert.strictEqual(review.meshes, meshes, `${modelId}: reported meshes differ`);
  assert.strictEqual(review.primitives, primitives, `${modelId}: reported primitives differ`);
  assert.strictEqual(review.triangles, triangles, `${modelId}: reported triangles differ`);
  assert.strictEqual(review.vertices, vertices, `${modelId}: reported vertices differ`);
  assert.strictEqual(review.images, 0, `${modelId}: report must declare zero images`);
  assert(Array.isArray(review.sizeMetres) && review.sizeMetres.length === 3, `${modelId}: invalid bounds`);
  assert(review.minimumMetres[2] >= -0.06, `${modelId}: model sinks below ground`);

  totals.bytes += review.bytes;
  totals.meshes += meshes;
  totals.primitives += primitives;
  totals.vertices += vertices;
  totals.triangles += triangles;
}

assert.strictEqual(
  report.models.old_klim_trade_hall.cutawayGroup,
  'old_klim_trade_hall_roof',
  'Trade hall must declare its separate roof group'
);
assert.strictEqual(
  report.models.old_klim_trade_hall_roof.cutawayFor,
  'old_klim_trade_hall',
  'Roof must point back to its cutaway structure'
);
assert.strictEqual(
  colliderCatalog.models['old_klim_trade_hall_roof.glb']?.collision?.mode,
  'none',
  'The separately hidden roof must not create a walk collider'
);
const tradeHallCollision = colliderCatalog.models['old_klim_trade_hall.glb']?.collision;
assert.strictEqual(tradeHallCollision?.method, 'authored-glb-walk-parts-v1',
  'Trade hall must use its open-interior GLB collision parts');
assert.strictEqual(tradeHallCollision?.parts?.length, 10,
  'Trade hall collision must preserve walls, counters and both entrances as separate parts');
assert(!tradeHallCollision.parts.some(part => Number(part.size?.x || 0) > 8 && Number(part.size?.z || 0) > 3),
  'Trade hall collision must never fill the whole interior');
assert.deepStrictEqual(report.totals, totals, 'Review totals differ from parsed GLBs');
assert.deepStrictEqual(manifest.totals, totals, 'Runtime totals differ from parsed GLBs');
assert(totals.primitives <= 24, `Kit draw budget exceeded: ${totals.primitives} primitives`);
assert(totals.triangles <= 22000, `Kit geometry budget exceeded: ${totals.triangles} triangles`);

assert.strictEqual(location.visualProfile?.id, report.assetVersion, 'Settlement visual profile does not match the kit');
const rows = Array.isArray(location.objects) ? location.objects : [];
const rowsByModel = new Map();
for (const row of rows) {
  const key = String(row?.model || '');
  if (!rowsByModel.has(key)) rowsByModel.set(key, []);
  rowsByModel.get(key).push(row);
}
assert.strictEqual(rowsByModel.get('oldKlimTradeHall')?.length, 1, 'Old Klim trade hall placement is missing');
assert.strictEqual(rowsByModel.get('oldKlimTradeHallRoof')?.length, 1, 'Old Klim cutaway roof placement is missing');
const cliffRows = rows.filter(row => String(row?.model || '').startsWith('oldKlimCliff'));
assert.strictEqual(cliffRows.length, 16, 'Old Klim cliff perimeter must stay complete');
cliffRows.forEach(row => {
  assert.strictEqual(row.collision, 'solid', `${row.id}: cliff must block movement`);
  assert.strictEqual(row.vision?.mode, 'block', `${row.id}: tall cliff must block vision`);
  assert(!row.collisionSize, `${row.id}: cliff must use its generated centered collider`);
});
const scatterRows = rows.filter(row => /^(oldKlimScrub|oldKlimRockScatter)/.test(String(row?.model || '')));
assert(scatterRows.length >= 20, 'Old Klim scatter dressing was reduced below the approved composition');
const caravan = rows.find(row => row?.model === 'oldKlimCaravan');
assert.strictEqual(caravan?.collision, 'solid', 'Old Klim caravan must block movement');
const canopy = rows.find(row => row?.model === 'oldKlimLoadingCanopy');
assert.strictEqual(canopy?.playerCollision, 'none', 'Open Old Klim canopy must remain walk-through');

console.log(
  `Old Klim environment kit OK: ${expectedIds.length} GLB, `
  + `${totals.primitives} primitives, ${totals.triangles} triangles, zero raster textures.`
);
