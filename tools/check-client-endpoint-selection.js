#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bootstrapFile = path.join(root, 'public', 'js', 'game', '01_bootstrap_online_save.js');
const source = fs.readFileSync(bootstrapFile, 'utf8').replace(/\r\n/g, '\n');
const blockStart = source.indexOf("  const PRODUCTION_SERVER_API_BASE = 'https://rangir.ru';");
const blockEnd = source.indexOf('  const serverSession = {', blockStart);
assert(blockStart >= 0 && blockEnd > blockStart, 'client server endpoint selection block is missing');
const candidatesStart = source.indexOf('  function serverApiBaseCandidates() {', blockEnd);
const candidatesEnd = source.indexOf('  async function serverApi(', candidatesStart);
assert(candidatesStart >= 0 && candidatesEnd > candidatesStart, 'client server endpoint candidate function is missing');
const endpointSource = source.slice(blockStart, blockEnd) + source.slice(candidatesStart, candidatesEnd);

function endpointSelection(url) {
  const parsed = new URL(url);
  const context = {
    location: {
      hostname: parsed.hostname,
      origin: parsed.origin,
      port: parsed.port,
      protocol: parsed.protocol
    }
  };
  vm.runInNewContext(`${endpointSource}
    this.selection = {
      defaultBase: SERVER_API_BASE,
      candidates: serverApiBaseCandidates()
    };
  `, context);
  return JSON.parse(JSON.stringify(context.selection));
}

assert.deepStrictEqual(endpointSelection('http://127.0.0.1:3000/'), {
  defaultBase: '',
  candidates: ['']
});
assert.deepStrictEqual(endpointSelection('http://127.0.0.1:37641/'), {
  defaultBase: '',
  candidates: ['', 'http://127.0.0.1:3000']
});
assert.deepStrictEqual(endpointSelection('http://localhost:8080/'), {
  defaultBase: '',
  candidates: ['', 'http://localhost:3000']
});
assert.deepStrictEqual(endpointSelection('http://192.168.1.25:4567/'), {
  defaultBase: '',
  candidates: ['', 'http://192.168.1.25:3000']
});
assert.deepStrictEqual(endpointSelection('https://rangir.ru/'), {
  defaultBase: '',
  candidates: ['']
});
assert.deepStrictEqual(endpointSelection('https://mrhab.github.io/FOnline/'), {
  defaultBase: 'https://rangir.ru',
  candidates: ['https://rangir.ru']
});
assert.deepStrictEqual(endpointSelection('file:///C:/Realm/index.html'), {
  defaultBase: 'http://localhost:3000',
  candidates: ['http://localhost:3000']
});

console.log('Client endpoint selection passed: same-origin custom ports, local static fallback, production and GitHub Pages.');
