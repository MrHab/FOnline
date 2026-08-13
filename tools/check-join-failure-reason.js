'use strict';
// Почему не удалось войти в игру, и что клиент с этим делает.
//
// Раньше любая неудача входа — потерянный пакет, мёртвая сеть, отказ сервера —
// показывалась одним текстом «Сервер не разрешил открыть этого персонажа.
// Возможно, он уже открыт в другой вкладке». Игрок шёл искать вторую вкладку
// вместо того, чтобы чинить связь. Причина должна доезжать до сообщения, а
// временные состояния — переживаться повтором, а не ошибкой.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const server = read('server.js');
const core = read('public', 'js', 'game', '05_multiplayer_core_state.js');
const socket = read('public', 'js', 'game', '05c_multiplayer_socket_room.js');
const bootstrap = read('public', 'js', 'game', '01_bootstrap_online_save.js');
const creation = read('public', 'js', 'game', '08_character_creation_save.js');

// --- Сервер называет причину отказа кодом ---
assert(/function rejectJoin\(socket, ack, error, code = ''\)/.test(server),
  'отказ входа больше не несёт кода причины');
assert(server.includes("'Этот персонаж уже находится в игре в другой вкладке или на другом устройстве.', 'character-busy'"),
  'занятость персонажа не помечена кодом character-busy — клиент не отличит её от окончательного отказа');
// Возвращающийся после обрыва игрок упирается сначала в блокировку аккаунта:
// прошлый сокет числится живым, пока socket.io не поймает ping-таймаут.
assert(server.includes("'Этот аккаунт уже находится в игре на другом устройстве.', 'session-busy'"),
  'занятость аккаунта не помечена кодом session-busy — именно сюда упирается возвращающийся игрок');

// --- Клиент хранит причину ---
assert(core.includes('function setMultiplayerJoinFailure('), 'причина неудачного входа нигде не сохраняется');
assert(core.includes('function multiplayerJoinFailureText('), 'нет текста причины для игрока');
const retryable = /function multiplayerJoinFailureIsRetryable\([\s\S]*?\n  \}/.exec(core);
assert(retryable, 'нет разделения причин на временные и окончательные');
for (const reason of ['offline', 'timeout', 'busy']) {
  assert(retryable[0].includes(`'${reason}'`), `причина ${reason} временная, её нельзя считать окончательной`);
}
assert(!/'rejected'/.test(retryable[0]) && !/'session'/.test(retryable[0]),
  'окончательный отказ сервера нельзя повторять — это бесконечный цикл');

// --- Причина проставляется во всех местах отказа ---
const bare = socket.split('\n').filter(line => /resolveMultiplayerJoinWaiters\(false\)/.test(line));
assert(bare.length === 0,
  `отказ входа без причины в ${bare.length} мест(ах): игрок снова получит одинаковый текст на всё`);
assert(socket.includes("joinRejectionIsTemporary(ack?.code)") && socket.includes("joinRejectionIsTemporary(data?.code)"),
  'клиент не читает код временной занятости ни из ответа на вход, ни из отказа сессии');
const temporary = /const TEMPORARY_JOIN_REJECTIONS = new Set\(\[([^\]]*)\]\)/.exec(core);
assert(temporary, 'нет списка временных отказов');
for (const code of ['session-busy', 'character-busy']) {
  assert(temporary[1].includes(`'${code}'`), `код ${code} снимается сервером сам, его нельзя считать окончательным`);
}
assert(/if \(!multiplayer\.joinFailure\) setMultiplayerJoinFailure\(/.test(core),
  'таймаут ожидания затирает более точную причину, названную сокетом');

// --- Временные неудачи переживаются повтором ---
const retry = /async function joinServerWithRetry\([\s\S]*?\n  \}/.exec(bootstrap);
assert(retry, 'нет повтора входа в сетевую сессию');
assert(retry[0].includes('multiplayerJoinFailureIsRetryable()'),
  'повтор не смотрит, имеет ли смысл повторять');
assert(/mark\('network-join-gave-up'/.test(retry[0]), 'отказ от повторов не виден в трассировке запуска');
const delays = /const SERVER_JOIN_RETRY_DELAYS = \[([^\]]*)\]/.exec(bootstrap);
assert(delays, 'нет пауз между попытками входа');
const total = delays[1].split(',').map(value => Number(value.trim())).filter(Number.isFinite);
assert(total.length >= 3, 'слишком мало попыток, чтобы пережить обрыв связи');
const waited = total.reduce((sum, value) => sum + value, 0);
// Сервер снимает блокировку персонажа только когда socket.io заметит смерть
// прошлого сокета: это ping-таймаут, десятки секунд.
assert(waited >= 25000, `суммарное ожидание ${waited} мс меньше времени жизни блокировки персонажа`);
assert(waited <= 45000, `суммарное ожидание ${waited} мс слишком долгое, игра будет выглядеть зависшей`);
assert(retry[0].includes('setLocationLoadingProgress('),
  'во время ожидания экран загрузки молчит, и игра выглядит зависшей');

// --- Сообщение говорит правду ---
for (const [file, source] of [['01_bootstrap_online_save.js', bootstrap], ['08_character_creation_save.js', creation]]) {
  assert(!source.includes('Сервер не разрешил открыть этого персонажа'),
    `${file}: потеря связи снова объявляется запретом сервера`);
  assert(!source.includes('Сервер не разрешил создать игровую сессию'),
    `${file}: потеря связи снова объявляется запретом сервера`);
  assert(/const failureText = /.test(source),
    `${file}: причина не забирается до сброса сессии и будет затёрта`);
  const failureIndex = source.indexOf('const failureText = ');
  const invalidateIndex = source.indexOf('invalidateMultiplayerSessionContext(', failureIndex);
  assert(invalidateIndex > failureIndex,
    `${file}: сброс сессии затирает причину до того, как её прочитали`);
}

console.log('Join failure reasons OK: сервер называет занятость кодом, клиент различает обрыв и отказ, временные неудачи переживаются повтором с показом хода.');
