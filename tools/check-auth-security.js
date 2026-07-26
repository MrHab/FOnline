#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_AUTH_RATE_IDENTITY_MAX_ATTEMPTS,
  DEFAULT_AUTH_RATE_IP_MAX_ATTEMPTS,
  DEFAULT_AUTH_RATE_MAX_BUCKETS,
  DEFAULT_AUTH_RATE_WINDOW_MS,
  createAuthRateLimiter,
  isTrustedProxyAddress,
  normalizeAuthRateLimitConfig,
  normalizeClientAddress
} = require('../src/server/auth-rate-limit');
const {
  DEFAULT_PASSWORD_HASH_CONCURRENCY,
  DEFAULT_PASSWORD_HASH_MAX_PENDING,
  DUMMY_PASSWORD_RECORD,
  PasswordHashBusyError,
  createPasswordHasher,
  normalizePasswordHashConfig
} = require('../src/server/password-hashing');

const ROOT = path.resolve(__dirname, '..');

function assertRateLimitConfiguration() {
  assert.deepStrictEqual(
    normalizeAuthRateLimitConfig({
      AUTH_RATE_WINDOW_MS: 'not-a-number',
      AUTH_RATE_MAX_ATTEMPTS: 'NaN',
      AUTH_RATE_IP_MAX_ATTEMPTS: '',
      AUTH_RATE_MAX_BUCKETS: Infinity
    }),
    {
      windowMs: DEFAULT_AUTH_RATE_WINDOW_MS,
      identityMaxAttempts: DEFAULT_AUTH_RATE_IDENTITY_MAX_ATTEMPTS,
      ipMaxAttempts: DEFAULT_AUTH_RATE_IP_MAX_ATTEMPTS,
      maxBuckets: DEFAULT_AUTH_RATE_MAX_BUCKETS
    },
    'invalid auth rate-limit environment values must use safe defaults'
  );
  assert.deepStrictEqual(
    normalizePasswordHashConfig({
      PASSWORD_HASH_CONCURRENCY: 'invalid',
      PASSWORD_HASH_MAX_PENDING: -1
    }),
    {
      concurrency: DEFAULT_PASSWORD_HASH_CONCURRENCY,
      maxPending: DEFAULT_PASSWORD_HASH_MAX_PENDING
    },
    'password hashing limits were not normalized safely'
  );
}

function assertProxyAddressPolicy() {
  assert.strictEqual(normalizeClientAddress('::ffff:127.0.0.1'), '127.0.0.1');
  assert.strictEqual(normalizeClientAddress('FE80::1%lo0'), 'fe80::1');
  assert.strictEqual(isTrustedProxyAddress('127.0.0.1'), true);
  assert.strictEqual(isTrustedProxyAddress('127.42.0.9'), true);
  assert.strictEqual(isTrustedProxyAddress('::1'), true);
  assert.strictEqual(isTrustedProxyAddress('10.0.0.1'), false);
  assert.strictEqual(isTrustedProxyAddress('203.0.113.8'), false);
}

function assertDualRateLimit() {
  let now = 1000;
  const limiter = createAuthRateLimiter({
    windowMs: 60 * 1000,
    identityMaxAttempts: 5,
    ipMaxAttempts: 7,
    maxBuckets: 100,
    clock: () => now
  });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.strictEqual(limiter.consume('203.0.113.10', 'survivor').allowed, true);
  }
  const identityLimited = limiter.consume('203.0.113.10', 'survivor');
  assert.strictEqual(identityLimited.allowed, false);
  assert.strictEqual(identityLimited.limitedBy, 'identity');

  const randomIdentityLimiter = createAuthRateLimiter({
    windowMs: 60 * 1000,
    identityMaxAttempts: 5,
    ipMaxAttempts: 7,
    maxBuckets: 100,
    clock: () => now
  });
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    assert.strictEqual(
      randomIdentityLimiter.consume('203.0.113.20', `random-${attempt}`).allowed,
      true,
      `IP-wide limiter blocked attempt ${attempt} too early`
    );
  }
  const ipLimited = randomIdentityLimiter.consume('203.0.113.20', 'random-8');
  assert.strictEqual(ipLimited.allowed, false);
  assert.strictEqual(ipLimited.limitedBy, 'ip',
    'random identities bypassed the IP-wide auth limit');

  const clearLimiter = createAuthRateLimiter({
    windowMs: 60 * 1000,
    identityMaxAttempts: 5,
    ipMaxAttempts: 7,
    maxBuckets: 100,
    clock: () => now
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.strictEqual(clearLimiter.consume('203.0.113.30', 'known').allowed, true);
  }
  assert.strictEqual(clearLimiter.clearIdentity('203.0.113.30', 'known'), true);
  assert.strictEqual(clearLimiter.consume('203.0.113.30', 'known').allowed, true,
    'successful auth must be able to clear its identity bucket');
  assert.strictEqual(clearLimiter.consume('203.0.113.30', 'other').allowed, true);
  const retainedIpLimit = clearLimiter.consume('203.0.113.30', 'third');
  assert.strictEqual(retainedIpLimit.allowed, false);
  assert.strictEqual(retainedIpLimit.limitedBy, 'ip',
    'clearing a successful identity must not erase the IP-wide budget');

  now += 60 * 1000 + 1;
  assert.strictEqual(clearLimiter.consume('203.0.113.30', 'known').allowed, true,
    'expired auth buckets did not reset');
}

function assertRateLimitCapacity() {
  const limiter = createAuthRateLimiter({
    windowMs: 60 * 1000,
    identityMaxAttempts: 5,
    ipMaxAttempts: 7,
    maxBuckets: 100,
    clock: () => 1000
  });
  for (let index = 0; index < 50; index += 1) {
    assert.strictEqual(
      limiter.consume(`198.51.100.${index}`, `identity-${index}`).allowed,
      true
    );
  }
  assert.strictEqual(limiter.snapshot().size, 100);
  const full = limiter.consume('192.0.2.1', 'overflow');
  assert.strictEqual(full.allowed, false);
  assert.strictEqual(full.limitedBy, 'capacity',
    'a full limiter must fail closed instead of growing without a bound');
  assert.strictEqual(limiter.snapshot().size, 100);
}

async function assertPasswordHashing() {
  const hasher = createPasswordHasher();
  let timerFired = false;
  const hashPromise = hasher.hashPassword('correct horse battery staple');
  await new Promise(resolve => {
    setTimeout(() => {
      timerFired = true;
      resolve();
    }, 0);
  });
  assert.strictEqual(timerFired, true,
    'password hashing blocked the JavaScript event loop');
  const record = await hashPromise;
  assert.match(record.salt, /^[a-f0-9]{32}$/);
  assert.match(record.hash, /^[a-f0-9]{128}$/);
  assert.strictEqual(
    await hasher.verifyPassword('correct horse battery staple', {
      salt: record.salt,
      passwordHash: record.hash
    }),
    true
  );
  assert.strictEqual(
    await hasher.verifyPassword('wrong password', {
      salt: record.salt,
      passwordHash: record.hash
    }),
    false
  );
  assert.strictEqual(
    await hasher.verifyPassword('anything', DUMMY_PASSWORD_RECORD),
    false,
    'dummy password record unexpectedly authenticated'
  );
}

async function assertPasswordHashQueueBound() {
  const releases = [];
  const hasher = createPasswordHasher({
    concurrency: 1,
    maxPending: 2,
    deriveKey() {
      return new Promise(resolve => {
        releases.push(() => resolve(Buffer.alloc(64, 7)));
      });
    }
  });
  const first = hasher.hashPassword('first', 'salt-first');
  await Promise.resolve();
  const second = hasher.hashPassword('second', 'salt-second');
  await Promise.resolve();
  assert.deepStrictEqual(
    { active: hasher.snapshot().active, queued: hasher.snapshot().queued },
    { active: 1, queued: 1 }
  );
  await assert.rejects(
    hasher.hashPassword('overflow', 'salt-overflow'),
    error => error instanceof PasswordHashBusyError && error.code === 'PASSWORD_HASH_BUSY'
  );
  releases.shift()();
  await first;
  await Promise.resolve();
  releases.shift()();
  await second;
  assert.deepStrictEqual(
    { active: hasher.snapshot().active, queued: hasher.snapshot().queued },
    { active: 0, queued: 0 }
  );
}

function assertServerIntegration() {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const required = [
    "app.set('trust proxy', isTrustedProxyAddress)",
    'createAuthRateLimiter(AUTH_RATE_CONFIG)',
    'clientAddressFromRequest(req)',
    'await passwordHasher.hashPassword(password)',
    'await passwordHasher.verifyPassword(password, passwordSnapshot)',
    'usersDb.users[login] !== user',
    'currentReset === reset'
  ];
  for (const marker of required) {
    assert(server.includes(marker), `server auth security integration is missing: ${marker}`);
  }
  assert(!server.includes('crypto.pbkdf2Sync('),
    'production server still hashes passwords synchronously');
  assert(!server.includes('const authRateBuckets = new Map()'),
    'unbounded single-key auth limiter is still present');
}

async function main() {
  assertRateLimitConfiguration();
  assertProxyAddressPolicy();
  assertDualRateLimit();
  assertRateLimitCapacity();
  await assertPasswordHashing();
  await assertPasswordHashQueueBound();
  assertServerIntegration();
  console.log('Auth security checks passed: trusted proxy IPs, dual bounded limits, async password hashing and race guards.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
