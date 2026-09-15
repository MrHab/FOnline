#!/usr/bin/env node
'use strict';

// Доставка Unity WebGL-сборки: кодек предсжатого файла определяется по первым
// байтам, объявляется только принимающему его клиенту, сопровождается Vary и не
// объявляется на частичный запрос. Логика проверяется и на чистых функциях, и
// на живом сервере — временными файлами в public/unity/Build/.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const delivery = require('../src/server/webgl-delivery');

// --- определение кодека -------------------------------------------------------------
const gzipHead = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
const brotliHead = Buffer.from([0x1b, 0x2e, 0x00, 0xf8]);
assert.equal(delivery.sniffUnityWebEncoding(gzipHead), 'gzip');
assert.equal(delivery.sniffUnityWebEncoding(brotliHead), 'br', 'Brotli has no signature, so everything else in .unityweb is brotli.');
assert.equal(delivery.sniffUnityWebEncoding(Buffer.from([0x1f, 0x8b])), '', 'A truncated head declares nothing.');
assert.equal(delivery.sniffUnityWebEncoding(null), '');
// Зарезервированные биты флага у gzip нулевые: иначе это не gzip.
assert.equal(delivery.sniffUnityWebEncoding(Buffer.from([0x1f, 0x8b, 0x08, 0xe0])), 'br');
// Настоящий gzip и настоящий brotli, а не только выдуманные заголовки.
assert.equal(delivery.sniffUnityWebEncoding(zlib.gzipSync(Buffer.from('кромка')).subarray(0, 4)), 'gzip');
assert.equal(delivery.sniffUnityWebEncoding(zlib.brotliCompressSync(Buffer.from('кромка')).subarray(0, 4)), 'br');

assert.equal(delivery.encodingForRequest('/unity/Build/a.data.br'), 'br');
assert.equal(delivery.encodingForRequest('/unity/Build/a.data.gz'), 'gzip');
assert.equal(delivery.encodingForRequest('/unity/Build/a.data.unityweb', gzipHead), 'gzip');
assert.equal(delivery.encodingForRequest('/unity/Build/a.data.unityweb', brotliHead), 'br');
assert.equal(delivery.encodingForRequest('/unity/index.html'), '', 'Plain files carry no pre-compressed codec.');

// --- разбор Accept-Encoding ------------------------------------------------------------
assert.equal(delivery.clientAcceptsEncoding('gzip, deflate, br', 'br'), true);
assert.equal(delivery.clientAcceptsEncoding('gzip, deflate', 'br'), false);
assert.equal(delivery.clientAcceptsEncoding('gzip, br;q=0', 'br'), false, 'q=0 forbids the codec outright.');
assert.equal(delivery.clientAcceptsEncoding('br;q=0.2', 'br'), true);
assert.equal(delivery.clientAcceptsEncoding('*', 'br'), true);
assert.equal(delivery.clientAcceptsEncoding('identity;q=1, *;q=0', 'br'), false);
assert.equal(delivery.clientAcceptsEncoding('br;q=0, *', 'br'), false, 'An explicit entry beats the wildcard.');
assert.equal(delivery.clientAcceptsEncoding('', 'br'), false, 'No header means identity only.');
assert.equal(delivery.clientAcceptsEncoding('gzip, br', ''), false);

// --- итоговые заголовки ответа -----------------------------------------------------------
assert.deepEqual(delivery.unityDeliveryHeaders('/unity/Build/a.wasm.unityweb', brotliHead, { 'accept-encoding': 'gzip, br' }),
  { contentType: 'application/wasm', encoding: 'br', vary: true });
assert.deepEqual(delivery.unityDeliveryHeaders('/unity/Build/a.framework.js.unityweb', gzipHead, { 'accept-encoding': 'gzip' }),
  { contentType: 'application/javascript', encoding: 'gzip', vary: true });
assert.deepEqual(delivery.unityDeliveryHeaders('/unity/Build/a.data.unityweb', brotliHead, { 'accept-encoding': 'gzip' }),
  { contentType: 'application/octet-stream', encoding: '', vary: true },
  'A client without brotli gets the raw file and the Unity loader unpacks it.');
assert.deepEqual(delivery.unityDeliveryHeaders('/unity/Build/a.data.unityweb', brotliHead, { 'accept-encoding': 'br', range: 'bytes=0-99' }),
  { contentType: 'application/octet-stream', encoding: '', vary: true },
  'A byte range of a compressed body cannot be decoded, so no codec is announced.');
assert.deepEqual(delivery.unityDeliveryHeaders('/unity/index.html', null, { 'accept-encoding': 'br' }),
  { contentType: '', encoding: '', vary: false });

// --- крючки сервера -------------------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  "require('./src/server/webgl-delivery')",
  'setHeaders(res, filePath, stat)',
  'function serverUnityBuildEncodingHead(filePath = \'\', stat = null)',
  "requestPath.endsWith('.unityweb') ? serverUnityBuildEncodingHead(filePath, stat) : null",
  "if (delivery.vary) res.setHeader('Vary', 'Accept-Encoding');",
  "if (delivery.encoding) res.setHeader('Content-Encoding', delivery.encoding);"
]) assert(server.includes(needle), `server.js is missing the WebGL delivery contract: ${needle}`);

// --- раздача на VPS ---------------------------------------------------------------------------
// Статику production отдаёт Nginx, поэтому тот же договор записан и в его
// конфигурации: кодек по расширению .unityweb, только принимающему клиенту.
const nginx = read('deploy/nginx/realm-of-ashes.locations.conf');
for (const needle of [
  'location ~* ^/unity/Build/.+\\.wasm\\.unityweb$',
  'location ~* ^/unity/Build/.+\\.js\\.unityweb$',
  'location ~* ^/unity/Build/.+\\.unityweb$',
  'if ($http_accept_encoding ~* "\\bbr\\b")',
  'add_header Content-Encoding "br";',
  'add_header Vary "Accept-Encoding";',
  'default_type application/wasm;'
]) assert(nginx.includes(needle), `The nginx config is missing the WebGL delivery contract: ${needle}`);
assert(!/location \^~ \/unity\/Build\//.test(nginx),
  'The catch-all Build location must stay a plain prefix, otherwise nginx skips the regex locations that set the codec.');
assert((nginx.match(/add_header Content-Encoding "br";/g) || []).length === 3,
  'Only the three .unityweb locations announce the codec: loader.js ships uncompressed.');

// --- живой сервер ------------------------------------------------------------------------------
const h = require('./check-combat-runtime');
const buildDir = path.join(root, 'public', 'unity', 'Build');
const fixtures = [
  { name: '__delivery-check__.data.unityweb', body: zlib.brotliCompressSync(Buffer.from('кромка-данные')), encoding: 'br', type: 'application/octet-stream' },
  { name: '__delivery-check__.framework.js.unityweb', body: zlib.gzipSync(Buffer.from('кромка-загрузчик')), encoding: 'gzip', type: 'application/javascript' }
];

const request = (route, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request(h.baseUrl() + route, { method, headers }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});

(async () => {
  fs.mkdirSync(buildDir, { recursive: true });
  for (const fixture of fixtures) fs.writeFileSync(path.join(buildDir, fixture.name), fixture.body);
  await h.startServer();

  for (const fixture of fixtures) {
    const route = `/unity/Build/${fixture.name}`;

    const announced = await request(route, { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(announced.status, 200);
    assert.equal(announced.headers['content-encoding'], fixture.encoding,
      `${fixture.name}: the codec must be announced to a client that accepts it`);
    assert.equal(announced.headers['content-type'], fixture.type);
    assert.equal(announced.headers['vary'], 'Accept-Encoding');
    assert.equal(announced.headers['cache-control'], 'public, max-age=31536000, immutable');
    // Тело отдаётся ровно как лежит на диске: длина — сжатая, распаковка на стороне браузера.
    assert.equal(Number(announced.headers['content-length']), fixture.body.length);
    assert.deepEqual(announced.body, fixture.body);

    const plain = await request(route, { 'Accept-Encoding': 'identity' });
    assert.equal(plain.headers['content-encoding'], undefined,
      `${fixture.name}: a client without the codec must not be handed an encoded body`);
    assert.equal(plain.headers['vary'], 'Accept-Encoding');
    assert.deepEqual(plain.body, fixture.body, 'The raw file still arrives; the Unity loader unpacks it.');

    const forbidden = await request(route, { 'Accept-Encoding': `gzip, br;q=0` });
    if (fixture.encoding === 'br') assert.equal(forbidden.headers['content-encoding'], undefined, 'q=0 is a ban, not a preference');

    const ranged = await request(route, { 'Accept-Encoding': 'gzip, br', Range: 'bytes=0-3' });
    assert.equal(ranged.headers['content-encoding'], undefined, 'A byte range must never be labelled as encoded');
  }

  console.log('WebGL delivery OK: the codec is sniffed from the file, announced only to clients that accept it, carries Vary, and is withheld from range requests.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await h.stopServer();
  for (const fixture of fixtures) { try { fs.unlinkSync(path.join(buildDir, fixture.name)); } catch (error) { /* уже убран */ } }
  h.cleanupSync();
});
