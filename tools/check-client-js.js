const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const partsDir = path.join(root, 'public', 'js', 'game');
const loaderFile = path.join(root, 'public', 'js', 'game-runtime.js');
const partNames = [
  '00_save_generation_drain.js',
  '01_bootstrap_online_save.js',
  '02_renderer_world_map.js',
  '02a_materials_static_models.js',
  '02b_lighting_time.js',
  '02c_map_locations_collision.js',
  '02d_trader_spawn_props.js',
  '02d1_building_blocks_roof_setup.js',
  '02d2_cutaway_geometry_visibility.js',
  '02d3_cutaway_transparency_warmup.js',
  '02d4_roof_visibility_batch.js',
  '02d5_trader_building_interior.js',
  '02e_trader_yard_world_build.js',
  '03_items_inventory_core.js',
  '03a_pipboy_social_world_tasks.js',
  '03b_inventory_actions_ui.js',
  '03c_skills_perks_tooltips.js',
  '03d_item_context_repair_crafting.js',
  '04_player_model_visuals.js',
  '04a_player_model_modern_runtime.js',
  '04b_service_scout_boots_runtime.js',
  '05_multiplayer_core_state.js',
  '05a_remote_actor_equipment.js',
  '05b_remote_player_locomotion.js',
  '05c_multiplayer_socket_room.js',
  '05d_world_containers_security.js',
  '05e_ground_items_world_sync.js',
  '05f_enemy_models_location_flow.js',
  '06a_combat_visual_fx.js',
  '06b_explosions_speech.js',
  '06c_combat_stats_modes.js',
  '06d_combat_damage_shooting.js',
  '06e_combat_targeting_loot_resources.js',
  '07_quantity_confirm_carry.js',
  '07a_storage_window.js',
  '07b_trader_market_state.js',
  '07c_trader_dialogues_quests.js',
  '07d_trader_barter_ui.js',
  '07e_loot_interaction.js',
  '07f_quickbar_drag_slots.js',
  '08_character_creation_save.js',
  '08a_mobile_controls_panels.js',
  '08b_interaction_quick_access.js',
  '08c_hud_edit_windows_touch.js',
  '08d_world_context_targets.js',
  '08e_mobile_player_action_menus.js',
  '08f_input_events_proximity.js',
  '09_update_fog_movement_ai.js',
  '10_global_map_state_logs_config.js',
  '11_global_map_terrain_core.js',
  '11a_global_map_player_models.js',
  '11b_global_map_static_scene_camera.js',
  '11c_global_map_sites_territory.js',
  '11d_global_map_contacts_parties.js',
  '11e_global_map_tasks_dynamic_render.js',
  '12_global_map_canvas_controls.js',
  '12a_global_map_world_status.js',
  '12b_global_map_panel_window.js',
  '12c_global_map_travel_encounters.js',
  '12d_global_map_entry_ambush_controls.js',
  '13_minimap_hud_loop.js'
];
const partFiles = partNames.map(name => path.join(partsDir, name));
const REMOVED_PROCEDURAL_TRADER_BUILDING_FUNCTIONS = [
  'markDisposableTexture',
  'addEllipseShadow',
  'modelScaleForBuildingBlock',
  'modelHasGroundOrigin',
  'createBuildingModelBlock',
  'cacheTraderInteriorWorldPositions',
  'createTraderVisionRoofMaterial',
  'createTraderRoofMaskTexture',
  'createTraderContinuousRoofPanelGeometry',
  'createTraderRoofSquareCells',
  'createTraderVisionRoofGrid',
  'rebuildTraderRoofBatch',
  'inferTraderRoofGridDimensions',
  'createTraderRoofGridBatch',
  'createTraderBuilding'
];

function matchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function namedFunctionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing function ${name}`);
  const paramsOpen = source.indexOf('(', start);
  let paramsDepth = 0;
  let paramsClose = -1;
  for (let index = paramsOpen; index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1;
    else if (source[index] === ')' && --paramsDepth === 0) {
      paramsClose = index;
      break;
    }
  }
  const open = source.indexOf('{', paramsClose);
  const close = matchingBrace(source, open);
  assert(open >= 0 && close > open, `Cannot extract function ${name}`);
  return source.slice(start, close + 1);
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const loader = fs.readFileSync(loaderFile, 'utf8');
new Function(loader);

const missing = partFiles.filter(file => !fs.existsSync(file));
if (missing.length) {
  throw new Error(`Missing client JS part(s): ${missing.join(', ')}`);
}

const jsFiles = fs.readdirSync(partsDir).filter(file => file.endsWith('.js')).sort();
const unlisted = jsFiles.filter(file => !partNames.includes(file));
if (unlisted.length) {
  throw new Error(`Unlisted client JS part(s): ${unlisted.join(', ')}`);
}

for (const file of partNames) {
  if (!loader.includes(`/js/game/${file}`)) {
    throw new Error(`Client JS loader does not include: ${file}`);
  }
}

const combined = partFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
new Function(combined);

const returnedProceduralTraderBuildingFunctions = REMOVED_PROCEDURAL_TRADER_BUILDING_FUNCTIONS
  .filter(name => combined.includes(`function ${name}(`));
assert.deepStrictEqual(
  returnedProceduralTraderBuildingFunctions,
  [],
  `Removed procedural trader-building function(s) returned: ${returnedProceduralTraderBuildingFunctions.join(', ')}`
);

const buildWorldSource = namedFunctionSource(combined, 'buildWorld');
for (const snippet of [
  'const authoredLayout = locationUsesAuthoredLayout(currentLocation);',
  'createAuthoredLocationObjects();',
  'if (!authoredLayout) createWorldSetDressing();',
  'freezeStaticWorldTransforms();'
]) {
  assert(
    buildWorldSource.includes(snippet),
    `Current authored world build path is missing: ${snippet}`
  );
}
const authoredObjectsSource = namedFunctionSource(combined, 'createAuthoredLocationObjects');
for (const snippet of [
  'if (!locationUsesAuthoredLayout(currentLocation)) return false;',
  'queueAuthoredModuleBatch(moduleBatches, row, key);',
  'flushAuthoredModuleBatches(moduleBatches);'
]) {
  assert(
    authoredObjectsSource.includes(snippet),
    `Current authored object renderer is missing: ${snippet}`
  );
}

const topLevelFunctionDeclarations = [];
for (const file of partFiles.slice(1)) {
  const relative = path.relative(root, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(?: {2})?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (!match) continue;
    topLevelFunctionDeclarations.push({
      name: match[1],
      file: relative,
      line: index + 1
    });
  }
}
const duplicateTopLevelFunctions = [...new Set(
  topLevelFunctionDeclarations
    .filter((entry, index, rows) => rows.findIndex(candidate => candidate.name === entry.name) !== index)
    .map(entry => entry.name)
)].sort();
assert.deepStrictEqual(
  duplicateTopLevelFunctions,
  [],
  `Duplicate top-level client function declaration(s): ${
    duplicateTopLevelFunctions.map(name => {
      const locations = topLevelFunctionDeclarations
        .filter(entry => entry.name === name)
        .map(entry => `${entry.file}:${entry.line}`)
        .join(', ');
      return `${name} (${locations})`;
    }).join('; ')
  }`
);

const nativeDialogCallPattern = /\b(?:window\s*\.\s*)?(?:confirm|alert|prompt)\s*\(/g;
const publicUiFiles = walkFiles(publicDir)
  .filter(file => /\.(?:html|js)$/i.test(file))
  .filter(file => !file.includes(`${path.sep}vendor${path.sep}`));
for (const file of publicUiFiles) {
  const source = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = nativeDialogCallPattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length;
    const relative = path.relative(root, file);
    throw new Error(`Native browser dialog call is not allowed in client UI: ${relative}:${line}`);
  }
}

async function checkSaveGenerationDrain() {
  const { createSaveGenerationDrain } = require(path.join(partsDir, '00_save_generation_drain.js'));
  const bootstrapSource = fs.readFileSync(path.join(partsDir, '01_bootstrap_online_save.js'), 'utf8');

  let currentValue = 'first';
  let releaseFirst = null;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const captures = [];
  const starts = [];
  const commitDirtyStates = [];
  let active = 0;
  let maxActive = 0;
  let latestDirty = true;
  let drain = null;
  drain = createSaveGenerationDrain({
    capture(generation) {
      const job = { generation, value: currentValue };
      captures.push(job);
      return job;
    },
    async persist(job) {
      starts.push({ ...job });
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (starts.length === 1) await firstGate;
      active -= 1;
      return { ok: true };
    },
    onCommit({ generation }) {
      if (drain.snapshot().requestedGeneration === generation) latestDirty = false;
      commitDirtyStates.push(latestDirty);
    }
  });

  assert.strictEqual(drain.markDirty(), 1);
  const firstRun = drain.drain();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(starts.length, 1, 'first save must start exactly once');

  currentValue = 'second';
  assert.strictEqual(drain.markDirty(), 2);
  currentValue = 'latest';
  assert.strictEqual(drain.markDirty(), 3);
  const joinedRun = drain.drain();
  assert.strictEqual(joinedRun, firstRun, 'parallel callers must join the same in-flight drain');
  assert.strictEqual(starts.length, 1, 'pending generations must not start a parallel request');

  releaseFirst();
  assert.strictEqual(await firstRun, true);
  assert.strictEqual(maxActive, 1, 'save drain must keep at most one persistence request active');
  assert.deepStrictEqual(captures, [
    { generation: 1, value: 'first' },
    { generation: 3, value: 'latest' }
  ], 'pending saves must coalesce into one freshly captured latest generation');
  assert.deepStrictEqual(starts, captures, 'captured jobs must be immutable for each request');
  assert.deepStrictEqual(
    commitDirtyStates,
    [true, false],
    'an older completion must not clear dirty before the latest generation commits'
  );
  assert.deepStrictEqual(drain.snapshot(), {
    requestedGeneration: 3,
    committedGeneration: 3,
    running: false,
    dirty: false,
    lastError: null
  });

  let attempts = 0;
  const retryDrain = createSaveGenerationDrain({
    capture: generation => ({ generation }),
    persist: async () => {
      attempts += 1;
      return attempts === 1 ? { ok: false, error: 'temporary failure' } : { ok: true };
    }
  });
  retryDrain.markDirty();
  assert.strictEqual(await retryDrain.drain(), false);
  assert.strictEqual(attempts, 1, 'failed save must not hot-loop');
  await Promise.resolve();
  assert.strictEqual(attempts, 1, 'failed save must wait for an explicit retry');
  assert.strictEqual(retryDrain.snapshot().dirty, true, 'failed generation must remain dirty');
  assert.strictEqual(await retryDrain.drain(), true);
  assert.strictEqual(attempts, 2, 'a later drain must retry the dirty generation once');
  assert.strictEqual(retryDrain.snapshot().dirty, false);

  let staleContextAttempts = 0;
  const staleContextDrain = createSaveGenerationDrain({
    capture: generation => ({ generation }),
    persist: async () => {
      staleContextAttempts += 1;
      return staleContextAttempts === 1
        ? { ok: false, contextCurrent: false, staleContext: true }
        : { ok: true, contextCurrent: true };
    }
  });
  staleContextDrain.markDirty();
  assert.strictEqual(await staleContextDrain.drain(), false);
  assert.strictEqual(
    staleContextDrain.snapshot().dirty,
    true,
    'an obsolete response must keep the generation dirty for a later new-context capture'
  );
  assert.strictEqual(await staleContextDrain.drain(), true);
  assert.strictEqual(staleContextAttempts, 2);
  assert.strictEqual(staleContextDrain.snapshot().dirty, false);

  const contextRuntime = new Function([
    'let clientSaveContextEpoch = 7;',
    'const serverSession = { token: "token-a" };',
    'let selectedServerCharacterId = "char-a";',
    'let activeCharacterLeaseId = "lease-a";',
    'let characterProfile = { serverCharacterId: "char-a" };',
    'let clientInstanceId = "tab-a";',
    'function getClientInstanceId() { return clientInstanceId; }',
    namedFunctionSource(bootstrapSource, 'currentClientSaveContext'),
    namedFunctionSource(bootstrapSource, 'clientSaveContextMatches'),
    'return {',
    '  capture: currentClientSaveContext, matches: clientSaveContextMatches,',
    '  setEpoch: value => { clientSaveContextEpoch = value; },',
    '  setToken: value => { serverSession.token = value; },',
    '  setSelected: value => { selectedServerCharacterId = value; },',
    '  setProfile: value => { characterProfile.serverCharacterId = value; },',
    '  setLease: value => { activeCharacterLeaseId = value; },',
    '  setClient: value => { clientInstanceId = value; }',
    '};'
  ].join('\n'))();
  const contextA = contextRuntime.capture();
  assert.strictEqual(contextRuntime.matches(contextA), true, 'fresh save context must match itself');
  for (const [label, mutate, restore] of [
    ['epoch', () => contextRuntime.setEpoch(8), () => contextRuntime.setEpoch(7)],
    ['token', () => contextRuntime.setToken('token-b'), () => contextRuntime.setToken('token-a')],
    ['selected character', () => contextRuntime.setSelected('char-b'), () => contextRuntime.setSelected('char-a')],
    ['profile character', () => contextRuntime.setProfile('char-b'), () => contextRuntime.setProfile('char-a')],
    ['lease', () => contextRuntime.setLease('lease-b'), () => contextRuntime.setLease('lease-a')],
    ['client instance', () => contextRuntime.setClient('tab-b'), () => contextRuntime.setClient('tab-a')]
  ]) {
    mutate();
    assert.strictEqual(contextRuntime.matches(contextA), false, `stale ${label} context was accepted`);
    restore();
    assert.strictEqual(contextRuntime.matches(contextA), true, `${label} context restore did not recover`);
  }

  let releaseContextA = null;
  const contextGate = new Promise(resolve => { releaseContextA = resolve; });
  const contextCaptures = [];
  const contextCommits = [];
  let contextPersistAttempts = 0;
  const guardedDrain = createSaveGenerationDrain({
    capture(generation) {
      const job = { generation, context: contextRuntime.capture() };
      contextCaptures.push(job);
      return job;
    },
    async persist(job) {
      contextPersistAttempts += 1;
      if (contextPersistAttempts === 1) await contextGate;
      return { ok: contextRuntime.matches(job.context) };
    },
    onCommit({ generation }) {
      contextCommits.push(generation);
    }
  });
  guardedDrain.markDirty();
  const contextRunA = guardedDrain.drain();
  await Promise.resolve();
  await Promise.resolve();
  contextRuntime.setEpoch(8);
  contextRuntime.setToken('token-b');
  contextRuntime.setSelected('char-b');
  contextRuntime.setProfile('char-b');
  contextRuntime.setLease('lease-b');
  contextRuntime.setClient('tab-b');
  guardedDrain.markDirty();
  releaseContextA();
  assert.strictEqual(await contextRunA, false,
    'an obsolete in-flight context must not commit after account/character switch');
  assert.deepStrictEqual(contextCommits, [], 'obsolete context unexpectedly committed');
  assert.strictEqual(guardedDrain.snapshot().dirty, true,
    'obsolete context completion must leave the latest generation dirty');
  assert.strictEqual(await guardedDrain.drain(), true,
    'a bounded retry must capture and persist the new context');
  assert.deepStrictEqual(contextCommits, [2]);
  assert.deepStrictEqual(
    contextCaptures.map(job => [job.generation, job.context.token, job.context.characterId, job.context.leaseId, job.context.clientInstanceId]),
    [
      [1, 'token-a', 'char-a', 'lease-a', 'tab-a'],
      [2, 'token-b', 'char-b', 'lease-b', 'tab-b']
    ],
    'retry did not capture the latest save context'
  );

  let continuousProducer = true;
  let boundedPersistAttempts = 0;
  let boundedDrain = null;
  boundedDrain = createSaveGenerationDrain({
    capture(generation) {
      return { generation };
    },
    async persist() {
      boundedPersistAttempts += 1;
      if (continuousProducer) boundedDrain.markDirty();
      return { ok: true };
    }
  });
  boundedDrain.markDirty();
  assert.strictEqual(await boundedDrain.drain(), false,
    'a continuously dirty producer must leave a later generation for the scheduler');
  assert.strictEqual(boundedPersistAttempts, 2,
    'one drain must perform at most two persistence passes under continuous mutation');
  assert.strictEqual(boundedDrain.snapshot().dirty, true);
  continuousProducer = false;
  assert.strictEqual(await boundedDrain.drain(), true,
    'the next bounded drain must commit once the producer becomes quiet');
  assert.strictEqual(boundedPersistAttempts, 3);

  [
    'clientSaveContextMatches(job.context)',
    'saveGeneration: generation',
    "confirmClientSaveBeforeContextTransition('logout')",
    "confirmClientSaveBeforeContextTransition('switch')",
    'Leaderboards are best-effort metadata',
    'if (clientSaveDrain.isRunning()) return;'
  ].forEach(marker => {
    assert.ok(combined.includes(marker), `client save integration missing marker: ${marker}`);
  });
}

async function checkContextTransitionAbort() {
  const bootstrapSource = fs.readFileSync(path.join(partsDir, '01_bootstrap_online_save.js'), 'utf8');
  const mobilePanelsSource = fs.readFileSync(path.join(partsDir, '08a_mobile_controls_panels.js'), 'utf8');
  const confirmSource = `async ${namedFunctionSource(bootstrapSource, 'confirmClientSaveBeforeContextTransition')}`;
  const confirmRuntime = new Function([
    'let characterProfile = { serverCharacterId: "char-a" };',
    'let clientContextTransitionInFlight = false;',
    'let saveCalls = 0;',
    'let inputClears = 0;',
    'const notices = [];',
    'async function saveGame() { saveCalls += 1; return false; }',
    'function clearAllGameplayInput() { inputClears += 1; }',
    'function setReadout(value) { notices.push(value); }',
    'function setOnlineStatus(value) { notices.push(value); }',
    'function setServerAuthStatus(value) { notices.push(value); }',
    'function setCharacterSelectStatus(value) { notices.push(value); }',
    confirmSource,
    'return {',
    '  confirmClientSaveBeforeContextTransition, notices,',
    '  saveCalls: () => saveCalls, inputClears: () => inputClears,',
    '  transitionPending: () => clientContextTransitionInFlight',
    '};'
  ].join('\n'))();
  assert.strictEqual(await confirmRuntime.confirmClientSaveBeforeContextTransition('logout'), false,
    'logout transition must reject an unconfirmed final save');
  assert.strictEqual(await confirmRuntime.confirmClientSaveBeforeContextTransition('switch'), false,
    'character switch must reject an unconfirmed final save');
  assert.strictEqual(confirmRuntime.saveCalls(), 2);
  assert.strictEqual(confirmRuntime.inputClears(), 2);
  assert.strictEqual(confirmRuntime.transitionPending(), false,
    'a failed transition save must resume the current gameplay context');
  assert(confirmRuntime.notices.some(value => /Выход отменён/.test(value)));
  assert(confirmRuntime.notices.some(value => /Смена персонажа отменена/.test(value)));

  const logoutSource = `async ${namedFunctionSource(bootstrapSource, 'serverLogout')}`;
  const logoutRuntime = new Function([
    'let characterDeletePendingId = "";',
    'let disconnects = 0;',
    'let logoutRequests = 0;',
    'const multiplayer = { socket: { disconnect() { disconnects += 1; } } };',
    'async function confirmClientSaveBeforeContextTransition() { return false; }',
    'async function serverApi() { logoutRequests += 1; }',
    'function setCharacterSelectStatus() {}',
    logoutSource,
    'return { serverLogout, disconnects: () => disconnects, logoutRequests: () => logoutRequests };'
  ].join('\n'))();
  assert.strictEqual(await logoutRuntime.serverLogout(), false);
  assert.strictEqual(logoutRuntime.disconnects(), 0,
    'failed final save must abort before disconnecting the active session');
  assert.strictEqual(logoutRuntime.logoutRequests(), 0,
    'failed final save must abort before revoking the active session');

  const switchSource = `async ${namedFunctionSource(mobilePanelsSource, 'switchCharacterFromMenu')}`;
  const switchRuntime = new Function([
    'let disconnects = 0;',
    'let uiUpdates = 0;',
    'const multiplayer = { socket: { disconnect() { disconnects += 1; } } };',
    'function closeGameMenu() {}',
    'function closeTutorialWindow() {}',
    'async function confirmClientSaveBeforeContextTransition() { return false; }',
    'function updateMobilePanelState() { uiUpdates += 1; }',
    switchSource,
    'return { switchCharacterFromMenu, disconnects: () => disconnects, uiUpdates: () => uiUpdates };'
  ].join('\n'))();
  assert.strictEqual(await switchRuntime.switchCharacterFromMenu(), false);
  assert.strictEqual(switchRuntime.disconnects(), 0,
    'failed final save must abort before switching away from the active character');
  assert.strictEqual(switchRuntime.uiUpdates(), 1);
}

async function checkCharacterSelectionSingleFlight() {
  const bootstrapSource = fs.readFileSync(path.join(partsDir, '01_bootstrap_online_save.js'), 'utf8');
  const selectionSource = `async ${namedFunctionSource(bootstrapSource, 'selectServerCharacter')}`;
  const runtime = new Function([
    'let characterDeletePendingId = "";',
    'const serverSession = { token: "token-a" };',
    'let characterSelectionInFlight = false;',
    'let characterSelectionEpoch = 0;',
    'const console = { warn() {} };',
    'const requests = [];',
    'const statuses = [];',
    'let renders = 0;',
    'async function serverApi(path) {',
    '  return await new Promise(resolve => { requests.push({ path, resolve }); });',
    '}',
    'function setCharacterSelectStatus(value) { statuses.push(value); }',
    'function setAuthStep() {}',
    'function setServerAuthStatus() {}',
    'function renderCharacterSelect() { renders += 1; }',
    selectionSource,
    'return {',
    '  selectServerCharacter, requests, statuses, renders: () => renders,',
    '  inFlight: () => characterSelectionInFlight,',
    '  cancelForSessionChange: () => {',
    '    serverSession.token = "token-b";',
    '    characterSelectionEpoch += 1;',
    '    characterSelectionInFlight = false;',
    '  }',
    '};'
  ].join('\n'))();

  const first = runtime.selectServerCharacter('char-a');
  const duplicate = runtime.selectServerCharacter('char-b');
  assert.strictEqual(runtime.requests.length, 1,
    'two rapid character choices must share a single in-flight load');
  assert(runtime.statuses.some(value => /Дождитесь завершения загрузки/.test(value)));
  runtime.requests[0].resolve({});
  await Promise.all([first, duplicate]);
  assert.strictEqual(runtime.inFlight(), false);

  const stale = runtime.selectServerCharacter('char-a');
  assert.strictEqual(runtime.requests.length, 2);
  runtime.cancelForSessionChange();
  runtime.requests[1].resolve({ save: { characterProfile: { name: 'stale' } } });
  await stale;
  assert.strictEqual(runtime.inFlight(), false,
    'a token change must invalidate an outstanding character load');
}

function checkSessionInvalidationPolicy() {
  const bootstrapSource = fs.readFileSync(path.join(partsDir, '01_bootstrap_online_save.js'), 'utf8');
  const sessionSource = namedFunctionSource(bootstrapSource, 'setServerSession');
  const makeRuntime = started => new Function([
    'const serverSession = { token: "token-a", login: "tester" };',
    `let gameStarted = ${started ? 'true' : 'false'};`,
    'let serverSaveAvailable = true;',
    'let characterSelectionEpoch = 4;',
    'let characterSelectionInFlight = true;',
    'let serverCharacters = [{ id: "char-a" }];',
    'let selectedServerCharacterId = "char-a";',
    'let saveEpochAdvances = 0;',
    'let invalidations = 0;',
    'const authorityModes = [];',
    'const removed = [];',
    'const multiplayer = { onlineSessionRequired: true };',
    'const localStorage = {',
    '  setItem() {},',
    '  removeItem(key) { removed.push(key); }',
    '};',
    'const SERVER_TOKEN_KEY = "token-key";',
    'const SERVER_LOGIN_KEY = "login-key";',
    'const SERVER_CHARACTER_KEY = "character-key";',
    'function advanceClientSaveContextEpoch() { saveEpochAdvances += 1; }',
    'function invalidateMultiplayerSessionContext() { invalidations += 1; }',
    'function setSelectedServerCharacterForSaveContext(value) { selectedServerCharacterId = value; }',
    'function updateServerAuthUI() {}',
    'function clientWorldRequiresServer() { return !!serverSession.token || multiplayer.onlineSessionRequired; }',
    'function setClientAuthorityMode(mode) { authorityModes.push(mode); }',
    sessionSource,
    'return {',
    '  clear: () => setServerSession("", ""),',
    '  serverSession, multiplayer, authorityModes, removed,',
    '  state: () => ({ characterSelectionEpoch, characterSelectionInFlight, selectedServerCharacterId, saveEpochAdvances, invalidations })',
    '};'
  ].join('\n'))();

  const online = makeRuntime(true);
  online.clear();
  assert.strictEqual(online.multiplayer.onlineSessionRequired, true,
    '401 during a running online world must keep the sticky server requirement');
  assert.strictEqual(online.authorityModes.at(-1), 'blocked');
  assert.deepStrictEqual(online.state(), {
    characterSelectionEpoch: 5,
    characterSelectionInFlight: false,
    selectedServerCharacterId: '',
    saveEpochAdvances: 1,
    invalidations: 1
  });

  const idle = makeRuntime(false);
  idle.clear();
  assert.strictEqual(idle.multiplayer.onlineSessionRequired, false,
    'clearing an idle login must release the server-world requirement');
  assert.strictEqual(idle.authorityModes.at(-1), 'offline-local');
}

Promise.all([
  checkSaveGenerationDrain(),
  checkContextTransitionAbort(),
  checkCharacterSelectionSingleFlight(),
  checkSessionInvalidationPolicy()
])
  .then(() => {
    console.log('Client JS loader syntax OK:', loaderFile);
    console.log('Client JS reconstructed bundle syntax OK:', partFiles.length, 'parts');
    console.log('Client JS top-level function names are unique');
    console.log('Client authored-location renderer guard OK');
    console.log('Client JS native dialog guard OK');
    console.log('Client save generation drain OK');
    console.log('Client save transition abort policy OK');
    console.log('Client character selection single-flight OK');
    console.log('Client session invalidation policy OK');
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
