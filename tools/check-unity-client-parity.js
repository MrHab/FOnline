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
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const auth = read('unity-client/Assets/Scripts/Net/RoaAuthClient.cs');
const uiScale = read('unity-client/Assets/Scripts/Game/RoaUiScale.cs');
const offlineProbe = read('unity-client/Assets/Editor/RoaOfflineResilienceProbe.cs');
const auditRunner = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const hudCanvas = read('unity-client/Assets/Scripts/Game/RoaHudCanvas.cs');
const hudProbe = read('unity-client/Assets/Editor/RoaHudCanvasProbe.cs');

assert(uiScale.includes('return mobile ? new Vector2(1280f, 720f) : new Vector2(1600f, 900f);'),
  'Unity UI must keep readable 1600x900 desktop and 1280x720 mobile references');

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
assert.deepStrictEqual(unityHandlers, webHandlers.filter(name => !lifecycle.includes(name)),
  'Unity must handle every non-lifecycle event handled by the production browser client');
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
const server = read('server.js');
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

// Camera zoom is persistent in the browser and global-map panning is a distinct
// middle/right-button gesture. Preserve both client-only behaviours in Unity.
const browserCamera = read('public/js/game/02_renderer_world_map.js');
const browserGlobalControls = read('public/js/game/12_global_map_canvas_controls.js');
const unityCamera = read('unity-client/Assets/Scripts/Game/RoaCameraRig.cs');
const unityGlobalMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const unityGlobalMapCanvas = read('unity-client/Assets/Scripts/Game/RoaGlobalMapCanvas.cs');
const unityCameraProbe = read('unity-client/Assets/Editor/RoaCameraProbe.cs');
assert(browserCamera.includes("const CAMERA_ZOOM_STORAGE_KEY = 'realm.cameraZoomScale';")
  && unityCamera.includes('private const string ZoomPrefsKey = "roa.cameraDistance.v2";')
  && unityCamera.includes('PlayerPrefs.SetFloat(ZoomPrefsKey, Distance);')
  && unityCamera.includes('RoaGameBootstrap.BlocksWorldHud ? 0f'),
  'Unity local camera zoom must persist and ignore wheel input behind open UI');
assert(browserGlobalControls.includes('e.button !== 1 && e.button !== 2')
  && unityGlobalMap.includes('Input.GetMouseButtonDown(1) || Input.GetMouseButtonDown(2)')
  && unityGlobalMap.includes('CameraRig.ZoomPersistenceEnabled = false;')
  && unityGlobalMap.includes('_cameraAnchor.transform.position = ClampCameraPan('),
  'Unity global map must retain independent zoom and middle/right-button panning');
assert(unityGlobalMap.includes('private bool UpdateTouchMapInput()')
  && unityGlobalMap.includes('int count = Input.touchCount;')
  && unityGlobalMap.includes('events.IsPointerOverGameObject(touch.fingerId)')
  && unityGlobalMap.includes('CameraRig.SetDistance(PinchZoomDistance(')
  && unityGlobalMap.includes('TouchTapEligible(')
  && unityGlobalMap.includes('private void UpdateMouseMapSelection()')
  && unityGlobalMap.includes('Input.GetMouseButtonDown(0)')
  && unityGlobalMap.includes('SelectScreenPointAndMaybeTravel(screenPoint)')
  && unityGlobalMap.includes('Time.unscaledTime < _suppressSyntheticMouseUntil'),
  'Unity global map mouse/touch must share route selection while separating tap, drag, pinch and synthetic mouse input');
assert(unityGlobalMapCanvas.includes('TouchGestureHelp')
  && unityGlobalMapCanvas.includes('КАСАНИЕ — МАРШРУТ')
  && unityGlobalMapCanvas.includes('ПОТЯНУТЬ — ОБЗОР')
  && unityGlobalMapCanvas.includes('ЩИПОК — МАСШТАБ'),
  'Unity global map does not explain its touch gestures on mobile');
assert(unityCameraProbe.includes('короткое касание не выбирает маршрут')
  && unityCameraProbe.includes('pinch карты меняет масштаб в неверном направлении')
  && unityCameraProbe.includes('Canvas-подпись активности перекрывает панель')
  && unityCameraProbe.includes('экранная подпись неверно переводится')
  && unityCameraProbe.includes('пул Canvas-подписей карты не ограничен')
  && unityCameraProbe.includes('touch=tap/drag/pinch, labels=canvas/activities'),
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
  && unityCameraProbe.includes('неизменная доска работ пересобирается'),
  'Unity camera probe does not protect stable global-map lists from periodic rebuilds');
assert(unityGlobalMap.includes('TravelDescriptorGraceSeconds = 2.5f')
  && unityGlobalMap.includes('bool preserveFreshTravel = preserveIdleSelection')
  && unityGlobalMap.includes('else if (!preserveFreshTravel) ClearTravel();')
  && unityGlobalMap.includes('_travelDescriptorGraceUntil = Time.realtimeSinceStartup + TravelDescriptorGraceSeconds;'),
  'Unity must not let a queued stale global-map snapshot erase a newly acknowledged route');

console.log(`Unity client parity OK: ${webEmits.length} outgoing events, ${webHandlers.length} incoming events, `
  + `${Object.keys(unityItems).length} items, ${actualRecipes.length} recipes, `
  + `${Object.keys(unityMods).length} weapon modifications, ${unityTraitRows.length} starting traits, `
  + 'live GLB preview, persistent camera zoom/map pan/touch and live Canvas labels');
