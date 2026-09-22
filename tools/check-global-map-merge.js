'use strict';
// Глобальная карта обязана доезжать до уже работающих серверов.
//
// Локации сервер собирает как «поставка + правки оператора», а карта читалась
// иначе: файл из DATA_DIR побеждал целиком. Из-за этого добавленная столица
// вольных караванов не появлялась на развёрнутом сервере — без узла нет ни
// круга локации, ни подписи, и войти в неё нельзя.
//
// Обратная сторона: сервер писал в файл карты свою нормализованную копию, и
// простой запуск без DATA_DIR портил авторский data/global-map.json — railway и
// service_tunnel становились road, ширины дорог 2, `hidden: false` пропадал.
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { mergeAuthoredGlobalMap, MERGED_COLLECTIONS, resolveGlobalMapFile } = require('../src/server/global-map-merge');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

// --- Слияние: новое добавляется, правки оператора сохраняются ---
const stored = {
  nodes: [{ id: 'settlement', x: 255, y: 615, note: 'правка оператора' }],
  infrastructure: [{ id: 'road_a' }],
  cells: { keep: true }
};
const bundled = {
  nodes: [
    { id: 'settlement', x: 195, y: 690, note: 'из поставки' },
    { id: 'caravanCamp', x: 495, y: 495 }
  ],
  infrastructure: [{ id: 'road_a' }, { id: 'road_b' }],
  cells: {}
};
const merged = mergeAuthoredGlobalMap(stored, bundled);

assert.strictEqual(merged.nodes.length, 2, 'новый узел из поставки не подмешался');
const settlement = merged.nodes.find(row => row.id === 'settlement');
assert.strictEqual(settlement.x, 255, 'слияние перетёрло координаты оператора');
assert.strictEqual(settlement.y, 615, 'слияние перетёрло координаты оператора');
assert.strictEqual(settlement.note, 'правка оператора', 'слияние перетёрло правку оператора');
assert(merged.nodes.some(row => row.id === 'caravanCamp'), 'новая столица не появилась');
assert.strictEqual(merged.infrastructure.length, 2, 'новая инфраструктура не подмешалась');
assert.deepStrictEqual(merged.cells, { keep: true }, 'слияние затронуло поля вне списка коллекций');

assert.deepStrictEqual(mergeAuthoredGlobalMap(null, bundled), bundled, 'без сохранённой карты берётся поставка');
assert.deepStrictEqual(mergeAuthoredGlobalMap(stored, null), stored, 'без поставки остаётся сохранённая карта');
for (const key of MERGED_COLLECTIONS) {
  assert(Array.isArray(merged[key]), `коллекция ${key} после слияния не массив`);
}

// A major authored-world replacement must not retain the previous grid or
// coordinates. Account/character saves are migrated separately by worldRevision.
const legacyMap = {
  version: 1,
  grid: { cols: 30, rows: 30, cellPoints: 30, cellKm: 10 },
  nodes: [{ id: 'settlement', x: 195, y: 705 }]
};
const kromkaMap = {
  version: 2,
  worldRevision: 'kromka-1',
  unityScene: 'Assets/Scenes/Kromka/KromkaGlobalMap.unity',
  grid: { cols: 38, rows: 30, cellPoints: 10, cellKm: 10 },
  nodes: [{ id: 'settlement', x: 95, y: 205 }]
};
assert.deepStrictEqual(mergeAuthoredGlobalMap(legacyMap, kromkaMap), kromkaMap,
  'новая версия авторского мира смешалась со старой сеткой и координатами');

// --- Файл карты: поставку сервер не переписывает, копия DATA_DIR — без потерь ---
// Значения, которые нормализация в памяти сервера меняет: тип линии railway и
// service_tunnel, ширина меньше 2 точек, явный `hidden: false`.
const authoredLines = {
  version: 3,
  nodes: [{ id: 'keys', x: 10, y: 20, hidden: false }, { id: 'base', x: 30, y: 40, hidden: true }],
  infrastructure: [
    { id: 'ore_rail', type: 'railway', width: 0.7 },
    { id: 'zero_line', type: 'service_tunnel', width: 0.5 }
  ]
};
let resolved = resolveGlobalMapFile({ stored: null, bundled: authoredLines, isBundledFile: true });
assert.strictEqual(resolved.persist, null, 'сервер переписывает файл поставки data/global-map.json');
assert.deepStrictEqual(resolved.map, authoredLines, 'без DATA_DIR сервер читает не поставку');

resolved = resolveGlobalMapFile({ stored: clone(authoredLines), bundled: authoredLines });
assert.strictEqual(resolved.persist, null, 'сервер переписывает копию DATA_DIR, в которую нечего добавить');

resolved = resolveGlobalMapFile({ stored: null, bundled: authoredLines });
assert.deepStrictEqual(resolved.persist, authoredLines, 'новая копия DATA_DIR отличается от поставки');

const operatorCopy = clone(authoredLines);
operatorCopy.nodes = [{ ...operatorCopy.nodes[0], x: 12 }];
operatorCopy.infrastructure = operatorCopy.infrastructure.slice(1);
resolved = resolveGlobalMapFile({ stored: operatorCopy, bundled: authoredLines });
assert.deepStrictEqual(resolved.persist, {
  ...operatorCopy,
  nodes: [...operatorCopy.nodes, authoredLines.nodes[1]],
  infrastructure: [...operatorCopy.infrastructure, authoredLines.infrastructure[0]]
}, 'дописанная копия DATA_DIR потеряла авторские значения или правку оператора');
assert.deepStrictEqual(resolved.map, resolved.persist, 'сервер держит в памяти не то, что записал в копию');
assert.deepStrictEqual(resolveGlobalMapFile({ stored: legacyMap, bundled: kromkaMap }).persist, kromkaMap,
  'копия DATA_DIR со старой версией мира не заменилась поставкой');

// --- Нормализация узла не теряет принадлежность столицы ---
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
for (const field of ['locationId:', 'capital:', 'capitalFaction:']) {
  assert(server.includes(field),
    `нормализация узла снова теряет поле ${field.replace(':', '')}`);
}

// --- Каждый город на карте должен быть входимым и подписанным ---
const globalMap = readJson('data/global-map.json');
const locationFiles = new Set(
  fs.readdirSync(path.join(ROOT, 'data', 'locations'))
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
);
const settlements = (globalMap.nodes || []).filter(node => String(node?.kind || '') === 'settlement');
assert(settlements.length >= 4, `на карте только ${settlements.length} городов`);
for (const node of settlements) {
  const id = String(node.id || '');
  assert(locationFiles.has(id),
    `город "${id}" не имеет файла локации: в него нельзя войти и его нечем подписать`);
  const location = readJson(`data/locations/${id}.json`);
  assert(String(location.name || '').trim(),
    `город "${id}" не имеет названия — подпись на карте будет пустой`);
}

// --- Настоящий сервер со своим DATA_DIR ---
// Копия, совпадающая с поставкой, остаётся байт в байт. В отставшую копию
// сервер дописывает строки поставки как есть, правки оператора остаются.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-global-map-'));
const running = new Set();
process.once('exit', () => {
  for (const proc of running) {
    try { proc.kill('SIGKILL'); } catch (_) {}
  }
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_) {}
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function healthStatus(port) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 1500 }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
  });
}

async function stopServer(proc) {
  if (proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise(resolve => proc.once('exit', resolve));
    proc.kill('SIGTERM');
    if (!await Promise.race([exited.then(() => true), delay(2000).then(() => false)])) {
      proc.kill('SIGKILL');
      await Promise.race([exited, delay(1000)]);
    }
  }
  running.delete(proc);
}

// DATA_DIR с одним файлом карты; файл сервер пишет до того, как слушает порт.
async function mapFileAfterServerStart(label, mapText) {
  const dataDir = path.join(TMP_ROOT, label);
  fs.mkdirSync(dataDir, { recursive: true });
  const mapFile = path.join(dataDir, 'global-map.json');
  fs.writeFileSync(mapFile, mapText, 'utf8');
  let logs = '';
  const proc = childProcess.spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      DEV_API_MODE: 'disabled',
      DEV_ADMIN_TOKEN: '',
      WASTELAND_SIM_TICK_MS: '600000',
      WASTELAND_SIM_SAVE_INTERVAL_MS: '600000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  running.add(proc);
  proc.stdout.on('data', chunk => { logs += chunk; });
  proc.stderr.on('data', chunk => { logs += chunk; });
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 60000) {
      assert(proc.exitCode === null, `${label}: сервер завершился до /health\n${logs.slice(-4000)}`);
      const port = Number(logs.match(/server listening on :(\d+)/)?.[1] || 0);
      if (port && await healthStatus(port) === 200) return fs.readFileSync(mapFile, 'utf8');
      await delay(100);
    }
    throw new Error(`${label}: сервер не ответил на /health\n${logs.slice(-4000)}`);
  } finally {
    await stopServer(proc);
  }
}

async function checkServerMapFile() {
  const bundledText = fs.readFileSync(path.join(ROOT, 'data', 'global-map.json'), 'utf8');
  const bundled = JSON.parse(bundledText);
  const stale = clone(bundled);
  stale.nodes = stale.nodes.slice(0, -1);
  stale.nodes[0].note = 'правка оператора';
  stale.infrastructure = [...stale.infrastructure.slice(0, -1), {
    id: 'operator_spur',
    name: 'Ветка оператора',
    type: 'railway',
    model: 'rail',
    walkable: true,
    travelFactor: 0.55,
    allowCrossingsWith: [],
    width: 0.5,
    points: [{ x: 100, y: 100 }, { x: 120, y: 110 }]
  }];
  const [sameText, staleText] = await Promise.all([
    mapFileAfterServerStart('same-as-bundled', bundledText),
    mapFileAfterServerStart('stale-operator-copy', JSON.stringify(stale, null, 2))
  ]);
  assert.strictEqual(sameText, bundledText, 'сервер переписал копию DATA_DIR, в которую нечего добавить');
  assert.deepStrictEqual(JSON.parse(staleText), {
    ...stale,
    nodes: [...stale.nodes, bundled.nodes[bundled.nodes.length - 1]],
    infrastructure: [...stale.infrastructure, bundled.infrastructure[bundled.infrastructure.length - 1]]
  }, 'сервер записал в копию DATA_DIR нормализованную карту или не дописал строки поставки');
}

checkServerMapFile().then(() => {
  console.log(`Global map merge OK: ${settlements.length} городов, все входимы и подписаны; поставка подмешивается без потери правок, файл поставки сервер не переписывает, копию DATA_DIR пишет без нормализации.`);
}).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
