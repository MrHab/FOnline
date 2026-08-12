'use strict';
// Выход из локации на глобальную карту.
//
// Клиент открывал карту оптимистично, до подтверждения сервера. Цикл
// обновления после этого выходил досрочно и переставал отправлять позицию —
// а именно её сервер ждёт, чтобы согласиться, что игрок дошёл до края.
// Получалась взаимная блокировка: сервер отказывал по устаревшей позиции,
// клиент откатывал состояние, следующий кадр повторял запрос. Системный
// журнал заполнялся строкой о выходе, а на карту игрок так и не попадал.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '12b_global_map_panel_window.js'), 'utf8');
const loop = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '09_update_fog_movement_ai.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// --- Позиция обязана уходить на сервер и в кадре выхода ---
const edgeBranchStart = loop.indexOf('updateWorldMapEdgeExit()) {');
assert(edgeBranchStart > 0, 'не найдена ветка выхода на карту в цикле обновления');
const edgeBranchEnd = loop.indexOf('\n    }', edgeBranchStart);
const edgeBranch = loop.slice(edgeBranchStart, edgeBranchEnd);
assert(edgeBranch.includes('sendMultiplayerState(dt)'),
  'кадр выхода на карту снова не отправляет позицию: сервер не узнает, что игрок дошёл до края, '
  + 'и будет отказывать бесконечно');

// --- Повторные попытки не должны идти каждый кадр ---
assert(panel.includes('globalMapExitRequestPending'),
  'нет защиты от параллельных запросов выхода на карту');
assert(panel.includes('globalMapExitRetryAt'),
  'нет паузы между попытками выхода после отказа сервера');
assert(panel.includes('if (globalMapExitRequestPending || nowSeconds() < globalMapExitRetryAt) return false;'),
  'запрос выхода снова отправляется каждый кадр');
assert(panel.includes('globalMapExitRetryAt = nowSeconds() + GLOBAL_MAP_EXIT_RETRY_DELAY;'),
  'отказ сервера больше не назначает паузу перед повтором');

const delayMatch = /const GLOBAL_MAP_EXIT_RETRY_DELAY = ([0-9.]+);/.exec(panel);
assert(delayMatch, 'не найдена длительность паузы между попытками');
const delay = Number(delayMatch[1]);
assert(delay >= 0.3 && delay <= 3, `пауза между попытками ${delay} с вне разумных границ`);

// --- Журнал пишется только по факту выхода ---
const failBranchStart = panel.indexOf('if (ack?.ok === false) {');
assert(failBranchStart > 0, 'не найдена ветка отказа сервера');
const failBranchEnd = panel.indexOf('return;', failBranchStart);
assert(failBranchEnd > failBranchStart, 'не найден выход из ветки отказа');
assert(!panel.slice(failBranchStart, failBranchEnd).includes('announceGlobalMapEntry'),
  'отказ сервера снова пишет в журнал сообщение об успешном выходе');
assert(panel.indexOf('announceGlobalMapEntry()', failBranchEnd) > failBranchEnd,
  'после подтверждения сервера выход не отмечается в журнале');
assert(panel.includes('if (!online) announceGlobalMapEntry();'),
  'в автономном режиме выход на карту перестал отмечаться в журнале');

const announceSource = panel.slice(panel.indexOf('function announceGlobalMapEntry'));
const logCalls = (panel.match(/addLog\('Вы вышли на глобальную карту/g) || []).length;
assert.strictEqual(logCalls, 1,
  'сообщение о выходе пишется в журнал в обход announceGlobalMapEntry');
assert(announceSource.includes("addLog('Вы вышли на глобальную карту"),
  'announceGlobalMapEntry перестала писать сообщение о выходе');

// --- Серверная сторона осталась строгой ---
assert(server.includes('if (!leader || !leader.roomId || leader.dead'),
  'сервер больше не отклоняет выход игрока, уже покинувшего локацию');
assert(server.includes("if (!serverPlayerAtGlobalMapExit(leader)) return fail('Сначала дойдите до границы локации.')"),
  'сервер перестал проверять, что игрок стоит у края локации');

console.log(
  `Global map exit OK: позиция уходит в кадре выхода, повтор не чаще ${delay} с, `
  + 'журнал пишется один раз по подтверждению.'
);
