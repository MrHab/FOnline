'use strict';

const crypto = require('crypto');

const PASSWORD_HASH_ITERATIONS = 120000;
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_DIGEST = 'sha512';
const DEFAULT_PASSWORD_HASH_CONCURRENCY = 4;
const DEFAULT_PASSWORD_HASH_MAX_PENDING = 64;
const DUMMY_PASSWORD_RECORD = Object.freeze({
  salt: '00000000000000000000000000000000',
  passwordHash: '00'.repeat(PASSWORD_HASH_KEY_LENGTH)
});

class PasswordHashBusyError extends Error {
  constructor(message = 'Password hashing queue is full') {
    super(message);
    this.name = 'PasswordHashBusyError';
    this.code = 'PASSWORD_HASH_BUSY';
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizePasswordHashConfig(source = {}) {
  const concurrency = boundedInteger(
    source.concurrency ?? source.PASSWORD_HASH_CONCURRENCY,
    DEFAULT_PASSWORD_HASH_CONCURRENCY,
    1,
    32
  );
  const maxPending = boundedInteger(
    source.maxPending ?? source.PASSWORD_HASH_MAX_PENDING,
    DEFAULT_PASSWORD_HASH_MAX_PENDING,
    concurrency,
    1024
  );
  return Object.freeze({ concurrency, maxPending });
}

function derivePasswordKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      String(password),
      String(salt),
      PASSWORD_HASH_ITERATIONS,
      PASSWORD_HASH_KEY_LENGTH,
      PASSWORD_HASH_DIGEST,
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      }
    );
  });
}

function createPasswordHasher(options = {}) {
  const config = normalizePasswordHashConfig(options);
  const deriveKey = typeof options.deriveKey === 'function'
    ? options.deriveKey
    : derivePasswordKey;
  const randomBytes = typeof options.randomBytes === 'function'
    ? options.randomBytes
    : crypto.randomBytes;
  const queue = [];
  let active = 0;

  function pump() {
    while (active < config.concurrency && queue.length) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => deriveKey(job.password, job.salt))
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  function enqueue(password, salt) {
    if (active + queue.length >= config.maxPending) {
      return Promise.reject(new PasswordHashBusyError());
    }
    return new Promise((resolve, reject) => {
      queue.push({
        password: String(password),
        salt: String(salt),
        resolve,
        reject
      });
      pump();
    });
  }

  async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const normalizedSalt = String(salt);
    const key = await enqueue(password, normalizedSalt);
    return {
      salt: normalizedSalt,
      hash: Buffer.from(key).toString('hex')
    };
  }

  async function verifyPassword(password, record = DUMMY_PASSWORD_RECORD) {
    const salt = typeof record?.salt === 'string' && record.salt
      ? record.salt
      : DUMMY_PASSWORD_RECORD.salt;
    const expectedHex = typeof record?.passwordHash === 'string'
      && /^[a-f0-9]{128}$/i.test(record.passwordHash)
      ? record.passwordHash
      : DUMMY_PASSWORD_RECORD.passwordHash;
    const key = await enqueue(password, salt);
    const actual = Buffer.from(key);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length
      && crypto.timingSafeEqual(actual, expected)
      && record !== DUMMY_PASSWORD_RECORD
      && expectedHex === record?.passwordHash;
  }

  function snapshot() {
    return {
      active,
      queued: queue.length,
      pending: active + queue.length,
      config
    };
  }

  return Object.freeze({
    hashPassword,
    snapshot,
    verifyPassword
  });
}

function isPasswordHashBusyError(error) {
  return error instanceof PasswordHashBusyError || error?.code === 'PASSWORD_HASH_BUSY';
}

module.exports = {
  DEFAULT_PASSWORD_HASH_CONCURRENCY,
  DEFAULT_PASSWORD_HASH_MAX_PENDING,
  DUMMY_PASSWORD_RECORD,
  PASSWORD_HASH_DIGEST,
  PASSWORD_HASH_ITERATIONS,
  PASSWORD_HASH_KEY_LENGTH,
  PasswordHashBusyError,
  createPasswordHasher,
  isPasswordHashBusyError,
  normalizePasswordHashConfig
};
