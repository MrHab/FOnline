#!/usr/bin/env node
'use strict';

// Живая проверка различимости тварей. Каталог data/mutants.json давно описывал
// вдвое больше, чем сервер исполнял: он всегда брал attacks[0], игнорировал
// авторские telegraphMs и не читал bleedChance. Статическая проверка каталога
// этого не ловила — поэтому здесь поднимается настоящий сервер, и утверждения
// делаются по тому, что видит клиент.
//
// Проверяется:
//   1) вид с двумя авторскими атаками показывает обе, а не одну;
//   2) кровотечение живёт как состояние: тикает уроном и снижает здоровье;
//   3) невозможное состояние «здоровье кончилось, а смерть не наступила»
//      чинится тиком, а не превращается в неубиваемого немого персонажа.
//
// Авторское окно замаха здесь не наблюдается: telegraphMs уезжает в кадре
// enemyFrame, а кадры сервер шлёт только подписанным на них клиентам. Его
// контракт закреплён статически в check-kromka-mutants.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./check-combat-runtime');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/mutants.json'), 'utf8'));
const species = new Map((catalog.types || []).map(row => [row.id, row]));
const multiAttack = new Set([...species.values()].filter(row => (row.attacks || []).length > 1).map(row => row.id));
assert(multiAttack.size >= 2, 'в каталоге должно быть хотя бы два вида с двумя атаками');

// «Пустошь» — единственная открытая локация со штатным респауном тварей
// (enemyCap 12), поэтому наблюдение ведётся там.
const OBSERVE_LOCATION = 'wasteland';
const OBSERVE_MS = Math.max(8000, Number(process.env.CREATURE_OBSERVE_MS || 26000));
// Атака выбирается по своему cooldownMs (serverCreatureAttackFor): между двумя
// «заимствованными голосами» плакальщицы (4,8 с) проходит три-четыре нырка,
// поэтому вид судится после MIN_STRIKES ударов, а окно при нужде продлевается,
// пока каждый такой вид не покажет обе атаки.
const MIN_STRIKES = 5;
const OBSERVE_EXTRA_MS = 30000;
const BLEED_WAIT_MS = 14000;

const accounts = {};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await h.bootstrapCharacters(accounts);
  const watcher = accounts.target;
  const bleeder = accounts.untargeted;
  const stuck = accounts.persistence;

  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = account => saves.characters[users.users[account.login].id][account.characterId].state;

  // Наблюдатель стоит в пустоши с большим запасом здоровья: он должен пережить
  // окно наблюдения, иначе смерть оборвёт сбор ударов.
  // Здания Кромки закрывают наблюдателя от большей части пустоши, и какой вид
  // первым выйдет на него, решал случай. Две авторские плакальщицы у точки
  // прибытия делают бой с двумя атаками обязательным; штатный респаун остаётся.
  const wasteland = JSON.parse(fs.readFileSync(path.join(root, 'data/locations', `${OBSERVE_LOCATION}.json`), 'utf8'));
  const arrival = wasteland.entryFromWorld || wasteland.spawn;
  const mournerTemplate = JSON.parse(fs.readFileSync(path.join(root, 'data/locations/coreLabCenterResearch.json'), 'utf8'))
    .objects.find(row => row?.entity?.creatureTypeId === 'mourner');
  assert(mournerTemplate, 'в каталоге локаций нет авторской плакальщицы для образца');
  for (const [index, dx] of [[1, -3], [2, 3]]) {
    wasteland.objects.push({
      ...mournerTemplate,
      id: `qa_mourner_${index}`,
      position: { x: Number(arrival.x) + dx, y: 0, z: Number(arrival.z) + 2 }
    });
  }
  fs.mkdirSync(path.join(h.DATA_DIR, 'locations'), { recursive: true });
  fs.writeFileSync(path.join(h.DATA_DIR, 'locations', `${OBSERVE_LOCATION}.json`), JSON.stringify(wasteland));

  const watcherState = stateFor(watcher);
  watcherState.currentLocationId = OBSERVE_LOCATION;
  watcherState.serverLocationContext = { locationId: OBSERVE_LOCATION };
  watcherState.player = {
    ...(watcherState.player || {}),
    x: Number(arrival.x),
    z: Number(arrival.z),
    hp: 900,
    maxHp: 900
  };

  // Кровоточащий получает состояние напрямую: бросок на кровотечение сам по
  // себе проверяется контрактом каталога, а здесь важен сам ход состояния —
  // иначе проверка зависела бы от удачи и мигала бы.
  const bleederState = stateFor(bleeder);
  bleederState.currentLocationId = 'settlement';
  bleederState.serverLocationContext = { locationId: 'settlement' };
  bleederState.player = {
    ...(bleederState.player || {}),
    hp: 120,
    maxHp: 120,
    injuries: { bleeding: true }
  };

  fs.writeFileSync(savesPath, JSON.stringify(saves));
  await h.startServer();

  // --- 1: авторские атаки чередуются -----------------------------------
  const { socket: watcherSocket } = await h.connectAndJoin(watcher);
  const attacksBySpecies = new Map();
  const strikesBySpecies = new Map();
  let meleeEvents = 0;

  watcherSocket.on('enemyMelee', payload => {
    const id = String(payload?.creatureTypeId || '');
    if (!id || !species.has(id)) return;
    meleeEvents += 1;
    if (!attacksBySpecies.has(id)) attacksBySpecies.set(id, new Set());
    if (!payload.attackId) return;
    attacksBySpecies.get(id).add(String(payload.attackId));
    strikesBySpecies.set(id, (strikesBySpecies.get(id) || 0) + 1);
  });

  const judged = () => [...attacksBySpecies.keys()]
    .filter(id => multiAttack.has(id) && strikesBySpecies.get(id) >= MIN_STRIKES);
  await delay(OBSERVE_MS);
  const extendUntil = Date.now() + OBSERVE_EXTRA_MS;
  while ((!judged().length || judged().some(id => attacksBySpecies.get(id).size < 2)) && Date.now() < extendUntil) {
    await delay(500);
  }
  assert(meleeEvents > 0, `за ${OBSERVE_MS} мс в «${OBSERVE_LOCATION}» не случилось ни одного удара твари`);

  const observedMulti = judged();
  assert(observedMulti.length > 0,
    `ни один вид с двумя атаками не ударил ${MIN_STRIKES} раз; наблюдались: ${[...attacksBySpecies.keys()].map(id => `${id}×${strikesBySpecies.get(id) || 0}`).join(', ') || 'никто'}`);

  for (const id of observedMulti) {
    const used = attacksBySpecies.get(id);
    const authored = (species.get(id).attacks || []).map(row => String(row.id));
    assert(used.size > 1,
      `${id}: за ${strikesBySpecies.get(id)} ударов применил только «${[...used].join(', ')}», хотя в каталоге атак ${authored.length} (${authored.join(', ')}) — сервер снова берёт attacks[0]`);
    for (const attackId of used) {
      assert(authored.includes(attackId), `${id}: применил неизвестную каталогу атаку «${attackId}»`);
    }
  }

  h.closeSocket(watcher);

  // --- 2: кровотечение как состояние ------------------------------------------
  const { socket: bleedSocket, join } = await h.connectAndJoin(bleeder);
  assert(join.self?.injuries?.bleeding === true, 'кровотечение не доехало до клиента в состоянии персонажа');

  const ticks = [];
  bleedSocket.on('playerStatusEffect', payload => {
    if (String(payload?.effect || '') === 'bleeding') ticks.push(payload);
  });
  await delay(BLEED_WAIT_MS);

  assert(ticks.length >= 2, `кровотечение не тикает: получено событий ${ticks.length} за ${BLEED_WAIT_MS} мс`);
  assert(ticks.every(row => Number(row.damage) > 0), 'тик кровотечения пришёл без урона');
  const hpSeries = ticks.map(row => Number(row.hp));
  assert(hpSeries[hpSeries.length - 1] < hpSeries[0], 'здоровье не убывает от кровотечения');

  h.closeSocket(bleeder);

  // --- 3: ремонт невозможного состояния ----------------------------------------
  // Ветка гибели висит на `hp <= 0`. При нечисловом hp она молча не срабатывает
  // (NaN <= 0 — ложь), и игрок застревает: ходить может (движение смотрит на
  // dead/downed), а всё остальное отвечает «Игрок недоступен.». Сажаем ровно в
  // это состояние и проверяем, что сервер вытаскивает сам.
  const stuckSaves = JSON.parse(fs.readFileSync(savesPath, 'utf8'));
  const stuckState = stuckSaves.characters[users.users[stuck.login].id][stuck.characterId].state;
  stuckState.currentLocationId = 'settlement';
  stuckState.serverLocationContext = { locationId: 'settlement' };
  stuckState.player = { ...(stuckState.player || {}), hp: 0, dead: false, downed: false };
  fs.writeFileSync(savesPath, JSON.stringify(stuckSaves));

  const { socket: stuckSocket } = await h.connectAndJoin(stuck);
  await delay(3000);
  const probe = await h.socketAck(stuckSocket, 'socialAction', { action: 'trade', targetId: 'nobody' });
  assert.notEqual(probe.error, 'Игрок недоступен.',
    'игрок с нулевым здоровьем и без смерти остался в непроходимом состоянии — тик его не вытащил');
  const repairedHp = Number(probe.self?.hp || 0);
  assert(repairedHp > 0, `здоровье не восстановлено: hp=${repairedHp}`);
  assert.equal(probe.self?.dead, false, 'починка не должна помечать игрока мёртвым');
  h.closeSocket(stuck);

  await h.stopServer();
  h.cleanupSync();

  const rotated = observedMulti.map(id => `${id}: ${[...attacksBySpecies.get(id)].join(' + ')}`).join('; ');
  console.log(`Creature combat OK: ${meleeEvents} ударов в «${OBSERVE_LOCATION}», `
    + `авторские атаки чередуются (${rotated}), кровотечение тикает уроном ${ticks.length} раз и снижает здоровье, `
    + `а застрявший на нуле игрок восстановлен до ${repairedHp} HP вместо «Игрок недоступен.».`);
})().catch(error => {
  console.error(`Creature combat check failed: ${error?.message || String(error)}`);
  const logs = h.serverLogs().trim();
  if (logs) console.error(logs.slice(-3000));
  h.cleanupSync();
  process.exitCode = 1;
});
