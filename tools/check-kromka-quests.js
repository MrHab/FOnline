'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { advanceQuest, allQuests, chooseQuestOutcome, initialQuestState, objectiveEventMatches, publicQuestJournal, recordQuestObjectiveProgress, repeatableReward, sanitizeQuestState, startQuest, turnInQuest } = require('../src/server/kromka-quests');
const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/kromka/quests.json'), 'utf8'));
const npcCatalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/kromka/npcs.json'), 'utf8'));

assert.equal(catalog.campaign.length, 6, 'Prologue, four chapters and finale are required.');
assert.equal(catalog.factionQuests.length, 18, 'Six factions need three authored quests each.');
assert.equal(catalog.personalQuests.length, 10, 'Ten principal NPC personal quests are required.');
assert.deepEqual(catalog.mechanicQuests.map(row => row.id), ['side_quiet_squeak', 'side_iron_argument']);
assert.equal(new Set(allQuests(catalog).map(row => row.id)).size, allQuests(catalog).length, 'Quest ids must be unique.');
const nonCampaignQuests = [...catalog.factionQuests, ...catalog.mechanicQuests, ...catalog.personalQuests];
assert.equal(nonCampaignQuests.length, 30, 'Every non-campaign authored quest must be included in the condition audit.');
assert.equal((catalog.dialogueQuestIds || []).length, 0,
  'Quests must not bypass world conditions through a dialogue-only allow-list.');
const questGivers = new Map();
for (const npc of npcCatalog.npcs || []) {
  for (const alias of [npc.id, ...(npc.questAliases || [])].map(String)) {
    assert(!questGivers.has(alias), `Quest giver alias ${alias} is assigned to more than one NPC.`);
    questGivers.set(alias, npc);
  }
}
const dialogueLines = new Set();
const knownNpcIds = new Set((npcCatalog.npcs || []).map(npc => String(npc.id || '')));
for (const quest of allQuests(catalog)) {
  for (const objectiveId of quest.objectives || []) {
    assert(String(catalog.objectiveLabels?.[objectiveId] || '').trim(), `${quest.id}: objective ${objectiveId} needs a localized label.`);
    const binding = catalog.objectiveBindings?.[objectiveId];
    assert(binding, `${quest.id}: objective ${objectiveId} needs an authoritative condition binding.`);
    assert(['onboarding', 'location', 'dialogue', 'allies', 'object', 'objects', 'anomaly', 'artifact'].includes(String(binding.type || '')),
      `${quest.id}/${objectiveId}: unsupported condition type ${binding.type}.`);
  }
  for (const outcome of quest.outcomes || []) {
    const outcomeId = String(typeof outcome === 'string' ? outcome : outcome?.id || '');
    assert(String((typeof outcome === 'object' ? outcome?.label : '') || catalog.outcomeLabels?.[outcomeId] || '').trim(), `${quest.id}: outcome ${outcomeId} needs a localized label.`);
  }
  const giverId = String(quest.giverNpcId || quest.npcId || '');
  if (!giverId) continue;
  assert(questGivers.has(giverId), `${quest.id}: quest giver ${giverId} does not exist in the world.`);
  const dialogue = catalog.questDialogues?.[quest.id];
  assert(dialogue, `${quest.id}: unique NPC quest dialogue is missing.`);
  for (const state of ['briefing', 'progress', 'resolution', 'after']) {
    const line = String(dialogue[state] || '').trim();
    assert(line.length >= 35, `${quest.id}: ${state} dialogue is missing or too generic.`);
    assert(!dialogueLines.has(line), `${quest.id}: ${state} dialogue duplicates another quest line.`);
    dialogueLines.add(line);
  }
}
for (const quest of nonCampaignQuests) {
  const giver = questGivers.get(String(quest.giverNpcId || quest.npcId || ''));
  assert((quest.objectives || []).some(objectiveId => {
    const binding = catalog.objectiveBindings[objectiveId] || {};
    return String(binding.type || '') !== 'dialogue'
      || Number(binding.required || 1) > 1
      || !(binding.npcIds || []).map(String).includes(String(giver?.id || ''));
  }), `${quest.id}: every condition can still be completed by repeatedly talking to its giver.`);
}
for (const [faction, chain] of Object.entries(catalog.factionChains)) assert.equal(chain.length, 3, `${faction} must have a three-part chain.`);

assert(!objectiveEventMatches(catalog.objectiveBindings.reach_damaged_post, {
  source: 'npc_dialogue_action', actorId: 'rada_menshova', locationId: 'settlement'
}), 'Talking to the giver must not satisfy a location condition.');
assert(objectiveEventMatches(catalog.objectiveBindings.reach_damaged_post, {
  source: 'location_arrival', locationId: 'relayOutpost'
}), 'The authored damaged-post arrival must satisfy its location condition.');
assert(!objectiveEventMatches(catalog.objectiveBindings.recover_measurement_block, {
  source: 'quest_object', locationId: 'relayOutpost', objectId: 'wrong_object'
}), 'An unrelated object must not satisfy a quest-object condition.');
assert(!objectiveEventMatches(catalog.objectiveBindings.compare_incompatible_seals, {
  source: 'npc_dialogue', actorId: 'rada_menshova', locationId: 'settlement'
}), 'The wrong NPC must not satisfy a dialogue condition.');

const authoredObjectiveIds = new Set(allQuests(catalog).flatMap(quest => quest.objectives || []));
for (const objectiveId of authoredObjectiveIds) {
  const binding = catalog.objectiveBindings?.[objectiveId];
  if (['dialogue', 'allies'].includes(String(binding.type || ''))) {
    assert((binding.npcIds || []).length >= Number(binding.required || 1), `${objectiveId}: not enough bound NPCs.`);
    for (const npcId of binding.npcIds || []) assert(knownNpcIds.has(npcId), `${objectiveId}: unknown NPC ${npcId}.`);
  }
  if (String(binding.type || '') === 'location') {
    const locationIds = [binding.locationId, ...(binding.locationIds || [])].filter(Boolean);
    assert(locationIds.length >= Number(binding.required || 1), `${objectiveId}: not enough distinct bound locations.`);
    for (const locationId of locationIds) {
      assert(fs.existsSync(path.resolve(__dirname, `../data/locations/${locationId}.json`)), `${objectiveId}: unknown location ${locationId}.`);
    }
  }
  if (['object', 'objects'].includes(String(binding.type || ''))) {
    assert(binding.locationId, `${objectiveId}: object binding needs a location.`);
    assert((binding.objectIds || []).length >= Number(binding.required || 1), `${objectiveId}: not enough bound objects.`);
    const location = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../data/locations/${binding.locationId}.json`), 'utf8'));
    for (const objectId of binding.objectIds || []) {
      const row = (location.objects || []).find(object => String(object.id || '') === objectId);
      assert(row, `${objectiveId}: authored object ${objectId} is absent from ${binding.locationId}.`);
      assert.equal(String(row.interactive?.questObjective || ''), objectiveId, `${objectId}: wrong quest objective binding.`);
    }
  }
}

const migrated = sanitizeQuestState({ version: 1, active: {}, completed: {} }, catalog);
assert.equal(migrated.version, 3, 'Legacy quest saves must migrate to the current state version.');
assert.deepEqual(migrated.objectiveProgress, {}, 'Legacy quest saves need an empty progress ledger.');

let campaignState = initialQuestState();
const lockedChapter = publicQuestJournal(campaignState, catalog).campaign
  .find(row => row.id === 'campaign_ch1_water_owes_none');
assert.equal(lockedChapter.status, 'locked', 'Later campaign chapters must stay locked until the previous stage is complete.');
assert.equal(lockedChapter.dialogue, catalog.questDialogues.campaign_ch1_water_owes_none.locked,
  'A locked quest must expose its own NPC line.');
let campaignRewardClaims = 0;
for (const quest of catalog.campaign) {
  let campaignResult = startQuest(campaignState, quest.id, catalog, { reputation: {} }, 10 + Number(quest.order || 0));
  assert(campaignResult.ok, `${quest.id}: campaign stage cannot start.`);
  campaignState = campaignResult.state;
  if (quest.giverNpcId || quest.npcId) {
    const activeRow = publicQuestJournal(campaignState, catalog).campaign.find(row => row.id === quest.id);
    assert.equal(activeRow.dialogue, catalog.questDialogues[quest.id].progress,
      `${quest.id}: active dialogue did not reach the player journal.`);
  }
  for (let index = 0; index < (quest.objectives || []).length; index++) {
    const objectiveId = quest.objectives[index];
    const binding = catalog.objectiveBindings[objectiveId];
    const required = Math.max(1, Number(binding.required || 1));
    if (required > 1) {
      let progress = recordQuestObjectiveProgress(campaignState, quest.id, objectiveId, `${objectiveId}:1`, required, catalog);
      assert(progress.ok && !progress.complete && progress.current === 1, `${objectiveId}: first unique contribution was not recorded.`);
      campaignState = progress.state;
      const duplicate = recordQuestObjectiveProgress(campaignState, quest.id, objectiveId, `${objectiveId}:1`, required, catalog);
      assert(duplicate.ok && duplicate.duplicate && duplicate.current === 1, `${objectiveId}: duplicate contribution advanced progress.`);
      campaignState = duplicate.state;
      const journalRow = publicQuestJournal(campaignState, catalog).campaign.find(row => row.id === quest.id);
      assert.equal(journalRow.objectiveProgressCurrent, 1, `${objectiveId}: journal does not expose partial progress.`);
      assert.equal(journalRow.objectiveProgressTarget, required, `${objectiveId}: journal does not expose progress target.`);
      for (let tokenIndex = 2; tokenIndex <= required; tokenIndex++) {
        progress = recordQuestObjectiveProgress(campaignState, quest.id, objectiveId, `${objectiveId}:${tokenIndex}`, required, catalog);
        campaignState = progress.state;
        assert.equal(progress.complete, tokenIndex === required, `${objectiveId}: completion threshold is wrong.`);
      }
    }
    campaignResult = advanceQuest(campaignState, quest.id, {
      action: objectiveId,
      authoritative: true,
      locationId: String(binding.locationId || quest.objectiveLocations?.[index] || '')
    }, catalog, 100 + index);
    assert(campaignResult.ok, `${quest.id}/${objectiveId}: authoritative objective cannot advance.`);
    campaignState = campaignResult.state;
  }
  if (campaignResult.awaitingOutcome) {
    const choiceRow = publicQuestJournal(campaignState, catalog).campaign.find(row => row.id === quest.id);
    assert.equal(choiceRow.dialogue, catalog.questDialogues[quest.id].resolution,
      `${quest.id}: resolution dialogue did not reach the choice state.`);
    const outcome = quest.outcomes[0];
    campaignResult = chooseQuestOutcome(campaignState, quest.id, typeof outcome === 'string' ? outcome : outcome.id, catalog, 200);
    assert(campaignResult.ok && campaignResult.completed, `${quest.id}: campaign outcome cannot be selected.`);
    campaignState = campaignResult.state;
  } else {
    assert(campaignResult.awaitingTurnIn, `${quest.id}: a quest without outcomes must wait for NPC turn-in.`);
    const journalRow = publicQuestJournal(campaignState, catalog).campaign.find(row => row.id === quest.id);
    assert.equal(journalRow.status, 'turnin', `${quest.id}: journal does not expose NPC turn-in state.`);
    if (quest.giverNpcId || quest.npcId) assert.equal(journalRow.dialogue, catalog.questDialogues[quest.id].resolution,
      `${quest.id}: turn-in dialogue did not reach the player journal.`);
    campaignResult = turnInQuest(campaignState, quest.id, catalog, 200);
    assert(campaignResult.ok && campaignResult.completed, `${quest.id}: NPC turn-in cannot complete the quest.`);
    campaignState = campaignResult.state;
  }
  assert(campaignState.completed[quest.id], `${quest.id}: stage did not complete.`);
  if (quest.giverNpcId || quest.npcId) {
    const completedRow = publicQuestJournal(campaignState, catalog).campaign.find(row => row.id === quest.id);
    assert.equal(completedRow.dialogue, catalog.questDialogues[quest.id].after,
      `${quest.id}: completed dialogue did not reach the player journal.`);
  }
  campaignRewardClaims = campaignState.rewardClaims.length;
}
assert.equal(Object.keys(campaignState.completed).length, catalog.campaign.length, 'The complete campaign journey must reach the finale.');
assert.equal(campaignRewardClaims, catalog.campaign.length, 'Every campaign stage must issue exactly one reward claim.');
assert(campaignState.outcomeTags.includes('final_distributed_nodes'), 'The tested final choice must persist in the character state.');

let conditionState = campaignState;
for (const quest of nonCampaignQuests) {
  let conditionResult = startQuest(conditionState, quest.id, catalog, { reputation: {} }, 300);
  assert(conditionResult.ok, `${quest.id}: conditioned quest cannot start after the campaign.`);
  conditionState = conditionResult.state;
  for (const objective of quest.objectives || []) {
    const journal = publicQuestJournal(conditionState, catalog);
    const row = [
      ...journal.mechanic,
      ...journal.personal,
      ...Object.values(journal.factions).flat()
    ].find(entry => entry.id === quest.id);
    const binding = catalog.objectiveBindings[objective];
    assert.equal(row?.currentObjective, objective, `${quest.id}: wrong current conditioned objective.`);
    assert.equal(row?.currentObjectiveInteraction, binding.type, `${quest.id}/${objective}: journal exposes the wrong condition type.`);
    assert(String(row?.currentObjectiveHint || '').trim(), `${quest.id}/${objective}: player-facing condition hint is missing.`);
    conditionResult = advanceQuest(conditionState, quest.id, {
      action: objective,
      authoritative: true,
      locationId: String(binding.locationId || binding.locationIds?.[0] || '')
    }, catalog, 301);
    assert(conditionResult.ok, `${quest.id}/${objective}: authoritative condition cannot advance.`);
    conditionState = conditionResult.state;
  }
  if ((quest.outcomes || []).length) {
    const outcome = quest.outcomes[0];
    conditionResult = chooseQuestOutcome(conditionState, quest.id, typeof outcome === 'string' ? outcome : outcome.id, catalog, 302);
  } else {
    conditionResult = turnInQuest(conditionState, quest.id, catalog, 302);
  }
  assert(conditionResult.ok && conditionResult.completed, `${quest.id}: conditioned quest cannot be resolved.`);
  conditionState = conditionResult.state;
}
assert.equal(Object.keys(conditionState.completed).length, allQuests(catalog).length,
  'A single character must be able to complete every authored quest exactly once.');

let state = initialQuestState();
assert(!publicQuestJournal(state, catalog).factions.continuity, 'The Committee must stay hidden before chapter III.');
let result = startQuest(state, 'side_quiet_squeak', catalog, { reputation: {} }, 1);
assert(result.ok); state = result.state;
for (const objective of catalog.mechanicQuests[0].objectives) {
  result = advanceQuest(state, 'side_quiet_squeak', { action: objective, authoritative: true }, catalog, 2);
  assert(result.ok); state = result.state;
}
assert(result.awaitingTurnIn, 'Quiet Squeak must wait for dialogue turn-in.');
result = turnInQuest(state, 'side_quiet_squeak', catalog, 3);
state = result.state;
assert(result.completed && result.reward.items.artifactDetectorMk1 === 1, 'Quiet Squeak must uniquely unlock Mk1 detector.');
assert(!startQuest(state, 'side_quiet_squeak', catalog, {}, 3).ok, 'Completed unique quest cannot restart.');

result = startQuest(state, 'uprava_ration_unit', catalog, { reputation: { uprava: 0 } }, 4); state = result.state;
for (const objective of catalog.factionQuests[0].objectives) state = advanceQuest(state, 'uprava_ration_unit', { action: objective, authoritative: true }, catalog, 5).state;
result = chooseQuestOutcome(state, 'uprava_ration_unit', 'replace_report', catalog, 6);
assert(result.completed && result.outcomeTag === 'uprava_ration_unit:replace_report');
assert(result.reward && !chooseQuestOutcome(result.state, 'uprava_ration_unit', 'replace_report', catalog, 7).ok, 'Outcome and unique reward resolve once.');

const repeat1 = repeatableReward(result.state, 'escort_supplies', catalog);
const repeat2 = repeatableReward(repeat1.state, 'escort_supplies', catalog);
assert(repeat2.reward.silver < repeat1.reward.silver && !repeat1.reward.unlock && !repeat1.reward.items, 'Repeated contracts only pay diminishing ordinary rewards.');
// --- опыт за задания --------------------------------------------------------
// Сюжет платил только марками: serverApplyKromkaQuestResult начислял silver,
// предметы и репутацию и ни разу не трогал опыт. Из-за этого 34 авторских
// задания не открывали ни одного перка, хотя каталог перков сам гейтит их
// уровнями 3/6/9/12, а весь опыт приходилось добирать убийствами.
const xpOf = quest => {
  const direct = Number(quest?.reward?.xp || 0);
  if (direct > 0) return direct;
  const outcomes = Array.isArray(quest?.outcomes) ? quest.outcomes : [];
  if (!outcomes.length) return 0;
  return outcomes.every(row => Number(row?.reward?.xp || 0) > 0)
    ? Math.min(...outcomes.map(row => Number(row.reward.xp)))
    : 0;
};

const authoredQuests = [...catalog.campaign, ...catalog.factionQuests, ...catalog.mechanicQuests, ...catalog.personalQuests];
for (const quest of authoredQuests) {
  assert(xpOf(quest) > 0, `${quest.id}: задание не даёт опыта — сюжет снова не растит персонажа`);
}
for (const template of catalog.repeatableTemplates || []) {
  assert(Number(template.baseXp || 0) > 0, `${template.id}: повторяемый контракт не даёт опыта`);
}

const questXpTotal = authoredQuests.reduce((sum, quest) => sum + xpOf(quest), 0);
// Кривая уровня: xpNeeded стартует со 100 и умножается на 1.45 за уровень.
let needed = 100;
let cumulative = 0;
let reachable = 1;
while (cumulative + needed <= questXpTotal && reachable < 200) {
  cumulative += needed;
  needed = Math.floor(needed * 1.45);
  reachable += 1;
}
assert(reachable >= 9,
  `весь сюжет даёт ${questXpTotal} опыта — это только ${reachable} уровень, перки уровней 9 и 12 остаются недостижимыми через сюжет`);

// Опыт обязан доехать до персонажа, а не остаться числом в каталоге.
const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
assert(serverSource.includes('const questXp = Math.max(0, Math.floor(Number(reward.xp || 0)));')
  && serverSource.includes('serverGrantXp(player, questXp)'),
  'server.js не начисляет опыт за задание');

assert(Number(repeat1.reward.xp || 0) > 0 && Number(repeat2.reward.xp || 0) < Number(repeat1.reward.xp),
  'Повторяемый контракт обязан платить опытом по затухающей кривой');

// Два задания закрываются в обход serverApplyKromkaQuestResult: пролог — через
// онбординг (это его единственный путь), «Право на воздух» — ещё и через меню
// убежища. Каждый такой обход обязан выдавать награду сам, иначе опыт лежит в
// каталоге мёртвым грузом.
for (const [questId, marker] of [
  ['campaign_prologue_twelfth', "serverKromkaQuestById('campaign_prologue_twelfth')?.reward"],
  ['personal_aktov_air_rights', "serverKromkaQuestById('personal_aktov_air_rights')?.reward?.xp"]
]) {
  const closes = serverSource.includes(`completed.${questId} = {`);
  if (!closes) continue;
  assert(serverSource.includes(marker),
    `${questId} закрывается в обход serverApplyKromkaQuestResult и не выдаёт свою награду`);
}

console.log('Kromka campaign check passed: 6 campaign stages, 18 faction quests, 10 personal quests, hidden secrets and idempotent rewards; '
  + `${authoredQuests.length} authored quests grant ${questXpTotal} xp, carrying a character to level ${reachable}.`);
