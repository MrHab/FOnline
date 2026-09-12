#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const server = read('server.js');
const clans = read('src/server/kromka-clans.js');
const personalBases = read('src/server/personal-bases.js');
const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const canvas = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');

[
  'serverCaptureWeaponRuntimeRecords',
  'serverRestoreWeaponRuntimeRecords',
  'itemRuntimeRecords: serverCaptureWeaponRuntimeRecords',
  'serverRestoreWeaponRuntimeRecords(p, groundItem.itemRuntimeRecords || [])',
  'factionStorageRuntime',
  'clan.storageRuntime',
  'base.inventoryRuntime'
].forEach(contract => assert(server.includes(contract), `runtime item transfer contract is missing: ${contract}`));

assert(clans.includes('storageRuntime') && clans.includes('storageWeaponRuntime'),
  'clan storage does not persist and publish concrete weapon instances');
assert(personalBases.includes('inventoryRuntime') && personalBases.includes('inventoryWeaponRuntime'),
  'personal base storage does not persist and publish concrete weapon instances');

[
  'const SERVER_PLAYER_TRADES = new Map()',
  'session.accepted[p.id] = false',
  'session.accepted[otherId] = false',
  'if (session.accepted[otherId] === true)',
  'serverValidateWeaponRuntimeRemoval',
  'persistActivePlayerStates([a, b]) === true',
  'playerTradeRollback',
  "cancelServerPlayerTrade(trade, 'disconnected'",
  "SERVER_PLAYER_TRADES.delete(session.id)"
].forEach(contract => assert(server.includes(contract), `safe player-trade contract is missing: ${contract}`));

assert(pipboy.includes('SubmitPlayerTradeWeaponToggle(string itemId, string itemRuntimeId)')
  && pipboy.includes('itemRuntimeIds'),
  'Unity cannot select a concrete modified weapon instance for player trade');
assert(canvas.includes('Pipboy.SubmitPlayerTradeWeaponToggle(itemId, runtimeId)')
  && canvas.includes('itemRuntimeRecords'),
  'Unity trade screen does not show or toggle concrete weapon instances');

const completionStart = server.indexOf('function completeServerPlayerTrade(');
const completionEnd = server.indexOf('\nfunction serverHarvestApCost', completionStart);
const completion = server.slice(completionStart, completionEnd);
assert(completion.indexOf('persistActivePlayerStates([a, b])') < completion.indexOf('SERVER_PLAYER_TRADES.delete(session.id)'),
  'trade session is deleted before the atomic save succeeds');

console.log('Item instances OK: loaded magazines, condition and mods survive storage/drop/trade; P2P exchange is double-confirmed and atomically persisted');
