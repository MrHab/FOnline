#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const JOURNEY = path.join(__dirname, 'check-kromka-live-journey.js');
const TMP_ROOT = path.resolve(process.env.KROMKA_QA_TMPDIR || os.tmpdir());
const TMP_PREFIX = 'realm-of-ashes-kromka-journey-';
const DATA_DIR = fs.mkdtempSync(path.join(TMP_ROOT, TMP_PREFIX));
const suffix = `${process.pid}_${Date.now().toString(36)}`;
const login = `quest_qa_${suffix}`;
const password = `Quest-pass-${suffix}!`;
const deviceId = `quest_device_${suffix}`;
let port = 0;
let server = null;
let serverLog = '';
let cleaned = false;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (server && server.exitCode === null) {
    try { server.kill('SIGTERM'); } catch (_) {}
  }
  const resolved = path.resolve(DATA_DIR);
  if (resolved.startsWith(`${TMP_ROOT}${path.sep}`)
      && path.basename(resolved).startsWith(TMP_PREFIX)) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch (_) {}
  }
}

process.once('exit', cleanup);
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.json === undefined ? '' : JSON.stringify(options.json);
    const headers = { ...(options.headers || {}) };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({
      hostname: '127.0.0.1', port, path: pathname,
      method: options.method || 'GET', headers, timeout: options.timeoutMs || 2000
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: responseBody }));
    });
    req.once('timeout', () => req.destroy(new Error(`HTTP timeout: ${pathname}`)));
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server stopped during startup.\n${serverLog.slice(-5000)}`);
    if (!port) {
      const match = serverLog.match(/server listening on :(\d+)/);
      if (match) port = Number(match[1]);
    }
    if (port) {
      try {
        const health = await request('/health', { timeoutMs: 700 });
        if (health.status === 200 && JSON.parse(health.body).ok) return;
      } catch (_) {}
    }
    await delay(120);
  }
  throw new Error(`Local quest server did not become ready.\n${serverLog.slice(-5000)}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    delay(2500)
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

function runJourney() {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [JOURNEY], {
      cwd: ROOT,
      env: {
        ...process.env,
        KROMKA_QA_PORT: String(port),
        KROMKA_QA_LOGIN: login,
        KROMKA_QA_PASSWORD: password,
        KROMKA_QA_DEVICE: deviceId,
        KROMKA_QA_CLIENT: `quest_client_${suffix}`,
        KROMKA_QA_CHARACTER: `quest_character_${suffix}`,
        KROMKA_QA_NAME: 'Путник Сквозного Теста'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Live journey exited with code ${code}.`)));
  });
}

(async () => {
  server = childProcess.spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '0',
      DATA_DIR,
      SESSION_LOCK_MS: '250',
      WASTELAND_SIM_SAVE_INTERVAL_MS: '3000',
      KROMKA_TEST_TRAVEL: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => { serverLog += String(chunk); });
  server.stderr.on('data', chunk => { serverLog += String(chunk); });
  await waitForServer();

  const registration = await request('/api/auth/register', {
    method: 'POST',
    json: {
      login, email: `${login}@example.test`, password, deviceId,
      deviceType: 'desktop', controlType: 'keyboard_mouse'
    }
  });
  if (registration.status !== 200 || JSON.parse(registration.body).ok !== true) {
    throw new Error(`Could not register isolated quest character: ${registration.status} ${registration.body}`);
  }

  await runJourney();
  await stopServer();
  console.log('LOCAL CHARACTER JOURNEY PASSED: isolated account, real Socket.IO character and authoritative world actions.');
})().catch(async error => {
  console.error(error.stack || error);
  console.error(serverLog.slice(-5000));
  await stopServer();
  process.exitCode = 1;
}).finally(cleanup);
