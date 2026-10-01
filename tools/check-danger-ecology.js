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
  roam: { restMinutes: [1, 2], stepSeconds: [60, 60], huntStepSeconds: [30, 30], radius: 2, migrateRadius: 4 },
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
  assert(maxAway <= config.roam.migrateRadius + 1, `the group roams near its lair, at most a far walk away (${maxAway})`);
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
      assert(eco.HUMAN_TYPES.includes(spec.type) || creatures.includes(spec.type), `${row.id}: ${spec.type} is a person or a creature of the Kromka bestiary`);
      if (row.kind === 'traveller') assert(eco.HUMAN_TYPES.includes(spec.type), `${row.id}: travellers are people`);
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

// --- дальние обходы --------------------------------------------------------------------------
{
  // Группы не сидят у логова: обход продолжается дальше, иногда — на несколько
  // зон, но за пределы дальнего обхода никто не уходит и все возвращаются.
  const far = eco.normalizeEcologyConfig({
    lairs: { capacity: { pvpFullDrop: 1 }, refillMinutes: { pvpFullDrop: 60 } },
    roam: { restMinutes: [1, 2], stepSeconds: [60, 60], radius: 1, migrateRadius: 4 },
    species: [{ id: 'roamer', members: [{ type: 'beast', min: 2, max: 2 }], habitat: { pvpFullDrop: 1 }, aggression: 0, migrateChance: 0.5, wander: 0.5 }]
  });
  const world = eco.emptyEcologyState('far');
  const homes = [];
  for (let i = 0; i < 12; i += 1) {
    homes.push({ id: `lair_far_${i}`, speciesId: 'roamer', sx: 10 + (i % 4) * 5, sy: 10 + Math.floor(i / 4) * 5, mode: 'pvpFullDrop', region: '', slot: 0, refillAt: 0 });
  }
  eco.resetLairs(world, homes, 'far');
  const ctx = {
    modeAt: (sx, sy) => (sx >= 0 && sx < 40 && sy >= 0 && sy < 40 ? 'pvpFullDrop' : ''),
    occupied: () => false,
    occupiedCells: [],
    createMember: members
  };
  const rnd = seeded(11);
  let t = 9_000_000;
  eco.tickEcology(world, far, ctx, t, rnd);
  let farthest = 0;
  const walked = new Map();
  const cameBack = new Set();
  for (let i = 0; i < 1500; i += 1) {
    t += 60000;
    eco.tickEcology(world, far, ctx, t, rnd);
    for (const group of world.groups.values()) {
      const lair = world.lairs.get(group.lairId);
      const away = Math.max(Math.abs(group.sx - lair.sx), Math.abs(group.sy - lair.sy));
      farthest = Math.max(farthest, away);
      if (away === 0 && (walked.get(group.id) || 0) > far.roam.radius) cameBack.add(group.id);
      walked.set(group.id, Math.max(walked.get(group.id) || 0, away));
    }
  }
  assert(farthest > far.roam.radius, `groups walk beyond their near round: ${farthest}`);
  assert(farthest <= far.roam.migrateRadius + 1, `but not beyond a far walk: ${farthest}`);
  assert(cameBack.size > 0, 'a group comes back from a far walk');
  console.log(`PASS groups wander on and sometimes walk far, up to ${farthest} zones from the lair, and come back`);
}

// --- стычки без игроков ------------------------------------------------------------------------
{
  const fight = eco.normalizeEcologyConfig({
    roam: { restMinutes: [240, 240], stepSeconds: [600, 600], radius: 1, clashPerMinute: 0.5, clashCooldownMinutes: 10 },
    species: [
      { id: 'raiders', kind: 'raider', faction: 'raiders', members: [{ type: 'raider', min: 4, max: 4 }], habitat: { pvp: 1 }, aggression: 0.7, fleeAt: 0.5 },
      { id: 'beasts', kind: 'monster', faction: 'gari', members: [{ type: 'beast', min: 3, max: 3 }], habitat: { pvp: 1 }, aggression: 0.8, fleeAt: 0.6 },
      { id: 'lanterns', kind: 'fauna', faction: 'fonari', members: [{ type: 'deer', min: 3, max: 3 }], habitat: { pvp: 1 }, aggression: 0 }
    ]
  });
  const stats = type => ({ maxHp: type === 'raider' ? 55 : 39 });
  const world = eco.emptyEcologyState('fight');
  eco.resetLairs(world, ['raiders', 'beasts', 'lanterns']
    .map((speciesId, i) => ({ id: `lair_f_${i}`, speciesId, sx: 3, sy: 3, mode: 'pvp', region: '', slot: i, refillAt: 0 })), 'fight');
  const quietFight = { modeAt: () => 'pvp', occupied: () => false, occupiedCells: [], createMember: stats };
  const busy = { ...quietFight, occupied: (sx, sy) => sx === 3 && sy === 3, occupiedCells: [{ sx: 3, sy: 3 }] };
  let t = 20_000_000;
  eco.tickEcology(world, fight, quietFight, t, seeded(21));
  assert.equal(world.groups.size, 3, 'three groups in one zone');
  // С игроками в зоне дерутся сами NPC в сцене — стычки вне сцены нет.
  t += 30 * 60000;
  let clashes = eco.tickEcology(world, fight, busy, t, seeded(22)).filter(event => event.type === 'clash');
  assert.equal(clashes.length, 0, 'no offline clash in a zone with players');
  t += 30 * 60000;
  clashes = eco.tickEcology(world, fight, quietFight, t, seeded(23)).filter(event => event.type === 'clash');
  assert.equal(clashes.length, 1, 'raiders and beasts fight; lanterns stay out of it');
  const clash = clashes[0];
  assert(!clash.species.includes('lanterns'), 'the peaceful fauna is not dragged into a clash');
  assert(clash.casualties.length > 0, 'a clash kills');
  const raiders = [...world.groups.values()].find(group => group.speciesId === 'raiders');
  assert.equal(clash.winner, raiders.id, 'the stronger band wins');
  const beasts = [...world.groups.values()].find(group => group.speciesId === 'beasts');
  if (beasts) {
    assert.equal(beasts.state, 'return', 'the beaten pack leaves');
    assert(beasts.shakenUntil > t, 'and keeps away for a while');
  }
  const dead = clash.casualties.filter(row => row.speciesId === 'beasts').length;
  assert.equal((beasts?.members.length || 0) + dead, 3, 'the fallen do not come back');
  // Павшие остаются местом боя в зоне, пока их не увидит игрок; место переживает сохранение.
  const sites = eco.aftermathAt(world, 3, 3, t);
  assert.equal(sites.length, 1, 'the clash leaves its fallen in the zone');
  assert.equal(sites[0].dead.length, clash.casualties.length, 'every fallen lies there');
  assert.equal(clash.aftermathId, sites[0].id);
  const reloaded = eco.normalizeEcologyState(JSON.parse(JSON.stringify(eco.serializeEcologyState(world))), fight);
  assert.equal(eco.aftermathAt(reloaded, 3, 3, t).length, 1, 'the place of a clash survives a restart');
  assert.equal(eco.aftermathAt(world, 3, 3, t + eco.AFTERMATH_TTL_MS + 1).length, 0, 'and fades after a while');
  t += 60000;
  assert.equal(eco.tickEcology(world, fight, quietFight, t, seeded(24)).filter(event => event.type === 'clash').length, 0, 'a clash is followed by a lull');
  console.log(`PASS hostile groups in a zone without players clash (${clash.casualties.length} fallen), the stronger wins, the fauna stays out, a zone with players is left to the scene`);
}

// --- путники ----------------------------------------------------------------------------------
{
  // Полоса 12×5 живых клеток, города на её концах: караван ходит между ними
  // разными путями, патруль обходит зоны у своего города.
  const cities = [{ id: 'westTown', sx: 0, sy: 2 }, { id: 'eastTown', sx: 11, sy: 2 }];
  const isCity = (sx, sy) => cities.some(city => city.sx === sx && city.sy === sy);
  const inside = (sx, sy) => sx >= 0 && sx < 12 && sy >= 0 && sy < 5;
  const stripMode = (sx, sy) => (inside(sx, sy) && !isCity(sx, sy) ? 'pvp' : '');
  const neighbors = (sx, sy) => Object.values(eco.STEPS)
    .map(step => ({ sx: sx + step.dx, sy: sy + step.dy }))
    .filter(cell => inside(cell.sx, cell.sy));
  const through = (sx, sy) => !isCity(sx, sy);
  const routes = new Set();
  for (let i = 0; i < 12; i += 1) {
    const path = eco.planRoute(cities[0], cities[1], neighbors, seeded(100 + i), { through });
    assert(path && path.length >= 12, 'a route joins the cities');
    for (let k = 1; k < path.length; k += 1) {
      assert.equal(Math.abs(path[k].sx - path[k - 1].sx) + Math.abs(path[k].sy - path[k - 1].sy), 1, 'a route steps to a neighbouring zone');
      if (k < path.length - 1) assert(!isCity(path[k].sx, path[k].sy), 'a route does not pass through a city');
    }
    routes.add(path.map(cell => `${cell.sx},${cell.sy}`).join(' '));
  }
  assert(routes.size >= 4, `caravans take different ways between the same cities: ${routes.size}`);

  const travel = eco.normalizeEcologyConfig({
    roam: { restMinutes: [30, 30], stepSeconds: [60, 60], huntStepSeconds: [30, 30], radius: 1, clashPerMinute: 2 },
    species: [
      { id: 'caravan', kind: 'traveller', faction: 'wayfarers', members: [{ type: 'guard', min: 3, max: 3 }, { type: 'porter', min: 2, max: 2 }],
        habitat: { pvp: 1 }, aggression: 0.2, fleeAt: 0.4, stepSeconds: [60, 60], travel: { mode: 'caravan', count: 2, restMinutes: [1, 2], respawnMinutes: 30 } },
      { id: 'patrol', kind: 'traveller', faction: 'wayfarers', members: [{ type: 'guard', min: 3, max: 3 }],
        habitat: { pvp: 1 }, aggression: 0.8, stepSeconds: [60, 60], travel: { mode: 'patrol', count: 1, restMinutes: [1, 2], patrolRadius: 2, patrolStops: 2 } },
      { id: 'raiders', kind: 'raider', faction: 'raiders', members: [{ type: 'raider', min: 5, max: 5 }], habitat: { pvp: 1 }, aggression: 1, fleeAt: 0.8 }
    ]
  });
  const human = () => ({ maxHp: 55 });
  const world = eco.emptyEcologyState('travel');
  const ctx = { modeAt: stripMode, cities: () => cities, neighbors, through, occupied: () => false, occupiedCells: [], createMember: human };
  const rnd = seeded(31);
  let t = 30_000_000;
  eco.tickEcology(world, travel, ctx, t, rnd);
  const caravans = () => [...world.groups.values()].filter(group => group.speciesId === 'caravan');
  const patrols = () => [...world.groups.values()].filter(group => group.speciesId === 'patrol');
  assert.equal(caravans().length, 2, 'the world gets its caravans at once');
  assert.equal(patrols().length, 2, 'every city gets its patrol');
  assert(caravans().every(group => isCity(group.sx, group.sy)), 'caravans start in a city');
  const trips = new Map();
  let patrolFarthest = 0;
  let patrolBackHome = 0;
  for (let i = 0; i < 600; i += 1) {
    t += 30000;
    for (const event of eco.tickEcology(world, travel, ctx, t, rnd)) {
      if (event.type !== 'move') continue;
      const group = world.groups.get(event.groupId);
      if (!group) continue;
      assert.equal(Math.abs(event.to.sx - event.from.sx) + Math.abs(event.to.sy - event.from.sy), 1, 'a traveller steps to a neighbouring zone');
      if (group.speciesId === 'caravan' && isCity(event.to.sx, event.to.sy)) trips.set(group.id, (trips.get(group.id) || 0) + 1);
      if (group.speciesId === 'patrol' && isCity(event.to.sx, event.to.sy)) patrolBackHome += 1;
    }
    for (const group of patrols()) {
      const home = cities.find(city => city.id === group.home);
      patrolFarthest = Math.max(patrolFarthest, Math.max(Math.abs(group.sx - home.sx), Math.abs(group.sy - home.sy)));
    }
  }
  assert([...trips.values()].some(count => count >= 2), 'a caravan reaches a city, rests and sets out again');
  assert(patrolBackHome > 0, 'a patrol comes home');
  assert(patrolFarthest >= 1 && patrolFarthest <= 3, `a patrol walks the zones around its city (${patrolFarthest})`);

  // Налётчики на пути каравана: стычка; разбитый караван поворачивает назад своей дорогой.
  let caravan = caravans().find(group => group.state === 'travel' && group.routeIndex >= 1 && eco.travellerNextCell(group));
  for (let i = 0; i < 400 && !caravan; i += 1) {
    t += 30000;
    eco.tickEcology(world, travel, ctx, t, rnd);
    caravan = caravans().find(group => group.state === 'travel' && group.routeIndex >= 1 && eco.travellerNextCell(group));
  }
  assert(caravan, 'a caravan is on the road');
  const cameFrom = { ...caravan.route[caravan.routeIndex - 1] };
  caravan.nextStepAt = t + 3600000;
  world.lairs.set('lair_r', { id: 'lair_r', speciesId: 'raiders', sx: caravan.sx, sy: caravan.sy, mode: 'pvp', region: '', slot: 0, refillAt: 0 });
  let met = null;
  for (let i = 0; i < 40 && !met; i += 1) {
    t += 20000;
    met = eco.tickEcology(world, travel, ctx, t, rnd).find(event => event.type === 'clash' && event.groups.includes(caravan.id)) || null;
  }
  assert(met, 'raiders fall on a caravan in their zone');
  assert(met.casualties.some(row => row.groupId === caravan.id), 'the caravan loses people');
  assert.equal(met.loser, caravan.id, 'five raiders beat a caravan of five');
  if (world.groups.has(caravan.id)) {
    assert(caravan.fleeing, 'a beaten caravan turns back');
    assert.deepEqual(eco.travellerNextCell(caravan), cameFrom, 'the way it came');
  }
  // Сохранение переживают и путь каравана, и его дом.
  const copy = eco.normalizeEcologyState(JSON.parse(JSON.stringify(eco.serializeEcologyState(world))), travel);
  for (const group of caravans()) {
    const saved = copy.groups.get(group.id);
    assert.deepEqual(saved.route, group.route, 'a caravan keeps its route over a restart');
    assert.equal(saved.home, group.home);
    assert.equal(saved.routeIndex, group.routeIndex);
  }
  console.log(`PASS caravans take ${routes.size} different ways between two cities and travel on, patrols walk around their city, raiders fall on caravans and a beaten one turns back`);
}

// --- путник за отрядом мира симуляции -----------------------------------------------------------
{
  // Патруль фракции идёт по зонам к месту своего отряда и стоит там; отряд
  // пошёл дальше — новый путь; отряда нет — группа уходит из мира.
  const inside = (sx, sy) => sx >= 0 && sx < 12 && sy >= 0 && sy < 5;
  const neighbors = (sx, sy) => Object.values(eco.STEPS)
    .map(step => ({ sx: sx + step.dx, sy: sy + step.dy }))
    .filter(cell => inside(cell.sx, cell.sy));
  const follow = eco.normalizeEcologyConfig({
    roam: { restMinutes: [30, 30], stepSeconds: [60, 60], radius: 1 },
    species: [
      { id: 'patrol', kind: 'traveller', faction: 'old_klim', members: [{ type: 'patrol_guard', min: 3, max: 3 }],
        habitat: { pvp: 1 }, aggression: 0.7, stepSeconds: [60, 60], travel: { mode: 'follow', count: 0 } },
      { id: 'raiders', kind: 'raider', faction: 'raiders', members: [{ type: 'raider', min: 2, max: 2 }], habitat: { pvp: 1 }, aggression: 1 }
    ]
  });
  const world = eco.emptyEcologyState('follow');
  const ctx = { modeAt: (sx, sy) => (inside(sx, sy) ? 'pvp' : ''), neighbors, occupied: () => false, occupiedCells: [], createMember: () => ({ maxHp: 55 }) };
  const rnd = seeded(41);
  let t = 50_000_000;
  eco.tickEcology(world, follow, ctx, t, rnd);
  assert.equal(world.groups.size, 0, 'the world does not raise patrols of its own');
  const spec = { key: 'sim_klim', speciesId: 'patrol', faction: 'old_klim', title: 'Патруль Старого Клима', cell: { sx: 1, sy: 2 }, goal: { sx: 8, sy: 3 }, place: 'ironMine' };
  const first = eco.followTraveller(world, follow, spec, ctx, t, rnd);
  assert(first.group && first.replanned, 'the party gets its patrol, which sets out for the place of the party');
  const patrol = first.group;
  assert.deepEqual([patrol.sx, patrol.sy], [1, 2], 'the patrol appears where its party is');
  assert.equal(eco.followTraveller(world, follow, spec, ctx, t + 1000, rnd).replanned, false, 'the same goal changes nothing');
  for (let i = 0; i < 40 && (patrol.sx !== 8 || patrol.sy !== 3); i += 1) {
    t += 70000;
    eco.tickEcology(world, follow, ctx, t, rnd);
  }
  assert.deepEqual([patrol.sx, patrol.sy], [8, 3], 'the patrol walks zone by zone to the place of its party');
  assert.equal(patrol.state, 'rest', 'and stands there');
  assert.equal(patrol.dest, 'ironMine', 'at the place of its party');
  t += 3600000;
  eco.tickEcology(world, follow, ctx, t, rnd);
  assert.deepEqual([patrol.sx, patrol.sy], [8, 3], 'a patrol does not wander off by itself');
  const moved = eco.followTraveller(world, follow, { ...spec, goal: { sx: 3, sy: 0 }, place: 'farm' }, ctx, t, rnd);
  assert(moved.replanned && patrol.state === 'travel', 'the party moves on, so does its patrol');
  // Своя фракция группы — в стычке она дерётся как патруль своей фракции.
  assert.equal(eco.groupSpecies(follow, patrol).faction, 'old_klim');
  const copy = eco.normalizeEcologyState(JSON.parse(JSON.stringify(eco.serializeEcologyState(world))), follow);
  assert.equal(copy.groups.get(patrol.id).title, 'Патруль Старого Клима', 'the name of the party survives a restart');
  assert.deepEqual(copy.groups.get(patrol.id).goal, { sx: 3, sy: 0 }, 'and so does its goal');
  assert.equal(eco.retireFollowers(world, follow, key => key !== 'sim_klim'), 1, 'a patrol whose party is gone leaves the world');
  assert.equal(world.groups.size, 0);
  console.log('PASS a patrol of a world party walks to the place of its party, stands there and follows it on');
}

// --- призраки и очередь пополнения ------------------------------------------------------------
{
  // Группы вне мира (клетки прежней сетки) убираются; под пределом групп
  // пополняются пустые логова, а не первые по списку.
  const red = lairs.filter(lair => lair.mode === 'pvpFullDrop').slice(0, 3);
  const world = eco.emptyEcologyState('rev-1');
  eco.resetLairs(world, red, 'rev-1');
  const spawnNow = 5_000_000;
  const first = eco.spawnGroup(world, config, world.lairs.get(red[0].id), spawnNow, seeded(3), members);
  const ghost = eco.spawnGroup(world, config, world.lairs.get(red[1].id), spawnNow, seeded(4), members);
  eco.moveGroup(world, ghost, 200, 180);
  assert.equal(eco.purgeGroups(world, group => !!modeAt(group.sx, group.sy)), 1, 'one group stands outside the world');
  assert(!world.groups.has(ghost.id) && world.groups.has(first.id), 'the ghost is gone, the living group stays');
  assert.equal(eco.groupsAt(world, 200, 180).length, 0, 'the cell index forgets the ghost');
  const capped = eco.normalizeEcologyConfig({ ...config, species: config.species, maxGroups: 2 });
  for (const lair of world.lairs.values()) lair.refillAt = 0;
  const refill = eco.tickEcology(world, capped, quiet, spawnNow + 1000, seeded(5)).filter(event => event.type === 'spawn');
  assert.equal(refill.length, 1, 'the group cap allows one more group');
  const refilled = world.groups.get(refill[0].groupId);
  assert.notEqual(refilled.lairId, red[0].id, 'an empty lair refills before a lair that already has a group');
  console.log('PASS groups outside the world are purged and empty lairs refill first under the group cap');
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
