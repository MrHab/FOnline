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
// Отказы сервера обязаны доходить до страницы: раньше клановые и осадные
// действия отбрасывали ack.error, и кнопка просто «не срабатывала».
for (const token of ['ClanStatus', '_kromkaClanStatus', '_kromkaClanStatusMark', 'SetKromkaClanStatus', 'ack?["error"]', 'BeginKromkaClanRequest', 'FinishKromkaClanRequest', 'SubmitClanSocial'])
  assert(clanUi.includes(token), `Clan UI does not surface server refusals: ${token}.`);
assert(pipboy.includes('BuildKromkaClanStatus(page);') && pipboy.includes('RefreshKromkaClanStatus();'),
  'The clan page must own a visible status line.');
for (const event of ['kromkaClanAction', 'kromkaSiegeAction']) {
  const at = clanUi.indexOf(`EmitWithAck("${event}"`);
  assert(at >= 0 && clanUi.slice(at, at + 500).includes('FinishKromkaClanRequest('), `${event} answer must reach the page.`);
}
assert(!/Pipboy\.SubmitSocialState\("(?:leaveClan|acceptClan|declineClan|createClan)"/.test(pipboy),
  'Clan-page social actions must route through SubmitClanSocial so their result is visible.');
const clanProbe = fs.readFileSync(path.join(root, 'unity-client/Assets/Editor/RoaPipboyClanStatusProbe.cs'), 'utf8');
assert(clanProbe.includes('"SendKromkaClanItemAction"') && clanProbe.includes('"SendKromkaSiegeAction"'),
  'The clan status probe must drive the real senders.');
assert(fs.readFileSync(path.join(root, 'unity-client/Assets/Editor/RoaClientAuditRunner.cs'), 'utf8').includes('typeof(RoaPipboyClanStatusProbe)'),
  'The clan status probe must run in the client audit.');
console.log('Unity Kromka clan screen check passed.');
