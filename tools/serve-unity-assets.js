'use strict';

// Loopback-only static host for Unity editor probes. It deliberately serves
// public/ assets; an explicit candidate mode overlays only the twelve pinned
// suit GLBs from Logs. The authoritative game server is never started.
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', 'public');
const port = Number(process.env.ROA_UNITY_ASSET_PORT || 3000);
const candidateRoutes = new Map();
let candidateManifest = null;
if (process.argv.includes('--suit-candidate')) {
  const workspace = path.resolve(root, '..');
  const candidateRoot = path.join(workspace, 'unity-client', 'Logs', 'UpperSuitCandidate');
  candidateManifest = JSON.parse(fs.readFileSync(path.join(candidateRoot, 'manifest.json'), 'utf8'));
  const expected = ['hazmatSuit', 'energySuit'].flatMap(item =>
    ['male_slim','male_medium','male_large','female_slim','female_medium','female_large'].map(body => item+'/'+body)).sort();
  if (JSON.stringify(candidateManifest.files.map(row=>row.itemId+'/'+row.bodyId).sort()) !== JSON.stringify(expected))
    throw new Error('A complete twelve-suit candidate is required');
  for (const row of candidateManifest.files) {
    const file = path.resolve(workspace, row.candidateFile);
    if (!file.startsWith(candidateRoot + path.sep)) throw new Error('Candidate file escapes the suit directory');
    const bytes = fs.readFileSync(file);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== row.sha256) throw new Error('Stale candidate: '+row.itemId+'/'+row.bodyId);
    // Freeze bytes for the complete probe run, even if a later build changes Logs.
    const snapshot = { bytes, hash };
    candidateRoutes.set(row.file, snapshot);
    candidateRoutes.set(row.file.replace('/models/', '/models-lite/'), snapshot);
  }
}
const mime = new Map([
  // The same read-only loopback host can review a rebuilt WebGL player at
  // /unity/index.html?roaModelReview=1 without starting multiplayer or accounts.
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.bin', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.json', 'application/json; charset=utf-8']
]);

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  if (candidateManifest && pathname === '/__roa_probe_catalogs') {
    const bytes = Buffer.from(JSON.stringify({ mode: 'suit-candidate', suitCandidate: candidateManifest }));
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': bytes.length,
      'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return;
  }
  const suit = candidateRoutes.get(pathname);
  if (suit) {
    response.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': suit.bytes.length,
      'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
      'X-ROA-Suit-Catalog': candidateManifest.version, 'X-ROA-Asset-SHA256': suit.hash });
    response.end(request.method === 'HEAD' ? undefined : suit.bytes);
    return;
  }

  const candidate = path.resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }

  fs.stat(candidate, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime.get(path.extname(candidate).toLowerCase()) || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(candidate).pipe(response);
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Unity asset probe host: http://127.0.0.1:${server.address().port}\n`);
  if (candidateManifest) process.stdout.write(`Immutable suit candidate: ${candidateManifest.version}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
