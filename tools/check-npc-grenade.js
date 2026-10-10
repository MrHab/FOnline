#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  WINDUP_MS, COOLDOWN_MS, GROUP_COOLDOWN_MS, MAX_PLAYER_HITS,
  canPrimeNpcGrenade, primeNpcGrenade, finishNpcGrenade
} = require('../src/server/npc-grenade');
const { normalizeEcologyConfig, normalizeEcologyState, serializeEcologyState } = require('../src/server/danger-ecology');

const now = 100000;
const enemy = { id: 'raider-1', role: 'raider', ecologyGroupId: 'rovers',
  ecologySiteId: '', x: 0, z: 0, tier: 2, hp: 100 };
const players = Array.from({ length: 100 }, (_, i) => ({
  id: `player-${i}`, x: 8 + (i % 3) * 0.1, z: (i % 2) * 0.1, hp: 100
}));
const hostile = () => true;
assert.equal(canPrimeNpcGrenade(enemy, players[0], players, [enemy], now, 0, hostile), true);
assert.equal(canPrimeNpcGrenade({ ...enemy, ecologySiteId: 'lair-1' }, players[0], players,
  [enemy], now, 0, hostile), false, 'lair guards never throw');
assert.equal(canPrimeNpcGrenade({ ...enemy, role: 'monster' }, players[0], players,
  [enemy], now, 0, hostile), false, 'mutants never throw');
assert.equal(canPrimeNpcGrenade(enemy, players[0], players,
  [enemy, { x: 8, z: 1, hp: 100 }], now, 0, hostile), false, 'do not aim at allies');
assert.equal(canPrimeNpcGrenade(enemy, players[0], players, [enemy],
  now, now + GROUP_COOLDOWN_MS, hostile), false, 'group throws are staggered');

const grenade = primeNpcGrenade(enemy, players[0], now);
assert.equal(enemy.ecologyVisualAction, 'grenade');
assert.equal(enemy.ecologyVisualActionStartedAt, now);
assert.equal(enemy.npcGrenadeCooldownUntil, now + COOLDOWN_MS);
let damageCalls = 0;
const applyDamage = (player, raw) => { damageCalls++; player.hp -= raw; return raw; };
assert.equal(finishNpcGrenade(enemy, now + WINDUP_MS - 1, players,
  () => true, applyDamage).state, 'windup');
assert.equal(damageCalls, 0, 'telegraph precedes server damage');
// A player who dodges the fixed impact during windup leaves the blast.
players[1].x = 16;
const detonation = finishNpcGrenade(enemy, now + WINDUP_MS, players,
  player => player.id !== 'player-2', applyDamage);
assert.equal(detonation.state, 'detonated');
assert.equal(detonation.hits.length, MAX_PLAYER_HITS, 'a 100-player stack has a bounded hit count');
assert.equal(damageCalls, MAX_PLAYER_HITS);
assert(players[0].hp < 100, 'the server callback applies actual HP damage');
assert.equal(players[1].hp, 100, 'dodging works');
assert.equal(players[2].hp, 100, 'blocked explosion line of sight works');
assert.equal(players.filter(player => player.hp < 100).length, MAX_PLAYER_HITS);
assert.equal(enemy.ecologyVisualAction, '');
assert.equal(canPrimeNpcGrenade(enemy, players[0], players, [enemy],
  now + WINDUP_MS + 1, 0, hostile), false, 'the 20-second actor cooldown survives detonation');
assert.equal(finishNpcGrenade(enemy, now + WINDUP_MS + 1, players,
  () => true, applyDamage).state, 'none', 'the same grenade cannot detonate twice');

const doomed = { ...enemy, npcGrenade: null, npcGrenadeCooldownUntil: 0 };
primeNpcGrenade(doomed, players[0], now);
doomed.dead = true;
assert.equal(finishNpcGrenade(doomed, now + WINDUP_MS, players,
  () => true, applyDamage).state, 'cancelled');
assert.equal(damageCalls, MAX_PLAYER_HITS, 'dead throwers cause no damage');

const config = normalizeEcologyConfig({ species: [{
  id: 'raider_band', kind: 'raider', faction: 'raiders',
  members: [{ type: 'raider', min: 1, max: 1 }], habitat: { pve: 1 }
}] });
const persisted = normalizeEcologyState({ groups: [{
  id: 'rovers', speciesId: 'raider_band', sx: 1, sy: 1,
  members: [{ id: 'm1', type: 'raider', hp: 55, maxHp: 55 }],
  grenadeGroupReadyAt: now + GROUP_COOLDOWN_MS,
  grenadeMemberReadyAt: { m1: now + COOLDOWN_MS }
}] }, config);
const restarted = normalizeEcologyState(serializeEcologyState(persisted), config).groups.get('rovers');
assert.equal(restarted.grenadeGroupReadyAt, now + GROUP_COOLDOWN_MS);
assert.equal(restarted.grenadeMemberReadyAt.m1, now + COOLDOWN_MS,
  'the actor cooldown survives the runtime-state save/restart cycle');
assert.equal(canPrimeNpcGrenade({ ...enemy, npcGrenadeCooldownUntil: restarted.grenadeMemberReadyAt.m1 },
  players[0], players, [enemy], now + WINDUP_MS, restarted.grenadeGroupReadyAt, hostile), false);
console.log('NPC grenade behavior OK');
