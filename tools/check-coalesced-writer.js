#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCoalescedWriter } = require('../src/server/coalesced-writer');

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    clearTimer(id) {
      callbacks.delete(id);
    },
    run(id) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      if (callback) callback();
    },
    setTimer(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    }
  };
}

function assertWriterLifecycle() {
  const timers = fakeTimers();
  let writes = 0;
  const writer = createCoalescedWriter(() => {
    writes += 1;
  }, {
    delayMs: 1000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  assert.strictEqual(writer.schedule(), true);
  assert.strictEqual(writer.schedule(), false);
  assert.strictEqual(writer.schedule(), false);
  assert.strictEqual(timers.callbacks.size, 1);
  assert.strictEqual(writes, 0);

  const firstTimer = [...timers.callbacks.keys()][0];
  timers.run(firstTimer);
  assert.strictEqual(writes, 1);
  assert.strictEqual(writer.pending(), false);

  assert.strictEqual(writer.schedule(), true);
  assert.strictEqual(writer.flush(), undefined);
  assert.strictEqual(writes, 2);
  assert.strictEqual(timers.callbacks.size, 0);
  assert.strictEqual(writer.pending(), false);
}

function assertDeferredErrorRecovery() {
  const timers = fakeTimers();
  const errors = [];
  let shouldFail = true;
  let writes = 0;
  const writer = createCoalescedWriter(() => {
    writes += 1;
    if (shouldFail) throw new Error('disk unavailable');
  }, {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onDeferredError: error => errors.push(error.message)
  });

  writer.schedule();
  timers.run([...timers.callbacks.keys()][0]);
  assert.deepStrictEqual(errors, ['disk unavailable']);
  assert.strictEqual(writer.pending(), false);

  shouldFail = false;
  assert.strictEqual(writer.schedule(), true);
  timers.run([...timers.callbacks.keys()][0]);
  assert.strictEqual(writes, 2);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return '';
}

function assertServerIntegration() {
  const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  assert(functionBody(server, 'persistUsers').includes('usersPersistWriter.flush()'));
  assert(functionBody(server, 'schedulePersistUsers').includes('usersPersistWriter.schedule()'));
  const meRoute = server.slice(
    server.indexOf("app.get('/api/auth/me'"),
    server.indexOf("app.post('/api/auth/heartbeat'")
  );
  const heartbeatRoute = server.slice(
    server.indexOf("app.post('/api/auth/heartbeat'"),
    server.indexOf("app.post('/api/auth/logout'")
  );
  assert(meRoute.includes('schedulePersistUsers()') && !meRoute.includes('persistUsers()'));
  assert(heartbeatRoute.includes('schedulePersistUsers()') && !heartbeatRoute.includes('persistUsers()'));
  assert(functionBody(server, 'createSession').includes('persistUsers()'),
    'session creation must retain immediate user persistence');
  const criticalRoutes = [
    "app.post('/api/auth/password-reset/request'",
    "app.post('/api/auth/password-reset/confirm'",
    "app.post('/api/auth/logout'"
  ];
  for (const marker of criticalRoutes) {
    const start = server.indexOf(marker);
    const end = server.indexOf('\n});', start);
    assert(start >= 0 && server.slice(start, end).includes('persistUsers()'),
      `${marker} must retain immediate user persistence`);
  }
}

assertWriterLifecycle();
assertDeferredErrorRecovery();
assertServerIntegration();
console.log('Coalesced writer checks passed: heartbeat batching, critical flush and deferred error recovery.');
