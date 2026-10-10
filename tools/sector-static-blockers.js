'use strict';

// Authored projection of the strictly validated utility geometry. A cache miss
// always calls the original validator; this module never relaxes its checks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const lattice = require('../src/server/sector-ground-lattice');
const ROOT = path.resolve(__dirname, '..');
const CACHE_FILE = path.join(ROOT, 'data/kromka/sector-static-blockers.json');
const SCHEMA = 'roa.sectorStaticBlockers.v1';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const hashJson = value => sha(JSON.stringify(value));
const exactKeys = (value, keys) => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};
const digest = value => assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));

function inputs(catalog, root = ROOT) {
  const bytes = fs.readFileSync(path.join(root, 'data/kromka/sector-surfaces.json'));
  // The server's already loaded catalogue must match the bytes fingerprinted
  // here; replacing a file beneath a running process cannot mix epochs.
  assert.equal(hashJson(catalog), hashJson(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))));
  return {
    schema: SCHEMA,
    catalogSHA256: sha(bytes),
    groundLatticeCodeHash: lattice.codeHash(root),
    sectorTerrainSHA256: sha(fs.readFileSync(path.join(root, 'src/server/sector-terrain.js'))),
    loaderSHA256: sha(fs.readFileSync(__filename))
  };
}

function profiles(catalog) {
  assert(Array.isArray(catalog?.profiles) && catalog.profiles.length === 197);
  const rows = [...catalog.profiles].sort((a, b) => a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0);
  for (const p of rows) assert(typeof p.locationId === 'string' && p.locationId && typeof p.zoneId === 'string' && p.zoneId);
  assert.equal(new Set(rows.map(p => p.locationId)).size, 197);
  assert.equal(new Set(rows.map(p => p.zoneId)).size, 197);
  return rows;
}

function validateBlocker(b) {
  const required = ['id', 'objectId', 'modelRef', 'x', 'z', 'halfX', 'halfZ'];
  const optional = ['rotationY', 'round', 'polygon'];
  assert(b && typeof b === 'object' && !Array.isArray(b));
  assert(Object.keys(b).every(k => required.includes(k) || optional.includes(k)));
  assert(required.every(k => Object.hasOwn(b, k)));
  for (const k of ['id', 'objectId', 'modelRef']) assert(typeof b[k] === 'string' && b[k]);
  for (const k of ['x', 'z', 'halfX', 'halfZ']) assert(Number.isFinite(b[k]));
  assert(b.halfX >= 0 && b.halfZ >= 0);
  if (Object.hasOwn(b, 'rotationY')) assert(Number.isFinite(b.rotationY));
  if (Object.hasOwn(b, 'round')) assert.equal(typeof b.round, 'boolean');
  if (Object.hasOwn(b, 'polygon')) {
    assert(Array.isArray(b.polygon) && b.polygon.length >= 3);
    for (const p of b.polygon) { exactKeys(p, ['x', 'z']); assert(Number.isFinite(p.x) && Number.isFinite(p.z)); }
  }
}

function validate(document, expectedInputs, catalog) {
  exactKeys(document, ['schema', 'inputs', 'inputFingerprint', 'profiles', 'payloadSHA256']);
  assert.equal(document.schema, SCHEMA);
  exactKeys(document.inputs, ['schema', 'catalogSHA256', 'groundLatticeCodeHash', 'sectorTerrainSHA256', 'loaderSHA256']);
  assert.equal(document.inputs.schema, SCHEMA);
  for (const k of ['catalogSHA256', 'groundLatticeCodeHash', 'sectorTerrainSHA256', 'loaderSHA256']) digest(document.inputs[k]);
  assert.deepEqual(document.inputs, expectedInputs);
  digest(document.inputFingerprint); assert.equal(document.inputFingerprint, hashJson(expectedInputs));
  digest(document.payloadSHA256); assert.equal(document.payloadSHA256, hashJson(document.profiles));
  const expected = profiles(catalog);
  assert(Array.isArray(document.profiles) && document.profiles.length === expected.length);
  const result = new Map();
  document.profiles.forEach((row, i) => {
    exactKeys(row, ['locationId', 'zoneId', 'profileSHA256', 'blockers']);
    assert.equal(row.locationId, expected[i].locationId); assert.equal(row.zoneId, expected[i].zoneId);
    digest(row.profileSHA256); assert.equal(row.profileSHA256, hashJson(expected[i]));
    assert(Array.isArray(row.blockers)); row.blockers.forEach(validateBlocker);
    result.set(row.locationId, row.blockers);
  });
  return result;
}

function build(catalog, strictStaticBlockers, expectedInputs = inputs(catalog)) {
  assert.equal(typeof strictStaticBlockers, 'function');
  const rows = profiles(catalog).map(p => {
    // Deliberately call the unmodified production validator for EVERY profile.
    const blockers = strictStaticBlockers(p.locationId);
    assert(Array.isArray(blockers)); blockers.forEach(validateBlocker);
    return { locationId: p.locationId, zoneId: p.zoneId, profileSHA256: hashJson(p), blockers };
  });
  const document = { schema: SCHEMA, inputs: expectedInputs, inputFingerprint: hashJson(expectedInputs), profiles: rows, payloadSHA256: hashJson(rows) };
  validate(document, expectedInputs, catalog);
  return document;
}

function lookup(document, expectedInputs, catalog, original) {
  assert.equal(typeof original, 'function');
  let cache = null, reason = null;
  try { cache = validate(document, expectedInputs, catalog); }
  catch (error) { reason = error.message; }
  return {
    valid: cache !== null,
    reason,
    get(id) {
      // Keep fallback outside the catch: an original validation failure must
      // propagate, including when the cache itself is stale or corrupt.
      return cache?.has(id) ? cache.get(id) : original(id);
    }
  };
}

function load(catalog, original, file = CACHE_FILE) {
  let document, expectedInputs;
  try {
    expectedInputs = inputs(catalog);
    document = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { valid: false, reason: error.message, get: id => original(id) };
  }
  return lookup(document, expectedInputs, catalog, original);
}

module.exports = { ROOT, CACHE_FILE, SCHEMA, inputs, profiles, validate, build, lookup, load, hashJson };
