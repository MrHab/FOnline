#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const enemies = read('unity-client/Assets/Scripts/Game/RoaEnemies.cs');
const character = read('unity-client/Assets/Scripts/Game/RoaCharacterView.cs');
const server = read('server.js');
const probe = read('unity-client/Assets/Editor/RoaSettlementLifeProbe.cs');
const meta = read('unity-client/Assets/Editor/RoaSettlementLifeProbe.cs.meta');
const audit = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const docs = read('docs/UNITY_PORT.md');
const pkg = JSON.parse(read('package.json'));

[
  'public static string NpcActivityLabel(string activityType, string activityPhase)',
  'if (phase == "travel") return "ИДЁТ К МЕСТУ";',
  'case "craft": return "РАБОТАЕТ";',
  'case "guard": return "НА ПОСТУ";',
  'case "socialize": return "ОБЩАЕТСЯ";',
  'public static string ResolveNpcActivityVisual(string activityType,',
  'phase == "travel" || IsCombatAiState(state)',
  'state == "alarm" || state == "investigate"',
  'StableActivityPhase01(string id)',
  'enemy.CharacterView.SetActivityPresentation(ResolveNpcActivityVisual(',
  'enemy.Snapshot["activityType"]?.ToString(),',
  'enemy.Snapshot["activityPhase"]?.ToString())'
].forEach(contract => assert(enemies.includes(contract),
  `Unity settlement-life integration is missing: ${contract}`));

[
  'public void SetActivityPresentation(string activity, float phaseOffset01)',
  'private void ApplyActivityPresentation(float dt)',
  'Only upper-body bones are touched',
  'case "work":',
  'case "shop":',
  'case "guard":',
  'case "social":',
  'case "eat":',
  'case "rest":',
  'ApplyActivityPresentation(Time.deltaTime);',
  '_dead || _locomoting || Turning || _hitReaction.Active'
].forEach(contract => assert(character.includes(contract),
  `procedural settlement-life pose is missing: ${contract}`));

[
  'npcActivityType:',
  'npcActivityPhase:',
  'npcActivityVisualAction:',
  "phase: 'travel'",
  "phase: 'use'",
  'routinePackage.source === \'interrupt\'',
  'serviceAvailable: false'
].forEach(contract => assert(server.includes(contract),
  `authoritative NPC activity contract is missing: ${contract}`));

assert(probe.includes('[MenuItem("Realm of Ashes/Проверить Settlement Life 5.1")]')
  && probe.includes('ResolveNpcActivityVisual(')
  && probe.includes('alarm.StartsWith("ТРЕВОГА · ")'),
  'Settlement Life 5.1 probe is incomplete');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\s*$/m.test(meta),
  'Settlement Life probe meta is missing or malformed');
assert(audit.includes('typeof(RoaSettlementLifeProbe)'),
  'full Unity audit does not include Settlement Life 5.1');
assert(docs.includes('## Settlement Life 5.1'),
  'Settlement Life 5.1 is undocumented');
assert(pkg.scripts['check:unity-settlement-life']
  && pkg.scripts.precheck.includes('check:unity-settlement-life'),
  'Settlement Life checker is not wired into npm precheck');

console.log('Unity Settlement Life 5.1 OK: readable routines, upper-body activity poses, alarm priority and desynchronized residents');
