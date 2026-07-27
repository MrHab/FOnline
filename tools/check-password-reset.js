#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
  DEFAULT_PASSWORD_RESET_TTL_MS,
  MIN_PASSWORD_RESET_TTL_MS,
  buildPasswordResetEmail,
  createPasswordResetRecord,
  formatPasswordResetTtl,
  normalizePasswordResetTtlMs,
  passwordResetRecordIsValid,
  passwordResetTokenHash
} = require('../src/server/password-reset');

const ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(ROOT, 'server.js');
const CLOCK_PRELOAD = path.join(__dirname, 'test-support', 'controlled-clock.js');
const CUSTOM_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

function assertPurePasswordResetContracts() {
  assert.strictEqual(normalizePasswordResetTtlMs(undefined), DEFAULT_PASSWORD_RESET_TTL_MS);
  assert.strictEqual(normalizePasswordResetTtlMs('invalid'), DEFAULT_PASSWORD_RESET_TTL_MS);
  assert.strictEqual(normalizePasswordResetTtlMs(1), MIN_PASSWORD_RESET_TTL_MS);
  assert.strictEqual(normalizePasswordResetTtlMs(CUSTOM_TTL_MS), CUSTOM_TTL_MS);

  assert.strictEqual(formatPasswordResetTtl(DEFAULT_PASSWORD_RESET_TTL_MS), '1 час');
  assert.strictEqual(formatPasswordResetTtl(CUSTOM_TTL_MS), '15 минут');
  assert.strictEqual(formatPasswordResetTtl(90 * 60 * 1000), '1 час 30 минут');
  assert.strictEqual(formatPasswordResetTtl(22 * 60 * 60 * 1000), '22 часа');
  assert.strictEqual(formatPasswordResetTtl(25 * 60 * 60 * 1000), '1 день 1 час');

  const tokenHash = passwordResetTokenHash('one-time-secret');
  assert.strictEqual(tokenHash.length, 64);
  assert.strictEqual(tokenHash, passwordResetTokenHash('one-time-secret'));
  assert.notStrictEqual(tokenHash, passwordResetTokenHash('different-secret'));

  const record = createPasswordResetRecord('token-a', CUSTOM_TTL_MS, 1000);
  assert.strictEqual(passwordResetRecordIsValid(record, 'token-a', record.expiresAt - 1), true);
  assert.strictEqual(passwordResetRecordIsValid(record, 'token-a', record.expiresAt), false);
  assert.strictEqual(passwordResetRecordIsValid(record, 'token-b', record.expiresAt - 1), false);
  assert.strictEqual(passwordResetRecordIsValid({ ...record, tokenHash: 'bad' }, 'token-a', 1000), false);

  const defaultEmail = buildPasswordResetEmail({
    publicGameUrl: 'https://example.test/',
    login: 'user',
    token: 'abc',
    ttlMs: undefined
  });
  assert(defaultEmail.text.includes('Ссылка действует 1 час.'));
  assert(defaultEmail.html.includes('resetToken=abc&amp;login=user'));

  const builtEmail = buildPasswordResetEmail({
    publicGameUrl: 'https://rangir.ru/play?source=mail',
    login: 'custom survivor',
    token: 'custom-token',
    ttlMs: 30 * 60 * 1000
  });
  assert(builtEmail.text.includes('Ссылка действует 30 минут.'));
  assert(builtEmail.text.includes('source=mail&resetToken=custom-token&login=custom+survivor'));
  assert(builtEmail.html.includes('source=mail&amp;resetToken=custom-token&amp;login=custom+survivor'));
}

function createSmtpCaptureServer() {
  const messages = [];
  const waiters = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 localhost Realm test SMTP\r\n');
    let buffer = '';
    let dataMode = false;
    let message = '';

    function publish(raw) {
      messages.push(raw);
      for (let index = waiters.length - 1; index >= 0; index--) {
        const waiter = waiters[index];
        if (messages.length < waiter.count) continue;
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(messages.slice());
      }
    }

    function handleCommand(line) {
      const command = line.trim().toUpperCase();
      if (command.startsWith('EHLO')) {
        socket.write('250-localhost\r\n250-8BITMIME\r\n250 PIPELINING\r\n');
      } else if (command.startsWith('HELO')) {
        socket.write('250 localhost\r\n');
      } else if (command.startsWith('MAIL FROM:') || command.startsWith('RCPT TO:') || command === 'RSET') {
        socket.write('250 OK\r\n');
      } else if (command === 'DATA') {
        dataMode = true;
        message = '';
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (command === 'QUIT') {
        socket.end('221 Bye\r\n');
      } else if (command === 'NOOP') {
        socket.write('250 OK\r\n');
      } else {
        socket.write('250 OK\r\n');
      }
    }

    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer) {
        if (dataMode) {
          message += buffer;
          buffer = '';
          const end = message.indexOf('\r\n.\r\n');
          if (end < 0) return;
          buffer = message.slice(end + 5);
          const completeMessage = message.slice(0, end);
          message = '';
          dataMode = false;
          publish(completeMessage);
          socket.write('250 Message accepted\r\n');
          continue;
        }
        const newline = buffer.indexOf('\r\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        handleCommand(line);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: address.port,
        messages,
        close: () => new Promise(done => {
          for (const socket of sockets) socket.destroy();
          server.close(done);
        }),
        waitForCount(count, timeoutMs = REQUEST_TIMEOUT_MS) {
          if (messages.length >= count) return Promise.resolve(messages.slice());
          return new Promise((waitResolve, waitReject) => {
            const waiter = {
              count,
              resolve: waitResolve,
              timer: setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) waiters.splice(index, 1);
                waitReject(new Error(`Timed out waiting for SMTP message ${count}`));
              }, timeoutMs)
            };
            waiters.push(waiter);
          });
        }
      });
    });
  });
}

function decodeQuotedPrintable(raw) {
  const source = String(raw || '').replace(/=\r\n/g, '');
  const bytes = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '=' && /^[a-f0-9]{2}$/i.test(source.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    const encoded = Buffer.from(source[index]);
    for (const byte of encoded) bytes.push(byte);
  }
  return Buffer.from(bytes).toString('utf8');
}

function resetTokenFromMessage(raw) {
  const decodedBodies = [];
  const base64BodyPattern = /Content-Transfer-Encoding:\s*base64\r?\n\r?\n([a-z0-9+/=\r\n]+)/gi;
  for (const match of String(raw || '').matchAll(base64BodyPattern)) {
    decodedBodies.push(Buffer.from(match[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
  }
  const decoded = [decodeQuotedPrintable(raw), ...decodedBodies].join('\n');
  const match = decoded.match(/resetToken=([a-f0-9]{64})/i);
  assert(match, `Reset token is missing from captured email:\n${decoded}`);
  return { decoded, token: match[1] };
}

async function waitForHealth(proc, logs) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let baseUrl = '';
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Password reset test server exited early (${proc.exitCode}):\n${logs.join('')}`);
    }
    if (!baseUrl) {
      const match = logs.join('').match(/server listening on :(\d+)/);
      const reportedPort = Number(match?.[1] || 0);
      if (reportedPort > 0 && reportedPort <= 65535) {
        baseUrl = `http://127.0.0.1:${reportedPort}`;
      }
    }
    if (baseUrl) {
      try {
        const response = await fetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(1000)
        });
        await response.arrayBuffer();
        if (response.ok) return baseUrl;
      } catch (_) {}
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for password reset test server:\n${logs.join('')}`);
}

async function postJson(baseUrl, pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const body = await response.json();
  return { status: response.status, body };
}

function setClockOffset(proc, offsetMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out setting controlled server clock')), 2000);
    const onMessage = message => {
      if (!message || message.type !== 'realm-test-clock-ready' || message.offsetMs !== offsetMs) return;
      clearTimeout(timer);
      proc.off('message', onMessage);
      resolve();
    };
    proc.on('message', onMessage);
    proc.send({ type: 'realm-test-clock-offset', offsetMs }, error => {
      if (!error) return;
      clearTimeout(timer);
      proc.off('message', onMessage);
      reject(error);
    });
  });
}

async function stopChild(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => proc.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 1000))
  ]);
  if (proc.exitCode === null) proc.kill('SIGKILL');
}

async function assertPasswordResetLifecycle() {
  const smtp = await createSmtpCaptureServer();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-password-reset-'));
  const logs = [];
  const proc = childProcess.fork(SERVER_FILE, [], {
    cwd: ROOT,
    execArgv: ['--require', CLOCK_PRELOAD],
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      DEV_API_MODE: 'disabled',
      SMTP_URL: `smtp://127.0.0.1:${smtp.port}`,
      MAIL_FROM: 'Realm of Ashes <noreply@example.test>',
      PUBLIC_GAME_URL: 'https://example.test/play',
      PASSWORD_RESET_TTL_MS: String(CUSTOM_TTL_MS)
    },
    silent: true
  });
  proc.stdout.on('data', chunk => logs.push(String(chunk)));
  proc.stderr.on('data', chunk => logs.push(String(chunk)));

  try {
    const baseUrl = await waitForHealth(proc, logs);
    const suffix = Math.random().toString(16).slice(2);
    const login = `reset_${suffix}`.slice(0, 28);
    const email = `${login}@example.test`;
    const oldPassword = `old-password-${suffix}`;
    const newPassword = `new-password-${suffix}`;

    const registered = await postJson(baseUrl, '/api/auth/register', {
      login,
      email,
      password: oldPassword,
      deviceId: `device_${suffix}`
    });
    assert.strictEqual(registered.status, 200, JSON.stringify(registered.body));

    const firstRequest = await postJson(baseUrl, '/api/auth/password-reset/request', { email });
    assert.strictEqual(firstRequest.status, 200, JSON.stringify(firstRequest.body));
    const firstMessages = await smtp.waitForCount(1);
    const firstMail = resetTokenFromMessage(firstMessages[0]);
    assert(firstMail.decoded.includes('Ссылка действует 15 минут.'));

    await setClockOffset(proc, CUSTOM_TTL_MS + 1000);
    const expired = await postJson(baseUrl, '/api/auth/password-reset/confirm', {
      login,
      token: firstMail.token,
      password: newPassword
    });
    assert.strictEqual(expired.status, 400, JSON.stringify(expired.body));

    await setClockOffset(proc, 0);
    const secondRequest = await postJson(baseUrl, '/api/auth/password-reset/request', { email });
    assert.strictEqual(secondRequest.status, 200, JSON.stringify(secondRequest.body));
    const secondMessages = await smtp.waitForCount(2);
    const secondMail = resetTokenFromMessage(secondMessages[1]);
    assert.notStrictEqual(secondMail.token, firstMail.token);

    const confirmed = await postJson(baseUrl, '/api/auth/password-reset/confirm', {
      login,
      token: secondMail.token,
      password: newPassword
    });
    assert.strictEqual(confirmed.status, 200, JSON.stringify(confirmed.body));

    const replayed = await postJson(baseUrl, '/api/auth/password-reset/confirm', {
      login,
      token: secondMail.token,
      password: newPassword
    });
    assert.strictEqual(replayed.status, 400, JSON.stringify(replayed.body));

    const oldLogin = await postJson(baseUrl, '/api/auth/login', {
      login,
      password: oldPassword,
      deviceId: `device_old_${suffix}`
    });
    assert.strictEqual(oldLogin.status, 401, JSON.stringify(oldLogin.body));
    const newLogin = await postJson(baseUrl, '/api/auth/login', {
      login,
      password: newPassword,
      deviceId: `device_new_${suffix}`
    });
    assert.strictEqual(newLogin.status, 200, JSON.stringify(newLogin.body));
  } catch (error) {
    error.message = `${error.message}\nPassword reset test server logs:\n${logs.join('')}`;
    throw error;
  } finally {
    await stopChild(proc);
    await smtp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  assertPurePasswordResetContracts();
  await assertPasswordResetLifecycle();
  console.log('Password reset checks passed: TTL copy, invalid config fallback, expiry, one-time confirmation and password replacement.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
