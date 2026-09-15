#!/usr/bin/env node
'use strict';

// Поведенческая проверка правил смерти: настоящий обработчик взрыва из
// server.js запускается в песочнице, а воронка выпадения подменена записью
// вызовов. Так видно, что правило потерь не зависит от причины смерти —
// чужая ракета и собственный взрыв идут одним путём, — и что режим зоны
// решает, выпадает ли что-нибудь вообще.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ZONE_MODE_SET, normalizeZoneMode, zoneModeAllowsPvp } = require('../src/server/zone-rules');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function handlerSource(event) {
  const start = source.indexOf(`  socket.on('${event}',`);
  assert(start >= 0, `server.js has no handler for ${event}`);
  return source.slice(start, source.indexOf('\n  });', start) + 6);
}

/**
 * Комната с двумя игроками: стрелок и цель. Режим зоны задаётся аргументом,
 * цель стоит рядом с точкой взрыва и живёт ровно один удар.
 */
function fixture(mode = 'pvpFullDrop', targetHp = 5) {
  const handlers = {};
  const drops = [];
  const respawns = [];
  const weapon = { id: 'rocketLauncher', ammoType: 'rocket', range: 30, damageType: 'explosive', explosive: true };
  const p = {
    id: 'shooter', characterId: 'char-shooter', roomId: 'arena', locationId: 'arena',
    hp: 100, maxHp: 100, x: 0, z: 0, loaded: 3, ap: 20, inventory: { stim: 2 }, equipment: { weapon: 'rocketLauncher' }
  };
  const target = {
    id: 'target', characterId: 'char-target', roomId: 'arena', locationId: 'arena',
    hp: targetHp, maxHp: 100, x: 9, z: 0, inventory: { stim: 4 }, equipment: { armor: 'leatherArmor' }
  };
  const loc = { id: 'arena', pvpMode: mode, safe: mode === 'peaceful' };
  const room = { id: 'arena', locationId: 'arena', loc, enemies: new Map(), groundItems: new Map() };
  const players = new Map([[p.id, p], [target.id, target]]);
  const events = [];
  const relay = { emit: (event, payload) => events.push({ event, payload }) };
  relay.volatile = relay;
  const context = vm.createContext({
    Map, Set, Date, Math, Number, String, JSON, console,
    players, rooms: new Map([[room.id, room]]),
    socket: { id: p.id, on: (event, callback) => { handlers[event] = callback; }, to: () => relay },
    io: { to: () => relay },
    LOCATION_PVP_MODES: ZONE_MODE_SET, normalizeZoneMode, zoneModeAllowsPvp,
    SERVER_FACTION_CAPITAL_LOCATION_IDS: new Set(['settlement']),
    roomLocation: current => current.loc,
    roomWorldExtent: () => 200,
    ensureRoomWorld: () => {},
    syncServerActionProgressionPlayer: () => {},
    serverActiveWeaponId: () => weapon.id,
    serverBaseItemId: id => id,
    serverWeaponDef: () => weapon,
    serverCombatAck: player => ({ loaded: player.loaded, ap: player.ap }),
    publicAuthoritativePlayerState: player => ({ id: player.id, hp: player.hp }),
    serverEquipmentSnapshotMatchesAuthority: () => true,
    serverWeaponModeInfo: () => ({ id: 'single' }),
    serverCombatToken: token => token,
    serverCombatOrigin: player => ({ x: player.x, z: player.z }),
    serverLineOfFireClearFrom: () => true,
    serverExplosiveRadius: () => 6,
    serverPlayerCanDamageNpc: () => true,
    serverValidateAndSpendAttack: player => {
      player.loaded -= 1;
      player.ap -= 4;
      return { ok: true, reused: false, entries: [{ weapon }], mode: 'single', combat: { loaded: player.loaded, ap: player.ap } };
    },
    addRoomNoise: () => {},
    ENEMY_HEARING_SHOT_RANGE: 30, ENEMY_HEARING_HARVEST_RANGE: 10, MAP_SIZE: 200,
    serverPlayerNoiseRadius: (_, radius) => radius,
    serverDamageRoll: () => 90,
    resolveCriticalShot: rawDamage => ({ rawDamage, critical: false, chance: 0, multiplier: 1 }),
    serverStatValue: () => 5,
    serverAmbushLevel: () => 0,
    serverMitigateEnemyDamage: raw => ({ damage: raw, absorbed: 0 }),
    serverWorldBossDamageAfterShield: (_, __, damage) => damage,
    serverLabDamageModifier: (_, __, damage) => damage,
    aggroEnemyFromHit: () => {},
    applyNpcHitStagger: () => {},
    serverFinishEnemyKilledByPlayer: () => false,
    livePlayersInRoom: () => [...players.values()].filter(row => !row.dead),
    serverPlayerCanDamagePlayer: () => true,
    serverApplyDerivedVitals: () => {},
    serverMitigateDamage: raw => ({ damage: raw, absorbed: 0 }),
    serverTrySecondChance: () => false,
    serverApplyInjuriesFromHit: () => [],
    serverApplyArtifactImpact: () => {},
    serverTryDownWorldActivityPlayer: () => false,
    // Воронка выпадения: единственное, что проверяется поведением.
    serverDropPvpLootForMode: (dropRoom, dropTarget, killer, dropLoc, now) => {
      drops.push({
        roomId: dropRoom?.id || '',
        targetId: dropTarget?.id || '',
        killerId: killer?.id || null,
        mode: dropLoc?.pvpMode || '',
        now
      });
      return [{ id: 'stim', qty: 1 }];
    },
    serverRespawnPlayer: (player, respawnRoom, options) => {
      respawns.push({ playerId: player.id, roomId: respawnRoom?.id || '', options });
    },
    sanitizeInjuries: value => value,
    publicEnemy: npc => ({ id: npc.id, hp: npc.hp }),
    publicPlayer: player => ({ id: player.id, hp: player.hp }),
    refreshRoomWorldState: () => {},
    serverAllowCosmeticRelay: () => true,
    serverMarkAttackTargetHit: () => true
  });
  for (const name of [
    'normalizeLocationPvpMode', 'capitalLocationId', 'locationIsFactionCapital',
    'locationPvpMode', 'locationAllowsPvp', 'locationHasFullInventoryDrop', 'serverCurrentHp'
  ]) vm.runInContext(functionSource(name), context);
  vm.runInContext(handlerSource('explosionAttack'), context);
  return { handlers, drops, respawns, players, p, target, room, events };
}

function blast(world, overrides = {}) {
  let ack = null;
  world.handlers.explosionAttack({
    attackToken: `token-${Math.random()}`,
    x: world.p.x,
    z: world.p.z,
    impactX: 9,
    impactZ: 0,
    ...overrides
  }, response => { ack = response; });
  return ack;
}

// --- чужая ракета в Сердцевине ------------------------------------------------
{
  const world = fixture('pvpFullDrop');
  const ack = blast(world);
  assert(ack && ack.ok !== false, 'The explosion is accepted: ' + JSON.stringify(ack).slice(0, 200));
  assert.equal(world.target.dead, true, 'The target of the blast dies');
  assert.equal(world.drops.length, 1, 'Death runs through the single loss funnel');
  assert.equal(world.drops[0].targetId, 'target');
  assert.equal(world.drops[0].killerId, 'shooter', 'The killer is named in the drop');
  assert.equal(world.drops[0].mode, 'pvpFullDrop', 'The zone mode decides what is lost');
}

// --- собственный взрыв ---------------------------------------------------------
{
  const world = fixture('pvpFullDrop');
  world.p.hp = 5;
  world.target.x = 40;
  const ack = blast(world, { impactX: 0, impactZ: 0 });
  assert(ack && ack.ok !== false);
  assert.equal(world.p.dead, true, 'A rocket at your own feet kills');
  assert.equal(world.drops.length, 1, 'A self-inflicted death drops by the same rule');
  assert.equal(world.drops[0].targetId, 'shooter');
  assert.equal(world.drops[0].killerId, null, 'A self-inflicted death has no killer');
}

// --- мирная зона ----------------------------------------------------------------
{
  const world = fixture('peaceful');
  blast(world);
  assert.equal(world.drops.length, 0, 'In a peaceful zone the blast does not kill players');
  assert.notEqual(world.target.dead, true);
}

// --- публичное событие: смерть без потери вещей ---------------------------------
{
  const world = fixture('pvpEvent');
  blast(world);
  assert.equal(world.target.dead, true, 'A public event still allows PvP');
  assert.equal(world.drops.length, 1, 'The funnel is called and the zone rule decides the loss');
  assert.equal(world.drops[0].mode, 'pvpEvent');
}

// --- целая цель не роняет ничего -------------------------------------------------
{
  const world = fixture('pvpFullDrop', 500);
  blast(world);
  assert.notEqual(world.target.dead, true, 'A survivor keeps standing');
  assert.equal(world.drops.length, 0, 'A survivor drops nothing');
}

// --- пять лабораторий живут по правилу Сердцевины ---------------------------------
for (const labId of ['coreLabSprout', 'coreLabCircuit', 'coreLabAlloy', 'coreLabSpectrum', 'coreLabCenterReactor']) {
  const definition = JSON.parse(fs.readFileSync(path.join(root, `data/locations/${labId}.json`), 'utf8'));
  const world = fixture(definition.pvpMode);
  world.room.loc.id = labId;
  world.room.loc.safe = definition.safe === true;
  blast(world);
  assert.equal(world.target.dead, true, `${labId}: PvP works by the rules of the territory`);
  assert.equal(world.drops.length, 1, `${labId}: death runs through the same funnel`);
  assert.equal(world.drops[0].mode, 'pvpFullDrop', `${labId}: the laboratory inherits the partial loss of the territory`);
}

console.log('Death loot runtime OK: the blast handler kills through one funnel, self-inflicted death drops by the same rule, and the zone mode decides the loss, and all five laboratories inherit the rule of the territory.');
