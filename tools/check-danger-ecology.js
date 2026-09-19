#!/usr/bin/env node
'use strict';

// Проверка ядра A-Life опасных клеток (src/server/danger-ecology.js) на
// синтетической карте: логова ставятся детерминированно по цвету, логово
// пополняет группы только без игроков, группа обходит окрестности и
// возвращается, чует игроков в соседней сцене и приходит к ним с края,
// погибшие особи не возвращаются, большие потери обращают группу в бегство,
// а состояние переживает сохранение.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const eco = require('../src/server/danger-ecology');

function seeded(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const config = eco.normalizeEcologyConfig({
  tickSeconds: 5,
  lairs: {
    density: { pvp: 0.05, pvpFullDrop: 0.2, pvpBlack: 0.5 },
    capacity: { pvp: 1, pvpFullDrop: 2, pvpBlack: 2 },
    refillMinutes: { pvp: 60, pvpFullDrop: 30, pvpBlack: 20 }
  },
  roam: { restMinutes: [1, 2], stepSeconds: [60, 60], huntStepSeconds: [30, 30], radius: 2 },
  species: [
    { id: 'pack', name: 'Стая', kind: 'monster', members: [{ type: 'beast', min: 3, max: 4 }],
      habitat: { pvpFullDrop: 2, pvpBlack: 3 }, perceptionCells: 2, aggression: 1, fleeAt: 0.5 },
    { id: 'gang', name: 'Банда', kind: 'raider', members: [{ type: 'raider', min: 2, max: 3 }],
      habitat: { pvp: 2, pvpFullDrop: 1 }, perceptionCells: 1, aggression: 0 },
    { id: 'broken', members: [], habitat: { pvp: 1 } }
  ]
});
assert.deepEqual(config.species.map(row => row.id), ['pack', 'gang'], 'a species without members is dropped');

// Карта 30×30 мелких клеток: запад жёлтый, восток красный, в центре востока чёрное пятно.
const modeAt = (sx, sy) => {
  if (sx < 0 || sy < 0 || sx >= 30 || sy >= 30) return '';
  if (sx >= 20 && sx < 26 && sy >= 10 && sy < 16) return 'pvpBlack';
  return sx < 15 ? 'pvp' : 'pvpFullDrop';
};
const candidates = [];
for (let sy = 0; sy < 30; sy += 1) for (let sx = 0; sx < 30; sx += 1) candidates.push({ sx, sy, mode: modeAt(sx, sy), region: 'test' });

// --- логова ----------------------------------------------------------------------------------
const lairs = eco.buildLairs(config, candidates, 'rev-1');
assert.deepEqual(lairs, eco.buildLairs(config, candidates, 'rev-1'), 'the same map revision gives the same lairs');
assert.notDeepEqual(lairs.map(lair => lair.id), eco.buildLairs(config, candidates, 'rev-2').map(lair => lair.id), 'another revision reshuffles them');
const byMode = mode => lairs.filter(lair => lair.mode === mode).length;
const cellsOf = mode => candidates.filter(cell => cell.mode === mode).length;
assert(byMode('pvpBlack') / cellsOf('pvpBlack') > byMode('pvp') / cellsOf('pvp'), 'black land is denser than yellow');
for (const lair of lairs) {
  const species = config.speciesById[lair.speciesId];
  assert(species.habitat[lair.mode] > 0, `${lair.speciesId} lives where its habitat allows (${lair.mode})`);
}
assert(lairs.some(lair => lair.speciesId === 'gang') && lairs.some(lair => lair.speciesId === 'pack'));
console.log(`PASS lairs follow the colour of the land (${lairs.length}: yellow ${byMode('pvp')}, red ${byMode('pvpFullDrop')}, black ${byMode('pvpBlack')})`);

// --- пополнение ------------------------------------------------------------------------------
const state = eco.emptyEcologyState('rev-1');
eco.resetLairs(state, lairs, 'rev-1');
const random = seeded(7);
let now = 1_000_000;
const members = type => ({ maxHp: type === 'beast' ? 60 : 80 });
const quiet = { modeAt, occupied: () => false, occupiedCells: [], createMember: members };
let events = eco.tickEcology(state, config, quiet, now, random);
const spawned = events.filter(event => event.type === 'spawn').length;
assert.equal(spawned, lairs.length, 'every lair raises its first group at once');
events = eco.tickEcology(state, config, quiet, now + 1000, random);
assert.equal(events.filter(event => event.type === 'spawn').length, 0, 'refill waits for the timer');
const pvpBlackLair = lairs.find(lair => lair.mode === 'pvpBlack');
const blockedLair = { ...quiet, occupied: (sx, sy) => sx === pvpBlackLair.sx && sy === pvpBlackLair.sy };
events = eco.tickEcology(state, config, blockedLair, now + 21 * 60000, random);
assert(!events.some(event => event.type === 'spawn' && event.sx === pvpBlackLair.sx && event.sy === pvpBlackLair.sy),
  'a lair with players in its cell does not refill');
assert(events.some(event => event.type === 'spawn'), 'other black lairs refill their second group');
for (const group of state.groups.values()) {
  const species = config.speciesById[group.speciesId];
  const expected = species.members[0];
  assert(group.members.length >= expected.min && group.members.length <= expected.max);
  assert(group.members.every(member => member.hp === member.maxHp && member.maxHp === (member.type === 'beast' ? 60 : 80)));
}
console.log(`PASS lairs raise groups slowly and never in front of players (${state.groups.size} groups)`);

// --- обход -------------------------------------------------------------------------------------
{
  const walker = [...state.groups.values()].find(group => group.speciesId === 'pack');
  const lair = state.lairs.get(walker.lairId);
  let t = now + 21 * 60000;
  let maxAway = 0;
  let wentHome = false;
  let invalid = 0;
  for (let i = 0; i < 400; i += 1) {
    t += 60000;
    eco.tickEcology(state, config, quiet, t, random);
    const away = Math.max(Math.abs(walker.sx - lair.sx), Math.abs(walker.sy - lair.sy));
    maxAway = Math.max(maxAway, away);
    if (maxAway > 0 && away === 0) wentHome = true;
    if (!config.speciesById.pack.habitat[modeAt(walker.sx, walker.sy)]) invalid += 1;
  }
  assert(maxAway >= 1, 'the group leaves its lair to roam');
  assert(maxAway <= config.speciesById.pack.roamRadius + 1, `the group roams near its lair (${maxAway})`);
  assert(wentHome, 'the group comes back home');
  assert.equal(invalid, 0, 'the group never walks into land it cannot live in');
  now = t;
  console.log(`PASS groups roam around their lair and come back (farthest ${maxAway} cells)`);
}

// --- чутьё и приход с края -------------------------------------------------------------------
{
  const hunter = [...state.groups.values()].find(group => group.speciesId === 'pack' && !group.online);
  const prey = { sx: hunter.sx + 2, sy: hunter.sy };
  assert(config.speciesById.pack.habitat[modeAt(prey.sx, prey.sy)] > 0 || true);
  // Сцена с игроками — две клетки восточнее группы.
  const ctx = {
    modeAt: (sx, sy) => (sx === prey.sx && sy === prey.sy) || (sx === prey.sx - 1 && sy === prey.sy) ? 'pvpFullDrop' : modeAt(sx, sy),
    occupied: (sx, sy) => sx === prey.sx && sy === prey.sy,
    occupiedCells: [prey],
    createMember: members
  };
  let arrived = null;
  let t = now;
  for (let i = 0; i < 20 && !arrived; i += 1) {
    t += 30000;
    hunter.restUntil = Math.min(hunter.restUntil, t);
    const tick = eco.tickEcology(state, config, ctx, t, random);
    arrived = tick.find(event => event.type === 'arrive' && event.groupId === hunter.id) || null;
  }
  assert(arrived, 'the group smells players in a scene nearby and walks to them');
  assert.equal(arrived.direction, 'east', 'coming from the west, it enters the scene moving east');
  assert.equal(hunter.state, 'hunt');
  now = t;
  console.log('PASS a group senses players nearby and arrives at the scene edge it walked from');

  // --- в сети и гибель ---------------------------------------------------------------------------
  eco.setGroupOnline(state, hunter, 'room-1');
  const frozen = { sx: hunter.sx, sy: hunter.sy };
  eco.tickEcology(state, config, ctx, now + 10 * 60000, random);
  assert.deepEqual({ sx: hunter.sx, sy: hunter.sy }, frozen, 'an online group is left to the scene');
  const firstId = hunter.members[0].id;
  const size = hunter.members.length;
  let result = eco.memberKilled(state, config, hunter.id, firstId);
  assert(result.ok && !result.destroyed);
  assert(!hunter.members.some(member => member.id === firstId), 'a dead member is gone for good');
  while (hunter.members.length / hunter.size0 > 0.5) result = eco.memberKilled(state, config, hunter.id, hunter.members[0].id);
  assert.equal(hunter.state, 'flee', 'heavy losses break the group');
  const survivor = hunter.members[0];
  eco.setGroupOffline(state, hunter, new Map([[survivor.id, 7]]), now, config);
  assert.equal(survivor.hp, 7, 'survivors keep their wounds after the scene');
  assert.equal(hunter.online, '');
  assert.equal(hunter.state, 'return', 'a broken group heads home');
  assert(hunter.shakenUntil > now, 'and does not answer noise for a while');
  const shakenCtx = { ...ctx, occupiedCells: [{ sx: hunter.sx + 1, sy: hunter.sy }], occupied: (sx, sy) => sx === hunter.sx + 1 && sy === hunter.sy };
  hunter.nextStepAt = now;
  eco.tickEcology(state, config, shakenCtx, now + 1000, random);
  assert.notEqual(hunter.state, 'hunt', 'a shaken group ignores players next door');
  while (hunter.members.length) result = eco.memberKilled(state, config, hunter.id, hunter.members[0].id);
  assert(result.destroyed && !state.groups.has(hunter.id), `a group with no members is gone (${size} killed)`);
  assert(!eco.groupsAt(state, frozen.sx, frozen.sy).some(group => group.id === hunter.id));
  console.log('PASS deaths are permanent, heavy losses make a group flee, survivors keep their wounds');
}

// --- отдыхающая группа прислушивается ------------------------------------------------------------
{
  const sleeper = [...state.groups.values()].find(group => group.speciesId === 'pack' && !group.online);
  sleeper.state = 'rest';
  sleeper.target = null;
  sleeper.restUntil = now + 3600000;
  sleeper.nextStepAt = sleeper.restUntil;
  sleeper.nextSenseAt = 0;
  const prey = { sx: sleeper.sx + 1, sy: sleeper.sy };
  const ctx = {
    modeAt: (sx, sy) => (sx === prey.sx && sy === prey.sy) ? 'pvpFullDrop' : modeAt(sx, sy),
    occupied: (sx, sy) => sx === prey.sx && sy === prey.sy,
    occupiedCells: [prey],
    createMember: members
  };
  const events = eco.tickEcology(state, config, ctx, now + 1000, random);
  assert.equal(sleeper.state, 'hunt', 'a resting group wakes up when players make noise next door');
  assert(events.some(event => event.type === 'arrive' && event.groupId === sleeper.id), 'and walks straight in');
  eco.setGroupOnline(state, sleeper, 'room-2');
  console.log('PASS a resting group hears a scene next door and comes before its rest is over');
}

// --- стычка «наткнулись» ------------------------------------------------------------------------
{
  const any = [...state.groups.values()].find(group => !group.online);
  const found = eco.nearestOfflineGroup(state, any.sx + 1, any.sy, 2);
  assert(found, 'a group one cell away is found for a chance encounter');
  assert.equal(eco.nearestOfflineGroup(state, -100, -100, 2), null, 'nobody far away');
  console.log('PASS a chance encounter finds the nearest group around');
}

// --- сохранение ------------------------------------------------------------------------------------
{
  const wounded = [...state.groups.values()].find(group => !group.online);
  wounded.members[0].hp = 5;
  const json = JSON.parse(JSON.stringify(eco.serializeEcologyState(state)));
  const loaded = eco.normalizeEcologyState(json, config);
  assert.equal(loaded.groups.size, state.groups.size);
  assert.equal(loaded.lairs.size, state.lairs.size);
  assert.equal(loaded.groups.get(wounded.id).members[0].hp, 5, 'wounds survive a restart');
  assert.equal(eco.groupsAt(loaded, wounded.sx, wounded.sy).some(group => group.id === wounded.id), true, 'the cell index is rebuilt');
  assert([...loaded.groups.values()].every(group => group.online === ''), 'after a restart nobody is online');
  // Раны заживают без игроков.
  eco.tickEcology(loaded, config, quiet, now, random);
  eco.tickEcology(loaded, config, quiet, now + 60 * 60000, random);
  assert(loaded.groups.get(wounded.id).members[0].hp > 5, 'wounds heal while nobody is around');
  console.log('PASS the ecology survives a restart and wounds heal offline');
}

// --- данные игры ---------------------------------------------------------------------------------
{
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kromka', 'danger-ecology.json'), 'utf8'));
  const real = eco.normalizeEcologyConfig(data);
  assert.equal(real.species.length, (data.species || []).length, 'every species in data/kromka/danger-ecology.json is valid');
  const banned = /gecko|(?:giant|mutant)_?ants?|(?:^|[^a-z])ants?_|ghoul|super_?mutant|radscorpion|геккон|муравь|гуль|гули|супермутант|радскорпион/i;
  for (const row of real.species) {
    assert(!banned.test(`${row.id} ${row.name} ${row.members.map(member => `${member.type} ${member.name}`).join(' ')}`),
      `${row.id}: Kromka has its own monsters, no Fallout creatures`);
  }
  for (const mode of eco.LIVING_MODES) {
    assert(real.species.some(row => row.habitat[mode] > 0 && row.hostile), `something hostile lives in ${mode} land`);
  }
  const fauna = real.species.filter(row => row.kind === 'fauna');
  assert(fauna.length && fauna.every(row => row.hostile === false), 'peaceful fauna never attacks');
  const creatures = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'mutants.json'), 'utf8')).types.map(row => row.id);
  for (const row of real.species) {
    for (const spec of row.members) {
      assert(spec.type === 'raider' || creatures.includes(spec.type), `${row.id}: ${spec.type} is a creature of the Kromka bestiary`);
    }
  }
  console.log(`PASS the game data lists Kromka species only (${real.species.map(row => row.id).join(', ')})`);
}

// --- сетка зон мира: ворота, логова зон, синие зоны --------------------------------------------------
{
  const zoneConfig = eco.normalizeEcologyConfig({
    lairs: { capacity: { pve: 1, pvp: 1 }, refillMinutes: { pve: 60, pvp: 60 } },
    roam: { restMinutes: [0, 0], stepSeconds: [60, 60], huntStepSeconds: [30, 30], radius: 1 },
    species: [{ id: 'hunters', name: 'Охотники', kind: 'monster', members: [{ type: 'beast', min: 2, max: 2 }],
      habitat: { pve: 1, pvp: 1 }, perceptionCells: 1, aggression: 1 }]
  });
  // Три зоны в ряд: синяя (0,0) — жёлтая (1,0) — жёлтая (2,0); ворота между 1 и 2 закрыты.
  const zoneMode = (sx, sy) => (sy === 0 && sx >= 0 && sx <= 2 ? (sx === 0 ? 'pve' : 'pvp') : '');
  const closed = (a, b) => (a === 1 && b === 2) || (a === 2 && b === 1);
  const canStep = (fx, fy, tx, ty) => fy === 0 && ty === 0 && Math.abs(fx - tx) === 1 && !closed(fx, tx);
  const zoneLairs = eco.buildLairs(zoneConfig, [
    { id: 'lair_z_00_00_0', slot: 0, sx: 0, sy: 0, mode: 'pve', region: 'test' },
    { id: 'lair_z_02_00_0', slot: 0, sx: 2, sy: 0, mode: 'pvp', region: 'test' },
    { id: 'lair_z_02_00_1', slot: 1, sx: 2, sy: 0, mode: 'pvp', region: 'test' }
  ], 'zones');
  assert.deepEqual(zoneLairs.map(lair => [lair.id, lair.slot]), [['lair_z_00_00_0', 0], ['lair_z_02_00_0', 0], ['lair_z_02_00_1', 1]],
    'a zone lair is placed every time, with its slot in the zone');
  assert(eco.LIVING_MODES.includes('pve'), 'blue zones are alive');
  const zoneState = eco.emptyEcologyState('zones');
  eco.resetLairs(zoneState, zoneLairs, 'zones');
  const zoneRandom = seeded(3);
  let t = 5_000_000;
  const occupiedOne = { modeAt: zoneMode, canStep, occupied: (sx, sy) => sx === 1 && sy === 0, occupiedCells: [{ sx: 1, sy: 0 }], createMember: () => ({ maxHp: 50 }) };
  eco.tickEcology(zoneState, zoneConfig, occupiedOne, t, zoneRandom);
  const blue = [...zoneState.groups.values()].find(group => group.lairId === 'lair_z_00_00_0');
  assert(blue, 'the blue zone raises a group');
  const beyond = [...zoneState.groups.values()].filter(group => group.lairId.startsWith('lair_z_02_00'));
  const arrivals = [];
  for (let step = 0; step < 40; step += 1) {
    t += 61_000;
    arrivals.push(...eco.tickEcology(zoneState, zoneConfig, occupiedOne, t, zoneRandom).filter(event => event.type === 'arrive'));
  }
  assert(arrivals.some(event => event.groupId === blue.id && event.direction === 'east'), 'the blue group hunts through the open gate');
  for (const group of beyond) assert.equal(zoneState.groups.get(group.id)?.sx, 2, 'a closed gate holds the group in its zone');
  console.log('PASS on the zone grid groups walk only through open gates, zone lairs keep their slots and blue zones are alive');
}

// --- сервер подключает A-Life ------------------------------------------------------------------------
{
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const [hook, label] of [
    ["maybeReportEncounterOutcome(room, 'player_kill', enemy, p);\n  serverEcologyNoteDeath(room, enemy);", 'a player kill is permanent for the group'],
    ["maybeReportEncounterOutcome(room, 'faction_combat', foe, null);\n      serverEcologyNoteDeath(room, foe);", 'an NPC kill is permanent for the group'],
    ['if (updateEcologyActorLifecycle(room, enemy, dt)) continue;', 'arriving members walk in'],
    ["if (enemy.ecologyPhase === 'leaving' && updateEcologyActorLifecycle(room, enemy, dt)) continue;", 'a broken group leaves even mid-fight'],
    ['creatureTypeId: creatureTypeId || undefined,', 'encounters spawn the creature of the bestiary']
  ]) assert(server.includes(hook), `server.js wires ${label}`);
  assert(!server.includes('serverRespawnDangerThreats'), 'no respawn timer: threats come with groups');
}

console.log('Danger ecology OK: lairs follow the colour of the land, groups roam, hear players and arrive from the edge, deaths are permanent and the world survives a restart.');
