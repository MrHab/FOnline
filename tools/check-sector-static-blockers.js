#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const api = require('./sector-static-blockers');
const catalog = require('../data/kromka/sector-surfaces.json');
const terrain = require('../src/server/sector-terrain');
const clone = value => JSON.parse(JSON.stringify(value));
const start = performance.now(), expectedInputs = api.inputs(catalog);
const document = JSON.parse(fs.readFileSync(api.CACHE_FILE, 'utf8'));
const cached = api.validate(document, expectedInputs, catalog);
for (const p of api.profiles(catalog)) assert.deepEqual(cached.get(p.locationId), terrain.staticBlockers(p.locationId), `Original strict blockers differ: ${p.locationId}`);
assert.deepEqual(api.inputs(catalog), expectedInputs);

let calls = 0;
const fallback = id => { calls++; return [{ original: id }]; };
const valid = api.lookup(document, expectedInputs, catalog, fallback);
assert(valid.valid); assert.deepEqual(valid.get('z_08_14'), cached.get('z_08_14')); assert.equal(calls, 0);
assert.deepEqual(valid.get('not-a-profile'), [{ original: 'not-a-profile' }]); assert.equal(calls, 1);
function rejected(value, expected = expectedInputs, source = catalog) {
  const result = api.lookup(value, expected, source, fallback);
  assert.equal(result.valid, false); const before = calls;
  assert.deepEqual(result.get('z_08_14'), [{ original: 'z_08_14' }]); assert.equal(calls, before + 1);
  const failure = new Error('Original validator must fail closed');
  assert.throws(() => api.lookup(value, expected, source, () => { throw failure; }).get('z_08_14'), error => error === failure);
}
for (const key of ['catalogSHA256', 'groundLatticeCodeHash', 'sectorTerrainSHA256', 'loaderSHA256']) rejected(document, { ...expectedInputs, [key]: '0'.repeat(64) });
let bad = clone(document); bad.schema = 'unknown'; rejected(bad);
bad = clone(document); bad.extra = true; rejected(bad);
bad = clone(document); bad.payloadSHA256 = '0'.repeat(64); rejected(bad);
bad = clone(document); bad.profiles[0].locationId = bad.profiles[1].locationId; bad.payloadSHA256 = api.hashJson(bad.profiles); rejected(bad);
bad = clone(document); bad.profiles.pop(); bad.payloadSHA256 = api.hashJson(bad.profiles); rejected(bad);
bad = clone(document); const changed = bad.profiles.find(p => p.blockers.length); changed.blockers[0].x += 1; rejected(bad);
bad = clone(document); bad.profiles.find(p => p.blockers.length).blockers[0].ignored = true; bad.payloadSHA256 = api.hashJson(bad.profiles); rejected(bad);
const changedCatalog = { ...catalog, profiles: catalog.profiles.map(p => p.locationId === 'z_08_14' ? { ...p, retainingFinish: !p.retainingFinish } : p) }; rejected(document, expectedInputs, changedCatalog);
assert.throws(() => api.build(catalog, () => { throw new Error('Invalid source geometry'); }, expectedInputs), /Invalid source geometry/);
console.log(`PASS sector static blocker cache: all197 deep-equal original, stale/corrupt/schema/missing/duplicate/mutated inputs fallback and original errors preserved; ${(performance.now() - start).toFixed(1)} ms.`);
