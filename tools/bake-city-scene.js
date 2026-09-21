#!/usr/bin/env node
'use strict';

// Разложить город конструктора в авторскую локацию: `node tools/bake-city-scene.js caravanCamp`.
//
// Конструктор городов строит место каждый раз заново, и править его руками
// негде. Эта команда один раз кладёт готовый город в data/locations/<id>.json
// и помечает его `cityAuthored`. Дальше сервер отдаёт файл как есть, а город
// правят в Unity: «Кромка → Собрать город в сцену» разложит его префабами,
// а обычный экспорт сцены вернёт правки в тот же файл.
//
// Обратно город отдаётся конструктору командой с `--undo`.

const fs = require('node:fs');
const path = require('node:path');
const { createZoneRuntime } = require('../src/server/zone-runtime');

const ROOT = path.resolve(__dirname, '..');
const LOCATIONS = path.join(ROOT, 'data', 'locations');
// Слепок хранится не рядом с локациями: файл в data/locations проверки читают
// как ещё одно место мира.
const BACKUPS = path.join(ROOT, 'data', 'kromka', 'city-backups');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function usage(message) {
  console.error(message);
  console.error('Использование: node tools/bake-city-scene.js <город> [--undo]');
  console.error('Города: settlement, scrapTown, relayStation, caravanCamp, secondHaven, balanceBunker, sluiceCity');
  process.exit(1);
}

const cityId = String(process.argv[2] || '').trim();
const undo = process.argv.includes('--undo');
if (!cityId) usage('Не указан город.');

const file = path.join(LOCATIONS, `${cityId}.json`);
if (!fs.existsSync(file)) usage(`Нет файла локации ${cityId}.json.`);

const runtime = createZoneRuntime({
  graph: readJson(path.join(ROOT, 'data', 'kromka', 'zone-graph.json')),
  zonesDir: path.join(ROOT, 'data', 'zones')
});
const authored = readJson(file);

if (undo) {
  if (authored.cityAuthored !== true) usage(`${cityId} и так строится конструктором.`);
  const backup = path.join(BACKUPS, `${cityId}.json`);
  if (!fs.existsSync(backup)) usage(`Нет слепка data/kromka/city-backups/${cityId}.json: вернуть авторское содержимое нечем.`);
  const previous = readJson(backup);
  writeJson(file, previous);
  fs.unlinkSync(backup);
  console.log(`${cityId}: город снова строится конструктором, авторское содержимое возвращено из слепка.`);
  process.exit(0);
}

if (authored.cityAuthored === true) usage(`${cityId} уже авторский: правьте сцену и экспортируйте её.`);

const built = runtime.cityDefinition(cityId, authored, []);
if (!built) usage(`${cityId} — не город: конструктор его не строит.`);

// Слепок авторского содержимого: по нему город возвращают конструктору.
fs.mkdirSync(BACKUPS, { recursive: true });
writeJson(path.join(BACKUPS, `${cityId}.json`), authored);

// Город как обычная локация: генератор больше не участвует, поэтому его
// пометки снимаем, а `cityAuthored` говорит серверу отдавать файл как есть.
// Авторские поля, которых конструктор не знает: сцена локации, её точки
// появления и прежние входы — без них место теряет связь со сценой Unity.
const carried = {};
// `exit` сюда не входит: город занимает сектор целиком, и выходят из него краем,
// а не старой дорогой в пустошь — конструктор её тоже не переносит.
for (const key of ['unityScene', 'unitySpawns', 'city', 'entry', 'entryFromWasteland',
  'pvp', 'fullDrop', 'updatedAt']) {
  if (authored[key] !== undefined) carried[key] = authored[key];
}
const objectsForScene = (built.objects || []).map(row => {
  const copy = { ...row };
  delete copy.collisionSize;
  return copy;
});
const baked = { ...built, ...carried, objects: objectsForScene, cityAuthored: true, generated: false };
delete baked.builderVersion;
writeJson(file, baked);

const objects = Array.isArray(baked.objects) ? baked.objects : [];
const npcs = objects.filter(row => String(row?.entity?.kind || '') === 'npc').length;
console.log(`${cityId}: в файл локации разложено ${objects.length} объектов (${npcs} живых NPC сервер ставит сам).`);
console.log(`Слепок прежнего содержимого: data/kromka/city-backups/${cityId}.json`);
console.log('Дальше: Unity → «Кромка → Собрать город в сцену», правьте руками, затем обычный экспорт сцены.');
