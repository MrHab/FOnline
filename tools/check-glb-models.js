const fs = require('fs');
const path = require('path');

global.ProgressEvent = global.ProgressEvent || class ProgressEvent {};

const root = path.resolve(__dirname, '..');
const modelsDir = path.join(root, 'public', 'assets', 'models', 'wasteland');
const colliderCatalogFile = path.join(modelsDir, 'model-colliders.json');
const colliderCatalog = JSON.parse(fs.readFileSync(colliderCatalogFile, 'utf8'));
const {
  MAX_COLLIDER_PARTS,
  NON_BLOCKING_MODEL_FILES,
  computeWalkCollision
} = require('./model-collider-geometry');
if (colliderCatalog?.schema !== 'realm.model-colliders.v1' || !colliderCatalog.models) {
  throw new Error('3D model collider catalog has an invalid schema');
}

const modularBlocks = new Map([
  ['trader_wall_block.glb', { x: 2, z: 2, maxY: 1.01 }],
  ['trader_window_block.glb', { x: 2, z: 2, maxY: 1.01 }],
  ['trader_floor_slab.glb', { x: 2, z: 2 }],
  ['trader_roof_block.glb', { x: 2, z: 2 }],
  ['mod_wall_wood.glb', { x: 2, z: 2, maxY: 1.01 }],
  ['mod_wall_brick.glb', { x: 2, z: 2, maxY: 1.01 }],
  ['mod_wall_metal.glb', { x: 2, z: 2, maxY: 1.01 }],
  ['mod_roof_wood.glb', { x: 2, z: 2 }],
  ['mod_roof_metal.glb', { x: 2, z: 2 }],
  ['mod_floor_wood.glb', { x: 2, z: 2 }],
  ['mod_floor_tile.glb', { x: 2, z: 2 }]
]);

function isNpcLike(file) {
  return /^(?:npc_|trader_npc|brahmin)/.test(file);
}

function round(n) {
  return Number(n.toFixed(3));
}

function colliderValueMatches(actual, expected) {
  return Number.isFinite(Number(expected)) && Math.abs(Number(actual) - Number(expected)) <= 0.0000015;
}

async function main() {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const files = fs.readdirSync(modelsDir).filter(file => file.endsWith('.glb')).sort();
  const issues = [];
  let solidCollisionCount = 0;
  let nonBlockingCollisionCount = 0;
  let compoundCollisionCount = 0;

  async function loadGlb(file) {
    const data = fs.readFileSync(path.join(modelsDir, file));
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new Promise((resolve, reject) => {
      loader.parse(ab, '', resolve, reject);
    });
  }

  for (const file of files) {
    let gltf;
    try {
      gltf = await loadGlb(file);
    } catch (err) {
      issues.push(`${file}: cannot load GLB (${err.message})`);
      continue;
    }

    let meshCount = 0;
    let hasModularRule = false;
    gltf.scene.traverse(object => {
      if (object.isMesh) meshCount += 1;
      if (object.userData && object.userData.realmModelRule) hasModularRule = true;
    });

    if (!meshCount) {
      issues.push(`${file}: no meshes`);
      continue;
    }

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const collider = colliderCatalog.models[file];
    if (!collider) {
      issues.push(`${file}: missing collider catalog entry`);
    } else {
      const values = [
        ['min.x', box.min.x, collider.min?.x], ['min.y', box.min.y, collider.min?.y], ['min.z', box.min.z, collider.min?.z],
        ['max.x', box.max.x, collider.max?.x], ['max.y', box.max.y, collider.max?.y], ['max.z', box.max.z, collider.max?.z],
        ['size.x', size.x, collider.size?.x], ['size.y', size.y, collider.size?.y], ['size.z', size.z, collider.size?.z],
        ['center.x', center.x, collider.center?.x], ['center.y', center.y, collider.center?.y], ['center.z', center.z, collider.center?.z]
      ];
      values.forEach(([label, actual, expected]) => {
        if (!colliderValueMatches(actual, expected)) {
          issues.push(`${file}: stale collider ${label}, expected ${round(actual)}, got ${expected}`);
        }
      });

      const expectedCollision = computeWalkCollision(THREE, gltf.scene, file);
      const collision = collider.collision;
      if (!collision || collision.mode !== expectedCollision.mode) {
        issues.push(`${file}: stale collision mode, expected ${expectedCollision.mode}, got ${collision?.mode}`);
      } else if (collision.mode === 'solid') {
        solidCollisionCount += 1;
        const actualParts = Array.isArray(collision.parts) ? collision.parts : [];
        if (!actualParts.length || actualParts.length > MAX_COLLIDER_PARTS) {
          issues.push(`${file}: invalid collision part count ${actualParts.length}`);
        }
        if (actualParts.length > 1) compoundCollisionCount += 1;
        if (actualParts.length !== expectedCollision.parts.length) {
          issues.push(`${file}: stale collision parts, expected ${expectedCollision.parts.length}, got ${actualParts.length}`);
        }
        const collisionValues = [
          ['collision.min.x', expectedCollision.min.x, collision.min?.x],
          ['collision.min.z', expectedCollision.min.z, collision.min?.z],
          ['collision.max.x', expectedCollision.max.x, collision.max?.x],
          ['collision.max.z', expectedCollision.max.z, collision.max?.z],
          ['collision.size.x', expectedCollision.size.x, collision.size?.x],
          ['collision.size.z', expectedCollision.size.z, collision.size?.z],
          ['collision.center.x', expectedCollision.center.x, collision.center?.x],
          ['collision.center.z', expectedCollision.center.z, collision.center?.z]
        ];
        expectedCollision.parts.forEach((part, index) => {
          const actual = actualParts[index] || {};
          collisionValues.push(
            [`collision.parts[${index}].min.x`, part.min.x, actual.min?.x],
            [`collision.parts[${index}].min.z`, part.min.z, actual.min?.z],
            [`collision.parts[${index}].max.x`, part.max.x, actual.max?.x],
            [`collision.parts[${index}].max.z`, part.max.z, actual.max?.z]
          );
        });
        collisionValues.forEach(([label, expected, actual]) => {
          if (!colliderValueMatches(expected, actual)) issues.push(`${file}: stale ${label}, expected ${round(expected)}, got ${actual}`);
        });
      } else {
        nonBlockingCollisionCount += 1;
        if (Array.isArray(collision.parts) && collision.parts.length) issues.push(`${file}: non-blocking model has collision parts`);
      }

      if (NON_BLOCKING_MODEL_FILES.has(file) && collision?.mode !== 'none') {
        issues.push(`${file}: floor/roof surface can repel the player`);
      }
    }

    if (!Number.isFinite(box.min.y) || box.min.y < -0.05) {
      issues.push(`${file}: below ground, minY=${round(box.min.y)}`);
    }

    const modular = modularBlocks.get(file);
    if (modular) {
      if (!hasModularRule) {
        issues.push(`${file}: modular block has no realmModelRule metadata`);
      }
      if (size.x > modular.x + 0.06 || size.z > modular.z + 0.06) {
        issues.push(`${file}: footprint ${round(size.x)}x${round(size.z)} exceeds ${modular.x}x${modular.z}`);
      }
      if (Number.isFinite(Number(modular.maxY)) && box.max.y > Number(modular.maxY)) {
        issues.push(`${file}: top ${round(box.max.y)} exceeds logical height ${modular.maxY}`);
      }
    }

    if (isNpcLike(file)) {
      const tooShort = size.y < 0.45;
      const tooTall = size.y > 2.7;
      const tooWide = Math.max(size.x, size.z) > 4.2;
      if (tooShort || tooTall || tooWide) {
        issues.push(`${file}: suspicious character scale ${round(size.x)}x${round(size.y)}x${round(size.z)}`);
      }
    }
  }

  Object.keys(colliderCatalog.models).forEach(file => {
    if (!files.includes(file)) issues.push(`${file}: collider entry has no GLB file`);
  });

  if (issues.length) {
    throw new Error(`3D model check failed:\n${issues.map(issue => `- ${issue}`).join('\n')}`);
  }

  console.log(`3D models OK: ${files.length} GLB file(s), ${solidCollisionCount} physical, ${nonBlockingCollisionCount} walkable, ${compoundCollisionCount} compound collider(s) checked`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
