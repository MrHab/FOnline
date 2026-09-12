'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const socket = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Net/RoaSocketClient.cs'), 'utf8');
const pipboy = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs'), 'utf8');
const clanUi = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.KromkaClans.cs'), 'utf8');
for (const token of ['OnKromkaClanState', 'kromkaClanState']) assert(socket.includes(token), `Clan socket state is missing ${token}.`);
assert(pipboy.includes('AddKromkaClanBaseRows'), 'The existing clan tab must render strategic holdings.');
for (const token of ['requestKromkaClanState', 'kromkaClanAction', 'payUpkeep', 'installModule', 'СТРАТЕГИЧЕСКИЕ БАЗЫ КРОМКИ', 'Окна осады UTC'])
  assert(clanUi.includes(token), `Clan UI is missing ${token}.`);
console.log('Unity Kromka clan screen check passed.');
