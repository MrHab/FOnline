'use strict';

// Проверки цикла аванпоста с управляемым временем: границы 20-минутного
// интервала, однократное открытие, конкуренция фракций, гарнизон на смену
// владельца, перезапуск и публичный снимок. Реальных ожиданий нет.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  advanceGarrison,
  applyCapturePresence,
  applyOwnerChange,
  markGarrisonDestroyed,
  nextEventAtMs,
  normalizeTerritoryStore,
  openDueEvents,
  outpostRules,
  publicTerritoryState
} = require('../src/server/territory-outposts');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/territory.json'), 'utf8'));
const rules = outpostRules(catalog);
const LOCK = rules.ownerChangeLockMs;
const HOLD = rules.captureHoldMs;
assert.strictEqual(LOCK, 1200000, 'the owner-change lock is exactly 20 real minutes');
assert.strictEqual(HOLD, 180000);

const t0 = 1_900_000_000_000;
const store = normalizeTerritoryStore(null, catalog, t0);
assert.deepStrictEqual(Object.keys(store.outposts), ['outpostPump', 'outpostRelay', 'outpostDepot']);
const pump = store.outposts.outpostPump;
assert.strictEqual(pump.ownerFactionId, '', 'authored outposts start neutral');
assert.strictEqual(pump.event.status, 'open', 'a neutral outpost opens its first event immediately');
assert.strictEqual(nextEventAtMs(pump, rules), 0);

// Захват единственной атакующей фракцией: прогресс идёт тиками по 1 с, владелец
// меняется ровно когда накоплено holdMs.
let now = t0;
function tick(outpost, presence, steps, stepMs = 1000) {
  let last = null;
  for (let i = 0; i < steps; i++) {
    now += stepMs;
    last = applyCapturePresence(outpost, presence, now, rules);
    if (last.captured) return last;
  }
  return last;
}
applyCapturePresence(pump, {}, now, rules); // первый тик задаёт lastTickMs
let result = tick(pump, { uprava: { players: 2, guards: 0 } }, HOLD / 1000 - 1);
assert.strictEqual(result.captured, '', 'one second short of the hold must not capture');
assert.strictEqual(pump.capture.progressMs.uprava, HOLD - 1000);
result = tick(pump, { uprava: { players: 2, guards: 0 } }, 1);
assert.strictEqual(result.captured, 'uprava');
const capture1 = applyOwnerChange(store, 'outpostPump', 'uprava', now, catalog, { routeLengthMeters: 220 });
assert.strictEqual(capture1.ok, true);
assert.strictEqual(capture1.seq, 1);
const changedAt = now;
assert.strictEqual(pump.ownerFactionId, 'uprava');
assert.strictEqual(pump.event.status, 'closed', 'a successful capture closes the event');
assert.deepStrictEqual(pump.capture.progressMs, {}, 'progress resets on owner change');
assert.strictEqual(nextEventAtMs(pump, rules), changedAt + LOCK);
assert.strictEqual(pump.garrison.state, 'dispatched');
assert.strictEqual(pump.garrison.seq, 1);
assert.strictEqual(pump.garrison.factionId, 'uprava');

// Вне события владелец не меняется: ни присутствием, ни убийством охраны, ни
// прямым запросом; текущий владелец не может «захватить» свой объект.
result = tick(pump, { contour: { players: 5, guards: 0 } }, 30);
assert.strictEqual(result.captured, '');
assert.deepStrictEqual(pump.capture.progressMs, {}, 'no progress while the capture is closed');
assert.strictEqual(applyOwnerChange(store, 'outpostPump', 'contour', now, catalog).reason, 'eventClosed');
assert.strictEqual(applyOwnerChange(store, 'outpostPump', 'uprava', now, catalog).reason, 'sameOwner');
markGarrisonDestroyed(pump, now);
assert.strictEqual(pump.garrison.state, 'none', 'a destroyed garrison is gone until the next owner change');
assert.strictEqual(nextEventAtMs(pump, rules), changedAt + LOCK, 'guard deaths do not move the countdown');

// Граница интервала: за 1 мс до срока событие закрыто, в срок открывается один раз.
assert.deepStrictEqual(openDueEvents(store, catalog, changedAt + LOCK - 1), []);
assert.strictEqual(pump.event.status, 'closed');
assert.deepStrictEqual(openDueEvents(store, catalog, changedAt + LOCK), ['outpostPump']);
assert.strictEqual(pump.event.status, 'open');
assert.strictEqual(pump.event.openedForSeq, 1);
assert.deepStrictEqual(openDueEvents(store, catalog, changedAt + LOCK + 5000), [], 'the event opens only once');
now = changedAt + LOCK;
applyCapturePresence(pump, {}, now, rules);

// Владелец с охраной блокирует прогресс; две фракции оспаривают; уход второй
// фракции возобновляет накопление у оставшейся; пустая область затухает.
result = tick(pump, { contour: { players: 1, guards: 0 }, uprava: { players: 0, guards: 2 } }, 10);
assert.strictEqual(result.contested, true);
assert.deepStrictEqual(pump.capture.progressMs, {}, 'owner guards inside the zone stop the capture');
result = tick(pump, { contour: { players: 1, guards: 0 }, tract_league: { players: 1, guards: 0 } }, 10);
assert.strictEqual(result.contested, true);
assert.deepStrictEqual(pump.capture.progressMs, {}, 'two attacking factions cannot progress simultaneously');
result = tick(pump, { contour: { players: 1, guards: 0 } }, 20);
assert.strictEqual(pump.capture.progressMs.contour, 20000);
assert.strictEqual(result.leadingFactionId, 'contour');
result = tick(pump, {}, 10);
assert.strictEqual(pump.capture.progressMs.contour, 15000, 'an empty zone decays progress at half speed');
result = tick(pump, { contour: { players: 1, guards: 0 } }, HOLD / 1000);
assert.strictEqual(result.captured, 'contour');
const capture2 = applyOwnerChange(store, 'outpostPump', 'contour', now, catalog, { routeLengthMeters: 220 });
assert.strictEqual(capture2.seq, 2);
assert.strictEqual(capture2.previousFactionId, 'uprava');
assert.strictEqual(pump.garrison.seq, 2, 'exactly one garrison per owner change');
assert.strictEqual(pump.garrison.factionId, 'contour');

// Несколько фракций не могут одновременно получить владение: второй запрос
// после смены владельца отклоняется как закрытое событие.
assert.strictEqual(applyOwnerChange(store, 'outpostPump', 'tract_league', now, catalog).reason, 'eventClosed');

// Гарнизон идёт по времени: 220 м при 2,2 м/с = 100 с; прибывает и защищает.
let garrison = advanceGarrison(pump, now + 1000, rules);
assert.strictEqual(garrison.state, 'enroute');
garrison = advanceGarrison(pump, now + 50000, rules);
assert(garrison.progress > 0.49 && garrison.progress < 0.51, `half way after 50 s, got ${garrison.progress}`);
garrison = advanceGarrison(pump, now + 100000, rules);
assert.strictEqual(garrison.state, 'arrived');
assert.strictEqual(pump.garrison.arrivedAtMs, now + 100000);

// Перезапуск: JSON-раундтрип и повторная нормализация не дублируют отряд и не
// сдвигают отсчёт; просроченное событие открывается однократно после запуска.
const restored = normalizeTerritoryStore(JSON.parse(JSON.stringify(store)), catalog, now + 200000);
const restoredPump = restored.outposts.outpostPump;
assert.strictEqual(restoredPump.ownerFactionId, 'contour');
assert.strictEqual(restoredPump.ownerChangeSeq, 2);
assert.strictEqual(restoredPump.garrison.seq, 2);
assert.strictEqual(restoredPump.garrison.state, 'arrived');
assert.strictEqual(nextEventAtMs(restoredPump, rules), now + LOCK);
assert.deepStrictEqual(openDueEvents(restored, catalog, now + LOCK + 3600000), ['outpostPump'], 'an event missed during downtime opens once after restart');
assert.deepStrictEqual(openDueEvents(restored, catalog, now + LOCK + 3600001), []);

// Смена владельца во время движения прежнего отряда: старый отряд возвращается
// на базу и не становится гарнизоном новой фракции.
const relay = store.outposts.outpostRelay;
applyCapturePresence(relay, {}, now, rules);
tick(relay, { uprava: { players: 1, guards: 0 } }, HOLD / 1000);
assert.strictEqual(applyOwnerChange(store, 'outpostRelay', 'uprava', now, catalog, { routeLengthMeters: 220 }).ok, true);
advanceGarrison(relay, now + 30000, rules);
assert.strictEqual(relay.garrison.state, 'enroute');
// Событие открывается через 20 минут; вторая фракция захватывает, пока первый
// отряд ещё «в пути» (моделируем задержку отряда).
openDueEvents(store, catalog, now + LOCK);
relay.capture.lastTickMs = now + LOCK;
let t = now + LOCK;
for (let i = 0; i < HOLD / 1000; i++) { t += 1000; applyCapturePresence(relay, { tract_league: { players: 1, guards: 0 } }, t, rules); }
assert.strictEqual(applyOwnerChange(store, 'outpostRelay', 'tract_league', t, catalog, { routeLengthMeters: 220 }).ok, true);
assert.strictEqual(relay.garrison.seq, 2);
assert.strictEqual(relay.garrison.factionId, 'tract_league', 'the new owner gets its own garrison');
const stale = { ...relay, garrison: { ...relay.garrison, seq: 1, factionId: 'uprava', state: 'enroute', progress: 0.4, dispatchedAtMs: t - 40000, routeLengthMeters: 220 } };
const staleResult = advanceGarrison(stale, t + 1000, rules);
assert.strictEqual(staleResult.state, 'returning', 'a squad from an older owner change turns back');
advanceGarrison(stale, t + 1000 + 40000 + 1000, rules);
assert.strictEqual(stale.garrison.state, 'none', 'the returning squad disappears at its base');

// Публичный снимок согласован для всех игроков: владелец, состояние события,
// обратный отсчёт, прогресс и гарнизон.
const snapshot = publicTerritoryState(store, catalog, t);
assert.strictEqual(snapshot.outposts.length, 3);
const publicRelay = snapshot.outposts.find(row => row.id === 'outpostRelay');
assert.strictEqual(publicRelay.ownerFactionId, 'tract_league');
assert.strictEqual(publicRelay.eventStatus, 'closed');
assert.strictEqual(publicRelay.nextEventAtMs, t + LOCK);
assert.strictEqual(publicRelay.eventOpensInMs, LOCK);
assert.strictEqual(publicRelay.garrison.state, 'dispatched');
assert.strictEqual(snapshot.rules.ownerChangeLockMs, LOCK);
const depot = snapshot.outposts.find(row => row.id === 'outpostDepot');
assert.strictEqual(depot.eventStatus, 'open', 'an untouched neutral outpost stays capturable');

console.log('Territory outposts OK: 20-minute lock boundary, single opening, contest/decay rules, one garrison per owner change, restart safety and public snapshot.');
