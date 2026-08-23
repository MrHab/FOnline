'use strict';
// Восстановление связи и выход к выбору персонажа.
//
// После обрыва игрок оставался в мире, где на любое действие отвечает «связь
// восстанавливается». Единственной надеждой был socket.io: он поднимет
// соединение и сокет сам попросится в комнату. Но сразу после обрыва сервер
// отказывает — прошлый сокет числится живым до ping-таймаута, — а отказ
// сбрасывал намерение войти, и попытки прекращались навсегда. Выйти из этого
// состояния было нечем.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const socket = read('public', 'js', 'game', '05c_multiplayer_socket_room.js');
const bootstrap = read('public', 'js', 'game', '01_bootstrap_online_save.js');

// --- Надзор за переподключением ---
const begin = /function beginMultiplayerRecovery\([\s\S]*?\n  \}/.exec(socket);
assert(begin, 'нет запуска восстановления связи');
assert(/if \(!gameStarted \|\| !serverSession\.token \|\| !selectedServerCharacterId\) return false;/.test(begin[0]),
  'восстановление запускается вне игры — на экране входа восстанавливать нечего');

const attempt = /async function runMultiplayerRecoveryAttempt\([\s\S]*?\n  \}/.exec(socket);
assert(attempt, 'нет самой попытки восстановления');
assert(attempt[0].includes('multiplayer.joinRequested = true'),
  'попытка не возвращает намерение войти: после отказа сервера сокет сам в комнату не попросится');
assert(attempt[0].includes("connectMultiplayer({ waitForJoin: true"),
  'попытка не дожидается входа в комнату и посчитает успехом голое соединение');
assert(/\['rejected', 'session'\]\.includes\(multiplayerJoinFailureReason\(\)\)/.test(attempt[0]),
  'окончательный отказ сервера не отличается от временного и будет повторяться впустую');

// --- Расписание попыток и крайний срок ---
const delays = /const RECOVERY_ATTEMPT_DELAYS = \[([^\]]*)\]/.exec(socket);
assert(delays, 'нет расписания попыток восстановления');
const steps = delays[1].split(',').map(value => Number(value.trim())).filter(Number.isFinite);
assert(steps.length >= 4, 'слишком мало попыток, короткий обрыв не переживём');
const budget = steps.reduce((sum, value) => sum + value, 0);
// Сервер снимает блокировку прошлой сессии по ping-таймауту socket.io —
// это десятки секунд, попытки должны их перекрывать.
assert(budget >= 30000, `суммарный срок ${budget} мс меньше времени жизни блокировки прошлой сессии`);
assert(budget <= 120000, `суммарный срок ${budget} мс слишком долгий: игрок будет сидеть в мёртвом мире`);
const schedule = /function scheduleMultiplayerRecoveryAttempt\([\s\S]*?\n  \}/.exec(socket);
assert(schedule, 'нет расписания попыток');
assert(schedule[0].includes('dropToCharacterSelect('),
  'по истечении срока игрок остаётся в заблокированном мире вместо главного меню');
assert(/setReadout\(`Переподключение к серверу/.test(schedule[0]),
  'игрок не видит, что идёт переподключение, и решит, что игра зависла');

// --- Подключено ко всем обрывам ---
for (const [event, hint] of [
  ["setOnlineStatus('Сеть: отключено от сервера');", 'обрыв соединения'],
  ['setOnlineStatus(`Сеть: ошибка подключения', 'ошибка подключения']
]) {
  const index = socket.indexOf(event);
  assert(index >= 0, `не найден обработчик: ${hint}`);
  const tail = socket.slice(index, index + 200);
  assert(tail.includes('beginMultiplayerRecovery()'),
    `после «${hint}» восстановление не запускается`);
}
assert(socket.includes('if (joinRejectionIsTemporary(data?.code)) {\n        beginMultiplayerRecovery();'),
  'временная занятость после обрыва не пережидается восстановлением');

// --- Успешный вход снимает надзор ---
assert(/resolveMultiplayerJoinWaiters\(true\);\s*\n\s*stopMultiplayerRecovery\(\);/.test(socket),
  'после успешного входа надзор продолжает дёргать переподключение');

// --- Возврат к выбору персонажа ---
const drop = /async function dropToCharacterSelect\([\s\S]*?\n  \}/.exec(bootstrap);
assert(drop, 'нет возврата к выбору персонажа');
assert(drop[0].includes('gameStarted = false'), 'мир остаётся запущенным после выхода в меню');
assert(drop[0].includes("classList.add('visible')"), 'экран выбора персонажа не показывается');
assert(drop[0].includes('showCharacterSelect('), 'список персонажей не перечитывается');
assert(!drop[0].includes("setServerSession('', '')"),
  'выход к персонажам не должен разлогинивать аккаунт: игроку пришлось бы вводить пароль заново');
assert(drop[0].includes('multiplayer.joinRequested = false'),
  'намерение войти остаётся, и мёртвый сокет попробует вернуться в мир после выхода в меню');

// --- Недействительная сессия больше не тупик ---
const invalid = bootstrap.indexOf('Сессия персонажа недействительна');
assert(invalid >= 0, 'пропала обработка недействительной сессии');
const invalidTail = bootstrap.slice(invalid, invalid + 600);
assert(invalidTail.includes('beginMultiplayerRecovery()'),
  'при недействительной сессии не делается ни одной попытки восстановления');
assert(invalidTail.includes('dropToCharacterSelect('),
  'при недействительной сессии игроку по-прежнему только советуют выйти самому');

console.log(`Reconnect supervisor OK: ${steps.length} попыток за ${Math.round(budget / 1000)} с, затем возврат к выбору персонажа; окончательный отказ выводит сразу.`);
