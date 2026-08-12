const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const {
  createLegacyRoutine,
  normalizeAuthoredRoutine,
  routineInterruptBlocksService,
  selectRoutinePackage,
} = require('../src/server/npc-routines');
const { buildActivitySlotCatalog } = require('../src/server/npc-smart-objects');

const ROOT = path.resolve(__dirname, '..');
// The current authored map produces 117 sites, 125 friendly groups and 285
// friendly NPCs. Keep headroom for content edits while rejecting empty or
// severely truncated fixtures.
const MIN_GENERATED_SITES = 100;
const MIN_FRIENDLY_WORKER_GROUPS = 100;
const MIN_FRIENDLY_SIMULATED_NPCS = 200;

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
const scheduleFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-of-ashes-npc-schedules-'));
let scheduleFixtureCleaned = false;

function cleanupScheduleFixture() {
  if (scheduleFixtureCleaned) return;
  scheduleFixtureCleaned = true;
  try { fs.rmSync(scheduleFixtureDir, { recursive: true, force: true }); } catch (_) {}
}

process.once('exit', cleanupScheduleFixture);

let sim = { sites: {} };
try {
  const globalMap = readJson('data/global-map.json', null);
  if (!globalMap || typeof globalMap !== 'object') {
    errors.push('deterministic schedule fixture: data/global-map.json is missing or invalid');
  } else {
    const simulation = createWastelandSimulation({
      stateFile: path.join(scheduleFixtureDir, 'wasteland-sim.json'),
      getGlobalMap: () => globalMap
    });
    sim = simulation.state();
  }
} catch (error) {
  errors.push(`deterministic schedule fixture: ${error?.message || String(error)}`);
}

function requireText(label, source, needle) {
  if (!source.includes(needle)) errors.push(`${label}: missing "${needle}"`);
}

const scheduleBody = functionBody(server, 'createNpcSchedule');
const updateScheduleBody = functionBody(server, 'updateNpcDailySchedule');
const publicEnemyBody = functionBody(server, 'publicEnemy');
const animateEnemyBody = functionBody(clientWorld, 'animateEnemyVisual');
const updateEnemiesBody = functionBody(server, 'updateServerEnemies');
const dialogueInterruptBody = functionBody(server, 'npcRoutineDialogueInterruptType');
const ensureSlotsBody = functionBody(server, 'ensureRoomNpcActivitySlots');
const reserveSlotBody = functionBody(server, 'reserveNpcActivitySlot');

requireText('createNpcSchedule integration', scheduleBody, 'createLegacyRoutine');

try {
  const stableRoll = (_seed, salt) => salt === 'schedule-shift' ? 0.5 : 0;
  const expectedTemplates = {
    guard: 'guard',
    patrol: 'guard',
    merchant: 'merchant',
    trader: 'merchant',
    quartermaster: 'merchant',
    craftsman: 'craftsman',
    mechanic: 'craftsman',
    worker: 'worker'
  };
  // Расписание свёрнуто: у роли ровно одно постоянное поведение.
  for (const [role, expectedRole] of Object.entries(expectedTemplates)) {
    const routine = createLegacyRoutine({ seed: `check:${role}`, role, stableRoll });
    if (routine.role !== expectedRole) errors.push(`npc role ${role} resolved to ${routine.role}, expected ${expectedRole}`);
    if (routine.packages?.length !== 1) errors.push(`npc role ${role} must expose exactly one behaviour`);
  }
  const guard = createLegacyRoutine({ seed: 'guard-role', role: 'guard', stableRoll });
  if (selectRoutinePackage({ routine: guard })?.type !== 'guard') errors.push('guard role does not stand its post');
  if (selectRoutinePackage({ routine: guard, context: { investigate: true } })?.type !== 'investigate') {
    errors.push('investigate interrupt does not outrank the role behaviour');
  }
  if (selectRoutinePackage({ routine: guard, context: { combat: true, investigate: true } })?.type !== 'combat') {
    errors.push('combat interrupt does not outrank investigate');
  }
  for (const type of ['combat', 'alarm', 'investigate']) {
    if (!routineInterruptBlocksService({ [type]: true })) errors.push(`${type} interrupt does not close NPC services`);
  }
  if (routineInterruptBlocksService({ dialogue: true })) errors.push('dialogue alone incorrectly closes NPC services');
} catch (error) {
  errors.push(`executable routine checks failed: ${error?.message || String(error)}`);
}

[
  'npcRoutinePackageForActor',
  "routinePackage.source === 'interrupt'",
  'reserveNpcActivitySlot',
  "phase: 'travel'",
  "phase: 'use'",
  'updateNpcSocialSpeech'
].forEach(needle => requireText('updateNpcDailySchedule', updateScheduleBody, needle));

const combatBranch = updateEnemiesBody.indexOf('if (factionCombatActors.has(enemy.id))');
const dialogueBranch = updateEnemiesBody.indexOf('if (Number(enemy.dialogueFocusUntil || 0) > 0)');
if (combatBranch < 0 || dialogueBranch < 0 || combatBranch >= dialogueBranch) {
  errors.push('updateServerEnemies no longer gives combat strict priority over dialogue focus');
}
[
  "enemy.dialogueFocusUntil = 0;",
  "enemy.dialoguePlayerId = '';",
  "packageId: 'interrupt:combat'",
  'serviceAvailable: false'
].forEach(needle => requireText('combat clears active NPC dialogue', updateEnemiesBody, needle));
[
  'npcRoutineDialogueInterruptType(room, enemy, now)',
  'enemy.dialogueFocusUntil = 0;',
  'enemy.npcScheduleState = dialogueInterruptType;',
  'serviceAvailable: false'
].forEach(needle => requireText('combat/alarm clear active NPC dialogue', updateEnemiesBody, needle));
if (/facing:\s*null,\s*facing:\s*null/.test(updateEnemiesBody)) {
  errors.push('combat activity state contains duplicate facing fields');
}
try {
  const dialogueInterruptType = new Function(
    'npcRoutineCombatActive',
    'npcRoutineAlarmActive',
    'room',
    'enemy',
    'now',
    dialogueInterruptBody
  );
  const room = {};
  if (dialogueInterruptType(() => true, () => true, room, {}, 1000) !== 'combat') {
    errors.push('combat does not outrank alarm when interrupting dialogue');
  }
  if (dialogueInterruptType(() => false, () => true, room, {}, 1000) !== 'alarm') {
    errors.push('alarm does not interrupt active dialogue');
  }
  if (dialogueInterruptType(() => false, () => false, room, { aiState: 'investigate' }, 1000) !== '') {
    errors.push('investigation incorrectly interrupts dialogue');
  }
} catch (error) {
  errors.push(`dialogue interrupt priority check failed: ${error?.message || String(error)}`);
}
requireText(
  'stationary NPC investigation override',
  updateEnemiesBody,
  "enemy.stationary && enemy.hostileToPlayer === false && !npcRoutineInvestigationActive(enemy, now)"
);

const dialogueStart = server.indexOf("socket.on('npcDialogueFocus'");
const dialogueEnd = server.indexOf("socket.on('", dialogueStart + 12);
const dialogueHandler = dialogueStart >= 0 && dialogueEnd > dialogueStart ? server.slice(dialogueStart, dialogueEnd) : '';
const dialogueCombatCheck = dialogueHandler.indexOf('npcRoutineDialogueInterruptType(room, enemy, Date.now())');
const dialogueFocusWrite = dialogueHandler.indexOf('enemy.dialogueFocusUntil = Date.now() + 16000');
if (dialogueCombatCheck < 0 || dialogueFocusWrite < 0 || dialogueCombatCheck >= dialogueFocusWrite) {
  errors.push('npcDialogueFocus can start or extend dialogue while the NPC is in combat or alarm');
}
requireText('npcDialogueFocus combat rejection', dialogueHandler, "dialogueInterruptType === 'combat'");
requireText('npcDialogueFocus alarm rejection', dialogueHandler, "dialogueInterruptType === 'alarm'");
if ((server.match(/npcScheduledServiceClosed\(room, actor, Date\.now\(\)\)/g) || []).length < 2) {
  errors.push('NPC trade state/exchange do not both reject combat, alarm and investigation interruptions');
}
if ((server.match(/serviceAvailable:\s*!npcRoutineServiceInterrupted\(room, enemy,/g) || []).length < 2) {
  errors.push('NPC activity snapshots can still advertise services during combat, alarm or investigation');
}

[
  'room.npcActivitySlotObjectSource !== objectSource',
  'npcActivityReservationsPrunedAtStructureRevision',
  'buildActivitySlotIndexes(room.npcActivitySlots)'
].forEach(needle => requireText('indexed activity-slot catalog', ensureSlotsBody, needle));
[
  'slotById: room.npcActivitySlotById',
  'slotsByType: room.npcActivitySlotsByType',
  'npcActivityReservationMiss'
].forEach(needle => requireText('indexed activity-slot reservation', reserveSlotBody, needle));

try {
  const authoredNpcStationary = new Function('entity', 'role', functionBody(server, 'authoredNpcStationary'));
  if (authoredNpcStationary({ stationary: false }, 'merchant') !== false) {
    errors.push('authored merchant stationary:false is overridden by the merchant default');
  }
  if (authoredNpcStationary({}, 'merchant') !== true) errors.push('merchant stationary default was lost');
} catch (error) {
  errors.push(`authored stationary policy check failed: ${error?.message || String(error)}`);
}

[
  "aiState === 'dialogue' ? 'dialogue' : scheduleStateRaw",
  'scheduleState,',
  'scheduleLabel,',
  'activityRevision:',
  'activityPhase:',
  'visualAction:',
  'serviceAvailable:',
  'speechText,'
].forEach(needle => requireText('publicEnemy schedule snapshot', publicEnemyBody, needle));

[
  'function enemyAnimApplyDialoguePose',

  'const inDialogue = scheduleState ===',
  'enemyAnimApplyDialoguePose',
  'enemy.enemyVisualSpeed'
].forEach(needle => requireText('client NPC animations', clientWorld, needle));

[
  'enemyAnimRestoreActorParts(parts, animationRestoreK)',
  'enemyAnimWeaponVisible(mesh, true)'
].forEach(needle => requireText('client NPC animation cleanup', animateEnemyBody, needle));
requireText('client NPC weapon restore', clientWorld, 'enemyAnimWeaponVisible(mesh, true)');

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
const simulatedSiteCount = Object.keys(sites).length;
const friendlyRoleTotals = new Map();
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
    friendlyRoleTotals.set(role, (friendlyRoleTotals.get(role) || 0) + Math.max(0, Math.floor(count)));
    if (!supportedScheduleRoles.has(role)) {
      warnings.push(`${siteId}: role "${role}" uses default worker schedule`);
    }
  }
}

if (simulatedSiteCount < MIN_GENERATED_SITES) {
  errors.push(`deterministic schedule fixture covers only ${simulatedSiteCount} generated sites; expected at least ${MIN_GENERATED_SITES}`);
}
if (friendlyWorkerKinds < MIN_FRIENDLY_WORKER_GROUPS) {
  errors.push(`deterministic schedule fixture covers only ${friendlyWorkerKinds} friendly worker groups; expected at least ${MIN_FRIENDLY_WORKER_GROUPS}`);
}
if (friendlyWorkerTotal < MIN_FRIENDLY_SIMULATED_NPCS) {
  errors.push(`deterministic schedule fixture covers only ${friendlyWorkerTotal} friendly simulated NPCs; expected at least ${MIN_FRIENDLY_SIMULATED_NPCS}`);
}
for (const role of ['guard', 'trader', 'quartermaster', 'craftsman', 'mechanic', 'medic', 'worker', 'scavenger']) {
  if (!friendlyRoleTotals.has(role)) {
    errors.push(`deterministic schedule fixture has no friendly "${role}" workers`);
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

try {
  const routineCatalog = readJson('data/npc-routines.json', { routines: {} });
  const saylaRoutine = normalizeAuthoredRoutine(routineCatalog?.routines?.caravan_sayla || {}, { id: 'caravan_sayla' });
  // У авторской роли тоже ровно одно поведение и никаких часовых окон.
  if (saylaRoutine.packages.length !== 1) errors.push(`caravan_sayla role has ${saylaRoutine.packages.length} behaviours; expected 1`);
  const shop = selectRoutinePackage({ routine: saylaRoutine, fallback: false });
  if (shop?.type !== 'shop' || shop?.serviceAvailable !== true) errors.push('Sayla shop service is not open');
  for (const row of saylaRoutine.packages) {
    if (row.startHour != null || row.endHour != null) errors.push('authored roles still carry hour windows');
    if (String(row.type || '').toLowerCase() === 'sleep') errors.push('authored roles still schedule sleep');
  }

  const caravanCamp = readJson('data/locations/caravanCamp.json', {});
  const slots = buildActivitySlotCatalog(caravanCamp);
  const slotIds = new Set(slots.map(slot => slot.id));
  if (slots.length < 20) errors.push(`caravanCamp exposes only ${slots.length} activity slots; expected at least 20`);
  if (!slots.some(slot => slot.id === 'caravan_sayla_bed' && slot.ownerNpcId === 'caravan_sayla')) {
    errors.push('Sayla personal bed slot is missing or has no owner');
  }
  for (const routinePackage of saylaRoutine.packages) {
    const slotId = String(routinePackage?.target?.slotId || '');
    if (slotId && !slotIds.has(slotId)) errors.push(`Sayla routine target ${slotId} is absent from caravanCamp activity slots`);
    const slotType = String(routinePackage?.target?.slotType || '');
    if (slotType && !slots.some(slot => slot.type === slotType)) {
      errors.push(`Sayla routine target type ${slotType} is absent from caravanCamp activity slots`);
    }
  }
  const caravanObjects = Array.isArray(caravanCamp.objects) ? caravanCamp.objects : [];
  const shopSlotParent = caravanObjects.find(row => (Array.isArray(row?.activitySlots) ? row.activitySlots : [])
    .some(slot => String(slot?.id || '') === 'caravan_sayla_shop'));
  const storageHelpersStart = server.indexOf('function locationDefinitionObjectTags');
  const storageHelpersEnd = server.indexOf('function locationDefinitionObjectIsNpc', storageHelpersStart);
  if (storageHelpersStart < 0 || storageHelpersEnd <= storageHelpersStart) {
    errors.push('cannot extract runtime location storage normalization helpers');
  }
  const runtimeObjectIsWarehouse = storageHelpersStart >= 0 && storageHelpersEnd > storageHelpersStart
    ? vm.runInNewContext(`${server.slice(storageHelpersStart, storageHelpersEnd)}\nlocationDefinitionObjectIsWarehouse`, {})
    : () => false;
  if (!shopSlotParent) errors.push('Sayla shop slot has no authored parent object');
  else if (runtimeObjectIsWarehouse(shopSlotParent)) {
    errors.push('Sayla shop slot is attached to storage that normalizeLocationDefinition replaces at runtime');
  }
  const rawSlots = caravanObjects.flatMap(row => Array.isArray(row?.activitySlots) ? row.activitySlots : []);
  if (new Set(rawSlots.map(slot => String(slot?.id || ''))).size !== rawSlots.length) {
    errors.push('caravanCamp contains duplicate authored activity slot IDs');
  }
  if (slots.some(slot => slot.capacity !== 1)) errors.push('caravanCamp vertical-slice slots must all use capacity 1');
  const ownedSlots = slots.filter(slot => slot.ownerNpcId);
  if (ownedSlots.length !== 1 || ownedSlots[0].id !== 'caravan_sayla_bed') {
    errors.push('only caravan_sayla_bed may be an owned activity slot in caravanCamp');
  }
  const saylaRow = (Array.isArray(caravanCamp.objects) ? caravanCamp.objects : [])
    .find(row => String(row?.id || '') === 'caravan_sayla');
  if (saylaRow?.entity?.npcId !== 'caravan_sayla' || saylaRow?.entity?.routineId !== 'caravan_sayla') {
    errors.push('Sayla authored actor lacks stable npcId/routineId');
  }
  if (saylaRow?.entity?.stationary !== false) {
    errors.push('Sayla must explicitly keep stationary:false so investigate and routine travel can move her');
  }
} catch (error) {
  errors.push(`authored routine/activity slot checks failed: ${error?.message || String(error)}`);
}

cleanupScheduleFixture();

if (errors.length) {
  console.error('NPC schedule check failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`NPC schedules OK: ${friendlyWorkerKinds} worker groups, ${friendlyWorkerTotal} simulated NPCs across ${simulatedSiteCount} generated sites, ${authoredNpcRows} authored NPC rows.`);
}
if (warnings.length) {
  console.log('Warnings:');
  warnings.slice(0, 20).forEach(warning => console.log(`- ${warning}`));
  if (warnings.length > 20) console.log(`- ...and ${warnings.length - 20} more`);
}
