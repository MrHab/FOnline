'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const socket = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Net/RoaSocketClient.cs'), 'utf8');
const clan = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.KromkaClans.cs'), 'utf8');
const view = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaKromkaSiegePresentation.cs'), 'utf8');
for (const token of ['OnKromkaSiegeState', 'kromkaSiegeState']) assert(socket.includes(token), `Missing siege socket token ${token}.`);
for (const token of ['КАЛЕНДАРЬ ОСАД', 'registerSelf', 'ОБЪЯВИТЬ ВЫЗОВ', 'ВОЙТИ В ОСАДУ', 'РЕЗУЛЬТАТ']) assert(clan.includes(token), `Missing siege calendar token ${token}.`);
for (const token of ['AttackerZone', 'DefenderZone', 'captureRelay', 'damageGate', 'captureCore', 'contestCore', 'ОСАДА ЗАВЕРШЕНА']) assert(view.includes(token), `Missing siege presentation token ${token}.`);
// Счёт осады на панели боя: сервер публикует его в снимке события, клиент
// обязан показать, чьи передатчики, чья перезапись ядра и сколько возрождений.
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const snapshotAt = server.indexOf('function publicServerSiegeEvent(');
const snapshot = server.slice(snapshotAt, server.indexOf('\nfunction serverPublicKromkaSiegeState', snapshotAt));
for (const field of ['relayOwners', 'relayScores', 'coreOwnerClanId', 'coreHoldStartedAt', 'coreHoldMs', 'respawnWaves',
  'respawnWavesPerSide', 'challengers', 'defenderName', 'declaredAt', 'qualifiedAttackerClanId', 'gateMaxHp'])
  assert(snapshotAt >= 0 && snapshot.includes(field), `The siege snapshot must publish ${field}.`);
for (const token of ['public static string DescribeSiege(', 'public static string OwnClanId(', 'public static string ProjectedQualifier(',
  'relayOwners', 'coreHoldStartedAt', 'respawnWavesPerSide', 'VerticalWrapMode.Truncate', 'RoaUiScale.Apply',
  'RoaGameBootstrap.BlocksWorldHud', 'SyncServerClock', '_errorUntil', 'PaintRelays'])
  assert(view.includes(token), `The siege panel does not show the score: ${token}.`);
assert(!/стоит на ядре|оспаривается/.test(view), 'The panel must not claim presence at the core: the server does not track it.');
const recovery = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaRecoveryCanvas.cs'), 'utf8');
assert(recovery.includes('"clanSiegeWave"') && recovery.includes('respawnWavesRemaining') && recovery.includes('siegeEliminated'),
  'The respawn screen must tell a siege respawn and an elimination from a trip home.');
assert(server.includes('cause.siegeEliminated = true;'), 'The server must mark a siege elimination for the respawn screen.');
const siegeProbe = fs.readFileSync(path.join(root, 'unity-client/Assets/Editor/RoaKromkaSiegeUiProbe.cs'), 'utf8');
assert(siegeProbe.includes('RoaKromkaSiegePresentation.DescribeSiege'), 'The siege probe must check the score formatter.');
assert(fs.readFileSync(path.join(root, 'unity-client/Assets/Editor/RoaClientAuditRunner.cs'), 'utf8').includes('typeof(RoaKromkaSiegeUiProbe)'),
  'The siege probe must run in the client audit.');
console.log('Unity siege check passed: calendar, roster, timer, objectives, side zones, score, respawns and result view.');
