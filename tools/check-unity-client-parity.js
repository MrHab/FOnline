#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'public', 'js', 'game');
const UNITY_DIR = path.join(ROOT, 'unity-client', 'Assets', 'Scripts');

function walk(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory()
      ? walk(path.join(directory, entry.name), extension)
      : (entry.name.endsWith(extension) ? [path.join(directory, entry.name)] : []));
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceTree(directory, extension) {
  return walk(directory, extension)
    .sort()
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

function collect(source, pattern, group = 1) {
  const result = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) result.push(match[group]);
  return result;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function extractExpression(source, marker) {
  const markerAt = source.indexOf(marker);
  assert(markerAt >= 0, `missing JavaScript constant ${marker}`);
  const start = source.slice(markerAt + marker.length).search(/[\[{]/) + markerAt + marker.length;
  assert(start >= markerAt + marker.length, `missing value for ${marker}`);
  const open = source[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const character = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === open) depth += 1;
    else if (character === close && --depth === 0)
      return vm.runInNewContext(`(${source.slice(start, i + 1)})`);
  }
  throw new Error(`unclosed JavaScript constant ${marker}`);
}

function normalizeCost(cost) {
  return Object.fromEntries(Object.entries(cost || {})
    .map(([id, qty]) => [id, Number(qty)])
    .sort(([a], [b]) => a.localeCompare(b)));
}

const web = sourceTree(WEB_DIR, '.js');
const unity = sourceTree(UNITY_DIR, '.cs');
const server = read('server.js');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const auth = read('unity-client/Assets/Scripts/Net/RoaAuthClient.cs');
const uiScale = read('unity-client/Assets/Scripts/Game/RoaUiScale.cs');
const offlineProbe = read('unity-client/Assets/Editor/RoaOfflineResilienceProbe.cs');
const auditRunner = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const hudCanvas = read('unity-client/Assets/Scripts/Game/RoaHudCanvas.cs');
const hudProbe = read('unity-client/Assets/Editor/RoaHudCanvasProbe.cs');
const nameplates = read('unity-client/Assets/Scripts/Game/RoaActorNameplates.cs');
const enemies = read('unity-client/Assets/Scripts/Game/RoaEnemies.cs');
const npcCombatProbe = read('unity-client/Assets/Editor/RoaNpcCombatBehaviorProbe.cs');

assert(uiScale.includes('return mobile ? new Vector2(1280f, 720f) : new Vector2(1440f, 810f);')
  && uiScale.includes('public static void Apply(CanvasScaler scaler, bool mobile)'),
  'Unity UI must keep readable 1440x810 desktop and 1280x720 mobile references');

assert(bootstrap.includes('private const float AuthHeartbeatFailureRetrySeconds = 60f;')
  && bootstrap.includes('ShouldAttemptAuthHeartbeat(gameplaySession, socketPhase)')
  && bootstrap.includes('_nextAuthHeartbeatAt = Time.unscaledTime + AuthHeartbeatDelay(ok);')
  && bootstrap.includes('else if (!_authHeartbeatWarningShown && !string.IsNullOrEmpty(failure))'),
  'Unity account heartbeat must pause during gameplay reconnects, back off after failures, and log once');
assert(socket.includes('ReportConnectFailureOnce(LastError);')
  && socket.includes('ReportConnectFailureOnce("Соединение потеряно: " + reason);')
  && socket.includes('_connectFailureLogged = false;')
  && socket.includes('ShouldReportConnectFailure(_connectFailureLogged)'),
  'Unity socket reconnects must retain UI state while logging one warning per offline episode');
assert(offlineProbe.includes('AuthHeartbeatDelay(false), 60f')
  && offlineProbe.includes('ConnectionPhase.Disconnected')
  && offlineProbe.includes('ShouldReportConnectFailure(true)')
  && auditRunner.includes('typeof(RoaOfflineResilienceProbe)'),
  'Unity offline resilience probe must cover heartbeat gating, warning latching, and the full audit');
assert(enemies.includes('[DefaultExecutionOrder(-80)]')
  && enemies.includes('InstallPresentationBody(root, bodyProfile,')
  && enemies.includes('ResolvePresentationContact(presentedPosition,')
  && enemies.includes('SetPresentationBodyAlive(enemy.BodyCollider, enemy.BodyRigidbody, false)')
  && enemies.includes('enemy.Hp = ResolveFrameHealth(previousHp, frameHp, deadFrame,')
  && enemies.includes('enemy.Snapshot["aiState"] = data["aiState"].ToString();')
  && enemies.includes('enemy.ActionUntil, enemy.ReactionUntil, Time.time)')
  && enemies.includes('NpcCombatFactionLine(')
  && bootstrap.includes('Enemies.SetLocalPlayer(_controller)')
  && npcCombatProbe.includes('[NPC COMBAT 4.7] готово:')
  && npcCombatProbe.includes('ResolveFrameHealth(80, 55, false, true)')
  && auditRunner.includes('typeof(RoaNpcCombatBehaviorProbe)'),
  'Unity NPC combat presentation lost live HP, hit reaction priority, threat readability, contact separation, death release, or its audit');
assert(socket.includes('public bool ReconnectScheduled')
  && socket.includes('public float ReconnectDelayRemainingSeconds'),
  'Unity socket must expose read-only reconnect timing for honest player feedback');
assert(hudCanvas.includes('BuildConnectionStatus();')
  && hudCanvas.includes('RefreshConnectionStatus(gameplayScreen);')
  && hudCanvas.includes('AppendOccupiedScreenRect(_connectionPanel, output);')
  && hudCanvas.includes('public static ConnectionBannerState DescribeConnection(')
  && hudCanvas.includes('_connectionRestoredUntil = Time.unscaledTime + 2.4f;'),
  'Unity HUD must show non-blocking reconnect progress and a bounded restored confirmation');
assert(hudProbe.includes('offline banner lost retry countdown or attempt number')
  && hudProbe.includes('successful reconnect has no confirmation')
  && hudProbe.includes('healthy connection leaves a permanent banner on screen'),
  'Unity HUD probe must cover interrupted, reconnecting, restored, and healthy connection states');

assert(hudCanvas.includes('public static LayoutProfile ResolveLayout(bool mobile)')
  && hudCanvas.includes('bool mobile = MobileHudMode;')
  && hudCanvas.includes('ApplyAdaptiveLayout(mobile);')
  && hudCanvas.includes('drag.SetBasePosition(position);')
  && hudCanvas.includes('0.625f, new Vector2(0f, 44f)')
  && hudCanvas.includes('0.875f, new Vector2(0f, 16f)')
  && hudProbe.includes('weapon console again obscures too much of the combat view')
  && hudProbe.includes('quickbar overlaps the compact weapon console'),
  'Unity HUD no longer guarantees a compact, non-overlapping desktop/mobile combat stack');
assert(hudCanvas.includes('public enum HudFocusMode')
  && hudCanvas.includes('Activity,')
  && hudCanvas.includes('Detailed')
  && hudCanvas.includes('public static bool ShowsIdentity(')
  && hudCanvas.includes('public static bool ShowsQuickbar(')
  && hudCanvas.includes('SetWorldActivity(RoaWorldActivityCanvas activity)')
  && hudCanvas.includes('BuildCompactWeaponConsole();')
  && hudCanvas.includes('RefreshHudFocus(worldHud, mobile, focus);')
  && hudCanvas.includes('ClampBottomPanelPosition(')
  && hudCanvas.includes('Time.unscaledDeltaTime * 6.5f')
  && hudCanvas.includes('AppendOccupiedScreenRect(_compactConsolePanel, output);')
  && hudProbe.includes('exploration strip obscures the world or overlaps the quickbar')
  && hudProbe.includes('contextual exploration console is incomplete'),
  'Unity HUD lost contextual exploration/activity/combat/detail focus or its compact information strip');
assert(nameplates.includes('public static bool IsImportantNpc(')
  && nameplates.includes('case "merchant":')
  && nameplates.includes('case "quartermaster":')
  && nameplates.includes('public static Presentation ResolvePresentation(')
  && nameplates.includes('mobile ? 14f : 20f')
  && nameplates.includes('fill.type = Image.Type.Filled')
  && nameplates.includes('plate.HealthFill.fillAmount = Mathf.Clamp01(ratio)')
  && nameplates.includes('CompactHealthState(entry.Hp, entry.MaxHp)')
  && enemies.includes('RoaActorNameplates.IsImportantNpc(canDialogue,')
  && enemies.includes('Name = important ?')
  && !enemies.includes('if (enemy.Snapshot["canDialogue"]?.ToObject<bool>() != true) continue;')
  && hudProbe.includes('compact health-bar/name hierarchy is not deterministic'),
  'Unity actor nameplates lost the role-filtered name and compact health hierarchy');

// Browser -> server. Literal calls are supplemented by the browser's single
// audited guarded emitter, exactly like check-socket-event-contract.js.
const webEmits = uniqueSorted([
  ...collect(web, /\.emit\(\s*(['"])([^'"]+)\1/g, 2),
  ...collect(web, /emitGuardedMultiplayerGameplayAction\(\s*(['"])([^'"]+)\1/g, 2)
]);

// Unity normally sends through RoaSocketClient.Emit/EmitWithAck. join/state use
// the lower transport directly. Four UI branches choose the event at runtime;
// keep their domains explicit so a new unreviewed dynamic event fails the audit.
const unityTransportEmits = [];
for (const match of unity.matchAll(/\b(?:Socket\.)?Emit(?:WithAck)?\(\s*"([^"]+)"|\b[A-Za-z_][A-Za-z0-9_]*\.EmitAsync\(\s*"([^"]+)"/g))
  unityTransportEmits.push(match[1] || match[2]);

const dynamicUnityEvents = [
  'lootEnemy', 'lootWorldContainer',
  'hackTerminal', 'pickLock',
  'tradeMachineExchange', 'npcTradeExchange'
];
assert(interaction.includes('string eventName = _panel == PanelKind.Corpse ? "lootEnemy" : "lootWorldContainer";')
  && interaction.includes('Socket.EmitWithAck(eventName, payload'),
  'Unity corpse/container loot must keep a closed two-event dynamic domain');
assert(interaction.includes('SecurityAction("hackTerminal")')
  && interaction.includes('SecurityAction("pickLock")')
  && interaction.includes('Socket.EmitWithAck(action, new Dictionary<string, object>'),
  'Unity security action must keep a closed hackTerminal/pickLock event domain');
assert(interaction.includes('Socket.EmitWithAck(machine ? "tradeMachineExchange" : "npcTradeExchange", payload'),
  'Unity trade must keep a closed machine/NPC event domain');
assert.deepStrictEqual(
  (unity.match(/\bSocket\.EmitWithAck\(\s*[A-Za-z_][A-Za-z0-9_]*/g) || []).sort(),
  ['Socket.EmitWithAck(action', 'Socket.EmitWithAck(eventName', 'Socket.EmitWithAck(machine'],
  'Every dynamic Unity EmitWithAck call must remain one of the audited loot/security/trade call sites'
);

const unityEmits = uniqueSorted([...unityTransportEmits, ...dynamicUnityEvents]);
assert.deepStrictEqual(unityEmits, webEmits,
  'Unity must be able to send every event sent by the production browser client, and no private substitute');

// Server -> client. Socket lifecycle has first-class callbacks in the C#
// transport rather than named user-event handlers.
const webHandlers = uniqueSorted(collect(web,
  /\b(?:multiplayer\.socket|socket)\.(?:on|once)\(\s*(['"])([^'"]+)\1/g, 2));
const lifecycle = ['connect', 'connect_error', 'disconnect'];
const unityHandlers = uniqueSorted(collect(unity, /\b_connection\.On\(\s*"([^"]+)"/g));
const unityOnlyHandlers = ['worldActivityFeedChanged'];
assert.deepStrictEqual(
  unityHandlers.filter(name => !unityOnlyHandlers.includes(name)),
  webHandlers.filter(name => !lifecycle.includes(name)),
  'Unity must handle every non-lifecycle event handled by the production browser client'
);
for (const name of unityOnlyHandlers) {
  assert(unityHandlers.includes(name), `Unity-only server event ${name} must remain handled by Unity`);
  assert(!webHandlers.includes(name), `Unity-only server event ${name} must not leak back into the legacy browser client`);
}
assert(socket.includes('_connection.OnConnected +=')
  && socket.includes('_connection.OnConnectError +=')
  && socket.includes('_connection.OnDisconnected +='),
  'Unity transport lifecycle callbacks are incomplete');

// HTTP feature surface. /api/auth/me only restores a browser-local bearer token;
// Unity deliberately keeps that credential process-local and authenticates by
// login/register each launch. Every gameplay/data endpoint remains shared.
const webHttp = uniqueSorted([
  ...collect(web, /\bserverApi\(\s*(['"])(\/api\/[^'"]+)\1/g, 2),
  ...collect(web, /\bfetch\(\s*(['"])(\/api\/[^'"]+)\1/g, 2)
]);
const platformOnlyHttp = ['/api/auth/me'];
for (const route of webHttp.filter(value => !platformOnlyHttp.includes(value)))
  assert(unity.includes(`"${route}"`), `Unity is missing browser HTTP route ${route}`);
assert(auth.includes('он живёт в памяти процесса') && auth.includes('PlayerPrefs пишется только deviceId'),
  'The intentional Unity /api/auth/me divergence must retain its credential-safety rationale');
assert(auth.includes('"/api/characters/" + UnityWebRequest.EscapeURL(characterId)')
  && auth.includes('+ "/save"'),
  'Unity is missing the dynamic character load/save/delete routes');

// Static item presentation must cover every browser base id and exact weight;
// unknown runtime suffixes are resolved to these base ids by RoaInventory.BaseId.
const browserItemsSource = read('public/js/game/03_items_inventory_core.js');
const browserItems = extractExpression(browserItemsSource, 'const ITEMS =');
const unityItemSource = read('unity-client/Assets/Scripts/Game/RoaItemData.cs');
const unityItems = {};
for (const match of unityItemSource.matchAll(/Add\(result,\s*"([^"]+)",\s*"([^"]*)",\s*(-?\d+(?:\.\d+)?)f?\);/g))
  unityItems[match[1]] = { name: match[2], weight: Number(match[3]) };
assert.deepStrictEqual(Object.keys(unityItems).sort(), Object.keys(browserItems).sort(),
  'Unity item catalog ids drifted from browser ITEMS');
const itemNameDrift = [];
for (const [id, item] of Object.entries(browserItems)) {
  if (unityItems[id].name !== item.name)
    itemNameDrift.push(`${id}: ${JSON.stringify(unityItems[id].name)} != ${JSON.stringify(item.name)}`);
  assert(Math.abs(unityItems[id].weight - Number(item.weight || 0)) < 1e-6,
    `${id}: Unity item weight drifted from browser ITEMS`);
}
assert.deepStrictEqual(itemNameDrift, [], `Unity item names drifted from browser ITEMS:\n${itemNameDrift.join('\n')}`);

// Crafting rows are client presentation, but their ids/output/station/cost are
// part of the server request and therefore need exact parity.
const browserRecipes = extractExpression(browserItemsSource, 'const CRAFT_RECIPES =');
const recipeStations = extractExpression(browserItemsSource, 'const CRAFT_RECIPE_STATIONS =');
const unityRecipeSource = read('unity-client/Assets/Scripts/Game/RoaCraftingData.cs');
const unityRecipes = [];
for (const match of unityRecipeSource.matchAll(/Recipe\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*(\d+),\s*"([^"]+)"([^)]*)\)/g)) {
  const tokens = [...match[6].matchAll(/"([^"]+)"|(-?\d+)/g)].map(row => row[1] ?? Number(row[2]));
  const cost = {};
  for (let i = 0; i + 1 < tokens.length; i += 2) cost[tokens[i]] = tokens[i + 1];
  unityRecipes.push({ id: match[1], name: match[2], outputId: match[3], outputQty: Number(match[4]), station: match[5], cost });
}
const expectedRecipes = browserRecipes.map(row => ({
  id: row.id,
  name: row.name,
  outputId: row.out.id,
  outputQty: Number(row.out.qty),
  station: recipeStations[row.id] || 'tool_bench',
  cost: normalizeCost(row.cost)
}));
const actualRecipes = unityRecipes.map(row => ({ ...row, cost: normalizeCost(row.cost) }));
assert.deepEqual(actualRecipes, expectedRecipes, 'Unity crafting catalog drifted from the browser client');

const craftedOutputIds = new Set(expectedRecipes.map(row => row.outputId));
const requiredCraftOutputIds = Object.values(browserItems)
  .filter(item => item.slot
    || item.type === 'ammo'
    || ['medkit', 'stim', 'doctorBag', 'antibiotics'].includes(item.id))
  .map(item => item.id)
  .sort();
const missingCraftOutputIds = requiredCraftOutputIds.filter(id => !craftedOutputIds.has(id));
assert.deepStrictEqual(missingCraftOutputIds, [],
  `Crafting catalog is missing weapons, equipment, ammo or medicine: ${missingCraftOutputIds.join(', ')}`);

const serverRecipeCosts = Object.fromEntries(Object.entries(
  extractExpression(server, 'const SERVER_CRAFT_RECIPE_COSTS ='))
  .map(([id, cost]) => [id, normalizeCost(cost)]));
const serverRecipeOutputs = Object.fromEntries(Object.entries(
  extractExpression(server, 'const SERVER_CRAFT_RECIPE_OUTPUTS ='))
  .map(([id, output]) => [id, { id: String(output.id), qty: Number(output.qty) }]));
const serverRecipeStations = Object.fromEntries(Object.entries(
  extractExpression(server, 'const SERVER_CRAFT_RECIPE_STATIONS =')));
const expectedServerCosts = Object.fromEntries(expectedRecipes.map(row => [row.id, row.cost]));
const expectedServerOutputs = Object.fromEntries(expectedRecipes
  .map(row => [row.id, { id: row.outputId, qty: row.outputQty }]));
const expectedServerStations = Object.fromEntries(expectedRecipes.map(row => [row.id, row.station]));
assert.deepStrictEqual(serverRecipeCosts, expectedServerCosts,
  'Server crafting costs drifted from the browser client');
assert.deepStrictEqual(serverRecipeOutputs, expectedServerOutputs,
  'Server crafting outputs drifted from the browser client');
assert.deepStrictEqual(serverRecipeStations, expectedServerStations,
  'Server crafting stations drifted from the browser client');

// Weapon modification effects are server-authoritative. The Unity UI still must
// expose each canonical modification in its correct slot.
const browserModSource = read('public/js/game/04e_weapon_modification_workbench.js');
const browserMods = extractExpression(browserModSource, 'const WEAPON_MODIFICATION_CATALOG = Object.freeze(');
const unityModSource = read('unity-client/Assets/Scripts/Game/RoaWeaponModificationData.cs');
const stringList = source => collect(source || '', /"([^"]+)"/g);
const unityMods = {};
for (const row of unityModSource.matchAll(/Mod\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*Cost\(([^)]*)\),\s*(Only\(([^)]*)\)|null)(?:,\s*Only\(([^)]*)\))?\)/g)) {
  const costTokens = [...row[5].matchAll(/"([^"]+)"|(-?\d+)/g)]
    .map(token => token[1] ?? Number(token[2]));
  const cost = {};
  for (let i = 0; i + 1 < costTokens.length; i += 2) cost[costTokens[i]] = costTokens[i + 1];
  unityMods[row[1]] = {
    slot: row[2],
    name: row[3],
    cost: normalizeCost(cost),
    weaponIds: row[6] === 'null' ? null : stringList(row[7]).sort(),
    excludeWeaponIds: row[8] ? stringList(row[8]).sort() : null
  };
}
assert.deepStrictEqual(Object.keys(unityMods).sort(), Object.keys(browserMods).sort(),
  'Unity weapon-modification ids drifted from the browser catalog');
for (const [id, row] of Object.entries(browserMods)) {
  assert.deepStrictEqual(unityMods[id], {
    slot: row.slot,
    name: row.name,
    cost: normalizeCost(row.cost),
    weaponIds: row.weaponIds ? [...row.weaponIds].sort() : null,
    excludeWeaponIds: row.excludeWeaponIds ? [...row.excludeWeaponIds].sort() : null
  }, `${id}: Unity weapon-modification presentation/compatibility drifted`);
}

// Creation choices that influence the initial authoritative join.
const serverTraits = collect(server.match(/const SERVER_START_TRAITS = new Set\(\[([^\]]+)\]\)/)?.[1] || '',
  /['"]([^'"]+)['"]/g);
const browserCreatorSource = read('public/js/game/08_character_creation_save.js');
const browserTraitRows = extractExpression(browserCreatorSource, 'const START_TRAITS =');
const browserStatRows = extractExpression(browserCreatorSource, 'const STAT_DEFS =');
const creator = read('unity-client/Assets/Scripts/Game/RoaCharacterCreator.cs');
const protocol = read('unity-client/Assets/Scripts/Net/RoaProtocol.cs');
const unityTraitRows = [...creator.matchAll(/new TraitDef\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)]
  .map(row => ({ id: row[1], name: row[2], desc: row[3] }));
const unityStatRows = [...creator.matchAll(/new StatDef\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)]
  .map(row => ({ key: row[1], code: row[2], name: row[3], desc: row[4] }));
assert.deepStrictEqual(unityTraitRows.map(row => row.id), serverTraits,
  'Unity starting traits drifted from server validation');
assert.deepStrictEqual(unityTraitRows, Array.from(browserTraitRows,
  ({ id, name, desc }) => ({ id, name, desc })),
  'Unity starting-trait labels drifted from the browser creator');
assert.deepStrictEqual(unityStatRows, Array.from(browserStatRows,
  ({ key, code, name, desc }) => ({ key, code, name, desc })),
  'Unity SPECIAL labels/tooltips drifted from the browser creator');
for (const marker of [
  'private static readonly string[] SexIds = { "male", "female" };',
  'private static readonly string[] BodyIds = { "slim", "medium", "large" };',
  'private static readonly string[] FaceSuffixes = { "01", "02", "03", "04" };',
  'public const int SpecialTotal = 40;',
  'public const int MaxTaggedSkills = 2;',
  'public const int MaxTraits = 2;'
]) assert(creator.includes(marker), `Unity character creation contract is missing: ${marker}`);
assert(protocol.includes('[JsonProperty("schema")] public string Schema = "realm.character-appearance.v1";')
  && protocol.includes('[JsonProperty("skinToneId")] public string SkinToneId = "skin_03";'),
  'Unity join appearance must include the browser schema and fixed skin tone');

// The browser creator is not only a form: it previews the selected GLB and
// applies face/hair variants live. Keep that visual feature in the Unity port.
const browserCharacterRuntime = read('public/js/game/04b_character_glb_runtime.js');
const unityPreview = read('unity-client/Assets/Scripts/Game/RoaCharacterPreview.cs');
const unityCharacterView = read('unity-client/Assets/Scripts/Game/RoaCharacterView.cs');
const unityBootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
assert(browserCharacterRuntime.includes('function setCharacterCreationPreviewAppearance(')
  && browserCharacterRuntime.includes('renderer.render(previewScene, camera);'),
  'Browser character preview contract changed; review Unity preview parity');
for (const marker of [
  'public const int PreviewLayer = 31;',
  'new RenderTexture(',
  'RenderPipeline.SubmitRenderRequest(_camera, request);',
  '_camera.cullingMask = 1 << PreviewLayer;',
  'SetLayerRecursively(_modelObject, PreviewLayer);',
  '_view.ApplyAppearance(_wantedAppearance);'
]) assert(unityPreview.includes(marker), `Unity live character preview is missing: ${marker}`);
assert(unityCharacterView.includes('public bool ApplyAppearance(CharacterAppearance appearance)')
  && unityBootstrap.includes('_characterPreview.Show(BaseUrl, _creator.Appearance,'),
  'Unity creator must update face/hair variants on the live GLB preview');

// Camera zoom is persistent in the browser. The Unity strategic map adds a
// mass-market pointer contract: a short primary click routes, a primary drag
// pans, right drag pans, and middle drag rotates the angled strategic camera.
const browserCamera = read('public/js/game/02_renderer_world_map.js');
const browserGlobalControls = read('public/js/game/12_global_map_canvas_controls.js');
const unityCamera = read('unity-client/Assets/Scripts/Game/RoaCameraRig.cs');
const unityGlobalMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const unityGlobalMapCanvas = read('unity-client/Assets/Scripts/Game/RoaGlobalMapCanvas.cs');
const unityCameraProbe = read('unity-client/Assets/Editor/RoaCameraProbe.cs');
const unityGlobalMapPresentationProbe = read('unity-client/Assets/Editor/RoaGlobalMapPresentationProbe.cs');
assert(browserCamera.includes("const CAMERA_ZOOM_STORAGE_KEY = 'realm.cameraZoomScale';")
  && unityCamera.includes('private const string ZoomPrefsKey = "roa.cameraDistance.v4";')
  && unityCamera.includes('private const string PreviousZoomPrefsKey = "roa.cameraDistance.v3";')
  && unityCamera.includes('private const string LegacyZoomPrefsKey = "roa.cameraDistance.v2";')
  && unityCamera.includes('PlayerPrefs.SetFloat(ZoomPrefsKey, Distance);')
  && unityCamera.includes('RoaGameBootstrap.BlocksWorldHud ? 0f'),
  'Unity local camera zoom must persist and ignore wheel input behind open UI');
assert(browserGlobalControls.includes('e.button !== 1 && e.button !== 2')
  && unityGlobalMap.includes('private bool UpdateCameraOrbit()')
  && unityGlobalMap.includes('Input.GetMouseButtonDown(2)')
  && unityGlobalMap.includes('StrategicCameraOrbit(CameraRig.PitchDeg, CameraRig.YawDeg, delta)')
  && unityGlobalMap.includes('bool pressed = Input.GetMouseButton(1);')
  && unityGlobalMap.includes('bool began = Input.GetMouseButtonDown(1);')
  && unityGlobalMap.includes('CameraRig.PitchDeg = StrategicDefaultPitchDeg;')
  && unityGlobalMap.includes('CameraRig.YawDeg = StrategicDefaultYawDeg;')
  && unityGlobalMap.includes('|| _cameraOrbiting || _mousePrimaryTracking')
  && unityGlobalMap.includes('_cameraOrbiting = false;')
  && unityGlobalMap.includes('CameraRig.ZoomPersistenceEnabled = false;')
  && unityGlobalMap.includes('private bool UpdateKeyboardCameraPan()')
  && unityGlobalMap.includes('KeyboardCameraPanMovement(input, CameraRig.Distance,')
  && unityGlobalMap.includes('ApplyCameraPanDelta(RightMousePanDelta(delta));')
  && unityGlobalMap.includes('return new Vector2(pointerDelta.x, -pointerDelta.y);')
  && unityGlobalMap.includes('CameraRig.MinDistance = StrategicMinimumCameraDistance(span);')
  && unityGlobalMap.includes('CameraRig.MaxDistance = StrategicMaximumCameraDistance(span);')
  && unityGlobalMap.includes('_cameraAnchor.transform.position = ClampCameraPan('),
  'Unity global map must retain independent zoom, camera-relative WASD, vertical-only inverted right-button panning and clamped middle-button orbit');
assert(unityGlobalMap.includes('private bool UpdateTouchMapInput()')
  && unityGlobalMap.includes('int count = Input.touchCount;')
  && unityGlobalMap.includes('events.IsPointerOverGameObject(touch.fingerId)')
  && unityGlobalMap.includes('CameraRig.SetDistance(PinchZoomDistance(')
  && unityGlobalMap.includes('ApplyCameraPanDelta(center - _pinchLastCenter);')
  && unityGlobalMap.includes('TouchTapEligible(')
  && unityGlobalMap.includes('private bool UpdateMouseMapInput()')
  && unityGlobalMap.includes('Input.GetMouseButtonDown(0)')
  && unityGlobalMap.includes('Input.GetMouseButtonUp(0)')
  && unityGlobalMap.includes('MouseTapEligible(')
  && unityGlobalMap.includes('SelectScreenPointAndMaybeTravel(screenPoint)')
  && unityGlobalMap.includes('Time.unscaledTime < _suppressSyntheticMouseUntil'),
  'Unity global map mouse/touch must share route selection while separating tap, drag, pinch and synthetic mouse input');
assert(unityGlobalMapCanvas.includes('TouchGestureHelp')
  && unityGlobalMapCanvas.includes('КАСАНИЕ — МАРШРУТ')
  && unityGlobalMapCanvas.includes('ПОТЯНУТЬ — ОБЗОР')
  && unityGlobalMapCanvas.includes('ЩИПОК — МАСШТАБ')
  && unityGlobalMapCanvas.includes('ЗАЖАТЬ КОЛЕСО — УГОЛ')
  && unityGlobalMapCanvas.includes('WASD/ТЯНУТЬ — ОБЗОР')
  && unityGlobalMapCanvas.includes('ПКМ — ИНВ. Y'),
  'Unity global map does not explain its mobile gestures, WASD, inverted RMB and desktop middle-button orbit');
assert(unityCameraProbe.includes('короткое касание не выбирает маршрут')
  && unityCameraProbe.includes('ЛКМ не отделяет короткий выбор маршрута от перетаскивания карты')
  && unityCameraProbe.includes('pinch карты меняет масштаб в неверном направлении')
  && unityCameraProbe.includes('Canvas-подпись активности перекрывает панель')
  && unityCameraProbe.includes('экранная подпись неверно переводится')
  && unityCameraProbe.includes('пул Canvas-подписей карты не ограничен')
  && unityCameraProbe.includes('orbit=55/45+MMB')
  && unityCameraProbe.includes('pointer=tap/drag/pinch-pan, labels=canvas/activities'),
  'Unity camera probe does not cover the global-map gesture and Canvas-label contract');
assert(unityGlobalMap.includes('public int CollectOverlayLabels(List<OverlayLabel> output)')
  && unityGlobalMap.includes('_activityOverlayLabels.Add(new ActivityOverlayState')
  && unityGlobalMap.includes('case "escort_caravan": return "Караван";')
  && unityGlobalMap.includes('case "assault_diversion": return "Штурм / диверсия";')
  && unityGlobalMap.includes('public static bool TryResolveOverlayLabelRect(')
  && unityGlobalMap.includes('blocked.Contains(point)')
  && unityGlobalMap.includes('candidate.Overlaps(blocked)'),
  'Unity global map no longer exports collision-safe settlement and activity labels');
assert(unityGlobalMapCanvas.includes('MapOverlayLabels')
  && unityGlobalMapCanvas.includes('private void LateUpdate()')
  && unityGlobalMapCanvas.includes('EnsureMapLabelPool(8)')
  && unityGlobalMapCanvas.includes('background.raycastTarget = false;')
  && unityGlobalMapCanvas.includes('TryResolveOverlayLabelRect(point, sidebar, _occupiedMapLabels')
  && unityGlobalMapCanvas.includes('_occupiedMapLabels.Add(resolved);')
  && unityGlobalMapCanvas.includes('CanvasPositionForScreenRect(')
  && unityGlobalMapCanvas.includes('RouteProgressTrack')
  && unityGlobalMapCanvas.includes('SetRouteProgress(Map.TravelActive, Map.TravelProgress, Map.HasPendingContact)')
  && unityGlobalMapCanvas.includes('RouteProgressColor(bool contact)')
  && unityGlobalMapCanvas.includes('ListSignatureChanged(ref _workSignature')
  && unityGlobalMapCanvas.includes('ListSignatureChanged(ref _partySignature')
  && unityGlobalMapCanvas.includes('BuildWorkSignature(string siteKey')
  && unityGlobalMap.includes('if (!IsActive || !InputEnabled || CanvasDriven) return;'),
  'Unity global-map labels are not rendered by a pooled, input-transparent and scale-aware Canvas');
assert(unityCameraProbe.includes('route=progress/contact')
  && unityCameraProbe.includes('mapCanvas.RouteProgressFill - 0.42f')
  && unityCameraProbe.includes('полоса маршрута остаётся без активного пути'),
  'Unity camera probe does not cover route progress visibility and contact warning');
assert(unityCameraProbe.includes('lists=stable')
  && unityCameraProbe.includes('!RoaGlobalMapCanvas.ListSignatureChanged(ref cachedSignature, workSame)')
  && unityCameraProbe.includes('неизменная доска контрактов пересобирается'),
  'Unity camera probe does not protect stable global-map lists from periodic rebuilds');
assert(unityGlobalMap.includes('public bool FocusPlayerOnMap()')
  && unityGlobalMap.includes('public static Color RouteVisualColor(')
  && unityGlobalMap.includes('public static float RouteVisualScale(')
  && unityGlobalMap.includes('InfrastructureLabelLimit = 3')
  && unityGlobalMap.includes('InfrastructureShortTitle(')
  && unityGlobalMap.includes('_routeVisualProgress.Add(routeProgress);')
  && unityGlobalMap.includes('PresentationWinners(DynamicVisualLayer.Site')
  && unityGlobalMapCanvas.includes('RouteStateBadge')
  && unityGlobalMapCanvas.includes('RouteRiskBadge')
  && unityGlobalMapCanvas.includes('JourneyFlow')
  && unityGlobalMapCanvas.includes('"ЦЕЛЬ", "ПУТЬ", "ПРИБЫТИЕ", "ЛОКАЦИЯ"')
  && unityGlobalMapCanvas.includes('ResolveJourneyStage(')
  && unityGlobalMapCanvas.includes('Вход — автоматически')
  && unityGlobalMapCanvas.includes('Кликните по локации ещё раз, чтобы войти')
  && unityGlobalMapCanvas.includes('_mapLabelFrames.Sort(CompareOverlayLabels);')
  && unityGlobalMapCanvas.includes('SidebarHeight(mobile, expanded, contact, viewHeight)')
  && unityGlobalMapCanvas.includes('MapContextText(Map.DetailTierLabel')
  && unityGlobalMapCanvas.includes('Map.RouteRequestPending')
  && unityGlobalMapCanvas.includes('"МЕНЯЕМ ПУТЬ" : "РАСЧЁТ ПУТИ"')
  && !unityGlobalMapCanvas.includes('Нажмите «Войти»'),
  'Unity global map 2.0 must keep a decision card, prioritized labels, route stages and click-to-enter guidance');
assert(unityGlobalMapPresentationProbe.includes('[GLOBAL MAP & TRAVEL 4.6] готово')
  && unityGlobalMapPresentationProbe.includes('labels[0].Id == "selected"')
  && unityGlobalMapPresentationProbe.includes('MapJourneyStage.Arrival')
  && unityGlobalMapPresentationProbe.includes('RouteVisualColor(0.2f, 0.6f')
  && unityGlobalMapPresentationProbe.includes('RouteVisualScale(0.6f, 0.6f')
  && unityGlobalMapPresentationProbe.includes('InfrastructureLabelLimit == 3')
  && unityGlobalMapPresentationProbe.includes('buttons.Contains("К ИГРОКУ")')
  && unityGlobalMapPresentationProbe.includes('!buttons.Contains("Войти")')
  && auditRunner.includes('typeof(RoaGlobalMapPresentationProbe)'),
  'Unity audit does not protect the global map 2.0 presentation contract');
assert(unityGlobalMap.includes('public bool RouteRequestPending')
  && unityGlobalMap.includes('_routeRequestPending = true;')
  && unityGlobalMap.includes('if (rerouting) RestoreTravelDestinationSelection();')
  && unityGlobalMap.includes('private void RestoreTravelDestinationSelection()')
  && unityGlobalMap.includes('bool selectedActivityLabelAdded = false;')
  && unityGlobalMap.includes('&& !selectedActivityLabelAdded'),
  'Unity global-map reroute must remain transactional and selected labels must not duplicate');
assert(unityGlobalMap.includes('TravelDescriptorGraceSeconds = 2.5f')
  && unityGlobalMap.includes('bool preserveFreshTravel = preserveIdleSelection')
  && unityGlobalMap.includes('else if (!preserveFreshTravel) ClearTravel();')
  && unityGlobalMap.includes('_travelDescriptorGraceUntil = Time.realtimeSinceStartup + TravelDescriptorGraceSeconds;'),
  'Unity must not let a queued stale global-map snapshot erase a newly acknowledged route');
assert(unityGlobalMap.includes('public bool LocationEntryPending')
  && unityGlobalMap.includes('|| _locationEntryPending) return;')
  && unityGlobalMap.includes('_locationEntryPending = true;')
  && unityGlobalMap.includes('_locationEntryPending = false;')
  && server.includes('selectRoomWorldActivityTask(tasks.filter')
  && server.includes('selectRoomWorldActivityTask')
  && server.includes('worldTaskTrackedId'),
  'Global-map arrival must be single-flight and start the tracked world activity');

console.log(`Unity client parity OK: ${webEmits.length} outgoing events, ${webHandlers.length} incoming events, `
  + `${Object.keys(unityItems).length} items, ${actualRecipes.length} recipes, `
  + `${Object.keys(unityMods).length} weapon modifications, ${unityTraitRows.length} starting traits, `
  + 'live GLB preview, persistent camera zoom/map pan/touch and live Canvas labels');
