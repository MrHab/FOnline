#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  npcMeleeCommitCapacity,
  npcMeleeCommitLeaseMs,
  npcMeleeCommitCooldownMs,
  tryReserveNpcMeleeCommit,
  completeNpcMeleeCommit
} = require('../src/server/enemy-ai');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const server = read('server.js');
const enemyAi = read('src/server/enemy-ai.js');
const enemies = read('unity-client/Assets/Scripts/Game/RoaEnemies.cs');
const probe = read('unity-client/Assets/Editor/RoaNpcCombatCoordinationProbe.cs');
const probeMeta = read('unity-client/Assets/Editor/RoaNpcCombatCoordinationProbe.cs.meta');
const auditRunner = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const docs = read('docs/UNITY_PORT.md');
const pkg = JSON.parse(read('package.json'));

assert.deepStrictEqual([1, 2, 5, 6, 40].map(npcMeleeCommitCapacity), [1, 2, 2, 3, 3],
  'melee commit capacity is not bounded at 1/2/3');
assert(npcMeleeCommitLeaseMs(0.6) >= 1100 && npcMeleeCommitLeaseMs(0.6) <= 1350,
  'ordinary melee commit lease does not contain wind-up and follow-through');
assert(npcMeleeCommitCooldownMs(1) > npcMeleeCommitCooldownMs(0),
  'stable cooldown spread no longer rotates attackers');
const actors = Array.from({ length: 8 }, (_, index) => ({
  id: `npc-${index}`, attackTimer: 0.55
}));
const active = new Set();
assert.deepStrictEqual(actors.map(actor =>
  tryReserveNpcMeleeCommit(actor, 'player', actors.length, active, 1000)),
  [true, true, true, false, false, false, false, false],
  'the real reservation helper does not cap an eight-NPC group at three commits');
completeNpcMeleeCommit(actors[0], active, 1100, 0);
assert(tryReserveNpcMeleeCommit(actors[3], 'player', actors.length, active, 1101),
  'a waiting NPC does not inherit a released commit');

[
  'function npcMeleeCommitCapacity(attackerCount)',
  'function npcMeleeCommitLeaseMs(attackDelaySeconds, options = {})',
  'function npcMeleeCommitCooldownMs(seed = 0, options = {})',
  'function tryReserveNpcMeleeCommit(actor = {}, targetId = \'\', attackerCount = 1,',
  'function completeNpcMeleeCommit(actor = {}, activeActorIds = null,',
  'actor.meleeCommitUntil = 0;',
  "actor.meleeCommitTargetId = '';"
].forEach(contract => assert(enemyAi.includes(contract),
  `enemy AI coordination contract is missing: ${contract}`));

[
  'function reserveEnemyMeleeCommit(room, enemy, target, now = Date.now())',
  'room.enemyMeleeCommitActiveByTargetId = meleeCommitActiveByTargetId;',
  'const melee = !serverNpcWeaponDef(enemy)?.ammoType;',
  'tryReserveNpcMeleeCommit(enemy, targetId, Math.max(1, group.length),',
  'completeNpcMeleeCommit(enemy, active, time,',
  "enemy.aiState = 'pressure';",
  'cancelEnemyMeleeCommit(room, enemy, now, 180);',
  'finishEnemyMeleeCommit(room, enemy, now);',
  "'pressure', 'tactical', 'reload', 'retreat', 'stagger'"
].forEach(contract => assert(server.includes(contract),
  `server melee coordination integration is missing: ${contract}`));

const missBranch = server.indexOf("emitServerNpcMelee(room, enemy, target, weapon, { hit: false });");
const hitBranch = server.indexOf("emitServerNpcMelee(room, enemy, target, weapon, { hit: true });");
assert(missBranch >= 0 && server.indexOf('finishEnemyMeleeCommit(room, enemy, now);', missBranch) > missBranch,
  'a missed melee attack does not release its commit slot');
assert(hitBranch >= 0 && server.indexOf('finishEnemyMeleeCommit(room, enemy, now);', hitBranch) > hitBranch,
  'a landed melee attack does not release its commit slot');

[
  'public static string NpcIntentLabel(string aiState, bool hostile,',
  'case "pressure": return "ИЩЕТ МОМЕНТ";',
  'case "reload": return "ПЕРЕЗАРЯЖАЕТСЯ";',
  'case "retreat": return "ОТСТУПАЕТ";',
  'case "chase": return "СБЛИЖАЕТСЯ";',
  'return threatRanged ? "ЦЕЛИТСЯ В ВАС" : "АТАКУЕТ ВАС";',
  'enemy.ThreatRanged,',
  'enemy.CharacterView.SetDead(enemy.Dead);'
].forEach(contract => assert(enemies.includes(contract),
  `Unity NPC intent presentation is missing: ${contract}`));

assert(probe.includes('[MenuItem("Realm of Ashes/Проверить NPC Coordination 5.0")]')
  && probe.includes('NpcIntentLabel("pressure"')
  && probe.includes('ResolveFrameDeadState(true, false, false)'),
  'Unity NPC Coordination 5.0 probe is incomplete');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\s*$/m.test(probeMeta),
  'Unity NPC Coordination probe meta is missing or malformed');
assert(auditRunner.includes('typeof(RoaNpcCombatCoordinationProbe)'),
  'full Unity audit does not include NPC Coordination 5.0');
assert(docs.includes('## NPC Coordination 5.0') && docs.includes('ИЩЕТ МОМЕНТ'),
  'NPC Coordination 5.0 is undocumented');
assert(pkg.scripts['check:unity-npc-coordination']
  && pkg.scripts.precheck.includes('check:unity-npc-coordination'),
  'NPC Coordination 5.0 checker is not wired into npm precheck');

console.log('Unity NPC Coordination 5.0 OK: bounded rotating melee commits, explicit intentions and terminal death');
