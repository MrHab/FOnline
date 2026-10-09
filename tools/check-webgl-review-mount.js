#!/usr/bin/env node
'use strict';

// Real-server review mount: an explicit build directory must supply both the
// page and every /unity asset without falling through to public/unity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'roa-webgl-review-'));
const build = path.join(workspace, 'build');
const data = path.join(workspace, 'data');
fs.mkdirSync(path.join(build, 'Build'), { recursive: true });
fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(build, 'index.html'), '<!doctype html><title>REVIEW_ONLY</title>');
fs.writeFileSync(path.join(build, 'Build', 'review.framework.js.unityweb'), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01]));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function get(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: requestPath, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(chunks) }));
    }).once('error', reject);
  });
}

async function waitHealth(port, child) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Review server exited with ${child.exitCode}`);
    try {
      const response = await get(port, '/health');
      if (response.status === 200) return;
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Review server /health did not become ready');
}

async function checkSocket(port) {
  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, timeout: 5000 });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
  } finally { socket.disconnect(); }
}

async function main() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: data, ROA_UNITY_REVIEW_BUILD_DIR: build,
      NODE_ENV: 'test' }
  });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  try {
    await waitHealth(port, child);
    const rootPage = await get(port, '/');
    assert.equal(rootPage.status, 200);
    assert.match(rootPage.body.toString(), /REVIEW_ONLY/);
    const gamePage = await get(port, '/game');
    assert.match(gamePage.body.toString(), /REVIEW_ONLY/);
    const indexPage = await get(port, '/unity/index.html');
    assert.match(indexPage.body.toString(), /REVIEW_ONLY/);
    assert.equal(indexPage.headers['cache-control'], 'no-store');
    const asset = await get(port, '/unity/Build/review.framework.js.unityweb', { 'Accept-Encoding': 'gzip' });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['content-encoding'], 'gzip');
    assert.match(asset.headers['content-type'], /application\/javascript/);
    assert.equal(asset.headers['cache-control'], 'no-store');
    const productionBuild = path.join(root, 'public', 'unity', 'Build');
    const productionAsset = fs.existsSync(productionBuild)
      ? fs.readdirSync(productionBuild, { withFileTypes: true }).find(entry => entry.isFile())?.name
      : null;
    if (productionAsset && productionAsset !== 'review.framework.js.unityweb') {
      const missing = await get(port, '/unity/Build/' + encodeURIComponent(productionAsset));
      assert.equal(missing.status, 404, 'staged /unity must not fall through to public/unity');
    }
    await checkSocket(port);
    console.log('WebGL review mount OK: isolated page/assets, encoding, /health and Socket.IO.');
  } catch (error) {
    error.message += `\nServer output:\n${output.slice(-4000)}`;
    throw error;
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000).unref();
    });
  }
}

main().finally(() => fs.rmSync(workspace, { recursive: true, force: true }))
  .catch(error => { console.error(error); process.exitCode = 1; });
