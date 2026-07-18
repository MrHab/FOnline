const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath, fallback = null) {
  const file = path.join(ROOT, relPath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(dirRel, matcher = () => true) {
  const dir = path.join(ROOT, dirRel);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (matcher(full)) out.push(full);
    }
  }
  return out;
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const paramsOpen = source.indexOf('(', start);
  if (paramsOpen < 0) return '';
  let parenDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') parenDepth++;
    else if (ch === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        paramsClose = i;
        break;
      }
    }
  }
  if (paramsClose < 0) return '';
  const open = source.indexOf('{', paramsClose);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

const errors = [];
const warnings = [];
const server = readText('server.js');
const clientWorld = [
  '05_multiplayer_core_state.js',
  '05a_remote_actor_equipment.js',
  '05b_remote_player_locomotion.js',
  '05c_multiplayer_socket_room.js',
  '05d_world_containers_security.js',
  '05e_ground_items_world_sync.js',
  '05f_enemy_models_location_flow.js'
].map(name => readText(path.join('public', 'js', 'game', name))).join('\n');
const sim = readJson('data/wasteland-sim.json', { sites: {} });

function requireText(label, source, needle) {
  if (!source.includes(needle)) errors.push(`${label}: missing "${needle}"`);
}

const scheduleBody = functionBody(server, 'createNpcSchedule');
const updateScheduleBody = functionBody(server, 'updateNpcDailySchedule');
const publicEnemyBody = functionBody(server, 'publicEnemy');
const animateEnemyBody = functionBody(clientWorld, 'animateEnemyVisual');

[
  "'sleep'",
  "'rest'",
  "'social'",
  "'work'",
  "template: 'guard'",
  "template: 'merchant'",
  "template: 'craftsman'",
  "template: 'worker'"
].forEach(needle => requireText('createNpcSchedule', scheduleBody, needle));

[
  "r === 'guard'",
  "r === 'patrol'",
  "r === 'merchant'",
  "r === 'trader'",
  "r === 'quartermaster'",
  "r === 'craftsman'",
  "r === 'mechanic'"
].forEach(needle => requireText('createNpcSchedule role coverage', scheduleBody, needle));

[
  'enemy.npcScheduleState = state',
  "if (state === 'work') return false",
  "enemy.aiState = state",
  "state === 'sleep'",
  'updateNpcSocialSpeech'
].forEach(needle => requireText('updateNpcDailySchedule', updateScheduleBody, needle));

[
  "aiState === 'dialogue' ? 'dialogue' : scheduleStateRaw",
  'scheduleState,',
  'scheduleLabel,',
  'speechText,'
].forEach(needle => requireText('publicEnemy schedule snapshot', publicEnemyBody, needle));

[
  'function enemyAnimApplySleepPose',
  'function enemyAnimApplyDialoguePose',
  'const sleeping = scheduleState ===',
  'const inDialogue = scheduleState ===',
  'enemyAnimApplySleepPose',
  'enemyAnimApplyDialoguePose',
  'enemy.enemyVisualSpeed'
].forEach(needle => requireText('client NPC animations', clientWorld, needle));

[
  'enemyAnimRestoreActorParts(parts, restoreK)',
  'enemyAnimWeaponVisible(mesh, true)'
].forEach(needle => requireText('client NPC animation cleanup', animateEnemyBody, needle));
requireText('client NPC sleep weapon cleanup', clientWorld, 'enemyAnimWeaponVisible(mesh, false)');

const hostileWorkerRoles = new Set([
  'wild_creature',
  'creature',
  'monster',
  'raider',
  'mutant',
  'super_mutant',
  'ghoul',
  'radscorpion',
  'mutant_ant',
  'gecko'
]);
const supportedScheduleRoles = new Set([
  'guard',
  'patrol',
  'merchant',
  'trader',
  'quartermaster',
  'craftsman',
  'mechanic',
  'worker',
  'medic',
  'hauler',
  'scavenger'
]);

const sites = sim && sim.sites && typeof sim.sites === 'object' ? sim.sites : {};
let friendlyWorkerKinds = 0;
let friendlyWorkerTotal = 0;
for (const [siteId, site] of Object.entries(sites)) {
  const workers = Array.isArray(site?.workers) ? site.workers : [];
  for (const worker of workers) {
    const role = String(worker?.role || '').trim().toLowerCase();
    const count = Number(worker?.count || 0);
    if (!role) {
      errors.push(`${siteId}: worker row has no role`);
      continue;
    }
    if (!Number.isFinite(count) || count <= 0) {
      errors.push(`${siteId}: worker role "${role}" has invalid count`);
    }
    if (hostileWorkerRoles.has(role)) continue;
    friendlyWorkerKinds++;
    friendlyWorkerTotal += Math.max(0, Math.floor(count));
    if (!supportedScheduleRoles.has(role)) {
      warnings.push(`${siteId}: role "${role}" uses default worker schedule`);
    }
  }
}

const locationFiles = listFiles('data/locations', file => file.endsWith('.json'));
let authoredNpcRows = 0;
for (const file of locationFiles) {
  const loc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(loc.objects) ? loc.objects : [];
  for (const row of rows) {
    const entity = row && row.entity && typeof row.entity === 'object' ? row.entity : {};
    const tags = Array.isArray(row.tags) ? row.tags.map(tag => String(tag || '').toLowerCase()) : [];
    const kind = String(entity.kind || row.kind || '').toLowerCase();
    const model = String(row.model || row.url || '').toLowerCase();
    const isNpc = kind === 'npc'
      || tags.some(tag => ['npc', 'guard', 'merchant', 'trader', 'friendly'].includes(tag))
      || /npc|tradernpc|wastelandsettler|caravanguard|klimpatrolguard/.test(model);
    if (!isNpc) continue;
    authoredNpcRows++;
    if (kind === 'npc' && entity.hostileToPlayer !== true && !entity.role && !row.role) {
      warnings.push(`${path.relative(ROOT, file)}:${row.id || model || 'npc'} has no explicit role; default schedule will be worker`);
    }
  }
}

console.log(`NPC schedules OK: ${friendlyWorkerKinds} worker groups, ${friendlyWorkerTotal} simulated NPCs, ${authoredNpcRows} authored NPC rows.`);
if (warnings.length) {
  console.log('Warnings:');
  warnings.slice(0, 20).forEach(warning => console.log(`- ${warning}`));
  if (warnings.length > 20) console.log(`- ...and ${warnings.length - 20} more`);
}
if (errors.length) {
  console.error('NPC schedule check failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}
