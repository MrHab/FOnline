const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const progressionCatalog = JSON.parse(fs.readFileSync(
  path.join(root, 'data', 'kromka', 'character-progression.json'), 'utf8'
));
const fieldRecipeCatalog = JSON.parse(fs.readFileSync(
  path.join(root, 'data', 'kromka', 'field-recipes.json'), 'utf8'
));

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function fail(message) {
  throw new Error(message);
}

function idsInServerSet(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) fail(`Missing server set marker: ${marker}`);
  const end = source.indexOf(');', start);
  if (end < 0) fail(`Unclosed server set marker: ${marker}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
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
  if (eventName === 'enemyHit' || eventName === 'playerHit') {
    const handler = eventName === 'enemyHit' ? 'handleEnemyHit' : 'handlePlayerHit';
    const start = source.indexOf(`  ${handler} = (`);
    if (start < 0) fail(`Missing socket handler: ${eventName}`);
    const end = source.indexOf('\n  };', start);
    if (end < 0) fail(`Unclosed socket handler: ${eventName}`);
    return source.slice(start, end + 5);
  }
  const marker = `socket.on('${eventName}'`;
  const start = source.indexOf(marker);
  if (start < 0) fail(`Missing socket event: ${eventName}`);
  const end = source.indexOf('\n  socket.on(', start + marker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

const server = read('server.js');

const recipeIds = (fieldRecipeCatalog.recipes || []).map(row => row.id);
const serverSkills = progressionCatalog.skills.items.map(row => row.id);
const serverTalents = progressionCatalog.perks.items.map(row => row.id);
const serverTraits = progressionCatalog.startTraits.items.map(row => row.id);
const serverTalentDefs = progressionCatalog.perks.items;

assertNoDuplicates('Recipe', recipeIds);
assertNoDuplicates('Server skill', serverSkills);
assertNoDuplicates('Server talent', serverTalents);
assertNoDuplicates('Server start trait', serverTraits);

const forbiddenTalents = [
  { id: 'tracker', name: 'Следопыт' },
  { id: 'quietStep', name: 'Тихий шаг' },
  { id: 'silentStep', name: 'Тихий шаг' },
  { id: 'deal', name: 'Сделка' },
  { id: 'dealMaker', name: 'Сделка' },
  { id: 'bargain', name: 'Сделка' }
];
const forbiddenFound = serverTalentDefs.filter(talent => forbiddenTalents.some(forbidden => talent.id === forbidden.id || talent.name === forbidden.name));
if (forbiddenFound.length) fail(`Forbidden talent(s) present: ${forbiddenFound.map(talent => `${talent.id}/${talent.name}`).join(', ')}`);

const vagueTalentDescriptions = serverTalentDefs.filter(talent => /примерн|около/i.test(String(talent.description || '')));
if (vagueTalentDescriptions.length) {
  fail(`Talent description(s) must use exact effects instead of vague wording: ${vagueTalentDescriptions.map(talent => talent.id).join(', ')}`);
}
const nonNumericTalentDescriptions = serverTalentDefs.filter(talent => {
  const desc = String(talent.description || '');
  return !(/[0-9%×]/.test(desc) || desc.includes('п.п.') || desc.includes('max') || desc.includes('min') || desc.includes('floor'));
});
if (nonNumericTalentDescriptions.length) {
  fail(`Talent description(s) must include exact numeric/formula effect markers: ${nonNumericTalentDescriptions.map(talent => talent.id).join(', ')}`);
}

const missingSkillMechanics = serverSkills.filter(id => {
  const directSkillCall = new RegExp(`\\bserverSkill(?:Norm|Percent)\\s*\\([^)]*['"]${escapeRegex(id)}['"]`).test(server);
  const weaponSkillBinding = new RegExp(`\\bweaponSkill:\\s*['"]${escapeRegex(id)}['"]`).test(server);
  return !directSkillCall && !weaponSkillBinding;
});
if (missingSkillMechanics.length) fail(`Skill(s) without direct mechanics: ${missingSkillMechanics.join(', ')}`);

// Бдительность (радиус обзора) и Осведомлённость (точные ОЗ и прогноз урона цели)
// меняют только то, что показывает клиент; их Unity-механику стережёт check-unity-progression.
const CLIENT_SIDE_TALENTS = new Set(['vigilance', 'awareness']);
const missingTalentMechanics = serverTalents.filter(id => {
  if (CLIENT_SIDE_TALENTS.has(id)) return false;
  const directTalentCall = new RegExp(`\\bserverTalentLevel\\s*\\([^)]*['"]${escapeRegex(id)}['"]`).test(server);
  if (directTalentCall) return false;
  if (!id.startsWith('special')) return true;
  return !(server.includes('function serverStatValue') && server.includes(`${id}:`));
});
if (missingTalentMechanics.length) fail(`Talent(s) without direct mechanics: ${missingTalentMechanics.join(', ')}`);

const actionProgressionBody = functionSlice(server, 'function serverActionProgressionPlayer', '\nfunction ');
if (!actionProgressionBody.includes('Number(p.level || 1)') || actionProgressionBody.includes('data.level')) {
  fail('Action progression budget must use only the authoritative server player level');
}

const sanitizeSpecialBody = functionSlice(server, 'function sanitizeSpecial', '\nfunction ');
if (progressionCatalog.special.max !== 10 || progressionCatalog.special.budget !== 40
  || !server.includes('KROMKA_CHARACTER_PROGRESSION_CATALOG.special.max')
  || !server.includes('KROMKA_CHARACTER_PROGRESSION_CATALOG.special.budget')
  || !sanitizeSpecialBody.includes('SERVER_SPECIAL_TOTAL') || !sanitizeSpecialBody.includes('out[key]--')) {
  fail('Server SPECIAL sanitization must enforce the same base stat max and total budget as character creation');
}
const serverStatValueBody = functionSlice(server, 'function serverStatValue', '\nfunction ');
const serverStatValueWithRanksBody = functionSlice(server, 'function serverStatValueWithTalentRanks', '\nfunction ');
if (progressionCatalog.special.effectiveMax !== 15
  || !server.includes('KROMKA_CHARACTER_PROGRESSION_CATALOG.special.effectiveMax')
  || !serverStatValueBody.includes('SERVER_SPECIAL_EFFECTIVE_MAX') || !serverStatValueWithRanksBody.includes('SERVER_SPECIAL_EFFECTIVE_MAX')) {
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

const serverTalentLevelBody = functionSlice(server, 'function serverTalentLevel', '\nfunction ');
const serverTalentRankFromBody = functionSlice(server, 'function serverTalentRankFrom', '\nfunction ');
const serverEnforceProgressionBody = functionSlice(server, 'function enforceServerProgressionBudget', '\nfunction ');
if (!serverTalentLevelBody.includes('serverTalentRankFrom(p.talentRanks || {}, id)')) {
  fail('Server talentLevel must use the shared clamped talent rank reader');
}
if (!serverTalentRankFromBody.includes('SERVER_TALENT_IDS.has(id)') || !serverTalentRankFromBody.includes('SERVER_TALENT_MAX_RANKS[id]') || !serverTalentRankFromBody.includes('Number.isFinite(raw)')) {
  fail('Server talent rank reader must reject unknown/invalid ranks and respect per-talent max ranks');
}
if (!serverEnforceProgressionBody.includes('const perkBudget = serverPerkBudgetFor(p.level)')
  || !serverEnforceProgressionBody.includes('limitExistingTalentRanksByBudget')
  || !serverEnforceProgressionBody.includes('ensureServerProgressionLedger(p)')
  || !serverEnforceProgressionBody.includes('limitServerSkillStepsByBudget')
  || !serverEnforceProgressionBody.includes('serverSyncSkillRanksFromLedger(p)')) {
  fail('Server progression enforcement must preserve acquired ranks through the versioned skill-step ledger');
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
const serverCarryCapacityBody = functionSlice(server, 'function serverCarryCapacity', '\nfunction ');
if (!serverCarryCapacityBody.includes("serverStatValue(p, 'str')")) {
  fail('Server carry capacity must use effective Strength, including the Strength perk');
}

const enemyHitServerBody = socketEventSlice(server, 'enemyHit');
if (!enemyHitServerBody.includes('syncServerActionProgressionPlayer(p, data)')) {
  fail('enemyHit must sync and budget-limit progression before combat formulas');
}
if (!enemyHitServerBody.includes('data.combat') || !enemyHitServerBody.includes('serverHitChance(p, enemy')) {
  fail('enemyHit must pass combat snapshot data into server hit chance');
}
if (!enemyHitServerBody.includes('serverCombatTargetPoint(enemy, data, weapon, room)')
  || !enemyHitServerBody.includes('serverLineOfFireClearFrom(room, origin.x, origin.z, targetProxy')
  || !enemyHitServerBody.includes('serverShotgunSpreadSample(weapon, origin, targetProxy')) {
  fail('enemyHit must validate moving NPCs against the bounded client-observed target position');
}
if (!enemyHitServerBody.includes('failureContext') || !enemyHitServerBody.includes('enemy: publicEnemy(enemy)')) {
  fail('enemyHit rejections must return authoritative NPC and combat state for client recovery');
}
const npcProtectionIndex = enemyHitServerBody.indexOf('serverPlayerCanDamageNpc(p, enemy, room)');
if (npcProtectionIndex < 0
  || npcProtectionIndex > enemyHitServerBody.indexOf('serverDamageRoll(p, bulletWeapon')
  || enemyHitServerBody.includes('setEncounterFactionHostileToPlayer')) {
  fail('enemyHit must protect friendly NPCs before damage or faction provocation while allowing the shot');
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
  const emitIndex = body.indexOf(`emit('${eventName === 'shoot' ? 'shot' : 'melee'}'`);
  if (body.includes('locationAllowsNpcCombat')
    || body.includes('locationIsFactionCapital')
    || emitIndex < 0
    || body.includes('addRoomNoise')) {
    fail(`${eventName} visuals must work in peaceful locations without mutating authoritative AI noise`);
  }
});

const combatAttackServerBody = socketEventSlice(server, 'combatAttack');
const combatAttackPeacefulIndex = combatAttackServerBody.indexOf('locationAllowsNpcCombat(loc)');
const combatAttackSpendIndex = combatAttackServerBody.indexOf('serverValidateAndSpendAttack');
const combatAttackNoiseIndex = combatAttackServerBody.indexOf('addRoomNoise');
if (combatAttackPeacefulIndex >= 0
  || combatAttackServerBody.includes('locationIsFactionCapital')
  || combatAttackSpendIndex < 0
  || combatAttackNoiseIndex < combatAttackSpendIndex
  || !combatAttackServerBody.includes('if (!spend.reused)')) {
  fail('combatAttack must allow peaceful use and create AI noise only after a new authoritative spend');
}

const playerHitServerBody = socketEventSlice(server, 'playerHit');
const playerProtectionIndex = playerHitServerBody.indexOf('serverPlayerCanDamagePlayer(attacker, target, room, now)');
if (playerProtectionIndex < 0 || playerProtectionIndex > playerHitServerBody.indexOf('serverDamageRoll(attacker')) {
  fail('playerHit must protect allies and peaceful-zone targets before damage while allowing the shot');
}

const syncNpcTradeStateBody = socketEventSlice(server, 'syncNpcTradeState');
// Скупщик Чёрного рынка отдаёт свою витрину, остальные NPC — обычную.
if (!(syncNpcTradeStateBody.includes('market: serverNpcTradeMarket(actor)')
    || syncNpcTradeStateBody.includes('serverIsBlackMarketActor(actor) ? serverBlackMarketTradeMarket(p) : serverNpcTradeMarket(actor)'))
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
  || !serverNaturalCreatureNormalizeBody.includes('delete enemy.caps')
  || !serverNaturalCreatureNormalizeBody.includes('delete enemy.traderCaps')
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
  || publicEnemyBody.includes('traderCaps:')
  || !publicEnemyBody.includes('inventory: naturalCreature ? stripServerCreatureInventoryRows')
  || !publicEnemyBody.includes('traderStock: naturalCreature ? []')
  || !publicEnemyBody.includes('traderBuyInterests: naturalCreature ? []')
  || !publicEnemyBody.includes('traderProfile: naturalCreature ?')
  || !publicEnemyBody.includes('dialogueProfile: naturalCreature ?')) {
  fail('Public enemy snapshots must expose physical inventory without a shadow caps wallet and strip trade from natural creatures');
}
const factionThreatBody = functionSlice(server, 'function chooseFactionCombatPlayerThreat', '\nfunction ');
if (!factionThreatBody.includes('chooseVisibleEnemyTarget(room, actor, roomPlayers, now)')
  || factionThreatBody.indexOf('chooseVisibleEnemyTarget(room, actor, roomPlayers, now)') > factionThreatBody.indexOf('return sensed.target')) {
  fail('Faction combat AI must still consider visible hostile players while NPC factions are fighting');
}

const harvestServerBody = socketEventSlice(server, 'harvestResource');
if (!harvestServerBody.includes('syncServerActionProgressionPlayer(p, data)')) {
  fail('harvestResource must sync and budget-limit progression before loot formulas');
}

const inspectCorpseBody = socketEventSlice(server, 'inspectCorpse');
const releaseCorpseBody = socketEventSlice(server, 'releaseCorpseLoot');
const lootEnemyBody = socketEventSlice(server, 'lootEnemy');
if (!server.includes('function serverShouldRemoveCorpse') || !server.includes('serverCorpseLootIsHeld')) {
  fail('Server corpse cleanup must be gated by an active loot-window hold');
}
if (!inspectCorpseBody.includes('serverTouchCorpseLootHold(enemy, socket.id') || !releaseCorpseBody.includes('serverReleaseCorpseLootHold(enemy, socket.id')) {
  fail('Corpse loot inspect/release events must refresh and release cleanup holds');
}
if (lootEnemyBody.includes('if (enemy.looted) room.enemies.delete(enemy.id)') || !lootEnemyBody.includes('const removed = serverShouldRemoveCorpse(enemy, now)')) {
  fail('lootEnemy must not delete a looted corpse while its loot window is held open');
}

console.log(`Progression sync OK: ${serverSkills.length} skill(s), ${serverTalents.length} talent(s), ${serverTraits.length} start trait(s), ${recipeIds.length} recipe(s), skill/talent mechanics covered, server action handlers guarded`);
