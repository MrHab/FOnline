'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.resolve(__dirname, '../unity-client/Assets/Scripts/Game/RoaPersonalBaseCanvas.cs'), 'utf8');
for (const token of ['ЖИТЕЛИ', 'residentAction', 'BaseResident:', 'roleName', 'personalQuestName']) assert(source.includes(token), `Resident UI is missing ${token}.`);
assert(!source.includes('AddPartyMember') && !source.includes('FollowPlayer'), 'Base residents must not become controllable followers.');
// Вклад жителей виден: что даёт каждый, работает ли он и что даёт вся база.
for (const token of ['public static string ResidentBonusLabel(JObject bonus)', 'public static string ResidentRowText(',
  '"activeResidentIds"', 'ПРОСТАИВАЕТ', 'ВКЛАД БАЗЫ: ', '_list.sizeDelta = Vector2.zero;', '"jobQueueLimit"'])
  assert(source.includes(token), `Resident UI does not show the contribution: ${token}.`);
const probe = fs.readFileSync(path.resolve(__dirname, '../unity-client/Assets/Editor/RoaPersonalBaseResidentsProbe.cs'), 'utf8');
assert(probe.includes('RoaPersonalBaseCanvas.ResidentBonusLabel(') && probe.includes('RoaPersonalBaseCanvas.ResidentRowText('),
  'The resident probe must check the contribution formatters.');
assert(fs.readFileSync(path.resolve(__dirname, '../unity-client/Assets/Editor/RoaClientAuditRunner.cs'), 'utf8').includes('typeof(RoaPersonalBaseResidentsProbe)'),
  'The resident probe must run in the client audit.');
console.log('Unity Kromka resident presentation check passed: contribution, idle residents and queue are visible.');
