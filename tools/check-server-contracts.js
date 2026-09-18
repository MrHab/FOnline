#!/usr/bin/env node
'use strict';

// Серверные контракты, которые раньше проверялись вместе со старым браузерным
// клиентом: сервер не принимает от клиента состояние мира, отказ входа несёт
// код причины, а выход на глобальную карту проверяется строго.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// --- состояние мира принадлежит серверу ---------------------------------------------
assert(!server.includes("socket.on('worldState'"),
  'the production server still accepts client worldState uploads');
assert(!server.includes('function sanitizeWorldState'),
  'the production server still keeps the obsolete client world-state sanitizer');
assert(server.includes("reason: 'resourceRespawn'"),
  'resource respawn no longer keeps its full compatibility reconciliation');

// --- отказ входа называет причину кодом --------------------------------------------------
assert(/function rejectJoin\(socket, ack, error, code = ''\)/.test(server),
  'отказ входа больше не несёт кода причины');
assert(server.includes("'Этот персонаж уже находится в игре в другой вкладке или на другом устройстве.', 'character-busy'"),
  'занятость персонажа не помечена кодом character-busy — клиент не отличит её от окончательного отказа');
// Возвращающийся после обрыва игрок упирается сначала в блокировку аккаунта:
// прошлый сокет числится живым, пока socket.io не поймает ping-таймаут.
assert(server.includes("'Этот аккаунт уже находится в игре на другом устройстве.', 'session-busy'"),
  'занятость аккаунта не помечена кодом session-busy — именно сюда упирается возвращающийся игрок');

// --- выход на глобальную карту -------------------------------------------------------------
assert(server.includes('if (!leader || !leader.roomId || leader.dead'),
  'сервер больше не отклоняет выход игрока, уже покинувшего локацию');
assert(server.includes("if (!serverPlayerAtGlobalMapExit(leader)) return fail('Сначала дойдите до границы локации.')"),
  'сервер перестал проверять, что игрок стоит у края локации');

console.log('Server contracts OK: the world state belongs to the server, join refusals carry a reason code and the global map exit stays strict.');
