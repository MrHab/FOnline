'use strict';

/**
 * Контракт наёмника на входе в Сердцевину: доли фракций, окно выбора и
 * маршрут «узел территории → база своей фракции». Проверяются чистая модель,
 * серверная обвязка, авторские данные и клиентское окно.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  territoryContractBaseLocationId,
  territoryContractOffer,
  territoryFactionShares
} = require('../src/server/territory-contract');
const { joinTerritoryFaction } = require('../src/server/territory-membership');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));
const catalog = readJson('data/kromka/territory.json');
const factionNames = readJson('data/kromka/factions.json').factions
  .reduce((acc, row) => Object.assign(acc, { [row.id]: row.displayName }), {});
const now = 1_900_000_000_000;

// --- Доли фракций --------------------------------------------------------
const empty = territoryFactionShares([], catalog);
assert.strictEqual(empty.characters, 0);
assert.strictEqual(empty.signed, 0);
assert.deepStrictEqual(empty.factions.map(row => row.factionId),
  ['uprava', 'free_artels', 'contour', 'tract_league']);
assert.ok(empty.factions.every(row => row.sharePct === 0 && row.characters === 0),
  'без подписанных контрактов доли равны нулю, а не NaN');

const shares = territoryFactionShares([
  { factionId: 'uprava' }, { factionId: 'uprava' }, { factionId: 'contour' },
  { factionId: 'unknown_faction' }, { factionId: '' }, null
], catalog);
assert.strictEqual(shares.characters, 6, 'считаются все персонажи, включая не подписавших');
assert.strictEqual(shares.signed, 3, 'подписавшими считаются только члены известных фракций');
const shareById = new Map(shares.factions.map(row => [row.factionId, row]));
assert.strictEqual(shareById.get('uprava').characters, 2);
assert.strictEqual(shareById.get('uprava').sharePct, 66.7, 'доля считается от подписавших и округляется до 0,1%');
assert.strictEqual(shareById.get('contour').sharePct, 33.3);
assert.strictEqual(shareById.get('free_artels').sharePct, 0);

// --- Предложение контракта ------------------------------------------------
const offer = territoryContractOffer({ catalog, factionNames, membership: null, shares, now });
assert.strictEqual(offer.signed, false);
assert.strictEqual(offer.canSign, true, 'персонаж без контракта подписывает его у ворот');
assert.strictEqual(offer.signedCharacters, 3);
assert.strictEqual(offer.characters, 6);
assert.strictEqual(offer.factions.length, 4);
const upravaRow = offer.factions.find(row => row.factionId === 'uprava');
assert.strictEqual(upravaRow.displayName, 'Управа', 'в окне показывается имя фракции, а не идентификатор');
assert.strictEqual(upravaRow.baseLocationId, 'coreBaseUprava');
assert.strictEqual(upravaRow.baseDisplayName, 'Узел Управы');
assert.strictEqual(upravaRow.sharePct, 66.7);
assert.ok(offer.factions.every(row => row.canSign === true && row.reason === ''),
  'без действующего контракта доступны все фракции');

const joined = joinTerritoryFaction(null, 'contour', catalog, now);
assert.strictEqual(joined.ok, true);
const memberOffer = territoryContractOffer({ catalog, factionNames, membership: joined.membership, shares, now: now + 1000 });
assert.strictEqual(memberOffer.signed, true);
assert.strictEqual(memberOffer.factionId, 'contour');
assert.strictEqual(memberOffer.factionDisplayName, 'Контур');
assert.strictEqual(memberOffer.baseLocationId, 'coreBaseContour');
assert.strictEqual(memberOffer.canSign, false, 'пока действует кулдаун, контракт не переподписывают у ворот');
assert.strictEqual(memberOffer.changeLocked, true);
assert.ok(memberOffer.factions.every(row => row.canSign === false),
  'смена фракции у ворот закрыта кулдауном: причина приходит по каждой строке');
assert.ok(memberOffer.factions.find(row => row.factionId === 'uprava').reason.length > 0);

assert.strictEqual(territoryContractBaseLocationId(joined.membership, catalog), 'coreBaseContour');
assert.strictEqual(territoryContractBaseLocationId(null, catalog), '',
  'без контракта база не назначается: сервер показывает окно выбора');

// --- Авторские данные -----------------------------------------------------
const zone = readJson('data/locations/coreZone.json');
assert.strictEqual(zone.noGlobalMapEntry, true, 'сама зона по-прежнему не открывается с карты напрямую');
const globalMap = readJson('data/global-map.json');
const nodeById = new Map(globalMap.nodes.map(node => [node.id, node]));
assert.ok(nodeById.has('coreZone'), 'узел Сердцевины остаётся на карте: это единственный вход на территорию');
assert.notStrictEqual(nodeById.get('coreZone').hidden, true, 'узел Сердцевины виден игроку');
for (const faction of catalog.factions) {
  const base = readJson(`data/locations/${faction.baseLocationId}.json`);
  assert.strictEqual(base.noGlobalMapEntry, true, `${faction.baseLocationId}: на базу не заходят с карты напрямую`);
  assert.strictEqual(base.allowGlobalMapExit, true, `${faction.baseLocationId}: выход воротами в пустошь остаётся`);
  assert.ok(base.entryFromWorld, `${faction.baseLocationId}: сервер заводит на базу через точку входа с карты`);
  const node = nodeById.get(faction.baseLocationId);
  assert.ok(node, `${faction.baseLocationId}: узел остаётся точкой мира для выхода и симуляции`);
  assert.strictEqual(node.hidden, true, `${faction.baseLocationId}: метка базы скрыта с глобальной карты`);
}

// --- Серверная обвязка ----------------------------------------------------
const server = read('server.js');
for (const token of [
  "require('./src/server/territory-contract')",
  'function serverIsTerritoryGateLocation(',
  'function serverTerritoryGateArrival(',
  'function serverPlayerAtTerritoryGate(',
  'function serverTerritoryGateCompanions(',
  'function serverTerritoryFactionShares(',
  'function publicGlobalMap(',
  'map: publicGlobalMap(GLOBAL_MAP)',
  // Поле пишется только у скрытых узлов: перезапуск сервера не должен
  // проставлять `hidden: false` каждой точке авторской карты.
  "...(node?.hidden === true ? { hidden: true } : {}),",
  'if (!stayOnWorldMap && serverIsTerritoryGateLocation(targetLocationId)) {',
  'contractRequired: true,',
  "resolution.entryKey = 'entryFromWorld';",
  "if (targetLoc.noGlobalMapEntry === true && !territoryGateEntry) {",
  "if (action === 'offer') {",
  "const atGate = action === 'join' && serverPlayerAtTerritoryGate(p, now);",
  'invalidateTerritoryFactionSharesCache();',
  // Маршрут к Сердцевине открывает ворота даже если прибытие свелось к точке.
  'if (stayOnWorldMap && serverIsTerritoryGateLocation(session.targetLocationId)) {'
]) assert(server.includes(token), `server.js is missing the territory contract wiring: ${token}`);
assert(server.includes('Сменить фракцию можно только у регистратора на её базе.'),
  'у ворот подписывают первый контракт, смена фракции остаётся у регистратора');

// --- Клиент ---------------------------------------------------------------
const net = read('unity-client/Assets/Scripts/Game/RoaTerritoryNet.cs');
assert(net.includes('RequestContractOffer'), 'клиент умеет запрашивать предложение контракта');
const map = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
for (const token of [
  'contractRequired',
  'OpenTerritoryContract(',
  'public void SignTerritoryContract()',
  'public void CancelTerritoryContract()',
  'public void SelectTerritoryContractFaction(',
  'RoaTerritoryNet.JoinFaction(Socket, factionId',
  '|| _territoryContractPending) return;'
]) assert(map.includes(token), `RoaGlobalMap is missing ${token}`);
// Клиент не рисует скрытые узлы даже если карта пришла из кэша или старой
// сборки: метки баз фракций не должны возвращаться на карту.
const mapModel = read('unity-client/Assets/Scripts/World/RoaGlobalMapData.cs');
assert(/\[JsonProperty\("hidden"\)\] public bool Hidden;/.test(mapModel), 'The node model must read the hidden flag.');
assert(map.includes('_map.Nodes.RemoveAll(node => node == null || node.Hidden);'),
  'The client must drop hidden nodes right after loading the map.');
const canvas = read('unity-client/Assets/Scripts/Game/RoaGlobalMapCanvas.cs');
for (const token of [
  'BuildContractModal(',
  'RefreshTerritoryContract();',
  'КОНТРАКТ С ФРАКЦИЕЙ',
  'ПОДПИСАТЬ КОНТРАКТ',
  'ContractRowText(',
  'CultureInfo.InvariantCulture'
]) assert(canvas.includes(token), `RoaGlobalMapCanvas is missing ${token}`);
assert(/sharePct/.test(canvas), 'окно показывает долю фракции в процентах');

console.log('Territory contract OK: faction shares, gate offer, base routing, hidden base markers and the Unity contract window are wired.');
