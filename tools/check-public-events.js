#!/usr/bin/env node
'use strict';

// Временные публичные события: шаблоны, появление по расписанию, время
// жизни с предупреждением, спорный сундук через 45–60 с после зачистки,
// задержка возврата 60–90 с после смерти, зона симуляции и серверные крючки.
// Всё под управляемым временем — без ожидания.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const events = require('../src/server/public-events');
const { zoneModeAllowsPvp, zoneModeLossPolicy } = require('../src/server/zone-rules');
const { deathLootPolicy } = require('../src/server/kromka-death-loot');
const catalog = events.normalizePublicEventCatalog(JSON.parse(read('data/kromka/public-events.json')));
const encounters = JSON.parse(read('data/encounters.json')).encounters;
const items = new Set(JSON.parse(read('data/kromka/items.json')).items.map(row => row.id));

// --- данные -------------------------------------------------------------------
assert(catalog.templates.length >= 4, 'At least four event templates.');
assert.deepEqual(catalog.rules, {
  maxActive: 3, spawnIntervalMs: 900000, initialSpawnDelayMs: 60000, minLifetimeMs: 1800000, maxLifetimeMs: 2700000,
  expiryWarningMs: 300000, chestOpenDelayMs: [45000, 60000], deathRejoinDelayMs: [60000, 90000], zoneRadius: 9,
  // Вскрытие тайника: длительность канала, дистанция удержания и радиус, с
  // которого чужой игрок останавливает прогресс.
  chestChannelMs: 8000, chestChannelRangeM: 2.5, chestContestRangeM: 14
});
assert(catalog.templates.some(row => row.kind === 'raiderBase') && catalog.templates.some(row => row.kind === 'monsterLair'));
for (const template of catalog.templates) {
  const location = JSON.parse(read(`data/locations/${template.locationId}.json`));
  assert(location.randomTemplate === true, `${template.id}: events use temporary template locations.`);
  assert(encounters[template.encounterId], `${template.id}: unknown encounter ${template.encounterId}.`);
  assert(encounters[template.encounterId].actors.some(actor => actor.hostileToPlayer), `${template.id}: the encounter must have hostiles to clear.`);
  assert(template.chest.loot.length >= 3, `${template.id}: the chest needs loot.`);
  for (const row of template.chest.loot) assert(items.has(row.id), `${template.id}: unknown loot item ${row.id}.`);
}

// --- режим зоны: PvP разрешено, вещи сохраняются --------------------------------
assert.equal(zoneModeAllowsPvp('pvpEvent'), true);
assert.equal(zoneModeLossPolicy('pvpEvent'), 'none');
assert.deepEqual(deathLootPolicy('pvpEvent'), { mode: 'pvpEvent', loss: 'none' });

// --- появление по расписанию ------------------------------------------------------
const rules = catalog.rules;
const store = events.normalizePublicEventStore({});
const t0 = 10000000;
const pickPoint = () => ({ x: 125, y: 95 });
assert.deepEqual(events.spawnDuePublicEvents(store, catalog, t0, { random: () => 0, pickPoint }), [], 'No event before the initial delay.');
const first = events.spawnDuePublicEvents(store, catalog, t0 + rules.initialSpawnDelayMs, { random: () => 0, pickPoint });
assert.equal(first.length, 1, 'The first event appears after the initial delay.');
assert.equal(first[0].status, 'active');
assert.equal(first[0].pvpMode, 'pvpEvent');
assert.equal(first[0].roomId, `${first[0].locationId}#${first[0].id}`, 'One shared room per event.');
assert.equal(first[0].expiresAt - first[0].createdAt, rules.minLifetimeMs, 'Random zero picks the shortest lifetime.');
assert.equal(first[0].warningAt, first[0].expiresAt - rules.expiryWarningMs);
assert.deepEqual(events.spawnDuePublicEvents(store, catalog, t0 + rules.initialSpawnDelayMs + 1000, { random: () => 0, pickPoint }), [], 'Events respect the spawn interval.');
const second = events.spawnDuePublicEvents(store, catalog, t0 + rules.initialSpawnDelayMs + rules.spawnIntervalMs, { random: () => 0, pickPoint });
assert.equal(second.length, 1);
assert.notEqual(second[0].templateId, first[0].templateId, 'Active templates are not duplicated while another choice exists.');
const third = events.spawnDuePublicEvents(store, catalog, t0 + rules.initialSpawnDelayMs + rules.spawnIntervalMs * 2, { random: () => 0, pickPoint });
assert.equal(third.length, 1);
assert.equal(events.activeEvents(store).length, 3);
assert.deepEqual(events.spawnDuePublicEvents(store, catalog, t0 + rules.initialSpawnDelayMs + rules.spawnIntervalMs * 3, { random: () => 0, pickPoint }), [], 'maxActive caps concurrent events.');
const longest = events.createPublicEvent(catalog.templates[0], { now: t0, random: () => 0.9999999, rules, point: { x: 1, y: 2 }, id: 'long' });
assert.equal(longest.expiresAt - longest.createdAt, rules.maxLifetimeMs, 'Random one picks the longest lifetime.');

// --- жизненный цикл --------------------------------------------------------------
const event = first[0];
assert.deepEqual(events.tickPublicEvent(event, rules, event.warningAt - 1), { warned: false, expired: false });
assert.deepEqual(events.tickPublicEvent(event, rules, event.warningAt), { warned: true, expired: false });
assert.equal(event.status, 'warning');
assert.deepEqual(events.tickPublicEvent(event, rules, event.warningAt + 1), { warned: false, expired: false }, 'Warning fires once.');
assert.equal(events.publicEvent(event, event.warningAt).remainingSeconds, rules.expiryWarningMs / 1000);
assert.deepEqual(events.tickPublicEvent(event, rules, event.expiresAt), { warned: false, expired: true });
assert.equal(event.status, 'expired');
assert.equal(events.publicEventEntryError(event, 'anyone', event.expiresAt + 1), 'Событие уже завершилось.');
assert.equal(events.publicEvents(store, event.expiresAt + 1).length, 2, 'Expired events leave the public list.');
assert.equal(events.purgeExpiredPublicEvents(store, event.expiresAt + 1000), 0, 'Expired events linger briefly for late clients.');
assert.equal(events.purgeExpiredPublicEvents(store, event.expiresAt + 600000), 1);
assert.equal(events.activeEvents(store).length, 2);

// --- спорный сундук ----------------------------------------------------------------
const lair = second[0];
const clearAt = lair.createdAt + 120000;
assert.equal(events.claimPublicEventChest(lair, 'char-a', clearAt).error, 'Сначала зачистите логово.');
assert(events.notePublicEventCleared(lair, rules, clearAt, () => 0), 'Clearing arms the chest once.');
assert(!events.notePublicEventCleared(lair, rules, clearAt + 1, () => 0));
assert.equal(lair.chest.opensAt, clearAt + rules.chestOpenDelayMs[0], 'Random zero opens after 45 s.');
const armedLate = events.createPublicEvent(catalog.templates[1], { now: t0, random: () => 0.9999999, rules, point: { x: 1, y: 2 }, id: 'late' });
events.notePublicEventCleared(armedLate, rules, t0, () => 0.9999999);
assert.equal(armedLate.chest.opensAt, t0 + rules.chestOpenDelayMs[1], 'Random one opens after 60 s.');
assert(!events.publicEventChestOpen(lair, clearAt + 44999));
const early = events.claimPublicEventChest(lair, 'char-a', clearAt + 10000);
assert(!early.ok && early.opensInMs === 35000, 'The chest stays contested until it opens.');
assert(events.publicEventChestOpen(lair, clearAt + 45000));

// Вскрытие — процесс: канал держат у тайника, чужие рядом ставят его на паузу,
// уход или смерть сбрасывают прогресс, награду получает только завершивший.
const openAt = clearAt + 45000;
const rushed = events.claimPublicEventChest(lair, 'char-a', openAt, rules);
assert(!rushed.ok && rushed.needsOpening, 'Without the opening channel the reward is not handed out.');
assert(events.beginChestOpening(lair, { characterId: 'char-a', name: 'Первый' }, rules, openAt).ok);
const busy = events.beginChestOpening(lair, { characterId: 'char-b', name: 'Второй' }, rules, openAt + 100);
assert(!busy.ok && busy.busy, 'A second player cannot hijack an active channel.');
let step = events.tickChestOpening(lair, { present: true, contested: true }, rules, openAt + 3000);
assert(step.active && step.contested && step.progressMs === 0, 'An enemy nearby pauses the progress.');
step = events.tickChestOpening(lair, { present: true, contested: false }, rules, openAt + 6000);
assert(step.progressMs === 3000 && !step.done, 'Without enemies the channel advances.');
step = events.tickChestOpening(lair, { present: false }, rules, openAt + 7000);
assert(step.cancelled && !lair.chest.opening.characterId, 'Leaving the chest resets the channel.');
assert(!events.claimPublicEventChest(lair, 'char-a', openAt + 7000, rules).ok, 'A broken channel gives nothing.');
assert(events.beginChestOpening(lair, { characterId: 'char-a', name: 'Первый' }, rules, openAt + 8000).ok,
  'After the reset the channel can be started again.');
events.tickChestOpening(lair, { present: true, contested: false }, rules, openAt + 8000 + rules.chestChannelMs);
assert.equal(lair.chest.opening.progressMs, rules.chestChannelMs, 'The full channel is accumulated.');
assert(events.claimPublicEventChest(lair, 'char-a', openAt + 20000, rules).ok, 'The one who finished the channel takes the reward.');
assert.equal(lair.chest.opening.characterId, '', 'A claimed chest closes its channel.');
assert.equal(events.claimPublicEventChest(lair, 'char-b', openAt + 20001, rules).error, 'Тайник уже забрали.');
assert(events.claimPublicEventChest(lair, 'char-a', openAt + 20002, rules).repeat, 'The owner may re-open his own chest.');
assert.equal(events.publicEvent(lair, openAt + 20002).chestClaimed, true);

// --- задержка возврата после смерти --------------------------------------------------
const until = events.recordPublicEventDeath(lair, 'char-b', rules, clearAt, () => 0);
assert.equal(until, clearAt + rules.deathRejoinDelayMs[0]);
assert.equal(events.recordPublicEventDeath(lair, 'char-c', rules, clearAt, () => 0.9999999), clearAt + rules.deathRejoinDelayMs[1]);
assert.equal(events.publicEventRejoinBlockedMs(lair, 'char-b', clearAt + 1000), 59000);
assert(events.publicEventEntryError(lair, 'char-b', clearAt + 1000).includes('59 с'));
assert.equal(events.publicEventEntryError(lair, 'char-b', clearAt + 60000), '', 'The block lifts after the delay.');
assert.equal(events.publicEventEntryError(lair, 'char-a', clearAt + 1000), '', 'Living players are never blocked.');

// --- сохранение и зона симуляции ----------------------------------------------------------
const restored = events.normalizePublicEventStore(JSON.parse(JSON.stringify(store)));
assert.deepEqual(restored, store, 'The store survives a JSON round trip.');
const zone = events.publicEventZone(lair, rules, 40);
assert.equal(zone.id, lair.id);
assert.equal(zone.roomId, lair.roomId);
assert.equal(zone.pvpMode, 'pvpEvent');
assert.equal(zone.details.publicEvent, true);
assert.equal(zone.details.eventId, lair.id);
assert.equal(zone.status, 'active');
assert.equal(events.publicEventZone({ ...lair, status: 'expired' }, rules, 40).status, 'expired');
const simSource = read('src/server/wasteland-sim.js');
for (const needle of ['function upsertWorldZone(input = {})', 'function removeWorldZone(id = \'\')', '    upsertWorldZone,', '    removeWorldZone,'])
  assert(simSource.includes(needle), `wasteland-sim.js is missing ${needle}`);
const projected = events.publicEvent(lair, clearAt + 45001);
assert(!('deaths' in projected) && !('chest' in projected), 'Internal timers do not leak to clients.');

// --- серверные крючки -------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  'savesDb.publicEvents = normalizePublicEventStore(savesDb.publicEvents)',
  'serverTickPublicEvents(Date.now())',
  'serverRestorePublicEventZones();',
  'const transitionPublicEvent = serverPublicEventForZone(activeTransitionZone);',
  'const eventError = arrivalEvent ? publicEventEntryError(arrivalEvent, member.characterId, now) : \'\';',
  'serverNotePublicEventDeath(oldRoom, p, now);',
  'const eventChestError = serverPublicEventChestError(room, container, p, Date.now());',
  'publicEvents: publicPublicEvents(serverPublicEventStore(), now)',
  "emit('publicEventState', payload)",
  'function serverEvictPublicEventRoom(event, now = Date.now())',
  'WASTELAND_SIM.upsertWorldZone(publicEventZone(event, KROMKA_PUBLIC_EVENT_CATALOG.rules'
]) assert(server.includes(needle), `server.js is missing the public event contract: ${needle}`);
const socketClient = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
assert(socketClient.includes('_connection.On("publicEventState"') && socketClient.includes('OnPublicEventState?.Invoke(payload)'), 'Unity must route publicEventState.');

// --- мини-босс сценария и сохранение награды ------------------------------------
// Спецификация требует мини-босса в цикле события и однократной выдачи награды,
// которая не пропадает при перезапуске.
for (const template of catalog.templates) {
  assert(template.boss && template.boss.displayName, `${template.id}: the scenario declares a mini boss`);
  assert(template.danger >= 1 && template.danger <= 5, `${template.id}: the scenario declares its danger`);
}
const bossEvent = events.createPublicEvent(catalog.byId.raider_base, { now: t0, rules, random: () => 0.5, point: { x: 40, y: 40 } });
assert.equal(bossEvent.danger, catalog.byId.raider_base.danger, 'The event carries the danger of its scenario.');
assert.equal(events.publicEventBossDefeated(bossEvent, catalog.byId.raider_base), false,
  'While the boss is alive the event is not cleared.');
assert(events.notePublicEventBoss(bossEvent, { spawned: true }), 'The boss appears once.');
assert(!events.notePublicEventBoss(bossEvent, { spawned: true }), 'The boss never doubles.');
assert(events.notePublicEventBoss(bossEvent, { killedAt: t0 + 1000 }));
assert.equal(events.publicEventBossDefeated(bossEvent, catalog.byId.raider_base), true, 'A dead boss opens the way to the reward.');
const bossView = events.publicEvent(bossEvent, t0 + 2000, rules, { bossName: catalog.byId.raider_base.boss.displayName });
assert.equal(bossView.boss.displayName, 'Главарь налётчиков', 'Players see who to hunt.');
assert.equal(bossView.boss.killed, true);
assert.equal(bossView.danger, catalog.byId.raider_base.danger);
// Сундук и состояние босса переживают перезапуск.
bossEvent.chest.announced = true;
const restoredStore = events.normalizePublicEventStore({ version: 1, events: { [bossEvent.id]: bossEvent } });
const restoredEvent = restoredStore.events[bossEvent.id];
assert.equal(restoredEvent.boss.killedAt, t0 + 1000, 'The defeated boss stays defeated after a restart.');
assert.equal(restoredEvent.chest.announced, true, 'An announced chest is not announced twice after a restart.');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const needle of [
  "socket.on('publicEventAction'",
  'function serverAdvanceChestOpening(',
  "cancelChestOpening(event, player.characterId, 'death')",
  "claimPublicEventChest(event, player?.characterId || '', now, KROMKA_PUBLIC_EVENT_CATALOG.rules)",
  'function serverEnsurePublicEventBoss(',
  'publicEventBossDefeated(event, template)',
  "if (room && event.cleared && !event.chest.claimedBy) serverSpawnPublicEventChest(room, event, now);"
]) assert(serverSource.includes(needle), `server.js must run the scenario boss and restore the reward: ${needle}`);
assert(!serverSource.includes('event.chestAnnounced'), 'The announcement flag must live in the persisted event.');

// --- механики сценария ---------------------------------------------------------
// Спецификация требует у базы налётчиков главаря, защитный генератор,
// обозначенные гранатные удары и подкрепления через радиостанцию; у логова —
// матку, гнёзда, обозначенный рывок и опасные участки земли.
const scenarios = require('../src/server/public-event-scenarios');
const raider = catalog.byId.raider_base.mechanics;
assert(raider.supports.some(row => row.kind === 'shield'), 'The raider base is protected by a shield generator.');
assert(raider.supports.some(row => row.kind === 'reinforcement'), 'The raider base calls reinforcements by radio.');
assert.equal(raider.strike.kind, 'grenade', 'The leader throws telegraphed grenades.');
const lairMechanics = catalog.byId.mutant_lair.mechanics;
assert(lairMechanics.supports.filter(row => row.kind === 'reinforcement').length >= 2, 'The lair breeds from nests.');
assert.equal(lairMechanics.strike.kind, 'dash', 'The matriarch dashes.');
assert(lairMechanics.hazards.count >= 1, 'The lair floor is dangerous.');

const scenarioEvent = events.createPublicEvent(catalog.byId.raider_base,
  { now: t0, rules, random: () => 0.5, point: { x: 10, y: 10 } });
assert.equal(scenarios.scenarioBossShielded(scenarioEvent.scenario, raider), true,
  'While the generator stands the leader is shielded.');
assert(scenarios.noteSupportDestroyed(scenarioEvent.scenario, 'shield_generator'));
assert.equal(scenarios.scenarioBossShielded(scenarioEvent.scenario, raider), false,
  'A destroyed generator drops the shield.');
assert(!scenarios.noteSupportDestroyed(scenarioEvent.scenario, 'shield_generator'), 'A support is destroyed once.');

// Удар бьёт по точке, объявленной в момент обозначения, а не по текущей позиции.
let strikeEvents = scenarios.tickScenario(scenarioEvent.scenario, raider,
  { bossAlive: true, hostilesAlive: 0, pickTarget: () => ({ x: 4, z: 4 }) }, t0 + 1000);
assert.deepEqual(strikeEvents.map(row => row.type), [], 'Nothing happens before the interval.');
strikeEvents = scenarios.tickScenario(scenarioEvent.scenario, raider,
  { bossAlive: true, hostilesAlive: 0, pickTarget: () => ({ x: 4, z: 4 }) }, t0 + 1000 + raider.strike.intervalMs - raider.strike.telegraphMs);
assert.equal(strikeEvents[0]?.type, 'strikeTelegraph', 'The strike is telegraphed first.');
strikeEvents = scenarios.tickScenario(scenarioEvent.scenario, raider,
  { bossAlive: true, hostilesAlive: 0, pickTarget: () => ({ x: 30, z: 30 }) }, t0 + 1000 + raider.strike.intervalMs);
const landed = strikeEvents.find(row => row.type === 'strike');
assert(landed && landed.x === 4 && landed.z === 4, 'The strike lands where it was announced, not where the target moved.');

// Подкрепления идут от целых опор и не превышают порога живых врагов.
const radio = raider.supports.find(row => row.kind === 'reinforcement');
scenarios.tickScenario(scenarioEvent.scenario, raider, { bossAlive: true, hostilesAlive: 0 }, t0 + 2000);
const wave = scenarios.tickScenario(scenarioEvent.scenario, raider,
  { bossAlive: true, hostilesAlive: 0 }, t0 + 2000 + radio.intervalMs);
assert(wave.some(row => row.type === 'reinforcement' && row.supportId === radio.id), 'An intact radio calls reinforcements.');
const crowded = scenarios.tickScenario(scenarioEvent.scenario, raider,
  { bossAlive: true, hostilesAlive: radio.maxAlive }, t0 + 2000 + radio.intervalMs * 2);
assert(!crowded.some(row => row.type === 'reinforcement'), 'A crowded room gets no new reinforcements.');
scenarios.noteSupportDestroyed(scenarioEvent.scenario, radio.id);
const silenced = scenarios.tickScenario(scenarioEvent.scenario, raider,
  { bossAlive: true, hostilesAlive: 0 }, t0 + 2000 + radio.intervalMs * 3);
assert(!silenced.some(row => row.type === 'reinforcement'), 'A destroyed radio stops the reinforcements.');

// Опасная земля логова смещается после удара и переживает перезапуск.
const lairEvent = events.createPublicEvent(catalog.byId.mutant_lair,
  { now: t0, rules, random: () => 0.5, point: { x: 10, y: 10 } });
const groundBefore = scenarios.scenarioHazards(lairEvent.scenario, lairMechanics, { x: 0, z: 0 });
assert.equal(groundBefore.length, lairMechanics.hazards.count, 'The lair floor burns in the authored number of patches.');
lairEvent.scenario.hazardOffset += 1;
const groundAfter = scenarios.scenarioHazards(lairEvent.scenario, lairMechanics, { x: 0, z: 0 });
assert.notDeepEqual(groundAfter.map(row => row.id), groundBefore.map(row => row.id), 'Dangerous ground moves.');
const restoredScenario = events.normalizePublicEventStore({ version: 1, events: { [scenarioEvent.id]: scenarioEvent } })
  .events[scenarioEvent.id].scenario;
assert(restoredScenario.destroyed.includes('shield_generator'), 'Destroyed supports stay destroyed after a restart.');

const view = scenarios.publicScenario(scenarioEvent.scenario, raider, { x: 0, z: 0 }, t0 + 3000);
assert.equal(view.shielded, false);
assert(view.supports.every(row => row.alive === false), 'The snapshot reports what is already broken.');

const scenarioServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const needle of [
  'function serverEnsurePublicEventSupports(',
  'function serverAdvancePublicEventScenario(',
  'function serverApplyPublicEventStrike(',
  'function serverSpawnPublicEventReinforcement(',
  'if (enemy?.publicEventBossId && serverPublicEventDamageBlocked(room, enemy)) return 0;',
  // Комната события, созданная заново после перезапуска, должна снова получить
  // своих обитателей — иначе зачищать некого и тайник не открывается никогда.
  'function serverEnsurePublicEventEncounter(room, now = Date.now()) {',
  'if (room && serverEnsurePublicEventEncounter(room, now)) changed = true;',
  'serverEnsurePublicEventEncounter(room, Date.now());',
  'room.encounterSetupDone = false;',
  // Ровно один раз на комнату: перебитое игроками логово не наполняется снова.
  "if (String(room.publicEventEncounterId || '') === String(event.id || '')) return false;",
  "room.publicEventEncounterId = String(event.id || '').slice(0, 64);"
]) assert(scenarioServer.includes(needle), `server.js must run the scenario mechanics: ${needle}`);

// --- несколько подходов к цели ---------------------------------------------------
// У каждого сценария не меньше двух опор, и они стоят с разных сторон: отряд
// выбирает, с какой заходить, а не идёт одним коридором.
for (const template of catalog.templates) {
  const supports = template.mechanics?.supports || [];
  assert(supports.length >= 2, `${template.id}: the objective must be approachable from more than one side`);
  const sides = new Set(supports.map(row => scenarios.supportSide(row.x, row.z)));
  assert(sides.size >= 2, `${template.id}: the supports must stand on different sides, got ${[...sides].join(', ')}`);
  for (const row of supports) {
    assert(Math.hypot(Number(row.x || 0), Number(row.z || 0)) >= 4,
      `${template.id}/${row.id}: a support next to the objective gives no approach to choose`);
  }
  const view = scenarios.publicScenario(scenarios.normalizeScenarioState({}), template.mechanics, { x: 0, z: 0 }, 0);
  assert.equal(view.supports.length, supports.length);
  for (const row of view.supports) assert(row.side, `${template.id}/${row.id}: the snapshot names the side of the support`);
}
{
  const presentation = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaWorldEventsPresentation.cs'), 'utf8');
  assert(presentation.includes('string side = row["side"]?.ToString();'),
    'The event line must name the side of every intact support.');
  assert(presentation.includes('string strikeSide = CompassSide(strike["x"]?.Value<float>() ?? 0f, strike["z"]?.Value<float>() ?? 0f);'),
    'The telegraphed strike must name the side it comes from.');
}

console.log(`Public events OK: ${catalog.templates.length} templates, scheduled spawns, lifetime with warning and eviction, contested chest 45–60 s, death rejoin 60–90 s, persisted store and simulation zones.`);
