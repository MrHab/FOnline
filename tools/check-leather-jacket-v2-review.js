#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRECTORY = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-leather-jacket-v2', 'jacket');
const ASSET_ID = 'equipment_leather_jacket_unified_v2';
const BODY_IDS = ['female_slim', 'female_medium', 'female_large', 'male_slim', 'male_medium', 'male_large'];
const CHARACTER_DIRECTORY = path.join(ROOT, 'public', 'assets', 'models', 'characters', 'base');

const COMPONENT_READERS = {
  5121: { bytes: 1, read: (buffer, offset) => buffer.readUInt8(offset), max: 255 },
  5123: { bytes: 2, read: (buffer, offset) => buffer.readUInt16LE(offset), max: 65535 },
  5125: { bytes: 4, read: (buffer, offset) => buffer.readUInt32LE(offset), max: 4294967295 },
  5126: { bytes: 4, read: (buffer, offset) => buffer.readFloatLE(offset), max: 1 }
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(file) {
  const buffer = fs.readFileSync(file);
  assert.strictEqual(buffer.toString('ascii', 0, 4), 'glTF', `${path.basename(file)}: invalid GLB magic`);
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  assert.strictEqual(jsonType, 0x4E4F534A, `${path.basename(file)}: JSON chunk missing`);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').replace(/[\0\s]+$/u, ''));
  const binHeader = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binHeader);
  const binType = buffer.readUInt32LE(binHeader + 4);
  assert.strictEqual(binType, 0x004E4942, `${path.basename(file)}: BIN chunk missing`);
  return { gltf, bin: buffer.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function readAccessor(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const component = COMPONENT_READERS[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  assert(component && components, `unsupported accessor encoding: ${accessor.componentType}/${accessor.type}`);
  const stride = view.byteStride || component.bytes * components;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return Array.from({ length: accessor.count }, (_, elementIndex) => {
    const elementOffset = start + elementIndex * stride;
    return Array.from({ length: components }, (_, componentIndex) => {
      const value = component.read(bin, elementOffset + componentIndex * component.bytes);
      return accessor.normalized ? value / component.max : value;
    });
  });
}

function skinJointNames(gltf) {
  assert.strictEqual(gltf.skins?.length, 1, 'expected exactly one skin');
  return gltf.skins[0].joints.map(nodeIndex => gltf.nodes[nodeIndex]?.name || '');
}

function assertEmbeddedPng512(gltf, bin, bodyId) {
  assert.strictEqual(gltf.images?.length, 12, `${bodyId}: expected twelve embedded images`);
  for (const [index, image] of gltf.images.entries()) {
    assert.strictEqual(image.mimeType, 'image/png', `${bodyId}: image ${index} is not PNG`);
    assert(Number.isInteger(image.bufferView), `${bodyId}: image ${index} is external`);
    const view = gltf.bufferViews[image.bufferView];
    const start = view.byteOffset || 0;
    assert.strictEqual(bin.toString('hex', start, start + 8), '89504e470d0a1a0a', `${bodyId}: image ${index} has invalid PNG signature`);
    assert.strictEqual(bin.readUInt32BE(start + 16), 512, `${bodyId}: image ${index} width drifted`);
    assert.strictEqual(bin.readUInt32BE(start + 20), 512, `${bodyId}: image ${index} height drifted`);
  }
}

function assertNoHandOrFingerWeights(gltf, bin, bodyId, joints) {
  const forbidden = /^(?:hand|index|middle|pinky|ring|thumb)_/u;
  const influenced = new Set();
  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      for (let setIndex = 0; ; setIndex += 1) {
        const jointAccessor = primitive.attributes?.[`JOINTS_${setIndex}`];
        const weightAccessor = primitive.attributes?.[`WEIGHTS_${setIndex}`];
        if (jointAccessor === undefined && weightAccessor === undefined) break;
        assert(jointAccessor !== undefined && weightAccessor !== undefined, `${bodyId}: incomplete joint/weight attribute set`);
        const jointValues = readAccessor(gltf, bin, jointAccessor);
        const weightValues = readAccessor(gltf, bin, weightAccessor);
        assert.strictEqual(jointValues.length, weightValues.length, `${bodyId}: joint/weight accessor length mismatch`);
        for (let vertexIndex = 0; vertexIndex < jointValues.length; vertexIndex += 1) {
          for (let componentIndex = 0; componentIndex < jointValues[vertexIndex].length; componentIndex += 1) {
            if (weightValues[vertexIndex][componentIndex] > 0.00001) {
              influenced.add(joints[jointValues[vertexIndex][componentIndex]]);
            }
          }
        }
      }
    }
  }
  const forbiddenInfluences = [...influenced].filter(name => forbidden.test(name));
  assert.deepStrictEqual(forbiddenInfluences, [], `${bodyId}: hand/finger influences found`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

const summaryFile = path.join(DIRECTORY, 'fit-report-all.json');
assert(fs.existsSync(summaryFile), 'leather jacket v2 fit report is missing');
const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
assert.strictEqual(summary.assetId, ASSET_ID);
assert.strictEqual(summary.reviewOnly, true);
assert.strictEqual(summary.runtimeIntegrationAllowed, false);
assert.deepStrictEqual(summary.bodyIds, BODY_IDS);
assert.strictEqual(summary.variantCount, BODY_IDS.length);
assert.strictEqual(summary.variants?.length, BODY_IDS.length);

for (const bodyId of BODY_IDS) {
  const prefix = `${ASSET_ID}_${bodyId}`;
  const glb = path.join(DIRECTORY, `${prefix}.glb`);
  const reportFile = path.join(DIRECTORY, `${prefix}.report.json`);
  const front = path.join(DIRECTORY, `${prefix}_front.png`);
  for (const file of [glb, reportFile, front]) {
    assert(fs.existsSync(file), `${bodyId}: review artifact missing: ${path.basename(file)}`);
  }
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const { gltf, bin } = parseGlb(glb);
  const referenceFile = path.join(CHARACTER_DIRECTORY, `character_${bodyId}.glb`);
  const reference = parseGlb(referenceFile).gltf;
  const joints = skinJointNames(gltf);
  const referenceJoints = skinJointNames(reference);
  assert.strictEqual(report.assetId, ASSET_ID, `${bodyId}: asset id drifted`);
  assert.strictEqual(report.bodyId, bodyId, `${bodyId}: report body id drifted`);
  assert.strictEqual(report.sha256, sha256(glb), `${bodyId}: GLB hash drifted`);
  assert.strictEqual(report.bytes, fs.statSync(glb).size, `${bodyId}: GLB size drifted`);
  assert.strictEqual(report.actualGlb?.skins, 1, `${bodyId}: expected one skin`);
  assert.strictEqual(report.actualGlb?.meshDefinitions, 2, `${bodyId}: expected shell and details meshes`);
  assert.strictEqual(report.actualGlb?.materials, 4, `${bodyId}: material count drifted`);
  assert.strictEqual(report.actualGlb?.textures, 12, `${bodyId}: embedded texture count drifted`);
  assert.strictEqual(joints.length, 65, `${bodyId}: expected exactly 65 skin joints`);
  assert.deepStrictEqual(joints, referenceJoints, `${bodyId}: skin joint names/order drifted from current character`);
  assert(gltf.nodes.some(node => node.name === 'character_root'), `${bodyId}: character_root missing`);
  assertEmbeddedPng512(gltf, bin, bodyId);
  assertNoHandOrFingerWeights(gltf, bin, bodyId, joints);
  assert(report.actualGlb?.triangles >= 4500 && report.actualGlb?.triangles <= 12000,
    `${bodyId}: triangle count outside review budget`);
  assert(report.bytes <= 1_500_000, `${bodyId}: GLB exceeds 1.5 MB`);
  assert(report.highPolySource?.polygons >= 60_000, `${bodyId}: high-poly source budget missing`);
  assert.strictEqual(report.reviewOnly, true, `${bodyId}: review gate missing`);
  assert.strictEqual(report.runtimeIntegrationAllowed, false, `${bodyId}: runtime gate opened`);
}

const malePrefix = `${ASSET_ID}_male_medium`;
for (const suffix of [
  'review.blend',
  'back.png',
  'side.png',
  'three_quarter.png',
  'isometric.png',
  'night.png',
  'wireframe.png',
  'native112.png',
  'deformation.png',
  'detail.png',
  'idle_f19.png',
  'walk_f10.png',
  'run_f6.png'
]) {
  assert(fs.existsSync(path.join(DIRECTORY, `${malePrefix}_${suffix}`)), `male_medium review artifact missing: ${suffix}`);
}

const maleReport = JSON.parse(fs.readFileSync(path.join(DIRECTORY, `${malePrefix}.report.json`), 'utf8'));
for (const action of ['idle', 'walk', 'run']) {
  assert.strictEqual(maleReport.animationReview?.[action]?.rendered, true, `male_medium ${action} action review missing`);
}
assert.strictEqual(maleReport.animationReview?.raisedArmsAndElbowBend?.rendered, true,
  'male_medium raised-arm and elbow-bend review missing');

console.log('Leather jacket v2 review OK: 6 fitted GLB variants, 65-bone skin, 12 embedded PBR textures, idle/walk/run and stress-pose evidence checked');
