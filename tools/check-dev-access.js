#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(PROJECT_ROOT, 'server.js');
const NGINX_FILE = path.join(PROJECT_ROOT, 'deploy', 'nginx', 'realm-of-ashes.locations.conf');
const {
  DEV_LOCAL_HEADER,
  MIN_DEV_TOKEN_BYTES,
  requestHasProxyHeaders,
  tokenMatches
} = require(path.join(PROJECT_ROOT, 'src', 'server', 'dev-access'));
const LOCAL_DEV_HEADERS = { 'X-Dev-Local': '1' };
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-of-ashes-dev-access-'));
const activeProcesses = new Set();

function invariant(condition, message, extra = '') {
  if (condition) return;
  const suffix = extra ? `\n${String(extra).trim()}` : '';
  throw new Error(`${message}${suffix}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.json === undefined ? String(options.body || '') : JSON.stringify(options.json);
    const headers = { ...(options.headers || {}) };
    if (options.json !== undefined) headers['Content-Type'] = 'application/json';
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers,
      timeout: 1500
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        statusCode: Number(res.statusCode || 0),
        headers: res.headers,
        body: responseBody
      }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function spawnServer(label, overrides = {}) {
  const dataDir = path.join(TMP_ROOT, label);
  const logs = [];
  const proc = childProcess.spawn(process.execPath, [SERVER_FILE], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      // Let the OS reserve and assign the listening port atomically. Choosing
      // a random number first leaves a TOCTOU window for another process.
      PORT: '0',
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      DEV_API_MODE: 'disabled',
      DEV_ADMIN_TOKEN: '',
      WASTELAND_SIM_TICK_MS: '600000',
      WASTELAND_SIM_SAVE_INTERVAL_MS: '600000',
      ...overrides
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  activeProcesses.add(proc);
  proc.stdout.on('data', chunk => logs.push(String(chunk)));
  proc.stderr.on('data', chunk => logs.push(String(chunk)));
  proc.once('exit', () => activeProcesses.delete(proc));
  return { label, port: 0, dataDir, logs, proc };
}

async function waitForHealth(server, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (server.proc.exitCode !== null) {
      invariant(false, `${server.label}: server exited before health`, server.logs.join(''));
    }
    if (!server.port) {
      const match = server.logs.join('').match(/server listening on :(\d+)/);
      const reportedPort = Number(match?.[1] || 0);
      if (reportedPort > 0 && reportedPort <= 65535) server.port = reportedPort;
    }
    if (server.port) {
      try {
        const health = await request(server.port, '/health');
        if (health.statusCode === 200) return health;
      } catch (_) {
        // Startup is still in progress.
      }
    }
    await delay(100);
  }
  invariant(false, `${server.label}: health timeout`, server.logs.join(''));
}

async function stopServer(server) {
  if (!server?.proc || server.proc.exitCode !== null) return;
  const exited = new Promise(resolve => server.proc.once('exit', resolve));
  try { server.proc.kill('SIGTERM'); } catch (_) {}
  const stopped = await Promise.race([exited.then(() => true), delay(2000).then(() => false)]);
  if (!stopped && server.proc.exitCode === null) {
    try { server.proc.kill('SIGKILL'); } catch (_) {}
    await Promise.race([exited, delay(1000)]);
  }
}

function cleanup() {
  for (const proc of activeProcesses) {
    if (proc.exitCode === null) {
      try { proc.kill('SIGTERM'); } catch (_) {}
    }
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_) {}
}

process.once('exit', cleanup);
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

function snapshotFiles(dataDir, relativeFiles) {
  return Object.fromEntries(relativeFiles.map(relativeFile => {
    const file = path.join(dataDir, relativeFile);
    return [relativeFile, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
  }));
}

function assertSnapshotUnchanged(before, after, label) {
  invariant(JSON.stringify(after) === JSON.stringify(before), `${label}: forbidden request changed DATA_DIR`, JSON.stringify({
    before: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value?.length ?? null])),
    after: Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value?.length ?? null]))
  }, null, 2));
}

async function assertProductionDisabledMode() {
  const server = spawnServer('production-disabled', {
    NODE_ENV: 'production',
    DEV_API_MODE: 'disabled'
  });
  try {
    await waitForHealth(server);
    const publicLocations = await request(server.port, '/api/locations');
    invariant(publicLocations.statusCode === 200, 'disabled mode broke public locations API', publicLocations.body);
    for (const pathname of [
      '/api/dev',
      '/api/dev/locations',
      '/dev-location-editor.html',
      '/dev-global-map-editor.html',
      '/DEV-LOCATION-EDITOR.HTML',
      '/dev-global-map-editor%2ehtml',
      '/%44ev-location-editor.html',
      '/%44EV-LOCATION-EDITOR.HTML'
    ]) {
      const response = await request(server.port, pathname);
      invariant(response.statusCode === 404, `production disabled mode exposed ${pathname}`, response.body);
    }

    const trackedFiles = [
      'global-map.json',
      'wasteland-sim.json',
      path.join('locations', 'settlement.json')
    ];
    const before = snapshotFiles(server.dataDir, trackedFiles);
    const attempts = [
      request(server.port, '/api/dev/global-map', {
        method: 'POST',
        json: { map: { grid: { cols: 1, rows: 1, cellPoints: 1 }, nodes: [], objects: [], cells: {} } }
      }),
      request(server.port, '/api/dev/locations/settlement', {
        method: 'POST',
        json: { location: { id: 'settlement', name: 'FORBIDDEN WRITE' } }
      }),
      request(server.port, '/api/dev/wasteland/reset', { method: 'POST', json: {} })
    ];
    const responses = await Promise.all(attempts);
    responses.forEach(response => {
      invariant(response.statusCode === 404, 'disabled dev mutation did not return 404', response.body);
    });
    const after = snapshotFiles(server.dataDir, trackedFiles);
    assertSnapshotUnchanged(before, after, 'production disabled mode');
  } finally {
    await stopServer(server);
  }
}

async function assertLocalMode() {
  const server = spawnServer('local-mode', {
    NODE_ENV: 'test',
    DEV_API_MODE: 'local'
  });
  try {
    await waitForHealth(server);
    const missingProof = await request(server.port, '/api/dev/locations');
    invariant(missingProof.statusCode === 403, 'local mode accepted a request without the non-simple proof header', missingProof.body);
    const direct = await request(server.port, '/api/dev/locations', {
      headers: LOCAL_DEV_HEADERS
    });
    invariant(direct.statusCode === 200, 'direct loopback request was rejected in local mode', direct.body);
    const editor = await request(server.port, '/dev-location-editor.html');
    invariant(editor.statusCode === 200, 'local editor page was unavailable in local mode', editor.body);
    const proxied = await request(server.port, '/api/dev/locations', {
      headers: {
        ...LOCAL_DEV_HEADERS,
        'X-Real-IP': '203.0.113.41',
        'X-Forwarded-For': '203.0.113.41',
        'X-Forwarded-Proto': 'https'
      }
    });
    invariant(proxied.statusCode === 403, 'proxy headers bypassed local-only dev mode', proxied.body);
    const uncommonForwarded = await request(server.port, '/api/dev/locations', {
      headers: { ...LOCAL_DEV_HEADERS, 'X-Forwarded-Port': '443' }
    });
    invariant(uncommonForwarded.statusCode === 403, 'uncommon X-Forwarded-* header bypassed local-only dev mode', uncommonForwarded.body);

    const reboundHost = await request(server.port, '/api/dev/locations', {
      headers: { ...LOCAL_DEV_HEADERS, Host: `attacker.invalid:${server.port}` }
    });
    invariant(reboundHost.statusCode === 403, 'non-loopback Host bypassed local-only dev mode', reboundHost.body);

    const trackedFiles = ['wasteland-sim.json'];
    const before = snapshotFiles(server.dataDir, trackedFiles);
    const crossSiteForm = await request(server.port, '/api/dev/wasteland/reset', {
      method: 'POST',
      body: 'reset=1',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://attacker.invalid',
        'Sec-Fetch-Site': 'cross-site'
      }
    });
    invariant(crossSiteForm.statusCode === 403, 'cross-site HTML form reached local dev mutation', crossSiteForm.body);
    const forgedProof = await request(server.port, '/api/dev/wasteland/reset', {
      method: 'POST',
      json: {},
      headers: {
        ...LOCAL_DEV_HEADERS,
        Origin: 'https://attacker.invalid',
        'Sec-Fetch-Site': 'cross-site'
      }
    });
    invariant(forgedProof.statusCode === 403, 'cross-site Origin bypassed local dev mutation guard', forgedProof.body);
    const nonJsonMutation = await request(server.port, '/api/dev/wasteland/reset', {
      method: 'POST',
      body: 'reset=1',
      headers: {
        ...LOCAL_DEV_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: `http://127.0.0.1:${server.port}`,
        'Sec-Fetch-Site': 'same-origin'
      }
    });
    invariant(nonJsonMutation.statusCode === 415, 'local dev mutation accepted a non-JSON body', nonJsonMutation.body);
    const after = snapshotFiles(server.dataDir, trackedFiles);
    assertSnapshotUnchanged(before, after, 'local CSRF and content-type guards');
  } finally {
    await stopServer(server);
  }
}

async function assertTokenMode() {
  const secret = 'dev-access-regression-token-at-least-32-bytes';
  const server = spawnServer('token-mode', {
    NODE_ENV: 'test',
    DEV_API_MODE: 'token',
    DEV_ADMIN_TOKEN: secret
  });
  try {
    await waitForHealth(server);
    const missing = await request(server.port, '/api/dev/locations');
    invariant(missing.statusCode === 403, 'token mode accepted a missing token', missing.body);
    const wrong = await request(server.port, '/api/dev/locations', {
      headers: { 'X-Dev-Token': `${secret}-wrong` }
    });
    invariant(wrong.statusCode === 403, 'token mode accepted an invalid token', wrong.body);
    const accepted = await request(server.port, '/api/dev/locations', {
      headers: {
        'X-Dev-Token': secret,
        'X-Forwarded-For': '203.0.113.42',
        'X-Forwarded-Proto': 'https'
      }
    });
    invariant(accepted.statusCode === 200, 'token mode rejected a valid proxied token', accepted.body);
    const editor = await request(server.port, '/dev-global-map-editor.html');
    invariant(editor.statusCode === 200, 'non-production token mode did not serve the editor shell', editor.body);
    invariant(!server.logs.join('').includes(secret), 'DEV_ADMIN_TOKEN leaked into server logs');
  } finally {
    await stopServer(server);
  }
}

async function assertProductionTokenMode() {
  const secret = 'production-dev-access-token-at-least-32-bytes';
  const server = spawnServer('production-token-mode', {
    NODE_ENV: 'production',
    DEV_API_MODE: 'token',
    DEV_ADMIN_TOKEN: secret
  });
  try {
    await waitForHealth(server);
    const accepted = await request(server.port, '/api/dev/locations', {
      headers: { 'X-Dev-Token': secret }
    });
    invariant(accepted.statusCode === 200, 'production token mode rejected an authenticated API request', accepted.body);
    for (const pathname of [
      '/dev-location-editor.html',
      '/%44ev-location-editor.html',
      '/dev-global-map-editor%2ehtml'
    ]) {
      const editor = await request(server.port, pathname);
      invariant(editor.statusCode === 404, `production token mode exposed editor shell ${pathname}`, editor.body);
    }
  } finally {
    await stopServer(server);
  }
}

async function assertStartupRejected(label, overrides, expectedMessage) {
  const server = spawnServer(label, overrides);
  const exited = await Promise.race([
    new Promise(resolve => server.proc.once('exit', code => resolve({ exited: true, code }))),
    delay(4000).then(() => ({ exited: false, code: null }))
  ]);
  if (!exited.exited) await stopServer(server);
  invariant(exited.exited && exited.code !== 0, `${label}: unsafe configuration did not fail startup`, server.logs.join(''));
  invariant(server.logs.join('').includes(expectedMessage), `${label}: startup error did not explain the policy`, server.logs.join(''));
}

function assertNginxPolicy() {
  const source = fs.readFileSync(NGINX_FILE, 'utf8');
  const devRegex = source.indexOf('location ~* ^/api/dev(?:/|$) {');
  const apiRegex = source.indexOf('location ~ ^/api/ {');
  invariant(devRegex >= 0 && apiRegex >= 0 && devRegex < apiRegex,
    'Nginx case-insensitive dev API deny is missing or placed after the public API proxy');
  invariant(!source.includes('location ^~ /api/ {'),
    'Nginx public API ^~ prefix would bypass the mixed-case dev deny regex');
  invariant(source.includes('location ~* ^/dev-(?:location|global-map)-editor\\.html$ {'),
    'Nginx does not deny public editor HTML case-insensitively');
}

function assertEditorTokenFlow() {
  for (const relativeFile of ['public/dev-location-editor.html', 'public/dev-global-map-editor.html']) {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, relativeFile), 'utf8');
    invariant(source.includes("headers['X-Dev-Token'] = token")
      && source.includes("headers['X-Dev-Local'] = '1'")
      && source.includes('window.sessionStorage')
      && source.includes('devApiFetch')
      && source.includes('requestDevToken')
      && source.includes('type="password"'),
    `${relativeFile} does not use the in-page token dialog for explicit dev API requests`);
  }
}

function assertPolicyHelpers() {
  invariant(DEV_LOCAL_HEADER === 'x-dev-local', 'local proof header contract drifted');
  invariant(MIN_DEV_TOKEN_BYTES >= 32, 'token mode permits brute-forceable short secrets');
  invariant(requestHasProxyHeaders({ headers: { 'X-Forwarded-Custom': 'proxy' } }),
    'proxy detection did not cover the complete X-Forwarded-* family');
  invariant(tokenMatches('секрет', 'секрет'), 'UTF-8 token equality failed');
  invariant(!tokenMatches('é', 'x'), 'different UTF-8 token byte lengths were accepted');
}

async function main() {
  assertNginxPolicy();
  assertEditorTokenFlow();
  assertPolicyHelpers();
  await assertStartupRejected(
    'production-local-rejected',
    { NODE_ENV: 'production', DEV_API_MODE: 'local' },
    'DEV_API_MODE=local is forbidden'
  );
  await assertStartupRejected(
    'token-without-secret-rejected',
    { NODE_ENV: 'production', DEV_API_MODE: 'token', DEV_ADMIN_TOKEN: '' },
    `at least ${MIN_DEV_TOKEN_BYTES} UTF-8 bytes`
  );
  await assertStartupRejected(
    'weak-token-rejected',
    { NODE_ENV: 'test', DEV_API_MODE: 'token', DEV_ADMIN_TOKEN: 'short-token' },
    `at least ${MIN_DEV_TOKEN_BYTES} UTF-8 bytes`
  );
  await assertStartupRejected(
    'invalid-mode-rejected',
    { NODE_ENV: 'test', DEV_API_MODE: 'proxy-trust' },
    'Invalid DEV_API_MODE'
  );
  await assertProductionDisabledMode();
  await assertLocalMode();
  await assertTokenMode();
  await assertProductionTokenMode();
  console.log('Dev access check passed: production defaults closed, local mode rejects proxy/CSRF requests, token mode requires a strong secret, and denied writes leave DATA_DIR unchanged.');
}

main().catch(error => {
  console.error(`Dev access check failed: ${error?.message || String(error)}`);
  cleanup();
  process.exit(1);
});
