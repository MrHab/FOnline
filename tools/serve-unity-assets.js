'use strict';

// Loopback-only static host for Unity editor probes. It deliberately serves
// public/ assets and nothing else; the authoritative game server is not started.
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..', 'public');
const port = Number(process.env.ROA_UNITY_ASSET_PORT || 3000);
const mime = new Map([
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
  process.stdout.write(`Unity asset probe host: http://127.0.0.1:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
