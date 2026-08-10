// Паритет низких укрытий: серверный SERVER_LOW_BALLISTIC_COVER_MODEL_FILES
// обязан зеркалить клиентский LOW_BALLISTIC_COVER_MODELS (по именам GLB),
// иначе клиент разрешает выстрел поверх укрытия, а сервер отвечает
// «Линия атаки перекрыта».
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const failures = [];

const clientSrc = fs.readFileSync(path.join(ROOT, 'public/js/game/02a_materials_static_models.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const clientSetMatch = clientSrc.match(/LOW_BALLISTIC_COVER_MODELS = new Set\(\[([\s\S]*?)\]\)/);
if (!clientSetMatch) failures.push('клиент: не найден LOW_BALLISTIC_COVER_MODELS в 02a_materials_static_models.js');
const clientKeys = (clientSetMatch ? clientSetMatch[1] : '').match(/'([^']+)'/g)?.map(s => s.slice(1, -1)) || [];

const urlBlockMatch = clientSrc.match(/STATIC_MODEL_URLS = \{([\s\S]*?)\n  \};/);
const urlMap = {};
if (urlBlockMatch) {
  for (const m of urlBlockMatch[1].matchAll(/(\w+):\s*'([^']+\.glb)'/g)) {
    urlMap[m[1]] = m[2].split('/').pop().toLowerCase();
  }
} else {
  failures.push('клиент: не найден STATIC_MODEL_URLS в 02a_materials_static_models.js');
}

function toSnakeFile(key) {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase() + '.glb';
}

const expectedFiles = new Set();
for (const key of clientKeys) {
  expectedFiles.add(urlMap[key] || toSnakeFile(key));
}

const serverSetMatch = serverSrc.match(/SERVER_LOW_BALLISTIC_COVER_MODEL_FILES = new Set\(\[([\s\S]*?)\]\)/);
if (!serverSetMatch) failures.push('сервер: не найден SERVER_LOW_BALLISTIC_COVER_MODEL_FILES в server.js');
const serverFiles = new Set(((serverSetMatch ? serverSetMatch[1] : '').match(/'([^']+)'/g) || []).map(s => s.slice(1, -1).toLowerCase()));

for (const file of expectedFiles) {
  if (!serverFiles.has(file)) failures.push(`сервер: в whitelist нет ${file} (есть у клиента)`);
}
for (const file of serverFiles) {
  if (!expectedFiles.has(file)) failures.push(`сервер: лишний ${file} (нет у клиента)`);
}

if (!/ignoreLowCover:\s*!opts\.shooterCrouching/.test(serverSrc)) {
  failures.push('сервер: serverLineOfFireClearFrom не передаёт ignoreLowCover: !opts.shooterCrouching');
}
if (!/opts\.ignoreLowCover && serverBlockerIsLowBallisticCover\(blocker\)/.test(serverSrc)) {
  failures.push('сервер: roomStaticCollisionBlocksSegment не пропускает низкие укрытия при ignoreLowCover');
}
if (!/ignoreLowCover:\s*!player\.crouching/.test(fs.readFileSync(path.join(ROOT, 'public/js/game/06c_combat_stats_modes.js'), 'utf8'))) {
  failures.push('клиент: blockingDistanceOnRay потерял ignoreLowCover: !player.crouching');
}

if (failures.length) {
  console.error('[check-server-lowcover-parity] FAIL');
  failures.forEach(msg => console.error(' -', msg));
  process.exit(1);
}
console.log(`[check-server-lowcover-parity] OK (${expectedFiles.size} моделей, клиент и сервер совпадают)`);
