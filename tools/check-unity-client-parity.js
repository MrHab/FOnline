#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readTieredCatalogs } = require('../src/server/kromka-tiers');

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

function functionSource(source, name) {
  const start = source.indexOf(`\nfunction ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return source.slice(start + 1, source.indexOf('\n}', start) + 2);
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
  && hudCanvas.includes('_compactConsolePanel.SetActive(false);')
  && !hudCanvas.includes('Input.GetKey(KeyCode.LeftAlt)')
  && hudCanvas.includes('AppendOccupiedScreenRect(_compactConsolePanel, output);')
  && hudProbe.includes('the HUD must retain one visible arrangement through combat and activity')
  && hudProbe.includes('contextual exploration console is incomplete'),
  'Unity HUD lost its fixed Apocalypse arrangement or fallback information strip');
assert(nameplates.includes('public static bool IsImportantNpc(')
  && nameplates.includes('case "merchant":')
  && nameplates.includes('case "quartermaster":')
  && nameplates.includes('public static Presentation ResolvePresentation(')
  && nameplates.includes('mobile ? 14f : 20f')
  && nameplates.includes('fill.type = Image.Type.Filled')
  && nameplates.includes('plate.HealthFill.fillAmount = Mathf.Clamp01(ratio)')
  && nameplates.includes('CompactHealthState(entry.Hp, entry.MaxHp)')
  && enemies.includes('RoaActorNameplates.IsImportantNpc(canDialogue,')
  && enemies.includes('Name = enemy.Snapshot["name"]')
  && enemies.includes('Level = enemy.Snapshot["level"]')
  && nameplates.includes('HUD_Apocalypse_WorldSpace_EnemyInfo_01')
  && !enemies.includes('if (enemy.Snapshot["canDialogue"]?.ToObject<bool>() != true) continue;')
  && hudProbe.includes('compact health-bar/name hierarchy is not deterministic'),
  'Unity actor nameplates lost actor names, tiers or compact health hierarchy');

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
const lootCanvas = read('unity-client/Assets/Scripts/Game/RoaLootCanvas.cs');
assert(lootCanvas.includes('Interaction.LootSecurity("hackTerminal")')
  && lootCanvas.includes('Interaction.LootSecurity("pickLock")')
  && interaction.includes('public void LootSecurity(string action) { SecurityAction(action); }')
  && interaction.includes('Socket.EmitWithAck(action, new Dictionary<string, object>'),
  'Unity security action must keep a closed hackTerminal/pickLock event domain');
assert(interaction.includes('Socket.EmitWithAck("npcTradeExchange", payload')
  && !interaction.includes('tradeMachine') && !interaction.includes('TradeMachine'),
  'Unity trade must talk only to NPC traders: trade machines are gone');

// Цены бартера: смета Unity повторяет серверную формулу. Доли и наибольшая скидка
// сверяются по значениям, поэтому правка одной стороны без другой падает.
{
  const number = (source, pattern, label) => {
    const match = source.match(pattern);
    assert(match, `${label} is missing`);
    return Number(match[1]);
  };
  const sellShare = number(server, /const SERVER_TRADE_SELL_SHARE_PCT = (\d+);/, 'server sell share');
  assert(sellShare > 0 && sellShare === number(barterCanvas, /catalogPrice > 0 \? Mathf\.Max\(1, catalogPrice \* (\d+) \/ 100\)/, 'Unity sell share'),
    'Unity barter sell share differs from the server');
  assert(server.includes('Object.entries(SERVER_ITEM_BASE_PRICES)')
    && server.includes('Math.floor(Number(price) * SERVER_TRADE_SELL_SHARE_PCT / 100)')
    && barterCanvas.includes('int catalogPrice = RoaItemData.BasePrice(baseId);'),
    'server sell prices and Unity barter previews must derive from the authoritative item catalog');
  const maxDiscount = number(server, /const SERVER_TRADE_MAX_BUY_DISCOUNT = ([0-9.]+);/, 'server max discount');
  assert(maxDiscount > 0 && maxDiscount === number(barterCanvas, /const double MaxBuyDiscount = ([0-9.]+)d;/, 'Unity max discount'),
    'Unity barter max buy discount differs from the server');
  const floorShare = number(server, /const SERVER_TRADE_SHELF_FLOOR_SHARE = ([0-9.]+);/, 'server shelf floor share');
  assert(floorShare > 0 && floorShare === number(barterCanvas, /Math\.Max\(0, catalogPrice\) \* ([0-9.]+)d\)\);/, 'Unity shelf floor share'),
    'Unity shelf floor share differs from the server');
  // Скидка: Бартер, «Торговец» и доля Торговца базы; надбавка скупки — Влияние, «Барыга»,
  // Бартер, «Торговец» и житель; интерес торговца ×1,24 или ×0,84.
  assert(server.includes("serverSkillNorm(player, 'barter') * 0.15")
    && /serverTalentLevel\(player, 'merchant'\) \* 0\.03 \+ serverResidentTradePct\(player\)\)/.test(server)
    && barterCanvas.includes('TradeSkillNorm(self) * 0.15d + TalentLevel(self, "merchant", 3) * 0.03d')
    && /TalentLevel\(self, "merchant", 3\) \* 0\.03d\s*\+ ResidentTradePct\(self\)\);/.test(barterCanvas),
    'Unity barter discount no longer mirrors the server');
  assert(/\(serverStatValue\(player, 'cha'\) - 5\) \* 0\.04/.test(server) && barterCanvas.includes('(StatValue(self, "cha") - 5) * 0.04d')
    && server.includes("serverHasTrait(player, 'traderStart') ? 0.15") && barterCanvas.includes('HasTrait(self, "traderStart") ? 0.15d')
    && server.includes("serverSkillNorm(player, 'barter') * 0.30") && barterCanvas.includes('TradeSkillNorm(self) * 0.30d')
    && /serverTalentLevel\(player, 'merchant'\) \* 0\.08\s*\+ serverResidentTradePct\(player\);/.test(server)
    && /TalentLevel\(self, "merchant", 3\) \* 0\.08d\s*\+ ResidentTradePct\(self\);/.test(barterCanvas)
    && server.includes('? 1.24 : 0.84') && barterCanvas.includes('interested ? 1.24d : 0.84d'),
    'Unity barter sale bonus or trader interest no longer mirrors the server');
  // Потолок скупки — один для всех: на марку ниже самой дешёвой покупки в мире
  // (нижняя граница полки с наибольшей скидкой), и ставится после надбавки за
  // интерес торговца, иначе надбавка поднимала продажу выше покупки.
  const serverSell = functionSource(server, 'serverTradeSellPrice');
  const unitySell = barterCanvas.slice(barterCanvas.indexOf('private static int TradeSellPrice('),
    barterCanvas.indexOf('private bool IsEquipped('));
  assert(serverSell.indexOf('? 1.24 : 0.84') > 0
    && serverSell.indexOf('? 1.24 : 0.84') < serverSell.indexOf('Math.min(price, serverTradeSellCeiling(id))')
    && unitySell.indexOf('interested ? 1.24d : 0.84d') > 0
    && unitySell.indexOf('interested ? 1.24d : 0.84d') < unitySell.indexOf('Math.Min(price, TradeSellCeiling(baseId))'),
    'The sell ceiling must come after the trader interest bonus on the server and in Unity');
  assert(functionSource(server, 'serverTradeSellCeiling').includes('Math.ceil(serverTradeShelfFloor(itemId) * (1 - SERVER_TRADE_MAX_BUY_DISCOUNT)) - 1')
    && barterCanvas.includes('(int)System.Math.Ceiling(ShelfFloorPrice(baseId) * (1d - MaxBuyDiscount)) - 1'),
    'The sell ceiling must sit one mark below the cheapest purchase anywhere, the same for every player');
  // Оружие и броню у игроков покупает только Чёрный рынок: торговец присылает
  // refusedCategories, сервер отклоняет такую продажу, смета показывает отказ.
  assert(functionSource(server, 'serverNpcTradeMarket').includes('refusedCategories,')
    && serverSell.includes('(market.refusedCategories || []).includes(')
    && functionSource(server, 'performServerNpcTradeExchange').includes('return { ok: false, error: SERVER_NPC_TRADE_GEAR_REFUSED_ERROR }')
    && barterCanvas.includes('market?["refusedCategories"] is JArray refused')
    && unitySell.includes('if (TradeRefuses(market, baseId)) return 0;')
    && barterCanvas.includes('"Торговец не берёт: "'),
    'NPC traders must refuse weapons and armour on the server and in the Unity estimate');
  assert(functionSource(server, 'serverNpcTradeMarket').includes('price: serverTradeShelfPrice(id, entry?.price)')
    && functionSource(server, 'publicEnemy').includes('price: serverTradeShelfPrice(row.id, row.price)')
    && functionSource(server, 'serverNpcTradeResalePrice').includes('return serverTradeShelfPrice(id, Math.max(sellPrice + 1'),
    'NPC shelf prices shown to Unity must never drop below the shelf floor');
}
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
  'input', // прежний канал осевого ввода; движение Unity идёт через state
  'qaTravel', // перенос для сквозной проверки кампании: есть только при NODE_ENV=test и KROMKA_TEST_TRAVEL=1
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
const apocalypseWeapons = JSON.parse(read('data/kromka/apocalypse-weapons.json')).weapons || [];
for (const weapon of apocalypseWeapons) {
  if (weapon.itemId.startsWith('polygon'))
    unityItems[weapon.itemId] = { name: weapon.name, weight: Number(weapon.weight) };
}
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
// The baked fallback carries only untiered recipes: tiered rows (every weapon,
// armour and tool in T1–T5, refining) arrive with the server catalog.
const tieredCatalogs = readTieredCatalogs(path.join(ROOT, 'data'));
const allRecipes = tieredCatalogs.recipeCatalog.recipes.map(row => ({ id: row.id, outputId: row.output.id }));
const authoredRecipes = tieredCatalogs.recipeCatalog.recipes.filter(row => !row.tier).map(row => ({
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

// Items explicitly obtainable by crafting must have a field recipe. Pack
// variants enter through trade and loot, so they do not require duplicate recipes.
const characterEquipmentSlots = new Set(['weapon', 'armor', 'helmet', 'boots', 'backpack']);
const craftedOutputIds = new Set(allRecipes.map(row => row.outputId));
const requiredCraftOutputIds = Object.values(authoredItems)
  .filter(item => (item.acquisition || []).includes('craft'))
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
const unityAuthCanvas = read('unity-client/Assets/Scripts/Game/RoaAuthCanvas.cs');
assert(unityCharacterView.includes('public bool ApplyAppearance(CharacterAppearance appearance)')
  && unityAuthCanvas.includes('preview.Show(Bootstrap.AuthServerUrl, Bootstrap.Creator.Appearance,'),
  'Unity creator must update hair variants on the live GLB preview');
assert(unityAuthCanvas.includes('string[] keys = { "sex", "hair", "hairColor" };'),
  'the creator offers exactly sex, hairstyle and hair colour');

// Local camera zoom persists between sessions.
const unityCamera = read('unity-client/Assets/Scripts/Game/RoaCameraRig.cs');
assert(unityCamera.includes('private const string ZoomPrefsKey = "roa.cameraDistance.v4";')
  && unityCamera.includes('private const string PreviousZoomPrefsKey = "roa.cameraDistance.v3";')
  && unityCamera.includes('private const string LegacyZoomPrefsKey = "roa.cameraDistance.v2";')
  && unityCamera.includes('PlayerPrefs.SetFloat(ZoomPrefsKey, Distance);')
  && unityCamera.includes('RoaGameBootstrap.BlocksWorldHud || RoaHudCanvas.PointerOverMinimap'),
  'Unity local camera zoom must persist and ignore wheel input behind open UI');
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
console.log(`Unity client parity OK: ${unityEmits.length} outgoing events `
  + `(${serverOnlyHandlers.length} reviewed server-only handlers), ${unityHandlers.length} incoming events, `
  + `${unityHttpRoutes.length} HTTP routes, `
  + `${Object.keys(unityItems).length} items, ${actualRecipes.length} recipes, `
  + `${Object.keys(unityMods).length} weapon modifications, ${unityTraitRows.length} starting traits, `
  + 'live GLB preview and persistent camera zoom');
