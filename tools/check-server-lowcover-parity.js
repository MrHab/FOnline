// Паритет низких укрытий: серверные нормализованные ключи авторских объектов
// обязаны зеркалить клиентский LOW_BALLISTIC_COVER_MODELS (не удалённые GLB),
// иначе клиент разрешает выстрел поверх укрытия, а сервер отвечает
// «Линия атаки перекрыта».
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const failures = [];

const clientSrc = fs.readFileSync(path.join(ROOT, 'public/js/game/02a_materials_static_models.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const clientSetMatch = clientSrc.match(/LOW_BALLISTIC_COVER_MODELS = new Set\(\[([\s\S]*?)\]\)/);
if (!clientSetMatch) failures.push('клиент: не найден LOW_BALLISTIC_COVER_MODELS в 02a_materials_static_models.js');
const clientKeys = (clientSetMatch ? clientSetMatch[1] : '').match(/'([^']+)'/g)?.map(s => s.slice(1, -1)) || [];

const normalizeKey = key => key.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
const expectedKeys = new Set(clientKeys.map(normalizeKey));
const serverSetMatch = serverSrc.match(/SERVER_LOW_BALLISTIC_COVER_MODEL_KEYS = new Set\(\[([\s\S]*?)\]\)/);
if (!serverSetMatch) failures.push('сервер: не найден SERVER_LOW_BALLISTIC_COVER_MODEL_KEYS в server.js');
const serverKeys = new Set(((serverSetMatch ? serverSetMatch[1] : '').match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)));
for (const key of expectedKeys) {
  if (!serverKeys.has(key)) failures.push(`сервер: в whitelist нет ${key} (есть у клиента)`);
}
for (const key of serverKeys) {
  if (!expectedKeys.has(key)) failures.push(`сервер: лишний ${key} (нет у клиента)`);
}
const classifier = serverSrc.match(/function serverBlockerIsLowBallisticCover\(blocker = \{\}\) \{[\s\S]*?\n\}/);
if (!classifier) failures.push('сервер: не найден классификатор авторского укрытия');
else {
  const context = vm.createContext({ SERVER_LOW_BALLISTIC_COVER_MODEL_KEYS: serverKeys });
  vm.runInContext(classifier[0], context);
  for (const key of clientKeys) {
    for (const modelRef of [key, key.replace(/([A-Z])/g, '_$1')]) {
      if (!context.serverBlockerIsLowBallisticCover({ modelRef })) failures.push(`сервер: не распознано укрытие ${modelRef}`);
    }
  }
  for (const modelRef of ['', 'unknownCover', 'concreteWall']) {
    if (context.serverBlockerIsLowBallisticCover({ modelRef })) failures.push(`сервер: ошибочно пропускает ${modelRef}`);
  }
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
console.log(`[check-server-lowcover-parity] OK (${expectedKeys.size} ключей, клиент и сервер совпадают; классификатор проверен)`);
