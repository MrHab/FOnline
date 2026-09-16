'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const server = read('server.js');
const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const inventory = read('unity-client/Assets/Scripts/Game/RoaInventory.cs');
const detector = read('unity-client/Assets/Scripts/Game/RoaKromkaShiftAndDetector.cs');
const uiScale = read('unity-client/Assets/Scripts/Game/RoaUiScale.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const personalBase = read('unity-client/Assets/Scripts/Game/RoaPersonalBaseCanvas.cs');
const activity = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs');

for (const schema of [
  'kromka.ui-snapshots.v1', 'kromka.contracts.v1', 'kromka.world-player.v1',
  'kromka.quests-player.v1', 'kromka.reputation.v1', 'kromka.friends.v1',
  'kromka.clan-player.v1', 'kromka.shelter.v1', 'kromka.authority-scopes.v1'
]) assert(server.includes(schema), `missing versioned player snapshot ${schema}`);

assert(pipboy.includes('ApplyVersionedUiSnapshots(_self);'), 'ПУТНИК must hydrate from versioned server snapshots');
for (const key of ['factionContracts', 'worldTaskRecords', 'kromkaQuestJournal', 'worldFactionReputation', 'socialState', 'personalBase'])
  assert(pipboy.includes(`self["${key}"]`), `ПУТНИК does not project ${key} from server snapshots`);

assert(server.includes("scope: 'personalBase'")
  && server.includes("scope: 'temporaryParty'")
  && server.includes("scope: 'clan'"),
'personal-base, temporary-party and clan permissions must remain distinct authority scopes');

assert(inventory.includes('"detector"') && inventory.includes('"artifactBelt"'),
  'detector and artifact belt must be inventory equipment slots');
const buildUi = detector.slice(detector.indexOf('private void BuildUi()'), detector.indexOf('private static string FormatEffects'));
assert(buildUi.includes('ShiftWarning') && !buildUi.includes('DetectorPanel') && !buildUi.includes('ArtifactPanel')
  && !buildUi.includes('_pickupButton =') && !buildUi.includes('_effectsPanel ='),
'detector/artifact panels must not be permanent gameplay HUD elements');
assert(detector.includes('ArtifactDetectorBeep') && detector.includes('CreateArtifactView'),
  'artifact detection must duplicate its sound with a revealed world object');
assert(activity.includes('ApplyPingHighlight') && activity.includes('ShowMessage'),
  'party audio/context signals must have a visual presentation path');

assert(uiScale.includes('mobile ? new Vector2(1280f, 720f) : new Vector2(1440f, 810f)')
  && uiScale.includes('CanvasScaler.ScaleMode.ScaleWithScreenSize'),
'the UI must retain explicit desktop/mobile landscape scaling');
assert(personalBase.includes('Guid.NewGuid().ToString("N")'), 'base permission actions need request ids');
for (const event of ['worldTaskAction', 'npcQuestAction', 'kromkaQuestAction']) {
  const at = interaction.indexOf(`EmitWithAck("${event}"`);
  assert(at >= 0 && interaction.slice(at, at + 360).includes('["requestId"]'), `${event} needs a request id`);
}
for (const event of ['socialAction', 'socialStateAction', 'playerTradeAction']) {
  const at = pipboy.indexOf(`EmitWithAck("${event}"`);
  assert(at >= 0 && pipboy.slice(Math.max(0, at - 900), at + 250).includes('requestId'), `${event} needs a request id`);
}

// Входящий запрос лечения и приглашение к обмену обязаны открывать живую канву.
// Прежний путь поднимал флаг выключенного IMGUI-окна: HUD гас, персонаж замирал,
// а окна не было — выйти можно было только Esc, и 15-секундный запрос истекал.
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
for (const token of [
  'public System.Action OpenSocialCanvas { get; set; }',
  'public bool IsOpen { get { return _open && !CanvasDriven; } }',
  'OpenSocialCanvas?.Invoke();',
  'if (_playerTrade != null && !wasTrading) OpenSocial();'
]) assert(pipboy.includes(token), `ПУТНИК must route social prompts to the live canvas: ${token}`);
assert(bootstrap.includes('Pipboy.OpenSocialCanvas = () => PipboyCanvas.Open(RoaPipboyCanvas.Page.Friends);'),
  'the bootstrap must wire social prompts to the Friends page of the canvas');
const socialProbe = read('unity-client/Assets/Editor/RoaSocialRoutingProbe.cs');
assert(socialProbe.includes('"HandleMedicalConsentRequested"') && socialProbe.includes('"HandlePlayerTradeUpdated"'),
  'the social routing probe must drive the real socket handlers');
assert(read('unity-client/Assets/Editor/RoaClientAuditRunner.cs').includes('typeof(RoaSocialRoutingProbe)'),
  'the social routing probe must run in the client audit');

console.log('KRM-20 UI contract OK: versioned ПУТНИК, scoped rights, responsive UI and contextual artifacts');
