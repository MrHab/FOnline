#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const api = require('./sector-static-blockers');
const catalog = require('../data/kromka/sector-surfaces.json');
const terrain = require('../src/server/sector-terrain');
const start = performance.now();
const before = api.inputs(catalog);
const document = api.build(catalog, terrain.staticBlockers, before);
assert.deepEqual(api.inputs(catalog), before, 'Cache inputs changed during strict generation');
const bytes = JSON.stringify(document, null, 2) + '\n';
if (process.argv.includes('--check')) assert.equal(fs.readFileSync(api.CACHE_FILE, 'utf8'), bytes, 'Rebuild sector static blocker catalogue');
else fs.writeFileSync(api.CACHE_FILE, bytes);
console.log(`Sector static blockers: ${document.profiles.length} strictly validated profiles, ${document.profiles.reduce((n, p) => n + p.blockers.length, 0)} blockers, ${Buffer.byteLength(bytes)} bytes, ${(performance.now() - start).toFixed(1)} ms.`);
