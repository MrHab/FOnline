'use strict';
// «Характер» НПС удалён из игры.
//
// Он показывался в подсказке осмотра строкой «Характер: Разговорчивый», а из
// его чисел работали только храбрость и дисциплина — они двигали порог, при
// котором НПС отступает. Общительность и черты генерировались, передавались по
// сети и не читались никем. Порог отступления теперь общий и равен прежнему
// значению при нейтральных 50/50.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const sources = [
  ['server.js', read('server.js')],
  ['08d_world_context_targets.js', read('public', 'js', 'game', '08d_world_context_targets.js')],
  ['05e_ground_items_world_sync.js', read('public', 'js', 'game', '05e_ground_items_world_sync.js')],
  ['05f_enemy_models_location_flow.js', read('public', 'js', 'game', '05f_enemy_models_location_flow.js')]
];

for (const [name, source] of sources) {
  assert(!/personality/i.test(source), `${name}: характер НПС вернулся в код`);
}

const server = sources[0][1];
assert(!server.includes('NPC_PERSONALITY_ARCHETYPES'), 'справочник характеров вернулся');
assert(!server.includes('NPC_PERSONALITY_LINES'), 'реплики по характеру вернулись');
for (const label of ['Сдержанный', 'Разговорчивый', 'Настороженный', 'Добродушный', 'Расчетливый']) {
  assert(!server.includes(label), `подпись характера «${label}» вернулась`);
}

// Подсказка осмотра больше не показывает строку характера.
const hint = sources[1][1];
assert(!hint.includes('\\u0425\\u0430\\u0440\\u0430\\u043a\\u0442\\u0435\\u0440'),
  'подсказка снова показывает «Характер»');
assert(!/Характер/.test(hint), 'подсказка снова показывает «Характер»');

// Отступление в бою осталось, но одинаковое для всех.
const retreat = /function enemyRetreatHpRatio\([\s\S]*?\n\}/.exec(server);
assert(retreat, 'НПС перестали отступать при низком здоровье');
assert(!/bravery|discipline/.test(retreat[0]),
  'порог отступления снова зависит от характера');
const ratio = /const ENEMY_RETREAT_HP_RATIO = ([\d.]+);/.exec(server);
assert(ratio, 'порог отступления не задан явным числом');
// 0.12 + (55 - 50) * 0.0032 - (50 - 50) * 0.0012 — прежняя формула при
// нейтральных храбрости и дисциплине.
const neutral = 0.12 + (55 - 50) * 0.0032;
assert(Math.abs(Number(ratio[1]) - neutral) < 0.0005,
  `порог отступления ${ratio[1]} разошёлся с прежним нейтральным ${neutral.toFixed(3)}`);

// Реплики НПС остались, но только по роли.
const speech = /function npcSocialSpeechLine\([\s\S]*?\n\}/.exec(server);
assert(speech, 'НПС перестали переговариваться');
assert(speech[0].includes('NPC_SOCIAL_LINES'), 'реплики по роли пропали вместе с характером');

console.log('NPC personality removed OK: справочников нет, подсказка чистая, отступление общее и равно прежнему нейтральному, реплики по роли остались.');
