#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const controls = read(game, 'RoaMobileControls.cs');
const canvas = read(game, 'RoaMobileControlsCanvas.cs');
const bootstrap = read(game, 'RoaGameBootstrap.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaMobileControlsProbe.cs');

assert(canvas.includes('public sealed class RoaMobileControlsCanvas')
  && canvas.includes('typeof(CanvasScaler), typeof(GraphicRaycaster)')
  && canvas.includes('RoaUiScale.Apply(canvasRoot.GetComponent<CanvasScaler>())')
  && canvas.includes('Screen.safeArea')
  && canvas.includes('public static Layout CalculateLayout('),
  'Adaptive safe-area mobile uGUI Canvas is incomplete');
assert((canvas.match(/CreateButton\("/g) || []).length === 12
  && canvas.includes('CreateDiscTexture()')
  && canvas.includes('back.raycastTarget = true')
  && canvas.includes('icon.raycastTarget = false')
  && canvas.includes('_joystickOuterImage.raycastTarget'),
  'Mobile Canvas no longer has twelve bounded buttons or correct raycast ownership');
assert(canvas.includes('SetLabel("Target", state.TargetSelected ? "ЦЕЛЬ ✓" : "ЦЕЛЬ")')
  && canvas.includes('SetLabel("Crouch", state.Crouching ? "ВСТАТЬ" : "ПРИСЕСТЬ")')
  && canvas.includes('SetLabel("Player", state.PingAvailable ? "МЕТКА" : "ИГРОК")')
  && canvas.includes('SetLabel("Bolt", state.BoltAiming ? "ОТМЕНА" : "БОЛТ")')
  && canvas.includes('state.FireMode.ToUpperInvariant()')
  && canvas.includes('state.InputSuppressed ? "ЗАКРЫТЬ" : "МЕНЮ"')
  && canvas.includes('bool joystickVisible = _gameplayButtonsVisible && state.JoystickActive;'),
  'Mobile Canvas lost readable live state or panel conflict handling');
assert(canvas.includes('IPointerDownHandler')
  && canvas.includes('IPointerUpHandler')
  && canvas.includes('IPointerExitHandler')
  && canvas.includes('held => Controls?.SetFireHeld(held)')
  && canvas.includes('Controls?.SetFireHeld(false);'),
  'Held fire can remain latched or no longer follows pointer lifecycle');

assert(controls.includes('public bool CanvasDriven { get; set; }')
  && controls.includes('if (CanvasDriven) return;')
  && controls.includes('if (_fireHeld || (!CanvasDriven && TouchHeld(')
  && controls.includes('public void SetFireHeld(bool held)')
  && controls.includes('public bool TryGetJoystickVisual(')
  && controls.includes('IsJoystickStart(gui, Screen.width, Screen.height, Screen.safeArea)')
  && controls.includes('!layout.SafeArea.Contains(screenPoint)')
  && controls.includes('layout.Map.Contains(screenPoint)'),
  'Gameplay controller is not safely delegated from IMGUI to the mobile Canvas');
for (const action of [
  'TriggerMenu', 'TriggerInventory', 'TriggerPipboy', 'TriggerMap',
  'TriggerTargetCycle', 'TriggerCrouch', 'TriggerReload', 'TriggerFireMode',
  'TriggerPlayerPanel', 'TriggerPlayerOrPing', 'TriggerInteract'
]) {
  assert(controls.includes(`public void ${action}(`), `Mobile action is not shared: ${action}`);
}

assert(bootstrap.includes('gameObject.AddComponent<RoaMobileControlsCanvas>()')
  && bootstrap.includes('mobileCanvas.Configure(MobileControls, BoltThrower);')
  && bootstrap.includes('MobileControls.CanvasDriven = true;'),
  'Bootstrap does not activate the mobile Canvas and gate the old IMGUI path');

// Кнопки сумки, ПУТНИКа и игрока обязаны открывать канву терминала. Если они снова
// начнут дёргать только IMGUI-панели (в бою те выключены флагом CanvasDriven), на
// телефоне пропадут HUD, движение и сам слой кнопок, а выхода не будет: Esc там нет.
assert(controls.includes('public void SetTerminal(RoaPipboyCanvas terminal)')
  && controls.includes('private RoaPipboyCanvas _terminal;'),
  'Mobile controls no longer hold the ПУТНИК canvas that actually renders');
for (const [action, page] of [
  ['TriggerInventory', 'Items'], ['TriggerPipboy', 'Status'], ['TriggerPlayerPanel', 'Friends']
]) {
  const body = controls.slice(controls.indexOf(`public void ${action}(`));
  const scope = body.slice(0, body.indexOf('\n        }'));
  assert(scope.includes(`ToggleTerminalPage(RoaPipboyCanvas.Page.${page}`),
    `Mobile ${action} must open the ПУТНИК canvas page ${page}, not a hidden IMGUI panel`);
}
assert(controls.includes('private bool TerminalOpen')
  && /private bool IsPanelOpen\(\)\s*\{\s*return DialogueOpen\(\) \|\| TerminalOpen/.test(controls),
  'Mobile panel state ignores the ПУТНИК canvas: stick and fire would stay live under it');
assert(bootstrap.includes('MobileControls.SetTerminal(PipboyCanvas);'),
  'Bootstrap does not wire the ПУТНИК canvas into the touch buttons');
assert(read(game, 'RoaPipboyCanvas.cs').includes('dimButton.onClick.AddListener(Close);'),
  'ПУТНИК has no large tap-outside exit: on a phone the × shrinks with the frame');

assert(probe.includes('mobile Canvas control leaves the device safe area')
  && probe.includes('left shortcut rail can no longer steal the floating joystick finger')
  && probe.includes('mobile Canvas pointer-down does not start held fire')
  && probe.includes('suppressed mobile input does not collapse to one clear close action')
  && probe.includes('hidden mobile Canvas leaves held fire latched')
  && probe.includes('mobile contextual player button does not open activity pings'),
  'Unity mobile probe does not cover safe layout, live states and held input cleanup');
assert(/guid:\s*[0-9a-f]{32}/i.test(read(game, 'RoaMobileControlsCanvas.cs.meta')),
  'RoaMobileControlsCanvas.cs.meta has no valid GUID');

// Прицел на телефоне: игроки в PvP-зоне входят в автоцель (без союзников и
// друзей), выбранный игрок берётся в живой позиции, а ракетница стреляет
// коротким тапом по миру, не ближе радиуса собственного взрыва.
const combat = read(game, 'RoaCombat.cs');
const remote = read(game, 'RoaRemotePlayers.cs');
const activity = read(game, 'RoaWorldActivityCanvas.cs');
const server = read('server.js');
for (const token of ['public void CollectMobileTargets(', 'MobileTargetPrefix + pair.Key', 'remote.Player.Downed',
  'public bool TryGetTargetable(', 'if (targets == null || allowed == null) return;'])
  assert(remote.includes(token), `Remote players are not offered to the mobile target cycle: ${token}`);
for (const token of ['RemotePlayers.CollectMobileTargets(', 'TryGetPosition(_selectedId.Substring(',
  'IsPointerOverGameObject(', '_combat.TryGroundPointAtScreen(', 'WorldTapMaxSeconds = 0.35f', 'bolt.Pending',
  'activity.PingMenuOpen', 'CollectMobileTargets(_player.transform.position, TargetRange, _targets, _remoteTargetFilter)'])
  assert(controls.includes(token), `Mobile aiming is incomplete: ${token}`);
assert(/if \(!medical && _combat/.test(controls), 'The medical mode must keep players out of the target cycle.');
assert(activity.includes('MobilePingHoldSeconds = 0.40f'), 'A world tap must stay shorter than the activity ping hold.');
for (const token of ['public static bool PvpTargetAllowed(', 'public static bool ZoneModeAllowsPvp(', 'SetSelectedRemoteAimTarget(_mobileAimTargetId)',
  '"tract_league"', 'public bool UsesGroundTargeting', 'public bool TryGroundPointAtScreen(', 'RocketSelfSafeDistance = 6.3f',
  'public static WorldZone TerritoryPlatformAt(', 'zone.Type != "factionPlatform"', 'remote.WorldPartyId', 'remote.TerritoryFactionId',
  'TerritoryPlatformAt(location, selfX, selfZ) != null'])
  assert(combat.includes(token), `Mobile PvP aiming rule is missing: ${token}`);
// Союз фракций и радиус ракетницы живут на сервере: если они изменятся,
// клиентское зеркало и безопасная дистанция устареют.
const allies = /const SERVER_FACTION_ALLIES = new Set\(\[([^\]]*)\]\)/.exec(server);
assert(allies && JSON.stringify([...allies[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort())
  === JSON.stringify(['tract_league|uprava', 'uprava|tract_league']),
  'The server faction alliance changed: update RoaCombat.CombatFactionsAllied.');
const zoneRules = require(path.join(root, 'src/server/zone-rules.js'));
assert.deepEqual(zoneRules.ZONE_MODES.filter(mode => zoneRules.zoneModeAllowsPvp(mode)), ['pvp', 'pvpEvent', 'pvpFullDrop', 'pvpBlack'],
  'The server PvP zone modes changed: update RoaCombat.ZoneModeAllowsPvp.');
// Правила Сердцевины и отряда: клиент повторяет три отказа serverTerritoryPvpBlock
// и союз по отряду; новый отказ на сервере требует зеркала в автоцели.
const territoryBlock = /function serverTerritoryPvpBlock\(.*\) \{([\s\S]*?)\n\}/.exec(server);
assert(territoryBlock && (territoryBlock[1].match(/return '/g) || []).length === 5
  && ['sameFaction', 'attackerOnPlatform', 'targetProtected'].every(reason => territoryBlock[1].includes(`'${reason}'`)),
  'The core PvP rules changed: update RoaCombat.PvpTargetAllowed.');
assert(/function serverPlayersAllied[\s\S]*?playerMatchesWorldPartyMember/.test(server), 'The party alliance moved: update RoaCombat.PvpTargetAllowed.');
for (const token of ['territoryFactionId: serverPlayerTerritoryFactionId(p)', "worldPartyId: worldTransferId(p.attachedPartyId || '')",
  "emitAuthoritativePlayerState(p, { reason: 'serverWorldTransfer' })"])
  assert(server.includes(token), `The server does not give the client what mobile aiming reads: ${token}`);
assert(server.includes('explosiveRadius: 4.2'), 'The rocket blast radius moved: update RoaCombat.RocketSelfSafeDistance.');
for (const message of ['mobile target cycle skips a legal PvP target', 'mobile target cycle trusts a stale zone after transfer',
  'mobile target cycle offers an ally (faction, friend or clan)', 'mobile player target id is not prefixed',
  'mobile target cycle offers a caravan party mate', 'mobile target cycle offers a same-contract ally in the core',
  'mobile target cycle offers targets from a faction platform', 'mobile target cycle offers a player protected on their own platform',
  'without a PvP rule the mobile cycle offers players'])
  assert(probe.includes(message), `The mobile probe does not cover player targets: ${message}`);
assert(probe.includes('pvp-targets=filtered'), 'The mobile probe summary must report the player target filter.');

console.log('Unity mobile controls OK: safe-area uGUI, 12 touch targets, held fire, bolt tool, floating stick, panel-aware states, PvP player targets and rocket ground taps');
