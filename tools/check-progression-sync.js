const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

const REMOVED_PERK_LAYOUT_FUNCTIONS = [
  'perkSubgroupIndex',
  'perkSubgroupCount',
  'perkLevelRing',
  'perkNodeRadius',
  'perkPolarPoint',
  'perkAtlasEnabled',
  'perkAtlasRowIndex',
  'perkAtlasRowY',
  'perkAtlasNodePoint',
  'perkGroupHubPoint',
  'emptyPerkLaneBounds',
  'collectPerkLaneBounds',
  'perkBranchLabelPoint',
  'perkSideLabelPoint',
  'perkPrerequisiteEntry',
  'assignPerkHubPorts',
  'perkRadialLinkPath',
  'perkDependencyPath',
  'perkIndependentPath',
  'perkNodeDesiredPoint',
  'clampPerkPoint',
  'resolvePerkLayoutCollisions',
  'perkWheelInfoHtml',
  'totalPerkRanks'
];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function fail(message) {
  throw new Error(message);
}

function evalConstBlock(source, marker, constName, endToken) {
  const start = source.indexOf(marker);
  if (start < 0) fail(`Missing block: ${marker}`);
  const end = source.indexOf(endToken, start);
  if (end < 0) fail(`Unclosed block: ${marker}`);
  const block = source.slice(start, end + endToken.length).replace(`const ${constName}`, `var ${constName}`);
  const sandbox = {};
  vm.runInNewContext(block, sandbox);
  return sandbox[constName];
}

function idsInArrayBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) fail(`Missing array marker: ${marker}`);
  const end = source.indexOf('];', start);
  if (end < 0) fail(`Unclosed array marker: ${marker}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function idsInServerSet(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) fail(`Missing server set marker: ${marker}`);
  const end = source.indexOf(');', start);
  if (end < 0) fail(`Unclosed server set marker: ${marker}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function talentMaxRanks(source) {
  const start = source.indexOf('const TALENTS = [');
  if (start < 0) fail('Missing TALENTS block');
  const end = source.indexOf('];', start);
  if (end < 0) fail('Unclosed TALENTS block');
  const block = source.slice(start, end);
  return Object.fromEntries([...block.matchAll(/\{\s*id:\s*['"]([^'"]+)['"][\s\S]*?\bmax:\s*(\d+)/g)].map(match => [match[1], Number(match[2])]));
}

function serverTalentMaxRanks(source) {
  const start = source.indexOf('const SERVER_TALENT_MAX_RANKS = {');
  if (start < 0) fail('Missing SERVER_TALENT_MAX_RANKS block');
  const end = source.indexOf('};', start);
  if (end < 0) fail('Unclosed SERVER_TALENT_MAX_RANKS block');
  const block = source.slice(start, end);
  return Object.fromEntries([...block.matchAll(/\b([a-zA-Z0-9_]+):\s*(\d+)/g)].map(match => [match[1], Number(match[2])]));
}

function functionSlice(source, marker, nextMarker = '\n  function ') {
  const start = source.indexOf(marker);
  if (start < 0) fail(`Missing function marker: ${marker}`);
  const end = source.indexOf(nextMarker, start + marker.length);
  if (end < 0) fail(`Cannot find end of function marker: ${marker}`);
  return source.slice(start, end);
}

function socketEventSlice(source, eventName) {
  const marker = `socket.on('${eventName}'`;
  const start = source.indexOf(marker);
  if (start < 0) fail(`Missing socket event: ${eventName}`);
  const end = source.indexOf('\n  socket.on(', start + marker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function assertEmitCarries(source, eventName, requiredSnippets) {
  let count = 0;
  const markers = [
    `socket.emit('${eventName}'`,
    `emitGuardedMultiplayerGameplayAction('${eventName}'`
  ];
  for (const marker of markers) {
    let index = 0;
    while ((index = source.indexOf(marker, index)) >= 0) {
      const end = source.indexOf('}, ack =>', index);
      if (end < 0) fail(`Cannot find ack payload end for emit: ${eventName}`);
      const block = source.slice(index, end);
      for (const snippet of requiredSnippets) {
        if (!block.includes(snippet)) fail(`${eventName} emit missing required progression payload: ${snippet}`);
      }
      count += 1;
      index = end + 1;
    }
  }
  if (!count) fail(`Missing socket emit: ${eventName}`);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortedDiff(left, right) {
  const rightSet = new Set(right);
  return left.filter(id => !rightSet.has(id)).sort();
}

function assertSameIds(label, clientIds, serverIds) {
  const onlyClient = sortedDiff(clientIds, serverIds);
  const onlyServer = sortedDiff(serverIds, clientIds);
  if (onlyClient.length || onlyServer.length) {
    const details = [
      onlyClient.length ? `only client: ${onlyClient.join(', ')}` : '',
      onlyServer.length ? `only server: ${onlyServer.join(', ')}` : ''
    ].filter(Boolean).join('; ');
    fail(`${label} ID mismatch: ${details}`);
  }
}

function assertNoDuplicates(label, ids) {
  const seen = new Set();
  const dupes = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  if (dupes.length) fail(`${label} duplicate ID(s): ${[...new Set(dupes)].join(', ')}`);
}

function assertIncludesAll(label, source, snippets) {
  const missing = snippets.filter(snippet => !source.includes(snippet));
  if (missing.length) fail(`${label} missing required snippet(s): ${missing.join(' | ')}`);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const model = read(path.join('public', 'js', 'game', '04_player_model_visuals.js'));
const creator = [
  '08_character_creation_save.js',
  '08a_mobile_controls_panels.js',
  '08b_interaction_quick_access.js',
  '08c_hud_edit_windows_touch.js',
  '08d_world_context_targets.js',
  '08e_mobile_player_action_menus.js',
  '08f_input_events_proximity.js'
].map(name => read(path.join('public', 'js', 'game', name))).join('\n');
const crafting = [
  '03_items_inventory_core.js',
  '03a_pipboy_social_world_tasks.js',
  '03b_inventory_actions_ui.js',
  '03c_skills_perks_tooltips.js',
  '03d_item_context_repair_crafting.js'
].map(name => read(path.join('public', 'js', 'game', name))).join('\n');
const combat = [
  '06a_combat_visual_fx.js',
  '06b_explosions_speech.js',
  '06c_combat_stats_modes.js',
  '06d_combat_damage_shooting.js',
  '06e_combat_targeting_loot_resources.js'
].map(name => read(path.join('public', 'js', 'game', name))).join('\n');
const network = [
  '05_multiplayer_core_state.js',
  '05a_remote_actor_equipment.js',
  '05b_remote_player_locomotion.js',
  '05c_multiplayer_socket_room.js',
  '05d_world_containers_security.js',
  '05e_ground_items_world_sync.js',
  '05f_enemy_models_location_flow.js'
].map(name => read(path.join('public', 'js', 'game', name))).join('\n');
const windows = [
  '07_quantity_confirm_carry.js',
  '07a_storage_window.js',
  '07b_trader_market_state.js',
  '07c_trader_dialogues_quests.js',
  '07d_trader_barter_ui.js',
  '07e_loot_interaction.js',
  '07f_quickbar_drag_slots.js'
].map(name => read(path.join('public', 'js', 'game', name))).join('\n');
const mapLoop = [
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
].map(name => read(path.join('public', 'js', 'game', name))).join('\n');
const server = read('server.js');
const locationEditor = read(path.join('public', 'dev-location-editor.html'));
const globalMapEditor = read(path.join('public', 'dev-global-map-editor.html'));
const gameMechanicsSource = fs.readdirSync(path.join(root, 'public', 'js', 'game'))
  .filter(name => name.endsWith('.js'))
  .sort()
  .map(name => read(path.join('public', 'js', 'game', name)))
  .join('\n');

const clientSkills = idsInArrayBlock(model, 'const SKILLS = [');
const clientTalents = idsInArrayBlock(model, 'const TALENTS = [');
const clientTraits = idsInArrayBlock(creator, 'const START_TRAITS = [');
const recipeIds = idsInArrayBlock(crafting, 'const CRAFT_RECIPES = [');
const clientTalentDefs = evalConstBlock(model, 'const TALENTS = [', 'TALENTS', '];');

const returnedPerkLayoutFunctions = REMOVED_PERK_LAYOUT_FUNCTIONS.filter(name => crafting.includes(`function ${name}(`));
if (returnedPerkLayoutFunctions.length) {
  fail(`Removed perk-layout function(s) returned: ${returnedPerkLayoutFunctions.join(', ')}`);
}
const perkBoardBody = functionSlice(crafting, 'function renderPerkWheel');
assertIncludesAll('Current perk board renderer', perkBoardBody, [
  "wheel.className = 'perk-wheel perk-board'",
  "wrap.classList.add('perk-board-wrap')",
  'const categories = perkCategoryOptions()',
  'let visibleTalents = visiblePerksForBoard(selectedPerkCategory)',
  "shell.className = 'perk-board-shell'",
  'renderPerkDetail('
]);

const serverSkills = idsInServerSet(server, 'const SERVER_SKILL_IDS');
const serverTalents = idsInServerSet(server, 'const SERVER_TALENT_IDS');
const serverTraits = idsInServerSet(server, 'const SERVER_START_TRAITS');
const clientTalentMax = talentMaxRanks(model);
const serverTalentMax = serverTalentMaxRanks(server);
const serverTalentReqs = evalConstBlock(server, 'const SERVER_TALENT_REQUIREMENTS = {', 'SERVER_TALENT_REQUIREMENTS', '};');

assertNoDuplicates('Client skill', clientSkills);
assertNoDuplicates('Client talent', clientTalents);
assertNoDuplicates('Client start trait', clientTraits);
assertNoDuplicates('Recipe', recipeIds);
assertNoDuplicates('Server skill', serverSkills);
assertNoDuplicates('Server talent', serverTalents);
assertNoDuplicates('Server start trait', serverTraits);

assertSameIds('Skill', clientSkills, serverSkills);
assertSameIds('Talent', clientTalents, serverTalents);
assertSameIds('Start trait', clientTraits, serverTraits);

const forbiddenTalents = [
  { id: 'tracker', name: 'Следопыт' },
  { id: 'quietStep', name: 'Тихий шаг' },
  { id: 'silentStep', name: 'Тихий шаг' },
  { id: 'deal', name: 'Сделка' },
  { id: 'dealMaker', name: 'Сделка' },
  { id: 'bargain', name: 'Сделка' }
];
const forbiddenFound = clientTalentDefs.filter(talent => forbiddenTalents.some(forbidden => talent.id === forbidden.id || talent.name === forbidden.name));
if (forbiddenFound.length) fail(`Forbidden talent(s) present: ${forbiddenFound.map(talent => `${talent.id}/${talent.name}`).join(', ')}`);

const vagueTalentDescriptions = clientTalentDefs.filter(talent => /примерн|около/i.test(String(talent.desc || '')));
if (vagueTalentDescriptions.length) {
  fail(`Talent description(s) must use exact effects instead of vague wording: ${vagueTalentDescriptions.map(talent => talent.id).join(', ')}`);
}
const nonNumericTalentDescriptions = clientTalentDefs.filter(talent => {
  const desc = String(talent.desc || '');
  return !(/[0-9%×]/.test(desc) || desc.includes('п.п.') || desc.includes('max') || desc.includes('min') || desc.includes('floor'));
});
if (nonNumericTalentDescriptions.length) {
  fail(`Talent description(s) must include exact numeric/formula effect markers: ${nonNumericTalentDescriptions.map(talent => talent.id).join(', ')}`);
}

for (const id of clientTalents) {
  if (clientTalentMax[id] !== serverTalentMax[id]) {
    fail(`Talent max rank mismatch for ${id}: client ${clientTalentMax[id]}, server ${serverTalentMax[id]}`);
  }
}

const clientTalentReqs = Object.fromEntries(clientTalentDefs.map(talent => [talent.id, talent.req || {}]));
for (const id of clientTalents) {
  const clientReq = stableStringify(clientTalentReqs[id] || {});
  const serverReq = stableStringify(serverTalentReqs[id] || {});
  if (clientReq !== serverReq) fail(`Talent requirement mismatch for ${id}: client ${clientReq}, server ${serverReq}`);
}

const recipeIdSet = new Set(recipeIds);
const outputQtyBody = functionSlice(model, 'function skillOutputQty');
const referencedRecipeIds = [...outputQtyBody.matchAll(/recipe\.id\s*={2,3}\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
const missingRecipeIds = referencedRecipeIds.filter(id => !recipeIdSet.has(id));
if (missingRecipeIds.length) {
  fail(`skillOutputQty references missing recipe ID(s): ${[...new Set(missingRecipeIds)].join(', ')}`);
}

const skillFormulaBody = functionSlice(crafting, 'function skillFormulaText');
assertIncludesAll('Skill formula text', skillFormulaBody, [
  'состояние<70 −0.25 п.п.×(70−состояние)',
  'движение −3.5 п.п.',
  'инфекция −3 п.п.',
  'контузия −10 п.п.',
  'перелом руки −12 п.п.',
  'Риск сбоя = clamp 1–36%',
  'авто +4 п.п.',
  'clamp 3–92%',
  'clamp 1–95 HP',
  'база 9 сек. для замка или 11 сек. для терминала',
  'не выше 100 состояния',
  'max(0, ХР−5)',
  'Техпроверка Клима = clamp 8–94%',
  'бонус договорённости',
  'у врагов балл также повышает патроны +12 п.п.'
]);
const skillFormulaIds = [...skillFormulaBody.matchAll(/id\s*={2,3}\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
const missingSkillFormulas = clientSkills.filter(id => !skillFormulaIds.includes(id));
if (missingSkillFormulas.length) fail(`Missing skill formula text for: ${missingSkillFormulas.join(', ')}`);

const missingSkillMechanics = clientSkills.filter(id => {
  const directSkillCall = new RegExp(`\\b(?:skill(?:Norm|Percent)|serverSkill(?:Norm|Percent))\\s*\\([^)]*['"]${escapeRegex(id)}['"]`).test(`${gameMechanicsSource}\n${server}`);
  const weaponSkillBinding = new RegExp(`\\bweaponSkill:\\s*['"]${escapeRegex(id)}['"]`).test(gameMechanicsSource);
  return !directSkillCall && !weaponSkillBinding;
});
if (missingSkillMechanics.length) fail(`Skill(s) without direct mechanics: ${missingSkillMechanics.join(', ')}`);

const talentFormulaBody = functionSlice(crafting, 'function talentFormulaText');
assertIncludesAll('Talent formula text', talentFormulaBody, [
  'замки max(2 ОД',
  'техпроверка Клима +7 п.п.',
  'патроны +12 п.п.',
  'потеря состояния при энергосбое',
  'видимый класс брони +2',
  'шанс разбора брони +5 п.п.'
]);
const talentFormulaIds = [...talentFormulaBody.matchAll(/\b([a-zA-Z0-9_]+):\s*['"`]/g)].map(match => match[1]);
const missingTalentFormulas = clientTalents.filter(id => !talentFormulaIds.includes(id));
if (missingTalentFormulas.length) fail(`Missing talent formula text for: ${missingTalentFormulas.join(', ')}`);

const missingTalentMechanics = clientTalents.filter(id => {
  const directTalentCall = new RegExp(`\\b(?:talentLevel|serverTalentLevel)\\s*\\([^)]*['"]${escapeRegex(id)}['"]`).test(`${gameMechanicsSource}\n${server}`);
  if (directTalentCall) return false;
  if (!id.startsWith('special')) return true;
  return !(crafting.includes('SPECIAL_TALENT_BONUSES') && crafting.includes(`${id}:`) && server.includes('function serverStatValue') && server.includes(`${id}:`));
});
if (missingTalentMechanics.length) fail(`Talent(s) without direct mechanics: ${missingTalentMechanics.join(', ')}`);

const actionProgressionBody = functionSlice(server, 'function serverActionProgressionPlayer', '\nfunction ');
if (!actionProgressionBody.includes('Number(p.level || 1)') || actionProgressionBody.includes('data.level')) {
  fail('Action progression budget must use only the authoritative server player level');
}

const sanitizeSpecialBody = functionSlice(server, 'function sanitizeSpecial', '\nfunction ');
if (!server.includes('const SERVER_SPECIAL_MAX = 10') || !server.includes('const SERVER_SPECIAL_TOTAL = 40') || !sanitizeSpecialBody.includes('SERVER_SPECIAL_TOTAL') || !sanitizeSpecialBody.includes('out[key]--')) {
  fail('Server SPECIAL sanitization must enforce the same base stat max and total budget as character creation');
}
const serverStatValueBody = functionSlice(server, 'function serverStatValue', '\nfunction ');
const serverStatValueWithRanksBody = functionSlice(server, 'function serverStatValueWithTalentRanks', '\nfunction ');
if (!server.includes('const SERVER_SPECIAL_EFFECTIVE_MAX = 15') || !serverStatValueBody.includes('SERVER_SPECIAL_EFFECTIVE_MAX') || !serverStatValueWithRanksBody.includes('SERVER_SPECIAL_EFFECTIVE_MAX')) {
  fail('Server effective SPECIAL must share the client effective stat cap');
}
const serverPlayerMaxHpBody = functionSlice(server, 'function serverPlayerMaxHp', '\nfunction ');
const serverPlayerMaxApBody = functionSlice(server, 'function serverPlayerMaxAp', '\nfunction ');
if (!serverPlayerMaxHpBody.includes("serverStatValue(p, 'end') * 9") || !serverPlayerMaxHpBody.includes('levelBonus') || !serverPlayerMaxHpBody.includes("serverTalentLevel(p, 'toughness') * 12")) {
  fail('Server max HP must be derived from Endurance, level and Toughness');
}
if (!serverPlayerMaxApBody.includes("serverStatValue(p, 'agi') / 2") || serverPlayerMaxApBody.includes('levelBonus') || !serverPlayerMaxApBody.includes("serverTalentLevel(p, 'actionBoy')") || !serverPlayerMaxApBody.includes('99')) {
  fail('Server max AP must be derived from Agility, Action Boy and the AP cap, without level growth');
}
if (!creator.includes('function levelVitalBonus') || !creator.includes('d.maxHp + levelBonus * 12') || creator.includes('Math.min(99, d.maxAp + levelBonus')) {
  fail('Client derived vitals must keep level HP growth but must not grow AP by level');
}

if (!model.includes('function spentSkillPoints') || !model.includes('skillPointsEarnedForLevel') || !model.includes('function enforceClientProgressionBudget')) {
  fail('Client progression must track spent skill steps and earned skill budget');
}
const clientSkillPercentBody = functionSlice(model, 'function skillPercent');
const clientSkillRankFromBody = functionSlice(model, 'function skillRankFrom');
const clientSkillSnapshotBody = functionSlice(model, 'function clientSkillRanksSnapshot');
const clientNormalizeSkillRanksBody = functionSlice(model, 'function normalizeSkillRanks');
if (!clientSkillPercentBody.includes('skillRankFrom(skillRanks, id)')) {
  fail('Client skillPercent must read ranks through the shared skill rank reader');
}
if (!clientSkillRankFromBody.includes('if (!skillDef(id)) return null') || !clientSkillRankFromBody.includes('Number.isFinite(raw)') || !clientSkillRankFromBody.includes('skillBasePercent(id)')) {
  fail('Client skill rank reader must reject unknown/invalid ranks and respect the current base skill');
}
if (!clientSkillSnapshotBody.includes('SKILLS.forEach') || !clientSkillSnapshotBody.includes('pct > skillBasePercent(skill.id)')) {
  fail('Client skill snapshot must serialize only known skills trained above their current base');
}
if (!clientNormalizeSkillRanksBody.includes('knownSkillIds.has(id)')) {
  fail('Client skill migration must drop unknown skill keys while preserving legacy aliases');
}
const clientTalentLevelBody = functionSlice(model, 'function talentLevel');
const clientLearnedTalentCountBody = functionSlice(model, 'function learnedTalentCount');
const clientTalentRankFromBody = functionSlice(model, 'function clientTalentRankFrom');
const clientEnforceProgressionBody = functionSlice(model, 'function enforceClientProgressionBudget');
if (!clientTalentLevelBody.includes('clientTalentRankFrom(talentRanks, id)')) {
  fail('Client talentLevel must clamp ranks through the shared talent rank reader');
}
if (!clientLearnedTalentCountBody.includes('TALENTS.reduce') || !clientLearnedTalentCountBody.includes('clientTalentRankFrom(ranks, talent.id)')) {
  fail('Client learnedTalentCount must count only known, clamped talent ranks');
}
if (!clientTalentRankFromBody.includes('if (!talent) return 0') || !clientTalentRankFromBody.includes('Number.isFinite(raw)') || clientTalentRankFromBody.includes('talent?.max || 5')) {
  fail('Client talent rank reader must reject unknown/invalid ranks instead of granting fallback ranks');
}
if (!clientEnforceProgressionBody.includes('limitedTalentsBeforeSkills') || !clientEnforceProgressionBody.includes('limitClientSkillRanksByBudget') || !clientEnforceProgressionBody.includes('const limitedTalents = limitClientTalentRanksByBudget')) {
  fail('Client progression enforcement must clamp talents before skill budgeting and again after skill budgeting');
}
const serverTalentLevelBody = functionSlice(server, 'function serverTalentLevel', '\nfunction ');
const serverTalentRankFromBody = functionSlice(server, 'function serverTalentRankFrom', '\nfunction ');
const serverEnforceProgressionBody = functionSlice(server, 'function enforceServerProgressionBudget', '\nfunction ');
if (!serverTalentLevelBody.includes('serverTalentRankFrom(p.talentRanks || {}, id)')) {
  fail('Server talentLevel must use the shared clamped talent rank reader');
}
if (!serverTalentRankFromBody.includes('SERVER_TALENT_IDS.has(id)') || !serverTalentRankFromBody.includes('SERVER_TALENT_MAX_RANKS[id]') || !serverTalentRankFromBody.includes('Number.isFinite(raw)')) {
  fail('Server talent rank reader must reject unknown/invalid ranks and respect per-talent max ranks');
}
if (!serverEnforceProgressionBody.includes('const perkBudget = serverPerkBudgetFor(p.level)') || !serverEnforceProgressionBody.includes('p.talentRanks = limitTalentRanksByBudget(p.talentRanks || {}, perkBudget, p)') || !serverEnforceProgressionBody.includes('p.skillRanks = limitSkillRanksByBudget')) {
  fail('Server progression enforcement must clamp talents before skill budgeting and again after skill budgeting');
}
const serverSkillPercentBody = functionSlice(server, 'function serverSkillPercent', '\nfunction ');
const serverSkillRankFromBody = functionSlice(server, 'function serverSkillRankFrom', '\nfunction ');
const serverLimitSkillRanksBody = functionSlice(server, 'function limitSkillRanksByBudget', '\nfunction ');
if (!serverSkillPercentBody.includes('serverSkillRankFrom(p.skillRanks || {}, id, p)')) {
  fail('Server skillPercent must read ranks through the shared skill rank reader');
}
if (!serverSkillRankFromBody.includes('SERVER_SKILL_IDS.has(id)') || !serverSkillRankFromBody.includes('Number.isFinite(raw)') || !serverSkillRankFromBody.includes('serverSkillBasePercent(p, id)')) {
  fail('Server skill rank reader must reject unknown/invalid ranks and respect the current base skill');
}
if (!serverLimitSkillRanksBody.includes('serverSkillRankFrom(ranks, id, p) ?? base')) {
  fail('Server skill budget limiter must use the shared skill rank reader');
}
const carryCapacityBody = functionSlice(crafting, 'function carryCapacity');
if (!carryCapacityBody.includes('effectiveSpecialStats(characterProfile)')) {
  fail('Client carry capacity must use effective SPECIAL, including the Strength perk');
}
const serverCarryCapacityBody = functionSlice(server, 'function serverCarryCapacity', '\nfunction ');
if (!serverCarryCapacityBody.includes("serverStatValue(p, 'str')")) {
  fail('Server carry capacity must use effective Strength, including the Strength perk');
}
if (!creator.includes('enforceClientProgressionBudget(player.level') || !creator.includes('maxFreeSkillPoints') || !creator.includes('spentSkillPoints()') || creator.includes('SKILL_POINTS_PER_LEVEL - learnedSkillCount()')) {
  fail('Save loading must enforce progression budget and cap free skill points by earned budget minus spent skill steps');
}
if (creator.includes('const loot = Math.round((stats.luck - 5)') || creator.includes('Находки: <b>${d.loot')) {
  fail('Character creator must not show Luck as a direct loot percentage without matching mechanics');
}
const serializeBody = functionSlice(creator, 'function serializeGameState');
if (!serializeBody.includes('enforceClientProgressionBudget(player.level') || !serializeBody.includes('skillPointsEarnedForLevel(player.level') || !serializeBody.includes('perksEarnedForLevel(player.level)')) {
  fail('Save serialization must clamp progression ranks and free points before writing state');
}
if (!serializeBody.includes('clientSkillRanksSnapshot()')) {
  fail('Save serialization must write a normalized skill-rank snapshot');
}
const networkSkillSnapshotBody = functionSlice(network, 'function multiplayerSkillSnapshot');
if (!networkSkillSnapshotBody.includes('clientSkillRanksSnapshot()')) {
  fail('Multiplayer progression packets must send a normalized skill-rank snapshot');
}

const combatSnapshotBody = functionSlice(combat, 'function combatResourceSnapshot');
if (!combatSnapshotBody.includes('conditionBefore') || !combatSnapshotBody.includes('conditionAfter')) {
  fail('Combat resource snapshot must include weapon condition so server hit formulas match client hit hints');
}

const enemyHitServerBody = socketEventSlice(server, 'enemyHit');
if (!enemyHitServerBody.includes('syncServerActionProgressionPlayer(p, data)')) {
  fail('enemyHit must sync and budget-limit progression before combat formulas');
}
if (!enemyHitServerBody.includes('data.combat') || !enemyHitServerBody.includes('serverHitChance(p, enemy')) {
  fail('enemyHit must pass combat snapshot data into server hit chance');
}
if (!enemyHitServerBody.includes('serverCombatTargetPoint(enemy, data, weapon)')
  || !enemyHitServerBody.includes('serverLineOfFireClearFrom(room, origin.x, origin.z, targetProxy')
  || !enemyHitServerBody.includes('serverShotgunSpreadSample(weapon, origin, targetProxy')) {
  fail('enemyHit must validate moving NPCs against the bounded client-observed target position');
}
if (!enemyHitServerBody.includes('failureContext') || !enemyHitServerBody.includes('enemy: publicEnemy(enemy)')) {
  fail('enemyHit rejections must return authoritative NPC and combat state for client recovery');
}
if (!enemyHitServerBody.includes('locationAllowsNpcCombat(loc)')) {
  fail('enemyHit must reject NPC attacks in peaceful locations before spending combat resources');
}
const peacefulNpcBlockIndex = enemyHitServerBody.indexOf('locationAllowsNpcCombat(loc)');
const enemyTargetLookupIndex = enemyHitServerBody.indexOf('const enemy = room.enemies.get(enemyId)');
const enemyHitSpendIndex = enemyHitServerBody.indexOf('serverValidateAndSpendAttack');
const enemyHitAggroIndex = enemyHitServerBody.indexOf('setEncounterFactionHostileToPlayer');
if (peacefulNpcBlockIndex < 0
  || (enemyTargetLookupIndex >= 0 && peacefulNpcBlockIndex > enemyTargetLookupIndex)
  || (enemyHitSpendIndex >= 0 && peacefulNpcBlockIndex > enemyHitSpendIndex)
  || (enemyHitAggroIndex >= 0 && peacefulNpcBlockIndex > enemyHitAggroIndex)) {
  fail('enemyHit peaceful-location rejection must run before target lookup, AP/ammo spending, and faction hostility');
}
const serverPvpModeNormalizeBody = functionSlice(server, 'function normalizeLocationPvpMode', '\n\nfunction ');
if (!serverPvpModeNormalizeBody.includes("typeof input === 'boolean'")
  || !serverPvpModeNormalizeBody.includes("'safezone'")
  || serverPvpModeNormalizeBody.includes("'false', 'combat'")) {
  fail('Server location PvP mode normalization must treat safe/no-PvP aliases as peaceful and not treat false as PvP');
}
const npcRobServerBody = socketEventSlice(server, 'robEncounterActor');
if (!npcRobServerBody.includes('locationAllowsNpcCombat(loc)') || npcRobServerBody.indexOf('locationAllowsNpcCombat(loc)') > npcRobServerBody.indexOf('setEncounterFactionHostileToPlayer')) {
  fail('robEncounterActor must reject robbery in peaceful locations before turning NPC factions hostile');
}

['shoot', 'melee'].forEach(eventName => {
  const body = socketEventSlice(server, eventName);
  const blockIndex = body.indexOf('locationAllowsNpcCombat(roomLocation(room))');
  const emitIndex = body.indexOf(`emit('${eventName === 'shoot' ? 'shot' : 'melee'}'`);
  if (blockIndex < 0
    || (emitIndex >= 0 && blockIndex > emitIndex)
    || body.includes('addRoomNoise')) {
    fail(`${eventName} visual combat event must be suppressed in peaceful locations and must not mutate authoritative AI noise`);
  }
});

const combatAttackServerBody = socketEventSlice(server, 'combatAttack');
const combatAttackPeacefulIndex = combatAttackServerBody.indexOf('locationAllowsNpcCombat(loc)');
const combatAttackSpendIndex = combatAttackServerBody.indexOf('serverValidateAndSpendAttack');
const combatAttackNoiseIndex = combatAttackServerBody.indexOf('addRoomNoise');
if (combatAttackPeacefulIndex < 0
  || combatAttackSpendIndex < 0
  || combatAttackPeacefulIndex > combatAttackSpendIndex
  || combatAttackNoiseIndex < combatAttackSpendIndex
  || !combatAttackServerBody.includes('if (!spend.reused)')) {
  fail('combatAttack must reject peaceful use before spending and create AI noise only after a new authoritative spend');
}

const playerHitServerBody = socketEventSlice(server, 'playerHit');
if (!playerHitServerBody.includes('locationAllowsPvp(loc)')) {
  fail('playerHit must reject PvP attacks in peaceful locations before spending combat resources');
}

const syncNpcTradeStateBody = socketEventSlice(server, 'syncNpcTradeState');
if (!syncNpcTradeStateBody.includes('market: serverNpcTradeMarket(actor)')
  || !syncNpcTradeStateBody.includes('readOnly: true')
  || syncNpcTradeStateBody.includes('serverNpcSetInventoryCaps(')
  || syncNpcTradeStateBody.includes('data.inventory')
  || syncNpcTradeStateBody.includes('data.traderStock')) {
  fail('syncNpcTradeState must be a read-only server-authoritative NPC market snapshot');
}

const npcDialogueFocusBody = socketEventSlice(server, 'npcDialogueFocus');
if (!npcDialogueFocusBody.includes('enemy.canDialogue !== false') || !npcDialogueFocusBody.includes('!serverNpcIsNaturalCreature(enemy, enemy)')) {
  fail('npcDialogueFocus must reject non-dialogue natural creatures even when they belong to a friendly faction');
}

const serverNaturalCreatureTextBody = functionSlice(server, 'function serverNaturalCreatureText', '\nfunction ');
if (!serverNaturalCreatureTextBody.includes('opts.equipmentProfile')
  || !serverNaturalCreatureTextBody.includes('opts.lootProfile')
  || !serverNaturalCreatureTextBody.includes('opts.traderProfile')) {
  fail('Natural creature detection must include editor/generated NPC profiles');
}
const serverNaturalCreatureNormalizeBody = functionSlice(server, 'function normalizeServerNaturalCreatureState', '\nfunction ');
if (!serverNaturalCreatureNormalizeBody.includes('enemy.canDialogue = false')
  || !serverNaturalCreatureNormalizeBody.includes('enemy.traderStock = []')
  || !serverNaturalCreatureNormalizeBody.includes('enemy.caps = 0')
  || !serverNaturalCreatureNormalizeBody.includes('stripServerCreatureInventoryRows')) {
  fail('Natural creatures must be forced to non-trading, unarmed inventory state');
}
const safeSaveStateBody = functionSlice(server, 'function safeSaveState', '\n\nfunction ');
if (!safeSaveStateBody.includes('normalizePersistedGameStateNaturalCreatures(state)')) {
  fail('Incoming saves must normalize persisted natural creatures before writing user state');
}
const persistedNaturalCreatureSaveBody = functionSlice(server, 'function migratePersistedNaturalCreatureSaves', '\nfunction ');
if (!persistedNaturalCreatureSaveBody.includes('savesDb.characters')
  || !persistedNaturalCreatureSaveBody.includes('persistSaves()')) {
  fail('Persisted saves must migrate old natural creature snapshots in character stores');
}
const persistedNaturalCreatureEnemyBody = functionSlice(server, 'function normalizePersistedNaturalCreatureEnemy', '\nfunction ');
if (!persistedNaturalCreatureEnemyBody.includes('enemy.canDialogue = false')
  || !persistedNaturalCreatureEnemyBody.includes("enemy.weapon = 'fists'")
  || !persistedNaturalCreatureEnemyBody.includes('stripServerCreatureInventoryRows')) {
  fail('Persisted natural creature snapshots must clear dialogue, weapons and weapon/ammo inventory');
}
const spawnServerEnemyBody = functionSlice(server, 'function spawnServerEnemy', '\nfunction ');
if (!spawnServerEnemyBody.includes('!naturalCreature && Number.isFinite(explicitCaps)')
  || !spawnServerEnemyBody.includes('enemyInventory = stripServerCreatureInventoryRows(enemyInventory)')) {
  fail('Natural creatures must never receive explicit trader caps or weapon/ammo inventory');
}
['profile', 'statProfile', 'equipmentProfile', 'lootProfile'].forEach(field => {
  if (!spawnServerEnemyBody.includes(`${field}: String(opts.${field}`)) {
    fail(`Server NPC spawn must persist ${field} for generated/editor actors`);
  }
});
const publicEnemyBody = functionSlice(server, 'function publicEnemy', '\nfunction publicGroundItem');
['profile', 'statProfile', 'equipmentProfile', 'lootProfile', 'role'].forEach(field => {
  if (!publicEnemyBody.includes(`${field}:`)) {
    fail(`Enemy snapshots must include ${field} for stable client visual/dialogue rules`);
  }
});
if (!publicEnemyBody.includes('canDialogue: naturalCreature ? false')
  || !publicEnemyBody.includes('traderCaps: naturalCreature ? 0')
  || !publicEnemyBody.includes('traderStock: naturalCreature ? []')
  || !publicEnemyBody.includes('traderBuyInterests: naturalCreature ? []')
  || !publicEnemyBody.includes('traderProfile: naturalCreature ?')
  || !publicEnemyBody.includes('dialogueProfile: naturalCreature ?')) {
  fail('Public enemy snapshots must strip dialogue, trade and caps from natural creatures before reaching the client');
}
const clientNaturalCreatureBody = functionSlice(network, 'function isNaturalCreatureEnemy', '\n  function ');
if (!clientNaturalCreatureBody.includes('data?.equipmentProfile') || !clientNaturalCreatureBody.includes('data?.lootProfile')) {
  fail('Client natural creature detection must include generated NPC profile fields');
}
if (!network.includes('function naturalCreatureSnapshotFor')) {
  fail('Client enemy snapshots must normalize natural creatures before saving/restoring dialogue and trade fields');
}
const updateEnemyEquipmentVisualsBody = functionSlice(network, 'function updateEnemyEquipmentVisuals', '\n  function enemyRenderKey');
if (!updateEnemyEquipmentVisualsBody.includes('group.remove(group.userData.enemyWeaponGroup)')
  || !updateEnemyEquipmentVisualsBody.includes('group.userData.enemyWeaponGroup = null')
  || !updateEnemyEquipmentVisualsBody.includes("enemy.weapon = 'fists'")
  || !updateEnemyEquipmentVisualsBody.includes('enemy.traderQuests = []')) {
  fail('Client natural creature visuals must remove stale weapon groups and clear dialogue/trade state');
}
if (!network.includes('function updateEnemyStaticEquipmentOverlay')
  || !updateEnemyEquipmentVisualsBody.includes('updateEnemyStaticEquipmentOverlay(enemy, parts, eq)')
  || !network.includes('group.userData.enemyStaticEquipmentOverlay')) {
  fail('Client GLB NPC models must render visible equipment overlays from their equipment snapshot');
}
const applyEnemySnapshotBodyForVisuals = functionSlice(network, 'function applyNetworkEnemies', '\n  function ');
if (!network.includes('function replaceEnemyVisualModel')
  || !applyEnemySnapshotBodyForVisuals.includes('replaceEnemyVisualModel(enemy, networkType)')
  || !applyEnemySnapshotBodyForVisuals.includes('incomingRenderKey !== currentRenderKey')) {
  fail('Client enemy updates must rebuild the mesh when a stale humanoid snapshot becomes a creature model');
}
const clientSilentCreatureBody = functionSlice(gameMechanicsSource, 'function isSilentCreatureActor', '\n  function ');
if (!clientSilentCreatureBody.includes('actor.role') || !clientSilentCreatureBody.includes('actor.modelKey') || !clientSilentCreatureBody.includes('friendlybrahmin')) {
  fail('Client dialogue/trade gating must treat role/modelKey brahmins as silent creatures');
}
['function createEnemyFromNetworkSnapshot', 'function applyNetworkEnemies', 'function saveCurrentLocationState', 'function restoreEnemiesFromState'].forEach(marker => {
  const body = functionSlice(network, marker, '\n  function ');
  if (!body.includes('naturalCreature')
    || (!body.includes('canDialogue: naturalCreature ? false') && !body.includes('enemy.canDialogue = naturalCreature ? false'))) {
    fail(`${marker} must force natural creatures to canDialogue=false`);
  }
});
const worldContextOptionsBody = functionSlice(creator, 'function buildWorldContextOptions', '\n  function ');
const silentContextIndex = worldContextOptionsBody.indexOf('isSilentCreatureActor(actor)');
const merchantContextIndex = worldContextOptionsBody.indexOf("actor.encounterRole === 'merchant'");
if (silentContextIndex < 0 || (merchantContextIndex >= 0 && silentContextIndex > merchantContextIndex)) {
  fail('World context menu must check silent creatures before merchant/caravan dialogue options');
}
const interactionHintBody = functionSlice(creator, 'function interactionHintForTarget', '\n  function ');
if (!interactionHintBody.includes('isSilentCreatureActor(actor)')) {
  fail('Interaction hints must avoid generic NPC dialogue hints for silent creatures');
}
const enemyTypeFromSnapshotBody = functionSlice(network, 'function enemyVisualFromNetworkSnapshot', '\n  function enemyTypeFromNetworkSnapshot');
['saved.profile', 'saved.statProfile', 'saved.equipmentProfile', 'saved.lootProfile'].forEach(token => {
  if (!enemyTypeFromSnapshotBody.includes(token)) fail(`Client enemy visual fallback must inspect ${token}`);
});
const createEnemySnapshotBody = functionSlice(network, 'function createEnemyFromNetworkSnapshot', '\n  function applyNetworkEnemies');
const applyEnemySnapshotBody = functionSlice(network, 'function applyNetworkEnemies', '\n  function ');
['profile', 'statProfile', 'equipmentProfile', 'lootProfile', 'role'].forEach(field => {
  if (!createEnemySnapshotBody.includes(`${field}: saved.${field}`)) fail(`Client enemy creation must persist ${field}`);
  if (!applyEnemySnapshotBody.includes(`enemy.${field} = saved.${field}`)) fail(`Client enemy updates must persist ${field}`);
});
if (!locationEditor.includes('friendlyBrahmin: {')
  || !locationEditor.includes("role: 'animal'")
  || !locationEditor.includes('canDialogue: false')
  || !locationEditor.includes("equipmentProfile: 'none'")) {
  fail('Location editor must author brahmin as a non-dialogue animal with no equipment profile');
}

const factionThreatBody = functionSlice(server, 'function chooseFactionCombatPlayerThreat', '\nfunction ');
if (!factionThreatBody.includes('chooseVisibleEnemyTarget(room, actor, roomPlayers, now)')
  || factionThreatBody.indexOf('chooseVisibleEnemyTarget(room, actor, roomPlayers, now)') > factionThreatBody.indexOf('return sensed.target')) {
  fail('Faction combat AI must still consider visible hostile players while NPC factions are fighting');
}

const clientCombatModeBody = functionSlice(combat, 'function currentLocationCombatMode');
if (!clientCombatModeBody.includes('const locMode = currentLocation?.pvpMode')
  || clientCombatModeBody.indexOf('const locMode = currentLocation?.pvpMode') > clientCombatModeBody.indexOf('multiplayer?.pvpMode')) {
  fail('Client combat mode must prefer the current location over stale multiplayer pvpMode');
}
const clientPvpModeNormalizeBody = functionSlice(combat, 'function normalizeClientLocationPvpMode');
if (!clientPvpModeNormalizeBody.includes("typeof value === 'boolean'")
  || !clientPvpModeNormalizeBody.includes("'safezone'")
  || !clientPvpModeNormalizeBody.includes("'pvpFullDrop'")) {
  fail('Client location PvP mode normalization must understand editor aliases before allowing NPC combat');
}
if (!clientCombatModeBody.includes('currentLocation?.pvpType')
  || !clientCombatModeBody.includes('normalizeClientLocationPvpMode(locMode')
  || !clientCombatModeBody.includes('normalizeClientLocationPvpMode(mode, true)')) {
  fail('Client combat mode must normalize location/editor PvP fields before allowing NPC combat');
}

const globalMapRouteWaterBlockBody = functionSlice(mapLoop, 'function globalMapRouteWaterBlock', '\n  function announceGlobalMapWaterBlock');
if (!globalMapRouteWaterBlockBody.includes('globalMapPointIsWater(from.x, from.y)')
  || !globalMapRouteWaterBlockBody.includes('globalMapPointIsWater(to.x, to.y)')
  || !globalMapRouteWaterBlockBody.includes("reason: 'route'")) {
  fail('Global map movement must block water at route start, route target and sampled route segments');
}
const globalMapSanitizeBody = functionSlice(mapLoop, 'function sanitizeGlobalMapPlayerLandState', '\n  function globalMapRouteWaterBlock');
if (!globalMapSanitizeBody.includes('nearestGlobalMapLandPoint(current, fallback)')
  || !globalMapSanitizeBody.includes('globalMapState.travel = null')
  || !globalMapSanitizeBody.includes('globalMapState.pendingWorldDrop = null')) {
  fail('Global map must sanitize saved/current player water coordinates back to land');
}
const globalMapSerializeBody = functionSlice(mapLoop, 'function serializeGlobalMapState', '\n  function applySavedGlobalMapState');
if (!globalMapSerializeBody.includes('globalMapPointIsWater(playerPoint.x, playerPoint.y)')
  || !globalMapSerializeBody.includes('nearestGlobalMapLandPoint(playerPoint')
  || !globalMapSerializeBody.includes('globalMapPointIsWater(selectedPoint.x, selectedPoint.y)')) {
  fail('Global map save state must not persist player or selected water coordinates');
}
const globalMapRestoreTravelBody = functionSlice(mapLoop, 'function restoreGlobalMapTravel', '\n  function serializeGlobalMapEncounter');
if (!globalMapRestoreTravelBody.includes('globalMapPathWaterBlock(routePoints)')) {
  fail('Global map restored travel must reject any polyline segment through water');
}
const globalMapPanelBody = functionSlice(mapLoop, 'function renderGlobalMapPanel', '\n  function renderGlobalEncounterPanel');
if (!globalMapPanelBody.includes('sanitizeGlobalMapPlayerLandState({ save: true })')) {
  fail('Global map panel must correct water player positions before enabling enter/drop UI');
}
const globalMapStartTravelBody = functionSlice(mapLoop, 'function startGlobalTravel', '\n  function cancelGlobalTravel');
if (!globalMapStartTravelBody.includes('sanitizeGlobalMapPlayerLandState({ announce: true, save: true })')
  || !globalMapStartTravelBody.includes('globalMapPathWaterBlock(plannedRoutePoints)')
  || !globalMapStartTravelBody.includes('waterBlock && !serverAuthoritative')) {
  fail('Global map travel must start from sanitized land, validate local polylines and defer online authority to the server');
}
const globalMapSelectDestinationBody = functionSlice(mapLoop, 'function selectGlobalMapDestination', '\n  function maybeTriggerGlobalEncounterAlongRoute');
if (!globalMapSelectDestinationBody.includes('nearestGlobalMapLandPoint(rawPoint')
  || !globalMapSelectDestinationBody.includes('sanitizeGlobalMapPlayerLandState({ save: false })')
  || !globalMapSelectDestinationBody.includes('globalMapPointIsWater(point.x, point.y)')) {
  fail('Global map rerouting must keep the current travel point and selected target on land before server route planning');
}
const globalMapEnterBody = functionSlice(mapLoop, 'function enterCurrentGlobalSettlement', '\n  function initGlobalMapControls');
if (!globalMapEnterBody.includes('globalMapPointIsWater(point.x, point.y)')
  || !globalMapEnterBody.includes('sanitizeGlobalMapPlayerLandState({ announce: true, save: true })')
  || !globalMapEnterBody.includes('return false;')) {
  fail('Global map enter action must reject water coordinates and move the player back to land');
}
const globalMapNodeVisualBody = functionSlice(mapLoop, 'function addGlobalMapNodeVisual', '\n  function addGlobalMapObjectVisual');
const globalMapObjectVisualBody = functionSlice(mapLoop, 'function addGlobalMapObjectVisual', '\n  function globalMap3DWorldPoint');
if (!mapLoop.includes('function fitGlobalMapStaticModelInstance')
  || !mapLoop.includes('afterApply: (_, root) => fitGlobalMapStaticModelInstance')
  || !globalMapNodeVisualBody.includes('3.2 : 2.1')
  || !globalMapNodeVisualBody.includes('Math.max(0.45, Math.min(4')
  || !globalMapObjectVisualBody.includes('1.65 * Math.max(0.2, Math.min(5')) {
  fail('In-game 3D global map models must use the same fitted target scale as the global map editor');
}
if (!globalMapEditor.includes('3.2 : 2.1')
  || !globalMapEditor.includes('1.65 * scaleInput')) {
  fail('Global map editor fitted model scale reference is missing');
}
const applyPlayerDamageBody = functionSlice(combat, 'function applyPlayerWeaponDamage');
if (!applyPlayerDamageBody.includes('currentLocationAllowsPvp()') || !applyPlayerDamageBody.includes('return false')) {
  fail('Client player-hit path must stop before PvP feedback in peaceful locations');
}
const explosionDamageBody = functionSlice(combat, 'function applyExplosionDamage', '\n  function ');
const explosionServerAuthIndex = explosionDamageBody.indexOf('if (enemiesAreServerAuthoritative())');
const explosionLocalDamageIndex = explosionDamageBody.indexOf('enemy.hp -= dmg');
if (!explosionDamageBody.includes('!currentLocationAllowsNpcCombat()') || !explosionDamageBody.includes('rejectPeacefulNpcCombat()')) {
  fail('Client explosive damage must reject NPC damage before spending feedback in peaceful locations');
}
if (explosionServerAuthIndex < 0 || explosionLocalDamageIndex < 0 || explosionServerAuthIndex > explosionLocalDamageIndex) {
  fail('Client explosive damage must keep server-authoritative and offline damage paths separate');
}
const explosionServerAuthBody = explosionDamageBody.slice(explosionServerAuthIndex, explosionLocalDamageIndex);
if (explosionServerAuthBody.includes('enemy.hp =') || explosionServerAuthBody.includes('enemy.hp -=')) {
  fail('Client explosive damage must not predictively change NPC HP while enemies are server-authoritative');
}

const harvestServerBody = socketEventSlice(server, 'harvestResource');
if (!harvestServerBody.includes('syncServerActionProgressionPlayer(p, data)')) {
  fail('harvestResource must sync and budget-limit progression before loot formulas');
}

const inspectCorpseBody = socketEventSlice(server, 'inspectCorpse');
const releaseCorpseBody = socketEventSlice(server, 'releaseCorpseLoot');
const lootEnemyBody = socketEventSlice(server, 'lootEnemy');
const ensureCorpseLootBody = functionSlice(combat, 'function ensureCorpseLoot', '\n\n  function makeCorpse');
const sendCorpseLootHoldBody = functionSlice(windows, 'function sendCorpseLootHold', '\n\n  function startCorpseLootHold');
const closeLootWindowBody = functionSlice(windows, 'function closeLootWindow', '\n\n  function renderLootWindow');
const takeAllLootBody = functionSlice(windows, 'function takeAllLoot', '\n\n  function findNearestCorpse');
if (!server.includes('function serverShouldRemoveCorpse') || !server.includes('serverCorpseLootIsHeld')) {
  fail('Server corpse cleanup must be gated by an active loot-window hold');
}
if (!inspectCorpseBody.includes('serverTouchCorpseLootHold(enemy, socket.id') || !releaseCorpseBody.includes('serverReleaseCorpseLootHold(enemy, socket.id')) {
  fail('Corpse loot inspect/release events must refresh and release cleanup holds');
}
if (lootEnemyBody.includes('if (enemy.looted) room.enemies.delete(enemy.id)') || !lootEnemyBody.includes('const removed = serverShouldRemoveCorpse(enemy, now)')) {
  fail('lootEnemy must not delete a looted corpse while its loot window is held open');
}
if (!windows.includes('startCorpseLootHold(enemy)')
  || !windows.includes("emitGuardedMultiplayerGameplayAction('inspectCorpse'")
  || !windows.includes("emitGuardedMultiplayerGameplayAction('releaseCorpseLoot'")) {
  fail('Loot window must refresh and release corpse cleanup holds');
}
const serverAuthGuardIndex = ensureCorpseLootBody.indexOf('enemiesAreServerAuthoritative');
const localRollIndex = ensureCorpseLootBody.indexOf('rollEnemyLoot(type)');
if (serverAuthGuardIndex < 0 || localRollIndex < 0 || serverAuthGuardIndex > localRollIndex) {
  fail('Server-authoritative corpses must never generate client-side random loot');
}
if (!sendCorpseLootHoldBody.includes('renderLootWindow()')) {
  fail('Corpse inspect acknowledgements must repaint the loot window with server loot');
}
if (!windows.includes('function hideLootWindowTooltip')
  || !closeLootWindowBody.includes('hideLootWindowTooltip()')
  || !takeAllLootBody.includes('hideLootWindowTooltip()')
  || !network.includes('function takeAllWorldContainerLoot()')
  || !network.includes("if (typeof hideTooltip === 'function') hideTooltip();")) {
  fail('Loot window actions must clear item tooltips when cards/windows are removed');
}

assertEmitCarries(combat, 'enemyHit', ['...multiplayerProgressionSnapshot()', 'targetX', 'targetZ']);
assertEmitCarries(combat, 'harvestResource', ['...multiplayerProgressionSnapshot()']);

console.log(`Progression sync OK: ${clientSkills.length} skill(s), ${clientTalents.length} talent(s), ${clientTraits.length} start trait(s), ${referencedRecipeIds.length} recipe reference(s), skill/talent formulas and mechanics covered, action payloads guarded`);
