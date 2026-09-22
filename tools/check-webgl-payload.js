#!/usr/bin/env node
'use strict';

// Вес WebGL-сборки. Всё, что лежит в Assets/Resources, попадает в player data
// целиком, а GLB при импорте разворачивается в несжатые текстуры: файл на 4 МБ
// весит в сборке 37 МБ. Поэтому в каталоге Resources держится по телу
// персонажа на каждый пол и библиотека анимаций, твари грузятся по URL, а текстурам
// художественных паков поставлен предел размера для WebGL.
//
// Проверка следит, чтобы это не отъехало обратно: .meta художественных паков в
// git не входят, и единственная гарантия — постпроцессор импорта в репозитории.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// --- каталог Resources ---------------------------------------------------------------
const catalog = read('unity-client/Assets/Resources/RealmOfAshes/GlobalMapModelPrefabs.asset');
const entries = catalog.match(/^\s+- sourceUrl: (.+)$/gm) || [];
const urls = entries.map(row => row.replace(/^\s+- sourceUrl:\s*/, '').trim());
assert.equal(urls.length, 3, `в каталоге Resources должно быть 3 записи, найдено ${urls.length}`);
assert(urls.every(url => url.includes('/characters/')),
  'в каталоге остаются только тела персонажа и анимации: ' + urls.filter(url => !url.includes('/characters/')).join(', '));
assert(!catalog.includes('/wasteland/'),
  'твари не возвращаются в Resources: в облегчённом виде они весят 0,4–2,8 МБ и грузятся по URL');

const generator = read('unity-client/Assets/Editor/RoaModelPrefabGenerator.cs');
const generatorList = generator.slice(generator.indexOf('BuildRuntimeModelUrls'));
assert(!/\/assets\/models\/wasteland\//.test(generatorList),
  'генератор каталога не должен снова добавлять тварей в Resources');
assert(generatorList.includes('/assets/models/characters/npc/npc_humanoid_animations.glb'),
  'библиотека анимаций обязана остаться в каталоге: она нужна каждому персонажу сразу');

const probe = read('unity-client/Assets/Editor/RoaModelPrefabCatalogProbe.cs');
assert(/ExpectedRuntimeCount\s*=\s*3\b/.test(probe), 'проба каталога должна ожидать 3 записи');

// --- путь загрузки тварей по URL ------------------------------------------------------
const enemies = read('unity-client/Assets/Scripts/Game/RoaEnemies.cs');
assert(enemies.includes('LoadModelGuarded(enemy, url)'),
  'твари в комнате грузятся по URL — этот путь и держит их модели вне сборки');
const cinematic = read('unity-client/Assets/Scripts/Game/RoaCaravanAmbushStage.cs');
assert(cinematic.includes('brahminImport = new GltfImport()') && cinematic.includes('RoaModelUrl.Lite('),
  'караванная кат-сцена обязана уметь грузить брамина по URL, а не падать без префаба');
assert(!cinematic.includes('The bundled brahmin prefab is missing.'),
  'жёсткого требования префаба брамина быть не должно');

// --- бюджет текстур -------------------------------------------------------------------
const budget = read('unity-client/Assets/Editor/RoaWebGlTextureBudget.cs');
for (const token of [
  'class RoaWebGlTextureBudget : AssetPostprocessor',
  'public const int MaxTextureSize = 1024',
  'private void OnPreprocessTexture()',
  'public static int OverBudgetCount',
  '"Assets/MEP"'
]) assert(budget.includes(token), `постпроцессор бюджета текстур неполон: ${token}`);
const build = read('unity-client/Assets/Editor/RoaWebGlBuild.cs');
assert(build.includes('RoaWebGlTextureBudget.OverBudgetCount()') && build.includes('"textureBudget"'),
  'чек сборки обязан записывать бюджет текстур и число нарушителей');

console.log('WebGL payload OK: Resources держит только персонажей, твари и брамин кат-сцены грузятся по URL, бюджет текстур закреплён постпроцессором и виден в чеке сборки.');
