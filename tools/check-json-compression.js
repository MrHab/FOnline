'use strict';
// Крупные JSON-ответы обязаны уходить сжатыми.
//
// Симуляция пустоши отдавалась без сжатия — около 925 КБ на боевом сервере,
// а клиент на глобальной карте опрашивает её каждые 5 секунд. Получалось
// ~185 КБ/с постоянного трафика: канал забивался, и по таймауту отваливались
// ассеты, сохранение персонажа и сама симуляция.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const globalMapConfig = fs.readFileSync(path.join(ROOT, 'data', 'global-map.json'), 'utf8');

// --- Проводка сжатия ---
assert(server.includes("const zlib = require('zlib');"), 'server.js больше не подключает zlib');
assert(server.includes('function gzipJsonBuffer('), 'нет помощника сжатия JSON');
assert(server.includes('function sendJsonBuffer('), 'нет отправки JSON с учётом сжатия');
assert(server.includes("res.setHeader('Content-Encoding', 'gzip')"), 'ответ больше не помечается как сжатый');
assert(server.includes("res.setHeader('Vary', 'Accept-Encoding')"),
  'без Vary промежуточные кэши будут отдавать сжатый ответ клиенту, который его не понимает');
assert(/\/bgzip\\b\/i\.test/.test(server) || server.includes("headers?.['accept-encoding']"),
  'сжатие отправляется без проверки того, что клиент его принимает');

for (const [route, label] of [
  ["app.get('/api/wasteland'", 'симуляция пустоши'],
  ["app.get('/api/global-map'", 'глобальная карта']
]) {
  const start = server.indexOf(route);
  assert(start > 0, `не найден маршрут: ${label}`);
  const body = server.slice(start, server.indexOf('});', start));
  assert(body.includes('sendJsonBuffer('), `${label} отдаётся в обход сжатия`);
}

// Сжатая копия считается на срок жизни кэша, а не на каждый запрос.
assert(server.includes('gzip: gzipJsonBuffer(body)'), 'сжатая копия симуляции больше не кэшируется');
assert(server.includes('globalMapResponseCache'), 'ответ глобальной карты больше не кэшируется');
assert(server.includes('invalidateGlobalMapResponseCache()'),
  'правка карты через редактор не сбрасывает кэш ответа — клиенты получат устаревшую карту');

// --- Выигрыш действительно есть ---
const compressed = zlib.gzipSync(Buffer.from(globalMapConfig, 'utf8'), { level: zlib.constants.Z_BEST_SPEED });
const ratio = globalMapConfig.length / compressed.length;
assert(ratio > 4,
  `сжатие даёт всего ${ratio.toFixed(1)}x — проверьте, что ответы остались текстовым JSON`);

const minBytes = /const JSON_GZIP_MIN_BYTES = (\d+);/.exec(server);
assert(minBytes, 'не найден порог, ниже которого сжимать невыгодно');
assert(Number(minBytes[1]) >= 1024 && Number(minBytes[1]) <= 16384,
  `порог сжатия ${minBytes[1]} байт вне разумных границ`);

console.log(
  `JSON compression OK: маршруты симуляции и карты сжимаются, `
  + `выигрыш на данных карты ${ratio.toFixed(1)}x, порог ${minBytes[1]} байт.`
);
