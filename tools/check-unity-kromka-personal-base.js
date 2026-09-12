'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const canvas = read('unity-client/Assets/Scripts/Game/RoaPersonalBaseCanvas.cs');
const pip = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');
const pipBase = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.Base.cs');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
for (const token of ['resolveRights', 'personalBaseAction', 'BeginBuild', 'ConfirmBuild', 'startJob', 'claimJob']) assert(canvas.includes(token), `Base canvas is missing ${token}.`);
assert(pip.includes('(Page.Base, "Укрытие")') && pip.includes('BuildPersonalBasePage'), 'ПУТНИК must contain the Укрытие tab.');
assert(pipBase.includes('ЛИЧНОЕ УБЕЖИЩЕ'));
assert(socket.includes('OnPersonalBaseState?.Invoke(state)'));
console.log('Unity Kromka personal base UI check passed.');
