#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Unity — единственный клиент. Источник правды для сверки — авторитетный сервер
// (server.js) и авторские данные data/kromka; прежний браузерный клиент удалён.
const ROOT = path.resolve(__dirname, '..');
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

const unity = sourceTree(UNITY_DIR, '.cs');
const server = read('server.js');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const barterCanvas = read('unity-client/Assets/Scripts/Game/RoaBarterCanvas.cs');
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

// Unity -> server. Unity normally sends through RoaSocketClient.Emit/EmitWithAck.
// join/state use the lower transport (EmitAsync) directly. Four UI branches choose
// the event at runtime; keep their domains explicit so a new unreviewed dynamic
// event fails the audit. check-socket-event-contract.js uses the same detection.
const unityTransportEmits = [];
for (const match of unity.matchAll(/\b(?:Socket\.)?Emit(?:WithAck)?\(\s*"([^"]+)"|\b[A-Za-z_][A-Za-z0-9_]*\.EmitAsync\(\s*"([^"]+)"/g))
  unityTransportEmits.push(match[1] || match[2]);

const dynamicUnityEvents = [
  'lootEnemy', 'lootWorldContainer',
  'hackTerminal', 'pickLock',
  'npcTradeExchange'
];
assert(interaction.includes('string eventName = _panel == PanelKind.Corpse ? "lootEnemy" : "lootWorldContainer";')
  && interaction.includes('Socket.EmitWithAck(eventName, payload'),
  'Unity corpse/container loot must keep a closed two-event dynamic domain');
assert(interaction.includes('SecurityAction("hackTerminal")')
  && interaction.includes('SecurityAction("pickLock")')
  && interaction.includes('Socket.EmitWithAck(action, new Dictionary<string, object>'),
  'Unity security action must keep a closed hackTerminal/pickLock event domain');
assert(interaction.includes('Socket.EmitWithAck("npcTradeExchange", payload')
  && !interaction.includes('tradeMachine') && !interaction.includes('TradeMachine'),
  'Unity trade must talk only to NPC traders: trade machines are gone');

assert(server.includes('Object.entries(SERVER_ITEM_BASE_PRICES)')
  && server.includes('Math.floor(Number(price) * 0.45)'),
  'server barter sell prices must derive from the authoritative item catalog');
assert(barterCanvas.includes('int catalogPrice = RoaItemData.BasePrice(baseId);')
  && barterCanvas.includes('Mathf.FloorToInt(catalogPrice * 0.45f)'),
  'Unity barter previews must derive from the downloaded item catalog');
assert(barterCanvas.includes('TradeSkillNorm(self) * 0.24d')
  && barterCanvas.includes('TalentLevel(self, "merchant", 3) * 0.05d')
  && barterCanvas.includes('TradeSkillNorm(self) * 0.30d')
  && barterCanvas.includes('TalentLevel(self, "merchant", 3) * 0.08d')
  && barterCanvas.includes('HasTrait(self, "traderStart") ? 0.15d')
  && barterCanvas.includes('interested ? 1.24d : 0.84d'),
  'Unity barter totals no longer mirror the server discount, bonus, cap, or interest formula');
// Доля Торговца базы входит в обе цены и на сервере, и в смете клиента, а потолок
// продажи считается от цены покупки без неё — иначе житель удешевлял бы продажу.
assert(/TalentLevel\(self, "merchant", 3\) \* 0\.05d\s*\+ \(includeResident \? ResidentTradePct\(self\) : 0d\)/.test(barterCanvas)
  && /TalentLevel\(self, "merchant", 3\) \* 0\.08d\s*\+ ResidentTradePct\(self\);/.test(barterCanvas)
  && barterCanvas.includes('TradeBuyPriceCore(stockPriceForItem, self, false) * 0.85d')
  && /serverTalentLevel\(player, 'merchant'\) \* 0\.05\s*\+ \(includeResident \? serverResidentTradePct\(player\) : 0\)/.test(server)
  && /serverTalentLevel\(player, 'merchant'\) \* 0\.08\s*\+ serverResidentTradePct\(player\);/.test(server)
  && server.includes('serverTradeBuyPrice(stockEntry, player, false) * 0.85')
  && /Math\.Min\(0\.48d/.test(barterCanvas) && server.includes('const SERVER_TRADE_MAX_BUY_DISCOUNT = 0.48;'),
  'Unity barter no longer mirrors the base trader share or the resident-free sell cap');
// Перепродажа проданного товара: даже наибольшая скидка не делает выкуп дешевле продажи.
assert(server.includes('Math.ceil((sellPrice + 1) / (1 - SERVER_TRADE_MAX_BUY_DISCOUNT))'),
  'NPC resale price no longer outruns the largest buy discount');
assert(barterCanvas.includes('TradeSellPrice(baseId, market, self)')
  && barterCanvas.includes('TradeBuyPrice(StockPrice(market, baseId), self)'),
  'Unity barter ledger is not using the authoritative-price mirror for both sides');
assert.deepStrictEqual(
  (unity.match(/\bSocket\.EmitWithAck\(\s*[A-Za-z_][A-Za-z0-9_]*/g) || []).sort(),
  ['Socket.EmitWithAck(action', 'Socket.EmitWithAck(eventName'],
  'Every dynamic Unity EmitWithAck call must remain one of the audited loot/security/trade call sites'
);

// Каждое событие, которое шлёт Unity, обязано иметь socket.on на сервере.
const unityEmits = uniqueSorted([...unityTransportEmits, ...dynamicUnityEvents]);
const serverHandlers = uniqueSorted(collect(server, /\bsocket\.on\(\s*(['"])([^'"]+)\1/g, 2));
const unityEmitsWithoutServerHandler = unityEmits.filter(name => !serverHandlers.includes(name));
assert.deepStrictEqual(unityEmitsWithoutServerHandler, [],
  `Unity emits event(s) without a server socket.on handler: ${unityEmitsWithoutServerHandler.join(', ')}`);
// Обработчики сервера, которых Unity не вызывает. Список закрытый и пересмотренный:
// новый обработчик без отправителя в Unity должен либо получить отправителя,
// либо попасть сюда с объяснением.
const serverOnlyHandlers = [
  'changeRoom', // синоним changeLocation (тот же обработчик) для прежних клиентов и инструментов
  'disconnect', // жизненный цикл Socket.IO: событие поднимает сам транспорт, а не клиентский emit
  'globalMapCreateAmbush', // заглушка совместимости: засады на карте отключены, всегда отказ
  'input', // прежний канал осевого ввода; движение Unity идёт через state
  'worldTaskJoinParty', // заглушка совместимости: вступление в группу только через работу пустоши (worldTaskAction)
  'worldTaskLeaveParty' // заглушка совместимости: выход из группы только отменой работы пустоши (worldTaskAction)
];
assert.deepStrictEqual(
  serverHandlers.filter(name => !unityEmits.includes(name)),
  serverOnlyHandlers,
  'Server handlers without a Unity emit must stay limited to the reviewed transport/compatibility list');

// Server -> Unity. Серверные события — литеральные .emit('…') (socket.emit,
// io.to(…).emit, target.emit…) плюс литеральные вызовы emitGlobalTravelToParty;
// это та же выборка, что в check-socket-event-contract.js, который следит, чтобы
// других динамических emit на сервере не было. Socket lifecycle has first-class
// callbacks in the C# transport rather than named user-event handlers.
const serverEmits = uniqueSorted([
  ...collect(server, /\.emit\(\s*(['"])([^'"]+)\1/g, 2),
  ...collect(server, /\bemitGlobalTravelToParty\(\s*[^,\n]+,\s*(['"])([^'"]+)\1/g, 2)
]);
const lifecycle = ['connect', 'connect_error', 'disconnect'];
const unityHandlers = uniqueSorted(collect(unity, /\b_connection\.On\(\s*"([^"]+)"/g));
const serverEmitsWithoutUnityHandler = serverEmits
  .filter(name => !lifecycle.includes(name) && !unityHandlers.includes(name));
assert.deepStrictEqual(serverEmitsWithoutUnityHandler, [],
  `Unity must handle every non-lifecycle event the server emits: ${serverEmitsWithoutUnityHandler.join(', ')}`);
// И обратно: обработчик события, которого сервер не шлёт, — мёртвый код (включая
// lifecycle, заведённый через _connection.On вместо колбэков транспорта).
const unityHandlersWithoutServerEmit = unityHandlers.filter(name => !serverEmits.includes(name));
assert.deepStrictEqual(unityHandlersWithoutServerEmit, [],
  `Unity handles event(s) the server never emits: ${unityHandlersWithoutServerEmit.join(', ')}`);
assert(socket.includes('_connection.OnConnected +=')
  && socket.includes('_connection.OnConnectError +=')
  && socket.includes('_connection.OnDisconnected +='),
  'Unity transport lifecycle callbacks are incomplete');

// HTTP. Every /api/… path Unity requests must be a server route. A non-literal
// part of a concatenation ("/api/characters/" + EscapeURL(id) + "/save") is a
// path parameter and matches a server :param segment only.
const serverHttpRoutes = uniqueSorted([...server.matchAll(
  /\bapp\.(?:get|post|put|patch|delete|all)\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)]
  .flatMap(match => collect(match[1], /(['"])([^'"]+)\1/g, 2)));
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const serverHttpPatterns = serverHttpRoutes.map(route => new RegExp('^' + route.split('/')
  .map(segment => (segment.startsWith(':') ? '[^/]+' : escapeRegExp(segment)))
  .join('/') + '$'));
const unityHttpRoute = (literal, tail) => (literal + [...tail.matchAll(/\+\s*(?:"([^"]*)"|[^;+"\n]+)/g)]
  .map(part => part[1] ?? '{param}')
  .join('')).split('?')[0].replace(/(.)\/+$/, '$1');
const unityHttpRoutes = uniqueSorted(
  [...unity.matchAll(/"(\/api\/[^"]*)"((?:\s*\+\s*(?:"[^"]*"|[^;+"\n]+))*)/g)]
    .map(match => unityHttpRoute(match[1], match[2])));
const unknownUnityHttpRoutes = unityHttpRoutes
  .filter(route => !serverHttpPatterns.some(pattern => pattern.test(route)));
assert.deepStrictEqual(unknownUnityHttpRoutes, [],
  `Unity requests HTTP route(s) the server does not serve: ${unknownUnityHttpRoutes.join(', ')}`);
// Unity deliberately keeps the bearer token process-local and authenticates by
// login/register each launch (no /api/auth/me restore of a persisted token).
assert(auth.includes('он живёт в памяти процесса') && auth.includes('PlayerPrefs пишется только deviceId'),
  'Unity must keep the bearer token process-local and persist only the deviceId in PlayerPrefs');
assert(auth.includes('"/api/characters/" + UnityWebRequest.EscapeURL(characterId)')
  && auth.includes('+ "/save"'),
  'Unity is missing the dynamic character load/save/delete routes');

// Unity bakes the item and field-recipe catalogs as a fallback and replaces both
// with the server copies of data/kromka/*.json on start (/api/kromka/items).
assert(server.includes("path.join(BUNDLED_DATA_DIR, 'kromka', 'items.json')")
  && server.includes("path.join(BUNDLED_DATA_DIR, 'kromka', 'field-recipes.json')")
  && server.includes('catalog: publicItemCatalog(KROMKA_ITEM_CATALOG),')
  && server.includes('fieldRecipes: publicFieldRecipeCatalog(KROMKA_FIELD_RECIPE_CATALOG)')
  && bootstrap.includes('RoaItemData.ApplyCatalog(catalog, out catalogError)')
  && bootstrap.includes('RoaCraftingData.ApplyCatalog(fieldRecipes, out catalogError)'),
  'Unity must replace its baked item/recipe fallbacks with the server catalogs from data/kromka');

// Static item presentation must cover every authored base id and exact weight;
// unknown runtime suffixes are resolved to these base ids by RoaInventory.BaseId.
const itemCatalog = JSON.parse(read('data/kromka/items.json'));
const authoredItems = Object.fromEntries((itemCatalog.items || []).map(row => [row.id, row]));
const unityItemSource = read('unity-client/Assets/Scripts/Game/RoaItemData.cs');
const unityItems = {};
for (const match of unityItemSource.matchAll(/Add\(result,\s*"([^"]+)",\s*"([^"]*)",\s*(-?\d+(?:\.\d+)?)f?\);/g))
  unityItems[match[1]] = { name: match[2], weight: Number(match[3]) };
assert.deepStrictEqual(Object.keys(unityItems).sort(), Object.keys(authoredItems).sort(),
  'Unity item catalog drifted from data/kromka/items.json');
const itemNameDrift = [];
for (const [id, item] of Object.entries(authoredItems)) {
  if (unityItems[id].name !== item.name)
    itemNameDrift.push(`${id}: ${JSON.stringify(unityItems[id].name)} != ${JSON.stringify(item.name)}`);
  assert(Math.abs(unityItems[id].weight - Number(item.weight || 0)) < 1e-6,
    `${id}: Unity item weight drifted from data/kromka/items.json`);
}
assert.deepStrictEqual(itemNameDrift, [],
  `Unity item names drifted from data/kromka/items.json:\n${itemNameDrift.join('\n')}`);
assert.strictEqual(unityItems.silver?.name, 'Марки Тракта', 'silver: Kromka player-facing item name drifted');

// Crafting rows are client presentation, but their ids/output/station/cost are
// part of the server request and therefore need exact parity, in authored order.
const authoredRecipeCatalog = JSON.parse(read('data/kromka/field-recipes.json'));
const authoredRecipes = (authoredRecipeCatalog.recipes || []).map(row => ({
  id: String(row.id),
  name: String(row.name),
  outputId: String(row.output?.id),
  outputQty: Number(row.output?.qty),
  station: String(row.station),
  cost: normalizeCost(row.inputs)
}));
const unityRecipeSource = read('unity-client/Assets/Scripts/Game/RoaCraftingData.cs');
const unityRecipes = [];
for (const match of unityRecipeSource.matchAll(/Recipe\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*(\d+),\s*"([^"]+)"([^)]*)\)/g)) {
  const tokens = [...match[6].matchAll(/"([^"]+)"|(-?\d+)/g)].map(row => row[1] ?? Number(row[2]));
  const cost = {};
  for (let i = 0; i + 1 < tokens.length; i += 2) cost[tokens[i]] = tokens[i + 1];
  unityRecipes.push({ id: match[1], name: match[2], outputId: match[3], outputQty: Number(match[4]), station: match[5], cost });
}
const actualRecipes = unityRecipes.map(row => ({ ...row, cost: normalizeCost(row.cost) }));
const recipeMechanics = rows => rows.map(({ id, outputId, outputQty, station, cost }) => ({
  id,
  outputId,
  outputQty,
  station,
  cost: normalizeCost(cost)
}));
assert.deepStrictEqual(recipeMechanics(actualRecipes), recipeMechanics(authoredRecipes),
  'Unity crafting mechanics drifted from data/kromka/field-recipes.json');
assert.deepStrictEqual(
  actualRecipes.map(({ id, name }) => ({ id, name })),
  authoredRecipes.map(({ id, name }) => ({ id, name })),
  'Unity crafting names drifted from data/kromka/field-recipes.json');

// Every character-slot item (except the intrinsic fists), all ammo and all aid
// must be producible by field crafting.
const characterEquipmentSlots = new Set(['weapon', 'armor', 'helmet', 'boots', 'backpack']);
const craftedOutputIds = new Set(authoredRecipes.map(row => row.outputId));
const requiredCraftOutputIds = Object.values(authoredItems)
  .filter(item => !(item.acquisition || []).includes('intrinsic'))
  .filter(item => characterEquipmentSlots.has(item.slot) || ['ammo', 'aid'].includes(item.category))
  .map(item => item.id)
  .sort();
const missingCraftOutputIds = requiredCraftOutputIds.filter(id => !craftedOutputIds.has(id));
assert.deepStrictEqual(missingCraftOutputIds, [],
  `Crafting catalog is missing weapons, equipment, ammo or medicine: ${missingCraftOutputIds.join(', ')}`);
assert(server.includes('const SERVER_CRAFT_RECIPE_COSTS = KROMKA_FIELD_RECIPE_INDEXES.costs;')
  && server.includes('const SERVER_CRAFT_RECIPE_OUTPUTS = KROMKA_FIELD_RECIPE_INDEXES.outputs;')
  && server.includes('const SERVER_CRAFT_RECIPE_STATIONS = KROMKA_FIELD_RECIPE_INDEXES.stations;'),
  'Server crafting must read all costs, outputs and stations from the Kromka recipe catalog');

// Weapon modification effects are server-authoritative. The Unity UI still must
// expose each canonical modification of SERVER_WEAPON_MODIFICATION_CATALOG in its
// correct slot, with the server cost, compatibility and effect preview.
const serverMods = extractExpression(server, 'const SERVER_WEAPON_MODIFICATION_CATALOG = Object.freeze(');
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
    cost: normalizeCost(cost),
    weaponIds: row[6] === 'null' ? null : stringList(row[7]).sort(),
    excludeWeaponIds: row[8] ? stringList(row[8]).sort() : null
  };
}
assert.deepStrictEqual(Object.keys(unityMods).sort(), Object.keys(serverMods).sort(),
  'Unity weapon-modification ids drifted from the server catalog');
for (const [id, row] of Object.entries(serverMods)) {
  assert.deepStrictEqual(unityMods[id], {
    slot: row.slot,
    cost: normalizeCost(row.cost),
    weaponIds: row.weaponIds ? [...row.weaponIds].sort() : null,
    excludeWeaponIds: row.excludeWeaponIds ? [...row.excludeWeaponIds].sort() : null
  }, `${id}: Unity weapon-modification slot/cost/compatibility drifted from the server`);
}
// Превью верстака: Effects(описание, урон×, дальность×, точность+, магазин×,
// магазин+, темп×, ОД перезарядки+). У магазина+ нет серверного аналога — только 0.
const unityModEffects = {};
for (const row of unityModSource.matchAll(/\{\s*"([^"]+)",\s*new Effects\("(?:[^"\\]|\\.)*",\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*(-?\d+),\s*(-?[\d.]+)f,\s*(-?\d+)\)\s*\}/g)) {
  const [damageMul, rangeMul, accuracyBonus, magMul, magazineBonus, fireRateMul, reloadApDelta] = row.slice(2).map(Number);
  unityModEffects[row[1]] = { damageMul, rangeMul, accuracyBonus, magMul, magazineBonus, fireRateMul, reloadApDelta };
}
assert.deepStrictEqual(Object.keys(unityModEffects).sort(), Object.keys(serverMods).sort(),
  'Unity weapon-modification effect previews drifted from the server catalog');
for (const [id, row] of Object.entries(serverMods)) {
  const effects = row.effects || {};
  assert.deepStrictEqual(unityModEffects[id], {
    damageMul: effects.damageMul ?? 1,
    rangeMul: effects.rangeMul ?? 1,
    accuracyBonus: effects.accuracyBonus ?? 0,
    magMul: effects.magMul ?? 1,
    magazineBonus: 0,
    fireRateMul: effects.fireRateMul ?? 1,
    reloadApDelta: effects.reloadApDelta ?? 0
  }, `${id}: Unity weapon-modification effect preview drifted from the server`);
}

// Creation choices that influence the initial authoritative join. Unity bakes the
// data/kromka/character-progression.json rows as a fallback; ApplyCatalog rejects
// a server catalog whose stat/trait ids differ and takes descriptions from it.
const progressionCatalog = JSON.parse(read('data/kromka/character-progression.json'));
const creator = read('unity-client/Assets/Scripts/Game/RoaCharacterCreator.cs');
const protocol = read('unity-client/Assets/Scripts/Net/RoaProtocol.cs');
const unityTraitRows = [...creator.matchAll(/new TraitDef\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)]
  .map(row => ({ id: row[1], name: row[2], desc: row[3] }));
const unityStatRows = [...creator.matchAll(/new StatDef\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)]
  .map(row => ({ key: row[1], code: row[2], name: row[3], desc: row[4] }));
assert.deepStrictEqual(unityTraitRows.map(({ id, name }) => ({ id, name })),
  progressionCatalog.startTraits.items.map(({ id, name }) => ({ id, name })),
  'Unity starting traits drifted from data/kromka/character-progression.json (startTraits)');
assert.deepStrictEqual(unityStatRows.map(({ key, code, name }) => ({ id: key, code, name })),
  progressionCatalog.special.stats.map(({ id, code, name }) => ({ id, code, name })),
  'Unity character stats drifted from data/kromka/character-progression.json (special)');
assert(creator.includes('stat.Description = CatalogText(row, "description", stat.Description);')
  && creator.includes('trait.Description = CatalogText(row, "description", trait.Description);')
  && bootstrap.includes('RoaCharacterCreator.ApplyCatalog(catalog, out creatorError)'),
  'Unity creator must take stat and trait descriptions from the server progression catalog');
assert.deepStrictEqual(unityStatRows.map(({ key, code, name }) => ({ key, code, name })), [
  { key: 'str', code: 'МЩ', name: 'Мощь' },
  { key: 'per', code: 'НБ', name: 'Наблюдательность' },
  { key: 'end', code: 'СТ', name: 'Стойкость' },
  { key: 'cha', code: 'ВЛ', name: 'Влияние' },
  { key: 'int', code: 'ИН', name: 'Интеллект' },
  { key: 'agi', code: 'РЕ', name: 'Реакция' },
  { key: 'luck', code: 'ЧУ', name: 'Чутьё' }
], 'Unity character-stat labels drifted from Kromka terminology');
for (const row of unityStatRows) {
  assert(row.desc.startsWith('Формулы:') && row.desc.includes(row.name),
    `${row.key}: Kromka character-stat tooltip lost its formula or display name`);
}
for (const marker of [
  'private static readonly string[] SexIds = { "male", "female" };',
  'private static readonly string[] BodyIds = { "slim", "medium", "large" };',
  'private static readonly string[] FaceSuffixes = { "01", "02", "03", "04" };',
  `public static int SpecialTotal { get; private set; } = ${progressionCatalog.special.budget};`,
  `public static int MaxTaggedSkills { get; private set; } = ${progressionCatalog.taggedSkills.max};`,
  `public static int MaxTraits { get; private set; } = ${progressionCatalog.startTraits.max};`,
  'public static bool ApplyCatalog(JObject catalog, out string error)'
]) assert(creator.includes(marker), `Unity character creation contract is missing: ${marker}`);
assert(protocol.includes('[JsonProperty("schema")] public string Schema = "realm.character-appearance.v1";')
  && protocol.includes('[JsonProperty("skinToneId")] public string SkinToneId = "skin_03";')
  && server.includes("const CHARACTER_APPEARANCE_SCHEMA = 'realm.character-appearance.v1';")
  && server.includes("skinToneId: 'skin_03',"),
  'Unity join appearance must include the server appearance schema and fixed skin tone');

// The creator is not only a form: it previews the selected GLB and applies
// face/hair variants live on it.
const unityPreview = read('unity-client/Assets/Scripts/Game/RoaCharacterPreview.cs');
const unityCharacterView = read('unity-client/Assets/Scripts/Game/RoaCharacterView.cs');
const unityBootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
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

// Local camera zoom persists between sessions. The strategic map adds a
// mass-market pointer contract: a short primary click routes, a primary drag
// pans, right drag pans, and middle drag rotates the angled strategic camera.
const unityCamera = read('unity-client/Assets/Scripts/Game/RoaCameraRig.cs');
const unityGlobalMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const unityGlobalMapCanvas = read('unity-client/Assets/Scripts/Game/RoaGlobalMapCanvas.cs');
const unityCameraProbe = read('unity-client/Assets/Editor/RoaCameraProbe.cs');
const unityGlobalMapPresentationProbe = read('unity-client/Assets/Editor/RoaGlobalMapPresentationProbe.cs');
assert(unityCamera.includes('private const string ZoomPrefsKey = "roa.cameraDistance.v4";')
  && unityCamera.includes('private const string PreviousZoomPrefsKey = "roa.cameraDistance.v3";')
  && unityCamera.includes('private const string LegacyZoomPrefsKey = "roa.cameraDistance.v2";')
  && unityCamera.includes('PlayerPrefs.SetFloat(ZoomPrefsKey, Distance);')
  && unityCamera.includes('RoaGameBootstrap.BlocksWorldHud ? 0f'),
  'Unity local camera zoom must persist and ignore wheel input behind open UI');
// The strategic camera pose (anchor, pitch, yaw, distance) survives entering a
// location and restarting the client; the authored default is only for the
// first launch, and saved values are clamped to the current map bounds.
assert(unityGlobalMap.includes('private const string CameraPosePrefsPrefix = "roa.globalMap.camera.v1";')
  && unityGlobalMap.includes('TryLoadStrategicCameraPose(out savedAnchorLocal, out savedPitch, out savedYaw, out savedDistance)')
  && unityGlobalMap.includes('public static Vector3 ClampStrategicCameraPose(')
  && unityGlobalMap.includes('PersistStrategicCameraPoseIfChanged();')
  && unityGlobalMap.indexOf('CameraRig.PitchDeg = StrategicDefaultPitchDeg;')
    < unityGlobalMap.indexOf('TryLoadStrategicCameraPose(out savedAnchorLocal')
  && /SaveStrategicCameraPose\(\);\s*RestoreCamera\(\);/.test(unityGlobalMap),
  'Unity strategic camera pose must persist across location entry and client restarts');

// Pip-Boy radio: the client exposes the four Kromka stations, and the
// selected channel streams real records from the built library
// (tools/radio-library.py → public/radio/manifest.json + MP3): one station per
// track so the channels sound different, and one shared schedule for every
// player: a deterministic order per station (manifest seed) cycles from a common
// epoch on server time, so switching channels lands mid-record like real radio. No synthesized sounds remain — without the
// manifest the receiver stays silent and retries every minute. The "ЭФИР" list
// comes from the public wasteland summary and the channel survives restarts.
const unityRadio = read('unity-client/Assets/Scripts/Game/RoaRadio.cs');
const unityRadioPipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const unityRadioCanvas = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');
for (const kromkaTitle of ['Голос Тесьмы', 'Шум Стеколья', 'Сводка Тракта', 'Тишина']) {
  assert(unityRadioPipboy.includes(kromkaTitle), `Radio channel "${kromkaTitle}" must stay covered`);
}
assert(unityRadio.includes('private const string ChannelPrefsKey = "roa.radio.channel.v1";')
  && unityRadio.includes('public static int ChannelForEvent(string type, string title)')
  && unityRadio.includes('Pipboy.EnsureWorldData();')
  && unityBootstrap.includes('Radio.Pipboy = Pipboy;')
  && unityRadioCanvas.includes('AddHeading(_radioRows, _radioList, "ЭФИР");')
  && unityRadioCanvas.includes('radio.NowPlayingTitle')
  && read('unity-client/Assets/Editor/RoaClientAuditRunner.cs').includes('typeof(RoaRadioProbe)'),
  'Unity Pip-Boy radio must persist the channel, show the live feed and the current record');
assert(unityRadio.includes('public const string ManifestPath = "/radio/manifest.json";')
  && unityRadio.includes('public static List<Track> ParseManifest(string json)')
  && unityRadio.includes('UnityWebRequestMultimedia.GetAudioClip(url, AudioType.MPEG)')
  && unityRadio.includes('public static List<int> BuildOrder(IReadOnlyList<Track> tracks, int channel, int seed)')
  && unityRadio.includes('public static int SlotAt(double time, double cycle, double[] starts, out double offset)')
  && unityRadio.includes('ClockOffsetFromDateHeader(request.GetResponseHeader("Date")')
  && read('tools/radio-library.py').includes('"scheduleSeed"')
  && !unityRadio.includes('AudioClip.Create(')
  && read('tools/radio-library.py').includes('return [CHANNEL_SAFETY]'),
  'Unity Pip-Boy radio must stream the built radio library on one shared server-time schedule, one station per track, with no synthesized sounds');
assert(unityGlobalMap.includes('private bool UpdateCameraOrbit()')
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

console.log(`Unity client parity OK: ${unityEmits.length} outgoing events `
  + `(${serverOnlyHandlers.length} reviewed server-only handlers), ${unityHandlers.length} incoming events, `
  + `${unityHttpRoutes.length} HTTP routes, `
  + `${Object.keys(unityItems).length} items, ${actualRecipes.length} recipes, `
  + `${Object.keys(unityMods).length} weapon modifications, ${unityTraitRows.length} starting traits, `
  + 'live GLB preview, persistent camera zoom/map pan/touch and live Canvas labels');
