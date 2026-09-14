#!/usr/bin/env node
'use strict';

// Мировой босс «Объекта Ноль» под управляемым временем: щит из узлов,
// уязвимость после их уничтожения и её конец, телеграф и импульс, поражение,
// награда, перерождение и сохранение таймера; плюс серверные крючки.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const boss = require('../src/server/world-boss');
const territory = JSON.parse(read('data/kromka/territory.json'));
const reactor = JSON.parse(read('data/locations/coreLabCenterReactor.json'));

// --- данные -----------------------------------------------------------------
assert.equal(territory.centralLab.worldBoss.id, 'zeroCustodian');
assert.equal(reactor.lab.worldBoss.id, 'zeroCustodian');
const bossObject = reactor.objects.find(row => row.entity?.worldBoss === true);
assert(bossObject && bossObject.entity.bossId === 'zeroCustodian' && bossObject.entity.hp >= 1000, 'The reactor level authors the boss NPC.');
const nodeObjects = reactor.objects.filter(row => Array.isArray(row.tags) && row.tags.includes('shield-node'));
assert.equal(nodeObjects.length, 4, 'Four shield nodes are authored around the installation.');
assert(reactor.containers.filter(row => row.bossLoot === 'zeroCustodian').length >= 2, 'Reward containers are bound to the boss.');
for (const level of territory.centralLab.levels) {
  const loc = JSON.parse(read(`data/locations/${level.id}.json`));
  assert.equal(loc.kind, 'territoryLab');
  assert.equal(loc.factionAccess, 'territory', `${level.id}: labs stay inside the faction territory.`);
  assert(loc.anomalyFields.length >= 0);
}
for (const lab of territory.labs) {
  const loc = JSON.parse(read(`data/locations/${lab.id}.json`));
  assert(loc.objects.some(row => row.entity?.hostileToPlayer === true), `${lab.id}: side labs have guardians.`);
  assert(loc.containers.length >= 3 && loc.containers.some(row => row.terminalLocked), `${lab.id}: side labs have locked reward containers.`);
  assert(loc.anomalyFields.length >= 2, `${lab.id}: side labs carry anomaly hazards.`);
}

// --- машина состояний ------------------------------------------------------------
const rules = boss.normalizeWorldBossRules({}, { respawnMs: territory.centralLab.worldBoss.respawnMs });
assert.equal(rules.respawnMs, 5400000);
assert.deepEqual([rules.vulnerableMs, rules.pulseIntervalMs, rules.pulseTelegraphMs, rules.pulseRadius, rules.pulseDamage, rules.shieldNodeHp], [45000, 20000, 3000, 9, 28, 320]);
const nodes = nodeObjects.map(row => ({ id: row.id, x: row.position.x, z: row.position.z }));
const t0 = 5000000;
const state = boss.createBossState(territory.centralLab.worldBoss, nodes, rules, t0);
assert.equal(state.phase, 'shielded');
assert.equal(state.nodes.length, 4);
assert.equal(boss.bossDamageMultiplier(state), 0, 'A shielded boss takes no damage.');

// Узлы: три из четырёх — всё ещё щит; четвёртый — уязвимость.
for (const node of state.nodes.slice(0, 3)) {
  const result = boss.noteShieldNodeDestroyed(state, node.id, rules, t0 + 1000);
  assert(result.changed && !result.vulnerable);
}
assert.equal(state.phase, 'shielded');
assert.deepEqual(boss.noteShieldNodeDestroyed(state, state.nodes[0].id, rules, t0 + 1000), { changed: false, vulnerable: false }, 'A dead node cannot die twice.');
const last = boss.noteShieldNodeDestroyed(state, state.nodes[3].id, rules, t0 + 2000);
assert(last.changed && last.vulnerable);
assert.equal(state.phase, 'vulnerable');
assert.equal(state.vulnerableUntil, t0 + 2000 + rules.vulnerableMs);
assert.equal(boss.bossDamageMultiplier(state), 1, 'A vulnerable boss takes full damage.');
assert.equal(state.cycles, 1);

// Конец уязвимости восстанавливает щит и узлы.
let events = boss.tickWorldBoss(state, rules, t0 + 2000 + rules.vulnerableMs);
assert(events.some(event => event.type === 'shieldRestored'));
assert.equal(state.phase, 'shielded');
assert.equal(boss.aliveNodes(state).length, 4, 'All nodes come back with the shield.');

// Импульс: телеграф за три секунды, затем импульс и новый интервал.
const pulseAt = state.pulse.nextAt;
assert.deepEqual(boss.tickWorldBoss(state, rules, pulseAt - rules.pulseTelegraphMs - 1), [], 'Nothing happens before the telegraph.');
events = boss.tickWorldBoss(state, rules, pulseAt - rules.pulseTelegraphMs);
assert.equal(events.length, 1);
assert.equal(events[0].type, 'pulseTelegraph');
assert.equal(events[0].inMs, rules.pulseTelegraphMs);
assert(boss.publicWorldBoss(state, rules, pulseAt - 1000).pulseTelegraph, 'Clients see the telegraph.');
assert.deepEqual(boss.tickWorldBoss(state, rules, pulseAt - 1), [], 'The telegraph fires once.');
const pulseCountBefore = state.pulse.count;
events = boss.tickWorldBoss(state, rules, pulseAt);
assert.deepEqual(events, [{ type: 'pulse', radius: rules.pulseRadius, damage: rules.pulseDamage }]);
assert.equal(state.pulse.nextAt, pulseAt + rules.pulseIntervalMs);
assert.equal(state.pulse.count, pulseCountBefore + 1);
assert(!boss.publicWorldBoss(state, rules, pulseAt + 1).pulseTelegraph);

// Поражение: узлы гаснут, награда открыта, перерождение через 90 минут.
for (const node of state.nodes) boss.noteShieldNodeDestroyed(state, node.id, rules, pulseAt + 100);
assert.equal(state.phase, 'vulnerable');
assert(boss.noteBossDefeated(state, rules, pulseAt + 5000));
assert(!boss.noteBossDefeated(state, rules, pulseAt + 5001), 'Defeat is recorded once.');
assert.equal(state.phase, 'defeated');
assert.equal(state.respawnAt, pulseAt + 5000 + rules.respawnMs);
assert.equal(state.kills, 1);
const publicDefeated = boss.publicWorldBoss(state, rules, pulseAt + 6000);
assert(publicDefeated.defeated && publicDefeated.rewardOpen && publicDefeated.respawnInSeconds === Math.round((rules.respawnMs - 1000) / 1000));
assert.deepEqual(boss.tickWorldBoss(state, rules, pulseAt + 6000), [], 'A defeated boss neither pulses nor shields.');
assert(!boss.bossRespawnDue(state, state.respawnAt - 1));
assert(boss.bossRespawnDue(state, state.respawnAt));

// Перезапуск сервера: сохранённый таймер держит босса побеждённым.
const persisted = boss.persistedBossState(state);
assert.deepEqual(persisted, { bossId: 'zeroCustodian', defeatedAt: pulseAt + 5000, respawnAt: state.respawnAt, kills: 1 });
const restored = boss.applyPersistedBossState(boss.createBossState(territory.centralLab.worldBoss, nodes, rules, state.respawnAt - 1000), persisted, state.respawnAt - 1000);
assert.equal(restored.phase, 'defeated');
assert.equal(boss.aliveNodes(restored).length, 0);
const afterTimer = boss.applyPersistedBossState(boss.createBossState(territory.centralLab.worldBoss, nodes, rules, state.respawnAt + 1), persisted, state.respawnAt + 1);
assert.equal(afterTimer.phase, 'shielded', 'An elapsed timer restores the boss on load.');
assert.equal(afterTimer.kills, 1);

// Перерождение по тику.
events = boss.tickWorldBoss(state, rules, state.respawnAt);
assert.deepEqual(events, [{ type: 'respawn' }]);
assert.equal(state.phase, 'shielded');
assert.equal(boss.aliveNodes(state).length, 4);
assert.equal(state.pulse.count, 0);

// --- серверные крючки -------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  'dmgInfo.damage = serverWorldBossDamageAfterShield(room, enemy, dmgInfo.damage);',
  'serverNoteWorldBossKill(room, enemy, now);',
  'const bossLootError = serverBossLootError(room, container);',
  'serverTickWorldBosses(Date.now())',
  'worldBoss: (() => {',
  "emit('worldBossState', payload)",
  'function serverApplyWorldBossPulse(room, state, event, now = Date.now())',
  'serverWorldBossStore()[state.bossId] = persistedBossState(state);',
  "row.tags.includes('shield-node')"
]) assert(server.includes(needle), `server.js is missing the world boss contract: ${needle}`);
assert.equal((server.match(/serverWorldBossDamageAfterShield\(room, enemy, dmgInfo\.damage\)/g) || []).length, 2, 'Both player damage paths respect the shield.');
const socketClient = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
assert(socketClient.includes('_connection.On("worldBossState"') && socketClient.includes('OnWorldBossState?.Invoke(payload)'), 'Unity must route worldBossState.');

console.log('World boss OK: shield nodes, vulnerability window, telegraphed pulses, defeat with reward unlock, persisted respawn timer and server hooks.');
