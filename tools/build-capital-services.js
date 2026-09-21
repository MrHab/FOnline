#!/usr/bin/env node
'use strict';

// Сервисы столиц: аукционер, медик и ремонтник стоят в каждой столице фракции —
// и в поселениях пустоши, и на базах Сердцевины. Книга ордеров одна на всех
// аукционеров, поэтому торговать можно там, где застал вечер.
//
// Инструмент идемпотентен: существующий NPC сервиса не трогает, недостающего
// ставит на свободное место рядом с точкой прибытия. Позиции детерминированы —
// перезапуск не двигает уже поставленных.

const fs = require('node:fs');
const path = require('node:path');
const { circleBlockerPenalty, createLocationCollision } = require('../src/server/location-collision');

const root = path.resolve(__dirname, '..');
const locationsDir = path.join(root, 'data/locations');
const { locationObjectBlockers } = createLocationCollision({ tile: 2 });

// Столицы и их фракции — тот же список, что у сервера (SERVER_FACTION_CAPITAL_LOCATIONS).
const CAPITALS = {
  sluiceCity: 'uprava',
  scrapTown: 'free_artels',
  relayStation: 'contour',
  caravanCamp: 'tract_league',
  secondHaven: 'seconds',
  balanceBunker: 'continuity',
  coreBaseUprava: 'uprava',
  coreBaseArtels: 'free_artels',
  coreBaseContour: 'contour',
  coreBaseLeague: 'tract_league'
};

const SERVICES = [
  { service: 'auction', id: 'auctioneer', name: 'Аукционер', model: 'wastelandSettler' },
  { service: 'medic', id: 'medic', name: 'Медик поселения', model: 'wastelandSettler' },
  { service: 'repair', id: 'repairman', name: 'Ремонтник', model: 'wastelandSettler' }
];

// Места ищутся по дуге перед точкой прибытия: игрок выходит и сразу видит ряд.
const OFFSETS = [
  [-6, 6], [0, 7], [6, 6], [-9, 2], [9, 2], [-6, 10], [6, 10], [0, 12],
  [-12, 6], [12, 6], [-3, 4], [3, 4]
];
const CLEARANCE = 2.6;

function occupied(objects, x, z) {
  for (const row of objects) {
    const position = row?.position || {};
    const scale = Math.max(0.5, Number(row?.scale?.x || 1));
    const distance = Math.hypot(Number(position.x || 0) - x, Number(position.z || 0) - z);
    if (distance < CLEARANCE + scale * 0.5) return true;
    // Стены зданий сцены (collisionParts): NPC внутри корпуса сервер поставил бы
    // не на это место, а игрок до него не дошёл бы.
    if (locationObjectBlockers(row).some(blocker => circleBlockerPenalty(x, z, 0.8, blocker) > 0.001)) return true;
  }
  return false;
}

function serviceNpc(spec, faction, x, z) {
  return {
    id: spec.id,
    model: spec.model,
    name: spec.name,
    position: { x: Number(x.toFixed(1)), y: 0.0, z: Number(z.toFixed(1)) },
    rotation: { x: 0.0, y: 180.0, z: 0.0 },
    scale: { x: 1, y: 1, z: 1 },
    collision: 'solid',
    tags: ['npc', 'friendly', 'service', `service-${spec.service}`, spec.service],
    entity: {
      kind: 'npc',
      role: 'npc',
      faction,
      hostileToPlayer: false,
      stationary: true,
      service: spec.service,
      territoryFactionId: faction
    },
    unityAuthored: true,
    worldRevision: 'kromka-1'
  };
}

let added = 0;
let kept = 0;
for (const [locationId, faction] of Object.entries(CAPITALS)) {
  const file = path.join(locationsDir, `${locationId}.json`);
  if (!fs.existsSync(file)) { console.warn(`нет файла локации: ${locationId}`); continue; }
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Сервер пускает к медику, ремонтнику и аукционеру только в защищённом
  // поселении. «Равновесный бункер» — сюжетный комплекс с PvP, и NPC там были
  // бы декорацией, которая всегда отвечает отказом.
  if (location.safe !== true) {
    const before = (location.objects || []).length;
    location.objects = (location.objects || []).filter(row => !SERVICES.some(spec => (row?.entity || {}).service === spec.service));
    if (location.objects.length !== before) {
      fs.writeFileSync(file, `${JSON.stringify(location, null, 2)}\n`);
      console.warn(`${locationId}: локация не защищена — сервисы убраны (${before - location.objects.length})`);
    } else {
      console.warn(`${locationId}: локация не защищена — сервисы не ставятся`);
    }
    continue;
  }
  const objects = Array.isArray(location.objects) ? location.objects : (location.objects = []);
  const spawn = location.spawn || location.entry || { x: 0, z: 0 };
  const baseX = Number(spawn.x || 0);
  const baseZ = Number(spawn.z || 0);
  let changed = false;

  for (const spec of SERVICES) {
    const existing = objects.find(row => (row?.entity || {}).service === spec.service);
    if (existing) { kept += 1; continue; }
    const spot = OFFSETS.map(([dx, dz]) => [baseX + dx, baseZ + dz])
      .find(([x, z]) => !occupied(objects, x, z));
    if (!spot) { console.warn(`${locationId}: не нашлось места для ${spec.service}`); continue; }
    objects.push(serviceNpc(spec, faction, spot[0], spot[1]));
    added += 1;
    changed = true;
  }

  if (changed) fs.writeFileSync(file, `${JSON.stringify(location, null, 2)}\n`);
}

console.log(`Сервисы столиц: добавлено ${added}, уже стояло ${kept} (${Object.keys(CAPITALS).length} столиц × ${SERVICES.length} сервиса).`);
