#!/usr/bin/env node
'use strict';

// Постоянные PvE-области: данные, личные комнаты с проверкой владельца,
// правила зоны без PvP и без потери вещей, плановые встречи под управляемым
// временем, «Искать следы», затишье после зачистки и сброс пустой комнаты.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const pve = require('../src/server/pve-areas');
const { zoneRules, zoneModeAllowsPvp, zoneModeLossPolicy } = require('../src/server/zone-rules');
const { deathLootPolicy } = require('../src/server/kromka-death-loot');
const catalog = pve.normalizePveAreaCatalog(JSON.parse(read('data/kromka/pve-areas.json')));
const mutants = JSON.parse(read('data/mutants.json'));
const mutantIds = new Set(mutants.types.map(row => row.id));

// --- данные ---------------------------------------------------------------------
assert(catalog.areas.length >= 5, 'At least five persistent PvE areas.');
assert.deepEqual(catalog.rules, {
  rollIntervalMs: 90000, calmAfterClearMs: 45000, rollChance: 0.35, tracksCooldownMs: 30000,
  tracksChance: 0.8, maxAlive: 8, spawnMinPlayerDistance: 14, roomIdleResetMs: 600000,
  // Встречи приходят к идущему: между проверками отряд проходит свою долю пути.
  distancePerRollM: 90,
  // Обстоятельства встречи: засада подводит стаю вплотную, смешанная приводит
  // соседа другого вида.
  ambushChance: 0.25, ambushMinPlayerDistance: 6, mixedChance: 0.25, mixedCompanionCount: 1,
  // Встреча в угодьях — шанс за пройденный путь внутри контура, а не гарантия
  // на границе: бросок за каждые 8 точек, 20% на бросок.
  encounterStepPoints: 8, encounterChance: 0.2
});
// --- угодья выкатывают встречи, а не ведут в логово --------------------------------
// Игрок ходит по угодьям и встречает разное: таблица сцен принадлежит области,
// каждая сцена — настоящая запись в data/encounters.json, а её локация —
// одноразовый шаблон, иначе зачищенная встреча возрождалась бы.
const encounterCatalog = JSON.parse(read('data/encounters.json')).encounters;
const locationsDir = 'data/locations';
for (const area of catalog.areas) {
  assert(area.encounters.length >= 4,
    `${area.id}: hunting grounds need a table of encounters, not a single door`);
  const scenes = new Set();
  for (const row of area.encounters) {
    assert(encounterCatalog[row.encounterId],
      `${area.id}/${row.id}: unknown encounter scene ${row.encounterId}`);
    assert(Array.isArray(encounterCatalog[row.encounterId].actors)
      && encounterCatalog[row.encounterId].actors.length > 0,
      `${area.id}/${row.id}: the scene ${row.encounterId} has no actors`);
    const template = JSON.parse(read(`${locationsDir}/${row.locationId}.json`));
    assert(template.randomTemplate === true || template.encounterOnly === true,
      `${area.id}/${row.id}: ${row.locationId} is not a one-shot encounter template`);
    assert(template.noRespawn === true,
      `${area.id}/${row.id}: a cleared encounter must stay cleared (${row.locationId} respawns)`);
    assert(row.weight > 0 && row.title.length > 0, `${area.id}/${row.id}: a table row needs a weight and a title`);
    scenes.add(row.encounterId);
  }
  assert(scenes.size >= 3, `${area.id}: the same scene over and over is not a random encounter`);
  // Сцены «сторона против стороны» — половина обещания игроку: угодья живут не
  // только стаями, но и чужими стычками.
  const sides = area.encounters.filter(row => /_vs_|_против_/.test(row.encounterId)
    || String(encounterCatalog[row.encounterId].name || '').includes(' против '));
  assert(sides.length >= 1, `${area.id}: hunting grounds must also stage someone against someone`);
  // Мини-босс принадлежит именной локации, а не встрече.
  assert(area.boss && area.boss.displayName.length > 0, `${area.id}: the lair must keep a mini boss`);
  assert(mutantIds.has(area.boss.creatureTypeId), `${area.id}: unknown boss creature ${area.boss.creatureTypeId}`);
}
// Бросок по таблице детерминирован при заданном генераторе и не выходит за неё.
{
  const area = catalog.byLocation.antHive;
  const first = pve.rollAreaEncounter(area, () => 0.01);
  const last = pve.rollAreaEncounter(area, () => 0.999999);
  assert(first && last && area.encounters.includes(first) && area.encounters.includes(last),
    'A rolled encounter always comes from the area table.');
  assert.equal(pve.rollAreaEncounter({ encounters: [] }, () => 0.5), null,
    'An area without a table rolls nothing instead of throwing.');
}
for (const area of catalog.areas) {
  const location = JSON.parse(read(`data/locations/${area.locationId}.json`));
  assert.equal(location.pvpMode, 'pve', `${area.id}: the location must use the pve zone mode.`);
  assert.equal(location.privateInstance, true, `${area.id}: the location must be a private instance.`);
  assert.equal(location.pveArea, true, `${area.id}: the location must be flagged as a PvE area.`);
  assert(!location.randomTemplate && !location.encounterOnly, `${area.id}: a persistent area is not a temporary template.`);
  for (const pack of area.packs) {
    assert(pack.creatureTypeId ? mutantIds.has(pack.creatureTypeId) : pack.typeName === 'Налётчик', `${area.id}/${pack.id}: unknown creature.`);
    assert(pack.count[0] >= 1 && pack.count[1] >= pack.count[0] && pack.weight > 0);
  }
}
assert.equal(pve.pveAreaForLocation(catalog, 'antHive').displayName, 'Колония Пыльников');
assert.equal(pve.pveAreaForLocation(catalog, 'settlement'), null);

// --- правила зоны ----------------------------------------------------------------
assert.equal(zoneModeAllowsPvp('pve'), false, 'No PvP inside PvE areas.');
assert.equal(zoneModeLossPolicy('pve'), 'none', 'Nothing is lost on death in PvE areas.');
assert.deepEqual(deathLootPolicy('pve'), { mode: 'pve', loss: 'none' });
assert.equal(zoneRules('pve').pvp, false);

// --- личные комнаты и владелец ----------------------------------------------------
// Логово в единственном экземпляре: комната одна и та же для любого игрока.
assert.equal(pve.pveLairRoomId('antHive'), 'antHive#lair');
assert.equal(pve.pveLairRoomId('antHive'), pve.pveLairRoomId('antHive'));
assert.equal(pve.pveRoomId('antHive', 'char-a'), 'antHive#pve_char-a');
assert.equal(pve.pveRoomOwner('antHive#pve_char-a', 'antHive'), 'char-a');
assert.equal(pve.pveRoomOwner('antHive#site_x', 'antHive'), '');
assert(pve.pveRoomAllowed('antHive#pve_char-a', 'antHive', 'char-a'), 'The owner enters their room.');
assert(!pve.pveRoomAllowed('antHive#pve_char-a', 'antHive', 'char-b'), 'A stranger never enters someone else\'s room.');
assert(pve.pveRoomAllowed('antHive#pve_char-a', 'antHive', 'char-b', new Set(['char-b'])), 'A party member admitted by the server enters.');
assert(!pve.pveRoomAllowed('geckoCanyon#pve_char-a', 'antHive', 'char-a'), 'Room ids are bound to their location.');
assert.equal(pve.pveOwnerKey('bad id!'), 'badid');

// --- встречи под управляемым временем --------------------------------------------------
const area = pve.pveAreaForLocation(catalog, 'antHive');
const rules = catalog.rules;
const t0 = 1000000;
const state = pve.createPveRoomState(area, rules, t0, 'char-a');
assert.equal(state.ownerKey, 'char-a');
const first = pve.initialPacks(state, area, () => 0);
assert.equal(first.length, 1, 'The first entry spawns the authored initial pack.');
assert.equal(first[0].creatureTypeId, 'dustling');
assert.equal(first[0].spawnCount, 2, 'Random zero picks the minimum pack size.');
assert.deepEqual(pve.initialPacks(state, area, () => 0), [], 'Initial packs spawn once per room.');

assert.equal(pve.rollPveEncounter(state, area, rules, t0 + 1000, { random: () => 0, aliveCount: 2, occupied: true }).reason, 'cooldown');
assert.equal(pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0, aliveCount: 2, occupied: false }).reason, 'empty', 'Empty rooms never roll.');
// Стоящий отряд не собирает зверей: проверка ждёт пройденного пути и не
// тратит интервал впустую.
const still = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0, aliveCount: 2, occupied: true });
assert.equal(still.reason, 'still', 'Standing still means no encounter check at all.');
assert.equal(state.rolls, 0, 'A refused check does not count as a roll.');
assert.equal(state.nextRollAt, t0 + rules.rollIntervalMs, 'A refused check does not spend the interval.');
assert.equal(pve.notePveDistance(state, rules.distancePerRollM / 2), rules.distancePerRollM / 2, 'Travel accumulates.');
assert.equal(pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0, aliveCount: 2, occupied: true }).reason,
  'still', 'Half the way is not enough.');
pve.notePveDistance(state, rules.distancePerRollM / 2);
const quiet = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs, { random: () => 0.99, aliveCount: 2, occupied: true });
assert.equal(state.distanceSinceRollM, 0, 'A check resets the travelled distance.');
assert.equal(quiet.reason, 'quiet');
assert.equal(state.rolls, 1);
assert.equal(state.nextRollAt, t0 + rules.rollIntervalMs * 2, 'A roll schedules the next one a full interval later.');
pve.notePveDistance(state, rules.distancePerRollM);
const spawned = pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs * 2, { random: () => 0, aliveCount: 2, occupied: true });
assert.equal(spawned.reason, 'spawned');
assert(spawned.spawn && spawned.spawn.spawnCount >= 2);
pve.notePveDistance(state, rules.distancePerRollM);
assert.equal(pve.rollPveEncounter(state, area, rules, t0 + rules.rollIntervalMs * 3, { random: () => 0, aliveCount: rules.maxAlive, occupied: true }).reason, 'crowded');

// Зачистка → затишье: плановая проверка ждёт конца затишья.
assert(!pve.notePveAlive(state, rules, 3, t0 + rules.rollIntervalMs * 3 + 1000), 'Alive enemies are not a clear.');
const clearAt = t0 + rules.rollIntervalMs * 3 + 2000;
assert(pve.notePveAlive(state, rules, 0, clearAt), 'Killing the last enemy clears the area.');
assert.equal(state.kills, 3);
assert.equal(state.calmUntil, clearAt + rules.calmAfterClearMs);
assert.equal(state.lastResult, 'cleared');
assert(state.nextRollAt >= state.calmUntil, 'No scheduled roll lands inside the calm window.');
assert(!pve.notePveAlive(state, rules, 0, clearAt + 10), 'A clear is reported once.');
state.nextRollAt = clearAt + 1000;
pve.notePveDistance(state, rules.distancePerRollM);
assert.equal(pve.rollPveEncounter(state, area, rules, clearAt + 1000, { random: () => 0, aliveCount: 0, occupied: true }).reason, 'calm', 'A forced early roll still respects the calm.');

// «Искать следы»: своя перезарядка, работает в затишье, повышенный шанс.
const tracks = pve.searchTracks(state, area, rules, clearAt + 2000, { random: () => 0.5, aliveCount: 0 });
assert.equal(tracks.reason, 'tracked');
assert(tracks.spawn && tracks.spawn.spawnCount >= 1);
assert.equal(state.calmUntil, 0, 'Tracks break the calm on purpose.');
assert.equal(state.tracksReadyAt, clearAt + 2000 + rules.tracksCooldownMs);
const again = pve.searchTracks(state, area, rules, clearAt + 3000, { random: () => 0, aliveCount: 1 });
assert(!again.ok && again.reason === 'cooldown' && again.readyInMs > 0);
const none = pve.searchTracks(state, area, rules, clearAt + 2000 + rules.tracksCooldownMs, { random: () => 0.95, aliveCount: 1 });
assert(none.ok && none.reason === 'noTracks');
const crowded = pve.searchTracks(state, area, rules, clearAt + 2000 + rules.tracksCooldownMs * 2, { random: () => 0, aliveCount: rules.maxAlive });
assert(crowded.ok && crowded.reason === 'crowded');

// Публичный снимок без внутренних ключей.
const snapshot = pve.publicPveRoomState(state, area, rules, clearAt + 2000 + rules.tracksCooldownMs * 2, { aliveCount: 1, members: 2 });
assert.equal(snapshot.mode, 'pve');
// Логово одно на всех: снимок комнаты обязан это говорить, иначе интерфейс
// пообещает игроку личную встречу там, где он встретит других игроков.
assert.equal(snapshot.personal, false);
assert.equal(snapshot.members, 2);
assert.equal(snapshot.tracksLabel, 'Искать следы');
assert(snapshot.lastResultLabel.length > 0);
assert(!('ownerKey' in snapshot) && !('nextRollAt' in snapshot));
assert.equal(pve.publicPveRoomState(null, area, rules), null);

// Сброс пустой комнаты по простою.
assert(!pve.pveRoomIdle(state, rules, 0, clearAt), 'An occupied room never idles.');
assert(!pve.pveRoomIdle(state, rules, clearAt, clearAt + rules.roomIdleResetMs - 1));
assert(pve.pveRoomIdle(state, rules, clearAt, clearAt + rules.roomIdleResetMs));

// Выбор группы по весам детерминирован инжектированным генератором.
const oldDepot = pve.pveAreaForLocation(catalog, 'oldDepot');
assert.equal(pve.choosePack(oldDepot, () => 0.99).typeName, 'Налётчик');
assert.equal(pve.choosePack(oldDepot, () => 0).creatureTypeId, 'burned');

// --- серверные контракты -------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  "const KROMKA_PVE_AREA_CATALOG = normalizePveAreaCatalog(readJson(KROMKA_PVE_AREAS_FILE",
  'function serverResolvePveRoomId(player = {}, locationId = \'\', requestedRoomId = \'\')',
  '? serverResolvePveRoomId(p, locationId, effectiveRoomId || requestedRoomId)',
  '? serverResolvePveRoomId({ characterId, userId: auth.user.id }, locationId, savedRoomId)',
  'if (pveJoinRoomId) serverPveRoomEntered(room, p, Date.now());',
  "socket.on('pveAreaAction'",
  "emit('pveAreaState', payload)",
  'serverTickPveRooms(Date.now())',
  'pveArea: room.pveState'
]) assert(server.includes(needle), `server.js is missing the PvE area contract: ${needle}`);
const socketClient = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
assert(socketClient.includes('_connection.On("pveAreaState"') && socketClient.includes('OnPveAreaState?.Invoke(payload)'), 'Unity must route pveAreaState.');
assert(read('unity-client/Assets/Scripts/Game/RoaPveAreaNet.cs').includes('EmitWithAck("pveAreaAction"'), 'Unity must be able to search for tracks.');

// --- область видна на карте до входа -------------------------------------------
const mapNodes = JSON.parse(read('data/global-map.json')).nodes;
const pointFor = locationId => {
  const node = mapNodes.find(row => row.locationId === locationId || row.id === locationId);
  return node ? { x: node.x, y: node.y } : null;
};
const itemNames = new Map(JSON.parse(read('data/kromka/items.json')).items.map(row => [row.id, row.name]));
// Превью собирается из того, что назвали источники, а не из таблиц добычи:
// случайные таблицы в мире выключены, и карточка, читавшая их, обещала химикаты
// и электронику там, где с существа падает один трофей. Что именно сервер
// называет источником, сверяет сетевая проверка зон — по инвентарю живых
// обитателей логова; здесь проверяется договор самого модуля.
{
  const area = {
    packs: [{ creatureTypeId: 'dustling' }, { creatureTypeId: 'rykhlyak' }, { typeName: 'Налётчик' }]
  };
  const sources = {
    packYield: pack => (pack.typeName ? ['silver', 'scrap', 'weaponParts', 'scrap'] : ['trophy']),
    areaYield: () => ['ore', 'scrap', 'bad id!', '']
  };
  assert.deepEqual(pve.pveAreaRewardIds(area, sources, 8), ['trophy', 'silver', 'scrap', 'weaponParts', 'ore', 'badid'],
    'Inhabitants come first, the lair nodes after them, every id once.');
  assert.deepEqual(pve.pveAreaRewardIds(area, sources), ['trophy', 'silver', 'scrap', 'weaponParts'], 'The card holds four rewards.');
  assert.deepEqual(pve.pveAreaRewardIds(area, {}), [], 'Without a source the card promises nothing.');
  assert.deepEqual(pve.pveAreaRewardIds(area, { packYield: () => null, areaYield: () => undefined }), [],
    'A source that names nothing leaves the card empty instead of throwing.');
  assert.deepEqual(pve.pveAreaRewardIds(area, JSON.parse(read('data/loot-tables.json')).enemies), [],
    'Loot tables are not a source: they never roll, so the card must not read them.');
}
// Источники этой проверки — авторские данные: трофей существа из бестиария,
// марки и останки снаряжения у человека.
const creatureById = new Map(mutants.types.map(row => [row.id, row]));
const areaRewardIds = area => pve.pveAreaRewardIds(area, {
  packYield: pack => {
    const creature = creatureById.get(pack.creatureTypeId);
    if (creature && creature.classification !== 'human') return Number(creature.loot?.trophyQty) > 0 ? ['trophy'] : [];
    return ['silver', 'weaponParts', 'scrap'];
  }
});
const publicAreas = pve.publicPveAreaCatalog(catalog, pointFor, {
  rewardIdsFor: areaRewardIds,
  itemName: id => itemNames.get(id) || id
});
assert.equal(publicAreas.length, catalog.areas.length, 'Every area reaches the client.');
for (const row of publicAreas) {
  assert(row.x > 0 && row.y > 0, `${row.id}: the area has a centre on the world map`);
  assert(row.radiusPoints >= 4, `${row.id}: the area has borders`);
  assert(row.danger >= 1 && row.danger <= 5, `${row.id}: the area declares its danger`);
  assert(row.inhabitants.length > 0, `${row.id}: the area names its inhabitants`);
  assert(row.lootCategories.length > 0, `${row.id}: the area names its loot categories`);
  assert.equal(row.personal, false, `${row.id}: the lair is one room for everyone`);
  // Карточка области на глобальной карте: силуэт, цель, периоды активности,
  // слово опасности и превью награды. Карта ничего из этого не сочиняет.
  assert(row.shape >= 1 && row.shape <= pve.PVE_AREA_SHAPES, `${row.id}: the area picks an authored silhouette`);
  assert(row.shapeRotation >= 0 && row.shapeRotation < 360, `${row.id}: the silhouette has a rotation`);
  assert(row.objective.length > 0, `${row.id}: the area names its objective`);
  assert(row.activity.length > 0, `${row.id}: the area names when it is active`);
  assert(row.dangerLabel.length > 0 && !/\d/.test(row.dangerLabel),
    `${row.id}: the difficulty reaches the card as a word, not a number`);
  assert(row.rewardPreview.length > 0 && row.rewardPreview.length <= 4, `${row.id}: the area previews what it can drop`);
  for (const reward of row.rewardPreview) {
    assert(itemNames.has(reward.id), `${row.id}: the reward ${reward.id} is not in the item catalog`);
    assert(reward.name === itemNames.get(reward.id), `${row.id}: the reward ${reward.id} reaches the card under the inventory name`);
  }
}
// Угодья зверей отдают трофеи, депо людей — марки и останки: карточки обязаны
// различаться так же, как различается добыча.
assert.deepEqual(publicAreas.find(row => row.id === 'antHive').rewardPreview.map(row => row.id), ['trophy']);
assert.deepEqual(publicAreas.find(row => row.id === 'oldDepot').rewardPreview.map(row => row.id), ['silver', 'weaponParts', 'scrap']);
// Две области не должны выглядеть близнецами: силуэт и поворот различают их.
const silhouettes = new Set(publicAreas.map(row => `${row.shape}:${row.shapeRotation}`));
assert.equal(silhouettes.size, publicAreas.length, 'Every area gets its own silhouette on the map.');
assert(server.includes('pveAreas: publicPveAreaCatalog(KROMKA_PVE_AREA_CATALOG, serverGlobalMapPointForLocation, {')
  && server.includes('rewardIdsFor: serverPveAreaRewardIds'),
  '/api/wasteland must publish the area catalog: without it the client cannot draw borders.');

// --- путь сквозь угодья ------------------------------------------------------------
// Контур на карте обязан что-то значить: отряд, вошедший в угодья, получает
// предложение войти. Сервер сверяет контакт в пути со своими зонами мира, а не
// с каталогом областей, поэтому у каждой области есть постоянная зона, и её
// идентификатор едет клиенту — тот не придумывает его сам.
for (const row of publicAreas) {
  const area = catalog.byLocation[row.locationId];
  const zone = pve.pveAreaZone(area, { x: row.x, y: row.y }, 12);
  assert.equal(zone.id, row.worldZoneId, `${row.id}: the published zone id must match the area row`);
  assert.equal(zone.kind, 'pveArea', `${row.id}: the zone declares itself as hunting grounds`);
  assert.equal(zone.status, 'active', `${row.id}: the zone stays active`);
  // Постоянные угодья не истекают: срока жизни у зоны быть не должно вовсе,
  // иначе симуляция вычистит её тихо и путь снова перестанет что-то значить.
  assert(!zone.expiresHour, `${row.id}: hunting grounds must not carry an expiry hour`);
  assert.equal(zone.locationId, row.locationId, `${row.id}: the zone leads into the area's own location`);
  // Ровно эти три поля решают, увидит ли сервер зону при сверке контакта
  // (serverGlobalZoneVisible): статус, hidden и visible.
  assert(zone.details.hidden !== true && zone.details.visible !== false,
    `${row.id}: a hidden zone would never confirm a contact on the route`);
  // Сверка контакта читает details.forced, а не поле верхнего уровня: вход в
  // угодья обязан оставаться выбором игрока именно там, куда сервер смотрит.
  assert.notEqual(zone.details.forced, true, `${row.id}: entering hunting grounds stays the player's choice`);
  // Сверка меряет расстояние как radius + 5.2 + 5.5, а симуляция режет радиус
  // зоны до 28: область шире этого была бы нарисована, но непроходима у кромки.
  assert(row.radiusPoints <= pve.PVE_AREA_MAX_RADIUS,
    `${row.id}: an area wider than ${pve.PVE_AREA_MAX_RADIUS} points cannot be confirmed at its own rim`);
  assert(Math.min(zone.radius, 28) + 5.2 + 5.5 >= row.radiusPoints,
    `${row.id}: the server could not confirm a contact at the outline's far edge`);
  // Комната зоны не является билетом на вход в угодья: если она попадёт в
  // билет, группа рассыплется по личным комнатам вместо комнаты лидера.
  assert.equal(pve.pveRoomOwner(`${row.locationId}#${row.worldZoneId}`, row.locationId), '',
    `${row.id}: the zone room id must never pass as a personal-room ticket`);
}
assert(server.includes('return pveLairRoomId(locationId);'),
  'A hunting-ground lair must resolve to one shared room, not a personal instance.');
// Внутри логова стоит главарь со свитой и больше никто: ни стартовых стай, ни
// плановых бросков — им место снаружи, в случайных встречах на маршруте.
{
  const enteredAt = server.indexOf('function serverPveRoomEntered(');
  const enteredBody = server.slice(enteredAt, enteredAt + 800);
  assert(enteredAt > 0 && enteredBody.includes('serverEnsurePveAreaBoss(')
    && !enteredBody.includes('pveInitialPacks('),
    'A lair must greet the player with its boss and escort, not with wandering packs.');
  assert(server.includes("? { rolled: false, spawn: null, reason: 'lair' }"),
    'A lair with a boss must not roll new packs on top of it.');
  assert(server.includes('guard.pveAreaEscortOf = area.boss.id;')
    && server.includes('if (boss.faction) guard.faction = boss.faction;'),
    'The escort must share the boss faction, or the lair fights itself in front of the player.');
}
assert(server.includes('function serverEnsurePveAreaBoss(room, area, now = Date.now())'), 'server.js is missing the lair boss contract.');

// --- обстоятельства встречи ------------------------------------------------------
// Одна и та же область встречает по-разному: обычно стая бродит поодаль,
// иногда поджидает вплотную, иногда приводит соседа другого вида.
{
  const area = catalog.areas.find(row => row.packs.length > 1);
  assert(area, 'An area with more than one pack is needed for mixed encounters.');
  const pack = area.packs[0];
  const kinds = new Map();
  for (let i = 0; i < 400; i += 1) {
    const roll = i / 400;
    const circumstance = pve.chooseCircumstance(area, pack, catalog.rules, () => roll);
    kinds.set(circumstance.kind, (kinds.get(circumstance.kind) || 0) + 1);
    if (circumstance.kind === 'mixed') {
      assert(circumstance.companion && circumstance.companion.id !== pack.id,
        'A mixed encounter brings a neighbour of another kind.');
      assert(area.packs.some(row => row.id === circumstance.companion.id),
        'The companion is authored for this very area.');
      assert(circumstance.companion.spawnCount >= 1);
    }
    if (circumstance.kind !== 'mixed') assert.equal(circumstance.companion, null);
  }
  assert.deepEqual([...kinds.keys()].sort(), ['ambush', 'mixed', 'wandering'], 'All three circumstances happen.');
  assert(kinds.get('wandering') > kinds.get('ambush'), 'Wandering stays the usual case.');

  // Обстоятельство доезжает до сервера вместе с пачкой и до игрока — словами.
  const state = pve.createPveRoomState(area, catalog.rules, 0, 'char-x');
  pve.notePveDistance(state, catalog.rules.distancePerRollM);
  const rolled = pve.rollPveEncounter(state, area, catalog.rules, catalog.rules.rollIntervalMs, {
    aliveCount: 0, occupied: true, random: () => 0.01
  });
  assert(rolled.spawn && rolled.spawn.circumstance, 'The roll carries the circumstance: ' + JSON.stringify(rolled.spawn || {}));
  assert.equal(rolled.spawn.circumstance.kind, 'ambush', 'A low roll means an ambush.');
  const view = pve.publicPveRoomState(state, area, catalog.rules, catalog.rules.rollIntervalMs, { aliveCount: 3, members: 1 });
  assert.equal(view.lastCircumstance, 'ambush');
  assert(view.lastResultLabel.includes('засада'), 'The player is told about the ambush: ' + view.lastResultLabel);

  // По следам идут сами — засады не бывает.
  const tracked = pve.createPveRoomState(area, catalog.rules, 0, 'char-y');
  const tracks = pve.searchTracks(tracked, area, catalog.rules, catalog.rules.tracksCooldownMs, {
    aliveCount: 0, random: () => 0.01
  });
  assert(tracks.ok && tracks.spawn, 'Tracks lead to a group: ' + JSON.stringify(tracks));
  assert.notEqual(tracks.spawn.circumstance.kind, 'ambush', 'Following tracks is never an ambush.');
}

// Сервер обязан различать обстоятельства: засада появляется ближе и сразу
// идёт на игрока, смешанная приводит спутника.
{
  const serverSource = read('server.js');
  for (const token of [
    "const ambush = circumstance?.kind === 'ambush';",
    'spawned.push(...serverSpawnPvePack(room, area, { ...circumstance.companion, circumstance: null }, now));',
    'minPlayerDistance: ambush ? rules.ambushMinPlayerDistance : rules.spawnMinPlayerDistance',
    'if (prey?.player) aggroEnemyFromHit(room, enemy, prey.player, now);'
  ]) assert(serverSource.includes(token), `server.js must honour the encounter circumstances: ${token}`);
}

// Сервер обязан считать пройденный путь и показывать остаток игроку.
{
  const serverSource = read('server.js');
  for (const token of [
    'function serverNotePveTravel(room, occupants = []) {',
    'serverNotePveTravel(room, occupants);',
    'if (mark) best = Math.max(best, Math.hypot(x - mark.x, z - mark.z));'
  ]) assert(serverSource.includes(token), `server.js must count the travelled path: ${token}`);
  const area = catalog.areas[0];
  const state = pve.createPveRoomState(area, catalog.rules, 0, 'char-z');
  const view = pve.publicPveRoomState(state, area, catalog.rules, 0, { aliveCount: 0, members: 1 });
  assert.equal(view.distanceToRollM, catalog.rules.distancePerRollM, 'A standing party sees the whole way ahead.');
  pve.notePveDistance(state, 30);
  assert.equal(pve.publicPveRoomState(state, area, catalog.rules, 0, { aliveCount: 0, members: 1 }).distanceToRollM,
    catalog.rules.distancePerRollM - 30, 'The remaining way shrinks as the party walks.');
  // Игрок должен видеть остаток пути, иначе тишина выглядит поломкой.
  const presentation = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaWorldEventsPresentation.cs'), 'utf8');
  assert(presentation.includes('int toRoll = payload["distanceToRollM"]?.Value<int>() ?? 0;'),
    'The area line must say how far the party still has to walk.');
  // Проверка требует обоих условий: пройденного пути и выдержанного интервала.
  // Прошедший свою долю отряд иначе стоит в тишине и не знает, чего ждёт.
  assert(view.nextRollInSeconds > 0, 'A fresh area waits out its interval before the first roll.');
  assert(presentation.includes('int nextRoll = Math.Max(0, (payload["nextRollInSeconds"]?.Value<int>() ?? 0) - elapsedSeconds);'),
    'The area line must say how long the party still waits for the roll.');
  assert(presentation.includes('sb.Append(" · проверка через ").Append(nextRoll).Append(" с");'),
    'The waiting time must reach the panel.');
  // Точка на карте принадлежит области: без этого игрок узнаёт об этом только
  // на месте, а полная сводка области живёт лишь в отладочной раскладке.
  const mapSource = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaGlobalMap.cs'), 'utf8');
  assert(mapSource.includes('public static string PveAreaMetaLabel(JObject area)'),
    'The map must carry a short label of the area under the target.');
}

console.log(`PvE areas OK: ${catalog.areas.length} hunting grounds, encounter tables, one-shot scenes, one shared lair per ground with its boss and escort, no PvP/no loss.`);
