#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

global.ProgressEvent = global.ProgressEvent || class ProgressEvent {};
global.self = global.self || global;
global.createImageBitmap = global.createImageBitmap || (async () => ({
  width: 1,
  height: 1,
  close() {}
}));

const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const OUTPUT_FILE = path.join(MODELS_DIR, 'model-colliders.json');
const { computeWalkCollision } = require('./model-collider-geometry');

function round(value) {
  const rounded = Number(Number(value).toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

async function loadGlb(loader, file) {
  const data = fs.readFileSync(path.join(MODELS_DIR, file));
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));
}

async function buildCatalog() {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const files = fs.readdirSync(MODELS_DIR).filter(file => file.endsWith('.glb')).sort();
  const models = {};

  for (const file of files) {
    const gltf = await loadGlb(loader, file);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) throw new Error(`${file}: empty model bounds`);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    models[file] = {
      min: { x: round(box.min.x), y: round(box.min.y), z: round(box.min.z) },
      max: { x: round(box.max.x), y: round(box.max.y), z: round(box.max.z) },
      size: { x: round(size.x), y: round(size.y), z: round(size.z) },
      center: { x: round(center.x), y: round(center.y), z: round(center.z) },
      collision: roundCollision(computeWalkCollision(THREE, gltf.scene, file))
    };
  }

  return {
    schema: 'realm.model-colliders.v1',
    version: 2,
    generatedFrom: 'public/assets/models/wasteland/*.glb',
    models
  };
}

function roundVector(vector = {}) {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}

function roundCollision(collision = {}) {
  const result = {
    mode: collision.mode === 'solid' ? 'solid' : 'none',
    reason: collision.reason,
    method: collision.method,
    slab: collision.slab ? { minY: round(collision.slab.minY), maxY: round(collision.slab.maxY) } : undefined,
    candidateMeshes: Number(collision.candidateMeshes || 0),
    sourcePartCount: Number(collision.sourcePartCount || 0),
    parts: Array.isArray(collision.parts) ? collision.parts.map(part => ({
      min: roundVector(part.min),
      max: roundVector(part.max),
      size: roundVector(part.size),
      center: roundVector(part.center),
      sourceMeshes: Number(part.sourceMeshes || 0),
      sourceTriangles: Number(part.sourceTriangles || 0)
    })) : []
  };
  if (collision.mode === 'solid') {
    result.min = roundVector(collision.min);
    result.max = roundVector(collision.max);
    result.size = roundVector(collision.size);
    result.center = roundVector(collision.center);
  }
  Object.keys(result).forEach(key => result[key] === undefined && delete result[key]);
  return result;
}

async function main() {
  const catalog = await buildCatalog();
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Model collider catalog written: ${Object.keys(catalog.models).length} model(s)`);
}

main().catch(error => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
