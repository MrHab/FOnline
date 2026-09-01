'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const server = read('server.js');
const enemyAi = read('src', 'server', 'enemy-ai.js');
const enemies = read(game, 'RoaEnemies.cs');
const telegraph = read(game, 'RoaEnemyThreatTelegraph.cs');
const protocol = read('unity-client', 'Assets', 'Scripts', 'Net', 'RoaProtocol.cs');
const audio = read(game, 'RoaAudio.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaEnemyThreatTelegraphProbe.cs');
const runner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const socketDocs = read('docs', 'wiki', 'SOCKET_EVENTS.md');
const packageJson = JSON.parse(read('package.json'));

assert(enemyAi.includes('function npcAttackTelegraph(')
  && enemyAi.includes('weaponId === "rocketLauncher"')
  && enemyAi.includes('remainingMs > windowMs')
  && enemyAi.includes('return { remainingMs, windowMs, targetId, ranged };'),
'Server AI no longer exposes a bounded, weapon-aware wind-up window');
assert(server.includes('const telegraph = npcAttackTelegraph(e, serverNpcWeaponDef(e));')
  && server.includes('| (telegraph ? 64 : 0)')
  && server.includes('| (telegraph?.ranged ? 128 : 0)')
  && server.includes('frame.attackMs = telegraph.remainingMs;')
  && server.includes('frame.attackTargetId = telegraph.targetId;'),
'Compact enemy frame lost the authoritative attack warning contract');

assert(protocol.includes('public const int AttackTelegraph = 64;')
  && protocol.includes('public const int RangedAttackTelegraph = 128;'),
'Unity protocol flags no longer match the server attack warning bits');
assert(enemies.includes('enemy.LookPoint = RoaCoords.ToUnity(')
  && enemies.includes('Vector3 look = enemy.LookPoint - enemy.TargetPosition;'),
'Unity still treats an absolute NPC look point as a direction vector');
assert(enemies.includes('enemy.Root.AddComponent<RoaEnemyThreatTelegraph>()')
  && enemies.includes('enemy.CharacterView.PlayAttack();')
  && enemies.includes('bool windupAnimated = Time.time < enemy.AttackWindupUntil;')
  && enemies.includes('RoaAudio.Active?.PlayThreatWarning(enemy.ThreatRanged);'),
'Enemy warning is disconnected from pre-impact animation, de-duplication or personal audio');

assert(telegraph.includes('public static Frame Evaluate(')
  && telegraph.includes('Radius = Mathf.Lerp(')
  && telegraph.includes('Width = Mathf.Lerp(')
  && telegraph.includes('AimAlpha = ranged && targetsLocalPlayer')
  && telegraph.includes('SetVisible(false, false);'),
'World warning no longer converges, distinguishes its target or expires cleanly');
assert(audio.includes('public bool ThreatWarningCueReady')
  && audio.includes('public void PlayThreatWarning(bool ranged)')
  && audio.includes('BuildActivitySignal("ThreatWarning"'),
'Personal attack warning has no distinct generated audio cue');
assert(socketDocs.includes('`64` — идёт короткая подготовка атаки')
  && socketDocs.includes('`128` — подготовка относится к дальнобойной атаке'),
'Socket documentation does not describe the new compact flags');

assert(probe.includes('urgent.Radius < early.Radius')
  && probe.includes('view.ActiveRendererCount == 2')
  && probe.includes('audio.ThreatWarningCueReady && audio.GeneratedClipCount == 32')
  && probe.includes('[ПРЕДУПРЕЖДЕНИЕ NPC] готово:'),
'Editor probe no longer covers converge, personal aim, expiry and audio');
assert(runner.includes('typeof(RoaEnemyThreatTelegraphProbe)'),
  'Enemy threat telegraph probe is not included in the Unity audit');
for (const file of [
  ['unity-client', 'Assets', 'Scripts', 'Game', 'RoaEnemyThreatTelegraph.cs.meta'],
  ['unity-client', 'Assets', 'Editor', 'RoaEnemyThreatTelegraphProbe.cs.meta']
]) assert(/guid:\s*[0-9a-f]{32}/i.test(read(...file)), `${file.join('/')} has no GUID`);
assert(packageJson.scripts['check:unity-enemy-telegraph'],
  'package.json has no narrow enemy telegraph check');

console.log('Unity enemy telegraph OK: server wind-up, exact facing, converging ring/aim, early animation and personal audio');
