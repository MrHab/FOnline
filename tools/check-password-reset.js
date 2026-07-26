#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  DEFAULT_PASSWORD_RESET_TTL_MS,
  MIN_PASSWORD_RESET_TTL_MS,
  buildPasswordResetEmail,
  formatPasswordResetTtl,
  normalizePasswordResetTtlMs,
  passwordResetTokenHash
} = require('../src/server/password-reset');

assert.strictEqual(
  normalizePasswordResetTtlMs(undefined),
  DEFAULT_PASSWORD_RESET_TTL_MS,
  'missing TTL did not use the default'
);
assert.strictEqual(
  normalizePasswordResetTtlMs('not-a-number'),
  DEFAULT_PASSWORD_RESET_TTL_MS,
  'invalid TTL did not use the default'
);
assert.strictEqual(
  normalizePasswordResetTtlMs(60 * 1000),
  MIN_PASSWORD_RESET_TTL_MS,
  'TTL below the safety floor was not clamped'
);
assert.strictEqual(formatPasswordResetTtl(60 * 60 * 1000), '1 час');
assert.strictEqual(formatPasswordResetTtl(90 * 60 * 1000), '1 час 30 минут');
assert.strictEqual(formatPasswordResetTtl(25 * 60 * 60 * 1000), '1 день 1 час');

const defaultEmail = buildPasswordResetEmail({
  publicGameUrl: 'https://rangir.ru',
  login: 'survivor',
  token: 'default-token',
  ttlMs: DEFAULT_PASSWORD_RESET_TTL_MS
});
assert.match(defaultEmail.text, /Ссылка действует 1 час\./);
assert.match(defaultEmail.html, /Ссылка действует 1 час\./);
assert.match(defaultEmail.text, /resetToken=default-token&login=survivor/);
assert.match(defaultEmail.html, /resetToken=default-token&amp;login=survivor/);

const customEmail = buildPasswordResetEmail({
  publicGameUrl: 'https://rangir.ru/play?source=mail',
  login: 'custom survivor',
  token: 'custom-token',
  ttlMs: 30 * 60 * 1000
});
assert.match(customEmail.text, /Ссылка действует 30 минут\./);
assert.match(customEmail.html, /Ссылка действует 30 минут\./);
assert.doesNotMatch(customEmail.text, /Ссылка действует 1 час\./);
assert.match(customEmail.html, /source=mail&amp;resetToken=custom-token&amp;login=custom\+survivor/);

const tokenHash = passwordResetTokenHash('one-time-secret');
assert.strictEqual(tokenHash.length, 64, 'reset token hash is not SHA-256 hex');
assert.strictEqual(tokenHash, passwordResetTokenHash('one-time-secret'), 'reset token hash is unstable');
assert.notStrictEqual(tokenHash, passwordResetTokenHash('different-secret'), 'different reset tokens share a hash');
assert.ok(!tokenHash.includes('one-time-secret'), 'raw reset token leaked into its hash');

console.log('Password reset checks passed: TTL normalization, localized mail text, URL escaping and token hashing.');
