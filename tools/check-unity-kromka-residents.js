'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.resolve(__dirname, '../unity-client/Assets/Scripts/Game/RoaPersonalBaseCanvas.cs'), 'utf8');
for (const token of ['ЖИТЕЛИ', 'residentAction', 'BaseResident:', 'roleName', 'personalQuestName']) assert(source.includes(token), `Resident UI is missing ${token}.`);
assert(!source.includes('AddPartyMember') && !source.includes('FollowPlayer'), 'Base residents must not become controllable followers.');
console.log('Unity Kromka resident presentation check passed.');
