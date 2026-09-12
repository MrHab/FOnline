'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKromkaStateStore } = require('../src/server/kromka-state-store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-state-store-'));
const usersFile = path.join(root, 'users.json');
const savesFile = path.join(root, 'saves.json');
const journalFile = path.join(root, '.transaction.json');

function writeAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
  fs.renameSync(tmp, file);
}

try {
  const store = createKromkaStateStore({ fs, writeJsonAtomic: writeAtomic, journalFile, usersFile, savesFile });
  store.commit({ users: { version: 1, users: { test: { id: 'u1' } } }, saves: { version: 2, characters: { u1: {} } } }, 'test-both');
  assert.equal(JSON.parse(fs.readFileSync(usersFile, 'utf8')).users.test.id, 'u1');
  assert.equal(JSON.parse(fs.readFileSync(savesFile, 'utf8')).version, 2);
  assert(!fs.existsSync(journalFile), 'successful commit left a recovery journal');

  let failed = false;
  const interrupted = createKromkaStateStore({
    fs,
    journalFile,
    usersFile,
    savesFile,
    writeJsonAtomic(file, value) {
      if (file === savesFile) throw new Error('simulated interruption');
      writeAtomic(file, value);
    }
  });
  try { interrupted.commit({ saves: { version: 2, marker: 'recovered' } }, 'fault-injection'); } catch (_) { failed = true; }
  assert(failed && fs.existsSync(journalFile), 'interrupted commit must preserve its complete journal');

  const restarted = createKromkaStateStore({ fs, writeJsonAtomic: writeAtomic, journalFile, usersFile, savesFile });
  assert(restarted.recover(), 'startup did not replay the interrupted transaction');
  assert.equal(JSON.parse(fs.readFileSync(savesFile, 'utf8')).marker, 'recovered');
  assert(!fs.existsSync(journalFile), 'recovery journal was not cleared after replay');
  assert.equal(restarted.metrics().recoveries, 1);
  console.log('Kromka state store check passed: atomic snapshots and interrupted-write recovery.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
