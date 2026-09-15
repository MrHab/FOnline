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
const rewardVaults = (reactor.containers || []).filter(row => row.bossLoot === 'zeroCustodian').map(row => row.id);
assert.deepEqual(rewardVaults, ['boss_vault_a', 'boss_vault_b'], 'The reward containers of the installation are named in the data.');
const nodeObjects = reactor.objects.filter(row => Array.isArray(row.tags) && row.tags.includes('shield-node'));
assert.equal(nodeObjects.length, 4, 'Four shield nodes are authored around the installation.');
assert(reactor.containers.filter(row => row.bossLoot === 'zeroCustodian').length >= 2, 'Reward containers are bound to the boss.');
for (const vault of reactor.containers.filter(row => row.bossLoot === 'zeroCustodian')) {
  assert(Array.isArray(vault.loot) && vault.loot.length > 0, `${vault.id}: the victory reward is authored, not rolled from an empty table.`);
  assert.equal(vault.lootTable, true, `${vault.id}: the tier table still adds to the authored reward.`);
}
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
const hazardsBefore = boss.worldBossHazards(state, rules, { x: 0, z: 0 });
events = boss.tickWorldBoss(state, rules, pulseAt);
assert.deepEqual(events, [{ type: 'pulse', radius: rules.pulseRadius, damage: rules.pulseDamage, hazardOffset: state.hazardOffset }]);
// Импульс смещает опасные участки арены: безопасное место меняется.
const hazardsAfter = boss.worldBossHazards(state, rules, { x: 0, z: 0 });
assert.equal(hazardsAfter.length, rules.hazardActive, 'The arena keeps its number of burning sectors.');
assert.notDeepEqual(hazardsAfter.map(row => row.sector), hazardsBefore.map(row => row.sector),
  'After a pulse the dangerous sectors move.');
assert(hazardsAfter.every(row => row.radius === rules.hazardRadius && row.damage === rules.hazardDamage),
  'Hazard radius and damage come from the rules.');
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

// Награда за победу: выдаётся один раз и ждёт того, кто её не забрал.
assert.equal(boss.bossRewardPending(state, 'boss_vault_a'), false, 'Until the containers are opened there is nothing to wait for.');
boss.noteBossRewardUnlocked(state, pulseAt + 5000);
assert(boss.bossRewardPending(state, 'boss_vault_a') && boss.bossRewardPending(state, 'boss_vault_b'),
  'After the defeat both containers wait for their owner.');
assert(boss.noteBossRewardClaimed(state, 'boss_vault_a'));
assert(!boss.noteBossRewardClaimed(state, 'boss_vault_a'), 'A container is claimed once.');
assert.equal(boss.bossRewardPending(state, 'boss_vault_a'), false, 'A looted container does not open again.');
assert(boss.bossRewardPending(state, 'boss_vault_b'), 'The untouched container still waits.');

// Перезапуск сервера: сохранённый таймер держит босса побеждённым.
const persisted = boss.persistedBossState(state);
assert.deepEqual(persisted, {
  bossId: 'zeroCustodian', defeatedAt: pulseAt + 5000, respawnAt: state.respawnAt, kills: 1,
  reward: { unlockedAt: pulseAt + 5000, claimed: ['boss_vault_a'] }
});
const restored = boss.applyPersistedBossState(boss.createBossState(territory.centralLab.worldBoss, nodes, rules, state.respawnAt - 1000), persisted, state.respawnAt - 1000);
assert.equal(restored.phase, 'defeated');
assert.equal(boss.aliveNodes(restored).length, 0);
assert.equal(boss.bossRewardPending(restored, 'boss_vault_a'), false, 'The claimed reward stays claimed after a restart.');
assert(boss.bossRewardPending(restored, 'boss_vault_b'), 'The untouched reward survives a restart.');
const afterTimer = boss.applyPersistedBossState(boss.createBossState(territory.centralLab.worldBoss, nodes, rules, state.respawnAt + 1), persisted, state.respawnAt + 1);
assert.equal(afterTimer.phase, 'shielded', 'An elapsed timer restores the boss on load.');
assert.equal(afterTimer.kills, 1);

// Перерождение по тику.
events = boss.tickWorldBoss(state, rules, state.respawnAt);
assert.deepEqual(events, [{ type: 'respawn' }]);
assert.equal(state.phase, 'shielded');
assert.equal(boss.aliveNodes(state).length, 4);
assert.equal(state.pulse.count, 0);
assert.deepEqual(state.reward, { unlockedAt: 0, claimed: [] }, 'A living boss holds its reward again.');
assert.equal(boss.bossRewardPending(state, 'boss_vault_b'), false, 'While the boss lives nothing waits in the containers.');

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

// Фаза уязвимости сужает опасную зону, поверженный босс её гасит; сервер
// наносит урон стоящим в участке и публикует их клиенту.
{
  const arena = boss.createBossState({ id: 'zero', displayName: 'Хранитель' }, [{ id: 'n1', x: 2, z: 2 }], rules, 1000);
  arena.phase = 'vulnerable';
  const narrow = boss.worldBossHazards(arena, rules, { x: 0, z: 0 });
  arena.phase = 'shielded';
  const wide = boss.worldBossHazards(arena, rules, { x: 0, z: 0 });
  assert(narrow.length < wide.length, 'While the boss is vulnerable the arena burns less.');
  arena.phase = 'defeated';
  assert.deepEqual(boss.worldBossHazards(arena, rules, { x: 0, z: 0 }), [], 'A defeated boss leaves a safe arena.');
  const snapshot = boss.publicWorldBoss(wide.length ? arena : arena, rules, 2000, { center: { x: 5, z: 5 } });
  assert(Array.isArray(snapshot.hazards), 'The snapshot always carries the hazard list.');
  // Центр арены нужен клиенту, чтобы назвать стороны горящих участков.
  assert.deepEqual(snapshot.arenaCenter, { x: 5, z: 5 }, 'The snapshot carries the centre of the arena.');
  const presentationSource = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaWorldEventsPresentation.cs'), 'utf8');
  assert(presentationSource.includes('JObject arena = payload["arenaCenter"] as JObject;'),
    'The boss line must name the burning sides around the installation.');
}
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const needle of [
  'function serverWorldBossArenaCenter(',
  'const hazards = worldBossHazards(state, serverWorldBossRules(serverWorldBossDefForRoom(room)),',
  'const hazard = hazards.find(row => Math.hypot(Number(p.x || 0) - row.x, Number(p.z || 0) - row.z) <= row.radius);',
  'center: serverWorldBossArenaCenter(room, boss)',
  // Незабранная награда возвращается вместе с комнатой после перезапуска.
  "serverUnlockBossContainers(room, state.bossId, { onlyPending: true });",
  'function serverNoteBossRewardTaken(room, container) {',
  'serverNoteBossRewardTaken(room, container);',
  'if (onlyPending && !(state && bossRewardPending(state, container.defId || container.id))) continue;'
]) assert(serverSource.includes(needle), `server.js must run the changing arena: ${needle}`);

console.log('World boss OK: shield nodes, vulnerability window, telegraphed pulses, defeat with reward unlock, persisted respawn timer and server hooks.');
