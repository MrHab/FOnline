'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { canonicalKromkaFactionId } = require('../src/server/kromka-faction-contracts');
const { ZONE_MODE_SET, normalizeZoneMode, zoneModeAllowsPvp } = require('../src/server/zone-rules');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function handlerSource(event) {
  const start = source.indexOf(`  socket.on('${event}',`);
  assert(start >= 0, event);
  return source.slice(start, source.indexOf('\n  });', start) + 6);
}

function fixture(mode = 'pvp') {
  const handlers = {};
  const events = [];
  const weapon = { id: 'pistol', ammoType: 'ammo9', range: 30, damageType: 'ballistic' };
  const p = { id: 'shooter', characterId: 'char-shooter', roomId: 'arena', locationId: 'arena', hp: 100, x: 0, z: 0, loaded: 10, ap: 20 };
  const target = { id: 'target', characterId: 'char-target', roomId: 'arena', hp: 100, x: 10, z: 0 };
  const enemy = { id: 'npc', name: 'Guard', hp: 100, faction: 'neutral', hostileToPlayer: false, x: 10, z: 0 };
  const room = { id: 'arena', locationId: 'arena', loc: { id: 'arena', pvpMode: mode, safe: mode === 'peaceful' }, enemies: new Map([[enemy.id, enemy]]) };
  const players = new Map([[p.id, p], [target.id, target]]);
  const emit = (event, payload) => events.push({ event, payload });
  const relay = { emit };
  relay.volatile = relay;
  let spends = 0;
  let noise = 0;
  const tokens = new Set();
  const damageEffects = [];
  const context = vm.createContext({
    Map, Set, Date, Math, canonicalKromkaFactionId,
    players, rooms: new Map([[room.id, room]]),
    socket: { id: p.id, on: (event, callback) => { handlers[event] = callback; }, to: () => relay },
    io: { to: () => relay },
    LOCATION_PVP_MODES: ZONE_MODE_SET, normalizeZoneMode, zoneModeAllowsPvp,
    SERVER_FACTION_CAPITAL_LOCATION_IDS: new Set(['settlement', 'scrapTown', 'relayStation', 'caravanCamp']),
    SERVER_FACTION_ALLIES: new Set(['uprava|tract_league', 'tract_league|uprava']),
    SERVER_ALWAYS_HOSTILE_FACTION_GROUPS: new Set(['raiders', 'wild']),
    SERVER_WILD_FACTION_GROUPS: new Set(['wild']), SERVER_DEFAULT_FACTION_RELATIONS: {},
    WASTELAND_SIM: { state: () => ({}) },
    actorIsExplicitlyHostileToPlayer: actor => !!actor.explicitlyHostile,
    sanitizeServerSocialState: state => ({ friends: state.friends || [], clan: state.clan || {} }),
    serverWorldPartyAttachmentForPlayer: player => player.attachment || null,
    playerMatchesWorldPartyMember: (player, member) => player.characterId === member.characterId,
    roomLocation: current => current.loc,
    serverNpcIsKromkaOnboardingProtected: npc => !!npc?.storyProtected,
    serverPlayerHasProtectedClanRally: player => !!player.rallyProtected,
    ensureRoomWorld: () => {}, syncServerActionProgressionPlayer: () => {},
    serverActiveWeaponId: () => weapon.id, serverActiveWeaponSlot: () => 'weapon',
    serverBaseItemId: id => id, serverWeaponDef: () => weapon,
    serverEquippedWeaponEntryForSlot: () => ({ weapon }),
    serverDualWieldPistolPair: () => null,
    serverCombatAck: player => ({ loaded: player.loaded, ap: player.ap }),
    serverCombatAcksForEntries: () => [],
    publicAuthoritativePlayerState: player => ({ ...player }),
    publicPlayer: player => ({ ...player }), publicEnemy: npc => ({ ...npc }),
    serverEquipmentSnapshotMatchesAuthority: () => true,
    serverCombatToken: token => token,
    serverWeaponModeInfo: () => ({ id: 'single' }),
    serverResolvePlayerAttackPlan: () => ({ ok: true, modeInfo: { id: 'single' }, entries: [{ weapon }] }),
    serverValidateAndSpendAttack: (player, data) => {
      const reused = tokens.has(data.attackToken);
      if (!reused) { tokens.add(data.attackToken); player.loaded--; player.ap -= 3; spends++; }
      return { ok: true, reused, entries: [{ weapon }], mode: 'single', combat: { loaded: player.loaded, ap: player.ap } };
    },
    serverCombatOrigin: player => ({ x: player.x, z: player.z }),
    serverCombatTargetPoint: npc => ({ x: npc.x, z: npc.z }),
    serverLineOfFireClearFrom: () => true,
    serverValidateMultiTargetHit: () => ({ ok: true, dirX: 1, dirZ: 0 }),
    serverPlayerNoiseRadius: (_, radius) => radius, addRoomNoise: () => { noise++; },
    ENEMY_HEARING_SHOT_RANGE: 30, ENEMY_HEARING_HARVEST_RANGE: 10, MAP_SIZE: 200, roomWorldExtent: () => 200,
    serverIsShotgunWeapon: () => false, serverAmbushLevel: () => 0,
    serverDamageRoll: () => 10, serverStatValue: () => 5, serverHitChance: () => 1,
    serverExplosiveRadius: () => 3,
    resolveCriticalShot: rawDamage => ({ rawDamage, critical: false, chance: 0, multiplier: 1 }),
    serverMitigateEnemyDamage: raw => ({ damage: raw, absorbed: 0 }),
    serverMitigateDamage: raw => ({ damage: raw, absorbed: 0 }),
    serverApplyDerivedVitals: () => {}, serverTrySecondChance: () => false,
    serverApplyInjuriesFromHit: player => { damageEffects.push(player.id); return []; },
    serverApplyArtifactImpact: player => damageEffects.push(player.id),
    aggroEnemyFromHit: (_, npc) => damageEffects.push(npc.id),
    applyNpcHitStagger: npc => damageEffects.push(npc.id),
    serverFinishEnemyKilledByPlayer: () => false, refreshRoomWorldState: () => {},
    livePlayersInRoom: () => [...players.values()], sanitizeInjuries: value => value,
    normalizeDeviceType: () => 'desktop', normalizeControlType: () => 'keyboard_mouse',
    sanitizeEquipment: value => value
  });
  for (const name of [
    'normalizeLocationPvpMode', 'capitalLocationId', 'locationIsFactionCapital',
    'locationPvpMode', 'locationAllowsPvp', 'locationAllowsNpcCombat', 'roomAllowsNpcCombat', 'locationHasFullInventoryDrop',
    'serverFactionKey', 'serverWorldFactionKey', 'serverCombatFactionGroup', 'serverFactionRelation',
    'serverFactionsHostile', 'serverActorHostileToPlayer', 'serverCombatFactionsAllied', 'serverPlayersAllied',
    'serverPlayerCanDamageNpc', 'serverPlayerCanDamagePlayer', 'serverProtectedAttackAck'
  ]) vm.runInContext(functionSource(name), context);
  for (const event of ['shoot', 'melee', 'combatAttack', 'enemyHit', 'playerHit', 'explosionAttack'])
    vm.runInContext(handlerSource(event), context);
  let sequence = 0;
  const attack = (event, extra = {}) => {
    let response;
    handlers[event]({ attackToken: `shot-${++sequence}`, enemyId: enemy.id, targetId: target.id, ...extra }, ack => { response = ack; });
    return response;
  };
  return { p, target, enemy, room, weapon, context, events, damageEffects, attack, spends: () => spends, noise: () => noise };
}

for (const mode of ['peaceful', 'pvp', 'pvpFullDrop']) {
  const f = fixture(mode);
  const allies = [
    ['friend', () => { f.p.socialState = { friends: [{ id: f.target.characterId }] }; }],
    ['clan', () => { f.p.socialState = f.target.socialState = { clan: { id: 'team', name: 'Team' } }; }],
    ['faction', () => { f.p.worldFactionId = f.target.worldFactionId = 'uprava'; }],
    ['allied faction', () => { f.p.worldFactionId = 'uprava'; f.target.worldFactionId = 'tract_league'; }],
    ['party', () => { f.p.attachment = { party: { id: 'caravan', playerMembers: [{ characterId: f.target.characterId }] } }; }]
  ];
  for (const [kind, setup] of allies) {
    delete f.p.socialState; delete f.target.socialState;
    delete f.p.worldFactionId; delete f.target.worldFactionId; delete f.p.attachment;
    setup();
    const result = f.attack('playerHit');
    assert(result.ok && result.protected && result.damage === 0, `${mode} ${kind}: shot must be accepted without damage`);
    assert.equal(f.target.hp, 100);
    assert.equal(f.target.lastServerDamageAt, undefined);
  }
  for (const weaponId of ['pistol', 'fists', 'shotgun', 'flamethrower']) {
    f.weapon.id = weaponId;
    const result = f.attack('enemyHit', { multiTarget: weaponId === 'shotgun' || weaponId === 'flamethrower' });
    assert(result.ok && result.protected && result.damage === 0, `${mode} ${weaponId}: friendly NPC must be protected`);
    assert.equal(f.enemy.hp, 100);
    assert.equal(f.enemy.hostileToPlayer, false);
  }
  assert.equal(f.spends(), allies.length + 4, 'Protected shots must spend their ordinary attack resources');
  assert.equal(f.damageEffects.length, 0, 'Protected hits must never injure, stagger or aggro their targets');
}

for (const capital of ['settlement', 'scrapTown', 'relayStation', 'caravanCamp', 'peacefulOutpost']) {
  const f = fixture('peaceful');
  f.room.loc.id = f.p.locationId = capital;
  const fired = f.attack('combatAttack', { attackToken: 'air-shot' });
  assert(fired.ok, `${capital}: untargeted shot denied`);
  assert.equal(f.p.loaded, 9);
  assert.equal(f.p.ap, 17);
  assert(f.attack('combatAttack', { attackToken: 'air-shot' }).reused);
  assert.equal(f.spends(), 1);
  assert.equal(f.noise(), 1, 'Replay must not repeat authoritative noise');
  f.attack('shoot'); f.attack('melee');
  assert.deepEqual(f.events.map(row => row.event), ['shot', 'melee']);
  assert(f.attack('enemyHit').protected);
  assert(f.attack('playerHit').protected);
  f.weapon.id = 'rocketLauncher';
  const explosion = f.attack('explosionAttack', { impactX: 10, impactZ: 0 });
  assert(explosion.ok, `${capital}: explosion near protected NPCs denied`);
  assert.equal(explosion.enemyHits.length + explosion.playerHits.length, 0);
  assert.equal(f.enemy.hp, 100);
  assert.equal(f.target.hp, 100);
}

// A single explosion contains both a friendly guard/player and hostile targets.
{
  const f = fixture('pvpFullDrop');
  f.weapon.id = 'rocketLauncher';
  f.p.socialState = { friends: [{ id: f.target.characterId }] };
  const foe = { ...f.enemy, id: 'raider', faction: 'raiders', hostileToPlayer: true };
  const opponent = { ...f.target, id: 'opponent', characterId: 'opponent-char' };
  f.room.enemies.set(foe.id, foe);
  f.context.players.set(opponent.id, opponent);
  const explosion = f.attack('explosionAttack', { impactX: 10, impactZ: 0 });
  assert(explosion.ok);
  assert.equal(f.enemy.hp, 100);
  assert.equal(f.target.hp, 100);
  assert(foe.hp < 100 && opponent.hp < 100, 'Hostile targets must still take splash damage');
  assert(f.damageEffects.every(id => id === foe.id || id === opponent.id));
  assert.equal(f.spends(), 1);
}

{
  const f = fixture();
  assert(!f.context.serverPlayersAllied(f.p, f.target), 'Unrelated independent players must not become allies');
  assert(f.context.serverPlayerCanDamagePlayer(f.p, f.target, f.room));
  f.enemy.faction = 'raiders'; f.enemy.hostileToPlayer = true;
  assert(f.context.serverPlayerCanDamageNpc(f.p, f.enemy, f.room));
  f.p.worldFactionId = f.enemy.faction = 'uprava';
  assert(!f.context.serverPlayerCanDamageNpc(f.p, f.enemy, f.room), 'Same-faction protection survives stale hostility');
  delete f.p.worldFactionId;
  f.p.attachment = { party: { id: 'escort', playerMembers: [] } };
  f.enemy.onsitePartyId = 'escort';
  assert(!f.context.serverPlayerCanDamageNpc(f.p, f.enemy, f.room), 'Escorted party NPCs must be protected');
}

console.log('Friendly fire OK: peaceful/capital shooting, normal spending, ally protection for direct/cone/blast attacks, hostile splash damage and no protected-target side effects.');
