#!/usr/bin/env node
'use strict';

// Сервисы столиц. В каждой столице фракции — и в поселении пустоши, и на базе
// Сердцевины — должны стоять аукционер, медик и ремонтник: рынок один на всех,
// поэтому торговать и чиниться можно там, где застал вечер.
//
// Проверяется состав данных, отсутствие NPC внутри чужой геометрии и серверный
// договор: сервис узнаётся по entity.service, а рынок больше не спрашивает
// членство во фракции.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const server = read('server.js');

// Список столиц берётся из самого сервера, чтобы проверка не разошлась с ним.
const capitalBlock = server.slice(server.indexOf('const SERVER_FACTION_CAPITAL_LOCATIONS = {'));
const capitals = [...capitalBlock.slice(0, capitalBlock.indexOf('};')).matchAll(/^\s{2}(\w+):\s*'([\w_]+)'/gm)]
  .map(row => ({ locationId: row[1], faction: row[2] }));
assert(capitals.length >= 10, `столиц должно быть не меньше десяти, найдено ${capitals.length}`);

const REQUIRED = ['auction', 'medic', 'repair'];
const CLEARANCE = 1.2;

let served = 0;
for (const { locationId, faction } of capitals) {
  const file = path.join(root, 'data/locations', `${locationId}.json`);
  assert(fs.existsSync(file), `нет файла столицы ${locationId}`);
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  const objects = Array.isArray(location.objects) ? location.objects : [];

  // Сервер пускает к сервисам только в защищённом поселении. Незащищённая
  // столица (сюжетный комплекс с PvP) обязана остаться без них: NPC там
  // отвечал бы отказом на каждое обращение.
  if (location.safe !== true) {
    for (const service of REQUIRED) {
      assert(!objects.some(row => (row.entity || {}).service === service),
        `${locationId}: локация не защищена, сервис ${service} там работать не будет`);
    }
    continue;
  }
  served += 1;

  for (const service of REQUIRED) {
    const rows = objects.filter(row => (row.entity || {}).service === service);
    assert.equal(rows.length, 1, `${locationId}: сервис ${service} должен быть ровно один, найдено ${rows.length}`);
    const npc = rows[0];
    assert.equal((npc.entity || {}).kind, 'npc', `${locationId}/${service}: сервис обязан быть NPC`);
    assert.equal((npc.entity || {}).hostileToPlayer, false, `${locationId}/${service}: сервисный NPC не враждебен`);
    assert.equal((npc.entity || {}).stationary, true, `${locationId}/${service}: сервисный NPC стоит на месте`);
    assert(Array.isArray(npc.tags) && npc.tags.includes(service),
      `${locationId}/${service}: у NPC нет тега сервиса`);
    assert(npc.name && npc.name.trim().length > 0, `${locationId}/${service}: у NPC нет имени`);

    const x = Number(npc.position?.x);
    const z = Number(npc.position?.z);
    assert(Number.isFinite(x) && Number.isFinite(z), `${locationId}/${service}: нет позиции`);
    const half = Math.max(20, Number(location.map?.width || 72) / 2);
    assert(Math.abs(x) <= half && Math.abs(z) <= half, `${locationId}/${service}: NPC вне карты (${x}, ${z})`);

    // NPC не должен стоять внутри чужого объекта: иначе к нему не подойти.
    for (const other of objects) {
      if (other === npc) continue;
      const ox = Number(other.position?.x);
      const oz = Number(other.position?.z);
      if (!Number.isFinite(ox) || !Number.isFinite(oz)) continue;
      const distance = Math.hypot(ox - x, oz - z);
      assert(distance >= CLEARANCE,
        `${locationId}/${service}: NPC стоит вплотную к «${other.id}» (${distance.toFixed(1)} м)`);
    }
  }

  const auction = objects.find(row => (row.entity || {}).service === 'auction');
  assert.equal((auction.entity || {}).faction, faction,
    `${locationId}: аукционер должен принадлежать фракции столицы`);
}

// --- серверный договор -----------------------------------------------------------------
for (const needle of [
  "if (service !== 'medic' && service !== 'repair') return fail('Неизвестный сервис поселения.');",
  "if (!serverNearbyServiceActor(p, service)) {",
  'function serverRepairmanTargets(p = {})',
  'function serverRepairmanRepair(p = {}, data = {})',
  'function serverRepairmanPrice(itemId = \'\', condition = 100)',
  "['service', 'action', 'itemId', 'itemRuntimeId']"
]) assert(server.includes(needle), `server.js не держит договор сервисов: ${needle}`);
assert(!server.includes("Аукцион доступен только членам фракции Сердцевины"),
  'рынок один на всех: членство во фракции его больше не закрывает');

// --- клиент ----------------------------------------------------------------------------
const net = read('unity-client/Assets/Scripts/Game/RoaTerritoryNet.cs');
for (const token of ['RequestRepairState', 'UseRepairman', '"repair"', '"repairAll"']) {
  assert(net.includes(token), `RoaTerritoryNet не умеет в ремонтника: ${token}`);
}
const dialogue = read('unity-client/Assets/Scripts/Game/RoaDialogueCanvas.cs');
for (const token of ['case "repair": AddRepairmanOptions(); break;', 'РЕМОНТНИК',
  'RoaTerritoryNet.UseRepairman', 'RoaTerritoryNet.RequestRepairState']) {
  assert(dialogue.includes(token), `диалог не показывает ремонтника: ${token}`);
}

console.log(`Capital services OK: ${served} защищённых столиц из ${capitals.length}, в каждой аукционер, медик и ремонтник; NPC стоят на свободных местах, рынок открыт без фракции, ремонтник есть на сервере и в диалоге.`);
