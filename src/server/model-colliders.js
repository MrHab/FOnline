'use strict';

const fs = require('fs');
const path = require('path');

function modelFileName(value = '') {
  const normalized = String(value || '').replace(/\\/g, '/').split('?')[0].split('#')[0];
  return normalized.split('/').pop().toLowerCase();
}

function loadModelColliderCatalog(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed?.schema !== 'realm.model-colliders.v1' || !parsed.models || typeof parsed.models !== 'object') {
    throw new Error(`Invalid model collider catalog: ${path.basename(file)}`);
  }
  return Object.freeze(parsed.models);
}

function modelColliderBounds(catalog, modelRef = '') {
  if (!catalog || typeof catalog !== 'object') return null;
  const file = modelFileName(modelRef);
  const entry = catalog[file];
  const bounds = entry?.collision?.mode === 'solid' ? entry.collision : (entry?.collision ? null : entry);
  if (!bounds || !bounds.size || !bounds.center) return null;
  const sizeX = Number(bounds.size.x);
  const sizeZ = Number(bounds.size.z);
  const centerX = Number(bounds.center.x);
  const centerZ = Number(bounds.center.z);
  if (![sizeX, sizeZ, centerX, centerZ].every(Number.isFinite) || sizeX <= 0 || sizeZ <= 0) return null;
  return bounds;
}

function modelColliderCatalogEntry(catalog, modelRef = '') {
  if (!catalog || typeof catalog !== 'object') return null;
  return catalog[modelFileName(modelRef)] || null;
}

function modelColliderParts(catalog, modelRef = '') {
  const bounds = modelColliderBounds(catalog, modelRef);
  if (!bounds) return [];
  const parts = Array.isArray(bounds.parts) ? bounds.parts : [];
  return parts.length ? parts.filter(part => part?.size && part?.center) : [bounds];
}

function transformedBounds(bounds, transform = {}) {
  if (!bounds?.size || !bounds?.center) return null;
  const x = Number(transform.x || 0);
  const z = Number(transform.z || 0);
  // Authored yaw is applied by THREE.Object3D.rotation.y on the client. Its
  // X/Z convention is the inverse of the server's 2D OBB math, so convert the
  // visual angle before transforming an offset collider or exposing its yaw.
  const rotationY = -Number(transform.rotationY || 0);
  const scaleX = Number.isFinite(Number(transform.scaleX)) ? Number(transform.scaleX) : 1;
  const scaleZ = Number.isFinite(Number(transform.scaleZ)) ? Number(transform.scaleZ) : 1;
  if (![x, z, rotationY, scaleX, scaleZ].every(Number.isFinite)) return null;

  const localCenterX = Number(bounds.center.x) * scaleX;
  const localCenterZ = Number(bounds.center.z) * scaleZ;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return {
    x: x + localCenterX * cos - localCenterZ * sin,
    z: z + localCenterX * sin + localCenterZ * cos,
    halfX: Number(bounds.size.x) * Math.abs(scaleX) * 0.5,
    halfZ: Number(bounds.size.z) * Math.abs(scaleZ) * 0.5,
    rotationY
  };
}

function transformedModelBlocker(catalog, modelRef, transform = {}) {
  const bounds = modelColliderBounds(catalog, modelRef);
  return transformedBounds(bounds, transform);
}

function transformedModelBlockers(catalog, modelRef, transform = {}) {
  return modelColliderParts(catalog, modelRef)
    .map(bounds => transformedBounds(bounds, transform))
    .filter(Boolean);
}

function modelColliderRadius(catalog, modelRef, scale = 1) {
  const bounds = modelColliderBounds(catalog, modelRef);
  if (!bounds) return 0;
  const scaleX = Number.isFinite(Number(scale?.x)) ? Number(scale.x) : Number(scale || 1);
  const scaleZ = Number.isFinite(Number(scale?.z)) ? Number(scale.z) : Number(scale || 1);
  return Math.max(
    Math.abs(Number(bounds.min.x) * scaleX),
    Math.abs(Number(bounds.max.x) * scaleX),
    Math.abs(Number(bounds.min.z) * scaleZ),
    Math.abs(Number(bounds.max.z) * scaleZ)
  );
}

module.exports = {
  loadModelColliderCatalog,
  modelColliderBounds,
  modelColliderCatalogEntry,
  modelColliderParts,
  modelColliderRadius,
  modelFileName,
  transformedModelBlocker,
  transformedModelBlockers
};
